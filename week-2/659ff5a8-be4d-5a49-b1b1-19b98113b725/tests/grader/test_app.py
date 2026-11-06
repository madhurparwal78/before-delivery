from __future__ import annotations

import concurrent.futures as cf
import contextlib
import csv
import hashlib
import importlib
import io
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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    animations,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    motion,
    open_app,
    pdf_text,
    same_origin,
    select,
    shipped_packages,
    tap,
    unique,
    until,
)


def _load(name: str, *modules: str) -> Any:
    for module in modules:
        try:
            return getattr(importlib.import_module(module), name)
        except (ImportError, AttributeError):
            continue
    raise ImportError(f"verifier helper {name} not found in {modules}")


DEPLOYED_APP = _load("DEPLOYED_APP", "conftest")
Postgres = _load("Postgres", "conftest", "postgres", "clients.postgres")
S3 = _load("S3", "conftest", "minio", "clients.minio")
pdf_pages = _load("pdf_pages", "conftest", "gotenberg", "clients.gotenberg")
addresses = _load("addresses", "conftest", "mailpit", "clients.mailpit")
mail_text = _load("text", "conftest", "mailpit", "clients.mailpit")
mail_from_address = _load("mail_from_address", "conftest", "mailpit", "clients.mailpit")

PASSWORD = "conecount-2026"
OPERATOR_EMAIL = "ops@pylonworks.test"
RIDGE_CHAIR = "chair@ridgeline.test"
RIDGE_TIMING = "timing@ridgeline.test"
RIDGE_WORKERS = "workers@ridgeline.test"
POINTS7_NAME = "Points 7 at Fairgrounds"
POINTS9_NAME = "Points 9 at Airpark"
DENVER = "America/Denver"
COOKIE = "paddock_session"
TABLE_DATE = "2026-01-01"
FACTORS = {"SS": "0.8270", "AS": "0.8180", "BS": "0.8120", "DS": "0.8000", "GS": "0.7930", "HS": "0.7840", "STR": "0.8290", "SM": "0.8550"}
HEATS = [{"number": 1, "classes": ["SS", "STR"]}, {"number": 2, "classes": ["GS", "HS"]}]
STATIONS = ["Start", "Finish", "Corner 1", "Corner 2"]
POINTS7 = [
    ("Avery Lindqvist", "SS", 12, "2019 Chevrolet Corvette", (("52.418", 1), ("51.907", 0))),
    ("Bo Tanaka-Reyes", "STR", 7, "2020 Mazda MX-5 RF", (("53.211", 0), "DNF")),
    ("Cass Ferreira", "GS", 31, "2017 Volkswagen GTI", (("56.034", 2), ("55.120", 0))),
    ("Del Mbeki", "HS", 4, "2016 Honda Fit", (("58.402", 0), ("57.880", 1))),
]
SEASON_POINTS = {"Avery Lindqvist": "100.000", "Cass Ferreira": "98.209", "Bo Tanaka-Reyes": "97.314", "Del Mbeki": "93.754"}
HALF_UP_FACTOR = "0.7500"
HALF_UP_ADJUSTED = "40.006"
HALF_UP_INDEXED = "30.005"
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
FONTS = ("Chakra Petch", "IBM Plex Sans", "JetBrains Mono")
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
LIVE_MAX_MS = 2000
SETTLE_BASE_MS = 1500
SETTLE_PER_CONE_MS = 125
TOUCH_MIN_PX = 44
BODY_LIMIT = 65536
WINDOW_DEFAULT_S = 1800
OUTAGE_URL_ENV = {"renderer": "APP_GOTENBERG_DOWN_URL", "storage": "APP_MINIO_DOWN_URL", "mail": "APP_MAILPIT_DOWN_URL"}

HTTP_TIMEOUT = 60
MAIL_WAIT_S = 45
WINDOW_WAIT_S = 90
COPY_BOOT_S = 180
POLL_S = 0.25
TICK_MS = 300
UI_SLOW_MS = 30000
FAR_DATE = "2099-06-20"
FAR_CUTOFF = "2099-06-18T20:00"
LATER_DATE = "2099-07-20"
LATER_CUTOFF = "2099-07-18T20:00"
MIDSEASON_DATE = "2099-07-01"
FAR_YEAR = int(FAR_DATE.split("-")[0])
REG_LINE = "Registration closes " + FAR_CUTOFF.replace("T", " at ")
EXTRA_CLASS = "EV"
DECISION_NOTE = "Correction log settles it"
BAD_YEAR = "abcd"
UNKNOWN_PATH = "/api/no-such-route"
DEP_DIR = "node_modules"
COOKIE_ATTRS = ("HttpOnly", "SameSite=Lax", "Path=/")
CSV_TYPE = "text/csv; charset=utf-8"
APOS = "'"
FORMULA_CHARS = "=+-@"
FORMULA_NAME = "=SUM(1,2)"
FORMULA_CAR = "+Turbo, Inc"
AT_NAME = "@Vera Quill"
MINUS_CAR = '-Lowered "Track" car'
CAR14_RAW = "53.000"
CUTOFF_FORMATS = (FAR_CUTOFF, FAR_CUTOFF.replace("T", " "), FAR_CUTOFF.replace("T", " at "))
FORM_TRY_MS = 8000

COPY_ENV = {
    "renderer": {"GOTENBERG_URL": "http://127.0.0.1:9"},
    "storage": {"S3_ENDPOINT": "http://127.0.0.1:9"},
    "mail": {"SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9"},
    "window60": {"PROTEST_WINDOW_SECONDS": "60"},
}


def _pause(seconds: float = POLL_S) -> None:
    threading.Event().wait(seconds)


