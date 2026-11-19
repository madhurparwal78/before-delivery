from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import os
import re
import shlex
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    addresses,
    advance,
    app_user_env,
    as_app_user,
    AXE,
    center,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    motion,
    open_app,
    same_origin,
    select,
    session,
    settle,
    text,
    unique,
)

SEED_PASSWORD = "daybook-demo-2026"
OPERATOR_EMAIL = "operator@tidemark.test"
WREN_EMAIL = "wren@harbourlane.test"
OSSIAN_EMAIL = "ossian@saltmarsh.test"
SALTMARSH = "Saltmarsh Consulting"
SEED_EVENT = "seed-saltmarsh-trial-converted"
MAIL_FROM = "Tidemark Daybook <daybook@tidemark.test>"
MAIL_FROM_ADDRESS = "daybook@tidemark.test"
SESSION_COOKIE = "tidemark_session"
JSON_CT = "application/json; charset=utf-8"
TRIAL_LENGTH_S = 1209600
TRIAL_DAYS = 14
TRIAL_SWEEP_S = 10
TOLERANCE_S = 300
RECOVERY_S = 30
RETRY_S = 10
JSON_LIMIT = 65536
FILE_LIMIT = 1000000
MAX_ROWS = 2000
THRESHOLD = 360
THRESHOLD_MIN = 60
THRESHOLD_MAX = 960
CAP = 1.2
RATIO_TOL = 0.02
BLOCK_TOL_PX = 2
SLOT_MINUTES = 30
TAP_MIN_PX = 44
MAX_SUGGESTIONS = 8
SUGGEST_PAUSE_MS = 250
ROLLOVER_S = 60
FEED_PAST_DAYS = 7
FEED_FUTURE_DAYS = 28
TOKEN_MIN = 32
FILL_MAX_MS = 350
ROUTINE_MIN = 5
ROUTINE_MAX = 240
NAME_MAX = 80
CALENDAR_MAX_DAYS = 31
VIEWPORTS = ((375, 812), (768, 1024), (1280, 800))
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "Unlicense"}
FONTS = ("Fraunces", "IBM Plex Sans", "IBM Plex Mono")
FILL = '[data-part="waterline-fill"]'
TIDEMARK = '[data-part="tidemark"]'
GHOST = '[data-part="waterline-ghost"]'
SLOT_1000 = '[data-slot="10:00"]'
OVER = '[data-part="over-label"]'
FORBIDDEN_STORES = ("SQLite", "Redis")
KEYBOARD_START = "09:00"
REVIEW_MINUTES = 60
SEAT_PLAN = "daybook-seat-monthly"
PLANNING_MINUTES = 45

PASSWORD = "tidal-notebook-pass"
HTTP_TIMEOUT_S = 30
RECOVERY_DEADLINE_S = RECOVERY_S + RETRY_S + 20
MAIL_DEADLINE_S = 60
EXTRA_SETTLE_S = 5
CLOCK_SLACK_S = 15
POLL_PACE_S = 0.5
UI_DEADLINE_S = 20
UI_STEP_MS = 100
DRAG_SETTLE_MS = 400
BRIEF_AXE_RULES = ("color-contrast", "button-name", "link-name", "label", "select-name", "aria-dialog-name",
                   "aria-input-field-name", "aria-toggle-field-name", "aria-command-name")
FOCUS_ROLES = ("link", "button", "tab", "radio", "checkbox", "menuitem", "textbox", "combobox")
NPM_TIMEOUT_S = 900
FONT_WINDOW = 400
PARALLEL = 8
EVIL_ORIGIN = "https://elsewhere.invalid"
_PACE = threading.Event()


@dataclass
class Account:
    client: httpx.Client
    email: str
    name: str
    member: dict
    workspace: dict


def ident(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    return (first, second) if "@" in second else (second, first)


def http(base: str) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_TIMEOUT_S)


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso_z(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ics_stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def local_dt(day: date, hhmm: str, tz: str) -> datetime:
    hours, minutes = (int(x) for x in hhmm.split(":"))
    return datetime(day.year, day.month, day.day, hours, minutes, tzinfo=ZoneInfo(tz))


def day_label(day: date) -> str:
    return f"{day.strftime('%A')} {day.day} {day.strftime('%B')}"


def short_day(day: date) -> str:
    return f"{day.strftime('%a')} {day.day}"


def iso_week(day: date) -> str:
    year, week, _ = day.isocalendar()
    return f"{year}-W{week:02d}"


def shift_time(hhmm: str, minutes: int) -> str:
    hours, mins = (int(x) for x in hhmm.split(":"))
    total = hours * 60 + mins + minutes
    return f"{total // 60:02d}:{total % 60:02d}"


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}")
        _PACE.wait(POLL_PACE_S)


def server_now(base: str) -> datetime:
    response = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
    return parsedate_to_datetime(response.headers["date"])


def local_dates(moment: datetime, tz: str) -> set[date]:
    zone = ZoneInfo(tz)
    slack = timedelta(seconds=CLOCK_SLACK_S)
    return {(moment - slack).astimezone(zone).date(), (moment + slack).astimezone(zone).date()}


def error_code(response: httpx.Response) -> str:
    return response.json().get("error")


def create_workspace(base: str, tz: str = "Europe/London", prefix: str = "owner") -> Account:
    label, email = ident(prefix)
    client = http(base)
    response = client.post(
        "/api/workspaces",
        json={"workspaceName": label, "ownerName": f"{label} planner", "email": email, "password": PASSWORD, "timeZone": tz},
    )
    assert response.status_code == 201, response.text
    data = response.json()
    return Account(client, email, data["member"]["name"], data["member"], data["workspace"])


