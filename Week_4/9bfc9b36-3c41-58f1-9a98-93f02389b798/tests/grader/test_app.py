import base64
import hashlib
import hmac
import importlib
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
import unicodedata
import uuid
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal, getcontext
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    advance,
    center,
    check,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    motion,
    open_app,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    state_styles,
    style,
    tab_order,
)


def _load(cls, *modules):
    for m in modules:
        try:
            return getattr(importlib.import_module(m), cls)
        except (ImportError, AttributeError):
            continue
    raise ImportError(f"provider client {cls} not importable from {modules}")


Postgres = _load("Postgres", "conftest", "postgres", "pg", "clients", "providers")
Keycloak = _load("Keycloak", "conftest", "keycloak", "clients", "providers")
S3 = _load("S3", "conftest", "minio", "s3", "clients", "providers")

_NO = object()
HTTP_TIMEOUT = 30
CHUNK = 65536
PAGE_GUARD = 200
POLL_SECONDS = 90
HEALTHY_SECONDS = 90
RACE_SECONDS = 60
UI_SECONDS = 120
SETTLE_REAL = 0.3
POLL_INTERVAL = 0.25
STEP_MS = 100
TICK_MS = 1000
TOKEN_MARGIN = 20
COPY_BOOT_SECONDS = 90
PG_DEFAULT_PORT = 5432
RECOVERY_SECONDS = 30
RECOVERY_SLACK = 15
ISSUE_RECOVERY_SECONDS = 30

SAILMAKER = ("morwenna@tabling.example", "Loft-Bench-2026!")
SAILMAKER_NAME = "Morwenna Teague"
JORY = ("jory@tabling.example", "Cutting-Floor-26!")
SEEDED_EMAILS = [
    "morwenna@tabling.example", "jory@tabling.example", "kit@tabling.example", "maren@owners.example",
    "tobias@owners.example", "ines@owners.example", "rafe@owners.example", "saoirse@owners.example",
    "priya@owners.example",
]
SEEDED_PASSWORDS = ["Loft-Bench-2026!", "Cutting-Floor-26!", "Tape-Measure-26!"]

B01 = {"I": 12400, "J": 3900, "P": 11600, "E": 3800, "LL": 12200, "LP": 5400}
B02 = {"I": 10200, "J": 3150, "P": 9400, "E": 3200, "LL": 9950, "LP": 4300}
B08 = {"I": 13950, "J": 4300, "P": 13080, "E": 4420, "LL": 13700, "LP": 6000}
MEASURED_ON = "2026-01-15"
FIVE = ("seam_overlap_mm", "roach_permille", "tolerance_mm", "min_offcut_width_mm", "min_offcut_length_mm")
FAR_FUTURE = (datetime(2031, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=random.randrange(86400))).strftime(
    "%Y-%m-%dT%H:%M:%SZ")
ROACH_V3 = 1120
FORETRIANGLE_B01 = 24180000
MAINSAIL_B01_V3 = 24684800
HEADSAIL_B01 = 32940000
TENTH_MM_PER_IN = 254
WIDTH_1372 = 1372
USABLE_1356 = 1356
LOT_MAX = 20
REASON_MAX = 200
MAX_PAGE = 50
DEFAULT_PAGE = 20
SEEDED_LINES = 1200
TWIN_SHEETS = 70

ROLL_LENGTH = 30000
LONG_ROLL = 50000
WIDE_CLAIM = ROLL_LENGTH
CLAIM_LEN = 12000
R14_LENGTH = 3200
R14_USED = 3165
R14_AFTER = 35
PANEL9_X = 2681
PANELS_PAIR = 4244266
WASTE_PAIR = 146134
CLAIM_HOLD_DEFAULT = 1200
ONE_MINUTE = 60

RATE_C07 = 5600
MM2_PER_M2 = 1000000
TAX_PERCENT = 20
DEPOSIT_PERCENT = 40
CHARGE_EXAMPLE = 138235
TAX_EXAMPLE = 27647
TOTAL_EXAMPLE = 165882
DEPOSIT_EXAMPLE = 66353
BALANCE_EXAMPLE = 99529

SUBMISSION_LIMIT = 10
SHEET_LIMIT = 30
RATE_WINDOW = 3600
RACERS = 6
JSON_LIMIT = 65536
PHOTO_LIMIT = 5000000

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
EDGE_WIDTHS = [1024, 1023, 600, 599]
GRID_GAP = 16
TAP_MIN = 44
LIFT_PX = 2
LIFT_MS = 120
TRAVEL_MS = 420
COUNT_MS = 320
STEP_FADE_MS = 160
MARKER_MS = 320
ROW_STAGGER_MS = 30
ROW_MS = 200
STAGGER_ROWS = 10
LIVE_POLL_MS = 5000
FLOOR_APPEAR_MS = 10000
VIEWER_REFUSAL_MS = 10000
TIMING_LOW = 0.75
TIMING_HIGH = 1.3
POSITION_TOLERANCE = 0.015
SKEW = 1893456000000
SKEW_BACK = 1577836800000
FORGED_BOAT = "B-99"
FORGED_BOAT_2 = "B-98"
FORGED_ROLL = "R-99"
FORGED_SUB = "S-9999"
FORGED_REVISION = 50
SHORT_ROLL = 5000
TOTALS_ROLL = 7000
SHELF_START = 10000
SHELF_COUNTED = 9500

INCHES_COPY = "That looks like inches. Enter millimetres."
INCH_FIELD_COPY = "Enter inches above 0 with up to two decimals, or feet and inches as 38' 1 1/2\"."
VIEWER_REFUSAL = "That cut sheet is not shared with you."
OUTAGE_ISSUE = "The cut-sheet store is not answering. This cut sheet will be issued as soon as the store is back."
OUTAGE_OWNER = "The cut-sheet store is not answering. Try again in a few minutes."
OUTAGE_PHOTO = "The cut-sheet store is not answering. The tape photo was not saved."
OUTAGE_IDENTITY = "Sign-in is not answering. Try again in a minute."
OUTAGE_DATABASE = "The loft records are not answering. Try again in a minute."
UNAUTH = {"error": "unauthenticated", "message": "Sign in to continue."}
NOT_FOUND = b'{"error":"not_found","message":"Not found."}'

MINIO_DOWN = "APP_MINIO_DOWN_URL"
SHORT_HOLD = "APP_SHORT_HOLD_URL"
MINUTE_HOLD = "APP_MINUTE_HOLD_URL"
TWIN_A = "APP_TWIN_A_URL"
TWIN_B = "APP_TWIN_B_URL"

JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
CSV_HEADER = "line_id,pair_id,posted_at,account,amount_mm2,stock_code,drawing_code,actor_email,reason"
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}

ROLE_TABLE = [
    {"ability": "manage accounts", "sailmaker": "yes", "loft-hand": "no", "yacht-owner": "no"},
    {"ability": "record measurements", "sailmaker": "yes", "loft-hand": "no", "yacht-owner": "no"},
    {"ability": "submit measurements", "sailmaker": "no", "loft-hand": "no", "yacht-owner": "own boats"},
    {"ability": "decide submissions", "sailmaker": "yes", "loft-hand": "no", "yacht-owner": "no"},
    {"ability": "draw and issue sails", "sailmaker": "yes", "loft-hand": "no", "yacht-owner": "no"},
    {"ability": "claim, lay and cut", "sailmaker": "yes", "loft-hand": "assigned drawings with authority", "yacht-owner": "no"},
    {"ability": "manage stock and ledger", "sailmaker": "yes", "loft-hand": "no", "yacht-owner": "no"},
    {"ability": "record payments", "sailmaker": "yes", "loft-hand": "no", "yacht-owner": "no"},
    {"ability": "view cut sheets", "sailmaker": "yes", "loft-hand": "no", "yacht-owner": "while sight is granted"},
]

STANDING_SEED = {
    "maren@owners.example": (27, 22, 1, 1, 18, "True tape"),
    "ines@owners.example": (24, 19, 1, 2, 3, "Steady tape"),
    "tobias@owners.example": (23, 18, 2, 0, 6, "Steady tape"),
    "rafe@owners.example": (21, 18, 1, 0, 18, "True tape"),
    "saoirse@owners.example": (16, 12, 2, 0, 7, "Steady tape"),
    "priya@owners.example": (11, 7, 0, 1, 8, "New tape"),
}


def half(n, d):
    sign = -1 if (n < 0) != (d < 0) else 1
    n, d = abs(n), abs(d)
    return sign * ((2 * n + d) // (2 * d))


def fmt2(hundredths):
    return f"{hundredths // 100}.{hundredths % 100:02d}"


def inch(mm):
    return fmt2(half(mm * 1000, 254))


def sqm(mm2):
    return fmt2(half(mm2 * 100, 1000000))


def sqft(mm2):
    return fmt2(half(mm2 * 10000, 9290304))


def grouped(x):
    whole, dot, frac = str(x).partition(".")
    neg = whole.startswith("-")
    digits = f"{int(whole.lstrip('-')):,}".replace(",", " ")
    return ("-" if neg else "") + digits + dot + frac


def mm_text(mm):
    return f"{grouped(mm)} mm ({grouped(inch(mm))} in)"


def pounds(pence):
    return grouped(f"{pence // 100}.{pence % 100:02d}")


def has_length(text, mm):
    return grouped(mm) in text and grouped(inch(mm)) in text


def has_area(text, mm2):
    return grouped(sqm(mm2)) in text and grouped(sqft(mm2)) in text


def rnd(value):
    return int(value.to_integral_value(rounding=ROUND_HALF_UP))


def construct(luff, foot, w):
    getcontext().prec = 60
    lam = (Decimal(foot) ** 2 + Decimal(luff) ** 2).sqrt()
    s_t = Decimal(foot) ** 2 / lam
    v_t = Decimal(foot) * Decimal(luff) / lam

    def h(s):
        return Decimal(luff) * s / Decimal(foot) if s <= s_t else Decimal(foot) * (lam - s) / Decimal(luff)

    count = int((lam / Decimal(w)).to_integral_value(rounding=ROUND_CEILING))
    out = []
    for k in range(1, count + 1):
        a = Decimal((k - 1) * w)
        b = min(Decimal(k * w), lam)
        verts = [(a, Decimal(0)), (b, Decimal(0)), (b, h(b))]
        if a < s_t < b:
            verts.append((s_t, v_t))
        verts.append((a, h(a)))
        pts = []
        for s, v in verts:
            p = [rnd(v), rnd(s - a)]
            if not pts or pts[-1] != p:
                pts.append(p)
        if len(pts) > 1 and pts[-1] == pts[0]:
            pts.pop()
        out.append(pts)
    return out


def shoelace(outline):
    total = 0
    for i, (x1, y1) in enumerate(outline):
        x2, y2 = outline[(i + 1) % len(outline)]
        total += x1 * y2 - x2 * y1
    return half(abs(total), 2)


def placed(panel, x, y, rotation):
    if rotation == 180:
        return [[panel["length_mm"] - px + x, panel["width_mm"] - py + y] for px, py in panel["outline"]]
    return [[px + x, py + y] for px, py in panel["outline"]]


def csv_field(value, text):
    if value is None:
        return ""
    s = str(value)
    if text and s[:1] in ("=", "+", "-", "@", "\t", "\r"):
        s = "'" + s
    if any(c in s for c in (',', '"', "\n")):
        s = '"' + s.replace('"', '""') + '"'
    return s


def csv_row(l):
    cells = [csv_field(l["line_id"], False), csv_field(l["pair_id"], False), csv_field(l["posted_at"], False),
             csv_field(l["account"], True), csv_field(l["amount_mm2"], False), csv_field(l["stock_code"], True),
             csv_field(l["drawing_code"], True), csv_field(l["actor_email"], True), csv_field(l["reason"], True)]
    return ",".join(cells)


def hexid():
    return uuid.uuid4().hex[:8]


def call(base, method, path, token=None, body=_NO, headers=None, content=None):
    h = dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    kw = {}
    if content is not None:
        kw["content"] = content
    elif body is not _NO and body is not None:
        kw["json"] = body
    return httpx.request(method, base + path, headers=h, timeout=HTTP_TIMEOUT, **kw)


def want(r, status):
    assert r.status_code == status, f"expected {status}, got {r.status_code}: {r.text[:500]}"
    if "json" in r.headers.get("content-type", "") and r.content:
        return r.json()
    return r


def refused(r, status, code, message=None):
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code}: {r.text[:500]}"
    j = r.json()
    assert j["error"] == code, j
    if message is not None:
        assert j["message"] == message, j
    return j


def field_refused(r, field, copy):
    j = refused(r, 422, "invalid", "Check the highlighted fields.")
    assert j["fields"].get(field) == copy, j
    return j


def header_set(r, ignore=("date",)):
    return frozenset((k.lower(), v) for k, v in r.headers.items() if k.lower() not in ignore)


_PAUSE = threading.Event()


def poll(fn, seconds, what):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = fn()
        if result:
            return result
        _PAUSE.wait(POLL_INTERVAL)
    pytest.fail(f"timed out after {seconds}s waiting for: {what}")


def server_now(base):
    r = call(base, "GET", "/api/health")
    return parsedate_to_datetime(r.headers["date"])


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def outage_url(name):
    url = os.environ.get(name)
    if not url:
        pytest.fail(f"{name} is not set in the verifier environment")
    return url


def healthy(base):
    def ok():
        try:
            return call(base, "GET", "/api/health").status_code == 200
        except httpx.HTTPError:
            return False

    poll(ok, HEALTHY_SECONDS, f"{base} became healthy")


_CLIENTS = {}


def _client(key, factory):
    if key not in _CLIENTS:
        _CLIENTS[key] = factory()
    return _CLIENTS[key]


def pg(suffix=""):
    return _client(("pg", suffix), lambda: Postgres(suffix) if suffix else Postgres())


def kc():
    return _client("kc", Keycloak)


def s3(suffix=""):
    return _client(("s3", suffix), lambda: S3(suffix) if suffix else S3())


def rows_with(suffix, table, needle):
    sql = "SELECT count(*) AS n FROM " + table + " t WHERE to_jsonb(t)::text LIKE '%\"" + needle + "\"%'"
    return int(pg(suffix).rows(sql)[0]["n"])


_TOKENS = {}


def sign_in(base, who):
    return call(base, "POST", "/api/session", body={"email": who[0], "password": who[1]})


def tok(base, who):
    key = (base, who[0])
    cached = _TOKENS.get(key)
    if cached and cached[1] > time.monotonic():
        return cached[0]
    j = want(sign_in(base, who), 200)
    _TOKENS[key] = (j["access_token"], time.monotonic() + max(int(j["expires_in"]) - TOKEN_MARGIN, 1))
    return j["access_token"]


def sm(base):
    return tok(base, SAILMAKER)


def new_account(base, role="yacht-owner"):
    h = hexid()
    domain = "tabling.example" if role == "loft-hand" else "owners.example"
    email, name, password = f"probe-{h}@{domain}", f"Probe {h}", f"Probe-{h}-26!"
    a = want(call(base, "POST", "/api/accounts", sm(base), {
        "email": email, "display_name": name, "password": password, "role": role}), 201)
    a.update(who=(email, password), password=password, name=name)
    return a


def record(base, boat_code, key, value, measured_on=MEASURED_ON):
    return call(base, "POST", f"/api/boats/{boat_code}/measurements", sm(base),
                {"dimension": key, "value_mm": value, "measured_on": measured_on})


def new_boat(base, owner_email, dims=B01):
    b = want(call(base, "POST", "/api/boats", sm(base), {
        "name": f"Probe {hexid()}", "class_name": "Halyard 32", "owner_email": owner_email, "notes": "Probe notes"}), 201)
    for k, v in dims.items():
        b = want(record(base, b["code"], k, v), 201)
    return b


def dim(boat, key):
    return next(d for d in boat["dimensions"] if d["key"] == key)


def get_boat(base, code, token=None):
    return want(call(base, "GET", f"/api/boats/{code}", token or sm(base)), 200)


def get_drawing(base, code, token=None):
    return want(call(base, "GET", f"/api/drawings/{code}", token or sm(base)), 200)


def get_claim(base, claim_id):
    return want(call(base, "GET", f"/api/claims/{claim_id}", sm(base)), 200)


def stock(base, code):
    return want(call(base, "GET", f"/api/stock/{code}", sm(base)), 200)


def new_drawing(base, boat_code, sail="mainsail", cloth="C-18"):
    return want(call(base, "POST", "/api/drawings", sm(base), {"boat_code": boat_code, "sail": sail, "cloth_code": cloth}), 201)


def draw(base, code):
    return want(call(base, "POST", f"/api/drawings/{code}/draw", sm(base)), 200)


def new_roll(base, cloth="C-18", length=ROLL_LENGTH, lot=None):
    return want(call(base, "POST", "/api/rolls", sm(base), {
        "cloth_code": cloth, "lot": lot or f"L-{hexid()}", "length_mm": length, "shelf_location": "Rack B"}), 201)


def take(base, token, stock_code, drawing_code, length):
    return call(base, "POST", "/api/claims", token, {"stock_code": stock_code, "drawing_code": drawing_code, "length_mm": length})


def lay(base, token, claim_id, number, pos=None):
    body = {"panel_number": number}
    if pos:
        body.update(x_mm=pos[0], y_mm=pos[1], rotation=pos[2])
    return call(base, "POST", f"/api/claims/{claim_id}/lays", token, body)


def unlay(base, token, claim_id, number):
    return call(base, "DELETE", f"/api/claims/{claim_id}/lays/{number}", token)


def cut(base, token, claim_id, key):
    return call(base, "POST", f"/api/claims/{claim_id}/cut", token, headers={"Idempotency-Key": key})


def assign(base, code, email):
    return want(call(base, "POST", f"/api/drawings/{code}/assign", sm(base), {"loft_hand_email": email}), 200)


def issue(base, code):
    return call(base, "POST", f"/api/drawings/{code}/issue", sm(base))


def grant(base, code, owner_email, ends_at=None):
    body = {"owner_email": owner_email}
    if ends_at:
        body["ends_at"] = ends_at
    return call(base, "POST", f"/api/drawings/{code}/grants", sm(base), body)


def pay(base, code, amount, key, note="Probe payment"):
    return call(base, "POST", f"/api/drawings/{code}/payments", sm(base), {"amount_pence": amount, "note": note},
                headers={"Idempotency-Key": key})


def submit(base, token, boat, body):
    return call(base, "POST", f"/api/boats/{boat}/submissions", token, body)


def mm_submission(key="I", value=None):
    return {"dimension": key, "value_mm": value if value is not None else B01[key], "measured_on": MEASURED_ON, "note": "Probe"}


def rulesets(base):
    out, cursor = [], None
    for _ in range(PAGE_GUARD):
        q = {"limit": MAX_PAGE}
        if cursor:
            q["cursor"] = cursor
        j = want(call(base, "GET", "/api/rulesets?" + urlencode(q), sm(base)), 200)
        out += j["items"]
        cursor = j["next_cursor"]
        if not cursor:
            return out
    pytest.fail("GET /api/rulesets never ended")


def current_ruleset(base):
    return next(r for r in rulesets(base) if r["current"])


def ruleset(base, version):
    return next(r for r in rulesets(base) if r["version"] == version)


def drawn_world(base, cloth="C-18", sail="mainsail", dims=B01, owner=None):
    owner = owner or new_account(base)
    boat = new_boat(base, owner["email"], dims)
    d = draw(base, new_drawing(base, boat["code"], sail, cloth)["code"])
    return {"owner": owner, "boat": boat, "drawing": d, "code": d["code"]}


def nested_world(base, cloth="C-18", sail="mainsail", dims=B01, roll_len=ROLL_LENGTH, claim_len=None, token=None, owner=None):
    w = drawn_world(base, cloth, sail, dims, owner)
    t = token or sm(base)
    roll = new_roll(base, cloth, roll_len)
    c = want(take(base, t, roll["code"], w["code"], claim_len or roll_len), 201)
    for p in w["drawing"]["panels"]:
        want(lay(base, t, c["id"], p["number"]), 201)
    assert get_drawing(base, w["code"])["status"] == "nested"
    w.update(roll=roll, claim=get_claim(base, c["id"]), lot=roll["lot"])
    return w


def cut_world(base, **kw):
    w = nested_world(base, **kw)
    w["cut"] = want(cut(base, sm(base), w["claim"]["id"], idempotency_key()), 200)
    assert w["cut"]["drawing_status"] == "cut"
    return w


def issued_world(base, **kw):
    w = cut_world(base, **kw)
    w["drawing"] = want(issue(base, w["code"]), 200)
    assert w["drawing"]["status"] == "issued"
    return w


def two_roll_world(base, first_len=R14_LENGTH):
    w = drawn_world(base, "C-18", "mainsail", B01)
    lot = f"L-{hexid()}"
    first = new_roll(base, "C-18", first_len, lot)
    a = want(take(base, sm(base), first["code"], w["code"], R14_LENGTH), 201)
    results = {p["number"]: lay(base, sm(base), a["id"], p["number"]) for p in w["drawing"]["panels"]}
    second = new_roll(base, "C-18", ROLL_LENGTH, lot)
    b = want(take(base, sm(base), second["code"], w["code"], WIDE_CLAIM), 201)
    for n, r in results.items():
        if r.status_code != 201:
            want(lay(base, sm(base), b["id"], n), 201)
    w.update(first=first, second=second, a=get_claim(base, a["id"]), b=get_claim(base, b["id"]), results=results, lot=lot)
    return w


def authorised_loft_hand(base):
    lh = new_account(base, "loft-hand")
    start = server_now(base) + timedelta(seconds=3)
    a = want(call(base, "POST", "/api/authorities", sm(base), {"loft_hand_email": lh["email"], "valid_from": iso(start)}), 201)
    poll(lambda: server_now(base) > start, POLL_SECONDS, "server clock passed the authority start")
    lh["authority"] = a["id"]
    return lh


def ledger_walk(base, stock_code=None, limit=MAX_PAGE):
    items, cursor, last = [], None, None
    for _ in range(PAGE_GUARD):
        q = {"limit": limit}
        if stock_code:
            q["stock"] = stock_code
        if cursor:
            q["cursor"] = cursor
        last = want(call(base, "GET", "/api/ledger?" + urlencode(q), sm(base)), 200)
        items += last["items"]
        cursor = last["next_cursor"]
        if not cursor:
            return items, last
    pytest.fail("GET /api/ledger never reached a last page")


def audit_rows(base, target, pages=10):
    out, cursor = [], None
    for _ in range(pages):
        q = {"limit": MAX_PAGE}
        if cursor:
            q["cursor"] = cursor
        j = want(call(base, "GET", "/api/admin/audit?" + urlencode(q), sm(base)), 200)
        out += [r for r in j["items"] if r["target"] == target]
        cursor = j["next_cursor"]
        if not cursor:
            break
    return out


def race(fns):
    barrier = threading.Barrier(len(fns), timeout=RACE_SECONDS)

    def run(fn):
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(fns)) as ex:
        return list(ex.map(run, fns))


def jpeg_bytes():
    return JPEG_MAGIC + b"\xe1\x00\x16Exif\x00\x00probe-exif" + os.urandom(2048) + b"\xff\xd9"


def png_bytes():
    return PNG_MAGIC + os.urandom(2048)


def put_photo(base, mid, data, ctype, token=None):
    return call(base, "PUT", f"/api/measurements/{mid}/photo", token or sm(base), content=data, headers={"Content-Type": ctype})


def latest_measurement(boat, key):
    return dim(boat, key)["measurements"][-1]


def visible(loc):
    try:
        return loc.count() > 0 and loc.first.is_visible()
    except PlaywrightError:
        return False


