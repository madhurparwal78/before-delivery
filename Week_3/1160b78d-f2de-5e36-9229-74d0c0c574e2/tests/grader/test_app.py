from __future__ import annotations

import contextlib
import csv
import hashlib
import hmac
import io
import json
import os
import re
import shlex
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, unquote, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    addresses,
    held,
    layout,
    licence_allowed,
    project_dirs,
    same_origin,
    select,
    shipped_packages,
    text,
)

PASSWORD = "yard-lamp-2026"
ROWAN, SUNNIVA, DARIO = "rowan@tarecross.example", "sunniva@tarecross.example", "dario@tarecross.example"
INES, TOMASZ, PRIYA = "ines@tarecross.example", "tomasz@tarecross.example", "priya@tarecross.example"
MATEUS, HANA = "mateus@tarecross.example", "hana@tarecross.example"
INSTANCE = "main"
EVENTS_QUEUE = f"switchlamp.{INSTANCE}.events"
DEAD_QUEUE = f"switchlamp.{INSTANCE}.events.dead"

HTTP_SECONDS = 30
PAGE_MS = 15000
LIVE_MS = 2000
STATUS_POLL_MS = 8000
POLL_SECONDS = 30
PEEK_COUNT = 500
RATE_LIMIT = 120
RATE_WINDOW = 60
RATE_TTL_SECONDS = 86400
LATE_EVENT_SECONDS = 60
LATE_EVENT_MARGIN = 40
INTAKE_LIMIT = 512000
BODY_LIMIT = 1000000
MAIL_RETRY_MARGIN = 15
CACHE_RESUME_MARGIN = 12
OUTAGE_PORT = 9
PLATE_MIN_MS = 500
PLATE_MAX_MS = 1500
CUT_MOTION_MAX_MS = 400
TARGET_PX = 44
DAY_23H, DAY_NORMAL, DAY_25H = 1380, 1440, 1500
YEAR_SECONDS = 31536000
THIRTY_MINUTES = 1800
CACHE_TTL_MAX = 300
UPDATE_BODY = "Carrier feeds run late."
GONE_BODY = "receiver says no such hook"
DRILL_KEY = "drill-key"
WRONG_DEVICE_TIME = datetime(2031, 1, 1, 3, 0, tzinfo=timezone.utc)
LIVE_SPY = """
(() => {
  const Native = window.WebSocket;
  window.__earlySends = 0;
  window.__sent = [];
  const send = Native.prototype.send;
  Native.prototype.send = function (d) {
    if (this.readyState !== 1) window.__earlySends += 1;
    window.__sent.push(String(d));
    return send.call(this, d);
  };
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      const socket = new target(...args);
      window.__live = socket;
      socket.addEventListener('close', (e) => {
        const codes = JSON.parse(sessionStorage.getItem('__closeCodes') || '[]');
        codes.push(e.code);
        sessionStorage.setItem('__closeCodes', JSON.stringify(codes));
      });
      return socket;
    },
  });
})();
"""
OPACITY_SPY = """
(() => {
  window.__fade = [];
  const last = new Map();
  const tick = (now) => {
    let changed = false;
    for (const el of document.querySelectorAll('[data-plate], [data-plate] img, [data-plate] picture, [data-plate] canvas')) {
      const o = getComputedStyle(el).opacity;
      if (last.has(el) && last.get(el) !== o) changed = true;
      last.set(el, o);
    }
    if (changed) window.__fade.push(now);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
"""
_pause = threading.Event().wait


def cut_tab(hhmm: str, minutes: int) -> str:
    hours, rest = divmod(minutes, 60)
    length = f"{hours} h {rest} min" if hours else f"{rest} min"
    return f"Ends {hhmm}, {length}"


def lost(person: str, minutes: int) -> str:
    return f"{person} loses {minutes} minutes"


def counted(count: int) -> str:
    return f"{count} / {RATE_LIMIT}"


def seconds_label(seconds: int) -> str:
    return f"{seconds} s"


def mmss(seconds: int) -> str:
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def hms(seconds: int) -> str:
    return f"{seconds // 3600}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


CLEAN_CUT = "; ".join(["no gap", "no overlap"]) + "."


class Api:

    def __init__(self, base: str, email: str | None = None, bearer: str | None = None):
        headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_SECONDS, headers=headers)
        if email:
            must(self.post("/api/session", {"email": email, "password": PASSWORD}))

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.get(path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.http.post(path, json={} if body is None else body, **kw)

    def put(self, path: str, body: Any, version: Any = None) -> httpx.Response:
        headers = {} if version is None else {"If-Match": f'"{version}"'}
        return self.http.put(path, json=body, headers=headers)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)


def must(response: httpx.Response, status: int = 200) -> Any:
    assert response.status_code == status, (
        f"{response.request.method} {response.request.url}: expected {status}, "
        f"got {response.status_code}: {response.text[:400]}"
    )
    return response.json() if response.content else None


def wait_for(probe: Callable[[], Any], contract: str, seconds: float = POLL_SECONDS) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = probe()
        if found:
            return found
        _pause(0.1)
    pytest.fail(f"timed out after {seconds} s; expected {contract}")


def together(*calls: Callable[[], Any]) -> list[Any]:
    gate = threading.Barrier(len(calls))

    def run(call: Callable[[], Any]) -> Any:
        gate.wait(timeout=10)
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return [f.result() for f in [pool.submit(run, c) for c in calls]]


def at(instant: str) -> datetime:
    return datetime.strptime(instant, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def tag(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4().hex[:8]}"


def copy_url(variable: str) -> str:
    url = os.environ.get(variable)
    if not url:
        pytest.fail(f"{variable} must name the outage instance from the spec")
    return url.rstrip("/")


class Clock:
    def __init__(self, api: Api):
        self.api = api

    def now(self) -> datetime:
        return at(must(self.api.get("/api/clock"))["now"])

    def freeze(self) -> datetime:
        return at(must(self.api.post("/api/operator/clock", {"frozen": True}))["now"])

    def thaw(self) -> None:
        must(self.api.post("/api/operator/clock", {"frozen": False}))

    def advance(self, seconds: int) -> datetime:
        return at(must(self.api.post("/api/operator/clock", {"advance_seconds": seconds}))["now"])

    def to(self, moment: datetime) -> datetime:
        return at(must(self.api.post("/api/operator/clock", {"set_to": iso(moment)}))["now"])


def after_second(api: Api, stamp: str) -> None:
    wait_for(lambda: Clock(api).now() > at(stamp), f"the server clock past {stamp}", 5)


@contextlib.contextmanager
def frozen(api: Api) -> Iterator[Clock]:
    clock_ = Clock(api)
    clock_.freeze()
    try:
        yield clock_
    finally:
        clock_.thaw()


@pytest.fixture
def admin(app_url: str) -> Api:
    return Api(app_url, ROWAN)


@pytest.fixture
def lead(app_url: str) -> Api:
    return Api(app_url, SUNNIVA)


@pytest.fixture
def clock(admin: Api) -> Iterator[Clock]:
    with frozen(admin) as held_clock:
        yield held_clock


def roster(api: Api) -> dict[str, str]:
    return {u["name"]: u["id"] for u in must(api.get("/api/users"))["items"]}


def target(people: dict[str, str], item: Any) -> dict[str, str]:
    if isinstance(item, dict):
        return {"type": "schedule", "id": item["id"]}
    return {"type": "person", "id": people[item]}


def make_policy(api: Api, levels: list[tuple[int, list[Any]]], repeats: int = 0) -> dict:
    people = roster(api)
    body = {
        "name": tag("Probe policy"),
        "repeats": repeats,
        "levels": [{"timeout_minutes": t, "targets": [target(people, x) for x in ts]} for t, ts in levels],
    }
    return must(api.post("/api/policies", body), 201)


def service_body(policy_id: str, **kw: Any) -> dict:
    return {
        "name": kw.get("name") or tag("Probe service"),
        "team": "Probe crew",
        "policy_id": policy_id,
        "depends_on": list(kw.get("depends", [])),
        "grouping_mode": kw.get("grouping", "none"),
        "grouping_minutes": kw.get("minutes"),
        "ack_timeout_minutes": kw.get("ack"),
        "auto_resolve_minutes": kw.get("auto"),
    }


def make_service(api: Api, policy_id: str, **kw: Any) -> dict:
    return must(api.post("/api/services", service_body(policy_id, **kw)), 201)


def make_desk(api: Api, *holders: Any, timeout: int = 30, repeats: int = 0, **kw: Any) -> SimpleNamespace:
    policy = make_policy(api, [(timeout, [h]) for h in holders], repeats)
    service = make_service(api, policy["id"], **kw)
    integration = must(api.post("/api/integrations", {"service_id": service["id"], "name": tag("Probe monitor")}), 201)
    return SimpleNamespace(
        policy=policy, service=service, sid=service["id"], integration=integration,
        iid=integration["id"], rk=integration["routing_key"], name=service["name"],
    )


def drill(api: Api, sid: str, severity: str = "critical", key: str | None = None, summary: str | None = None) -> dict:
    body = {"service_id": sid, "summary": summary or tag("Probe alert"), "severity": severity}
    if key:
        body["dedup_key"] = key
    return must(api.post("/api/operator/drill", body), 201)


def incident(api: Api, iid: str) -> dict:
    return must(api.get(f"/api/incidents/{iid}"))


def act(api: Api, iid: str, action: str, body: Any = None) -> httpx.Response:
    return api.post(f"/api/incidents/{iid}/{action}", body)


def entries(inc: dict, kind: str) -> list[dict]:
    return [e for e in inc["timeline"] if e["kind"] == kind]


def listed(api: Api, sid: str, status: str = "all") -> list[dict]:
    return must(api.get("/api/incidents", params={"status": status, "service_id": sid, "limit": 100}))["items"]


def event_body(rk: str, action: str = "trigger", key: str | None = None, severity: str = "critical",
               summary: str | None = None) -> dict:
    body: dict[str, Any] = {"routing_key": rk, "event_action": action}
    if key:
        body["dedup_key"] = key
    if action == "trigger":
        body["payload"] = {"summary": summary or tag("Probe event"), "source": "probe-1", "severity": severity}
    return body


def send(base: str, rk: str, action: str = "trigger", key: str | None = None, severity: str = "critical",
         summary: str | None = None) -> dict:
    response = httpx.post(f"{base}/api/events", json=event_body(rk, action, key, severity, summary),
                          timeout=HTTP_SECONDS)
    return must(response, 202)


def log_rows(api: Api, iid: str) -> list[dict]:
    rows: list[dict] = []
    cursor = None
    for _ in range(20):
        params = {"limit": 100} | ({"after": cursor} if cursor else {})
        page_ = must(api.get(f"/api/integrations/{iid}/events", params=params))
        rows += page_["items"]
        cursor = page_["next_cursor"]
        if not cursor:
            break
    return rows


def wait_log(api: Api, iid: str, reason: str | None, outcome: str, key: str | None = None) -> dict:
    def probe() -> dict | None:
        for row in log_rows(api, iid):
            if row["outcome"] == outcome and (reason is None or row["reason"] == reason) and (
                key is None or row["dedup_key"] == key
            ):
                return row
        return None

    return wait_for(probe, f"event log row {outcome!r} with reason {reason!r}")


def wait_incident(api: Api, sid: str, count: int = 1) -> list[dict]:
    return wait_for(lambda: (r := listed(api, sid)) and len(r) >= count and r,
                    f"{count} incidents on the service after the worker applied the event")


def subject_mail(mail: Any, subject: str, expected: int = 1, seconds: float = POLL_SECONDS) -> list[dict]:
    def probe() -> list[dict] | None:
        found = [m for m in mail.messages(settle=0) if m["Subject"] == subject]
        return found if len(found) >= expected else None

    wait_for(probe, f"{expected} mail with subject {subject!r}", seconds)
    return [m for m in mail.messages(settle=1.5) if m["Subject"] == subject]


def no_mail(mail: Any, subject: str) -> None:
    assert not [m for m in mail.messages(settle=1.5) if m["Subject"] == subject], f"unexpected mail {subject!r}"


def step_subject(inc: dict) -> str:
    return f"[Switchlamp] Incident #{inc['number']} needs you: {inc['title']}"


def ack_token(message: dict) -> str:
    found = re.search(r"^Acknowledge: \S*/ack/(\S+)\s*$", text(message), re.M)
    assert found, "mail body must hold the line Acknowledge: <APP_PUBLIC_URL>/ack/<token>"
    return found.group(1)


@contextlib.contextmanager
def settings(base: str, email: str, **change: Any) -> Iterator[Api]:
    person = Api(base, email)
    before = must(person.get("/api/me"))
    must(person.patch("/api/me", change))
    try:
        yield person
    finally:
        must(person.patch("/api/me", {k: before[k] for k in change}))


def wire_request(entry: dict) -> dict:
    return entry.get("request", entry)


def wire_header(entry: dict, name: str) -> str | None:
    for key, value in wire_request(entry).get("headers", {}).items():
        if key.lower() == name.lower():
            if isinstance(value, dict):
                value = value.get("values", [None])
            return value[0] if isinstance(value, list) else value
    return None


def wire_body(entry: dict) -> str:
    return wire_request(entry).get("body", "")


def make_endpoint(api: Api, path: str | None = None, types: list[str] | None = None,
                  services: list[str] | None = None) -> dict:
    body = {
        "name": tag("Probe endpoint"),
        "path": path or f"/hooks/{uuid.uuid4().hex}",
        "event_types": types if types is not None else ["incident.triggered"],
        "service_ids": services or [],
    }
    return must(api.post("/api/webhooks", body), 201)


def deliveries(api: Api, webhook_id: str) -> list[dict]:
    return must(api.get(f"/api/webhooks/{webhook_id}/deliveries", params={"limit": 100}))["items"]


ENDPOINT_SECTION = """(tables, [name, parts]) => {
  // An endpoint's section: the widest ancestor of its Deliveries table that holds no other Deliveries table, and the
  // siblings after it up to the next endpoint's table. Its title is that ancestor's own text (a wrapper or the table's
  // caption), else the nearest heading just before it (a flat layout), never an earlier list of every endpoint.
  const others = (node) => tables.some((t) => node === t || node.contains(t));
  const said = (n) => n.textContent + [...n.querySelectorAll('input')].map((i) => ' ' + i.value).join('');
  const heading = (n) => /^H[1-6]$/.test(n.tagName) || n.getAttribute('role') === 'heading' || !!n.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
  const sections = tables.map((table) => {
    let top = table;
    while (top.parentElement && tables.filter((t) => top.parentElement.contains(t)).length === 1) top = top.parentElement;
    const after = [];
    for (let n = top.nextElementSibling; n && !others(n); n = n.nextElementSibling) after.push(n);
    let title = said(top);
    if (!title.includes(name)) {
      for (let n = top.previousElementSibling; n && !others(n); n = n.previousElementSibling) {
        if (heading(n)) { title += ' ' + said(n); break; }
      }
    }
    return {text: title, nodes: [top, ...after]};
  });
  // One Deliveries table on the page: it is the endpoint's, and the whole page is its section.
  if (tables.length === 1) sections[0].nodes = [document.documentElement];
  const own = tables.length === 1 ? [0] : sections.flatMap((s, i) => (s.text.includes(name) ? [i] : []));
  if (own.length !== 1) return null;
  const inside = (el) => sections[own[0]].nodes.some((n) => n === el || n.contains(el));
  return {table: own[0], parts: Object.fromEntries(Object.entries(parts).map(([k, els]) => [k, els.flatMap((el, i) => (inside(el) ? [i] : []))]))};
}"""


def endpoint_section(page: Page, endpoint: dict, **parts: Locator) -> tuple[Locator, dict[str, list[Locator]]]:
    tables = named(page, "table", "Deliveries")

    def look() -> dict | None:
        return tables.evaluate_all(ENDPOINT_SECTION, [endpoint["name"], {k: v.element_handles() for k, v in parts.items()}])

    found = wait_for(look, f"one Deliveries table in the section of {endpoint['name']!r}", PAGE_MS / 1000)
    return tables.nth(found["table"]), {k: [parts[k].nth(i) for i in found["parts"][k]] for k in parts}


def section_row(page: Page, endpoint: dict, part: Locator, *texts: str) -> None:
    def look() -> bool:
        return any(all(t in r for t in texts) for el in endpoint_section(page, endpoint, part=part)[1]["part"]
                   for r in el.get_by_role("row").all_inner_texts())
    wait_for(look, f"a row with {texts!r} in the section of {endpoint['name']!r}", PAGE_MS / 1000)


OWN_ROWS = """(table, word) => [...table.querySelectorAll('tr, [role="row"]')].filter((row) =>
  row.closest('table, [role="table"]') === table && [...row.children].some((cell) =>
    !cell.querySelector('table, [role="table"]') && cell.textContent.includes(word))).length"""


def delivery_row(table: Locator, status: str) -> None:
    wait_for(lambda: table.evaluate(OWN_ROWS, status) >= 1, f"the delivery row showing {status!r}", PAGE_MS / 1000)


def second_sunday_march(year: int) -> date:
    first = date(year, 3, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 7)


def first_sunday_november(year: int) -> date:
    first = date(year, 11, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7)


def chicago_is_daylight(day: date, hour: int = 12) -> bool:
    spring, fall = second_sunday_march(day.year), first_sunday_november(day.year)
    if day == spring:
        return hour >= 2
    if day == fall:
        return hour < 2
    return spring < day < fall


def chicago(day: date, hhmm: str) -> datetime:
    hour, minute = map(int, hhmm.split(":"))
    offset = 5 if chicago_is_daylight(day, hour) else 6
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc) + timedelta(hours=offset)


def chicago_abbr(day: date, hhmm: str = "12:00") -> str:
    return "CDT" if chicago_is_daylight(day, int(hhmm[:2])) else "CST"


def chicago_label(day: date, hhmm: str) -> str:
    return f"{day.isoformat()} {hhmm} {chicago_abbr(day, hhmm)}"


def chicago_date(moment: datetime) -> date:
    guess = (moment - timedelta(hours=6)).date()
    for day in (guess + timedelta(days=1), guess):
        if chicago(day, "00:00") <= moment:
            return day
    return guess


def next_change(now: datetime, spring: bool) -> date:
    finder = second_sunday_march if spring else first_sunday_november
    day = finder(now.year)
    return day if day > now.date() + timedelta(days=2) else finder(now.year + 1)


def plain_day(now: datetime, ahead: int = 20) -> date:
    day = now.date() + timedelta(days=ahead)
    for _ in range(20):
        changes = {second_sunday_march(day.year), first_sunday_november(day.year)}
        if not changes & {day - timedelta(days=1), day, day + timedelta(days=1)}:
            return day
        day += timedelta(days=3)
    pytest.fail("no plain day found")


def make_schedule(api: Api, zone: str, people: list[str], handoff: str = "08:00", days: int = 1,
                  start: str = "2026-01-05", restrictions: list | None = None) -> dict:
    ids = roster(api)
    schedule = must(api.post("/api/schedules", {"name": tag("Probe schedule"), "zone": zone}), 201)
    sent = {"name": "Probe layer", "order": 1, "shift_days": days, "handoff_time": handoff, "start_date": start,
            "people": [ids[p] for p in people], "restrictions": restrictions or []}
    must(api.post(f"/api/schedules/{schedule['id']}/layers", sent), 201)
    schedule["layer_sent"] = sent
    return schedule


def schedule_layer(api: Api, schedule_id: str, name: str) -> dict:
    layers = [layer for layer in must(api.get(f"/api/schedules/{schedule_id}"))["layers"] if layer.get("name") == name]
    assert len(layers) == 1, f"one layer called {name!r} on the schedule"
    return layers[0]


def final(api: Api, schedule_id: str, start: datetime, end: datetime, zone: str | None = None) -> dict:
    params = {"from": iso(start), "to": iso(end)} | ({"zone": zone} if zone else {})
    return must(api.get(f"/api/schedules/{schedule_id}/final", params=params))


def person_of(block: dict) -> str | None:
    return block["person"]["name"] if block["person"] else None


def holder_at(blocks: list[dict], moment: datetime) -> str | None:
    for block in blocks:
        if at(block["start"]) <= moment < at(block["end"]):
            return person_of(block)
    pytest.fail(f"no final block covers {moment}; expected one person or a flagged gap at every moment")


@contextlib.contextmanager
def screen(browser: Browser, base: str, email: str | None = None, *, width: int = 1280, height: int = 800,
           reduced: bool = False, device_time: datetime | None = None, zone: str | None = None,
           touch: bool = False, spy: bool = False) -> Iterator[Page]:
    options: dict[str, Any] = {
        "viewport": {"width": width, "height": height}, "base_url": base,
        "reduced_motion": "reduce" if reduced else "no-preference", "has_touch": touch,
    }
    if zone:
        options["timezone_id"] = zone
    context = browser.new_context(**options)
    context.set_default_timeout(PAGE_MS)
    try:
        if email:
            answer = context.request.post(f"{base}/api/session", data={"email": email, "password": PASSWORD})
            assert answer.status == 200, f"sign-in for {email} answered {answer.status}"
        page = context.new_page()
        if spy:
            page.add_init_script(LIVE_SPY)
        if device_time:
            page.clock.set_fixed_time(device_time)
        yield page
    finally:
        context.close()


def named(scope: Any, role: str, name: str) -> Locator:
    return scope.get_by_role(role, name=name, exact=True)


def editor_button(page: Page, name: str) -> Locator:
    title = named(page, "textbox", "Update title")
    expect(title).to_be_visible()
    buttons = named(page, "button", name)
    editor = wait_for(lambda: buttons.evaluate_all(EDITOR_BUTTONS, title.element_handle()),
                      f"a button {name!r} with the status desk editor", PAGE_MS / 1000)
    assert len(editor) == 1, f"the status desk editor holds {len(editor)} buttons named {name!r}"
    return buttons.nth(editor[0])


EDITOR_BUTTONS = """(buttons, title) => {
  const outside = (b) => { const row = b.closest('li, tr, [role="listitem"], [role="row"]'); return !row || row.contains(title); };
  for (let box = title.parentElement; box; box = box.parentElement) {
    const here = buttons.map((b, i) => (box.contains(b) && outside(b) ? i : -1)).filter((i) => i >= 0);
    if (here.length) return here;
  }
  return [];
}"""


def live(page: Page) -> Locator:
    return named(page, "status", "Live updates")


def announced(page: Page, line: str, ms: int = LIVE_MS) -> None:
    expect(live(page)).to_contain_text(line, timeout=ms)


SHOWN = """(t) => [...document.querySelectorAll('body *')].some((el) => {
  if (el.closest('[role="status"][aria-label="Live updates"]')) return false;
  if (el.textContent.replace(/\\s+/g, ' ').trim() !== t) return false;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden';
})"""


def shown(page: Page, text: str, seconds: float = LIVE_MS / 1000 * 2) -> None:
    wait_for(lambda: page.evaluate(SHOWN, text), f"{text!r} shown on screen", seconds)


def shown_across_switch(page: Page, text: str, seconds: float = LIVE_MS / 1000 * 2) -> None:
    def look() -> bool:
        try:
            return page.evaluate(SHOWN, text)
        except PlaywrightError as error:
            if "Execution context was destroyed" in str(error):
                return False
            raise
    wait_for(look, f"{text!r} shown on screen", seconds)


def goto_settled(page: Page, path: str) -> Any:
    for _ in range(3):
        try:
            return page.goto(path)
        except PlaywrightError as error:
            if "interrupted by another navigation" not in str(error) and "net::ERR_ABORTED" not in str(error):
                raise
            page.wait_for_load_state()
    return page.goto(path)


def page_fits(page: Page) -> None:
    wait_for(lambda: page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"),
             "no horizontal page overflow", 3)


def drop_socket(page: Page) -> None:
    wait_for(lambda: page.evaluate("window.__live && window.__live.readyState === 1"), "the page's open socket", 10)
    page.context.set_offline(True)
    page.evaluate("window.__live.close()")


def row(page: Page, number: int) -> Locator:
    return page.locator(f'[data-incident="{number}"]:visible')


def holder_data(page: Page) -> dict[str, str | None]:
    region = named(page, "region", "Holder")
    return {k: region.get_attribute(f"data-{k}") for k in ("level", "cycle", "holder", "remaining-seconds")}


def in_viewport_clear(page: Page, locator: Locator) -> bool:
    return locator.evaluate(
        """(el) => {
          const r = el.getBoundingClientRect();
          if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return false;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + 1);
          const bottom = document.elementFromPoint(r.left + r.width / 2, r.bottom - 1);
          return [hit, top, bottom].every((x) => x && (el.contains(x) || x.contains(el)));
        }"""
    )


def small_targets(page: Page) -> list[str]:
    return page.evaluate(
        """(min) => [...document.querySelectorAll(
            'button, select, textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio])')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden'
              && (r.width < min - 0.5 || r.height < min - 0.5);
          }).map((el) => el.getAttribute('aria-label') || el.textContent.trim() || el.name)""",
        TARGET_PX,
    )


def released(gate: Any) -> None:
    (gate.release if hasattr(gate, "release") else gate)()


def tab_until_focused(page: Page, locator: Locator, presses: int = 80) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        if locator.evaluate("(el) => el === document.activeElement"):
            return
    pytest.fail("Tab never reached the published control")


def block_rects(group: Locator) -> list[dict]:
    return group.locator("[data-start]").evaluate_all(
        """(els) => els.map((el) => {
          const r = el.getBoundingClientRect();
          return {start: el.dataset.start, end: el.dataset.end, person: el.dataset.person, source: el.dataset.source,
                  preview: el.dataset.preview === 'true', minutes: Number(el.dataset.minutes),
                  x: r.left, y: r.top + r.height / 2, width: r.width};
        })"""
    )


def assert_to_scale(rects: list[dict]) -> None:
    usable = [r for r in rects if r["minutes"] >= 60 and r["width"] > 0]
    assert usable, "the final row must draw blocks with data-minutes"
    scale = max(usable, key=lambda r: r["minutes"])
    per_minute = scale["width"] / scale["minutes"]
    for r in usable:
        assert abs(r["width"] - r["minutes"] * per_minute) <= 3, f"block {r} is not on one scale ({per_minute} px/min)"


def x_of(rects: list[dict], moment: datetime) -> tuple[float, float]:
    for r in rects:
        if at(r["start"]) <= moment < at(r["end"]):
            fraction = (moment - at(r["start"])).total_seconds() / 60 / r["minutes"]
            return r["x"] + r["width"] * fraction, r["y"]
    pytest.fail(f"no drawn block covers {moment}")


def band_widths(page: Page) -> list[dict]:
    return page.locator("[data-date]").evaluate_all(
        """(els) => els.map((el) => ({date: el.dataset.date, minutes: Number(el.dataset.minutes),
              width: el.getBoundingClientRect().width}))"""
    )


def override_blocks(api: Api, schedule_id: str, day_start: datetime) -> list[dict]:
    blocks = final(api, schedule_id, day_start, day_start + timedelta(days=1))["blocks"]
    return [b for b in blocks if b["source"] == "override"]


@contextlib.contextmanager
def listener(handle: Callable[[socket.socket], None]) -> Iterator[None]:
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", OUTAGE_PORT))
    server.listen(32)
    deadline = time.monotonic() + 900
    conns: list[socket.socket] = []

    def serve_one(conn: socket.socket) -> None:
        with contextlib.suppress(OSError, ValueError), conn:
            handle(conn)

    def accept_loop() -> None:
        while time.monotonic() < deadline:
            try:
                conn, _ = server.accept()
            except OSError:
                return
            conns.append(conn)
            threading.Thread(target=serve_one, args=(conn,), daemon=True).start()

    thread = threading.Thread(target=accept_loop, daemon=True)
    thread.start()
    try:
        yield
    finally:
        with contextlib.suppress(OSError):
            server.shutdown(socket.SHUT_RDWR)
        server.close()
        for open_conn in conns:
            with contextlib.suppress(OSError):
                open_conn.shutdown(socket.SHUT_RDWR)
        thread.join(5)


def smtp_handler(received: list[str]) -> Callable[[socket.socket], None]:
    def handle(conn: socket.socket) -> None:
        conn.sendall(b"220 stub ESMTP\r\n")
        reader = conn.makefile("rb")
        for _ in range(100000):
            line = reader.readline()
            if not line:
                return
            verb = line[:4].upper()
            if verb == b"DATA":
                conn.sendall(b"354 go\r\n")
                body = b""
                for _ in range(100000):
                    chunk = reader.readline()
                    if chunk in (b".\r\n", b".\n", b""):
                        break
                    body += chunk
                received.append(body.decode("utf-8", "replace"))
                conn.sendall(b"250 accepted\r\n")
            elif verb == b"QUIT":
                conn.sendall(b"221 bye\r\n")
                return
            else:
                conn.sendall(b"250 ok\r\n")

    return handle


def http_handler(received: list[dict]) -> Callable[[socket.socket], None]:
    def handle(conn: socket.socket) -> None:
        reader = conn.makefile("rb")
        head = {}
        first = reader.readline().decode()
        for _ in range(200):
            line = reader.readline().decode().strip()
            if not line:
                break
            name, _, value = line.partition(":")
            head[name.lower()] = value.strip()
        body = reader.read(int(head.get("content-length", 0)))
        received.append({"line": first, "headers": head, "body": body.decode()})
        payload = b'{"received":true}'
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: "
                     + str(len(payload)).encode() + b"\r\n\r\n" + payload)

    return handle


def relay_handler(host: str, port: int, username: str | None = None,
                  password: str | None = None) -> Callable[[socket.socket], None]:
    def resp(*parts: str) -> bytes:
        out = f"*{len(parts)}\r\n".encode()
        for part in parts:
            out += f"${len(part.encode())}\r\n{part}\r\n".encode()
        return out

    def handle(conn: socket.socket) -> None:
        upstream = socket.create_connection((host, port), timeout=HTTP_SECONDS)
        if password:
            credentials = (username, password) if username else (password,)
            upstream.sendall(resp("AUTH", *credentials))
            reply = b""
            for _ in range(1000):
                reply += upstream.recv(1)
                if reply.endswith(b"\r\n") or not reply:
                    break
        upstream.settimeout(None)

        def pump(src: socket.socket, dst: socket.socket) -> None:
            with contextlib.suppress(OSError):
                for _ in range(10000000):
                    data = src.recv(65536)
                    if not data:
                        break
                    dst.sendall(data)
            with contextlib.suppress(OSError):
                dst.shutdown(socket.SHUT_WR)

        back = threading.Thread(target=pump, args=(upstream, conn), daemon=True)
        back.start()
        pump(conn, upstream)
        back.join(HTTP_SECONDS)
        upstream.close()

    return handle


def amqp_publish(queue: str, bodies: list[bytes]) -> None:
    url = os.environ.get("AMQP_URL")
    if not url:
        pytest.fail("AMQP_URL must be set in the verifier to publish the brief's queue messages (L912)")
    parts = urlparse(url)
    vhost = unquote(parts.path[1:]) or "/"

    def short(value: str) -> bytes:
        return bytes([len(value)]) + value.encode()

    def frame(kind: int, channel: int, payload: bytes) -> bytes:
        return struct.pack(">BHI", kind, channel, len(payload)) + payload + b"\xce"

    with socket.create_connection((parts.hostname, parts.port or 5672), timeout=HTTP_SECONDS) as conn:
        reader = conn.makefile("rb")

        def read_method(expected: tuple[int, int]) -> bytes:
            for _ in range(50):
                kind, _channel, size = struct.unpack(">BHI", reader.read(7))
                payload = reader.read(size)
                reader.read(1)
                if kind == 1 and struct.unpack(">HH", payload[:4]) == expected:
                    return payload[4:]
            pytest.fail(f"AMQP broker never answered method {expected}")

        conn.sendall(b"AMQP\x00\x00\x09\x01")
        read_method((10, 10))
        secret = f"\0{unquote(parts.username or 'guest')}\0{unquote(parts.password or 'guest')}".encode()
        conn.sendall(frame(1, 0, struct.pack(">HH", 10, 11) + struct.pack(">I", 0) + short("PLAIN")
                           + struct.pack(">I", len(secret)) + secret + short("en_US")))
        tune = read_method((10, 30))
        channel_max, frame_max, _heartbeat = struct.unpack(">HIH", tune[:8])
        frame_max = frame_max or 131072
        conn.sendall(frame(1, 0, struct.pack(">HH", 10, 31) + struct.pack(">HIH", channel_max, frame_max, 0)))
        conn.sendall(frame(1, 0, struct.pack(">HH", 10, 40) + short(vhost) + short("") + b"\x00"))
        read_method((10, 41))
        conn.sendall(frame(1, 1, struct.pack(">HH", 20, 10) + short("")))
        read_method((20, 11))
        conn.sendall(frame(1, 1, struct.pack(">HH", 85, 10) + b"\x00"))
        read_method((85, 11))
        for body in bodies:
            conn.sendall(frame(1, 1, struct.pack(">HH", 60, 40) + struct.pack(">H", 0) + short("") + short(queue)
                               + b"\x00"))
            properties = short("application/json") + b"\x02"
            conn.sendall(frame(2, 1, struct.pack(">HHQH", 60, 0, len(body), 0x9000) + properties))
            limit = frame_max - 8
            for start in range(0, len(body), limit):
                conn.sendall(frame(3, 1, body[start:start + limit]))
            read_method((60, 80))
        conn.sendall(frame(1, 0, struct.pack(">HH", 10, 50) + struct.pack(">H", 200) + short("")
                           + struct.pack(">HH", 0, 0)))
        read_method((10, 51))


