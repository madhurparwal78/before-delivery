from __future__ import annotations

import hashlib
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, time as dtime, timedelta, timezone
from math import asin, atan2, cos, degrees, radians, sin, tan, acos
from pathlib import Path
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    advance,
    animations,
    camera,
    capture,
    center,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    motion,
    open_app,
    ready,
    scene_frames,
    select,
    session,
    settle,
    shipped_packages,
    soon,
    tap,
    unique,
)

try:
    from conftest import Postgres
except ImportError:
    from postgres import Postgres
try:
    from conftest import S3
except ImportError:
    from minio import S3


HTTP_TIMEOUT = 60
UI_WAIT_S = 30
REAL_WAIT_S = 60
STEP_MS = 200
SCAN_DAYS = 30
NAME_MAX = 60
BINS = 72
BIN_WIDTH = 5
MASK_MAX = 90
MIN_ALT_MAX = 60
LEADING = 30
GO_MINUTES = 60
STEP_SMALL = 5
STEP_LARGE = 30
CLOUD_LIMIT = 30
TRANSPARENCY_MIN = 3
MOON_ILLUM = 0.25
PLAN_MAX = 8
L_PLANNED = 3600000
HA_PLANNED = 36000
JSON_LIMIT = 65536
UPLOAD_LIMIT = 20000000
REFRESH_MS = 60000
DIALOG_MAX_MS = 500
NAME_SETTLE_MS = 500
LENS_PX = 160
TOUCH_MIN = 44
NARROW = 768
WIDE = 1200
DOME_MIN_FRAC = 0.44
DOME_MAX_FRAC = 0.48
DOME_CENTRE_PX = 40
DOME_RESET = (35, 180, "1.0")
ELEV_MIN, ELEV_MAX = 5, 85
ZOOM_MIN, ZOOM_MAX = "0.6", "2.0"
ORBIT_DRAG_PX = 100
ORBIT_DRAG_DEG = 25
STALE_SHORT_S = 5
TEMP_TOL = 2.0
AGE = {"dark": 180, "flat": 30, "bias": 365}
SUN_TOL = 0.2 + 0.1
MOON_TOL = 0.5 + 0.1
ILLUM_TOL = 0.02 + 0.01
DUSK_TOL_MIN = 2 + 1
NEW_MOON_TOL_MIN = 2 + 1
OCCURRENCE_MAX = 12
SAT_WINDOW = 3
REQUEST_ID = "abcd-1234-efgh"
TT_MINUS_UTC_S = 69.184
EARTH_R_KM = 6378.14
AU_KM = 149597870.7
POLAR_RA = 37.95
POLAR_DEC = 89.0
SOUTH_DEC = -89.0
TRANSIT_DEC = 20.0
WRONG_CLOCK = datetime(2031, 6, 1, 9, 0, tzinfo=timezone.utc)
FRAME_PAD = 4096
PROTO_RELATIVE = "/" * 2
MASTER_A = "a.fits"
MASTER_B = "b.fits"
FRAME_ONE = "light_001.png"
FRAME_FOUR = "light_004.fits"
DARK_MASTER = "dark_master.fits"
REDUCED_MOTION_MAX_MS = 20
NO_REDIS = "redis"
SORA = "sora"
PLANNED_HA = "Planned minutes Ha"
PLANNED_L = "Planned minutes L"
CALIBRATE_HA_1 = "Calibrate Ha batch 1"
NOTES_KEPT = "Kept through the timer."
NOTES_HELD = "Typed while held."
EVIL_LABEL = "Evil"
CORS_HEADER = "access-control-allow-origin"
SECRET_LABEL = "Secret yard"
STORED_A = "light_a.png stored."
COOKIE = "darkframe_key"
RESTORE_TO = 2

FILTER_ORDER = ["L", "R", "G", "B", "Ha", "OIII", "SII"]
NARROWBAND = {"Ha", "OIII", "SII"}
VERDICT_WORDS = {"go": "Go", "no-go": "No-go", "unknown": "Unknown"}
STATUS_TEXT = {"clear": "Clear", "behind-treeline": "Behind the treeline",
               "below-minimum": "Below minimum altitude", "below-horizon": "Below the horizon"}

NO_CONDITIONS = "No sky conditions entered for this night. Add hourly cloud, transparency and seeing to get a verdict."
STALE_BANNER = "Sky conditions are out of date. Re-enter them for the hours still ahead."
NO_WEBGL = "3D sky is unavailable on this device. Showing the flat sky chart."
NO_LENS = "No target under the lens"
WRONG_KEY = "That workspace key is not recognised."
CHECK_FIELDS = "Check the highlighted fields."
UNSENT = "Push not sent yet. Darkframe will retry."
EMPTY_LIBRARY = "Your calibration library is empty. Add a dark, flat or bias set to start matching frames."
SHARE_GONE = "This shared project link is no longer available."
LOCK_EXPIRED = "Your edit lock expired. Your notes are kept; save to take the lock again."
LOCK_HELD = "This session is open for editing on another device."
UNLOCK_FIRST = "Unlock your workspace first."
READ_ONLY = "Shared project links are read-only."
CROSS_ORIGIN = "Requests must come from Darkframe itself."
NOT_PLANNED = "This filter is not planned for the project."
KIND_FIXED = "The kind of a set cannot change."
REFUSAL_EXAMPLE = "Calibration refused: gain 120 does not match 100; temperature -5.0 C is more than 2.0 C from -10.0 C."

DOME_RE = re.compile(r"Sky dome: camera elevation (-?\d+) degrees, azimuth (\d+) degrees, zoom (\d+\.\d), night minute (\d+)")
PAINTER_RE = re.compile(r"Horizon painter: azimuth (\d+) degrees, mask altitude (\d+) degrees")

BATCH = {"filter": "Ha", "sub_count": 60, "exposure_s": 300, "camera": "Umbra 26M", "gain": 100,
         "offset": 50, "temperature_c": -10.0, "binning": 1}
SITE_INES = (52.2053, 0.1218, 15, "Europe/London")
SITE_TOMASZ = (37.1773, -3.5986, 690, "Europe/Madrid")
SITE_LA = (34.05, -118.24, 90, "America/Los_Angeles")
INTERNAL_OFFSETS = {"sky-engine": 100, "ledger": 200, "push-dispatcher": 300}
CLEAR = {"cloud_pct": CLOUD_LIMIT, "transparency": TRANSPARENCY_MIN, "seeing": 3}
CLOUDY = {"cloud_pct": 100, "transparency": 5, "seeing": 3}
THIN = {"cloud_pct": CLOUD_LIMIT + 1, "transparency": 5, "seeing": 3}
HAZY = {"cloud_pct": 0, "transparency": TRANSPARENCY_MIN - 1, "seeing": 3}


def base_of(url: str) -> str:
    return url.rstrip("/")


def call(base, method, path, key=None, body=None, *, content=None, ctype=None, headers=None):
    h = dict(headers or {})
    if key:
        h["Authorization"] = f"Bearer {key}"
    kw = {}
    if content is not None:
        kw["content"] = content
        if ctype:
            h["Content-Type"] = ctype
    elif body is not None:
        kw["content"] = json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    return httpx.request(method, base + path, headers=h, timeout=HTTP_TIMEOUT, **kw)


def ok(r, status):
    assert r.status_code == status, (
        f"{r.request.method} {r.request.url.path} answered {r.status_code}, expected {status}: {r.text[:600]}")
    if r.content and "json" in r.headers.get("content-type", ""):
        return r.json()
    return None


def err(r, status, code):
    assert r.status_code == status, (
        f"{r.request.method} {r.request.url.path} answered {r.status_code}, expected {status} {code}: {r.text[:600]}")
    body = r.json()
    assert body["error"]["code"] == code, f"expected error code {code}, got {body}"
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    return body


def instance(env: str) -> str:
    url = os.environ.get(env)
    assert url, f"{env} is not set; the spec's outage instance is required"
    return base_of(url)


def topic() -> str:
    return "df-" + hashlib.sha1(unique("topic")[0].encode()).hexdigest()[:20]


def workspace(base, *, site=SITE_INES, min_alt=0, push_topic=None, mask=0, label=None):
    lat, lon, elev, tz = site
    name = unique("darkframe")[0][:NAME_MAX]
    lbl = (label or ("Site " + name))[:NAME_MAX]
    body = ok(call(base, "POST", "/api/workspaces", None, {
        "name": name, "site": {"label": lbl, "latitude": lat, "longitude": lon,
                               "elevation_m": elev, "time_zone": tz}}), 201)
    key = body["key"]
    ok(call(base, "PATCH", "/api/site", key, {"min_altitude_deg": min_alt, "push_topic": push_topic}), 200)
    ok(call(base, "PUT", "/api/site/horizon", key, {"altitudes": [mask] * BINS}), 200)
    return {"key": key, "id": body["imager_id"], "name": name, "label": lbl,
            "lat": lat, "lon": lon, "tz": tz}


def project(base, key, *, ra=POLAR_RA, dec=POLAR_DEC, allot=None, active=True, name=None):
    nm = (name or unique("Project")[0])[:NAME_MAX]
    tg = ("T " + nm)[:NAME_MAX]
    p = ok(call(base, "POST", "/api/projects", key,
                {"name": nm, "target_name": tg, "ra_deg": ra, "dec_deg": dec}), 201)
    for f, s in (allot if allot is not None else {"Ha": HA_PLANNED}).items():
        ok(call(base, "PUT", f"/api/projects/{p['id']}/allotments/{f}", key, {"planned_seconds": s}), 200)
    if active:
        ok(call(base, "POST", f"/api/projects/{p['id']}/transition", key, {"to": "active"}), 200)
    return ok(call(base, "GET", f"/api/projects/{p['id']}", key), 200)


def get_project(base, key, pid):
    return ok(call(base, "GET", f"/api/projects/{pid}", key), 200)


def owed(proj, filt):
    return {f["filter"]: f for f in proj["filters"]}[filt]["owed_seconds"]


def new_session(base, key, pid, observing_date="2026-10-14", notes=""):
    return ok(call(base, "POST", "/api/sessions", key,
                   {"project_id": pid, "observing_date": observing_date, "notes": notes}), 201)


def start(base, key, sid, started_at=None):
    body = {} if started_at is None else {"started_at": started_at}
    return ok(call(base, "POST", f"/api/sessions/{sid}/start", key, body), 200)


def add_batch(base, key, sid, **over):
    body = {**BATCH, **over}
    return ok(call(base, "POST", f"/api/sessions/{sid}/batches", key, body,
                   headers={"Idempotency-Key": idempotency_key()}), 201)


def logged_session(base, key, pid, batches=None, notes=""):
    s = new_session(base, key, pid, notes=notes)
    start(base, key, s["id"])
    for b in batches or [{}]:
        add_batch(base, key, s["id"], **b)
    return ok(call(base, "POST", f"/api/sessions/{s['id']}/log", key, {}), 200)


def get_session(base, key, sid):
    return ok(call(base, "GET", f"/api/sessions/{sid}", key), 200)


def plan(base, key, d, minute=None):
    q = "" if minute is None else f"?minute={minute}"
    return ok(call(base, "GET", f"/api/plans/{d}{q}", key), 200)


def add_target(base, key, d, pid):
    return ok(call(base, "POST", f"/api/plans/{d}/targets", key, {"project_id": pid}), 201)


def put_conditions(base, key, d, rule):
    hours = plan(base, key, d)["hours"]
    entries = [{"hour_start": h, **rule(i, h)} for i, h in enumerate(hours)]
    return ok(call(base, "PUT", f"/api/plans/{d}/conditions", key, {"hours": entries}), 200)


def tonight(base, key):
    return ok(call(base, "GET", "/api/tonight", key), 200)


def site_today(base, key, tz):
    now = datetime.fromisoformat(tonight(base, key)["server_time"].replace("Z", "+00:00"))
    return now.astimezone(ZoneInfo(tz)).date()


def dark_night(base, key):
    t = date.fromisoformat(tonight(base, key)["date"])
    best = None
    for i in range(SCAN_DAYS):
        d = t + timedelta(days=2 + i)
        n = ok(call(base, "GET", f"/api/sky/night?date={d}", key), 200)
        if n["has_astronomical_night"] and n["minutes"] > 2 * GO_MINUTES:
            if best is None or n["moon_illumination"] < best[1]["moon_illumination"]:
                best = (d.isoformat(), n)
    assert best and best[1]["moon_illumination"] < MOON_ILLUM, (
        "GET /api/sky/night found no night under 0.25 illumination across a lunation")
    return best


def cal_set(base, key, kind="dark", today=None, **over):
    body = {"name": unique("Set")[0][:NAME_MAX], "kind": kind, "camera": BATCH["camera"],
            "gain": BATCH["gain"], "offset": BATCH["offset"],
            "exposure_s": BATCH["exposure_s"] if kind == "dark" else None,
            "temperature_c": BATCH["temperature_c"], "binning": 1,
            "filter": "Ha" if kind == "flat" else None, "frame_count": 40,
            "captured_on": (today or date.today()).isoformat()}
    body.update(over)
    return ok(call(base, "POST", "/api/calibration-sets", key, body), 201)


def put_master(base, key, sid, name, data, ctype="application/octet-stream"):
    return call(base, "PUT", f"/api/calibration-sets/{sid}/master?filename={name}", key,
                content=data, ctype=ctype)


def ready_set(base, key, kind="dark", today=None, **over):
    s = cal_set(base, key, kind, today, **over)
    ok(put_master(base, key, s["id"], "master.fits", b"DARKFRAME-SEED-MASTER " + s["name"].encode()), 200)
    return ok(call(base, "POST", f"/api/calibration-sets/{s['id']}/transition", key, {"to": "ready"}), 200)


def put_frame(base, key, bid, name, data, ctype="image/png"):
    return call(base, "PUT", f"/api/batches/{bid}/frames/{name}", key, content=data, ctype=ctype)


def png_bytes(n=FRAME_PAD):
    return b"\x89PNG\r\n\x1a\n" + os.urandom(n)


def poll(fetch, done, describe, seconds=REAL_WAIT_S):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fetch()
        if done(last):
            return last
    pytest.fail(describe(last))