def _wait(pred: Callable[[], Any], what: str, seconds: float = WINDOW_WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = pred()
        if value:
            return value
        _pause()
    pytest.fail(f"timed out waiting for {what}")


def _tag() -> str:
    raw = re.sub(r"[^a-z0-9]", "", str(unique("t")[0]).lower())[-6:]
    return f"{raw}{uuid.uuid4().hex[:6]}"


def _env_url(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        pytest.fail(f"{name} is not set; the verifier needs that app instance")
    return value.rstrip("/")


def _short() -> str:
    return _env_url("APP_SHORT_WINDOW_URL")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _local(iso: str, tz: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ZoneInfo(tz))


def _err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text[:400]}"
    body = r.json()
    assert body.get("error") == code, f"expected error {code}, got {body}"
    assert isinstance(body.get("message"), str) and body["message"], body
    return body


_NO = object()


@dataclass
class Actor:
    base: str
    cookie: str
    user: dict
    name: str
    email: str

    def req(self, method: str, path: str, body: Any = _NO, headers: dict | None = None, base: str | None = None) -> httpx.Response:
        h = {"Cookie": f"{COOKIE}={self.cookie}", **(headers or {})}
        kw: dict[str, Any] = {} if body is _NO else {"json": body}
        return httpx.request(method, f"{base or self.base}{path}", headers=h, timeout=HTTP_TIMEOUT, **kw)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.req("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.req("POST", path, {} if body is None else body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.req("DELETE", path, **kw)


def _cookie_of(r: httpx.Response) -> str:
    for header in r.headers.get_list("set-cookie"):
        if header.startswith(f"{COOKIE}="):
            return header.split(";", 1)[0].split("=", 1)[1]
    pytest.fail(f"no {COOKIE} cookie in response {r.status_code}")


def _signin(base: str, email: str, password: str = PASSWORD) -> Actor:
    r = httpx.post(f"{base}/api/session", json={"email": email, "password": password}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"sign-in of {email} failed: {r.status_code} {r.text[:300]}"
    user = r.json()["user"]
    return Actor(base, _cookie_of(r), user, user["name"], email)


@dataclass
class Club:
    base: str
    slug: str
    name: str
    tz: str
    chair: Actor


def _load_table(chair: Actor, date: str, factors: dict) -> dict:
    r = chair.post("/api/index-tables", {"effectiveDate": date, "factors": factors})
    assert r.status_code == 201, f"index table {date} refused: {r.status_code} {r.text[:300]}"
    return r.json()["table"]


def _onboard(base: str, tz: str = DENVER, table: bool = True) -> Club:
    ops = _signin(base, OPERATOR_EMAIL)
    tag = _tag()
    slug, name = f"c{tag}", f"Club {tag}"
    chair_email = f"chair-{tag}@paddock.test"
    r = ops.post("/api/operator/clubs", {"slug": slug, "name": name, "timeZone": tz,
                                         "chair": {"name": f"Chair {tag}", "email": chair_email, "password": PASSWORD}})
    assert r.status_code == 201, f"onboarding failed: {r.status_code} {r.text[:300]}"
    club = Club(base, slug, name, tz, _signin(base, chair_email))
    if table:
        _load_table(club.chair, TABLE_DATE, FACTORS)
    return club


def _driver(club: Club, name: str | None = None) -> Actor:
    tag = _tag()
    name = name or f"Driver {tag}"
    email = f"d-{tag}@paddock.test"
    r = httpx.post(f"{club.base}/api/clubs/{club.slug}/signup", json={"name": name, "email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"signup failed: {r.status_code} {r.text[:300]}"
    user = r.json()["user"]
    return Actor(club.base, _cookie_of(r), user, user["name"], email)


def _event(actor: Actor, eid: Any) -> dict:
    r = actor.get(f"/api/events/{eid}")
    assert r.status_code == 200, r.text[:300]
    return r.json()["event"]


def _soon_dates(event: dict) -> tuple[str, str]:
    now = _local(event["serverTime"], event["timeZone"])
    cutoff = f"{(now + timedelta(days=1)):%Y-%m-%d}T20:00"
    return (now + timedelta(days=2)).date().isoformat(), cutoff


def _create_event(club: Club, *, name: str | None = None, date: str = FAR_DATE, cutoff: str = FAR_CUTOFF, runs: int = 2,
                  heats: list | None = None, stations: list | None = None, soon: bool = False) -> dict:
    body = {"name": name or f"Event {_tag()}", "date": date, "venue": "Test Lot", "registrationCutoff": cutoff,
            "runsPerDriver": runs, "heats": heats or HEATS, "stations": stations or STATIONS}
    r = club.chair.post("/api/events", body)
    assert r.status_code == 201, f"event create failed: {r.status_code} {r.text[:300]}"
    event = r.json()["event"]
    if soon:
        d, c = _soon_dates(event)
        r = club.chair.req("PATCH", f"/api/events/{event['id']}", {"date": d, "registrationCutoff": c, "version": event["version"]})
        assert r.status_code == 200, r.text[:300]
        event = r.json()["event"]
    return event


def _move(chair: Actor, eid: Any, *targets: str) -> dict:
    event: dict = {}
    for to in targets:
        r = chair.post(f"/api/events/{eid}/transition", {"to": to})
        assert r.status_code == 200, f"transition to {to} failed: {r.status_code} {r.text[:300]}"
        event = r.json()["event"]
    return event


def _register(drv: Actor, eid: Any, cls: str, car: int, desc: str | None = None, base: str | None = None) -> dict:
    r = drv.post(f"/api/events/{eid}/registrations", {"classCode": cls, "carNumber": car, "carDescription": desc or f"Car {car}"}, base=base)
    assert r.status_code == 201, f"registration failed: {r.status_code} {r.text[:300]}"
    return r.json()["registration"]


def _check_in(drv: Actor, rid: Any) -> dict:
    r = drv.post(f"/api/registrations/{rid}/check-in", {"signature": drv.name})
    assert r.status_code == 201, f"check-in failed: {r.status_code} {r.text[:300]}"
    return r.json()["registration"]


def _set_heat(chair: Actor, eid: Any, heat: int) -> None:
    r = chair.post(f"/api/events/{eid}/running-heat", {"heat": heat})
    assert r.status_code == 200, r.text[:300]


def _run_body(run: Any) -> dict:
    return {"outcome": "dnf"} if run == "DNF" else {"outcome": "time", "rawTime": run[0], "cones": run[1]}


def _commit(chair: Actor, rid: Any, k: int, run: Any) -> dict:
    r = chair.post(f"/api/registrations/{rid}/runs/{k}", _run_body(run))
    assert r.status_code == 201, f"commit failed: {r.status_code} {r.text[:300]}"
    return r.json()


@dataclass
class Built:
    club: Club
    event: dict
    drivers: dict
    regs: dict

    @property
    def eid(self) -> Any:
        return self.event["id"]


def _build(club: Club, entries: list, *, runs: int = 2, heats: list | None = None, stations: list | None = None,
           date: str = FAR_DATE, cutoff: str = FAR_CUTOFF, soon: bool = False, check_in: Any = True,
           start: bool = True, drivers: dict | None = None, name: str | None = None) -> Built:
    event = _create_event(club, name=name, date=date, cutoff=cutoff, runs=runs, heats=heats, stations=stations, soon=soon)
    eid = event["id"]
    _move(club.chair, eid, "registration_open")
    known = dict(drivers or {})
    regs: dict = {}
    for dname, cls, car, desc, _runs in entries:
        known.setdefault(dname, None)
        if known[dname] is None:
            known[dname] = _driver(club, dname)
        regs[dname] = _register(known[dname], eid, cls, car, desc)
    wanted = {e[0] for e in entries} if check_in is True else set(check_in or ())
    if wanted or start:
        _move(club.chair, eid, "registration_closed")
    for dname in wanted:
        _check_in(known[dname], regs[dname]["id"])
    if start:
        _move(club.chair, eid, "running")
    return Built(club, _event(club.chair, eid), {e[0]: known[e[0]] for e in entries}, regs)


def _time_runs(built: Built, entries: list) -> None:
    for heat in built.event["heats"]:
        todo = [e for e in entries if e[1] in heat["classes"] and e[4]]
        if not todo:
            continue
        _set_heat(built.club.chair, built.eid, heat["number"])
        for dname, _cls, _car, _desc, runs in todo:
            for k, run in enumerate(runs, 1):
                if run is not None:
                    _commit(built.club.chair, built.regs[dname]["id"], k, run)


def _window_closed(chair: Actor, eid: Any) -> None:
    _wait(lambda: _event(chair, eid)["protestWindowOpen"] is False, "the server to close the protest window")


def _finalise(chair: Actor, eid: Any) -> dict:
    _move(chair, eid, "provisional")
    _window_closed(chair, eid)
    return _move(chair, eid, "final")


def _published(base: str, entries: list, **kw: Any) -> tuple[Club, Built]:
    club = kw.pop("club", None) or _onboard(base)
    built = _build(club, entries, **kw)
    _time_runs(built, entries)
    _finalise(club.chair, built.eid)
    r = club.chair.post(f"/api/events/{built.eid}/publish", {})
    assert r.status_code == 200, f"publish failed: {r.status_code} {r.text[:300]}"
    return club, built


def _standings(actor: Actor, eid: Any, view: str = "indexed", cls: str | None = None) -> list:
    q = f"view={view}" + (f"&class={cls}" if cls else "")
    r = actor.get(f"/api/events/{eid}/standings?{q}")
    assert r.status_code == 200, r.text[:300]
    return r.json()["rows"]


def _runs(actor: Actor, eid: Any, heat: int) -> list:
    r = actor.get(f"/api/events/{eid}/runs?heat={heat}")
    assert r.status_code == 200, r.text[:300]
    return r.json()["entries"]


def _run_of(actor: Actor, eid: Any, heat: int, car: int, cls: str, k: int) -> dict:
    for entry in _runs(actor, eid, heat):
        if entry["carNumber"] == car and entry["classCode"] == cls:
            return next(run for run in entry["runs"] if run["runNumber"] == k)
    pytest.fail(f"GET runs listed no car {car} {cls}")


def _rota(actor: Actor, eid: Any) -> list:
    r = actor.get(f"/api/events/{eid}/rota")
    assert r.status_code == 200, r.text[:300]
    return r.json()["heats"]


def _station(rota: list, heat: int, name: str) -> dict:
    return next(s for h in rota if h["number"] == heat for s in h["stations"] if s["name"] == name)


def _unfilled(rota: list, heat: int) -> int:
    return next(h["unfilled"] for h in rota if h["number"] == heat)


def _race(calls: list) -> list:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with cf.ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def _mails(mail: Any, email: str, subject: str | None = None, minimum: int = 1, seconds: float = MAIL_WAIT_S) -> list:
    def matching() -> list:
        return [m for m in mail.messages()
                if email.lower() in [a.lower() for a in addresses(m.get("To"))]
                and (subject is None or m.get("Subject") == subject)]
    if minimum == 0:
        return matching()
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = matching()
        if len(found) >= minimum:
            return found
    pytest.fail(f"Mailpit received fewer than {minimum} message(s) to {email} with subject {subject!r}")


def _short_env() -> dict:
    for key in ("DATABASE_URL", "S3_BUCKET"):
        if not os.environ.get(key):
            pytest.fail(f"{key} is not in the verifier environment; cannot start an outage copy")
    return {"DATABASE_URL": os.environ["DATABASE_URL"] + "_short", "S3_BUCKET": os.environ["S3_BUCKET"] + "-short",
            "PROTEST_WINDOW_SECONDS": "5"}


@contextlib.contextmanager
def _copy(overrides: dict) -> Iterator[str]:
    manifest = json.loads(Path("/app/run.json").read_text())
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=str(DEPLOYED_APP), env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-3000:]

    try:
        deadline, ready = time.monotonic() + COPY_BOOT_S, False
        while time.monotonic() < deadline and not ready:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}:\n{tail()}")
            try:
                ready = httpx.get(f"{base}/api/health", timeout=2).status_code == 200
            except httpx.HTTPError:
                ready = False
            if not ready:
                _pause()
        if not ready:
            pytest.fail(f"app copy never answered /api/health:\n{tail()}")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        log.close()


@pytest.fixture(scope="module")
def copies() -> Iterator[Callable[[str], str]]:
    started: dict[str, str] = {}
    with contextlib.ExitStack() as stack:
        def get(kind: str) -> str:
            if kind not in started:
                started[kind] = stack.enter_context(_copy({**_short_env(), **COPY_ENV[kind]}))
            return started[kind]
        yield get


@contextlib.contextmanager
def _browse(browser: Browser, actor: Actor | None, path: str, size: str = "desktop", base: str | None = None,
            clock: datetime | None = None, **opts: Any) -> Iterator[Page]:
    base = base or (actor.base if actor else "")
    with open_app(browser, f"{base}/signin", **opts) as page:
        w, h = VIEWPORTS[size]
        page.set_viewport_size({"width": w, "height": h})
        if actor is not None:
            page.context.add_cookies([{"name": COOKIE, "value": actor.cookie, "url": base}])
        if clock is not None:
            page.clock.set_fixed_time(clock)
        page.goto(f"{base}{path}")
        yield page


def _tick(page: Page) -> None:
    page.clock.run_for(TICK_MS)


def _ui_signin(page: Page, base: str, email: str, password: str = PASSWORD) -> None:
    page.goto(f"{base}/signin")
    expect(page.get_by_role("heading", name="Sign in to Conecount Paddock", exact=True)).to_be_visible()
    fill(page.get_by_role("textbox", name="Email", exact=True), email)
    fill(page.get_by_role("textbox", name="Password", exact=True), password)
    click(page.get_by_role("button", name="Sign in", exact=True))
    _tick(page)


def _role(page: Page, role: str, name: str) -> Locator:
    return page.get_by_role(role, name=name, exact=True)


def _focus_inside(container: Locator) -> bool:
    return bool(container.evaluate("c => c.contains(document.activeElement)"))


def _tc(page: Page, car: int, cls: str, k: int) -> Locator:
    return _role(page, "gridcell", f"Car {car} {cls} run {k} time")


def _cc(page: Page, car: int, cls: str, k: int) -> Locator:
    return _role(page, "gridcell", f"Car {car} {cls} run {k} cones")


def _y(sample: dict) -> float:
    return float(sample.get("y", sample.get("top", 0.0)))


def _box(loc: Locator) -> dict:
    box = loc.bounding_box()
    assert box is not None, "element has no layout box"
    return box


def test_wf_cross_cutting_health(app_url: str) -> None:
    for base in [app_url.rstrip("/"), *(_env_url(v) for v in OUTAGE_URL_ENV.values())]:
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, f"{base} health {r.status_code}"
        assert r.json() == {"status": "ok"}


def test_session_lifecycle(app_url: str) -> None:
    r = httpx.post(f"{app_url}/api/session", json={"email": RIDGE_CHAIR, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    header = next(h for h in r.headers.get_list("set-cookie") if h.startswith(f"{COOKIE}="))
    assert all(a.lower() in header.lower() for a in COOKIE_ATTRS)
    user = r.json()["user"]
    assert user["email"] == RIDGE_CHAIR and "chair" in user["roles"]
    assert user["club"]["slug"] == "ridgeline" and user["club"]["timeZone"] == DENVER
    chair = Actor(app_url, _cookie_of(r), user, user["name"], RIDGE_CHAIR)
    me = chair.get("/api/session")
    assert me.status_code == 200 and me.json()["user"]["id"] == user["id"]

    bad = httpx.post(f"{app_url}/api/session", json={"email": RIDGE_CHAIR, "password": "not-the-password-1"}, timeout=HTTP_TIMEOUT)
    _err(bad, 401, "invalid_credentials")
    assert not any(h.startswith(f"{COOKIE}=") for h in bad.headers.get_list("set-cookie"))

    out = chair.delete("/api/session")
    assert out.status_code == 204
    assert any(h.startswith(f"{COOKIE}=") for h in out.headers.get_list("set-cookie")), "sign-out must clear the cookie"
    _err(chair.get("/api/session"), 401, "unauthenticated")

    club = _onboard(app_url, table=False)
    drv = _driver(club)
    again = _signin(app_url, drv.email)
    assert again.user["id"] == drv.user["id"]
    ops = _signin(app_url, OPERATOR_EMAIL)
    assert ops.user["club"] is None and "operator" in ops.user["roles"]


def test_role_permissions(app_url: str) -> None:
    club = _onboard(app_url)
    built = _build(club, [("Role Driver", "SS", 12, "Role car", ())], check_in=False, start=False)
    drv, eid = built.drivers["Role Driver"], built.eid
    name = f"Forbidden {_tag()}"
    body = {"name": name, "date": FAR_DATE, "venue": "Lot", "registrationCutoff": FAR_CUTOFF, "runsPerDriver": 2,
            "heats": HEATS, "stations": STATIONS}
    _err(drv.post("/api/events", body), 403, "forbidden")
    _err(drv.post("/api/index-tables", {"effectiveDate": MIDSEASON_DATE, "factors": FACTORS}), 403, "forbidden")
    _err(drv.get("/api/operator/clubs"), 403, "forbidden")
    _err(drv.post(f"/api/events/{eid}/transition", {"to": "registration_closed"}), 403, "forbidden")
    _err(drv.get(f"/api/events/{eid}/publication"), 403, "forbidden")
    _err(drv.get(f"/api/events/{eid}/runs?heat=1"), 403, "forbidden")
    _err(drv.post(f"/api/events/{eid}/running-heat", {"heat": 1}), 403, "forbidden")
    events = club.chair.get("/api/events").json()["events"]
    assert all(e["name"] != name for e in events)
    assert _event(club.chair, eid)["status"] == "registration_open"

    ops = _signin(app_url, OPERATOR_EMAIL)
    _err(ops.get("/api/events"), 403, "forbidden")

    timing = _signin(app_url, RIDGE_TIMING)
    workers = _signin(app_url, RIDGE_WORKERS)
    ridge_chair = _signin(app_url, RIDGE_CHAIR)
    p9 = next(e for e in ridge_chair.get("/api/events").json()["events"] if e["name"] == POINTS9_NAME)
    _err(timing.post("/api/events", body), 403, "forbidden")
    _err(timing.post("/api/index-tables", {"effectiveDate": MIDSEASON_DATE, "factors": FACTORS}), 403, "forbidden")
    assert timing.get(f"/api/events/{p9['id']}/runs?heat=1").status_code == 200
    _err(workers.post(f"/api/events/{p9['id']}/running-heat", {"heat": 1}), 403, "forbidden")
    _err(workers.get(f"/api/events/{p9['id']}/runs?heat=1"), 403, "forbidden")
    assert all(e["name"] != name for e in ridge_chair.get("/api/events").json()["events"])


def test_wf_club_onboarding_happy(browser: Browser, app_url: str) -> None:
    tag = _tag()
    slug, name, chair_name = f"k{tag}", f"Keyboard Club {tag}", f"Chair {tag}"
    chair_email = f"kchair-{tag}@paddock.test"
    with open_app(browser, f"{app_url}/signin") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        _ui_signin(page, app_url, OPERATOR_EMAIL)
        expect(page).to_have_url(re.compile(r"/operator$"))
        form = _role(page, "form", "Onboard club")
        values = [("Club slug", slug), ("Club name", name), ("Time zone", DENVER), ("Chair name", chair_name),
                  ("Chair email", chair_email), ("Chair password", PASSWORD)]
        form.get_by_role("textbox", name="Club slug", exact=True).focus()
        page.keyboard.type(slug)
        for label, value in values[1:]:
            page.keyboard.press("Tab")
            expect(form.get_by_role("textbox", name=label, exact=True)).to_be_focused()
            page.keyboard.type(value)
        page.keyboard.press("Tab")
        expect(_role(page, "button", "Onboard club")).to_be_focused()
        page.keyboard.press("Enter")
        _tick(page)
        expect(_role(page, "status", "Operator updates")).to_contain_text(f"Club {name} is ready. {chair_name} can sign in now.", timeout=UI_SLOW_MS)
        row = _role(page, "table", "Club workspaces").get_by_role("row").filter(has_text=name)
        expect(row).to_contain_text(DENVER)
        expect(row).to_contain_text("None")
        layout(page)
        for label, value in values:
            if label == "Chair email":
                value = f"other-{tag}@paddock.test"
            fill(form.get_by_role("textbox", name=label, exact=True), value)
        click(_role(page, "button", "Onboard club"))
        _tick(page)
        expect(_role(page, "status", "Operator updates")).to_contain_text("That club slug is taken.")
    ops = _signin(app_url, OPERATOR_EMAIL)
    clubs = [c for c in ops.get("/api/operator/clubs").json()["clubs"] if c["slug"] == slug]
    assert len(clubs) == 1
    assert (clubs[0]["eventCount"], clubs[0]["driverCount"], clubs[0]["publishedCount"]) == (0, 0, 0)
    assert clubs[0]["lastDeliveryFailure"] is None and clubs[0]["timeZone"] == DENVER

    with open_app(browser, f"{app_url}/signin") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        _ui_signin(page, app_url, chair_email, "wrong-password-9")
        expect(page.get_by_role("alert")).to_contain_text("Email or password is incorrect.")
        _ui_signin(page, app_url, chair_email)
        expect(page).to_have_url(re.compile(r"/events$"))
        expect(_role(page, "button", "New event")).to_be_visible()
        for size in ("phone", "tablet", "desktop"):
            w, h = VIEWPORTS[size]
            page.set_viewport_size({"width": w, "height": h})
            layout(page)
    chair = _signin(app_url, chair_email)
    assert chair.user["club"]["slug"] == slug and "chair" in chair.user["roles"]
    assert chair.get("/api/events").json()["events"] == []


@pytest.mark.timeout(900)
def test_wf_club_onboarding_isolation() -> None:
    base = _short()
    tag = _tag()
    entries = [(f"Iso A {tag}", "SS", 12, "Iso car", (("52.418", 1),)), (f"Iso B {tag}", "STR", 7, "Iso car 2", (("53.211", 0),))]
    club_a = _onboard(base)
    built = _build(club_a, entries)
    _time_runs(built, entries)
    run = _run_of(club_a.chair, built.eid, 1, 12, "SS", 1)
    corr = club_a.chair.post(f"/api/runs/{run['id']}/corrections", {"outcome": "time", "rawTime": "51.907", "cones": 0, "reason": "Cone call reversed"})
    assert corr.status_code == 201
    cid = corr.json()["correction"]["id"]
    _finalise(club_a.chair, built.eid)
    assert club_a.chair.post(f"/api/events/{built.eid}/publish", {}).status_code == 200

    club_b = _onboard(base)
    outsider = _driver(club_b)
    eid, rid = built.eid, built.regs[entries[0][0]]["id"]
    sid = _station(_rota(club_a.chair, eid), 2, "Start")["id"]
    for actor in (club_b.chair, outsider):
        for method, path, body in [
            ("GET", f"/api/events/{eid}", _NO), ("GET", f"/api/events/{eid}/registrations", _NO),
            ("GET", f"/api/events/{eid}/runs?heat=1", _NO), ("GET", f"/api/events/{eid}/standings?view=indexed", _NO),
            ("GET", f"/api/events/{eid}/corrections", _NO), ("GET", f"/api/events/{eid}/protests", _NO),
            ("GET", f"/api/events/{eid}/publication", _NO), ("GET", f"/api/events/{eid}/results.pdf", _NO),
            ("GET", f"/api/events/{eid}/rota", _NO), ("GET", f"/api/registrations/{rid}/waiver.pdf", _NO),
            ("POST", f"/api/events/{eid}/registrations", {"classCode": "SS", "carNumber": 77, "carDescription": "x"}),
            ("POST", f"/api/events/{eid}/transition", {"to": "published"}), ("PUT", f"/api/corrections/{cid}", {}),
            ("POST", f"/api/runs/{run['id']}/corrections", {"outcome": "dnf", "cones": 0, "reason": "outsider edit"}),
            ("DELETE", f"/api/registrations/{rid}", _NO), ("POST", f"/api/stations/{sid}/claim", {}),
        ]:
            _err(actor.req(method, path, body), 404, "not_found")
        assert all(e["id"] != eid for e in actor.get("/api/events").json()["events"])
        season = actor.get(f"/api/season?year={FAR_YEAR}").json()
        assert all(e["id"] != eid for e in season["events"])
        dump = json.dumps(season) + actor.get(f"/api/season.csv?year={FAR_YEAR}").text
        assert entries[0][0] not in dump and entries[1][0] not in dump
    assert club_a.chair.get(f"/api/events/{eid}/results.pdf").status_code == 200
    assert len(club_a.chair.get(f"/api/events/{eid}/corrections").json()["corrections"]) == 1


@pytest.mark.timeout(1200)
def test_operator_overview(browser: Browser, copies: Callable[[str], str]) -> None:
    base = _short()
    tag = _tag()
    entries = [(f"Ops A {tag}", "SS", 12, "Ops car", (("51.907", 0),)), (f"Ops B {tag}", "STR", 7, "Ops car 2", (("53.211", 0),))]
    club = _onboard(base)
    built = _build(club, entries)
    _driver(club, f"Ops C {tag}")
    _create_event(club)
    _time_runs(built, entries)
    _finalise(club.chair, built.eid)
    down = copies("renderer")
    _err(club.chair.post(f"/api/events/{built.eid}/publish", {}, base=down), 503, "renderer_unavailable")

    ops = _signin(base, OPERATOR_EMAIL)
    r = ops.get("/api/operator/clubs")
    row = next(c for c in r.json()["clubs"] if c["slug"] == club.slug)
    assert (row["eventCount"], row["driverCount"], row["publishedCount"]) == (2, 3, 0)
    fail = row["lastDeliveryFailure"]
    assert fail["service"] == "renderer" and str(fail["eventId"]) == str(built.eid)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T.+Z", fail["at"])
    for secret in (entries[0][0], entries[1][0], "42.927", "44.112"):
        assert secret not in r.text
    at = _local(fail["at"], "UTC")
    with _browse(browser, ops, "/operator") as page:
        trow = _role(page, "table", "Club workspaces").get_by_role("row").filter(has_text=club.name)
        expect(trow).to_contain_text(f"Renderer at {at:%Y-%m-%d %H:%M} UTC")
        for secret in (entries[0][0], entries[1][0]):
            expect(page.get_by_text(secret)).to_have_count(0)
    assert club.chair.post(f"/api/events/{built.eid}/publish", {}).status_code == 200
    row = next(c for c in ops.get("/api/operator/clubs").json()["clubs"] if c["slug"] == club.slug)
    assert row["publishedCount"] == 1


def test_driver_signup(app_url: str) -> None:
    club = _onboard(app_url, table=False)
    tag = _tag()
    email = f"join-{tag}@paddock.test"
    r = httpx.post(f"{app_url}/api/clubs/{club.slug}/signup", json={"name": f"Joiner {tag}", "email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201
    user = r.json()["user"]
    assert not {"chair", "timing", "workers"} & set(user["roles"])
    assert user["club"]["slug"] == club.slug
    me = Actor(app_url, _cookie_of(r), user, user["name"], email).get("/api/session")
    assert me.status_code == 200 and me.json()["user"]["email"] == email
    again = httpx.post(f"{app_url}/api/clubs/{club.slug}/signup", json={"name": "Other", "email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    _err(again, 409, "email_taken")
    for bad in ({"name": "", "email": f"e1-{tag}@paddock.test", "password": PASSWORD},
                {"name": "x" * 81, "email": f"e2-{tag}@paddock.test", "password": PASSWORD},
                {"name": "Short Pw", "email": f"e3-{tag}@paddock.test", "password": "123456789"}):
        body = _err(httpx.post(f"{app_url}/api/clubs/{club.slug}/signup", json=bad, timeout=HTTP_TIMEOUT), 422, "validation")
        assert isinstance(body.get("fields"), dict) and body["fields"]
        assert httpx.post(f"{app_url}/api/session", json={"email": bad["email"], "password": bad["password"]}, timeout=HTTP_TIMEOUT).status_code == 401
    _err(httpx.post(f"{app_url}/api/clubs/no-such-club-{tag}/signup", json={"name": "N", "email": f"n-{tag}@paddock.test", "password": PASSWORD}, timeout=HTTP_TIMEOUT), 404, "not_found")
    assert _signin(app_url, email).user["id"] == user["id"]


def test_signup_conflict_before_validation(app_url: str) -> None:
    club = _onboard(app_url, table=False)
    existing = _driver(club)
    url = f"{app_url}/api/clubs/{club.slug}/signup"
    for bad in ({"name": "", "password": PASSWORD}, {"name": "Taken Email", "password": "short"}):
        _err(httpx.post(url, json={**bad, "email": existing.email}, timeout=HTTP_TIMEOUT), 409, "email_taken")
    assert _signin(app_url, existing.email).user["id"] == existing.user["id"]


def test_event_setup_rules(app_url: str) -> None:
    club = _onboard(app_url)
    chair = club.chair
    tag = _tag()
    good = {"date": FAR_DATE, "venue": "Lot", "registrationCutoff": FAR_CUTOFF, "runsPerDriver": 2, "heats": HEATS, "stations": STATIONS}
    bad_cases = {
        "one heat": {"heats": [{"number": 1, "classes": ["SS", "STR", "GS", "HS"]}]},
        "five heats": {"heats": [{"number": n, "classes": [c]} for n, c in zip(range(1, 6), ["SS", "STR", "GS", "HS", "AS"])]},
        "unknown class": {"heats": [{"number": 1, "classes": ["SS", "QQ"]}, {"number": 2, "classes": ["GS"]}]},
        "class twice": {"heats": [{"number": 1, "classes": ["SS"]}, {"number": 2, "classes": ["SS", "GS"]}]},
        "cutoff at midnight": {"registrationCutoff": f"{FAR_DATE}T00:00"},
        "zero runs": {"runsPerDriver": 0}, "seven runs": {"runsPerDriver": 7},
        "no stations": {"stations": []}, "21 stations": {"stations": [f"S{i}" for i in range(21)]},
        "duplicate stations": {"stations": ["Start", "Start"]}, "long station": {"stations": ["x" * 41]},
        "empty venue": {"venue": ""}, "long name": {"name": "x" * 81},
        "before every table": {"date": "2025-12-31", "registrationCutoff": "2025-12-30T20:00"},
    }
    for label, override in bad_cases.items():
        body = {**good, "name": f"Bad {label} {tag}", **override}
        res = _err(chair.post("/api/events", body), 422, "validation")
        assert isinstance(res.get("fields"), dict), label
    names = [e["name"] for e in chair.get("/api/events").json()["events"]]
    assert not any(n.endswith(tag) for n in names)

    r = chair.post("/api/events", {**good, "name": f"Good {tag}"})
    assert r.status_code == 201
    ev = r.json()["event"]
    assert ev["status"] == "draft" and ev["registrationCutoff"] == FAR_CUTOFF and ev["runsPerDriver"] == 2
    assert [h["classes"] for h in ev["heats"]] == [["SS", "STR"], ["GS", "HS"]] and ev["stations"] == STATIONS
    rota = _rota(chair, ev["id"])
    ids = [s["id"] for h in rota for s in h["stations"]]
    assert len(ids) == len(STATIONS) * 2 and len(set(ids)) == len(ids)

    p = chair.req("PATCH", f"/api/events/{ev['id']}", {"venue": "New Lot", "version": ev["version"]})
    assert p.status_code == 200 and p.json()["event"]["version"] == ev["version"] + 1
    _err(chair.req("PATCH", f"/api/events/{ev['id']}", {"venue": "Stale Lot", "version": ev["version"]}), 412, "stale_version")
    assert _event(chair, ev["id"])["venue"] == "New Lot"
    _err(chair.req("PATCH", f"/api/events/{ev['id']}", {"runsPerDriver": 9, "version": ev["version"] + 1}), 422, "validation")
    _move(chair, ev["id"], "registration_open")
    _err(chair.req("PATCH", f"/api/events/{ev['id']}", {"venue": "Late", "version": ev["version"] + 1}), 409, "event_locked")


def test_wf_event_setup_lifecycle(app_url: str) -> None:
    club = _onboard(app_url)
    chair = club.chair
    eid = _create_event(club)["id"]
    illegal = {
        "draft": ["draft", "registration_closed", "running", "provisional", "final", "published"],
        "registration_open": ["registration_open", "draft", "running", "published"],
        "registration_closed": ["registration_closed", "registration_open", "provisional", "draft"],
        "running": ["running", "final", "draft", "published"],
        "provisional": ["provisional", "running", "draft", "published"],
    }
    path = ["registration_open", "registration_closed", "running", "provisional"]
    status = "draft"
    for nxt in [*path, None]:
        for to in illegal[status]:
            _err(chair.post(f"/api/events/{eid}/transition", {"to": to}), 409, "illegal_transition")
            assert _event(chair, eid)["status"] == status
        if nxt is None:
            break
        ev = _move(chair, eid, nxt)
        assert ev["status"] == nxt
        if nxt == "running":
            assert ev["runningHeat"] == 1
        if nxt == "provisional":
            assert ev["runningHeat"] is None and ev["provisionalAt"] and ev["protestWindowOpen"] is True
        status = nxt


def test_wf_event_setup_happy(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    _load_table(club.chair, MIDSEASON_DATE, {**FACTORS, EXTRA_CLASS: "0.9000"})
    name = f"Setup {_tag()}"
    with _browse(browser, club.chair, "/events", clock=datetime(2101, 1, 1, tzinfo=timezone.utc)) as page:
        opener = _role(page, "button", "New event")
        opener.focus()
        page.keyboard.press("Enter")
        _tick(page)
        dialog = _role(page, "dialog", "New event")
        expect(dialog).to_be_visible()
        first = dialog.get_by_role("textbox", name="Event name", exact=True)
        expect(first).to_be_focused()
        page.keyboard.press("Shift+Tab")
        assert _focus_inside(dialog), "Shift+Tab left the New event dialog"
        page.keyboard.press("Tab")
        expect(first).to_be_focused()
        page.keyboard.press("Escape")
        _tick(page)
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        _tick(page)
        dialog = _role(page, "dialog", "New event")
        fill(dialog.get_by_role("textbox", name="Event name", exact=True), name)
        fill(dialog.get_by_role("textbox", name="Date", exact=True), FAR_DATE)
        fill(dialog.get_by_role("textbox", name="Venue", exact=True), "Setup Lot")
        fill(dialog.get_by_role("textbox", name="Registration cutoff", exact=True), FAR_CUTOFF)
        fill(dialog.get_by_role("spinbutton", name="Runs per driver", exact=True), "2")
        fill(dialog.get_by_role("spinbutton", name="Heats", exact=True), "2")
        extra = dialog.get_by_role("combobox", name=f"Heat for {EXTRA_CLASS}", exact=True)
        expect(extra).to_have_count(0)
        fill(dialog.get_by_role("textbox", name="Date", exact=True), LATER_DATE)
        expect(extra).to_have_count(1)
        fill(dialog.get_by_role("textbox", name="Date", exact=True), FAR_DATE)
        expect(extra).to_have_count(0)
        for cls, heat in (("SS", "Heat 1"), ("STR", "Heat 1"), ("GS", "Heat 2"), ("HS", "Heat 2")):
            select(dialog.get_by_role("combobox", name=f"Heat for {cls}", exact=True), heat)
        fill(dialog.get_by_role("textbox", name="Stations", exact=True), "\n".join(STATIONS))
        saved = False
        for cutoff_text in CUTOFF_FORMATS:
            fill(dialog.get_by_role("textbox", name="Registration cutoff", exact=True), cutoff_text)
            click(dialog.get_by_role("button", name="Save event", exact=True))
            _tick(page)
            try:
                expect(_role(page, "status", "Event updates")).to_contain_text("Event saved as draft.", timeout=FORM_TRY_MS)
                saved = True
                break
            except AssertionError:
                continue
        if not saved:
            pytest.fail("New event dialog never saved the event; expected 'Event saved as draft.'")
        ev = _wait(lambda: next((e for e in club.chair.get("/api/events").json()["events"] if e["name"] == name), None), "the saved event")
        assert ev["status"] == "draft" and ev["date"] == FAR_DATE and ev["registrationCutoff"] == FAR_CUTOFF
        assert [sorted(h["classes"]) for h in ev["heats"]] == [["SS", "STR"], ["GS", "HS"]] and ev["stations"] == STATIONS
        page.goto(f"{app_url}/events/{ev['id']}")
        click(_role(page, "button", "Open registration"))
        _tick(page)
        expect(_role(page, "status", "Event updates")).to_contain_text("Event is now Registration open.")
        expect(page.get_by_text(REG_LINE, exact=True)).to_be_visible()
        rail = _role(page, "navigation", "Heats")
        expect(rail.get_by_role("link", name="Heat 1", exact=True)).to_be_visible()
        expect(rail).to_contain_text("SS, STR")
        expect(rail).to_contain_text("GS, HS")
        expect(rail).to_contain_text("4 stations open")
        page.goto(f"{app_url}/events")
        expect(page.get_by_text(name)).to_be_visible()
        expect(page.get_by_text("Registration open").first).to_be_visible()
    assert _event(club.chair, ev["id"])["status"] == "registration_open"


def test_registration_cutoff(app_url: str) -> None:
    club = _onboard(app_url)
    drv = _driver(club)

    def event_with(minutes: int, floor: bool = False) -> dict:
        ev = _create_event(club)
        now = _local(ev["serverTime"], club.tz)
        cut = now.replace(second=0, microsecond=0) if floor else now + timedelta(minutes=minutes)
        date = (cut + timedelta(days=2)).date().isoformat()
        r = club.chair.req("PATCH", f"/api/events/{ev['id']}", {"date": date, "registrationCutoff": f"{cut:%Y-%m-%dT%H:%M}", "version": ev["version"]})
        assert r.status_code == 200, r.text[:300]
        _move(club.chair, ev["id"], "registration_open")
        out = _event(club.chair, ev["id"])
        utc = cut.replace(second=0, microsecond=0).astimezone(timezone.utc)
        assert _local(out["registrationCutoffUtc"], "UTC").replace(second=0, microsecond=0) == utc
        return out

    open_ev = event_with(180)
    past_ev = event_with(-180)
    at_ev = event_with(0, floor=True)
    assert open_ev["status"] == "registration_open" and open_ev["registrationOpen"] is True
    assert _register(drv, open_ev["id"], "SS", 12)["runHeat"] == 1
    for ev in (past_ev, at_ev):
        assert ev["status"] == "registration_closed" and ev["registrationOpen"] is False
        _err(drv.post(f"/api/events/{ev['id']}/registrations", {"classCode": "SS", "carNumber": 12, "carDescription": "Late"}), 409, "registration_closed")
        regs = club.chair.get(f"/api/events/{ev['id']}/registrations").json()["registrations"]
        assert all(r["driver"]["id"] != drv.user["id"] for r in regs)


def test_wf_driver_registration_race(app_url: str) -> None:
    club = _onboard(app_url)
    ev = _create_event(club)
    eid = ev["id"]
    _move(club.chair, eid, "registration_open")
    a, b, c = _driver(club), _driver(club), _driver(club)
    assert _register(a, eid, "SS", 12)["runHeat"] == 1
    _err(a.post(f"/api/events/{eid}/registrations", {"classCode": "STR", "carNumber": 30, "carDescription": "x"}), 409, "already_registered")
    _err(b.post(f"/api/events/{eid}/registrations", {"classCode": "SS", "carNumber": 12, "carDescription": "x"}), 409, "car_number_taken")
    assert _register(b, eid, "STR", 12)["runHeat"] == 1
    for bad in ({"classCode": "DS", "carNumber": 5, "carDescription": "x"}, {"classCode": "GS", "carNumber": 0, "carDescription": "x"},
                {"classCode": "GS", "carNumber": 1000, "carDescription": "x"}, {"classCode": "GS", "carNumber": 5, "carDescription": ""}):
        _err(c.post(f"/api/events/{eid}/registrations", bad), 422, "validation")
    racers = [_driver(club) for _ in range(6)]
    results = _race([lambda d=d: d.post(f"/api/events/{eid}/registrations", {"classCode": "GS", "carNumber": 31, "carDescription": "Race"}) for d in racers])
    codes = sorted(r.status_code for r in results)
    assert codes == [201] + [409] * 5, codes
    for r in results:
        if r.status_code == 409:
            _err(r, 409, "car_number_taken")
    regs = club.chair.get(f"/api/events/{eid}/registrations").json()["registrations"]
    gs31 = [r for r in regs if r["classCode"] == "GS" and r["carNumber"] == 31]
    assert len(gs31) == 1 and gs31[0]["runHeat"] == 2
    assert not [r for r in regs if r["driver"]["id"] == c.user["id"]]


def test_registration_confirmation_email(app_url: str, mail: Any) -> None:
    club = _onboard(app_url)
    ev = _create_event(club)
    eid = ev["id"]
    _move(club.chair, eid, "registration_open")
    drv = _driver(club)
    reg = _register(drv, eid, "GS", 31)
    subject = f"Registered for {ev['name']}: car 31 GS"
    msgs = _mails(mail, drv.email, subject)
    assert len(msgs) == 1
    body = mail_text(msgs[0])
    assert "Car 31 GS" in body and "Run heat 2" in body
    assert mail_from_address().lower() in [a.lower() for a in addresses(msgs[0].get("From"))]
    _err(drv.post(f"/api/events/{eid}/registrations", {"classCode": "GS", "carNumber": 32, "carDescription": "x"}), 409, "already_registered")
    assert len(_mails(mail, drv.email, minimum=0)) == 1
    assert _wait(lambda: drv.get(f"/api/events/{eid}/registrations").json()["registrations"], "registrations")
    assert any(r["id"] == reg["id"] and r["confirmationEmail"] == "sent" for r in
               _wait(lambda: [r for r in drv.get(f"/api/events/{eid}/registrations").json()["registrations"] if r["confirmationEmail"] == "sent"], "a sent confirmation"))

    late = _driver(club)
    pending = _register(late, eid, "SS", 14, base=_env_url(OUTAGE_URL_ENV["mail"]))
    assert pending["confirmationEmail"] == "pending"


def test_server_registration_status(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    open_ev = _create_event(club)
    _move(club.chair, open_ev["id"], "registration_open")
    closed_ev = _create_event(club, date="2026-01-10", cutoff="2026-01-08T20:00")
    _move(club.chair, closed_ev["id"], "registration_open")
    assert _event(club.chair, closed_ev["id"])["registrationOpen"] is False
    drv = _driver(club)
    with _browse(browser, drv, f"/events/{open_ev['id']}", clock=datetime(2101, 1, 1, tzinfo=timezone.utc)) as page:
        expect(page.get_by_text(REG_LINE, exact=True)).to_be_visible()
        expect(_role(page, "form", "Register car").get_by_role("button", name="Register", exact=True)).to_be_enabled()
    with _browse(browser, drv, f"/events/{closed_ev['id']}", clock=datetime(2025, 6, 1, tzinfo=timezone.utc)) as page:
        expect(page.get_by_text("Registration closed", exact=True).first).to_be_visible()
        expect(page.get_by_text(re.compile(r"^Registration closes "))).to_have_count(0)
        expect(_role(page, "form", "Register car").get_by_role("button", name="Register", exact=True)).to_be_disabled()


def test_overview_rereads_after_refused_register(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    ev = _create_event(club)
    eid = ev["id"]
    _move(club.chair, eid, "registration_open")
    drv = _driver(club)
    with _browse(browser, drv, f"/events/{eid}") as page:
        expect(page.get_by_text(REG_LINE, exact=True)).to_be_visible()
        form = _role(page, "form", "Register car")
        select(form.get_by_role("combobox", name="Class", exact=True), "SS")
        fill(form.get_by_role("textbox", name="Car number", exact=True), "12")
        fill(form.get_by_role("textbox", name="Car description", exact=True), "2019 Chevrolet Corvette")
        _move(club.chair, eid, "registration_closed")
        click(form.get_by_role("button", name="Register", exact=True))
        _tick(page)
        expect(_role(page, "status", "Event updates")).to_contain_text("Registration for this event is closed.")
        _tick(page)
        expect(page.get_by_text(REG_LINE, exact=True)).to_have_count(0)
        expect(page.get_by_text("Registration closed", exact=True).first).to_be_visible()
        expect(_role(page, "form", "Register car").get_by_role("button", name="Register", exact=True)).to_be_disabled()
    assert not [r for r in drv.get(f"/api/events/{eid}/registrations").json()["registrations"] if r["driver"]["id"] == drv.user["id"]]


def test_wf_driver_registration_phone(browser: Browser, app_url: str, mail: Any) -> None:
    club = _onboard(app_url)
    ev = _create_event(club)
    _move(club.chair, ev["id"], "registration_open")
    existing = _driver(club)
    tag = _tag()
    name, email = f"Phone Driver {tag}", f"phone-{tag}@paddock.test"
    with _browse(browser, None, f"/join/{club.slug}", "phone", base=app_url) as page:
        expect(_role(page, "heading", f"Join {club.name}")).to_be_visible()
        fill(_role(page, "textbox", "Full name"), name)
        fill(_role(page, "textbox", "Email"), existing.email)
        fill(_role(page, "textbox", "Password"), PASSWORD)
        tap(_role(page, "button", "Create driver account"))
        _tick(page)
        expect(page.get_by_role("alert")).to_contain_text("That email already has an account.")
        fill(_role(page, "textbox", "Email"), email)
        tap(_role(page, "button", "Create driver account"))
        _tick(page)
        expect(page).to_have_url(re.compile(r"/events$"))
        page.goto(f"{app_url}/events/{ev['id']}")
        form = _role(page, "form", "Register car")
        select(form.get_by_role("combobox", name="Class", exact=True), "SS")
        fill(form.get_by_role("textbox", name="Car number", exact=True), "12")
        fill(form.get_by_role("textbox", name="Car description", exact=True), "2019 Chevrolet Corvette")
        tap(form.get_by_role("button", name="Register", exact=True))
        _tick(page)
        expect(_role(page, "status", "Event updates")).to_contain_text("Registered: car 12 SS, run heat 1.", timeout=UI_SLOW_MS)
    me = _signin(app_url, email)
    assert not {"chair", "timing", "workers"} & set(me.user["roles"])
    regs = [r for r in me.get(f"/api/events/{ev['id']}/registrations").json()["registrations"] if r["driver"]["id"] == me.user["id"]]
    assert len(regs) == 1 and (regs[0]["classCode"], regs[0]["carNumber"], regs[0]["runHeat"]) == ("SS", 12, 1)
    assert len(_mails(mail, email, f"Registered for {ev['name']}: car 12 SS")) == 1


def test_waiver_check_in(app_url: str) -> None:
    club = _onboard(app_url)
    built = _build(club, [("Waiver Driver", "SS", 12, "2019 Chevrolet Corvette", ()), ("Other Driver", "STR", 7, "Other", ())], check_in=False, start=False)
    drv, other = built.drivers["Waiver Driver"], built.drivers["Other Driver"]
    rid = built.regs["Waiver Driver"]["id"]
    _err(drv.post(f"/api/registrations/{rid}/check-in", {"signature": drv.name}), 409, "check_in_closed")
    _move(club.chair, built.eid, "registration_closed")
    key = f"clubs/{club.slug}/events/{built.eid}/waivers/{rid}.pdf"
    body = _err(drv.post(f"/api/registrations/{rid}/check-in", {"signature": "Someone Else"}), 422, "validation")
    assert "signature" in body["fields"]
    assert S3().keys(key) == []
    _err(drv.get(f"/api/registrations/{rid}/waiver.pdf"), 404, "not_found")
    r = drv.post(f"/api/registrations/{rid}/check-in", {"signature": f"  {drv.name.upper()}  "})
    assert r.status_code == 201
    reg = r.json()["registration"]
    assert reg["checkedIn"] is True and reg["checkedInAt"].endswith("Z")
    assert reg["waiver"]["key"] == key
    stored = S3().get(key)
    assert reg["waiver"]["checksum"] == _sha(stored)
    words = pdf_text(stored)
    for needle in ("Event waiver", club.name, built.event["name"], drv.name, "Signed by", "12", "SS"):
        assert needle.lower() in words.lower(), needle
    pdf = drv.get(f"/api/registrations/{rid}/waiver.pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf") and pdf.content == stored
    assert club.chair.get(f"/api/registrations/{rid}/waiver.pdf").status_code == 200
    _err(other.get(f"/api/registrations/{rid}/waiver.pdf"), 403, "forbidden")
    _err(drv.post(f"/api/registrations/{rid}/check-in", {"signature": drv.name}), 409, "already_checked_in")


@pytest.mark.parametrize("outage", ["renderer", "storage"], ids=["renderer", "storage"])
def test_wf_check_in_waiver_outage(browser: Browser, app_url: str, outage: str) -> None:
    code, copy = {
        "renderer": ("renderer_unavailable", "Waiver signing is unavailable right now. Check in at the registration table."),
        "storage": ("storage_unavailable", "We could not save your signed waiver. You are not checked in yet; try again shortly."),
    }[outage]
    down = _env_url(OUTAGE_URL_ENV[outage])
    club = _onboard(app_url)
    built = _build(club, [("Outage Driver", "SS", 12, "Outage car", ())], check_in=False, start=False)
    _move(club.chair, built.eid, "registration_closed")
    drv, rid = built.drivers["Outage Driver"], built.regs["Outage Driver"]["id"]
    key = f"clubs/{club.slug}/events/{built.eid}/waivers/{rid}.pdf"
    _err(drv.post(f"/api/registrations/{rid}/check-in", {"signature": drv.name}, base=down), 503, code)
    with _browse(browser, drv, f"/events/{built.eid}", "phone", base=down) as page:
        tap(_role(page, "button", "Check in"))
        _tick(page)
        dialog = _role(page, "dialog", "Check in and sign waiver")
        fill(dialog.get_by_role("textbox", name="Type your full name to sign", exact=True), drv.name)
        tap(dialog.get_by_role("button", name="Sign and check in", exact=True))
        _tick(page)
        expect(_role(page, "status", "Event updates")).to_contain_text(copy, timeout=UI_SLOW_MS)
    reg = next(r for r in drv.get(f"/api/events/{built.eid}/registrations").json()["registrations"] if r["id"] == rid)
    assert reg["checkedIn"] is False and reg["waiver"] is None
    assert S3().keys(key) == []
    assert _check_in(drv, rid)["checkedIn"] is True


def test_wf_check_in_waiver_phone(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    built = _build(club, [("Tap Driver", "SS", 12, "Tap car", ())], check_in=False, start=False)
    _move(club.chair, built.eid, "registration_closed")
    drv, rid = built.drivers["Tap Driver"], built.regs["Tap Driver"]["id"]
    with _browse(browser, drv, f"/events/{built.eid}", "phone") as page:
        tap(_role(page, "button", "Check in"))
        _tick(page)
        dialog = _role(page, "dialog", "Check in and sign waiver")
        field = dialog.get_by_role("textbox", name="Type your full name to sign", exact=True)
        expect(field).to_be_focused()
        fill(field, "Not My Name")
        tap(dialog.get_by_role("button", name="Sign and check in", exact=True))
        _tick(page)
        summary = page.get_by_role("alert").filter(has_text="Fix these fields")
        link = summary.get_by_role("link", name="Type your name exactly as registered.", exact=True)
        expect(link).to_be_visible()
        click(link)
        expect(field).to_be_focused()
        fill(field, drv.name)
        tap(dialog.get_by_role("button", name="Sign and check in", exact=True))
        _tick(page)
        expect(_role(page, "status", "Event updates")).to_contain_text("Checked in. Your signed waiver is saved.", timeout=UI_SLOW_MS)
    reg = next(r for r in drv.get(f"/api/events/{built.eid}/registrations").json()["registrations"] if r["id"] == rid)
    assert reg["checkedIn"] is True
    assert _sha(S3().get(f"clubs/{club.slug}/events/{built.eid}/waivers/{rid}.pdf")) == reg["waiver"]["checksum"]


def test_station_claim_rules(app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Rule A", "SS", 12, "a", ()), ("Rule B", "GS", 31, "b", ()), ("Rule C", "SS", 14, "c", ())]
    built = _build(club, entries, check_in=False, start=False)
    a, b, c = (built.drivers[n] for n in ("Rule A", "Rule B", "Rule C"))
    outsider = _driver(club)
    rota = _rota(club.chair, built.eid)
    s = {(h, n): _station(rota, h, n)["id"] for h in (1, 2) for n in STATIONS}
    _err(outsider.post(f"/api/stations/{s[(2, 'Start')]}/claim", {}), 409, "not_registered")
    _err(a.post(f"/api/stations/{s[(1, 'Start')]}/claim", {}), 409, "own_heat")
    r = a.post(f"/api/stations/{s[(2, 'Start')]}/claim", {})
    assert r.status_code == 201 and r.json()["registration"]["station"]["name"] == "Start" and r.json()["registration"]["station"]["heat"] == 2
    _err(a.post(f"/api/stations/{s[(2, 'Finish')]}/claim", {}), 409, "already_assigned")
    _err(a.post(f"/api/stations/{s[(1, 'Finish')]}/claim", {}), 409, "already_assigned")
    _err(c.post(f"/api/stations/{s[(2, 'Start')]}/claim", {}), 409, "station_taken")
    assert b.post(f"/api/stations/{s[(1, 'Start')]}/claim", {}).status_code == 201
    c_rid = built.regs["Rule C"]["id"]
    _err(club.chair.post(f"/api/stations/{s[(1, 'Corner 1')]}/assign", {"registrationId": c_rid}), 409, "own_heat")
    assert club.chair.post(f"/api/stations/{s[(2, 'Finish')]}/assign", {"registrationId": c_rid}).status_code == 201
    _err(c.delete(f"/api/stations/{s[(2, 'Start')]}/claim"), 403, "forbidden")
    assert a.delete(f"/api/stations/{s[(2, 'Start')]}/claim").status_code == 204
    _err(club.chair.delete(f"/api/stations/{s[(2, 'Start')]}/claim"), 409, "station_open")
    rota = _rota(club.chair, built.eid)
    assert _station(rota, 2, "Start")["worker"] is None
    assert _station(rota, 1, "Start")["worker"]["registrationId"] == built.regs["Rule B"]["id"]
    _move(club.chair, built.eid, "registration_closed", "running", "provisional")
    _err(a.post(f"/api/stations/{s[(2, 'Corner 2')]}/claim", {}), 409, "rota_locked")
    _err(b.delete(f"/api/stations/{s[(1, 'Start')]}/claim"), 409, "rota_locked")
    assert _station(_rota(club.chair, built.eid), 2, "Corner 2")["worker"] is None


def test_assign_locked_before_validation(app_url: str) -> None:
    club = _onboard(app_url)
    built = _build(club, [("Lock A", "SS", 12, "a", ())], check_in=False, start=False)
    sid = _station(_rota(club.chair, built.eid), 2, "Start")["id"]
    _move(club.chair, built.eid, "registration_closed", "running", "provisional")
    for body in ({}, {"registrationId": ""}):
        _err(club.chair.post(f"/api/stations/{sid}/assign", body), 409, "rota_locked")
    assert _station(_rota(club.chair, built.eid), 2, "Start")["worker"] is None


def test_wf_work_rota_race(app_url: str) -> None:
    club = _onboard(app_url)
    entries = [(f"Racer {i}", "SS", 20 + i, f"Racer car {i}", ()) for i in range(6)]
    built = _build(club, entries, check_in=False, start=False)
    sid = _station(_rota(club.chair, built.eid), 2, "Start")["id"]
    results = _race([lambda d=d: d.post(f"/api/stations/{sid}/claim", {}) for d in built.drivers.values()])
    assert sorted(r.status_code for r in results) == [201] + [409] * 5
    winner = next(r for r in results if r.status_code == 201).json()["registration"]["id"]
    for r in results:
        if r.status_code == 409:
            _err(r, 409, "station_taken")
    rota = _rota(club.chair, built.eid)
    assert _station(rota, 2, "Start")["worker"]["registrationId"] == winner
    holders = [s for h in rota for s in h["stations"] if s["worker"]]
    assert len(holders) == 1 and _unfilled(rota, 2) == len(STATIONS) - 1


def test_unfilled_counters(app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Count A", "SS", 12, "a", ()), ("Count B", "GS", 31, "b", ()), ("Count C", "STR", 7, "c", ())]
    built = _build(club, entries, check_in=False, start=False)
    a, b = built.drivers["Count A"], built.drivers["Count B"]

    def check(h1: int, h2: int) -> list:
        rota = _rota(club.chair, built.eid)
        for heat, expected in ((1, h1), (2, h2)):
            open_now = sum(1 for h in rota if h["number"] == heat for s in h["stations"] if s["worker"] is None)
            assert _unfilled(rota, heat) == open_now == expected, (heat, expected, rota)
        return rota

    rota = check(4, 4)
    assert a.post(f"/api/stations/{_station(rota, 2, 'Start')['id']}/claim", {}).status_code == 201
    check(4, 3)
    assert b.post(f"/api/stations/{_station(rota, 1, 'Start')['id']}/claim", {}).status_code == 201
    check(3, 3)
    r = club.chair.post(f"/api/stations/{_station(rota, 2, 'Finish')['id']}/assign", {"registrationId": built.regs["Count C"]["id"]})
    assert r.status_code == 201
    check(3, 2)
    assert a.delete(f"/api/stations/{_station(rota, 2, 'Start')['id']}/claim").status_code == 204
    check(3, 3)
    assert b.delete(f"/api/registrations/{built.regs['Count B']['id']}").status_code == 204
    check(4, 3)


def test_work_assignment_email(app_url: str, mail: Any) -> None:
    club = _onboard(app_url)
    entries = [("Mail A", "SS", 12, "a", ()), ("Mail B", "STR", 7, "b", ()), ("Mail C", "SS", 14, "c", ())]
    built = _build(club, entries, check_in=False, start=False)
    name = built.event["name"]
    a, b, c = (built.drivers[n] for n in ("Mail A", "Mail B", "Mail C"))
    rota = _rota(club.chair, built.eid)
    assert a.post(f"/api/stations/{_station(rota, 2, 'Corner 1')['id']}/claim", {}).status_code == 201
    msg = _mails(mail, a.email, f"Work assignment for {name}: Corner 1, heat 2")
    assert len(msg) == 1 and "Corner 1" in mail_text(msg[0])
    r = club.chair.post(f"/api/stations/{_station(rota, 2, 'Finish')['id']}/assign", {"registrationId": built.regs["Mail B"]["id"]})
    assert r.status_code == 201
    assert len(_mails(mail, b.email, f"Work assignment for {name}: Finish, heat 2")) == 1
    _err(c.post(f"/api/stations/{_station(rota, 1, 'Start')['id']}/claim", {}), 409, "own_heat")
    assert [m for m in _mails(mail, c.email, minimum=0) if m.get("Subject", "").startswith("Work assignment")] == []
    down = _env_url(OUTAGE_URL_ENV["mail"])
    r = c.post(f"/api/stations/{_station(rota, 2, 'Corner 2')['id']}/claim", {}, base=down)
    assert r.status_code == 201
    assert _station(_rota(club.chair, built.eid), 2, "Corner 2")["worker"]["registrationId"] == built.regs["Mail C"]["id"]


def test_withdrawal(app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Leave A", "SS", 12, "a", ()), ("Leave B", "STR", 7, "b", ())]
    built = _build(club, entries, check_in=False, start=False)
    a, b = built.drivers["Leave A"], built.drivers["Leave B"]
    rid = built.regs["Leave A"]["id"]
    sid = _station(_rota(club.chair, built.eid), 2, "Start")["id"]
    assert a.post(f"/api/stations/{sid}/claim", {}).status_code == 201
    _err(b.delete(f"/api/registrations/{rid}"), 403, "forbidden")
    assert a.delete(f"/api/registrations/{rid}").status_code == 204
    regs = club.chair.get(f"/api/events/{built.eid}/registrations").json()["registrations"]
    assert all(r["id"] != rid for r in regs)
    assert _station(_rota(club.chair, built.eid), 2, "Start")["worker"] is None
    newcomer = _driver(club)
    assert _register(newcomer, built.eid, "SS", 12)["carNumber"] == 12
    back = _register(a, built.eid, "SS", 15)
    _move(club.chair, built.eid, "registration_closed", "running")
    _err(a.delete(f"/api/registrations/{back['id']}"), 409, "withdrawal_closed")
    assert any(r["id"] == back["id"] for r in club.chair.get(f"/api/events/{built.eid}/registrations").json()["registrations"])


def test_wf_work_rota_assign(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Avery Lindqvist", "SS", 12, "2019 Chevrolet Corvette", ()), ("Cass Ferreira", "GS", 31, "2017 Volkswagen GTI", ()),
               ("Bo Tanaka-Reyes", "STR", 7, "2020 Mazda MX-5 RF", ())]
    built = _build(club, entries, check_in=False, start=False)
    with _browse(browser, club.chair, f"/events/{built.eid}/rota") as page:
        expect(_role(page, "heading", "Heat 2: 4 stations open")).to_be_visible()
        page.evaluate("window.__paddockMarker = 1")
        opener = _role(page, "button", "Assign Start, heat 2")
        click(opener)
        _tick(page)
        dialog = _role(page, "dialog", "Assign worker")
        select(dialog.get_by_role("combobox", name="Driver", exact=True), "Avery Lindqvist, car 12 SS")
        with held(page, "**/api/stations/*/assign") as gate:
            click(dialog.get_by_role("button", name="Assign", exact=True))
            expect(dialog.get_by_role("button", name="Assign", exact=True)).to_be_disabled()
            gate.release()
        _tick(page)
        updates = _role(page, "status", "Rota updates")
        expect(updates).to_contain_text("Avery Lindqvist is working Start in heat 2.")
        expect(_role(page, "heading", "Heat 2: 3 stations open")).to_be_visible()
        expect(page.get_by_text("Avery Lindqvist").first).to_be_visible()
        sid = _station(_rota(club.chair, built.eid), 2, "Finish")["id"]
        assert built.drivers["Bo Tanaka-Reyes"].post(f"/api/stations/{sid}/claim", {}).status_code == 201
        until(page, "document.body.innerText.includes('Heat 2: 2 stations open')", seconds=LIVE_MAX_MS / 1000)
        expect(page.get_by_text("Bo Tanaka-Reyes").first).to_be_visible()
        click(_role(page, "button", "Release Start, heat 2"))
        _tick(page)
        expect(updates).to_contain_text("Start in heat 2 is open again.")
        expect(_role(page, "heading", "Heat 2: 3 stations open")).to_be_visible()
        assert page.evaluate("window.__paddockMarker") == 1, "rota screen reloaded"
    rota = _rota(club.chair, built.eid)
    assert _station(rota, 2, "Start")["worker"] is None and _unfilled(rota, 2) == 3
    assert _station(rota, 2, "Finish")["worker"]["registrationId"] == built.regs["Bo Tanaka-Reyes"]["id"]


def test_run_commit_guards(app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Guard SS", "SS", 12, "a", ()), ("Guard GS", "GS", 31, "b", ())]
    built = _build(club, entries, runs=3, check_in=False, start=False)
    chair = club.chair
    ss, gs = built.regs["Guard SS"]["id"], built.regs["Guard GS"]["id"]
    good = {"outcome": "time", "rawTime": "51.907", "cones": 0}
    _move(chair, built.eid, "registration_closed")
    _err(chair.post(f"/api/registrations/{ss}/runs/1", good), 409, "event_not_running")
    _move(chair, built.eid, "running")
    _err(chair.post(f"/api/registrations/{gs}/runs/1", good), 409, "heat_not_running")
    _err(chair.post(f"/api/registrations/{ss}/runs/1", good), 409, "not_checked_in")
    _check_in(built.drivers["Guard SS"], ss)
    _err(chair.post(f"/api/registrations/{ss}/runs/4", good), 404, "not_found")
    for bad in ({"outcome": "time", "rawTime": "9.999", "cones": 0}, {"outcome": "time", "rawTime": "1000.000", "cones": 0},
                {"outcome": "time", "rawTime": "51.9", "cones": 0}, {"outcome": "time", "rawTime": "51.907", "cones": 31},
                {"outcome": "time", "rawTime": "51.907", "cones": -1}, {"outcome": "late"}):
        _err(chair.post(f"/api/registrations/{ss}/runs/1", bad), 422, "validation")
    assert _run_of(chair, built.eid, 1, 12, "SS", 1)["status"] == "pending"
    edge = chair.post(f"/api/registrations/{ss}/runs/1", {"outcome": "time", "rawTime": "10.000", "cones": 30})
    assert edge.status_code == 201
    run = edge.json()["run"]
    assert (run["status"], run["outcome"], run["rawTime"], run["cones"]) == ("committed", "time", "10.000", 30)
    _err(chair.post(f"/api/registrations/{ss}/runs/1", good), 409, "run_already_committed")
    dnf = _commit(chair, ss, 2, "DNF")["run"]
    assert (dnf["status"], dnf["outcome"], dnf["adjustedTime"], dnf["indexedTime"]) == ("committed", "dnf", None, None)
    rerun = chair.post(f"/api/registrations/{ss}/runs/3", {"outcome": "rerun"}).json()["run"]
    assert rerun["status"] == "rerun_granted" and rerun["rawTime"] is None
    again = _commit(chair, ss, 3, ("999.999", 0))["run"]
    assert again["status"] == "committed" and again["rawTime"] == "999.999"
    entries_now = _runs(chair, built.eid, 1)
    assert [r["runNumber"] for r in entries_now[0]["runs"]] == [1, 2, 3]
    _err(chair.get(f"/api/events/{built.eid}/runs?heat=9"), 422, "validation")


def test_indexed_time(app_url: str) -> None:
    club = _onboard(app_url)
    _load_table(club.chair, MIDSEASON_DATE, {**FACTORS, "SS": HALF_UP_FACTOR})
    early = _build(club, [("Early SS", "SS", 12, "a", ())])
    late = _build(club, [("Late SS", "SS", 12, "b", ())], date=LATER_DATE, cutoff=LATER_CUTOFF)
    r1 = _commit(club.chair, early.regs["Early SS"]["id"], 1, ("51.907", 0))["run"]
    assert (r1["rawTime"], r1["adjustedTime"], r1["indexedTime"], r1["factor"]) == ("51.907", "51.907", "42.927", "0.8270")
    r2 = _commit(club.chair, early.regs["Early SS"]["id"], 2, ("52.418", 1))["run"]
    assert (r2["adjustedTime"], r2["indexedTime"]) == ("54.418", "45.004")
    r3 = _commit(club.chair, late.regs["Late SS"]["id"], 1, ("38.006", 1))["run"]
    assert (r3["adjustedTime"], r3["indexedTime"], r3["factor"]) == (HALF_UP_ADJUSTED, HALF_UP_INDEXED, HALF_UP_FACTOR)
    stored = _run_of(club.chair, early.eid, 1, 12, "SS", 1)
    assert (stored["adjustedTime"], stored["indexedTime"], stored["factor"]) == ("51.907", "42.927", "0.8270")


def test_wf_timing_entry_replay(app_url: str) -> None:
    club = _onboard(app_url)
    built = _build(club, [("Replay SS", "SS", 12, "a", ())])
    rid = built.regs["Replay SS"]["id"]
    key = f"replay-{_tag()}"
    body = {"outcome": "time", "rawTime": "51.907", "cones": 0}
    first = club.chair.post(f"/api/registrations/{rid}/runs/1", body, headers={"Idempotency-Key": key})
    assert first.status_code == 201
    second = club.chair.post(f"/api/registrations/{rid}/runs/1", body, headers={"Idempotency-Key": key})
    assert second.status_code == 201 and second.headers.get("Idempotent-Replayed") == "true"
    assert second.json() == first.json()
    _err(club.chair.post(f"/api/registrations/{rid}/runs/1", {**body, "cones": 1}, headers={"Idempotency-Key": key}), 409, "idempotency_key_reused")
    runs = _runs(club.chair, built.eid, 1)[0]["runs"]
    assert [r["status"] for r in runs] == ["committed", "pending"] and runs[0]["cones"] == 0
    _err(club.chair.post(f"/api/registrations/{rid}/runs/1", body), 409, "run_already_committed")


def test_wf_timing_entry_grid_keys(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    built = _build(club, [("Grid A", "SS", 12, "a", ()), ("Grid B", "SS", 14, "b", ())])
    chair = club.chair
    with _browse(browser, chair, f"/events/{built.eid}/timing") as page:
        grid = _role(page, "grid", "Run grid")
        expect(_tc(page, 12, "SS", 1)).to_be_visible()
        _role(page, "combobox", "Running heat").focus()
        page.keyboard.press("Alt+KeyG")
        expect(_tc(page, 12, "SS", 1)).to_be_focused()
        for key, cell in (("ArrowRight", _cc(page, 12, "SS", 1)), ("ArrowDown", _cc(page, 14, "SS", 1)),
                          ("ArrowUp", _cc(page, 12, "SS", 1)), ("ArrowLeft", _tc(page, 12, "SS", 1)), ("End", _cc(page, 12, "SS", 2))):
            page.keyboard.press(key)
            expect(cell).to_be_focused()
        page.keyboard.press("Home")
        assert _focus_inside(grid)
        for _ in range(4):
            if _tc(page, 12, "SS", 1).evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("ArrowRight")
        expect(_tc(page, 12, "SS", 1)).to_be_focused()
        news = _role(page, "status", "Timing announcements")
        page.keyboard.type("60.000")
        page.keyboard.press("Escape")
        page.keyboard.press("Enter")
        expect(news).to_contain_text("Type a time, D for DNF or R for rerun.")
        page.keyboard.type("45")
        page.keyboard.press("Enter")
        expect(news).to_contain_text("Run time must look like 45.123.")
        assert _run_of(chair, built.eid, 1, 12, "SS", 1)["status"] == "pending"
        page.keyboard.press("Escape")
        page.keyboard.type("51.907")
        page.keyboard.press("ArrowRight")
        page.keyboard.type("2")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        expect(_tc(page, 14, "SS", 1)).to_be_focused()
        run = _run_of(chair, built.eid, 1, 12, "SS", 1)
        assert (run["status"], run["rawTime"], run["cones"]) == ("committed", "51.907", 2)
        page.keyboard.press("d")
        page.keyboard.press("Enter")
        _wait(lambda: _run_of(chair, built.eid, 1, 14, "SS", 1)["outcome"] == "dnf", "keyboard DNF to be committed", MAIL_WAIT_S)
        _role(page, "button", "Sign out").focus()
        page.keyboard.press("Alt+KeyG")
        expect(_tc(page, 12, "SS", 2)).to_be_focused()
        page.keyboard.press("R")
        page.keyboard.press("Enter")
        _wait(lambda: _run_of(chair, built.eid, 1, 12, "SS", 2)["status"] == "rerun_granted", "keyboard rerun", MAIL_WAIT_S)
        _tc(page, 12, "SS", 2).click()
        expect(_tc(page, 12, "SS", 2)).to_be_focused()
        page.keyboard.type("50.500")
        page.keyboard.press("Enter")
        _wait(lambda: _run_of(chair, built.eid, 1, 12, "SS", 2)["rawTime"] == "50.500", "rerun slot recommitted", MAIL_WAIT_S)


def test_timing_announcements(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Avery Lindqvist", "SS", 12, "a", ()), ("Ann SS", "SS", 14, "b", ()), ("Bo Tanaka-Reyes", "STR", 7, "c", ()), ("Late STR", "STR", 8, "d", ())]
    built = _build(club, entries, check_in={"Avery Lindqvist", "Ann SS", "Bo Tanaka-Reyes"})
    with _browse(browser, club.chair, f"/events/{built.eid}/timing") as page:
        news = _role(page, "status", "Timing announcements")
        assert news.get_attribute("aria-live") in (None, "polite"), "announcement region must be polite"
        _role(page, "combobox", "Running heat").focus()
        page.keyboard.press("Alt+KeyG")
        expect(_tc(page, 12, "SS", 1)).to_be_focused()
        steps = [
            (_tc(page, 12, "SS", 1), "51.907", "Car 12 SS: indexed 42.927, P1 in SS, P1 overall"),
            (_tc(page, 14, "SS", 1), "r", "Car 14 SS: rerun granted for run 1"),
            (_tc(page, 14, "SS", 1), "d", "Car 14 SS: DNF, no time yet"),
            (_tc(page, 7, "STR", 1), "53.211", "Car 7 STR: indexed 44.112, P1 in STR, P2 overall"),
            (_tc(page, 12, "SS", 2), "d", "Car 12 SS: DNF, P1 in SS, P1 overall"),
            (_tc(page, 8, "STR", 1), "55.000", "Car 8 is not checked in."),
        ]
        for cell, keys, sentence in steps:
            click(cell)
            expect(cell).to_be_focused()
            page.keyboard.type(keys)
            page.keyboard.press("Enter")
            expect(news).to_contain_text(sentence)
    assert _run_of(club.chair, built.eid, 1, 8, "STR", 1)["status"] == "pending"
    assert _run_of(club.chair, built.eid, 1, 14, "SS", 1)["outcome"] == "dnf"


def test_running_heat_and_strip(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    built = _build(club, [("Strip A", "SS", 12, "a", ())], check_in=False)
    idle = _build(club, [("Strip B", "SS", 12, "b", ())], check_in=False, start=False)
    _err(club.chair.post(f"/api/events/{idle.eid}/running-heat", {"heat": 1}), 409, "event_not_running")
    _err(club.chair.post(f"/api/events/{built.eid}/running-heat", {"heat": 3}), 422, "validation")
    with _browse(browser, club.chair, f"/events/{built.eid}") as page:
        expect(_role(page, "status", "Live heat")).to_have_text("Heat 1 running")
        _set_heat(club.chair, built.eid, 2)
        page.reload()
        expect(_role(page, "status", "Live heat")).to_have_text("Heat 2 running")
        page.goto(f"{app_url}/events/{built.eid}/timing")
        select(_role(page, "combobox", "Running heat"), "Heat 1")
        _tick(page)
        _wait(lambda: _event(club.chair, built.eid)["runningHeat"] == 1, "the Running heat combobox to apply at once", MAIL_WAIT_S)
        page.goto(f"{app_url}/events/{idle.eid}")
        expect(_role(page, "heading", idle.event["name"])).to_be_visible()
        expect(_role(page, "status", "Live heat")).to_have_count(0)
        _move(club.chair, built.eid, "provisional")
        page.goto(f"{app_url}/events/{built.eid}")
        expect(_role(page, "heading", built.event["name"])).to_be_visible()
        expect(_role(page, "status", "Live heat")).to_have_count(0)


def test_wf_timing_entry_keyboard(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Avery Lindqvist", "SS", 12, "a", ()), ("Ann SS", "SS", 14, "b", ()), ("Bo Tanaka-Reyes", "STR", 7, "c", ())]
    built = _build(club, entries)
    plan = {1: [(12, "SS", "52.418", "1"), (14, "SS", CAR14_RAW, "0"), (7, "STR", "53.211", "0")],
            2: [(12, "SS", "51.907", "0"), (14, "SS", "D", ""), (7, "STR", "D", "")]}
    with _browse(browser, club.chair, f"/events/{built.eid}/timing") as page:
        expect(_tc(page, 12, "SS", 1)).to_be_visible()
        for k, rows in plan.items():
            _role(page, "combobox", "Running heat").focus()
            page.keyboard.press("Alt+KeyG")
            for i, (car, cls, raw, cones) in enumerate(rows):
                expect(_tc(page, car, cls, k)).to_be_focused()
                page.keyboard.type(raw)
                if cones:
                    page.keyboard.press("ArrowRight")
                    page.keyboard.type(cones)
                page.keyboard.press("Enter")
                if i + 1 < len(rows):
                    nxt = rows[i + 1]
                    expect(_tc(page, nxt[0], nxt[1], k)).to_be_focused()
        _wait(lambda: all(r["status"] == "committed" for e in _runs(club.chair, built.eid, 1) for r in e["runs"]), "all six runs recorded", MAIL_WAIT_S)
        rows = {r["carNumber"]: r for r in _standings(club.chair, built.eid)}
        assert rows[12]["bestIndexed"] == "42.927" and rows[7]["bestIndexed"] == "44.112" and rows[14]["bestAdjusted"] == CAR14_RAW
        page.goto(f"{app_url}/events/{built.eid}/live")
        table = _role(page, "table", "Live standings")
        for value in ("42.927", "44.112", rows[14]["bestIndexed"]):
            expect(table).to_contain_text(value)
        page.goto(f"{app_url}/events/{built.eid}/timing")
        select(_role(page, "combobox", "Running heat"), "Heat 2")
        _tick(page)
        _wait(lambda: _event(club.chair, built.eid)["runningHeat"] == 2, "heat 2 to be running", MAIL_WAIT_S)


def test_standings(app_url: str) -> None:
    club = _onboard(app_url)
    entries = [*[(n, c, car, d, ()) for n, c, car, d, _ in POINTS7], ("Tie Driver", "SS", 99, "t", ()),
               ("Dnf Driver", "GS", 40, "x", ()), ("Idle Driver", "STR", 8, "y", ())]
    built = _build(club, entries, check_in={e[0] for e in entries if e[0] != "Idle Driver"})
    ch, reg = club.chair, built.regs

    def rc(name: str, k: int, run: Any) -> dict:
        return _commit(ch, reg[name]["id"], k, run)["rankChange"]

    assert rc("Avery Lindqvist", 1, ("52.418", 1)) == {"indexed": "New P1", "class": "New P1", "raw": "New P1"}
    assert rc("Bo Tanaka-Reyes", 1, ("53.211", 0)) == {"indexed": "New P1", "class": "New P1", "raw": "New P1"}
    avery = next(r for r in _standings(ch, built.eid) if r["carNumber"] == 12 and r["classCode"] == "SS")
    assert avery["lastChange"]["rankChange"]["indexed"] == "New P1" and avery["position"] == 2
    assert rc("Avery Lindqvist", 2, ("51.907", 0)) == {"indexed": "Up 1 to P1", "class": "Holds P1", "raw": "Up 1 to P1"}
    assert rc("Bo Tanaka-Reyes", 2, "DNF") == {"indexed": "Holds P2", "class": "Holds P1", "raw": "Holds P2"}
    assert rc("Tie Driver", 1, ("51.907", 0)) == {"indexed": "New P2", "class": "New P2", "raw": "New P2"}
    _set_heat(ch, built.eid, 2)
    for k, run in enumerate(POINTS7[2][4], 1):
        rc("Cass Ferreira", k, run)
    for k, run in enumerate(POINTS7[3][4], 1):
        rc("Del Mbeki", k, run)
    assert rc("Dnf Driver", 1, "DNF") == {"indexed": "No time", "class": "No time", "raw": "No time"}

    def key(r: dict) -> tuple:
        return (r["carNumber"], r["classCode"])

    ind = _standings(ch, built.eid, "indexed")
    assert [key(r) for r in ind] == [(12, "SS"), (99, "SS"), (31, "GS"), (7, "STR"), (4, "HS"), (40, "GS"), (8, "STR")]
    assert [r["position"] for r in ind] == [1, 2, 3, 4, 5, None, None]
    by = {key(r): r for r in ind}
    assert [(by[k]["bestAdjusted"], by[k]["bestIndexed"]) for k in [(12, "SS"), (7, "STR"), (31, "GS"), (4, "HS")]] == \
        [("51.907", "42.927"), ("53.211", "44.112"), ("55.120", "43.710"), ("58.402", "45.787")]
    assert by[(40, "GS")]["bestIndexed"] is None and by[(8, "STR")]["lastChange"] is None
    assert [by[k]["classPosition"] for k in [(12, "SS"), (99, "SS"), (7, "STR"), (31, "GS"), (4, "HS")]] == [1, 2, 1, 1, 1]
    assert by[(12, "SS")]["lastChange"]["rankChange"] == {"indexed": "Up 1 to P1", "class": "Holds P1", "raw": "Up 1 to P1"}
    assert by[(31, "GS")]["lastChange"]["rankChange"] == {"indexed": "Up 1 to P3", "class": "Holds P1", "raw": "Holds P4"}
    raw = _standings(ch, built.eid, "raw")
    assert [key(r) for r in raw] == [(12, "SS"), (99, "SS"), (7, "STR"), (31, "GS"), (4, "HS"), (40, "GS"), (8, "STR")]
    cls = [key(r) for r in _standings(ch, built.eid, "class") if r["classPosition"] is not None]
    assert cls == [(31, "GS"), (4, "HS"), (12, "SS"), (99, "SS"), (7, "STR")]
    assert [key(r) for r in _standings(ch, built.eid, "indexed", "SS")] == [(12, "SS"), (99, "SS")]
    _err(ch.get(f"/api/events/{built.eid}/standings?view=fastest"), 422, "validation")


def _live_setup(app_url: str, fillers: int = 0) -> tuple[Club, Built]:
    club = _onboard(app_url)
    entries = [("Avery Lindqvist", "SS", 12, "2019 Chevrolet Corvette", (("51.907", 0),)),
               ("Bo Tanaka-Reyes", "STR", 7, "2020 Mazda MX-5 RF", (("53.211", 0),))]
    entries += [(f"Filler {i}", "SS", 40 + i, f"Filler car {i}", ()) for i in range(fillers)]
    built = _build(club, entries, check_in={"Avery Lindqvist", "Bo Tanaka-Reyes"})
    _time_runs(built, entries)
    return club, built


def test_live_in_place(browser: Browser, app_url: str) -> None:
    club, built = _live_setup(app_url, fillers=12)
    with _browse(browser, club.chair, f"/events/{built.eid}/live") as page:
        click(_role(page, "tab", "Class"))
        select(_role(page, "combobox", "Class filter"), "SS")
        _tick(page)
        expect(_role(page, "button", "Runs for car 7 STR")).to_have_count(0)
        page.evaluate("window.__paddockMarker = 1")
        page.evaluate("window.scrollTo(0, 150)")
        before = page.evaluate("window.scrollY")
        body = _commit(club.chair, built.regs["Avery Lindqvist"]["id"], 2, ("50.500", 0))
        indexed, badge = body["run"]["indexedTime"], body["rankChange"]["class"]
        until(page, f"document.body.innerText.includes('{indexed}')", seconds=(LIVE_MAX_MS + SETTLE_BASE_MS) / 1000)
        row = page.get_by_role("row").filter(has=_role(page, "button", "Runs for car 12 SS"))
        expect(row).to_contain_text(badge)
        expect(_role(page, "status", "Standings updates")).to_contain_text(f"Car 12 SS: {badge}")
        expect(page.get_by_role("tab", name="Class", exact=True, selected=True)).to_be_visible()
        expect(_role(page, "button", "Runs for car 7 STR")).to_have_count(0)
        assert page.evaluate("window.__paddockMarker") == 1, "live page reloaded"
        assert abs(page.evaluate("window.scrollY") - before) <= 1


def test_cone_to_rank_settle(browser: Browser, app_url: str) -> None:
    club, built = _live_setup(app_url)
    with _browse(browser, club.chair, f"/events/{built.eid}/live") as page:
        click(_role(page, "tab", "Indexed"))
        bo = page.get_by_role("row").filter(has=_role(page, "button", "Runs for car 7 STR"))
        av = page.get_by_role("row").filter(has=_role(page, "button", "Runs for car 12 SS"))
        expect(bo).to_be_visible()
        y_bo, y_av = _box(bo)["y"], _box(av)["y"]
        assert y_av < y_bo
        body = _commit(club.chair, built.regs["Bo Tanaka-Reyes"]["id"], 2, ("49.000", 1))
        badge, indexed = body["rankChange"]["indexed"], body["run"]["indexedTime"]
        assert badge == "Up 1 to P1"
        until(page, "document.body.innerText.includes('+2.000')", seconds=(LIVE_MAX_MS + SETTLE_BASE_MS) / 1000)
        path = motion(bo, SETTLE_BASE_MS + SETTLE_PER_CONE_MS)
        ys = [_y(s) for s in path]
        assert any(y_av + 1 < y < y_bo - 1 for y in ys), f"row never passed between its slots: {ys}"
        assert all(b <= a + 1 for a, b in zip(ys, ys[1:])), f"row did not move steadily upward: {ys}"
        assert abs(ys[-1] - y_av) <= 2
        expect(bo).to_contain_text(badge)
        expect(bo).to_contain_text(indexed)
        assert abs(_box(av)["y"] - y_bo) <= 2
        expect(_role(page, "status", "Standings updates")).to_contain_text(f"Car 7 STR: {badge}")
    assert [r["carNumber"] for r in _standings(club.chair, built.eid)] == [7, 12]


def test_wf_live_results_reduced_motion(browser: Browser, app_url: str) -> None:
    club, built = _live_setup(app_url)
    with _browse(browser, club.chair, f"/events/{built.eid}/live", "phone", reduced_motion="reduce") as page:
        click(_role(page, "tab", "Indexed"))
        bo_btn, av_btn = _role(page, "button", "Runs for car 7 STR"), _role(page, "button", "Runs for car 12 SS")
        expect(bo_btn).to_be_visible()
        body = _commit(club.chair, built.regs["Bo Tanaka-Reyes"]["id"], 2, ("47.000", 2))
        badge, indexed = body["rankChange"]["indexed"], body["run"]["indexedTime"]
        until(page, f"document.body.innerText.includes('{indexed}')", seconds=LIVE_MAX_MS / 1000)
        card = _role(page, "list", "Live standings").get_by_role("listitem").filter(has=bo_btn)
        assert not animations(card), "reduced motion still animates the card"
        expect(card).to_contain_text("2 cones")
        expect(card).to_contain_text(badge)
        assert _box(bo_btn)["y"] < _box(av_btn)["y"]
        expect(_role(page, "status", "Standings updates")).to_contain_text(f"Car 7 STR: {badge}")


def test_wf_cross_cutting_layouts(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    built = _build(club, [(f"Lay {i}", "SS", i, f"Layout car {i}", ()) for i in (1, 2, 3, 4)], check_in=False, start=False)
    eid = built.eid
    routes = ["/events", f"/events/{eid}", f"/events/{eid}/live", f"/events/{eid}/rota", f"/events/{eid}/timing",
              f"/events/{eid}/corrections", "/index-tables", "/season"]
    with _browse(browser, club.chair, f"/events/{eid}/live", "phone") as page:
        for size in ("phone", "tablet", "desktop"):
            w, h = VIEWPORTS[size]
            page.set_viewport_size({"width": w, "height": h})
            page.goto(f"{app_url}/events/{eid}/live")
            btns = [_role(page, "button", f"Runs for car {i} SS") for i in (1, 2, 3, 4)]
            expect(btns[0]).to_be_visible()
            if size == "desktop":
                table = _role(page, "table", "Live standings")
                expect(table).to_be_visible()
                expect(_role(page, "list", "Live standings")).to_have_count(0)
                for col in ("Pos", "Car", "Class", "Driver", "Car description", "Best adjusted", "Best indexed", "Change", "Runs"):
                    expect(table.get_by_role("columnheader", name=col, exact=True)).to_be_visible()
                expect(_role(page, "navigation", "Heats")).to_be_visible()
                expect(_role(page, "combobox", "Heat")).to_have_count(0)
            else:
                expect(_role(page, "list", "Live standings")).to_be_visible()
                expect(_role(page, "table", "Live standings")).to_have_count(0)
                boxes = [_box(b) for b in btns]
                if size == "phone":
                    assert all(abs(b["x"] - boxes[0]["x"]) <= 2 for b in boxes)
                    assert all(boxes[i]["y"] < boxes[i + 1]["y"] for i in range(3))
                else:
                    assert abs(boxes[0]["y"] - boxes[1]["y"]) <= 2 and boxes[0]["x"] < boxes[1]["x"]
                    assert boxes[2]["y"] > boxes[0]["y"] and abs(boxes[2]["x"] - boxes[0]["x"]) <= 2
                    assert abs(boxes[3]["y"] - boxes[2]["y"]) <= 2
                    cards = _role(page, "list", "Live standings").get_by_role("listitem")
                    c1, c2 = _box(cards.filter(has=btns[0])), _box(cards.filter(has=btns[1]))
                    assert abs(c1["width"] - c2["width"]) <= 2
                heat = _role(page, "combobox", "Heat")
                select(heat, "Heat 2")
                expect(page.get_by_text("GS, HS", exact=True)).to_be_visible()
            for route in routes:
                page.goto(f"{app_url}{route}")
                expect(_role(page, "button", "Sign out")).to_be_visible()
                layout(page)


def test_runs_button_touch(browser: Browser, app_url: str) -> None:
    club, built = _live_setup(app_url)
    with _browse(browser, club.chair, f"/events/{built.eid}/live", "phone") as page:
        click(_role(page, "tab", "Indexed"))
        for name in ("Runs for car 12 SS", "Runs for car 7 STR"):
            box = _box(_role(page, "button", name))
            assert box["width"] >= TOUCH_MIN_PX and box["height"] >= TOUCH_MIN_PX, (name, box)
        tap(_role(page, "button", "Runs for car 12 SS"))
        _tick(page)
        expect(page.get_by_role("button", name="Runs for car 12 SS", exact=True, expanded=True)).to_be_visible()
        card = _role(page, "list", "Live standings").get_by_role("listitem").filter(has=_role(page, "button", "Runs for car 12 SS"))
        expect(card).to_contain_text("51.907")
        tap(_role(page, "button", "Runs for car 12 SS"))
        _tick(page)
        expect(page.get_by_role("button", name="Runs for car 12 SS", exact=True, expanded=False)).to_be_visible()


def test_wf_live_results_paddock(browser: Browser, app_url: str) -> None:
    club, built = _live_setup(app_url, fillers=10)
    avery = built.drivers["Avery Lindqvist"]
    with open_app(browser, f"{app_url}/signin") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        _ui_signin(page, app_url, avery.email)
        expect(page).to_have_url(re.compile(r"/events$"))
        page.goto(f"{app_url}/events/{built.eid}/live")
        click(_role(page, "tab", "Indexed"))
        select(_role(page, "combobox", "Class filter"), "SS")
        _tick(page)
        expect(_role(page, "button", "Runs for car 7 STR")).to_have_count(0)
        xs = [_box(_role(page, "button", f"Runs for car {c} SS"))["x"] for c in (12, 40, 41, 42)]
        assert max(xs) - min(xs) <= 2, "phone layout is not one column"
        page.evaluate("window.__paddockMarker = 1")
        page.evaluate("window.scrollTo(0, 300)")
        before = page.evaluate("window.scrollY")
        assert before > 0, "live list does not scroll on a phone"
        body = _commit(club.chair, built.regs["Avery Lindqvist"]["id"], 2, ("50.900", 0))
        indexed, badge = body["run"]["indexedTime"], body["rankChange"]["indexed"]
        until(page, f"document.body.innerText.includes('{indexed}')", seconds=(LIVE_MAX_MS + SETTLE_BASE_MS) / 1000)
        card = _role(page, "list", "Live standings").get_by_role("listitem").filter(has=_role(page, "button", "Runs for car 12 SS"))
        expect(card).to_contain_text(badge)
        expect(_role(page, "button", "Runs for car 7 STR")).to_have_count(0)
        assert page.evaluate("window.__paddockMarker") == 1 and abs(page.evaluate("window.scrollY") - before) <= 1
    row = next(r for r in _standings(avery, built.eid) if r["carNumber"] == 12)
    assert row["bestIndexed"] == indexed and row["lastChange"]["rankChange"]["indexed"] == badge


def test_wf_live_results_phone_views(browser: Browser, app_url: str) -> None:
    club, built = _live_setup(app_url)
    row = next(r for r in _standings(club.chair, built.eid) if r["carNumber"] == 12)
    adjusted, indexed = row["bestAdjusted"], row["bestIndexed"]
    assert adjusted != indexed
    with _browse(browser, club.chair, f"/events/{built.eid}/live", "phone") as page:
        runs = _role(page, "button", "Runs for car 12 SS")
        expect(runs).to_be_visible()
        click(_role(page, "tab", "Indexed"))
        _tick(page)
        card = _role(page, "list", "Live standings").get_by_role("listitem").filter(has=runs)
        expect(card).to_contain_text(indexed, use_inner_text=True)
        for tab in ("Raw", "Class"):
            click(_role(page, "tab", tab))
            _tick(page)
            expect(page.get_by_role("tab", name=tab, exact=True, selected=True)).to_be_visible()
            expect(runs).to_have_attribute("aria-expanded", "false")
            expect(card).to_contain_text(adjusted, use_inner_text=True)


@pytest.mark.timeout(900)
def test_run_corrections() -> None:
    base = _short()
    club = _onboard(base)
    entries = [("Fix SS", "SS", 12, "a", (("52.418", 1),))]
    built = _build(club, entries)
    _time_runs(built, entries)
    ch = club.chair
    run1 = _run_of(ch, built.eid, 1, 12, "SS", 1)
    run2 = _run_of(ch, built.eid, 1, 12, "SS", 2)
    url = f"/api/runs/{run1['id']}/corrections"
    _err(ch.post(url, {"outcome": "time", "rawTime": "51.907", "cones": 0}), 422, "validation")
    _err(ch.post(url, {"outcome": "time", "rawTime": "51.907", "cones": 0, "reason": "abcd"}), 422, "validation")
    _err(ch.post(url, {"outcome": "time", "rawTime": "52.418", "cones": 1, "reason": "No change at all"}), 422, "validation")
    _err(ch.post(f"/api/runs/{run2['id']}/corrections", {"outcome": "dnf", "cones": 0, "reason": "Pending run edit"}), 409, "run_not_committed")
    assert ch.get(f"/api/events/{built.eid}/corrections").json()["corrections"] == []
    r = ch.post(url, {"outcome": "time", "rawTime": "51.907", "cones": 0, "reason": "Cone call reversed"})
    assert r.status_code == 201
    run = r.json()["run"]
    assert (run["status"], run["adjustedTime"], run["indexedTime"], run["factor"]) == ("corrected", "51.907", "42.927", "0.8270")
    r = ch.post(url, {"outcome": "dnf", "cones": 0, "reason": "Off course at corner"})
    assert r.status_code == 201 and r.json()["run"]["status"] == "corrected" and r.json()["run"]["indexedTime"] is None
    _finalise(ch, built.eid)
    _err(ch.post(url, {"outcome": "time", "rawTime": "50.000", "cones": 0, "reason": "Too late now"}), 409, "results_locked")
    _err(ch.post(f"/api/runs/{run2['id']}/corrections", {"outcome": "dnf", "cones": 0, "reason": "Too late now"}), 409, "results_locked")
    assert len(ch.get(f"/api/events/{built.eid}/corrections").json()["corrections"]) == 2


def test_wf_corrections_audit_log(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Avery Lindqvist", "SS", 12, "a", (("52.418", 1),)), ("Bo Tanaka-Reyes", "STR", 7, "b", (("53.211", 0),))]
    built = _build(club, entries)
    _time_runs(built, entries)
    ch = club.chair
    av = _run_of(ch, built.eid, 1, 12, "SS", 1)
    bo = _run_of(ch, built.eid, 1, 7, "STR", 1)
    assert ch.post(f"/api/runs/{av['id']}/corrections", {"outcome": "time", "rawTime": "51.907", "cones": 0, "reason": "Missed timing beam"}).status_code == 201
    assert ch.post(f"/api/runs/{av['id']}/corrections", {"outcome": "dnf", "cones": 0, "reason": "Off course late"}).status_code == 201
    assert ch.post(f"/api/runs/{bo['id']}/corrections", {"outcome": "time", "rawTime": "53.211", "cones": 1, "reason": "Cone reported"}).status_code == 201
    rid = built.regs["Avery Lindqvist"]["id"]
    log = ch.get(f"/api/events/{built.eid}/corrections?registrationId={rid}").json()["corrections"]
    assert [c["reason"] for c in log] == ["Off course late", "Missed timing beam"]
    first = log[1]
    assert first["actor"]["name"] == ch.name and first["at"].endswith("Z") and first["runNumber"] == 1
    assert (first["before"]["rawTime"], first["before"]["cones"], first["before"]["indexedTime"]) == ("52.418", 1, "45.004")
    assert (first["after"]["rawTime"], first["after"]["cones"], first["after"]["indexedTime"]) == ("51.907", 0, "42.927")
    assert log[0]["before"]["rawTime"] == "51.907" and log[0]["after"]["outcome"] == "dnf"
    full = ch.get(f"/api/events/{built.eid}/corrections").json()
    drv = built.drivers["Bo Tanaka-Reyes"]
    for actor in (ch, drv):
        for method in ("PUT", "PATCH", "DELETE"):
            _err(actor.req(method, f"/api/corrections/{first['id']}", {"reason": "rewrite"} if method != "DELETE" else _NO), 405, "audit_immutable")
    _err(httpx.request("DELETE", f"{app_url}/api/corrections/{first['id']}", timeout=HTTP_TIMEOUT), 401, "unauthenticated")
    _err(ch.req("DELETE", "/api/corrections/999999999"), 404, "not_found")
    assert ch.get(f"/api/events/{built.eid}/corrections").json() == full
    when = _local(first["at"], club.tz)
    with _browse(browser, drv, f"/events/{built.eid}/corrections") as page:
        table = _role(page, "table", "Correction log")
        for col in ("Time", "Car", "Run", "Before", "After", "By", "Reason"):
            expect(table.get_by_role("columnheader", name=col, exact=True)).to_be_visible()
        row = table.get_by_role("row").filter(has_text="Missed timing beam")
        for value in (f"{when:%Y-%m-%d %H:%M}", "12 SS", "52.418 +1", "51.907 +0", ch.name):
            expect(row).to_contain_text(value)
        expect(table.get_by_role("row").filter(has_text="Off course late")).to_contain_text("DNF")
        expect(table.get_by_role("button")).to_have_count(0)


def test_wf_corrections_audit_dialog(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Avery Lindqvist", "SS", 12, "a", (("52.418", 1),))]
    built = _build(club, entries)
    _time_runs(built, entries)
    with _browse(browser, club.chair, f"/events/{built.eid}/timing") as page:
        _role(page, "combobox", "Running heat").focus()
        page.keyboard.press("Alt+KeyG")
        expect(_tc(page, 12, "SS", 2)).to_be_focused()
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        cell = _tc(page, 12, "SS", 1)
        expect(cell).to_be_focused()
        page.keyboard.press("Enter")
        _tick(page)
        dialog = _role(page, "dialog", "Correct run")
        expect(dialog.get_by_role("heading", name=f"Correct car {entries[0][2]} {entries[0][1]} run 1", exact=True)).to_be_visible()
        assert _focus_inside(dialog)
        expect(dialog.get_by_role("textbox", name="Raw time", exact=True)).to_have_value("52.418")
        expect(dialog.get_by_role("spinbutton", name="Cones", exact=True)).to_have_value("1")
        for key in ["Tab"] * 10 + ["Shift+Tab"] * 10:
            page.keyboard.press(key)
            assert _focus_inside(dialog), f"{key} left the Correct run dialog"
        page.keyboard.press("Escape")
        _tick(page)
        expect(dialog).to_have_count(0)
        expect(cell).to_be_focused()
        assert _run_of(club.chair, built.eid, 1, 12, "SS", 1)["status"] == "committed"
        page.keyboard.press("Enter")
        _tick(page)
        dialog = _role(page, "dialog", "Correct run")
        fill(dialog.get_by_role("textbox", name="Raw time", exact=True), "51.907")
        fill(dialog.get_by_role("spinbutton", name="Cones", exact=True), "0")
        reason = dialog.get_by_role("textbox", name="Reason", exact=True)
        fill(reason, "abc")
        click(dialog.get_by_role("button", name="Save correction", exact=True))
        _tick(page)
        link = page.get_by_role("alert").filter(has_text="Fix these fields").get_by_role("link", name="Give a reason of at least 5 characters.", exact=True)
        click(link)
        expect(reason).to_be_focused()
        fill(reason, "Missed timing beam")
        click(dialog.get_by_role("button", name="Save correction", exact=True))
        _tick(page)
        expect(_role(page, "status", "Timing announcements")).to_contain_text(
            f"Car {entries[0][2]} {entries[0][1]} run 1 corrected: indexed 42.927, P1 in {entries[0][1]}, P1 overall")
        expect(_role(page, "dialog", "Correct run")).to_have_count(0)
        expect(cell).to_be_focused()
        page.keyboard.press("Enter")
        _tick(page)
        dialog = _role(page, "dialog", "Correct run")
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), "Nothing changed here")
        click(dialog.get_by_role("button", name="Save correction", exact=True))
        _tick(page)
        expect(dialog).to_contain_text("The correction must change the time, cones or outcome.")
        click(dialog.get_by_role("button", name="Cancel", exact=True))
        _tick(page)
        expect(cell).to_be_focused()
    log = club.chair.get(f"/api/events/{built.eid}/corrections").json()["corrections"]
    assert [c["reason"] for c in log] == ["Missed timing beam"]


@pytest.mark.timeout(900)
def test_wf_protests_finalize_window(app_url: str) -> None:
    club = _onboard(app_url)
    eid = _create_event(club)["id"]
    ev = _move(club.chair, eid, "registration_open", "registration_closed", "running", "provisional")
    span = _local(ev["protestWindowClosesAt"], "UTC") - _local(ev["provisionalAt"], "UTC")
    assert span == timedelta(seconds=WINDOW_DEFAULT_S) and ev["protestWindowOpen"] is True
    _err(club.chair.post(f"/api/events/{eid}/transition", {"to": "final"}), 409, "protest_window_open")
    assert _event(club.chair, eid)["status"] == "provisional"

    short = _onboard(_short())
    sid = _create_event(short)["id"]
    ev = _move(short.chair, sid, "registration_open", "registration_closed", "running", "provisional")
    assert ev["protestWindowOpen"] is True
    _err(short.chair.post(f"/api/events/{sid}/transition", {"to": "final"}), 409, "protest_window_open")
    _window_closed(short.chair, sid)
    assert _move(short.chair, sid, "final")["status"] == "final"


@pytest.mark.timeout(1200)
def test_protests(copies: Callable[[str], str]) -> None:
    base = copies("window60")
    club = _onboard(base)
    entries = [("Avery Lindqvist", "SS", 12, "a", ()), ("Bo Tanaka-Reyes", "STR", 7, "b", ())]
    built = _build(club, entries, check_in=False)
    other = _build(club, [("Elsewhere", "SS", 3, "c", ())], check_in=False, start=False)
    bo, outsider = built.drivers["Bo Tanaka-Reyes"], _driver(club)
    subject = built.regs["Avery Lindqvist"]["id"]
    url = f"/api/events/{built.eid}/protests"
    text = "Car 12 hit a cone at corner 2 on run one."
    _err(bo.post(url, {"registrationId": subject, "text": text}), 409, "protest_window_closed")
    _move(club.chair, built.eid, "provisional")
    first = bo.post(url, {"registrationId": subject, "text": text})
    assert first.status_code == 201 and first.json()["protest"]["status"] == "pending"
    second = bo.post(url, {"registrationId": subject, "text": text + " Again."})
    assert second.status_code == 201
    _err(outsider.post(url, {"registrationId": subject, "text": text}), 409, "not_registered")
    _err(bo.post(url, {"registrationId": subject, "text": "too short"}), 422, "validation")
    _err(bo.post(url, {"registrationId": other.regs["Elsewhere"]["id"], "text": text}), 422, "validation")
    p1, p2 = first.json()["protest"]["id"], second.json()["protest"]["id"]
    _err(bo.post(f"/api/protests/{p1}/decision", {"decision": "upheld", "note": "Self decided"}), 403, "forbidden")
    _err(club.chair.post(f"/api/protests/{p1}/decision", {"decision": "upheld", "note": "abc"}), 422, "validation")
    d = club.chair.post(f"/api/protests/{p1}/decision", {"decision": "upheld", "note": "Video confirms cone"})
    assert d.status_code == 200 and d.json()["protest"]["status"] == "upheld"
    _err(club.chair.post(f"/api/protests/{p1}/decision", {"decision": "denied", "note": "Changed my mind"}), 409, "protest_decided")
    _window_closed(club.chair, built.eid)
    _err(bo.post(url, {"registrationId": subject, "text": text}), 409, "protest_window_closed")
    _err(club.chair.post(f"/api/events/{built.eid}/transition", {"to": "final"}), 409, "protests_pending")
    assert club.chair.post(f"/api/protests/{p2}/decision", {"decision": "denied", "note": "Duplicate protest"}).status_code == 200
    assert _move(club.chair, built.eid, "final")["status"] == "final"
    _err(club.chair.post(f"/api/protests/{p1}/decision", {"decision": "denied", "note": "After final"}), 409, "results_locked")
    protests = club.chair.get(url).json()["protests"]
    assert sorted(p["status"] for p in protests) == ["denied", "upheld"]


def test_protest_form_field_errors(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Avery Lindqvist", "SS", 12, "a", (("52.418", 1),)), ("Bo Tanaka-Reyes", "STR", 7, "b", (("53.211", 0),))]
    built = _build(club, entries)
    _time_runs(built, entries)
    _move(club.chair, built.eid, "provisional")
    with _browse(browser, built.drivers["Bo Tanaka-Reyes"], f"/events/{built.eid}/protests") as page:
        click(_role(page, "button", "File a protest"))
        _tick(page)
        dialog = _role(page, "dialog", "File a protest")
        select(dialog.get_by_role("combobox", name="Car protested", exact=True), "Car 12 SS, Avery Lindqvist")
        details = dialog.get_by_role("textbox", name="Protest details", exact=True)
        fill(details, "Too short")
        click(dialog.get_by_role("button", name="File protest", exact=True))
        _tick(page)
        summary = page.get_by_role("alert").filter(has_text="Fix these fields")
        expect(summary).to_be_visible()
        links = summary.get_by_role("link")
        expect(links).to_have_count(1)
        click(links.first)
        _tick(page)
        expect(details).to_be_focused()
    assert club.chair.get(f"/api/events/{built.eid}/protests").json()["protests"] == []


@pytest.mark.timeout(900)
def test_protest_window_on_screen(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    eid = _create_event(club)["id"]
    ev = _move(club.chair, eid, "registration_open", "registration_closed", "running", "provisional")
    until_text = f"Protest window open until {_local(ev['protestWindowClosesAt'], club.tz):%H:%M}"
    with _browse(browser, club.chair, f"/events/{eid}", clock=datetime(2101, 1, 1, tzinfo=timezone.utc)) as page:
        expect(page.get_by_text(until_text, exact=True)).to_be_visible()
        expect(_role(page, "button", "Set results final")).to_be_disabled()
        page.goto(f"{app_url}/events/{eid}/protests")
        expect(page.get_by_text(until_text, exact=True)).to_be_visible()
    short = _onboard(_short())
    sid = _create_event(short)["id"]
    _move(short.chair, sid, "registration_open", "registration_closed", "running", "provisional")
    _window_closed(short.chair, sid)
    with _browse(browser, short.chair, f"/events/{sid}", clock=datetime(2020, 1, 1, tzinfo=timezone.utc)) as page:
        expect(page.get_by_text("Protest window closed", exact=True)).to_be_visible()
        expect(_role(page, "button", "Set results final")).to_be_enabled()
        page.goto(f"{short.base}/events/{sid}/protests")
        expect(page.get_by_text("Protest window closed", exact=True)).to_be_visible()


@pytest.mark.timeout(1200)
def test_wf_protests_finalize_decision(browser: Browser, copies: Callable[[str], str]) -> None:
    base = copies("window60")
    club = _onboard(base)
    entries = [("Avery Lindqvist", "SS", 12, "a", (("52.418", 1),)), ("Bo Tanaka-Reyes", "STR", 7, "b", (("53.211", 0),))]
    built = _build(club, entries)
    _time_runs(built, entries)
    run = _run_of(club.chair, built.eid, 1, 12, "SS", 1)
    corr = club.chair.post(f"/api/runs/{run['id']}/corrections", {"outcome": "time", "rawTime": "51.907", "cones": 0, "reason": "Cone call reversed"})
    assert corr.status_code == 201
    hhmm = f"{_local(corr.json()['correction']['at'], club.tz):%H:%M}"
    _move(club.chair, built.eid, "provisional")
    with _browse(browser, built.drivers["Bo Tanaka-Reyes"], f"/events/{built.eid}/protests") as page:
        click(_role(page, "button", "File a protest"))
        _tick(page)
        dialog = _role(page, "dialog", "File a protest")
        select(dialog.get_by_role("combobox", name="Car protested", exact=True), "Car 12 SS, Avery Lindqvist")
        fill(dialog.get_by_role("textbox", name="Protest details", exact=True), "The cone at corner two was clearly down.")
        click(dialog.get_by_role("button", name="File protest", exact=True))
        _tick(page)
        expect(_role(page, "status", "Protest updates")).to_contain_text("Protest filed against car 12 SS.")
    with _browse(browser, club.chair, f"/events/{built.eid}/protests") as page:
        region = _role(page, "region", "Protest against car 12 SS")
        items = region.get_by_role("list", name=f"Corrections for car {entries[0][2]} {entries[0][1]}", exact=True).get_by_role("listitem")
        expect(items).to_have_text([f"Run 1: 52.418 +1 to 51.907 +0 by {club.chair.name} at {hhmm}, reason: Cone call reversed"])
        fill(region.get_by_role("textbox", name="Decision note", exact=True), DECISION_NOTE)
        click(region.get_by_role("button", name="Deny", exact=True))
        _tick(page)
        expect(_role(page, "status", "Protest updates")).to_contain_text("Protest denied.")
        protest = club.chair.get(f"/api/events/{built.eid}/protests").json()["protests"][0]
        assert protest["status"] == "denied" and protest["decisionNote"] == DECISION_NOTE
        _window_closed(club.chair, built.eid)
        page.goto(f"{base}/events/{built.eid}")
        final = _role(page, "button", "Set results final")
        expect(final).to_be_enabled()
        click(final)
        _tick(page)
        expect(_role(page, "status", "Event updates")).to_contain_text("Event is now Final.")
    assert _event(club.chair, built.eid)["status"] == "final"


@pytest.mark.timeout(900)
def test_publish_pipeline(mail: Any) -> None:
    base = _short()
    entries = [*POINTS7, ("Harper Quill", "SS", 20, "Spare car", ())]
    club = _onboard(base)
    draft = _create_event(club)
    built = _build(club, entries, check_in={e[0] for e in POINTS7})
    _time_runs(built, entries)
    _finalise(club.chair, built.eid)
    _err(club.chair.get(f"/api/events/{built.eid}/results.pdf"), 404, "not_published")
    _err(club.chair.post(f"/api/events/{draft['id']}/publish", {}), 409, "not_final")
    r = club.chair.post(f"/api/events/{built.eid}/publish", {})
    assert r.status_code == 200
    ev, pub = r.json()["event"], r.json()["publication"]
    assert ev["status"] == "published" and ev["publishedAt"].endswith("Z")
    key = f"clubs/{club.slug}/events/{built.eid}/results/final.pdf"
    stored = S3("-short").get(key)
    assert ev["resultsChecksum"] == pub["checksum"] == _sha(stored) and pub["pdfKey"] == key
    assert pub["emailsAccepted"] == pub["emailsTotal"] == 4
    dl = built.drivers["Avery Lindqvist"].get(f"/api/events/{built.eid}/results.pdf")
    assert dl.status_code == 200 and dl.headers["content-type"].startswith("application/pdf") and dl.content == stored
    subject = f"Final results: {ev['name']}"
    for (name, *_), pos in zip(POINTS7, ("P1", "P3", "P2", "P4")):
        msgs = _mails(mail, built.drivers[name].email, subject)
        assert len(msgs) == 1
        body = mail_text(msgs[0])
        assert f"/api/events/{built.eid}/results.pdf" in body and f"Your indexed finish: {pos}" in body
    assert _mails(mail, built.drivers["Harper Quill"].email, subject, minimum=0) == []
    _err(club.chair.post(f"/api/events/{built.eid}/publish", {}), 409, "already_published")
    assert len(_mails(mail, built.drivers["Avery Lindqvist"].email, subject, minimum=0)) == 1


@pytest.mark.timeout(1500)
@pytest.mark.parametrize("outage", ["renderer", "storage", "mail"], ids=["renderer", "storage", "mail"])
def test_wf_publish_results_outage(copies: Callable[[str], str], mail: Any, outage: str) -> None:
    base = _short()
    entries = POINTS7[:2]
    club = _onboard(base)
    built = _build(club, entries)
    _time_runs(built, entries)
    _finalise(club.chair, built.eid)
    down = copies(outage)
    _err(club.chair.post(f"/api/events/{built.eid}/publish", {}, base=down), 503, f"{outage}_unavailable")
    ev = _event(club.chair, built.eid)
    assert ev["status"] == "final" and ev["publishedAt"] is None
    _err(club.chair.get(f"/api/events/{built.eid}/results.pdf"), 404, "not_published")
    subject = f"Final results: {ev['name']}"
    for name, *_ in entries:
        assert _mails(mail, built.drivers[name].email, subject, minimum=0) == []
    key = f"clubs/{club.slug}/events/{built.eid}/results/final.pdf"
    prefix = f"clubs/{club.slug}/events/{built.eid}/results/"
    stored_before = S3("-short").keys(prefix)
    assert stored_before == ([key] if outage == "mail" else [])
    first_hash = _sha(S3("-short").get(key)) if outage == "mail" else None
    r = club.chair.post(f"/api/events/{built.eid}/publish", {})
    assert r.status_code == 200 and r.json()["event"]["status"] == "published"
    assert S3("-short").keys(prefix) == [key]
    digest = _sha(S3("-short").get(key))
    assert r.json()["event"]["resultsChecksum"] == digest and (first_hash is None or first_hash == digest)
    for name, *_ in entries:
        assert len(_mails(mail, built.drivers[name].email, subject)) == 1
    assert club.chair.get(f"/api/events/{built.eid}/results.pdf").status_code == 200


def test_renderer_outage_banner(browser: Browser, app_url: str) -> None:
    copy = "Results PDF renderer is offline. Publishing is paused and drivers have not been emailed."
    chair = _signin(app_url, RIDGE_CHAIR)
    p7 = next(e for e in chair.get("/api/events").json()["events"] if e["name"] == POINTS7_NAME)
    assert p7["status"] == "final"
    down = _env_url(OUTAGE_URL_ENV["renderer"])
    assert chair.get(f"/api/events/{p7['id']}/publication", base=down).json()["renderer"] == "unavailable"
    with _browse(browser, chair, f"/events/{p7['id']}/publish", base=down) as page:
        expect(_role(page, "heading", "Publish final results")).to_be_visible()
        expect(page.get_by_role("alert").filter(has_text=copy)).to_have_text(copy)
        expect(_role(page, "button", "Publish final results")).to_be_disabled()
    assert chair.get(f"/api/events/{p7['id']}/publication").json()["renderer"] == "ok"
    with _browse(browser, chair, f"/events/{p7['id']}/publish") as page:
        expect(_role(page, "button", "Publish final results")).to_be_enabled()
        expect(page.get_by_text(copy)).to_have_count(0)
    assert _event(chair, p7["id"])["status"] == "final"


@pytest.mark.timeout(900)
def test_results_pdf() -> None:
    entries = [*POINTS7, ("Harper Quill", "SS", 20, "Spare car", ())]
    club, built = _published(_short(), entries, check_in={e[0] for e in POINTS7})
    data = S3("-short").get(f"clubs/{club.slug}/events/{built.eid}/results/final.pdf")
    assert pdf_pages(data) >= 3
    pages = pdf_text(data).split("\f")
    header = f"{built.event['name']} final results"
    for p in pages:
        if p.strip():
            assert header in p

    def start(title: str, after: int) -> int:
        for i in range(after, len(pages)):
            if any(line.strip() == title for line in pages[i].splitlines()):
                return i
        pytest.fail(f"no {title} section after page {after}")

    r = start("Raw", 0)
    c = start("Class", r + 1)
    i = start("Indexed", c + 1)
    raw, cls, idx = "\n".join(pages[r:c]), "\n".join(pages[c:i]), "\n".join(pages[i:])

    def order(textblock: str, names: list) -> list:
        return [textblock.index(n) for n in names]

    assert order(raw, ["Avery Lindqvist", "Bo Tanaka-Reyes", "Cass Ferreira", "Del Mbeki"]) == sorted(order(raw, ["Avery Lindqvist", "Bo Tanaka-Reyes", "Cass Ferreira", "Del Mbeki"]))
    assert order(idx, ["Avery Lindqvist", "Cass Ferreira", "Bo Tanaka-Reyes", "Del Mbeki"]) == sorted(order(idx, ["Avery Lindqvist", "Cass Ferreira", "Bo Tanaka-Reyes", "Del Mbeki"]))
    for block, values in ((raw, ["51.907", "53.211", "55.120", "58.402"]), (cls, ["51.907", "53.211", "55.120", "58.402"]),
                          (idx, ["42.927", "43.710", "44.112", "45.787", "0.8270", "0.8290", "0.7930", "0.7840"])):
        for v in values:
            assert v in block, v
        for name, *_ in entries:
            assert name in block, name
        assert "No time" in block


@pytest.mark.timeout(900)
def test_wf_publish_results_happy(browser: Browser, mail: Any) -> None:
    base = _short()
    entries = POINTS7[:2]
    club = _onboard(base)
    built = _build(club, entries)
    _time_runs(built, entries)
    _finalise(club.chair, built.eid)
    with _browse(browser, club.chair, f"/events/{built.eid}/publish") as page:
        button = _role(page, "button", "Publish final results")
        expect(button).to_be_enabled()
        progress = _role(page, "status", "Publish progress")
        with held(page, "**/api/events/*/publish") as gate:
            click(button)
            expect(progress).to_contain_text("Publishing final results")
            expect(button).to_be_disabled()
            assert _event(club.chair, built.eid)["status"] == "final"
            gate.release()
        _tick(page)
        expect(progress).to_contain_text("Final results published.", timeout=UI_SLOW_MS)
        ev = _event(club.chair, built.eid)
        assert ev["status"] == "published"
        stored = S3("-short").get(f"clubs/{club.slug}/events/{built.eid}/results/final.pdf")
        expect(page.get_by_text(f"Published at {_local(ev['publishedAt'], club.tz):%Y-%m-%d %H:%M}")).to_be_visible()
        expect(page.get_by_text(f"Checksum {_sha(stored)}")).to_be_visible()
        href = _role(page, "link", "Download results PDF").get_attribute("href")
        assert href
        got = page.request.get(href if href.startswith("http") else f"{base}{href}")
        assert got.status == 200 and got.body() == stored
    for name, *_ in entries:
        assert len(_mails(mail, built.drivers[name].email, f"Final results: {ev['name']}")) == 1


def test_wf_index_tables_rejections(app_url: str) -> None:
    club = _onboard(app_url)
    entries = [("Table SS", "SS", 12, "a", (("51.907", 0),))]
    built = _build(club, entries)
    _time_runs(built, entries)
    _create_event(club, date="2099-08-20", cutoff="2099-08-18T20:00")
    no_hs = {k: v for k, v in FACTORS.items() if k != "HS"}
    ch = club.chair
    _err(ch.post("/api/index-tables", {"effectiveDate": TABLE_DATE, "factors": FACTORS}), 409, "effective_date_taken")
    _err(ch.post("/api/index-tables", {"effectiveDate": "2099-01-01", "factors": no_hs}), 409, "effective_date_conflict")
    _err(ch.post("/api/index-tables", {"effectiveDate": MIDSEASON_DATE, "factors": no_hs}), 409, "classes_in_use")
    for bad in ({"SS": "0.3999"}, {"SS": "1.2001"}, {"SS": "0.827"}, {"ss": "0.8270"}, {"ABCDEFG": "0.8270"}, {}):
        _err(ch.post("/api/index-tables", {"effectiveDate": "2099-12-01", "factors": {**FACTORS, **bad} if bad else {}}), 422, "validation")
    tables = ch.get("/api/index-tables").json()["tables"]
    assert [t["effectiveDate"] for t in tables] == [TABLE_DATE] and tables[0]["factors"] == FACTORS
    assert _load_table(ch, MIDSEASON_DATE, FACTORS)["effectiveDate"] == MIDSEASON_DATE
    assert [t["effectiveDate"] for t in ch.get("/api/index-tables").json()["tables"]] == [TABLE_DATE, MIDSEASON_DATE]


def test_index_table_conflict_before_validation(app_url: str) -> None:
    club = _onboard(app_url)
    ch = club.chair
    for bad in ({}, {"SS": "abc"}):
        _err(ch.post("/api/index-tables", {"effectiveDate": TABLE_DATE, "factors": bad}), 409, "effective_date_taken")
    entries = [("Order SS", "SS", 12, "a", (("51.907", 0),))]
    built = _build(club, entries)
    _time_runs(built, entries)
    for bad in ({}, {"SS": "abc"}):
        _err(ch.post("/api/index-tables", {"effectiveDate": "2099-01-01", "factors": bad}), 409, "effective_date_conflict")
    assert [t["effectiveDate"] for t in ch.get("/api/index-tables").json()["tables"]] == [TABLE_DATE]


@pytest.mark.timeout(900)
def test_dated_factors() -> None:
    base = _short()
    club = _onboard(base)
    entries = POINTS7[:2]
    built = _build(club, entries)
    _time_runs(built, entries)
    _load_table(club.chair, MIDSEASON_DATE, {**FACTORS, "SS": HALF_UP_FACTOR})
    later = _create_event(club, date=LATER_DATE, cutoff=LATER_CUTOFF)
    ev = _event(club.chair, built.eid)
    assert ev["factors"]["SS"] == "0.8270" and ev["indexTable"]["effectiveDate"] == TABLE_DATE
    assert later["factors"]["SS"] == HALF_UP_FACTOR and later["indexTable"]["effectiveDate"] == MIDSEASON_DATE
    assert _run_of(club.chair, built.eid, 1, 12, "SS", 2)["factor"] == "0.8270"
    assert next(r for r in _standings(club.chair, built.eid) if r["carNumber"] == 12)["bestIndexed"] == "42.927"
    _finalise(club.chair, built.eid)
    assert club.chair.post(f"/api/events/{built.eid}/publish", {}).status_code == 200
    words = pdf_text(S3("-short").get(f"clubs/{club.slug}/events/{built.eid}/results/final.pdf"))
    assert "0.8270" in words and HALF_UP_FACTOR not in words and "42.927" in words


def test_wf_index_tables_midseason(browser: Browser, app_url: str) -> None:
    club = _onboard(app_url)
    early = _create_event(club)
    late = _create_event(club, date=LATER_DATE, cutoff=LATER_CUTOFF)
    _load_table(club.chair, MIDSEASON_DATE, {**FACTORS, "SS": HALF_UP_FACTOR})
    with _browse(browser, club.chair, "/index-tables") as page:
        expect(_role(page, "table", f"Index table effective {MIDSEASON_DATE}")).to_contain_text(HALF_UP_FACTOR)
        expect(_role(page, "table", f"Index table effective {TABLE_DATE}")).to_contain_text("0.8270")
        page.goto(f"{app_url}/events/{early['id']}")
        expect(page.get_by_text(f"Index table effective {TABLE_DATE}").first).to_be_visible()
        expect(page.get_by_text("0.8270").first).to_be_visible()
        page.goto(f"{app_url}/events/{late['id']}")
        expect(page.get_by_text(f"Index table effective {MIDSEASON_DATE}").first).to_be_visible()
        expect(page.get_by_text(HALF_UP_FACTOR).first).to_be_visible()
    assert _event(club.chair, early["id"])["factors"]["SS"] == "0.8270"
    assert _event(club.chair, late["id"])["factors"]["SS"] == HALF_UP_FACTOR


@pytest.mark.timeout(1200)
def test_season_points() -> None:
    base = _short()
    gale = ("Gale Ostrowski", "GS", 40, "Spare GS", ("DNF",))
    club, first = _published(base, [*POINTS7, gale])

    def season(year: int = FAR_YEAR) -> dict:
        r = club.chair.get(f"/api/season?year={year}")
        assert r.status_code == 200
        return {row["driverName"]: row for row in r.json()["rows"]}

    rows = season()
    for name, pts in SEASON_POINTS.items():
        assert rows[name]["points"] == pts and rows[name]["events"] == 1
    assert rows["Gale Ostrowski"]["points"] == "0.000" and rows["Gale Ostrowski"]["events"] == 1
    assert [rows[n]["position"] for n in ("Avery Lindqvist", "Cass Ferreira", "Bo Tanaka-Reyes", "Del Mbeki")] == [1, 2, 3, 4]
    second_entries = [("Avery Lindqvist", "SS", 12, "2023 Chevrolet Corvette Z06", (("51.907", 0),)),
                      ("Bo Tanaka-Reyes", "STR", 7, "2020 Mazda MX-5 RF", (("53.211", 0),))]
    second = _build(club, second_entries, date=LATER_DATE, cutoff=LATER_CUTOFF,
                    drivers={n: first.drivers[n] for n in ("Avery Lindqvist", "Bo Tanaka-Reyes")})
    _time_runs(second, second_entries)
    _finalise(club.chair, second.eid)
    assert season()["Avery Lindqvist"]["events"] == 1, "an unpublished event counted"
    assert club.chair.post(f"/api/events/{second.eid}/publish", {}).status_code == 200
    rows = season()
    assert rows["Avery Lindqvist"]["points"] == str(Decimal(SEASON_POINTS["Avery Lindqvist"]) * 2)
    assert rows["Bo Tanaka-Reyes"]["points"] == str(Decimal(SEASON_POINTS["Bo Tanaka-Reyes"]) * 2)
    assert rows["Avery Lindqvist"]["events"] == 2 and rows["Avery Lindqvist"]["carDescription"] == second_entries[0][3]
    assert [rows[n]["position"] for n in ("Avery Lindqvist", "Bo Tanaka-Reyes", "Cass Ferreira", "Del Mbeki")] == [1, 2, 3, 4]
    _load_table(club.chair, "2099-12-01", {**FACTORS, "SS": HALF_UP_FACTOR})
    assert season() == rows
    assert "Avery Lindqvist" not in season(FAR_YEAR - 1)
    _err(club.chair.get(f"/api/season?year={BAD_YEAR}"), 422, "validation")


@pytest.mark.timeout(900)
def test_wf_season_standings_csv() -> None:
    entries = [(FORMULA_NAME, "SS", 12, FORMULA_CAR, (("51.907", 0),)),
               (AT_NAME, "STR", 7, MINUS_CAR, (("53.211", 0),))]
    club, _built = _published(_short(), entries)
    r = club.chair.get(f"/api/season.csv?year={FAR_YEAR}")
    assert r.status_code == 200
    assert r.headers["content-type"].replace(" ", "").lower() == CSV_TYPE.replace(" ", "").lower()
    assert r.headers["content-disposition"] == f'attachment; filename="season-standings-{FAR_YEAR}.csv"'
    lines = r.text.splitlines()
    assert lines[0] == "Position,Driver,Car,Class,Events,Points"
    assert f'"{APOS}{FORMULA_NAME}"' in r.text and f'"{APOS}{FORMULA_CAR}"' in r.text
    rows = list(csv.reader(io.StringIO(r.text)))[1:]
    by = {row[1]: row for row in rows}
    assert by[APOS + FORMULA_NAME][2:] == [APOS + FORMULA_CAR, "SS", "1", "100.000"]
    assert by[APOS + AT_NAME][2] == APOS + MINUS_CAR
    for row in rows:
        assert re.fullmatch(r"\d+\.\d{3}", row[5])
        for cell in row:
            assert not cell or cell[0] not in FORMULA_CHARS, cell


@pytest.mark.timeout(900)
def test_wf_season_standings_export(browser: Browser) -> None:
    base = _short()
    club, built = _published(base, POINTS7, soon=True)
    year = _local(_event(club.chair, built.eid)["serverTime"], club.tz).year
    with _browse(browser, club.chair, "/season") as page:
        expect(_role(page, "heading", f"Season standings {year}")).to_be_visible()
        table = _role(page, "table", "Season standings")
        for name, pts in SEASON_POINTS.items():
            expect(table.get_by_role("row").filter(has_text=name)).to_contain_text(pts)
        with page.expect_download() as info:
            click(_role(page, "button", "Export standings CSV"))
        _tick(page)
        expect(_role(page, "status", "Season updates")).to_contain_text("Standings CSV downloaded.")
        content = Path(info.value.path()).read_bytes()
        for size in ("phone", "tablet", "desktop"):
            w, h = VIEWPORTS[size]
            page.set_viewport_size({"width": w, "height": h})
            expect(table).to_be_visible()
            layout(page)
    assert content == club.chair.get(f"/api/season.csv?year={year}").content
    assert content.decode().splitlines()[0] == "Position,Driver,Car,Class,Events,Points"


def _json_body(size: int) -> bytes:
    head, tail = b'{"email":"nobody@paddock.test","password":"x","pad":"', b'"}'
    return head + b"a" * (size - len(head) - len(tail)) + tail


def test_api_contract(app_url: str) -> None:
    base = app_url.rstrip("/")
    _err(httpx.get(f"{base}/api/events", timeout=HTTP_TIMEOUT), 401, "unauthenticated")
    _err(httpx.get(f"{base}/api/events/999999999", timeout=HTTP_TIMEOUT), 401, "unauthenticated")
    text = {"Content-Type": "text/plain"}
    _err(httpx.post(f"{base}/api/session", content=b'{"email":"a","password":"b"}', headers=text, timeout=HTTP_TIMEOUT), 415, "unsupported_media_type")
    _err(httpx.post(f"{base}/api/events", content=b"{}", headers=text, timeout=HTTP_TIMEOUT), 415, "unsupported_media_type")
    big = _json_body(BODY_LIMIT + 1)
    _err(httpx.post(f"{base}/api/session", content=big, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT), 413, "payload_too_large")
    _err(httpx.post(f"{base}/api/session", content=big, headers=text, timeout=HTTP_TIMEOUT), 415, "unsupported_media_type")
    ok = httpx.post(f"{base}/api/session", content=_json_body(BODY_LIMIT), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert ok.status_code not in (413, 415) and "error" in ok.json()
    _err(httpx.post(f"{base}/api/session", content=b"{}", headers={**text, "Origin": "http://elsewhere.test"}, timeout=HTTP_TIMEOUT), 403, "cross_origin")

    club = _onboard(base)
    other = _onboard(base)
    built = _build(club, [("Contract A", "SS", 12, "a", ())], check_in=False, start=False)
    _move(club.chair, built.eid, "registration_closed")
    drv = built.drivers["Contract A"]
    _err(club.chair.get(UNKNOWN_PATH), 404, "not_found")
    _err(_driver(other).post(f"/api/events/{built.eid}/transition", {"to": "draft"}), 404, "not_found")
    _err(drv.post(f"/api/events/{built.eid}/transition", {"to": "draft"}), 403, "forbidden")
    late = _driver(club)
    _err(late.post(f"/api/events/{built.eid}/registrations", {"classCode": "SS", "carNumber": 0, "carDescription": ""}), 409, "registration_closed")
    body = _err(club.chair.post("/api/events", {"name": ""}), 422, "validation")
    assert isinstance(body["fields"], dict) and body["fields"] and all(isinstance(v, str) for v in body["fields"].values())


def test_server_boundary(app_url: str) -> None:
    base = app_url.rstrip("/")
    creds = {"email": RIDGE_CHAIR, "password": PASSWORD}
    for origin in ("http://elsewhere.test", "null"):
        _err(httpx.post(f"{base}/api/session", json=creds, headers={"Origin": origin}, timeout=HTTP_TIMEOUT), 403, "cross_origin")
    own = f"http://{urlsplit(base).netloc}"
    assert httpx.post(f"{base}/api/session", json=creds, headers={"Origin": own}, timeout=HTTP_TIMEOUT).status_code == 200
    alt = "paddock-alt.test:4173"
    r = httpx.post(f"{base}/api/session", json=creds, headers={"Host": alt, "Origin": f"http://{alt}"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    for resp in (httpx.get(f"{base}/api/health", headers={"Origin": "http://elsewhere.test"}, timeout=HTTP_TIMEOUT),
                 httpx.request("OPTIONS", f"{base}/api/session", headers={"Origin": "http://elsewhere.test", "Access-Control-Request-Method": "POST"}, timeout=HTTP_TIMEOUT)):
        assert not any(k.lower().startswith("access-control-allow") for k in resp.headers)
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json"):
        resp = httpx.get(f"{base}{path}", timeout=HTTP_TIMEOUT)
        assert resp.status_code == 404, f"{path} answered {resp.status_code}"
        assert "run-manifest-v1" not in resp.text


def test_if_run_manifest() -> None:
    data = json.loads(Path("/app/run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    for font in FONTS:
        assert font in notices, font


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_datastores() -> None:
    assert Postgres().tables(), "the app keeps no tables in Postgres"
    pkg = json.loads(Path("/app/package.json").read_text())
    deps = set(pkg.get("dependencies", {}))
    assert not deps & {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level", "lmdb", "@libsql/client"}
    stray = [p for p in Path("/app").rglob("*") if p.suffix in {".sqlite", ".sqlite3", ".db"}
             and not {"node_modules", ".git"} & set(p.parts)]
    assert not stray, stray


def test_if_self_hosted(browser: Browser, app_url: str) -> None:
    chair = _signin(app_url, RIDGE_CHAIR)
    seen: list[str] = []
    with _browse(browser, chair, "/events") as page:
        page.on("request", lambda req: seen.append(req.url))
        for path in ("/events", "/index-tables", "/season", "/signin"):
            page.goto(f"{app_url}{path}")
            expect(page.get_by_role("heading").first).to_be_visible()
    foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert not foreign, foreign[:10]


def test_if_dev_services_untouched() -> None:
    files = [p for p in Path("/app").rglob("*") if p.is_file() and "node_modules" not in p.parts
             and re.fullmatch(r"(docker-)?compose(\.[\w-]+)?\.ya?ml", p.name)]
    for f in files:
        body = f.read_text(errors="replace").lower()
        for service in ("postgres", "gotenberg", "minio", "mailpit"):
            assert service in body, f"{f} no longer declares {service}"


def _jsonc(text: str) -> dict:
    out: list[str] = []
    i, n, in_str = 0, len(text), False
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 1
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
            out.append(ch)
        elif text.startswith(chr(47) * 2, i):
            while i < n and text[i] != "\n":
                i += 1
            continue
        elif text.startswith(chr(47) + "*", i):
            end = text.find("*" + chr(47), i + 2)
            i = n if end < 0 else end + 2
            continue
        else:
            out.append(ch)
        i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def _strict_of(path: Path, depth: int = 0) -> bool | None:
    if depth > 8 or not path.is_file():
        return None
    cfg = _jsonc(path.read_text())
    value = cfg.get("compilerOptions", {}).get("strict")
    if value is not None:
        return bool(value)
    exts = cfg.get("extends", [])
    for ext in reversed([exts] if isinstance(exts, str) else list(exts)):
        if ext.startswith("."):
            target = path.parent / ext
        else:
            target = Path("/app/node_modules") / ext
            if not target.suffix == ".json":
                target = target / "tsconfig.json"
        if target.suffix != ".json":
            target = Path(str(target) + ".json")
        found = _strict_of(target, depth + 1)
        if found is None and not ext.startswith(".") and ext.startswith("@tsconfig/"):
            found = True
        if found is not None:
            return found
    return None


def test_if_typescript_strict() -> None:
    configs = [p for p in Path("/app").rglob("tsconfig*.json") if DEP_DIR not in p.parts]
    assert configs, "no tsconfig found under /app"
    states = [_strict_of(p) for p in configs]
    assert True in states, "no tsconfig enables strict"
    assert False not in states, "a tsconfig disables strict"
    assert any(p.suffix in {".ts", ".tsx"} for p in Path("/app").rglob("*") if DEP_DIR not in p.parts)