def queue_message(rk: str, key: str, seq: int, action: str = "trigger", event_id: str | None = None,
                  severity: str = "critical", summary: str = "Probe queue message") -> dict:
    message: dict[str, Any] = {
        "event_id": event_id or str(uuid.uuid4()), "routing_key": rk, "dedup_key": key, "key_seq": seq,
        "event_action": action, "accepted_at": "2027-03-14T14:00:00Z",
    }
    if action == "trigger":
        message["payload"] = {"summary": summary, "source": "probe-1", "severity": severity}
    return message


def publish(*messages: Any) -> None:
    amqp_publish(EVENTS_QUEUE, [m if isinstance(m, bytes) else json.dumps(m).encode() for m in messages])


def dead_letter(api: Api, marker: str) -> dict | None:
    for item in must(api.get("/api/dead-letters"))["items"]:
        if marker in json.dumps(item.get("raw")):
            return item
    return None


def in_dead_queue(rabbitmq: Any, marker: str) -> bool:
    return any(marker in json.dumps(m.get("payload")) for m in rabbitmq.peek(DEAD_QUEUE, PEEK_COUNT))


LISTENER_LOOKUP = """
import contextlib, json, os, sys
from pathlib import Path
port, inodes = int(sys.argv[1]), set()
for table in ("/proc/net/tcp", "/proc/net/tcp6"):
    with contextlib.suppress(OSError):
        for line in Path(table).read_text().splitlines()[1:]:
            fields = line.split()
            if fields[3] == "0A" and int(fields[1].rsplit(":", 1)[1], 16) == port:
                inodes.add(fields[9])
for process in Path("/proc").iterdir():
    if not process.name.isdigit():
        continue
    with contextlib.suppress(OSError):
        links = [os.readlink(fd) for fd in (process / "fd").iterdir()]
        if any(link.startswith("socket:[") and link[8:-1] in inodes for link in links):
            items = (process / "environ").read_bytes().decode("utf-8", "replace").split("\\0")
            print(json.dumps({"pid": int(process.name), "env": dict(i.split("=", 1) for i in items if "=" in i)}))
            break
"""


APP_USER = 10001


def listening_copy(port: int) -> tuple[int, dict[str, str]]:
    command = [sys.executable, "-I", "-c", LISTENER_LOOKUP, str(port)]
    if os.geteuid() == 0:
        command = ["setpriv", f"--reuid={APP_USER}", f"--regid={APP_USER}", "--clear-groups", "--", *command]
    found = subprocess.run(command, capture_output=True, text=True, timeout=HTTP_SECONDS, check=False).stdout.strip()
    if not found:
        pytest.fail(f"no accessible process listens on port {port}; the restart test must stop and start that copy")
    record = json.loads(found)
    return record["pid"], record["env"]


def restart_copy(base: str) -> None:
    port = urlparse(base).port
    pid, env = listening_copy(port)
    os.kill(pid, signal.SIGTERM)

    def gone() -> bool:
        try:
            state = Path(f"/proc/{pid}/status").read_text().split("State:", 1)[1].split()[0]
        except (OSError, IndexError):
            return True
        return state in ("Z", "X")

    try:
        wait_for(gone, f"the copy's process {pid} ended", 20)
    except pytest.fail.Exception:
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGKILL)
        wait_for(gone, f"the copy's process {pid} ended after SIGKILL", 10)
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    owner = Path(f"/proc/{os.getpid()}").stat().st_uid
    command = ["setpriv", f"--reuid={APP_USER}", f"--regid={APP_USER}", "--clear-groups", "--no-new-privs", "--",
               "/bin/sh", "-ec", serve] if owner == 0 else ["/bin/sh", "-ec", serve]
    process = subprocess.Popen(command, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT)

    def healthy() -> bool:
        if process.poll() is not None:
            log.flush()
            pytest.fail(f"restarted copy exited: {Path(log.name).read_text()[-2000:]}")
        with contextlib.suppress(httpx.HTTPError):
            return httpx.get(f"{base}/api/health", timeout=2).status_code == 200
        return False

    wait_for(healthy, "the restarted copy answers health", 90)


