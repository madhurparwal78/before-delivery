import contextlib
import hashlib
import json
import os
import random
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

import conftest
from conftest import (
    S3,
    addresses,
    advance,
    animations,
    check,
    click,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    select,
    shipped_packages,
    tab_order,
    tap,
    text,
)

APP = Path("/app")
PORT_ZONE = ZoneInfo("America/Halifax")
PASSWORD = "Slackwater-2026"
DISPATCH1 = "dispatch1@ebbstone.example"
DISPATCH2 = "dispatch2@ebbstone.example"
CLERK = "accounts@ebbstone.example"
CORV_AGENT = "agent@corvane.example"
TIDE_AGENT = "agent@tidewell.example"
AUTHORITY = "harbourmaster@port-ansell.example"
NOT_FOUND = {"error": "not_found", "message": "Not found"}
VESSELS = {
    "V-01": {"name": "Tern Arrow", "speed": 10, "draught_m": 11.2, "draught_mm": 11200, "gt": 43500},
    "V-02": {"name": "Kestrel Bay", "speed": 9, "draught_m": 7.6, "draught_mm": 7600, "gt": 12400},
    "V-03": {"name": "Halcyon Reef", "speed": 10, "draught_m": 9.8, "draught_mm": 9800, "gt": 28900},
    "V-04": {"name": "Marram Light", "speed": 9, "draught_m": 12.9, "draught_mm": 12900, "gt": 71200},
}
WAYPOINT_NAMES = ["Outer Bar", "Gannet Shoal", "Narrows Sill", "Mid Reach", "Kettle Bend", "Inner Sill"]
SPEED_LIMITS = [None, None, 8, None, 7, 7]
TERN_LEG_SPEEDS = [10, 10, 8, 10, 7, 7]
TERN_SQUATS = [800, 800, 1024, 800, 784, 784]
TERN_REQUIRED_MM = 1120
NARROWS_CLEARANCE_MM = 1134
NARROWS_MARGIN_MM = 14
NARROWS_CLOSED_MM = -107
INNER_MARGIN_MM = 53
INNER_CLOSED_MM = -74
OUTER_TIDE_STD_MM = 8440
OUTER_TIDE_FALL_MM = 8730
OUTER_TIDE_SPRING_MM = 7984
DRAFT_FOOT_CENTS = 4250
MINIMUM_CENTS = 200000
BANDS = [(0, 9999, 48000), (10000, 29999, 86000), (30000, 59999, 134000), (60000, None, 192500)]
NIGHT_PERCENT = 25
CANCELLATION_CENTS = 38000
DETENTION_HALF_HOUR_CENTS = 16500
MV1009_LINES = [("Draft foot", 157250), ("Tonnage band", 134000), ("Night surcharge", 72813)]
MV1009_TOTAL = 364063
KESTREL_DAY = [("Draft foot", 106250), ("Tonnage band", 86000), ("Minimum charge", 7750)]
KESTREL_DAY_TOTAL = 200000
KESTREL_NIGHT_TOTAL = 250000
KESTREL_NIGHT_CENTS = 50000
JSON_LIMIT = 65536
PHOTO_LIMIT = 5000000
TOUCH_MIN_PX = 44
BOARD_REFRESH_MS = 10000
MOVE_REREAD_MS = 30000
SERVICE_REFRESH_MS = 15000
V01_PILOTS = ("P-01", "P-04", "P-09", "P-02", "P-05", "P-06", "P-07")
SHORT_UNIT_SECONDS = 6
HTTP_TIMEOUT = 60
UI_WAIT_S = 40
UI_ACTION_MS = 5000
PROVIDER_WAIT_S = 120
SERVICE_WAIT_S = 60
COPY_BOOT_S = 180
SLOT_BASE_DAYS = 20
FIXED_DAYS = 450
EFFECTIVE_DAYS = 500
UI_REVISION_DAYS = 2500
HEAD_DAYS = 700
EXPORT_DAYS = 4500
RNG = random.Random()
UNKNOWN_REF = "MV-NOPE"
ORDERED_SEED = "MV-1001"
AWAY_SEED = "MV-1005"
TERN_ON_BOARD = "MV-1007"
KESTREL_ON_BOARD = "MV-1008"
COMPLETED_SEED = "MV-1009"
OWN_VESSEL = "V-01"
FOREIGN_VESSEL = "V-03"
SUBJECT_CONFIRMED = "Pilot order confirmed: <vessel>"
SUBJECT_CANCELLED = "Pilot order cancelled: <vessel>"
CSV_HEADER = "ref,vessel,agency,status,boarding_at,pinch_waypoint,margin_mm,tariff_revision,total_cents"
CSV_FORMULA_CELL = '"\'=HYPERLINK(""x"",""y"")"'
CRLF = "\r\n"
VALUE_TEXT = "aria-valuetext"
KEY_RIGHT = "ArrowRight"
KEY_LEFT = "ArrowLeft"
KEY_DOWN = "ArrowDown"
KEY_PAGE_UP = "PageUp"
KEY_HEADER = "Idempotency-Key"
SET_COOKIE = "Set-Cookie"
PHOTO_FILE = "ladder.png"
MISLABELLED_FILE = "ladder.jpg"
MISLABELLED_BYTES = b"not an image at all"
RELAY_BUCKET_SUFFIX = "-relay"


def subject_for(template, vessel):
    return template.replace("<vessel>", vessel)


def port_time(hhmm):
    return f"{hhmm} port time"


def open_window(a, b):
    return f"Open window {a} to {b}"


def status_copy(s):
    return f"Status now {s}"


def count_copy(n):
    return f"{n} moves shown"


def matches_copy(template, s):
    head, rest = template.split("<", 1)
    tail = rest.split(">", 1)[1]
    s = s.strip()
    if not (s.startswith(head) and s.endswith(tail) and len(s) > len(head) + len(tail)):
        return False
    return " " not in s[len(head):len(s) - len(tail)]


def api(base):
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)


def client(base, email, password=PASSWORD):
    c = api(base)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, f"POST /api/session for {email}: {r.status_code} {r.text}"
    return c


def keyed(c, path, body, key=None, headers=None):
    return c.post(path, json=body, headers={"Idempotency-Key": key or idempotency_key(), **(headers or {})})


def par(*fns):
    with ThreadPoolExecutor(max_workers=len(fns)) as ex:
        return [f.result() for f in [ex.submit(fn) for fn in fns]]


def port_info(base):
    r = api(base).get("/api/port")
    assert r.status_code == 200, r.text
    return r.json()


def store_day(base):
    return date.fromisoformat(port_info(base)["store_date"])


def server_now(base):
    return datetime.fromisoformat(port_info(base)["now"]).replace(tzinfo=PORT_ZONE)


def changeover(d):
    a = datetime(d.year, d.month, d.day, 0, 30, tzinfo=PORT_ZONE).utcoffset()
    b = datetime(d.year, d.month, d.day, 23, 30, tzinfo=PORT_ZONE).utcoffset()
    return a != b


def free_day(d):
    for _ in range(3):
        if not (changeover(d) or changeover(d - timedelta(days=1))):
            return d
        d += timedelta(days=1)
    return d


def slot_day(base, slot):
    return free_day(store_day(base) + timedelta(days=SLOT_BASE_DAYS + 3 * slot))


def rand_day(base, lo, span):
    return free_day(store_day(base) + timedelta(days=lo + 3 * RNG.randrange(span)))


def metres(mm):
    v = (abs(mm) + 5) // 10
    return f"{'+' if mm >= 0 else '-'}{v // 100}.{v % 100:02d}"


def feet(mm):
    q = (abs(mm) * 80 + 254) // 508
    inches, frac = divmod(q % 48, 4)
    return f"{'-' if mm < 0 else ''}{q // 48} ft {inches}{['', '.25', '.5', '.75'][frac]} in"


def money(cents):
    return f"{cents // 100:,}.{cents % 100:02d}"


def half_up_percent(cents, percent):
    return (cents * percent * 2 + 100) // 200


def seed_lines(draught_mm, gt, hhmm):
    foot = -(-draught_mm * 10 // 3048)
    band = next(c for lo, hi, c in BANDS if gt >= lo and (hi is None or gt <= hi))
    lines = [("Draft foot", foot * DRAFT_FOOT_CENTS), ("Tonnage band", band)]
    s = sum(a for _, a in lines)
    if s < MINIMUM_CENTS:
        lines.append(("Minimum charge", MINIMUM_CENTS - s))
    hour = int(hhmm[:2])
    if hour >= 22 or hour < 6:
        lines.append(("Night surcharge", half_up_percent(sum(a for _, a in lines), NIGHT_PERCENT)))
    return lines


def pilot_email(pid):
    return f"p{pid.split('-')[1]}@ebbstone.example"


def order(agent, vessel, day, hhmm, duty=300):
    v = VESSELS[vessel]
    r = keyed(agent, "/api/moves", {"vessel_id": vessel, "boarding_at": f"{day}T{hhmm}", "speed_kn": v["speed"],
                                    "duty_minutes": duty, "draught_m": v["draught_m"]})
    assert r.status_code == 201, f"POST /api/moves: {r.status_code} {r.text}"
    return r.json()["ref"]


def move(c, ref):
    r = c.get(f"/api/moves/{ref}")
    assert r.status_code == 200, f"GET /api/moves/{ref}: {r.status_code} {r.text}"
    return r.json()


def tagged(c, ref):
    r = c.get(f"/api/moves/{ref}")
    assert r.status_code == 200 and r.headers.get("etag"), f"GET move {ref} with ETag: {r.status_code}"
    return r.headers["etag"], r.json()


def plan_at(c, ref, at):
    r = c.get(f"/api/moves/{ref}/plan", params={"boarding_at": at})
    assert r.status_code == 200, f"GET plan {ref} {at}: {r.status_code} {r.text}"
    return r.json()


def commit(disp, ref, day, hhmm, etag=None):
    tag, mv = tagged(disp, ref)
    pl = plan_at(disp, ref, f"{day}T{hhmm}")
    return disp.post(f"/api/moves/{ref}/commit", headers={"If-Match": etag or tag},
                     json={"boarding_at": f"{day}T{hhmm}", "tide_version": pl["tide_version"], "draught_mm": mv["draught_mm"]})


def committed(disp, ref, day, hhmm):
    r = commit(disp, ref, day, hhmm)
    assert r.status_code == 200, f"commit {ref} at {day}T{hhmm}: {r.status_code} {r.text}"
    return r.json()


def eligibility(disp, ref):
    r = disp.get(f"/api/moves/{ref}/eligibility")
    assert r.status_code == 200, r.text
    return r.json()


def turn_entry(el, pid):
    return next(t for t in el["turn"] if t["pilot_id"] == pid)


def assign(disp, ref, pid, key=None, etag=None, **extra):
    tag = etag or tagged(disp, ref)[0]
    return keyed(disp, f"/api/moves/{ref}/assignment", {"pilot_id": pid, **extra}, key, {"If-Match": tag})


def assign_next(disp, ref):
    el = eligibility(disp, ref)
    assert el["next_eligible"], f"no next eligible pilot for {ref}: {el}"
    r = assign(disp, ref, el["next_eligible"])
    assert r.status_code == 200, f"assign next eligible to {ref}: {r.status_code} {r.text}"
    return turn_entry(el, el["next_eligible"])


def step(c, ref, to, key=None):
    return keyed(c, f"/api/moves/{ref}/transitions", {"to": to}, key)


def drive(c, ref, *tos):
    for to in tos:
        r = step(c, ref, to)
        assert r.status_code == 200, f"transition {ref} to {to}: {r.status_code} {r.text}"
    return move(c, ref)


def window_from(disp, ref, day, after="00:00"):
    r = disp.get(f"/api/moves/{ref}/windows", params={"date": str(day)})
    assert r.status_code == 200, r.text
    for w in r.json()["windows"]:
        if w["to"] >= after:
            return max(w["from"], after)
    pytest.fail(f"GET windows for {ref} on {day} listed no open step at or after {after}")


def ceil5(dt):
    dt = dt.replace(second=0, microsecond=0) + timedelta(minutes=1)
    return dt + timedelta(minutes=(5 - dt.minute % 5) % 5)


def history_count(mv, status):
    return sum(1 for h in mv["history"] if h["status"] == status)


def bring_to_head(base, disp, target):
    agent = client(base, CORV_AGENT)
    start = rand_day(base, HEAD_DAYS, 1000)
    for i in range(12):
        day = free_day(start + timedelta(days=3 * i))
        ref = order(agent, "V-02", day, "12:00", duty=30)
        committed(disp, ref, day, window_from(disp, ref, day))
        turn = sorted(eligibility(disp, ref)["turn"], key=lambda t: t["position"])
        if turn[0]["pilot_id"] == target:
            keyed(disp, f"/api/moves/{ref}/cancel", {})
            return
        r = assign(disp, ref, turn[0]["pilot_id"])
        assert r.status_code == 200, f"turn shuffle assign {turn[0]['pilot_id']}: {r.status_code} {r.text}"
    pytest.fail(f"could not bring {target} to the head of the turn list")


def soonest_job(base, disp, agent, pilot):
    after = (server_now(base) + timedelta(hours=7)).replace(tzinfo=None)
    horizon = after + timedelta(days=5)
    def unbooked(pid):
        job = client(base, pilot_email(pid)).get("/api/me/next-job").json()["move"]
        return job is None or datetime.fromisoformat(job["boarding_at"]) >= horizon

    chosen = next((pid for pid in dict.fromkeys((pilot, *V01_PILOTS)) if unbooked(pid)), None)
    assert chosen, "every pilot licensed for V-01 already holds a nearer open job"
    bring_to_head(base, disp, chosen)
    ref = order(agent, "V-01", (after + timedelta(days=5)).date(), "12:00", duty=30)
    for k in range(4):
        day = (after + timedelta(days=k)).date()
        if changeover(day):
            continue
        for w in disp.get(f"/api/moves/{ref}/windows", params={"date": str(day)}).json()["windows"]:
            lo = max(datetime.fromisoformat(f"{day}T{w['from']}"), ceil5(after))
            if lo <= datetime.fromisoformat(f"{day}T{w['to']}"):
                hhmm = lo.strftime("%H:%M")
                committed(disp, ref, day, hhmm)
                el = eligibility(disp, ref)
                rest = [r for r in turn_entry(el, chosen)["reasons"] if r in ("rest", "night_rest", "rota_days")]
                extra = {"rest_override_reason": "Immediate safety: the only pilot the station can spare"} if rest else {}
                r = assign(disp, ref, chosen, **extra)
                assert r.status_code == 200, f"assign {chosen} to {ref}: {r.status_code} {r.text}"
                return ref, day, hhmm, chosen
    pytest.fail("no open Tern Arrow window within four days")


def subject(m):
    return m.get("Subject", "")


def recipients(m):
    return [a.lower() for a in addresses(m.get("To"))]


def find_mail(mail, pred, n, what, seconds=PROVIDER_WAIT_S):
    deadline = time.monotonic() + seconds
    found = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages() if pred(m)]
        if len(found) >= n:
            return [m for m in mail.messages(settle=3) if pred(m)]
    pytest.fail(f"Mailpit: expected {n} message(s) {what}, saw {len(found)}")


def kb_invoices(killbill, code, ref):
    acct = killbill.account_by_key(code)
    if not acct:
        return []
    out = []
    for inv in killbill.invoices(acct["accountId"]):
        items = [i for i in inv.get("items") or [] if str(i.get("description", "")).startswith(f"{ref} ")]
        if items:
            out.append((inv, items))
    return out


def kb_wait(killbill, code, ref, pred, what):
    deadline = time.monotonic() + PROVIDER_WAIT_S
    got = []
    while time.monotonic() < deadline:
        got = kb_invoices(killbill, code, ref)
        if pred(got):
            return got
    pytest.fail(f"Kill Bill: {what} for {ref}; saw {got}")


def poll(fn, pred, what, seconds=PROVIDER_WAIT_S):
    deadline = time.monotonic() + seconds
    v = None
    while time.monotonic() < deadline:
        v = fn()
        if pred(v):
            return v
    pytest.fail(f"timed out: {what}; last {v}")


@contextlib.contextmanager
def signed_in(browser, base, email, path, size=(1280, 800), **opts):
    with open_app(browser, base + "/login", **opts) as page:
        page.set_default_timeout(UI_ACTION_MS)
        page.set_viewport_size({"width": size[0], "height": size[1]})
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_role("textbox", name="Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait(page, lambda: "/login" not in page.url, f"{email} leaves /login")
        if path:
            page.goto(base + path)
        yield page


def wait(page, cond, what, seconds=UI_WAIT_S):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if cond():
                return
        except Exception:
            pass
        advance(page, 250)
    pytest.fail(f"timed out waiting: {what}")


def equals(page, loc, s):
    wait(page, lambda: loc.inner_text().strip() == s, f"live region reads exactly {s!r}")


def shows(page, loc, s):
    wait(page, lambda: s in loc.inner_text(), f"{s!r} shown")


def status(page, name):
    return page.get_by_role("status", name=name, exact=True)


def inside(loc):
    return loc.evaluate("e => e.contains(document.activeElement)")


def focused(loc):
    return loc.evaluate("e => e === document.activeElement")


def body(page):
    return page.locator("body").inner_text()


RECORD_TEXT = ("(el) => { window.__rec = []; new MutationObserver(() => window.__rec.push(el.textContent.trim()))"
               ".observe(el, {childList: true, subtree: true, characterData: true}); }")
RECORD_PROGRESS = ("(el) => { window.__prog = [[performance.now(), el.getAttribute('data-progress')]];"
                   " new MutationObserver(() => window.__prog.push([performance.now(), el.getAttribute('data-progress')]))"
                   ".observe(el, {attributes: true, attributeFilter: ['data-progress']}); }")
ACTIVE_IS_RADIO = ("() => { const e = document.activeElement;"
                   " return !!e && (e.getAttribute('role') === 'radio' || e.type === 'radio'); }")
DOUBLE_CLICK = "b => { b.click(); b.click(); }"


def tab_to(page, loc, what, presses=60):
    for _ in range(presses):
        if focused(loc):
            return
        page.keyboard.press("Tab")
    pytest.fail(f"Tab never reached {what}")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def pipe(a, b):
    try:
        for _ in range(10_000_000):
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except OSError:
        pass
    finally:
        for s in (a, b):
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)


class Relay:
    def __init__(self, host, port):
        self.target, self.port, self.sock = (host, int(port)), free_port(), None

    def up(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.sock = s
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        for _ in range(100_000):
            try:
                conn, _ = self.sock.accept()
            except (OSError, AttributeError):
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
            except OSError:
                conn.close()
                continue
            for a, b in ((conn, upstream), (upstream, conn)):
                threading.Thread(target=pipe, args=(a, b), daemon=True).start()

    def down(self):
        if self.sock:
            with contextlib.suppress(OSError):
                self.sock.shutdown(socket.SHUT_RDWR)
            self.sock.close()
            self.sock = None


@contextlib.contextmanager
def app_copy(env_over):
    port = free_port()
    deployed = Path(conftest.DEPLOYED_APP)
    serve = json.loads((deployed / "run.json").read_text())["serve"]
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), **env_over)
    log = tempfile.NamedTemporaryFile(delete=False, suffix=".log")
    proc = subprocess.Popen(serve, shell=True, cwd=deployed, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail():
        return Path(log.name).read_text(errors="replace")[-3000:]

    try:
        deadline = time.monotonic() + COPY_BOOT_S
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited: {tail()}")
            with contextlib.suppress(httpx.HTTPError):
                if api(base).get("/api/health").status_code == 200:
                    break
        else:
            pytest.fail(f"app copy never answered /api/health: {tail()}")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=30)