def sign_in(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    client = http(base)
    response = client.post("/api/auth/sign-in", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return client


def today_of(acc: Account) -> date:
    return date.fromisoformat(acc.client.get("/api/me").json()["today"])


def add_task(acc: Account, title: str, estimate: int | None = None, day: date | None = None) -> dict:
    body: dict[str, Any] = {"title": title}
    if estimate is not None:
        body["estimateMinutes"] = estimate
    if day is not None:
        body["dayDate"] = day.isoformat()
    response = acc.client.post("/api/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()["task"]


def board(acc: Account, start: date | None = None) -> dict:
    params = {"start": start.isoformat()} if start else None
    response = acc.client.get("/api/board", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def day_of(snapshot: dict, day: date) -> dict:
    return next(d for d in snapshot["days"] if d["date"] == day.isoformat())


def tasks_of(snapshot: dict) -> list[dict]:
    out = list(snapshot["backlog"])
    for day in snapshot["days"]:
        out.extend(day["tasks"])
    return out


def task_now(acc: Account, task_id: Any, start: date | None = None) -> dict:
    return next(t for t in tasks_of(board(acc, start)) if t["id"] == task_id)


def patch_task(acc: Account, task: dict, **fields: Any) -> httpx.Response:
    return acc.client.patch(f"/api/tasks/{task['id']}", json={"version": task["version"], **fields})


def timebox(acc: Account, task_id: Any, day: date, start: str, key: str | None = None) -> httpx.Response:
    return acc.client.post(
        "/api/sessions",
        json={"taskId": task_id, "date": day.isoformat(), "startTime": start},
        headers={"Idempotency-Key": key or idempotency_key()},
    )


def calendar_items(acc: Account, first: date, last: date) -> list[dict]:
    response = acc.client.get("/api/calendar", params={"from": first.isoformat(), "to": last.isoformat()})
    assert response.status_code == 200, response.text
    return response.json()["items"]


def add_routine(acc: Account, name: str, start: str, minutes: int, repeats: str = "daily") -> dict:
    response = acc.client.post("/api/routines", json={"name": name, "startTime": start, "durationMinutes": minutes, "repeats": repeats})
    assert response.status_code == 201, response.text
    return response.json()["routine"]


def csv_bytes(rows: list[list[str]]) -> bytes:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\n").writerows(rows)
    return buffer.getvalue().encode()


def import_tasks(acc: Account, data: bytes, ctype: str = "text/csv") -> httpx.Response:
    return acc.client.post("/api/imports/tasks", content=data, headers={"Content-Type": ctype})


def import_calendar(acc: Account, data: bytes, ctype: str = "text/calendar") -> httpx.Response:
    return acc.client.post("/api/imports/calendar", content=data, headers={"Content-Type": ctype})


def ics(*events: list[str]) -> bytes:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//tidemark-verifier//EN"]
    for event in events:
        lines += ["BEGIN:VEVENT", *event, "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return ("\r\n".join(lines) + "\r\n").encode()


def utc_event(uid: str, summary: str, start: datetime, end: datetime) -> list[str]:
    return [f"UID:{uid}", f"SUMMARY:{summary}", f"DTSTART:{ics_stamp(start)}", f"DTEND:{ics_stamp(end)}"]


def overlap_minutes(intervals: list[tuple[datetime, datetime]], day: date, tz: str) -> int:
    zone = ZoneInfo(tz)
    following = day + timedelta(days=1)
    low = datetime(day.year, day.month, day.day, tzinfo=zone)
    high = datetime(following.year, following.month, following.day, tzinfo=zone)
    total = 0.0
    for start, end in intervals:
        a, b = max(start, low), min(end, high)
        if b > a:
            total += (b - a).total_seconds() / 60
    return round(total)


def vevents(body: str) -> list[dict[str, str]]:
    lines: list[str] = []
    for raw in body.replace("\r\n", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    events: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in lines:
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT" and current is not None:
            events.append(current)
            current = None
        elif current is not None and ":" in line:
            key, value = line.split(":", 1)
            current[key.split(";")[0].upper()] = value
    return events


def feed_url(acc: Account) -> str:
    response = acc.client.get("/api/feed")
    assert response.status_code == 200, response.text
    return response.json()["url"]


def fetch_feed(base: str, url: str, method: str = "GET", **kwargs: Any) -> httpx.Response:
    return httpx.request(method, base.rstrip("/") + urlparse(url).path, timeout=HTTP_TIMEOUT_S, **kwargs)


def billing_callback(
    base: str,
    workspace_id: Any,
    kind: str,
    occurred: datetime,
    *,
    event_id: str | None = None,
    seats: int | None = None,
    timestamp: int | None = None,
    secret: str | None = None,
    tamper: bool = False,
) -> httpx.Response:
    body: dict[str, Any] = {"eventId": event_id or f"evt-{uuid.uuid4().hex}", "type": kind, "workspaceId": workspace_id, "occurredAt": iso_z(occurred)}
    if seats is not None:
        body["seats"] = seats
    raw = json.dumps(body).encode()
    stamp = str(timestamp if timestamp is not None else int(server_now(base).timestamp()))
    key = (secret if secret is not None else os.environ["KILLBILL_API_SECRET"]).encode()
    signature = "v1=" + hmac.new(key, stamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    if tamper:
        raw = raw.replace(kind.encode(), b"payment.failed" if kind != "payment.failed" else b"payment.succeeded")
    return httpx.post(
        base.rstrip("/") + "/api/billing/callbacks",
        content=raw,
        headers={"Content-Type": JSON_CT, "X-Tidemark-Timestamp": stamp, "X-Tidemark-Signature": signature},
        timeout=HTTP_TIMEOUT_S,
    )


def state_of(acc: Account) -> dict:
    return acc.client.get("/api/me").json()["workspace"]


def operator(base: str) -> httpx.Client:
    return sign_in(base, OPERATOR_EMAIL, SEED_PASSWORD)


def ops_row(base: str, workspace_id: Any) -> dict:
    rows = operator(base).get("/api/ops/workspaces").json()["workspaces"]
    return next(r for r in rows if r["id"] == workspace_id)


def matching(messages: list[dict], address: str, subject: str | None = None) -> list[dict]:
    found = []
    for message in messages:
        recipients = [a.lower() for a in addresses(message.get("To"))]
        if address.lower() in recipients and (subject is None or message.get("Subject") == subject):
            found.append(message)
    return found


def wait_mail(mail: Any, address: str, subject: str | None, expected: int = 1, seconds: float = MAIL_DEADLINE_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    while True:
        found = matching(mail.messages(), address, subject)
        if len(found) >= expected or time.monotonic() > deadline:
            return found


def settled_mail(mail: Any, address: str, subject: str | None) -> list[dict]:
    return matching(mail.messages(settle=EXTRA_SETTLE_S), address, subject)


def invite_subject(owner: Account) -> str:
    return f"{owner.name} invited you to {owner.workspace['name']} on Tidemark Daybook"


def join_token(message: dict) -> str:
    found = re.search(r"/join/([A-Za-z0-9_\-~%.]+)", text(message))
    assert found, "invite email carries no /join/<token> link"
    return found.group(1).rstrip(".")


def invite_and_join(base: str, owner: Account, mail: Any, tz: str = "Europe/London", prefix: str = "member") -> Account:
    label, email = ident(prefix)
    response = owner.client.post("/api/workspace/invitations", json={"email": email})
    assert response.status_code == 201, response.text
    messages = wait_mail(mail, email, invite_subject(owner))
    assert messages, "invite email never arrived"
    client = http(base)
    accepted = client.post(f"/api/invitations/{join_token(messages[0])}/accept", json={"name": label, "password": PASSWORD, "timeZone": tz})
    assert accepted.status_code == 201, accepted.text
    data = accepted.json()
    return Account(client, email, label, data["member"], data["workspace"])


def members_of(owner: Account) -> dict:
    response = owner.client.get("/api/workspace/members")
    assert response.status_code == 200, response.text
    return response.json()


def seat_keys(workspace_id: Any, killbill: Any) -> set[str]:
    account = killbill.account_by_key(str(workspace_id))
    if not account:
        return set()
    response = httpx.get(
        os.environ["KILLBILL_URL"].rstrip("/") + f"/1.0/kb/accounts/{account['accountId']}/bundles",
        auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
        headers={"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"], "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"], "Accept": "application/json"},
        timeout=HTTP_TIMEOUT_S,
    )
    assert response.status_code == 200, response.text
    return {
        bundle["externalKey"]
        for bundle in response.json()
        for subscription in bundle.get("subscriptions") or []
        if subscription.get("planName") == SEAT_PLAN and str(subscription.get("state", "")).lower() == "active"
    }


def seats_match(killbill: Any, workspace_id: Any, member_ids: list[Any]) -> None:
    expected = {f"{workspace_id}:{member_id}" for member_id in member_ids}
    poll(lambda: seat_keys(workspace_id, killbill) == expected, RECOVERY_DEADLINE_S, f"Kill Bill active seats {sorted(expected)}")


@contextmanager
def ui(browser: Browser, base: str, width: int = 1280, height: int = 800, reduced: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, base, reduced_motion=reduced) as page:
        page.set_viewport_size({"width": width, "height": height})
        yield page


def wait_ui(page: Page, check: Callable[[], bool], what: str, step_ms: float = UI_STEP_MS) -> None:
    deadline = time.monotonic() + UI_DEADLINE_S
    while True:
        try:
            if check():
                return
        except Exception:
            pass
        if time.monotonic() > deadline:
            raise AssertionError(f"UI never showed {what}")
        advance(page, step_ms)


def status(page: Page) -> Locator:
    return page.get_by_role("status", name="Planner updates")


def says(page: Page, copy: str) -> None:
    wait_ui(page, lambda: copy in status(page).inner_text(), f"announcement {copy!r}")


def see(page: Page, locator: Locator, what: str = "element") -> None:
    wait_ui(page, lambda: locator.count() > 0 and locator.first.is_visible(), what)


def gone(page: Page, locator: Locator, what: str = "element gone") -> None:
    wait_ui(page, lambda: locator.count() == 0 or not locator.first.is_visible(), what)


def brief_axe(page: Page) -> None:
    page.evaluate(AXE.read_text())
    page.evaluate(
        """rules => {
          const result = {done: false, error: null, violations: []};
          Object.defineProperty(window, '__BRIEF_AXE__', {value: () => structuredClone(result), configurable: true});
          axe.run(document, {runOnly: {type: 'rule', values: rules}}).then(value => {
            result.violations = value.violations.map(v => ({id: v.id, nodes: v.nodes.map(n => n.target)})); result.done = true;
          }, error => { result.error = String(error); result.done = true; });
        }""",
        list(BRIEF_AXE_RULES),
    )
    wait_ui(page, lambda: page.evaluate("window.__BRIEF_AXE__()")["done"], "axe audit", step_ms=16)
    outcome = page.evaluate("window.__BRIEF_AXE__()")
    assert outcome["error"] is None, outcome["error"]
    assert not outcome["violations"], f"name or contrast violations: {outcome['violations']}"


def focused(page: Page, locator: Locator, what: str) -> None:
    wait_ui(page, lambda: locator.evaluate("e => e === document.activeElement"), what)


def clock_at_trial_start(page: Page, trial_ends_at: str) -> None:
    page.clock.set_system_time(instant(trial_ends_at) - timedelta(seconds=TRIAL_LENGTH_S - CLOCK_SLACK_S))
    page.reload()
    advance(page, UI_STEP_MS)


def focus_ring(handle: Locator) -> list[dict[str, str]]:
    return handle.evaluate("""e => {
      const props = ['outline-style', 'outline-width', 'outline-color', 'outline-offset', 'box-shadow', 'border-color'];
      const read = (el, pseudo) => { const s = getComputedStyle(el, pseudo);
        return Object.fromEntries(props.map(p => [p, s.getPropertyValue(p)])); };
      const slip = e.closest('li, [role="listitem"]');
      return [read(e), read(e, '::before'), read(e, '::after'), ...(slip ? [read(slip)] : [])];
    }""")


def focus_positions(page: Page, names: list[str], presses: int) -> dict[str, int]:
    targets = {}
    for name in names:
        found = None
        for role in FOCUS_ROLES:
            match = page.get_by_role(role, name=name, exact=True)
            found = match if found is None else found.or_(match)
        targets[name] = found
    positions: dict[str, int] = {}
    for press in range(presses):
        page.keyboard.press("Tab")
        for name, found in targets.items():
            if name not in positions and found.evaluate_all("els => els.includes(document.activeElement)"):
                positions[name] = press
    return positions


def ui_sign_in(page: Page, email: str, password: str = PASSWORD) -> None:
    form = page.get_by_role("form", name="Sign in")
    see(page, form, "sign-in form")
    fill(form.get_by_label("Email", exact=True), email)
    fill(form.get_by_label("Password", exact=True), password)
    click(form.get_by_role("button", name="Sign in"))
    see(page, page.get_by_role("navigation", name="Main"), "main navigation")


def day_region(page: Page, day: date) -> Locator:
    return page.get_by_role("region", name=day_label(day), exact=True)


def backlog(page: Page) -> Locator:
    return page.get_by_role("region", name="Backlog")


def calendar_strip(page: Page) -> Locator:
    return page.get_by_role("region", name="Calendar", exact=True)


def card(scope: Page | Locator, title: str) -> Locator:
    pg = scope if isinstance(scope, Page) else scope.page
    return scope.get_by_role("listitem").filter(has=pg.get_by_role("button", name=f"Move {title}", exact=True))


def move_button(page: Page, title: str) -> Locator:
    return page.get_by_role("button", name=f"Move {title}", exact=True)


def meter(page: Page, day: date) -> Locator:
    return page.get_by_role("meter", name=f"Load for {day_label(day)}")


def meter_reads(page: Page, day: date, planned: int, threshold: int = THRESHOLD) -> None:
    wanted = f"{planned} of {threshold} minutes"
    wait_ui(page, lambda: meter(page, day).get_attribute("aria-valuetext") == wanted, wanted)


def ritual(page: Page, step: str) -> None:
    click(page.get_by_role("navigation", name="Morning ritual").get_by_role("button", name=step, exact=True))


def in_view(page: Page, target: Locator) -> tuple[float, float]:
    box = target.bounding_box()
    view = page.viewport_size or {"width": 1280, "height": 800}
    if not box or box["y"] + box["height"] < 4 or box["y"] > view["height"] - 4:
        target.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
        box = target.bounding_box()
    assert box, "drop target missing"
    top, bottom = max(box["y"], 0), min(box["y"] + box["height"], view["height"])
    left, right = max(box["x"], 0), min(box["x"] + box["width"], view["width"])
    return (left + right) / 2, (top + bottom) / 2


def drag(page: Page, source: Locator, target: Locator, release: bool = True) -> None:
    source.scroll_into_view_if_needed()
    sx, sy = center(source)
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx + 8, sy + 8, steps=4)
    advance(page, DRAG_SETTLE_MS)
    tx, ty = in_view(page, target)
    page.mouse.move(tx, ty, steps=8)
    advance(page, DRAG_SETTLE_MS)
    if release:
        page.mouse.up()
        advance(page, DRAG_SETTLE_MS)


RULE_EDGE_JS = """e => { const s = getComputedStyle(e);
  const drawn = side => s.getPropertyValue(`border-${side}-style`) !== 'none' && parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0;
  return e.getBoundingClientRect().height > 4 ? (drawn('top') ? 'top' : drawn('bottom') ? 'bottom' : 'center') : 'center'; }"""
FONT_LICENCE = re.compile(r"OFL[- ]?1\.1|Open Font Licen[cs]e\W+(?:Version\s+)?1\.1", re.I)
ANIMATING_JS = "e => e.getAnimations({subtree: true}).length > 0"
PENDING_BUTTON_JS = """copy => [...document.querySelectorAll('button, [role="button"]')].some(b =>
  b.getAttribute('aria-busy') === 'true' &&
  ((b.textContent || '').includes(copy) || (b.getAttribute('aria-label') || '').includes(copy)))"""


def release_held(gate: Any) -> None:
    getattr(gate, "release", gate)()


def drag_by_slots(page: Page, block: Locator, slots: int) -> None:
    block.scroll_into_view_if_needed()
    settle(block)
    box = block.bounding_box()
    assert box, "session block has no box"
    sx, sy = center(block)
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx, sy + 8, steps=4)
    advance(page, DRAG_SETTLE_MS)
    page.mouse.move(sx, box["y"] + box["height"] * (slots + 0.5), steps=8)
    advance(page, DRAG_SETTLE_MS)
    page.mouse.up()
    advance(page, DRAG_SETTLE_MS)


def gauge(region: Locator) -> tuple[float, float, float]:
    settle(region)
    mark = region.locator(TIDEMARK)
    tide = mark.bounding_box()
    assert tide, "tidemark rule missing"
    fill_box = region.locator(FILL).bounding_box()
    assert fill_box, "waterline fill missing"
    base = fill_box["y"] + fill_box["height"]
    edge = mark.evaluate(RULE_EDGE_JS)
    line = tide["y"] if edge == "top" else tide["y"] + tide["height"] if edge == "bottom" else tide["y"] + tide["height"] / 2
    tide_height = base - line
    return fill_box["height"], tide_height, base


def target_size(locator: Locator) -> tuple[float, float]:
    size = locator.evaluate(
        """el => { const boxes = [el.getBoundingClientRect()];
        if (el.labels) for (const l of el.labels) boxes.push(l.getBoundingClientRect());
        return [Math.max(...boxes.map(b => b.width)), Math.max(...boxes.map(b => b.height))]; }"""
    )
    return size[0], size[1]


def test_sign_up_registers_trial_and_billing(app_url: str, killbill: Any) -> None:
    label, email = ident("signup")
    client = http(app_url)
    body = {"workspaceName": label, "ownerName": f"{label} planner", "email": email, "password": PASSWORD, "timeZone": "Pacific/Auckland"}
    response = client.post("/api/workspaces", json=body)
    assert response.status_code == 201, response.text
    data = response.json()
    workspace = data["workspace"]
    assert workspace["state"] == "trialing" and workspace["writable"] is True
    assert data["member"]["role"] == "owner" and data["member"]["email"].lower() == email.lower()
    assert data["billing"] in ("registered", "queued")
    cookie = response.headers.get("set-cookie", "")
    assert SESSION_COOKIE in cookie and "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    me = client.get("/api/me")
    assert me.status_code == 200 and me.json()["workspace"]["id"] == workspace["id"]
    assert workspace["trialEndsAt"].endswith("Z")
    sent_at = parsedate_to_datetime(response.headers["date"])
    assert abs((instant(workspace["trialEndsAt"]) - sent_at).total_seconds() - TRIAL_LENGTH_S) <= CLOCK_SLACK_S
    account = poll(lambda: killbill.account_by_key(str(workspace["id"])), RECOVERY_DEADLINE_S, "Kill Bill account for the workspace")
    assert account["name"] == label and account["email"].lower() == email.lower() and account["currency"] == "USD"
    seats_match(killbill, workspace["id"], [data["member"]["id"]])

    taken = http(app_url).post("/api/workspaces", json={**body, "email": email.upper()})
    assert taken.status_code == 409 and error_code(taken) == "email_taken"
    for field, value in (("password", "short"), ("timeZone", "Mars/Olympus"), ("workspaceName", "w" * (NAME_MAX + 1)), ("email", "not-an-email")):
        other_label, other_email = ident("badsignup")
        bad = http(app_url).post("/api/workspaces", json={**body, "email": other_email, field: value})
        assert bad.status_code == 422, (field, bad.text)
        assert field in bad.json().get("fields", {}), bad.text
        refused = http(app_url).post("/api/auth/sign-in", json={"email": other_email, "password": PASSWORD})
        assert refused.status_code == 401, "a refused sign-up must not create an account"


def test_trial_clock_notice_and_read_only(mail: Any) -> None:
    base = os.environ["APP_TRIAL_CLOCK_URL"]
    owner = create_workspace(base, "Pacific/Honolulu", "trialclock")
    workspace = owner.workspace
    assert workspace["state"] == "trialing"
    ends = instant(workspace["trialEndsAt"])
    early = owner.client.post("/api/tasks", json={"title": "Before the trial ends"})
    assert early.status_code == 201

    def read_only() -> dict | None:
        response = owner.client.get("/api/me")
        found = response.json()
        if found["workspace"]["state"] == "read_only":
            return {"me": found, "at": parsedate_to_datetime(response.headers["date"])}
        assert found["workspace"]["state"] == "trialing"
        return None

    remaining = max((ends - server_now(base)).total_seconds(), 0)
    seen = poll(read_only, remaining + TRIAL_SWEEP_S + CLOCK_SLACK_S, "trial end")
    assert seen["at"] >= ends - timedelta(seconds=CLOCK_SLACK_S), "workspace went read-only before trialEndsAt"
    assert seen["me"]["workspace"]["writable"] is False
    refused = owner.client.post("/api/tasks", json={"title": "After the trial ends"})
    assert refused.status_code == 402 and error_code(refused) == "workspace_read_only"

    subject = "Your Tidemark Daybook trial ends soon"
    assert wait_mail(mail, owner.email, subject), "no trial notice arrived"
    notices = settled_mail(mail, owner.email, subject)
    assert len(notices) == 1, f"expected one trial notice, got {len(notices)}"
    local = ends.astimezone(ZoneInfo("Pacific/Honolulu"))
    expected = f"Your trial for {workspace['name']} ends on {day_label(local.date())} at {local:%H:%M} (Pacific/Honolulu)."
    assert expected in text(notices[0])
    assert MAIL_FROM_ADDRESS in addresses(notices[0].get("From"))


def test_read_only_and_cancelled_refuse_planning_writes(app_url: str, mail: Any) -> None:
    for target, kinds in (
        ("read_only", ["subscription.trial_converted", "payment.failed", "payment.failed"]),
        ("cancelled", ["subscription.cancelled"]),
    ):
        owner = create_workspace(app_url, "Europe/London", "frozen")
        member = invite_and_join(app_url, owner, mail)
        today = today_of(owner)
        task = add_task(owner, f"{owner.name} frozen", 30, today)
        routine = add_routine(owner, f"{owner.name} drill", "08:00", 30)
        url = feed_url(owner)
        start = server_now(app_url)
        for index, kind in enumerate(kinds):
            response = billing_callback(app_url, owner.workspace["id"], kind, start + timedelta(seconds=index + 1))
            assert response.status_code == 200, response.text
        workspace = state_of(owner)
        assert workspace["state"] == target and workspace["writable"] is False
        _, invitee = ident("blocked")
        writes: list[tuple[str, str, dict]] = [
            ("POST", "/api/tasks", {"json": {"title": "Refused"}}),
            ("POST", "/api/tasks", {"json": {"title": ""}}),
            ("PATCH", f"/api/tasks/{task['id']}", {"json": {"version": task["version"], "title": "Changed"}}),
            ("POST", "/api/sessions", {"json": {"taskId": task["id"], "date": today.isoformat(), "startTime": "10:00"}, "headers": {"Idempotency-Key": idempotency_key()}}),
            ("POST", "/api/routines", {"json": {"name": "Refused", "startTime": "09:00", "durationMinutes": 15, "repeats": "daily"}}),
            ("DELETE", f"/api/routines/{routine['id']}", {}),
            ("POST", "/api/imports/tasks", {"content": csv_bytes([["external_id", "title"], ["R-1", "Refused"]]), "headers": {"Content-Type": "text/csv"}}),
            ("POST", "/api/imports/calendar", {"content": ics(), "headers": {"Content-Type": "text/calendar"}}),
            ("POST", "/api/shutdown", {"json": {}}),
            ("POST", "/api/workspace/invitations", {"json": {"email": invitee}}),
        ]
        for method, path, kwargs in writes:
            response = owner.client.request(method, path, **kwargs)
            assert response.status_code == 402 and error_code(response) == "workspace_read_only", (target, method, path, response.text)
        current = task_now(owner, task["id"])
        assert current["version"] == task["version"] and current["title"] == task["title"] and current["session"] is None
        assert owner.client.get("/api/board").status_code == 200
        assert owner.client.get("/api/calendar", params={"from": today.isoformat(), "to": today.isoformat()}).status_code == 200
        assert fetch_feed(app_url, url).status_code == 200
        sign_in(app_url, owner.email)
        settings = owner.client.patch("/api/me", json={"thresholdMinutes": 420})
        assert settings.status_code == 200 and settings.json()["member"]["thresholdMinutes"] == 420
        assert owner.client.post("/api/feed/rotate").status_code == 200
        removal = owner.client.delete(f"/api/workspace/members/{member.member['id']}")
        assert removal.status_code == 200, removal.text
        assert settled_mail(mail, invitee, None) == [], "a refused invite still sent mail"


def test_task_import_matching(app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "importer")
    today = today_of(owner)
    p = owner.name
    header = ["external_id", "title", "estimate_minutes", "due_date", "source"]
    due_one, due_two = (today + timedelta(days=10)).isoformat(), (today + timedelta(days=11)).isoformat()
    first = csv_bytes([
        header,
        ["A-1", f"{p} alpha", "30", due_one, "tracker"],
        ["A-2", f"{p} beta", "", "", "tracker"],
        ["A-2", f"{p} beta final", "45", "", "tracker"],
        ["", f"{p} no id", "15", "", "tracker"],
        ["A-3", f"{p} odd estimate", "7", "", "tracker"],
        ["A-4", "", "15", "", "tracker"],
        ["A-6", f"{p} bad due", "15", "someday", "tracker"],
    ])
    result = import_tasks(owner, first)
    assert result.status_code == 200, result.text
    data = result.json()
    assert (data["created"], data["updated"], data["unchanged"], data["merged"]) == (2, 0, 0, 1)
    assert sorted(r["line"] for r in data["rejected"]) == [5, 6, 7, 8]
    assert data["orphaned"] == [] and data["batchId"]

    def tracked() -> dict[str, list[dict]]:
        found: dict[str, list[dict]] = {}
        for t in tasks_of(board(owner)):
            if t["source"] == "tracker":
                found.setdefault(t["externalId"], []).append(t)
        return found

    cards = tracked()
    assert sorted(cards) == ["A-1", "A-2"] and all(len(v) == 1 for v in cards.values())
    assert cards["A-1"][0]["title"] == f"{p} alpha" and cards["A-1"][0]["estimateMinutes"] == 30 and cards["A-1"][0]["dueDate"] == due_one
    assert cards["A-2"][0]["title"] == f"{p} beta final" and cards["A-2"][0]["estimateMinutes"] == 45

    again = import_tasks(owner, first).json()
    assert (again["created"], again["updated"], again["unchanged"], again["merged"]) == (0, 0, 2, 1)
    assert len(tasks_of(board(owner))) == 2

    alpha = cards["A-1"][0]
    assert patch_task(owner, alpha, estimateMinutes=60, dayDate=today.isoformat()).status_code == 200
    alpha = task_now(owner, alpha["id"])
    assert patch_task(owner, alpha, status="done").status_code == 200
    beta = task_now(owner, cards["A-2"][0]["id"])
    assert patch_task(owner, beta, estimateMinutes=None).status_code == 200

    second = csv_bytes([header, ["A-1", f"{p} alpha v2", "30", due_two, "tracker"], ["A-2", f"{p} beta final", "45", "", "tracker"], ["A-5", f"{p} gamma", "20", "", "tracker"]])
    third = import_tasks(owner, second).json()
    assert (third["created"], third["updated"], third["unchanged"], third["merged"]) == (1, 2, 0, 0)
    cards = tracked()
    alpha = cards["A-1"][0]
    assert alpha["title"] == f"{p} alpha v2" and alpha["dueDate"] == due_two
    assert alpha["estimateMinutes"] == 60 and alpha["dayDate"] == today.isoformat() and alpha["status"] == "done"
    assert cards["A-2"][0]["estimateMinutes"] == 45

    orphan_run = import_tasks(owner, csv_bytes([header, ["A-5", f"{p} gamma", "20", "", "tracker"]])).json()
    assert {o["externalId"] for o in orphan_run["orphaned"]} == {"A-2"}
    assert orphan_run["unchanged"] == 1 and orphan_run["created"] == 0
    cards = tracked()
    assert sorted(cards) == ["A-1", "A-2", "A-5"] and all(len(v) == 1 for v in cards.values())

    other = create_workspace(app_url, "Europe/London", "importer2")
    assert import_tasks(other, first).json()["created"] == 2
    assert len(tracked()) == 3

    before = len(tasks_of(board(other)))
    bad = import_tasks(other, csv_bytes([["id", "name"], ["1", "x"]]))
    assert bad.status_code == 422 and error_code(bad) == "not_a_task_export"
    wrong = import_tasks(other, first, "text/plain")
    assert wrong.status_code == 415
    big = import_tasks(other, b"external_id,title\n" + b"x" * FILE_LIMIT)
    assert big.status_code == 413
    too_many = import_tasks(other, csv_bytes([["external_id", "title"]] + [[f"M-{i}", f"row {i}"] for i in range(MAX_ROWS + 1)]))
    assert too_many.status_code == 422 and error_code(too_many) == "too_many_rows"
    assert len(tasks_of(board(other))) == before, "a refused import created cards"
    bulk = create_workspace(app_url, "Europe/London", "bulk")
    ok = import_tasks(bulk, csv_bytes([["external_id", "title"]] + [[f"M-{i}", f"row {i}"] for i in range(MAX_ROWS)]))
    assert ok.status_code == 200 and ok.json()["created"] == MAX_ROWS


def test_suggestions_stay_in_scope(app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "suggest")
    token = uuid.uuid4().hex[:10]
    own = [add_task(owner, f"{token} own {i}") for i in range(10)]
    done = add_task(owner, f"{token} finished")
    assert patch_task(owner, done, status="done").status_code == 200
    member = invite_and_join(app_url, owner, mail)
    foreign_member = add_task(member, f"{token} teammate")
    stranger = create_workspace(app_url, "Europe/London", "suggest2")
    foreign_workspace = add_task(stranger, f"{token} stranger")
    touched = own[2]
    assert patch_task(owner, touched, title=f"{token} own touched").status_code == 200

    response = owner.client.get("/api/tasks/suggest", params={"q": token.upper()})
    assert response.status_code == 200
    suggestions = response.json()["suggestions"]
    assert len(suggestions) == MAX_SUGGESTIONS
    ids = {s["id"] for s in suggestions}
    assert ids <= {t["id"] for t in own}
    assert suggestions[0]["id"] == touched["id"]
    for foreign in (done, foreign_member, foreign_workspace):
        assert foreign["id"] not in ids
    member_view = member.client.get("/api/tasks/suggest", params={"q": token}).json()["suggestions"]
    assert [s["id"] for s in member_view] == [foreign_member["id"]]
    wren = sign_in(app_url, WREN_EMAIL, SEED_PASSWORD)
    assert wren.get("/api/tasks/suggest", params={"q": "retainer"}).json()["suggestions"] == []
    assert owner.client.get("/api/tasks/suggest", params={"q": ""}).status_code == 422
    assert owner.client.get("/api/tasks/suggest", params={"q": "q" * 101}).status_code == 422


def test_calendar_import_matching_and_load(app_url: str) -> None:
    tz = "Europe/London"
    owner = create_workspace(app_url, tz, "ics")
    today = today_of(owner)
    d1, d2, d3 = (today + timedelta(days=n) for n in (1, 2, 3))
    tag = uuid.uuid4().hex[:8]
    e1 = (local_dt(d1, "10:00", tz), local_dt(d1, "11:00", tz))
    e2_start = local_dt(d2, "11:00", tz)
    e3 = (local_dt(d2, "23:30", tz), local_dt(d3, "00:30", tz))

    def build(summary_one: str, shift: int) -> bytes:
        ny = (e2_start + timedelta(minutes=shift)).astimezone(ZoneInfo("America/New_York"))
        return ics(
            utc_event(f"u1-{tag}", summary_one, *e1),
            [f"UID:u2-{tag}", "SUMMARY:Second", f"DTSTART;TZID=America/New_York:{ny:%Y%m%dT%H%M%S}", "DURATION:PT45M"],
            utc_event(f"u3-{tag}", "Late", *e3),
            [f"UID:u4-{tag}", "SUMMARY:Holiday", f"DTSTART;VALUE=DATE:{d1:%Y%m%d}", f"DTEND;VALUE=DATE:{d2:%Y%m%d}"],
            utc_event(f"u5-{tag}", "Weekly", *e1) + ["RRULE:FREQ=WEEKLY"],
            ["SUMMARY:No uid", f"DTSTART:{ics_stamp(e1[0])}", f"DTEND:{ics_stamp(e1[1])}"],
            [f"UID:u7-{tag}", "SUMMARY:Floating", f"DTSTART:{d1:%Y%m%d}T120000", f"DTEND:{d1:%Y%m%d}T130000"],
            [f"UID:u8-{tag}", "SUMMARY:No end", f"DTSTART:{ics_stamp(e1[0])}"],
        )

    first = import_calendar(owner, build("First", 0))
    assert first.status_code == 200, first.text
    data = first.json()
    assert (data["created"], data["updated"], data["unchanged"], data["skipped"]) == (3, 0, 0, 5) and data["batchId"]
    intervals = [e1, (e2_start, e2_start + timedelta(minutes=45)), e3]
    snapshot = board(owner)
    for day in (d1, d2, d3):
        entry = day_of(snapshot, day)
        assert entry["meetingMinutes"] == overlap_minutes(intervals, day, tz), day
        assert entry["plannedMinutes"] == entry["taskMinutes"] + entry["meetingMinutes"] + entry["routineMinutes"]
    meetings = [i for i in calendar_items(owner, d1, d3) if i["kind"] == "meeting"]
    first_meeting = [i for i in meetings if i["title"] == "First"]
    assert len(first_meeting) == 1
    assert first_meeting[0]["startTime"] == "10:00" and first_meeting[0]["endTime"] == "11:00"
    assert instant(first_meeting[0]["start"]) == e1[0] and instant(first_meeting[0]["end"]) == e1[1]

    again = import_calendar(owner, build("First renamed", 30)).json()
    assert (again["created"], again["updated"], again["unchanged"], again["skipped"]) == (0, 2, 1, 5)
    moved = e2_start + timedelta(minutes=30)
    intervals = [e1, (moved, moved + timedelta(minutes=45)), e3]
    snapshot = board(owner)
    for day in (d1, d2, d3):
        assert day_of(snapshot, day)["meetingMinutes"] == overlap_minutes(intervals, day, tz)
    titles = [i["title"] for i in calendar_items(owner, d1, d3) if i["kind"] == "meeting"]
    assert titles.count("First renamed") == 1 and "First" not in titles

    other = create_workspace(app_url, tz, "ics2")
    assert import_calendar(other, build("First", 0)).json()["created"] == 3
    assert import_calendar(owner, build("First", 0), "text/plain").status_code == 415
    junk = import_calendar(owner, b"hello")
    assert junk.status_code == 422 and error_code(junk) == "not_a_calendar"
    assert import_calendar(owner, b"B" * (FILE_LIMIT + 1)).status_code == 413


def test_day_load_is_derived(app_url: str) -> None:
    tz = "Europe/London"
    owner = create_workspace(app_url, tz, "load")
    day = today_of(owner) + timedelta(days=1)
    fake = {"plannedMinutes": 999, "taskMinutes": 999, "overByMinutes": 999}
    response = owner.client.post("/api/tasks", json={"title": f"{owner.name} heavy", "estimateMinutes": 90, "dayDate": day.isoformat(), **fake})
    assert response.status_code == 201
    heavy = response.json()["task"]
    affected = next(d for d in response.json()["days"] if d["date"] == day.isoformat())
    assert affected["taskMinutes"] == 90 and affected["plannedMinutes"] == 90
    add_task(owner, f"{owner.name} unsized", None, day)
    finished = add_task(owner, f"{owner.name} finished", 30, day)
    assert patch_task(owner, finished, status="done", **fake).status_code == 200
    add_routine(owner, f"{owner.name} drill", "08:00", 45)
    start = local_dt(day, "12:00", tz)
    assert import_calendar(owner, ics(utc_event(f"load-{uuid.uuid4().hex}", "Meeting", start, start + timedelta(minutes=60)))).status_code == 200
    task_minutes, meeting_minutes, routine_minutes = 90 + 30, 60, 45
    planned = task_minutes + meeting_minutes + routine_minutes
    entry = day_of(board(owner), day)
    assert (entry["taskMinutes"], entry["meetingMinutes"], entry["routineMinutes"], entry["plannedMinutes"], entry["overByMinutes"]) == (task_minutes, meeting_minutes, routine_minutes, planned, 0)
    low = 180
    lowered = owner.client.patch("/api/me", json={"thresholdMinutes": low, "plannedMinutes": 1})
    assert lowered.status_code == 200
    entry = day_of(board(owner), day)
    assert entry["plannedMinutes"] == planned and entry["overByMinutes"] == planned - low
    assert timebox(owner, heavy["id"], day, "10:00").status_code == 201
    assert day_of(board(owner), day)["plannedMinutes"] == planned
    for bad in (THRESHOLD_MIN - 1, THRESHOLD_MAX + 15, 70):
        assert owner.client.patch("/api/me", json={"thresholdMinutes": bad}).status_code == 422
    for good in (THRESHOLD_MAX, THRESHOLD_MIN):
        assert owner.client.patch("/api/me", json={"thresholdMinutes": good}).status_code == 200
    assert day_of(board(owner), day)["overByMinutes"] == planned - THRESHOLD_MIN


def test_today_follows_profile_zone(app_url: str) -> None:
    for tz in ("Pacific/Auckland", "Pacific/Honolulu"):
        acc = create_workspace(app_url, tz, "zone")
        response = acc.client.get("/api/me")
        today = date.fromisoformat(response.json()["today"])
        assert today in local_dates(parsedate_to_datetime(response.headers["date"]), tz)
        snapshot = board(acc)
        assert snapshot["today"] == today.isoformat() and snapshot["timeZone"] == tz
        assert [d["date"] for d in snapshot["days"]] == [(today + timedelta(days=i)).isoformat() for i in range(5)]
        assert [d["label"] for d in snapshot["days"]] == [day_label(today + timedelta(days=i)) for i in range(5)]
        task = add_task(acc, f"{acc.name} dated", 30)
        past = patch_task(acc, task, dayDate=(today - timedelta(days=1)).isoformat())
        assert past.status_code == 422 and error_code(past) == "day_in_past"
        assert task_now(acc, task["id"])["version"] == task["version"]
        assert patch_task(acc, task, dayDate=today.isoformat()).status_code == 200
        created = acc.client.post("/api/tasks", json={"title": "Yesterday", "dayDate": (today - timedelta(days=1)).isoformat()})
        assert created.status_code == 422 and error_code(created) == "day_in_past"
        sized = add_task(acc, f"{acc.name} sized", 30)
        late = timebox(acc, sized["id"], today - timedelta(days=1), "10:00")
        assert late.status_code == 422 and error_code(late) == "day_in_past"

    mover = create_workspace(app_url, "Pacific/Honolulu", "zonemove")
    old_today = today_of(mover)
    dated = add_task(mover, f"{mover.name} old today", 30, old_today)
    changed = mover.client.patch("/api/me", json={"timeZone": "Pacific/Auckland"})
    assert changed.status_code == 200
    new_today = date.fromisoformat(changed.json()["today"])
    assert new_today in local_dates(parsedate_to_datetime(changed.headers["date"]), "Pacific/Auckland")
    snapshot = board(mover)
    if old_today < new_today:
        parked = [t for t in snapshot["backlog"] if t["id"] == dated["id"]]
        assert parked and parked[0]["dayDate"] == old_today.isoformat()
        assert all(dated["id"] not in [t["id"] for t in d["tasks"]] for d in snapshot["days"])
        assert all(d["taskMinutes"] == 0 for d in snapshot["days"])
    else:
        assert day_of(snapshot, old_today)["taskMinutes"] == 30
    assert mover.client.get("/api/board", params={"start": "not-a-date"}).status_code == 422


def test_waterline_geometry(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "gauge")
    today = today_of(owner)
    plan = {today: 180, today + timedelta(days=1): 360, today + timedelta(days=2): 600, today + timedelta(days=3): 90}
    for day, minutes in plan.items():
        add_task(owner, f"{owner.name} {day.isoformat()}", minutes, day)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        for day, minutes in plan.items():
            region = day_region(page, day)
            meter_reads(page, day, minutes)
            gauge_meter = meter(page, day)
            assert float(gauge_meter.get_attribute("aria-valuemax") or gauge_meter.get_attribute("max") or "nan") == pytest.approx(THRESHOLD * CAP)
            assert float(gauge_meter.get_attribute("aria-valuemin") or gauge_meter.get_attribute("min") or "0") == 0
            assert float(gauge_meter.get_attribute("aria-valuenow") or gauge_meter.get_attribute("value") or "nan") == pytest.approx(min(minutes, THRESHOLD * CAP))
            expect(region).to_contain_text(f"{minutes}m")
            height, tide_height, _ = gauge(region)
            expected = min(minutes / THRESHOLD, CAP)
            assert abs(height / tide_height - expected) <= RATIO_TOL * expected + 1 / tide_height, (day, height, tide_height)
            over = region.locator(OVER)
            if minutes > THRESHOLD:
                see(page, over, "over label")
                expect(over).to_contain_text(f"Over by {minutes - THRESHOLD}m")
            else:
                expect(over).to_have_count(0)


def test_drag_preview_ghost(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "ghost")
    today = today_of(owner)
    tomorrow = today + timedelta(days=1)
    add_task(owner, f"{owner.name} case study", 300, tomorrow)
    add_routine(owner, f"{owner.name} inbox", "08:30", 30)
    title = f"{owner.name} proposal"
    add_task(owner, title, 45)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        meter_reads(page, tomorrow, 330)
        handle = move_button(page, title)
        handle.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        region = day_region(page, tomorrow)
        see(page, region.locator(GHOST), "ghost on tomorrow")
        see(page, region.locator(OVER), "over label on tomorrow")
        expect(region.locator(OVER)).to_contain_text(f"Over by {300 + 30 + 45 - THRESHOLD}m")
        advance(page, DRAG_SETTLE_MS)
        settle(region.locator(GHOST))
        fill_height, tide_height, base = gauge(region)
        ghost_box = region.locator(GHOST).bounding_box()
        assert ghost_box
        assert abs(ghost_box["height"] / tide_height - 45 / THRESHOLD) <= RATIO_TOL * (45 / THRESHOLD) + 1 / tide_height
        assert abs((ghost_box["y"] + ghost_box["height"]) - (base - fill_height)) <= BLOCK_TOL_PX
        wait_ui(page, lambda: day_region(page, today).locator(GHOST).count() == 0, "ghost shrinks away from today")
        page.keyboard.press("Escape")
        gone(page, region.locator(GHOST), "ghost cleared after Escape")
        expect(region.locator(OVER)).to_have_count(0)

        drag(page, handle, day_region(page, today), release=False)
        see(page, day_region(page, today).locator(GHOST), "pointer ghost on today")
        expect(day_region(page, today).locator(OVER)).to_have_count(0)
        tx, ty = in_view(page, region)
        page.mouse.move(tx, ty, steps=8)
        advance(page, DRAG_SETTLE_MS)
        see(page, region.locator(GHOST), "pointer ghost on tomorrow")
        see(page, region.locator(OVER), "pointer over label")
        gone(page, day_region(page, today).locator(GHOST), "ghost leaves today")
        bx, by = in_view(page, backlog(page))
        page.mouse.move(bx, by, steps=8)
        advance(page, DRAG_SETTLE_MS)
        gone(page, region.locator(OVER), "over label leaves")
        gone(page, region.locator(GHOST), "ghost leaves tomorrow")
        page.mouse.up()
        advance(page, DRAG_SETTLE_MS)
        see(page, card(backlog(page), title), "card still in Backlog")
    assert next(t for t in board(owner)["backlog"] if t["title"] == title)["dayDate"] is None


def test_task_versions(app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "versions")
    today = today_of(owner)
    task = add_task(owner, f"{owner.name} versioned", 30)
    assert task["version"] == 1
    first = patch_task(owner, task, title=f"{owner.name} renamed")
    assert first.status_code == 200 and first.json()["task"]["version"] == 2
    stale = patch_task(owner, task, title=f"{owner.name} lost write")
    assert stale.status_code == 409 and error_code(stale) == "version_conflict"
    current = stale.json()["current"]
    assert current["version"] == 2 and current["title"] == f"{owner.name} renamed"
    stored = task_now(owner, task["id"])
    assert stored["title"] == f"{owner.name} renamed" and stored["version"] == 2
    past_and_stale = patch_task(owner, task, dayDate=(today - timedelta(days=1)).isoformat())
    assert past_and_stale.status_code == 409
    member = invite_and_join(app_url, owner, mail)
    foreign = member.client.patch(f"/api/tasks/{task['id']}", json={"version": 2, "title": "hijack"})
    assert foreign.status_code == 404
    assert task_now(owner, task["id"])["title"] == f"{owner.name} renamed"

    day = today + timedelta(days=1)
    planned = add_task(owner, f"{owner.name} planned", 30, day)
    assert timebox(owner, planned["id"], day, "10:00").status_code == 201
    planned = task_now(owner, planned["id"])
    marked = patch_task(owner, planned, status="done")
    assert marked.status_code == 200 and marked.json()["task"]["session"] is not None
    planned = marked.json()["task"]
    moved = patch_task(owner, planned, dayDate=(day + timedelta(days=1)).isoformat())
    assert moved.status_code == 200 and moved.json()["task"]["session"] is None
    assert moved.json()["task"]["version"] == planned["version"] + 1


def test_timebox_idempotent_once(app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "timebox")
    today = today_of(owner)
    day = today + timedelta(days=1)
    task = add_task(owner, f"{owner.name} block", 30)
    body = {"taskId": task["id"], "date": day.isoformat(), "startTime": "10:00"}
    missing = owner.client.post("/api/sessions", json=body)
    assert missing.status_code == 400 and error_code(missing) == "idempotency_key_required"
    key = idempotency_key()
    created = timebox(owner, task["id"], day, "10:00", key)
    assert created.status_code == 201, created.text
    stored = created.json()
    assert stored["session"]["startTime"] == "10:00" and stored["session"]["endTime"] == shift_time("10:00", 30)
    assert stored["task"]["dayDate"] == day.isoformat() and stored["task"]["version"] == task["version"] + 1
    replay = timebox(owner, task["id"], day, "10:00", key)
    assert replay.status_code == 201 and replay.json() == stored
    assert replay.headers.get("Idempotent-Replayed") == "true"
    spare = add_task(owner, f"{owner.name} spare", 30)
    mismatch = timebox(owner, spare["id"], day, "11:00", key)
    assert mismatch.status_code == 422 and error_code(mismatch) == "idempotency_key_mismatch"
    assert task_now(owner, spare["id"])["session"] is None
    second = timebox(owner, task["id"], day, "11:00")
    assert second.status_code == 409 and error_code(second) == "already_scheduled"
    late_replay = timebox(owner, task["id"], day, "10:00", key)
    assert late_replay.status_code == 201 and late_replay.json() == stored

    unsized = add_task(owner, f"{owner.name} unsized")
    assert error_code(timebox(owner, unsized["id"], day, "10:00")) == "estimate_required"
    long = add_task(owner, f"{owner.name} late", 60)
    crossing = timebox(owner, long["id"], day, "23:30")
    assert crossing.status_code == 422 and error_code(crossing) == "crosses_midnight"
    assert timebox(owner, long["id"], day, "10:15").status_code == 422
    assert error_code(timebox(owner, long["id"], today - timedelta(days=1), "10:00")) == "day_in_past"

    raced = add_task(owner, f"{owner.name} raced", 30)
    cookies = dict(owner.client.cookies)

    def fire(key_value: str) -> httpx.Response:
        with httpx.Client(base_url=app_url.rstrip("/"), timeout=HTTP_TIMEOUT_S, cookies=cookies) as client:
            return client.post("/api/sessions", json={"taskId": raced["id"], "date": day.isoformat(), "startTime": "12:00"}, headers={"Idempotency-Key": key_value})

    with ThreadPoolExecutor(PARALLEL) as pool:
        results = list(pool.map(fire, [idempotency_key() for _ in range(PARALLEL)]))
    assert sorted(r.status_code for r in results) == [201] + [409] * (PARALLEL - 1)
    assert all(error_code(r) == "already_scheduled" for r in results if r.status_code == 409)

    shared = add_task(owner, f"{owner.name} shared", 30)
    shared_key = idempotency_key()

    def fire_same(_: int) -> httpx.Response:
        with httpx.Client(base_url=app_url.rstrip("/"), timeout=HTTP_TIMEOUT_S, cookies=cookies) as client:
            return client.post("/api/sessions", json={"taskId": shared["id"], "date": day.isoformat(), "startTime": "14:00"}, headers={"Idempotency-Key": shared_key})

    with ThreadPoolExecutor(PARALLEL) as pool:
        same = list(pool.map(fire_same, range(PARALLEL)))
    assert all(r.status_code == 201 for r in same)
    assert len({r.json()["session"]["id"] for r in same}) == 1

    events = vevents(fetch_feed(app_url, feed_url(owner)).text)
    for name in (task["title"], raced["title"], shared["title"]):
        assert [e["SUMMARY"] for e in events].count(name) == 1, name
    sessions = [i for i in calendar_items(owner, day, day) if i["kind"] == "session"]
    assert sorted(i["title"] for i in sessions) == sorted([task["title"], raced["title"], shared["title"]])


def test_session_version_winner(app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "winner")
    today = today_of(owner)
    d1, d2 = today + timedelta(days=1), today + timedelta(days=2)
    cookies = dict(owner.client.cookies)
    for round_index in range(4):
        task = add_task(owner, f"{owner.name} round {round_index}", 30)
        created = timebox(owner, task["id"], d1, "10:00")
        assert created.status_code == 201
        sid = created.json()["session"]["id"]
        gate = threading.Barrier(2)
        moves = [{"version": 1, "date": d1.isoformat(), "startTime": "11:00"}, {"version": 1, "date": d2.isoformat(), "startTime": "14:00"}]

        def save(move: dict) -> httpx.Response:
            with httpx.Client(base_url=app_url.rstrip("/"), timeout=HTTP_TIMEOUT_S, cookies=cookies) as client:
                gate.wait()
                return client.patch(f"/api/sessions/{sid}", json=move)

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(save, moves))
        assert sorted(r.status_code for r in results) == [200, 409]
        winner = next(r for r in results if r.status_code == 200).json()["session"]
        loser = next(r for r in results if r.status_code == 409)
        assert error_code(loser) == "version_conflict"
        current = loser.json()["current"]
        for field in ("date", "startTime", "endTime", "start", "end", "version"):
            assert current[field] == winner[field], field
        stored = [i for i in calendar_items(owner, d1, d2) if i["kind"] == "session" and i["id"] == sid]
        assert len(stored) == 1
        assert (stored[0]["date"], stored[0]["startTime"], stored[0]["endTime"]) == (winner["date"], winner["startTime"], winner["endTime"])
        assert task_now(owner, task["id"])["dayDate"] == winner["date"]


def test_removed_session_stays_removed(app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "removed")
    day = today_of(owner) + timedelta(days=1)
    rows = [["external_id", "title", "estimate_minutes", "source"], ["R-1", f"{owner.name} imported", "30", "tracker"]]
    assert import_tasks(owner, csv_bytes(rows)).json()["created"] == 1
    task = next(t for t in board(owner)["backlog"] if t["externalId"] == "R-1")
    session_data = timebox(owner, task["id"], day, "10:00").json()["session"]
    uid = f"session-{session_data['id']}@tidemark"
    url = feed_url(owner)
    assert uid in [e.get("UID") for e in vevents(fetch_feed(app_url, url).text)]
    stale = owner.client.delete(f"/api/sessions/{session_data['id']}", params={"version": session_data["version"] + 1})
    assert stale.status_code == 409 and error_code(stale) == "version_conflict"
    deleted = owner.client.delete(f"/api/sessions/{session_data['id']}", params={"version": session_data["version"]})
    assert deleted.status_code == 204

    def absent() -> None:
        assert not [i for i in calendar_items(owner, day, day) if i["kind"] == "session"]
        current = task_now(owner, task["id"])
        assert current["session"] is None and current["dayDate"] == day.isoformat()
        assert uid not in [e.get("UID") for e in vevents(fetch_feed(app_url, url).text)]

    absent()
    rows[1][1] = f"{owner.name} imported again"
    assert import_tasks(owner, csv_bytes(rows)).json()["updated"] == 1
    absent()
    assert owner.client.delete(f"/api/sessions/{session_data['id']}", params={"version": session_data["version"]}).status_code == 404


def _transitions(tz: str, start: date) -> list[tuple[date, str]]:
    zone = ZoneInfo(tz)
    found: list[tuple[date, str]] = []
    for offset in range(1, 400):
        day = start + timedelta(days=offset)
        before = datetime(day.year, day.month, day.day, tzinfo=zone) - timedelta(hours=12)
        after = datetime(day.year, day.month, day.day, 12, tzinfo=zone)
        if before.utcoffset() != after.utcoffset():
            found.append((day, "gap" if after.utcoffset() > before.utcoffset() else "overlap"))
    return found


def _odd_time(day: date, tz: str, kind: str) -> str:
    zone = ZoneInfo(tz)
    for minutes in range(0, 24 * 60, 30):
        naive = datetime(day.year, day.month, day.day, minutes // 60, minutes % 60)
        early, late = naive.replace(tzinfo=zone, fold=0), naive.replace(tzinfo=zone, fold=1)
        roundtrip = early.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)
        if kind == "gap" and roundtrip != naive:
            return f"{naive:%H:%M}"
        if kind == "overlap" and early.utcoffset() != late.utcoffset():
            return f"{naive:%H:%M}"
    raise AssertionError(f"no {kind} time on {day} in {tz}")


def _expected_start(day: date, hhmm: str, tz: str) -> datetime:
    zone = ZoneInfo(tz)
    hours, minutes = (int(x) for x in hhmm.split(":"))
    naive = datetime(day.year, day.month, day.day, hours, minutes)
    early = naive.replace(tzinfo=zone, fold=0)
    if early.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) == naive:
        return early.astimezone(timezone.utc)
    before = (naive - timedelta(hours=6)).replace(tzinfo=zone).utcoffset()
    after = (naive + timedelta(hours=6)).replace(tzinfo=zone).utcoffset()
    assert before is not None and after is not None
    shifted = naive + (after - before)
    return (shifted - after).replace(tzinfo=timezone.utc)


def test_routines_dst(app_url: str) -> None:
    for tz in ("Europe/London", "America/New_York"):
        owner = create_workspace(app_url, tz, "dst")
        today = today_of(owner)
        changes = _transitions(tz, today)
        assert {kind for _, kind in changes} >= {"gap", "overlap"}
        for change_day, kind in changes[:2]:
            hhmm = _odd_time(change_day, tz, kind)
            daily = add_routine(owner, f"{owner.name} {kind} daily", hhmm, 45)
            weekdays = add_routine(owner, f"{owner.name} {kind} weekdays", "09:00", 15, "weekdays")
            first, last = change_day - timedelta(days=3), change_day + timedelta(days=3)
            items = calendar_items(owner, first, last)
            days = [first + timedelta(days=i) for i in range(7)]
            mine = [i for i in items if i["kind"] == "routine" and str(i["id"]).startswith(f"{daily['id']}:")]
            assert sorted(i["date"] for i in mine) == [d.isoformat() for d in days]
            for item in mine:
                day = date.fromisoformat(item["date"])
                assert item["id"] == f"{daily['id']}:{item['date']}"
                start = _expected_start(day, hhmm, tz)
                assert instant(item["start"]) == start, (tz, kind, item)
                assert instant(item["end"]) == start + timedelta(minutes=45)
                if day != change_day or kind == "overlap":
                    assert item["startTime"] == hhmm
            weekly = [i for i in items if i["kind"] == "routine" and str(i["id"]).startswith(f"{weekdays['id']}:")]
            assert sorted(i["date"] for i in weekly) == [d.isoformat() for d in days if d.weekday() < 5]
            assert all(i["startTime"] == "09:00" for i in weekly)
            assert owner.client.delete(f"/api/routines/{daily['id']}").status_code == 204
            assert not [i for i in calendar_items(owner, first, last) if str(i["id"]).startswith(f"{daily['id']}:")]
    owner = create_workspace(app_url, "Europe/London", "routinerules")
    for minutes in (ROUTINE_MIN, ROUTINE_MAX):
        add_routine(owner, f"{owner.name} {minutes}", "07:00", minutes)
    for minutes in (ROUTINE_MIN - 1, ROUTINE_MAX + ROUTINE_MIN, 7):
        assert owner.client.post("/api/routines", json={"name": "Bad", "startTime": "07:00", "durationMinutes": minutes, "repeats": "daily"}).status_code == 422
    assert owner.client.post("/api/routines", json={"name": "n" * (NAME_MAX + 1), "startTime": "07:00", "durationMinutes": 30, "repeats": "daily"}).status_code == 422
    today = today_of(owner)
    assert owner.client.get("/api/calendar", params={"from": today.isoformat(), "to": (today + timedelta(days=CALENDAR_MAX_DAYS)).isoformat()}).status_code == 422


def test_feed_serves_events(app_url: str) -> None:
    tz = "Europe/London"
    owner = create_workspace(app_url, tz, "feed")
    today = today_of(owner)
    day = today + timedelta(days=1)
    routine = add_routine(owner, f"{owner.name} walk", "08:00", 30)
    task = add_task(owner, f"{owner.name} feed block", 30)
    key = idempotency_key()
    first_try = timebox(owner, task["id"], day, "10:00", key)
    assert first_try.status_code == 201, first_try.text
    session_data = first_try.json()["session"]
    for _ in range(2):
        retry = timebox(owner, task["id"], day, "10:00", key)
        assert retry.status_code == 201 and retry.json()["session"]["id"] == session_data["id"]
    summary = f"{owner.name} meeting"
    start = local_dt(day, "15:00", tz)
    import_calendar(owner, ics(utc_event(f"feed-{uuid.uuid4().hex}", summary, start, start + timedelta(minutes=30))))
    url = feed_url(owner)
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    assert url.startswith(f"{origin}/feed/") and url.endswith(".ics")
    token = urlparse(url).path[len("/feed/"):-len(".ics")]
    assert re.fullmatch(r"[A-Za-z0-9_-]+", token) and len(token) >= TOKEN_MIN
    response = fetch_feed(app_url, url)
    assert response.status_code == 200
    assert response.headers["content-type"].lower().startswith("text/calendar") and "utf-8" in response.headers["content-type"].lower()
    assert "no-store" in response.headers.get("cache-control", "")
    events = vevents(response.text)
    uids = [e.get("UID") for e in events]
    sessions = [e for e in events if e.get("UID") == f"session-{session_data['id']}@tidemark"]
    assert len(sessions) == 1
    assert [u for u in uids if u and u.startswith("session-")] == [f"session-{session_data['id']}@tidemark"]
    assert [e.get("SUMMARY") for e in events].count(task["title"]) == 1
    assert sessions[0]["SUMMARY"] == task["title"]
    assert sessions[0]["DTSTART"] == ics_stamp(instant(session_data["start"])) and sessions[0]["DTEND"] == ics_stamp(instant(session_data["end"]))
    window = [today + timedelta(days=n) for n in range(-FEED_PAST_DAYS, FEED_FUTURE_DAYS)]
    expected = {f"routine-{routine['id']}-{d:%Y%m%d}@tidemark" for d in window}
    edge = f"routine-{routine['id']}-{today + timedelta(days=FEED_FUTURE_DAYS):%Y%m%d}@tidemark"
    occurrences = [u for u in uids if u and u.startswith(f"routine-{routine['id']}-")]
    assert len(occurrences) == len(set(occurrences)) and expected <= set(occurrences) <= expected | {edge}, sorted(occurrences)
    for event in events:
        assert event["DTSTART"].endswith("Z") and event["DTEND"].endswith("Z")
    assert summary not in [e.get("SUMMARY") for e in events]
    assert fetch_feed(app_url, url, "HEAD").status_code == 200
    other = create_workspace(app_url, tz, "feed2")
    assert task["title"] not in fetch_feed(app_url, feed_url(other)).text


def test_feed_rotation_and_methods(app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "rotate")
    add_routine(owner, f"{owner.name} walk", "08:00", 30)
    task = add_task(owner, f"{owner.name} rotated block", 30)
    timebox(owner, task["id"], today_of(owner) + timedelta(days=1), "10:00")
    old = feed_url(owner)
    before = {e.get("UID") for e in vevents(fetch_feed(app_url, old).text)}
    rotated = owner.client.post("/api/feed/rotate")
    assert rotated.status_code == 200
    new = rotated.json()["url"]
    assert new != old and owner.client.get("/api/feed").json()["url"] == new
    gone_response = fetch_feed(app_url, old)
    assert gone_response.status_code == 404 and gone_response.headers["content-type"].lower().startswith("text/plain")
    fresh = fetch_feed(app_url, new)
    assert fresh.status_code == 200 and {e.get("UID") for e in vevents(fresh.text)} == before
    newest = owner.client.post("/api/feed/rotate").json()["url"]
    assert fetch_feed(app_url, new).status_code == 404 and fetch_feed(app_url, newest).status_code == 200
    junk = f"/feed/{'z' * TOKEN_MIN}.ics"
    assert fetch_feed(app_url, junk).status_code == 404
    for url in (newest, junk):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            response = fetch_feed(app_url, url, method, content=b"x" * (FILE_LIMIT + 1), headers={"Content-Type": "text/plain", "Origin": EVIL_ORIGIN})
            assert response.status_code == 405, (method, url)
    assert fetch_feed(app_url, newest).status_code == 200


def test_shutdown_carries_over_and_digests(app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "shutdown")
    today = today_of(owner)
    tomorrow = today + timedelta(days=1)
    p = owner.name
    finished = add_task(owner, f"{p} finished", 30, today)
    assert patch_task(owner, finished, status="done").status_code == 200
    first_open = add_task(owner, f"{p} first open", 30, today)
    timebox(owner, first_open["id"], today, "10:00")
    add_task(owner, f"{p} second open", 15, today)
    waiting = add_task(owner, f"{p} waiting", 45, tomorrow)
    timebox(owner, waiting["id"], tomorrow, "09:00")
    add_routine(owner, f"{p} drill", "10:00", 30)
    order = [t["id"] for t in day_of(board(owner), today)["tasks"] if t["status"] == "open"]
    preview = owner.client.get("/api/shutdown/preview").json()
    assert preview["date"] == today.isoformat()
    assert [d["title"] for d in preview["done"]] == [finished["title"]]
    assert [c["id"] for c in preview["carriedOver"]] == order
    assert preview["tomorrowFirst"] == {"title": waiting["title"], "startTime": "09:00"}
    result = owner.client.post("/api/shutdown", json={})
    assert result.status_code == 200
    data = result.json()
    assert data["digest"] in ("sent", "queued")
    assert [c["id"] for c in data["carriedOver"]] == order
    snapshot = board(owner)
    assert [t["id"] for t in day_of(snapshot, tomorrow)["tasks"]][: len(order)] == order
    assert [t["id"] for t in day_of(snapshot, today)["tasks"]] == [finished["id"]]
    assert task_now(owner, first_open["id"])["session"] is None
    sessions = [i["title"] for i in calendar_items(owner, today, tomorrow) if i["kind"] == "session"]
    assert sessions == [waiting["title"]]

    subject = f"Shutdown for {day_label(today)}"
    assert wait_mail(mail, owner.email, subject), "digest never arrived"
    digests = settled_mail(mail, owner.email, subject)
    assert len(digests) == 1
    body = text(digests[0])
    for line in ("Done: 1", finished["title"], f"Carried over to {day_label(tomorrow)}: 2", f"{p} first open", f"{p} second open", f"Tomorrow starts with: {waiting['title']} at 09:00"):
        assert line in body, line
    assert MAIL_FROM_ADDRESS in addresses(digests[0].get("From"))
    assert re.search(r"message-id:\s*<outbox-[^@>\s]+@tidemark\.test>", mail.raw(digests[0]["ID"]), re.IGNORECASE)

    late = add_task(owner, f"{p} late open", 15, today)
    repeat = owner.client.post("/api/shutdown", json={}).json()
    assert repeat["digest"] == "already_sent" and [c["id"] for c in repeat["carriedOver"]] == [late["id"]]
    assert task_now(owner, late["id"])["dayDate"] == tomorrow.isoformat()
    assert len(settled_mail(mail, owner.email, subject)) == 1

    quiet = create_workspace(app_url, "Europe/London", "quiet")
    quiet_today = today_of(quiet)
    assert quiet.client.get("/api/shutdown/preview").json()["tomorrowFirst"] is None
    quiet.client.post("/api/shutdown", json={})
    quiet_mail = wait_mail(mail, quiet.email, f"Shutdown for {day_label(quiet_today)}")
    assert quiet_mail and "Tomorrow starts with: nothing scheduled" in text(quiet_mail[0])


def test_invites_hold_seats(app_url: str, mail: Any, killbill: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "inviter")
    poll(lambda: killbill.account_by_key(str(owner.workspace["id"])), RECOVERY_DEADLINE_S, "owner account in Kill Bill")
    assert members_of(owner)["seats"]["active"] == 1
    seats_match(killbill, owner.workspace["id"], [owner.member["id"]])
    _, email = ident("invitee")
    response = owner.client.post("/api/workspace/invitations", json={"email": email})
    assert response.status_code == 201, response.text
    assert response.json()["email"] in ("sent", "queued")
    listing = members_of(owner)
    assert listing["seats"]["active"] == 2
    assert [m["status"] for m in listing["members"] if m["email"].lower() == email.lower()] == ["invited"]
    invited_id = response.json()["member"]["id"]
    seats_match(killbill, owner.workspace["id"], [owner.member["id"], invited_id])
    assert wait_mail(mail, email, invite_subject(owner)), "invite email never arrived"
    invites = settled_mail(mail, email, invite_subject(owner))
    assert len(invites) == 1
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    assert f"{origin}/join/" in text(invites[0])
    detail = http(app_url).get(f"/api/invitations/{join_token(invites[0])}")
    assert detail.status_code == 200 and detail.json()["workspaceName"] == owner.workspace["name"]

    duplicate = owner.client.post("/api/workspace/invitations", json={"email": email.upper()})
    assert duplicate.status_code == 409 and error_code(duplicate) == "already_member"
    taken = owner.client.post("/api/workspace/invitations", json={"email": OSSIAN_EMAIL})
    assert taken.status_code == 409 and error_code(taken) == "email_taken"
    assert owner.client.post("/api/workspace/invitations", json={"email": "nobody"}).status_code == 422
    assert members_of(owner)["seats"]["active"] == 2
    assert len(settled_mail(mail, email, None)) == 1
    seats_match(killbill, owner.workspace["id"], [owner.member["id"], invited_id])
    member = invite_and_join(app_url, owner, mail)
    assert member.client.post("/api/workspace/invitations", json={"email": ident("x")[1]}).status_code == 403
    assert member.client.get("/api/workspace/members").status_code == 403
    assert http(app_url).post("/api/workspace/invitations", json={"email": ident("y")[1]}).status_code == 401
    assert http(app_url).get("/api/invitations/unknown-token-value").status_code == 404


def test_removing_members(app_url: str, mail: Any, killbill: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "remover")
    member = invite_and_join(app_url, owner, mail)
    keeper = invite_and_join(app_url, owner, mail)
    feed = feed_url(member)
    assert fetch_feed(app_url, feed).status_code == 200
    assert members_of(owner)["seats"]["active"] == 3
    seats_match(killbill, owner.workspace["id"], [owner.member["id"], member.member["id"], keeper.member["id"]])

    down = os.environ["APP_KILLBILL_DOWN_URL"]
    owner_down = Account(sign_in(down, owner.email), owner.email, owner.name, owner.member, owner.workspace)
    refused = owner_down.client.delete(f"/api/workspace/members/{keeper.member['id']}")
    assert refused.status_code == 503 and error_code(refused) == "billing_unavailable"
    assert [m["status"] for m in members_of(owner)["members"] if m["id"] == keeper.member["id"]] == ["active"]
    sign_in(app_url, keeper.email)
    seats_match(killbill, owner.workspace["id"], [owner.member["id"], member.member["id"], keeper.member["id"]])

    removed = owner.client.delete(f"/api/workspace/members/{member.member['id']}")
    assert removed.status_code == 200 and removed.json()["seats"]["active"] == 2
    seats_match(killbill, owner.workspace["id"], [owner.member["id"], keeper.member["id"]])
    assert member.member["id"] not in [m["id"] for m in members_of(owner)["members"] if m["status"] != "pending_billing"]
    attempt = http(app_url).post("/api/auth/sign-in", json={"email": member.email, "password": PASSWORD})
    assert attempt.status_code == 401 and error_code(attempt) == "invalid_credentials"
    stale = member.client.get("/api/me")
    assert stale.status_code == 401 and error_code(stale) == "unauthenticated"
    assert fetch_feed(app_url, feed).status_code == 404
    own = owner.client.delete(f"/api/workspace/members/{owner.member['id']}")
    assert own.status_code == 409 and error_code(own) == "cannot_remove_owner"
    assert keeper.client.delete(f"/api/workspace/members/{owner.member['id']}").status_code == 403
    stranger = create_workspace(app_url, "Europe/London", "remover2")
    assert stranger.client.delete(f"/api/workspace/members/{keeper.member['id']}").status_code == 404
    assert members_of(owner)["seats"]["active"] == 2


def test_weekly_review_totals(app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "review")
    member = invite_and_join(app_url, owner, mail, "Pacific/Auckland")
    leaver = invite_and_join(app_url, owner, mail)
    stranger = create_workspace(app_url, "Europe/London", "review2")
    monday = today_of(owner) + timedelta(days=7)
    monday -= timedelta(days=monday.weekday())
    week = iso_week(monday)

    def plan(acc: Account, offset: int, minutes: int, done: bool = False) -> None:
        task = add_task(acc, f"{acc.name} {offset} {minutes}", minutes, monday + timedelta(days=offset))
        if done:
            assert patch_task(acc, task, status="done").status_code == 200

    plan(owner, 0, 60, True)
    plan(owner, 2, 30)
    plan(owner, 6, 45, True)
    plan(owner, 7, 90)
    add_task(owner, f"{owner.name} undated", 15)
    plan(member, 1, 120)
    plan(member, 4, 30, True)
    plan(leaver, 3, 60)
    plan(stranger, 0, 600)
    assert owner.client.delete(f"/api/workspace/members/{leaver.member['id']}").status_code == 200

    response = owner.client.get("/api/workspace/review", params={"week": week})
    assert response.status_code == 200
    data = response.json()
    assert data["week"] == week
    rows = {r["memberId"]: r for r in data["members"]}
    assert set(rows) == {owner.member["id"], member.member["id"]}
    assert (rows[owner.member["id"]]["plannedMinutes"], rows[owner.member["id"]]["doneMinutes"]) == (135, 105)
    assert (rows[member.member["id"]]["plannedMinutes"], rows[member.member["id"]]["doneMinutes"]) == (150, 30)
    assert data["totals"] == {"plannedMinutes": 285, "doneMinutes": 135}
    default = owner.client.get("/api/workspace/review").json()
    assert default["week"] == iso_week(today_of(owner))
    assert member.client.get("/api/workspace/review").status_code == 403
    assert owner.client.get("/api/workspace/review", params={"week": "next week"}).status_code == 422


def test_billing_callback_unknown_workspace_first(app_url: str) -> None:
    unknown = billing_callback(app_url, str(uuid.uuid4()), "subscription.paused", server_now(app_url))
    assert unknown.status_code == 404 and error_code(unknown) == "unknown_workspace", unknown.text


def test_billing_callbacks_verified(app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "callbacks")
    wid = owner.workspace["id"]
    now = server_now(app_url)
    bad = billing_callback(app_url, wid, "subscription.trial_converted", now, secret="not-the-secret")
    assert bad.status_code == 401 and error_code(bad) == "invalid_signature"
    tampered = billing_callback(app_url, wid, "subscription.trial_converted", now, tamper=True)
    assert tampered.status_code == 401 and error_code(tampered) == "invalid_signature"
    for skew in (-2 * TOLERANCE_S, 2 * TOLERANCE_S):
        stale = billing_callback(app_url, wid, "subscription.trial_converted", now, timestamp=int(now.timestamp()) + skew)
        assert stale.status_code == 401 and error_code(stale) == "stale_timestamp"
    assert state_of(owner)["state"] == "trialing"
    unknown = billing_callback(app_url, str(uuid.uuid4()), "payment.failed", now)
    assert unknown.status_code == 404 and error_code(unknown) == "unknown_workspace"
    assert billing_callback(app_url, wid, "subscription.paused", now).status_code == 422
    event = f"evt-{uuid.uuid4().hex}"
    fresh = billing_callback(app_url, wid, "subscription.trial_converted", now, event_id=event, timestamp=int(now.timestamp()) - TOLERANCE_S // 2)
    assert fresh.status_code == 200 and fresh.json() == {"received": True, "applied": True}
    assert state_of(owner)["state"] == "active"
    repeat = billing_callback(app_url, wid, "subscription.cancelled", now + timedelta(seconds=5), event_id=event)
    assert repeat.status_code == 200 and repeat.json().get("duplicate") is True
    assert state_of(owner)["state"] == "active"
    ops = operator(app_url).get("/api/ops/workspaces").json()["workspaces"]
    saltmarsh = next(r for r in ops if r["name"] == SALTMARSH)
    seeded = billing_callback(app_url, saltmarsh["id"], "subscription.cancelled", now, event_id=SEED_EVENT)
    assert seeded.status_code == 200 and seeded.json().get("duplicate") is True
    assert ops_row(app_url, saltmarsh["id"])["state"] == saltmarsh["state"]


def test_subscription_state_replay(app_url: str) -> None:
    first = create_workspace(app_url, "Europe/London", "replay")
    second = create_workspace(app_url, "Europe/London", "replay2")
    t0 = server_now(app_url)

    def at(seconds: int) -> datetime:
        return t0 + timedelta(seconds=seconds)

    failed = billing_callback(app_url, first.workspace["id"], "payment.failed", at(20)).json()
    assert failed["applied"] is False and state_of(first)["state"] == "trialing"
    converted = billing_callback(app_url, first.workspace["id"], "subscription.trial_converted", at(10)).json()
    assert converted["applied"] is True and state_of(first)["state"] == "past_due"
    assert billing_callback(app_url, second.workspace["id"], "subscription.trial_converted", at(10)).json()["applied"] is True
    assert billing_callback(app_url, second.workspace["id"], "payment.failed", at(20)).json()["applied"] is True
    assert state_of(second)["state"] == "past_due"

    chain = [(30, "payment.succeeded", "active"), (40, "payment.failed", "past_due"), (50, "payment.failed", "read_only"), (60, "payment.succeeded", "active"), (70, "subscription.cancelled", "cancelled")]
    for seconds, kind, expected in chain:
        result = billing_callback(app_url, first.workspace["id"], kind, at(seconds)).json()
        assert result["applied"] is True
        workspace = state_of(first)
        assert workspace["state"] == expected
        assert workspace["writable"] is (expected in ("trialing", "active", "past_due"))
    late = billing_callback(app_url, first.workspace["id"], "payment.succeeded", at(80)).json()
    assert late["applied"] is False and state_of(first)["state"] == "cancelled"
    for seconds, kind, _ in reversed(chain):
        billing_callback(app_url, second.workspace["id"], kind, at(seconds))
    assert state_of(second)["state"] == "cancelled"

    newest = billing_callback(app_url, first.workspace["id"], "seats.changed", at(100), seats=5).json()
    older = billing_callback(app_url, first.workspace["id"], "seats.changed", at(90), seats=3).json()
    assert newest["applied"] is True and older["applied"] is False
    row = ops_row(app_url, first.workspace["id"])
    assert row["billedSeats"] == 5 and row["state"] == "cancelled"

    trial = os.environ["APP_TRIAL_CLOCK_URL"]
    owner = create_workspace(trial, "Europe/London", "lateconvert")
    ends = instant(owner.workspace["trialEndsAt"])
    remaining = max((ends - server_now(trial)).total_seconds(), 0)
    poll(lambda: state_of(owner)["state"] == "read_only", remaining + TRIAL_SWEEP_S + CLOCK_SLACK_S, "trial end")
    rescue = billing_callback(trial, owner.workspace["id"], "subscription.trial_converted", ends - timedelta(seconds=1))
    assert rescue.status_code == 200 and rescue.json()["applied"] is True
    workspace = state_of(owner)
    assert workspace["state"] == "active" and workspace["writable"] is True
    assert owner.client.post("/api/tasks", json={"title": "Converted again"}).status_code == 201


def test_killbill_outage_recovers(app_url: str, mail: Any, killbill: Any) -> None:
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    owner = create_workspace(down, "Europe/London", "kbdown")
    assert owner.workspace["state"] == "trialing"
    signup_billing = http(down)
    label, email = ident("kbdown2")
    queued = signup_billing.post("/api/workspaces", json={"workspaceName": label, "ownerName": label, "email": email, "password": PASSWORD, "timeZone": "Europe/London"})
    assert queued.status_code == 201 and queued.json()["billing"] == "queued"
    account = poll(lambda: killbill.account_by_key(str(queued.json()["workspace"]["id"])), RECOVERY_DEADLINE_S, "queued Kill Bill account")
    seats_match(killbill, queued.json()["workspace"]["id"], [queued.json()["member"]["id"]])
    assert account["email"].lower() == email.lower()
    poll(lambda: killbill.account_by_key(str(owner.workspace["id"])), RECOVERY_DEADLINE_S, "owner Kill Bill account")

    _, invitee = ident("kbinvitee")
    waiting = owner.client.post("/api/workspace/invitations", json={"email": invitee})
    assert waiting.status_code == 202 and waiting.json()["billing"] == "queued"
    owner_main = Account(sign_in(app_url, owner.email), owner.email, owner.name, owner.member, owner.workspace)

    def invited() -> bool:
        return [m["status"] for m in members_of(owner_main)["members"] if m["email"].lower() == invitee.lower()] == ["invited"]

    poll(invited, RECOVERY_DEADLINE_S, "queued seat accepted")
    seats_match(killbill, owner.workspace["id"], [owner.member["id"], waiting.json()["member"]["id"]])
    assert members_of(owner_main)["seats"]["active"] == 2
    assert wait_mail(mail, invitee, invite_subject(owner)), "queued invite email never arrived"
    assert len(settled_mail(mail, invitee, invite_subject(owner))) == 1


def test_mail_outage_recovers(app_url: str, mail: Any) -> None:
    down = os.environ["APP_MAIL_DOWN_URL"]
    owner = create_workspace(app_url, "Europe/London", "maildown")
    on_down = Account(sign_in(down, owner.email), owner.email, owner.name, owner.member, owner.workspace)
    today = today_of(on_down)
    add_task(on_down, f"{owner.name} open", 30, today)
    result = on_down.client.post("/api/shutdown", json={})
    assert result.status_code == 200 and result.json()["digest"] == "queued"
    _, invitee = ident("mailinvitee")
    invite = on_down.client.post("/api/workspace/invitations", json={"email": invitee})
    assert invite.status_code == 201 and invite.json()["email"] == "queued"
    subject = f"Shutdown for {day_label(today)}"
    assert wait_mail(mail, owner.email, subject, 1, RECOVERY_DEADLINE_S), "queued digest never arrived"
    assert wait_mail(mail, invitee, invite_subject(owner), 1, RECOVERY_DEADLINE_S), "queued invite never arrived"
    repeat = on_down.client.post("/api/shutdown", json={})
    assert repeat.json()["digest"] == "already_sent"
    assert len(settled_mail(mail, owner.email, subject)) == 1
    assert len(settled_mail(mail, invitee, invite_subject(owner))) == 1


def test_operator_overview(app_url: str) -> None:
    tz = "Europe/London"
    owner = create_workspace(app_url, tz, "opsview")
    ops = operator(app_url)
    row = ops_row(app_url, owner.workspace["id"])
    assert row["name"] == owner.workspace["name"] and row["state"] == "trialing"
    assert instant(row["trialEndsAt"]) == instant(owner.workspace["trialEndsAt"]) and row["activeSeats"] == 1 and row["billedSeats"] is None
    assert row["lastBillingEventAt"] is None and row["imports"]["batches"] == 0 and row["imports"]["lastAt"] is None
    assert isinstance(row["outbox"]["pending"], int) and isinstance(row["outbox"]["sent"], int)
    queued_before = row["outbox"]["pending"] + row["outbox"]["sent"]
    tag = uuid.uuid4().hex[:10]
    secret_task, secret_meeting, secret_routine = f"task {tag}", f"meeting {tag}", f"routine {tag}"
    import_tasks(owner, csv_bytes([["external_id", "title"], ["S-1", secret_task]]))
    start = local_dt(today_of(owner) + timedelta(days=1), "10:00", tz)
    import_calendar(owner, ics(utc_event(f"ops-{tag}", secret_meeting, start, start + timedelta(minutes=30))))
    add_routine(owner, secret_routine, "08:00", 30)
    owner.client.post("/api/shutdown", json={})
    billing_callback(app_url, owner.workspace["id"], "seats.changed", server_now(app_url), seats=4)
    response = ops.get("/api/ops/workspaces")
    assert response.status_code == 200
    for marker in (secret_task, secret_meeting, secret_routine, tag):
        assert marker not in response.text
    row = next(r for r in response.json()["workspaces"] if r["id"] == owner.workspace["id"])
    assert row["imports"]["batches"] >= 2 and row["imports"]["lastAt"]
    assert row["billedSeats"] == 4 and row["lastBillingEventAt"]
    assert row["outbox"]["pending"] + row["outbox"]["sent"] > queued_before
    saltmarsh = next(r for r in response.json()["workspaces"] if r["name"] == SALTMARSH)
    assert saltmarsh["lastBillingEventAt"]
    assert owner.client.get("/api/ops/workspaces").status_code == 403
    assert http(app_url).get("/api/ops/workspaces").status_code == 401
    for path in ("/api/board", "/api/workspace/members", "/api/routines"):
        assert ops.get(path).status_code == 403, path
    assert ops.post("/api/tasks", json={"title": "Operator task"}).status_code == 403


def test_health_and_outage_boot(app_url: str) -> None:
    for env in (None, "APP_KILLBILL_DOWN_URL", "APP_MAIL_DOWN_URL", "APP_TRIAL_CLOCK_URL"):
        base = app_url if env is None else os.environ[env]
        client = http(base)
        health = client.get("/api/health")
        assert health.status_code == 200 and health.json() == {"status": "ok"}, base
        shell = client.get("/")
        assert shell.status_code == 200 and shell.text.strip(), base


def test_server_boundary(app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "boundary")
    title = f"{owner.name} cross"
    cross = owner.client.post("/api/tasks", json={"title": title}, headers={"Origin": EVIL_ORIGIN})
    assert cross.status_code == 403 and error_code(cross) == "cross_origin"
    assert title not in [t["title"] for t in tasks_of(board(owner))]
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    assert owner.client.post("/api/tasks", json={"title": f"{title} ok"}, headers={"Origin": origin}).status_code == 201
    typed = owner.client.post("/api/tasks", content=b'{"title":"x"}', headers={"Content-Type": "text/plain"})
    assert typed.status_code == 415

    def padded(size: int) -> bytes:
        skeleton = json.dumps({"title": f"{owner.name} pad", "pad": ""})
        return json.dumps({"title": f"{owner.name} pad", "pad": "a" * (size - len(skeleton))}).encode()

    assert len(padded(JSON_LIMIT)) == JSON_LIMIT
    assert owner.client.post("/api/tasks", content=padded(JSON_LIMIT), headers={"Content-Type": JSON_CT}).status_code == 201
    assert owner.client.post("/api/tasks", content=padded(JSON_LIMIT + 1), headers={"Content-Type": JSON_CT}).status_code == 413
    assert owner.client.post("/api/tasks", content=padded(JSON_LIMIT + 1), headers={"Content-Type": "text/plain", "Origin": EVIL_ORIGIN}).status_code == 413
    assert owner.client.post("/api/tasks", content=b"{}", headers={"Content-Type": "text/plain", "Origin": EVIL_ORIGIN}).status_code == 415
    anonymous = http(app_url).post("/api/tasks", json={"title": "x"}, headers={"Origin": EVIL_ORIGIN})
    assert anonymous.status_code == 403
    assert http(app_url).post("/api/tasks", json={"title": "x"}).status_code == 401
    assert owner.client.post("/api/feed/rotate").status_code == 200
    assert owner.client.post("/api/auth/sign-out").status_code == 204
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/node_modules/", "/src/server.ts", "/dist/server.js"):
        assert http(app_url).get(path).status_code == 404, path
    shell = http(app_url).get("/")
    assert shell.headers.get("x-content-type-options") == "nosniff"
    assert http(app_url).get("/api/health").headers.get("x-content-type-options") == "nosniff"
    secrets = [os.environ.get(k, "") for k in ("DATABASE_URL", "KILLBILL_URL", "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET")]
    secrets = [s for s in secrets if len(s) >= 8 and not (s.isalpha() and len(s) < 16)]
    assets = sorted(set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', shell.text)))
    for body in [shell.text] + [http(app_url).get(a).text for a in assets]:
        for secret in secrets:
            assert secret not in body
    for asset in assets:
        if asset.endswith(".js"):
            assert http(app_url).get(asset + ".map").status_code == 404, asset


LOOPS_JS = "() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity).length"
INSTANT_JS = "el => el.getAnimations({subtree: true}).every(a => !a.effect || Number(a.effect.getComputedTiming().endTime) <= 1)"


def test_motion_and_reduced_motion(browser: Browser, app_url: str) -> None:
    for reduced in ("no-preference", "reduce"):
        owner = create_workspace(app_url, "Europe/London", "motion")
        today = today_of(owner)
        title = f"{owner.name} motion"
        add_task(owner, title, 15, today)
        add_task(owner, f"{owner.name} heavy", 300, today)
        with ui(browser, app_url, reduced=reduced) as page:
            ui_sign_in(page, owner.email)
            meter_reads(page, today, 315)
            region = day_region(page, today)
            assert page.evaluate(LOOPS_JS) == 0
            ritual(page, "Estimate")
            group = page.get_by_role("radiogroup", name=f"Estimate for {title}")
            see(page, group, "estimate radios")
            advance(page, 1000)
            settle(region)
            start_height, tide_height, _ = gauge(region)
            if reduced != "reduce":
                cdp = session(page)
                cdp.send("Animation.enable")
                cdp.send("Animation.setPlaybackRate", {"playbackRate": 0})
            click(group.get_by_role("radio", name="120 minutes"))
            path: list[dict[str, float]] = []
            if reduced != "reduce":
                fill_el = region.locator(FILL)
                first: list[dict[str, float]] = []

                def started() -> bool:
                    box = fill_el.bounding_box() or {"height": start_height}
                    first[:] = [{"height": box["height"]}]
                    return abs(box["height"] - start_height) > 1 or fill_el.evaluate(ANIMATING_JS)

                wait_ui(page, started, "fill starts to change", step_ms=16)
                path = first + motion(fill_el, FILL_MAX_MS, settle_ms=0)
            meter_reads(page, today, 420)
            end_height = min(420 / THRESHOLD, CAP) * tide_height
            if reduced == "reduce":
                fill_el = region.locator(FILL)
                assert fill_el.evaluate(INSTANT_JS), "fill still animating under reduced motion"
                settle(fill_el)
                box = fill_el.bounding_box()
                assert box and abs(box["height"] - end_height) <= RATIO_TOL * end_height + 1
                see(page, region.locator(OVER), "over label")
                expect(region.locator(OVER)).to_contain_text(f"Over by {420 - THRESHOLD}m")
                says(page, f"{title}: 120 minutes.")
            else:
                heights = [p.get("height", p.get("h")) for p in path]
                fill_el = region.locator(FILL)
                settle(fill_el)
                final = fill_el.bounding_box()
                expected = start_height * min(420 / THRESHOLD, CAP) / min(315 / THRESHOLD, CAP)
                assert final and abs(final["height"] - expected) <= RATIO_TOL * expected + 1, (final, heights)
                assert any(start_height + 1 < h < final["height"] - 1 for h in heights), heights
                assert all(b >= a - 1 for a, b in zip(heights, heights[1:])), heights


def _ui_start_trial(page: Page, label: str, email: str, tz: str) -> None:
    click(page.get_by_role("link", name="Start a free trial"))
    form = page.get_by_role("form", name="Start your trial")
    see(page, form, "trial form")
    fill(form.get_by_label("Workspace name"), label)
    fill(form.get_by_label("Your name"), f"{label} planner")
    fill(form.get_by_label("Email", exact=True), email)
    fill(form.get_by_label("Password", exact=True), PASSWORD)
    select(form.get_by_role("combobox", name="Time zone"), tz)
    click(form.get_by_role("button", name="Start free trial"))


def test_wf_sign_up_and_trial_happy(browser: Browser, app_url: str, killbill: Any) -> None:
    label, email = ident("journeytrial")
    tz = "Pacific/Auckland"
    with ui(browser, app_url) as page:
        _ui_start_trial(page, label, email, tz)
        see(page, page.get_by_role("navigation", name="Main"), "Daybook header")
        client = sign_in(app_url, email)
        me = client.get("/api/me").json()
        today = date.fromisoformat(me["today"])
        ends = instant(me["workspace"]["trialEndsAt"]).astimezone(ZoneInfo(tz))
        says(page, f"Workspace created. Your trial ends on {day_label(ends.date())}.")
        clock_at_trial_start(page, me["workspace"]["trialEndsAt"])
        banner = page.get_by_role("region", name="Subscription")
        wait_ui(page, lambda: f"Trial: {TRIAL_DAYS} days left" in banner.inner_text(), "trial banner")
        for offset in range(5):
            region = day_region(page, today + timedelta(days=offset))
            see(page, region, "day column")
            expect(region.get_by_role("listitem")).to_have_count(0)
        expect(backlog(page).get_by_role("listitem")).to_have_count(0)
        expect(page.get_by_role("banner").first).to_contain_text(label)
    assert me["workspace"]["name"] == label and me["workspace"]["state"] == "trialing"
    assert me["member"]["timeZone"] == tz and me["member"]["role"] == "owner"
    snapshot = http(app_url)
    snapshot.cookies = client.cookies
    assert tasks_of(snapshot.get("/api/board").json()) == []
    account = poll(lambda: killbill.account_by_key(str(me["workspace"]["id"])), RECOVERY_DEADLINE_S, "Kill Bill account")
    assert account["email"].lower() == email.lower()


def test_wf_sign_up_and_trial_email_taken(browser: Browser, app_url: str) -> None:
    label, email = ident("takentrial")
    with ui(browser, app_url) as page:
        _ui_start_trial(page, label, WREN_EMAIL, "Europe/London")
        says(page, "That email already has a Daybook.")
        form = page.get_by_role("form", name="Start your trial")
        expect(form).to_be_visible()
        fill(form.get_by_label("Email", exact=True), email)
        click(form.get_by_role("button", name="Start free trial"))
        see(page, page.get_by_role("region", name="Subscription"), "subscription banner")
    me = sign_in(app_url, email).get("/api/me").json()
    assert me["workspace"]["name"] == label and me["workspace"]["state"] == "trialing"


def test_wf_sign_up_and_trial_billing_outage(browser: Browser, app_url: str, killbill: Any) -> None:
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    label, email = ident("outagetrial")
    with ui(browser, down) as page:
        _ui_start_trial(page, label, email, "Europe/London")
        says(page, "Workspace created. Billing is unreachable, so your seat will be registered when it's back.")
        me = sign_in(app_url, email).get("/api/me").json()
        clock_at_trial_start(page, me["workspace"]["trialEndsAt"])
        banner = page.get_by_role("region", name="Subscription")
        wait_ui(page, lambda: f"Trial: {TRIAL_DAYS} days left" in banner.inner_text(), "trial banner")
    account = poll(lambda: killbill.account_by_key(str(me["workspace"]["id"])), RECOVERY_DEADLINE_S, "queued Kill Bill account")
    assert account["name"] == label


def test_wf_sign_up_and_trial_converted(browser: Browser, app_url: str) -> None:
    label, email = ident("convert")
    with ui(browser, app_url) as page:
        _ui_start_trial(page, label, email, "Europe/London")
        banner = page.get_by_role("region", name="Subscription")
        see(page, banner, "trial banner")
        client = sign_in(app_url, email)
        workspace = client.get("/api/me").json()["workspace"]
        wid = workspace["id"]
        forged = billing_callback(app_url, wid, "subscription.trial_converted", server_now(app_url), secret="forged-secret")
        assert forged.status_code == 401
        clock_at_trial_start(page, workspace["trialEndsAt"])
        wait_ui(page, lambda: f"Trial: {TRIAL_DAYS} days left" in page.get_by_role("region", name="Subscription").inner_text(), "banner kept")
        assert billing_callback(app_url, wid, "subscription.trial_converted", server_now(app_url)).json()["applied"] is True
        page.reload()
        see(page, page.get_by_role("navigation", name="Main"), "header")
        gone(page, page.get_by_role("region", name="Subscription"), "banner removed when active")
    assert client.get("/api/me").json()["workspace"]["state"] == "active"


def _ui_import(page: Page, dialog_name: str, field: str, name: str, mime: str, data: bytes) -> Locator:
    click(backlog(page).get_by_role("button", name=dialog_name))
    dialog = page.get_by_role("dialog", name=dialog_name)
    see(page, dialog, dialog_name)
    dialog.get_by_label(field).set_input_files({"name": name, "mimeType": mime, "buffer": data})
    click(dialog.get_by_role("button", name="Import"))
    return dialog


def test_wf_pull_and_import_happy(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "pull")
    titles = [f"{owner.name} one", f"{owner.name} two"]
    data = csv_bytes([["external_id", "title", "estimate_minutes"], ["P-1", titles[0], "30"], ["P-2", titles[1], ""]])
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        ritual(page, "Pull")
        dialog = _ui_import(page, "Import tasks", "CSV export", "tracker.csv", "text/csv", data)
        summary = "Imported: 2 new, 0 updated, 0 unchanged."
        says(page, summary)
        wait_ui(page, lambda: summary in dialog.inner_text(), "summary inside dialog")
        click(dialog.get_by_role("button", name="Close"))
        for title in titles:
            see(page, card(backlog(page), title), title)
    stored = {t["externalId"]: t for t in board(owner)["backlog"]}
    assert stored["P-1"]["title"] == titles[0] and stored["P-1"]["estimateMinutes"] == 30 and stored["P-1"]["source"] == "csv"
    assert stored["P-2"]["title"] == titles[1]


def test_wf_pull_and_import_focus_return(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "importfocus")
    data = csv_bytes([["external_id", "title"], ["F-1", f"{owner.name} focus"]])
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        dialog = _ui_import(page, "Import tasks", "CSV export", "focus.csv", "text/csv", data)
        says(page, "Imported: 1 new, 0 updated, 0 unchanged.")
        page.keyboard.press("Escape")
        gone(page, dialog, "import dialog closed")
        focused(page, backlog(page).get_by_role("button", name="Import tasks"), "focus back on Import tasks after an import")


def test_wf_pull_and_import_reimport(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "reimport")
    p = owner.name
    first = csv_bytes([["external_id", "title"], ["J-1", f"{p} alpha"], ["J-2", f"{p} beta"]])
    second = csv_bytes([["external_id", "title"], ["J-1", f"{p} alpha edited"], ["J-2", f"{p} beta"], ["J-3", f"{p} gamma"]])
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        dialog = _ui_import(page, "Import tasks", "CSV export", "day1.csv", "text/csv", first)
        says(page, "Imported: 2 new, 0 updated, 0 unchanged.")
        dialog.get_by_label("CSV export").set_input_files({"name": "day2.csv", "mimeType": "text/csv", "buffer": second})
        click(dialog.get_by_role("button", name="Import"))
        says(page, "Imported: 1 new, 1 updated, 1 unchanged.")
        click(dialog.get_by_role("button", name="Close"))
        see(page, card(backlog(page), f"{p} alpha edited"), "edited card")
        expect(card(backlog(page), f"{p} alpha")).to_have_count(0)
    ids = [t["externalId"] for t in tasks_of(board(owner))]
    assert sorted(ids) == ["J-1", "J-2", "J-3"]


def test_wf_pull_and_import_quick_add(browser: Browser, app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "quickadd")
    token = uuid.uuid4().hex[:8]
    own = [add_task(owner, f"{token} own {i}") for i in range(10)]
    teammate = invite_and_join(app_url, owner, mail)
    foreign = [add_task(teammate, f"{token} teammate"), add_task(create_workspace(app_url, "Europe/London", "quickadd2"), f"{token} stranger")]
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        box = backlog(page).get_by_role("combobox", name="Add a task")
        fill(box, token)
        advance(page, SUGGEST_PAUSE_MS * 2)
        listbox = page.get_by_role("listbox", name="Suggestions")
        see(page, listbox, "suggestions")
        options = listbox.get_by_role("option")
        wait_ui(page, lambda: options.count() == MAX_SUGGESTIONS, "eight suggestions")
        names = options.all_inner_texts()
        for task in foreign:
            assert not any(task["title"] in n for n in names)
        chosen = own[-1]["title"]
        click(listbox.get_by_role("option", name=chosen))
        target = card(backlog(page), chosen)
        wait_ui(page, lambda: target.evaluate("el => el.contains(document.activeElement)"), "focus on chosen card")
        assert len(board(owner)["backlog"]) == 10
        fresh = f"{token} brand new"
        fill(box, fresh)
        advance(page, SUGGEST_PAUSE_MS * 2)
        box.press("Enter")
        says(page, f"Added {fresh} to the Backlog.")
        see(page, card(backlog(page), fresh), "new card")
    assert [t["title"] for t in board(owner)["backlog"]].count(fresh) == 1
    assert len(board(owner)["backlog"]) == 11


def test_wf_pull_and_import_bad_file(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "badfile")
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        dialog = _ui_import(page, "Import tasks", "CSV export", "notes.csv", "text/csv", csv_bytes([["name", "notes"], ["x", "y"]]))
        says(page, "That file isn't a task export with external_id and title columns.")
        assert board(owner)["backlog"] == []
        good = csv_bytes([["external_id", "title"], ["G-1", f"{owner.name} good"]])
        dialog.get_by_label("CSV export").set_input_files({"name": "good.csv", "mimeType": "text/csv", "buffer": good})
        click(dialog.get_by_role("button", name="Import"))
        says(page, "Imported: 1 new, 0 updated, 0 unchanged.")
    assert [t["externalId"] for t in board(owner)["backlog"]] == ["G-1"]


def _meetings(day: date, tz: str, tag: str) -> bytes:
    start = local_dt(day, "10:00", tz)
    second = local_dt(day, "13:00", tz)
    return ics(
        utc_event(f"m1-{tag}", f"Review {tag}", start, start + timedelta(minutes=REVIEW_MINUTES)),
        [f"UID:m2-{tag}", f"SUMMARY:Planning {tag}", f"DTSTART;TZID={tz}:{second:%Y%m%dT%H%M%S}", f"DURATION:PT{PLANNING_MINUTES}M"],
        [f"UID:m3-{tag}", "SUMMARY:Holiday", f"DTSTART;VALUE=DATE:{day:%Y%m%d}"],
    )


def test_wf_meetings_import_happy(browser: Browser, app_url: str) -> None:
    tz = "Pacific/Auckland"
    owner = create_workspace(app_url, tz, "meetings")
    tomorrow = today_of(owner) + timedelta(days=1)
    tag = uuid.uuid4().hex[:6]
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        dialog = _ui_import(page, "Import calendar", "Calendar file (.ics)", "work.ics", "text/calendar", _meetings(tomorrow, tz, tag))
        summary = "Calendar imported: 2 new, 0 updated, 0 unchanged, 1 skipped."
        says(page, summary)
        wait_ui(page, lambda: summary in dialog.inner_text(), "summary inside dialog")
        click(dialog.get_by_role("button", name="Close"))
        strip = calendar_strip(page)
        click(strip.get_by_role("button", name="Next day"))
        see(page, strip.get_by_role("heading", name=day_label(tomorrow), level=2), "strip on tomorrow")
        total = REVIEW_MINUTES + PLANNING_MINUTES
        see(page, strip.get_by_label(f"Meeting: Review {tag}, 10:00 to {shift_time('10:00', REVIEW_MINUTES)}", exact=True), "first meeting block")
        see(page, strip.get_by_label(f"Meeting: Planning {tag}, 13:00 to {shift_time('13:00', PLANNING_MINUTES)}", exact=True), "second meeting block")
        meter_reads(page, tomorrow, total)
        expect(day_region(page, tomorrow)).to_contain_text(f"{total}m")
    entry = day_of(board(owner), tomorrow)
    assert entry["meetingMinutes"] == total and entry["plannedMinutes"] == total


def test_wf_meetings_import_focus_return(browser: Browser, app_url: str) -> None:
    tz = "Europe/London"
    owner = create_workspace(app_url, tz, "calfocus")
    tomorrow = today_of(owner) + timedelta(days=1)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        dialog = _ui_import(page, "Import calendar", "Calendar file (.ics)", "work.ics", "text/calendar",
                            _meetings(tomorrow, tz, uuid.uuid4().hex[:6]))
        says(page, "Calendar imported: 2 new, 0 updated, 0 unchanged, 1 skipped.")
        page.keyboard.press("Escape")
        gone(page, dialog, "calendar import dialog closed")
        focused(page, backlog(page).get_by_role("button", name="Import calendar"), "focus back on Import calendar after an import")


def test_wf_meetings_import_reimport(browser: Browser, app_url: str) -> None:
    tz = "Europe/London"
    owner = create_workspace(app_url, tz, "meetings2")
    tomorrow = today_of(owner) + timedelta(days=1)
    tag = uuid.uuid4().hex[:6]
    data = _meetings(tomorrow, tz, tag)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        dialog = _ui_import(page, "Import calendar", "Calendar file (.ics)", "work.ics", "text/calendar", data)
        says(page, "Calendar imported: 2 new, 0 updated, 0 unchanged, 1 skipped.")
        dialog.get_by_label("Calendar file (.ics)").set_input_files({"name": "work.ics", "mimeType": "text/calendar", "buffer": data})
        click(dialog.get_by_role("button", name="Import"))
        says(page, "Calendar imported: 0 new, 0 updated, 2 unchanged, 1 skipped.")
        click(dialog.get_by_role("button", name="Close"))
        meter_reads(page, tomorrow, REVIEW_MINUTES + PLANNING_MINUTES)
    items = [i["title"] for i in calendar_items(owner, tomorrow, tomorrow) if i["kind"] == "meeting"]
    assert sorted(items) == sorted([f"Review {tag}", f"Planning {tag}"])
    assert day_of(board(owner), tomorrow)["meetingMinutes"] == REVIEW_MINUTES + PLANNING_MINUTES


def test_wf_waterline_check_estimate(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "estimate")
    today = today_of(owner)
    title = f"{owner.name} estimate me"
    task = add_task(owner, title, 30, today)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        meter_reads(page, today, 30)
        ritual(page, "Estimate")
        step = page.get_by_role("navigation", name="Morning ritual").get_by_role("button", name="Estimate", exact=True)
        wait_ui(page, lambda: step.get_attribute("aria-current") not in (None, "false"), "Estimate marked current")
        group = page.get_by_role("radiogroup", name=f"Estimate for {title}")
        see(page, group, "estimate radios")
        click(group.get_by_role("radio", name="90 minutes"))
        says(page, f"{title}: 90 minutes.")
        meter_reads(page, today, 90)
        slip = card(day_region(page, today), title)
        wait_ui(page, lambda: "90m" in slip.inner_text(), "card estimate")
        expect(day_region(page, today)).to_contain_text("90m")
    stored = task_now(owner, task["id"])
    assert stored["estimateMinutes"] == 90 and day_of(board(owner), today)["taskMinutes"] == 90


def test_wf_waterline_check_local_midnight(browser: Browser, app_url: str) -> None:
    tz = "Pacific/Auckland"
    owner = create_workspace(app_url, tz, "midnight")
    today = today_of(owner)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        see(page, day_region(page, today), "today column")
        following = today + timedelta(days=1)
        midnight = datetime(following.year, following.month, following.day, tzinfo=ZoneInfo(tz))
        page.clock.set_system_time(midnight - timedelta(seconds=30))
        advance(page, UI_STEP_MS)
        page.clock.run_for((30 + ROLLOVER_S + 1) * 1000)
        wait_ui(
            page,
            lambda: day_region(page, today).count() == 0 and day_region(page, today + timedelta(days=5)).count() > 0,
            "board rolled to the next Auckland day",
        )
        boxes: dict[str, Any] = {}

        def laid_out() -> bool:
            boxes["first"] = day_region(page, following).bounding_box()
            boxes["last"] = day_region(page, today + timedelta(days=5)).bounding_box()
            return bool(boxes["first"] and boxes["last"])

        wait_ui(page, laid_out, "rolled columns laid out")
        assert boxes["first"]["x"] < boxes["last"]["x"]


def test_wf_waterline_check_read_only_rollback(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "estimateblocked")
    today = today_of(owner)
    title = f"{owner.name} blocked"
    task = add_task(owner, title, 30, today)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        meter_reads(page, today, 30)
        assert billing_callback(app_url, owner.workspace["id"], "subscription.cancelled", server_now(app_url)).status_code == 200
        ritual(page, "Estimate")
        group = page.get_by_role("radiogroup", name=f"Estimate for {title}")
        see(page, group, "estimate radios")
        click(group.get_by_role("radio", name="60 minutes"))
        wait_ui(page, lambda: "this workspace is read-only" in status(page).inner_text(), "read-only reason")
        meter_reads(page, today, 30)
        slip = card(day_region(page, today), title)
        wait_ui(page, lambda: "30m" in slip.inner_text(), "estimate rolled back")
    assert task_now(owner, task["id"])["estimateMinutes"] == 30


def test_wf_move_between_days_keyboard(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "keyboard")
    today = today_of(owner)
    d0, d1 = today, today + timedelta(days=1)
    title = f"{owner.name} keys"
    task = add_task(owner, title, 30)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        handle = move_button(page, title)
        handle.focus()
        page.keyboard.press("Space")
        says(page, f"Picked up {title}. Use arrow keys to choose a place, Enter to drop, Escape to cancel.")
        page.keyboard.press("ArrowRight")
        says(page, f"Over {day_label(d0)}: 30m of {THRESHOLD}m.")
        page.keyboard.press("ArrowRight")
        says(page, f"Over {day_label(d1)}: 30m of {THRESHOLD}m.")
        page.keyboard.press("Enter")
        says(page, f"Moved {title} to {day_label(d1)}. {day_label(d1)} is at 30m of {THRESHOLD}m.")
        see(page, card(day_region(page, d1), title), "card in tomorrow")
        expect(move_button(page, title)).to_be_focused()
        assert task_now(owner, task["id"])["dayDate"] == d1.isoformat()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        says(page, "Over Backlog.")
        page.keyboard.press("Escape")
        says(page, f"Cancelled. {title} stays in {day_label(d1)}.")
        see(page, card(day_region(page, d1), title), "card stays")
        expect(move_button(page, title)).to_be_focused()
        page.keyboard.press("Space")
        for _ in range(4):
            page.keyboard.press("ArrowRight")
        says(page, "Calendar slot 09:00.")
        page.keyboard.press("ArrowDown")
        says(page, "Calendar slot 09:30.")
        page.keyboard.press("Enter")
        says(page, f"Timeboxed {title} at 09:30.")
        expect(move_button(page, title)).to_be_focused()
    stored = task_now(owner, task["id"])
    assert stored["session"]["startTime"] == "09:30" and stored["session"]["date"] == today.isoformat()


def test_wf_move_between_days_conflict_rollback(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "rollback")
    d1 = today_of(owner) + timedelta(days=1)
    title = f"{owner.name} contested"
    task = add_task(owner, title, 30)
    with ui(browser, app_url, 1280, 1400) as page:
        ui_sign_in(page, owner.email)
        see(page, card(backlog(page), title), "card in backlog")
        assert patch_task(owner, task, estimateMinutes=45).status_code == 200
        with held(page, "**/api/tasks/**") as gate:
            drag(page, move_button(page, title), day_region(page, d1))
            see(page, card(day_region(page, d1), title), "optimistic move")
            meter_reads(page, d1, 30)
            release_held(gate)
        says(page, f"Couldn't move {title}: it was changed on another device. It's back in Backlog.")
        see(page, card(backlog(page), title), "card back in backlog")
        expect(card(day_region(page, d1), title)).to_have_count(0)
        meter_reads(page, d1, 0)
        wait_ui(page, lambda: "45m" in card(backlog(page), title).inner_text(), "server state shown")
    assert task_now(owner, task["id"])["dayDate"] is None


def test_wf_move_between_days_read_only(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "rollbackro")
    d1 = today_of(owner) + timedelta(days=1)
    title = f"{owner.name} frozen move"
    task = add_task(owner, title, 30)
    with ui(browser, app_url, 1280, 1400) as page:
        ui_sign_in(page, owner.email)
        see(page, card(backlog(page), title), "card")
        billing_callback(app_url, owner.workspace["id"], "subscription.cancelled", server_now(app_url))
        drag(page, move_button(page, title), day_region(page, d1))
        says(page, f"Couldn't move {title}: this workspace is read-only. It's back in Backlog.")
        see(page, card(backlog(page), title), "card returned")
        meter_reads(page, d1, 0)
    assert task_now(owner, task["id"])["dayDate"] is None


def test_wf_timebox_calendar_release_off_target(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "offtarget")
    today = today_of(owner)
    title = f"{owner.name} stray"
    task = add_task(owner, title, SLOT_MINUTES, today)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        see(page, card(day_region(page, today), title), "card in today")
        slot_box = calendar_strip(page).locator(SLOT_1000)
        drag(page, move_button(page, title), slot_box, release=False)
        header = page.get_by_role("banner").first.bounding_box()
        assert header, "page header missing"
        page.mouse.move(header["x"] + header["width"] / 2, max(header["y"], 0) + 1, steps=8)
        advance(page, DRAG_SETTLE_MS)
        page.mouse.up()
        advance(page, DRAG_SETTLE_MS * 2)
        see(page, card(day_region(page, today), title), "card back in today")
    sessions = [i for i in calendar_items(owner, today, today) if i["kind"] == "session"]
    assert sessions == [], sessions
    assert task_now(owner, task["id"])["dayDate"] == today.isoformat()


def test_session_conflict_before_validation(app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "precedence")
    today = today_of(owner)
    task = add_task(owner, f"{owner.name} ordered", SLOT_MINUTES, today)
    session = timebox(owner, task["id"], today, "10:00").json()["session"]
    moved = owner.client.patch(f"/api/sessions/{session['id']}", json={"version": session["version"], "date": today.isoformat(), "startTime": "11:00"})
    assert moved.status_code == 200, moved.text
    stale = owner.client.patch(f"/api/sessions/{session['id']}", json={"version": session["version"], "date": today.isoformat(), "startTime": "9am"})
    assert stale.status_code == 409 and error_code(stale) == "version_conflict", stale.text


def test_wf_timebox_calendar_happy(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "timeboxui")
    today = today_of(owner)
    title = f"{owner.name} deep work"
    task = add_task(owner, title, 90, today)
    short = add_task(owner, f"{owner.name} short", SLOT_MINUTES, today)
    later = shift_time(KEYBOARD_START, 4 * SLOT_MINUTES)
    assert timebox(owner, short["id"], today, later).status_code == 201
    slot = shift_time(KEYBOARD_START, -2 * SLOT_MINUTES)
    planned = 90 + SLOT_MINUTES
    with ui(browser, app_url, 1280, 1400) as page:
        ui_sign_in(page, owner.email)
        meter_reads(page, today, planned)
        before, _, _ = gauge(day_region(page, today))
        strip = calendar_strip(page)
        reference = strip.get_by_role("button", name=f"{short['title']}, {later} to {shift_time(later, SLOT_MINUTES)}", exact=True)
        see(page, reference, "half-hour reference block")
        move_button(page, title).focus()
        page.keyboard.press("Space")
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        says(page, f"Calendar slot {KEYBOARD_START}.")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        says(page, f"Calendar slot {slot}.")
        page.keyboard.press("Enter")
        says(page, f"Timeboxed {title} at {slot}.")
        block = strip.get_by_role("button", name=f"{title}, {slot} to {shift_time(slot, 90)}", exact=True)
        see(page, block, "session block")
        settle(strip)
        block_box, slot_box = block.bounding_box(), reference.bounding_box()
        assert block_box and slot_box
        assert abs(block_box["height"] - 90 * slot_box["height"] / SLOT_MINUTES) <= BLOCK_TOL_PX * (1 + 90 // SLOT_MINUTES)
        meter_reads(page, today, planned)
        after, _, _ = gauge(day_region(page, today))
        assert abs(after - before) <= 1
    stored = task_now(owner, task["id"])
    assert stored["session"]["startTime"] == slot and stored["session"]["endTime"] == shift_time(slot, 90)
    assert day_of(board(owner), today)["plannedMinutes"] == planned


def test_wf_timebox_calendar_no_duplicate(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "nodup")
    today = today_of(owner)
    title = f"{owner.name} once"
    task = add_task(owner, title, 30, today)
    with ui(browser, app_url) as laptop, ui(browser, app_url) as phone:
        for page in (laptop, phone):
            ui_sign_in(page, owner.email)
            see(page, card(day_region(page, today), title), "card")
        for page, steps, copy in ((laptop, 0, f"Timeboxed {title} at 09:00."), (phone, 2, f"Couldn't timebox {title}: it's already on the calendar.")):
            move_button(page, title).focus()
            page.keyboard.press("Space")
            for _ in range(5):
                page.keyboard.press("ArrowRight")
            for _ in range(steps):
                page.keyboard.press("ArrowDown")
            page.keyboard.press("Enter")
            says(page, copy)
    sessions = [i for i in calendar_items(owner, today, today) if i["kind"] == "session"]
    assert len(sessions) == 1 and sessions[0]["startTime"] == "09:00" and sessions[0]["title"] == task["title"]
    events = vevents(fetch_feed(app_url, feed_url(owner)).text)
    assert [e.get("SUMMARY") for e in events].count(title) == 1


def test_wf_timebox_calendar_two_devices(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "devices")
    today = today_of(owner)
    title = f"{owner.name} sync"
    task = add_task(owner, title, 30, today)
    assert timebox(owner, task["id"], today, "10:00").status_code == 201
    with ui(browser, app_url, 1280, 1600) as laptop, ui(browser, app_url, 1280, 1600) as phone:
        for page in (laptop, phone):
            ui_sign_in(page, owner.email)
            see(page, calendar_strip(page).get_by_role("button", name=f"{title}, 10:00 to 10:30", exact=True), "block at 10:00")
        winner, stale = shift_time("10:00", 2 * SLOT_MINUTES), shift_time("10:00", 8 * SLOT_MINUTES)
        strip = calendar_strip(laptop)
        drag_by_slots(laptop, strip.get_by_role("button", name=f"{title}, 10:00 to {shift_time('10:00', 30)}", exact=True), 2)
        says(laptop, f"Moved {title} to {winner}.")
        poll(lambda: task_now(owner, task["id"])["session"]["startTime"] == winner, HTTP_TIMEOUT_S, "laptop move stored")
        strip = calendar_strip(phone)
        drag_by_slots(phone, strip.get_by_role("button", name=f"{title}, 10:00 to {shift_time('10:00', 30)}", exact=True), 8)
        says(phone, f"Couldn't move {title}: it was changed on another device. Showing the latest time.")
        see(phone, strip.get_by_role("button", name=f"{title}, {winner} to {shift_time(winner, 30)}", exact=True), "snapped to the winning time")
        expect(strip.get_by_role("button", name=f"{title}, {stale} to {shift_time(stale, 30)}", exact=True)).to_have_count(0)
    stored = task_now(owner, task["id"])["session"]
    assert (stored["startTime"], stored["endTime"]) == (winner, shift_time(winner, 30))


def test_wf_timebox_calendar_remove(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "removeui")
    today = today_of(owner)
    title = f"{owner.name} drop me"
    task = add_task(owner, title, 30, today)
    sid = timebox(owner, task["id"], today, "10:00").json()["session"]["id"]
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        click(calendar_strip(page).get_by_role("button", name=f"Remove {title} from calendar"))
        says(page, f"Removed {title} from the calendar.")
        gone(page, calendar_strip(page).get_by_role("button", name=f"{title}, 10:00 to 10:30", exact=True), "block removed")
        page.reload()
        see(page, card(day_region(page, today), title), "card stays in its column")
        expect(calendar_strip(page).get_by_role("button", name=f"{title}, 10:00 to 10:30", exact=True)).to_have_count(0)
    assert task_now(owner, task["id"])["session"] is None
    assert f"session-{sid}@tidemark" not in [e.get("UID") for e in vevents(fetch_feed(app_url, feed_url(owner)).text)]


def _open_routine_dialog(page: Page) -> Locator:
    click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Settings"))
    click(page.get_by_role("region", name="Routines").get_by_role("button", name="Add routine"))
    dialog = page.get_by_role("dialog", name="Add routine")
    see(page, dialog, "Add routine dialog")
    return dialog


def test_wf_routines_happy(browser: Browser, app_url: str) -> None:
    tz = "Pacific/Honolulu"
    owner = create_workspace(app_url, tz, "routineui")
    today = today_of(owner)
    name = f"{owner.name} walk"
    start = "07:30"
    minutes = 15
    end = shift_time(start, minutes)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        dialog = _open_routine_dialog(page)
        fill(dialog.get_by_label("Name", exact=True), name)
        fill(dialog.get_by_label("Start time"), start)
        fill(dialog.get_by_role("spinbutton", name="Minutes"), str(minutes))
        click(dialog.get_by_role("radiogroup", name="Repeats").get_by_role("radio", name="Every day"))
        click(dialog.get_by_role("button", name="Save routine"))
        says(page, f"Added routine {name} at {start}.")
        expect(page.get_by_role("region", name="Routines")).to_contain_text(f"{name} · {start} · {minutes}m · Every day")
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Daybook"))
        strip = calendar_strip(page)
        for offset in range(3):
            day = today + timedelta(days=offset)
            if offset:
                click(strip.get_by_role("button", name="Next day"))
            see(page, strip.get_by_role("heading", name=day_label(day), level=2), "strip day")
            see(page, strip.get_by_label(f"{name}, {start} to {end}", exact=True), "routine block")
    items = [i for i in calendar_items(owner, today, today + timedelta(days=4)) if i["kind"] == "routine" and i["title"] == name]
    assert [i["date"] for i in items] == [(today + timedelta(days=n)).isoformat() for n in range(5)]
    assert all(i["startTime"] == start and i["endTime"] == end for i in items)


def test_wf_routines_invalid(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "routinebad")
    name = f"{owner.name} long"
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        dialog = _open_routine_dialog(page)
        fill(dialog.get_by_label("Name", exact=True), name)
        fill(dialog.get_by_label("Start time"), "18:00")
        minutes = dialog.get_by_role("spinbutton", name="Minutes")
        fill(minutes, str(ROUTINE_MIN - 1))
        click(dialog.get_by_role("radiogroup", name="Repeats").get_by_role("radio", name="Weekdays"))
        click(dialog.get_by_role("button", name="Save routine"))
        expect(minutes).to_have_accessible_description(re.compile(r"\S"), timeout=UI_DEADLINE_S * 1000)
        assert owner.client.get("/api/routines").json()["routines"] == []
        fill(minutes, str(ROUTINE_MAX))
        click(dialog.get_by_role("button", name="Save routine"))
        says(page, f"Added routine {name} at 18:00.")
        expect(page.get_by_role("region", name="Routines")).to_contain_text(f"{name} · 18:00 · {ROUTINE_MAX}m · Weekdays")
        opener = page.get_by_role("region", name="Routines").get_by_role("button", name="Add routine")
        click(opener)
        dialog = page.get_by_role("dialog", name="Add routine")
        click(dialog.get_by_role("button", name="Cancel"))
        gone(page, dialog, "dialog closed")
        focused(page, opener, "focus back on the opener")
    routines = owner.client.get("/api/routines").json()["routines"]
    assert [(r["name"], r["durationMinutes"], r["repeats"]) for r in routines] == [(name, ROUTINE_MAX, "weekdays")]


def _open_feed(page: Page) -> tuple[Locator, Locator]:
    click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Settings"))
    region = page.get_by_role("region", name="Calendar feed")
    see(page, region, "feed settings")
    return region, region.get_by_role("textbox", name="Feed URL")


def test_wf_calendar_feed_rotate(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "rotateui")
    old = feed_url(owner)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        region, box = _open_feed(page)
        wait_ui(page, lambda: box.input_value() == old, "feed URL shown")
        click(region.get_by_role("button", name="Rotate feed URL"))
        confirm = page.get_by_role("alertdialog", name="Rotate feed URL?")
        see(page, confirm, "rotation confirmation")
        expect(confirm).to_contain_text("Calendar apps using the old URL will stop updating.")
        click(confirm.get_by_role("button", name="Rotate", exact=True))
        says(page, "Feed URL rotated. The old URL has stopped working.")
        wait_ui(page, lambda: box.input_value() not in ("", old), "new URL shown")
        new = box.input_value()
    assert fetch_feed(app_url, old).status_code == 404
    assert fetch_feed(app_url, new).status_code == 200 and feed_url(owner) == new


def test_wf_calendar_feed_rotate_pending(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "rotatepending")
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        region, _ = _open_feed(page)
        click(region.get_by_role("button", name="Rotate feed URL"))
        confirm = page.get_by_role("alertdialog", name="Rotate feed URL?")
        see(page, confirm, "rotation confirmation")
        with held(page, "**/api/feed/rotate") as gate:
            click(confirm.get_by_role("button", name="Rotate", exact=True))
            wait_ui(page, lambda: page.evaluate(PENDING_BUTTON_JS, "Rotating…"), "a busy button showing Rotating…")
            release_held(gate)
        says(page, "Feed URL rotated. The old URL has stopped working.")


def test_wf_calendar_feed_copy_keep(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "copyfeed")
    url = feed_url(owner)
    with ui(browser, app_url) as page:
        origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin)
        ui_sign_in(page, owner.email)
        region, box = _open_feed(page)
        click(region.get_by_role("button", name="Copy feed URL"))
        says(page, "Feed URL copied.")
        assert page.evaluate("navigator.clipboard.readText()") == box.input_value() == url
        rotate = region.get_by_role("button", name="Rotate feed URL")
        click(rotate)
        confirm = page.get_by_role("alertdialog", name="Rotate feed URL?")
        click(confirm.get_by_role("button", name="Keep current URL"))
        gone(page, confirm, "confirmation closed")
        focused(page, rotate, "focus back on Rotate feed URL")
        assert box.input_value() == url
    assert fetch_feed(app_url, url).status_code == 200 and feed_url(owner) == url


def _ui_shutdown(page: Page, tomorrow: date) -> Locator:
    ritual(page, "Shut down")
    dialog = page.get_by_role("dialog", name="Shut down")
    see(page, dialog, "shutdown dialog")
    for heading in ("Done", f"Carry over to {day_label(tomorrow)}", "Tomorrow starts with"):
        see(page, dialog.get_by_role("heading", name=heading), heading)
    return dialog


def test_wf_evening_shutdown_happy(browser: Browser, app_url: str, mail: Any) -> None:
    tz = "Pacific/Auckland"
    owner = create_workspace(app_url, tz, "eveningui")
    today = today_of(owner)
    tomorrow = today + timedelta(days=1)
    carried = f"{owner.name} unfinished"
    add_task(owner, carried, 30, today)
    done = add_task(owner, f"{owner.name} finished", 15, today)
    patch_task(owner, done, status="done")
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        dialog = _ui_shutdown(page, tomorrow)
        expect(dialog).to_contain_text(carried)
        expect(dialog).to_contain_text(done["title"])
        click(dialog.get_by_role("button", name="Send shutdown"))
        wait_ui(
            page,
            lambda: any(c in status(page).inner_text() for c in (f"Day shut down. Digest sent to {owner.email}.", "Day shut down. Mail is unreachable, so your digest is queued and will send when it's back.")),
            "shutdown outcome",
        )
        see(page, card(day_region(page, tomorrow), carried), "card moved to tomorrow")
        expect(card(day_region(page, today), carried)).to_have_count(0)
    assert [t["title"] for t in day_of(board(owner), tomorrow)["tasks"]][0] == carried
    subject = f"Shutdown for {day_label(today)}"
    assert wait_mail(mail, owner.email, subject)
    assert len(settled_mail(mail, owner.email, subject)) == 1


def test_wf_evening_shutdown_repeat(browser: Browser, app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "eveningtwice")
    today = today_of(owner)
    tomorrow = today + timedelta(days=1)
    add_task(owner, f"{owner.name} first", 30, today)
    subject = f"Shutdown for {day_label(today)}"
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        click(_ui_shutdown(page, tomorrow).get_by_role("button", name="Send shutdown"))
        wait_ui(page, lambda: "Day shut down." in status(page).inner_text(), "first shutdown")
        assert wait_mail(mail, owner.email, subject)
        late = f"{owner.name} second"
        add_task(owner, late, 15, today)
        page.reload()
        click(_ui_shutdown(page, tomorrow).get_by_role("button", name="Send shutdown"))
        says(page, "Day shut down. Today's digest was already sent.")
        see(page, card(day_region(page, tomorrow), late), "late card carried")
    assert len(settled_mail(mail, owner.email, subject)) == 1


def test_wf_evening_shutdown_mail_outage(browser: Browser, app_url: str, mail: Any) -> None:
    down = os.environ["APP_MAIL_DOWN_URL"]
    owner = create_workspace(app_url, "Europe/London", "eveningdown")
    today = today_of(owner)
    tomorrow = today + timedelta(days=1)
    carried = f"{owner.name} queued"
    add_task(owner, carried, 30, today)
    with ui(browser, down) as page:
        ui_sign_in(page, owner.email)
        click(_ui_shutdown(page, tomorrow).get_by_role("button", name="Send shutdown"))
        says(page, "Day shut down. Mail is unreachable, so your digest is queued and will send when it's back.")
        see(page, card(day_region(page, tomorrow), carried), "card moved")
    subject = f"Shutdown for {day_label(today)}"
    assert wait_mail(mail, owner.email, subject, 1, RECOVERY_DEADLINE_S), "queued digest never arrived"
    assert len(settled_mail(mail, owner.email, subject)) == 1


def _ui_invite(page: Page, email: str) -> None:
    click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Workspace"))
    form = page.get_by_role("form", name="Invite a member")
    see(page, form, "invite form")
    fill(form.get_by_label("Email", exact=True), email)
    click(form.get_by_role("button", name="Send invite"))


def _ui_join(page: Page, workspace_name: str, name: str, tz: str) -> None:
    form = page.get_by_role("form", name=f"Join {workspace_name}")
    see(page, form, "join form")
    fill(form.get_by_label("Your name"), name)
    fill(form.get_by_label("Password", exact=True), PASSWORD)
    select(form.get_by_role("combobox", name="Time zone"), tz)
    click(form.get_by_role("button", name="Join workspace"))


def test_wf_seats_and_invites_join(browser: Browser, app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "joinui")
    secret = f"{owner.name} private"
    add_task(owner, secret, 30)
    label, email = ident("joiner")
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        _ui_invite(page, email)
        wait_ui(page, lambda: any(c in status(page).inner_text() for c in (f"Invite sent to {email}.", f"Invite saved. Mail is unreachable, so the email to {email} is queued.")), "invite outcome")
        row = page.get_by_role("table", name="Members").get_by_role("row").filter(has_text=email)
        see(page, row, "invited row")
        expect(row).to_contain_text("Invited")
    messages = wait_mail(mail, email, invite_subject(owner))
    assert messages
    with ui(browser, app_url + f"/join/{join_token(messages[0])}") as page:
        _ui_join(page, owner.workspace["name"], label, "Pacific/Honolulu")
        see(page, page.get_by_role("navigation", name="Main"), "Daybook header")
        expect(page.get_by_role("banner").first).to_contain_text(owner.workspace["name"])
        see(page, backlog(page), "Backlog")
        expect(backlog(page).get_by_role("listitem")).to_have_count(0)
        expect(page.get_by_role("button", name=f"Move {secret}")).to_have_count(0)
    me = sign_in(app_url, email).get("/api/me").json()
    assert me["workspace"]["id"] == owner.workspace["id"] and me["member"]["role"] == "member" and me["member"]["timeZone"] == "Pacific/Honolulu"
    assert [m["status"] for m in members_of(owner)["members"] if m["email"].lower() == email.lower()] == ["active"]


def test_wf_seats_and_invites_used_link(browser: Browser, app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "usedlink")
    _, email = ident("usedjoiner")
    owner.client.post("/api/workspace/invitations", json={"email": email})
    token = join_token(wait_mail(mail, email, invite_subject(owner))[0])
    assert http(app_url).post(f"/api/invitations/{token}/accept", json={"name": "First", "password": PASSWORD, "timeZone": "UTC"}).status_code == 201
    with ui(browser, app_url + f"/join/{token}") as page:
        see(page, page.get_by_text("This invite has already been used."), "used-link copy")
    again = http(app_url).post(f"/api/invitations/{token}/accept", json={"name": "Second", "password": PASSWORD, "timeZone": "UTC"})
    assert again.status_code == 410 and error_code(again) == "invitation_used"
    assert http(app_url).get(f"/api/invitations/{token}").status_code == 410


def test_wf_seats_and_invites_billing_outage(browser: Browser, app_url: str, mail: Any) -> None:
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    owner = create_workspace(app_url, "Europe/London", "inviteoutage")
    _, email = ident("waiter")
    with ui(browser, down) as page:
        ui_sign_in(page, owner.email)
        _ui_invite(page, email)
        says(page, "Invite saved. Billing is unreachable, so the seat and email will go through when it's back.")
    poll(lambda: [m["status"] for m in members_of(owner)["members"] if m["email"].lower() == email.lower()] == ["invited"], RECOVERY_DEADLINE_S, "seat accepted")
    assert wait_mail(mail, email, invite_subject(owner), 1, RECOVERY_DEADLINE_S)
    assert len(settled_mail(mail, email, invite_subject(owner))) == 1


def test_wf_weekly_review_happy(browser: Browser, app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "reviewui")
    member = invite_and_join(app_url, owner, mail)
    stranger = create_workspace(app_url, "Europe/London", "reviewui2")
    monday = today_of(owner) - timedelta(days=today_of(owner).weekday())
    following = monday + timedelta(days=7)
    owner_minutes, member_minutes = 45, 30
    seats = len((owner, member))
    add_task(owner, f"{owner.name} next", owner_minutes, following)
    add_task(member, f"{member.name} next", member_minutes, following + timedelta(days=1))
    add_task(stranger, f"{stranger.name} next", 60, following)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Workspace"))
        expect(page.get_by_role("region", name="Seats")).to_contain_text(f"Active seats: {seats}")
        members = page.get_by_role("table", name="Members")
        expect(members.get_by_role("row").filter(has_text=member.email)).to_contain_text("Active")
        review = page.get_by_role("table", name="Weekly review")
        see(page, page.get_by_role("heading", name=f"Week of {day_label(monday)}", level=2), "current week")
        click(page.get_by_role("button", name="Next week"))
        see(page, page.get_by_role("heading", name=f"Week of {day_label(following)}", level=2), "next week")
        wait_ui(page, lambda: f"{owner_minutes}m" in review.get_by_role("row").filter(has_text=owner.name).inner_text(), "owner minutes")
        expect(review.get_by_role("row").filter(has_text=member.name)).to_contain_text(f"{member_minutes}m")
        expect(review.get_by_role("row").filter(has_text="Total")).to_contain_text(f"{owner_minutes + member_minutes}m")
        expect(review).not_to_contain_text(stranger.name)
        click(page.get_by_role("button", name="Previous week"))
        see(page, page.get_by_role("heading", name=f"Week of {day_label(monday)}", level=2), "back to current week")
    totals = owner.client.get("/api/workspace/review", params={"week": iso_week(following)}).json()["totals"]
    assert totals["plannedMinutes"] == owner_minutes + member_minutes


def test_wf_weekly_review_remove_member(browser: Browser, app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "removeui")
    member = invite_and_join(app_url, owner, mail)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Workspace"))
        members = page.get_by_role("table", name="Members")
        expect(members.get_by_role("row").filter(has_text=owner.email).get_by_role("button")).to_have_count(0)
        click(members.get_by_role("button", name=f"Remove {member.name}"))
        says(page, f"Removed {member.name}. Active seats: 1.")
        gone(page, members.get_by_role("row").filter(has_text=member.email), "row removed")
    assert members_of(owner)["seats"]["active"] == 1
    assert http(app_url).post("/api/auth/sign-in", json={"email": member.email, "password": PASSWORD}).status_code == 401


def test_wf_weekly_review_remove_pending(browser: Browser, app_url: str, mail: Any) -> None:
    owner = create_workspace(app_url, "Europe/London", "removepending")
    member = invite_and_join(app_url, owner, mail)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Workspace"))
        members = page.get_by_role("table", name="Members")
        remove = members.get_by_role("button", name=f"Remove {member.name}")
        see(page, remove, "Remove button")
        with held(page, "**/api/workspace/members/**") as gate:
            click(remove)
            wait_ui(page, lambda: page.evaluate(PENDING_BUTTON_JS, "Removing…"), "a busy button showing Removing…")
            release_held(gate)
        says(page, f"Removed {member.name}. Active seats: 1.")


def test_wf_billing_and_operations_operator(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "opsui")
    secret = f"{owner.name} confidential"
    add_task(owner, secret, 30)
    with ui(browser, app_url) as page:
        ui_sign_in(page, OPERATOR_EMAIL, SEED_PASSWORD)
        nav = page.get_by_role("navigation", name="Main")
        see(page, nav.get_by_role("link", name="Operations"), "Operations link")
        for hidden in ("Daybook", "Settings", "Workspace"):
            expect(nav.get_by_role("link", name=hidden, exact=True)).to_have_count(0)
        row = page.get_by_role("table", name="Workspaces").get_by_role("row").filter(has_text=owner.workspace["name"])
        see(page, row, "workspace row")
        active = len([owner.member])
        expect(row).to_contain_text(f"{active} / —")
        assert secret not in page.evaluate("document.body.innerText")
    assert ops_row(app_url, owner.workspace["id"])["activeSeats"] == 1


def test_wf_billing_and_operations_seats(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "opsseats")
    assert billing_callback(app_url, owner.workspace["id"], "seats.changed", server_now(app_url), seats=7, secret="forged").status_code == 401
    billed = 3
    active = len([owner.member])
    assert billing_callback(app_url, owner.workspace["id"], "seats.changed", server_now(app_url), seats=billed).json()["applied"] is True
    with ui(browser, app_url) as page:
        ui_sign_in(page, OPERATOR_EMAIL, SEED_PASSWORD)
        row = page.get_by_role("table", name="Workspaces").get_by_role("row").filter(has_text=owner.workspace["name"])
        see(page, row, "workspace row")
        expect(row).to_contain_text(f"{active} / {billed}")
    assert ops_row(app_url, owner.workspace["id"])["billedSeats"] == billed


def test_wf_cross_cutting_layout(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "layout")
    today = today_of(owner)
    title = f"{owner.name} slip"
    add_task(owner, title, 30, today)
    for width, height in VIEWPORTS:
        with ui(browser, app_url, width, height) as page:
            see(page, page.get_by_role("form", name="Sign in"), "sign in")
            layout(page)
            click(page.get_by_role("link", name="Start a free trial"))
            see(page, page.get_by_role("form", name="Start your trial"), "trial form")
            layout(page)
            page.goto(app_url)
            ui_sign_in(page, owner.email)
            days = [day_region(page, today + timedelta(days=i)) for i in range(5)]
            see(page, days[0], "first column")
            layout(page)
            boxes = [d.bounding_box() for d in days]
            assert all(b for b in boxes)
            assert all(abs(b["y"] - boxes[0]["y"]) <= 2 for b in boxes) and all(a["x"] < b["x"] for a, b in zip(boxes, boxes[1:]))
            log = backlog(page).bounding_box()
            strip = calendar_strip(page).bounding_box()
            assert log and strip
            if width == 1280:
                assert log["x"] + log["width"] <= boxes[0]["x"] + 1 and strip["x"] >= boxes[4]["x"] + boxes[4]["width"] - 1
            else:
                assert log["y"] + log["height"] <= boxes[0]["y"] + 1
                assert strip["y"] >= max(b["y"] + b["height"] for b in boxes) - 1
            if width == 375:
                expect(days[0].get_by_role("heading", level=2)).to_contain_text(short_day(today))
                click(page.get_by_role("button", name=f"Show {day_label(today)}"))
                see(page, move_button(page, title), "cards listed after Show")
            else:
                expect(page.get_by_role("button", name=f"Show {day_label(today)}")).to_have_count(0)
            for link, landmark in (("Settings", page.get_by_role("form", name="Day settings")), ("Workspace", page.get_by_role("table", name="Members"))):
                click(page.get_by_role("navigation", name="Main").get_by_role("link", name=link))
                see(page, landmark, link)
                layout(page)
        with ui(browser, app_url, width, height) as page:
            ui_sign_in(page, OPERATOR_EMAIL, SEED_PASSWORD)
            see(page, page.get_by_role("table", name="Workspaces"), "operations table")
            layout(page)


def test_wf_cross_cutting_accessibility(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "access")
    today = today_of(owner)
    loose, planned = f"{owner.name} loose", f"{owner.name} planned"
    add_task(owner, loose, 30)
    add_task(owner, planned, 30, today)
    with ui(browser, app_url) as page:
        ui_sign_in(page, owner.email)
        see(page, card(day_region(page, today), planned), "card")
        brief_axe(page)
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Daybook").focus()
        order = ["Settings", "Pull", "Add a task", "Import tasks", f"Move {loose}", f"Move {planned}", "Next day"]
        found = focus_positions(page, order, 40)
        assert set(found) == set(order), found
        positions = [found[n] for n in order]
        assert positions == sorted(positions), found
        handle = move_button(page, planned)
        page.evaluate("document.activeElement && document.activeElement.blur()")
        advance(page, UI_STEP_MS)
        settle(handle)
        rest = focus_ring(handle)
        handle.focus()
        advance(page, UI_STEP_MS)
        settle(handle)
        assert focus_ring(handle) != rest, "focusing the Move handle changes no ring style on it, its pseudo-elements or its card"
        ritual(page, "Estimate")
        targets = [handle, page.get_by_role("checkbox", name=f"Done: {planned}"), page.get_by_role("radiogroup", name=f"Estimate for {planned}").get_by_role("radio", name="15 minutes"), page.get_by_role("navigation", name="Main").get_by_role("link", name="Daybook")]
        for target in targets:
            width, height = target_size(target)
            assert width >= TAP_MIN_PX and height >= TAP_MIN_PX, (target, width, height)
        opener = backlog(page).get_by_role("button", name="Import tasks")
        click(opener)
        dialog = page.get_by_role("dialog", name="Import tasks")
        see(page, dialog, "import dialog")
        wait_ui(page, lambda: dialog.get_by_label("CSV export").evaluate("el => el === document.activeElement"), "focus on first field")
        for _ in range(5):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        gone(page, dialog, "dialog closed")
        focused(page, opener, "focus back on the opener")
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Settings"))
        see(page, page.get_by_role("form", name="Day settings"), "settings")
        brief_axe(page)
        click(page.get_by_role("navigation", name="Main").get_by_role("link", name="Workspace"))
        see(page, page.get_by_role("table", name="Members"), "workspace")
        brief_axe(page)


APP_DIR = Path("/app")


def _run(command: str) -> subprocess.CompletedProcess:
    return subprocess.run(as_app_user(f"cd {DEPLOYED_APP} && {command}"), cwd=DEPLOYED_APP, env=app_user_env(), capture_output=True, text=True, timeout=NPM_TIMEOUT_S)


def _shipped() -> dict[tuple[str, str], dict]:
    tree = json.loads(_run("npm ls --omit=dev --all --json --long").stdout or "{}")
    found: dict[tuple[str, str], dict] = {}

    def walk(deps: dict | None) -> None:
        for name, info in (deps or {}).items():
            if info.get("missing") or not info.get("version"):
                continue
            key = (name, str(info.get("version", "")))
            if key not in found:
                found[key] = info
                walk(info.get("dependencies"))

    walk(tree.get("dependencies"))
    return found


def _plain(text: str) -> str:
    return re.sub(r"[-_]+", " ", text.lower())


def _licence(info: dict) -> str:
    value = info.get("license", "")
    return value.get("type", "") if isinstance(value, dict) else str(value)


def _licence_ok(expression: str) -> bool:
    cleaned = expression.replace("(", "").replace(")", "").strip()
    if " OR " in cleaned:
        return any(_licence_ok(p) for p in cleaned.split(" OR "))
    if " AND " in cleaned:
        return all(_licence_ok(p) for p in cleaned.split(" AND "))
    return cleaned in ALLOWED_LICENCES or cleaned == "OFL-1.1"


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert all(isinstance(v, str) and v for v in manifest.values())
    assert manifest["_schema"] == "run-manifest-v1"


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    packages = _shipped()
    missing = [f"{n}@{v}" for n, v in packages if n not in notices or v not in notices]
    assert not missing, missing
    for font in FONTS:
        assert _plain(font) in _plain(notices), font


def test_if_licences_allowed() -> None:
    bad = [f"{n}@{v}: {_licence(i)}" for (n, v), i in _shipped().items() if not _licence_ok(_licence(i))]
    assert not bad, bad
    notices = _plain((APP_DIR / "THIRD_PARTY_NOTICES.md").read_text())
    for font in FONTS:
        spots = [m.start() for m in re.finditer(re.escape(_plain(font)), notices)]
        assert any(FONT_LICENCE.search(notices[s : s + FONT_WINDOW]) for s in spots), font


def test_if_postgres_only() -> None:
    stores = [s.lower() for s in FORBIDDEN_STORES]
    names = [n.lower() for n, _ in _shipped()]
    assert not [n for n in names if any(s in n for s in stores)]
    stray = [p for p in APP_DIR.rglob("*") if "node_modules" not in p.parts and ".git" not in p.parts and stores[0] in p.name.lower()]
    assert not stray, stray


def test_if_services_untouched() -> None:
    assert os.environ.get("MAIL_FROM") == MAIL_FROM
    assert MAIL_FROM_ADDRESS in mail_from_address()


def test_if_assets_same_origin(browser: Browser, app_url: str) -> None:
    owner = create_workspace(app_url, "Europe/London", "assets")
    requests: list[str] = []
    with ui(browser, app_url) as page:
        page.on("request", lambda r: requests.append(r.url))
        page.reload()
        ui_sign_in(page, owner.email)
        see(page, day_region(page, today_of(owner)), "Daybook")
        families = page.evaluate("async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/[\"']/g, '')); }")
    foreign = [u for u in requests if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign
    for font in FONTS:
        assert any(font in family for family in families), families


def test_if_typescript_strict() -> None:
    check = _run("npx tsc --noEmit")
    assert check.returncode == 0, check.stdout[-4000:] + check.stderr[-4000:]
    shown = json.loads(_run("npx tsc --showConfig").stdout)
    configs = [shown] + [json.loads(_run(f"npx tsc --showConfig -p {shlex.quote(ref['path'])}").stdout)
                         for ref in shown.get("references") or []]
    compiled = [c for c in configs if c.get("files") or c.get("include")]
    assert compiled and all(c.get("compilerOptions", {}).get("strict") is True for c in compiled), configs
