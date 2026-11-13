import contextlib
import hashlib
import json
import os
import re
import socket
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (advance, center, click, fill, held, layout, open_app, same_origin, select, session, shipped_packages,
                      style, tab_order, unique)

try:
    from postgres import Postgres
except ImportError:
    from conftest import Postgres
try:
    from minio import S3
except ImportError:
    from conftest import S3
try:
    from mailpit import addresses, text
except ImportError:
    from conftest import addresses, text

D = Decimal

PASSWORD = "channel-season-26"
MILLI = D("0.001")
TINY = "0.001"
STROKE_ML = "1.000"
REASON = "Heatwave cut on the channel"
ZONE = ZoneInfo("Australia/Sydney")
HORIZON_H = 240
MAX_WINDOW_H = 72
TAP_PX = 44
DIALOG_MAX_W = 560
FORM_MAX_W = 640
BODY_LIMIT = 16384
PACK_LIMIT = 2000000
LIVE_MS = 5000
STEP_MS = 500
DWELL_MS = 1000
COUNT_MS = 600
QUOTE_MS = 1000
RESUME_S = 30
FRAME_MS = 50
SLACK_S = 10
LIVE_SLACK_MS = 2000
UI_WAIT_MS = 10000
REAL_WAIT_MS = 600
TRY_MS = 250
HTTP_TIMEOUT_S = 30
MAIL_WAIT_S = 30
PACK_WAIT_S = 60
COVER_SLACK_S = 240
LAPSE_LEAD_S = 150
LAPSE_WAIT_S = 4200
FAR_SLOT_H = HORIZON_H + 2
FAR_SPAN_H = 200
TAB_PRESSES = 40
PAST_FIRST_DAY, PAST_LAST_DAY, PAST_SLOTS = 3, 400, 9
STROKE_WINDOW_H = 72
STROKE_CAP = "1000.000"
OUTAGE_HOST, OUTAGE_PORT = "127.0.0.1", 9
RELAY_CONNECT_S = 5
HALF = "0.500"
SMALL = "0.300"
PLACED = "0.600"
CUT = "7.000"
CAP_HIGH = "100.000"
CAP_HIGHER = "110.000"
CAP_LOWER = "90.000"
TYPED = "90"
OTHER_CAP = "70.000"
DRAFT_ML = "3.5"
UNKNOWN = "NOPE"
MALFORMED_ID = "%00"
JUNK = "x"
EVIL_HOST = "evil.example"
SLASH = "/"

VIEWPORTS = {"375": (375, 812), "768": (768, 1024), "1280": (1280, 800)}
VIEWPORT_IDS = ["375", "768", "1280"]
MOTION_MODES = ["no-preference", "reduce"]
STATUS_LABEL = {"upcoming": "Not yet open", "open": "Open", "closing": "Closing: final 30 minutes", "closed": "Closed"}
LAPSE_CHANNELS = {"C-12": ("lin", "T12-03", "mara", "T12-04"), "C-09": ("dev", "T9-05", "mara", "T9-02"),
                  "C-L4": ("lin", "T4-15", "mara", "T4-09")}

EMAIL = {"mara": "mara@growers.example", "dev": "dev@growers.example", "lin": "lin@growers.example",
         "rory": "rory@wirrinbah.example", "tess": "tess@wirrinbah.example", "jo": "jo@contractors.example",
         "sam": "sam@contractors.example", "hal": "hal@wirrinbah.example", "bea": "bea@wirrinbah.example",
         "priya": "priya@wirrinbah.example", "quinn": "quinn@regulator.example"}
NAMES = {"mara": "Mara Ellison", "dev": "Dev Okafor", "lin": "Lin Barrow", "rory": "Rory Kemp", "tess": "Tess Nguyen",
         "jo": "Jo Calder", "sam": "Sam Pirelli", "hal": "Hal Whitcombe", "bea": "Bea Lindqvist", "priya": "Priya Anand",
         "quinn": "Quinn Mabry"}
ROLE = {"mara": "grower", "dev": "grower", "lin": "grower", "rory": "channel operator", "tess": "channel operator",
        "hal": "dispatcher", "priya": "records clerk", "quinn": "regulator reviewer"}
HOME = {"grower": "/grower", "channel operator": "/field", "dispatcher": "/board", "records clerk": "/packs",
        "regulator reviewer": "/review"}
CODE_WHO = {"OP-D-01": "rory", "OP-D-02": "tess", "OP-C-07": "jo", "OP-C-08": "sam"}
CONTRACTORS = {"OP-C-07": ("Jo Calder", "jo", "0491 570 156"), "OP-C-08": ("Sam Pirelli", "sam", "0491 570 159")}
CHANNEL_NAME = {"C-L4": "Lateral 4", "C-09": "Channel 9", "C-12": "Channel 12 Spur"}
RAIL = ["C-L4", "C-09", "C-12"]
TURNOUTS = {"mara": {"C-L4": "T4-09", "C-09": "T9-02", "C-12": "T12-04"}, "lin": {"C-L4": "T4-15", "C-12": "T12-03"},
            "dev": {"C-L4": "T4-11", "C-09": "T9-05"}}
MAX_RATE = {"T4-07": "40.000", "T4-09": "40.000", "T4-11": "30.000", "T4-15": "25.000", "T9-02": "60.000",
            "T9-05": "30.000", "T12-03": "20.000", "T12-04": "20.000"}
ALLOCATION = {"mara": "120.000", "dev": "80.000", "lin": "40.000"}
ASKED = ("30.000", "20.000")
ASKED_SMALL = ("3.000", "2.000")
PAIRS = {"C-09": ("mara", "T9-02", "dev", "T9-05"), "C-L4": ("mara", "T4-09", "lin", "T4-15")}
PAIR_SPEC = {True: {"C-09": (16, "120.000"), "C-L4": (20, "60.000")},
             False: {"C-L4": (2, "60.000"), "C-09": (2, "60.000")}}
OUTAGES = {"minio-down": ("APP_MINIO_DOWN_URL", "_minio_down", "-minio-down"),
           "mailpit-down": ("APP_MAILPIT_DOWN_URL", "_mailpit_down", "-mailpit-down")}
MARA_C09 = TURNOUTS["mara"]["C-09"]
REMOVE_MARA_C09 = f"Remove holder {MARA_C09}"
TESS_OPTION = f"{NAMES['tess']} (OP-D-02)"


def q3(x) -> str:
    return str(D(str(x)).quantize(MILLI, ROUND_HALF_UP))


def ts(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def fmt(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local_date(s: str) -> str:
    return ts(s).astimezone(ZONE).date().isoformat()


def figure(s: str) -> Decimal:
    m = re.search(r"-?\d+\.\d{3}", s)
    assert m, f"no three-decimal figure in {s!r}"
    return D(m.group(0))


def turnout_max(turnout, hours) -> str:
    return q3(D(MAX_RATE[turnout]) * D(str(hours)) / 24)


def rate_of(volume, hours) -> str:
    return q3(D(str(volume)) * 24 / D(str(hours)))


def poll(fn, seconds, interval=0.5):
    deadline = time.monotonic() + seconds
    last = None
    expired = False
    while not expired:
        expired = time.monotonic() > deadline
        last = fn()
        if last:
            return last
        if not expired:
            threading.Event().wait(interval)
    pytest.fail(f"condition not met within {seconds} s (last {last!r})")


def together(*fns):
    out = [None] * len(fns)
    gate = threading.Barrier(len(fns))

    def run(i, fn):
        gate.wait()
        out[i] = fn()

    threads = [threading.Thread(target=run, args=(i, f)) for i, f in enumerate(fns)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


def _cm(obj):
    return obj if hasattr(obj, "__enter__") else contextlib.contextmanager(lambda: obj)()


def hold(page, glob):
    return _cm(held(page, glob))


class Api:
    def __init__(self, base, who=None):
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, follow_redirects=False)
        self.who = who
        if who:
            r = self.sign_in(EMAIL[who])
            assert r.status_code == 200, f"sign-in as {who}: {r.status_code} {r.text[:200]}"

    def sign_in(self, email, password=PASSWORD):
        return self.c.post("/api/session", json={"email": email, "password": password})

    def get(self, path, params=None):
        return self.c.get(path, params=params)

    def post(self, path, body=None):
        return self.c.post(path, json={} if body is None else body)

    def put(self, path, body):
        return self.c.put(path, json=body)

    def delete(self, path):
        return self.c.delete(path)

    def j(self, method, path, body=None, status=200, params=None):
        if method == "GET":
            r = self.get(path, params)
        elif method == "DELETE":
            r = self.delete(path)
        elif method == "PUT":
            r = self.put(path, body)
        else:
            r = self.post(path, body)
        return ok(r, status)

    def cookies(self):
        return [{"name": c.name, "value": c.value, "url": self.base} for c in self.c.cookies.jar]


def ok(r, status=200):
    assert r.status_code == status, f"{r.request.method} {r.request.url}: {r.status_code} {r.text[:500]}"
    return r.json()


def err(r, status, code):
    assert r.status_code == status, f"{r.request.method} {r.request.url}: {r.status_code} {r.text[:500]}"
    body = r.json()
    assert body.get("error") == code and isinstance(body.get("message"), str) and body["message"], body
    return body


def field_err(r, field):
    assert r.status_code == 422, f"{r.request.method} {r.request.url}: {r.status_code} {r.text[:500]}"
    errors = r.json()["errors"]
    assert field in errors and isinstance(errors[field], str), errors
    return errors[field]


def place(api, turnout, window_id, volume, operator="OP-D-01", standby=None):
    return api.post("/api/orders", {"turnout": turnout, "window_id": window_id, "volume_ml": volume,
                                    "operator_code": operator, "standby_code": standby})


def alloc(api) -> Decimal:
    return D(api.j("GET", "/api/me/allocation")["remaining_ml"])


def window(d, wid) -> dict:
    return d.j("GET", f"/api/windows/{wid}")["window"]


def windows_of(d, ch):
    body = d.j("GET", "/api/windows", params={"channel": ch})
    return ts(body["server_time"]), body["windows"]


def server_now(d) -> datetime:
    return windows_of(d, "C-L4")[0]


def cards(d, wid) -> list:
    return d.j("GET", "/api/gate-cards", params={"window": wid})["cards"]


def card_of(d, wid, number, kind, state="open") -> dict:
    found = [c for c in cards(d, wid) if c["order_number"] == number and c["kind"] == kind
             and (state is None or c["state"] == state)]
    assert found, f"no {state} {kind} card for {number}"
    return found[-1]


def outage_url(name) -> str:
    var = OUTAGES[name][0]
    assert os.environ.get(var), f"{var} is not set"
    return os.environ[var].rstrip("/")


def observers(name):
    if name == "primary":
        return Postgres(), S3()
    return Postgres(OUTAGES[name][1]), S3(OUTAGES[name][2])


def safe_keys(s3, prefix):
    try:
        return s3.keys(prefix)
    except Exception:
        return []


def overlaps(ws, start, end):
    return [x for x in ws if ts(x["opens_at"]) < end and ts(x["closes_at"]) > start]


def free_start(ws, start, hours, latest):
    s = start
    while s <= latest:
        hit = overlaps(ws, s, s + timedelta(hours=hours))
        if not hit:
            return s
        s = max(ts(x["closes_at"]) for x in hit)
    return None


def create_window(d, ch, opens, hours, cap, rostered="OP-D-01"):
    return d.post(f"/api/channels/{ch}/windows", {"opens_at": fmt(opens), "closes_at": fmt(opens + timedelta(hours=hours)),
                                                  "cap_ml_day": cap, "rostered_operator": rostered})


def find_upcoming(d, ch, hours):
    now, ws = windows_of(d, ch)
    earliest = now.replace(minute=0, second=0) + timedelta(hours=2)
    return free_start(ws, earliest, hours, now + timedelta(hours=HORIZON_H - 1))


def upcoming_window(d, ch, hours, cap, rostered="OP-D-01") -> dict:
    s = find_upcoming(d, ch, hours)
    if s is None:
        pytest.fail(f"no free orderable {hours} h slot left on {ch}")
    return ok(create_window(d, ch, s, hours, cap, rostered), 201)["window"]


def quiet_window(d, ch, hours, cap) -> dict:
    _, ws = windows_of(d, ch)
    for x in ws:
        if x["status"] == "upcoming" and x["orderable"] and D(str(x["hours"])) == hours \
                and x["table_cap_ml_day"] == cap and x["restriction_cap_ml_day"] is None \
                and x["committed_ml"] == "0.000" and x["rostered_operator"] == "OP-D-01":
            return x
    return upcoming_window(d, ch, hours, cap)


def past_window(d, ch) -> dict:
    now, ws = windows_of(d, ch)
    for day in range(PAST_FIRST_DAY, PAST_LAST_DAY):
        base = (now - timedelta(days=day)).replace(hour=2, minute=0, second=0)
        for k in range(PAST_SLOTS):
            s = base + timedelta(hours=k)
            if not overlaps(ws, s, s + timedelta(hours=1)):
                return ok(create_window(d, ch, s, 1, "24.000"), 201)["window"]
    pytest.fail(f"no free past slot on {ch}")


def same_day_window(d, w) -> dict:
    day = local_date(w["opens_at"])
    for ch in ("C-09", "C-L4", "C-12"):
        _, ws = windows_of(d, ch)
        for k in range(PAST_SLOTS * 2):
            s = ts(w["opens_at"]) + timedelta(minutes=30 * k)
            if local_date(fmt(s)) == day and not overlaps(ws, s, s + timedelta(hours=1)):
                return ok(create_window(d, ch, s, 1, "24.000"), 201)["window"]
    pytest.fail(f"no free slot on {day}")


def stroke_window(d) -> dict:
    now, ws = windows_of(d, "C-12")
    for x in ws:
        if x["status"] in ("open", "closing") and ts(x["closes_at"]) - now >= timedelta(hours=1) \
                and x["rostered_operator"] == "OP-D-01" and D(x["remaining_ml"]) >= D("100.000"):
            return x
    opens = now - timedelta(minutes=1)
    if overlaps(ws, opens, opens + timedelta(hours=1)):
        pytest.fail("C-12 holds a window ending within the hour; no open window can be created now")
    later = [ts(x["opens_at"]) for x in ws if ts(x["opens_at"]) > opens]
    end = min(later + [opens + timedelta(hours=STROKE_WINDOW_H)])
    hours = int((end - opens).total_seconds() // 3600)
    return ok(create_window(d, "C-12", opens, hours, STROKE_CAP), 201)["window"]


def cap_for(remaining, hours):
    target = D(remaining)
    c = (target * 24 / D(hours)).quantize(MILLI, ROUND_DOWN) - 2 * MILLI
    while c <= target * 24 / D(hours) + 3 * MILLI:
        if c > 0 and q3(c * D(hours) / 24) == q3(target):
            return q3(c)
        c += MILLI
    pytest.fail(f"no cap gives {remaining} ML over {hours} h")


def is_erased(base, code):
    if not code.startswith("OP-C-"):
        return False
    return any(x["code"] == code and x["erased"] for x in Api(base, "priya").j("GET", "/api/contractors")["contractors"])


def settle_order(base, number):
    try:
        d = Api(base, "hal")
        o = d.get(f"/api/orders/{number}").json()["order"]
        if o["status"] in ("requested", "scheduled", "running"):
            d.post(f"/api/orders/{number}/close")
        for c in d.j("GET", "/api/gate-cards")["cards"]:
            if c["order_number"] == number and c["state"] == "open" and c["kind"] == "finish":
                if is_erased(base, c["holder_code"]) or c["holder_code"] not in CODE_WHO:
                    c = d.post(f"/api/gate-cards/{c['id']}/remove-holder").json()["card"]
                Api(base, CODE_WHO[c["holder_code"]]).post(f"/api/gate-cards/{c['id']}/stroke")
    except (httpx.HTTPError, AssertionError, KeyError, ValueError):
        pass


def clear_turnout(base, who, turnout):
    d = Api(base, "hal")
    for o in d.j("GET", "/api/orders")["orders"]:
        if o["turnout"] == turnout and o["status"] in ("scheduled", "running"):
            settle_order(base, o["number"])


@pytest.fixture
def cleanup():
    made = []
    yield made
    for base, number in reversed(made):
        settle_order(base, number)


def stroke_order(base, cleanup, holder="OP-D-01", standby=None, volume=TINY):
    d = Api(base, "hal")
    w = stroke_window(d)
    clear_turnout(base, "mara", "T12-04")
    g = Api(base, "mara")
    o = ok(place(g, "T12-04", w["id"], volume, holder, standby), 201)["order"]
    cleanup.append((base, o["number"]))
    return d, g, window(d, w["id"]), o, card_of(d, w["id"], o["number"], "start"), "T12-04"


RW_HOURS, RW_CAP, RW_ML, RW_CUT = 2, "24.000", "0.800", "12.000"
CUT_VOLUME = q3(D(RW_CUT) * RW_HOURS / 24)
CUT_LEFT = q3(D(CUT_VOLUME) - D(RW_ML))


def restriction_scene(base, cleanup):
    d = Api(base, "hal")
    w = upcoming_window(d, "C-09", RW_HOURS, RW_CAP)
    for who in ("mara", "dev"):
        clear_turnout(base, who, TURNOUTS[who]["C-09"])
    a = ok(place(Api(base, "mara"), "T9-02", w["id"], RW_ML, "OP-D-01"), 201)["order"]
    b = ok(place(Api(base, "dev"), "T9-05", w["id"], RW_ML, "OP-D-02"), 201)["order"]
    cleanup += [(base, a["number"]), (base, b["number"])]
    return d, w, a, b


class Pair:
    pass


def requested_pair(base, cleanup, remaining=None, channel=None, big=False) -> Pair:
    p = Pair()
    p.d = Api(base, "hal")
    p.asked = ASKED if big else ASKED_SMALL
    remaining = remaining or ("10.001" if big else "1.001")
    spec = PAIR_SPEC[big]
    for ch in ([channel] if channel else list(spec)):
        if find_upcoming(p.d, ch, spec[ch][0]) is not None:
            break
    else:
        pytest.fail("no free orderable slot for a ration pair")
    p.ch = ch
    p.who_a, p.ta, p.who_b, p.tb = PAIRS[ch]
    p.hours, cap = spec[ch]
    p.w = upcoming_window(p.d, ch, p.hours, cap)
    clear_turnout(base, p.who_a, p.ta)
    clear_turnout(base, p.who_b, p.tb)
    p.ga, p.gb = Api(base, p.who_a), Api(base, p.who_b)
    p.a = ok(place(p.ga, p.ta, p.w["id"], p.asked[0], "OP-D-01"), 201)["order"]
    p.b = ok(place(p.gb, p.tb, p.w["id"], p.asked[1], "OP-D-02"), 201)["order"]
    cleanup += [(base, p.a["number"]), (base, p.b["number"])]
    r = ok(p.d.post(f"/api/windows/{p.w['id']}/restrictions", {"cap_ml_day": cap_for(remaining, p.hours), "reason": REASON}), 201)
    assert sorted(r["moved_orders"]) == sorted([p.a["number"], p.b["number"]])
    p.w = window(p.d, p.w["id"])
    assert p.w["remaining_ml"] == q3(remaining)
    return p


def ration_shares(demands, remaining):
    total = sum(demands)
    if total <= remaining:
        return list(demands)
    raw = [d * remaining / total for d in demands]
    shares = [x.quantize(MILLI, ROUND_DOWN) for x in raw]
    left = int((remaining - sum(shares)) / MILLI)
    for i in sorted(range(len(raw)), key=lambda i: (-(raw[i] - shares[i]), i))[:left]:
        shares[i] += MILLI
    return shares


def _to(m):
    return [a.lower() for a in addresses(m.get("To"))]


def inbox(mail, to, subject):
    return [m for m in mail.messages() if to.lower() in _to(m) and m.get("Subject") == subject]


def await_mail(mail, to, subject, contains=None, seconds=MAIL_WAIT_S):
    def match():
        return [m for m in inbox(mail, to, subject) if contains is None or contains in text(m)]
    poll(match, seconds, 1)
    return match()


@contextlib.contextmanager
def screen(browser, base, who, path, size="1280", reduced_motion="no-preference"):
    with _cm(open_app(browser, base + "/sign-in", reduced_motion=reduced_motion)) as page:
        w, h = VIEWPORTS[size]
        page.set_viewport_size({"width": w, "height": h})
        if who:
            page.context.add_cookies(Api(base, who).cookies())
        page.goto(base + path)
        yield page


def sign_in(page, who):
    form = page.get_by_role("form", name="Sign in")
    fill(form.get_by_role("textbox", name="Email"), EMAIL[who])
    fill(page.get_by_label("Password"), PASSWORD)
    click(form.get_by_role("button", name="Sign in"))


def live(page, check, budget_ms=LIVE_MS + LIVE_SLACK_MS):
    spent = 0
    for _ in range(budget_ms // STEP_MS + 2):
        try:
            check()
            return
        except AssertionError:
            if spent >= budget_ms:
                raise
        advance(page, STEP_MS)
        spent += STEP_MS


def after_flow(page, check, duration_ms=COUNT_MS):
    advance(page, duration_ms + FRAME_MS)
    live(page, check, budget_ms=UI_WAIT_MS)


def watch(page, part, method=None):
    seen = []
    page.on("request", lambda r: seen.append(r.url) if part in r.url and (method is None or r.method == method) else None)
    return seen


def tab_to(page, locator, presses=TAB_PRESSES):
    for _ in range(presses):
        page.keyboard.press("Tab")
        if locator.evaluate("e => e === document.activeElement"):
            return
    pytest.fail("control never took focus by Tab")


def field_card(page, turnout, label):
    return (page.get_by_role("list", name="Gate cards").get_by_role("article", name=f"Gate card {turnout}")
            .filter(has_text=label).filter(has=page.get_by_role("button", name=f"Hold to stroke {turnout}")).first)


def progress(locator) -> float:
    return float(locator.evaluate("e => Number(e.getAttribute('aria-valuenow') ?? e.value)"))


def option_texts(page, combo):
    if combo.evaluate("e => e.tagName") == "SELECT":
        return combo.evaluate("e => Array.from(e.options).filter(o => !o.disabled && !o.hidden).map(o => o.textContent.trim())")
    click(combo)
    texts = page.get_by_role("listbox").last.get_by_role("option").all_inner_texts()
    page.keyboard.press("Escape")
    return [t.strip() for t in texts]


def chosen_text(combo):
    return combo.evaluate("e => (e.tagName === 'SELECT' ? (e.selectedOptions[0] || {}).textContent || '' "
                          ": (e.value || e.textContent)).trim()")


def hidden_now(page):
    page.evaluate("""() => {
        Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true});
        Object.defineProperty(document, 'hidden', {value: true, configurable: true});
        document.dispatchEvent(new Event('visibilitychange'));
    }""")


def minio_target():
    u = urlparse(os.environ.get("S3_ENDPOINT", ""))
    assert u.hostname, "S3_ENDPOINT is not set for the verifier"
    return u.hostname, u.port or (443 if u.scheme == "https" else 80)


def smtp_target():
    assert os.environ.get("SMTP_HOST") and os.environ.get("SMTP_PORT"), "SMTP_HOST/SMTP_PORT not set for the verifier"
    return os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])


@contextlib.contextmanager
def relay(host, port):
    lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind((OUTAGE_HOST, OUTAGE_PORT))
    lsock.listen()
    conns = []
    stopping = threading.Event()

    def pipe(a, b):
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, b):
                with contextlib.suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)

    def serve():
        while not stopping.is_set():
            try:
                c, _ = lsock.accept()
            except OSError:
                return
            try:
                u = socket.create_connection((host, port), timeout=RELAY_CONNECT_S)
            except OSError:
                c.close()
                continue
            u.settimeout(None)
            conns.extend([c, u])
            threading.Thread(target=pipe, args=(c, u), daemon=True).start()
            threading.Thread(target=pipe, args=(u, c), daemon=True).start()

    threading.Thread(target=serve, daemon=True).start()
    try:
        yield
    finally:
        stopping.set()
        with contextlib.suppress(OSError):
            lsock.shutdown(socket.SHUT_RDWR)
        lsock.close()
        for s in conns:
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)
            s.close()