def services(base, email=DISPATCH1):
    return client(base, email).get("/api/services").json()


def test_draught_units(app_url):
    day = slot_day(app_url, 1)
    agent = client(app_url, CORV_AGENT)
    base = {"vessel_id": "V-01", "boarding_at": f"{day}T12:00", "speed_kn": 10, "duty_minutes": 300}
    ft = keyed(agent, "/api/moves", {**base, "draught_ft": 36, "draught_in": 9})
    assert ft.status_code == 201, ft.text
    mm = (36 * 12 + 9) * 254 // 10
    assert ft.json()["draught_mm"] == mm
    assert ft.json()["draught"] == {"metres": f"{mm // 1000}.{mm % 1000:03d}", "feet": feet(mm)}
    for vessel, metres_text, feet_text in (("V-01", "11.200", "36 ft 9 in"), ("V-02", "7.600", "24 ft 11.25 in")):
        mv = move(agent, order(agent, vessel, day, "12:00"))
        assert mv["draught_mm"] == VESSELS[vessel]["draught_mm"]
        assert mv["draught"] == {"metres": metres_text, "feet": feet_text}
    tern_plan = agent.post("/api/plan", json={**base, "draught_m": 11.2}).json()
    assert tern_plan["draught_mm"] == VESSELS["V-01"]["draught_mm"]
    thin = keyed(agent, "/api/moves", {**base, "draught_m": 16.001})
    assert thin.status_code == 422 and thin.json()["errors"]


def test_order_keyed_replay(app_url):
    day = slot_day(app_url, 31)
    agent = client(app_url, CORV_AGENT)
    base = {"vessel_id": "V-01", "boarding_at": f"{day}T12:00", "speed_kn": 10, "duty_minutes": 300}
    key = idempotency_key()
    body = {**base, "draught_m": 11.2}
    first = keyed(agent, "/api/moves", body, key)
    again = keyed(agent, "/api/moves", body, key)
    assert first.status_code == again.status_code == 201
    assert again.json() == first.json()
    key2 = idempotency_key()
    racing = par(*[lambda: keyed(agent, "/api/moves", body, key2)] * 4)
    assert {r.status_code for r in racing} == {201}
    assert len({r.json()["ref"] for r in racing}) == 1
    clash = keyed(agent, "/api/moves", {**body, "boarding_at": f"{day}T12:05"}, key)
    assert clash.status_code == 409 and clash.json()["error"] == "idempotency_conflict"
    a = agent.post("/api/moves", json=body)
    b = agent.post("/api/moves", json=body)
    assert a.status_code == b.status_code == 201 and a.json()["ref"] != b.json()["ref"]

    assert len({first.json()["ref"], *[r.json()["ref"] for r in racing]}) == 2


def test_wf_order_placement_live_form(browser, app_url):
    day = slot_day(app_url, 2)
    with signed_in(browser, app_url, CORV_AGENT, "/orders") as page:
        clear = page.get_by_role("region", name="Order clearances", exact=True)
        ann = status(page, "Order announcements")
        shows(page, clear, "Choose a vessel to see clearances")
        select(page.get_by_role("combobox", name="Vessel", exact=True), "Tern Arrow")
        fill(page.get_by_role("spinbutton", name="Duty minutes", exact=True), "360")
        fill(page.get_by_role("textbox", name="Boarding date", exact=True), str(day))
        when = page.get_by_role("textbox", name="Boarding time", exact=True)
        fill(when, "06:50")
        equals(page, ann, f"Window open, pinch Inner Sill {metres(INNER_MARGIN_MM)} m, estimate $2,912.50 CAD")
        shows(page, clear, "Window open")
        shows(page, clear, "Estimate $2,912.50 CAD")
        fill(when, "06:55")
        equals(page, ann, f"Window closed, pinch Inner Sill {metres(INNER_CLOSED_MM)} m, estimate $2,912.50 CAD")
        shows(page, clear, "Window closed")
        fill(when, "04:30")
        equals(page, ann, f"Window open, pinch Narrows Sill {metres(NARROWS_MARGIN_MM)} m, "
                          f"estimate ${money(MV1009_TOTAL)} CAD")
        shows(page, clear, f"Estimate ${money(MV1009_TOTAL)} CAD")
        assert page.url.endswith("/orders")
        click(page.get_by_role("button", name="Place order", exact=True))
        wait(page, lambda: matches_copy("Order <ref> placed", ann.inner_text()), "Order <ref> placed")
        ref = ann.inner_text().strip().split()[1]
        shows(page, page.locator("body"), ref)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    mv = move(agent, ref)
    assert mv["status"] == "Ordered" and mv["boarding_at"] == f"{day}T04:30" and mv["duty_minutes"] == 360
    assert ref in [m["ref"] for m in agent.get("/api/moves").json()["moves"]]
    assert ref in [m["ref"] for m in disp.get("/api/moves", params={"status": "Ordered"}).json()["moves"]]
    with signed_in(browser, app_url, DISPATCH1, "/board") as board:
        queue = board.get_by_role("region", name="Order queue", exact=True)
        wait(board, lambda: queue.get_by_role("button", name=f"Plan {ref} Tern Arrow", exact=True).count() == 1,
             "placed order in the dispatcher's order queue")


def test_wf_order_placement_place_order(browser, app_url):
    day = slot_day(app_url, 32)
    with signed_in(browser, app_url, CORV_AGENT, "/orders") as page:
        clear = page.get_by_role("region", name="Order clearances", exact=True)
        ann = status(page, "Order announcements")
        select(page.get_by_role("combobox", name="Vessel", exact=True), "Kestrel Bay")
        fill(page.get_by_role("spinbutton", name="Duty minutes", exact=True), "240")
        fill(page.get_by_role("textbox", name="Boarding date", exact=True), str(day))
        fill(page.get_by_role("textbox", name="Boarding time", exact=True), "12:00")
        shows(page, clear, f"Estimate ${money(KESTREL_DAY_TOTAL)} CAD")
        click(page.get_by_role("button", name="Place order", exact=True))
        wait(page, lambda: matches_copy("Order <ref> placed", ann.inner_text()), "Order <ref> placed")
        ref = ann.inner_text().strip().split()[1]
        wait(page, lambda: ref in body(page), "placed order listed on the orders screen")
    agent = client(app_url, CORV_AGENT)
    mv = move(agent, ref)
    assert mv["status"] == "Ordered" and mv["vessel"]["id"] == "V-02" and mv["boarding_at"] == f"{day}T12:00"
    assert mv["agency_code"] == "CORV" and mv["duty_minutes"] == 240
    assert ref in [m["ref"] for m in agent.get("/api/moves", params={"status": "Ordered"}).json()["moves"]]
    foreign = keyed(agent, "/api/moves", {"vessel_id": "V-03", "boarding_at": f"{day}T12:00", "speed_kn": 10,
                                          "duty_minutes": 240, "draught_m": 9.8})
    assert foreign.status_code == 404 and foreign.json() == NOT_FOUND
    with signed_in(browser, app_url, DISPATCH1, "/board") as board:
        queue = board.get_by_role("region", name="Order queue", exact=True)
        wait(board, lambda: queue.get_by_role("button", name=f"Plan {ref} Kestrel Bay", exact=True).count() == 1,
             "placed order in the dispatcher's order queue")


def test_wf_order_placement_latest_plan_wins(browser, app_url):
    day = slot_day(app_url, 3)
    with signed_in(browser, app_url, CORV_AGENT, "/orders") as page:
        clear = page.get_by_role("region", name="Order clearances", exact=True)
        ann = status(page, "Order announcements")
        pass_through, hold, abort = 0, 1, 2
        held, seen, mode = [], [], {"v": pass_through}

        def handler(route):
            seen.append(route.request.url)
            if mode["v"] == hold:
                held.append(route)
            elif mode["v"] == abort:
                route.abort()
            else:
                route.continue_()

        page.route(lambda url: urlparse(url).path == "/api/plan", handler)
        select(page.get_by_role("combobox", name="Vessel", exact=True), "Tern Arrow")
        fill(page.get_by_role("spinbutton", name="Duty minutes", exact=True), "360")
        fill(page.get_by_role("textbox", name="Boarding date", exact=True), str(day))
        when = page.get_by_role("textbox", name="Boarding time", exact=True)
        fill(when, "06:50")
        open_copy = f"Window open, pinch Inner Sill {metres(INNER_MARGIN_MM)} m, estimate $2,912.50 CAD"
        closed_copy = f"Window closed, pinch Inner Sill {metres(INNER_CLOSED_MM)} m, estimate $2,912.50 CAD"
        equals(page, ann, open_copy)
        mode["v"] = hold
        fill(when, "04:30")
        wait(page, lambda: len(held) >= 1, "plan request for 04:30 sent")
        assert ann.inner_text().strip() == open_copy
        assert "Estimate $2,912.50 CAD" in clear.inner_text() and "Window open" in clear.inner_text()
        fill(when, "06:55")
        wait(page, lambda: len(held) >= 2, "plan request for 06:55 sent")
        mode["v"] = pass_through
        with contextlib.suppress(Exception):
            held[-1].continue_()
        equals(page, ann, closed_copy)
        for r in held[:-1]:
            with contextlib.suppress(Exception):
                r.continue_()
        advance(page, 2000)
        assert ann.inner_text().strip() == closed_copy
        assert "Window closed" in clear.inner_text() and f"${money(MV1009_TOTAL)}" not in clear.inner_text()
        before, sent = clear.inner_text(), len(seen)
        click(page.get_by_role("radio", name="Feet and inches", exact=True))
        advance(page, 1500)
        assert len(seen) == sent, "switching Draught units sent a plan request"
        assert clear.inner_text() == before and ann.inner_text().strip() == closed_copy
        expect(page.get_by_role("spinbutton", name="Draught feet", exact=True)).to_have_value("36")
        expect(page.get_by_role("spinbutton", name="Draught inches", exact=True)).to_have_value("9")
        mode["v"] = abort
        fill(when, "06:50")
        equals(page, ann, "Plan unavailable - last values shown")
        assert "Window closed" in clear.inner_text()


def test_plan_formula(app_url):
    day = slot_day(app_url, 4)
    disp, agent, tide = client(app_url, DISPATCH1), client(app_url, CORV_AGENT), client(app_url, TIDE_AGENT)
    port = port_info(app_url)
    assert [w["speed_limit_kn"] for w in port["waypoints"]] == SPEED_LIMITS
    tern = {"vessel_id": "V-01", "speed_kn": 10, "draught_m": 11.2}

    def plan(at):
        r = disp.post("/api/plan", json={**tern, "boarding_at": at})
        assert r.status_code == 200, f"POST /api/plan {at}: {r.text}"
        return r.json()

    p = plan(f"{day}T04:30")
    wps = p["waypoints"]
    assert [w["name"] for w in wps] == WAYPOINT_NAMES
    assert [w["leg_speed_kn"] for w in wps] == TERN_LEG_SPEEDS
    assert [w["squat_mm"] for w in wps] == TERN_SQUATS
    assert p["required_mm"] == TERN_REQUIRED_MM
    for w in wps:
        assert w["clearance_mm"] == w["sounded_depth_mm"] + w["tide_mm"] - VESSELS["V-01"]["draught_mm"] - w["squat_mm"]
        assert w["margin_mm"] == w["clearance_mm"] - TERN_REQUIRED_MM
    assert wps[2]["clearance_mm"] == NARROWS_CLEARANCE_MM and wps[2]["margin_mm"] == NARROWS_MARGIN_MM
    assert p["pinch"] == {"waypoint_id": "W3", "margin_mm": NARROWS_MARGIN_MM} and p["window_state"] == "open"
    assert [w["pinch"] for w in wps] == [False, False, True, False, False, False]
    closed = plan(f"{day}T04:25")
    assert closed["window_state"] == "closed" and closed["pinch"] == {"waypoint_id": "W3", "margin_mm": NARROWS_CLOSED_MM}
    late = plan(f"{day}T06:50")
    assert late["waypoints"][5]["arrival_at"] == f"{day}T09:24:11"
    assert late["pinch"] == {"waypoint_id": "W6", "margin_mm": INNER_MARGIN_MM} and late["window_state"] == "open"
    shut = plan(f"{day}T06:55")
    assert shut["window_state"] == "closed" and shut["pinch"] == {"waypoint_id": "W6", "margin_mm": INNER_CLOSED_MM}


def tern_plan_at(disp, at):
    r = disp.post("/api/plan", json={"vessel_id": "V-01", "speed_kn": 10, "draught_m": 11.2, "boarding_at": at})
    assert r.status_code == 200, f"POST /api/plan {at}: {r.text}"
    return r.json()


def test_tide_interpolation(app_url):
    day = slot_day(app_url, 4)
    disp = client(app_url, DISPATCH1)

    def plan(at):
        return tern_plan_at(disp, at)

    assert plan(f"{day}T05:05")["waypoints"][0]["tide_mm"] == OUTER_TIDE_STD_MM
    assert plan("2026-11-01T05:05")["waypoints"][0]["tide_mm"] == OUTER_TIDE_FALL_MM
    assert plan("2027-03-14T05:05")["waypoints"][0]["tide_mm"] == OUTER_TIDE_SPRING_MM
    fb = plan("2026-11-01T01:30")["waypoints"]
    assert (fb[0]["arrival_at"], fb[0]["arrival_utc_offset"]) == ("2026-11-01T01:48:00", "-03:00")
    assert (fb[1]["arrival_at"], fb[1]["arrival_utc_offset"]) == ("2026-11-01T01:15:00", "-04:00")


def test_open_windows_api(app_url):
    day = slot_day(app_url, 4)
    disp, agent, tide = client(app_url, DISPATCH1), client(app_url, CORV_AGENT), client(app_url, TIDE_AGENT)
    ref = order(agent, "V-01", day, "10:00")
    cases = {str(day): [("04:30", "06:50"), ("17:00", "18:55")],
             "2026-11-01": [("04:15", "06:50"), ("17:00", "18:55")],
             "2027-03-14": [("04:45", "06:50"), ("17:00", "18:55")]}
    for d, expected in cases.items():
        r = disp.get(f"/api/moves/{ref}/windows", params={"date": d})
        assert r.status_code == 200 and r.json()["date"] == d
        assert [(w["from"], w["to"]) for w in r.json()["windows"]] == expected, d
    marram = order(tide, "V-04", day, "10:00")
    assert disp.get(f"/api/moves/{marram}/windows", params={"date": str(day)}).json()["windows"] == []
    assert client(app_url, CLERK).get(f"/api/moves/{ref}/windows", params={"date": str(day)}).status_code == 403


def test_wf_keel_section_planning_keyboard(browser, app_url):
    day = slot_day(app_url, 5)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    queued = disp.get("/api/moves", params={"status": "Ordered"}).json()["moves"]
    final_plan = plan_at(disp, ref, f"{day}T06:50")
    with signed_in(browser, app_url, DISPATCH1, "/board") as page:
        section = page.get_by_role("region", name="Keel Section", exact=True)
        wait(page, lambda: ref in page.get_by_role("region", name="Order queue", exact=True).inner_text(),
             "the board lists the queued order")
        for _ in range(len(queued) + 2):
            if parse_qs(urlparse(page.url).query).get("move") == [ref]:
                break
            page.keyboard.press("n")
            advance(page, 300)
        else:
            pytest.fail("n never loaded the test's queued order")
        group = section.get_by_role("group", name="Open windows", exact=True)
        wait(page, lambda: group.get_by_role("button").count() == 2, "two open windows")
        for name in (open_window("04:30", "06:50"), open_window("17:00", "18:55")):
            expect(group.get_by_role("button", name=name, exact=True)).to_have_count(1)
        assert "Clearance = sounded depth + tide at arrival - draught - squat" in section.inner_text()
        for limit in (8, 7):
            assert f"{limit} kn" in section.inner_text()
        slider = section.get_by_role("slider", name="Boarding time", exact=True)
        page.keyboard.press("k")
        wait(page, lambda: focused(slider), "k focuses the handle")
        page.keyboard.press("Home")
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("00:00"), "Home -> 00:00")
        for _ in range(8):
            page.keyboard.press(KEY_PAGE_UP)
        for _ in range(5):
            page.keyboard.press(KEY_RIGHT)
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("04:25"), "handle at 04:25")
        wait(page, lambda: f"Pinch Narrows Sill {metres(NARROWS_CLOSED_MM)} m" in section.inner_text()
             and "Gate closed" in section.inner_text(), "04:25 paints closed at Narrows Sill")
        advance(page, 1000)
        ann = status(page, "Section announcements")
        ann.evaluate(RECORD_TEXT)
        held = []
        def plan_url(url):
            return "/plan" in urlparse(url).path

        page.route(plan_url, lambda route: held.append(route))
        for _ in range(29):
            page.keyboard.press(KEY_RIGHT)
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("06:50"), "held arrow reaches 06:50")
        advance(page, 800)
        page.unroute(plan_url)
        for r in reversed(held):
            with contextlib.suppress(Exception):
                r.continue_()
        final = f"Pinch Inner Sill, margin {metres(INNER_MARGIN_MM)} m. Gate open"
        equals(page, ann, final)
        advance(page, 1500)
        assert [t for t in page.evaluate("window.__rec") if t] == [final]
        assert f"Pinch Inner Sill {metres(INNER_MARGIN_MM)} m" in section.inner_text()
        assert page.get_by_test_id("gate-ribbon").get_attribute("data-state") == "open"
        heights = [w["sounded_depth_mm"] + w["tide_mm"] for w in final_plan["waypoints"]]
        assert page.get_by_test_id("water-line").get_attribute("data-heights-mm") == ",".join(map(str, heights))
        for w in final_plan["waypoints"]:
            expect(page.get_by_test_id(f"bar-{w['id']}")).to_have_count(1)
        commit_btn = section.get_by_role("button", name="Commit window", exact=True)
        expect(commit_btn).to_be_enabled()
        tab_to(page, commit_btn, "Commit window")
        page.keyboard.press("Enter")
        equals(page, ann, f"Window committed at 06:50 port time, pinch Inner Sill {metres(INNER_MARGIN_MM)} m")
        el = eligibility(disp, ref)
        name = turn_entry(el, el["next_eligible"])["name"]
        page.keyboard.press("a")
        dlg = page.get_by_role("dialog", name="Assign pilot", exact=True)
        wait(page, lambda: inside(dlg), "a opens Assign pilot with focus inside")
        for _ in range(25):
            page.keyboard.press("Tab")
            assert inside(dlg), "Tab left the open Assign pilot panel"
        for _ in range(15):
            if page.evaluate(ACTIVE_IS_RADIO):
                break
            page.keyboard.press("Tab")
        target = dlg.get_by_role("radio", name=re.compile(rf"^{re.escape(name)}\b"))
        for _ in range(12):
            if target.is_checked():
                break
            page.keyboard.press(KEY_DOWN)
        assert target.is_checked(), f"keyboard could not select {name}"
        tab_to(page, dlg.get_by_role("button", name="Assign", exact=True), "Assign")
        page.keyboard.press("Enter")
        equals(page, status(page, "Board announcements"), f"Pilot {name} assigned to {ref}")
    mv = move(disp, ref)
    assert mv["status"] == "Pilot assigned" and mv["pilot"]["id"] == el["next_eligible"]
    assert mv["committed"]["boarding_at"] == f"{day}T06:50" and mv["committed"]["margin_mm"] == INNER_MARGIN_MM


