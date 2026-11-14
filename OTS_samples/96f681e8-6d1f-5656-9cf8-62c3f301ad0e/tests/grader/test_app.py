from __future__ import annotations

import json
import math
import os
import random
import re
import signal
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from datetime import date as Date, datetime, time as dtime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PWError, TimeoutError as PWTimeout, expect

from conftest import (addresses, advance, animations, check as tick, focused_name, held, idempotency_key,
                      layout, licence_allowed, open_app, post_json, project_dirs, same_origin, select,
                      serve_copy, shipped_packages, tap, text)

try:
    from conftest import Keycloak, Postgres
except ImportError:
    from keycloak import Keycloak
    from postgres import Postgres

ZONE = ZoneInfo("Europe/Madrid")
PASSWORD = "Yardline-Court-7"
HTTP_S = 25
POLL_S = 0.5
TOKEN_REUSE_S = 45
LOGIN_S = 40
UI_S = 40
CLIENT_REDIRECT_MS = 2500
NEAR_SPREAD_S = 240
OPEN_FROM_MIN = 480
OPEN_TO_MIN = 1380
BODY_LIMIT = 65536
PAGE_DEFAULT = 20
PAGE_MAX = 50
TEXT_LIMIT = 280
REFRESH_MS = 10_000
JOIN_LIMIT = 6
RETRY_AFTER_MAX = 60
SLOW_MS = 3000
ABORT_S = 0.5
TODAY_ROWS = 21
HISTORY_BAND = (2090, 2094)
COACH_BAND = (2040, 2044)
SERIES_BAND = (2045, 2089)
CO = ["tomas", "noor", "kai"]
NAMES = {"ines": "Inés Carvajal", "tomas": "Tomás Rial", "noor": "Noor Haddad", "kai": "Kai Brennan",
         "lucia": "Lucía Ortega", "pablo": "Pablo Ferrer", "rosa": "Rosa Vidal", "marta": "Marta Sol",
         "owen": "Owen Pryce", "elena": "Elena Brandt"}
EMAIL = {**{u: f"{u}@players.marloweyard.test" for u in ["ines", "tomas", "noor", "kai", "lucia", "pablo"]},
         **{u: f"{u}@staff.marloweyard.test" for u in ["rosa", "marta", "owen", "elena"]}}
MSG = {"UNAUTHENTICATED": "Sign in to continue.", "PAYMENT_DECLINED": "Your card was declined, so nothing was charged.",
       "FORBIDDEN": "Your role cannot do that.", "NOT_TODAY": "Only today's bookings can be marked.",
       "NOT_YOUR_COACH_ID": "You can only book lesson blocks on your own name.", "NOT_FOUND": "We could not find that.",
       "SLOT_TAKEN": "Someone else got that spot first.", "MATCH_FULL": "Someone else got that spot first.",
       "MATCH_CLOSED": "This match has closed.", "ALREADY_JOINED": "You are already in this match.",
       "HOLD_EXPIRED": "This hold has ended. Pick the slot again.", "ALREADY_PAID": "This is already paid.",
       "SHARE_VOID": "This share is no longer due.", "SHARE_SETTLED": "This share was covered by the organiser.",
       "INVALID_TRANSITION": "This booking cannot change that way now.",
       "NOT_STARTED": "This booking is still inside its grace time.",
       "CHECK_IN_CLOSED": "Check-in closed when the booking ended.", "BOOKING_STARTED": "This booking has already started.",
       "IDEMPOTENCY_CONFLICT": "That key was already used for a different request.",
       "VERSION_STALE": "Someone changed this first. Reload to see the latest.", "TOO_LARGE": "That request is too large.",
       "UNSUPPORTED_MEDIA_TYPE": "Send the request as JSON.", "VALIDATION": "Check the highlighted fields.",
       "RATE_LIMITED": "Too many tries. Wait a moment and try again.",
       "PAYMENT_NOT_CONFIRMED": "The payment was not confirmed, so nothing changed."}
HOLD_DOWN = "Payments are down, so we could not hold this slot. Try again in a minute."
PAY_DOWN = "Payments are down, so nothing was charged. Try again in a minute."
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
_PAUSE = threading.Event()
_CLEAN: list = []
UNKNOWN_BOOKING_PATH = "/api/bookings/bk_probe_none"
TICK_MS = 1000
BOOKED_MIN = 90 + 60
NO_STORE_WORD = "SQLite"
FILE_MAGIC = b"SQLite format 3"
BAD_RETURNS = ["//evil.example/x", "/\\evil.example", "https://evil.example/", "/%2F/evil.example", "/ok\x01x"]


@pytest.fixture(autouse=True)
def _free_near_courts():
    yield
    _SHORT.clear()
    while _CLEAN:
        base, user, bid = _CLEAN.pop()
        for action in ("release", "cancel"):
            with suppress(Exception):
                httpx.post(f"{base}/api/bookings/{bid}/{action}", json={}, headers=H(user), timeout=HTTP_S)


def pause():
    _PAUSE.wait(POLL_S)


def eventually(fn, secs, msg):
    deadline = time.monotonic() + secs
    while time.monotonic() < deadline:
        v = fn()
        if v:
            return v
        pause()
    pytest.fail(msg)


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def eur(c: int) -> str:
    return f"{c // 100}.{c % 100:02d}"


def mmss(s: int) -> str:
    return f"{s // 60:02d}:{s % 60:02d}"


def label(x) -> str:
    return f"Court {x['court']}, {x['start'][:10]} {x['start'][11:16]}"


_SHORT: list = []


def short() -> str:
    if not _SHORT:
        bases = [os.environ[k].rstrip("/") for k in ("APP_SHORT_URL", "APP_SHORT_EAST_URL")]
        roomy = [b for b in bases if has_today_room(b)] or bases
        _SHORT.append(min(roomy, key=lambda b: (busy_near(b), bases.index(b))))
    return _SHORT[0]


def short_madrid() -> str:
    return os.environ["APP_SHORT_URL"].rstrip("/")


_ZONES: dict = {}


def zone(base) -> ZoneInfo:
    if base not in _ZONES:
        _ZONES[base] = ZoneInfo(club(base)["timezone"])
    return _ZONES[base]


def down(name: str) -> str:
    return os.environ[name].rstrip("/")


_DISC: dict = {}
_TOK: dict = {}


def oidc() -> dict:
    if not _DISC:
        _DISC.update(httpx.get(os.environ["AUTH_ISSUER_URL"].rstrip("/") + "/.well-known/openid-configuration",
                               timeout=HTTP_S).json())
    return _DISC


def grant(user: str) -> dict:
    r = httpx.post(oidc()["token_endpoint"], timeout=HTTP_S, data={
        "grant_type": "password", "client_id": os.environ["AUTH_CLIENT_ID"],
        "client_secret": os.environ["AUTH_CLIENT_SECRET"], "username": user, "password": PASSWORD, "scope": "openid"})
    assert r.status_code == 200, f"Keycloak gave no token for {user}: {r.text[:200]}"
    return r.json()


def token(user: str) -> str:
    t = _TOK.get(user)
    if not t or time.monotonic() - t[1] > TOKEN_REUSE_S:
        t = (grant(user)["access_token"], time.monotonic())
        _TOK[user] = t
    return t[0]


def H(user) -> dict:
    return {"Authorization": f"Bearer {token(user)}"} if user else {}


def get(base, path, user=None, params=None) -> httpx.Response:
    return httpx.get(base + path, headers=H(user), params=params, timeout=HTTP_S)


def post(base, path, body, user=None, key=None, **hdr) -> httpx.Response:
    return post_json(base, path, body, key, **H(user), **hdr)


def put(base, path, body, user) -> httpx.Response:
    return httpx.put(base + path, json=body, headers=H(user), timeout=HTTP_S)


def ok(r: httpx.Response, status=200):
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} -> {r.status_code} {r.text[:400]}"
    return r.json()


def err(r: httpx.Response, status, code, msg=None) -> dict:
    assert r.status_code == status, f"{r.request.url.path}: expected {status} {code}, got {r.status_code} {r.text[:300]}"
    b = r.json()
    assert b.get("code") == code and b.get("message") == (msg or MSG[code]), b
    assert set(b) <= {"code", "message", "errors"}, b
    return b


def field_err(r, field, message):
    b = err(r, 422, "VALIDATION")
    assert b.get("errors", {}).get(field) == message, b


def club(base) -> dict:
    return ok(get(base, "/api/club"))


def server_now(base) -> datetime:
    return ts(ok(get(base, "/api/grid", "ines", {"from": "2027-03-28", "courts": "1"}))["server_now"])


def far_slot(minutes=60, years=(2030, 2089)):
    r = random.Random()
    y, m, d = r.randint(*years), r.choice([1, 2, 4, 5, 6, 7, 8, 9, 11, 12]), r.randint(1, 28)
    t = r.randrange(OPEN_FROM_MIN, OPEN_TO_MIN - minutes + 1, 30)
    return r.randint(1, 7), f"{y:04d}-{m:02d}-{d:02d}T{t // 60:02d}:{t % 60:02d}"


def soon_slots(base, lo_s, hi_s, minutes=60):
    cfg = club(base)
    a, b = cfg["opening_hours"].split("-")
    am = int(a[:2]) * 60 + int(a[3:])
    bm = int(b[:2]) * 60 + int(b[3:])
    step = cfg["slot_step_minutes"]
    now = server_now(base)
    t = (now + timedelta(seconds=lo_s)).replace(second=0, microsecond=0) + timedelta(minutes=1)
    out = []
    for _ in range(2000):
        if t > now + timedelta(seconds=hi_s):
            break
        lt = t.astimezone(zone(base))
        tm = lt.hour * 60 + lt.minute
        if tm >= am and (tm - am) % step == 0 and tm + minutes <= bm:
            out.append(lt.strftime("%Y-%m-%dT%H:%M"))
        t += timedelta(minutes=1)
    return out


def create(base, user, cands, minutes=60, co=None, levels=None, note=None, track=False, must=True):
    path = "/api/matches" if levels else "/api/holds"
    for c, s in cands:
        body = {"court": c, "start": s, "minutes": minutes}
        if co:
            body["co_players"] = [EMAIL[x] for x in co]
        if levels:
            body["level_min"], body["level_max"] = levels
        if note is not None:
            body["note"] = note
        r = post(base, path, body, user, idempotency_key())
        if r.status_code == 409 and r.json().get("code") == "SLOT_TAKEN":
            continue
        made = ok(r, 201)
        if track and not levels:
            _CLEAN.append((base, user, made["id"]))
        return made
    if must:
        pytest.fail(f"POST {path}: every candidate slot answered SLOT_TAKEN; expected a free slot")
    return None


def hold(base, user="ines", minutes=60, co=None, slot=None, note=None):
    return create(base, user, [slot] if slot else [far_slot(minutes) for _ in range(25)], minutes, co, note=note)


def far_match(base, user, levels, slot=None, minutes=60):
    return create(base, user, [slot] if slot else [far_slot(minutes) for _ in range(25)], minutes, levels=levels)


def near(base, user, lead, minutes=60, co=None, levels=None):
    starts = soon_slots(base, lead, lead + NEAR_SPREAD_S, minutes)[:6]
    if not starts:
        pytest.fail("soon_slots found no start in the requested window; expected the short-timer copy to offer one")
    made = create(base, user, [(c, s) for s in starts for c in random.sample(range(1, 8), 7)], minutes, co, levels,
                  track=True, must=False)
    if made is None:
        eventually(lambda: court_free(base, lead, minutes), COURT_WAIT_S,
                   "no short-timer court came free near now; expected one within a booking's length")
        starts = soon_slots(base, lead, lead + NEAR_SPREAD_S, minutes)[:6]
        made = create(base, user, [(c, s) for s in starts for c in random.sample(range(1, 8), 7)], minutes, co,
                      levels, track=True)
    return made


COURT_WAIT_S = 75 * 60


def busy_near(base, lead=60, minutes=60) -> int:
    first = server_now(base) + timedelta(seconds=lead)
    end = first + timedelta(seconds=NEAR_SPREAD_S, minutes=minutes)
    _, rows = desk_all(base)
    return len({r["court"] for r in rows if ts(r["start_utc"]) < end and ts(r["start_utc"]) + timedelta(minutes=r["minutes"]) > first})


def court_free(base, lead, minutes):
    return busy_near(base, lead, minutes) < 7


def pay(base, b, user="ines"):
    return ok(post(base, f"/api/bookings/{b['id']}/pay", {}, user, idempotency_key()))


def join(base, mid, user):
    return post(base, f"/api/matches/{mid}/join", {}, user, idempotency_key())


def booking(base, bid, user="ines"):
    return ok(get(base, f"/api/bookings/{bid}", user))


def grid_cell(base, c, s, user="ines"):
    g = ok(get(base, "/api/grid", user, {"from": s[:10], "courts": str(c)}))
    for d in g["days"]:
        for x in d["cells"]:
            if x["court"] == c and x["start"][:16] == s:
                return x
    pytest.fail(f"GET /api/grid listed no cell for Court {c} at {s}")


def credits(base, user):
    return ok(get(base, "/api/me/credits", user))


def topic(base, user):
    return ok(get(base, "/api/me", user))["push_topic"]


def pricing(base):
    return ok(get(base, "/api/manager/pricing", "elena"))


def version_for(sched, d):
    return max((v for v in sched if v["effective_from"] <= d), key=lambda v: (v["effective_from"], v["version"]))


def price(sched, start, minutes):
    v = version_for(sched, start[:10])
    t0 = datetime.fromisoformat(start).replace(tzinfo=ZONE).astimezone(timezone.utc)
    total = 0
    for i in range(minutes):
        t = (t0 + timedelta(minutes=i)).astimezone(ZONE)
        peak = DAYS[t.weekday()] in v["peak_days"] and v["peak_start"] <= t.strftime("%H:%M") < v["peak_end"]
        total += v["peak_cents_per_minute"] if peak else v["offpeak_cents_per_minute"]
    return total, v["version"]


def quote_of(base, c, s, minutes):
    return ok(get(base, "/api/quote", "ines", {"court": c, "start": s, "minutes": minutes}))


def desk_all(base):
    out, cur, day = [], None, None
    for _ in range(40):
        p = {"limit": PAGE_MAX, **({"cursor": cur} if cur else {})}
        b = ok(get(base, "/api/desk/bookings", "rosa", p))
        day, cur = b["date"], b["next_cursor"]
        out += b["items"]
        if not cur:
            return day, out
    pytest.fail("GET /api/desk/bookings never reached a null next_cursor")


DESK_FROM_H = 21
LAST_NEAR = "20:00"
ROOM_BY_MIN = 19 * 60 + 30


def has_today_room(base) -> bool:
    now = server_now(base).astimezone(zone(base))
    return now.hour * 60 + now.minute <= ROOM_BY_MIN


def need_today_room(base):
    if not has_today_room(base):
        pytest.fail("too late in this copy's club day: expected short() to pick a copy with room left today")


def ensure_today_rows(base, n):
    need_today_room(base)
    day, rows = desk_all(base)
    made = []
    today = server_now(base).astimezone(zone(base)).strftime("%Y-%m-%d")
    starts = [f"{today}T{h:02d}:00" for h in range(23, DESK_FROM_H - 1, -1)]
    for s in starts:
        for c in range(1, 8):
            if len(rows) + len(made) >= n:
                return made
            r = post(base, "/api/holds", {"court": c, "start": s, "minutes": 60}, "ines", idempotency_key())
            if r.status_code == 201:
                made.append(pay(base, r.json()))
    if len(rows) + len(made) < n:
        pytest.fail(f"could only make {len(rows) + len(made)} of {n} bookings on today's club date; expected room for all")
    return made


def late_today(base, user, minutes=60):
    need_today_room(base)
    now = server_now(base).astimezone(zone(base))
    starts = [s for s in soon_slots(base, 600, 6 * 3600, minutes)
              if s[:10] == now.strftime("%Y-%m-%d") and s[11:] <= LAST_NEAR]
    if not starts:
        pytest.fail("no free start left on today's club date in the next hours; expected one on the short-timer copy")
    random.shuffle(starts)
    return create(base, user, [(c, s) for s in starts[:6] for c in random.sample(range(1, 8), 7)], minutes, track=True)


def reach(base, m, before_s):
    cut = ts(m["cutoff_at"]) - timedelta(seconds=before_s)
    wait = (cut - server_now(base)).total_seconds() + 30
    eventually(lambda: server_now(base) >= cut, wait, "server clock never neared the cut-off")
    assert server_now(base) < ts(m["cutoff_at"]), "the cut-off passed before the join could reserve"


def rule(base):
    return ok(get(base, "/api/manager/cancellation-rule", "elena"))


def calls(wm, path):
    out = []
    for r in wm.requests(path=path):
        req = r.get("request", r)
        b = req.get("body") or "{}"
        if isinstance(b, str):
            try:
                b = json.loads(b)
            except ValueError:
                b = {}
        out.append(b)
    return out


def refs(wm, path, ref):
    return [b for b in calls(wm, path) if b.get("reference") == ref]


def auth_id(wm, delay_ms=0):
    a = f"auth_{uuid.uuid4().hex[:12]}"
    wm.stub("POST", "/v1/authorizations", status=201, json={"id": a, "status": "authorized"}, delay_ms=delay_ms)
    return a


def baseline_captures(wm):
    wm.stub("POST", "/v1/captures", status=201, json={"id": "cap_demo_0001", "status": "captured"})


def baseline_charges(wm, delay_ms=0):
    wm.stub("POST", "/v1/charges", status=201, json={"id": "chg_demo_0001", "status": "captured"}, delay_ms=delay_ms)


def mails(mail, subject, to=None, n=1, secs=40):
    def look():
        got = [m for m in mail.messages(settle=0.2) if m.get("Subject") == subject
               and (to is None or to in addresses(m.get("To")))]
        return got if len(got) >= n else None
    return eventually(look, secs, f"Mailpit never received {n} message(s) '{subject}' to {to}")


def pushes(ntfy, top, pred, n=1, secs=40):
    def look():
        got = [m for m in ntfy.messages(top, 0, timeout=1) if pred(m)]
        return got if len(got) >= n else None
    return eventually(look, secs, f"ntfy topic never got {n} matching push")


def share_tokens(mail, b):
    out = {}
    for s in b["shares"][1:]:
        u = s["player"]["username"]
        m = mails(mail, f"Your share: €{eur(s['amount_cents'])} for {label(b)}", EMAIL[u])[0]
        out[u] = re.search(r"/share/([^\s/?#\"<>]+)", text(m)).group(1)
    return out


def notices(base, **params):
    out, cur = [], None
    for _ in range(4):
        p = {"limit": PAGE_MAX, **params, **({"cursor": cur} if cur else {})}
        b = ok(get(base, "/api/desk/notices", "rosa", p))
        out += b["items"]
        cur = b["next_cursor"]
        if not cur:
            break
    return out


def opened(browser, url, **kw):
    cm = open_app(browser, url, **kw)
    return cm if hasattr(cm, "__enter__") else contextmanager(lambda: cm)()


def on_app_url(url, base):
    return same_origin(url, base) and not urlsplit(url).path.startswith(("/login", "/auth/"))


def on_app(page, base):
    return on_app_url(page.url, base)


