from __future__ import annotations

import copy
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import uuid
from collections import Counter
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from time import monotonic
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlparse

import httpx
import pytest
from playwright.sync_api import Page, expect

from conftest import (
    Postgres,
    advance,
    axe,
    check,
    click,
    fill,
    held,
    layout,
    open_app,
    same_origin,
    select,
    state_styles,
    tab_order,
    unique,
    until,
)


HTTP_TIMEOUT = 30
WAIT_SECONDS = 30
WAIT_MS = 30000
NPM_TIMEOUT = 120
COPY_BOOT_SECONDS = 120
COPY_STOP_SECONDS = 15
COPY_LOCKOUT_SECONDS = 10
TAB_PRESSES = 15
ROUNDS = 3

expect.set_options(timeout=WAIT_MS)

PASSWORD = "deku-demo-pw-2026"
WRONG_PASSWORD = "not-the-password"
ADMIN = "admin@example.com"
DISPATCHER = "dispatcher@example.com"
MANAGER = "manager@example.com"
MILO = "milo@example.com"
MEMBERS = {
    "admin": ("1", "Ada Admin", ADMIN, "admin"),
    "dispatcher": ("2", "Dex Dispatcher", DISPATCHER, "dispatcher"),
    "manager": ("3", "Maya Manager", MANAGER, "tour_manager"),
    "milo": ("4", "Milo Manager", MILO, "tour_manager"),
}
MEMBER_IDS = ["admin", "dispatcher", "manager", "milo"]

FAILS_TO_LOCK = 5
DEFAULT_LOCKOUT_SECONDS = 900
LOCKOUT_SECONDS = int(os.environ.get("SIGN_IN_LOCKOUT_SECONDS", str(DEFAULT_LOCKOUT_SECONDS)))
TOUR_NAME_MAX = 80
NOTES_MAX = 500
NOTE_MAX = 500
TRUCKS_MAX = 8
LIMIT_MAX = 100
FIRST_PAGE = 50
PHONE_WIDTH = 360
PHONE_HEIGHT = 812

LABEL_ROLL_MAX_MS = 400
STAGGER_MIN_MS = 50
STAGGER_MAX_MS = 200
HEADLINE_MAX_MS = 900
FRAME_CLUSTER_MS = 20
RAIL_MIN_MS = 20000
RAIL_MAX_MS = 40000
SPIN_MIN_MS = 500
SPIN_MAX_MS = 2000
REDUCED_MAX_MS = 1

INVALID_CREDENTIALS = "Invalid email or password."
RATE_LIMITED = "Too many sign-in attempts. Try again later."
ACCESS_COPY = "You do not have access to this page."
REQUEST_NOT_FOUND_COPY = "This request does not exist or you cannot see it."
WRONG_VENUE = "404. Wrong venue."
WRONG_VENUE_LINE = "This address is not on the run sheet."
DECIDED = "This request has already been decided."
NOT_AVAILABLE = "This truck is not available."
FULL = "This request already has every truck it asked for."
EARLY_CONFIRM = "Assign every requested truck before confirming."
ON_REQUEST = "This truck is on a request."
LAST_ADMIN = "At least one admin is required."
NOTE_REQUIRED = "Add a note to explain your decision."
CONFIRM_NOTE = "Two trucks confirmed for the spring run."
DECLINE_NOTE = "No trucks free on those dates."
STATUS_LABELS = {"available": "Available", "assigned": "Assigned", "maintenance": "Maintenance"}
DEX_NAME = MEMBERS["dispatcher"][1]
ADA_NAME = MEMBERS["admin"][1]

MISSING_REQUEST = "LR-9999"
MISSING_TRUCK = "TR-999"
MISSING_MEMBER = "9999"
JUNK_TOKEN = "junk-token-for-verifier"
CLEANUP_NOTE = "Verifier cleanup."
PROTECTED_TRUCK = "TR-108"

SEED_TRUCKS = {
    "TR-101": "north", "TR-102": "north", "TR-103": "north", "TR-104": "north",
    "TR-105": "south", "TR-106": "south", "TR-107": "south", "TR-108": "south",
    "TR-109": "south", "TR-110": "north",
}
UNTOUCHED_TRUCKS = {
    "TR-103": ("assigned", "LR-0001"),
    "TR-104": ("maintenance", None),
    "TR-106": ("assigned", "LR-0003"),
    "TR-107": ("assigned", "LR-0003"),
}
STOP_KINDS = ["pickup", "delivery", "first_show", "last_show"]
STOP_LEGENDS = ["Pickup", "Delivery", "First Show", "Last Show"]
STOP_CARD_TITLES = ["( 1 ) Pickup", "( 2 ) Delivery", "( 3 ) First Show", "( 4 ) Last Show"]
EARLY_DELIVERY = "2026-04-09"

TORONTO = {"address": "40 Arena Way", "city": "Toronto", "region": "ON", "postal_code": "M5V 2T6", "country": "Canada"}
JOURNEY_STOPS = {
    "pickup": {"date": "2026-04-10", "address": "12 Quarry Lane", "city": "Ottawa", "region": "ON", "postal_code": "K1A 0B1", "country": "Canada"},
    "delivery": {"date": "2026-04-11", **TORONTO},
    "first_show": {"date": "2026-04-12", **TORONTO},
    "last_show": {"date": "2026-04-30", "address": "9 Riverside Drive", "city": "Chicago", "region": "IL", "postal_code": "60601", "country": "USA"},
}

SEED_REQUESTS = {
    "LR-0001": {
        "tour_name": "Velvet Fuzz winter run", "requester": "Maya Manager", "transport_type": "tour",
        "trucks_requested": 3, "status": "submitted", "created_at": "2026-03-02T09:00:00Z",
        "trucks": ["TR-103"], "decided_by": None, "decided_at": None, "decision_note": None,
        "stops": [("Quebec City", "Canada", "2026-03-20"), ("Boston", "USA", "2026-03-21"),
                  ("Boston", "USA", "2026-03-22"), ("Cleveland", "USA", "2026-04-05")],
        "activity": [("submitted", "Maya Manager", "Requested 3 trucks", "2026-03-02T09:00:00Z"),
                     ("truck_assigned", "Dex Dispatcher", "TR-103 assigned", "2026-03-02T11:00:00Z")],
    },
    "LR-0002": {
        "tour_name": "Harbour Lights festival stage", "requester": "Milo Manager", "transport_type": "show",
        "trucks_requested": 2, "status": "submitted", "created_at": "2026-03-03T14:30:00Z",
        "trucks": [], "decided_by": None, "decided_at": None, "decision_note": None,
        "stops": [("Moncton", "Canada", "2026-06-10"), ("Halifax", "Canada", "2026-06-11"),
                  ("Halifax", "Canada", "2026-06-12"), ("Halifax", "Canada", "2026-06-14")],
        "activity": [("submitted", "Milo Manager", "Requested 2 trucks", "2026-03-03T14:30:00Z")],
    },
    "LR-0003": {
        "tour_name": "Northern Echo arena run", "requester": "Maya Manager", "transport_type": "tour",
        "trucks_requested": 2, "status": "confirmed", "created_at": "2026-02-26T10:15:00Z",
        "trucks": ["TR-106", "TR-107"], "decided_by": "Dex Dispatcher", "decided_at": "2026-02-27T16:00:00Z",
        "decision_note": "Confirmed with two southern trucks.",
        "stops": [("Calgary", "Canada", "2026-03-01"), ("Vancouver", "Canada", "2026-03-02"),
                  ("Vancouver", "Canada", "2026-03-03"), ("Seattle", "USA", "2026-03-15")],
        "activity": [("submitted", "Maya Manager", "Requested 2 trucks", "2026-02-26T10:15:00Z"),
                     ("truck_assigned", "Dex Dispatcher", "TR-106 assigned", "2026-02-27T15:30:00Z"),
                     ("truck_assigned", "Dex Dispatcher", "TR-107 assigned", "2026-02-27T15:30:00Z"),
                     ("confirmed", "Dex Dispatcher", "Confirmed with two southern trucks.", "2026-02-27T16:00:00Z")],
    },
    "LR-0004": {
        "tour_name": "Film set lighting rig", "requester": "Milo Manager", "transport_type": "show_freight",
        "trucks_requested": 1, "status": "declined", "created_at": "2026-02-24T08:45:00Z",
        "trucks": [], "decided_by": "Dex Dispatcher", "decided_at": "2026-02-24T13:00:00Z",
        "decision_note": "No trucks free on those dates.",
        "stops": [("Atlanta", "USA", None), ("Savannah", "USA", None),
                  ("Savannah", "USA", None), ("Savannah", "USA", None)],
        "activity": [("submitted", "Milo Manager", "Requested 1 truck", "2026-02-24T08:45:00Z"),
                     ("declined", "Dex Dispatcher", "No trucks free on those dates.", "2026-02-24T13:00:00Z")],
    },
}

MOTION_PROBE = r"""
(() => {
  const inside = (node, tag) => { for (let el = node; el; el = el.parentElement) { if (el.tagName === tag) return true; } return false; };
  const log = [];
  Object.defineProperty(window, '__motion', { value: log });
  const record = (target, anim, source) => {
    const effect = anim.effect;
    if (!effect) return;
    const timing = effect.getComputedTiming();
    const frames = effect.getKeyframes ? effect.getKeyframes() : [];
    const first = frames[0] || {};
    const shift = first.transform !== undefined ? first.transform : first.translate;
    log.push({
      source,
      at: document.timeline.currentTime,
      delay: timing.delay || 0,
      duration: typeof timing.duration === 'number' ? timing.duration : 0,
      infinite: timing.iterations === Infinity,
      heading: inside(target, 'H1'),
      button: inside(target, 'BUTTON'),
      property: anim.transitionProperty || '',
      opacity: first.opacity === undefined ? null : String(first.opacity),
      transform: shift === undefined ? null : String(shift),
    });
  };
  document.addEventListener('animationstart', (e) => {
    for (const a of e.target.getAnimations()) if (a.animationName === e.animationName) record(e.target, a, 'animation');
  }, true);
  document.addEventListener('transitionrun', (e) => {
    for (const a of e.target.getAnimations()) if (a.transitionProperty === e.propertyName) record(e.target, a, 'transition');
  }, true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); record(this, a, 'waapi'); return a; };
})();
"""
LIVE_ANIMATIONS = """() => document.getAnimations().filter(a => a.playState === 'running').map(a => {
  const t = a.effect.getComputedTiming();
  return {duration: typeof t.duration === 'number' ? t.duration : 0, delay: t.delay || 0, infinite: t.iterations === Infinity};
})"""


@pytest.fixture
def db() -> Postgres:
    return Postgres()


def lit(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def fresh_tag(prefix: str = "tour") -> str:
    parts = unique(prefix)
    for part in parts:
        if "@" not in part:
            return part
    return parts[0].split("@")[0]


def fresh_email(prefix: str = "visitor") -> str:
    parts = unique(prefix)
    for part in parts:
        if "@" in part:
            return part
    return f"{parts[0]}@example.com"


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def call(base: str, method: str, path: str, token: str | None = None, body: Any = None,
         headers: dict[str, str] | None = None, params: dict[str, Any] | None = None) -> httpx.Response:
    sent = dict(headers or {})
    if token:
        sent["Authorization"] = f"Bearer {token}"
    extra: dict[str, Any] = {} if body is None else {"json": body}
    return httpx.request(method, base + path, headers=sent, params=params, timeout=HTTP_TIMEOUT, **extra)


def attempt(base: str, email: str, password: str) -> httpx.Response:
    return call(base, "POST", "/api/auth/login", body={"email": email, "password": password})


def login(base: str, email: str) -> str:
    r = attempt(base, email, PASSWORD)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def request_body(name: str, trucks: int = 2, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"tour_name": name, "transport_type": "tour", "trucks_requested": trucks,
                            "stops": copy.deepcopy(JOURNEY_STOPS)}
    body.update(extra)
    return body


def submit(base: str, token: str, name: str, trucks: int = 2, **extra: Any) -> str:
    r = call(base, "POST", "/api/requests", token, request_body(name, trucks, **extra))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def get_request(base: str, token: str, rid: str) -> dict[str, Any]:
    r = call(base, "GET", f"/api/requests/{rid}", token)
    assert r.status_code == 200, r.text
    return r.json()


def activity(base: str, token: str, rid: str) -> list[dict[str, Any]]:
    r = call(base, "GET", f"/api/requests/{rid}/activity", token)
    assert r.status_code == 200, r.text
    return r.json()


def assign(base: str, token: str, rid: str, tid: str) -> httpx.Response:
    return call(base, "POST", f"/api/requests/{rid}/assignments", token, {"truck_id": tid})


def release(base: str, token: str, rid: str, tid: str) -> httpx.Response:
    return call(base, "DELETE", f"/api/requests/{rid}/assignments/{tid}", token)


def decide(base: str, token: str, rid: str, decision: str, note: str) -> httpx.Response:
    return call(base, "POST", f"/api/requests/{rid}/decision", token, {"decision": decision, "note": note})


def set_truck(base: str, token: str, tid: str, status: str) -> httpx.Response:
    return call(base, "PATCH", f"/api/trucks/{tid}", token, {"status": status})


def set_role(base: str, token: str, member_id: str, role: str) -> httpx.Response:
    return call(base, "PATCH", f"/api/users/{member_id}", token, {"role": role})


def fleet(base: str, token: str, status: str | None = None) -> list[dict[str, Any]]:
    r = call(base, "GET", "/api/trucks", token, params={"status": status} if status else None)
    assert r.status_code == 200, r.text
    return r.json()


def truck(base: str, token: str, tid: str) -> dict[str, Any]:
    return next(t for t in fleet(base, token) if t["id"] == tid)


def free_trucks(base: str, token: str, count: int) -> list[str]:
    ids = [t["id"] for t in fleet(base, token, "available") if t["id"] != PROTECTED_TRUCK]
    assert len(ids) >= count, f"the test needs {count} available trucks; the fleet has {ids}"
    return ids[:count]


def option_label(base: str, token: str, tid: str) -> str:
    return f"{tid} ({truck(base, token, tid)['depot'].capitalize()})"


def decline_quietly(base: str, token: str, rid: str) -> None:
    decide(base, token, rid, "decline", CLEANUP_NOTE)


def list_ids(base: str, token: str, **params: Any) -> list[str]:
    r = call(base, "GET", "/api/requests", token, params=params)
    assert r.status_code == 200, r.text
    return [item["id"] for item in r.json()]


def together(*calls: Callable[[], httpx.Response]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))
    results: list[Any] = [None] * len(calls)

    def run(i: int, fn: Callable[[], httpx.Response]) -> None:
        barrier.wait()
        try:
            results[i] = fn()
        except Exception as exc:
            results[i] = exc

    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(calls)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(HTTP_TIMEOUT * 2)
    for result in results:
        assert isinstance(result, httpx.Response), result
    return results