def test_wf_keel_section_planning_dst_handle(browser, app_url):
    agent = client(app_url, CORV_AGENT)
    ref = order(agent, "V-01", "2027-03-14", "10:00")
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as page:
        section = page.get_by_role("region", name="Keel Section", exact=True)
        slider = section.get_by_role("slider", name="Boarding time", exact=True)
        day_box = section.get_by_role("textbox", name="Planning day", exact=True)
        wait(page, lambda: day_box.input_value() == "2027-03-14", "planning day from the move")
        group = section.get_by_role("group", name="Open windows", exact=True)
        wait(page, lambda: group.get_by_role("button", name=open_window("04:45", "06:50"), exact=True).count() == 1,
             "spring-forward windows")

        def walk_to_0155():
            slider.focus()
            page.keyboard.press("Home")
            for _ in range(23):
                page.keyboard.press(KEY_RIGHT)
            wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("01:55"), "01:55")

        walk_to_0155()
        page.keyboard.press(KEY_RIGHT)
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("03:00"), "Right from 01:55 -> 03:00")
        page.keyboard.press(KEY_LEFT)
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("01:55"), "Left from 03:00 -> 01:55")
        fill(day_box, "2026-11-01")
        page.keyboard.press("Enter")
        wait(page, lambda: group.get_by_role("button", name=open_window("04:15", "06:50"), exact=True).count() == 1,
             "fall-back windows")
        walk_to_0155()
        page.keyboard.press(KEY_RIGHT)
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("02:00"), "Right from 01:55 -> 02:00")


def test_wf_keel_section_planning_handle_latest(browser, app_url):
    day = slot_day(app_url, 33)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    final_plan = plan_at(disp, ref, f"{day}T06:50")
    heights = ",".join(str(w["sounded_depth_mm"] + w["tide_mm"]) for w in final_plan["waypoints"])
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as page:
        section = page.get_by_role("region", name="Keel Section", exact=True)
        slider = section.get_by_role("slider", name="Boarding time", exact=True)
        commit_btn = section.get_by_role("button", name="Commit window", exact=True)
        ribbon = page.get_by_test_id("gate-ribbon")
        click(section.get_by_role("button", name=open_window("04:30", "06:50"), exact=True))

        def gate(state):
            words = "Gate open" if state == "open" else "Gate closed"
            return (ribbon.get_attribute("data-state") == state and words in section.inner_text()
                    and commit_btn.is_enabled() == (state == "open"))

        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("04:30") and gate("open"), "04:30 paints open")
        slider.focus()
        page.keyboard.press(KEY_LEFT)
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("04:25") and gate("closed")
             and f"Pinch Narrows Sill {metres(NARROWS_CLOSED_MM)} m" in section.inner_text(),
             "crossing the limit closes the gate")
        page.keyboard.press(KEY_RIGHT)
        wait(page, lambda: gate("open") and f"Pinch Narrows Sill {metres(NARROWS_MARGIN_MM)} m" in section.inner_text(),
             "crossing back opens the gate")
        held = []

        def plan_url(url):
            return "/plan" in urlparse(url).path

        page.route(plan_url, lambda route: held.append(route))
        for _ in range(28):
            page.keyboard.press(KEY_RIGHT)
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("06:50"), "held arrow reaches 06:50")
        advance(page, 800)
        page.unroute(plan_url)
        for r in reversed(held):
            with contextlib.suppress(Exception):
                r.continue_()
        water = page.get_by_test_id("water-line")
        wait(page, lambda: water.get_attribute("data-heights-mm") == heights
             and f"Pinch Inner Sill {metres(INNER_MARGIN_MM)} m" in section.inner_text() and gate("open"),
             "final step painted")
        advance(page, 1500)
        assert water.get_attribute("data-heights-mm") == heights
        assert f"Pinch Inner Sill {metres(INNER_MARGIN_MM)} m" in section.inner_text()
        assert slider.get_attribute(VALUE_TEXT) == port_time("06:50")


def test_wf_keel_section_planning_announcements(browser, app_url):
    day = slot_day(app_url, 34)
    ref = order(client(app_url, CORV_AGENT), "V-01", day, "10:00")
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as page:
        section = page.get_by_role("region", name="Keel Section", exact=True)
        slider = section.get_by_role("slider", name="Boarding time", exact=True)
        ann = status(page, "Section announcements")
        slider.focus()
        page.keyboard.press("Home")
        for _ in range(8):
            page.keyboard.press(KEY_PAGE_UP)
        for _ in range(5):
            page.keyboard.press(KEY_RIGHT)
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("04:25")
             and "Gate closed" in section.inner_text(), "handle rests at 04:25 with the gate closed")
        advance(page, 1500)
        ann.evaluate(RECORD_TEXT)
        page.keyboard.press(KEY_RIGHT)
        equals(page, ann, "Gate open")
        page.keyboard.press(KEY_LEFT)
        equals(page, ann, "Gate closed")
        page.keyboard.press(KEY_RIGHT)
        equals(page, ann, "Gate open")
        click(section.get_by_role("button", name="Commit window", exact=True))
        equals(page, ann, f"Window committed at 04:30 port time, pinch Narrows Sill {metres(NARROWS_MARGIN_MM)} m")
        recorded = [t for t in page.evaluate("window.__rec") if t]
        assert not any(t.startswith("Pinch") for t in recorded), f"pinch announced without a pinch change: {recorded}"
    assert move(client(app_url, DISPATCH1), ref)["committed"]["boarding_at"] == f"{day}T04:30"


def test_commit_api_rules(app_url):
    day = slot_day(app_url, 6)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    etag, mv = tagged(disp, ref)
    tv = port_info(app_url)["tide_version"]
    body = {"boarding_at": f"{day}T04:30", "tide_version": tv, "draught_mm": mv["draught_mm"]}
    r = disp.post(f"/api/moves/{ref}/commit", json=body)
    assert r.status_code == 428 and r.json()["error"] == "version_required"
    for bad in ({**body, "tide_version": tv - 1}, {**body, "draught_mm": mv["draught_mm"] + 1}):
        r = disp.post(f"/api/moves/{ref}/commit", json=bad, headers={"If-Match": etag})
        assert r.status_code == 409 and r.json()["error"] == "stale_plan" and "plan" in r.json()
    r = disp.post(f"/api/moves/{ref}/commit", json={**body, "boarding_at": f"{day}T04:25"}, headers={"If-Match": etag})
    assert r.status_code == 409 and r.json()["error"] == "window_closed"
    assert r.json()["plan"]["pinch"]["margin_mm"] == NARROWS_CLOSED_MM
    r = disp.post(f"/api/moves/{ref}/commit", json={**body, "boarding_at": "2027-03-14T02:30"}, headers={"If-Match": etag})
    assert r.status_code == 422
    assert r.json()["errors"]["boarding_at"] == "That time does not exist in port time on this date"
    r = disp.post(f"/api/moves/{ref}/commit", json={**body, "boarding_at": f"{day}T04:33"}, headers={"If-Match": etag})
    assert r.status_code == 422 and "boarding_at" in r.json()["errors"]
    r = disp.post(f"/api/moves/{ref}/commit", json={**body, "boarding_at": "2026-11-01T05:00"}, headers={"If-Match": etag})
    assert r.status_code == 422 and "boarding_at" in r.json()["errors"]
    assert client(app_url, CORV_AGENT).post(f"/api/moves/{ref}/commit", json=body, headers={"If-Match": etag}).status_code == 403
    same = move(disp, ref)
    assert same["version"] == mv["version"] and same["status"] == "Ordered" and same["committed"] is None
    d2 = client(app_url, DISPATCH2)
    results = par(*[(lambda c: lambda: c.post(f"/api/moves/{ref}/commit", json=body, headers={"If-Match": etag}))(c)
                    for c in (disp, d2, disp, d2, disp)])
    assert sorted(r.status_code for r in results) == [200, 412, 412, 412, 412]
    for r in results:
        if r.status_code == 412:
            assert r.json()["error"] == "stale_version" and r.json()["current"]["ref"] == ref
    done = move(disp, ref)
    assert done["status"] == "Window committed" and done["version"] == mv["version"] + 1
    assert done["committed"]["boarding_at"] == f"{day}T04:30" and done["committed"]["margin_mm"] == NARROWS_MARGIN_MM
    assert done["committed"]["pinch_waypoint"] in ("W3", "Narrows Sill") and done["boarding_at"] == f"{day}T04:30"
    assert history_count(done, "Window committed") == 1
    again = commit(disp, ref, day, "06:50")
    assert again.status_code == 200 and again.json()["committed"]["margin_mm"] == INNER_MARGIN_MM


def test_tide_revision(app_url, mail):
    day = slot_day(app_url, 7)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    a, b = order(agent, "V-01", day, "10:00"), order(agent, "V-01", day, "10:00")
    committed(disp, a, day, "04:30")
    committed(disp, b, day, "17:00")
    before = port_info(app_url)["tide_version"]
    events = [{"at": "00:45", "type": "low", "height_mm": 1600}, {"at": "06:55", "type": "high", "height_mm": 9400},
              {"at": "13:05", "type": "low", "height_mm": 1400}, {"at": "19:15", "type": "high", "height_mm": 9400}]
    assert client(app_url, CORV_AGENT).post("/api/tide-revisions", json={"date": str(day), "events": events}).status_code == 403
    r = disp.post("/api/tide-revisions", json={"date": str(day), "events": events})
    assert r.status_code == 201, r.text
    version = r.json()["version"]
    assert version > before and a in r.json()["returned_to_ordered"] and b not in r.json()["returned_to_ordered"]
    assert disp.get("/api/tide", params={"date": str(day)}).json()["version"] == version
    ma, mb = move(disp, a), move(disp, b)
    assert ma["status"] == "Ordered" and ma["committed"] is None
    assert mb["status"] == "Window committed" and mb["committed"]["boarding_at"] == f"{day}T17:00"
    assert mb["committed"]["tide_version"] == version
    bad = disp.post("/api/tide-revisions", json={"date": "2027-03-14", "events": [
        {"at": "02:30", "type": "low", "height_mm": 1600}, {"at": "06:55", "type": "high", "height_mm": 9600}]})
    assert bad.status_code == 422 and "events" in bad.json()["errors"]
    find_mail(mail, lambda m: subject(m) == "Pilot order amended: Tern Arrow" and f"{day} 04:30" in text(m)
              and CORV_AGENT in recipients(m), 1, "Order amended after tide revision")


def test_wf_window_commit_board_and_agent(browser, app_url):
    day = slot_day(app_url, 8)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as page:
        page.clock.set_system_time(datetime(2031, 1, 1, 12, 0))
        section = page.get_by_role("region", name="Keel Section", exact=True)
        click(section.get_by_role("button", name=open_window("04:30", "06:50"), exact=True))
        commit_btn = section.get_by_role("button", name="Commit window", exact=True)
        wait(page, lambda: commit_btn.is_enabled() and "Gate open" in section.inner_text(), "gate open at 04:30")
        ann = status(page, "Section announcements")
        equals(page, ann, f"Pinch Narrows Sill, margin {metres(NARROWS_MARGIN_MM)} m. Gate open")
        hull = page.get_by_test_id("hull")
        assert hull.get_attribute("data-progress") == "0"
        hull.evaluate(RECORD_PROGRESS)
        click(commit_btn)
        equals(page, ann,
               f"Window committed at 04:30 port time, pinch Narrows Sill {metres(NARROWS_MARGIN_MM)} m")
        wait(page, lambda: hull.get_attribute("data-progress") == "100", "the hull rests at the berth")
        values = [int(v) for _, v in page.evaluate("window.__prog") if v is not None]
        assert values == sorted(values) and values[-1] == 100, f"hull path {values}"
        moves = page.get_by_role("region", name="Moves", exact=True)
        wait(page, lambda: ref in moves.inner_text() and "04:30" in moves.inner_text()
             and metres(NARROWS_MARGIN_MM) in moves.inner_text(), "move row shows committed time and margin")
    mv = move(agent, ref)
    assert mv["status"] == "Window committed" and history_count(mv, "Window committed") == 1
    with signed_in(browser, app_url, CORV_AGENT, "/orders") as page:
        wait(page, lambda: ref in body(page) and "Window committed" in body(page), "agent sees the committed move")


def test_wf_window_commit_queue_to_board(browser, app_url):
    day = slot_day(app_url, 35)
    agent = client(app_url, CORV_AGENT)
    ref = order(agent, "V-01", day, "10:00")
    with signed_in(browser, app_url, DISPATCH1, "/board") as page:
        queue = page.get_by_role("region", name="Order queue", exact=True)
        plan_btn = queue.get_by_role("button", name=f"Plan {ref} Tern Arrow", exact=True)
        wait(page, lambda: plan_btn.count() == 1, "queued order listed")
        click(plan_btn)
        wait(page, lambda: parse_qs(urlparse(page.url).query).get("move") == [ref], "Plan writes move to the address")
        section = page.get_by_role("region", name="Keel Section", exact=True)
        commit_btn = section.get_by_role("button", name="Commit window", exact=True)
        click(section.get_by_role("button", name=open_window("04:30", "06:50"), exact=True))
        wait(page, lambda: commit_btn.is_enabled(), "gate open at 04:30")
        click(commit_btn)
        equals(page, status(page, "Section announcements"),
               f"Window committed at 04:30 port time, pinch Narrows Sill {metres(NARROWS_MARGIN_MM)} m")
        moves = page.get_by_role("region", name="Moves", exact=True)
        wait(page, lambda: plan_btn.count() == 0 and ref in moves.inner_text() and "Window committed" in moves.inner_text(),
             "move leaves the queue and shows committed on the board")
    mv = move(agent, ref)
    assert mv["status"] == "Window committed" and mv["committed"]["boarding_at"] == f"{day}T04:30"
    assert history_count(mv, "Window committed") == 1
    with signed_in(browser, app_url, CORV_AGENT, "/orders") as page:
        wait(page, lambda: ref in body(page) and "Window committed" in body(page), "agent sees the committed move")


def test_wf_window_commit_stale_refused(browser, app_url):
    day, other = slot_day(app_url, 9), slot_day(app_url, 10)
    agent, disp2 = client(app_url, CORV_AGENT), client(app_url, DISPATCH2)
    ref, ref2 = order(agent, "V-01", day, "10:00"), order(agent, "V-01", day, "10:00")
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as page:
        section = page.get_by_role("region", name="Keel Section", exact=True)
        ann = status(page, "Section announcements")
        commit_btn = section.get_by_role("button", name="Commit window", exact=True)
        click(section.get_by_role("button", name=open_window("04:30", "06:50"), exact=True))
        wait(page, lambda: commit_btn.is_enabled(), "gate open")
        committed(disp2, ref, day, "06:50")
        click(commit_btn)
        equals(page, ann, "Commit refused: another dispatcher changed this move. Section redrawn from fresh data.")
        assert page.get_by_test_id("hull").get_attribute("data-progress") == "0"
        assert move(disp2, ref)["committed"]["boarding_at"] == f"{day}T06:50"
        page.goto(f"{app_url}/board?move={ref2}")
        section = page.get_by_role("region", name="Keel Section", exact=True)
        click(section.get_by_role("button", name=open_window("04:30", "06:50"), exact=True))
        wait(page, lambda: section.get_by_role("button", name="Commit window", exact=True).is_enabled(), "gate open on second move")
        std = [{"at": "00:45", "type": "low", "height_mm": 1600}, {"at": "06:55", "type": "high", "height_mm": 9600},
               {"at": "13:05", "type": "low", "height_mm": 1400}, {"at": "19:15", "type": "high", "height_mm": 9400}]
        assert disp2.post("/api/tide-revisions", json={"date": str(other), "events": std}).status_code == 201
        click(section.get_by_role("button", name="Commit window", exact=True))
        equals(page, status(page, "Section announcements"),
               "Commit refused: the tide table or draught changed. Section redrawn from new values.")
        assert page.get_by_test_id("hull").get_attribute("data-progress") == "0"
    assert move(disp2, ref2)["status"] == "Ordered"


def test_assignment_turn_and_licence(app_url):
    day = slot_day(app_url, 11)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    el = eligibility(disp, ref)
    turn = sorted(el["turn"], key=lambda t: t["position"])
    for t in turn:
        assert ("licence" in t["reasons"]) == (t["licence_class"] == "C")
        assert t["eligible"] == (t["reasons"] == [])
    nxt = el["next_eligible"]
    assert nxt == next(t["pilot_id"] for t in turn if not t["reasons"])
    c_pilot = next(t for t in turn if t["licence_class"] == "C")
    r = assign(disp, ref, c_pilot["pilot_id"], rest_override_reason="Immediate safety: only pilot available")
    assert r.status_code == 409 and r.json()["error"] == "licence_not_covering" and "turn" in r.json()
    idx = [t["pilot_id"] for t in turn].index(nxt)
    later = next((t for t in turn[idx + 1:] if not t["reasons"]), None)
    if later:
        r = assign(disp, ref, later["pilot_id"])
        assert r.status_code == 409 and r.json()["error"] == "not_next_in_turn" and "turn" in r.json()
    r = assign(disp, ref, nxt, rest_override_reason="Immediate safety: not needed")
    assert r.status_code == 422 and "rest_override_reason" in r.json()["errors"]
    assert move(disp, ref)["status"] == "Window committed"
    assert assign(disp, ref, nxt).status_code == 200
    skips = [s for s in disp.get("/api/skips").json()["skips"] if s["move_ref"] == ref]
    ahead = turn[:idx]
    assert sorted((s["pilot_id"], tuple(sorted(s["reasons"]))) for s in skips) == \
        sorted((t["pilot_id"], tuple(sorted(t["reasons"]))) for t in ahead)
    after = [t["pilot_id"] for t in sorted(eligibility(disp, ref)["turn"], key=lambda t: t["position"])]
    assert after[-1] == nxt
    assert after[:-1] == [t["pilot_id"] for t in turn if t["pilot_id"] != nxt]


def test_rest_rules(app_url):
    day = slot_day(app_url, 12)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    d0 = store_day(app_url)
    rota = order(agent, "V-01", free_day(d0 + timedelta(days=1)), "17:00")
    rota_day = move(disp, rota)["boarding_at"][:10]
    if commit(disp, rota, rota_day, "17:00").status_code == 200:
        assert "rota_days" in turn_entry(eligibility(disp, rota), "P-05")["reasons"]
    first = order(agent, "V-01", day, "10:00", duty=720)
    committed(disp, first, day, "04:30")
    x = assign_next(disp, first)["pilot_id"]
    evening = order(agent, "V-01", day, "10:00")
    committed(disp, evening, day, "17:00")
    assert "rest" in turn_entry(eligibility(disp, evening), x)["reasons"]
    before = order(agent, "V-01", day - timedelta(days=1), "10:00", duty=720)
    committed(disp, before, day - timedelta(days=1), "17:00")
    assert "rest" in turn_entry(eligibility(disp, before), x)["reasons"]
    r = assign(disp, evening, x)
    assert r.status_code == 409 and r.json()["error"] == "rest_breach" and "turn" in r.json()
    r = assign(disp, before, x)
    assert r.status_code == 409 and r.json()["error"] == "rest_breach"
    assert move(disp, evening)["status"] == "Window committed" and move(disp, evening)["pilot"] is None