def finish_login(page, base, user):
    pw = page.get_by_label("Password", exact=True)
    deadline = time.monotonic() + LOGIN_S
    while time.monotonic() < deadline:
        if on_app(page, base):
            with suppress(PWError):
                page.wait_for_load_state()
            try:
                page.wait_for_url(lambda u: not on_app_url(u, base), timeout=CLIENT_REDIRECT_MS)
            except PWTimeout:
                return
            continue
        with suppress(PWError):
            if pw.count() and pw.is_visible():
                page.get_by_label("Username").first.fill(user)
                pw.fill(PASSWORD)
                pw.press("Enter")
        with suppress(PWTimeout):
            page.wait_for_url(lambda u: same_origin(u, base), timeout=700)
    pytest.fail(f"sign-in as {user} never returned to the app; last URL {page.url}")


def sign_in(page, base, user, ret="/"):
    page.goto(f"{base}/login?return={quote(ret, safe='')}", timeout=LOGIN_S * 1000)
    finish_login(page, base, user)


def more_focus_kept(page, table):
    more = page.get_by_role("button", name="Load more bookings")
    if more.count():
        return more.is_enabled() and more.evaluate("b => b === document.activeElement")
    return page.get_by_role("table", name=table).get_by_role("row").last.evaluate(
        "r => r.contains(document.activeElement)")


def wait_ui(page, check_fn, msg, secs=UI_S, step=250):
    deadline = time.monotonic() + secs
    while time.monotonic() < deadline:
        if check_fn():
            return
        advance(page, step)
    pytest.fail(msg)


def listen(page):
    page.get_by_role("status", name="Announcements").evaluate(
        """el => { window.__ann = []; const rec = () => { const t = el.textContent.trim();
        if (window.__ann[window.__ann.length - 1] !== t) window.__ann.push(t); };
        new MutationObserver(rec).observe(el, {subtree: true, childList: true, characterData: true}); }""")


def heard(page):
    return page.evaluate("() => window.__ann || []")


def times_heard(page, words):
    n, prev = 0, False
    for t in heard(page):
        now = words in t
        n += now and not prev
        prev = now
    return n


def wait_heard(page, words, secs=UI_S):
    wait_ui(page, lambda: times_heard(page, words) > 0, f"status 'Announcements' never announced '{words}'", secs)


def cell(page, c, hhmm, state):
    return page.get_by_role("gridcell", name=f"Court {c}, {hhmm}, {state}", exact=True)


def dialog(page, c, hhmm):
    return page.get_by_role("dialog", name=f"Court {c} at {hhmm}")


def open_cell(page, c, hhmm, state="Free"):
    x = cell(page, c, hhmm, state)
    expect(x).to_be_visible(timeout=UI_S * 1000)
    x.click()
    expect(dialog(page, c, hhmm)).to_be_visible()
    return dialog(page, c, hhmm)


def timer_s(page):
    m = re.search(r"(\d+):(\d\d)", page.get_by_role("timer", name="Time left on hold").inner_text())
    return int(m.group(1)) * 60 + int(m.group(2))


def ui_hold(page, base, user, s, c):
    sign_in(page, base, user, f"/courts?day={s[:10]}")
    dlg = open_cell(page, c, s[11:])
    listen(page)
    dlg.get_by_role("button", name="Hold slot").click()
    expect(dlg.get_by_role("button", name="Pay now")).to_be_visible(timeout=UI_S * 1000)
    return dlg, grid_cell(base, c, s, user)


def history_row(page, start):
    table = page.get_by_role("table", name="Booking history")
    row = table.get_by_role("row").filter(has_text=start[:10]).filter(has_text=start[11:16])
    for _ in range(60):
        if row.count():
            return row.first
        more = page.get_by_role("button", name="Load more bookings")
        if not more.count() or not more.is_visible():
            wait_ui(page, lambda: row.count() or (more.count() and more.is_visible()),
                    f"Booking history never listed the {start} booking")
            if row.count():
                return row.first
            continue
        more.click()
        advance(page, 300)
    pytest.fail("Load more bookings kept paging without listing the booking")


def meter(card):
    return card.get_by_role("meter", name="Players").evaluate("e => Number(e.getAttribute('aria-valuenow') ?? e.value)")


def per_view(region, cards):
    r = region.bounding_box()
    n = 0
    for c in cards:
        b = c.bounding_box()
        n += bool(b and b["x"] >= r["x"] - 2 and b["x"] + b["width"] <= r["x"] + r["width"] + 2)
    return n


def match_name(m):
    return f"Court {m['court']}, {m['start'][:10]} {m['start'][11:16]}"


def checkin_name(row):
    return f"Check in {row['organiser_name']}, Court {row['court']} at {row['start'][11:16]}"


def noshow_name(row):
    return f"Mark no-show {row['organiser_name']}, Court {row['court']} at {row['start'][11:16]}"


def test_hold_needs_authorisation(app_url, wiremock):
    auth_id(wiremock)
    b = hold(app_url, "ines", minutes=90)
    cfg = club(app_url)
    assert b["status"] == "held" and b["minutes"] == 90 and b["organiser"]["username"] == "ines"
    assert ts(b["expires_at"]) - ts(b["created_at"]) == timedelta(seconds=cfg["hold_seconds"])
    assert 0 < b["remaining_ms"] <= cfg["hold_seconds"] * 1000
    assert b["total_cents"] == quote_of(app_url, b["court"], b["start"][:16], 90)["total_cents"]
    [a] = refs(wiremock, "/v1/authorizations", b["id"])
    assert a["amount_cents"] == b["total_cents"] and a["payer"] == EMAIL["ines"] and a["currency"] == "EUR"
    for st, js, status, code in [(402, {"id": "auth_x", "status": "declined"}, 402, "PAYMENT_DECLINED"),
                                 (201, {"id": "auth_x", "status": "pending"}, 502, "PAYMENT_NOT_CONFIRMED")]:
        wiremock.stub("POST", "/v1/authorizations", status=st, json=js)
        c, s = far_slot()
        err(post(app_url, "/api/holds", {"court": c, "start": s, "minutes": 60}, "ines", idempotency_key()), status, code)
        assert grid_cell(app_url, c, s)["state"] == "free"


def test_paid_only_on_capture(app_url, wiremock):
    a = auth_id(wiremock)
    b = hold(app_url)
    path = f"/api/bookings/{b['id']}/pay"
    wiremock.stub("POST", "/v1/captures", status=201, json={"id": "cap_x", "status": "pending"})
    err(post(app_url, path, {}, "ines", idempotency_key()), 502, "PAYMENT_NOT_CONFIRMED")
    wiremock.stub("POST", "/v1/captures", status=402, json={"id": "cap_x", "status": "declined"})
    err(post(app_url, path, {}, "ines", idempotency_key()), 402, "PAYMENT_DECLINED")
    assert booking(app_url, b["id"])["status"] == "held"
    baseline_captures(wiremock)
    p = pay(app_url, b)
    assert p["status"] == "paid" and p["shares"][0]["status"] == "paid"
    cap = refs(wiremock, "/v1/captures", b["id"])[-1]
    assert cap == {**cap, "authorization_id": a, "amount_cents": b["total_cents"], "final_capture": True}
    s = pay(app_url, hold(app_url, co=CO))
    cap = refs(wiremock, "/v1/captures", f"{s['id']}:1")[-1]
    assert cap["amount_cents"] == s["shares"][0]["amount_cents"] and cap["final_capture"] is False
    assert [x["status"] for x in s["shares"]] == ["paid", "due", "due", "due"]