def assignment_rows(db: Postgres, rid: str) -> list[dict[str, Any]]:
    return db.rows(f"select truck_id, assigned_by from assignments where request_id = {lit(rid)} order by truck_id")


def activity_count(db: Postgres, rid: str, kind: str, note: str | None = None) -> int:
    clause = "" if note is None else f" and note = {lit(note)}"
    return db.rows(f"select count(*) as n from activity where request_id = {lit(rid)} and kind = {lit(kind)}{clause}")[0]["n"]


def board_consistent(base: str, token: str) -> dict[str, Any]:
    r = call(base, "GET", "/api/dispatch", token)
    assert r.status_code == 200, r.text
    board = r.json()
    summary, requests = board["summary"], board["requests"]
    assert summary["waiting"] == len(requests)
    assert summary["trucks_needed"] == sum(max(0, x["trucks_requested"] - x["trucks_assigned"]) for x in requests)
    assert summary["trucks_available"] == len(fleet(base, token, "available"))
    return board


def fleet_matches_rows(db: Postgres, listed: list[dict[str, Any]]) -> None:
    rows = db.rows("select a.truck_id, a.request_id, r.status from assignments a "
                   "join logistics_requests r on r.id = a.request_id")
    assert not [row for row in rows if row["status"] not in ("submitted", "confirmed")], rows
    stored = {row["id"]: row["status"] for row in db.rows("select id, status from trucks")}
    for t in listed:
        linked = [row for row in rows if row["truck_id"] == t["id"]]
        assert stored[t["id"]] == t["status"], t
        if t["status"] == "assigned":
            assert len(linked) == 1 and linked[0]["request_id"] == t["request_id"], (t, linked)
        else:
            assert linked == [] and t["request_id"] is None, (t, linked)


def board_line(waiting: int, needed: int, available: int) -> str:
    def trucks(n: int, word: str) -> str:
        return f"{n} truck {word}" if n == 1 else f"{n} trucks {word}"
    return f"{waiting} waiting, {trucks(needed, 'needed')}, {trucks(available, 'available')}"


def count_line(assigned: int, requested: int) -> str:
    return f"{assigned} of {requested} trucks assigned"


def requested_note(n: int) -> str:
    return f"Requested {n} truck" if n == 1 else f"Requested {n} trucks"


def fleet_line(available: int, assigned: int, maintenance: int) -> str:
    return f"{available} available, {assigned} assigned, {maintenance} in maintenance"


def decision_line(word: str, name: str) -> str:
    return f"{word} by {name}"


def truck_row(page: Page, tid: str):
    return page.get_by_role("row").filter(has_text=tid)


def ordered(locator: Any, parts: list[str]) -> None:
    text = " ".join((locator.text_content() or "").split()).lower()
    pos = -1
    for part in parts:
        found = text.find(part.lower(), pos + 1)
        assert found > pos, (part, text[:3000])
        pos = found


def sign_in(page: Page, base: str, email: str, path: str = "/requests") -> None:
    page.goto(f"{base}/login?next={quote(path, safe='/')}")
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password", exact=True), PASSWORD)
    click(page.get_by_role("button", name="Sign in", exact=True))
    page.wait_for_url(lambda url: urlparse(url).path == path, timeout=WAIT_MS)


def notices(page: Page):
    return page.get_by_role("status", name="Desk notices")


def nav_link(page: Page, name: str):
    return page.get_by_role("navigation").get_by_role("link", name=name, exact=True)


def body_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def fill_stops(page: Page, stops: dict[str, dict[str, Any]]) -> None:
    for kind, legend in zip(STOP_KINDS, STOP_LEGENDS):
        group = page.get_by_role("group", name=legend, exact=True)
        stop = stops[kind]
        fill(group.get_by_label("Date (optional)"), stop["date"] or "")
        fill(group.get_by_label("Address", exact=True), stop["address"])
        fill(group.get_by_label("City", exact=True), stop["city"])
        fill(group.get_by_label("State or Province", exact=True), stop["region"])
        fill(group.get_by_label("Postal Code", exact=True), stop["postal_code"])
        fill(group.get_by_label("Country", exact=True), stop["country"])


def walk_to_review(page: Page, base: str, name: str) -> None:
    page.goto(f"{base}/requests/new")
    fill(page.get_by_role("textbox", name="Tour name"), name)
    check(page.get_by_role("radio", name="Tour", exact=True))
    fill(page.get_by_label("Number of trucks"), "2")
    click(page.get_by_role("button", name="Next", exact=True))
    page.wait_for_url(lambda url: urlparse(url).path == "/requests/new/stops", timeout=WAIT_MS)
    fill_stops(page, JOURNEY_STOPS)
    click(page.get_by_role("button", name="Next", exact=True))
    page.wait_for_url(lambda url: urlparse(url).path == "/requests/new/review", timeout=WAIT_MS)


SUBMITTED_PATH = re.compile(r"^/requests/(LR-\d{4})/submitted$")


def submitted_id(page: Page) -> str:
    page.wait_for_url(lambda url: bool(SUBMITTED_PATH.match(urlparse(url).path)), timeout=WAIT_MS)
    return SUBMITTED_PATH.match(urlparse(page.url).path).group(1)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("0.0.0.0", 0))
        return sock.getsockname()[1]


def tail(log_path: str) -> str:
    return Path(log_path).read_text(errors="replace")[-4000:]


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[tuple[str, subprocess.Popen, str]]:
    from conftest import DEPLOYED_APP

    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base}
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env,
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        yield base, proc, log.name
    finally:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        try:
            proc.wait(timeout=COPY_STOP_SECONDS)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            proc.wait(timeout=COPY_STOP_SECONDS)
        log.close()


def pace(proc: subprocess.Popen, log_path: str) -> None:
    try:
        proc.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        return
    pytest.fail(f"the app copy exited early:\n{tail(log_path)}")


def wait_health(base: str, proc: subprocess.Popen, log_path: str, status: int) -> httpx.Response:
    deadline = monotonic() + COPY_BOOT_SECONDS
    while True:
        try:
            r = httpx.get(f"{base}/api/health", timeout=2)
            if r.status_code == status:
                return r
        except httpx.TransportError:
            pass
        assert monotonic() < deadline, f"health never answered {status}:\n{tail(log_path)}"
        pace(proc, log_path)


def shipped_packages() -> dict[tuple[str, str], dict[str, Any]]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd="/app",
                         capture_output=True, text=True, timeout=NPM_TIMEOUT)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple[str, str], dict[str, Any]] = {}

    def walk(node: dict[str, Any]) -> None:
        for name, dep in (node.get("dependencies") or {}).items():
            key = (name, str(dep.get("version", "")))
            if key not in found:
                found[key] = dep
                walk(dep)

    walk(tree)
    assert found, f"npm ls reported no shipped packages: {out.stderr[-2000:]}"
    return found


def package_licence(name: str, dep: dict[str, Any]) -> str:
    licence = dep.get("license")
    if licence is None:
        from conftest import DEPLOYED_APP
        for root in [dep.get("path"), f"/app/node_modules/{name}", f"{DEPLOYED_APP}/node_modules/{name}"]:
            if root and (Path(root) / "package.json").exists():
                licence = json.loads((Path(root) / "package.json").read_text()).get("license")
                break
    if isinstance(licence, dict):
        licence = licence.get("type")
    return str(licence or "")


@pytest.mark.parametrize("who", MEMBER_IDS, ids=MEMBER_IDS)
def test_seeded_sign_in(app_url, who):
    member_id, name, email, role = MEMBERS[who]
    r = attempt(app_url, f"  {email.upper()}  ", PASSWORD)
    assert r.status_code == 200, r.text
    data = r.json()
    token = data["token"]
    assert isinstance(token, str) and token
    user = data["user"]
    assert (str(user["id"]), user["name"], user["email"], user["role"]) == (member_id, name, email, role)
    me = call(app_url, "GET", "/api/auth/me", token)
    assert me.status_code == 200
    described = me.json()["user"]
    assert (str(described["id"]), described["name"], described["email"], described["role"]) == (member_id, name, email, role)
    other = login(app_url, email)
    out = call(app_url, "POST", "/api/auth/logout", token)
    assert out.status_code == 204
    after = call(app_url, "GET", "/api/auth/me", token)
    assert after.status_code == 401 and after.json()["error"] == "unauthenticated"
    assert call(app_url, "GET", "/api/auth/me", other).status_code == 200


PROTECTED_ROUTES = [
    ("GET", "/api/auth/me", None),
    ("POST", "/api/auth/logout", None),
    ("GET", "/api/requests", None),
    ("POST", "/api/requests", {}),
    ("GET", "/api/requests/LR-0001", None),
    ("GET", "/api/requests/LR-0001/activity", None),
    ("POST", "/api/requests/LR-0001/assignments", {"truck_id": "TR-101"}),
    ("DELETE", "/api/requests/LR-0001/assignments/TR-103", None),
    ("POST", "/api/requests/LR-0001/decision", {"decision": "decline", "note": "x"}),
    ("GET", "/api/dispatch", None),
    ("GET", "/api/trucks", None),
    ("PATCH", "/api/trucks/TR-101", {"status": "maintenance"}),
    ("GET", "/api/users", None),
    ("PATCH", "/api/users/4", {"role": "admin"}),
]


def test_refused_sign_in_and_missing_sessions(app_url, db):
    unknown = fresh_email("nobody")
    for r in [attempt(app_url, DISPATCHER, WRONG_PASSWORD), attempt(app_url, unknown, WRONG_PASSWORD),
              call(app_url, "POST", "/api/auth/login", body={"email": unknown})]:
        assert r.status_code == 401
        assert r.json()["error"] == "invalid_credentials" and r.json()["message"] == INVALID_CREDENTIALS
    login(app_url, DISPATCHER)
    for method, path, body in PROTECTED_ROUTES:
        for token in (None, JUNK_TOKEN):
            r = call(app_url, method, path, token, body)
            assert r.status_code == 401, (method, path, r.status_code)
            assert r.json()["error"] == "unauthenticated"
    assert get_request(app_url, login(app_url, ADMIN), "LR-0001")["trucks"] == [{"id": "TR-103", "depot": "north"}]
    health = call(app_url, "GET", "/api/health")
    assert health.status_code == 200 and health.json()["status"] == "ok"


def test_sign_in_throttle_unknown_address(app_url, db):
    email = fresh_email("locked")
    for _ in range(FAILS_TO_LOCK):
        r = attempt(app_url, email, WRONG_PASSWORD)
        assert r.status_code == 401 and r.json()["message"] == INVALID_CREDENTIALS
    for variant in (email, f"  {email.upper()} "):
        r = attempt(app_url, variant, WRONG_PASSWORD)
        assert r.status_code == 429
        assert r.json()["error"] == "rate_limited" and r.json()["message"] == RATE_LIMITED
        assert 1 <= int(r.headers["Retry-After"]) <= LOCKOUT_SECONDS
    other = attempt(app_url, fresh_email("bystander"), WRONG_PASSWORD)
    assert other.status_code == 401
    rows = db.rows(f"select succeeded from sign_in_attempts where email = {lit(email.strip().lower())}")
    assert len(rows) == FAILS_TO_LOCK and not any(row["succeeded"] for row in rows)


def test_sign_in_success_resets_count(app_url, db):
    query = f"select count(*) as n from sign_in_attempts where email = {lit(DISPATCHER)} and not succeeded"
    before = db.rows(query)[0]["n"]
    for _ in range(2):
        for _ in range(FAILS_TO_LOCK - 1):
            assert attempt(app_url, DISPATCHER, WRONG_PASSWORD).status_code == 401
        assert attempt(app_url, DISPATCHER, PASSWORD).status_code == 200
    assert db.rows(query)[0]["n"] == before + 2 * (FAILS_TO_LOCK - 1)


def test_sign_in_throttle_persists_and_locks_known_address(app_url):
    with app_copy({"SIGN_IN_LOCKOUT_SECONDS": str(COPY_LOCKOUT_SECONDS)}) as (base, proc, log_path):
        wait_health(base, proc, log_path, 200)
        stranger = fresh_email("stranger")
        for _ in range(FAILS_TO_LOCK):
            assert attempt(app_url, stranger, WRONG_PASSWORD).status_code == 401
        assert attempt(base, stranger, WRONG_PASSWORD).status_code == 429
        try:
            for _ in range(FAILS_TO_LOCK):
                assert attempt(base, MILO, WRONG_PASSWORD).status_code == 401
            locked = attempt(base, MILO, PASSWORD)
            assert locked.status_code == 429 and locked.json()["message"] == RATE_LIMITED
            assert 1 <= int(locked.headers["Retry-After"]) <= COPY_LOCKOUT_SECONDS
        finally:
            deadline = monotonic() + COPY_LOCKOUT_SECONDS * 3
            while attempt(base, MILO, PASSWORD).status_code != 200:
                assert monotonic() < deadline, "the copy's lockout window never ended"
                pace(proc, log_path)
    assert attempt(app_url, MILO, PASSWORD).status_code == 200


def test_wf_sign_in_next_and_reload(browser, app_url):
    with open_app(browser, f"{app_url}/fleet") as page:
        page.wait_for_url(lambda url: urlparse(url).path == "/login", timeout=WAIT_MS)
        assert parse_qs(urlparse(page.url).query).get("next") == ["/fleet"]
        fill(page.get_by_role("textbox", name="Email"), DISPATCHER)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        page.wait_for_url(lambda url: urlparse(url).path == "/fleet", timeout=WAIT_MS)
        expect(nav_link(page, "Fleet")).to_have_attribute("aria-current", "page")
        page.reload()
        assert urlparse(page.url).path == "/fleet"
        expect(nav_link(page, "Fleet")).to_have_attribute("aria-current", "page")
        page.goto(f"{app_url}/")
        page.wait_for_url(lambda url: urlparse(url).path == "/requests", timeout=WAIT_MS)
        click(page.get_by_role("button", name="Sign out"))
        page.wait_for_url(lambda url: urlparse(url).path == "/login", timeout=WAIT_MS)
        page.goto(f"{app_url}/fleet")
        page.wait_for_url(lambda url: urlparse(url).path == "/login", timeout=WAIT_MS)
    with open_app(browser, f"{app_url}/login?next=%2F%2Fevil.example") as page:
        fill(page.get_by_role("textbox", name="Email"), DISPATCHER)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        page.wait_for_url(lambda url: urlparse(url).path == "/requests", timeout=WAIT_MS)
        assert same_origin(page.url, app_url)