def test_rest_override(app_url, mail):
    day = slot_day(app_url, 36)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    first = order(agent, "V-01", day, "10:00", duty=720)
    committed(disp, first, day, "04:30")
    x = assign_next(disp, first)["pilot_id"]
    evening = order(agent, "V-01", day, "10:00")
    committed(disp, evening, day, "17:00")
    assert "rest" in turn_entry(eligibility(disp, evening), x)["reasons"]
    bring_to_head(app_url, disp, x)
    el = sorted(eligibility(disp, evening)["turn"], key=lambda t: t["position"])
    assert el[0]["pilot_id"] == x
    r = assign(disp, evening, x)
    assert r.status_code == 409 and r.json()["error"] == "rest_breach"
    for short in ("too short", "   abc     "):
        r = assign(disp, evening, x, rest_override_reason=short)
        assert r.status_code == 422 and "rest_override_reason" in r.json()["errors"]
    r = assign(disp, evening, x, rest_override_reason="x" * 501)
    assert r.status_code == 422
    reason = f"Immediate safety {uuid.uuid4().hex}"
    note = f"Dispatcher note {uuid.uuid4().hex}"
    r = assign(disp, evening, x, rest_override_reason=reason, note=note)
    assert r.status_code == 200, r.text
    assert reason in json.dumps(r.json()["rest_override"]) and note in json.dumps(r.json()["dispatcher_notes"])
    ov = [o for o in disp.get("/api/overrides").json()["overrides"] if o["move_ref"] == evening]
    assert len(ov) == 1 and ov[0]["reason"] == reason and ov[0]["pilot_id"] == x and ov[0]["by"]
    for method in ("PUT", "PATCH", "DELETE"):
        r = disp.request(method, f"/api/overrides/{ov[0]['id']}", json={"reason": "changed"})
        assert r.status_code == 405 and r.json()["error"] == "method_not_allowed"
    assert disp.get("/api/overrides").json()["overrides"] == disp.get("/api/overrides").json()["overrides"]
    assert [o for o in disp.get("/api/overrides").json()["overrides"] if o["move_ref"] == evening][0]["reason"] == reason
    viewer = client(app_url, CORV_AGENT)
    assert viewer.get("/api/overrides").status_code == 403
    seen = move(viewer, evening)
    assert "rest_override" not in seen and "dispatcher_notes" not in seen
    for blob in (json.dumps(seen), viewer.get("/api/moves", params={"q": evening}).text,
                 viewer.get("/api/exports/moves.csv").text):
        assert reason not in blob and note not in blob
    msgs = find_mail(mail, lambda m: f"{day} 17:00" in text(m) and "Tern Arrow" in subject(m), 2,
                     "both assignment mails for the override move")
    for m in msgs:
        assert reason not in text(m) and note not in text(m)


def test_private_fields(app_url, mail):
    day = slot_day(app_url, 37)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    pid = eligibility(disp, ref)["next_eligible"]
    note = f"Dispatcher note {uuid.uuid4().hex}"
    r = assign(disp, ref, pid, note=note)
    assert r.status_code == 200, r.text
    assert note in json.dumps(r.json()["dispatcher_notes"]) and "rest_override" in r.json()
    assert note in json.dumps(move(client(app_url, pilot_email(pid)), ref)["dispatcher_notes"])
    seen = move(agent, ref)
    assert "rest_override" not in seen and "dispatcher_notes" not in seen
    for blob in (json.dumps(seen), agent.get("/api/moves", params={"q": ref}).text,
                 agent.get("/api/exports/moves.csv").text):
        assert note not in blob
    seeded = move(client(app_url, TIDE_AGENT), "MV-1004")
    assert seeded["pilot"] is not None
    assert "dispatcher_notes" not in seeded and "rest_override" not in seeded
    stamp = f"{day} 04:30 port time"
    msgs = find_mail(mail, lambda m: stamp in text(m) and "Tern Arrow" in subject(m), 2, "both assignment mails")
    assert all(note not in text(m) for m in msgs)


def test_assignment_concurrency(app_url):
    day = slot_day(app_url, 13)
    agent, d1, d2 = client(app_url, CORV_AGENT), client(app_url, DISPATCH1), client(app_url, DISPATCH2)
    a = order(agent, "V-01", day, "10:00")
    committed(d1, a, day, "04:30")
    pid = eligibility(d1, a)["next_eligible"]
    etag, _ = tagged(d1, a)
    res = par(lambda: assign(d1, a, pid, etag=etag), lambda: assign(d2, a, pid, etag=etag))
    assert sorted(r.status_code for r in res) == [200, 412]
    loser = next(r for r in res if r.status_code == 412).json()
    assert loser["error"] == "stale_version" and loser["current"]["status"] == "Pilot assigned"

    b = order(agent, "V-01", day + timedelta(days=1), "10:00")
    c = order(agent, "V-01", day + timedelta(days=2), "10:00")
    committed(d1, b, day + timedelta(days=1), "04:30")
    committed(d1, c, day + timedelta(days=2), "04:30")
    p2 = eligibility(d1, b)["next_eligible"]
    assert eligibility(d1, c)["next_eligible"] == p2
    res = par(lambda: assign(d1, b, p2), lambda: assign(d2, c, p2))
    assert sorted(r.status_code for r in res) == [200, 409]
    assert "turn" in next(r for r in res if r.status_code == 409).json()


def test_assignment_one_key(app_url, mail):
    day = slot_day(app_url, 38)
    agent, d1 = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    e = order(agent, "V-01", day + timedelta(days=1), "10:00")
    committed(d1, e, day + timedelta(days=1), "17:00")
    el = eligibility(d1, e)
    pe, before = el["next_eligible"], move(d1, e)
    skipped_ahead = [t for t in el["turn"] if t["position"] < turn_entry(el, pe)["position"]]
    key, etag = idempotency_key(), tagged(d1, e)[0]
    res = par(*[lambda: assign(d1, e, pe, key=key, etag=etag)] * 3)
    assert {r.status_code for r in res} == {200} and len({json.dumps(r.json(), sort_keys=True) for r in res}) == 1
    replay = assign(d1, e, pe, key=key, etag=etag)
    assert replay.status_code == 200 and replay.json() == res[0].json()
    clash = assign(d1, e, pe, key=key, etag=etag, note="different body")
    assert clash.status_code == 409 and clash.json()["error"] == "idempotency_conflict"
    after = move(d1, e)
    assert after["version"] == before["version"] + 1 and history_count(after, "Pilot assigned") == 1
    skips = [s for s in d1.get("/api/skips").json()["skips"] if s["move_ref"] == e]
    assert len(skips) == len(skipped_ahead) == len({s["pilot_id"] for s in skips})
    stamp = f"{day + timedelta(days=1)} 17:00 port time"
    conf = find_mail(mail, lambda m: subject(m) == "Pilot order confirmed: Tern Arrow" and stamp in text(m), 1, "confirmation")
    asg = find_mail(mail, lambda m: subject(m) == f"Assignment: Tern Arrow {stamp}", 1, "assignment notice")
    assert len(conf) == 1 and len(asg) == 1 and pilot_email(pe) in recipients(asg[0])


def test_wf_assignment_notices_panel(browser, app_url, mail):
    day = slot_day(app_url, 14)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    el = eligibility(disp, ref)
    nxt = turn_entry(el, el["next_eligible"])
    note = f"half typed {uuid.uuid4().hex[:8]}"
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as page:
        opener = page.get_by_role("button", name=f"Assign pilot to {ref}", exact=True)
        click(opener)
        dlg = page.get_by_role("dialog", name="Assign pilot", exact=True)
        wait(page, lambda: inside(dlg), "focus inside Assign pilot")
        for key in ["Tab"] * 15 + ["Shift+Tab"] * 5:
            page.keyboard.press(key)
            assert inside(dlg), f"{key} left the open panel"
        page.keyboard.press("Escape")
        wait(page, lambda: dlg.count() == 0 and focused(opener), "Escape closes and returns focus")
        click(opener)
        radio = dlg.get_by_role("radio", name=re.compile(rf"^{re.escape(nxt['name'])}\b"))
        check(radio)
        box = dlg.get_by_role("textbox", name="Dispatcher note", exact=True)
        fill(box, note)
        advance(page, BOARD_REFRESH_MS * 2 + 5000)
        assert dlg.is_visible() and radio.is_checked() and box.input_value() == note and focused(box)
        dlg.get_by_role("button", name="Assign", exact=True).evaluate(DOUBLE_CLICK)
        equals(page, status(page, "Board announcements"), f"Pilot {nxt['name']} assigned to {ref}")
    mv = move(disp, ref)
    assert mv["status"] == "Pilot assigned" and mv["pilot"]["id"] == nxt["pilot_id"]
    assert history_count(mv, "Pilot assigned") == 1
    stamp = f"{day} 04:30 port time"
    conf = find_mail(mail, lambda m: subject(m) == "Pilot order confirmed: Tern Arrow" and stamp in text(m), 1, "confirmation")
    asg = find_mail(mail, lambda m: subject(m) == f"Assignment: Tern Arrow {stamp}", 1, "assignment notice")
    assert len(conf) == 1 and CORV_AGENT in recipients(conf[0]) and nxt["name"] in text(conf[0])
    assert len(asg) == 1 and pilot_email(nxt["pilot_id"]) in recipients(asg[0]) and "Narrows Sill" in text(asg[0])
    assert all(note not in text(m) for m in conf + asg)
    poll(lambda: move(disp, ref)["notices"], lambda n: {x["kind"]: x["state"] for x in n}.get("Order confirmation") == "sent"
         and {x["kind"]: x["state"] for x in n}.get("Assignment notice") == "sent", "notices sent on the move")
    with signed_in(browser, app_url, CORV_AGENT, f"/moves/{ref}") as page:
        notices = page.get_by_role("list", name="Notices", exact=True)
        shows(page, notices, "Order confirmation: sent")
        shows(page, notices, "Assignment notice: sent")
        assert note not in body(page)


def test_wf_assignment_notices_panel_refresh(browser, app_url):
    day = slot_day(app_url, 39)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    other = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    el = eligibility(disp, ref)
    nxt = turn_entry(el, el["next_eligible"])
    note = f"half typed {uuid.uuid4().hex[:8]}"
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as page:
        queue = page.get_by_role("region", name="Order queue", exact=True)
        wait(page, lambda: other in queue.inner_text(), "second order queued")
        click(page.get_by_role("button", name=f"Assign pilot to {ref}", exact=True))
        dlg = page.get_by_role("dialog", name="Assign pilot", exact=True)
        radio = dlg.get_by_role("radio", name=re.compile(rf"^{re.escape(nxt['name'])}\b"))
        check(radio)
        box = dlg.get_by_role("textbox", name="Dispatcher note", exact=True)
        fill(box, note)
        committed(disp, other, day, "17:00")
        wait(page, lambda: other not in queue.inner_text(), "board refresh removed the committed order from the queue")
        advance(page, BOARD_REFRESH_MS * 2 + 1000)
        assert dlg.is_visible() and radio.is_checked() and box.input_value() == note and focused(box)
        assert parse_qs(urlparse(page.url).query).get("move") == [ref]
    assert move(disp, ref)["status"] == "Window committed"


def test_order_and_assignment_notices(app_url, mail):
    day = slot_day(app_url, 40)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    pid = assign_next(disp, ref)["pilot_id"]
    first, later = f"{day} 04:30 port time", f"{day} 06:50 port time"
    conf = find_mail(mail, lambda m: subject(m) == "Pilot order confirmed: Tern Arrow" and first in text(m), 1,
                     "Order confirmation")
    asg = find_mail(mail, lambda m: subject(m) == f"Assignment: Tern Arrow {first}", 1, "Assignment notice")
    assert len(conf) == 1 and recipients(conf[0]) == [CORV_AGENT]
    assert len(asg) == 1 and recipients(asg[0]) == [pilot_email(pid)]
    tag, _ = tagged(agent, ref)
    r = agent.patch(f"/api/moves/{ref}", json={"boarding_at": f"{day}T06:50"}, headers={"If-Match": tag})
    assert r.status_code == 200 and r.json()["status"] == "Pilot assigned"
    amended = find_mail(mail, lambda m: subject(m) == "Pilot order amended: Tern Arrow" and later in text(m), 1,
                        "Order amended")
    assert len(amended) == 1 and recipients(amended[0]) == [CORV_AGENT]
    r = keyed(agent, f"/api/moves/{ref}/cancel", {})
    assert r.status_code == 200 and r.json()["status"] == "Cancelled"
    cancelled = find_mail(mail, lambda m: subject(m) == "Pilot order cancelled: Tern Arrow" and later in text(m), 1,
                          "Order cancelled")
    withdrawn = find_mail(mail, lambda m: subject(m) == "Assignment withdrawn: Tern Arrow" and later in text(m), 1,
                          "Assignment withdrawn")
    assert len(cancelled) == 1 and recipients(cancelled[0]) == [CORV_AGENT]
    assert len(withdrawn) == 1 and recipients(withdrawn[0]) == [pilot_email(pid)]
    kinds = ["Order confirmation", "Assignment notice", "Order amended", "Order cancelled", "Assignment withdrawn"]
    notices = poll(lambda: move(disp, ref)["notices"],
                   lambda n: all(x["state"] == "sent" for x in n) and sorted(x["kind"] for x in n) == sorted(kinds),
                   "each notice once and sent on the move")
    assert len(notices) == len(kinds)


def test_wf_assignment_notices_licence_refused(browser, app_url):
    day = slot_day(app_url, 15)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as page:
        click(page.get_by_role("button", name=f"Assign pilot to {ref}", exact=True))
        dlg = page.get_by_role("dialog", name="Assign pilot", exact=True)
        check(dlg.get_by_role("radio", name=re.compile(r"^Anneke Dwyer\b")))
        click(dlg.get_by_role("button", name="Assign", exact=True))
        equals(page, status(page, "Board announcements"),
               "Pilot Anneke Dwyer is not licensed for this vessel. Fresh turn list shown.")
    mv = move(disp, ref)
    assert mv["status"] == "Window committed" and mv["pilot"] is None


def test_amend_and_cancel_api(app_url, mail):
    day = slot_day(app_url, 16)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    a = order(agent, "V-01", day, "10:00")
    committed(disp, a, day, "04:30")
    pilot = assign_next(disp, a)["pilot_id"]
    old, _ = tagged(agent, a)
    assert agent.patch(f"/api/moves/{a}", json={"speed_kn": 9}).status_code == 428
    r = agent.patch(f"/api/moves/{a}", json={"boarding_at": f"{day}T10:00"}, headers={"If-Match": old})
    assert r.status_code == 200 and r.json()["window_returned"] is True
    assert r.json()["status"] == "Ordered" and r.json()["pilot"] is None and r.json()["committed"] is None
    stale = agent.patch(f"/api/moves/{a}", json={"speed_kn": 9}, headers={"If-Match": old})
    assert stale.status_code == 412 and stale.json()["error"] == "stale_version" and stale.json()["current"]["ref"] == a
    head = sorted(eligibility(disp, a)["turn"], key=lambda t: t["position"])[0]["pilot_id"]
    assert head == pilot
    find_mail(mail, lambda m: subject(m) == "Assignment withdrawn: Tern Arrow" and pilot_email(pilot) in recipients(m)
              and str(day) in text(m), 1, "Assignment withdrawn")
    find_mail(mail, lambda m: subject(m) == "Pilot order amended: Tern Arrow" and str(day) in text(m), 1, "Order amended")

    b = order(agent, "V-01", day, "10:00")
    committed(disp, b, day, "04:30")
    tag, _ = tagged(agent, b)
    r = agent.patch(f"/api/moves/{b}", json={"boarding_at": f"{day}T06:50"}, headers={"If-Match": tag})
    assert r.status_code == 200 and r.json()["status"] == "Window committed"
    assert r.json()["committed"]["margin_mm"] == INNER_MARGIN_MM and not r.json().get("window_returned")


def test_cancellation_branches(app_url):
    day = slot_day(app_url, 41)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    c = order(agent, "V-01", day, "12:00")
    r = keyed(agent, f"/api/moves/{c}/cancel", {})
    assert r.status_code == 200 and r.json()["status"] == "Cancelled" and r.json()["lines"] == []
    assert r.json()["billing"]["state"] == "none"

    d = order(agent, "V-01", day, "10:00")
    committed(disp, d, day, "06:50")
    assign_next(disp, d)
    drive(disp, d, "Pilot away", "On board")
    r = keyed(agent, f"/api/moves/{d}/cancel", {})
    assert r.status_code == 409 and r.json()["error"] == "not_cancellable"
    tag, _ = tagged(agent, d)
    r = agent.patch(f"/api/moves/{d}", json={"speed_kn": 9}, headers={"If-Match": tag})
    assert r.status_code == 409 and r.json()["error"] == "not_amendable"

    soon = ceil5(server_now(app_url) + timedelta(minutes=40)).replace(tzinfo=None)
    e = order(agent, "V-01", soon.date(), soon.strftime("%H:%M"))
    tag, mv = tagged(agent, e)
    assert mv["notice"]["state"] == "late"
    later = soon + timedelta(minutes=5)
    r = agent.patch(f"/api/moves/{e}", json={"boarding_at": later.strftime("%Y-%m-%dT%H:%M")}, headers={"If-Match": tag})
    assert r.status_code == 200 and r.json()["late_notice"] is True and r.json()["late_amendments"] == 1
    r = keyed(agent, f"/api/moves/{e}/cancel", {})
    assert r.status_code == 200 and r.json()["status"] == "Cancelled late"
    line = [ln for ln in r.json()["lines"] if ln["label"] == "Cancellation"]
    assert len(line) == 1 and line[0]["quantity"] == 2 and line[0]["unit_cents"] == CANCELLATION_CENTS
    assert line[0]["amount_cents"] == 2 * CANCELLATION_CENTS and r.json()["late_amendments"] == 0


def test_notice_cutoff_dst(app_url):
    agent = client(app_url, CORV_AGENT)
    cases = [("2027-03-14T03:30", "2027-03-14T00:30:00", "-04:00"), ("2027-11-07T03:30", "2027-11-07T01:30:00", "-04:00"),
             ("2027-11-07T02:30", "2027-11-07T01:30:00", "-03:00"), ("2027-11-07T01:30", "2027-11-06T23:30:00", "-03:00")]
    for at, cutoff, offset in cases:
        ref = order(agent, "V-01", at[:10], at[11:])
        mv = move(agent, ref)
        assert mv["notice"]["cutoff_at"] == cutoff and mv["notice"]["cutoff_utc_offset"] == offset, at
        assert mv["notice"]["state"] == "on_time" and mv["server_now"]
    r = keyed(agent, "/api/moves", {"vessel_id": "V-01", "boarding_at": "2027-03-14T02:30", "speed_kn": 10,
                                    "duty_minutes": 300, "draught_m": 11.2})
    assert r.status_code == 422
    assert r.json()["errors"]["boarding_at"] == "That time does not exist in port time on this date"


