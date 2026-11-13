from __future__ import annotations

import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    APP_HOME,
    DEPLOYED_APP,
    S3,
    Postgres,
    animations,
    axe,
    center,
    click,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    motion,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    select,
    shipped_packages,
    unique,
    fill,
)

PASSCODE = "wren-seed-2027"
DOMAIN = "@sundialwren.example"
NY, LDN, AKL = "America/New_York", "Europe/London", "Pacific/Auckland"
CITY = {NY: "New York", LDN: "London", AKL: "Auckland"}
NAMES = {
    "marit": "Marit Holloway", "ines": "Ines Okafor", "edith": "Edith Sarr", "rafe": "Rafe Moncrieff",
    "yuki": "Yuki Tamblyn", "dara": "Dara Kessler", "joss": "Joss Abernathy", "priya": "Priya Venn",
    "callum": "Callum Reyes", "noor": "Noor Lindqvist", "tane": "Tane Whitcombe", "hana": "Hana Rewiti",
    "oren": "Oren Castell", "lia": "Lia Fenwick", "sam": "Sam Aldous", "bea": "Bea Marchetti",
}
DESKTOP, TABLET, PHONE = (1280, 800), (768, 1024), (375, 812)
LIVE_MS = 2500
ACT_S = 20.0
ACT_MS = 20000
HTTP_S = 60.0
PRINT_S = 90.0
RIBBON_MAX_MS = 600
ROLL_MAX_MS = 400
UNDO_MS = 10000
REPLAY_WINDOW_S = 1.5
LANE_TOLERANCE = 2
SCHEDULE_TOLERANCE = 4
TARGET_PX = 44
COLUMN_MAX_PX = 560
RETURNS_PORT = 4190
COPY_PORT = 4199
RULE_NOTE = "Harbour order"
GUEST_ON = {"modify_event": False, "invite_others": False, "see_guest_list": True}
GUEST_OFF = {"modify_event": False, "invite_others": False, "see_guest_list": False}
NEW_CLOSE = "18:00"
ROUND_RULE = "FREQ=WEEKLY;COUNT=6"
BACK_SOON = "Back soon"
AWAY_DAY = "Away that day"
THURSDAY = "Back on Thursday"
ON_LEAVE = "On leave"
LOSER = "Loser room"
CHANGED = "Changed"
EARLIER = "Earlier flight"
CORS_PREFIX = "access-control-"


def calendar_url(calendar: str, tail: str = "") -> str:
    return f"/api/calendars/{calendar}{tail}"


def share_url(calendar: str, person: str) -> str:
    return calendar_url(calendar, f"/shares/{person}")


def event_url(event_id: str, tail: str = "") -> str:
    return f"/api/events/{event_id}{tail}"

FULL_FIELDS = set(
    "id, calendar_id, series_id, split_from, organiser, title, location, notes, kind, colour, reminders, all_day, "
    "start_local, end_local, zone, visibility, rrule, decline_mode, decline_message, switches, guests, rsvp, "
    "proposals, exceptions, zone_warnings, share_link, version, saved_at, access, adjusted, clocks, start_utc, "
    "end_utc".split(", ")
)
GUEST_FIELDS = set(
    "id, calendar_id, series_id, organiser, title, location, notes, kind, colour, reminders, all_day, start_local, "
    "end_local, zone, rrule, switches, guests, rsvp, my_reply, my_proposals, zone_warnings, version, access, "
    "adjusted, clocks, start_utc, end_utc".split(", ")
)
DETAILS_FIELDS = set(
    "id, calendar_id, series_id, organiser, title, location, notes, kind, colour, all_day, start_local, end_local, "
    "zone, rrule, access, adjusted, clocks, start_utc, end_utc".split(", ")
)
BUSY_FIELDS = set("id, calendar_id, title, all_day, start_local, end_local, zone, access, clocks, start_utc, end_utc".split(", "))

expect.set_options(timeout=ACT_MS)


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def short_url() -> str:
    return env_url("APP_SHORT_URL")


def poll(check, seconds: float, contract: str):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            last = check()
        except (AssertionError, LookupError, PlaywrightError) as error:
            last = error
            continue
        if last:
            return last
    pytest.fail(f"{contract}; last observed: {last!r}")


def iso(d: date) -> str:
    return d.isoformat()


def day(text: str) -> date:
    return date.fromisoformat(text)


def label(d: date | str) -> str:
    d = day(d) if isinstance(d, str) else d
    return f"{d:%a} {d.day} {d:%b %Y}"


def stamp(d: date | str, hhmm: str) -> str:
    return f"{d}T{hhmm}"


def typed(d: date | str, hhmm: str) -> str:
    return f"{d} {hhmm}"


def oid(event_id: str, d: date | str, hhmm: str) -> str:
    return f"{event_id}@{str(d).replace('-', '')}T{hhmm.replace(':', '')}"


_USED_WEEKS: set[date] = set()


def fresh_monday() -> date:
    for _ in range(5000):
        year = 2031 + uuid.uuid4().int % 69
        first = date(year, 1, 3)
        first += timedelta(days=(7 - first.weekday()) % 7)
        week = first + timedelta(weeks=uuid.uuid4().int % 7)
        if week not in _USED_WEEKS:
            _USED_WEEKS.add(week)
            return week
    pytest.fail("no unused winter week left for this test run")


def lone_month_monday() -> date:
    for _ in range(5000):
        year = 2031 + uuid.uuid4().int % 69
        first = date(year, 1, 3)
        first += timedelta(days=(7 - first.weekday()) % 7)
        week = first + timedelta(weeks=uuid.uuid4().int % 7)
        start = week.replace(day=1)
        start -= timedelta(days=start.weekday() + 7)
        shown = {start + timedelta(weeks=k) for k in range(8)}
        if not shown & _USED_WEEKS:
            _USED_WEEKS.update(shown)
            return week
    pytest.fail("no unused winter month left for this test run")


def title_of(prefix: str = "Meeting") -> str:
    return unique(prefix)[0]


def parse_utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


def _sunday(year: int, month: int, nth: int) -> date:
    if nth > 0:
        first = date(year, month, 1)
        return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (nth - 1))
    last = (date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1))
    return last - timedelta(days=(last.weekday() + 1) % 7)


def utc_offset(zone: str, moment: datetime) -> timedelta:
    moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
    y = moment.year
    if zone == NY:
        begin = datetime.combine(_sunday(y, 3, 2), datetime.min.time()) + timedelta(hours=7)
        end = datetime.combine(_sunday(y, 11, 1), datetime.min.time()) + timedelta(hours=6)
        return timedelta(hours=-4 if begin <= moment < end else -5)
    if zone == LDN:
        begin = datetime.combine(_sunday(y, 3, -1), datetime.min.time()) + timedelta(hours=1)
        end = datetime.combine(_sunday(y, 10, -1), datetime.min.time()) + timedelta(hours=1)
        return timedelta(hours=1 if begin <= moment < end else 0)
    end = datetime.combine(_sunday(y, 4, 1), datetime.min.time()) - timedelta(hours=10)
    begin = datetime.combine(_sunday(y, 9, -1), datetime.min.time()) - timedelta(hours=10)
    return timedelta(hours=12 if end <= moment < begin else 13)


def local_of(zone: str, moment: datetime) -> datetime:
    return moment.astimezone(timezone.utc).replace(tzinfo=None) + utc_offset(zone, moment)


class Api:
    def __init__(self, base: str, first: str):
        self.base, self.first = base.rstrip("/"), first
        self.client = httpx.Client(base_url=self.base, timeout=HTTP_S)
        answer = self.client.post("/api/session", json={"email": f"{first}{DOMAIN}", "passcode": PASSCODE})
        assert answer.status_code == 200, f"seeded sign-in for {first}: {answer.status_code} {answer.text[:200]}"

    def get(self, path: str, **kw) -> httpx.Response:
        return self.client.get(path, **kw)

    def post(self, path: str, **kw) -> httpx.Response:
        return self.client.post(path, **kw)

    def patch(self, path: str, **kw) -> httpx.Response:
        return self.client.patch(path, **kw)

    def put(self, path: str, **kw) -> httpx.Response:
        return self.client.put(path, **kw)

    def delete(self, path: str, **kw) -> httpx.Response:
        return self.client.delete(path, **kw)


_SESSIONS: dict[tuple[str, str], Api] = {}
_KINDS: dict[str, dict[str, str]] = {}


def api(base: str, first: str) -> Api:
    key = (base.rstrip("/"), first)
    if key not in _SESSIONS:
        _SESSIONS[key] = Api(base, first)
    return _SESSIONS[key]


def kind_value(base: str, kind: str) -> str:
    if base not in _KINDS:
        _KINDS[base] = {
            "event": api(base, "dara").get("/api/events/evt-client-readout").json()["kind"],
            "focus": api(base, "hana").get("/api/events/evt-hana-focus").json()["kind"],
            "away": api(base, "tane").get("/api/events/evt-tane-away").json()["kind"],
        }
    return _KINDS[base][kind]


def new_event(a: Api, title: str, start: str, end: str, *, calendar: str | None = None, zone: str = LDN,
              kind: str = "event", **extra) -> dict:
    body = {"calendar_id": calendar or f"cal-{a.first}", "title": title, "kind": kind_value(a.base, kind),
            "all_day": len(start) == 10, "start_local": start, "end_local": end, "zone": zone, **extra}
    answer = a.post("/api/events", json=body)
    assert answer.status_code == 201, f"POST /api/events: {answer.status_code} {answer.text[:400]}"
    return answer.json()


def event_of(a: Api, event_id: str, occurrence: str | None = None) -> dict:
    params = {"occurrence_id": occurrence} if occurrence else {}
    answer = a.get(f"/api/events/{event_id}", params=params)
    assert answer.status_code == 200, f"GET event {event_id}: {answer.status_code} {answer.text[:300]}"
    return answer.json()


def if_match(event: dict) -> dict:
    return {"If-Match": f'"{event["version"]}"'}


def save_raw(a: Api, event_id: str, **fields) -> httpx.Response:
    current = event_of(a, event_id)
    return a.patch(f"/api/events/{event_id}", headers=if_match(current), json=fields)


def save(a: Api, event_id: str, **fields) -> dict:
    answer = save_raw(a, event_id, **fields)
    assert answer.status_code == 200, f"PATCH event {event_id}: {answer.status_code} {answer.text[:400]}"
    return answer.json()


def trash(a: Api, event_id: str, **params) -> str:
    current = event_of(a, event_id)
    answer = a.delete(f"/api/events/{event_id}", headers=if_match(current), params=params)
    assert answer.status_code == 200, f"DELETE event: {answer.status_code} {answer.text[:300]}"
    return answer.json()["trash_id"]


def reply(a: Api, event_id: str, answer: str, occurrence: str | None = None) -> httpx.Response:
    body = {"scope": "occurrence", "occurrence_id": occurrence, "answer": answer} if occurrence else {
        "scope": "series", "answer": answer}
    return a.put(f"/api/events/{event_id}/replies/me", json=body)


def rows_between(a: Api, start: date | str, end: date | str) -> list[dict]:
    answer = a.get("/api/occurrences", params={"from": str(start), "to": str(end)})
    assert answer.status_code == 200, answer.text[:300]
    return answer.json()["occurrences"]


def titled(a: Api, title: str, start: date | str, end: date | str) -> list[dict]:
    return [o for o in rows_between(a, start, end) if o["title"] == title]


def occ_at(a: Api, title: str, on: str) -> dict | None:
    d = day(on)
    hits = [o for o in titled(a, title, d - timedelta(days=1), d + timedelta(days=2))
            if str(o["start_local"]).startswith(on)]
    return hits[0] if hits else None


def answer_of(event: dict, person: str) -> str:
    return next(g["answer"] for g in event["guests"] if g["person_id"] == person)


def notice_texts(a: Api) -> list[str]:
    answer = a.get("/api/notices")
    assert answer.status_code == 200, answer.text[:200]
    return [n["text"] for n in answer.json()["notices"]]


def calendar_name(a: Api, calendar_id: str) -> str:
    return next(c["name"] for c in a.get("/api/calendars").json()["calendars"] if c["id"] == calendar_id)


def set_share(a: Api, calendar: str, person: str, level: str) -> None:
    answer = a.put(f"/api/calendars/{calendar}/shares/{person}", json={"level": level})
    assert answer.status_code == 200, f"PUT share: {answer.status_code} {answer.text[:200]}"


def server_now(base: str) -> datetime:
    return parse_utc(httpx.get(f"{base}/api/time", timeout=HTTP_S).json()["now_utc"])


def auckland_rule(base: str) -> dict:
    marit = api(base, "marit")
    answer = marit.post("/api/zone-rules", json={"zone": AKL, "effective_date": "2026-06-01",
                                                 "new_offset": "+13:00", "note": RULE_NOTE})
    assert answer.status_code in (201, 409), answer.text[:300]
    rules = marit.get("/api/zone-rules").json()["rules"]
    return next(r for r in rules if r["zone"] == AKL and r["effective_date"] == "2026-06-01")


LISTEN_JS = """el => { if (window.__wren) return; window.__wren = [el.textContent];
  new MutationObserver(() => { const t = el.textContent;
    if (t !== window.__wren[window.__wren.length - 1]) window.__wren.push(t); })
  .observe(el, {childList: true, subtree: true, characterData: true}); }"""

CLEAR_JS = """el => { const r = el.getBoundingClientRect();
  if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) return false;
  const hit = (x, y) => { const t = document.elementFromPoint(x, y);
    return !!t && (t === el || el.contains(t) || t.contains(el)); };
  const x = r.left + r.width / 2; return hit(x, r.top + 1) && hit(x, r.bottom - 1); }"""

WS_SPY = """(() => { const N = window.WebSocket; window.__ws = {opened: 0, urls: [], early: 0, frames: []};
  window.WebSocket = new Proxy(N, {construct(t, a) { const w = new t(...a); __ws.opened++; __ws.urls.push(String(a[0]));
    const s = w.send.bind(w); w.send = d => { if (w.readyState === 0) __ws.early++; return s(d); };
    w.addEventListener('message', e => __ws.frames.push(String(e.data))); return w; }}); })()"""

MOTION_HOOK = """() => { if (window.__motion) { window.__motion.length = 0; return; } window.__motion = [];
  const note = t => { const ds = t.getAnimations ? t.getAnimations().map(a => a.effect.getComputedTiming().duration) : [];
    window.__motion.push(...(ds.length ? ds : [0])); };
  document.addEventListener('transitionrun', e => note(e.target), true);
  document.addEventListener('animationstart', e => note(e.target), true);
  const o = Element.prototype.animate; Element.prototype.animate = function (...a) { const x = o.apply(this, a);
    window.__motion.push(x.effect.getComputedTiming().duration); return x; }; }"""

LIVE_JS = """([after, ms]) => new Promise(resolve => { const frames = [];
  const w = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/live?after=' + after);
  w.onmessage = e => frames.push(String(e.data));
  const stop = () => { w.close(); resolve(frames); };
  w.onerror = () => resolve(frames); w.onopen = () => { const c = window.__realSetTimeout || setTimeout; c(stop, ms); }; })"""


def status(page: Page) -> Locator:
    return page.get_by_role("status", name="Wren status")


def printed(page: Page, text: str) -> bool:
    everywhere = sum(item.is_visible() for item in page.get_by_text(text).all())
    announced = sum(item.is_visible() for item in status(page).get_by_text(text).all())
    return everywhere > announced


def see_copy(page: Page, text: str, seconds: float = ACT_S) -> None:
    poll(lambda: printed(page, text), seconds, f"{text!r} printed on the page, outside the status region")


def no_copy(page: Page, text: str, seconds: float = ACT_S) -> None:
    poll(lambda: not printed(page, text), seconds, f"{text!r} gone from the page, outside the status region")


def listen(page: Page) -> None:
    expect(status(page)).to_have_count(1)
    status(page).evaluate(LISTEN_JS)


def norm(text: str) -> str:
    return " ".join(text.split())


def counts_line(yes: int, no: int, maybe: int, waiting: int) -> str:
    return f"{yes} yes, {no} no, {maybe} maybe, {waiting} waiting"


def says(page: Page, text: str, seconds: float = ACT_S) -> None:
    def seen() -> bool:
        return any(text in norm(t) for t in status(page).evaluate("el => [el.textContent].concat(window.__wren || [])"))
    poll(seen, seconds, f"status region announced {text!r}")


def announce_count(page: Page, text: str) -> int:
    total, previous = 0, 0
    for entry in status(page).evaluate("el => window.__wren || [el.textContent]"):
        now = norm(entry).count(text)
        total += max(0, now - previous)
        previous = now
    return total


def once(page: Page, text: str, seconds: float = ACT_S) -> None:
    says(page, text, seconds)
    deadline = time.monotonic() + REPLAY_WINDOW_S
    while time.monotonic() < deadline:
        assert announce_count(page, text) <= 1, f"{text!r} was announced more than once"
    assert announce_count(page, text) == 1, f"{text!r} was not announced exactly once"


@contextmanager
def screen(browser: Browser, base: str, who: str | None = None, path: str = "/calendar", size: tuple[int, int] = DESKTOP,
           reduced: bool = False, keep_draft: bool = False, before=None):
    choice = "reduce" if reduced else "no-preference"
    with open_app(browser, f"{base}/signin", reduced_motion=choice) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        page.clock.resume()
        if who:
            answer = page.request.post(f"{base}/api/session", data={"email": f"{who}{DOMAIN}", "passcode": PASSCODE})
            assert answer.status == 200, f"browser sign-in for {who}: {answer.status}"
            if not keep_draft:
                page.request.delete(f"{base}/api/draft")
        if before:
            before(page)
        page.goto(f"{base}{path}")
        listen(page)
        yield page


def freeze(page: Page) -> None:
    now = page.evaluate("Date.now()")
    page.clock.pause_at(datetime.fromtimestamp(now / 1000 + 1, tz=timezone.utc))


def role(scope, kind: str, name: str) -> Locator:
    return scope.get_by_role(kind, name=name, exact=True)


def button(scope, name: str) -> Locator:
    return role(scope, "button", name)


def dialog(page: Page, name: str) -> Locator:
    return role(page, "dialog", name)


def textbox(scope, name: str) -> Locator:
    return role(scope, "textbox", name)


def combo(scope, name: str) -> Locator:
    return role(scope, "combobox", name)


def radio(scope, name: str) -> Locator:
    return role(scope, "radio", name)


def block(page: Page, title: str, start: str, end: str) -> Locator:
    return button(page, f"{title}, {start} to {end}")


def all_day_block(page: Page, title: str) -> Locator:
    return button(page, f"{title}, all day")


def cell(page: Page, d: date | str, hhmm: str) -> Locator:
    return role(page, "gridcell", f"{label(d)} {hhmm}")


def box(locator: Locator) -> dict:
    found = locator.bounding_box()
    assert found, "expected the element to have a box on screen"
    return found


def in_view(locator: Locator, seconds: float = 5.0) -> None:
    poll(lambda: locator.evaluate(CLEAR_JS), seconds, "element fully in view and clear of sticky headings")


SETTLE_S = 1.5


def on_slot(locator: Locator, slot: Locator) -> None:
    def placed() -> bool:
        found, target = box(locator), box(slot)
        assert abs(found["y"] - target["y"]) <= LANE_TOLERANCE, f"block top {found['y']} against slot {target['y']}"
        assert target["x"] - LANE_TOLERANCE <= found["x"] < target["x"] + target["width"], f"block left {found['x']} outside the column at {target['x']}"
        return True

    poll(placed, SETTLE_S, "block on its slot")


BUTTON_BOXES = """() => [...document.querySelectorAll('button, [role=button]')].filter(e => e.getClientRects().length)
  .map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })"""


def steady(read, contract: str):
    seen: dict = {"value": None, "since": time.monotonic()}

    def held():
        value, now = read(), time.monotonic()
        if value != seen["value"]:
            seen.update(value=value, since=now)
            return None
        return [value] if now - seen["since"] >= SETTLE_S else None

    return poll(held, ACT_S, contract)[0]


def drawn(page: Page) -> None:
    steady(lambda: (layout(page), page.evaluate(BUTTON_BOXES))[1], "the page finished drawing with no overflow")


def row_height(page: Page, d: date | str) -> float:
    return box(cell(page, d, "09:15"))["y"] - box(cell(page, d, "09:00"))["y"]


def day_step(page: Page, d: date) -> float:
    return box(cell(page, d + timedelta(days=1), "09:00"))["x"] - box(cell(page, d, "09:00"))["x"]


def grip(locator: Locator, edge: str | None = None) -> tuple[float, float]:
    locator.scroll_into_view_if_needed()
    if edge is None:
        return center(locator)
    b = box(locator)
    return b["x"] + b["width"] / 2, b["y"] + 3 if edge == "top" else b["y"] + b["height"] - 3


def drag_block(page: Page, locator: Locator, dx: float = 0, dy: float = 0, edge: str | None = None,
               release: bool = True) -> tuple[float, float]:
    x, y = grip(locator, edge)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=6)
    if release:
        page.mouse.up()
    return x, y


def choose_scope(page: Page, option: str, title: str = "Edit repeating event", confirm: str = "OK") -> None:
    box_dialog = dialog(page, title)
    expect(box_dialog).to_be_visible()
    click(radio(box_dialog, option))
    click(button(box_dialog, confirm))


CLOCK_RE = re.compile(r'group "(New York|London|Auckland) (\d\d:\d\d), (inside|outside) working hours"')


def clock_rows(locator: Locator) -> list[tuple[str, str, str]]:
    return CLOCK_RE.findall(locator.aria_snapshot())


def await_clocks(locator: Locator, wanted: list[tuple[str, str, str]]) -> None:
    poll(lambda: clock_rows(locator) == wanted, ACT_S, f"Three clocks reading {wanted}")


def api_clocks(event: dict) -> list[tuple[str, str, str]]:
    return [(c["city"], c["time"], "inside" if c["inside_hours"] else "outside") for c in event["clocks"]]


def motion_events(page: Page) -> list[float]:
    return page.evaluate("window.__motion || []")


def raw_frames(page: Page, after: int = 0, ms: int = 1500) -> list[str]:
    return page.evaluate(LIVE_JS, [after, ms])


def routed(page: Page, routes: list) -> list:
    page.evaluate("0")
    return routes


def ws_route(flags: dict, routes: list):
    def handler(ws) -> None:
        routes.append(ws)
        server = ws.connect_to_server()
        if flags.get("refuse"):
            server.on_message(lambda _message: None)
            server.close()
    return handler


def prepare_ws(flags: dict, routes: list):
    def before(page: Page) -> None:
        page.add_init_script(WS_SPY)
        page.route_web_socket(re.compile(r"/api/live"), ws_route(flags, routes))
    return before


def test_wf_time_zones_daylight_weekly_across_change(browser, app_url):
    dara = api(app_url, "dara")
    published = {"2027-03-09": ("14:00", "03:00"), "2027-03-16": ("13:00", "02:00"),
                 "2027-03-30": ("14:00", "02:00"), "2027-04-06": ("14:00", "01:00")}
    for on, (london, auckland) in published.items():
        row = occ_at(dara, "Partners' weekly", on)
        assert row and row["start_local"] == f"{on}T09:00" and row["zone"] == NY
        clocks = {c["city"]: c["time"] for c in row["clocks"]}
        assert clocks == {"New York": "09:00", "London": london, "Auckland": auckland}, on
    assert parse_utc(occ_at(dara, "Partners' weekly", "2027-03-09")["start_utc"]) - parse_utc(
        occ_at(dara, "Partners' weekly", "2027-03-16")["start_utc"]) == timedelta(days=-7, hours=1)
    with screen(browser, app_url, "ines", "/calendar?view=week&date=2027-03-15") as ines_page, \
            screen(browser, app_url, "dara", "/calendar?view=week&date=2027-03-15") as dara_page:
        expect(block(ines_page, "Partners' weekly", "13:00", "14:00")).to_be_visible()
        expect(block(dara_page, "Partners' weekly", "09:00", "10:00")).to_be_visible()
        ines_page.goto(f"{app_url}/calendar?view=week&date=2027-03-08")
        expect(block(ines_page, "Partners' weekly", "14:00", "15:00")).to_be_visible()
        for page, start, end in ((ines_page, "14:00", "15:00"), (dara_page, "09:00", "10:00")):
            page.goto(f"{app_url}/calendar?view=week&date=2027-03-29")
            expect(block(page, "Partners' weekly", start, end)).to_be_visible()


def test_wf_time_zones_daylight_gaps_and_repeats(browser, app_url):
    joss = api(app_url, "joss")
    expected = {"2027-03-07": ("02:30", "03:00", False), "2027-03-14": ("03:00", "03:30", True),
                "2027-03-21": ("02:30", "03:00", False)}
    for on, (start, end, adjusted) in expected.items():
        row = occ_at(joss, "Sunday markets check", on)
        assert row, f"Sunday markets check on {on}"
        assert (row["start_local"], row["end_local"]) == (f"{on}T{start}", f"{on}T{end}")
        assert bool(row["adjusted"]) is adjusted, on
    first_of_two = new_event(joss, title_of("Repeated"), "2027-11-07T01:30", "2027-11-07T03:00", zone=NY)
    assert parse_utc(first_of_two["start_utc"]) == datetime(2027, 11, 7, 5, 30, tzinfo=timezone.utc)
    london = new_event(joss, title_of("Repeated"), "2027-10-31T01:30", "2027-10-31T03:00", zone=LDN)
    assert parse_utc(london["start_utc"]) == datetime(2027, 10, 31, 0, 30, tzinfo=timezone.utc)
    auckland = new_event(joss, title_of("Repeated"), "2027-04-04T02:30", "2027-04-04T04:00", zone=AKL)
    assert parse_utc(auckland["start_utc"]) == datetime(2027, 4, 3, 13, 30, tzinfo=timezone.utc)
    gap = new_event(joss, title_of("Gap"), "2027-09-26T02:30", "2027-09-26T03:00", zone=AKL)
    assert gap["adjusted"] is True and gap["start_local"] == stamp(date(2027, 9, 26), "03:00") and gap["end_local"] == stamp(date(2027, 9, 26), "03:30")
    path = f"/events/evt-sunday-check?occurrence={oid('evt-sunday-check', '2027-03-14', '02:30')}"
    with screen(browser, app_url, "joss", path) as page:
        sentence = "This occurrence starts at 03:00 because 02:30 does not exist on Sun 14 Mar 2027."
        see_copy(page, sentence)
        page.goto(f"{app_url}/calendar?view=week&date=2027-03-08&calendars=cal-joss")
        expect(block(page, "Sunday markets check", "03:00", "03:30")).to_have_count(1)
        for week in ("2027-03-01", "2027-03-15"):
            page.goto(f"{app_url}/calendar?view=week&date={week}&calendars=cal-joss")
            expect(block(page, "Sunday markets check", "02:30", "03:00")).to_have_count(1)


def test_wf_time_zones_daylight_wrong_device_clock(browser, app_url):
    fast = env_url("APP_REMINDER_CLOCK_URL")
    wrong = server_now(fast) + timedelta(hours=6)

    def set_device(page: Page) -> None:
        page.clock.set_system_time(wrong)

    def line_minutes(locator: Locator) -> int:
        found = re.search(r"Now (\d\d):(\d\d)", locator.aria_snapshot())
        assert found, "now line carries its published name"
        return int(found[1]) * 60 + int(found[2])

    def gap_to_server(minutes: int) -> int:
        local = local_of(LDN, server_now(fast))
        gap = abs(local.hour * 60 + local.minute - minutes) % 1440
        return min(gap, 1440 - gap)

    with screen(browser, fast, "rafe", "/calendar?view=week", before=set_device) as page:
        now_line = page.get_by_role("img", name=re.compile(r"^Now \d\d:\d\d$"))
        expect(now_line).to_be_visible()
        first = line_minutes(now_line)
        assert gap_to_server(first) <= 40, "now line reads the server clock, not the device"
        page.clock.run_for(31000)
        poll(lambda: line_minutes(now_line) != first, 65.0, "now line moved within a minute of real time")
    wrong_real = datetime(2031, 6, 15, 3, 0, tzinfo=timezone.utc)

    def set_far(page: Page) -> None:
        page.clock.set_system_time(wrong_real)

    with screen(browser, app_url, "rafe", "/calendar", before=set_far) as page:
        today = local_of(LDN, server_now(app_url)).date()
        expect(cell(page, today, "09:00")).to_have_count(1)
        page.goto(f"{app_url}/calendar?view=day&date=2027-03-09")
        page.reload()
        expect(cell(page, "2027-03-09", "09:00")).to_have_count(1)
        assert f"date={iso(date(2027, 3, 9))}" in page.url
        click(button(page, "Today"))
        expect(page).to_have_url(re.compile(f"date={iso(today)}"))