def test_wf_sign_in_refused_keeps_email(browser, app_url):
    wrong = fresh_email("typo")
    locked = fresh_email("hammered")
    for _ in range(FAILS_TO_LOCK):
        assert attempt(app_url, locked, WRONG_PASSWORD).status_code == 401
    api = attempt(app_url, locked, WRONG_PASSWORD)
    assert api.status_code == 429 and int(api.headers["Retry-After"]) >= 1
    with open_app(browser, f"{app_url}/login") as page:
        email_box = page.get_by_role("textbox", name="Email")
        expect(page.get_by_role("alert", name="Sign-in error")).to_have_count(0)
        fill(email_box, wrong)
        fill(page.get_by_label("Password", exact=True), WRONG_PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        expect(page.get_by_role("alert", name="Sign-in error")).to_contain_text(INVALID_CREDENTIALS)
        expect(email_box).to_have_value(wrong)
        fill(email_box, locked)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        expect(page.get_by_role("alert", name="Sign-in error")).to_contain_text(RATE_LIMITED)
        expect(email_box).to_have_value(locked)
        assert urlparse(page.url).path == "/login"


def test_wf_seeded_desk_fleet(browser, app_url):
    dex = login(app_url, DISPATCHER)
    listed = fleet(app_url, dex)
    assert [t["id"] for t in listed] == list(SEED_TRUCKS)
    for t in listed:
        assert t["depot"] == SEED_TRUCKS[t["id"]]
        assert t["status"] in ("available", "assigned", "maintenance")
    for tid, (status, rid) in UNTOUCHED_TRUCKS.items():
        t = next(x for x in listed if x["id"] == tid)
        assert (t["status"], t["request_id"]) == (status, rid)
    for status in ("available", "assigned", "maintenance"):
        narrowed = fleet(app_url, dex, status)
        assert [t["id"] for t in narrowed] == [t["id"] for t in listed if t["status"] == status]
    bad = call(app_url, "GET", "/api/trucks", dex, params={"status": "parked"})
    assert bad.status_code == 400
    assert bad.json() == {"error": "bad_request", "message": "status must be available, assigned or maintenance."}
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, DISPATCHER, "/fleet")
        listed = fleet(app_url, dex)
        counts = Counter(t["status"] for t in listed)
        line = fleet_line(counts["available"], counts["assigned"], counts["maintenance"])
        expect(page.get_by_text(line).first).to_be_visible()
        for t in listed:
            row = truck_row(page, t["id"])
            expect(row).to_have_count(1)
            expect(row).to_contain_text(STATUS_LABELS[t["status"]])
            expect(row).to_contain_text(re.compile(SEED_TRUCKS[t["id"]], re.I))
            if t["request_id"]:
                link = row.get_by_role("link", name=t["request_id"])
                assert urlparse(link.get_attribute("href")).path == f"/requests/{t['request_id']}"
            else:
                expect(row.get_by_role("link")).to_have_count(0)


def test_seeded_requests(app_url, db):
    ada = login(app_url, ADMIN)
    for rid, seed in SEED_REQUESTS.items():
        req = get_request(app_url, ada, rid)
        assert req["tour_name"] == seed["tour_name"]
        assert req["transport_type"] == seed["transport_type"]
        assert req["trucks_requested"] == seed["trucks_requested"]
        assert req["status"] == seed["status"]
        assert req["requester"]["name"] == seed["requester"]
        assert ts(req["created_at"]) == ts(seed["created_at"])
        assert [t["id"] for t in req["trucks"]] == seed["trucks"]
        assert req["trucks_assigned"] == len(seed["trucks"])
        assert req["notes"] in (None, "")
        assert (req["decided_by"] or {}).get("name") == seed["decided_by"]
        assert req["decision_note"] == seed["decision_note"]
        if seed["decided_at"]:
            assert ts(req["decided_at"]) == ts(seed["decided_at"])
        else:
            assert req["decided_at"] is None
        assert [s["kind"] for s in req["stops"]] == STOP_KINDS
        for stop, (city, country, date) in zip(req["stops"], seed["stops"]):
            assert (stop["city"], stop["country"], stop["date"]) == (city, country, date)
            assert stop["address"] and stop["region"] and stop["postal_code"]
        entries = activity(app_url, ada, rid)
        assert [e["kind"] for e in entries] == [a[0] for a in seed["activity"]]
        got = sorted((e["kind"], e["actor"]["name"], e["note"], ts(e["created_at"])) for e in entries)
        assert got == sorted((k, actor, note, ts(at)) for k, actor, note, at in seed["activity"])
    ids = ", ".join(lit(rid) for rid in SEED_REQUESTS)
    stored = {row["id"]: row["n"] for row in db.rows(f"select id, count(*) as n from logistics_requests where id in ({ids}) group by id")}
    assert stored == {rid: 1 for rid in SEED_REQUESTS}
    stops = {row["request_id"]: row["n"] for row in db.rows(f"select request_id, count(*) as n from stops where request_id in ({ids}) group by request_id")}
    assert stops == {rid: 4 for rid in SEED_REQUESTS}
    held_rows = {(row["request_id"], row["truck_id"]) for row in db.rows(f"select request_id, truck_id from assignments where request_id in ({ids})")}
    assert held_rows == {("LR-0001", "TR-103"), ("LR-0003", "TR-106"), ("LR-0003", "TR-107")}


def test_wf_seeded_desk_board(browser, app_url):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    name = f"{fresh_tag('board')} board run"
    rid = submit(app_url, maya, name, 2)
    try:
        board = board_consistent(app_url, dex)
        ids = [r["id"] for r in board["requests"]]
        assert {"LR-0001", "LR-0002", rid} <= set(ids)
        assert "LR-0003" not in ids and "LR-0004" not in ids
        assert all(r["status"] == "submitted" for r in board["requests"])
        created = [ts(r["created_at"]) for r in board["requests"]]
        assert created == sorted(created)
        mine = next(r for r in board["requests"] if r["id"] == rid)
        assert (mine["trucks_requested"], mine["trucks_assigned"], mine["requester"]["name"]) == (2, 0, "Maya Manager")
        [x] = free_trucks(app_url, dex, 1)
        assert assign(app_url, dex, rid, x).status_code == 201
        board = board_consistent(app_url, dex)
        assert next(r for r in board["requests"] if r["id"] == rid)["trucks_assigned"] == 1
        with open_app(browser, f"{app_url}/login") as page:
            sign_in(page, app_url, DISPATCHER, "/dispatch")
            summary = board_consistent(app_url, dex)["summary"]
            line = board_line(summary["waiting"], summary["trucks_needed"], summary["trucks_available"])
            expect(page.get_by_text(line).first).to_be_visible()
            for header in ["ID", "Tour", "Requester", "Type", "Trucks", "First show", "Submitted"]:
                expect(page.get_by_role("columnheader", name=header, exact=True)).to_be_visible()
            link = page.get_by_role("link", name=name)
            assert urlparse(link.get_attribute("href")).path == f"/requests/{rid}"
    finally:
        decline_quietly(app_url, dex, rid)


def test_one_count_of_the_fleet(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    name = f"{fresh_tag('count')} count run"
    rid = submit(app_url, maya, name, 2)
    try:
        a, b, c = free_trucks(app_url, dex, 3)
        assert assign(app_url, dex, rid, a).status_code == 201
        assert assign(app_url, dex, rid, b).status_code == 201
        assert release(app_url, dex, rid, a).status_code == 204
        assert assign(app_url, dex, rid, c).status_code == 201
        req = get_request(app_url, dex, rid)
        assert [t["id"] for t in req["trucks"]] == sorted([b, c]) and req["trucks_assigned"] == 2
        assert {row["truck_id"] for row in assignment_rows(db, rid)} == {b, c}
        item = next(x for x in call(app_url, "GET", "/api/requests", ada, params={"q": name}).json() if x["id"] == rid)
        assert item["trucks_assigned"] == 2
        board = board_consistent(app_url, dex)
        assert next(r for r in board["requests"] if r["id"] == rid)["trucks_assigned"] == 2
        listed = fleet(app_url, dex)
        by_id = {t["id"]: t for t in listed}
        assert (by_id[a]["status"], by_id[a]["request_id"]) == ("available", None)
        assert by_id[b]["request_id"] == rid and by_id[c]["request_id"] == rid
        fleet_matches_rows(db, listed)
        assert decide(app_url, dex, rid, "decline", "Count check done.").status_code == 200
        listed = fleet(app_url, dex)
        fleet_matches_rows(db, listed)
        assert all({t["id"]: t for t in listed}[x]["status"] == "available" for x in (a, b, c))
        assert assignment_rows(db, rid) == []
        assert rid not in [r["id"] for r in board_consistent(app_url, dex)["requests"]]
        gone = get_request(app_url, dex, rid)
        assert (gone["trucks"], gone["trucks_assigned"]) == ([], 0)
    finally:
        decline_quietly(app_url, dex, rid)


VALIDATION_IDS = [
    "tour-name-blank", "tour-name-long", "type-unknown", "trucks-zero", "trucks-nine", "trucks-fraction",
    "stop-missing", "address-blank", "city-blank", "region-blank", "postal-blank", "country-blank",
    "date-invalid", "delivery-before-pickup", "last-before-first", "notes-long", "draft-malformed",
]


def _stop(kind: str, key: str, value: Any) -> Callable[[dict[str, Any]], None]:
    def mutate(body: dict[str, Any]) -> None:
        body["stops"][kind][key] = value
    return mutate


VALIDATION_CASES: dict[str, tuple[str, str | None, Callable[[dict[str, Any]], None]]] = {
    "tour-name-blank": ("tour_name", "Tour name is required.", lambda b: b.update(tour_name="   ")),
    "tour-name-long": ("tour_name", "Tour name must be 80 characters or fewer.", lambda b: b.update(tour_name="x" * (TOUR_NAME_MAX + 1))),
    "type-unknown": ("transport_type", "Choose a type of transportation.", lambda b: b.update(transport_type="truck")),
    "trucks-zero": ("trucks_requested", "Enter a number of trucks from 1 to 8.", lambda b: b.update(trucks_requested=0)),
    "trucks-nine": ("trucks_requested", "Enter a number of trucks from 1 to 8.", lambda b: b.update(trucks_requested=TRUCKS_MAX + 1)),
    "trucks-fraction": ("trucks_requested", "Enter a number of trucks from 1 to 8.", lambda b: b.update(trucks_requested=1.5)),
    "stop-missing": ("stops.delivery", None, lambda b: b["stops"].pop("delivery")),
    "address-blank": ("stops.first_show.address", "Address is required.", _stop("first_show", "address", "")),
    "city-blank": ("stops.pickup.city", "City is required.", _stop("pickup", "city", "")),
    "region-blank": ("stops.last_show.region", "State or province is required.", _stop("last_show", "region", "")),
    "postal-blank": ("stops.last_show.postal_code", "Postal code is required.", _stop("last_show", "postal_code", "")),
    "country-blank": ("stops.delivery.country", "Country is required.", _stop("delivery", "country", "")),
    "date-invalid": ("stops.pickup.date", "Enter a valid date.", _stop("pickup", "date", "2026-02-30")),
    "delivery-before-pickup": ("stops.delivery.date", "Delivery cannot be before pickup.", _stop("delivery", "date", EARLY_DELIVERY)),
    "last-before-first": ("stops.last_show.date", "Last show cannot be before the first show.", _stop("last_show", "date", "2026-04-11")),
    "notes-long": ("notes", "Notes must be 500 characters or fewer.", lambda b: b.update(notes=b["notes"].ljust(NOTES_MAX + 1, "n"))),
    "draft-malformed": ("draft_id", None, lambda b: b.update(draft_id="not-a-uuid")),
}


@pytest.mark.parametrize("case", VALIDATION_IDS, ids=VALIDATION_IDS)
def test_request_validation(app_url, db, case):
    maya = login(app_url, MANAGER)
    tag = fresh_tag("invalid")
    body = request_body(f"{tag} invalid", 2, notes=tag)
    field, reason, mutate = VALIDATION_CASES[case]
    mutate(body)
    r = call(app_url, "POST", "/api/requests", maya, body)
    assert r.status_code == 422, r.text
    data = r.json()
    assert data["error"] == "validation" and field in data["fields"], data
    if reason:
        assert data["fields"][field] == reason
    stored = db.rows(f"select count(*) as n from logistics_requests where notes like {lit('%' + tag + '%')}")
    assert stored[0]["n"] == 0


def test_stored_submission(app_url, db):
    maya = login(app_url, MANAGER)
    tag = fresh_tag("stored")
    name = f"{tag} ".ljust(TOUR_NAME_MAX, "z")
    refused = call(app_url, "POST", "/api/requests", maya, request_body("   ", 2))
    assert refused.status_code == 422
    top = db.rows("select max(id) as m from logistics_requests")[0]["m"]
    expected_id = f"LR-{int(top[3:]) + 1:04d}"
    stops = copy.deepcopy(JOURNEY_STOPS)
    stops["pickup"]["date"] = None
    stops["last_show"]["date"] = stops["first_show"]["date"]
    body = request_body(f"  {name}  ", TRUCKS_MAX, notes="n" * NOTES_MAX, stops=stops,
                        id="LR-0001", status="confirmed", requester_id=4, trucks_assigned=3,
                        decided_by=1, decision_note="x", role="admin")
    r = call(app_url, "POST", "/api/requests", maya, body)
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["id"] == expected_id
    assert req["status"] == "submitted" and req["tour_name"] == name
    assert str(req["requester"]["id"]) == "3" and req["requester"]["name"] == "Maya Manager"
    assert req["trucks_requested"] == TRUCKS_MAX and req["trucks_assigned"] == 0 and req["trucks"] == []
    assert req["decided_by"] is None and req["decision_note"] is None
    assert req["notes"] == "n" * NOTES_MAX
    assert [s["kind"] for s in req["stops"]] == STOP_KINDS
    for stop, kind in zip(req["stops"], STOP_KINDS):
        assert {k: stop[k] for k in stops[kind]} == stops[kind]
    assert get_request(app_url, maya, expected_id)["status"] == "submitted"
    entries = activity(app_url, maya, expected_id)
    assert [(e["kind"], e["note"], e["actor"]["name"]) for e in entries] == [("submitted", requested_note(TRUCKS_MAX), "Maya Manager")]
    row = db.rows(f"select requester_id, status, decided_by from logistics_requests where id = {lit(expected_id)}")[0]
    assert (str(row["requester_id"]), row["status"], row["decided_by"]) == ("3", "submitted", None)
    assert db.rows(f"select count(*) as n from stops where request_id = {lit(expected_id)}")[0]["n"] == 4
    assert db.rows(f"select count(*) as n from activity where request_id = {lit(expected_id)}")[0]["n"] == 1
    single = call(app_url, "POST", "/api/requests", maya, request_body(f"{tag} single", 1))
    assert single.status_code == 201
    assert single.json()["id"] == f"LR-{int(expected_id[3:]) + 1:04d}"
    assert activity(app_url, maya, single.json()["id"])[0]["note"] == "Requested 1 truck"
    assert call(app_url, "GET", "/api/auth/me", maya).json()["user"]["role"] == "tour_manager"


def test_wf_submit_request_happy(browser, app_url, db):
    name = f"Midnight Static spring tour {fresh_tag('ms')}"
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, MANAGER, "/requests")
        click(page.get_by_role("link", name="New request"))
        page.wait_for_url(lambda url: urlparse(url).path == "/requests/new", timeout=WAIT_MS)
        expect(page.get_by_text("( 1 ) Tour details")).to_be_visible()
        fill(page.get_by_role("textbox", name="Tour name"), name)
        check(page.get_by_role("radio", name="Tour", exact=True))
        fill(page.get_by_label("Number of trucks"), "2")
        click(page.get_by_role("button", name="Next", exact=True))
        page.wait_for_url(lambda url: urlparse(url).path == "/requests/new/stops", timeout=WAIT_MS)
        fill_stops(page, JOURNEY_STOPS)
        click(page.get_by_role("button", name="Next", exact=True))
        page.wait_for_url(lambda url: urlparse(url).path == "/requests/new/review", timeout=WAIT_MS)
        expect(page.get_by_role("main")).to_contain_text(name)
        expect(page.get_by_role("main")).to_contain_text("Chicago")
        page.get_by_role("button", name="Submit request").dblclick()
        rid = submitted_id(page)
        expect(page.get_by_role("heading", name="Request submitted")).to_be_visible()
        expect(page.get_by_role("main")).to_contain_text(rid)
        click(page.get_by_role("link", name="View request"))
        page.wait_for_url(lambda url: urlparse(url).path == f"/requests/{rid}", timeout=WAIT_MS)
        expect(page.get_by_role("main")).to_contain_text("Submitted")
        expect(page.get_by_role("region", name="Activity")).to_contain_text(requested_note(2))
    maya = login(app_url, MANAGER)
    req = get_request(app_url, maya, rid)
    assert (req["tour_name"], req["transport_type"], req["trucks_requested"], req["status"]) == (name, "tour", 2, "submitted")
    assert req["requester"]["name"] == "Maya Manager"
    for stop, kind in zip(req["stops"], STOP_KINDS):
        assert {k: stop[k] for k in JOURNEY_STOPS[kind]} == JOURNEY_STOPS[kind]
    assert [e["kind"] for e in activity(app_url, maya, rid)] == ["submitted"]
    assert db.rows(f"select count(*) as n from logistics_requests where tour_name = {lit(name)}")[0]["n"] == 1
    assert db.rows(f"select count(*) as n from stops where request_id = {lit(rid)}")[0]["n"] == 4
    assert db.rows(f"select count(*) as n from activity where request_id = {lit(rid)}")[0]["n"] == 1