def test_wf_amend_cancel_late_cancel(browser, app_url, killbill):
    agent = client(app_url, CORV_AGENT)
    soon = ceil5(server_now(app_url) + timedelta(minutes=30)).replace(tzinfo=None)
    ref = order(agent, "V-01", soon.date(), soon.strftime("%H:%M"))
    mv = move(agent, ref)
    zone = "ADT" if mv["notice"]["cutoff_utc_offset"] == "-03:00" else "AST"
    cutoff = f"{mv['notice']['cutoff_at'][:10]} {mv['notice']['cutoff_at'][11:16]} {zone}"
    late_copy = "Cancelled late - under 2 hours' notice. The cancellation charge applies."
    with signed_in(browser, app_url, CORV_AGENT, None) as page:
        page.clock.set_system_time(datetime(2020, 1, 1, 0, 0))
        page.goto(f"{app_url}/moves/{ref}")
        shows(page, page.locator("body"), "Under 2 hours' notice - cancellation charge applies")
        shows(page, page.locator("body"), cutoff)
        click(page.get_by_role("button", name="Cancel move", exact=True))
        dlg = page.get_by_role("dialog", name="Cancel move", exact=True)
        shows(page, dlg, cutoff)
        shows(page, dlg, "Under 2 hours' notice - cancellation charge applies")
        click(dlg.get_by_role("button", name="Confirm cancellation", exact=True))
        equals(page, status(page, "Move announcements"), late_copy)
        wait(page, lambda: "Cancelled late" in body(page), "status Cancelled late on screen")
        wait(page, lambda: "Charges posted" in body(page) or (advance(page, MOVE_REREAD_MS) and False),
             "Charges posted after provider confirms")
        assert late_copy in body(page)
    done = move(agent, ref)
    assert done["status"] == "Cancelled late"
    assert [(ln["label"], ln["amount_cents"]) for ln in done["lines"]] == [("Cancellation", CANCELLATION_CENTS)]
    inv = kb_wait(killbill, "CORV", ref, lambda g: len(g) == 1, "one invoice with the cancellation item")
    assert [(i["description"], float(i["amount"])) for i in inv[0][1]] == [(f"{ref} Cancellation", CANCELLATION_CENTS / 100)]


def test_wf_amend_cancel_amendments(browser, app_url):
    day = slot_day(app_url, 17)
    agent = client(app_url, CORV_AGENT)
    ref = order(agent, "V-01", day, "12:00")
    with signed_in(browser, app_url, CORV_AGENT, None) as page:
        page.clock.set_system_time(datetime(day.year + 1, 1, 1, 0, 0))
        page.goto(f"{app_url}/moves/{ref}")
        shows(page, page.locator("body"), "Notice on time - no cancellation charge")
        click(page.get_by_role("button", name="Amend move", exact=True))
        dlg = page.get_by_role("dialog", name="Amend move", exact=True)
        shows(page, dlg, "Notice on time - no cancellation charge")
        fill(dlg.get_by_role("textbox", name="Boarding time", exact=True), "12:30")
        click(dlg.get_by_role("button", name="Save amendment", exact=True))
        equals(page, status(page, "Move announcements"), "Amendment saved")
    mv = move(agent, ref)
    assert mv["boarding_at"] == f"{day}T12:30" and mv["late_amendments"] == 0


def test_wf_amend_cancel_late_wording(browser, app_url):
    agent = client(app_url, CORV_AGENT)
    soon = ceil5(server_now(app_url) + timedelta(minutes=30)).replace(tzinfo=None)
    near = order(agent, "V-01", soon.date(), soon.strftime("%H:%M"))
    amended = soon + timedelta(minutes=5)
    with signed_in(browser, app_url, CORV_AGENT, f"/moves/{near}") as page:
        click(page.get_by_role("button", name="Amend move", exact=True))
        dlg = page.get_by_role("dialog", name="Amend move", exact=True)
        fill(dlg.get_by_role("textbox", name="Boarding date", exact=True), str(amended.date()))
        fill(dlg.get_by_role("textbox", name="Boarding time", exact=True), amended.strftime("%H:%M"))
        click(dlg.get_by_role("button", name="Save amendment", exact=True))
        ann = status(page, "Move announcements")
        wait(page, lambda: ann.inner_text().strip().startswith("Amendment saved")
             and "Late amendment - under 2 hours' notice. The cancellation charge applies." in ann.inner_text(),
             "late amendment notice announced")
    assert move(agent, near)["late_amendments"] == 1
    late_cancel = "Cancelled late - under 2 hours' notice. The cancellation charge applies."
    with signed_in(browser, app_url, CORV_AGENT, f"/moves/{near}") as page:
        click(page.get_by_role("button", name="Cancel move", exact=True))
        click(page.get_by_role("dialog", name="Cancel move", exact=True).get_by_role("button", name="Confirm cancellation", exact=True))
        equals(page, status(page, "Move announcements"), late_cancel)
        page.reload()
        shows(page, page.locator("body"), late_cancel)
    assert move(agent, near)["status"] == "Cancelled late"


def test_move_state_machine(app_url):
    day = slot_day(app_url, 18)
    agent, disp, clerk = client(app_url, CORV_AGENT), client(app_url, DISPATCH1), client(app_url, CLERK)
    ref = order(agent, "V-01", day, "10:00")
    r = step(disp, ref, "Pilot away")
    assert r.status_code == 409 and r.json()["error"] == "illegal_transition"
    committed(disp, ref, day, "04:30")
    pid = assign_next(disp, ref)["pilot_id"]
    pilot = client(app_url, pilot_email(pid))
    r = commit(disp, ref, day, "06:50")
    assert r.status_code == 409 and r.json()["error"] == "illegal_transition"
    r = assign(disp, ref, pid)
    assert r.status_code == 409 and r.json()["error"] == "illegal_transition"
    r = step(disp, ref, "On board")
    assert r.status_code == 409 and r.json()["error"] == "illegal_transition"
    assert step(agent, ref, "Pilot away").status_code == 403 and step(clerk, ref, "Pilot away").status_code == 403
    stranger = next(f"P-{n:02d}" for n in range(1, 11) if f"P-{n:02d}" != pid)
    outsider = client(app_url, pilot_email(stranger))
    if outsider.get(f"/api/moves/{ref}").status_code == 404:
        assert step(outsider, ref, "Pilot away").status_code == 404
    assert step(pilot, ref, "Pilot away").status_code == 200
    res = par(lambda: disp.post(f"/api/moves/{ref}/transitions", json={"to": "On board"}),
              lambda: pilot.post(f"/api/moves/{ref}/transitions", json={"to": "On board"}))
    assert sorted(r.status_code for r in res) == [200, 409]
    assert next(r for r in res if r.status_code == 409).json()["error"] == "illegal_transition"
    key = idempotency_key()
    first = step(pilot, ref, "Completed", key)
    assert first.status_code == 200 and first.json()["status"] == "Completed"
    replay = step(pilot, ref, "Completed", key)
    assert replay.status_code == 200 and replay.json() == first.json()
    again = step(disp, ref, "Completed")
    assert again.status_code == 409 and again.json()["error"] == "illegal_transition"
    mv = move(disp, ref)
    assert history_count(mv, "On board") == 1 and history_count(mv, "Completed") == 1
    assert len(mv["billing"]["invoice_ids"]) == 1
    r = keyed(agent, f"/api/moves/{ref}/cancel", {})
    assert r.status_code == 409 and r.json()["error"] == "not_cancellable"


def test_wf_move_lifecycle_status_actions(browser, app_url, killbill):
    day = slot_day(app_url, 19)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-02", day, "12:00")
    hhmm = window_from(disp, ref, day, "06:00")
    committed(disp, ref, day, hhmm)
    assign_next(disp, ref)
    with signed_in(browser, app_url, DISPATCH1, f"/moves/{ref}") as page:
        ann = status(page, "Move announcements")
        for button, copy in (("Confirm pilot away", status_copy("Pilot away")), ("Confirm boarding", status_copy("On board")),
                             ("Complete move", "Move completed. Charges post when the billing provider confirms.")):
            click(page.get_by_role("button", name=button, exact=True))
            equals(page, ann, copy)
        wait(page, lambda: page.get_by_role("button", name="Complete move", exact=True).count() == 0, "Complete move removed")
    mv = move(disp, ref)
    assert mv["status"] == "Completed"
    expected = seed_lines(VESSELS["V-02"]["draught_mm"], VESSELS["V-02"]["gt"], hhmm)
    assert [(ln["label"], ln["amount_cents"]) for ln in mv["lines"]] == expected
    got = kb_wait(killbill, "CORV", ref, lambda g: len(g) == 1 and len(g[0][1]) == len(expected), "one draft invoice")
    inv, items = got[0]
    assert inv["status"] == "DRAFT"
    assert [(i["description"], round(float(i["amount"]) * 100)) for i in items] == [(f"{ref} {lab}", c) for lab, c in expected]
    assert all(i.get("itemType") == "EXTERNAL_CHARGE" for i in items)


def test_wf_move_lifecycle_detention(browser):
    base = os.environ["APP_SHORT_URL"]
    disp = client(base, DISPATCH1)
    ref = next((r for r in ("MV-1006", "MV-1007", "MV-1008") if move(disp, r)["status"] == "On board" and
                not move(disp, r)["detained"]), None)
    assert ref, "short-detention instance has no seeded On board move left"
    with signed_in(browser, base, DISPATCH1, f"/moves/{ref}") as page:
        click(page.get_by_role("button", name="Start detention", exact=True))
        mann = status(page, "Move announcements")
        wait(page, lambda: mann.inner_text().strip() in (status_copy("On board - detained"), status_copy("On board")),
             "Start detention announced with the move status")
        shows(page, page.locator("body"), "On board - detained")
    r = keyed(disp, f"/api/moves/{ref}/detention", {"action": "start"})
    assert r.status_code == 409 and r.json()["error"] == "detention_already_open"
    r = step(disp, ref, "Completed")
    assert r.status_code == 409 and r.json()["error"] == "detention_open"
    held = time.monotonic() + 3 * SHORT_UNIT_SECONDS
    while time.monotonic() < held:
        assert move(disp, ref)["detention"]["open"], "the span reads open until it is stopped"
    r = keyed(disp, f"/api/moves/{ref}/detention", {"action": "stop"})
    assert r.status_code == 200 and r.json()["detained"] is False
    r = keyed(disp, f"/api/moves/{ref}/detention", {"action": "stop"})
    assert r.status_code == 409 and r.json()["error"] == "detention_not_open"
    seconds = move(disp, ref)["detention"]["seconds"]
    done = step(disp, ref, "Completed")
    assert done.status_code == 200, done.text
    halves = max(0, -(-(seconds - SHORT_UNIT_SECONDS) // SHORT_UNIT_SECONDS))
    det = [ln for ln in done.json()["lines"] if ln["label"] == "Detention"]
    assert halves > 0 and len(det) == 1
    assert (det[0]["quantity"], det[0]["unit_cents"], det[0]["amount_cents"]) == \
        (halves, DETENTION_HALF_HOUR_CENTS, halves * DETENTION_HALF_HOUR_CENTS)
    assert sum(ln["amount_cents"] for ln in done.json()["lines"]) == \
        sum(a for _, a in seed_lines(done.json()["draught_mm"], done.json()["vessel"]["gross_tonnage"],
                                      done.json()["boarding_at"][11:16])) + halves * DETENTION_HALF_HOUR_CENTS


def test_wf_pilot_phone_next_job(browser, app_url):
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref, day, hhmm, pilot = soonest_job(app_url, disp, agent, "P-01")
    assert client(app_url, pilot_email(pilot)).get("/api/me/next-job").json()["move"]["ref"] == ref
    with signed_in(browser, app_url, pilot_email(pilot), "/pilot", size=(375, 812)) as page:
        wait(page, lambda: ref in body(page) and "Tern Arrow" in body(page), "next job shown")
        layout(page)
        click(page.get_by_role("button", name="Waypoints", exact=True))
        sheet = page.get_by_role("dialog", name="Waypoints", exact=True)
        expect(sheet.get_by_role("table", name="Waypoints", exact=True)).to_be_visible()
        click(sheet.get_by_role("button", name="Close waypoints", exact=True))
        wait(page, lambda: sheet.count() == 0, "sheet closed")
        ann = status(page, "Move announcements")
        for button, copy in (("Confirm pilot away", status_copy("Pilot away")),
                             ("Confirm boarding", status_copy("On board"))):
            click(page.get_by_role("button", name=button, exact=True))
            equals(page, ann, copy)
        click(page.get_by_role("button", name="Complete move", exact=True))
        wait(page, lambda: page.get_by_role("button", name="Complete move", exact=True).count() == 0,
             "the completed job leaves the pilot's next job")
    assert move(disp, ref)["status"] == "Completed"


def test_wf_pilot_phone_drawer_sheet_touch(browser, app_url):
    day = slot_day(app_url, 20)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "06:50")
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}", size=(375, 812)) as page:
        layout(page)
        for opener_name, panel_name, close_name in (("Jobs", "Jobs", "Close jobs"), ("Waypoints", "Waypoints", "Close waypoints")):
            panel = page.get_by_role("dialog", name=panel_name, exact=True)
            assert panel.count() == 0
            names = tab_order(page, 40)
            assert close_name not in names and not any(n.startswith("Plan ") for n in names if opener_name == "Jobs")
            opener = page.get_by_role("button", name=opener_name, exact=True)
            click(opener)
            wait(page, lambda: panel.count() == 1 and inside(panel), f"{panel_name} open with focus inside")
            for _ in range(10):
                page.keyboard.press("Tab")
                assert inside(panel)
            page.keyboard.press("Escape")
            advance(page, 50)
            opener.dispatch_event("click")
            advance(page, 600)
            assert panel.count() == 1 and panel.is_visible(), "reopening during exit kept the panel open"
            click(panel.get_by_role("button", name=close_name, exact=True))
            wait(page, lambda: panel.count() == 0 and focused(opener), f"{panel_name} closed, focus on opener")
        slider = page.get_by_role("region", name="Keel Section", exact=True).get_by_role("slider", name="Boarding time", exact=True)
        box = slider.bounding_box()
        assert box and box["height"] >= TOUCH_MIN_PX
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) == port_time("06:50"), "handle at committed time")
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        slider.focus()
        page.keyboard.press("ArrowRight")
        wait(page, lambda: slider.get_attribute(VALUE_TEXT) != port_time("06:50"),
             "the arrow key moved the handle to the next existing step")
        shown = slider.get_attribute(VALUE_TEXT)
        hhmm = shown[:-len(port_time(""))]
        assert shown == port_time(hhmm) and len(hhmm) == len("06:50") and int(hhmm[3:]) % 5 == 0
        layout(page)


def test_wf_pilot_phone_reduced_motion(browser, app_url):
    day = slot_day(app_url, 21)
    agent = client(app_url, CORV_AGENT)
    ref = order(agent, "V-01", day, "10:00")
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}", reduced_motion="reduce") as page:
        section = page.get_by_role("region", name="Keel Section", exact=True)
        ribbon, hull = page.get_by_test_id("gate-ribbon"), page.get_by_test_id("hull")
        click(section.get_by_role("button", name=open_window("04:30", "06:50"), exact=True))
        wait(page, lambda: ribbon.get_attribute("data-state") == "open", "gate open")
        assert animations(ribbon) == []
        ann = status(page, "Section announcements")
        equals(page, ann, f"Pinch Narrows Sill, margin {metres(NARROWS_MARGIN_MM)} m. Gate open")
        hull.evaluate(RECORD_PROGRESS)
        click(section.get_by_role("button", name="Commit window", exact=True))
        equals(page, ann,
               f"Window committed at 04:30 port time, pinch Narrows Sill {metres(NARROWS_MARGIN_MM)} m")
        for _ in range(12):
            page.clock.run_for(100)
        values = [v for _, v in page.evaluate("window.__prog")]
        assert values[-1] == "100" and set(values) <= {"0", "100"}, f"hull moved through {values}"
    assert move(agent, ref)["status"] == "Window committed"


PNG_HEAD = b"\x89PNG\r\n\x1a\n"
JPEG_HEAD = b"\xff\xd8\xff"


def test_evidence_upload_rules(app_url):
    day = slot_day(app_url, 22)
    agent, disp, tide = client(app_url, CORV_AGENT), client(app_url, DISPATCH1), client(app_url, TIDE_AGENT)
    ref = order(agent, "V-01", day, "10:00")
    s3 = S3()
    png = PNG_HEAD + os.urandom(3000)
    r = disp.post(f"/api/moves/{ref}/photos", content=png, headers={"Content-Type": "image/png"})
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["sha256"] == hashlib.sha256(png).hexdigest() and photo["size_bytes"] == len(png)
    assert photo["key"] == f"ladder-photos/{photo['photo_id']}" and s3.get(photo["key"]) == png
    got = disp.get(f"/api/photos/{photo['photo_id']}/content")
    assert got.status_code == 200 and got.content == png and got.headers["X-Checksum-Sha256"] == photo["sha256"]
    webp = b"RIFF" + os.urandom(4) + b"WEBP" + os.urandom(500)
    assert disp.post(f"/api/moves/{ref}/photos", content=webp, headers={"Content-Type": "image/webp"}).status_code == 201
    keys = set(s3.keys("ladder-photos/"))
    for ctype, data in (("image/jpeg", png), ("image/png", JPEG_HEAD + os.urandom(100)),
                        ("image/webp", b"RIFF" + os.urandom(4) + b"JUNK")):
        r = disp.post(f"/api/moves/{ref}/photos", content=data, headers={"Content-Type": ctype})
        assert r.status_code == 415
        assert r.json() == {"error": "unsupported_media_type", "message": "File content does not match its type"}
    r = disp.post(f"/api/moves/{ref}/photos", content=b"GIF89a", headers={"Content-Type": "image/gif"})
    assert r.status_code == 415 and r.json()["error"] == "unsupported_media_type"
    assert disp.post(f"/api/moves/{ref}/photos", content=b"", headers={"Content-Type": "image/png"}).status_code == 422
    big = disp.post(f"/api/moves/{ref}/photos", content=PNG_HEAD + bytes(PHOTO_LIMIT - 7),
                    headers={"Content-Type": "image/png"})
    assert big.status_code == 413 and big.json()["error"] == "payload_too_large"
    assert set(s3.keys("ladder-photos/")) == keys
    edge = disp.post(f"/api/moves/{ref}/photos", content=PNG_HEAD + bytes(PHOTO_LIMIT - 8),
                     headers={"Content-Type": "image/png"})
    assert edge.status_code == 201
    assert tide.get(f"/api/photos/{photo['photo_id']}/content").status_code == 404

    pdf = b"%PDF-1.7\n" + os.urandom(800)
    cards = f"/api/vessels/{OWN_VESSEL}/pilot-cards"
    r = agent.post(cards, content=pdf, headers={"Content-Type": "application/pdf"})
    assert r.status_code == 201, r.text
    card = r.json()
    assert card["key"] == f"pilot-cards/{OWN_VESSEL}/{card['card_id']}.pdf" and s3.get(card["key"]) == pdf
    assert card["sha256"] == hashlib.sha256(pdf).hexdigest()
    got = agent.get(f"{cards}/{card['card_id']}/content")
    assert got.content == pdf and got.headers["X-Checksum-Sha256"] == card["sha256"]
    assert tide.get(f"{cards}/{card['card_id']}/content").status_code == 404
    r = agent.post(cards, content=png, headers={"Content-Type": "application/pdf"})
    assert r.status_code == 415 and r.json()["message"] == "File content does not match its type"
    foreign_cards = f"/api/vessels/{FOREIGN_VESSEL}/pilot-cards"
    assert agent.post(foreign_cards, content=pdf, headers={"Content-Type": "application/pdf"}).status_code == 404

    down = client(os.environ["APP_MINIO_DOWN_URL"], DISPATCH1)
    r = down.post(f"/api/moves/{ORDERED_SEED}/photos", content=png, headers={"Content-Type": "image/png"})
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable", "message": "Evidence store unreachable"}