def seen(page, loc, what, seconds=UI_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if visible(loc):
            return loc.first
        advance(page, STEP_MS)
    pytest.fail(f"expected on screen: {what}")


def absent(page, loc, what, seconds=UI_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not visible(loc):
            return
        advance(page, STEP_MS)
    pytest.fail(f"expected gone from screen: {what}")


def text_of(loc):
    try:
        return loc.first.inner_text() if loc.count() else ""
    except PlaywrightError:
        return ""


def shows(page, loc, text, what, seconds=UI_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if text in text_of(loc):
            return
        advance(page, STEP_MS)
    pytest.fail(f"{what}: expected {text!r}, saw {text_of(loc)!r}")


def shows_where(page, loc, check_text, what, seconds=UI_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check_text(text_of(loc)):
            return text_of(loc)
        advance(page, STEP_MS)
    pytest.fail(f"{what}: saw {text_of(loc)!r}")


def at(page, pattern, what, seconds=UI_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if re.search(pattern, page.url):
            return page.url
        advance(page, STEP_MS)
    pytest.fail(f"{what}: expected address matching {pattern}, at {page.url}")


def tick_until(page, cond, budget_ms, what, step_ms=TICK_MS):
    elapsed = 0
    while elapsed <= budget_ms:
        real = time.monotonic() + SETTLE_REAL
        while time.monotonic() < real:
            try:
                if cond():
                    return elapsed
            except PlaywrightError:
                pass
        advance(page, step_ms)
        elapsed += step_ms
    pytest.fail(f"{what} did not happen within {budget_ms} ms of page time")


def heading(page, name):
    return page.get_by_role("heading", name=name, exact=True)


def status(page):
    return page.get_by_role("status", name="Loft status")


def alert(page):
    return page.get_by_role("alert")


def focused(loc):
    return loc.first.evaluate("el => el === document.activeElement || el.contains(document.activeElement)")


def nesting(page):
    return page.get_by_role("region", name="Nesting")


def panel_button(page, n):
    return nesting(page).get_by_role("button", name=f"Panel {n}", exact=True)


def laid_panel(page, n):
    return nesting(page).get_by_role("img", name=f"Laid panel {n}")


def ghost_of(page, n):
    return nesting(page).get_by_role("img", name=f"Placement of panel {n}")


def outline_of(page, n):
    return nesting(page).get_by_role("img", name=f"Drawing panel {n}")


RECORD_JS = """el => { if (!el.__heard) { el.__heard = [el.textContent || ""];
  new MutationObserver(() => el.__heard.push(el.textContent || "")).observe(el, {childList: true, subtree: true, characterData: true}); } }"""


def listen(page):
    deadline = time.monotonic() + UI_SECONDS
    while time.monotonic() < deadline and status(page).count() == 0:
        advance(page, STEP_MS)
    status(page).first.evaluate(RECORD_JS)


def heard(page):
    return status(page).first.evaluate("el => el.__heard || [el.textContent || '']")


def times_heard(page, copy):
    h = heard(page)
    return sum(1 for i, t in enumerate(h) if copy in t and (i == 0 or copy not in h[i - 1]))


def wait_heard(page, pattern, what, seconds=UI_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        for t in heard(page):
            m = re.search(pattern, t)
            if m:
                return m
        advance(page, STEP_MS)
    pytest.fail(f"status Loft status never announced {what}; heard {heard(page)!r}")


def ui_sign_in(page, base, who):
    if "/signin" not in page.url:
        page.goto(base + "/signin")
    seen(page, heading(page, "Sign in to the loft"), "sign-in heading")
    fill(page.get_by_label("Email", exact=True), who[0])
    fill(page.get_by_label("Password", exact=True), who[1])
    click(page.get_by_role("button", name="Sign in"))
    seen(page, page.get_by_role("button", name="Sign out"), "signed-in navigation")


@contextmanager
def ui(browser, base, who, path=None, size=DESKTOP, reduced=False):
    with open_app(browser, base + "/signin", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size(size)
        if who:
            ui_sign_in(page, base, who)
        if path:
            page.goto(base + path)
        yield page


def timer_seconds(page):
    m = re.search(r"Hold ends in (\d+):(\d\d)", text_of(nesting(page).get_by_role("timer", name="Hold")))
    assert m, f"timer Hold reads {text_of(nesting(page).get_by_role('timer', name='Hold'))!r}"
    return int(m.group(1)) * 60 + int(m.group(2))


def ui_measure(page, key, value, photo=None):
    click(seen(page, page.get_by_role("button", name="Record measurement"), "Record measurement"))
    dlg = seen(page, page.get_by_role("dialog", name="Record measurement"), "dialog Record measurement")
    select(dlg.get_by_role("combobox", name="Dimension"), key)
    fill(dlg.get_by_label("Measured length (mm)"), str(value))
    fill(dlg.get_by_label("Measured on"), MEASURED_ON)
    if photo:
        dlg.get_by_label("Tape photo").set_input_files({"name": photo[0], "mimeType": photo[1], "buffer": photo[2]})
    click(dlg.get_by_role("button", name="Save measurement"))
    return page.get_by_role("dialog", name="Record measurement")


TIMINGS_JS = """el => { const out = []; const ms = v => v.split(',').map(s => s.trim().endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000);
  const cs = getComputedStyle(el);
  if (cs.animationName && cs.animationName !== 'none') { const d = ms(cs.animationDuration), l = ms(cs.animationDelay); d.forEach((x, i) => out.push([x, l[i] ?? l[0]])); }
  for (const a of (window.__boltropeAnims || [])) if (a.target === el || el.contains(a.target)) out.push([a.duration, a.delay]);
  for (const a of el.getAnimations({subtree: true})) { const t = a.effect.getComputedTiming(); out.push([Number(t.duration) || 0, t.delay || 0]); }
  return out; }"""
WAAPI_JS = """() => { if (window.__boltropeAnims) return; window.__boltropeAnims = []; const orig = Element.prototype.animate;
  Element.prototype.animate = function (k, o) { const a = orig.call(this, k, o); const t = a.effect.getTiming();
    window.__boltropeAnims.push({target: this, duration: Number(t.duration) || 0, delay: t.delay || 0}); return a; }; }"""
ALL_TIMINGS_JS = """() => { const out = (window.__boltropeAnims || []).map(a => [a.duration, a.delay]);
  for (const a of document.getAnimations()) { const t = a.effect.getComputedTiming(); out.push([Number(t.duration) || 0, t.delay || 0]); } return out; }"""


def near(value, target):
    return TIMING_LOW * target <= value <= TIMING_HIGH * target


def rect(sample):
    x = sample.get("x", sample.get("left", 0.0))
    y = sample.get("y", sample.get("top", 0.0))
    return x, y, sample.get("width", 0.0), sample.get("height", 0.0)


def touch_drag(page, start, end, steps=8):
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})

    def ev(kind, x, y):
        points = [] if kind == "touchEnd" else [{"x": x, "y": y, "id": 1}]
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

    ev("touchStart", *start)
    for i in range(1, steps + 1):
        ev("touchMove", start[0] + (end[0] - start[0]) * i / steps, start[1] + (end[1] - start[1]) * i / steps)
        advance(page, 20)
    ev("touchEnd", *end)


def strip_fraction_ok(page, n, x_mm, length_mm):
    strip = nesting(page).get_by_role("region", name="Roll strip").bounding_box()
    laid = nesting(page).get_by_role("img", name=f"Laid panel {n}").bounding_box()
    assert strip and laid, f"Laid panel {n} or the roll strip has no box"
    assert abs((laid["x"] - strip["x"]) / strip["width"] - x_mm / length_mm) <= POSITION_TOLERANCE, (laid, strip, x_mm)


def test_wf_cross_cutting_health(app_url):
    r = call(app_url, "GET", "/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    page = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT)
    assert page.status_code == 200 and page.text
    assert want(call(app_url, "GET", "/api/cloths", sm(app_url)), 200)["total"] >= 24


class Relay:
    def __init__(self, port, target):
        self.port, self.target, self.closed, self.sock = port, target, False, None

    def start(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.listen(64)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while not self.closed:
            try:
                client, _ = self.sock.accept()
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
            except OSError:
                time.sleep(SETTLE_REAL)
                continue
            upstream.settimeout(HTTP_TIMEOUT)
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    def _pipe(self, src, dst):
        try:
            while not self.closed:
                data = src.recv(CHUNK)
                if not data:
                    break
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def stop(self):
        self.closed = True
        if self.sock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.sock.close()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def via(url, port, default_port):
    parts = urlsplit(url)
    userinfo = parts.netloc.rsplit("@", 1)[0] + "@" if "@" in parts.netloc else ""
    target = (parts.hostname, parts.port or default_port)
    return urlunsplit((parts.scheme, f"{userinfo}127.0.0.1:{port}", parts.path, parts.query, parts.fragment)), target


@contextmanager
def app_copy(overrides):
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = dict(os.environ)
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile(prefix="boltrope-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=str(DEPLOYED_APP), env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    try:
        yield f"http://127.0.0.1:{port}", proc, Path(log.name)
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        log.close()


def copy_answer(base, proc, log, path, accept, seconds, what, method="GET", body=_NO, token=None):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            pytest.fail(f"app copy exited ({what}); log tail:\n{log.read_text(errors='replace')[-3000:]}")
        try:
            last = call(base, method, path, token, body)
            if accept(last):
                return last
        except httpx.HTTPError:
            pass
        _PAUSE.wait(POLL_INTERVAL)
    pytest.fail(f"{what}; last {getattr(last, 'status_code', None)} {getattr(last, 'text', '')[:300]}; "
                f"log tail:\n{log.read_text(errors='replace')[-2000:]}")


RECOVERY_CASES = ["database", "identity"]


@pytest.mark.timeout(1800)
@pytest.mark.parametrize("dependency", RECOVERY_CASES, ids=RECOVERY_CASES)
def test_wf_cross_cutting_recovery(app_url, dependency):
    for var in ("DATABASE_URL", "KEYCLOAK_URL", "AUTH_ISSUER_URL"):
        if not os.environ.get(var):
            pytest.fail(f"{var} is not set in the verifier environment")
    port = free_port()
    if dependency == "database":
        url, target = via(os.environ["DATABASE_URL"], port, PG_DEFAULT_PORT)
        overrides = {"DATABASE_URL": url}
    else:
        kc_url, target = via(os.environ["KEYCLOAK_URL"], port, 80)
        overrides = {"KEYCLOAK_URL": kc_url}
        if urlsplit(os.environ["AUTH_ISSUER_URL"]).hostname == target[0]:
            overrides["AUTH_ISSUER_URL"] = via(os.environ["AUTH_ISSUER_URL"], port, 80)[0]
    relay = Relay(port, target)
    token = sm(app_url)
    with app_copy(overrides) as (base, proc, log):
        down = copy_answer(base, proc, log, "/api/health", lambda r: r.status_code == 503, COPY_BOOT_SECONDS,
                           "health answers 503 while the dependency is down")
        assert down.json() == {"status": "unavailable", "dependency": dependency}
        if dependency == "database":
            refused(call(base, "GET", "/api/cloths", token), 503, "database_unavailable", OUTAGE_DATABASE)
        else:
            refused(sign_in(base, SAILMAKER), 503, "identity_unavailable", OUTAGE_IDENTITY)
        relay.start()
        try:
            up = copy_answer(base, proc, log, "/api/health", lambda r: r.status_code == 200,
                             RECOVERY_SECONDS + RECOVERY_SLACK, "health recovers after the dependency returns")
            assert up.json() == {"status": "ok"}
            if dependency == "database":
                assert call(base, "GET", "/api/cloths", token).status_code == 200
        finally:
            relay.stop()


def test_session_cookie(app_url):
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    r = sign_in(app_url, owner["who"])
    assert r.status_code == 200
    j = r.json()
    assert j["account"]["email"] == owner["email"] and j["account"]["role"] == "yacht-owner"
    assert isinstance(j["access_token"], str) and j["access_token"] and int(j["expires_in"]) > 0
    cookie = next(c for c in r.headers.get_list("set-cookie") if c.startswith("boltrope_session="))
    attrs = [a.strip().lower() for a in cookie.split(";")]
    for expected in ("HttpOnly", "SameSite=Lax", "Path=/"):
        assert expected.lower() in attrs, (expected, cookie)
    jar = {"Cookie": cookie.split(";", 1)[0]}
    assert call(app_url, "GET", "/api/boats", headers=jar).status_code == 200
    fresh = want(call(app_url, "GET", "/api/session", headers=jar), 200)
    assert fresh["access_token"] and fresh["account"]["email"] == owner["email"]
    w = call(app_url, "POST", f"/api/boats/{boat['code']}/submissions", headers=jar, body=mm_submission())
    assert w.status_code == 401 and w.json() == UNAUTH
    assert want(call(app_url, "GET", "/api/submissions", j["access_token"]), 200)["total"] == 0
    refused(sign_in(app_url, (owner["email"], owner["password"] + "x")), 401, "bad_credentials",
            "That email and password do not match an account.")
    out = call(app_url, "DELETE", "/api/session", j["access_token"], headers=jar)
    assert out.status_code == 204
    cleared = next(c for c in out.headers.get_list("set-cookie") if c.startswith("boltrope_session="))
    assert cleared.split(";", 1)[0] != cookie.split(";", 1)[0], cleared


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


TOKEN_CASES = ["unsigned", "tampered", "wrong-key", "expired", "deleted"]


@pytest.mark.parametrize("case", TOKEN_CASES, ids=TOKEN_CASES)
def test_bearer_tokens_refused(app_url, case):
    owner = new_account(app_url)
    good = want(sign_in(app_url, owner["who"]), 200)["access_token"]
    assert call(app_url, "GET", "/api/boats", good).status_code == 200
    reference = call(app_url, "GET", "/api/boats")
    head, payload, sig = good.split(".")
    claims = json.loads(_unb64(payload))
    if case == "unsigned":
        bad = _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode()) + "." + payload + "."
    elif case == "tampered":
        claims["exp"] = int(claims.get("exp", 0)) + RATE_WINDOW
        bad = head + "." + _b64(json.dumps(claims).encode()) + "." + sig
    elif case == "wrong-key":
        h = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        mac = hmac.new(b"probe-key", f"{h}.{payload}".encode(), hashlib.sha256).digest()
        bad = f"{h}.{payload}.{_b64(mac)}"
    elif case == "expired":
        claims["exp"] = int(claims.get("iat", 1)) - 1
        bad = head + "." + _b64(json.dumps(claims).encode()) + "." + sig
    else:
        assert call(app_url, "DELETE", f"/api/accounts/{owner['id']}", sm(app_url)).status_code == 204
        bad = good
    r = call(app_url, "GET", "/api/boats", bad)
    assert r.status_code == 401 and r.json() == UNAUTH and r.content == reference.content


def test_roles_from_stored_records(app_url):
    a, b = new_account(app_url), new_account(app_url)
    boat = new_boat(app_url, a["email"])
    assert get_boat(app_url, boat["code"], tok(app_url, a["who"]))["owner"]["email"] == a["email"]
    own = call(app_url, "GET", f"/api/boats/{boat['code']}", tok(app_url, a["who"]))
    assert own.headers.get("etag") is None and "notes" not in own.json() and "revision" not in own.json()
    other = call(app_url, "GET", f"/api/boats/{boat['code']}", tok(app_url, b["who"]))
    assert other.status_code == 404 and other.content == NOT_FOUND
    listed = want(call(app_url, "GET", "/api/boats", tok(app_url, b["who"])), 200)
    assert boat["code"] not in [x["code"] for x in listed["items"]]
    refused(call(app_url, "GET", "/api/stock", tok(app_url, b["who"])), 403, "forbidden", "Your role cannot do that.")
    lh = authorised_loft_hand(app_url)
    w = drawn_world(app_url)
    roll = new_roll(app_url)
    assign(app_url, w["code"], lh["email"])
    t = tok(app_url, lh["who"])
    want(take(app_url, t, roll["code"], w["code"], 1000), 201)
    want(call(app_url, "POST", f"/api/authorities/{lh['authority']}/withdraw", sm(app_url)), 200)
    refused(take(app_url, t, roll["code"], w["code"], 1000), 403, "no_cutting_authority",
            "You hold no cutting authority right now.")
    assert len(get_drawing(app_url, w["code"])["claim_ids"]) == 1


def test_wf_security_not_found(app_url):
    t = tok(app_url, new_account(app_url)["who"])
    mid = get_boat(app_url, "B-01")["dimensions"][0]["measurements"][0]["id"]
    pairs = [
        ("GET", "/api/boats/B-01", "/api/boats/B-9999"),
        ("GET", "/api/drawings/BR-0001", "/api/drawings/BR-9999"),
        ("GET", "/api/grants/G-0001", "/api/grants/G-9999"),
        ("GET", "/api/grants/G-0001/cut-sheet", "/api/grants/G-9999/cut-sheet"),
        ("GET", "/api/drawings/BR-0001/account", "/api/drawings/BR-9999/account"),
        ("GET", f"/api/measurements/{mid}/photo", "/api/measurements/probe-missing/photo"),
        ("GET", "/api/stock/R-03", "/api/stock/R-99"),
        ("POST", "/api/boats/B-01/submissions", "/api/boats/B-9999/submissions"),
    ]
    for method, theirs, missing in pairs:
        body = mm_submission() if method == "POST" else _NO
        r1, r2 = call(app_url, method, theirs, t, body), call(app_url, method, missing, t, body)
        for r in (r1, r2):
            assert r.status_code == 404 and r.content == NOT_FOUND, (theirs, r.status_code, r.text)
            assert r.headers.get("set-cookie") is None
        assert header_set(r1) == header_set(r2), (theirs, header_set(r1), header_set(r2))


def test_refusal_ladder(app_url):
    s = sm(app_url)
    assert call(app_url, "GET", "/api/boats/B-9999").status_code == 401
    big = b'{"name":"' + b"x" * (JSON_LIMIT + 1 - 11) + b'"}'
    refused(call(app_url, "POST", "/api/boats", content=big, headers={"Content-Type": "application/json"}), 413, "too_large")
    edge = b'{"name":"' + b"x" * (JSON_LIMIT - 11) + b'"}'
    assert call(app_url, "POST", "/api/boats", s, content=edge, headers={"Content-Type": "application/json"}).status_code != 413
    refused(call(app_url, "POST", "/api/boats", content=b"name=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media")
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    path = f"/api/boats/{boat['code']}"
    refused(call(app_url, "PATCH", path, tok(app_url, owner["who"]), {"name": ""}), 403, "forbidden")
    refused(call(app_url, "PATCH", path, s, {"name": ""}), 428, "precondition_required", "Reload before saving.")
    refused(call(app_url, "PATCH", path, s, {"name": ""}, headers={"If-Match": '"99"'}), 412, "stale_revision")
    refused(call(app_url, "POST", "/api/drawings/BR-0001/assign", s, {"loft_hand_email": "nobody"}), 409, "sealed")
    d = new_drawing(app_url, boat["code"])
    roll = new_roll(app_url)
    refused(take(app_url, s, roll["code"], d["code"], -5), 409, "wrong_state")
    assert get_boat(app_url, boat["code"])["revision"] == 1


def test_mass_assignment_ignored(app_url):
    s = sm(app_url)
    owner = new_account(app_url)
    name = f"Probe {hexid()}"
    b = want(call(app_url, "POST", "/api/boats", s, {
        "name": name, "class_name": "Halyard 32", "owner_email": owner["email"], "notes": "n", "code": FORGED_BOAT,
        "revision": 99, "status": "issued", "owner": {"email": SAILMAKER[0]},
        "foretriangle": {"area_mm2": 1}, "dimensions": [{"key": "I", "value_mm": 1}]}), 201)
    assert b["code"] != FORGED_BOAT and b["revision"] == 1 and b["owner"]["email"] == owner["email"]
    assert all(d["measurements"] == [] for d in b["dimensions"])
    assert b == get_boat(app_url, b["code"])
    p = want(call(app_url, "PATCH", f"/api/boats/{b['code']}", s, {
        "name": name + " II", "revision": FORGED_REVISION, "code": FORGED_BOAT_2, "owner_email": SAILMAKER[0]}, headers={"If-Match": '"1"'}), 200)
    assert p["revision"] == 2 and p["code"] == b["code"] and p["owner"]["email"] == owner["email"] and p["name"] == name + " II"
    assert p == get_boat(app_url, b["code"])
    roll = want(call(app_url, "POST", "/api/rolls", s, {
        "cloth_code": "C-18", "lot": f"L-{hexid()}", "length_mm": SHORT_ROLL, "shelf_location": "Rack B", "remaining_mm": 1,
        "on_hand_mm2": 1, "code": FORGED_ROLL, "kind": "offcut", "width_mm": 1, "revision": 7}), 201)
    assert roll["remaining_mm"] == SHORT_ROLL and roll["kind"] == "roll" and roll["width_mm"] == WIDTH_1372
    assert roll["on_hand_mm2"] == WIDTH_1372 * SHORT_ROLL and roll["revision"] == 1 and roll["code"] != FORGED_ROLL
    sub = want(submit(app_url, tok(app_url, owner["who"]), b["code"], {**mm_submission(), "status": "accepted",
                                                                       "as_submitted": "x", "id": FORGED_SUB}), 201)
    assert sub["status"] == "pending" and sub["as_submitted"] == f"{B01['I']} mm" and sub["id"] != FORGED_SUB


def test_no_secrets_and_csp(app_url):
    secrets = [os.environ[k] for k in ("DATABASE_URL", "AUTH_CLIENT_SECRET", "S3_SECRET_ACCESS_KEY") if os.environ.get(k)]
    secrets += SEEDED_PASSWORDS + [sm(app_url)]
    assets = set()
    for path in ("/", "/signin", "/loft", "/stock", "/owner", "/probe-missing-page"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        csp = r.headers.get("content-security-policy", "")
        directive = next((d for d in csp.split(";") if d.strip().startswith("script-src")), None) or \
            next((d for d in csp.split(";") if d.strip().startswith("default-src")), "")
        assert "'self'" in directive and "'unsafe-inline'" not in directive and "'unsafe-eval'" not in directive, (path, csp)
        assert not re.search(r"<script\b(?![^>]*\bsrc=)[^>]*>\s*[^<\s]", r.text, re.I), path
        assert not re.search(r"<[a-z][^>]*\son[a-z]+\s*=", r.text, re.I), path
        assert r.headers.get("x-powered-by") is None
        for secret in secrets:
            assert secret not in r.text, path
        assets.update(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|mjs|css))"', r.text))
    for asset in assets:
        body = httpx.get(app_url + asset, timeout=HTTP_TIMEOUT).text
        smap = httpx.get(app_url + asset + ".map", timeout=HTTP_TIMEOUT)
        for secret in secrets:
            assert secret not in body and secret not in smap.text, asset
        assert smap.status_code == 404 or "That page is not in the loft." in smap.text, asset
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert "run-manifest-v1" not in r.text and '"devDependencies"' not in r.text and '"compilerOptions"' not in r.text, path


def test_wf_security_unpublished_surface(app_url):
    s = sm(app_url)
    reference = call(app_url, "GET", "/api/boats/B-9999", s)
    assert reference.content == NOT_FOUND
    probes = [("GET", "/api/nope-probe"), ("GET", "/api/admin"), ("PUT", "/api/health"), ("POST", "/api/health"),
              ("HEAD", "/api/boats"), ("OPTIONS", "/api/boats"), ("TRACE", "/api/boats"), ("DELETE", "/api/boats/B-01"),
              ("PUT", "/api/boats/B-01"), ("GET", "/api/boats/B-01/notes"), ("POST", "/api/stock/summary")]
    for token in (None, s):
        for method, path in probes:
            r = httpx.request(method, app_url + path, timeout=HTTP_TIMEOUT, headers={
                **({"Authorization": f"Bearer {token}"} if token else {}), "Origin": "http://probe.example",
                "Access-Control-Request-Method": "PATCH"})
            assert r.status_code == 404, (method, path, r.status_code)
            names = [k.lower() for k in r.headers]
            assert r.headers.get("x-powered-by") is None and r.headers.get("allow") is None and r.headers.get("set-cookie") is None
            assert not any(n.startswith("access-control-") for n in names), (method, path, names)
            if method == "HEAD":
                assert header_set(r, ("date", "content-length")) == header_set(reference, ("date", "content-length"))
            else:
                assert r.content == NOT_FOUND and header_set(r) == header_set(reference), (method, path)


def test_wf_owner_sight_projection(app_url):
    w = issued_world(app_url)
    o, code, s = w["owner"], w["code"], sm(app_url)
    mid = latest_measurement(w["boat"], "P")["id"]
    want(put_photo(app_url, mid, jpeg_bytes(), "image/jpeg"), 200)
    sub = want(submit(app_url, tok(app_url, o["who"]), w["boat"]["code"], mm_submission()), 201)
    want(call(app_url, "POST", f"/api/submissions/{sub['id']}/decision", s, {"decision": "accept", "reason": "ok"}), 200)
    want(pay(app_url, code, 100, idempotency_key()), 201)
    g = want(grant(app_url, code, o["email"]), 201)
    t = tok(app_url, o["who"])
    one = call(app_url, "GET", f"/api/boats/{w['boat']['code']}", t)
    assert one.status_code == 200 and one.headers.get("etag") is None
    boats = want(call(app_url, "GET", "/api/boats", t), 200)["items"]
    for boat in boats + [one.json()]:
        assert "notes" not in boat and "revision" not in boat
        for d in boat["dimensions"]:
            for m in d["measurements"]:
                assert m["photo"] is None or set(m["photo"]) == {"size", "sha256"}
    drawing = get_drawing(app_url, code, t)
    assert set(drawing) == {"code", "boat_code", "boat_name", "sail", "status", "area", "panels", "cut_sheet", "predecessor", "successor"}
    assert all("laid" not in p for p in drawing["panels"]) and set(drawing["cut_sheet"]) == {"sha256", "size", "superseded_by"}
    subs = want(call(app_url, "GET", "/api/submissions", t), 200)["items"]
    assert subs and all("decided_by" not in x for x in subs)
    acct = want(call(app_url, "GET", f"/api/drawings/{code}/account", t), 200)
    assert acct["entries"] and all("recorded_by" not in e for e in acct["entries"])
    texts = [one.text, json.dumps(boats), json.dumps(drawing), json.dumps(subs), json.dumps(acct),
             call(app_url, "GET", f"/api/grants/{g['id']}", t).text, call(app_url, "GET", "/api/my/cut-sheets", t).text]
    for text in texts:
        for leak in (w["lot"], "cut-sheets/", "tape-photos/", SAILMAKER[0], "Probe notes", w["claim"]["id"]):
            assert leak not in text, leak
    refused(call(app_url, "GET", "/api/stock", t), 403, "forbidden")
    assert call(app_url, "GET", f"/api/claims/{w['claim']['id']}", t).content == NOT_FOUND


def test_wf_security_rate_limit_rank(app_url):
    owner, other = new_account(app_url), new_account(app_url)
    mine, theirs = new_boat(app_url, owner["email"]), new_boat(app_url, other["email"])
    t = tok(app_url, owner["who"])
    for _ in range(SUBMISSION_LIMIT):
        want(submit(app_url, t, mine["code"], mm_submission()), 201)
    r = submit(app_url, t, mine["code"], mm_submission())
    refused(r, 429, "rate_limited")
    retry = r.headers["retry-after"]
    assert retry.isdigit() and int(retry) >= 1
    assert r.json()["message"] == f"Too many requests from this account. Try again in {retry} seconds."
    bad = submit(app_url, t, mine["code"], {"dimension": "I", "measured_on": MEASURED_ON, "note": ""})
    refused(bad, 429, "rate_limited")
    hidden = submit(app_url, t, theirs["code"], mm_submission())
    assert hidden.status_code == 404 and hidden.content == NOT_FOUND
    unsigned = call(app_url, "POST", f"/api/boats/{mine['code']}/submissions", body=mm_submission())
    assert unsigned.status_code == 401 and unsigned.json() == UNAUTH
    want(submit(app_url, tok(app_url, other["who"]), theirs["code"], mm_submission()), 201)
    assert want(call(app_url, "GET", "/api/submissions", t), 200)["total"] == SUBMISSION_LIMIT


def test_accounts_in_realm(app_url):
    lh, ow = new_account(app_url, "loft-hand"), new_account(app_url)
    for acc, role in ((lh, "loft-hand"), (ow, "yacht-owner")):
        users = [u for u in kc().users(acc["email"]) if (u.get("email") or u.get("username") or "").lower() == acc["email"]]
        assert len(users) == 1 and users[0].get("enabled") is True
        assert want(sign_in(app_url, acc["who"]), 200)["account"]["role"] == role
    assert call(app_url, "GET", "/api/stock", tok(app_url, lh["who"])).status_code == 200
    assert call(app_url, "GET", "/api/stock", tok(app_url, ow["who"])).status_code == 403
    bad = call(app_url, "POST", "/api/accounts", sm(app_url), {"email": f"probe-{hexid()}@tabling.example",
                                                             "display_name": "x", "password": "Probe-Pass-26!", "role": "sailmaker"})
    assert bad.status_code == 422
    assert call(app_url, "DELETE", f"/api/accounts/{ow['id']}", sm(app_url)).status_code == 204
    assert [u for u in kc().users(ow["email"]) if (u.get("email") or "").lower() == ow["email"]] == []
    refused(sign_in(app_url, ow["who"]), 401, "bad_credentials")
    refused(call(app_url, "POST", "/api/accounts", sm(app_url), {
        "email": ow["email"].upper(), "display_name": "Probe again", "password": "Probe-Again-26!", "role": "yacht-owner"}),
        409, "email_taken", "An account already uses that email.")
    assert [u for u in kc().users(ow["email"]) if (u.get("email") or "").lower() == ow["email"]] == []
    deleted_again = call(app_url, "DELETE", f"/api/accounts/{ow['id']}", sm(app_url))
    assert deleted_again.status_code == 404 and deleted_again.content == NOT_FOUND
    listed, cursor = [], None
    for _ in range(PAGE_GUARD):
        q = {"limit": MAX_PAGE, **({"cursor": cursor} if cursor else {})}
        page_ = want(call(app_url, "GET", "/api/accounts?" + urlencode(q), sm(app_url)), 200)
        listed += [a["id"] for a in page_["items"]]
        cursor = page_["next_cursor"]
        if not cursor:
            break
    assert lh["id"] in listed and ow["id"] not in listed
    field_refused(call(app_url, "POST", "/api/boats", sm(app_url), {
        "name": f"Probe {hexid()}", "class_name": "Halyard 32", "owner_email": ow["email"], "notes": ""}),
        "owner_email", "Choose an owner account.")
    w = drawn_world(app_url)
    assign(app_url, w["code"], lh["email"])
    assert call(app_url, "DELETE", f"/api/accounts/{lh['id']}", sm(app_url)).status_code == 204
    shown = get_drawing(app_url, w["code"])["assigned_to"]
    assert shown == {"email": lh["email"], "display_name": "Former account"}, shown
    field_refused(call(app_url, "POST", f"/api/drawings/{w['code']}/assign", sm(app_url), {"loft_hand_email": lh["email"]}),
                  "loft_hand_email", "Choose a loft hand account.")


VERSIONED_CASES = ["boat", "stock", "ruleset"]


@pytest.mark.parametrize("kind", VERSIONED_CASES, ids=VERSIONED_CASES)
def test_versioned_saves(app_url, kind):
    s = sm(app_url)
    if kind == "boat":
        code = new_boat(app_url, new_account(app_url)["email"], {})["code"]
        path, change, member = f"/api/boats/{code}", {"name": f"Probe {hexid()}"}, "name"
        read = lambda: get_boat(app_url, code)
    elif kind == "stock":
        code = new_roll(app_url)["code"]
        path, change, member = f"/api/stock/{code}", {"shelf_location": "Rack A"}, "shelf_location"
        read = lambda: stock(app_url, code)
    else:
        cur = current_ruleset(app_url)
        v = want(call(app_url, "POST", "/api/rulesets", s, {**{k: cur[k] for k in FIVE}, "effective_at": FAR_FUTURE}), 201)
        path = f"/api/rulesets/{v['version']}"
        change, member = {**{k: cur[k] for k in FIVE}, "tolerance_mm": cur["tolerance_mm"] + 1, "effective_at": FAR_FUTURE}, "tolerance_mm"
        read = lambda: ruleset(app_url, v["version"])
        refused(call(app_url, "PATCH", f"/api/rulesets/{cur['version']}", s, change,
                     headers={"If-Match": f'"{cur["revision"]}"'}), 409, "sealed")
    if kind != "ruleset":
        assert call(app_url, "GET", path, s).headers.get("etag") == f'"{read()["revision"]}"'
    before = read()
    refused(call(app_url, "PATCH", path, s, change), 428, "precondition_required", "Reload before saving.")
    refused(call(app_url, "PATCH", path, s, change, headers={"If-Match": '"7"'}), 412, "stale_revision",
            "Someone saved this first. Reload to see their change.")
    assert read() == before
    saved = want(call(app_url, "PATCH", path, s, change, headers={"If-Match": '"1"'}), 200)
    assert saved["revision"] == 2 and saved[member] == change[member]
    refused(call(app_url, "PATCH", path, s, change, headers={"If-Match": '"1"'}), 412, "stale_revision")


def test_receive_roll(app_url):
    lot = f"L-{hexid()}"
    roll = new_roll(app_url, "C-18", ROLL_LENGTH, lot)
    area = WIDTH_1372 * ROLL_LENGTH
    assert re.fullmatch(r"R-\d{2,}", roll["code"]) and roll["kind"] == "roll" and roll["cloth_code"] == "C-18"
    assert roll["lot"] == lot and roll["width_mm"] == WIDTH_1372 and roll["usable_width_mm"] == USABLE_1356
    assert roll["remaining_mm"] == ROLL_LENGTH and roll["free_mm"] == ROLL_LENGTH and roll["on_hand_mm2"] == area
    assert roll["remaining_in"] == inch(ROLL_LENGTH) and roll["on_hand_m2"] == sqm(area) and roll["on_hand_ft2"] == sqft(area)
    assert roll["shelf_location"] == "Rack B" and roll["revision"] == 1
    lines, last = ledger_walk(app_url, roll["code"])
    assert len(lines) == 2 and last["total"] == 2
    assert lines[0]["pair_id"] == lines[1]["pair_id"] and lines[0]["posted_at"] == lines[1]["posted_at"]
    by_account = {l["account"]: l for l in lines}
    assert by_account[roll["code"]]["amount_mm2"] == area and by_account["supplier-receipt"]["amount_mm2"] == -area
    for l in lines:
        assert l["stock_code"] == roll["code"] and l["reason"] == "Received, full roll" and l["actor_email"] == SAILMAKER[0]
    assert rows_with("", "ledger_line", roll["code"]) == 2
    for bad in ("", "L" * (LOT_MAX + 1)):
        r = call(app_url, "POST", "/api/rolls", sm(app_url), {"cloth_code": "C-18", "lot": bad, "length_mm": 1000, "shelf_location": "Rack B"})
        field_refused(r, "lot", "Enter a lot of 1 to 20 characters.")


def test_wf_loft_setup_journey(app_url, browser):
    h = hexid()
    owner_name, owner_email, boat_name, lot = f"Probe {h}", f"probe-{h}@owners.example", f"Probe {hexid()}", f"L-{hexid()}"
    jpeg = jpeg_bytes()
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        click(seen(page, page.get_by_role("link", name="Open the loft"), "link Open the loft"))
        at(page, r"/signin", "Open the loft goes to sign-in")
        ui_sign_in(page, app_url, SAILMAKER)
        at(page, r"/loft$", "sailmaker home")
        page.goto(app_url + "/accounts")
        click(seen(page, page.get_by_role("button", name="New account"), "New account"))
        dlg = seen(page, page.get_by_role("dialog", name="New account"), "dialog New account")
        fill(dlg.get_by_label("Display name"), owner_name)
        fill(dlg.get_by_label("Email"), owner_email)
        fill(dlg.get_by_label("Password"), f"Probe-{h}-26!")
        select(dlg.get_by_role("combobox", name="Role"), "Yacht owner")
        click(dlg.get_by_role("button", name="Create account"))
        shows(page, status(page), f"Account created for {owner_email}.", "account success copy")
        page.goto(app_url + "/loft")
        click(seen(page, page.get_by_role("button", name="New boat"), "New boat"))
        dlg = seen(page, page.get_by_role("dialog", name="New boat"), "dialog New boat")
        fill(dlg.get_by_label("Boat name"), boat_name)
        fill(dlg.get_by_label("Class", exact=True), "Halyard 32")
        fill(dlg.get_by_label("Notes"), "Probe notes")
        select(dlg.get_by_role("combobox", name="Owner"), owner_name)
        click(dlg.get_by_role("button", name="Create boat"))
        code = at(page, r"/boats/B-\d+$", "boat page").rsplit("/", 1)[1]
        seen(page, heading(page, f"{code} · {boat_name}"), "boat heading")
        for key, value in B01.items():
            absent(page, ui_measure(page, key, value), f"measurement {key} saved")
        dlg = ui_measure(page, "I", 488)
        shows(page, dlg, INCHES_COPY, "unit-slip field copy")
        fill(dlg.get_by_label("Measured length (mm)"), str(B01["I"]))
        click(dlg.get_by_role("button", name="Save measurement"))
        absent(page, dlg, "corrected I saved")
        ui_measure(page, "E", B01["E"], ("tape.jpg", "image/jpeg", png_bytes()))
        shows(page, alert(page), "That content type is not accepted here.", "PNG sent as JPEG refused")
        if visible(page.get_by_role("dialog", name="Record measurement")):
            page.keyboard.press("Escape")
        absent(page, ui_measure(page, "P", B01["P"], ("tape.jpg", "image/jpeg", jpeg)), "P with photo saved")
        table = page.get_by_role("table", name="Rig dimensions")
        shows_where(page, table, lambda t: t.count("Measured") >= 6, "six Measured dimensions")
        shows_where(page, page.locator("body"), lambda t: sqm(FORETRIANGLE_B01) in t and sqft(FORETRIANGLE_B01) in t, "foretriangle poster")
        page.goto(app_url + "/stock")
        click(seen(page, page.get_by_role("button", name="Receive roll"), "Receive roll"))
        dlg = seen(page, page.get_by_role("dialog", name="Receive roll"), "dialog Receive roll")
        select(dlg.get_by_role("combobox", name="Cloth"), "C-18 · Cruising crosscut 8.6 oz")
        fill(dlg.get_by_label("Lot", exact=True), lot)
        fill(dlg.get_by_label("Length (mm)"), str(ROLL_LENGTH))
        fill(dlg.get_by_label("Shelf location"), "Rack B")
        click(dlg.get_by_role("button", name="Receive"))
        listen(page)
        roll_code = wait_heard(page, r"Roll (R-\d+) received\.", "receive copy").group(1)
        card = page.get_by_role("list", name="Rolls and offcuts").get_by_role("listitem").filter(
            has=page.get_by_role("link", name=roll_code, exact=True))
        shows(page, card, lot, "shelf card shows the lot")
    boat = get_boat(app_url, code)
    assert boat["owner"]["email"] == owner_email and all(d["status"] == "measured" for d in boat["dimensions"])
    photo = latest_measurement(boat, "P")["photo"]
    assert photo and photo["sha256"] == hashlib.sha256(jpeg).hexdigest()
    assert s3().get(photo["key"]) == jpeg
    lines, _ = ledger_walk(app_url, roll_code)
    assert sorted(l["account"] for l in lines) == sorted([roll_code, "supplier-receipt"])


def test_landing_routes(app_url, browser):
    owner = new_account(app_url)
    issued = issued_world(app_url)
    nest = nested_world(app_url)
    boat_name = f"Probe {hexid()}"
    with ui(browser, app_url, SAILMAKER, "/loft") as page:
        click(seen(page, page.get_by_role("button", name="New boat"), "New boat"))
        dlg = seen(page, page.get_by_role("dialog", name="New boat"), "dialog")
        fill(dlg.get_by_label("Boat name"), boat_name)
        fill(dlg.get_by_label("Class", exact=True), "Halyard 32")
        select(dlg.get_by_role("combobox", name="Owner"), owner["name"])
        click(dlg.get_by_role("button", name="Create boat"))
        code = at(page, r"/boats/B-\d+$", "new boat address").rsplit("/", 1)[1]
        h = seen(page, heading(page, f"{code} · {boat_name}"), "boat heading")
        assert focused(h)
        page.reload()
        seen(page, heading(page, f"{code} · {boat_name}"), "boat heading after reload")
        page.goto(app_url + "/loft")
        click(seen(page, page.get_by_role("button", name="New drawing"), "New drawing"))
        dlg = seen(page, page.get_by_role("dialog", name="New drawing"), "dialog")
        select(dlg.get_by_role("combobox", name="Boat"), f"{code} · {boat_name}")
        select(dlg.get_by_role("combobox", name="Sail"), "Mainsail")
        select(dlg.get_by_role("combobox", name="Cloth"), "C-18 · Cruising crosscut 8.6 oz")
        click(dlg.get_by_role("button", name="Create drawing"))
        dcode = re.search(r"/drawings/(BR-\d+)/draw$", at(page, r"/drawings/BR-\d+/draw$", "first unmet step")).group(1)
        assert focused(seen(page, heading(page, f"Draw {dcode}"), "draw heading"))
        page.reload()
        seen(page, heading(page, f"Draw {dcode}"), "draw heading after reload")
        page.goto(app_url + "/stock")
        click(seen(page, page.get_by_role("button", name="Receive roll"), "Receive roll"))
        dlg = seen(page, page.get_by_role("dialog", name="Receive roll"), "dialog")
        select(dlg.get_by_role("combobox", name="Cloth"), "C-18 · Cruising crosscut 8.6 oz")
        fill(dlg.get_by_label("Lot", exact=True), f"L-{hexid()}")
        fill(dlg.get_by_label("Length (mm)"), str(ROLL_LENGTH))
        fill(dlg.get_by_label("Shelf location"), "Rack B")
        click(dlg.get_by_role("button", name="Receive"))
        absent(page, dlg, "receive dialog closes")
        at(page, r"/stock$", "receive stays on stock")
        active = page.evaluate("() => document.activeElement && (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').trim()")
        assert re.fullmatch(r"Count R-\d+", active or ""), active
        page.goto(app_url + f"/drawings/{issued['code']}")
        click(seen(page, page.get_by_role("button", name="Revise drawing"), "Revise drawing"))
        succ = re.search(r"/drawings/(BR-\d+)$", at(page, rf"/drawings/(?!{issued['code']})BR-\d+$", "successor overview")).group(1)
        assert focused(seen(page, heading(page, succ), "successor heading"))
        assert get_drawing(app_url, succ)["predecessor"] == issued["code"]
        page.goto(app_url + f"/drawings/{nest['code']}/confirm")
        click(seen(page, page.get_by_role("button", name=f"Confirm cut on {nest['roll']['code']}"), "Confirm cut on row"))
        at(page, rf"/drawings/{nest['code']}$", "cut lands on the overview")
        assert focused(seen(page, heading(page, nest["code"]), "overview heading"))
        page.reload()
        seen(page, heading(page, nest["code"]), "overview after reload")
        click(page.get_by_role("button", name="Sign out"))
        at(page, r"^[^?#]*://[^/]+/$", "sign out lands on /")
    assert get_drawing(app_url, nest["code"])["status"] == "cut"


def test_wf_loft_setup_twin_boot(app_url):
    a, b = outage_url(TWIN_A), outage_url(TWIN_B)
    healthy(a)
    healthy(b)
    seeded = [f"B-{i:02d}" for i in range(1, 13)]
    views = []
    for base in (a, b):
        items = want(call(base, "GET", f"/api/boats?limit={MAX_PAGE}", sm(base)), 200)["items"]
        views.append({x["code"]: x for x in items if x["code"] in seeded})
    assert len(views[0]) == 12 and views[0] == views[1]
    assert rows_with("_twin", "ledger_line", "Opening count") == 16
    assert len(s3("-twin").keys("cut-sheets/")) == TWIN_SHEETS
    for email in SEEDED_EMAILS:
        assert len([u for u in kc().users(email) if (u.get("email") or "").lower() == email]) == 1
    owner = new_account(a)
    one = want(call(a, "POST", "/api/boats", sm(a), {"name": "Probe twin", "class_name": "Halyard 32", "owner_email": owner["email"], "notes": ""}), 201)
    two = want(call(b, "POST", "/api/boats", sm(b), {"name": "Probe twin", "class_name": "Halyard 32", "owner_email": owner["email"], "notes": ""}), 201)
    assert int(two["code"].split("-")[1]) == int(one["code"].split("-")[1]) + 1


def test_wf_loft_setup_one_email(app_url):
    h = hexid()
    composed = unicodedata.normalize("NFC", f"cafe\u0301-{h}@owners.example")
    first = want(call(app_url, "POST", "/api/accounts", sm(app_url), {"email": f"cafe\u0301-{h}@owners.example",
                                                                    "display_name": "Probe Cafe", "password": f"Probe-{h}-26!", "role": "yacht-owner"}), 201)
    assert first["email"] == composed
    refused(call(app_url, "POST", "/api/accounts", sm(app_url), {"email": f"CAF\u00c9-{h}@Owners.example",
                                                               "display_name": "x", "password": f"Probe-{h}-26!", "role": "yacht-owner"}),
            409, "email_taken", "An account already uses that email.")
    email = f"probe-race-{hexid()}@owners.example"
    variants = [email, email.upper(), email.capitalize()] * (RACERS // 3)
    results = race([lambda e=e: call(app_url, "POST", "/api/accounts", sm(app_url), {
        "email": e, "display_name": "Probe race", "password": "Probe-Race-26!", "role": "yacht-owner"}) for e in variants])
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1 and all(c == 409 for c in codes if c != 201), codes
    assert all(r.json()["error"] == "email_taken" for r in results if r.status_code == 409)
    assert len([u for u in kc().users(email) if (u.get("email") or "").lower() == email]) == 1
    assert len([u for u in kc().users() if (u.get("email") or "") == composed]) == 1


def test_tolerance_remeasure(app_url):
    tol = current_ruleset(app_url)["tolerance_mm"]
    boat = new_boat(app_url, new_account(app_url)["email"])
    main = new_drawing(app_url, boat["code"], "mainsail", "C-18")
    head = new_drawing(app_url, boat["code"], "headsail", "C-06")
    out = B01["P"] + tol + 1
    p = dim(want(record(app_url, boat["code"], "P", out), 201), "P")
    assert p["status"] == "remeasure" and p["value_mm"] == out and re.fullmatch(r"\d{4}-\d{2}-\d{2}", p["remeasure_due"])
    d = get_drawing(app_url, main["code"])
    assert d["status"] == "remeasure" and d["step"] == "measure"
    refused(call(app_url, "POST", f"/api/drawings/{main['code']}/draw", sm(app_url)), 409, "remeasure_required",
            "Remeasure the flagged dimensions before drawing this sail.")
    assert get_drawing(app_url, head["code"])["status"] == "measuring"
    assert draw(app_url, head["code"])["status"] == "drawn"
    p = dim(want(record(app_url, boat["code"], "P", out + tol), 201), "P")
    assert p["status"] == "measured" and p["remeasure_due"] is None
    assert get_drawing(app_url, main["code"])["status"] == "measuring"
    assert draw(app_url, main["code"])["status"] == "drawn"


def test_remeasure_due_working_days(app_url):
    tol = current_ruleset(app_url)["tolerance_mm"]
    code = new_boat(app_url, new_account(app_url)["email"])["code"]
    i = dim(want(record(app_url, code, "I", B01["I"] + tol + 1, "2026-12-24"), 201), "I")
    assert i["status"] == "remeasure" and i["remeasure_due"] == "2027-01-05"
    j = dim(want(record(app_url, code, "J", B01["J"] + tol + 1, "2026-10-29"), 201), "J")
    assert j["remeasure_due"] == "2026-11-05"


def test_photo_store_confirmation(app_url):
    down = outage_url(MINIO_DOWN)
    owner, stranger = new_account(app_url), new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    mid = latest_measurement(boat, "P")["id"]
    data = jpeg_bytes()
    sha = hashlib.sha256(data).hexdigest()
    d = want(put_photo(app_url, mid, data, "image/jpeg"), 200)
    photo = next(m for m in dim(d, "P")["measurements"] if m["id"] == mid)["photo"] if "dimensions" in d else \
        next(m for m in d["measurements"] if m["id"] == mid)["photo"]
    key = f"tape-photos/{boat['code']}/{mid}/{sha}.jpg"
    assert photo == {"key": key, "size": len(data), "sha256": sha, "content_type": "image/jpeg"}
    assert s3().get(key) == data
    assert call(app_url, "GET", f"/api/measurements/{mid}/photo", tok(app_url, owner["who"])).content == data
    assert call(app_url, "GET", f"/api/measurements/{mid}/photo", tok(app_url, stranger["who"])).content == NOT_FOUND
    mid2 = latest_measurement(boat, "E")["id"]
    refused(put_photo(down, mid2, jpeg_bytes(), "image/jpeg", sm(down)), 503, "store_unavailable", OUTAGE_PHOTO)
    assert latest_measurement(get_boat(app_url, boat["code"]), "E")["photo"] is None
    assert s3().keys(f"tape-photos/{boat['code']}/{mid2}/") == []
    refused(call(down, "GET", f"/api/measurements/{mid}/photo", sm(down)), 503, "store_unavailable", OUTAGE_PHOTO)


def test_owner_rate_limit(app_url):
    down = outage_url(MINIO_DOWN)
    w = issued_world(app_url)
    owner, code = w["owner"], w["boat"]["code"]
    other = new_account(app_url)
    other_boat = new_boat(app_url, other["email"])
    field_refused(submit(app_url, tok(app_url, owner["who"]), code, {"dimension": "I", "measured_on": MEASURED_ON, "note": ""}),
                  "value_mm", "Enter the figure in mm or in inches, not both.")
    for n in range(SUBMISSION_LIMIT):
        base = app_url if n % 2 == 0 else down
        want(submit(base, tok(base, owner["who"]), code, mm_submission()), 201)
    for base in (app_url, down):
        r = submit(base, tok(base, owner["who"]), code, mm_submission())
        refused(r, 429, "rate_limited")
        retry = r.headers["retry-after"]
        assert retry.isdigit() and 1 <= int(retry) <= RATE_WINDOW
        assert r.json()["message"] == f"Too many requests from this account. Try again in {retry} seconds."
    assert want(call(app_url, "GET", "/api/submissions", tok(app_url, owner["who"])), 200)["total"] == SUBMISSION_LIMIT
    want(submit(app_url, tok(app_url, other["who"]), other_boat["code"], mm_submission()), 201)
    g = want(grant(app_url, w["code"], owner["email"]), 201)
    g2 = want(grant(app_url, w["code"], other["email"]), 201)
    for _ in range(SHEET_LIMIT):
        want(call(app_url, "GET", f"/api/grants/{g['id']}/cut-sheet", tok(app_url, owner["who"])), 200)
    r = call(app_url, "GET", f"/api/grants/{g['id']}/cut-sheet", tok(app_url, owner["who"]))
    refused(r, 429, "rate_limited", f"Too many requests from this account. Try again in {r.headers.get('retry-after')} seconds.")
    want(call(app_url, "GET", f"/api/grants/{g2['id']}/cut-sheet", tok(app_url, other["who"])), 200)


def test_wf_rig_measurement_owner_journey(app_url, browser):
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    typed = "38\u2019 1 1/2\u201d"
    with ui(browser, app_url, owner["who"], "/owner") as page:
        seen(page, heading(page, "My boats"), "My boats")
        click(seen(page, page.get_by_role("button", name="Submit measurement"), "Submit measurement"))
        dlg = seen(page, page.get_by_role("dialog", name="Submit measurement"), "dialog")
        select(dlg.get_by_role("combobox", name="Dimension"), "P")
        select(dlg.get_by_role("combobox", name="Unit"), "in")
        fill(dlg.get_by_label("Measured length"), typed)
        fill(dlg.get_by_label("Measured on"), MEASURED_ON)
        fill(dlg.get_by_label("Note"), "Probe")
        click(dlg.get_by_role("button", name="Send to the loft"))
        shows(page, status(page), "Submission sent to the loft.", "submission success copy")
        shows(page, page.get_by_role("table", name="My submissions"), f"{typed} · 11 621 mm (457.52 in)", "figure as typed")
        sub = want(call(app_url, "GET", "/api/submissions", tok(app_url, owner["who"])), 200)["items"][0]
        assert sub["as_submitted"] == typed and sub["value_mm"] == 11621 and sub["status"] == "pending"
        want(call(app_url, "POST", f"/api/submissions/{sub['id']}/decision", sm(app_url), {"decision": "accept", "reason": "ok"}), 200)
        page.reload()
        shows(page, page.get_by_role("table", name="My submissions"), typed, "figure kept after the decision")
    mine = want(call(app_url, "GET", "/api/submissions", tok(app_url, owner["who"])), 200)["items"][0]
    assert mine["status"] == "accepted" and mine["as_submitted"] == typed
    p = dim(get_boat(app_url, boat["code"]), "P")
    assert p["value_mm"] == 11621 and p["status"] == "remeasure" and p["remeasure_due"]


def test_unit_slip_guard_and_decimal_inches(app_url):
    tol = current_ruleset(app_url)["tolerance_mm"]
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    t = tok(app_url, owner["who"])
    field_refused(submit(app_url, t, boat["code"], mm_submission("P", 457)), "value_mm", INCHES_COPY)
    b08 = new_boat(app_url, owner["email"], {"I": B08["I"]})
    r = record(app_url, b08["code"], "I", 550)
    if abs(half(550 * TENTH_MM_PER_IN, 10) - B08["I"]) <= tol:
        field_refused(r, "value_mm", INCHES_COPY)
    else:
        want(r, 201)
    field_refused(record(app_url, boat["code"], "I", 488), "value_mm", INCHES_COPY)
    i = dim(want(record(app_url, boat["code"], "I", 489), 201), "I")
    assert i["value_mm"] == 489 and i["status"] == "remeasure"
    for text, mm in (("456.70", 11600), ("456.69", 11600), ("458.27", 11640), ("457.50", 11621), ("457", 11608)):
        s = want(submit(app_url, t, boat["code"], {"dimension": "P", "value_in": text, "measured_on": MEASURED_ON, "note": ""}), 201)
        assert s["value_mm"] == mm and s["as_submitted"] == f"{text} in" and s["value_in"] == inch(mm)
    for bad in ("45.678", "0", "-3", "4,5", ".5"):
        field_refused(submit(app_url, t, boat["code"], {"dimension": "P", "value_in": bad, "measured_on": MEASURED_ON, "note": ""}),
                      "value_in", INCH_FIELD_COPY)
    both = submit(app_url, t, boat["code"], {"dimension": "P", "value_mm": 11600, "value_in": "456.70", "measured_on": MEASURED_ON, "note": ""})
    field_refused(both, "value_mm", "Enter the figure in mm or in inches, not both.")
    huge = submit(app_url, t, boat["code"], {"dimension": "P", "value_in": "2400.00", "measured_on": MEASURED_ON, "note": ""})
    j = refused(huge, 422, "invalid")
    assert "Enter whole millimetres from 1 to 60000." in j["fields"].values()


FEET_OK = [("38' 0 11/16\"", 11600), ("38' 1 1/2\"", 11621), ("38\u2019 1 1/2\u201d", 11621), ("38\u2019 1 1/2\"", 11621)]
FEET_BAD = ["38' 1 2/4\"", "38' 12\"", "038' 1\"", "38'  1\"", "38' 1 1/3\"", "0' 0\"", "197' 0\""]


def test_feet_inches_sixteenths(app_url):
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    t = tok(app_url, owner["who"])
    for text, mm in FEET_OK:
        s = want(submit(app_url, t, boat["code"], {"dimension": "P", "value_in": text, "measured_on": MEASURED_ON, "note": ""}), 201)
        assert s["value_mm"] == mm and s["as_submitted"] == text, (text, s)
    for text in FEET_BAD:
        field_refused(submit(app_url, t, boat["code"], {"dimension": "P", "value_in": text, "measured_on": MEASURED_ON, "note": ""}),
                      "value_in", INCH_FIELD_COPY)
    assert want(call(app_url, "GET", "/api/submissions", t), 200)["total"] == len(FEET_OK)


def test_wf_rig_measurement_photo_bytes(app_url):
    boat = new_boat(app_url, new_account(app_url)["email"])
    for key, ctype, data, ext in (("P", "image/jpeg", jpeg_bytes(), "jpg"), ("E", "image/png", png_bytes(), "png")):
        mid = latest_measurement(boat, key)["id"]
        sha = hashlib.sha256(data).hexdigest()
        want(put_photo(app_url, mid, data, ctype), 200)
        r = call(app_url, "GET", f"/api/measurements/{mid}/photo", sm(app_url))
        assert r.status_code == 200 and r.content == data and r.headers["content-type"].startswith(ctype)
        assert r.headers["etag"] == f'"{sha}"' and int(r.headers["content-length"]) == len(data)
        prefix = f"tape-photos/{boat['code']}/{mid}/"
        assert s3().keys(prefix) == [f"{prefix}{sha}.{ext}"]
        want(put_photo(app_url, mid, data, ctype), 200)
        assert s3().keys(prefix) == [f"{prefix}{sha}.{ext}"]
        refused(put_photo(app_url, mid, data + b"x", ctype), 409, "photo_exists", "This measurement already has its tape photo.")
        assert s3().keys(prefix) == [f"{prefix}{sha}.{ext}"] and s3().get(f"{prefix}{sha}.{ext}") == data


def test_photo_signature_and_headers(app_url):
    boat = new_boat(app_url, new_account(app_url)["email"])
    mid = latest_measurement(boat, "P")["id"]
    prefix = f"tape-photos/{boat['code']}/{mid}/"
    for data, ctype in ((png_bytes(), "image/jpeg"), (b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "image/png"),
                        (b"<html><body>x</body></html>", "image/jpeg"), (jpeg_bytes(), "text/plain"), (jpeg_bytes(), "image/svg+xml")):
        refused(put_photo(app_url, mid, data, ctype), 415, "unsupported_media", "That content type is not accepted here.")
    big = JPEG_MAGIC + b"\x00" * (PHOTO_LIMIT + 1 - len(JPEG_MAGIC))
    refused(put_photo(app_url, mid, big, "image/jpeg"), 413, "too_large", "That is larger than the loft accepts.")
    assert latest_measurement(get_boat(app_url, boat["code"]), "P")["photo"] is None and s3().keys(prefix) == []
    data = png_bytes()
    want(put_photo(app_url, mid, data, "image/png"), 200)
    r = call(app_url, "GET", f"/api/measurements/{mid}/photo", sm(app_url))
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"] == f'inline; filename="{mid}.png"'
    assert r.headers["cache-control"] == "private, no-store"


def test_areas_on_server(app_url, browser):
    boat = new_boat(app_url, new_account(app_url)["email"])
    cur = current_ruleset(app_url)
    fore = boat["foretriangle"]
    assert fore["area_mm2"] == FORETRIANGLE_B01 and fore["area_m2"] == "24.18" and fore["area_ft2"] == "260.27"
    assert fore["basis"] == f"I × J / 2 · tolerance ±{cur['tolerance_mm']} mm · rule set v{cur['version']}"
    main = draw(app_url, new_drawing(app_url, boat["code"], "mainsail", "C-07")["code"])
    rs = ruleset(app_url, main["ruleset_version"])
    roach = rs["roach_permille"]
    area = half(B01["P"] * B01["E"] * roach, 2000)
    if roach == ROACH_V3:
        assert area == MAINSAIL_B01_V3
    assert main["area"] == {"area_mm2": area, "area_m2": sqm(area), "area_ft2": sqft(area),
                            "basis": f"P × E / 2 × {roach // 1000}.{roach % 1000:03d} · tolerance ±{rs['tolerance_mm']} mm · rule set v{rs['version']}"}
    head = draw(app_url, new_drawing(app_url, boat["code"], "headsail", "C-06")["code"])
    hrs = ruleset(app_url, head["ruleset_version"])
    assert head["area"]["area_mm2"] == HEADSAIL_B01 and head["area"]["area_m2"] == sqm(HEADSAIL_B01)
    assert head["area"]["basis"] == f"LP × LL / 2 · tolerance ±{hrs['tolerance_mm']} mm · rule set v{hrs['version']}"
    with ui(browser, app_url, SAILMAKER, f"/boats/{boat['code']}") as page:
        shows_where(page, page.locator("body"), lambda t: has_area(t, FORETRIANGLE_B01), "boat page foretriangle digits")
        page.goto(app_url + f"/drawings/{main['code']}/draw")
        region = page.get_by_role("region", name="Sail area")
        shows_where(page, region, lambda t: has_area(t, area) and main["area"]["basis"] in t, "draw step area and basis")


def test_paired_units(app_url, browser):
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    for d in boat["dimensions"]:
        assert d["value_in"] == inch(d["value_mm"]) and all(m["value_in"] == inch(m["value_mm"]) for m in d["measurements"])
    roll = new_roll(app_url, "C-18", 12345)
    assert roll["remaining_in"] == inch(12345) and roll["after_laid_in"] == inch(12345)
    assert roll["on_hand_m2"] == sqm(WIDTH_1372 * 12345) and roll["on_hand_ft2"] == sqft(WIDTH_1372 * 12345)
    drawing = draw(app_url, new_drawing(app_url, boat["code"])["code"])
    assert all(p["area_m2"] == sqm(p["area_mm2"]) and p["area_ft2"] == sqft(p["area_mm2"]) for p in drawing["panels"])
    sub = want(submit(app_url, tok(app_url, owner["who"]), boat["code"], {"dimension": "P", "value_in": "456.70", "measured_on": MEASURED_ON, "note": ""}), 201)
    assert sub["value_mm"] == 11600 and sub["value_in"] == "456.69"
    with ui(browser, app_url, SAILMAKER, f"/boats/{boat['code']}") as page:
        row = page.get_by_role("table", name="Rig dimensions").get_by_role("row").filter(has_text="11 600")
        shows_where(page, row, lambda t: has_length(t, B01["P"]), "P in mm then inches")
    with ui(browser, app_url, owner["who"], "/owner") as page:
        shows(page, page.get_by_role("table", name="My submissions"), "456.70 in · 11 600 mm (456.69 in)", "owner figure as sent")


PANEL_CASES = {
    "BR-0191": ("mainsail", "C-07", "B01", 900, 14),
    "BR-0132": ("headsail", "C-06", "B02", 1356, 9),
    "BR-0141": ("mainsail", "C-18", "B01", 1356, 10),
}
WORKED = {
    "BR-0191": {1: ([[0, 0], [0, 885], [2702, 885]], 2702, 885, 1195635), 14: ([[0, 0], [0, 702], [230, 0]], None, None, 80730)},
    "BR-0132": {1: ([[0, 0], [0, 1341], [3103, 1341]], 3103, None, None),
                2: ([[0, 0], [0, 1341], [3525, 1341], [3947, 365], [3103, 0]], 3947, None, None),
                3: ([[0, 0], [0, 1341], [2946, 1341], [3525, 0]], 3525, None, None),
                4: ([[0, 0], [0, 1341], [2366, 1341], [2946, 0]], 2946, None, None)},
    "BR-0141": {1: ([[0, 0], [0, 1341], [3559, 1341], [3611, 1183]], 3611, None, None), 2: (None, 3559, None, None),
                3: ([[0, 0], [0, 1341], [2681, 1341], [3120, 0]], None, None, 3889571),
                9: ([[0, 0], [0, 1341], [45, 1341], [484, 0]], None, None, 354695), 10: ([[0, 0], [0, 138], [45, 0]], None, None, None)},
}
SEAM_OVERLAP = 15


@pytest.mark.parametrize("example", list(PANEL_CASES), ids=list(PANEL_CASES))
def test_crosscut_panels(app_url, example):
    sail, cloth, dims_name, usable, count = PANEL_CASES[example]
    dims = B01 if dims_name == "B01" else B02
    d = drawn_world(app_url, cloth, sail, dims)["drawing"]
    rs = ruleset(app_url, d["ruleset_version"])
    assert rs["seam_overlap_mm"] == SEAM_OVERLAP
    luff, foot = (dims["P"], dims["E"]) if sail == "mainsail" else (dims["LL"], dims["LP"])
    assert d["luff_mm"] == luff and d["foot_mm"] == foot
    expected = construct(luff, foot, usable - rs["seam_overlap_mm"])
    assert len(d["panels"]) == len(expected) == count
    for k, (p, outline) in enumerate(zip(d["panels"], expected), start=1):
        assert p["number"] == k and p["outline"] == outline, (k, p["outline"], outline)
        assert p["length_mm"] == max(x for x, _ in outline) and p["width_mm"] == max(y for _, y in outline)
        assert p["area_mm2"] == shoelace(outline) and p["laid"] is None and p["cut"] is False
    for k, (outline, length, width, area) in WORKED[example].items():
        p = d["panels"][k - 1]
        assert outline is None or p["outline"] == outline
        assert length is None or p["length_mm"] == length
        assert width is None or p["width_mm"] == width
        assert area is None or p["area_mm2"] == area


def test_ruleset_effective_instant(app_url):
    cur = current_ruleset(app_url)
    boat = new_boat(app_url, new_account(app_url)["email"])
    d1, d2 = new_drawing(app_url, boat["code"]), new_drawing(app_url, boat["code"])
    start = server_now(app_url) + timedelta(seconds=8)
    v = want(call(app_url, "POST", "/api/rulesets", sm(app_url), {**{k: cur[k] for k in FIVE}, "effective_at": iso(start)}), 201)
    assert v["current"] is False and v["effective_at"] == iso(start)
    early = call(app_url, "POST", f"/api/drawings/{d1['code']}/draw", sm(app_url))
    assert parsedate_to_datetime(early.headers["date"]) < start and want(early, 200)["ruleset_version"] == cur["version"]

    def became_current():
        r = call(app_url, "GET", f"/api/rulesets?limit={MAX_PAGE}", sm(app_url))
        row = next(x for x in r.json()["items"] if x["version"] == v["version"])
        at_ = parsedate_to_datetime(r.headers["date"])
        if not row["current"]:
            assert at_ <= start, "rule set still not current after its instant"
        return row["current"] and at_ >= start - timedelta(seconds=1)

    poll(became_current, POLL_SECONDS, "new rule set became current at its effective instant")
    assert draw(app_url, d2["code"])["ruleset_version"] == v["version"]
    assert get_drawing(app_url, d1["code"])["ruleset_version"] == cur["version"]


def test_drawing_state_machine(app_url):
    s = sm(app_url)
    boat = new_boat(app_url, new_account(app_url)["email"])
    code = new_drawing(app_url, boat["code"])["code"]
    roll = new_roll(app_url)
    assert get_drawing(app_url, code)["status"] == "measuring"
    refused(issue(app_url, code), 409, "wrong_state", "That cannot be done in the current state.")
    refused(call(app_url, "POST", f"/api/drawings/{code}/revise", s), 409, "wrong_state")
    refused(take(app_url, s, roll["code"], code, 1000), 409, "wrong_state")
    d = draw(app_url, code)
    assert d["status"] == "drawn" and d["step"] == "nest"
    refused(call(app_url, "POST", f"/api/drawings/{code}/draw", s), 409, "wrong_state")
    c = want(take(app_url, s, roll["code"], code, ROLL_LENGTH), 201)
    for p in d["panels"]:
        want(lay(app_url, s, c["id"], p["number"]), 201)
    assert get_drawing(app_url, code)["status"] == "nested"
    refused(issue(app_url, code), 409, "wrong_state")
    last = d["panels"][-1]["number"]
    assert want(unlay(app_url, s, c["id"], last), 200)["drawing_status"] == "drawn"
    refused(cut(app_url, s, c["id"], idempotency_key()), 409, "not_nested", "Lay every panel before confirming a cut.")
    assert want(lay(app_url, s, c["id"], last), 201)["drawing_status"] == "nested"
    assert want(cut(app_url, s, c["id"], idempotency_key()), 200)["drawing_status"] == "cut"
    assert want(issue(app_url, code), 200)["status"] == "issued"
    refused(issue(app_url, code), 409, "already_issued", "This cut sheet has already been issued.")
    sealed = "This drawing is sealed. Revise it to change anything."
    refused(call(app_url, "POST", f"/api/drawings/{code}/draw", s), 409, "sealed", sealed)
    refused(call(app_url, "POST", f"/api/drawings/{code}/assign", s, {"loft_hand_email": JORY[0]}), 409, "sealed", sealed)
    refused(take(app_url, s, new_roll(app_url)["code"], code, 1000), 409, "sealed", sealed)
    succ = want(call(app_url, "POST", f"/api/drawings/{code}/revise", s), 201)
    assert succ["predecessor"] == code and succ["status"] == "measuring" and succ["lot"] is None
    refused(call(app_url, "POST", f"/api/drawings/{code}/revise", s), 409, "already_revised", "This drawing already has a revision.")
    assert draw(app_url, succ["code"])["status"] == "drawn"
    tol = ruleset(app_url, get_drawing(app_url, succ["code"])["ruleset_version"])["tolerance_mm"]
    want(record(app_url, boat["code"], "E", B01["E"] + tol + 1), 201)
    after = get_drawing(app_url, succ["code"])
    assert after["status"] == "remeasure" and after["panels"] == [] and after["area"] is None


def test_wf_sail_drawing_journey(app_url, browser):
    w = drawn_world(app_url)
    boat = new_boat(app_url, w["owner"]["email"])
    code = new_drawing(app_url, boat["code"])["code"]
    with ui(browser, app_url, SAILMAKER, f"/drawings/{code}/draw") as page:
        seen(page, heading(page, f"Draw {code}"), "draw heading")
        seen(page, page.get_by_text("This sail has not been drawn yet."), "draw empty state")
        listen(page)
        click(page.get_by_role("button", name="Draw sail"))
        at(page, rf"/drawings/{code}/nest$", "draw lands on the nest step")
        assert focused(seen(page, heading(page, f"Nest {code}"), "nest heading"))
        d = get_drawing(app_url, code)
        n = len(d["panels"])
        wait_heard(page, re.escape(f"Sail drawn: {n} panels."), "draw success copy")
        page.reload()
        seen(page, heading(page, f"Nest {code}"), "nest after reload")
        click(page.get_by_role("navigation", name="Sail steps").get_by_role("link", name="Draw"))
        canvas = seen(page, page.get_by_role("region", name="Sail drawing"), "cobalt canvas")
        for k in range(1, n + 1):
            seen(page, canvas.get_by_role("button", name=f"Panel {k}", exact=True), f"Panel {k}")
        shows_where(page, page.get_by_role("region", name="Sail area"),
                    lambda t: has_area(t, d["area"]["area_mm2"]) and d["area"]["basis"] in t, "area poster with basis")
    assert d["status"] == "drawn" and d["step"] == "nest"


def test_wf_sail_drawing_breakpoints(app_url, browser):
    w = drawn_world(app_url)
    roll = new_roll(app_url)
    want(take(app_url, sm(app_url), roll["code"], w["code"], CLAIM_LEN), 201)
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/draw") as page:
        canvas = page.get_by_role("region", name="Sail drawing")
        area = page.get_by_role("region", name="Sail area")
        for width, beside in ((1024, True), (1023, False), (600, False), (1024, True)):
            page.set_viewport_size({"width": width, "height": DESKTOP["height"]})
            advance(page, STEP_MS)
            cb, ab = seen(page, canvas, "canvas").bounding_box(), seen(page, area, "sail area").bounding_box()
            assert (ab["x"] >= cb["x"] + cb["width"] - 1) == beside, (width, cb, ab)
        page.set_viewport_size(DESKTOP)
        page.goto(app_url + f"/drawings/{w['code']}/nest")
        click(seen(page, panel_button(page, 2), "Panel 2"))
        page.keyboard.press("ArrowRight")
        readout = nesting(page).get_by_role("group", name="Placement")
        shown = shows_where(page, readout, lambda t: "x " in t, "placement readout")
        hold = text_of(nesting(page).get_by_role("combobox", name="Active hold"))
        for size, kind in ((1024, "desktop"), (1023, "tablet"), (600, "tablet"), (599, "phone"), (1024, "desktop")):
            page.set_viewport_size({"width": size, "height": TABLET["height"]})
            advance(page, STEP_MS)
            strip = seen(page, nesting(page).get_by_role("region", name="Roll strip"), "roll strip").bounding_box()
            if kind == "phone":
                seen(page, nesting(page).get_by_role("button", name=re.compile(r"^Panels \(\d+ unlaid\)$")), "Panels button")
            else:
                lst = seen(page, nesting(page).get_by_role("list", name="Panels"), "panel list").bounding_box()
                assert (lst["y"] + lst["height"] <= strip["y"] + 1) == (kind == "desktop"), (size, lst, strip)
                assert nesting(page).get_by_role("button", name=re.compile(r"^Panels \(")).count() == 0
            assert text_of(readout) == shown and text_of(nesting(page).get_by_role("combobox", name="Active hold")) == hold
            seen(page, ghost_of(page, 2), "ghost kept")
        assert panel_button(page, 2).get_attribute("aria-pressed") == "true"
        page.goto(app_url + "/loft")
        table = page.get_by_role("table", name="Sail drawings")
        for size, stacked in ((600, False), (599, True)):
            page.set_viewport_size({"width": size, "height": TABLET["height"]})
            advance(page, STEP_MS)
            cells = seen(page, table.get_by_role("row").nth(1), "first drawing row").get_by_role("cell")
            ys = {round(cells.nth(i).bounding_box()["y"]) for i in range(min(2, cells.count()))}
            assert (len(ys) > 1) == stacked, (size, ys)


def test_wf_sail_drawing_four_steps(app_url, browser):
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    code = new_drawing(app_url, boat["code"])["code"]
    flagged_boat = new_boat(app_url, owner["email"])
    flagged = new_drawing(app_url, flagged_boat["code"])["code"]
    tol = current_ruleset(app_url)["tolerance_mm"]
    want(record(app_url, flagged_boat["code"], "P", B01["P"] + tol + 1), 201)
    with ui(browser, app_url, SAILMAKER, f"/drawings/{code}/nest") as page:
        at(page, rf"/drawings/{code}/draw$", "unreachable nest replaced by draw")
        shows(page, alert(page), "Finish the Draw step first.", "step copy")
        rail = page.get_by_role("navigation", name="Sail steps")
        assert rail.get_by_role("link", name="Nest").count() == 0 and rail.get_by_role("link", name="Confirm").count() == 0
        seen(page, rail.get_by_role("link", name="Draw"), "Draw link")
        assert rail.get_by_role("link", name="Draw").get_attribute("aria-current") not in (None, "false")
        draw(app_url, code)
        page.goto(app_url + f"/drawings/{code}/nest")
        seen(page, heading(page, f"Nest {code}"), "nest reachable once drawn")
        page.reload()
        seen(page, heading(page, f"Nest {code}"), "nest after reload")
        page.goto(app_url + f"/drawings/{code}/measure")
        seen(page, heading(page, f"Measure {code}"), "measure heading")
        absent(page, ui_measure(page, "P", B01["P"] + 5), "inside-band P saved")
        deadline = time.monotonic() + UI_SECONDS
        while rail.get_by_role("link", name="Nest").count() and time.monotonic() < deadline:
            advance(page, STEP_MS)
        assert rail.get_by_role("link", name="Nest").count() == 0 and rail.get_by_role("link", name="Confirm").count() == 0
        page.goto(app_url + f"/drawings/{code}/draw")
        seen(page, page.get_by_text("This sail has not been drawn yet."), "figures cleared")
        assert page.get_by_role("region", name="Sail drawing").get_by_role("button", name="Panel 1", exact=True).count() == 0
        page.goto(app_url + f"/drawings/{flagged}/draw")
        at(page, rf"/drawings/{flagged}/measure$", "remeasure drawing lands on measure")
        shows(page, alert(page), "Finish the Measure step first.", "measure step copy")
    d = get_drawing(app_url, code)
    assert d["status"] == "measuring" and d["panels"] == [] and d["area"] is None and d["step"] == "draw"


def test_step_transitions(app_url, browser):
    code = drawn_world(app_url)["code"]
    with ui(browser, app_url, SAILMAKER, f"/drawings/{code}/draw") as page:
        seen(page, heading(page, f"Draw {code}"), "draw heading")
        page.evaluate(WAAPI_JS)
        click(page.get_by_role("navigation", name="Sail steps").get_by_role("link", name="Measure"))
        timings = page.evaluate(ALL_TIMINGS_JS)
        deadline = time.monotonic() + UI_SECONDS
        while not visible(heading(page, f"Measure {code}")) and time.monotonic() < deadline:
            timings += page.evaluate(ALL_TIMINGS_JS)
            if visible(heading(page, f"Draw {code}")) and visible(heading(page, f"Measure {code}")):
                advance(page, 20)
                assert not (visible(heading(page, f"Draw {code}"))
                            and visible(heading(page, f"Measure {code}"))), "both steps laid out"
            advance(page, 20)
        for _ in range(2 * MARKER_MS // 20):
            timings += page.evaluate(ALL_TIMINGS_JS)
            advance(page, 20)
        durations = [d for d, _ in timings]
        assert any(near(d, STEP_FADE_MS) for d in durations), durations
        assert any(near(d, MARKER_MS) for d in durations), durations
        at(page, rf"/drawings/{code}/measure$", "measure address")
    with ui(browser, app_url, SAILMAKER, f"/drawings/{code}/draw", reduced=True) as page:
        seen(page, heading(page, f"Draw {code}"), "draw heading")
        page.evaluate(WAAPI_JS)
        click(page.get_by_role("navigation", name="Sail steps").get_by_role("link", name="Measure"))
        seen(page, heading(page, f"Measure {code}"), "measure heading", seconds=5)
        assert all(d == 0 and delay == 0 for d, delay in page.evaluate(ALL_TIMINGS_JS))


def test_lay_rules(app_url):
    w = drawn_world(app_url)
    s = sm(app_url)
    roll = new_roll(app_url)
    c = want(take(app_url, s, roll["code"], w["code"], CLAIM_LEN), 201)
    panels = {p["number"]: p for p in w["drawing"]["panels"]}
    one = want(lay(app_url, s, c["id"], 3, (0, 0, 0)), 201)
    lay3 = next(l for l in one["claim"]["lays"] if l["panel_number"] == 3)
    assert lay3["outline"] == placed(panels[3], 0, 0, 0)
    want(lay(app_url, s, c["id"], 9, (PANEL9_X, 0, 180)), 201)
    overlap = refused(lay(app_url, s, c["id"], 4, (0, 0, 0)), 409, "lay_overlap")
    assert re.fullmatch(r"Panel 4 overlaps panel (3|9)\. Nothing was laid\.", overlap["message"]), overlap
    field_refused(lay(app_url, s, c["id"], 4, (CLAIM_LEN - 1, 0, 0)), "position", "Panel 4 runs off the cloth. Nothing was laid.")
    field_refused(lay(app_url, s, c["id"], 4, (10000, 100, 0)), "position", "Panel 4 runs off the cloth. Nothing was laid.")
    bad = refused(lay(app_url, s, c["id"], 4, (10000, 0, 90)), 422, "invalid")
    assert "Turn 0 or 180 only." in bad["fields"].values()
    assert call(app_url, "POST", f"/api/claims/{c['id']}/lays", s, {"panel_number": 4, "x_mm": 10000}).status_code == 422
    refused(lay(app_url, s, c["id"], 3, (10000, 0, 0)), 409, "panel_laid", "Panel 3 is already laid.")
    claim = get_claim(app_url, c["id"])
    assert sorted(l["panel_number"] for l in claim["lays"]) == [3, 9]
    auto = next(n for n in claim["next_positions"] if n["panel_number"] == 4)
    res = want(lay(app_url, s, c["id"], 4), 201)
    got = next(l for l in res["claim"]["lays"] if l["panel_number"] == 4)
    assert (got["x_mm"], got["y_mm"], got["rotation"]) == (auto["x_mm"], auto["y_mm"], auto["rotation"])
    assert res["claim"]["used_mm"] == max(x for l in res["claim"]["lays"] for x, _ in l["outline"])
    assert res["stock"]["after_laid_mm"] == res["stock"]["remaining_mm"] - res["claim"]["used_mm"]


R02_LAYS = [(1, 0, 0, 0, 3103), (2, 2259, 0, 180, 6206), (3, 6206, 0, 0, 9731), (4, 9152, 0, 180, 12098)]
R02_LENGTH = 24800


def test_first_fit_worked_example(app_url):
    w = drawn_world(app_url, "C-06", "headsail", B02)
    s = sm(app_url)
    roll = new_roll(app_url, "C-06", R02_LENGTH)
    c = want(take(app_url, s, roll["code"], w["code"], R02_LENGTH), 201)
    assert [n["panel_number"] for n in c["next_positions"]] == [p["number"] for p in w["drawing"]["panels"]]
    for n, x, y, rot, used in R02_LAYS:
        published = next(e for e in get_claim(app_url, c["id"])["next_positions"] if e["panel_number"] == n)
        assert (published["x_mm"], published["y_mm"], published["rotation"]) == (x, y, rot)
        res = want(lay(app_url, s, c["id"], n), 201)
        l = next(e for e in res["claim"]["lays"] if e["panel_number"] == n)
        assert (l["x_mm"], l["y_mm"], l["rotation"]) == (x, y, rot) and res["claim"]["used_mm"] == used


def test_wf_nesting_keyboard(app_url, browser):
    w = drawn_world(app_url)
    roll = new_roll(app_url)
    c = want(take(app_url, sm(app_url), roll["code"], w["code"], CLAIM_LEN), 201)
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/nest") as page:
        panel = seen(page, panel_button(page, 1), "Panel 1")
        rest, ring = state_styles(panel, "outline-style", "outline-width", "box-shadow", state="focus")
        assert rest != ring, "focused panel button shows no ring"
        panel.focus()
        page.keyboard.press("Enter")
        assert panel.get_attribute("aria-pressed") == "true"
        readout = nesting(page).get_by_role("group", name="Placement")
        shows(page, readout, "x 0 mm (0.00 in) · y 0 mm (0.00 in) · 0°", "ghost at next position")
        page.keyboard.press("ArrowRight")
        shows(page, readout, "x 1 mm (0.04 in)", "1 mm nudge")
        page.keyboard.press("Shift+ArrowRight")
        shows(page, readout, "x 11 mm (0.43 in)", "10 mm nudge")
        page.keyboard.press("ArrowDown")
        shows(page, readout, "y 1 mm (0.04 in)", "1 mm across")
        page.keyboard.press("r")
        shows(page, readout, "180°", "turned")
        nesting(page).get_by_role("button", name="Undo").focus()
        page.keyboard.press("l")
        poll(lambda: [(l["x_mm"], l["y_mm"], l["rotation"]) for l in get_claim(app_url, c["id"])["lays"]] == [(11, 1, 180)],
             POLL_SECONDS, "L laid panel 1 at the ghost position")
        claim_btn = nesting(page).get_by_role("button", name="Claim length")
        claim_btn.focus()
        page.keyboard.press("Enter")
        seen(page, page.get_by_role("dialog", name="Claim length"), "Enter opened Claim length")
        page.keyboard.press("Escape")
        absent(page, page.get_by_role("dialog", name="Claim length"), "Escape closed the dialog")
        assert focused(claim_btn) and len(get_claim(app_url, c["id"])["lays"]) == 1
        nesting(page).get_by_role("button", name="Turn 180°").focus()
        page.keyboard.press("u")
        poll(lambda: get_claim(app_url, c["id"])["lays"] == [], POLL_SECONDS, "U undid the lay")


def test_ghost_clamped(app_url, browser):
    w = drawn_world(app_url)
    roll = new_roll(app_url)
    c = want(take(app_url, sm(app_url), roll["code"], w["code"], CLAIM_LEN), 201)
    y_max = USABLE_1356 - w["drawing"]["panels"][0]["width_mm"]
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/nest") as page:
        click(seen(page, panel_button(page, 1), "Panel 1"))
        readout = nesting(page).get_by_role("group", name="Placement")
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        shows(page, readout, "x 5 mm", "x 5")
        page.keyboard.press("Shift+ArrowLeft")
        shows(page, readout, "x 0 mm (0.00 in)", "clamped at the near end")
        page.keyboard.press("ArrowUp")
        shows(page, readout, "y 0 mm (0.00 in)", "clamped at the near edge")
        for _ in range(y_max // 10 + 3):
            page.keyboard.press("Shift+ArrowDown")
        shows(page, readout, f"y {y_max} mm ({inch(y_max)} in)", "clamped at the far edge")
        page.keyboard.press("r")
        shows(page, readout, f"y {y_max} mm ({inch(y_max)} in) · 180°", "turn then clamp")
        page.keyboard.press("l")
        poll(lambda: [(l["x_mm"], l["y_mm"], l["rotation"]) for l in get_claim(app_url, c["id"])["lays"]] == [(0, y_max, 180)],
             POLL_SECONDS, "lay at the clamped edge accepted")


TOUCH_CASES = ["tablet", "phone"]


@pytest.mark.parametrize("layout_name", TOUCH_CASES, ids=TOUCH_CASES)
def test_touch_nesting(app_url, browser, layout_name):
    w = drawn_world(app_url)
    roll = new_roll(app_url)
    c = want(take(app_url, sm(app_url), roll["code"], w["code"], CLAIM_LEN), 201)
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/nest", size=TABLET if layout_name == "tablet" else PHONE) as page:
        if layout_name == "phone":
            source = seen(page, outline_of(page, 3), "canvas outline 3")
        else:
            source = seen(page, panel_button(page, 3), "Panel 3")
        strip = seen(page, nesting(page).get_by_role("region", name="Roll strip"), "roll strip")
        source.scroll_into_view_if_needed()
        start = center(source)
        box = strip.bounding_box()
        target = (box["x"] + box["width"] * 0.6, box["y"] + box["height"] / 2)
        touch_drag(page, start, target)
        laid = poll(lambda: [l for l in get_claim(app_url, c["id"])["lays"] if l["panel_number"] == 3], POLL_SECONDS,
                    "touch drop laid panel 3")[0]
        assert isinstance(laid["x_mm"], int) and isinstance(laid["y_mm"], int)
        lb = seen(page, laid_panel(page, 3), "laid panel on the strip").bounding_box()
        assert lb["x"] - 4 <= target[0] <= lb["x"] + lb["width"] + 4 and lb["y"] - 4 <= target[1] <= lb["y"] + lb["height"] + 4


def test_thread_lay(app_url, browser):
    w = drawn_world(app_url)
    roll = new_roll(app_url)
    c = want(take(app_url, sm(app_url), roll["code"], w["code"], CLAIM_LEN), 201)
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/nest") as page:
        click(seen(page, panel_button(page, 1), "Panel 1"))
        page.evaluate(WAAPI_JS)
        with page.expect_response(lambda r: "/lays" in r.url and r.request.method == "POST"):
            page.keyboard.press("l")
        durations = [d for d, _ in page.evaluate(ALL_TIMINGS_JS)]
        for _ in range((LIFT_MS + TRAVEL_MS + COUNT_MS) // 40 + 10):
            advance(page, 40)
            durations += [d for d, _ in page.evaluate(ALL_TIMINGS_JS)]
        assert any(near(d, LIFT_MS) for d in durations), f"no lift of about {LIFT_MS} ms: {durations}"
        assert any(near(d, TRAVEL_MS) for d in durations), f"no travel of about {TRAVEL_MS} ms: {durations}"
        settle(page.locator("body"))
        advance(page, LIFT_MS + TRAVEL_MS + COUNT_MS)
        seen(page, laid_panel(page, 1), "landed panel")
        st = stock(app_url, roll["code"])
        shows_where(page, page.get_by_role("region", name="Roll remaining"), lambda t: has_length(t, st["after_laid_mm"]), "remaining counts to server value")
        lay1 = get_claim(app_url, c["id"])["lays"][0]
        strip_fraction_ok(page, 1, lay1["x_mm"], CLAIM_LEN)
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/nest", reduced=True) as page:
        click(seen(page, panel_button(page, 2), "Panel 2"))
        with page.expect_response(lambda r: "/lays" in r.url and r.request.method == "POST"):
            click(nesting(page).get_by_role("button", name="Lay"))
        st = stock(app_url, roll["code"])
        deadline = time.monotonic() + UI_SECONDS
        while not visible(laid_panel(page, 2)) and time.monotonic() < deadline:
            pass
        assert visible(laid_panel(page, 2)), "reduced motion lay is not instant"
        assert has_length(text_of(page.get_by_role("region", name="Roll remaining")), st["after_laid_mm"])


def test_wf_nesting_journey(app_url, browser):
    w = drawn_world(app_url)
    roll = new_roll(app_url)
    n = len(w["drawing"]["panels"])
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/nest", reduced=True) as page:
        seen(page, heading(page, f"Nest {w['code']}"), "nest heading")
        listen(page)
        click(nesting(page).get_by_role("button", name="Claim length"))
        dlg = seen(page, page.get_by_role("dialog", name="Claim length"), "dialog")
        select(dlg.get_by_role("combobox", name="Roll or offcut"), f"{roll['code']} · lot {roll['lot']}")
        fill(dlg.get_by_label("Length (mm)"), str(WIDE_CLAIM))
        click(dlg.get_by_role("button", name="Claim"))
        wait_heard(page, rf"Holding {re.escape(grouped(WIDE_CLAIM))} mm on {roll['code']} until \d\d:\d\d UTC\.", "claim copy")
        seen(page, nesting(page).get_by_role("timer", name="Hold"), "hold countdown")
        for k in range(1, n + 1):
            click(seen(page, panel_button(page, k), f"Panel {k}"))
            click(nesting(page).get_by_role("button", name="Lay"))
            wait_heard(page, rf"Panel {k} laid on roll {roll['code']}\.", f"lay copy {k}")
        poll(lambda: get_drawing(app_url, w["code"])["status"] == "nested", POLL_SECONDS, "drawing Nested")
        click(nesting(page).get_by_role("button", name="Undo"))
        wait_heard(page, rf"Panel {n} lifted from roll {roll['code']}\.", "undo copy")
        poll(lambda: get_drawing(app_url, w["code"])["status"] == "drawn", POLL_SECONDS, "undo back to Drawn")
        click(seen(page, panel_button(page, n), f"Panel {n}"))
        click(nesting(page).get_by_role("button", name="Lay"))
        poll(lambda: get_drawing(app_url, w["code"])["status"] == "nested", POLL_SECONDS, "re-lay back to Nested")


def test_phone_panel_list(app_url, browser):
    w = drawn_world(app_url)
    roll = new_roll(app_url)
    c = want(take(app_url, sm(app_url), roll["code"], w["code"], CLAIM_LEN), 201)
    n = len(w["drawing"]["panels"])
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/nest", size=PHONE) as page:
        toggle = seen(page, nesting(page).get_by_role("button", name=f"Panels ({n} unlaid)"), "Panels button")
        assert toggle.get_attribute("aria-expanded") != "true"
        assert panel_button(page, 1).count() == 0
        layout(page)
        page.locator("body").focus()
        names = tab_order(page, 30)
        assert not any(re.fullmatch(r"Panel \d+", x or "") for x in names), names
        click(toggle)
        assert toggle.get_attribute("aria-expanded") == "true"
        click(seen(page, panel_button(page, 2), "Panel 2"))
        assert toggle.get_attribute("aria-expanded") != "true" and panel_button(page, 2).count() == 0
        assert focused(nesting(page).get_by_role("button", name="Lay"))
        page.set_viewport_size(TABLET)
        seen(page, panel_button(page, 1), "list open on tablet")
        page.set_viewport_size(PHONE)
        advance(page, STEP_MS)
        assert panel_button(page, 1).count() == 0
        want(lay(app_url, sm(app_url), c["id"], 1), 201)
        page.reload()
        seen(page, nesting(page).get_by_role("button", name=f"Panels ({n - 1} unlaid)"), "count follows server")


def test_interrupted_thread_lay(app_url, browser):
    w = drawn_world(app_url)
    roll = new_roll(app_url)
    c = want(take(app_url, sm(app_url), roll["code"], w["code"], CLAIM_LEN), 201)
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/nest") as page:
        click(seen(page, panel_button(page, 1), "Panel 1"))
        with page.expect_response(lambda r: "/lays" in r.url and r.request.method == "POST"):
            page.keyboard.press("l")
        with page.expect_response(lambda r: "/lays/" in r.url and r.request.method == "DELETE"):
            page.keyboard.press("u")
        assert get_claim(app_url, c["id"])["lays"] == []
        for _ in range(20):
            advance(page, 50)
            assert not visible(laid_panel(page, 1)), "stale animation landed a lifted panel"
        settle(page.locator("body"))
        seen(page, panel_button(page, 1), "panel back in the list")
        click(panel_button(page, 1))
        with page.expect_response(lambda r: "/lays" in r.url and r.request.method == "POST"):
            page.keyboard.press("l")
        click(seen(page, panel_button(page, 2), "Panel 2"))
        with page.expect_response(lambda r: "/lays" in r.url and r.request.method == "POST"):
            page.keyboard.press("l")
        settle(page.locator("body"))
        advance(page, LIFT_MS + TRAVEL_MS + COUNT_MS)
        lays = {l["panel_number"]: l for l in get_claim(app_url, c["id"])["lays"]}
        assert set(lays) == {1, 2}
        for k in (1, 2):
            seen(page, nesting(page).get_by_role("img", name=f"Laid panel {k}"), f"Laid panel {k}")
            strip_fraction_ok(page, k, lays[k]["x_mm"], CLAIM_LEN)


def test_claims_free_length(app_url):
    s = sm(app_url)
    a, b, c3 = drawn_world(app_url), drawn_world(app_url), drawn_world(app_url)
    roll = new_roll(app_url, "C-18", 10000)
    c1 = want(take(app_url, s, roll["code"], a["code"], 6000), 201)
    assert c1["status"] == "held" and c1["length_mm"] == 6000 and c1["holder"]["display_name"] == SAILMAKER_NAME
    span = datetime.fromisoformat(c1["expires_at"].replace("Z", "+00:00")) - datetime.fromisoformat(c1["taken_at"].replace("Z", "+00:00"))
    assert span == timedelta(seconds=CLAIM_HOLD_DEFAULT) and 0 < c1["seconds_remaining"] <= CLAIM_HOLD_DEFAULT
    free = roll["remaining_mm"] - c1["length_mm"]
    assert stock(app_url, roll["code"])["free_mm"] == free
    j = refused(take(app_url, s, roll["code"], b["code"], 5000), 409, "claim_conflict",
                f"{SAILMAKER_NAME} claimed this length first. Choose another roll or offcut.")
    assert j["winner"] == {"display_name": SAILMAKER_NAME, "claim_id": c1["id"]}
    assert get_drawing(app_url, b["code"])["claim_ids"] == []
    want(take(app_url, s, roll["code"], b["code"], free), 201)
    assert stock(app_url, roll["code"])["free_mm"] == 0
    field_refused(take(app_url, s, new_roll(app_url, "C-06", 5000)["code"], c3["code"], 100), "stock_code", "This cloth does not match the drawing.")
    short = new_roll(app_url, "C-18", 3000)
    field_refused(take(app_url, s, short["code"], c3["code"], 3001), "length_mm", f"Longer than the cloth left on {short['code']}.")
    assert want(call(app_url, "POST", f"/api/claims/{c1['id']}/release", s), 200)["status"] == "released"
    assert stock(app_url, roll["code"])["free_mm"] == 6000
    want(take(app_url, s, roll["code"], a["code"], 6000), 201)


RACE_CASES = ["claim", "cut", "decision", "release", "issue"]


@pytest.mark.parametrize("kind", RACE_CASES, ids=RACE_CASES)
def test_wf_roll_claims_race(app_url, kind):
    other = outage_url(MINIO_DOWN)
    bases = [app_url if i % 2 == 0 else other for i in range(RACERS)]
    tokens = {b: sm(b) for b in set(bases)}
    if kind == "claim":
        w = drawn_world(app_url)
        roll = new_roll(app_url, "C-18", R14_LENGTH)
        res = race([lambda b=b: take(b, tokens[b], roll["code"], w["code"], R14_LENGTH) for b in bases])
        win, lose = 201, ("claim_conflict",)
        assert len(get_drawing(app_url, w["code"])["claim_ids"]) == 1 and stock(app_url, roll["code"])["free_mm"] == 0
    elif kind == "cut":
        w = nested_world(app_url)
        res = race([lambda: cut(app_url, sm(app_url), w["claim"]["id"], idempotency_key()) for _ in range(RACERS)])
        win, lose = 200, ("already_cut",)
        lines, _ = ledger_walk(app_url, w["roll"]["code"])
        assert sum(1 for l in lines if l["reason"] == "Panels cut") == 2
    elif kind == "decision":
        owner = new_account(app_url)
        boat = new_boat(app_url, owner["email"])
        sub = want(submit(app_url, tok(app_url, owner["who"]), boat["code"], mm_submission()), 201)
        res = race([lambda b=b: call(b, "POST", f"/api/submissions/{sub['id']}/decision", tokens[b],
                                     {"decision": "accept", "reason": "ok"}) for b in bases])
        win, lose = 200, ("already_decided",)
        ms = [m for m in dim(get_boat(app_url, boat["code"]), "I")["measurements"] if m["submission_id"] == sub["id"]]
        assert len(ms) == 1
    elif kind == "release":
        w = drawn_world(app_url)
        c = want(take(app_url, sm(app_url), new_roll(app_url)["code"], w["code"], CLAIM_LEN), 201)
        res = race([lambda b=b: call(b, "POST", f"/api/claims/{c['id']}/release", tokens[b]) for b in bases])
        win, lose = 200, ("claim_closed",)
        assert get_claim(app_url, c["id"])["status"] == "released"
    else:
        w = cut_world(app_url)
        res = race([lambda: issue(app_url, w["code"]) for _ in range(RACERS)])
        win, lose = 200, ("already_issued",)
        assert len(s3().keys(f"cut-sheets/{w['code']}/")) == 1
    codes = [r.status_code for r in res]
    assert codes.count(win) == 1, codes
    assert all(r.status_code == 409 and r.json()["error"] in lose for r in res if r.status_code != win), [r.text for r in res]


def test_holds_lapse_short(app_url):
    base = outage_url(SHORT_HOLD)
    healthy(base)
    w = drawn_world(base)
    s = sm(base)
    roll = new_roll(base)
    c = want(take(base, s, roll["code"], w["code"], CLAIM_LEN), 201)
    want(lay(base, s, c["id"], 3), 201)
    expires = datetime.fromisoformat(c["expires_at"].replace("Z", "+00:00"))

    def lapsed():
        r = call(base, "GET", f"/api/claims/{c['id']}", s)
        j = r.json()
        if j["status"] != "lapsed":
            assert parsedate_to_datetime(r.headers["date"]) <= expires, "hold still held after its deadline"
            return None
        assert parsedate_to_datetime(r.headers["date"]) >= expires - timedelta(seconds=1)
        return j

    j = poll(lapsed, POLL_SECONDS, "hold lapsed at its deadline")
    assert j["seconds_remaining"] == 0 and j["lays"] == [] and j["next_positions"] == []
    d = get_drawing(base, w["code"])
    assert all(p["laid"] is None for p in d["panels"]) and d["status"] == "drawn"
    st = stock(base, roll["code"])
    assert st["free_mm"] == st["remaining_mm"] == ROLL_LENGTH
    lapse_copy = "This hold has lapsed. Claim the length again before cutting."
    refused(cut(base, s, c["id"], idempotency_key()), 409, "claim_lapsed", lapse_copy)
    refused(lay(base, s, c["id"], 4), 409, "claim_lapsed", lapse_copy)
    refused(unlay(base, s, c["id"], 3), 409, "claim_lapsed", lapse_copy)


def test_lot_true_sails(app_url):
    base = outage_url(SHORT_HOLD)
    healthy(base)
    w = drawn_world(base)
    s = sm(base)
    first, other = new_roll(base), new_roll(base)
    want(take(base, s, first["code"], w["code"], 1000), 201)
    assert get_drawing(base, w["code"])["lot"] == first["lot"]
    field_refused(take(base, s, other["code"], w["code"], 1000), "stock_code", "This lot does not match the cloth already on this sail.")
    field_refused(take(base, s, new_roll(base, "C-06")["code"], w["code"], 1000), "stock_code", "This cloth does not match the drawing.")
    poll(lambda: get_drawing(base, w["code"])["lot"] is None, POLL_SECONDS, "lot unpinned once the only hold lapsed")
    c = want(take(base, s, other["code"], w["code"], 1000), 201)
    assert get_drawing(base, w["code"])["lot"] == other["lot"]
    want(call(base, "POST", f"/api/claims/{c['id']}/release", s), 200)
    assert get_drawing(base, w["code"])["lot"] is None


def test_countdown_server_deadline(app_url, browser):
    w = drawn_world(app_url)
    c = want(take(app_url, sm(app_url), new_roll(app_url)["code"], w["code"], CLAIM_LEN), 201)
    with ui(browser, app_url, SAILMAKER) as page:
        page.clock.set_system_time(SKEW)
        page.goto(app_url + f"/drawings/{w['code']}/nest")
        seen(page, nesting(page).get_by_role("timer", name="Hold"), "timer Hold")
        s0 = timer_seconds(page)
        server = get_claim(app_url, c["id"])["seconds_remaining"]
        assert server <= s0 <= CLAIM_HOLD_DEFAULT and s0 - server <= UI_SECONDS + POLL_SECONDS
        advance(page, 3000)
        assert s0 - 4 <= timer_seconds(page) <= s0 - 2
        s1 = timer_seconds(page)
        page.clock.set_system_time(SKEW_BACK)
        advance(page, STEP_MS)
        assert s1 - 1 <= timer_seconds(page) <= s1
        with page.expect_request(lambda r: f"/api/claims/{c['id']}" in r.url and r.method == "GET", timeout=HTTP_TIMEOUT * 1000):
            advance(page, (timer_seconds(page) + 1) * 1000)
        left = get_claim(app_url, c["id"])["seconds_remaining"]
        shows_where(page, nesting(page).get_by_role("timer", name="Hold"),
                    lambda t: bool(re.search(r"Hold ends in (\d+):(\d\d)", t)) and abs(
                        int(re.search(r"Hold ends in (\d+):(\d\d)", t).group(1)) * 60
                        + int(re.search(r"Hold ends in (\d+):(\d\d)", t).group(2)) - left) <= UI_SECONDS,
                    "countdown restarted from the server's answer")
        assert "Lapsed" not in text_of(nesting(page))


def test_countdown_keeps_state(app_url, browser):
    w = drawn_world(app_url)
    want(take(app_url, sm(app_url), new_roll(app_url)["code"], w["code"], CLAIM_LEN), 201)
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/nest") as page:
        click(seen(page, panel_button(page, 1), "Panel 1"))
        panel_no, steps = 1, 3
        for _ in range(steps):
            page.keyboard.press("ArrowRight")
        readout = nesting(page).get_by_role("group", name="Placement")
        shows(page, readout, f"x {steps} mm", "ghost moved")
        click(nesting(page).get_by_role("button", name="Claim length"))
        dlg = seen(page, page.get_by_role("dialog", name="Claim length"), "dialog")
        field = dlg.get_by_label("Length (mm)")
        fill(field, "123")
        advance(page, 5000)
        assert visible(dlg) and field.input_value() == "123" and focused(field)
        page.keyboard.press("Escape")
        advance(page, 5000)
        assert f"x {steps} mm" in text_of(readout) and panel_button(page, 1).get_attribute("aria-pressed") == "true"
        seen(page, ghost_of(page, panel_no), "ghost kept")
    base = outage_url(SHORT_HOLD)
    healthy(base)
    sw = drawn_world(base)
    roll = new_roll(base)
    with ui(browser, base, SAILMAKER, f"/drawings/{sw['code']}/nest") as page:
        click(seen(page, nesting(page).get_by_role("button", name="Claim length"), "Claim length"))
        dlg = seen(page, page.get_by_role("dialog", name="Claim length"), "dialog")
        select(dlg.get_by_role("combobox", name="Roll or offcut"), f"{roll['code']} · lot {roll['lot']}")
        fill(dlg.get_by_label("Length (mm)"), str(CLAIM_LEN))
        click(dlg.get_by_role("button", name="Claim"))
        seen(page, nesting(page).get_by_role("timer", name="Hold"), "timer")
        cid = get_drawing(base, sw["code"])["claim_ids"][0]
        want(lay(base, sm(base), cid, 3), 201)
        poll(lambda: get_claim(base, cid)["status"] == "lapsed", POLL_SECONDS, "server lapsed the hold")
        advance(page, (timer_seconds(page) + 1) * 1000)
        shows(page, nesting(page), "Lapsed", "Lapsed chip")
        shows(page, alert(page), "This hold has lapsed. Claim the length again before cutting.", "lapse copy")
        assert focused(nesting(page).get_by_role("button", name="Claim length"))
        assert not visible(laid_panel(page, 3))
        assert seen(page, panel_button(page, 3), "Panel 3 returned").get_attribute("aria-pressed") != "true"


def test_wf_roll_claims_conflict_journey(app_url, browser):
    w = drawn_world(app_url)
    assign(app_url, w["code"], JORY[0])
    roll = new_roll(app_url, "C-18", R14_LENGTH)
    held_claim = want(take(app_url, sm(app_url), roll["code"], w["code"], R14_LENGTH), 201)
    with ui(browser, app_url, JORY, "/floor", size=TABLET) as page:
        queue = seen(page, page.get_by_role("list", name="Cutting queue"), "cutting queue")
        click(seen(page, queue.get_by_role("link", name=f"{w['code']} · {w['boat']['name']} Mainsail"), "queue card"))
        at(page, rf"/floor/{w['code']}$", "floor nesting address")
        seen(page, heading(page, f"Nest {w['code']}"), "nest heading")

        def claim_ui():
            click(nesting(page).get_by_role("button", name="Claim length"))
            dlg = seen(page, page.get_by_role("dialog", name="Claim length"), "dialog")
            select(dlg.get_by_role("combobox", name="Roll or offcut"), f"{roll['code']} · lot {roll['lot']}")
            fill(dlg.get_by_label("Length (mm)"), str(R14_LENGTH))
            click(dlg.get_by_role("button", name="Claim"))

        claim_ui()
        shows(page, alert(page), f"{SAILMAKER_NAME} claimed this length first. Choose another roll or offcut.", "conflict copy")
        assert get_drawing(app_url, w["code"])["claim_ids"] == [held_claim["id"]]
        want(call(app_url, "POST", f"/api/claims/{held_claim['id']}/release", sm(app_url)), 200)
        if visible(page.get_by_role("dialog", name="Claim length")):
            page.keyboard.press("Escape")
        claim_ui()
        shows(page, nesting(page).get_by_role("timer", name="Hold"), "Hold ends in", "countdown")
    ids = get_drawing(app_url, w["code"])["claim_ids"]
    assert any(get_claim(app_url, i)["holder"]["email"] == JORY[0] and get_claim(app_url, i)["status"] == "held" for i in ids)


def test_lot_runs_out_mid_sail(app_url):
    w = two_roll_world(app_url)
    results = w["results"]
    for n, r in results.items():
        if n in (3, 9):
            want(r, 201)
        else:
            field_refused(r, "position", f"Panel {n} runs off the cloth. Nothing was laid.")
    lays = {l["panel_number"]: (l["x_mm"], l["y_mm"], l["rotation"]) for l in w["a"]["lays"]}
    assert lays == {3: (0, 0, 0), 9: (PANEL9_X, 0, 180)}
    assert w["a"]["used_mm"] == R14_USED and stock(app_url, w["first"]["code"])["after_laid_mm"] == R14_AFTER
    assert sorted(l["panel_number"] for l in w["b"]["lays"]) == [1, 2, 4, 5, 6, 7, 8, 10]
    d = get_drawing(app_url, w["code"])
    assert d["status"] == "nested" and d["lot"] == w["lot"]
    assert {p["laid"]["stock_code"] for p in d["panels"]} == {w["first"]["code"], w["second"]["code"]}


def test_one_minute_warning(app_url, browser):
    base = outage_url(MINUTE_HOLD)
    healthy(base)
    w = drawn_world(base)
    roll = new_roll(base)
    with ui(browser, base, SAILMAKER, f"/drawings/{w['code']}/nest") as page:
        page.clock.set_system_time(SKEW)
        click(seen(page, nesting(page).get_by_role("button", name="Claim length"), "Claim length"))
        dlg = seen(page, page.get_by_role("dialog", name="Claim length"), "dialog")
        select(dlg.get_by_role("combobox", name="Roll or offcut"), f"{roll['code']} · lot {roll['lot']}")
        fill(dlg.get_by_label("Length (mm)"), str(CLAIM_LEN))
        click(dlg.get_by_role("button", name="Claim"))
        seen(page, nesting(page).get_by_role("timer", name="Hold"), "timer")
        listen(page)
        copy = f"One minute left on the hold on {roll['code']}."
        s0 = timer_seconds(page)
        assert s0 > ONE_MINUTE
        lay_btn = nesting(page).get_by_role("button", name="Claim length")
        lay_btn.focus()
        advance(page, (s0 - ONE_MINUTE - 2) * 1000)
        assert times_heard(page, copy) == 0
        advance(page, 4000)
        assert times_heard(page, copy) == 1 and focused(lay_btn)
        page.clock.set_system_time(SKEW_BACK)
        click(nesting(page).get_by_role("button", name="Claim length"))
        page.keyboard.press("Escape")
        select(nesting(page).get_by_role("combobox", name="Active hold"), f"{roll['code']} · lot {roll['lot']}")
        advance(page, 3000)
        assert times_heard(page, copy) == 1


def test_wf_cut_confirmation_ledger_pairs(app_url):
    w = two_roll_world(app_url)
    first = w["first"]["code"]
    res = want(cut(app_url, sm(app_url), w["a"]["id"], idempotency_key()), 200)
    assert res["claim"]["status"] == "cut" and res["offcut"] is None and res["drawing_status"] == "cutting"
    assert res["stock"]["remaining_mm"] == 0 and res["stock"]["on_hand_mm2"] == 0
    found = {}
    for pair in res["pairs"]:
        a, b = pair["lines"]
        assert a["pair_id"] == b["pair_id"] == pair["pair_id"] and a["posted_at"] == b["posted_at"]
        assert a["amount_mm2"] + b["amount_mm2"] == 0
        stock_line = next(l for l in (a, b) if l["account"] == first)
        counter = next(l for l in (a, b) if l is not stock_line)
        assert stock_line["amount_mm2"] < 0 and all(l["drawing_code"] == w["code"] and l["stock_code"] == first for l in (a, b))
        found[counter["account"]] = (counter["amount_mm2"], counter["reason"])
    assert found == {f"panels {w['code']}": (PANELS_PAIR, "Panels cut"), "waste": (WASTE_PAIR, "Waste")}
    lines, last = ledger_walk(app_url, first)
    assert len(lines) == 6 and last["total"] == 6 == rows_with("", "ledger_line", first)
    assert sum(l["amount_mm2"] for l in lines if l["account"] == first) == stock(app_url, first)["on_hand_mm2"] == 0
    d = get_drawing(app_url, w["code"])
    assert {p["number"] for p in d["panels"] if p["cut"]} == {3, 9}
    rec = want(call(app_url, "GET", "/api/ledger/reconciliation", sm(app_url)), 200)
    assert next(i for i in rec["items"] if i["stock_code"] == first)["difference_mm2"] == 0


def test_cut_idempotency(app_url):
    other = outage_url(MINIO_DOWN)
    w = nested_world(app_url)
    w2 = nested_world(app_url)
    key = idempotency_key()
    pair = race([lambda: cut(app_url, sm(app_url), w["claim"]["id"], key), lambda: cut(other, sm(other), w["claim"]["id"], key)])
    assert [r.status_code for r in pair] == [200, 200] and pair[0].content == pair[1].content
    count = rows_with("", "ledger_line", w["roll"]["code"])
    _TOKENS.pop((app_url, SAILMAKER[0]), None)
    replay = cut(app_url, want(sign_in(app_url, SAILMAKER), 200)["access_token"], w["claim"]["id"], key)
    assert replay.status_code == 200 and replay.content == pair[0].content
    assert rows_with("", "ledger_line", w["roll"]["code"]) == count
    refused(cut(app_url, sm(app_url), w["claim"]["id"], idempotency_key()), 409, "already_cut", "This length has already been cut.")
    refused(cut(app_url, sm(app_url), w2["claim"]["id"], key), 409, "idempotency_key_reused", "That confirmation key belongs to another request.")
    assert call(app_url, "POST", f"/api/claims/{w2['claim']['id']}/cut", sm(app_url)).status_code == 422
    assert get_claim(app_url, w2["claim"]["id"])["status"] == "held"


def test_remnant_becomes_offcut(app_url):
    w = drawn_world(app_url)
    s = sm(app_url)
    roll = new_roll(app_url)
    probe = want(take(app_url, s, roll["code"], w["code"], WIDE_CLAIM), 201)
    for p in w["drawing"]["panels"]:
        want(lay(app_url, s, probe["id"], p["number"]), 201)
    used = get_claim(app_url, probe["id"])["used_mm"]
    want(call(app_url, "POST", f"/api/claims/{probe['id']}/release", s), 200)
    tail = ruleset(app_url, w["drawing"]["ruleset_version"])["min_offcut_length_mm"]
    c = want(take(app_url, s, roll["code"], w["code"], used + tail), 201)
    for p in w["drawing"]["panels"]:
        want(lay(app_url, s, c["id"], p["number"]), 201)
    assert get_claim(app_url, c["id"])["used_mm"] == used
    res = want(cut(app_url, s, c["id"], idempotency_key()), 200)
    off = res["offcut"]
    assert off and re.fullmatch(r"O-\d{2,}", off["code"]) and off["kind"] == "offcut" and off["cloth_code"] == "C-18"
    assert off["lot"] == roll["lot"] and off["width_mm"] == WIDTH_1372 and off["usable_width_mm"] == USABLE_1356
    assert off["remaining_mm"] == tail and off["on_hand_mm2"] == WIDTH_1372 * tail and off["shelf_location"] == "Offcut bin"
    receipt = next(p for p in res["pairs"] if any(l["account"] == off["code"] for l in p["lines"]))
    lines = {l["account"]: l for l in receipt["lines"]}
    assert lines[off["code"]]["amount_mm2"] == WIDTH_1372 * tail and lines[off["code"]]["stock_code"] == off["code"]
    assert lines[roll["code"]]["amount_mm2"] == -WIDTH_1372 * tail and lines[roll["code"]]["stock_code"] == roll["code"]
    assert all(l["reason"] == "Offcut received" and l["drawing_code"] == w["code"] for l in receipt["lines"])
    only, _ = ledger_walk(app_url, off["code"])
    assert len(only) == 1 and only[0]["amount_mm2"] == stock(app_url, off["code"])["on_hand_mm2"]
    later = drawn_world(app_url)
    c2 = want(take(app_url, s, off["code"], later["code"], tail), 201)
    want(lay(app_url, s, c2["id"], later["drawing"]["panels"][-1]["number"]), 201)


def test_authority_on_claim_date(app_url):
    lh = authorised_loft_hand(app_url)
    w = drawn_world(app_url)
    assign(app_url, w["code"], lh["email"])
    t = tok(app_url, lh["who"])
    c = want(take(app_url, t, new_roll(app_url)["code"], w["code"], ROLL_LENGTH), 201)
    for p in w["drawing"]["panels"]:
        want(lay(app_url, t, c["id"], p["number"]), 201)
    want(call(app_url, "POST", f"/api/authorities/{lh['authority']}/withdraw", sm(app_url)), 200)
    assert want(cut(app_url, t, c["id"], idempotency_key()), 200)["claim"]["status"] == "cut"
    late = new_account(app_url, "loft-hand")
    w2 = nested_world(app_url)
    assign(app_url, w2["code"], late["email"])
    start = server_now(app_url) + timedelta(seconds=3)
    want(call(app_url, "POST", "/api/authorities", sm(app_url), {"loft_hand_email": late["email"], "valid_from": iso(start)}), 201)
    poll(lambda: server_now(app_url) > start, POLL_SECONDS, "late authority in force")
    refused(cut(app_url, tok(app_url, late["who"]), w2["claim"]["id"], idempotency_key()), 403, "no_authority_on_claim_date",
            "You held no cutting authority when this length was claimed.")
    assert get_claim(app_url, w2["claim"]["id"])["status"] == "held"


def test_wf_cut_confirmation_journey(app_url, browser):
    w = drawn_world(app_url)
    assign(app_url, w["code"], JORY[0])
    t = tok(app_url, JORY)
    roll = new_roll(app_url)
    c = want(take(app_url, t, roll["code"], w["code"], ROLL_LENGTH), 201)
    for p in w["drawing"]["panels"]:
        want(lay(app_url, t, c["id"], p["number"]), 201)
    with ui(browser, app_url, JORY, f"/floor/{w['code']}", size=TABLET) as page:
        listen(page)
        btn = seen(page, nesting(page).get_by_role("button", name="Confirm cut"), "Confirm cut")
        btn.dblclick()
        at(page, r"/floor$", "cut lands on the floor")
        wait_heard(page, rf"Cut confirmed on roll {roll['code']}\. 0 mm \(0\.00 in\) remaining\. Offcut O-\d+ added to the shelf\.", "cut copy")
    assert get_claim(app_url, c["id"])["status"] == "cut"
    lines, _ = ledger_walk(app_url, roll["code"])
    assert sum(1 for l in lines if l["reason"] == "Panels cut") == 2 and len(lines) == rows_with("", "ledger_line", roll["code"])


def test_expired_session_resume(app_url, browser):
    w = drawn_world(app_url)
    assign(app_url, w["code"], JORY[0])
    t = tok(app_url, JORY)
    c = want(take(app_url, t, new_roll(app_url)["code"], w["code"], ROLL_LENGTH), 201)
    last = w["drawing"]["panels"][-1]["number"]
    for p in w["drawing"]["panels"][:-1]:
        want(lay(app_url, t, c["id"], p["number"]), 201)
    deny = lambda route: route.fulfill(status=401, content_type="application/json", body=json.dumps(UNAUTH))
    with ui(browser, app_url, JORY, f"/floor/{w['code']}", size=TABLET) as page:
        page.route("**/api/claims/*/lays", deny)
        page.route("**/api/session", lambda route: deny(route) if route.request.method == "GET" else route.continue_())
        click(seen(page, panel_button(page, last), f"Panel {last}"))
        click(nesting(page).get_by_role("button", name="Lay"))
        at(page, r"/signin\?resume=" + re.escape(quote(f"/floor/{w['code']}", safe="")), "failed refresh goes to sign-in")
        page.unroute("**/api/claims/*/lays")
        page.unroute("**/api/session")
        shows(page, status(page), "Your session ended. Sign in to carry on.", "resume copy")
        ui_sign_in(page, app_url, JORY)
        at(page, rf"/floor/{w['code']}$", "back to the same page")
        want(lay(app_url, t, c["id"], last), 201)
        page.reload()
        seen(page, nesting(page).get_by_role("button", name="Confirm cut"), "Confirm cut")
        keys, refreshes = [], []

        def first_401(route):
            keys.append(route.request.headers.get("idempotency-key"))
            if len(keys) == 1:
                deny(route)
            else:
                route.continue_()

        page.route("**/api/claims/*/cut", first_401)
        page.on("request", lambda r: refreshes.append(r.url) if r.method == "GET" and urlsplit(r.url).path == "/api/session" else None)
        click(nesting(page).get_by_role("button", name="Confirm cut"))
        poll(lambda: page.evaluate("1") and get_claim(app_url, c["id"])["status"] == "cut",
             POLL_SECONDS, "retried cut landed")
        assert len(keys) == 2 and keys[0] and keys[0] == keys[1] and len(refreshes) == 1
        assert "Sign in to continue." not in text_of(alert(page))


def test_cutting_after_partial_lapse(app_url):
    w = two_roll_world(app_url)
    s = sm(app_url)
    want(cut(app_url, s, w["a"]["id"], idempotency_key()), 200)
    victim = w["b"]["lays"][0]["panel_number"]
    assert want(unlay(app_url, s, w["b"]["id"], victim), 200)["drawing_status"] == "cutting"
    refused(cut(app_url, s, w["b"]["id"], idempotency_key()), 409, "not_nested")
    want(call(app_url, "POST", f"/api/claims/{w['b']['id']}/release", s), 200)
    d = get_drawing(app_url, w["code"])
    assert d["status"] == "cutting" and d["lot"] == w["lot"]
    assert all(p["laid"] is not None for p in d["panels"] if p["cut"])
    c = want(take(app_url, s, w["second"]["code"], w["code"], WIDE_CLAIM), 201)
    for p in d["panels"]:
        if not p["cut"]:
            want(lay(app_url, s, c["id"], p["number"]), 201)
    assert want(cut(app_url, s, c["id"], idempotency_key()), 200)["drawing_status"] == "cut"


def test_shelf_counts(app_url):
    roll = new_roll(app_url, "C-18", SHELF_START)
    code, s = roll["code"], sm(app_url)
    path = f"/api/stock/{code}/counts"
    shift = SHELF_START - SHELF_COUNTED
    st = want(call(app_url, "POST", path, s, {"counted_length_mm": SHELF_START, "reason": ""}), 200)
    assert st["last_count"]["counted_mm"] == SHELF_START and rows_with("", "ledger_line", code) == 2
    field_refused(call(app_url, "POST", path, s, {"counted_length_mm": SHELF_COUNTED, "reason": ""}), "reason", "Give a reason for the difference.")
    field_refused(call(app_url, "POST", path, s, {"counted_length_mm": SHELF_COUNTED, "reason": "x" * (REASON_MAX + 1)}), "reason",
                  "Keep the reason to 200 characters or fewer.")
    assert rows_with("", "ledger_line", code) == 2
    st = want(call(app_url, "POST", path, s, {"counted_length_mm": SHELF_COUNTED, "reason": "Probe recount"}), 200)
    assert st["remaining_mm"] == SHELF_COUNTED and st["on_hand_mm2"] == WIDTH_1372 * SHELF_COUNTED
    lines, _ = ledger_walk(app_url, code)
    adj = [l for l in lines if l["reason"] == "Probe recount"]
    assert {l["account"]: l["amount_mm2"] for l in adj} == {code: -WIDTH_1372 * shift, "count-adjustment": WIDTH_1372 * shift}
    assert sum(l["amount_mm2"] for l in lines if l["account"] == code) == st["on_hand_mm2"]
    want(take(app_url, s, code, drawn_world(app_url)["code"], 1000), 201)
    refused(call(app_url, "POST", path, s, {"counted_length_mm": 9000, "reason": "x"}), 409, "wrong_state")


def test_wf_stock_ledger_pages(app_url):
    s = sm(app_url)
    assert len(want(call(app_url, "GET", "/api/ledger?limit=100", s), 200)["items"]) == MAX_PAGE
    assert len(want(call(app_url, "GET", "/api/ledger", s), 200)["items"]) == DEFAULT_PAGE
    for bad in ("0", "x"):
        assert call(app_url, "GET", f"/api/ledger?limit={bad}", s).status_code == 422
    ids, keys, cursor, posted = [], [], None, None
    for _ in range(PAGE_GUARD):
        q = {"limit": MAX_PAGE, **({"cursor": cursor} if cursor else {})}
        page = want(call(app_url, "GET", "/api/ledger?" + urlencode(q), s), 200)
        ids += [l["line_id"] for l in page["items"]]
        keys += [(l["posted_at"], l["line_id"]) for l in page["items"]]
        if posted is None:
            posted = new_roll(app_url)
        cursor = page["next_cursor"]
        if not cursor:
            break
    else:
        pytest.fail("ledger walk never ended")
    assert len(ids) == len(set(ids)) and set(range(1, SEEDED_LINES + 1)) <= set(ids)
    assert keys == sorted(keys, reverse=True)
    new_ids = [l["line_id"] for l in ledger_walk(app_url, posted["code"])[0]]
    assert not set(new_ids) & set(ids)
    filtered = want(call(app_url, "GET", f"/api/ledger?stock={posted['code']}&limit=1", s), 200)
    field_refused(call(app_url, "GET", "/api/ledger?" + urlencode({"cursor": filtered["next_cursor"]}), s), "cursor",
                  "This page belongs to another filter.")
    field_refused(call(app_url, "GET", "/api/ledger?cursor=probe-not-issued", s), "cursor", "That page marker is not valid.")


def test_totals_reconciliation(app_url):
    s = sm(app_url)
    roll = new_roll(app_url, "C-18", TOTALS_ROLL)
    page = want(call(app_url, "GET", f"/api/ledger?stock={roll['code']}&limit=1", s), 200)
    assert len(page["items"]) == 1 and page["total"] == 2
    f = page["footer"]
    assert f["stock_code"] == roll["code"] and f["lines"] == 2 and f["remaining_mm"] == TOTALS_ROLL
    assert f["on_hand_mm2"] == WIDTH_1372 * TOTALS_ROLL and f["on_hand_m2"] == sqm(WIDTH_1372 * TOTALS_ROLL)
    rec = want(call(app_url, "GET", "/api/ledger/reconciliation", s), 200)
    assert rec["ledger_sum_mm2"] == 0 and rec["difference_mm2"] == 0
    assert rec["stored_on_hand_mm2"] == rec["ledger_on_hand_mm2"] and rec["lines"] >= SEEDED_LINES
    assert all(i["difference_mm2"] == 0 and i["stored_on_hand_mm2"] == i["ledger_on_hand_mm2"] for i in rec["items"])
    mine = next(i for i in rec["items"] if i["stock_code"] == roll["code"])
    assert mine["stored_on_hand_mm2"] == WIDTH_1372 * TOTALS_ROLL
    unfiltered = want(call(app_url, "GET", "/api/ledger?limit=1", s), 200)
    assert unfiltered["footer"]["remaining_mm"] is None and unfiltered["footer"]["on_hand_mm2"] >= mine["stored_on_hand_mm2"]


def test_wf_stock_ledger_three_surfaces(app_url, browser):
    w = two_roll_world(app_url, first_len=10000)
    first = w["first"]["code"]
    want(cut(app_url, sm(app_url), w["a"]["id"], idempotency_key()), 200)
    x = stock(app_url, first)
    assert x["remaining_mm"] == 10000 - R14_LENGTH
    with ui(browser, app_url, SAILMAKER, f"/drawings/{w['code']}/confirm") as page:
        y = stock(app_url, w["second"]["code"])
        summary = want(call(app_url, "GET", "/api/stock/summary", sm(app_url)), 200)
        remaining = page.get_by_role("region", name="Roll remaining")
        shows_where(page, remaining, lambda t: has_length(t, y["after_laid_mm"]) and has_area(t, y["on_hand_mm2"])
                    and str(summary["offcuts"]) in t, "strip figures")
        page.goto(app_url + "/stock")
        card = page.get_by_role("list", name="Rolls and offcuts").get_by_role("listitem").filter(
            has=page.get_by_role("link", name=first, exact=True))
        shows_where(page, card, lambda t: has_length(t, x["remaining_mm"]) and has_area(t, x["on_hand_mm2"]), "shelf card figures")
        summary = want(call(app_url, "GET", "/api/stock/summary", sm(app_url)), 200)
        shows_where(page, page.get_by_role("region", name="Stock on hand"),
                    lambda t: str(summary["offcuts"]) in t and has_area(t, summary["on_hand_mm2"]), "stock on hand")
        page.goto(app_url + f"/ledger?stock={first}")
        foot = want(call(app_url, "GET", f"/api/ledger?stock={first}&limit=1", sm(app_url)), 200)["footer"]
        assert foot["remaining_mm"] == x["remaining_mm"] and foot["on_hand_mm2"] == x["on_hand_mm2"]
        shows_where(page, page.get_by_role("region", name="Ledger footer"),
                    lambda t: has_length(t, x["remaining_mm"]) and has_area(t, x["on_hand_mm2"]) and str(foot["offcut_count"]) in t, "footer figures")


def test_newest_answer_wins(app_url, browser):
    a, b = new_roll(app_url, "C-18", 4000), new_roll(app_url, "C-18", 9000)
    with ui(browser, app_url, SAILMAKER, "/ledger") as page:
        table = seen(page, page.get_by_role("table", name="Ledger lines"), "ledger table")
        footer = page.get_by_role("region", name="Ledger footer")
        with held(page, f"**/api/ledger*stock={a['code']}*") as gate:
            select(page.get_by_role("combobox", name="Stock"), a["code"])
            select(page.get_by_role("combobox", name="Stock"), b["code"])
            shows_where(page, footer, lambda t: has_length(t, 9000), "newest filter's footer shown")
            gate.release()
            for _ in range(20):
                advance(page, STEP_MS)
                assert not has_length(text_of(footer), 4000), "a late answer overwrote the newest one"
        assert has_length(text_of(page.get_by_role("region", name="Ledger footer")), 9000)


def test_ledger_address(app_url, browser):
    a, b = new_roll(app_url, "C-18", 10000), new_roll(app_url)
    for i in range(60):
        want(call(app_url, "POST", f"/api/stock/{a['code']}/counts", sm(app_url), {"counted_length_mm": 9999 - i, "reason": "Probe recount"}), 200)
    foreign = want(call(app_url, "GET", f"/api/ledger?stock={a['code']}&limit={DEFAULT_PAGE}", sm(app_url)), 200)["next_cursor"]
    with ui(browser, app_url, SAILMAKER, "/ledger") as page:
        table = seen(page, page.get_by_role("table", name="Ledger lines"), "ledger table")
        select(page.get_by_role("combobox", name="Stock"), a["code"])
        at(page, rf"[?&]stock={re.escape(a['code'])}(&|$)", "stock in the address")
        assert "cursor=" not in page.url
        rows = table.get_by_role("row")
        newest = shows_where(page, rows.nth(1), lambda t: bool(t), "first row")
        click(page.get_by_role("button", name="Older lines"))
        at(page, r"cursor=", "cursor in the address")
        older = shows_where(page, rows.nth(1), lambda t: t and t != newest, "older page")
        older_url = page.url
        page.reload()
        shows(page, page.get_by_role("table", name="Ledger lines").get_by_role("row").nth(1), older, "reload keeps the page")
        assert page.url == older_url
        page.go_back()
        shows(page, page.get_by_role("table", name="Ledger lines").get_by_role("row").nth(1), newest, "Back restores newest")
        assert "cursor=" not in page.url
        page.go_forward()
        shows(page, page.get_by_role("table", name="Ledger lines").get_by_role("row").nth(1), older, "Forward restores older")
        page.goto(app_url + "/ledger?" + urlencode({"stock": b["code"], "cursor": foreign}))
        shows(page, alert(page), "This page belongs to another filter.", "other-filter copy")
        at(page, rf"stock={re.escape(b['code'])}", "filter kept")
        assert "cursor=" not in page.url
        seen(page, page.get_by_role("table", name="Ledger lines").get_by_role("row").nth(1), "newest page of the filter")


def test_card_grids(app_url, browser):
    for path, who, name, columns in (("/stock", SAILMAKER, "Rolls and offcuts", (4, 2, 1)), ("/floor", JORY, "Cutting queue", (3, 2, 1))):
        with ui(browser, app_url, who, path) as page:
            for size, cols in zip((DESKTOP, TABLET, PHONE), columns):
                page.set_viewport_size(size)
                advance(page, STEP_MS)
                cards = seen(page, page.get_by_role("list", name=name), name).get_by_role("listitem")
                boxes = [cards.nth(i).bounding_box() for i in range(min(cards.count(), 8))]
                assert len({round(bx["x"]) for bx in boxes}) == cols, (path, size, boxes)
                assert max(bx["width"] for bx in boxes) - min(bx["width"] for bx in boxes) <= 1
                row = [bx for bx in boxes if abs(bx["y"] - boxes[0]["y"]) < 1]
                assert max(bx["height"] for bx in row) - min(bx["height"] for bx in row) <= 1
                if cols > 1:
                    assert abs(boxes[1]["x"] - (boxes[0]["x"] + boxes[0]["width"]) - GRID_GAP) <= 1
                below = boxes[cols]
                assert abs(below["y"] - (boxes[0]["y"] + boxes[0]["height"]) - GRID_GAP) <= 1
                layout(page)
            page.set_viewport_size(DESKTOP)
            first = page.get_by_role("list", name=name).get_by_role("listitem").first
            for control in first.get_by_role("link").all() + first.get_by_role("button").all():
                bx = control.bounding_box()
                assert bx["width"] >= TAP_MIN and bx["height"] >= TAP_MIN, bx
            rest, hover = state_styles(first, "transform", state="hover")
            m = re.search(r"matrix\(([^)]+)\)", hover["transform"])
            assert m and abs(float(m.group(1).split(",")[5]) + LIFT_PX) <= 0.5, (rest, hover)
            link = first.get_by_role("link").first
            before = style(first, "outline-style", "outline-width", "box-shadow")
            page.locator("body").focus()
            for _ in range(PAGE_GUARD // 10):
                if focused(link):
                    break
                page.keyboard.press("Tab")
            assert focused(link)
            assert style(first, "outline-style", "outline-width", "box-shadow") != before, "no focus ring on the card"
            if path == "/stock":
                c0 = link.inner_text().strip()
                c1 = page.get_by_role("list", name=name).get_by_role("listitem").nth(1).get_by_role("link").first.inner_text().strip()
                assert tab_order(page, 3) == [f"Count {c0}", f"Edit {c0}", c1]


def test_wf_cut_sheet_issue_confirmed_bytes(app_url):
    w = cut_world(app_url)
    code = w["code"]
    preview = want(call(app_url, "GET", f"/api/drawings/{code}/cut-sheet/preview", sm(app_url)), 200)
    sha = hashlib.sha256(preview.content).hexdigest()
    d = want(issue(app_url, code), 200)
    key = f"cut-sheets/{code}/{sha}.svg"
    assert d["status"] == "issued" and d["cut_sheet"]["sha256"] == sha and d["cut_sheet"]["size"] == len(preview.content)
    assert d["cut_sheet"]["key"] == key and s3().get(key) == preview.content
    refused(issue(app_url, code), 409, "already_issued")
    assert s3().keys(f"cut-sheets/{code}/") == [key]


def test_pending_store_recovery(app_url):
    down = outage_url(MINIO_DOWN)
    w = cut_world(app_url)
    code = w["code"]
    preview = want(call(app_url, "GET", f"/api/drawings/{code}/cut-sheet/preview", sm(app_url)), 200).content
    r = issue(down, code)
    assert r.status_code == 202 and r.json()["status"] == "pending_store"
    refused(issue(down, code), 409, "already_issued")
    poll(lambda: get_drawing(app_url, code)["status"] == "issued", ISSUE_RECOVERY_SECONDS + RECOVERY_SLACK, "pending store became Issued")
    sha = hashlib.sha256(preview).hexdigest()
    assert s3().keys(f"cut-sheets/{code}/") == [f"cut-sheets/{code}/{sha}.svg"]
    g = want(grant(app_url, code, w["owner"]["email"]), 201)
    refused(call(down, "GET", f"/api/grants/{g['id']}/cut-sheet", tok(down, w["owner"]["who"])), 503, "store_unavailable", OUTAGE_OWNER)


def test_cut_sheet_document(app_url):
    w = issued_world(app_url)
    d, code = w["drawing"], w["code"]
    stored = s3().get(d["cut_sheet"]["key"])
    for _ in range(2):
        assert call(app_url, "GET", f"/api/drawings/{code}/cut-sheet/preview", sm(app_url)).content == stored
    r = call(app_url, "GET", f"/api/cut-sheets/{d['cut_sheet']['sha256']}", sm(app_url))
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml") and r.content == stored
    g = want(grant(app_url, code, w["owner"]["email"]), 201)
    assert call(app_url, "GET", f"/api/grants/{g['id']}/cut-sheet", tok(app_url, w["owner"]["who"])).content == stored
    root = ET.fromstring(stored)
    title = next(el for el in root.iter() if el.tag.endswith("title"))
    assert title.text == f"Cut sheet {code}"
    lines = ["".join(el.itertext()).strip() for el in root.iter() if el.tag.endswith("}text") or el.tag == "text"]
    rs = ruleset(app_url, d["ruleset_version"])
    tail = f"tolerance ±{rs['tolerance_mm']} mm · rule set v{rs['version']}"
    area, claim = d["area"], w["claim"]
    expected = [f"Cut sheet {code} · {w['boat']['name']} · Mainsail · {w['owner']['name']}",
                f"Cloth C-18 Cruising crosscut 8.6 oz · usable width {mm_text(USABLE_1356)} · catalogue width, {tail}"]
    dims = [f"{k} {mm_text(B01[k])} · tape, {tail}" for k in ("P", "E")]
    expected.append(f"Sail area {grouped(area['area_m2'])} m² ({grouped(area['area_ft2'])} ft²) · {area['basis'].split(' · ')[0]} · {tail}")
    expected += [f"Panel {p['number']} · {mm_text(p['length_mm'])} × {mm_text(p['width_mm'])} · {grouped(p['area_m2'])} m² "
                 f"({grouped(p['area_ft2'])} ft²) · crosscut perpendicular to leech, seam overlap {rs['seam_overlap_mm']} mm · {tail}"
                 for p in d["panels"]]
    expected.append(f"Nest on {w['roll']['code']} · {mm_text(claim['used_mm'])} of {mm_text(WIDTH_1372)} cloth · thread along the roll · lot {w['lot']} · {tail}")
    positions = [lines.index(x) if x in lines else -1 for x in expected]
    assert -1 not in positions, [x for x, p in zip(expected, positions) if p < 0]
    assert positions == sorted(positions) and all(x in lines for x in dims)
    assert all(positions[0] < lines.index(x) < positions[2] for x in dims)


def test_revisions_superseded(app_url):
    w = issued_world(app_url)
    old, s = w["drawing"], sm(app_url)
    stored = s3().get(old["cut_sheet"]["key"])
    succ = want(call(app_url, "POST", f"/api/drawings/{old['code']}/revise", s), 201)
    assert succ["predecessor"] == old["code"] and succ["boat_code"] == old["boat_code"] and succ["cloth_code"] == old["cloth_code"]
    d = draw(app_url, succ["code"])
    roll = new_roll(app_url)
    c = want(take(app_url, s, roll["code"], d["code"], ROLL_LENGTH), 201)
    for p in d["panels"]:
        want(lay(app_url, s, c["id"], p["number"]), 201)
    want(cut(app_url, s, c["id"], idempotency_key()), 200)
    new = want(issue(app_url, d["code"]), 200)
    assert get_drawing(app_url, old["code"])["cut_sheet"]["superseded_by"] == d["code"]
    assert get_drawing(app_url, old["code"])["successor"] == d["code"]
    r = call(app_url, "GET", f"/api/cut-sheets/{old['cut_sheet']['sha256']}", s)
    assert r.content == stored and r.headers["boltrope-superseded-by"] == d["code"]
    r2 = call(app_url, "GET", f"/api/cut-sheets/{new['cut_sheet']['sha256']}", s)
    assert r2.headers["boltrope-supersedes"] == old["code"]
    assert f"Supersedes {old['code']}" in "".join(ET.fromstring(r2.content).itertext())
    assert s3().get(old["cut_sheet"]["key"]) == stored


def test_wf_cut_sheet_issue_journey(app_url, browser):
    down = outage_url(MINIO_DOWN)
    w = cut_world(app_url)
    code = w["code"]
    with ui(browser, down, SAILMAKER, f"/drawings/{code}") as page:
        seen(page, heading(page, code), "overview heading")
        listen(page)
        click(page.get_by_role("button", name="Issue cut sheet"))
        shows(page, page.get_by_role("region", name="Store outage"), OUTAGE_ISSUE, "outage banner copy")
        seen(page, page.get_by_text("Pending store", exact=True), "Pending store chip")
        poll(lambda: get_drawing(app_url, code)["status"] == "issued", ISSUE_RECOVERY_SECONDS + RECOVERY_SLACK, "store confirmed")
        keep = page.get_by_role("button", name="Sign out")
        keep.focus()
        tick_until(page, lambda: visible(page.get_by_text("Issued", exact=True)) and visible(page.get_by_role("link", name="Open cut sheet")),
                   LIVE_POLL_MS * 2, "overview turned Issued in place")
        absent(page, page.get_by_role("region", name="Store outage"), "outage banner gone")
        seen(page, page.get_by_role("button", name="Grant sight"), "Grant sight")
        advance(page, LIVE_POLL_MS * 2)
        assert times_heard(page, "Cut sheet issued.") == 1 and focused(keep)
    key = get_drawing(app_url, code)["cut_sheet"]["key"]
    with ui(browser, app_url, SAILMAKER, f"/drawings/{code}") as page:
        with page.context.expect_event("response", lambda r: r.headers.get("content-type", "").startswith("image/svg+xml"),
                                       timeout=HTTP_TIMEOUT * 1000) as info:
            click(seen(page, page.get_by_role("link", name="Open cut sheet"), "Open cut sheet"))
        assert info.value.body() == s3().get(key)


def test_floor_new_assignment_live(app_url, browser):
    lh = new_account(app_url, "loft-hand")
    w = drawn_world(app_url)
    with ui(browser, app_url, lh["who"], "/floor") as page:
        seen(page, page.get_by_text("Nothing is assigned to you on the cutting floor."), "empty floor")
        listen(page)
        keep = page.get_by_role("button", name="Sign out")
        keep.focus()
        assign(app_url, w["code"], lh["email"])
        card = page.get_by_role("list", name="Cutting queue").get_by_role("link", name=f"{w['code']} · {w['boat']['name']} Mainsail")
        tick_until(page, lambda: visible(card), FLOOR_APPEAR_MS, "new assignment card")
        advance(page, FLOOR_APPEAR_MS)
        assert times_heard(page, f"{w['code']} is on your cutting floor.") == 1 and focused(keep)


def test_rename_keeps_sheet(app_url):
    w = issued_world(app_url)
    old, s = w["drawing"], sm(app_url)
    stored = s3().get(old["cut_sheet"]["key"])
    boat_name, owner_name = f"Probe {hexid()}", f"Probe {hexid()}"
    want(call(app_url, "PATCH", f"/api/boats/{w['boat']['code']}", s, {"name": boat_name}, headers={"If-Match": f'"{get_boat(app_url, w["boat"]["code"])["revision"]}"'}), 200)
    want(call(app_url, "PATCH", f"/api/accounts/{w['owner']['id']}", s, {"display_name": owner_name}), 200)
    assert get_drawing(app_url, old["code"])["boat_name"] == boat_name
    preview = call(app_url, "GET", f"/api/drawings/{old['code']}/cut-sheet/preview", s).content
    assert preview == stored and w["boat"]["name"].encode() in stored and boat_name.encode() not in stored
    succ = want(call(app_url, "POST", f"/api/drawings/{old['code']}/revise", s), 201)
    d = draw(app_url, succ["code"])
    c = want(take(app_url, s, new_roll(app_url)["code"], d["code"], ROLL_LENGTH), 201)
    for p in d["panels"]:
        want(lay(app_url, s, c["id"], p["number"]), 201)
    want(cut(app_url, s, c["id"], idempotency_key()), 200)
    fresh = "".join(ET.fromstring(call(app_url, "GET", f"/api/drawings/{d['code']}/cut-sheet/preview", s).content).itertext())
    assert f"Cut sheet {d['code']} · {boat_name} · Mainsail · {owner_name}" in fresh


def test_sail_account_exact_pence(app_url, browser):
    w = cut_world(app_url, cloth="C-07", roll_len=LONG_ROLL)
    code = w["code"]
    a = want(call(app_url, "GET", f"/api/drawings/{code}/account", sm(app_url)), 200)
    area = w["drawing"]["area"]["area_mm2"]
    charge = half(area * RATE_C07, MM2_PER_M2)
    tax = half(charge * TAX_PERCENT, 100)
    deposit = half((charge + tax) * DEPOSIT_PERCENT, 100)
    if area == MAINSAIL_B01_V3:
        assert (charge, tax, charge + tax, deposit) == (CHARGE_EXAMPLE, TAX_EXAMPLE, TOTAL_EXAMPLE, DEPOSIT_EXAMPLE)
    assert (a["charge_pence"], a["tax_pence"], a["total_pence"], a["deposit_pence"]) == (charge, tax, charge + tax, deposit)
    assert a["rate_pence_per_m2"] == RATE_C07 and a["tax_rate_percent"] == TAX_PERCENT and a["status"] == "deposit_due"
    after = want(pay(app_url, code, deposit, idempotency_key()), 201)
    assert after["balance_pence"] == charge + tax - deposit and after["status"] == "balance_due"
    if area == MAINSAIL_B01_V3:
        assert after["balance_pence"] == BALANCE_EXAMPLE
    assert after["paid_pence"] + after["credited_pence"] + after["balance_pence"] == after["total_pence"]
    pending = drawn_world(app_url)
    refused(call(app_url, "GET", f"/api/drawings/{pending['code']}/account", sm(app_url)), 409, "wrong_state")
    with ui(browser, app_url, SAILMAKER, f"/drawings/{code}") as page:
        region = page.get_by_role("region", name="Sail account")
        text = shows_where(page, region, lambda t: "Balance due" in t, "account chip")
        for label, pence in (("Cloth charge", charge), ("Tax at 20%", tax), ("Total", charge + tax), ("Deposit", deposit),
                             ("Paid", deposit), ("Credit notes", 0), ("Balance", after["balance_pence"])):
            assert label in text and f"£{pounds(pence)}" in text, (label, text)
    settle_up = want(call(app_url, "POST", f"/api/drawings/{code}/credit-notes", sm(app_url),
                          {"amount_pence": after["balance_pence"], "reason": "Probe credit"}), 201)
    assert settle_up["balance_pence"] == 0 and settle_up["status"] == "settled"


def test_payments_never_overpay(app_url):
    w = cut_world(app_url)
    code, s = w["code"], sm(app_url)
    bal = want(call(app_url, "GET", f"/api/drawings/{code}/account", s), 200)["balance_pence"]
    refused(pay(app_url, code, bal + 1, idempotency_key()), 409, "exceeds_balance", "That is more than the balance left on this sail.")
    refused(call(app_url, "POST", f"/api/drawings/{code}/credit-notes", s, {"amount_pence": bal + 1, "reason": "x"}), 409, "exceeds_balance")
    field_refused(pay(app_url, code, 0, idempotency_key()), "amount_pence", "Enter an amount in pounds above 0 with up to two decimals.")
    assert call(app_url, "POST", f"/api/drawings/{code}/credit-notes", s, {"amount_pence": 100}).status_code == 422
    key = idempotency_key()
    first = pay(app_url, code, 1000, key)
    again = pay(app_url, code, 1000, key)
    assert first.status_code == again.status_code == 201 and first.content == again.content
    refused(pay(app_url, code, 2000, key), 409, "idempotency_key_reused")
    a = want(call(app_url, "GET", f"/api/drawings/{code}/account", s), 200)
    assert len(a["entries"]) == 1
    big = a["balance_pence"] * 6 // 10 + 1
    res = race([lambda: pay(app_url, code, big, idempotency_key()) for _ in range(2)])
    assert sorted(r.status_code for r in res) == [201, 409]
    a = want(call(app_url, "GET", f"/api/drawings/{code}/account", s), 200)
    assert a["balance_pence"] >= 0 and a["paid_pence"] + a["credited_pence"] + a["balance_pence"] == a["total_pence"]


def test_sight_grants(app_url):
    other = outage_url(MINIO_DOWN)
    w = issued_world(app_url)
    o, o2, code, s = w["owner"], new_account(app_url), w["code"], sm(app_url)
    refused(grant(app_url, cut_world(app_url)["code"], o["email"]), 409, "wrong_state")
    field_refused(grant(app_url, code, o["email"], "2020-01-01T00:00:00Z"), "ends_at", "Enter a future instant as YYYY-MM-DDTHH:MM:SSZ.")
    g1 = want(grant(app_url, code, o["email"]), 201)
    g2 = want(grant(app_url, code, o2["email"]), 201)
    assert re.fullmatch(r"G-\d{4,}", g1["id"]) and g1["status"] == "granted"
    one = call(app_url, "GET", f"/api/grants/{g1['id']}", tok(app_url, o["who"]))
    two = call(other, "GET", f"/api/grants/{g1['id']}", tok(other, o["who"]))
    assert one.status_code == 200 and one.content == two.content
    want(call(app_url, "GET", f"/api/grants/{g1['id']}/cut-sheet", tok(app_url, o["who"])), 200)
    w1 = want(call(app_url, "POST", f"/api/grants/{g1['id']}/withdraw", s), 200)
    assert w1["status"] == "withdrawn" and w1["withdrawn_at"]
    t = tok(app_url, o["who"])
    for path in (f"/api/grants/{g1['id']}", f"/api/grants/{g1['id']}/cut-sheet", f"/api/drawings/{code}", f"/api/drawings/{code}/account"):
        assert call(app_url, "GET", path, t).content == NOT_FOUND, path
    assert call(other, "GET", f"/api/grants/{g1['id']}", tok(other, o["who"])).content == NOT_FOUND
    want(call(app_url, "GET", f"/api/grants/{g2['id']}/cut-sheet", tok(app_url, o2["who"])), 200)
    refused(call(app_url, "POST", f"/api/grants/{g1['id']}/withdraw", s), 409, "wrong_state")
    g3 = want(grant(app_url, code, o["email"]), 201)
    assert g3["id"] != g1["id"] and call(app_url, "GET", f"/api/grants/{g1['id']}/cut-sheet", t).content == NOT_FOUND
    want(call(app_url, "GET", f"/api/grants/{g3['id']}/cut-sheet", t), 200)


def test_sight_end_dates(app_url):
    w = issued_world(app_url)
    ends = server_now(app_url) + timedelta(seconds=5)
    g = want(grant(app_url, w["code"], w["owner"]["email"], iso(ends)), 201)
    t = tok(app_url, w["owner"]["who"])
    want(call(app_url, "GET", f"/api/grants/{g['id']}", t), 200)

    def ended():
        r = call(app_url, "GET", f"/api/grants/{g['id']}/cut-sheet", t)
        if r.status_code == 200:
            assert parsedate_to_datetime(r.headers["date"]) <= ends, "grant still served after its end"
            return False
        assert r.content == NOT_FOUND and parsedate_to_datetime(r.headers["date"]) >= ends - timedelta(seconds=1)
        return True

    poll(ended, POLL_SECONDS, "grant ended at its end instant")
    row = want(call(app_url, "GET", f"/api/grants/{g['id']}", sm(app_url)), 200)
    assert row["status"] == "withdrawn" and row["withdrawn_at"] == row["ends_at"] == iso(ends)


def test_wf_owner_sight_journey(app_url, browser):
    w = issued_world(app_url)
    o, code = w["owner"], w["code"]
    want(pay(app_url, code, 1000, idempotency_key()), 201)
    g = want(grant(app_url, code, o["email"]), 201)
    a = want(call(app_url, "GET", f"/api/drawings/{code}/account", sm(app_url)), 200)
    with ui(browser, app_url, o["who"], "/owner") as page:
        seen(page, heading(page, "Cut sheets"), "Cut sheets")
        click(seen(page, page.get_by_role("link", name=f"Open cut sheet {code}"), "sheet link"))
        at(page, rf"/sheets/{g['id']}$", "viewer address")
        seen(page, heading(page, f"Cut sheet {code}"), "viewer heading")
        seen(page, page.get_by_role("img", name=f"Cut sheet {code}"), "sheet image")
        region = page.get_by_role("region", name="Sail account")
        text = shows_where(page, region, lambda t: f"£{pounds(a['balance_pence'])}" in t, "account figures")
        for label in ("Cloth charge", "Tax at 20%", "Total", "Deposit", "Paid", "Credit notes", "Balance"):
            assert label in text
        assert f"£{pounds(a['charge_pence'])}" in text and region.get_by_role("button").count() == 0
        click(page.get_by_role("button", name="Sign out"))
        at(page, r"://[^/]+/$", "signed out to /")
        want(call(app_url, "POST", f"/api/grants/{g['id']}/withdraw", sm(app_url)), 200)
        ui_sign_in(page, app_url, o["who"])
        page.goto(app_url + f"/sheets/{g['id']}")
        seen(page, page.get_by_text(VIEWER_REFUSAL), "viewer refusal")
        assert not visible(page.get_by_role("img", name=f"Cut sheet {code}"))


def test_wf_owner_sight_fetch_limit(app_url):
    w = issued_world(app_url)
    o, other, code = w["owner"], new_account(app_url), w["code"]
    g = want(grant(app_url, code, o["email"]), 201)
    g2 = want(grant(app_url, code, other["email"]), 201)
    t = tok(app_url, o["who"])
    for _ in range(SHEET_LIMIT):
        want(call(app_url, "GET", f"/api/grants/{g['id']}/cut-sheet", t), 200)
    r = call(app_url, "GET", f"/api/grants/{g['id']}/cut-sheet", t)
    refused(r, 429, "rate_limited")
    retry = r.headers["retry-after"]
    assert retry.isdigit() and int(retry) >= 1
    assert r.json()["message"] == f"Too many requests from this account. Try again in {retry} seconds."
    want(call(app_url, "GET", f"/api/grants/{g2['id']}/cut-sheet", tok(app_url, other["who"])), 200)
    want(call(app_url, "POST", f"/api/grants/{g['id']}/withdraw", sm(app_url)), 200)
    gone = call(app_url, "GET", f"/api/grants/{g['id']}/cut-sheet", t)
    assert gone.status_code == 404 and gone.content == NOT_FOUND and gone.headers.get("retry-after") is None


LEAK_JS = """(name) => { const check = () => { if (sessionStorage.getItem('boltrope-probe-armed') === '1' && document.body
  && document.body.innerText.includes(name)) sessionStorage.setItem('boltrope-probe-leak', '1'); };
  new MutationObserver(check).observe(document.documentElement, {subtree: true, childList: true, characterData: true}); check(); }"""


def test_answers_scoped(app_url, browser):
    a, b = new_account(app_url), new_account(app_url)
    boat_a, boat_b = new_boat(app_url, a["email"], {}), new_boat(app_url, b["email"], {})
    ta, tb = tok(app_url, a["who"]), tok(app_url, b["who"])
    calls = [(t, code) for _ in range(10) for t, code in ((ta, boat_a["code"]), (tb, boat_b["code"]))]
    res = race([lambda t=t: call(app_url, "GET", "/api/boats", t) for t, _ in calls])
    for (t, code), r in zip(calls, res):
        assert [x["code"] for x in r.json()["items"]] == [code] and r.headers["cache-control"] == "private, no-store"
    with ui(browser, app_url, a["who"], "/owner") as page:
        seen(page, page.get_by_text(boat_a["name"]), "owner A's boat")
        page.add_init_script(script=f"({LEAK_JS})({json.dumps(boat_a['name'])})")
        page.evaluate(f"({LEAK_JS})({json.dumps(boat_a['name'])})")
        click(page.get_by_role("button", name="Sign out"))
        at(page, r"://[^/]+/$", "signed out")
        page.evaluate("() => sessionStorage.setItem('boltrope-probe-armed', '1')")
        page.go_back()
        seen(page, heading(page, "Sign in to the loft"), "Back shows sign-in")
        ui_sign_in(page, app_url, b["who"])
        seen(page, page.get_by_text(boat_b["name"]), "owner B's boat")
        assert page.evaluate("() => sessionStorage.getItem('boltrope-probe-leak')") is None
        assert boat_a["name"] not in page.locator("body").inner_text()


def test_viewer_withdrawal_live(app_url, browser):
    w = issued_world(app_url)
    g = want(grant(app_url, w["code"], w["owner"]["email"]), 201)
    with ui(browser, app_url, w["owner"]["who"], f"/sheets/{g['id']}") as page:
        seen(page, page.get_by_role("img", name=f"Cut sheet {w['code']}"), "sheet")
        checks = []
        page.on("request", lambda r: checks.append(r.url) if f"/api/grants/{g['id']}" in r.url else None)
        tick_until(page, lambda: len(checks) >= 1, LIVE_POLL_MS + 1000, "viewer checked its grant within 5 s")
        want(call(app_url, "POST", f"/api/grants/{g['id']}/withdraw", sm(app_url)), 200)
        tick_until(page, lambda: visible(page.get_by_text(VIEWER_REFUSAL)), VIEWER_REFUSAL_MS, "viewer refusal")
        assert not visible(page.get_by_role("img", name=f"Cut sheet {w['code']}"))
        assert not visible(page.get_by_role("region", name="Sail account"))
        assert len(checks) >= 0


def test_bulk_decisions(app_url):
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    t = tok(app_url, owner["who"])
    subs = [want(submit(app_url, t, boat["code"], mm_submission()), 201)["id"] for _ in range(5)]
    want(call(app_url, "POST", f"/api/submissions/{subs[4]}/decision", sm(app_url), {"decision": "accept", "reason": "ok"}), 200)
    assert want(call(app_url, "GET", "/api/submissions?status=pending", t), 200)["total"] == 4
    items = [{"id": subs[0], "decision": "accept", "reason": ""}, {"id": subs[1], "decision": "reject", "reason": "Probe reason"},
             {"id": subs[2], "decision": "reject", "reason": ""}, {"id": subs[4], "decision": "accept", "reason": ""},
             {"id": "S-9999", "decision": "accept", "reason": ""}, {"id": subs[3], "decision": "accept", "reason": ""}]
    res = want(call(app_url, "POST", "/api/admin/submissions/decisions", sm(app_url), {"decisions": items}), 200)["results"]
    assert [(r["id"], r["outcome"], r["reason"]) for r in res] == [
        (subs[0], "applied", None), (subs[1], "applied", None), (subs[2], "refused", "reason_required"),
        (subs[4], "refused", "already_decided"), ("S-9999", "refused", "not_found"), (subs[3], "applied", None)]
    assert want(call(app_url, "GET", "/api/submissions?status=pending", t), 200)["total"] == 1
    for bad in ([], [items[0]] * (MAX_PAGE + 1)):
        assert call(app_url, "POST", "/api/admin/submissions/decisions", sm(app_url), {"decisions": bad}).status_code == 422


def test_audit_trail(app_url):
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"], {"I": B01["I"]})
    code = boat["code"]
    want(call(app_url, "PATCH", f"/api/boats/{code}", sm(app_url), {"name": "Probe renamed"}, headers={"If-Match": f'"{get_boat(app_url, code)["revision"]}"'}), 200)
    call(app_url, "PATCH", f"/api/boats/{code}", sm(app_url), {"name": "Probe stale"}, headers={"If-Match": '"1"'})
    rows = audit_rows(app_url, code)
    actions = [r["action"] for r in rows]
    assert actions.count("boat.create") == 1 and actions.count("boat.update") == 1
    assert all(r["actor_email"] == SAILMAKER[0] for r in rows)
    ats = [r["at"] for r in rows]
    assert ats == sorted(ats, reverse=True)
    t = tok(app_url, owner["who"])
    single = want(submit(app_url, t, code, mm_submission()), 201)["id"]
    bulk = want(submit(app_url, t, code, mm_submission()), 201)["id"]
    want(call(app_url, "POST", f"/api/submissions/{single}/decision", sm(app_url), {"decision": "reject", "reason": "Probe single"}), 200)
    want(call(app_url, "POST", "/api/admin/submissions/decisions", sm(app_url), {"decisions": [{"id": bulk, "decision": "reject", "reason": "Probe bulk"}]}), 200)
    for sid, reason in ((single, "Probe single"), (bulk, "Probe bulk")):
        r = [x for x in audit_rows(app_url, sid) if x["action"] == "submission.reject"]
        assert len(r) == 1 and r[0]["actor_email"] == SAILMAKER[0] and r[0]["before"] == "pending" and r[0]["after"] == "rejected"
        assert r[0]["reason"] == reason
    created = [x for x in audit_rows(app_url, single) if x["action"] == "submission.create"]
    assert len(created) == 1 and created[0]["actor_email"] == owner["email"]


def test_role_matrix(app_url, browser):
    assert want(call(app_url, "GET", "/api/admin/roles", sm(app_url)), 200)["items"] == ROLE_TABLE
    lh = new_account(app_url, "loft-hand")
    refused(call(app_url, "PATCH", f"/api/accounts/{lh['id']}", sm(app_url), {"role": "sailmaker", "display_name": "x"}),
            403, "role_change_forbidden", "Roles cannot be changed from the console.")
    assert want(sign_in(app_url, lh["who"]), 200)["account"]["role"] == "loft-hand"
    rows = [r for r in audit_rows(app_url, lh["id"]) if r["action"] == "account.role_change_refused"]
    assert len(rows) == 1 and rows[0]["before"] == rows[0]["after"] == "loft-hand"
    with ui(browser, app_url, SAILMAKER, "/console?tab=roles") as page:
        table = page.get_by_role("table", name="Role abilities")
        text = shows_where(page, table, lambda t: "assigned drawings with authority" in t, "role table")
        assert all(row["ability"] in text for row in ROLE_TABLE) and "while sight is granted" in text


def test_ledger_export_csv(app_url):
    for _ in range(3):
        first, _ = ledger_walk(app_url)
        body = call(app_url, "GET", "/api/exports/ledger.csv", sm(app_url))
        second, _ = ledger_walk(app_url)
        if [l["line_id"] for l in first] == [l["line_id"] for l in second]:
            break
    else:
        pytest.fail("the ledger kept changing during every export attempt")
    ctype = body.headers["content-type"].lower()
    assert body.status_code == 200 and ctype.startswith("text/csv") and "charset=utf-8" in ctype
    expected = CSV_HEADER + "\n" + "".join(csv_row(l) + "\n" for l in first)
    text = body.content.decode("utf-8")
    assert text.endswith("\n") and not text.endswith("\n\n")
    assert text == expected


def test_wf_admin_console_csv_neutralised(app_url):
    roll = new_roll(app_url, "C-18", 10000)
    reasons = ['=HYPERLINK("x")', "+probe", "-probe", "@probe", "\tprobe", "\rprobe"]
    for i, reason in enumerate(reasons, start=1):
        want(call(app_url, "POST", f"/api/stock/{roll['code']}/counts", sm(app_url), {"counted_length_mm": 10000 - i, "reason": reason}), 200)
    text = call(app_url, "GET", "/api/exports/ledger.csv", sm(app_url)).content.decode("utf-8")
    lines, _ = ledger_walk(app_url, roll["code"])
    rows = text.split("\n")
    for line in lines:
        assert csv_row(line) in rows, line
    assert any(r.endswith(',"\'=HYPERLINK(""x"")"') for r in rows)
    stock_lines = [l for l in lines if l["account"] == roll["code"] and l["amount_mm2"] < 0]
    assert stock_lines and all(f",{l['amount_mm2']}," in csv_row(l) and f",'{l['amount_mm2']}" not in csv_row(l) for l in stock_lines)


def test_audit_immutable(app_url):
    defs = pg().rows("SELECT c.relname AS tbl, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                     "WHERE NOT t.tgisinternal AND c.relname IN ('ledger_line', 'audit_trail')")
    for table in ("ledger_line", "audit_trail"):
        mine = [d["def"].upper() for d in defs if d["tbl"] == table]
        assert any("UPDATE" in d for d in mine) and any("DELETE" in d for d in mine), (table, mine)
    w = drawn_world(app_url)
    assign(app_url, w["code"], JORY[0])
    t = tok(app_url, JORY)
    c = want(take(app_url, t, new_roll(app_url)["code"], w["code"], CLAIM_LEN), 201)
    want(lay(app_url, t, c["id"], 1), 201)
    recent = want(call(app_url, "GET", f"/api/admin/audit?limit={MAX_PAGE}", sm(app_url)), 200)["items"]
    mine = [r for r in recent if r["action"] in ("claim.take", "claim.lay") and r["target"] in (c["id"], w["code"], c["stock_code"])]
    assert {r["action"] for r in mine} >= {"claim.take", "claim.lay"} and all(r["actor_email"] == JORY[0] for r in mine)


def test_wf_admin_console_journey(app_url, browser):
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"])
    t = tok(app_url, owner["who"])
    s1, s2, s3_ = [want(submit(app_url, t, boat["code"], mm_submission()), 201)["id"] for _ in range(3)]
    with ui(browser, app_url, SAILMAKER, "/console?tab=submissions") as page:
        listen(page)
        pending = seen(page, page.get_by_role("table", name="Pending submissions"), "pending table")
        seen(page, pending.get_by_role("checkbox", name=f"Select {s1}"), "row s1")
        want(call(app_url, "POST", f"/api/submissions/{s2}/decision", sm(app_url), {"decision": "accept", "reason": "ok"}), 200)
        check(pending.get_by_role("checkbox", name=f"Select {s1}"))
        check(pending.get_by_role("checkbox", name=f"Select {s2}"))
        click(page.get_by_role("button", name="Accept selected"))
        wait_heard(page, re.escape("1 applied, 1 refused."), "bulk copy")
        absent(page, pending.get_by_role("checkbox", name=f"Select {s1}"), "accepted row left")
        seen(page, pending.get_by_role("checkbox", name=f"Select {s2}"), "refused row stays")
        page.reload()
        check(seen(page, page.get_by_role("table", name="Pending submissions").get_by_role("checkbox", name=f"Select {s3_}"), "row s3"))
        click(page.get_by_role("button", name="Reject selected"))
        dlg = seen(page, page.get_by_role("dialog", name="Reject submissions"), "reject dialog")
        reject_reason = "Probe wrong mark"
        fill(dlg.get_by_label("Reason"), reject_reason)
        click(dlg.get_by_role("button", name="Reject"))
        listen(page)
        wait_heard(page, re.escape("1 applied, 0 refused."), "reject copy")
        click(page.get_by_role("tab", name="Audit"))
        shows(page, page.get_by_role("table", name="Audit trail"), s3_, "audit lists the decision")
    assert [r["action"] for r in audit_rows(app_url, s1)].count("submission.accept") == 1
    rej = [r for r in audit_rows(app_url, s3_) if r["action"] == "submission.reject"]
    assert len(rej) == 1 and rej[0]["reason"] == reject_reason


def decide(base, sid, decision, reason="Probe reason"):
    return want(call(base, "POST", f"/api/submissions/{sid}/decision", sm(base), {"decision": decision, "reason": reason}), 200)


def standing(base, season):
    return want(call(base, "GET", f"/api/admin/standing?season={season}", sm(base)), 200)


def test_tape_standing(app_url):
    seeded = {r["owner_email"]: r for r in standing(app_url, 2026)["items"]}
    for email, (counted, accepted, rejected, reversed_, streak, chip) in STANDING_SEED.items():
        r = seeded[email]
        assert (r["counted"], r["accepted"], r["rejected"], r["reversed"], r["streak"], r["standing"]) == \
            (counted, accepted, rejected, reversed_, streak, chip), r
    ranks = [seeded[e]["rank"] for e in STANDING_SEED]
    assert ranks == sorted(ranks)
    season = server_now(app_url).year
    x, y = new_account(app_url), new_account(app_url)
    bx, by = new_boat(app_url, x["email"], {}), new_boat(app_url, y["email"], {})
    tx, ty = tok(app_url, x["who"]), tok(app_url, y["who"])
    xs = [want(submit(app_url, tx, bx["code"], mm_submission()), 201)["id"] for _ in range(7)]
    for sid, verdict in zip(xs[:6], ["accept", "accept", "reject", "accept", "accept", "accept"]):
        decide(app_url, sid, verdict)
    for _ in range(4):
        decide(app_url, want(submit(app_url, ty, by["code"], mm_submission()), 201)["id"], "accept")
    row = next(r for r in standing(app_url, season)["items"] if r["owner_email"] == x["email"])
    assert (row["counted"], row["accepted"], row["rejected"], row["reversed"], row["streak"], row["standing"]) == (7, 5, 1, 0, 3, "New tape")
    seen_rows = []

    def reader():
        for _ in range(8):
            seen_rows.append(next(r for r in standing(app_url, season)["items"] if r["owner_email"] == x["email"]))

    reverse = lambda: call(app_url, "POST", f"/api/submissions/{xs[3]}/reverse", sm(app_url), {"reason": "Probe slip"})
    res = race([reverse, reverse, reader])
    assert sorted(r.status_code for r in res[:2]) == [200, 409]
    assert next(r for r in res[:2] if r.status_code == 409).json()["error"] == "not_accepted"
    for r in seen_rows:
        assert (r["accepted"], r["reversed"]) in ((5, 0), (4, 1)), r
    after = {r["owner_email"]: r for r in standing(app_url, season)["items"]}
    rx = after[x["email"]]
    assert (rx["accepted"], rx["reversed"], rx["streak"], rx["owner_name"]) == (4, 1, 3, x["name"])
    assert rx["rank"] >= 1


def test_wf_standing_journey(app_url, browser):
    season = server_now(app_url).year
    owner = new_account(app_url)
    boat = new_boat(app_url, owner["email"], {})
    t = tok(app_url, owner["who"])
    subs = [want(submit(app_url, t, boat["code"], mm_submission()), 201)["id"] for _ in range(3)]
    for sid in subs:
        decide(app_url, sid, "accept")
    with ui(browser, app_url, SAILMAKER, f"/console?tab=standing&season={season}") as page:
        table = page.get_by_role("table", name="Tape standing")
        row = table.get_by_role("row").filter(has_text=owner["name"])
        shows(page, row, "New tape", "owner row with chip")
        click(page.get_by_role("tab", name="Submissions"))
        listen(page)
        click(seen(page, page.get_by_role("table", name="Decided submissions").get_by_role("button", name=f"Reverse {subs[-1]}"), "Reverse"))
        dlg = seen(page, page.get_by_role("dialog", name="Reverse submission"), "reverse dialog")
        fill(dlg.get_by_label("Reason"), "Probe slipped")
        click(dlg.get_by_role("button", name="Reverse"))
        wait_heard(page, re.escape(f"Submission {subs[-1]} reversed."), "reverse copy")
        click(page.get_by_role("tab", name="Standing"))
        api = next(r for r in standing(app_url, season)["items"] if r["owner_email"] == owner["email"])
        assert (api["accepted"], api["reversed"], api["streak"], api["standing"]) == (2, 1, 3, "New tape")
        cells = shows_where(page, row, lambda t: "New tape" in t, "row after reversal")
        cell_texts = [c.strip() for c in table.get_by_role("row").filter(has_text=owner["name"]).get_by_role("cell").all_inner_texts()]
        for value in (api["rank"], api["counted"], api["accepted"], api["reversed"], api["streak"]):
            assert str(value) in cell_texts, (value, cell_texts, cells)


def test_wf_standing_announced(app_url, browser):
    season = server_now(app_url).year
    with ui(browser, app_url, SAILMAKER, f"/console?tab=standing&season={season}") as page:
        listen(page)
        loads = []
        page.on("request", lambda r: loads.append(r.url) if "/api/admin/standing" in r.url else None)
        seen(page, page.get_by_role("table", name="Tape standing"), "standing table")
        n = len(standing(app_url, season)["items"])
        copy = f"{n} owners in season {season}." if n != 1 else f"1 owner in season {season}."
        wait_heard(page, re.escape(copy), "standing count copy")
        page.reload()
        assert page.get_by_role("tab", name="Standing").get_attribute("aria-selected") == "true"
        assert parse_qs(urlsplit(page.url).query) == {"tab": ["standing"], "season": [str(season)]}
        listen(page)
        click(page.get_by_role("tab", name="Audit"))
        at(page, r"tab=audit", "tab in the address")
        before = len(loads)
        click(page.get_by_role("tab", name="Standing"))
        at(page, r"tab=standing", "standing tab in the address")
        poll(lambda: len(loads) > before, POLL_SECONDS, "standing fetched again on show")
        n = len(standing(app_url, season)["items"])
        wait_heard(page, re.escape(f"{n} owners in season {season}." if n != 1 else f"1 owner in season {season}."), "count announced again")
        assert times_heard(page, f"in season {season}.") >= 1


def test_renames_everywhere(app_url, browser):
    w = issued_world(app_url)
    o = w["owner"]
    want(submit(app_url, tok(app_url, o["who"]), w["boat"]["code"], mm_submission()), 201)
    g = want(grant(app_url, w["code"], o["email"]), 201)
    lh = authorised_loft_hand(app_url)
    d = drawn_world(app_url)
    assign(app_url, d["code"], lh["email"])
    roll = new_roll(app_url, "C-18", R14_LENGTH)
    want(take(app_url, tok(app_url, lh["who"]), roll["code"], d["code"], R14_LENGTH), 201)
    new_owner, new_lh = f"Probe {hexid()}", f"Probe {hexid()}"
    for acc, name in ((o, new_owner), (lh, new_lh)):
        assert want(call(app_url, "PATCH", f"/api/accounts/{acc['id']}", sm(app_url), {"display_name": name}), 200)["display_name"] == name
        rows = [r for r in audit_rows(app_url, acc["id"]) if r["action"] == "account.rename"]
        assert len(rows) == 1 and rows[0]["before"] == acc["name"] and rows[0]["after"] == name
    assert get_boat(app_url, w["boat"]["code"])["owner"]["display_name"] == new_owner
    subs = want(call(app_url, "GET", "/api/submissions?status=pending&limit=50", sm(app_url)), 200)["items"]
    assert any(s["submitted_by"]["email"] == o["email"] and s["submitted_by"]["display_name"] == new_owner for s in subs)
    assert want(call(app_url, "GET", f"/api/grants/{g['id']}", sm(app_url)), 200)["owner"]["display_name"] == new_owner
    row = next(r for r in standing(app_url, server_now(app_url).year)["items"] if r["owner_email"] == o["email"])
    assert row["owner_name"] == new_owner
    assert get_drawing(app_url, d["code"])["assigned_to"]["display_name"] == new_lh
    refused(take(app_url, sm(app_url), roll["code"], drawn_world(app_url)["code"], 100), 409, "claim_conflict",
            f"{new_lh} claimed this length first. Choose another roll or offcut.")
    with ui(browser, app_url, SAILMAKER, "/loft") as page:
        click(seen(page, page.get_by_role("button", name="New boat"), "New boat"))
        dlg = seen(page, page.get_by_role("dialog", name="New boat"), "dialog")
        select(dlg.get_by_role("combobox", name="Owner"), new_owner)


def test_motion_reduced(app_url, browser):
    roll = new_roll(app_url)
    for i in range(12):
        want(call(app_url, "POST", f"/api/stock/{roll['code']}/counts", sm(app_url), {"counted_length_mm": ROLL_LENGTH - i - 1, "reason": "Probe"}), 200)
    for reduced in (False, True):
        with ui(browser, app_url, SAILMAKER, None, reduced=reduced) as page:
            page.add_init_script(script=f"({WAAPI_JS})()")
            page.goto(app_url + f"/ledger?stock={roll['code']}")
            rows = seen(page, page.get_by_role("table", name="Ledger lines"), "ledger").get_by_role("row")
            seen(page, rows.nth(STAGGER_ROWS + 2), "a dozen rows")
            data = [rows.nth(i).evaluate(TIMINGS_JS) for i in range(1, min(rows.count(), DEFAULT_PAGE))]
            if reduced:
                assert all(d == 0 and delay == 0 for row in data for d, delay in row), data
                assert all(float(style(rows.nth(i), "opacity")["opacity"]) == 1 for i in range(1, 4))
            else:
                delays = [max(delay for _, delay in row) for row in data]
                durations = [max(d for d, _ in row) for row in data]
                for n, (delay, duration) in enumerate(zip(delays, durations), start=1):
                    assert near(delay, ROW_STAGGER_MS * min(n, STAGGER_ROWS)) and near(duration, ROW_MS), (n, delay, duration)
        if reduced:
            with ui(browser, app_url, SAILMAKER, "/stock", reduced=True) as page:
                card = seen(page, page.get_by_role("list", name="Rolls and offcuts").get_by_role("listitem"), "card")
                rest, hover = state_styles(card, "transition-duration", "transform", state="hover")
                assert all(float(v.strip().rstrip("ms").rstrip("s") or 0) == 0 for v in hover["transition-duration"].split(","))
                assert rest["transform"] != hover["transform"]


def test_responsive_layout(app_url, browser):
    w = drawn_world(app_url)
    pages = ["/loft", "/stock", "/ledger", "/console", f"/drawings/{w['code']}/draw", f"/drawings/{w['code']}/nest", f"/drawings/{w['code']}"]
    widths = [DESKTOP["width"], TABLET["width"], PHONE["width"]] + EDGE_WIDTHS
    with ui(browser, app_url, SAILMAKER) as page:
        for path in pages:
            page.goto(app_url + path)
            for width in widths:
                page.set_viewport_size({"width": width, "height": TABLET["height"]})
                advance(page, STEP_MS)
                layout(page)
            if path in ("/loft", "/stock", "/ledger", "/console"):
                for b in page.get_by_role("button").all():
                    if b.is_visible():
                        box = b.bounding_box()
                        assert box["width"] >= TAP_MIN and box["height"] >= TAP_MIN, (path, b.inner_text(), box)
    cls = """() => { const po = new PerformanceObserver(() => {}); po.observe({type: 'layout-shift', buffered: true});
      const r = po.takeRecords(); po.disconnect(); return r.filter(e => !e.hadRecentInput).reduce((s, e) => s + e.value, 0); }"""
    for path in ("/", "/signin", "/probe-missing-page"):
        for size in (DESKTOP, PHONE):
            with open_app(browser, app_url + path) as page:
                page.set_viewport_size(size)
                page.reload()
                page.evaluate("() => document.fonts.ready.then(() => true)")
                advance(page, 2000)
                layout(page)
                assert page.evaluate(cls) == 0, (path, size)


def test_published_copy(app_url, browser):
    owner, lh = new_account(app_url), new_account(app_url, "loft-hand")
    with open_app(browser, app_url + "/") as page:
        seen(page, page.get_by_role("heading", name="BOLTROPE", level=1), "hero headline")
        for text in ("A loft workbench for one sailmaker", "42.60 m² · 458.54 ft²", "The figure that ruins a sail is the one you misread."):
            seen(page, page.get_by_text(text, exact=True), text)
        page.goto(app_url + "/probe-missing-page")
        seen(page, heading(page, "That page is not in the loft."), "not-found heading")
        ui_sign_in(page, app_url, owner["who"])
        for text in ("No boat is on your account yet.", "No cut sheet has been shared with you yet."):
            seen(page, page.get_by_text(text, exact=True), text)
    with ui(browser, app_url, lh["who"], "/floor") as page:
        seen(page, page.get_by_text("Nothing is assigned to you on the cutting floor.", exact=True), "floor empty")
    email = f"probe-{hexid()}@owners.example"
    with ui(browser, app_url, SAILMAKER, "/accounts") as page:
        click(seen(page, page.get_by_role("button", name="New account"), "New account"))
        dlg = seen(page, page.get_by_role("dialog", name="New account"), "dialog")
        fill(dlg.get_by_label("Display name"), "Probe Copy")
        fill(dlg.get_by_label("Email"), email)
        fill(dlg.get_by_label("Password"), "Probe-Copy-26!")
        select(dlg.get_by_role("combobox", name="Role"), "Yacht owner")
        listen(page)
        click(dlg.get_by_role("button", name="Create account"))
        wait_heard(page, "^" + re.escape(f"Account created for {email}.") + "$", "account copy verbatim")


APP = Path("/app")


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m.get(k), str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_notices():
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notes]
    assert not missing, missing
    assert "Red Hat Display" in notes and "Red Hat Text" in notes and "OFL" in notes


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence or "", ALLOWED_LICENCES)]
    assert not bad, bad


def test_if_datastores():
    pkg = json.loads((APP / "package.json").read_text())
    deps = set(pkg.get("dependencies", {})) | set(pkg.get("optionalDependencies", {}))
    forbidden = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "mysql", "mysql2", "amqplib",
                 "kafkajs", "lowdb", "nedb", "level", "memcached", "bullmq", "bull"}
    assert not deps & forbidden, deps & forbidden
    files = [p for p in APP.rglob("*") if "node_modules" not in p.parts and p.suffix in (".sqlite", ".sqlite3", ".db")]
    assert not files, files


def test_if_service_config_unchanged():
    compose = [p for p in APP.iterdir() if re.fullmatch(r"(docker-)?compose.*\.ya?ml", p.name)]
    if (APP / ".git").exists():
        changed = subprocess.run(["git", "-C", str(APP), "diff", "--name-only", "HEAD", "--"] + [p.name for p in compose],
                                 capture_output=True, text=True, timeout=HTTP_TIMEOUT).stdout.split()
        assert not changed, changed
    for p in compose:
        text = p.read_text().lower()
        assert all(svc.lower() in text for svc in ("Postgres", "Keycloak", "MinIO")), p


def test_if_strict_typescript():
    def load(path):
        raw = path.read_text()
        raw = re.sub(r"/\*.*?\*/|^\s*//[^\n]*", "", raw, flags=re.S | re.M)
        raw = re.sub(r",(\s*[}\]])", r"\1", raw)
        return json.loads(raw)

    def is_strict(path, depth=0):
        cfg = load(path)
        opts = cfg.get("compilerOptions", {})
        if "strict" in opts:
            return opts["strict"] is True
        parents = cfg.get("extends") or []
        for e in ([parents] if isinstance(parents, str) else parents):
            p = path.parent / e
            if p.suffix != ".json":
                p = p.with_name(p.name + ".json")
            if p.exists() and depth < 8 and is_strict(p, depth + 1):
                return True
        return False

    configs = [p for p in list(APP.glob("tsconfig*.json")) + list(APP.glob("*/tsconfig*.json")) if "node_modules" not in p.parts]
    assert configs, "no tsconfig found"
    checked = [p for p in configs if "compilerOptions" in load(p) or "extends" in load(p)]
    assert checked and all(is_strict(p) for p in checked), [p.name for p in checked if not is_strict(p)]
    scripts = json.loads((APP / "package.json").read_text()).get("scripts", {})
    build = scripts.get("build", "")
    called = [scripts.get(m, "") for m in re.findall(r"npm run ([\w:-]+)", build)]
    assert any("tsc" in text for text in [build] + called), build
    assert any(APP.rglob("*.ts"))


def test_if_same_origin_assets(app_url, browser):
    with ui(browser, app_url, None, None) as page:
        urls = []
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", "/signin"):
            page.goto(app_url + path)
            advance(page, 1000)
        ui_sign_in(page, app_url, SAILMAKER)
        page.goto(app_url + "/stock")
        advance(page, 1000)
    foreign = [u for u in urls if not u.startswith("data:") and not same_origin(u, app_url)]
    assert not foreign, foreign
