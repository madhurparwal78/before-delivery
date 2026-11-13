from __future__ import annotations

import base64
import contextlib
import hashlib
import importlib
import json
import math
import os
import random
import re
import socket
import string
import subprocess
import tempfile
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    advance,
    center,
    check,
    held,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    state_styles,
    style,
    tap,
)


TODAY = "2026-11-05"
SERIES_START = "2026-09-01"
PASSWORD = "tempoline-demo"
MINUS = "\u2212"
GRADING_KEY = os.environ.get("GRADING_KEY", "")
ACTIVITY_MAX_BYTES = int(os.environ.get("ACTIVITY_MAX_BYTES", "1048576"))
ACTIVITY_MAX_SAMPLES = int(os.environ.get("ACTIVITY_MAX_SAMPLES", "21600"))
CHART_ANIMATION_MS = int(os.environ.get("CHART_ANIMATION_MS", "450"))
LIVE_WINDOW_S = 3
JSON_BODY_LIMIT = 1_000_000
MIN_TAP_PX = 44
SWIPE_PX = 60
TRACK_MAX_MS = 500
STEADY_S = 1200
STEADY_PCT = 75
MIN_STEP_S = 30
MAX_STEP_S = 14400
MIN_PCT = 30
MAX_PCT = 200
MAX_STEPS = 50
WAIT_S = 30
HTTP_TIMEOUT = 30
SEED_TIMEOUT = 120
BOOT_S = 120
POLL_STEP_MS = 50
DEFAULT_TIMEOUT_MS = 5000
TAB_PRESSES = 12
MOVE_POLLS = 200
TOL = 1e-6
PROVIDER_MODULES = ("conftest", "clients", "providers", "postgres", "minio", "s3", "services")
CODE_ALPHABET = string.ascii_uppercase + string.digits
BUILDER_DAY = "2026-11-06"
COMPLIANCE_FIRST_DAY = "2026-10-05"
STORAGE_DOWN_ENV = "APP_STORAGE_DOWN_URL"
STORAGE_UPLOAD_MSG = "Activity storage is unavailable. Your file was not saved; try again in a few minutes."
NOT_FOUND = {"error": "not_found", "message": "Not found."}
UNAUTHENTICATED = {"error": "unauthenticated", "message": "Sign in to continue."}
LEGEND = {"on-target": "On target", "close": "Close", "off-target": "Off target", "missed": "Missed",
          "unplanned": "Unplanned", "planned": "Planned"}
LICENCE_WORDS = re.compile(r"Open Font Licen[cs]e|\bMIT Licen[cs]e|\bISC Licen[cs]e|Apache Licen[cs]e|BSD Licen[cs]e|Blue Oak|CC0", re.I)
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}
DOW = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MON = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
MONDAY = "2026-11-02"
TUE, WED, FRI, SAT, SUN = ((date.fromisoformat(MONDAY) + timedelta(days=n)).isoformat() for n in (1, 2, 4, 5, 6))
WEEK = date.fromisoformat(MONDAY).strftime("%G-W%V")
NEXT_MONDAY = (date.fromisoformat(MONDAY) + timedelta(days=7)).isoformat()
NOOR, EZRA, MARA = "Noor Halvorsen", "Ezra Blom", "Mara Quill"
CORS_HEADER_PREFIX = "access-control-"


def provider(name: str) -> Any:
    for module in PROVIDER_MODULES:
        with contextlib.suppress(ImportError, AttributeError):
            return getattr(importlib.import_module(module), name)
    raise ImportError(f"no provider client named {name}")


def Postgres(*args: str) -> Any:
    return provider("Postgres")(*args)


def S3(*args: str) -> Any:
    return provider("S3")(*args)


def as_cm(obj: Any) -> Any:
    if hasattr(obj, "__enter__"):
        return obj

    @contextlib.contextmanager
    def wrap() -> Iterator[Any]:
        yield from obj

    return wrap()


def tag(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:6]}"


def norm(text: str | None) -> str:
    return " ".join((text or "").split())


def num(value: Any) -> float:
    try:
        return float(str(value).replace(MINUS, "-"))
    except (TypeError, ValueError):
        return math.nan


def same(a: Any, b: Any, tol: float = TOL) -> bool:
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) <= tol


def rnd(x: float, places: int = 0) -> float:
    scale = 10 ** places
    out = math.floor(abs(x) * scale + 0.5 + 1e-9) / scale
    return (out if x >= 0 else -out) + 0.0


def fmt1(x: float) -> str:
    return f"{rnd(x, 1):.1f}"


def fmt2(x: float) -> str:
    return f"{rnd(x, 2):.2f}"


def fmt_tsb(x: float) -> str:
    r = rnd(x, 1)
    if r == 0:
        return "0.0"
    return f"{'+' if r > 0 else MINUS}{abs(r):.1f}"


def fmt_dur(seconds: int) -> str:
    return f"{seconds // 3600}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def d(day: str) -> date:
    return date.fromisoformat(day)


def days_between(a: str, b: str) -> list[str]:
    start, end = d(a), d(b)
    return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


def day_text(day: str) -> str:
    dt = d(day)
    return f"{DOW[dt.weekday()]} {dt.day} {MON[dt.month - 1]}"


def long_day(day: str) -> str:
    return f"{day_text(day)} {d(day).year}"


def monday_text(day: str) -> str:
    dt = d(day)
    return f"{dt.day} {MON[dt.month - 1]} {dt.year}"


def snap30(x: float) -> int:
    return int(math.floor(x / 30 + 0.5) * 30)


def clamp(x: float, low: float, high: float) -> float:
    return min(max(x, low), high)


def normalised(values: list[float]) -> float:
    if len(values) < 30:
        return sum(values) / len(values)
    means = [sum(values[i - 29:i + 1]) / 30 for i in range(29, len(values))]
    return (sum(m ** 4 for m in means) / len(means)) ** 0.25


def bike_score(values: list[float], ftp: float) -> tuple[float, float, float]:
    np_ = normalised(values)
    if_ = np_ / ftp
    return np_, if_, len(values) * np_ * if_ / (ftp * 3600) * 100


def run_score(values: list[float], pace: float) -> tuple[float, float, float]:
    ns = normalised(values)
    if_ = ns / (1000 / pace)
    return ns, if_, len(values) / 3600 * if_ ** 2 * 100


def manual_bike(seconds: int, watts: float, ftp: float) -> float:
    return seconds / 3600 * (watts / ftp) ** 2 * 100


def manual_run(seconds: int, pace: float, threshold: float) -> float:
    return seconds / 3600 * (threshold / pace) ** 2 * 100


def steady(seconds: int, pct: int) -> dict[str, Any]:
    return {"kind": "steady", "duration_s": seconds, "target_pct": pct}


def interval(repeat: int, work_s: int, work_pct: int, rec_s: int, rec_pct: int) -> dict[str, Any]:
    return {"kind": "interval", "repeat": repeat, "work": {"duration_s": work_s, "target_pct": work_pct},
            "recovery": {"duration_s": rec_s, "target_pct": rec_pct}}


WARMUP = {"kind": "warmup", "duration_s": 600, "target_pct": 60}
COOLDOWN = {"kind": "cooldown", "duration_s": 600, "target_pct": 50}
FIVES = [WARMUP, interval(5, 240, 110, 180, 55), COOLDOWN]


def plan_seconds(steps: list[dict[str, Any]]) -> int:
    return sum(s["repeat"] * (s["work"]["duration_s"] + s["recovery"]["duration_s"]) if s["kind"] == "interval"
               else s["duration_s"] for s in steps)


def plan_tss(steps: list[dict[str, Any]]) -> float:
    total = 0.0
    for s in steps:
        if s["kind"] == "interval":
            total += s["repeat"] * (s["work"]["duration_s"] * (s["work"]["target_pct"] / 100) ** 2
                                    + s["recovery"]["duration_s"] * (s["recovery"]["target_pct"] / 100) ** 2) / 3600 * 100
        else:
            total += s["duration_s"] * (s["target_pct"] / 100) ** 2 / 3600 * 100
    return total


def plan_if(steps: list[dict[str, Any]]) -> float:
    return math.sqrt(plan_tss(steps) / (plan_seconds(steps) / 3600 * 100))


def model_series(start: str, end: str, tss: dict[str, float], ctl0: float = 0.0, atl0: float = 0.0) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    ctl, atl = ctl0, atl0
    for ds in days_between(start, end):
        tsb = ctl - atl
        x = tss.get(ds, 0.0)
        ctl += (x - ctl) / 42
        atl += (x - atl) / 7
        out[ds] = {"tss": x, "ctl": ctl, "atl": atl, "tsb": tsb}
    return out


def tavi_tss() -> dict[str, float]:
    return {"2026-11-02": 64.0, "2026-11-04": manual_run(2700, 330, 300)}


def ride_csv(values: list[float]) -> bytes:
    return ("t,power,heart_rate,speed\n" + "".join(f"{i},{v},,\n" for i, v in enumerate(values))).encode()


def run_csv(values: list[float]) -> bytes:
    return ("t,power,heart_rate,speed\n" + "".join(f"{i},,,{v}\n" for i, v in enumerate(values))).encode()


def activity_json(sport: str, values: list[float], start: str | None = None) -> bytes:
    channel = "power" if sport == "bike" else "speed"
    doc: dict[str, Any] = {"sport": sport, "samples": [{"t": i, channel: v} for i, v in enumerate(values)]}
    if start:
        doc["start"] = start
    return json.dumps(doc).encode()


class Api(httpx.Client):
    def __init__(self, base: str, email: str | None = None, password: str = PASSWORD):
        super().__init__(base_url=base, timeout=HTTP_TIMEOUT, follow_redirects=False)
        if email:
            r = self.post("/api/auth/sign-in", json={"email": email, "password": password})
            assert r.status_code == 200, f"sign-in for {email} answered {r.status_code} {r.text[:200]}"


def seed(base: str, body: dict[str, Any]) -> dict[str, Any]:
    r = httpx.post(base + "/api/grading/seed", json=body, headers={"X-Grading-Key": GRADING_KEY}, timeout=SEED_TIMEOUT)
    assert r.status_code == 200, f"POST /api/grading/seed answered {r.status_code} {r.text[:300]}"
    return r.json()


def coach_user(t: str, key: str, name: str, tz: str) -> dict[str, Any]:
    return {"key": f"{t}-{key}", "role": "coach", "name": name, "email": f"{t}-{key}@ottermere.test", "password": PASSWORD,
            "tz": tz, "coach_code": "".join(random.choices(CODE_ALPHABET, k=6))}


def athlete_user(t: str, key: str, name: str, tz: str, ftp: int | None = 250, pace: int | None = 300,
                 start: str = SERIES_START, start_ctl: float = 0, start_atl: float = 0,
                 extra: Any = ()) -> dict[str, Any]:
    thresholds: list[dict[str, Any]] = []
    if ftp is not None:
        thresholds.append({"kind": "ftp", "value": ftp, "effective_from": start})
    if pace is not None:
        thresholds.append({"kind": "pace", "value": pace, "effective_from": start})
    thresholds += list(extra)
    return {"key": f"{t}-{key}", "role": "athlete", "name": name, "email": f"{t}-{key}@ottermere.test", "password": PASSWORD,
            "tz": tz, "series_start": start, "start_ctl": start_ctl, "start_atl": start_atl, "thresholds": thresholds}


def link_rec(t: str, key: str, coach: str, athlete: str, status: str = "accepted", expires_at: str | None = None) -> dict[str, Any]:
    rec: dict[str, Any] = {"key": f"{t}-{key}", "coach": f"{t}-{coach}", "athlete": f"{t}-{athlete}", "status": status}
    if expires_at:
        rec["expires_at"] = expires_at
    return rec


def planned_rec(t: str, key: str, athlete: str, day: str, title: str, sport: str,
                steps: list[dict[str, Any]] | None = None, start_local: str = "06:30",
                duration_s: int | None = None) -> dict[str, Any]:
    rec: dict[str, Any] = {"key": f"{t}-{key}", "athlete": f"{t}-{athlete}", "kind": "planned", "date": day,
                           "start_local": start_local, "sport": sport, "title": title}
    if steps is not None:
        rec["steps"] = steps
    else:
        rec["duration_s"] = duration_s
    return rec


def manual_rec(t: str, key: str, athlete: str, day: str, title: str, sport: str, duration_s: int,
               power: int | None = None, pace: int | None = None) -> dict[str, Any]:
    manual: dict[str, Any] = {"duration_s": duration_s}
    if power is not None:
        manual["avg_power_w"] = power
    if pace is not None:
        manual["avg_pace_s_per_km"] = pace
    return {"key": f"{t}-{key}", "athlete": f"{t}-{athlete}", "kind": "completed", "date": day, "sport": sport,
            "title": title, "manual": manual}


def file_rec(t: str, key: str, name: str, data: bytes) -> dict[str, Any]:
    return {"key": f"{t}-{key}", "name": name, "content_base64": base64.b64encode(data).decode()}


def file_workout(t: str, key: str, athlete: str, day: str, title: str, sport: str, file_key: str) -> dict[str, Any]:
    return {"key": f"{t}-{key}", "athlete": f"{t}-{athlete}", "kind": "completed", "date": day, "sport": sport,
            "title": title, "file": f"{t}-{file_key}"}


def twelve_plan(t: str) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    for wk in range(1, 13):
        base = 7 * (wk - 1)
        entries += [
            {"day": base + 2, "start_local": "06:30", "sport": "bike", "title": "Fives at 110", "steps": FIVES},
            {"day": base + 4, "start_local": "06:30", "sport": "run", "title": "Easy 45", "steps": [steady(2700, 75)]},
            {"day": base + 6, "start_local": "07:00", "sport": "bike", "title": "Long ride", "steps": [steady(7200, 70)]},
        ]
    return {"key": f"{t}-p1", "owner": f"{t}-c1", "name": "Twelve to race day", "weeks": 12, "entries": entries}


def mini(t: str, tz: str = "UTC", ftp: int | None = 250, pace: int | None = 300, start: str = SERIES_START,
         start_ctl: float = 0, start_atl: float = 0, workouts: Any = (), files: Any = (), plans: Any = (),
         extra_thresholds: Any = ()) -> dict[str, Any]:
    return {"today": TODAY,
            "users": [coach_user(t, "c1", "Mara Quill", "Europe/London"),
                      athlete_user(t, "a1", "Tavi Rennick", tz, ftp, pace, start, start_ctl, start_atl, extra_thresholds)],
            "links": [link_rec(t, "l1", "c1", "a1")], "files": list(files), "library": [], "workouts": list(workouts),
            "comments": [], "plans": list(plans), "events": []}


def demo(t: str, ezra_link: str | None = "requested") -> dict[str, Any]:
    links = [link_rec(t, "l1", "c1", "a1"), link_rec(t, "l2", "c1", "a2")]
    if ezra_link:
        links.append(link_rec(t, "l3", "c1", "a3", ezra_link))
    workouts = [
        planned_rec(t, "w1", "a1", "2026-11-02", "Endurance hour", "bike", [steady(3600, 80)]),
        manual_rec(t, "w2", "a1", "2026-11-02", "Endurance hour", "bike", 3600, power=200),
        planned_rec(t, "w3", "a1", "2026-11-03", "Easy 45", "run", [steady(2700, 75)]),
        manual_rec(t, "w4", "a1", "2026-11-04", "Lunch run", "run", 2700, pace=330),
        planned_rec(t, "w5", "a1", TODAY, "Fives at 110", "bike", FIVES),
        planned_rec(t, "w6", "a1", "2026-11-07", "Long ride", "bike", [steady(10800, 70)], start_local="07:00"),
        planned_rec(t, "n1", "a2", "2026-11-02", "Tempo ride", "bike", [steady(2400, 88)]),
    ]
    return {"today": TODAY,
            "users": [coach_user(t, "c1", "Mara Quill", "Europe/London"), coach_user(t, "c2", "Idris Fenn", "Europe/Berlin"),
                      athlete_user(t, "a1", "Tavi Rennick", "Pacific/Auckland"),
                      athlete_user(t, "a2", "Noor Halvorsen", "Europe/London", 210, 330),
                      athlete_user(t, "a3", "Ezra Blom", "Europe/Berlin", 280, 285)],
            "links": links, "files": [],
            "library": [{"key": f"{t}-lib1", "owner": f"{t}-a1", "name": "Fives at 110", "sport": "bike", "steps": FIVES}],
            "workouts": workouts,
            "comments": [{"key": f"{t}-m1", "workout": f"{t}-w2", "author": f"{t}-c1", "body": "Steady and even."}],
            "plans": [twelve_plan(t)],
            "events": [{"athlete": f"{t}-a1", "name": "Harbour Half", "date": "2026-12-20"}]}


class World:
    def __init__(self, base: str, t: str, body: dict[str, Any]):
        self.base, self.t, self.body = base, t, body
        self.ids: dict[str, str] = seed(base, body)["ids"]

    def id(self, key: str) -> str:
        return self.ids[f"{self.t}-{key}"]

    def user(self, key: str) -> dict[str, Any]:
        return next(u for u in self.body["users"] if u["key"] == f"{self.t}-{key}")

    def email(self, key: str) -> str:
        return self.user(key)["email"]

    def code(self, key: str) -> str:
        return self.user(key)["coach_code"]

    def api(self, key: str) -> Api:
        return Api(self.base, self.email(key))


def workout(api: Api, wid: str) -> dict[str, Any]:
    r = api.get(f"/api/workouts/{wid}")
    assert r.status_code == 200, f"GET /api/workouts/{wid} answered {r.status_code} {r.text[:200]}"
    return r.json()


def series(api: Api, aid: str, frm: str | None = None, to: str | None = None) -> dict[str, dict[str, Any]]:
    params = {k: v for k, v in (("from", frm), ("to", to)) if v}
    r = api.get(f"/api/athletes/{aid}/series", params=params)
    assert r.status_code == 200, f"GET series answered {r.status_code} {r.text[:200]}"
    return {row["date"]: row for row in r.json()["days"]}


def weeks(api: Api, aid: str, week: str, before: int = 0, after: int = 0) -> list[dict[str, Any]]:
    r = api.get(f"/api/athletes/{aid}/weeks", params={"week": week, "before": before, "after": after})
    assert r.status_code == 200, f"GET weeks answered {r.status_code} {r.text[:200]}"
    return r.json()["weeks"]


def week_row(api: Api, aid: str, week: str) -> dict[str, Any]:
    return next(x for x in weeks(api, aid, week) if x["week"] == week)


def entries(ws: list[dict[str, Any]]) -> Iterator[tuple[str, dict[str, Any], dict[str, Any]]]:
    for wk in ws:
        for day in wk["days"]:
            for item in day["items"]:
                for wo in (item["planned"], item["completed"]):
                    if wo:
                        yield day["date"], item, wo


def find(ws: list[dict[str, Any]], title: str, kind: str | None = None) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    return [(ds, item, wo) for ds, item, wo in entries(ws) if wo["title"] == title and (kind is None or wo["kind"] == kind)]


def upload(api: Api, aid: str, name: str, data: bytes, sport: str | None, day: str, title: str | None = None) -> httpx.Response:
    form: dict[str, str] = {"date": day}
    if sport is not None:
        form["sport"] = sport
    if title:
        form["title"] = title
    return api.post(f"/api/athletes/{aid}/uploads", files={"file": (name, data, "application/octet-stream")}, data=form)


def db_mentions(pg: Any, needle: str) -> int:
    total = 0
    for table in pg.tables():
        ident = ".".join('"' + part.replace('"', '""') + '"' for part in table.split(".", 1))
        rows = pg.rows(f"SELECT count(*) AS n FROM {ident} AS r WHERE r::text LIKE '%{needle}%'")
        total += int(rows[0]["n"])
    return total


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def poll(page: Page, predicate: Callable[[], Any], message: str, seconds: float = WAIT_S, step_ms: int = POLL_STEP_MS) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except PlaywrightError:
            pass
        if step_ms:
            advance(page, step_ms)
        else:
            page.evaluate("0")
    pytest.fail(f"expected within {seconds}s: {message}")


@contextlib.contextmanager
def signed_in(browser: Browser, base: str, email: str | None, path: str, viewport: tuple[int, int] | None = None,
              touch: bool = False, clock: datetime | None = None, reduced_motion: str = "no-preference") -> Iterator[Page]:
    with as_cm(open_app(browser, base + "/sign-in", reduced_motion=reduced_motion)) as p:
        p.set_default_timeout(DEFAULT_TIMEOUT_MS)
        if viewport:
            p.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        if touch:
            cdp = session(p)
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
            p.touch_session = cdp
        if email:
            r = p.context.request.post(base + "/api/auth/sign-in", data={"email": email, "password": PASSWORD})
            assert r.ok, f"sign-in for {email} answered {r.status}"
        if clock is not None:
            p.clock.set_fixed_time(clock)
        p.goto(base + path)
        yield p


class Touch:
    def __init__(self, page: Page):
        self.cdp = getattr(page, "touch_session", None) or session(page)

    def drag(self, x1: float, y1: float, x2: float, y2: float, steps: int = 8) -> None:
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x1, "y": y1, "id": 1}]})
        for i in range(1, steps + 1):
            x, y = x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y, "id": 1}]})
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def mouse_drag(p: Page, x1: float, y1: float, x2: float, y2: float) -> None:
    p.mouse.move(x1, y1)
    p.mouse.down()
    p.mouse.move(x2, y2, steps=8)
    p.mouse.up()


def text_of(loc: Locator) -> str:
    return norm(loc.first.text_content()) if loc.count() else ""


def data_of(loc: Locator, attr: str) -> str | None:
    return loc.first.get_attribute(attr) if loc.count() else None


def has_focus(loc: Locator) -> bool:
    return bool(loc.count()) and bool(loc.first.evaluate("e => e.contains(document.activeElement)"))


def say(p: Page, region: str, text: str, seconds: float = WAIT_S) -> None:
    box = p.get_by_role("status", name=region, exact=True)
    poll(p, lambda: text in text_of(box), f"{region} announces {text!r}", seconds)


def location_week(p: Page) -> str | None:
    return parse_qs(urlsplit(p.url).query).get("week", [None])[0]


def chip(p: Page, day: str) -> Locator:
    return p.get_by_role("group", name=day_text(day), exact=True)


def week_tile(p: Page, monday: str) -> Locator:
    return p.get_by_role("group", name=f"Week of {monday_text(monday)}", exact=True)


def item_in(p: Page, day: str, title: str) -> Locator:
    return chip(p, day).get_by_role("listitem").filter(has=p.get_by_role("link", name=title, exact=True))


def move_button(p: Page, title: str) -> Locator:
    return p.get_by_role("button", name=f"Move {title}", exact=True)


def chart_points(p: Page) -> list[dict[str, Any]]:
    return p.get_by_role("group", name="Fitness chart", exact=True).locator("[data-date]").evaluate_all(
        "els => els.filter(e => !e.closest('table')).map(e => ({date: e.getAttribute('data-date'),"
        " ctl: e.getAttribute('data-ctl'), atl: e.getAttribute('data-atl'), tsb: e.getAttribute('data-tsb')}))")


def table_rows(p: Page) -> list[dict[str, Any]]:
    return p.get_by_role("table", name="Fitness table").get_by_role("row").evaluate_all(
        "els => els.filter(e => e.getAttribute('data-date')).map(e => ({date: e.getAttribute('data-date'),"
        " tss: e.getAttribute('data-tss'), ctl: e.getAttribute('data-ctl'), atl: e.getAttribute('data-atl'),"
        " tsb: e.getAttribute('data-tsb')}))")


def row_matches(r: dict[str, Any], s: dict[str, Any]) -> bool:
    return all(same(num(r[k]), rnd(s[k], 1), 1e-9) for k in ("tss", "ctl", "atl", "tsb") if r.get(k) is not None)


def point_matches(r: dict[str, Any], s: dict[str, Any]) -> bool:
    return all(abs(num(r[k]) - s[k]) <= 0.05 + 1e-9 for k in ("ctl", "atl", "tsb") if r.get(k) is not None)


def page_layout(p: Page) -> None:
    viewport = p.viewport_size
    assert viewport is not None
    assert p.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    rail = p.get_by_role("region", name="Week rail")
    controls = p.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        in_rail = rail.count() == 1 and rail.evaluate("(r, e) => r.contains(e)", control.element_handle())
        if control.is_visible() and not in_rail:
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            box = control.bounding_box()
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1
    if rail.count() == 1:
        rail.scroll_into_view_if_needed()


def rail_box(p: Page, rail: Locator) -> dict[str, float]:
    rail.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
    box = rail.bounding_box()
    assert box is not None
    return box


def open_log_dialog(p: Page, day: str, by_key: bool = False) -> Locator:
    button = chip(p, day).get_by_role("button", name=f"Log session on {day_text(day)}")
    poll(p, lambda: button.count() == 1, f"Log session button on {day_text(day)}")
    if by_key:
        button.focus()
        p.keyboard.press("Enter")
    else:
        button.click()
    dialog = p.get_by_role("dialog", name="Log a session")
    poll(p, lambda: dialog.count() == 1, "Log a session dialog")
    return dialog


def choose_upload(dialog: Locator, sport: str, title: str, name: str, data: bytes) -> None:
    dialog.get_by_role("tab", name="Upload a file").click()
    check(dialog.get_by_role("radio", name=sport))
    dialog.get_by_role("textbox", name="Title").fill(title)
    dialog.get_by_label("Activity file").set_input_files({"name": name, "mimeType": "application/octet-stream", "buffer": data})


def selected_files(dialog: Locator) -> list[str]:
    return dialog.get_by_label("Activity file").evaluate("e => Array.from(e.files).map(f => f.name)")


def error_text(field: Locator) -> str:
    return norm(field.evaluate(
        "e => ['aria-describedby', 'aria-errormessage'].flatMap(a => (e.getAttribute(a) || '').split(' '))"
        ".filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || '').join(' ')"))


def steps_box(p: Page) -> Locator:
    return p.get_by_role("listbox", name="Steps")


def option_attrs(p: Page) -> list[dict[str, Any]]:
    return steps_box(p).get_by_role("option").evaluate_all(
        "els => els.map(e => ({kind: e.getAttribute('data-kind'), duration: Number(e.getAttribute('data-duration-s')),"
        " target: Number(e.getAttribute('data-target-pct')), index: Number(e.getAttribute('data-step-index')),"
        " repeat: e.getAttribute('data-repeat'), text: e.textContent, selected: e.getAttribute('aria-selected') === 'true'"
        " || (!!e.id && (e.closest('[role=listbox]') || document.body).getAttribute('aria-activedescendant') === e.id)}))")


def chosen(p: Page) -> dict[str, Any] | None:
    picked = [o for o in option_attrs(p) if o["selected"]]
    return picked[0] if len(picked) == 1 else None


def add_step(p: Page, name: str) -> None:
    button = p.get_by_role("button", name=name)
    button.focus()
    p.keyboard.press("Enter")
    poll(p, lambda: has_focus(steps_box(p)), f"{name} returns focus to the Steps list")


def build_fives(p: Page) -> None:
    poll(p, lambda: steps_box(p).count() == 1, "Steps list")
    check(p.get_by_role("radiogroup", name="Sport").get_by_role("radio", name="Bike"))
    add_step(p, "Add warm-up")
    add_step(p, "Add interval")
    for key in ("ArrowRight", "ArrowRight") + ("Shift+ArrowUp",) * 5 + ("+",):
        p.keyboard.press(key)
    add_step(p, "Add cool-down")


def expect_totals(p: Page, steps: list[dict[str, Any]]) -> None:
    secs, tss, if_ = plan_seconds(steps), plan_tss(steps), plan_if(steps)
    totals = p.get_by_role("group", name="Workout totals")
    poll(p, lambda: all(s in text_of(totals) for s in (f"Duration {fmt_dur(secs)}", f"Planned {fmt1(tss)} TSS", f"IF {fmt2(if_)}"))
         and num(data_of(totals, "data-duration-s")) == secs
         and same(num(data_of(totals, "data-planned-tss")), rnd(tss, 1), 1e-9)
         and same(num(data_of(totals, "data-if")), rnd(if_, 2), 1e-9), f"totals read {fmt_dur(secs)}, {fmt1(tss)} TSS")


PLAN_TITLE = "Twelve to race day"
SAT_DAY = "2026-11-07"