def wait_real(base, seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        call(base, "GET", "/api/health")


def at(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def hhmm(iso: str) -> str:
    return iso[11:16]


def duration(sec: int) -> str:
    if sec < 0:
        return "Over by " + duration(-sec)
    h, rem = divmod(int(sec), 3600)
    return f"{h} h {rem // 60:02d} min"


def long_date(d: str) -> str:
    x = date.fromisoformat(d)
    return f"Night of {x:%A} {x.day} {x:%B} {x.year}"


def local_at(pl, m) -> str:
    dusk = at(pl["night"]["dusk"])
    return (dusk + timedelta(minutes=m)).astimezone(dusk.tzinfo if False else ZoneInfo(pl["site"]["time_zone"])).strftime("%H:%M")


def grid(x: float) -> str:
    from decimal import Decimal, ROUND_HALF_UP
    q = (Decimal(str(x)) / Decimal("0.5")).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * Decimal("0.5")
    v = f"{float(q):.1f}"
    return "0.0" if v == "-0.0" else v


def best_usable(pl):
    return pl["best"]["usable_minutes"] if pl["best"] else 0


def owed_after(pl):
    return sum(f["owed_after_tonight_seconds"] for t in pl["targets"] if t["counts"] for f in t["filters"])


def countdown(pl):
    cw = pl["clear_window"]
    if pl["is_tonight"]:
        if cw is None:
            return "No clear window tonight"
        s = cw["starts_in_minutes"]
        if s > 0:
            return f"Clear window opens in {s // 60} h {s % 60:02d} min"
        return f"Clear window open until {hhmm(cw['end'])}"
    return "No clear window" if cw is None else f"Clear window {hhmm(cw['start'])}-{hhmm(cw['end'])}"


def card_lines(pl):
    lines = [VERDICT_WORDS[pl["verdict"]], f"{best_usable(pl)} usable minutes",
             f"Owed after tonight: {duration(owed_after(pl))}",
             f"Moon {round(pl['moon']['illumination'] * 100)}% lit", countdown(pl)]
    if pl["best"]:
        lines.append(f"Best: {pl['best']['target_name']} in {pl['best']['filter']}")
    return lines


def plan_update(pl, prefix=""):
    return f"{prefix}At {pl['time_local']}: {VERDICT_WORDS[pl['verdict']]}, {best_usable(pl)} usable minutes left."


def text(loc) -> str:
    try:
        return " ".join(loc.inner_text(timeout=1000).split())
    except PlaywrightError:
        return ""


def eventually(page, check, describe, seconds=UI_WAIT_S):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except PlaywrightError:
            pass
        advance(page, STEP_MS)
    pytest.fail(describe())


def see(page, loc, expected, what):
    eventually(page, lambda: expected in text(loc), lambda: f"{what}: expected {expected!r}, saw {text(loc)!r}")


def see_all(page, loc, expected, what):
    eventually(page, lambda: all(e in text(loc) for e in expected),
               lambda: f"{what}: expected all of {expected!r}, saw {text(loc)!r}")


def acc_name(loc) -> str:
    try:
        lbl = loc.get_attribute("aria-label", timeout=3000)
        if lbl:
            return " ".join(lbl.split())
        snap = loc.aria_snapshot(timeout=3000)
        m = re.search(r'"([^"]*)"', snap)
        return m.group(1) if m else ""
    except PlaywrightError:
        return ""


def slider(page):
    return page.get_by_role("slider", name="Night time", exact=True)


def sval(page) -> int:
    v = slider(page).evaluate("e => e.getAttribute('aria-valuenow') ?? e.value", timeout=3000)
    return int(float(v))


def stext(page) -> str:
    return slider(page).evaluate("e => e.getAttribute('aria-valuetext') ?? ''", timeout=3000)


def smax(page) -> int:
    v = slider(page).evaluate("e => e.getAttribute('aria-valuemax') ?? e.max", timeout=3000)
    return int(float(v))


def ready_slider(page, minutes, what):
    eventually(page, lambda: smax(page) == minutes,
               lambda: f"{what}: slider max expected {minutes}, saw {smax(page)}")


def want_slider(page, m, what):
    eventually(page, lambda: sval(page) == m, lambda: f"{what}: slider value expected {m}, saw {sval(page)}")


def focused(loc) -> bool:
    return loc.evaluate("e => e === document.activeElement || e.contains(document.activeElement)")


def dome(page):
    return page.get_by_role("img", name=re.compile(r"^Sky dome: camera elevation"))


def dome_state(page):
    m = DOME_RE.search(acc_name(dome(page)))
    return None if m is None else (int(m.group(1)), int(m.group(2)), m.group(3), int(m.group(4)))


def want_dome(page, state, what):
    eventually(page, lambda: dome_state(page) == state, lambda: f"{what}: dome name {acc_name(dome(page))!r}, expected {state}")


def region_shot(loc):
    loc.scroll_into_view_if_needed()
    return decode(capture(loc))


def card(page):
    return page.get_by_role("region", name="Tonight verdict", exact=True)


def gone(loc) -> bool:
    if loc.count() == 0:
        return True
    try:
        if not loc.first.is_visible():
            return True
        return float(loc.first.evaluate("e => getComputedStyle(e).opacity")) == 0
    except PlaywrightError:
        return True


@contextmanager
def unlocked(browser, base, key, path, **kw):
    with open_app(browser, base + "/unlock", **kw) as page:
        fill(page.get_by_role("textbox", name="Workspace key", exact=True), key)
        click(page.get_by_role("button", name="Unlock", exact=True))
        eventually(page, lambda: "/unlock" not in page.url, lambda: f"unlock stayed on {page.url}")
        page.goto(base + path)
        yield page


def touch_drag(page, start_xy, end_xy, steps=10):
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    (x0, y0), (x1, y1) = start_xy, end_xy
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
            {"x": x0 + (x1 - x0) * i / steps, "y": y0 + (y1 - y0) * i / steps}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def box(loc):
    b = loc.bounding_box(timeout=5000)
    assert b, "expected a visible element with a box"
    return b


RECORD_JS = """(el) => { window.__dflog = window.__dflog || []; const log = window.__dflog;
 log.push(el.textContent.trim());
 new MutationObserver(rs => { for (const r of rs) { if (r.type === 'characterData') log.push(r.target.data);
   for (const n of r.addedNodes) log.push((n.textContent || '').trim()); } log.push(el.textContent.trim()); })
 .observe(el, {childList: true, subtree: true, characterData: true}); }"""


def open_editor(page, date_, project_name):
    ed = page.get_by_role("dialog", name="Session editor", exact=True)
    if gone(ed):
        click(page.get_by_role("button", name=f"Open session {date_} {project_name}", exact=True))
    eventually(page, lambda: not gone(ed), lambda: "Session editor did not open")
    return ed


def fill_batch(dlg, batch):
    select(dlg.get_by_role("combobox", name="Filter", exact=True), batch["filter"])
    fill(dlg.get_by_role("spinbutton", name="Subs", exact=True), str(batch["sub_count"]))
    fill(dlg.get_by_role("spinbutton", name="Sub exposure (s)", exact=True), str(batch["exposure_s"]))
    fill(dlg.get_by_role("spinbutton", name="Gain", exact=True), str(batch["gain"]))
    fill(dlg.get_by_role("spinbutton", name="Offset", exact=True), str(batch["offset"]))
    fill(dlg.get_by_role("spinbutton", name="Sensor temperature (C)", exact=True), str(batch["temperature_c"]))
    fill(dlg.get_by_role("spinbutton", name="Binning", exact=True), str(batch["binning"]))
    fill(dlg.get_by_role("textbox", name="Camera", exact=True), batch["camera"])


def ui_log_session(page, base, project_name, observing_date, batch, start_local):
    page.goto(base + "/sessions")
    click(page.get_by_role("button", name="New session", exact=True))
    dlg = page.get_by_role("dialog", name="New session", exact=True)
    select(dlg.get_by_role("combobox", name="Project", exact=True), project_name)
    fill(dlg.get_by_role("textbox", name="Observing date", exact=True), observing_date)
    click(dlg.get_by_role("button", name="Create session", exact=True))
    log = page.get_by_role("status", name="Session log", exact=True)
    see(page, log, f"Session created for {observing_date}.", "Session log after create")
    ed = open_editor(page, observing_date, project_name)
    fill(ed.get_by_role("textbox", name="Started at", exact=True), start_local)
    click(ed.get_by_role("button", name="Start imaging", exact=True))
    see(page, log, "Imaging started. Night of ", "Session log after start")
    click(ed.get_by_role("button", name="Log batch", exact=True))
    bd = page.get_by_role("dialog", name="Log batch", exact=True)
    fill_batch(bd, batch)
    click(bd.get_by_role("button", name="Add batch", exact=True))
    see(page, log, f"{batch['sub_count']} subs of {batch['exposure_s']} s in {batch['filter']} added.", "batch copy")
    click(ed.get_by_role("button", name="Finish and log", exact=True))
    see(page, log, f"Session logged: {duration(batch['sub_count'] * batch['exposure_s'])} integrated.", "logged copy")
    return ed


def plan_setup(base, *, mask=0, min_alt=0, allot=None, push_topic=None, conditions=True):
    ws = workspace(base, mask=mask, min_alt=min_alt, push_topic=push_topic)
    key = ws["key"]
    d, n = dark_night(base, key)
    p = project(base, key, allot=allot if allot is not None else {"L": L_PLANNED, "Ha": HA_PLANNED})
    add_target(base, key, d, p["id"])
    if conditions:
        put_conditions(base, key, d, lambda i, h: CLEAR)
    return ws, key, d, n, p


def jd(t: datetime) -> float:
    return t.timestamp() / 86400 + 2440587.5


def gmst_deg(j):
    t = (j - 2451545.0) / 36525
    return (280.46061837 + 360.98564736629 * (j - 2451545.0) + 0.000387933 * t * t - t ** 3 / 38710000) % 360


def sun_radec(j):
    n = j - 2451545.0
    lon = (280.460 + 0.9856474 * n) % 360
    g = radians((357.528 + 0.9856003 * n) % 360)
    lam = radians(lon + 1.915 * sin(g) + 0.020 * sin(2 * g))
    eps = radians(23.439 - 0.0000004 * n)
    return degrees(atan2(cos(eps) * sin(lam), cos(lam))) % 360, degrees(asin(sin(eps) * sin(lam)))


def altaz(ra, dec, j, lat, lon):
    h = radians(gmst_deg(j) + lon - ra)
    d, p = radians(dec), radians(lat)
    alt = degrees(asin(sin(p) * sin(d) + cos(p) * cos(d) * cos(h)))
    az = degrees(atan2(-sin(h) * cos(d), sin(d) * cos(p) - cos(d) * sin(p) * cos(h))) % 360
    return alt, az


def precess(ra0, dec0, j):
    t = (j - 2451545.0) / 36525
    zeta = radians((2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) / 3600)
    z = radians((2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) / 3600)
    th = radians((2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) / 3600)
    a0, d0 = radians(ra0), radians(dec0)
    a = cos(d0) * sin(a0 + zeta)
    b = cos(th) * cos(d0) * cos(a0 + zeta) - sin(th) * sin(d0)
    c = sin(th) * cos(d0) * cos(a0 + zeta) + cos(th) * sin(d0)
    return (degrees(atan2(a, b)) + degrees(z)) % 360, degrees(asin(c))


LR = [(0, 0, 1, 0, 6288774, -20905355), (2, 0, -1, 0, 1274027, -3699111), (2, 0, 0, 0, 658314, -2955968),
      (0, 0, 2, 0, 213618, -569925), (0, 1, 0, 0, -185116, 48888), (0, 0, 0, 2, -114332, -3149),
      (2, 0, -2, 0, 58793, 246158), (2, -1, -1, 0, 57066, -152138), (2, 0, 1, 0, 53322, -170733),
      (2, -1, 0, 0, 45758, -204586), (0, 1, -1, 0, -40923, -129620), (1, 0, 0, 0, -34720, 108743),
      (0, 1, 1, 0, -30383, 104755), (2, 0, 0, -2, 15327, 10321), (0, 0, 1, 2, -12528, 0),
      (0, 0, 1, -2, 10980, 79661), (4, 0, -1, 0, 10675, -34782), (0, 0, 3, 0, 10034, -23210),
      (4, 0, -2, 0, 8548, -21636), (2, 1, -1, 0, -7888, 24208), (2, 1, 0, 0, -6766, 30824),
      (1, 0, -1, 0, -5163, -8379), (1, 1, 0, 0, 4987, -16675), (2, -1, 1, 0, 4036, -12831),
      (2, 0, 2, 0, 3994, -10445), (4, 0, 0, 0, 3861, -11650), (2, 0, -3, 0, 3665, 14403),
      (0, 1, -2, 0, -2689, -7003), (2, 0, -1, 2, -2602, 0), (2, -1, -2, 0, 2390, 10056),
      (1, 0, 1, 0, -2348, 6322), (2, -2, 0, 0, 2236, -9884)]
BT = [(0, 0, 0, 1, 5128122), (0, 0, 1, 1, 280602), (0, 0, 1, -1, 277693), (2, 0, 0, -1, 173237),
      (2, 0, -1, 1, 55413), (2, 0, -1, -1, 46271), (2, 0, 0, 1, 32573), (0, 0, 2, 1, 17198),
      (2, 0, 1, -1, 9266), (0, 0, 2, -1, 8822), (2, -1, 0, -1, 8216), (2, 0, -2, -1, 4324),
      (2, 0, 1, 1, 4200), (2, 1, 0, -1, -3359), (2, -1, -1, 1, 2463), (2, -1, 0, 1, 2211),
      (2, -1, -1, -1, 2065), (0, 1, -1, -1, -1870), (4, 0, -1, -1, 1828), (0, 1, 0, 1, -1794),
      (0, 0, 0, 3, -1749), (0, 1, -1, 1, -1565), (1, 0, 0, 1, -1491), (0, 1, 1, 1, -1475),
      (0, 1, 1, -1, -1410), (0, 1, 0, -1, -1344), (1, 0, 0, -1, -1335)]


def moon_geo(j):
    t = (j - 2451545.0) / 36525
    lp = 218.3164477 + 481267.88123421 * t
    dd = 297.8501921 + 445267.1114034 * t
    mm = 357.5291092 + 35999.0502909 * t
    mp = 134.9633964 + 477198.8675055 * t
    ff = 93.2720950 + 483202.0175233 * t
    a1, a2, a3 = 119.75 + 131.849 * t, 53.09 + 479264.290 * t, 313.45 + 481266.484 * t
    e = 1 - 0.002516 * t
    sl = sr = sb = 0.0
    for d_, m_, p_, f_, l_, r_ in LR:
        arg = radians(d_ * dd + m_ * mm + p_ * mp + f_ * ff)
        sl += l_ * e ** abs(m_) * sin(arg)
        sr += r_ * e ** abs(m_) * cos(arg)
    for d_, m_, p_, f_, b_ in BT:
        sb += b_ * e ** abs(m_) * sin(radians(d_ * dd + m_ * mm + p_ * mp + f_ * ff))
    sl += 3958 * sin(radians(a1)) + 1962 * sin(radians(lp - ff)) + 318 * sin(radians(a2))
    sb += (-2235 * sin(radians(lp)) + 382 * sin(radians(a3)) + 175 * sin(radians(a1 - ff))
           + 175 * sin(radians(a1 + ff)) + 127 * sin(radians(lp - mp)) - 115 * sin(radians(lp + mp)))
    lam, beta, dist = radians(lp + sl / 1e6), radians(sb / 1e6), 385000.56 + sr / 1000
    eps = radians(23.4392911 - 0.0130042 * t)
    ra = degrees(atan2(sin(lam) * cos(eps) - tan(beta) * sin(eps), cos(lam))) % 360
    dec = degrees(asin(sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lam)))
    return ra, dec, dist


def moon_topo(t, lat, lon):
    j = jd(t)
    ra, dec, dist = moon_geo(j)
    alt, az = altaz(ra, dec, j, lat, lon)
    a = radians(alt)
    return degrees(atan2(dist * sin(a) - EARTH_R_KM, dist * cos(a))), az


def sep(alt1, az1, alt2, az2):
    a1, z1, a2, z2 = map(radians, (alt1, az1, alt2, az2))
    c = sin(a1) * sin(a2) + cos(a1) * cos(a2) * cos(z1 - z2)
    return degrees(acos(max(-1.0, min(1.0, c))))


def illumination(t):
    j = jd(t)
    sra, sdec = sun_radec(j)
    mra, mdec, dist = moon_geo(j)
    psi = radians(sep(sdec, sra, mdec, mra))
    g = radians((357.528 + 0.9856003 * (j - 2451545.0)) % 360)
    r = AU_KM * (1.00014 - 0.01671 * cos(g) - 0.00014 * cos(2 * g))
    i = atan2(r * sin(psi), dist - r * cos(psi))
    return (1 + cos(i)) / 2


def ref_dusk_dawn(d: date, lat, lon, tz):
    noon = datetime.combine(d, dtime(12, 0), tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)
    dusk = None
    for i in range(1, 24 * 60 + 1):
        t = noon + timedelta(minutes=i)
        j = jd(t)
        alt = altaz(*sun_radec(j), j, lat, lon)[0]
        if dusk is None and alt < -18:
            dusk = t
        elif dusk is not None and alt >= -18:
            return dusk, t
    return dusk, None


def angdiff(a, b):
    return abs((a - b + 180) % 360 - 180)


def new_moons_utc(start: datetime, count: int):
    out = []
    k = int((start.year + (start.timetuple().tm_yday / 366) - 2000) * 12.3685) - 2
    while len(out) < count:
        tt = k / 1236.85
        jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * tt ** 2 - 0.00000015 * tt ** 3
        e = 1 - 0.002516 * tt - 0.0000074 * tt ** 2
        m = radians(2.5534 + 29.10535670 * k - 0.0000014 * tt ** 2)
        mp = radians(201.5643 + 385.81693528 * k + 0.0107582 * tt ** 2 + 0.00001238 * tt ** 3)
        f = radians(160.7108 + 390.67050284 * k - 0.0016118 * tt ** 2 - 0.00000227 * tt ** 3)
        om = radians(124.7746 - 1.56375588 * k + 0.0020672 * tt ** 2)
        corr = (-0.40720 * sin(mp) + 0.17241 * e * sin(m) + 0.01608 * sin(2 * mp) + 0.01039 * sin(2 * f)
                + 0.00739 * e * sin(mp - m) - 0.00514 * e * sin(mp + m) + 0.00208 * e * e * sin(2 * m)
                - 0.00111 * sin(mp - 2 * f) - 0.00057 * sin(mp + 2 * f) + 0.00056 * e * sin(2 * mp + m)
                - 0.00042 * sin(3 * mp) + 0.00042 * e * sin(m + 2 * f) + 0.00038 * e * sin(m - 2 * f)
                - 0.00024 * e * sin(2 * mp - m) - 0.00017 * sin(om) - 0.00007 * sin(mp + 2 * m)
                + 0.00004 * sin(2 * mp - 2 * f) + 0.00004 * sin(3 * m) + 0.00003 * sin(mp + m - 2 * f)
                + 0.00003 * sin(2 * mp + 2 * f) - 0.00003 * sin(mp + m + 2 * f) + 0.00003 * sin(mp - m + 2 * f)
                - 0.00002 * sin(mp - m - 2 * f) - 0.00002 * sin(3 * mp + m) + 0.00002 * sin(4 * mp))
        t = datetime(2000, 1, 1, 12, tzinfo=timezone.utc) + timedelta(days=jde + corr - 2451545.0,
                                                                        seconds=-TT_MINUS_UTC_S)
        if t >= start:
            out.append(t)
        k += 1
    return out


def expected_usable(pl, filt, m, entries):
    dusk = at(pl["night"]["dusk"])
    minutes = pl["night"]["minutes"]
    nb = filt in NARROWBAND
    lo = (-LEADING if nb else 0) if m == 0 else m
    hi = minutes + LEADING if nb else minutes
    starts = [(at(e["hour_start"]), e) for e in entries]

    def sky(i):
        inst = dusk + timedelta(minutes=i)
        for s, e in starts:
            if s <= inst < s + timedelta(hours=1):
                return e["cloud_pct"] <= CLOUD_LIMIT and e["transparency"] >= TRANSPARENCY_MIN
        return False

    good = [i for i in range(lo, hi) if sky(i)]
    run = None
    if good:
        s = e_ = good[0]
        gs = set(good)
        while e_ + 1 in gs:
            e_ += 1
        run = (s, e_ + 1)
    return len(good), run


def test_workspace_creation_and_unlock(app_url):
    base = base_of(app_url)
    lat, lon, elev, tz = SITE_INES
    name = unique("darkframe")[0][:NAME_MAX]
    site = {"label": "Back garden", "latitude": lat, "longitude": lon, "elevation_m": elev, "time_zone": tz}
    body = ok(call(base, "POST", "/api/workspaces", None, {"name": name, "site": site}), 201)
    assert re.fullmatch(r"dfk_[0-9a-f]{32}", body["key"]), body
    assert body["name"] == name and isinstance(body["imager_id"], str)
    key = body["key"]
    for path in ("/api/me", "/api/site", "/api/projects", "/api/calibration-sets", "/api/tonight"):
        e = err(call(base, "GET", path), 401, "unauthenticated")
        assert e["error"]["message"] == UNLOCK_FIRST
    err(call(base, "GET", "/api/me", "dfk_" + "0" * 32), 401, "unauthenticated")
    me = ok(call(base, "GET", "/api/me", key), 200)
    assert me["imager_id"] == body["imager_id"] and me["name"] == name
    err(call(base, "POST", "/api/unlock", None, {"key": "dfk_" + "0" * 32}), 401, "invalid_key")
    r = call(base, "POST", "/api/unlock", None, {"key": key})
    assert r.status_code == 204, r.text
    sc = r.headers.get("set-cookie", "")
    assert f"{COOKIE}=" in sc and "HttpOnly".lower() in sc.lower()
    assert "SameSite Strict".lower() in sc.lower().replace("=", " ")
    assert re.search(r"path=/(;|$)", sc.lower()), sc
    cookie = re.search(rf"{COOKIE}=([^;]*)", sc).group(1)
    assert ok(call(base, "GET", "/api/me", headers={"Cookie": f"{COOKIE}={cookie}"}), 200)["imager_id"] == body["imager_id"]
    r = call(base, "POST", "/api/lock-workspace", headers={"Cookie": f"{COOKIE}={cookie}"})
    assert r.status_code == 204 and f"{COOKIE}=" in r.headers.get("set-cookie", ""), r.text
    for bad in ({"name": "", "site": site}, {"name": name, "site": {**site, "latitude": 91}},
                {"name": name, "site": {**site, "time_zone": "Not/AZone"}},
                {"name": name, "site": {**site, "elevation_m": 9001}}):
        e = err(call(base, "POST", "/api/workspaces", None, bad), 422, "validation")
        assert isinstance(e["error"].get("fields"), dict) and e["error"]["fields"]


def test_unlock_screen_redirect_and_wrong_key(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    with open_app(browser, base + "/") as page:
        eventually(page, lambda: urlparse(page.url).path == "/unlock", lambda: f"/ went to {page.url}")
        fill(page.get_by_role("textbox", name="Workspace key", exact=True), "dfk_" + "0" * 32)
        click(page.get_by_role("button", name="Unlock", exact=True))
        see(page, page.get_by_role("alert", name="Error summary"), WRONG_KEY, "wrong key")
        fill(page.get_by_role("textbox", name="Workspace key", exact=True), ws["key"])
        click(page.get_by_role("button", name="Unlock", exact=True))
        eventually(page, lambda: urlparse(page.url).path == "/plan", lambda: f"after unlock at {page.url}")
        cookies = {c["name"]: c for c in page.context.cookies()}
        assert cookies["darkframe_key"]["httpOnly"] is True
        click(page.get_by_role("button", name="Lock workspace", exact=True))
        page.goto(base + "/")
        eventually(page, lambda: urlparse(page.url).path == "/unlock", lambda: f"after lock at {page.url}")


def test_owner_only_ids(app_url):
    base = base_of(app_url)
    a = workspace(base)
    b = workspace(base)
    ka, kb = a["key"], b["key"]
    pa = project(base, ka, name="Owner " + a["name"])
    sa = logged_session(base, ka, pa["id"], notes="private")
    ba = sa["batches"][0]["id"]
    fr = ok(put_frame(base, ka, ba, "light_001.png", png_bytes()), 201)["frame"]
    seta = ready_set(base, ka, "dark", today=site_today(base, ka, a["tz"]))
    ok(call(base, "POST", f"/api/projects/{pa['id']}/share", ka, {"expires_at": None}), 201)
    d = tonight(base, kb)["date"]
    pb = project(base, kb)
    sb = new_session(base, kb, pb["id"])
    start(base, kb, sb["id"])
    bb = add_batch(base, kb, sb["id"])["batch"]["id"]
    junk = "x" + hashlib.sha1(b"unknown").hexdigest()
    attempts = [
        ("GET", f"/api/projects/{pa['id']}", None), ("PATCH", f"/api/projects/{pa['id']}", {"name": ""}),
        ("POST", f"/api/projects/{pa['id']}/transition", {"to": "nonsense"}),
        ("PUT", f"/api/projects/{pa['id']}/allotments/Ha", {"planned_seconds": 7}),
        ("GET", f"/api/projects/{pa['id']}/ledger", None),
        ("POST", f"/api/plans/{d}/targets", {"project_id": pa["id"]}),
        ("DELETE", f"/api/plans/{d}/targets/{pa['id']}", None),
        ("POST", "/api/sessions", {"project_id": pa["id"], "observing_date": d, "notes": ""}),
        ("GET", f"/api/sessions/{sa['id']}", None), ("POST", f"/api/sessions/{sa['id']}/start", {}),
        ("POST", f"/api/sessions/{sa['id']}/log", {}), ("POST", f"/api/sessions/{sa['id']}/amend", {"batches": []}),
        ("POST", f"/api/sessions/{sa['id']}/trash", None), ("POST", f"/api/sessions/{sa['id']}/restore", None),
        ("POST", f"/api/sessions/{sa['id']}/lock", {}), ("PATCH", f"/api/sessions/{sa['id']}/notes", {"notes": "x", "lock_token": "x"}),
        ("GET", f"/api/frames/{fr['id']}/content", None),
        ("GET", f"/api/batches/{ba}/calibration-candidates", None),
        ("POST", f"/api/batches/{ba}/calibration", {"calibration_set_id": seta["id"]}),
        ("POST", f"/api/batches/{bb}/calibration", {"calibration_set_id": seta["id"]}),
        ("DELETE", f"/api/batches/{ba}/calibration/dark", None),
        ("GET", f"/api/calibration-sets/{seta['id']}", None),
        ("PATCH", f"/api/calibration-sets/{seta['id']}", {"gain": -1}),
        ("POST", f"/api/calibration-sets/{seta['id']}/transition", {"to": "retired"}),
        ("GET", f"/api/calibration-sets/{seta['id']}/versions", None),
        ("POST", f"/api/calibration-sets/{seta['id']}/restore", {"version": 1}),
        ("GET", f"/api/calibration-sets/{seta['id']}/master", None),
        ("POST", f"/api/projects/{pa['id']}/share", {"expires_at": None}),
        ("GET", f"/api/projects/{pa['id']}/share", None), ("DELETE", f"/api/projects/{pa['id']}/share", None),
        ("GET", f"/api/projects/{junk}", None), ("GET", f"/api/sessions/{junk}", None),
    ]
    for method, path, body in attempts:
        r = call(base, method, path, kb, body)
        assert r.status_code == 404, f"{method} {path} with another imager's id answered {r.status_code}: {r.text[:300]}"
        assert r.json()["error"]["code"] == "not_found"
    r = call(base, "POST", f"/api/sessions/{sa['id']}/batches", kb, BATCH, headers={"Idempotency-Key": idempotency_key()})
    assert r.status_code == 404, r.text
    r = put_frame(base, kb, ba, "steal.png", png_bytes())
    assert r.status_code == 404, r.text
    r = put_master(base, kb, seta["id"], "x.fits", b"x")
    assert r.status_code == 404, r.text
    assert all(p["id"] != pa["id"] for p in ok(call(base, "GET", "/api/projects", kb), 200)["projects"])
    assert all(s["id"] != sa["id"] for s in ok(call(base, "GET", "/api/sessions?include_trashed=true", kb), 200)["sessions"])
    after = get_project(base, ka, pa["id"])
    assert after["name"] == pa["name"] and after["state"] == "active"
    assert get_session(base, ka, sa["id"])["state"] == "logged"
    assert call(base, "GET", f"/api/frames/{fr['id']}/content", ka).status_code == 200


def test_site_and_horizon_validation(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    lat, lon, elev, tz = SITE_TOMASZ
    good = {"label": "Rooftop", "latitude": lat, "longitude": lon, "elevation_m": elev, "time_zone": tz,
            "min_altitude_deg": 20, "push_topic": "darkframe-tomasz-91af"}
    assert ok(call(base, "PATCH", "/api/site", key, good), 200) == {**good}
    assert ok(call(base, "GET", "/api/site", key), 200) == good
    bad_site = [("min_altitude_deg", MIN_ALT_MAX + 1), ("min_altitude_deg", 2.5), ("min_altitude_deg", -1),
                ("push_topic", "has space"), ("push_topic", "x" * 65), ("push_topic", ""),
                ("latitude", 90.5), ("longitude", -180.5), ("elevation_m", -501), ("label", ""),
                ("label", "x" * (NAME_MAX + 1)), ("time_zone", "Mars/Olympus")]
    for field, value in bad_site:
        e = err(call(base, "PATCH", "/api/site", key, {field: value}), 422, "validation")
        assert field in e["error"]["fields"], f"PATCH site {field}={value!r}: {e}"
    assert ok(call(base, "GET", "/api/site", key), 200) == good
    ok(call(base, "PATCH", "/api/site", key, {"push_topic": None}), 200)
    assert ok(call(base, "GET", "/api/site", key), 200)["push_topic"] is None
    mask = [(i * 7) % (MASK_MAX + 1) for i in range(BINS)]
    assert ok(call(base, "PUT", "/api/site/horizon", key, {"altitudes": mask}), 200) == {"altitudes": mask}
    for bad in ([10] * (BINS - 1), [10] * (BINS + 1), [10] * (BINS - 1) + [MASK_MAX + 1],
                [10] * (BINS - 1) + [-1], [10] * (BINS - 1) + [1.5]):
        e = err(call(base, "PUT", "/api/site/horizon", key, {"altitudes": bad}), 422, "validation")
        assert "altitudes" in e["error"]["fields"]
    assert ok(call(base, "GET", "/api/site/horizon", key), 200) == {"altitudes": mask}


def test_horizon_painter_keyboard_and_drag(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base, mask=10)
    key = ws["key"]
    with unlocked(browser, base, key, "/site") as page:
        painter = page.get_by_role("img", name=re.compile(r"^Horizon painter: azimuth"))
        eventually(page, lambda: PAINTER_RE.search(acc_name(painter)) is not None,
                   lambda: f"painter name {acc_name(painter)!r}")
        ready(painter).focus()
        az0 = int(PAINTER_RE.search(acc_name(painter)).group(1))
        page.keyboard.press("ArrowRight")
        az1 = (az0 + BIN_WIDTH) % 360
        eventually(page, lambda: int(PAINTER_RE.search(acc_name(painter)).group(1)) == az1,
                   lambda: f"ArrowRight: {acc_name(painter)!r}")
        for _ in range(3):
            page.keyboard.press("ArrowUp")
        page.keyboard.press("Shift+ArrowUp")
        page.keyboard.press("ArrowDown")
        want = 10 + 3 + STEP_SMALL - 1
        eventually(page, lambda: acc_name(painter) == f"Horizon painter: azimuth {az1} degrees, mask altitude {want} degrees",
                   lambda: f"painter after keys: {acc_name(painter)!r}")
        updates = page.get_by_role("status", name="Site updates", exact=True)
        see(page, updates, "Horizon saved.", "Site updates after key pause")
        alts = ok(call(base, "GET", "/api/site/horizon", key), 200)["altitudes"]
        assert alts[az1 // BIN_WIDTH] == want and alts.count(10) == BINS - 1, alts
        for _ in range(20):
            page.keyboard.press("Shift+ArrowUp")
        eventually(page, lambda: acc_name(painter).endswith(f"mask altitude {MASK_MAX} degrees"),
                   lambda: f"clamp at 90: {acc_name(painter)!r}")
        poll(lambda: ok(call(base, "GET", "/api/site/horizon", key), 200)["altitudes"][az1 // BIN_WIDTH],
             lambda v: (advance(page, STEP_MS) or True) and v == MASK_MAX, lambda v: f"saved bin {v}, expected 90")
        ok(call(base, "PUT", "/api/site/horizon", key, {"altitudes": [0] * BINS}), 200)
        page.reload()
        b = box(painter)
        y = b["y"] + b["height"] / 2
        page.mouse.move(b["x"] + b["width"] * 0.10, y)
        page.mouse.down()
        page.mouse.move(b["x"] + b["width"] * 0.30, y, steps=30)
        page.mouse.up()
        see(page, updates, "Horizon saved.", "Site updates after drag")
        alts = poll(lambda: ok(call(base, "GET", "/api/site/horizon", key), 200)["altitudes"],
                    lambda a: (advance(page, STEP_MS) or True) and any(a), lambda a: f"drag saved nothing: {a}")
        crossed = alts[int(BINS * 0.13):int(BINS * 0.27)]
        assert crossed and len(set(crossed)) == 1 and 0 < crossed[0] <= MASK_MAX, alts
        assert all(v == 0 for v in alts[BINS // 2:]), f"bins far from the drag changed: {alts}"
        word = VERDICT_WORDS[tonight(base, key)["verdict"]]
        see(page, card(page), word, "Site screen verdict card")


def test_wf_site_setup_happy(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base, mask=10)
    key = ws["key"]
    lat, lon, elev, tz = SITE_TOMASZ
    with unlocked(browser, base, key, "/site") as page:
        fill(page.get_by_role("textbox", name="Site label", exact=True), "Rooftop")
        fill(page.get_by_role("textbox", name="Latitude", exact=True), str(lat))
        fill(page.get_by_role("textbox", name="Longitude", exact=True), str(lon))
        fill(page.get_by_role("textbox", name="Elevation (m)", exact=True), str(elev))
        select(page.get_by_role("combobox", name="Time zone", exact=True), tz)
        tp = topic()
        fill(page.get_by_role("textbox", name="Push topic", exact=True), tp)
        click(page.get_by_role("button", name="Save site", exact=True))
        updates = page.get_by_role("status", name="Site updates", exact=True)
        see(page, updates, "Site saved.", "Site updates")
        s = ok(call(base, "GET", "/api/site", key), 200)
        assert (s["label"], s["latitude"], s["longitude"], s["elevation_m"], s["time_zone"], s["push_topic"]) == \
            ("Rooftop", lat, lon, elev, tz, tp), s
        painter = page.get_by_role("img", name=re.compile(r"^Horizon painter: azimuth"))
        ready(painter).focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Shift+ArrowUp")
        eventually(page, lambda: PAINTER_RE.search(acc_name(painter)) and
                   int(PAINTER_RE.search(acc_name(painter)).group(2)) == 10 + STEP_SMALL,
                   lambda: f"painter {acc_name(painter)!r}")
        az = int(PAINTER_RE.search(acc_name(painter)).group(1))
        see(page, updates, "Horizon saved.", "horizon save")
        alts = ok(call(base, "GET", "/api/site/horizon", key), 200)["altitudes"]
        assert alts[az // BIN_WIDTH] == 10 + STEP_SMALL
        page.reload()
        painter = page.get_by_role("img", name=re.compile(r"^Horizon painter: azimuth"))
        ready(painter).focus()
        for _ in range((az - int(PAINTER_RE.search(acc_name(painter)).group(1))) // BIN_WIDTH % BINS):
            page.keyboard.press("ArrowRight")
        eventually(page, lambda: acc_name(painter) == f"Horizon painter: azimuth {az} degrees, mask altitude {10 + STEP_SMALL} degrees",
                   lambda: f"after reload: {acc_name(painter)!r}")
        see(page, card(page), VERDICT_WORDS[tonight(base, key)["verdict"]], "verdict card after reload")


def test_wf_site_setup_invalid_recovery(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    with unlocked(browser, base, key, "/site") as page:
        lat_box = page.get_by_role("textbox", name="Latitude", exact=True)
        fill(lat_box, "95")
        click(page.get_by_role("button", name="Save site", exact=True))
        alert = page.get_by_role("alert", name="Error summary")
        see(page, alert, CHECK_FIELDS, "error summary")
        click(alert.get_by_role("link").first)
        eventually(page, lambda: focused(lat_box), lambda: "error link did not focus Latitude")
        assert ok(call(base, "GET", "/api/site", key), 200)["latitude"] == ws["lat"]
        fill(lat_box, str(SITE_TOMASZ[0]))
        click(page.get_by_role("button", name="Save site", exact=True))
        see(page, page.get_by_role("status", name="Site updates", exact=True), "Site saved.", "after fix")
        assert ok(call(base, "GET", "/api/site", key), 200)["latitude"] == SITE_TOMASZ[0]


def test_ephemeris_matches_reference(app_url):
    base = base_of(app_url)
    for site in (SITE_INES, SITE_TOMASZ):
        lat, lon, _, tz = site
        ws = workspace(base, site=site)
        key = ws["key"]
        p = project(base, key, ra=10.6847, dec=41.2690, allot={"L": 21600})
        d = (date.fromisoformat(tonight(base, key)["date"]) + timedelta(days=3)).isoformat()
        n = ok(call(base, "GET", f"/api/sky/night?date={d}", key), 200)
        rdusk, rdawn = ref_dusk_dawn(date.fromisoformat(d), lat, lon, tz)
        assert n["has_astronomical_night"] is True
        dusk, dawn = at(n["dusk"]), at(n["dawn"])
        assert abs((dusk - rdusk).total_seconds()) / 60 <= DUSK_TOL_MIN, (n["dusk"], rdusk)
        assert abs((dawn - rdawn).total_seconds()) / 60 <= DUSK_TOL_MIN, (n["dawn"], rdawn)
        assert dusk.utcoffset() == dusk.astimezone(ZoneInfo(tz)).utcoffset()
        assert n["minutes"] == int((dawn - dusk).total_seconds() // 60)
        assert at(n["narrowband_start"]) == dusk - timedelta(minutes=LEADING)
        assert at(n["narrowband_end"]) == dawn + timedelta(minutes=LEADING)
        assert abs(n["moon_illumination"] - illumination(dusk)) <= ILLUM_TOL
        add_target(base, key, d, p["id"])
        for m in (0, n["minutes"] // 2, n["minutes"]):
            pl = plan(base, key, d, m)
            t = dusk + timedelta(minutes=m)
            j = jd(t)
            assert pl["minute"] == m and pl["time_local"] == t.astimezone(ZoneInfo(tz)).strftime("%H:%M")
            salt, saz = altaz(*sun_radec(j), j, lat, lon)
            assert abs(pl["sun"]["altitude_deg"] - salt) <= SUN_TOL, (pl["sun"], salt)
            assert angdiff(pl["sun"]["azimuth_deg"], saz) <= SUN_TOL, (pl["sun"], saz)
            assert angdiff(pl["local_sidereal_time_deg"], gmst_deg(j) + lon) <= SUN_TOL
            malt, maz = moon_topo(t, lat, lon)
            assert abs(pl["moon"]["altitude_deg"] - malt) <= MOON_TOL, (pl["moon"], malt)
            assert angdiff(pl["moon"]["azimuth_deg"], maz) <= MOON_TOL / max(cos(radians(malt)), 0.2)
            assert abs(pl["moon"]["illumination"] - illumination(t)) <= ILLUM_TOL
            tra, tdec = precess(10.6847, 41.2690, j)
            talt, taz = altaz(tra, tdec, j, lat, lon)
            tg = pl["targets"][0]
            assert abs(tg["altitude_deg"] - talt) <= SUN_TOL, (tg["altitude_deg"], talt)
            assert angdiff(tg["azimuth_deg"], taz) <= SUN_TOL / max(cos(radians(talt)), 0.2)
            assert abs(tg["moon_separation_deg"] - sep(talt, taz, malt, maz)) <= MOON_TOL
            for v in (tg["altitude_deg"], pl["sun"]["altitude_deg"], pl["moon"]["azimuth_deg"]):
                assert round(v, 1) == v
        arc = [a["minute"] for a in pl["targets"][0]["arc"]]
        want = list(range(0, n["minutes"] + 1, STEP_SMALL))
        if want[-1] != n["minutes"]:
            want.append(n["minutes"])
        assert arc == want
        for bad in (-1, n["minutes"] + 1):
            e = err(call(base, "GET", f"/api/plans/{d}?minute={bad}", key), 422, "validation")
            assert "minute" in e["error"]["fields"]
        for bad_date in ("2026-02-30", "2026-1-05", "tomorrow"):
            e = err(call(base, "GET", f"/api/sky/night?date={bad_date}", key), 422, "validation")
            assert "date" in e["error"]["fields"]


def test_no_astronomical_night(app_url):
    base = base_of(app_url)
    ws = workspace(base, site=(60.0, 10.0, 100, "Europe/Oslo"))
    key = ws["key"]
    year = date.fromisoformat(tonight(base, key)["date"]).year
    d = f"{year + 1}-06-21"
    n = ok(call(base, "GET", f"/api/sky/night?date={d}", key), 200)
    assert n["has_astronomical_night"] is False and n["minutes"] == 0
    assert n["dusk"] is None and n["dawn"] is None and n["narrowband_start"] is None and n["narrowband_end"] is None
    p = project(base, key, allot={"L": 21600, "Ha": HA_PLANNED})
    pl = add_target(base, key, d, p["id"])
    assert pl["time_local"] == "00:00" and pl["minute"] == 0
    assert pl["verdict"] == "no-go" and pl["verdict_reason"] == "no-astronomical-night"
    assert all(f["usable_minutes"] == 0 for f in pl["targets"][0]["filters"])
    err(call(base, "GET", f"/api/plans/{d}?minute=1", key), 422, "validation")


def test_plan_targets_conflicts(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    d, _ = dark_night(base, key)
    projects = [project(base, key) for _ in range(PLAN_MAX + 1)]
    draft = project(base, key, active=False)
    for i, p in enumerate(projects[:PLAN_MAX - 1]):
        body = add_target(base, key, d, p["id"])
        assert body["minute"] == 0 and len(body["targets"]) == i + 1
        assert body["targets"][-1]["project_id"] == p["id"] and body["targets"][-1]["target_name"] == p["target_name"]
    err(call(base, "POST", f"/api/plans/{d}/targets", key, {"project_id": projects[0]["id"]}), 409, "already_planned")
    err(call(base, "POST", f"/api/plans/{d}/targets", key, {"project_id": draft["id"]}), 409, "project_not_active")
    add_target(base, key, d, projects[PLAN_MAX - 1]["id"])
    err(call(base, "POST", f"/api/plans/{d}/targets", key, {"project_id": projects[-1]["id"]}), 409, "plan_full")
    err(call(base, "POST", f"/api/plans/{d}/targets", key, {"project_id": "nope"}), 404, "not_found")
    body = ok(call(base, "DELETE", f"/api/plans/{d}/targets/{projects[0]['id']}", key), 200)
    assert body["minute"] == 0 and projects[0]["id"] not in [t["project_id"] for t in body["targets"]]
    assert len(plan(base, key, d)["targets"]) == PLAN_MAX - 1
    err(call(base, "DELETE", f"/api/plans/{d}/targets/{projects[0]['id']}", key), 404, "not_found")
    add_target(base, key, d, projects[-1]["id"])
    e = err(call(base, "POST", "/api/plans/2026-13-01/targets", key, {"project_id": projects[1]["id"]}), 422, "validation")
    assert "date" in e["error"]["fields"]


def test_usable_minutes_and_verdict(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    d, n = dark_night(base, key)
    minutes = n["minutes"]
    p = project(base, key, allot={"L": L_PLANNED, "Ha": HA_PLANNED})
    pl = plan(base, key, d)
    assert (pl["verdict"], pl["verdict_reason"]) == ("unknown", "no-conditions")
    put_conditions(base, key, d, lambda i, h: CLEAR)
    pl = plan(base, key, d)
    assert (pl["verdict"], pl["verdict_reason"], pl["best"]) == ("no-go", "no-targets", None)
    pl = add_target(base, key, d, p["id"])
    t = pl["targets"][0]
    f = {x["filter"]: x for x in t["filters"]}
    assert t["counts"] is True and t["position_status"] == "clear" and t["clear_minutes"] == minutes
    assert f["L"]["usable_minutes"] == minutes and f["Ha"]["usable_minutes"] == minutes + 2 * LEADING
    assert f["L"]["owed_seconds"] == L_PLANNED and f["Ha"]["owed_seconds"] == HA_PLANNED
    assert f["L"]["owed_after_tonight_seconds"] == max(0, L_PLANNED - 60 * minutes)
    assert f["Ha"]["owed_after_tonight_seconds"] == max(0, HA_PLANNED - 60 * (minutes + 2 * LEADING))
    assert (pl["verdict"], pl["verdict_reason"]) == ("go", "go")
    assert pl["best"]["filter"] == "Ha" and pl["best"]["project_id"] == p["id"] and pl["best"]["usable_minutes"] == minutes + 2 * LEADING
    cw = pl["clear_window"]
    assert (cw["start_minute"], cw["end_minute"], cw["starts_in_minutes"]) == (-LEADING, minutes + LEADING, None)
    assert at(cw["start"]) == at(n["dusk"]) - timedelta(minutes=LEADING)
    assert at(cw["end"]) == at(n["dawn"]) + timedelta(minutes=LEADING)
    assert pl["is_tonight"] is False and pl["total_integration_seconds"] == 0
    pm = plan(base, key, d, GO_MINUTES)
    fm = {x["filter"]: x for x in pm["targets"][0]["filters"]}
    assert fm["L"]["usable_minutes"] == minutes - GO_MINUTES
    assert fm["Ha"]["usable_minutes"] == minutes + LEADING - GO_MINUTES
    assert pm["targets"][0]["clear_minutes"] == minutes - GO_MINUTES and pm["clear_window"]["start_minute"] == GO_MINUTES
    rule = lambda i, h: [CLEAR, THIN, CLEAR, HAZY][i % 4]
    entries = put_conditions(base, key, d, rule)["conditions"]["hours"]
    for m in (0, GO_MINUTES):
        pa = plan(base, key, d, m)
        fa = {x["filter"]: x for x in pa["targets"][0]["filters"]}
        exp = {flt: expected_usable(pa, flt, m, entries) for flt in ("L", "Ha")}
        for flt in ("L", "Ha"):
            assert fa[flt]["usable_minutes"] == exp[flt][0], (m, flt, fa[flt], exp[flt])
        bestf = max(("L", "Ha"), key=lambda x: (exp[x][0], -FILTER_ORDER.index(x)))
        assert pa["best"]["filter"] == bestf and pa["best"]["usable_minutes"] == exp[bestf][0]
        run = exp[bestf][1]
        assert (pa["clear_window"]["start_minute"], pa["clear_window"]["end_minute"]) == run
        assert pa["verdict"] == ("go" if exp[bestf][0] >= GO_MINUTES else "no-go")
    put_conditions(base, key, d, lambda i, h: CLOUDY)
    pc = plan(base, key, d)
    assert (pc["verdict"], pc["verdict_reason"], pc["clear_window"]) == ("no-go", "under-60-minutes", None)
    assert all(x["usable_minutes"] == 0 for x in pc["targets"][0]["filters"])
    put_conditions(base, key, d, lambda i, h: CLEAR)
    ok(call(base, "PUT", "/api/site/horizon", key, {"altitudes": [MASK_MAX] * BINS}), 200)
    pb = plan(base, key, d)
    assert pb["targets"][0]["position_status"] == "behind-treeline" and pb["targets"][0]["clear_minutes"] == 0
    assert pb["verdict"] == "no-go" and all(x["usable_minutes"] == 0 for x in pb["targets"][0]["filters"])
    ok(call(base, "PUT", "/api/site/horizon", key, {"altitudes": [0] * BINS}), 200)
    ok(call(base, "PATCH", "/api/site", key, {"min_altitude_deg": MIN_ALT_MAX}), 200)
    assert plan(base, key, d)["targets"][0]["position_status"] == "below-minimum"
    ok(call(base, "PATCH", "/api/site", key, {"min_altitude_deg": 0}), 200)
    south = project(base, key, dec=SOUTH_DEC, allot={"L": L_PLANNED})
    ps = add_target(base, key, d, south["id"])
    st = {x["project_id"]: x for x in ps["targets"]}[south["id"]]
    assert st["position_status"] == "below-horizon" and st["clear_minutes"] == 0
    ok(call(base, "POST", f"/api/projects/{p['id']}/transition", key, {"to": "paused"}), 200)
    pp = plan(base, key, d)
    tp = {x["project_id"]: x for x in pp["targets"]}
    assert tp[p["id"]]["counts"] is False and tp[south["id"]]["counts"] is True
    assert pp["best"]["project_id"] == south["id"] and pp["verdict"] == "no-go"


def test_plan_screen_server_tonight_wrong_clock(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base, site=(10.0, 0.0, 0, "UTC"))
    key = ws["key"]
    with unlocked(browser, base, key, "/plan") as page:
        page.clock.set_system_time(WRONG_CLOCK)
        before = tonight(base, key)
        page.reload()
        h1 = page.get_by_role("heading", level=1)
        see(page, h1, long_date(before["date"]), "Plan headline")
        after = tonight(base, key)
        eventually(page, lambda: before["minute"] <= sval(page) <= after["minute"] + 1,
                   lambda: f"slider {sval(page)} not the server minute {before['minute']}..{after['minute']}")
        assert int(slider(page).evaluate("e => e.getAttribute('aria-valuemax') ?? e.max")) == before["night"]["minutes"]
        see_all(page, card(page), [VERDICT_WORDS[after["verdict"]], f"Moon {round(after['moon']['illumination'] * 100)}% lit",
                                   countdown(after)], "verdict card from /api/tonight")


def test_no_conditions_banner(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base, conditions=False)
    assert plan(base, key, d)["verdict"] == "unknown"
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        notice = page.get_by_role("region", name="Conditions notice", exact=True)
        see(page, notice, NO_CONDITIONS, "Conditions notice")
        see(page, card(page), "Unknown", "verdict card")
        put_conditions(base, key, d, lambda i, h: CLEAR)
        page.reload()
        see(page, card(page), "Go", "verdict card after conditions")
        assert NO_CONDITIONS not in text(notice)


def test_wf_tonight_plan_happy(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    d, n = dark_night(base, key)
    p1 = project(base, key, allot={"L": L_PLANNED, "Ha": HA_PLANNED})
    p2 = project(base, key, ra=10.6847, dec=41.2690, allot={"L": 21600})
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        updates = page.get_by_role("status", name="Plan updates", exact=True)
        for p in (p1, p2):
            click(page.get_by_role("button", name="Add target", exact=True))
            dlg = page.get_by_role("dialog", name="Add target to plan", exact=True)
            click(dlg.get_by_role("listbox", name="Active projects").get_by_role(
                "option", name=f"{p['target_name']} ({p['name']})", exact=True))
            click(dlg.get_by_role("button", name="Add to plan", exact=True))
            see(page, updates, f"{p['target_name']} added.", "add target announcement")
        assert [t["project_id"] for t in plan(base, key, d)["targets"]] == [p1["id"], p2["id"]]
        see(page, card(page), "Unknown", "card before conditions")
        click(page.get_by_role("button", name="Enter sky conditions", exact=True))
        dlg = page.get_by_role("dialog", name="Sky conditions", exact=True)
        hours = plan(base, key, d)["hours"]
        for h in hours:
            lbl = hhmm(h)
            fill(dlg.get_by_role("spinbutton", name=f"Cloud {lbl}", exact=True), "10")
            fill(dlg.get_by_role("spinbutton", name=f"Transparency {lbl}", exact=True), "4")
            fill(dlg.get_by_role("spinbutton", name=f"Seeing {lbl}", exact=True), "3")
        click(dlg.get_by_role("button", name="Save conditions", exact=True))
        see(page, updates, f"Conditions saved for {len(hours)} hours.", "conditions saved")
        api = plan(base, key, d, sval(page))
        assert len(api["conditions"]["hours"]) == len(hours) and api["conditions"]["entered_at"]
        see_all(page, card(page), card_lines(api), "verdict card after conditions")
        assert api["verdict"] == "go" and api["best"]["project_id"] == p1["id"]
        assert urlparse(page.url).path == "/plan"


def test_wf_tonight_plan_invalid_conditions(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base, conditions=False)
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        click(page.get_by_role("button", name="Enter sky conditions", exact=True))
        dlg = page.get_by_role("dialog", name="Sky conditions", exact=True)
        first = hhmm(plan(base, key, d)["hours"][0])
        cloud = dlg.get_by_role("spinbutton", name=f"Cloud {first}", exact=True)
        fill(cloud, "101")
        fill(dlg.get_by_role("spinbutton", name=f"Transparency {first}", exact=True), "4")
        fill(dlg.get_by_role("spinbutton", name=f"Seeing {first}", exact=True), "3")
        click(dlg.get_by_role("button", name="Save conditions", exact=True))
        alert = page.get_by_role("alert", name="Error summary")
        see(page, alert, CHECK_FIELDS, "error summary")
        click(alert.get_by_role("link").first)
        eventually(page, lambda: focused(cloud), lambda: "error link did not focus the cloud field")
        assert plan(base, key, d)["conditions"]["entered_at"] is None


def test_night_handle_keyboard_steps(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base)
    minutes = n["minutes"]
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        s = slider(page)
        eventually(page, lambda: int(s.evaluate("e => e.getAttribute('aria-valuemax') ?? e.max")) == minutes,
                   lambda: "slider max is not the night's minutes")
        assert int(float(s.evaluate("e => e.getAttribute('aria-valuemin') ?? e.min"))) == 0
        ready(s).focus()
        steps = [("Home", 0), ("ArrowRight", 5), ("ArrowUp", 10), ("Shift+ArrowRight", 40), ("PageUp", 70),
                 ("ArrowLeft", 65), ("ArrowDown", 60), ("Shift+ArrowDown", 30), ("Shift+ArrowUp", 60),
                 ("Shift+ArrowLeft", 30), ("PageDown", 0), ("ArrowLeft", 0), ("End", minutes), ("ArrowRight", minutes)]
        pl0 = plan(base, key, d)
        for k, m in steps:
            page.keyboard.press(k)
            want_slider(page, m, f"after {k}")
            assert stext(page) == f"{local_at(pl0, m)} site time, minute {m}", stext(page)
        click(page.get_by_role("button", name="Later 30 minutes", exact=True))
        want_slider(page, minutes, "Later 30 at dawn")
        click(page.get_by_role("button", name="Earlier 30 minutes", exact=True))
        want_slider(page, minutes - STEP_LARGE, "Earlier 30")
        click(page.get_by_role("button", name="Later 30 minutes", exact=True))
        want_slider(page, minutes, "Later 30")
        ready(s).focus()
        page.keyboard.press("Home")
        want_slider(page, 0, "Home before drag")
        x, y = center(s)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 150, y, steps=15)
        page.mouse.up()
        eventually(page, lambda: 0 < sval(page) <= minutes and sval(page) % STEP_SMALL == 0,
                   lambda: f"drag release value {sval(page)} is not a positive multiple of 5")
        m = sval(page)
        assert stext(page) == f"{local_at(pl0, m)} site time, minute {m}"


def test_figures_recompute_in_place(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base)
    minutes = n["minutes"]
    other = project(base, key, ra=10.6847, dec=41.2690, allot={"L": 21600})
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        url = page.url
        updates = page.get_by_role("status", name="Plan updates", exact=True)
        targets = page.get_by_role("list", name="Plan targets", exact=True)
        see_all(page, card(page), card_lines(plan(base, key, d, 0)), "initial card")
        ready(slider(page)).focus()
        page.keyboard.press("End")
        end = plan(base, key, d, minutes)
        assert end["verdict"] == "no-go"
        see(page, updates, plan_update(end), "announcement at dawn")
        see_all(page, card(page), card_lines(end), "card at dawn")
        item = targets.get_by_role("listitem").filter(has_text=p["target_name"])
        see(page, item, STATUS_TEXT[end["targets"][0]["position_status"]], "target status at dawn")
        page.keyboard.press("Home")
        start0 = plan(base, key, d, 0)
        see(page, updates, plan_update(start0), "announcement at dusk")
        spin = page.get_by_role("spinbutton", name="Minimum altitude", exact=True)
        fill(spin, str(MIN_ALT_MAX))
        spin.press("Tab")
        eventually(page, lambda: ok(call(base, "GET", "/api/site", key), 200)["min_altitude_deg"] == MIN_ALT_MAX,
                   lambda: "minimum altitude was not saved without a submit button")
        high = plan(base, key, d, 0)
        see(page, updates, plan_update(high), "announcement after minimum altitude")
        see(page, item, STATUS_TEXT["below-minimum"], "status after minimum altitude")
        fill(spin, "0")
        spin.press("Tab")
        eventually(page, lambda: ok(call(base, "GET", "/api/site", key), 200)["min_altitude_deg"] == 0,
                   lambda: "minimum altitude reset not saved")
        click(page.get_by_role("button", name="Add target", exact=True))
        dlg = page.get_by_role("dialog", name="Add target to plan", exact=True)
        click(dlg.get_by_role("option", name=f"{other['target_name']} ({other['name']})", exact=True))
        click(dlg.get_by_role("button", name="Add to plan", exact=True))
        added = plan(base, key, d, 0)
        see(page, updates, plan_update(added, f"{other['target_name']} added. "), "added announcement")
        see_all(page, card(page), card_lines(added), "card after add")
        click(page.get_by_role("button", name=f"Remove {other['target_name']}", exact=True))
        removed = plan(base, key, d, 0)
        see(page, updates, plan_update(removed, f"{other['target_name']} removed. "), "removed announcement")
        assert [t["project_id"] for t in removed["targets"]] == [p["id"]]
        assert page.url == url


def test_sky_chart_lens_readout(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base, mask=MASK_MAX, min_alt=25)
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        chart = page.get_by_role("img", name="Sky chart", exact=True)
        readout = page.get_by_role("status", name="Lens readout", exact=True)
        pl = plan(base, key, d, 0)
        t = pl["targets"][0]
        assert t["position_status"] == "behind-treeline"
        ready(chart).focus()
        see(page, readout, f"{t['target_name']}: altitude {t['altitude_deg']:.1f} degrees, Moon "
                           f"{t['moon_separation_deg']:.1f} degrees away, behind the treeline", "lens readout")
        b = box(chart)
        assert b["width"] >= LENS_PX and b["height"] >= LENS_PX
        page.mouse.move(b["x"] + 2, b["y"] + 2)
        page.mouse.move(b["x"] + 3, b["y"] + 3)
        eventually(page, lambda: text(readout) in (NO_LENS, "") or t["target_name"] in text(readout),
                   lambda: f"lens readout {text(readout)!r}")
        before = decode(capture(chart))
        ok(call(base, "PUT", "/api/site/horizon", key, {"altitudes": [0] * BINS}), 200)
        page.reload()
        chart = page.get_by_role("img", name="Sky chart", exact=True)
        ready(chart).focus()
        t2 = plan(base, key, d, 0)["targets"][0]
        see(page, readout, f"{t2['target_name']}: altitude {t2['altitude_deg']:.1f} degrees", "readout after mask clear")
        assert "behind the treeline" not in text(readout)
        after = decode(capture(chart))
        assert difference(before, after) > 0, "the chart drew the same pixels with and without the treeline"


def test_dome_render_orbit_limits(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base)
    minutes = n["minutes"]
    with unlocked(browser, base, key, f"/plan?date={d}", reduced_motion="reduce") as page:
        dm = dome(page)
        eventually(page, lambda: dome_state(page) is not None, lambda: f"dome name {acc_name(dm)!r}")
        frames = scene_frames(dm, steps=3, step_ms=500)
        assert any(f["draws"] for f in frames), "the dome issued no draw calls"
        assert decode(frames[-1]["png"]).variance() > 0, "the dome capture is blank"
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) == 0, "the idle dome moved"
        dm.focus()
        page.keyboard.press("0")
        e0, a0, z0 = DOME_RESET
        want_dome(page, (e0, a0, z0, 0), "reset")
        page.keyboard.press("ArrowRight")
        want_dome(page, (e0, a0 + 5, z0, 0), "ArrowRight")
        for _ in range(12):
            page.keyboard.press("ArrowUp")
        want_dome(page, (ELEV_MAX, a0 + 5, z0, 0), "elevation clamp high")
        for _ in range(20):
            page.keyboard.press("ArrowDown")
        want_dome(page, (ELEV_MIN, a0 + 5, z0, 0), "elevation clamp low")
        for _ in range(15):
            page.keyboard.press("+")
        want_dome(page, (ELEV_MIN, a0 + 5, ZOOM_MAX, 0), "zoom clamp high")
        for _ in range(20):
            page.keyboard.press("-")
        want_dome(page, (ELEV_MIN, a0 + 5, ZOOM_MIN, 0), "zoom clamp low")
        page.keyboard.press("0")
        for _ in range(a0 // 5 + 1):
            page.keyboard.press("ArrowLeft")
        want_dome(page, (e0, 355, z0, 0), "azimuth wraps below 0")
        page.keyboard.press("0")
        want_dome(page, (e0, a0, z0, 0), "reset again")
        cx, cy = center(dm)
        page.mouse.move(cx, cy)
        page.mouse.wheel(0, -100)
        want_dome(page, (e0, a0, "1.1", 0), "wheel away raises zoom by 0.1")
        page.mouse.dblclick(cx, cy)
        want_dome(page, (e0, a0, z0, 0), "double-click reset")
        before = camera(page)
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + ORBIT_DRAG_PX, cy, steps=10)
        page.mouse.up()
        want_dome(page, (e0, a0 + ORBIT_DRAG_DEG, z0, 0), "drag right 100 px")
        assert camera(page) != before, "the camera matrices did not change after a drag"
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx, cy - ORBIT_DRAG_PX, steps=10)
        page.mouse.up()
        want_dome(page, (e0 + ORBIT_DRAG_DEG, a0 + ORBIT_DRAG_DEG, z0, 0), "drag up 100 px")
        shot = decode(capture(dm))
        ready(slider(page)).focus()
        page.keyboard.press("End")
        advance(page, NAME_SETTLE_MS)
        want_dome(page, (e0 + ORBIT_DRAG_DEG, a0 + ORBIT_DRAG_DEG, z0, minutes), "dome follows the handle")
        assert difference(shot, decode(capture(dm))) > 0, "the dome picture did not follow the handle"


def test_dome_without_webgl(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base)
    with unlocked(browser, base, key, f"/plan?date={d}", no_webgl=True) as page:
        e0, a0, z0 = DOME_RESET
        want_dome(page, (e0, a0, z0, 0), "fallback image name")
        eventually(page, lambda: page.get_by_text(NO_WEBGL, exact=True).is_visible(), lambda: "no unavailable sentence")
        see_all(page, card(page), card_lines(plan(base, key, d, 0)), "fallback card")
        ready(slider(page)).focus()
        page.keyboard.press("PageUp")
        pl = plan(base, key, d, STEP_LARGE)
        see(page, page.get_by_role("status", name="Plan updates", exact=True), plan_update(pl), "fallback announcement")
        want_dome(page, (e0, a0, z0, STEP_LARGE), "fallback name follows the handle")
        see_all(page, card(page), card_lines(pl), "fallback card after step")


def test_reduced_motion_scrub(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base)
    with unlocked(browser, base, key, f"/plan?date={d}", reduced_motion="reduce") as page:
        s = slider(page)
        ready_slider(page, n["minutes"], "reduced motion scrub")
        ready(s).focus()
        page.keyboard.press("PageUp")
        want_slider(page, STEP_LARGE, "reduced motion handle did not jump")
        assert animations(s) == [], f"handle animates under reduced motion: {animations(s)}"
        pl = plan(base, key, d, STEP_LARGE)
        see_all(page, card(page), card_lines(pl), "reduced-motion card")
        assert animations(card(page)) == []
        eventually(page, lambda: (dome_state(page) or (0, 0, 0, -1))[3] == STEP_LARGE, lambda: "dome minute")
        chart = page.get_by_role("img", name="Sky chart", exact=True)
        readout = page.get_by_role("status", name="Lens readout", exact=True)
        initial = text(readout)
        b = box(chart)
        pts = [(b["x"] + b["width"] * fx / 6, b["y"] + b["height"] * fy / 6) for fx in range(1, 6) for fy in range(1, 6)]
        for x, y in pts:
            page.mouse.move(x, y)
            advance(page, 50)
            assert text(readout) == initial, "the lens followed the pointer under reduced motion"
        hit = False
        for x, y in pts:
            page.mouse.click(x, y)
            advance(page, 50)
            if p["target_name"] in text(readout):
                hit = True
                break
        assert hit, "clicking the chart never pinned the lens on the target"
        t = pl["targets"][0]
        assert f"altitude {t['altitude_deg']:.1f} degrees" in text(readout)


def test_phone_bottom_bar_touch(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base)
    with unlocked(browser, base, key, f"/plan?date={d}", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        page.reload()
        s = slider(page)
        earlier = page.get_by_role("button", name="Earlier 30 minutes", exact=True)
        later = page.get_by_role("button", name="Later 30 minutes", exact=True)
        nav = page.get_by_role("navigation", name="Main")
        for loc in (earlier, later):
            b = box(loc)
            assert b["width"] >= TOUCH_MIN and b["height"] >= TOUCH_MIN, b
        bars = [box(x) for x in (s, earlier, later)]
        for b in bars:
            assert b["y"] >= 812 / 2 and b["y"] + b["height"] <= 812 + 1, f"time bar not at the bottom: {b}"
        nb = box(nav)
        assert nb["y"] >= 812 / 2 and nb["y"] + nb["height"] <= min(b["y"] for b in bars) + 1, (nb, bars)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        assert abs(box(s)["y"] - bars[0]["y"]) <= 1, "the time bar scrolled with the page"
        page.evaluate("window.scrollTo(0, 0)")
        tap(later)
        want_slider(page, STEP_LARGE, "tap Later 30")
        x, y = center(s)
        touch_drag(page, (x, y), (x + 80, y))
        eventually(page, lambda: sval(page) != STEP_LARGE and sval(page) % STEP_SMALL == 0,
                   lambda: f"touch drag did not scrub: {sval(page)}")
        dm = dome(page)
        dm.scroll_into_view_if_needed()
        e0, a0, z0 = DOME_RESET
        st = dome_state(page)
        cx, cy = center(dm)
        touch_drag(page, (cx - 50, cy), (cx - 50 + ORBIT_DRAG_PX, cy))
        eventually(page, lambda: dome_state(page)[1] == (st[1] + ORBIT_DRAG_DEG) % 360,
                   lambda: f"touch orbit: {acc_name(dm)!r} from {st}")


def transit_setup(base):
    ws = workspace(base, min_alt=0)
    key = ws["key"]
    d, n = dark_night(base, key)
    p = project(base, key, ra=0.0, dec=TRANSIT_DEC, allot={"L": L_PLANNED})
    add_target(base, key, d, p["id"])
    mid = plan(base, key, d, n["minutes"] // 2)
    ok(call(base, "PATCH", f"/api/projects/{p['id']}", key, {"ra_deg": mid["local_sidereal_time_deg"] % 360}), 200)
    ok(call(base, "PUT", "/api/site/horizon", key, {"altitudes": [0] * (BINS // 2) + [MASK_MAX - 1] * (BINS // 2)}), 200)
    put_conditions(base, key, d, lambda i, h: CLEAR)
    assert plan(base, key, d, 0)["targets"][0]["position_status"] == "clear"
    assert plan(base, key, d, n["minutes"])["targets"][0]["position_status"] == "behind-treeline"
    return ws, key, d, n, get_project(base, key, p["id"])


def test_wf_night_scrub_keyboard(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = transit_setup(base)
    minutes = n["minutes"]
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        chart = page.get_by_role("img", name="Sky chart", exact=True)
        dm = dome(page)
        item = page.get_by_role("list", name="Plan targets", exact=True).get_by_role("listitem").filter(has_text=p["target_name"])
        ready(slider(page)).focus()
        page.keyboard.press("Home")
        want_slider(page, 0, "Home")
        see(page, item, STATUS_TEXT["clear"], "dusk status")
        chart0, dome0 = region_shot(chart), region_shot(dm)
        seen, usable = set(), []
        m = 0
        for _ in range(minutes // STEP_LARGE + 2):
            if m >= minutes:
                break
            page.keyboard.press("PageUp")
            m = min(minutes, m + STEP_LARGE)
            want_slider(page, m, "PageUp scrub")
            pl = plan(base, key, d, m)
            see(page, page.get_by_role("status", name="Plan updates", exact=True), plan_update(pl), f"announcement at {m}")
            seen.add(pl["targets"][0]["position_status"])
            usable.append(best_usable(pl))
            see(page, item, STATUS_TEXT[pl["targets"][0]["position_status"]], f"status at {m}")
            see(page, card(page), f"{best_usable(pl)} usable minutes", f"card at {m}")
        assert m == minutes
        assert "behind-treeline" in seen, seen
        assert all(a >= b for a, b in zip(usable, usable[1:])), f"usable minutes did not count down: {usable}"
        assert difference(chart0, region_shot(chart)) > 0 and difference(dome0, region_shot(dm)) > 0
        last = plan(base, key, d, minutes)
        assert last["targets"][0]["position_status"] == "behind-treeline"
        assert f"At {last['time_local']}:" in text(page.get_by_role("status", name="Plan updates", exact=True))


def test_wf_night_scrub_phone_reduced(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = transit_setup(base)
    minutes = n["minutes"]
    with unlocked(browser, base, key, f"/plan?date={d}", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        page.reload()
        later = page.get_by_role("button", name="Later 30 minutes", exact=True)
        for _ in range(minutes // STEP_LARGE + 1):
            tap(later)
        want_slider(page, minutes, "taps to dawn")
        end = plan(base, key, d, minutes)
        see(page, page.get_by_role("status", name="Plan updates", exact=True), plan_update(end), "dawn announcement")
        see_all(page, card(page), card_lines(end), "dawn card")


def autumn_night(year: int, tz: str) -> str:
    z = ZoneInfo(tz)
    d = date(year, 10, 1)
    for _ in range(62):
        a = datetime.combine(d, dtime(12), tzinfo=z).utcoffset()
        b = datetime.combine(d + timedelta(days=1), dtime(12), tzinfo=z).utcoffset()
        if b < a:
            return d.isoformat()
        d += timedelta(days=1)
    pytest.fail("no autumn clock change found for the site zone")


def test_conditions_store_hours(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    year = date.fromisoformat(tonight(base, key)["date"]).year
    d = autumn_night(year + 1, ws["tz"])
    pl = plan(base, key, d)
    n = pl["night"]
    z = ZoneInfo(ws["tz"])
    first = (at(n["narrowband_start"])).astimezone(timezone.utc).replace(minute=0, second=0)
    last = (at(n["narrowband_end"]) - timedelta(minutes=1)).astimezone(timezone.utc).replace(minute=0, second=0)
    want = []
    t = first
    while t <= last:
        want.append(t)
        t += timedelta(hours=1)
    got = [at(h) for h in pl["hours"]]
    assert got == want, (pl["hours"], want)
    for h in pl["hours"]:
        assert at(h).utcoffset() == at(h).astimezone(z).utcoffset()
    walls = [hhmm(h) for h in pl["hours"]]
    assert len(walls) == len(set(walls)) + 1, f"the repeated local hour should appear twice: {pl['hours']}"
    before = datetime.now(timezone.utc) - timedelta(seconds=HTTP_TIMEOUT)
    entries = [{"hour_start": h, "cloud_pct": i % 101, "transparency": 1 + i % 5, "seeing": 5 - i % 5}
               for i, h in enumerate(pl["hours"])]
    body = ok(call(base, "PUT", f"/api/plans/{d}/conditions", key, {"hours": entries}), 200)
    assert body["minute"] == 0
    stored = plan(base, key, d)["conditions"]
    assert [{k: e[k] for k in ("cloud_pct", "transparency", "seeing")} for e in stored["hours"]] == \
        [{k: e[k] for k in ("cloud_pct", "transparency", "seeing")} for e in entries]
    assert [at(e["hour_start"]) for e in stored["hours"]] == got
    assert stored["entered_at"].endswith("Z") and before <= at(stored["entered_at"]) <= datetime.now(timezone.utc) + timedelta(seconds=HTTP_TIMEOUT)
    assert stored["stale"] is False
    bads = [({"hour_start": (got[0] + timedelta(minutes=30)).isoformat()}, "hour_start"), ({"cloud_pct": 101}, "cloud_pct"),
            ({"transparency": 0}, "transparency"), ({"seeing": 6}, "seeing"), ({"cloud_pct": 2.5}, "cloud_pct")]
    for over, field in bads:
        bad = [dict(e) for e in entries]
        bad[2].update(over)
        e = err(call(base, "PUT", f"/api/plans/{d}/conditions", key, {"hours": bad}), 422, "validation")
        assert any(k.startswith("hours[2]") for k in e["error"]["fields"]), e
    assert plan(base, key, d)["conditions"]["hours"] == stored["hours"]
    ok(call(base, "PUT", f"/api/plans/{d}/conditions", key, {"hours": []}), 200)
    cleared = plan(base, key, d)
    assert cleared["conditions"]["hours"] == [] and cleared["verdict"] == "unknown"


def test_stale_conditions_flag_and_banner(browser):
    base = instance("APP_SHORT_URL")
    ws, key, d, n, p = plan_setup(base)
    fresh = plan(base, key, d)
    assert fresh["conditions"]["stale"] is False and fresh["verdict"] == "go"
    stale = poll(lambda: plan(base, key, d), lambda pl: pl["conditions"]["stale"],
                 lambda pl: f"conditions never turned stale: {pl['conditions']}")
    assert at(stale["server_time"]) - at(stale["conditions"]["entered_at"]) > timedelta(seconds=STALE_SHORT_S)
    assert stale["verdict"] == "go" and best_usable(stale) == best_usable(fresh)
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        see(page, page.get_by_role("region", name="Conditions notice", exact=True), STALE_BANNER, "stale banner")
        see(page, card(page), "Go", "stale conditions still count")


def test_countdown_refresh_keeps_dialog(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base, site=(10.0, 0.0, 0, "UTC"))
    key = ws["key"]
    with unlocked(browser, base, key, "/plan") as page:
        seen = []
        page.on("request", lambda r: seen.append(r.url) if ("/api/plans/" in r.url or "/api/tonight" in r.url) else None)
        t = tonight(base, key)
        see(page, card(page), countdown(t), "countdown from the server")
        s = slider(page)
        ready(s).focus()
        cur = sval(page)
        goal = t["night"]["minutes"] if cur == 0 else 0
        page.keyboard.press("End" if cur == 0 else "Home")
        want_slider(page, goal, "handle move")
        updates = page.get_by_role("status", name="Plan updates", exact=True)
        see(page, updates, "At ", "handle announcement")
        said = text(updates)
        click(page.get_by_role("button", name="Enter sky conditions", exact=True))
        dlg = page.get_by_role("dialog", name="Sky conditions", exact=True)
        cloud = dlg.get_by_role("spinbutton", name=re.compile(r"^Cloud ")).first
        fill(cloud, "42")
        n0 = len(seen)
        advance(page, REFRESH_MS + 1000)
        eventually(page, lambda: len(seen) > n0, lambda: "no plan request repeated within 60 seconds")
        same = re.compile(rf"[?&]minute={goal}(?:&|$)")
        assert any(same.search(u) for u in seen[n0:]), seen[n0:]
        advance(page, 1000)
        assert not gone(dlg), "the refresh closed the open dialog"
        assert cloud.input_value() == "42", "the refresh replaced a typed value"
        assert sval(page) == goal, "the refresh moved the handle"
        assert text(updates) == said, "the refresh replaced the latest announcement"
    with unlocked(browser, base, key, "/sessions") as page:
        seen = []
        page.on("request", lambda r: seen.append(r.url) if "/api/tonight" in r.url else None)
        see(page, card(page), VERDICT_WORDS[tonight(base, key)["verdict"]], "sessions verdict card")
        n0 = len(seen)
        advance(page, REFRESH_MS + 1000)
        eventually(page, lambda: len(seen) > n0, lambda: "Sessions did not re-read /api/tonight within 60 seconds")


def test_wf_sky_conditions_stale_reopen(browser):
    base = instance("APP_SHORT_URL")
    ws, key, d, n, p = plan_setup(base, conditions=False)
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        see(page, card(page), "Unknown", "before conditions")
        click(page.get_by_role("button", name="Enter sky conditions", exact=True))
        dlg = page.get_by_role("dialog", name="Sky conditions", exact=True)
        hours = plan(base, key, d)["hours"]
        for h in hours:
            fill(dlg.get_by_role("spinbutton", name=f"Cloud {hhmm(h)}", exact=True), "0")
            fill(dlg.get_by_role("spinbutton", name=f"Transparency {hhmm(h)}", exact=True), "5")
            fill(dlg.get_by_role("spinbutton", name=f"Seeing {hhmm(h)}", exact=True), "2")
        click(dlg.get_by_role("button", name="Save conditions", exact=True))
        see(page, page.get_by_role("status", name="Plan updates", exact=True), f"Conditions saved for {len(hours)} hours.", "saved")
        see(page, card(page), "Go", "verdict after save")
        poll(lambda: plan(base, key, d), lambda pl: pl["conditions"]["stale"], lambda pl: "conditions never went stale")
        click(page.get_by_role("button", name="Enter sky conditions", exact=True))
        dlg = page.get_by_role("dialog", name="Sky conditions", exact=True)
        cloud = dlg.get_by_role("spinbutton", name=f"Cloud {hhmm(hours[0])}", exact=True)
        fill(cloud, "77")
        advance(page, REFRESH_MS + 1000)
        see(page, page.get_by_role("region", name="Conditions notice", exact=True), STALE_BANNER, "stale banner")
        assert not gone(dlg) and cloud.input_value() == "77"
        assert plan(base, key, d)["conditions"]["stale"] is True


def test_wf_sky_conditions_repeated_hour(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    year = date.fromisoformat(tonight(base, key)["date"]).year
    d = autumn_night(year + 1, ws["tz"])
    hours = plan(base, key, d)["hours"]
    walls = [hhmm(h) for h in hours]
    rep = [h for h in hours if walls.count(hhmm(h)) == 2]
    assert len(rep) == 2
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        click(page.get_by_role("button", name="Enter sky conditions", exact=True))
        dlg = page.get_by_role("dialog", name="Sky conditions", exact=True)
        for h in hours:
            lbl = f"{hhmm(h)} ({h[-6:]})" if h in rep else hhmm(h)
            fill(dlg.get_by_role("spinbutton", name=f"Cloud {lbl}", exact=True), "5" if h == rep[0] else "60")
            fill(dlg.get_by_role("spinbutton", name=f"Transparency {lbl}", exact=True), "4")
            fill(dlg.get_by_role("spinbutton", name=f"Seeing {lbl}", exact=True), "3")
        click(dlg.get_by_role("button", name="Save conditions", exact=True))
        see(page, page.get_by_role("status", name="Plan updates", exact=True), f"Conditions saved for {len(hours)} hours.", "saved")
    stored = {at(e["hour_start"]): e["cloud_pct"] for e in plan(base, key, d)["conditions"]["hours"]}
    assert stored[at(rep[0])] == 5 and stored[at(rep[1])] == 60


def test_session_state_edges(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s = new_session(base, key, p["id"])
    sid = s["id"]
    assert s["state"] == "planned"

    def illegal(action, frm, to, body=None):
        e = err(call(base, "POST", f"/api/sessions/{sid}/{action}", key, body if body is not None else {}), 409, "illegal_transition")
        assert e["error"]["message"] == f"A session that is {frm} cannot become {to}."

    illegal("log", "planned", "logged")
    err(call(base, "POST", f"/api/sessions/{sid}/restore", key, {}), 409, "illegal_transition")
    err(call(base, "POST", f"/api/sessions/{sid}/batches", key, BATCH, headers={"Idempotency-Key": idempotency_key()}), 409, "wrong_state")
    assert start(base, key, sid)["state"] == "imaging"
    illegal("start", "imaging", "imaging")
    illegal("trash", "imaging", "trashed")
    illegal("amend", "imaging", "amended", {"batches": [BATCH]})
    err(call(base, "POST", f"/api/sessions/{sid}/log", key, {}), 409, "no_batches")
    add_batch(base, key, sid)
    assert ok(call(base, "POST", f"/api/sessions/{sid}/log", key, {}), 200)["state"] == "logged"
    illegal("start", "logged", "imaging")
    illegal("log", "logged", "logged")
    b = get_session(base, key, sid)["batches"][0]
    am = ok(call(base, "POST", f"/api/sessions/{sid}/amend", key, {"batches": [{**BATCH, "id": b["id"], "sub_count": 30}]}), 200)
    assert am["state"] == "amended"
    assert ok(call(base, "POST", f"/api/sessions/{sid}/amend", key, {"batches": [{**BATCH, "id": b["id"], "sub_count": 31}]}), 200)["state"] == "amended"
    t = ok(call(base, "POST", f"/api/sessions/{sid}/trash", key), 200)
    assert t["state"] == "trashed" and t["previous_state"] == "amended"
    illegal("trash", "trashed", "trashed")
    illegal("start", "trashed", "imaging")
    assert ok(call(base, "POST", f"/api/sessions/{sid}/restore", key), 200)["state"] == "amended"
    planned = new_session(base, key, p["id"])
    assert ok(call(base, "POST", f"/api/sessions/{planned['id']}/trash", key), 200)["state"] == "trashed"
    assert ok(call(base, "POST", f"/api/sessions/{planned['id']}/restore", key), 200)["state"] == "planned"
    race = new_session(base, key, p["id"])
    start(base, key, race["id"])
    add_batch(base, key, race["id"])
    with ThreadPoolExecutor(2) as ex:
        rs = list(ex.map(lambda _: call(base, "POST", f"/api/sessions/{race['id']}/log", key, {}), range(2)))
    codes = sorted(r.status_code for r in rs)
    assert codes == [200, 409], [r.text for r in rs]
    assert [r for r in rs if r.status_code == 409][0].json()["error"]["code"] == "illegal_transition"
    log_moves = {e["movement_id"] for e in ledger(base, key, p["id"])
                 if e["movement_kind"] == "log" and e["session_id"] == race["id"]}
    assert len(log_moves) == 1, "the racing logs posted the batch twice"
    paused = project(base, key)
    ps = new_session(base, key, paused["id"])
    ok(call(base, "POST", f"/api/projects/{paused['id']}/transition", key, {"to": "paused"}), 200)
    err(call(base, "POST", f"/api/sessions/{ps['id']}/start", key, {}), 409, "project_not_active")
    err(call(base, "POST", "/api/sessions", key, {"project_id": paused["id"], "observing_date": "2026-10-14", "notes": ""}), 409, "project_not_active")


NOON_CASES = {
    "evening-2330": (0, "23:30"),
    "after-midnight-0110": (1, "01:10"),
    "noon-1200": (0, "12:00"),
    "before-noon": (1, "11:59"),
}


@pytest.mark.parametrize("case", list(NOON_CASES), ids=list(NOON_CASES))
def test_observing_date_noon_rule(app_url, case):
    base = base_of(app_url)
    day_shift, wall = NOON_CASES[case]
    tz = SITE_LA[3]
    ws = workspace(base, site=SITE_LA)
    key = ws["key"]
    p = project(base, key)
    evening = date(2026, 10, 20)
    s = new_session(base, key, p["id"], observing_date="2026-10-14")
    local = datetime.combine(evening + timedelta(days=day_shift), dtime.fromisoformat(wall), tzinfo=ZoneInfo(tz))
    started = start(base, key, s["id"], local.astimezone(timezone.utc).isoformat())
    want = evening.isoformat()
    assert started["observing_date"] == want, (case, started["observing_date"], want)
    assert at(started["started_at"]) == local
    assert get_session(base, key, s["id"])["observing_date"] == want


def test_batch_idempotency(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key, allot={"Ha": HA_PLANNED})
    s = new_session(base, key, p["id"])
    start(base, key, s["id"])
    k = idempotency_key()
    url = f"/api/sessions/{s['id']}/batches"
    r1 = call(base, "POST", url, key, BATCH, headers={"Idempotency-Key": k})
    first = ok(r1, 201)
    r2 = call(base, "POST", url, key, BATCH, headers={"Idempotency-Key": k})
    assert r2.status_code == 201 and r2.json()["batch"] == first["batch"]
    assert len(get_session(base, key, s["id"])["batches"]) == 1
    err(call(base, "POST", url, key, {**BATCH, "sub_count": 61}, headers={"Idempotency-Key": k}), 409, "idempotency_conflict")
    assert len(get_session(base, key, s["id"])["batches"]) == 1
    e = err(call(base, "POST", url, key, BATCH), 422, "validation")
    assert "Idempotency-Key" in e["error"]["fields"]
    e = err(call(base, "POST", url, key, {**BATCH, "filter": "OIII"}, headers={"Idempotency-Key": idempotency_key()}), 422, "validation")
    assert e["error"]["fields"]["filter"] == NOT_PLANNED
    for over, field in (({"sub_count": 0}, "sub_count"), ({"exposure_s": 3601}, "exposure_s"), ({"temperature_c": -10.25}, "temperature_c"),
                        ({"binning": 5}, "binning"), ({"camera": ""}, "camera"), ({"gain": 1001}, "gain")):
        e = err(call(base, "POST", url, key, {**BATCH, **over}, headers={"Idempotency-Key": idempotency_key()}), 422, "validation")
        assert field in e["error"]["fields"]
    k2 = idempotency_key()
    body = {**BATCH, "sub_count": 7}
    with ThreadPoolExecutor(4) as ex:
        rs = list(ex.map(lambda _: call(base, "POST", url, key, body, headers={"Idempotency-Key": k2}), range(4)))
    assert {r.status_code for r in rs} == {201}, [r.text for r in rs]
    assert len({r.json()["batch"]["id"] for r in rs}) == 1
    assert len(get_session(base, key, s["id"])["batches"]) == 2
    planned = new_session(base, key, p["id"])
    err(call(base, "POST", f"/api/sessions/{planned['id']}/batches", key, BATCH, headers={"Idempotency-Key": idempotency_key()}), 409, "wrong_state")


def test_session_editor_announcements(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s = logged_session(base, key, p["id"])
    paused = project(base, key)
    ps = new_session(base, key, paused["id"], observing_date="2026-10-15")
    ok(call(base, "POST", f"/api/projects/{paused['id']}/transition", key, {"to": "paused"}), 200)
    with unlocked(browser, base, key, "/sessions") as page:
        log = page.get_by_role("status", name="Session log", exact=True)
        ed = open_editor(page, s["observing_date"], p["name"])
        fill(ed.get_by_role("textbox", name="Session notes", exact=True), "Dew heater on 3.")
        click(ed.get_by_role("button", name="Save notes", exact=True))
        see(page, log, "Notes saved.", "notes saved")
        assert get_session(base, key, s["id"])["notes"] == "Dew heater on 3."
        click(ed.get_by_role("button", name="Trash session", exact=True))
        see(page, log, "Session moved to trash.", "trash")
        assert get_session(base, key, s["id"])["state"] == "trashed"
        click(ed.get_by_role("button", name="Restore session", exact=True))
        see(page, log, "Session restored.", "restore")
        click(ed.get_by_role("button", name="Amend", exact=True))
        am = page.get_by_role("dialog", name="Amend session", exact=True)
        fill(am.get_by_role("spinbutton", name="Subs", exact=True).first, "30")
        click(am.get_by_role("button", name="Save amendment", exact=True))
        see(page, log, "Session amended.", "amend")
        assert get_session(base, key, s["id"])["batches"][0]["sub_count"] == 30
        click(ed.get_by_role("button", name="Close", exact=True))
        ed = open_editor(page, ps["observing_date"], paused["name"])
        click(ed.get_by_role("button", name="Start imaging", exact=True))
        other = new_session(base, key, p["id"])
        ok(call(base, "POST", f"/api/projects/{p['id']}/transition", key, {"to": "paused"}), 200)
        msg = call(base, "POST", f"/api/sessions/{other['id']}/start", key, {}).json()["error"]["message"]
        see(page, log, msg, "refused start shows the API message")
        assert get_session(base, key, ps["id"])["state"] == "planned"


def test_wf_session_logging_happy(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key, allot={"Ha": HA_PLANNED})
    d = "2026-10-14"
    b = {**BATCH, "sub_count": 12}
    with unlocked(browser, base, key, "/sessions") as page:
        click(page.get_by_role("button", name="New session", exact=True))
        dlg = page.get_by_role("dialog", name="New session", exact=True)
        select(dlg.get_by_role("combobox", name="Project", exact=True), p["name"])
        fill(dlg.get_by_role("textbox", name="Observing date", exact=True), d)
        click(dlg.get_by_role("button", name="Create session", exact=True))
        log = page.get_by_role("status", name="Session log", exact=True)
        see(page, log, f"Session created for {d}.", "created")
        ed = open_editor(page, d, p["name"])
        fill(ed.get_by_role("textbox", name="Started at", exact=True), f"{d} 23:30")
        click(ed.get_by_role("button", name="Start imaging", exact=True))
        see(page, log, f"Imaging started. Night of {d}.", "started")
        click(ed.get_by_role("button", name="Log batch", exact=True))
        bd = page.get_by_role("dialog", name="Log batch", exact=True)
        fill_batch(bd, b)
        add = bd.get_by_role("button", name="Add batch", exact=True)
        with held(page, "**/api/sessions/*/batches") as h:
            click(add)
            try:
                if add.is_visible():
                    add.click(timeout=2000)
            except PlaywrightError:
                pass
            h.release()
        see(page, log, f"{b['sub_count']} subs of {b['exposure_s']} s in Ha added.", "batch added")
        click(ed.get_by_role("button", name="Finish and log", exact=True))
        see(page, log, f"Session logged: {duration(b['sub_count'] * b['exposure_s'])} integrated.", "logged")
    sessions = [s for s in ok(call(base, "GET", f"/api/sessions?project_id={p['id']}", key), 200)["sessions"]]
    assert len(sessions) == 1 and sessions[0]["state"] == "logged" and sessions[0]["observing_date"] == d
    assert len(sessions[0]["batches"]) == 1, "the repeated submit created a second batch"
    e = b["sub_count"] * b["exposure_s"]
    assert owed(get_project(base, key, p["id"]), "Ha") == HA_PLANNED - e
    rows = Postgres().rows(
        "SELECT movement_id::text AS m, count(*) AS n, sum(seconds) AS s, "
        "sum(CASE WHEN account = 'owed' THEN seconds ELSE 0 END) AS owed "
        f"FROM ledger.entries WHERE project_id::text = '{p['id'].replace(chr(39), '')}' GROUP BY movement_id")
    assert rows and all(int(r["n"]) == 2 and int(r["s"]) == 0 for r in rows), rows
    assert sum(int(r["owed"]) for r in rows) == HA_PLANNED - e


def test_wf_session_logging_after_midnight(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base, site=SITE_LA)
    key = ws["key"]
    p = project(base, key, allot={"R": 3600})
    b = {**BATCH, "filter": "R", "sub_count": 30, "exposure_s": 120, "camera": "Umbra 6M", "gain": 0, "offset": 10, "temperature_c": 0.0}
    with unlocked(browser, base, key, "/sessions") as page:
        ui_log_session(page, base, p["name"], "2026-10-20", b, "2026-10-21 01:10")
    s = ok(call(base, "GET", f"/api/sessions?project_id={p['id']}", key), 200)["sessions"][0]
    assert s["observing_date"] == "2026-10-20" and s["state"] == "logged"
    assert owed(get_project(base, key, p["id"]), "R") == 3600 - 30 * 120


def test_frame_upload_confirmed(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s = new_session(base, key, p["id"])
    start(base, key, s["id"])
    bid = add_batch(base, key, s["id"])["batch"]["id"]
    data = png_bytes()
    r = ok(put_frame(base, key, bid, FRAME_ONE, data), 201)
    fr = r["frame"]
    assert r["session_frame_count"] == 1
    assert fr["size_bytes"] == len(data) and fr["sha256"] == hashlib.sha256(data).hexdigest()
    assert fr["content_type"] == "image/png" and fr["name"] == FRAME_ONE and fr["batch_id"] == bid
    s3 = S3()
    k = f"frames/{ws['id']}/{s['id']}/{bid}/{fr['id']}/{FRAME_ONE}"
    assert k in s3.keys(f"frames/{ws['id']}/"), s3.keys(f"frames/{ws['id']}/")
    assert s3.get(k) == data
    dl = call(base, "GET", f"/api/frames/{fr['id']}/content", key)
    assert dl.status_code == 200 and dl.content == data and dl.headers["content-type"].startswith("image/png")
    err(put_frame(base, key, bid, FRAME_ONE, png_bytes()), 409, "frame_exists")
    err(put_frame(base, key, bid, "light_002.png", b"text", "text/plain"), 415, "unsupported_media_type")
    err(put_frame(base, key, bid, "light_003.png", b"\0" * (UPLOAD_LIMIT + 1)), 413, "too_large")
    big = ok(put_frame(base, key, bid, "light_004.fits", b"\1" * UPLOAD_LIMIT, "image/fits"), 201)
    assert big["session_frame_count"] == 2
    sess = get_session(base, key, s["id"])
    assert sess["frame_count"] == 2 and {f["name"] for f in sess["frames"]} == {FRAME_ONE, FRAME_FOUR}
    names = {x.rsplit("/", 1)[-1] for x in s3.keys(f"frames/{ws['id']}/{s['id']}/")}
    assert names == {FRAME_ONE, FRAME_FOUR}, names
    ok(call(base, "POST", f"/api/sessions/{s['id']}/log", key, {}), 200)
    ok(call(base, "POST", f"/api/sessions/{s['id']}/trash", key), 200)
    err(put_frame(base, key, bid, "light_005.png", png_bytes()), 409, "wrong_state")
    assert k in s3.keys(f"frames/{ws['id']}/")


def test_upload_progress_announcements(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s = new_session(base, key, p["id"], observing_date="2026-10-14")
    start(base, key, s["id"], "2026-10-14T21:05:00+01:00")
    add_batch(base, key, s["id"])
    with unlocked(browser, base, key, "/sessions") as page:
        ed = open_editor(page, "2026-10-14", p["name"])
        prog = page.get_by_role("status", name="Upload progress", exact=True)
        prog.evaluate(RECORD_JS)
        files = [{"name": "light_a.png", "mimeType": "image/png", "buffer": png_bytes()},
                 {"name": "light_b.png", "mimeType": "image/png", "buffer": png_bytes()}]
        with page.expect_file_chooser() as fc:
            click(ed.get_by_role("button", name="Upload frames", exact=True))
        fc.value.set_files(files)
        see(page, prog, "light_b.png stored. 2 frames in this session.", "second stored")
        logged = " | ".join(page.evaluate("window.__dflog"))
        for f in files:
            assert f"Uploading {f['name']}: 0%" in logged and f"Uploading {f['name']}: 100%" in logged, logged
        assert STORED_A in logged
        assert get_session(base, key, s["id"])["frame_count"] == 2
        with page.expect_file_chooser() as fc:
            click(ed.get_by_role("button", name="Upload frames", exact=True))
        fc.value.set_files([{"name": "probe.txt", "mimeType": "text/plain", "buffer": b"not an image"}])
        see(page, prog, "probe.txt was not stored: ", "failure copy")
        assert get_session(base, key, s["id"])["frame_count"] == 2


def test_wf_frame_upload_happy(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s = new_session(base, key, p["id"], observing_date="2026-10-14")
    start(base, key, s["id"], "2026-10-14T21:05:00+01:00")
    add_batch(base, key, s["id"])
    payloads = {"m31_001.png": png_bytes(), "m31_002.png": png_bytes()}
    with unlocked(browser, base, key, "/sessions") as page:
        ed = open_editor(page, "2026-10-14", p["name"])
        prog = page.get_by_role("status", name="Upload progress", exact=True)
        for i, (name, data) in enumerate(payloads.items(), start=1):
            with page.expect_file_chooser() as fc:
                click(ed.get_by_role("button", name="Upload frames", exact=True))
            fc.value.set_files([{"name": name, "mimeType": "image/png", "buffer": data}])
            see(page, prog, f"{name} stored. {i} frames in this session.", f"frame {i}")
    sess = get_session(base, key, s["id"])
    assert sess["frame_count"] == 2
    s3 = S3()
    for fr in sess["frames"]:
        k = f"frames/{ws['id']}/{s['id']}/{fr['batch_id']}/{fr['id']}/{fr['name']}"
        assert s3.get(k) == payloads[fr["name"]]
    fr = sess["frames"][0]
    assert call(base, "GET", f"/api/frames/{fr['id']}/content", key).content == payloads[fr["name"]]
    other = workspace(base)
    err(call(base, "GET", f"/api/frames/{fr['id']}/content", other["key"]), 404, "not_found")


def test_wf_frame_upload_rejected_type(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s = new_session(base, key, p["id"], observing_date="2026-10-14")
    start(base, key, s["id"], "2026-10-14T21:05:00+01:00")
    add_batch(base, key, s["id"])
    with unlocked(browser, base, key, "/sessions") as page:
        ed = open_editor(page, "2026-10-14", p["name"])
        with page.expect_file_chooser() as fc:
            click(ed.get_by_role("button", name="Upload frames", exact=True))
        fc.value.set_files([{"name": "notes.txt", "mimeType": "text/plain", "buffer": b"hello"}])
        see(page, page.get_by_role("status", name="Upload progress", exact=True), "notes.txt was not stored: ", "failure")
    assert get_session(base, key, s["id"])["frame_count"] == 0
    assert S3().keys(f"frames/{ws['id']}/{s['id']}/") == []


def ledger(base, key, pid):
    return ok(call(base, "GET", f"/api/projects/{pid}/ledger", key), 200)["entries"]


def test_amend_reversals_ledger(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key, allot={"Ha": HA_PLANNED, "OIII": HA_PLANNED})
    s = logged_session(base, key, p["id"], batches=[{"sub_count": 10}, {"sub_count": 5}, {"sub_count": 2}])
    b1, b2, b3 = s["batches"]
    before = ledger(base, key, p["id"])
    logs = {e["batch_id"]: e["movement_id"] for e in before if e["movement_kind"] == "log"}
    body = {"batches": [{**BATCH, "id": b1["id"], "sub_count": 20}, {**BATCH, "id": b3["id"], "sub_count": 2},
                        {**BATCH, "filter": "OIII", "sub_count": 4}]}
    am = ok(call(base, "POST", f"/api/sessions/{s['id']}/amend", key, body), 200)
    assert am["state"] == "amended" and len(am["batches"]) == 3
    after = ledger(base, key, p["id"])
    new = after[len(before):]
    assert after[:len(before)] == before, "existing ledger entries were edited"
    rev = {e["reverses_movement_id"] for e in new if e["movement_kind"] == "reversal"}
    assert rev == {logs[b1["id"]], logs[b2["id"]]}, new
    assert logs[b3["id"]] not in rev
    for mid in {e["movement_id"] for e in new}:
        pair = [e for e in new if e["movement_id"] == mid]
        assert len(pair) == 2 and sum(e["seconds"] for e in pair) == 0
    proj = get_project(base, key, p["id"])
    assert owed(proj, "Ha") == HA_PLANNED - (20 + 2) * BATCH["exposure_s"]
    assert owed(proj, "OIII") == HA_PLANNED - 4 * BATCH["exposure_s"]
    assert proj["total_integration_seconds"] == (20 + 2 + 4) * BATCH["exposure_s"]
    empty = len(ledger(base, key, p["id"]))
    err(call(base, "POST", f"/api/sessions/{s['id']}/amend", key, {"batches": []}), 422, "validation")
    assert len(ledger(base, key, p["id"])) == empty
    keep = am["batches"][0]["id"]
    ok(put_frame(base, key, keep, "f.png", png_bytes()), 201)
    n = len(ledger(base, key, p["id"]))
    err(call(base, "POST", f"/api/sessions/{s['id']}/amend", key, {"batches": [{**BATCH, "id": am["batches"][1]["id"], "sub_count": 2}]}), 409, "batch_has_frames")
    assert len(ledger(base, key, p["id"])) == n and len(get_session(base, key, s["id"])["batches"]) == 3


def test_trash_restore_exact(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    dark = ready_set(base, key, "dark", today=site_today(base, key, ws["tz"]))
    s = new_session(base, key, p["id"], notes="Oak blocked the east until 22:40. Dew heater on 3.")
    start(base, key, s["id"], "2026-10-14T21:05:00+01:00")
    bid = add_batch(base, key, s["id"])["batch"]["id"]
    data = png_bytes()
    ok(put_frame(base, key, bid, "f1.png", data), 201)
    ok(call(base, "POST", f"/api/batches/{bid}/calibration", key, {"calibration_set_id": dark["id"]}), 200)
    ok(call(base, "POST", f"/api/sessions/{s['id']}/log", key, {}), 200)
    snap = get_session(base, key, s["id"])
    owed_logged = owed(get_project(base, key, p["id"]), "Ha")
    trashed = ok(call(base, "POST", f"/api/sessions/{s['id']}/trash", key), 200)
    assert trashed["state"] == "trashed" and trashed["previous_state"] == "logged"
    assert owed(get_project(base, key, p["id"]), "Ha") == owed_logged + snap["integration_seconds"]
    assert all(x["id"] != s["id"] for x in ok(call(base, "GET", "/api/sessions", key), 200)["sessions"])
    assert any(x["id"] == s["id"] for x in ok(call(base, "GET", "/api/sessions?include_trashed=true", key), 200)["sessions"])
    fr = snap["frames"][0]
    assert S3().get(f"frames/{ws['id']}/{s['id']}/{bid}/{fr['id']}/f1.png") == data
    restored = ok(call(base, "POST", f"/api/sessions/{s['id']}/restore", key), 200)
    assert restored["state"] == "logged"
    strip = lambda b: {k: v for k, v in b.items() if k not in ("state", "previous_state")}
    assert strip(get_session(base, key, s["id"])) == strip(snap)
    assert get_session(base, key, s["id"])["batches"][0]["calibration"]["dark"] == dark["id"]
    assert owed(get_project(base, key, p["id"]), "Ha") == owed_logged
    assert call(base, "GET", f"/api/frames/{fr['id']}/content", key).content == data
    kinds = [e["movement_kind"] for e in ledger(base, key, p["id"]) if e["session_id"] == s["id"]]
    assert kinds.count("log") == 2 * 2 and kinds.count("reversal") == 2, kinds


def test_edit_lock_concurrency_expiry():
    base = instance("APP_SHORT_URL")
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s = new_session(base, key, p["id"])
    url = f"/api/sessions/{s['id']}/lock"
    with ThreadPoolExecutor(2) as ex:
        rs = list(ex.map(lambda _: call(base, "POST", url, key, {}), range(2)))
    assert sorted(r.status_code for r in rs) == [200, 409], [r.text for r in rs]
    win = [r for r in rs if r.status_code == 200][0].json()
    assert [r for r in rs if r.status_code == 409][0].json()["error"]["code"] == "session_locked"
    assert win["expires_in_seconds"] <= STALE_SHORT_S and at(win["expires_at"]) > datetime.now(timezone.utc) - timedelta(seconds=HTTP_TIMEOUT)
    tok = win["lock_token"]
    assert ok(call(base, "PATCH", f"/api/sessions/{s['id']}/notes", key, {"notes": "one", "lock_token": tok}), 200)["notes"] == "one"
    err(call(base, "DELETE", url, key, {"lock_token": "someone-else"}), 409, "session_locked")
    poll(lambda: call(base, "PATCH", f"/api/sessions/{s['id']}/notes", key, {"notes": "two", "lock_token": tok}),
         lambda r: r.status_code == 409, lambda r: f"lock never expired: {r.text}")
    err(call(base, "PATCH", f"/api/sessions/{s['id']}/notes", key, {"notes": "three", "lock_token": tok}), 409, "lock_expired")
    other = ok(call(base, "POST", url, key, {}), 200)
    err(call(base, "PATCH", f"/api/sessions/{s['id']}/notes", key, {"notes": "four", "lock_token": tok}), 409, "session_locked")
    assert get_session(base, key, s["id"])["notes"] in ("one", "two")
    assert call(base, "DELETE", url, key, {"lock_token": other["lock_token"]}).status_code == 204
    ok(call(base, "POST", f"/api/sessions/{s['id']}/trash", key), 200)
    err(call(base, "POST", url, key, {}), 409, "wrong_state")


def test_notes_survive_lock_expiry(browser):
    base = instance("APP_SHORT_URL")
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s1 = new_session(base, key, p["id"], observing_date="2026-10-14")
    s2 = new_session(base, key, p["id"], observing_date="2026-10-15")
    held_lock = ok(call(base, "POST", f"/api/sessions/{s2['id']}/lock", key, {}), 200)
    with unlocked(browser, base, key, "/sessions") as page:
        ed = open_editor(page, "2026-10-14", p["name"])
        notes = ed.get_by_role("textbox", name="Session notes", exact=True)
        log = page.get_by_role("status", name="Session log", exact=True)
        fill(notes, NOTES_KEPT)
        wait_real(base, STALE_SHORT_S + 1)
        advance(page, (STALE_SHORT_S + 1) * 1000)
        see(page, log, LOCK_EXPIRED, "lock expired copy")
        assert notes.input_value() == NOTES_KEPT
        click(ed.get_by_role("button", name="Save notes", exact=True))
        see(page, log, "Notes saved.", "save after expiry")
        assert get_session(base, key, s1["id"])["notes"] == NOTES_KEPT
        click(ed.get_by_role("button", name="Close", exact=True))
        ok(call(base, "POST", f"/api/sessions/{s2['id']}/lock", key, {"lock_token": held_lock["lock_token"]}), 200)
        ed = open_editor(page, "2026-10-15", p["name"])
        notes = ed.get_by_role("textbox", name="Session notes", exact=True)
        fill(notes, NOTES_HELD)
        click(ed.get_by_role("button", name="Save notes", exact=True))
        see(page, log, LOCK_HELD, "held copy")
        assert notes.input_value() == NOTES_HELD
        assert get_session(base, key, s2["id"])["notes"] == ""


def test_wf_session_amend_restore_happy(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s = logged_session(base, key, p["id"], notes="Dew heater on 3.")
    with unlocked(browser, base, key, "/sessions") as page:
        log = page.get_by_role("status", name="Session log", exact=True)
        ed = open_editor(page, s["observing_date"], p["name"])
        click(ed.get_by_role("button", name="Amend", exact=True))
        am = page.get_by_role("dialog", name="Amend session", exact=True)
        fill(am.get_by_role("spinbutton", name="Subs", exact=True).first, "40")
        click(am.get_by_role("button", name="Save amendment", exact=True))
        see(page, log, "Session amended.", "amended")
        amended = get_session(base, key, s["id"])
        assert amended["batches"][0]["sub_count"] == 40
        click(ed.get_by_role("button", name="Trash session", exact=True))
        see(page, log, "Session moved to trash.", "trashed")
        assert owed(get_project(base, key, p["id"]), "Ha") == HA_PLANNED
        click(ed.get_by_role("button", name="Restore session", exact=True))
        see(page, log, "Session restored.", "restored")
    back = get_session(base, key, s["id"])
    strip = lambda b: {k: v for k, v in b.items() if k not in ("state", "previous_state")}
    assert back["state"] == "amended" and strip(back) == strip(amended)
    assert owed(get_project(base, key, p["id"]), "Ha") == HA_PLANNED - 40 * BATCH["exposure_s"]


KINDS = {"dark": "dark", "flat": "flat", "bias": "bias"}


@pytest.mark.parametrize("kind", list(KINDS), ids=list(KINDS))
def test_calibration_states_and_age(app_url, kind):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    today = site_today(base, key, ws["tz"])
    s = cal_set(base, key, kind, today)
    assert s["status"] == "building" and s["version"] == 1 and s["max_age_days"] == AGE[kind] and s["age_days"] == 0
    err(call(base, "POST", f"/api/calibration-sets/{s['id']}/transition", key, {"to": "ready"}), 409, "master_missing")
    ok(put_master(base, key, s["id"], "master.fits", b"m"), 200)
    r = ok(call(base, "POST", f"/api/calibration-sets/{s['id']}/transition", key, {"to": "ready"}), 200)
    assert r["status"] == "ready"
    e = err(call(base, "POST", f"/api/calibration-sets/{s['id']}/transition", key, {"to": "ready"}), 409, "illegal_transition")
    assert e["error"]["message"] == "A calibration set that is ready cannot become ready."
    edge = ready_set(base, key, kind, today - timedelta(days=AGE[kind]))
    assert edge["status"] == "ready" and edge["age_days"] == AGE[kind]
    old = ready_set(base, key, kind, today - timedelta(days=AGE[kind] + 1))
    assert old["status"] == "stale" and old["age_days"] == AGE[kind] + 1
    assert ok(call(base, "POST", f"/api/calibration-sets/{old['id']}/transition", key, {"to": "retired"}), 200)["status"] == "retired"
    err(call(base, "POST", f"/api/calibration-sets/{old['id']}/transition", key, {"to": "ready"}), 409, "illegal_transition")
    err(call(base, "PATCH", f"/api/calibration-sets/{old['id']}", key, {"gain": 1}), 409, "set_retired")
    b = cal_set(base, key, kind, today)
    assert ok(call(base, "POST", f"/api/calibration-sets/{b['id']}/transition", key, {"to": "retired"}), 200)["status"] == "retired"
    e = err(call(base, "POST", "/api/calibration-sets", key, {"name": "future", "kind": kind, "camera": "c", "gain": 0, "offset": 0,
            "exposure_s": 300 if kind == "dark" else None, "temperature_c": 0.0, "binning": 1,
            "filter": "Ha" if kind == "flat" else None, "frame_count": 1,
            "captured_on": (today + timedelta(days=1)).isoformat()}), 422, "validation")
    assert "captured_on" in e["error"]["fields"]


def test_master_upload_bytes(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    s = cal_set(base, key, "dark", site_today(base, key, ws["tz"]))
    err(call(base, "GET", f"/api/calibration-sets/{s['id']}/master", key), 404, "not_found")
    data = os.urandom(FRAME_PAD)
    r = ok(put_master(base, key, s["id"], DARK_MASTER, data, "image/fits"), 200)
    assert r["version"] == 2 and r["master"] == {"filename": DARK_MASTER, "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    assert S3().get(f"calibration/{ws['id']}/{s['id']}/v2/{DARK_MASTER}") == data
    assert call(base, "GET", f"/api/calibration-sets/{s['id']}/master", key).content == data
    err(put_master(base, key, s["id"], "x.fits", b"x", "text/plain"), 415, "unsupported_media_type")
    err(put_master(base, key, s["id"], "y.fits", b"\0" * (UPLOAD_LIMIT + 1)), 413, "too_large")
    after = ok(call(base, "GET", f"/api/calibration-sets/{s['id']}", key), 200)
    assert after["version"] == 2 and after["master"]["filename"] == DARK_MASTER
    assert not any(k.endswith(("/x.fits", "/y.fits")) for k in S3().keys(f"calibration/{ws['id']}/{s['id']}/"))
    ok(call(base, "POST", f"/api/calibration-sets/{s['id']}/transition", key, {"to": "retired"}), 200)
    err(put_master(base, key, s["id"], "z.fits", b"z"), 409, "set_retired")


def refusal(*reasons):
    return "Calibration refused: " + "; ".join(reasons) + "."


def test_calibration_matching_refusal(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    today = site_today(base, key, ws["tz"])
    p = project(base, key)
    s = logged_session(base, key, p["id"])
    bid = s["batches"][0]["id"]
    url = f"/api/batches/{bid}/calibration"
    a = ready_set(base, key, "dark", today, temperature_c=-8.0)
    r = ok(call(base, "POST", url, key, {"calibration_set_id": a["id"]}), 200)
    assert r["batch"]["calibration"]["dark"] == a["id"] and r["warning"] is None
    cases = [
        (dict(gain=120, temperature_c=-5.0), "dark", REFUSAL_EXAMPLE, ["gain", "temperature"]),
        (dict(temperature_c=-7.9), "dark", refusal("temperature -7.9 C is more than 2.0 C from -10.0 C"), ["temperature"]),
        (dict(camera="Umbra 6M", exposure_s=180), "dark", refusal("camera Umbra 6M does not match Umbra 26M", "exposure 180 s does not match 300 s"), ["camera", "exposure"]),
        (dict(filter="OIII", binning=2), "flat", refusal("binning 2 does not match 1", "filter OIII does not match Ha"), ["binning", "filter"]),
        (dict(offset=10), "bias", refusal("offset 10 does not match 50"), ["offset"]),
    ]
    for over, kind, msg, fields in cases:
        bad = ready_set(base, key, kind, today, **over)
        e = err(call(base, "POST", url, key, {"calibration_set_id": bad["id"]}), 422, "calibration_mismatch")
        assert e["error"]["message"] == msg and [m["field"] for m in e["error"]["mismatches"]] == fields
        cand = {c["calibration_set_id"]: c for c in ok(call(base, "GET", f"/api/batches/{bid}/calibration-candidates", key), 200)["candidates"]}
        assert cand[bad["id"]]["matches"] is False and len(cand[bad["id"]]["reasons"]) == len(fields)
    assert get_session(base, key, s["id"])["batches"][0]["calibration"]["dark"] == a["id"]
    bias = ready_set(base, key, "bias", today, temperature_c=20.0, exposure_s=None)
    assert ok(call(base, "POST", url, key, {"calibration_set_id": bias["id"]}), 200)["batch"]["calibration"]["bias"] == bias["id"]
    b2 = ready_set(base, key, "dark", today)
    assert ok(call(base, "POST", url, key, {"calibration_set_id": b2["id"]}), 200)["batch"]["calibration"]["dark"] == b2["id"]
    stale = ready_set(base, key, "dark", today - timedelta(days=AGE["dark"] + 1))
    assert ok(call(base, "POST", url, key, {"calibration_set_id": stale["id"]}), 200)["warning"] == "stale"
    building = cal_set(base, key, "dark", today, gain=999)
    err(call(base, "POST", url, key, {"calibration_set_id": building["id"]}), 409, "calibration_not_usable")
    ok(call(base, "DELETE", f"/api/batches/{bid}/calibration/dark", key), 200)
    assert get_session(base, key, s["id"])["batches"][0]["calibration"]["dark"] is None
    err(call(base, "DELETE", f"/api/batches/{bid}/calibration/dark", key), 404, "not_found")
    ok(call(base, "POST", f"/api/sessions/{s['id']}/trash", key), 200)
    err(call(base, "POST", url, key, {"calibration_set_id": a["id"]}), 409, "wrong_state")


def test_library_copy_verbatim(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    s = logged_session(base, key, p["id"])
    with unlocked(browser, base, key, "/library") as page:
        eventually(page, lambda: page.get_by_text(EMPTY_LIBRARY, exact=True).is_visible(), lambda: "no empty-library copy")
        old = ready_set(base, key, "dark", site_today(base, key, ws["tz"]) - timedelta(days=AGE["dark"] + 1))
        page.reload()
        lib = page.get_by_role("table", name="Calibration library").or_(page.get_by_role("list", name="Calibration library"))
        see(page, lib, "Stale", "stale state cell")
        page.goto(base + "/sessions")
        ed = open_editor(page, s["observing_date"], p["name"])
        click(ed.get_by_role("button", name=CALIBRATE_HA_1, exact=True))
        ch = page.get_by_role("dialog", name="Choose calibration", exact=True)
        click(ch.get_by_role("button", name=f"Use {old['name']}", exact=True))
        see(page, page.get_by_role("status", name="Calibration result", exact=True),
            f"Warning: this set is older than {AGE['dark']} days. It still calibrates, but consider a fresh library.", "stale warning")
    assert get_session(base, key, s["id"])["batches"][0]["calibration"]["dark"] == old["id"]


def test_calibration_versions_restore(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    s = cal_set(base, key, "dark", site_today(base, key, ws["tz"]))
    a, b = os.urandom(FRAME_PAD), os.urandom(FRAME_PAD)
    ok(put_master(base, key, s["id"], MASTER_A, a), 200)
    ok(call(base, "PATCH", f"/api/calibration-sets/{s['id']}", key, {"temperature_c": -15.0}), 200)
    v4 = ok(put_master(base, key, s["id"], MASTER_B, b), 200)
    assert v4["version"] == 4
    e = err(call(base, "PATCH", f"/api/calibration-sets/{s['id']}", key, {"kind": "flat"}), 422, "validation")
    assert e["error"]["fields"]["kind"] == KIND_FIXED
    vs = ok(call(base, "GET", f"/api/calibration-sets/{s['id']}/versions", key), 200)["versions"]
    assert [v["version"] for v in vs] == [1, 2, 3, 4]
    r = ok(call(base, "POST", f"/api/calibration-sets/{s['id']}/restore", key, {"version": 2}), 200)
    assert r["version"] == 5 and r["temperature_c"] == -10.0 and r["master"]["filename"] == MASTER_A
    assert r["master"]["sha256"] == hashlib.sha256(a).hexdigest()
    assert call(base, "GET", f"/api/calibration-sets/{s['id']}/master", key).content == a
    v5 = ok(call(base, "GET", f"/api/calibration-sets/{s['id']}/versions", key), 200)["versions"][-1]
    strip = lambda v: {k: x for k, x in v.items() if k not in ("version", "created_at")}
    assert strip(v5) == strip(vs[1])
    s3 = S3()
    assert s3.get(f"calibration/{ws['id']}/{s['id']}/v2/{MASTER_A}") == a and s3.get(f"calibration/{ws['id']}/{s['id']}/v4/{MASTER_B}") == b
    err(call(base, "POST", f"/api/calibration-sets/{s['id']}/restore", key, {"version": 99}), 404, "not_found")
    ok(call(base, "POST", f"/api/calibration-sets/{s['id']}/transition", key, {"to": "retired"}), 200)
    err(call(base, "POST", f"/api/calibration-sets/{s['id']}/restore", key, {"version": 1}), 409, "set_retired")


def test_wf_calibration_library_happy(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    name = unique("Darks")[0][:NAME_MAX]
    today = site_today(base, key, ws["tz"])
    data = os.urandom(FRAME_PAD)
    with unlocked(browser, base, key, "/library") as page:
        upd = page.get_by_role("status", name="Library updates", exact=True)
        click(page.get_by_role("button", name="New calibration set", exact=True))
        d = page.get_by_role("dialog", name="New calibration set", exact=True)
        fill(d.get_by_role("textbox", name="Set name", exact=True), name)
        select(d.get_by_role("combobox", name="Kind", exact=True), "dark")
        fill(d.get_by_role("textbox", name="Camera", exact=True), "Umbra 26M")
        for lbl, v in (("Gain", "100"), ("Offset", "50"), ("Exposure (s)", "300"), ("Sensor temperature (C)", "-10"),
                       ("Binning", "1"), ("Frames combined", "40")):
            fill(d.get_by_role("spinbutton", name=lbl, exact=True), v)
        fill(d.get_by_role("textbox", name="Captured on", exact=True), today.isoformat())
        click(d.get_by_role("button", name="Add set", exact=True))
        see(page, upd, f"{name} added to the library.", "added")
        with page.expect_file_chooser() as fc:
            click(page.get_by_role("button", name=f"Upload master {name}", exact=True))
        fc.value.set_files([{"name": "master.fits", "mimeType": "application/octet-stream", "buffer": data}])
        see(page, upd, f"Master stored for {name}.", "master")
        click(page.get_by_role("button", name=f"Mark ready {name}", exact=True))
        see(page, upd, f"{name} is ready.", "ready")
        click(page.get_by_role("button", name=f"Edit {name}", exact=True))
        e = page.get_by_role("dialog", name="Edit calibration set", exact=True)
        fill(e.get_by_role("spinbutton", name="Sensor temperature (C)", exact=True), "-15")
        click(e.get_by_role("button", name="Save set", exact=True))
        sid = [x for x in ok(call(base, "GET", "/api/calibration-sets", key), 200)["calibration_sets"] if x["name"] == name][0]["id"]
        poll(lambda: ok(call(base, "GET", f"/api/calibration-sets/{sid}", key), 200),
             lambda x: (advance(page, STEP_MS) or True) and x["temperature_c"] == -15.0, lambda x: f"edit not saved {x}")
        click(page.get_by_role("button", name=f"History {name}", exact=True))
        h = page.get_by_role("dialog", name="Version history", exact=True)
        click(h.get_by_role("button", name=f"Restore version {RESTORE_TO}", exact=True))
        see(page, upd, f"{name} restored to version {RESTORE_TO}.", "restored")
    s = ok(call(base, "GET", f"/api/calibration-sets/{sid}", key), 200)
    assert s["temperature_c"] == -10.0 and s["status"] == "ready" and s["master"]["sha256"] == hashlib.sha256(data).hexdigest()
    assert call(base, "GET", f"/api/calibration-sets/{sid}/master", key).content == data


def test_wf_calibration_library_link_refused(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    today = site_today(base, key, ws["tz"])
    p = project(base, key)
    s = logged_session(base, key, p["id"])
    bad = ready_set(base, key, "dark", today, gain=120, temperature_c=-5.0)
    good = ready_set(base, key, "dark", today)
    with unlocked(browser, base, key, "/sessions") as page:
        ed = open_editor(page, s["observing_date"], p["name"])
        res = page.get_by_role("status", name="Calibration result", exact=True)
        click(ed.get_by_role("button", name=CALIBRATE_HA_1, exact=True))
        ch = page.get_by_role("dialog", name="Choose calibration", exact=True)
        click(ch.get_by_role("button", name=f"Use {bad['name']}", exact=True))
        see(page, res, REFUSAL_EXAMPLE, "refusal")
        assert get_session(base, key, s["id"])["batches"][0]["calibration"]["dark"] is None
        click(ch.get_by_role("button", name=f"Use {good['name']}", exact=True))
        see(page, res, f"{good['name']} will calibrate this batch.", "linked")
    assert get_session(base, key, s["id"])["batches"][0]["calibration"]["dark"] == good["id"]


def test_project_state_edges(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key, allot={}, active=False)
    tr = lambda to: call(base, "POST", f"/api/projects/{p['id']}/transition", key, {"to": to})
    err(tr("active"), 409, "no_allotments")
    e = err(tr("complete"), 409, "illegal_transition")
    assert e["error"]["message"] == "A project that is draft cannot become complete."
    err(tr("frozen"), 422, "validation")
    ok(call(base, "PUT", f"/api/projects/{p['id']}/allotments/L", key, {"planned_seconds": 600}), 200)
    assert ok(tr("active"), 200)["state"] == "active"
    err(tr("active"), 409, "illegal_transition")
    err(tr("complete"), 409, "hours_still_owed")
    assert ok(tr("paused"), 200)["state"] == "paused"
    err(tr("complete"), 409, "illegal_transition")
    assert ok(tr("active"), 200)["state"] == "active"
    ok(call(base, "PUT", f"/api/projects/{p['id']}/allotments/L", key, {"planned_seconds": 0}), 200)
    assert ok(tr("complete"), 200)["state"] == "complete"
    err(call(base, "PATCH", f"/api/projects/{p['id']}", key, {"name": "x"}), 409, "project_closed")
    err(call(base, "PUT", f"/api/projects/{p['id']}/allotments/L", key, {"planned_seconds": 60}), 409, "project_closed")
    assert ok(tr("archived"), 200)["state"] == "archived"
    e = err(tr("active"), 409, "illegal_transition")
    assert e["error"]["message"] == "A project that is archived cannot become active."
    err(call(base, "PUT", f"/api/projects/{p['id']}/allotments/L", key, {"planned_seconds": 60}), 409, "project_closed")
    d = project(base, key, allot={}, active=False)
    assert ok(call(base, "POST", f"/api/projects/{d['id']}/transition", key, {"to": "archived"}), 200)["state"] == "archived"
    for bad in ({"planned_seconds": 61}, {"planned_seconds": L_PLANNED + 60}, {"planned_seconds": -60}):
        err(call(base, "PUT", f"/api/projects/{project(base, key, active=False)['id']}/allotments/L", key, bad), 422, "validation")
    e = err(call(base, "PUT", f"/api/projects/{project(base, key, active=False)['id']}/allotments/Z", key, {"planned_seconds": 60}), 422, "validation")
    assert "filter" in e["error"]["fields"]
    for bad in ({"name": "", "target_name": "t", "ra_deg": 1, "dec_deg": 1}, {"name": "n", "target_name": "t", "ra_deg": 360, "dec_deg": 1},
                {"name": "n", "target_name": "t", "ra_deg": 1, "dec_deg": 91}):
        err(call(base, "POST", "/api/projects", key, bad), 422, "validation")


def test_ledger_paired_entries(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key, allot={"Ha": 3600, "L": 1200})
    ok(call(base, "PUT", f"/api/projects/{p['id']}/allotments/Ha", key, {"planned_seconds": 7200}), 200)
    n = len(ledger(base, key, p["id"]))
    ok(call(base, "PUT", f"/api/projects/{p['id']}/allotments/Ha", key, {"planned_seconds": 7200}), 200)
    assert len(ledger(base, key, p["id"])) == n, "an unchanged allotment posted entries"
    s = logged_session(base, key, p["id"], batches=[{"sub_count": 3}, {"sub_count": 2, "filter": "L"}])
    ok(call(base, "POST", f"/api/sessions/{s['id']}/trash", key), 200)
    ok(call(base, "POST", f"/api/sessions/{s['id']}/restore", key), 200)
    entries = ledger(base, key, p["id"])
    moves = {}
    for e in entries:
        moves.setdefault(e["movement_id"], []).append(e)
    assert all(len(v) == 2 and sum(x["seconds"] for x in v) == 0 for v in moves.values())
    allot = [e for e in entries if e["movement_kind"] == "allot" and e["filter"] == "Ha"]
    assert sorted(e["seconds"] for e in allot if e["account"] == "owed") == [3600, 3600]
    proj = get_project(base, key, p["id"])
    for f in proj["filters"]:
        es = [e for e in entries if e["filter"] == f["filter"]]
        assert f["planned_seconds"] == -sum(e["seconds"] for e in es if e["account"] == "allotment")
        assert f["logged_seconds"] == sum(e["seconds"] for e in es if e["account"] == "integrated")
        assert f["owed_seconds"] == sum(e["seconds"] for e in es if e["account"] == "owed") == f["planned_seconds"] - f["logged_seconds"]
    assert [f["filter"] for f in proj["filters"]] == ["L", "Ha"]
    pid = p["id"].replace("'", "")
    rows = Postgres().rows(f"SELECT movement_id::text AS m, count(*) AS n, sum(seconds) AS s FROM ledger.entries "
                           f"WHERE project_id::text = '{pid}' GROUP BY movement_id")
    assert len(rows) == len(moves) and all(int(r["n"]) == 2 and int(r["s"]) == 0 for r in rows), rows


def test_planned_minutes_in_place(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key, allot={"Ha": HA_PLANNED})
    logged_session(base, key, p["id"], batches=[{"sub_count": 2}])
    with unlocked(browser, base, key, f"/projects/{p['id']}") as page:
        url = page.url
        see(page, page.get_by_role("region", name="Total integration", exact=True), f"{duration(600)} total", "total")
        spin = page.get_by_role("spinbutton", name=PLANNED_HA, exact=True)
        fill(spin, "120")
        spin.press("Tab")
        see(page, page.get_by_role("status", name="Project updates", exact=True),
            f"Planned Ha set to {duration(7200)}. Owed now {duration(7200 - 600)}.", "planned announcement")
        see(page, page.get_by_role("table", name="Hours owed", exact=True), duration(7200 - 600), "owed cell")
        assert page.url == url
    proj = get_project(base, key, p["id"])
    assert {f["filter"]: f for f in proj["filters"]}["Ha"]["planned_seconds"] == 7200


VIEWPORTS = {"375x812": (375, 812), "below-768": (767, 1024), "768x1024": (768, 1024),
             "1199x800": (1199, 800), "1200x800": (1200, 800), "1280x800": (1280, 800)}


@pytest.mark.parametrize("vp", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_breakpoints_layout(browser, app_url, vp):
    base = base_of(app_url)
    w, h = VIEWPORTS[vp]
    ws, key, d, n, p = plan_setup(base)
    for _ in range(3):
        project(base, key)
    logged_session(base, key, p["id"])
    ready_set(base, key, "dark", site_today(base, key, ws["tz"]))
    published = w in (375, 768, 1280)
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        page.set_viewport_size({"width": w, "height": h})
        page.reload()
        heading = page.get_by_role("heading", level=1)
        see(page, heading, "Night of", "headline")
        parts = [heading, card(page), dome(page), page.get_by_role("img", name="Sky chart", exact=True),
                 page.get_by_role("list", name="Plan targets", exact=True),
                 page.get_by_role("button", name="Enter sky conditions", exact=True), page.get_by_role("button", name="Add target", exact=True)]
        bx = [box(x) for x in parts]
        hb, cb, db, chb, lb, eb, ab = bx
        nav = box(page.get_by_role("navigation", name="Main"))
        sb = box(slider(page))
        if w < NARROW:
            ys = [b["y"] for b in bx]
            assert ys == sorted(ys), f"one-column order wrong at {vp}: {ys}"
        elif w < WIDE:
            assert lb["x"] >= chb["x"] + chb["width"] - 1, (lb, chb)
            assert db["y"] < chb["y"] < sb["y"] and nav["width"] > nav["height"] and nav["y"] <= hb["y"]
            assert cb["width"] > chb["width"]
        else:
            assert DOME_MIN_FRAC * w <= db["width"] <= DOME_MAX_FRAC * w, (db, w)
            assert abs(db["x"] + db["width"] / 2 - w / 2) <= DOME_CENTRE_PX
            assert ab["y"] >= db["y"] + db["height"] - 1 and db["x"] <= ab["x"] + ab["width"] / 2 <= db["x"] + db["width"]
            assert nav["height"] > nav["width"] and nav["x"] < db["x"]
            assert cb["x"] >= db["x"] + db["width"] - 1 and lb["x"] >= db["x"] + db["width"] - 1
            assert chb["y"] >= db["y"] + db["height"] - 1 and hb["y"] < db["y"]
        if published:
            layout(page)
        page.goto(base + "/projects")
        arts = page.get_by_role("article")
        eventually(page, lambda: arts.count() >= 4, lambda: "project cards missing")
        cols = len({round(box(arts.nth(i))["x"]) for i in range(arts.count())})
        assert cols == (1 if w < NARROW else 2 if w < WIDE else 3), f"{cols} columns at {vp}"
        if published:
            layout(page)
        page.goto(base + "/sessions")
        role = "list" if w < NARROW else "table"
        eventually(page, lambda: page.get_by_role(role, name="Sessions", exact=True).is_visible(), lambda: f"Sessions {role} at {vp}")
        if published:
            layout(page)
        page.goto(base + "/library")
        eventually(page, lambda: page.get_by_role(role, name="Calibration library", exact=True).is_visible(), lambda: f"Library {role} at {vp}")
        if published:
            layout(page)
            for path in ("/site", f"/projects/{p['id']}"):
                page.goto(base + path)
                see(page, card(page), "usable minutes", f"{path} card")
                layout(page)


def test_wf_project_ledger_happy(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    name = unique("Project")[0][:NAME_MAX]
    with unlocked(browser, base, key, "/projects") as page:
        click(page.get_by_role("button", name="New project", exact=True))
        d = page.get_by_role("dialog", name="New project", exact=True)
        fill(d.get_by_role("textbox", name="Project name", exact=True), name)
        fill(d.get_by_role("textbox", name="Target name", exact=True), "M31")
        fill(d.get_by_role("textbox", name="Right ascension (degrees)", exact=True), "10.6847")
        fill(d.get_by_role("textbox", name="Declination (degrees)", exact=True), "41.2690")
        click(d.get_by_role("button", name="Create project", exact=True))
        link = page.get_by_role("link", name=name, exact=True)
        click(link)
        upd = page.get_by_role("status", name="Project updates", exact=True)
        select(page.get_by_role("combobox", name="Add filter", exact=True), "L")
        spin = page.get_by_role("spinbutton", name=PLANNED_L, exact=True)
        fill(spin, "10")
        spin.press("Tab")
        see(page, upd, f"Planned L set to {duration(600)}. Owed now {duration(600)}.", "planned")
        click(page.get_by_role("button", name="Activate", exact=True))
        see(page, upd, "Project is now active.", "activated")
        purl = page.url
        ui_log_session(page, base, name, "2026-10-14", {**BATCH, "filter": "L", "sub_count": 2}, "2026-10-14 23:30")
        page.goto(purl)
        see(page, page.get_by_role("table", name="Hours owed", exact=True), duration(0), "owed zero")
        click(page.get_by_role("button", name="Show ledger", exact=True))
        led = page.get_by_role("table", name="Ledger", exact=True)
        eventually(page, lambda: led.get_by_role("row").count() >= 1 + 4, lambda: "ledger sheet rows")
        page.keyboard.press("Escape")
        click(page.get_by_role("button", name="Mark complete", exact=True))
        see(page, page.get_by_role("status", name="Project updates", exact=True), "Project is now complete.", "complete")
    p = [x for x in ok(call(base, "GET", "/api/projects", key), 200)["projects"] if x["name"] == name][0]
    assert p["state"] == "complete" and owed(p, "L") == 0 and p["session_count"] == 1


def test_wf_project_ledger_over_logged(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key, allot={"L": 300})
    with unlocked(browser, base, key, "/sessions") as page:
        ui_log_session(page, base, p["name"], "2026-10-14", {**BATCH, "filter": "L", "sub_count": 2}, "2026-10-14 23:30")
        page.goto(base + f"/projects/{p['id']}")
        see(page, page.get_by_role("table", name="Hours owed", exact=True), duration(-300), "over by")
        click(page.get_by_role("button", name="Mark complete", exact=True))
        see(page, page.get_by_role("status", name="Project updates", exact=True), "Project is now complete.", "complete")
    assert get_project(base, key, p["id"])["state"] == "complete"


SHARED_KEYS = {"project_name", "target_name", "state", "filters", "total_integration_seconds", "session_count", "site"}


def test_share_links_lifecycle(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    url = f"/api/projects/{p['id']}/share"
    a = ok(call(base, "POST", url, key, {"expires_at": None}), 201)
    assert re.fullmatch(r"[A-Za-z0-9_-]{32,}", a["token"]) and a["url"] == f"/s/{a['token']}"
    assert ok(call(base, "GET", f"/api/shared/{a['token']}"), 200)["project_name"] == p["name"]
    assert ok(call(base, "GET", url, key), 200)["token"] == a["token"]
    for m in ("POST", "PUT", "PATCH", "DELETE"):
        r = call(base, m, f"/api/shared/{a['token']}", None, {"project_name": "hacked"})
        assert r.status_code == 405 and r.json() == {"error": {"code": "read_only", "message": READ_ONLY}}
    assert get_project(base, key, p["id"])["name"] == p["name"]
    err(call(base, "GET", "/api/me", a["token"]), 401, "unauthenticated")
    b = ok(call(base, "POST", url, key, {"expires_at": None}), 201)
    assert b["token"] != a["token"]
    err(call(base, "GET", f"/api/shared/{a['token']}"), 404, "not_found")
    ok(call(base, "GET", f"/api/shared/{b['token']}"), 200)
    assert call(base, "DELETE", url, key).status_code == 204
    err(call(base, "GET", f"/api/shared/{b['token']}"), 404, "not_found")
    err(call(base, "GET", url, key), 404, "not_found")
    err(call(base, "DELETE", url, key), 404, "not_found")
    e = err(call(base, "POST", url, key, {"expires_at": "2020-01-01T00:00:00Z"}), 422, "validation")
    assert "expires_at" in e["error"]["fields"]
    now = at(tonight(base, key)["server_time"])
    c = ok(call(base, "POST", url, key, {"expires_at": (now + timedelta(seconds=STALE_SHORT_S)).strftime("%Y-%m-%dT%H:%M:%SZ")}), 201)
    ok(call(base, "GET", f"/api/shared/{c['token']}"), 200)
    poll(lambda: call(base, "GET", f"/api/shared/{c['token']}"), lambda r: r.status_code == 404,
         lambda r: f"expired link still answers {r.status_code}")


SHARE_CASES = {"seed-site": (52.2053, 0.1218), "southwest-halves": (-33.75, -70.25), "near-zero": (0.2, -0.2)}


@pytest.mark.parametrize("case", list(SHARE_CASES), ids=list(SHARE_CASES))
def test_shared_body_fields(browser, app_url, case):
    base = base_of(app_url)
    lat, lon = SHARE_CASES[case]
    ws = workspace(base, site=(lat, lon, 15, "Europe/London"), label=SECRET_LABEL)
    key = ws["key"]
    p = project(base, key)
    logged_session(base, key, p["id"], notes="Oak blocked the east until 22:40.")
    tok = ok(call(base, "POST", f"/api/projects/{p['id']}/share", key, {"expires_at": None}), 201)["token"]
    r = call(base, "GET", f"/api/shared/{tok}")
    body = ok(r, 200)
    assert set(body) == SHARED_KEYS and set(body["site"]) == {"latitude", "longitude"}
    assert f"{body['site']['latitude']:.1f}" == grid(lat) and f"{body['site']['longitude']:.1f}" == grid(lon)
    for leak in ("Oak blocked", SECRET_LABEL, str(lat), str(lon)):
        assert leak not in r.text
    proj = get_project(base, key, p["id"])
    assert body["filters"] == proj["filters"] and body["session_count"] == 1
    with open_app(browser, base + f"/s/{tok}") as page:
        see(page, page.get_by_role("heading", level=1), p["name"], "shared heading")
        see(page, page.get_by_role("table", name="Integration summary", exact=True), "Ha", "summary table")
        eventually(page, lambda: page.get_by_text(f"Imaged from near {grid(lat)}, {grid(lon)}").is_visible(), lambda: "site line")
        html = page.content()
        shown = html if abs(lat) >= 1 else page.locator("body").inner_text()
        assert "Oak blocked" not in html and SECRET_LABEL not in html and str(lat) not in shown
        assert page.get_by_role("navigation", name="Main").count() == 0


def test_wf_sharing_happy(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    with unlocked(browser, base, key, f"/projects/{p['id']}") as page:
        click(page.get_by_role("button", name="Share", exact=True))
        dlg = page.get_by_role("dialog", name="Share project", exact=True)
        click(dlg.get_by_role("button", name="Create link", exact=True))
        upd = page.get_by_role("status", name="Project updates", exact=True)
        see(page, upd, "Share link ready.", "created")
        box_ = dlg.get_by_role("textbox", name="Share link", exact=True)
        eventually(page, lambda: "/s/" in box_.input_value(), lambda: "no share link shown")
        link = "/s/" + re.search(r"/s/([A-Za-z0-9_-]+)", box_.input_value()).group(1)
        with open_app(browser, base + link) as friend:
            see(friend, friend.get_by_role("heading", level=1), p["name"], "friend heading")
            click(dlg.get_by_role("button", name="Revoke link", exact=True))
            see(page, upd, "Share link revoked.", "revoked")
            friend.reload()
            eventually(friend, lambda: friend.get_by_text(SHARE_GONE, exact=True).is_visible(), lambda: "unavailable copy")
    err(call(base, "GET", f"/api/shared/{link[3:]}"), 404, "not_found")
    err(call(base, "POST", f"/api/projects/{p['id']}/share", workspace(base)["key"], {"expires_at": None}), 404, "not_found")


def test_wf_sharing_regenerate(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    old = ok(call(base, "POST", f"/api/projects/{p['id']}/share", key, {"expires_at": None}), 201)
    with unlocked(browser, base, key, f"/projects/{p['id']}") as page:
        click(page.get_by_role("button", name="Share", exact=True))
        dlg = page.get_by_role("dialog", name="Share project", exact=True)
        click(dlg.get_by_role("button", name="Regenerate link", exact=True))
        see(page, page.get_by_role("status", name="Project updates", exact=True),
            "New share link ready. The old link no longer works.", "regenerated")
        with open_app(browser, base + old["url"]) as friend:
            eventually(friend, lambda: friend.get_by_text(SHARE_GONE, exact=True).is_visible(), lambda: "old link alive")
    new = ok(call(base, "GET", f"/api/projects/{p['id']}/share", key), 200)
    assert new["token"] != old["token"] and ok(call(base, "GET", f"/api/shared/{new['token']}"), 200)


def go_message(ws, pl):
    cw, b = pl["clear_window"], pl["best"]
    return (f"{ws['label']} near {grid(ws['lat'])}, {grid(ws['lon'])}: {b['target_name']} in {b['filter']}, "
            f"clear window {hhmm(cw['start'])}-{hhmm(cw['end'])}, {b['usable_minutes']} usable minutes.")


def test_verdict_push_ntfy(app_url, ntfy):
    base = base_of(app_url)
    tp = topic()
    ws, key, d, n, p = plan_setup(base, push_topic=tp)
    pl = plan(base, key, d)
    msgs = ntfy.messages(tp, expected=1, timeout=REAL_WAIT_S)
    assert len(msgs) == 1 and msgs[0]["title"] == f"Darkframe: go for {d}" and msgs[0]["message"] == go_message(ws, pl)
    assert "telescope" in msgs[0].get("tags", [])
    put_conditions(base, key, d, lambda i, h: CLOUDY)
    msgs = ntfy.messages(tp, expected=2, timeout=REAL_WAIT_S)
    assert msgs[1]["title"] == f"Darkframe: no-go for {d}"
    assert msgs[1]["message"] == f"{ws['label']} near {grid(ws['lat'])}, {grid(ws['lon'])}: no clear window of 60 minutes."
    put_conditions(base, key, d, lambda i, h: {**CLOUDY, "seeing": 4})
    assert len(ntfy.messages(tp, expected=3, timeout=15)) == 2, "an unchanged verdict pushed again"
    pushes = ok(call(base, "GET", "/api/pushes", key), 200)["pushes"]
    assert [x["title"] for x in pushes] == [f"Darkframe: no-go for {d}", f"Darkframe: go for {d}"]
    assert all(x["status"] == "sent" and x["sent_at"].endswith("Z") and x["attempts"] >= 1 and x["kind"] == "verdict" for x in pushes)
    ws2, key2, d2, _, _ = plan_setup(base)
    put_conditions(base, key2, d2, lambda i, h: CLOUDY)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        assert ok(call(base, "GET", "/api/pushes", key2), 200)["pushes"] == [], "a push was created without a topic"


def test_wf_pushes_happy(browser, app_url, ntfy):
    base = base_of(app_url)
    tp = topic()
    ws = workspace(base, push_topic=tp, label="Back garden")
    key = ws["key"]
    d, n = dark_night(base, key)
    p = project(base, key, allot={"Ha": HA_PLANNED})
    logged_session(base, key, p["id"], notes="Dew heater on 3.")
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        click(page.get_by_role("button", name="Add target", exact=True))
        dlg = page.get_by_role("dialog", name="Add target to plan", exact=True)
        click(dlg.get_by_role("option", name=f"{p['target_name']} ({p['name']})", exact=True))
        click(dlg.get_by_role("button", name="Add to plan", exact=True))
        put_conditions(base, key, d, lambda i, h: CLEAR)
        msgs = ntfy.messages(tp, expected=1, timeout=REAL_WAIT_S)
        page.goto(base + "/site")
        log = page.get_by_role("region", name="Pushes", exact=True).get_by_role("table", name="Push log", exact=True)
        see(page, log, f"Darkframe: go for {d}", "push log row")
    body = json.dumps(msgs)
    assert "Dew heater" not in body and str(SITE_INES[0]) not in body and str(SITE_INES[1]) not in body
    assert f"near {grid(SITE_INES[0])}, {grid(SITE_INES[1])}" in msgs[0]["message"]


def test_push_outage_unsent_retry(ntfy):
    base = instance("APP_NTFY_DOWN_URL")
    tp = topic()
    ws, key, d, n, p = plan_setup(base, push_topic=tp)
    pushes = poll(lambda: ok(call(base, "GET", "/api/pushes", key), 200)["pushes"],
                  lambda ps: ps and ps[0]["status"] == "unsent" and ps[0]["attempts"] >= 2,
                  lambda ps: f"no retried unsent push: {ps}")
    assert pushes[0]["sent_at"] is None and pushes[0]["title"] == f"Darkframe: go for {d}"
    assert plan(base, key, d)["verdict"] == "go"
    s = logged_session(base, key, p["id"])
    assert s["state"] == "logged"
    h = ok(call(base, "GET", "/api/health"), 200)
    assert h["status"] == "ok" and h["dependencies"]["ntfy"] == "down"
    assert ntfy.messages(tp, expected=1, timeout=5) == []
    later = ok(call(base, "GET", "/api/pushes", key), 200)["pushes"]
    assert len(later) == 1 and later[0]["attempts"] >= pushes[0]["attempts"]


def test_wf_pushes_outage_ui(browser):
    base = instance("APP_NTFY_DOWN_URL")
    ws, key, d, n, p = plan_setup(base, push_topic=topic())
    poll(lambda: ok(call(base, "GET", "/api/pushes", key), 200)["pushes"], lambda ps: ps and ps[0]["status"] == "unsent",
         lambda ps: f"push never unsent: {ps}")
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        see(page, card(page), UNSENT, "card push state")
        page.goto(base + "/site")
        see(page, page.get_by_role("table", name="Push log", exact=True), UNSENT, "push log row")
    assert ok(call(base, "GET", "/api/pushes", key), 200)["pushes"][0]["sent_at"] is None


REMINDER_CASES = [("Europe/London", "18:00"), ("Europe/London", "01:30"), ("Pacific/Auckland", "18:00")]


def test_new_moon_occurrences_dst(app_url):
    base = base_of(app_url)
    for tz, wall in REMINDER_CASES:
        ws = workspace(base, site=(-36.8, 174.7, 20, tz) if tz.startswith("Pacific") else SITE_INES)
        key = ws["key"]
        z = ZoneInfo(tz)
        ok(call(base, "PUT", "/api/reminders/new-moon", key, {"enabled": True, "local_time": wall}), 200)
        year = date.fromisoformat(tonight(base, key)["date"]).year
        frm = date(year, 1, 1)
        occ = ok(call(base, "GET", f"/api/reminders/new-moon/occurrences?from={frm}&count={OCCURRENCE_MAX}", key), 200)["occurrences"]
        refs = new_moons_utc(datetime.combine(frm, dtime(0), tzinfo=z).astimezone(timezone.utc), OCCURRENCE_MAX)
        assert len(occ) == OCCURRENCE_MAX
        for o, ref in zip(occ, refs):
            nm = at(o["new_moon_utc"])
            assert abs((nm - ref).total_seconds()) / 60 <= NEW_MOON_TOL_MIN, (o, ref)
            assert o["new_moon_local_date"] == nm.astimezone(z).date().isoformat()
            sat = date.fromisoformat(o["weekend_saturday"])
            assert sat.weekday() == 5 and abs((sat - date.fromisoformat(o["new_moon_local_date"])).days) <= SAT_WINDOW
            want = datetime.combine(sat - timedelta(days=1), dtime.fromisoformat(wall), tzinfo=z).astimezone(timezone.utc)
            assert at(o["remind_utc"]) == want and at(o["remind_local"]) == want
            assert at(o["remind_local"]).utcoffset() == want.astimezone(z).utcoffset()
        r = ok(call(base, "GET", "/api/reminders/new-moon", key), 200)
        assert r["enabled"] is True and r["local_time"] == wall and len(r["upcoming"]) == 3
    for q in ("count=0", f"count={OCCURRENCE_MAX + 1}"):
        err(call(base, "GET", f"/api/reminders/new-moon/occurrences?from=2026-01-01&{q}", key), 422, "validation")
    err(call(base, "GET", "/api/reminders/new-moon/occurrences?from=2026-02-30&count=1", key), 422, "validation")
    err(call(base, "PUT", "/api/reminders/new-moon", key, {"enabled": True, "local_time": "24:00"}), 422, "validation")


def test_wf_reminders_ui_list(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    with unlocked(browser, base, key, "/site") as page:
        cb = page.get_by_role("checkbox", name="New-moon weekend reminder", exact=True)
        if not cb.is_checked():
            click(cb)
        fill(page.get_by_role("textbox", name="Reminder time", exact=True), "01:30")
        click(page.get_by_role("button", name="Save reminder", exact=True))
        see(page, page.get_by_role("status", name="Site updates", exact=True), "Reminder saved.", "saved")
        r = ok(call(base, "GET", "/api/reminders/new-moon", key), 200)
        assert r["enabled"] is True and r["local_time"] == "01:30"
        lst = page.get_by_role("list", name="Upcoming reminders", exact=True)
        for o in r["upcoming"]:
            see(page, lst, f"{o['remind_local'][:10]} {hhmm(o['remind_local'])} before the new moon of {o['new_moon_local_date']}", "upcoming item")


def test_wf_reminders_time_change(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    ok(call(base, "PUT", "/api/reminders/new-moon", key, {"enabled": True, "local_time": "18:00"}), 200)
    with unlocked(browser, base, key, "/site") as page:
        fill(page.get_by_role("textbox", name="Reminder time", exact=True), "01:30")
        click(page.get_by_role("button", name="Save reminder", exact=True))
        see(page, page.get_by_role("status", name="Site updates", exact=True), "Reminder saved.", "saved")
        lst = page.get_by_role("list", name="Upcoming reminders", exact=True)
        eventually(page, lambda: lst.get_by_role("listitem").count() == 3 and all(
            " 18:00 " not in text(lst.get_by_role("listitem").nth(i)) for i in range(3)), lambda: f"list {text(lst)!r}")
    assert ok(call(base, "GET", "/api/reminders/new-moon", key), 200)["local_time"] == "01:30"


def test_health_and_request_id(app_url):
    base = base_of(app_url)
    r = call(base, "GET", "/api/health")
    h = ok(r, 200)
    assert h["status"] == "ok" and h["version"] == "1.0.0"
    assert set(h["services"]) == {"gateway", "sky-engine", "ledger", "push-dispatcher"}
    for name in ("gateway", "sky-engine", "ledger"):
        assert h["services"][name]["status"] == "ok" and h["services"][name]["version"] == "1.0.0"
    assert set(h["dependencies"]) == {"postgres", "minio", "ntfy"} and h["dependencies"]["postgres"] == "ok"
    assert call(base, "GET", "/internal/health").status_code == 404
    port = int(os.environ.get("APP_PUBLIC_PORT") or urlparse(base).port)
    for name, off in INTERNAL_OFFSETS.items():
        ih = httpx.get(f"http://127.0.0.1:{port + off}/internal/health", timeout=HTTP_TIMEOUT)
        assert ih.status_code == 200 and ih.json() == {"name": name, "version": "1.0.0", "status": "ok"}, (name, ih.text)
    assert call(base, "GET", "/api/health", headers={"X-Request-Id": REQUEST_ID}).headers.get("x-request-id") == REQUEST_ID
    assert call(base, "GET", "/api/me", headers={"X-Request-Id": REQUEST_ID}).headers.get("x-request-id") == REQUEST_ID
    gen = call(base, "GET", "/api/health", headers={"X-Request-Id": "short"}).headers.get("x-request-id")
    assert gen and gen != "short"
    assert call(base, "GET", "/plan").headers.get("x-request-id")


def served_assets(base, cookie=None):
    h = {"Cookie": f"{COOKIE}={cookie}"} if cookie else {}
    out, seen, queue = {}, set(), ["/unlock", "/plan", "/site", "/library"]
    while queue and len(seen) < 60:
        path = queue.pop(0)
        if path in seen:
            continue
        seen.add(path)
        r = httpx.get(base + path, headers=h, timeout=HTTP_TIMEOUT, follow_redirects=True)
        if r.status_code != 200:
            continue
        out[path] = r.text
        for ref in re.findall(r"""(?:src|href)\s*=\s*["']([^"']+)["']|from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']""", r.text):
            ref = next(x for x in ref if x)
            u = urlparse(urljoin(base + path, ref))
            if u.netloc == urlparse(base).netloc and u.path.endswith((".js", ".mjs", ".css")):
                queue.append(u.path)
    return out


def test_server_boundary(app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    exact = json.dumps({"label": "Rooftop", "pad": ""}).encode()
    exact = json.dumps({"label": "Rooftop", "pad": "x" * (JSON_LIMIT - len(exact))}).encode()
    assert len(exact) == JSON_LIMIT
    ok(call(base, "PATCH", "/api/site", key, content=exact, ctype="application/json"), 200)
    over = exact[:-2] + b'x"}'
    assert len(over) == JSON_LIMIT + 1
    err(call(base, "PATCH", "/api/site", key, content=over, ctype="application/json"), 413, "too_large")
    err(call(base, "PATCH", "/api/site", None, content=over, ctype="application/json"), 413, "too_large")
    err(call(base, "PATCH", "/api/site", key, content=b"label=x", ctype="text/plain"), 415, "unsupported_media_type")
    err(call(base, "PATCH", "/api/site", None, content=b"label=x", ctype="text/plain"), 415, "unsupported_media_type")
    r = call(base, "PATCH", "/api/site", key, {"label": EVIL_LABEL}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and r.json() == {"error": {"code": "cross_origin", "message": CROSS_ORIGIN}}
    assert CORS_HEADER not in {k.lower() for k in r.headers}
    assert ok(call(base, "GET", "/api/site", key), 200)["label"] != EVIL_LABEL
    ok(call(base, "PATCH", "/api/site", key, {"label": "Home"}, headers={"Origin": base}), 200)
    for path in ("/run.json", "/.env", "/.venv/pyvenv.cfg", "/.git/HEAD", "/requirements.txt", "/THIRD_PARTY_NOTICES.md"):
        assert call(base, "GET", path).status_code == 404, path
    cookie = re.search(rf"{COOKIE}=([^;]*)", call(base, "POST", "/api/unlock", None, {"key": key}).headers["set-cookie"]).group(1)
    secrets = [os.environ.get(n, "") for n in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "NTFY_PASSWORD")]
    secrets.append(urlparse(os.environ.get("DATABASE_URL", "")).password or "")
    secrets = [s for s in secrets if len(s) >= 6]
    blobs = list(served_assets(base, cookie).values()) + [call(base, "GET", "/api/health").text]
    for s in secrets:
        assert not any(s in b for b in blobs), "a credential value appears in a served file or response"


def test_wf_cross_cutting_outage_boot():
    base = instance("APP_NTFY_DOWN_URL")
    h = ok(call(base, "GET", "/api/health"), 200)
    assert h["status"] == "ok" and h["dependencies"]["ntfy"] == "down"
    ws, key, d, n, p = plan_setup(base)
    assert plan(base, key, d)["verdict"] == "go"
    assert ok(call(base, "GET", "/api/calibration-sets", key), 200)["calibration_sets"] == []


def test_keyboard_dialogs_and_shortcuts(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base)
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        add = page.get_by_role("button", name="Add target", exact=True)
        ready(add).focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Add target to plan", exact=True)
        eventually(page, lambda: not gone(dlg), lambda: "Enter did not open the dialog")
        for k in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(k)
            assert dlg.evaluate("d => d.contains(document.activeElement)"), f"focus left the dialog after {k}"
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(dlg) and focused(add), lambda: "Escape did not close and return focus")
        click(page.get_by_role("button", name="Enter sky conditions", exact=True))
        sky = page.get_by_role("dialog", name="Sky conditions", exact=True)
        for k in ["Shift+Tab"] * 3 + ["Tab"] * 3:
            page.keyboard.press(k)
            assert sky.evaluate("d => d.contains(document.activeElement)"), "focus escaped the conditions dialog"
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(sky), lambda: "Escape did not close conditions")
        ready(page.get_by_role("button", name="Tonight", exact=True)).focus()
        page.keyboard.press("a")
        eventually(page, lambda: not gone(dlg), lambda: "A did not open Add target to plan from a button")
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(dlg), lambda: "dialog stayed")
        ready(add).focus()
        page.keyboard.press("]")
        want_slider(page, STEP_SMALL, "] from a button")
        ready(dome(page)).focus()
        page.keyboard.press("]")
        want_slider(page, 2 * STEP_SMALL, "] from the dome")
        page.keyboard.press("[")
        want_slider(page, STEP_SMALL, "[ from the dome")
        ready(page.get_by_role("textbox", name="Observing date", exact=True)).focus()
        page.keyboard.press("]")
        advance(page, 1000)
        assert sval(page) == STEP_SMALL, "] fired inside a text box"
        page.get_by_role("spinbutton", name="Minimum altitude", exact=True).focus()
        page.keyboard.press("a")
        advance(page, 500)
        assert gone(dlg), "A fired inside a spin button"
        page.goto(base + "/sessions")
        ready(page.get_by_role("checkbox", name="Show trashed", exact=True)).focus()
        page.keyboard.press("n")
        eventually(page, lambda: not gone(page.get_by_role("dialog", name="New session", exact=True)), lambda: "N did not open New session")


def test_wf_cross_cutting_keyboard_only(browser, app_url):
    base = base_of(app_url)
    ws = workspace(base)
    key = ws["key"]
    p = project(base, key)
    with unlocked(browser, base, key, "/sessions") as page:
        ready(page.get_by_role("checkbox", name="Show trashed", exact=True)).focus()
        page.keyboard.press("n")
        dlg = page.get_by_role("dialog", name="New session", exact=True)
        eventually(page, lambda: not gone(dlg), lambda: "N did not open New session")
        select(dlg.get_by_role("combobox", name="Project", exact=True), p["name"])
        ready(dlg.get_by_role("textbox", name="Observing date", exact=True)).focus()
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type("2026-10-14")
        ready(dlg.get_by_role("button", name="Create session", exact=True)).focus()
        page.keyboard.press("Enter")
        see(page, page.get_by_role("status", name="Session log", exact=True), "Session created for 2026-10-14.", "created")
    assert [s["observing_date"] for s in ok(call(base, "GET", f"/api/sessions?project_id={p['id']}", key), 200)["sessions"]] == ["2026-10-14"]


DECLARED_MOTION_JS = """e => { const ms = s => s.split(',').map(x => parseFloat(x) * (x.trim().endsWith('ms') ? 1 : 1000) || 0);
  let best = 0;
  for (const n of [e, ...e.querySelectorAll('*')]) {
    const c = getComputedStyle(n);
    for (const [d, l] of [[ms(c.transitionDuration), ms(c.transitionDelay)], [ms(c.animationDuration), ms(c.animationDelay)]])
      d.forEach((v, i) => { if (v > 0) best = Math.max(best, v + (l[i % l.length] || 0)); });
  }
  return best; }"""


def css_motion_ms(locator) -> float:
    return max([locator.evaluate(DECLARED_MOTION_JS), *(a["duration"] for a in animations(locator))])


def settle_ms(path, total_ms):
    pts = [{k: round(v, 1) for k, v in pt.items() if k not in ("t", "time", "dt")} for pt in path]
    ts = [pt.get("t", pt.get("time", total_ms * i / max(1, len(path) - 1))) for i, pt in enumerate(path)]
    i = len(pts) - 1
    while i > 0 and pts[i - 1] == pts[-1]:
        i -= 1
    return pts, ts[i] - ts[0]


def test_motion_timing(browser, app_url):
    base = base_of(app_url)
    ws, key, d, n, p = plan_setup(base)
    with unlocked(browser, base, key, f"/plan?date={d}") as page:
        see_all(page, card(page), card_lines(plan(base, key, d, 0)), "card painted from the plan")
        settle(card(page))
        before = decode(capture(card(page)))
        advance(page, 3000)
        assert difference(before, decode(capture(card(page)))) == 0, "the verdict card changed while idle"
        click(page.get_by_role("button", name="Add target", exact=True))
        dlg = page.get_by_role("dialog", name="Add target to plan", exact=True)
        soon(dlg).to_be_visible()
        ms = css_motion_ms(dlg)
        if ms <= 0:
            pts, ms = settle_ms(motion(dlg, 1000), 1000)
            assert pts[0] != pts[-1], "the dialog does not fade or rise into place"
        assert ms < DIALOG_MAX_MS, f"the dialog settled after {ms} ms"
    with unlocked(browser, base, key, f"/plan?date={d}", reduced_motion="reduce") as page:
        click(page.get_by_role("button", name="Add target", exact=True))
        dlg = page.get_by_role("dialog", name="Add target to plan", exact=True)
        soon(dlg).to_be_visible()
        ms = css_motion_ms(dlg)
        assert ms <= REDUCED_MOTION_MAX_MS, f"the dialog animates for {ms} ms under reduced motion"
        if ms <= 0:
            pts, _ = settle_ms(motion(dlg, 1000), 1000)
            assert all(pt == pts[-1] for pt in pts), "the dialog moves under reduced motion"
        assert animations(dlg) == []


APP = Path("/app")
ALLOWLIST = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "PSF-2.0", "OFL-1.1"}


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_notices_list_shipped():
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text().lower()
    missing = [p.name for p in shipped_packages() if p.name.lower() not in notes]
    assert not missing, f"packages missing from notices: {missing}"
    assert "three" in notes and SORA in notes


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad


def test_if_no_extra_datastore():
    hits = []
    for root in (APP, Path(DEPLOYED_APP)):
        for f in root.rglob("*"):
            if ".venv" in f.parts or ".git" in f.parts:
                continue
            if f.suffix in (".sqlite", ".sqlite3", ".db") or f.name == "dump.rdb":
                hits.append(str(f))
    assert not hits, hits
    req = (APP / "requirements.txt").read_text().lower() if (APP / "requirements.txt").exists() else ""
    assert NO_REDIS not in req


def test_if_same_origin_assets(app_url):
    base = base_of(app_url)
    host = urlparse(base).netloc
    foreign = re.compile(r"""(?:src|href)\s*=\s*["']((?:https?:)?//[^"']+)|(?:from|import\()\s*["']((?:https?:)?//[^"']+)|url\(\s*["']?((?:https?:)?//[^"')]+)""")
    bad = []
    for path, body in served_assets(base).items():
        for m in foreign.findall(body):
            u = next(x for x in m if x)
            if urlparse(u if not u.startswith(PROTO_RELATIVE) else "http:" + u).netloc != host:
                bad.append((path, u))
    assert not bad, bad


def test_if_venv_manifest_tools():
    m = json.loads((APP / "run.json").read_text())
    assert ".venv" in m["install"]
    for k in ("build", "serve"):
        first = m[k].split()[0]
        assert first.startswith(".venv/bin/") or " -m " in m[k], (k, m[k])
    assert (Path(DEPLOYED_APP) / ".venv" / "bin" / "python").exists()


def test_if_services_untouched():
    assert Postgres().rows("SELECT 1 AS one") == [{"one": 1}]
    assert isinstance(S3().keys("calibration/"), list)