def test_wf_time_zones_daylight_keys_across_change(browser, app_url):
    ines = api(app_url, "ines")
    title = title_of("Across")
    saturday, sunday = day("2027-03-13"), day("2027-03-14")
    event = new_event(ines, title, stamp(saturday, "10:00"), stamp(saturday, "11:00"), zone=NY)
    path = "/calendar?view=week&date=2027-03-08&calendars=cal-ines"
    with screen(browser, app_url, "ines", path) as page, screen(browser, app_url, "dara", path) as other:
        item = block(page, title, "15:00", "16:00")
        expect(item).to_be_visible()
        on_slot(item, cell(page, saturday, "15:00"))
        item.focus()
        page.keyboard.press("Alt+ArrowRight")
        says(page, f"Moved {title} to 14:00 London.")
        moved = block(page, title, "14:00", "15:00")
        expect(moved).to_be_focused()
        on_slot(moved, cell(page, sunday, "14:00"))
        follows = block(other, title, "10:00", "11:00")
        poll(lambda: abs(box(follows)["x"] - box(cell(other, sunday, "10:00"))["x"]) <= LANE_TOLERANCE, LIVE_MS / 1000,
             "the other open screen shows it on Sunday, at the same New York clock time")
        page.keyboard.press("Enter")
        quick = dialog(page, title)
        await_clocks(role(quick, "group", "Three clocks"), [("New York", "10:00", "outside"), ("London", "14:00", "outside"), ("Auckland", "03:00", "outside")])
        page.keyboard.press("Escape")
        expect(quick).to_have_count(0)
        expect(moved).to_be_focused()
    saved = event_of(ines, event["id"])
    assert saved["start_local"] == stamp(sunday, "10:00") and saved["zone"] == NY
    assert parse_utc(saved["start_utc"]) == datetime(2027, 3, 14, 14, 0, tzinfo=timezone.utc)


def test_wf_create_repeats_chip_focus(browser, app_url):
    path = "/calendar?view=month&date=2027-03-15&calendars=cal-marit,cal-firm"
    with screen(browser, app_url, "marit", path) as page:
        chip = button(role(page, "region", "Month grid"), "Month-end close, 16:00 to 17:00")
        expect(chip).to_be_visible()
        chip.focus()
        page.keyboard.press("Enter")
        quick = dialog(page, "Month-end close")
        expect(quick).to_be_visible()
        page.keyboard.press("Escape")
        expect(quick).to_have_count(0)
        expect(chip).to_be_focused()
        page.keyboard.press("k")
        expect(page).to_have_url(re.compile("date=2027-02"))
        expect(chip).to_have_count(0)
        page.keyboard.press("j")
        expect(chip).to_be_visible()
        opener = button(page, "Next")
        opener.focus()
        page.keyboard.press("g")
        go = dialog(page, "Go to date")
        expect(go).to_be_visible()
        page.keyboard.press("Escape")
        expect(go).to_have_count(0)
        expect(opener).to_be_focused()
        leap = button(role(page, "region", "Month grid"), "Founders' day, all day")
        for when, count in (("2028-02-10", 1), ("2029-02-10", 0), ("2032-02-10", 1)):
            page.keyboard.press("g")
            go = dialog(page, "Go to date")
            fill(textbox(go, "Date"), when)
            click(button(go, "Go"))
            expect(page).to_have_url(re.compile(f"date={when}"))
            expect(leap).to_have_count(count)


def test_wf_create_repeats_calendar_dates(browser, app_url):
    marit = api(app_url, "marit")
    month_end = titled(marit, "Month-end close", "2027-01-01", "2027-08-01")
    assert [o["start_local"][:10] for o in month_end] == ["2027-01-31", "2027-03-31", "2027-05-31", "2027-07-31"]
    leap_days = []
    for year in range(2028, 2033):
        leap_days += [o["start_local"] for o in titled(marit, "Founders' day", f"{year}-01-01", f"{year}-12-31")]
    assert leap_days == ["2028-02-29", "2032-02-29"]
    yuki = api(app_url, "yuki")
    title = title_of("Thirty-first")
    new_event(yuki, title, "2029-01-31T10:00", "2029-01-31T11:00", rrule="FREQ=MONTHLY;COUNT=3")
    assert [o["start_local"][:10] for o in titled(yuki, title, "2029-01-01", "2029-12-31")] == [
        "2029-01-31", "2029-03-31", "2029-05-31"]
    with screen(browser, app_url, "marit", "/calendar?view=month&date=2027-02-15&calendars=cal-marit") as page:
        grid = role(page, "region", "Month grid")
        expect(grid).to_be_visible()
        expect(button(grid, "Month-end close, 16:00 to 17:00")).to_have_count(0)
        page.goto(f"{app_url}/calendar?view=month&date=2027-03-15&calendars=cal-marit")
        expect(button(role(page, "region", "Month grid"), "Month-end close, 16:00 to 17:00")).to_have_count(1)


RRULE_COPY = "Use a daily, weekly, monthly or yearly repeat with INTERVAL, BYDAY, COUNT or UNTIL."
RRULE_CASES = {
    "daily": ("FREQ=DAILY", "2029-03-05", True),
    "weekly_list": ("FREQ=WEEKLY;BYDAY=TU,MO", "2029-03-05", True),
    "any_order": ("COUNT=4;FREQ=WEEKLY;INTERVAL=2", "2029-03-05", True),
    "monthly_until": ("FREQ=MONTHLY;UNTIL=20271231", "2027-03-05", True),
    "second_tuesday": ("FREQ=MONTHLY;BYDAY=2TU", "2029-03-13", True),
    "last_friday": ("FREQ=MONTHLY;BYDAY=-1FR", "2029-03-30", True),
    "yearly_interval": ("FREQ=YEARLY;INTERVAL=2", "2029-03-05", True),
    "lowercase": ("freq=daily", "2029-03-05", False),
    "weekly_lower_day": ("FREQ=WEEKLY;BYDAY=mo", "2029-03-05", False),
    "weekly_repeat_day": ("FREQ=WEEKLY;BYDAY=MO,MO", "2029-03-05", False),
    "weekly_prefix": ("FREQ=WEEKLY;BYDAY=1MO", "2029-03-05", False),
    "interval_zero": ("FREQ=WEEKLY;INTERVAL=0", "2029-03-05", False),
    "interval_high": ("FREQ=WEEKLY;INTERVAL=100", "2029-03-05", False),
    "count_zero": ("FREQ=WEEKLY;COUNT=0", "2029-03-05", False),
    "count_high": ("FREQ=WEEKLY;COUNT=1000", "2029-03-05", False),
    "monthly_no_prefix": ("FREQ=MONTHLY;BYDAY=MO", "2029-03-05", False),
    "monthly_fifth": ("FREQ=MONTHLY;BYDAY=5TU", "2029-03-13", False),
    "monthly_two_days": ("FREQ=MONTHLY;BYDAY=2TU,3TU", "2029-03-13", False),
    "monthly_monthday": ("FREQ=MONTHLY;BYMONTHDAY=1", "2029-03-01", False),
    "until_timestamp": ("FREQ=MONTHLY;UNTIL=20271231T000000Z", "2027-03-05", False),
    "count_and_until": ("FREQ=YEARLY;COUNT=2;UNTIL=20301231", "2029-03-05", False),
    "no_freq": ("INTERVAL=2", "2029-03-05", False),
    "hourly": ("FREQ=HOURLY", "2029-03-05", False),
    "start_not_second_tuesday": ("FREQ=MONTHLY;BYDAY=2TU", "2029-03-06", False),
    "start_not_in_list": ("FREQ=WEEKLY;BYDAY=TU", "2029-03-05", False),
    "until_before_start": ("FREQ=MONTHLY;UNTIL=20290101", "2029-03-05", False),
}


@pytest.mark.parametrize("case", list(RRULE_CASES), ids=list(RRULE_CASES))
def test_rrule_forms(app_url, case):
    rule, start, accepted = RRULE_CASES[case]
    yuki = api(app_url, "yuki")
    title = title_of("Rule")
    body = {"calendar_id": "cal-yuki", "title": title, "kind": kind_value(app_url, "event"), "all_day": False,
            "start_local": stamp(start, "10:00"), "end_local": stamp(start, "11:00"), "zone": LDN, "rrule": rule}
    answer = yuki.post("/api/events", json=body)
    if accepted:
        assert answer.status_code == 201, answer.text[:300]
        assert event_of(yuki, answer.json()["id"])["rrule"] == rule
        return
    assert answer.status_code == 422, f"{rule}: {answer.status_code}"
    assert answer.json()["fields"]["rrule"] == RRULE_COPY
    assert answer.json()["error"] and answer.json()["message"]
    assert yuki.get("/api/search", params={"q": title}).json()["results"] == []


def test_wf_create_repeats_nth_and_last(browser, app_url):
    rafe = api(app_url, "rafe")
    second, last = title_of("Second"), title_of("Last")
    new_event(rafe, second, "2027-02-09T09:00", "2027-02-09T10:00", zone=NY, rrule="FREQ=MONTHLY;BYDAY=2TU;COUNT=3")
    new_event(rafe, last, "2027-01-29T09:00", "2027-01-29T10:00", zone=NY, rrule="FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270430")
    assert [o["start_local"][:10] for o in titled(rafe, second, "2027-01-01", "2027-12-31")] == [
        "2027-02-09", "2027-03-09", "2027-04-13"]
    assert [o["start_local"][:10] for o in titled(rafe, last, "2027-01-01", "2027-12-31")] == [
        "2027-01-29", "2027-02-26", "2027-03-26", "2027-04-30"]
    with screen(browser, app_url, "rafe", "/calendar?view=week&date=2027-03-22") as page:
        expect(block(page, last, "13:00", "14:00")).to_have_count(1)
        page.goto(f"{app_url}/calendar?view=week&date=2027-02-22")
        expect(block(page, last, "14:00", "15:00")).to_have_count(1)
        page.goto(f"{app_url}/calendar?view=week&date=2027-04-12")
        expect(block(page, second, "14:00", "15:00")).to_have_count(1)
        page.goto(f"{app_url}/calendar?view=week&date=2027-05-10")
        expect(cell(page, "2027-05-11", "09:00")).to_have_count(1)
        expect(block(page, second, "14:00", "15:00")).to_have_count(0)


def test_wf_create_repeats_controls(browser, app_url):
    edith = api(app_url, "edith")

    def server_draft() -> str:
        return json.dumps(edith.get("/api/draft").json()["draft"], sort_keys=True)

    title = title_of("Monthly")
    monday = fresh_monday()
    with screen(browser, app_url, "edith", f"/calendar?view=week&date={iso(monday)}") as page:
        click(button(page, "New event"))
        form = dialog(page, "New event")
        fill(textbox(form, "Title"), title)
        select(combo(form, "Calendar"), calendar_name(edith, "cal-edith"))
        fill(textbox(form, "Starts"), typed("2027-05-11", "10:00"))
        fill(textbox(form, "Ends"), typed("2027-05-11", "11:00"))
        repeat = role(form, "radiogroup", "Repeat")
        radio(repeat, "Does not repeat").focus()
        for _ in range(3):
            page.keyboard.press("ArrowDown")
        expect(radio(repeat, "Monthly")).to_be_checked()
        monthly = role(form, "radiogroup", "Monthly by")
        expect(radio(monthly, "On day 11")).to_have_count(1)
        expect(radio(monthly, "On the second Tuesday")).to_have_count(1)
        expect(monthly.get_by_role("radio", name=re.compile("last"))).to_have_count(0)
        steady(server_draft, "repeat choice saved in the server draft")
        fill(textbox(form, "Starts"), typed("2027-03-31", "10:00"))
        fill(textbox(form, "Ends"), typed("2027-03-31", "11:00"))
        expect(radio(monthly, "On the last Wednesday")).to_have_count(1)
        expect(monthly.get_by_role("radio", name=re.compile("fifth|fourth"))).to_have_count(0)
        fill(textbox(form, "Starts"), typed("2027-05-11", "10:00"))
        fill(textbox(form, "Ends"), typed("2027-05-11", "11:00"))
        kept_draft = json.loads(steady(server_draft, "server draft settled after the last change"))
        assert (kept_draft or {}).get("start_local", "").startswith("2027-05-11"), f"server draft carries the current start: {kept_draft}"
        page.reload()
        listen(page)
        form = dialog(page, "New event")
        expect(textbox(form, "Title")).to_have_value(title)
        monthly = role(form, "radiogroup", "Monthly by")
        click(radio(monthly, "On the second Tuesday"))
        ends = role(form, "radiogroup", "Ends")
        click(radio(ends, "After a number"))
        fill(role(form, "spinbutton", "Occurrences"), "3")
        click(button(form, "Save"))
        says(page, f"Saved {title}.")
    saved = titled(edith, title, "2027-05-01", "2028-01-01")
    assert [o["start_local"][:10] for o in saved] == ["2027-05-11", "2027-06-08", "2027-07-13"]
    parts = set(event_of(edith, saved[0]["event_id"])["rrule"].split(";"))
    assert parts == {"FREQ=MONTHLY", "BYDAY=2TU", "COUNT=3"}


def test_wf_scope_this_event_cancel_changes_nothing(browser, app_url):
    priya = api(app_url, "priya")
    monday = fresh_monday()
    title = title_of("Cancel")
    series = new_event(priya, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY, rrule="FREQ=WEEKLY;COUNT=4")
    version = series["version"]
    with screen(browser, app_url, "priya", f"/calendar?view=week&date={iso(monday)}&calendars=cal-priya") as page:
        original = block(page, title, "10:00", "11:00")
        expect(original).to_be_visible()
        step = row_height(page, monday)
        resting = box(original)["height"]
        for kwargs in ({"dy": step * 2}, {"dy": step * 2, "edge": "bottom"}):
            drag_block(page, original, **kwargs)
            scope_box = dialog(page, "Edit repeating event")
            expect(scope_box).to_be_visible()
            expect(role(scope_box, "radiogroup", "Apply to")).to_be_visible()
            for name in ("This event", "This and following events", "All events"):
                expect(radio(scope_box, name)).to_have_count(1)
            click(button(scope_box, "Cancel"))
            expect(scope_box).to_have_count(0)
            expect(original).to_be_visible()
            on_slot(original, cell(page, monday, "10:00"))
            assert abs(box(original)["height"] - resting) <= LANE_TOLERANCE, "Cancel returned the block to its size"
        original.focus()
        page.keyboard.press("Enter")
        quick = dialog(page, title)
        click(button(quick, "Delete"))
        delete_box = dialog(page, "Delete repeating event")
        expect(radio(delete_box, "This and following events")).to_have_count(1)
        click(button(delete_box, "Cancel"))
        expect(delete_box).to_have_count(0)
        expect(original).to_be_visible()
        if dialog(page, title).count():
            page.keyboard.press("Escape")
        original.focus()
        page.keyboard.press("Enter")
        click(button(dialog(page, title), "Edit"))
        edit = dialog(page, "Edit event")
        fill(textbox(edit, "Location"), CHANGED)
        click(button(edit, "Save"))
        scope_box = dialog(page, "Edit repeating event")
        click(button(scope_box, "Cancel"))
    after = event_of(priya, series["id"])
    assert after["version"] == version and after["exceptions"] == [] and after["location"] != CHANGED
    assert [o["start_local"][11:] for o in titled(priya, title, monday, monday + timedelta(days=28))] == ["10:00"] * 4


def test_wf_scope_this_event_keyboard_exception(browser, app_url):
    callum = api(app_url, "callum")
    title = title_of("Exception")
    series = new_event(callum, title, "2030-03-05T10:00", "2030-03-05T11:00", zone=NY, rrule="FREQ=WEEKLY;COUNT=3")
    target = "2030-03-12"
    with screen(browser, app_url, "callum", f"/calendar?view=week&date=2030-03-11&calendars=cal-callum") as page:
        item = block(page, title, "10:00", "11:00")
        item.focus()
        page.keyboard.press("Alt+ArrowDown")
        scope_box = dialog(page, "Edit repeating event")
        expect(scope_box).to_be_visible()
        radio(scope_box, "All events").focus()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        expect(radio(scope_box, "This event")).to_be_checked()
        click(button(scope_box, "OK"))
        says(page, f"Moved {title} to 10:15 New York.")
        moved = block(page, title, "10:15", "11:15")
        expect(moved).to_be_focused()
        page.keyboard.press("Alt+ArrowDown")
        says(page, f"Moved {title} to 10:30 New York.")
        expect(dialog(page, "Edit repeating event")).to_have_count(0)
        moved = block(page, title, "10:30", "11:30")
        expect(moved).to_be_focused()
        on_slot(moved, cell(page, target, "10:30"))
        button(page, "Today").focus()
        moved.focus()
        page.keyboard.press("Alt+ArrowDown")
        asked = dialog(page, "Edit repeating event")
        expect(asked).to_be_visible()
        page.keyboard.press("Escape")
        expect(asked).to_have_count(0)
        expect(moved).to_be_focused()
        page.goto(f"{app_url}/calendar?view=week&date=2030-03-04&calendars=cal-callum")
        expect(block(page, title, "10:00", "11:00")).to_have_count(1)
    rows = {o["start_local"][:10]: o for o in titled(callum, title, "2030-03-01", "2030-04-01")}
    assert rows[target]["start_local"].endswith("10:30") and rows[target]["is_exception"] is True
    assert rows["2030-03-05"]["start_local"].endswith("10:00") and rows["2030-03-19"]["start_local"].endswith("10:00")
    assert parse_utc(rows["2030-03-05"]["start_utc"]).hour == 15 and parse_utc(rows["2030-03-19"]["start_utc"]).hour == 14
    assert event_of(callum, series["id"])["exceptions"][0]["occurrence_id"] == oid(series["id"], target, "10:00")


def test_wf_scope_this_and_following_split_keeps_dates(app_url):
    edith, callum = api(app_url, "edith"), api(app_url, "callum")
    title = title_of("Split")
    series = new_event(edith, title, "2027-03-02T09:00", "2027-03-02T10:00", zone=NY, rrule="FREQ=WEEKLY;COUNT=8",
                       guest_ids=["p-callum"], switches=GUEST_ON)
    sid = series["id"]
    early_note, late_note = title_of("Early"), title_of("Late")
    save(edith, sid, scope="this", occurrence_id=oid(sid, "2027-03-09", "09:00"), notes=early_note)
    save(edith, sid, scope="this", occurrence_id=oid(sid, "2027-03-30", "09:00"), notes=late_note,
         start_local="2027-03-30T11:00", end_local="2027-03-30T12:00")
    assert reply(callum, sid, "maybe", oid(sid, "2027-04-06", "09:00")).status_code == 200
    answer = save(edith, sid, scope="following", occurrence_id=oid(sid, "2027-03-23", "09:00"), location="Northgate")
    assert answer["split"], "following returned its split"
    earlier, later = answer["split"]["earlier_id"], answer["split"]["later_id"]
    assert earlier != later
    assert event_of(edith, later)["split_from"] == earlier
    assert f"COUNT={8 - 3}" in event_of(edith, later)["rrule"].split(";")
    rows = titled(edith, title, "2027-03-01", "2027-06-01")
    by_date = {o["start_local"][:10]: o for o in rows}
    assert sorted(by_date) == ["2027-03-02", "2027-03-09", "2027-03-16", "2027-03-23", "2027-03-30", "2027-04-06",
                               "2027-04-13", "2027-04-20"]
    assert {by_date[d]["event_id"] for d in ("2027-03-02", "2027-03-09", "2027-03-16")} == {earlier}
    assert {by_date[d]["event_id"] for d in ("2027-03-23", "2027-03-30", "2027-04-06")} == {later}
    assert by_date["2027-03-30"]["start_local"] == stamp(date(2027, 3, 30), "11:00") and by_date["2027-03-30"]["notes"] == late_note
    assert parse_utc(by_date["2027-03-30"]["start_utc"]).hour == 15, "the exception keeps its New York clock time"
    assert by_date["2027-03-09"]["notes"] == early_note
    occurrence = by_date["2027-04-06"]["occurrence_id"]
    assert answer_of(event_of(edith, later, occurrence), "p-callum") == "maybe"
    assert answer_of(event_of(edith, later), "p-callum") == "invited"
    moved = save(edith, later, scope="following", occurrence_id=by_date["2027-04-13"]["occurrence_id"],
                 start_local="2027-04-13T10:00", end_local="2027-04-13T11:00")
    third = moved["split"]["later_id"]
    assert parse_utc(event_of(edith, third, oid(third, "2027-04-13", "10:00"))["start_utc"]).hour in (14,)
    trashed = trash(edith, third, scope="following", occurrence_id=[o for o in titled(edith, title, "2027-04-19", "2027-04-21")][0]["occurrence_id"])
    items = {i["id"]: i for i in edith.get("/api/trash").json()["items"]}
    assert items[trashed]["kind"] == "series"
    first_title = title_of("First")
    first = new_event(edith, first_title, "2031-03-04T09:00", "2031-03-04T10:00", zone=NY, rrule="FREQ=WEEKLY;COUNT=3")
    same = save(edith, first["id"], scope="following", occurrence_id=oid(first["id"], "2031-03-04", "09:00"), location="Harbour")
    assert same["split"] is None and {o["location"] for o in titled(edith, first_title, "2031-03-01", "2031-04-01")} == {"Harbour"}


def test_wf_scope_this_and_following_grid(browser, app_url):
    yuki = api(app_url, "yuki")
    title = title_of("Grid split")
    series = new_event(yuki, title, "2030-01-07T10:00", "2030-01-07T11:00", rrule="FREQ=WEEKLY;COUNT=5")
    sid = series["id"]
    save(yuki, sid, scope="this", occurrence_id=oid(sid, "2030-01-28", "10:00"),
         start_local="2030-01-28T12:00", end_local="2030-01-28T13:00")
    with screen(browser, app_url, "yuki", "/calendar?view=week&date=2030-01-14&calendars=cal-yuki") as page:
        item = block(page, title, "10:00", "11:00")
        expect(item).to_be_visible()
        drag_block(page, item, dy=row_height(page, "2030-01-14") * 2)
        choose_scope(page, "This and following events")
        says(page, f"Moved {title} to 10:30 London.")
        expect(button(page, "Undo")).to_have_count(0)
        expect(block(page, title, "10:30", "11:30")).to_have_count(1)
        page.goto(f"{app_url}/calendar?view=week&date=2030-01-07&calendars=cal-yuki")
        expect(block(page, title, "10:00", "11:00")).to_have_count(1)
        page.goto(f"{app_url}/calendar?view=week&date=2030-01-21&calendars=cal-yuki")
        expect(block(page, title, "10:30", "11:30")).to_have_count(1)
        page.goto(f"{app_url}/calendar?view=week&date=2030-01-28&calendars=cal-yuki")
        expect(block(page, title, "12:00", "13:00")).to_have_count(1)
    rows = titled(yuki, title, "2030-01-01", "2030-03-01")
    assert len({o["event_id"] for o in rows}) == 2 and len(rows) == 5


def test_wf_scope_this_and_following_keys(browser, app_url):
    yuki = api(app_url, "yuki")
    title = title_of("Key split")
    monday = fresh_monday()
    week = lambda n: monday + timedelta(weeks=n)
    new_event(yuki, title, stamp(monday, "10:00"), stamp(monday, "11:00"), rrule="FREQ=WEEKLY;COUNT=4")
    with screen(browser, app_url, "yuki", f"/calendar?view=week&date={iso(week(1))}&calendars=cal-yuki") as page:
        item = block(page, title, "10:00", "11:00")
        item.focus()
        page.keyboard.press("Alt+ArrowDown")
        asked = dialog(page, "Edit repeating event")
        expect(asked).to_be_visible()
        radio(asked, "This event").focus()
        page.keyboard.press("ArrowDown")
        expect(radio(asked, "This and following events")).to_be_checked()
        click(button(asked, "OK"))
        says(page, f"Moved {title} to 10:15 London.")
        moved = block(page, title, "10:15", "11:15")
        expect(moved).to_be_focused()
        on_slot(moved, cell(page, week(1), "10:15"))
        expect(button(page, "Undo")).to_have_count(0)
        page.keyboard.press("Enter")
        quick = dialog(page, title)
        expect(quick).to_be_visible()
        page.keyboard.press("Escape")
        expect(quick).to_have_count(0)
        expect(moved).to_be_focused()
        page.keyboard.press("j")
        expect(block(page, title, "10:15", "11:15")).to_have_count(1)
        page.keyboard.press("k")
        page.keyboard.press("k")
        expect(block(page, title, "10:00", "11:00")).to_have_count(1)
    rows = titled(yuki, title, monday, week(5))
    assert [o["start_local"][11:] for o in rows] == ["10:00", "10:15", "10:15", "10:15"]
    assert len({o["event_id"] for o in rows}) == 2 and rows[0]["event_id"] != rows[1]["event_id"]


def test_wf_scope_all_and_delete_all_on_grid(browser, app_url):
    noor = api(app_url, "noor")
    monday = fresh_monday()
    week = lambda n: monday + timedelta(weeks=n)
    title = title_of("All grid")
    special = f"{title} special"
    series = new_event(noor, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY, rrule="FREQ=WEEKLY;COUNT=4")
    sid = series["id"]
    save(noor, sid, scope="this", occurrence_id=oid(sid, week(1), "10:00"), title=special)
    moved_to = week(2) + timedelta(days=1)
    save(noor, sid, scope="this", occurrence_id=oid(sid, week(2), "10:00"), start_local=stamp(moved_to, "10:00"), end_local=stamp(moved_to, "11:00"))
    path = "/calendar?view=week&calendars=cal-noor&date="
    with screen(browser, app_url, "noor", f"{path}{iso(monday)}") as page:
        item = block(page, title, "10:00", "11:00")
        item.focus()
        page.keyboard.press("Enter")
        click(button(dialog(page, title), "Edit"))
        form = dialog(page, "Edit event")
        fill(textbox(form, "Starts"), typed(monday, "11:00"))
        fill(textbox(form, "Ends"), typed(monday, "12:00"))
        click(button(form, "Save"))
        choose_scope(page, "All events")
        says(page, f"Saved {title}.")
        expect(form).to_have_count(0)
        page.goto(f"{app_url}{path}{iso(monday)}")
        moved = block(page, title, "11:00", "12:00")
        expect(moved).to_be_visible()
        on_slot(moved, cell(page, monday, "11:00"))
        moved.focus()
        page.keyboard.press("Enter")
        quick = dialog(page, title)
        expect(quick).to_be_visible()
        page.keyboard.press("Escape")
        expect(quick).to_have_count(0)
        expect(moved).to_be_focused()
        page.goto(f"{app_url}{path}{iso(week(1))}")
        kept = block(page, special, "11:00", "12:00")
        expect(kept).to_be_visible()
        on_slot(kept, cell(page, week(1), "11:00"))
        page.goto(f"{app_url}{path}{iso(week(2))}")
        away = block(page, title, "11:00", "12:00")
        expect(away).to_be_visible()
        on_slot(away, cell(page, moved_to, "11:00"))
        page.goto(f"{app_url}{path}{iso(week(3))}")
        expect(block(page, title, "11:00", "12:00")).to_be_visible()