def test_wf_submit_request_step_rules(browser, app_url, db):
    name = f"{fresh_tag('steps')} step tour"
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, MANAGER, "/requests")
        page.goto(f"{app_url}/requests/new/review")
        page.wait_for_url(lambda url: urlparse(url).path == "/requests/new", timeout=WAIT_MS)
        tour_box = page.get_by_role("textbox", name="Tour name")
        fill(tour_box, name)
        check(page.get_by_role("radio", name="Show", exact=True))
        fill(page.get_by_label("Number of trucks"), "2")
        click(page.get_by_role("button", name="Next", exact=True))
        page.wait_for_url(lambda url: urlparse(url).path == "/requests/new/stops", timeout=WAIT_MS)
        page.goto(f"{app_url}/requests/new/review")
        page.wait_for_url(lambda url: urlparse(url).path == "/requests/new/stops", timeout=WAIT_MS)
        early = copy.deepcopy(JOURNEY_STOPS)
        early["delivery"]["date"] = EARLY_DELIVERY
        fill_stops(page, early)
        click(page.get_by_role("button", name="Next", exact=True))
        delivery = page.get_by_role("group", name="Delivery", exact=True)
        expect(delivery).to_contain_text("Delivery cannot be before pickup.")
        assert urlparse(page.url).path == "/requests/new/stops"
        expect(delivery.get_by_label("Date (optional)")).to_have_value(EARLY_DELIVERY)
        expect(delivery.get_by_label("Address", exact=True)).to_have_value("40 Arena Way")
        click(page.get_by_role("button", name="Back", exact=True))
        page.wait_for_url(lambda url: urlparse(url).path == "/requests/new", timeout=WAIT_MS)
        expect(tour_box).to_have_value(name)
        click(page.get_by_role("button", name="Next", exact=True))
        page.wait_for_url(lambda url: urlparse(url).path == "/requests/new/stops", timeout=WAIT_MS)
        expect(page.get_by_role("group", name="Pickup", exact=True).get_by_label("City", exact=True)).to_have_value("Ottawa")
        fill(delivery.get_by_label("Date (optional)"), "2026-04-11")
        click(page.get_by_role("button", name="Next", exact=True))
        page.wait_for_url(lambda url: urlparse(url).path == "/requests/new/review", timeout=WAIT_MS)
        expect(page.get_by_role("main")).to_contain_text(name)
        cancel = page.get_by_role("button", name="Cancel", exact=True)
        click(cancel)
        dialog = page.get_by_role("dialog", name="Discard this request?")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("button", name="Keep editing")).to_be_focused()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(cancel).to_be_focused()
        assert urlparse(page.url).path == "/requests/new/review"
        click(cancel)
        click(page.get_by_role("dialog", name="Discard this request?").get_by_role("button", name="Discard"))
        page.wait_for_url(lambda url: urlparse(url).path == "/requests", timeout=WAIT_MS)
        page.goto(f"{app_url}/requests/new")
        expect(page.get_by_role("textbox", name="Tour name")).to_have_value("")
    assert db.rows(f"select count(*) as n from logistics_requests where tour_name = {lit(name)}")[0]["n"] == 0


def test_request_list_api(app_url):
    maya = login(app_url, MANAGER)
    ada = login(app_url, ADMIN)
    tag = fresh_tag("list")
    ids = [submit(app_url, maya, f"{tag} leg {i}", 1) for i in range(3)]
    assert decide(app_url, ada, ids[0], "decline", "Dates clash.").status_code == 200
    r = call(app_url, "GET", "/api/requests", ada, params={"q": tag.upper()})
    assert r.status_code == 200 and isinstance(r.json(), list)
    assert [x["id"] for x in r.json()] == ids[::-1]
    item = r.json()[0]
    assert item["tour_name"] == f"{tag} leg 2" and item["transport_type"] == "tour"
    assert (item["trucks_requested"], item["trucks_assigned"], item["status"]) == (1, 0, "submitted")
    assert item["requester"]["name"] == "Maya Manager" and item["first_show_date"] == "2026-04-12"
    ts(item["created_at"])
    first = call(app_url, "GET", "/api/requests", ada, params={"q": tag, "limit": 2})
    assert [x["id"] for x in first.json()] == [ids[2], ids[1]]
    cursor = first.headers.get("X-Next-Cursor")
    assert cursor
    second = call(app_url, "GET", "/api/requests", ada, params={"q": tag, "limit": 2, "cursor": cursor})
    assert [x["id"] for x in second.json()] == [ids[0]]
    assert second.headers.get("X-Next-Cursor") is None
    assert list_ids(app_url, ada, q=tag, status="declined") == [ids[0]]
    assert list_ids(app_url, ada, q=tag, status="submitted") == [ids[2], ids[1]]
    for good in (1, LIMIT_MAX):
        assert call(app_url, "GET", "/api/requests", ada, params={"q": tag, "limit": good}).status_code == 200
    for bad in ("0", str(LIMIT_MAX + 1), "ten", "2.5"):
        r = call(app_url, "GET", "/api/requests", ada, params={"limit": bad})
        assert r.status_code == 400
        assert r.json() == {"error": "bad_request", "message": "limit must be a whole number from 1 to 100."}
    r = call(app_url, "GET", "/api/requests", ada, params={"status": "pending"})
    assert r.status_code == 400
    assert r.json() == {"error": "bad_request", "message": "status must be submitted, confirmed or declined."}
    r = call(app_url, "GET", "/api/requests", ada, params={"cursor": "!!not-a-cursor!!"})
    assert r.status_code == 400 and r.json() == {"error": "bad_request", "message": "cursor is not valid."}


def test_stable_paging_while_new_arrive(app_url):
    maya = login(app_url, MANAGER)
    milo = login(app_url, MILO)
    ada = login(app_url, ADMIN)
    tag = fresh_tag("paging")
    first = [submit(app_url, maya, f"{tag} early {i}", 1) for i in range(5)]
    milos = submit(app_url, milo, f"{tag} milo", 1)

    def page_through(token: str, limit: int, arrivals: list[str] | None = None, **params: Any) -> list[str]:
        seen: list[str] = []
        cursor = None
        for _ in range(20):
            query = {"q": tag, "limit": limit, **params, **({"cursor": cursor} if cursor else {})}
            r = call(app_url, "GET", "/api/requests", token, params=query)
            assert r.status_code == 200, r.text
            seen += [x["id"] for x in r.json()]
            if arrivals is not None and not arrivals:
                arrivals += [submit(app_url, maya, f"{tag} late {i}", 1) for i in range(2)]
            cursor = r.headers.get("X-Next-Cursor")
            if not cursor:
                return seen
        pytest.fail("paging never ended")

    added: list[str] = []
    assert page_through(maya, 2, added) == first[::-1]
    assert len(added) == 2
    assert decide(app_url, ada, first[1], "decline", "Not this time.").status_code == 200
    expected = [x for x in (first + added)[::-1] if x != first[1]]
    assert page_through(maya, 1, status="submitted") == expected
    everyone = page_through(ada, 3)
    assert len(everyone) == len(set(everyone)) and set(everyone) == set(first + added + [milos])


def test_request_visibility(app_url):
    maya = login(app_url, MANAGER)
    milo = login(app_url, MILO)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    tag = fresh_tag("visible")
    mine = submit(app_url, maya, f"{tag} maya", 1)
    his = submit(app_url, milo, f"{tag} milo", 1)
    for suffix in ("", "/activity"):
        hidden = call(app_url, "GET", f"/api/requests/{his}{suffix}", maya)
        missing = call(app_url, "GET", f"/api/requests/{MISSING_REQUEST}{suffix}", maya)
        assert hidden.status_code == missing.status_code == 404
        assert hidden.json() == missing.json() and hidden.json()["error"] == "not_found"
    assert list_ids(app_url, maya, q=tag) == [mine]
    assert list_ids(app_url, milo, q=tag) == [his]
    for staff in (dex, ada):
        assert set(list_ids(app_url, staff, q=tag)) == {mine, his}
        assert get_request(app_url, staff, his)["requester"]["name"] == "Milo Manager"
        assert get_request(app_url, staff, mine)["requester"]["name"] == "Maya Manager"


def test_wf_request_list_search_filter_paging(browser, app_url):
    maya = login(app_url, MANAGER)
    ada = login(app_url, ADMIN)
    tag = fresh_tag("search")
    ids = [submit(app_url, maya, f"{tag} leg {i}", 1) for i in range(FIRST_PAGE + 2)]
    assert decide(app_url, ada, ids[0], "decline", "Too late.").status_code == 200
    newest = ids[::-1]
    names = {rid: f"{tag} leg {i}" for i, rid in enumerate(ids)}
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, MANAGER, "/requests")
        box = page.get_by_label("Search requests")
        tours = page.get_by_role("main").get_by_role("link", name=re.compile(re.escape(tag), re.I))

        def shown() -> list[str]:
            return [text.strip().lower() for text in tours.all_inner_texts()]

        fill(box, tag)
        until(page, "(q) => new URLSearchParams(location.search).get('q') === q", tag, WAIT_SECONDS)
        expect(tours).to_have_count(FIRST_PAGE)
        assert shown() == [names[rid].lower() for rid in newest[:FIRST_PAGE]]
        more = page.get_by_role("button", name="Show more requests")
        click(more)
        expect(tours).to_have_count(FIRST_PAGE + 2)
        assert shown() == [names[rid].lower() for rid in newest]
        expect(more).to_have_count(0)
        focused = page.evaluate("() => document.activeElement ? document.activeElement.innerText : ''")
        assert re.search(re.escape(names[newest[FIRST_PAGE]].lower()) + r"(?!\d)", focused.lower()), focused
        select(page.get_by_role("combobox", name="Status"), "Declined")
        until(page, "() => new URLSearchParams(location.search).get('status') !== null", None, WAIT_SECONDS)
        expect(tours).to_have_count(1)
        expect(tours.first).to_have_text(names[ids[0]])
        expect(page.get_by_role("row").filter(has_text=names[ids[0]])).to_contain_text("Declined")
        page.goto(page.url)
        expect(tours).to_have_count(1)
        expect(tours.first).to_have_text(names[ids[0]])
        select(page.get_by_role("combobox", name="Status"), "All statuses")
        nonce = f"{tag}-nothing"
        fill(page.get_by_label("Search requests"), nonce)
        until(page, "(q) => new URLSearchParams(location.search).get('q') === q", nonce, WAIT_SECONDS)
        expect(page.get_by_text(f'No requests match "{nonce}".')).to_be_visible()
        expect(tours).to_have_count(0)
        click(page.get_by_role("button", name="Clear search"))
        expect(page.get_by_label("Search requests")).to_have_value("")
        expect(page.get_by_role("link", name=names[ids[-1]], exact=True)).to_have_count(1)
    assert list_ids(app_url, maya, q=tag, limit=LIMIT_MAX) == newest


NOT_FOUND_IDS = ["unknown-path", "package-json", "run-json", "env-file", "server-source", "missing-request"]
NOT_FOUND_PATHS = {
    "unknown-path": "/no-such-venue",
    "package-json": "/package.json",
    "run-json": "/run.json",
    "env-file": "/.env",
    "server-source": "/server.js",
    "missing-request": f"/requests/{MISSING_REQUEST}",
}


@pytest.mark.parametrize("case", NOT_FOUND_IDS, ids=NOT_FOUND_IDS)
def test_wf_request_list_not_found(page, app_url, case):
    sign_in(page, app_url, ADMIN, "/requests")
    response = page.goto(app_url + NOT_FOUND_PATHS[case])
    assert response.status == 404
    if case == "missing-request":
        expect(page.get_by_text(REQUEST_NOT_FOUND_COPY)).to_be_visible()
        back = page.get_by_role("link", name=re.compile("requests", re.I)).first
    else:
        expect(page.get_by_role("heading", level=1)).to_contain_text(WRONG_VENUE)
        expect(page.get_by_text(WRONG_VENUE_LINE)).to_be_visible()
        back = page.get_by_role("link", name="Back to requests")
        assert PASSWORD not in body_text(page)
    assert urlparse(back.get_attribute("href")).path == "/requests"
    if case == "unknown-path":
        api = call(app_url, "GET", "/api/no-such-thing", login(app_url, ADMIN))
        assert api.status_code == 404 and api.json()["error"] == "not_found"


