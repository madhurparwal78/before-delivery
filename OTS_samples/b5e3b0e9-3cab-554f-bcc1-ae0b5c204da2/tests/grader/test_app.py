from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time
import uuid
from contextlib import contextmanager
from functools import cached_property
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from conftest import (
    S3,
    Postgres,
    addresses,
    advance,
    animations,
    axe,
    center,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    pdf_text,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    text,
    unique,
)

UI_WAIT_MS = 15_000
HTTP_TIMEOUT = 120.0
MAIL_WAIT = 20.0
SYNC_WAIT_MS = 1_500
SYNC_TRIES = 10
GRACE_POLLS = 15
GRACE_POLL_MS = 2_000
GRADING_KEY = os.environ.get("GRADING_KEY", "gf-grading-5e2a71")
PASSWORD = "runway-practice-1"
WRONG_DEVICE_TIME = "2031-01-01T03:00:00Z"
DEVICE_ADVANCE_MS = 60_000

DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
SIZES = {"desktop": DESKTOP, "tablet": TABLET, "phone": PHONE}
TOUCH_MIN = 44
LAYOUT_LIMIT = 20000
COMMAND_LIMIT = 600
LIT_STEP_MS = 90
STOP_BAR_MS = 200
RETRACT_MS = 250
RETRACT_MAX_MS = 400
MOVE_PRESENT_MS = 120
MOVE_GONE_MS = 400
PULSE_PRESENT_MS = 800
PULSE_GONE_MS = 1700
FLASH_PRESENT_MS = 400
FLASH_GONE_MS = 900
OUTLINE_PRESENT_MS = 1800
OUTLINE_GONE_MS = 2300
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "OFL-1.1"}
NOTICE = "Training only. Fictional aerodromes. Not for real air traffic control."
PROBE_ONLY = "GZZZZ"
DRAFT = "draft"
PROBE_PUSH = "GCCCC"
PROBE_POINT = "Z9"
PROBE_DRAG = "GAAAA"
KEPT = "still here"
PROBE_OFFR = "GOFFR"
PROBE_OVER = "GOVER"
PROBE_TAXI = "GTAXI"
PROBE_EMRG = "GEMRG"
DRAFT_LINE = "GABCD PU"

WAKE_MINIMUMS = {
    ("J", "L"): 180, ("J", "M"): 180, ("J", "H"): 120, ("J", "J"): 120,
    ("H", "L"): 120, ("H", "M"): 120, ("H", "H"): 90, ("H", "J"): 90,
    ("M", "L"): 90, ("M", "M"): 60, ("M", "H"): 60, ("M", "J"): 60,
    ("L", "L"): 60, ("L", "M"): 60, ("L", "H"): 60, ("L", "J"): 60,
}

WORKED_LAYOUT = """{
  "name": "Marram Flats",
  "code": "MRF",
  "runways": [
    {
      "id": "09/27",
      "lengthM": 1200,
      "thresholds": [
        {"id": "09", "node": "M09", "heading": 90},
        {"id": "27", "node": "M27", "heading": 270}
      ]
    }
  ],
  "nodes": [
    {"id": "M09", "kind": "threshold", "x": 100, "y": 100},
    {"id": "M27", "kind": "threshold", "x": 900, "y": 100},
    {"id": "H1", "kind": "holding", "x": 800, "y": 200, "serves": "27"},
    {"id": "H2", "kind": "holding", "x": 200, "y": 200, "serves": "09"},
    {"id": "J1", "kind": "junction", "x": 500, "y": 200},
    {"id": "P1", "kind": "stand", "x": 500, "y": 400}
  ],
  "segments": [
    {
      "id": "B1",
      "from": "J1",
      "to": "H1",
      "lengthM": 300,
      "speedMps": 10,
      "taxiway": "B"
    },
    {
      "id": "B2",
      "from": "H2",
      "to": "J1",
      "lengthM": 300,
      "speedMps": 10,
      "taxiway": "B"
    },
    {
      "id": "P1T",
      "from": "P1",
      "to": "Q7",
      "lengthM": 200,
      "speedMps": 5,
      "taxiway": "apron"
    }
  ]
}
"""

POLL_MS = 100
PUMP_STEP_MS = 5
PUMP_CHECK_MS = 100
_expect = expect
_expect.set_options(timeout=UI_WAIT_MS)


class Probe:

    def __init__(self, page: Page, selector: str):
        self.page = page
        self.selector = selector

    def count(self) -> int:
        return self.page.evaluate("s => document.querySelectorAll(s).length", self.selector)

    def ids(self) -> list[str]:
        return self.page.evaluate(
            "s => [...document.querySelectorAll(s)].map(e => e.getAttribute('data-segment-id'))", self.selector)

    def wait(self, script: str, arg: Any, contract: str) -> None:
        try:
            self.page.wait_for_function(script, arg=arg, polling=POLL_MS, timeout=UI_WAIT_MS)
        except PlaywrightTimeout:
            pytest.fail(f"{self.selector}: expected {contract}")


class ProbeExpect:
    def __init__(self, probe: Probe):
        self.probe = probe

    def to_have_count(self, number: int) -> None:
        self.probe.wait("([s, n]) => document.querySelectorAll(s).length === n", [self.probe.selector, number],
                        f"{number} matching objects")

    def to_be_attached(self) -> None:
        self.probe.wait("([s]) => document.querySelectorAll(s).length > 0", [self.probe.selector], "an attached object")

    def to_have_attribute(self, name: str, value: str) -> None:
        self.probe.wait("([s, a, v]) => { const e = document.querySelector(s); return !!e && e.getAttribute(a) === v; }",
                        [self.probe.selector, name, value], f"{name}={value}")

    def not_to_have_attribute(self, name: str, value: str) -> None:
        self.probe.wait("([s, a, v]) => { const e = document.querySelector(s); return !e || e.getAttribute(a) !== v; }",
                        [self.probe.selector, name, value], f"{name} not {value}")

    def to_contain_text(self, fragment: str) -> None:
        self.probe.wait("([s, t]) => { const e = document.querySelector(s); return !!e && e.textContent.includes(t); }",
                        [self.probe.selector, fragment], f"text containing {fragment}")


def expect(target: Any) -> Any:
    return ProbeExpect(target) if isinstance(target, Probe) else _expect(target)


def svg_object(page: Page, attribute: str, value: str) -> Probe:
    return Probe(page, f'svg [{attribute}="{value}"]')


def lit_segments(page: Page, lit: str) -> Probe:
    return Probe(page, f'svg [data-segment-id][data-lit="{lit}"]')


def taxi_readback(point: str, cs: str) -> str:
    return f"Taxi holding point {point}, {cs}."


def cross_readback(rwy: str, point: str, cs: str) -> str:
    return f"Cross runway {rwy} at {point}, {cs}."


def conflict_text(cs: str) -> str:
    return f"{cs} was changed by another seat first. Your action was not applied."


def due_text(seconds: int) -> str:
    return f"Due {mss(seconds)}"


def dup_text(cs: str) -> str:
    return f"Callsign {cs} is used more than once."


def shape_text(word: str) -> str:
    return f"Callsign {word} must be 5 capital letters."


def stand_text(stand: str, aerodrome: str) -> str:
    return f"Stand {stand} is not on {aerodrome}."


def wind_text(direction: int, knots: int) -> str:
    return f"{direction:03d} at {knots} kt"


def change_text(rwy: str, seconds: int) -> str:
    return f"Runway change to {rwy} in {mss(seconds)}"


def lineup_line(cs: str, rwy: str) -> str:
    return f"{cs} LINEUP {rwy}"


def person(prefix: str) -> SimpleNamespace:
    first, second = unique(prefix)
    email, name = (first, second) if "@" in first else (second, first)
    if "@" not in email:
        email = f"{email}@runupbay.test"
    return SimpleNamespace(name=name, email=email.lower(), password=PASSWORD)


def dep(cs, stand="S1", hp="A1", type_="C172", wake="L", rules="VFR", appear=0, slot=None, overruns=False):
    return {"callsign": cs, "type": type_, "wake": wake, "rules": rules, "kind": "dep", "stand": stand,
            "holdingPoint": hp, "appearAt": appear, "slotSeconds": slot, "overrunsHold": overruns}


def arr(cs, due=600, runway="27", type_="B738", wake="M", rules="IFR", appear=0):
    return {"callsign": cs, "type": type_, "wake": wake, "rules": rules, "kind": "arr", "runway": runway,
            "appearAt": appear, "dueSeconds": due, "slotSeconds": None, "overrunsHold": False}


def sim(seconds: int) -> str:
    return f"12:{seconds // 60:02d}:{seconds % 60:02d}"