def test_health_check(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert Api(app_url, "hal").j("GET", "/api/channels")["channels"]


def test_seed_district(app_url):
    for who in ROLE:
        u = Api(app_url, who).j("GET", "/api/me")["user"]
        assert (u["name"], u["email"]) == (NAMES[who], EMAIL[who])
    d = Api(app_url, "hal")
    chans = d.j("GET", "/api/channels")["channels"]
    assert [(c["id"], c["name"]) for c in chans[:3]] == [(c, CHANNEL_NAME[c]) for c in RAIL]
    seeded = {"W-L4-A": ("C-L4", 24, "60.000", "OP-D-01"), "W-L4-B": ("C-L4", 24, "60.000", "OP-D-02"),
              "W-09-A": ("C-09", 12, "120.000", "OP-D-02"), "W-12-A": ("C-12", 24, "30.000", "OP-D-01"),
              "W-12-B": ("C-12", 24, "30.000", "OP-D-02")}
    got = {wid: window(d, wid) for wid in seeded}
    for wid, (ch, hours, cap, rostered) in seeded.items():
        w = got[wid]
        assert (w["channel_id"], D(str(w["hours"])), w["table_cap_ml_day"], w["rostered_operator"]) == (ch, hours, cap, rostered)
        assert ts(w["opens_at"]).minute == 0 and ts(w["opens_at"]).second == 0
    assert got["W-L4-B"]["opens_at"] == got["W-L4-A"]["closes_at"]
    assert ts(got["W-12-B"]["opens_at"]) - ts(got["W-L4-A"]["opens_at"]) == timedelta(hours=266)
    turnouts = {t["code"]: t for t in d.j("GET", "/api/turnouts")["turnouts"]}
    assert {c: t["max_rate_ml_day"] for c, t in turnouts.items() if c in MAX_RATE} == MAX_RATE
    for number, turnout, req in (("ORD-00001", "T4-07", "20.000"), ("ORD-00002", "T4-11", "30.000"), ("ORD-00003", "T9-05", "15.000")):
        o = d.j("GET", f"/api/orders/{number}")["order"]
        assert (o["turnout"], o["requested_ml"]) == (turnout, req)
    codes = {o["code"]: o["kind"] for o in d.j("GET", "/api/operators")["operators"]}
    assert {k: codes.get(k) for k in CODE_WHO} == {"OP-D-01": "district", "OP-D-02": "district",
                                                    "OP-C-07": "contractor", "OP-C-08": "contractor"}
    pg, _ = observers("primary")
    assert pg.tables()
    assert Api(app_url, "mara").j("GET", "/api/me/allocation")["allocation_ml"] == ALLOCATION["mara"]


def test_sign_in_and_role_landing(browser, app_url):
    err(Api(app_url).get("/api/me"), 401, "not_signed_in")
    err(Api(app_url).sign_in(EMAIL["hal"], "wrong-password"), 401, "bad_credentials")
    for who in ("lin", "rory", "hal", "priya", "quinn"):
        with screen(browser, app_url, None, "/sign-in") as page:
            expect(page.get_by_role("heading", name="Sign in to Ditchbook")).to_be_visible(timeout=UI_WAIT_MS)
            sign_in(page, who)
            page.wait_for_url(lambda u, who=who: urlparse(u).path == HOME[ROLE[who]], timeout=UI_WAIT_MS)
    with screen(browser, app_url, None, "/sign-in") as page:
        form = page.get_by_role("form", name="Sign in")
        fill(form.get_by_role("textbox", name="Email"), EMAIL["hal"])
        fill(page.get_by_label("Password"), "wrong-password")
        click(form.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("status", name="Sign-in status")).to_have_text("That email and password do not match.", timeout=UI_WAIT_MS)
    with screen(browser, app_url, None, "/board?window=W-09-A") as page:
        page.wait_for_url(app_url + "/sign-in?return=" + quote("/board?window=W-09-A", safe=""), timeout=UI_WAIT_MS)
    foreign = SLASH + SLASH + EVIL_HOST + "/board"
    backslash = SLASH + "\\" + EVIL_HOST
    cases = [("hal", "/channels/C-09/capacity", "/channels/C-09/capacity"), ("hal", foreign, "/board"),
             ("hal", backslash, "/board"), ("hal", "/review", "/board"), ("quinn", "/packs/new", "/review")]
    for who, ret, landing in cases:
        with screen(browser, app_url, None, "/sign-in?return=" + quote(ret, safe="")) as page:
            sign_in(page, who)
            page.wait_for_url(lambda u, landing=landing: urlparse(u).path == landing and EVIL_HOST not in urlparse(u).netloc,
                              timeout=UI_WAIT_MS)
    with screen(browser, app_url, "hal", "/grower") as page:
        page.wait_for_url(lambda u: urlparse(u).path == "/board", timeout=UI_WAIT_MS)
        page.goto(app_url + "/sign-in")
        page.wait_for_url(lambda u: urlparse(u).path == "/board", timeout=UI_WAIT_MS)


def test_error_shape_and_precedence(app_url):
    anon = Api(app_url)
    err(anon.c.post("/api/orders", content=b"volume", headers={"Content-Type": "text/plain"}), 415, "unsupported_type")
    err(anon.get("/api/orders"), 401, "not_signed_in")
    lin, hal = Api(app_url, "lin"), Api(app_url, "hal")
    dev_order = "ORD-00002"
    err(lin.post(f"/api/windows/{UNKNOWN}/ration"), 403, "forbidden")
    err(hal.post(f"/api/windows/{UNKNOWN}/ration"), 404, "not_found")
    err(hal.post(f"/api/windows/{UNKNOWN}/restrictions", {"cap_ml_day": "0", "reason": JUNK}), 404, "not_found")
    err(lin.get(f"/api/orders/{dev_order}"), 404, "not_found")
    past = past_window(hal, "C-09")
    field_err(hal.post(f"/api/windows/{past['id']}/restrictions", {"cap_ml_day": "0", "reason": REASON}), "cap_ml_day")
    err(hal.post(f"/api/windows/{past['id']}/restrictions", {"cap_ml_day": "1.000", "reason": REASON}), 409, "window_closed")
    err(hal.get("/api/no-such-endpoint"), 404, "not_found")
    body = lin.get("/api/search", params={"q": "x"})
    assert body.status_code == 422 and set(body.json()) == {"errors"}


def test_malformed_path_id_is_unknown_record(app_url):
    err(Api(app_url).get(f"/api/windows/{MALFORMED_ID}"), 401, "not_signed_in")
    lin, rory, hal, priya = Api(app_url, "lin"), Api(app_url, "rory"), Api(app_url, "hal"), Api(app_url, "priya")
    err(lin.post(f"/api/windows/{MALFORMED_ID}/ration"), 403, "forbidden")
    err(hal.post(f"/api/windows/{MALFORMED_ID}/restrictions", {"cap_ml_day": "0", "reason": JUNK}), 404, "not_found")
    for reply in (lambda p: hal.get(f"/api/windows/{p}"), lambda p: hal.get(f"/api/windows/{p}/notices"),
                  lambda p: hal.post(f"/api/windows/{p}/ration"), lambda p: hal.post(f"/api/channels/{p}/windows", {}),
                  lambda p: hal.get(f"/api/channels/{p}/capacity"), lambda p: hal.put(f"/api/channels/{p}/capacity", {}),
                  lambda p: hal.post(f"/api/channels/{p}/capacity/revisions/1/restore"),
                  lambda p: hal.get(f"/api/orders/{p}"), lambda p: lin.post(f"/api/orders/{p}/cancel"),
                  lambda p: hal.post(f"/api/orders/{p}/schedule"), lambda p: hal.post(f"/api/orders/{p}/close"),
                  lambda p: hal.post(f"/api/orders/{p}/reopen"), lambda p: rory.post(f"/api/gate-cards/{p}/stroke"),
                  lambda p: hal.post(f"/api/gate-cards/{p}/remove-holder"), lambda p: hal.get(f"/api/restrictions/{p}"),
                  lambda p: priya.get(f"/api/packs/{p}"), lambda p: priya.get(f"/api/packs/{p}/document"),
                  lambda p: priya.delete(f"/api/packs/{p}"), lambda p: priya.delete(f"/api/contractors/{p}")):
        err(reply(MALFORMED_ID), 404, "not_found")


def test_erase_answers_not_found_for_malformed_code(app_url):
    path = f"/api/contractors/{MALFORMED_ID}"
    err(Api(app_url).delete(path), 401, "not_signed_in")
    err(Api(app_url, "quinn").delete(path), 403, "forbidden")
    priya = Api(app_url, "priya")
    before = priya.j("GET", "/api/contractors")
    err(priya.delete(path), 404, "not_found")
    assert priya.j("GET", "/api/contractors") == before


def test_reviewer_reads_answer_not_found_for_malformed_ids(app_url):
    quinn = Api(app_url, "quinn")
    for path in ("/api/packs/{}", "/api/packs/{}/document", "/api/restrictions/{}", "/api/channels/{}/capacity"):
        err(quinn.get(path.format(MALFORMED_ID)), 404, "not_found")


def test_server_boundary(browser, app_url):
    anon, hal, clerk = Api(app_url), Api(app_url, "hal"), Api(app_url, "priya")
    err(anon.c.post("/api/session", content=b'{"email":"a"}', headers={"Content-Type": "text/plain"}), 415, "unsupported_type")

    def padded(limit, base):
        raw = len(json.dumps({**base, "pad": ""}).encode())
        return json.dumps({**base, "pad": "x" * (limit - raw)}).encode()

    js = {"Content-Type": "application/json"}
    at = padded(BODY_LIMIT, {"email": "nobody@growers.example", "password": "x"})
    assert len(at) == BODY_LIMIT
    err(anon.c.post("/api/session", content=at, headers=js), 401, "bad_credentials")
    err(anon.c.post("/api/session", content=at + b" ", headers=js), 413, "too_large")
    pack = {"from": "2026-10-04", "to": "2026-10-04", "signatory": "Priya Anand"}
    raw = len(json.dumps({**pack, "document": ""}).encode())
    exact = json.dumps({**pack, "document": "x" * (PACK_LIMIT - raw)}).encode()
    assert len(exact) == PACK_LIMIT
    assert clerk.c.post("/api/packs", content=exact, headers=js).status_code in (409, 422)
    err(clerk.c.post("/api/packs", content=exact + b" ", headers=js), 413, "too_large")
    err(hal.c.post("/api/orders/ORD-99999/close"), 404, "not_found")
    assert hal.c.delete("/api/packs/WP-9999").status_code != 415
    secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL") if len(os.environ.get(k, "")) >= 8]
    page_html = httpx.get(app_url + "/sign-in", timeout=HTTP_TIMEOUT_S).text
    assets = sorted(set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', page_html)))
    for path in ["/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json"] + assets:
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S)
        assert "run-manifest-v1" not in r.text, path
        for s in secrets:
            assert s not in r.text, f"credential served at {path}"
    for path in assets:
        m = httpx.get(app_url + path + ".map", timeout=HTTP_TIMEOUT_S)
        assert not (m.status_code == 200 and m.headers.get("content-type", "").startswith("application/json")), path
    r = httpx.get(app_url + "/api/health", headers={"Origin": "http://elsewhere.example"}, timeout=HTTP_TIMEOUT_S)
    granted = [k for k in r.headers if "allow" in k.lower() and "origin" in k.lower()]
    assert granted == [], granted
    with screen(browser, app_url, "hal", "/no-such-page") as page:
        expect(page.get_by_role("heading", name="Page not found")).to_be_visible(timeout=UI_WAIT_MS)


def test_starts_with_a_service_down(browser):
    for name in OUTAGES:
        base = outage_url(name)
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, name
        for who, path in (("lin", "/grower"), ("rory", "/field"), ("hal", "/board"), ("priya", "/packs"), ("quinn", "/review")):
            with screen(browser, base, who, path) as page:
                expect(page.get_by_role("button", name="Sign out")).to_be_visible(timeout=UI_WAIT_MS)
                assert urlparse(page.url).path == path


SCREEN_CONTROLS = {
    ("lin", "/grower/orders/new"): [("combobox", "Turnout"), ("combobox", "Delivery window"), ("textbox", "Volume (ML)"),
                                    ("combobox", "Gate worked by"), ("combobox", "Standby operator"), ("button", "Place order")],
    ("lin", "/grower"): [],
    ("rory", "/field"): [("button", re.compile(r"^Hold to stroke "))],
    ("hal", "/board"): [("button", "Channels")],
    ("hal", "/channels/C-09/capacity"): [("button", "Save table")],
    ("priya", "/packs/new"): [("textbox", "From"), ("textbox", "To"), ("textbox", "Signatory"), ("button", "Preview pack"),
                              ("button", "Sign and submit pack")],
    ("priya", "/contractors"): [("button", re.compile(r"^Erase "))],
    ("quinn", "/review"): [("textbox", "From"), ("textbox", "To"), ("button", "Show totals")],
}


@pytest.mark.parametrize("size", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_viewports_and_tap_targets(browser, app_url, size):
    def targets(page, items):
        for role, name in items + [("combobox", "Search turnouts, growers and operators"), ("button", "Sign out")]:
            for e in page.get_by_role(role, name=name).all():
                if e.is_visible():
                    b = e.bounding_box()
                    assert b["width"] >= TAP_PX - 0.5 and b["height"] >= TAP_PX - 0.5, (role, name, b)

    with screen(browser, app_url, None, "/sign-in", size) as page:
        expect(page.get_by_role("button", name="Sign in")).to_be_visible(timeout=UI_WAIT_MS)
        layout(page)
        for e in (page.get_by_role("textbox", name="Email"), page.get_by_role("button", name="Sign in")):
            b = e.bounding_box()
            assert b["width"] >= TAP_PX - 0.5 and b["height"] >= TAP_PX - 0.5
    for (who, path), items in SCREEN_CONTROLS.items():
        with screen(browser, app_url, who, path, size) as page:
            expect(page.get_by_role("button", name="Sign out")).to_be_visible(timeout=UI_WAIT_MS)
            advance(page, STEP_MS)
            layout(page)
            targets(page, items)


def test_no_decorative_motion(browser, app_url):
    endless = "() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getTiming().iterations === Infinity).length"
    for who, path in (("lin", "/grower"), ("lin", "/grower/orders/new"), ("rory", "/field"), ("hal", "/board"),
                      ("priya", "/packs"), ("quinn", "/review")):
        with screen(browser, app_url, who, path) as page:
            expect(page.get_by_role("button", name="Sign out")).to_be_visible(timeout=UI_WAIT_MS)
            advance(page, DWELL_MS * 3)
            assert page.evaluate(endless) == 0, path
    with screen(browser, app_url, "hal", "/board?channels=C-09", "768", reduced_motion="reduce") as page:
        cell = page.get_by_role("grid", name="Window grid").get_by_role("button").first
        expect(cell).to_be_visible(timeout=UI_WAIT_MS)
        click(cell)
        sheet = page.get_by_role("dialog", name="Window detail")
        expect(sheet).to_be_visible(timeout=UI_WAIT_MS)
        first = sheet.bounding_box()
        assert style(sheet, "opacity")["opacity"] == "1"
        advance(page, STEP_MS)
        assert sheet.bounding_box() == first


def test_order_form_follows_latest_quote(browser, app_url):
    d = Api(app_url, "hal")
    w = quiet_window(d, "C-09", 12, "120.000")
    ops = sorted((o for o in Api(app_url, "mara").j("GET", "/api/operators")["operators"] if o["name"]), key=lambda o: o["code"])
    with screen(browser, app_url, "mara", f"/grower/orders/new?window={w['id']}") as page:
        form = page.get_by_role("form", name="New order")
        turnout, win = form.get_by_role("combobox", name="Turnout", exact=True), form.get_by_role("combobox", name="Delivery window")
        expect(turnout).to_be_visible(timeout=UI_WAIT_MS)
        assert option_texts(page, turnout) == ["T4-07", "T4-09", "T9-02", "T12-04"]
        assert f"Channel 9, {w['label']}" in option_texts(page, win)
        expect(page.get_by_role("status", name="Window status")).to_contain_text("Not yet open", timeout=UI_WAIT_MS)
        assert chosen_text(win) == f"Channel 9, {w['label']}"
        names = [f"{o['name']} ({o['code']})" for o in ops]
        assert option_texts(page, form.get_by_role("combobox", name="Gate worked by")) == names
        assert option_texts(page, form.get_by_role("combobox", name="Standby operator")) == ["No standby"] + names
        select(turnout, "T9-02")
        assert chosen_text(win) == f"Channel 9, {w['label']}"
        stalled = []

        def route(r):
            if [D(v) for v in parse_qs(urlparse(r.request.url).query).get("volume_ml", [])] == [D("1")]:
                stalled.append(r)
            else:
                r.fallback()

        page.route("**/api/orders/quote**", route)
        volume, rate = form.get_by_role("textbox", name="Volume (ML)"), form.get_by_role("group", name="Flow rate")
        remaining = form.get_by_role("group", name="Window remaining")
        fill(volume, "1")
        advance(page, QUOTE_MS + FRAME_MS)
        poll(lambda: stalled, UI_WAIT_MS / 1000, 0.2)
        expect(rate).not_to_contain_text("ML/day")
        fill(volume, "2")
        advance(page, QUOTE_MS + FRAME_MS)
        expect(rate).to_contain_text(f"{rate_of('2', 12)} ML/day", timeout=UI_WAIT_MS)
        expect(remaining).to_contain_text(f"{w['remaining_ml']} ML")
        stalled[0].fallback()
        advance(page, STEP_MS)
        expect(rate).to_contain_text(f"{rate_of('2', 12)} ML/day")
        limit = f"More than T9-02 can pass in this window: {turnout_max('T9-02', 12)} ML."
        fill(volume, q3(D(turnout_max("T9-02", 12)) + MILLI))
        advance(page, QUOTE_MS + FRAME_MS)
        expect(form).to_contain_text(limit, timeout=UI_WAIT_MS)
        expect(rate).not_to_contain_text("ML/day")
        expect(remaining).to_contain_text(f"{w['remaining_ml']} ML")
        fill(volume, "15")
        advance(page, QUOTE_MS + FRAME_MS)
        expect(rate).to_contain_text("30.000 ML/day", timeout=UI_WAIT_MS)
        expect(form).not_to_contain_text(limit)
        quotes = watch(page, "/api/orders/quote")
        fill(volume, "")
        advance(page, QUOTE_MS * 2)
        assert quotes == []
        expect(rate).not_to_contain_text("ML/day")
        expect(remaining).to_contain_text(f"{w['remaining_ml']} ML")


def test_place_order_debits_in_one_step(app_url, cleanup):
    d, mara = Api(app_url, "hal"), Api(app_url, "mara")
    w = upcoming_window(d, "C-09", 1, "24.000")
    wid = w["id"]
    clear_turnout(app_url, "mara", "T9-02")
    before = alloc(mara)
    body = ok(place(mara, "T9-02", wid, float(PLACED)), 201)
    o = body["order"]
    cleanup.append((app_url, o["number"]))
    assert re.fullmatch(r"ORD-\d{5}", o["number"])
    left = q3(D(w["cap_volume_ml"]) - D(PLACED))
    assert (o["status"], o["requested_ml"], o["volume_ml"], o["rate_ml_day"], o["rationed"], o["conflict"], o["holder_code"]) == \
        ("scheduled", PLACED, PLACED, rate_of(PLACED, 1), False, None, "OP-D-01")
    assert (body["window"]["committed_ml"], body["window"]["remaining_ml"]) == (PLACED, left)
    assert D(body["allocation"]["remaining_ml"]) == before - D(PLACED) == alloc(mara)
    assert window(d, wid)["remaining_ml"] == left
    assert card_of(d, wid, o["number"], "start")["holder_code"] == "OP-D-01"
    assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "scheduled"


def test_ordering_horizon(app_url):
    d, mara = Api(app_url, "hal"), Api(app_url, "mara")
    w = quiet_window(d, "C-09", 1, "24.000")
    assert (w["status"], w["orderable"]) == ("upcoming", True)
    now, ws = windows_of(d, "C-09")
    start = free_start(ws, now.replace(minute=0, second=0) + timedelta(hours=FAR_SLOT_H), 1,
                       now + timedelta(hours=FAR_SLOT_H + FAR_SPAN_H))
    assert start is not None, "no free slot past the ordering horizon on C-09"
    far = ok(create_window(d, "C-09", start, 1, "24.000"), 201)["window"]
    assert (far["status"], far["orderable"]) == ("upcoming", False)
    before = alloc(mara)
    err(place(mara, "T9-02", far["id"], TINY), 409, "too_early")
    past = past_window(d, "C-09")
    assert (past["status"], past["orderable"]) == ("closed", False)
    err(place(mara, "T9-02", past["id"], TINY), 409, "window_closed")
    assert alloc(mara) == before
    assert d.j("GET", "/api/orders", params={"window": far["id"]})["orders"] == []
    assert d.j("GET", "/api/orders", params={"window": past["id"]})["orders"] == []


def test_one_conversion_rule(app_url):
    d, mara, lin = Api(app_url, "hal"), Api(app_url, "mara"), Api(app_url, "lin")
    w12 = quiet_window(d, "C-09", 12, "120.000")
    assert w12["cap_volume_ml"] == "60.000"
    q = mara.j("GET", "/api/orders/quote", params={"window": w12["id"], "volume_ml": "15", "turnout": "T9-02"})
    assert (q["rate_ml_day"], q["turnout_max_ml"]) == ("30.000", "30.000")
    q = mara.j("GET", "/api/orders/quote", params={"window": w12["id"], "volume_ml": "6"})
    assert (q["rate_ml_day"], q["turnout_max_ml"]) == ("12.000", None)
    assert q["window"]["cap_volume_ml"] == "60.000"
    w48 = quiet_window(d, "C-L4", 48, "24.000")
    assert mara.j("GET", "/api/orders/quote", params={"window": w48["id"], "volume_ml": "0.007"})["rate_ml_day"] == "0.004"
    w24 = quiet_window(d, "C-L4", 24, "60.000")
    assert lin.j("GET", "/api/orders/quote", params={"window": w24["id"], "volume_ml": "1", "turnout": "T4-15"})[
        "turnout_max_ml"] == "25.000"
    w7 = upcoming_window(d, "C-L4", 7, "10.000")
    assert w7["cap_volume_ml"] == q3(D("10") * 7 / 24)
    r = ok(d.post(f"/api/windows/{w7['id']}/restrictions", {"cap_ml_day": CUT, "reason": REASON}), 201)
    m_before = max(0, int((ts(r["restriction"]["effective_at"]) - ts(w7["opens_at"])).total_seconds() // 60))
    want = q3((D(w7["table_cap_ml_day"]) * m_before + D(CUT) * (7 * 60 - m_before)) / 1440)
    assert r["window"]["cap_volume_ml"] == want == window(d, w7["id"])["cap_volume_ml"]
    assert r["window"]["effective_cap_ml_day"] == CUT


def test_allocation_and_turnout_guards(app_url, cleanup):
    d, mara, lin = Api(app_url, "hal"), Api(app_url, "mara"), Api(app_url, "lin")
    w = upcoming_window(d, "C-09", 1, "24.000")
    wid = w["id"]
    clear_turnout(app_url, "mara", "T9-02")
    before = alloc(mara)
    assert field_err(place(mara, "T4-07", wid, HALF), "turnout") == "Choose one of your turnouts on this window's channel."
    field_err(place(mara, "T9-02", wid, HALF, "OP-X-99"), "operator_code")
    field_err(place(mara, "T9-02", wid, HALF, "OP-D-01", "OP-X-99"), "standby_code")
    same = place(mara, "T9-02", wid, HALF, "OP-D-01", "OP-D-01")
    assert same.status_code == 422 and set(same.json()["errors"]) & {"operator_code", "standby_code"}
    assert alloc(mara) == before and window(d, wid)["committed_ml"] == "0.000"
    o = ok(place(mara, "T9-02", wid, HALF), 201)["order"]
    cleanup.append((app_url, o["number"]))
    err(place(mara, "T9-02", wid, TINY), 409, "turnout_busy")
    assert alloc(mara) == before - D(HALF) and D(window(d, wid)["committed_ml"]) == D(HALF)
    sw = stroke_window(d)
    clear_turnout(app_url, "lin", "T12-03")
    lin_before = alloc(lin)
    assert lin_before + MILLI <= D(turnout_max("T12-03", sw["hours"]))
    assert field_err(place(lin, "T12-03", sw["id"], q3(lin_before + MILLI)), "volume_ml") == \
        f"More than your remaining allocation of {q3(lin_before)} ML."
    assert alloc(lin) == lin_before
    assert not [x for x in lin.j("GET", "/api/orders", params={"window": sw["id"]})["orders"]
                if x["status"] == "scheduled" and x["turnout"] == "T12-03"]


def test_turnout_outlet_limit(app_url, cleanup):
    d, mara = Api(app_url, "hal"), Api(app_url, "mara")
    w = upcoming_window(d, "C-09", 1, "120.000")
    wid, top = w["id"], turnout_max("T9-02", 1)
    assert D(w["cap_volume_ml"]) > D(top)
    limit = f"More than T9-02 can pass in this window: {top} ML."
    over = q3(D(top) + MILLI)
    assert mara.j("GET", "/api/orders/quote", params={"window": wid, "volume_ml": top, "turnout": "T9-02"})["turnout_max_ml"] == top
    assert field_err(mara.get("/api/orders/quote", params={"window": wid, "volume_ml": over, "turnout": "T9-02"}),
                     "volume_ml") == limit
    clear_turnout(app_url, "mara", "T9-02")
    before = alloc(mara)
    assert field_err(place(mara, "T9-02", wid, "500.001"), "volume_ml") != limit
    beyond = q3(max(before, D(top)) + MILLI)
    assert field_err(place(mara, "T9-02", wid, beyond), "volume_ml") == limit
    assert field_err(place(mara, "T9-02", wid, over), "volume_ml") == limit
    assert alloc(mara) == before and window(d, wid)["committed_ml"] == "0.000"
    o = ok(place(mara, "T9-02", wid, top), 201)["order"]
    cleanup.append((app_url, o["number"]))
    assert o["volume_ml"] == top


def test_one_winner_for_contested_volume(app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    clear_turnout(app_url, "dev", "T9-05")
    mara, dev = Api(app_url, "mara"), Api(app_url, "dev")
    before = {"mara": alloc(mara), "dev": alloc(dev)}
    out = dict(zip(("mara", "dev"), together(lambda: place(mara, "T9-02", w["id"], "1.000"),
                                              lambda: place(dev, "T9-05", w["id"], "1.000"))))
    wins = [k for k, r in out.items() if r.status_code == 201]
    assert len(wins) == 1, {k: r.text for k, r in out.items()}
    winner, loser = wins[0], ("dev" if wins[0] == "mara" else "mara")
    cleanup.append((app_url, out[winner].json()["order"]["number"]))
    assert err(out[loser], 409, "window_full")["remaining_ml"] == "0.000"
    ww = window(d, w["id"])
    assert (ww["committed_ml"], ww["remaining_ml"]) == ("1.000", "0.000")
    assert alloc(Api(app_url, winner)) == before[winner] - 1
    assert alloc(Api(app_url, loser)) == before[loser]
    assert [o["grower_id"] for o in d.j("GET", "/api/orders", params={"window": w["id"]})["orders"]] == \
        [out[winner].json()["order"]["grower_id"]]
    lw = upcoming_window(d, "C-L4", 21, "60.000")
    sw = stroke_window(d)
    clear_turnout(app_url, "lin", "T4-15")
    clear_turnout(app_url, "lin", "T12-03")
    lin, lin2 = Api(app_url, "lin"), Api(app_url, "lin")
    lin_before = alloc(lin)
    v = q3(lin_before / 2 + D("0.5"))
    a, b = together(lambda: place(lin, "T4-15", lw["id"], v), lambda: place(lin2, "T12-03", sw["id"], v))
    assert sorted([a.status_code, b.status_code]) == [201, 422], (a.text, b.text)
    good, bad = (a, b) if a.status_code == 201 else (b, a)
    cleanup.append((app_url, good.json()["order"]["number"]))
    assert field_err(bad, "volume_ml") == f"More than your remaining allocation of {q3(lin_before - D(v))} ML."
    assert alloc(lin) == lin_before - D(v)


def test_conflict_notice_to_losing_grower(app_url, mail, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    clear_turnout(app_url, "dev", "T9-05")
    mara, dev = Api(app_url, "mara"), Api(app_url, "dev")
    cleanup.append((app_url, ok(place(mara, "T9-02", w["id"], "1.000"), 201)["order"]["number"]))
    dev_before = alloc(dev)
    assert err(place(dev, "T9-05", w["id"], "1.000"), 409, "window_full")["remaining_ml"] == "0.000"
    field_err(place(dev, "T9-05", w["id"], q3(D(turnout_max("T9-05", 1)) + MILLI)), "volume_ml")
    subject = f"Ditchbook: capacity taken on Channel 9, {w['label']}"
    msgs = await_mail(mail, EMAIL["dev"], subject)
    body = text(msgs[0])
    assert "Another order took the last of this window's capacity. Nothing was debited from your allocation." in body
    assert f"Your allocation is unchanged at {q3(dev_before)} ML." in body and "1.000" in body
    assert inbox(mail, EMAIL["mara"], subject) == []
    sw = stroke_window(d)
    clear_turnout(app_url, "lin", "T12-03")
    lin = Api(app_url, "lin")
    lin_before = alloc(lin)
    assert lin_before + MILLI <= D(turnout_max("T12-03", sw["hours"]))
    field_err(place(lin, "T12-03", sw["id"], q3(lin_before + MILLI)), "volume_ml")
    assert len(inbox(mail, EMAIL["dev"], subject)) == 1
    assert inbox(mail, EMAIL["lin"], f"Ditchbook: capacity taken on Channel 12 Spur, {sw['label']}") == []


def test_replies_belong_to_caller(app_url, mail, cleanup):
    d = Api(app_url, "hal")
    sw = stroke_window(d)
    clear_turnout(app_url, "lin", "T12-03")
    apis = {who: [Api(app_url, who) for _ in range(3)] for who in ("mara", "dev", "lin")}
    truth = {who: alloc(apis[who][0]) for who in apis}
    over = q3(truth["lin"] + MILLI)
    assert truth["lin"] + MILLI <= D(turnout_max("T12-03", sw["hours"]))
    calls, owners = [], []
    for i in range(3):
        for who in ("mara", "dev", "lin"):
            calls.append(lambda api=apis[who][i]: api.get("/api/me/allocation"))
            owners.append((who, "allocation"))
        calls.append(lambda api=apis["lin"][i]: place(api, "T12-03", sw["id"], over))
        owners.append(("lin", "place"))
    for (who, kind), r in zip(owners, together(*calls)):
        if kind == "allocation":
            assert D(ok(r)["remaining_ml"]) == truth[who], who
        else:
            assert field_err(r, "volume_ml") == f"More than your remaining allocation of {q3(truth['lin'])} ML."
    w = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    clear_turnout(app_url, "dev", "T9-05")
    mara, dev = Api(app_url, "mara"), Api(app_url, "dev")
    before = {"mara": alloc(mara), "dev": alloc(dev)}
    out = dict(zip(("mara", "dev"), together(lambda: place(mara, "T9-02", w["id"], "1.000"),
                                              lambda: place(dev, "T9-05", w["id"], "1.000"))))
    wins = [k for k, r in out.items() if r.status_code == 201]
    assert len(wins) == 1, {k: r.text for k, r in out.items()}
    winner, loser = wins[0], ("dev" if wins[0] == "mara" else "mara")
    cleanup.append((app_url, out[winner].json()["order"]["number"]))
    assert D(out[winner].json()["allocation"]["remaining_ml"]) == before[winner] - 1
    assert out[winner].json()["order"]["grower_id"] == Api(app_url, winner).j("GET", "/api/me")["user"]["id"]
    subject = f"Ditchbook: capacity taken on Channel 9, {w['label']}"
    msgs = await_mail(mail, EMAIL[loser], subject)
    assert len(msgs) == 1 and f"Your allocation is unchanged at {q3(before[loser])} ML." in text(msgs[0])
    assert inbox(mail, EMAIL[winner], subject) == []


def test_capacity_taken_dialog_and_honest_place(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    clear_turnout(app_url, "dev", "T9-05")
    mara = Api(app_url, "mara")
    r = alloc(mara)
    with screen(browser, app_url, "mara", f"/grower/orders/new?window={w['id']}") as page:
        f = page.get_by_role("form", name="New order")
        select(f.get_by_role("combobox", name="Turnout", exact=True), "T9-02")
        fill(f.get_by_role("textbox", name="Volume (ML)"), "1")
        select(f.get_by_role("combobox", name="Gate worked by"), "Rory Kemp (OP-D-01)")
        advance(page, QUOTE_MS + FRAME_MS)
        remaining = f.get_by_role("group", name="Window remaining")
        counter = page.get_by_role("region", name="Allocation")
        expect(remaining).to_contain_text(f"{w['remaining_ml']} ML", timeout=UI_WAIT_MS)
        expect(counter).to_contain_text(f"{q3(r)} ML of {ALLOCATION['mara']} ML left")
        posts = watch(page, "/api/orders", "POST")
        button = f.get_by_role("button", name="Place order")
        with hold(page, "**/api/orders") as gate:
            click(button)
            expect(button).to_have_attribute("aria-disabled", "true", timeout=UI_WAIT_MS)
            expect(page.get_by_role("status", name="Order status")).to_have_text("Placing your order.")
            expect(counter).to_contain_text(f"{q3(r)} ML of {ALLOCATION['mara']} ML left")
            expect(remaining).to_contain_text(f"{w['remaining_ml']} ML")
            button.dispatch_event("click")
            cleanup.append((app_url, ok(place(Api(app_url, "dev"), "T9-05", w["id"], "1.000"), 201)["order"]["number"]))
            gate.release()
        dialog = page.get_by_role("alertdialog", name="Capacity taken")
        expect(dialog).to_be_visible(timeout=UI_WAIT_MS)
        assert len([u for u in posts if urlparse(u).path == "/api/orders"]) == 1
        expect(dialog.get_by_role("heading", name="Capacity taken")).to_be_visible()
        expect(dialog).to_contain_text("Another order took the last of this window's capacity. Nothing was debited from your allocation.")
        expect(remaining).to_contain_text(f"{q3(0)} ML")
        expect(counter).to_contain_text(f"{q3(r)} ML of {ALLOCATION['mara']} ML left")
        for _ in range(4):
            page.keyboard.press("Tab")
            assert dialog.evaluate("e => e.contains(document.activeElement)")
        page.keyboard.press("Shift+Tab")
        assert dialog.evaluate("e => e.contains(document.activeElement)")
        click(dialog.get_by_role("button", name="Back to the order"))
        after_flow(page, lambda: (expect(dialog).to_have_count(0, timeout=TRY_MS),
                                  expect(button).to_be_focused(timeout=TRY_MS)))
    assert alloc(mara) == r
    assert [o["turnout"] for o in d.j("GET", "/api/orders", params={"window": w["id"]})["orders"]] == ["T9-05"]


def test_dwell_pointer_timing(browser, app_url, cleanup):
    d, g, w, o, card, t = stroke_order(app_url, cleanup, volume=STROKE_ML)
    with screen(browser, app_url, "rory", "/field") as page:
        c = field_card(page, t, w["label"]).filter(has_text="Start")
        btn = c.get_by_role("button", name=f"Hold to stroke {t}")
        prog = c.get_by_role("progressbar", name=f"Dwell progress {t}")
        expect(btn).to_be_visible(timeout=UI_WAIT_MS)
        sent = watch(page, "/stroke", "POST")
        x, y = center(btn)
        page.mouse.move(x, y)
        page.mouse.down()
        values = []
        for _ in range(3):
            advance(page, DWELL_MS / 4)
            values.append(progress(prog))
        assert 0 < values[0] < values[1] < values[2] < 100, values
        page.mouse.up()
        assert progress(prog) == 0
        page.mouse.down()
        advance(page, DWELL_MS / 2)
        page.mouse.move(x, y + VIEWPORTS["1280"][1])
        assert progress(prog) == 0
        page.mouse.up()
        page.mouse.move(x, y)
        page.mouse.down()
        advance(page, DWELL_MS / 2)
        page.get_by_role("button", name="Sign out").focus()
        assert progress(prog) == 0
        page.mouse.up()
        page.mouse.move(x, y)
        page.mouse.down()
        advance(page, DWELL_MS / 2)
        hidden_now(page)
        assert progress(prog) == 0
        page.mouse.up()
        advance(page, DWELL_MS * 2)
        assert sent == []
        page.reload()
        expect(btn).to_be_visible(timeout=UI_WAIT_MS)
        x, y = center(btn)
        page.mouse.move(x, y)
        page.mouse.down()
        advance(page, DWELL_MS + FRAME_MS)
        page.mouse.up()
        poll(lambda: sent, UI_WAIT_MS / 1000, 0.2)
        assert len(sent) == 1
    poll(lambda: card_of(d, w["id"], o["number"], "start", None)["state"] == "spent", UI_WAIT_MS / 1000)
    assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "running"


def test_stroke_announcements(browser, app_url, cleanup):
    d, g, w, o, card, t = stroke_order(app_url, cleanup, volume=STROKE_ML)
    future = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    fo = ok(place(g, "T9-02", future["id"], TINY), 201)["order"]
    cleanup.append((app_url, fo["number"]))
    with screen(browser, app_url, "rory", "/field") as page:
        page.clock.set_system_time(ts(future["opens_at"]) + timedelta(hours=5))
        c = field_card(page, t, w["label"]).filter(has_text="Start")
        btn = c.get_by_role("button", name=f"Hold to stroke {t}")
        status = page.get_by_role("status", name="Gate dwell status")
        expect(btn).to_be_visible(timeout=UI_WAIT_MS)
        btn.focus()
        page.keyboard.down("Space")
        advance(page, DWELL_MS / 2)
        page.keyboard.up("Space")
        expect(status).to_have_text("Released early. Stroke not sent.", timeout=UI_WAIT_MS)
        page.keyboard.down("Space")
        advance(page, DWELL_MS + FRAME_MS)
        page.keyboard.up("Space")
        poll(lambda: card_of(d, w["id"], o["number"], "start", None)["state"] == "spent", UI_WAIT_MS / 1000)
        flow = window(d, w["id"])["channel_flow_ml_day"]
        expect(status).to_have_text(f"Stroke stored for {t}. Flow now {flow} ML/day.", timeout=UI_WAIT_MS)
        ft = fo["turnout"]
        fc = field_card(page, ft, future["label"])
        expect(fc.get_by_role("group", name=f"Window status {ft}")).to_contain_text("Not yet open", timeout=UI_WAIT_MS)
        fb = fc.get_by_role("button", name=f"Hold to stroke {ft}")
        fb.focus()
        page.keyboard.down("Space")
        advance(page, DWELL_MS + FRAME_MS)
        page.keyboard.up("Space")
        expect(status).to_have_text("This window is not open yet.", timeout=UI_WAIT_MS)
    fcard = card_of(d, future["id"], fo["number"], "start")
    err(Api(app_url, "rory").post(f"/api/gate-cards/{fcard['id']}/stroke"), 409, "window_not_open")


def test_dwell_space_hold(browser, app_url, cleanup):
    d, g, w, o, card, t = stroke_order(app_url, cleanup)
    with screen(browser, app_url, "rory", "/field") as page:
        c = field_card(page, t, w["label"]).filter(has_text="Start")
        btn = c.get_by_role("button", name=f"Hold to stroke {t}")
        prog = c.get_by_role("progressbar", name=f"Dwell progress {t}")
        expect(btn).to_be_visible(timeout=UI_WAIT_MS)
        sent = watch(page, "/stroke", "POST")
        btn.focus()
        page.keyboard.press("Enter")
        advance(page, DWELL_MS * 2)
        assert sent == [] and progress(prog) == 0
        page.keyboard.down("Space")
        advance(page, DWELL_MS * 0.4)
        first = progress(prog)
        page.keyboard.down("Space")
        advance(page, DWELL_MS * 0.1)
        assert progress(prog) > first
        page.keyboard.down("Space")
        advance(page, DWELL_MS * 0.3)
        assert sent == [] and progress(prog) < 100
        page.keyboard.up("Space")
        assert progress(prog) == 0
        expect(page.get_by_role("status", name="Gate dwell status")).to_have_text("Released early. Stroke not sent.", timeout=UI_WAIT_MS)
        page.keyboard.down("Space")
        advance(page, DWELL_MS / 2)
        page.get_by_role("button", name="Sign out").focus()
        assert progress(prog) == 0
        btn.focus()
        page.keyboard.up("Space")
        advance(page, DWELL_MS * 2)
        assert sent == []
        page.keyboard.down("Space")
        advance(page, DWELL_MS * 0.4)
        page.keyboard.down("Space")
        advance(page, DWELL_MS * 0.3)
        page.keyboard.down("Space")
        advance(page, DWELL_MS * 0.3 + FRAME_MS)
        poll(lambda: sent, UI_WAIT_MS / 1000, 0.2)
        page.keyboard.up("Space")
        assert len(sent) == 1
    poll(lambda: card_of(d, w["id"], o["number"], "start", None)["state"] == "spent", UI_WAIT_MS / 1000, 0.2)


def test_dwell_touch_long_press(browser, app_url, cleanup):
    d, g, w, o, card, t = stroke_order(app_url, cleanup)
    with screen(browser, app_url, "rory", "/field", "375") as page:
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        c = field_card(page, t, w["label"]).filter(has_text="Start")
        btn = c.get_by_role("button", name=f"Hold to stroke {t}")
        btn.scroll_into_view_if_needed()
        expect(btn).to_be_visible(timeout=UI_WAIT_MS)
        sent = watch(page, "/stroke", "POST")
        x, y = center(btn)
        scroll0 = page.evaluate("() => [window.scrollX, window.scrollY]")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        advance(page, DWELL_MS / 2)
        menu_blocked = btn.evaluate("e => !e.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}))")
        advance(page, DWELL_MS / 2 + FRAME_MS)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        poll(lambda: sent, UI_WAIT_MS / 1000, 0.2)
        assert menu_blocked
        assert page.evaluate("() => String(window.getSelection())") == ""
        assert page.evaluate("() => [window.scrollX, window.scrollY]") == scroll0
        assert len(sent) == 1


def test_stroke_waits_for_the_store(browser, cleanup):
    base = outage_url("minio-down")
    d, mara, rory = Api(base, "hal"), Api(base, "mara"), Api(base, "rory")
    w = window(d, "W-L4-A")
    assert w["status"] in ("open", "closing"), "W-L4-A on the store-outage copy is no longer open"
    clear_turnout(base, "mara", "T4-07")
    o = ok(place(mara, "T4-07", w["id"], TINY), 201)["order"]
    cleanup.append((base, o["number"]))
    c = card_of(d, w["id"], o["number"], "start")
    w0 = window(d, w["id"])
    _, s3 = observers("minio-down")
    with screen(browser, base, "rory", "/field") as page:
        t4 = o["turnout"]
        fc = field_card(page, t4, w["label"]).filter(has_text="Start")
        btn = fc.get_by_role("button", name=f"Hold to stroke {t4}")
        expect(btn).to_be_visible(timeout=UI_WAIT_MS)
        btn.focus()
        page.keyboard.down("Space")
        advance(page, DWELL_MS + FRAME_MS)
        page.keyboard.up("Space")
        status = page.get_by_role("status", name="Gate dwell status")
        expect(status).to_have_text("The evidence store is not answering. The stroke will count once it is stored.",
                                    timeout=UI_WAIT_MS * 2)
        waiting = page.get_by_role("article", name=f"Gate card {t4}").filter(has_text="Waiting for the store")
        expect(waiting).to_have_count(1)
        expect(waiting.get_by_role("button", name=f"Hold to stroke {t4}")).to_have_count(0)
        assert card_of(d, w["id"], o["number"], "start", "waiting-for-store")
        err(rory.post(f"/api/gate-cards/{c['id']}/stroke"), 409, "card_not_open")
        w1 = window(d, w["id"])
        assert (w1["channel_flow_ml_day"], w1["delivered_ml"]) == (w0["channel_flow_ml_day"], w0["delivered_ml"])
        assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "scheduled"
        assert f"strokes/{c['id']}.json" not in safe_keys(s3, "strokes/")
        with relay(*minio_target()):
            poll(lambda: card_of(d, w["id"], o["number"], "start", None)["state"] == "spent", RESUME_S + SLACK_S)
            record = json.loads(s3.get(f"strokes/{c['id']}.json"))
            assert (record["card_id"], record["order_number"], record["kind"], record["operator_code"], record["turnout"]) == \
                (c["id"], o["number"], "start", "OP-D-01", "T4-07")
            ts(record["committed_at"])
            assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "running"
            assert D(window(d, w["id"])["channel_flow_ml_day"]) == D(w0["channel_flow_ml_day"]) + D(o["rate_ml_day"])
            live(page, lambda: expect(page.get_by_role("region", name=f"Stroke record {t4}").first).to_be_visible(timeout=REAL_WAIT_MS))
            fin = card_of(d, w["id"], o["number"], "finish")
            ok(rory.post(f"/api/gate-cards/{fin['id']}/stroke"))
        err(rory.post(f"/api/gate-cards/{c['id']}/stroke"), 409, "card_not_open")
        err(rory.post(f"/api/gate-cards/{fin['id']}/stroke"), 409, "card_not_open")
    assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "delivered"
    assert D(window(d, w["id"])["delivered_ml"]) == D(w0["delivered_ml"]) + D(TINY)


def test_spent_card_never_strokes_twice(browser, app_url, cleanup):
    d, g, w, o, card, t = stroke_order(app_url, cleanup)
    rory = Api(app_url, "rory")
    ok(rory.post(f"/api/gate-cards/{card['id']}/stroke"))
    flow = window(d, w["id"])["channel_flow_ml_day"]
    for _ in range(2):
        err(rory.post(f"/api/gate-cards/{card['id']}/stroke"), 409, "card_not_open")
    assert window(d, w["id"])["channel_flow_ml_day"] == flow
    assert len([c for c in cards(d, w["id"]) if c["order_number"] == o["number"] and c["kind"] == "finish"]) == 1
    with screen(browser, app_url, "rory", "/field") as page:
        records = page.get_by_role("list", name="Gate cards").get_by_role("article", name=f"Gate card {t}").filter(
            has=page.get_by_role("region", name=f"Stroke record {t}"))
        expect(records.first).to_be_visible(timeout=UI_WAIT_MS)
        for i in range(records.count()):
            expect(records.nth(i).get_by_role("button", name=f"Hold to stroke {t}")).to_have_count(0)


@pytest.mark.parametrize("mode", MOTION_MODES, ids=MOTION_MODES)
def test_flow_numeral_on_confirmation(browser, app_url, cleanup, mode):
    d, g, w, o, card, t = stroke_order(app_url, cleanup, volume=STROKE_ML)
    old = D(window(d, w["id"])["channel_flow_ml_day"])
    new = old + D(o["rate_ml_day"])
    assert new > old
    with screen(browser, app_url, "rory", "/field", reduced_motion=mode) as page:
        c = field_card(page, t, w["label"]).filter(has_text="Start")
        btn = c.get_by_role("button", name=f"Hold to stroke {t}")
        expect(btn).to_be_visible(timeout=UI_WAIT_MS)
        prog = c.get_by_role("progressbar", name=f"Dwell progress {t}")
        flows = (page.get_by_role("list", name="Gate cards").get_by_role("article", name=f"Gate card {t}")
                 .filter(has_text=w["label"]).get_by_role("group", name="Channel flow"))
        btn.focus()
        page.keyboard.down("Space")
        advance(page, DWELL_MS / 2)
        assert 0 < progress(prog) < 100
        advance(page, DWELL_MS / 2 + FRAME_MS)
        page.keyboard.up("Space")
        expect(page.get_by_role("status", name="Gate dwell status")).to_have_text(
            f"Stroke stored for {t}. Flow now {q3(new)} ML/day.", timeout=UI_WAIT_MS)

        def values():
            return [figure(x) for x in flows.all_inner_texts()]

        if mode == "reduce":
            assert new in values() and all(v in (old, new) for v in values())
        else:
            advance(page, COUNT_MS / 2)
            assert any(old < v < new for v in values()), values()
            advance(page, COUNT_MS / 2 + FRAME_MS)
            assert new in values()


def test_holder_succession_api(app_url, cleanup):
    d, g, w, o, card, t = stroke_order(app_url, cleanup, holder="OP-D-02")
    rory, tess = Api(app_url, "rory"), Api(app_url, "tess")
    r = ok(d.post(f"/api/gate-cards/{card['id']}/remove-holder"))
    assert (r["card"]["holder_code"], r["order"]["holder_code"]) == ("OP-D-01", "OP-D-01") == (w["rostered_operator"],) * 2
    err(tess.post(f"/api/gate-cards/{card['id']}/stroke"), 409, "not_holder")
    err(d.post(f"/api/gate-cards/{card['id']}/remove-holder"), 409, "no_successor")
    assert card_of(d, w["id"], o["number"], "start")["holder_code"] == "OP-D-01"
    ok(rory.post(f"/api/gate-cards/{card['id']}/stroke"))
    err(d.post(f"/api/gate-cards/{card['id']}/remove-holder"), 409, "card_not_open")
    assert card_of(d, w["id"], o["number"], "finish")["holder_code"] == "OP-D-01"
    clear_turnout(app_url, "lin", "T12-03")
    lo = ok(place(Api(app_url, "lin"), "T12-03", w["id"], TINY, "OP-D-01", "OP-D-02"), 201)["order"]
    cleanup.append((app_url, lo["number"]))
    lc = card_of(d, w["id"], lo["number"], "start")
    r = ok(d.post(f"/api/gate-cards/{lc['id']}/remove-holder"))
    assert r["card"]["holder_code"] == "OP-D-02" and (r["order"]["holder_code"], r["order"]["standby_code"]) == ("OP-D-02", None)
    err(rory.post(f"/api/gate-cards/{lc['id']}/stroke"), 409, "not_holder")
    flow0 = window(d, w["id"])["channel_flow_ml_day"]
    hal2 = Api(app_url, "hal")
    s, rm = together(lambda: tess.post(f"/api/gate-cards/{lc['id']}/stroke"),
                     lambda: hal2.post(f"/api/gate-cards/{lc['id']}/remove-holder"))
    if rm.status_code == 200:
        err(s, 409, "not_holder")
        assert card_of(d, w["id"], lo["number"], "start")["holder_code"] == "OP-D-01"
        assert window(d, w["id"])["channel_flow_ml_day"] == flow0
    else:
        assert s.status_code in (200, 202), s.text
        err(rm, 409, "card_not_open")


def test_handover_reaches_open_field_views(browser, app_url, cleanup):
    d, g, w, o, card, t = stroke_order(app_url, cleanup, holder="OP-D-01", standby="OP-D-02")
    with contextlib.ExitStack() as st:
        rp = st.enter_context(screen(browser, app_url, "rory", "/field"))
        tp = st.enter_context(screen(browser, app_url, "tess", "/field"))
        mine = field_card(rp, t, w["label"]).filter(has_text="Start")
        btn = mine.get_by_role("button", name=f"Hold to stroke {t}")
        expect(btn).to_be_visible(timeout=UI_WAIT_MS)
        expect(tp.get_by_role("list", name="Gate cards")).to_be_visible(timeout=UI_WAIT_MS)
        sent = watch(rp, "/stroke", "POST")
        x, y = center(btn)
        rp.mouse.move(x, y)
        ok(d.post(f"/api/gate-cards/{card['id']}/remove-holder"))
        spent = 0
        while mine.count() and spent <= LIVE_MS + LIVE_SLACK_MS:
            rp.mouse.down()
            for _ in range(4):
                advance(rp, DWELL_MS / 5)
                spent += DWELL_MS / 5
                rp.wait_for_load_state()
                if not mine.count():
                    break
            rp.mouse.up()
        assert mine.count() == 0, "the handed-over card stayed on the removed holder's view"
        assert sent == []
        expect(rp.get_by_role("status", name="Gate dwell status")).to_have_text(
            "This gate card has moved to another operator.", timeout=UI_WAIT_MS)
        live(tp, lambda: (expect(field_card(tp, t, w["label"])).to_be_visible(timeout=REAL_WAIT_MS),
                          expect(tp.get_by_role("status", name="Gate dwell status")).to_have_text(
                              f"Gate card for {t} is now yours.", timeout=REAL_WAIT_MS)))
    assert card_of(d, w["id"], o["number"], "start")["holder_code"] == "OP-D-02"


def test_order_state_machine_api(app_url, cleanup):
    d, mara = Api(app_url, "hal"), Api(app_url, "mara")
    w = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    o = ok(place(mara, "T9-02", w["id"], "0.500"), 201)["order"]
    cleanup.append((app_url, o["number"]))

    def unchanged(number, wid, call):
        o0, c0, a0 = d.j("GET", f"/api/orders/{number}")["order"], window(d, wid)["committed_ml"], alloc(mara)
        err(call(), 409, "illegal_transition")
        assert (d.j("GET", f"/api/orders/{number}")["order"], window(d, wid)["committed_ml"], alloc(mara)) == (o0, c0, a0)

    n = o["number"]
    unchanged(n, w["id"], lambda: d.post(f"/api/orders/{n}/schedule"))
    assert ok(mara.post(f"/api/orders/{n}/cancel"))["order"]["status"] == "closed"
    unchanged(n, w["id"], lambda: mara.post(f"/api/orders/{n}/cancel"))
    unchanged(n, w["id"], lambda: d.post(f"/api/orders/{n}/close"))
    unchanged(n, w["id"], lambda: d.post(f"/api/orders/{n}/schedule"))
    _, _, sw, so, sc, _ = stroke_order(app_url, cleanup)
    rory = Api(app_url, "rory")
    ok(rory.post(f"/api/gate-cards/{sc['id']}/stroke"))
    s = so["number"]
    unchanged(s, sw["id"], lambda: mara.post(f"/api/orders/{s}/cancel"))
    unchanged(s, sw["id"], lambda: d.post(f"/api/orders/{s}/reopen"))
    unchanged(s, sw["id"], lambda: d.post(f"/api/orders/{s}/schedule"))
    ok(rory.post(f"/api/gate-cards/{card_of(d, sw['id'], s, 'finish')['id']}/stroke"))
    assert d.j("GET", f"/api/orders/{s}")["order"]["status"] == "delivered"
    for path in ("close", "reopen", "schedule"):
        unchanged(s, sw["id"], lambda path=path: d.post(f"/api/orders/{s}/{path}"))
    unchanged(s, sw["id"], lambda: mara.post(f"/api/orders/{s}/cancel"))


def test_dispatcher_close_and_reopen(app_url, cleanup):
    d, mara, dev = Api(app_url, "hal"), Api(app_url, "mara"), Api(app_url, "dev")
    w = upcoming_window(d, "C-09", 1, "24.000")
    for who in ("mara", "dev"):
        clear_turnout(app_url, who, TURNOUTS[who]["C-09"])
    before = alloc(mara)
    o2 = ok(place(mara, "T9-02", w["id"], "0.500"), 201)["order"]
    o3 = ok(place(dev, "T9-05", w["id"], "0.400"), 201)["order"]
    cleanup += [(app_url, o2["number"]), (app_url, o3["number"])]
    moved = ok(d.post(f"/api/windows/{w['id']}/restrictions", {"cap_ml_day": "12.000", "reason": REASON}), 201)["moved_orders"]
    assert moved == [o3["number"]]
    dev_before = alloc(dev)
    err(d.post(f"/api/orders/{o3['number']}/schedule"), 409, "window_full")
    assert d.j("GET", f"/api/orders/{o3['number']}")["order"]["status"] == "requested" and alloc(dev) == dev_before
    assert ok(d.post(f"/api/orders/{o3['number']}/close"))["order"]["status"] == "closed"
    assert alloc(dev) == dev_before
    r = ok(d.post(f"/api/orders/{o2['number']}/close"))
    assert r["order"]["status"] == "closed" and r["window"]["committed_ml"] == "0.000"
    assert alloc(mara) == before
    assert not [c for c in cards(d, w["id"]) if c["order_number"] == o2["number"] and c["state"] == "open"]
    err(d.post(f"/api/orders/{o2['number']}/reopen"), 409, "not_reopenable")
    _, _, sw, so, sc, _ = stroke_order(app_url, cleanup)
    rory = Api(app_url, "rory")
    ok(rory.post(f"/api/gate-cards/{sc['id']}/stroke"))
    w0, a0 = window(d, sw["id"]), alloc(mara)
    r = ok(d.post(f"/api/orders/{so['number']}/close"))
    assert (r["order"]["status"], r["order"]["closed_after_flow"]) == ("closed", True)
    assert (window(d, sw["id"])["committed_ml"], alloc(mara)) == (w0["committed_ml"], a0)
    assert card_of(d, sw["id"], so["number"], "finish")["holder_code"] == "OP-D-01"
    other = ok(place(mara, "T12-04", sw["id"], TINY), 201)["order"]
    cleanup.append((app_url, other["number"]))
    err(d.post(f"/api/orders/{so['number']}/reopen"), 409, "turnout_busy")
    ok(mara.post(f"/api/orders/{other['number']}/cancel"))
    assert ok(d.post(f"/api/orders/{so['number']}/reopen"))["order"]["status"] == "running"
    ok(d.post(f"/api/orders/{so['number']}/close"))
    delivered0 = window(d, sw["id"])["delivered_ml"]
    ok(rory.post(f"/api/gate-cards/{card_of(d, sw['id'], so['number'], 'finish')['id']}/stroke"))
    assert d.j("GET", f"/api/orders/{so['number']}")["order"]["status"] == "closed"
    assert window(d, sw["id"])["delivered_ml"] == delivered0
    err(d.post(f"/api/orders/{so['number']}/reopen"), 409, "not_reopenable")


_LAPSE_TAKEN = set()


def lapse_slot(app_url):
    found = []
    for inst in ("minio-down", "mailpit-down", "primary"):
        base = app_url if inst == "primary" else outage_url(inst)
        d = Api(base, "hal")
        for ch in LAPSE_CHANNELS:
            now, ws = windows_of(d, ch)
            t = now + timedelta(seconds=LAPSE_LEAD_S)
            hit = overlaps(ws, t - timedelta(hours=1), t)
            while hit:
                t = max(ts(x["closes_at"]) for x in hit) + timedelta(hours=1)
                hit = overlaps(ws, t - timedelta(hours=1), t)
            found.append((t - now, inst, base, ch, t))
    budget = timedelta(seconds=LAPSE_WAIT_S)
    chosen = min(found, key=lambda f: (f[0] > budget, (f[1], f[3]) in _LAPSE_TAKEN, f[0]))
    _LAPSE_TAKEN.add((chosen[1], chosen[3]))
    return chosen


class Scene:
    pass


def lapse_scene(app_url, cleanup) -> Scene:
    wait, inst, base, ch, closes = lapse_slot(app_url)
    if wait > timedelta(seconds=LAPSE_WAIT_S):
        pytest.fail("no channel hour is free for a lapse window")
    s = Scene()
    s.inst, s.base, s.ch, s.closes = inst, base, ch, closes
    run_who, run_t, s.who, s.turnout = LAPSE_CHANNELS[ch]
    s.d = d = Api(base, "hal")
    s.clock_ch = next(x for x in RAIL if x != ch)
    opens = closes - timedelta(hours=1)
    s.w = ok(create_window(d, ch, opens, 1, MAX_RATE[s.turnout]), 201)["window"]
    wid = s.w["id"]
    assert s.w["cap_volume_ml"] == turnout_max(s.turnout, 1)
    clear_turnout(base, run_who, run_t)
    clear_turnout(base, s.who, s.turnout)
    runner, s.grower = Api(base, run_who), Api(base, s.who)
    s.a = ok(place(runner, run_t, wid, TINY), 201)["order"]
    fits = q3(D(s.w["cap_volume_ml"]) - D(TINY))
    s.c = ok(place(s.grower, s.turnout, wid, fits), 201)["order"]
    cleanup += [(base, s.a["number"]), (base, s.c["number"])]
    first = opens.replace(second=0, microsecond=0) + timedelta(minutes=2)
    poll(lambda: windows_of(d, s.clock_ch)[0] >= first, LAPSE_WAIT_S, 1)
    store = relay(*minio_target()) if inst == "minio-down" else contextlib.nullcontext()
    with store:
        ok(Api(base, "rory").post(f"/api/gate-cards/{card_of(d, wid, s.a['number'], 'start')['id']}/stroke"))
    r = ok(d.post(f"/api/windows/{wid}/restrictions", {"cap_ml_day": TINY, "reason": REASON}), 201)
    assert r["moved_orders"] == [s.c["number"]]
    s.remaining_after = q3(D(r["window"]["cap_volume_ml"]) - D(TINY))
    s.alloc_after = alloc(s.grower)
    s.e = ok(place(s.grower, s.turnout, wid, TINY), 201)["order"]
    cleanup.append((base, s.e["number"]))
    return s


def await_close(s):
    poll(lambda: windows_of(s.d, s.clock_ch)[0] >= s.closes, LAPSE_WAIT_S, 0.3)


@pytest.mark.timeout(LAPSE_WAIT_S + 600)
def test_lapse_at_window_close(app_url, cleanup):
    s = lapse_scene(app_url, cleanup)
    d, wid = s.d, s.w["id"]
    await_close(s)
    oe = s.grower.j("GET", f"/api/orders/{s.e['number']}")["order"]
    assert (oe["status"], oe["conflict"], oe["closed_after_flow"]) == ("closed", "lapsed", False)
    ww = window(d, wid)
    assert (ww["status"], ww["committed_ml"], ww["remaining_ml"]) == ("closed", TINY, s.remaining_after)
    assert alloc(s.grower) == s.alloc_after
    assert not [c for c in cards(d, wid) if c["order_number"] == s.e["number"] and c["state"] == "open"]
    oc = d.j("GET", f"/api/orders/{s.c['number']}")["order"]
    assert (oc["status"], oc["conflict"]) == ("closed", "lapsed")
    assert d.j("GET", f"/api/orders/{s.a['number']}")["order"]["status"] == "running"
    assert card_of(d, wid, s.a["number"], "finish")["state"] == "open"
    err(d.post(f"/api/orders/{s.e['number']}/reopen"), 409, "not_reopenable")


@pytest.mark.timeout(LAPSE_WAIT_S + 600)
def test_lapse_notice_exactly_once(app_url, mail, cleanup):
    s = lapse_scene(app_url, cleanup)
    d, wid, base = s.d, s.w["id"], s.base
    run_who = LAPSE_CHANNELS[s.ch][0]
    await_close(s)
    readers = [Api(base, who) for who in (s.who, "hal", "priya", "hal", s.who, run_who)]
    out = together(lambda: readers[0].get(f"/api/orders/{s.e['number']}"),
                   lambda: readers[1].get(f"/api/windows/{wid}"),
                   lambda: readers[2].get("/api/totals"),
                   lambda: readers[3].get("/api/gate-cards", params={"window": wid}),
                   lambda: readers[4].get("/api/me/allocation"),
                   lambda: readers[5].get("/api/me/allocation"))
    assert [r.status_code for r in out] == [200] * len(out)
    assert out[0].json()["order"]["status"] == "closed"
    assert alloc(s.grower) == s.alloc_after
    assert len([n for n in d.j("GET", f"/api/windows/{wid}/notices")["notices"] if n["kind"] == "lapse"]) == 1
    subject = f"Ditchbook lapse: {CHANNEL_NAME[s.ch]}, {s.w['label']}"
    mailer = relay(*smtp_target()) if s.inst == "mailpit-down" else contextlib.nullcontext()
    with mailer:
        msgs = await_mail(mail, EMAIL[s.who], subject, seconds=RESUME_S + SLACK_S)
    assert len(msgs) == 1
    body = text(msgs[0])
    assert f"Order {s.c['number']} lapsed when the window closed. Nothing was debited for it." in body
    assert f"Order {s.e['number']} lapsed when the window closed. {TINY} ML is back in your allocation." in body
    assert inbox(mail, EMAIL[run_who], subject) == []
    assert len(inbox(mail, EMAIL[s.who], subject)) == 1


@pytest.mark.timeout(LAPSE_WAIT_S + 600)
def test_board_follows_window_close(browser, app_url, cleanup):
    s = lapse_scene(app_url, cleanup)
    with screen(browser, s.base, "hal", f"/board?channels={s.ch}&window={s.w['id']}&tab=orders") as bp:
        bp.clock.set_system_time(s.closes + timedelta(hours=7))
        rows = bp.get_by_role("table", name="Window orders").get_by_role("row")
        expect(rows.filter(has_text=s.e["number"])).to_contain_text("Scheduled", timeout=UI_WAIT_MS)
        expect(bp.get_by_role("button", name=f"Schedule order {s.c['number']}")).to_be_visible()
        await_close(s)
        live(bp, lambda: [expect(rows.filter(has_text=n)).to_contain_text("Closed (lapsed)", timeout=REAL_WAIT_MS)
                          for n in (s.c["number"], s.e["number"])])
        for n in (s.c["number"], s.e["number"]):
            expect(bp.get_by_role("button", name=f"Schedule order {n}")).to_have_count(0)
            expect(bp.get_by_role("button", name=f"Reopen order {n}")).to_have_count(0)
        expect(rows.filter(has_text=s.a["number"])).to_contain_text("Running")
        expect(bp.get_by_role("button", name=f"Close order {s.a['number']}")).to_be_visible()
        after_flow(bp, lambda: expect(bp.get_by_role("group", name="Remaining ML")).to_contain_text(
            s.remaining_after, timeout=TRY_MS))
    assert window(s.d, s.w["id"])["remaining_ml"] == s.remaining_after


@pytest.mark.timeout(LAPSE_WAIT_S + 600)
def test_window_status_follows_server(browser, app_url, cleanup):
    s = lapse_scene(app_url, cleanup)
    wid, label = s.w["id"], s.w["label"]
    run_t = LAPSE_CHANNELS[s.ch][1]
    with contextlib.ExitStack() as st:
        fp = st.enter_context(screen(browser, s.base, s.who, f"/grower/orders/new?window={wid}"))
        fp.clock.set_system_time(s.closes + timedelta(hours=3))
        rp = st.enter_context(screen(browser, s.base, "rory", "/field"))
        rp.clock.set_system_time(s.closes - timedelta(hours=4))
        label_now = STATUS_LABEL[window(s.d, wid)["status"]]
        wstat = fp.get_by_role("status", name="Window status")
        expect(wstat).to_contain_text(label_now, timeout=UI_WAIT_MS)
        group = field_card(rp, run_t, label).get_by_role("group", name=f"Window status {run_t}")
        expect(group).to_contain_text(label_now, timeout=UI_WAIT_MS)
        await_close(s)
        live(fp, lambda: (expect(wstat).to_contain_text("Closed", timeout=REAL_WAIT_MS),
                          expect(fp.get_by_role("button", name="Place order")).to_have_attribute(
                              "aria-disabled", "true", timeout=REAL_WAIT_MS)))
        live(rp, lambda: expect(group).to_contain_text("Closed", timeout=REAL_WAIT_MS))


def test_board_order_actions_are_honest(browser, app_url, cleanup):
    d, w, a, b = restriction_scene(app_url, cleanup)
    ok(d.post(f"/api/windows/{w['id']}/restrictions", {"cap_ml_day": RW_CUT, "reason": REASON}), 201)
    with screen(browser, app_url, "hal", f"/board?channels=C-09&window={w['id']}&tab=orders") as page:
        rows = page.get_by_role("table", name="Window orders").get_by_role("row")
        rem, status = page.get_by_role("group", name="Remaining ML"), page.get_by_role("status", name="Board status")
        expect(rem).to_contain_text(CUT_LEFT, timeout=UI_WAIT_MS)
        sched = page.get_by_role("button", name=f"Schedule order {b['number']}")
        with hold(page, f"**/api/orders/{b['number']}/schedule") as gate:
            click(sched)
            expect(sched).to_have_attribute("aria-disabled", "true", timeout=UI_WAIT_MS)
            expect(status).to_have_text(f"Updating order {b['number']}.")
            expect(rows.filter(has_text=b["number"])).to_contain_text("Requested")
            expect(rem).to_contain_text(CUT_LEFT)
            gate.release()
        expect(status).to_have_text("Not enough capacity left in this window.", timeout=UI_WAIT_MS)
        expect(rows.filter(has_text=b["number"])).to_contain_text("Requested")
        close = page.get_by_role("button", name=f"Close order {a['number']}")
        with hold(page, f"**/api/orders/{a['number']}/close") as gate:
            click(close)
            expect(close).to_have_attribute("aria-disabled", "true", timeout=UI_WAIT_MS)
            expect(rows.filter(has_text=a["number"])).to_contain_text("Scheduled")
            expect(rem).to_contain_text(CUT_LEFT)
            gate.release()
        expect(rows.filter(has_text=a["number"])).to_contain_text("Closed", timeout=UI_WAIT_MS)
        after_flow(page, lambda: expect(rem).to_contain_text(CUT_VOLUME, timeout=TRY_MS))
        Api(app_url, "dev").post(f"/api/orders/{b['number']}/cancel")
        click(page.get_by_role("button", name=f"Schedule order {b['number']}"))
        expect(status).to_have_text("That change is not allowed for this order now.", timeout=UI_WAIT_MS)
        expect(rows.filter(has_text=b["number"])).to_contain_text("Closed")


def test_publish_pro_rated_restriction(app_url, cleanup):
    d, w, a, b = restriction_scene(app_url, cleanup)
    dev = Api(app_url, "dev")
    dev_before = alloc(dev)
    url = f"/api/windows/{w['id']}/restrictions"
    field_err(d.post(url, {"cap_ml_day": RW_CAP, "reason": REASON}), "cap_ml_day")
    field_err(d.post(url, {"cap_ml_day": RW_CUT, "reason": "ab"}), "reason")
    assert window(d, w["id"])["restriction_cap_ml_day"] is None
    r = ok(d.post(url, {"cap_ml_day": RW_CUT, "reason": REASON}), 201)
    assert r["restriction"]["effective_at"].endswith(":00Z") and r["moved_orders"] == [b["number"]]
    ww = r["window"]
    assert (ww["restriction_cap_ml_day"], ww["effective_cap_ml_day"], ww["cap_volume_ml"], ww["remaining_ml"]) == \
        (RW_CUT, RW_CUT, CUT_VOLUME, CUT_LEFT)
    ob = d.j("GET", f"/api/orders/{b['number']}")["order"]
    assert (ob["status"], ob["conflict"]) == ("requested", "restriction")
    assert alloc(dev) == dev_before + D(RW_ML)
    assert not [c for c in cards(d, w["id"]) if c["order_number"] == b["number"] and c["state"] == "open"]
    assert d.j("GET", f"/api/orders/{a['number']}")["order"]["status"] == "scheduled"
    err(d.post(url, {"cap_ml_day": "5.000", "reason": REASON}), 409, "restriction_exists")
    past = past_window(d, "C-09")
    err(d.post(f"/api/windows/{past['id']}/restrictions", {"cap_ml_day": "1.000", "reason": REASON}), 409, "window_closed")


def test_restriction_notices(app_url, mail, cleanup):
    d, w, a, b = restriction_scene(app_url, cleanup)
    ok(d.post(f"/api/windows/{w['id']}/restrictions", {"cap_ml_day": RW_CUT, "reason": REASON}), 201)
    subject = f"Ditchbook restriction: Channel 9, {w['label']}"
    mm = await_mail(mail, EMAIL["mara"], subject)
    dm = await_mail(mail, EMAIL["dev"], subject)
    assert len(mm) == len(dm) == 1
    assert a["number"] in text(mm[0]) and "OP-D-01" in text(mm[0]) and "12.000" in text(mm[0])
    assert f"Order {b['number']} no longer fits and is back in requested. Its volume is back in your allocation." in text(dm[0])
    assert inbox(mail, EMAIL["lin"], subject) == []
    base = outage_url("mailpit-down")
    od = Api(base, "hal")
    ow = upcoming_window(od, "C-09", 3, "24.000")
    clear_turnout(base, "mara", "T9-02")
    cleanup.append((base, ok(place(Api(base, "mara"), "T9-02", ow["id"], TINY), 201)["order"]["number"]))
    ok(od.post(f"/api/windows/{ow['id']}/restrictions", {"cap_ml_day": "12.000", "reason": REASON}), 201)
    assert [n["state"] for n in od.j("GET", f"/api/windows/{ow['id']}/notices")["notices"]] == ["queued"]
    osub = f"Ditchbook restriction: Channel 9, {ow['label']}"
    assert inbox(mail, EMAIL["mara"], osub) == []
    with relay(*smtp_target()):
        poll(lambda: [n["state"] for n in od.j("GET", f"/api/windows/{ow['id']}/notices")["notices"]] == ["sent"],
             RESUME_S + SLACK_S)
        assert len(await_mail(mail, EMAIL["mara"], osub)) == 1
    assert len(inbox(mail, EMAIL["mara"], osub)) == 1


def test_restriction_updates_open_screens(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    with contextlib.ExitStack() as st:
        fp = st.enter_context(screen(browser, app_url, "mara", f"/grower/orders/new?window={w['id']}"))
        bp = st.enter_context(screen(browser, app_url, "hal", f"/board?channels=C-09&window={w['id']}"))
        expect(fp.get_by_role("status", name="Window status")).to_contain_text("Not yet open", timeout=UI_WAIT_MS)
        expect(bp.get_by_role("group", name="Remaining ML")).to_contain_text(w["remaining_ml"], timeout=UI_WAIT_MS)
        box = bp.get_by_role("combobox", name="Search turnouts, growers and operators")
        fill(box, "Channel 9")
        advance(bp, STEP_MS)
        r = ok(d.post(f"/api/windows/{w['id']}/restrictions", {"cap_ml_day": "12.000", "reason": REASON}), 201)
        rem = r["window"]["remaining_ml"]
        live(fp, lambda: (expect(fp.get_by_role("status", name="Window status")).to_contain_text(
            f"Restricted to 12.000 ML/day, {rem} ML left.", timeout=REAL_WAIT_MS),
            expect(fp.get_by_role("group", name="Window remaining")).to_contain_text(f"{rem} ML", timeout=REAL_WAIT_MS)))
        live(bp, lambda: (expect(bp.get_by_role("button", name=f"Channel 9, {w['label']}, {rem} ML remaining")).to_be_visible(timeout=REAL_WAIT_MS),
                          expect(bp.get_by_role("group", name="Remaining ML")).to_contain_text(rem, timeout=REAL_WAIT_MS)))
        earliest = next(x for x in windows_of(d, "C-09")[1] if x["status"] != "closed")
        if earliest["orderable"] and earliest["id"] != w["id"]:
            clear_turnout(app_url, "mara", "T9-02")
            cleanup.append((app_url, ok(place(Api(app_url, "mara"), "T9-02", earliest["id"], TINY), 201)["order"]["number"]))
        detail = next(s["detail"] for s in d.j("GET", "/api/search", params={"q": "Channel 9"})["suggestions"] if s["kind"] == "channel")
        assert detail.startswith(f"{window(d, earliest['id'])['remaining_ml']} ML left, {earliest['label']}")
        live(bp, lambda: expect(bp.get_by_role("listbox", name="Suggestions").get_by_role("option").first).to_contain_text(
            detail, timeout=REAL_WAIT_MS))


def test_restriction_shortcut(browser, app_url):
    d = Api(app_url, "hal")
    w = quiet_window(d, "C-09", 1, "24.000")
    with screen(browser, app_url, "hal", "/board?channels=C-09") as page:
        expect(page.get_by_role("grid", name="Window grid")).to_be_visible(timeout=UI_WAIT_MS)
        dialog = page.get_by_role("dialog", name="Publish restriction")
        page.get_by_role("button", name="Sign out").focus()
        page.keyboard.press("r")
        advance(page, STEP_MS)
        expect(dialog).to_have_count(0)
        cell = page.get_by_role("button", name=f"Channel 9, {w['label']}, {w['remaining_ml']} ML remaining")
        click(cell)
        for opener in (page.get_by_role("tab", name="Orders"), cell, page.get_by_role("checkbox", name="Channel 9")):
            opener.focus()
            page.keyboard.press("r")
            expect(dialog).to_be_visible(timeout=UI_WAIT_MS)
            expect(dialog.get_by_role("textbox", name="Cap (ML/day)", exact=True)).to_be_focused()
            page.keyboard.press("Escape")
            advance(page, DWELL_MS)
            expect(dialog).to_have_count(0, timeout=UI_WAIT_MS)
            expect(page.get_by_role("button", name="Publish restriction")).to_be_focused()
        box = page.get_by_role("combobox", name="Search turnouts, growers and operators")
        box.focus()
        page.keyboard.press("r")
        advance(page, STEP_MS)
        expect(dialog).to_have_count(0)


def test_restriction_dialog_survives_timers(browser, app_url):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    with screen(browser, app_url, "hal", f"/board?channels=C-09&window={w['id']}") as page:
        dialog = page.get_by_role("dialog", name="Publish restriction")
        cap = dialog.get_by_role("textbox", name="Cap (ML/day)", exact=True)
        opener = page.get_by_role("button", name="Publish restriction")
        expect(opener).to_be_visible(timeout=UI_WAIT_MS)
        click(opener)
        expect(cap).to_be_focused(timeout=UI_WAIT_MS)
        page.keyboard.press("Escape")
        page.keyboard.press("r")
        advance(page, DWELL_MS)
        expect(dialog).to_be_visible()
        expect(cap).to_be_focused()
        assert style(dialog, "opacity")["opacity"] == "1"
        advance(page, DWELL_MS)
        expect(dialog).to_be_visible()
        click(dialog.get_by_role("button", name="Cancel", exact=True))
        click(opener)
        advance(page, DWELL_MS)
        expect(dialog).to_be_visible()
        bad = {"cap_ml_day": "24.000", "reason": "ab"}
        errors = d.post(f"/api/windows/{w['id']}/restrictions", bad).json()["errors"]
        fill(cap, bad["cap_ml_day"])
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), bad["reason"])
        click(dialog.get_by_role("button", name="Publish", exact=True))
        for msg in errors.values():
            expect(dialog).to_contain_text(msg, timeout=UI_WAIT_MS)
        advance(page, LIVE_MS + STEP_MS)
        expect(cap).to_have_value(bad["cap_ml_day"])
        for msg in errors.values():
            expect(dialog).to_contain_text(msg)
        ok(d.post(f"/api/windows/{w['id']}/restrictions", {"cap_ml_day": "20.000", "reason": REASON}), 201)
        fill(cap, "18.000")
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), REASON)
        click(dialog.get_by_role("button", name="Publish", exact=True))
        status = page.get_by_role("status", name="Board status")
        expect(status).to_have_text("This window already has a restriction.", timeout=UI_WAIT_MS)
        expect(dialog).to_be_visible()
        advance(page, LIVE_MS + STEP_MS)
        advance(page, LIVE_MS + STEP_MS)
        expect(status).to_have_text("This window already has a restriction.")
        page.keyboard.press("Escape")
        expect(page.get_by_role("button", name="Publish restriction")).to_be_focused(timeout=UI_WAIT_MS)
        box = page.get_by_role("combobox", name="Search turnouts, growers and operators")
        box.focus()
        page.keyboard.press("r")
        advance(page, STEP_MS)
        expect(dialog).to_have_count(0)


DST_CASES = {
    "dst-ends": ("C-L4", "2027-04-03T13:00:00Z", "2027-04-04T14:00:00Z", "Sun 4 Apr 00:00 to Mon 5 Apr 00:00", 25, "25.000"),
    "dst-starts": ("C-L4", "2026-10-03T14:00:00Z", "2026-10-04T13:00:00Z", "Sun 4 Oct 00:00 to Mon 5 Oct 00:00", 23, "23.000"),
    "repeated-first": ("C-09", "2027-04-03T15:30:00Z", "2027-04-03T17:30:00Z", "Sun 4 Apr 02:30 AEDT to Sun 4 Apr 03:30", 2, "2.000"),
    "repeated-second": ("C-12", "2027-04-03T16:30:00Z", "2027-04-03T17:30:00Z", "Sun 4 Apr 02:30 AEST to Sun 4 Apr 03:30", 1, "1.000"),
}


def fixed_window(d, ch, opens, closes) -> dict:
    for w in windows_of(d, ch)[1]:
        if (w["opens_at"], w["closes_at"]) == (opens, closes):
            return w
    hours = int((ts(closes) - ts(opens)).total_seconds() // 3600)
    return ok(create_window(d, ch, ts(opens), hours, "24.000"), 201)["window"]


@pytest.mark.parametrize("case", list(DST_CASES), ids=list(DST_CASES))
def test_daylight_saving_windows(app_url, case):
    ch, opens, closes, label, hours, vol = DST_CASES[case]
    w = fixed_window(Api(app_url, "hal"), ch, opens, closes)
    assert (w["opens_at"], w["closes_at"], w["label"], D(str(w["hours"])), w["cap_volume_ml"]) == (opens, closes, label, hours, vol)


def test_capacity_table_revisions(app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    wid, url = w["id"], "/api/channels/C-09/capacity"
    r0 = d.j("GET", url)["revision"]
    saved = d.j("PUT", url, {"base_revision": r0, "cells": [{"window_id": wid, "cap_ml_day": "40.000"}]})
    assert saved["revision"] == r0 + 1
    assert window(d, wid)["cap_volume_ml"] == q3(D("40") / 24)
    current = d.j("GET", url)
    assert current["revision"] == r0 + 1 and current["revisions"][0]["revision"] == r0 + 1
    assert [x for x in current["cells"] if x["window_id"] == wid] == [{"window_id": wid, "cap_ml_day": "40.000"}]
    clear_turnout(app_url, "mara", "T9-02")
    o = ok(place(Api(app_url, "mara"), "T9-02", wid, "1.000"), 201)["order"]
    cleanup.append((app_url, o["number"]))
    field_err(d.put(url, {"base_revision": r0 + 1, "cells": [{"window_id": wid, "cap_ml_day": "20.000"}]}), f"cells.{wid}")
    past = past_window(d, "C-09")
    rev = d.j("GET", url)["revision"]
    field_err(d.put(url, {"base_revision": rev, "cells": [{"window_id": past["id"], "cap_ml_day": "5.000"}]}), f"cells.{past['id']}")
    assert d.j("GET", url)["revision"] == rev
    assert window(d, wid)["table_cap_ml_day"] == "40.000"


def test_conflicting_saves_settle_lower(app_url):
    d = Api(app_url, "hal")
    w1, w2 = upcoming_window(d, "C-09", 1, "24.000"), upcoming_window(d, "C-09", 1, "24.000")
    url = "/api/channels/C-09/capacity"
    r0 = d.j("GET", url)["revision"]

    def cell(wid, v):
        return [{"window_id": wid, "cap_ml_day": v}]

    assert d.j("PUT", url, {"base_revision": r0, "cells": cell(w1["id"], CAP_HIGH)})["revision"] == r0 + 1
    body = err(d.put(url, {"base_revision": r0, "cells": cell(w1["id"], CAP_HIGHER)}), 409, "revision_conflict")
    assert body["revision"] == r0 + 2 and body["submitted"] == cell(w1["id"], CAP_HIGHER)
    assert [x for x in body["cells"] if x["window_id"] == w1["id"]] == cell(w1["id"], CAP_HIGH)
    body = err(d.put(url, {"base_revision": r0, "cells": cell(w1["id"], CAP_LOWER)}), 409, "revision_conflict")
    assert [x for x in body["cells"] if x["window_id"] == w1["id"]] == cell(w1["id"], CAP_LOWER)
    current = d.j("GET", url)
    assert current["revision"] == r0 + 3
    assert [x for x in current["cells"] if x["window_id"] == w2["id"]] == cell(w2["id"], "24.000")
    assert window(d, w1["id"])["table_cap_ml_day"] == CAP_LOWER
    d2 = Api(app_url, "bea")
    a, b = together(lambda: d.put(url, {"base_revision": r0 + 3, "cells": cell(w2["id"], "30.000")}),
                    lambda: d2.put(url, {"base_revision": r0 + 3, "cells": cell(w2["id"], "20.000")}))
    assert sorted([a.status_code, b.status_code]) == [200, 409], (a.text, b.text)
    assert window(d, w2["id"])["table_cap_ml_day"] == "20.000"


def test_restore_earlier_revision(app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    wid, url = w["id"], "/api/channels/C-09/capacity"
    r0 = d.j("GET", url)["revision"]
    high = d.j("PUT", url, {"base_revision": r0, "cells": [{"window_id": wid, "cap_ml_day": "100.000"}]})["revision"]
    d.j("PUT", url, {"base_revision": high, "cells": [{"window_id": wid, "cap_ml_day": "60.000"}]})
    clear_turnout(app_url, "mara", "T9-02")
    o = ok(place(Api(app_url, "mara"), "T9-02", wid, "2.000"), 201)["order"]
    cleanup.append((app_url, o["number"]))
    ok(d.post(f"/api/windows/{wid}/restrictions", {"cap_ml_day": "50.000", "reason": REASON}), 201)
    before = d.j("GET", url)["revision"]
    body = err(d.post(f"{url}/revisions/{r0}/restore"), 409, "restore_below_committed")
    assert wid in body["windows"] and d.j("GET", url)["revision"] == before
    assert window(d, wid)["table_cap_ml_day"] == "60.000"
    r = d.j("POST", f"{url}/revisions/{high}/restore", status=201)
    assert r["restored_from"] == high and r["revision"] == before + 1
    assert [x for x in r["cells"] if x["window_id"] == wid] == [{"window_id": wid, "cap_ml_day": "100.000"}]
    oo = d.j("GET", f"/api/orders/{o['number']}")["order"]
    assert (oo["status"], oo["volume_ml"], oo["window_id"]) == ("scheduled", "2.000", wid)
    ww = window(d, wid)
    assert (ww["table_cap_ml_day"], ww["restriction_cap_ml_day"], ww["effective_cap_ml_day"]) == ("100.000", "50.000", "50.000")
    assert ww["cap_volume_ml"] == q3(D("50") / 24)
    assert d.j("GET", url)["revisions"][0]["restored_from"] == high


def test_typed_caps_survive_live_refresh(browser, app_url):
    d = Api(app_url, "hal")
    w1, w2 = upcoming_window(d, "C-09", 1, "24.000"), upcoming_window(d, "C-09", 1, "24.000")
    url = "/api/channels/C-09/capacity"
    with screen(browser, app_url, "bea", "/channels/C-09/capacity") as page:
        c1 = page.get_by_role("textbox", name=f"Cap for {w1['label']} (ML/day)")
        c2 = page.get_by_role("textbox", name=f"Cap for {w2['label']} (ML/day)")
        expect(c1).to_be_visible(timeout=UI_WAIT_MS)
        base = d.j("GET", url)["revision"]
        fill(c1, TYPED)
        r = d.j("PUT", url, {"base_revision": base, "cells": [{"window_id": w1["id"], "cap_ml_day": OTHER_CAP},
                                                               {"window_id": w2["id"], "cap_ml_day": "80.000"}]})
        assert r["revision"] == base + 1
        live(page, lambda: (expect(c2).to_have_value("80.000", timeout=REAL_WAIT_MS),
                            expect(page.get_by_role("button", name=f"Restore revision {base}", exact=True)).to_be_visible(
                                timeout=REAL_WAIT_MS)))
        expect(c1).to_have_value(TYPED)
        expect(page.get_by_text(f"Saved cap now {OTHER_CAP} ML/day")).to_be_visible()
        with page.expect_request(lambda q: q.method == "PUT" and "/capacity" in q.url, timeout=UI_WAIT_MS) as save:
            click(page.get_by_role("button", name="Save table"))
        sent = save.value.post_data_json
        assert sent["base_revision"] == base and [x["window_id"] for x in sent["cells"]] == [w1["id"]]
        expect(page.get_by_role("alertdialog", name="Capacity table conflict")).to_be_visible(timeout=UI_WAIT_MS)
        expect(c1).to_have_value(TYPED)


def test_conflict_dialog_keeps_typed_numbers(browser, app_url):
    d = Api(app_url, "hal")
    w1, w2 = upcoming_window(d, "C-09", 1, "24.000"), upcoming_window(d, "C-09", 1, "24.000")
    url = "/api/channels/C-09/capacity"
    with screen(browser, app_url, "bea", "/channels/C-09/capacity") as page:
        c1 = page.get_by_role("textbox", name=f"Cap for {w1['label']} (ML/day)")
        expect(c1).to_be_visible(timeout=UI_WAIT_MS)
        base = d.j("GET", url)["revision"]
        fill(c1, TYPED)
        d.j("PUT", url, {"base_revision": base, "cells": [{"window_id": w1["id"], "cap_ml_day": OTHER_CAP}]})
        click(page.get_by_role("button", name="Save table"))
        dialog = page.get_by_role("alertdialog", name="Capacity table conflict")
        expect(dialog).to_be_visible(timeout=UI_WAIT_MS)
        expect(dialog).to_contain_text("Another dispatcher saved first. Each cap settled to the lower value.")
        for s in ("Your numbers", "Settled caps", OTHER_CAP, TYPED):
            expect(dialog).to_contain_text(s)
        d.j("PUT", url, {"base_revision": d.j("GET", url)["revision"], "cells": [{"window_id": w2["id"], "cap_ml_day": "60.000"}]})
        advance(page, LIVE_MS + STEP_MS)
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text(OTHER_CAP)
        expect(dialog).to_contain_text(TYPED)
        assert dialog.evaluate("e => e.contains(document.activeElement)")
        click(dialog.get_by_role("button", name="Keep settled caps"))
        expect(c1).to_have_value(OTHER_CAP)
        expect(page.get_by_text(f"You typed {q3(TYPED)}")).to_be_visible()
        expect(page.get_by_role("button", name="Save table")).to_be_focused()
    assert window(d, w1["id"])["table_cap_ml_day"] == OTHER_CAP


@pytest.mark.parametrize("size", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_capacity_table_layout(browser, app_url, size):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    vw, vh = VIEWPORTS[size]
    with screen(browser, app_url, "hal", "/channels/C-09/capacity", size) as page:
        table = page.get_by_role("table", name=f"Capacity table {CHANNEL_NAME['C-09']}")
        revs = page.get_by_role("list", name="Revisions")
        expect(table).to_be_visible(timeout=UI_WAIT_MS)
        layout(page)
        t, r = table.bounding_box(), revs.bounding_box()
        if size == "1280":
            assert r["x"] >= t["x"] + t["width"] - 1
            assert r["y"] < t["y"] + t["height"]
            expect(revs).to_be_visible()
            expect(page.get_by_role("button", name="Save table")).to_be_visible()
        else:
            assert r["y"] >= t["y"] + t["height"] - 1
        cap = page.get_by_role("textbox", name=f"Cap for {w['label']} (ML/day)")
        if size == "375":
            cb = cap.bounding_box()
            assert cb["height"] >= TAP_PX - 0.5 and cb["width"] >= t["width"] * 0.8
        base = d.j("GET", "/api/channels/C-09/capacity")["revision"]
        d.j("PUT", "/api/channels/C-09/capacity", {"base_revision": base, "cells": [{"window_id": w["id"], "cap_ml_day": "20.000"}]})
        fill(cap, "22")
        click(page.get_by_role("button", name="Save table"))
        dialog = page.get_by_role("alertdialog", name="Capacity table conflict")
        expect(dialog).to_be_visible(timeout=UI_WAIT_MS)
        advance(page, DWELL_MS)
        b = dialog.bounding_box()
        layout(page)
        if size == "375":
            assert b["width"] >= vw - 1 and b["height"] >= vh - 1
        else:
            assert b["width"] <= DIALOG_MAX_W and abs(b["x"] - (vw - b["x"] - b["width"])) <= 2


@pytest.mark.parametrize("size", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_board_layout(browser, app_url, size):
    d = Api(app_url, "hal")
    w = quiet_window(d, "C-09", 1, "24.000")
    vw = VIEWPORTS[size][0]
    with screen(browser, app_url, "hal", "/board", size) as page:
        grid = page.get_by_role("grid", name="Window grid")
        expect(grid).to_be_visible(timeout=UI_WAIT_MS)
        layout(page)
        cells = grid.get_by_role("button")

        def per_row():
            boxes = [cells.nth(i).bounding_box() for i in range(min(cells.count(), 5))]
            return len([b for b in boxes if abs(b["y"] - boxes[0]["y"]) < 1])

        assert per_row() == {"1280": 4, "768": 2, "375": 1}[size]
        toggle = page.get_by_role("button", name="Channels", exact=True)
        if size == "1280":
            rail = page.get_by_role("region", name="Channel rail")
            expect(rail).to_be_visible()
            g = grid.bounding_box()
            assert abs(rail.bounding_box()["y"] - g["y"]) <= 2 and rail.bounding_box()["x"] < g["x"]
            click(toggle)
            advance(page, DWELL_MS)
            expect(toggle).to_have_attribute("aria-expanded", "false")
            assert per_row() == 4 and grid.bounding_box()["width"] > g["width"]
        elif size == "768":
            expect(toggle).to_have_attribute("aria-expanded", "false")
        click(page.get_by_role("button", name=f"Channel 9, {w['label']}, {w['remaining_ml']} ML remaining").first)
        if size == "1280":
            detail = page.get_by_role("region", name="Window detail")
            expect(detail).to_be_visible(timeout=UI_WAIT_MS)
            g, b = grid.bounding_box(), detail.bounding_box()
            assert b["x"] >= g["x"] + g["width"] - 1 and abs(b["y"] - g["y"]) <= 2
        else:
            detail = page.get_by_role("dialog", name="Window detail")
            expect(detail).to_be_visible(timeout=UI_WAIT_MS)
            advance(page, DWELL_MS)
            b = detail.bounding_box()
            if size == "375":
                assert b["width"] >= vw - 1
            else:
                assert b["x"] + b["width"] >= vw - 1
        layout(page)


def test_collapsed_means_unavailable(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    cleanup.append((app_url, ok(place(Api(app_url, "mara"), "T9-02", w["id"], TINY), 201)["order"]["number"]))
    w = window(d, w["id"])
    for size in VIEWPORT_IDS:
        with screen(browser, app_url, "hal", "/board?channels=C-09", size) as page:
            expect(page.get_by_role("grid", name="Window grid")).to_be_visible(timeout=UI_WAIT_MS)
            toggle = page.get_by_role("button", name="Channels", exact=True)
            if size == "1280":
                expect(page.get_by_role("checkbox", name="Channel 9")).to_be_visible()
                click(toggle)
                advance(page, DWELL_MS)
            expect(page.get_by_role("checkbox", name="Channel 9")).to_have_count(0, timeout=UI_WAIT_MS)
            layout(page)
            assert not set(tab_order(page, TAB_PRESSES // 2)) & set(CHANNEL_NAME.values()), size
            if size != "1280":
                click(toggle)
                panel = page.get_by_role("dialog", name="Channels", exact=True) if size == "375" else page.get_by_role("region", name="Channel rail")
                expect(panel.get_by_role("checkbox", name="Channel 9")).to_be_visible(timeout=UI_WAIT_MS)
                if size == "375":
                    click(panel.get_by_role("button", name="Close channels"))
                else:
                    click(toggle)
                advance(page, DWELL_MS)
                expect(page.get_by_role("checkbox", name="Channel 9")).to_have_count(0, timeout=UI_WAIT_MS)
            click(page.get_by_role("button", name=f"Channel 9, {w['label']}, {w['remaining_ml']} ML remaining"))
            detail = page.get_by_role("region" if size == "1280" else "dialog", name="Window detail")
            expect(detail).to_be_visible(timeout=UI_WAIT_MS)
            gates = detail.get_by_role("button", name="Gate cards")
            expect(gates).to_have_attribute("aria-expanded", "false")
            expect(page.get_by_role("button", name=REMOVE_MARA_C09)).to_have_count(0)
            gates.focus()
            assert REMOVE_MARA_C09 not in tab_order(page, TAB_PRESSES // 2), size
            click(gates)
            expect(page.get_by_role("button", name=REMOVE_MARA_C09)).to_be_visible(timeout=UI_WAIT_MS)
            if size != "1280":
                click(detail.get_by_role("button", name="Close window detail"))
                advance(page, DWELL_MS)
                expect(page.get_by_role("group", name="Remaining ML")).to_have_count(0, timeout=UI_WAIT_MS)
                assert "Gate cards" not in tab_order(page, TAB_PRESSES // 2), size


def test_board_state_in_address(browser, app_url):
    d = Api(app_url, "hal")
    w = quiet_window(d, "C-09", 1, "24.000")
    with screen(browser, app_url, "hal", "/board") as page:
        expect(page.get_by_text("Select a window")).to_be_visible(timeout=UI_WAIT_MS)
        click(page.get_by_role("checkbox", name="Lateral 4"))
        page.wait_for_url(lambda u: "channels=" in u, timeout=UI_WAIT_MS)
        chans = parse_qs(urlparse(page.url).query)["channels"][0].split(",")
        assert "C-L4" not in chans and "C-09" in chans
        click(page.get_by_role("button", name=f"Channel 9, {w['label']}, {w['remaining_ml']} ML remaining"))
        page.wait_for_url(lambda u: f"window={w['id']}" in u, timeout=UI_WAIT_MS)
        click(page.get_by_role("tab", name="Orders"))
        page.wait_for_url(lambda u: "tab=orders" in u, timeout=UI_WAIT_MS)
        page.go_back()
        expect(page.get_by_role("tab", name="Capacity")).to_have_attribute("aria-selected", "true", timeout=UI_WAIT_MS)
        page.go_back()
        expect(page.get_by_text("Select a window")).to_be_visible(timeout=UI_WAIT_MS)
        page.go_back()
        expect(page.get_by_role("checkbox", name="Lateral 4")).to_be_checked(timeout=UI_WAIT_MS)
        page.go_forward()
        page.go_forward()
        page.go_forward()
        expect(page.get_by_role("tab", name="Orders")).to_have_attribute("aria-selected", "true", timeout=UI_WAIT_MS)
        link = page.url
        page.reload()
        expect(page.get_by_role("tab", name="Orders")).to_have_attribute("aria-selected", "true", timeout=UI_WAIT_MS)
        expect(page.get_by_role("checkbox", name="Lateral 4")).not_to_be_checked()
    with screen(browser, app_url, "hal", urlparse(link).path + "?" + urlparse(link).query, "768") as page:
        expect(page.get_by_role("dialog", name="Window detail")).to_be_visible(timeout=UI_WAIT_MS)
        expect(page.get_by_role("tab", name="Orders")).to_have_attribute("aria-selected", "true")


SEARCH_ROLES = {"grower": "mara", "dispatcher": "hal", "clerk": "priya", "reviewer": "quinn", "operator": "rory"}


@pytest.mark.parametrize("role", list(SEARCH_ROLES), ids=list(SEARCH_ROLES))
def test_live_search(browser, app_url, role):
    who = SEARCH_ROLES[role]
    api, d = Api(app_url, who), Api(app_url, "hal")

    def s(q):
        return api.j("GET", "/api/search", params={"q": q})["suggestions"]

    field_err(api.get("/api/search", params={"q": "L"}), "q")
    order = ["channel", "turnout", "grower", "operator"]
    for q in ("Lateral 4", "T4-09", "T4-15", "Mara Ellison", "OP-D-01", "an"):
        got = s(q)
        assert len(got) <= 8 and [order.index(x["kind"]) for x in got] == sorted(order.index(x["kind"]) for x in got)
    first = next(x for x in windows_of(d, "C-L4")[1] if x["status"] != "closed")
    chan = next(x for x in s("Lateral 4") if x["kind"] == "channel")
    detail = f"{first['remaining_ml']} ML left, {first['label']}"
    if first["restriction_cap_ml_day"]:
        detail += f", restricted to {first['restriction_cap_ml_day']} ML/day"
    href = {"grower": f"/grower/orders/new?window={first['id']}", "dispatcher": f"/board?channels=C-L4&window={first['id']}",
            "clerk": "/channels/C-L4/capacity", "reviewer": "/channels/C-L4/capacity", "operator": "/field"}[role]
    assert (chan["label"], chan["detail"], chan["href"]) == ("Lateral 4", detail, href)

    def kinds(q):
        return {x["kind"] for x in s(q)}

    if role == "grower":
        assert [(x["label"], x["detail"], x["href"]) for x in s("T4-09") if x["kind"] == "turnout"] == [("T4-09", "Lateral 4, Mara Ellison", "/grower")]
        assert "turnout" not in kinds("T4-15") and "grower" not in kinds("Mara Ellison")
        assert [(x["label"], x["detail"], x["href"]) for x in s("OP-D-01")] == [("Rory Kemp (OP-D-01)", "District operator", "/grower/orders/new")]
    elif role in ("dispatcher", "clerk"):
        t = next(x for x in s("T4-15") if x["kind"] == "turnout")
        assert (t["detail"], t["href"]) == ("Lateral 4, Lin Barrow",
                                            "/board?channels=C-L4" if role == "dispatcher" else "/channels/C-L4/capacity")
        g = next(x for x in s("Mara Ellison") if x["kind"] == "grower")
        assert (g["detail"], g["href"]) == ("T4-07, T4-09, T9-02, T12-04",
                                            "/board?channels=C-L4,C-09,C-12" if role == "dispatcher" else "/channels/C-L4/capacity")
        op = next(x for x in s("OP-D-01") if x["kind"] == "operator")
        assert (op["label"], op["detail"], op["href"]) == ("Rory Kemp (OP-D-01)", "District operator",
                                                          "/board" if role == "dispatcher" else "/packs")
    else:
        assert kinds("T4-15") <= {"channel"} and kinds("OP-D-01") <= {"channel"} and kinds("Mara Ellison") <= {"channel"}
    home = {"grower": "/grower", "dispatcher": "/board", "clerk": "/packs", "reviewer": "/review", "operator": "/field"}[role]
    with screen(browser, app_url, who, home) as page:
        box = page.get_by_role("combobox", name="Search turnouts, growers and operators")
        fill(box, "Chan")
        advance(page, STEP_MS)
        options = page.get_by_role("listbox", name="Suggestions").get_by_role("option")
        expect(options.filter(has_text="Channel 12 Spur")).to_have_count(1, timeout=UI_WAIT_MS)
        fill(box, "Channel 9")
        advance(page, STEP_MS)
        expect(options.filter(has_text="Channel 12 Spur")).to_have_count(0, timeout=UI_WAIT_MS)
        target = next(x for x in s("Channel 9") if x["kind"] == "channel")["href"]
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        page.wait_for_url(lambda u: urlparse(u).path == urlparse(target).path, timeout=UI_WAIT_MS)


def pack_period(d):
    w = past_window(d, "C-12")
    return w, local_date(w["opens_at"])


def preview(c, frm, to, sig) -> bytes:
    r = c.get("/api/packs/preview", params={"from": frm, "to": to, "signatory": sig})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain"), r.text[:300]
    return r.content


def submit(c, frm, to, sig, doc: bytes):
    return c.post("/api/packs", {"from": frm, "to": to, "signatory": sig, "document": doc.decode("utf-8")})


def signatory() -> str:
    return unique("Signer")[0][:60]


def test_pack_preview_and_signed_submission(app_url):
    d, c = Api(app_url, "hal"), Api(app_url, "priya")
    w, day = pack_period(d)
    sig = signatory()
    doc = preview(c, day, day, sig)
    lines = doc.decode().split("\n")
    assert lines[0] == f"Wirrinbah Water Trust delivery pack {day} to {day}" and doc.endswith(b"\n")
    assert lines[-2] == f"Signed by {sig} for Wirrinbah Water Trust"
    assert (f"WINDOW {w['id']} Channel 12 Spur | {w['label']} | cap {w['effective_cap_ml_day']} ML/day | volume "
            f"{w['cap_volume_ml']} ML | committed {w['committed_ml']} ML | delivered {w['delivered_ml']} ML") in lines
    altered = doc.replace(b"Signed by", b"Signed  by")
    err(submit(c, day, day, sig, altered), 409, "pack_stale")
    p = ok(submit(c, day, day, sig, doc), 202)["pack"]
    assert re.fullmatch(r"WP-\d{4}", p["number"]) and p["id"] == p["number"]
    assert (p["from"], p["to"], p["signatory"]) == (day, day, sig) and p["state"] in ("building", "stored", "mailed")
    assert len([x for x in c.j("GET", "/api/packs")["packs"] if x["signatory"] == sig]) == 1
    sig2 = signatory()
    old = preview(c, day, day, sig2)
    same_day_window(d, w)
    err(submit(c, day, day, sig2, old), 409, "pack_stale")
    assert not [x for x in c.j("GET", "/api/packs")["packs"] if x["signatory"] == sig2]


def test_stored_and_mailed_together(app_url, mail):
    d, c, r = Api(app_url, "hal"), Api(app_url, "priya"), Api(app_url, "quinn")
    _, day = pack_period(d)
    sig = signatory()
    doc = preview(c, day, day, sig)
    p = ok(submit(c, day, day, sig, doc), 202)["pack"]
    hidden = []

    def mailed():
        x = c.j("GET", f"/api/packs/{p['id']}")["pack"]
        if x["state"] != "mailed":
            hidden.append(r.get(f"/api/packs/{p['id']}").status_code)
            return None
        return x

    done = poll(mailed, PACK_WAIT_S)
    assert all(code == 404 for code in hidden), hidden
    _, s3 = observers("primary")
    assert s3.get(f"packs/{p['number']}.txt") == doc
    digest = hashlib.sha256(doc).hexdigest()
    assert done["sha256"] == digest and done["mailed_at"]
    msgs = await_mail(mail, "returns@regulator.example", f"Ditchbook delivery pack {p['number']}", contains=digest)
    assert len(msgs) == 1
    assert any(x["id"] == p["id"] for x in r.j("GET", "/api/packs")["packs"])


def test_pack_download_byte_for_byte(app_url, mail):
    d, c, r = Api(app_url, "hal"), Api(app_url, "priya"), Api(app_url, "quinn")
    _, day = pack_period(d)
    sig = signatory()
    doc = preview(c, day, day, sig)
    p = ok(submit(c, day, day, sig, doc), 202)["pack"]
    p = poll(lambda: (lambda x: x if x["state"] == "mailed" else None)(c.j("GET", f"/api/packs/{p['id']}")["pack"]), PACK_WAIT_S)
    _, s3 = observers("primary")
    stored = s3.get(f"packs/{p['number']}.txt")
    digest = hashlib.sha256(doc).hexdigest()
    assert stored == doc and p["sha256"] == digest
    for who in (r, c):
        dl = who.get(f"/api/packs/{p['id']}/document")
        assert dl.status_code == 200 and dl.content == doc and dl.headers["content-type"].startswith("text/plain")
        assert f'filename="{p["number"]}.txt"' in dl.headers["content-disposition"] and "attachment" in dl.headers["content-disposition"]
    msgs = await_mail(mail, "returns@regulator.example", f"Ditchbook delivery pack {p['number']}", contains=digest)
    assert len(msgs) == 1
    assert f"Pack {p['number']} for {day} to {day}. SHA-256 {digest}" in text(msgs[0])
    att = msgs[0].get("Attachments") or []
    assert [(a["FileName"], a["Size"]) for a in att] == [(f"{p['number']}.txt", len(doc))]


def test_pack_periods_in_district_dates(app_url):
    d, c = Api(app_url, "hal"), Api(app_url, "priya")
    ws = {k: fixed_window(d, v[0], v[1], v[2]) for k, v in DST_CASES.items()}
    before = fixed_window(d, "C-09", "2026-10-03T13:30:00Z", "2026-10-03T14:30:00Z")
    doc = preview(c, "2027-04-04", "2027-04-04", signatory()).decode()
    pos = [doc.index(f"WINDOW {ws[k]['id']} ") for k in ("dst-ends", "repeated-first", "repeated-second")]
    assert pos == sorted(pos)
    assert f"| {DST_CASES['repeated-first'][3]} |" in doc and f"| {DST_CASES['repeated-second'][3]} |" in doc
    oct_ = preview(c, "2026-10-04", "2026-10-04", signatory()).decode()
    assert f"WINDOW {ws['dst-starts']['id']} " in oct_ and f"WINDOW {before['id']} " not in oct_
    tot = d.j("GET", "/api/totals", params={"from": "2026-10-04", "to": "2026-10-04"})
    ids = {x["window_id"] for ch in tot["channels"] for x in ch["windows"]}
    assert ws["dst-starts"]["id"] in ids and before["id"] not in ids
    tot = d.j("GET", "/api/totals", params={"from": "2027-04-04", "to": "2027-04-04"})
    ids = {x["window_id"] for ch in tot["channels"] for x in ch["windows"]}
    assert {ws[k]["id"] for k in ("dst-ends", "repeated-first", "repeated-second")} <= ids
    field_err(d.get("/api/totals", params={"to": "2027-04-04"}), "from")
    field_err(d.get("/api/totals", params={"from": "2027-04-04"}), "to")
    field_err(d.get("/api/totals", params={"from": "2027-04-04", "to": "2027-04-03"}), "to")
    field_err(c.get("/api/packs/preview", params={"from": "2027-01-01", "to": "2027-04-03", "signatory": "Al"}), "to")
    preview(c, "2027-01-01", "2027-04-02", "Al")
    field_err(c.get("/api/packs/preview", params={"from": "4/4/2027", "to": "2027-04-04", "signatory": "Al"}), "from")
    field_err(c.get("/api/packs/preview", params={"from": "2027-04-04", "to": "2027-04-04", "signatory": "A"}), "signatory")


OUTAGE_PACKS = (("minio-down", "store", "building"), ("mailpit-down", "mail", "stored"))
OUTAGE_COPY = {"minio-down": "The evidence store is not answering. The pack will be stored and mailed when it returns.",
               "mailpit-down": "The mail service is not answering. The pack is stored and will be mailed when it returns."}
OUTAGE_TARGET = {"minio-down": minio_target, "mailpit-down": smtp_target}


def stalled_pack(name, stall, state):
    base = outage_url(name)
    d, c = Api(base, "hal"), Api(base, "priya")
    _, day = pack_period(d)
    sig = signatory()
    doc = preview(c, day, day, sig)
    p = ok(submit(c, day, day, sig, doc), 202)["pack"]
    poll(lambda: (lambda x: x["state"] == state and x["stalled_on"] == stall)(c.j("GET", f"/api/packs/{p['id']}")["pack"]),
         RESUME_S + SLACK_S)
    return base, c, p, day, doc


def test_stalled_pack_shows_outage_copy(browser):
    for name, stall, state in OUTAGE_PACKS:
        base, c, p, _, _ = stalled_pack(name, stall, state)
        r = Api(base, "quinn")
        err(r.get(f"/api/packs/{p['id']}"), 404, "not_found")
        assert not [x for x in r.j("GET", "/api/packs")["packs"] if x["id"] == p["id"]]
        with screen(browser, base, "priya", f"/packs/{p['id']}") as page:
            live(page, lambda: expect(page.get_by_role("status", name="Pack status")).to_have_text(
                OUTAGE_COPY[name], timeout=REAL_WAIT_MS), LIVE_MS * 2)
            expect(page.get_by_text(OUTAGE_COPY[name]).first).to_be_visible()


def test_stalled_work_resumes(mail):
    for name, stall, state in OUTAGE_PACKS:
        base, c, p, _, doc = stalled_pack(name, stall, state)
        _, s3 = observers(name)
        with relay(*OUTAGE_TARGET[name]()):
            done = poll(lambda: (lambda x: x if x["state"] == "mailed" else None)(c.j("GET", f"/api/packs/{p['id']}")["pack"]),
                        RESUME_S + SLACK_S)
        assert s3.get(f"packs/{p['number']}.txt") == doc and done["sha256"] == hashlib.sha256(doc).hexdigest()
        sub = f"Ditchbook delivery pack {p['number']}"
        assert len(await_mail(mail, "returns@regulator.example", sub, contains=done["sha256"])) == 1


def test_withdraw_stalled_pack(mail):
    for name, stall, state in OUTAGE_PACKS:
        base, c, keep, _, _ = stalled_pack(name, stall, state)
        _, _, gone, gone_day, _ = stalled_pack(name, stall, state)
        _, s3 = observers(name)
        assert c.j("DELETE", f"/api/packs/{gone['id']}")["pack"]["state"] == "withdrawn"
        err(c.delete(f"/api/packs/{gone['id']}"), 409, "illegal_transition")
        if name == "mailpit-down":
            poll(lambda: f"packs/{gone['number']}.txt" not in safe_keys(s3, "packs/"), RESUME_S + SLACK_S)
        with relay(*OUTAGE_TARGET[name]()):
            done = poll(lambda: (lambda x: x if x["state"] == "mailed" else None)(c.j("GET", f"/api/packs/{keep['id']}")["pack"]),
                        RESUME_S + SLACK_S)
            await_mail(mail, "returns@regulator.example", f"Ditchbook delivery pack {keep['number']}", contains=done["sha256"])
        assert f"packs/{gone['number']}.txt" not in safe_keys(s3, "packs/")
        assert not [m for m in mail.messages() if f"for {gone_day} to {gone_day}." in text(m)
                    and m.get("Subject") == f"Ditchbook delivery pack {gone['number']}"]
        assert c.j("GET", f"/api/packs/{gone['id']}")["pack"]["state"] == "withdrawn"
        err(c.delete(f"/api/packs/{keep['id']}"), 409, "pack_mailed")


def erasable(app_url, instances=("primary", "mailpit-down")):
    for inst in instances:
        base = app_url if inst == "primary" else outage_url(inst)
        for x in Api(base, "priya").j("GET", "/api/contractors")["contractors"]:
            if not x["erased"]:
                return inst, base, x["code"]
    pytest.fail("every seeded contractor has already been erased")


def test_erase_contractor_api(app_url, cleanup):
    inst, base, code = erasable(app_url)
    name, who, phone = CONTRACTORS[code]
    d, c = Api(base, "hal"), Api(base, "priya")
    _, g, w, o, card, t = stroke_order(base, cleanup, holder=code, standby="OP-D-02")
    ok(Api(base, who).post(f"/api/gate-cards/{card['id']}/stroke"))
    pg, s3 = observers(inst)
    fin = card_of(d, w["id"], o["number"], "finish")
    r = c.j("DELETE", f"/api/contractors/{code}")
    assert r["contractor"] == {"code": code, "name": None, "phone": None, "erased": True} and fin["id"] in r["handed_over"]
    assert card_of(d, w["id"], o["number"], "start", None)["stroke"]["operator_code"] == code
    row = next(x for x in c.j("GET", "/api/contractors")["contractors"] if x["code"] == code)
    assert (row["name"], row["phone"], row["erased"]) == (None, None, True)
    for q in (name, name.split()[0], phone.replace(" ", "")[-6:]):
        assert not [s for s in d.j("GET", "/api/search", params={"q": q})["suggestions"] if s["kind"] == "operator"]
    assert [s["label"] for s in d.j("GET", "/api/search", params={"q": code})["suggestions"] if s["kind"] == "operator"] == [f"Operator {code}"]
    assert card_of(d, w["id"], o["number"], "finish")["holder_code"] == "OP-D-02"
    oo = d.j("GET", f"/api/orders/{o['number']}")["order"]
    assert (oo["holder_code"], oo["standby_code"]) == ("OP-D-02", None)
    assert code in s3.get(f"strokes/{card['id']}.json").decode()
    for table in pg.tables():
        dump = json.dumps(pg.rows(f'SELECT * FROM {table}'))
        for secret in (name, EMAIL[who], phone, phone.replace(" ", "")):
            assert secret not in dump, f"{secret!r} still stored in {table}"
    assert code not in [o["code"] for o in g.j("GET", "/api/operators")["operators"] if o["name"]]
    field_err(place(g, "T9-02", "W-09-A", TINY, code), "operator_code")
    err(c.delete(f"/api/contractors/{code}"), 409, "already_erased")


def test_erasure_ends_access(browser, app_url):
    inst, base, code = erasable(app_url, ("minio-down", "mailpit-down", "primary"))
    _, who, _ = CONTRACTORS[code]
    s1, s2 = Api(base, who), Api(base, who)
    ok(s1.get("/api/me"))
    with screen(browser, base, who, "/field") as page:
        expect(page.get_by_role("button", name="Sign out")).to_be_visible(timeout=UI_WAIT_MS)
        Api(base, "priya").j("DELETE", f"/api/contractors/{code}")
        err(s1.get("/api/me"), 401, "not_signed_in")
        err(s2.get("/api/gate-cards"), 401, "not_signed_in")
        live(page, lambda: expect(page).to_have_url(re.compile(r".*/sign-in(\?.*)?$"), timeout=REAL_WAIT_MS))
    err(Api(base).sign_in(EMAIL[who]), 401, "bad_credentials")


def test_copies_carry_operator_codes_only(app_url, mail, cleanup):
    private = [NAMES[w] for w in ("rory", "tess", "jo", "sam")] + [p for _, _, p in CONTRACTORS.values()]
    d, g, w, o, card, t = stroke_order(app_url, cleanup, holder="OP-D-01", standby="OP-D-02")
    ok(Api(app_url, "rory").post(f"/api/gate-cards/{card['id']}/stroke"))
    _, s3 = observers("primary")
    record = s3.get(f"strokes/{card['id']}.json").decode()
    assert json.loads(record)["operator_code"] == "OP-D-01"
    day = local_date(w["opens_at"])
    doc = preview(Api(app_url, "priya"), day, day, signatory()).decode()
    assert f"| operator {o['holder_code']} |" in doc
    rw = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    cleanup.append((app_url, ok(place(g, "T9-02", rw["id"], TINY, "OP-D-02"), 201)["order"]["number"]))
    ok(d.post(f"/api/windows/{rw['id']}/restrictions", {"cap_ml_day": "12.000", "reason": REASON}), 201)
    note = text(await_mail(mail, EMAIL["mara"], f"Ditchbook restriction: Channel 9, {rw['label']}")[0])
    assert "OP-D-02" in note
    for secret in private:
        assert secret not in record and secret not in doc and secret not in note, secret


def test_reviewer_is_read_only(browser, app_url):
    q = Api(app_url, "quinn")
    seed, chan, win, pack, contractor, rev = "ORD-00001", "C-L4", "W-L4-A", "WP-0001", "OP-C-07", 1
    writes = [("POST", "/api/orders")] + [("POST", f"/api/orders/{seed}/{a}") for a in ("cancel", "schedule", "close", "reopen")] + [
        ("POST", f"/api/windows/{win}/ration"), ("POST", f"/api/windows/{win}/restrictions"),
        ("POST", f"/api/gate-cards/{JUNK}/stroke"), ("POST", f"/api/gate-cards/{JUNK}/remove-holder"),
        ("PUT", f"/api/channels/{chan}/capacity"), ("POST", f"/api/channels/{chan}/capacity/revisions/{rev}/restore"),
        ("POST", f"/api/channels/{chan}/windows"), ("POST", "/api/packs"), ("DELETE", f"/api/packs/{pack}"),
        ("DELETE", f"/api/contractors/{contractor}")]
    for method, path in writes:
        r = q.put(path, {}) if method == "PUT" else (q.delete(path) if method == "DELETE" else q.post(path, {}))
        err(r, 403, "forbidden")
    for path in (f"/api/channels/{chan}/capacity", "/api/totals", "/api/packs", "/api/windows"):
        ok(q.get(path))
    assert all(p["state"] == "mailed" for p in q.j("GET", "/api/packs")["packs"])
    table_name = f"Capacity table {CHANNEL_NAME[chan]}"
    with screen(browser, app_url, "quinn", f"/channels/{chan}/capacity") as page:
        expect(page.get_by_role("table", name=table_name)).to_be_visible(timeout=UI_WAIT_MS)
        expect(page.get_by_role("button", name="Save table")).to_have_count(0)
        expect(page.get_by_role("button", name=re.compile(r"^Restore revision "))).to_have_count(0)
        boxes = page.get_by_role("table", name=table_name).get_by_role("textbox")
        for i in range(boxes.count()):
            expect(boxes.nth(i)).not_to_be_editable()


def test_totals_agree_everywhere(app_url, cleanup):
    d, mara = Api(app_url, "hal"), Api(app_url, "mara")
    w = upcoming_window(d, "C-09", 1, "24.000")

    def agree(wid):
        rec = window(d, wid)
        day = local_date(rec["opens_at"])
        tw = next(x for ch in d.j("GET", "/api/totals", params={"from": day, "to": day})["channels"]
                  for x in ch["windows"] if x["window_id"] == wid)
        for k in ("cap_volume_ml", "committed_ml", "delivered_ml", "remaining_ml"):
            assert tw[k] == rec[k], k
        allt = next(x for ch in d.j("GET", "/api/totals")["channels"] for x in ch["windows"] if x["window_id"] == wid)
        assert allt == tw
        assert D(rec["remaining_ml"]) == D(rec["cap_volume_ml"]) - D(rec["committed_ml"])
        a = mara.j("GET", "/api/me/allocation")
        assert D(a["remaining_ml"]) == D(a["allocation_ml"]) - D(a["debited_ml"])
        return rec

    clear_turnout(app_url, "mara", "T9-02")
    o = ok(place(mara, "T9-02", w["id"], HALF), 201)["order"]
    cleanup.append((app_url, o["number"]))
    assert agree(w["id"])["committed_ml"] == HALF
    q = mara.j("GET", "/api/orders/quote", params={"window": w["id"], "volume_ml": TINY})["window"]
    assert q["remaining_ml"] == q3(D(q["cap_volume_ml"]) - D(HALF))
    ok(mara.post(f"/api/orders/{o['number']}/cancel"))
    assert agree(w["id"])["committed_ml"] == "0.000"
    url = "/api/channels/C-09/capacity"
    rev = d.j("GET", url)["revision"]
    d.j("PUT", url, {"base_revision": rev, "cells": [{"window_id": w["id"], "cap_ml_day": "20.000"}]})
    assert agree(w["id"])["cap_volume_ml"] == q3(D("20") / 24)
    d.j("POST", f"{url}/revisions/{rev}/restore", status=201)
    assert agree(w["id"])["cap_volume_ml"] == "1.000"
    ok(d.post(f"/api/windows/{w['id']}/restrictions", {"cap_ml_day": "12.000", "reason": REASON}), 201)
    assert agree(w["id"])["cap_volume_ml"] == q3(D("12.000") / 24)
    p = requested_pair(app_url, cleanup)
    agree(p.w["id"])
    ok(p.d.post(f"/api/windows/{p.w['id']}/ration"))
    assert agree(p.w["id"])["remaining_ml"] == "0.000"
    _, _, ws, so, sc, _ = stroke_order(app_url, cleanup)
    rory = Api(app_url, "rory")
    ok(rory.post(f"/api/gate-cards/{sc['id']}/stroke"))
    agree(ws["id"])
    ok(rory.post(f"/api/gate-cards/{card_of(d, ws['id'], so['number'], 'finish')['id']}/stroke"))
    agree(ws["id"])


RATION_CASES = {"published-example": ("10.001", None, True), "zero-share": ("0.001", None, False),
                "allocation-capped": ("1.001", "1.000", False)}


@pytest.mark.parametrize("case", list(RATION_CASES), ids=list(RATION_CASES))
def test_proportional_ration(app_url, cleanup, case):
    remaining, b_left, big = RATION_CASES[case]
    p = requested_pair(app_url, cleanup, remaining, "C-L4" if b_left else None, big)
    if b_left:
        sw = stroke_window(p.d)
        clear_turnout(app_url, "lin", "T12-03")
        fill_ml = q3(alloc(p.gb) - D(b_left))
        cleanup.append((app_url, ok(place(p.gb, "T12-03", sw["id"], fill_ml), 201)["order"]["number"]))
        assert alloc(p.gb) == D(b_left)
    R = D(p.w["remaining_ml"])
    demands = [max(D(0), min(D(p.asked[0]), D(turnout_max(p.ta, p.hours)), alloc(p.ga))),
               max(D(0), min(D(p.asked[1]), D(turnout_max(p.tb, p.hours)), alloc(p.gb)))]
    want = ration_shares(demands, R)
    if case == "published-example":
        assert want == [D("6.001"), D("4.000")]
    r = p.d.j("POST", f"/api/windows/{p.w['id']}/ration")
    got = {x["order_number"]: (x["requested_ml"], x["volume_ml"]) for x in r["rationed"]}
    pairs = ((p.a["number"], p.asked[0], want[0]), (p.b["number"], p.asked[1], want[1]))
    assert got == {n: (req, q3(s)) for n, req, s in pairs if s > 0}
    assert r["left_requested"] == [n for n, _, s in pairs if s == 0]
    assert sum(want) == R and r["window"]["remaining_ml"] == "0.000"
    for n, _, s in pairs:
        o = p.d.j("GET", f"/api/orders/{n}")["order"]
        if s > 0:
            assert (o["status"], o["volume_ml"], o["rate_ml_day"], o["rationed"], o["conflict"]) == \
                ("scheduled", q3(s), rate_of(s, p.hours), True, None)
            assert card_of(p.d, p.w["id"], n, "start")["state"] == "open"
        else:
            assert o["status"] == "requested" and o["volume_ml"] == o["requested_ml"]
    if case == "published-example":
        err(p.d.post(f"/api/windows/{p.w['id']}/ration"), 409, "nothing_to_ration")
    past = past_window(p.d, "C-L4")
    err(p.d.post(f"/api/windows/{past['id']}/ration"), 409, "window_closed")


def test_ration_notices(app_url, mail, cleanup):
    p = requested_pair(app_url, cleanup, "0.001")
    r = p.d.j("POST", f"/api/windows/{p.w['id']}/ration")
    shares = {x["order_number"]: x["volume_ml"] for x in r["rationed"]}
    assert len(shares) == 1 and len(r["left_requested"]) == 1
    subject = f"Ditchbook ration: {CHANNEL_NAME[p.ch]}, {p.w['label']}"
    for who, order, req, op in ((p.who_a, p.a, p.asked[0], "OP-D-01"), (p.who_b, p.b, p.asked[1], "OP-D-02")):
        n = order["number"]
        msgs = await_mail(mail, EMAIL[who], subject)
        assert len(msgs) == 1
        line = (f"Order {n} rationed to {shares[n]} ML of {req} ML at {rate_of(shares[n], p.hours)} ML/day. Gate worked by {op}."
                if n in shares else f"Order {n} stays requested. No capacity was left for it. Gate worked by {op}.")
        assert line in text(msgs[0]) and NAMES[CODE_WHO[op]] not in text(msgs[0])


RACE_HOURS, RACE_CAP = 2, "60.000"
RACE_C, RACE_A, RACE_B, RACE_LEFT = "1.000", "2.000", "1.500", "1.500"


def test_ration_races_placements(app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-L4", RACE_HOURS, RACE_CAP)
    wid = w["id"]
    for who, t in (("dev", "T4-11"), ("mara", "T4-09"), ("lin", "T4-15")):
        clear_turnout(app_url, who, t)
    dev, mara, lin = Api(app_url, "dev"), Api(app_url, "mara"), Api(app_url, "lin")
    c = ok(place(dev, "T4-11", wid, RACE_C, "OP-D-01"), 201)["order"]
    a = ok(place(mara, "T4-09", wid, RACE_A, "OP-D-01"), 201)["order"]
    b = ok(place(lin, "T4-15", wid, RACE_B, "OP-D-02"), 201)["order"]
    cleanup += [(app_url, c["number"]), (app_url, a["number"]), (app_url, b["number"])]
    r = ok(d.post(f"/api/windows/{wid}/restrictions", {"cap_ml_day": cap_for(RACE_LEFT, RACE_HOURS), "reason": REASON}), 201)
    assert sorted(r["moved_orders"]) == sorted([a["number"], b["number"]])
    ok(dev.post(f"/api/orders/{c['number']}/cancel"))
    assert window(d, wid)["remaining_ml"] == RACE_LEFT
    assert D(RACE_B) <= D(RACE_LEFT) and D(RACE_C) <= D(RACE_LEFT) < D(RACE_B) + D(RACE_C)
    for t, v in (("T4-11", RACE_C), ("T4-15", RACE_B)):
        assert D(v) <= D(turnout_max(t, RACE_HOURS))
    growers = ((dev, c["grower_id"]), (mara, a["grower_id"]), (lin, b["grower_id"]))
    before = {gid: alloc(g) for g, gid in growers}
    assert before[b["grower_id"]] >= D(RACE_B) and before[c["grower_id"]] >= D(RACE_C)
    hal1, hal2, dev2 = Api(app_url, "hal"), Api(app_url, "hal"), Api(app_url, "dev")
    out = together(lambda: hal1.post(f"/api/windows/{wid}/ration"),
                   lambda: place(dev2, "T4-11", wid, RACE_C, "OP-D-01"),
                   lambda: hal2.post(f"/api/orders/{b['number']}/schedule"))
    assert out[0].status_code in (200, 409) and out[1].status_code in (201, 409, 422) and out[2].status_code in (200, 409)
    for res in out:
        if res.status_code >= 400:
            assert res.status_code == 422 or res.json().get("error") in ("window_full", "nothing_to_ration", "turnout_busy",
                                                                           "illegal_transition", "allocation_exceeded")
    if out[1].status_code == 201:
        cleanup.append((app_url, out[1].json()["order"]["number"]))
    ww = window(d, wid)
    assert D(ww["committed_ml"]) <= D(ww["cap_volume_ml"])
    counted = [o for o in d.j("GET", "/api/orders", params={"window": wid})["orders"] if o["status"] == "scheduled"]
    assert sum(D(o["volume_ml"]) for o in counted) == D(ww["committed_ml"])
    for g, gid in growers:
        assert before[gid] - alloc(g) == sum(D(o["volume_ml"]) for o in counted if o["grower_id"] == gid)


def test_ration_dialog_survives_timers(browser, app_url, cleanup):
    p = requested_pair(app_url, cleanup)
    with screen(browser, app_url, "hal", f"/board?channels={p.ch}&window={p.w['id']}&tab=orders") as page:
        btn = page.get_by_role("button", name="Ration window")
        dialog = page.get_by_role("alertdialog", name=f"Ration {p.w['label']}")
        expect(btn).to_be_visible(timeout=UI_WAIT_MS)
        click(btn)
        expect(dialog).to_contain_text(
            f"Share {p.w['remaining_ml']} ML among {len(ASKED)} requested orders in proportion to what each asked for.",
            timeout=UI_WAIT_MS)
        ration = dialog.get_by_role("button", name="Ration", exact=True)
        expect(ration).to_be_focused()
        page.keyboard.press("Escape")
        click(btn)
        advance(page, DWELL_MS)
        expect(dialog).to_be_visible()
        expect(ration).to_be_focused()
        advance(page, DWELL_MS * 2)
        expect(dialog).to_be_visible()
        ok(p.gb.post(f"/api/orders/{p.b['number']}/cancel"))
        live(page, lambda: expect(dialog).to_contain_text(f"Share {p.w['remaining_ml']} ML among {len(ASKED) - 1} requested orders",
                                                          timeout=REAL_WAIT_MS))
        expect(ration).to_be_focused()
        status = page.get_by_role("status", name="Board status")
        with hold(page, f"**/api/windows/{p.w['id']}/ration") as gate:
            click(ration)
            expect(btn).to_have_attribute("aria-disabled", "true", timeout=UI_WAIT_MS)
            expect(status).to_have_text("Rationing.")
            advance(page, LIVE_MS + STEP_MS)
            expect(btn).to_have_attribute("aria-disabled", "true")
            gate.release()
        left = 0
        done = f"Window rationed. {len(ASKED) - 1} orders scheduled, {left} left requested."
        expect(status).to_have_text(done, timeout=UI_WAIT_MS)
        advance(page, LIVE_MS + STEP_MS)
        expect(status).to_have_text(done)
    assert p.d.j("GET", f"/api/orders/{p.a['number']}")["order"]["volume_ml"] == p.w["remaining_ml"]


def test_grower_order_views_follow_server(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    o = ok(place(Api(app_url, "mara"), "T9-02", w["id"], TINY), 201)["order"]
    cleanup.append((app_url, o["number"]))
    with contextlib.ExitStack() as st:
        op = st.enter_context(screen(browser, app_url, "mara", f"/orders/{o['number']}"))
        op.clock.set_system_time(server_now(d) + timedelta(hours=9))
        hp = st.enter_context(screen(browser, app_url, "mara", "/grower"))
        expect(op.get_by_role("button", name="Cancel order")).to_be_visible(timeout=UI_WAIT_MS)
        row = hp.get_by_role("table", name="Your orders").get_by_role("row").filter(has_text=o["number"])
        expect(row).to_contain_text("Scheduled", timeout=UI_WAIT_MS)
        ok(d.post(f"/api/orders/{o['number']}/close"))
        live(op, lambda: (expect(op.get_by_role("group", name="Order state")).to_contain_text("Closed", timeout=REAL_WAIT_MS),
                          expect(op.get_by_role("status", name="Order status")).to_have_text(
                              f"Order {o['number']} is now Closed.", timeout=REAL_WAIT_MS)))
        expect(op.get_by_role("button", name="Cancel order")).to_have_count(0)
        live(hp, lambda: (expect(row).to_contain_text("Closed", timeout=REAL_WAIT_MS),
                          expect(hp.get_by_role("status", name="Order status")).to_have_text(
                              f"Order {o['number']} is now Closed.", timeout=REAL_WAIT_MS)))


def ensure_mailed_pack(app_url):
    c = Api(app_url, "priya")
    if any(p["state"] == "mailed" for p in c.j("GET", "/api/packs")["packs"]):
        return
    _, day = pack_period(Api(app_url, "hal"))
    sig = signatory()
    p = ok(submit(c, day, day, sig, preview(c, day, day, sig)), 202)["pack"]
    poll(lambda: c.j("GET", f"/api/packs/{p['id']}")["pack"]["state"] == "mailed", PACK_WAIT_S)


@pytest.mark.parametrize("size", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_review_page_layout(browser, app_url, size):
    ensure_mailed_pack(app_url)
    with screen(browser, app_url, "quinn", "/review", size) as page:
        table = page.get_by_role("table", name="Channel totals")
        packs = page.get_by_role("list", name="Mailed packs")
        form = page.get_by_role("form", name="Review period")
        expect(table).to_be_visible(timeout=UI_WAIT_MS)
        expect(packs).to_be_visible()
        layout(page)
        for f in ("From", "To"):
            assert form.get_by_role("textbox", name=f).bounding_box()["height"] >= TAP_PX - 0.5
        t, p, fb = table.bounding_box(), packs.bounding_box(), form.bounding_box()
        assert fb["y"] + fb["height"] <= t["y"] + 1
        if size == "1280":
            assert p["x"] >= t["x"] + t["width"] - 1
            assert p["y"] < t["y"] + t["height"]
            expect(packs.get_by_role("link", name=re.compile(r"^Download ")).first).to_be_visible()
        else:
            assert p["y"] >= t["y"] + t["height"] - 1
        rows = table.get_by_role("row")
        assert rows.count() > 1 and table.get_by_role("cell").count() > 0
        if size == "375":
            r1 = rows.nth(1).bounding_box()
            cells = rows.nth(1).get_by_role("cell")
            ys = [cells.nth(i).bounding_box()["y"] for i in range(cells.count())]
            assert ys == sorted(ys) and ys[-1] > ys[0] and r1["width"] <= VIEWPORTS["375"][0]


def test_wf_grower_order_happy(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-L4", 2, "60.000")
    clear_turnout(app_url, "lin", "T4-15")
    lin = Api(app_url, "lin")
    r = alloc(lin)
    with screen(browser, app_url, "lin", "/grower") as page:
        page.clock.set_system_time(ts(w["opens_at"]) + timedelta(hours=3))
        counter = page.get_by_role("region", name="Allocation")
        expect(counter).to_contain_text(f"{q3(r)} ML of {ALLOCATION['lin']} ML left", timeout=UI_WAIT_MS)
        page.goto(app_url + "/grower/orders/new")
        form = page.get_by_role("form", name="New order")
        select(form.get_by_role("combobox", name="Turnout", exact=True), "T4-15")
        select(form.get_by_role("combobox", name="Delivery window"), f"Lateral 4, {w['label']}")
        expect(page.get_by_role("status", name="Window status")).to_contain_text("Not yet open", timeout=UI_WAIT_MS)
        fill(form.get_by_role("textbox", name="Volume (ML)"), "2")
        select(form.get_by_role("combobox", name="Gate worked by"), TESS_OPTION)
        advance(page, QUOTE_MS + FRAME_MS)
        expect(form.get_by_role("group", name="Flow rate")).to_contain_text(f"{rate_of('2', 2)} ML/day", timeout=UI_WAIT_MS)
        click(form.get_by_role("button", name="Place order"))
        page.wait_for_url(re.compile(r".*/orders/ORD-\d{5}$"), timeout=UI_WAIT_MS)
        number = urlparse(page.url).path.rsplit("/", 1)[1]
        cleanup.append((app_url, number))
        expect(page.get_by_role("status", name="Order status")).to_have_text(f"Order {number} scheduled.", timeout=UI_WAIT_MS)
        page.reload()
        expect(page.get_by_role("heading", name=f"Order {number}")).to_be_visible(timeout=UI_WAIT_MS)
        expect(page.get_by_role("group", name="Order state")).to_contain_text("Scheduled")
    o = lin.j("GET", f"/api/orders/{number}")["order"]
    assert (o["status"], o["volume_ml"], o["holder_code"], o["window_id"]) == ("scheduled", "2.000", "OP-D-02", w["id"])
    assert alloc(lin) == r - 2


def test_wf_grower_order_session_ended(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-L4", 4, "60.000")
    clear_turnout(app_url, "lin", "T4-15")
    path = f"/grower/orders/new?window={w['id']}"
    with screen(browser, app_url, "lin", path) as page:
        form = page.get_by_role("form", name="New order")
        select(form.get_by_role("combobox", name="Turnout", exact=True), "T4-15")
        fill(form.get_by_role("textbox", name="Volume (ML)"), DRAFT_ML)
        select(form.get_by_role("combobox", name="Gate worked by"), "Rory Kemp (OP-D-01)")
        select(form.get_by_role("combobox", name="Standby operator"), TESS_OPTION)
        advance(page, QUOTE_MS + FRAME_MS)
        page.context.clear_cookies()
        posts = watch(page, "/api/orders", "POST")
        click(form.get_by_role("button", name="Place order"))
        page.wait_for_url(app_url + "/sign-in?return=" + quote(path, safe=""), timeout=UI_WAIT_MS)
        sign_in(page, "mara")
        page.wait_for_url(lambda u: urlparse(u).path == "/grower/orders/new", timeout=UI_WAIT_MS)
        expect(page.get_by_role("form", name="New order").get_by_role("textbox", name="Volume (ML)")).to_have_value("", timeout=UI_WAIT_MS)
        page.context.clear_cookies()
        page.goto(app_url + "/sign-in?return=" + quote(path, safe=""))
        expect(page.get_by_role("form", name="Sign in")).to_be_visible(timeout=UI_WAIT_MS)
        sign_in(page, "lin")
        page.wait_for_url(lambda u: urlparse(u).path == "/grower/orders/new", timeout=UI_WAIT_MS)
        expect(page.get_by_role("status", name="Order status")).to_have_text(
            "Your session ended. Your order is as you left it. Check it and place it again.", timeout=UI_WAIT_MS)
        form = page.get_by_role("form", name="New order")
        expect(form.get_by_role("textbox", name="Volume (ML)")).to_have_value(DRAFT_ML)
        assert chosen_text(form.get_by_role("combobox", name="Turnout", exact=True)) == "T4-15"
        assert chosen_text(form.get_by_role("combobox", name="Standby operator")) == TESS_OPTION
        assert Api(app_url, "lin").j("GET", "/api/orders", params={"window": w["id"]})["orders"] == []
        advance(page, QUOTE_MS + FRAME_MS)
        click(form.get_by_role("button", name="Place order"))
        page.wait_for_url(re.compile(r".*/orders/ORD-\d{5}$"), timeout=UI_WAIT_MS)
    [o] = Api(app_url, "lin").j("GET", "/api/orders", params={"window": w["id"]})["orders"]
    cleanup.append((app_url, o["number"]))
    assert (o["turnout"], o["volume_ml"], o["holder_code"], o["standby_code"]) == ("T4-15", q3(DRAFT_ML), "OP-D-01", "OP-D-02")


def test_wf_contested_capacity_race(browser, app_url, mail, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-L4", 1, "24.000")
    for who in ("mara", "lin"):
        clear_turnout(app_url, who, TURNOUTS[who]["C-L4"])
    with contextlib.ExitStack() as st:
        pages = {}
        for who in ("mara", "lin"):
            p = st.enter_context(screen(browser, app_url, who, f"/grower/orders/new?window={w['id']}"))
            f = p.get_by_role("form", name="New order")
            select(f.get_by_role("combobox", name="Turnout", exact=True), TURNOUTS[who]["C-L4"])
            fill(f.get_by_role("textbox", name="Volume (ML)"), "1")
            select(f.get_by_role("combobox", name="Gate worked by"), "Rory Kemp (OP-D-01)")
            advance(p, QUOTE_MS + FRAME_MS)
            pages[who] = (p, f)
        for p, f in pages.values():
            f.get_by_role("button", name="Place order").dispatch_event("click")
        winners = []
        for who, (p, f) in pages.items():
            poll(lambda p=p: "/orders/ORD-" in p.url or p.get_by_role("alertdialog", name="Capacity taken").count(),
                 UI_WAIT_MS / 1000, 0.3)
            if "/orders/ORD-" in p.url:
                winners.append(who)
        assert len(winners) == 1
    orders = d.j("GET", "/api/orders", params={"window": w["id"]})["orders"]
    assert len(orders) == 1
    cleanup.append((app_url, orders[0]["number"]))
    loser = "lin" if winners[0] == "mara" else "mara"
    assert len(await_mail(mail, EMAIL[loser], f"Ditchbook: capacity taken on Lateral 4, {w['label']}")) == 1


def test_wf_contested_capacity_allocation_error(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = stroke_window(d)
    clear_turnout(app_url, "lin", "T12-03")
    lin = Api(app_url, "lin")
    r = alloc(lin)
    assert r + MILLI <= D(turnout_max("T12-03", w["hours"]))
    with screen(browser, app_url, "lin", f"/grower/orders/new?window={w['id']}") as page:
        f = page.get_by_role("form", name="New order")
        select(f.get_by_role("combobox", name="Turnout", exact=True), "T12-03")
        fill(f.get_by_role("textbox", name="Volume (ML)"), q3(r + MILLI))
        select(f.get_by_role("combobox", name="Gate worked by"), "Rory Kemp (OP-D-01)")
        advance(page, QUOTE_MS + FRAME_MS)
        reads = watch(page, "/api/me/allocation")
        click(f.get_by_role("button", name="Place order"))
        expect(f).to_contain_text(f"More than your remaining allocation of {q3(r)} ML.", timeout=UI_WAIT_MS)
        poll(lambda: reads, UI_WAIT_MS / 1000, 0.2)
        expect(page.get_by_role("region", name="Allocation")).to_contain_text(f"{q3(r)} ML of {ALLOCATION['lin']} ML left")
        before = [o["number"] for o in lin.j("GET", "/api/orders", params={"window": w["id"]})["orders"]]
        fill(f.get_by_role("textbox", name="Volume (ML)"), TINY)
        advance(page, QUOTE_MS + FRAME_MS)
        click(f.get_by_role("button", name="Place order"))
        page.wait_for_url(re.compile(r".*/orders/ORD-\d{5}$"), timeout=UI_WAIT_MS)
    new = [o for o in lin.j("GET", "/api/orders", params={"window": w["id"]})["orders"] if o["number"] not in before]
    assert len(new) == 1 and new[0]["volume_ml"] == TINY
    cleanup.append((app_url, new[0]["number"]))
    assert alloc(lin) == r - D(TINY)


def stroke_by_ui(page, turnout, label, kind):
    card = field_card(page, turnout, label).filter(has_text=kind)
    live(page, lambda: expect(card).to_be_visible(timeout=REAL_WAIT_MS))
    card.get_by_role("button", name=f"Hold to stroke {turnout}").focus()
    page.keyboard.down("Space")
    advance(page, DWELL_MS + FRAME_MS)
    page.keyboard.up("Space")
    expect(page.get_by_role("status", name="Gate dwell status")).to_contain_text(f"Stroke stored for {turnout}.", timeout=UI_WAIT_MS)


def test_wf_field_stroke_start(browser, app_url, cleanup):
    d, g, w, o, c, t = stroke_order(app_url, cleanup, volume=STROKE_ML)
    flow0 = D(window(d, w["id"])["channel_flow_ml_day"])
    with screen(browser, app_url, "rory", "/field") as page:
        stroke_by_ui(page, t, w["label"], "Start")
        live(page, lambda: expect(field_card(page, t, w["label"]).filter(has_text="Finish")).to_be_visible(timeout=REAL_WAIT_MS))
    assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "running"
    assert D(window(d, w["id"])["channel_flow_ml_day"]) == flow0 + D(o["rate_ml_day"]) > flow0
    _, s3 = observers("primary")
    assert json.loads(s3.get(f"strokes/{c['id']}.json"))["kind"] == "start"
    assert card_of(d, w["id"], o["number"], "finish")["holder_code"] == "OP-D-01"


def test_wf_field_stroke_finish(browser, app_url, cleanup):
    d, g, w, o, c, t = stroke_order(app_url, cleanup)
    delivered0 = D(window(d, w["id"])["delivered_ml"])
    with screen(browser, app_url, "rory", "/field") as page:
        stroke_by_ui(page, t, w["label"], "Start")
        stroke_by_ui(page, t, w["label"], "Finish")
    assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "delivered"
    assert D(window(d, w["id"])["delivered_ml"]) == delivered0 + D(TINY)
    fin = card_of(d, w["id"], o["number"], "finish", None)
    _, s3 = observers("primary")
    assert json.loads(s3.get(f"strokes/{fin['id']}.json"))["kind"] == "finish"


def test_wf_gate_handover_midflow(browser, app_url, cleanup):
    d, g, w, o, c, t = stroke_order(app_url, cleanup, holder="OP-D-01", standby="OP-D-02")
    ok(Api(app_url, "rory").post(f"/api/gate-cards/{c['id']}/stroke"))
    delivered0 = D(window(d, w["id"])["delivered_ml"])
    with screen(browser, app_url, "hal", f"/board?channels={w['channel_id']}&window={w['id']}") as page:
        click(page.get_by_role("button", name="Gate cards"))
        click(page.get_by_role("button", name=f"Remove holder {t}").first)
        expect(page.get_by_role("status", name="Board status")).to_have_text(f"Gate card for {t} handed to OP-D-02.", timeout=UI_WAIT_MS)
    assert card_of(d, w["id"], o["number"], "finish")["holder_code"] == "OP-D-02"
    with screen(browser, app_url, "tess", "/field") as page:
        stroke_by_ui(page, t, w["label"], "Finish")
    starts = [x for x in cards(d, w["id"]) if x["order_number"] == o["number"] and x["kind"] == "start"]
    assert len(starts) == 1 and starts[0]["state"] == "spent"
    assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "delivered"
    assert D(window(d, w["id"])["delivered_ml"]) == delivered0 + D(TINY)


def test_wf_gate_handover_no_successor(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000", rostered="OP-D-01")
    clear_turnout(app_url, "mara", "T9-02")
    o = ok(place(Api(app_url, "mara"), "T9-02", w["id"], TINY, "OP-D-01"), 201)["order"]
    cleanup.append((app_url, o["number"]))
    with screen(browser, app_url, "hal", f"/board?channels=C-09&window={w['id']}") as page:
        click(page.get_by_role("button", name="Gate cards"))
        click(page.get_by_role("button", name=REMOVE_MARA_C09))
        expect(page.get_by_role("status", name="Board status")).to_have_text(
            "No standby or rostered operator can take this card.", timeout=UI_WAIT_MS)
    assert card_of(d, w["id"], o["number"], "start")["holder_code"] == "OP-D-01"


def test_wf_order_lifecycle_board_close(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(app_url, "mara", "T9-02")
    mara = Api(app_url, "mara")
    r = alloc(mara)
    o = ok(place(mara, "T9-02", w["id"], "0.500"), 201)["order"]
    cleanup.append((app_url, o["number"]))
    with screen(browser, app_url, "hal", f"/board?channels=C-09&window={w['id']}&tab=orders") as page:
        click(page.get_by_role("button", name=f"Close order {o['number']}"))
        expect(page.get_by_role("status", name="Board status")).to_have_text(f"Order {o['number']} is now Closed.", timeout=UI_WAIT_MS)
        after_flow(page, lambda: expect(page.get_by_role("group", name="Remaining ML")).to_contain_text("1.000", timeout=TRY_MS))
    assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "closed" and alloc(mara) == r


def test_wf_order_lifecycle_reopen(browser, app_url, cleanup):
    d, g, w, o, c, t = stroke_order(app_url, cleanup)
    ok(Api(app_url, "rory").post(f"/api/gate-cards/{c['id']}/stroke"))
    committed = window(d, w["id"])["committed_ml"]
    with screen(browser, app_url, "hal", f"/board?channels={w['channel_id']}&window={w['id']}&tab=orders") as page:
        click(page.get_by_role("button", name=f"Close order {o['number']}"))
        status = page.get_by_role("status", name="Board status")
        expect(status).to_have_text(f"Order {o['number']} is now Closed.", timeout=UI_WAIT_MS)
        click(page.get_by_role("button", name=f"Reopen order {o['number']}"))
        expect(status).to_have_text(f"Order {o['number']} is now Running.", timeout=UI_WAIT_MS)
    assert d.j("GET", f"/api/orders/{o['number']}")["order"]["status"] == "running"
    assert window(d, w["id"])["committed_ml"] == committed


def test_wf_restriction_publish_happy(browser, app_url, cleanup):
    d, w, a, b = restriction_scene(app_url, cleanup)
    w = window(d, w["id"])
    with screen(browser, app_url, "hal", "/board?channels=C-09") as page:
        click(page.get_by_role("button", name=f"Channel 9, {w['label']}, {w['remaining_ml']} ML remaining"))
        page.get_by_role("tab", name="Capacity").focus()
        page.keyboard.press("r")
        dialog = page.get_by_role("dialog", name="Publish restriction")
        fill(dialog.get_by_role("textbox", name="Cap (ML/day)", exact=True), "12")
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), REASON)
        click(dialog.get_by_role("button", name="Publish", exact=True))
        page.wait_for_url(re.compile(r".*/restrictions/[^/?]+$"), timeout=UI_WAIT_MS)
        announce = f"Restriction published for Channel 9, {w['label']}. {len([b['number']])} orders moved to requested."
        status = page.get_by_role("status", name="Board status")
        expect(status).to_have_text(announce, timeout=UI_WAIT_MS)
        advance(page, LIVE_MS + STEP_MS)
        expect(status).to_have_text(announce)
        rid = urlparse(page.url).path.rsplit("/", 1)[1]
        page.reload()
        expect(page.get_by_text(b["number"]).first).to_be_visible(timeout=UI_WAIT_MS)
        expect(page.get_by_text("12.000").first).to_be_visible()
        expect(page.get_by_text(CUT_VOLUME).first).to_be_visible()
    r = d.j("GET", f"/api/restrictions/{rid}")
    assert r["restriction"]["cap_ml_day"] == "12.000" and r["moved_orders"] == [b["number"]]
    assert d.j("GET", f"/api/orders/{b['number']}")["order"]["status"] == "requested"


def test_wf_restriction_publish_invalid(browser, app_url):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    msg = field_err(d.post(f"/api/windows/{w['id']}/restrictions", {"cap_ml_day": "24.000", "reason": REASON}), "cap_ml_day")
    with screen(browser, app_url, "hal", f"/board?channels=C-09&window={w['id']}") as page:
        click(page.get_by_role("button", name="Publish restriction"))
        dialog = page.get_by_role("dialog", name="Publish restriction")
        fill(dialog.get_by_role("textbox", name="Cap (ML/day)", exact=True), "24.000")
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), REASON)
        click(dialog.get_by_role("button", name="Publish", exact=True))
        expect(dialog).to_contain_text(msg, timeout=UI_WAIT_MS)
        assert window(d, w["id"])["restriction_cap_ml_day"] is None
        fill(dialog.get_by_role("textbox", name="Cap (ML/day)", exact=True), "12.000")
        click(dialog.get_by_role("button", name="Publish", exact=True))
        page.wait_for_url(re.compile(r".*/restrictions/[^/?]+$"), timeout=UI_WAIT_MS)
    assert window(d, w["id"])["restriction_cap_ml_day"] == "12.000"


def test_wf_capacity_revisions_two_dispatchers(browser, app_url):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    label = f"Cap for {w['label']} (ML/day)"
    with contextlib.ExitStack() as st:
        hp = st.enter_context(screen(browser, app_url, "hal", "/channels/C-09/capacity"))
        bp = st.enter_context(screen(browser, app_url, "bea", "/channels/C-09/capacity", "768"))
        base = d.j("GET", "/api/channels/C-09/capacity")["revision"]
        fill(hp.get_by_role("textbox", name=label), "20")
        fill(bp.get_by_role("textbox", name=label), "22")
        click(hp.get_by_role("button", name="Save table"))
        expect(hp.get_by_role("status", name="Capacity status")).to_have_text(f"Revision {base + 1} saved.", timeout=UI_WAIT_MS)
        click(bp.get_by_role("button", name="Save table"))
        dialog = bp.get_by_role("alertdialog", name="Capacity table conflict")
        expect(dialog).to_contain_text("20.000", timeout=UI_WAIT_MS)
        expect(dialog).to_contain_text("22")
        click(dialog.get_by_role("button", name="Keep settled caps"))
        click(hp.get_by_role("button", name=f"Restore revision {base}", exact=True))
        click(hp.get_by_role("dialog", name=f"Restore revision {base}", exact=True).get_by_role(
            "button", name="Restore", exact=True))
        expect(hp.get_by_role("status", name="Capacity status")).to_have_text(
            f"Revision {base} restored as revision {base + 3}.", timeout=UI_WAIT_MS)
    cap = d.j("GET", "/api/channels/C-09/capacity")
    assert cap["revision"] == base + 3 and next(x for x in cap["cells"] if x["window_id"] == w["id"])["cap_ml_day"] == "24.000"


def test_wf_capacity_revisions_restore_refused(browser, app_url, cleanup):
    d = Api(app_url, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    base = d.j("GET", "/api/channels/C-09/capacity")["revision"]
    low = d.j("PUT", "/api/channels/C-09/capacity", {"base_revision": base, "cells": [{"window_id": w["id"], "cap_ml_day": "12.000"}]})["revision"]
    d.j("PUT", "/api/channels/C-09/capacity", {"base_revision": low, "cells": [{"window_id": w["id"], "cap_ml_day": "24.000"}]})
    clear_turnout(app_url, "mara", "T9-02")
    cleanup.append((app_url, ok(place(Api(app_url, "mara"), "T9-02", w["id"], "0.800"), 201)["order"]["number"]))
    rev = d.j("GET", "/api/channels/C-09/capacity")["revision"]
    with screen(browser, app_url, "hal", "/channels/C-09/capacity") as page:
        click(page.get_by_role("button", name=f"Restore revision {low}", exact=True))
        click(page.get_by_role("dialog", name=f"Restore revision {low}", exact=True).get_by_role(
            "button", name="Restore", exact=True))
        expect(page.get_by_role("status", name="Capacity status")).to_have_text(
            f"Restoring revision {low} would cut below what is already committed.", timeout=UI_WAIT_MS)
    assert window(d, w["id"])["table_cap_ml_day"] == "24.000"
    assert d.j("GET", "/api/channels/C-09/capacity")["revision"] == rev


def test_wf_channel_board_desk(browser, app_url):
    d = Api(app_url, "hal")
    w = quiet_window(d, "C-09", 1, "24.000")
    with screen(browser, app_url, "hal", "/board") as page:
        for name in ("Lateral 4", "Channel 12 Spur"):
            click(page.get_by_role("checkbox", name=name))
        click(page.get_by_role("button", name=f"Channel 9, {w['label']}, {w['remaining_ml']} ML remaining"))
        detail = page.get_by_role("region", name="Window detail")
        expect(detail.get_by_role("group", name="Remaining ML")).to_contain_text("1.000", timeout=UI_WAIT_MS)
        expect(detail.get_by_role("group", name="Delivered ML")).to_contain_text("0.000")
        expect(page.get_by_role("grid", name="Window grid").get_by_role("button").filter(has_text="Lateral 4")).to_have_count(0)
    assert parse_qs(urlparse(page.url).query)["window"] == [w["id"]]


def test_wf_channel_board_phone(browser, app_url):
    d = Api(app_url, "hal")
    w = quiet_window(d, "C-09", 1, "24.000")
    with screen(browser, app_url, "hal", "/board?channels=C-09", "375") as page:
        click(page.get_by_role("button", name="Channels", exact=True))
        drawer = page.get_by_role("dialog", name="Channels", exact=True)
        expect(drawer.get_by_role("checkbox", name="Channel 9")).to_be_visible(timeout=UI_WAIT_MS)
        click(drawer.get_by_role("button", name="Close channels"))
        after_flow(page, lambda: expect(page.get_by_role("checkbox", name="Channel 9")).to_have_count(0, timeout=TRY_MS))
        click(page.get_by_role("button", name=f"Channel 9, {w['label']}, {w['remaining_ml']} ML remaining"))
        sheet = page.get_by_role("dialog", name="Window detail")
        expect(sheet).to_be_visible(timeout=UI_WAIT_MS)
        advance(page, DWELL_MS)
        assert sheet.bounding_box()["width"] >= VIEWPORTS["375"][0] - 1
        page.keyboard.press("Escape")
        after_flow(page, lambda: expect(page.get_by_role("dialog", name="Window detail")).to_have_count(0, timeout=TRY_MS))
    assert "window" not in parse_qs(urlparse(page.url).query)


def test_wf_regulator_pack_happy(browser, app_url, mail):
    d = Api(app_url, "hal")
    w, day = pack_period(d)
    sig = signatory()
    with screen(browser, app_url, "priya", "/packs/new") as page:
        f = page.get_by_role("form", name="New pack")
        fill(f.get_by_role("textbox", name="From", exact=True), day)
        fill(f.get_by_role("textbox", name="To", exact=True), day)
        fill(f.get_by_role("textbox", name="Signatory"), sig)
        click(f.get_by_role("button", name="Preview pack"))
        expect(page.get_by_role("region", name="Pack preview")).to_contain_text(
            f"Wirrinbah Water Trust delivery pack {day} to {day}", timeout=UI_WAIT_MS)
        click(page.get_by_role("button", name="Sign and submit pack"))
        page.wait_for_url(re.compile(r".*/packs/WP-\d{4}$"), timeout=UI_WAIT_MS)
        n = urlparse(page.url).path.rsplit("/", 1)[1]
        expect(page.get_by_role("heading", name=f"Pack {n}")).to_be_visible(timeout=UI_WAIT_MS)
        poll(lambda: Api(app_url, "priya").j("GET", f"/api/packs/{n}")["pack"]["state"] == "mailed", PACK_WAIT_S)
        live(page, lambda: expect(page.get_by_role("status", name="Pack status")).to_have_text(
            f"Pack {n} stored and mailed to the regulator.", timeout=REAL_WAIT_MS))
        _, s3 = observers("primary")
        stored = s3.get(f"packs/{n}.txt")
        digest = hashlib.sha256(stored).hexdigest()
        expect(page.get_by_role("group", name="Pack digest")).to_contain_text(f"SHA-256 {digest}")
        expect(page.get_by_role("button", name="Withdraw pack")).to_have_count(0)
    assert stored.decode().split("\n")[-2] == f"Signed by {sig} for Wirrinbah Water Trust"
    assert len(await_mail(mail, "returns@regulator.example", f"Ditchbook delivery pack {n}", contains=digest)) == 1


def test_wf_regulator_pack_stale(browser, app_url):
    d = Api(app_url, "hal")
    w, day = pack_period(d)
    sig = signatory()
    with screen(browser, app_url, "priya", "/packs/new") as page:
        f = page.get_by_role("form", name="New pack")
        fill(f.get_by_role("textbox", name="From", exact=True), day)
        fill(f.get_by_role("textbox", name="To", exact=True), day)
        fill(f.get_by_role("textbox", name="Signatory"), sig)
        click(f.get_by_role("button", name="Preview pack"))
        expect(page.get_by_role("region", name="Pack preview")).to_contain_text(w["id"], timeout=UI_WAIT_MS)
        same_day_window(d, w)
        click(page.get_by_role("button", name="Sign and submit pack"))
        expect(page.get_by_text("The records changed since your preview. Preview again before signing.")).to_be_visible(timeout=UI_WAIT_MS)
        assert urlparse(page.url).path == "/packs/new"
    assert not [x for x in Api(app_url, "priya").j("GET", "/api/packs")["packs"] if x["signatory"] == sig]


def test_wf_contractor_erasure(browser, app_url, cleanup):
    inst, base, code = erasable(app_url, ("minio-down", "mailpit-down", "primary"))
    name, who, phone = CONTRACTORS[code]
    d = Api(base, "hal")
    w = upcoming_window(d, "C-09", 1, "24.000")
    clear_turnout(base, "mara", "T9-02")
    o = ok(place(Api(base, "mara"), "T9-02", w["id"], TINY, code, "OP-D-02"), 201)["order"]
    cleanup.append((base, o["number"]))
    with screen(browser, base, "priya", "/contractors") as cp:
        click(cp.get_by_role("button", name=f"Erase {code}"))
        click(cp.get_by_role("alertdialog", name=f"Erase contractor {code}").get_by_role("button", name="Erase for good"))
        expect(cp.get_by_role("status", name="Contractor status")).to_have_text(
            f"Contractor {code} erased. Their deliveries now show only the operator code.", timeout=UI_WAIT_MS)
        row = cp.get_by_role("table", name="Contractors").get_by_role("row").filter(has_text=code)
        expect(row).to_contain_text(f"Operator {code}")
        expect(row).to_contain_text("Erased")
        expect(row).not_to_contain_text(name)
        box = cp.get_by_role("combobox", name="Search turnouts, growers and operators")
        fill(box, name)
        advance(cp, STEP_MS)
        expect(cp.get_by_role("option").filter(has_text=name)).to_have_count(0)
        fill(box, code)
        advance(cp, STEP_MS)
        expect(cp.get_by_role("option").filter(has_text=f"Operator {code}")).to_have_count(1, timeout=UI_WAIT_MS)
    oo = d.j("GET", f"/api/orders/{o['number']}")["order"]
    assert (oo["holder_code"], oo["standby_code"]) == ("OP-D-02", None)
    assert card_of(d, w["id"], o["number"], "start")["holder_code"] == "OP-D-02"
    assert not [s for s in d.j("GET", "/api/search", params={"q": name})["suggestions"] if s["kind"] == "operator"]


def test_erase_dialog_by_keyboard(browser, app_url):
    inst, base, code = erasable(app_url, ("minio-down", "mailpit-down", "primary"))
    with screen(browser, base, "priya", "/contractors") as cp:
        erase = cp.get_by_role("button", name=f"Erase {code}")
        expect(erase).to_be_visible(timeout=UI_WAIT_MS)
        deletes = watch(cp, f"/api/contractors/{code}", "DELETE")
        tab_to(cp, erase)
        cp.keyboard.press("Enter")
        dialog = cp.get_by_role("alertdialog", name=f"Erase contractor {code}")
        cancel, forgood = dialog.get_by_role("button", name="Cancel", exact=True), dialog.get_by_role("button", name="Erase for good")
        expect(cancel).to_be_focused(timeout=UI_WAIT_MS)
        cp.keyboard.press("Tab")
        expect(forgood).to_be_focused()
        cp.keyboard.press("Tab")
        expect(cancel).to_be_focused()
        cp.keyboard.press("Shift+Tab")
        expect(forgood).to_be_focused()
        cp.keyboard.press("Escape")
        expect(erase).to_be_focused(timeout=UI_WAIT_MS)
        assert deletes == []
        cp.keyboard.press("Enter")
        expect(cancel).to_be_focused(timeout=UI_WAIT_MS)
        cp.keyboard.press("Tab")
        cp.keyboard.press("Enter")
        expect(cp.get_by_role("status", name="Contractor status")).to_have_text(
            f"Contractor {code} erased. Their deliveries now show only the operator code.", timeout=UI_WAIT_MS)
        expect(erase).to_be_focused()
        expect(erase).to_have_attribute("aria-disabled", "true")
        for key in ("Enter", "Space"):
            cp.keyboard.press(key)
        erase.dispatch_event("click")
        advance(cp, DWELL_MS)
        assert len(deletes) == 1
        expect(cp.get_by_role("alertdialog", name=f"Erase contractor {code}")).to_have_count(0)
    row = next(x for x in Api(base, "priya").j("GET", "/api/contractors")["contractors"] if x["code"] == code)
    assert row["erased"] is True


def test_wf_contractor_erasure_cancel(browser, app_url):
    inst, base, code = erasable(app_url)
    with screen(browser, base, "priya", "/contractors") as page:
        deletes = watch(page, f"/api/contractors/{code}", "DELETE")
        click(page.get_by_role("button", name=f"Erase {code}"))
        click(page.get_by_role("alertdialog", name=f"Erase contractor {code}").get_by_role("button", name="Cancel", exact=True))
        expect(page.get_by_role("button", name=f"Erase {code}")).to_be_focused(timeout=UI_WAIT_MS)
        assert deletes == []
    row = next(x for x in Api(base, "priya").j("GET", "/api/contractors")["contractors"] if x["code"] == code)
    assert not row["erased"] and row["name"] == CONTRACTORS[code][0]
    with screen(browser, base, "hal", "/contractors") as page:
        expect(page.get_by_role("table", name="Contractors")).to_be_visible(timeout=UI_WAIT_MS)
        expect(page.get_by_role("button", name=re.compile(r"^Erase "))).to_have_count(0)
    err(Api(base, "hal").delete(f"/api/contractors/{code}"), 403, "forbidden")


def test_wf_regulator_review_live(browser, app_url, cleanup):
    d, c = Api(app_url, "hal"), Api(app_url, "priya")
    w = upcoming_window(d, "C-09", 1, "24.000")
    pw, day = pack_period(d)
    with screen(browser, app_url, "quinn", "/review") as page:
        row = page.get_by_role("table", name="Channel totals").get_by_role("row").filter(has_text=w["label"])
        expect(row).to_contain_text("1.000", timeout=UI_WAIT_MS)
        sig = signatory()
        p = ok(submit(c, day, day, sig, preview(c, day, day, sig)), 202)["pack"]
        link = page.get_by_role("list", name="Mailed packs").get_by_role("link", name=f"Download {p['number']}")

        def mailed():
            listed = link.count()
            state = c.j("GET", f"/api/packs/{p['id']}")["pack"]["state"]
            assert not listed or state == "mailed", f"the pack is listed while it is {state}"
            advance(page, STEP_MS)
            return state == "mailed"

        poll(mailed, PACK_WAIT_S)
        live(page, lambda: (expect(link).to_be_visible(timeout=REAL_WAIT_MS),
                            expect(page.get_by_role("status", name="Review status")).to_have_text(
                                f"Pack {p['number']} received from the district.", timeout=REAL_WAIT_MS)))
        clear_turnout(app_url, "mara", "T9-02")
        cleanup.append((app_url, ok(place(Api(app_url, "mara"), "T9-02", w["id"], SMALL), 201)["order"]["number"]))
        live(page, lambda: expect(row).to_contain_text(q3(D(w["remaining_ml"]) - D(SMALL)), timeout=REAL_WAIT_MS))
        with page.expect_download() as dl:
            click(link)
        data = Path(dl.value.path()).read_bytes()
    _, s3 = observers("primary")
    assert data == s3.get(f"packs/{p['number']}.txt")


def test_wf_regulator_review_period(browser, app_url):
    d = Api(app_url, "hal")
    w1, w2 = past_window(d, "C-12"), past_window(d, "C-09")
    d1, d2 = local_date(w1["opens_at"]), local_date(w2["opens_at"])
    with screen(browser, app_url, "quinn", "/review") as page:
        f = page.get_by_role("form", name="Review period")
        table = page.get_by_role("table", name="Channel totals")
        expect(f.get_by_role("textbox", name="From", exact=True)).to_have_value("", timeout=UI_WAIT_MS)
        for day in (d1, d2):
            fill(f.get_by_role("textbox", name="From", exact=True), day)
            fill(f.get_by_role("textbox", name="To", exact=True), day)
            click(f.get_by_role("button", name="Show totals"))
            page.wait_for_url(lambda u, day=day: parse_qs(urlparse(u).query) == {"from": [day], "to": [day]}, timeout=UI_WAIT_MS)
        expect(table).to_contain_text(w2["label"], timeout=UI_WAIT_MS)
        page.go_back()
        expect(f.get_by_role("textbox", name="From", exact=True)).to_have_value(d1, timeout=UI_WAIT_MS)
        expect(table).to_contain_text(w1["label"])
        page.go_forward()
        expect(f.get_by_role("textbox", name="From", exact=True)).to_have_value(d2, timeout=UI_WAIT_MS)
        page.reload()
        expect(table).to_contain_text(w2["label"], timeout=UI_WAIT_MS)
        expect(f.get_by_role("textbox", name="To", exact=True)).to_have_value(d2)
        url = page.url
        msg = field_err(d.get("/api/totals", params={"from": d2, "to": "2000-01-01"}), "to")
        fill(f.get_by_role("textbox", name="To", exact=True), "2000-01-01")
        click(f.get_by_role("button", name="Show totals"))
        expect(f).to_contain_text(msg, timeout=UI_WAIT_MS)
        assert page.url == url
        expect(table).to_contain_text(w2["label"])


def test_wf_rationing_happy(browser, app_url, mail, cleanup):
    p = requested_pair(app_url, cleanup, big=True)
    with screen(browser, app_url, "hal", f"/board?channels={p.ch}&window={p.w['id']}&tab=orders") as page:
        click(page.get_by_role("button", name="Ration window"))
        click(page.get_by_role("alertdialog", name=f"Ration {p.w['label']}").get_by_role("button", name="Ration", exact=True))
        status = page.get_by_role("status", name="Board status")
        left = 0
        done = f"Window rationed. {len(ASKED)} orders scheduled, {left} left requested."
        expect(status).to_have_text(done, timeout=UI_WAIT_MS)
        rows = page.get_by_role("table", name="Window orders").get_by_role("row")
        expect(rows.filter(has_text=p.a["number"])).to_contain_text(f"Asked {ASKED[0]} ML")
        expect(rows.filter(has_text=p.a["number"])).to_contain_text("6.001")
        expect(rows.filter(has_text=p.b["number"])).to_contain_text(f"Asked {ASKED[1]} ML")
        expect(rows.filter(has_text=p.b["number"])).to_contain_text("4.000")
        after_flow(page, lambda: expect(page.get_by_role("group", name="Remaining ML")).to_contain_text("0.000", timeout=TRY_MS))
        advance(page, LIVE_MS + STEP_MS)
        expect(status).to_have_text(done)
    assert p.d.j("GET", f"/api/orders/{p.a['number']}")["order"]["volume_ml"] == "6.001"
    assert len(await_mail(mail, EMAIL[p.who_b], f"Ditchbook ration: {CHANNEL_NAME[p.ch]}, {p.w['label']}")) == 1


def test_wf_rationing_cancel(browser, app_url, cleanup):
    p = requested_pair(app_url, cleanup)
    with screen(browser, app_url, "hal", f"/board?channels={p.ch}&window={p.w['id']}&tab=orders") as page:
        sent = watch(page, f"/api/windows/{p.w['id']}/ration")
        btn = page.get_by_role("button", name="Ration window")
        click(btn)
        dialog = page.get_by_role("alertdialog", name=f"Ration {p.w['label']}")
        expect(dialog).to_contain_text(f"Share {p.w['remaining_ml']} ML among 2 requested orders", timeout=UI_WAIT_MS)
        click(dialog.get_by_role("button", name="Cancel", exact=True))
        expect(btn).to_be_focused(timeout=UI_WAIT_MS)
        assert sent == []
    assert {p.d.j("GET", f"/api/orders/{n}")["order"]["status"] for n in (p.a["number"], p.b["number"])} == {"requested"}


def test_if_run_manifest():
    m = json.loads(Path("/app/run.json").read_text())
    assert set(m) == {"_schema", "install", "build", "serve"} and m["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) for v in m.values())


ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def shipped():
    return {package.name: package.licence for package in shipped_packages()}


def test_if_third_party_notices():
    notes = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for name in list(shipped()) + ["Archivo", "IBM Plex Sans"]:
        assert name in notes, name


def test_if_licences_allowed():
    for name, lic in shipped().items():
        lic = lic if isinstance(lic, str) else (lic or {}).get("type", "")
        parts = [p.strip("() ") for p in re.split(r"\bOR\b", lic or "")]
        assert any(all(t.strip("() ") in ALLOWED for t in p.split(" AND ")) for p in parts), f"{name}: {lic}"
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_other_datastore():
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level", "pouchdb", "lokijs"}
    assert not banned & set(shipped())
    files = [p for p in Path("/app").rglob("*") if "node_modules" not in p.parts and p.suffix in (".sqlite", ".sqlite3", ".db")]
    assert files == []


def test_if_lockfile_used():
    json.loads(Path("/app/package-lock.json").read_text())
    install = json.loads(Path("/app/run.json").read_text())["install"]
    assert "npm ci" in install or install.split()[:2] == ["npm", "install"]


def test_if_service_config_untouched():
    traj = Path("/logs/agent/trajectory.json")
    if not traj.exists():
        return
    for step in json.loads(traj.read_text()).get("steps", []):
        for call in step.get("tool_calls", []) or []:
            args = json.dumps(call.get("arguments", {}))
            if call.get("function_name", call.get("name", "")) in ("Write", "Edit", "MultiEdit"):
                assert not re.search(r"compose[^\"]*\.ya?ml", args), args[:200]


def test_if_same_origin_only(browser, app_url):
    for who, path in (("lin", "/grower/orders/new"), ("hal", "/board"), ("tess", "/field"), ("quinn", "/review")):
        with screen(browser, app_url, who, path) as page:
            seen = []
            page.on("request", lambda r: seen.append(r.url))
            page.reload()
            advance(page, LIVE_MS)
            bad = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
            assert bad == []