def test_request_page(browser, app_url):
    maya = login(app_url, MANAGER)
    rid = submit(app_url, maya, f"{fresh_tag('page')} page run", 2)
    seed = SEED_REQUESTS["LR-0003"]
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, ADMIN, "/requests")
        page.goto(f"{app_url}/requests/LR-0003")
        main = page.get_by_role("main")
        expect(page.get_by_role("heading", level=1)).to_contain_text(seed["tour_name"])
        expect(main).to_contain_text("Confirmed")
        cards: list[str] = []
        for title, (city, _, _) in zip(STOP_CARD_TITLES, seed["stops"]):
            cards += [title, city]
        ordered(main, cards)
        trucks_region = page.get_by_role("region", name="Trucks")
        expect(trucks_region).to_contain_text(count_line(2, 2))
        expect(trucks_region).to_contain_text("TR-106")
        expect(trucks_region).to_contain_text("TR-107")
        timeline = page.get_by_role("region", name="Activity")
        expect(timeline).to_contain_text(seed["decision_note"])
        confirmed = decision_line("Confirmed", DEX_NAME)
        ordered(timeline, [requested_note(2), "TR-106 assigned", confirmed, seed["decision_note"]])
        ordered(timeline, [requested_note(2), "TR-107 assigned", confirmed])
        expect(page.get_by_role("combobox", name="Assign truck")).to_have_count(0)
        page.goto(f"{app_url}/requests/LR-0004")
        undated: list[str] = []
        for title in STOP_CARD_TITLES:
            undated += [title, "No date"]
        ordered(page.get_by_role("main"), undated)
        expect(page.get_by_role("region", name="Trucks")).to_contain_text(count_line(0, 1))
        expect(page.get_by_role("region", name="Activity")).to_contain_text(decision_line("Declined", DEX_NAME))
        page.route("**/activity*", lambda route: route.abort())
        page.goto(f"{app_url}/requests/{rid}")
        retry = page.get_by_role("button", name="Try again")
        expect(retry).to_be_visible()
        expect(page.get_by_text("Could not load activity. Try again.")).to_be_visible()
        page.unroute("**/activity*")
        click(retry)
        expect(page.get_by_role("region", name="Activity")).to_contain_text(requested_note(2))