def mss(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def grading(base: str, body: dict) -> dict:
    r = httpx.post(base + "/api/grading/setup", json=body, headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"POST /api/grading/setup: {r.status_code} {r.text}"
    return r.json()


class Api:

    def __init__(self, base: str, who: SimpleNamespace | None = None):
        self.client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        if who is not None:
            r = self.client.post("/api/session", json={"email": who.email, "password": who.password})
            assert r.status_code == 200, f"sign-in failed: {r.status_code} {r.text}"

    def get(self, path: str) -> httpx.Response:
        return self.client.get(path)

    def post(self, path: str, body: Any = None) -> httpx.Response:
        return self.client.post(path, json=body) if body is not None else self.client.post(path)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.client.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.client.delete(path)


class World:

    def __init__(self, base, traffic, *, name=None, aerodrome="wrenfield", runway="27", wind_dir=270, wind_kt=8,
                 start="12:00:00", duration=3600, seed=1, every=0, events=(), with_session=True, seated=True,
                 strips=(), sim_time=None, script=(), end_at=None):
        self.base = base
        self.tag = uuid.uuid4().hex[:10]
        self.instructor, self.ground, self.tower, self.spare = (
            person(p) for p in ("instructor", "ground", "tower", "spare"))
        self.school_key, self.class_key = f"school-{self.tag}", f"class-{self.tag}"
        self.class_name = f"Class {self.tag}"
        people = [self.instructor, self.ground, self.tower, self.spare]
        out = grading(base, {
            "users": [{"email": p.email, "name": p.name, "password": p.password, "verified": True} for p in people],
            "schools": [{"key": self.school_key, "name": f"School {self.tag}", "instructor": self.instructor.email,
                         "classes": [{"key": self.class_key, "name": self.class_name,
                                      "students": [self.ground.email, self.tower.email, self.spare.email]}]}],
        })
        self.ids = {u["email"]: u["id"] for u in out["users"]}
        self.school = out["schools"][self.school_key]["id"]
        self.class_id = out["schools"][self.school_key]["classes"][self.class_key]
        self.scenario_ids: dict[str, str] = {}
        self.scenario_name = name or f"Scenario {self.tag}"
        self.scenario_key = self.add_scenario(
            traffic, name=self.scenario_name, aerodrome=aerodrome, runway=runway, wind_dir=wind_dir, wind_kt=wind_kt,
            start=start, duration=duration, seed=seed, every=every, events=events)
        self.scenario = self.scenario_ids[self.scenario_key]
        self.session = None
        if with_session:
            self.session = self.add_session(strips=strips, sim_time=sim_time, script=script, end_at=end_at, seated=seated)

    def add_scenario(self, traffic, *, name=None, aerodrome="wrenfield", runway="27", wind_dir=270, wind_kt=8,
                     start="12:00:00", duration=3600, seed=1, every=0, events=()) -> str:
        key = f"scenario-{uuid.uuid4().hex[:10]}"
        out = grading(self.base, {"users": [], "scenarios": [{
            "key": key, "school": self.school_key, "aerodrome": aerodrome, "name": name or key, "runwayInUse": runway,
            "windDir": wind_dir, "windKt": wind_kt, "startSimTime": start, "durationSeconds": duration, "seed": seed,
            "readbackErrorEvery": every, "traffic": list(traffic), "events": list(events)}]})
        self.scenario_ids[key] = out["scenarios"][key]
        return key

    def add_assignment(self, scenario_key: str, due_on: str) -> str:
        key = f"assignment-{uuid.uuid4().hex[:10]}"
        grading(self.base, {"users": [], "assignments": [
            {"key": key, "class": self.class_key, "scenario": scenario_key, "dueOn": due_on}]})
        return key

    def add_session(self, scenario_key=None, *, strips=(), sim_time=None, script=(), end_at=None, assignment=None,
                    seated=True) -> str:
        key = f"session-{uuid.uuid4().hex[:10]}"
        body: dict[str, Any] = {"key": key, "scenario": scenario_key or self.scenario_key, "strips": list(strips)}
        if seated:
            body["seats"] = {"GND": self.ground.email, "TWR": self.tower.email}
        if script:
            body["script"] = list(script)
        if sim_time is not None:
            body["simTime"] = sim_time
        if end_at is not None:
            body["endAt"] = end_at
        if assignment is not None:
            body["assignment"] = assignment
        return grading(self.base, {"users": [], "sessions": [body]})["sessions"][key]

    @cached_property
    def ins(self) -> Api:
        return Api(self.base, self.instructor)

    @cached_property
    def gnd(self) -> Api:
        return Api(self.base, self.ground)

    @cached_property
    def twr(self) -> Api:
        return Api(self.base, self.tower)

    @cached_property
    def other(self) -> Api:
        return Api(self.base, self.spare)


WORKED_TRAFFIC = [dep("GBULK", stand="S3", type_="B744", wake="H", rules="IFR"),
                  dep("GLITE", stand="S4", type_="PA28", wake="L", rules="VFR")]
WORKED_SCRIPT = [
    {"at": 0, "position": "GND", "command": "GBULK PUSH APPROVED"},
    {"at": 30, "position": "GND", "command": "GBULK TAXI HP A1 VIA A"},
    {"at": 40, "position": "GND", "command": "GBULK CONTACT TOWER"},
    {"at": 41, "position": "TWR", "move": {"callsign": "GBULK", "to": "Holding"}},
    {"at": 60, "position": "GND", "command": "GLITE PUSH APPROVED"},
    {"at": 100, "position": "TWR", "command": "GBULK LINEUP 27"},
    {"at": 120, "position": "TWR", "command": "GBULK CLEARED TAKEOFF 27"},
    {"at": 120, "position": "GND", "command": "GLITE TAXI HP A1 VIA A"},
    {"at": 191, "position": "GND", "command": "GLITE CONTACT TOWER"},
    {"at": 192, "position": "TWR", "move": {"callsign": "GLITE", "to": "Holding"}},
    {"at": 192, "position": "TWR", "command": "GLITE LINEUP 27"},
    {"at": 212, "position": "TWR", "command": "GLITE CLEARED TAKEOFF 27"},
]
WORKED_END_AT = 300
WORKED_LENGTH = 242


def worked(base: str, **options) -> World:
    return World(base, WORKED_TRAFFIC, name="Wake check", every=0, script=WORKED_SCRIPT, end_at=WORKED_END_AT, **options)


def send(api: Api, sid: str, line: str, ok: bool = True) -> httpx.Response:
    r = api.post(f"/api/sessions/{sid}/commands", {"text": line})
    if ok:
        assert r.status_code == 200, f"command {line!r}: {r.status_code} {r.text}"
    return r


def refused(api: Api, sid: str, line: str, message: str, status: int = 422) -> None:
    r = send(api, sid, line, ok=False)
    assert r.status_code == status, f"{line!r}: {r.status_code} {r.text}"
    assert r.json()["message"] == message, f"{line!r}: {r.text}"


def tick(w: World, count: int = 1, sid: str | None = None) -> dict:
    r = httpx.post(f"{w.base}/api/grading/sessions/{sid or w.session}/clock", json={"advance": count},
                   headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"grading clock: {r.status_code} {r.text}"
    return r.json()


def hold(w: World, position: str, flag: bool) -> None:
    r = httpx.post(f"{w.base}/api/grading/sessions/{w.session}/hold-updates", json={"position": position, "hold": flag},
                   headers={"X-Grading-Key": GRADING_KEY}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, r.text


def state(w: World, sid: str | None = None) -> dict:
    r = w.ins.get(f"/api/sessions/{sid or w.session}/state")
    assert r.status_code == 200, r.text
    return r.json()


def plane(st: dict, cs: str) -> dict:
    for row in st["aircraft"]:
        if row["callsign"] == cs:
            return row
    pytest.fail(f"state.aircraft has no row for {cs}")


def copies(st: dict, cs: str) -> list[dict]:
    return [row for row in st["strips"] if row["callsign"] == cs]


def copy_in(st: dict, cs: str, bay_name: str) -> dict:
    for row in copies(st, cs):
        if row["bay"] == bay_name:
            return row
    pytest.fail(f"state.strips has no {cs} copy in {bay_name}")


def move(api: Api, w: World, cs: str, to: str, version: int, sid: str | None = None) -> httpx.Response:
    return api.post(f"/api/sessions/{sid or w.session}/strips/{cs}/move", {"to": to, "version": version})


def accept(w: World, cs: str, sid: str | None = None) -> None:
    version = copy_in(state(w, sid), cs, "Hand-off")["version"]
    r = move(w.twr, w, cs, "Holding", version, sid)
    assert r.status_code == 200, r.text


def event(w: World, body: dict, sid: str | None = None) -> httpx.Response:
    return w.ins.post(f"/api/sessions/{sid or w.session}/events", body)


def end(w: World, sid: str | None = None) -> None:
    r = w.ins.post(f"/api/sessions/{sid or w.session}/end")
    assert r.status_code == 200, r.text


def debrief(w: World, sid: str | None = None) -> dict:
    r = w.ins.get(f"/api/sessions/{sid or w.session}/debrief")
    assert r.status_code == 200, r.text
    return r.json()


def rules(alerts: list[dict]) -> list[str]:
    return [a["rule"] for a in alerts]


def rows_of(log: list[dict], kind: str | None = None) -> list[tuple[str, str]]:
    return [(row["position"], row["text"]) for row in log if kind is None or row["kind"] == kind]


def mails(mail, address: str, subject: str, count: int = 1) -> list[dict]:
    deadline = time.monotonic() + MAIL_WAIT
    while time.monotonic() < deadline:
        found = matching(mail.messages(settle=0.5), address, subject)
        if len(found) >= count:
            return found
    pytest.fail(f"Mailpit never held {count} mail with subject {subject!r} to {address}")


def matching(messages: list[dict], address: str, subject: str) -> list[dict]:
    return [m for m in messages if m.get("Subject") == subject and address in [a.lower() for a in addresses(m.get("To"))]]


def link_in(message: dict, pattern: str) -> str:
    links = set(re.findall(pattern, text(message)))
    assert len(links) == 1, f"expected one link matching {pattern}, got {links}"
    return links.pop()


@contextmanager
def client(browser: Browser, base: str, who: SimpleNamespace | None, path: str, *, size=DESKTOP, reduced=False,
           wrong_clock=False) -> Iterator[Page]:
    motion_mode = "reduce" if reduced else "no-preference"
    with open_app(browser, base + "/signin", reduced_motion=motion_mode) as page:
        page.clock.resume()
        session(page).send("Page.setBypassCSP", {"enabled": True})
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if who is not None:
            r = page.request.post(base + "/api/session", data={"email": who.email, "password": who.password})
            assert r.status == 200, r.text()
        if wrong_clock:
            page.clock.set_fixed_time(WRONG_DEVICE_TIME)
        page.goto(base + path)
        yield page


def connected(page: Page, w: World, sid: str | None = None) -> None:
    sid = sid or w.session
    clock = role(page, "status", "Sim clock")
    expect(clock).to_be_visible()
    for _ in range(SYNC_TRIES):
        for speed in (2, 1):
            assert w.ins.post(f"/api/sessions/{sid}/speed", {"speed": speed}).status_code == 200
        w.ins.post(f"/api/sessions/{sid}/speed", {"speed": 2})
        try:
            expect(clock).to_have_attribute("data-speed", "2", timeout=SYNC_WAIT_MS)
            w.ins.post(f"/api/sessions/{sid}/speed", {"speed": 1})
            expect(clock).to_have_attribute("data-speed", "1", timeout=SYNC_WAIT_MS)
            return
        except AssertionError:
            continue
    pytest.fail("a speed change never reached the page: pushed updates must show live on every client")


@contextmanager
def seated(browser: Browser, w: World, who: SimpleNamespace, *, size=DESKTOP, reduced=False, wrong_clock=False,
           sid: str | None = None, paused=False) -> Iterator[Page]:
    with client(browser, w.base, who, f"/sessions/{sid or w.session}", size=size, reduced=reduced,
                wrong_clock=wrong_clock) as page:
        connected(page, w, sid)
        if paused:
            page.clock.pause_at(page.evaluate("Date.now()") + 1)
        yield page


def pumped(page: Page, check: Callable[[], None]) -> None:
    for _ in range(UI_WAIT_MS // PUMP_CHECK_MS):
        try:
            check()
            return
        except AssertionError:
            page.clock.run_for(PUMP_STEP_MS)
    pytest.fail("the page never showed the starting state of a timed effect, even with the page clock moving")


def choice_point(locator: Locator) -> tuple[float, float]:
    expect(locator).to_be_enabled()
    target = locator.evaluate_handle("""e => {
        e.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
        const r = e.getBoundingClientRect();
        const hit = r.width > 0 && r.height > 0 ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
        const label = e.labels && e.labels[0];
        return hit && (hit === e || e.contains(hit)) || !label ? e : label; }""").as_element()
    assert target is not None, "the control has no element to press"
    target.scroll_into_view_if_needed()
    box = target.bounding_box()
    assert box is not None, "neither the control nor its label is shown"
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def tap_choice(locator: Locator) -> None:
    locator.page.touchscreen.tap(*choice_point(locator))


def check_choice(locator: Locator) -> None:
    if not locator.is_checked():
        locator.page.mouse.click(*choice_point(locator))
    expect(locator).to_be_checked()


def role(scope, kind: str, name: str) -> Locator:
    return scope.get_by_role(kind, name=name, exact=True)


def bay(scope, name: str) -> Locator:
    return role(scope, "list", name)


def strip_in(scope, bay_name: str, cs: str) -> Locator:
    return bay(scope, bay_name).get_by_role("listitem", name=re.compile(rf"^{cs}, "))


def any_copy(scope, cs: str) -> Locator:
    return scope.get_by_role("listitem", name=re.compile(rf"^{cs}, "))


def command(page: Page) -> Locator:
    return role(page, "textbox", "Command")


def command_error(page: Page) -> Locator:
    return role(page, "alert", "Command error")


def symbol(page: Page, cs: str) -> Locator:
    return role(page, "button", f"Aircraft {cs}")


def position_row(scope, cs: str) -> Locator:
    return role(scope, "list", "Aircraft positions").get_by_role("listitem").filter(has_text=re.compile(rf"^{cs} "))


TIMER_WORDS = {"wake": "Wake", "offer": "Offer", "due": "Due", "slot": "Slot"}


def timer(scope: Locator, kind: str) -> Locator:
    return scope.get_by_text(re.compile(rf"^{TIMER_WORDS[kind]} "))


def top_alert(page: Page) -> Locator:
    return role(page, "list", "Alerts").get_by_role("listitem").first


def sim_clock(page: Page) -> Locator:
    return role(page, "status", "Sim clock")


def notice(page: Page) -> Locator:
    return role(page, "status", "Runway notice")


def no_notice(page: Page) -> None:
    expect(page.get_by_role("status", name="Runway notice", exact=True, include_hidden=True)).to_have_text("")


def shown_count(found: Locator) -> int:
    return found.evaluate_all("els => els.filter(e => e.getClientRects().length > 0).length")


def no_alerts(page: Page) -> Locator:
    return page.get_by_text("No alerts yet.", exact=True)


def closed_word(page: Page) -> Locator:
    return role(page, "region", "Airfield map").get_by_text(re.compile(r"\bCLOSED\b")).first


def type_line(page: Page, line: str) -> None:
    box = command(page)
    fill(box, line)
    box.press("Enter")


def form_status(page: Page, message: str) -> None:
    found = page.get_by_role("status", name="Form status", exact=True).filter(has_text=message).first
    expect(found).to_have_text(message)


def release(gate: Any) -> None:
    getattr(gate, "release", gate)()


def segment_ids(page: Page, lit: str) -> list[str]:
    return lit_segments(page, lit).ids()


def stop_bar(page: Page, point: str) -> Probe:
    return Probe(page, f'svg [data-holding="{point}"][data-stop-bar="true"]')


def preview_items(page: Page) -> Locator:
    return role(page, "list", "Route preview").get_by_role("listitem")


def table_cells(row: Locator) -> list[str]:
    return [c.strip() for c in row.get_by_role("cell").or_(row.get_by_role("rowheader")).all_inner_texts()]


def drop_point(target: Locator) -> tuple[float, float]:
    expect(target).to_be_attached()
    box = target.evaluate("""e => {
        for (let n = e; n && n !== document.body; n = n.parentElement) {
            const r = n.getBoundingClientRect();
            if (r.width > 4 && r.height > 4) {
                n.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
                const s = n.getBoundingClientRect();
                return {x: s.x + s.width / 2, y: s.y + Math.min(s.height / 2, 40)};
            }
        }
        return null; }""")
    assert box is not None, "the bay has no area to drop on"
    return box["x"], box["y"]


def drag(page: Page, source: Locator, target: Locator) -> None:
    x, y = center(source)
    tx, ty = drop_point(target)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 6, y + 6, steps=2)
    page.mouse.move(tx, ty, steps=8)
    page.mouse.up()


def touch_drag(page: Page, source: Locator, target: Locator) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    x, y = center(source)
    tx, ty = drop_point(target)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for step in range(1, 9):
        point = {"x": x + (tx - x) * step / 8, "y": y + (ty - y) * step / 8}
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [point]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def touch_height(locator: Locator) -> float:
    return round(locator.evaluate(
        "e => { const t = e.type || ''; const boxed = e.tagName === 'INPUT' && (t === 'radio' || t === 'checkbox');"
        " return ((boxed && e.labels && e.labels[0]) || e).getBoundingClientRect().height; }"), 2)


def box_of(locator: Locator) -> dict:
    box = locator.bounding_box()
    assert box is not None, "element has no box"
    return box


def download_bytes(info) -> bytes:
    return Path(info.value.path()).read_bytes()


def test_wf_class_setup_account_opening(browser, app_url, mail):
    who = person("founder")
    subject = "Verify your Runup Bay email"
    with open_app(browser, app_url + "/signup") as page:
        page.clock.resume()
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        fill(role(page, "textbox", "Name"), who.name)
        fill(role(page, "textbox", "Email"), who.email)
        fill(page.get_by_label("Password", exact=True), who.password)
        click(role(page, "button", "Create account"))
        form_status(page, "Check your email to verify your account.")
        message = mails(mail, who.email, subject)[0]
        assert mail_from_address() in json.dumps(message.get("From"))
        path = link_in(message, r"/verify\?token=[^\s\"'<>]+")

        early = httpx.post(app_url + "/api/session", json={"email": who.email, "password": who.password})
        assert early.status_code == 401
        assert early.json() == {"error": "unverified", "message": "Verify your email first."}

        page.goto(app_url + path)
        expect(role(page, "heading", "Email verified.")).to_be_visible()
        hrefs = page.get_by_role("link").evaluate_all("els => els.map(e => e.pathname)")
        assert "/signin" in hrefs

        page.goto(app_url + "/signin")
        fill(role(page, "textbox", "Email"), who.email)
        fill(page.get_by_label("Password", exact=True), "wrong-password-1")
        click(role(page, "button", "Sign in"))
        expect(page.get_by_role("alert").filter(has_text="Email or password is incorrect.").first).to_be_visible()
        fill(page.get_by_label("Password", exact=True), who.password)
        click(role(page, "button", "Sign in"))
        expect(role(page, "heading", "Your classes")).to_be_visible()
        assert urlsplit(page.url).path == "/"

        fill(role(page, "textbox", "School name"), f"School of {who.name}")
        click(role(page, "button", "Create school"))
        class_name = f"First class {uuid.uuid4().hex[:6]}"
        fill(role(page, "textbox", "Class name"), class_name)
        click(role(page, "button", "Create class"))
        expect(page).to_have_url(re.compile(r"/classes/[^/]+$"))
        landed = page.url
        expect(role(page, "heading", class_name)).to_be_visible()
        expect(page.get_by_text("No students yet. Invite them by email.", exact=True)).to_be_visible()
        page.reload()
        assert page.url == landed
        expect(role(page, "heading", class_name)).to_be_visible()

    api = Api(app_url, who)
    me = api.get("/api/me").json()
    assert class_name in json.dumps(me["classes"])
    again = api.post("/api/schools", {"name": "Second school"})
    assert again.status_code == 409
    assert again.json() == {"error": "school_exists", "message": "You already have a school."}
    taken = httpx.post(app_url + "/api/signup", json={"name": "Twin", "email": who.email, "password": PASSWORD})
    assert taken.status_code == 422
    assert taken.json()["errors"]["email"] == "This email is already registered."
    short = httpx.post(app_url + "/api/signup", json={"name": "Short", "email": person("short").email, "password": "123456789"})
    assert short.status_code == 422
    assert "password" in short.json()["errors"]


def test_invitations_reach_mailpit(browser, app_url, mail):
    w = World(app_url, [dep("GABCD")], with_session=False)
    one, two, three = person("inv"), person("inv"), person("inv")
    subject = f"Join {w.class_name} on Runup Bay"
    with client(browser, app_url, w.instructor, f"/classes/{w.class_id}") as page:
        fill(role(page, "textbox", "Student emails"), f"{one.email}, {two.email}\n{three.email}")
        click(role(page, "button", "Send invitations"))
        form_status(page, "Invitations sent: 3")
    for who in (one, two, three):
        message = mails(mail, who.email, subject)[0]
        path = link_in(message, r"/invite/[^\s\"'<>]+")
        token = path.rsplit("/", 1)[1]
        opened = httpx.get(f"{app_url}/api/invitations/{token}")
        assert opened.status_code == 200, opened.text
        assert opened.json()["email"] == who.email

    bad = "not-an-address"
    refused_call = w.ins.post(f"/api/classes/{w.class_id}/invitations", {"emails": [bad]})
    assert refused_call.status_code == 422
    assert "emails" in refused_call.json()["errors"]
    fresh = person("inv")
    denied = w.gnd.post(f"/api/classes/{w.class_id}/invitations", {"emails": [fresh.email]})
    assert denied.status_code == 404
    assert denied.json() == {"error": "not_found"}
    assert matching(mail.messages(), fresh.email, subject) == []


def test_wf_class_setup_invitation_join(browser, app_url):
    w = World(app_url, [dep("GABCD")], with_session=False)
    live, used, expired, edge, known = (person("join") for _ in range(5))
    grading(app_url, {"users": [{"email": known.email, "name": known.name, "password": known.password, "verified": False}]})
    invites = grading(app_url, {"users": [], "invites": [
        {"class": w.class_key, "email": live.email, "sentHoursAgo": 0, "status": "pending"},
        {"class": w.class_key, "email": used.email, "sentHoursAgo": 0, "status": "used"},
        {"class": w.class_key, "email": expired.email, "sentHoursAgo": 169, "status": "pending"},
        {"class": w.class_key, "email": edge.email, "sentHoursAgo": 167, "status": "pending"},
        {"class": w.class_key, "email": known.email, "sentHoursAgo": 0, "status": "pending"},
    ]})["invites"]
    paths = {i["email"]: urlsplit(i["url"]).path for i in invites}
    expired_text = "This invitation is out of date. Please request a fresh one from your instructor."
    used_text = "This invitation has already been used."

    with client(browser, app_url, None, paths[live.email]) as page:
        fill(role(page, "textbox", "Name"), live.name)
        fill(page.get_by_label("Password", exact=True), live.password)
        click(role(page, "button", "Join class"))
        expect(page).to_have_url(f"{app_url}/classes/{w.class_id}")
        expect(role(page, "heading", w.class_name)).to_be_visible()
        page.reload()
        assert page.url == f"{app_url}/classes/{w.class_id}"
        expect(role(page, "heading", w.class_name)).to_be_visible()
        expect(role(page, "link", "My record")).to_be_visible()
        expect(role(page, "button", "Send invitations")).to_have_count(0)
        page.goto(app_url + paths[live.email])
        expect(page.get_by_text(used_text, exact=True).first).to_be_visible()
    roster = w.ins.get(f"/api/classes/{w.class_id}").text
    assert live.email in roster or live.name in roster

    for who, message in ((used, used_text), (expired, expired_text)):
        with client(browser, app_url, None, paths[who.email]) as page:
            expect(page.get_by_text(message, exact=True).first).to_be_visible()
            expect(role(page, "button", "Join class")).to_have_count(0)
    token = paths[expired.email].rsplit("/", 1)[1]
    gone = httpx.get(f"{app_url}/api/invitations/{token}")
    assert gone.status_code == 410
    assert gone.json() == {"error": "invite_expired", "message": expired_text}
    token = paths[used.email].rsplit("/", 1)[1]
    gone = httpx.post(f"{app_url}/api/invitations/{token}/accept", json={"name": used.name, "password": PASSWORD})
    assert gone.status_code == 410
    assert gone.json() == {"error": "invite_used", "message": used_text}
    token = paths[edge.email].rsplit("/", 1)[1]
    assert httpx.get(f"{app_url}/api/invitations/{token}").status_code == 200

    token = paths[known.email].rsplit("/", 1)[1]
    wrong = httpx.post(f"{app_url}/api/invitations/{token}/accept", json={"name": "Ignored", "password": "wrong-password-1"})
    assert wrong.status_code == 401
    assert wrong.json()["error"] == "invalid_credentials"
    joined = httpx.post(f"{app_url}/api/invitations/{token}/accept", json={"name": "Ignored", "password": known.password})
    assert joined.status_code == 200
    assert joined.json()["classId"] == w.class_id
    assert Api(app_url, known).get("/api/me").json()["name"] == known.name


LAYOUT_CASE_IDS = ["oversized", "at_limit", "plain_text", "svg", "syntax_error", "not_an_object", "missing_keys",
                   "worked_file", "duplicate_node", "unknown_from", "zero_length", "unknown_serves", "several_faults"]


def layout_case(case: str, marker: str) -> tuple[bytes, str, int, list[str] | None]:
    valid = WORKED_LAYOUT.replace('"Q7"', '"J1"').replace("Marram Flats", marker)
    worked_file = WORKED_LAYOUT.replace("Marram Flats", marker)
    syntax = "Line {}: this is not valid JSON."
    stand_line = '    {"id": "P1", "kind": "stand", "x": 500, "y": 400}'
    table: dict[str, tuple[str, str, list[str]]] = {
        "plain_text": (f"plain words {marker}\n", "application/json", [syntax.format(1)]),
        "svg": (f'<svg xmlns="http://www.w3.org/2000/svg"><script>{marker}</script></svg>', "image/svg+xml", [syntax.format(1)]),
        "syntax_error": (valid.replace('"code": "MRF"', '"code": MRF'), "application/json", [syntax.format(3)]),
        "not_an_object": (f'["{marker}"]', "application/json", [syntax.format(1)]),
        "missing_keys": (json.dumps({"name": marker}), "application/json", [syntax.format(1)]),
        "worked_file": (worked_file, "application/json", ["Line 42: segment P1T ends at unknown node Q7."]),
        "duplicate_node": (valid.replace(stand_line, stand_line + ",\n" + stand_line), "text/plain",
                           ["Line 21: node P1 is listed more than once."]),
        "unknown_from": (valid.replace('"from": "J1"', '"from": "Q8"'), "application/json",
                         ["Line 25: segment B1 starts at unknown node Q8."]),
        "zero_length": (valid.replace('"lengthM": 300', '"lengthM": 0', 1), "application/json",
                        ["Line 27: segment B1 must be longer than 0 m."]),
        "unknown_serves": (valid.replace('"serves": "27"', '"serves": "45"'), "application/json",
                           ["Line 17: holding point H1 serves unknown runway 45."]),
        "several_faults": (worked_file.replace('"serves": "27"', '"serves": "45"'), "application/json",
                           ["Line 17: holding point H1 serves unknown runway 45.",
                            "Line 42: segment P1T ends at unknown node Q7."]),
    }
    if case == "oversized":
        raw = valid.encode()
        return raw + b" " * (LAYOUT_LIMIT + 1 - len(raw)), "application/json", 413, None
    if case == "at_limit":
        raw = valid.encode()
        return raw + b" " * (LAYOUT_LIMIT - len(raw)), "application/json", 201, None
    body, content_type, lines = table[case]
    return body.encode(), content_type, 422, lines


@pytest.mark.parametrize("case", LAYOUT_CASE_IDS, ids=LAYOUT_CASE_IDS)
def test_layout_import_refusals(app_url, case):
    w = World(app_url, [dep("GABCD")], with_session=False)
    marker = f"Refused {uuid.uuid4().hex[:10]}"
    body, content_type, status, lines = layout_case(case, marker)
    r = w.ins.client.post("/api/aerodromes/import", content=body, headers={"content-type": content_type})
    assert r.status_code == status, r.text
    if status == 201:
        assert r.json()["name"] == marker
        return
    if status == 413:
        assert r.json() == {"error": "layout_too_large", "message": f"Layout file is over the limit of {LAYOUT_LIMIT} bytes."}
    else:
        assert r.json() == {"error": "layout_invalid", "lines": lines}
    assert marker not in w.ins.get("/api/aerodromes").text
    store = S3()
    for key in store.keys("layouts/"):
        assert marker.encode() not in store.get(key), f"refused layout kept at {key}"


def test_wf_class_setup_layout_map(browser, app_url):
    w = World(app_url, [dep("GABCD")], with_session=False)
    marker = f"Marram {uuid.uuid4().hex[:8]}"
    faulty = WORKED_LAYOUT.replace("Marram Flats", marker).encode()
    raw = WORKED_LAYOUT.replace("Marram Flats", marker).replace('"Q7"', '"J1"').replace("\n", "\r\n").encode() + b"  \r\n"
    with client(browser, app_url, w.instructor, "/aerodromes") as page:
        picker = page.get_by_label("Layout file", exact=True)
        picker.set_input_files({"name": "plan.txt", "mimeType": "text/plain", "buffer": faulty})
        click(role(page, "button", "Import layout"))
        expect(role(page, "list", "Import errors").get_by_role("listitem")).to_have_text(
            ["Line 42: segment P1T ends at unknown node Q7."])
        picker.set_input_files({"name": "plan.txt", "mimeType": "text/plain", "buffer": raw})
        click(role(page, "button", "Import layout"))
        expect(page).to_have_url(re.compile(r"/aerodromes/[^/]+$"))
        aerodrome = urlsplit(page.url).path.rsplit("/", 1)[1]

        region = role(page, "region", "Airfield map")
        expect(region).to_be_visible()
        mirror = role(region, "list", "Airfield objects")
        objects = [("data-runway", "09/27"), ("data-segment-id", "B1"), ("data-segment-id", "B2"),
                   ("data-segment-id", "P1T"), ("data-holding", "H1"), ("data-holding", "H2"), ("data-stand", "P1")]
        expect(mirror.get_by_role("listitem")).to_have_count(len(objects))
        for attribute, value in objects:
            expect(Probe(page, f'svg [{attribute}="{value}"]')).to_be_attached()
            assert Probe(page, f'[{attribute}="{value}"]').count() >= 2, f"{value} missing from the map mirror"
            expect(mirror.get_by_role("listitem").filter(has_text=value).first).to_be_visible()

        with page.expect_download() as info:
            click(role(page, "button", "Download original"))
        assert download_bytes(info) == raw

        page.goto(app_url + "/aerodromes/wrenfield")
        expect(role(page, "region", "Airfield map")).to_be_visible()
        expect(role(page, "button", "Download original")).to_have_count(0)

    assert S3().get(f"layouts/{aerodrome}/original.json") == raw
    stored = w.ins.get(f"/api/aerodromes/{aerodrome}/original")
    assert stored.status_code == 200
    assert stored.content == raw
    assert stored.headers["content-type"].startswith("application/octet-stream")
    assert w.ins.get(f"/api/aerodromes/{aerodrome}").json()["layout"]["name"] == marker
    built_in = "wrenfield"
    assert w.ins.get(f"/api/aerodromes/{built_in}/original").status_code == 404


def test_wf_class_setup_scenario_assign(browser, app_url):
    w = World(app_url, [dep("GABCD")], with_session=False)
    name = f"Morning wave {uuid.uuid4().hex[:6]}"
    with client(browser, app_url, w.instructor, "/scenarios/new") as page:
        fill(role(page, "textbox", "Scenario name"), name)
        select(role(page, "combobox", "Aerodrome"), "Wrenfield")
        select(role(page, "combobox", "Runway in use"), "27")
        for label, value in (("Wind direction", "270"), ("Wind speed", "8"), ("Start time", "12:00:00"),
                             ("Duration seconds", "600"), ("Seed", "2"), ("Readback error interval", "0")):
            fill(role(page, "textbox", label), value)
        click(role(page, "button", "Add aircraft"))
        click(role(page, "button", "Add aircraft"))
        rows = (("1", "GABCD", "S1", "A1"), ("2", "GABCD", "S2", "A1"))
        for row, callsign, stand, point in rows:
            fill(role(page, "textbox", f"Callsign {row}"), callsign)
            fill(role(page, "textbox", f"Type {row}"), "C172")
            select(role(page, "combobox", f"Wake {row}"), "L")
            select(role(page, "combobox", f"Rules {row}"), "VFR")
            select(role(page, "combobox", f"Kind {row}"), "dep")
            fill(role(page, "textbox", f"Stand {row}"), stand)
            fill(role(page, "textbox", f"Holding point {row}"), point)
            fill(role(page, "textbox", f"Appear at {row}"), "0")
        error = role(page, "alert", "Scenario error")
        save = role(page, "button", "Save scenario")
        click(save)
        expect(error).to_have_text(dup_text("GABCD"))
        fill(role(page, "textbox", "Callsign 2"), "gabce")
        click(save)
        expect(error).to_have_text(shape_text("gabce"))
        fill(role(page, "textbox", "Callsign 2"), "GABCE")
        fill(role(page, "textbox", "Stand 2"), "S9")
        click(save)
        expect(error).to_have_text(stand_text("S9", "Wrenfield"))
        assert name not in w.ins.get("/api/scenarios").text
        fill(role(page, "textbox", "Stand 2"), "S2")
        click(save)
        form_status(page, "Scenario saved.")

        saved = [s for s in w.ins.get("/api/scenarios").json() if s["name"] == name]
        assert len(saved) == 1
        body = w.ins.get(f"/api/scenarios/{saved[0]['id']}").json()
        assert [t["callsign"] for t in body["traffic"]] == ["GABCD", "GABCE"]
        assert [t["stand"] for t in body["traffic"]] == ["S1", "S2"]

        page.goto(f"{app_url}/classes/{w.class_id}")
        click(role(page, "button", "Assign exercise"))
        dialog = role(page, "dialog", "Assign exercise")
        select(role(dialog, "combobox", "Scenario"), name)
        fill(role(dialog, "textbox", "Due on"), "2027-04-20")
        click(role(dialog, "button", "Save assignment"))
        form_status(page, "Assignment saved.")
        table = role(page, "table", "Assignments")
        expect(table).to_contain_text(name)
        expect(role(table, "button", "Start exercise")).to_be_visible()

    assert len(w.ins.get(f"/api/classes/{w.class_id}").json()["assignments"]) == 1
    invalid = dict(body, name=f"{name} copy", traffic=[dep("GABCD", stand="S9")])
    invalid.pop("id", None)
    r = w.ins.post("/api/scenarios", invalid)
    assert r.status_code == 422
    assert r.json() == {"error": "scenario_invalid", "message": stand_text("S9", "Wrenfield")}
    assert f"{name} copy" not in w.ins.get("/api/scenarios").text


def test_school_boundaries(browser, app_url):
    a = World(app_url, [dep("GABCD")])
    b = World(app_url, [dep("GABCD")])
    marker = f"Private {uuid.uuid4().hex[:8]}"
    raw = WORKED_LAYOUT.replace('"Q7"', '"J1"').replace("Marram Flats", marker).encode()
    imported = a.ins.client.post("/api/aerodromes/import", content=raw).json()["id"]
    assert httpx.get(app_url + "/api/me").json() == {"error": "unauthenticated"}

    sid = a.session
    for path in (f"/api/classes/{a.class_id}", f"/api/scenarios/{a.scenario}", f"/api/aerodromes/{imported}",
                 f"/api/aerodromes/{imported}/original", f"/api/sessions/{sid}/state", f"/api/sessions/{sid}/debrief",
                 f"/api/sessions/{sid}/replay?t=0", f"/api/sessions/{sid}/report.csv",
                 f"/api/records/{a.ids[a.ground.email]}"):
        r = b.ins.get(path)
        assert r.status_code == 404, f"{path}: {r.status_code}"
        assert r.json() == {"error": "not_found"}
    calls = ((f"/api/classes/{b.class_id}/assignments", {"scenario": a.scenario, "dueOn": "2027-04-20"}),
             ("/api/sessions", {"scenario": a.scenario}),
             (f"/api/classes/{a.class_id}/invitations", {"emails": [person("x").email]}),
             (f"/api/sessions/{sid}/pause", {}))
    for path, body in calls:
        r = b.ins.post(path, body)
        assert r.status_code == 404, f"{path}: {r.status_code} {r.text}"
        assert r.json() == {"error": "not_found"}
    assert b.gnd.post(f"/api/sessions/{sid}/seats", {"position": "GND"}).status_code == 404
    assert state(a)["status"] == "running"
    assert marker not in b.ins.get("/api/aerodromes").text
    assert a.scenario not in b.ins.get("/api/scenarios").text
    assert b.ins.get(f"/api/classes/{b.class_id}").json()["assignments"] == []

    with client(browser, app_url, b.instructor, f"/classes/{a.class_id}") as page:
        for path in (f"/classes/{a.class_id}", f"/scenarios/{a.scenario}", f"/aerodromes/{imported}", f"/sessions/{sid}"):
            page.goto(app_url + path)
            expect(role(page, "heading", "Not found.")).to_be_visible()


def test_flight_strip_attributes(browser, app_url):
    w = World(app_url, [dep("GABCD"), arr("GDOWN")])
    label = "GABCD, DEP, C172, wake L, VFR, stand S1, holding point A1, cleared none"
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr:
        for name in ("Pending", "Pushback", "Taxi", "Hand-off"):
            expect(bay(role(gnd, "region", "Ground board"), name)).to_be_attached()
        for name in ("Incoming", "Holding", "Line up", "Departed", "Arrivals", "Landed"):
            expect(bay(role(twr, "region", "Tower board"), name)).to_be_attached()
        strip = bay(gnd, "Pending").get_by_role("listitem", name=label, exact=True)
        expect(strip).to_have_attribute("data-strip", "GABCD")
        assert shown_count(role(gnd, "region", "Ground board").get_by_text("No strips here.", exact=True)) == 3
        expect(strip).to_have_attribute("data-bay", "Pending")
        expect(strip).to_have_attribute("data-frequency", "GND")
        expect(strip).to_have_attribute("data-state", "active")
        expect(strip).to_have_attribute("data-version", "1")
        expect(strip).to_contain_text("DEP")
        arrival = bay(twr, "Arrivals").get_by_role(
            "listitem", name="GDOWN, ARR, B738, wake M, IFR, runway 27, no holding point, cleared none", exact=True)
        expect(arrival).to_have_attribute("data-frequency", "TWR")
        expect(arrival).to_have_attribute("data-bay", "Arrivals")
        expect(arrival).to_contain_text("ARR")

        send(w.gnd, w.session, "GABCD PUSH APPROVED")
        tick(w, 30)
        send(w.gnd, w.session, "GABCD TAXI HP A1 VIA A")
        moved = strip_in(gnd, "Taxi", "GABCD")
        expect(moved).to_have_attribute(
            "aria-label", "GABCD, DEP, C172, wake L, VFR, stand S1, holding point A1, cleared TAXI HP A1 VIA A")
        expect(moved).to_have_attribute("data-bay", "Taxi")
        version = copy_in(state(w), "GABCD", "Taxi")["version"]
        assert version > 1
        expect(moved).to_have_attribute("data-version", str(version))
        expect(strip_in(gnd, "Pending", "GABCD")).to_have_count(0)


def test_wf_ground_flow_keyboard_run(browser, app_url):
    w = World(app_url, [dep("GABCD")])
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        gnd.keyboard.press("Tab")
        pending = strip_in(gnd, "Pending", "GABCD")
        expect(pending).to_be_focused()
        gnd.keyboard.press("Control+ArrowRight")
        box = command(gnd)
        expect(box).to_have_value("GABCD PUSH APPROVED")
        expect(box).to_be_focused()
        assert copy_in(state(w), "GABCD", "Pending")["version"] == 1
        gnd.keyboard.press("Escape")
        expect(box).to_have_value("")
        expect(pending).to_be_focused()
        assert plane(state(w), "GABCD")["status"] == "parked"

        gnd.keyboard.press("Control+ArrowRight")
        expect(box).to_have_value("GABCD PUSH APPROVED")
        expect(pending).to_be_visible()
        gnd.keyboard.press("Enter")
        pushback = strip_in(gnd, "Pushback", "GABCD")
        expect(pushback).to_be_focused()
        expect(box).to_have_value("")
        expect(role(gnd, "status", "Readback")).to_have_text("Push approved, GABCD.")
        tick(w, 30)
        expect(position_row(gnd, "GABCD")).to_have_attribute("data-status", "ready")

        gnd.keyboard.press("Control+ArrowRight")
        expect(box).to_have_value("GABCD TAXI HP A1 VIA A")
        assert copy_in(state(w), "GABCD", "Pushback")
        gnd.keyboard.press("Enter")
        taxi = strip_in(gnd, "Taxi", "GABCD")
        expect(taxi).to_be_focused()
        gnd.keyboard.press("Control+ArrowRight")
        expect(box).to_have_value("GABCD CONTACT TOWER")
        gnd.keyboard.press("Enter")
        offered = strip_in(gnd, "Hand-off", "GABCD")
        expect(offered).to_be_focused()
        expect(offered).to_have_attribute("data-state", "offered")
        expect(strip_in(twr, "Incoming", "GABCD")).to_have_attribute("data-state", "offered")
        expect(strip_in(ins, "Hand-off", "GABCD")).to_have_attribute("data-state", "offered")
        expect(strip_in(ins, "Incoming", "GABCD")).to_be_visible()
    st = state(w)
    assert sorted(c["bay"] for c in copies(st, "GABCD")) == ["Hand-off", "Incoming"]
    assert plane(st, "GABCD")["status"] == "taxiing"


def test_pending_and_refused_moves(browser, app_url):
    w = World(app_url, [dep("GABCD"), dep("GOFFR", stand="S2")],
              strips=[{"callsign": "GOFFR", "bay": "Hand-off", "segment": "A4", "progress": 10}])
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr:
        strip = strip_in(gnd, "Pending", "GABCD")
        strip.focus()
        with held(gnd, "**/api/sessions/*/strips/*/move") as gate:
            gnd.keyboard.press("Control+ArrowLeft")
            expect(strip).to_have_attribute("data-pending", "true")
            release(gate)
        expect(command_error(gnd)).to_have_text("GABCD cannot move there.")
        expect(strip).not_to_have_attribute("data-pending", "true")
        expect(any_copy(gnd, "GABCD")).to_have_count(1)
        expect(strip).to_be_visible()

        with held(gnd, "**/api/sessions/*/commands") as gate:
            type_line(gnd, "GABCD PUSH APPROVED")
            expect(strip).to_have_attribute("data-pending", "true")
            expect(strip_in(gnd, "Pushback", "GABCD")).to_have_count(0)
            release(gate)
        expect(strip_in(gnd, "Pushback", "GABCD")).to_be_visible()
        expect(any_copy(gnd, "GABCD")).to_have_count(1)

        incoming = strip_in(twr, "Incoming", "GOFFR")
        with held(twr, "**/api/sessions/*/strips/*/move") as gate:
            click(role(twr, "button", "Accept GOFFR"))
            expect(incoming).to_have_attribute("data-pending", "true")
            expect(strip_in(twr, "Holding", "GOFFR")).to_have_count(0)
            release(gate)
        expect(strip_in(twr, "Holding", "GOFFR")).to_have_attribute("data-frequency", "TWR")
        expect(any_copy(twr, "GOFFR")).to_have_count(1)


def test_wf_ground_flow_taxi_worked_example(browser, app_url):
    w = World(app_url, [dep("GQRST", stand="S3"), dep("GABCD", stand="S1")],
              strips=[{"callsign": "GQRST", "bay": "Pushback"}, {"callsign": "GABCD", "bay": "Pushback"}])
    table = [(5, "12:00:05", "S3T", "25"), (15, "12:00:20", "S3T", "100"), (1, "12:00:21", "E1", "10"),
             (19, "12:00:40", "E1", "200"), (1, "12:00:41", "A2", "10")]
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        send(w.gnd, w.session, "GQRST TAXI HP A1 VIA A")
        send(w.gnd, w.session, "GABCD TAXI HP A1 VIA A")
        for count, clock, segment, progress in table:
            assert tick(w, count)["simTime"] == clock
            for page in (gnd, twr, ins):
                expect(sim_clock(page)).to_have_text(clock)
                row = position_row(page, "GQRST")
                expect(row).to_have_attribute("data-segment", segment)
                expect(row).to_have_attribute("data-progress", progress)
                expect(row).to_have_text(f"GQRST taxiing {segment}")
            api_row = plane(state(w), "GQRST")
            assert (api_row["segment"], api_row["progress"]) == (segment, int(progress))
        tick(w, 29)
        for page in (gnd, twr, ins):
            expect(sim_clock(page)).to_have_text("12:01:10")
            row = position_row(page, "GQRST")
            expect(row).to_have_attribute("data-segment", "")
            expect(row).to_have_attribute("data-node", "A1")
            expect(row).to_have_attribute("data-progress", "0")
            expect(row).to_have_attribute("data-status", "holding")
            expect(row).to_have_text("GQRST holding A1")
        tick(w, 59)
        assert plane(state(w), "GABCD")["status"] == "taxiing"
        tick(w, 1)
        expect(position_row(ins, "GABCD")).to_have_attribute("data-status", "holding")
    row = plane(state(w), "GABCD")
    assert (row["status"], row["node"], row["segment"]) == ("holding", "A1", None)


def test_wf_ground_flow_live_boards(browser, app_url):
    w = World(app_url, [dep("GABCD")])
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        pages = (gnd, twr, ins)
        loads: list[str] = []
        scrolls = []
        for page in pages:
            page.on("framenavigated", lambda frame: loads.append(frame.url))
            page.evaluate("k => { window.__kept = k; window.scrollTo(0, 30); }", KEPT)
            scrolls.append(page.evaluate("window.scrollY"))
        send(w.gnd, w.session, "GABCD PUSH APPROVED")
        expect(strip_in(gnd, "Pushback", "GABCD")).to_be_visible()
        expect(strip_in(ins, "Pushback", "GABCD")).to_be_visible()
        tick(w, 3)
        event(w, {"kind": "wind", "windDir": 280, "windKt": 12})
        for page in pages:
            expect(sim_clock(page)).to_have_text(sim(3))
            expect(position_row(page, "GABCD")).to_have_attribute("data-status", "pushing")
            expect(role(page, "status", "Wind")).to_have_text("280 at 12 kt")
        for page, scroll in zip(pages, scrolls):
            assert page.evaluate("window.__kept") == KEPT
            assert page.evaluate("window.scrollY") == scroll
        assert loads == []


def test_wf_ground_flow_drag_and_slash(browser, app_url):
    w = World(app_url, [dep("GAAAA"), dep("GBBBB", stand="S2"), dep("GCCCC", stand="S3")],
              strips=[{"callsign": "GBBBB", "bay": "Hand-off", "segment": "A4", "progress": 10},
                      {"callsign": "GCCCC", "bay": "Incoming", "segment": "A3", "progress": 10}])
    with seated(browser, w, w.ground) as gnd:
        pending = strip_in(gnd, "Pending", "GAAAA")
        box = command(gnd)
        drag(gnd, pending, bay(gnd, "Pushback"))
        expect(box).to_have_value(f"{PROBE_DRAG} PUSH APPROVED")
        expect(box).to_be_focused()
        expect(pending).to_be_visible()
        assert plane(state(w), "GAAAA")["status"] == "parked"
        gnd.keyboard.press("Escape")

        drag(gnd, pending, bay(gnd, "Taxi"))
        expect(command_error(gnd)).to_have_text(f"{PROBE_DRAG} cannot move there.")
        expect(pending).to_be_visible()
        expect(any_copy(gnd, "GAAAA")).to_have_count(1)

        pending.focus()
        gnd.keyboard.press("/")
        expect(box).to_be_focused()
        expect(box).to_have_value("")
        role(gnd, "button", "Recall GBBBB").focus()
        gnd.keyboard.press("/")
        expect(box).to_be_focused()
        expect(box).to_have_value("")
    with seated(browser, w, w.tower) as twr:
        drag(twr, strip_in(twr, "Incoming", "GCCCC"), bay(twr, "Holding"))
        expect(strip_in(twr, "Holding", "GCCCC")).to_have_attribute("data-frequency", "TWR")
    assert copy_in(state(w), "GCCCC", "Holding")["state"] == "active"
    with seated(browser, w, w.ground, size=PHONE) as phone:
        touch_drag(phone, strip_in(phone, "Pending", "GAAAA"), bay(phone, "Pushback"))
        expect(command(phone)).to_have_value(f"{PROBE_DRAG} PUSH APPROVED")
        expect(command(phone)).to_be_focused()
        expect(strip_in(phone, "Pending", "GAAAA")).to_be_visible()


def test_command_grammar(app_url):
    w = World(app_url, [dep("GAAAA"), arr("GDOWN", due=1200), arr("GLAST", due=1200)])
    sid = w.session

    def said(api: Api, line: str, readback: str) -> None:
        assert send(api, sid, line).json()["readback"] == readback

    said(w.gnd, "  gaaaa   push  APPROVED ", "Push approved, GAAAA.")
    st = state(w)
    assert plane(st, "GAAAA")["status"] == "pushing"
    assert copy_in(st, "GAAAA", "Pushback")["cleared"] == "PUSH APPROVED"
    tick(w, 29)
    assert plane(state(w), "GAAAA")["status"] == "pushing"
    tick(w, 1)
    assert plane(state(w), "GAAAA")["status"] == "ready"

    said(w.gnd, "GAAAA TAXI HP A1", "Taxi holding point A1, GAAAA.")
    st = state(w)
    assert plane(st, "GAAAA")["status"] == "taxiing"
    assert copy_in(st, "GAAAA", "Taxi")["cleared"] == "TAXI HP A1"
    tick(w, 2)
    assert plane(state(w), "GAAAA")["progress"] == 10
    said(w.gnd, "GAAAA HOLD POSITION", "Holding position, GAAAA.")
    tick(w, 3)
    row = plane(state(w), "GAAAA")
    assert (row["status"], row["progress"]) == ("stopped", 10)
    said(w.gnd, "GAAAA CONTINUE TAXI", "Continuing taxi, GAAAA.")
    said(w.gnd, "gaaaa taxi hp a1 via w a", "Taxi holding point A1 via W A, GAAAA.")
    tick(w, 1)
    assert plane(state(w), "GAAAA")["progress"] == 15
    said(w.gnd, "GAAAA CONTACT TOWER", "Contact Tower, GAAAA.")
    accept(w, "GAAAA")
    said(w.twr, "gaaaa hold position", "Holding position, GAAAA.")
    said(w.twr, "GAAAA CONTINUE TAXI", "Continuing taxi, GAAAA.")
    tick(w, 127)
    row = plane(state(w), "GAAAA")
    assert (row["status"], row["node"]) == ("holding", "A1")

    said(w.twr, "GAAAA LINEUP 27", "Line up runway 27, GAAAA.")
    st = state(w)
    assert plane(st, "GAAAA")["status"] == "lining-up"
    assert copy_in(st, "GAAAA", "Line up")["frequency"] == "TWR"
    tick(w, 19)
    assert plane(state(w), "GAAAA")["status"] == "lining-up"
    tick(w, 1)
    assert plane(state(w), "GAAAA")["status"] == "lined-up"
    said(w.twr, "GAAAA CLEARED TAKEOFF 27", "Cleared for takeoff runway 27, GAAAA.")
    st = state(w)
    assert plane(st, "GAAAA")["status"] == "rolling"
    assert copy_in(st, "GAAAA", "Departed")["cleared"] == "CLEARED TAKEOFF 27"
    tick(w, 29)
    assert plane(state(w), "GAAAA")["status"] == "rolling"
    tick(w, 1)
    assert plane(state(w), "GAAAA")["status"] == "airborne"
    said(w.twr, "GDOWN CLEARED LAND 27", "Cleared to land runway 27, GDOWN.")
    assert copy_in(state(w), "GDOWN", "Arrivals")["cleared"] == "CLEARED LAND 27"
    said(w.twr, "GLAST GO AROUND", "Going around, GLAST.")
    end(w)
    commands = [t for _, t in rows_of(debrief(w)["log"], "command")]
    assert commands[0].endswith("PUSH APPROVED")
    assert all(c == c.upper() and "  " not in c for c in commands)

    k = World(app_url, [dep("GCCCC", stand="N1", hp="D1")], aerodrome="kestrel-down",
              strips=[{"callsign": "GCCCC", "bay": "Pushback"}])
    assert send(k.gnd, k.session, "GCCCC TAXI HP D1").json()["readback"] == taxi_readback("D1", "GCCCC")
    assert plane(state(k), "GCCCC")["route"] == ["N1T", "B1", "B4", "D3", "D2"]
    tick(k, 30)
    row = plane(state(k), "GCCCC")
    assert (row["status"], row["node"]) == ("holding", "B2")
    send(k.gnd, k.session, "GCCCC CONTACT TOWER")
    accept(k, "GCCCC")
    refused(k.twr, k.session, "GCCCC CROSS 27 AT C2", "GCCCC cannot do that now.")
    assert send(k.twr, k.session, "GCCCC CROSS 27 AT B2").json()["readback"] == cross_readback("27", "B2", "GCCCC")
    row = plane(state(k), "GCCCC")
    assert (row["status"], row["node"]) == ("crossing", "B2")
    tick(k, 29)
    assert plane(state(k), "GCCCC")["status"] == "crossing"
    tick(k, 1)
    row = plane(state(k), "GCCCC")
    assert (row["status"], row["node"]) == ("taxiing", "B3")
    tick(k, 1)
    row = plane(state(k), "GCCCC")
    assert (row["segment"], row["progress"]) == ("B4", 10)


def test_wf_command_line_ordered_refusals(browser, app_url):
    w = World(app_url, [dep("GABCD"), arr("GDOWN")])
    sid = w.session
    before = state(w)
    ground_cases = [
        ("GABCX TAXI HP A1", "Unknown callsign GABCX."),
        ("   ", "Usage: <CALLSIGN> <VERB> <ARGS>."),
        ("GDOWN PUSH APPROVED", "GDOWN is not on your frequency."),
        ("GABCD DANCE", "Unknown command DANCE."),
        ("GABCD", "Usage: <CALLSIGN> <VERB> <ARGS>."),
        ("GABCD LINEUP 27", "LINEUP is a Tower instruction."),
        ("GABCD CLEARED TAKEOFF 27", "CLEARED is a Tower instruction."),
        ("GABCD CROSS 27 AT A1", "CROSS is a Tower instruction."),
        ("GABCD TAXI", "Usage: <CS> TAXI HP <point> VIA <taxiways>."),
        ("GABCD NEGATIVE", "Usage: <CS> NEGATIVE RUNWAY <rwy> or <CS> NEGATIVE HP <point>."),
        ("GABCD TAXI HP Z9", "Unknown holding point Z9."),
        ("GABCD TAXI HP S1", "Unknown holding point S1."),
        ("GABCD TAXI HP A1 VIA C", "No route to A1 via C."),
        ("GABCD HOLD POSITION", "GABCD cannot do that now."),
        ("GABCD TAXI HP A1", "GABCD cannot do that now."),
        ("GABCD NEGATIVE HP A1", "GABCD has nothing to correct."),
    ]
    tower_cases = [
        ("GABCD LINEUP 27", "GABCD is not on your frequency."),
        ("GDOWN PUSH APPROVED", "PUSH is a Ground instruction."),
        ("GDOWN TAXI HP A1", "TAXI is a Ground instruction."),
        ("GDOWN CONTACT TOWER", "CONTACT is a Ground instruction."),
        ("GDOWN LINEUP", "Usage: <CS> LINEUP <rwy>."),
        ("GDOWN CLEARED", "Usage: <CS> CLEARED TAKEOFF <rwy> or <CS> CLEARED LAND <rwy>."),
        ("GDOWN CLEARED LAND 45", "Unknown runway 45."),
        ("GDOWN LINEUP 09", "Runway 09 is not in use."),
        ("GDOWN CLEARED LAND 09", "GDOWN cannot do that now."),
    ]
    for line, message in ground_cases:
        r = send(w.gnd, sid, line, ok=False)
        assert r.status_code == 422, f"{line!r}: {r.status_code}"
        assert r.json() == {"error": "parse", "message": message}, line
    for line, message in tower_cases:
        refused(w.twr, sid, line, message)

    with seated(browser, w, w.ground) as gnd:
        box = command(gnd)
        type_line(gnd, "GABCX TAXI HP A1")
        expect(command_error(gnd)).to_have_text("Unknown callsign GABCX.")
        expect(box).to_have_value("GABCX TAXI HP A1")
        expect(box).to_have_attribute("aria-invalid", "true")
        type_line(gnd, "GABCD LINEUP 27")
        expect(command_error(gnd)).to_have_text("LINEUP is a Tower instruction.")
    after = state(w)
    assert after["strips"] == before["strips"]
    assert after["aircraft"] == before["aircraft"]
    assert after["alerts"] == []

    assert w.ins.post(f"/api/sessions/{sid}/pause").status_code == 200
    r = send(w.gnd, sid, "GABCX TAXI HP A1", ok=False)
    assert r.status_code == 409
    assert r.json() == {"error": "paused", "message": "The exercise is paused."}
    end(w)
    r = send(w.gnd, sid, "GABCX TAXI HP A1", ok=False)
    assert r.status_code == 409
    assert r.json() == {"error": "ended", "message": "The exercise has ended."}
    assert rows_of(debrief(w)["log"], "command") == []

    for _ in range(2 * COMMAND_LIMIT + 2):
        r = send(w.gnd, sid, "GABCD PUSH APPROVED", ok=False)
        if r.status_code == 429:
            break
    assert r.status_code == 429, "more than COMMANDS_PER_MINUTE commands were never rate limited"
    assert r.json() == {"error": "rate_limited", "message": "Too many commands. Wait a moment."}


def test_wf_command_line_completion_history(browser, app_url):
    w = World(app_url, [dep("GABCD"), dep("GABCE", stand="S2"), dep("GZZZZ", stand="S3"), arr("GDOWN")])
    with seated(browser, w, w.ground) as page:
        box = command(page)
        box.focus()
        page.keyboard.type("GA")
        page.keyboard.press("Tab")
        expect(box).to_have_value(re.compile(r"^GABCD ?$"))
        page.keyboard.press("Tab")
        expect(box).to_have_value(re.compile(r"^GABCE ?$"))
        page.keyboard.press("Tab")
        expect(box).to_have_value(re.compile(r"^GABCD ?$"))
        expect(box).to_be_focused()
        fill(box, "")
        page.keyboard.type("GZ")
        page.keyboard.press("Tab")
        expect(box).to_have_value(PROBE_ONLY + " ")
        expect(box).to_be_focused()
        fill(box, "")
        page.keyboard.type("GD")
        page.keyboard.press("Tab")
        expect(box).not_to_be_focused()
        expect(box).to_have_value("GD")
        box.focus()
        fill(box, "GABCD TAXI")
        page.keyboard.press("Tab")
        expect(box).not_to_be_focused()

        lines = [f"GX{n:03d} PING" for n in range(1, 53)]
        for line in lines:
            type_line(page, line)
            expect(command_error(page)).to_have_text(f"Unknown callsign {line.split()[0]}.")
        fill(box, DRAFT)
        box.focus()
        page.keyboard.press("ArrowUp")
        expect(box).to_have_value(lines[-1])
        page.keyboard.press("ArrowUp")
        expect(box).to_have_value(lines[-2])
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        expect(box).to_have_value(DRAFT)

        page.reload()
        box = command(page)
        expect(box).to_be_visible()
        box.focus()
        page.keyboard.press("ArrowUp")
        expect(box).to_have_value(lines[-1])
        for _ in range(49):
            page.keyboard.press("ArrowUp")
        expect(box).to_have_value(lines[2])
        page.keyboard.press("ArrowUp")
        expect(box).to_have_value(lines[2])


def test_wf_command_line_drafts_survive(browser, app_url):
    w = World(app_url, [dep("GABCD"), dep("GBBBB", stand="S2")])
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.instructor) as ins:
        box = command(gnd)
        box.focus()
        gnd.keyboard.type("GABCD TAX")
        tick(w, 3)
        expect(sim_clock(gnd)).to_have_text(sim(3))
        expect(box).to_have_value("GABCD TAX")
        expect(box).to_be_focused()

        type_line(gnd, "GABCX TAXI HP A1")
        expect(command_error(gnd)).to_have_text("Unknown callsign GABCX.")
        send(w.gnd, w.session, "GBBBB PUSH APPROVED")
        tick(w, 2)
        expect(sim_clock(gnd)).to_have_text("12:00:05")
        expect(strip_in(gnd, "Pushback", "GBBBB")).to_be_visible()
        expect(command_error(gnd)).to_have_text("Unknown callsign GABCX.")
        expect(box).to_have_value("GABCX TAXI HP A1")
        expect(box).to_have_attribute("aria-invalid", "true")
        expect(box).to_be_focused()

        strip_in(gnd, "Pending", "GABCD").focus()
        gnd.keyboard.press("Enter")
        dialog = role(gnd, "dialog", "Edit GABCD")
        remarks = role(dialog, "textbox", "Remarks")
        fill(remarks, "half a remark")
        remarks.focus()
        tick(w, 1)
        expect(sim_clock(gnd)).to_have_text(sim(6))
        expect(dialog).to_be_visible()
        expect(remarks).to_have_value("half a remark")
        expect(remarks).to_be_focused()

        form = role(ins, "form", "Inject event")
        select(role(form, "combobox", "Event"), "Go-around")
        select(role(form, "combobox", "Aircraft"), "GABCD")
        click(role(form, "button", "Inject"))
        error = role(ins, "alert", "Event error")
        expect(error).to_have_text("GABCD is not on final.")
        tick(w, 2)
        expect(sim_clock(ins)).to_have_text(sim(8))
        expect(error).to_have_text("GABCD is not on final.")

        select(role(form, "combobox", "Event"), "Wind change")
        direction = role(form, "textbox", "Wind direction")
        fill(direction, "09")
        direction.focus()
        tick(w, 2)
        expect(sim_clock(ins)).to_have_text(sim(10))
        expect(direction).to_have_value("09")
        expect(direction).to_be_focused()
        assert role(form, "combobox", "Event").evaluate("e => e.selectedOptions[0].text") == "Wind change"


def test_wf_command_line_normalised_input(browser, app_url):
    w = World(app_url, [dep("GABCD")])
    with seated(browser, w, w.ground) as gnd:
        box = command(gnd)
        box.focus()
        gnd.keyboard.type("  gabcd   push    approved ")
        gnd.keyboard.press("Enter")
        expect(role(gnd, "status", "Readback")).to_have_text("Push approved, GABCD.")
        expect(box).to_have_value("")
        expect(box).to_be_focused()
        expect(strip_in(gnd, "Pushback", "GABCD")).to_have_attribute("aria-label", re.compile(r"cleared PUSH APPROVED$"))
        gnd.keyboard.press("Enter")
        expect(box).to_be_focused()
    end(w)
    assert rows_of(debrief(w)["log"], "command") == [("GND", "GABCD PUSH APPROVED")]


def test_wf_command_line_phone_send(browser, app_url):
    w = World(app_url, [dep("GABCD")])
    line = "GABCX TAXI HP A1"
    message = "Unknown callsign GABCX."
    with seated(browser, w, w.ground, size=PHONE) as gnd:
        box, sender = command(gnd), role(gnd, "button", "Send")
        assert touch_height(sender) >= TOUCH_MIN
        fill(box, line)
        tap(sender)
        expect(command_error(gnd)).to_have_text(message)
        expect(box).to_have_attribute("aria-invalid", "true")
        tap(role(gnd, "tab", "Map"))
        expect(box).to_be_visible()
        expect(box).to_have_value(line)
        expect(command_error(gnd)).to_have_text(message)
        layout(gnd)
        tap(role(gnd, "tab", "Board"))
        fill(box, "GABCD PUSH APPROVED")
        tap(sender)
        expect(strip_in(gnd, "Pushback", "GABCD")).to_be_visible()
        expect(box).to_have_value("")
        expect(box).not_to_have_attribute("aria-invalid", "true")
        expect(gnd.get_by_text(message, exact=True)).to_have_count(0)


def test_wf_handoff_offer_open(browser, app_url):
    w = World(app_url, [dep("GABCD")], strips=[{"callsign": "GABCD", "bay": "Taxi", "segment": "A4", "progress": 50}])
    with seated(browser, w, w.ground, wrong_clock=True) as gnd, seated(browser, w, w.tower, wrong_clock=True) as twr:
        expect(strip_in(twr, "Incoming", "GABCD")).to_have_count(0)
        type_line(gnd, "GABCD CONTACT TOWER")
        handoff = strip_in(gnd, "Hand-off", "GABCD")
        incoming = strip_in(twr, "Incoming", "GABCD")
        expect(handoff).to_have_attribute("data-state", "offered")
        expect(handoff).to_have_attribute("data-frequency", "GND")
        expect(incoming).to_have_attribute("data-state", "offered")
        expect(incoming).to_have_attribute("data-frequency", "GND")
        version = handoff.get_attribute("data-version")
        expect(incoming).to_have_attribute("data-version", version)
        expect(timer(handoff, "offer")).to_have_text("Offer 1:00")
        expect(timer(incoming, "offer")).to_have_text("Offer 1:00")
        refused(w.twr, w.session, "GABCD HOLD POSITION", "GABCD is not on your frequency.")

        advance(twr, 30_000)
        advance(gnd, 30_000)
        expect(timer(incoming, "offer")).to_have_text("Offer 1:00")
        expect(timer(handoff, "offer")).to_have_text("Offer 1:00")

        tick(w, 10)
        expect(timer(handoff, "offer")).to_have_text(f"Offer {mss(50)}")
        expect(timer(incoming, "offer")).to_have_text(f"Offer {mss(50)}")
        row = plane(state(w), "GABCD")
        assert (row["segment"], row["progress"], row["status"]) == ("A4", 150, "taxiing")
        assert all(c["frequency"] == "GND" for c in copies(state(w), "GABCD"))
        tick(w, 34)
        expect(timer(incoming, "offer")).to_have_text(f"Offer {mss(16)}")
        expect(timer(incoming, "offer")).not_to_have_attribute("data-near", "true")
        tick(w, 1)
        expect(timer(incoming, "offer")).to_have_text(f"Offer {mss(15)}")
        expect(timer(incoming, "offer")).to_have_attribute("data-near", "true")
        expect(timer(handoff, "offer")).to_have_attribute("data-near", "true")


def test_wf_handoff_accept_and_recall(browser, app_url):
    names = ["GABCD", "GKEYS", "GZZZZ", "GRCLL"]
    w = World(app_url, [dep(cs) for cs in names],
              strips=[{"callsign": cs, "bay": "Hand-off", "segment": "A4", "progress": 10} for cs in names])
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr:
        click(role(twr, "button", "Accept GABCD"))
        accepted = strip_in(twr, "Holding", "GABCD")
        expect(accepted).to_have_attribute("data-frequency", "TWR")
        expect(accepted).to_have_attribute("data-state", "active")
        muted = strip_in(gnd, "Hand-off", "GABCD")
        expect(muted).to_have_attribute("data-state", "transferred")
        expect(muted).to_have_attribute("aria-disabled", "true")
        expect(muted).to_have_attribute("aria-label", re.compile(r", transferred to Tower$"))
        expect(strip_in(twr, "Incoming", "GABCD")).to_have_count(0)

        muted.focus()
        gnd.keyboard.press("Enter")
        expect(command_error(gnd)).to_have_text("GABCD is not on your frequency.")
        expect(role(gnd, "dialog", "Edit GABCD")).to_have_count(0)
        gnd.keyboard.press("Control+ArrowLeft")
        expect(muted).to_have_attribute("data-state", "transferred")

        strip_in(twr, "Incoming", "GKEYS").focus()
        twr.keyboard.press("Control+ArrowRight")
        expect(strip_in(twr, "Holding", "GKEYS")).to_have_attribute("data-frequency", "TWR")

        strip_in(gnd, "Hand-off", "GZZZZ").focus()
        gnd.keyboard.press("Control+ArrowLeft")
        back = strip_in(gnd, "Taxi", "GZZZZ")
        expect(back).to_have_attribute("data-state", "active")
        expect(strip_in(twr, "Incoming", "GZZZZ")).to_have_count(0)
        click(role(gnd, "button", "Recall GRCLL"))
        expect(strip_in(gnd, "Taxi", "GRCLL")).to_have_attribute("data-state", "active")
        expect(strip_in(twr, "Incoming", "GRCLL")).to_have_count(0)
        expect(strip_in(gnd, "Hand-off", "GRCLL")).to_have_count(0)
    st = state(w)
    assert sorted(c["bay"] for c in copies(st, "GABCD")) == ["Hand-off", "Holding"]
    assert [c["bay"] for c in copies(st, "GZZZZ")] == ["Taxi"]
    assert st["alerts"] == []
    assert send(w.twr, w.session, "GABCD HOLD POSITION").status_code == 200
    end(w)
    events = rows_of(debrief(w)["log"], "event")
    assert ("TWR", "Handoff accepted: GABCD.") in events
    assert ("TWR", "Handoff accepted: GKEYS.") in events
    assert ("GND", "Handoff recalled: GZZZZ.") in events
    assert ("GND", "Handoff recalled: GRCLL.") in events


def test_wf_handoff_timing_alerts(browser, app_url):
    w = World(app_url, [dep("GOFFR"), dep("GLATE", stand="S2")],
              strips=[{"callsign": "GOFFR", "bay": "Hand-off", "segment": "A4", "progress": 50},
                      {"callsign": "GLATE", "bay": "Taxi", "segment": "A2", "progress": 200}])
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr:
        tick(w, 9)
        assert state(w)["alerts"] == []
        tick(w, 1)
        late = "12:00:10 R6 Late handoff: GLATE reached A1 on Ground."
        for page in (gnd, twr):
            expect(top_alert(page)).to_have_text(late)
            expect(top_alert(page)).to_have_attribute("data-rule", "R6")
            expect(top_alert(page)).to_have_attribute("data-severity", "advisory")
        tick(w, 49)
        assert rules(state(w)["alerts"]) == ["R6"]
        expect(strip_in(twr, "Incoming", "GOFFR")).to_be_visible()
        tick(w, 1)
        for page in (gnd, twr):
            expect(top_alert(page)).to_have_text(f"{sim(60)} R6 Handoff not accepted: {PROBE_OFFR}.")
        expect(strip_in(twr, "Incoming", "GOFFR")).to_have_count(0)
        expect(strip_in(gnd, "Taxi", "GOFFR")).to_have_attribute("data-state", "active")
    assert [c["bay"] for c in copies(state(w), "GOFFR")] == ["Taxi"]
    end(w)
    assert debrief(w)["score"] == 90

    k = World(app_url, [dep("GCROS", stand="N1", hp="D1")], aerodrome="kestrel-down",
              strips=[{"callsign": "GCROS", "bay": "Taxi", "segment": "B1", "progress": 90}])
    tick(k, 1)
    st = state(k)
    assert (plane(st, "GCROS")["status"], plane(st, "GCROS")["node"]) == ("holding", "B2")
    assert st["alerts"] == []


def test_strip_version_conflict(browser, app_url):
    racers = ["GRAAA", "GRBBB", "GRCCC"]
    names = racers + ["GSTAL", "GEDIT", "GVIEW"]
    w = World(app_url, [dep(cs) for cs in names],
              strips=[{"callsign": cs, "bay": "Hand-off", "segment": "A4", "progress": 10} for cs in names])
    sid = w.session
    for cs in racers:
        version = copy_in(state(w), cs, "Hand-off")["version"]
        barrier = threading.Barrier(2)
        answers: dict[str, httpx.Response] = {}

        def act(api: Api, label: str, to: str) -> None:
            barrier.wait()
            answers[label] = move(api, w, cs, to, version)

        threads = [threading.Thread(target=act, args=(w.twr, "accept", "Holding")),
                   threading.Thread(target=act, args=(w.gnd, "recall", "Taxi"))]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        codes = sorted(r.status_code for r in answers.values())
        assert codes == [200, 409], f"{cs}: {[r.text for r in answers.values()]}"
        loser = next(r for r in answers.values() if r.status_code == 409)
        body = loser.json()
        assert (body.get("error"), body.get("message")) == (
            "version_conflict", f"{cs} was changed by another seat first. Your action was not applied.")
        bays = sorted(c["bay"] for c in copies(state(w), cs))
        assert bays == (["Hand-off", "Holding"] if answers["accept"].status_code == 200 else ["Taxi"])

    version = copy_in(state(w), "GSTAL", "Hand-off")["version"]
    assert move(w.twr, w, "GSTAL", "Holding", version).status_code == 200
    stale = move(w.gnd, w, "GSTAL", "Taxi", version)
    assert stale.status_code == 409
    assert stale.json()["error"] == "version_conflict"
    assert move(w.twr, w, "GSTAL", "Departed", version).status_code == 409

    version = copy_in(state(w), "GEDIT", "Hand-off")["version"]
    path = f"/api/sessions/{sid}/strips/GEDIT"
    bad = w.gnd.patch(path, {"holdingPoint": "Z9", "remarks": "", "version": version})
    assert bad.status_code == 422
    assert bad.json() == {"error": "parse", "message": "Unknown holding point Z9."}
    good = w.gnd.patch(path, {"holdingPoint": "A1", "remarks": "edited", "version": version})
    assert good.status_code == 200
    assert copy_in(state(w), "GEDIT", "Hand-off")["version"] == version + 1
    late = w.gnd.patch(path, {"holdingPoint": "A1", "remarks": "again", "version": version})
    assert late.status_code == 409
    assert late.json()["error"] == "version_conflict"

    with seated(browser, w, w.ground) as gnd:
        strip = strip_in(gnd, "Hand-off", "GVIEW")
        expect(strip).to_have_attribute("data-state", "offered")
        hold(w, "GND", True)
        accept(w, "GVIEW")
        expect(strip).to_have_attribute("data-state", "offered")
        strip.focus()
        gnd.keyboard.press("Control+ArrowLeft")
        expect(role(gnd, "alert", "Strip notice")).to_have_text(conflict_text("GVIEW"))
        expect(strip).to_have_attribute("data-state", "transferred")
        hold(w, "GND", False)
    assert sorted(c["bay"] for c in copies(state(w), "GVIEW")) == ["Hand-off", "Holding"]


def test_wf_handoff_phone_touch(browser, app_url):
    w = World(app_url, [dep("GABCD"), dep("GQRST", stand="S3")],
              strips=[{"callsign": "GABCD", "bay": "Hand-off", "segment": "A4", "progress": 10},
                      {"callsign": "GQRST", "bay": "Hand-off", "segment": "A3", "progress": 10}])
    with seated(browser, w, w.tower, size=PHONE) as twr, seated(browser, w, w.ground, size=PHONE) as gnd:
        accept_button, recall_button = role(twr, "button", "Accept GABCD"), role(gnd, "button", "Recall GQRST")
        assert touch_height(accept_button) >= TOUCH_MIN
        assert touch_height(recall_button) >= TOUCH_MIN
        tap(accept_button)
        expect(strip_in(twr, "Holding", "GABCD")).to_have_attribute("data-frequency", "TWR")
        kept = strip_in(gnd, "Hand-off", "GABCD")
        expect(kept).to_have_attribute("data-state", "transferred")
        expect(kept).to_have_attribute("aria-label", re.compile(r", transferred to Tower$"))
        tap(recall_button)
        expect(strip_in(gnd, "Taxi", "GQRST")).to_have_attribute("data-state", "active")
        expect(strip_in(twr, "Incoming", "GQRST")).to_have_count(0)
        layout(twr)
        layout(gnd)
    assert state(w)["alerts"] == []


def wake_traffic() -> list[dict]:
    return [dep("GBULK", stand="S3", type_="B744", wake="H", rules="IFR"),
            dep("GLITE", stand="S4", type_="PA28", wake="L", rules="VFR")]


def test_wf_wake_spacing_server_timers(browser, app_url):
    w = World(app_url, wake_traffic() + [dep("GSLOT", slot=600), arr("GDOWN", due=600)], sim_time="12:05:00",
              strips=[{"callsign": "GBULK", "bay": "Departed", "takeoffStart": "12:03:48"},
                      {"callsign": "GLITE", "bay": "Line up"}])
    with seated(browser, w, w.tower, wrong_clock=True) as twr, seated(browser, w, w.ground, wrong_clock=True) as gnd:
        def timers():
            return (timer(strip_in(twr, "Line up", "GLITE"), "wake"), timer(strip_in(twr, "Arrivals", "GDOWN"), "due"),
                    timer(strip_in(gnd, "Pending", "GSLOT"), "slot"))

        def shown(wake: str, due: str, slot: str) -> None:
            for locator, value in zip(timers(), (wake, due, slot)):
                expect(locator).to_have_text(value)

        shown("Wake 0:48", "Due 10:00", "Slot 10:00")
        advance(twr, DEVICE_ADVANCE_MS)
        advance(gnd, DEVICE_ADVANCE_MS)
        shown("Wake 0:48", "Due 10:00", "Slot 10:00")
        twr.reload()
        connected(twr, w)
        shown("Wake 0:48", "Due 10:00", "Slot 10:00")

        assert w.ins.post(f"/api/sessions/{w.session}/pause").status_code == 200
        assert tick(w, 5)["simTime"] == "12:05:00"
        expect(role(twr, "status", "Exercise state")).to_have_text("Paused")
        shown("Wake 0:48", "Due 10:00", "Slot 10:00")
        assert w.ins.post(f"/api/sessions/{w.session}/resume").status_code == 200

        tick(w, 1)
        shown("Wake 0:47", "Due 9:59", "Slot 9:59")
        tick(w, 31)
        shown("Wake 0:16", "Due 9:28", "Slot 9:28")
        expect(timers()[0]).not_to_have_attribute("data-near", "true")
        tick(w, 1)
        shown("Wake 0:15", "Due 9:27", "Slot 9:27")
        expect(timers()[0]).to_have_attribute("data-near", "true")
        tick(w, 17)
        expect(timers()[0]).to_have_count(0)
        tick(w, 429)
        expect(timers()[1]).to_have_text("Due 2:01")
        expect(timers()[1]).not_to_have_attribute("data-near", "true")
        tick(w, 1)
        expect(timers()[1]).to_have_text("Due 2:00")
        expect(timers()[1]).to_have_attribute("data-near", "true")
        tick(w, 59)
        expect(timers()[2]).to_have_text(f"Slot {mss(61)}")
        expect(timers()[2]).not_to_have_attribute("data-near", "true")
        tick(w, 1)
        expect(timers()[2]).to_have_text(f"Slot {mss(60)}")
        expect(timers()[2]).to_have_attribute("data-near", "true")
        tick(w, 61)
        expect(timers()[2]).to_have_text(f"Slot late {mss(1)}")


def test_wake_spacing_rule(app_url):
    w = World(app_url, wake_traffic() + [arr("GDOWN", due=600)], with_session=False)
    strips = [{"callsign": "GBULK", "bay": "Departed", "takeoffStart": "12:03:48"}, {"callsign": "GLITE", "bay": "Line up"}]
    line = "GLITE CLEARED TAKEOFF 27"

    sid = w.add_session(strips=strips, sim_time="12:05:00")
    answer = send(w.twr, sid, line).json()
    assert answer["alerts"] == [{"rule": "R2", "text": "Wake: 2:00 required behind GBULK (H), 1:12 elapsed."}]
    assert copy_in(state(w, sid), "GLITE", "Departed")
    end(w, sid)
    assert [b["penalty"] for b in debrief(w, sid)["breakdown"]] == [15]

    sid = w.add_session(strips=strips, sim_time="12:04:10")
    answer = send(w.twr, sid, line).json()
    assert answer["alerts"] == [{"rule": "R1", "text": "Runway 27 occupied by GBULK."},
                                {"rule": "R2", "text": "Wake: 2:00 required behind GBULK (H), 0:22 elapsed."}]
    end(w, sid)
    result = debrief(w, sid)
    assert sum(b["penalty"] for b in result["breakdown"]) == 35
    log = [(row["kind"], row["text"]) for row in result["log"]]
    start = log.index(("command", line))
    assert [kind for kind, _ in log[start:start + 4]] == ["command", "readback", "alert", "alert"]
    assert log[start + 2][1] == "Runway 27 occupied by GBULK."

    sid = w.add_session(strips=strips, sim_time="12:05:48")
    assert send(w.twr, sid, line).json()["alerts"] == []
    sid = w.add_session(strips=strips, sim_time="12:05:47")
    assert rules(send(w.twr, sid, line).json()["alerts"]) == ["R2"]

    sid = w.add_session(strips=strips + [{"callsign": "GDOWN", "bay": "Arrivals", "dueSeconds": 47}], sim_time="12:04:10")
    answer = send(w.twr, sid, line).json()
    assert rules(answer["alerts"]) == ["R1", "R2", "R3"]
    assert answer["alerts"][2]["text"] == "Arrival GDOWN due in 0:47; departure not allowed."

    recent = w.add_scenario([dep("GHEVY", wake="J", type_="A388", rules="IFR"), dep("GTINY", stand="S2"),
                             dep("GNEXT", stand="S3")])
    sid = w.add_session(recent, sim_time="12:05:10", strips=[
        {"callsign": "GHEVY", "bay": "Departed", "takeoffStart": "12:03:00"},
        {"callsign": "GTINY", "bay": "Departed", "takeoffStart": "12:04:00"},
        {"callsign": "GNEXT", "bay": "Line up"}])
    assert send(w.twr, sid, "GNEXT CLEARED TAKEOFF 27").json()["alerts"] == []

    for (leader, follower), minimum in WAKE_MINIMUMS.items():
        key = w.add_scenario([dep("GLEAD", wake=leader), dep("GFOLL", stand="S2", wake=follower)])
        spec = [{"callsign": "GLEAD", "bay": "Departed", "takeoffStart": "12:00:00"}, {"callsign": "GFOLL", "bay": "Line up"}]
        at_minimum = w.add_session(key, strips=spec, sim_time=sim(minimum))
        assert send(w.twr, at_minimum, "GFOLL CLEARED TAKEOFF 27").json()["alerts"] == [], (leader, follower)
        inside = w.add_session(key, strips=spec, sim_time=sim(minimum - 1))
        expected = f"Wake: {mss(minimum)} required behind GLEAD ({leader}), {mss(minimum - 1)} elapsed."
        assert send(w.twr, inside, "GFOLL CLEARED TAKEOFF 27").json()["alerts"] == [{"rule": "R2", "text": expected}]


def test_wf_wake_spacing_alert_everywhere(browser, app_url):
    w = World(app_url, wake_traffic() + [dep("GNEXT", stand="S1")], sim_time="12:05:00",
              strips=[{"callsign": "GBULK", "bay": "Departed", "takeoffStart": "12:03:48"},
                      {"callsign": "GLITE", "bay": "Line up"}, {"callsign": "GNEXT", "bay": "Holding", "node": "A1"}])
    text_r2 = "Wake: 2:00 required behind GBULK (H), 1:12 elapsed."
    text_r1 = "Runway 27 occupied by GLITE."
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        pages = (gnd, twr, ins)
        for page in pages:
            expect(page.get_by_text("No alerts yet.", exact=True)).to_be_visible()
        type_line(twr, "GLITE CLEARED TAKEOFF 27")
        expect(role(twr, "status", "Readback")).to_have_text("Cleared for takeoff runway 27, GLITE.")
        expect(strip_in(twr, "Departed", "GLITE")).to_be_visible()
        for page in pages:
            row = top_alert(page)
            expect(row).to_have_text(f"12:05:00 R2 {text_r2}")
            expect(row).to_have_attribute("data-rule", "R2")
            expect(row).to_have_attribute("data-severity", "warning")
            expect(role(page, "status", "Alert announcements")).to_have_text(text_r2)
            expect(role(page, "alert", "Urgent alerts")).not_to_contain_text("Wake")
        type_line(twr, "GNEXT LINEUP 27")
        for page in pages:
            expect(role(page, "list", "Alerts").get_by_role("listitem")).to_have_text(
                [f"12:05:00 R1 {text_r1}", f"12:05:00 R2 {text_r2}"])
            expect(top_alert(page)).to_have_attribute("data-severity", "critical")
            expect(role(page, "status", "Alert announcements")).to_have_text(text_r1)
    assert [a["text"] for a in state(w)["alerts"]].count(text_r2) == 1


def test_wf_wake_spacing_keyboard_takeoff(browser, app_url):
    w = World(app_url, wake_traffic(), sim_time="12:05:00",
              strips=[{"callsign": "GBULK", "bay": "Departed", "takeoffStart": "12:03:48"},
                      {"callsign": "GLITE", "bay": "Line up"}])
    with seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        lined = strip_in(twr, "Line up", "GLITE")
        expect(timer(lined, "wake")).to_have_text("Wake 0:48")
        twr.keyboard.press("Tab")
        expect(lined).to_be_focused()
        twr.keyboard.press("Control+ArrowRight")
        expect(command(twr)).to_have_value("GLITE CLEARED TAKEOFF 27")
        expect(lined).to_be_visible()
        twr.keyboard.press("Enter")
        gone = strip_in(twr, "Departed", "GLITE")
        expect(gone).to_be_focused()
        expect(timer(gone, "wake")).to_have_count(0)
        expect(role(ins, "status", "Readback")).to_have_text("Cleared for takeoff runway 27, GLITE.")
        expect(top_alert(ins)).to_have_text("12:05:00 R2 Wake: 2:00 required behind GBULK (H), 1:12 elapsed.")


def test_wf_wake_spacing_pair_in_debrief(browser, app_url):
    w = World(app_url, wake_traffic(), name="Early roll", sim_time="12:04:10",
              strips=[{"callsign": "GBULK", "bay": "Departed", "takeoffStart": "12:03:48"},
                      {"callsign": "GLITE", "bay": "Line up"}])
    first = "Runway 27 occupied by GBULK."
    second = "Wake: 2:00 required behind GBULK (H), 0:22 elapsed."
    with seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        type_line(twr, "GLITE CLEARED TAKEOFF 27")
        for page in (twr, ins):
            alerts = role(page, "list", "Alerts").get_by_role("listitem")
            expect(alerts).to_have_count(2)
            assert sorted(alerts.all_inner_texts()) == [f"12:04:10 R1 {first}", f"12:04:10 R2 {second}"]
            expect(role(page, "status", "Alert announcements")).to_have_text(second)
        click(role(ins, "button", "End exercise"))
        click(role(ins, "link", "Open debrief"))
        expect(role(ins, "status", "Score")).to_have_text("Score 65 of 100")
        expect(role(ins, "status", "Result")).to_have_text("Not passed")
        rows = role(ins, "table", "Score breakdown").get_by_role("row")
        expect(rows).to_have_count(4)
        assert table_cells(rows.nth(1)) == ["12:04:10", "R1", first, "-20"]
        assert table_cells(rows.nth(2)) == ["12:04:10", "R2", second, "-15"]
        assert table_cells(rows.nth(3)) == ["Total", "", "", "65"]


def test_wf_wake_spacing_exact_minimum(browser, app_url):
    w = World(app_url, wake_traffic(), sim_time="12:05:47",
              strips=[{"callsign": "GBULK", "bay": "Departed", "takeoffStart": "12:03:48"},
                      {"callsign": "GLITE", "bay": "Line up"}])
    with seated(browser, w, w.tower) as twr, seated(browser, w, w.ground) as gnd, seated(browser, w, w.instructor) as ins:
        lined = strip_in(twr, "Line up", "GLITE")
        expect(timer(lined, "wake")).to_have_text(f"Wake {mss(1)}")
        tick(w, 1)
        expect(sim_clock(twr)).to_have_text("12:05:48")
        expect(lined).not_to_contain_text(f"Wake {mss(1)}")
        type_line(twr, "GLITE CLEARED TAKEOFF 27")
        expect(strip_in(twr, "Departed", "GLITE")).to_be_visible()
        for page in (twr, gnd, ins):
            expect(page.get_by_text("No alerts yet.", exact=True)).to_be_visible()
    assert state(w)["alerts"] == []


def test_arrival_spacing_rule(browser, app_url):
    w = World(app_url, [dep("GQRST"), arr("GDOWN"), arr("GNEAR")], with_session=False)
    holding = {"callsign": "GQRST", "bay": "Holding", "node": "A1"}
    lined = {"callsign": "GQRST", "bay": "Line up"}

    def clear(strip: dict, line: str, due: int) -> list[dict]:
        sid = w.add_session(strips=[strip, {"callsign": "GDOWN", "bay": "Arrivals", "dueSeconds": due}])
        return send(w.twr, sid, line).json()["alerts"]

    for strip, line in ((holding, "GQRST LINEUP 27"), (lined, "GQRST CLEARED TAKEOFF 27")):
        assert clear(strip, line, 47) == [{"rule": "R3", "text": "Arrival GDOWN due in 0:47; departure not allowed."}]
        assert clear(strip, line, 120) == [{"rule": "R3", "text": "Arrival GDOWN due in 2:00; departure not allowed."}]
        assert clear(strip, line, 121) == []

    sid = w.add_session(strips=[holding, {"callsign": "GDOWN", "bay": "Arrivals", "dueSeconds": 100},
                                {"callsign": "GNEAR", "bay": "Arrivals", "dueSeconds": 60}])
    answer = send(w.twr, sid, "GQRST LINEUP 27").json()
    assert answer["alerts"] == [{"rule": "R3", "text": "Arrival GNEAR due in 1:00; departure not allowed."}]
    assert copy_in(state(w, sid), "GQRST", "Line up")
    end(w, sid)
    assert [b["penalty"] for b in debrief(w, sid)["breakdown"]] == [15]

    sid = w.add_session(strips=[holding, {"callsign": "GDOWN", "bay": "Arrivals", "dueSeconds": 47}])
    message = "Arrival GDOWN due in 0:47; departure not allowed."
    with seated(browser, w, w.tower, sid=sid) as twr, seated(browser, w, w.instructor, sid=sid) as ins:
        type_line(twr, "GQRST LINEUP 27")
        for page in (twr, ins):
            expect(role(page, "status", "Alert announcements")).to_have_text(message)
            expect(role(page, "alert", "Urgent alerts")).not_to_contain_text("Arrival")
            expect(top_alert(page)).to_have_text(f"12:00:00 R3 {message}")


def test_wf_arrival_go_around_landing(browser, app_url):
    w = World(app_url, [arr("GDOWN", due=30), dep("GSTAY")])
    with seated(browser, w, w.tower, wrong_clock=True) as twr:
        type_line(twr, "GDOWN CLEARED LAND 27")
        strip = strip_in(twr, "Arrivals", "GDOWN")
        expect(strip).to_have_attribute(
            "aria-label", "GDOWN, ARR, B738, wake M, IFR, runway 27, no holding point, cleared CLEARED LAND 27")
        expect(timer(strip, "due")).to_have_text(due_text(30))
        expect(timer(strip, "due")).to_have_attribute("data-near", "true")
        advance(twr, DEVICE_ADVANCE_MS)
        expect(timer(strip, "due")).to_have_text(due_text(30))
        tick(w, 29)
        expect(timer(strip, "due")).to_have_text(due_text(1))
        row = position_row(twr, "GDOWN")
        expect(row).to_have_attribute("data-status", "final")
        tick(w, 1)
        expect(row).to_have_attribute("data-status", "landing")
        expect(row).to_have_attribute("data-node", "R27")
        expect(strip_in(twr, "Landed", "GDOWN")).to_have_count(0)
        tick(w, 39)
        expect(row).to_have_attribute("data-status", "landing")
        expect(symbol(twr, "GDOWN")).to_be_visible()
        tick(w, 1)
        expect(row).to_have_attribute("data-status", "vacated")
        expect(strip_in(twr, "Landed", "GDOWN")).to_be_visible()
        expect(strip_in(twr, "Arrivals", "GDOWN")).to_have_count(0)
        expect(symbol(twr, "GDOWN")).to_have_count(0)
    st = state(w)
    assert plane(st, "GDOWN")["status"] == "vacated"
    assert [c["bay"] for c in copies(st, "GDOWN")] == ["Landed"]
    assert st["alerts"] == []


def test_wf_arrival_go_around_three_ways(browser, app_url):
    w = World(app_url, [arr("GEVNT"), arr("GTYPE"), arr("GAUTO", due=5), dep("GDEPT")])
    sid = w.session
    with seated(browser, w, w.tower) as twr:
        box = command(twr)
        box.focus()
        partial = "GTY"
        twr.keyboard.type(partial)
        send(w.twr, sid, "GEVNT CLEARED LAND 27")
        assert event(w, {"kind": "go-around", "callsign": "GEVNT"}).status_code == 200
        strip = strip_in(twr, "Arrivals", "GEVNT")
        expect(strip).to_contain_text("GO AROUND")
        expect(strip).to_have_attribute("aria-label", re.compile(r", cleared none$"))
        expect(timer(strip, "due")).to_have_text("Due 5:00")
        send(w.twr, sid, "GTYPE GO AROUND")
        typed = strip_in(twr, "Arrivals", "GTYPE")
        expect(typed).to_contain_text("GO AROUND")
        expect(timer(typed, "due")).to_have_text("Due 5:00")
        tick(w, 5)
        auto = strip_in(twr, "Arrivals", "GAUTO")
        expect(auto).to_contain_text("GO AROUND")
        expect(timer(auto, "due")).to_have_text("Due 5:00")
        expect(timer(typed, "due")).to_have_text(due_text(295))
        expect(box).to_be_focused()
        expect(box).to_have_value(partial)
    assert plane(state(w), "GAUTO")["status"] == "final"
    wrong = event(w, {"kind": "go-around", "callsign": "GDEPT"})
    assert wrong.status_code == 422
    assert wrong.json() == {"error": "not_final", "message": "GDEPT is not on final."}
    unknown = event(w, {"kind": "go-around", "callsign": "GNONE"})
    assert unknown.status_code == 422
    assert unknown.json() == {"error": "parse", "message": "Unknown callsign GNONE."}
    end(w)
    result = debrief(w)
    events = rows_of(result["log"], "event")
    assert ("INS", "Go-around: GEVNT.") in events
    assert ("TWR", "Go-around: GAUTO.") in events
    typed_cs = "GTYPE"
    assert not [t for _, t in events if typed_cs in t]
    assert result["breakdown"] == []


def test_wf_arrival_go_around_phone_alert(browser, app_url):
    w = World(app_url, [dep("GQRST", stand="S3"), arr("GDOWN", due=900)],
              strips=[{"callsign": "GQRST", "bay": "Holding", "node": "A1"}, {"callsign": "GDOWN", "bay": "Arrivals", "dueSeconds": 47}])
    message = "Arrival GDOWN due in 0:47; departure not allowed."
    with seated(browser, w, w.tower, size=PHONE) as twr:
        type_line(twr, "GQRST LINEUP 27")
        expect(strip_in(twr, "Line up", "GQRST")).to_be_visible()
        expect(role(twr, "status", "Alert announcements")).to_have_text(message)
        tap(role(twr, "tab", "Alerts"))
        expect(top_alert(twr)).to_have_text(f"12:00:00 R3 {message}")
        tap(role(twr, "tab", "Map"))
        expect(position_row(twr, "GQRST")).to_have_attribute("data-status", "lining-up")
        layout(twr)


def test_wf_arrival_go_around_lifts_spacing(browser, app_url):
    w = World(app_url, [dep("GQRST", stand="S3"), arr("GDOWN", due=900)],
              strips=[{"callsign": "GQRST", "bay": "Holding", "node": "A1"}, {"callsign": "GDOWN", "bay": "Arrivals", "dueSeconds": 58}])
    with seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        arrival = strip_in(twr, "Arrivals", "GDOWN")
        due = timer(arrival, "due")
        expect(due).to_have_text(due_text(58))
        expect(due).to_have_attribute("data-near", "true")
        select(role(ins, "combobox", "Event"), "Go-around")
        select(role(ins, "combobox", "Aircraft"), "GDOWN")
        click(role(ins, "button", "Inject"))
        expect(due).to_have_text("Due 5:00")
        expect(due).not_to_have_attribute("data-near", "true")
        expect(arrival).to_contain_text("GO AROUND")
        type_line(twr, "GQRST LINEUP 27")
        expect(strip_in(twr, "Line up", "GQRST")).to_be_visible()
        expect(twr.get_by_text("No alerts yet.", exact=True)).to_be_visible()
    assert state(w)["alerts"] == []


def test_wf_route_preview_typing(browser, app_url):
    w = World(app_url, [dep("GQRST", stand="S3"), arr("GDOWN")], strips=[{"callsign": "GQRST", "bay": "Pushback"}])
    path = f"/api/sessions/{w.session}/preview"
    with seated(browser, w, w.ground) as gnd:
        gnd.keyboard.press("Tab")
        gnd.keyboard.press("/")
        box = command(gnd)
        expect(box).to_be_focused()
        strip = strip_in(gnd, "Pushback", "GQRST")
        gnd.keyboard.type("GQRST")
        expect(strip).to_have_attribute("data-preview", "true")
        expect(symbol(gnd, "GQRST")).to_have_attribute("data-selected", "true")
        expect(preview_items(gnd)).to_have_count(0)
        gnd.keyboard.type(" TAXI HP A1 VIA A")
        expect(preview_items(gnd)).to_have_text(["S3T", "E1", "A2"])
        advance(gnd, 800)
        assert segment_ids(gnd, "preview") and set(segment_ids(gnd, "preview")) == {"S3T", "E1", "A2"}
        before = state(w)
        reply = w.gnd.post(path, {"text": "GQRST TAXI HP A1 VIA A"})
        assert reply.status_code == 200
        assert reply.json() == {"callsign": "GQRST", "route": ["S3T", "E1", "A2"], "stop": "A1", "conflicts": []}
        assert w.gnd.post(path, {"text": "gqrst taxi hp a1 via"}).json()["route"] == ["S3T", "E1", "A2"]
        none = w.gnd.post(path, {"text": "GQRST TAXI HP A1 VIA C"}).json()
        assert (none["callsign"], none["route"], none["stop"]) == ("GQRST", [], None)
        assert w.gnd.post(path, {"text": "GDOWN CLEARED"}).json()["callsign"] is None
        assert w.gnd.post(path, {"text": "GNONE"}).json()["callsign"] is None
        after = state(w)
        assert after["strips"] == before["strips"] and after["aircraft"] == before["aircraft"]
        gnd.keyboard.press("Enter")
        expect(strip_in(gnd, "Taxi", "GQRST")).to_be_visible()
        expect(box).to_be_focused()
        expect(box).to_have_value("")
        expect(strip_in(gnd, "Taxi", "GQRST")).not_to_have_attribute("data-preview", "true")
    assert plane(state(w), "GQRST")["route"] == ["S3T", "E1", "A2"]


def test_lit_run_timing(browser, app_url):
    w = World(app_url, [dep("GABCD")], strips=[{"callsign": "GABCD", "bay": "Pushback"}])
    route = ["S1T", "W1", "A4", "A3", "A2"]
    line = "GABCD TAXI HP A1 VIA A"
    with seated(browser, w, w.ground, paused=True) as page:
        box = command(page)
        fill(box, line)
        pumped(page, lambda: expect(preview_items(page)).to_have_text(route, timeout=PUMP_CHECK_MS))
        advance(page, 20)
        assert segment_ids(page, "preview") == ["S1T"] or set(segment_ids(page, "preview")) == {"S1T"}
        advance(page, LIT_STEP_MS - 50)
        assert len(segment_ids(page, "preview")) == 1
        for count in (2, 3, 4, 5):
            advance(page, 70 if count == 2 else LIT_STEP_MS)
            lit = segment_ids(page, "preview")
            assert set(lit) == set(route[:count]), f"at step {count}: {lit}"
        expect(stop_bar(page, "A1")).to_have_count(0)
        advance(page, STOP_BAR_MS // 4)
        expect(stop_bar(page, "A1")).to_have_count(0)
        advance(page, STOP_BAR_MS)
        expect(stop_bar(page, "A1")).to_have_count(1)
        assert len(segment_ids(page, "preview")) == len(route)

        fill(box, "")
        pumped(page, lambda: expect(preview_items(page)).to_have_count(0, timeout=PUMP_CHECK_MS))
        advance(page, 20)
        expect(stop_bar(page, "A1")).to_have_count(0)
        advance(page, RETRACT_MS // 2 - 20)
        lit = segment_ids(page, "preview")
        assert 0 < len(lit) < len(route), f"retraction midway showed {lit}"
        assert set(lit) == set(route[: len(lit)]), "segments must retract from the end back to the start"
        advance(page, RETRACT_MAX_MS)
        assert segment_ids(page, "preview") == []
    with seated(browser, w, w.ground, reduced=True, paused=True) as page:
        box = command(page)
        fill(box, line)
        pumped(page, lambda: expect(preview_items(page)).to_have_text(route, timeout=PUMP_CHECK_MS))
        advance(page, 20)
        assert set(segment_ids(page, "preview")) == set(route)
        expect(stop_bar(page, "A1")).to_have_count(1)
        fill(box, "")
        pumped(page, lambda: expect(preview_items(page)).to_have_count(0, timeout=PUMP_CHECK_MS))
        advance(page, 20)
        assert segment_ids(page, "preview") == []
        expect(stop_bar(page, "A1")).to_have_count(0)


def test_wf_route_preview_conflict(browser, app_url):
    w = World(app_url, [dep("GQRST", stand="S3", hp="A6"), dep("GABCD"), dep("GHHHH", stand="S4")],
              strips=[{"callsign": cs, "bay": "Pushback"} for cs in ("GQRST", "GABCD", "GHHHH")])
    sid = w.session
    send(w.gnd, sid, "GQRST TAXI HP A6")
    message = "Taxi conflict on A4: GQRST and GABCD."
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        box = command(gnd)
        fill(box, "GABCD TAXI HP A1 VIA A")
        expect(preview_items(gnd)).to_have_text(["S1T", "W1", "A4 R4", "A3 R4", "A2"])
        advance(gnd, 800)
        for segment in ("A4", "A3"):
            expect(svg_object(gnd, "data-segment-id", segment)).to_have_attribute("data-conflict", "R4")
        expect(svg_object(gnd, "data-segment-id", "A2")).not_to_have_attribute("data-conflict", "R4")
        reply = w.gnd.post(f"/api/sessions/{sid}/preview", {"text": "GABCD TAXI HP A1 VIA A"}).json()
        assert reply["conflicts"] == [{"segment": "A4", "rule": "R4"}, {"segment": "A3", "rule": "R4"}]
        box.press("Enter")
        for page in (gnd, twr, ins):
            expect(top_alert(page)).to_have_text(f"12:00:00 R4 {message}")
            expect(top_alert(page)).to_have_attribute("data-rule", "R4")
            expect(role(page, "status", "Alert announcements")).to_have_text(message)
        fill(box, "GHHHH TAXI HP A1")
        expect(preview_items(gnd)).to_have_text(["S4T", "E1", "A2"])
        advance(gnd, 800)
        expect(svg_object(gnd, "data-holding", "A1")).to_have_attribute("data-conflict", "R4")
    conflict = w.gnd.post(f"/api/sessions/{sid}/preview", {"text": "GHHHH TAXI HP A1"}).json()["conflicts"]
    assert conflict == [{"segment": "A1", "rule": "R4"}]
    assert send(w.gnd, sid, "GHHHH TAXI HP A1").json()["alerts"] == [
        {"rule": "R4", "text": "Taxi conflict on A1: GABCD and GHHHH."}]


def test_latest_text_wins(browser, app_url):
    w = World(app_url, [dep("GABCD")], strips=[{"callsign": "GABCD", "bay": "Pushback"}])
    early, late = "GABCD TAXI HP A1", "GABCD TAXI HP A6"
    with seated(browser, w, w.ground) as page:
        kept: list[Any] = []
        seen: list[str] = []

        def handler(route) -> None:
            body = route.request.post_data_json
            seen.append(body["text"])
            if body["text"] == early:
                kept.append(route)
            else:
                route.fallback()

        page.route("**/api/sessions/*/preview", handler)
        box = command(page)
        fill(box, early)
        fill(box, late)
        expect(preview_items(page)).to_have_text(["S1T", "W1", "A5"])
        assert seen == [early, late], f"each text change must send its preview at once: {seen}"
        assert len(kept) == 1
        try:
            kept[0].fallback()
        except Exception:
            pass
        advance(page, 1000)
        expect(preview_items(page)).to_have_text(["S1T", "W1", "A5"])
        assert set(segment_ids(page, "preview")) == {"S1T", "W1", "A5"}
        expect(stop_bar(page, "A6")).to_have_count(1)
        expect(stop_bar(page, "A1")).to_have_count(0)


def test_wf_route_preview_goes_dark(browser, app_url):
    w = World(app_url, [dep("GQRST", stand="S3"), dep("GABCD", stand="S1")],
              strips=[{"callsign": "GQRST", "bay": "Pushback"}, {"callsign": "GABCD", "bay": "Pushback"}])
    sid = w.session
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.instructor) as ins:
        box = command(gnd)
        fill(box, "GQRST TAXI HP A1 VIA A")
        expect(preview_items(gnd)).to_have_count(3)
        advance(gnd, 800)
        box.press("Enter")
        expect(lit_segments(gnd, "accepted")).to_have_count(3)
        assert segment_ids(ins, "accepted") == []
        expect(stop_bar(gnd, "A1")).to_have_count(1)
        tick(w, 20)
        expect(sim_clock(gnd)).to_have_text("12:00:20")
        assert set(segment_ids(gnd, "accepted")) == {"S3T", "E1", "A2"}
        tick(w, 1)
        expect(lit_segments(gnd, "accepted")).to_have_count(2)
        assert set(segment_ids(gnd, "accepted")) == {"E1", "A2"}
        gnd.reload()
        connected(gnd, w)
        expect(lit_segments(gnd, "accepted")).to_have_count(2)
        assert set(segment_ids(gnd, "accepted")) == {"E1", "A2"}
        tick(w, 20)
        expect(lit_segments(gnd, "accepted")).to_have_count(1)
        assert segment_ids(gnd, "accepted") == ["A2"]
        tick(w, 29)
        expect(position_row(gnd, "GQRST")).to_have_attribute("data-status", "holding")
        expect(stop_bar(gnd, "A1")).to_have_count(1)
        send(w.gnd, sid, "GQRST CONTACT TOWER")
        accept(w, "GQRST")
        expect(stop_bar(gnd, "A1")).to_have_count(1)
        send(w.twr, sid, "GQRST LINEUP 27")
        expect(position_row(gnd, "GQRST")).to_have_attribute("data-status", "lining-up")
        expect(stop_bar(gnd, "A1")).to_have_count(0)

        box = command(gnd)
        fill(box, "GABCD TAXI HP A1 VIA A")
        expect(preview_items(gnd)).to_have_count(5)
        advance(gnd, 800)
        assert len(segment_ids(gnd, "preview")) == 5
        assert w.ins.post(f"/api/sessions/{sid}/pause").status_code == 200
        expect(role(gnd, "status", "Exercise state")).to_have_text("Paused")
        box.press("Enter")
        expect(command_error(gnd)).to_have_text("The exercise is paused.")
        expect(box).to_have_value("GABCD TAXI HP A1 VIA A")
        advance(gnd, RETRACT_MAX_MS + 100)
        assert segment_ids(gnd, "preview") == []
        assert segment_ids(gnd, "accepted") == []


def test_wf_incursion_overrun(browser, app_url):
    w = World(app_url, [dep("GOVER", stand="S3", overruns=True), dep("GNEXT", stand="S4")],
              strips=[{"callsign": "GOVER", "bay": "Taxi", "segment": "A2", "progress": 290},
                      {"callsign": "GNEXT", "bay": "Holding", "node": "A1"}])
    message = "Runway incursion at A1 by GOVER."
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        tick(w, 1)
        for page in (gnd, twr, ins):
            expect(top_alert(page)).to_have_text(f"12:00:01 R5 {message}")
            expect(top_alert(page)).to_have_attribute("data-severity", "critical")
            expect(role(page, "alert", "Urgent alerts")).to_have_text(message)
            expect(role(page, "status", "Alert announcements")).not_to_contain_text("incursion")
        expect(strip_in(twr, "Line up", "GOVER")).to_have_attribute("data-frequency", "TWR")
    st = state(w)
    row = plane(st, "GOVER")
    assert (row["status"], row["node"]) == ("lining-up", "A1")
    assert rules(st["alerts"]) == ["R5"]
    answer = send(w.twr, w.session, "GNEXT LINEUP 27").json()
    assert answer["alerts"] == [{"rule": "R1", "text": "Runway 27 occupied by GOVER."}]
    tick(w, 19)
    assert plane(state(w), "GOVER")["status"] == "lined-up" or plane(state(w), "GOVER")["status"] == "lining-up"
    tick(w, 1)
    assert plane(state(w), "GOVER")["status"] == "lined-up"

    offered = World(app_url, [dep("GOVER", overruns=True)],
                    strips=[{"callsign": "GOVER", "bay": "Hand-off", "segment": "A2", "progress": 290}])
    tick(offered, 1)
    st = state(offered)
    assert rules(st["alerts"]) == ["R5"]
    assert [(c["bay"], c["frequency"]) for c in copies(st, "GOVER")] == [("Line up", "TWR")]
    tick(offered, 65)
    assert rules(state(offered)["alerts"]) == ["R5"]


def test_wf_incursion_effects(browser, app_url):
    strips = [{"callsign": "GOVER", "bay": "Taxi", "segment": "A2", "progress": 290}]
    w = World(app_url, [dep("GOVER", overruns=True)], strips=strips)
    with seated(browser, w, w.ground, paused=True) as gnd, seated(browser, w, w.instructor, paused=True) as ins:
        tick(w, 1)
        regions = [(gnd, role(gnd, "region", "Ground board")), (ins, role(ins, "region", "Ground board")),
                   (ins, role(ins, "region", "Tower board"))]
        for page, region in regions:
            pumped(page, lambda region=region: expect(region).to_have_attribute("data-motion", "flash", timeout=PUMP_CHECK_MS))
        advance(gnd, FLASH_PRESENT_MS)
        advance(ins, FLASH_PRESENT_MS)
        for _, region in regions:
            expect(region).to_have_attribute("data-motion", "flash")
        advance(gnd, FLASH_GONE_MS - FLASH_PRESENT_MS)
        advance(ins, FLASH_GONE_MS - FLASH_PRESENT_MS)
        for _, region in regions:
            expect(region).not_to_have_attribute("data-motion", "flash")

    r = World(app_url, [dep("GOVER", overruns=True), dep("GPULS", stand="S2")], strips=strips)
    with seated(browser, r, r.tower, reduced=True, paused=True) as twr:
        send(r.gnd, r.session, "GPULS PUSH APPROVED")
        tick(r, 1)
        board = role(twr, "region", "Tower board")
        pumped(twr, lambda: expect(role(twr, "alert", "Urgent alerts")).to_have_text(
            f"Runway incursion at A1 by {PROBE_OVER}.", timeout=PUMP_CHECK_MS))
        pumped(twr, lambda: expect(board).to_have_attribute("data-outline", "static", timeout=PUMP_CHECK_MS))
        expect(board).not_to_have_attribute("data-motion", "flash")
        advance(twr, OUTLINE_PRESENT_MS)
        expect(board).to_have_attribute("data-outline", "static")
        advance(twr, OUTLINE_GONE_MS - OUTLINE_PRESENT_MS)
        expect(board).not_to_have_attribute("data-outline", "static")

    p = World(app_url, [dep("GOFFR")], strips=[{"callsign": "GOFFR", "bay": "Taxi", "segment": "A4", "progress": 10}])
    with seated(browser, p, p.tower, reduced=True) as twr:
        send(p.gnd, p.session, "GOFFR CONTACT TOWER")
        incoming = strip_in(twr, "Incoming", "GOFFR")
        expect(incoming).to_have_attribute("data-outline", "static")
        expect(incoming).not_to_have_attribute("data-motion", "pulse")


def test_wf_incursion_keeps_draft_and_focus(browser, app_url):
    w = World(app_url, [dep("GOVER", overruns=True), dep("GNEXT", stand="S4")],
              strips=[{"callsign": "GOVER", "bay": "Taxi", "segment": "A2", "progress": 290},
                      {"callsign": "GNEXT", "bay": "Holding", "node": "A6"}])
    cs = "GNEXT"
    with seated(browser, w, w.tower, paused=True) as twr:
        box = command(twr)
        box.focus()
        draft = f"{cs} HOLD"
        twr.keyboard.type(draft)
        tick(w, 1)
        urgent = role(twr, "alert", "Urgent alerts")
        pumped(twr, lambda: expect(urgent).to_have_text(f"Runway incursion at A1 by {PROBE_OVER}.", timeout=PUMP_CHECK_MS))
        board = role(twr, "region", "Tower board")
        pumped(twr, lambda: expect(board).to_have_attribute("data-motion", "flash", timeout=PUMP_CHECK_MS))
        expect(box).to_have_value(draft)
        expect(box).to_be_focused()
        twr.keyboard.type(" POSITION")
        expect(box).to_have_value(f"{draft} POSITION")


def test_wf_incursion_debrief_by_keyboard(browser, app_url):
    w = World(app_url, [dep("GOVER", overruns=True)], name="Overrun drill",
              strips=[{"callsign": "GOVER", "bay": "Taxi", "segment": "A2", "progress": 290}])
    with seated(browser, w, w.instructor) as ins:
        tick(w, 1)
        expect(top_alert(ins)).to_have_attribute("data-rule", "R5")
        role(ins, "button", "End exercise").focus()
        ins.keyboard.press("Enter")
        link = role(ins, "link", "Open debrief")
        expect(link).to_be_visible()
        link.focus()
        ins.keyboard.press("Enter")
        expect(ins).to_have_url(f"{app_url}/sessions/{w.session}/debrief")
        expect(role(ins, "status", "Score")).to_have_text("Score 70 of 100")
        expect(role(ins, "status", "Result")).to_have_text("Not passed")
        rows = role(ins, "table", "Score breakdown").get_by_role("row")
        expect(rows).to_have_count(3)
        assert table_cells(rows.nth(1)) == ["12:00:01", "R5", "Runway incursion at A1 by GOVER.", "-30"]


def test_wf_incursion_phone_reduced(browser, app_url):
    w = World(app_url, [dep("GOVER", overruns=True)],
              strips=[{"callsign": "GOVER", "bay": "Taxi", "segment": "A2", "progress": 290}])
    message = "Runway incursion at A1 by GOVER."
    with seated(browser, w, w.tower, size=PHONE, reduced=True) as twr:
        tick(w, 1)
        board = role(twr, "region", "Tower board")
        expect(board).to_have_attribute("data-outline", "static")
        expect(board).not_to_have_attribute("data-motion", "flash")
        expect(role(twr, "alert", "Urgent alerts")).to_have_text(message)
        tap(role(twr, "tab", "Alerts"))
        expect(top_alert(twr)).to_have_text(f"12:00:01 R5 {message}")
        expect(top_alert(twr)).to_have_attribute("data-severity", "critical")
        tap(role(twr, "tab", "Map"))
        expect(position_row(twr, "GOVER")).to_have_attribute("data-status", "lining-up")


def test_seeded_readback_errors(app_url):
    names = ["GAAAA", "GBBBB", "GCCCC", "GDDDD", "GEEEE"]

    def landing_run(seed: int, every: int | None) -> list[str]:
        w = World(app_url, [arr(cs, due=900) for cs in names], seed=seed, every=every)
        out = [send(w.twr, w.session, f"{cs} CLEARED LAND 27").json()["readback"] for cs in names]
        assert all(copy_in(state(w), cs, "Arrivals")["cleared"] == "CLEARED LAND 27" for cs in names)
        return out

    def expected(wrong: set[int]) -> list[str]:
        return [f"Cleared to land runway {'09' if n in wrong else '27'}, {cs}." for n, cs in enumerate(names, 1)]

    assert landing_run(2, 3) == expected({1, 4})
    assert landing_run(1, 3) == expected({2, 5})
    assert landing_run(2, 0) == expected(set())
    assert landing_run(2, None) == expected(set())

    w = World(app_url, [dep("GABCD")], seed=2, every=3, strips=[{"callsign": "GABCD", "bay": "Pushback"}])
    assert send(w.gnd, w.session, "GABCD TAXI HP A1 VIA A").json()["readback"] == "Taxi holding point A6 via A, GABCD."
    st = state(w)
    assert plane(st, "GABCD")["route"][-1] == "A2"
    assert copy_in(st, "GABCD", "Taxi")["cleared"] == "TAXI HP A1 VIA A"
    tick(w, 130)
    row = plane(state(w), "GABCD")
    assert (row["status"], row["node"]) == ("holding", "A1")

    w = World(app_url, [dep("GABCD", hp="A6")], seed=2, every=3, strips=[{"callsign": "GABCD", "bay": "Pushback"}])
    assert send(w.gnd, w.session, "GABCD TAXI HP A6").json()["readback"] == taxi_readback("A1", "GABCD")
    k = World(app_url, [dep("GCCCC", stand="N1", hp="D1")], aerodrome="kestrel-down", seed=2, every=3,
              strips=[{"callsign": "GCCCC", "bay": "Pushback"}])
    assert send(k.gnd, k.session, "GCCCC TAXI HP D1").json()["readback"] == taxi_readback("D6", "GCCCC")

    w = World(app_url, [dep("GAAAA"), dep("GBBBB", stand="S3", hp="A6")], seed=2, every=1,
              strips=[{"callsign": "GAAAA", "bay": "Pushback"}, {"callsign": "GBBBB", "bay": "Pushback"}])
    assert send(w.gnd, w.session, "GAAAA TAXI HP A1").json()["readback"] == taxi_readback("A6", "GAAAA")
    assert send(w.gnd, w.session, "GAAAA TAXI HP A1").json()["readback"] == taxi_readback("A1", "GAAAA")
    assert send(w.gnd, w.session, "GBBBB TAXI HP A6").json()["readback"] == taxi_readback("A1", "GBBBB")


def test_wf_readback_correction(browser, app_url):
    w = World(app_url, [dep("GABCD", stand="S3"), dep("GLEFT", stand="S1", hp="A6"), arr("GDOWN", due=900)], seed=2, every=1,
              strips=[{"callsign": "GABCD", "bay": "Pushback"}, {"callsign": "GLEFT", "bay": "Pushback"}])
    sid = w.session
    with seated(browser, w, w.ground, wrong_clock=True) as gnd:
        box = command(gnd)
        box.focus()
        gnd.keyboard.type("GABCD TAXI HP A1 VIA A")
        gnd.keyboard.press("Enter")
        expect(role(gnd, "status", "Readback")).to_have_text("Taxi holding point A6 via A, GABCD.")
        assert send(w.gnd, sid, "GLEFT TAXI HP A6").json()["readback"] == taxi_readback("A1", "GLEFT")
        assert send(w.twr, sid, "GDOWN CLEARED LAND 27").json()["readback"] == "Cleared to land runway 09, GDOWN."
        tick(w, 14)
        advance(gnd, DEVICE_ADVANCE_MS)
        assert state(w)["alerts"] == []
        refused(w.gnd, sid, "GABCD NEGATIVE HP A6", "That is not the clearance you gave.")
        box.focus()
        gnd.keyboard.type("GABCD NEGATIVE HP A1")
        gnd.keyboard.press("Enter")
        expect(role(gnd, "status", "Readback")).to_have_text("Correct, holding point A1, GABCD.")
        expect(box).to_have_value("")
        expect(strip_in(gnd, "Taxi", "GABCD")).to_have_attribute("aria-label", re.compile(r"cleared TAXI HP A1 VIA A$"))
        assert send(w.twr, sid, "GDOWN NEGATIVE RUNWAY 27").json()["readback"] == "Correct, runway 27, GDOWN."
        tick(w, 1)
        message = "Readback error not corrected: GLEFT."
        expect(top_alert(gnd)).to_have_text(f"12:00:15 R7 {message}")
        expect(role(gnd, "status", "Alert announcements")).to_have_text(message)
    assert rules(state(w)["alerts"]) == ["R7"]
    refused(w.gnd, sid, "GLEFT NEGATIVE HP A6", "GLEFT has nothing to correct.")
    refused(w.gnd, sid, "GABCD NEGATIVE HP A1", "GABCD has nothing to correct.")
    end(w)
    result = debrief(w)
    assert [(b["rule"], b["penalty"]) for b in result["breakdown"]] == [("R7", 10)]
    assert result["score"] == 90
    assert ("GND", "Correct, holding point A1, GABCD.") in rows_of(result["log"], "readback")
    assert ("TWR", "Correct, runway 27, GDOWN.") in rows_of(result["log"], "readback")


def test_wf_readback_repeatable(app_url):
    def run(seed: int) -> tuple[World, str, str]:
        w = World(app_url, WORKED_TRAFFIC, seed=seed, every=3, with_session=False)
        first = w.add_session(script=WORKED_SCRIPT, end_at=WORKED_END_AT)
        second = w.add_session(script=WORKED_SCRIPT, end_at=WORKED_END_AT)
        return w, first, second

    w, first, second = run(2)
    one, two = debrief(w, first), debrief(w, second)
    assert one["log"] == two["log"]
    assert one["breakdown"] == two["breakdown"]
    assert one["score"] == two["score"]
    assert "R7" in [row["rule"] for row in one["breakdown"]]
    other, third, _ = run(1)
    changed = [(r["simTime"], r["kind"], r["text"]) for r in debrief(other, third)["log"]]
    assert changed != [(r["simTime"], r["kind"], r["text"]) for r in one["log"]]


def test_wf_readback_wrong_correction_by_keyboard(browser, app_url):
    w = World(app_url, [dep("GABCD", stand="S3")], seed=2, every=3, strips=[{"callsign": "GABCD", "bay": "Pushback"}])
    with seated(browser, w, w.ground) as gnd:
        box = command(gnd)
        box.focus()
        gnd.keyboard.type("GABCD TAXI HP A1 VIA A")
        gnd.keyboard.press("Enter")
        expect(role(gnd, "status", "Readback")).to_have_text("Taxi holding point A6 via A, GABCD.")
        gnd.keyboard.type("GABCD NEGATIVE HP A6")
        gnd.keyboard.press("Enter")
        expect(command_error(gnd)).to_have_text("That is not the clearance you gave.")
        expect(box).to_have_value("GABCD NEGATIVE HP A6")
        expect(box).to_have_attribute("aria-invalid", "true")
        gnd.keyboard.press("End")
        gnd.keyboard.press("Backspace")
        gnd.keyboard.type("1")
        gnd.keyboard.press("Enter")
        expect(role(gnd, "status", "Readback")).to_have_text("Correct, holding point A1, GABCD.")
        expect(box).to_have_value("")
        expect(box).not_to_have_attribute("aria-invalid", "true")
        tick(w, 20)
        expect(gnd.get_by_text("No alerts yet.", exact=True)).to_be_visible()
    assert state(w)["alerts"] == []


def test_wf_readback_tower_missed(browser, app_url):
    w = World(app_url, [dep("GABCD", stand="S3", hp="A6"), dep("GQRST", stand="S4")], seed=1, every=3,
              strips=[{"callsign": "GABCD", "bay": "Pushback"}, {"callsign": "GQRST", "bay": "Holding", "node": "A1"}])
    with seated(browser, w, w.tower) as twr:
        send(w.gnd, w.session, "GABCD TAXI HP A6 VIA A")
        type_line(twr, "GQRST LINEUP 27")
        expect(role(twr, "status", "Readback")).to_have_text("Line up runway 09, GQRST.")
        tick(w, 14)
        expect(sim_clock(twr)).to_have_text(sim(14))
        expect(twr.get_by_text("No alerts yet.", exact=True)).to_be_visible()
        tick(w, 1)
        message = "Readback error not corrected: GQRST."
        expect(top_alert(twr)).to_have_text(f"12:00:15 R7 {message}")
        expect(role(twr, "status", "Alert announcements")).to_have_text(message)
        type_line(twr, "GQRST NEGATIVE RUNWAY 27")
        expect(command_error(twr)).to_have_text("GQRST has nothing to correct.")


def test_wf_readback_seen_by_sender_and_instructor(browser, app_url):
    w = World(app_url, [dep("GABCD", stand="S3")], seed=2, every=3, strips=[{"callsign": "GABCD", "bay": "Pushback"}])
    wrong = "Taxi holding point A6 via A, GABCD."
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr, seated(browser, w, w.instructor) as ins:
        type_line(gnd, "GABCD TAXI HP A1 VIA A")
        expect(role(gnd, "status", "Readback")).to_have_text(wrong)
        expect(role(ins, "status", "Readback")).to_have_text(wrong)
        expect(role(twr, "status", "Readback")).not_to_contain_text("GABCD")
        send(w.gnd, w.session, "GABCD NEGATIVE HP A1")
        tick(w, 70)
        for page in (gnd, twr, ins):
            row = position_row(page, "GABCD")
            expect(row).to_have_attribute("data-node", "A1")
            expect(row).to_have_attribute("data-status", "holding")


def test_wf_readback_rows_on_phone_debrief(browser, app_url):
    w = World(app_url, [dep("GABCD", stand="S3"), dep("GQRST", stand="S1", hp="A6")], name="Readback drill", seed=2, every=1,
              script=[{"at": 0, "position": "GND", "command": "GABCD PUSH APPROVED"},
                      {"at": 0, "position": "GND", "command": "GQRST PUSH APPROVED"},
                      {"at": 30, "position": "GND", "command": "GABCD TAXI HP A1 VIA A"},
                      {"at": 30, "position": "GND", "command": "GQRST TAXI HP A6"},
                      {"at": 31, "position": "GND", "command": "GABCD NEGATIVE HP A1"}], end_at=60)
    with client(browser, app_url, w.ground, f"/sessions/{w.session}/debrief", size=PHONE) as page:
        expect(role(page, "status", "Score")).to_have_text("Score 90 of 100")
        expect(role(page, "status", "Result")).to_have_text("Passed")
        timeline = role(page, "table", "Timeline")
        for cells in (["12:00:30", "GND", "readback", "Taxi holding point A6 via A, GABCD."],
                      ["12:00:30", "GND", "readback", "Taxi holding point A1, GQRST."],
                      ["12:00:31", "GND", "readback", "Correct, holding point A1, GABCD."],
                      ["12:00:45", "GND", "alert", "Readback error not corrected: GQRST."]):
            row = timeline.get_by_role("row").filter(has_text=cells[3])
            expect(row).to_have_count(1)
            shown = table_cells(row)
            assert all(want in got for want, got in zip(cells, shown)), f"{shown} must read {cells}"
        layout(page)


def test_wf_instructor_events_phone_console(browser, app_url):
    w = World(app_url, [dep("GABCD"), arr("GDOWN")])
    with seated(browser, w, w.instructor) as page:
        expect(Probe(page, '[data-layout="desktop"]')).to_have_count(1)
        ground, tower = role(page, "region", "Ground board"), role(page, "region", "Tower board")
        assert box_of(ground)["x"] < box_of(tower)["x"]
        for locator in (role(page, "region", "Airfield map"), no_alerts(page), role(page, "button", "Pause"),
                        role(page, "radiogroup", "Speed"), role(page, "button", "End exercise"),
                        role(page, "form", "Inject event"), role(page, "textbox", "Note"), role(page, "button", "Pin note")):
            expect(locator).to_be_visible()
        expect(role(page, "radio", "1x")).to_be_visible()
        expect(role(page, "radio", "2x")).to_be_visible()
        expect(role(page, "radio", "4x")).to_be_visible()
        options = role(page, "combobox", "Event").evaluate("e => [...e.options].map(o => o.text)")
        assert options == ["Close runway", "Reopen runway", "Go-around", "Emergency", "End emergency", "Wind change"]
        fill(role(page, "textbox", "Note"), "Good spacing call")
        click(role(page, "button", "Pin note"))
        form_status(page, "Note pinned.")
    end(w)
    assert ("INS", "Good spacing call") in rows_of(debrief(w)["log"], "note")

    w = World(app_url, [dep("GABCD"), arr("GDOWN")])
    with seated(browser, w, w.instructor, size=PHONE) as page:
        expect(Probe(page, '[data-layout="phone"]')).to_have_count(1)
        tablist = role(page, "tablist", "Console")
        expect(tablist.get_by_role("tab")).to_have_text(["Clock", "Events", "Alerts", "Boards"])
        expect(role(page, "tab", "Clock")).to_have_attribute("aria-selected", "true")
        clock_controls = [role(page, "button", "Pause"), role(page, "radio", "1x"), role(page, "radio", "2x"),
                          role(page, "radio", "4x"), role(page, "button", "End exercise"), role(page, "tab", "Clock")]
        for locator in clock_controls:
            expect(locator).to_be_visible()
            assert touch_height(locator) >= TOUCH_MIN
        tap(role(page, "tab", "Events"))
        for locator in (role(page, "combobox", "Event"), role(page, "button", "Inject"), role(page, "textbox", "Note"),
                        role(page, "button", "Pin note")):
            expect(locator).to_be_visible()
            assert touch_height(locator) >= TOUCH_MIN
        expect(role(page, "button", "Pause")).to_have_count(0)
        tap(role(page, "tab", "Alerts"))
        expect(no_alerts(page)).to_be_visible()
        tap(role(page, "tab", "Boards"))
        ground, tower = role(page, "region", "Ground board"), role(page, "region", "Tower board")
        field = role(page, "region", "Airfield map")
        expect(ground).to_be_visible()
        assert box_of(ground)["y"] < box_of(tower)["y"] < box_of(field)["y"]
        assert touch_height(strip_in(page, "Pending", "GABCD")) >= TOUCH_MIN
        layout(page)


def test_wf_instructor_events_pause_speed(browser, app_url):
    w = World(app_url, [dep("GABCD"), arr("GDOWN")])
    sid = w.session
    with seated(browser, w, w.instructor, size=PHONE) as ins, seated(browser, w, w.ground) as gnd, \
            seated(browser, w, w.tower) as twr:
        pages = (ins, gnd, twr)
        fill(command(gnd), DRAFT_LINE)
        tap(role(ins, "button", "Pause"))
        for page in pages:
            expect(role(page, "status", "Exercise state")).to_have_text("Paused")
        assert tick(w, 3)["simTime"] == "12:00:00"
        assert tick(w, 3)["state"] == "paused"
        expect(sim_clock(twr)).to_have_text("12:00:00")
        type_line(twr, "GDOWN CLEARED LAND 27")
        expect(command_error(twr)).to_have_text("The exercise is paused.")
        version = copy_in(state(w), "GABCD", "Pending")["version"]
        r = move(w.gnd, w, "GABCD", "Pushback", version)
        assert r.status_code == 409
        assert r.json() == {"error": "paused", "message": "The exercise is paused."}
        repeat = w.ins.post(f"/api/sessions/{sid}/pause")
        assert repeat.status_code == 200
        assert repeat.json()["status"] == "paused"

        tap(role(ins, "button", "Resume"))
        for page in pages:
            expect(role(page, "status", "Exercise state")).to_have_text("Running")
        tap_choice(role(ins, "radio", "4x"))
        for page in pages:
            expect(sim_clock(page)).to_have_attribute("data-speed", "4")
        expect(symbol(gnd, "GABCD")).to_have_attribute("data-glide-ms", "250")
        tap_choice(role(ins, "radio", "1x"))
        for page in pages:
            expect(sim_clock(page)).to_have_attribute("data-speed", "1")
        assert tick(w, 1)["simTime"] == sim(1)
        for page in pages:
            expect(sim_clock(page)).to_have_text(sim(1))
        expect(command(gnd)).to_have_value(DRAFT_LINE)
    assert state(w)["status"] == "running"
    assert state(w)["speed"] == 1


def test_wf_instructor_events_runway_closure(browser, app_url):
    w = World(app_url, [dep("GROLL"), dep("GLINE", stand="S2"), arr("GLAND", due=900)],
              strips=[{"callsign": "GROLL", "bay": "Departed", "takeoffStart": "12:00:00"},
                      {"callsign": "GLINE", "bay": "Holding", "node": "A1"}])
    sid = w.session
    with seated(browser, w, w.instructor, size=PHONE) as ins, seated(browser, w, w.ground) as gnd, \
            seated(browser, w, w.tower) as twr:
        tap(role(ins, "tab", "Events"))
        select(role(ins, "combobox", "Event"), "Close runway")
        tap(role(ins, "button", "Inject"))
        form_status(ins, "Event injected.")
        for page in (gnd, twr):
            expect(notice(page)).to_have_text("Runway 27 closed")
        expect(closed_word(twr)).to_be_visible()
        tap(role(ins, "tab", "Clock"))
        expect(notice(ins)).to_have_text("Runway 27 closed")

        answer = send(w.twr, sid, "GLINE LINEUP 27").json()
        assert answer["alerts"] == [{"rule": "R8", "text": "Runway 27 is closed."}]
        assert copy_in(state(w), "GLINE", "Line up")
        expect(top_alert(twr)).to_have_attribute("data-severity", "critical")

        tap(role(ins, "tab", "Events"))
        select(role(ins, "combobox", "Event"), "Reopen runway")
        tap(role(ins, "button", "Inject"))
        for page in (gnd, twr):
            expect(notice(page)).to_have_text("Runway 27 reopened")
        expect(closed_word(twr)).not_to_be_visible()
    answer = send(w.twr, sid, "GLAND CLEARED LAND 27").json()
    assert "R8" not in rules(answer["alerts"])
    end(w)
    result = debrief(w)
    events = rows_of(result["log"], "event")
    assert ("INS", "Runway 27 closed.") in events
    assert ("INS", "Runway 27 reopened.") in events
    assert [b["penalty"] for b in result["breakdown"] if b["rule"] == "R8"] == [20]


def test_wind_change(browser, app_url):
    w = World(app_url, [dep("GLINE"), arr("GDOWN", due=900)], strips=[{"callsign": "GLINE", "bay": "Holding", "node": "A1"}])
    with seated(browser, w, w.tower) as twr, seated(browser, w, w.ground) as gnd:
        assert event(w, {"kind": "wind", "windDir": 300, "windKt": 9}).status_code == 200
        expect(role(twr, "status", "Wind")).to_have_text("300 at 9 kt")
        no_notice(twr)
        event(w, {"kind": "wind", "windDir": 180, "windKt": 9})
        expect(role(twr, "status", "Wind")).to_have_text("180 at 9 kt")
        no_notice(twr)

        strip_in(twr, "Holding", "GLINE").focus()
        twr.keyboard.press("Control+ArrowRight")
        expect(command(twr)).to_have_value(lineup_line("GLINE", "27"))
        twr.keyboard.press("Escape")

        event(w, {"kind": "wind", "windDir": 90, "windKt": 12})
        for page in (twr, gnd):
            expect(role(page, "status", "Wind")).to_have_text(wind_text(90, 12))
            expect(notice(page)).to_have_text(change_text("09", 120))
        tick(w, 1)
        expect(notice(twr)).to_have_text(change_text("09", 119))
        tick(w, 118)
        expect(notice(twr)).to_have_text(change_text("09", 1))
        expect(role(twr, "status", "Runway in use")).to_have_text("27")
        tick(w, 1)
        for page in (twr, gnd):
            expect(notice(page)).to_have_text("Runway in use 09")
            expect(role(page, "status", "Runway in use")).to_have_text("09")
        arrival = strip_in(twr, "Arrivals", "GDOWN")
        expect(arrival).to_have_attribute("aria-label", re.compile(r", runway 09, no holding point, "))
        strip_in(twr, "Holding", "GLINE").focus()
        twr.keyboard.press("Control+ArrowRight")
        expect(command(twr)).to_have_value(lineup_line("GLINE", "09"))
        twr.keyboard.press("Escape")
        arrival.focus()
        twr.keyboard.press("Control+ArrowRight")
        expect(command(twr)).to_have_value("GDOWN CLEARED LAND 09")
    assert state(w)["runwayInUse"] == "09"
    end(w)
    events = rows_of(debrief(w)["log"], "event")
    assert ("INS", "Wind 090 at 12 kt.") in events
    assert ("INS", "Runway in use 09.") in events


def test_wf_instructor_events_emergency(browser, app_url):
    w = World(app_url, [dep("GEMRG", stand="S1", hp="A6"), dep("GTAXI", stand="S3"), dep("GHOLD", stand="S4")],
              strips=[{"callsign": "GEMRG", "bay": "Taxi", "segment": "S1T", "progress": 10},
                      {"callsign": "GTAXI", "bay": "Taxi", "segment": "E1", "progress": 10},
                      {"callsign": "GHOLD", "bay": "Holding", "node": "A1"}])
    sid = w.session
    holding = "All traffic is holding for GEMRG."
    with seated(browser, w, w.instructor) as ins, seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr:
        form = role(ins, "form", "Inject event")
        select(role(form, "combobox", "Event"), "Emergency")
        select(role(form, "combobox", "Aircraft"), "GEMRG")
        click(role(form, "button", "Inject"))
        form_status(ins, "Event injected.")
        for page in (ins, gnd, twr):
            expect(notice(page)).to_have_text(f"Emergency {PROBE_EMRG}: all traffic hold.")
            expect(symbol(page, "GEMRG")).to_have_attribute("data-emergency", "true")
        strip = strip_in(gnd, "Taxi", "GEMRG")
        expect(strip).to_have_attribute("data-emergency", "true")
        expect(strip).to_contain_text("EMERGENCY")
        st = state(w)
        assert plane(st, "GTAXI")["status"] == "stopped"
        assert plane(st, "GEMRG")["status"] == "taxiing"
        stopped_at = plane(st, "GTAXI")["progress"]
        refused(w.gnd, sid, "GTAXI CONTINUE TAXI", holding)
        refused(w.gnd, sid, "GTAXI TAXI HP A1", holding)
        refused(w.twr, sid, "GHOLD LINEUP 27", holding)
        assert send(w.gnd, sid, "GEMRG TAXI HP A6").status_code == 200

        select(role(form, "combobox", "Event"), "End emergency")
        click(role(form, "button", "Inject"))
        for page in (ins, gnd, twr):
            no_notice(page)
            expect(symbol(page, "GEMRG")).not_to_have_attribute("data-emergency", "true")
        expect(strip_in(gnd, "Taxi", "GEMRG")).not_to_contain_text("EMERGENCY")
    tick(w, 3)
    row = plane(state(w), "GTAXI")
    assert (row["status"], row["progress"]) == ("stopped", stopped_at)
    assert send(w.gnd, sid, "GTAXI CONTINUE TAXI").json()["readback"] == f"Continuing taxi, {PROBE_TAXI}."
    end(w)
    events = rows_of(debrief(w)["log"], "event")
    assert ("INS", "Emergency: GEMRG.") in events
    assert ("INS", "Emergency ended: GEMRG.") in events


def test_instructor_only_actions(app_url):
    w = World(app_url, [dep("GABCD"), arr("GDOWN")])
    sid = w.session
    before = state(w)
    calls = [(f"/api/sessions/{sid}/pause", None), (f"/api/sessions/{sid}/resume", None),
             (f"/api/sessions/{sid}/speed", {"speed": 4}), (f"/api/sessions/{sid}/end", None),
             (f"/api/sessions/{sid}/notes", {"text": "from a student"}),
             (f"/api/sessions/{sid}/events", {"kind": "closure", "runway": "27"}),
             ("/api/sessions", {"scenario": w.scenario})]
    for path, body in calls:
        r = w.gnd.post(path, body)
        assert r.status_code == 404, f"{path}: {r.status_code} {r.text}"
        assert r.json() == {"error": "not_found"}
    assert w.gnd.delete(f"/api/sessions/{sid}/seats/TWR").status_code == 404
    assert w.gnd.get("/api/scenarios").status_code == 404
    assert w.gnd.client.post("/api/aerodromes/import", content=WORKED_LAYOUT.encode()).status_code == 404

    version = copy_in(before, "GABCD", "Pending")["version"]
    unseated = [(f"/api/sessions/{sid}/commands", {"text": "GABCD PUSH APPROVED"}),
                (f"/api/sessions/{sid}/preview", {"text": "GABCD"}),
                (f"/api/sessions/{sid}/strips/GABCD/move", {"to": "Pushback", "version": version})]
    for path, body in unseated:
        r = w.other.post(path, body)
        assert r.status_code == 404, f"{path}: {r.status_code} {r.text}"
        assert r.json() == {"error": "not_found"}
    after = state(w)
    for key in ("status", "speed", "simTime", "strips", "aircraft", "alerts"):
        assert after[key] == before[key], key
    end(w)
    assert debrief(w)["log"] == [{"simTime": "12:00:00", "position": "INS", "kind": "event", "text": "Exercise ended."}]


def test_seats_and_reconnection(browser, app_url):
    w = World(app_url, [dep("GABCD")], seated=False)
    sid = w.session
    seats = f"/api/sessions/{sid}/seats"
    r = w.gnd.post(seats, {"position": "GND"})
    assert r.status_code == 200 and r.json() == {"position": "GND"}
    assert w.gnd.post(seats, {"position": "GND"}).json() == {"position": "GND"}
    held_other = w.gnd.post(seats, {"position": "TWR"})
    assert held_other.status_code == 409
    assert held_other.json() == {"error": "seat_held", "message": "You already hold a seat in this exercise."}
    taken = w.twr.post(seats, {"position": "GND"})
    assert taken.status_code == 409
    assert taken.json() == {"error": "seat_taken", "message": "This seat is taken."}
    bad = w.twr.post(seats, {"position": "RADAR"})
    assert bad.status_code == 422
    assert bad.json() == {"errors": {"position": "Position must be GND or TWR."}}
    assert w.twr.post(seats, {"position": "TWR"}).status_code == 200
    assert w.gnd.post(seats, {"position": "TWR"}).json()["error"] == "seat_held"
    assert w.ins.delete(f"{seats}/RADAR").status_code == 404

    in_use = {"error": "seat_in_use", "message": "This seat is still in use."}
    with client(browser, app_url, w.ground, f"/sessions/{sid}") as page:
        expect(role(page, "region", "Ground board")).to_be_visible()
        connected(page, w)
        r = w.ins.delete(f"{seats}/GND")
        assert r.status_code == 409 and r.json() == in_use
    r = w.ins.delete(f"{seats}/GND")
    assert r.status_code == 409 and r.json() == in_use
    with client(browser, app_url, w.ground, f"/sessions/{sid}") as page:
        expect(role(page, "region", "Ground board")).to_be_visible()
        connected(page, w)

    with client(browser, app_url, w.instructor, f"/sessions/{sid}") as console:
        reassign = role(console, "button", "Reassign GND seat")

        def wait_for_reassign() -> None:
            for _ in range(GRACE_POLLS):
                try:
                    expect(reassign).to_be_visible(timeout=GRACE_POLL_MS)
                    return
                except AssertionError:
                    console.reload()
            pytest.fail("the console never offered Reassign GND seat after the seat's grace ended")

        wait_for_reassign()
        with client(browser, app_url, w.ground, f"/sessions/{sid}") as page:
            expect(role(page, "region", "Ground board")).to_be_visible()
            connected(page, w)
        console.reload()
        wait_for_reassign()
        click(reassign)
        expect(reassign).to_have_count(0)
    with client(browser, app_url, w.spare, f"/sessions/{sid}") as page:
        click(role(page, "button", "Take GND seat"))
        expect(role(page, "region", "Ground board")).to_be_visible()
    taken = w.gnd.post(seats, {"position": "GND"})
    assert taken.status_code == 409
    assert taken.json()["error"] == "seat_taken"


def test_wf_debrief_replay_open_debrief(browser, app_url):
    w = World(app_url, [dep("GABCD")], name="Short check")
    sid = w.session
    waiting = "Debrief is ready when the exercise ends."
    r = w.ins.get(f"/api/sessions/{sid}/debrief")
    assert r.status_code == 409
    assert r.json() == {"error": "running", "message": waiting}
    with client(browser, app_url, w.instructor, f"/sessions/{sid}/debrief") as page:
        expect(page.get_by_text(waiting, exact=True)).to_be_visible()
        expect(role(page, "button", "Export CSV")).to_have_count(0)
    with seated(browser, w, w.instructor) as ins, seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr:
        click(role(ins, "button", "End exercise"))
        for page in (ins, gnd, twr):
            expect(role(page, "status", "Exercise state")).to_have_text("Ended")
            expect(role(page, "link", "Open debrief")).to_be_visible()
        click(role(ins, "link", "Open debrief"))
        expect(ins).to_have_url(f"{app_url}/sessions/{sid}/debrief")
        expect(role(ins, "heading", "Debrief: Short check")).to_be_visible()
        ins.reload()
        assert ins.url == f"{app_url}/sessions/{sid}/debrief"
        expect(role(ins, "heading", "Debrief: Short check")).to_be_visible()
    again = w.ins.post(f"/api/sessions/{sid}/end")
    assert again.status_code == 200 and again.json() == {"status": "ended"}
    log = debrief(w)["log"]
    assert rows_of(log).count(("INS", "Exercise ended.")) == 1


def test_wf_debrief_replay_score_timeline(browser, app_url):
    w = worked(app_url)
    result = debrief(w)
    assert result["score"] == 80 and result["passed"] is True
    assert [(b["simTime"], b["rule"], b["penalty"]) for b in result["breakdown"]] == [("12:03:10", "R6", 5), ("12:03:32", "R2", 15)]
    assert len(result["log"]) == 25
    assert result["log"][0] == {"simTime": "12:00:00", "position": "GND", "kind": "command", "text": "GBULK PUSH APPROVED"}
    assert result["log"][-1] == {"simTime": "12:04:02", "position": "INS", "kind": "event", "text": "Exercise ended."}
    with client(browser, app_url, w.instructor, f"/sessions/{w.session}/debrief") as page:
        expect(role(page, "heading", "Debrief: Wake check")).to_be_visible()
        expect(role(page, "status", "Score")).to_have_text("Score 80 of 100")
        expect(role(page, "status", "Result")).to_have_text("Passed")
        breakdown = role(page, "table", "Score breakdown")
        expect(breakdown.get_by_role("columnheader")).to_have_text(["Sim time", "Rule", "Detail", "Points"])
        rows = breakdown.get_by_role("row")
        expect(rows).to_have_count(4)
        assert table_cells(rows.nth(1)) == ["12:03:10", "R6", "Late handoff: GLITE reached A1 on Ground.", "-5"]
        assert table_cells(rows.nth(2)) == ["12:03:32", "R2", "Wake: 2:00 required behind GBULK (H), 1:32 elapsed.", "-15"]
        assert table_cells(rows.nth(3)) == ["Total", "", "", "80"]
        timeline = role(page, "table", "Timeline")
        expect(timeline.get_by_role("columnheader")).to_have_text(["Sim time", "Position", "Kind", "Text"])
        lines = timeline.get_by_role("row")
        expect(lines).to_have_count(26)
        assert table_cells(lines.nth(1)) == ["12:00:00", "GND", "command", "GBULK PUSH APPROVED"]
        assert table_cells(lines.nth(25)) == ["12:04:02", "INS", "event", "Exercise ended."]

    s = World(app_url, [dep("GSLOT", slot=600)], sim_time="12:18:30", strips=[{"callsign": "GSLOT", "bay": "Line up"}],
              script=[{"at": 0, "position": "TWR", "command": "GSLOT CLEARED TAKEOFF 27"}], end_at=40)
    assert debrief(s)["score"] == 100 - 3
    with client(browser, app_url, s.instructor, f"/sessions/{s.session}/debrief") as page:
        rows = role(page, "table", "Score breakdown").get_by_role("row")
        expect(rows).to_have_count(3)
        assert table_cells(rows.nth(1)) == ["12:18:30", "Slot", "Slot delay GSLOT: 3 min", "-3"]
        assert table_cells(rows.nth(2)) == ["Total", "", "", "97"]

    names = ["GAAAA", "GBBBB", "GCCCC", "GDDDD", "GEEEE"]
    z = World(app_url, [dep(cs, overruns=True) for cs in names], end_at=5, script=[],
              strips=[{"callsign": cs, "bay": "Taxi", "segment": "A2", "progress": 290} for cs in names])
    floor = debrief(z)
    assert floor["score"] == 0 and floor["passed"] is False
    assert [b["rule"] for b in floor["breakdown"]] == ["R5"] * 5
    with client(browser, app_url, z.instructor, f"/sessions/{z.session}/debrief") as page:
        expect(role(page, "status", "Score")).to_have_text("Score 0 of 100")
        expect(role(page, "status", "Result")).to_have_text("Not passed")


def test_wf_debrief_replay_scrub(browser, app_url):
    w = worked(app_url)
    sid = w.session
    with client(browser, app_url, w.instructor, f"/sessions/{sid}/debrief") as page:
        slider = role(page, "slider", "Replay")
        expect(slider).to_have_attribute("aria-valuemin", "0")
        expect(slider).to_have_attribute("aria-valuemax", str(WORKED_LENGTH))
        slider.focus()

        def press(key: str, value: int) -> None:
            page.keyboard.press(key)
            expect(slider).to_have_attribute("aria-valuenow", str(value))

        press("Home", 0)
        expect(slider).to_have_attribute("aria-valuetext", "12:00:00")
        press("ArrowLeft", 0)
        press("PageDown", 0)
        press("PageUp", 60)
        for value in range(59, 49, -1):
            press("ArrowLeft", value)
        expect(slider).to_have_attribute("aria-valuetext", "12:00:50")
        region = role(page, "region", "Replay map")
        row = position_row(region, "GBULK")
        expect(row).to_have_attribute("data-segment", "S3T")
        expect(row).to_have_attribute("data-progress", "100")
        current = Probe(page, '[aria-current="true"]')
        expect(current).to_have_count(1)
        expect(current).to_contain_text("12:00:41")
        expect(current).to_contain_text("Handoff accepted: GBULK.")
        expect(Probe(page, "[data-motion]")).to_have_count(0)
        for value in range(51, 71):
            press("ArrowRight", value)
        expect(row).to_have_attribute("data-segment", "E1")
        expect(row).to_have_attribute("data-progress", "200")
        for value in range(71, 102):
            press("ArrowRight", value)
        expect(row).to_have_attribute("data-status", "lining-up")
        expect(row).to_have_attribute("data-node", "A1")
        press("End", WORKED_LENGTH)
        press("ArrowRight", WORKED_LENGTH)
        press("PageUp", WORKED_LENGTH)
    replay = w.ins.get(f"/api/sessions/{sid}/replay?t=70").json()
    assert replay["simTime"] == "12:01:10"
    row = next(a for a in replay["aircraft"] if a["callsign"] == "GBULK")
    assert (row["segment"], row["progress"]) == ("E1", 200)

    with client(browser, app_url, w.ground, f"/sessions/{sid}/debrief", size=PHONE, reduced=True) as page:
        expect(role(page, "status", "Score")).to_have_text("Score 80 of 100")
        expect(role(page, "table", "Score breakdown")).to_be_attached()
        expect(role(page, "table", "Timeline")).to_be_attached()
        layout(page)
        slider = role(page, "slider", "Replay")
        slider.focus()
        page.keyboard.press("Home")
        expect(slider).to_have_attribute("aria-valuenow", "0")
        page.keyboard.press("PageUp")
        expect(slider).to_have_attribute("aria-valuenow", "60")
        expect(position_row(role(page, "region", "Replay map"), "GBULK")).to_have_attribute("data-segment", "E1")
        expect(Probe(page, "[data-motion]")).to_have_count(0)


def test_wf_debrief_replay_phone_reflow(browser, app_url):
    w = worked(app_url)
    with client(browser, app_url, w.tower, f"/sessions/{w.session}/debrief", size=PHONE) as page:
        table = role(page, "table", "Score breakdown")
        expect(table).to_be_visible()
        rows = table.get_by_role("row")
        expect(rows.filter(has_text="Late handoff: GLITE reached A1 on Ground.")).to_have_count(1)
        cells = rows.filter(has_text="Late handoff: GLITE reached A1 on Ground.").get_by_role("cell")
        first, second = box_of(cells.nth(0)), box_of(cells.nth(1))
        assert second["y"] >= first["y"] + first["height"] - 1, f"cells must stack on a phone: {first} {second}"
        layout(page)


def test_wf_debrief_replay_pinned_note(browser, app_url):
    w = World(app_url, [dep("GABCD")], name="Noted run")
    note = "Watch the hold short"
    with seated(browser, w, w.instructor) as ins:
        tick(w, 10)
        expect(sim_clock(ins)).to_have_text(sim(10))
        field = role(ins, "textbox", "Note")
        field.focus()
        ins.keyboard.type(note)
        role(ins, "button", "Pin note").focus()
        ins.keyboard.press("Enter")
        form_status(ins, "Note pinned.")
        tick(w, 5)
        click(role(ins, "button", "End exercise"))
        click(role(ins, "link", "Open debrief"))
        row = role(ins, "table", "Timeline").get_by_role("row").filter(has_text=note)
        expect(row).to_have_count(1)
        assert table_cells(row) == [sim(10), "INS", "note", note]
        slider = role(ins, "slider", "Replay")
        slider.focus()
        ins.keyboard.press("Home")
        for value in range(1, 11):
            ins.keyboard.press("ArrowRight")
            expect(slider).to_have_attribute("aria-valuenow", str(value))
        expect(row).to_have_attribute("aria-current", "true")


def test_wf_records_reports_student_record(browser, app_url):
    traffic = [dep("GOVRA", overruns=True), dep("GOVRB", stand="S2", overruns=True)]
    overrun = [{"callsign": cs, "bay": "Taxi", "segment": "A2", "progress": 290} for cs in ("GOVRA", "GOVRB")]
    w = World(app_url, traffic, with_session=False)
    tag = w.tag
    names = {k: f"{k} {tag}" for k in ("Mixed", "Weak", "Late", "Unsat")}
    keys = {k: w.add_scenario(traffic, name=n) for k, n in names.items()}
    due = {"Mixed": "2027-04-12", "Weak": "2027-04-30", "Late": "2027-04-11", "Unsat": "2027-04-30"}
    assigned = {k: w.add_assignment(keys[k], due[k]) for k in keys}
    clean = w.add_session(keys["Mixed"], assignment=assigned["Mixed"], end_at=5)
    w.add_session(keys["Mixed"], assignment=assigned["Mixed"], strips=overrun, end_at=5)
    w.add_session(keys["Weak"], assignment=assigned["Weak"], strips=overrun, end_at=5)
    w.add_session(keys["Late"], assignment=assigned["Late"], end_at=5)
    student = w.ids[w.ground.email]
    expected = {"Mixed": ("Attempts: 2", "Best score: 100", "Status: Passed"),
                "Weak": ("Attempts: 1", "Best score: 40", "Status: Not passed"),
                "Late": ("Attempts: 1", "Best score: none", "Status: Not attempted"),
                "Unsat": ("Attempts: 0", "Best score: none", "Status: Not attempted")}
    with client(browser, app_url, w.ground, f"/records/{student}") as page:
        expect(role(page, "heading", f"Record: {w.ground.name}")).to_be_visible()
        results = role(page, "list", "Assignment results")
        for key, lines in expected.items():
            item = results.get_by_role("listitem").filter(has_text=names[key]).first
            for line in lines:
                expect(item).to_contain_text(line)
        table = role(page, "table", "Attempts")
        headers = table.get_by_role("columnheader")
        assert [t.strip() for t in headers.all_inner_texts()][:6] == ["Scenario", "Finished", "Position", "Score", "Result", "Timing"]
        expect(table.get_by_role("row")).to_have_count(5)
        late = table_cells(table.get_by_role("row").filter(has_text=names["Late"]))
        assert late[:6] == [names["Late"], "2027-04-12", "GND", "100", "Passed", "Late"]
        weak = table_cells(table.get_by_role("row").filter(has_text=names["Weak"]))
        assert weak[:6] == [names["Weak"], "2027-04-12", "GND", "40", "Not passed", "On time"]
        links = role(table, "link", "Open debrief")
        expect(links).to_have_count(4)
        paths = links.evaluate_all("els => els.map(e => e.pathname)")
        assert f"/sessions/{clean}/debrief" in paths
    body = w.gnd.get(f"/api/records/{student}").json()
    assert body["name"] == w.ground.name
    assert len(body["attempts"]) == 4


def test_record_privacy(browser, app_url):
    w = worked(app_url)
    sid = w.session
    own = w.ids[w.ground.email]
    assert w.gnd.get(f"/api/records/{own}").status_code == 200
    assert w.ins.get(f"/api/records/{own}").status_code == 200
    assert w.gnd.get(f"/api/sessions/{sid}/debrief").status_code == 200
    assert w.ins.get(f"/api/sessions/{sid}/debrief").status_code == 200
    denied = [(w.twr, f"/api/records/{own}"), (w.other, f"/api/records/{own}"), (w.other, f"/api/sessions/{sid}/debrief"),
              (w.other, f"/api/sessions/{sid}/replay?t=0"), (w.other, f"/api/sessions/{sid}/report.csv"),
              (w.other, f"/api/sessions/{sid}/report.pdf")]
    for api, path in denied:
        r = api.get(path)
        assert r.status_code == 404, f"{path}: {r.status_code}"
        assert r.json() == {"error": "not_found"}
    assert S3().keys(f"reports/{sid}/") == []
    with client(browser, app_url, w.tower, f"/records/{own}") as page:
        expect(role(page, "heading", "Not found.")).to_be_visible()
        expect(page.get_by_text(f"Record: {w.ground.name}")).to_have_count(0)
    with client(browser, app_url, w.spare, f"/sessions/{sid}/debrief") as page:
        expect(role(page, "heading", "Not found.")).to_be_visible()
    with client(browser, app_url, w.instructor, f"/records/{own}") as page:
        expect(role(page, "heading", f"Record: {w.ground.name}")).to_be_visible()


def test_wf_records_reports_exports(browser, app_url, mail):
    w = worked(app_url)
    sid = w.session
    with client(browser, app_url, w.ground, f"/sessions/{sid}/debrief") as page:
        status = role(page, "status", "Export status")
        role(page, "button", "Export CSV").focus()
        with page.expect_download() as info:
            with held(page, "**/api/sessions/*/report.csv") as gate:
                page.keyboard.press("Enter")
                expect(status).to_have_text("Preparing report...")
                release(gate)
        assert info.value.suggested_filename == "report.csv"
        csv_bytes = download_bytes(info)
        expect(status).to_have_text("Report saved. Notice sent.")
        role(page, "button", "Export PDF").focus()
        with page.expect_download() as info:
            page.keyboard.press("Space")
        assert info.value.suggested_filename == "report.pdf"
        pdf_bytes = download_bytes(info)
        expect(status).to_have_text("Report saved. Notice sent.")
        role(page, "button", "Export CSV").focus()
        with page.expect_download():
            page.keyboard.press("Enter")
        expect(status).to_have_text("Report saved.")

    store = S3()
    assert store.get(f"reports/{sid}/report.csv") == csv_bytes
    assert store.get(f"reports/{sid}/report.pdf") == pdf_bytes
    assert len(mails(mail, w.ground.email, "Report ready: Wake check", 2)) == 2

    content = csv_bytes.decode()
    lines = content.split("\r\n")
    assert lines[0] == "sim_time,position,kind,callsign,rule,penalty,text"
    assert '12:00:30,GND,readback,GBULK,,,"Taxi holding point A1 via A, GBULK."' in lines
    assert '12:03:32,TWR,alert,GLITE,R2,15,"Wake: 2:00 required behind GBULK (H), 1:32 elapsed."' in lines
    assert [line for line in lines if line][-1] == "12:04:02,INS,score,,,,Score 80 of 100"
    rows = list(csv.DictReader(io.StringIO(content, newline="")))
    assert len(rows) == 26
    by_text = {row["text"]: row for row in rows}
    assert by_text["Handoff accepted: GBULK."]["callsign"] == "GBULK"
    assert by_text["Exercise ended."]["callsign"] == ""
    late = by_text["Late handoff: GLITE reached A1 on Ground."]
    assert (late["callsign"], late["rule"], late["penalty"]) == ("GLITE", "R6", "5")

    extracted = pdf_text(pdf_bytes)
    found = {" ".join(line.split()) for line in extracted.splitlines()}
    for line in ("Runup Bay debrief", "Scenario: Wake check", "Aerodrome: Wrenfield",
                 f"Students: {w.ground.name} (GND), {w.tower.name} (TWR)", "Score: 80 of 100", "Result: Passed",
                 "12:03:10 R6 Late handoff: GLITE reached A1 on Ground. -5",
                 "12:03:32 R2 Wake: 2:00 required behind GBULK (H), 1:32 elapsed. -15", "Total 80",
                 "12:00:30 GND readback Taxi holding point A1 via A, GBULK.", "12:04:02 INS event Exercise ended.",
                 "Training only - page 1 of 2", "Training only - page 2 of 2"):
        assert line in found, f"PDF lacks the line {line!r}"


def test_report_storage_and_notices(app_url, mail):
    w = worked(app_url)
    sid = w.session
    store = S3()
    subject = "Report ready: Wake check"
    assert store.keys(f"reports/{sid}/") == []
    kinds = (("csv", "text/csv; charset=utf-8", "CSV"), ("pdf", "application/pdf", "PDF"))
    for count, (kind, content_type, word) in enumerate(kinds, 1):
        path = f"/api/sessions/{sid}/report.{kind}"
        first = w.gnd.get(path)
        assert first.status_code == 200, first.text
        assert first.headers["content-type"] == content_type
        assert first.headers["x-report-notice"] == "sent"
        disposition = first.headers["content-disposition"]
        assert "attachment" in disposition and f"report.{kind}" in disposition
        assert first.content and store.get(f"reports/{sid}/report.{kind}") == first.content
        notices = mails(mail, w.ground.email, subject, count)
        assert word in text(notices[-1]) or any(word in text(m) for m in notices)
        for api in (w.gnd, w.ins):
            repeat = api.get(path)
            assert repeat.status_code == 200
            assert repeat.headers["x-report-notice"] == "repeat"
            assert repeat.content == first.content
    assert first.content.startswith(b"%PDF")
    messages = mail.messages()
    assert len(matching(messages, w.ground.email, subject)) == 2
    assert matching(messages, w.instructor.email, subject) == []


def test_wf_records_reports_storage_outage(browser, mail):
    base = os.environ["APP_STORAGE_DOWN_URL"]
    w = worked(base)
    sid = w.session
    outage = {"error": "storage_unavailable", "message": "Reports cannot be saved right now. Try again shortly."}
    for kind in ("csv", "pdf"):
        r = w.gnd.get(f"/api/sessions/{sid}/report.{kind}")
        assert r.status_code == 503
        assert r.json() == outage
    with client(browser, base, w.ground, f"/sessions/{sid}/debrief") as page:
        click(role(page, "button", "Export CSV"))
        expect(role(page, "alert", "Export error")).to_have_text(outage["message"])
        expect(role(page, "status", "Export status")).not_to_contain_text("Report saved")
        expect(role(page, "button", "Export CSV")).to_be_enabled()
    assert S3().keys(f"reports/{sid}/") == []
    assert matching(mail.messages(), w.ground.email, "Report ready: Wake check") == []

    marker = f"Outage {uuid.uuid4().hex[:8]}"
    raw = WORKED_LAYOUT.replace('"Q7"', '"J1"').replace("Marram Flats", marker).encode()
    r = w.ins.client.post("/api/aerodromes/import", content=raw)
    assert r.status_code == 503
    assert r.json() == {"error": "storage_unavailable", "message": "Layouts cannot be saved right now. Try again shortly."}
    assert marker not in w.ins.get("/api/aerodromes").text
    with client(browser, base, w.instructor, "/aerodromes") as page:
        page.get_by_label("Layout file", exact=True).set_input_files(
            {"name": "plan.json", "mimeType": "application/json", "buffer": raw})
        click(role(page, "button", "Import layout"))
        expect(role(page, "alert", "Import error")).to_have_text("Layouts cannot be saved right now. Try again shortly.")

    health = httpx.get(base + "/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    live = World(base, [dep("GABCD")])
    assert send(live.gnd, live.session, "GABCD PUSH APPROVED").json()["readback"] == "Push approved, GABCD."
    assert tick(live, 1)["simTime"] == sim(1)


def test_wf_records_reports_phone_record(browser, app_url):
    w = World(app_url, [dep("GABCD")], with_session=False)
    key = w.add_scenario([dep("GABCD")], name=f"Phone run {w.tag}")
    sid = w.add_session(key, assignment=w.add_assignment(key, "2027-04-30"), end_at=5)
    with client(browser, app_url, w.ground, f"/records/{w.ids[w.ground.email]}", size=PHONE) as page:
        expect(role(page, "heading", f"Record: {w.ground.name}")).to_be_visible()
        page.reload()
        item = role(page, "list", "Assignment results").get_by_role("listitem").filter(has_text=f"Phone run {w.tag}").first
        attempts = 1
        expect(item).to_contain_text(f"Attempts: {attempts}")
        expect(item).to_contain_text("Best score: 100")
        expect(item).to_contain_text("Status: Passed")
        layout(page)
        link = role(page, "table", "Attempts").get_by_role("link", name="Open debrief")
        expect(link).to_have_count(1)
        link.focus()
        page.keyboard.press("Enter")
        expect(page).to_have_url(f"{app_url}/sessions/{sid}/debrief")
        expect(role(page, "status", "Score")).to_have_text("Score 100 of 100")


LAYOUT_MODES = ["desktop", "tablet", "phone"]


@pytest.mark.parametrize("mode", LAYOUT_MODES, ids=LAYOUT_MODES)
def test_wf_cross_cutting_layout_modes(browser, app_url, mode):
    w = World(app_url, [dep("GABCD"), arr("GDOWN")])
    size = SIZES[mode]
    with seated(browser, w, w.ground, size=size) as page:
        expect(Probe(page, f'[data-layout="{mode}"]')).to_have_count(1)
        layout(page)
        board, field = role(page, "region", "Ground board"), role(page, "region", "Airfield map")
        statuses = [role(page, "status", n) for n in ("Exercise state", "Sim clock", "Runway in use", "Wind")]
        if mode == "desktop":
            expect(role(page, "tablist", "Position")).to_have_count(0)
            alerts = role(page, "list", "Alerts")
            xs = [box_of(board)["x"], box_of(field)["x"], box_of(alerts)["x"]]
            assert len(set(xs)) == 3, f"board, map and alerts must sit side by side: {xs}"
        else:
            names = ["Board", "Map"] if mode == "tablet" else ["Board", "Map", "Alerts"]
            expect(role(page, "tablist", "Position").get_by_role("tab")).to_have_text(names)
            expect(board).to_be_visible()
            expect(field).not_to_be_visible()
            click(role(page, "tab", "Map"))
            expect(field).to_be_visible()
            expect(board).not_to_be_visible()
            if mode == "phone":
                click(role(page, "tab", "Alerts"))
                expect(no_alerts(page)).to_be_visible()
                expect(field).not_to_be_visible()
            else:
                alerts = no_alerts(page)
                expect(alerts).to_be_visible()
                assert box_of(alerts)["y"] > box_of(field)["y"]
            click(role(page, "tab", "Board"))
            for locator in (role(page, "tab", "Board"), command(page), role(page, "button", "Send"),
                            strip_in(page, "Pending", "GABCD")):
                assert touch_height(locator) >= TOUCH_MIN
        expect(command(page)).to_be_visible()
        for locator in statuses:
            expect(locator).to_be_visible()
        layout(page)
    with seated(browser, w, w.instructor, size=size) as page:
        expect(Probe(page, f'[data-layout="{mode}"]')).to_have_count(1)
        layout(page)
        if mode == "desktop":
            expect(role(page, "tablist", "Console")).to_have_count(0)
        else:
            expect(role(page, "tablist", "Console").get_by_role("tab")).to_have_text(["Clock", "Events", "Alerts", "Boards"])
            assert touch_height(role(page, "button", "Pause")) >= TOUCH_MIN


def test_wf_cross_cutting_keyboard_access(browser, app_url):
    w = World(app_url, [dep("GAAAA"), dep("GBBBB", stand="S2"), dep("GCCCC", stand="S3"), arr("GTWRA", due=900)],
              strips=[{"callsign": "GCCCC", "bay": "Pushback"}])

    def focused(page: Page) -> str | None:
        return page.evaluate("document.activeElement.getAttribute('data-strip')")

    def in_dialog(page: Page) -> bool:
        return page.evaluate("!!document.activeElement.closest('dialog,[role=dialog]')")

    def trapped(page: Page) -> None:
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert in_dialog(page), f"{key} left the open dialog"

    with seated(browser, w, w.ground) as page:
        names = tab_order(page, 3)
        assert names[0].endswith("cleared none") and names[1:] == ["Command", "Send"]
        order = bay(page, "Pending").get_by_role("listitem").evaluate_all(
            "els => els.map(e => e.getAttribute('data-strip'))")
        assert sorted(order) == ["GAAAA", "GBBBB"]
        first = strip_in(page, "Pending", order[0])
        rest, shown = state_styles(first, "outline-style", "outline-width", "box-shadow", "background-color", "color",
                                   "border-top-color", state="focus")
        assert rest != shown, "a focused strip must look different from a resting one"
        first.focus()
        page.keyboard.press("ArrowDown")
        assert focused(page) == order[1]
        page.keyboard.press("ArrowDown")
        assert focused(page) == order[1]
        page.keyboard.press("ArrowRight")
        assert focused(page) == PROBE_PUSH
        page.keyboard.press("ArrowRight")
        assert focused(page) == PROBE_PUSH
        page.keyboard.press("ArrowLeft")
        assert focused(page) == order[0]

        page.keyboard.press("Enter")
        dialog = role(page, "dialog", f"Edit {order[0]}")
        point = role(dialog, "textbox", "Holding point")
        expect(point).to_be_focused()
        trapped(page)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(first).to_be_focused()

        page.keyboard.press("Enter")
        fill(point, PROBE_POINT)
        click(role(dialog, "button", "Save strip"))
        expect(role(dialog, "alert", "Strip error")).to_have_text(f"Unknown holding point {PROBE_POINT}.")
        fill(point, "A1")
        fill(role(dialog, "textbox", "Remarks"), "Checked")
        click(role(dialog, "button", "Save strip"))
        expect(dialog).to_have_count(0)
        expect(first).to_be_focused()
        axe(page)
    with seated(browser, w, w.ground, size=PHONE) as page:
        names = tab_order(page, 4)
        assert names[0] == "Board" and names[2:] == ["Command", "Send"]
        role(page, "tab", "Board").focus()
        page.keyboard.press("ArrowRight")
        expect(role(page, "tab", "Map")).to_have_attribute("aria-selected", "true")
    with seated(browser, w, w.instructor) as page:
        names = tab_order(page, 2)
        assert names[0].split(",")[0] in ("GAAAA", "GBBBB") and names[1].startswith("GTWRA")
        axe(page)
    with seated(browser, w, w.instructor, size=PHONE) as page:
        assert tab_order(page, 1) == ["Clock"]
    with client(browser, app_url, w.instructor, f"/classes/{w.class_id}") as page:
        opener = role(page, "button", "Assign exercise")
        opener.focus()
        page.keyboard.press("Enter")
        expect(role(page, "dialog", "Assign exercise")).to_be_visible()
        trapped(page)
        page.keyboard.press("Escape")
        expect(role(page, "dialog", "Assign exercise")).to_have_count(0)
        expect(opener).to_be_focused()
    end(w)
    with client(browser, app_url, w.instructor, f"/sessions/{w.session}/debrief") as page:
        expect(role(page, "status", "Score")).to_be_visible()
        axe(page)


def test_motion_markers(browser, app_url):
    traffic = [dep("GMOVE", stand="S3"), dep("GOFFR", stand="S1"), dep("GLINE", stand="S2"), arr("GDOWN", due=60)]
    strips = [{"callsign": "GMOVE", "bay": "Taxi", "segment": "S3T", "progress": 10},
              {"callsign": "GOFFR", "bay": "Taxi", "segment": "A4", "progress": 10},
              {"callsign": "GLINE", "bay": "Holding", "node": "A1"}]
    w = World(app_url, traffic, strips=strips)
    sid = w.session
    with seated(browser, w, w.ground, paused=True) as gnd, seated(browser, w, w.tower, paused=True) as twr:
        send(w.gnd, sid, "GOFFR CONTACT TOWER")
        moved = strip_in(gnd, "Hand-off", "GOFFR")
        pumped(gnd, lambda: expect(moved).to_have_attribute("data-motion", "move", timeout=PUMP_CHECK_MS))
        advance(gnd, MOVE_PRESENT_MS)
        expect(moved).to_have_attribute("data-motion", "move")
        advance(gnd, MOVE_GONE_MS - MOVE_PRESENT_MS)
        expect(moved).not_to_have_attribute("data-motion", "move")

        pulse = strip_in(twr, "Incoming", "GOFFR")
        pumped(twr, lambda: expect(pulse).to_have_attribute("data-motion", "pulse", timeout=PUMP_CHECK_MS))
        advance(twr, PULSE_PRESENT_MS)
        expect(pulse).to_have_attribute("data-motion", "pulse")
        advance(twr, PULSE_GONE_MS - PULSE_PRESENT_MS)
        expect(pulse).not_to_have_attribute("data-motion", "pulse")

        send(w.twr, sid, "GLINE LINEUP 27")
        row = top_alert(twr)
        pumped(twr, lambda: expect(row).to_have_attribute("data-motion", "alert", timeout=PUMP_CHECK_MS))
        advance(twr, MOVE_PRESENT_MS)
        expect(row).to_have_attribute("data-motion", "alert")
        advance(twr, MOVE_GONE_MS - MOVE_PRESENT_MS)
        expect(row).not_to_have_attribute("data-motion", "alert")

        glider = symbol(gnd, "GMOVE")
        pumped(gnd, lambda: expect(glider).to_have_attribute("data-glide-ms", "1000", timeout=PUMP_CHECK_MS))
        for speed, value in ((2, "500"), (4, "250")):
            assert w.ins.post(f"/api/sessions/{sid}/speed", {"speed": speed}).status_code == 200
            pumped(gnd, lambda value=value: expect(glider).to_have_attribute("data-glide-ms", value, timeout=PUMP_CHECK_MS))
        start = center(glider)
        tick(w, 2)
        pumped(gnd, lambda: expect(position_row(gnd, "GMOVE")).to_have_attribute("data-progress", "20", timeout=PUMP_CHECK_MS))
        advance(gnd, 300)
        settle(glider)
        assert center(glider) != start, "the symbol must reach its new sim position"

    r = World(app_url, traffic, strips=strips)
    with seated(browser, r, r.ground, reduced=True) as gnd:
        send(r.gnd, r.session, "GOFFR CONTACT TOWER")
        moved = strip_in(gnd, "Hand-off", "GOFFR")
        expect(moved).to_be_visible()
        assert moved.get_attribute("data-motion") is None
        assert animations(moved) == []
        glider = symbol(gnd, "GMOVE")
        expect(glider).to_have_attribute("data-glide-ms", "0")
        start = center(glider)
        tick(r, 1)
        expect(position_row(gnd, "GMOVE")).to_have_attribute("data-progress", "15")
        assert animations(glider) == []
        assert center(glider) != start, "under reduced motion the symbol is drawn at its new place at once"
        expect(Probe(gnd, "[data-motion]")).to_have_count(0)

    s = World(app_url, traffic, strips=strips)
    with client(browser, app_url, s.ground, "/settings") as page:
        check_choice(role(page, "checkbox", "Reduce motion"))
        click(role(page, "button", "Save settings"))
        form_status(page, "Settings saved.")
    assert s.gnd.get("/api/me").json()["reduceMotion"] is True
    with seated(browser, s, s.ground) as gnd:
        expect(symbol(gnd, "GMOVE")).to_have_attribute("data-glide-ms", "0")
        send(s.gnd, s.session, "GOFFR CONTACT TOWER")
        moved = strip_in(gnd, "Hand-off", "GOFFR")
        expect(moved).to_be_visible()
        assert moved.get_attribute("data-motion") is None


def test_training_notice_every_page(browser, app_url):
    w = worked(app_url)
    running = w.add_session(strips=[])
    student = w.ids[w.ground.email]

    def noted(page: Page, paths: list[str]) -> None:
        for path in paths:
            page.goto(app_url + path)
            expect(page.get_by_role("contentinfo").first).to_contain_text(NOTICE)

    with client(browser, app_url, None, "/") as page:
        noted(page, ["/", "/signup", "/signin", "/verify"])
    with client(browser, app_url, w.instructor, "/") as page:
        noted(page, ["/", f"/classes/{w.class_id}", "/aerodromes", "/aerodromes/wrenfield", "/scenarios/new",
                     f"/scenarios/{w.scenario}", f"/sessions/{running}", f"/sessions/{w.session}/debrief",
                     f"/records/{student}", "/settings", "/classes/no-such-class"])
        expect(role(page, "heading", "Not found.")).to_be_visible()
    with client(browser, app_url, w.ground, "/") as page:
        noted(page, [f"/sessions/{running}", f"/records/{student}"])


def test_health_and_config():
    base = os.environ.get("APP_URL")
    assert os.environ["APP_STORAGE_DOWN_URL"]
    urls = [os.environ["APP_STORAGE_DOWN_URL"]] + ([base] if base else [])
    expected = {"pushSeconds": 30, "lineupSeconds": 20, "takeoffRollSeconds": 30, "landingRollSeconds": 40,
                "crossSeconds": 30, "handoffOfferSeconds": 60, "arrivalProtectSeconds": 120, "goAroundSeconds": 300,
                "readbackCorrectSeconds": 15, "readbackErrorEvery": 0, "simSeedOffset": 0, "slotToleranceSeconds": 300,
                "windChangeDelaySeconds": 120, "seatGraceSeconds": 5, "inviteTtlHours": 168, "verifyTtlHours": 24,
                "commandsPerMinute": 600, "layoutMaxBytes": 20000}
    for url in urls:
        health = httpx.get(url + "/api/health")
        assert health.status_code == 200 and health.json() == {"status": "ok"}
        config = httpx.get(url + "/api/config")
        assert config.status_code == 200
        body = config.json()
        assert body["today"] == "2027-04-12"
        assert body["timeZone"] == "Europe/London"
        assert body["simClock"] == "stepped"
        assert body["timers"] == expected
        assert GRADING_KEY not in config.text


def test_main_health_and_config_placeholder_guard(app_url):
    health = httpx.get(app_url + "/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    body = httpx.get(app_url + "/api/config").json()
    assert (body["today"], body["timeZone"], body["simClock"]) == ("2027-04-12", "Europe/London", "stepped")
    assert body["timers"]["layoutMaxBytes"] == LAYOUT_LIMIT
    assert body["timers"]["commandsPerMinute"] == COMMAND_LIMIT
    assert body["timers"]["seatGraceSeconds"] == 5


def test_grading_routes(browser, app_url):
    probe = {"users": []}
    for headers in ({}, {"X-Grading-Key": "wrong-key"}):
        assert httpx.post(app_url + "/api/grading/setup", json=probe, headers=headers).status_code == 404
    w = World(app_url, [dep("GABCD"), arr("GDOWN")])
    sid = w.session
    for path, body in ((f"/api/grading/sessions/{sid}/clock", {"advance": 1}),
                       (f"/api/grading/sessions/{sid}/hold-updates", {"position": "GND", "hold": True})):
        assert httpx.post(app_url + path, json=body).status_code == 404
        assert httpx.post(app_url + path, json=body, headers={"X-Grading-Key": "wrong-key"}).status_code == 404
    assert state(w)["simTime"] == "12:00:00"

    answer = tick(w, 2)
    assert answer == {"simTime": sim(2), "state": "running"}
    w.ins.post(f"/api/sessions/{sid}/pause")
    assert tick(w, 2) == {"simTime": sim(2), "state": "paused"}
    w.ins.post(f"/api/sessions/{sid}/resume")

    scripted = w.add_session(script=[{"at": 5, "position": "GND", "command": "GABCD PUSH APPROVED"}])
    st = state(w, scripted)
    assert (st["status"], st["simTime"]) == ("running", "12:00:05")
    assert plane(st, "GABCD")["status"] == "pushing"
    finished = w.add_session(script=[{"at": 1, "position": "GND", "command": "GABCD PUSH APPROVED"}], end_at=4)
    assert state(w, finished)["status"] == "ended"
    assert tick(w, 3, finished)["state"] == "ended"
    placed = w.add_session(sim_time="12:02:00", strips=[{"callsign": "GDOWN", "bay": "Arrivals", "dueSeconds": 47}])
    st = state(w, placed)
    assert st["simTime"] == sim(120)
    assert plane(st, "GDOWN")["status"] == "final"

    invite = grading(app_url, {"users": [], "invites": [
        {"class": w.class_key, "email": person("graded").email, "sentHoursAgo": 0, "status": "pending"}]})["invites"][0]
    assert "/invite/" in invite["url"]

    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.tower) as twr:
        hold(w, "GND", True)
        tick(w, 3)
        expect(sim_clock(twr)).to_have_text("12:00:05")
        expect(sim_clock(gnd)).to_have_text(sim(2))
        assert send(w.gnd, sid, "GABCD PUSH APPROVED").status_code == 200
        expect(strip_in(twr, "Pending", "GABCD")).to_have_count(0)
        hold(w, "GND", False)
        expect(sim_clock(gnd)).to_have_text("12:00:05")
        expect(strip_in(gnd, "Pushback", "GABCD")).to_be_visible()


@pytest.mark.parametrize("mode", LAYOUT_MODES, ids=LAYOUT_MODES)
def test_wf_cross_cutting_layout_boundaries(browser, app_url, mode):
    w = World(app_url, [dep("GABCD")])
    edges = {"desktop": (1024,), "tablet": (600, 1023), "phone": (599,)}
    with seated(browser, w, w.ground) as gnd, seated(browser, w, w.instructor) as ins:
        for page in (gnd, ins):
            for width in edges[mode]:
                page.set_viewport_size({"width": width, "height": 800})
                page.reload()
                expect(Probe(page, f'[data-layout="{mode}"]')).to_have_count(1)
                layout(page)


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == []


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert bad == []


def test_if_only_named_services():
    banned = {"redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "amqplib",
              "kafkajs", "bullmq", "memcached"}
    assert sorted(banned & {p.name for p in shipped_packages()}) == []
    assert Postgres().tables()


def test_if_pdf_inside_app():
    banned = {"puppeteer", "puppeteer-core", "playwright", "playwright-core", "chrome-aws-lambda", "phantomjs",
              "phantomjs-prebuilt", "wkhtmltopdf"}
    assert sorted(banned & {p.name for p in shipped_packages()}) == []


def test_if_no_external_hosts(browser, app_url):
    w = worked(app_url)
    running = w.add_session()
    with client(browser, app_url, w.ground, "/") as page:
        urls: list[str] = []
        page.on("request", lambda request: urls.append(request.url))
        for path in ("/", f"/sessions/{running}", f"/sessions/{w.session}/debrief"):
            page.goto(app_url + path)
            expect(page.get_by_role("contentinfo").first).to_contain_text(NOTICE)
    outside = [u for u in urls if u.startswith("http") and not same_origin(u, app_url)]
    assert outside == []


def test_if_no_service_worker(browser, app_url):
    w = World(app_url, [dep("GABCD")])
    with client(browser, app_url, w.ground, "/") as page:
        page.add_init_script(
            "window.__registered = 0; if (navigator.serviceWorker) {"
            " navigator.serviceWorker.register = () => { window.__registered += 1; return Promise.reject(new Error('blocked')); }; }")
        for path in ("/", f"/sessions/{w.session}"):
            page.goto(app_url + path)
            expect(page.get_by_role("contentinfo").first).to_contain_text(NOTICE)
            assert page.evaluate("window.__registered") == 0


def text_fonts(found: Locator) -> list[str]:
    return found.evaluate("""e => { const fonts = [], walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        while (walk.nextNode()) if (walk.currentNode.textContent.trim()) fonts.push(getComputedStyle(walk.currentNode.parentElement).fontFamily);
        return fonts; }""")


def touch_sized(mode: str, *controls: Locator) -> None:
    for found in controls:
        expect(found).to_be_visible()
        assert mode == "desktop" or touch_height(found) >= TOUCH_MIN, mode


def overrun_world(base: str) -> World:
    return World(base, [dep("GOVER", stand="S3", overruns=True), dep("GNEXT", stand="S4")],
                 strips=[{"callsign": "GOVER", "bay": "Taxi", "segment": "A2", "progress": 290},
                         {"callsign": "GNEXT", "bay": "Holding", "node": "A1"}])


INCURSION = "Runway incursion at A1 by GOVER."


def test_wf_handoff_touch_drag_accept(browser, app_url):
    w = World(app_url, [dep("GABCD")], strips=[{"callsign": "GABCD", "bay": "Hand-off", "segment": "A4", "progress": 10}])
    with seated(browser, w, w.tower, size=PHONE) as twr:
        touch_drag(twr, strip_in(twr, "Incoming", "GABCD"), bay(twr, "Holding"))
        expect(strip_in(twr, "Holding", "GABCD")).to_have_attribute("data-frequency", "TWR")


def test_wf_wake_spacing_ticks_stay_quiet(browser, app_url):
    w = World(app_url, wake_traffic(), sim_time="12:05:00",
              strips=[{"callsign": "GBULK", "bay": "Departed", "takeoffStart": "12:03:48"},
                      {"callsign": "GLITE", "bay": "Line up"}])
    speaks = """e => { for (let n = e; n; n = n.parentElement) {
        const live = n.getAttribute('aria-live'), kind = n.getAttribute('role');
        if (live === 'off') return false;
        if (live === 'polite' || live === 'assertive' || n.tagName === 'OUTPUT' || ['status', 'alert', 'log'].includes(kind)) return true;
    } return false; }"""
    with seated(browser, w, w.tower) as twr:
        assert sim_clock(twr).evaluate(speaks) is False, "the sim clock must not be announced on each tick"
        assert timer(strip_in(twr, "Line up", "GLITE"), "wake").evaluate(speaks) is False


def test_wf_readback_log_uses_mono(browser, app_url):
    w = World(app_url, [dep("GABCD", stand="S3"), dep("GQRST", stand="S1", hp="A6")], name="Readback drill", seed=2, every=1,
              script=[{"at": 0, "position": "GND", "command": "GABCD PUSH APPROVED"},
                      {"at": 0, "position": "GND", "command": "GQRST PUSH APPROVED"},
                      {"at": 30, "position": "GND", "command": "GABCD TAXI HP A1 VIA A"},
                      {"at": 30, "position": "GND", "command": "GQRST TAXI HP A6"},
                      {"at": 31, "position": "GND", "command": "GABCD NEGATIVE HP A1"}], end_at=60)
    with client(browser, app_url, w.ground, f"/sessions/{w.session}/debrief") as page:
        expect(role(page, "status", "Score")).to_have_text("Score 90 of 100")
        table = role(page, "table", "Timeline")
        expect(table.get_by_role("cell", name="Correct, holding point A1, GABCD.", exact=True)).to_be_visible()
        alert = table.get_by_role("cell", name="Readback error not corrected: GQRST.", exact=True)
        assert not any("Spline Sans Mono" in font for font in text_fonts(alert))
        line = table.get_by_role("cell", name="GABCD TAXI HP A1 VIA A", exact=True)
        assert any("Spline Sans Mono" in font for font in text_fonts(line))


def test_wf_debrief_replay_phone_touch_exports(browser, app_url):
    w = worked(app_url)
    for size in (PHONE, TABLET):
        with client(browser, app_url, w.tower, f"/sessions/{w.session}/debrief", size=size) as page:
            expect(role(page, "status", "Score")).to_have_text("Score 80 of 100")
            rows = role(page, "table", "Score breakdown").get_by_role("row")
            expect(rows.filter(has_text="Late handoff: GLITE reached A1 on Ground.")).to_have_count(1)
            expect(role(page, "table", "Timeline")).to_be_visible()
            for name in ("Export CSV", "Export PDF"):
                assert touch_height(role(page, "button", name)) >= TOUCH_MIN, (name, size)


def test_wf_records_reports_phone_tap_export(browser, app_url):
    w = worked(app_url)
    with client(browser, app_url, w.ground, f"/sessions/{w.session}/debrief", size=PHONE) as page:
        button = role(page, "button", "Export CSV")
        assert touch_height(button) >= TOUCH_MIN
        with page.expect_download() as info:
            tap(button)
        assert info.value.suggested_filename == "report.csv"


@pytest.mark.parametrize("mode", LAYOUT_MODES, ids=LAYOUT_MODES)
def test_wf_cross_cutting_touch_forms(browser, app_url, mode):
    w = World(app_url, [dep("GABCD")])
    with client(browser, app_url, None, "/signup", size=SIZES[mode]) as page:
        layout(page)
        touch_sized(mode, role(page, "textbox", "Name"), role(page, "textbox", "Email"),
                    page.get_by_label("Password", exact=True), role(page, "button", "Create account"))
    with client(browser, app_url, w.ground, "/settings", size=SIZES[mode]) as page:
        layout(page)
        touch_sized(mode, role(page, "textbox", "Name"), role(page, "checkbox", "Reduce motion"),
                    role(page, "button", "Save settings"))


def test_wf_command_line_phone_dialog_touch(browser, app_url):
    w = World(app_url, [dep("GABCD")])
    with seated(browser, w, w.ground, size=PHONE) as gnd:
        strip_in(gnd, "Pending", "GABCD").focus()
        gnd.keyboard.press("Enter")
        dialog = role(gnd, "dialog", "Edit GABCD")
        remarks = role(dialog, "textbox", "Remarks")
        fill(remarks, "half a remark")
        remarks.focus()
        tick(w, 1)
        expect(sim_clock(gnd)).to_have_text(sim(1))
        expect(remarks).to_have_value("half a remark")
        expect(remarks).to_be_focused()
        for found in (role(dialog, "textbox", "Holding point"), remarks, role(dialog, "button", "Save strip")):
            assert touch_height(found) >= TOUCH_MIN


def test_wf_incursion_touch_drag_after(browser, app_url):
    w = overrun_world(app_url)
    with seated(browser, w, w.tower, size=PHONE) as twr:
        tick(w, 1)
        expect(role(twr, "alert", "Urgent alerts")).to_have_text(INCURSION)
        touch_drag(twr, strip_in(twr, "Holding", "GNEXT"), bay(twr, "Line up"))
        expect(command(twr)).to_have_value(lineup_line("GNEXT", "27"))


def test_wf_command_line_push_keeps_focus_put(browser, app_url):
    w = World(app_url, [dep("GABCD"), dep("GZZZZ", stand="S2")])
    with seated(browser, w, w.ground) as gnd:
        strip = strip_in(gnd, "Pending", "GABCD")
        strip.focus()
        expect(strip).to_be_focused()
        gnd.evaluate("document.activeElement.blur()")
        for second in (1, 2):
            tick(w, 1)
            expect(sim_clock(gnd)).to_have_text(sim(second))
            assert gnd.evaluate("document.activeElement === document.body"), "a pushed update moved focus"


def test_wf_command_line_tab_on_complete_word(browser, app_url):
    w = World(app_url, [dep("GABCD"), dep("GZZZZ", stand="S2")])
    with seated(browser, w, w.ground) as gnd:
        box = command(gnd)
        box.focus()
        gnd.keyboard.type("GABCD")
        gnd.keyboard.press("Tab")
        expect(box).not_to_be_focused()
        expect(box).to_have_value("GABCD")


def test_wf_command_line_send_button_keeps_line_focus(browser, app_url):
    w = World(app_url, [dep("GABCD"), dep("GZZZZ", stand="S2")])
    with seated(browser, w, w.ground) as gnd:
        box = command(gnd)
        fill(box, "GABCD PUSH APPROVED")
        click(role(gnd, "button", "Send"))
        expect(role(gnd, "status", "Readback")).to_have_text("Push approved, GABCD.")
        expect(box).to_have_value("")
        expect(box).to_be_focused()


def test_wf_incursion_flash_not_replayed_on_tab(browser, app_url):
    w = overrun_world(app_url)
    with seated(browser, w, w.tower, size=PHONE, paused=True) as twr:
        tick(w, 1)
        board = role(twr, "region", "Tower board")
        pumped(twr, lambda: expect(board).to_have_attribute("data-motion", "flash", timeout=PUMP_CHECK_MS))
        advance(twr, FLASH_GONE_MS)
        expect(board).not_to_have_attribute("data-motion", "flash")
        tap(role(twr, "tab", "Map"))
        pumped(twr, lambda: expect(role(twr, "region", "Airfield map")).to_be_visible(timeout=PUMP_CHECK_MS))
        tap(role(twr, "tab", "Board"))
        pumped(twr, lambda: expect(board).to_be_visible(timeout=PUMP_CHECK_MS))
        assert board.get_attribute("data-motion") != "flash", "the flash replayed with no new incursion"


def left_alone(page: Page) -> None:
    page.evaluate("document.activeElement && document.activeElement.blur()")
    assert page.evaluate("document.activeElement === document.body")


def focus_unmoved(page: Page) -> None:
    assert page.evaluate("document.activeElement === document.body"), "a pushed update moved focus"


def test_wf_wake_spacing_ticks_keep_focus_put(browser, app_url):
    w = World(app_url, wake_traffic(), sim_time="12:05:00",
              strips=[{"callsign": "GBULK", "bay": "Departed", "takeoffStart": "12:03:48"},
                      {"callsign": "GLITE", "bay": "Line up"}])
    with seated(browser, w, w.tower) as twr:
        strip = strip_in(twr, "Line up", "GLITE")
        strip.focus()
        before = timer(strip, "wake").inner_text()
        left_alone(twr)
        tick(w, 1)
        expect(timer(strip_in(twr, "Line up", "GLITE"), "wake")).not_to_have_text(before)
        focus_unmoved(twr)


def test_wf_handoff_offer_keeps_tower_focus_put(browser, app_url):
    w = World(app_url, [dep("GABCD"), dep("GHOLD", stand="S2")],
              strips=[{"callsign": "GABCD", "bay": "Taxi", "segment": "A4", "progress": 50},
                      {"callsign": "GHOLD", "bay": "Holding", "node": "A1"}])
    with seated(browser, w, w.tower) as twr:
        strip_in(twr, "Holding", "GHOLD").focus()
        left_alone(twr)
        send(w.gnd, w.session, "GABCD CONTACT TOWER")
        expect(strip_in(twr, "Incoming", "GABCD")).to_have_attribute("data-state", "offered")
        focus_unmoved(twr)


def test_wf_arrival_go_around_alert_slides_once(browser, app_url):
    w = World(app_url, [dep("GQRST", stand="S3"), arr("GDOWN", due=900)],
              strips=[{"callsign": "GQRST", "bay": "Holding", "node": "A1"}, {"callsign": "GDOWN", "bay": "Arrivals", "dueSeconds": 47}])
    message = "Arrival GDOWN due in 0:47; departure not allowed."
    with seated(browser, w, w.tower, size=PHONE, paused=True) as twr:
        send(w.twr, w.session, "GQRST LINEUP 27")
        pumped(twr, lambda: expect(role(twr, "status", "Alert announcements")).to_have_text(message, timeout=PUMP_CHECK_MS))
        tap(role(twr, "tab", "Alerts"))
        pumped(twr, lambda: expect(top_alert(twr)).to_have_text(f"12:00:00 R3 {message}", timeout=PUMP_CHECK_MS))
        advance(twr, MOVE_GONE_MS)
        expect(top_alert(twr)).not_to_have_attribute("data-motion", "alert")
        tap(role(twr, "tab", "Board"))
        pumped(twr, lambda: expect(role(twr, "region", "Tower board")).to_be_visible(timeout=PUMP_CHECK_MS))
        tap(role(twr, "tab", "Alerts"))
        pumped(twr, lambda: expect(top_alert(twr)).to_be_visible(timeout=PUMP_CHECK_MS))
        assert top_alert(twr).get_attribute("data-motion") != "alert", "an old alert row slid in again"


def test_wf_ground_flow_live_move_keeps_focus_put(browser, app_url):
    w = World(app_url, [dep("GABCD"), dep("GZZZZ", stand="S2")])
    with seated(browser, w, w.ground) as gnd:
        strip_in(gnd, "Pending", "GZZZZ").focus()
        left_alone(gnd)
        send(w.gnd, w.session, "GABCD PUSH APPROVED")
        expect(strip_in(gnd, "Pushback", "GABCD")).to_be_visible()
        focus_unmoved(gnd)


def test_wf_instructor_events_phone_boards_no_stale_flash(browser, app_url):
    w = overrun_world(app_url)
    with seated(browser, w, w.instructor, size=PHONE, paused=True) as ins:
        tick(w, 1)
        pumped(ins, lambda: expect(role(ins, "alert", "Urgent alerts")).to_have_text(INCURSION, timeout=PUMP_CHECK_MS))
        advance(ins, FLASH_GONE_MS)
        tap(role(ins, "tab", "Boards"))
        ground = role(ins, "region", "Ground board")
        pumped(ins, lambda: expect(ground).to_be_visible(timeout=PUMP_CHECK_MS))
        for name in ("Ground board", "Tower board"):
            assert role(ins, "region", name).get_attribute("data-motion") != "flash", f"{name} flashed with no new incursion"


def test_wf_readback_push_keeps_focus_put(browser, app_url):
    w = World(app_url, [dep("GABCD", stand="S3"), dep("GZZZZ", stand="S2")], seed=2, every=1,
              strips=[{"callsign": "GABCD", "bay": "Pushback"}])
    send(w.gnd, w.session, "GABCD TAXI HP A1 VIA A")
    with seated(browser, w, w.ground) as gnd:
        strip_in(gnd, "Taxi", "GABCD").focus()
        left_alone(gnd)
        tick(w, 15)
        message = "Readback error not corrected: GABCD."
        expect(top_alert(gnd)).to_have_text(f"{sim(15)} R7 {message}")
        focus_unmoved(gnd)


def test_wf_route_preview_accepted_route_keeps_focus_put(browser, app_url):
    w = World(app_url, [dep("GQRST", stand="S3"), dep("GZZZZ", stand="S2")], strips=[{"callsign": "GQRST", "bay": "Pushback"}])
    with seated(browser, w, w.ground) as gnd:
        strip_in(gnd, "Pushback", "GQRST").focus()
        left_alone(gnd)
        send(w.gnd, w.session, "GQRST TAXI HP A1 VIA A")
        expect(strip_in(gnd, "Taxi", "GQRST")).to_be_visible()
        focus_unmoved(gnd)


def test_wf_class_setup_assign_dialog_form_status(browser, app_url):
    w = World(app_url, [dep("GABCD")], with_session=False)
    with client(browser, app_url, w.instructor, f"/classes/{w.class_id}") as page:
        click(role(page, "button", "Assign exercise"))
        dialog = role(page, "dialog", "Assign exercise")
        select(role(dialog, "combobox", "Scenario"), w.scenario_name)
        fill(role(dialog, "textbox", "Due on"), "2027-04-20")
        with held(page, "**/api/classes/*/assignments") as gate:
            click(role(dialog, "button", "Save assignment"))
            expect(role(dialog, "status", "Form status")).to_have_text("Saving...")
            release(gate)
        expect(role(page, "table", "Assignments")).to_contain_text(w.scenario_name)