def test_one_winner_per_slot(app_url, wiremock):
    a = auth_id(wiremock, delay_ms=1500)
    c, s = far_slot(150)
    s30 = (datetime.fromisoformat(s) + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M")
    racers = [("ines", s, 90), ("tomas", s, 60), ("noor", s30, 60), ("kai", s, 120), ("pablo", s30, 90)]
    with ThreadPoolExecutor(5) as ex:
        rs = list(ex.map(lambda r: post(app_url, "/api/holds", {"court": c, "start": r[1], "minutes": r[2]},
                                        r[0], idempotency_key()), racers))
    wins = [r for r in rs if r.status_code == 201]
    assert len(wins) == 1, [r.status_code for r in rs]
    for r in rs:
        if r is not wins[0]:
            err(r, 409, "SLOT_TAKEN")
    assert len(calls(wiremock, f"/v1/authorizations/{a}/void")) >= 1


def test_hold_survives_closed_tab(app_url, wiremock):
    wiremock.stub("POST", "/v1/authorizations", status=201, json={"id": "auth_demo_0001", "status": "authorized"},
                  delay_ms=SLOW_MS)
    slots = [far_slot() for _ in range(3)]
    for c, s in slots:
        with suppress(httpx.TimeoutException, httpx.TransportError):
            httpx.post(app_url + "/api/holds", json={"court": c, "start": s, "minutes": 60}, timeout=ABORT_S,
                       headers={**H("ines"), "Idempotency-Key": idempotency_key()})
    pg = Postgres()
    held_locks = ("select count(*) as n from pg_locks where locktype = 'relation' and granted "
                  "and database = (select oid from pg_database where datname = current_database()) "
                  "and pid <> pg_backend_pid() and mode in ('RowExclusiveLock', 'RowShareLock')")
    eventually(lambda: pg.rows(held_locks)[0]["n"] == 0, 2,
               "a backend kept row locks (an open transaction) while the provider call was still in flight")
    hs = club(app_url)["hold_seconds"]
    for c, s in slots:
        x = eventually(lambda: (lambda g: g if g["state"] == "held" and g["booking_id"] else None)(grid_cell(app_url, c, s)),
                       30, f"the accepted hold on Court {c} at {s} was never written")
        b = booking(app_url, x["booking_id"])
        assert b["status"] == "held" and ts(b["expires_at"]) - ts(b["created_at"]) == timedelta(seconds=hs)
    assert ok(get(app_url, "/api/health")) == {"status": "ok"}


def test_wf_hold_and_pay_happy(page, app_url, wiremock):
    c, s = far_slot()
    dlg, x = ui_hold(page, app_url, "ines", s, c)
    wait_heard(page, f"Slot held for {mmss(club(app_url)['hold_seconds'])}.")
    dlg.get_by_role("button", name="Pay now").click()
    wait_heard(page, "Payment received.")
    expect(cell(page, c, s[11:], "Your booking")).to_have_count(1, timeout=UI_S * 1000)
    b = booking(app_url, x["booking_id"])
    assert b["status"] == "paid" and refs(wiremock, "/v1/captures", b["id"])[-1]["final_capture"] is True


def test_wf_hold_and_pay_declined(page, app_url, wiremock):
    keys = []
    page.on("request", lambda r: keys.append(r.headers.get("idempotency-key"))
            if r.method == "POST" and r.url.endswith("/pay") else None)
    c, s = far_slot()
    dlg, x = ui_hold(page, app_url, "ines", s, c)
    wiremock.stub("POST", "/v1/captures", status=402, json={"id": "cap_x", "status": "declined"})
    with held(page, "**/pay") as h:
        dlg.get_by_role("button", name="Pay now").click()
        expect(dlg.get_by_role("button", name="Paying...")).to_be_disabled()
        expect(cell(page, c, s[11:], "Your hold")).to_have_count(1)
        h.release()
    expect(dlg.get_by_role("alert")).to_contain_text(MSG["PAYMENT_DECLINED"])
    expect(dlg.get_by_role("button", name="Pay now")).to_be_enabled()
    expect(cell(page, c, s[11:], "Your hold")).to_have_count(1)
    wiremock.fault("POST", "/v1/captures")
    dlg.get_by_role("button", name="Pay now").click()
    expect(dlg.get_by_role("alert")).to_contain_text(PAY_DOWN, timeout=UI_S * 1000)
    assert times_heard(page, "Payment received.") == 0 and booking(app_url, x["booking_id"])["status"] == "held"
    baseline_captures(wiremock)
    dlg.get_by_role("button", name="Pay now").click()
    wait_heard(page, "Payment received.")
    assert len(keys) == 3 and keys[1] != keys[0] and keys[2] == keys[1], keys
    assert booking(app_url, x["booking_id"])["status"] == "paid"


def test_session_draft_restore(page, app_url):
    c, s = far_slot()
    sign_in(page, app_url, "ines", f"/courts?day={s[:10]}")
    note = f"draft {uuid.uuid4().hex[:8]}"
    dlg = open_cell(page, c, s[11:])
    tick(dlg.get_by_role("radio", name="90 minutes"))
    dlg.get_by_role("textbox", name="Booking note").fill(note)
    navs, sent = [], []
    page.on("request", lambda r: navs.append(r.url) if r.is_navigation_request() and r.frame == page.main_frame else None)
    page.route("**/api/holds", lambda r: r.fulfill(status=401, content_type="application/json",
                                                   body=json.dumps({"code": "UNAUTHENTICATED", "message": MSG["UNAUTHENTICATED"]})))
    dlg.get_by_role("button", name="Hold slot").click()
    finish_login(page, app_url, "ines")
    page.unroute("**/api/holds")
    page.on("request", lambda r: sent.append(r.url) if r.method == "POST" and "/api/holds" in r.url else None)
    logins = [u for u in navs if urlsplit(u).path == "/login"]
    assert logins and parse_qs(urlsplit(logins[0]).query)["return"] == [f"/courts?day={s[:10]}&cell={c}-{s[11:]}"]
    expect(dlg.get_by_role("textbox", name="Booking note")).to_have_value(note, timeout=UI_S * 1000)
    expect(dlg.get_by_role("radio", name="90 minutes")).to_be_checked()
    assert focused_name(page) == "Hold slot" and sent == []
    page.route("**/api/holds", lambda r: r.fulfill(status=401, content_type="application/json",
                                                   body=json.dumps({"code": "UNAUTHENTICATED", "message": MSG["UNAUTHENTICATED"]})))
    note2 = f"other {uuid.uuid4().hex[:8]}"
    dialog(page, c, s[11:]).get_by_role("textbox", name="Booking note").fill(note2)
    page.context.clear_cookies(domain=urlsplit(oidc()["token_endpoint"]).hostname)
    dialog(page, c, s[11:]).get_by_role("button", name="Hold slot").click()
    finish_login(page, app_url, "tomas")
    page.unroute("**/api/holds")
    advance(page, 1000)
    expect(page.get_by_role("dialog")).to_have_count(0)
    assert note2 not in page.content() and note not in page.content()


def test_idempotent_payment_actions(app_url, wiremock):
    k, (c, s) = idempotency_key(), far_slot()
    body = {"court": c, "start": s, "minutes": 60}
    r1 = post(app_url, "/api/holds", body, "ines", k)
    b = ok(r1, 201)
    r2 = post(app_url, "/api/holds", body, "ines", k)
    assert r2.status_code == 201 and r2.json() == r1.json() and r2.headers.get("Idempotent-Replay") == "true"
    assert len(refs(wiremock, "/v1/authorizations", b["id"])) == 1
    err(post(app_url, "/api/holds", {**body, "minutes": 90}, "ines", k), 409, "IDEMPOTENCY_CONFLICT")
    c2, s2 = far_slot()
    r = post(app_url, "/api/holds", {"court": c2, "start": s2, "minutes": 60}, "tomas", k)
    assert ok(r, 201)["organiser"]["username"] == "tomas" and r.headers.get("Idempotent-Replay") != "true"
    path = f"/api/bookings/{b['id']}/pay"
    wiremock.stub("POST", "/v1/captures", status=402, json={"id": "cap_x", "status": "declined"})
    kp = idempotency_key()
    err(post(app_url, path, {}, "ines", kp), 402, "PAYMENT_DECLINED")
    baseline_captures(wiremock)
    r = post(app_url, path, {}, "ines", kp)
    err(r, 402, "PAYMENT_DECLINED")
    assert r.headers.get("Idempotent-Replay") == "true" and len(refs(wiremock, "/v1/captures", b["id"])) == 1
    wiremock.fault("POST", "/v1/captures")
    k3 = idempotency_key()
    err(post(app_url, path, {}, "ines", k3), 503, "PAYMENT_UNAVAILABLE", PAY_DOWN)
    baseline_captures(wiremock)
    r = post(app_url, path, {}, "ines", k3)
    assert ok(r)["status"] == "paid" and r.headers.get("Idempotent-Replay") != "true"
    c3, s3 = far_slot()
    field_err(post(app_url, "/api/holds", {"court": c3, "start": s3, "minutes": 60}, "ines", "x" * 101),
              "Idempotency-Key", "Use 1 to 100 visible characters.")


def test_wf_payment_outage_recovers(page, browser, app_url, wiremock):
    base = down("APP_COURTPAY_DOWN_URL")
    c, s = far_slot()
    with opened(browser, base) as p:
        sign_in(p, base, "ines", f"/courts?day={s[:10]}")
        dlg = open_cell(p, c, s[11:])
        dlg.get_by_role("textbox", name="Booking note").fill("outage")
        dlg.get_by_role("button", name="Hold slot").click()
        expect(dlg.get_by_role("alert")).to_contain_text(HOLD_DOWN, timeout=UI_S * 1000)
        expect(dlg.get_by_role("textbox", name="Booking note")).to_have_value("outage")
    assert grid_cell(base, c, s)["state"] == "free" and ok(get(base, "/api/health")) == {"status": "ok"}
    err(post(base, "/api/matches", {"court": c, "start": s, "minutes": 60, "level_min": 3.0, "level_max": 4.0},
             "ines", idempotency_key()), 503, "PAYMENT_UNAVAILABLE", PAY_DOWN)
    for m in ok(get(base, "/api/matches", None, {"level": "3.0"}))["items"]:
        if m["status"] == "open" and m["players"] < 4:
            err(join(base, m["id"], "kai"), 503, "PAYMENT_UNAVAILABLE", PAY_DOWN)
            assert ok(get(base, f"/api/matches/{m['id']}"))["players"] == m["players"]
            break
    wiremock.fault("POST", "/v1/authorizations")
    k, (c2, s2) = idempotency_key(), far_slot()
    err(post(app_url, "/api/holds", {"court": c2, "start": s2, "minutes": 60}, "ines", k), 503, "PAYMENT_UNAVAILABLE", HOLD_DOWN)
    auth_id(wiremock)
    b = ok(post(app_url, "/api/holds", {"court": c2, "start": s2, "minutes": 60}, "ines", k), 201)
    paid_b = pay(app_url, hold(app_url))
    wiremock.fault("POST", "/v1/captures")
    err(post(app_url, f"/api/bookings/{b['id']}/pay", {}, "ines", idempotency_key()), 503, "PAYMENT_UNAVAILABLE", PAY_DOWN)
    assert booking(app_url, paid_b["id"])["status"] == "paid"
    baseline_captures(wiremock)
    assert pay(app_url, b)["status"] == "paid"


@pytest.mark.timeout(300)
def test_owed_voids_reach_provider(app_url, wiremock):
    a = auth_id(wiremock)
    vpath = f"/v1/authorizations/{a}/void"
    wiremock.stub("POST", vpath, status=500, json={})
    b = hold(app_url)
    ok(post(app_url, f"/api/bookings/{b['id']}/release", {}, "ines"))
    eventually(lambda: len(calls(wiremock, vpath)) >= 1, 15, "no void was sent within 5 s of the release")
    t1 = time.monotonic()
    eventually(lambda: len(calls(wiremock, vpath)) >= 2, 75, "the failed void was not retried")
    assert time.monotonic() - t1 >= 20, "the void was retried well before 30 seconds"
    wiremock.stub("POST", vpath, status=200, json={"id": a, "status": "voided"})
    n = eventually(lambda: (lambda k: k if k >= 3 else None)(len(calls(wiremock, vpath))), 75, "the void was not retried")
    t2 = time.monotonic()
    eventually(lambda: time.monotonic() - t2 > 40, 45, "unreachable")
    assert len(calls(wiremock, vpath)) == n, "an accepted void was sent again"


@pytest.mark.parametrize("minutes", [60, 90, 120], ids=["60", "90", "120"])
def test_four_way_split(app_url, minutes):
    b = hold(app_url, minutes=minutes, co=CO)
    t, sh = b["total_cents"], b["shares"]
    assert [x["position"] for x in sh] == [1, 2, 3, 4] and sh[0]["player"]["username"] == "ines"
    assert {x["player"]["username"] for x in sh[1:]} == set(CO)
    assert all(x["amount_cents"] == t // 4 for x in sh[1:]) and sh[0]["amount_cents"] == t - 3 * (t // 4)
    assert sum(x["amount_cents"] for x in sh) == t
    assert quote_of(app_url, b["court"], b["start"][:16], minutes)["split_cents"] == [x["amount_cents"] for x in sh]
    c, s = far_slot(minutes)
    for co in (["tomas", "noor"], ["tomas", "noor", "ines"], ["tomas", "tomas", "kai"]):
        r = post(app_url, "/api/holds", {"court": c, "start": s, "minutes": minutes,
                                         "co_players": [EMAIL[x] for x in co]}, "ines", idempotency_key())
        field_err(r, "co_players", "Add exactly three club players, or none.")


def test_share_emails(app_url, mail):
    b = pay(app_url, hold(app_url, co=CO))
    st = ts(b["settle_at"]).astimezone(ZONE)
    links = set()
    for s in b["shares"][1:]:
        u = s["player"]["username"]
        subj = f"Your share: €{eur(s['amount_cents'])} for {label(b)}"
        mails(mail, subj, EMAIL[u])
        got = mails(mail, subj, EMAIL[u])
        assert len(got) == 1 and addresses(got[0].get("To")) == [EMAIL[u]]
        body = text(got[0])
        assert f"€{eur(s['amount_cents'])}" in body and NAMES["ines"] in body
        assert st.strftime("%Y-%m-%d") in body and st.strftime("%H:%M") in body
        links.add(re.search(r"/share/([^\s/?#\"<>]+)", body).group(1))
        for o in [x for x in CO if x != u] + ["ines"]:
            assert EMAIL[o] not in body
        for o in [x for x in CO if x != u]:
            assert NAMES[o] not in body
    assert len(links) == 3


def test_share_pay_only_on_charge(app_url, mail, wiremock):
    b = pay(app_url, hold(app_url, co=CO))
    tok = share_tokens(mail, b)
    pos = {x["player"]["username"]: x["position"] for x in b["shares"]}
    path = f"/api/shares/{tok['tomas']}/pay"
    sh = ok(get(app_url, f"/api/shares/{tok['tomas']}", "tomas"))
    assert sh["status"] == "due" and sh["kind"] == "booking" and sh["organiser_name"] == NAMES["ines"]
    err(post(app_url, path, {}, "noor", idempotency_key()), 404, "NOT_FOUND")
    wiremock.stub("POST", "/v1/charges", status=402, json={"id": "chg_x", "status": "declined"})
    err(post(app_url, path, {}, "tomas", idempotency_key()), 402, "PAYMENT_DECLINED")
    wiremock.stub("POST", "/v1/charges", status=201, json={"id": "chg_x", "status": "pending"})
    err(post(app_url, path, {}, "tomas", idempotency_key()), 502, "PAYMENT_NOT_CONFIRMED")
    assert ok(get(app_url, f"/api/shares/{tok['tomas']}", "tomas"))["status"] == "due"
    baseline_charges(wiremock)
    assert ok(post(app_url, path, {}, "tomas", idempotency_key()))["status"] == "paid"
    ch = refs(wiremock, "/v1/charges", f"{b['id']}:{pos['tomas']}")[-1]
    assert ch["payer"] == EMAIL["tomas"] and ch["amount_cents"] == sh["amount_cents"]
    assert [x["status"] for x in booking(app_url, b["id"])["shares"] if x["player"]["username"] == "tomas"] == ["paid"]
    err(post(app_url, path, {}, "tomas", idempotency_key()), 409, "ALREADY_PAID")


def test_wf_split_shares_return_path(page, app_url, mail):
    b = pay(app_url, hold(app_url, co=CO))
    t = share_tokens(mail, b)["noor"]
    page.goto(f"{app_url}/share/{t}")
    finish_login(page, app_url, "noor")
    assert urlsplit(page.url).path == f"/share/{t}"
    expect(page.get_by_role("heading", name="Your share")).to_be_visible()
    page.get_by_role("button", name="Pay my share").click()
    wait_ui(page, lambda: page.get_by_role("button", name="Pay my share").count() == 0, "Pay my share never left")
    assert ok(get(app_url, f"/api/shares/{t}", "noor"))["status"] == "paid"
    for bad in BAD_RETURNS:
        page.goto(f"{app_url}/login?return={quote(bad, safe='')}")
        finish_login(page, app_url, "noor")
        assert same_origin(page.url, app_url) and urlsplit(page.url).path == "/", (bad, page.url)
    good = "/courts?day=2027-03-28&cell=3-18:00"
    page.goto(f"{app_url}/login?return={quote(good, safe='')}")
    finish_login(page, app_url, "noor")
    u = urlsplit(page.url)
    assert u.path == "/courts" and parse_qs(u.query) == {"day": ["2027-03-28"], "cell": ["3-18:00"]}


def test_private_bookings_and_shares(app_url, mail):
    b = pay(app_url, hold(app_url, co=CO))
    t = share_tokens(mail, b)["kai"]
    bp = f"/api/bookings/{b['id']}"
    for u in ("tomas", "pablo"):
        err(get(app_url, bp, u), 404, "NOT_FOUND")
    err(get(app_url, UNKNOWN_BOOKING_PATH, "ines"), 404, "NOT_FOUND")
    assert ok(get(app_url, bp, "elena"))["total_cents"] == b["total_cents"]
    for u in ("rosa", "marta"):
        err(get(app_url, bp, u), 403, "FORBIDDEN")
    err(post(app_url, bp + "/pay", {}, "elena", idempotency_key()), 403, "FORBIDDEN")
    err(get(app_url, f"/api/shares/{t}", "noor"), 404, "NOT_FOUND")
    err(get(app_url, f"/api/shares/{t}", "ines"), 404, "NOT_FOUND")
    for u in ("elena", "rosa", "marta"):
        err(get(app_url, f"/api/shares/{t}", u), 403, "FORBIDDEN")


@pytest.mark.timeout(5400)
def test_wf_split_shares_journey(browser, mail, wiremock):
    base = short()
    cfg = club(base)
    b = pay(base, near(base, "ines", cfg["share_settle_seconds"] + 90, co=CO))
    tok = share_tokens(mail, b)
    with opened(browser, f"{base}/share/{tok['tomas']}") as p:
        finish_login(p, base, "tomas")
        assert urlsplit(p.url).path == f"/share/{tok['tomas']}"
        p.get_by_role("button", name="Pay my share").click()
        wait_ui(p, lambda: p.get_by_role("button", name="Pay my share").count() == 0, "Pay my share never resolved")
    assert ok(post(base, f"/api/shares/{tok['noor']}/pay", {}, "noor", idempotency_key()))["status"] == "paid"
    with opened(browser, base) as p:
        sign_in(p, base, "ines", f"/bookings/{b['id']}")
        navs = []
        p.on("framenavigated", lambda f: navs.append(f.url) if f == p.main_frame else None)
        table = p.get_by_role("table", name="Shares")
        row = lambda u: table.get_by_role("row").filter(has_text=NAMES[u])
        wait_ui(p, lambda: "Covered" in row("kai").inner_text(), "Kai's share never read Covered without a reload",
                secs=cfg["share_settle_seconds"] + 150)
        for u in ("ines", "tomas", "noor"):
            expect(row(u)).to_contain_text("Paid")
        assert navs == []
    kai = [x for x in booking(base, b["id"])["shares"] if x["player"]["username"] == "kai"][0]
    assert kai["status"] == "covered"
    assert refs(wiremock, "/v1/captures", f"{b['id']}:{kai['position']}")[-1]["final_capture"] is True


def test_share_guarantee(app_url, mail, wiremock):
    a = auth_id(wiremock)
    b = hold(app_url, co=CO)
    assert refs(wiremock, "/v1/authorizations", b["id"])[-1]["amount_cents"] == b["total_cents"]
    b = pay(app_url, b)
    cap = refs(wiremock, "/v1/captures", f"{b['id']}:1")[-1]
    assert cap["authorization_id"] == a and cap["amount_cents"] == b["shares"][0]["amount_cents"]
    assert cap["final_capture"] is False and refs(wiremock, "/v1/captures", b["id"]) == []
    tok = share_tokens(mail, b)
    vpath = f"/v1/authorizations/{a}/void"
    for u in CO:
        assert calls(wiremock, vpath) == [], "the guarantee was voided while a share was still due"
        ok(post(app_url, f"/api/shares/{tok[u]}/pay", {}, u, idempotency_key()))
    eventually(lambda: len(calls(wiremock, vpath)) == 1, 20, "the guarantee was not voided once no share was due")


@pytest.mark.timeout(5400)
def test_share_settlement(mail, ntfy, wiremock):
    base = short()
    cfg = club(base)
    b = pay(base, near(base, "ines", cfg["share_settle_seconds"] + 50, co=CO))
    tok = share_tokens(mail, b)
    ok(post(base, f"/api/shares/{tok['tomas']}/pay", {}, "tomas", idempotency_key()))
    late = sorted((x for x in b["shares"][1:] if x["player"]["username"] != "tomas"), key=lambda x: x["position"])
    r1, r2 = (f"{b['id']}:{x['position']}" for x in late)
    wiremock.stub("POST", "/v1/captures", status=500, json={})
    wait_s = (ts(b["settle_at"]) - server_now(base)).total_seconds() + 20
    eventually(lambda: refs(wiremock, "/v1/captures", r1), wait_s, "no settlement capture was sent at the instant")
    assert refs(wiremock, "/v1/captures", r2) == [], "a later share was captured before the earlier one was accepted"
    kai_tok = tok["kai"]
    err(post(base, f"/api/shares/{kai_tok}/pay", {}, "kai", idempotency_key()), 409, "SHARE_SETTLED")
    baseline_captures(wiremock)
    eventually(lambda: all(x["status"] == "covered" for x in booking(base, b["id"])["shares"]
                           if x["player"]["username"] != "tomas" and x["position"] > 1), 50, "shares never became covered")
    assert all(c["final_capture"] is False for c in refs(wiremock, "/v1/captures", r1))
    assert refs(wiremock, "/v1/captures", r2)[-1]["final_capture"] is True
    assert ok(get(base, f"/api/shares/{kai_tok}", "kai"))["status"] == "covered"
    total = sum(x["amount_cents"] for x in late)
    m = mails(mail, f"Shares covered: {label(b)}", EMAIL["ines"])[0]
    assert f"€{eur(total)} for 2 unpaid shares was charged to your card." in text(m)
    pushes(ntfy, topic(base, "ines"), lambda x: x.get("title") == "Shares covered"
           and x.get("message") == f"{label(b)}. Unpaid shares were charged to your card.")


@pytest.mark.timeout(600)
def test_guarantee_refresh(mail, wiremock):
    base = short()
    R = club(base)["auth_refresh_seconds"]
    a1 = auth_id(wiremock)
    b = pay(base, hold(base, co=CO))
    due = sum(x["amount_cents"] for x in b["shares"][1:])
    wiremock.stub("POST", "/v1/authorizations", status=402, json={"id": "auth_x", "status": "declined"})
    g2 = eventually(lambda: refs(wiremock, "/v1/authorizations", f"{b['id']}:g2"), R + 20, "no guarantee refresh was sent")
    assert g2[0]["amount_cents"] == due and g2[0]["payer"] == EMAIL["ines"]
    assert calls(wiremock, f"/v1/authorizations/{a1}/void") == [], "the old guarantee was voided before a new one was accepted"
    a2 = auth_id(wiremock)
    eventually(lambda: len(calls(wiremock, f"/v1/authorizations/{a1}/void")) == 1, 50, "the superseded guarantee was not voided")
    assert len(refs(wiremock, "/v1/authorizations", f"{b['id']}:g2")) >= 2
    a3 = auth_id(wiremock)
    tok = share_tokens(mail, b)
    paid = ok(post(base, f"/api/shares/{tok['tomas']}/pay", {}, "tomas", idempotency_key()))["amount_cents"]
    g3 = eventually(lambda: refs(wiremock, "/v1/authorizations", f"{b['id']}:g3"), R + 25, "no second refresh was sent")
    assert g3[0]["amount_cents"] == due - paid
    eventually(lambda: len(calls(wiremock, f"/v1/authorizations/{a2}/void")) == 1, 20, "guarantee g2 was not voided")
    for u in ("noor", "kai"):
        ok(post(base, f"/api/shares/{tok[u]}/pay", {}, u, idempotency_key()))
    eventually(lambda: len(calls(wiremock, f"/v1/authorizations/{a3}/void")) == 1, 20, "the last guarantee was not voided")


@pytest.mark.timeout(300)
def test_hold_released_on_server_clock(wiremock):
    base = short()
    hs = club(base)["hold_seconds"]
    a = auth_id(wiremock)
    b = hold(base)
    exp = ts(b["expires_at"])
    assert exp - ts(b["created_at"]) == timedelta(seconds=hs)

    def read():
        x = booking(base, b["id"])
        now = ts(x["server_now"])
        if x["status"] == "held":
            assert now < exp and abs(x["remaining_ms"] - (exp - now).total_seconds() * 1000) <= TICK_MS
            return None
        assert now >= exp and x["remaining_ms"] is None
        return x
    rel = eventually(read, hs + 15, "the hold never read released")
    assert rel["status"] == "released" and all(s["status"] == "void" for s in rel["shares"])
    err(post(base, f"/api/bookings/{b['id']}/pay", {}, "ines", idempotency_key()), 409, "HOLD_EXPIRED")
    assert refs(wiremock, "/v1/captures", b["id"]) == []
    eventually(lambda: calls(wiremock, f"/v1/authorizations/{a}/void"), 15, "no void within 5 s of expiry")
    b2 = hold(base)
    eventually(lambda: booking(base, b2["id"])["remaining_ms"] <= 4000, hs + 5, "hold never neared its end")
    wiremock.stub("POST", "/v1/captures", status=201, json={"id": "cap_late", "status": "captured"}, delay_ms=6000)
    err(post(base, f"/api/bookings/{b2['id']}/pay", {}, "ines", idempotency_key()), 409, "HOLD_EXPIRED")
    assert booking(base, b2["id"])["status"] == "released"
    e = [x for x in credits(base, "ines")["entries"] if x["booking_id"] == b2["id"]]
    assert [(x["reason"], x["amount_cents"]) for x in e] == [("late_capture", b2["total_cents"])]


@pytest.mark.timeout(300)
def test_countdown_halo(page, browser, app_url):
    c, s = far_slot()
    dlg, x = ui_hold(page, app_url, "ines", s, c)
    rings = page.locator("[data-halo-remaining]")
    expect(rings).to_have_count(2)
    hs = club(app_url)["hold_seconds"]
    r_server = booking(app_url, x["booking_id"])["remaining_ms"] / (hs * 1000)
    vals = [rings.nth(i).get_attribute("data-halo-remaining") for i in range(2)]
    assert all(re.fullmatch(r"[01]\.\d{3}", v) and abs(float(v) - r_server) <= 0.02 for v in vals), vals
    assert {rings.nth(i).get_attribute("data-halo-tone") for i in range(2)} == {"lime"}
    advance(page, 3000)
    assert float(rings.first.get_attribute("data-halo-remaining")) < float(vals[0])
    base = short()
    c2, s2 = far_slot()
    with opened(browser, base) as p:
        ui_hold(p, base, "ines", s2, c2)
        ring = p.locator("[data-halo-remaining]")
        assert {ring.nth(i).get_attribute("data-halo-tone") for i in range(ring.count())} == {"ink"}
        wait_ui(p, lambda: ring.count() == 0 and cell(p, c2, s2[11:], "Free").count() == 1,
                "the halo did not vanish and the cell did not read Free at zero", secs=60)


@pytest.mark.timeout(300)
def test_countdown_halo_reduced_motion(browser, app_url):
    c, s = far_slot()
    with opened(browser, app_url, reduced_motion="reduce") as p:
        _, x = ui_hold(p, app_url, "ines", s, c)
        ring = p.locator("[data-halo-segments]")
        expect(ring).to_have_count(2)
        rem = booking(app_url, x["booking_id"])["remaining_ms"]
        assert ring.first.get_attribute("data-halo-segments") == str(min(10, math.ceil(rem / 60000)))
        assert all(a.get("duration", 0) < 20 for a in animations(ring.first))
        t1 = timer_s(p)
        advance(p, 2000)
        assert 1 <= t1 - timer_s(p) <= 3
    base = short()
    c2, s2 = far_slot()
    with opened(browser, base, reduced_motion="reduce") as p:
        ui_hold(p, base, "ines", s2, c2)
        assert p.locator("[data-halo-segments]").first.get_attribute("data-halo-segments") == "1"
        wait_heard(p, "Hold released.", secs=60)


def test_server_time_on_screen(browser, app_url):
    c, s = far_slot()
    m = far_match(app_url, "noor", (3.0, 4.0))
    with opened(browser, app_url) as p:
        p.clock.set_system_time(server_now(app_url) + timedelta(hours=5))
        _, x = ui_hold(p, app_url, "ines", s, c)
        rem = booking(app_url, x["booking_id"])["remaining_ms"] / 1000
        assert rem - 4 <= timer_s(p) <= rem + 1
        expect(cell(p, c, s[11:], "Your hold")).to_have_count(1)
        p.clock.set_system_time(server_now(app_url) - timedelta(hours=5))
        advance(p, 1000)
        assert timer_s(p) <= rem + 1
        p.clock.set_system_time(ts(m["cutoff_at"]) + timedelta(hours=1))
        p.goto(f"{app_url}/matches?level=3.0&day={m['start'][:10]}")
        card = p.get_by_role("article", name=match_name(m))
        expect(card).to_contain_text("Open", timeout=UI_S * 1000)
        expect(card.get_by_role("button", name="Join match")).to_be_visible()


@pytest.mark.timeout(300)
def test_wf_hold_expiry_release(page, browser, app_url, mail, ntfy):
    base = short()
    c, s = far_slot()
    with opened(browser, base) as p:
        _, x = ui_hold(p, base, "ines", s, c)
        wait_heard(p, "Hold released.", secs=60)
        expect(cell(p, c, s[11:], "Free")).to_have_count(1)
    lab = f"Court {c}, {s[:10]} {s[11:]}"
    mails(mail, f"Hold released: {lab}", EMAIL["ines"])
    pushes(ntfy, topic(base, "ines"), lambda m: m.get("title") == "Hold released" and m.get("message") == lab)
    c2, s2 = far_slot()
    dlg, y = ui_hold(page, app_url, "ines", s2, c2)
    dlg.get_by_role("button", name="Release hold").click()
    wait_heard(page, "Hold released.")
    expect(cell(page, c2, s2[11:], "Free")).to_have_count(1, timeout=UI_S * 1000)
    assert booking(app_url, y["booking_id"])["status"] == "released"
    mails(mail, f"Hold released: Court {c2}, {s2[:10]} {s2[11:]}", EMAIL["ines"])


def test_open_match_creation(app_url, wiremock):
    m = far_match(app_url, "noor", (3.5, 4.5))
    assert m["players"] == 1 and m["joined"] is True and m["status"] == "open"
    cfg = club(app_url)
    assert ts(m["cutoff_at"]) == ts(m["start_utc"]) - timedelta(seconds=cfg["match_cutoff_seconds"])
    [ch] = refs(wiremock, "/v1/charges", m["id"])
    assert ch["payer"] == EMAIL["noor"] and ch["amount_cents"] >= m["share_cents"] and ch["amount_cents"] - m["share_cents"] <= 3
    c, s = far_slot()
    for lv in ((5.0, 6.0), (3.3, 4.0), (4.5, 3.5)):
        r = post(app_url, "/api/matches", {"court": c, "start": s, "minutes": 60, "level_min": lv[0], "level_max": lv[1]},
                 "noor", idempotency_key())
        err(r, 422, "VALIDATION")
    wiremock.stub("POST", "/v1/charges", status=402, json={"id": "chg_x", "status": "declined"})
    err(post(app_url, "/api/matches", {"court": c, "start": s, "minutes": 60, "level_min": 3.5, "level_max": 4.5},
             "noor", idempotency_key()), 402, "PAYMENT_DECLINED")
    assert grid_cell(app_url, c, s)["state"] == "free"
    base = short()
    near_starts = soon_slots(base, 10, 130)
    if not near_starts:
        pytest.fail("soon_slots found no start inside the window; expected the short-timer copy to offer one")
    s2 = near_starts[0]
    field_err(post(base, "/api/matches", {"court": 1, "start": s2, "minutes": 60, "level_min": 3.5, "level_max": 4.5},
                   "noor", idempotency_key()), "start", "Too late to open a match for this time.")


def test_join_by_level(app_url, wiremock):
    m = far_match(app_url, "noor", (3.0, 4.0))
    j = ok(join(app_url, m["id"], "kai"))
    assert j["joined"] is True and j["players"] == 2
    ch = [x for x in refs(wiremock, "/v1/charges", m["id"]) if x["payer"] == EMAIL["kai"]]
    assert [x["amount_cents"] for x in ch] == [m["share_cents"]]
    field_err(join(app_url, m["id"], "pablo"), "level", "Your level is outside this match's range.")
    assert not [x for x in refs(wiremock, "/v1/charges", m["id"]) if x["payer"] == EMAIL["pablo"]]
    err(join(app_url, m["id"], "kai"), 409, "ALREADY_JOINED")
    assert ok(get(app_url, f"/api/matches/{m['id']}"))["players"] == 2


def test_one_winner_last_place(app_url, wiremock):
    m = far_match(app_url, "pablo", (2.0, 4.0))
    for u in ("tomas", "ines"):
        ok(join(app_url, m["id"], u))
    baseline_charges(wiremock, delay_ms=1500)
    with ThreadPoolExecutor(2) as ex:
        rs = dict(zip(("kai", "noor"), ex.map(lambda u: join(app_url, m["id"], u), ("kai", "noor"))))
    wins = [u for u, r in rs.items() if r.status_code == 200]
    assert len(wins) == 1, {u: r.status_code for u, r in rs.items()}
    loser = ({"kai", "noor"} - set(wins)).pop()
    err(rs[loser], 409, "MATCH_FULL")
    assert not [x for x in refs(wiremock, "/v1/charges", m["id"]) if x["payer"] == EMAIL[loser]]
    assert len(refs(wiremock, "/v1/charges", m["id"])) == 4
    assert ok(get(app_url, f"/api/matches/{m['id']}"))["status"] == "full"


def test_join_attempt_limit():
    base = down("APP_PUSH_DOWN_URL")
    rs = [join(base, "mt_probe_unknown", "lucia") for _ in range(JOIN_LIMIT + 1)]
    for r in rs[:JOIN_LIMIT]:
        err(r, 404, "NOT_FOUND")
    err(rs[-1], 429, "RATE_LIMITED")
    assert 1 <= int(rs[-1].headers["Retry-After"]) <= RETRY_AFTER_MAX


def test_match_full_notice(mail, ntfy):
    base = short()
    need_today_room(base)
    today = server_now(base).astimezone(zone(base)).strftime("%Y-%m-%d")
    starts = [s for s in soon_slots(base, 600, 5 * 3600) if s[:10] == today and s[11:] <= LAST_NEAR]
    if not starts:
        pytest.fail("no free start left on today's club date in the next hours; expected one on the short-timer copy")
    random.shuffle(starts)
    m = create(base, "ines", [(c, s) for s in starts[:6] for c in random.sample(range(1, 8), 7)], 60, levels=(3.0, 4.0))
    for u in ("tomas", "noor", "kai"):
        ok(join(base, m["id"], u))
    f = ok(get(base, f"/api/matches/{m['id']}", "ines"))
    assert f["status"] == "full" and f["players"] == 4 and f["booking_id"]
    _, rows = desk_all(base)
    row = [r for r in rows if r["id"] == f["booking_id"]]
    assert row and row[0]["kind"] == "match" and row[0]["status"] == "paid" and row[0]["players"] == 4
    lab = label(m)
    pushes(ntfy, "yardline-desk", lambda x: x.get("title") == "Match full"
           and x.get("message") == f"{lab} is full. Release it for check-in.")
    for u in ("ines", "tomas", "noor", "kai"):
        mails(mail, f"Match full: {lab}", EMAIL[u])
    pushes(ntfy, topic(base, "kai"), lambda x: x.get("title") == "Match full" and x.get("message") == lab)


def test_open_match_carousel(page, app_url):
    day = far_slot()[1][:10]
    ms = [far_match(app_url, "noor", (3.0, 4.0), slot=(c, f"{day}T{10 + c:02d}:00")) for c in (1, 2, 3, 4)]
    page.set_viewport_size({"width": 1280, "height": 900})
    sign_in(page, app_url, "kai", f"/matches?level=3.0&day={day}")
    region = page.get_by_role("region", name="Open matches")
    cards = [region.get_by_role("article", name=match_name(m)) for m in ms]
    expect(cards[3]).to_have_count(1, timeout=UI_S * 1000)
    assert per_view(region, cards) == 3
    prev, nxt = page.get_by_role("button", name="Previous matches"), page.get_by_role("button", name="Next matches")
    expect(prev).to_be_disabled()
    nxt.click()
    expect(page.get_by_role("button", name="Page 2")).to_have_attribute("aria-current", "true")
    expect(nxt).to_be_disabled()
    page.get_by_role("button", name="Page 1").click()
    expect(page.get_by_role("button", name="Page 1")).to_have_attribute("aria-current", "true")
    card = cards[0]
    expect(card).to_contain_text("1 of 4 players")
    assert meter(card) == 1
    card.get_by_role("button", name="Join match").click()
    joined = card.get_by_role("button", name="Joined")
    expect(joined).to_be_visible(timeout=UI_S * 1000)
    assert focused_name(page) == "Joined" and joined.get_attribute("aria-disabled") == "true"
    expect(card).to_contain_text("2 of 4 players")
    assert meter(card) == 2
    ok(join(app_url, ms[0]["id"], "tomas"))
    wait_ui(page, lambda: "3 of 4 players" in card.inner_text(), "the card did not update in place on refresh", step=1000)
    assert meter(card) == 3 and focused_name(page) == "Joined"
    expect(page.get_by_role("button", name="Page 1")).to_have_attribute("aria-current", "true")
    for w, n in ((834, 2), (390, 1)):
        page.set_viewport_size({"width": w, "height": 900})
        page.reload()
        expect(cards[3]).to_have_count(1, timeout=UI_S * 1000)
        assert per_view(region, cards) == n, w


def test_wf_open_match_join_journey(page, app_url, mail, ntfy):
    cands = []
    now = server_now(app_url).astimezone(ZONE).date()
    for _ in range(25):
        c, s = far_slot()
        cands.append((c, f"{now + timedelta(days=random.randint(3, 6))}{s[10:]}"))
    m = create(app_url, "noor", cands, 60, levels=(3.0, 4.0))
    for u in ("tomas", "ines"):
        ok(join(app_url, m["id"], u))
    sign_in(page, app_url, "kai", "/")
    pill = page.get_by_role("search", name="Find a match")
    select(pill.get_by_role("combobox", name="Level"), "3.0")
    select(pill.get_by_role("combobox", name="Day"), m["start"][:10])
    pill.get_by_role("button", name="Find matches").click()
    page.wait_for_url(re.compile(r"/matches\?"))
    q = parse_qs(urlsplit(page.url).query)
    assert q.get("level") == ["3.0"] and q.get("day") == [m["start"][:10]]
    card = page.get_by_role("region", name="Open matches").get_by_role("article", name=match_name(m))
    expect(card).to_contain_text("3 of 4 players", timeout=UI_S * 1000)
    listen(page)
    card.get_by_role("button", name="Join match").click()
    wait_heard(page, "Match is full.")
    log = heard(page)
    first_join = next(i for i, t in enumerate(log) if "You joined the match." in t)
    assert first_join <= next(i for i, t in enumerate(log) if "Match is full." in t)
    assert ok(get(app_url, f"/api/matches/{m['id']}", "kai"))["status"] == "full"
    mails(mail, f"Match full: {label(m)}", EMAIL["kai"])
    pushes(ntfy, "yardline-desk", lambda x: x.get("message") == f"{label(m)} is full. Release it for check-in.")


def phrase(sec):
    for unit, n in (("hour", 3600), ("minute", 60), ("second", 1)):
        if sec % n == 0:
            k = sec // n
            return f"{k} {unit}{'' if k == 1 else 's'}"


def test_wf_open_match_home_sections(page, app_url):
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(app_url + "/")
    banner = page.get_by_role("banner")
    nav = banner.get_by_role("navigation", name="Main")
    for n in ("Courts", "Matches", "My bookings"):
        expect(nav.get_by_role("link", name=n)).to_be_visible()
    expect(banner.get_by_role("link", name="Sign in")).to_be_visible()
    h1 = page.get_by_role("heading", level=1)
    expect(h1).to_contain_text("Hold your court. Split the bill. Be on time.")
    assert h1.evaluate("""h => { const w = document.createTreeWalker(h, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) if (n.textContent.includes('Split the bill.')) return getComputedStyle(n.parentElement).fontStyle;
        return ''; }""") == "italic"
    expect(page.get_by_text("Seven courts at Marlowe Yard. Hold a slot, send each friend their share, and find a match at your level.")).to_be_visible()
    pill = page.get_by_role("search", name="Find a match")
    for r, n in (("combobox", "Level"), ("combobox", "Day"), ("button", "Find matches")):
        expect(pill.get_by_role(r, name=n)).to_be_visible()
    expect(page.get_by_role("img", name="Court illustration")).to_be_visible()
    expect(page.get_by_role("heading", name="How a hold works")).to_be_visible()
    for t, body in (("Hold it", "Pick a free cell and it is yours while the halo runs."),
                    ("Split it", "Add three friends and each one gets their own share by email."),
                    ("Play it", "Show up, check in at the desk, and play.")):
        expect(page.get_by_role("article").filter(has=page.get_by_role("heading", name=t))).to_contain_text(body)
    cfg = club(app_url)
    sentence = (f"Holds last {phrase(cfg['hold_seconds'])}, unpaid shares go on the organiser's card "
                f"{phrase(cfg['share_settle_seconds'])} before start, open matches close {phrase(cfg['match_cutoff_seconds'])} "
                f"before start, and cancelling up to {phrase(cfg['free_cancel_seconds'])} ahead is free.")
    expect(page.get_by_role("heading", name="House rules")).to_be_visible()
    expect(page.get_by_text(sentence).first).to_be_visible()
    for name, lv, line in (("Marta Sol", "Coach, levels 1.0 to 4.0", "Patient drills for new and returning players."),
                           ("Owen Pryce", "Coach, levels 3.5 to 7.0", "Match tactics for competitive pairs.")):
        art = page.get_by_role("article", name=name)
        expect(art).to_contain_text(lv)
        expect(art).to_contain_text(line)
    foot = page.get_by_role("contentinfo")
    expect(foot).to_contain_text("Marlowe Yard Padel Club")
    expect(foot).to_contain_text("© 2026 Marlowe Yard Padel Club")
    page.evaluate("() => window.scrollTo(0, document.body.scrollHeight / 2)")
    assert abs(banner.bounding_box()["y"]) <= 1, "the club sticky header bar left the top while scrolling"
    page.set_viewport_size({"width": 390, "height": 844})
    page.reload()
    layout(page)
    expect(page.get_by_role("img", name="Court illustration")).not_to_be_in_viewport()
    expect(page.get_by_role("button", name="Menu")).to_be_visible()


@pytest.mark.timeout(4900)
def test_cutoff_cancellation(wiremock):
    base = short()
    L = club(base)["match_cutoff_seconds"]
    m = near(base, "noor", L + 25, levels=(3.0, 4.0))
    ok(join(base, m["id"], "kai"))
    cut = ts(m["cutoff_at"])
    assert cut == ts(m["start_utc"]) - timedelta(seconds=L)

    def read():
        x = ok(get(base, f"/api/matches/{m['id']}"))
        now = ts(x["server_now"])
        if x["status"] == "open":
            assert now < cut
            return None
        assert x["status"] == "cancelled" and now >= cut
        return x
    eventually(read, (cut - server_now(base)).total_seconds() + 30, "the stalled match never read cancelled at its cut-off")
    err(join(base, m["id"], "tomas"), 409, "MATCH_CLOSED")
    assert len(refs(wiremock, "/v1/charges", m["id"])) == 2


@pytest.mark.timeout(4900)
def test_cutoff_credits_and_notices(mail, ntfy):
    base = short()
    L = club(base)["match_cutoff_seconds"]
    m = near(base, "ines", L + 20, levels=(3.0, 4.0))
    ok(join(base, m["id"], "tomas"))
    eventually(lambda: ok(get(base, f"/api/matches/{m['id']}"))["status"] == "cancelled",
               (ts(m["cutoff_at"]) - server_now(base)).total_seconds() + 30, "match never cancelled")
    lab = label(m)
    paid = {"tomas": m["share_cents"]}
    tops = {}
    for u in ("ines", "tomas"):
        e = eventually(lambda: [x for x in credits(base, u)["entries"] if x["match_id"] == m["id"]], 20,
                       f"{u} was not credited within 5 s of the cancellation")
        assert len(e) == 1 and e[0]["reason"] == "match_cancelled"
        if u in paid:
            assert e[0]["amount_cents"] == paid[u]
        tops[u] = topic(base, u)
        assert re.fullmatch(r"yardline-p-[a-z0-9]{24}", tops[u])
        msg = pushes(ntfy, tops[u], lambda x: x.get("title") == "Match cancelled")[0]["message"]
        assert msg == f"{lab}. Credit added to your Yardline account." and "€" not in msg
        body = text(mails(mail, f"Match cancelled: {lab}", EMAIL[u])[0])
        assert f"€{eur(e[0]['amount_cents'])} is now in your Yardline credits." in body
    assert tops["ines"] != tops["tomas"]


@pytest.mark.timeout(5100)
def test_wf_match_cutoff_reserved_place(wiremock):
    base = short()
    L = club(base)["match_cutoff_seconds"]
    a = near(base, "noor", L + 25, levels=(2.0, 4.0))
    for u in ("tomas", "ines"):
        ok(join(base, a["id"], u))
    baseline_charges(wiremock, delay_ms=7500)
    reach(base, a, 4)
    with ThreadPoolExecutor(1) as ex:
        fut = ex.submit(join, base, a["id"], "kai")
        eventually(lambda: ok(get(base, f"/api/matches/{a['id']}"))["players"] == 4, 3, "the reserved place was not counted")
        eventually(lambda: server_now(base) >= ts(a["cutoff_at"]), 15, "cut-off not reached")
        assert not fut.done(), "the charge finished before the cut-off, so it did not straddle it"
        x = ok(get(base, f"/api/matches/{a['id']}"))
        assert x["status"] in ("open", "full") and x["players"] == 4
        assert ok(fut.result())["joined"] is True
    assert ok(get(base, f"/api/matches/{a['id']}"))["status"] == "full"
    assert not [e for e in credits(base, "noor")["entries"] if e["match_id"] == a["id"]]
    bm = near(base, "ines", L + 40, levels=(2.0, 4.0))
    baseline_charges(wiremock)
    for u in ("tomas", "noor"):
        ok(join(base, bm["id"], u))
    wiremock.stub("POST", "/v1/charges", status=402, json={"id": "chg_x", "status": "declined"}, delay_ms=7500)
    reach(base, bm, 4)
    with ThreadPoolExecutor(1) as ex:
        fut = ex.submit(join, base, bm["id"], "pablo")
        eventually(lambda: ok(get(base, f"/api/matches/{bm['id']}"))["players"] == 4, 3, "reservation not counted")
        err(fut.result(), 402, "PAYMENT_DECLINED")
    assert server_now(base) >= ts(bm["cutoff_at"])
    eventually(lambda: ok(get(base, f"/api/matches/{bm['id']}"))["status"] == "cancelled", 10, "B was not cancelled")
    assert not [e for e in credits(base, "pablo")["entries"] if e["match_id"] == bm["id"]]


@pytest.mark.timeout(5100)
def test_wf_match_cutoff_journey(browser, mail, ntfy, wiremock):
    base = short()
    L = club(base)["match_cutoff_seconds"]
    m = near(base, "noor", L + 60, levels=(3.0, 4.0))
    ok(join(base, m["id"], "kai"))
    with opened(browser, base) as p:
        p.set_viewport_size({"width": 1280, "height": 900})
        sign_in(p, base, "noor", "/matches")
        card = p.get_by_role("article", name=match_name(m))
        expect(card).to_have_count(1, timeout=UI_S * 1000)
        card.get_by_role("button", name="Joined").focus()
        dots = p.get_by_role("button", name=re.compile(r"^Page \d+$"))
        active = [dots.nth(i).get_attribute("aria-label") or dots.nth(i).inner_text() for i in range(dots.count())
                  if dots.nth(i).get_attribute("aria-current") == "true"]
        listen(p)
        wait_ui(p, lambda: "Cancelled" in card.inner_text(), "the card never read Cancelled in place", secs=150, step=1000)
        for _ in range(4):
            advance(p, REFRESH_MS)
        assert times_heard(p, "Match cancelled.") == 1 and focused_name(p) == "Joined"
        now_active = [dots.nth(i).get_attribute("aria-label") or dots.nth(i).inner_text() for i in range(dots.count())
                      if dots.nth(i).get_attribute("aria-current") == "true"]
        assert now_active == active
    assert [e["reason"] for e in credits(base, "noor")["entries"] if e["match_id"] == m["id"]] == ["match_cancelled"]
    pushes(ntfy, topic(base, "noor"), lambda x: x.get("title") == "Match cancelled" and label(m) in x.get("message", ""))
    mails(mail, f"Match cancelled: {label(m)}", EMAIL["noor"])


def test_booking_state_machine(app_url):
    path = lambda b, a: f"/api/bookings/{b['id']}/{a}"
    h = hold(app_url)
    err(post(app_url, path(h, "cancel"), {}, "ines"), 409, "INVALID_TRANSITION")
    r = ok(post(app_url, path(h, "release"), {}, "ines"))
    assert r["status"] == "released" and all(s["status"] == "void" for s in r["shares"])
    err(post(app_url, path(h, "release"), {}, "ines"), 409, "INVALID_TRANSITION")
    err(post(app_url, path(h, "pay"), {}, "ines", idempotency_key()), 409, "HOLD_EXPIRED")
    err(post(app_url, path(h, "cancel"), {}, "ines"), 409, "INVALID_TRANSITION")
    p = pay(app_url, hold(app_url))
    err(post(app_url, path(p, "pay"), {}, "ines", idempotency_key()), 409, "ALREADY_PAID")
    err(post(app_url, path(p, "release"), {}, "ines"), 409, "INVALID_TRANSITION")
    assert ok(post(app_url, path(p, "cancel"), {}, "ines"))["booking"]["status"] == "cancelled"
    err(post(app_url, path(p, "cancel"), {}, "ines"), 409, "INVALID_TRANSITION")
    err(post(app_url, path(p, "pay"), {}, "ines", idempotency_key()), 409, "INVALID_TRANSITION")
    assert booking(app_url, p["id"])["status"] == "cancelled"


@pytest.mark.timeout(5100)
@pytest.mark.parametrize("case", ["free", "late", "covered"], ids=["free", "late", "covered"])
def test_cancellation_credits(app_url, mail, ntfy, case, wiremock):
    if case == "free":
        b = pay(app_url, hold(app_url, co=CO))
        t = share_tokens(mail, b)["tomas"]
        tp = ok(post(app_url, f"/api/shares/{t}/pay", {}, "tomas", idempotency_key()))["amount_cents"]
        rv = rule(app_url)["version"]
        r = ok(post(app_url, f"/api/bookings/{b['id']}/cancel", {}, "ines"))
        assert r["fee_cents"] == 0 and r["rule_version"] == rv
        assert {(c["username"], c["amount_cents"]) for c in r["credits"]} == {("ines", b["shares"][0]["amount_cents"]), ("tomas", tp)}
        assert sorted(s["status"] for s in r["booking"]["shares"]) == ["paid", "paid", "void", "void"]
        assert [e["reason"] for e in credits(app_url, "tomas")["entries"] if e["booking_id"] == b["id"]] == ["booking_cancelled"]
        assert f"€{eur(tp)} is now in your Yardline credits." in text(mails(mail, f"Booking cancelled: {label(b)}", EMAIL["tomas"])[0])
        pushes(ntfy, topic(app_url, "ines"), lambda x: x.get("title") == "Booking cancelled"
               and x.get("message") == f"{label(b)}. Credit added to your Yardline account.")
        return
    if case == "late":
        base = app_url
        fc = club(base)["free_cancel_seconds"]
        starts = soon_slots(base, 2 * 3600, fc - 3600)
        random.shuffle(starts)
        b = pay(base, create(base, "ines", [(c, s) for s in starts[:4] for c in random.sample(range(1, 8), 7)]))
        paid = {"ines": b["total_cents"]}
    else:
        base = short()
        b = pay(base, near(base, "ines", club(base)["share_settle_seconds"] + 50, co=CO))
        eventually(lambda: all(s["status"] == "covered" for s in booking(base, b["id"])["shares"][1:]),
                   (ts(b["settle_at"]) - server_now(base)).total_seconds() + 30, "shares were never covered")
        paid = {"ines": b["total_cents"]}
    cr = rule(base)
    r = ok(post(base, f"/api/bookings/{b['id']}/cancel", {}, "ines"))
    pct = cr["late_fee_percent"]
    assert r["rule_version"] == cr["version"]
    [c] = r["credits"]
    fee_whole = paid["ines"] * pct // 100
    fee_parts = sum(s["amount_cents"] * pct // 100 for s in b["shares"])
    assert c["username"] == "ines" and c["amount_cents"] in (paid["ines"] - fee_whole, paid["ines"] - fee_parts)
    assert r["fee_cents"] == paid["ines"] - c["amount_cents"]
    assert [e["amount_cents"] for e in credits(base, "ines")["entries"] if e["booking_id"] == b["id"]] == [c["amount_cents"]]


def test_wf_cancel_booking_journey(page, app_url):
    b = pay(app_url, hold(app_url))
    page.set_viewport_size({"width": 1280, "height": 900})
    sign_in(page, app_url, "ines", "/me")
    row = history_row(page, b["start"])
    listen(page)
    row.get_by_role("button", name="Cancel booking").click()
    d = page.get_by_role("dialog")
    expect(d).to_contain_text("Cancel this booking?")
    d.get_by_role("button", name="Yes, cancel").click()
    wait_heard(page, "Booking cancelled.")
    bal = credits(app_url, "ines")["balance_cents"]
    wait_ui(page, lambda: f"€{eur(bal)}" in page.get_by_role("region", name="Credits").inner_text(),
            "the Credits region never showed the new balance")
    assert booking(app_url, b["id"])["status"] == "cancelled"
    assert [e["reason"] for e in credits(app_url, "ines")["entries"] if e["booking_id"] == b["id"]] == ["booking_cancelled"]


def test_wf_cancel_booking_share_in_flight(app_url, mail, wiremock):
    b = pay(app_url, hold(app_url, co=CO))
    t = share_tokens(mail, b)["tomas"]
    pos = [s["position"] for s in b["shares"] if s["player"]["username"] == "tomas"][0]
    baseline_charges(wiremock, delay_ms=SLOW_MS)
    with ThreadPoolExecutor(1) as ex:
        fut = ex.submit(post, app_url, f"/api/shares/{t}/pay", {}, "tomas", idempotency_key())
        eventually(lambda: refs(wiremock, "/v1/charges", f"{b['id']}:{pos}"), 10, "the share charge never reached Courtpay")
        r = ok(post(app_url, f"/api/bookings/{b['id']}/cancel", {}, "ines"))
        assert [c["username"] for c in r["credits"]] == ["ines"]
        err(fut.result(), 409, "SHARE_VOID")
    e = [x for x in credits(app_url, "tomas")["entries"] if x["booking_id"] == b["id"]]
    amt = b["shares"][pos - 1]["amount_cents"]
    assert [(x["reason"], x["amount_cents"]) for x in e] == [("late_capture", amt)]
    assert ok(get(app_url, f"/api/shares/{t}", "tomas"))["status"] == "void"
    assert f"€{eur(amt)} is now in your Yardline credits." in text(mails(mail, f"Booking cancelled: {label(b)}", EMAIL["tomas"])[0])


def test_desk_day_list_paging():
    base = short()
    ensure_today_rows(base, TODAY_ROWS)
    first = ok(get(base, "/api/desk/bookings", "rosa"))
    assert len(first["items"]) == PAGE_DEFAULT and first["next_cursor"]
    assert first["date"] == server_now(base).astimezone(zone(base)).strftime("%Y-%m-%d")
    assert len(ok(get(base, "/api/desk/bookings", "rosa", {"limit": PAGE_MAX}))["items"]) <= PAGE_MAX
    for lim in (0, PAGE_MAX + 1):
        field_err(get(base, "/api/desk/bookings", "rosa", {"limit": lim}), "limit", "Ask for 1 to 50 rows.")
    field_err(get(base, "/api/desk/bookings", "rosa", {"cursor": "not-a-cursor"}), "cursor", "This cursor is not valid.")
    _, before = desk_all(base)
    seen, cur, added = [], None, None
    for _ in range(60):
        b = ok(get(base, "/api/desk/bookings", "rosa", {"limit": 5, **({"cursor": cur} if cur else {})}))
        seen += b["items"]
        cur = b["next_cursor"]
        if added is None:
            added = [pay(base, late_today(base, "ines"))]
        if not cur:
            break
    ids = [r["id"] for r in seen]
    assert len(ids) == len(set(ids)), "a row was repeated while paging"
    assert {r["id"] for r in before} <= set(ids), "a row was skipped while paging"
    keys = [(r["start_utc"], r["court"]) for r in seen]
    assert keys == sorted(keys)
    if added[0]:
        assert ids.count(added[0]["id"]) <= 1
    assert all(set(r) >= {"id", "kind", "court", "start", "start_utc", "minutes", "status", "organiser_name", "players"}
               and "total_cents" not in r and "shares" not in r for r in seen)


@pytest.mark.timeout(4900)
def test_checkin_noshow_today():
    base = short()
    grace = club(base)["no_show_grace_seconds"]
    y = pay(base, near(base, "noor", 40), "noor")
    x = pay(base, late_today(base, "ines"))
    err(post(base, f"/api/desk/bookings/{y['id']}/no-show", {}, "rosa"), 409, "NOT_STARTED")
    err(post(base, f"/api/desk/bookings/{x['id']}/check-in", {}, "ines"), 403, "FORBIDDEN")
    assert ok(post(base, f"/api/desk/bookings/{x['id']}/check-in", {}, "rosa"))["status"] == "checked-in"
    err(post(base, f"/api/desk/bookings/{x['id']}/check-in", {}, "rosa"), 409, "INVALID_TRANSITION")
    edge = ts(y["start_utc"]) + timedelta(seconds=grace)

    def try_mark():
        r = post(base, f"/api/desk/bookings/{y['id']}/no-show", {}, "rosa")
        if r.status_code == 409:
            err(r, 409, "NOT_STARTED")
            return None
        return ok(r)
    assert eventually(try_mark, 120, "no-show never allowed after the grace time")["status"] == "no-show"
    assert server_now(base) >= edge
    err(post(base, f"/api/desk/bookings/{y['id']}/check-in", {}, "rosa"), 409, "INVALID_TRANSITION")
    err(post(base, f"/api/bookings/{y['id']}/cancel", {}, "noor"), 409, "INVALID_TRANSITION")
    tomorrow = (server_now(base).astimezone(zone(base)) + timedelta(days=1)).strftime("%Y-%m-%d")
    t = pay(base, create(base, "ines", [(c, f"{tomorrow}T00:{m}") for m in random.sample(range(30, 60), 4)
                                        for c in random.sample(range(1, 8), 7)]))
    _, rows = desk_all(base)
    assert t["id"] not in {r["id"] for r in rows}
    err(post(base, f"/api/desk/bookings/{t['id']}/check-in", {}, "rosa"), 403, "NOT_TODAY")


@pytest.mark.timeout(5100)
def test_wf_desk_day_journey(browser):
    base = short()
    ensure_today_rows(base, TODAY_ROWS)
    grace = club(base)["no_show_grace_seconds"]
    y = pay(base, near(base, "noor", 45), "noor")
    day, rows = desk_all(base)
    now = server_now(base)
    x = [r for r in rows[PAGE_DEFAULT:] if r["status"] == "paid" and ts(r["start_utc"]) > now][-1]
    yrow = [r for r in rows if r["id"] == y["id"]][0]
    with opened(browser, base) as p:
        p.set_viewport_size({"width": 1280, "height": 900})
        sign_in(p, base, "rosa", "/desk")
        expect(p.get_by_role("heading", level=1)).to_contain_text(f"Today, {day}")
        p.get_by_role("button", name="Load more bookings").click()
        btn = p.get_by_role("button", name=checkin_name(x))
        expect(btn).to_have_count(1, timeout=UI_S * 1000)
        wait_ui(p, lambda: more_focus_kept(p, "Today's bookings"),
                "after Load more bookings, focus neither stayed on the button nor moved to the last row")
        btn.focus()
        late_today(base, "ines")
        advance(p, REFRESH_MS + 500)
        assert focused_name(p) == checkin_name(x)
        btn.click()
        table = p.get_by_role("table", name="Today's bookings")
        wait_ui(p, lambda: "Checked in" in table.get_by_role("row").filter(has=btn).inner_text(), "row never read Checked in")
        ns = p.get_by_role("button", name=noshow_name(yrow))
        ns.click()
        expect(p.get_by_role("alert").filter(has_text=MSG["NOT_STARTED"])).to_be_visible(timeout=UI_S * 1000)
        eventually(lambda: server_now(base) >= ts(y["start_utc"]) + timedelta(seconds=grace), 150, "grace never passed")
        ns.click()
        wait_ui(p, lambda: "No-show" in table.get_by_role("row").filter(has=ns).inner_text(), "row never read No-show")
    _, rows = desk_all(base)
    st = {r["id"]: r["status"] for r in rows}
    assert st[x["id"]] == "checked-in" and st[y["id"]] == "no-show"


@pytest.mark.timeout(5100)
def test_desk_refresh_keeps_place(browser):
    base = short()
    ensure_today_rows(base, TODAY_ROWS)
    _, rows = desk_all(base)
    now = server_now(base)
    x = [r for r in rows[PAGE_DEFAULT:] if r["status"] == "paid" and ts(r["start_utc"]) > now][0]
    with opened(browser, base) as p:
        p.set_viewport_size({"width": 1280, "height": 900})
        sign_in(p, base, "rosa", "/desk")
        p.get_by_role("button", name="Load more bookings").click()
        btn = p.get_by_role("button", name=checkin_name(x))
        expect(btn).to_have_count(1, timeout=UI_S * 1000)
        table = p.get_by_role("table", name="Today's bookings")
        row = table.get_by_role("row").filter(has=btn)
        loaded = len(rows[:2 * PAGE_DEFAULT])
        new = pay(base, late_today(base, "tomas"), "tomas")
        with held(p, "**/check-in") as h:
            btn.click()
            expect(row).to_contain_text("Checking in...")
            advance(p, REFRESH_MS + 500)
            advance(p, REFRESH_MS + 500)
            expect(row).to_contain_text("Checking in...")
            assert focused_name(p) == checkin_name(x)
            h.release()
        wait_ui(p, lambda: "Checked in" in row.inner_text(), "the row never took its own answer")
        _, rows2 = desk_all(base)
        last = rows[min(loaded, len(rows)) - 1]
        key = lambda r: (r["start_utc"], r["court"])
        for r in rows2:
            if key(r) <= key(last) or r["id"] == new["id"] and key(new) <= key(last):
                expect(p.get_by_role("button", name=checkin_name(r))).to_have_count(1)
        assert focused_name(p) == checkin_name(x)


def lesson(base, coach_id, slot, students=("kai", "pablo"), weeks=1, user="marta"):
    c, s = slot
    return post(base, "/api/lessons", {"coach_id": coach_id, "court": c, "start": s, "minutes": 60, "weeks": weeks,
                                       "students": [EMAIL[x] for x in students]}, user)


def test_lessons_own_coach_id(app_url, mail):
    slot = far_slot()
    for cid in ("coach-owen", "coach-nobody"):
        err(lesson(app_url, cid, slot), 403, "NOT_YOUR_COACH_ID")
    err(get(app_url, "/api/lessons", "marta", {"coach_id": "coach-owen"}), 403, "NOT_YOUR_COACH_ID")
    err(lesson(app_url, "coach-marta", slot, user="ines"), 403, "FORBIDDEN")
    assert grid_cell(app_url, *slot)["state"] == "free"
    r = ok(lesson(app_url, "coach-marta", slot), 201)
    assert [i["coach_id"] for i in r["items"]] == ["coach-marta"]
    listed = ok(get(app_url, "/api/lessons", "marta", {"coach_id": "coach-marta"}))["items"]
    assert r["items"][0]["id"] in {i["id"] for i in listed} and {i["coach_id"] for i in listed} == {"coach-marta"}


def test_lesson_shares(app_url, mail, wiremock):
    it = ok(lesson(app_url, "coach-marta", far_slot()), 201)["items"][0]
    tok = {}
    for s in it["shares"]:
        u = s["player"]["username"]
        body = text(mails(mail, f"Lesson share: €{eur(s['amount_cents'])} for {label(it)}", EMAIL[u])[0])
        assert NAMES["marta"] in body and f"€{eur(s['amount_cents'])}" in body
        other = "pablo" if u == "kai" else "kai"
        assert NAMES[other] not in body and EMAIL[other] not in body
        tok[u] = re.search(r"/share/([^\s/?#\"<>]+)", body).group(1)
    assert ok(get(app_url, f"/api/shares/{tok['kai']}", "kai"))["settle_at"] is None
    ok(post(app_url, f"/api/shares/{tok['kai']}/pay", {}, "kai", idempotency_key()))
    pos = [s["position"] for s in it["shares"] if s["player"]["username"] == "kai"][0]
    assert refs(wiremock, "/v1/charges", f"{it['id']}:{pos}")[-1]["payer"] == EMAIL["kai"]
    for u in ("marta", "elena"):
        st = {s["player"]["username"]: s["status"] for s in ok(get(app_url, f"/api/lessons/{it['id']}", u))["shares"]}
        assert st == {"kai": "paid", "pablo": "due"}
    err(get(app_url, f"/api/lessons/{it['id']}", "owen"), 404, "NOT_FOUND")
    for u in ("kai", "rosa"):
        err(get(app_url, f"/api/lessons/{it['id']}", u), 403, "FORBIDDEN")


def dst_monday(y):
    d = Date(y, 3, 31)
    while d.weekday() != 6:
        d -= timedelta(days=1)
    return d - timedelta(days=6)


def pick(loc, *choices):
    for ch in choices:
        with suppress(Exception):
            select(loc, ch)
            return
    pytest.fail(f"no option {choices} in the combobox")


def test_wf_coach_lessons_dst_series(page, app_url, mail):
    mon = dst_monday(random.randint(*COACH_BAND))
    hhmm = f"{random.randint(10, 19)}:{random.choice(['00', '30'])}"
    sign_in(page, app_url, "marta", "/coach")
    form = page.get_by_role("form", name="New lesson block")
    pick(form.get_by_role("combobox", name="Court"), "Court 4", "4")
    form.get_by_role("textbox", name="Date", exact=True).fill(str(mon))
    form.get_by_role("textbox", name="Start time").fill(hhmm)
    tick(form.get_by_role("radio", name="60 minutes"))
    form.get_by_role("spinbutton", name="Weeks").fill("2")
    form.get_by_role("textbox", name="Student 1 email").fill(EMAIL["kai"])
    form.get_by_role("textbox", name="Student 2 email").fill(EMAIL["pablo"])
    form.get_by_role("button", name="Book lesson block").click()
    week2 = mon + timedelta(days=7)
    items = eventually(lambda: [i for i in ok(get(app_url, "/api/lessons", "marta", {"coach_id": "coach-marta"}))["items"]
                                if i["court"] == 4 and i["start"][11:16] == hhmm and i["start"][:10] in (str(mon), str(week2))],
                       30, "the lesson series was not written")
    items = sorted(items, key=lambda i: i["start_utc"])
    assert [i["start"][:10] for i in items] == [str(mon), str(week2)]
    assert ts(items[1]["start_utc"]) - ts(items[0]["start_utc"]) == timedelta(days=7, hours=-1)
    for it in items:
        s = [x for x in it["shares"] if x["player"]["username"] == "kai"][0]
        body = text(mails(mail, f"Lesson share: €{eur(s['amount_cents'])} for {label(it)}", EMAIL["kai"])[0])
        ok(post(app_url, f"/api/shares/{re.search(r'/share/([^\s/?#<>]+)', body).group(1)}/pay", {}, "kai", idempotency_key()))
    page.reload()
    table = page.get_by_role("table", name="Lesson blocks")
    for d in (mon, week2):
        r = table.get_by_role("row").filter(has_text=str(d)).filter(has_text=hhmm).first
        expect(r).to_contain_text("Paid", timeout=UI_S * 1000)
        expect(r).to_contain_text("Due")


def test_weekly_series(app_url, wiremock):
    c, s = far_slot()
    for w in (0, 9):
        field_err(lesson(app_url, "coach-marta", (c, s), weeks=w), "weeks", "Pick 1 to 8 weeks.")
    mon = dst_monday(random.randint(*SERIES_BAND))
    r = ok(lesson(app_url, "coach-marta", (c, f"{mon}T{s[11:]}"), weeks=2), 201)["items"]
    assert [i["start"][11:16] for i in r] == [s[11:]] * 2 and len({i["series_id"] for i in r}) == 1
    sched = pricing(app_url)["schedule"]
    assert all(i["pricing_version"] == price(sched, i["start"][:16], 60)[1] for i in r)
    c2, s2 = far_slot()
    wk3 = (datetime.fromisoformat(s2) + timedelta(days=14)).strftime("%Y-%m-%dT%H:%M")
    hold(app_url, slot=(c2, wk3))
    err(lesson(app_url, "coach-marta", (c2, s2), weeks=3), 409, "SLOT_TAKEN")
    assert grid_cell(app_url, c2, s2)["state"] == "free"
    assert grid_cell(app_url, c2, (datetime.fromisoformat(s2) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M"))["state"] == "free"
    a = auth_id(wiremock, delay_ms=SLOW_MS)
    c3, s3 = far_slot()
    n0 = len(calls(wiremock, "/v1/authorizations"))
    with ThreadPoolExecutor(1) as ex:
        fut = ex.submit(post, app_url, "/api/holds", {"court": c3, "start": s3, "minutes": 60}, "ines", idempotency_key())
        eventually(lambda: len(calls(wiremock, "/v1/authorizations")) > n0, 10, "the hold never reached Courtpay")
        ok(lesson(app_url, "coach-marta", (c3, s3)), 201)
        err(fut.result(), 409, "SLOT_TAKEN")
    assert calls(wiremock, f"/v1/authorizations/{a}/void")
    assert grid_cell(app_url, c3, s3)["state"] == "lesson"


def test_versioned_prices(app_url):
    g = pricing(app_url)
    body = {k: g[k] for k in ("offpeak_cents_per_minute", "peak_cents_per_minute", "peak_start", "peak_end", "peak_days")}
    eff = far_slot(years=(2095, 2099))[1][:10]
    err(put(app_url, "/api/manager/pricing", {**body, "effective_from": eff, "version": g["version"] + 7}, "elena"),
        412, "VERSION_STALE")
    for k, v, f, m in (("offpeak_cents_per_minute", 0, "offpeak_cents_per_minute", "Use whole cents from 1 to 10000."),
                       ("peak_start", "17:15", "peak_start", "Use HH:MM on the half hour, start before end."),
                       ("peak_days", ["mon", "mon"], "peak_days", "Use mon to sun, each once.")):
        field_err(put(app_url, "/api/manager/pricing", {**body, k: v, "effective_from": eff, "version": g["version"]}, "elena"), f, m)
    before = server_now(app_url)
    r = ok(put(app_url, "/api/manager/pricing", {**body, "effective_from": eff, "version": g["version"],
                                                 "saved_by": {"username": "tomas", "name": NAMES["tomas"]},
                                                 "saved_at": "2026-01-01T00:00:00.000Z", "schedule": []}, "elena"))
    assert r["version"] == g["version"] + 1 and r["saved_by"] == {"username": "elena", "name": NAMES["elena"]}
    assert abs((ts(r["saved_at"]) - before).total_seconds()) < 60
    assert r["schedule"][:len(g["schedule"])] == g["schedule"] and r["schedule"][-1]["version"] == r["version"]
    assert r["schedule"][0]["version"] == 1 and r["schedule"][0]["saved_by"] is None
    err(put(app_url, "/api/manager/pricing", {**body, "effective_from": eff, "version": g["version"]}, "elena"),
        412, "VERSION_STALE")
    err(put(app_url, "/api/manager/pricing", {**body, "effective_from": eff, "version": r["version"]}, "ines"), 403, "FORBIDDEN")


def test_versioned_cancellation_rule(app_url):
    g = rule(app_url)
    pct = random.randint(10, 90)
    desc = f"Rule {uuid.uuid4().hex[:8]}"
    err(put(app_url, "/api/manager/cancellation-rule", {"late_fee_percent": pct, "description": desc,
                                                        "version": g["version"] + 7}, "elena"), 412, "VERSION_STALE")
    field_err(put(app_url, "/api/manager/cancellation-rule", {"late_fee_percent": 101, "description": desc,
                                                              "version": g["version"]}, "elena"),
              "late_fee_percent", "Use a whole number from 0 to 100.")
    r = ok(put(app_url, "/api/manager/cancellation-rule", {"late_fee_percent": pct, "description": desc,
                                                           "version": g["version"], "saved_by": None}, "elena"))
    assert r["version"] == g["version"] + 1 and r["saved_by"] == {"username": "elena", "name": NAMES["elena"]}
    assert r["late_fee_percent"] == pct and r["description"] == desc
    err(put(app_url, "/api/manager/cancellation-rule", {"late_fee_percent": pct, "description": desc,
                                                        "version": g["version"]}, "elena"), 412, "VERSION_STALE")
    fc = club(app_url)["free_cancel_seconds"]
    starts = soon_slots(app_url, 2 * 3600, fc - 3600)
    random.shuffle(starts)
    b = pay(app_url, create(app_url, "ines", [(c, s) for s in starts[:4] for c in random.sample(range(1, 8), 7)]))
    c = ok(post(app_url, f"/api/bookings/{b['id']}/cancel", {}, "ines"))
    assert c["rule_version"] == r["version"] and c["fee_cents"] == b["total_cents"] * pct // 100


TEXT_CASES = ["note_280", "note_281", "note_280_emoji", "note_282_flags", "desc_280", "desc_281"]


@pytest.mark.parametrize("case", TEXT_CASES, ids=TEXT_CASES)
def test_note_and_description_limit(app_url, case):
    value = {"note_280": "a" * TEXT_LIMIT, "note_281": "a" * (TEXT_LIMIT + 1), "note_280_emoji": "🎾" * TEXT_LIMIT,
             "note_282_flags": "🇪🇸" * (TEXT_LIMIT // 2 + 1), "desc_280": "é" * TEXT_LIMIT,
             "desc_281": "é" * (TEXT_LIMIT + 1)}[case]
    if case.startswith("note"):
        c, s = far_slot()
        r = post(app_url, "/api/holds", {"court": c, "start": s, "minutes": 60, "note": value}, "ines", idempotency_key())
        if len(value) <= TEXT_LIMIT:
            assert ok(r, 201)["note"] == value
        else:
            field_err(r, "note", "Keep the note to 280 characters.")
            assert grid_cell(app_url, c, s)["state"] == "free"
        return
    g = rule(app_url)
    r = put(app_url, "/api/manager/cancellation-rule", {"late_fee_percent": g["late_fee_percent"], "description": value,
                                                        "version": g["version"]}, "elena")
    if len(value) <= TEXT_LIMIT:
        assert ok(r)["description"] == value
    else:
        field_err(r, "description", "Keep the description to 280 characters.")
        assert rule(app_url)["version"] == g["version"]


def test_utilisation(page, app_url):
    c, s = far_slot(90)
    pay(app_url, hold(app_url, minutes=90, slot=(c, s)))
    ls = (c, f"{s[:10]}T{'08:00' if s[11:] >= '10:00' else '21:00'}")
    ok(lesson(app_url, "coach-marta", ls), 201)
    cfg = club(app_url)
    a, b = cfg["opening_hours"].split("-")
    om = (int(b[:2]) * 60 + int(b[3:])) - (int(a[:2]) * 60 + int(a[3:]))
    u = ok(get(app_url, "/api/manager/utilisation", "elena", {"date": s[:10]}))
    row = [x for x in u["courts"] if x["court"] == c][0]
    assert u["date"] == s[:10] and row["booked_minutes"] == BOOKED_MIN and row["open_minutes"] == om
    assert row["percent"] == BOOKED_MIN * 100 // om
    assert u["total"]["percent"] == u["total"]["booked_minutes"] * 100 // u["total"]["open_minutes"]
    field_err(get(app_url, "/api/manager/utilisation", "elena", {"date": "2027-13-99"}), "date", "Use a date like 2027-03-28.")
    page.set_viewport_size({"width": 1280, "height": 900})
    sign_in(page, app_url, "elena", f"/manager?date={s[:10]}")
    box = page.get_by_role("textbox", name="Utilisation date")
    expect(box).to_have_value(s[:10])
    table = page.get_by_role("table", name="Utilisation")
    court_row = re.compile(rf"^\s*(Court\s+)?{c}\s")

    def court_row_shows_booked():
        rows = [r.inner_text() for r in table.get_by_role("row").all()]
        return any(court_row.match(t) and re.search(rf"(?<!\d){BOOKED_MIN}(?!\d)", t) for t in rows)
    wait_ui(page, court_row_shows_booked, f"the Court {c} row never showed {BOOKED_MIN} booked minutes")
    expect(table.get_by_role("row").filter(has_text="All courts")).to_have_count(1)
    box.fill("2027-03-28")
    box.press("Enter")
    page.wait_for_url(re.compile(r"date=2027-03-28"))
    page.reload()
    expect(page.get_by_role("textbox", name="Utilisation date")).to_have_value("2027-03-28")
    page.go_back()
    expect(page.get_by_role("textbox", name="Utilisation date")).to_have_value(s[:10])
    for w in (834, 1280):
        page.set_viewport_size({"width": w, "height": 900})
        layout(page)
        for t in ("Utilisation", "Price schedule"):
            bb = page.get_by_role("table", name=t).bounding_box()
            assert bb["x"] >= 0 and bb["x"] + bb["width"] <= w + 1, (t, w)


def test_wf_manager_settings_journey(browser, app_url):
    eff = (server_now(app_url).astimezone(ZONE) + timedelta(days=3)).strftime("%Y-%m-%d")
    old = pricing(app_url)
    with opened(browser, app_url) as a:
        a.set_viewport_size({"width": 1280, "height": 900})
        sign_in(a, app_url, "elena", "/manager")
        b = a.context.new_page()
        b.goto(f"{app_url}/manager")
        prices = lambda p: p.get_by_role("form", name="Prices")
        peak = lambda p: prices(p).get_by_role("spinbutton", name="Peak cents per minute", exact=True)
        expect(peak(b)).to_be_visible(timeout=UI_S * 1000)
        expect(peak(a)).to_be_visible()
        prices(b).get_by_role("textbox", name="Effective from").fill(eff)
        prices(b).get_by_role("button", name="Save prices").click()
        expect(prices(b)).to_contain_text("Saved.", timeout=UI_S * 1000)
        new_peak = str(old["peak_cents_per_minute"] + 5)
        peak(a).fill(new_peak)
        prices(a).get_by_role("textbox", name="Effective from").fill(eff)
        prices(a).get_by_role("button", name="Save prices").click()
        expect(a.get_by_text(MSG["VERSION_STALE"])).to_be_visible(timeout=UI_S * 1000)
        expect(prices(a).get_by_role("textbox", name="Effective from")).to_have_value(eff)
        a.get_by_role("button", name="Reload").click()
        expect(peak(a)).to_have_value(str(pricing(app_url)["peak_cents_per_minute"]), timeout=UI_S * 1000)
        peak(a).fill(new_peak)
        prices(a).get_by_role("textbox", name="Effective from").fill(eff)
        prices(a).get_by_role("button", name="Save prices").click()
        expect(prices(a)).to_contain_text("Saved.", timeout=UI_S * 1000)
        g = pricing(app_url)
        sched = a.get_by_role("table", name="Price schedule")
        expect(sched.get_by_role("row").filter(has_text=NAMES["elena"]).last).to_contain_text(new_peak)
        expect(sched.get_by_role("row").filter(has_text="Seed").first).to_be_visible()
        assert g["schedule"][-1]["peak_cents_per_minute"] == int(new_peak) and g["schedule"][-1]["effective_from"] == eff
        assert g["schedule"][:len(old["schedule"])] == old["schedule"]
        box = a.get_by_role("textbox", name="Utilisation date")
        box.fill("2027-03-28")
        box.press("Enter")
        a.wait_for_url(re.compile(r"date=2027-03-28"))
        u = ok(get(app_url, "/api/manager/utilisation", "elena", {"date": "2027-03-28"}))
        a.reload()
        expect(a.get_by_role("textbox", name="Utilisation date")).to_have_value("2027-03-28")
        expect(a.get_by_role("table", name="Utilisation").get_by_role("row").filter(has_text="All courts")).to_contain_text(
            str(u["total"]["open_minutes"]))
    before = (datetime.fromisoformat(eff) - timedelta(days=1)).strftime("%Y-%m-%d")
    q = quote_of(app_url, 1, f"{before}T18:00", 60)
    assert q["pricing_version"] != g["version"]


def test_effective_dated_prices(app_url):
    g = pricing(app_url)
    E = far_slot(years=(2095, 2099))[1][:10]
    held_b = hold(app_url, slot=(random.randint(1, 7), f"{(Date.fromisoformat(E) + timedelta(days=1))}T18:00"))
    off = random.randint(41, 90)
    body = {"offpeak_cents_per_minute": off, "peak_cents_per_minute": off + 30, "peak_start": "17:00", "peak_end": "22:00",
            "peak_days": DAYS, "effective_from": E, "version": g["version"]}
    r = ok(put(app_url, "/api/manager/pricing", body, "elena"))
    prev = (Date.fromisoformat(E) - timedelta(days=1)).isoformat()
    for d in (prev, E):
        q = quote_of(app_url, 2, f"{d}T08:00", 60)
        tot, ver = price(r["schedule"], f"{d}T08:00", 60)
        assert (q["total_cents"], q["pricing_version"]) == (tot, ver)
    assert quote_of(app_url, 2, f"{E}T08:00", 60)["pricing_version"] == r["version"]
    assert quote_of(app_url, 2, f"{prev}T21:00", 60)["pricing_version"] != r["version"]
    assert booking(app_url, held_b["id"])["total_cents"] == held_b["total_cents"]
    today = server_now(app_url).astimezone(ZONE).date()
    field_err(put(app_url, "/api/manager/pricing", {**body, "effective_from": str(today), "version": r["version"]}, "elena"),
              "effective_from", "Pick a date from tomorrow on.")
    v = version_for(r["schedule"], str(today + timedelta(days=1)))
    same = {k: v[k] for k in ("offpeak_cents_per_minute", "peak_cents_per_minute", "peak_start", "peak_end", "peak_days")}
    ok(put(app_url, "/api/manager/pricing", {**same, "effective_from": str(today + timedelta(days=1)), "version": r["version"]}, "elena"))


def test_quote_per_minute(app_url):
    sched = pricing(app_url)["schedule"]
    d = Date.fromisoformat(far_slot()[1][:10])
    d -= timedelta(days=d.weekday() - 2)
    for day in (d, d + timedelta(days=3)):
        for st, mins in (("16:30", 90), ("08:00", 120), ("21:00", 60)):
            q = quote_of(app_url, 5, f"{day}T{st}", mins)
            assert (q["total_cents"], q["pricing_version"]) == price(sched, f"{day}T{st}", mins)
            assert q["offpeak_minutes"] + q["peak_minutes"] == mins
    b = hold(app_url, minutes=90)
    assert b["total_cents"] == price(sched, b["start"][:16], 90)[0]
    m = far_match(app_url, "noor", (3.0, 4.0))
    assert m["share_cents"] == price(sched, m["start"][:16], 60)[0] // 4
    it = ok(lesson(app_url, "coach-marta", far_slot()), 201)["items"][0]
    assert it["total_cents"] == price(sched, it["start"][:16], 60)[0]


GRID_CASES = {"7_days_ok": (6, "1", None, None), "8_days": (7, "1", "to", "Ask for at most 7 days."),
              "9_courts": (0, "1,2,3,4,5,6,7,1,2", "courts", "Ask for at most 8 courts."),
              "duplicate": (0, "1,1", "courts", "Use court numbers 1 to 7, each once."),
              "court_8": (0, "8", "courts", "Use court numbers 1 to 7, each once."),
              "to_before": (-1, "1", "to", "End on or after the start date.")}


@pytest.mark.parametrize("case", list(GRID_CASES), ids=list(GRID_CASES))
def test_grid_range_bounds(app_url, case):
    span, courts, field, message = GRID_CASES[case]
    f = Date.fromisoformat(far_slot()[1][:10])
    r = get(app_url, "/api/grid", "ines", {"from": str(f), "to": str(f + timedelta(days=span)), "courts": courts})
    if field:
        field_err(r, field, message)
    else:
        assert len(ok(r)["days"]) == span + 1


def test_opening_hours_and_dst(app_url):
    g = ok(get(app_url, "/api/grid", "ines", {"from": "2027-03-27", "to": "2027-03-28", "courts": "1"}))
    first = {d["date"]: d["cells"][0] for d in g["days"]}
    assert first["2027-03-28"]["start_utc"] == "2027-03-28T06:00:00.000Z"
    assert first["2027-03-27"]["start_utc"] == "2027-03-27T07:00:00.000Z"
    for d in g["days"]:
        times = [c["start"][11:16] for c in d["cells"]]
        assert times[0] == "08:00" and all(t[3:] in ("00", "30") for t in times) and len(times) == 30
    msg = "Pick a start inside opening hours on the slot grid."
    for s, m in (("2027-03-26T07:30", 60), ("2027-03-26T08:15", 60), ("2027-03-26T22:30", 60)):
        field_err(get(app_url, "/api/quote", "ines", {"court": 1, "start": s, "minutes": m}), "start", msg)
    base = short_madrid()
    sg = ok(get(base, "/api/grid", "ines", {"from": "2027-03-28", "courts": "1"}))["days"][0]["cells"]
    assert not [c for c in sg if c["start"][11:13] == "02"]
    field_err(get(base, "/api/quote", "ines", {"court": 1, "start": "2027-03-28T02:30", "minutes": 60}), "start", msg)


def test_keyboard_grid(page, app_url):
    day = far_slot()[1][:10]
    sign_in(page, app_url, "ines", f"/courts?day={day}")
    expect(cell(page, 1, "08:00", "Free")).to_be_visible(timeout=UI_S * 1000)
    page.get_by_role("button", name="Next day").focus()
    page.keyboard.press("Tab")
    assert focused_name(page) == "Court 1, 08:00, Free"
    for key, name in (("ArrowRight", "Court 2, 08:00, Free"), ("ArrowDown", "Court 2, 08:30, Free"),
                      ("End", "Court 7, 08:30, Free"), ("ArrowRight", "Court 7, 08:30, Free"),
                      ("Home", "Court 1, 08:30, Free"), ("ArrowLeft", "Court 1, 08:30, Free"),
                      ("ArrowUp", "Court 1, 08:00, Free"), ("ArrowUp", "Court 1, 08:00, Free")):
        page.keyboard.press(key)
        assert focused_name(page) == name, key
    page.keyboard.press("Enter")
    expect(dialog(page, 1, "08:00")).to_be_visible()
    page.keyboard.press("Escape")
    page.keyboard.press(" ")
    expect(dialog(page, 1, "08:00")).to_be_visible()


def test_slot_dialog_focus(page, app_url):
    c, s = far_slot()
    sign_in(page, app_url, "ines", f"/courts?day={s[:10]}")
    name = f"Court {c}, {s[11:]}, Free"
    cell(page, c, s[11:], "Free").focus()
    page.keyboard.press("Enter")
    dlg = dialog(page, c, s[11:])
    expect(dlg).to_be_visible()
    for key in ["Tab"] * 25 + ["Shift+Tab"] * 25:
        page.keyboard.press(key)
        assert dlg.evaluate("d => d.contains(document.activeElement)"), key
    page.keyboard.press("Escape")
    expect(dlg).to_have_count(0)
    assert focused_name(page) == name
    page.keyboard.press("Enter")
    dlg.get_by_role("button", name="Close").click()
    expect(dlg).to_have_count(0)
    assert focused_name(page) == name


WIDTHS = ["320", "375", "390", "768", "834", "1280"]


@pytest.mark.parametrize("width", [320, 375, 390, 768, 834, 1280], ids=WIDTHS)
def test_grid_layout_by_viewport(page, app_url, width):
    day = far_slot()[1][:10]
    page.set_viewport_size({"width": width, "height": 800})
    sign_in(page, app_url, "ines", f"/courts?day={day}")
    c7 = page.get_by_role("columnheader", name="Court 7")
    expect(c7).to_be_visible(timeout=UI_S * 1000)
    layout(page)
    inside = lambda loc: (lambda b: b["x"] >= 0 and b["x"] + b["width"] <= width + 1)(loc.bounding_box())
    if width >= 800:
        assert all(inside(page.get_by_role("columnheader", name=f"Court {n}")) for n in range(1, 8))
    else:
        assert not inside(c7)
        cell(page, 1, "08:00", "Free").focus()
        page.keyboard.press("End")
        x7 = cell(page, 7, "08:00", "Free")
        expect(x7).to_be_in_viewport()
        rh = page.get_by_role("rowheader", name="08:00").bounding_box()
        assert -1 <= rh["x"] < width / 2 and inside(x7)


def test_wf_grid_browse_phone_journey(browser, app_url):
    c, s = far_slot()
    d0 = Date.fromisoformat(s[:10])
    with opened(browser, app_url, touch=True) as p:
        p.set_viewport_size({"width": 390, "height": 844})
        sign_in(p, app_url, "ines", f"/courts?day={d0}")
        tap(p.get_by_role("button", name="Next day"))
        p.wait_for_url(re.compile(f"day={d0 + timedelta(days=1)}"))
        expect(p.get_by_role("textbox", name="Date", exact=True)).to_have_value(str(d0 + timedelta(days=1)))
        p.go_back()
        p.wait_for_url(re.compile(f"day={d0}"))
        expect(p.get_by_role("textbox", name="Date", exact=True)).to_have_value(str(d0))
        x = cell(p, c, s[11:], "Free")
        expect(x).to_be_visible(timeout=UI_S * 1000)
        x.focus()
        p.keyboard.press("ArrowUp" if s[11:] != "08:00" else "ArrowDown")
        p.keyboard.press("ArrowDown" if s[11:] != "08:00" else "ArrowUp")
        assert focused_name(p) == f"Court {c}, {s[11:]}, Free"
        tap(x)
        dlg = dialog(p, c, s[11:])
        q = quote_of(app_url, c, s, 60)
        wait_ui(p, lambda: f"€{eur(q['total_cents'])}" in dlg.inner_text(), "dialog never showed the quoted price")
        tap(dlg.get_by_role("button", name="Close"))
        assert focused_name(p) == f"Court {c}, {s[11:]}, Free"
        p.reload()
        expect(p.get_by_role("textbox", name="Date", exact=True)).to_have_value(str(d0))
        layout(p)


def test_latest_quote_wins(page, app_url):
    c, s = far_slot(120)
    sign_in(page, app_url, "ines", f"/courts?day={s[:10]}")
    dlg = open_cell(page, c, s[11:])
    slow = {}

    def handler(route):
        if parse_qs(urlsplit(route.request.url).query).get("minutes") == ["90"] and "r" not in slow:
            slow["r"] = route
        else:
            route.continue_()
    page.route("**/api/quote*", handler)
    q90, q120 = quote_of(app_url, c, s, 90)["total_cents"], quote_of(app_url, c, s, 120)["total_cents"]
    tick(dlg.get_by_role("radio", name="90 minutes"))
    tick(dlg.get_by_role("radio", name="120 minutes"))
    wait_ui(page, lambda: f"€{eur(q120)}" in dlg.inner_text(), "the 120-minute price never showed")
    if "r" in slow:
        with suppress(Exception):
            slow["r"].continue_()
    advance(page, 1500)
    assert f"€{eur(q120)}" in dlg.inner_text() and f"€{eur(q90)}" not in dlg.inner_text()


def mine(rows, event, recipients, since):
    return [r for r in rows if r["event"] == event and r["recipient"] in recipients and ts(r["created_at"]) >= since]


def test_notice_outbox(app_url, mail, ntfy):
    b = hold(app_url, "pablo")
    since = ts(b["created_at"]) - timedelta(seconds=2)
    exp = ts(b["expires_at"]).astimezone(ZONE).strftime("%H:%M")
    assert exp in text(mails(mail, f"Slot held: {label(b)}", EMAIL["pablo"])[0])
    pushes(ntfy, topic(app_url, "pablo"), lambda m: m.get("title") == "Slot held" and m.get("message") == label(b))
    rows = eventually(lambda: (lambda x: x if len(x) >= 2 and all(r["status"] == "sent" for r in x) else None)(
        mine(notices(app_url), "held", {EMAIL["pablo"], "pablo"}, since)), 30, "held notices never read sent")
    assert {r["channel"]: r["recipient"] for r in rows} == {"email": EMAIL["pablo"], "push": "pablo"}
    assert not [r for r in notices(app_url) if r["recipient"].startswith("yardline-")]
    md = down("APP_MAIL_DOWN_URL")
    b2 = hold(md, "pablo")
    r2 = mine(notices(md), "held", {EMAIL["pablo"]}, ts(b2["created_at"]) - timedelta(seconds=2))
    assert r2 and all(r["status"] != "sent" for r in r2)
    assert not [m for m in mail.messages(settle=1) if m.get("Subject") == f"Slot held: {label(b2)}"]


@pytest.mark.timeout(300)
def test_notice_retries(mail):
    md = down("APP_MAIL_DOWN_URL")
    b = hold(md, "pablo")
    since = ts(b["created_at"]) - timedelta(seconds=2)
    row = eventually(lambda: [r for r in mine(notices(md), "held", {EMAIL["pablo"]}, since) if r["status"] == "failed"],
                     90, "the held email never became failed")[0]
    assert row["attempts"] == 5
    t = time.monotonic()
    eventually(lambda: time.monotonic() - t > 5, 6, "unreachable")
    again = [r for r in notices(md, status="failed") if r["id"] == row["id"]]
    assert again and again[0]["attempts"] == 5
    assert not [m for m in mail.messages(settle=1) if m.get("Subject") == f"Slot held: {label(b)}"]


@pytest.mark.timeout(400)
def test_wf_notice_outage_failed_list(browser):
    md = down("APP_MAIL_DOWN_URL")
    c, s = far_slot()
    with opened(browser, md) as p:
        _, x = ui_hold(p, md, "pablo", s, c)
        wait_heard(p, f"Slot held for {mmss(club(md)['hold_seconds'])}.")
    since = ts(booking(md, x["booking_id"], "pablo")["created_at"]) - timedelta(seconds=2)
    eventually(lambda: [r for r in mine(notices(md, status="failed"), "held", {EMAIL["pablo"]}, since)], 90,
               "the held email never failed")
    with opened(browser, md) as p:
        sign_in(p, md, "rosa", "/desk")
        expect(p.get_by_role("region", name="Failed notices")).to_contain_text(
            f"held email to {EMAIL['pablo']}", timeout=UI_S * 1000)


def test_exactly_one_delivery(app_url, mail, ntfy):
    with ThreadPoolExecutor(5) as ex:
        bs = list(ex.map(lambda _: hold(app_url, "pablo"), range(5)))
    top = topic(app_url, "pablo")
    for b in bs:
        mails(mail, f"Slot held: {label(b)}", EMAIL["pablo"])
        pushes(ntfy, top, lambda m: m.get("message") == label(b))
    for b in bs:
        assert len([m for m in mail.messages(settle=2) if m.get("Subject") == f"Slot held: {label(b)}"]) == 1
        ps = [m for m in ntfy.messages(top, 0, timeout=2) if m.get("message") == label(b)]
        assert len(ps) == 1 and "€" not in ps[0]["message"]
        assert not [n for u, n in NAMES.items() if u != "pablo" and n in ps[0]["message"] + ps[0].get("title", "")]
    since = min(ts(b["created_at"]) for b in bs) - timedelta(seconds=2)
    rows = eventually(lambda: (lambda x: x if len(x) >= 10 and all(r["status"] == "sent" for r in x) else None)(
        mine(notices(app_url), "held", {EMAIL["pablo"], "pablo"}, since)), 40, "burst notices never all sent")
    assert all(r["attempts"] == 1 for r in rows)


@pytest.mark.timeout(300)
def test_notice_order_per_recipient():
    pd = down("APP_PUSH_DOWN_URL")
    b1 = hold(pd, "pablo")
    hold(pd, "pablo")
    since = ts(b1["created_at"]) - timedelta(seconds=1)
    rows = sorted(mine(notices(pd), "held", {"pablo"}, since), key=lambda r: r["created_at"])
    assert len(rows) >= 2
    old, new = rows[-2], rows[-1]
    if old["status"] == "pending":
        assert new["attempts"] == 0 and new["next_attempt_at"] is None
    eventually(lambda: [r for r in mine(notices(pd), "held", {EMAIL["pablo"]}, since) if r["status"] == "sent"], 30,
               "email waited behind the failing pushes")
    eventually(lambda: [r for r in mine(notices(pd), "held", {"pablo"}, since) if r["id"] == old["id"] and r["status"] == "failed"],
               90, "the older push never failed")
    eventually(lambda: [r for r in mine(notices(pd), "held", {"pablo"}, since) if r["id"] == new["id"] and r["attempts"] > 0],
               30, "the newer push was never attempted after the older one failed")


def test_history_paging_stable(app_url):
    d0 = Date.fromisoformat(far_slot(years=HISTORY_BAND)[1][:10])
    c, t = random.randint(1, 7), f"{random.randint(9, 20)}:00"
    ours = [pay(app_url, hold(app_url, "tomas", slot=(c, f"{d0 + timedelta(days=k)}T{t}")), "tomas")["id"] for k in (1, 2, 3, 4)]
    first = ok(get(app_url, "/api/me/bookings", "tomas"))
    while len(first["items"]) < PAGE_DEFAULT and first["next_cursor"] is None:
        pay(app_url, hold(app_url, "tomas"), "tomas")
        first = ok(get(app_url, "/api/me/bookings", "tomas"))
    if first["next_cursor"] is None:
        for _ in range(PAGE_DEFAULT + 1 - len(first["items"])):
            pay(app_url, hold(app_url, "tomas"), "tomas")
        first = ok(get(app_url, "/api/me/bookings", "tomas"))
    assert len(first["items"]) == PAGE_DEFAULT and first["next_cursor"]
    for lim in (0, PAGE_MAX + 1):
        field_err(get(app_url, "/api/me/bookings", "tomas", {"limit": lim}), "limit", "Ask for 1 to 50 rows.")
    field_err(get(app_url, "/api/me/bookings", "tomas", {"cursor": "not-a-cursor"}), "cursor", "This cursor is not valid.")
    seen, cur, inserted = [], None, None
    for _ in range(400):
        b = ok(get(app_url, "/api/me/bookings", "tomas", {"limit": 3, **({"cursor": cur} if cur else {})}))
        seen += b["items"]
        cur = b["next_cursor"]
        if inserted is None and ours[3] in {r["id"] for r in seen}:
            inserted = pay(app_url, hold(app_url, "tomas", slot=(c, f"{d0}T{t}")), "tomas")["id"]
        if not cur or (inserted and inserted in {r["id"] for r in seen}):
            break
    ids = [r["id"] for r in seen]
    assert len(ids) == len(set(ids)), "a history row was repeated"
    for i in ours + [inserted]:
        assert ids.count(i) == 1, f"booking {i} skipped or repeated"
    keys = [r["start_utc"] for r in seen]
    assert keys == sorted(keys, reverse=True)
    r = [x for x in seen if x["id"] == ours[0]][0]
    assert r["role"] == "organiser" and r["kind"] == "booking" and r["booking_id"] == ours[0] and r["my_payment"] == "paid"


def test_credits_balance_is_ledger(app_url):
    b = pay(app_url, hold(app_url))
    ok(post(app_url, f"/api/bookings/{b['id']}/cancel", {}, "ines"))
    cr = credits(app_url, "ines")
    e = [x for x in cr["entries"] if x["booking_id"] == b["id"]]
    assert [(x["reason"], x["amount_cents"]) for x in e] == [("booking_cancelled", b["total_cents"])]
    assert cr["balance_cents"] == sum(x["amount_cents"] for x in cr["entries"])
    ines_ids = {x["id"] for x in cr["entries"]}
    tok = {u: token(u) for u in ("ines", "tomas")}

    def call(i):
        u = ("ines", "tomas")[i % 2]
        path = "/api/me" if i % 4 < 2 else "/api/me/credits"
        return u, path, httpx.get(app_url + path, headers={"Authorization": f"Bearer {tok[u]}"}, timeout=HTTP_S).json()
    with ThreadPoolExecutor(8) as ex:
        for u, path, body in ex.map(call, range(32)):
            if path == "/api/me":
                assert body["username"] == u
            elif u == "tomas":
                assert not ines_ids & {x["id"] for x in body["entries"]} and b["id"] not in {x["booking_id"] for x in body["entries"]}


@pytest.mark.timeout(5100)
def test_wf_history_credits_journey(browser):
    base = short()
    L = club(base)["match_cutoff_seconds"]
    m = near(base, "tomas", L + 50, levels=(2.5, 4.0))
    ok(join(base, m["id"], "kai"))
    with opened(browser, base) as p:
        p.set_viewport_size({"width": 1280, "height": 900})
        p.context.add_init_script("""window.__seen = false; new MutationObserver(() => {
            if (document.body && document.body.innerText.includes('Kai Brennan')) window.__seen = true; })
            .observe(document, {subtree: true, childList: true, characterData: true});""")
        sign_in(p, base, "kai", "/me")
        more = p.get_by_role("button", name="Load more bookings")
        if more.count() and more.is_visible():
            more.click()
        row = history_row(p, m["start"])
        bal0 = credits(base, "kai")["balance_cents"]
        navs = []
        p.on("framenavigated", lambda f: navs.append(f.url) if f == p.main_frame else None)
        wait_ui(p, lambda: "Cancelled" in row.inner_text(), "the match row never read Cancelled live", secs=150, step=1000)
        bal = credits(base, "kai")["balance_cents"]
        assert bal == bal0 + m["share_cents"]
        wait_ui(p, lambda: f"€{eur(bal)}" in p.get_by_role("region", name="Credits").inner_text(), "balance never rose live")
        assert navs == []
        p.get_by_role("button", name="Account").click()
        p.get_by_role("menuitem", name="Sign out").click()
        p.wait_for_url(lambda u: urlsplit(u).path == "/")
        p.context.clear_cookies(domain=urlsplit(oidc()["token_endpoint"]).hostname)
        p.evaluate("() => { window.__seen = false; }")
        sign_in(p, base, "noor", "/me")
        advance(p, 1000)
        assert NAMES["kai"] not in p.content() and p.evaluate("() => window.__seen") is False
        assert p.get_by_role("table", name="Booking history").get_by_role("row").filter(has_text=m["start"][11:16]).filter(
            has_text=m["start"][:10]).count() == 0


def test_my_bookings_update_in_place(page, app_url, mail):
    b = pay(app_url, hold(app_url, co=CO))
    t = share_tokens(mail, b)["tomas"]
    page.set_viewport_size({"width": 1280, "height": 900})
    sign_in(page, app_url, "tomas", "/me")
    row = history_row(page, b["start"])
    expect(row).to_contain_text("Due")
    rows_before = page.get_by_role("table", name="Booking history").get_by_role("row").count()
    navs = []
    page.on("framenavigated", lambda f: navs.append(f.url) if f == page.main_frame else None)
    amt = ok(post(app_url, f"/api/shares/{t}/pay", {}, "tomas", idempotency_key()))["amount_cents"]
    wait_ui(page, lambda: f"€{eur(amt)} Paid" in row.inner_text(), "the share never read Paid in place", step=1000)
    ok(post(app_url, f"/api/bookings/{b['id']}/cancel", {}, "ines"))
    bal = credits(app_url, "tomas")["balance_cents"]
    wait_ui(page, lambda: "Cancelled" in row.inner_text()
            and f"€{eur(bal)}" in page.get_by_role("region", name="Credits").inner_text(), "row or balance never updated", step=1000)
    assert navs == [] and page.get_by_role("table", name="Booking history").get_by_role("row").count() >= rows_before


def _history_all(base, user):
    out, cur = [], None
    for _ in range(40):
        b = ok(get(base, "/api/me/bookings", user, {"limit": PAGE_MAX, **({"cursor": cur} if cur else {})}))
        out += b["items"]
        cur = b["next_cursor"]
        if not cur:
            return out
    pytest.fail("GET /api/me/bookings never reached a null next_cursor")


def test_my_bookings_refresh_keeps_loaded_position(page, app_url):
    user = "lucia"
    first = ok(get(app_url, "/api/me/bookings", user))
    for _ in range(PAGE_DEFAULT + 2):
        if first["next_cursor"]:
            break
        pay(app_url, hold(app_url, user), user)
        first = ok(get(app_url, "/api/me/bookings", user))
    assert len(first["items"]) == PAGE_DEFAULT and first["next_cursor"], "need more than one page of history"
    trigger = pay(app_url, hold(app_url, user), user)

    page.set_viewport_size({"width": 1280, "height": 900})
    sign_in(page, app_url, user, "/me")
    table = page.get_by_role("table", name="Booking history")
    more = page.get_by_role("button", name="Load more bookings")
    wait_ui(page, lambda: table.get_by_role("row").count() >= PAGE_DEFAULT + 1 and more.count() and more.is_visible(),
            "My bookings never showed its first page with Load more bookings")
    loaded = table.get_by_role("row").count() - 1
    assert loaded == PAGE_DEFAULT, f"first screen showed {loaded} rows; expected the default page of {PAGE_DEFAULT} (L625)"
    last_loaded = ok(get(app_url, "/api/me/bookings", user))["items"][-1]["id"]

    ok(post(app_url, f"/api/bookings/{trigger['id']}/cancel", {}, user))
    bal = credits(app_url, user)["balance_cents"]
    region = page.get_by_role("region", name="Credits")
    wait_ui(page, lambda: f"€{eur(bal)}" in region.inner_text(), "the balance never refreshed", step=1000)
    advance(page, REFRESH_MS + 1000)

    rows = _history_all(app_url, user)
    ids = [r["id"] for r in rows]
    assert last_loaded in ids
    allowed = ids.index(last_loaded) + 1
    assert len(rows) > allowed, "probe: history must extend past the loaded position"
    shown = table.get_by_role("row").count() - 1
    assert shown <= allowed, (f"after a refresh My bookings shows {shown} rows; only {allowed} lie up to the last loaded "
                              f"row, so rows beyond it were loaded without pressing Load more bookings")
    assert more.is_visible(), "Load more bookings disappeared though rows remain past the loaded position"


def test_sign_in_and_roles(app_url):
    me = ok(get(app_url, "/api/me", "kai"))
    assert me["roles"] == ["player"] and me["level"] == 3.0 and me["coach_id"] is None
    assert ok(get(app_url, "/api/me", "marta"))["coach_id"] == "coach-marta"
    assert ok(get(app_url, "/api/me", "rosa"))["push_topic"] == "yardline-desk"
    r = httpx.get(app_url + "/api/manager/pricing", params={"role": "manager"},
                  headers={**H("kai"), "X-Roles": "manager", "X-Role": "manager"}, timeout=HTTP_S)
    err(r, 403, "FORBIDDEN")
    for u, path, params in (("kai", "/api/me", None), ("kai", "/api/me/bookings", None), ("kai", "/api/me/credits", None),
                            ("rosa", "/api/desk/bookings", None), ("elena", "/api/manager/pricing", None),
                            ("marta", "/api/lessons", {"coach_id": "coach-marta"})):
        assert "no-store" in get(app_url, path, u, params).headers.get("Cache-Control", ""), path
    err(get(app_url, "/api/me"), 401, "UNAUTHENTICATED")
    for page_path in ("/me", "/desk"):
        r = httpx.get(app_url + page_path, timeout=HTTP_S)
        assert (r.is_redirect and "/login?return=" in r.headers.get("Location", "")) or r.status_code == 200, (page_path, r.status_code)
    g = grant("tomas")
    hdr = {"Authorization": f"Bearer {g['access_token']}"}
    assert httpx.get(app_url + "/api/me", headers=hdr, timeout=HTTP_S).status_code == 200
    httpx.post(oidc()["end_session_endpoint"], timeout=HTTP_S, data={
        "client_id": os.environ["AUTH_CLIENT_ID"], "client_secret": os.environ["AUTH_CLIENT_SECRET"],
        "refresh_token": g["refresh_token"]})
    err(httpx.get(app_url + "/api/me", headers=hdr, timeout=HTTP_S), 401, "UNAUTHENTICATED")


def test_header_account_pill(page, app_url):
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(app_url + "/")
    expect(page.get_by_role("banner").get_by_role("link", name="Sign in")).to_be_visible()
    sign_in(page, app_url, "elena", "/")
    nav = page.get_by_role("navigation", name="Main")
    for n in ("Desk", "Manager"):
        expect(nav.get_by_role("link", name=n)).to_be_visible()
    page.get_by_role("button", name="Account").click()
    page.get_by_role("menu").get_by_role("menuitem", name="Sign out").click()
    expect(page.get_by_role("banner").get_by_role("link", name="Sign in")).to_be_visible(timeout=UI_S * 1000)
    page.goto(app_url + "/manager")
    with suppress(PWTimeout):
        page.wait_for_url(lambda u: "/manager" not in urlsplit(u).path or not on_app_url(u, app_url), timeout=UI_S * 1000)
    assert "/manager" not in urlsplit(page.url).path or not on_app(page, app_url)
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(app_url + "/")
    page.get_by_role("button", name="Menu").click()
    expect(page.get_by_role("link", name="Matches").first).to_be_visible()


NAMED_422_FIELDS = {"court", "start", "minutes", "note", "description", "co_players", "students", "weeks", "level_min",
                    "level_max", "level", "offpeak_cents_per_minute", "peak_cents_per_minute", "peak_start", "peak_end",
                    "peak_days", "effective_from", "late_fee_percent", "version", "date", "from", "to", "limit",
                    "cursor", "courts"}
ORDER_CASES = ["415_before_401", "413_before_401", "401", "403_before_404", "404_before_422", "422_before_slot_taken", "limit_allowed",
               "413_chunked_before_401", "malformed_json_named_fields", "mistyped_court_field", "412_before_mistyped_422",
               "not_your_coach_id_before_mistyped_422"]


@pytest.mark.parametrize("case", ORDER_CASES, ids=ORDER_CASES)
def test_error_order_and_shape(app_url, case):
    js = {"Content-Type": "application/json"}
    if case == "415_before_401":
        err(httpx.post(app_url + "/api/holds", content=b"court=1", headers={"Content-Type": "text/plain"}, timeout=HTTP_S),
            415, "UNSUPPORTED_MEDIA_TYPE")
    elif case == "413_before_401":
        err(httpx.post(app_url + "/api/holds", content=b'{"note":"' + b"a" * (BODY_LIMIT + 10) + b'"}', headers=js,
                       timeout=HTTP_S), 413, "TOO_LARGE")
    elif case == "401":
        err(post(app_url, "/api/holds", {}), 401, "UNAUTHENTICATED")
    elif case == "403_before_404":
        err(get(app_url, UNKNOWN_BOOKING_PATH, "rosa"), 403, "FORBIDDEN")
    elif case == "404_before_422":
        err(post(app_url, UNKNOWN_BOOKING_PATH + "/pay", {}, "ines", "x" * 101), 404, "NOT_FOUND")
    elif case == "422_before_slot_taken":
        b = hold(app_url)
        r = post(app_url, "/api/holds", {"court": b["court"], "start": b["start"][:16], "minutes": 60,
                                         "note": "a" * (TEXT_LIMIT + 1)}, "tomas", idempotency_key())
        field_err(r, "note", "Keep the note to 280 characters.")
    elif case == "413_chunked_before_401":
        def chunks():
            yield b'{"note":"'
            yield b"a" * (BODY_LIMIT + 10)
            yield b'"}'
        err(httpx.post(app_url + "/api/holds", content=chunks(), headers=js, timeout=HTTP_S), 413, "TOO_LARGE")
    elif case == "malformed_json_named_fields":
        r = httpx.post(app_url + "/api/holds", content=b'{"court":', timeout=HTTP_S,
                       headers={**js, **H("ines"), "Idempotency-Key": idempotency_key()})
        b = err(r, 422, "VALIDATION")
        assert set(b.get("errors") or {}) <= NAMED_422_FIELDS, b
    elif case == "mistyped_court_field":
        _, s = far_slot()
        r = post(app_url, "/api/holds", {"court": 2.5, "start": s, "minutes": 60}, "ines", idempotency_key())
        field_err(r, "court", "Pick a court from 1 to 7.")
        assert set(r.json()["errors"]) <= NAMED_422_FIELDS, r.json()
    elif case == "412_before_mistyped_422":
        cur = pricing(app_url)
        r = put(app_url, "/api/manager/pricing", {"version": cur["version"] - 1, "offpeak_cents_per_minute": "lots",
                                                  "peak_cents_per_minute": cur["peak_cents_per_minute"],
                                                  "peak_start": cur["peak_start"], "peak_end": cur["peak_end"],
                                                  "peak_days": cur["peak_days"], "effective_from": "2089-01-01"},
                "elena")
        err(r, 412, "VERSION_STALE")
        assert pricing(app_url)["version"] == cur["version"]
    elif case == "not_your_coach_id_before_mistyped_422":
        _, s = far_slot()
        r = post(app_url, "/api/lessons", {"coach_id": "coach-probe-none", "court": 2.5, "start": s, "minutes": 60,
                                           "students": [EMAIL["kai"]]}, "marta")
        err(r, 403, "NOT_YOUR_COACH_ID")
    else:
        head = b'{"court":99,"start":"x","minutes":1,"note":"'
        raw = head + b"a" * (BODY_LIMIT - len(head) - 2) + b'"}'
        assert len(raw) == BODY_LIMIT
        r = httpx.post(app_url + "/api/holds", content=raw, headers={**js, **H("ines"), "Idempotency-Key": idempotency_key()},
                       timeout=HTTP_S)
        assert r.status_code == 422 and set(r.json()) <= {"code", "message", "errors"}


def test_verbatim_open_match_announcement(page, app_url):
    c, s = far_slot()
    sign_in(page, app_url, "noor", f"/courts?day={s[:10]}")
    dlg = open_cell(page, c, s[11:])
    tick(dlg.get_by_role("checkbox", name="Open as a match"))
    select(dlg.get_by_role("combobox", name="Lowest level"), "3.5")
    select(dlg.get_by_role("combobox", name="Highest level"), "4.5")
    listen(page)
    dlg.get_by_role("button", name="Open match").click()
    wait_heard(page, "You joined the match.")
    assert times_heard(page, "Slot held for") == 0
    x = grid_cell(app_url, c, s, "noor")
    assert x["state"] == "match" and x["players"] == 1


def wait_health(port, proc, log, want):
    def look():
        if proc.poll() is not None:
            pytest.fail(f"the served copy exited: {Path(log.name).read_text()[-2000:]}")
        with suppress(httpx.TransportError):
            r = httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=5)
            return r if r.status_code == want else None
    return eventually(look, 180, f"copy on {port} never answered health {want}")


def test_health_and_boot(app_url):
    r = get(app_url, "/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    port = 4191
    with tempfile.NamedTemporaryFile("w+", suffix=".log") as log:
        proc = serve_copy(port, log, APP_PUBLIC_PORT=str(port), DATABASE_URL="postgres://x:y@127.0.0.1:9/none")
        try:
            assert wait_health(port, proc, log, 503).json() == {"status": "starting"}
        finally:
            with suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGTERM)


LONG_PROVIDER_MS = 7000
SLOW_OUTAGE_MS = 5000
SLOW_VOID_MS = 5000


def test_idempotent_repeat_while_running_runs_afresh(app_url, wiremock):
    c, s = far_slot(90)
    k = idempotency_key()
    wiremock.stub("POST", "/v1/authorizations", status=503, json={}, delay_ms=SLOW_OUTAGE_MS)
    n0 = len(calls(wiremock, "/v1/authorizations"))
    with ThreadPoolExecutor(1) as ex:
        first = ex.submit(post, app_url, "/api/holds", {"court": c, "start": s, "minutes": 60}, "ines", k)
        eventually(lambda: len(calls(wiremock, "/v1/authorizations")) > n0, 10, "the first hold never reached Courtpay")
        auth_id(wiremock)
        r = post(app_url, "/api/holds", {"court": c, "start": s, "minutes": 90}, "ines", k)
        err(first.result(), 503, "PAYMENT_UNAVAILABLE", HOLD_DOWN)
    b = ok(r, 201)
    assert b["minutes"] == 90 and r.headers.get("Idempotent-Replay") != "true"
    assert booking(app_url, b["id"])["status"] == "held"


@pytest.mark.timeout(120)
def test_idempotent_repeat_waits_for_slow_first(app_url, wiremock):
    a = auth_id(wiremock, delay_ms=LONG_PROVIDER_MS)
    wiremock.stub("POST", f"/v1/authorizations/{a}/void", status=200, json={"id": a, "status": "voided"},
                  delay_ms=LONG_PROVIDER_MS)
    c, s = far_slot()
    k = idempotency_key()
    body = {"court": c, "start": s, "minutes": 60}
    n0 = len(calls(wiremock, "/v1/authorizations"))
    with ThreadPoolExecutor(2) as ex:
        first = ex.submit(post, app_url, "/api/holds", body, "ines", k)
        eventually(lambda: len(calls(wiremock, "/v1/authorizations")) > n0, 10, "the hold never reached Courtpay")
        ok(lesson(app_url, "coach-marta", (c, s)), 201)
        second = ex.submit(post, app_url, "/api/holds", body, "ines", k)
        err(first.result(), 409, "SLOT_TAKEN")
        r = second.result()
    err(r, 409, "SLOT_TAKEN")
    assert r.headers.get("Idempotent-Replay") == "true"
    assert len(calls(wiremock, "/v1/authorizations")) == n0 + 1, "the repeat called Courtpay again"


def test_lost_slot_void_sent_once(app_url, wiremock):
    a = auth_id(wiremock, delay_ms=SLOW_MS)
    vpath = f"/v1/authorizations/{a}/void"
    wiremock.stub("POST", vpath, status=200, json={"id": a, "status": "voided"}, delay_ms=SLOW_VOID_MS)
    c, s = far_slot()
    n0 = len(calls(wiremock, "/v1/authorizations"))
    with ThreadPoolExecutor(1) as ex:
        fut = ex.submit(post, app_url, "/api/holds", {"court": c, "start": s, "minutes": 60}, "ines", idempotency_key())
        eventually(lambda: len(calls(wiremock, "/v1/authorizations")) > n0, 10, "the hold never reached Courtpay")
        ok(lesson(app_url, "coach-marta", (c, s)), 201)
        err(fut.result(), 409, "SLOT_TAKEN")
    assert len(calls(wiremock, vpath)) == 1, "the lost hold's authorisation was voided more than once"
    t = time.monotonic()
    eventually(lambda: time.monotonic() - t > 6, 10, "unreachable")
    assert len(calls(wiremock, vpath)) == 1, "an accepted void was sent again"


@pytest.mark.timeout(5400)
def test_covered_notice_when_rest_void_at_start(mail, ntfy, wiremock):
    base = short()
    cfg = club(base)
    b = pay(base, near(base, "ines", cfg["share_settle_seconds"] + 50, co=CO))
    sh = sorted(b["shares"][1:], key=lambda x: x["position"])
    first, rest = sh[0], sh[1:]
    r_first = f"{b['id']}:{first['position']}"
    wiremock.stub("POST", "/v1/captures", status=201, json={"id": "cap_demo_0001", "status": "captured"},
                  delay_ms=SLOW_MS)
    wait_s = (ts(b["settle_at"]) - server_now(base)).total_seconds() + 20
    eventually(lambda: refs(wiremock, "/v1/captures", r_first), wait_s, "no settlement capture was sent at the instant")
    wiremock.stub("POST", "/v1/captures", status=500, json={})
    eventually(lambda: refs(wiremock, "/v1/captures", f"{b['id']}:{rest[0]['position']}"), 30,
               "the next share's capture was never attempted")
    start_wait = (ts(b["start_utc"]) - server_now(base)).total_seconds() + 30

    def settled():
        x = {s["position"]: s["status"] for s in booking(base, b["id"])["shares"]}
        return x if x[first["position"]] == "covered" and all(x[s["position"]] == "void" for s in rest) else None
    eventually(settled, start_wait, "the first share was not covered and the rest void after the start")
    m = mails(mail, f"Shares covered: {label(b)}", EMAIL["ines"])
    assert len(m) == 1
    assert f"€{eur(first['amount_cents'])} for 1 unpaid shares was charged to your card." in text(m[0])
    pushes(ntfy, topic(base, "ines"), lambda x: x.get("title") == "Shares covered"
           and x.get("message") == f"{label(b)}. Unpaid shares were charged to your card.")


CANCEL_RACERS = 10
CANCEL_ROUNDS = 3


def test_concurrent_cancels_credit_once(app_url, wiremock):
    H("ines")
    for _ in range(CANCEL_ROUNDS):
        b = pay(app_url, hold(app_url))
        gate = threading.Barrier(CANCEL_RACERS)

        def go():
            gate.wait()
            return post(app_url, f"/api/bookings/{b['id']}/cancel", {}, "ines")
        with ThreadPoolExecutor(CANCEL_RACERS) as ex:
            rs = [f.result() for f in [ex.submit(go) for _ in range(CANCEL_RACERS)]]
        won = [r for r in rs if r.status_code == 200]
        assert len(won) == 1, [(r.status_code, r.text[:120]) for r in rs]
        for r in rs:
            if r.status_code != 200:
                err(r, 409, "INVALID_TRANSITION")
        e = [x for x in credits(app_url, "ines")["entries"] if x["booking_id"] == b["id"]]
        assert [(x["reason"], x["amount_cents"]) for x in e] == [("booking_cancelled", b["total_cents"])], e
        assert booking(app_url, b["id"])["status"] == "cancelled"


@pytest.mark.timeout(4900)
def test_cutoff_credits_place_paid_after_cancel(wiremock):
    base = short()
    L = club(base)["match_cutoff_seconds"]
    m = near(base, "noor", L + 25, levels=(2.0, 4.0))
    ok(join(base, m["id"], "tomas"))
    baseline_charges(wiremock, delay_ms=7500)
    reach(base, m, 4)
    with ThreadPoolExecutor(1) as ex:
        fut = ex.submit(join, base, m["id"], "kai")
        eventually(lambda: ok(get(base, f"/api/matches/{m['id']}"))["players"] == 3, 3, "the reserved place was not counted")
        eventually(lambda: server_now(base) >= ts(m["cutoff_at"]), 15, "cut-off not reached")
        assert not fut.done(), "the charge finished before the cut-off, so it did not straddle it"
        eventually(lambda: ok(get(base, f"/api/matches/{m['id']}"))["status"] == "cancelled", 5,
                   "a match with three players (one reserved) was not cancelled at its cut-off")
        r = fut.result()
    assert r.status_code in (200, 409), r.text[:300]
    assert len(refs(wiremock, "/v1/charges", m["id"])) >= 3
    assert ok(get(base, f"/api/matches/{m['id']}"))["status"] == "cancelled"

    def kai_credit():
        e = [x for x in credits(base, "kai")["entries"] if x["match_id"] == m["id"]]
        return e or None
    e = eventually(kai_credit, 20, "the joiner charged for a match cancelled at the cut-off was never credited")
    assert sum(x["amount_cents"] for x in e) == m["share_cents"], e
    for u in ("noor", "tomas"):
        assert [x["reason"] for x in credits(base, u)["entries"] if x["match_id"] == m["id"]] == ["match_cancelled"]


def test_lesson_weeks_validation_and_order(app_url):
    slot = far_slot()
    c, s = slot
    body = {"coach_id": "coach-marta", "court": c, "start": s, "minutes": 60, "weeks": 2.5,
            "students": [EMAIL["kai"], EMAIL["pablo"]]}
    r = post(app_url, "/api/lessons", body, "marta")
    field_err(r, "weeks", "Pick 1 to 8 weeks.")
    assert set(r.json()["errors"]) == {"weeks"}, r.json()
    err(post(app_url, "/api/lessons", {**body, "coach_id": "coach-owen"}, "marta"), 403, "NOT_YOUR_COACH_ID")
    assert grid_cell(app_url, c, s)["state"] == "free"


ALLOWLIST = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "MPL-2.0", "OFL-1.1"}
APP = Path("/app")


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1" and all(isinstance(m[k], str) and m[k] for k in ("install", "build", "serve"))
    assert not re.match(r"\s*(npm|node|npx|go run)\b", m["serve"])


def test_if_third_party_notices():
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notes]
    assert not missing, missing
    assert "Plus Jakarta Sans" in notes and "Manrope" in notes


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad


def test_if_postgres_only():
    assert Postgres().tables()
    assert not [p.name for p in shipped_packages() if NO_STORE_WORD.lower() in p.name.lower()]
    found = []
    for d in project_dirs(APP):
        for f in d.rglob("*") if d != APP else d.glob("*"):
            if "node_modules" in f.parts or ".git" in f.parts or not f.is_file():
                continue
            with suppress(OSError):
                if f.open("rb").read(len(FILE_MAGIC)).startswith(FILE_MAGIC):
                    found.append(str(f))
    assert not found, found


def test_if_service_config_untouched():
    users = {u["username"]: u for u in Keycloak().users()}
    for u, e in EMAIL.items():
        assert u in users and users[u].get("email") == e, u


def test_if_lockfiles_committed():
    names = {f.name for d in project_dirs(APP) for f in d.glob("*")}
    assert {"go.sum", "package-lock.json"} <= names


def test_if_schema_on_every_start(app_url):
    b = pay(app_url, hold(app_url))
    before = pricing(app_url)["schedule"]
    port = 4192
    with tempfile.NamedTemporaryFile("w+", suffix=".log") as log:
        proc = serve_copy(port, log, APP_PUBLIC_PORT=str(port))
        try:
            wait_health(port, proc, log, 200)
            copy = f"http://127.0.0.1:{port}"
            assert booking(copy, b["id"])["status"] == "paid"
            assert pricing(copy)["schedule"] == before
        finally:
            with suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGTERM)