def test_truck_assignment(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    rid = submit(app_url, maya, f"{fresh_tag('assign')} assign run", 2)
    try:
        x, y = free_trucks(app_url, dex, 2)
        r = assign(app_url, dex, rid, x)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["id"] == rid and body["status"] == "submitted"
        assert [t["id"] for t in body["trucks"]] == [x] and body["trucks_assigned"] == 1
        t = truck(app_url, dex, x)
        assert (t["status"], t["request_id"]) == ("assigned", rid)
        assert [(row["truck_id"], str(row["assigned_by"])) for row in assignment_rows(db, rid)] == [(x, "2")]
        assert db.rows(f"select status from trucks where id = {lit(x)}")[0]["status"] == "assigned"
        last = activity(app_url, dex, rid)[-1]
        assert (last["kind"], last["note"], last["actor"]["name"]) == ("truck_assigned", f"{x} assigned", "Dex Dispatcher")
        r = assign(app_url, ada, rid, y)
        assert r.status_code == 201
        assert [t["id"] for t in r.json()["trucks"]] == sorted([x, y])
        last = activity(app_url, ada, rid)[-1]
        assert (last["note"], last["actor"]["name"]) == (f"{y} assigned", "Ada Admin")
        race = submit(app_url, maya, f"{fresh_tag('slot')} slot run", 1)
        try:
            p, q = free_trucks(app_url, dex, 2)
            a, b = together(lambda: assign(app_url, dex, race, p), lambda: assign(app_url, ada, race, q))
            assert sorted([a.status_code, b.status_code]) == [201, 409]
            loser = a if a.status_code == 409 else b
            assert loser.json() == {"error": "conflict", "message": FULL}
            assert len(assignment_rows(db, race)) == 1
            assert activity_count(db, race, "truck_assigned") == 1
            assert get_request(app_url, dex, race)["trucks_assigned"] == 1
        finally:
            decline_quietly(app_url, dex, race)
    finally:
        decline_quietly(app_url, dex, rid)


CONFLICT_IDS = ["busy", "maintenance", "full", "unknown"]


@pytest.mark.parametrize("case", CONFLICT_IDS, ids=CONFLICT_IDS)
def test_assignment_conflicts(app_url, db, case):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    rid = submit(app_url, maya, f"{fresh_tag('conflict')} conflict run", 1)
    try:
        target = {"busy": "TR-103", "maintenance": "TR-104", "unknown": MISSING_TRUCK}.get(case)
        if case == "full":
            x, target = free_trucks(app_url, dex, 2)
            assert assign(app_url, dex, rid, x).status_code == 201
        before = get_request(app_url, dex, rid)
        before_rows = assignment_rows(db, rid)
        before_activity = activity(app_url, dex, rid)
        before_truck = None if case == "unknown" else truck(app_url, dex, target)
        r = assign(app_url, dex, rid, target)
        if case == "unknown":
            assert r.status_code == 422
            assert r.json()["error"] == "validation"
            assert r.json()["fields"]["truck_id"] == "Choose a truck from the fleet."
        else:
            assert r.status_code == 409
            assert r.json() == {"error": "conflict", "message": FULL if case == "full" else NOT_AVAILABLE}
            assert truck(app_url, dex, target) == before_truck
        after = get_request(app_url, dex, rid)
        assert (after["trucks"], after["trucks_assigned"]) == (before["trucks"], before["trucks_assigned"])
        assert assignment_rows(db, rid) == before_rows
        assert activity(app_url, dex, rid) == before_activity
    finally:
        decline_quietly(app_url, dex, rid)


def test_truck_release(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    rid = submit(app_url, maya, f"{fresh_tag('release')} release run", 2)
    try:
        x, y = free_trucks(app_url, dex, 2)
        assert assign(app_url, dex, rid, x).status_code == 201
        r = release(app_url, dex, rid, x)
        assert r.status_code == 204
        t = truck(app_url, dex, x)
        assert (t["status"], t["request_id"]) == ("available", None)
        req = get_request(app_url, dex, rid)
        assert req["trucks"] == [] and req["trucks_assigned"] == 0
        last = activity(app_url, dex, rid)[-1]
        assert (last["kind"], last["note"], last["actor"]["name"]) == ("truck_released", f"{x} released", "Dex Dispatcher")
        assert assignment_rows(db, rid) == []
        for tid in (y, x, MISSING_TRUCK):
            r = release(app_url, dex, rid, tid)
            assert r.status_code == 404 and r.json()["error"] == "not_found"
        assert activity_count(db, rid, "truck_released") == 1
        assert assign(app_url, dex, rid, x).status_code == 201
    finally:
        decline_quietly(app_url, dex, rid)


def test_confirmation(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    rid = submit(app_url, maya, f"{fresh_tag('confirm')} confirm run", 1)
    try:
        early = decide(app_url, dex, rid, "confirm", "Ready.")
        assert early.status_code == 409 and early.json() == {"error": "conflict", "message": EARLY_CONFIRM}
        assert get_request(app_url, dex, rid)["status"] == "submitted"
        [x] = free_trucks(app_url, dex, 1)
        assert assign(app_url, dex, rid, x).status_code == 201
        r = decide(app_url, dex, rid, "confirm", f"  {CONFIRM_NOTE}  ")
        assert r.status_code == 200, r.text
        req = r.json()
        assert req["status"] == "confirmed"
        assert str(req["decided_by"]["id"]) == "2" and req["decided_by"]["name"] == DEX_NAME
        assert req["decision_note"] == CONFIRM_NOTE
        assert ts(req["decided_at"]) >= ts(req["created_at"])
        assert [t["id"] for t in req["trucks"]] == [x]
        last = activity(app_url, dex, rid)[-1]
        assert (last["kind"], last["note"], last["actor"]["name"]) == ("confirmed", CONFIRM_NOTE, DEX_NAME)
        t = truck(app_url, dex, x)
        assert (t["status"], t["request_id"]) == ("assigned", rid)
        row = db.rows(f"select status, decided_by, decision_note, decided_at from logistics_requests where id = {lit(rid)}")[0]
        assert (row["status"], str(row["decided_by"]), row["decision_note"]) == ("confirmed", "2", CONFIRM_NOTE)
        assert row["decided_at"] is not None
    finally:
        decline_quietly(app_url, dex, rid)


def test_decline_and_decided_once(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    rid = submit(app_url, maya, f"{fresh_tag('decline')} decline run", 2)
    try:
        x, y = free_trucks(app_url, dex, 2)
        assert assign(app_url, dex, rid, x).status_code == 201
        assert assign(app_url, dex, rid, y).status_code == 201
        refusals = [
            ({"decision": "approve", "note": "Fine."}, "decision", None),
            ({"decision": "decline"}, "note", NOTE_REQUIRED),
            ({"decision": "decline", "note": "   "}, "note", NOTE_REQUIRED),
            ({"decision": "decline", "note": "n" * (NOTE_MAX + 1)}, "note", "Note must be 500 characters or fewer."),
        ]
        for body, field, reason in refusals:
            r = call(app_url, "POST", f"/api/requests/{rid}/decision", dex, body)
            assert r.status_code == 422 and field in r.json()["fields"], r.text
            if reason:
                assert r.json()["fields"][field] == reason
        still = get_request(app_url, dex, rid)
        assert still["status"] == "submitted" and still["trucks_assigned"] == 2
        r = decide(app_url, dex, rid, "decline", f"  {DECLINE_NOTE}  ")
        assert r.status_code == 200, r.text
        req = r.json()
        assert (req["status"], req["trucks"], req["trucks_assigned"]) == ("declined", [], 0)
        assert req["decision_note"] == DECLINE_NOTE and req["decided_by"]["name"] == DEX_NAME
        tail_entries = activity(app_url, dex, rid)[-3:]
        assert [e["kind"] for e in tail_entries] == ["truck_released", "truck_released", "declined"]
        assert {e["note"] for e in tail_entries[:2]} == {f"{x} released", f"{y} released"}
        assert (tail_entries[2]["note"], tail_entries[2]["actor"]["name"]) == (DECLINE_NOTE, DEX_NAME)
        for tid in (x, y):
            t = truck(app_url, dex, tid)
            assert (t["status"], t["request_id"]) == ("available", None)
        assert assignment_rows(db, rid) == []
        count_before = len(activity(app_url, dex, rid))
        for r in [assign(app_url, dex, rid, x), release(app_url, dex, rid, x),
                  decide(app_url, dex, rid, "confirm", "Again."), decide(app_url, dex, rid, "decline", "Again."),
                  release(app_url, dex, "LR-0003", "TR-106"), assign(app_url, dex, "LR-0003", x),
                  decide(app_url, dex, "LR-0004", "confirm", "Again.")]:
            assert r.status_code == 409 and r.json() == {"error": "conflict", "message": DECIDED}
        assert len(activity(app_url, dex, rid)) == count_before
        assert truck(app_url, dex, "TR-106")["request_id"] == "LR-0003"
        assert truck(app_url, dex, x)["status"] == "available"
    finally:
        decline_quietly(app_url, dex, rid)


def test_one_winner_assignment(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    for _ in range(ROUNDS):
        tag = fresh_tag("race")
        first = submit(app_url, maya, f"{tag} a", 2)
        second = submit(app_url, maya, f"{tag} b", 2)
        try:
            [x] = free_trucks(app_url, dex, 1)
            a, b = together(lambda: assign(app_url, dex, first, x), lambda: assign(app_url, ada, second, x))
            assert sorted([a.status_code, b.status_code]) == [201, 409]
            loser = a if a.status_code == 409 else b
            winner = first if a.status_code == 201 else second
            assert loser.json() == {"error": "conflict", "message": NOT_AVAILABLE}
            rows = db.rows(f"select request_id from assignments where truck_id = {lit(x)}")
            assert [row["request_id"] for row in rows] == [winner]
            note = f"{x} assigned"
            assert activity_count(db, first, "truck_assigned", note) + activity_count(db, second, "truck_assigned", note) == 1
            assert truck(app_url, dex, x)["request_id"] == winner
        finally:
            decline_quietly(app_url, dex, first)
            decline_quietly(app_url, dex, second)


def test_one_winner_decision(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    for _ in range(ROUNDS):
        rid = submit(app_url, maya, f"{fresh_tag('decide')} decide", 1)
        a, b = together(lambda: decide(app_url, dex, rid, "decline", "First call."),
                        lambda: decide(app_url, ada, rid, "decline", "Second call."))
        assert sorted([a.status_code, b.status_code]) == [200, 409]
        loser = a if a.status_code == 409 else b
        assert loser.json() == {"error": "conflict", "message": DECIDED}
        won = "First call." if a.status_code == 200 else "Second call."
        assert activity_count(db, rid, "declined") == 1
        assert db.rows(f"select decision_note from logistics_requests where id = {lit(rid)}")[0]["decision_note"] == won


def test_wf_assign_and_confirm_happy(browser, app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    name = f"{fresh_tag('happy')} spring run"
    rid = submit(app_url, maya, name, 2)
    note = "Two trucks confirmed for the spring run."
    try:
        x, y = free_trucks(app_url, dex, 2)
        with open_app(browser, f"{app_url}/login") as page:
            sign_in(page, app_url, DISPATCHER, "/dispatch")
            summary = board_consistent(app_url, dex)["summary"]
            line = board_line(summary["waiting"], summary["trucks_needed"], summary["trucks_available"])
            expect(page.get_by_text(line).first).to_be_visible()
            click(page.get_by_role("link", name=name))
            page.wait_for_url(lambda url: urlparse(url).path == f"/requests/{rid}", timeout=WAIT_MS)
            trucks_region = page.get_by_role("region", name="Trucks")
            for done, tid in enumerate((x, y), start=1):
                select(page.get_by_role("combobox", name="Assign truck"), option_label(app_url, dex, tid))
                click(page.get_by_role("button", name="Assign", exact=True))
                expect(notices(page)).to_contain_text("Truck assigned")
                expect(trucks_region).to_contain_text(count_line(done, 2))
                expect(trucks_region).to_contain_text(tid)
            fill(page.get_by_role("textbox", name="Note", exact=True), note)
            click(page.get_by_role("button", name="Confirm", exact=True))
            page.wait_for_url(lambda url: urlparse(url).path == f"/requests/{rid}/decided", timeout=WAIT_MS)
            expect(page.get_by_role("heading", name="Decision recorded")).to_be_visible()
            expect(page.get_by_role("main")).to_contain_text("Confirmed")
            expect(page.get_by_role("link", name="View request")).to_be_visible()
        req = get_request(app_url, dex, rid)
        assert req["status"] == "confirmed" and req["decision_note"] == note
        assert [t["id"] for t in req["trucks"]] == sorted([x, y]) and req["decided_by"]["name"] == "Dex Dispatcher"
        assert activity(app_url, dex, rid)[-1]["kind"] == "confirmed"
        for tid in (x, y):
            t = truck(app_url, dex, tid)
            assert (t["status"], t["request_id"]) == ("assigned", rid)
        assert {row["truck_id"] for row in assignment_rows(db, rid)} == {x, y}
        board_consistent(app_url, dex)
    finally:
        decline_quietly(app_url, dex, rid)


def test_wf_assign_and_confirm_panel_feedback(browser, app_url):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    rid = submit(app_url, maya, f"{fresh_tag('panel')} panel run", 2)
    try:
        [x] = free_trucks(app_url, dex, 1)
        label = option_label(app_url, dex, x)
        with open_app(browser, f"{app_url}/login") as page:
            sign_in(page, app_url, DISPATCHER, f"/requests/{rid}")
            timeline = page.get_by_role("region", name="Activity")
            expect(timeline).to_contain_text(requested_note(2))
            combo = page.get_by_role("combobox", name="Assign truck")
            trucks_region = page.get_by_role("region", name="Trucks")
            releases = trucks_region.get_by_role("button", name=re.compile("^Release"))
            expect(trucks_region).to_contain_text(count_line(0, 2))
            expect(releases).to_have_count(0)
            select(combo, label)
            click(page.get_by_role("button", name="Assign", exact=True))
            expect(notices(page)).to_contain_text("Truck assigned")
            expect(trucks_region).to_contain_text(count_line(1, 2))
            expect(releases).to_have_count(1)
            expect(trucks_region).to_contain_text(x)
            expect(timeline).to_contain_text(f"{x} assigned")
            expect(combo.get_by_role("option", name=label)).to_have_count(0)
            fill(page.get_by_role("textbox", name="Note", exact=True), "Ready.")
            click(page.get_by_role("button", name="Confirm", exact=True))
            expect(notices(page)).to_contain_text(EARLY_CONFIRM)
            expect(page.get_by_role("main")).to_contain_text("Submitted")
            assert urlparse(page.url).path == f"/requests/{rid}"
            click(releases.first)
            expect(notices(page)).to_contain_text("Truck released")
            expect(trucks_region).to_contain_text(count_line(0, 2))
            expect(releases).to_have_count(0)
            expect(timeline).to_contain_text(f"{x} released")
            expect(combo.get_by_role("option", name=label)).to_have_count(1)
        req = get_request(app_url, dex, rid)
        assert req["status"] == "submitted" and req["trucks"] == []
        assert [e["kind"] for e in activity(app_url, dex, rid)] == ["submitted", "truck_assigned", "truck_released"]
    finally:
        decline_quietly(app_url, dex, rid)


def test_wf_assign_and_confirm_stale_panel(browser, app_url):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    tag = fresh_tag("stale")
    rid = submit(app_url, maya, f"{tag} stale", 2)
    other = submit(app_url, maya, f"{tag} other", 2)
    try:
        x, y = free_trucks(app_url, dex, 2)
        label_x = option_label(app_url, dex, x)
        with open_app(browser, f"{app_url}/login") as page:
            sign_in(page, app_url, DISPATCHER, f"/requests/{rid}")
            combo = page.get_by_role("combobox", name="Assign truck")
            trucks_region = page.get_by_role("region", name="Trucks")
            releases = trucks_region.get_by_role("button", name=re.compile("^Release"))
            main = page.get_by_role("main")
            expect(combo.get_by_role("option", name=label_x)).to_have_count(1)
            assert assign(app_url, ada, other, x).status_code == 201
            select(combo, label_x)
            click(page.get_by_role("button", name="Assign", exact=True))
            expect(notices(page)).to_contain_text(NOT_AVAILABLE)
            expect(combo.get_by_role("option", name=label_x)).to_have_count(0)
            expect(trucks_region).to_contain_text(count_line(0, 2))
            expect(releases).to_have_count(0)
            assert assign(app_url, ada, rid, y).status_code == 201
            expect(trucks_region).to_contain_text(count_line(0, 2))
            fill(page.get_by_role("textbox", name="Note", exact=True), "Ready.")
            click(page.get_by_role("button", name="Confirm", exact=True))
            expect(notices(page)).to_contain_text(EARLY_CONFIRM)
            expect(trucks_region).to_contain_text(count_line(1, 2))
            expect(trucks_region).to_contain_text(y)
            expect(releases).to_have_count(1)
            expect(main).to_contain_text("Submitted")
            assert decide(app_url, ada, rid, "decline", DECLINE_NOTE).status_code == 200
            click(releases.first)
            expect(notices(page)).to_contain_text(DECIDED)
            expect(main).to_contain_text("Declined")
            expect(trucks_region).to_contain_text(count_line(0, 2))
            expect(releases).to_have_count(0)
            expect(trucks_region).not_to_contain_text(y)
            expect(page.get_by_role("combobox", name="Assign truck")).to_have_count(0)
            expect(page.get_by_role("button", name="Confirm", exact=True)).to_have_count(0)
            expect(main).to_contain_text(DECLINE_NOTE)
            expect(main).to_contain_text(decision_line("Declined", ADA_NAME))
        assert get_request(app_url, dex, rid)["trucks"] == []
    finally:
        decline_quietly(app_url, dex, rid)
        decline_quietly(app_url, dex, other)


def test_wf_decline_note_required(browser, app_url):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    rid = submit(app_url, maya, f"{fresh_tag('nonote')} no note", 1)
    try:
        with open_app(browser, f"{app_url}/login") as page:
            sign_in(page, app_url, DISPATCHER, f"/requests/{rid}")
            note = page.get_by_role("textbox", name="Note", exact=True)
            fill(note, "")
            click(page.get_by_role("button", name="Decline", exact=True))
            expect(notices(page)).to_contain_text(NOTE_REQUIRED)
            expect(note).to_have_accessible_description(re.compile(re.escape(NOTE_REQUIRED)))
            expect(page.get_by_role("main")).to_contain_text("Submitted")
            expect(page.get_by_role("button", name="Decline", exact=True)).to_be_visible()
            assert urlparse(page.url).path == f"/requests/{rid}"
        req = get_request(app_url, dex, rid)
        assert req["status"] == "submitted" and req["decided_by"] is None
    finally:
        decline_quietly(app_url, dex, rid)


def test_wf_decline_from_panel(browser, app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    tag = fresh_tag("gone")
    rid = submit(app_url, maya, f"{tag} declined", 2)
    other = submit(app_url, maya, f"{tag} next", 1)
    try:
        x, y = free_trucks(app_url, dex, 2)
        assert assign(app_url, dex, rid, x).status_code == 201
        assert assign(app_url, dex, rid, y).status_code == 201
        with open_app(browser, f"{app_url}/login") as page:
            sign_in(page, app_url, DISPATCHER, f"/requests/{rid}")
            fill(page.get_by_role("textbox", name="Note", exact=True), DECLINE_NOTE)
            click(page.get_by_role("button", name="Decline", exact=True))
            page.wait_for_url(lambda url: urlparse(url).path == f"/requests/{rid}/decided", timeout=WAIT_MS)
            expect(page.get_by_role("heading", name="Decision recorded")).to_be_visible()
            expect(page.get_by_role("main")).to_contain_text("Declined")
            click(page.get_by_role("link", name="View request"))
            page.wait_for_url(lambda url: urlparse(url).path == f"/requests/{rid}", timeout=WAIT_MS)
            expect(page.get_by_role("main")).to_contain_text("Declined")
            trucks_region = page.get_by_role("region", name="Trucks")
            expect(trucks_region).to_contain_text(count_line(0, 2))
            for tid in (x, y):
                expect(trucks_region).not_to_contain_text(tid)
            page.goto(f"{app_url}/fleet")
            for tid in (x, y):
                row = truck_row(page, tid)
                expect(row).to_contain_text(STATUS_LABELS["available"])
                expect(row.get_by_role("link", name=rid)).to_have_count(0)
            page.goto(f"{app_url}/dispatch")
            expect(page.get_by_role("link", name=f"{tag} next", exact=True)).to_have_count(1)
            expect(page.get_by_role("link", name=f"{tag} declined", exact=True)).to_have_count(0)
        req = get_request(app_url, dex, rid)
        assert (req["status"], req["trucks"], req["trucks_assigned"]) == ("declined", [], 0)
        item = next(i for i in call(app_url, "GET", "/api/requests", dex, params={"q": tag}).json() if i["id"] == rid)
        assert item["trucks_assigned"] == 0
        assert rid not in [r["id"] for r in board_consistent(app_url, dex)["requests"]]
        for tid in (x, y):
            t = truck(app_url, dex, tid)
            assert (t["status"], t["request_id"]) == ("available", None)
        assert assignment_rows(db, rid) == []
        assert assign(app_url, dex, other, x).status_code == 201
    finally:
        decline_quietly(app_url, dex, rid)
        decline_quietly(app_url, dex, other)


def test_decline_against_assignment_race(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    for _ in range(ROUNDS):
        rid = submit(app_url, maya, f"{fresh_tag('dvsa')} race", 2)
        try:
            x, y = free_trucks(app_url, dex, 2)
            assert assign(app_url, dex, rid, x).status_code == 201
            declined, assigned = together(lambda: decide(app_url, dex, rid, "decline", "Race decline."),
                                          lambda: assign(app_url, ada, rid, y))
            assert declined.status_code == 200
            assert assigned.status_code in (201, 409)
            if assigned.status_code == 409:
                assert assigned.json() == {"error": "conflict", "message": DECIDED}
            else:
                assert activity_count(db, rid, "truck_released", f"{y} released") == 1
            req = get_request(app_url, dex, rid)
            assert (req["status"], req["trucks"]) == ("declined", [])
            for tid in (x, y):
                t = truck(app_url, dex, tid)
                assert (t["status"], t["request_id"]) == ("available", None)
            assert assignment_rows(db, rid) == []
        finally:
            decline_quietly(app_url, dex, rid)


def test_decline_against_release_race(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    for _ in range(ROUNDS):
        rid = submit(app_url, maya, f"{fresh_tag('dvsr')} race", 2)
        try:
            x, y = free_trucks(app_url, dex, 2)
            assert assign(app_url, dex, rid, x).status_code == 201
            assert assign(app_url, dex, rid, y).status_code == 201
            declined, released = together(lambda: decide(app_url, dex, rid, "decline", "Race decline."),
                                          lambda: release(app_url, ada, rid, x))
            assert declined.status_code == 200
            assert released.status_code in (204, 409)
            if released.status_code == 409:
                assert released.json() == {"error": "conflict", "message": DECIDED}
            t = truck(app_url, dex, x)
            assert (t["status"], t["request_id"]) == ("available", None)
            assert activity_count(db, rid, "truck_released", f"{x} released") == 1
            assert get_request(app_url, dex, rid)["trucks"] == []
            assert assignment_rows(db, rid) == []
        finally:
            decline_quietly(app_url, dex, rid)


def test_one_request_per_draft(app_url, db):
    maya = login(app_url, MANAGER)
    milo = login(app_url, MILO)
    tag = fresh_tag("draft")
    draft = str(uuid.uuid4())
    first = call(app_url, "POST", "/api/requests", maya, request_body(f"{tag} one", 2, draft_id=draft))
    assert first.status_code == 201
    rid = first.json()["id"]
    replay = call(app_url, "POST", "/api/requests", maya, request_body(f"{tag} changed", 5, draft_id=draft))
    assert replay.status_code == 200
    assert (replay.json()["id"], replay.json()["tour_name"], replay.json()["trucks_requested"]) == (rid, f"{tag} one", 2)
    stored = db.rows(f"select id from logistics_requests where draft_id::text = {lit(draft)} and requester_id = 3")
    assert [row["id"] for row in stored] == [rid]
    assert db.rows(f"select count(*) as n from stops where request_id = {lit(rid)}")[0]["n"] == 4
    assert db.rows(f"select count(*) as n from activity where request_id = {lit(rid)}")[0]["n"] == 1
    his = call(app_url, "POST", "/api/requests", milo, request_body(f"{tag} milo", 1, draft_id=draft))
    assert his.status_code == 201 and his.json()["id"] != rid and his.json()["requester"]["name"] == "Milo Manager"
    twin = str(uuid.uuid4())
    a, b = together(lambda: call(app_url, "POST", "/api/requests", maya, request_body(f"{tag} twin", 2, draft_id=twin)),
                    lambda: call(app_url, "POST", "/api/requests", maya, request_body(f"{tag} twin", 2, draft_id=twin)))
    assert sorted([a.status_code, b.status_code]) == [200, 201]
    assert a.json()["id"] == b.json()["id"]
    twin_rows = db.rows(f"select id from logistics_requests where draft_id::text = {lit(twin)}")
    assert len(twin_rows) == 1
    assert db.rows(f"select count(*) as n from stops where request_id = {lit(twin_rows[0]['id'])}")[0]["n"] == 4
    assert db.rows(f"select count(*) as n from activity where request_id = {lit(twin_rows[0]['id'])}")[0]["n"] == 1
    many = together(*[(lambda i=i: call(app_url, "POST", "/api/requests", maya, request_body(f"{tag} crowd {i}", 1)))
                      for i in range(5)])
    assert [r.status_code for r in many] == [201] * 5
    numbers = sorted(int(r.json()["id"][3:]) for r in many)
    assert numbers == list(range(numbers[0], numbers[0] + 5))
    plain = [call(app_url, "POST", "/api/requests", maya, request_body(f"{tag} plain", 1)) for _ in range(2)]
    assert [r.status_code for r in plain] == [201, 201] and plain[0].json()["id"] != plain[1].json()["id"]


def test_wf_concurrency_second_tab(browser, app_url, db):
    name = f"{fresh_tag('tabs')} second tab"
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, MANAGER, "/requests")
        walk_to_review(page, app_url, name)
        second = page.context.new_page()
        second.goto(f"{app_url}/requests/new/review")
        expect(second.get_by_role("main")).to_contain_text(name)
        click(page.get_by_role("button", name="Submit request"))
        rid = submitted_id(page)
        click(second.get_by_role("button", name="Submit request"))
        assert submitted_id(second) == rid
        expect(second.get_by_role("heading", name="Request submitted")).to_be_visible()
    rows = db.rows(f"select id from logistics_requests where tour_name = {lit(name)}")
    assert [row["id"] for row in rows] == [rid]
    assert db.rows(f"select count(*) as n from stops where request_id = {lit(rid)}")[0]["n"] == 4


def test_wf_dispatch_access_manager_refused(browser, app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    rid = submit(app_url, maya, f"{fresh_tag('kept')} kept out", 1, role="admin", requester_id=1)
    [x] = free_trucks(app_url, dex, 1)
    attempts = [
        ("GET", "/api/dispatch", None),
        ("GET", "/api/trucks", None),
        ("POST", f"/api/requests/{rid}/assignments", {"truck_id": x, "role": "admin"}),
        ("DELETE", f"/api/requests/{rid}/assignments/{x}", None),
        ("POST", f"/api/requests/{rid}/decision", {"decision": "confirm", "note": "Mine.", "role": "dispatcher"}),
        ("PATCH", f"/api/trucks/{x}", {"status": "maintenance", "role": "admin"}),
        ("GET", "/api/users", None),
        ("PATCH", "/api/users/3", {"role": "admin"}),
    ]
    for method, path, body in attempts:
        for headers in ({}, {"X-Role": "admin"}):
            r = call(app_url, method, path, maya, body, headers=headers)
            assert r.status_code == 403, (method, path, r.status_code)
            assert r.json() == {"error": "forbidden", "message": ACCESS_COPY}
    assert call(app_url, "GET", "/api/auth/me", maya).json()["user"]["role"] == "tour_manager"
    assert db.rows("select role from members where id = 3")[0]["role"] == "tour_manager"
    row = db.rows(f"select status, requester_id from logistics_requests where id = {lit(rid)}")[0]
    assert (row["status"], str(row["requester_id"])) == ("submitted", "3")
    assert assignment_rows(db, rid) == []
    assert truck(app_url, dex, x)["status"] == "available"
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, MANAGER, "/requests")
        for name in ("Dispatch", "Fleet", "Members"):
            expect(nav_link(page, name)).to_have_count(0)
        for path in ("/dispatch", "/fleet", "/admin/users", f"/requests/{rid}/decided"):
            response = page.goto(app_url + path)
            assert response.status == 403, path
            expect(page.get_by_text(ACCESS_COPY)).to_be_visible()
        page.goto(f"{app_url}/requests/{rid}")
        expect(page.get_by_role("main")).to_contain_text(rid)
        expect(page.get_by_role("combobox", name="Assign truck")).to_have_count(0)
        expect(page.get_by_role("button", name="Confirm", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="Decline", exact=True)).to_have_count(0)


def test_wf_dispatch_access_ownership(browser, app_url):
    maya = login(app_url, MANAGER)
    milo = login(app_url, MILO)
    tag = fresh_tag("owned")
    his_name = f"{tag} milo secret"
    his = submit(app_url, milo, his_name, 1)
    mine = submit(app_url, maya, f"{tag} maya", 1)
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, MANAGER, "/requests")

        def timeline_fetch(req: Any) -> bool:
            path = urlparse(req.url).path
            return path.endswith("/activity") and not path.startswith("/api/")

        with page.expect_request(timeline_fetch, timeout=WAIT_MS) as fetched:
            page.goto(f"{app_url}/requests/{mine}")
        parsed = urlparse(fetched.value.url)
        fragment = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        assert mine in fragment, fragment
        templates = ["/requests/{id}", "/requests/{id}/submitted", fragment.replace(mine, "{id}")]
        for template in templates:
            hidden = page.goto(app_url + template.replace("{id}", his))
            hidden_text = body_text(page)
            missing = page.goto(app_url + template.replace("{id}", MISSING_REQUEST))
            missing_text = body_text(page)
            assert hidden.status == missing.status == 404, template
            assert REQUEST_NOT_FOUND_COPY in hidden_text and his_name not in hidden_text
            assert hidden_text.replace(his, MISSING_REQUEST) == missing_text
        for rid in (his, MISSING_REQUEST):
            response = page.goto(f"{app_url}/requests/{rid}/decided")
            assert response.status == 403
            expect(page.get_by_text(ACCESS_COPY)).to_be_visible()
        assert page.goto(f"{app_url}/requests/{mine}/submitted").status == 200
        expect(page.get_by_role("heading", name="Request submitted")).to_be_visible()
        page.goto(f"{app_url}/requests?q={quote(tag)}")
        expect(page.get_by_role("link", name=f"{tag} maya", exact=True)).to_have_count(1)
        expect(page.get_by_role("link", name=his_name, exact=True)).to_have_count(0)
        assert his_name not in body_text(page)
    assert list_ids(app_url, maya, q=his_name) == []
    assert call(app_url, "GET", f"/api/requests/{his}/activity", maya).json() == \
        call(app_url, "GET", f"/api/requests/{MISSING_REQUEST}/activity", maya).json()


def test_fleet_maintenance(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    rid = submit(app_url, maya, f"{fresh_tag('maint')} maint run", 1)
    [x] = free_trucks(app_url, dex, 1)
    try:
        for token in (dex, maya):
            r = set_truck(app_url, token, x, "maintenance")
            assert r.status_code == 403 and r.json()["message"] == ACCESS_COPY
        assert truck(app_url, dex, x)["status"] == "available"
        r = set_truck(app_url, ada, x, "maintenance")
        assert r.status_code == 200
        assert (r.json()["id"], r.json()["status"], r.json()["request_id"]) == (x, "maintenance", None)
        assert db.rows(f"select status from trucks where id = {lit(x)}")[0]["status"] == "maintenance"
        again = set_truck(app_url, ada, x, "maintenance")
        assert again.status_code == 200 and again.json()["status"] == "maintenance"
        blocked = assign(app_url, dex, rid, x)
        assert blocked.status_code == 409 and blocked.json()["message"] == NOT_AVAILABLE
        bad = set_truck(app_url, ada, x, "retired")
        assert bad.status_code == 422 and "status" in bad.json()["fields"]
        back = set_truck(app_url, ada, x, "available")
        assert back.status_code == 200 and back.json()["status"] == "available"
        assert db.rows(f"select status from trucks where id = {lit(x)}")[0]["status"] == "available"
        assert assign(app_url, dex, rid, x).status_code == 201
        for status in ("maintenance", "available"):
            r = set_truck(app_url, ada, x, status)
            assert r.status_code == 409 and r.json() == {"error": "conflict", "message": ON_REQUEST}
        t = truck(app_url, dex, x)
        assert (t["status"], t["request_id"]) == ("assigned", rid)
        missing = set_truck(app_url, ada, MISSING_TRUCK, "maintenance")
        assert missing.status_code == 404
    finally:
        decline_quietly(app_url, dex, rid)
        set_truck(app_url, ada, x, "available")


def test_maintenance_against_assignment(app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    for _ in range(ROUNDS):
        rid = submit(app_url, maya, f"{fresh_tag('mvsa')} race", 1)
        [x] = free_trucks(app_url, dex, 1)
        try:
            parked, assigned = together(lambda: set_truck(app_url, ada, x, "maintenance"),
                                        lambda: assign(app_url, dex, rid, x))
            t = truck(app_url, dex, x)
            if parked.status_code == 200:
                assert assigned.status_code == 409 and assigned.json()["message"] == NOT_AVAILABLE
                assert (t["status"], t["request_id"]) == ("maintenance", None)
                assert assignment_rows(db, rid) == []
                assert activity_count(db, rid, "truck_assigned") == 0
            else:
                assert parked.status_code == 409 and parked.json()["message"] == ON_REQUEST
                assert assigned.status_code == 201
                assert (t["status"], t["request_id"]) == ("assigned", rid)
                assert [row["truck_id"] for row in assignment_rows(db, rid)] == [x]
                assert activity_count(db, rid, "truck_assigned") == 1
            fleet_matches_rows(db, fleet(app_url, dex))
        finally:
            decline_quietly(app_url, dex, rid)
            set_truck(app_url, ada, x, "available")
    rid = submit(app_url, maya, f"{fresh_tag('evsa')} race", 1)
    [x] = free_trucks(app_url, dex, 1)
    try:
        assert set_truck(app_url, ada, x, "maintenance").status_code == 200
        ended, assigned = together(lambda: set_truck(app_url, ada, x, "available"),
                                   lambda: assign(app_url, dex, rid, x))
        assert ended.status_code == 200
        t = truck(app_url, dex, x)
        if assigned.status_code == 201:
            assert (t["status"], t["request_id"]) == ("assigned", rid)
        else:
            assert assigned.status_code == 409 and assigned.json()["message"] == NOT_AVAILABLE
            assert (t["status"], t["request_id"]) == ("available", None)
            assert assignment_rows(db, rid) == []
        fleet_matches_rows(db, fleet(app_url, dex))
    finally:
        decline_quietly(app_url, dex, rid)
        set_truck(app_url, ada, x, "available")


def test_wf_maintenance_start_and_end(browser, app_url, db):
    ada = login(app_url, ADMIN)
    assert truck(app_url, ada, PROTECTED_TRUCK)["status"] == "available"
    try:
        with open_app(browser, f"{app_url}/login") as page:
            sign_in(page, app_url, ADMIN, "/fleet")
            counts = Counter(t["status"] for t in fleet(app_url, ada))
            available, assigned, parked = counts["available"], counts["assigned"], counts["maintenance"]
            expect(page.get_by_text(fleet_line(available, assigned, parked)).first).to_be_visible()
            row = truck_row(page, PROTECTED_TRUCK)
            expect(row).to_contain_text(STATUS_LABELS["available"])
            click(row.get_by_role("button", name="Start maintenance"))
            expect(notices(page)).to_contain_text("Truck updated")
            expect(row).to_contain_text(STATUS_LABELS["maintenance"])
            expect(page.get_by_text(fleet_line(available - 1, assigned, parked + 1)).first).to_be_visible()
            assert truck(app_url, ada, PROTECTED_TRUCK)["status"] == "maintenance"
            assert db.rows(f"select status from trucks where id = {lit(PROTECTED_TRUCK)}")[0]["status"] == "maintenance"
            click(row.get_by_role("button", name="End maintenance"))
            expect(row).to_contain_text(STATUS_LABELS["available"])
            expect(notices(page)).to_contain_text("Truck updated")
            expect(page.get_by_text(fleet_line(available, assigned, parked)).first).to_be_visible()
        assert truck(app_url, ada, PROTECTED_TRUCK)["status"] == "available"
    finally:
        set_truck(app_url, ada, PROTECTED_TRUCK, "available")


def test_wf_maintenance_refused_on_request(browser, app_url, db):
    maya = login(app_url, MANAGER)
    dex = login(app_url, DISPATCHER)
    ada = login(app_url, ADMIN)
    rid = submit(app_url, maya, f"{fresh_tag('stalefleet')} stale fleet", 1)
    [x] = free_trucks(app_url, dex, 1)
    try:
        with open_app(browser, f"{app_url}/login") as page:
            sign_in(page, app_url, DISPATCHER, "/fleet")
            expect(page.get_by_role("button", name="Start maintenance")).to_have_count(0)
            expect(page.get_by_role("button", name="End maintenance")).to_have_count(0)
        with open_app(browser, f"{app_url}/login") as page:
            sign_in(page, app_url, ADMIN, "/fleet")
            row = truck_row(page, x)
            expect(row).to_contain_text(STATUS_LABELS["available"])
            assert assign(app_url, dex, rid, x).status_code == 201
            click(row.get_by_role("button", name="Start maintenance"))
            expect(notices(page)).to_contain_text(ON_REQUEST)
            expect(row).to_contain_text(STATUS_LABELS["assigned"])
            expect(row.get_by_role("link", name=rid)).to_have_count(1)
        t = truck(app_url, ada, x)
        assert (t["status"], t["request_id"]) == ("assigned", rid)
        assert db.rows(f"select status from trucks where id = {lit(x)}")[0]["status"] == "assigned"
    finally:
        decline_quietly(app_url, dex, rid)
        set_truck(app_url, ada, x, "available")


def test_closed_membership(page, app_url):
    ada = login(app_url, ADMIN)
    r = call(app_url, "GET", "/api/users", ada)
    assert r.status_code == 200 and isinstance(r.json(), list)
    members = {str(m["id"]): m for m in r.json()}
    for member_id, name, email, _ in MEMBERS.values():
        assert (members[member_id]["name"], members[member_id]["email"]) == (name, email)
        assert members[member_id]["role"] in ("admin", "dispatcher", "tour_manager")
        assert not [key for key in members[member_id] if "password" in key]
    for email in (DISPATCHER, MANAGER):
        token = login(app_url, email)
        assert call(app_url, "GET", "/api/users", token).status_code == 403
        assert set_role(app_url, token, "4", "admin").status_code == 403
    for path in ("/api/auth/signup", "/api/auth/register", "/api/auth/password-reset", "/api/quotes", "/api/uploads"):
        r = call(app_url, "POST", path, ada, {"email": fresh_email("joiner"), "password": PASSWORD})
        assert r.status_code == 404 and r.json()["error"] == "not_found", path
    sign_in(page, app_url, ADMIN, "/requests")
    for path in ("/signup", "/register", "/reset-password", "/quote", "/upload"):
        response = page.goto(app_url + path)
        assert response.status == 404, path
        expect(page.get_by_role("heading", level=1)).to_contain_text(WRONG_VENUE)


def test_role_changes(app_url, db):
    ada = login(app_url, ADMIN)
    assert db.rows("select count(*) as n from members where role = 'admin'")[0]["n"] == 1
    try:
        r = call(app_url, "PATCH", "/api/users/4", ada, {"role": "dispatcher", "name": "Mallory", "id": 9,
                                                          "email": "mallory@example.com", "password": WRONG_PASSWORD})
        assert r.status_code == 200
        assert (str(r.json()["id"]), r.json()["name"], r.json()["email"], r.json()["role"]) == ("4", "Milo Manager", MILO, "dispatcher")
        row = db.rows("select name, email, role from members where id = 4")[0]
        assert (row["name"], row["email"], row["role"]) == ("Milo Manager", MILO, "dispatcher")
        bad = set_role(app_url, ada, "4", "owner")
        assert bad.status_code == 422 and bad.json()["fields"]["role"] == "Choose a role."
        assert db.rows("select role from members where id = 4")[0]["role"] == "dispatcher"
        last = set_role(app_url, ada, "1", "dispatcher")
        assert last.status_code == 409 and last.json() == {"error": "conflict", "message": LAST_ADMIN}
        assert db.rows("select role from members where id = 1")[0]["role"] == "admin"
        assert set_role(app_url, ada, MISSING_MEMBER, "dispatcher").status_code == 404
        assert attempt(app_url, MILO, PASSWORD).status_code == 200
    finally:
        set_role(app_url, ada, "4", "tour_manager")


def test_role_change_applies_at_once(app_url, db):
    ada = login(app_url, ADMIN)
    milo = login(app_url, MILO)
    try:
        assert call(app_url, "GET", "/api/dispatch", milo).status_code == 403
        assert set_role(app_url, ada, "4", "dispatcher").status_code == 200
        assert call(app_url, "GET", "/api/dispatch", milo).status_code == 200
        assert call(app_url, "GET", "/api/users", milo).status_code == 403
        assert set_role(app_url, ada, "4", "admin").status_code == 200
        assert call(app_url, "GET", "/api/users", milo).status_code == 200
        assert set_role(app_url, milo, "4", "tour_manager").status_code == 200
        r = call(app_url, "GET", "/api/users", milo)
        assert r.status_code == 403 and r.json()["message"] == ACCESS_COPY
        assert call(app_url, "GET", "/api/dispatch", milo).status_code == 403
        assert db.rows("select role from members where id = 4")[0]["role"] == "tour_manager"
    finally:
        set_role(app_url, ada, "4", "tour_manager")


def test_two_admins_demoting_each_other(app_url, db):
    ada = login(app_url, ADMIN)
    dex = login(app_url, DISPATCHER)
    assert set_role(app_url, ada, "2", "admin").status_code == 200
    try:
        a, d = together(lambda: set_role(app_url, ada, "2", "dispatcher"),
                        lambda: set_role(app_url, dex, "1", "dispatcher"))
        assert sorted([a.status_code, d.status_code])[1] == 200 or sorted([a.status_code, d.status_code]) == [200, 409]
        assert [a.status_code, d.status_code].count(200) == 1
        loser = a if a.status_code != 200 else d
        assert loser.status_code in (403, 409)
        if loser.status_code == 409:
            assert loser.json() == {"error": "conflict", "message": LAST_ADMIN}
        admins = db.rows("select id from members where role = 'admin'")
        assert len(admins) == 1
    finally:
        roles = {str(row["id"]): row["role"] for row in db.rows("select id, role from members where id in (1, 2)")}
        if roles["1"] != "admin":
            set_role(app_url, dex, "1", "admin")
        set_role(app_url, login(app_url, ADMIN), "2", "dispatcher")


def test_wf_members_role_saved_and_live(browser, app_url, db):
    ada = login(app_url, ADMIN)
    try:
        with open_app(browser, f"{app_url}/login") as milo_page, open_app(browser, f"{app_url}/login") as ada_page:
            sign_in(milo_page, app_url, MILO, "/requests")
            expect(nav_link(milo_page, "Dispatch")).to_have_count(0)
            sign_in(ada_page, app_url, ADMIN, "/admin/users")
            row = ada_page.get_by_role("row").filter(has_text=MILO)
            select(row.get_by_role("combobox"), "Dispatcher")
            click(row.get_by_role("button", name="Save"))
            expect(notices(ada_page)).to_contain_text("Role saved")
            assert db.rows("select role from members where id = 4")[0]["role"] == "dispatcher"
            milo_page.reload()
            expect(nav_link(milo_page, "Dispatch")).to_be_visible()
            assert milo_page.goto(f"{app_url}/dispatch").status == 200
            row = ada_page.get_by_role("row").filter(has_text=MILO)
            select(row.get_by_role("combobox"), "Tour manager")
            click(row.get_by_role("button", name="Save"))
            expect(notices(ada_page)).to_contain_text("Role saved")
            assert db.rows("select role from members where id = 4")[0]["role"] == "tour_manager"
            response = milo_page.goto(f"{app_url}/dispatch")
            assert response.status == 403
            expect(milo_page.get_by_text(ACCESS_COPY)).to_be_visible()
    finally:
        set_role(app_url, ada, "4", "tour_manager")


def test_wf_members_last_admin_refused(browser, app_url, db):
    assert db.rows("select count(*) as n from members where role = 'admin'")[0]["n"] == 1
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, ADMIN, "/admin/users")
        row = page.get_by_role("row").filter(has_text=ADMIN)
        select(row.get_by_role("combobox"), "Dispatcher")
        click(row.get_by_role("button", name="Save"))
        expect(notices(page)).to_contain_text(LAST_ADMIN)
    assert db.rows("select role from members where id = 1")[0]["role"] == "admin"
    with open_app(browser, f"{app_url}/login") as page:
        sign_in(page, app_url, DISPATCHER, "/requests")
        response = page.goto(f"{app_url}/admin/users")
        assert response.status == 403
        expect(page.get_by_text(ACCESS_COPY)).to_be_visible()


A11Y_PAGES = ["/requests", "/requests/new", "/requests/LR-0003", "/dispatch", "/fleet", "/admin/users"]


def test_accessibility(browser, app_url):
    with open_app(browser, f"{app_url}/login") as page:
        axe(page)
        assert tab_order(page, 1)[0] == "Skip to content"
        sign_in(page, app_url, ADMIN, "/requests")
        for path in A11Y_PAGES:
            page.goto(app_url + path)
            axe(page)
        page.goto(f"{app_url}/requests")
        names = tab_order(page, TAB_PRESSES)
        assert names[0] == "Skip to content" and "Requests" in names
        link = nav_link(page, "Requests")
        expect(link).to_have_attribute("aria-current", "page")
        rest, focused = state_styles(link, "outline-style", "outline-width", "box-shadow", state="focus")
        ring = (focused["outline-style"] != "none" and focused["outline-width"] != "0px") or focused["box-shadow"] != "none"
        assert ring and focused != rest
        page.goto(f"{app_url}/fleet")
        expect(nav_link(page, "Fleet")).to_have_attribute("aria-current", "page")
        assert nav_link(page, "Requests").get_attribute("aria-current") != "page"


PHONE_PAGES = ["/requests", "/requests/new", "/requests/LR-0003", "/dispatch", "/fleet", "/admin/users"]


def test_phone_width(browser, app_url):
    with open_app(browser, f"{app_url}/login") as page:
        page.set_viewport_size({"width": PHONE_WIDTH, "height": PHONE_HEIGHT})
        page.goto(f"{app_url}/login")
        layout(page)
        sign_in(page, app_url, ADMIN, "/requests")
        for path in PHONE_PAGES:
            page.goto(app_url + path)
            layout(page)
        page.goto(f"{app_url}/requests")
        menu = page.get_by_role("button", name="Menu")
        expect(menu).to_be_visible()
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(nav_link(page, "Requests")).to_be_hidden()
        click(menu)
        expect(menu).to_have_attribute("aria-expanded", "true")
        expect(nav_link(page, "Requests")).to_be_visible()
        expect(nav_link(page, "Requests")).to_be_focused()
        page.keyboard.press("Escape")
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(menu).to_be_focused()


def _begin(entry: dict[str, Any]) -> float:
    return entry["at"] if entry["source"] == "animation" else entry["at"] + entry["delay"]


def _moves(entry: dict[str, Any]) -> bool:
    return entry["property"] in ("transform", "translate") or entry["transform"] not in (None, "none")


def test_motion(browser, app_url):
    with open_app(browser, f"{app_url}/login") as page:
        page.add_init_script(MOTION_PROBE)
        page.goto(f"{app_url}/login")
        until(page, "() => window.__motion.filter(m => m.heading).length >= 3", None, WAIT_SECONDS)
        heading = [m for m in page.evaluate("() => window.__motion") if m["heading"]]
        starts: list[float] = []
        for begin in sorted(_begin(m) for m in heading):
            if not starts or begin - starts[-1] > FRAME_CLUSTER_MS:
                starts.append(begin)
        assert len(starts) >= 3, heading
        for earlier, later in zip(starts, starts[1:]):
            assert STAGGER_MIN_MS <= later - earlier <= STAGGER_MAX_MS, starts
        assert max(_begin(m) + m["duration"] for m in heading) - starts[0] <= HEADLINE_MAX_MS
        assert any(m["opacity"] is not None and float(m["opacity"]) < 1 for m in heading)
        assert any(_moves(m) for m in heading)
        live = page.evaluate(LIVE_ANIMATIONS)
        assert any(a["infinite"] and RAIL_MIN_MS <= a["duration"] <= RAIL_MAX_MS for a in live), live
        mark = page.evaluate("() => window.__motion.length")
        page.get_by_role("button", name="Sign in", exact=True).hover()
        until(page, "(n) => window.__motion.slice(n).some(m => m.button)", mark, WAIT_SECONDS)
        roll = [m for m in page.evaluate("() => window.__motion")[mark:] if m["button"]]
        assert any(_moves(m) and 0 < m["duration"] <= LABEL_ROLL_MAX_MS for m in roll), roll
        sign_in(page, app_url, ADMIN, "/requests")
        with held(page, "**/activity*") as gate:
            page.goto(f"{app_url}/requests/LR-0003")
            expect(page.get_by_text("Loading activity")).to_be_visible()
            spins = page.evaluate(LIVE_ANIMATIONS)
            assert any(a["infinite"] and SPIN_MIN_MS <= a["duration"] <= SPIN_MAX_MS for a in spins), spins
            gate.release()
        expect(page.get_by_role("region", name="Activity")).to_contain_text(SEED_REQUESTS["LR-0003"]["decision_note"])


REDUCED_IDS = ["system", "switch"]


@pytest.mark.parametrize("mode", REDUCED_IDS, ids=REDUCED_IDS)
def test_reduced_motion(browser, app_url, mode):
    preference = "reduce" if mode == "system" else "no-preference"
    with open_app(browser, f"{app_url}/login", reduced_motion=preference) as page:
        sign_in(page, app_url, ADMIN, "/requests")
        switch = page.get_by_role("button", name="Reduce motion")
        if mode == "switch":
            expect(switch).to_have_attribute("aria-pressed", "false")
            click(switch)
            expect(switch).to_have_attribute("aria-pressed", "true")
        page.add_init_script(MOTION_PROBE)
        page.goto(f"{app_url}/requests")
        if mode == "switch":
            expect(page.get_by_role("button", name="Reduce motion")).to_have_attribute("aria-pressed", "true")
        expect(page.get_by_role("heading", level=1)).to_be_visible()
        advance(page, HEADLINE_MAX_MS)
        log = page.evaluate("() => window.__motion")
        assert not [m for m in log if m["heading"] and m["duration"] + m["delay"] > REDUCED_MAX_MS], log
        live = page.evaluate(LIVE_ANIMATIONS)
        assert not [a for a in live if a["infinite"] and a["duration"] > REDUCED_MAX_MS], live
        mark = len(log)
        page.get_by_role("button", name="Sign out").hover()
        advance(page, LABEL_ROLL_MAX_MS)
        roll = [m for m in page.evaluate("() => window.__motion")[mark:] if m["button"] and _moves(m)]
        assert not [m for m in roll if m["duration"] > REDUCED_MAX_MS], roll
        with held(page, "**/activity*") as gate:
            page.goto(f"{app_url}/requests/LR-0003")
            expect(page.get_by_text("Loading activity")).to_be_visible()
            spins = page.evaluate(LIVE_ANIMATIONS)
            assert not [a for a in spins if a["infinite"] and a["duration"] > REDUCED_MAX_MS], spins
            gate.release()


def test_no_outside_hosts(browser, app_url):
    with open_app(browser, f"{app_url}/login") as page:
        seen: list[str] = []
        page.on("request", lambda req: seen.append(req.url))
        page.goto(f"{app_url}/login")
        sign_in(page, app_url, ADMIN, "/requests")
        for path in ["/requests/new", "/requests/LR-0003", "/dispatch", "/fleet", "/admin/users"]:
            page.goto(app_url + path)
        expect(page.get_by_role("heading", level=1)).to_be_visible()
        outside = [url for url in seen if urlparse(url).scheme in ("http", "https", "ws", "wss") and not same_origin(url, app_url)]
        assert seen and not outside, outside


def test_health_and_server_rendered(app_url):
    r = call(app_url, "GET", "/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    page = httpx.get(f"{app_url}/login", timeout=HTTP_TIMEOUT)
    assert page.status_code == 200
    html = page.text
    for copy_text in ("Sign in to Gigfreight", "Fill in your details, we will take it from there.", "Email", "Password"):
        assert copy_text in html, copy_text
    for dev_marker in ("livereload", "@vite/client", "webpack-dev-server", "browser-sync"):
        assert dev_marker not in html


DENIED_PACKAGES = {
    "redis", "ioredis", "mongodb", "mongoose", "sqlite3", "better-sqlite3", "sql.js", "@electric-sql/pglite",
    "pg-mem", "lowdb", "nedb", "@seald-io/nedb", "level", "leveldown", "classic-level", "lokijs", "lmdb",
    "memcached", "memjs", "amqplib", "kafkajs", "bull", "bullmq", "bee-queue", "mysql", "mysql2",
    "node-cache", "pouchdb", "nano", "cassandra-driver", "rethinkdb", "couchbase", "tedious",
}
DB_FILE_SUFFIXES = (".sqlite", ".sqlite3", ".db", ".db3")
ALLOWED_LICENCES = {"MIT", "ISC", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"}


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_user_readme():
    text = Path("/app/USER_README.md").read_text()
    assert PASSWORD in text
    for _, _, email, _ in MEMBERS.values():
        assert email in text


def test_if_no_second_datastore():
    names = {name for name, _ in shipped_packages()}
    assert not names & DENIED_PACKAGES, names & DENIED_PACKAGES
    stray = [str(p) for p in Path("/app").rglob("*")
             if p.suffix in DB_FILE_SUFFIXES and "node_modules" not in p.parts and ".git" not in p.parts]
    assert not stray, stray


def test_if_third_party_notices():
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{name}@{version}" for (name, version), dep in shipped_packages().items()
               if name not in text or version not in text or package_licence(name, dep) not in text]
    assert not missing, missing


def test_if_licences():
    refused = []
    for (name, version), dep in shipped_packages().items():
        licence = package_licence(name, dep)
        options = [part.strip(" ()") for part in re.split(r"\s+OR\s+", licence)]
        if not any(option in ALLOWED_LICENCES for option in options):
            refused.append(f"{name}@{version}: {licence or 'none'}")
    assert not refused, refused


def test_if_database_from_environment():
    unreachable = "postgres://nobody:nothing@127.0.0.1:9/absent"
    with app_copy({"DATABASE_URL": unreachable}) as (base, proc, log_path):
        r = wait_health(base, proc, log_path, 503)
        assert r.json() == {"status": "unavailable"}
        assert proc.poll() is None, tail(log_path)
        assert httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT).status_code == 503