def test_wf_scope_all_and_delete_all_keeps_exceptions(app_url):
    noor = api(app_url, "noor")
    title = title_of("All")
    series = new_event(noor, title, "2027-03-02T09:00", "2027-03-02T10:00", zone=NY, rrule="FREQ=WEEKLY;COUNT=4", notes="Base")
    sid = series["id"]
    changed = oid(sid, "2027-03-09", "09:00")
    own_note, new_base = title_of("Own"), title_of("Base")
    save(noor, sid, scope="this", occurrence_id=changed, title=f"{title} special", notes=own_note)
    moved = oid(sid, "2027-03-16", "09:00")
    next_day = iso(day("2027-03-16") + timedelta(days=1))
    save(noor, sid, scope="this", occurrence_id=moved, start_local=stamp(next_day, "09:00"), end_local=stamp(next_day, "10:00"))
    save(noor, sid, scope="all", occurrence_id=changed, location="Harbour")
    rows = rows_between(noor, "2027-03-01", "2027-04-01")
    special = next(o for o in rows if o["title"] == f"{title} special")
    assert special["location"] == "Harbour" and special["notes"] == own_note
    save(noor, sid, scope="all", occurrence_id=oid(sid, "2027-03-02", "09:00"), notes=new_base)
    special = next(o for o in rows_between(noor, "2027-03-01", "2027-04-01") if o["occurrence_id"] == changed)
    assert special["notes"] == new_base, "editing the overridden field gives the exception the new value"
    assert special["title"] == f"{title} special"
    save(noor, sid, scope="all", occurrence_id=oid(sid, "2027-03-02", "09:00"),
         start_local="2027-03-02T10:00", end_local="2027-03-02T11:00")
    rows = [o for o in rows_between(noor, "2027-03-01", "2027-04-01") if o["event_id"] == sid]
    by_date = {o["start_local"][:10]: o for o in rows}
    assert moved and next_day in by_date, "the moved exception keeps its moved date"
    assert by_date["2027-03-02"]["start_local"] == stamp(date(2027, 3, 2), "10:00")
    late = by_date["2027-03-23"]
    assert late["start_local"] == stamp(date(2027, 3, 23), "10:00") and parse_utc(late["start_utc"]).hour == 14, "clock kept across daylight"
    assert parse_utc(by_date["2027-03-02"]["start_utc"]).hour == 15


def test_wf_scope_all_and_delete_choices(browser, app_url):
    oren = api(app_url, "oren")
    monday = fresh_monday()
    title = title_of("Delete")
    series = new_event(oren, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=AKL, rrule="FREQ=WEEKLY;COUNT=6")
    sid = series["id"]
    week = lambda n: monday + timedelta(weeks=n)
    with screen(browser, app_url, "oren", f"/calendar?view=week&date={iso(week(1))}&calendars=cal-oren") as page:
        item = block(page, title, "10:00", "11:00")
        item.focus()
        page.keyboard.press("Delete")
        choose_scope(page, "This event", "Delete repeating event", "Delete")
        says(page, f"Moved {title} to trash.")
        expect(item).to_have_count(0)
        expect(cell(page, week(1), "10:00")).to_be_focused()
        page.goto(f"{app_url}/calendar?view=week&date={iso(week(3))}&calendars=cal-oren")
        item = block(page, title, "10:00", "11:00")
        item.focus()
        page.keyboard.press("Enter")
        click(button(dialog(page, title), "Delete"))
        choose_scope(page, "This and following events", "Delete repeating event", "Delete")
        expect(item).to_have_count(0)
        page.goto(f"{app_url}/calendar?view=week&date={iso(monday)}&calendars=cal-oren")
        item = block(page, title, "10:00", "11:00")
        item.focus()
        page.keyboard.press("Delete")
        choose_scope(page, "All events", "Delete repeating event", "Delete")
        expect(item).to_have_count(0)
    assert titled(oren, title, monday, week(8)) == []
    kinds = sorted(i["kind"] for i in oren.get("/api/trash").json()["items"] if i["title"] == title)
    assert kinds == ["occurrence", "series", "series"]
    single = next(i for i in oren.get("/api/trash").json()["items"] if i["title"] == title and i["kind"] == "series"
                  and i["event_id"] == sid)
    assert oren.post(f"/api/trash/{single['id']}/restore").status_code == 200
    assert {o["start_local"][:10] for o in titled(oren, title, monday, week(8))} == {iso(monday), iso(week(2))}


def test_wf_trash_restore_series_exact(browser, app_url):
    priya, callum = api(app_url, "priya"), api(app_url, "callum")
    monday = fresh_monday()
    title = title_of("Restore")
    series = new_event(priya, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY, rrule="FREQ=WEEKLY;COUNT=4",
                       guest_ids=["p-callum"], switches=GUEST_ON)
    sid = series["id"]
    save(priya, sid, scope="this", occurrence_id=oid(sid, monday + timedelta(days=7), "10:00"), notes="Kept")
    assert reply(callum, sid, "yes").status_code == 200
    proposal = callum.post(f"/api/events/{sid}/proposals", json={
        "occurrence_id": oid(sid, monday + timedelta(days=14), "10:00"),
        "start_local": stamp(monday + timedelta(days=14), "12:00"),
        "end_local": stamp(monday + timedelta(days=14), "13:00")})
    assert proposal.status_code == 201, proposal.text[:300]
    token = priya.post(f"/api/events/{sid}/share-link").json()["token"]
    before = event_of(priya, sid)
    trashed = trash(priya, sid, scope="all", occurrence_id=oid(sid, monday, "10:00"))
    assert httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_S).status_code == 404
    assert titled(priya, title, monday, monday + timedelta(days=40)) == []
    assert priya.get("/api/search", params={"q": title}).json()["results"] == []
    with screen(browser, app_url, "priya", "/trash") as page, \
            screen(browser, app_url, "priya", f"/calendar?view=week&date={iso(monday)}&calendars=cal-priya") as grid:
        expect(cell(grid, monday, "10:00")).to_have_count(1)
        expect(block(grid, title, "10:00", "11:00")).to_have_count(0)
        rows = role(page, "list", "Trash")
        expect(rows.get_by_role("listitem").filter(has_text=title)).to_contain_text(f"{2592000 // 86400} days left")
        click(button(page, f"Restore {title}"))
        once(page, f"Restored {title}.")
        expect(button(page, f"Restore {title}")).to_have_count(0)
        back = block(grid, title, "10:00", "11:00")
        expect(back).to_be_visible(timeout=LIVE_MS)
        on_slot(back, cell(grid, monday, "10:00"))
    after = event_of(priya, sid)
    for field in ("guests", "rsvp", "switches", "proposals", "exceptions", "share_link", "title", "rrule", "notes"):
        assert after[field] == before[field], field
    assert after["version"] != before["version"]
    assert httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_S).status_code == 200
    assert priya.post(f"/api/trash/{trashed}/restore").status_code == 409
    assert priya.post(f"/api/trash/{trashed}/restore").json()["error"] == "not_trashed"


def test_wf_trash_restore_one_occurrence(browser, app_url):
    priya, callum = api(app_url, "priya"), api(app_url, "callum")
    monday = fresh_monday()
    title = title_of("One")
    series = new_event(priya, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY, rrule="FREQ=WEEKLY;COUNT=4",
                       guest_ids=["p-callum"], switches=GUEST_ON)
    sid = series["id"]
    second = monday + timedelta(days=7)
    occurrence = oid(sid, second, "10:00")
    second_note = title_of("Second")
    save(priya, sid, scope="this", occurrence_id=occurrence, notes=second_note)
    assert reply(callum, sid, "maybe", occurrence).status_code == 200
    item = trash(priya, sid, scope="this", occurrence_id=occurrence)
    listed = {i["id"]: i for i in priya.get("/api/trash").json()["items"]}[item]
    assert listed["kind"] == "occurrence" and listed["occurrence_id"] == occurrence
    assert len(titled(priya, title, monday, monday + timedelta(days=30))) == 3
    assert priya.patch(f"/api/events/{sid}", headers=if_match(event_of(priya, sid)),
                       json={"scope": "this", "occurrence_id": occurrence, "notes": "Gone"}).status_code == 404
    series_item = trash(priya, sid, scope="all", occurrence_id=oid(sid, monday, "10:00"))
    blocked = priya.post(f"/api/trash/{item}/restore")
    assert blocked.status_code == 409 and blocked.json()["error"] == "parent_trashed"
    assert blocked.json()["message"] == "Restore the series first, then this occurrence."
    assert priya.post(f"/api/trash/{series_item}/restore").status_code == 200
    assert len(titled(priya, title, monday, monday + timedelta(days=30))) == 3
    with screen(browser, app_url, "priya", "/trash") as page:
        click(button(page, f"Restore {title}"))
        says(page, f"Restored {title}.")
    rows = {o["occurrence_id"]: o for o in titled(priya, title, monday, monday + timedelta(days=30))}
    assert rows[occurrence]["notes"] == second_note and len(rows) == 4
    assert answer_of(event_of(priya, sid, occurrence), "p-callum") == "maybe"
    assert answer_of(event_of(priya, sid, oid(sid, monday, "10:00")), "p-callum") == "invited"


def test_wf_trash_restore_purge(browser):
    base = short_url()
    joss = api(base, "joss")
    monday = fresh_monday()
    title = title_of("Purge")
    event = new_event(joss, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY)
    item = trash(joss, event["id"])
    listed = {i["id"]: i for i in joss.get("/api/trash").json()["items"]}.get(item)
    assert listed and listed["days_left"] == 1
    assert parse_utc(listed["purge_at"]) - parse_utc(listed["trashed_at"]) == timedelta(seconds=8)
    poll(lambda: item not in {i["id"] for i in joss.get("/api/trash").json()["items"]}, 20.0,
         "trash item purged within 5 seconds of its retention")
    assert joss.post(f"/api/trash/{item}/restore").status_code == 404
    assert joss.delete(f"/api/trash/{item}").status_code == 404
    assert joss.get("/api/search", params={"q": title}).json()["results"] == []
    assert titled(joss, title, monday, monday + timedelta(days=2)) == []
    assert not [t for t in notice_texts(joss) if title in t]
    with screen(browser, base, "joss", "/settings") as page:
        assert not [f for f in raw_frames(page) if title in f], "purged event left the change log payloads"
        by_hand = title_of("Forget")
        doomed = new_event(joss, by_hand, stamp(monday, "12:00"), stamp(monday, "13:00"), zone=NY)
        trash(joss, doomed["id"])
        page.goto(f"{base}/trash")
        listen(page)
        click(button(page, f"Delete {by_hand} for good"))
        says(page, f"Deleted {by_hand} for good.")
        expect(button(page, f"Restore {by_hand}")).to_have_count(0)
    assert joss.get("/api/search", params={"q": by_hand}).json()["results"] == []


def test_answers_follow_reply_rules(browser, app_url):
    yuki, callum, noor = api(app_url, "yuki"), api(app_url, "callum"), api(app_url, "noor")
    monday = fresh_monday()
    title = title_of("Replies")
    series = new_event(yuki, title, stamp(monday, "10:00"), stamp(monday, "11:00"), rrule="FREQ=WEEKLY;COUNT=3",
                       guest_ids=["p-callum", "p-noor"], switches=GUEST_ON)
    sid = series["id"]
    second = oid(sid, monday + timedelta(days=7), "10:00")
    assert event_of(yuki, sid)["rsvp"] == {"yes": 0, "no": 0, "maybe": 0, "invited": 2}
    assert reply(callum, sid, "no", second).json()["my_reply"]["answer"] == "no"
    assert reply(callum, sid, "yes").status_code == 200
    assert event_of(yuki, sid)["rsvp"] == {"yes": 1, "no": 0, "maybe": 0, "invited": 1}
    assert event_of(yuki, sid, second)["rsvp"] == {"yes": 0, "no": 1, "maybe": 0, "invited": 1}
    assert reply(noor, sid, "maybe", second).status_code == 200
    assert answer_of(event_of(yuki, sid), "p-noor") == "invited"
    refused = reply(callum, sid, "invited")
    assert refused.status_code == 422 and refused.json()["error"]
    not_guest = reply(yuki, sid, "yes")
    assert not_guest.status_code == 403 and not_guest.json()["error"] == "not_a_guest"
    hidden_title = title_of("Hidden replies")
    hidden = new_event(yuki, hidden_title, stamp(monday, "12:00"), stamp(monday, "13:00"),
                       guest_ids=["p-callum", "p-noor"], switches=GUEST_OFF)
    assert reply(callum, hidden["id"], "yes").status_code == 200
    seen_by_noor = event_of(noor, hidden["id"])
    assert "guests" not in seen_by_noor and "rsvp" not in seen_by_noor
    assert NAMES["callum"] not in json.dumps(seen_by_noor)
    with screen(browser, app_url, "dara", f"/events/evt-partners-weekly?occurrence={oid('evt-partners-weekly', '2027-03-09', '09:00')}") as page:
        expect(role(page, "region", "Answers")).to_contain_text("1 yes, 0 no, 1 maybe, 1 waiting")
        expect(role(page, "list", "Guests")).to_contain_text("Ines Okafor: Yes")
    assert answer_of(event_of(api(app_url, "dara"), "evt-partners-weekly", oid("evt-partners-weekly", "2027-03-16", "09:00")), "p-tane") == "no"


def test_wf_guests_and_replies_answer_live(browser, app_url):
    yuki, callum = api(app_url, "yuki"), api(app_url, "callum")
    monday = fresh_monday()
    title = title_of("Live answers")
    event = new_event(yuki, title, stamp(monday, "10:00"), stamp(monday, "11:00"), guest_ids=["p-callum"], switches=GUEST_ON)
    path = f"/events/{event['id']}"
    with screen(browser, app_url, "yuki", path) as organiser, screen(browser, app_url, "callum", path) as guest:
        expect(role(organiser, "region", "Answers")).to_contain_text(counts_line(0, 0, 0, 1))
        organiser.evaluate("window.__same = true")
        click(radio(role(guest, "radiogroup", "Your answer"), "Yes"))
        says(guest, "Your answer is saved: Yes.")
        expect(role(organiser, "region", "Answers")).to_contain_text(counts_line(1, 0, 0, 0), timeout=LIVE_MS)
        expect(role(organiser, "list", "Guests")).to_contain_text("Callum Reyes: Yes", timeout=LIVE_MS)
        assert organiser.evaluate("window.__same === true"), "the organiser's page updated in place"
    assert answer_of(event_of(yuki, event["id"]), "p-callum") == "yes"
    assert event_of(callum, event["id"])["my_reply"]["answer"] == "yes"


def test_wf_guests_and_replies_invitation(browser, app_url):
    yuki = api(app_url, "yuki")
    lia = api(app_url, "lia")
    monday = fresh_monday()
    title = title_of("Invite")
    event = new_event(yuki, title, stamp(monday, "22:00"), stamp(monday, "23:00"), switches=GUEST_OFF)
    tuesday = iso(monday + timedelta(days=1))
    with screen(browser, app_url, "lia", f"/calendar?view=week&date={tuesday}") as page:
        expect(cell(page, tuesday, "09:00")).to_have_count(1)
        page.evaluate("window.__same = true")
        answer = yuki.post(f"/api/events/{event['id']}/guests", json={"person_ids": ["p-lia"]})
        assert answer.status_code == 200
        expect(block(page, title, "11:00", "12:00")).to_be_visible(timeout=LIVE_MS)
        once(page, f"Yuki Tamblyn invited you to {title}.")
        assert page.evaluate("window.__same === true")
        click(button(page, "Notices"))
        expect(role(dialog(page, "Notices"), "list", "Notices")).to_contain_text(f"Yuki Tamblyn invited you to {title}.")
    assert notice_texts(lia).count(f"Yuki Tamblyn invited you to {title}.") == 1
    assert answer_of(event_of(yuki, event["id"]), "p-lia") == "invited"


def test_one_live_connection(browser, app_url):
    assert httpx.get(f"{app_url}/api/live?after=0", timeout=HTTP_S).status_code == 401
    edith = api(app_url, "edith")
    monday = fresh_monday()
    flags, routes = {}, []
    path = f"/calendar?view=week&date={iso(monday)}&calendars=cal-edith"
    with screen(browser, app_url, "edith", path, before=prepare_ws(flags, routes)) as page:
        poll(lambda: page.evaluate("window.__ws.opened") >= 1, ACT_S, "page opened its WebSocket")
        title = title_of("Before drop")
        new_event(edith, title, stamp(monday, "10:00"), stamp(monday, "11:00"))
        expect(block(page, title, "10:00", "11:00")).to_be_visible(timeout=LIVE_MS)
        spy = page.evaluate("window.__ws")
        assert spy["opened"] == 1, "one page holds one WebSocket"
        assert spy["early"] == 0, "nothing is sent before the socket opens"
        frames = [json.loads(f) for f in spy["frames"]]
        assert frames and all({"seq", "type", "data"} <= set(f) for f in frames)
        seqs = [f["seq"] for f in frames]
        assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
        last = seqs[-1]
        flags["refuse"] = True
        routes[-1].close()
        see_copy(page, "Reconnecting. Changes will catch up.")
        missed = title_of("During drop")
        new_event(edith, missed, stamp(monday, "12:00"), stamp(monday, "13:00"))
        flags["refuse"] = False
        expect(block(page, missed, "12:00", "13:00")).to_be_visible(timeout=10000)
        no_copy(page, "Reconnecting. Changes will catch up.")
        spy = page.evaluate("window.__ws")
        resumed = parse_qs(urlparse(spy["urls"][-1]).query)["after"][0]
        assert int(resumed) >= last, "the reconnect names its last seq"
        assert any(missed in f for f in spy["frames"]), "the missed change arrived as a replayed message"


def test_focus_across_redraw(browser, app_url):
    joss = api(app_url, "joss")
    monday = fresh_monday()
    title, other = title_of("Redraw"), title_of("Other")
    event = new_event(joss, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY)
    second = new_event(joss, other, stamp(monday, "14:00"), stamp(monday, "15:00"), zone=NY)
    with screen(browser, app_url, "joss", f"/calendar?view=week&date={iso(monday)}&calendars=cal-joss") as page:
        item = block(page, title, "10:00", "11:00")
        item.focus()
        expect(item).to_be_focused()
        save(joss, event["id"], start_local=stamp(monday, "13:00"), end_local=stamp(monday, "14:00"))
        moved = block(page, title, "13:00", "14:00")
        expect(moved).to_be_focused(timeout=LIVE_MS)
        in_view(moved)
        trash(joss, event["id"])
        expect(cell(page, monday, "13:00")).to_be_focused(timeout=LIVE_MS)
        third = block(page, other, "14:00", "15:00")
        third.focus()
        page.keyboard.press("Enter")
        quick = dialog(page, other)
        expect(quick).to_be_visible()
        inside = quick.evaluate("d => d.contains(document.activeElement)")
        assert inside
        save(joss, second["id"], location="Harbour")
        expect(quick).to_be_visible()
        assert quick.evaluate("d => d.contains(document.activeElement)"), "a live change never moves focus out of a dialog"


def test_proposal_state_rules(app_url):
    noor, priya = api(app_url, "noor"), api(app_url, "priya")
    monday = fresh_monday()
    title = title_of("Proposal")
    series = new_event(noor, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY, rrule="FREQ=WEEKLY;COUNT=3",
                       guest_ids=["p-priya"], switches=GUEST_ON)
    sid = series["id"]
    occurrence = oid(sid, monday, "10:00")
    body = {"occurrence_id": occurrence, "start_local": stamp(monday, "12:00"), "end_local": stamp(monday, "13:00")}
    organiser = noor.post(f"/api/events/{sid}/proposals", json=body)
    assert organiser.status_code == 403 and organiser.json()["error"] == "not_a_guest"
    missing = priya.post(f"/api/events/{sid}/proposals", json={k: v for k, v in body.items() if k != "occurrence_id"})
    assert missing.status_code == 422
    first = priya.post(f"/api/events/{sid}/proposals", json=body)
    assert first.status_code == 201 and first.json()["status"] == "proposed"
    second = priya.post(f"/api/events/{sid}/proposals", json=body)
    assert second.status_code == 409 and second.json()["error"] == "proposal_open"
    assert second.json()["message"] == "You already have an open proposal for this time."
    assert priya.post(f"/api/proposals/{first.json()['id']}/accept").status_code == 403
    declined = noor.post(f"/api/proposals/{first.json()['id']}/decline")
    assert declined.status_code == 200 and declined.json()["proposal"]["status"] == "declined"
    assert occ_at(noor, title, iso(monday))["start_local"] == stamp(monday, "10:00"), "declining moves nothing"
    assert noor.post(f"/api/proposals/{first.json()['id']}/accept").json()["error"] == "proposal_decided"
    assert priya.post(f"/api/events/{sid}/proposals", json=body).status_code == 201, "a declined proposal closes the slot"
    alone_title = title_of("Single")
    alone = new_event(noor, alone_title, stamp(monday, "14:00"), stamp(monday, "15:00"), zone=NY, guest_ids=["p-priya"])
    single = priya.post(f"/api/events/{alone['id']}/proposals",
                        json={"start_local": stamp(monday, "15:00"), "end_local": stamp(monday, "16:00")})
    assert single.status_code == 201
    assert single.json()["id"] in {p["id"] for p in event_of(noor, alone["id"])["proposals"]}


def test_wf_propose_a_new_time_accept(browser, app_url):
    noor, priya = api(app_url, "noor"), api(app_url, "priya")
    monday = fresh_monday()
    title = title_of("Accept")
    series = new_event(noor, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY, rrule="FREQ=WEEKLY;COUNT=3",
                       guest_ids=["p-priya"], switches=GUEST_ON)
    sid = series["id"]
    second = monday + timedelta(days=7)
    occurrence = oid(sid, second, "10:00")
    path = f"/events/{sid}?occurrence={occurrence}"
    with screen(browser, app_url, "noor", path) as organiser, screen(browser, app_url, "priya", path) as guest, \
            screen(browser, app_url, "noor", f"/calendar?view=week&date={iso(second)}&calendars=cal-noor") as grid:
        click(radio(role(guest, "radiogroup", "Answer for"), "This event"))
        click(radio(role(guest, "radiogroup", "Your answer"), "Maybe"))
        says(guest, "Your answer is saved: Maybe.")
        watched = block(grid, title, "10:00", "11:00")
        watched.focus()
        expect(watched).to_be_focused()
        opener = button(guest, "Propose a new time")
        opener.focus()
        guest.keyboard.press("Enter")
        form = dialog(guest, "Propose a new time")
        expect(form).to_be_visible()
        guest.keyboard.press("Escape")
        expect(form).to_have_count(0)
        expect(opener).to_be_focused()
        click(opener)
        form = dialog(guest, "Propose a new time")
        fill(textbox(form, "Starts"), typed(second, "10:30"))
        fill(textbox(form, "Ends"), typed(second, "11:30"))
        fill(textbox(form, "Note"), EARLIER)
        click(button(form, "Send proposal"))
        says(guest, f"Your proposal for {title} is sent.")
        expect(button(guest, "Accept")).to_have_count(0)
        expect(button(role(organiser, "list", "Proposed times"), "Accept")).to_be_visible(timeout=LIVE_MS)
        says(organiser, f"Priya Venn proposed 10:30 New York for {title}.", LIVE_MS / 1000)
        click(button(role(organiser, "list", "Proposed times"), "Accept"))
        decision = f"Proposal accepted: {title} moves to 10:30 New York."
        once(organiser, decision)
        once(guest, decision)
        landed = block(grid, title, "10:30", "11:30")
        expect(landed).to_be_focused(timeout=LIVE_MS)
        on_slot(landed, cell(grid, second, "10:30"))
    moved = occ_at(noor, title, iso(second))
    assert moved["start_local"] == stamp(second, "10:30") and moved["is_exception"] is True
    assert occ_at(noor, title, iso(monday))["start_local"] == stamp(monday, "10:00")
    assert occ_at(noor, title, iso(monday + timedelta(days=14)))["start_local"].endswith("10:00")
    assert answer_of(event_of(noor, sid, occurrence), "p-priya") == "yes"
    assert notice_texts(priya).count(decision) == 1


def test_wf_propose_a_new_time_simultaneous(app_url):
    noor, priya, marit_free = api(app_url, "noor"), api(app_url, "priya"), api(app_url, "joss")
    assert marit_free
    monday = fresh_monday()
    title = title_of("Race")
    event = new_event(noor, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY, guest_ids=["p-priya"])
    proposal = priya.post(f"/api/events/{event['id']}/proposals",
                          json={"start_local": stamp(monday, "12:00"), "end_local": stamp(monday, "13:00")}).json()
    paths = [f"/api/proposals/{proposal['id']}/{'accept' if i % 2 else 'decline'}" for i in range(6)]
    with ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda p: noor.post(p), paths))
    codes = sorted(a.status_code for a in answers)
    assert codes == [200, 409, 409, 409, 409, 409], codes
    assert all(a.json()["error"] == "proposal_decided" for a in answers if a.status_code == 409)
    winner = next(a for a in answers if a.status_code == 200).json()["proposal"]["status"]
    expected = "12:00" if winner == "accepted" else "10:00"
    assert event_of(noor, event["id"])["start_local"] == stamp(monday, expected)
    decisions = [t for t in notice_texts(noor) if title in t and t.startswith("Proposal ")]
    assert len(decisions) == 1, decisions


def test_moved_times_reopen_replies(app_url):
    noor, priya, callum = api(app_url, "noor"), api(app_url, "priya"), api(app_url, "callum")
    monday = fresh_monday()
    title = title_of("Reopen")
    event = new_event(noor, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY,
                      guest_ids=["p-priya", "p-callum"], switches=GUEST_ON)
    eid = event["id"]
    assert reply(priya, eid, "yes").status_code == 200 and reply(callum, eid, "no").status_code == 200
    save(noor, eid, location="Same time")
    assert answer_of(event_of(noor, eid), "p-priya") == "yes", "only a time change reopens replies"
    save(noor, eid, start_local=stamp(monday, "11:00"), end_local=stamp(monday, "12:00"))
    after = event_of(noor, eid)
    assert answer_of(after, "p-priya") == "invited" and answer_of(after, "p-callum") == "invited"
    assert reply(priya, eid, "maybe").status_code == 200 and reply(callum, eid, "yes").status_code == 200
    proposal = priya.post(f"/api/events/{eid}/proposals",
                          json={"start_local": stamp(monday, "13:00"), "end_local": stamp(monday, "14:00")}).json()
    assert noor.post(f"/api/proposals/{proposal['id']}/accept").status_code == 200
    after = event_of(noor, eid)
    assert answer_of(after, "p-priya") == "yes" and answer_of(after, "p-callum") == "invited"
    tuesday = monday + timedelta(days=1)
    new_event(callum, "Out of office", iso(tuesday), iso(tuesday), kind="away", zone=NY, decline_message=AWAY_DAY)
    save(noor, eid, start_local=stamp(tuesday, "10:00"), end_local=stamp(tuesday, "11:00"))
    moved = next(g for g in event_of(noor, eid)["guests"] if g["person_id"] == "p-callum")
    assert moved["answer"] == "no" and moved["message"] == AWAY_DAY
    assert answer_of(event_of(noor, eid), "p-priya") == "invited"


def test_automatic_decline_rules(app_url):
    noor, edith = api(app_url, "noor"), api(app_url, "edith")
    monday = fresh_monday()
    tuesday, wednesday = monday + timedelta(days=1), monday + timedelta(days=2)
    away = new_event(edith, "Out of office", iso(tuesday), iso(tuesday), kind="away", decline_message=BACK_SOON)
    focus = new_event(edith, "Focus time", stamp(wednesday, "09:00"), stamp(wednesday, "12:00"), kind="focus")
    assert focus["decline_mode"] == "new_and_existing"
    long_message = {"calendar_id": "cal-edith", "title": "Out of office", "kind": kind_value(app_url, "away"), "all_day": True,
                    "start_local": iso(tuesday), "end_local": iso(tuesday), "zone": LDN, "decline_message": "x" * 201}
    assert edith.post("/api/events", json=long_message).status_code == 422
    title = title_of("Daily")
    series = new_event(noor, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=LDN, rrule="FREQ=DAILY;COUNT=3",
                       guest_ids=["p-edith"], switches=GUEST_ON)
    sid = series["id"]
    answers = {d: next(g for g in event_of(noor, sid, oid(sid, d, "10:00"))["guests"] if g["person_id"] == "p-edith")
               for d in (monday, tuesday, wednesday)}
    assert answers[monday]["answer"] == "invited"
    assert answers[tuesday]["answer"] == "no" and answers[tuesday]["message"] == BACK_SOON
    assert answers[wednesday]["answer"] == "no"
    assert answers[wednesday]["message"] == f"Edith Sarr is in focus time until 12:00, so {title} was declined automatically."
    touching = title_of("Touching")
    edge = new_event(noor, touching, stamp(wednesday, "12:00"), stamp(wednesday, "13:00"), zone=LDN, guest_ids=["p-edith"], switches=GUEST_ON)
    assert answer_of(event_of(noor, edge["id"]), "p-edith") == "invited", "shared endpoints do not overlap"
    save(noor, edge["id"], start_local=stamp(wednesday, "11:00"), end_local=stamp(wednesday, "12:30"))
    assert answer_of(event_of(noor, edge["id"]), "p-edith") == "no", "moving into a window declines"
    assert reply(edith, edge["id"], "yes").status_code == 200
    assert answer_of(event_of(noor, edge["id"]), "p-edith") == "yes", "an automatic no can be changed afterward"
    trash(edith, away["id"])
    still = next(g for g in event_of(noor, sid, oid(sid, tuesday, "10:00"))["guests"] if g["person_id"] == "p-edith")
    assert still["answer"] == "no", "removing a window restores nothing"
    own = new_event(edith, title_of("Own"), stamp(wednesday, "09:30"), stamp(wednesday, "10:30"))
    assert own["id"] and not event_of(edith, own["id"])["guests"]