def test_ladder_report_rules(app_url, mail):
    day = slot_day(app_url, 23)
    agent, disp, tide = client(app_url, CORV_AGENT), client(app_url, DISPATCH1), client(app_url, TIDE_AGENT)
    ref = order(agent, "V-01", day, "10:00")
    other = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    pid = assign_next(disp, ref)["pilot_id"]
    pilot = client(app_url, pilot_email(pid))
    r = keyed(pilot, f"/api/moves/{ref}/ladder-reports", {"compliant": False, "defects": ["steps"]})
    assert r.status_code == 409 and r.json()["error"] == "illegal_transition"
    drive(pilot, ref, "Pilot away")
    png = PNG_HEAD + os.urandom(2000)
    photo = pilot.post(f"/api/moves/{ref}/photos", content=png, headers={"Content-Type": "image/png"}).json()
    foreign = disp.post(f"/api/moves/{other}/photos", content=png, headers={"Content-Type": "image/png"}).json()
    path = f"/api/moves/{ref}/ladder-reports"
    for bad in ({"compliant": False, "defects": []}, {"compliant": True, "defects": ["steps"]},
                {"compliant": True, "defects": [], "refuse_boarding": True}):
        assert keyed(pilot, path, bad).status_code == 422, bad
    assert foreign["photo_id"] != photo["photo_id"]
    r = keyed(pilot, path, {"compliant": False, "defects": ["side_ropes", "steps"], "refuse_boarding": True,
                            "photo_ids": [photo["photo_id"]]})
    assert r.status_code == 201, r.text
    rep = r.json()
    assert rep["refused"] is True and rep["location"] == "deck" and rep["defects"] == ["side_ropes", "steps"]
    assert rep["photos"] == [{"photo_id": photo["photo_id"], "sha256": photo["sha256"], "size_bytes": len(png)}]
    mv = move(disp, ref)
    assert mv["status"] == "Refused at ladder" and mv["pilot"] is None
    assert [(ln["label"], ln["amount_cents"]) for ln in mv["lines"]] == [("Cancellation", CANCELLATION_CENTS)]
    assert pilot.get(f"/api/moves/{ref}").status_code == 200 and pilot.get(f"/api/ladder-reports/{rep['id']}").status_code == 200
    assert step(pilot, ref, "On board").status_code == 403
    assert agent.get(f"/api/ladder-reports/{rep['id']}").json()["id"] == rep["id"]
    assert agent.get(f"/api/photos/{photo['photo_id']}/content").content == png
    assert tide.get(f"/api/ladder-reports/{rep['id']}").json() == NOT_FOUND
    assert move(agent, ref)["status"] == "Refused at ladder"
    r = agent.post(f"/api/moves/{other}/reorder", json={"boarding_at": f"{day}T12:00", "correction": "Ladder replaced"})
    assert r.status_code == 409 and r.json()["error"] == "illegal_transition"
    r = agent.post(f"/api/moves/{ref}/reorder", json={"boarding_at": f"{day}T12:00", "correction": "no"})
    assert r.status_code == 422 and "correction" in r.json()["errors"]
    find_mail(mail, lambda x: subject(x) == "Non-compliant boarding ladder: Tern Arrow" and ref in text(x), 1,
              "the pending ladder notice for this move")
    mails_before = len([x for x in mail.messages(settle=3) if ref in text(x)])
    r = agent.post(f"/api/moves/{ref}/reorder", json={"boarding_at": f"{day}T12:00", "correction": "Ladder replaced"})
    assert r.status_code == 200 and r.json()["status"] == "Ordered" and r.json()["committed"] is None
    assert r.json()["pilot"] is None and r.json()["late_amendments"] == 0 and len(r.json()["lines"]) == 1
    assert len([x for x in mail.messages(settle=3) if ref in text(x)]) == mails_before


def test_report_photo_claims(app_url):
    day = slot_day(app_url, 42)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    other = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    pilot = client(app_url, pilot_email(assign_next(disp, ref)["pilot_id"]))
    drive(pilot, ref, "Pilot away")
    png = PNG_HEAD + os.urandom(1500)
    photo = pilot.post(f"/api/moves/{ref}/photos", content=png, headers={"Content-Type": "image/png"}).json()
    foreign = disp.post(f"/api/moves/{other}/photos", content=png, headers={"Content-Type": "image/png"}).json()
    path = f"/api/moves/{ref}/ladder-reports"
    for bad in (foreign["photo_id"], "PH-NOPE"):
        r = keyed(pilot, path, {"compliant": True, "defects": [], "photo_ids": [bad]})
        assert r.status_code == 404 and r.json() == NOT_FOUND
    assert move(disp, ref)["ladder_reports"] == []
    for _ in range(2):
        r = keyed(pilot, path, {"compliant": True, "defects": [], "photo_ids": [photo["photo_id"]]})
        assert r.status_code == 201, r.text
        assert r.json()["photos"] == [{"photo_id": photo["photo_id"], "sha256": hashlib.sha256(png).hexdigest(),
                                       "size_bytes": len(png)}]
    assert len(move(disp, ref)["ladder_reports"]) == 2
    down = client(os.environ["APP_MINIO_DOWN_URL"], DISPATCH1)
    r = down.post(f"/api/moves/{AWAY_SEED}/photos", content=png, headers={"Content-Type": "image/png"})
    assert r.status_code == 503 and "photo_id" not in r.json()


def test_ladder_notice_mail(app_url, mail):
    day = slot_day(app_url, 43)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    pilot = client(app_url, pilot_email(assign_next(disp, ref)["pilot_id"]))
    drive(pilot, ref, "Pilot away")
    png = PNG_HEAD + os.urandom(2500)
    photo = pilot.post(f"/api/moves/{ref}/photos", content=png, headers={"Content-Type": "image/png"}).json()
    path = f"/api/moves/{ref}/ladder-reports"
    r = keyed(pilot, path, {"compliant": False, "defects": ["lighting", "man_ropes"], "photo_ids": [photo["photo_id"]]})
    assert r.status_code == 201, r.text
    rep = r.json()
    assert keyed(pilot, path, {"compliant": True, "defects": []}).status_code == 201

    def ladder(m):
        return subject(m) == "Non-compliant boarding ladder: Tern Arrow" and ref in text(m)

    msgs = find_mail(mail, ladder, 1, "ladder notice")
    m = msgs[0]
    assert len(msgs) == 1 and {CORV_AGENT, AUTHORITY} <= set(recipients(m))
    lowered = text(m).lower()
    assert rep["id"].lower() in lowered and photo["sha256"] in lowered
    assert "lighting" in lowered and re.search(r"man[ _]ropes", lowered)
    assert [a.get("Size") for a in m.get("Attachments") or []] == [len(png)]
    poll(lambda: move(disp, ref)["notices"],
         lambda n: any(x["kind"] == "Ladder notice" for x in n)
         and all(x["state"] == "sent" for x in n if x["kind"] == "Ladder notice"),
         "ladder notice sent on the move")


def test_wf_ladder_report_deck(browser, app_url):
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref, day, hhmm, pilot = soonest_job(app_url, disp, agent, "P-01")
    png = PNG_HEAD + os.urandom(4000)
    sha = hashlib.sha256(png).hexdigest()
    with signed_in(browser, app_url, pilot_email(pilot), "/pilot", size=(375, 812)) as page:
        wait(page, lambda: ref in body(page), "next job shown")
        click(page.get_by_role("button", name="Confirm pilot away", exact=True))
        equals(page, status(page, "Move announcements"), status_copy("Pilot away"))
        click(page.get_by_role("button", name="File ladder report", exact=True))
        dlg = page.get_by_role("dialog", name="Ladder report", exact=True)
        rann = dlg.get_by_role("status", name="Report announcements", exact=True)
        check(dlg.get_by_role("radio", name="Non-compliant", exact=True))
        assert dlg.get_by_role("radio", name="Deck", exact=True).is_checked()
        dlg.get_by_label("Ladder photo").set_input_files(
            files=[{"name": MISLABELLED_FILE, "mimeType": "image/jpeg", "buffer": MISLABELLED_BYTES}])
        equals(page, rann, "Photo is not a JPEG, PNG or WebP image.")
        shows(page, dlg, "Photo not stored")
        dlg.get_by_label("Ladder photo").set_input_files(
            files=[{"name": PHOTO_FILE, "mimeType": "image/png", "buffer": png}])
        equals(page, rann, f"Photo stored. SHA-256 {sha}")
        shows(page, dlg, f"SHA-256 {sha}")
        wait(page, lambda: "Photo not stored" not in dlg.inner_text(), "refused photo replaced")
        for name in ("Side ropes", "Steps"):
            check(dlg.get_by_role("group", name="Defects", exact=True).get_by_role("checkbox", name=name, exact=True))
        check(dlg.get_by_role("checkbox", name="Refuse boarding", exact=True))
        click(dlg.get_by_role("button", name="File report", exact=True))
        rid = str(poll(lambda: move(disp, ref)["ladder_reports"], lambda ids: len(ids) == 1,
                       "the filed report reaches the move")[0])
        page.goto(f"{app_url}/moves/{ref}")
        expect(page.get_by_role("heading", level=2, name="Boarding refused at ladder")).to_be_visible()
    mv = move(disp, ref)
    assert mv["status"] == "Refused at ladder" and rid in [str(i) for i in mv["ladder_reports"]]
    assert S3().get(f"ladder-photos/{client(app_url, CORV_AGENT).get(f'/api/ladder-reports/{rid}').json()['photos'][0]['photo_id']}") == png
    with signed_in(browser, app_url, CORV_AGENT, f"/reports/{rid}") as page:
        expect(page.get_by_role("heading", level=2, name="Boarding refused at ladder")).to_be_visible()
        shows(page, page.locator("body"), f"SHA-256 {sha}")
        photo_n = 1
        href = page.get_by_role("link", name=f"Download photo {photo_n}", exact=True).get_attribute("href")
        assert href, "the download link carries no address"
        got = client(app_url, CORV_AGENT).get(href)
        assert got.status_code == 200 and got.content == png
        assert got.headers.get("X-Checksum-Sha256") == sha


def test_wf_outage_recovery_store_down(browser):
    base = os.environ["APP_MINIO_DOWN_URL"]
    with signed_in(browser, base, pilot_email("P-10"), "/pilot", size=(375, 812)) as page:
        wait(page, lambda: "MV-1005" in body(page), "seeded Pilot away job")
        click(page.get_by_role("button", name="File ladder report", exact=True))
        dlg = page.get_by_role("dialog", name="Ladder report", exact=True)
        check(dlg.get_by_role("radio", name="Compliant", exact=True))
        dlg.get_by_label("Ladder photo").set_input_files(
            files=[{"name": PHOTO_FILE, "mimeType": "image/png", "buffer": PNG_HEAD + os.urandom(500)}])
        rann = dlg.get_by_role("status", name="Report announcements", exact=True)
        equals(page, rann, "Evidence store unreachable - photo kept on this device, retry when it returns.")
        expect(dlg.get_by_role("button", name="Retry photo upload", exact=True)).to_be_visible()
        advance(page, BOARD_REFRESH_MS * 2)
        assert rann.inner_text().strip() == "Evidence store unreachable - photo kept on this device, retry when it returns."
        shows(page, status(page, "Service announcements"), "Evidence store unreachable - photo uploads are paused until it returns.")
    disp = client(base, DISPATCH1)
    r = keyed(disp, f"/api/moves/{AWAY_SEED}/ladder-reports", {"compliant": True, "defects": []})
    assert r.status_code == 201 and r.json()["photos"] == []
    assert move(disp, "MV-1005")["status"] == "Pilot away"


def revision_body(label, effective_at, **over):
    return {"label": label, "effective_at": effective_at, "draft_foot_cents": 5000, "minimum_cents": 0,
            "tonnage_bands": [{"from_gt": 0, "to_gt": None, "cents": 100000}], "night_percent": 0,
            "detention_half_hour_cents": 10000, "detention_allowance_half_hours": 1, "cancellation_cents": 20000, **over}


def test_tariff_lines_exact(app_url):
    day = slot_day(app_url, 24)
    disp = client(app_url, DISPATCH1)

    def est(vessel, hhmm):
        v = VESSELS[vessel]
        r = disp.post("/api/plan", json={"vessel_id": vessel, "boarding_at": f"{day}T{hhmm}", "speed_kn": v["speed"],
                                         "draught_m": v["draught_m"]})
        return r.json()["estimate"]

    k = est("V-02", "12:00")
    assert [(ln["label"], ln["amount_cents"]) for ln in k["lines"]] == KESTREL_DAY and k["total_cents"] == KESTREL_DAY_TOTAL
    assert (k["lines"][0]["quantity"], k["lines"][0]["unit_cents"]) == (25, DRAFT_FOOT_CENTS)
    kn = est("V-02", "04:30")
    assert [(ln["label"], ln["amount_cents"]) for ln in kn["lines"]] == KESTREL_DAY + [("Night surcharge", KESTREL_NIGHT_CENTS)]
    assert kn["total_cents"] == KESTREL_NIGHT_TOTAL
    assert est("V-01", "12:00")["total_cents"] == sum(a for _, a in seed_lines(11200, 43500, "12:00"))
    mv = move(disp, "MV-1009")
    assert [(ln["label"], ln["amount_cents"]) for ln in mv["lines"]] == MV1009_LINES
    assert sum(ln["amount_cents"] for ln in mv["lines"]) == MV1009_TOTAL


def test_tariff_lines_fixed_at_event(app_url):
    day = free_day(store_day(app_url) + timedelta(days=FIXED_DAYS))
    agent, disp, clerk = client(app_url, CORV_AGENT), client(app_url, DISPATCH1), client(app_url, CLERK)
    ref = order(agent, "V-01", day, "10:00")
    committed(disp, ref, day, "04:30")
    assign_next(disp, ref)
    lines = drive(disp, ref, "Pilot away", "On board", "Completed")["lines"]
    label = f"L{uuid.uuid4().hex[:8]}"
    eff = datetime.combine(day - timedelta(days=1), datetime.min.time()) + timedelta(minutes=5 * RNG.randrange(288))
    r = clerk.post("/api/tariff-revisions", json=revision_body(label, eff.strftime("%Y-%m-%dT%H:%M")))
    assert r.status_code == 201, r.text
    assert move(disp, ref)["lines"] == lines
    fresh = disp.post("/api/plan", json={"vessel_id": "V-01", "boarding_at": f"{day}T04:30", "speed_kn": 10, "draught_m": 11.2})
    assert fresh.json()["estimate"]["tariff_revision"] == label