def apply_plan_ui(p: Page, athlete: str, mode: str, day: str, event: str | None = None) -> None:
    opener = p.get_by_role("button", name="Apply Twelve to race day")
    poll(p, lambda: opener.count() == 1, "plan tile offers Apply (L127)")
    opener.click()
    dlg = p.get_by_role("dialog", name="Apply plan")
    poll(p, lambda: dlg.count() == 1, "Apply plan dialog")
    select(dlg.get_by_role("combobox", name="Athlete"), athlete)
    check(dlg.get_by_role("radio", name=mode))
    dlg.get_by_role("textbox", name="Date").fill(day)
    if event:
        dlg.get_by_role("textbox", name="Event name").fill(event)
    dlg.get_by_role("button", name="Apply plan", exact=True).click()


def test_wf_builder_keyboard_steps(browser: Browser, app_url: str) -> None:
    t = tag("bld")
    w = World(app_url, t, mini(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}/builder?date={BUILDER_DAY}") as p:
        steps = steps_box(p)
        poll(p, lambda: steps.count() == 1, "Steps list")
        assert p.get_by_role("radiogroup", name="Sport").count() == 1
        assert p.get_by_role("textbox", name="Workout name").count() == 1
        for name in ("Add warm-up", "Add steady", "Add interval", "Add recovery", "Add cool-down"):
            assert p.get_by_role("button", name=name).count() == 1, name
            p.get_by_role("button", name=name).click()
        poll(p, lambda: len(option_attrs(p)) == 6, "five steps give six parts (an interval has two)")
        parts = option_attrs(p)
        assert [(o["kind"], o["duration"], o["target"]) for o in parts] == [
            ("warmup", 600, 60), ("steady", 1200, 75), ("interval", 180, 105), ("interval", 180, 55),
            ("recovery", 300, 50), ("cooldown", 600, 50)]
        assert [o["repeat"] for o in parts if o["kind"] == "interval"] == ["4", "4"]
        assert parts[0]["index"] == 0 and parts[-1]["index"] == 4
        for o in parts:
            assert fmt_dur(int(o["duration"])) in norm(o["text"]) and f"{int(o['target'])}%" in norm(o["text"]), o
        graph = p.get_by_role("group", name="Workout graph")
        bars = graph.locator("[data-step-index]").evaluate_all(
            "els => els.filter(e => !e.hasAttribute('data-handle')).map(e => ({index: e.getAttribute('data-step-index'),"
            " part: e.getAttribute('data-part') || ''}))")
        assert len([b for b in bars if b["part"] == "work"]) == 4, "every repetition of the interval is drawn"
        assert len([b for b in bars if b["part"] == "recovery"]) >= 4
        assert {b["index"] for b in bars} == {"0", "1", "2", "3", "4"}
        for _ in range(MAX_STEPS - 5):
            p.get_by_role("button", name="Add steady").click()
        count = lambda: len({o["index"] for o in option_attrs(p)})
        poll(p, lambda: count() == MAX_STEPS, f"{MAX_STEPS} steps are allowed")
        extra = p.get_by_role("button", name="Add steady")
        if extra.is_enabled():
            extra.click()
        assert count() == MAX_STEPS, "a workout has at most 50 steps"


def test_wf_builder_keyboard_keys(browser: Browser, app_url: str) -> None:
    t = tag("key")
    w = World(app_url, t, mini(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}/builder?date={BUILDER_DAY}") as p:
        poll(p, lambda: steps_box(p).count() == 1, "Steps list")
        said = lambda text: say(p, "Builder announcements", text)
        add_step(p, "Add warm-up")
        said("Warm-up added.")
        add_step(p, "Add interval")
        said("Interval added.")
        poll(p, lambda: (o := chosen(p)) is not None and o["kind"] == "interval" and o["duration"] == 180,
             "the new interval's first part is selected")
        script = [("ArrowRight", "Interval work 0:03:30 at 105%."), ("ArrowRight", "Interval work 0:04:00 at 105%."),
                  ("ArrowLeft", "Interval work 0:03:30 at 105%."), ("ArrowRight", "Interval work 0:04:00 at 105%.")]
        script += [("Shift+ArrowUp", f"Interval work 0:04:00 at {105 + i}%.") for i in range(1, 6)]
        script += [("Shift+ArrowDown", "Interval work 0:04:00 at 109%."), ("Shift+ArrowUp", "Interval work 0:04:00 at 110%."),
                   ("+", "Interval repeats 5."), ("-", "Interval repeats 4."), ("+", "Interval repeats 5.")]
        for key, text in script:
            p.keyboard.press(key)
            said(text)
        p.keyboard.press("ArrowDown")
        poll(p, lambda: (o := chosen(p)) is not None and o["kind"] == "interval" and o["duration"] == 180 and o["target"] == 55,
             "Down selects the interval's recovery part")
        p.keyboard.press("+")
        said("Interval repeats 6.")
        p.keyboard.press("-")
        said("Interval repeats 5.")
        p.keyboard.press("ArrowDown")
        assert (o := chosen(p)) is not None and o["target"] == 55, "selection does not wrap"
        parts = option_attrs(p)
        assert [(o["kind"], o["duration"], o["target"], o["repeat"]) for o in parts if o["kind"] == "interval"] == [
            ("interval", 240, 110, "5"), ("interval", 180, 55, "5")]
        add_step(p, "Add cool-down")
        said("Cool-down added.")
        p.keyboard.press("Alt+ArrowUp")
        said("Cool-down moved to position 2 of 3.")
        assert [o["kind"] for o in option_attrs(p)] == ["warmup", "cooldown", "interval", "interval"]
        p.keyboard.press("Alt+ArrowDown")
        said("Cool-down moved to position 3 of 3.")
        for _ in range(4):
            p.keyboard.press("ArrowUp")
        poll(p, lambda: (o := chosen(p)) is not None and o["kind"] == "warmup", "Up four times reaches the warm-up and stops")
        for _ in range(19):
            p.keyboard.press("ArrowLeft")
        said("Warm-up 0:00:30 at 60%.")
        p.keyboard.press("ArrowLeft")
        said("Warm-up 0:00:30 at 60%.")
        assert (o := chosen(p)) is not None and o["duration"] == MIN_STEP_S, "a change beyond the limit leaves the value unchanged"
        p.keyboard.press("ArrowDown")
        for _ in range(4):
            p.keyboard.press("-")
        said("Interval repeats 1.")
        p.keyboard.press("-")
        said("Interval repeats 1.")
        assert (o := chosen(p)) is not None and o["repeat"] == "1"
        p.keyboard.press("ArrowUp")
        p.keyboard.press("Delete")
        said("Warm-up removed.")
        poll(p, lambda: (o := chosen(p)) is not None and o["kind"] == "interval", "selection moves to the next step")
        p.keyboard.press("ArrowDown")
        p.keyboard.press("ArrowDown")
        poll(p, lambda: (o := chosen(p)) is not None and o["kind"] == "cooldown", "Down reaches the cool-down")
        p.keyboard.press("Backspace")
        said("Cool-down removed.")
        poll(p, lambda: (o := chosen(p)) is not None and o["kind"] == "interval", "selection moves to the previous step")
        p.keyboard.press("Delete")
        said("Interval removed.")
        poll(p, lambda: len(option_attrs(p)) == 0, "no step is left")


def test_planned_stress_totals(browser: Browser, app_url: str) -> None:
    t = tag("tot")
    w = World(app_url, t, mini(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}/builder?date={BUILDER_DAY}") as p:
        poll(p, lambda: steps_box(p).count() == 1, "Steps list")
        add_step(p, "Add warm-up")
        expect_totals(p, [WARMUP])
        add_step(p, "Add interval")
        iv = interval(4, 180, 105, 180, 55)
        expect_totals(p, [WARMUP, iv])
        p.keyboard.press("ArrowRight")
        expect_totals(p, [WARMUP, interval(4, 210, 105, 180, 55)])
        p.keyboard.press("ArrowRight")
        p.keyboard.press("Shift+ArrowUp")
        expect_totals(p, [WARMUP, interval(4, 240, 106, 180, 55)])
        for _ in range(4):
            p.keyboard.press("Shift+ArrowUp")
        p.keyboard.press("+")
        expect_totals(p, [WARMUP, interval(5, 240, 110, 180, 55)])
        add_step(p, "Add cool-down")
        expect_totals(p, FIVES)
        totals = p.get_by_role("group", name="Workout totals")
        poll(p, lambda: "Duration 0:55:00" in text_of(totals) and "Planned 58.1 TSS" in text_of(totals) and "IF 0.80" in text_of(totals),
             "the brief's example reads 0:55:00, 58.1 TSS, IF 0.80")


def test_wf_builder_keyboard_save(browser: Browser, app_url: str) -> None:
    t = tag("sav")
    w = World(app_url, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    cal_name, lib_name = f"Fives {t}", f"Library fives {t}"
    builder = f"/athletes/{aid}/builder?date={BUILDER_DAY}"
    with signed_in(browser, app_url, w.email("a1"), builder) as p:
        build_fives(p)
        p.get_by_role("textbox", name="Workout name").fill(cal_name)
        save = p.get_by_role("button", name="Save to calendar")
        save.focus()
        p.keyboard.press("Enter")
        say(p, "Builder announcements", f"Saved {cal_name} on {day_text(BUILDER_DAY)}.")
        found = find(weeks(api, aid, "2026-W45"), cal_name, "planned")
        assert len(found) == 1 and found[0][0] == BUILDER_DAY
        wo = found[0][2]
        assert wo["steps"] == FIVES and wo["source"] == "builder" and wo["duration_s"] == plan_seconds(FIVES)
        assert same(wo["planned_tss"], plan_tss(FIVES)) and same(wo["planned_if"], plan_if(FIVES))
        p.goto(f"{app_url}/athletes/{aid}?week=2026-W45")
        p.reload()
        it = item_in(p, BUILDER_DAY, cal_name)
        poll(p, lambda: it.count() == 1 and same(num(it.get_attribute("data-planned-tss")), rnd(plan_tss(FIVES), 1), 1e-9),
             "the day shows the workout with its planned stress after a reload")
        p.goto(app_url + builder)
        build_fives(p)
        p.get_by_role("textbox", name="Workout name").fill(lib_name)
        p.get_by_role("button", name="Save to library").click()
        say(p, "Builder announcements", f"Saved {lib_name} to your library.")
        lib = [x for x in api.get("/api/library").json()["library"] if x["name"] == lib_name]
        assert len(lib) == 1 and lib[0]["steps"] == FIVES and lib[0]["duration_s"] == plan_seconds(FIVES)
        assert same(lib[0]["planned_tss"], plan_tss(FIVES))
        p.goto(f"{app_url}/athletes/{aid}?week=2026-W45")
        panel = p.get_by_role("region", name="Workout library")
        poll(p, lambda: f"{lib_name} · 0:55:00 · 58.1 TSS" in text_of(panel), "library lists the saved workout")
        place = p.get_by_role("button", name=f"Place {lib_name}", exact=True)
        place.focus()
        p.keyboard.press("Enter")
        for _ in range(7):
            p.keyboard.press("ArrowRight")
        say(p, "Calendar announcements", "Sun 8 Nov")
        p.keyboard.press("ArrowLeft")
        say(p, "Calendar announcements", "Sat 7 Nov")
        p.keyboard.press("Enter")
        say(p, "Calendar announcements", f"Placed {lib_name} on Sat 7 Nov.")
        placed = find(weeks(api, aid, "2026-W45"), lib_name, "planned")
        assert len(placed) == 1 and placed[0][0] == SAT
        assert placed[0][2]["source"] == "library" and placed[0][2]["steps"] == FIVES
        p.reload()
        poll(p, lambda: item_in(p, "2026-11-07", lib_name).count() == 1, "the placed workout is still there after a reload")


def drag_sequence(p: Page, drag: Callable[[float, float, float, float], None]) -> None:
    p.get_by_role("button", name="Add steady").click()
    graph = p.get_by_role("group", name="Workout graph")
    duration_handle = graph.locator('[data-handle="duration"]')
    target_handle = graph.locator('[data-handle="target"]')
    poll(p, lambda: duration_handle.count() == 1 and target_handle.count() == 1, "the bar offers both handles")
    width = p.viewport_size["width"]
    spp = num(graph.get_attribute("data-seconds-per-px"))
    assert spp > 0
    x, y = center(duration_handle.first)
    dx = min(max(math.ceil(90 / spp), 20), int(width - x - 5))
    want = clamp(snap30(STEADY_S + dx * spp), MIN_STEP_S, MAX_STEP_S)
    drag(x, y, x + dx, y)
    poll(p, lambda: abs(option_attrs(p)[0]["duration"] - want) <= 30 and option_attrs(p)[0]["duration"] % 30 == 0
         and option_attrs(p)[0]["duration"] != STEADY_S, f"dragging the right edge by {dx}px snaps near {want}s")
    got = int(option_attrs(p)[0]["duration"])
    say(p, "Builder announcements", f"Steady {fmt_dur(got)} at {STEADY_PCT}%.")
    assert num(data_of(p.get_by_role("group", name="Workout totals"), "data-duration-s")) == got
    ppp = num(graph.get_attribute("data-percent-per-px"))
    assert ppp > 0
    x, y = center(target_handle.first)
    dy = min(max(math.ceil(10 / ppp), 10), int(y - 5))
    want_pct = int(clamp(rnd(STEADY_PCT + dy * ppp), MIN_PCT, MAX_PCT))
    drag(x, y, x, y - dy)
    poll(p, lambda: abs(option_attrs(p)[0]["target"] - want_pct) <= 1 and option_attrs(p)[0]["target"] != STEADY_PCT,
         f"dragging the top edge up by {dy}px raises the target near {want_pct}%")
    pct = int(option_attrs(p)[0]["target"])
    say(p, "Builder announcements", f"Steady {fmt_dur(got)} at {pct}%.")
    spp = num(graph.get_attribute("data-seconds-per-px"))
    x, y = center(duration_handle.first)
    dx = -min(math.ceil((got + 300) / spp), int(x) - 5)
    want = clamp(snap30(got + dx * spp), MIN_STEP_S, MAX_STEP_S)
    drag(x, y, x + dx, y)
    poll(p, lambda: abs(option_attrs(p)[0]["duration"] - want) <= 30 and option_attrs(p)[0]["duration"] < got,
         "dragging the right edge far left shortens the step")
    if want == MIN_STEP_S:
        assert option_attrs(p)[0]["duration"] == MIN_STEP_S, "the duration is clamped at 0:00:30"


def test_wf_builder_drag_mouse(browser: Browser, app_url: str) -> None:
    t = tag("drm")
    w = World(app_url, t, mini(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}/builder?date={BUILDER_DAY}", viewport=(1280, 800)) as p:
        poll(p, lambda: steps_box(p).count() == 1, "Steps list")
        drag_sequence(p, lambda x1, y1, x2, y2: mouse_drag(p, x1, y1, x2, y2))
        totals = p.get_by_role("group", name="Workout totals")
        before = num(data_of(totals, "data-duration-s"))
        x, y = center(p.get_by_role("group", name="Workout graph").locator('[data-handle="duration"]').first)
        p.mouse.move(x, y)
        p.mouse.down()
        p.mouse.move(x + 60, y, steps=6)
        poll(p, lambda: num(data_of(totals, "data-duration-s")) > before, "totals update during the drag")
        p.mouse.up()


def test_wf_builder_drag_touch(browser: Browser, app_url: str) -> None:
    t = tag("drt")
    w = World(app_url, t, mini(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}/builder?date={BUILDER_DAY}", viewport=(768, 1024), touch=True) as p:
        poll(p, lambda: steps_box(p).count() == 1, "Steps list")
        touch = Touch(p)
        drag_sequence(p, lambda x1, y1, x2, y2: touch.drag(x1, y1, x2, y2))


def test_wf_calendar_move_keyboard(browser: Browser, app_url: str) -> None:
    t = tag("mvk")
    w = World(app_url, t, demo(t))
    aid, api, mara = w.id("a1"), w.api("a1"), w.api("c1")
    w5, w6 = w.id("w5"), w.id("w6")
    v5 = workout(api, w5)["workout"]["version"]
    picked = ("Picked up Fives at 110. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel.")
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week=2026-W45") as p:
        move = move_button(p, "Fives at 110")
        poll(p, lambda: move.count() == 1, "an unmatched planned item offers Move")
        assert move_button(p, "Endurance hour").count() == 0, "a paired item offers no Move"
        move.focus()
        p.keyboard.press("Enter")
        say(p, "Calendar announcements", picked)
        p.keyboard.press("ArrowLeft")
        say(p, "Calendar announcements", "Wed 4 Nov")
        p.keyboard.press("Enter")
        say(p, "Calendar announcements", "Pick today or a later day.")
        poll(p, lambda: item_in(p, TODAY, "Fives at 110").count() == 1 and has_focus(move), "the refused item returns to its day")
        assert workout(api, w5)["workout"]["date"] == TODAY
        p.keyboard.press("Enter")
        say(p, "Calendar announcements", picked)
        p.keyboard.press("ArrowRight")
        say(p, "Calendar announcements", "Fri 6 Nov")
        p.keyboard.press("Escape")
        say(p, "Calendar announcements", "Move of Fives at 110 cancelled.")
        assert workout(api, w5)["workout"]["date"] == TODAY
        p.keyboard.press("Enter")
        p.keyboard.press("ArrowRight")
        say(p, "Calendar announcements", "Fri 6 Nov")
        p.keyboard.press("ArrowRight")
        say(p, "Calendar announcements", "Sat 7 Nov")
        p.keyboard.press("ArrowLeft")
        say(p, "Calendar announcements", "Fri 6 Nov")
        p.keyboard.press("Enter")
        say(p, "Calendar announcements", "Moved Fives at 110 to Fri 6 Nov.")
        poll(p, lambda: item_in(p, "2026-11-06", "Fives at 110").count() == 1 and has_focus(move_button(p, "Fives at 110")),
             "the item sits on Friday and focus stays on its Move button")
        long_move = move_button(p, "Long ride")
        long_move.focus()
        p.keyboard.press("Enter")
        for _ in range(3):
            p.keyboard.press("ArrowRight")
        say(p, "Calendar announcements", "Sun 8 Nov")
        p.keyboard.press("Escape")
        assert workout(api, w6)["workout"]["date"] == SAT
        item_in(p, "2026-11-07", "Long ride").drag_to(chip(p, "2026-11-08"))
        poll(p, lambda: item_in(p, "2026-11-08", "Long ride").count() == 1, "dragging the item onto Sunday moves it")
    moved = workout(api, w5)["workout"]
    assert moved["date"] == FRI and moved["version"] == v5 + 1
    assert workout(api, w6)["workout"]["date"] == SUN
    locked = {"error": "locked", "message": "Completed sessions stay on their day."}
    for key in ("w1", "w2"):
        v = workout(mara, w.id(key))["workout"]["version"]
        r = mara.patch(f"/api/workouts/{w.id(key)}", json={"version": v, "date": TODAY})
        assert r.status_code == 409 and r.json() == locked, key
    cur = workout(mara, w5)["workout"]["version"]
    r = mara.patch(f"/api/workouts/{w5}", json={"version": cur, "date": "2026-11-04"})
    assert r.status_code == 422 and r.json()["errors"]["date"] == "Pick today or a later day."
    r = mara.patch(f"/api/workouts/{w5}", json={"version": v5, "date": "2026-11-04"})
    assert r.status_code == 422, "validation answers before the state conflict"
    r = mara.patch(f"/api/workouts/{w5}", json={"version": v5, "date": "2026-11-07"})
    assert r.status_code == 409 and r.json() == {"error": "stale", "message": "This workout changed since you opened it. Reload to see the latest."}
    r = mara.post(f"/api/athletes/{aid}/workouts", json={"date": "2026-11-04", "sport": "bike", "title": f"Past {t}", "duration_s": 3600})
    assert r.status_code == 422 and r.json()["errors"]["date"] == "Pick today or a later day."
    assert find(weeks(mara, aid, "2026-W45"), f"Past {t}") == []


def test_week_totals_and_tally(browser: Browser, app_url: str) -> None:
    t = tag("wk")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    r = api.get(f"/api/athletes/{aid}/weeks", params={"week": "2026-W45"})
    assert r.status_code == 200 and r.json()["today"] == TODAY
    listed = r.json()["weeks"]
    first_week = (date.fromisoformat(MONDAY) - timedelta(weeks=4)).strftime("%G-W%V")
    assert len(listed) == 9 and listed[0]["week"] == first_week and listed[4]["week"] == WEEK, "before and after default to 4"
    assert all(len(x["days"]) == 7 for x in listed)
    wk = week_row(api, aid, "2026-W45")
    assert wk["monday"] == "2026-11-02"
    assert same(wk["planned_tss"], 311.25) and same(wk["completed_tss"], sum(tavi_tss().values()))
    tally = {"on-target": 1, "close": 0, "off-target": 0, "missed": 1, "unplanned": 1, "planned": 2}
    assert wk["tally"] == tally
    sp = wk["sports"]
    assert same(sp["bike_tss"], 64.0) and same(sp["run_tss"], tavi_tss()["2026-11-04"]) and sp["sessions"] == 2
    assert sp["bike_s"] == 3600 and sp["run_s"] == 45 * 60
    s = model_series(SERIES_START, TODAY, tavi_tss())
    assert same(wk["tsb"], s[TODAY]["tsb"]), "form is the TSB of the earlier of next Monday and today"
    assert same(week_row(api, aid, "2026-W44")["tsb"], s["2026-11-02"]["tsb"]), "a past week's form is the TSB of the following Monday"
    assert same(week_row(api, aid, "2026-W46")["tsb"], s[TODAY]["tsb"]), "a future week's form is today's TSB"
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        tile = week_tile(p, "2026-11-02")
        line = "On target 1 · Close 0 · Off target 0 · Missed 1 · Unplanned 1 · Planned 2"
        poll(p, lambda: all(x in text_of(tile) for x in ("Planned 311.3 TSS", "Completed 126.0 TSS", f"Form {fmt_tsb(wk['tsb'])}", line)),
             "week tile text shows totals, form and tally")
        assert data_of(tile, "data-active") == "true"
        assert same(num(data_of(tile, "data-planned-tss")), 311.3, 1e-9) and same(num(data_of(tile, "data-completed-tss")), 126.0, 1e-9)
        assert same(num(data_of(tile, "data-tsb")), rnd(wk["tsb"], 1), 1e-9)
        for state, n in tally.items():
            assert num(data_of(tile, f"data-count-{state}")) == n, state
        prev = week_row(api, aid, "2026-W44")
        other = week_tile(p, "2026-10-26")
        poll(p, lambda: same(num(data_of(other, "data-planned-tss")), rnd(prev["planned_tss"], 1), 1e-9)
             and data_of(other, "data-active") != "true", "a neighbouring week tile carries its own totals")


def test_wf_calendar_move_live(browser: Browser, app_url: str) -> None:
    t = tag("lv")
    w = World(app_url, t, demo(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week=2026-W45") as cp, \
            signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as ap:
        poll(ap, lambda: item_in(ap, TODAY, "Fives at 110").count() == 1, "athlete calendar ready")
        move = move_button(cp, "Fives at 110")
        poll(cp, lambda: move.count() == 1, "coach sees Move")
        move.focus()
        cp.keyboard.press("Enter")
        say(cp, "Calendar announcements", "Picked up Fives at 110.")
        cp.keyboard.press("ArrowRight")
        say(cp, "Calendar announcements", "Fri 6 Nov")
        cp.keyboard.press("Enter")
        say(cp, "Calendar announcements", "Moved Fives at 110 to Fri 6 Nov.")
        poll(ap, lambda: item_in(ap, "2026-11-06", "Fives at 110").count() == 1 and item_in(ap, TODAY, "Fives at 110").count() == 0,
             "athlete sees the keyboard move", LIVE_WINDOW_S)
        item_in(cp, "2026-11-07", "Long ride").drag_to(chip(cp, "2026-11-08"))
        poll(ap, lambda: item_in(ap, "2026-11-08", "Long ride").count() == 1 and item_in(ap, "2026-11-07", "Long ride").count() == 0,
             "athlete sees the drag move", LIVE_WINDOW_S)
        r = w.api("c1").post(f"/api/athletes/{aid}/thresholds", json={"kind": "ftp", "value": 260, "effective_from": TODAY})
        assert r.status_code == 201
        region = ap.get_by_role("region", name="Thresholds")
        poll(ap, lambda: f"FTP 260 W from {long_day(TODAY)}" in text_of(region), "athlete sees the new threshold", LIVE_WINDOW_S)
    assert workout(w.api("a1"), w.id("w5"))["workout"]["date"] == FRI


def test_activity_formats(app_url: str) -> None:
    t = tag("fmt")
    w = World(app_url, t, mini(t, tz="Pacific/Auckland"))
    aid, api = w.id("a1"), w.api("a1")
    prefix = f"activities/{aid}/"
    crlf = b"t,power,heart_rate,speed\r\n" + b"".join(f"{i},200,140,\r\n".encode() for i in range(60)) + b"\r\n"
    nulls = json.dumps({"sport": "bike", "samples": [{"t": i, "power": 200, "heart_rate": None} if i % 2 else {"t": i, "power": 200}
                                                    for i in range(60)]}).encode()
    local = json.dumps({"sport": "run", "start": "2026-11-04T17:10:00", "samples": [{"t": i, "speed": 3.0} for i in range(60)]}).encode()
    extremes = b"t,power,heart_rate,speed\n" + b"".join(f"{i},{0 if i % 2 else 2500},{250 if i % 2 else 0},\n".encode() for i in range(60))
    accepted = [("crlf.csv", crlf, "bike", "2026-11-03", 60), ("RIDE.CSV", ride_csv([200] * 60), "bike", "2026-11-03", 60),
                ("nulls.JSON", nulls, None, "2026-11-03", 60), ("local.json", local, None, "2026-11-04", 60),
                ("extremes.csv", extremes, "bike", "2026-11-03", 60), ("fast.csv", run_csv([30.0] * 60), "run", "2026-11-03", 60)]
    for name, data, sport, day, n in accepted:
        r = upload(api, aid, name, data, sport, day, f"Format {name} {t}")
        assert r.status_code == 201, f"{name}: {r.status_code} {r.text[:200]}"
        wo = r.json()["workout"]
        assert wo["kind"] == "completed" and wo["source"] == "file" and wo["duration_s"] == n and wo["file"]["name"] == name
    r = upload(api, aid, "x.json", local, None, "2026-11-04", f"Local {t}")
    wo = r.json()["workout"]
    assert wo["date"] == "2026-11-04" and wo["start_local"] == "17:10", "a start without an offset is the athlete's local time"
    rejected = [("power.csv", b"t,power,heart_rate,speed\n0,2501,,\n", "bike", 2), ("hr.csv", b"t,power,heart_rate,speed\n0,200,251,\n", "bike", 2),
                ("speed.csv", b"t,power,heart_rate,speed\n0,,,30.1\n", "run", 2), ("late.csv", b"t,power,heart_rate,speed\n1,200,,\n", "bike", 2)]
    for name, data, sport, line in rejected:
        keys = S3().keys(prefix)
        r = upload(api, aid, name, data, sport, "2026-11-03", f"Rejected {name} {t}")
        assert r.status_code == 422 and r.json()["errors"]["file"] == f"Line {line} is not a valid sample.", f"{name}: {r.text[:200]}"
        assert S3().keys(prefix) == keys
    r = upload(api, aid, "start.json", json.dumps({"sport": "bike", "samples": [{"t": 1, "power": 200}]}).encode(), None, "2026-11-03", f"Late {t}")
    first_sample = 1
    assert r.status_code == 422 and r.json()["errors"]["file"] == f"Sample {first_sample} is not a valid sample."
    assert len(S3().keys(prefix)) == len(accepted) + 1


def test_power_scoring(browser: Browser, app_url: str) -> None:
    t = tag("pow")
    w = World(app_url, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    mixed = [100] * 45 + [300] * 45 + [180] * 40
    cases = [("flat", [200] * 3600, "2026-11-02"), ("step", [200] * 30 + [230] * 30, "2026-11-03"),
             ("short", [240] * 10, "2026-11-03"), ("mixed", mixed, "2026-11-04")]
    made: dict[str, dict[str, Any]] = {}
    for label, values, day in cases:
        r = upload(api, aid, f"{label}.csv", ride_csv(values), "bike", day, f"{label} {t}")
        assert r.status_code == 201, r.text[:200]
        wo = r.json()["workout"]
        np_, if_, tss = bike_score([float(v) for v in values], 250)
        assert same(wo["np_w"], np_) and same(wo["if"], if_) and same(wo["tss"], tss), label
        made[label] = wo
    assert fmt1(made["flat"]["tss"]) == "64.0" and fmt2(made["flat"]["if"]) == "0.80"
    assert same(made["step"]["np_w"], 215.556, 5e-4) and fmt1(made["step"]["tss"]) == "1.2" and fmt2(made["step"]["if"]) == "0.86"
    assert same(made["short"]["np_w"], 240.0), "files under 30 samples use the mean power"
    with signed_in(browser, app_url, w.email("a1"), f"/workouts/{made['step']['id']}") as p:
        nums = p.get_by_role("group", name="Session numbers")
        poll(p, lambda: all(s in text_of(nums) for s in ("Normalised power 216 W", "IF 0.86", "1.2 TSS", "Duration 0:01:00")),
             "detail page shows 216 W, IF 0.86, 1.2 TSS, 0:01:00 (L123)")
        assert data_of(nums, "data-np") == "216" and data_of(nums, "data-if") == "0.86"
        assert data_of(nums, "data-tss") == "1.2" and data_of(nums, "data-duration-s") == "60"


def test_storage_confirmed_upload(app_url: str) -> None:
    t = tag("sto")
    w = World(app_url, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    csv = ride_csv([200 + i % 7 for i in range(300)])
    doc = activity_json("bike", [210] * 120)
    for name, data, sport, ext, ctype in (("stored.csv", csv, "bike", "csv", "text/csv"), ("stored.json", doc, None, "json", "application/json")):
        title = f"Stored {ext} {t}"
        r = upload(api, aid, name, data, sport, "2026-11-03", title)
        assert r.status_code == 201, r.text[:200]
        wo = r.json()["workout"]
        key = f"activities/{aid}/{wo['id']}.{ext}"
        assert key in S3().keys(f"activities/{aid}/")
        assert S3().get(key) == data
        assert wo["file"] == {"name": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "content_type": ctype}
        assert workout(api, wo["id"])["workout"]["file"]["sha256"] == hashlib.sha256(data).hexdigest()
        assert db_mentions(Postgres(), title) >= 1
    refused = upload(api, aid, "bad.csv", b"t,power,heart_rate,speed\n0,x,,\n", "bike", "2026-11-03", f"Never {t}")
    assert refused.status_code == 422
    assert len(S3().keys(f"activities/{aid}/")) == 2, "a refused file leaves no object"


RATIO_CASES = [("on-low", 3600, 2880, "on-target"), ("on-high", 3600, 4320, "on-target"), ("close-low", 3600, 2879, "close"),
               ("close-high", 3600, 4321, "close"), ("close-half", 3600, 1800, "close"), ("close-top", 3600, 5400, "close"),
               ("off-low", 3600, 1799, "off-target"), ("off-high", 3600, 5401, "off-target")]


def test_compliance_states(app_url: str) -> None:
    t = tag("cmp")
    first = d(COMPLIANCE_FIRST_DAY)
    recs: list[dict[str, Any]] = []
    expect: dict[tuple[str, str], str] = {}
    day_no = 0

    def day() -> str:
        nonlocal day_no
        day_no += 1
        return (first + timedelta(days=day_no - 1)).isoformat()

    for label, planned_s, done_s, state in RATIO_CASES:
        title, ds = f"{label} {t}", day()
        recs += [planned_rec(t, f"{label}-p", "a1", ds, title, "bike", duration_s=planned_s),
                 manual_rec(t, f"{label}-c", "a1", ds, title, "bike", done_s, power=200)]
        expect[(title, "completed")] = state
    ds = day()
    recs += [planned_rec(t, "tssoff-p", "a1", ds, f"tss-off {t}", "bike", steps=[steady(3600, 50)]),
             manual_rec(t, "tssoff-c", "a1", ds, f"tss-off {t}", "bike", 3600, power=250)]
    expect[(f"tss-off {t}", "completed")] = "off-target"
    ds = day()
    recs += [planned_rec(t, "tssclose-p", "a1", ds, f"tss-close {t}", "bike", steps=[steady(3600, 100)]),
             manual_rec(t, "tssclose-c", "a1", ds, f"tss-close {t}", "bike", 3600, power=200)]
    expect[(f"tss-close {t}", "completed")] = "close"
    ds = day()
    recs.append(planned_rec(t, "skipped", "a1", ds, f"skipped {t}", "bike", duration_s=3600))
    expect[(f"skipped {t}", "planned")] = "missed"
    ds = day()
    recs.append(manual_rec(t, "extra", "a1", ds, f"extra {t}", "bike", 3600, power=200))
    expect[(f"extra {t}", "completed")] = "unplanned"
    ds = day()
    recs += [planned_rec(t, "second", "a1", ds, f"second {t}", "bike", duration_s=3600, start_local="18:00"),
             planned_rec(t, "first", "a1", ds, f"first {t}", "bike", duration_s=3600, start_local="06:30"),
             manual_rec(t, "done", "a1", ds, f"done {t}", "bike", 3600, power=200)]
    expect[(f"done {t}", "completed")] = "on-target"
    expect[(f"second {t}", "planned")] = "missed"
    ds = day()
    recs += [planned_rec(t, "runplan", "a1", ds, f"runplan {t}", "run", duration_s=3600),
             manual_rec(t, "bikedone", "a1", ds, f"bikedone {t}", "bike", 3600, power=200)]
    expect[(f"runplan {t}", "planned")] = "missed"
    expect[(f"bikedone {t}", "completed")] = "unplanned"
    recs.append(planned_rec(t, "future", "a1", "2026-11-10", f"future {t}", "bike", duration_s=3600))
    expect[(f"future {t}", "planned")] = "planned"
    w = World(app_url, t, mini(t, workouts=recs))
    aid, api = w.id("a1"), w.api("a1")
    ws = weeks(api, aid, "2026-W41", after=5)
    for (title, kind), state in expect.items():
        found = find(ws, title, kind)
        assert len(found) == 1, f"{title} appears once"
        assert found[0][1]["compliance"] == state, f"{title}: {found[0][1]['compliance']} != {state}"
    for label, planned_s, done_s, _ in RATIO_CASES:
        item = find(ws, f"{label} {t}", "completed")[0][1]
        assert same(item["ratio"], done_s / planned_s, 1e-9), label
    paired = find(ws, f"done {t}", "completed")[0][1]
    assert paired["planned"]["title"] == f"first {t}", "pairs follow start time, not creation order"
    assert find(ws, f"second {t}", "planned")[0][1]["completed"] is None


def test_wf_power_file_tss_threshold(browser: Browser, app_url: str) -> None:
    t = tag("thr")
    f5 = ride_csv([200] * 3600)
    body = mini(t, ftp=250, extra_thresholds=({"kind": "ftp", "value": 280, "effective_from": "2026-10-10"},),
                files=[file_rec(t, "file5", "f5.csv", f5)],
                workouts=[manual_rec(t, "s30", "a1", "2026-09-30", f"Ride s30 {t}", "bike", 3600, power=200),
                          manual_rec(t, "o1", "a1", "2026-10-01", f"Ride o1 {t}", "bike", 3600, power=200),
                          manual_rec(t, "run", "a1", "2026-10-02", f"Run {t}", "run", 2700, pace=330),
                          file_workout(t, "f5", "a1", "2026-10-05", f"Ride f5 {t}", "bike", "file5"),
                          manual_rec(t, "o20", "a1", "2026-10-20", f"Ride o20 {t}", "bike", 3600, power=200)])
    w = World(app_url, t, body)
    aid, api, mara = w.id("a1"), w.api("a1"), w.api("c1")
    before = series(api, aid)
    assert same(workout(api, w.id("o1"))["workout"]["tss"], 64.0)
    assert same(workout(api, w.id("o20"))["workout"]["tss"], manual_bike(3600, 200, 280))
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week=2026-W45") as p:
        region = p.get_by_role("region", name="Thresholds")
        poll(p, lambda: region.count() == 1, "Thresholds region")
        region.get_by_role("textbox", name="FTP").fill("265")
        region.get_by_role("textbox", name="Effective from").fill("2026-10-01")
        region.get_by_role("button", name="Save threshold").click()
        say(p, "Threshold status", f"FTP 265 W from {long_day('2026-10-01')}. Re-scored 2 workouts.")
        poll(p, lambda: f"FTP 265 W from {long_day('2026-10-01')}" in text_of(region), "history lists the new FTP")
        o1 = workout(api, w.id("o1"))["workout"]
        assert same(o1["tss"], manual_bike(3600, 200, 265)) and fmt2(o1["if"]) == "0.75" and fmt1(o1["tss"]) == "57.0"
        assert same(workout(api, w.id("f5"))["workout"]["tss"], bike_score([200.0] * 3600, 265)[2])
        assert same(workout(api, w.id("s30"))["workout"]["tss"], 64.0), "a ride before the effective date keeps its stress"
        assert same(workout(api, w.id("o20"))["workout"]["tss"], manual_bike(3600, 200, 280)), "a ride after the next entry keeps its stress"
        assert same(workout(api, w.id("run"))["workout"]["tss"], manual_run(2700, 330, 300)), "another sport is not re-scored"
        p.goto(f"{app_url}/workouts/{w.id('s30')}")
        nums = p.get_by_role("group", name="Session numbers")
        poll(p, lambda: "64.0 TSS" in text_of(nums), "the 30 Sep ride still shows 64.0 TSS on its page")
    after = series(api, aid)
    for ds, row in before.items():
        if ds < "2026-10-01":
            assert after[ds] == row, f"{ds} is before the change and must not move"
    tss = {"2026-09-30": 64.0, "2026-10-01": manual_bike(3600, 200, 265), "2026-10-02": manual_run(2700, 330, 300),
           "2026-10-05": bike_score([200] * 3600, 265)[2], "2026-10-20": manual_bike(3600, 200, 280)}
    model = model_series(SERIES_START, TODAY, tss)
    for ds in days_between("2026-10-01", TODAY):
        assert all(same(after[ds][k], model[ds][k]) for k in ("tss", "ctl", "atl", "tsb")), ds
    mara = w.api("c1")
    r = mara.post(f"/api/athletes/{aid}/thresholds", json={"kind": "ftp", "value": 270, "effective_from": "2026-10-01"})
    assert r.status_code == 200 and r.json()["rescored"] == 2 and r.json()["series_from"] == "2026-10-01"
    assert same(workout(api, w.id("o1"))["workout"]["tss"], manual_bike(3600, 200, 270))
    bad = [({"kind": "ftp", "value": 49, "effective_from": "2026-10-01"}, "value", "Enter an FTP from 50 to 600 W."),
           ({"kind": "pace", "value": 149, "effective_from": "2026-10-01"}, "value", "Enter a threshold pace from 2:30 to 15:00 per km."),
           ({"kind": "ftp", "value": 250, "effective_from": "1 Oct"}, "effective_from", "Enter a date as YYYY-MM-DD.")]
    for payload, field, msg in bad:
        r = mara.post(f"/api/athletes/{aid}/thresholds", json=payload)
        assert r.status_code == 422 and r.json()["errors"][field] == msg


def test_run_scoring(browser: Browser, app_url: str) -> None:
    t = tag("run")
    w = World(app_url, t, mini(t, extra_thresholds=({"kind": "pace", "value": 270, "effective_from": "2026-11-04"},)))
    aid, api = w.id("a1"), w.api("a1")
    r = upload(api, aid, "run.csv", run_csv([3.0] * 3600), "run", "2026-11-03", f"Steady run {t}")
    assert r.status_code == 201, r.text[:200]
    wo = r.json()["workout"]
    assert same(wo["ns_mps"], 3.0) and same(wo["if"], 0.9) and same(wo["tss"], 81.0)
    mixed = [3.0] * 30 + [4.0] * 30
    r = upload(api, aid, "mix.csv", run_csv(mixed), "run", "2026-11-02", f"Mixed {t}")
    ns, if_, tss = run_score(mixed, 300)
    assert same(r.json()["workout"]["ns_mps"], ns) and same(r.json()["workout"]["tss"], tss)
    r = upload(api, aid, "late.csv", run_csv([3.0] * 1800), "run", "2026-11-04", f"Late {t}")
    assert same(r.json()["workout"]["tss"], run_score([3.0] * 1800, 270)[2]), "the 4 Nov pace of 4:30 is in force"
    r = api.post(f"/api/athletes/{aid}/manual", json={"date": "2026-11-02", "sport": "run", "title": f"Hand {t}", "duration_s": 2700, "avg_pace_s_per_km": 330})
    assert r.status_code == 201 and same(r.json()["workout"]["tss"], manual_run(2700, 330, 300))
    assert fmt2(r.json()["workout"]["if"]) == "0.91" and fmt1(r.json()["workout"]["tss"]) == "62.0"
    with signed_in(browser, app_url, w.email("a1"), f"/workouts/{wo['id']}") as p:
        nums = p.get_by_role("group", name="Session numbers")
        poll(p, lambda: all(s in text_of(nums) for s in ("Normalised pace 5:33 /km", "IF 0.90", "81.0 TSS", "Duration 1:00:00")),
             "run detail shows normalised pace, IF and TSS (L123)")


def test_wf_run_file_states_timezone(browser: Browser, app_url: str) -> None:
    t = tag("tz")
    w = World(app_url, t, demo(t))
    aid, tavi, mara = w.id("a1"), w.api("a1"), w.api("c1")
    title = f"Dawn run {t}"
    data = activity_json("run", [3.0] * 1800, start="2026-11-04T17:10:00Z")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as ap:
        dialog = open_log_dialog(ap, TODAY)
        choose_upload(dialog, "Run", title, "dawn.json", data)
        dialog.get_by_role("button", name="Upload session").click()
        say(ap, "Session status", f"Saved {title}: 40.5 TSS.")
    found = find(weeks(mara, aid, "2026-W45"), title, "completed")
    assert len(found) == 1
    ds, item, wo = found[0]
    assert ds == TODAY and wo["date"] == TODAY and wo["start_local"] == "06:10" and item["compliance"] == "unplanned"
    assert datetime.fromisoformat(wo["start_utc"].replace("Z", "+00:00")) == datetime(2026, 11, 4, 17, 10, tzinfo=timezone.utc)
    s = series(mara, aid)
    assert same(s[TODAY]["tss"], 40.5) and same(s["2026-11-04"]["tss"], tavi_tss()["2026-11-04"])
    completed = sum(tavi_tss().values()) + 40.5
    assert same(week_row(mara, aid, "2026-W45")["completed_tss"], completed)
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week=2026-W45") as cp:
        poll(cp, lambda: item_in(cp, TODAY, title).count() == 1 and item_in(cp, "2026-11-04", title).count() == 0,
             "the London coach sees the run on Thu 5 Nov, the athlete's local day")
        poll(cp, lambda: same(num(data_of(week_tile(cp, "2026-11-02"), "data-completed-tss")), rnd(completed, 1), 1e-9),
             "coach's week tile includes the run")
        poll(cp, lambda: any(r["date"] == TODAY and same(num(r["tss"]), 40.5, 1e-9) for r in table_rows(cp)),
             "coach's fitness table puts the run's stress on 5 Nov")


def test_wf_run_file_states_wrong_clock(browser: Browser, app_url: str) -> None:
    t = tag("clk")
    w = World(app_url, t, demo(t))
    aid = w.id("a1")
    for wrong in (datetime(2027, 6, 1, 12, tzinfo=timezone.utc), datetime(2026, 10, 1, 12, tzinfo=timezone.utc)):
        with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45", clock=wrong) as p:
            assert p.evaluate("new Date().getUTCFullYear()") == wrong.year, "infra: the page clock is the wrong one"
            states = {("2026-11-03", "Easy 45"): "missed", (TODAY, "Fives at 110"): "planned", ("2026-11-07", "Long ride"): "planned"}
            for (day, title), state in states.items():
                it = item_in(p, day, title)
                poll(p, lambda it=it, state=state: it.count() == 1 and it.get_attribute("data-compliance") == state and LEGEND[state] in text_of(it),
                     f"{title} reads {state} whatever the device clock")
            band = p.get_by_role("region", name="Next event")
            poll(p, lambda: "45 days to Harbour Half" in text_of(band) and num(data_of(band, "data-days")) == 45, "countdown uses the server's today")
            assert data_of(p.get_by_role("group", name="Fitness chart"), "data-focus-date") == TODAY
            p.clock.fast_forward(2 * 24 * 3600 * 1000)
            assert item_in(p, TODAY, "Fives at 110").get_attribute("data-compliance") == "planned", "device time passing changes nothing"


def test_series_formula(app_url: str) -> None:
    t = tag("ser")
    w = World(app_url, t, mini(t, start="2026-11-01", workouts=[manual_rec(t, "m", "a1", "2026-11-02", "Endurance hour", "bike", 3600, power=200)]))
    aid, api = w.id("a1"), w.api("a1")
    s = series(api, aid)
    assert sorted(s) == days_between("2026-11-01", TODAY)
    model = model_series("2026-11-01", TODAY, {"2026-11-02": 64.0})
    for ds in s:
        assert all(same(s[ds][k], model[ds][k]) for k in ("tss", "ctl", "atl", "tsb")), ds
    assert fmt1(s["2026-11-02"]["ctl"]) == "1.5" and fmt1(s["2026-11-02"]["atl"]) == "9.1" and fmt_tsb(s["2026-11-02"]["tsb"]) == "0.0"
    assert fmt_tsb(s["2026-11-03"]["tsb"]) == f"{MINUS}7.6" and fmt_tsb(s["2026-11-04"]["tsb"]) == f"{MINUS}6.3"
    assert fmt1(s["2026-11-03"]["ctl"]) == "1.5" and fmt1(s["2026-11-03"]["atl"]) == "7.8"
    assert list(series(api, aid, "2026-11-03", "2026-11-04")) == ["2026-11-03", "2026-11-04"]
    r = api.post(f"/api/athletes/{aid}/manual", json={"date": "2026-11-03", "sport": "bike", "title": f"Extra {t}", "duration_s": 1800, "avg_power_w": 250})
    assert r.status_code == 201
    s2 = series(api, aid)
    assert s2["2026-11-02"] == s["2026-11-02"]
    m2 = model_series("2026-11-01", TODAY, {"2026-11-02": 64.0, "2026-11-03": 50.0})
    assert all(same(s2[ds]["ctl"], m2[ds]["ctl"]) and same(s2[ds]["tsb"], m2[ds]["tsb"]) for ds in s2)
    assert api.delete(f"/api/workouts/{r.json()['workout']['id']}").status_code == 204
    assert all(same(series(api, aid)[ds]["atl"], model[ds]["atl"]) for ds in s)
    t2 = tag("ser0")
    w2 = World(app_url, t2, mini(t2, start="2026-11-01", start_ctl=40, start_atl=50))
    first = series(w2.api("a1"), w2.id("a1"))["2026-11-01"]
    assert same(first["tsb"], -10.0) and same(first["ctl"], 40 - 40 / 42) and same(first["atl"], 50 - 50 / 7)


def test_wf_fitness_chart_keyboard(browser: Browser, app_url: str) -> None:
    t = tag("chk")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    s = series(api, aid)
    drawn = days_between(SERIES_START, TODAY)
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45", viewport=(1280, 800)) as p:
        chart = p.get_by_role("group", name="Fitness chart")
        poll(p, lambda: len(chart_points(p)) == len(drawn), f"chart draws {len(drawn)} day points (L409)")
        assert [pt["date"] for pt in chart_points(p)] == drawn
        rows = table_rows(p)
        assert [r["date"] for r in rows] == drawn and all(row_matches(r, s[r["date"]]) for r in rows)
        assert all(point_matches(pt, s[pt["date"]]) for pt in chart_points(p))
        assert chart.get_attribute("data-focus-date") == TODAY
        assert data_of(chart.locator("[data-week]"), "data-week") == WEEK
        band_box = p.get_by_role("region", name="Today").bounding_box()
        card_box = chart.bounding_box()
        assert band_box and card_box and card_box["y"] < band_box["y"] + band_box["height"]
        chart.focus()
        p.keyboard.press("ArrowLeft")
        x = s["2026-11-04"]
        say(p, "Chart readout", f"{long_day('2026-11-04')}: {fmt1(x['tss'])} TSS, fitness {fmt1(x['ctl'])}, fatigue {fmt1(x['atl'])}, form {fmt_tsb(x['tsb'])}")
        assert chart.get_attribute("data-focus-date") == WED
        p.keyboard.press("Home")
        poll(p, lambda: chart.get_attribute("data-focus-date") == SERIES_START, "Home jumps to series_start")
        y = s[SERIES_START]
        say(p, "Chart readout", f"Tue 1 Sep 2026: {fmt1(y['tss'])} TSS, fitness {fmt1(y['ctl'])}, fatigue {fmt1(y['atl'])}, form {fmt_tsb(y['tsb'])}")
        p.keyboard.press("End")
        poll(p, lambda: chart.get_attribute("data-focus-date") == TODAY, "End jumps to today")
        p.keyboard.press("ArrowRight")
        poll(p, lambda: chart.get_attribute("data-focus-date") == TODAY, "no day after today is drawn")


def test_wf_fitness_chart_animation(browser: Browser, app_url: str) -> None:
    t = tag("anim")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    for mode, power in (("no-preference", 180), ("reduce", 160)):
        with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45", reduced_motion=mode) as p:
            chart = p.get_by_role("group", name="Fitness chart")
            poll(p, lambda: len(table_rows(p)) > 0, "fitness table rendered")
            r = api.post(f"/api/athletes/{aid}/manual", json={"date": TODAY, "sport": "bike", "title": f"Anim {mode} {t}", "duration_s": 1800, "avg_power_w": power})
            assert r.status_code == 201
            want = series(api, aid)[TODAY]
            row_now = lambda: any(x["date"] == TODAY and row_matches(x, want) for x in table_rows(p))
            if mode == "no-preference":
                poll(p, lambda: chart.get_attribute("data-animating") == "true", "chart morphs after the series change", step_ms=10)
                assert num(chart.get_attribute("data-animation-ms")) == CHART_ANIMATION_MS
                advance(p, CHART_ANIMATION_MS / 2)
                assert chart.get_attribute("data-animating") == "true", "still morphing halfway through"
                advance(p, CHART_ANIMATION_MS)
                poll(p, lambda: chart.get_attribute("data-animating") == "false" and row_now(), "morph finished with the new values", step_ms=10)
            else:
                deadline = time.monotonic() + WAIT_S
                while time.monotonic() < deadline:
                    assert chart.get_attribute("data-animating") != "true", "reduced motion never animates (L203)"
                    if row_now():
                        break
                    advance(p, 10)
                else:
                    pytest.fail("reduced-motion chart applied the new series")
                assert chart.get_attribute("data-animation-ms") == "0"


def test_wf_fitness_chart_delete(browser: Browser, app_url: str) -> None:
    t = tag("del")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Doomed {t}"
    r = upload(api, aid, "doomed.csv", ride_csv([200] * 3600), "bike", "2026-11-03", title)
    wid = r.json()["workout"]["id"]
    key = f"activities/{aid}/{wid}.csv"
    assert key in S3().keys(f"activities/{aid}/") and same(series(api, aid)["2026-11-03"]["tss"], 64.0)
    with signed_in(browser, app_url, w.email("a1"), f"/workouts/{wid}") as p:
        opener = p.get_by_role("button", name="Delete workout")
        poll(p, lambda: opener.count() == 1, "Delete workout pill")
        opener.click()
        dlg = p.get_by_role("dialog", name="Delete workout?")
        poll(p, lambda: dlg.count() == 1, "confirmation dialog")
        dlg.get_by_role("button", name="Keep it").click()
        assert api.get(f"/api/workouts/{wid}").status_code == 200 and key in S3().keys(f"activities/{aid}/")
        opener.click()
        dlg.get_by_role("button", name="Delete").click()
        say(p, "Notices", f"Deleted {title}.")
        poll(p, lambda: f"/athletes/{aid}" in p.url or urlsplit(p.url).path == "/", "navigates to the athlete home")
    assert api.get(f"/api/workouts/{wid}").json() == NOT_FOUND
    assert key not in S3().keys(f"activities/{aid}/")
    assert same(series(api, aid)["2026-11-03"]["tss"], 0.0)
    assert same(week_row(api, aid, "2026-W45")["completed_tss"], sum(tavi_tss().values()))


def test_numbers_agree(browser: Browser, app_url: str) -> None:
    t = tag("agree")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Agree {t}"
    day = "2026-11-03"

    def agree(p: Page, wid: str | None) -> None:
        wk = week_row(api, aid, "2026-W45")
        s = series(api, aid)

        def ok() -> bool:
            tile = week_tile(p, "2026-11-02")
            if not (same(num(data_of(tile, "data-completed-tss")), rnd(wk["completed_tss"], 1), 1e-9)
                    and same(num(data_of(tile, "data-planned-tss")), rnd(wk["planned_tss"], 1), 1e-9)
                    and same(num(data_of(tile, "data-tsb")), rnd(wk["tsb"], 1), 1e-9)):
                return False
            if not (same(num(data_of(p.get_by_role("group", name="Bike stress"), "data-value")), rnd(wk["sports"]["bike_tss"], 1), 1e-9)
                    and num(data_of(p.get_by_role("group", name="Sessions"), "data-value")) == wk["sports"]["sessions"]):
                return False
            if not same(num(data_of(p.get_by_role("region", name="Today"), "data-tsb")), rnd(s[TODAY]["tsb"], 1), 1e-9):
                return False
            pts = {x["date"]: x for x in chart_points(p)}
            rows = {x["date"]: x for x in table_rows(p)}
            if not (day in pts and point_matches(pts[day], s[day]) and day in rows and row_matches(rows[day], s[day])):
                return False
            it = item_in(p, day, title)
            if wid is None:
                return it.count() == 0
            wo = workout(api, wid)["workout"]
            return it.count() == 1 and same(num(it.get_attribute("data-tss")), rnd(wo["tss"], 1), 1e-9)
        poll(p, ok, "every home surface equals the API")

    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        r = upload(api, aid, "agree.csv", ride_csv([220] * 2400), "bike", day, title)
        wid = r.json()["workout"]["id"]
        agree(p, wid)
        assert w.api("c1").post(f"/api/athletes/{aid}/thresholds", json={"kind": "ftp", "value": 275, "effective_from": day}).status_code == 201
        agree(p, wid)
        p.reload()
        agree(p, wid)
        assert api.delete(f"/api/workouts/{wid}").status_code == 204
        agree(p, None)
        p.reload()
        agree(p, None)


FILE_CASE_IDS = ["too_large", "wrong_type", "bad_fields", "bad_header", "bad_json", "no_samples", "bad_csv_row",
                 "bad_json_sample", "missing_power", "missing_speed", "too_many_samples", "no_threshold"]


@pytest.mark.parametrize("case", FILE_CASE_IDS, ids=FILE_CASE_IDS)
def test_file_checks(app_url: str, case: str) -> None:
    t = tag("fc")
    w = World(app_url, t, mini(t, ftp=None if case == "no_threshold" else 250))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Refused {t}"
    day = "2026-11-03"
    good = ride_csv([200] * 60)
    if case == "too_large":
        args = ("big.txt", b"t" * (ACTIVITY_MAX_BYTES + 1), "swim", day)
        want = (413, {"error": "file_too_large", "message": f"This file is larger than {ACTIVITY_MAX_BYTES} bytes."})
    elif case == "wrong_type":
        args = ("ride.gpx", good, "swim", day)
        want = (415, {"error": "unsupported_type", "message": "Upload a .csv or .json activity file."})
    elif case == "bad_fields":
        args = ("ride.csv", b"nonsense\n", "swim", "2026/11/03")
        want = (422, {"errors": {"sport": "Choose bike or run.", "date": "Enter a date as YYYY-MM-DD."}})
    elif case == "bad_header":
        args = ("ride.csv", b"t,power,hr,speed\n0,200,,\n", "bike", day)
        want = (422, {"errors": {"file": "Line 1 must be t,power,heart_rate,speed."}})
    elif case == "bad_json":
        args = ("ride.json", b"{not json", None, day)
        want = (422, {"errors": {"file": "The file is not valid activity JSON."}})
    elif case == "no_samples":
        args = ("ride.json", json.dumps({"sport": "bike", "samples": []}).encode(), None, day)
        want = (422, {"errors": {"file": "The file has no samples."}})
    elif case == "bad_csv_row":
        args = ("ride.csv", b"t,power,heart_rate,speed\n0,200,,\n1,abc,,\n2,,,\n", "bike", day)
        want = (422, {"errors": {"file": "Line 3 is not a valid sample."}})
    elif case == "bad_json_sample":
        args = ("ride.json", json.dumps({"sport": "bike", "samples": [{"t": 0, "power": 200}, {"t": 2, "power": 200}]}).encode(), None, day)
        want = (422, {"errors": {"file": "Sample 2 is not a valid sample."}})
    elif case == "missing_power":
        args = ("ride.csv", b"t,power,heart_rate,speed\n0,200,,\n1,,140,\n", "bike", day)
        want = (422, {"errors": {"file": "Every sample needs power for a bike file."}})
    elif case == "missing_speed":
        args = ("run.csv", b"t,power,heart_rate,speed\n0,,150,3.0\n1,,150,\n", "run", day)
        want = (422, {"errors": {"file": "Every sample needs speed for a run file."}})
    elif case == "too_many_samples":
        args = ("ride.csv", ride_csv([150] * (ACTIVITY_MAX_SAMPLES + 1)), "bike", day)
        want = (422, {"errors": {"file": f"This file has more than {ACTIVITY_MAX_SAMPLES} samples."}})
    else:
        args = ("ride.csv", good, "bike", day)
        want = (422, {"errors": {"threshold": "No FTP is set on or before this day."}})
    before = series(api, aid)
    r = upload(api, aid, args[0], args[1], args[2], args[3], title)
    assert r.status_code == want[0], f"{case}: {r.status_code} {r.text[:300]}"
    body = r.json()
    if "errors" in want[1]:
        assert body["errors"] == want[1]["errors"]
    else:
        assert body["error"] == want[1]["error"] and body["message"] == want[1]["message"]
    assert find(weeks(api, aid, "2026-W45"), title) == []
    assert series(api, aid) == before
    assert S3().keys(f"activities/{aid}/") == []
    assert db_mentions(Postgres(), title) == 0
    if case == "too_many_samples":
        ok = upload(api, aid, "max.csv", ride_csv([150] * ACTIVITY_MAX_SAMPLES), "bike", day, f"Max {t}")
        assert ok.status_code == 201, "exactly the maximum number of samples is allowed"


def test_wf_bad_activity_file_ui(browser: Browser, app_url: str) -> None:
    t = tag("bfui")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Bad header {t}"
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, "2026-11-03", by_key=True)
        poll(p, lambda: has_focus(dialog), "focus starts inside the dialog (L150)")
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TAB_PRESSES):
                p.keyboard.press(key)
                assert has_focus(dialog), f"{key} stays inside the dialog"
        p.keyboard.press("Escape")
        opener = chip(p, TUE).get_by_role("button", name=f"Log session on {day_text(TUE)}")
        poll(p, lambda: (dialog.count() == 0 or not dialog.is_visible()) and has_focus(opener), "Escape closes and returns focus")
        dialog = open_log_dialog(p, "2026-11-03", by_key=True)
        choose_upload(dialog, "Bike", title, "bad.csv", b"t,power,hr,speed\n0,200,,\n")
        dialog.get_by_role("button", name="Upload session").press("Enter")
        alert = dialog.get_by_role("alert")
        poll(p, lambda: "Line 1 must be t,power,heart_rate,speed." in text_of(alert) and has_focus(alert), "focused alert with the server's message")
        assert dialog.is_visible() and selected_files(dialog) == ["bad.csv"]
    assert find(weeks(api, aid, "2026-W45"), title) == [] and S3().keys(f"activities/{aid}/") == []


def test_wf_bad_activity_file_recover(browser: Browser, app_url: str) -> None:
    t = tag("bfrec")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Second try {t}"
    good = ride_csv([200] * 3600)
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, "2026-11-03")
        choose_upload(dialog, "Bike", title, "bad.json", b"{not json")
        dialog.get_by_role("button", name="Upload session").click()
        poll(p, lambda: "The file is not valid activity JSON." in text_of(dialog.get_by_role("alert")), "alert shows the JSON error")
        dialog.get_by_label("Activity file").set_input_files({"name": "good-ride.csv", "mimeType": "text/csv", "buffer": good})
        with as_cm(held(p, "**/api/athletes/*/uploads")) as h:
            dialog.get_by_role("button", name="Upload session").click()
            say(p, "Session status", "Uploading good-ride.csv…")
            h.release()
        say(p, "Session status", f"Saved {title}: 64.0 TSS.")
    found = find(weeks(api, aid, "2026-W45"), title, "completed")
    assert len(found) == 1
    assert S3().keys(f"activities/{aid}/") == [f"activities/{aid}/{found[0][2]['id']}.csv"]
    assert S3().get(f"activities/{aid}/{found[0][2]['id']}.csv") == good


def test_plan_rest_weeks(app_url: str) -> None:
    t = tag("rest")
    body = mini(t, plans=[twelve_plan(t)])
    w = World(app_url, t, body)
    aid, mara = w.id("a1"), w.api("c1")
    pid = w.id("p1")
    r = mara.post(f"/api/plans/{pid}/apply", json={"athlete_id": aid, "mode": "event", "date": "2026-12-20", "event_name": f"Final {t}"})
    assert r.status_code == 201, r.text[:300]
    res = r.json()
    assert res["first_day"] == (d("2026-12-20") - timedelta(days=7 * 12 - 1)).isoformat() and res["last_day"] == "2026-12-20"
    assert (res["created"], res["skipped"], res["kept"]) == (20, 16, 0)
    rest_fives = [{"kind": "warmup", "duration_s": 360, "target_pct": 60},
                  {"kind": "interval", "repeat": 5, "work": {"duration_s": 150, "target_pct": 110}, "recovery": {"duration_s": 120, "target_pct": 55}},
                  {"kind": "cooldown", "duration_s": 360, "target_pct": 50}]
    by_day = {wo["date"]: wo for wo in res["workouts"]}
    for day in ("2026-11-17", "2026-12-15"):
        assert by_day[day]["steps"] == rest_fives and same(by_day[day]["planned_tss"], plan_tss(rest_fives))
    for day in ("2026-11-19", "2026-12-17"):
        assert by_day[day]["steps"] == [steady(1620, 75)]
    for day in ("2026-11-21", "2026-12-19"):
        assert by_day[day]["steps"] == [steady(4320, 70)]
    assert by_day["2026-11-24"]["steps"] == FIVES and by_day[TODAY]["steps"] == [steady(2700, 75)]
    assert all(wo["source"] == "plan" for wo in res["workouts"])
    events = w.api("a1").get(f"/api/athletes/{aid}").json()["events"]
    assert {"name": f"Final {t}", "date": "2026-12-20"} in [{"name": e["name"], "date": e["date"]} for e in events]
    r = mara.post("/api/plans", json={"name": f"Long {t}", "weeks": 25, "entries": []})
    assert r.status_code == 422 and r.json()["errors"]["weeks"] == "A plan runs 1 to 24 weeks."
    r = mara.post(f"/api/plans/{pid}/apply", json={"athlete_id": aid, "mode": "x", "date": "2026-12-20"})
    assert r.status_code == 422 and r.json()["errors"]["mode"] == "Choose start or event."
    r = mara.post(f"/api/plans/{pid}/apply", json={"athlete_id": aid, "mode": "event", "date": "2026-12-27"})
    assert r.status_code == 422 and r.json()["errors"]["event_name"] == "Enter an event name of 1 to 60 characters."
    assert w.api("a1").get("/api/plans").status_code == 404


def test_wf_plan_from_event_start(browser: Browser, app_url: str) -> None:
    t = tag("plstart")
    w = World(app_url, t, demo(t))
    aid, tavi = w.id("a1"), w.api("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as ap, \
            signed_in(browser, app_url, w.email("c1"), "/plans") as cp:
        poll(ap, lambda: item_in(ap, TODAY, "Fives at 110").count() == 1, "athlete calendar ready")
        apply_plan_ui(cp, "Tavi Rennick", "Start on", "2026-11-02")
        say(cp, "Plan status", "Added 35 workouts to Tavi Rennick's calendar. Skipped 1 on days that have already passed. "
                               "2 days already had workouts; they were kept alongside the plan.")
        poll(ap, lambda: item_in(ap, TODAY, "Easy 45").count() == 1, "athlete sees the plan's 5 Nov run", LIVE_WINDOW_S)
    ws = weeks(tavi, aid, "2026-W50", before=5, after=6)
    plan_items = [wo for _, _, wo in entries(ws) if wo["source"] == "plan"]
    assert len(plan_items) == 35
    assert not [wo for wo in plan_items if wo["date"] == TUE]
    assert workout(tavi, w.id("w5"))["workout"]["date"] == TODAY, "existing workouts are never changed"


def test_wf_plan_from_event_wrong_clock(browser: Browser, app_url: str) -> None:
    t = tag("plclk")
    w = World(app_url, t, demo(t))
    aid = w.id("a1")
    event = f"Ridge {t}"
    with signed_in(browser, app_url, w.email("c1"), "/plans", clock=datetime(2026, 10, 1, 9, tzinfo=timezone.utc)) as p:
        apply_plan_ui(p, "Tavi Rennick", "Count back from event", "2026-12-20", event)
        say(p, "Plan status", "Added 20 workouts to Tavi Rennick's calendar. Skipped 16 on days that have already passed. "
                              "2 days already had workouts; they were kept alongside the plan.")
    events = w.api("a1").get(f"/api/athletes/{aid}").json()["events"]
    assert any(e["name"] == event and e["date"] == "2026-12-20" for e in events)
    early = weeks(w.api("a1"), aid, "2026-W41", before=1, after=1)
    assert not [wo for _, _, wo in entries(early) if wo["source"] == "plan"], "past plan days are not created"


def test_wf_plan_from_event_dst(browser: Browser, app_url: str) -> None:
    t = tag("dst")
    body = demo(t)
    body["users"].append(athlete_user(t, "a4", "Ezra Blom", "Europe/Berlin", 280, 285))
    body["links"].append(link_rec(t, "l4", "c1", "a4"))
    w = World(app_url, t, body)
    aid, api = w.id("a4"), w.api("a4")
    berlin = ZoneInfo("Europe/Berlin")
    event_day = "2027-04-11"
    with signed_in(browser, app_url, w.email("c1"), "/plans") as p:
        apply_plan_ui(p, "Ezra Blom", "Count back from event", event_day, f"Spring {t}")
        say(p, "Plan status", f"Added {len(twelve_plan(t)['entries'])} workouts to {EZRA}'s calendar.")
    ws = weeks(api, aid, "2027-W08", before=6, after=7)
    plan_items = [wo for _, _, wo in entries(ws) if wo["source"] == "plan"]
    assert len(plan_items) == len(twelve_plan(t)["entries"]) and max(wo["date"] for wo in plan_items) <= event_day
    for wo in plan_items:
        local = datetime.combine(d(wo["date"]), datetime.strptime(wo["start_local"], "%H:%M").time(), berlin)
        assert wo["start_local"] in ("06:30", "07:00")
        assert datetime.fromisoformat(wo["start_utc"].replace("Z", "+00:00")) == local.astimezone(timezone.utc), wo["date"]
    before = [wo for wo in plan_items if wo["date"] < "2027-03-28" and wo["start_local"] == "06:30"]
    after = [wo for wo in plan_items if wo["date"] > "2027-03-28" and wo["start_local"] == "06:30"]
    assert before and after
    assert datetime.fromisoformat(before[0]["start_utc"].replace("Z", "+00:00")).hour == 5
    assert datetime.fromisoformat(after[0]["start_utc"].replace("Z", "+00:00")).hour == 4
    for day, want in (("2027-03-28", datetime(2027, 3, 28, 1, 30, tzinfo=timezone.utc)),
                      ("2027-10-31", datetime(2027, 10, 31, 0, 30, tzinfo=timezone.utc))):
        r = api.post(f"/api/athletes/{aid}/workouts", json={"date": day, "start_local": "02:30", "sport": "bike", "title": f"Edge {t}", "duration_s": 3600})
        assert r.status_code == 201, r.text[:200]
        assert datetime.fromisoformat(r.json()["workout"]["start_utc"].replace("Z", "+00:00")) == want, day


def test_wf_coach_copy_week_dialog_keyboard(browser: Browser, app_url: str) -> None:
    t = tag("cwkey")
    w = World(app_url, t, demo(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week=2026-W45") as p:
        opener = p.get_by_role("button", name="Copy week")
        poll(p, lambda: opener.count() == 1, "coach sees Copy week")
        opener.press("Enter")
        dlg = p.get_by_role("dialog", name="Copy week")
        poll(p, lambda: dlg.count() == 1 and has_focus(dlg), "dialog opens with focus inside")
        names = ["Endurance hour · Mon 2 Nov", "Easy 45 · Tue 3 Nov", "Fives at 110 · Thu 5 Nov", "Long ride · Sat 7 Nov"]
        for n in names:
            assert dlg.get_by_role("checkbox", name=n).count() == 1, n
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TAB_PRESSES):
                p.keyboard.press(key)
                assert has_focus(dlg), f"{key} wraps inside Copy week"
        box = dlg.get_by_role("checkbox", name=names[2])
        box.focus()
        p.keyboard.press("Space")
        poll(p, lambda: box.is_checked(), "Space checks the box")
        p.keyboard.press("Space")
        poll(p, lambda: not box.is_checked(), "Space unchecks it")
        dlg.get_by_role("button", name="Select all").press("Enter")
        poll(p, lambda: all(dlg.get_by_role("checkbox", name=n).is_checked() for n in names), "Select all checks every box")
        p.keyboard.press("Escape")
        poll(p, lambda: (dlg.count() == 0 or not dlg.is_visible()) and has_focus(opener), "Escape closes and returns focus")


def test_wf_coach_copy_week_copy(browser: Browser, app_url: str) -> None:
    t = tag("cwcopy")
    w = World(app_url, t, demo(t))
    aid, nid, noor, mara = w.id("a1"), w.id("a2"), w.api("a2"), w.api("c1")
    v5 = workout(w.api("a1"), w.id("w5"))["workout"]["version"]
    with signed_in(browser, app_url, w.email("a2"), f"/athletes/{nid}?week=2026-W45") as np_, \
            signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week=2026-W45") as cp:
        poll(np_, lambda: item_in(np_, "2026-11-02", "Tempo ride").count() == 1, "Noor's calendar ready")
        cp.get_by_role("button", name="Copy week").click()
        dlg = cp.get_by_role("dialog", name="Copy week")
        poll(cp, lambda: dlg.count() == 1, "Copy week dialog")
        for n in ("Easy 45 · Tue 3 Nov", "Fives at 110 · Thu 5 Nov", "Long ride · Sat 7 Nov"):
            check(dlg.get_by_role("checkbox", name=n))
        select(dlg.get_by_role("combobox", name="Copy to athlete"), "Noor Halvorsen")
        dlg.get_by_role("textbox", name="Target week").fill("2026-W45")
        dlg.get_by_role("button", name="Copy workouts").click()
        say(cp, "Copy status", "Copied 2 workouts to Noor Halvorsen. Skipped 1 on days that have already passed.")
        poll(np_, lambda: item_in(np_, TODAY, "Fives at 110").count() == 1 and item_in(np_, "2026-11-07", "Long ride").count() == 1,
             "Noor's open calendar shows the copies", LIVE_WINDOW_S)
    ws = weeks(noor, nid, "2026-W45")
    fives = find(ws, "Fives at 110", "planned")
    longr = find(ws, "Long ride", "planned")
    assert len(fives) == 1 and fives[0][0] == TODAY and fives[0][2]["start_local"] == "06:30" and fives[0][2]["steps"] == FIVES
    assert fives[0][2]["source"] == "copy" and same(fives[0][2]["planned_tss"], plan_tss(FIVES))
    assert len(longr) == 1 and longr[0][2]["start_local"] == "07:00"
    assert find(ws, "Easy 45") == []
    assert workout(w.api("a1"), w.id("w5"))["workout"]["version"] == v5, "the source is unchanged"
    with signed_in(browser, app_url, w.email("a2"), f"/workouts/{fives[0][2]['id']}") as p:
        poll(p, lambda: "110% · 231 W" in norm(p.locator("body").text_content()), "targets use Noor's FTP 210")
    body = {"week": "2026-W45", "workout_ids": [w.id("w6")], "to_athlete_id": w.id("a3"), "to_week": "2026-W46"}
    assert mara.post(f"/api/athletes/{aid}/copy-week", json=body).status_code == 404
    assert w.api("a1").post(f"/api/athletes/{aid}/copy-week", json=dict(body, to_athlete_id=nid)).status_code == 404
    r = mara.post(f"/api/athletes/{aid}/copy-week", json={"week": "2026-W46", "workout_ids": [w.id("w6")], "to_athlete_id": nid, "to_week": "2026-W46"})
    assert r.status_code == 422 and r.json()["errors"]["workout_ids"] == "Choose planned workouts from that week."


def test_wf_live_upload_comment_dashboard(browser: Browser, app_url: str) -> None:
    t = tag("dash")
    w = World(app_url, t, demo(t))
    aid = w.id("a1")
    title = f"Harbour loop {t}"
    with signed_in(browser, app_url, w.email("c1"), "/coach") as cp, \
            signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as ap:
        row = cp.get_by_role("table", name="Athletes").locator(f'[data-athlete-id="{aid}"]')
        poll(cp, lambda: same(num(data_of(row.locator("[data-completed-tss]"), "data-completed-tss")), 126.0, 1e-9), "row starts at 126.0")
        dialog = open_log_dialog(ap, TODAY)
        choose_upload(dialog, "Run", title, "loop.csv", run_csv([3.0] * 1800))
        dialog.get_by_role("button", name="Upload session").click()
        say(ap, "Session status", f"Saved {title}: 40.5 TSS.")
        say(cp, "Notices", f"Tavi Rennick logged {title}: 40.5 TSS.", LIVE_WINDOW_S)
        poll(cp, lambda: same(num(data_of(row.locator("[data-completed-tss]"), "data-completed-tss")), 166.5, 1e-9)
             and same(num(data_of(row.locator("[data-tss]"), "data-tss")), 40.5, 1e-9)
             and data_of(row.locator("[data-compliance]"), "data-compliance") == "unplanned", "row updates in place", LIVE_WINDOW_S)
    mine = [a for a in w.api("c1").get("/api/athletes").json()["athletes"] if a["id"] == aid][0]
    assert same(mine["week"]["completed_tss"], sum(tavi_tss().values()) + 40.5) and mine["latest"]["completed"]["title"] == title


def test_wf_live_upload_comment_comment(browser: Browser, app_url: str) -> None:
    t = tag("cmt")
    w = World(app_url, t, demo(t))
    wid = w.id("w2")
    body1, body2 = f"Nice pacing {t}", f"Thanks {t}"
    with signed_in(browser, app_url, w.email("c1"), f"/workouts/{wid}") as cp, \
            signed_in(browser, app_url, w.email("a1"), f"/workouts/{wid}") as ap:
        for pg in (cp, ap):
            poll(pg, lambda pg=pg: "Steady and even." in text_of(pg.get_by_role("list", name="Comments")), "existing comment shown")
        cp.get_by_role("textbox", name="Comment").fill(body1)
        cp.get_by_role("button", name="Post comment").click()
        comments = cp.get_by_role("list", name="Comments").get_by_role("listitem")
        poll(cp, lambda: body1 in text_of(comments.last), "the comment is appended at the end")
        poll(ap, lambda: body1 in text_of(ap.get_by_role("list", name="Comments")), "athlete sees the comment", LIVE_WINDOW_S)
        say(ap, "Notices", "Mara Quill commented on Endurance hour.", LIVE_WINDOW_S)
        ap.get_by_role("textbox", name="Comment").fill(body2)
        ap.get_by_role("button", name="Post comment").click()
        say(cp, "Notices", "Tavi Rennick commented on Endurance hour.", LIVE_WINDOW_S)
        poll(cp, lambda: body2 in text_of(cp.get_by_role("list", name="Comments")), "coach sees the reply", LIVE_WINDOW_S)
    got = w.api("a1").get(f"/api/workouts/{wid}/comments").json()["comments"]
    assert [c["body"] for c in got][-2:] == [body1, body2] and got[-2]["author_name"] == "Mara Quill"
    for bad in ("", "x" * 1001):
        r = w.api("c1").post(f"/api/workouts/{wid}/comments", json={"body": bad})
        assert r.status_code == 422 and r.json()["errors"]["body"] == "Write a comment of 1 to 1000 characters."
    assert w.api("c2").post(f"/api/workouts/{wid}/comments", json={"body": "hi"}).status_code == 404


def test_wf_live_upload_comment_download(browser: Browser, app_url: str) -> None:
    t = tag("dl")
    w = World(app_url, t, demo(t))
    aid = w.id("a1")
    title = f"Original {t}"
    fname = "ride-original.json"
    data = b'{ "sport":"bike",\r\n  "samples": [' + b",".join(b'{"t":%d,"power":205}' % i for i in range(90)) + b"] }\r\n"
    sha = hashlib.sha256(data).hexdigest()
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, "2026-11-03")
        choose_upload(dialog, "Bike", title, fname, data)
        dialog.get_by_role("button", name="Upload session").click()
        say(p, "Session status", f"Saved {title}:")
        wo = find(weeks(w.api("a1"), aid, "2026-W45"), title, "completed")[0][2]
        p.goto(f"{app_url}/workouts/{wo['id']}")
        link = p.get_by_role("link", name="Download original")
        poll(p, lambda: link.count() == 1 and f"SHA-256 {sha}" in norm(p.locator("body").text_content()), "detail shows SHA-256")
        assert p.locator(f'[data-sha256="{sha}"]').count() >= 1
        with p.expect_download() as info:
            link.click()
        assert Path(info.value.path()).read_bytes() == data
    r = w.api("c1").get(f"/api/workouts/{wo['id']}/original")
    assert r.status_code == 200 and r.content == data and r.headers["x-content-sha256"] == sha
    assert r.headers["content-type"].startswith("application/json")
    assert "attachment" in r.headers["content-disposition"] and f'filename="{fname}"' in r.headers["content-disposition"]
    assert S3().get(f"activities/{aid}/{wo['id']}.json") == data
    assert w.api("a1").get(f"/api/workouts/{w.id('w2')}/original").status_code == 404


def test_link_state_machine(app_url: str) -> None:
    t = tag("link")
    w = World(app_url, t, demo(t, ezra_link=None))
    ezra, mara = w.api("a3"), w.api("c1")
    r = ezra.post("/api/links", json={"coach_code": "ZZZZZZ"})
    assert r.status_code == 422 and r.json()["errors"]["coach_code"] == "No coach uses that code."
    r = ezra.post("/api/links", json={"coach_code": w.code("c1")})
    assert r.status_code == 201 and r.json()["link"]["status"] == "requested" and r.json()["link"]["coach_name"] == "Mara Quill"
    lid = r.json()["link"]["id"]
    r = ezra.post("/api/links", json={"coach_code": w.code("c1")})
    assert r.status_code == 409 and r.json() == {"error": "already_requested", "message": "You already have a pending request with this coach."}
    assert ezra.post(f"/api/links/{lid}/accept").status_code == 404, "accept is coach-only"
    mara2 = w.api("c1")
    barrier = threading.Barrier(2)
    results: list[httpx.Response] = []

    def fire(client: Api) -> None:
        barrier.wait()
        results.append(client.post(f"/api/links/{lid}/accept"))

    threads = [threading.Thread(target=fire, args=(c,)) for c in (mara, mara2)]
    [th.start() for th in threads]
    [th.join(HTTP_TIMEOUT) for th in threads]
    assert sorted(r.status_code for r in results) == [200, 409]
    loser = [r for r in results if r.status_code == 409][0]
    assert loser.json() == {"error": "not_pending", "message": "This request is no longer pending."}
    r = ezra.post("/api/links", json={"coach_code": w.code("c1")})
    assert r.status_code == 409 and r.json() == {"error": "already_linked", "message": "You are already linked with this coach."}
    assert ezra.delete(f"/api/links/{lid}").status_code == 204
    r = ezra.delete(f"/api/links/{lid}")
    assert r.status_code == 409 and r.json()["error"] == "not_pending"
    assert any(l["id"] == lid and l["status"] == "removed" for l in ezra.get("/api/links").json()["links"])
    r = ezra.post("/api/links", json={"coach_code": w.code("c1")})
    assert r.status_code == 201
    lid2 = r.json()["link"]["id"]
    assert mara.post(f"/api/links/{lid2}/decline").json()["link"]["status"] == "declined"
    assert ezra.post("/api/links", json={"coach_code": w.code("c1")}).status_code == 201, "a new request after declined"
    t2 = tag("linkexp")
    body = demo(t2, ezra_link=None)
    body["links"].append(link_rec(t2, "lx", "c1", "a3", "requested", expires_at="2020-01-01T00:00:00Z"))
    w2 = World(app_url, t2, body)
    lx = w2.id("lx")
    listed = [l for l in w2.api("c1").get("/api/links").json()["links"] if l["id"] == lx]
    assert listed and listed[0]["status"] == "expired"
    r = w2.api("c1").post(f"/api/links/{lx}/accept")
    assert r.status_code == 409 and r.json() == {"error": "expired", "message": "This request has expired. Ask the athlete to send a new one."}


def test_wf_coach_access_expiry_clock(browser: Browser, app_url: str) -> None:
    t = tag("inbox")
    body = demo(t, ezra_link=None)
    body["links"] = [link_rec(t, "l1", "c1", "a1"),
                     link_rec(t, "lx", "c1", "a3", "requested", expires_at="2020-01-01T00:00:00Z"),
                     link_rec(t, "ln", "c1", "a2", "requested")]
    w = World(app_url, t, body)
    for wrong in (datetime(2019, 12, 1, tzinfo=timezone.utc), datetime(2030, 1, 1, tzinfo=timezone.utc)):
        with signed_in(browser, app_url, w.email("c1"), "/inbox", clock=wrong) as p:
            lst = p.get_by_role("list", name="Link requests")
            poll(p, lambda: "Ezra Blom — Expired" in text_of(lst) and "Noor Halvorsen wants to join" in text_of(lst),
                 "inbox states come from the server's clock")
            if wrong.year == 2030:
                p.get_by_role("button", name=f"Accept {NOOR}").click()
                poll(p, lambda: "Noor Halvorsen is linked." in text_of(lst), "accepted item replaced")
    assert any(a["id"] == w.id("a2") for a in w.api("c1").get("/api/athletes").json()["athletes"])


def test_not_found_everywhere(browser: Browser, app_url: str) -> None:
    t = tag("nf")
    w = World(app_url, t, demo(t))
    other_t = tag("nfo")
    o = World(app_url, other_t, mini(other_t))
    mara, tavi, anon = w.api("c1"), w.api("a1"), Api(app_url)
    noor_w = w.id("n1")
    checks = [
        (mara, "get", f"/api/athletes/{o.id('a1')}", None),
        (mara, "get", f"/api/athletes/{w.id('a3')}/weeks", None),
        (mara, "get", f"/api/workouts/{o.id('a1')}", None),
        (mara, "post", "/api/links", {"coach_code": w.code("c2")}),
        (tavi, "get", f"/api/athletes/{w.id('a2')}", None),
        (tavi, "get", f"/api/workouts/{noor_w}", None),
        (tavi, "delete", f"/api/workouts/{noor_w}", None),
        (tavi, "get", "/api/plans", None),
        (tavi, "post", f"/api/links/{w.id('l3')}/accept", None),
        (tavi, "get", f"/api/nothing-here-{t}", None),
        (w.api("c2"), "get", f"/api/athletes/{w.id('a1')}/series", None),
    ]
    for client, method, path, body in checks:
        r = getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)
        assert r.status_code == 404 and r.json() == NOT_FOUND, f"{method} {path}: {r.status_code}"
    assert workout(w.api("a2"), noor_w)["workout"]["title"] == "Tempo ride"
    r = anon.get(f"/api/athletes/{o.id('a1')}")
    assert r.status_code == 401 and r.json() == UNAUTHENTICATED
    r = tavi.patch(f"/api/workouts/{noor_w}", json={"version": "x", "date": "bad"})
    assert r.status_code == 404
    r = tavi.post(f"/api/athletes/{w.id('a1')}/manual", json={"date": "bad", "sport": "bike", "title": "x", "duration_s": 3600, "avg_power_w": 200})
    assert r.status_code == 422
    r = tavi.get(f"/athletes/{w.id('a2')}")
    assert r.status_code == 404
    r = anon.get(f"/athletes/{w.id('a1')}")
    assert r.status_code == 303 and urlsplit(r.headers["location"]).path == "/sign-in"
    with signed_in(browser, app_url, w.email("a1"), f"/workouts/{noor_w}") as p:
        poll(p, lambda: p.get_by_role("heading", name="Not found").count() == 1, "not-found view")
        assert "This page isn't available to you." in norm(p.locator("body").text_content())
        assert p.get_by_role("link", name="Back to home").count() == 1


def test_wf_coach_access_link_and_remove(browser: Browser, app_url: str) -> None:
    t = tag("rm")
    w = World(app_url, t, demo(t, ezra_link=None))
    eid = w.id("a3")
    with signed_in(browser, app_url, w.email("c1"), "/inbox") as cp, \
            signed_in(browser, app_url, w.email("a3"), f"/athletes/{eid}") as ap:
        foot = ap.get_by_role("contentinfo")
        poll(ap, lambda: foot.get_by_role("textbox", name="Coach code").count() == 1, "navy footer coach-code form")
        foot.get_by_role("textbox", name="Coach code").fill(w.code("c1"))
        foot.get_by_role("button", name="Send request").click()
        poll(ap, lambda: "Request sent to Mara Quill. They'll appear under Coaches once they accept." in text_of(foot), "request confirmation")
        say(cp, "Notices", "Ezra Blom sent a link request.", LIVE_WINDOW_S)
        lst = cp.get_by_role("list", name="Link requests")
        poll(cp, lambda: "Ezra Blom wants to join" in text_of(lst), "inbox lists the request", LIVE_WINDOW_S)
        ap.goto(f"{app_url}/coaches")
        coaches = ap.get_by_role("list", name="Your coaches")
        poll(ap, lambda: "Mara Quill — Pending" in text_of(coaches), "pending coach shown")
        assert ap.get_by_role("button", name=f"Remove {MARA}").count() == 0
        cp.get_by_role("button", name=f"Accept {EZRA}").click()
        poll(cp, lambda: "Ezra Blom is linked." in text_of(lst), "accept confirmation")
        select(cp.get_by_role("combobox", name="Athlete"), "Ezra Blom")
        poll(cp, lambda: f"/athletes/{eid}" in cp.url and cp.get_by_role("region", name="Today").count() == 1, "switcher opens Ezra's home")
        ap.reload()
        remove = ap.get_by_role("button", name=f"Remove {MARA}")
        poll(ap, lambda: remove.count() == 1, "accepted coach has Remove")
        remove.click()
        ap.get_by_role("dialog", name="Remove coach?").get_by_role("button", name="Remove").click()
        poll(cp, lambda: cp.get_by_role("heading", name="Not found").count() == 1, "coach view becomes Not found", LIVE_WINDOW_S)
    assert w.api("c1").get(f"/api/athletes/{eid}").json() == NOT_FOUND
    assert w.api("c1").get(f"/athletes/{eid}").status_code == 404
    assert any(l["status"] == "removed" for l in w.api("a3").get("/api/links").json()["links"])


def test_manual_entry(browser: Browser, app_url: str) -> None:
    t = tag("man")
    w = World(app_url, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    base = {"date": "2026-11-04", "sport": "bike", "title": f"Hand {t}", "duration_s": 3600, "avg_power_w": 200}
    r = api.post(f"/api/athletes/{aid}/manual", json=base)
    assert r.status_code == 201 and same(r.json()["workout"]["tss"], 64.0) and r.json()["workout"]["source"] == "manual"
    r = api.post(f"/api/athletes/{aid}/manual", json={"date": "2026-11-04", "sport": "run", "title": f"Jog {t}", "duration_s": 2700, "avg_pace_s_per_km": 330})
    run_id = r.json()["workout"]["id"]
    assert same(r.json()["workout"]["tss"], manual_run(2700, 330, 300))
    bad_title = f"Bad {t}"
    cases = [({"duration_s": 59}, "duration_s", "Enter a duration from 0:01:00 to 24:00:00."),
             ({"duration_s": 86401}, "duration_s", "Enter a duration from 0:01:00 to 24:00:00."),
             ({"avg_power_w": 0}, "avg_power_w", "Enter an average power from 1 to 2000 W."),
             ({"avg_power_w": 2001}, "avg_power_w", "Enter an average power from 1 to 2000 W."),
             ({"date": "2026-11-06"}, "date", "Completed sessions cannot be in the future."),
             ({"date": "2026-08-31"}, "date", "This day is before the athlete's training history starts."),
             ({"date": "2026-13-01"}, "date", "Enter a date as YYYY-MM-DD."),
             ({"sport": "swim"}, "sport", "Choose bike or run."),
             ({"title": ""}, "title", "Enter a title of 1 to 80 characters."),
             ({"title": "x" * 81}, "title", "Enter a title of 1 to 80 characters.")]
    for change, field, msg in cases:
        r = api.post(f"/api/athletes/{aid}/manual", json=dict(base, title=bad_title, **change) if "title" not in change else dict(base, **change))
        assert r.status_code == 422 and r.json()["errors"][field] == msg, f"{change}: {r.text[:200]}"
    run = {"date": "2026-11-04", "sport": "run", "title": bad_title, "duration_s": 1800}
    for pace in (119, 1201):
        r = api.post(f"/api/athletes/{aid}/manual", json=dict(run, avg_pace_s_per_km=pace))
        assert r.status_code == 422 and r.json()["errors"]["avg_pace_s_per_km"] == "Enter a pace from 2:00 to 20:00 per km."
    r = api.post(f"/api/athletes/{aid}/manual", json={"date": "bad", "sport": "swim", "title": "", "duration_s": 5})
    assert r.status_code == 422 and {"date", "sport", "title", "duration_s"} <= set(r.json()["errors"])
    assert db_mentions(Postgres(), bad_title) == 0
    for ok in ({"duration_s": 60}, {"duration_s": 86400}, {"avg_power_w": 1}, {"avg_power_w": 2000}, {"title": "x" * 80}):
        assert api.post(f"/api/athletes/{aid}/manual", json=dict(base, **ok)).status_code == 201, ok
    with signed_in(browser, app_url, w.email("a1"), f"/workouts/{run_id}") as p:
        nums = p.get_by_role("group", name="Session numbers")
        poll(p, lambda: "IF 0.91" in text_of(nums) and "62.0 TSS" in text_of(nums) and "Duration 0:45:00" in text_of(nums), "manual run numbers")


def test_wf_phone_log_touch(browser: Browser, app_url: str) -> None:
    t = tag("phone")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Phone jog {t}"
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45", viewport=(375, 812), touch=True,
                   clock=datetime(2027, 6, 1, tzinfo=timezone.utc)) as p:
        rail = p.get_by_role("region", name="Week rail")
        poll(p, lambda: rail.get_attribute("data-week") == "2026-W45", "rail centred on today's week")
        page_layout(p)
        touch = Touch(p)
        b = rail_box(p, rail)
        y = b["y"] + min(b["height"] / 2, 150)
        touch.drag(b["x"] + b["width"] * 0.7, y, b["x"] + b["width"] * 0.7 - SWIPE_PX, y)
        advance(p, TRACK_MAX_MS)
        poll(p, lambda: rail.get_attribute("data-week") == "2026-W46" and location_week(p) == "2026-W46", "swipe advances to next week")
        touch.drag(b["x"] + b["width"] * 0.3, y, b["x"] + b["width"] * 0.3 + SWIPE_PX, y)
        advance(p, TRACK_MAX_MS)
        poll(p, lambda: rail.get_attribute("data-week") == "2026-W45", "swipe back")
        tap(chip(p, TODAY).get_by_role("button", name=f"Log session on {day_text(TODAY)}"))
        dlg = p.get_by_role("dialog", name="Log a session")
        poll(p, lambda: dlg.count() == 1, "dialog as a sheet")
        tap(dlg.get_by_role("tab", name="Enter by hand"))
        tap(dlg.get_by_role("radio", name="Run"))
        dlg.get_by_role("textbox", name="Title").fill("")
        dlg.get_by_role("textbox", name="Duration").fill("0:00:30")
        dlg.get_by_role("textbox", name="Average pace").fill("5:30")
        tap(dlg.get_by_role("button", name="Save session"))
        title_box = dlg.get_by_role("textbox", name="Title")
        poll(p, lambda: "Enter a title of 1 to 80 characters." in error_text(title_box) and has_focus(title_box), "title error attached and focused")
        assert "Enter a duration from 0:01:00 to 24:00:00." in error_text(dlg.get_by_role("textbox", name="Duration"))
        title_box.fill(title)
        dlg.get_by_role("textbox", name="Duration").fill("0:45:00")
        tap(dlg.get_by_role("button", name="Save session"))
        say(p, "Session status", f"Saved {title}: 62.0 TSS.")
        it = item_in(p, TODAY, title)
        poll(p, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "unplanned" and "Unplanned" in text_of(it)
             and same(num(it.get_attribute("data-tss")), 62.0, 1e-9), "the run shows on Thu 5 Nov")
        assert item_in(p, "2026-11-03", "Easy 45").get_attribute("data-compliance") == "missed"
        assert item_in(p, TODAY, "Fives at 110").get_attribute("data-compliance") == "planned"
        page_layout(p)
    found = find(weeks(api, aid, "2026-W45"), title, "completed")
    assert len(found) == 1 and same(found[0][2]["tss"], manual_run(2700, 330, 300))


def test_wf_phone_log_reduced_motion(browser: Browser, app_url: str) -> None:
    t = tag("phrm")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    nxt = week_row(api, aid, "2026-W46")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45", viewport=(375, 812), touch=True, reduced_motion="reduce") as p:
        rail = p.get_by_role("region", name="Week rail")
        poll(p, lambda: rail.get_attribute("data-week") == "2026-W45", "rail ready")
        b = rail_box(p, rail)
        y = b["y"] + min(b["height"] / 2, 150)
        Touch(p).drag(b["x"] + b["width"] * 0.7, y, b["x"] + b["width"] * 0.7 - SWIPE_PX, y)
        for _ in range(MOVE_POLLS):
            assert rail.get_attribute("data-moving") != "true", "reduced motion never slides (L202)"
            if rail.get_attribute("data-week") == "2026-W46":
                break
            advance(p, 5)
        else:
            pytest.fail("reduced-motion swipe swapped to 2026-W46")
        poll(p, lambda: location_week(p) == "2026-W46" and data_of(week_tile(p, "2026-11-09"), "data-active") == "true", "address and tile update")
        say(p, "Week announcements", f"Week of 9 Nov 2026: planned {fmt1(nxt['planned_tss'])}, completed {fmt1(nxt['completed_tss'])}, form {fmt_tsb(nxt['tsb'])}")


def test_wf_storage_outage_upload(browser: Browser, app_url: str) -> None:
    down = os.environ[STORAGE_DOWN_ENV]
    r = httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "unavailable"}
    t = tag("outup")
    w = World(down, t, mini(t, tz="Pacific/Auckland"))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Lost ride {t}"
    before = series(api, aid)
    with signed_in(browser, down, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, "2026-11-03")
        choose_upload(dialog, "Bike", title, "lost.csv", ride_csv([200] * 600))
        dialog.get_by_role("button", name="Upload session").click()
        alert = dialog.get_by_role("alert")
        poll(p, lambda: STORAGE_UPLOAD_MSG in text_of(alert), "outage message in the upload alert")
        assert selected_files(dialog) == ["lost.csv"] and "Saved" not in text_of(p.get_by_role("status", name="Session status"))
        assert same(num(data_of(week_tile(p, "2026-11-02"), "data-completed-tss")), 0.0, 1e-9)
    assert find(weeks(api, aid, "2026-W45"), title) == [] and series(api, aid) == before
    assert db_mentions(Postgres("_storagedown"), title) == 0
    r = upload(api, aid, "lost.csv", ride_csv([200] * 600), "bike", "2026-11-03", title)
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable", "message": STORAGE_UPLOAD_MSG}


def test_wf_storage_outage_manual(browser: Browser, app_url: str) -> None:
    down = os.environ[STORAGE_DOWN_ENV]
    t = tag("outman")
    w = World(down, t, mini(t, workouts=[planned_rec(t, "p", "a1", "2026-11-04", f"Plan {t}", "bike", [steady(3600, 80)])]))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Kept ride {t}"
    with signed_in(browser, down, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dlg = open_log_dialog(p, "2026-11-04")
        dlg.get_by_role("tab", name="Enter by hand").click()
        check(dlg.get_by_role("radio", name="Bike"))
        dlg.get_by_role("textbox", name="Title").fill(title)
        dlg.get_by_role("textbox", name="Duration").fill("1:00:00")
        dlg.get_by_role("textbox", name="Average power").fill("200")
        dlg.get_by_role("button", name="Save session").click()
        say(p, "Session status", f"Saved {title}: 64.0 TSS.")
        wk = week_row(api, aid, "2026-W45")
        assert same(wk["completed_tss"], 64.0) and wk["tally"]["on-target"] == 1
        tile = week_tile(p, "2026-11-02")
        poll(p, lambda: same(num(data_of(tile, "data-completed-tss")), 64.0, 1e-9) and num(data_of(tile, "data-count-on-target")) == 1
             and num(data_of(tile, "data-count-missed")) == 0, "week tile agrees with the API")
    assert db_mentions(Postgres("_storagedown"), title) >= 1
    wid = find(weeks(api, aid, "2026-W45"), title, "completed")[0][2]["id"]
    assert api.get(f"/api/workouts/{wid}/original").status_code == 404


def test_grading_seed_reset(app_url: str) -> None:
    t = tag("seed")
    body = mini(t)
    assert httpx.post(app_url + "/api/grading/seed", json=body, timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.post(app_url + "/api/grading/seed", json=body, headers={"X-Grading-Key": "wrong-" + t}, timeout=HTTP_TIMEOUT).status_code == 404
    bad_t = tag("seedbad")
    bad = mini(bad_t)
    bad["library"] = [{"key": f"{bad_t}-lib", "owner": f"{bad_t}-a1", "name": "Empty", "sport": "bike", "steps": []}]
    r = httpx.post(app_url + "/api/grading/seed", json=bad, headers={"X-Grading-Key": GRADING_KEY}, timeout=SEED_TIMEOUT)
    assert r.status_code == 422 and r.json()["errors"] == {"library[0].steps": "Add at least one step."}
    assert httpx.post(app_url + "/api/auth/sign-in", json={"email": bad["users"][1]["email"], "password": PASSWORD}).status_code == 401
    first, second = seed(app_url, body), seed(app_url, body)
    assert first["today"] == TODAY and first["ids"] == second["ids"]
    assert {f"{t}-c1", f"{t}-a1", f"{t}-l1"} <= set(first["ids"])
    assert first["sign_in"][f"{t}-a1"] != second["sign_in"][f"{t}-a1"]
    link = second["sign_in"][f"{t}-a1"]
    assert link.startswith("/auth/one-time/")
    c = httpx.Client(base_url=app_url, follow_redirects=False, timeout=HTTP_TIMEOUT)
    r = c.get(link)
    assert r.status_code == 303 and r.headers["location"] in ("/", app_url + "/")
    me = c.get("/api/me").json()
    assert me["email"] == body["users"][1]["email"] and me["role"] == "athlete" and me["today"] == TODAY and me["tz"] == "UTC"
    assert httpx.get(app_url + link, follow_redirects=False).status_code == 404
    assert httpx.get(app_url + first["sign_in"][f"{t}-c1"], follow_redirects=False).status_code == 303
    assert len(weeks(Api(app_url, body["users"][1]["email"]), first["ids"][f"{t}-a1"], "2026-W45")) == 1
    r = httpx.post(app_url + "/api/grading/reset", headers={"X-Grading-Key": GRADING_KEY}, timeout=SEED_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "reset"}
    assert httpx.post(app_url + "/api/auth/sign-in", json={"email": body["users"][1]["email"], "password": PASSWORD}).status_code == 401
    assert httpx.post(app_url + "/api/grading/reset", timeout=HTTP_TIMEOUT).status_code == 404


class Relay:
    def __init__(self, host: str, port: int, listen: int):
        self.target, self.listen = (host, port), listen
        self.stop_flag = threading.Event()
        self.conns: list[socket.socket] = []

    def start(self) -> "Relay":
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", self.listen))
        self.sock.listen(16)
        self.sock.settimeout(0.5)
        threading.Thread(target=self._accept, daemon=True).start()
        return self

    def _pipe(self, a: socket.socket, b: socket.socket) -> None:
        while not self.stop_flag.is_set():
            try:
                data = a.recv(65536)
            except OSError:
                return
            if not data:
                return
            with contextlib.suppress(OSError):
                b.sendall(data)

    def _accept(self) -> None:
        while not self.stop_flag.is_set():
            try:
                c, _ = self.sock.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            try:
                u = socket.create_connection(self.target)
            except OSError:
                c.close()
                continue
            self.conns += [c, u]
            for a, b in ((c, u), (u, c)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    def stop(self) -> None:
        self.stop_flag.set()
        for s in self.conns + [self.sock]:
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)
            s.close()


@pytest.mark.timeout(900)
def test_health_and_boot(app_url: str) -> None:
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"} and r.headers["content-type"].startswith("application/json")
    shell = len(json.dumps({"email": "x", "password": ""}).encode())
    exact = json.dumps({"email": "x", "password": "p" * (JSON_BODY_LIMIT - shell)}).encode()
    assert len(exact) == JSON_BODY_LIMIT
    hdr = {"content-type": "application/json"}
    r = httpx.post(app_url + "/api/auth/sign-in", content=exact, headers=hdr, timeout=HTTP_TIMEOUT)
    assert r.status_code == 401 and r.json()["error"] == "invalid_credentials"
    r = httpx.post(app_url + "/api/auth/sign-in", content=exact[:-1] + b' }', headers=hdr, timeout=HTTP_TIMEOUT)
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large", "message": "The request is too large."}
    secrets = [v for v in (os.environ.get("DATABASE_URL"), os.environ.get("S3_SECRET_ACCESS_KEY"), GRADING_KEY) if v]
    for path in ("/.env", "/package.json", "/run.json", "/node_modules/pg/package.json", "/tsconfig.json"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert not any(s in r.text for s in secrets), path
        served: Any = None
        with contextlib.suppress(ValueError):
            served = json.loads(r.text)
        assert not isinstance(served, dict) or set(served) <= {"error", "message"}, f"{path} served a source or dependency file"
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    db = urlsplit(os.environ["DATABASE_URL"])
    relay_port, app_port = free_port(), free_port()
    creds = db.netloc.rsplit("@", 1)[0] + "@" if "@" in db.netloc else ""
    env = dict(os.environ, DATABASE_URL=urlunsplit(db._replace(netloc=f"{creds}127.0.0.1:{relay_port}")), APP_PUBLIC_PORT=str(app_port))
    log = tempfile.NamedTemporaryFile(prefix="boot-", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    relay = None
    base = f"http://127.0.0.1:{app_port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-2000:]

    def wait_health(code: int, body: dict) -> None:
        deadline = time.monotonic() + BOOT_S
        while time.monotonic() < deadline:
            assert proc.poll() is None, f"app copy exited: {tail()}"
            with contextlib.suppress(httpx.HTTPError, ValueError):
                r = httpx.get(base + "/api/health", timeout=5)
                if r.status_code == code and r.json() == body:
                    return
            with contextlib.suppress(subprocess.TimeoutExpired):
                proc.wait(0.5)
        pytest.fail(f"GET /api/health on the copy answered {code} {body}; log: {tail()}")

    try:
        wait_health(503, {"status": "starting"})
        relay = Relay(db.hostname or "127.0.0.1", db.port or 5432, relay_port).start()
        wait_health(200, {"status": "ok"})
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, 15)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(30)
        if relay:
            relay.stop()


def test_wf_cross_cutting_sign_in(browser: Browser, app_url: str) -> None:
    t = tag("sign")
    w = World(app_url, t, mini(t))
    email = w.email("a1")
    with as_cm(open_app(browser, app_url + "/sign-in")) as p:
        poll(p, lambda: p.get_by_role("textbox", name="Email").count() == 1, "sign-in card")
        p.get_by_role("textbox", name="Email").fill(email)
        p.get_by_role("textbox", name="Password").fill("wrong-" + t)
        p.get_by_role("button", name="Sign in").click()
        poll(p, lambda: "Email or password is incorrect." in text_of(p.get_by_role("alert")), "sign-in alert")
        p.get_by_role("textbox", name="Password").fill(PASSWORD)
        with as_cm(held(p, "**/api/auth/sign-in")) as h:
            p.get_by_role("button", name="Sign in").click()
            pend = p.get_by_role("button", name="Signing in…")
            poll(p, lambda: pend.count() == 1 and pend.is_disabled(), "pending pill")
            h.release()
        poll(p, lambda: p.get_by_role("region", name="Today").count() == 1, "athlete home after sign-in")
        assert p.request.get(app_url + "/api/me").json()["email"] == email
        p.get_by_role("button", name="Sign out").click()
        poll(p, lambda: p.request.get(app_url + "/api/me").status == 401, "signed out")
    c = httpx.Client(base_url=app_url, follow_redirects=False, timeout=HTTP_TIMEOUT)
    r = c.post("/api/auth/sign-in", json={"email": email, "password": PASSWORD}, headers={"Origin": "http://elsewhere.invalid"})
    assert r.status_code == 200 and r.json()["user"]["email"] == email
    cookie = r.headers["set-cookie"]
    assert re.search("HttpOnly", cookie, re.I) and re.search("SameSite=Lax", cookie, re.I), cookie
    cors = [h for h in r.headers if h.lower().startswith(CORS_HEADER_PREFIX)]
    assert not cors, f"cross-origin allowance headers sent: {cors}"
    me = c.get("/api/me").json()
    assert me["role"] == "athlete" and me["today"] == TODAY and me["coach_code"] is None
    assert c.post("/api/auth/sign-out").status_code == 204
    r = c.get("/api/me")
    assert r.status_code == 401 and r.json() == UNAUTHENTICATED
    r = httpx.post(app_url + "/api/auth/sign-in", json={"email": email, "password": "nope"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 401 and r.json() == {"error": "invalid_credentials", "message": "Email or password is incorrect."}
    r = httpx.get(app_url + "/", follow_redirects=False, timeout=HTTP_TIMEOUT)
    assert r.status_code == 303 and urlsplit(r.headers["location"]).path == "/sign-in"


def test_wf_cross_cutting_week_rail(browser: Browser, app_url: str) -> None:
    t = tag("rail")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    prev = week_row(api, aid, "2026-W44")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45", viewport=(1280, 800)) as p:
        rail = p.get_by_role("region", name="Week rail")
        band = p.get_by_role("group", name="Fitness chart").locator("[data-week]")
        poll(p, lambda: rail.get_attribute("data-week") == "2026-W45", "rail ready")
        hist = p.evaluate("history.length")

        def moved(action: Callable[[], None], week: str) -> None:
            action()
            poll(p, lambda: rail.get_attribute("data-moving") == "true", "the track is moving (L191)", seconds=5, step_ms=0)
            advance(p, TRACK_MAX_MS)
            poll(p, lambda: rail.get_attribute("data-moving") != "true" and rail.get_attribute("data-week") == week,
                 f"settled on {week} after {TRACK_MAX_MS} ms", seconds=5, step_ms=0)
            poll(p, lambda: location_week(p) == week and data_of(band, "data-week") == week, f"address and chart band follow to {week}")

        back = p.get_by_role("button", name="Previous week")
        moved(back.click, "2026-W44")
        assert has_focus(back) and p.evaluate("history.length") == hist
        say(p, "Week announcements", f"Week of 26 Oct 2026: planned {fmt1(prev['planned_tss'])}, completed {fmt1(prev['completed_tss'])}, form {fmt_tsb(prev['tsb'])}")
        rail.focus()
        moved(lambda: p.keyboard.press("ArrowRight"), "2026-W45")
        assert has_focus(rail)
        dot = p.get_by_role("button", name=f"Week of {monday_text(NEXT_MONDAY)}")
        moved(dot.click, "2026-W46")
        assert dot.get_attribute("aria-current") == "true"
        dots = p.get_by_role("button", name=re.compile(r"^Week of "))
        n = dots.count()
        p.get_by_role("button", name="Load later weeks").click()
        poll(p, lambda: dots.count() == n + 4 and rail.get_attribute("data-week") == "2026-W46", "four later weeks load without moving")
        dots.last.click()
        advance(p, TRACK_MAX_MS)
        poll(p, lambda: p.get_by_role("button", name="Next week").is_disabled(), "Next week disabled at the last week", step_ms=0)
        last = rail.get_attribute("data-week")
        rail.focus()
        p.keyboard.press("ArrowRight")
        advance(p, TRACK_MAX_MS)
        assert rail.get_attribute("data-week") == last


def test_home_sections(browser: Browser, app_url: str) -> None:
    t = tag("home")
    body = demo(t)
    body["users"] += [athlete_user(t, "b1", "Noor Halvorsen", "UTC"), athlete_user(t, "b2", "Ezra Blom", "UTC"), athlete_user(t, "b3", "Idris Fenn", "UTC")]
    body["events"] += [{"athlete": f"{t}-b1", "name": f"Quay {t}", "date": TODAY}, {"athlete": f"{t}-b2", "name": f"Ridge {t}", "date": "2026-11-06"}]
    w = World(app_url, t, body)
    aid = w.id("a1")
    s = model_series(SERIES_START, TODAY, tavi_tss())
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        banner = p.get_by_role("region", name="Today")
        poll(p, lambda: f"Form {fmt_tsb(s[TODAY]['tsb'])}." in text_of(banner), "banner form line")
        assert same(num(data_of(banner, "data-tsb")), rnd(s[TODAY]["tsb"], 1), 1e-9)
        ctl, atl = num(data_of(banner, "data-ctl")), num(data_of(banner, "data-atl"))
        y = s["2026-11-04"]
        assert (same(ctl, rnd(y["ctl"], 1), 1e-9) and same(atl, rnd(y["atl"], 1), 1e-9)) or \
               (same(ctl, rnd(s[TODAY]["ctl"], 1), 1e-9) and same(atl, rnd(s[TODAY]["atl"], 1), 1e-9))
        assert "coming into today" in text_of(banner)
        assert banner.get_by_role("button", name="Plan a workout").count() == 1 and banner.get_by_role("button", name="Log a session").count() == 1
        pill = banner.get_by_role("button", name="Plan a workout")
        rest, hover = state_styles(pill, "box-shadow")
        assert rest["box-shadow"] != hover["box-shadow"], "pill gains a soft shadow on hover (L187)"
        radius = style(pill, "border-top-left-radius")["border-top-left-radius"]
        pill_box = pill.bounding_box()
        assert pill_box is not None
        rounded = float(radius[:-1]) >= 50 if radius.endswith("%") else float(radius.split("px")[0]) >= pill_box["height"] / 2 - 1
        assert rounded, f"pill actions are fully rounded (L174): radius {radius}"
        for name, value, shown in (("Bike stress", 64.0, "64.0"), ("Run stress", 62.0, "62.0"), ("Bike time", 3600, "1:00:00"),
                                   ("Run time", 2700, "0:45:00"), ("Sessions", 2, "2")):
            g = p.get_by_role("group", name=name)
            poll(p, lambda g=g, value=value, shown=shown: same(num(data_of(g, "data-value")), value, 1e-9) and shown in text_of(g), f"{name} tile")
        for name in ("This week", "Last 4 weeks", "Last 12 weeks"):
            g = p.get_by_role("group", name=name)
            assert "50% on target" in text_of(g) and num(data_of(g, "data-percent")) == 50, name
        wall = text_of(p.get_by_role("region", name="Recent uploads"))
        assert "Lunch run · Wed 4 Nov · 62.0 TSS" in wall and "Endurance hour · Mon 2 Nov · 64.0 TSS" in wall
        assert wall.index("Lunch run · Wed 4 Nov") < wall.index("Endurance hour · Mon 2 Nov")
        band = p.get_by_role("region", name="Next event")
        assert "45 days to Harbour Half" in text_of(band) and num(data_of(band, "data-days")) == 45
        assert p.get_by_role("contentinfo").get_by_role("textbox", name="Coach code").count() == 1
    expect = {"b1": (f"Race day: Quay {t}", "No planned sessions", "No sessions yet"),
              "b2": (f"1 day to Ridge {t}", None, None), "b3": ("No event on the calendar", None, None)}
    for key, (countdown, ring, wall) in expect.items():
        with signed_in(browser, app_url, w.email(key), f"/athletes/{w.id(key)}") as p:
            band = p.get_by_role("region", name="Next event")
            poll(p, lambda: countdown in text_of(band), f"countdown reads {countdown}")
            if ring:
                assert ring in text_of(p.get_by_role("group", name="This week"))
                assert wall in text_of(p.get_by_role("region", name="Recent uploads"))
    with signed_in(browser, app_url, w.email("c1"), "/coach") as p:
        poll(p, lambda: f"Your coach code: {w.code('c1')}" in text_of(p.get_by_role("contentinfo")), "coach footer shows the code")


VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}


@pytest.mark.parametrize("vp", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layouts(browser: Browser, app_url: str, vp: str) -> None:
    t = tag("resp")
    w = World(app_url, t, demo(t))
    size = VIEWPORTS[vp]
    aid = w.id("a1")

    def taps(p: Page) -> None:
        if size[0] >= 1280:
            return
        boxes = p.get_by_role("button").evaluate_all(
            "els => els.map(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);"
            " return {w: r.width, h: r.height, show: r.width > 0 && r.height > 0 && s.visibility !== 'hidden',"
            " name: e.getAttribute('aria-label') || e.textContent.trim()} })")
        small = [b for b in boxes if b["show"] and (b["w"] < MIN_TAP_PX - 0.5 or b["h"] < MIN_TAP_PX - 0.5)]
        assert not small, f"buttons under 44 px: {small[:5]}"

    screens = [("a1", f"/athletes/{aid}", ("region", "Week rail")), ("a1", f"/athletes/{aid}/builder", ("listbox", "Steps")),
               ("a1", f"/workouts/{w.id('w2')}", ("group", "Session numbers")), ("a1", "/coaches", ("list", "Your coaches")),
               ("a1", f"/athletes/{w.id('a2')}", ("heading", "Not found")),
               ("c1", "/coach", ("table", "Athletes")), ("c1", "/plans", ("button", "Apply Twelve to race day")), ("c1", "/inbox", ("list", "Link requests")),
               (None, "/sign-in", ("textbox", "Email"))]
    for who, path, (role, name) in screens:
        with signed_in(browser, app_url, w.email(who) if who else None, path, viewport=size) as p:
            target = p.get_by_role(role, name=name)
            poll(p, lambda: target.count() >= 1, f"{path} shows {role} {name} at {vp}")
            page_layout(p)
            taps(p)
            if who and path in ("/coach", f"/athletes/{aid}"):
                assert p.get_by_role("banner").count() == 1 and p.get_by_role("status", name="Notices").count() == 1
                p.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                top = p.get_by_role("banner").bounding_box()
                assert top is not None and abs(top["y"]) <= 1, "the athlete switcher header stays fixed to the top"
                p.evaluate("window.scrollTo(0, 0)")
                if size[0] == 375:
                    menu = p.get_by_role("button", name="Menu")
                    menu.click()
                    drawer = p.get_by_role("dialog", name="Menu")
                    poll(p, lambda: drawer.count() == 1 and has_focus(drawer), "Menu drawer opens with focus inside")
                    p.keyboard.press("Escape")
                    poll(p, lambda: has_focus(menu), "focus returns to Menu")
                elif who == "c1":
                    assert p.get_by_role("combobox", name="Athlete").count() == 1


def test_if_run_manifest() -> None:
    data = json.loads(Path("/app/run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip()


def test_if_notices() -> None:
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    assert "Encode Sans Expanded" in text and re.search(r"\bInter\b", text)


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad[:20]}"
    lines = Path("/app/THIRD_PARTY_NOTICES.md").read_text().splitlines()
    for pattern in (r"Encode Sans Expanded", r"\bInter\b"):
        hits = [i for i, l in enumerate(lines) if re.search(pattern, l)]
        assert any(any(lic in " ".join(lines[i:i + 5]) for lic in ALLOWED_LICENCES)
                   or LICENCE_WORDS.search(" ".join(lines[i:i + 5])) for i in hits), f"{pattern} licence in notices"


def test_if_lockfile() -> None:
    pkg = json.loads(Path("/app/package.json").read_text())
    lock = json.loads(Path("/app/package-lock.json").read_text())
    root = lock["packages"][""]
    for field in ("dependencies", "devDependencies", "optionalDependencies"):
        assert (root.get(field) or {}) == (pkg.get(field) or {}), field


def test_if_no_extra_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "sql.js", "@libsql/client", "libsql", "redis", "ioredis", "mongodb", "mongoose",
              "lowdb", "nedb", "@seald-io/nedb", "level", "leveldown", "lmdb", "pouchdb", "mysql", "mysql2", "tedious"}
    found = [p.name for p in shipped_packages() if p.name in banned]
    assert not found, f"extra datastores shipped: {found}"
    files = [f for f in Path("/app").rglob("*") if "node_modules" not in f.parts and f.suffix in (".sqlite", ".sqlite3", ".db")]
    assert not files, f"database files: {files[:5]}"


def test_if_service_config_unchanged() -> None:
    assert Postgres().tables() is not None
    S3().keys("")
    traj = Path("/logs/agent/trajectory.json")
    if not traj.exists():
        return
    pattern = re.compile(r"(docker-)?compose[^/]*\.ya?ml$|/\.devcontainer/")
    edits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool_name") or "")
            args = node.get("input") or node.get("arguments") or node.get("args")
            if isinstance(args, str):
                with contextlib.suppress(ValueError):
                    args = json.loads(args)
            if re.search(r"write|edit|str_replace|create", name, re.I) and isinstance(args, dict):
                path = str(args.get("file_path") or args.get("path") or "")
                if pattern.search(path):
                    edits.append(path)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(json.loads(traj.read_text()))
    assert not edits, f"provided service configuration edited: {edits}"


def test_if_no_external_assets(browser: Browser, app_url: str) -> None:
    t = tag("ext")
    w = World(app_url, t, demo(t))
    with signed_in(browser, app_url, w.email("a1"), "/sign-in") as p:
        urls: list[str] = []
        p.on("request", lambda r: urls.append(r.url))
        for path in (f"/athletes/{w.id('a1')}", f"/athletes/{w.id('a1')}/builder"):
            p.goto(app_url + path)
            poll(p, lambda: p.get_by_role("banner").count() == 1, f"{path} rendered")
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
        assert not foreign, f"requests to other origins: {foreign[:10]}"


_A_MAX_REPEATS = 20
_A_RECT_JS = ("els => els.map(e => { const r = e.getBoundingClientRect(); return {step: e.getAttribute('data-step-index'),"
              " part: e.getAttribute('data-part') || '', handle: e.getAttribute('data-handle'),"
              " x: r.left, y: r.top, w: r.width, h: r.height}; })")


def _a_graph(p: Page) -> Locator:
    return p.get_by_role("group", name="Workout graph")


def _a_bars(p: Page, step: int, part: str) -> list[dict[str, Any]]:
    graph = _a_graph(p)
    graph.evaluate("e => e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
    rows = graph.locator("[data-step-index]").evaluate_all(_A_RECT_JS)
    bars = [r for r in rows if not r["handle"] and r["step"] == str(step) and r["part"] == part and r["w"] > 0]
    return sorted(bars, key=lambda r: r["x"])


def _a_grip(p: Page, bar: dict[str, Any], kind: str) -> tuple[float, float]:
    rows = _a_graph(p).locator("[data-handle]").evaluate_all(_A_RECT_JS)
    grips = [g for g in rows if g["handle"] == kind]
    assert grips, f"the graph draws {kind} handles"

    def cost(g: dict[str, Any]) -> float:
        gx, gy = g["x"] + g["w"] / 2, g["y"] + g["h"] / 2
        if kind == "duration":
            return abs(gx - (bar["x"] + bar["w"])) + max(bar["y"] - gy, 0.0, gy - (bar["y"] + bar["h"]))
        return abs(gy - bar["y"]) + max(bar["x"] - gx, 0.0, gx - (bar["x"] + bar["w"]))

    g = min(grips, key=cost)
    x, y = g["x"] + g["w"] / 2, g["y"] + g["h"] / 2
    hit = p.evaluate("([x, y, k]) => { const e = document.elementFromPoint(x, y); const h = e && e.closest('[data-handle]');"
                     " return !!h && h.getAttribute('data-handle') === k; }", [x, y, kind])
    assert hit, f"the {kind} handle is reachable at its own position"
    return x, y


def _a_steps(w: World, key: str) -> list[dict[str, Any]]:
    return next(x for x in w.body["workouts"] if x["key"] == f"{w.t}-{key}")["steps"]


def _a_tally(counts: dict[str, int]) -> str:
    return " · ".join(f"{LEGEND[s]} {counts[s]}" for s in ("on-target", "close", "off-target", "missed", "unplanned", "planned"))


def test_wf_builder_keyboard_insert_limits(browser: Browser, app_url: str) -> None:
    t = tag("kins")
    w = World(app_url, t, mini(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}/builder?date={BUILDER_DAY}") as p:
        poll(p, lambda: steps_box(p).count() == 1, "Steps list")
        said = lambda text: say(p, "Builder announcements", text)
        kinds = lambda: [o["kind"] for o in option_attrs(p)]
        add_step(p, "Add warm-up")
        add_step(p, "Add cool-down")
        said("Cool-down added.")
        p.keyboard.press("ArrowUp")
        poll(p, lambda: (o := chosen(p)) is not None and o["kind"] == "warmup", "Up selects the warm-up")
        add_step(p, "Add steady")
        said("Steady added.")
        poll(p, lambda: kinds() == ["warmup", "steady", "cooldown"] and (o := chosen(p)) is not None and o["kind"] == "steady",
             "Add steady inserts after the selected warm-up and selects the new step")
        add_step(p, "Add interval")
        said("Interval added.")
        poll(p, lambda: kinds() == ["warmup", "steady", "interval", "interval", "cooldown"]
             and (o := chosen(p)) is not None and o["kind"] == "interval" and o["target"] == 105,
             "Add interval inserts after the selected steady step and selects its work part")
        for _ in range(_A_MAX_REPEATS - 4):
            p.keyboard.press("+")
        said(f"Interval repeats {_A_MAX_REPEATS}.")
        p.keyboard.press("+")
        said(f"Interval repeats {_A_MAX_REPEATS}.")
        assert [o["repeat"] for o in option_attrs(p) if o["kind"] == "interval"] == [str(_A_MAX_REPEATS)] * 2, \
            "+ beyond 20 repeats leaves the value unchanged"
        p.keyboard.press("ArrowUp")
        poll(p, lambda: (o := chosen(p)) is not None and o["kind"] == "steady", "Up selects the steady step")
        for _ in range(STEADY_PCT - MIN_PCT):
            p.keyboard.press("Shift+ArrowDown")
        said(f"Steady {fmt_dur(STEADY_S)} at {MIN_PCT}%.")
        p.keyboard.press("Shift+ArrowDown")
        said(f"Steady {fmt_dur(STEADY_S)} at {MIN_PCT}%.")
        assert (o := chosen(p)) is not None and o["target"] == MIN_PCT, "Shift+Down beyond 30% leaves the target unchanged"
        expect_totals(p, [WARMUP, steady(STEADY_S, MIN_PCT), interval(_A_MAX_REPEATS, 180, 105, 180, 55), COOLDOWN])
        assert len(_a_bars(p, 2, "work")) == _A_MAX_REPEATS, "the graph draws every repetition of the interval"


def test_wf_builder_drag_middle_step_clamp(browser: Browser, app_url: str) -> None:
    t = tag("drc")
    w = World(app_url, t, mini(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}/builder?date={BUILDER_DAY}", viewport=(1280, 800)) as p:
        poll(p, lambda: steps_box(p).count() == 1, "Steps list")
        for name in ("Add warm-up", "Add steady", "Add cool-down"):
            p.get_by_role("button", name=name).click()
        parts = lambda: [(o["kind"], o["duration"], o["target"]) for o in option_attrs(p)]
        poll(p, lambda: [k for k, _, _ in parts()] == ["warmup", "steady", "cooldown"], "three steps in order")
        graph = _a_graph(p)
        spp = num(graph.get_attribute("data-seconds-per-px"))
        assert spp > 0
        x, y = _a_grip(p, _a_bars(p, 1, "")[0], "duration")
        dx = math.ceil((STEADY_S + 4 * MIN_STEP_S) / spp)
        mouse_drag(p, x, y, x - dx, y)
        warm = (WARMUP["kind"], WARMUP["duration_s"], WARMUP["target_pct"])
        cool = (COOLDOWN["kind"], COOLDOWN["duration_s"], COOLDOWN["target_pct"])
        poll(p, lambda: parts() == [warm, ("steady", MIN_STEP_S, STEADY_PCT), cool],
             "the steady step is clamped at 0:00:30 and its neighbours are unchanged")
        say(p, "Builder announcements", f"Steady {fmt_dur(MIN_STEP_S)} at {STEADY_PCT}%.")
        ppp = num(graph.get_attribute("data-percent-per-px"))
        assert ppp > 0
        x, y = _a_grip(p, _a_bars(p, 2, "")[0], "target")
        dy = min(max(math.ceil(10 / ppp), 10), int(y - 5))
        want = int(clamp(rnd(COOLDOWN["target_pct"] + dy * ppp), MIN_PCT, MAX_PCT))
        mouse_drag(p, x, y, x, y - dy)
        poll(p, lambda: abs(parts()[2][2] - want) <= 1 and parts()[2][2] > COOLDOWN["target_pct"] and parts()[2][1] == COOLDOWN["duration_s"],
             f"dragging the cool-down's top edge up raises its target near {want}%")
        pct = int(parts()[2][2])
        say(p, "Builder announcements", f"Cool-down {fmt_dur(COOLDOWN['duration_s'])} at {pct}%.")
        assert parts()[:2] == [warm, ("steady", MIN_STEP_S, STEADY_PCT)], "only the dragged step changed"
        expect_totals(p, [WARMUP, steady(MIN_STEP_S, STEADY_PCT), dict(COOLDOWN, target_pct=pct)])


def test_wf_builder_drag_interval_repetition(browser: Browser, app_url: str) -> None:
    t = tag("dri")
    w = World(app_url, t, mini(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}/builder?date={BUILDER_DAY}", viewport=(1280, 800)) as p:
        poll(p, lambda: steps_box(p).count() == 1, "Steps list")
        p.get_by_role("button", name="Add interval").click()
        iv = interval(4, 180, 105, 180, 55)
        poll(p, lambda: len(option_attrs(p)) == 2 and len(_a_bars(p, 0, "recovery")) >= 3, "the interval's repetitions are drawn")
        graph = _a_graph(p)
        ppp = num(graph.get_attribute("data-percent-per-px"))
        assert ppp > 0
        x, y = _a_grip(p, _a_bars(p, 0, "recovery")[2], "target")
        dy = math.ceil((iv["recovery"]["target_pct"] - MIN_PCT + 3) / ppp)
        mouse_drag(p, x, y, x, y + dy)
        rows = lambda: [(o["duration"], o["target"], o["repeat"]) for o in option_attrs(p)]
        poll(p, lambda: rows() == [(180, 105, "4"), (180, MIN_PCT, "4")], "the recovery target is clamped at 30% and the work part is unchanged")
        say(p, "Builder announcements", f"Interval recovery {fmt_dur(180)} at {MIN_PCT}%.")
        tops = [b["y"] for b in _a_bars(p, 0, "recovery")]
        assert max(tops) - min(tops) <= 1, "every recovery repetition is drawn at the new target"
        ppp = num(graph.get_attribute("data-percent-per-px"))
        work = _a_bars(p, 0, "work")
        assert len(work) == 4
        x, y = _a_grip(p, work[3], "target")
        dy = min(max(math.ceil(10 / ppp), 10), int(y - 5))
        want = int(clamp(rnd(iv["work"]["target_pct"] + dy * ppp), MIN_PCT, MAX_PCT))
        mouse_drag(p, x, y, x, y - dy)
        poll(p, lambda: abs(rows()[0][1] - want) <= 1 and rows()[0][1] > 105, f"the work target rises near {want}%")
        pct = int(rows()[0][1])
        say(p, "Builder announcements", f"Interval work {fmt_dur(180)} at {pct}%.")
        tops = [b["y"] for b in _a_bars(p, 0, "work")]
        assert max(tops) - min(tops) <= 1, "every work repetition is drawn at the new target"
        assert rows() == [(180, pct, "4"), (180, MIN_PCT, "4")]
        expect_totals(p, [interval(4, 180, pct, 180, MIN_PCT)])


def test_wf_builder_drag_phone_touch_interval(browser: Browser, app_url: str) -> None:
    t = tag("drp")
    w = World(app_url, t, mini(t))
    aid = w.id("a1")
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}/builder?date={BUILDER_DAY}", viewport=(375, 812), touch=True) as p:
        poll(p, lambda: steps_box(p).count() == 1, "Steps list")
        tap(p.get_by_role("button", name="Add interval"))
        poll(p, lambda: len(option_attrs(p)) == 2 and len(_a_bars(p, 0, "work")) == 4, "the interval's four repetitions are drawn")
        totals = p.get_by_role("group", name="Workout totals")
        before = num(data_of(totals, "data-duration-s"))
        graph = _a_graph(p)
        spp = num(graph.get_attribute("data-seconds-per-px"))
        assert spp > 0
        x, y = _a_grip(p, _a_bars(p, 0, "work")[1], "duration")
        dx = min(max(math.ceil(3 * MIN_STEP_S / spp), 20), int(p.viewport_size["width"] - x - 5))
        want = clamp(snap30(180 + dx * spp), MIN_STEP_S, MAX_STEP_S)
        cdp = Touch(p).cdp
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]})
        for i in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * i / 8, "y": y, "id": 1}]})
        poll(p, lambda: num(data_of(totals, "data-duration-s")) > before, "totals update while the finger is still down")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        work = lambda: option_attrs(p)[0]
        poll(p, lambda: abs(work()["duration"] - want) <= 30 and work()["duration"] % 30 == 0 and work()["duration"] > 180,
             f"the work part snaps near {want}s")
        got = int(work()["duration"])
        say(p, "Builder announcements", f"Interval work {fmt_dur(got)} at 105%.")
        assert [(o["duration"], o["target"], o["repeat"]) for o in option_attrs(p)] == [(got, 105, "4"), (180, 55, "4")]
        widths = [b["w"] for b in _a_bars(p, 0, "work")]
        assert len(widths) == 4 and max(widths) - min(widths) <= 1, "every work repetition takes the new duration"
        expect_totals(p, [interval(4, got, 105, 180, 55)])


def test_wf_calendar_move_athlete_space_live_totals(browser: Browser, app_url: str) -> None:
    t = tag("mvs")
    w = World(app_url, t, demo(t))
    aid, api = w.id("a1"), w.api("a1")
    w6 = w.id("w6")
    picked = "Picked up Fives at 110. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel."
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week={WEEK}") as cp, \
            signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week={WEEK}") as ap:
        poll(cp, lambda: item_in(cp, TODAY, "Fives at 110").count() == 1, "coach calendar ready")
        move = move_button(ap, "Fives at 110")
        poll(ap, lambda: move.count() == 1, "the athlete sees Move")
        move.focus()
        ap.keyboard.press("Space")
        say(ap, "Calendar announcements", picked)
        for _ in range(5):
            ap.keyboard.press("ArrowLeft")
        say(ap, "Calendar announcements", day_text(MONDAY))
        for _ in range(4):
            ap.keyboard.press("ArrowRight")
        say(ap, "Calendar announcements", day_text(FRI))
        ap.keyboard.press("Space")
        say(ap, "Calendar announcements", f"Moved Fives at 110 to {day_text(FRI)}.")
        poll(ap, lambda: has_focus(move_button(ap, "Fives at 110")), "focus stays on the Move button")
        poll(cp, lambda: item_in(cp, FRI, "Fives at 110").count() == 1 and item_in(cp, TODAY, "Fives at 110").count() == 0,
             "the coach sees the athlete's keyboard move", LIVE_WINDOW_S)
        v6 = workout(api, w6)["workout"]["version"]
        r = api.patch(f"/api/workouts/{w6}", json={"version": v6, "date": NEXT_MONDAY})
        assert r.status_code == 200, r.text[:200]
        left = sum(plan_tss(_a_steps(w, k)) for k in ("w1", "w3", "w5"))
        moved = plan_tss(_a_steps(w, "w6"))
        cur, nxt = week_tile(cp, MONDAY), week_tile(cp, NEXT_MONDAY)
        line = _a_tally({"on-target": 1, "close": 0, "off-target": 0, "missed": 1, "unplanned": 1, "planned": 1})
        poll(cp, lambda: f"Planned {fmt1(left)} TSS" in text_of(cur) and line in text_of(cur)
             and same(num(data_of(cur, "data-planned-tss")), rnd(left, 1), 1e-9) and num(data_of(cur, "data-count-planned")) == 1,
             "this week's tile drops the moved workout from its totals and tally", LIVE_WINDOW_S)
        poll(cp, lambda: f"Planned {fmt1(moved)} TSS" in text_of(nxt)
             and same(num(data_of(nxt, "data-planned-tss")), rnd(moved, 1), 1e-9) and num(data_of(nxt, "data-count-planned")) == 1,
             "next week's tile gains it", LIVE_WINDOW_S)
    assert workout(api, w.id("w5"))["workout"]["date"] == FRI


def test_wf_calendar_move_drag_refused_reload(browser: Browser, app_url: str) -> None:
    t = tag("mvd")
    w = World(app_url, t, demo(t))
    aid, api, w5 = w.id("a1"), w.api("a1"), w.id("w5")
    v5 = workout(api, w5)["workout"]["version"]
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week={WEEK}", viewport=(1280, 800)) as p:
        poll(p, lambda: item_in(p, TODAY, "Fives at 110").count() == 1, "calendar ready")
        item_in(p, TODAY, "Fives at 110").drag_to(chip(p, WED))
        say(p, "Calendar announcements", "Pick today or a later day.")
        poll(p, lambda: item_in(p, TODAY, "Fives at 110").count() == 1 and item_in(p, WED, "Fives at 110").count() == 0,
             "the refused item returns to its day")
        refused = workout(api, w5)["workout"]
        assert refused["date"] == TODAY and refused["version"] == v5, "a refused move changes nothing"
        item_in(p, TODAY, "Fives at 110").drag_to(chip(p, SUN))
        poll(p, lambda: item_in(p, SUN, "Fives at 110").count() == 1, "dragging onto Sunday moves the item")
        p.reload()
        it = item_in(p, SUN, "Fives at 110")
        poll(p, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "planned" and LEGEND["planned"] in text_of(it)
             and same(num(it.get_attribute("data-planned-tss")), rnd(plan_tss(FIVES), 1), 1e-9)
             and item_in(p, TODAY, "Fives at 110").count() == 0, "after a reload the item is on Sunday, still planned")
    wo = workout(api, w5)["workout"]
    assert wo["date"] == SUN and wo["version"] == v5 + 1 and wo["start_local"] == "06:30"


def test_wf_coach_copy_week_keyboard_next_week(browser: Browser, app_url: str) -> None:
    t = tag("cwnext")
    w = World(app_url, t, demo(t))
    aid, nid, noor = w.id("a1"), w.id("a2"), w.api("a2")
    next_week = d(NEXT_MONDAY).strftime("%G-W%V")
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week={WEEK}") as p:
        opener = p.get_by_role("button", name="Copy week")
        poll(p, lambda: opener.count() == 1, "coach sees Copy week")
        opener.focus()
        p.keyboard.press("Space")
        dlg = p.get_by_role("dialog", name="Copy week")
        poll(p, lambda: dlg.count() == 1 and has_focus(dlg), "Space opens the dialog with focus inside")
        for n in (f"Fives at 110 · {day_text(TODAY)}", f"Long ride · {day_text(SAT)}"):
            box = dlg.get_by_role("checkbox", name=n)
            box.focus()
            p.keyboard.press("Space")
            poll(p, lambda: box.is_checked(), f"Space checks {n}")
        select(dlg.get_by_role("combobox", name="Copy to athlete"), NOOR)
        week_box = dlg.get_by_role("textbox", name="Target week")
        week_box.fill("")
        week_box.focus()
        p.keyboard.type(next_week)
        with as_cm(held(p, "**/copy-week")) as h:
            dlg.get_by_role("button", name="Copy workouts").focus()
            p.keyboard.press("Enter")
            pend = dlg.get_by_role("button", name="Copying…")
            poll(p, lambda: pend.count() == 1 and pend.is_disabled(), "the pill shows Copying… and is disabled")
            say(p, "Copy status", "Copying…")
            h.release()
        say(p, "Copy status", f"Copied 2 workouts to {NOOR}. Skipped 0 on days that have already passed.")
    ws = weeks(noor, nid, next_week)
    thu, sat = ((d(x) + timedelta(days=7)).isoformat() for x in (TODAY, SAT))
    fives, longr = find(ws, "Fives at 110", "planned"), find(ws, "Long ride", "planned")
    assert len(fives) == 1 and fives[0][0] == thu and fives[0][2]["start_local"] == "06:30" and fives[0][2]["steps"] == FIVES
    assert len(longr) == 1 and longr[0][0] == sat and longr[0][2]["start_local"] == "07:00" and longr[0][2]["steps"] == _a_steps(w, "w6")
    assert fives[0][2]["source"] == "copy" and longr[0][2]["source"] == "copy"
    src = weeks(w.api("a1"), aid, WEEK)
    assert [x[0] for x in find(src, "Fives at 110", "planned")] == [TODAY] and [x[0] for x in find(src, "Long ride", "planned")] == [SAT], \
        "the source is unchanged"


def test_wf_coach_copy_week_week_error_singular(browser: Browser, app_url: str) -> None:
    t = tag("cwone")
    w = World(app_url, t, demo(t))
    aid, nid, noor = w.id("a1"), w.id("a2"), w.api("a2")
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{nid}?week={WEEK}") as vp, \
            signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week={WEEK}") as cp:
        poll(vp, lambda: item_in(vp, MONDAY, "Tempo ride").count() == 1, "the coach's view of Noor is ready")
        opener = cp.get_by_role("button", name="Copy week")
        poll(cp, lambda: opener.count() == 1, "coach sees Copy week")
        opener.click()
        dlg = cp.get_by_role("dialog", name="Copy week")
        poll(cp, lambda: dlg.count() == 1, "Copy week dialog")
        for n in (f"Easy 45 · {day_text(TUE)}", f"Long ride · {day_text(SAT)}"):
            check(dlg.get_by_role("checkbox", name=n))
        select(dlg.get_by_role("combobox", name="Copy to athlete"), NOOR)
        week_box = dlg.get_by_role("textbox", name="Target week")
        week_box.fill(WEEK.replace("-W", "-"))
        dlg.get_by_role("button", name="Copy workouts").click()
        poll(cp, lambda: "Enter a week as YYYY-Www." in error_text(week_box) and has_focus(week_box),
             "the week error is attached to Target week, which receives focus")
        assert find(weeks(noor, nid, WEEK), "Long ride") == [], "a refused copy creates nothing"
        week_box.fill(WEEK)
        dlg.get_by_role("button", name="Copy workouts").click()
        say(cp, "Copy status", f"Copied 1 workout to {NOOR}. Skipped 1 on days that have already passed.")
        poll(vp, lambda: item_in(vp, SAT, "Long ride").count() == 1, "the coach's open view of Noor shows the copy", LIVE_WINDOW_S)
        assert item_in(vp, TUE, "Easy 45").count() == 0, "the past day is skipped"
    longr = find(weeks(noor, nid, WEEK), "Long ride", "planned")
    assert len(longr) == 1 and longr[0][0] == SAT and longr[0][2]["start_local"] == "07:00"
    assert find(weeks(noor, nid, WEEK), "Easy 45") == []


def test_wf_coach_copy_week_phone_touch(browser: Browser, app_url: str) -> None:
    t = tag("cwph")
    w = World(app_url, t, demo(t))
    aid, nid, noor = w.id("a1"), w.id("a2"), w.api("a2")
    names = [f"Endurance hour · {day_text(MONDAY)}", f"Easy 45 · {day_text(TUE)}", f"Fives at 110 · {day_text(TODAY)}",
             f"Long ride · {day_text(SAT)}"]
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week={WEEK}", viewport=(375, 812), touch=True) as p:
        opener = p.get_by_role("button", name="Copy week")
        poll(p, lambda: opener.count() == 1, "coach sees Copy week on a phone")
        tap(opener)
        dlg = p.get_by_role("dialog", name="Copy week")
        poll(p, lambda: dlg.count() == 1 and has_focus(dlg), "the sheet opens with focus inside")
        tap(dlg.get_by_role("button", name="Select all"))
        poll(p, lambda: all(dlg.get_by_role("checkbox", name=n).is_checked() for n in names), "Select all checks every box")
        box = dlg.get_by_role("checkbox", name=names[0])
        box.focus()
        p.keyboard.press("Space")
        poll(p, lambda: not box.is_checked() and all(dlg.get_by_role("checkbox", name=n).is_checked() for n in names[1:]),
             "Space unchecks only the focused box")
        for _ in range(TAB_PRESSES):
            p.keyboard.press("Tab")
            assert has_focus(dlg), "Tab wraps inside the Copy week sheet"
        p.keyboard.press("Escape")
        poll(p, lambda: (dlg.count() == 0 or not dlg.is_visible()) and has_focus(opener), "Escape closes and focus returns to Copy week")
    ws = weeks(noor, nid, WEEK)
    assert [wo["title"] for _, _, wo in entries(ws)] == ["Tempo ride"], "closing with Escape copies nothing"


def _b_pace(seconds_per_km: float) -> str:
    s = int(rnd(seconds_per_km))
    return f"{s // 60}:{s % 60:02d}"


def _b_submit(p: Page, dialog: Locator) -> None:
    button = dialog.get_by_role("button", name="Upload session")
    button.focus()
    p.keyboard.press("Enter")


def _b_refused(p: Page, dialog: Locator, message: str, name: str) -> None:
    alert = dialog.get_by_role("alert")
    poll(p, lambda: message in text_of(alert) and has_focus(alert), f"focused upload alert reads {message!r}")
    assert dialog.is_visible(), "the dialog stays open after a refused upload"
    assert selected_files(dialog) == [name], "the chosen file stays selected"


def _b_nothing_created(api: Api, aid: str, title: str, before: dict[str, dict[str, Any]]) -> None:
    assert find(weeks(api, aid, "2026-W45"), title) == []
    assert S3().keys(f"activities/{aid}/") == []
    assert series(api, aid) == before


def _b_session_numbers(p: Page, wanted: list[str], what: str) -> Locator:
    nums = p.get_by_role("group", name="Session numbers")
    poll(p, lambda: all(s in text_of(nums) for s in wanted), what)
    return nums


def test_wf_power_file_tss_csv_close(browser: Browser, app_url: str) -> None:
    t = tag("bcsv")
    title = f"Hour ride {t}"
    plan = [steady(3600, 100)]
    w = World(app_url, t, mini(t, workouts=[planned_rec(t, "p", "a1", TUE, title, "bike", plan)]))
    aid, api = w.id("a1"), w.api("a1")
    values = [200] * 3600
    np_, if_, tss = bike_score(values, 250)
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        it = item_in(p, TUE, title)
        poll(p, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "missed" and LEGEND["missed"] in text_of(it),
             "an unpaired plan on a past day reads Missed (L422, L426)")
        dialog = open_log_dialog(p, TUE, by_key=True)
        choose_upload(dialog, "Bike", title, "hour.csv", ride_csv(values))
        _b_submit(p, dialog)
        say(p, "Session status", f"Saved {title}: {fmt1(tss)} TSS.")
        poll(p, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "close" and LEGEND["close"] in text_of(it)
             and same(num(it.get_attribute("data-completed-tss")), rnd(tss, 1), 1e-9)
             and same(num(it.get_attribute("data-planned-tss")), rnd(plan_tss(plan), 1), 1e-9),
             "r = 64.0 / 100.0 by planned TSS is Close (L414, L420)")
        assert move_button(p, title).count() == 0, "a matched plan offers no Move button (L114)"
        wo = find(weeks(api, aid, "2026-W45"), title, "completed")[0][2]
        assert wo["source"] == "file" and wo["duration_s"] == len(values)
        p.goto(f"{app_url}/workouts/{wo['id']}")
        nums = _b_session_numbers(p, [f"Normalised power {int(rnd(np_))} W", f"IF {fmt2(if_)}", f"{fmt1(tss)} TSS",
                                      f"Duration {fmt_dur(len(values))}"], "detail shows 200 W, IF 0.80, 64.0 TSS (L371)")
        assert data_of(nums, "data-np") == str(int(rnd(np_))) and data_of(nums, "data-if") == fmt2(if_)
        assert data_of(nums, "data-tss") == fmt1(tss) and num(data_of(nums, "data-duration-s")) == len(values)


def test_wf_power_file_tss_json_unplanned(browser: Browser, app_url: str) -> None:
    t = tag("bjson")
    w = World(app_url, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Short ride {t}"
    fname = "short-ride.json"
    values = [200] * 30 + [230] * 30
    data = activity_json("bike", values)
    sha = hashlib.sha256(data).hexdigest()
    np_, if_, tss = bike_score(values, 250)
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, WED, by_key=True)
        choose_upload(dialog, "Bike", title, fname, data)
        _b_submit(p, dialog)
        say(p, "Session status", f"Saved {title}: {fmt1(tss)} TSS.")
        it = item_in(p, WED, title)
        poll(p, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "unplanned" and LEGEND["unplanned"] in text_of(it)
             and same(num(it.get_attribute("data-completed-tss")), rnd(tss, 1), 1e-9), "the ride shows on Wed 4 Nov as Unplanned")
        link = it.get_by_role("link", name=title, exact=True)
        link.focus()
        p.keyboard.press("Enter")
        _b_session_numbers(p, [f"Normalised power {int(rnd(np_))} W", f"IF {fmt2(if_)}", f"{fmt1(tss)} TSS", f"Duration {fmt_dur(len(values))}"],
                           "detail shows 216 W, IF 0.86, 1.2 TSS, Duration 0:01:00 (L372)")
        poll(p, lambda: f"SHA-256 {sha}" in norm(p.locator("body").text_content()) and fname in norm(p.locator("body").text_content()),
             "detail shows the stored file's name and SHA-256 (L92, L123)")
        assert p.locator("[data-sha256]").first.get_attribute("data-sha256") == sha
    wo = find(weeks(api, aid, "2026-W45"), title, "completed")[0][2]
    assert wo["date"] == WED and wo["file"]["sha256"] == sha and wo["file"]["size"] == len(data)


def test_wf_power_file_tss_threshold_single(browser: Browser, app_url: str) -> None:
    t = tag("bthr")
    ride = ride_csv([200] * 3600)
    early, late = f"Early ride {t}", f"Late ride {t}"
    body = mini(t, files=[file_rec(t, "fe", "early.csv", ride), file_rec(t, "fl", "late.csv", ride)],
                workouts=[file_workout(t, "we", "a1", MONDAY, early, "bike", "fe"), file_workout(t, "wl", "a1", WED, late, "bike", "fl")])
    w = World(app_url, t, body)
    aid, api = w.id("a1"), w.api("a1")
    rescored = bike_score([200.0] * 3600, 265)
    model = model_series(SERIES_START, TODAY, {MONDAY: bike_score([200.0] * 3600, 250)[2], WED: rescored[2]})
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week=2026-W45") as p:
        region = p.get_by_role("region", name="Thresholds")
        poll(p, lambda: region.count() == 1 and item_in(p, WED, late).count() == 1, "Thresholds region and calendar ready")
        region.get_by_role("textbox", name="FTP").fill("265")
        region.get_by_role("textbox", name="Effective from").fill(TUE)
        save = region.get_by_role("button", name="Save threshold")
        save.focus()
        p.keyboard.press("Enter")
        say(p, "Threshold status", f"FTP 265 W from {long_day(TUE)}. Re-scored 1 workout.")
        poll(p, lambda: f"FTP 265 W from {long_day(TUE)}" in text_of(region) and f"FTP 250 W from {long_day(SERIES_START)}" in text_of(region),
             "history lists both FTP entries (L124)")
        poll(p, lambda: same(num(data_of(item_in(p, WED, late), "data-completed-tss")), rnd(rescored[2], 1), 1e-9)
             and same(num(data_of(item_in(p, MONDAY, early), "data-completed-tss")), 64.0, 1e-9),
             "the 4 Nov ride re-scores to 57.0, the 2 Nov ride keeps 64.0 (L395, L397)")
        poll(p, lambda: all(row_matches(r, model[r["date"]]) for r in table_rows(p) if r["date"] in model)
             and len(table_rows(p)) == len(model), "the fitness table follows the recomputed series")
        link = item_in(p, WED, late).get_by_role("link", name=late, exact=True)
        link.focus()
        p.keyboard.press("Enter")
        _b_session_numbers(p, [f"Normalised power {int(rnd(rescored[0]))} W", f"IF {fmt2(rescored[1])}", f"{fmt1(rescored[2])} TSS"],
                           "the re-scored ride reads IF 0.75 and 57.0 TSS (L397)")
    assert fmt2(rescored[1]) == "0.75" and fmt1(rescored[2]) == "57.0"
    assert same(workout(api, w.id("we"))["workout"]["tss"], 64.0), "a ride before the effective date keeps its stress"


def test_wf_run_file_states_csv_pace(browser: Browser, app_url: str) -> None:
    t = tag("brun")
    title = f"Tempo run {t}"
    plan = [steady(3600, 80)]
    w = World(app_url, t, mini(t, extra_thresholds=({"kind": "pace", "value": 270, "effective_from": WED},),
                               workouts=[planned_rec(t, "p", "a1", WED, title, "run", plan)]))
    aid, api = w.id("a1"), w.api("a1")
    values = [3.0] * 3600
    ns, if_, tss = run_score(values, 270)
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        region = p.get_by_role("region", name="Thresholds")
        poll(p, lambda: f"Threshold pace {_b_pace(270)} /km from {long_day(WED)}" in text_of(region)
             and f"Threshold pace {_b_pace(300)} /km from {long_day(SERIES_START)}" in text_of(region), "pace history (L124)")
        dialog = open_log_dialog(p, WED, by_key=True)
        choose_upload(dialog, "Run", title, "tempo.csv", run_csv(values))
        _b_submit(p, dialog)
        say(p, "Session status", f"Saved {title}: {fmt1(tss)} TSS.")
        it = item_in(p, WED, title)
        poll(p, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "on-target" and LEGEND["on-target"] in text_of(it)
             and same(num(it.get_attribute("data-completed-tss")), rnd(tss, 1), 1e-9), "the run pairs with its plan On target")
        wo = find(weeks(api, aid, "2026-W45"), title, "completed")[0][2]
        assert same(wo["tss"], tss) and same(wo["ns_mps"], ns), "rTSS uses the pace in force on 4 Nov"
        p.goto(f"{app_url}/workouts/{wo['id']}")
        nums = _b_session_numbers(p, [f"Normalised pace {_b_pace(1000 / ns)} /km", f"IF {fmt2(if_)}", f"{fmt1(tss)} TSS",
                                      f"Duration {fmt_dur(len(values))}"], "run page shows normalised pace, IF and rTSS (L123, L373-L377)")
        assert data_of(nums, "data-if") == fmt2(if_) and data_of(nums, "data-tss") == fmt1(tss)


def test_wf_run_file_states_six_states_week(browser: Browser, app_url: str) -> None:
    t = tag("bsix")
    tz = "Pacific/Auckland"
    dawn, tue_b, tue_r, wed_b, thu_r, sat_b = (f"{x} {t}" for x in ("Dawn run", "Tue ride", "Tue run", "Wed ride", "Thu run", "Sat ride"))
    run_plan, close_plan, off_plan, sat_plan = [steady(2700, 75)], [steady(3600, 100)], [steady(3600, 50)], [steady(3600, 80)]
    thu_values = [3.0] * 1800
    body = mini(t, tz=tz, files=[file_rec(t, "ft", "thu.csv", run_csv(thu_values))],
                workouts=[planned_rec(t, "p1", "a1", MONDAY, dawn, "run", run_plan),
                          planned_rec(t, "p2", "a1", TUE, tue_b, "bike", close_plan),
                          manual_rec(t, "c2", "a1", TUE, tue_b, "bike", 3600, power=200),
                          planned_rec(t, "p3", "a1", TUE, tue_r, "run", duration_s=1800),
                          planned_rec(t, "p4", "a1", WED, wed_b, "bike", off_plan),
                          manual_rec(t, "c4", "a1", WED, wed_b, "bike", 3600, power=250),
                          file_workout(t, "c5", "a1", TODAY, thu_r, "run", "ft"),
                          planned_rec(t, "p6", "a1", SAT, sat_b, "bike", sat_plan)])
    w = World(app_url, t, body)
    aid, api = w.id("a1"), w.api("a1")
    dawn_values = [2.5] * 2700
    r = upload(api, aid, "dawn.json", activity_json("run", dawn_values, start="2026-11-01T20:00:00Z"), None, MONDAY, dawn)
    assert r.status_code == 201, r.text[:200]
    assert r.json()["workout"]["date"] == MONDAY
    dawn_tss, thu_tss = run_score(dawn_values, 300)[2], run_score(thu_values, 300)[2]
    tss = {MONDAY: dawn_tss, TUE: manual_bike(3600, 200, 250), WED: manual_bike(3600, 250, 250), TODAY: thu_tss}
    model = model_series(SERIES_START, TODAY, tss)
    planned = sum(plan_tss(x) for x in (run_plan, close_plan, off_plan, sat_plan))
    completed = sum(tss.values())
    states = {(MONDAY, dawn): "on-target", (TUE, tue_b): "close", (WED, wed_b): "off-target", (TUE, tue_r): "missed",
              (TODAY, thu_r): "unplanned", (SAT, sat_b): "planned"}
    prev_monday = (d(MONDAY) - timedelta(days=7)).isoformat()
    wrong = datetime(2026, 11, 9, 12, tzinfo=timezone.utc)
    with signed_in(browser, app_url, w.email("c1"), f"/athletes/{aid}?week=2026-W45", clock=wrong) as p:
        for (day, title), state in states.items():
            it = item_in(p, day, title)
            poll(p, lambda it=it, state=state: it.count() == 1 and it.get_attribute("data-compliance") == state and LEGEND[state] in text_of(it),
                 f"{title} reads {LEGEND[state]} on the athlete's local day")
        tile = week_tile(p, MONDAY)
        line = "On target 1 · Close 1 · Off target 1 · Missed 1 · Unplanned 1 · Planned 1"
        poll(p, lambda: all(x in text_of(tile) for x in (f"Planned {fmt1(planned)} TSS", f"Completed {fmt1(completed)} TSS",
                                                          f"Form {fmt_tsb(model[TODAY]['tsb'])}", line)), "week tile totals, form and tally")
        assert same(num(data_of(tile, "data-planned-tss")), rnd(planned, 1), 1e-9)
        assert same(num(data_of(tile, "data-completed-tss")), rnd(completed, 1), 1e-9)
        run_stress, run_time = p.get_by_role("group", name="Run stress"), p.get_by_role("group", name="Run time")
        poll(p, lambda: same(num(data_of(run_stress, "data-value")), rnd(dawn_tss + thu_tss, 1), 1e-9)
             and num(data_of(run_time, "data-value")) == len(dawn_values) + len(thu_values)
             and fmt_dur(len(dawn_values) + len(thu_values)) in text_of(run_time), "run tiles count both run files")
        rail = p.get_by_role("region", name="Week rail")
        rail.focus()
        p.keyboard.press("ArrowLeft")
        say(p, "Week announcements", f"Week of {monday_text(prev_monday)}: planned {fmt1(0.0)}, completed {fmt1(0.0)}, "
                                     f"form {fmt_tsb(model[MONDAY]['tsb'])}")
    wk = week_row(api, aid, "2026-W45")
    assert same(wk["planned_tss"], planned) and same(wk["completed_tss"], completed)


def test_wf_fitness_chart_table_after_upload(browser: Browser, app_url: str) -> None:
    t = tag("bfit")
    w = World(app_url, t, demo(t))
    aid = w.id("a1")
    title = f"Table ride {t}"
    values = [200] * 3600
    tss = dict(tavi_tss())
    tss[TUE] = bike_score(values, 250)[2]
    model = model_series(SERIES_START, TODAY, tss)
    drawn = days_between(SERIES_START, TODAY)
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        table = p.get_by_role("table", name="Fitness table")
        poll(p, lambda: len(table_rows(p)) == len(drawn), "fitness table rendered")
        for name in ("Date", "TSS", "Fitness", "Fatigue", "Form"):
            assert table.get_by_role("columnheader", name=name, exact=True).count() == 1, f"column {name} (L110)"
        dialog = open_log_dialog(p, TUE)
        choose_upload(dialog, "Bike", title, "table.csv", ride_csv(values))
        _b_submit(p, dialog)
        say(p, "Session status", f"Saved {title}: {fmt1(tss[TUE])} TSS.")
        poll(p, lambda: [r["date"] for r in table_rows(p)] == drawn and all(row_matches(r, model[r["date"]]) for r in table_rows(p)),
             "every table row equals the recomputed series (L401-L407)")
        row = table.get_by_role("row").filter(has_text=fmt1(tss[TUE]))
        x = model[TUE]
        assert any(all(v in text_of(row.nth(i)) for v in (fmt1(x["ctl"]), fmt1(x["atl"]), fmt_tsb(x["tsb"]))) for i in range(row.count()))
        chart = p.get_by_role("group", name="Fitness chart")
        chart.focus()
        p.keyboard.press("End")
        p.keyboard.press("ArrowLeft")
        p.keyboard.press("ArrowLeft")
        say(p, "Chart readout", f"{long_day(TUE)}: {fmt1(x['tss'])} TSS, fitness {fmt1(x['ctl'])}, fatigue {fmt1(x['atl'])}, form {fmt_tsb(x['tsb'])}")
        assert chart.get_attribute("data-focus-date") == TUE
        p.reload()
        poll(p, lambda: any(r["date"] == TODAY and row_matches(r, model[TODAY]) for r in table_rows(p))
             and any(r["date"] == TUE and row_matches(r, model[TUE]) for r in table_rows(p)), "the table agrees after a reload")


def test_wf_bad_activity_file_size_then_type(browser: Browser, app_url: str) -> None:
    t = tag("bsize")
    w = World(app_url, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Wrong file {t}"
    before = series(api, aid)
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, TUE, by_key=True)
        choose_upload(dialog, "Bike", title, "huge.gpx", b"t" * (ACTIVITY_MAX_BYTES + 1))
        _b_submit(p, dialog)
        _b_refused(p, dialog, f"This file is larger than {ACTIVITY_MAX_BYTES} bytes.", "huge.gpx")
        assert "Upload a .csv or .json activity file." not in text_of(dialog.get_by_role("alert")), "size is checked before type (L462)"
        dialog.get_by_label("Activity file").set_input_files({"name": "ride.gpx", "mimeType": "application/octet-stream",
                                                              "buffer": ride_csv([200] * 60)})
        _b_submit(p, dialog)
        _b_refused(p, dialog, "Upload a .csv or .json activity file.", "ride.gpx")
        assert "Saved" not in text_of(p.get_by_role("status", name="Session status"))
    _b_nothing_created(api, aid, title, before)


def test_wf_bad_activity_file_fields_first(browser: Browser, app_url: str) -> None:
    t = tag("bfld")
    w = World(app_url, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Future file {t}"
    before = series(api, aid)
    bad = b"t,power,hr,speed\n0,200,,\n"
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, TUE)
        choose_upload(dialog, "Bike", title, "header.csv", bad)
        day = dialog.get_by_role("textbox", name="Day")
        day.fill((d(TODAY) + timedelta(days=1)).isoformat())
        _b_submit(p, dialog)
        poll(p, lambda: "Completed sessions cannot be in the future." in error_text(day), "the date message is attached to Day (L209, L478)")
        assert "Line 1 must be t,power,heart_rate,speed." not in text_of(dialog.get_by_role("alert")), \
            "request fields are checked before file contents (L339)"
        assert dialog.is_visible() and selected_files(dialog) == ["header.csv"]
        day.fill(TUE)
        _b_submit(p, dialog)
        _b_refused(p, dialog, "Line 1 must be t,power,heart_rate,speed.", "header.csv")
    _b_nothing_created(api, aid, title, before)


def test_wf_bad_activity_file_rows_then_channel(browser: Browser, app_url: str) -> None:
    t = tag("brow")
    w = World(app_url, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Gappy file {t}"
    before = series(api, aid)
    both = b"t,power,heart_rate,speed\n0,200,,\n1,,140,\n2,2501,,\n"
    gap = b"t,power,heart_rate,speed\n0,200,,\n1,,140,\n"
    no_speed = json.dumps({"sport": "run", "samples": [{"t": 0, "speed": 3.0}, {"t": 1, "heart_rate": 150}]}).encode()
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, TUE, by_key=True)
        choose_upload(dialog, "Bike", title, "both.csv", both)
        _b_submit(p, dialog)
        _b_refused(p, dialog, "Line 4 is not a valid sample.", "both.csv")
        assert "Every sample needs power for a bike file." not in text_of(dialog.get_by_role("alert")), "check 5 comes before check 6 (L466)"
        dialog.get_by_label("Activity file").set_input_files({"name": "gap.csv", "mimeType": "text/csv", "buffer": gap})
        _b_submit(p, dialog)
        _b_refused(p, dialog, "Every sample needs power for a bike file.", "gap.csv")
        check(dialog.get_by_role("radio", name="Run"))
        dialog.get_by_label("Activity file").set_input_files({"name": "jog.json", "mimeType": "application/json", "buffer": no_speed})
        _b_submit(p, dialog)
        _b_refused(p, dialog, "Every sample needs speed for a run file.", "jog.json")
    _b_nothing_created(api, aid, title, before)


def _c_rest_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def cut(seconds: int) -> int:
        return max(MIN_STEP_S, snap30(seconds * 0.6))

    out: list[dict[str, Any]] = []
    for s in steps:
        if s["kind"] == "interval":
            out.append(interval(s["repeat"], cut(s["work"]["duration_s"]), s["work"]["target_pct"],
                                cut(s["recovery"]["duration_s"]), s["recovery"]["target_pct"]))
        else:
            out.append(dict(s, duration_s=cut(s["duration_s"])))
    return out


def _c_plan_days(plan: dict[str, Any], event_day: str) -> list[tuple[str, int, dict[str, Any]]]:
    first = d(event_day) - timedelta(days=7 * plan["weeks"] - 1)
    return [((first + timedelta(days=e["day"] - 1)).isoformat(), (e["day"] - 1) // 7 + 1, e) for e in plan["entries"]]


def _c_page_text(p: Page) -> str:
    return norm(p.evaluate("document.body.textContent"))


_C_CELL = {"data-planned-tss": "[data-planned-tss]", "data-completed-tss": "[data-completed-tss]", "data-tss": "[data-tss]"}


def _c_cell(row: Locator, attr: str) -> float:
    return num(data_of(row.locator(_C_CELL[attr]), attr))


def _c_planned_of(body: dict[str, Any], t: str, who: str) -> float:
    return sum(plan_tss(r["steps"]) for r in body["workouts"] if r["athlete"] == f"{t}-{who}" and r["kind"] == "planned")


def _c_plan_text(created: int, skipped: int, athlete: str) -> str:
    noun = "workout" if created == 1 else "workouts"
    return f"Added {created} {noun} to {athlete}'s calendar. Skipped {skipped} on days that have already passed."


def test_wf_plan_from_event_keyboard_rest_week(browser: Browser, app_url: str) -> None:
    t = tag("plkey")
    plan = twelve_plan(t)
    w = World(app_url, t, mini(t, plans=[plan]))
    aid = w.id("a1")
    event_day = "2026-12-20"
    event = f"Estuary {t}"
    days = _c_plan_days(plan, event_day)
    created = sum(1 for ds, _, _ in days if ds >= TODAY)
    skipped = len(days) - created
    rest = [(ds, e) for ds, wk, e in days if wk % 4 == 0 and ds >= TODAY]
    rest_monday = (d(rest[0][0]) - timedelta(days=d(rest[0][0]).weekday())).isoformat()
    rest_week = d(rest_monday).strftime("%G-W%V")
    rest_in_week = [(ds, e) for ds, e in rest if d(ds) - d(rest_monday) < timedelta(days=7)]
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week={rest_week}") as ap, \
            signed_in(browser, app_url, w.email("c1"), "/plans") as cp:
        poll(ap, lambda: ap.get_by_role("region", name="Week rail").get_attribute("data-week") == rest_week, "athlete calendar on the rest week")
        opener = cp.get_by_role("button", name=f"Apply {PLAN_TITLE}")
        poll(cp, lambda: opener.count() == 1, "plan tile offers Apply (L127)")
        opener.focus()
        cp.keyboard.press("Enter")
        dlg = cp.get_by_role("dialog", name="Apply plan")
        poll(cp, lambda: dlg.count() == 1 and has_focus(dlg), "Apply plan opens with focus on its first field (L150)")
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TAB_PRESSES):
                cp.keyboard.press(key)
                assert has_focus(dlg), f"{key} wraps inside Apply plan (L150)"
        dlg.get_by_role("button", name="Apply plan", exact=True).focus()
        cp.keyboard.press("Escape")
        poll(cp, lambda: (dlg.count() == 0 or not dlg.is_visible()) and has_focus(opener), "Escape closes and returns focus (L150)")
        cp.keyboard.press("Enter")
        poll(cp, lambda: dlg.count() == 1 and has_focus(dlg), "Enter on the opener reopens Apply plan")
        select(dlg.get_by_role("combobox", name="Athlete"), "Tavi Rennick")
        mode = dlg.get_by_role("radio", name="Count back from event")
        mode.focus()
        cp.keyboard.press("Space")
        poll(cp, lambda: mode.is_checked(), "Space chooses Count back from event")
        dlg.get_by_role("textbox", name="Date").fill(event_day)
        dlg.get_by_role("textbox", name="Event name").fill(event)
        dlg.get_by_role("button", name="Apply plan", exact=True).focus()
        cp.keyboard.press("Enter")
        say(cp, "Plan status", _c_plan_text(created, skipped, "Tavi Rennick"))
        assert "already had workouts" not in text_of(cp.get_by_role("status", name="Plan status")), "kept 0 adds no second sentence (L219)"
        week_planned = 0.0
        for ds, e in rest_in_week:
            steps = _c_rest_steps(e["steps"])
            week_planned += plan_tss(steps)
            it = item_in(ap, ds, e["title"])
            poll(ap, lambda it=it, steps=steps: it.count() == 1 and num(it.get_attribute("data-duration-s")) == plan_seconds(steps)
                 and same(num(it.get_attribute("data-planned-tss")), rnd(plan_tss(steps), 1), 1e-9)
                 and it.get_attribute("data-compliance") == "planned",
                 f"{e['title']} arrives on {ds} at the rest-week share without a reload", LIVE_WINDOW_S)
        tile = week_tile(ap, rest_monday)
        poll(ap, lambda: same(num(data_of(tile, "data-planned-tss")), rnd(week_planned, 1), 1e-9), "rest week tile totals the scaled plan")
        ap.reload()
        band = ap.get_by_role("region", name="Next event")
        left = (d(event_day) - d(TODAY)).days
        poll(ap, lambda: f"{left} days to {event}" in text_of(band) and num(data_of(band, "data-days")) == left,
             "the counted-back event is recorded for the athlete (L502)")


def test_wf_plan_from_event_wall_clock_ui(browser: Browser, app_url: str) -> None:
    t = tag("plwc")
    w = World(app_url, t, demo(t, ezra_link="accepted"))
    eid = w.id("a3")
    plan = twelve_plan(t)
    event_day = "2027-04-11"
    change = "2027-03-28"
    days = _c_plan_days(plan, event_day)
    fives = sorted(ds for ds, _, e in days if e["title"] == "Fives at 110")
    pre, post = max(x for x in fives if x < change), min(x for x in fives if x > change)
    post_week = d(post).strftime("%G-W%V")
    with signed_in(browser, app_url, w.email("a3"), f"/athletes/{eid}?week={post_week}") as ap, \
            signed_in(browser, app_url, w.email("c1"), "/plans") as cp:
        poll(ap, lambda: ap.get_by_role("region", name="Week rail").get_attribute("data-week") == post_week, "Ezra's calendar ready")
        with as_cm(held(cp, "**/api/plans/*/apply")) as h:
            apply_plan_ui(cp, EZRA, "Count back from event", event_day, f"Spring {t}")
            pend = cp.get_by_role("button", name="Applying…")
            poll(cp, lambda: pend.count() == 1 and pend.is_disabled(), "Apply plan pill shows Applying… and is disabled (L209)")
            say(cp, "Plan status", "Applying…")
            h.release()
        say(cp, "Plan status", _c_plan_text(len(days), sum(1 for ds, _, _ in days if ds < TODAY), EZRA))
        assert "already had workouts" not in text_of(cp.get_by_role("status", name="Plan status"))
        it = item_in(ap, post, "Fives at 110")
        poll(ap, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "planned", "Ezra's open calendar shows the plan", LIVE_WINDOW_S)
        found = find(weeks(w.api("a3"), eid, post_week, before=1), "Fives at 110", "planned")
        ids = {ds: wo["id"] for ds, _, wo in found}
        assert pre in ids and post in ids
        for ds in (pre, post):
            cp.goto(f"{app_url}/workouts/{ids[ds]}")
            poll(cp, lambda: cp.get_by_role("heading", name="Fives at 110").count() >= 1
                 and "06:30" in _c_page_text(cp),
                 f"the London coach reads the {ds} start as 06:30 local wall-clock (L512)")


def test_wf_live_upload_comment_paired_row(browser: Browser, app_url: str) -> None:
    t = tag("dashp")
    body = demo(t)
    w = World(app_url, t, body)
    aid, nid = w.id("a1"), w.id("a2")
    title = f"Fives done {t}"
    values = [200] * 3600
    tss = bike_score(values, 250)[2]
    tavi_planned, noor_planned = _c_planned_of(body, t, "a1"), _c_planned_of(body, t, "a2")
    completed = sum(tavi_tss().values()) + tss
    with signed_in(browser, app_url, w.email("c1"), "/coach") as cp, \
            signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as ap:
        table = cp.get_by_role("table", name="Athletes")
        row, noor = table.locator(f'[data-athlete-id="{aid}"]'), table.locator(f'[data-athlete-id="{nid}"]')
        poll(cp, lambda: same(_c_cell(row, "data-planned-tss"), rnd(tavi_planned, 1), 1e-9)
             and same(_c_cell(noor, "data-planned-tss"), rnd(noor_planned, 1), 1e-9), "rows show each athlete's week planned TSS")
        cp.evaluate("window.__groupCMark = 1")
        dialog = open_log_dialog(ap, TODAY, by_key=True)
        choose_upload(dialog, "Bike", title, "fives.csv", ride_csv(values))
        dialog.get_by_role("button", name="Upload session").focus()
        ap.keyboard.press("Enter")
        say(ap, "Session status", f"Saved {title}: {fmt1(tss)} TSS.")
        say(cp, "Notices", f"Tavi Rennick logged {title}: {fmt1(tss)} TSS.", LIVE_WINDOW_S)
        poll(cp, lambda: same(_c_cell(row, "data-completed-tss"), rnd(completed, 1), 1e-9)
             and same(_c_cell(row, "data-tss"), rnd(tss, 1), 1e-9)
             and data_of(row.locator("[data-compliance]"), "data-compliance") == "on-target"
             and LEGEND["on-target"] in text_of(row), "Tavi's row shows the paired, on-target session", LIVE_WINDOW_S)
        assert same(_c_cell(row, "data-planned-tss"), rnd(tavi_planned, 1), 1e-9), "planned total is unchanged by an upload"
        assert same(_c_cell(noor, "data-completed-tss"), 0.0, 1e-9), "another athlete's row is unchanged"
        assert cp.evaluate("window.__groupCMark") == 1, "the dashboard updated in place, without a reload"
    latest = [a for a in w.api("c1").get("/api/athletes").json()["athletes"] if a["id"] == aid][0]["latest"]
    assert latest["compliance"] == "on-target" and latest["completed"]["title"] == title and latest["planned"]["title"] == "Fives at 110"


def test_wf_live_upload_comment_athlete_first(browser: Browser, app_url: str) -> None:
    t = tag("cmta")
    w = World(app_url, t, demo(t))
    wid = w.id("w6")
    body1, body2 = f"Legs heavy {t}", f"Keep it easy {t}"
    with signed_in(browser, app_url, w.email("a1"), f"/workouts/{wid}") as ap, \
            signed_in(browser, app_url, w.email("c1"), f"/workouts/{wid}") as cp:
        for pg in (ap, cp):
            poll(pg, lambda pg=pg: pg.get_by_role("textbox", name="Comment").count() == 1, "comment form shown")
        ap.get_by_role("textbox", name="Comment").fill(body1)
        with as_cm(held(ap, f"**/api/workouts/{wid}/comments")) as h:
            ap.get_by_role("button", name="Post comment").focus()
            ap.keyboard.press("Enter")
            pend = ap.get_by_role("button", name="Posting…")
            poll(ap, lambda: pend.count() == 1 and pend.is_disabled(), "Post comment shows Posting… and is disabled (L223)")
            h.release()
        mine = ap.get_by_role("list", name="Comments").get_by_role("listitem")
        poll(ap, lambda: body1 in text_of(mine.last), "the comment appears at the end of the list (L223)")
        theirs = cp.get_by_role("list", name="Comments")
        poll(cp, lambda: body1 in text_of(theirs), "coach sees the athlete's comment", LIVE_WINDOW_S)
        say(cp, "Notices", "Tavi Rennick commented on Long ride.", LIVE_WINDOW_S)
        assert "Tavi Rennick commented on Long ride." not in text_of(ap.get_by_role("status", name="Notices")), "the notice goes to the other party"
        cp.get_by_role("textbox", name="Comment").fill(body2)
        cp.get_by_role("button", name="Post comment").focus()
        cp.keyboard.press("Enter")
        poll(ap, lambda: body2 in text_of(mine.last) and text_of(ap.get_by_role("list", name="Comments")).index(body1)
             < text_of(ap.get_by_role("list", name="Comments")).index(body2), "athlete sees the reply after their comment", LIVE_WINDOW_S)
        say(ap, "Notices", "Mara Quill commented on Long ride.", LIVE_WINDOW_S)
    got = w.api("c1").get(f"/api/workouts/{wid}/comments").json()["comments"]
    assert [(c["body"], c["author_name"]) for c in got] == [(body1, "Tavi Rennick"), (body2, "Mara Quill")]


def test_wf_coach_access_decline_keyboard(browser: Browser, app_url: str) -> None:
    t = tag("decl")
    w = World(app_url, t, demo(t, ezra_link=None))
    eid = w.id("a3")
    sent = "Request sent to Mara Quill. They'll appear under Coaches once they accept."
    with signed_in(browser, app_url, w.email("c1"), "/inbox") as cp, \
            signed_in(browser, app_url, w.email("a3"), f"/athletes/{eid}") as ap:
        foot = ap.get_by_role("contentinfo")
        field, send = foot.get_by_role("textbox", name="Coach code"), foot.get_by_role("button", name="Send request")
        poll(ap, lambda: field.count() == 1, "footer coach-code form")
        field.fill("ZZZZZZ")
        send.focus()
        ap.keyboard.press("Enter")
        poll(ap, lambda: "No coach uses that code." in error_text(field) and has_focus(field), "field error linked to the field, which gets focus (L209)")
        field.fill(w.code("c1"))
        with as_cm(held(ap, "**/api/links")) as h:
            send.focus()
            ap.keyboard.press("Enter")
            pend = foot.get_by_role("button", name="Sending…")
            poll(ap, lambda: pend.count() == 1 and pend.is_disabled(), "Send request shows Sending… (L221)")
            h.release()
        poll(ap, lambda: sent in text_of(foot), "the form is replaced by the confirmation (L221)")
        say(cp, "Notices", "Ezra Blom sent a link request.", LIVE_WINDOW_S)
        lst = cp.get_by_role("list", name="Link requests")
        poll(cp, lambda: "Ezra Blom wants to join" in text_of(lst), "inbox lists the request live", LIVE_WINDOW_S)
        decline = cp.get_by_role("button", name=f"Decline {EZRA}")
        decline.focus()
        cp.keyboard.press("Enter")
        poll(cp, lambda: "Ezra Blom was declined." in text_of(lst), "the item is replaced by the decline text (L222)")
        mine = [l for l in w.api("a3").get("/api/links").json()["links"] if l["coach_id"] == w.id("c1")]
        assert "declined" in [l["status"] for l in mine]
        assert eid not in [a["id"] for a in w.api("c1").get("/api/athletes").json()["athletes"]]
        ap.reload()
        poll(ap, lambda: field.count() == 1, "footer form after reload")
        field.fill(w.code("c1"))
        send.focus()
        ap.keyboard.press("Enter")
        poll(ap, lambda: sent in text_of(foot), "a new request is allowed after declined (L523)")
        poll(cp, lambda: "Ezra Blom wants to join" in text_of(lst), "the new request reaches the open inbox", LIVE_WINDOW_S)
    statuses = [l["status"] for l in w.api("c1").get("/api/links").json()["links"] if l["athlete_id"] == eid]
    assert "requested" in statuses, "the new request is pending again"


def test_wf_coach_access_remove_detail(browser: Browser, app_url: str) -> None:
    t = tag("rmd")
    w = World(app_url, t, demo(t))
    aid, nid, wid = w.id("a1"), w.id("a2"), w.id("w2")
    with signed_in(browser, app_url, w.email("c1"), f"/workouts/{wid}") as cp, \
            signed_in(browser, app_url, w.email("a1"), "/coaches") as ap:
        poll(cp, lambda: cp.get_by_role("heading", name="Endurance hour").count() >= 1, "coach has Tavi's workout open")
        remove = ap.get_by_role("button", name=f"Remove {MARA}")
        poll(ap, lambda: remove.count() == 1, "the accepted coach has Remove")
        remove.focus()
        ap.keyboard.press("Enter")
        dlg = ap.get_by_role("dialog", name="Remove coach?")
        poll(ap, lambda: dlg.count() == 1 and has_focus(dlg), "Remove coach? opens with focus inside (L150)")
        ap.keyboard.press("Escape")
        poll(ap, lambda: (dlg.count() == 0 or not dlg.is_visible()) and has_focus(remove), "Escape closes and returns focus (L150)")
        assert cp.get_by_role("heading", name="Not found").count() == 0, "Escape removes nothing"
        ap.keyboard.press("Enter")
        poll(ap, lambda: dlg.count() == 1, "dialog reopens")
        dlg.get_by_role("button", name="Remove", exact=True).focus()
        ap.keyboard.press("Enter")
        poll(cp, lambda: cp.get_by_role("heading", name="Not found").count() == 1
             and "This page isn't available to you." in _c_page_text(cp),
             "the coach's open workout becomes the not-found view", LIVE_WINDOW_S)
        poll(ap, lambda: remove.count() == 0, "the removed coach has no Remove pill")
        home = cp.get_by_role("link", name="Back to home")
        home.focus()
        cp.keyboard.press("Enter")
        table = cp.get_by_role("table", name="Athletes")
        poll(cp, lambda: table.count() == 1 and table.locator(f'[data-athlete-id="{nid}"]').count() == 1
             and table.locator(f'[data-athlete-id="{aid}"]').count() == 0, "Back to home shows the dashboard without Tavi")
        resp = cp.goto(f"{app_url}/athletes/{aid}")
        assert resp is not None and resp.status == 404, "a page the coach may no longer open answers 404"
        poll(cp, lambda: cp.get_by_role("heading", name="Not found").count() == 1, "with the not-found view")
    assert w.api("c1").get(f"/api/workouts/{wid}").json() == NOT_FOUND


def test_wf_cross_cutting_one_time_link(browser: Browser, app_url: str) -> None:
    t = tag("otl")
    body = mini(t)
    w = World(app_url, t, body)
    aid = w.id("a1")
    res = seed(app_url, body)
    assert res["ids"] == w.ids, "seeding upserts by key"
    athlete_link, coach_link = res["sign_in"][f"{t}-a1"], res["sign_in"][f"{t}-c1"]
    with signed_in(browser, app_url, None, athlete_link) as p:
        poll(p, lambda: p.get_by_role("region", name="Today").count() == 1, "the one-time link lands on the athlete's own home")
        assert p.request.get(app_url + "/api/me").json()["email"] == w.email("a1")
        p.reload()
        poll(p, lambda: p.get_by_role("region", name="Today").count() == 1, "the session survives a reload")
        with signed_in(browser, app_url, None, "/sign-in") as q:
            resp = q.goto(app_url + athlete_link)
            assert resp is not None and resp.status == 404, "a used link answers 404"
            poll(q, lambda: q.get_by_role("heading", name="Not found").count() == 1, "used link shows the not-found page")
        p.get_by_role("button", name="Sign out").focus()
        p.keyboard.press("Enter")
        poll(p, lambda: p.request.get(app_url + "/api/me").status == 401, "Sign out ends the session")
        p.goto(f"{app_url}/athletes/{aid}")
        poll(p, lambda: urlsplit(p.url).path == "/sign-in" and p.get_by_role("textbox", name="Email").count() == 1,
             "after signing out the home redirects to sign-in")
    with signed_in(browser, app_url, None, coach_link) as c:
        table = c.get_by_role("table", name="Athletes")
        poll(c, lambda: table.count() == 1 and table.locator(f'[data-athlete-id="{aid}"]').count() == 1,
             "the coach's link lands on the coach dashboard")


def _d_small_controls(scope: Locator) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for role in ("button", "tab"):
        found += scope.get_by_role(role).evaluate_all(
            "els => els.map(e => { const r = e.getBoundingClientRect();"
            " return {w: r.width, h: r.height, show: r.width > 0 && r.height > 0,"
            " name: e.getAttribute('aria-label') || e.textContent.trim()} })")
    return [b for b in found if b["show"] and (b["w"] < MIN_TAP_PX - 0.5 or b["h"] < MIN_TAP_PX - 0.5)]


def test_wf_phone_log_bike_close(browser: Browser, app_url: str) -> None:
    t = tag("phbk")
    title = f"Tempo hour {t}"
    plan = [steady(3600, 80)]
    w = World(app_url, t, mini(t, workouts=[planned_rec(t, "p", "a1", TODAY, title, "bike", plan)]))
    aid, api = w.id("a1"), w.api("a1")
    watts = 170
    tss = manual_bike(3600, watts, 250)
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45", viewport=(375, 812), touch=True) as p:
        rail = p.get_by_role("region", name="Week rail")
        poll(p, lambda: rail.get_attribute("data-week") == "2026-W45", "rail centred on today's week")
        it = item_in(p, TODAY, title)
        poll(p, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "planned", "the plan reads Planned before logging")
        tap(chip(p, TODAY).get_by_role("button", name=f"Log session on {day_text(TODAY)}"))
        dlg = p.get_by_role("dialog", name="Log a session")
        poll(p, lambda: dlg.count() == 1, "Log a session opens by touch")
        box = dlg.bounding_box()
        assert box is not None and box["x"] <= 1 and box["x"] + box["width"] >= 375 - 1, "the dialog fills the phone width as a sheet (L99)"
        tap(dlg.get_by_role("tab", name="Enter by hand"))
        tap(dlg.get_by_role("radio", name="Bike"))
        dlg.get_by_role("textbox", name="Title").fill(title)
        dlg.get_by_role("textbox", name="Duration").fill("1:00:00")
        dlg.get_by_role("textbox", name="Average power").fill(str(watts))
        assert _d_small_controls(dlg) == [], "every dialog control is at least 44 px on touch (L182)"
        with as_cm(held(p, "**/api/athletes/*/manual")) as h:
            tap(dlg.get_by_role("button", name="Save session"))
            say(p, "Session status", "Saving…")
            h.release()
        say(p, "Session status", f"Saved {title}: {fmt1(tss)} TSS.")
        poll(p, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "close" and LEGEND["close"] in text_of(it)
             and same(num(it.get_attribute("data-completed-tss")), rnd(tss, 1), 1e-9)
             and same(num(it.get_attribute("data-planned-tss")), rnd(plan_tss(plan), 1), 1e-9), "the paired item reads Close")
        tile = week_tile(p, "2026-11-02")
        poll(p, lambda: num(data_of(tile, "data-count-close")) == 1 and num(data_of(tile, "data-count-planned")) == 0
             and same(num(data_of(tile, "data-completed-tss")), rnd(tss, 1), 1e-9), "week tile tallies one Close session")
        page_layout(p)
        wid = find(weeks(api, aid, "2026-W45"), title, "completed")[0][2]["id"]
        p.goto(f"{app_url}/workouts/{wid}")
        nums = p.get_by_role("group", name="Session numbers")
        poll(p, lambda: all(s in text_of(nums) for s in (f"IF {fmt2(watts / 250)}", f"{fmt1(tss)} TSS", "Duration 1:00:00"))
             and same(num(data_of(nums, "data-if")), rnd(watts / 250, 2), 1e-9), "detail shows the average-based IF and TSS")
    found = find(weeks(api, aid, "2026-W45"), title, "completed")
    assert len(found) == 1 and found[0][1]["compliance"] == "close" and found[0][2]["source"] == "manual"
    assert same(found[0][2]["tss"], tss) and same(found[0][1]["ratio"], tss / plan_tss(plan), 1e-9)


def test_wf_phone_log_date_errors(browser: Browser, app_url: str) -> None:
    t = tag("phdt")
    w = World(app_url, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Phone run {t}"
    secs, pace = 1800, 360
    with signed_in(browser, app_url, w.email("a1"), f"/athletes/{aid}?week=2026-W45", viewport=(375, 812), touch=True) as p:
        rail = p.get_by_role("region", name="Week rail")
        poll(p, lambda: rail.get_attribute("data-week") == "2026-W45", "rail centred on today's week")
        tap(chip(p, "2026-11-06").get_by_role("button", name=f"Log session on {day_text('2026-11-06')}"))
        dlg = p.get_by_role("dialog", name="Log a session")
        poll(p, lambda: dlg.count() == 1, "Log a session opens on Fri 6 Nov")
        tap(dlg.get_by_role("tab", name="Enter by hand"))
        tap(dlg.get_by_role("radio", name="Run"))
        day_box, pace_box = dlg.get_by_role("textbox", name="Day"), dlg.get_by_role("textbox", name="Average pace")
        dlg.get_by_role("textbox", name="Title").fill(title)
        dlg.get_by_role("textbox", name="Duration").fill(fmt_dur(secs))
        pace_box.fill("1:59")
        tap(dlg.get_by_role("button", name="Save session"))
        poll(p, lambda: "Completed sessions cannot be in the future." in error_text(day_box)
             and "Enter a pace from 2:00 to 20:00 per km." in error_text(pace_box)
             and (has_focus(day_box) or has_focus(pace_box)), "both errors attached and an invalid field focused")
        day_box.fill("2026-08-31")
        pace_box.fill("6:00")
        tap(dlg.get_by_role("button", name="Save session"))
        poll(p, lambda: "This day is before the athlete's training history starts." in error_text(day_box) and has_focus(day_box),
             "before-history error attached to Day, which takes focus")
        assert "Saved" not in text_of(p.get_by_role("status", name="Session status"))
        assert find(weeks(api, aid, "2026-W45"), title) == [] and db_mentions(Postgres(), title) == 0
        day_box.fill("2026-11-04")
        tap(dlg.get_by_role("button", name="Save session"))
        tss = manual_run(secs, pace, 300)
        say(p, "Session status", f"Saved {title}: {fmt1(tss)} TSS.")
        it = item_in(p, "2026-11-04", title)
        poll(p, lambda: it.count() == 1 and it.get_attribute("data-compliance") == "unplanned" and LEGEND["unplanned"] in text_of(it)
             and same(num(it.get_attribute("data-tss")), rnd(tss, 1), 1e-9) and num(it.get_attribute("data-duration-s")) == secs
             and it.get_attribute("data-sport") == "run", "the run shows on Wed 4 Nov")
        page_layout(p)
    found = find(weeks(api, aid, "2026-W45"), title, "completed")
    assert len(found) == 1 and found[0][0] == "2026-11-04" and same(found[0][2]["tss"], tss) and same(found[0][2]["if"], 300 / pace)


def test_wf_storage_outage_upload_keyboard(browser: Browser, app_url: str) -> None:
    down = os.environ[STORAGE_DOWN_ENV]
    t = tag("outkb")
    plan_title = f"Plan {t}"
    w = World(down, t, mini(t, workouts=[planned_rec(t, "p", "a1", "2026-11-03", plan_title, "bike", [steady(3600, 80)])]))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Lost run {t}"
    fname = "lost-run.json"
    before = series(api, aid)
    with signed_in(browser, down, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, "2026-11-03", by_key=True)
        choose_upload(dialog, "Run", title, fname, activity_json("run", [3.0] * 1800))
        with as_cm(held(p, "**/api/athletes/*/uploads")) as h:
            dialog.get_by_role("button", name="Upload session").press("Enter")
            say(p, "Session status", f"Uploading {fname}…")
            h.release()
        alert = dialog.get_by_role("alert")
        poll(p, lambda: STORAGE_UPLOAD_MSG in text_of(alert) and has_focus(alert), "outage message in the focused alert")
        assert dialog.is_visible() and selected_files(dialog) == [fname]
        assert STORAGE_UPLOAD_MSG not in text_of(p.get_by_role("status", name="Notices")), "never a toast (L180)"
        assert "Saved" not in text_of(p.get_by_role("status", name="Session status"))
        p.keyboard.press("Escape")
        opener = chip(p, "2026-11-03").get_by_role("button", name=f"Log session on {day_text('2026-11-03')}")
        poll(p, lambda: (dialog.count() == 0 or not dialog.is_visible()) and has_focus(opener), "Escape closes the dialog")
        it = item_in(p, "2026-11-03", plan_title)
        assert it.count() == 1 and it.get_attribute("data-compliance") == "missed" and LEGEND["missed"] in text_of(it)
        assert item_in(p, "2026-11-03", title).count() == 0
        tile = week_tile(p, "2026-11-02")
        assert same(num(data_of(tile, "data-completed-tss")), 0.0, 1e-9) and num(data_of(tile, "data-count-missed")) == 1
        assert num(data_of(tile, "data-count-unplanned")) == 0
        assert "No sessions yet" in text_of(p.get_by_role("region", name="Recent uploads"))

        def chart_unchanged() -> bool:
            rows = {r["date"]: r for r in table_rows(p)}
            pts = {x["date"]: x for x in chart_points(p)}
            return all(ds in rows and ds in pts and row_matches(rows[ds], before[ds]) and point_matches(pts[ds], before[ds])
                       for ds in ("2026-11-03", TODAY))
        poll(p, chart_unchanged, "fitness table and chart keep their values")
    assert find(weeks(api, aid, "2026-W45"), title) == [] and series(api, aid) == before
    assert db_mentions(Postgres("_storagedown"), title) == 0


def test_wf_storage_outage_upload_then_hand(browser: Browser, app_url: str) -> None:
    down = os.environ[STORAGE_DOWN_ENV]
    t = tag("outhd")
    w = World(down, t, mini(t))
    aid, api = w.id("a1"), w.api("a1")
    title = f"Fallback ride {t}"
    day = "2026-11-04"
    tss = manual_bike(3600, 200, 250)
    model = model_series(SERIES_START, TODAY, {day: tss})
    with signed_in(browser, down, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        dialog = open_log_dialog(p, day)
        choose_upload(dialog, "Bike", title, "fallback.csv", ride_csv([200] * 3600))
        dialog.get_by_role("button", name="Upload session").click()
        alert = dialog.get_by_role("alert")
        poll(p, lambda: STORAGE_UPLOAD_MSG in text_of(alert), "outage message in the upload alert")
        assert selected_files(dialog) == ["fallback.csv"]
        dialog.get_by_role("tab", name="Enter by hand").click()
        check(dialog.get_by_role("radio", name="Bike"))
        dialog.get_by_role("textbox", name="Title").fill(title)
        dialog.get_by_role("textbox", name="Duration").fill("1:00:00")
        dialog.get_by_role("textbox", name="Average power").fill("200")
        dialog.get_by_role("button", name="Save session").press("Enter")
        say(p, "Session status", f"Saved {title}: {fmt1(tss)} TSS.")
        wall = p.get_by_role("region", name="Recent uploads")
        poll(p, lambda: f"{title} · {day_text(day)} · {fmt1(tss)} TSS" in text_of(wall), "the hand entry reaches the drift wall")
        banner = p.get_by_role("region", name="Today")
        poll(p, lambda: f"Form {fmt_tsb(model[TODAY]['tsb'])}." in text_of(banner)
             and same(num(data_of(banner, "data-tsb")), rnd(model[TODAY]["tsb"], 1), 1e-9), "the form banner takes the entry")
    found = find(weeks(api, aid, "2026-W45"), title)
    assert len(found) == 1 and found[0][2]["kind"] == "completed" and found[0][2]["source"] == "manual" and found[0][2]["file"] is None
    assert same(series(api, aid)[day]["tss"], tss)


def test_wf_storage_outage_planning(browser: Browser, app_url: str) -> None:
    down = os.environ[STORAGE_DOWN_ENV]
    t = tag("outpl")
    mover, doomed = f"Shift ride {t}", f"Drop run {t}"
    w = World(down, t, mini(t, workouts=[planned_rec(t, "m", "a1", "2026-11-06", mover, "bike", [steady(3600, 80)]),
                                         planned_rec(t, "d", "a1", "2026-11-07", doomed, "run", [steady(2700, 75)])]))
    aid, api = w.id("a1"), w.api("a1")
    with signed_in(browser, down, w.email("a1"), f"/athletes/{aid}?week=2026-W45") as p:
        move = move_button(p, mover)
        poll(p, lambda: move.count() == 1, "the unmatched planned item offers Move")
        move.focus()
        p.keyboard.press("Enter")
        say(p, "Calendar announcements", f"Picked up {mover}. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel.")
        p.keyboard.press("ArrowRight")
        say(p, "Calendar announcements", day_text("2026-11-07"))
        p.keyboard.press("Enter")
        say(p, "Calendar announcements", f"Moved {mover} to {day_text('2026-11-07')}.")
        poll(p, lambda: item_in(p, "2026-11-07", mover).count() == 1 and item_in(p, "2026-11-06", mover).count() == 0,
             "the moved item sits on Saturday")
        p.goto(f"{down}/workouts/{w.id('d')}")
        opener = p.get_by_role("button", name="Delete workout")
        poll(p, lambda: opener.count() == 1 and p.get_by_role("heading", name=doomed).count() >= 1, "the planned workout's page reads")
        opener.click()
        dlg = p.get_by_role("dialog", name="Delete workout?")
        poll(p, lambda: dlg.count() == 1, "confirmation dialog")
        dlg.get_by_role("button", name="Delete").click()
        say(p, "Notices", f"Deleted {doomed}.")
        poll(p, lambda: f"/athletes/{aid}" in p.url or urlsplit(p.url).path == "/", "navigates to the athlete home")
    assert workout(api, w.id("m"))["workout"]["date"] == SAT_DAY
    assert api.get(f"/api/workouts/{w.id('d')}").json() == NOT_FOUND
    assert same(week_row(api, aid, "2026-W45")["planned_tss"], plan_tss([steady(3600, 80)]))
    r = httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "unavailable"}