def test_wf_out_of_office_focus_invite_declined(browser, app_url):
    noor, tane = api(app_url, "noor"), api(app_url, "tane")
    title = title_of("Away week")
    event = new_event(noor, title, "2027-03-17T10:00", "2027-03-17T11:00", zone=NY, switches=GUEST_ON)
    copy = f"Tane Whitcombe is out of office until Fri 19 Mar 2027, so {title} was declined automatically."
    flags_a, routes_a, flags_b, routes_b = {}, [], {}, []
    with screen(browser, app_url, "noor", f"/events/{event['id']}", before=prepare_ws(flags_a, routes_a)) as organiser, \
            screen(browser, app_url, "tane", "/calendar?view=week&date=2027-03-15", before=prepare_ws(flags_b, routes_b)) as guest:
        poll(lambda: routed(organiser, routes_a) and routed(guest, routes_b), ACT_S, "both pages opened a WebSocket")
        organiser.evaluate("window.__same = true")
        select(combo(organiser, "Invite person"), NAMES["tane"])
        click(button(organiser, "Invite"))
        expect(role(organiser, "list", "Guests")).to_contain_text("Tane Whitcombe: No", timeout=LIVE_MS)
        expect(role(organiser, "region", "Answers")).to_contain_text(counts_line(0, 1, 0, 0), timeout=LIVE_MS)
        once(organiser, copy)
        once(guest, copy)
        assert organiser.evaluate("window.__same === true")
        for routes, page in ((routes_a, organiser), (routes_b, guest)):
            opened = page.evaluate("window.__ws.opened")
            routes[-1].close()
            poll(lambda: page.evaluate("window.__ws.opened") > opened, 10.0, "page reconnected after a drop")
            no_copy(page, "Reconnecting. Changes will catch up.")
        once(organiser, copy, 3.0)
        once(guest, copy, 3.0)
    assert notice_texts(noor).count(copy) == 1 and notice_texts(tane).count(copy) == 1
    row = next(g for g in event_of(noor, event["id"])["guests"] if g["person_id"] == "p-tane")
    assert row["answer"] == "no" and row["message"] == copy


def test_wf_out_of_office_focus_modes(browser, app_url):
    noor, yuki = api(app_url, "noor"), api(app_url, "yuki")
    monday = fresh_monday()
    tuesday = monday + timedelta(days=1)
    title = title_of("Existing")
    meeting = new_event(noor, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=LDN, guest_ids=["p-yuki"], switches=GUEST_ON)
    assert reply(yuki, meeting["id"], "yes").status_code == 200
    calendar = calendar_name(yuki, "cal-yuki")
    with screen(browser, app_url, "noor", f"/events/{meeting['id']}") as organiser, \
            screen(browser, app_url, "yuki", f"/calendar?view=week&date={iso(monday)}") as owner:
        click(button(owner, "New event"))
        form = dialog(owner, "New event")
        fill(textbox(form, "Title"), "Focus time")
        select(combo(form, "Calendar"), calendar)
        select(combo(form, "Kind"), "Focus time")
        expect(radio(role(form, "radiogroup", "Decline"), "New and existing meetings")).to_be_checked()
        fill(textbox(form, "Starts"), typed(monday, "09:00"))
        fill(textbox(form, "Ends"), typed(monday, "12:00"))
        click(button(form, "Save"))
        says(owner, "Saved Focus time.")
        expect(role(organiser, "list", "Guests")).to_contain_text("Yuki Tamblyn: No", timeout=LIVE_MS)
        once(organiser, f"Yuki Tamblyn is in focus time until 12:00, so {title} was declined automatically.")
    second_title = title_of("Kept")
    kept = new_event(noor, second_title, stamp(tuesday, "10:00"), stamp(tuesday, "11:00"), zone=LDN, guest_ids=["p-yuki"], switches=GUEST_ON)
    assert reply(yuki, kept["id"], "maybe").status_code == 200
    new_event(yuki, "Focus time", stamp(tuesday, "09:00"), stamp(tuesday, "12:00"), kind="focus", decline_mode="new_only",
              rrule="FREQ=WEEKLY;COUNT=2")
    assert answer_of(event_of(noor, kept["id"]), "p-yuki") == "maybe", "only-new leaves existing answers"
    next_tuesday = tuesday + timedelta(days=7)
    fresh_invite = new_event(noor, title_of("New"), stamp(next_tuesday, "10:00"), stamp(next_tuesday, "11:00"), zone=LDN,
                             guest_ids=["p-yuki"], switches=GUEST_ON)
    assert answer_of(event_of(noor, fresh_invite["id"]), "p-yuki") == "no", "a repeating window declines a new invitation"


def test_wf_out_of_office_focus_conflicts(browser, app_url):
    noor, callum = api(app_url, "noor"), api(app_url, "callum")
    monday = fresh_monday()
    tuesday = monday + timedelta(days=1)
    title = title_of("Conflict")
    meeting = new_event(noor, title, stamp(tuesday, "10:00"), stamp(tuesday, "11:00"), zone=NY, guest_ids=["p-callum"], switches=GUEST_ON)
    assert reply(callum, meeting["id"], "yes").status_code == 200
    away = new_event(callum, "Out of office", iso(monday), iso(monday + timedelta(days=2)), kind="away", zone=NY, decline_message=ON_LEAVE)
    assert answer_of(event_of(noor, meeting["id"]), "p-callum") == "yes", "existing answers are not changed"
    listed = callum.get(f"/api/events/{away['id']}/conflicts").json()["conflicts"]
    assert [c["title"] for c in listed if c["event_id"] == meeting["id"]] == [title]
    assert next(c for c in listed if c["event_id"] == meeting["id"])["answer"] == "yes"
    assert noor.get(f"/api/events/{away['id']}/conflicts").status_code in (403, 404)
    with screen(browser, app_url, "noor", f"/events/{meeting['id']}") as organiser, \
            screen(browser, app_url, "callum", f"/events/{away['id']}") as owner:
        row = role(role(owner, "list", "Conflicts"), "radiogroup", f"{title} on {label(tuesday)}")
        expect(radio(row, "Yes")).to_be_checked()
        click(radio(row, "No"))
        expect(radio(row, "No")).to_be_checked()
        says(owner, "Your answer is saved: No.")
        expect(role(organiser, "list", "Guests")).to_contain_text("Callum Reyes: No", timeout=LIVE_MS)
    late = new_event(noor, title_of("Late"), stamp(tuesday, "14:00"), stamp(tuesday, "15:00"), zone=NY, guest_ids=["p-callum"], switches=GUEST_ON)
    row = next(g for g in event_of(noor, late["id"])["guests"] if g["person_id"] == "p-callum")
    assert row["answer"] == "no" and row["message"] == ON_LEAVE


def test_wf_find_a_time_book_earliest(browser, app_url):
    rafe, noor = api(app_url, "rafe"), api(app_url, "noor")
    monday = fresh_monday()
    new_event(noor, title_of("Blocking"), stamp(monday, "09:00"), stamp(monday, "10:00"), zone=NY)
    title = title_of("Booked")
    with screen(browser, app_url, "rafe", "/find") as page:
        select(combo(page, "People"), NAMES["noor"])
        fill(role(page, "spinbutton", "Minutes"), "30")
        fill(textbox(page, "From"), iso(monday))
        fill(textbox(page, "To"), iso(monday + timedelta(days=4)))
        slots = role(page, "list", "Slots")
        earliest = button(slots, f"Book {label(monday)} 15:00")
        expect(earliest).to_be_visible()
        for city in CITY.values():
            expect(slots).to_contain_text(city)
        expect(button(slots, f"Book {label(monday)} 14:30")).to_have_count(0)
        earliest.focus()
        page.keyboard.press("Enter")
        form = dialog(page, "New event")
        expect(form).to_be_visible()
        page.keyboard.press("Escape")
        expect(form).to_have_count(0)
        expect(earliest).to_be_focused()
        page.keyboard.press("Enter")
        form = dialog(page, "New event")
        expect(textbox(form, "Starts")).to_have_value(typed(monday, "15:00"))
        expect(textbox(form, "Ends")).to_have_value(typed(monday, "15:30"))
        fill(textbox(form, "Title"), title)
        select(combo(form, "Calendar"), calendar_name(rafe, "cal-rafe"))
        click(button(form, "Save"))
        says(page, f"Saved {title}.")
    created = occ_at(rafe, title, iso(monday))
    assert created, "booked event exists on its date"
    guests = event_of(rafe, created["event_id"])["guests"]
    assert [g["person_id"] for g in guests] == ["p-noor"], "booking adds the chosen people, never the caller"
    with screen(browser, app_url, "rafe", "/find") as page:
        select(combo(page, "People"), NAMES["lia"])
        fill(role(page, "spinbutton", "Minutes"), "480")
        fill(textbox(page, "From"), iso(monday + timedelta(days=5)))
        fill(textbox(page, "To"), iso(monday + timedelta(days=6)))
        see_copy(page, "No free time fits these people. Try a longer range.")


def test_find_a_time_rules(app_url):
    rafe, noor, oren = api(app_url, "rafe"), api(app_url, "noor"), api(app_url, "oren")
    monday = fresh_monday()
    query = {"people": "p-noor", "minutes": 30, "from": iso(monday), "to": iso(monday)}
    first = rafe.get("/api/find-a-time", params=query).json()
    assert parse_utc(first["slots"][0]["start_utc"]) == datetime(monday.year, monday.month, monday.day, 14, 0, tzinfo=timezone.utc)
    assert parse_utc(first["slots"][-1]["end_utc"]) == datetime(monday.year, monday.month, monday.day, 17, 30, tzinfo=timezone.utc)
    assert [c["city"] for c in first["slots"][0]["clocks"]] == ["New York", "London", "Auckland"]
    assert [b["person_id"] for b in first["busy"]] == ["p-noor", "p-rafe"]
    assert "title" not in json.dumps(first)
    invite = new_event(oren, title_of("Invited only"), stamp(monday, "14:00"), stamp(monday, "15:00"), zone=LDN, guest_ids=["p-noor"], switches=GUEST_ON)
    assert parse_utc(rafe.get("/api/find-a-time", params=query).json()["slots"][0]["start_utc"]).hour == 14, "invited blocks nothing"
    assert reply(noor, invite["id"], "yes").status_code == 200
    assert parse_utc(rafe.get("/api/find-a-time", params=query).json()["slots"][0]["start_utc"]).hour == 15, "yes blocks and endpoints touch"
    for bad in ({"minutes": 20}, {"minutes": 495}, {"to": iso(monday + timedelta(days=31))}):
        assert rafe.get("/api/find-a-time", params={**query, **bad}).status_code == 422, bad
    assert api(app_url, "sam").get("/api/find-a-time", params=query).status_code == 403


def test_wf_find_a_time_busy_blocks(browser, app_url):
    with screen(browser, app_url, "oren", "/find") as page:
        select(combo(page, "People"), NAMES["tane"])
        fill(role(page, "spinbutton", "Minutes"), "30")
        fill(textbox(page, "From"), "2027-03-15")
        fill(textbox(page, "To"), "2027-03-19")
        panel = role(role(page, "region", "Busy blocks"), "group", NAMES["tane"])
        images = panel.get_by_role("img")
        expect(images).to_have_count(5)
        names = re.findall(r'img "([^"]+)"', panel.aria_snapshot())
        assert names == [f"Busy {label(d)} 00:00 to 24:00" for d in
                         ("2027-03-15", "2027-03-16", "2027-03-17", "2027-03-18", "2027-03-19")]
        expect(role(page, "region", "Busy blocks")).not_to_contain_text("Out of office")
        for width, height in (DESKTOP, TABLET, PHONE):
            page.set_viewport_size({"width": width, "height": height})
            drawn(page)
    whole = api(app_url, "oren").get("/api/find-a-time", params={
        "people": "p-tane", "minutes": 30, "from": "2027-03-15", "to": "2027-03-19"}).json()["busy"][0]["blocks"]
    assert len(whole) == 1, "the response keeps a merged block whole; only the page cuts it"
    assert parse_utc(whole[0]["start_utc"]) == datetime(2027, 3, 14, 11, 0, tzinfo=timezone.utc)


def test_wf_find_a_time_midnight_phone(browser, app_url):
    noor = api(app_url, "noor")
    monday = fresh_monday()
    tuesday = monday + timedelta(days=1)
    new_event(noor, title_of("Night block"), stamp(monday, "05:00"), stamp(monday, "08:00"), zone=NY)
    with screen(browser, app_url, "oren", "/find", size=PHONE) as page:
        select(combo(page, "People"), NAMES["noor"])
        fill(role(page, "spinbutton", "Minutes"), "30")
        fill(textbox(page, "From"), iso(monday))
        fill(textbox(page, "To"), iso(tuesday))
        panel = role(role(page, "region", "Busy blocks"), "group", NAMES["noor"])
        expect(panel.get_by_role("img")).to_have_count(2)
        names = re.findall(r'img "([^"]+)"', panel.aria_snapshot())
        assert names == [f"Busy {label(monday)} 23:00 to 24:00", f"Busy {label(tuesday)} 00:00 to 02:00"], names
        drawn(page)
        slots = role(page, "list", "Slots")
        first = button(slots, f"Book {label(tuesday)} 09:00")
        expect(first).to_be_visible()
        found = box(first)
        assert found["width"] >= TARGET_PX and found["height"] >= TARGET_PX, "44 pixel target at phone width"
        first.focus()
        page.keyboard.press("Enter")
        form = dialog(page, "New event")
        expect(form).to_be_visible()
        page.keyboard.press("Escape")
        expect(form).to_have_count(0)
        expect(first).to_be_focused()


def test_private_reads_busy(browser, app_url):
    marit, joss, ines = api(app_url, "marit"), api(app_url, "joss"), api(app_url, "ines")
    for person in (marit, joss):
        event = event_of(person, "evt-pay-talk")
        assert event["access"] == "busy" and event["title"] == "Busy" and set(event) == BUSY_FIELDS
        assert "Partner pay talk" not in json.dumps(event) and "Confidential" not in json.dumps(event)
        assert person.get("/api/search", params={"q": "Partner pay"}).json()["results"] == []
    assert event_of(ines, "evt-pay-talk")["notes"] == "Confidential"
    client = event_of(joss, "evt-client-readout")
    assert client["title"] == "Busy" and client["access"] == "busy", "free/busy shows every event as Busy"
    export = marit.post(calendar_url("cal-dara", "/exports"))
    assert export.status_code == 201
    text = marit.get(f"/api/exports/{export.json()['id']}/file").text
    assert "SUMMARY:Busy" in text and "Partner pay talk" not in text and "Confidential" not in text
    path = "/calendar?view=week&date=2027-03-08&calendars=cal-dara"
    with screen(browser, app_url, "marit", path) as page:
        expect(block(page, "Busy", "19:00", "19:30")).to_have_count(1)
        expect(page.get_by_role("button", name=re.compile("Partner pay talk"))).to_have_count(0)
        block(page, "Busy", "19:00", "19:30").focus()
        page.keyboard.press("Enter")
        busy = dialog(page, "Busy")
        expect(button(busy, "Open event")).to_be_visible()
        expect(button(busy, "Edit")).to_have_count(0)
        expect(button(busy, "Delete")).to_have_count(0)
        expect(button(busy, "Duplicate")).to_have_count(0)
        assert "Confidential" not in page.content()


def test_share_level_authority(app_url):
    rafe, marit, priya, lia = api(app_url, "rafe"), api(app_url, "marit"), api(app_url, "priya"), api(app_url, "lia")
    set_share(rafe, "cal-rafe", "p-priya", "manage")
    set_share(marit, "cal-rafe", "p-callum", "edit")
    set_share(priya, "cal-rafe", "p-callum", "details")
    assert lia.put(share_url("cal-rafe", "p-callum"), json={"level": "edit"}).status_code in (403, 404)
    assert lia.get("/api/shares", params={"calendar_id": "cal-rafe"}).status_code == 403
    callum = api(app_url, "callum")
    assert callum.put(share_url("cal-rafe", "p-callum"), json={"level": "edit"}).status_code == 403
    assert callum.delete(share_url("cal-rafe", "p-callum")).status_code == 403
    assert priya.put(share_url("cal-rafe", "p-callum"), json={"level": "owner"}).status_code == 422
    levels = {s["person_id"]: s["level"] for s in rafe.get("/api/shares", params={"calendar_id": "cal-rafe"}).json()["shares"]}
    assert levels["p-callum"] == "details"
    assert marit.put(share_url("cal-holidays", "p-callum"), json={"level": "edit"}).status_code == 403


def test_wf_sharing_and_private_lowered_live(browser, app_url):
    yuki, callum, marit = api(app_url, "yuki"), api(app_url, "callum"), api(app_url, "marit")
    set_share(yuki, "cal-yuki", "p-callum", "edit")
    monday = fresh_monday()
    title = title_of("Lowered")
    event = new_event(yuki, title, stamp(monday, "15:00"), stamp(monday, "16:00"))
    assert event_of(callum, event["id"])["access"] == "full"
    name = calendar_name(marit, "cal-yuki") if any(c["id"] == "cal-yuki" for c in marit.get("/api/calendars").json()["calendars"]) else calendar_name(yuki, "cal-yuki")
    with screen(browser, app_url, "callum", f"/calendar?view=week&date={iso(monday)}&calendars=cal-yuki") as colleague, \
            screen(browser, app_url, "marit", "/sharing") as manager:
        watched = block(colleague, title, "10:00", "11:00")
        expect(watched).to_be_visible()
        watched.focus()
        select(combo(manager, "Calendar"), name)
        select(combo(manager, f"Level for {NAMES['callum']}"), "See only free/busy")
        says(manager, "Access saved.")
        expect(block(colleague, "Busy", "10:00", "11:00")).to_be_visible(timeout=LIVE_MS)
        expect(block(colleague, title, "10:00", "11:00")).to_have_count(0)
        expect(block(colleague, "Busy", "10:00", "11:00")).to_be_focused(timeout=LIVE_MS)
        says(colleague, f"Your access to {name} changed to See only free/busy.")
        stale = callum.patch(f"/api/events/{event['id']}", headers=if_match(event_of(yuki, event["id"])), json={"title": "Taken"})
        assert stale.status_code == 403, "the lowered level applies on the very next request"
        click(button(manager, f"Remove {NAMES['callum']}"))
        expect(block(colleague, "Busy", "10:00", "11:00")).to_have_count(0, timeout=LIVE_MS)
        expect(cell(colleague, monday, "10:00")).to_be_focused(timeout=LIVE_MS)
        says(colleague, f"You no longer have access to {name}.")
    assert callum.get(f"/api/events/{event['id']}").status_code == 404
    assert event_of(yuki, event["id"])["title"] == title


def test_wf_sharing_and_private_manage_level(browser, app_url):
    edith, noor, joss = api(app_url, "edith"), api(app_url, "noor"), api(app_url, "joss")
    set_share(edith, "cal-edith", "p-joss", "edit")
    monday = fresh_monday()
    title = title_of("Managed")
    event = new_event(edith, title, stamp(monday, "15:00"), stamp(monday, "16:00"))
    name = calendar_name(edith, "cal-edith")
    set_share(edith, "cal-edith", "p-noor", "manage")
    assert event_of(noor, event["id"])["access"] == "full", "manage includes edit access"
    with screen(browser, app_url, "joss", f"/calendar?view=week&date={iso(monday)}&calendars=cal-edith") as colleague, \
            screen(browser, app_url, "noor", "/sharing") as manager:
        expect(block(colleague, title, "10:00", "11:00")).to_be_visible()
        select(combo(manager, "Calendar"), name)
        select(combo(manager, f"Level for {NAMES['joss']}"), "See all details")
        says(manager, "Access saved.")
        says(colleague, f"Your access to {name} changed to See all details.")
        assert event_of(joss, event["id"])["access"] == "details"
    patched = noor.patch(calendar_url("cal-edith"), json={"default_reminders": [15]})
    assert patched.status_code == 200 and patched.json()["default_reminders"] == [15]
    assert edith.patch(calendar_url("cal-edith"), json={"default_reminders": []}).status_code == 200
    assert joss.patch(calendar_url("cal-edith"), json={"default_reminders": [5]}).status_code == 403
    assert joss.put(share_url("cal-edith", "p-noor"), json={"level": "details"}).status_code == 403
    assert edith.delete(share_url("cal-edith", "p-noor")).status_code == 204
    assert noor.put(share_url("cal-edith", "p-joss"), json={"level": "edit"}).status_code in (403, 404)
    assert noor.get(f"/api/events/{event['id']}").status_code == 404


def test_all_day_reminders(app_url):
    base = env_url("APP_FAST_CLOCK_URL")
    expected = {"marit": "2027-03-11T17:00:00Z", "dara": "2027-03-11T22:00:00Z", "tane": "2027-03-11T04:00:00Z"}
    for first, due in expected.items():
        person = api(base, first)

        def row() -> dict | None:
            items = person.get("/api/reminders", params={"from": "2027-03-12", "to": "2027-03-13"}).json()["reminders"]
            hits = [r for r in items if r["title"] == "London offsite"]
            return hits[0] if hits else None

        found = poll(row, ACT_S, f"reminder for London offsite listed for {first}")
        assert parse_utc(found["due_utc"]) == parse_utc(due), first
        poll(lambda: (row() or {}).get("status") == "fired", PRINT_S + 60, f"London offsite reminder fired for {first}")
        fired = row()
        late = parse_utc(fired["fired_at"]) - parse_utc(due)
        assert timedelta(0) <= late <= timedelta(hours=3), "fires within a real second or so at 3600x"
        assert notice_texts(person).count("Reminder: London offsite is tomorrow.") == 1
        assert not [r for r in person.get("/api/reminders", params={"from": "2027-03-26", "to": "2027-03-27"}).json()["reminders"]
                    if r["title"] == "Good Friday"], "holidays carry no reminders"