def test_wf_tariff_revisions_effective(browser, app_url):
    e_day = rand_day(app_url, EFFECTIVE_DAYS, 600)
    e2 = e_day + timedelta(days=1)
    corv, tide, disp, clerk = (client(app_url, x) for x in (CORV_AGENT, TIDE_AGENT, DISPATCH1, CLERK))
    r1_label, r2_label = '=HYPERLINK("x","y")', f"-T{uuid.uuid4().hex[:6]}"
    r1 = clerk.post("/api/tariff-revisions", json=revision_body(r1_label, f"{e_day}T12:00"))
    r2 = clerk.post("/api/tariff-revisions", json=revision_body(r2_label, f"{e2}T12:00"))
    assert r1.status_code == r2.status_code == 201, (r1.text, r2.text)
    dup = clerk.post("/api/tariff-revisions", json=revision_body("dup", f"{e_day}T12:00"))
    assert dup.status_code == 409 and dup.json()["error"] == "effective_time_taken"
    bad = clerk.post("/api/tariff-revisions", json=revision_body("two\nlines", f"{e2}T13:00"))
    assert bad.status_code == 422 and bad.json()["errors"] == {"label": "Label must be one line of 1 to 40 characters"}
    assert corv.post("/api/tariff-revisions", json=revision_body("x", f"{e2}T14:00")).status_code == 403
    before = order(corv, "V-01", e_day, "11:55")
    a = order(corv, "V-01", e_day, "12:05")
    b = order(corv, "V-01", e2, "12:05")
    x = order(tide, "V-03", e_day, "12:05")
    for ref, label in ((a, r1_label), (b, r2_label)):
        est = plan_at(disp, ref, move(disp, ref)["boarding_at"])["estimate"]
        assert est["tariff_revision"] == label
        assert [(ln["label"], ln["amount_cents"]) for ln in est["lines"]] == [("Draft foot", 37 * 5000), ("Tonnage band", 100000)]
    assert plan_at(disp, before, f"{e_day}T11:55")["estimate"]["tariff_revision"] not in (r1_label, r2_label)
    a_time = window_from(disp, a, e_day, "12:05")
    committed(disp, a, e_day, a_time)
    assign_next(disp, a)
    drive(disp, a, "Pilot away", "On board", "Completed")
    x_time = window_from(disp, x, e_day, "12:05")
    committed(disp, x, e_day, x_time)
    assign_next(disp, x)
    drive(disp, x, "Pilot away", "On board", "Completed")
    assert all(ln["tariff_revision"] == r1_label for ln in move(disp, a)["lines"])

    def rev(c, eff):
        return next(v for v in c.get("/api/tariff-revisions").json()["revisions"] if v["effective_at"] == eff)

    assert rev(corv, f"{e_day}T12:00")["moves"] == [a] and rev(corv, f"{e_day}T12:00")["label"] == r1_label
    assert {a, x} <= set(rev(clerk, f"{e_day}T12:00")["moves"])
    assert rev(tide, f"{e_day}T12:00")["moves"] == [x]
    csv = corv.get("/api/exports/moves.csv")
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    raw = csv.content.decode("utf-8")
    assert raw.startswith(CSV_HEADER + CRLF)
    assert raw.endswith(CRLF) and x not in raw
    rows = {line.split(",", 1)[0]: line for line in raw.split(CRLF) if line}
    rates = revision_body("", "")
    flat = -(-VESSELS["V-01"]["draught_mm"] * 10 // 3048) * rates["draft_foot_cents"] + rates["tonnage_bands"][0]["cents"]
    assert rows[a].startswith(f"{a},Tern Arrow,CORV,Completed,{e_day}T{a_time},")
    assert rows[a].endswith(f",{CSV_FORMULA_CELL},{flat}")
    assert rows[b] == f"{b},Tern Arrow,CORV,Ordered,{e2}T12:05,,,'{r2_label},{flat}"
    with signed_in(browser, app_url, CORV_AGENT, "/orders") as page:
        shows(page, page.locator("body"), f"Priced by {r1_label}")
        shows(page, page.locator("body"), f"Priced by {r2_label}")


def test_moves_export_csv(app_url):
    e_day = rand_day(app_url, EXPORT_DAYS, 600)
    e2 = e_day + timedelta(days=1)
    corv, disp, clerk = client(app_url, CORV_AGENT), client(app_url, DISPATCH1), client(app_url, CLERK)
    formula, dash = '=HYPERLINK("x","y")', "-T61"
    for label, day in ((formula, e_day), (dash, e2)):
        r = clerk.post("/api/tariff-revisions", json=revision_body(label, f"{day}T12:00"))
        assert r.status_code == 201, r.text
    rates = revision_body("", "")
    total = -(-VESSELS["V-01"]["draught_mm"] * 10 // 3048) * rates["draft_foot_cents"] + rates["tonnage_bands"][0]["cents"]
    a = order(corv, "V-01", e_day, "12:05")
    b = order(corv, "V-01", e2, "12:05")
    hhmm = window_from(disp, a, e_day, "12:05")
    mv = committed(disp, a, e_day, hhmm)
    pl = plan_at(disp, a, f"{e_day}T{hhmm}")
    pinch = next(w["name"] for w in pl["waypoints"] if w["id"] == pl["pinch"]["waypoint_id"])
    for c in (corv, clerk):
        raw = c.get("/api/exports/moves.csv").content.decode("utf-8")
        assert raw.endswith("\r\n")
        lines = raw.split("\r\n")[:-1]
        assert lines[0] == "ref,vessel,agency,status,boarding_at,pinch_waypoint,margin_mm,tariff_revision,total_cents"
        rows = {line.split(",", 1)[0]: line for line in lines[1:]}
        assert rows[a] == (f"{a},Tern Arrow,CORV,Window committed,{e_day}T{hhmm},{pinch},{mv['committed']['margin_mm']},"
                           f'"\'=HYPERLINK(""x"",""y"")",{total}')
        assert rows[b] == f"{b},Tern Arrow,CORV,Ordered,{e2}T12:05,,,'-T61,{total}"
    labels = [v["label"] for v in clerk.get("/api/tariff-revisions").json()["revisions"]]
    assert formula in labels and dash in labels


def test_wf_tariff_revisions_publish_ui(browser, app_url):
    eff_day = rand_day(app_url, UI_REVISION_DAYS, 600)
    label = f"U{uuid.uuid4().hex[:8]}"
    with signed_in(browser, app_url, CLERK, "/accounts") as page:
        assert page.get_by_role("spinbutton", name="Rate per draft foot", exact=True).input_value() != ""
        fill(page.get_by_role("textbox", name="Revision label", exact=True), "")
        fill(page.get_by_role("textbox", name="Effective date", exact=True), str(eff_day))
        fill(page.get_by_role("textbox", name="Effective time", exact=True), "12:00")
        click(page.get_by_role("button", name="Publish revision", exact=True))
        shows(page, page.get_by_role("alert", name="Form errors", exact=True), "Label must be one line of 1 to 40 characters")
        fill(page.get_by_role("textbox", name="Revision label", exact=True), label)
        click(page.get_by_role("button", name="Publish revision", exact=True))
        equals(page, status(page, "Billing announcements"), f"Revision {label} published, effective {eff_day} 12:00 port time")
        wait(page, lambda: label in body(page) and "T-2026-A" in body(page) and "MV-1009" in body(page),
             "revision list shows new and earlier revisions with priced refs")
    revs = client(app_url, CLERK).get("/api/tariff-revisions").json()["revisions"]
    mine = [v for v in revs if v["label"] == label]
    assert len(mine) == 1 and mine[0]["effective_at"] == f"{eff_day}T12:00"
    assert [v["effective_at"] for v in revs] == sorted(v["effective_at"] for v in revs)


def completed_kestrel(app_url, slot):
    day = slot_day(app_url, slot)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-02", day, "12:00")
    hhmm = window_from(disp, ref, day, "06:00")
    committed(disp, ref, day, hhmm)
    pid = assign_next(disp, ref)["pilot_id"]
    drive(disp, ref, "Pilot away", "On board")
    return ref, hhmm, pid


def test_billing_charges_posted(app_url, killbill):
    ref, hhmm, pid = completed_kestrel(app_url, 25)
    disp, pilot, clerk = client(app_url, DISPATCH1), client(app_url, pilot_email(pid)), client(app_url, CLERK)
    res = par(lambda: disp.post(f"/api/moves/{ref}/transitions", json={"to": "Completed"}),
              lambda: pilot.post(f"/api/moves/{ref}/transitions", json={"to": "Completed"}))
    assert sorted(r.status_code for r in res) == [200, 409]
    expected = seed_lines(VESSELS["V-02"]["draught_mm"], VESSELS["V-02"]["gt"], hhmm)
    got = kb_wait(killbill, "CORV", ref, lambda g: len(g) == 1 and len(g[0][1]) == len(expected), "one posted draft")
    assert [(i["description"], round(float(i["amount"]) * 100)) for i in got[0][1]] == [(f"{ref} {lab}", c) for lab, c in expected]
    assert got[0][0]["status"] == "DRAFT" and all(i.get("itemType") == "EXTERNAL_CHARGE" for i in got[0][1])
    inv_id = move(disp, ref)["billing"]["invoice_id"]
    poll(lambda: clerk.get(f"/api/invoices/{inv_id}").json(), lambda i: i["charge_state"] == "posted", "charges posted")
    assert len(kb_invoices(killbill, "CORV", ref)) == 1
    mv = move(disp, ref)
    assert history_count(mv, "Completed") == 1 and len(mv["billing"]["invoice_ids"]) == 1


def test_invoice_issue_once(app_url, killbill):
    ref, hhmm, _ = completed_kestrel(app_url, 44)
    disp, clerk = client(app_url, DISPATCH1), client(app_url, CLERK)
    drive(disp, ref, "Completed")
    expected = seed_lines(VESSELS["V-02"]["draught_mm"], VESSELS["V-02"]["gt"], hhmm)
    inv_id = move(disp, ref)["billing"]["invoice_id"]
    inv = poll(lambda: clerk.get(f"/api/invoices/{inv_id}").json(), lambda i: i["charge_state"] == "posted", "charges posted")
    assert inv["state"] == "pending" and inv["number"] is None and inv["total_cents"] == sum(c for _, c in expected)
    assert client(app_url, CORV_AGENT).post(f"/api/invoices/{inv_id}/issue", json={}).status_code == 403
    res = par(*[lambda: keyed(clerk, f"/api/invoices/{inv_id}/issue", {})] * 4)
    assert {r.status_code for r in res} == {200}
    assert {r.json()["state"] for r in res} == {"issued"} and len({r.json()["number"] for r in res}) == 1
    number, balance = res[0].json()["number"], res[0].json()["balance_cents"]
    kb = kb_invoices(killbill, "CORV", ref)
    assert len(kb) == 1 and kb[0][0]["status"] == "COMMITTED" and str(kb[0][0]["invoiceNumber"]) == str(number)
    assert round(float(kb[0][0]["balance"]) * 100) == balance
    again = keyed(clerk, f"/api/invoices/{inv_id}/issue", {})
    assert again.status_code == 200 and again.json()["number"] == number
    mv = move(disp, ref)
    assert mv["status"] == "Invoiced" and history_count(mv, "Invoiced") == 1
    assert client(app_url, CORV_AGENT).get(f"/api/invoices/{inv_id}").json()["number"] == number
    assert client(app_url, TIDE_AGENT).get(f"/api/invoices/{inv_id}").json() == NOT_FOUND


def test_wf_billing_invoices_issue_ui(browser, app_url, killbill):
    ref, hhmm, _ = completed_kestrel(app_url, 26)
    disp, clerk = client(app_url, DISPATCH1), client(app_url, CLERK)
    drive(disp, ref, "Completed")
    inv_id = move(disp, ref)["billing"]["invoice_id"]
    poll(lambda: clerk.get(f"/api/invoices/{inv_id}").json(), lambda i: i["charge_state"] == "posted", "charges posted")
    with signed_in(browser, app_url, CLERK, "/accounts") as page:
        shows(page, page.locator("body"), ref)
        page.get_by_role("button", name=f"Issue invoice {inv_id}", exact=True).evaluate(DOUBLE_CLICK)
        ann = status(page, "Billing announcements")
        wait(page, lambda: re.fullmatch(r"Invoice \S+ issued", ann.inner_text().strip()), "Invoice <number> issued")
        number = ann.inner_text().strip().split()[1]
    kb = kb_invoices(killbill, "CORV", ref)
    assert len(kb) == 1 and kb[0][0]["status"] == "COMMITTED" and str(kb[0][0]["invoiceNumber"]) == number
    with signed_in(browser, app_url, CORV_AGENT, f"/invoices/{inv_id}") as page:
        shows(page, page.locator("body"), number)
        page.goto(f"{app_url}/moves/{ref}")
        shows(page, page.locator("body"), "Invoiced")
    assert history_count(move(disp, ref), "Invoiced") == 1


def test_wf_billing_invoices_pending(browser):
    base = os.environ["APP_KILLBILL_DOWN_URL"]
    clerk = client(base, CLERK)
    inv = next(i for i in clerk.get("/api/invoices").json()["invoices"] if i["move_ref"] == "MV-1009")
    r = keyed(clerk, f"/api/invoices/{inv['id']}/issue", {})
    assert r.status_code == 202 and r.json()["state"] == "pending" and r.json()["number"] is None
    with signed_in(browser, base, CLERK, "/accounts") as page:
        click(page.get_by_role("button", name=f"Issue invoice {inv['id']}", exact=True))
        equals(page, status(page, "Billing announcements"), "Invoice pending provider confirmation")
        advance(page, MOVE_REREAD_MS + SERVICE_REFRESH_MS)
        assert status(page, "Billing announcements").inner_text().strip() == "Invoice pending provider confirmation"
        page.goto(f"{base}/invoices/{inv['id']}")
        shows(page, page.locator("body"), "Invoice pending provider confirmation")
    assert clerk.get(f"/api/invoices/{inv['id']}").json()["state"] == "pending"


@pytest.mark.timeout(1500)
def test_wf_outage_recovery_relay(browser, mail, killbill):
    kb_url = urlparse(os.environ["KILLBILL_URL"])
    kb_relay = Relay(kb_url.hostname, kb_url.port or 80)
    smtp_relay = Relay(os.environ["SMTP_HOST"], os.environ["SMTP_PORT"])
    env = {"KILLBILL_URL": f"http://127.0.0.1:{kb_relay.port}", "SMTP_HOST": "127.0.0.1",
           "SMTP_PORT": str(smtp_relay.port), "S3_BUCKET": os.environ["S3_BUCKET"] + RELAY_BUCKET_SUFFIX}
    try:
        with app_copy(env) as base:
            assert api(base).get("/api/health").json() == {"status": "ok"}
            poll(lambda: services(base), lambda s: s == {"billing": "down", "storage": "up", "mail": "down"},
                 "billing and mail reported down", SERVICE_WAIT_S)
            disp, clerk = client(base, DISPATCH1), client(base, CLERK)
            keys = []
            with signed_in(browser, base, DISPATCH1, f"/moves/{TERN_ON_BOARD}") as page:
                state = page.get_by_role("region", name="Service state", exact=True)
                wait(page, lambda: all(s in state.inner_text() for s in ("Billing down", "Storage up", "Mail down")),
                     "service state region")
                sann = status(page, "Service announcements")
                shows(page, sann, "Billing provider unreachable - charges and invoices are pending and will post automatically.")
                shows(page, sann, "Mail service unreachable - notices are pending and will send automatically.")
                calls = {"n": 0}

                def lose_first(route):
                    keys.append(route.request.header_value(KEY_HEADER))
                    calls["n"] += 1
                    if calls["n"] == 1:
                        route.fetch()
                        route.abort()
                    else:
                        route.continue_()

                page.route(lambda u: urlparse(u).path == f"/api/moves/{TERN_ON_BOARD}/transitions", lose_first)
                click(page.get_by_role("button", name="Complete move", exact=True))
                mann = status(page, "Move announcements")
                equals(page, mann, "No reply from the server. Showing the last confirmed state.")
                assert move(disp, "MV-1007")["status"] == "Completed"
                advance(page, BOARD_REFRESH_MS)
                assert mann.inner_text().strip() == "No reply from the server. Showing the last confirmed state."
                assert page.get_by_role("button", name="Complete move", exact=True).count() == 1
                click(page.get_by_role("button", name="Complete move", exact=True))
                equals(page, mann, "Move completed. Charges post when the billing provider confirms.")
                assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
                shows(page, page.locator("body"), "Charges pending")
                mv = move(disp, "MV-1007")
                assert mv["billing"]["state"] == "pending" and history_count(mv, "Completed") == 1
                inv_id = mv["billing"]["invoice_id"]
                r = keyed(clerk, f"/api/invoices/{inv_id}/issue", {})
                assert r.status_code == 202 and r.json()["state"] == "pending"
                assert clerk.get("/api/invoices").status_code == 200
                c = keyed(disp, f"/api/moves/{ORDERED_SEED}/cancel", {})
                assert c.status_code == 200 and c.json()["status"] == "Cancelled"
                assert {n["kind"]: n["state"] for n in c.json()["notices"]}.get("Order cancelled") == "pending"
                stamp = c.json()["boarding_at"].replace("T", " ") + " port time"

                def cancel_mail(m):
                    return subject(m) == subject_for(SUBJECT_CANCELLED, "Tern Arrow") and stamp in text(m)

                mails0 = len([m for m in mail.messages() if cancel_mail(m)])
                kb0 = len(kb_invoices(killbill, "CORV", "MV-1007"))
                kb_relay.up()
                smtp_relay.up()
                poll(lambda: services(base), lambda s: s == {"billing": "up", "storage": "up", "mail": "up"},
                     "services recovered without restart", SERVICE_WAIT_S)
                find_mail(mail, cancel_mail, mails0 + 1, "pending cancellation notice sent once")
                inv = poll(lambda: clerk.get(f"/api/invoices/{inv_id}").json(), lambda i: i["state"] == "issued",
                           "pending issue committed once the provider returned")
                assert move(disp, "MV-1007")["status"] == "Invoiced"
                wait(page, lambda: "Billing up" in state.inner_text() and "Charges posted" in body(page)
                     or (advance(page, SERVICE_REFRESH_MS) and False), "screen shows recovered state")
                assert "Billing provider unreachable" not in sann.inner_text()
                kb_after = kb_invoices(killbill, "CORV", "MV-1007")
                assert len(kb_after) == kb0 + 1
                committed_kb = [i for i, _ in kb_after if str(i.get("invoiceNumber")) == str(inv["number"])]
                assert len(committed_kb) == 1 and committed_kb[0]["status"] == "COMMITTED"
                poll(lambda: move(disp, "MV-1001")["notices"],
                     lambda n: {x["kind"]: x["state"] for x in n}.get("Order cancelled") == "sent", "notice sent state")
                time_limit = time.monotonic() + 20
                while time.monotonic() < time_limit:
                    assert len([m for m in mail.messages(settle=0) if cancel_mail(m)]) == mails0 + 1
                    assert len(kb_invoices(killbill, "CORV", "MV-1007")) == kb0 + 1
    finally:
        kb_relay.down()
        smtp_relay.down()


def test_wf_outage_recovery_instances(browser):
    cases = {"APP_KILLBILL_DOWN_URL": ("billing", "Billing down",
                                       "Billing provider unreachable - charges and invoices are pending and will post automatically."),
             "APP_MINIO_DOWN_URL": ("storage", "Storage down", "Evidence store unreachable - photo uploads are paused until it returns."),
             "APP_MAILPIT_DOWN_URL": ("mail", "Mail down", "Mail service unreachable - notices are pending and will send automatically.")}
    for env, (svc, item, copy) in cases.items():
        base = os.environ[env]
        r = api(base).get("/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        expected = {k: ("down" if k == svc else "up") for k in ("billing", "storage", "mail")}
        poll(lambda: services(base), lambda s: s == expected, f"{env} reports only {svc} down", SERVICE_WAIT_S)
        disp = client(base, DISPATCH1)
        assert disp.get(f"/api/moves/{COMPLETED_SEED}").status_code == 200 and client(base, CLERK).get("/api/invoices").status_code == 200
        with signed_in(browser, base, DISPATCH1, "/board") as page:
            shows(page, page.get_by_role("region", name="Service state", exact=True), item)
            shows(page, status(page, "Service announcements"), copy)
            expect(page.get_by_role("region", name="Keel Section", exact=True)).to_be_visible()


def test_wf_outage_recovery_work_through(browser):
    base = os.environ["APP_KILLBILL_DOWN_URL"]
    agent, disp = client(base, CORV_AGENT), client(base, DISPATCH1)
    day = slot_day(base, 1)
    ref = order(agent, "V-01", day, "10:00")
    billing_copy = "Billing provider unreachable - charges and invoices are pending and will post automatically."
    with signed_in(browser, base, DISPATCH1, f"/board?move={ref}") as page:
        shows(page, status(page, "Service announcements"), billing_copy)
        section = page.get_by_role("region", name="Keel Section", exact=True)
        commit_btn = section.get_by_role("button", name="Commit window", exact=True)
        click(section.get_by_role("button", name=open_window("04:30", "06:50"), exact=True))
        wait(page, lambda: commit_btn.is_enabled(), "gate open while billing is down")
        click(commit_btn)
        equals(page, status(page, "Section announcements"),
               f"Window committed at 04:30 port time, pinch Narrows Sill {metres(NARROWS_MARGIN_MM)} m")
        page.goto(f"{base}/moves/{KESTREL_ON_BOARD}")
        if move(disp, "MV-1008")["status"] == "On board":
            click(page.get_by_role("button", name="Complete move", exact=True))
            equals(page, status(page, "Move announcements"),
                   "Move completed. Charges post when the billing provider confirms.")
        shows(page, page.locator("body"), "Charges pending")
    assert move(disp, ref)["status"] == "Window committed"
    mv = move(disp, "MV-1008")
    assert mv["status"] == "Completed" and mv["billing"]["state"] == "pending"


def test_wf_outage_recovery_lost_reply(browser, app_url):
    day = slot_day(app_url, 45)
    agent, disp = client(app_url, CORV_AGENT), client(app_url, DISPATCH1)
    ref = order(agent, "V-02", day, "12:00")
    committed(disp, ref, day, window_from(disp, ref, day, "06:00"))
    assign_next(disp, ref)
    drive(disp, ref, "Pilot away", "On board")
    keys, calls = [], {"n": 0}
    with signed_in(browser, app_url, DISPATCH1, f"/moves/{ref}") as page:

        def lose_first(route):
            keys.append(route.request.header_value(KEY_HEADER))
            calls["n"] += 1
            if calls["n"] == 1:
                route.fetch()
                route.abort()
            else:
                route.continue_()

        page.route(lambda u: urlparse(u).path == f"/api/moves/{ref}/transitions", lose_first)
        complete = page.get_by_role("button", name="Complete move", exact=True)
        click(complete)
        mann = status(page, "Move announcements")
        equals(page, mann, "No reply from the server. Showing the last confirmed state.")
        assert move(disp, ref)["status"] == "Completed"
        advance(page, BOARD_REFRESH_MS)
        assert mann.inner_text().strip() == "No reply from the server. Showing the last confirmed state."
        assert complete.count() == 1
        click(complete)
        equals(page, mann, "Move completed. Charges post when the billing provider confirms.")
    assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
    mv = move(disp, ref)
    assert mv["status"] == "Completed" and history_count(mv, "Completed") == 1 and len(mv["billing"]["invoice_ids"]) == 1


def test_wf_board_layout_breakpoints(browser, app_url):
    with signed_in(browser, app_url, DISPATCH1, "/board") as page:
        for size in ((1280, 800), (768, 1024), (375, 812)):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            advance(page, 500)
            layout(page)
            page.evaluate("window.scrollTo(0, 0)")
            advance(page, 300)
            sec = page.get_by_role("region", name="Keel Section", exact=True).bounding_box()
            moves = page.get_by_role("region", name="Moves", exact=True)
            mb = moves.bounding_box()
            assert sec["y"] < mb["y"]
            if size[0] == 1280:
                qb = page.get_by_role("region", name="Order queue", exact=True).bounding_box()
                tb = page.get_by_role("region", name="Pilot turn list", exact=True).bounding_box()
                assert qb["x"] + qb["width"] <= mb["x"] + 1 and mb["x"] + mb["width"] <= tb["x"] + 1
                assert abs(qb["y"] - mb["y"]) < 2 and abs(mb["y"] - tb["y"]) < 2
                page.mouse.wheel(0, 600)
                advance(page, 300)
                assert abs(page.get_by_role("region", name="Keel Section", exact=True).bounding_box()["y"] - 0) < 2 or \
                    page.get_by_role("region", name="Keel Section", exact=True).bounding_box()["y"] >= 0
            elif size[0] == 768:
                qb = page.get_by_role("region", name="Order queue", exact=True).bounding_box()
                tb = page.get_by_role("region", name="Pilot turn list", exact=True).bounding_box()
                assert abs(qb["x"] - mb["x"]) < 2 and qb["y"] < mb["y"] and tb["x"] >= mb["x"] + mb["width"] - 1
                assert page.get_by_role("button", name="Waypoint table", exact=True).get_attribute("aria-expanded") == "true"
            else:
                assert sec["height"] <= size[1] / 3 + 1
                assert page.get_by_role("region", name="Order queue", exact=True).count() == 0
                expect(page.get_by_role("button", name="Jobs", exact=True)).to_be_visible()


def test_wf_board_layout_search_url(browser, app_url):
    day = slot_day(app_url, 27)
    corv, tide = client(app_url, CORV_AGENT), client(app_url, TIDE_AGENT)
    ref = order(corv, "V-01", day, "10:00")
    foreign = order(tide, "V-03", day, "10:00")
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as page:
        depth = page.evaluate("history.length")
        box = page.get_by_role("searchbox", name="Search moves", exact=True)
        fill(box, ref)
        equals(page, status(page, "Board announcements"), count_copy(1))
        q = parse_qs(urlparse(page.url).query)
        assert q.get("q") == [ref] and q.get("move") == [ref] and page.evaluate("history.length") == depth
        moves = page.get_by_role("region", name="Moves", exact=True)
        assert moves.get_by_role("button", name=f"Open {ref}", exact=True).count() == 1
        advance(page, BOARD_REFRESH_MS * 2 + 1000)
        assert parse_qs(urlparse(page.url).query).get("q") == [ref]
        link = page.url
        page.reload()
        wait(page, lambda: page.get_by_role("searchbox", name="Search moves", exact=True).input_value() == ref, "q restored on reload")
        fill(page.get_by_role("searchbox", name="Search moves", exact=True), "")
        wait(page, lambda: "q" not in parse_qs(urlparse(page.url).query), "clearing removes q")
        page.goto(f"{app_url}/board?move={UNKNOWN_REF}")
        wait(page, lambda: "move" not in parse_qs(urlparse(page.url).query), "unknown move removed from address")
    with signed_in(browser, app_url, DISPATCH2, None) as page:
        page.goto(link)
        wait(page, lambda: page.get_by_role("searchbox", name="Search moves", exact=True).input_value() == ref, "shared link search")
        assert parse_qs(urlparse(page.url).query).get("move") == [ref]
    with signed_in(browser, app_url, CORV_AGENT, f"/orders?q={foreign}") as page:
        equals(page, status(page, "Board announcements"), count_copy(0))
        assert foreign not in body(page)
        fill(page.get_by_role("searchbox", name="Search moves", exact=True), ref)
        equals(page, status(page, "Board announcements"), count_copy(1))
        page.reload()
        wait(page, lambda: page.get_by_role("searchbox", name="Search moves", exact=True).input_value() == ref, "agent q restored")
    assert foreign not in [m["ref"] for m in corv.get("/api/moves", params={"q": foreign}).json()["moves"]]


def test_wf_board_layout_search(browser, app_url):
    day = slot_day(app_url, 46)
    corv, tide = client(app_url, CORV_AGENT), client(app_url, TIDE_AGENT)
    ref = order(corv, "V-01", day, "10:00")
    foreign = order(tide, "V-03", day, "10:00")
    with signed_in(browser, app_url, DISPATCH1, "/board") as page:
        page.evaluate("window.__inplace = true")
        box = page.get_by_role("searchbox", name="Search moves", exact=True)
        ann = status(page, "Board announcements")
        moves = page.get_by_role("region", name="Moves", exact=True)
        fill(box, foreign)
        equals(page, ann, count_copy(1))
        wait(page, lambda: moves.get_by_role("button", name=f"Open {foreign}", exact=True).count() == 1
             and moves.get_by_role("button", name=f"Open {ref}", exact=True).count() == 0, "board list filtered to the typed ref")
        fill(box, ref)
        wait(page, lambda: moves.get_by_role("button", name=f"Open {ref}", exact=True).count() == 1
             and moves.get_by_role("button", name=f"Open {foreign}", exact=True).count() == 0, "board list follows the new text")
        assert ann.inner_text().strip() == count_copy(1)
        assert page.evaluate("window.__inplace === true"), "search reloaded the page"
    with signed_in(browser, app_url, CORV_AGENT, "/orders") as page:
        page.evaluate("window.__inplace = true")
        box = page.get_by_role("searchbox", name="Search moves", exact=True)
        ann = status(page, "Board announcements")
        fill(box, foreign)
        equals(page, ann, count_copy(0))
        assert foreign not in body(page)
        fill(box, ref)
        equals(page, ann, count_copy(1))
        assert ref in body(page) and page.evaluate("window.__inplace === true")
    assert foreign not in [m["ref"] for m in corv.get("/api/moves", params={"q": foreign}).json()["moves"]]


def test_wf_handover_commit(browser, app_url):
    day = slot_day(app_url, 28)
    ref = order(client(app_url, CORV_AGENT), "V-01", day, "10:00")
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as p1:
        fill(p1.get_by_role("searchbox", name="Search moves", exact=True), ref)
        wait(p1, lambda: "q=" in p1.url, "search written to the address")
        with signed_in(browser, app_url, DISPATCH2, None) as p2:
            p2.goto(p1.url)
            wait(p2, lambda: p2.get_by_role("searchbox", name="Search moves", exact=True).input_value() == ref, "shared link opened")
            for p in (p1, p2):
                s = p.get_by_role("region", name="Keel Section", exact=True)
                click(s.get_by_role("button", name=open_window("04:30", "06:50"), exact=True))
                wait(p, lambda: s.get_by_role("button", name="Commit window", exact=True).is_enabled(), "gate open")
            click(p1.get_by_role("region", name="Keel Section", exact=True).get_by_role("button", name="Commit window", exact=True))
            equals(p1, status(p1, "Section announcements"),
                   f"Window committed at 04:30 port time, pinch Narrows Sill {metres(NARROWS_MARGIN_MM)} m")
            s2 = p2.get_by_role("region", name="Keel Section", exact=True)
            click(s2.get_by_role("button", name="Commit window", exact=True))
            equals(p2, status(p2, "Section announcements"),
                   "Commit refused: another dispatcher changed this move. Section redrawn from fresh data.")
            assert history_count(move(client(app_url, DISPATCH1), ref), "Window committed") == 1
            click(s2.get_by_role("button", name=open_window("04:30", "06:50"), exact=True))
            wait(p2, lambda: s2.get_by_role("button", name="Commit window", exact=True).is_enabled(), "gate open again")
            click(s2.get_by_role("button", name="Commit window", exact=True))
            equals(p2, status(p2, "Section announcements"),
                   f"Window committed at 04:30 port time, pinch Narrows Sill {metres(NARROWS_MARGIN_MM)} m")


def test_wf_handover_assign(browser, app_url, mail):
    day = slot_day(app_url, 29)
    disp = client(app_url, DISPATCH1)
    ref = order(client(app_url, CORV_AGENT), "V-01", day, "10:00")
    committed(disp, ref, day, "06:50")
    el = eligibility(disp, ref)
    name = turn_entry(el, el["next_eligible"])["name"]
    with signed_in(browser, app_url, DISPATCH1, f"/board?move={ref}") as p1, \
            signed_in(browser, app_url, DISPATCH2, f"/board?move={ref}") as p2:
        for p in (p1, p2):
            click(p.get_by_role("button", name=f"Assign pilot to {ref}", exact=True))
            check(p.get_by_role("dialog", name="Assign pilot", exact=True).get_by_role("radio", name=re.compile(rf"^{re.escape(name)}\b")))
        click(p1.get_by_role("dialog", name="Assign pilot", exact=True).get_by_role("button", name="Assign", exact=True))
        equals(p1, status(p1, "Board announcements"), f"Pilot {name} assigned to {ref}")
        click(p2.get_by_role("dialog", name="Assign pilot", exact=True).get_by_role("button", name="Assign", exact=True))
        b2 = status(p2, "Board announcements")
        equals(p2, b2, "Another dispatcher changed this move. Fresh data shown.")
        advance(p2, BOARD_REFRESH_MS * 2 + 1000)
        assert b2.inner_text().strip() == "Another dispatcher changed this move. Fresh data shown."
        wait(p2, lambda: "Pilot assigned" in p2.get_by_role("region", name="Moves", exact=True).inner_text(), "fresh status shown")
    mv = move(disp, ref)
    assert mv["status"] == "Pilot assigned" and history_count(mv, "Pilot assigned") == 1
    stamp = f"{day} 06:50 port time"
    confirmed = subject_for(SUBJECT_CONFIRMED, "Tern Arrow")
    assert len(find_mail(mail, lambda m: subject(m) == confirmed and stamp in text(m), 1, "one confirmation")) == 1


def test_wf_access_roles_isolation(browser, app_url):
    day = slot_day(app_url, 30)
    corv, tide, clerk = client(app_url, CORV_AGENT), client(app_url, TIDE_AGENT), client(app_url, CLERK)
    own_assigned = move(tide, "MV-1004")
    assert own_assigned["pilot"] is not None
    assert "dispatcher_notes" not in own_assigned and "rest_override" not in own_assigned
    assert "dispatcher_notes" in move(client(app_url, DISPATCH1), "MV-1004")
    x = order(tide, "V-03", day, "10:00")
    assert corv.get(f"/api/moves/{x}").json() == NOT_FOUND
    assert corv.get(f"/api/moves/{UNKNOWN_REF}").status_code == 404
    assert corv.get(f"/api/moves/{UNKNOWN_REF}").json() == corv.get(f"/api/moves/{x}").json()
    r = corv.post(f"/api/moves/{x}/commit", json={}, headers={"If-Match": '"1"'})
    assert r.status_code == 404 and r.json() == NOT_FOUND
    assert corv.post(f"/api/moves/{x}/cancel", json={}).json() == NOT_FOUND
    r = keyed(corv, "/api/moves", {"vessel_id": "V-03", "boarding_at": f"{day}T10:00", "speed_kn": 10,
                                   "duty_minutes": 300, "draught_m": 9.8})
    assert r.status_code == 404 and r.json() == NOT_FOUND
    assert {v["id"] for v in corv.get("/api/vessels").json()["vessels"]} == {"V-01", "V-02"}
    assert x not in corv.get("/api/moves", params={"q": x}).text and x not in corv.get("/api/exports/moves.csv").text
    assert all(i["agency_code"] == "CORV" for i in corv.get("/api/invoices").json()["invoices"])
    tide_inv = next(i for i in clerk.get("/api/invoices").json()["invoices"] if i["move_ref"] == "MV-1010")
    assert corv.get(f"/api/invoices/{tide_inv['id']}").json() == NOT_FOUND
    seed = next(v for v in corv.get("/api/tariff-revisions").json()["revisions"] if v["label"] == "T-2026-A")
    assert "MV-1009" in seed["moves"] and "MV-1010" not in seed["moves"]
    assert {"MV-1009", "MV-1010"} <= set(next(v for v in clerk.get("/api/tariff-revisions").json()["revisions"]
                                              if v["label"] == "T-2026-A")["moves"])
    with signed_in(browser, app_url, CORV_AGENT, f"/moves/{x}") as page:
        expect(page.get_by_role("heading", level=1, name="We can't find that record")).to_be_visible()
        assert x not in body(page) or "We can't find that record" in body(page)
        page.goto(f"{app_url}/moves/{UNKNOWN_REF}")
        expect(page.get_by_role("heading", level=1, name="We can't find that record")).to_be_visible()
        page.goto(f"{app_url}/invoices/{tide_inv['id']}")
        expect(page.get_by_role("heading", level=1, name="We can't find that record")).to_be_visible()


def test_wf_access_roles_signin(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        wait(page, lambda: urlparse(page.url).path == "/login", "anonymous / goes to /login")
        fill(page.get_by_role("textbox", name="Email", exact=True), DISPATCH1)
        fill(page.get_by_role("textbox", name="Password", exact=True), "wrong-password")
        click(page.get_by_role("button", name="Sign in", exact=True))
        shows(page, page.locator("body"), "Email or password is incorrect")
    for email, landing in ((DISPATCH1, "/board"), (CORV_AGENT, "/orders"), (CLERK, "/accounts"), (pilot_email("P-03"), "/pilot")):
        with signed_in(browser, app_url, email, "/") as page:
            wait(page, lambda: urlparse(page.url).path == landing, f"{email} lands on {landing}")
            expect(page.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
    anon = api(app_url)
    r = anon.post("/api/session", json={"email": DISPATCH1, "password": "wrong-password"})
    assert r.status_code == 401 and r.json()["error"] == "invalid_credentials"
    r = anon.get("/api/moves")
    assert r.status_code == 401 and r.json()["error"] == "unauthenticated"
    ok = anon.post("/api/session", json={"email": CORV_AGENT, "password": PASSWORD})
    assert "HttpOnly".lower() in ok.headers.get(SET_COOKIE, "").lower()
    agent, clerk, pilot, disp = (client(app_url, e) for e in (CORV_AGENT, CLERK, pilot_email("P-03"), DISPATCH1))
    for c, method, path, body_ in ((agent, "POST", "/api/tide-revisions", {"date": "2030-01-01", "events": []}),
                                   (clerk, "GET", "/api/vessels", None), (pilot, "POST", "/api/tariff-revisions", {}),
                                   (disp, "POST", "/api/moves", {}), (agent, "GET", "/api/pilots", None),
                                   (clerk, "GET", f"/api/moves/{ORDERED_SEED}/plan", None)):
        r = c.request(method, path, json=body_)
        assert r.status_code == 403 and r.json()["error"] == "forbidden", (path, r.status_code)


def test_wf_cross_cutting_health_and_port(browser, app_url):
    r = api(app_url).get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    p = port_info(app_url)
    assert p["port"] == "Port Ansell" and p["zone"] == "America/Halifax" and p["step_minutes"] == 5
    assert [w["name"] for w in p["waypoints"]] == WAYPOINT_NAMES
    with open_app(browser, app_url + "/login") as page:
        expect(page.get_by_role("button", name="Sign in", exact=True)).to_be_visible()


def test_wf_cross_cutting_boundary(browser, app_url):
    disp = client(app_url, DISPATCH1)
    big = disp.post("/api/plan", content=b'{"pad":"' + b"a" * (JSON_LIMIT - 9) + b'"}', headers={"Content-Type": "application/json"})
    assert big.status_code == 413 and big.json()["error"] == "payload_too_large" and "message" in big.json()
    edge = disp.post("/api/plan", content=b'{"pad":"' + b"a" * (JSON_LIMIT - 10) + b'"}', headers={"Content-Type": "application/json"})
    assert edge.status_code != 413
    r = disp.post("/api/plan", content=b"vessel=V-01", headers={"Content-Type": "text/plain"})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type", "message": "Unsupported content type"}
    r = disp.post("/api/tide-revisions", json={"date": "2030-01-01", "events": []}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403 and r.json()["error"] == "forbidden"
    secrets = [os.environ.get(k, "") for k in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY",
                                               "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    secrets = [s for s in secrets if len(s) >= 6]
    config_names = ("KILLBILL_URL", "S3_ENDPOINT", "SMTP_HOST", "run-manifest-v1")
    for path in ("/package.json", "/run.json", "/.env", "/tsconfig.json", "/src/server.ts", "/node_modules/.package-lock.json"):
        r = api(app_url).get(path)
        leaked = [s for s in (*secrets, *config_names) if s in r.text]
        assert not leaked, f"{path} served source, environment or credential content: {leaked}"
    with signed_in(browser, app_url, DISPATCH1, None) as page:
        seen = []
        page.on("request", lambda req: seen.append(req.url))
        bodies = []
        page.on("response", lambda resp: bodies.append(resp))
        page.goto(app_url + "/board")
        advance(page, 3000)
        assert all(u.startswith(app_url) or u.startswith("data:") or u.startswith("blob:") for u in seen), seen
        for resp in bodies:
            with contextlib.suppress(Exception):
                t = resp.text()
                assert not any(s in t for s in secrets), f"secret value served in {resp.url}"


def test_if_run_manifest():
    data = json.loads((APP / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    assert all(isinstance(data.get(k), str) and data[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing}"
    for font in ("Saira Condensed", "IBM Plex Sans"):
        assert font in notices


def test_if_licences_allowed():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_no_datastore_server():
    pkg = json.loads((APP / "package.json").read_text())
    deps = set(pkg.get("dependencies", {})) | set(pkg.get("devDependencies", {}))
    forbidden = {"pg", "mysql", "mysql2", "mongodb", "mongoose", "redis", "ioredis", "cassandra-driver", "@prisma/client"}
    assert not deps & forbidden, deps & forbidden


def test_if_service_definitions_untouched():
    files = [p for p in APP.glob("*") if re.fullmatch(r"(docker-)?compose.*\.ya?ml", p.name)]
    for f in files:
        if (APP / ".git").exists():
            r = subprocess.run(["git", "-C", str(APP), "diff", "--quiet", "HEAD", "--", f.name], capture_output=True, timeout=60)
            assert r.returncode == 0, f"{f.name} changed from the provided definition"
        content = f.read_text().lower()
        for svc in ("mailpit", "killbill", "minio"):
            assert svc in content, f"{f.name} lost service {svc}"


def test_if_no_credentials_in_repository():
    secrets = [os.environ.get(k, "") for k in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY",
                                               "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    secrets = [s.encode() for s in secrets if len(s) >= 6 and not s.isalpha()]
    assert secrets, "no distinctive credential value to scan for"
    skip = {"node_modules", ".git", "dist", "build"}
    hits = []
    for path in APP.rglob("*"):
        if path.is_file() and not (set(path.relative_to(APP).parts) & skip) and path.stat().st_size < 5_000_000:
            data = path.read_bytes()
            hits += [str(path) for s in secrets if s in data]
    assert not hits, f"credential values found in repository files: {hits}"