def upgrade_status(api: Api, origin: str | None = None) -> int:
    headers = {"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
               "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}
    if origin:
        headers["Origin"] = origin
    return api.get("/api/live", headers=headers).status_code


def test_wf_intake_lifecycle_accepted_only_after_confirm(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Sunniva Okoye")
    key = tag("accept").replace(" ", "-")
    accepted = send(app_url, desk.rk, key=key)
    assert accepted["status"] == "accepted" and accepted["dedup_key"] == key
    uuid.UUID(accepted["event_id"])
    inc = wait_incident(admin, desk.sid)[0]
    assert incident(admin, inc["id"])["alerts"][0]["dedup_key"] == key
    generated = send(app_url, desk.rk)
    assert generated["dedup_key"], "a trigger with no dedup key gets a generated one"
    wait_incident(admin, desk.sid, 2)

    base = copy_url("APP_BROKER_DOWN_URL")
    copy_admin = Api(base, ROWAN)
    copy_desk = make_desk(copy_admin, "Sunniva Okoye")
    refused = httpx.post(f"{base}/api/events", json=event_body(copy_desk.rk, key="never"), timeout=HTTP_SECONDS)
    assert refused.status_code == 503 and refused.json() == {"error": "queue_unavailable"}
    row_ = wait_log(copy_admin, copy_desk.iid, "The queue did not confirm this event.", "Refused")
    assert row_["event_id"] is None and row_["incident_number"] is None
    assert not listed(copy_admin, copy_desk.sid), "a refused event opens nothing"
    counter = must(copy_admin.get(f"/api/integrations/{copy_desk.iid}"))["counter"]
    assert counter["count"] == 0 and counter["retry_after"] is None, "a broker outage uses no rate slot"
    assert must(copy_admin.get("/api/system"))["queue"] == "down"
    with screen(browser, base, ROWAN) as page:
        page.goto(f"/integrations/{copy_desk.iid}")
        shown(page, "The queue is unreachable. New events are being refused.", PAGE_MS / 1000)
        expect(named(page, "table", "Event log")).to_contain_text("The queue did not confirm this event.")


INTAKE_IDS = ["summary_and_severity", "no_routing_key", "bad_action", "ack_without_key", "long_key",
              "long_summary", "no_source"]


@pytest.mark.parametrize("case", INTAKE_IDS, ids=INTAKE_IDS)
def test_intake_refusals(app_url: str, admin: Api, case: str) -> None:
    desk = make_desk(admin, "Sunniva Okoye")
    body = event_body(desk.rk, key=tag("refuse").replace(" ", "-"))
    payload = body["payload"]
    expected: dict[str, str]
    fields = ""
    if case == "summary_and_severity":
        del payload["summary"]
        payload["severity"] = "high"
        expected = {"payload.summary": "Summary is required.",
                    "payload.severity": "Severity must be critical, error, warning or info."}
        fields = "payload.summary, payload.severity"
    elif case == "no_routing_key":
        del body["routing_key"]
        expected = {"routing_key": "Routing key is required."}
    elif case == "bad_action":
        body["event_action"] = "reopen"
        expected = {"event_action": "Action must be trigger, acknowledge or resolve."}
        fields = "event_action"
    elif case == "ack_without_key":
        body = {"routing_key": desk.rk, "event_action": "acknowledge"}
        expected = {"dedup_key": "Dedup key is required for this action."}
        fields = "dedup_key"
    elif case == "long_key":
        body["dedup_key"] = "k" * 256
        expected = {"dedup_key": "Dedup key must be 1 to 255 characters."}
        fields = "dedup_key"
    elif case == "long_summary":
        payload["summary"] = "s" * 1025
        expected = {"payload.summary": "Summary is longer than 1024 characters."}
        fields = "payload.summary"
    else:
        del payload["source"]
        expected = {"payload.source": "Source is required."}
        fields = "payload.source"
    answer = httpx.post(f"{app_url}/api/events", json=body, timeout=HTTP_SECONDS)
    assert answer.status_code == 400
    assert answer.json() == {"error": "invalid_event", "errors": expected}
    if fields:
        logged = wait_log(admin, desk.iid, f"Invalid event: {fields}.", "Refused")
        assert logged["event_id"] is None and logged["incident_number"] is None
    unknown = httpx.post(f"{app_url}/api/events", json=event_body(f"rk_{uuid.uuid4().hex}", key="k"),
                         timeout=HTTP_SECONDS)
    assert unknown.status_code == 404 and unknown.json() == {"error": "unknown_routing_key"}
    broken = httpx.post(f"{app_url}/api/events", content=b"{not json",
                        headers={"Content-Type": "application/json"}, timeout=HTTP_SECONDS)
    assert broken.status_code == 400 and broken.json() == {"error": "invalid_json"}
    assert must(admin.get(f"/api/integrations/{desk.iid}"))["counter"]["count"] == 0, "refusals do not count"
    assert not listed(admin, desk.sid), "a refused event must publish nothing and open nothing"


def test_wf_intake_lifecycle_repeat_then_new_alert(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    key = tag("life").replace(" ", "-")
    send(app_url, desk.rk, key=key)
    first_id = wait_incident(admin, desk.sid)[0]["id"]
    number = incident(admin, first_id)["number"]
    with screen(browser, app_url, INES) as page, screen(browser, app_url, SUNNIVA) as watcher:
        page.goto(f"/incidents/{first_id}")
        watcher.goto(f"/incidents?status=all&service={desk.sid}")
        expect(row(watcher, number)).to_be_focused()
        expect(named(page, "list", "Alerts")).to_contain_text(key)
        send(app_url, desk.rk, key=key)
        expect(named(page, "list", "Timeline")).to_contain_text(f"Repeat event on {key}", timeout=LIVE_MS * 5)
        first = wait_for(lambda: (i := incident(admin, first_id)) and i["alerts"][0]["event_count"] == 2 and i,
                         "the repeat raised event_count to 2")
        assert len(first["alerts"]) == 1 and len(entries(first, "triggered")) == 1
        assert [e["text"] for e in entries(first, "repeat_event")] == [f"Repeat event on {key}"]
        assert "Repeat event" not in live(page).text_content(), "a repeat event is on the timeline only, not announced"
        send(app_url, desk.rk, "resolve", key)
        line = f"Incident #{number} resolved by {desk.integration['name']}"
        announced(page, line, LIVE_MS * 5)
        announced(watcher, line, LIVE_MS * 5)
        assert live(page).text_content().count(line) == 1, "announced once"
        resolved = incident(admin, first_id)
        assert resolved["status"] == "resolved"
        assert entries(resolved, "resolved")[0]["actor"] == desk.integration["name"]
        send(app_url, desk.rk, key=key)
        rows = wait_incident(admin, desk.sid, 2)
        banner = named(watcher, "button", "Show 1 new incidents")
        expect(banner).to_be_visible(timeout=LIVE_MS)
        expect(row(watcher, number)).to_be_focused()
        expect(row(watcher, next(r for r in rows if r["id"] != first_id)["number"])).to_have_count(0)
    newest = next(r for r in rows if r["id"] != first_id)
    fresh = incident(admin, newest["id"])
    assert fresh["alerts"][0]["dedup_key"] == key and fresh["alerts"][0]["event_count"] == 1
    old = incident(admin, first_id)
    assert old["status"] == "resolved" and old["alerts"][0]["status"] == "resolved"
    assert old["alerts"][0]["event_count"] == 2, "the resolved alert never reopens"


def test_wf_intake_lifecycle_log_reasons_live(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    other = make_desk(admin, "Ines Varga")
    theirs = tag("theirs").replace(" ", "-")
    send(app_url, other.rk, key=theirs)
    wait_incident(admin, other.sid)
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/integrations/{desk.iid}")
        table = named(page, "table", "Event log")
        expect(table).to_be_visible()
        navigations: list[str] = []
        page.on("framenavigated", lambda f: navigations.append(f.url))

        def lands(reason: str) -> None:
            matching = table.get_by_role("row").filter(has_text=reason)
            expect(matching.first).to_contain_text("Dropped", timeout=LIVE_MS * 5)

        lands_key = tag("gone").replace(" ", "-")
        send(app_url, desk.rk, "acknowledge", lands_key)
        lands("No alert has this dedup key.")
        send(app_url, desk.rk, "acknowledge", theirs)
        lands("This dedup key belongs to another integration.")
        mine = tag("mine").replace(" ", "-")
        send(app_url, desk.rk, key=mine)
        wait_incident(admin, desk.sid)
        send(app_url, desk.rk, "acknowledge", mine)
        send(app_url, desk.rk, "acknowledge", mine)
        lands("This alert is already acknowledged.")
        send(app_url, desk.rk, "resolve", mine)
        send(app_url, desk.rk, "resolve", mine)
        lands("This alert is already resolved.")
        assert not navigations, f"the log must change in place, saw navigations {navigations}"
    row_ = wait_log(admin, desk.iid, "This alert is already resolved.", "Dropped", mine)
    assert row_["action"] == "resolve"
    count = [r for r in log_rows(admin, desk.iid) if r["reason"] == "This alert is already acknowledged."]
    assert len(count) == 1, "each dropped event logs one row"


@pytest.mark.timeout(400)
def test_rate_limit_window_in_valkey(app_url: str, admin: Api, clock: Clock, valkey: Any) -> None:
    desk = make_desk(admin, "Ines Varga")
    spare = make_desk(admin, "Ines Varga")
    start = clock.now()
    for _ in range(RATE_LIMIT - 1):
        send(app_url, desk.rk, "acknowledge", "flood")
    counter = must(admin.get(f"/api/integrations/{desk.iid}"))["counter"]
    assert counter == {"count": RATE_LIMIT - 1, "limit": RATE_LIMIT, "retry_after": None, "available": True}
    send(app_url, desk.rk, "acknowledge", "flood")
    counter = must(admin.get(f"/api/integrations/{desk.iid}"))["counter"]
    assert counter["count"] == RATE_LIMIT and counter["retry_after"] == RATE_WINDOW and counter["available"] is False
    stored = valkey.hash(f"switchlamp:{INSTANCE}:rate:{desk.rk}")
    assert int(stored["count"]) == RATE_LIMIT and int(stored["window_start"]) == int(start.timestamp())
    assert valkey.ttl(f"switchlamp:{INSTANCE}:rate:{desk.rk}") >= RATE_TTL_SECONDS - 5
    refused = httpx.post(f"{app_url}/api/events", json=event_body(desk.rk, "acknowledge", "flood"),
                         timeout=HTTP_SECONDS)
    assert refused.status_code == 429
    assert refused.json() == {"error": "rate_limited", "retry_after": RATE_WINDOW}
    assert refused.headers["Retry-After"] == str(RATE_WINDOW)
    row_ = wait_log(admin, desk.iid, "Over the limit of 120 events a minute.", "Refused")
    assert row_["event_id"] is None
    assert must(admin.get(f"/api/integrations/{desk.iid}"))["counter"]["count"] == RATE_LIMIT, "a 429 does not count"
    send(app_url, spare.rk, "acknowledge", "flood")
    clock.advance(RATE_WINDOW - 1)
    late = httpx.post(f"{app_url}/api/events", json=event_body(desk.rk, "acknowledge", "flood"), timeout=HTTP_SECONDS)
    assert late.status_code == 429 and late.json()["retry_after"] == 1
    clock.advance(1)
    counter = must(admin.get(f"/api/integrations/{desk.iid}"))["counter"]
    assert counter["count"] == 0 and counter["retry_after"] is None and counter["available"] is True
    send(app_url, desk.rk, "acknowledge", "flood")
    assert must(admin.get(f"/api/integrations/{desk.iid}"))["counter"]["count"] == 1
    base = copy_url("APP_RESTART_URL")
    copy_api = Api(base, ROWAN)
    with frozen(copy_api) as copy_clock:
        counted_desk = make_desk(copy_api, "Dario Mbeki")
        for _ in range(3):
            send(base, counted_desk.rk, "acknowledge", "restart")
        key = f"switchlamp:restart:rate:{counted_desk.rk}"
        assert int(valkey.hash(key)["count"]) == 3 and valkey.ttl(key) >= RATE_TTL_SECONDS - 5
        restart_copy(base)
        copy_api = Api(base, ROWAN)
        copy_clock.api = copy_api
        assert must(copy_api.get(f"/api/integrations/{counted_desk.iid}"))["counter"]["count"] == 3, "the rate window carries on"


def test_out_of_order_copies_apply_once(admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    key = tag("order").replace(" ", "-")
    one = queue_message(desk.rk, key, 1)
    two = queue_message(desk.rk, key, 2)
    three = queue_message(desk.rk, key, 3, "resolve")
    publish(three, one, two, two, one)
    rows = wait_incident(admin, desk.sid)
    inc = wait_for(lambda: (i := incident(admin, rows[0]["id"])) and i["status"] == "resolved" and i,
                   "key_seq 3 (the resolve) applied after 1 and 2")
    publish(one, three)
    assert len(inc["alerts"]) == 1 and inc["alerts"][0]["event_count"] == 2
    logged = wait_for(lambda: (r := log_rows(admin, desk.iid)) and len(r) >= 3 and r, "three log rows")
    fresh = incident(admin, inc["id"])
    assert len(entries(fresh, "triggered")) == 1
    assert len(entries(fresh, "repeat_event")) == 1
    assert len(entries(fresh, "resolved")) == 1
    assert len(listed(admin, desk.sid)) == 1, "a repeated copy never makes a second alert"
    ids = [r["event_id"] for r in logged]
    assert sorted(ids) == sorted({one["event_id"], two["event_id"], three["event_id"]}), "one log row per event"


def test_wf_queue_order_noisy_integration_page(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga")
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/integrations/{desk.iid}")
        counter = named(page, "status", "Events this minute")
        countdown = named(page, "timer", "Retry-After countdown")
        expect(counter).to_have_text(counted(0))
        expect(countdown).to_have_text("Accepting events")
        navigations: list[str] = []
        page.on("framenavigated", lambda f: navigations.append(f.url))
        send(app_url, desk.rk, "acknowledge", "noisy")
        expect(counter).to_have_text(counted(1), timeout=LIVE_MS)
        for _ in range(RATE_LIMIT - 2):
            send(app_url, desk.rk, "acknowledge", "noisy")
        expect(counter).to_have_text(counted(RATE_LIMIT - 1), timeout=LIVE_MS)
        expect(countdown).to_have_text("Accepting events")
        send(app_url, desk.rk, "acknowledge", "noisy")
        expect(counter).to_have_text(counted(RATE_LIMIT), timeout=LIVE_MS)
        expect(countdown).to_have_text(seconds_label(RATE_WINDOW), timeout=LIVE_MS)
        refused = httpx.post(f"{app_url}/api/events", json=event_body(desk.rk, "acknowledge", "noisy"),
                             timeout=HTTP_SECONDS)
        assert refused.status_code == 429
        expect(named(page, "table", "Event log")).to_contain_text("Over the limit of 120 events a minute.",
                                                                  timeout=LIVE_MS)
        clock.advance(30)
        expect(countdown).to_have_text(seconds_label(RATE_WINDOW // 2), timeout=LIVE_MS)
        with screen(browser, app_url, DARIO) as other:
            other.goto(f"/integrations/{desk.iid}")
            expect(named(other, "timer", "Retry-After countdown")).to_have_text(seconds_label(RATE_WINDOW // 2))
            expect(named(other, "status", "Events this minute")).to_have_text(counted(RATE_LIMIT))
            other.reload()
            expect(named(other, "timer", "Retry-After countdown")).to_have_text(seconds_label(RATE_WINDOW // 2))
        clock.advance(29)
        expect(countdown).to_have_text(seconds_label(1), timeout=LIVE_MS)
        expect(counter).to_have_text(counted(RATE_LIMIT))
        clock.advance(1)
        expect(countdown).to_have_text("Accepting events", timeout=LIVE_MS)
        expect(counter).to_have_text(counted(0), timeout=LIVE_MS)
        assert not navigations, f"expected no reload, saw {navigations}"


@pytest.mark.timeout(400)
def test_dead_letters_after_retries(admin: Api, lead: Api, rabbitmq: Any) -> None:
    desk = make_desk(admin, "Ines Varga")

    def marker() -> str:
        return uuid.uuid4().hex

    base = [marker() for _ in range(7)]
    missing_id = queue_message(desk.rk, base[1], 1)
    del missing_id["event_id"], missing_id["dedup_key"]
    missing_id["payload"]["summary"] = base[1]
    missing_key = queue_message(desk.rk, "x", 1)
    del missing_key["dedup_key"]
    missing_key["payload"]["summary"] = base[2]
    missing_summary = queue_message(desk.rk, base[3], 1)
    del missing_summary["payload"]["summary"]
    bad_severity = queue_message(desk.rk, base[4], 1, severity="high")
    long_summary = queue_message(desk.rk, base[5], 1, summary="s" * 1025)
    unknown_key = f"rk_{base[6]}"
    unknown = queue_message(unknown_key, "k", 1)
    cases = [
        (f"not json {base[0]}".encode(), base[0], "Body is not valid JSON."),
        (missing_id, base[1], "Missing field: event_id."),
        (missing_key, base[2], "Missing field: dedup_key."),
        (missing_summary, base[3], "Missing field: payload.summary."),
        (bad_severity, base[4], "Unknown severity: high."),
        (long_summary, base[5], "Summary is longer than 1024 characters."),
        (unknown, base[6], f"Unknown routing key: {unknown_key}."),
    ]
    late_key = marker()
    first = queue_message(desk.rk, late_key, 1)
    third = queue_message(desk.rk, late_key, 3)
    publish(*[c[0] for c in cases], first, third)
    for _body, mark, reason in cases:
        found = wait_for(lambda m=mark: dead_letter(admin, m), f"a dead letter with reason {reason!r}")
        assert found["reason"] == reason and found["attempts"] == 3, found
        assert in_dead_queue(rabbitmq, mark), f"{reason!r} must sit in the durable dead-letter queue"
    assert not listed(admin, desk.sid, "open") or all(
        late_key in json.dumps(incident(admin, r["id"])["alerts"]) for r in listed(admin, desk.sid)
    ), "a dead letter opens nothing"
    assert dead_letter(admin, third["event_id"]) is None, "an early message waits before it becomes a dead letter"
    waited = wait_for(lambda: dead_letter(admin, third["event_id"]),
                      "the waiting key_seq 3 dead-lettered after 60 real seconds",
                      LATE_EVENT_SECONDS + LATE_EVENT_MARGIN)
    assert waited["reason"] == "Earlier event never arrived: key_seq 2."
    assert must(lead.post(f"/api/dead-letters/{waited['id']}/replay")) == {
        "status": "replayed", "event_id": third["event_id"]}
    inc = next(r for r in listed(admin, desk.sid))
    wait_for(lambda: incident(admin, inc["id"])["alerts"][0]["event_count"] == 2,
             "a Replay with no correction applied the stored message once")
    wait_log(admin, desk.iid, None, "Replayed", late_key)
    again = lead.post(f"/api/dead-letters/{waited['id']}/replay")
    assert again.status_code == 409 and again.json() == {"error": "already_replayed"}


def severity_reason(value: str) -> str:
    return f"Unknown severity: {value}."


def test_wf_queue_order_replay_with_correction(browser: Browser, app_url: str, admin: Api, lead: Api,
                                               rabbitmq: Any) -> None:
    desk = make_desk(admin, "Ines Varga")
    key, twin_key = uuid.uuid4().hex, uuid.uuid4().hex
    bad = queue_message(desk.rk, key, 1, severity="high")
    twin = queue_message(desk.rk, twin_key, 1, severity="urgent")
    publish(bad, twin)
    letter = wait_for(lambda: dead_letter(admin, key), "the malformed message in the dead letters")
    twin_letter = wait_for(lambda: dead_letter(admin, twin_key), "the second malformed message")
    assert letter["reason"] == "Unknown severity: high." and twin_letter["reason"] == severity_reason("urgent")
    still_bad = lead.post(f"/api/dead-letters/{letter['id']}/replay", {"message": bad})
    assert still_bad.status_code == 422
    assert still_bad.json() == {"errors": {"message": "Unknown severity: high."}}
    assert dead_letter(admin, key), "a Replay that still cannot apply stays listed"
    corrected = queue_message(desk.rk, key, 1, event_id=bad["event_id"], severity="critical")
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/integrations/{desk.iid}")
        table = named(page, "table", "Dead letters")
        line = table.get_by_role("row").filter(has_text="Unknown severity: high.")
        expect(line).to_be_visible()
        opener = named(line, "button", "Replay")
        opener.click()
        dialog = named(page, "dialog", "Replay dead letter")
        expect(dialog).to_be_visible()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        opener.click()
        named(dialog, "textbox", "Corrected message").fill(json.dumps(corrected))
        named(dialog, "button", "Replay message").click()
        announced(page, "Replayed. The event applied once.", LIVE_MS * 3)
        expect(table.get_by_role("row").filter(has_text="Unknown severity: high.")).to_have_count(0, timeout=LIVE_MS)
        expect(table.get_by_role("row").filter(has_text=severity_reason("urgent"))).to_have_count(1)
    rows = wait_incident(admin, desk.sid)
    assert len(rows) == 1
    inc = incident(admin, rows[0]["id"])
    assert inc["alerts"][0]["event_count"] == 1 and len(entries(inc, "triggered")) == 1
    assert dead_letter(admin, key) is None
    wait_for(lambda: not in_dead_queue(rabbitmq, key), "the replayed message removed from the dead-letter queue")
    wait_log(admin, desk.iid, None, "Replayed", key)
    again = lead.post(f"/api/dead-letters/{letter['id']}/replay")
    assert again.status_code == 409 and again.json() == {"error": "already_replayed"}
    fixed = queue_message(desk.rk, twin_key, 1, event_id=twin["event_id"], severity="critical")
    other_lead = Api(app_url, DARIO)
    path = f"/api/dead-letters/{twin_letter['id']}/replay"
    answers = together(lambda: lead.post(path, {"message": fixed}), lambda: other_lead.post(path, {"message": fixed}))
    assert sorted(a.status_code for a in answers) == [200, 409], "a concurrent second Replay gets the 409"
    wait_incident(admin, desk.sid, 2)
    assert len(listed(admin, desk.sid)) == 2


def test_wf_grouping_urgency_modes_and_edges(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga", grouping="window", minutes=5)
    first = drill(admin, desk.sid, key="group-a")
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/incidents?status=all&service={desk.sid}")
        expect(row(page, first["number"])).to_be_focused()
        total = named(page, "status", "Incident total")
        expect(total).to_contain_text("1")
        clock.advance(299)
        joined = drill(admin, desk.sid, key="group-b")
        assert joined["id"] == first["id"] and len(joined["alerts"]) == 2, "the alert at T+4:59 joined the incident"
        assert joined["status"] == first["status"] and joined["holders"] == first["holders"]
        assert joined["countdown"]["due_at"] == first["countdown"]["due_at"], "joining never changes timers"
        expect(total).to_contain_text("1")
        expect(row(page, first["number"])).to_be_focused()
        clock.advance(1)
        second = drill(admin, desk.sid, key="group-c")
        assert second["id"] != first["id"], "the alert at T+5:00 opens a new incident"
        announced(page, f"Incident #{second['number']} triggered: {second['title']}")
        expect(named(page, "button", "Show 1 new incidents")).to_be_visible(timeout=LIVE_MS)
        expect(total).to_contain_text("2", timeout=LIVE_MS)
        expect(row(page, first["number"])).to_be_focused()
        assert incident(admin, first["id"])["status"] == "triggered", "the older incident stays open"
        must(act(admin, second["id"], "resolve"))
        third = drill(admin, desk.sid, key="group-d")
        assert third["id"] not in (first["id"], second["id"]), "a resolve ends the window early"
        expect(named(page, "button", "Show 2 new incidents")).to_be_visible(timeout=LIVE_MS)
        expect(total).to_contain_text("3", timeout=LIVE_MS)
        named(page, "button", "Show 2 new incidents").click()
        expect(row(page, third["number"])).to_be_visible(timeout=LIVE_MS)
        expect(row(page, first["number"])).to_be_focused()

    until = make_desk(admin, "Ines Varga", grouping="until_resolved")
    one = drill(admin, until.sid, key="u-1")
    clock.advance(86400)
    two = drill(admin, until.sid, key="u-2")
    assert two["id"] == one["id"] and len(two["alerts"]) == 2
    must(act(admin, one["id"], "resolve"))
    assert drill(admin, until.sid, key="u-3")["id"] != one["id"]

    alone = make_desk(admin, "Ines Varga", grouping="none")
    assert drill(admin, alone.sid, key="n-1")["id"] != drill(admin, alone.sid, key="n-2")["id"]


def test_wf_grouping_urgency_raise_notifies(browser: Browser, app_url: str, admin: Api, clock: Clock,
                                            mail: Any) -> None:
    with settings(app_url, DARIO, low_urgency_delay=10):
        desk = make_desk(admin, "Dario Mbeki", grouping="until_resolved")
        low = drill(admin, desk.sid, "warning", "raise-low")
        assert low["urgency"] == "low" and low["countdown"]["kind"] == "none"
        pending = [s for s in low["steps"] if s["channel"] == "email"]
        assert [s["status"] for s in pending] == ["scheduled"], low["steps"]
        with screen(browser, app_url, DARIO, device_time=WRONG_DEVICE_TIME) as page:
            page.goto(f"/incidents/{low['id']}")
            expect(named(page, "timer", "Incident countdown")).to_have_text("--:--")
            clock.advance(60)
            raised = drill(admin, desk.sid, "critical", "raise-high")
            assert raised["id"] == low["id"] and raised["urgency"] == "high"
            announced(page, f"Incident #{low['number']} raised to high urgency")
            expect(named(page, "timer", "Incident countdown")).to_have_text("30:00", timeout=LIVE_MS)
            expect(named(page, "region", "Holder")).to_have_attribute("data-remaining-seconds", str(THIRTY_MINUTES))
        fresh = incident(admin, low["id"])
        assert [e["text"] for e in entries(fresh, "urgency_raised")] == [
            f"Incident #{low['number']} raised to high urgency"]
        assert (fresh["level"], fresh["cycle"], fresh["countdown"]["kind"]) == (1, 0, "escalation")
        assert fresh["countdown"]["remaining_seconds"] == THIRTY_MINUTES
        low_ids = {s["id"] for s in pending}
        assert [s["status"] for s in fresh["steps"] if s["id"] in low_ids] == ["cancelled"]
        now = clock.now()
        dues = sorted(at(s["due_at"]) for s in fresh["steps"]
                      if s["channel"] == "email" and s["status"] == "scheduled")
        assert dues == [now + timedelta(minutes=5), now + timedelta(minutes=15)], fresh["steps"]
        clock.advance(600)
        assert len(subject_mail(mail, step_subject(fresh))) == 1
        no_mail(mail, f"[Switchlamp] Low urgency incident #{low['number']}: {low['title']}")

        quiet = make_desk(admin, "Dario Mbeki", grouping="until_resolved")
        acked = drill(admin, quiet.sid, "info", "ack-low")
        must(act(admin, acked["id"], "acknowledge"))
        bumped = drill(admin, quiet.sid, "error", "ack-high")
        assert bumped["urgency"] == "high" and bumped["status"] == "acknowledged"
        assert len(entries(bumped, "urgency_raised")) == 1
        assert not [s for s in bumped["steps"] if s["status"] == "scheduled"], "a raise on acknowledged notifies no one"


def test_escalation_run_published_walk(admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga", "Tomasz Reyes", repeats=2)
    inc = drill(admin, desk.sid)
    assert (inc["level"], inc["cycle"]) == (1, 0)
    assert [h["name"] for h in inc["holders"]] == ["Ines Varga"]
    opened = clock.now()
    walk = [(2, 0), (1, 1), (2, 1), (1, 2), (2, 2)]
    for level, cycle in walk:
        prior = incident(admin, inc["id"])
        assert (prior["level"], prior["cycle"]) != (level, cycle)
        clock.advance(THIRTY_MINUTES - 1)
        same = incident(admin, inc["id"])
        assert (same["level"], same["cycle"]) == (prior["level"], prior["cycle"])
        assert same["countdown"]["remaining_seconds"] == 1
        clock.advance(1)
        moved = incident(admin, inc["id"])
        assert (moved["level"], moved["cycle"]) == (level, cycle), "the level changes at the exact timeout second"
    clock.advance(THIRTY_MINUTES)
    done = incident(admin, inc["id"])
    assert done["countdown"] == {"kind": "none", "due_at": None, "remaining_seconds": 0}
    assert [h["name"] for h in done["holders"]] == ["Tomasz Reyes"]
    assert len(entries(done, "escalated")) == 5, "after the last pass no entry is written"
    assert entries(done, "escalated")[0]["text"] == f"Incident #{inc['number']} escalated to Tomasz Reyes"
    assert entries(done, "escalated")[0]["actor"] == "Switchlamp"
    assert at(entries(done, "escalated")[0]["at"]) == opened + timedelta(minutes=30)

    jump = make_desk(admin, "Ines Varga", "Tomasz Reyes", repeats=2)
    leap = drill(admin, jump.sid)
    start = clock.now()
    clock.advance(7200)
    walked = incident(admin, leap["id"])
    assert (walked["level"], walked["cycle"]) == (1, 2)
    stamps = [at(e["at"]) for e in entries(walked, "escalated")]
    assert stamps == [start + timedelta(minutes=m) for m in (30, 60, 90, 120)], "each step stamped with its deadline"

    empty = must(admin.post("/api/schedules", {"name": tag("Empty"), "zone": "America/Chicago"}), 201)
    skip = make_desk(admin, empty, "Tomasz Reyes")
    skipped = drill(admin, skip.sid)
    assert skipped["level"] == 2 and [h["name"] for h in skipped["holders"]] == ["Tomasz Reyes"]
    assert skipped["countdown"]["remaining_seconds"] == THIRTY_MINUTES, "level 2's timeout runs from the same second"


def test_wf_escalation_walk_two_tabs_and_reload(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga", "Tomasz Reyes", timeout=30)
    inc = drill(admin, desk.sid)
    long_desk = make_desk(admin, "Ines Varga", timeout=120)
    long_inc = drill(admin, long_desk.sid)
    with screen(browser, app_url, INES) as one, screen(browser, app_url, SUNNIVA,
                                                       device_time=WRONG_DEVICE_TIME) as two:
        one.goto(f"/incidents/{inc['id']}")
        two.goto(f"/incidents/{inc['id']}")
        for page in (one, two):
            expect(named(page, "timer", "Incident countdown")).to_have_text("30:00")
            expect(named(page, "region", "Holder")).to_contain_text("Ines Varga")
        clock.advance(61)
        for page in (one, two):
            expect(named(page, "timer", "Incident countdown")).to_have_text(mmss(THIRTY_MINUTES - 61), timeout=LIVE_MS)
            expect(named(page, "region", "Holder")).to_have_attribute("data-remaining-seconds", str(THIRTY_MINUTES - 61),
                                                                      timeout=LIVE_MS)
        assert holder_data(one) == holder_data(two)
        two.reload()
        expect(named(two, "timer", "Incident countdown")).to_have_text(mmss(THIRTY_MINUTES - 61))
        clock.advance(THIRTY_MINUTES - 61)
        for page in (one, two):
            expect(named(page, "region", "Holder")).to_have_attribute("data-level", "2", timeout=LIVE_MS)
            expect(named(page, "region", "Holder")).to_contain_text("Tomasz Reyes", timeout=LIVE_MS)
            expect(named(page, "timer", "Incident countdown")).to_have_text("30:00", timeout=LIVE_MS)
        assert holder_data(one) == holder_data(two)
        api_view = incident(admin, inc["id"])
        assert str(api_view["countdown"]["remaining_seconds"]) == holder_data(one)["remaining-seconds"]
        assert str(api_view["level"]) == holder_data(one)["level"] and str(api_view["cycle"]) == holder_data(one)["cycle"]
        two.goto(f"/incidents/{long_inc['id']}")
        expect(named(two, "timer", "Incident countdown")).to_have_text(re.compile(r"^1:\d\d:\d\d$"))
        walk = make_desk(admin, "Ines Varga", "Tomasz Reyes", timeout=30, repeats=1)
        walking = drill(admin, walk.sid)
        two.goto(f"/incidents/{walking['id']}")
        expect(named(two, "timer", "Incident countdown")).to_have_text("30:00")
        clock.advance(THIRTY_MINUTES * 2)
        lines = [f"Incident #{walking['number']} escalated to Tomasz Reyes",
                 f"Incident #{walking['number']} escalated to Ines Varga"]
        announced(two, lines[1], LIVE_MS)
        said = live(two).text_content()
        assert [said.count(x) for x in lines] == [1, 1], f"each announced once: {said!r}"
        assert said.index(lines[0]) < said.index(lines[1]), "in the order the timers fell due"
        expect(named(two, "timer", "Incident countdown")).to_have_text("30:00", timeout=LIVE_MS)
        expect(named(two, "region", "Holder")).to_have_attribute("data-cycle", "1", timeout=LIVE_MS)


def test_wf_escalation_walk_operator_clock_control(browser: Browser, app_url: str, admin: Api, lead: Api) -> None:
    clock_ = Clock(admin)
    try:
        clock_.thaw()
        with screen(browser, app_url, ROWAN) as page:
            page.goto("/admin")
            region = named(page, "region", "Operator clock")
            named(region, "checkbox", "Hold clock").check()
            wait_for(lambda: must(admin.get("/api/clock"))["frozen"] is True, "Hold clock froze the server clock")
            held_at = clock_.now()
            shown = held_at.strftime("%Y-%m-%d") + r".*" + held_at.strftime("%H:%M:%S")
            expect(region).to_contain_text(re.compile(shown), timeout=LIVE_MS)
            mark = time.monotonic()
            wait_for(lambda: time.monotonic() - mark > 1.5, "real time to pass", 5)
            assert clock_.now() == held_at, "a held clock stands still"
            named(region, "spinbutton", "Advance by seconds").fill("60")
            named(region, "button", "Advance clock").click()
            moved = held_at + timedelta(seconds=60)
            announced(page, f"Clock moved to {iso(moved)}.", LIVE_MS * 2)
            assert clock_.now() == moved
            named(region, "checkbox", "Hold clock").uncheck()
            wait_for(lambda: must(admin.get("/api/clock"))["frozen"] is False, "unticking released the clock")
        wait_for(lambda: clock_.now() > moved, "a released clock runs on from that value", 5)
        clock_.freeze()
        backwards = admin.post("/api/operator/clock", {"set_to": iso(clock_.now() - timedelta(hours=1))})
        assert backwards.status_code == 422
        assert backwards.json() == {"errors": {"set_to": "The clock only moves forward."}}
        before = must(admin.get("/api/clock"))
        assert admin.post("/api/operator/clock", {"advance_seconds": 0}).status_code == 422
        assert admin.post("/api/operator/clock", {"advance_seconds": YEAR_SECONDS + 1}).status_code == 422
        answer = lead.post("/api/operator/clock", {"advance_seconds": 5})
        assert answer.status_code == 403 and answer.json() == {"error": "forbidden"}
        assert must(admin.get("/api/clock"))["now"] == before["now"]
        forward = must(admin.post("/api/operator/clock", {"set_to": iso(at(before["now"]) + timedelta(seconds=90))}))
        assert forward["now"] == iso(at(before["now"]) + timedelta(seconds=90)) and forward["frozen"] is True
    finally:
        clock_.thaw()


def test_nobody_on_whole_policy(app_url: str, admin: Api) -> None:
    empty = must(admin.post("/api/schedules", {"name": tag("Empty"), "zone": "America/Chicago"}), 201)
    desk = make_desk(admin, empty)
    send(app_url, desk.rk, key="nobody")
    row_ = wait_log(admin, desk.iid, "Nobody is on call on this policy, so no incident opened.", "Dropped", "nobody")
    assert row_["incident_number"] is None
    assert not listed(admin, desk.sid), "no alert or incident opens"
    answer = admin.post("/api/operator/drill", {"service_id": desk.sid, "summary": "x", "severity": "critical"})
    assert answer.status_code == 409 and answer.json() == {"error": "nobody_on_call"}


def test_policy_limits(admin: Api, lead: Api, app_url: str) -> None:
    people = roster(admin)
    ines = {"type": "person", "id": people["Ines Varga"]}
    tomasz = {"type": "person", "id": people["Tomasz Reyes"]}
    refusals = [
        ({"levels": [{"timeout_minutes": 0, "targets": [ines]}]}, "timeout_minutes",
         "Use at least 1 minute with one target."),
        ({"levels": [{"timeout_minutes": 2, "targets": [ines, tomasz]}]}, "timeout_minutes",
         "Use at least 3 minutes with several targets."),
        ({"repeats": 10, "levels": [{"targets": [ines]}]}, "repeats", "A policy repeats at most 9 times."),
        ({"levels": []}, "levels", "A policy has 1 to 20 levels."),
        ({"levels": [{"targets": [ines]}] * 21}, "levels", "A policy has 1 to 20 levels."),
        ({"levels": [{"targets": []}]}, "targets", "A level has 1 to 10 targets."),
        ({"levels": [{"timeout_minutes": 30, "targets": [ines] * 11}]}, "targets", "A level has 1 to 10 targets."),
    ]
    for change, field, sentence in refusals:
        answer = lead.post("/api/policies", {"name": tag("Refused")} | change)
        assert answer.status_code == 422, change
        assert answer.json() == {"errors": {field: sentence}}
    for allowed in (
        {"levels": [{"timeout_minutes": 1, "targets": [ines]}]},
        {"levels": [{"timeout_minutes": 3, "targets": [ines, tomasz]}]},
        {"repeats": 9, "levels": [{"targets": [ines]}]},
        {"levels": [{"targets": [ines]}] * 20},
    ):
        must(lead.post("/api/policies", {"name": tag("Allowed")} | allowed), 201)
    default = must(lead.post("/api/policies", {"name": tag("Default"), "levels": [{"targets": [ines]}]}), 201)
    assert default["repeats"] == 0 and default["levels"][0]["timeout_minutes"] == 30
    responder = Api(app_url, TOMASZ)
    assert responder.post("/api/policies", {"name": "x", "levels": [{"targets": [ines]}]}).status_code == 403


def test_wf_policy_editor_stale_save_refused(browser: Browser, app_url: str, admin: Api, lead: Api) -> None:
    desk = make_desk(admin, "Ines Varga", "Tomasz Reyes")
    pid = desk.policy["id"]
    record = must(lead.get(f"/api/policies/{pid}"))
    body = {"name": record["name"], "repeats": record["repeats"], "levels": [
        {"timeout_minutes": lv["timeout_minutes"], "targets": [{"type": t["type"], "id": t["id"]} for t in lv["targets"]]}
        for lv in record["levels"]]}
    assert lead.put(f"/api/policies/{pid}", body).json() == {"error": "version_required"}
    with screen(browser, app_url, DARIO) as page:
        page.goto(f"/policies/{pid}")
        expect(named(page, "list", "Levels")).to_be_visible()
        saved = must(lead.put(f"/api/policies/{pid}", body | {"repeats": 3}, record["version"]))
        assert saved["version"] > record["version"]
        stale = lead.put(f"/api/policies/{pid}", body | {"repeats": 5}, record["version"])
        assert stale.status_code == 412 and stale.json()["error"] == "version_conflict"
        assert stale.json()["current"]["repeats"] == 3
        named(page, "spinbutton", "Repeats").fill("7")
        named(page, "button", "Save policy").click()
        announced(page, "Someone saved a newer version. Reload to see it.", LIVE_MS * 2)
    assert must(lead.get(f"/api/policies/{pid}"))["repeats"] == 3, "the losing save changed nothing"


def test_wf_policy_editor_running_keeps_version(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga", "Tomasz Reyes", timeout=30)
    old = drill(admin, desk.sid)
    version = old["policy_snapshot"]["version"]
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/policies/{desk.policy['id']}")
        named(page, "spinbutton", "Timeout for level 1").fill("10")
        named(page, "button", "Save policy").click()
        expect(named(page, "region", "Policy notice")).to_have_text(
            f"1 running incidents keep version {version}. Version {version + 1} applies to later incidents.",
            timeout=LIVE_MS * 2)
    new = drill(admin, desk.sid)
    assert new["policy_snapshot"]["version"] == version + 1
    assert new["policy_snapshot"]["levels"][0]["timeout_minutes"] == 10
    kept = incident(admin, old["id"])
    assert kept["policy_snapshot"]["version"] == version
    assert kept["policy_snapshot"]["levels"][0]["timeout_minutes"] == 30
    clock.advance(600)
    assert incident(admin, new["id"])["level"] == 2, "the later incident uses the edit"
    assert incident(admin, old["id"])["level"] == 1, "the running incident stays on the old timeout"
    clock.advance(1200)
    assert incident(admin, old["id"])["level"] == 2
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/incidents/{old['id']}")
        expect(named(page, "region", "Opened-with policy")).to_contain_text(desk.policy["name"])


def test_wf_policy_editor_drag_and_keyboard(browser: Browser, app_url: str, admin: Api, lead: Api) -> None:
    def three_levels() -> dict:
        return make_policy(admin, [(10, ["Ines Varga"]), (20, ["Tomasz Reyes"]), (30, ["Priya Lindqvist"])])

    dragged, typed = three_levels(), three_levels()
    expected = [20, 30, 10]
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/policies/{dragged['id']}")
        levels = named(page, "list", "Levels")
        expect(levels.get_by_role("listitem")).to_have_count(3)
        handle = named(page, "button", "Move level 1")
        handle.scroll_into_view_if_needed()
        start = handle.bounding_box()
        drop = levels.get_by_role("listitem").nth(2).bounding_box()
        page.mouse.move(start["x"] + start["width"] / 2, start["y"] + start["height"] / 2)
        page.mouse.down()
        page.mouse.move(drop["x"] + drop["width"] / 2, drop["y"] + drop["height"] / 2, steps=12)
        page.mouse.move(drop["x"] + drop["width"] / 2, drop["y"] + drop["height"] * 0.75, steps=3)
        page.mouse.up()
        expect(named(page, "spinbutton", "Timeout for level 3")).to_have_value("10", timeout=LIVE_MS)
        assert [lv["timeout_minutes"] for lv in must(lead.get(f"/api/policies/{dragged['id']}"))["levels"]] == [
            10, 20, 30], "nothing is stored until Save policy"
        named(page, "button", "Save policy").click()
        wait_for(lambda: [lv["timeout_minutes"] for lv in must(lead.get(f"/api/policies/{dragged['id']}"))["levels"]]
                 == expected, "the drag saved the reordered levels")

        page.goto(f"/policies/{typed['id']}")
        named(page, "button", "Move level 1").focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        announced(page, "Level moved to position 2.")
        expect(named(page, "button", "Move level 2")).to_be_focused()
        page.keyboard.press("Escape")
        expect(named(page, "spinbutton", "Timeout for level 1")).to_have_value("10")
        expect(named(page, "button", "Move level 1")).to_be_focused()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        announced(page, "Level moved to position 3.")
        expect(named(page, "button", "Move level 3")).to_be_focused()
        page.keyboard.press("Space")
        expect(live(page)).to_contain_text("Level moved to position 3.")
        named(page, "button", "Save policy").click()
        wait_for(lambda: [lv["timeout_minutes"] for lv in must(lead.get(f"/api/policies/{typed['id']}"))["levels"]]
                 == expected, "the keyboard path saved the reordered levels")
    one, two = must(lead.get(f"/api/policies/{dragged['id']}")), must(lead.get(f"/api/policies/{typed['id']}"))
    assert one["levels"] == two["levels"], "both ways save the same record"


def test_final_schedule_layers_overrides_gaps(admin: Api, clock: Clock) -> None:
    people = roster(admin)
    now = clock.now()
    start_day = (now + timedelta(days=30)).date()
    schedule = make_schedule(admin, "Asia/Kolkata", ["Ines Varga", "Tomasz Reyes"], "08:00", 1, start_day.isoformat())
    sid = schedule["id"]
    offset = timedelta(hours=5, minutes=30)

    def local(day: date, hour: int, minute: int = 0) -> datetime:
        return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc) - offset

    weekday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][start_day.weekday()]
    must(admin.post(f"/api/schedules/{sid}/layers", {
        "name": "Upper", "order": 2, "shift_days": 7, "handoff_time": "00:00",
        "start_date": (start_day - timedelta(days=1)).isoformat(), "people": [people["Priya Lindqvist"]],
        "restrictions": [{"days": [weekday], "start": "22:00", "end": "02:00"}],
    }), 201)
    must(admin.post(f"/api/schedules/{sid}/overrides", {
        "person_id": people["Mateus Oyelaran"], "start": iso(local(start_day, 12)), "end": iso(local(start_day, 13)),
    }), 201)
    must(admin.post(f"/api/schedules/{sid}/overrides", {
        "person_id": None, "start": iso(local(start_day, 15)), "end": iso(local(start_day, 15, 30)),
    }), 201)
    begin, end = local(start_day, 0), local(start_day + timedelta(days=2), 0)
    data = final(admin, sid, begin, end)
    blocks = data["blocks"]
    assert data["zone"] == "Asia/Kolkata"
    assert at(blocks[0]["start"]) == begin and at(blocks[-1]["end"]) == end
    for one, two in zip(blocks, blocks[1:]):
        assert one["end"] == two["start"], "blocks must touch, one person or a gap at every moment"
        assert (person_of(one), one["source"]) != (person_of(two), two["source"]), "a block runs change to change"
    for b in blocks:
        assert b["minutes"] == (at(b["end"]) - at(b["start"])).total_seconds() / 60
        if b["person"] is None:
            assert b["gap"] is True and b["source"] == "gap"
    assert holder_at(blocks, local(start_day, 7)) is None, "before start_date's handoff the layer has no holder"
    assert holder_at(blocks, local(start_day, 8)) == "Ines Varga"
    assert holder_at(blocks, local(start_day, 12)) == "Mateus Oyelaran", "overrides replace everything"
    assert holder_at(blocks, local(start_day, 13)) == "Ines Varga"
    assert holder_at(blocks, local(start_day, 15, 15)) is None, "a null override is a deliberate gap"
    assert holder_at(blocks, local(start_day, 22)) == "Priya Lindqvist", "the higher layer sits above"
    second = start_day + timedelta(days=1)
    assert holder_at(blocks, local(second, 1, 59)) == "Priya Lindqvist", "a restriction crossing midnight keeps running"
    assert holder_at(blocks, local(second, 2)) == "Ines Varga", "the end second is excluded"
    assert holder_at(blocks, local(second, 8)) == "Tomasz Reyes"
    too_far = admin.get(f"/api/schedules/{sid}/final", params={"from": iso(begin), "to": iso(begin + timedelta(days=36))})
    assert too_far.status_code == 422 and too_far.json() == {"errors": {"to": "View at most 35 days."}}
    must(admin.get(f"/api/schedules/{sid}/final", params={"from": iso(begin), "to": iso(begin + timedelta(days=35))}))


def test_wf_final_timeline_seed_week_to_scale(browser: Browser, app_url: str, admin: Api) -> None:
    schedule = next(s for s in must(admin.get("/api/schedules"))["items"] if s["name"] == "Transport Primary")
    data = final(admin, schedule["id"], at("2027-03-13T14:00:00Z"), at("2027-03-14T13:00:00Z"))
    block = data["blocks"][0]
    assert (block["start"], block["end"], block["minutes"]) == ("2027-03-13T14:00:00Z", "2027-03-14T13:00:00Z", 1380)
    assert person_of(block) == "Ines Varga"
    after = final(admin, schedule["id"], at("2027-03-14T13:00:00Z"), at("2027-03-14T14:00:00Z"))
    assert person_of(after["blocks"][0]) == "Tomasz Reyes"
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/schedules/{schedule['id']}?from=2027-03-13&days=3&zone=America/Chicago")
        group = named(page, "group", "Final schedule")
        wait_for(lambda: block_rects(group), "the final row drawn with blocks", 10)
        shown = {r["start"]: r for r in block_rects(group)}["2027-03-13T14:00:00Z"]
        assert shown["minutes"] == DAY_23H and shown["person"] == "Ines Varga"
        assert_to_scale(block_rects(group))
        assert {b["date"]: b["minutes"] for b in band_widths(page)}["2027-03-14"] == DAY_23H


def test_layer_edit_changes_only_the_future(admin: Api, clock: Clock) -> None:
    people = roster(admin)
    now = clock.now()
    schedule = make_schedule(admin, "Asia/Kolkata", ["Ines Varga", "Tomasz Reyes"], "08:00", 1,
                             (now - timedelta(days=5)).date().isoformat())
    sid = schedule["id"]
    desk = make_desk(admin, schedule)
    past_incident = drill(admin, desk.sid)
    must(act(admin, past_incident["id"], "acknowledge"))
    holders_before = incident(admin, past_incident["id"])["holders"]
    clock.advance(3600)
    saved_at = clock.now()
    begin, future = saved_at - timedelta(days=3), saved_at + timedelta(days=4)
    past_before = final(admin, sid, begin, saved_at)["blocks"]
    sent = schedule["layer_sent"]
    layer = schedule_layer(admin, sid, sent["name"])
    body = {"name": sent["name"], "order": 1, "shift_days": 1, "handoff_time": "08:00",
            "start_date": sent["start_date"], "people": [people["Priya Lindqvist"]], "restrictions": []}
    assert admin.put(f"/api/schedules/{sid}/layers/{layer['id']}", body).status_code == 428
    must(admin.put(f"/api/schedules/{sid}/layers/{layer['id']}", body, layer["version"]))
    past_after = final(admin, sid, begin, saved_at)["blocks"]
    assert past_after == past_before, "past blocks never move"
    blocks = final(admin, sid, saved_at - timedelta(seconds=1), future)["blocks"]
    assert holder_at(blocks, saved_at - timedelta(seconds=1)) in ("Ines Varga", "Tomasz Reyes")
    assert holder_at(blocks, saved_at) == "Priya Lindqvist", "the edit takes effect from the second it is saved"
    assert holder_at(blocks, future - timedelta(hours=1)) == "Priya Lindqvist"
    assert incident(admin, past_incident["id"])["holders"] == holders_before, "past assignments never move"
    clock.advance(3600)
    assert final(admin, sid, begin, saved_at)["blocks"] == past_before


def test_wf_final_timeline_view_zone_in_address(browser: Browser, app_url: str, admin: Api) -> None:
    now = Clock(admin).now()
    schedule = make_schedule(admin, "America/Chicago", ["Ines Varga", "Tomasz Reyes"])
    sid = schedule["id"]
    day = plain_day(now)
    with screen(browser, app_url, SUNNIVA, zone="Asia/Tokyo") as page:
        page.goto(f"/schedules/{sid}?from={day.isoformat()}&days=7&zone=America/Chicago")
        group = named(page, "group", "Final schedule")
        expect(group.locator("[data-start]").first).to_be_visible()
        chicago_data = final(admin, sid, chicago(day, "00:00"), chicago(day + timedelta(days=7), "00:00"))
        bands = band_widths(page)
        assert [b["date"] for b in bands] == [d["date"] for d in chicago_data["days"]], "bands follow the viewed zone"
        interior = {b["start"] for b in chicago_data["blocks"]} - {iso(chicago(day, "00:00"))}
        before = page.url
        zone_box = named(page, "combobox", "View zone")
        select(zone_box, "Asia/Kolkata")
        expect(page).to_have_url(re.compile(r"zone=Asia(/|%2F)Kolkata"), timeout=LIVE_MS)
        expect(zone_box).to_be_focused()
        start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) - timedelta(hours=5, minutes=30)
        kolkata = final(admin, sid, start, start + timedelta(days=7), "Asia/Kolkata")
        assert kolkata["zone"] == "Asia/Kolkata"
        wait_for(lambda: [b["date"] for b in band_widths(page)] == [d["date"] for d in kolkata["days"]],
                 "every day band redrawn in the chosen zone", 5)
        drawn = {r["start"] for r in block_rects(group)}
        shared = interior & {b["start"] for b in kolkata["blocks"]}
        assert shared and shared <= drawn, "data-start stays the same instants when the zone changes"
        page.go_back()
        expect(page).to_have_url(before)
        page.reload()
        expect(page.locator(f'[data-date="{day.isoformat()}"]')).to_be_visible()
        assert parse_qs(urlparse(page.url).query)["zone"] == ["America/Chicago"]
        next_week = named(page, "button", "Next week")
        next_week.click()
        expect(page).to_have_url(re.compile(rf"from={(day + timedelta(days=7)).isoformat()}"), timeout=LIVE_MS)


def cut_schedule(admin: Api, now: datetime) -> SimpleNamespace:
    schedule = make_schedule(admin, "America/Chicago", ["Ines Varga", "Tomasz Reyes"])
    day = plain_day(now)
    blocks = final(admin, schedule["id"], chicago(day, "00:00"), chicago(day + timedelta(days=1), "00:00"))["blocks"]
    return SimpleNamespace(id=schedule["id"], day=day, url=f"/schedules/{schedule['id']}?from={day.isoformat()}"
                           "&days=1&zone=America/Chicago", early=person_of(blocks[0]), late=person_of(blocks[-1]))


def test_wf_overrides_gaps_cut_by_pointer(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    plan = cut_schedule(admin, clock.now())
    day = plan.day
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(plan.url)
        group = named(page, "group", "Final schedule")
        expect(group.locator("[data-start]").first).to_be_visible()
        rects = block_rects(group)
        assert_to_scale(rects)
        press_x, y = x_of(rects, chicago(day, "07:03"))
        far_x, _ = x_of(rects, chicago(day, "09:12"))
        back_x, _ = x_of(rects, chicago(day, "06:12"))
        anchor_x, _ = x_of(rects, chicago(day, "07:00"))
        page.mouse.move(press_x, y)
        expect(page.get_by_text("Cut here", exact=True)).to_be_visible(timeout=LIVE_MS)
        page.mouse.down()
        page.mouse.move(far_x, y, steps=8)
        expect(page.get_by_text(cut_tab("09:15", 135), exact=True)).to_be_visible(timeout=LIVE_MS)
        preview = named(page, "region", "Cut preview")
        expect(preview).to_have_text(f"{lost(plan.early, 60)}, {lost(plan.late, 75)}; {CLEAN_CUT}")
        pieces = [r for r in block_rects(group) if r["preview"]]
        assert {r["person"] for r in pieces} >= {plan.early, plan.late}, "each piece keeps its person's name"
        assert_to_scale(block_rects(group))
        page.mouse.move(back_x, y, steps=8)
        expect(page.get_by_text(cut_tab("06:15", 45), exact=True)).to_be_visible(timeout=LIVE_MS)
        expect(preview).to_have_text(f"{lost(plan.early, 45)}; {CLEAN_CUT}")
        page.keyboard.press("Escape")
        page.mouse.up()
        wait_for(lambda: not [r for r in block_rects(group) if r["preview"]], "Escape restored the prior blocks", 3)
        assert not override_blocks(admin, plan.id, chicago(day, "00:00")), "a cancelled cut saves nothing"
        page.mouse.move(press_x, y)
        page.mouse.down()
        page.mouse.up()
        assert not override_blocks(admin, plan.id, chicago(day, "00:00")), "releasing on the anchor cancels"
        page.mouse.move(anchor_x, y)
        page.mouse.down()
        page.mouse.move(far_x, y, steps=8)
        expect(page.get_by_text(cut_tab("09:15", 135), exact=True)).to_be_visible(timeout=LIVE_MS)
        page.mouse.up()
        announced(page, f"Override saved: Sunniva Okoye from {chicago_label(day, '07:00')} "
                        f"to {chicago_label(day, '09:15')}.", LIVE_MS * 2)
        wait_for(lambda: any(r["source"] == "override" and r["start"] == iso(chicago(day, "07:00"))
                             and r["end"] == iso(chicago(day, "09:15")) for r in block_rects(group)),
                 "the saved override drawn on the final row", 3)
        expect(group.locator('[data-preview="true"]')).to_have_count(0, timeout=LIVE_MS)
    saved = override_blocks(admin, plan.id, chicago(day, "00:00"))
    assert len(saved) == 1 and person_of(saved[0]) == "Sunniva Okoye"
    assert (at(saved[0]["start"]), at(saved[0]["end"])) == (chicago(day, "07:00"), chicago(day, "09:15"))


def test_wf_overrides_gaps_cut_by_keyboard_and_form(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    plan = cut_schedule(admin, clock.now())
    day = plan.day
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(plan.url)
        group = named(page, "group", "Final schedule")
        expect(group.locator("[data-start]").first).to_be_visible()
        tab_until_focused(page, group)
        for _ in range(28):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        for _ in range(9):
            page.keyboard.press("ArrowRight")
        expect(page.get_by_text(cut_tab("09:15", 135), exact=True)).to_be_visible(timeout=LIVE_MS)
        expect(named(page, "region", "Cut preview")).to_have_text(
            f"{lost(plan.early, 60)}, {lost(plan.late, 75)}; {CLEAN_CUT}")
        expect(group).to_be_focused()
        page.keyboard.press("Escape")
        expect(group.locator('[data-preview="true"]')).to_have_count(0)
        assert not override_blocks(admin, plan.id, chicago(day, "00:00")), "Escape cancels the keyboard cut"
        page.reload()
        expect(group.locator("[data-start]").first).to_be_visible()
        tab_until_focused(page, group)
        for _ in range(28):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        for _ in range(9):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        announced(page, f"Override saved: Sunniva Okoye from {chicago_label(day, '07:00')} "
                        f"to {chicago_label(day, '09:15')}.", LIVE_MS * 2)
        expect(group).to_be_focused()
    keyed = override_blocks(admin, plan.id, chicago(day, "00:00"))
    assert [(b["start"], b["end"]) for b in keyed] == [(iso(chicago(day, "07:00")), iso(chicago(day, "09:15")))]

    other = cut_schedule(admin, clock.now())
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(other.url)
        opener = named(page, "button", "Schedule an override")
        opener.click()
        dialog = named(page, "dialog", "Schedule an override")
        expect(dialog).to_be_visible()
        cancel = named(dialog, "button", "Cancel")
        cancel.focus()
        for _ in range(8):
            page.keyboard.press("Tab")
            assert dialog.evaluate("(d) => d.contains(document.activeElement)"), "Tab must wrap inside the dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        opener.click()
        named(dialog, "textbox", "Starts").fill("tomorrow")
        named(dialog, "textbox", "Ends").fill(f"{day.isoformat()} 09:15")
        named(dialog, "button", "Save override").click()
        problems = named(page, "alert", "Problems to fix")
        expect(problems).to_contain_text("Use the format YYYY-MM-DD HH:MM.")
        named(dialog, "textbox", "Starts").fill(f"{day.isoformat()} 07:07")
        named(dialog, "button", "Save override").click()
        expect(problems).to_contain_text("Overrides start and end on a 15-minute step.")
        named(dialog, "textbox", "Starts").fill(f"{day.isoformat()} 07:00")
        select(named(dialog, "combobox", "Person"), "Sunniva Okoye")
        named(dialog, "button", "Save override").click()
        announced(page, f"Override saved: Sunniva Okoye from {chicago_label(day, '07:00')} "
                        f"to {chicago_label(day, '09:15')}.", LIVE_MS * 2)
    formed = override_blocks(admin, other.id, chicago(day, "00:00"))
    assert [(b["start"], b["end"], person_of(b)) for b in formed] == [
        (b["start"], b["end"], "Sunniva Okoye") for b in keyed], "the form gives the same result"

    people = roster(admin)
    path = f"/api/schedules/{other.id}/overrides"
    base = chicago(day + timedelta(days=2), "07:00")
    me = people["Sunniva Okoye"]
    preview = must(admin.post(f"{path}/preview", {"person_id": None, "start": iso(base), "end": iso(base + timedelta(hours=1))}))
    assert preview["gap_minutes"] == 60 and preview["summary"].endswith("gap of 60 minutes; no overlap.")
    assert not override_blocks(admin, other.id, chicago(day + timedelta(days=2), "00:00")), "a preview saves nothing"
    refusals = [
        ({"start": iso(base + timedelta(minutes=7)), "end": iso(base + timedelta(hours=1))}, "start",
         "Overrides start and end on a 15-minute step."),
        ({"start": iso(base), "end": iso(base)}, "end", "An override must end after it starts."),
        ({"start": iso(base), "end": iso(base + timedelta(days=14, minutes=15))}, "end",
         "An override lasts at most 14 days."),
    ]
    for change, field, sentence in refusals:
        answer = admin.post(path, {"person_id": me} | change)
        assert answer.status_code == 422, change
        assert answer.json() == {"errors": {field: sentence}}
    past = (clock.now() - timedelta(hours=2)).replace(minute=0, second=0)
    answer = admin.post(path, {"person_id": me, "start": iso(past), "end": iso(past + timedelta(hours=1))})
    assert answer.status_code == 422 and answer.json() == {"errors": {"start": "Overrides cannot change the past."}}
    must(admin.post(path, {"person_id": me, "start": iso(base), "end": iso(base + timedelta(days=14))}), 201)


def test_wf_overrides_gaps_refused_cut_on_two_screens(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    plan = cut_schedule(admin, clock.now())
    day = plan.day
    people = roster(admin)
    path = f"/api/schedules/{plan.id}/overrides"
    dario = must(admin.post(path, {"person_id": people["Dario Mbeki"], "start": iso(chicago(day, "10:00")),
                                   "end": iso(chicago(day, "11:00"))}), 201)
    assert dario["override"]["person"]
    with screen(browser, app_url, SUNNIVA) as page, screen(browser, app_url, DARIO) as other:
        page.goto(plan.url)
        other.goto(plan.url)
        group = named(page, "group", "Final schedule")
        other_group = named(other, "group", "Final schedule")
        expect(group.locator("[data-start]").first).to_be_visible()
        expect(other_group.locator("[data-start]").first).to_be_visible()
        before = [(r["start"], r["person"]) for r in block_rects(group)]
        rects = block_rects(group)
        start_x, y = x_of(rects, chicago(day, "09:00"))
        over_x, _ = x_of(rects, chicago(day, "10:27"))
        page.mouse.move(start_x, y)
        page.mouse.down()
        page.mouse.move(over_x, y, steps=8)
        expect(named(page, "region", "Cut preview")).to_contain_text("overlaps Dario Mbeki's override",
                                                                     timeout=LIVE_MS)
        page.mouse.up()
        reason = (f"Cut refused: Dario Mbeki already has an override from {chicago_label(day, '10:00')} "
                  f"to {chicago_label(day, '11:00')}.")
        announced(page, reason, LIVE_MS * 2)
        wait_for(lambda: [(r["start"], r["person"]) for r in block_rects(group)] == before,
                 "the refused cut settled back to the prior blocks", 10)
        wait_for(lambda: group.evaluate("(g) => g.getAnimations({subtree: true}).length === 0"), "the settle finished", 10)
        assert len(override_blocks(admin, plan.id, chicago(day, "00:00"))) == 1, "a refused cut saves nothing"
        rects = block_rects(group)
        start_x, y = x_of(rects, chicago(day, "13:00"))
        end_x, _ = x_of(rects, chicago(day, "14:00"))
        page.mouse.move(start_x, y)
        page.mouse.down()
        page.mouse.move(end_x, y, steps=8)
        expect(page.get_by_text(cut_tab("14:00", 60), exact=True)).to_be_visible(timeout=LIVE_MS)
        page.mouse.up()
        wait_for(lambda: any(r["source"] == "override" and r["start"] == iso(chicago(day, "13:00"))
                             and r["person"] == "Sunniva Okoye" for r in block_rects(other_group)),
                 "the saved override drawn on the other screen", 3)
    overlap = admin.post(path, {"person_id": people["Ines Varga"], "start": iso(chicago(day, "10:30")),
                                "end": iso(chicago(day, "11:30"))})
    assert overlap.status_code == 409
    assert overlap.json() == {"error": "override_overlap", "message": reason,
                              "overlaps": overlap.json()["overlaps"]}
    assert overlap.json()["overlaps"]["start"] == iso(chicago(day, "10:00"))
    must(admin.post(path, {"person_id": people["Ines Varga"], "start": iso(chicago(day, "11:00")),
                           "end": iso(chicago(day, "11:30"))}), 201)
    key = uuid.uuid4().hex
    body = {"person_id": people["Ines Varga"], "start": iso(chicago(day, "16:00")), "end": iso(chicago(day, "16:30"))}
    one = must(admin.post(path, body, headers={"Idempotency-Key": key}), 201)
    two = admin.post(path, body, headers={"Idempotency-Key": key})
    assert two.status_code == 201 and two.json()["override"]["id"] == one["override"]["id"]
    conflict = admin.post(path, body | {"end": iso(chicago(day, "16:45"))}, headers={"Idempotency-Key": key})
    assert conflict.status_code == 409 and conflict.json() == {"error": "idempotency_conflict"}


def test_wf_overrides_gaps_clock_change_week(browser: Browser, app_url: str, admin: Api) -> None:
    now = Clock(admin).now()
    spring, fall = next_change(now, True), next_change(now, False)
    schedule = make_schedule(admin, "America/Chicago", ["Ines Varga", "Tomasz Reyes"])
    sid = schedule["id"]

    def handoffs(schedule_id: str, day: date) -> list[str]:
        start = chicago(day - timedelta(days=1), "00:00")
        end = chicago(day + timedelta(days=2), "00:00")
        return [b["end"] for b in final(admin, schedule_id, start, end)["blocks"]][:-1]

    assert iso(chicago(spring - timedelta(days=1), "08:00")) in handoffs(sid, spring)
    assert iso(chicago(spring, "08:00")) in handoffs(sid, spring), "08:00 stays 08:00 after the jump"
    assert iso(chicago(fall, "08:00")) in handoffs(sid, fall)
    block = next(b for b in final(admin, sid, chicago(spring - timedelta(days=1), "00:00"),
                                  chicago(spring + timedelta(days=1), "00:00"))["blocks"]
                 if b["end"] == iso(chicago(spring, "08:00")))
    assert block["minutes"] == DAY_23H, "the block across the change measures 23 hours"
    days = {d["date"]: d["minutes"] for d in final(admin, sid, chicago(spring, "00:00"),
                                                   chicago(spring + timedelta(days=1), "00:00"))["days"]}
    assert days[spring.isoformat()] == DAY_23H
    days = {d["date"]: d["minutes"] for d in final(admin, sid, chicago(fall, "00:00"),
                                                   chicago(fall + timedelta(days=1), "00:00"))["days"]}
    assert days[fall.isoformat()] == DAY_25H
    missing = make_schedule(admin, "America/Chicago", ["Ines Varga", "Tomasz Reyes"], "02:30")["id"]
    jump = datetime(spring.year, spring.month, spring.day, 8, 0, tzinfo=timezone.utc)
    assert iso(jump) in handoffs(missing, spring), "02:30 that does not exist becomes 03:00"
    twice = make_schedule(admin, "America/Chicago", ["Ines Varga", "Tomasz Reyes"], "01:30")["id"]
    first_hit = datetime(fall.year, fall.month, fall.day, 6, 30, tzinfo=timezone.utc)
    assert iso(first_hit) in handoffs(twice, fall), "a repeated 01:30 takes its first occurrence"
    with screen(browser, app_url, SUNNIVA) as page:
        for change, minutes in ((spring, DAY_23H), (fall, DAY_25H)):
            start = change - timedelta(days=1)
            page.goto(f"/schedules/{sid}?from={start.isoformat()}&days=3&zone=America/Chicago")
            expect(page.locator(f'[data-date="{change.isoformat()}"]')).to_have_attribute("data-minutes", str(minutes))
            bands = {b["date"]: b for b in band_widths(page)}
            normal, odd = bands[start.isoformat()], bands[change.isoformat()]
            assert normal["minutes"] == DAY_NORMAL
            assert abs(odd["width"] / normal["width"] - minutes / DAY_NORMAL) < 0.01, "one scale for every day"
            assert_to_scale(block_rects(named(page, "group", "Final schedule")))


def test_refused_removal_lists_what_breaks(browser: Browser, app_url: str, admin: Api) -> None:
    make_policy(admin, [(30, ["Priya Lindqvist"])])
    answer = admin.delete(f"/api/users/{roster(admin)['Priya Lindqvist']}")
    assert answer.status_code == 409
    body = answer.json()
    assert body["error"] == "still_needed"
    breaks = body["breaks"]
    policies = [b for b in breaks if "policy" in b]
    shifts = [b for b in breaks if "schedule" in b]
    assert {"policy": "Portal escalation", "level": 1} in policies
    assert any(b["schedule"] == "Transport Primary" for b in shifts), "her future shifts within 60 days are listed"
    assert breaks == shifts + policies, "schedules come before policies"
    assert all(set(b) == {"schedule", "start", "end"} for b in shifts)
    Api(app_url, PRIYA)
    with screen(browser, app_url, ROWAN) as page:
        page.goto("/admin")
        button = named(page, "button", "Remove Priya Lindqvist")
        button.click()
        announced(page, "Priya Lindqvist cannot be removed yet.", LIVE_MS * 2)
        lines = named(page, "list", "What this removal breaks")
        expect(lines).to_contain_text("Portal escalation: level 1")
        expect(lines.get_by_role("listitem").filter(has_text="Transport Primary").first).to_have_text(
            re.compile(r"^Transport Primary: \d{4}-\d\d-\d\d \d\d:\d\d \S+ to \d{4}-\d\d-\d\d \d\d:\d\d \S+$"))
        expect(button).to_be_focused()
    assert "Priya Lindqvist" in roster(admin)


def test_wf_oncall_cache_handoff_second(browser: Browser, app_url: str, admin: Api, clock: Clock, valkey: Any) -> None:
    schedule = make_schedule(admin, "Asia/Kolkata", ["Ines Varga", "Tomasz Reyes"], "08:00", 1, "2026-01-05")
    sid = schedule["id"]
    params = {"schedule_id": sid}
    first = admin.get("/api/oncall", params=params)
    data = must(first)
    assert first.headers["X-Switchlamp-Cache"] in ("hit", "miss")
    assert data["schedule"]["id"] == sid and data["gap"] is False and data["holder"]["name"]
    second = admin.get("/api/oncall", params=params)
    assert second.headers["X-Switchlamp-Cache"] == "hit" and second.json()["holder"] == data["holder"]
    stored = valkey.hash(f"switchlamp:{INSTANCE}:cache:oncall:{sid}")
    assert stored.get("etag") and stored.get("body"), "the cached copy lives in Valkey"
    assert 0 < valkey.ttl(f"switchlamp:{INSTANCE}:cache:oncall:{sid}") <= CACHE_TTL_MAX
    same = admin.get("/api/oncall", params=params, headers={"If-None-Match": second.headers["ETag"]})
    assert same.status_code == 304 and not same.content
    holder, until = data["holder"]["name"], at(data["until"])
    other = "Tomasz Reyes" if holder == "Ines Varga" else "Ines Varga"
    with screen(browser, app_url, TOMASZ, device_time=WRONG_DEVICE_TIME) as page, screen(
        browser, app_url, INES, width=375, height=812, touch=True, spy=True
    ) as phone:
        page.goto("/oncall")
        select(named(page, "combobox", "Schedule"), schedule["name"])
        region = named(page, "region", "On call now")
        expect(region).to_contain_text(holder)
        phone.goto("/oncall")
        select(named(phone, "combobox", "Schedule"), schedule["name"])
        phone_region = named(phone, "region", "On call now")
        expect(phone_region).to_contain_text(holder)
        page_fits(phone)
        clock.to(until - timedelta(seconds=1))
        expect(named(page, "timer", "Handoff countdown")).to_have_text(re.compile(r"\d"), timeout=LIVE_MS)
        assert must(admin.get("/api/oncall", params=params))["holder"]["name"] == holder
        drop_socket(phone)
        clock.advance(1)
        expect(region).to_contain_text(other, timeout=LIVE_MS)
        phone.context.set_offline(False)
        expect(phone_region).to_contain_text(other, timeout=PAGE_MS)
        fresh = must(admin.get("/api/oncall", params=params))
        assert fresh["holder"]["name"] == other and at(fresh["at"]) == until
        people = roster(admin)
        step = until.replace(minute=(until.minute // 15) * 15, second=0)
        must(admin.post(f"/api/schedules/{sid}/overrides", {
            "person_id": people["Priya Lindqvist"], "start": iso(step), "end": iso(step + timedelta(hours=2)),
        }), 201)
        assert must(admin.get("/api/oncall", params=params))["holder"]["name"] == "Priya Lindqvist", (
            "an override clears the cached copy before its response returns")
        expect(region).to_contain_text("Priya Lindqvist", timeout=LIVE_MS)


def test_wf_oncall_cache_calendar_link(browser: Browser, app_url: str, admin: Api) -> None:
    with screen(browser, app_url, INES) as page:
        page.goto("/me")

        def shown_link() -> str | None:
            text_ = page.evaluate(
                "document.body.innerHTML + [...document.querySelectorAll('input,textarea')].map(e => e.value).join(' ')")
            found = re.search(r"/calendar/[^\"'<\s]+\.ics", text_)
            return found.group(0) if found else None

        named(page, "button", "Create calendar link").click()
        first = wait_for(shown_link, "the /calendar/<token>.ics link on /me", 5)
        feed = httpx.get(f"{app_url}{first}", timeout=HTTP_SECONDS)
        assert feed.status_code == 200 and feed.headers["content-type"].startswith("text/calendar")
        assert "On call: Transport Primary" in feed.text
        assert "NOTE-ONLY" not in feed.text
        for method in ("POST", "PUT", "DELETE", "PATCH"):
            answer = httpx.request(method, f"{app_url}{first}", timeout=HTTP_SECONDS)
            assert answer.status_code == 405, f"{method} must not change a feed"
        assert httpx.get(f"{app_url}{first}", timeout=HTTP_SECONDS).status_code == 200
        named(page, "button", "Regenerate calendar link").click()
        wait_for(lambda: (u := shown_link()) and u != first, "a new link after Regenerate", 5)
        second = shown_link()
        dead = httpx.get(f"{app_url}{first}", timeout=HTTP_SECONDS)
        assert dead.status_code == 404 and dead.json() == {"error": "not_found"}
        assert httpx.get(f"{app_url}{second}", timeout=HTTP_SECONDS).status_code == 200
        named(page, "button", "Revoke calendar link").click()
        wait_for(lambda: httpx.get(f"{app_url}{second}", timeout=HTTP_SECONDS).status_code == 404,
                 "Revoke stopped the feed at once", 5)
    base = copy_url("APP_WIREMOCK_DOWN_URL")
    copy_admin = Api(base, ROWAN)
    person = Api(base, INES)
    with frozen(copy_admin) as copy_clock:
        token = must(person.post("/api/me/calendar-token"), 201)
        assert at(token["expires_at"]) == copy_clock.now() + timedelta(seconds=YEAR_SECONDS)
        copy_clock.advance(YEAR_SECONDS - 1)
        assert httpx.get(f"{base}{token['url']}", timeout=HTTP_SECONDS).status_code == 200
        copy_clock.advance(1)
        gone = httpx.get(f"{base}{token['url']}", timeout=HTTP_SECONDS)
        assert gone.status_code == 410 and gone.json() == {"error": "expired"}


def test_wf_oncall_cache_valkey_outage_and_return(browser: Browser, valkey: Any) -> None:
    base = copy_url("APP_VALKEY_DOWN_URL")
    api = Api(base, ROWAN)
    schedules = must(api.get("/api/schedules"))["items"]
    primary = next(s for s in schedules if s["name"] == "Transport Primary")
    params = {"schedule_id": primary["id"]}
    answer = api.get("/api/oncall", params=params)
    assert answer.status_code == 200 and answer.headers["X-Switchlamp-Cache"] == "bypass"
    assert answer.json()["holder"]["name"] in {"Ines Varga", "Tomasz Reyes", "Priya Lindqvist", "Mateus Oyelaran"}
    public = httpx.get(f"{base}/api/status", timeout=HTTP_SECONDS)
    assert public.json()["slower"] is True and public.headers["X-Switchlamp-Cache"] == "bypass"
    assert must(api.get("/api/system"))["cache"] == "down"
    slower = "Figures are coming straight from the record, so this page may load more slowly."
    desk = make_desk(api, "Ines Varga")
    accepted = send(base, desk.rk, key="valkey-out")
    assert accepted["status"] == "accepted", "intake accepts events uncounted"
    counter = must(api.get(f"/api/integrations/{desk.iid}"))["counter"]
    assert counter["count"] is None and counter["available"] is True and counter["retry_after"] is None
    with screen(browser, base, ROWAN) as page:
        page.goto("/oncall")
        expect(named(page, "region", "On call now")).to_contain_text(slower)
        page.goto(f"/integrations/{desk.iid}")
        shown(page, "Counter unavailable: events are accepted uncounted until it returns.", PAGE_MS / 1000)
    with screen(browser, base) as page:
        page.goto("/status")
        expect(named(page, "status", "Current status")).to_contain_text(slower)
    observer = os.environ.get("VALKEY_URL") or os.environ.get("VALKEY_OBSERVER_URL")
    if not observer:
        pytest.fail("VALKEY_URL or VALKEY_OBSERVER_URL must name the Valkey the relay forwards to")
    parts = urlparse(observer)
    with listener(relay_handler(parts.hostname, parts.port or 6379,
                                unquote(parts.username) if parts.username else None,
                                unquote(parts.password) if parts.password else None)):
        def caching() -> bool:
            one = api.get("/api/oncall", params=params)
            return one.status_code == 200 and one.headers["X-Switchlamp-Cache"] == "hit"

        wait_for(caching, "X-Switchlamp-Cache: hit after Valkey returned, with no restart", CACHE_RESUME_MARGIN)
        assert httpx.get(f"{base}/api/status", timeout=HTTP_SECONDS).json()["slower"] is False
        assert valkey.keys("switchlamp:valkeyout:cache:oncall:*"), "the copy's cached answer is in Valkey again"
        with screen(browser, base, ROWAN) as page:
            page.goto("/oncall")
            expect(named(page, "region", "On call now")).not_to_contain_text(slower)
    wait_for(lambda: api.get("/api/oncall", params=params).headers["X-Switchlamp-Cache"] == "bypass",
             "the bypass state after the relay stopped", CACHE_RESUME_MARGIN)


def test_wf_notifications_delayed_mail(browser: Browser, app_url: str, admin: Api, clock: Clock, mail: Any) -> None:
    desk = make_desk(admin, "Dario Mbeki", timeout=60)
    with screen(browser, app_url, DARIO) as page:
        page.goto("/incidents")
        notices = named(page, "status", "Notices for you")
        expect(notices).to_have_text(re.compile(r"^\d+ incidents need you$"))
        before = int(notices.inner_text().split()[0])
        inc = drill(admin, desk.sid)
        start = clock.now()
        expect(notices).to_have_text(f"{before + 1} incidents need you", timeout=LIVE_MS)
        in_app = [s for s in inc["steps"] if s["channel"] == "in_app"]
        assert [(s["person"], s["status"]) for s in in_app] == [("Dario Mbeki", "sent")]
        mailed = sorted((s for s in inc["steps"] if s["channel"] == "email"), key=lambda s: s["due_at"])
        assert [at(s["due_at"]) for s in mailed] == [start + timedelta(minutes=5), start + timedelta(minutes=15)]
        assert {s["status"] for s in mailed} == {"scheduled"}
        page.goto(f"/incidents/{inc['id']}")
        steps = named(page, "list", "Notification steps")
        expect(steps).to_contain_text("Scheduled")
        subject = step_subject(inc)
        clock.advance(299)
        no_mail(mail, subject)
        clock.advance(1)
        messages = subject_mail(mail, subject)
        assert len(messages) == 1 and addresses(messages[0]["To"]) == [DARIO]
        assert ack_token(messages[0])
        wait_for(lambda: [s["status"] for s in sorted(
            (s for s in incident(admin, inc["id"])["steps"] if s["channel"] == "email"),
            key=lambda s: s["due_at"])][0] == "sent", "the step marked sent once Mailpit holds the message")
        expect(steps).to_contain_text("Sent", timeout=LIVE_MS)
        clock.advance(120)
        must(act(Api(app_url, DARIO), inc["id"], "acknowledge"))
        final_steps = {s["due_at"]: s["status"] for s in incident(admin, inc["id"])["steps"] if s["channel"] == "email"}
        assert final_steps[iso(start + timedelta(minutes=15))] == "cancelled"
        expect(steps).to_contain_text("Cancelled", timeout=LIVE_MS)
        clock.advance(600)
        assert len(subject_mail(mail, subject)) == 1, "each message arrives once; the acknowledge stopped the rest"


def test_handoff_moves_page(app_url: str, admin: Api, clock: Clock, mail: Any) -> None:
    schedule = make_schedule(admin, "Asia/Kolkata", ["Dario Mbeki", "Sunniva Okoye"], "08:00", 1, "2026-01-05")
    desk = make_desk(admin, schedule, timeout=1440)
    opening = at(must(admin.get("/api/oncall", params={"schedule_id": schedule["id"]}))["until"]) - timedelta(seconds=60)
    clock.to(opening if opening > clock.now() else opening + timedelta(days=1))
    inc = drill(admin, desk.sid)
    acked = drill(admin, desk.sid)
    must(act(admin, acked["id"], "acknowledge"))
    oncall = must(admin.get("/api/oncall", params={"schedule_id": schedule["id"]}))
    old, until = oncall["holder"]["name"], at(oncall["until"])
    new = "Sunniva Okoye" if old == "Dario Mbeki" else "Dario Mbeki"
    deadline = inc["countdown"]["due_at"]
    clock.to(until - timedelta(seconds=1))
    assert [h["name"] for h in incident(admin, inc["id"])["holders"]] == [old]
    clock.advance(1)
    moved = incident(admin, inc["id"])
    assert [h["name"] for h in moved["holders"]] == [new]
    assert moved["countdown"]["due_at"] == deadline, "the escalation deadline does not change"
    entry = entries(moved, "handed_off")
    assert [e["text"] for e in entry] == [f"Incident #{inc['number']} handed off from {old} to {new}"]
    assert entry[0]["actor"] == "Switchlamp" and at(entry[0]["at"]) == until
    assert not [s for s in moved["steps"] if s["person"] == old and s["status"] in ("scheduled", "queued")]
    dues = sorted(at(s["due_at"]) for s in moved["steps"] if s["person"] == new and s["channel"] == "email")
    assert dues == [until + timedelta(minutes=5), until + timedelta(minutes=15)]
    assert [h["name"] for h in incident(admin, acked["id"])["holders"]] == [old], "an acknowledged incident stays"
    clock.advance(300)
    message = subject_mail(mail, step_subject(moved))
    newest = [m for m in message if addresses(m["To"]) == [DARIO if new == "Dario Mbeki" else SUNNIVA]]
    assert len(newest) == 1, "the new holder's first step goes out once"
    old_address = SUNNIVA if new == "Dario Mbeki" else DARIO
    late = [m for m in message if addresses(m["To"]) == [old_address]]
    assert all(at(s["due_at"]) < until for s in moved["steps"]
               if s["person"] == old and s["status"] == "sent" and s["channel"] == "email") and len(late) == len(
        [s for s in moved["steps"] if s["person"] == old and s["status"] == "sent" and s["channel"] == "email"]
    ), "no later step goes to someone who has handed off"
    people = roster(admin)
    step = at(oncall["until"]).replace(second=0)
    step = step.replace(minute=(step.minute // 15) * 15)
    must(admin.post(f"/api/schedules/{schedule['id']}/overrides", {
        "person_id": people["Tomasz Reyes"], "start": iso(step), "end": iso(step + timedelta(hours=3)),
    }), 201)
    covered = incident(admin, inc["id"])
    assert [h["name"] for h in covered["holders"]] == ["Tomasz Reyes"], "a cut covering the present triggers the rule"
    assert len(entries(covered, "handed_off")) == 2


@pytest.mark.timeout(600)
def test_quiet_hours_hold(browser: Browser, app_url: str, admin: Api, clock: Clock, mail: Any) -> None:
    now = clock.now()
    target_ = now.replace(hour=17, minute=0, second=0)
    target_ = target_ if target_ > now else target_ + timedelta(days=1)
    clock.to(target_)
    desk = make_desk(admin, "Priya Lindqvist", grouping="none")
    inc = drill(admin, desk.sid, "warning")
    assert inc["urgency"] == "low"
    notice = next(s for s in inc["steps"] if s["channel"] == "email")
    assert notice["status"] == "held"
    ends = target_ + timedelta(hours=8, minutes=30)
    with screen(browser, app_url, PRIYA, zone="America/New_York") as page:
        page.goto(f"/incidents/{inc['id']}")
        expect(named(page, "list", "Notification steps")).to_contain_text(
            f"Held until {ends.date().isoformat()} 07:00 IST")
    subject = f"[Switchlamp] Low urgency incident #{inc['number']}: {inc['title']}"
    no_mail(mail, subject)
    clock.to(ends - timedelta(seconds=1))
    no_mail(mail, subject)
    assert next(s for s in incident(admin, inc["id"])["steps"] if s["channel"] == "email")["status"] == "held"
    clock.advance(1)
    messages = subject_mail(mail, subject)
    assert len(messages) == 1 and addresses(messages[0]["To"]) == [PRIYA]
    assert ack_token(messages[0])
    clock.to(ends + timedelta(hours=14, minutes=30))
    clock.advance(3600)
    urgent = drill(admin, desk.sid, "critical")
    assert urgent["urgency"] == "high"
    assert {s["status"] for s in urgent["steps"] if s["channel"] == "email"} == {"scheduled"}, (
        "quiet hours never delay high urgency")
    other = drill(admin, desk.sid, "info")
    must(act(admin, other["id"], "acknowledge"))
    assert next(s for s in incident(admin, other["id"])["steps"] if s["channel"] == "email")["status"] == "cancelled"


@pytest.mark.timeout(300)
def test_wf_notifications_mail_outage_and_return(browser: Browser) -> None:
    base = copy_url("APP_MAILPIT_DOWN_URL")
    api = Api(base, ROWAN)
    with frozen(api) as copy_clock:
        desk = make_desk(api, "Dario Mbeki", timeout=60)
        inc = drill(api, desk.sid, summary=tag("Outage mail"))
        copy_clock.advance(300)
        first = wait_for(lambda: (s := next(x for x in sorted(
            (y for y in incident(api, inc["id"])["steps"] if y["channel"] == "email"), key=lambda y: y["due_at"]))
        ) and s["status"] == "queued" and s, "the due step reported as queued")
        assert first["sent_at"] is None
        assert must(api.get("/api/system"))["mail"] == "down"
        title = tag("Outage update")
        update = must(api.post("/api/status-updates", {"title": title, "body": "Body", "state": "investigating",
                                                       "service_ids": []}), 201)
        published = must(api.post(f"/api/status-updates/{update['id']}/publish"))
        assert published["published_at"] and published["subscribers"] >= 2, "publishing does not wait for mail"
        with screen(browser, base, ROWAN) as page:
            page.goto(f"/incidents/{inc['id']}")
            expect(page.get_by_text(re.compile(
                r"^Mail is unreachable\. \d+ notification steps are queued and will go out when it returns\.$"))
            ).to_be_visible()
            expect(named(page, "list", "Notification steps")).to_contain_text("Queued")
            page.goto("/status-desk")
            expect(page.get_by_text(re.compile(
                r"^Mail is unreachable\. \d+ subscriber notices are queued and will go out when it returns\.$"))
            ).to_be_visible()
        received: list[str] = []
        subject = f"Subject: {step_subject(inc)}"
        update_subject = f"Subject: [Tarecross status] {title}"
        with listener(smtp_handler(received)):
            wait_for(lambda: any(subject in m for m in received), "the queued step sent when mail returned",
                     MAIL_RETRY_MARGIN)
            wait_for(lambda: sum(update_subject in m for m in received) >= published["subscribers"],
                     "one subscriber mail per subscriber", MAIL_RETRY_MARGIN)
            wait_for(lambda: next(x for x in sorted(
                (y for y in incident(api, inc["id"])["steps"] if y["channel"] == "email"),
                key=lambda y: y["due_at"]))["status"] == "sent", "the step marked sent after the server accepted it")
            mark = time.monotonic()
            wait_for(lambda: time.monotonic() - mark > MAIL_RETRY_MARGIN / 2, "a retry period to pass", MAIL_RETRY_MARGIN)
            assert sum(subject in m for m in received) == 1, "each message arrives exactly once"
            assert sum(update_subject in m for m in received) == published["subscribers"]
        must(act(api, inc["id"], "resolve"))
        closing = must(api.post("/api/status-updates", {"title": tag("Closed"), "body": "Done", "state": "resolved",
                                                        "service_ids": []}), 201)
        must(api.post(f"/api/status-updates/{closing['id']}/publish"))


def test_wf_notifications_ack_link(browser: Browser, app_url: str, admin: Api, clock: Clock, mail: Any) -> None:
    desk = make_desk(admin, "Dario Mbeki", timeout=240)
    inc = drill(admin, desk.sid)
    clock.advance(300)
    token = ack_token(subject_mail(mail, step_subject(inc))[0])
    anon = Api(app_url)
    assert anon.get(f"/ack/{token}").status_code == 200
    assert incident(admin, inc["id"])["status"] == "triggered", "a GET never changes anything"
    with screen(browser, app_url) as page, screen(browser, app_url, DARIO) as desk_page:
        desk_page.goto(f"/incidents/{inc['id']}")
        expect(named(desk_page, "status", "Notices for you")).to_contain_text("incidents need you")
        page.goto(f"/ack/{token}")
        expect(named(page, "heading", f"Acknowledge incident #{inc['number']}")).to_be_visible()
        expect(page.get_by_text(inc["title"], exact=True)).to_be_visible()
        named(page, "button", f"Acknowledge incident #{inc['number']}").click()
        expect(named(page, "heading", "Acknowledged.")).to_be_visible()
        expect(page.get_by_text(f"Incident #{inc['number']} is with you now.", exact=True)).to_be_visible()
        line = f"Incident #{inc['number']} acknowledged by Dario Mbeki"
        announced(desk_page, line)
        assert live(desk_page).text_content().count(line) == 1, "announced once"
        steps = named(desk_page, "list", "Notification steps").get_by_role("listitem")
        expect(steps.filter(has_text="Cancelled")).to_have_count(1, timeout=LIVE_MS)
    done = incident(admin, inc["id"])
    assert done["status"] == "acknowledged"
    assert entries(done, "acknowledged")[0]["actor"] == "Dario Mbeki"
    used = httpx.post(f"{app_url}/ack/{token}", timeout=HTTP_SECONDS)
    assert used.status_code == 410
    assert "This link has already been used." in used.text
    assert f"Incident #{inc['number']} was acknowledged by Dario Mbeki." in used.text
    assert len(entries(incident(admin, inc["id"]), "acknowledged")) == 1
    bad = httpx.get(f"{app_url}/ack/{token}x", timeout=HTTP_SECONDS)
    assert bad.status_code == 404
    assert "This link is not valid." in bad.text and "Ask your lead for help if you expected it to work." in bad.text

    racing = drill(admin, desk.sid)
    clock.advance(300)
    race_token = ack_token(subject_mail(mail, step_subject(racing))[0])
    race = together(*[lambda: httpx.post(f"{app_url}/ack/{race_token}", timeout=HTTP_SECONDS)] * 3)
    assert sorted(r.status_code for r in race) == [200, 410, 410], "the done page answers only one POST"

    stale = drill(admin, desk.sid)
    clock.advance(300)
    stale_token = ack_token(subject_mail(mail, step_subject(stale))[0])
    clock.advance(1799)
    assert httpx.get(f"{app_url}/ack/{stale_token}", timeout=HTTP_SECONDS).status_code == 200
    clock.advance(1)
    expired = httpx.get(f"{app_url}/ack/{stale_token}", timeout=HTTP_SECONDS)
    assert expired.status_code == 410 and "This link is out of date." in expired.text
    assert f"Incident #{stale['number']} has moved on. Sign in to see where it stands." in expired.text
    must(act(Api(app_url, SUNNIVA), stale["id"], "acknowledge"))
    other_ack = httpx.get(f"{app_url}/ack/{stale_token}", timeout=HTTP_SECONDS)
    assert other_ack.status_code == 410 and f"Incident #{stale['number']} was acknowledged by Sunniva Okoye." in other_ack.text
    must(act(admin, stale["id"], "resolve"))
    assert "This link is out of date." in httpx.get(f"{app_url}/ack/{stale_token}", timeout=HTTP_SECONDS).text
    assert "This link has already been used." in httpx.post(f"{app_url}/ack/{token}", timeout=HTTP_SECONDS).text


def test_notification_rules_per_urgency(browser: Browser, app_url: str, admin: Api, clock: Clock, mail: Any) -> None:
    with settings(app_url, DARIO, notification_delays=[0, 2], low_urgency_delay=3) as dario:
        desk = make_desk(admin, "Dario Mbeki", timeout=60)
        high = drill(admin, desk.sid)
        start = clock.now()
        mailed = sorted(at(s["due_at"]) for s in high["steps"] if s["channel"] == "email")
        assert mailed == [start, start + timedelta(minutes=2)]
        assert [s["status"] for s in high["steps"] if s["channel"] == "in_app"] == ["sent"]
        subject_mail(mail, step_subject(high))
        must(act(dario, high["id"], "acknowledge"))
        steps = incident(admin, high["id"])["steps"]
        assert {s["status"] for s in steps if s["channel"] == "email" and at(s["due_at"]) > start} == {"cancelled"}
        clock.advance(180)
        assert len(subject_mail(mail, step_subject(high))) == 1

        low = drill(admin, desk.sid, "warning")
        now = clock.now()
        notices = [s for s in low["steps"] if s["channel"] == "email"]
        assert [at(s["due_at"]) for s in notices] == [now + timedelta(minutes=3)] and notices[0]["channel"] == "email"
        assert [s["status"] for s in low["steps"] if s["channel"] == "in_app"] == ["sent"]
        assert low["countdown"]["kind"] == "none" and len([s for s in low["steps"] if s["channel"] == "email"]) == 1
        low_subject = f"[Switchlamp] Low urgency incident #{low['number']}: {low['title']}"
        clock.advance(179)
        no_mail(mail, low_subject)
        clock.advance(1)
        assert len(subject_mail(mail, low_subject)) == 1

        for change, field, sentence in (
            ({"notification_delays": []}, "notification_delays", "Use 1 to 5 whole minutes from 0 to 60, separated by commas."),
            ({"notification_delays": [61]}, "notification_delays", "Use 1 to 5 whole minutes from 0 to 60, separated by commas."),
            ({"low_urgency_delay": 61}, "low_urgency_delay", "Use a whole number of minutes from 0 to 60."),
            ({"timezone": "Mars/Base"}, "timezone", "Choose a listed time zone."),
            ({"quiet_start": "22:00", "quiet_end": None}, "quiet_start", "Set both quiet hours times or neither."),
        ):
            answer = dario.patch("/api/me", change)
            assert answer.status_code == 422 and answer.json() == {"errors": {field: sentence}}, change
        with screen(browser, app_url, DARIO) as page:
            page.goto("/me")
            named(page, "textbox", "Notification delays").fill("soon")
            named(page, "button", "Save settings").click()
            expect(named(page, "alert", "Problems to fix")).to_contain_text(
                "Use 1 to 5 whole minutes from 0 to 60, separated by commas.")
            assert must(dario.get("/api/me"))["notification_delays"] == [0, 2]


def test_wf_incident_list_paging_under_arrivals(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga")
    made = [drill(admin, desk.sid) for _ in range(28)]
    numbers = [m["number"] for m in made]
    params = {"status": "open", "service_id": desk.sid, "limit": 10}
    one = must(admin.get("/api/incidents", params=params))
    assert one["total"] == 28 and [i["number"] for i in one["items"]] == sorted(numbers, reverse=True)[:10]
    arrival = drill(admin, desk.sid)
    two = must(admin.get("/api/incidents", params=params | {"after": one["next_cursor"]}))
    assert two["total"] == 29
    removed = two["items"][-1]
    must(act(admin, removed["id"], "resolve"))
    three = must(admin.get("/api/incidents", params=params | {"after": two["next_cursor"]}))
    assert three["total"] == 28 and three["next_cursor"] is None
    seen = [i["number"] for i in one["items"] + two["items"] + three["items"]]
    assert len(seen) == len(set(seen)), "no row repeats"
    assert set(seen) == set(numbers), "no row goes missing"
    assert arrival["number"] not in seen
    back = must(admin.get("/api/incidents", params=params | {"before": two["prev_cursor"]}))
    assert [i["number"] for i in back["items"]] == [i["number"] for i in one["items"]]
    assert must(admin.get("/api/incidents", params=params | {"limit": 100}))["next_cursor"] is None
    assert len(must(admin.get("/api/incidents", params={"service_id": desk.sid}))["items"]) == 25
    wrong = admin.get("/api/incidents", params={"limit": 101})
    assert wrong.status_code == 422 and wrong.json() == {"errors": {"limit": "Limit must be between 1 and 100."}}

    with screen(browser, app_url, TOMASZ) as page:
        page.goto(f"/incidents?status=open&service={desk.sid}")
        total = named(page, "status", "Incident total")
        expect(total).to_contain_text("28")
        rows = page.locator("[data-incident]")
        expect(rows).to_have_count(25)
        first_page = rows.evaluate_all("(r) => r.map((e) => e.dataset.incident)")
        fresh = drill(admin, desk.sid)
        expect(total).to_contain_text("29", timeout=LIVE_MS)
        show = named(page, "button", "Show 1 new incidents")
        expect(show).to_be_visible(timeout=LIVE_MS)
        assert rows.evaluate_all("(r) => r.map((e) => e.dataset.incident)") == first_page, "arrivals never shift rows"
        named(page, "button", "Older incidents").click()
        expect(row(page, first_page[0])).to_have_count(0, timeout=LIVE_MS)
        older = rows.evaluate_all("(r) => r.map((e) => e.dataset.incident)")
        assert not set(older) & set(first_page), "the older page repeats nothing"
        named(page, "button", "Newer incidents").click()
        expect(row(page, first_page[0])).to_have_count(1, timeout=LIVE_MS)
        show = page.get_by_role("button", name=re.compile(r"^Show \d+ new incidents$"))
        show.click()
        expect(rows.first).to_have_attribute("data-incident", str(fresh["number"]), timeout=LIVE_MS)
        expect(rows.first).to_be_focused()


def test_wf_incident_list_keyboard_triage(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    made = [drill(admin, desk.sid) for _ in range(4)]
    n4, n3, n2, n1 = sorted((m["number"] for m in made), reverse=True)
    by_number = {m["number"]: m for m in made}
    with screen(browser, app_url, INES) as page:
        page.goto(f"/incidents?status=open&service={desk.sid}")
        expect(row(page, n4)).to_be_focused()
        page.keyboard.press("k")
        expect(row(page, n4)).to_be_focused()
        page.keyboard.press("j")
        expect(row(page, n3)).to_be_focused()
        page.keyboard.press("k")
        expect(row(page, n4)).to_be_focused()
        for _ in range(5):
            page.keyboard.press("j")
        expect(row(page, n1)).to_be_focused()
        page.keyboard.press("k")
        page.keyboard.press("k")
        expect(row(page, n3)).to_be_focused()
        named(page, "checkbox", f"Select incident {n3}").focus()
        page.keyboard.press("k")
        expect(row(page, n4)).to_be_focused()
        page.keyboard.press("j")
        page.keyboard.press("x")
        expect(row(page, n3)).to_have_attribute("aria-selected", "true")
        expect(row(page, n3)).to_be_focused()
        page.keyboard.press("x")
        expect(row(page, n3)).not_to_have_attribute("aria-selected", "true")
        page.keyboard.press("x")
        page.keyboard.press("a")
        bulk = named(page, "region", "Bulk results")
        expect(bulk).to_contain_text(f"#{n3} acknowledged.", timeout=LIVE_MS * 2)
        expect(row(page, n3)).to_be_focused()
        assert incident(admin, by_number[n3]["id"])["status"] == "acknowledged"
        page.reload()
        expect(row(page, n4)).to_be_focused()
        page.keyboard.press("j")
        page.keyboard.press("j")
        expect(row(page, n2)).to_be_focused()
        page.keyboard.press("r")
        dialog = named(page, "dialog", "Resolve incidents")
        expect(named(dialog, "button", "Resolve")).to_be_focused()
        for _ in range(4):
            page.keyboard.press("Tab")
            assert dialog.evaluate("(d) => d.contains(document.activeElement)"), "Tab wraps inside the dialog"
        for _ in range(4):
            page.keyboard.press("Shift+Tab")
            assert dialog.evaluate("(d) => d.contains(document.activeElement)"), "Shift+Tab wraps inside the dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(row(page, n2)).to_be_focused()
        page.keyboard.press("r")
        named(dialog, "button", "Resolve").click()
        expect(bulk).to_contain_text(f"#{n2} resolved.", timeout=LIVE_MS * 2)
        expect(row(page, n2)).to_have_count(0, timeout=LIVE_MS)
        expect(row(page, n1)).to_be_focused()
        assert incident(admin, by_number[n2]["id"])["status"] == "resolved"
        page.keyboard.press("r")
        named(dialog, "button", "Resolve").click()
        expect(row(page, n1)).to_have_count(0, timeout=LIVE_MS * 2)
        expect(row(page, n3)).to_be_focused()

        narrow = make_desk(admin, "Ines Varga")
        only = drill(admin, narrow.sid)
        page.goto(f"/incidents?status=triggered&service={narrow.sid}")
        expect(row(page, only["number"])).to_be_focused()
        page.keyboard.press("a")
        expect(row(page, only["number"])).to_have_count(0, timeout=LIVE_MS * 2)
        empty = page.get_by_text("Nothing is open.", exact=True)
        expect(empty).to_be_focused()
        assert incident(admin, only["id"])["status"] == "acknowledged"


def test_wf_incident_list_announced_once_in_order(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    with screen(browser, app_url, INES) as page:
        page.goto(f"/incidents?service={desk.sid}", wait_until="domcontentloaded")
        region = live(page)
        expect(region).to_have_count(1)
        assert region.get_attribute("aria-live") in (None, "polite")
        expect(named(page, "table", "Incidents")).to_be_visible()
        a = drill(admin, desk.sid)
        b = drill(admin, desk.sid)
        must(act(admin, a["id"], "acknowledge"))
        must(act(admin, b["id"], "resolve"))
        lines = [
            f"Incident #{a['number']} triggered: {a['title']}",
            f"Incident #{b['number']} triggered: {b['title']}",
            f"Incident #{a['number']} acknowledged by Rowan Achterberg",
            f"Incident #{b['number']} resolved by Rowan Achterberg",
        ]
        announced(page, lines[-1], LIVE_MS * 2)
        mark = time.monotonic()
        wait_for(lambda: time.monotonic() - mark > 1.5, "a second for duplicate announcements to land", 5)
        said = region.text_content()
        for line in lines:
            assert said.count(line) == 1, f"{line!r} must be announced exactly once, region read {said!r}"
        spots = [said.index(line) for line in lines]
        assert spots == sorted(spots), f"announcements must be in event order, region read {said!r}"


def test_wf_incident_list_saved_filters(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    open_one = drill(admin, desk.sid)
    done = drill(admin, desk.sid)
    must(act(admin, done["id"], "resolve"))
    name = tag("Night view")
    person = Api(app_url, TOMASZ)
    with screen(browser, app_url, TOMASZ) as page:
        page.goto(f"/incidents?status=open&service={desk.sid}")
        expect(row(page, open_one["number"])).to_be_visible()
        expect(row(page, done["number"])).to_have_count(0)
        address = page.url
        select(named(page, "combobox", "Status filter"), "Resolved")
        expect(page).to_have_url(re.compile(r"status=resolved"), timeout=LIVE_MS)
        assert parse_qs(urlparse(page.url).query)["service"] == [desk.sid]
        expect(row(page, done["number"])).to_be_visible(timeout=LIVE_MS)
        expect(row(page, open_one["number"])).to_have_count(0)
        page.reload()
        expect(row(page, done["number"])).to_be_visible()
        page.go_back()
        expect(page).to_have_url(address)
        expect(row(page, open_one["number"])).to_be_visible()
        page.go_forward()
        expect(row(page, done["number"])).to_be_visible()
        named(page, "textbox", "Filter name").fill(name)
        named(page, "button", "Save filter").click()
        announced(page, "Filter saved.", LIVE_MS * 2)
        link = named(page, "list", "Saved filters").get_by_role("link", name=name, exact=True)
        expect(link).to_have_attribute("href", re.compile(rf"status=resolved.*service={desk.sid}|service={desk.sid}.*status=resolved"))
        stored = [f for f in must(person.get("/api/me/saved-filters"))["items"] if f["name"] == name]
        assert len(stored) == 1 and stored[0]["status"] == "resolved" and stored[0]["service_id"] == desk.sid
        assert not [f for f in must(Api(app_url, INES).get("/api/me/saved-filters"))["items"] if f["name"] == name]
        page.goto("/incidents")
        link.click()
        expect(row(page, done["number"])).to_be_visible()
        named(page, "button", f"Remove {name}").click()
        expect(link).to_have_count(0, timeout=LIVE_MS * 2)
    assert not [f for f in must(person.get("/api/me/saved-filters"))["items"] if f["name"] == name]
    assert person.post("/api/me/saved-filters", {"name": "", "status": "open", "service_id": None}).status_code == 422


def test_bulk_results_report_each_row(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    free = drill(admin, desk.sid)
    taken = drill(admin, desk.sid)
    other = Api(app_url, SUNNIVA)
    with screen(browser, app_url, INES) as page:
        page.goto(f"/incidents?status=open&service={desk.sid}")
        expect(row(page, taken["number"])).to_be_visible()
        named(page, "checkbox", f"Select incident {taken['number']}").check()
        named(page, "checkbox", f"Select incident {free['number']}").check()
        must(act(other, taken["id"], "acknowledge"))
        expect(row(page, taken["number"])).to_contain_text("Acknowledged", timeout=LIVE_MS)
        row(page, free["number"]).focus()
        page.keyboard.press("a")
        bulk = named(page, "region", "Bulk results")
        expect(bulk).to_contain_text(f"#{free['number']} acknowledged.", timeout=LIVE_MS * 2)
        expect(bulk).to_contain_text(f"#{taken['number']}: Already acknowledged by Sunniva Okoye.")
        said = bulk.text_content()
        assert said.index(f"#{taken['number']}:") < said.index(f"#{free['number']} acknowledged."), "row order"
    assert incident(admin, free["id"])["status"] == "acknowledged"
    assert entries(incident(admin, taken["id"]), "acknowledged")[0]["actor"] == "Sunniva Okoye"
    third = drill(admin, desk.sid)
    answer = must(admin.post("/api/incidents/bulk", {"action": "resolve", "ids": [third["id"], free["id"]]}))
    assert [r["status"] for r in answer["results"]] == ["ok", "ok"]
    again = must(other.post("/api/incidents/bulk", {"action": "resolve", "ids": [third["id"]]}))["results"][0]
    assert again["status"] == "conflict" and again["decision"] == "resolved"
    assert again["decided_by"] == "Rowan Achterberg" and again["number"] == third["number"]
    for ids in ([], ["x"] * 101):
        wrong = admin.post("/api/incidents/bulk", {"action": "resolve", "ids": ids})
        assert wrong.status_code == 422 and wrong.json() == {"errors": {"ids": "Choose 1 to 100 incidents."}}


def test_home_end_bring_row_into_view(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    numbers = sorted((drill(admin, desk.sid)["number"] for _ in range(20)), reverse=True)
    with screen(browser, app_url, INES, height=500) as page:
        page.goto(f"/incidents?status=open&service={desk.sid}")
        expect(row(page, numbers[0])).to_be_focused()
        page.keyboard.press("End")
        last = row(page, numbers[-1])
        expect(last).to_be_focused()
        wait_for(lambda: in_viewport_clear(page, last), "the last row fully in view and clear of fixed elements", 10)
        page.keyboard.press("Home")
        first = row(page, numbers[0])
        expect(first).to_be_focused()
        wait_for(lambda: in_viewport_clear(page, first), "the first row fully in view and clear of fixed elements", 10)


def test_wf_incident_page_socket_drop_replays(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    inc = drill(admin, desk.sid)
    with screen(browser, app_url, INES, spy=True) as page:
        page.goto(f"/incidents/{inc['id']}")
        expect(named(page, "list", "Timeline")).to_contain_text(inc["title"])
        wait_for(lambda: page.evaluate("window.__live && window.__live.readyState === 1"), "the page's open socket", 10)
        first_socket = page.evaluate_handle("window.__live")
        page.context.set_offline(True)
        page.evaluate("window.__live.close()")
        must(act(admin, inc["id"], "acknowledge"))
        must(act(admin, inc["id"], "snooze", {"preset_hours": 1}))
        must(act(admin, inc["id"], "resolve"))
        page.context.set_offline(False)
        lines = [f"Incident #{inc['number']} acknowledged by Rowan Achterberg",
                 f"Incident #{inc['number']} resolved by Rowan Achterberg"]
        announced(page, lines[1], PAGE_MS)
        wait_for(lambda: page.evaluate("(old) => window.__live !== old && window.__live.readyState === 1", first_socket),
                 "the page reconnected by itself", 10)
        mark = time.monotonic()
        wait_for(lambda: time.monotonic() - mark > 1.5, "a second for duplicates to land", 5)
        said = live(page).text_content()
        for line in lines:
            assert said.count(line) == 1, f"nothing announced twice: {said!r}"
        assert said.index(lines[0]) < said.index(lines[1])
        shown = named(page, "list", "Timeline").text_content()
        assert shown.count(lines[1]) == 1, "nothing applied twice"
        seq = page.evaluate(
            """(url) => new Promise((resolve) => {
              const seen = [];
              const s = new window.WebSocket(url);
              s.onopen = () => s.send(JSON.stringify({type: 'hello'}));
              s.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type !== 'countdown' && m.type !== 'clock') seen.push(m.seq); };
              setTimeout(() => { s.close(); resolve(seen); }, 1200);
            })""",
            app_url.replace("http", "ws", 1) + "/api/live?after=0",
        )
        assert seq and seq == sorted(seq), "?after sends everything after that seq first, in order"


def test_wf_incident_page_first_decision_wins(browser: Browser, app_url: str, admin: Api, wiremock: Any) -> None:
    desk = make_desk(admin, "Ines Varga")
    endpoint = make_endpoint(admin, types=["incident.acknowledged"], services=[desk.sid])
    inc = drill(admin, desk.sid)
    actors = [Api(app_url, e) for e in (SUNNIVA, DARIO, INES, TOMASZ)]
    names = {"Sunniva Okoye", "Dario Mbeki", "Ines Varga", "Tomasz Reyes"}
    answers = together(*[lambda a=a: act(a, inc["id"], "acknowledge") for a in actors])
    assert sorted(a.status_code for a in answers) == [200, 409, 409, 409]
    after = incident(admin, inc["id"])
    won = entries(after, "acknowledged")
    assert len(won) == 1 and won[0]["actor"] in names
    for a in answers:
        if a.status_code == 409:
            body = a.json()
            assert set(body) == {"error", "decision", "decided_by", "decided_at"}
            assert body["error"] == "already_decided" and body["decision"] == "acknowledged"
            assert body["decided_by"] == won[0]["actor"]
    assert len(wait_for(lambda: wiremock.requests(endpoint["path"]), "one webhook for the one decision")) == 1
    legal = drill(admin, desk.sid)
    must(act(actors[0], legal["id"], "acknowledge"))
    must(act(actors[1], legal["id"], "resolve"))
    assert incident(admin, legal["id"])["status"] == "resolved", "an acknowledge and then a resolve both succeed"

    contested = drill(admin, desk.sid)
    with screen(browser, app_url, INES) as page:
        page.goto(f"/incidents/{contested['id']}")
        button = named(page, "button", "Acknowledge")
        with held(page, "**/api/incidents/*/acknowledge") as gate:
            button.click()
            expect(button).to_have_attribute("aria-busy", "true")
            expect(button).to_be_disabled()
            must(act(actors[0], contested["id"], "acknowledge"))
            released(gate)
        announced(page, "Already acknowledged by Sunniva Okoye.", LIVE_MS * 3)
    assert len(entries(incident(admin, contested["id"]), "acknowledged")) == 1


def test_wf_incident_page_note_draft_and_double_submit(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    inc = drill(admin, desk.sid)
    person = Api(app_url, INES)
    draft = tag("draft text")
    with screen(browser, app_url, INES) as tab, screen(browser, app_url, INES) as _unused:
        second = tab.context.new_page()
        second.goto(f"{app_url}/incidents/{inc['id']}")
        tab.goto(f"/incidents/{inc['id']}")
        field = named(tab, "textbox", "Note")
        field.fill(draft)
        wait_for(lambda: must(person.get(f"/api/incidents/{inc['id']}/note-draft"))["body"] == draft,
                 "the draft stored on the server about a second after typing stops", 6)
        other_view = must(Api(app_url, SUNNIVA).get(f"/api/incidents/{inc['id']}/note-draft"))
        assert other_view["body"] != draft, "a draft belongs to one person"
        expect(named(second, "textbox", "Note")).to_have_value(draft, timeout=LIVE_MS)
        tab.reload()
        expect(named(tab, "textbox", "Note")).to_have_value(draft)
        add = named(tab, "button", "Add note")
        add.dblclick()
        announced(tab, "Note added.", LIVE_MS * 2)
        expect(named(tab, "list", "Timeline")).to_contain_text(draft, timeout=LIVE_MS)
        expect(named(tab, "textbox", "Note")).to_have_value("", timeout=LIVE_MS)
        expect(named(second, "textbox", "Note")).to_have_value("", timeout=LIVE_MS)
        expect(named(second, "list", "Timeline")).to_contain_text(draft, timeout=LIVE_MS)
    notes = entries(incident(admin, inc["id"]), "note")
    assert [n["text"] for n in notes] == [draft] and notes[0]["actor"] == "Ines Varga", "exactly one note"
    assert must(person.get(f"/api/incidents/{inc['id']}/note-draft"))["body"] == ""
    key, path = uuid.uuid4().hex, f"/api/incidents/{inc['id']}/notes"
    one = must(person.post(path, {"body": "keyed"}, headers={"Idempotency-Key": key}), 201)
    two = must(person.post(path, {"body": "keyed"}, headers={"Idempotency-Key": key}), 201)
    assert one["id"] == two["id"]
    clash = person.post(path, {"body": "changed"}, headers={"Idempotency-Key": key})
    assert clash.status_code == 409 and clash.json() == {"error": "idempotency_conflict"}
    assert len(entries(incident(admin, inc["id"]), "note")) == 2
    assert person.post(path, {"body": ""}).status_code == 422
    assert person.post(path, {"body": "n" * 10001}).status_code == 422
    must(person.post(path, {"body": "n" * 10000}), 201)


@pytest.mark.timeout(300)
def test_wf_incident_page_publish_while_notes_stay_private(browser: Browser, app_url: str, admin: Api, lead: Api,
                                                           mail: Any, valkey: Any) -> None:
    title, secret = tag("Carrier delays"), tag("PRIVATE-NOTE")
    subscriber = f"{uuid.uuid4().hex}@larkfield-freight.example"
    must(httpx.post(f"{app_url}/api/status/subscribers", json={"email": subscriber}, timeout=HTTP_SECONDS), 201)
    desk = make_desk(admin, "Ines Varga")
    inc = drill(admin, desk.sid)
    must(lead.post(f"/api/incidents/{inc['id']}/notes", {"body": secret}), 201)
    with screen(browser, app_url) as public, screen(browser, app_url, SUNNIVA) as page:
        public.goto("/status")
        frame = public.locator("[data-plate]").first
        expect(frame).to_be_visible()
        page.goto("/status-desk")
        named(page, "textbox", "Update title").fill(title)
        named(page, "textbox", "Update body").fill(UPDATE_BODY)
        select(named(page, "combobox", "Update state"), "Investigating")
        editor_button(page, "Save draft").click()
        announced(page, "Saved.", LIVE_MS * 2)
        draft = next(u for u in must(lead.get("/api/status-updates"))["items"] if u["title"] == title)
        assert draft["published_at"] is None
        assert title not in httpx.get(f"{app_url}/api/status", timeout=HTTP_SECONDS).text, "a draft stays private"
        before_etag = httpx.get(f"{app_url}/api/status", timeout=HTTP_SECONDS).headers["ETag"]
        publish_button = editor_button(page, "Publish update")
        publish_button.dblclick()
        expect(live(page)).to_contain_text(re.compile(r"Published\. Notices to \d+ subscribers are on their way\."),
                                           timeout=LIVE_MS * 3)
        fresh = httpx.get(f"{app_url}/api/status", timeout=HTTP_SECONDS)
        assert fresh.headers["ETag"] != before_etag, "publishing clears the cached status at once"
        assert fresh.json()["plate"] == "night"
        assert fresh.json()["updates"][0]["title"] == title and fresh.json()["updates"][0]["state"] == "investigating"
        expect(frame).to_have_attribute("data-plate", "night", timeout=STATUS_POLL_MS)
        expect(named(public, "img", "Freight yard at night")).to_be_visible()
        expect(named(public, "list", "Status updates")).to_contain_text(title)
        assert "Freight yard at dusk" not in [
            e.get_attribute("aria-label") or "" for e in public.get_by_role("img").all()], "the other view stays hidden"
    record = next(u for u in must(lead.get("/api/status-updates"))["items"] if u["title"] == title)
    assert record["published_at"]
    again = lead.post(f"/api/status-updates/{record['id']}/publish")
    assert again.status_code == 409 and again.json() == {"error": "already_published"}
    edit = lead.put(f"/api/status-updates/{record['id']}", {"title": "x", "body": "y", "state": "resolved", "service_ids": []})
    assert edit.status_code == 409 and edit.json() == {"error": "already_published"}
    after_second(lead, record["published_at"])
    subject = f"[Tarecross status] {title}"
    messages = subject_mail(mail, subject, 3)
    receivers = [a for m in messages for a in addresses(m["To"])]
    for address in ("dock-office@meridian-haulage.example", "ops@larkfield-freight.example", subscriber):
        assert receivers.count(address) == 1, f"{address} gets one mail"
    mine = next(m for m in messages if addresses(m["To"]) == [subscriber])
    body = text(mine)
    assert "State: Investigating" in body and UPDATE_BODY in body
    assert secret not in body and "NOTE-ONLY" not in body and "Ines Varga" not in body
    unsubscribe = re.search(r"^Unsubscribe: \S*/status/unsubscribe/(\S+)\s*$", body, re.M)
    assert unsubscribe, "mail must hold the Unsubscribe line"
    gone = httpx.get(f"{app_url}/status/unsubscribe/{unsubscribe.group(1)}", timeout=HTTP_SECONDS)
    assert gone.status_code == 200 and "You will get no more status updates." in gone.text
    closing = must(lead.post("/api/status-updates", {"title": tag("All clear"), "body": "Done.", "state": "resolved",
                                                     "service_ids": []}), 201)
    must(lead.post(f"/api/status-updates/{closing['id']}/publish"))
    assert httpx.get(f"{app_url}/api/status", timeout=HTTP_SECONDS).json()["plate"] == "dusk"
    closing_mail = subject_mail(mail, f"[Tarecross status] {closing['title']}", 2)
    assert subscriber not in [a for m in closing_mail for a in addresses(m["To"])], "an unsubscribed address gets no more"
    assert secret not in json.dumps(valkey.hash(f"switchlamp:{INSTANCE}:cache:status:json"))


def test_wf_incident_page_extra_responders(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    inc = drill(admin, desk.sid)
    people = roster(admin)
    with screen(browser, app_url, INES) as page, screen(browser, app_url, TOMASZ) as asked:
        asked.goto(f"/incidents/{inc['id']}")
        page.goto(f"/incidents/{inc['id']}")
        named(page, "button", "Add responder").click()
        dialog = named(page, "dialog", "Request responder")
        box = named(dialog, "combobox", "Responder")
        options = box.get_by_role("option").all_text_contents()
        assert "Ines Varga" not in options and "Hana Castellanos" not in options, "holders and stakeholders are left out"
        select(box, "Tomasz Reyes")
        named(dialog, "button", "Send request").click()
        region = named(asked, "region", "Responder request")
        expect(region).to_be_visible(timeout=LIVE_MS * 2)
        named(region, "button", "Accept").click()
        expect(named(asked, "list", "Responders")).to_contain_text("Tomasz Reyes", timeout=LIVE_MS * 2)
        expect(named(page, "list", "Responders")).to_contain_text("Tomasz Reyes", timeout=LIVE_MS)
        expect(named(page, "list", "Timeline")).to_contain_text(f"Tomasz Reyes joined incident #{inc['number']}",
                                                                timeout=LIVE_MS)
    after = incident(admin, inc["id"])
    assert [e["text"] for e in entries(after, "responder_requested")] == [
        f"Ines Varga asked Tomasz Reyes to join incident #{inc['number']}"]
    assert [r["name"] for r in after["responders"]] == ["Tomasz Reyes"]
    assert [h["name"] for h in after["holders"]] == ["Ines Varga"], "responders do not hold the incident"
    assert [s for s in after["steps"] if s["person"] == "Tomasz Reyes" and s["channel"] == "in_app"], "an in-app notice"
    assert not [s for s in after["steps"] if s["person"] == "Tomasz Reyes" and s["channel"] == "email"]
    again = admin.post(f"/api/incidents/{inc['id']}/responder-requests", {"person_id": people["Tomasz Reyes"]})
    assert again.status_code == 409 and again.json() == {"error": "already_responding"}
    request_ = must(admin.post(f"/api/incidents/{inc['id']}/responder-requests", {"person_id": people["Priya Lindqvist"]}), 201)
    assert request_["state"] == "requested"
    wrong = Api(app_url, MATEUS).post(f"/api/responder-requests/{request_['id']}/accept")
    assert wrong.status_code == 403
    priya = Api(app_url, PRIYA)
    assert must(priya.post(f"/api/responder-requests/{request_['id']}/decline"))["state"] == "declined"
    twice = priya.post(f"/api/responder-requests/{request_['id']}/accept")
    assert twice.status_code == 409 and twice.json() == {"error": "already_answered"}
    final_ = incident(admin, inc["id"])
    assert [e["text"] for e in entries(final_, "responder_declined")] == [
        f"Priya Lindqvist declined to join incident #{inc['number']}"]
    assert "Priya Lindqvist" not in [r["name"] for r in final_["responders"]]


def test_state_machine_rejections(app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga")
    ines, sunniva = Api(app_url, INES), Api(app_url, SUNNIVA)
    inc = drill(admin, desk.sid)
    illegal = act(ines, inc["id"], "snooze", {"preset_hours": 1})
    assert illegal.status_code == 409
    assert illegal.json() == {"error": "illegal_transition", "message": "Only an acknowledged incident can be snoozed."}
    assert incident(admin, inc["id"])["status"] == "triggered"
    must(act(ines, inc["id"], "acknowledge"))
    now = iso(clock.now())
    for attempt in (lambda: act(ines, inc["id"], "acknowledge"), lambda: act(sunniva, inc["id"], "acknowledge")):
        answer = attempt()
        assert answer.status_code == 409
        assert answer.json() == {"error": "already_decided", "decision": "acknowledged", "decided_by": "Ines Varga",
                                 "decided_at": now}
    must(act(ines, inc["id"], "snooze", {"preset_hours": 1}))
    self_ack = act(ines, inc["id"], "acknowledge")
    assert self_ack.status_code == 409 and self_ack.json()["decision"] == "snoozed"
    double = act(sunniva, inc["id"], "snooze", {"preset_hours": 1})
    assert double.status_code == 409 and double.json()["error"] == "already_decided"
    must(act(sunniva, inc["id"], "resolve"))
    other = drill(admin, desk.sid)
    people = roster(admin)
    resolved = {"error": "already_decided", "decision": "resolved", "decided_by": "Sunniva Okoye", "decided_at": now}
    for action, body in (("acknowledge", None), ("snooze", {"preset_hours": 1}), ("resolve", None),
                         ("reassign", {"person_id": people["Tomasz Reyes"]}),
                         ("responder-requests", {"person_id": people["Tomasz Reyes"]})):
        answer = act(admin, inc["id"], action, body)
        assert answer.status_code == 409 and answer.json() == resolved, action
    target_bad = admin.post(f"/api/incidents/{inc['id']}/merge", {"source_ids": [other["id"]]})
    assert target_bad.status_code == 409 and target_bad.json() == {"error": "merge_target_resolved"}
    source_bad = admin.post(f"/api/incidents/{other['id']}/merge", {"source_ids": [inc["id"]]})
    assert source_bad.status_code == 409
    assert source_bad.json() == {"error": "merge_source_resolved", "number": inc["number"]}
    after = incident(admin, inc["id"])
    assert after["status"] == "resolved" and after["resolve_reason"] == "Resolved"
    for kind in ("triggered", "acknowledged", "snoozed", "resolved"):
        assert len(entries(after, kind)) == 1, kind
    assert entries(after, "acknowledged")[0]["text"] == f"Incident #{inc['number']} acknowledged by Ines Varga"
    assert entries(after, "resolved")[0]["text"] == f"Incident #{inc['number']} resolved by Sunniva Okoye"


def test_wf_timers_reassign_snooze_rules(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga", timeout=60, auto=240)
    ines, sunniva = Api(app_url, INES), Api(app_url, SUNNIVA)
    inc = drill(admin, desk.sid)
    opened = clock.now()
    assert at(inc["auto_resolve_at"]) == opened + timedelta(minutes=240)
    clock.advance(600)
    must(act(ines, inc["id"], "acknowledge"))
    with screen(browser, app_url, INES, device_time=WRONG_DEVICE_TIME) as page:
        page.goto(f"/incidents/{inc['id']}")
        opener = named(page, "button", "Snooze")
        opener.click()
        dialog = named(page, "dialog", "Snooze incident")
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        opener.click()
        named(dialog, "radio", "1 hour").check()
        named(dialog, "button", "Snooze incident").click()
        expect(named(page, "timer", "Incident countdown")).to_have_text(hms(60 * 60), timeout=LIVE_MS * 2)
        expect(page.get_by_text("Snooze ends in", exact=True)).to_be_visible()
    snoozed = incident(admin, inc["id"])
    now = clock.now()
    assert snoozed["status"] == "snoozed" and at(snoozed["snoozed_until"]) == now + timedelta(hours=1)
    assert at(snoozed["auto_resolve_at"]) == opened + timedelta(minutes=310), "12:00, snoozed 12:10 for 1 h, so 17:10"
    clock.advance(1800)
    must(act(sunniva, inc["id"], "acknowledge"))
    early = incident(admin, inc["id"])
    assert early["status"] == "acknowledged" and early["snoozed_until"] is None
    assert at(early["auto_resolve_at"]) == opened + timedelta(minutes=280), "the published 16:40"

    timed = drill(admin, desk.sid)
    must(act(ines, timed["id"], "acknowledge"))
    now = clock.now()
    over = act(ines, timed["id"], "snooze", {"until": iso(now + timedelta(hours=168, seconds=1))})
    assert over.status_code == 422 and over.json() == {"errors": {"until": "Snooze for at most 168 hours."}}
    past = act(ines, timed["id"], "snooze", {"until": iso(now)})
    assert past.status_code == 422 and past.json() == {"errors": {"until": "Choose a time after now."}}
    must(act(ines, timed["id"], "snooze", {"preset_hours": 1}))
    set_auto = incident(admin, timed["id"])["auto_resolve_at"]
    clock.advance(3599)
    assert incident(admin, timed["id"])["status"] == "snoozed"
    clock.advance(1)
    ended = incident(admin, timed["id"])
    assert ended["status"] == "triggered" and ended["snoozed_until"] is None
    assert ended["auto_resolve_at"] == set_auto, "a snooze ending at its own time keeps what it set"
    assert [e["text"] for e in entries(ended, "snooze_ended")] == [
        f"Incident #{ended['number']} back to triggered: snooze ended"]
    assert ended["countdown"]["kind"] == "escalation" and ended["countdown"]["remaining_seconds"] == 60 * 60
    limit = drill(admin, desk.sid)
    must(act(ines, limit["id"], "acknowledge"))
    must(act(ines, limit["id"], "snooze", {"until": iso(clock.now() + timedelta(hours=168))}))
    race = drill(admin, desk.sid)
    must(act(ines, race["id"], "acknowledge"))
    answers = together(lambda: act(ines, race["id"], "snooze", {"preset_hours": 4}),
                       lambda: act(sunniva, race["id"], "snooze", {"preset_hours": 8}))
    assert sorted(a.status_code for a in answers) == [200, 409]
    loser = next(a for a in answers if a.status_code == 409).json()
    assert loser["error"] == "already_decided" and loser["decision"] == "snoozed"
    assert len(entries(incident(admin, race["id"]), "snoozed")) == 1


def test_ack_timeout_and_auto_resolve(app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga", timeout=60, ack=30)
    inc = drill(admin, desk.sid)
    must(act(admin, inc["id"], "acknowledge"))
    waiting = incident(admin, inc["id"])
    assert waiting["countdown"]["kind"] == "ack_timeout" and waiting["countdown"]["remaining_seconds"] == THIRTY_MINUTES
    clock.advance(THIRTY_MINUTES - 1)
    assert incident(admin, inc["id"])["status"] == "acknowledged"
    clock.advance(1)
    back = incident(admin, inc["id"])
    assert back["status"] == "triggered" and back["countdown"]["kind"] == "escalation"
    timed_out = entries(back, "ack_timed_out")
    assert [e["text"] for e in timed_out] == [f"Incident #{inc['number']} back to triggered: acknowledge timed out"]
    assert timed_out[0]["actor"] == "Switchlamp"
    none = make_desk(admin, "Ines Varga", timeout=60)
    free = drill(admin, none.sid)
    must(act(admin, free["id"], "acknowledge"))
    clock.advance(7200)
    assert incident(admin, free["id"])["status"] == "acknowledged", "no value means no timeout"

    auto = make_desk(admin, "Ines Varga", timeout=60, auto=10)
    old = drill(admin, auto.sid)
    body = service_body(auto.policy["id"], name=auto.name, auto=20)
    must(admin.put(f"/api/services/{auto.sid}", body, auto.service["version"]))
    new = drill(admin, auto.sid)
    start = clock.now()
    assert at(old["auto_resolve_at"]) == start + timedelta(minutes=10)
    assert at(new["auto_resolve_at"]) == start + timedelta(minutes=20)
    clock.advance(600)
    closed = incident(admin, old["id"])
    assert closed["status"] == "resolved" and closed["resolve_reason"] == "Auto-resolved"
    assert [e["text"] for e in entries(closed, "auto_resolved")] == [f"Incident #{old['number']} auto-resolved"]
    assert incident(admin, new["id"])["status"] == "triggered", "a change applies to incidents opened after it"
    late = act(admin, old["id"], "acknowledge")
    assert late.status_code == 409 and late.json()["decided_by"] == "Switchlamp"
    clock.advance(600)
    assert incident(admin, new["id"])["resolve_reason"] == "Auto-resolved"


def test_wf_timers_reassign_edge_second(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga", timeout=60, auto=120)
    ines = Api(app_url, INES)
    inc = drill(admin, desk.sid)
    must(act(ines, inc["id"], "acknowledge"))
    must(act(ines, inc["id"], "snooze", {"preset_hours": 1}))
    with screen(browser, app_url, INES, device_time=WRONG_DEVICE_TIME) as page:
        page.goto(f"/incidents/{inc['id']}")
        clock.advance(3599)
        expect(named(page, "timer", "Incident countdown")).to_have_text(mmss(1), timeout=LIVE_MS)
        before = act(ines, inc["id"], "acknowledge")
        assert before.status_code == 409 and before.json()["decision"] == "snoozed", "at T-1 the snooze still runs"
        clock.advance(1)
        expect(page.get_by_text("Escalates in", exact=True)).to_be_visible(timeout=LIVE_MS)
        must(act(ines, inc["id"], "acknowledge"))
    edge = drill(admin, desk.sid)
    other = drill(admin, desk.sid)
    clock.advance(7199)
    must(act(ines, edge["id"], "acknowledge"))
    clock.advance(1)
    assert incident(admin, edge["id"])["status"] == "resolved"
    after = act(ines, other["id"], "acknowledge")
    assert after.status_code == 409 and after.json()["decided_by"] == "Switchlamp", "at T the timer has already fired"
    assert after.json()["decided_at"] == iso(clock.now())


def test_wf_timers_reassign_reassign_effects(browser: Browser, app_url: str, admin: Api, clock: Clock,
                                             wiremock: Any) -> None:
    desk = make_desk(admin, "Ines Varga", "Tomasz Reyes", timeout=30, auto=600)
    target_desk = make_desk(admin, "Priya Lindqvist", timeout=45)
    endpoint = make_endpoint(admin, types=["incident.reassigned", "incident.unacknowledged"])
    people = roster(admin)
    inc = drill(admin, desk.sid)
    clock.advance(1800)
    must(act(admin, inc["id"], "acknowledge"))
    must(act(admin, inc["id"], "snooze", {"preset_hours": 1}))
    clock.advance(600)
    with screen(browser, app_url, INES) as page:
        page.goto(f"/incidents/{inc['id']}")
        named(page, "button", "Reassign").click()
        dialog = named(page, "dialog", "Reassign incident")
        select(named(dialog, "combobox", "Person"), "Mateus Oyelaran")
        named(dialog, "button", "Reassign incident").click()
        expect(named(page, "region", "Holder")).to_contain_text("Mateus Oyelaran", timeout=LIVE_MS * 2)
    moved = incident(admin, inc["id"])
    now = clock.now()
    assert moved["status"] == "triggered" and moved["snoozed_until"] is None
    assert [h["name"] for h in moved["holders"]] == ["Mateus Oyelaran"]
    assert (moved["level"], moved["cycle"]) == (2, 0), "level and cycle stay"
    assert moved["countdown"]["remaining_seconds"] == THIRTY_MINUTES, "the current level's full timeout restarts"
    assert at(moved["auto_resolve_at"]) == now + timedelta(minutes=600), "a cancelled snooze resets auto-resolve"
    assert [e["text"] for e in entries(moved, "reassigned")] == [
        f"Incident #{inc['number']} reassigned to Mateus Oyelaran by Ines Varga"]
    same = act(admin, inc["id"], "reassign", {"person_id": people["Mateus Oyelaran"]})
    assert same.json() == {"errors": {"person_id": "This person already holds the incident."}}
    for body in ({}, {"person_id": people["Ines Varga"], "service_id": desk.sid}):
        wrong = act(admin, inc["id"], "reassign", body)
        assert wrong.status_code == 422
        assert wrong.json() == {"errors": {"person_id": "Choose either a person or a service."}}
    assert act(admin, inc["id"], "reassign", {"service_id": desk.sid}).json() == {
        "errors": {"service_id": "The incident is already on this service."}}
    keep = moved["auto_resolve_at"]
    to_service = must(act(admin, inc["id"], "reassign", {"service_id": target_desk.sid}))
    assert to_service["service"]["id"] == target_desk.sid
    assert desk.sid in [s["id"] for s in to_service["impacted_services"]]
    assert (to_service["level"], to_service["cycle"]) == (1, 0)
    assert [h["name"] for h in to_service["holders"]] == ["Priya Lindqvist"]
    assert to_service["policy_snapshot"]["name"] == target_desk.policy["name"]
    assert to_service["countdown"]["remaining_seconds"] == 45 * 60
    assert to_service["auto_resolve_at"] == keep, "reassigning keeps the copied minutes"
    assert to_service["alerts"][0]["dedup_key"] == moved["alerts"][0]["dedup_key"]
    calls = wait_for(lambda: (r := [x for x in wiremock.requests(endpoint["path"])
                                    if json.loads(wire_body(x))["incident"]["id"] == inc["id"]]) and len(r) >= 2 and r,
                     "two incident.reassigned webhooks")
    assert {json.loads(wire_body(x))["type"] for x in calls} == {"incident.reassigned"}, "never incident.unacknowledged"
    must(act(admin, inc["id"], "resolve"))
    closed = act(admin, inc["id"], "reassign", {"person_id": people["Ines Varga"]})
    assert closed.status_code == 409 and closed.json()["decision"] == "resolved"


def test_wf_timers_reassign_seen_live_on_tab_and_phone(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga", timeout=60)
    ines = Api(app_url, INES)
    inc = drill(admin, desk.sid)
    must(act(ines, inc["id"], "acknowledge"))
    must(act(ines, inc["id"], "snooze", {"preset_hours": 1}))
    lines = [f"Incident #{inc['number']} back to triggered: snooze ended",
             f"Incident #{inc['number']} reassigned to Tomasz Reyes by Ines Varga"]
    with screen(browser, app_url, INES) as tab, screen(browser, app_url, INES, width=375, height=812, touch=True,
                                                        device_time=WRONG_DEVICE_TIME) as phone:
        for page in (tab, phone):
            page.goto(f"/incidents/{inc['id']}")
            expect(page.get_by_text("Snooze ends in", exact=True)).to_be_visible()
        clock.advance(3599)
        for page in (tab, phone):
            expect(named(page, "timer", "Incident countdown")).to_have_text(mmss(1), timeout=LIVE_MS)
        clock.advance(1)
        for page in (tab, phone):
            expect(page.get_by_text("Escalates in", exact=True)).to_be_visible(timeout=LIVE_MS)
            expect(named(page, "timer", "Incident countdown")).to_have_text(hms(60 * 60), timeout=LIVE_MS)
            announced(page, lines[0])
        assert holder_data(tab) == holder_data(phone)
        bar = named(phone, "toolbar", "Incident actions")
        opener = named(bar, "button", "Reassign")
        opener.click()
        dialog = named(phone, "dialog", "Reassign incident")
        person = named(dialog, "combobox", "Person")
        person.focus()
        wait_for(lambda: bar_clear(phone, person, bar), "the focused Person field fully above the fixed bar", 3)
        select(person, "Tomasz Reyes")
        named(dialog, "button", "Reassign incident").click()
        expect(dialog).to_be_hidden(timeout=LIVE_MS * 2)
        expect(opener).to_be_focused()
        for page in (tab, phone):
            expect(named(page, "region", "Holder")).to_contain_text("Tomasz Reyes", timeout=LIVE_MS)
            announced(page, lines[1])
        mark = time.monotonic()
        wait_for(lambda: time.monotonic() - mark > 1.5, "a second for duplicates to land", 5)
        for page in (tab, phone):
            said = live(page).text_content()
            assert [said.count(x) for x in lines] == [1, 1], f"each announced once: {said!r}"
            assert said.index(lines[0]) < said.index(lines[1]), "in event order"
        assert holder_data(tab) == holder_data(phone)
        assert holder_data(tab)["remaining-seconds"] == str(incident(admin, inc["id"])["countdown"]["remaining_seconds"])


def test_wf_merge_split_moved_keys(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    key_a, key_b = uuid.uuid4().hex, uuid.uuid4().hex
    send(app_url, desk.rk, key=key_a)
    target_id = wait_incident(admin, desk.sid)[0]["id"]
    send(app_url, desk.rk, key=key_b)
    rows = wait_incident(admin, desk.sid, 2)
    source_id = next(r["id"] for r in rows if r["id"] != target_id)
    tgt, src = incident(admin, target_id), incident(admin, source_id)
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/incidents/{target_id}")
        opener = named(page, "button", "Merge")
        opener.click()
        dialog = named(page, "dialog", "Merge incidents")
        for _ in range(5):
            page.keyboard.press("Tab")
            assert dialog.evaluate("(d) => d.contains(document.activeElement)"), "Tab wraps inside the dialog"
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        opener.click()
        named(dialog, "textbox", "Incident numbers").fill(str(src["number"]))
        named(dialog, "button", "Merge incidents").click()
        announced(page, f"Merged 1 incidents into #{tgt['number']}.", LIVE_MS * 2)
        expect(named(page, "list", "Alerts")).to_contain_text(key_b, timeout=LIVE_MS)
        page.goto(f"/incidents/{source_id}")
        expect(page.get_by_role("link", name=f"Incident #{tgt['number']}", exact=True)).to_be_visible()
    merged, closed = incident(admin, target_id), incident(admin, source_id)
    assert closed["status"] == "resolved" and closed["resolve_reason"] == "Merged"
    assert closed["merged_into"] == tgt["number"]
    assert {a["dedup_key"] for a in merged["alerts"]} == {key_a, key_b}
    stamps = [e["at"] for e in merged["timeline"]]
    assert stamps == sorted(stamps), "the combined timeline stays in time order"
    assert any(e.get("from_number") == src["number"] for e in merged["timeline"])
    assert merged["holders"] == tgt["holders"]
    send(app_url, desk.rk, key=key_b)
    wait_for(lambda: next(a for a in incident(admin, target_id)["alerts"] if a["dedup_key"] == key_b)["event_count"] == 2,
             "a later event on the moved key landed on the target")
    assert len(listed(admin, desk.sid)) == 2, "the event opened nothing new"
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/incidents/{target_id}")
        line = named(page, "list", "Alerts").get_by_role("listitem").filter(has_text=key_b)
        named(line, "button", "Split off").click()
        expect(named(page, "list", "Alerts")).not_to_contain_text(key_b, timeout=LIVE_MS * 2)
    rows = wait_incident(admin, desk.sid, 3)
    split_row = next(r for r in rows if r["id"] not in (target_id, source_id))
    split = incident(admin, split_row["id"])
    assert [a["dedup_key"] for a in split["alerts"]] == [key_b] and (split["level"], split["cycle"]) == (1, 0)
    assert entries(incident(admin, target_id), "split")[0]["text"] == (
        f"Alert {key_b} split into incident #{split['number']} by Sunniva Okoye")
    send(app_url, desk.rk, key=key_b)
    wait_for(lambda: incident(admin, split["id"])["alerts"][0]["event_count"] == 3,
             "later events land where the alert now lives")
    last = admin.post(f"/api/incidents/{target_id}/alerts/{incident(admin, target_id)['alerts'][0]['id']}/split")
    assert last.status_code == 409 and last.json() == {"error": "last_alert"}
    selfish = admin.post(f"/api/incidents/{target_id}/merge", {"source_ids": [target_id]})
    assert selfish.json() == {"errors": {"source_ids": "An incident cannot merge into itself."}}


def test_wf_merge_split_idempotent_and_race(app_url: str, admin: Api, lead: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    one, two, three, four = (drill(admin, desk.sid) for _ in range(4))
    key = uuid.uuid4().hex
    first = must(lead.post(f"/api/incidents/{one['id']}/merge", {"source_ids": [two["id"]]},
                           headers={"Idempotency-Key": key}))
    again = must(lead.post(f"/api/incidents/{one['id']}/merge", {"source_ids": [two["id"]]},
                           headers={"Idempotency-Key": key}))
    assert again["version"] == first["version"], "a replayed key returns the stored response"
    assert len(entries(incident(admin, two["id"]), "merged")) == 1
    clash = lead.post(f"/api/incidents/{one['id']}/merge", {"source_ids": [three["id"]]},
                      headers={"Idempotency-Key": key})
    assert clash.status_code == 409 and clash.json() == {"error": "idempotency_conflict"}
    other = Api(app_url, DARIO)
    answers = together(lambda: lead.post(f"/api/incidents/{one['id']}/merge", {"source_ids": [four["id"]]}),
                       lambda: other.post(f"/api/incidents/{three['id']}/merge", {"source_ids": [four["id"]]}))
    assert sorted(a.status_code for a in answers) == [200, 409]
    assert next(a for a in answers if a.status_code == 409).json() == {
        "error": "merge_source_resolved", "number": four["number"]}
    responder = Api(app_url, TOMASZ)
    assert responder.post(f"/api/incidents/{one['id']}/merge", {"source_ids": [three["id"]]}).status_code == 403


def test_wf_merge_split_keyboard_seen_live(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    keys = [uuid.uuid4().hex for _ in range(3)]
    ids: list[str] = []
    for count, key in enumerate(keys, 1):
        send(app_url, desk.rk, key=key)
        ids.append(next(r["id"] for r in wait_incident(admin, desk.sid, count) if r["id"] not in ids))
    target, sources = incident(admin, ids[0]), [incident(admin, i) for i in ids[1:]]
    merged_line = f"Merged 1 incidents into #{target['number']}."
    with screen(browser, app_url, SUNNIVA) as page, screen(browser, app_url, INES) as watcher:
        watcher.goto(f"/incidents/{ids[0]}")
        watched = named(watcher, "list", "Alerts")
        expect(watched).to_contain_text(keys[0])
        navigations: list[str] = []
        watcher.on("framenavigated", lambda f: navigations.append(f.url))
        page.goto(f"/incidents/{ids[0]}")
        opener = named(page, "button", "Merge")
        tab_until_focused(page, opener)
        for source, key in zip(sources, keys[1:]):
            page.keyboard.press("Enter")
            dialog = named(page, "dialog", "Merge incidents")
            expect(dialog).to_be_visible()
            tab_until_focused(page, named(dialog, "textbox", "Incident numbers"), 40)
            page.keyboard.type(str(source["number"]))
            tab_until_focused(page, named(dialog, "button", "Merge incidents"), 40)
            page.keyboard.press("Enter")
            expect(dialog).to_be_hidden(timeout=LIVE_MS * 2)
            expect(opener).to_be_focused()
            expect(watched).to_contain_text(key, timeout=LIVE_MS)
        send(app_url, desk.rk, key=keys[1])
        moved = f"Repeat event on {keys[1]}"
        expect(named(watcher, "list", "Timeline")).to_contain_text(moved, timeout=LIVE_MS * 2)
        alerts = named(page, "list", "Alerts")
        expect(alerts).to_contain_text(keys[2])
        texts = alerts.get_by_role("listitem").all_text_contents()
        order = [next(k for k in keys if k in t) for t in texts if any(k in t for k in keys)]
        assert sorted(order) == sorted(keys), f"one line per alert: {texts!r}"
        place = order.index(keys[1])
        takes = order[place + 1] if place + 1 < len(order) else order[place - 1]
        tab_until_focused(page, named(alerts.get_by_role("listitem").filter(has_text=keys[1]), "button", "Split off"))
        page.keyboard.press("Enter")
        expect(alerts).not_to_contain_text(keys[1], timeout=LIVE_MS * 2)
        expect(named(alerts.get_by_role("listitem").filter(has_text=takes), "button", "Split off")).to_be_focused()
        expect(watched).not_to_contain_text(keys[1], timeout=LIVE_MS)
        split = next(r for r in wait_incident(admin, desk.sid, 4) if r["id"] not in ids)
        split_line = f"Alert {keys[1]} split into incident #{split['number']} by Sunniva Okoye"
        announced(watcher, split_line)
        announced(page, split_line)
        repeats = named(watcher, "list", "Timeline").text_content().count(moved)
        send(app_url, desk.rk, key=keys[1])
        wait_for(lambda: incident(admin, split["id"])["alerts"][0]["event_count"] == 3,
                 "the later event landed where the alert now lives")
        mark = time.monotonic()
        wait_for(lambda: time.monotonic() - mark > 1.5, "a second for stray updates to land", 5)
        assert named(watcher, "list", "Timeline").text_content().count(moved) == repeats, "nothing landed on the old target"
        heard = live(watcher).text_content()
        assert heard.count(split_line) == 1 and "Repeat event" not in heard, f"announced once, repeats never: {heard!r}"
        said = live(page).text_content()
        assert said.count(merged_line) == 2 and said.count(split_line) == 1, f"once each: {said!r}"
        assert said.rindex(merged_line) < said.index(split_line), "in event order"
        assert not navigations, f"the responder's page changed in place, saw {navigations}"


def test_wf_maintenance_windows_banner_edges(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga")
    start = clock.now().replace(second=0) + timedelta(minutes=2)
    end = start + timedelta(minutes=2)

    def typed(moment: datetime) -> str:
        day = chicago_date(moment)
        for hour in range(24):
            for minute in range(60):
                label = f"{hour:02d}:{minute:02d}"
                if chicago(day, label) == moment:
                    return f"{day.isoformat()} {label}"
        pytest.fail("the window's start must be a local minute in the firm's zone")

    banner_text = f"Maintenance on {desk.name} until {chicago_label(chicago_date(end), typed(end)[-5:])}"
    with screen(browser, app_url, ROWAN) as page, screen(browser, app_url) as public:
        page.goto("/maintenance")
        named(page, "textbox", "Starts").fill("soon")
        named(page, "textbox", "Ends").fill(typed(end))
        select(named(page, "combobox", "Service"), desk.name)
        named(page, "button", "Add window").click()
        expect(named(page, "alert", "Problems to fix")).to_contain_text("Use the format YYYY-MM-DD HH:MM.")
        named(page, "textbox", "Starts").fill(typed(start))
        named(page, "button", "Add window").click()
        windows = lambda: [w for w in must(admin.get("/api/maintenance-windows"))["items"] if w["service_id"] == desk.sid]
        window = wait_for(windows, "the form saved the window")[0]
        assert window["state"].lower() == "Upcoming".lower() and at(window["starts_at"]) == start
        page.goto("/services")
        public.goto("/status")
        banner, public_banner = named(page, "status", "Maintenance banner"), named(public, "status", "Maintenance banner")
        clock.to(start - timedelta(seconds=1))
        expect(page.get_by_text(banner_text)).to_have_count(0)
        assert desk.name not in [
            m["service"] for m in must(httpx.get(f"{app_url}/api/status", timeout=HTTP_SECONDS))["maintenance"]]
        clock.advance(1)
        expect(banner).to_contain_text(banner_text, timeout=LIVE_MS)
        expect(public_banner).to_contain_text(banner_text, timeout=STATUS_POLL_MS)
        assert must(admin.get(f"/api/services/{desk.sid}"))["own_status"] == "Maintenance"
        clock.to(end - timedelta(seconds=1))
        expect(banner).to_contain_text(banner_text)
        clock.advance(1)
        expect(page.get_by_text(banner_text)).to_have_count(0, timeout=LIVE_MS)
        expect(public.get_by_text(banner_text)).to_have_count(0, timeout=STATUS_POLL_MS)
        assert windows()[0]["state"].lower() == "Ended".lower()
        page.goto("/maintenance")
        expect(page.get_by_text("Ended", exact=True).first).to_be_visible()
    assert must(admin.get(f"/api/services/{desk.sid}"))["own_status"] == "Operational"


def test_wf_maintenance_windows_suppress_events(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga")
    send(app_url, desk.rk, key="before")
    open_row = wait_incident(admin, desk.sid)[0]
    before = incident(admin, open_row["id"])
    now = clock.now()
    path = "/api/maintenance-windows"
    bad_end = admin.post(path, {"service_id": desk.sid, "starts_at": iso(now + timedelta(minutes=2)), "ends_at": iso(now + timedelta(minutes=1))})
    assert bad_end.json() == {"errors": {"ends_at": "The window must end after it starts."}}
    bad_start = admin.post(path, {"service_id": desk.sid, "starts_at": iso(now - timedelta(minutes=1)), "ends_at": iso(now + timedelta(minutes=1))})
    assert bad_start.json() == {"errors": {"starts_at": "The window cannot start in the past."}}
    window = must(admin.post(path, {"service_id": desk.sid, "starts_at": iso(now + timedelta(seconds=60)),
                                    "ends_at": iso(now + timedelta(seconds=180))}), 201)
    clock.advance(60)
    send(app_url, desk.rk, key="inside")
    row_ = wait_log(admin, desk.iid, "The service is in a maintenance window.", "Suppressed", "inside")
    assert row_["incident_number"] is None
    during = incident(admin, open_row["id"])
    assert during["status"] == before["status"] and during["alerts"] == before["alerts"]
    assert len(listed(admin, desk.sid)) == 1, "no alert and no incident inside the window"
    blocked = admin.post("/api/operator/drill", {"service_id": desk.sid, "summary": "x", "severity": "critical"})
    assert blocked.status_code == 409 and blocked.json() == {"error": "in_maintenance"}
    send(app_url, desk.rk, "acknowledge", "before")
    wait_for(lambda: incident(admin, open_row["id"])["status"] == "acknowledged", "an acknowledge inside the window applied")
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto(f"/integrations/{desk.iid}")
        expect(named(page, "table", "Event log")).to_contain_text("The service is in a maintenance window.")
    clock.advance(120)
    send(app_url, desk.rk, key="after")
    wait_incident(admin, desk.sid, 2)
    second = must(admin.post(path, {"service_id": desk.sid, "starts_at": iso(clock.now() + timedelta(seconds=10)),
                                    "ends_at": iso(clock.now() + timedelta(seconds=600))}), 201)
    assert window["id"] != second["id"]
    clock.advance(10)
    must(admin.delete(f"{path}/{second['id']}"), 204)
    assert must(admin.get(f"/api/services/{desk.sid}"))["own_status"] != "Maintenance", "DELETE ends it at once"


def local_minute(moment: datetime) -> str:
    day = chicago_date(moment)
    for hour in range(24):
        for minute in range(60):
            if chicago(day, f"{hour:02d}:{minute:02d}") == moment:
                return chicago_label(day, f"{hour:02d}:{minute:02d}")
    pytest.fail("the window's edge must be a local minute in the firm's zone")


def test_wf_maintenance_windows_edges_across_socket_drop(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk, other = make_desk(admin, "Ines Varga"), make_desk(admin, "Ines Varga")
    open_inc = drill(admin, desk.sid)
    start = clock.now().replace(second=0, microsecond=0) + timedelta(minutes=2)
    end = start + timedelta(minutes=2)
    path = "/api/maintenance-windows"
    must(admin.post(path, {"service_id": desk.sid, "starts_at": iso(start), "ends_at": iso(end)}), 201)
    must(admin.post(path, {"service_id": other.sid, "starts_at": iso(start), "ends_at": iso(end + timedelta(minutes=30))}), 201)
    mine = f"Maintenance on {desk.name} until {local_minute(end)}"
    theirs = f"Maintenance on {other.name} until {local_minute(end + timedelta(minutes=30))}"
    with screen(browser, app_url, ROWAN, spy=True) as page, screen(browser, app_url, INES) as watcher:
        page.goto("/services")
        expect(named(page, "tree", "Service map")).to_be_visible()
        navigations: list[str] = []
        page.on("framenavigated", lambda f: navigations.append(f.url))
        watcher.goto(f"/incidents/{open_inc['id']}")
        expect(named(watcher, "list", "Timeline")).to_contain_text(open_inc["title"])

        def across_drop(moment: datetime) -> None:
            drop_socket(page)
            old = page.evaluate_handle("window.__live")
            clock.to(moment)
            page.context.set_offline(False)
            wait_for(lambda: page.evaluate("(o) => window.__live !== o && window.__live.readyState === 1", old),
                     "the page reconnected by itself", 15)

        across_drop(start)
        shown(page, mine, PAGE_MS / 1000)
        shown(page, theirs, LIVE_MS / 1000)
        log = page.context.new_page()
        log.goto(f"/integrations/{desk.iid}")
        table = named(log, "table", "Event log")
        expect(table).to_be_visible()
        remaining = str(incident(admin, open_inc["id"])["countdown"]["remaining_seconds"])
        expect(named(watcher, "region", "Holder")).to_have_attribute("data-remaining-seconds", remaining, timeout=LIVE_MS)
        before = (holder_data(watcher), named(watcher, "list", "Alerts").text_content())
        send(app_url, desk.rk, key=tag("inside").replace(" ", "-"))
        reason = table.get_by_role("row").filter(has_text="The service is in a maintenance window.")
        expect(reason.first).to_contain_text("Suppressed", timeout=LIVE_MS * 5)
        mark = time.monotonic()
        wait_for(lambda: time.monotonic() - mark > 1.5, "a second for any stray change to land", 5)
        assert (holder_data(watcher), named(watcher, "list", "Alerts").text_content()) == before, "the open incident stayed"
        log.close()
        across_drop(end)
        expect(page.get_by_text(mine)).to_have_count(0, timeout=PAGE_MS)
        shown(page, theirs, LIVE_MS / 1000)
        assert not navigations, f"the services page changed in place, saw {navigations}"
    assert len(listed(admin, desk.sid)) == 1, "the suppressed trigger opened nothing"


def test_wf_map_status_public_page_updates_in_place(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    first = httpx.get(f"{app_url}/api/status", timeout=HTTP_SECONDS)
    assert first.status_code == 200 and first.json()["firm"] == "Tarecross Software"
    assert first.headers["X-Switchlamp-Cache"] in ("hit", "miss")
    same = httpx.get(f"{app_url}/api/status", headers={"If-None-Match": first.headers["ETag"]}, timeout=HTTP_SECONDS)
    assert same.status_code == 304 and not same.content
    page_answer = httpx.get(f"{app_url}/status", timeout=HTTP_SECONDS)
    assert page_answer.status_code == 200 and page_answer.headers.get("ETag")
    assert httpx.get(f"{app_url}/status", headers={"If-None-Match": page_answer.headers["ETag"]},
                     timeout=HTTP_SECONDS).status_code == 304
    with screen(browser, app_url) as page:
        page.goto("/status")
        expect(named(page, "heading", "Tarecross Software")).to_be_visible()
        expect(named(page, "status", "Current status")).to_be_visible()
        services = named(page, "list", "Services")
        item = services.get_by_role("listitem").filter(has_text=desk.name)
        expect(item).to_contain_text("Operational")
        expect(named(page, "list", "Status updates")).to_contain_text("Tracking delays cleared")
        navigations: list[str] = []
        page.on("framenavigated", lambda f: navigations.append(f.url))
        inc = drill(admin, desk.sid)
        expect(item).to_contain_text("Major outage", timeout=STATUS_POLL_MS)
        expect(named(page, "status", "Current status")).to_contain_text("Some services are affected.", timeout=LIVE_MS)
        assert not navigations
        address = f"{uuid.uuid4().hex}@larkfield-freight.example"
        named(page, "textbox", "Email for updates").fill(address)
        named(page, "button", "Subscribe").click()
        expect(page.get_by_text("You are subscribed to status updates.", exact=True)).to_be_visible()
        must(act(admin, inc["id"], "resolve"))
        expect(item).to_contain_text("Operational", timeout=STATUS_POLL_MS)
    fresh = httpx.get(f"{app_url}/api/status", timeout=HTTP_SECONDS).json()
    assert next(s for s in fresh["services"] if s["name"] == desk.name)["status"] == "Operational"
    wrong = httpx.post(f"{app_url}/api/status/subscribers", json={"email": "nope"}, timeout=HTTP_SECONDS)
    assert wrong.status_code == 422 and wrong.json() == {"errors": {"email": "Enter a valid email address."}}
    twice = httpx.post(f"{app_url}/api/status/subscribers", json={"email": address}, timeout=HTTP_SECONDS)
    assert twice.status_code == 201 and twice.json() == {"status": "subscribed"}


def test_wf_map_status_private_data_stays_out(browser: Browser, app_url: str, admin: Api, lead: Api, valkey: Any,
                                              wiremock: Any) -> None:
    desk = make_desk(admin, "Ines Varga")
    endpoint = make_endpoint(admin, types=["incident.triggered", "incident.acknowledged"], services=[desk.sid])
    secret_key, secret_note = uuid.uuid4().hex, tag("NOTE-ONLY")
    inc = drill(admin, desk.sid, key=secret_key)
    must(lead.post(f"/api/incidents/{inc['id']}/notes", {"body": secret_note}), 201)
    must(act(lead, inc["id"], "acknowledge"))
    forbidden = ["NOTE-ONLY", "DRAFT-ONLY", "Carrier feed slowdown", secret_key, secret_note, "Ines Varga",
                 "Sunniva Okoye", "Rowan Achterberg", "tarecross.example", "probe-1"]
    with screen(browser, app_url) as page:
        page.goto("/status")
        expect(named(page, "list", "Services")).to_be_visible()
        copies = {"page": page.content(), "html": httpx.get(f"{app_url}/status", timeout=HTTP_SECONDS).text,
                  "json": httpx.get(f"{app_url}/api/status", timeout=HTTP_SECONDS).text}
    copies["cache json"] = json.dumps(valkey.hash(f"switchlamp:{INSTANCE}:cache:status:json"))
    copies["cache html"] = json.dumps(valkey.hash(f"switchlamp:{INSTANCE}:cache:status:html"))
    assert len(copies["cache json"]) > 2, "the status JSON is cached in Valkey"
    for name, copy_ in copies.items():
        for word in forbidden:
            assert word not in copy_, f"{word!r} leaked into the {name} copy"
    assert "#" + str(inc["number"]) not in copies["json"], "incident numbers never reach the status page"
    calls = wait_for(lambda: (r := wiremock.requests(endpoint["path"])) and len(r) >= 2 and r, "two webhook posts")
    for call in calls:
        body = wire_body(call)
        for word in (secret_note, "tarecross.example", "NOTE-ONLY"):
            assert word not in body, f"{word!r} leaked into a webhook body"


def test_service_map_cycle_and_rollup(admin: Api) -> None:
    bottom = make_desk(admin, "Ines Varga")
    middle = make_service(admin, bottom.policy["id"], depends=[bottom.sid])
    top = make_service(admin, bottom.policy["id"], depends=[middle["id"]])
    body = service_body(bottom.policy["id"], name=bottom.name, depends=[top["id"]])
    loop = admin.put(f"/api/services/{bottom.sid}", body, bottom.service["version"])
    assert loop.status_code == 422
    assert loop.json() == {"errors": {"depends_on": f"This would make a loop: {bottom.name} -> {top['name']} -> {middle['name']} -> {bottom.name}"}}
    assert must(admin.get(f"/api/services/{bottom.sid}"))["depends_on"] == [], "a refused save changes nothing"

    def shown(sid: str) -> str:
        return must(admin.get(f"/api/services/{sid}"))["status"]

    assert {shown(s) for s in (bottom.sid, middle["id"], top["id"])} == {"Operational"}
    info = drill(admin, bottom.sid, "info")
    assert {shown(s) for s in (bottom.sid, middle["id"], top["id"])} == {"Degraded"}
    err = drill(admin, bottom.sid, "error")
    assert shown(top["id"]) == "Partial outage"
    crit = drill(admin, bottom.sid, "critical")
    assert {shown(s) for s in (bottom.sid, middle["id"], top["id"])} == {"Major outage"}
    assert must(admin.get(f"/api/services/{top['id']}"))["own_status"] == "Operational"
    status = httpx.get(f"{admin.base}/api/status", timeout=HTTP_SECONDS).json()
    assert next(s for s in status["services"] if s["name"] == top["name"])["status"] == "Major outage"
    assert status["headline"] == "Some services are affected."
    must(act(admin, crit["id"], "resolve"))
    assert shown(top["id"]) == "Partial outage", "the worst open alert decides, not the latest"
    must(act(admin, err["id"], "resolve"))
    must(act(admin, info["id"], "resolve"))
    assert shown(top["id"]) == "Operational"
    for change in ({"grouping": "window", "minutes": 1441}, {"ack": 1441}, {"auto": 10081}):
        wrong = admin.post("/api/services", service_body(bottom.policy["id"], **change))
        field = next(iter(wrong.json()["errors"]))
        assert wrong.status_code == 422 and wrong.json()["errors"][field] == "Out of range."


def test_wf_map_status_tree_keyboard(browser: Browser, app_url: str, admin: Api) -> None:
    child = make_desk(admin, "Ines Varga")
    parent = make_service(admin, child.policy["id"], depends=[child.sid])

    def focused(page: Page) -> str | None:
        return page.evaluate("document.activeElement.closest('[data-service]')?.dataset.service ?? null")

    with screen(browser, app_url, SUNNIVA) as page:
        page.goto("/services")
        tree = named(page, "tree", "Service map")
        expect(tree.locator(f'[data-service="{parent["name"]}"]').first).to_be_visible()
        tree.get_by_role("treeitem").first.focus()
        page.keyboard.press("End")
        last = focused(page)
        page.keyboard.press("Home")
        assert focused(page) == tree.get_by_role("treeitem").first.get_attribute("data-service")
        assert last != focused(page), "End and Home reach different items"
        for _ in range(400):
            if focused(page) == parent["name"]:
                break
            page.keyboard.press("ArrowDown")
        assert focused(page) == parent["name"], "Down must reach every visible item"
        page.keyboard.press("ArrowRight")
        assert focused(page) == child.name, "Right on an open item moves to its first child"
        page.keyboard.press("ArrowUp")
        assert focused(page) == parent["name"]
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowLeft")
        assert focused(page) == parent["name"], "Left on a leaf moves to its parent"
        page.keyboard.press("ArrowLeft")
        item = tree.locator(f'[data-service="{parent["name"]}"]').first
        expect(item).to_have_attribute("aria-expanded", "false")
        assert focused(page) == parent["name"]
        page.keyboard.press("ArrowRight")
        expect(item).to_have_attribute("aria-expanded", "true")
        assert focused(page) == parent["name"], "Right on a closed item opens it"
        drill(admin, child.sid)
        expect(item).to_have_attribute("data-status", "Major outage", timeout=LIVE_MS)
        expect(item).to_contain_text("Major outage")
        assert focused(page) == parent["name"], "a live status change keeps focus on the same item"


def bar_clear(page: Page, field: Locator, bar: Locator) -> bool:
    field_box, bar_box = field.bounding_box(), bar.bounding_box()
    return bool(field_box and bar_box and field_box["y"] + field_box["height"] <= bar_box["y"] + 0.5)


def test_wf_phone_journey_list(browser: Browser, app_url: str, admin: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    made = [drill(admin, desk.sid) for _ in range(12)]
    numbers = sorted((m["number"] for m in made), reverse=True)
    by_number = {m["number"]: m for m in made}
    with screen(browser, app_url, INES, width=375, height=812, reduced=True, touch=True) as page:
        page.goto(f"/incidents?status=open&service={desk.sid}")
        bar = named(page, "toolbar", "List actions")
        expect(bar).to_be_visible()
        assert page.evaluate("(e) => getComputedStyle(e).position", bar.element_handle()) == "fixed"
        box = bar.bounding_box()
        assert abs(box["y"] + box["height"] - 812) <= 1, "the bar sits at the bottom of the screen"
        layout(page)
        assert not small_targets(page), small_targets(page)
        named(bar, "button", "Last incident").click()
        last = row(page, numbers[-1])
        expect(last).to_be_focused()
        wait_for(lambda: bar_clear(page, last, bar), "the last row fully above the bar", 3)
        named(bar, "button", "First incident").click()
        expect(row(page, numbers[0])).to_be_focused()
        named(page, "checkbox", f"Select incident {numbers[0]}").check()
        named(bar, "button", "Acknowledge selected").click()
        expect(named(page, "region", "Bulk results")).to_contain_text(f"#{numbers[0]} acknowledged.", timeout=LIVE_MS * 2)
        assert incident(admin, by_number[numbers[0]]["id"])["status"] == "acknowledged"
        named(page, "checkbox", f"Select incident {numbers[1]}").check()
        opener = named(bar, "button", "Resolve selected")
        opener.click()
        dialog = named(page, "dialog", "Resolve incidents")
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        opener.click()
        named(dialog, "button", "Resolve").click()
        expect(named(page, "region", "Bulk results")).to_contain_text(f"#{numbers[1]} resolved.", timeout=LIVE_MS * 2)
        assert incident(admin, by_number[numbers[1]]["id"])["status"] == "resolved"
        layout(page)


def test_wf_phone_journey_incident(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    desk = make_desk(admin, "Ines Varga")
    inc = drill(admin, desk.sid)
    with screen(browser, app_url, INES, width=375, height=812, touch=True, device_time=WRONG_DEVICE_TIME) as page:
        page.goto(f"/incidents/{inc['id']}")
        expect(named(page, "timer", "Incident countdown")).to_have_text("30:00")
        bar = named(page, "toolbar", "Incident actions")
        assert page.evaluate("(e) => getComputedStyle(e).position", bar.element_handle()) == "fixed"
        layout(page)
        assert not small_targets(page), small_targets(page)
        named(bar, "button", "Acknowledge").click()
        wait_for(lambda: incident(admin, inc["id"])["status"] == "acknowledged", "Acknowledge took effect", 10)
        named(bar, "button", "Snooze").click()
        dialog = named(page, "dialog", "Snooze incident")
        named(dialog, "radio", "1 hour").check()
        layout(page)
        named(dialog, "button", "Snooze incident").click()
        wait_for(lambda: incident(admin, inc["id"])["status"] == "snoozed", "Snooze took effect", 10)
        named(bar, "button", "Reassign").click()
        dialog = named(page, "dialog", "Reassign incident")
        select(named(dialog, "combobox", "Person"), "Tomasz Reyes")
        named(dialog, "button", "Reassign incident").click()
        wait_for(lambda: [h["name"] for h in incident(admin, inc["id"])["holders"]] == ["Tomasz Reyes"],
                 "Reassign took effect", 5)
        note = named(page, "textbox", "Note")
        note.focus()
        wait_for(lambda: bar_clear(page, note, bar), "the focused note field fully above the fixed bar", 3)
        note.fill("Checked from the phone.")
        named(page, "button", "Add note").click()
        announced(page, "Note added.", LIVE_MS * 2)
        named(bar, "button", "Resolve").click()

        sheet = named(page, "dialog", "Resolve incidents")
        if wait_for(lambda: sheet.is_visible() or incident(admin, inc["id"])["status"] == "resolved",
                    "a resolve dialog or the resolve itself", 10) and sheet.is_visible():
            named(sheet, "button", "Resolve").click()
        wait_for(lambda: incident(admin, inc["id"])["status"] == "resolved", "Resolve took effect", 10)
        layout(page)
        page.goto("/oncall")
        expect(named(page, "region", "On call now")).to_be_visible()
        expect(named(page, "timer", "Handoff countdown")).to_be_visible()
        layout(page)
    assert [e["text"] for e in entries(incident(admin, inc["id"]), "note")] == ["Checked from the phone."]


PHONE_SCREENS = ["/sign-in", "/status", "/oncall", "/incidents", "/schedules", "/policies", "/services", "/integrations",
                 "/webhooks", "/status-desk", "/analytics", "/maintenance", "/admin", "/me"]


def test_wf_phone_journey_every_viewport(browser: Browser, app_url: str, admin: Api) -> None:
    schedule = next(s for s in must(admin.get("/api/schedules"))["items"] if s["name"] == "Transport Primary")
    for width, height in ((375, 812), (768, 1024), (1280, 800)):
        with screen(browser, app_url, None, width=width, height=height) as page:
            page.goto("/sign-in")
            expect(named(page, "button", "Sign in")).to_be_visible()
            layout(page)
        with screen(browser, app_url, ROWAN, width=width, height=height) as page:
            for path in PHONE_SCREENS[1:] + [f"/schedules/{schedule['id']}"]:
                page.goto(path)
                if path == "/status":
                    expect(named(page, "heading", "Tarecross Software")).to_be_visible()
                else:
                    expect(named(page, "navigation", "Main")).to_be_visible()
                layout(page)
                assert not small_targets(page), f"{path} at {width}: {small_targets(page)}"
            if width == 375:
                page.goto(f"/schedules/{schedule['id']}")
                expect(named(page, "button", "Schedule an override")).to_be_visible()


def fresh_job(api: Api) -> dict:
    for _ in range(40):
        seed = uuid.uuid4().int
        begin = date(2026, 9, 1) + timedelta(days=seed % 35)
        end = date(2026, 10, 9) + timedelta(days=(seed >> 8) % 23)
        answer = api.post("/api/analytics/jobs", {"from": begin.isoformat(), "to": end.isoformat()})
        if answer.status_code == 202:
            return answer.json()
    pytest.fail("POST /api/analytics/jobs never answered 202 for a range not yet cached")


def finished(api: Api, job_id: str) -> dict:
    return wait_for(lambda: (j := must(api.get(f"/api/analytics/jobs/{job_id}"))) and j["state"] == "done" and j,
                    "the analytics job finished", 120)


@pytest.mark.timeout(300)
def test_wf_analytics_job_figures_and_download(browser: Browser) -> None:
    base = copy_url("APP_RESTART_URL")
    api = Api(base, SUNNIVA)
    job = fresh_job(api)
    done = finished(api, job["id"])
    rows = {r["name"]: r for r in done["rows"]}
    tracking = rows["Shipment Tracking"]
    assert (tracking["kind"], tracking["incidents"], tracking["mtta_minutes"], tracking["mttr_minutes"]) == (
        "service", 3, "12.5", "50.0")
    team = rows["Customer Visibility"]
    assert (team["kind"], team["incidents"], team["mtta_minutes"], team["mttr_minutes"]) == ("team", 3, "12.5", "50.0")
    core = rows["Freight Core"]
    assert (core["incidents"], core["mtta_minutes"], core["mttr_minutes"]) == (0, "n/a", "n/a")
    assert (done["overall"]["incidents"], done["overall"]["mtta_minutes"], done["overall"]["mttr_minutes"]) == (3, "12.5", "50.0")
    kinds = [r["kind"] for r in done["rows"]]
    assert kinds == sorted(kinds, key=lambda k: k != "service"), "services, then teams"
    names = [r["name"] for r in done["rows"] if r["kind"] == "service"]
    assert names == sorted(names), "services run by name alphabetically"
    with screen(browser, base, SUNNIVA, zone="Asia/Tokyo") as page:
        page.goto(f"/analytics?from={done['from']}&to={done['to']}&job={done['id']}")
        table = named(page, "table", "Response measures")
        line = table.get_by_role("row").filter(has_text="Shipment Tracking")
        expect(line).to_contain_text("12.5")
        expect(line).to_contain_text("50.0")
        expect(table.get_by_role("row").filter(has_text="All services")).to_contain_text("12.5")
        href = page.get_by_role("link", name="Download CSV", exact=True).get_attribute("href")
        answer = page.context.request.get(href if href.startswith("http") else base + href)
        assert answer.status == 200 and answer.headers["content-type"].startswith("text/csv")
        lines = list(csv.reader(io.StringIO(answer.text())))
    with screen(browser, base, SUNNIVA, width=375, height=812, touch=True) as phone:
        phone.goto(f"/analytics?from={done['from']}&to={done['to']}&job={done['id']}")
        expect(named(phone, "table", "Response measures").get_by_role("row").filter(has_text="Shipment Tracking")).to_contain_text("12.5")
        page_fits(phone)
    assert lines[0] == ["name", "incidents", "mtta_minutes", "mttr_minutes"]
    expected = [[r["name"], str(r["incidents"]), r["mtta_minutes"], r["mttr_minutes"]] for r in done["rows"]]
    assert lines[1:-1] == expected and lines[-1] == ["All services", "3", "12.5", "50.0"]
    bad = api.post("/api/analytics/jobs", {"from": "2026-10-02", "to": "2026-10-01"})
    assert bad.status_code == 422 and bad.json() == {"errors": {"to": "The range must end on or after its start."}}


@pytest.mark.timeout(300)
def test_wf_analytics_job_progress_survives_reload(browser: Browser, valkey: Any) -> None:
    base = copy_url("APP_RESTART_URL")
    api, admin_ = Api(base, SUNNIVA), Api(base, ROWAN)
    job = fresh_job(api)
    assert job["state"] == "running" and job["rows"] is None and job["overall"] is None
    early = api.get(f"/api/analytics/jobs/{job['id']}/download")
    assert early.status_code == 409 and early.json() == {"error": "job_running"}
    address = f"/analytics?from={job['from']}&to={job['to']}&job={job['id']}"
    with screen(browser, base, SUNNIVA, spy=True) as page:
        page.goto(address)
        bar = named(page, "progressbar", "Analytics progress")
        expect(bar).to_have_attribute("aria-valuemax", str(job["total"]))
        second = page.context.new_page()
        second.goto(base + address)
        page.reload()
        expect(bar).to_have_attribute("aria-valuemax", str(job["total"]))
        drop_socket(page)
        page.context.set_offline(False)
        total = str(job["total"])
        for tab in (page, second):
            expect(named(tab, "progressbar", "Analytics progress")).to_have_attribute("aria-valuenow", total, timeout=120000)
            expect(named(tab, "table", "Response measures")).to_contain_text("Shipment Tracking", timeout=LIVE_MS)
    assert finished(api, job["id"])["done"] == job["total"]
    assert must(api.get(f"/api/analytics/jobs/{job['id']}"))["id"] == job["id"], "the same job, not a new one"
    assert valkey.keys(f"switchlamp:restart:cache:analytics:{job['from']}:{job['to']}"), "the result is cached in Valkey"
    cached = must(api.post("/api/analytics/jobs", {"from": job["from"], "to": job["to"]}))
    assert cached["cached"] is True and cached["state"] == "done"
    desk = make_desk(admin_, "Ines Varga")
    inc = drill(admin_, desk.sid)
    today = chicago_date(Clock(admin_).now()).isoformat()
    first = api.post("/api/analytics/jobs", {"from": today, "to": today})
    finished(api, first.json()["id"])
    assert must(api.post("/api/analytics/jobs", {"from": today, "to": today}))["cached"] is True
    must(act(admin_, inc["id"], "acknowledge"))
    changed = api.post("/api/analytics/jobs", {"from": today, "to": today})
    assert changed.status_code == 202 and changed.json()["cached"] is False, "an incident change ends the cached result"
    finished(api, changed.json()["id"])
    must(act(admin_, inc["id"], "resolve"))


JOB_SECONDS = 120


@pytest.mark.timeout(300)
def test_wf_analytics_job_on_the_phone(browser: Browser) -> None:
    base = copy_url("APP_RESTART_URL")
    api = Api(base, SUNNIVA)
    job = fresh_job(api)
    total = int(job["total"])
    with screen(browser, base, SUNNIVA, width=375, height=812, touch=True) as phone:
        phone.goto(f"/analytics?from={job['from']}&to={job['to']}&job={job['id']}")
        bar = named(phone, "progressbar", "Analytics progress")
        expect(bar).to_have_attribute("aria-valuemax", str(total))
        seen = [int(bar.get_attribute("aria-valuenow"))]
        page_fits(phone)
        phone.reload()
        expect(bar).to_have_attribute("aria-valuemax", str(total))

        def climbs() -> bool:
            seen.append(int(bar.get_attribute("aria-valuenow")))
            assert seen[-1] >= seen[-2], f"the bar never goes back, a reload included: {seen}"
            return seen[-1] >= total

        wait_for(climbs, "the bar reached the job's total", JOB_SECONDS)
        table = named(phone, "table", "Response measures")
        expect(table).to_contain_text("All services", timeout=LIVE_MS)
        page_fits(phone)
        href = phone.get_by_role("link", name="Download CSV", exact=True).get_attribute("href")
        answer = phone.context.request.get(href if href.startswith("http") else base + href)
        assert answer.status == 200
        lines = list(csv.reader(io.StringIO(answer.text())))[1:]
        names = [line[0] for line in lines]
        cells = [[" ".join(c.split()) for role in ("rowheader", "cell", "gridcell") for c in r.get_by_role(role).all_text_contents()]
                 for r in table.get_by_role("row").all()]
        listed_rows = [(max(found, key=len), c) for c in cells
                       if (found := [n for n in names if any(x == n or x.startswith(n + " ") for x in c)])]
        assert [n for n, _ in listed_rows] == names, f"the table lists the download's lines in order: {listed_rows}"
        for (_, shown_cells), line in zip(listed_rows, lines):
            for value in line[2:]:
                assert value in " ".join(shown_cells), f"{line[0]}: {value} on screen as in the download"


def test_older_schedule_upgrade(app_url: str, admin: Api) -> None:
    legacy = next(s for s in must(admin.get("/api/schedules"))["items"] if s["name"] == "Legacy Yard Rota")

    def upgraded() -> dict | None:
        record = must(admin.get(f"/api/schedules/{legacy['id']}"))
        return record if record["record_format"] == 2 else None

    record = wait_for(upgraded, "Legacy Yard Rota at record_format 2")
    assert record["upgraded_at"]
    system = wait_for(lambda: (s := must(admin.get("/api/system"))["schedule_upgrade"]) and s["state"] == "done" and s,
                      "the schedule upgrade finished")
    assert system["upgraded"] >= 1 and system["finished_at"]
    now = Clock(admin).now()
    for month, hour in ((7, 13), (1, 14)):
        year = now.year + 1
        day = date(year, month, 1)
        day += timedelta(days=(0 - day.weekday()) % 7)
        cut = datetime(day.year, day.month, day.day, hour, 0, tzinfo=timezone.utc)
        blocks = final(admin, legacy["id"], cut - timedelta(hours=2), cut + timedelta(hours=2))["blocks"]
        assert [b["end"] for b in blocks][0] == iso(cut), f"the weekly handoff is local 08:00, {iso(cut)} on this date"
    assert must(admin.get(f"/api/schedules/{legacy['id']}"))["upgraded_at"] == record["upgraded_at"]


def test_wf_platform_access_signed_webhook(browser: Browser, app_url: str, admin: Api, clock: Clock, wiremock: Any) -> None:
    desk, outside = make_desk(admin, "Ines Varga"), make_desk(admin, "Ines Varga")
    path = f"/hooks/{uuid.uuid4().hex}"
    with screen(browser, app_url, ROWAN) as page:
        page.goto("/webhooks")
        named(page, "textbox", "Endpoint name").fill(tag("Yard receiver"))
        named(page, "textbox", "Receiver path").fill("no-slash")
        named(page, "button", "Add endpoint").click()
        expect(named(page, "alert", "Problems to fix")).to_contain_text("The path must start with /.")
        secret_shown = page.content()
        assert "whsec_" not in secret_shown
    endpoint = make_endpoint(admin, path, ["incident.triggered", "incident.resolved"], [desk.sid])
    assert re.fullmatch(r"whsec_[0-9a-f]+", endpoint["secret"])
    assert endpoint["secret"] not in json.dumps(must(admin.get("/api/webhooks"))), "the secret is shown only at creation"
    assert expected_vector() == "v1=7f79dd4aebf42807543e48def13e54148f2dc64db31c602f5e0d2ba71136965b"
    inc = drill(admin, desk.sid)
    drill(admin, outside.sid)
    must(act(admin, inc["id"], "acknowledge"))
    must(act(admin, inc["id"], "resolve"))
    calls = wait_for(lambda: (r := wiremock.requests(path)) and len(r) >= 2 and r, "triggered and resolved posts")
    assert len(calls) == 2, "only its event types and only its services"
    now = int(clock.now().timestamp())
    types = []
    for call in calls:
        raw, stamp = wire_body(call), wire_header(call, "X-Switchlamp-Timestamp")
        assert int(stamp) == now, "the timestamp is the server clock at this attempt"
        assert wire_header(call, "X-Switchlamp-Attempt") == "1"
        assert wire_header(call, "Content-Type").startswith("application/json")
        digest = hmac.new(endpoint["secret"].encode(), f"{stamp}.{raw}".encode(), hashlib.sha256).hexdigest()
        assert wire_header(call, "X-Switchlamp-Signature") == f"v1={digest}"
        body = json.loads(raw)
        assert body["id"] == wire_header(call, "X-Switchlamp-Event-Id")
        assert set(body) == {"id", "type", "occurred_at", "incident"}
        assert body["incident"]["id"] == inc["id"] and body["incident"]["number"] == inc["number"]
        assert body["incident"]["service"] == desk.name
        assert set(body["incident"]) == {"id", "number", "title", "service", "status", "urgency", "resolve_reason", "merged_into"}
        types.append(body["type"])
    assert sorted(types) == ["incident.resolved", "incident.triggered"]
    seeded = wait_for(lambda: [c for c in wiremock.requests("/hooks/carrier-desk")
                               if json.loads(wire_body(c))["incident"]["id"] == inc["id"]],
                      "the seeded endpoint's post for this incident")[0]
    raw, stamp = wire_body(seeded), wire_header(seeded, "X-Switchlamp-Timestamp")
    digest = hmac.new(b"whsec_seed_carrier_desk_7f3a", f"{stamp}.{raw}".encode(), hashlib.sha256).hexdigest()
    assert wire_header(seeded, "X-Switchlamp-Signature") == f"v1={digest}"


def expected_vector() -> str:
    digest = hmac.new(b"whsec_seed_carrier_desk_7f3a", b'1773496800.{"id":"e1"}', hashlib.sha256).hexdigest()
    return f"v1={digest}"


def test_wf_platform_access_backoff_and_attempts(browser: Browser, app_url: str, admin: Api, clock: Clock, wiremock: Any) -> None:
    desk = make_desk(admin, "Ines Varga")
    path, failure = f"/hooks/{uuid.uuid4().hex}", tag("receiver said no")
    wiremock.stub("POST", path, status=500, body=failure)
    endpoint = make_endpoint(admin, path, services=[desk.sid])
    gone_path = f"/hooks/{uuid.uuid4().hex}"
    wiremock.stub("POST", gone_path, status=404, body=GONE_BODY)
    gone = make_endpoint(admin, gone_path, services=[desk.sid])
    dead_path = f"/hooks/{uuid.uuid4().hex}"
    wiremock.stub("POST", dead_path, status=503, body="busy")
    dead = make_endpoint(admin, dead_path, services=[desk.sid])
    drill(admin, desk.sid)

    def posts(p: str, count: int) -> list[dict]:
        return wait_for(lambda: (r := wiremock.requests(p)) and len(r) >= count and r, f"{count} attempts on {p}")

    posts(path, 1)
    first = wait_for(lambda: (d := deliveries(admin, endpoint["id"])) and d[0]["attempts"] and d[0]["status"] == "retrying"
                     and d[0], "the first attempt recorded and the delivery retrying")
    assert first["status"] == "retrying"
    attempt = first["attempts"][0]
    assert (attempt["attempt"], attempt["status_code"], attempt["body"]) == (1, 500, failure)
    rejected = wait_for(lambda: (d := deliveries(admin, gone["id"])) and d[0]["status"] == "rejected" and d[0], "the 404 rejected")
    assert rejected["attempts"][0]["status_code"] == 404 and rejected["attempts"][0]["body"] == GONE_BODY
    clock.advance(9)
    assert len(wiremock.requests(path)) == 1, "no retry before T+10 s"
    clock.advance(1)
    posts(path, 2)
    clock.advance(29)
    assert len(wiremock.requests(path)) == 2
    clock.advance(1)
    posts(path, 3)
    with screen(browser, app_url, ROWAN) as page:
        page.goto(f"/webhooks/{endpoint['id']}")
        delivery_row(endpoint_section(page, endpoint)[0], "Retrying")
        section_row(page, endpoint, named(page, "table", "Attempts"), failure, "500")
    wiremock.stub("POST", path, status=200, body="taken")
    clock.advance(120)
    posts(path, 4)
    done = wait_for(lambda: (d := deliveries(admin, endpoint["id"])[0]) and d["status"] == "delivered" and d, "delivered on the 2xx")
    assert [a["status_code"] for a in done["attempts"]] == [500, 500, 500, 200] and done["attempts"][-1]["body"] == "taken"
    calls = wiremock.requests(path)
    assert {wire_header(c, "X-Switchlamp-Event-Id") for c in calls} == {done["event_id"]}, "one event id across retries"
    assert sorted(int(wire_header(c, "X-Switchlamp-Attempt")) for c in calls) == [1, 2, 3, 4]
    clock.advance(600)
    assert len(wiremock.requests(path)) == 4, "attempts stop after success"
    clock.advance(3600)
    posts(dead_path, 6)
    final_state = wait_for(lambda: (d := deliveries(admin, dead["id"])[0]) and d["status"] == "failed" and d, "failed after six")
    assert len(final_state["attempts"]) == 6
    clock.advance(3600)
    assert len(wiremock.requests(dead_path)) == 6 and len(wiremock.requests(gone_path)) == 1


def test_wf_platform_access_webhook_replay(browser: Browser, app_url: str, admin: Api, clock: Clock, wiremock: Any) -> None:
    desk = make_desk(admin, "Ines Varga")
    path = f"/hooks/{uuid.uuid4().hex}"
    endpoint = make_endpoint(admin, path, services=[desk.sid])
    busy_path = f"/hooks/{uuid.uuid4().hex}"
    wiremock.stub("POST", busy_path, status=500, body="busy")
    busy = make_endpoint(admin, busy_path, services=[desk.sid])
    drill(admin, desk.sid)
    done = wait_for(lambda: (d := deliveries(admin, endpoint["id"])) and d[0]["status"] == "delivered" and d[0], "delivered")
    retrying = wait_for(lambda: (d := deliveries(admin, busy["id"])) and d[0]["status"] == "retrying" and d[0], "retrying")
    refused = admin.post(f"/api/webhook-deliveries/{retrying['id']}/replay")
    assert refused.status_code == 409 and refused.json() == {"error": "delivery_in_progress"}
    with screen(browser, app_url, ROWAN) as page:
        page.goto(f"/webhooks/{endpoint['id']}")
        delivery_row(endpoint_section(page, endpoint)[0], "Delivered")
        replay = wait_for(lambda: (r := endpoint_section(page, endpoint, replay=named(page, "button", "Replay delivery"))[1]
                                   ["replay"]) and len(r) == 1 and r, "the endpoint's one delivery with its own Replay delivery",
                          PAGE_MS / 1000)
        replay[0].click()
        announced(page, "Replay queued under the same event id.", LIVE_MS * 2)
    calls = wait_for(lambda: (r := wiremock.requests(path)) and len(r) >= 2 and r, "the receiver's record of the replay")
    assert len(calls) == 2
    assert {wire_header(c, "X-Switchlamp-Event-Id") for c in calls} == {done["event_id"]}
    assert sorted(int(wire_header(c, "X-Switchlamp-Attempt")) for c in calls) == [1, 2]
    after = wait_for(lambda: (d := deliveries(admin, endpoint["id"])[0]) and len(d["attempts"]) == 2 and d, "two attempts recorded")
    assert after["event_id"] == done["event_id"] and after["status"] == "delivered"


def test_role_rights_matrix(app_url: str, admin: Api, lead: Api) -> None:
    responder, stakeholder = Api(app_url, TOMASZ), Api(app_url, HANA)
    desk = make_desk(admin, "Ines Varga")
    inc = drill(admin, desk.sid)
    alert = inc["alerts"][0]["id"]
    forbidden = {"error": "forbidden"}
    user = roster(admin)["Tomasz Reyes"]
    admin_only = [("get", "/api/webhooks"), ("get", "/api/api-keys"), ("post", "/api/services"), ("post", "/api/integrations"),
                  ("post", "/api/maintenance-windows"), ("post", "/api/operator/clock"), ("post", "/api/operator/drill"),
                  ("post", f"/api/users/{user}/sign-out")]
    lead_up = [("post", f"/api/incidents/{inc['id']}/merge"), ("post", f"/api/incidents/{inc['id']}/alerts/{alert}/split"),
               ("post", "/api/policies"), ("post", "/api/schedules"), ("get", "/api/status-updates"), ("post", "/api/status-updates")]
    reads = ["/api/incidents", "/api/schedules", "/api/policies", "/api/services", "/api/integrations", "/api/users",
             "/api/system", f"/api/incidents/{inc['id']}"]

    def call(api: Api, method: str, path: str) -> httpx.Response:
        return api.get(path) if method == "get" else api.post(path)

    for method, path in admin_only:
        for person in (responder, lead, stakeholder):
            answer = call(person, method, path)
            assert answer.status_code == 403 and answer.json() == forbidden, (method, path)
    assert responder.patch(f"/api/users/{user}", {"role": "lead"}).status_code == 403
    assert lead.patch(f"/api/users/{user}", {"role": "lead"}).status_code == 403
    for method, path in lead_up:
        for person in (responder, stakeholder):
            answer = call(person, method, path)
            assert answer.status_code == 403 and answer.json() == forbidden, (method, path)
        assert call(lead, method, path).status_code not in (401, 403), (method, path)
    for path in reads:
        answer = stakeholder.get(path)
        assert answer.status_code == 403 and answer.json() == forbidden, path
        assert responder.get(path).status_code == 200, path
    for action in ("acknowledge", "resolve"):
        assert act(stakeholder, inc["id"], action).status_code == 403
    must(act(responder, inc["id"], "acknowledge"))
    assert httpx.get(f"{app_url}/api/incidents", timeout=HTTP_SECONDS).json() == {"error": "unauthenticated"}
    assert upgrade_status(Api(app_url)) == 401
    assert upgrade_status(stakeholder) == 403
    assert must(stakeholder.get("/api/me"))["role"] == "stakeholder"
    wrong = httpx.post(f"{app_url}/api/session", json={"email": ROWAN, "password": "wrong"}, timeout=HTTP_SECONDS)
    assert wrong.status_code == 401 and wrong.json() == {"error": "invalid_credentials"}
    assert must(Api(app_url, ROWAN).get("/api/me"))["notification_delays"]


def test_wf_platform_access_sign_in_and_pages(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url) as page:
        page.goto("/sign-in")
        expect(named(page, "heading", "Switchlamp")).to_be_visible()
        expect(page.get_by_role("link", name="Status page", exact=True)).to_be_visible()
        named(page, "textbox", "Email").fill(TOMASZ)
        named(page, "textbox", "Password").fill("wrong")
        named(page, "button", "Sign in").click()
        expect(named(page, "alert", "Problems to fix")).to_contain_text("That email and password do not match.")
        named(page, "textbox", "Password").fill(PASSWORD)
        named(page, "button", "Sign in").click()
        expect(named(page, "navigation", "Main")).to_be_visible()
        expect(named(page, "button", "Sign out")).to_be_visible()
        cookie = next(c for c in page.context.cookies() if c["name"] == "switchlamp_session")
        assert cookie["httpOnly"] is True
        page.goto("/sign-in")
        expect(page).to_have_url(re.compile(r"/oncall"))
        page.goto("/webhooks")
        expect(named(page, "table", "Deliveries")).to_have_count(0)
        page.goto("/admin")
        expect(named(page, "table", "People")).to_have_count(0)
        page.goto("/policies")
        named(page, "button", "Sign out").click()
        wait_for(lambda: not [c for c in page.context.cookies() if c["name"] == "switchlamp_session" and c["value"]]
                 or page.context.request.get(f"{app_url}/api/me").status == 401, "Sign out ended the session", 5)
        goto_settled(page, "/incidents")
        expect(named(page, "table", "Incidents")).to_have_count(0)
    with screen(browser, app_url, HANA) as page:
        page.goto("/incidents")
        expect(named(page, "table", "Incidents")).to_have_count(0)
        page.goto("/me")
        expect(page).to_have_url(re.compile(r"/(status|me)(\?.*)?$"))
    with screen(browser, app_url, SUNNIVA) as page:
        page.goto("/admin")
        expect(named(page, "table", "People")).to_have_count(0)
    with screen(browser, app_url, ROWAN) as page:
        page.goto("/admin")
        expect(named(page, "table", "People")).to_be_visible()


def test_wf_platform_access_role_change_and_sign_out(browser: Browser, app_url: str, admin: Api) -> None:
    who = roster(admin)["Mateus Oyelaran"]
    codes = "JSON.parse(sessionStorage.getItem('__closeCodes') || '[]')"
    try:
        with screen(browser, app_url, ROWAN) as boss, screen(browser, app_url, MATEUS, spy=True) as one:
            session = Api(app_url, MATEUS)
            two = one.context.new_page()
            two.add_init_script(LIVE_SPY)
            one.goto("/incidents")
            two.goto(f"{app_url}/oncall")
            for tab in (one, two):
                wait_for(lambda t=tab: t.evaluate("window.__live && window.__live.readyState === 1"), "an open socket", 10)
            boss.goto("/admin")
            select(named(boss, "combobox", "Role for Mateus Oyelaran"), "Lead")
            shown_across_switch(one, "Your role changed to Lead.")
            assert 4403 in one.evaluate(codes)
            assert must(session.get("/api/me"))["role"] == "lead", "it applies to the very next request"
            select(named(boss, "combobox", "Role for Mateus Oyelaran"), "Stakeholder")
            for tab in (one, two):
                expect(tab).to_have_url(re.compile(r"/status(\?.*)?$"), timeout=LIVE_MS * 2)
                assert 4403 in tab.evaluate(codes)
            assert session.get("/api/incidents").status_code == 403
            assert upgrade_status(session) == 403
            frames: list[str] = []
            one.on("websocket", lambda ws: frames.append(ws.url))
            drill(admin, make_desk(admin, "Ines Varga").sid)
            one.reload()
            expect(named(one, "heading", "Tarecross Software")).to_be_visible()
            assert not frames, "a public page opens no socket and receives no later data"
            must(admin.patch(f"/api/users/{who}", {"role": "responder"}))
            one.goto("/incidents")
            wait_for(lambda: one.evaluate("window.__live && window.__live.readyState === 1"), "a socket again", 10)
            boss.reload()
            named(boss, "button", "Sign Mateus Oyelaran out").click()
            expect(one).to_have_url(re.compile(r"/sign-in"), timeout=LIVE_MS * 2)
            expect(one.get_by_text("You have been signed out.", exact=True)).to_be_visible()
            assert 4401 in one.evaluate(codes)
            answer = session.get("/api/me")
            assert answer.status_code == 401 and answer.json() == {"error": "unauthenticated"}
        last = admin.patch(f"/api/users/{roster(admin)['Rowan Achterberg']}", {"role": "responder"})
        assert last.status_code == 409 and last.json() == {"error": "last_admin"}
    finally:
        must(admin.patch(f"/api/users/{who}", {"role": "responder"}))


def test_wf_platform_access_api_keys(browser: Browser, app_url: str, admin: Api, clock: Clock) -> None:
    name = tag("Yard board")
    with screen(browser, app_url, ROWAN) as page:
        page.goto("/admin")
        named(page, "textbox", "Key name").fill(name)
        select(named(page, "combobox", "Key scope"), "Read")
        named(page, "button", "Create key").click()
        expect(named(page, "table", "API keys")).to_contain_text(name, timeout=LIVE_MS * 2)
    record = next(k for k in must(admin.get("/api/api-keys"))["items"] if k["name"] == name)
    assert record["scope"] == "read" and "key" not in record
    made = must(admin.post("/api/api-keys", {"name": tag("Probe key"), "scope": "read"}), 201)
    assert re.fullmatch(r"slk_[0-9a-f]+", made["key"])
    assert made["key"] not in json.dumps(must(admin.get("/api/api-keys"))), "the key is shown only once"
    old = Api(app_url, bearer=made["key"])
    must(old.get("/api/incidents"))
    rotated = must(admin.post(f"/api/api-keys/{made['id']}/rotate", {}))
    now = clock.now()
    assert at(rotated["grace_ends_at"]) == now + timedelta(minutes=60), "grace defaults to 60 minutes"
    new = Api(app_url, bearer=rotated["key"])
    must(new.get("/api/incidents"))
    clock.advance(3599)
    must(old.get("/api/incidents"))
    clock.advance(1)
    dead = old.get("/api/incidents")
    assert dead.status_code == 401 and dead.json() == {"error": "invalid_api_key"}
    must(new.get("/api/incidents"))
    assert admin.post(f"/api/api-keys/{made['id']}/rotate", {"grace_minutes": 1441}).status_code == 422
    second = must(admin.post(f"/api/api-keys/{made['id']}/rotate", {"grace_minutes": 30}))
    must(admin.delete(f"/api/api-keys/{made['id']}"), 204)
    for key in (rotated["key"], second["key"]):
        assert Api(app_url, bearer=key).get("/api/incidents").status_code == 401, "a revoke kills every form at once"
    gone = admin.post(f"/api/api-keys/{made['id']}/rotate", {})
    assert gone.status_code == 409 and gone.json() == {"error": "key_revoked"}
    must(Api(app_url, bearer="slk_seed_read_4c1d").get("/api/incidents"))


def test_rest_contract(app_url: str, admin: Api, lead: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    inc = drill(admin, desk.sid)
    schedule = make_schedule(admin, "America/Chicago", ["Ines Varga"])
    for path in (f"/api/incidents/{inc['id']}", f"/api/policies/{desk.policy['id']}", f"/api/services/{desk.sid}",
                 f"/api/schedules/{schedule['id']}"):
        first = admin.get(path)
        assert re.fullmatch(r'"\d+"', first.headers["ETag"]), path
        same = admin.get(path, headers={"If-None-Match": first.headers["ETag"]})
        assert same.status_code == 304 and not same.content, path
        assert Api(app_url).get(path, headers={"If-None-Match": first.headers["ETag"]}).status_code == 401
    assert admin.get(f"/api/incidents/{inc['id']}").headers["ETag"] == f'"{incident(admin, inc["id"])["version"]}"'
    anon, responder = Api(app_url), Api(app_url, TOMASZ)
    raw = {"Content-Type": "application/json"}
    assert anon.http.post("/api/session", content=b"{bad", headers=raw).json() == {"error": "invalid_json"}
    assert anon.http.post("/api/policies", content=b"{bad", headers=raw).status_code == 400, "invalid JSON before 401"
    huge = anon.http.post("/api/policies", content=b"x" * (BODY_LIMIT + 1), headers=raw)
    assert huge.status_code == 413 and huge.json() == {"error": "body_too_large"}
    unknown = f"/api/incidents/{uuid.uuid4()}/merge"
    assert anon.post(unknown).status_code == 401, "401 before 404"
    assert responder.post(unknown).status_code == 404 and responder.post(unknown).json() == {"error": "not_found"}, "404 before 403"
    policy_path = f"/api/policies/{desk.policy['id']}"
    assert responder.put(policy_path, {}).status_code == 403, "403 before 428"
    missing = lead.put(policy_path, {})
    assert missing.status_code == 428 and missing.json() == {"error": "version_required"}, "428 before 422"
    must(act(admin, inc["id"], "resolve"))
    state = act(admin, inc["id"], "snooze", {"until": "not an instant"})
    assert state.status_code == 409, "409 before 422"
    for _ in range(2):
        must(act(admin, drill(admin, desk.sid)["id"], "resolve"))
    pages = {"status": "all", "service_id": desk.sid, "limit": 2}
    one = must(admin.get("/api/incidents", params=pages))
    two = must(admin.get("/api/incidents", params={**pages, "after": one["next_cursor"]}))
    assert len(one["items"]) == 2 and len(two["items"]) == 1 and two["next_cursor"] is None
    reader = Api(app_url, bearer=must(admin.post("/api/api-keys", {"name": tag("Reader"), "scope": "read"}), 201)["key"])
    writer = Api(app_url, bearer=must(admin.post("/api/api-keys", {"name": tag("Writer"), "scope": "write"}), 201)["key"])
    open_one = drill(admin, desk.sid)
    must(reader.get(f"/api/incidents/{open_one['id']}"))
    refused = act(reader, open_one["id"], "acknowledge")
    assert refused.status_code == 403 and refused.json() == {"error": "forbidden"}
    assert reader.get("/api/webhooks").status_code == 403, "read allows only GETs a responder may make"
    assert writer.put(policy_path, {}).status_code == 403, "write allows incident actions and notes only"
    must(writer.post(f"/api/incidents/{open_one['id']}/notes", {"body": "from a key"}), 201)
    must(act(writer, open_one["id"], "acknowledge"))
    bad = Api(app_url, bearer="slk_00000000").get("/api/incidents")
    assert bad.status_code == 401 and bad.json() == {"error": "invalid_api_key"}


@pytest.mark.timeout(300)
def test_wf_platform_access_restart_keeps_records(browser: Browser, valkey: Any, mail: Any) -> None:
    base = copy_url("APP_RESTART_URL")
    api = Api(base, ROWAN)
    with frozen(api) as copy_clock:
        desk = make_desk(api, "Dario Mbeki", timeout=60)
        inc = drill(api, desk.sid, summary=tag("Restart proof"))
        note = tag("Restart note")
        must(api.post(f"/api/incidents/{inc['id']}/notes", {"body": note}), 201)
        copy_clock.advance(300)
        subject_mail(mail, step_subject(inc))
        legacy = next(s for s in must(api.get("/api/schedules"))["items"] if s["name"] == "Legacy Yard Rota")
        upgraded = wait_for(lambda: must(api.get(f"/api/schedules/{legacy['id']}"))["upgraded_at"], "the upgrade done")
        before = copy_clock.now()
        restart_copy(base)
        api = Api(base, ROWAN)
        copy_clock.api = api
        assert copy_clock.now() == before, "the held clock survives the restart"
        after = incident(api, inc["id"])
        assert [e["text"] for e in entries(after, "note")] == [note] and after["number"] == inc["number"]
        assert must(api.get(f"/api/schedules/{legacy['id']}"))["upgraded_at"] == upgraded, "upgrade runs once"
        assert len(subject_mail(mail, step_subject(inc))) == 1, "nothing already sent goes out again"
        copy_clock.advance(600)
        assert len(subject_mail(mail, step_subject(inc), 2)) == 2, "pending timers survive the restart"
        must(act(api, inc["id"], "resolve"))
    with screen(browser, base, ROWAN) as page:
        page.goto(f"/incidents/{inc['id']}")
        expect(named(page, "list", "Timeline")).to_contain_text(note)


def test_wf_platform_access_receiver_outage_and_return(browser: Browser) -> None:
    for variable in ("APP_VALKEY_DOWN_URL", "APP_MAILPIT_DOWN_URL", "APP_WIREMOCK_DOWN_URL", "APP_BROKER_DOWN_URL"):
        url = copy_url(variable)
        answer = httpx.get(f"{url}/api/health", timeout=HTTP_SECONDS)
        assert answer.status_code == 200 and answer.json() == {"status": "ok"}, variable
    base = copy_url("APP_WIREMOCK_DOWN_URL")
    api = Api(base, ROWAN)
    with frozen(api) as copy_clock:
        desk = make_desk(api, "Ines Varga")
        path = f"/hooks/{uuid.uuid4().hex}"
        endpoint = make_endpoint(api, path, services=[desk.sid])
        drill(api, desk.sid)
        first = wait_for(lambda: (d := deliveries(api, endpoint["id"])) and d[0]["attempts"] and d[0]["status"] == "retrying"
                         and d[0], "the first attempt recorded and the delivery retrying")
        assert first["status"] == "retrying" and first["attempts"][0]["status_code"] is None
        with screen(browser, base, ROWAN) as page:
            page.goto(f"/webhooks/{endpoint['id']}")
            shown(page, "The receiver is unreachable. Attempts continue on the published schedule.", PAGE_MS / 1000)
            section_row(page, endpoint, named(page, "table", "Attempts"), "Receiver unreachable")
            delivery_row(endpoint_section(page, endpoint)[0], "Retrying")
        received: list[dict] = []
        with listener(http_handler(received)):
            copy_clock.advance(10)
            done = wait_for(lambda: (d := deliveries(api, endpoint["id"])[0]) and d["status"] == "delivered" and d,
                            "delivered once the receiver returned, with no restart")
        mine = [r for r in received if path in r["line"]]
        assert len(mine) == 1 and mine[0]["headers"]["x-switchlamp-attempt"] == "2"
        assert mine[0]["headers"]["x-switchlamp-event-id"] == first["event_id"] == done["event_id"]
        assert done["attempts"][-1]["status_code"] == 200


def test_wf_cross_cutting_server_boundary(app_url: str, admin: Api) -> None:
    health = httpx.get(f"{app_url}/api/health", timeout=HTTP_SECONDS)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert not health.headers.get("Access-Control-Allow-Origin")
    evil = {"Origin": "https://elsewhere.example"}
    crossed = admin.http.post("/api/policies", json={}, headers=evil)
    assert crossed.status_code == 403 and crossed.json() == {"error": "cross_origin"}
    assert upgrade_status(admin, evil["Origin"]) == 403
    assert not crossed.headers.get("Access-Control-Allow-Origin")
    desk = make_desk(admin, "Ines Varga")
    assert httpx.post(f"{app_url}/api/events", json=event_body(desk.rk, "acknowledge", "x"), headers=evil,
                      timeout=HTTP_SECONDS).status_code == 202, "intake carries no cookie and is exempt"

    def sized(total: int, build: Callable[[str], dict]) -> bytes:
        empty = len(json.dumps(build("")).encode())
        return json.dumps(build("p" * (total - empty))).encode()

    raw = {"Content-Type": "application/json"}
    login = lambda pad: {"email": "a@b.example", "password": "x", "pad": pad}
    assert httpx.post(f"{app_url}/api/session", content=sized(BODY_LIMIT, login), headers=raw, timeout=HTTP_SECONDS).status_code != 413
    over = httpx.post(f"{app_url}/api/session", content=sized(BODY_LIMIT + 1, login), headers=raw, timeout=HTTP_SECONDS)
    assert over.status_code == 413 and over.json() == {"error": "body_too_large"}
    trigger = lambda pad: event_body(desk.rk, key="size") | {"pad": pad}
    assert httpx.post(f"{app_url}/api/events", content=sized(INTAKE_LIMIT, trigger), headers=raw, timeout=HTTP_SECONDS).status_code == 202
    assert httpx.post(f"{app_url}/api/events", content=sized(INTAKE_LIMIT + 1, trigger), headers=raw, timeout=HTTP_SECONDS).status_code == 413
    missing = admin.get("/api/no-such-thing")
    assert missing.status_code == 404 and missing.json() == {"error": "not_found"}
    secrets = [os.environ[v] for v in ("DATABASE_URL", "AMQP_URL", "VALKEY_URL", "WIREMOCK_URL", "MAILPIT_URL") if os.environ.get(v)]
    secrets += ["whsec_seed_carrier_desk_7f3a", "slk_seed_read_4c1d"]
    for path in ("/run.json", "/go.mod", "/go.sum", "/main.go", "/.env", "/THIRD_PARTY_NOTICES.md"):
        body = admin.get(path).text
        assert "run-manifest-v1" not in body, path
        for secret in secrets:
            assert secret not in body, path
    sign_in = httpx.get(f"{app_url}/sign-in", timeout=HTTP_SECONDS).text
    assets = re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', sign_in)
    for body in [sign_in, admin.get("/api/webhooks").text, admin.get("/api/system").text] + [
            httpx.get(f"{app_url}{a}", timeout=HTTP_SECONDS).text for a in assets]:
        for secret in secrets:
            assert secret not in body, "a secret or service URL reached the wire"
    assert admin.get("/incidents").headers.get("Cache-Control"), "signed-in pages carry a cache directive"


@pytest.mark.timeout(300)
def test_wf_cross_cutting_motion_and_reduced_motion(browser: Browser, app_url: str, admin: Api, lead: Api) -> None:
    stamps: list[str] = []

    def publish_state(state: str) -> None:
        if stamps:
            after_second(lead, stamps[-1])
        update = must(lead.post("/api/status-updates", {"title": tag("Motion"), "body": "Body", "state": state,
                                                        "service_ids": []}), 201)
        stamps.append(must(lead.post(f"/api/status-updates/{update['id']}/publish"))["published_at"])

    publish_state("resolved")
    for reduced, target_plate, state, width, height in ((False, "night", "investigating", 1280, 800),
                                                        (True, "dusk", "resolved", 375, 812)):
        with screen(browser, app_url, reduced=reduced, width=width, height=height) as page:
            page.add_init_script(OPACITY_SPY)
            page.goto("/status")
            frame = page.locator("[data-plate]").first
            expect(frame).to_be_visible()
            infinite = page.evaluate("document.getAnimations().filter(a => a.effect.getTiming().iterations === Infinity).length")
            assert infinite == 0, "no decorative loops"
            page.evaluate("window.__fade.length = 0")
            publish_state(state)
            expect(frame).to_have_attribute("data-plate", target_plate, timeout=STATUS_POLL_MS)
            mark = time.monotonic()
            wait_for(lambda: time.monotonic() - mark > PLATE_MAX_MS / 1000 + 0.5, "the crossfade to finish", 5)
            fade = page.evaluate("window.__fade")
            if reduced:
                assert len(fade) <= 3, f"the plate swaps at once under reduced motion, saw {len(fade)} moving frames"
                page_fits(page)
            else:
                assert fade, "the plate must crossfade when a published update changes the view"
                assert PLATE_MIN_MS <= fade[-1] - fade[0] <= PLATE_MAX_MS, f"crossfade lasted {fade[-1] - fade[0]} ms"
    publish_state("resolved")
    plan = cut_schedule(admin, Clock(admin).now())
    for reduced in (False, True):
        with screen(browser, app_url, SUNNIVA, reduced=reduced) as page:
            page.goto(plan.url)
            group = named(page, "group", "Final schedule")
            expect(group.locator("[data-start]").first).to_be_visible()
            rects = block_rects(group)
            start_x, y = x_of(rects, chicago(plan.day, "07:00"))
            far_x, _ = x_of(rects, chicago(plan.day, "09:12"))
            page.mouse.move(start_x, y)
            page.mouse.down()
            page.mouse.move(far_x, y, steps=4)
            durations = group.evaluate("(g) => g.getAnimations({subtree: true}).map(a => Number(a.effect.getTiming().duration) || 0)")
            expect(page.get_by_text(cut_tab("09:15", 135), exact=True)).to_be_visible(timeout=LIVE_MS)
            expect(named(page, "region", "Cut preview")).to_contain_text(CLEAN_CUT)
            assert [r for r in block_rects(group) if r["preview"]], "split pieces stay under reduced motion"
            page.keyboard.press("Escape")
            page.mouse.up()
            if reduced:
                assert not [d for d in durations if d > 20], "blocks jump with no easing under reduced motion"
            else:
                assert all(d <= CUT_MOTION_MAX_MS for d in durations), durations


def test_wf_cross_cutting_one_socket_open_before_sending(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, SUNNIVA, spy=True) as page:
        sockets: list[str] = []
        page.on("websocket", lambda ws: sockets.append(ws.url))
        for path in ("/incidents", "/oncall", "/schedules", "/services", "/analytics"):
            sockets.clear()
            page.goto(path)
            wait_for(lambda: page.evaluate("window.__sent.length > 0"), f"the hello frame on {path}", 5)
            assert len(sockets) == 1 and "/api/live" in sockets[0], f"{path} opened {sockets}"
            assert json.loads(page.evaluate("window.__sent[0]")) == {"type": "hello"}
            assert page.evaluate("window.__earlySends") == 0, "a page sends nothing until the socket is open"
            mark = time.monotonic()
            wait_for(lambda: time.monotonic() - mark > 1, "a second for a stray second socket", 10)
            assert len(sockets) == 1, f"{path} must keep exactly one socket"
    for email, path in ((None, "/status"), (None, "/sign-in"), (HANA, "/me")):
        with screen(browser, app_url, email, spy=True) as page:
            sockets = []
            page.on("websocket", lambda ws, seen=sockets: seen.append(ws.url))
            page.goto(path)
            expect(page.get_by_role("button").first).to_be_visible()
            mark = time.monotonic()
            wait_for(lambda: time.monotonic() - mark > 1, "a second for a stray socket", 10)
            assert not sockets, f"{path} must open no socket, saw {sockets}"


def test_wf_cross_cutting_drill_opens_real_incident(browser: Browser, app_url: str, admin: Api, lead: Api) -> None:
    desk = make_desk(admin, "Ines Varga")
    with screen(browser, app_url, INES) as page:
        page.goto(f"/incidents?status=open&service={desk.sid}")
        expect(named(page, "table", "Incidents")).to_be_visible()
        inc = drill(admin, desk.sid, key=DRILL_KEY)
        expect(named(page, "status", "Incident total")).to_contain_text("1", timeout=LIVE_MS)
    assert inc["status"] == "triggered" and inc["alerts"][0]["routing_key"] is None
    assert inc["alerts"][0]["dedup_key"] == DRILL_KEY
    assert entries(inc, "triggered")[0]["actor"] == "Rowan Achterberg"
    assert not log_rows(admin, desk.iid), "a drill writes no event log row"
    assert must(admin.get(f"/api/integrations/{desk.iid}"))["counter"]["count"] == 0, "and passes no rate limit"
    send(app_url, desk.rk, "acknowledge", DRILL_KEY)
    wait_log(admin, desk.iid, "No alert has this dedup key.", "Dropped", DRILL_KEY)
    assert incident(admin, inc["id"])["status"] == "triggered", "events never touch a drill's alert"
    bad = admin.post("/api/operator/drill", {"service_id": "", "summary": "", "severity": "high"})
    assert bad.status_code == 422
    assert bad.json() == {"errors": {"summary": "Summary is required.",
                                     "severity": "Severity must be critical, error, warning or info.",
                                     "service_id": "Choose a service."}}
    assert lead.post("/api/operator/drill", {"service_id": desk.sid, "summary": "x", "severity": "critical"}).status_code == 403


ALLOWLIST = {"MIT", "Apache-2.0", "BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0", "OFL-1.1"}
APP_ROOT = Path("/app")


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest[field], str) and manifest[field].strip()
    assert shlex.split(manifest["serve"])


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notices, f"{package.name} is missing from THIRD_PARTY_NOTICES.md"
    for font in ("Darker Grotesque", "Lexend", "Chivo Mono"):
        assert font in notices, f"{font} is missing from THIRD_PARTY_NOTICES.md"


def test_if_licences_allowed() -> None:
    for package in shipped_packages():
        assert licence_allowed(package.licence, ALLOWLIST), f"{package.name}: {package.licence}"


def test_if_only_named_datastores() -> None:
    banned = ("sqlite", "bbolt", "boltdb", "badger", "mongo", "mysql", "kafka", "nats", "leveldb", "memcache")
    for package in shipped_packages():
        assert not any(word in package.name.lower() for word in banned), package.name


def test_if_go_sum_committed() -> None:
    assert any((folder / "go.sum").is_file() for folder in project_dirs(APP_ROOT)), "go.sum must be committed"


def test_if_assets_bundled_same_origin(browser: Browser, app_url: str) -> None:
    for path in ("/status", "/sign-in"):
        with screen(browser, app_url) as page:
            requests_seen: list[str] = []
            page.on("request", lambda r, seen=requests_seen: seen.append(r.url))
            page.goto(path, wait_until="networkidle")
            outside = [u for u in requests_seen if u.startswith("http") and not same_origin(u, app_url)]
            assert not outside, f"{path} fetched {outside}"
            assert any(re.search(r"\.(woff2?|ttf|otf)", u) for u in requests_seen), f"{path} must load bundled fonts"
            assert any(re.search(r"\.(png|jpe?g|webp|avif|svg)", u) for u in requests_seen), f"{path} must load a bundled plate"


def test_if_no_other_product_named(app_url: str) -> None:
    names = ("opsgenie", "victorops", "splunk on-call", "squadcast", "firehydrant", "xmatters", "grafana oncall")
    for path in ("/status", "/sign-in"):
        body = httpx.get(f"{app_url}{path}", timeout=HTTP_SECONDS).text.lower()
        for name in names:
            assert name not in body, f"{name} appears on {path}"