def soon(base: str, minutes: int, zone: str = LDN) -> tuple[str, str]:
    start = local_of(zone, server_now(base) + timedelta(minutes=minutes)).replace(second=0, microsecond=0)
    return start.strftime("%Y-%m-%dT%H:%M"), (start + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")


def reminder_rows(a: Api, title: str, on: str) -> list[dict]:
    d = day(on)
    answer = a.get("/api/reminders", params={"from": iso(d - timedelta(days=1)), "to": iso(d + timedelta(days=2))})
    assert answer.status_code == 200, answer.text[:200]
    return [r for r in answer.json()["reminders"] if r["title"] == title]


def test_wf_reminders_timed_fire(browser):
    base = env_url("APP_REMINDER_CLOCK_URL")
    edith = api(base, "edith")
    assert edith.patch(calendar_url("cal-edith"), json={"default_reminders": [30]}).status_code == 200
    title = title_of("Timed")
    with screen(browser, base, "edith", "/settings") as page:
        page.evaluate("window.__same = true")
        start, end = soon(base, 45)
        event = new_event(edith, title, start, end)
        assert event["reminders"] == [30]
        assert edith.patch(calendar_url("cal-edith"), json={"default_reminders": []}).status_code == 200
        assert event_of(edith, event["id"])["reminders"] == [30], "later list changes leave existing events alone"
        rows = reminder_rows(edith, title, start[:10])
        assert len(rows) == 1 and rows[0]["status"] == "scheduled"
        due = parse_utc(rows[0]["due_utc"])
        assert due == parse_utc(event["start_utc"]) - timedelta(minutes=30)
        region = role(page, "region", f"Reminder: {title}")
        expect(region).to_be_visible(timeout=30000)
        text = f"Reminder: {title} starts at {start[11:]} London."
        expect(region).to_contain_text(text)
        once(page, text)
        assert page.evaluate("window.__same === true"), "the reminder appeared without a reload"
    fired = reminder_rows(edith, title, start[:10])[0]
    assert fired["status"] == "fired"
    assert timedelta(0) <= parse_utc(fired["fired_at"]) - due <= timedelta(minutes=3)
    assert notice_texts(edith).count(text) == 1


def test_wf_reminders_snooze(browser):
    base = env_url("APP_REMINDER_CLOCK_URL")
    ines = api(base, "ines")
    title = title_of("Snooze")
    with screen(browser, base, "ines", "/settings") as page:
        start, end = soon(base, 45)
        event = new_event(ines, title, start, end, reminders=[30])
        row = reminder_rows(ines, title, start[:10])[0]
        early = ines.post(f"/api/reminders/{row['id']}/snooze", json={"minutes": 5})
        assert early.status_code == 409 and early.json()["error"] == "not_fired"
        region = role(page, "region", f"Reminder: {title}")
        expect(region).to_be_visible(timeout=30000)
        assert ines.post(f"/api/reminders/{row['id']}/snooze", json={"minutes": 7}).status_code == 422
        text = f"Reminder: {title} starts at {start[11:]} London."
        once(page, text)
        select(combo(region, "Snooze for"), "10 minutes")
        moment = server_now(base)
        click(button(region, "Snooze"))
        says(page, f"Snoozed {title} for 10 minutes.")
        snoozed = reminder_rows(ines, title, start[:10])[0]
        assert snoozed["status"] in ("snoozed", "fired")
        if snoozed["status"] == "snoozed":
            assert timedelta(minutes=9) <= parse_utc(snoozed["due_utc"]) - moment <= timedelta(minutes=13)
        poll(lambda: announce_count(page, text) >= 2, 30.0, "snoozed reminder announced once more")
        assert announce_count(page, text) == 2
    assert notice_texts(ines).count(text) == 2
    assert event["id"]


def test_wf_reminders_moved_on_grid(browser):
    base = env_url("APP_REMINDER_CLOCK_URL")
    rafe = api(base, "rafe")
    title = title_of("Moved reminder")
    start, end = soon(base, 75)
    event = new_event(rafe, title, start, end, reminders=[30])
    old_due = parse_utc(reminder_rows(rafe, title, start[:10])[0]["due_utc"])
    with screen(browser, base, "rafe", f"/calendar?view=week&date={start[:10]}&calendars=cal-rafe") as page:
        item = block(page, title, start[11:], end[11:]).first
        expect(item).to_be_visible()
        item.focus()
        saved_start = parse_utc(event["start_utc"])
        for step in range(1, 3):
            page.keyboard.press("Alt+ArrowDown")
            poll(lambda: parse_utc(event_of(rafe, event["id"])["start_utc"]) == saved_start + timedelta(minutes=15 * step), ACT_S,
                 "each press saves before the next")
            later = [(datetime.strptime(text, "%Y-%m-%dT%H:%M") + timedelta(minutes=15 * step)).strftime("%H:%M") for text in (start, end)]
            expect(block(page, title, later[0], later[1]).first).to_be_focused()
        new_due = old_due + timedelta(minutes=30)
        poll(lambda: parse_utc(reminder_rows(rafe, title, start[:10])[0]["due_utc"]) == new_due, ACT_S, "the pending reminder moved with the event")
        region = role(page, "region", f"Reminder: {title}")
        poll(lambda: server_now(base) >= old_due + timedelta(minutes=5), 60.0, "the old due time has passed")
        expect(region).to_have_count(0)
        assert reminder_rows(rafe, title, start[:10])[0]["status"] == "scheduled", "nothing fired at the old time"
        expect(region).to_be_visible(timeout=50000)
        moved_start = parse_utc(event_of(rafe, event["id"])["start_utc"])
        text = f"Reminder: {title} starts at {local_of(LDN, moved_start):%H:%M} London."
        once(page, text)
        expect(page.get_by_role("button", name=re.compile(f"^{re.escape(title)}, ")).first).to_be_focused()
    assert notice_texts(rafe).count(text) == 1


def test_moved_and_deleted_reminders(app_url):
    base = env_url("APP_REMINDER_CLOCK_URL")
    yuki, callum = api(base, "yuki"), api(base, "callum")
    title = title_of("Pending")
    start_dt = local_of(LDN, server_now(base) + timedelta(days=30)).replace(hour=10, minute=0, second=0, microsecond=0)
    on = iso(start_dt.date())
    event = new_event(yuki, title, stamp(on, "10:00"), stamp(on, "11:00"), reminders=[60], guest_ids=["p-callum"], switches=GUEST_ON)
    eid = event["id"]
    first = reminder_rows(yuki, title, on)
    assert len(first) == 1 and first[0]["status"] == "scheduled" and len(reminder_rows(callum, title, on)) == 1
    moved = save(yuki, eid, start_local=stamp(on, "12:00"), end_local=stamp(on, "13:00"))["event"]
    after = reminder_rows(yuki, title, on)[0]
    assert parse_utc(after["due_utc"]) - parse_utc(first[0]["due_utc"]) == timedelta(hours=2)
    assert parse_utc(after["due_utc"]) == parse_utc(moved["start_utc"]) - timedelta(minutes=60)
    assert reply(callum, eid, "no").status_code == 200
    gone = reminder_rows(callum, title, on)
    assert not gone or gone[0]["status"] == "cancelled", "a person answering no loses theirs"
    item = trash(yuki, eid)
    cancelled = reminder_rows(yuki, title, on)
    assert not cancelled or cancelled[0]["status"] == "cancelled"
    assert yuki.post(f"/api/trash/{item}/restore").status_code == 200
    restored = reminder_rows(yuki, title, on)
    assert len(restored) == 1 and restored[0]["status"] == "scheduled"
    assert parse_utc(restored[0]["due_utc"]) == parse_utc(after["due_utc"])


def test_wf_two_people_one_event_simultaneous_saves(app_url):
    dara_like = api(app_url, "priya")
    set_share(dara_like, "cal-priya", "p-joss", "edit")
    joss = api(app_url, "joss")
    monday = fresh_monday()
    event = new_event(dara_like, title_of("Race"), stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY)
    header = if_match(event)
    missing = joss.patch(f"/api/events/{event['id']}", json={"title": "No header"})
    assert missing.status_code == 428 and missing.json()["error"] == "version_required"
    people = [dara_like, joss] * 4

    def attempt(args):
        index, person = args
        return person.patch(f"/api/events/{event['id']}", headers=header, json={"title": f"Attempt {index}"})

    with ThreadPoolExecutor(len(people)) as pool:
        answers = list(pool.map(attempt, enumerate(people)))
    winners = [a for a in answers if a.status_code == 200]
    assert len(winners) == 1, [a.status_code for a in answers]
    title = winners[0].json()["event"]["title"]
    assert event_of(dara_like, event["id"])["title"] == title
    for loser in (a for a in answers if a.status_code != 200):
        assert loser.status_code == 412
        body = loser.json()
        assert body["error"] == "version_conflict" and body["current"]["title"] == title
        assert re.fullmatch(r"(Priya Venn|Joss Abernathy) saved this first\.", body["message"])
    assert winners[0].headers["ETag"] == f'"{winners[0].json()["event"]["version"]}"'


def conflict_setup(browser, app_url):
    owner = api(app_url, "oren")
    set_share(owner, "cal-oren", "p-noor", "edit")
    monday = fresh_monday()
    title = title_of("Conflict")
    event = new_event(owner, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=AKL)
    return owner, event, title


def test_wf_two_people_one_event_reapply(browser, app_url):
    owner, event, title = conflict_setup(browser, app_url)
    path = f"/events/{event['id']}"
    winner_title = f"{title} winner"
    with screen(browser, app_url, "oren", path) as first, screen(browser, app_url, "noor", path) as second:
        expect(textbox(second, "Title")).to_have_value(title)
        fill(textbox(second, "Location"), LOSER)
        fill(textbox(first, "Title"), winner_title)
        click(button(first, "Save"))
        says(first, f"Saved {winner_title}.")
        click(button(second, "Save"))
        conflict = dialog(second, "This event changed")
        expect(conflict).to_contain_text("Oren Castell saved this first. Their values are shown here.")
        expect(role(conflict, "list", "Winning values")).to_contain_text(winner_title)
        click(button(conflict, "Reapply my changes"))
        once(second, f"Saved {winner_title}.")
    final = event_of(owner, event["id"])
    assert final["title"] == winner_title and final["location"] == LOSER


def test_wf_two_people_one_event_keep_theirs(browser, app_url):
    owner, event, title = conflict_setup(browser, app_url)
    path = f"/events/{event['id']}"
    winner_title = f"{title} winner"
    with screen(browser, app_url, "noor", path) as second:
        expect(textbox(second, "Title")).to_have_value(title)
        fill(textbox(second, "Location"), LOSER)
        save(owner, event["id"], title=winner_title)
        version = event_of(owner, event["id"])["version"]
        click(button(second, "Save"))
        conflict = dialog(second, "This event changed")
        click(button(conflict, "Keep theirs"))
        says(second, f"Kept the saved values for {winner_title}.")
        expect(conflict).to_have_count(0)
    final = event_of(owner, event["id"])
    assert final["version"] == version and final["location"] != LOSER


def test_wf_two_people_one_event_socket_down(browser, app_url):
    owner, event, title = conflict_setup(browser, app_url)
    monday = day(event["start_local"][:10])
    sunday = monday - timedelta(days=1)
    flags, routes = {}, []
    path = f"/calendar?view=week&date={iso(sunday)}&calendars=cal-oren"
    with screen(browser, app_url, "noor", path, before=prepare_ws(flags, routes)) as page:
        item = block(page, title, "16:00", "17:00")
        expect(item).to_be_visible()
        poll(lambda: routed(page, routes), ACT_S, "page opened its WebSocket")
        flags["refuse"] = True
        routes[-1].close()
        see_copy(page, "Reconnecting. Changes will catch up.")
        save(owner, event["id"], start_local=stamp(monday, "12:00"), end_local=stamp(monday, "13:00"))
        item.focus()
        page.keyboard.press("Alt+ArrowDown")
        conflict = dialog(page, "This event changed")
        expect(conflict).to_contain_text("Oren Castell saved this first. Their values are shown here.")
        click(button(conflict, "Keep theirs"))
        says(page, f"Kept the saved values for {title}.")
        expect(conflict).to_have_count(0)
        winner = block(page, title, "18:00", "19:00")
        expect(winner).to_be_focused()
        on_slot(winner, cell(page, sunday, "18:00"))
        flags["refuse"] = False
        no_copy(page, "Reconnecting. Changes will catch up.", 10.0)
    assert event_of(owner, event["id"])["start_local"] == stamp(monday, "12:00")


def test_wf_drag_create_draft_new_event_dialog(browser, app_url):
    rafe, yuki = api(app_url, "rafe"), api(app_url, "yuki")
    set_share(rafe, "cal-rafe", "p-yuki", "details")
    monday = fresh_monday()
    title = title_of("Created")
    name = calendar_name(rafe, "cal-rafe")
    path = f"/calendar?view=week&date={iso(monday)}"
    with screen(browser, app_url, "rafe", path) as page, screen(browser, app_url, "yuki", f"{path}&calendars=cal-rafe") as reader:
        expect(cell(page, monday, "09:00")).to_have_count(1)
        expect(cell(reader, monday, "09:00")).to_have_count(1)
        page.keyboard.press("c")
        form = dialog(page, "New event")
        expect(form).to_be_visible()
        select(combo(form, "Calendar"), name)
        fill(textbox(form, "Title"), "")
        fill(textbox(form, "Starts"), "soon")
        click(button(form, "Save"))
        expect(form).to_contain_text("Use YYYY-MM-DD HH:MM.")
        fill(textbox(form, "Starts"), typed(monday, "11:00"))
        fill(textbox(form, "Ends"), typed(monday, "10:00"))
        click(button(form, "Save"))
        expect(form).to_contain_text("End must be after start.")
        link = form.get_by_role("link", name="Enter a title.")
        click(link)
        expect(textbox(form, "Title")).to_be_focused()
        page.keyboard.type(title)
        fill(textbox(form, "Ends"), typed(monday, "12:00"))
        button(form, "Save").focus()
        page.keyboard.press("Enter")
        once(page, f"Saved {title}.")
        expect(block(page, title, "11:00", "12:00")).to_be_visible()
        expect(block(reader, title, "11:00", "12:00")).to_be_visible(timeout=LIVE_MS)
        away_title = title_of("Away")
        click(button(page, "New event"))
        form = dialog(page, "New event")
        fill(textbox(form, "Title"), away_title)
        select(combo(form, "Calendar"), name)
        select(combo(form, "Kind"), "Out of office")
        check_all_day = role(form, "checkbox", "All day")
        check_all_day.check()
        fill(textbox(form, "Starts"), iso(monday + timedelta(days=2)))
        fill(textbox(form, "Ends"), iso(monday + timedelta(days=2)))
        fill(textbox(form, "Decline message"), THURSDAY)
        click(button(form, "Save"))
        says(page, f"Saved {away_title}.")
    created = occ_at(rafe, title, iso(monday))
    assert created and created["start_local"] == stamp(monday, "11:00") and created["zone"] == LDN
    away = occ_at(rafe, away_title, iso(monday + timedelta(days=2)))
    full = event_of(rafe, away["event_id"])
    assert full["kind"] == kind_value(app_url, "away") and full["decline_message"] == THURSDAY and full["all_day"] is True
    assert event_of(yuki, created["event_id"])["access"] == "details"


def test_wf_drag_create_draft_sketch_returns(browser, app_url):
    noor = api(app_url, "noor")
    noor.delete("/api/draft")
    monday = fresh_monday()
    half = title_of("Half")
    path = f"/calendar?view=week&date={iso(monday)}"
    with screen(browser, app_url, "noor", path) as page, screen(browser, app_url, "noor", path, keep_draft=True) as tab:
        expect(cell(tab, monday, "09:00")).to_have_count(1)
        top = box(cell(page, monday, "10:00"))
        lower = box(cell(page, monday, "11:00"))
        page.mouse.move(top["x"] + top["width"] / 2, top["y"] + 1)
        page.mouse.down()
        page.mouse.move(lower["x"] + lower["width"] / 2, lower["y"] + 1, steps=6)
        page.mouse.up()
        form = dialog(page, "New event")
        fill(textbox(form, "Title"), half)
        poll(lambda: (noor.get("/api/draft").json()["draft"] or {}).get("title") == half, ACT_S, "draft reached the server")
        expect(textbox(dialog(tab, "New event"), "Title")).to_have_value(half, timeout=LIVE_MS)
        assert half not in page.evaluate("JSON.stringify(localStorage) + JSON.stringify(sessionStorage)"), "no browser storage holds it"
        page.reload()
        form = dialog(page, "New event")
        expect(textbox(form, "Title")).to_have_value(half)
        expect(textbox(form, "Title")).to_be_focused()
        with screen(browser, app_url, "noor", path, keep_draft=True) as other:
            title_box = textbox(dialog(other, "New event"), "Title")
            expect(title_box).to_have_value(half)
            expect(title_box).to_be_focused()
        page.keyboard.press("Escape")
        expect(form).to_have_count(0)
        poll(lambda: noor.get("/api/draft").json()["draft"] is None, ACT_S, "Escape deleted the server draft")
        page.reload()
        expect(cell(page, monday, "09:00")).to_have_count(1)
        expect(dialog(page, "New event")).to_have_count(0)
    assert noor.get("/api/search", params={"q": half}).json()["results"] == []


def test_wf_drag_create_draft_drag_across_slots(browser, app_url):
    callum = api(app_url, "callum")
    callum.delete("/api/draft")
    monday = fresh_monday()
    title = title_of("Dragged")
    with screen(browser, app_url, "callum", f"/calendar?view=week&date={iso(monday)}") as page:
        expect(cell(page, monday, "10:00")).to_have_count(1)
        first = box(cell(page, monday, "10:00"))
        second = box(cell(page, monday, "11:00"))
        page.mouse.move(first["x"] + first["width"] / 2, first["y"] + 1)
        page.mouse.down()
        page.mouse.move(second["x"] + second["width"] / 2, second["y"] + 1, steps=6)
        page.mouse.up()
        form = dialog(page, "New event")
        expect(textbox(form, "Title")).to_be_focused()
        expect(textbox(form, "Starts")).to_have_value(typed(monday, "10:00"))
        ends = textbox(form, "Ends").input_value()
        assert ends in (typed(monday, "11:00"), typed(monday, "11:15")), f"end snapped to a 15-minute slot: {ends}"
        own = [o for o in rows_between(callum, monday, monday + timedelta(days=1)) if o["calendar_id"] == "cal-callum"]
        assert own == [], "nothing is created before Save"
        click(button(form, "Cancel"))
        poll(lambda: callum.get("/api/draft").json()["draft"] is None, ACT_S, "Cancel deleted the draft")
        page.mouse.move(first["x"] + first["width"] / 2, first["y"] + 1)
        page.mouse.down()
        page.mouse.move(second["x"] + second["width"] / 2, second["y"] + 1, steps=6)
        page.mouse.up()
        form = dialog(page, "New event")
        fill(textbox(form, "Title"), title)
        click(button(form, "Save"))
        says(page, f"Saved {title}.")
        end_time = ends[-5:]
        made = block(page, title, "10:00", end_time)
        expect(made).to_be_visible()
        focused = "e => e === document.activeElement"
        poll(lambda: made.evaluate(focused) or cell(page, monday, "10:00").evaluate(focused) or cell(page, monday, "11:00").evaluate(focused),
             ACT_S, "after Save focus is on the new block or on a slot the drag began or ended in")
        on_slot(made, cell(page, monday, "10:00"))
        rows = (int(end_time[:2]) * 60 + int(end_time[3:]) - 600) / 15
        assert abs(box(made)["height"] - row_height(page, monday) * rows) <= LANE_TOLERANCE, "the block's height follows its minutes"
        slot = cell(page, monday, "14:00")
        slot.focus()
        page.keyboard.press("Enter")
        again = dialog(page, "New event")
        expect(textbox(again, "Starts")).to_have_value(typed(monday, "14:00"))
        page.keyboard.press("Escape")
        expect(again).to_have_count(0)
        expect(slot).to_be_focused()
    saved = occ_at(callum, title, iso(monday))
    assert saved["zone"] == NY and saved["start_local"] == stamp(monday, "10:00")
    assert callum.get("/api/draft").json()["draft"] is None


def test_wf_move_resize_undo_drag_saves(browser, app_url):
    callum = api(app_url, "callum")
    monday = fresh_monday()
    title = title_of("Dragged block")
    event = new_event(callum, title, stamp(monday, "15:00"), stamp(monday, "16:00"), zone=LDN)
    tuesday = monday + timedelta(days=1)
    with screen(browser, app_url, "callum", f"/calendar?view=week&date={iso(monday)}&calendars=cal-callum") as page:
        item = block(page, title, "10:00", "11:00")
        expect(item).to_be_visible()
        step, across = row_height(page, monday), day_step(page, monday)
        drag_block(page, item, dx=across, dy=step * 2)
        says(page, f"Moved {title} to 10:30 New York.")
        quick = dialog(page, title)
        expect(quick).to_be_visible()
        assert quick.evaluate("d => d.contains(document.activeElement)"), "focus is inside the quick dialog"
        saved = event_of(callum, event["id"])
        assert saved["start_local"] == stamp(tuesday, "15:30") and saved["end_local"] == stamp(tuesday, "16:30") and saved["zone"] == LDN
        page.keyboard.press("Escape")
        moved = block(page, title, "10:30", "11:30")
        drag_block(page, moved, dy=step * 4, edge="bottom")
        says(page, f"Resized {title} to end at 12:30 New York.")
        page.keyboard.press("Escape")
        assert event_of(callum, event["id"])["end_local"] == stamp(tuesday, "17:30")
        version = event_of(callum, event["id"])["version"]
        longer = block(page, title, "10:30", "12:30")
        drag_block(page, longer, dy=step * 3, release=False)
        page.keyboard.press("Escape")
        page.mouse.up()
        expect(longer).to_be_visible()
        assert event_of(callum, event["id"])["version"] == version, "Escape during a drag saves nothing"
        drag_block(page, longer, dy=-step * 12, edge="bottom")
        says(page, "Events are at least 15 minutes long.")
    shortest = event_of(callum, event["id"])
    assert shortest["start_local"] == stamp(tuesday, "15:30") and shortest["end_local"] in (stamp(tuesday, "15:45"), stamp(tuesday, "17:30"))
    month_title = title_of("Chip")
    month = new_event(callum, month_title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY)
    with screen(browser, app_url, "callum", f"/calendar?view=month&date={iso(monday)}&calendars=cal-callum") as page:
        grid = role(page, "region", "Month grid")
        chip = button(grid, f"{month_title}, 10:00 to 11:00")
        expect(chip).to_be_visible()
        drag_block(page, chip, dx=box(grid)["width"] / 7, release=False)
        expect(page.get_by_role("group", name="Three clocks")).to_have_count(0)
        page.mouse.up()
        poll(lambda: event_of(callum, month["id"])["start_local"] == stamp(tuesday, "10:00"), ACT_S, "month chip changes the date only")


def test_three_clocks_ribbon(browser, app_url):
    callum = api(app_url, "callum")
    monday = fresh_monday()
    title, late, edge = title_of("Ribbon"), title_of("Late"), title_of("Edge")
    new_event(callum, title, stamp(monday, "09:00"), stamp(monday, "10:00"), zone=NY)
    tuesday = monday + timedelta(days=1)
    new_event(callum, late, stamp(tuesday, "12:15"), stamp(tuesday, "13:15"), zone=NY)
    new_event(callum, edge, stamp(monday + timedelta(days=2), "11:00"), stamp(monday + timedelta(days=2), "12:00"), zone=NY)
    with screen(browser, app_url, "callum", f"/calendar?view=week&date={iso(monday)}&calendars=cal-callum") as page:
        item = block(page, title, "09:00", "10:00")
        expect(item).to_be_visible()
        step = row_height(page, monday)
        page.evaluate(MOTION_HOOK)
        x, y = grip(item)
        freeze(page)
        page.mouse.move(x, y)
        page.mouse.down()
        clocks = page.get_by_role("group", name="Three clocks")
        expect(clocks).to_be_visible()
        path = motion(clocks, RIBBON_MAX_MS)
        assert path[0] != path[-1], "the ribbon travels out from beside the block"
        await_clocks(clocks, [("New York", "09:00", "inside"), ("London", "14:00", "inside"), ("Auckland", "03:00", "outside")])
        page.evaluate(MOTION_HOOK)
        page.mouse.move(x, y + step, steps=3)
        forward = [("New York", "09:15", "inside"), ("London", "14:15", "inside"), ("Auckland", "03:15", "outside")]
        await_clocks(clocks, forward)
        poll(lambda: motion_events(page) or animations(clocks), 3.0, "changed digits roll at the snap")
        rolled = [d for d in motion_events(page) if d > 0]
        assert not rolled or min(rolled) <= ROLL_MAX_MS, rolled
        page.mouse.move(x, y + step * 3, steps=3)
        await_clocks(clocks, [("New York", "09:45", "inside"), ("London", "14:45", "inside"), ("Auckland", "03:45", "outside")])
        page.mouse.move(x, y + step, steps=3)
        await_clocks(clocks, forward)
        page.mouse.move(x, y - step, steps=3)
        await_clocks(clocks, [("New York", "08:45", "outside"), ("London", "13:45", "inside"), ("Auckland", "02:45", "outside")])
        page.keyboard.press("Escape")
        page.mouse.up()
    with screen(browser, app_url, "callum", f"/calendar?view=week&date={iso(monday)}&calendars=cal-callum") as page:
        moving = block(page, late, "12:15", "13:15")
        expect(moving).to_be_visible()
        step = row_height(page, monday)
        drag_block(page, moving, dy=step, release=False)
        clocks = page.get_by_role("group", name="Three clocks")
        await_clocks(clocks, [("New York", "12:30", "inside"), ("London", "17:30", "outside"), ("Auckland", "06:30", "outside")])
        page.keyboard.press("Escape")
        page.mouse.up()
        ending = block(page, edge, "11:00", "12:00")
        drag_block(page, ending, dy=step * 2, edge="bottom", release=False)
        await_clocks(clocks, [("New York", "12:30", "inside"), ("London", "17:30", "inside"), ("Auckland", "06:30", "outside")])
        page.keyboard.press("Escape")
        page.mouse.up()


def test_wf_move_resize_undo_reduced_motion(browser, app_url):
    callum = api(app_url, "callum")
    monday = fresh_monday()
    title = title_of("Calm")
    new_event(callum, title, stamp(monday, "09:00"), stamp(monday, "10:00"), zone=NY)
    with screen(browser, app_url, "callum", f"/calendar?view=week&date={iso(monday)}&calendars=cal-callum", reduced=True) as page:
        item = block(page, title, "09:00", "10:00")
        expect(item).to_be_visible()
        step = row_height(page, monday)
        x, y = grip(item)
        page.mouse.move(x, y)
        page.mouse.down()
        clocks = page.get_by_role("group", name="Three clocks")
        expect(clocks).to_be_visible()
        page.evaluate(MOTION_HOOK)
        page.mouse.move(x, y + step, steps=3)
        await_clocks(clocks, [("New York", "09:15", "inside"), ("London", "14:15", "inside"), ("Auckland", "03:15", "outside")])
        says(page, "New York 09:15 inside working hours, London 14:15 inside working hours, Auckland 03:15 outside working hours.")
        assert [d for d in motion_events(page) if d > 0] == [], "numerals swap with no roll"
        assert animations(clocks) == []
        page.mouse.up()
        says(page, f"Moved {title} to 09:15 New York.")
        expect(dialog(page, title)).to_be_visible()


def test_three_clocks_settle(browser, app_url):
    joss = api(app_url, "joss")
    monday = fresh_monday()
    title = title_of("Settle")
    event = new_event(joss, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY)
    with screen(browser, app_url, "joss", f"/calendar?view=week&date={iso(monday)}&calendars=cal-joss") as page:
        item = block(page, title, "10:00", "11:00")
        expect(item).to_be_visible()
        drag_block(page, item, dy=row_height(page, monday) * 3)
        quick = dialog(page, title)
        settled = role(quick, "group", "Three clocks")
        expect(settled).to_be_visible()
        expect(page.get_by_role("group", name="Three clocks")).to_have_count(1)
        saved = event_of(joss, event["id"])
        assert saved["start_local"] == stamp(monday, "10:45")
        await_clocks(settled, api_clocks(saved))
        assert api_clocks(saved)[0] == ("New York", "10:45", "inside")
        expect(button(quick, "Open event")).to_be_visible()


def test_alt_arrow_moves(browser, app_url):
    rafe = api(app_url, "rafe")
    monday = fresh_monday()
    title = title_of("Keys")
    event = new_event(rafe, title, stamp(monday, "10:00"), stamp(monday, "10:30"))
    tuesday = monday + timedelta(days=1)
    with screen(browser, app_url, "rafe", f"/calendar?view=week&date={iso(monday)}&calendars=cal-rafe") as page:
        item = block(page, title, "10:00", "10:30")
        item.focus()
        page.keyboard.press("Alt+ArrowDown")
        says(page, f"Moved {title} to 10:15 London.")
        expect(block(page, title, "10:15", "10:45")).to_be_focused()
        expect(page.get_by_role("group", name="Three clocks")).to_be_visible()
        page.keyboard.press("Alt+ArrowUp")
        says(page, f"Moved {title} to 10:00 London.")
        expect(block(page, title, "10:00", "10:30")).to_be_focused()
        resting = block(page, title, "10:00", "10:30")
        monday_x = box(resting)["x"]
        page.keyboard.press("Alt+ArrowRight")
        poll(lambda: event_of(rafe, event["id"])["start_local"] == stamp(tuesday, "10:00"), ACT_S, "Alt+Right moved one day")
        poll(lambda: box(resting)["x"] > monday_x, LIVE_MS / 1000, "the block redrew on Tuesday")
        expect(resting).to_be_focused()
        page.keyboard.press("Alt+ArrowLeft")
        poll(lambda: event_of(rafe, event["id"])["start_local"] == stamp(monday, "10:00"), ACT_S, "Alt+Left moved one day")
        expect(block(page, title, "10:00", "10:30")).to_be_focused()
        page.keyboard.press("Alt+Shift+ArrowDown")
        says(page, f"Resized {title} to end at 10:45 London.")
        expect(block(page, title, "10:00", "10:45")).to_be_focused()
        page.keyboard.press("Alt+Shift+ArrowUp")
        says(page, f"Resized {title} to end at 10:30 London.")
        page.keyboard.press("Alt+Shift+ArrowUp")
        says(page, f"Resized {title} to end at 10:15 London.")
        page.keyboard.press("Alt+Shift+ArrowUp")
        says(page, "Events are at least 15 minutes long.")
    final = event_of(rafe, event["id"])
    assert final["start_local"] == stamp(monday, "10:00") and final["end_local"] == stamp(monday, "10:15")


def wraps(page: Page, box_dialog: Locator) -> None:
    box_dialog.evaluate("d => { window.__first = document.activeElement; }")
    assert box_dialog.evaluate("d => d.contains(document.activeElement)"), "first control holds focus on opening"
    returned = False
    for _ in range(40):
        page.keyboard.press("Tab")
        assert box_dialog.evaluate("d => d.contains(document.activeElement)"), "Tab stayed inside the dialog"
        if page.evaluate("document.activeElement === window.__first"):
            returned = True
            break
    assert returned, "Tab wrapped back to the first control"
    page.keyboard.press("Shift+Tab")
    assert box_dialog.evaluate("d => d.contains(document.activeElement)"), "Shift+Tab wrapped inside the dialog"


def test_dialog_focus(browser, app_url):
    oren = api(app_url, "oren")
    monday = fresh_monday()
    title = title_of("Dialogs")
    new_event(oren, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=AKL)
    with screen(browser, app_url, "oren", f"/calendar?view=week&date={iso(monday)}&calendars=cal-oren") as page:
        openers = (("New event", "New event"), ("Notices", "Notices"))
        for opener, name in openers:
            control = button(page, opener)
            control.focus()
            page.keyboard.press("Enter")
            box_dialog = dialog(page, name)
            expect(box_dialog).to_be_visible()
            wraps(page, box_dialog)
            page.keyboard.press("Escape")
            expect(box_dialog).to_have_count(0)
            expect(control).to_be_focused()
        today = button(page, "Next")
        today.focus()
        for key, name in (("g", "Go to date"), ("?", "Keyboard shortcuts")):
            page.keyboard.press(key)
            box_dialog = dialog(page, name)
            expect(box_dialog).to_be_visible()
            wraps(page, box_dialog)
            page.keyboard.press("Escape")
            expect(box_dialog).to_have_count(0)
            expect(today).to_be_focused()
        item = block(page, title, "10:00", "11:00")
        item.focus()
        page.keyboard.press("Enter")
        quick = dialog(page, title)
        expect(quick).to_be_visible()
        wraps(page, quick)
        page.keyboard.press("Escape")
        expect(quick).to_have_count(0)
        expect(item).to_be_focused()
    with screen(browser, app_url, "oren", f"/calendar?date={iso(monday)}", size=PHONE) as page:
        control = button(page, "Calendars")
        control.focus()
        page.keyboard.press("Enter")
        sheet = dialog(page, "Calendars")
        expect(sheet).to_be_visible()
        wraps(page, sheet)
        page.keyboard.press("Escape")
        expect(sheet).to_have_count(0)
        expect(control).to_be_focused()


def test_wf_move_resize_undo_undo(browser, app_url):
    lia, noor = api(app_url, "oren"), api(app_url, "noor")
    monday = fresh_monday()
    title = title_of("Undo")
    event = new_event(lia, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=AKL, guest_ids=["p-noor"], switches=GUEST_ON)
    eid = event["id"]
    assert reply(noor, eid, "yes").status_code == 200
    with screen(browser, app_url, "oren", f"/calendar?view=week&date={iso(monday)}&calendars=cal-oren") as page:
        item = block(page, title, "10:00", "11:00")
        item.focus()
        page.keyboard.press("Alt+ArrowDown")
        says(page, f"Moved {title} to 10:15 Auckland.")
        assert answer_of(event_of(lia, eid), "p-noor") == "invited"
        click(button(page, "Undo"))
        says(page, f"Undid the last change to {title}.")
        restored = event_of(lia, eid)
        assert restored["start_local"] == stamp(monday, "10:00") and answer_of(restored, "p-noor") == "yes"
        expect(item).to_be_visible()
        item.focus()
        page.keyboard.press("Alt+ArrowDown")
        says(page, f"Moved {title} to 10:15 Auckland.")
        block(page, title, "10:15", "11:15").focus()
        status(page).evaluate("el => { window.__wren = [el.textContent]; }")
        page.keyboard.press("z")
        poll(lambda: event_of(lia, eid)["start_local"] == stamp(monday, "10:00"), ACT_S, "Z undid the move")
        assert answer_of(event_of(lia, eid), "p-noor") == "yes"
        expect(item).to_be_visible()
        item.focus()
        page.keyboard.press("Delete")
        says(page, f"Moved {title} to trash.")
        expect(item).to_have_count(0)
        click(button(page, "Undo"))
        expect(item).to_be_visible()
        assert occ_at(lia, title, iso(monday)), "undoing a trash brings the event back"
        item.focus()
        page.keyboard.press("Alt+ArrowDown")
        moved_block = block(page, title, "10:15", "11:15")
        expect(moved_block).to_be_focused()
        undo = button(page, "Undo")
        expect(undo).to_be_visible()
        page.clock.run_for(UNDO_MS - 2000)
        expect(undo).to_be_visible()
        page.clock.run_for(2500)
        expect(undo).to_have_count(0)
        page.keyboard.press("z")
        deadline = time.monotonic() + REPLAY_WINDOW_S
        while time.monotonic() < deadline:
            assert event_of(lia, eid)["start_local"] == stamp(monday, "10:15"), "Z does nothing after 10 seconds"
    series_title = title_of("Undo series")
    series = new_event(lia, series_title, stamp(monday, "12:00"), stamp(monday, "13:00"), zone=AKL, rrule="FREQ=WEEKLY;COUNT=2")
    with screen(browser, app_url, "oren", f"/calendar?view=week&date={iso(monday)}&calendars=cal-oren") as page:
        item = block(page, series_title, "12:00", "13:00")
        item.focus()
        page.keyboard.press("Alt+ArrowDown")
        choose_scope(page, "This event")
        says(page, f"Moved {series_title} to 12:15 Auckland.")
        assert event_of(lia, series["id"])["exceptions"]
        click(button(page, "Undo"))
        says(page, f"Undid the last change to {series_title}.")
    assert event_of(lia, series["id"])["exceptions"] == [], "undo removes the exception it created"


def test_single_key_shortcuts(browser, app_url):
    lia = api(app_url, "lia")
    monday = fresh_monday()
    title = title_of("Shortcut")
    event = new_event(lia, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=AKL)
    path = f"/calendar?view=week&date={iso(monday)}&calendars=cal-lia"
    with screen(browser, app_url, "lia", path) as page:
        view = role(page, "radiogroup", "View")
        item = block(page, title, "10:00", "11:00")
        expect(item).to_be_visible()
        keys = (("1", "Day", "day"), ("d", "Day", "day"), ("3", "Month", "month"), ("M", "Month", "month"),
                ("4", "Custom days", "custom"), ("x", "Custom days", "custom"), ("5", "Schedule", "schedule"),
                ("a", "Schedule", "schedule"), ("2", "Week", "week"), ("w", "Week", "week"))
        for key, name, value in keys:
            button(page, "Today").focus()
            page.keyboard.press(key)
            expect(radio(view, name)).to_be_checked()
            expect(page).to_have_url(re.compile(f"view={value}"))
        for target in (lambda: item, lambda: cell(page, monday, "09:00")):
            target().focus()
            page.keyboard.press("3")
            expect(radio(view, "Month")).to_be_checked()
            page.keyboard.press("2")
            expect(radio(view, "Week")).to_be_checked()
            expect(item).to_be_visible()
        page.keyboard.press("j")
        expect(page).to_have_url(re.compile(f"date={iso(monday + timedelta(days=7))}"))
        page.keyboard.press("k")
        expect(page).to_have_url(re.compile(f"date={iso(monday)}"))
        page.keyboard.press("t")
        expect(page).to_have_url(re.compile(f"date={iso(local_of(AKL, server_now(app_url)).date())}"))
        page.keyboard.press("g")
        go = dialog(page, "Go to date")
        expect(go).to_be_visible()
        page.keyboard.press("3")
        expect(radio(view, "Week")).to_be_checked()
        fill(textbox(go, "Date"), iso(monday))
        click(button(go, "Go"))
        expect(item).to_be_visible()
        page.keyboard.press("c")
        form = dialog(page, "New event")
        expect(form).to_be_visible()
        textbox(form, "Title").focus()
        page.keyboard.press("m")
        expect(radio(view, "Week")).to_be_checked()
        expect(textbox(form, "Title")).to_have_value(re.compile("m$"))
        page.keyboard.press("Escape")
        expect(form).to_have_count(0)
        page.keyboard.press("?")
        expect(role(dialog(page, "Keyboard shortcuts"), "list", "Shortcuts").get_by_role("listitem").first).to_be_visible()
        page.keyboard.press("Escape")
        item.focus()
        page.keyboard.press("e")
        expect(page).to_have_url(re.compile(f"/events/{re.escape(event['id'])}"))
        page.goto(f"{app_url}{path}")
        expect(item).to_be_visible()
        page.keyboard.press("/")
        expect(page).to_have_url(re.compile("/search"))
        expect(role(page, "searchbox", "Search events")).to_be_focused()
        page.goto(f"{app_url}{path}")
        expect(item).to_be_visible()
        page.keyboard.press("s")
        expect(page).to_have_url(re.compile("/settings"))


def test_wf_views_shortcuts_address_reload_back_tab(browser, app_url):
    priya = api(app_url, "priya")
    monday = fresh_monday()
    title = title_of("Address")
    event = new_event(priya, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY)
    path = f"/calendar?view=week&date={iso(monday)}&calendars=cal-priya,cal-firm&event={event['id']}"
    with screen(browser, app_url, "priya", path) as page:
        quick = dialog(page, title)
        expect(quick).to_be_visible()
        page.reload()
        expect(quick).to_be_visible()
        tab = page.context.new_page()
        tab.goto(page.url)
        expect(dialog(tab, title)).to_be_visible()
        tab.close()
        page.keyboard.press("Escape")
        expect(quick).to_have_count(0)
        assert "event=" not in page.url
        page.go_back()
        expect(quick).to_be_visible()
        page.go_forward()
        expect(quick).to_have_count(0)
        click(radio(role(page, "radiogroup", "View"), "Month"))
        expect(page).to_have_url(re.compile("view=month"))
        assert parse_qs(urlparse(page.url).query)["calendars"] == ["cal-priya,cal-firm"]
        page.go_back()
        expect(radio(role(page, "radiogroup", "View"), "Week")).to_be_checked()
        page.go_forward()
        expect(radio(role(page, "radiogroup", "View"), "Month")).to_be_checked()
        page.goto(f"{app_url}/calendar?view=nonsense&date=nope")
        expect(role(page, "region", "Week grid")).to_be_visible()
        expect(cell(page, local_of(NY, server_now(app_url)).date(), "09:00")).to_have_count(1)
        page.goto(f"{app_url}/calendar?view=week&date=2027-03-08&calendars=cal-tane")
        expect(role(page, "region", "Week grid")).to_be_visible()
        expect(page.get_by_role("button", name=re.compile("^Harbour kickoff"))).to_have_count(0)
        page.goto(f"{app_url}/calendar?view=week&date=2027-03-08&event=evt-harbour-kickoff")
        listen(page)
        says(page, "That event is not available.")
    wide_path = f"/calendar?view=week&date={iso(monday)}"
    with screen(browser, app_url, "priya", wide_path, size=PHONE) as page:
        expect(role(page, "list", "Schedule")).to_be_visible()
        assert "view=week" in page.url, "the phone leaves the address unchanged"
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        page.reload()
        expect(role(page, "region", "Week grid")).to_be_visible()


def test_wf_views_shortcuts_address_personal_view(browser, app_url):
    bea = api(app_url, "bea")
    defaults = {"week_start": "monday", "hide_weekends": False, "custom_days": 4, "second_zone": None}
    assert bea.patch("/api/me", json=defaults).status_code == 200
    monday = fresh_monday()
    sunday = monday - timedelta(days=1)
    try:
        assert bea.patch("/api/me", json={"custom_days": 8}).status_code == 422
        assert bea.patch("/api/me", json={"custom_days": 1}).status_code == 422
        with screen(browser, app_url, "bea", f"/calendar?view=week&date={iso(monday)}") as grid, \
                screen(browser, app_url, "bea", "/settings") as settings:
            expect(cell(grid, monday, "09:00")).to_have_count(1)
            expect(cell(grid, sunday, "09:00")).to_have_count(0)
            select(combo(settings, "Week starts on"), "Sunday")
            click(button(settings, "Save settings"))
            says(settings, "Settings saved.")
            expect(cell(grid, sunday, "09:00")).to_have_count(1, timeout=LIVE_MS)
            role(settings, "checkbox", "Hide weekends").check()
            select(combo(settings, "Second zone"), "Auckland")
            fill(role(settings, "spinbutton", "Custom days"), "3")
            click(button(settings, "Save settings"))
            expect(cell(grid, sunday, "09:00")).to_have_count(0, timeout=LIVE_MS)
            expect(cell(grid, monday, "09:00")).to_have_count(1)
            expect(role(grid, "group", "Second zone Auckland")).to_be_visible(timeout=LIVE_MS)
        assert bea.get("/api/me").json()["custom_days"] == 3
        path = f"/calendar?view=custom&date={iso(monday)}"
        with screen(browser, app_url, "bea", path) as other:
            expect(role(other, "region", "Custom days grid")).to_be_visible()
            for offset, count in ((0, 1), (2, 1), (3, 0)):
                expect(cell(other, monday + timedelta(days=offset), "09:00")).to_have_count(count)
    finally:
        bea.patch("/api/me", json=defaults)


def test_wf_views_shortcuts_address_event_page_keys(browser, app_url):
    yuki = api(app_url, "yuki")
    monday = fresh_monday()
    title = title_of("Page keys")
    event = new_event(yuki, title, stamp(monday, "20:00"), stamp(monday, "21:00"))
    with screen(browser, app_url, "yuki", f"/events/{event['id']}") as page:
        page.evaluate("window.addEventListener('keydown', e => { if (e.key === 's') window.__prevented = e.defaultPrevented; })")
        fill(textbox(page, "Location"), "Harbour")
        textbox(page, "Location").focus()
        page.keyboard.press("Control+s")
        says(page, f"Saved {title}.")
        assert page.evaluate("window.__prevented") is True, "Ctrl+S never opens the browser's save prompt"
        assert event_of(yuki, event["id"])["location"] == "Harbour"
        fill(textbox(page, "Location"), "Dropped")
        textbox(page, "Location").focus()
        page.keyboard.press("Escape")
        expect(page).to_have_url(re.compile(r"/calendar\?.*focus="))
        query = parse_qs(urlparse(page.url).query)
        assert query["focus"] == [event["id"]] and query["date"] == [iso(monday)]
        item = block(page, title, "20:00", "21:00")
        expect(item).to_be_focused()
        in_view(item)
    assert event_of(yuki, event["id"])["location"] == "Harbour"


def test_slot_keyboard(browser, app_url):
    monday = fresh_monday()
    last = monday + timedelta(days=6)
    with screen(browser, app_url, "lia", f"/calendar?view=week&date={iso(monday)}&calendars=cal-lia") as page:
        expect(cell(page, monday, "09:00")).to_have_count(1)
        stops = page.get_by_role("gridcell").evaluate_all("els => els.filter(e => e.tabIndex === 0).length")
        assert stops == 1, "the time grid takes one Tab stop for its slots"
        tuesday = monday + timedelta(days=1)
        cell(page, monday, "09:00").focus()
        for key, d, hhmm in (("ArrowDown", monday, "09:15"), ("ArrowUp", monday, "09:00"), ("ArrowRight", tuesday, "09:00"),
                             ("ArrowLeft", monday, "09:00"), ("End", last, "09:00"), ("Home", monday, "09:00"),
                             ("Control+End", last, "23:45"), ("Control+Home", monday, "00:00")):
            page.keyboard.press(key)
            target = cell(page, d, hhmm)
            expect(target).to_be_focused()
            in_view(target)
        page.keyboard.press("Enter")
        form = dialog(page, "New event")
        expect(textbox(form, "Starts")).to_have_value(typed(monday, "00:00"))
        expect(textbox(form, "Ends")).to_have_value(typed(monday, "00:15"))
        page.keyboard.press("Escape")


def test_wf_overlap_midnight_more_lanes(browser, app_url):
    oren = api(app_url, "oren")
    monday = fresh_monday()
    token = title_of("Lane")
    names = {k: f"{token} {k}" for k in "ABCE"}
    new_event(oren, names["A"], stamp(monday, "10:00"), stamp(monday, "12:00"), zone=AKL)
    new_event(oren, names["B"], stamp(monday, "10:30"), stamp(monday, "11:30"), zone=AKL)
    third = new_event(oren, names["C"], stamp(monday, "11:00"), stamp(monday, "11:15"), zone=AKL)
    new_event(oren, names["E"], stamp(monday, "12:00"), stamp(monday, "13:00"), zone=AKL)
    with screen(browser, app_url, "oren", f"/calendar?view=week&date={iso(monday)}&calendars=cal-oren") as page:
        a, b, c = block(page, names["A"], "10:00", "12:00"), block(page, names["B"], "10:30", "11:30"), block(page, names["C"], "11:00", "11:15")
        e = block(page, names["E"], "12:00", "13:00")
        expect(c).to_be_visible()
        column = box(cell(page, monday, "09:00"))
        lane = column["width"] / 3
        step = row_height(page, monday)
        for index, item in enumerate((a, b, c)):
            found = box(item)
            assert abs(found["x"] - (column["x"] + lane * index)) <= LANE_TOLERANCE, f"lane {index} left edge"
            assert abs(found["width"] - lane) <= LANE_TOLERANCE, f"lane {index} width"
        assert abs(box(e)["width"] - column["width"]) <= LANE_TOLERANCE, "a shared endpoint does not join the group"
        assert abs(box(a)["y"] - box(cell(page, monday, "10:00"))["y"]) <= LANE_TOLERANCE
        assert abs(box(b)["y"] - box(cell(page, monday, "10:30"))["y"]) <= LANE_TOLERANCE
        assert abs(box(a)["height"] - step * 8) <= LANE_TOLERANCE and abs(box(b)["height"] - step * 4) <= LANE_TOLERANCE
        a.focus()
        trash(oren, third["id"])
        half = column["width"] / 2
        poll(lambda: abs(box(a)["width"] - half) <= LANE_TOLERANCE and abs(box(b)["x"] - (column["x"] + half)) <= LANE_TOLERANCE,
             LIVE_MS / 1000 + 1, "remaining events take new lanes when a change arrives live")
        expect(a).to_be_focused()


def test_wf_overlap_midnight_more_midnight_band(browser, app_url):
    rafe = api(app_url, "rafe")
    monday = fresh_monday()
    tuesday, wednesday = monday + timedelta(days=1), monday + timedelta(days=2)
    night, whole, full = title_of("Night"), title_of("Whole"), title_of("Day long")
    new_event(rafe, night, stamp(tuesday, "18:30"), stamp(tuesday, "19:30"), zone=NY)
    new_event(rafe, whole, iso(monday), iso(monday))
    new_event(rafe, full, stamp(wednesday, "10:00"), stamp(monday + timedelta(days=3), "10:00"))
    path = f"/calendar?date={iso(monday)}&calendars=cal-rafe"
    with screen(browser, app_url, "rafe", f"{path}&view=week") as page:
        parts = block(page, night, "23:30", "00:30")
        expect(parts).to_have_count(2)
        first, second = box(parts.nth(0)), box(parts.nth(1))
        assert abs(abs(second["x"] - first["x"]) - day_step(page, monday)) <= LANE_TOLERANCE, "one block on each of two days"
        band = role(page, "group", "All-day events")
        expect(all_day_block(band, whole) if False else button(band, f"{whole}, all day")).to_be_visible()
        expect(button(band, f"{full}, 10:00 to 10:00").first).to_be_visible()
        page.goto(f"{app_url}{path}&view=day")
        page.goto(f"{app_url}/calendar?date={iso(wednesday)}&calendars=cal-rafe&view=day")
        expect(block(page, night, "23:30", "00:30")).to_have_count(1)
        page.goto(f"{app_url}{path}&view=month")
        expect(button(role(page, "region", "Month grid"), f"{night}, 23:30 to 00:30")).to_have_count(2)
        page.goto(f"{app_url}{path}&view=schedule")
        expect(button(role(page, "list", "Schedule"), f"{night}, 23:30 to 00:30")).to_have_count(2)


def test_more_count_follows_height(browser, app_url):
    joss = api(app_url, "joss")
    monday = lone_month_monday()
    token = title_of("Crowd")
    total = 12
    for index in range(total):
        new_event(joss, f"{token} {index}", stamp(monday, f"{index + 8:02d}:00"), stamp(monday, f"{index + 8:02d}:30"), zone=NY)
    with screen(browser, app_url, "joss", f"/calendar?view=month&date={iso(monday)}&calendars=cal-joss") as page:
        grid = role(page, "region", "Month grid")
        more = grid.get_by_role("button", name=re.compile(r"^\+\d+ more$"))
        expect(more).to_have_count(1)
        drawn(page)

        def reading() -> tuple[int, int]:
            shown = grid.get_by_role("button", name=re.compile(re.escape(token))).count()
            found = re.search(r'button "\+(\d+) more"', grid.aria_snapshot())
            return shown, int(found[1]) if found else 0

        page.evaluate("window.__same = true")
        page.set_viewport_size({"width": DESKTOP[0], "height": 1100})
        tall = steady(reading, "the month grid finished fitting its chips")
        assert sum(tall) == total, tall
        page.set_viewport_size({"width": DESKTOP[0], "height": 500})
        poll(lambda: reading()[1] > tall[1] and sum(reading()) == total, ACT_S, "+N more grew as the window got shorter")
        short = steady(reading, "the shorter month grid finished fitting its chips")
        page.set_viewport_size({"width": DESKTOP[0], "height": 1100})
        poll(lambda: reading()[0] > short[0] and sum(reading()) == total, ACT_S, "more chips fit in a taller window")
        assert page.evaluate("window.__same === true"), "no reload"
        click(more)
        day_list = dialog(page, f"Events on {label(monday)}")
        expect(day_list.get_by_role("button", name=re.compile(re.escape(token)))).to_have_count(total)


def test_first_draw(browser, app_url):
    rafe = api(app_url, "rafe")
    monday = fresh_monday()
    title = title_of("First draw")
    new_event(rafe, title, stamp(monday, "10:00"), stamp(monday, "11:00"))
    path = f"/calendar?view=week&date={iso(monday)}&calendars=cal-rafe"
    routes: list = []
    with screen(browser, app_url, "rafe", path, before=prepare_ws({"refuse": True}, routes)) as page:
        item = block(page, title, "10:00", "11:00")
        expect(item).to_be_visible()
        in_view(item)
        nine = cell(page, monday, "09:00")
        in_view(nine)
        assert not cell(page, monday, "07:45").evaluate(CLEAR_JS), "the 09:00 row is at the top of the scrolling area"
        assert abs(box(item)["y"] - box(cell(page, monday, "10:00"))["y"]) <= LANE_TOLERANCE
        refused = box(item)
        see_copy(page, "Reconnecting. Changes will catch up.")
    with screen(browser, app_url, "rafe", path) as page:
        item = block(page, title, "10:00", "11:00")
        expect(item).to_be_visible()
        live = box(item)
        assert abs(live["y"] - refused["y"]) <= LANE_TOLERANCE and abs(live["x"] - refused["x"]) <= LANE_TOLERANCE
        page.reload()
        expect(item).to_be_visible()
        assert f"date={iso(monday)}" in page.url


def test_search_as_you_type(browser, app_url):
    edith = api(app_url, "edith")
    monday = fresh_monday()
    token = title_of("Findme")
    new_event(edith, f"{token} title", stamp(monday, "10:00"), stamp(monday, "11:00"))
    new_event(edith, "Quiet one", stamp(monday, "12:00"), stamp(monday, "13:00"), location=f"{token} room")
    new_event(edith, "Quiet two", stamp(monday, "14:00"), stamp(monday, "15:00"), notes=f"{token} notes")
    results = edith.get("/api/search", params={"q": f"  {token.upper()}  "}).json()["results"]
    assert len(results) == 3 and "email" not in json.dumps(results)
    assert edith.get("/api/search", params={"q": " a "}).status_code == 422
    assert api(app_url, "lia").get("/api/search", params={"q": token}).json()["results"] == []
    with screen(browser, app_url, "edith", "/search") as page:
        page.evaluate("window.__same = true")
        field = role(page, "searchbox", "Search events")
        field.press_sequentially("a")
        see_copy(page, "Type at least 2 characters to search.")
        expect(role(page, "list", "Results").get_by_role("link")).to_have_count(0)
        field.fill("")
        field.press_sequentially(token)
        rows = role(page, "list", "Results")
        expect(role(rows, "link", f"{token} title, {label(monday)}")).to_be_visible()
        expect(rows.get_by_role("link")).to_have_count(3)
        says(page, f"3 results for {token}.")
        assert parse_qs(urlparse(page.url).query)["q"] == [token]
        field.press_sequentially(" title")
        expect(rows.get_by_role("link")).to_have_count(1)
        says(page, f"1 result for {token} title.")
        field.press_sequentially(" zzz")
        see_copy(page, f"Nothing matches {token} title zzz.")
        assert page.evaluate("window.__same === true"), "results update without a reload"
    ines, sam = api(app_url, "ines"), api(app_url, "sam")
    assert "evt-board-review" in {r["event_id"] for r in ines.get("/api/search", params={"q": NAMES["bea"]}).json()["results"]}
    assert "evt-board-review" not in {r["event_id"] for r in sam.get("/api/search", params={"q": NAMES["hana"]}).json()["results"]}
    assert "evt-board-review" in {r["event_id"] for r in sam.get("/api/search", params={"q": "Northgate"}).json()["results"]}


def test_wf_find_copy_print_files_open_result(browser, app_url):
    edith = api(app_url, "edith")
    monday = fresh_monday()
    title = title_of("Open result")
    event = new_event(edith, title, stamp(monday, "20:00"), stamp(monday, "21:00"))
    with screen(browser, app_url, "edith", f"/search?q={title}") as page:
        click(role(role(page, "list", "Results"), "link", f"{title}, {label(monday)}"))
        expect(page).to_have_url(re.compile(r"/calendar\?.*focus="))
        query = parse_qs(urlparse(page.url).query)
        assert query["focus"] == [event["id"]] and query["date"] == [iso(monday)]
        item = block(page, title, "20:00", "21:00")
        expect(item).to_be_focused()
        in_view(item)
        page.reload()
        expect(item).to_be_focused()
        assert not dialog(page, title).count(), "focus opens no dialog"


def test_wf_find_copy_print_files_duplicate_move(browser, app_url):
    edith, joss, rafe = api(app_url, "edith"), api(app_url, "joss"), api(app_url, "rafe")
    set_share(joss, "cal-joss", "p-edith", "edit")
    set_share(edith, "cal-edith", "p-rafe", "details")
    monday = fresh_monday()
    title = title_of("Copy me")
    event = new_event(edith, title, stamp(monday, "10:00"), stamp(monday, "11:00"), guest_ids=["p-noor"], switches=GUEST_ON,
                      location="Harbour")
    assert reply(api(app_url, "noor"), event["id"], "yes").status_code == 200
    target = calendar_name(edith, "cal-joss")
    with screen(browser, app_url, "edith", f"/events/{event['id']}") as page, \
            screen(browser, app_url, "rafe", f"/calendar?view=week&date={iso(monday)}&calendars=cal-edith") as reader:
        reader_block = block(reader, title, "10:00", "11:00")
        expect(reader_block).to_be_visible()
        click(button(page, "Duplicate"))
        says(page, f"Duplicated {title}.")
        expect(block(reader, f"{title} copy", "10:00", "11:00")).to_be_visible(timeout=LIVE_MS)
        page.goto(f"{app_url}/events/{event['id']}")
        listen(page)
        select(combo(page, "Move to calendar"), target)
        click(button(page, "Move to calendar"))
        says(page, f"Moved {title} to {target}.")
        expect(reader_block).to_have_count(0, timeout=LIVE_MS)
    copy_row = occ_at(edith, f"{title} copy", iso(monday))
    duplicate = event_of(edith, copy_row["event_id"])
    assert duplicate["id"] != event["id"] and duplicate["location"] == "Harbour" and duplicate["calendar_id"] == f"cal-{edith.first}"
    assert duplicate["guests"] == [] and duplicate["share_link"] is None and duplicate["exceptions"] == []
    moved = event_of(edith, event["id"])
    assert moved["calendar_id"] == "cal-joss" and moved["version"] != event["version"] and answer_of(moved, "p-noor") == "yes"
    assert rafe.get(f"/api/events/{event['id']}").status_code == 404
    refused = edith.post(f"/api/events/{event['id']}/move", headers=if_match(moved), json={"calendar_id": "cal-holidays"})
    assert refused.status_code == 403
    assert joss.post(event_url("evt-client-readout", "/duplicate")).status_code == 403


def start_print(a: Api, week: date | str, key: str | None = None) -> dict:
    answer = a.post("/api/prints", headers={"Idempotency-Key": key or idempotency_key()}, json={"week_start": str(week)})
    assert answer.status_code == 202, f"POST /api/prints: {answer.status_code} {answer.text[:300]}"
    return answer.json()


def print_of(a: Api, print_id: str) -> dict:
    return a.get(f"/api/prints/{print_id}").json()


def wait_print(a: Api, print_id: str, state: str) -> dict:
    return poll(lambda: (lambda p: p if p["status"] == state else None)(print_of(a, print_id)), PRINT_S,
                f"print {print_id} reached {state}")


def test_printed_week_document(app_url):
    marit = api(app_url, "marit")
    assert api(app_url, "rafe").post("/api/prints", headers={"Idempotency-Key": idempotency_key()},
                                     json={"week_start": "2027-03-08"}).status_code == 403
    assert marit.post("/api/prints", headers={"Idempotency-Key": idempotency_key()},
                      json={"week_start": "2027-03-09"}).status_code == 422
    job = start_print(marit, "2027-03-08")
    wait_print(marit, job["id"], "stored")
    answer = marit.get(f"/api/prints/{job['id']}/pdf")
    assert answer.status_code == 200 and answer.headers["content-type"].startswith("application/pdf")
    assert "wren-week-2027-03-08.pdf" in answer.headers["content-disposition"]
    assert pdf_pages(answer.content) >= 1
    text = norm(pdf_text(answer.content))
    wanted = ["Sundial & Wren", "Week of Mon 8 Mar 2027", "Northgate board review", "15:00 London", "London offsite", "All day", "Busy"]
    wanted += [label(date(2027, 3, 8) + timedelta(days=n)) for n in range(7)]
    for item in wanted:
        assert item in text, item
    for hidden in ("Partner pay talk", "Confidential", NAMES["sam"], NAMES["bea"], NAMES["hana"]):
        assert hidden not in text, hidden
    april = start_print(marit, "2027-04-19")
    wait_print(marit, april["id"], "stored")
    later = norm(pdf_text(marit.get(f"/api/prints/{april['id']}/pdf").content))
    assert "Mon 19 Apr 2027" in later and "Wellington workshop" in later


def test_stored_means_confirmed(browser, app_url):
    down = env_url("APP_MINIO_DOWN_URL")
    marit_down = api(down, "marit")
    job = start_print(marit_down, fresh_monday())
    rendered = poll(lambda: (lambda p: p if p["waiting_on"] == "file_storage" else None)(print_of(marit_down, job["id"])),
                    PRINT_S, "print waits on file storage")
    assert rendered["status"] == "rendered" and rendered["stored_at"] is None
    refused = marit_down.get(f"/api/prints/{job['id']}/pdf")
    assert refused.status_code == 409 and refused.json()["error"] == "print_not_stored"
    assert S3().keys(f"prints/{job['id']}") == []
    with screen(browser, down, "marit", "/prints") as page:
        rows = role(page, "list", "Printed weeks")
        expect(rows).to_contain_text("File storage is not answering. This print stays pending; choose Retry.")
        expect(rows.get_by_role("button", name="Retry").first).to_be_visible()
    marit = api(app_url, "marit")
    assert marit.post(f"/api/prints/{job['id']}/retry").status_code == 202
    stored = wait_print(marit, job["id"], "stored")
    assert stored["object_key"] == job["object_key"] == f"prints/{job['id']}.pdf"
    body = S3().get(stored["object_key"])
    assert pdf_pages(body) >= 1 and stored["size_bytes"] == len(body)
    assert marit.get(f"/api/prints/{job['id']}/pdf").content == body


def test_retry_reuses_key(app_url):
    marit = api(app_url, "marit")
    week = fresh_monday()
    key = idempotency_key()
    job = start_print(marit, week, key)
    assert start_print(marit, week, key)["id"] == job["id"]
    conflict = marit.post("/api/prints", headers={"Idempotency-Key": key}, json={"week_start": iso(week + timedelta(days=7))})
    assert conflict.status_code == 409 and conflict.json()["error"] == "idempotency_conflict"
    stored = wait_print(marit, job["id"], "stored")
    again = marit.post(f"/api/prints/{job['id']}/retry")
    assert again.status_code == 200 and again.json()["stored_at"] == stored["stored_at"]
    assert S3().keys(f"prints/{job['id']}") == [f"prints/{job['id']}.pdf"]
    race_key = idempotency_key()
    with ThreadPoolExecutor(6) as pool:
        ids = set(pool.map(lambda _: start_print(marit, week, race_key)["id"], range(6)))
    assert len(ids) == 1
    down = api(env_url("APP_GOTENBERG_DOWN_URL"), "marit")
    waiting = start_print(down, week)
    with ThreadPoolExecutor(3) as pool:
        answers = list(pool.map(lambda _: down.post(f"/api/prints/{waiting['id']}/retry"), range(3)))
    assert [a.status_code for a in answers] == [202, 202, 202]
    assert {a.json()["object_key"] for a in answers} == {waiting["object_key"]}
    assert S3().keys(f"prints/{waiting['id']}") == []


class TcpRelay:

    def __init__(self, port: int, target: str):
        parts = urlparse(target)
        self.target = (parts.hostname, parts.port or 80)
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", port))
        self.listener.listen(16)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        for _ in range(10000):
            try:
                client, _addr = self.listener.accept()
                server = socket.create_connection(self.target)
            except OSError:
                return
            for a, b in ((client, server), (server, client)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(source: socket.socket, sink: socket.socket) -> None:
        try:
            for chunk in iter(lambda: source.recv(65536), b""):
                sink.sendall(chunk)
            sink.shutdown(socket.SHUT_WR)
        except OSError:
            pass

    def stop(self) -> None:
        try:
            self.listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.listener.close()


def test_wf_find_copy_print_files_print_outage(browser):
    pending_copy = "The document service is not answering. This print stays pending; choose Retry."
    down = env_url("APP_GOTENBERG_DOWN_URL")
    with screen(browser, down, "marit", "/prints") as page:
        fill(textbox(page, "Week starting"), iso(fresh_monday()))
        click(button(page, "Print the week"))
        rows = role(page, "list", "Printed weeks")
        expect(rows).to_contain_text(pending_copy)
        says(page, pending_copy)
        expect(rows.get_by_role("button", name="Retry").first).to_be_visible()
    returns = env_url("APP_GOTENBERG_RETURNS_URL")
    marit = api(returns, "marit")
    week = fresh_monday()
    job = start_print(marit, week)
    state = poll(lambda: (lambda p: p if p["waiting_on"] == "document_service" else None)(print_of(marit, job["id"])),
                 PRINT_S, "print waits on the document service")
    assert state["status"] == "pending"
    assert marit.get(f"/api/prints/{job['id']}/pdf").status_code == 409
    target = os.environ.get("GOTENBERG_URL")
    assert target, "GOTENBERG_URL names the real document service for the returning relay"
    relay = TcpRelay(RETURNS_PORT, target)
    try:
        with screen(browser, returns, "marit", "/prints") as page:
            rows = role(page, "list", "Printed weeks")

            def retried() -> bool:
                buttons = rows.get_by_role("button", name="Retry")
                if print_of(marit, job["id"])["status"] == "stored":
                    return True
                if buttons.count():
                    buttons.first.click(timeout=ACT_MS)
                return False

            poll(retried, PRINT_S, "Retry completed the print once the document service returned")
            expect(rows).to_contain_text("The printed week is ready.")
            expect(rows.get_by_role("link", name="Download PDF").first).to_be_visible()
        assert S3().keys(f"prints/{job['id']}") == [job["object_key"]]
        assert pdf_pages(S3().get(job["object_key"])) >= 1
    finally:
        relay.stop()


def test_icalendar_round_trip():
    base = short_url()
    rafe, callum = api(base, "rafe"), api(base, "callum")
    title = title_of("Round trip")
    series = new_event(rafe, title, "2027-03-02T09:00", "2027-03-02T10:00", zone=NY, rrule=ROUND_RULE,
                       location="Harbour", notes="Keep", guest_ids=["p-noor"], switches=GUEST_ON)
    sid = series["id"]
    save(rafe, sid, scope="this", occurrence_id=oid(sid, "2027-03-16", "09:00"), notes="Moved one",
         start_local="2027-03-16T11:00", end_local="2027-03-16T12:00")
    trash(rafe, sid, scope="this", occurrence_id=oid(sid, "2027-03-23", "09:00"))
    export = rafe.post(calendar_url("cal-rafe", "/exports"))
    assert export.status_code == 201, export.text[:300]
    meta = export.json()
    assert meta["object_key"] == f"exports/{meta['id']}.ics"
    text = rafe.get(f"/api/exports/{meta['id']}/file")
    assert text.status_code == 200 and text.headers["content-type"].startswith("text/calendar")
    assert S3("-short").get(meta["object_key"]) == text.content
    unfolded = text.text.replace("\r\n ", "").replace("\r\n", "\n")
    for piece in (f"UID:{sid}", "DTSTART;TZID=America/New_York", "RRULE:", "EXDATE;TZID=America/New_York", "RECURRENCE-ID;TZID=America/New_York", "X-WREN-KIND"):
        assert piece in unfolded, piece
    assert "ATTENDEE" not in unfolded and NAMES["noor"] not in unfolded

    def shape(person: Api) -> list[tuple]:
        return [(o["title"], o["location"], o["notes"], o["zone"], o["start_local"], o["end_local"], o["start_utc"], o["is_exception"])
                for o in titled(person, title, "2027-03-01", "2027-05-01")]

    imported = callum.post(calendar_url("cal-callum", "/imports"), content=text.content, headers={"Content-Type": "text/calendar"})
    assert imported.status_code == 201, imported.text[:300]
    assert imported.json()["object_key"] == f"imports/{imported.json()['id']}.ics"
    assert S3("-short").get(imported.json()["object_key"]) == text.content
    copies = titled(callum, title, "2027-03-01", "2027-05-01")
    assert shape(callum) == shape(rafe) and len(copies) == 5
    copied = event_of(callum, copies[0]["event_id"])
    assert copied["rrule"] == ROUND_RULE and copied["guests"] == []
    again = callum.post(calendar_url("cal-callum", "/imports"), content=text.content, headers={"Content-Type": "text/calendar"})
    assert again.status_code == 201 and again.json()["updated"] >= 1
    assert shape(callum) == shape(rafe), "a re-import replaces the event, so nothing doubles"


def test_icalendar_outage(app_url):
    copy = "File storage is not answering. Nothing was changed. Try again shortly."
    down = env_url("APP_MINIO_DOWN_URL")
    lia_down, lia = api(down, "lia"), api(app_url, "lia")
    answer = lia_down.post(calendar_url("cal-lia", "/exports"))
    assert answer.status_code == 503 and answer.json() == {"error": "file_storage_unavailable", "message": copy}
    title = title_of("Not imported")
    file = ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n"
            f"UID:{uuid.uuid4().hex}\r\nDTSTART;TZID=Europe/London:20290305T100000\r\nDTEND;TZID=Europe/London:20290305T110000\r\n"
            f"SUMMARY:{title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
    headers = {"Content-Type": "text/calendar"}
    refused = lia_down.post(calendar_url("cal-lia", "/imports"), content=file, headers=headers)
    assert refused.status_code == 503 and refused.json()["message"] == copy
    assert titled(lia, title, "2029-03-01", "2029-04-01") == []
    made = lia.post(calendar_url("cal-lia", "/exports"))
    assert made.status_code == 201
    assert b"BEGIN:VCALENDAR" in S3().get(made.json()["object_key"]), "the export was stored before it succeeded"
    assert lia_down.get(f"/api/exports/{made.json()['id']}/file").status_code == 503
    bad = lia.post(calendar_url("cal-lia", "/imports"), content="not a calendar", headers=headers)
    assert bad.status_code == 422 and bad.json()["error"] == "invalid_icalendar"
    assert api(app_url, "sam").post(calendar_url("cal-lia", "/imports"), content=file, headers=headers).status_code in (403, 404)
    assert api(app_url, "joss").post(calendar_url("cal-dara", "/exports")).status_code == 403
    good = lia.post(calendar_url("cal-lia", "/imports"), content=file, headers=headers)
    assert good.status_code == 201 and good.json()["created"] == 1
    assert S3().get(good.json()["object_key"]).decode().replace("\r\n", "\n") == file.replace("\r\n", "\n")
    assert len(titled(lia, title, "2029-03-01", "2029-04-01")) == 1


def test_public_holidays(browser, app_url):
    rafe = api(app_url, "rafe")
    good = event_of(rafe, "hol-good-friday")
    assert good["access"] == "details"
    assert next(c for c in rafe.get("/api/calendars").json()["calendars"] if c["id"] == "cal-holidays")["level"] == "read_only"
    any_version = {"If-Match": '"1"'}
    assert rafe.patch(event_url("hol-good-friday"), headers=any_version, json={"title": "Taken"}).status_code == 403
    assert rafe.delete(event_url("hol-good-friday"), headers=any_version).status_code == 403
    assert rafe.post("/api/events", json={"calendar_id": "cal-holidays", "title": "Mine", "kind": kind_value(app_url, "event"), "all_day": True,
                                          "start_local": "2029-03-05", "end_local": "2029-03-05", "zone": LDN}).status_code == 403
    assert rafe.patch(calendar_url("cal-holidays"), json={"default_reminders": [5]}).status_code == 403
    slots = rafe.get("/api/find-a-time", params={"people": "p-noor", "minutes": 30, "from": "2027-03-26", "to": "2027-03-26"}).json()
    assert slots["slots"], "holidays block no time"
    with screen(browser, app_url, "rafe", "/calendar?view=week&date=2027-03-22") as page:
        item = all_day_block(page, "Good Friday")
        expect(item).to_have_count(0)
        role(role(page, "group", "Calendars"), "checkbox", "Public holidays").check()
        expect(item).to_be_visible()
        expect(page).to_have_url(re.compile("cal-holidays"))
        item.focus()
        page.keyboard.press("Enter")
        quick = dialog(page, "Good Friday")
        expect(button(quick, "Open event")).to_be_visible()
        for name in ("Edit", "Delete", "Duplicate"):
            expect(button(quick, name)).to_have_count(0)


def test_recording_zone_rules(browser):
    base = short_url()
    marit, priya = api(base, "marit"), api(base, "priya")
    when = f"{2090 + uuid.uuid4().int % 9}-{1 + uuid.uuid4().int % 12:02d}-{1 + uuid.uuid4().int % 28:02d}"
    note = title_of("Rule note")
    body = {"zone": LDN, "effective_date": when, "new_offset": "+01:00", "note": note}
    assert priya.post("/api/zone-rules", json=body).status_code == 403
    assert api(base, "sam").get("/api/zone-rules").status_code == 403
    for bad in ("+13:20", "+15:00", "-13:00"):
        refused = marit.post("/api/zone-rules", json={**body, "new_offset": bad})
        assert refused.status_code == 422 and "new_offset" in refused.json()["fields"], bad
    assert note not in json.dumps(marit.get("/api/zone-rules").json()), "refused rules record nothing"
    with screen(browser, base, "marit", "/zone-rules") as manager, screen(browser, base, "priya", "/zone-rules") as reader:
        expect(button(reader, "Record rule")).to_have_count(0)
        select(combo(manager, "Zone"), "London")
        fill(textbox(manager, "Effective date"), when)
        fill(textbox(manager, "New offset"), "+01:00")
        fill(textbox(manager, "Note"), note)
        click(button(manager, "Record rule"))
        says(manager, "Rule recorded for London.")
        expect(role(reader, "list", "Zone rules")).to_contain_text(note, timeout=LIVE_MS)
    twice = marit.post("/api/zone-rules", json=body)
    assert twice.status_code == 409 and twice.json()["error"] == "rule_exists"
    assert [r["recorded_by"] for r in marit.get("/api/zone-rules").json()["rules"] if r["note"] == note]


def test_wf_zone_rule_change_warning_scope(browser):
    base = short_url()
    rule = auckland_rule(base)
    oren = api(base, "oren")
    workshop = occ_at(oren, "Wellington workshop", "2027-04-20")
    assert workshop["start_local"] == stamp(date(2027, 4, 20), "11:00") and workshop["end_local"] == stamp(date(2027, 4, 20), "13:00")
    assert parse_utc(workshop["start_utc"]) == parse_utc("2027-04-19T22:00:00Z")
    warning = workshop["zone_warnings"][0]
    assert (warning["rule_id"], warning["shift_minutes"], warning["saved_time"], warning["shown_time"]) == (rule["id"], 60, "10:00", "11:00")
    assert {c["city"]: c["time"] for c in workshop["clocks"]}["Auckland"] == "11:00"
    assert {c["city"]: c["time"] for c in workshop["clocks"]}["London"] == "23:00"
    assert not event_of(api(base, "lia"), "evt-queen-street")["zone_warnings"], "last saved before the date"
    assert not event_of(api(base, "tane"), "evt-harbour-kickoff")["zone_warnings"], "zero shift"
    assert not event_of(api(base, "tane"), "evt-tane-away")["zone_warnings"], "all-day"
    title = title_of("Weekly")
    new_event(oren, title, "2027-03-01T09:00", "2027-03-01T10:00", zone=AKL, rrule="FREQ=WEEKLY")
    table = {"2027-03-29": ("09:00", "2027-03-28T20:00:00Z", 0), "2027-04-19": ("10:00", "2027-04-18T21:00:00Z", 1),
             "2027-12-06": ("09:00", "2027-12-05T20:00:00Z", 0)}
    for on, (shown, utc, warned) in table.items():
        row = occ_at(oren, title, on)
        assert row["start_local"].endswith(shown) and parse_utc(row["start_utc"]) == parse_utc(utc), on
        assert len(row["zone_warnings"]) == warned, on
    sentence = f"A zone rule for Auckland took effect on {label('2026-06-01')}: {RULE_NOTE} 10:00 now shows as 11:00."
    with screen(browser, base, "oren", "/calendar?view=week&date=2027-04-19&calendars=cal-oren&event=evt-wellington-workshop") as page:
        quick = dialog(page, "Wellington workshop")
        expect(role(quick, "region", "Zone rule warning")).to_contain_text(sentence)
        expect(button(quick, "Move")).to_have_count(0)
        page.keyboard.press("Escape")
        item = block(page, "Wellington workshop", "11:00", "13:00")
        expect(item.get_by_role("img", name="Zone rule warning")).to_have_count(1)
        page.goto(f"{base}/events/evt-wellington-workshop")
        expect(role(page, "region", "Zone rule warning")).to_contain_text(sentence)
        expect(button(page, "Move")).to_be_visible()
    with screen(browser, base, "lia", "/calendar?view=week&date=2027-04-19&calendars=cal-lia") as page:
        item = block(page, "Queen Street review", "10:00", "11:00")
        expect(item).to_be_visible()
        expect(item.get_by_role("img", name="Zone rule warning")).to_have_count(0)


def test_move_action_rules():
    base = short_url()
    rule = auckland_rule(base)
    oren = api(base, "oren")
    title = title_of("Move single")
    event = new_event(oren, title, stamp("2027-04-20", "10:00"), stamp("2027-04-20", "12:00"), zone=AKL, guest_ids=["p-hana"], switches=GUEST_ON)
    path = f"/api/events/{event['id']}/zone-moves"
    assert event["id"]
    missing = oren.post(path, json={"rule_id": rule["id"]})
    assert missing.status_code == 428
    guest = api(base, "hana").post(path, headers=if_match(event_of(oren, event["id"])), json={"rule_id": rule["id"]})
    assert guest.status_code == 403
    older = if_match(event_of(oren, event["id"]))
    save(oren, event["id"], location="Harbour")
    stale = oren.post(path, headers=older, json={"rule_id": rule["id"]})
    assert stale.status_code == 412
    moved = oren.post(path, headers=if_match(event_of(oren, event["id"])), json={"rule_id": rule["id"]})
    assert moved.status_code == 200, moved.text[:300]
    after = occ_at(oren, title, "2027-04-20")
    assert after["start_local"] == stamp("2027-04-20", "10:00") and parse_utc(after["start_utc"]) == parse_utc("2027-04-19T21:00:00Z")
    assert not after["zone_warnings"]
    again = oren.post(path, headers=if_match(event_of(oren, event["id"])), json={"rule_id": rule["id"]})
    assert again.status_code == 409 and again.json()["error"] == "not_warned"
    weekly = title_of("Move weekly")
    series = new_event(oren, weekly, "2027-03-01T09:00", "2027-03-01T10:00", zone=AKL, rrule="FREQ=WEEKLY")
    answer = oren.post(f"/api/events/{series['id']}/zone-moves", headers=if_match(event_of(oren, series["id"])), json={"rule_id": rule["id"]})
    assert answer.status_code == 200 and answer.json()["split"], answer.text[:300]
    table = {"2027-03-29": "2027-03-28T20:00:00Z", "2027-04-19": "2027-04-18T20:00:00Z", "2027-12-06": "2027-12-05T20:00:00Z"}
    for on, utc in table.items():
        row = occ_at(oren, weekly, on)
        assert row["start_local"] == f"{on}T09:00" and parse_utc(row["start_utc"]) == parse_utc(utc) and not row["zone_warnings"], on
    assert occ_at(oren, weekly, "2027-04-05")["event_id"] == answer.json()["split"]["later_id"]
    assert occ_at(oren, weekly, "2027-03-29")["event_id"] == answer.json()["split"]["earlier_id"]


def test_wf_zone_rule_change_season_on_grid(browser):
    base = short_url()
    auckland_rule(base)
    lia = api(base, "lia")
    title = title_of("Seasons")
    series = new_event(lia, title, "2027-03-01T09:00", "2027-03-01T10:00", zone=AKL, rrule="FREQ=WEEKLY", guest_ids=["p-bea"], switches=GUEST_OFF)
    sid = series["id"]
    marker = "Zone rule warning"
    path = "/calendar?view=week&calendars=cal-lia&date="
    with screen(browser, base, "lia", f"{path}2027-03-29") as page, \
            screen(browser, base, "bea", "/calendar?view=week&date=2027-04-12") as guest:
        calm = block(page, title, "09:00", "10:00")
        expect(calm).to_be_visible()
        expect(calm.get_by_role("img", name=marker)).to_have_count(0)
        page.goto(f"{base}{path}2027-04-19")
        warned = block(page, title, "10:00", "11:00")
        expect(warned).to_be_visible()
        expect(warned.get_by_role("img", name=marker)).to_have_count(1)
        on_slot(warned, cell(page, "2027-04-19", "10:00"))
        warned.focus()
        page.keyboard.press("Enter")
        quick = dialog(page, title)
        expect(role(quick, "region", marker)).to_contain_text("09:00 now shows as 10:00.")
        page.keyboard.press("Escape")
        expect(quick).to_have_count(0)
        expect(warned).to_be_focused()
        page.goto(f"{base}{path}2027-12-06")
        winter = block(page, title, "09:00", "10:00")
        expect(winter).to_be_visible()
        expect(winter.get_by_role("img", name=marker)).to_have_count(0)
        guest_block = block(guest, title, "22:00", "23:00")
        expect(guest_block).to_be_visible()
        expect(guest_block.get_by_role("img", name=marker)).to_have_count(1)
        guest_block.focus()
        guest.keyboard.press("Enter")
        guest_quick = dialog(guest, title)
        expect(role(guest_quick, "region", marker)).to_contain_text("09:00 now shows as 10:00.")
        expect(button(guest_quick, "Move")).to_have_count(0)
        guest.keyboard.press("Escape")
        expect(guest_quick).to_have_count(0)
        page.goto(f"{base}/events/{sid}?occurrence={oid(sid, '2027-04-19', '09:00')}")
        listen(page)
        click(button(page, "Move"))
        says(page, f"Moved {title} back to 09:00 Auckland.")
        fixed = block(guest, title, "21:00", "22:00")
        expect(fixed).to_be_visible(timeout=LIVE_MS)
        expect(fixed.get_by_role("img", name=marker)).to_have_count(0)
        expect(guest_block).to_have_count(0)
        for week, kept in (("2027-03-29", "09:00"), ("2027-04-19", "09:00"), ("2027-12-06", "09:00")):
            page.goto(f"{base}{path}{week}")
            item = block(page, title, kept, "10:00")
            expect(item).to_be_visible()
            on_slot(item, cell(page, week, kept))
            expect(item.get_by_role("img", name=marker)).to_have_count(0)
    instants = {"2027-03-29": "2027-03-28T20:00:00Z", "2027-04-19": "2027-04-18T20:00:00Z", "2027-12-06": "2027-12-05T20:00:00Z"}
    for on, utc in instants.items():
        assert parse_utc(occ_at(lia, title, on)["start_utc"]) == parse_utc(utc), on


def test_wf_zone_rule_change_move_on_page(browser):
    base = short_url()
    auckland_rule(base)
    oren = api(base, "oren")
    title = title_of("Move page")
    event = new_event(oren, title, stamp("2027-04-20", "10:00"), stamp("2027-04-20", "12:00"), zone=AKL)
    with screen(browser, base, "oren", f"/events/{event['id']}") as page:
        expect(role(page, "region", "Zone rule warning")).to_contain_text("10:00 now shows as 11:00.")
        click(button(page, "Move"))
        says(page, f"Moved {title} back to 10:00 Auckland.")
        expect(role(page, "region", "Zone rule warning")).to_have_count(0)
        expect(button(page, "Undo")).to_have_count(0)
    assert parse_utc(occ_at(oren, title, "2027-04-20")["start_utc"]) == parse_utc("2027-04-19T21:00:00Z")


def test_wf_zone_rule_change_guest_sees_warning(browser):
    base = short_url()
    rule = auckland_rule(base)
    oren, hana = api(base, "oren"), api(base, "hana")
    title = title_of("Guest warning")
    event = new_event(oren, title, stamp("2027-04-20", "10:00"), stamp("2027-04-20", "12:00"), zone=AKL, guest_ids=["p-hana"], switches=GUEST_OFF)
    assert event_of(hana, event["id"])["zone_warnings"][0]["shown_time"] == "11:00"
    with screen(browser, base, "hana", f"/events/{event['id']}") as page:
        expect(role(page, "region", "Zone rule warning")).to_contain_text("10:00 now shows as 11:00.")
        expect(button(page, "Move")).to_have_count(0)
        page.goto(f"{base}/calendar?view=week&date=2027-04-19&event={event['id']}")
        quick = dialog(page, title)
        expect(role(quick, "region", "Zone rule warning")).to_contain_text("10:00 now shows as 11:00.")
        expect(button(quick, "Move")).to_have_count(0)
        page.keyboard.press("Escape")
        before = block(page, title, "11:00", "13:00")
        expect(before.get_by_role("img", name="Zone rule warning")).to_have_count(1)
        refused = hana.post(f"/api/events/{event['id']}/zone-moves", headers=if_match(event_of(hana, event["id"])), json={"rule_id": rule["id"]})
        assert refused.status_code == 403
        moved = oren.post(f"/api/events/{event['id']}/zone-moves", headers=if_match(event_of(oren, event["id"])), json={"rule_id": rule["id"]})
        assert moved.status_code == 200
        expect(block(page, title, "10:00", "12:00")).to_be_visible(timeout=LIVE_MS)
        expect(before).to_have_count(0)


def test_modify_switch(browser, app_url):
    oren, callum = api(app_url, "oren"), api(app_url, "callum")
    monday = fresh_monday()
    title = title_of("Modify")
    event = new_event(oren, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=AKL, guest_ids=["p-callum"], switches=GUEST_ON)
    eid = event["id"]
    refused = callum.patch(f"/api/events/{eid}", headers=if_match(event_of(callum, eid)), json={"title": "Guest edit"})
    assert refused.status_code == 403 and event_of(oren, eid)["title"] == title
    with screen(browser, app_url, "callum", f"/events/{eid}") as page:
        expect(role(page, "radiogroup", "Your answer")).to_be_visible()
        expect(button(page, "Save")).to_have_count(0)
        expect(role(page, "group", "Guest switches")).to_have_count(0)
        expect(button(page, "Copy shared link")).to_have_count(0)
        page.goto(f"{app_url}/calendar?view=week&date={iso(monday)}&event={eid}")
        quick = dialog(page, title)
        expect(button(quick, "Open event")).to_be_visible()
        expect(button(quick, "Edit")).to_have_count(0)
        expect(button(quick, "Delete")).to_have_count(0)
    save(oren, eid, switches={**GUEST_ON, "modify_event": True})
    assert save_raw(callum, eid, title=f"{title} edited").status_code == 200
    for forbidden in ({"switches": GUEST_OFF}, {"visibility": "private"}, {"calendar_id": "cal-lia"}):
        assert save_raw(callum, eid, **forbidden).status_code == 403, forbidden
    assert callum.post(f"/api/events/{eid}/share-link").status_code == 403
    assert event_of(oren, eid)["title"] == f"{title} edited"


def test_hidden_guest_lists(browser, app_url):
    oren, sam = api(app_url, "oren"), api(app_url, "sam")
    monday = fresh_monday()
    title = title_of("Hidden")
    event = new_event(oren, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=AKL, guest_ids=["p-sam", "p-bea"], switches=GUEST_OFF)
    eid = event["id"]
    assert reply(api(app_url, "bea"), eid, "yes").status_code == 200
    seen = event_of(sam, eid)
    assert "guests" not in seen and "rsvp" not in seen and NAMES["bea"] not in json.dumps(seen)
    row = next(o for o in rows_between(sam, monday - timedelta(days=1), monday + timedelta(days=2)) if o["event_id"] == eid)
    assert "guests" not in row and "rsvp" not in row and NAMES["bea"] not in json.dumps(row)
    assert eid not in {r["event_id"] for r in sam.get("/api/search", params={"q": NAMES["bea"]}).json()["results"]}
    assert not [t for t in notice_texts(sam) if title in t and NAMES["bea"] in t]
    link = oren.post(f"/api/events/{eid}/share-link")
    assert link.status_code == 409 and link.json()["error"] == "guest_list_hidden"
    marit = api(app_url, "marit")
    board = event_of(marit, "evt-board-review")
    assert board["access"] == "details" and "guests" not in board and "rsvp" not in board
    export = marit.post(calendar_url("cal-ines", "/exports"))
    file_text = marit.get(f"/api/exports/{export.json()['id']}/file").text
    for name in (NAMES["sam"], NAMES["bea"], NAMES["hana"]):
        assert name not in file_text and name not in json.dumps(board), name
    with screen(browser, app_url, "sam", f"/events/{eid}") as page:
        expect(role(page, "radiogroup", "Your answer")).to_be_visible()
        expect(role(page, "region", "Answers")).to_have_count(0)
        expect(role(page, "list", "Guests")).to_have_count(0)
        assert NAMES["bea"] not in page.content()
        frames = [f for f in raw_frames(page) if eid in f]
        assert frames, "the guest received live messages about the event"
        for frame in frames:
            assert NAMES["bea"] not in frame and '"rsvp"' not in frame and '"guests"' not in frame


def test_published_field_lists(app_url):
    dara, tane, sam, hana, marit, joss = (api(app_url, p) for p in ("dara", "tane", "sam", "hana", "marit", "joss"))
    full = event_of(dara, "evt-partners-weekly")
    assert set(full) == FULL_FIELDS and full["access"] == "full"
    assert full["version"] is not None and dara.get(event_url("evt-partners-weekly")).headers["ETag"] == f'"{full["version"]}"'
    assert set(full["organiser"]) == {"id", "name"} and set(full["rsvp"]) == {"yes", "no", "maybe", "invited"}
    assert set(full["switches"]) == {"modify_event", "invite_others", "see_guest_list"}
    assert all(set(g) == {"person_id", "name", "answer", "message"} for g in full["guests"])
    guest = event_of(tane, "evt-partners-weekly")
    assert set(guest) == GUEST_FIELDS and guest["access"] == "guest"
    hidden = event_of(sam, "evt-board-review")
    assert set(hidden) == GUEST_FIELDS - {"guests", "rsvp"}
    with_list = event_of(hana, "evt-harbour-kickoff")
    assert set(with_list) == DETAILS_FIELDS | {"guests", "rsvp"} and with_list["access"] == "details"
    assert set(event_of(marit, "evt-board-review")) == DETAILS_FIELDS
    busy = event_of(joss, "evt-client-readout")
    assert set(busy) == BUSY_FIELDS and busy["title"] == "Busy"
    swap = {"occurrence_id", "event_id", "is_exception"}
    tane_row = next(o for o in rows_between(tane, "2027-03-08", "2027-03-11") if o["event_id"] == "evt-partners-weekly")
    assert set(tane_row) == (GUEST_FIELDS - {"id"}) | swap
    dara_row = next(o for o in rows_between(dara, "2027-03-08", "2027-03-11") if o["event_id"] == "evt-partners-weekly")
    assert set(dara_row) == (FULL_FIELDS - {"id"}) | swap
    joss_row = next(o for o in rows_between(joss, "2026-10-05", "2026-10-08") if o["event_id"] == "evt-client-readout")
    assert set(joss_row) == {"occurrence_id", "event_id", "calendar_id", "title", "all_day", "start_local", "end_local",
                             "zone", "access", "clocks", "start_utc", "end_utc"}
    bodies = [full, guest, hidden, with_list, busy, tane_row, dara_row, joss_row,
              dara.get("/api/people").json(), dara.get("/api/calendars").json(), dara.get("/api/shares", params={"calendar_id": "cal-dara"}).json()]
    assert DOMAIN not in json.dumps(bodies)
    assert dara.get("/api/me").json()["email"] == f"dara{DOMAIN}"


def test_shared_link(browser, app_url):
    yuki = api(app_url, "yuki")
    monday = fresh_monday()
    title = title_of("Linked")
    event = new_event(yuki, title, stamp(monday, "10:00"), stamp(monday, "11:00"), guest_ids=["p-noor"], switches=GUEST_ON, location="Harbour")
    eid = event["id"]
    created = yuki.post(f"/api/events/{eid}/share-link")
    assert created.status_code == 201
    token = created.json()["token"]
    assert token and created.json()["url"] and created.json()["expires_at"]
    public = httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_S)
    assert public.status_code == 200
    body = public.json()
    assert set(body) == {"title", "location", "organiser_name", "all_day", "start_local", "end_local", "zone", "clocks", "guests"}
    assert body["title"] == title and body["guests"] == [{"name": NAMES["noor"], "answer": "invited"}]
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        refused = httpx.request(method, f"{app_url}/api/share/{token}", timeout=HTTP_S)
        assert refused.status_code == 405 and refused.json()["error"] == "read_only", method
    with screen(browser, app_url, None, f"/share/{token}") as page:
        expect(page.get_by_role("heading", level=1, name=title)).to_be_visible()
        expect(role(page, "list", "Guests")).to_contain_text("Noor Lindqvist: Waiting")
        new_token = yuki.post(f"/api/events/{eid}/share-link").json()["token"]
        assert new_token != token
        page.goto(f"{app_url}/share/{token}")
        expect(page.get_by_role("heading", level=1, name="This link no longer works.")).to_be_visible()
    unknown = httpx.get(f"{app_url}/api/share/{uuid.uuid4().hex}", timeout=HTTP_S)
    dead = httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_S)
    assert dead.status_code == unknown.status_code == 404 and dead.json() == unknown.json()
    assert dead.json() == {"error": "not_found", "message": "This link no longer works."}
    assert yuki.delete(f"/api/events/{eid}/share-link").status_code == 204
    assert httpx.get(f"{app_url}/api/share/{new_token}", timeout=HTTP_S).status_code == 404
    private = new_event(yuki, title_of("Private"), stamp(monday, "12:00"), stamp(monday, "13:00"), visibility="private", switches=GUEST_ON)
    answer = yuki.post(f"/api/events/{private['id']}/share-link")
    assert answer.status_code == 409 and answer.json()["error"] == "private_event"
    base = short_url()
    short = api(base, "yuki")
    brief = new_event(short, title_of("Brief link"), stamp(monday, "10:00"), stamp(monday, "11:00"), switches=GUEST_ON)
    brief_token = short.post(f"/api/events/{brief['id']}/share-link").json()["token"]
    assert httpx.get(f"{base}/api/share/{brief_token}", timeout=HTTP_S).status_code == 200
    poll(lambda: httpx.get(f"{base}/api/share/{brief_token}", timeout=HTTP_S).status_code == 404, 20.0,
         "the link expired after SHARE_LINK_TTL_SECONDS")


SWITCH_WAIT_S = 2.0


def settle_switch(page: Page, a: Api, event_id: str, name: str, value: bool) -> None:
    deadline = time.monotonic() + SWITCH_WAIT_S
    while time.monotonic() < deadline:
        if event_of(a, event_id)["switches"][name] is value:
            return
    save_button = button(page, "Save")
    if save_button.count():
        click(save_button)


def test_wf_guest_switches_link_switch_off_kills_link(browser, app_url):
    yuki = api(app_url, "yuki")
    monday = fresh_monday()
    event = new_event(yuki, title_of("Kill link"), stamp(monday, "10:00"), stamp(monday, "11:00"), switches=GUEST_ON)
    eid = event["id"]
    token = yuki.post(f"/api/events/{eid}/share-link").json()["token"]
    assert httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_S).status_code == 200
    with screen(browser, app_url, "yuki", f"/events/{eid}") as page:
        switch = role(role(page, "group", "Guest switches"), "checkbox", "See guest list")
        expect(switch).to_be_checked()
        switch.uncheck()
        settle_switch(page, yuki, eid, "see_guest_list", False)
        says(page, "Guest list hidden. The shared link no longer works.")
        poll(lambda: httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_S).status_code == 404, ACT_S, "link died with the guest list")
        switch.check()
        settle_switch(page, yuki, eid, "see_guest_list", True)
        poll(lambda: event_of(yuki, eid)["switches"]["see_guest_list"], ACT_S, "switch back on saved")
    assert httpx.get(f"{app_url}/api/share/{token}", timeout=HTTP_S).status_code == 404, "turning it on never revives a dead link"
    assert event_of(yuki, eid)["share_link"] is None


def test_guest_defaults_and_hours(browser):
    base = short_url()
    marit, rafe = api(base, "marit"), api(base, "rafe")
    original = marit.get("/api/settings").json()
    assert api(base, "sam").get("/api/settings").status_code == 403
    assert rafe.patch("/api/settings", json={"guest_defaults": {**GUEST_ON}}).status_code == 403
    monday = fresh_monday()
    try:
        older = new_event(rafe, title_of("Older"), stamp(monday, "10:00"), stamp(monday, "11:00"))
        with screen(browser, base, "marit", "/settings") as page:
            role(page, "checkbox", "See guest list by default").check()
            fill(textbox(page, "London closes"), NEW_CLOSE)
            click(button(page, "Save settings"))
            says(page, "Settings saved.")
        current = marit.get("/api/settings").json()
        assert current["guest_defaults"]["see_guest_list"] is True and current["office_hours"][LDN]["close"] == NEW_CLOSE
        newer = new_event(rafe, title_of("Newer"), stamp(monday, "12:00"), stamp(monday, "13:00"))
        assert newer["switches"]["see_guest_list"] is True
        assert event_of(rafe, older["id"])["switches"]["see_guest_list"] is False
        late = new_event(rafe, title_of("Late"), stamp(monday, "17:45"), stamp(monday, NEW_CLOSE))
        assert {c["city"]: c["inside_hours"] for c in late["clocks"]}["London"] is True
        with screen(browser, base, "rafe", "/settings") as page:
            expect(role(page, "checkbox", "See guest list by default")).to_have_count(0)
            expect(textbox(page, "London closes")).to_have_count(0)
    finally:
        marit.patch("/api/settings", json=original)


def test_wf_guest_switches_link_modify_shows_list(browser, app_url):
    ines = api(app_url, "ines")
    set_share(ines, "cal-ines", "p-marit", "details")
    monday = fresh_monday()
    title = title_of("Modify list")
    event = new_event(ines, title, stamp(monday, "15:00"), stamp(monday, "16:00"), guest_ids=["p-sam", "p-bea"], switches=GUEST_OFF)
    eid = event["id"]
    path = f"/events/{eid}"
    with screen(browser, app_url, "sam", path) as guest, screen(browser, app_url, "marit", path) as viewer, \
            screen(browser, app_url, "ines", path) as owner:
        expect(role(guest, "list", "Guests")).to_have_count(0)
        guest.evaluate("window.__same = true")
        role(role(owner, "group", "Guest switches"), "checkbox", "Modify event").check()
        settle_switch(owner, ines, eid, "modify_event", True)
        expect(role(guest, "list", "Guests")).to_contain_text("Bea Marchetti: Waiting", timeout=LIVE_MS)
        expect(role(guest, "region", "Answers")).to_contain_text(counts_line(0, 0, 0, 2), timeout=LIVE_MS)
        assert guest.evaluate("window.__same === true"), "the guest list appeared without a reload"
        expect(role(viewer, "list", "Guests")).to_have_count(0)
        expect(role(viewer, "region", "Answers")).to_have_count(0)
        assert NAMES["bea"] not in viewer.content()
    assert "guests" in event_of(api(app_url, "sam"), eid)
    assert "guests" not in event_of(api(app_url, "marit"), eid)


def test_wf_guest_switches_link_edit_appears_live(browser, app_url):
    oren = api(app_url, "oren")
    monday = fresh_monday()
    title = title_of("Edit live")
    event = new_event(oren, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=AKL, guest_ids=["p-lia"], switches=GUEST_ON)
    with screen(browser, app_url, "lia", f"/calendar?view=week&date={iso(monday)}") as page:
        item = block(page, title, "10:00", "11:00")
        expect(item).to_be_visible()
        item.focus()
        page.keyboard.press("Enter")
        quick = dialog(page, title)
        expect(quick).to_be_visible()
        expect(button(quick, "Edit")).to_have_count(0)
        save(oren, event["id"], switches={**GUEST_ON, "modify_event": True})
        expect(button(quick, "Edit")).to_be_visible(timeout=LIVE_MS)
        assert quick.evaluate("d => d.contains(document.activeElement)"), "a live change never moves focus out of a dialog"
        page.keyboard.press("Escape")
        expect(quick).to_have_count(0)
        expect(item).to_be_focused()


def test_wf_cross_cutting_layouts(browser, app_url):
    monday = fresh_monday()
    path = f"/calendar?date={iso(monday)}"
    with screen(browser, app_url, "edith", path) as page:
        mini, cals, grid = role(page, "region", "Mini month"), role(page, "group", "Calendars"), role(page, "region", "Week grid")
        expect(grid).to_be_visible()
        drawn(page)
        assert box(mini)["y"] < box(cals)["y"], "the mini month sits above the calendar list"
        assert box(mini)["x"] + box(mini)["width"] <= box(grid)["x"] + LANE_TOLERANCE
        edge = box(grid)["x"] / DESKTOP[0]
        assert 0.17 <= edge <= 0.27, f"rail ends about 22% in, got {edge}"
        assert abs(box(button(page, "Today"))["x"] - box(grid)["x"]) <= 40, "toolbar and grid share the edge"
    with screen(browser, app_url, "edith", path, size=TABLET) as page:
        mini, cals, grid = role(page, "region", "Mini month"), role(page, "group", "Calendars"), role(page, "region", "Week grid")
        expect(grid).to_be_visible()
        drawn(page)
        assert box(button(page, "New event"))["y"] < box(mini)["y"]
        assert box(mini)["x"] < box(cals)["x"] and box(mini)["y"] < box(cals)["y"] + box(cals)["height"]
        assert box(cals)["y"] < box(mini)["y"] + box(mini)["height"], "mini month and list share one row"
        assert box(grid)["y"] >= max(box(mini)["y"] + box(mini)["height"], box(cals)["y"] + box(cals)["height"]) - LANE_TOLERANCE
        assert box(grid)["width"] >= TABLET[0] * 0.9, "grid at full width"
    with screen(browser, app_url, "edith", path, size=PHONE) as page:
        schedule = role(page, "list", "Schedule")
        view = role(page, "radiogroup", "View")
        expect(radio(view, "Schedule")).to_be_checked()
        expect(radio(view, "Day")).to_have_count(1)
        for hidden in ("Week", "Month", "Custom days"):
            expect(radio(view, hidden)).to_have_count(0)
        drawn(page)
        assert box(button(page, "Calendars"))["y"] < box(schedule)["y"] if schedule.count() and schedule.is_visible() else True
        expect(role(page, "region", "Mini month")).to_have_count(0)
        click(button(page, "Calendars"))
        sheet = dialog(page, "Calendars")
        expect(role(sheet, "region", "Mini month")).to_be_visible()
        expect(role(sheet, "group", "Calendars")).to_be_visible()
    for size, low, high in ((DESKTOP, 0.17, 0.27), (TABLET, 0.06, 0.14)):
        with screen(browser, app_url, None, "/signin", size=size) as page:
            field = box(textbox(page, "Email"))
            assert low <= field["x"] / size[0] <= high, f"column edge at {size}"
            assert field["width"] <= COLUMN_MAX_PX
            drawn(page)
    with screen(browser, app_url, None, "/signin", size=PHONE) as page:
        field = box(textbox(page, "Email"))
        assert abs(field["x"] - (PHONE[0] - field["x"] - field["width"])) <= 8, "even side margins"
        drawn(page)
        axe(page)


def test_wf_cross_cutting_sign_in(browser, app_url):
    with screen(browser, app_url, None, "/signin") as page:
        fill(textbox(page, "Email"), f"marit{DOMAIN}")

        fill(textbox(page, "Passcode"), "wrong-code")
        click(button(page, "Sign in"))
        see_copy(page, "That email and passcode do not match.")
        fill(textbox(page, "Passcode"), PASSCODE)
        with held(page, "**/api/session") as hold:
            click(button(page, "Sign in"))
            says(page, "Signing in...")
            hold.release()
        expect(page).to_have_url(re.compile("/calendar"))
    wrong = httpx.post(f"{app_url}/api/session", json={"email": f"marit{DOMAIN}", "passcode": "wrong-code"}, timeout=HTTP_S)
    assert wrong.status_code == 401 and wrong.json()["error"] == "bad_credentials"
    marit = api(app_url, "marit")
    me = marit.get("/api/me").json()
    assert (me["id"], me["name"], me["role"], me["city"]) == ("p-marit", NAMES["marit"], "office_manager", "London")

    def check_people(base: str) -> None:
        people = api(base, "marit").get("/api/people").json()["people"]
        names = [p["name"] for p in people]
        others = sorted(n for n in NAMES.values() if n != NAMES["marit"])
        assert sorted(n for n in names if n != NAMES["marit"]) == others and names.count(NAMES["marit"]) <= 1, "each seeded person exactly once"

    check_people(app_url)
    calendars = {c["id"]: c for c in marit.get("/api/calendars").json()["calendars"]}
    assert calendars["cal-firm"]["name"] == "Firm calendar" and calendars["cal-holidays"]["name"] == "Public holidays"
    assert marit.get("/api/settings").json()["office_hours"][NY]["open"] == "09:00"
    observer = Postgres()
    stored = sum(observer.rows(f"""SELECT count(*) AS n FROM {'.'.join(f'"{part}"' for part in t.split('.'))} x WHERE x::text LIKE '%{NAMES["marit"]}%'""")[0]["n"] for t in observer.tables())
    assert stored >= 1, "seeded people live in Postgres"
    with app_copy({}) as (copy, tail):
        poll(lambda: health(copy) == 200, 60.0, f"second start became healthy; log: {tail()}")
        check_people(copy)
        _SESSIONS.pop((copy, "marit"), None)


@contextmanager
def app_copy(extra: dict[str, str]):
    manifest = json.loads(Path("/app/run.json").read_text())
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    env = {**os.environ, "APP_PUBLIC_PORT": str(COPY_PORT), **extra}
    process = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        return Path(log.name).read_text()[-2000:]

    try:
        yield f"http://127.0.0.1:{COPY_PORT}", tail
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        process.wait(timeout=30)


def health(base: str) -> int | None:
    try:
        return httpx.get(f"{base}/api/health", timeout=5).status_code
    except httpx.HTTPError:
        return None


def test_platform_boundary(app_url):
    healthy = httpx.get(f"{app_url}/api/health", timeout=HTTP_S)
    assert healthy.status_code == 200 and healthy.json() == {"status": "ok"}
    assert parse_utc(httpx.get(f"{app_url}/api/time", timeout=HTTP_S).json()["now_utc"])
    anonymous = httpx.get(f"{app_url}/api/me", timeout=HTTP_S)
    assert anonymous.status_code == 401 and anonymous.json()["error"] == "unauthenticated" and anonymous.json()["message"]
    plain = httpx.post(f"{app_url}/api/session", content="{}", headers={"Content-Type": "text/plain"}, timeout=HTTP_S)
    assert plain.status_code == 415
    foreign = {"Origin": "http://evil.example"}
    crossed = httpx.post(f"{app_url}/api/session", json={"email": "x", "passcode": "y"}, headers=foreign, timeout=HTTP_S)
    assert crossed.status_code == 403 and crossed.json()["error"] == "cross_origin"
    assert not [k for k in crossed.headers if k.lower().startswith(CORS_PREFIX)]
    limit = 1000000
    prefix, suffix = b'{"email":"', b'","passcode":"x"}'
    exact = prefix + b"a" * (limit - len(prefix) - len(suffix)) + suffix
    assert httpx.post(f"{app_url}/api/session", content=exact, headers={"Content-Type": "application/json"}, timeout=HTTP_S).status_code != 413
    over = httpx.post(f"{app_url}/api/session", content=exact + b" ", headers={"Content-Type": "application/json"}, timeout=HTTP_S)
    assert over.status_code == 413
    for path, marker in (("/run.json", "run-manifest-v1"), ("/go.mod", "module "), ("/package.json", "dependencies"), ("/.env", "DATABASE_URL")):
        answer = httpx.get(f"{app_url}{path}", timeout=HTTP_S)
        assert answer.status_code != 200 or marker not in answer.text, path
    assert Postgres().tables(), "schema applied on serve"
    with app_copy({"DATABASE_URL": "postgres://nobody:nothing@127.0.0.1:9/none"}) as (copy, tail):
        poll(lambda: health(copy) == 503, 60.0, f"copy answers 503 while Postgres is unreachable; log: {tail()}")
        assert httpx.get(f"{copy}/api/health", timeout=HTTP_S).json() == {"status": "starting"}


def test_status_region(browser, app_url):
    with screen(browser, app_url, "rafe", "/settings") as page:
        for path in ("/", "/signin", "/calendar", "/find", "/search", "/trash", "/sharing", "/zone-rules", "/settings", "/share/nothing", "/nothing-here"):
            with held(page, "**/api/**") as hold:
                page.goto(f"{app_url}{path}")
                expect(status(page)).to_have_count(1)
                assert status(page).get_attribute("aria-live") in (None, "polite"), path
                hold.release()
        page.goto(f"{app_url}/nothing-here")
        expect(page.get_by_role("heading", level=1, name="Nothing is scheduled at this address.")).to_be_visible()
        expect(role(page, "link", "Back to the calendar")).to_be_visible()
        page.goto(f"{app_url}/calendar")
        expect(role(page, "link", "Skip to calendar")).to_have_count(1)
        listen(page)
        click(role(page, "button", "Next"))
        nav = role(page, "navigation", "Main")
        for name in ("Calendar", "Find a time", "Search", "Trash", "Zone rules", "Sharing", "Settings"):
            expect(role(nav, "link", name)).to_have_count(1)
        expect(role(nav, "link", "Prints")).to_have_count(0)
    with screen(browser, app_url, "sam", "/calendar") as page:
        nav = role(page, "navigation", "Main")
        expect(nav.get_by_role("link")).to_have_count(2)
    with screen(browser, app_url, None, "/") as page:
        panel = role(page, "region", "Three clocks example")
        for piece in ("Partners' weekly", "Tue 6 Oct 2026", "09:00 New York", "14:00 London", "02:00 Auckland", "Client readout", "11:30 New York", "16:30 London", "04:30 Auckland"):
            expect(panel).to_contain_text(piece)
        see_copy(page, "One shared calendar for New York, London and Auckland, where a weekly meeting never drifts and nothing goes through email.")
        axe(page)


def test_phone_schedule_reduced_motion(browser, app_url):
    callum = api(app_url, "callum")
    monday = fresh_monday()
    title = title_of("Phone")
    new_event(callum, title, stamp(monday, "10:00"), stamp(monday, "11:00"), zone=NY)
    with screen(browser, app_url, "callum", f"/calendar?view=schedule&date={iso(monday)}&calendars=cal-callum", size=PHONE, reduced=True) as page:
        schedule = role(page, "list", "Schedule")
        item = button(schedule, f"{title}, 10:00 to 11:00")
        expect(item).to_be_visible()
        drawn(page)
        for control in page.get_by_role("button").all():
            if control.is_visible():
                found = box(control)
                assert found["width"] >= TARGET_PX and found["height"] >= TARGET_PX, control.aria_snapshot()
        page.evaluate(MOTION_HOOK)
        click(button(page, "New event"))
        form = dialog(page, "New event")
        expect(form).to_be_visible()
        assert [d for d in motion_events(page) if d > 0] == [], "dialogs appear at once"
        assert animations(form) == []
        fill(textbox(form, "Title"), title_of("Phone made"))
        page.keyboard.press("Escape")
        expect(form).to_have_count(0)
        item.focus()
        page.keyboard.press("Enter")
        expect(button(dialog(page, title), "Open event")).to_be_visible()


def test_phone_schedule_keeps_day(browser, app_url):
    noor = api(app_url, "noor")
    monday = fresh_monday()
    days = [monday + timedelta(days=n) for n in (0, 3, 6, 9, 12)]
    for d in days:
        for hour in ("10", "11", "12", "13"):
            new_event(noor, title_of("Row"), stamp(d, f"{hour}:00"), stamp(d, f"{hour}:30"), zone=NY)
    with screen(browser, app_url, "noor", f"/calendar?view=schedule&date={iso(monday)}&calendars=cal-noor", size=PHONE) as page:
        heading = lambda d: button(role(page, "list", "Schedule"), label(d))
        first = heading(days[0])
        expect(first).to_be_visible()
        first.focus()
        for key, d in (("ArrowDown", days[1]), ("ArrowUp", days[0]), ("End", days[4]), ("Home", days[0]), ("End", days[4]), ("ArrowUp", days[3])):
            page.keyboard.press(key)
            expect(heading(d)).to_be_focused()
            in_view(heading(d))
        before = box(heading(days[3]))["y"]
        added = title_of("Above")
        new_event(noor, added, stamp(days[0], "14:00"), stamp(days[0], "15:00"), zone=NY)
        expect(role(page, "list", "Schedule").get_by_role("button", name=re.compile(re.escape(added)))).to_have_count(1, timeout=LIVE_MS)
        poll(lambda: abs(box(heading(days[3]))["y"] - before) <= SCHEDULE_TOLERANCE, 3.0, "focused day stays in place within 4 pixels")
        expect(heading(days[3])).to_be_focused()
        in_view(heading(days[3]))


ALLOWED_LICENCES = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "BSD", "0BSD", "Apache-2.0", "ISC", "MPL-2.0"}


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_notices_list_packages():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    assert "Sora" in notices


ISC_GRANT = re.compile(
    r"permission to use, copy, modify, and(/or)? distribute this software for any purpose with or without fee is hereby "
    r"granted, provided that the above copyright notice and this permission notice appear in all copies")


def module_folder(package) -> Path:
    vendored = Path(DEPLOYED_APP) / "vendor" / package.name
    if vendored.is_dir():
        return vendored
    escape = lambda text: re.sub(r"[A-Z]", lambda m: f"!{m[0].lower()}", text)
    return APP_HOME / "go" / "pkg" / "mod" / f"{escape(package.name)}@{escape(package.version)}"


def own_licence(package) -> str:
    if package.licence:
        return package.licence
    for path in sorted(module_folder(package).glob("*")):
        if path.is_file() and re.match(r"(?i)licen[cs]e|copying", path.name):
            if ISC_GRANT.search(" ".join(path.read_text(errors="replace").lower().split())):
                return "ISC"
    return ""


def test_if_licences_allowed():
    refused = [(p.name, own_licence(p)) for p in shipped_packages() if not licence_allowed(own_licence(p), ALLOWED_LICENCES)]
    assert not refused, refused
    assert re.search(r"Sora[\s\S]{0,200}(SIL|OFL)", Path("/app/THIRD_PARTY_NOTICES.md").read_text())


def test_if_only_postgres_and_minio():
    stores = re.compile(r"sqlite|bbolt|boltdb|badger|leveldb|redis|valkey|memcache|duckdb|lmdb|nedb|lowdb", re.I)
    assert not [p.name for p in shipped_packages() if stores.search(p.name)]
    stray = [str(f) for pattern in ("*.sqlite", "*.sqlite3", "*.db") for f in Path(DEPLOYED_APP).rglob(pattern) if "node_modules" not in f.parts]
    assert not stray, stray


def test_if_lockfiles_committed():
    root = Path("/app")
    assert list(root.glob("go.sum")) or list(root.glob("*/go.sum")), "go.sum"
    assert list(root.glob("package-lock.json")) or list(root.glob("*/package-lock.json")), "package-lock.json"


def test_if_no_credentials_in_source():
    names = ("DATABASE_URL", "GOTENBERG_URL", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY")
    values = [os.environ[n] for n in names if len(os.environ.get(n, "")) >= 6]
    skipped = {"node_modules", ".git", "dist", "build", "bin", "vendor"}
    pattern = re.compile(r"postgres(ql)?://[^\s:'\"]+:[^\s@'\"]+@")
    hits = []
    for file in Path("/app").rglob("*"):
        if not file.is_file() or skipped & set(file.parts) or file.stat().st_size > 2000000:
            continue
        try:
            text = file.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        if pattern.search(text) or any(v in text for v in values):
            hits.append(str(file))
    assert not hits, hits


def test_if_same_origin_pages(browser, app_url):
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    with screen(browser, app_url, "rafe", "/settings") as page:
        seen: list[tuple[str, str]] = []
        page.on("request", lambda r: seen.append((r.url, r.resource_type)))
        for path in ("/", "/signin", "/calendar", "/find", "/search", "/settings"):
            page.goto(f"{app_url}{path}")
            expect(status(page)).to_have_count(1)
    foreign = [u for u, kind in seen if kind in ("script", "stylesheet", "font") and not same_origin(u, origin)]
    assert seen and not foreign, foreign
