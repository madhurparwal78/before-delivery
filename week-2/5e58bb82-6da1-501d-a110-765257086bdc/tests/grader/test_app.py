from __future__ import annotations

import concurrent.futures as cf
import hashlib
import json
import math
import os
import re
import socket
import threading
import time
import unicodedata
from email.utils import parsedate_to_datetime
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
from playwright.sync_api import expect

from conftest import (
    S3, Postgres, addresses, advance, animations, capture, changed, check, click, decode, held,
    idempotency_key, layout, licence_allowed, open_app, same_origin, select, session, shipped_packages,
    tab_order, tap, text, unique, until,
)


PASSWORD = "chartroom-2026"
IRA, WREN, TAMSIN = "ira@fathomwright.test", "wren@fathomwright.test", "tamsin@fathomwright.test"
ODILE, BRAM = "odile@calderhaven-port.test", "bram@saltmere-dredging.test"
NAMES = {IRA: "Ira Penhallow", WREN: "Wren Calloway", TAMSIN: "Tamsin Rook", ODILE: "Odile Varga", BRAM: "Bram Echols"}
KEYS = {"v-kittiwake": "ik-kittiwake-4c19", "v-petrel": "ik-petrel-8a03", "v-shearwater": "ik-shearwater-2e77", "v-gannet": "ik-gannet-61b5"}
VNAME = {"v-kittiwake": "Kittiwake", "v-petrel": "Petrel", "v-shearwater": "Shearwater", "v-gannet": "Gannet"}
SEED_ORDER = ["v-kittiwake", "v-petrel", "v-shearwater", "v-gannet"]
CALDER, SALT = "m-calderhaven-north", "m-saltmere-approach"
HOMES = {IRA: "/fleet", TAMSIN: "/launch", ODILE: "/surveys"}
SURVEY_DATE = "2026-11-02"
FIX_T0 = datetime(2026, 11, 2, 8, 0, tzinfo=timezone.utc)

INTERVAL_MIN, INTERVAL_MAX = 50, 1000
NOTE_MAX = 500
BATCH_MAX = 100
JSON_MAX = 64_000
FILE_MAX = 50_000_000
RETRY_AFTER = "30"
LOCK_AFTER = 5
RACE_ATTEMPTS = 10
PAIR_MAX_S = 60
LIVE_S, LOST_S = 10, 60
OVERSPEED = 1.5
HEADING_MAX = 20
CELL = 5
RUN_MIN = 3
CELL_AREA = 25
ORDER_COEF = {"special": (0.25, 0.0075), "1a": (0.5, 0.013)}
MEETS_PCT = Decimal("95.0")
FIX_SCREEN_S = 2
LINK_SCREEN_S = 5
MAIL_S = 30
STATUS_S = 15
ABANDONS = 20
HEALTH_MAX_S = 1
NEXT_UPLOAD_S = 10
IDLE_MS = 28 * 60 * 1000
COUNTDOWN_MS = 2 * 60 * 1000
PAGE_SIZE = 20
LENS_STEP_M, LENS_SHIFT_M = 10, 50
LENS_OPEN_MS = 200
TOUCH_MIN_PX = 44
CHART_MIN_PX = 300
FT = 0.3048
KN = 1852 / (60 * 60)

HTTP_S = 60
SLACK_S = 15
WAIT_S = 30
FRAME_MS = 16
POLL_S = 0.5

STORAGE_503 = {"error": "storage_unavailable", "message": "Storage is unavailable. Try again in a moment."}

HOUR_S = 60 * 60
HOURS_ROUND = 0.001
SECOND_MS = 1000
MINUTE_MS = 60 * SECOND_MS
TEN_S_MS = 10 * SECOND_MS
REFRESH_MS = 2 * SECOND_MS
STATUS_POLL_MS = 5 * SECOND_MS
READ_TOL = 0.06
FILE_EXT = ".raw"

RIGHT, LEFT, UP, DOWN = "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"
SELECT_ALL = "Control+A"
CTRL_ENTER = "Control+Enter"

PREVIEW_GLOB = "**/api/plan-preview"
SURVEY_LIST_GLOB = "**/api/missions*"
INFILL_GLOB = "**/holidays/*/infill"
STATUS_GLOB = "**/api/status"
FILE_GLOB = "**/api/lines/*/file"
TRANSITION_GLOB = "**/api/missions/*/transitions"
READOUT_RE = r"E (-?[\d.,]+) N (-?[\d.,]+)"
SETTLE_LENS_MS = 300
NUMBER_RE = r"-?[\d,\u00a0\u202f]*\.?\d+"
ASSET_RE = r'(?:src|href)="(/[^"]+)"'
IDLE_TX_SQL = ("SELECT pid FROM pg_stat_activity WHERE datname = current_database() "
               "AND usename <> current_user AND state LIKE 'idle in transaction%'")

T_EN = "E <easting> N <northing>"
T_FIX_ROW = "<HH:MM:SS> UTC · E <easting> N <northing> · <speed>"
T_COUNTDOWN = "You will be signed out in <m:ss> to protect this console."
T_LOCKED = "Too many sign-in attempts. Try again after <HH:MM> UTC."
T_HELP = "One vertex per line as easting, northing in <unit>, for example 5000, 8000. Enter starts a new line; Ctrl+Enter creates the mission."
T_PREVIEW = "<line count> lines · <crossline count> cross · <minutes> min"
T_VESSEL_FOR = "Vessel for <line>"
T_OVERDUE = "<vessel> is overdue for thruster service (<hours> h since service, limit <interval> h). Log a service before assigning or launching."
T_CURRENT = "Current: <interval> h"
T_STALE = "<vessel> was changed by someone else. Review the latest values and save again."
T_INTERVAL_SAVED = "Service interval saved for <vessel>"
T_NOT_AFLOAT = "Not afloat yet: <vessels>"
T_RECOVER_ALL = "Recover every vessel before completing: <vessels>"
T_ILLEGAL = "This mission cannot move from <from> to <to>"
T_LINE_MOVE = "Line <line> cannot move from <from> to <to>"
T_COMMITTED = "<vessel> is already on <mission>"
T_MARKING_AFLOAT = "Marking <vessel> afloat"
T_IS_AFLOAT = "<vessel> is afloat"
T_IS_RECOVERED = "<vessel> is recovered"
T_NO_REACH_ASHORE = "Could not reach Swathdeck — <vessel> is still ashore"
T_NO_REACH_AFLOAT = "Could not reach Swathdeck — <vessel> is still afloat"
T_NO_REACH_SERVICE = "Could not reach Swathdeck — service for <vessel> is not logged yet"
T_SERVICE_LOGGED = "Service logged for <vessel>"
T_AFLOAT_SERVICE = "Recover <vessel> before logging a service"
T_DETAIL = "<vessel> detail"
T_LINK_STALE = "<vessel> link stale"
T_LINK_LOST_ANN = "<vessel> link lost"
T_LINK_LIVE = "<vessel> link live"
T_LINK_LOST = "Link lost — <vessel>"
T_BREACH = "Geofence breach — <vessel>"
T_BACK_INSIDE = "<vessel> back inside the geofence"
T_SUBJ_BREACH = "Geofence breach — <vessel> — <mission>"
T_SUBJ_LINK = "Link lost — <vessel> — <mission>"
T_SUBJ_ESC = "Escalation: <original alert subject>"
T_SUBJ_REPORT = "Coverage report ready — <mission>"
T_ACK_BY = "Acknowledged by <name> at <HH:MM:SS> UTC"
T_RECTIFIED = "Rectified at <HH:MM:SS> UTC"
T_ACK_BTN = "Acknowledge <alert heading>"
T_LENS_ROW = "<holiday> · <area>"
T_INFILL_IMG = "Infill <line>"
T_QUEUED = "Infill <line> queued to <vessel>"
T_REPLAY = "Infill <line> is already queued to <vessel>"
T_NO_ELIGIBLE = "No eligible vessel for <holiday>"
T_HOL_CLOSED_409 = "<holiday> has already closed"
T_NO_REACH_QUEUE = "Could not reach Swathdeck — <holiday> is not queued yet"
T_QUEUEING = "Queueing infill for <holiday>"
T_QUEUED_TO = "Queued to <vessel>"
T_QUEUE_BTN = "Queue infill <holiday>"
T_NEAREST = "nearest <vessel>"
T_MOVED = "Infill <line> moved to <vessel>"
T_HOL_CLOSED = "<holiday> closed"
T_QUEUE_ROW = "<position>. <line> · <holiday>"
T_REORDERED = "<line> moved to position <n> of <total>"
T_QUEUE_LIST = "Infill queue for <vessel>"
T_STORED = "<line> stored"
T_DIFFERENT = "<line> already holds a different file"
T_SESSION_ENDED = "Your session ended — sign in again to finish uploading <line>"
T_WAITING = "Waiting for storage — <line> will upload when it returns"
T_STORAGE_UPLOAD = "Storage is unreachable — <line> is still awaiting upload"
T_UPLOAD_BTN = "Upload file for <line>"
T_DOWNLOAD = "Download <line>"
T_SHA_ROW = "SHA-256 <sha256>"
T_DISPOSITION = 'attachment; filename="<file name>"'
T_CSV_DISPOSITION = 'attachment; filename="<slug>-coverage.csv"'
T_COMPLETE = "<mission> complete — <n> missions open"
T_NO_REACH_COMPLETE = "Could not reach Swathdeck — <mission> is still recovering"
T_SHOWING = "Showing <shown> of <total> surveys"
T_MARK_AFLOAT_BTN = "Mark <vessel> afloat"
T_MARK_RECOVERED_BTN = "Mark <vessel> recovered"
T_LOG_SERVICE_BTN = "Log service for <vessel>"
T_R1 = "Coverage report ready for <mission>."
T_R2 = "Completed <YYYY-MM-DD HH:MM> (<offset>)"
T_R3 = "Completed UTC <YYYY-MM-DD HH:MM>"
T_R4 = "Report SHA-256 <hex>"
T_R5 = "Coverage <coverage_pct>% · Open holidays <open_holidays> · Crossline agreement <pct>% of <compared>"
T_R6 = "Open the survey: <APP_PUBLIC_URL>/surveys/<mission id>"

AREA = [(0, 0), (60, 0), (60, 40), (0, 40)]
TINY = [(0, 0), (20, 0), (20, 60), (0, 60)]
FENCE = [(-50, -50), (110, -50), (110, 90), (-50, 90)]
INSIDE, OUTSIDE = (10.0, 10.0), (200.0, 200.0)


def short_url():
    return os.environ["APP_SHORT_URL"].rstrip("/")


def minio_down_url():
    return os.environ["APP_MINIO_DOWN_URL"].rstrip("/")


def mail_down_url():
    return os.environ["APP_MAILPIT_DOWN_URL"].rstrip("/")


def poll(fn, seconds, msg=""):
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        assert time.monotonic() < deadline, f"timed out after {seconds}s: {msg}"
        threading.Event().wait(POLL_S)


def ok(r, *codes):
    codes = codes or (200,)
    assert r.status_code in codes, f"{r.request.method} {r.request.url} -> {r.status_code}: {r.text[:400]}"
    return r.json() if "json" in r.headers.get("content-type", "") and r.content else r


def err(r, status, code=None, extra=()):
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code}: {r.text[:400]}"
    body = r.json()
    expected = {"error", "message", *extra}
    assert expected <= set(body) <= expected | ({"errors"} if status == 422 else set()), body
    if code:
        assert body["error"] == code, body
    return body


def parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(dt):
    return dt.astimezone(timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + "Z"


def r1(x):
    return Decimal(str(x)).quantize(Decimal("0.1"), ROUND_HALF_UP)


def num(s):
    return Decimal(re.search(NUMBER_RE, s).group(0).replace(",", "").replace("\u00a0", "").replace("\u202f", ""))


def pts(shape):
    return [{"easting": e, "northing": n} for e, n in shape]


def mname():
    return unique("Survey")[0]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def say(template, subs):
    for key, value in subs.items():
        template = template.replace(key, str(value))
    return template


def route_of(path):
    return "**" + path


def vpath(vid, tail=""):
    return f"/api/vessels/{vid}{tail}"


def fname(label):
    return label + FILE_EXT


def hms(dt):
    return f"{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d}"


def ymdhm(dt):
    return f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d} {dt.hour:02d}:{dt.minute:02d}"


def offset_str(local):
    minutes = int(local.utcoffset().total_seconds() // 60)
    sign = "-" if minutes < 0 else "+"
    return f"{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}"


def en(e, n):
    return say(T_EN, {"<easting>": r1(e), "<northing>": r1(n)})


def ack_name(vessel_name):
    return say(T_ACK_BTN, {"<alert heading>": say(T_BREACH, {"<vessel>": vessel_name})})


def slug(name, fallback):
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    out = "".join(ch if ch.isascii() and ch.isalnum() else "-" for ch in plain)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-") or fallback


def csv_field(value):
    if any(c in value for c in ',"\r\n'):
        return '"' + value.replace('"', '""') + '"'
    return value


def plan(area, depth, ratio=4, overlap=20, azimuth=0, speed=2.0):
    w = depth * ratio
    s = w * (1 - overlap / 100)
    a = math.radians(azimuth)
    along, across = (math.sin(a), math.cos(a)), (math.cos(a), -math.sin(a))

    def dot(p, d):
        return p[0] * d[0] + p[1] * d[1]

    def chord(d, value, order):
        found = []
        for i, p in enumerate(area):
            q = area[(i + 1) % len(area)]
            fp, fq = dot(p, d) - value, dot(q, d) - value
            if abs(fp) < 1e-9:
                found.append(p)
            elif fp * fq < 0 and abs(fq) >= 1e-9:
                k = fp / (fp - fq)
                found.append((p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k))
        return min(found, key=lambda x: dot(x, order)), max(found, key=lambda x: dot(x, order))

    p0 = min(dot(p, across) for p in area)
    span = max(dot(p, across) for p in area) - p0
    if span <= w:
        offsets = [span / 2]
    else:
        n = 1 + math.ceil((span - w) / s)
        offsets = [w / 2 + i * s for i in range(n - 1)] + [span - w / 2]
    lines = [chord(across, p0 + o, along) for o in offsets]
    total = sum(math.dist(*c) for c in lines)
    q0 = min(dot(p, along) for p in area)
    e = max(dot(p, along) for p in area) - q0
    k = 1
    while True:
        cross = [chord(along, q0 + e * (j + 1) / (k + 1), across) for j in range(k)]
        if sum(math.dist(*c) for c in cross) >= 0.05 * total:
            break
        k += 1
    seconds = (total + sum(math.dist(*c) for c in cross)) / speed + 60 * (len(lines) + k - 1)
    duration = int(Decimal(str(seconds)).quantize(Decimal("1"), ROUND_HALF_UP))
    return {"swath_width_m": w, "line_spacing_m": s, "line_count": len(lines), "crossline_count": k,
            "estimated_duration_s": duration, "lines": lines, "crosslines": cross}


def preview_copy(p):
    minutes = (Decimal(p["estimated_duration_s"]) / 60).quantize(Decimal("1"), ROUND_HALF_UP)
    return say(T_PREVIEW, {"<line count>": p["line_count"], "<crossline count>": p["crossline_count"], "<minutes>": minutes})


def same_plan(got, want):
    for k in ("swath_width_m", "line_spacing_m", "line_count", "crossline_count", "estimated_duration_s"):
        assert abs(got[k] - want[k]) < 1e-6, (k, got[k], want[k])


def near(pos, p):
    return abs(pos["easting"] - p[0]) < 1e-6 and abs(pos["northing"] - p[1]) < 1e-6


def same_lines(ls, want):
    for prefix, kind, chords in (("L", "planned", want["lines"]), ("X", "crossline", want["crosslines"])):
        for i, (a, b) in enumerate(chords):
            line = ls[f"{prefix}{i + 1:02d}"]
            assert line["kind"] == kind and line["status"] == "Pending"
            assert near(line["start"], a) and near(line["end"], b), (line["label"], line["start"], line["end"], a, b)
            assert abs(line["length_m"] - math.dist(a, b)) < 1e-6


def walk(page, e0, n0, target):
    for (pos, neg), delta in (((RIGHT, LEFT), target["easting"] - e0), ((UP, DOWN), target["northing"] - n0)):
        presses = round(delta / LENS_STEP_M)
        for _ in range(abs(presses)):
            page.keyboard.press(pos if presses > 0 else neg)


def parallel(fns):
    barrier = threading.Barrier(len(fns))

    def run(fn):
        barrier.wait()
        return fn()

    with cf.ThreadPoolExecutor(len(fns)) as ex:
        return list(ex.map(run, fns))


_clients: dict = {}


def api(base, email):
    c = _clients.get((base, email))
    if c is None or c.get("/api/me").status_code != 200:
        c = httpx.Client(base_url=base, timeout=HTTP_S)
        ok(c.post("/api/session", json={"email": email, "password": PASSWORD}))
        _clients[(base, email)] = c
    return c


def fresh(base, email):
    c = httpx.Client(base_url=base, timeout=HTTP_S)
    ok(c.post("/api/session", json={"email": email, "password": PASSWORD}))
    return c


def metric(base, email):
    ok(api(base, email).patch("/api/me", json={"units": "metric"}))


def vessel(base, vid):
    return ok(api(base, IRA).get(f"/api/vessels/{vid}"))


def set_interval(base, vid, hours):
    v = vessel(base, vid)
    if v["service_interval_h"] != hours:
        ok(api(base, IRA).patch(f"/api/vessels/{vid}", json={"service_interval_h": hours, "version": v["version"]}))


def overdue_msg(v):
    return say(T_OVERDUE, {"<vessel>": v["name"], "<hours>": r1(v["hours_since_service"]), "<interval>": f"{v['service_interval_h']:g}"})


def ingest(base, vid, body):
    return httpx.post(f"{base}/api/ingest/fixes", json=body, headers={"X-Ingest-Key": KEYS[vid]}, timeout=HTTP_S)


def line_cmd(base, vid, line_id, cmd):
    return httpx.post(f"{base}/api/ingest/lines/{line_id}/{cmd}", json={}, headers={"X-Ingest-Key": KEYS[vid]}, timeout=HTTP_S)


def fx(t, e, n, heading=0.0, speed=2.0, depth=5.0, battery=80.0):
    return {"t": iso(t), "easting": e, "northing": n, "heading_deg": heading, "speed_mps": speed,
            "battery_pct": battery, "depth_m": depth}


def next_t(base, vid):
    fixes = ok(api(base, IRA).get(f"/api/vessels/{vid}/fixes"))
    last = max((parse(f["t"]).replace(microsecond=0) for f in fixes), default=FIX_T0)
    return max(last, FIX_T0) + timedelta(seconds=1)


def fix(base, vid, e, n, **kw):
    return ok(ingest(base, vid, fx(next_t(base, vid), e, n, **kw)), 201)


def by_label(lines):
    return {l["label"]: l for l in lines}


def get_lines(base, mid):
    return by_label(ok(api(base, IRA).get(f"/api/missions/{mid}/lines")))


def get_mission(base, mid):
    return ok(api(base, IRA).get(f"/api/missions/{mid}"))


def transition(base, mid, to, email=IRA):
    return api(base, email).post(f"/api/missions/{mid}/transitions", json={"to": to})


def assign(base, mid, mapping, email=IRA):
    return api(base, email).post(f"/api/missions/{mid}/assignments",
                                 json={"assignments": [{"line_id": l, "vessel_id": v} for l, v in mapping.items()]})


def free(base, *vids):
    T = api(base, TAMSIN)
    for vid in vids:
        v = vessel(base, vid)
        if v["running_line_id"]:
            ok(line_cmd(base, vid, v["running_line_id"], "end"))
        if v["mission_id"]:
            m = get_mission(base, v["mission_id"])
            if m["status"] == "Planned":
                held_lines = {l["id"]: None for l in get_lines(base, m["id"]).values()
                              if l["vessel_id"] == vid and l["status"] in ("Pending", "Assigned")}
                if held_lines:
                    ok(assign(base, m["id"], held_lines))
            else:
                ok(transition(base, m["id"], "Aborted"))
                close_alerts(base, m["id"])
        ok(T.post(f"/api/vessels/{vid}/recovered", json={}))
        set_interval(base, vid, INTERVAL_MAX)


def ashore(base, vid):
    v = vessel(base, vid)
    if v["running_line_id"]:
        ok(line_cmd(base, vid, v["running_line_id"], "end"))
    ok(api(base, TAMSIN).post(vpath(vid, "/recovered"), json={}))


def gone(page, locator, seconds=WAIT_S):
    end = time.monotonic() + seconds
    while locator.count():
        assert time.monotonic() < end, "element never left the page"
        advance(page, 48)


def close_alerts(base, mid):
    P = api(base, IRA)

    def round_():
        left = [a for a in ok(P.get("/api/alerts?status=open")) if a["mission_id"] == mid]
        for a in left:
            if a["state"] in ("Active", "Rectified"):
                P.post(f"/api/alerts/{a['id']}/ack", json={})
        return not left
    try:
        poll(round_, SLACK_S, "alerts of an ended mission closed")
    except AssertionError:
        pass


def create(base, org="org-calderhaven", area=AREA, fence=FENCE, name=None, **kw):
    body = {"name": name or mname(), "client_org_id": org, "survey_date": SURVEY_DATE, "survey_area": pts(area),
            "geofence": pts(fence), "planned_depth_m": 5, "swath_ratio": 4, "overlap_pct": 0,
            "line_azimuth_deg": 0, "planned_speed_mps": 2, "survey_order": "special"}
    body.update(kw)
    return ok(api(base, IRA).post("/api/missions", json=body), 201)


def launched(base, default, extra=None, launch=True, **kw):
    extra = extra or {}
    vids = sorted({default, *extra.values()})
    free(base, *vids)
    m = create(base, **kw)
    ls = get_lines(base, m["id"])
    ok(assign(base, m["id"], {l["id"]: extra.get(lab, default) for lab, l in ls.items()}))
    for vid in vids:
        ok(api(base, TAMSIN).post(f"/api/vessels/{vid}/afloat", json={}))
    if launch:
        ok(transition(base, m["id"], "Launched"))
    return get_mission(base, m["id"]), get_lines(base, m["id"])


def survey(base, vid, line, depth=5.0, steps=4):
    s, e = line["start"], line["end"]
    heading = math.degrees(math.atan2(e["easting"] - s["easting"], e["northing"] - s["northing"])) % 360
    t = next_t(base, vid)
    ok(line_cmd(base, vid, line["id"], "start"))
    fixes = [fx(t + timedelta(seconds=10 * i), s["easting"] + (e["easting"] - s["easting"]) * i / steps,
                s["northing"] + (e["northing"] - s["northing"]) * i / steps, heading=heading, depth=depth)
             for i in range(steps + 1)]
    ok(ingest(base, vid, {"fixes": fixes}), 201)
    ok(line_cmd(base, vid, line["id"], "end"))


def recovering(base, default="v-gannet", extra=None, org="org-calderhaven", depth=5.0, **kw):
    m, ls = launched(base, default, extra, area=TINY, org=org, **kw)
    for lab, l in ls.items():
        survey(base, l["vessel_id"], l, depth=depth)
    m = get_mission(base, m["id"])
    assert m["status"] == "Recovering", m["status"]
    return m, get_lines(base, m["id"])


def upload(c, line, data, name=None, digest=None):
    return c.put(f"/api/lines/{line['id']}/file", content=data,
                 headers={"Content-Type": "application/octet-stream", "X-Line-File-Name": name or fname(line["label"]),
                          "X-Content-SHA256": digest or sha(data)})


def payload(label):
    return f"SWATH {label} ".encode() + bytes(range(256)) * 7 + b"\r\n\x00" + os.urandom(64)


def delivered(base, default="v-gannet", extra=None, org="org-calderhaven"):
    m, ls = recovering(base, default, extra, org)
    files = {}
    for lab, l in ls.items():
        files[lab] = payload(lab)
        ok(upload(api(base, TAMSIN), l, files[lab]), 201)
    return m, get_lines(base, m["id"]), files


def completed(base, default="v-gannet", extra=None, org="org-calderhaven"):
    m, ls, files = delivered(base, default, extra, org)
    for vid in {default, *(extra or {}).values()}:
        ok(api(base, TAMSIN).post(f"/api/vessels/{vid}/recovered", json={}))
    ok(transition(base, m["id"], "Complete", TAMSIN))
    poll(lambda: get_mission(base, m["id"])["report"]["state"] == "Ready", WAIT_S, "report Ready")
    return get_mission(base, m["id"]), ls, files


def alerts(base, mid, kind=None, vid=None, status="all"):
    return [a for a in ok(api(base, IRA).get(f"/api/alerts?status={status}"))
            if a["mission_id"] == mid and kind in (None, a["kind"]) and vid in (None, a["vessel_id"])]


def inbox(mail, subject, minimum=1, seconds=MAIL_S + SLACK_S):
    return poll(lambda: (lambda ms: ms if len(ms) >= minimum else None)(
        [m for m in mail.messages() if m.get("Subject") == subject]), seconds, subject)


@contextmanager
def heartbeat(base, vid, e, n):
    stop, t = threading.Event(), [next_t(base, vid)]

    def loop():
        while not stop.is_set():
            ingest(base, vid, fx(t[0], e, n, speed=0.0))
            t[0] += timedelta(seconds=5)
            stop.wait(2)

    th = threading.Thread(target=loop, daemon=True)
    th.start()
    try:
        yield
    finally:
        stop.set()
        th.join()


def holiday_mission(base, stack):
    m, ls = launched(base, "v-kittiwake", {"L03": "v-gannet", "X01": "v-gannet"})
    survey(base, "v-kittiwake", ls["L01"], depth=2.5)
    stack.enter_context(heartbeat(base, "v-gannet", 50.0, 0.0))
    hols = poll(lambda: (lambda h: h if len(h) == 2 else None)(
        [h for h in ok(api(base, IRA).get(f"/api/missions/{m['id']}/holidays")) if h["status"] == "Open"]), WAIT_S, "two holidays")
    west = min(hols, key=lambda h: h["centroid"]["easting"])
    east = max(hols, key=lambda h: h["centroid"]["easting"])
    return m, ls, west, east


HAS = "t => document.body.innerText.includes(t)"


def login_form(page, email, password=PASSWORD):
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Sign in").click()


def path_q(url):
    u = urlparse(url)
    return u.path + (f"?{u.query}" if u.query else "")


@contextmanager
def screen(browser, base, email, path, size=(1280, 800), **opts):
    metric(base, email)
    with open_app(browser, f"{base}/sign-in?next={quote(path, safe='')}", **opts) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        login_form(page, email)
        page.wait_for_url(lambda u: path_q(u) == path)
        listen(page)
        yield page


def pick(locator, choice):
    if locator.evaluate("e => e.tagName === 'SELECT'"):
        select(locator, choice)
        return
    locator.click()
    target = next((o for o in locator.page.get_by_role("option", name=choice, exact=True).all() if o.is_visible()), None)
    assert target is not None, f"no visible option {choice!r}"
    target.click()
    shows_choice(locator, choice)


def lens_shown(page):
    lens = page.get_by_role("img", name="Holiday lens")
    end = time.monotonic() + WAIT_S
    while not (lens.count() and lens.first.is_visible()):
        assert time.monotonic() < end, "holiday lens never shown"
        page.clock.run_for(FRAME_MS)
    return lens


def see(page, copy, seconds=WAIT_S):
    until(page, HAS, copy, seconds)


def announce(page):
    return page.get_by_role("status", name="Fleet announcements")


HEARD = """() => { if (window.__heard) return; window.__heard = []; window.__heardFrom = 0; const last = new Map();
  const keep = () => document.querySelectorAll('[role=status],[role=alert],[aria-live]').forEach(r => {
    const t = (r.textContent || '').trim(); if (t && last.get(r) !== t) { last.set(r, t); window.__heard.push(t); } });
  new MutationObserver(keep).observe(document.body, {subtree: true, childList: true, characterData: true}); keep(); }"""
HEARD_NEXT = """h => { const from = window.__heardFrom || 0;
  const i = (window.__heard || []).findIndex((t, k) => k >= from && t.includes(h));
  if (i >= 0) { window.__heardFrom = i + 1; return true; }
  return [...document.querySelectorAll('[role=status],[role=alert],[aria-live]')].some(r => (r.textContent || '').includes(h)); }"""
SAID = "h => (window.__heard || []).some(t => t.includes(h))"


def listen(page):
    page.evaluate(HEARD)


def heard(page, copy, seconds=WAIT_S):
    page.evaluate(HEARD)
    until(page, HEARD_NEXT, copy, seconds)


def shows_choice(locator, choice):
    if locator.evaluate("e => e instanceof HTMLInputElement"):
        expect(locator).to_have_value(re.compile(re.escape(choice)))
    else:
        expect(locator).to_contain_text(choice)


def card(page, vid):
    return page.get_by_role("region", name="Fleet").get_by_role("listitem").filter(
        has=page.get_by_role("button", name=VNAME[vid], exact=True))


def readout(page):
    advance(page, SETTLE_LENS_MS)
    m = re.search(READOUT_RE, page.get_by_role("group", name="Lens readout").inner_text())
    return float(m.group(1).replace(",", "")), float(m.group(2).replace(",", ""))


def inside_viewport(page, locator):
    box, vp = locator.bounding_box(), page.viewport_size
    return box and box["x"] >= -0.5 and box["y"] >= -0.5 and box["x"] + box["width"] <= vp["width"] + 0.5 \
        and box["y"] + box["height"] <= vp["height"] + 0.5


def shown_value(locator):
    return locator.evaluate("e => (typeof e.value === 'string' && e.value) ? e.value : (e.textContent || '')")


def lens_onto(page, chart, cells, origin):
    box = chart.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    probe = 40

    def at(x, y):
        page.mouse.move(x, y)
        advance(page, 500)
        until(page, "() => true", None, 5)
        return readout(page)

    def cell_of(e, n):
        return (math.floor((e - origin["easting"]) / CELL), math.floor((n - origin["northing"]) / CELL))

    e1, n1 = at(cx, cy)
    x, y = cx + probe, cy + probe
    e, n = at(x, y)
    sx, sy = (e - e1) / probe, (n - n1) / probe
    target = min(cells, key=lambda c: c[1])
    tx = origin["easting"] + CELL * target[0] + CELL / 2
    ty = origin["northing"] + CELL * target[1] + CELL / 2
    for _ in range(4):
        if cell_of(e, n) in cells:
            return cell_of
        x, y = x + (tx - e) / sx, y + (ty - n) / sy
        e, n = at(x, y)
    assert cell_of(e, n) in cells, (e, n, target)
    return cell_of


def hit(locator):
    return locator.evaluate("e => { const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e === h || e.contains(h); }")


def model(area, planned_speed, ratio, azimuth, runs):
    xs, ys = [p[0] for p in area], [p[1] for p in area]
    ox, oy = CELL * math.floor(min(xs) / CELL), CELL * math.floor(min(ys) / CELL)
    cols, rows = (CELL * math.ceil(max(xs) / CELL) - ox) // CELL, (CELL * math.ceil(max(ys) / CELL) - oy) // CELL
    cells_by_line, covered, depth = {}, {}, {}
    for label, kind, fixes in runs:
        direction = azimuth + (90 if kind == "crossline" else 0)
        cells, length = set(), 0.0
        for a, b in zip(fixes, fixes[1:]):
            dt = (parse(b["t"]) - parse(a["t"])).total_seconds()
            d = ((b["heading_deg"] - direction) % 180 + 180) % 180
            if not (0 < dt <= PAIR_MAX_S and b["speed_mps"] <= OVERSPEED * planned_speed and min(d, 180 - d) <= HEADING_MAX):
                continue
            ax, ay, bx, by = a["easting"], a["northing"], b["easting"], b["northing"]
            seg = math.hypot(bx - ax, by - ay)
            length += seg
            ux, uy, hw = (bx - ax) / seg, (by - ay) / seg, b["depth_m"] * ratio / 2
            for c in range(cols):
                for r in range(rows):
                    cx, cy = ox + CELL * c + 2.5, oy + CELL * r + 2.5
                    s, w = (cx - ax) * ux + (cy - ay) * uy, abs((cy - ay) * ux - (cx - ax) * uy)
                    if 0 <= s <= seg and w <= hw:
                        cells.add((c, r))
                        depth.setdefault((label, (c, r)), []).append(b["depth_m"])
        cells_by_line[label], covered[label] = cells, length
    overlap = [[sum((c, r) in s for s in cells_by_line.values()) for c in range(cols)] for r in range(rows)]
    return {"origin": (ox, oy), "cols": cols, "rows": rows, "overlap": overlap, "covered": covered, "depth": depth}


def groups(mdl, area_min_e, offsets, surveyed):
    bounds = [(a + b) / 2 for a, b in zip(offsets, offsets[1:])]
    ox = mdl["origin"][0]
    hcells = {(c, r) for r in range(mdl["rows"]) for c in range(mdl["cols"])
              if mdl["overlap"][r][c] == 0 and surveyed[sum(ox + CELL * c + 2.5 - area_min_e >= b for b in bounds)]}
    seen, hol, specks = set(), [], []
    for start in sorted(hcells):
        if start in seen:
            continue
        grp, stack = set(), [start]
        while stack:
            c, r = stack.pop()
            if (c, r) in grp:
                continue
            grp.add((c, r))
            stack += [p for p in ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)) if p in hcells]
        seen |= grp
        run = any(all((c + i, r) in grp for i in range(RUN_MIN)) or all((c, r + i) in grp for i in range(RUN_MIN)) for c, r in grp)
        (hol if run else specks).append(frozenset(grp))
    return hol, specks


def agreement(mdl, order, crosslines, mainscheme):
    a, b = ORDER_COEF[order]
    compared = within = 0
    for (lab, cell), ds in mdl["depth"].items():
        if lab not in crosslines:
            continue
        dx = sum(ds) / len(ds)
        for main in mainscheme:
            if (main, cell) in mdl["depth"]:
                dl = sum(mdl["depth"][(main, cell)]) / len(mdl["depth"][(main, cell)])
                compared += 1
                within += abs(dx - dl) <= math.sqrt(a ** 2 + (b * (dx + dl) / 2) ** 2)
    return compared, within


def canon(v):
    if v is None or isinstance(v, bool):
        return json.dumps(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(canon(x) for x in v) + "]"
    return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(x) for k, x in v.items()) + "}"


def walk_keys(v):
    if isinstance(v, dict):
        for k, x in v.items():
            yield k
            yield from walk_keys(x)
    elif isinstance(v, list):
        for x in v:
            yield from walk_keys(x)


def test_wf_sign_in_landing(browser, app_url):
    B = app_url.rstrip("/")
    for email, home, last in ((IRA, "/fleet", "/missions"), (TAMSIN, "/launch", "/missions"),
                              (ODILE, "/surveys", f"/surveys/{CALDER}")):
        c = api(B, email)
        for target in (home, last):
            ok(c.put("/api/me/last-screen", json={"path": target}), 204)
            assert ok(fresh(B, email).post("/api/session", json={"email": email, "password": PASSWORD}))["home"] == target
            ok(c.put("/api/me/last-screen", json={"path": target}), 204)
            with open_app(browser, f"{B}/sign-in") as page:
                login_form(page, email)
                page.wait_for_url(lambda u: path_q(u) == target)
                page.reload()
                assert path_q(page.url) == target
                expect(page.get_by_role("navigation", name="Main")).to_be_visible()
                if target.startswith("/surveys/"):
                    expect(page.get_by_role("region", name="Mission header")).to_be_visible()
                elif target == "/launch":
                    expect(page.get_by_role("heading", name="Launch list", level=1)).to_be_visible()


def test_dp03_safe_return(browser, app_url):
    B = app_url.rstrip("/")
    protocol_relative = "/" * 2 + "evil.test/x"
    unsafe = [protocol_relative, "/\\evil.test", "https://evil.test/fleet", "javascript:alert(1)", "/%2F%2Fevil.test", "/api/me", "/sign-in"]
    for email, extra in ((IRA, []), (TAMSIN, ["/missions/new"]), (ODILE, ["/fleet", f"/surveys/{SALT}"])):
        for nxt in unsafe + extra:
            r = httpx.post(f"{B}/api/session", json={"email": email, "password": PASSWORD, "next": nxt}, timeout=HTTP_S)
            assert ok(r)["home"] == HOMES[email], (email, nxt)
        err(api(B, email).put("/api/me/last-screen", json={"path": protocol_relative}), 422, "validation", ("errors",))
    for email, nxt in ((IRA, "/missions/new"), (ODILE, f"/surveys/{CALDER}")):
        assert ok(httpx.post(f"{B}/api/session", json={"email": email, "password": PASSWORD, "next": nxt}, timeout=HTTP_S))["home"] == nxt
    body = err(api(B, TAMSIN).put("/api/me/last-screen", json={"path": "/missions/new"}), 422, "validation", ("errors",))
    assert body["errors"]["path"] == "Send a screen address this role may open"
    with open_app(browser, f"{B}/missions") as page:
        page.wait_for_url(lambda u: urlparse(u).path == "/sign-in")
        assert parse_qs(urlparse(page.url).query)["next"] == ["/missions"]
        login_form(page, IRA)
        page.wait_for_url(lambda u: path_q(u) == "/missions")
    with open_app(browser, f"{B}/sign-in?next={quote(protocol_relative, safe='')}") as page:
        login_form(page, ODILE)
        page.wait_for_url(lambda u: path_q(u) == "/surveys")
        assert urlparse(page.url).netloc == urlparse(B).netloc


def test_dp04_sign_in_limit():
    B = short_url()
    ghost = f"nobody-{os.urandom(4).hex()}@fathomwright.test"

    def attempt(email, password="wrong-password"):
        return httpx.post(f"{B}/api/session", json={"email": email, "password": password}, timeout=HTTP_S)

    for _ in range(LOCK_AFTER + 2):
        err(httpx.post(f"{B}/api/session", json={"email": ghost, "password": ""}, timeout=HTTP_S), 401, "invalid_credentials")
    rs = parallel([lambda: attempt(ghost)] * RACE_ATTEMPTS)
    assert sorted(r.status_code for r in rs) == [401] * LOCK_AFTER + [429] * (RACE_ATTEMPTS - LOCK_AFTER)
    unknown_401 = next(r.json() for r in rs if r.status_code == 401)
    locked = err(next(r for r in rs if r.status_code == 429), 429, "too_many_attempts", ("retry_at",))
    assert iso(parse(locked["retry_at"])) == locked["retry_at"]
    assert locked["message"] == say(T_LOCKED, {"<HH:MM>": locked["retry_at"][11:16]})
    assert int(next(r for r in rs if r.status_code == 429).headers["Retry-After"]) >= 1

    variants = [WREN, f"  {WREN.upper()} ", WREN, WREN.title(), WREN]
    real = [attempt(v) for v in variants]
    assert [r.status_code for r in real] == [401] * LOCK_AFTER
    assert real[0].json() == unknown_401
    lock = attempt(WREN, PASSWORD)
    body = err(lock, 429, "too_many_attempts", ("retry_at",))
    retry_at = parse(body["retry_at"])
    poll(lambda: attempt(WREN, PASSWORD).status_code == 200, (retry_at - parsedate_to_datetime(lock.headers["date"]) if "date" in lock.headers else timedelta(minutes=1)).total_seconds() + SLACK_S + 60, "unlock after one window")


def test_dp02_sessions_and_permissions(app_url):
    B = app_url.rstrip("/")
    c = httpx.Client(base_url=B, timeout=HTTP_S)
    r = c.post("/api/session", json={"email": TAMSIN, "password": PASSWORD})
    body = ok(r)
    assert c.cookies, "sign-in sets a session cookie"
    assert set(body["user"]) == {"id", "name", "email", "role", "client_org_id", "units"}
    me = ok(c.get("/api/me"))
    assert (me["role"], me["client_org_id"], me["name"]) == ("launch_technician", None, NAMES[TAMSIN])
    assert err(c.patch("/api/me", json={"units": "furlongs"}), 422, "validation", ("errors",))["errors"]["units"] == "Choose metric or imperial"
    ok(c.post("/api/session/refresh", json={}), 204)
    assert set(ok(c.get("/api/status"))) == {"storage", "mail"}
    plan = {"survey_area": pts(AREA), "planned_depth_m": 5}
    O, T, P = api(B, ODILE), api(B, TAMSIN), api(B, IRA)
    vid = "v-gannet"
    forbidden = [
        (O, "GET", "/api/vessels", None), (O, "GET", "/api/alerts", None), (O, "GET", "/api/client-orgs", None),
        (O, "GET", vpath(vid, "/fixes"), None), (O, "POST", "/api/plan-preview", plan),
        (O, "POST", vpath(vid, "/afloat"), {}), (O, "POST", vpath(vid, "/services"), {"note": "x"}),
        (T, "POST", "/api/plan-preview", plan), (T, "POST", f"/api/missions/{CALDER}/transitions", {"to": "Launched"}),
        (T, "PATCH", vpath(vid), {"service_interval_h": 300, "version": 1}),
        (P, "POST", vpath(vid, "/afloat"), {}), (P, "POST", f"/api/missions/{CALDER}/transitions", {"to": "Complete"}),
    ]
    for client, method, path, json_body in forbidden:
        resp = client.request(method, path, json=json_body)
        err(resp, 403, "forbidden")
    assert get_mission(B, CALDER)["status"] == "Planned"
    assert all(m["client_org_id"] == "org-calderhaven" for m in ok(O.get("/api/missions")))
    ok(O.get("/api/status"))
    err(httpx.get(f"{B}/api/me", timeout=HTTP_S), 401, "unauthenticated")
    ok(c.delete("/api/session"), 204)
    err(c.get("/api/me"), 401, "unauthenticated")


def test_dp05_shared_device(browser, app_url):
    B = app_url.rstrip("/")
    o, b = fresh(B, ODILE), fresh(B, BRAM)
    calls = [(o, "/api/me", ODILE), (b, "/api/me", BRAM), (o, "/api/missions", "org-calderhaven"), (b, "/api/missions", "org-saltmere")] * 10
    for (client, path, owner), r in zip(calls, parallel([lambda c=c, p=p: c.get(p) for c, p, _ in calls])):
        data = ok(r)
        if path == "/api/me":
            assert data["email"] == owner
        else:
            assert data and all(m["client_org_id"] == owner for m in data)
    ok(o.delete("/api/session"), 204)
    err(o.get("/api/missions"), 401, "unauthenticated")
    ok(b.get("/api/me"))

    with screen(browser, B, ODILE, "/surveys") as page:
        expect(page.get_by_role("link", name="Calderhaven North Basin")).to_be_visible()
        with held(page, SURVEY_LIST_GLOB) as h:
            page.goto(f"{B}/surveys")
            page.get_by_role("button", name="Sign out").click()
            page.wait_for_url(lambda u: urlparse(u).path == "/sign-in")
            login_form(page, BRAM)
            h.release()
        page.wait_for_url(lambda u: urlparse(u).path.startswith("/surveys"))
        expect(page.get_by_role("link", name="Saltmere Approach Channel")).to_be_visible()
        for _ in range(3):
            body = page.inner_text("body")
            assert "Calderhaven North Basin" not in body and NAMES[ODILE] not in body
            page.go_back()


def test_dp06_idle_sign_out(browser, app_url):
    B = app_url.rstrip("/")
    with screen(browser, B, TAMSIN, "/missions") as page:
        refreshes = []
        page.on("request", lambda r: refreshes.append(r) if r.url.endswith("/api/session/refresh") else None)
        dlg, status = page.get_by_role("dialog", name="Session ending"), page.get_by_role("status", name="Session status")
        advance(page, IDLE_MS - SECOND_MS)
        expect(dlg).to_have_count(0)
        advance(page, 2 * SECOND_MS)
        expect(dlg).to_be_visible()
        focus_on(dlg.get_by_role("button", name="Stay signed in"))
        expect(status).to_have_text(say(T_COUNTDOWN, {"<m:ss>": "2:00"}))
        advance(page, MINUTE_MS)
        expect(status).to_have_text(say(T_COUNTDOWN, {"<m:ss>": "1:00"}))
        page.keyboard.press("Escape")
        gone(page, dlg)
        poll(lambda: page.evaluate("0") == 0 and refreshes, WAIT_S, "session refresh")
        advance(page, IDLE_MS + SECOND_MS)
        expect(dlg).to_be_visible()
        advance(page, COUNTDOWN_MS - TEN_S_MS - SECOND_MS)
        expect(status).to_have_text(say(T_COUNTDOWN, {"<m:ss>": "0:10"}))
        advance(page, TEN_S_MS + 2 * SECOND_MS)
        page.wait_for_url(lambda u: urlparse(u).path == "/sign-in")
        assert parse_qs(urlparse(page.url).query)["next"] == ["/missions"]
        expect(page.get_by_role("alert")).to_contain_text("You were signed out after 30 minutes without activity.")
        assert page.request.get(f"{B}/api/me").status == 401


def test_wf_mission_planning_keyboard(browser, app_url):
    B = app_url.rstrip("/")
    name = mname()
    with screen(browser, B, IRA, "/missions/new") as page:
        form = page.get_by_role("form", name="New mission")
        form.get_by_role("textbox", name="Mission name").focus()
        page.keyboard.type(name)
        pick(form.get_by_role("combobox", name="Client"), "Port of Calderhaven Authority")
        form.get_by_role("textbox", name="Survey date").focus()
        page.keyboard.type(SURVEY_DATE)
        for field, shape, idx in (("Survey area vertices", AREA, 0), ("Geofence corners", FENCE, 1)):
            form.get_by_role("textbox", name=field).focus()
            for i, (e, n) in enumerate(shape):
                if i:
                    page.keyboard.press("Enter")
                page.keyboard.type(f"{e}, {n}")
            help_btn = form.get_by_role("button", name="Vertex format help").nth(idx)
            help_btn.focus()
            page.keyboard.press("Enter")
            pop = page.get_by_role("dialog", name="Vertex format")
            expect(pop).to_contain_text(say(T_HELP, {"<unit>": "metres"}))
            assert inside_viewport(page, pop)
            page.keyboard.press("Escape")
            gone(page, pop)
            focus_on(help_btn)
        for field, value in (("Planned depth", "5"), ("Swath ratio", "4"), ("Overlap", "0"), ("Line azimuth", "0"), ("Planned speed", "2")):
            form.get_by_role("spinbutton", name=field).focus()
            page.keyboard.press(SELECT_ALL)
            page.keyboard.type(value)
        pick(form.get_by_role("combobox", name="Survey order"), "Special Order")
        see(page, preview_copy(plan(AREA, 5, overlap=0)))
        form.get_by_role("textbox", name="Geofence corners").focus()
        page.keyboard.press(CTRL_ENTER)
        page.wait_for_url(lambda u: urlparse(u).path.split("/")[1::2] == ["missions", "plan"])
        mid = urlparse(page.url).path.split("/")[2]
        page.reload()
        expect(page.get_by_role("heading", name=name)).to_be_visible()
        table = page.get_by_role("table", name="Line plan")
        for lab in ("L01", "L02", "L03", "X01"):
            expect(table.get_by_role("combobox", name=f"Vessel for {lab}")).to_be_visible()
    m = get_mission(B, mid)
    assert (m["name"], m["survey_order"], m["line_count"], m["crossline_count"]) == (name, "special", 3, 1)
    assert m["survey_area"] == pts(AREA) and m["geofence"] == pts(FENCE)


def test_dp08_line_plan_derivation(app_url):
    B = app_url.rstrip("/")
    P = api(B, IRA)
    cal = get_mission(B, CALDER)
    assert (cal["swath_width_m"], cal["line_spacing_m"], cal["line_count"], cal["crossline_count"], cal["estimated_duration_s"]) == (40, 32, 13, 1, 2930)
    cl = get_lines(B, CALDER)
    assert all(abs(cl[f"L{i:02d}"]["length_m"] - 300) < 1e-6 for i in range(1, 14))
    assert cl["X01"]["start"] == {"easting": 5000, "northing": 8150} and cl["X01"]["end"] == {"easting": 5400, "northing": 8150}
    assert cal["counters"]["lines_remaining"] == 14
    sal, sl = get_mission(B, SALT), get_lines(B, SALT)
    assert (sal["swath_width_m"], sal["line_spacing_m"], sal["line_count"], sal["estimated_duration_s"], sal["survey_order"]) == (24, 18, 7, 3440, "1a")
    for lab, north in (("X01", 2200), ("X02", 2400)):
        assert sl[lab]["start"] == {"easting": 1000, "northing": north} and sl[lab]["end"] == {"easting": 1120, "northing": north}
        assert sl[lab]["kind"] == "crossline" and abs(sl[lab]["length_m"] - 120) < 1e-6

    body = {"survey_area": pts(AREA), "planned_depth_m": 5}
    prev = ok(P.post("/api/plan-preview", json=body))
    want = plan(AREA, 5)
    same_plan(prev, want)
    m = ok(P.post("/api/missions", json={"name": mname(), "client_org_id": "org-calderhaven", "survey_date": SURVEY_DATE,
                                         "survey_area": pts(AREA), "geofence": pts(FENCE), "planned_depth_m": 5}), 201)
    same_plan(m, want)
    assert m["survey_order"] == "1a"
    same_lines(get_lines(B, m["id"]), want)

    want90 = plan(AREA, 5, overlap=20, azimuth=90)
    m90 = create(B, planned_depth_m=5, overlap_pct=20, line_azimuth_deg=90)
    same_plan(m90, want90)
    same_lines(get_lines(B, m90["id"]), want90)
    same_plan(ok(P.post("/api/plan-preview", json={"survey_area": pts(AREA), "planned_depth_m": 5, "overlap_pct": 20, "line_azimuth_deg": 90,
                                                    "swath_ratio": 4, "planned_speed_mps": 2})), want90)


def test_dp09_preview_latest_input(browser, app_url):
    B = app_url.rstrip("/")
    q = "/missions/new?" + urlencode({"depth": 10, "ratio": 4, "overlap": 20, "azimuth": 0, "speed": 2, "order": "special"})
    with screen(browser, B, IRA, q) as page:
        preview = page.get_by_role("status", name="Plan preview")
        expect(page.get_by_role("spinbutton", name="Planned depth")).to_have_value("10")
        area = page.get_by_role("textbox", name="Survey area vertices")
        area.fill("\n".join(f"{e}, {n}" for e, n in AREA))
        page.get_by_role("textbox", name="Geofence corners").fill("\n".join(f"{e}, {n}" for e, n in FENCE))
        see(page, preview_copy(plan(AREA, 10)))
        history = page.evaluate("history.length")
        pending = []
        page.route(PREVIEW_GLOB, lambda route: pending.append(route))
        depth = page.get_by_role("spinbutton", name="Planned depth")
        for value in ("5", "20"):
            with page.expect_request(PREVIEW_GLOB):
                depth.fill(value)
                advance(page, 1000)
            page.evaluate("0")
        assert len(pending) >= 2
        pending[-1].continue_()
        latest = preview_copy(plan(AREA, 20))
        see(page, latest)
        for route in pending[:-1]:
            release(route)
        advance(page, 1000)
        expect(preview).to_have_text(latest)
        assert parse_qs(urlparse(page.url).query)["depth"] == ["20"]
        assert page.evaluate("history.length") == history
        page.unroute(PREVIEW_GLOB)
        late = []
        page.route(PREVIEW_GLOB, lambda route: late.append(route))
        with page.expect_request(PREVIEW_GLOB):
            depth.fill("6")
            advance(page, 1000)
        depth.fill("0")
        advance(page, 1000)
        page.evaluate("0")
        for route in late:
            release(route)
        advance(page, 1000)
        expect(preview).to_have_text("Fix the highlighted fields to see the plan")
        page.unroute(PREVIEW_GLOB)
        page.goto(f"{B}/missions/new?" + urlencode({"depth": 0, "ratio": 4, "overlap": 20, "azimuth": 0, "speed": 2, "order": "special"}))
        expect(page.get_by_role("spinbutton", name="Planned depth")).to_have_value("0")
        expect(page.get_by_text("Planned depth must be between 1 and 200 m")).to_be_visible()
        expect(preview).to_have_text("Fix the highlighted fields to see the plan")


def test_dp10_planner_validation(browser, app_url):
    B = app_url.rstrip("/")
    P = api(B, IRA)
    cases = {
        "name": ({"name": ""}, "Enter a mission name of up to 80 characters"),
        "survey_date": ({"survey_date": "2026-02-30"}, "Enter the survey date as YYYY-MM-DD"),
        "survey_area": ({"survey_area": pts(AREA[:2])}, "Enter 3 to 40 survey-area vertices as easting, northing"),
        "convex": ({"survey_area": pts([(0, 0), (60, 0), (30, 10), (60, 40), (0, 40)])}, "The survey area must be a convex shape"),
        "big": ({"survey_area": pts([(0, 0), (2001, 0), (2001, 2001), (0, 2001)]), "geofence": pts([(-1, -1), (2002, -1), (2002, 2002), (-1, 2002)])}, "The survey area must be at most 4,000,000 m²"),
        "geofence": ({"geofence": pts([(0, 0), (10, 0), (10, 10)])}, "The geofence must enclose the survey area"),
        "planned_depth_m": ({"planned_depth_m": 0}, "Planned depth must be between 1 and 200 m"),
        "swath_ratio": ({"swath_ratio": 9}, "Swath ratio must be between 1 and 8"),
        "overlap_pct": ({"overlap_pct": 51}, "Overlap must be between 0 and 50 %"),
        "line_azimuth_deg": ({"line_azimuth_deg": 180}, "Line azimuth must be at least 0° and below 180°"),
        "planned_speed_mps": ({"planned_speed_mps": 4.5}, "Planned speed must be between 0.5 and 4 m/s"),
        "survey_order": ({"survey_order": "2"}, "Choose Special Order or Order 1a"),
    }
    made = []
    for key, (patch, message) in cases.items():
        name = mname()
        made.append(name)
        body = {"name": name, "client_org_id": "org-calderhaven", "survey_date": SURVEY_DATE, "survey_area": pts(AREA),
                "geofence": pts(FENCE), "planned_depth_m": 5, **patch}
        field = {"convex": "survey_area", "big": "survey_area"}.get(key, key)
        assert err(P.post("/api/missions", json=body), 422, "validation", ("errors",))["errors"][field] == message
    assert err(P.post("/api/plan-preview", json={"survey_area": pts(AREA), "planned_depth_m": 0}), 422, "validation", ("errors",))["errors"]["planned_depth_m"] == "Planned depth must be between 1 and 200 m"
    names = {m["name"] for m in ok(P.get("/api/missions"))}
    assert not names & set(made)
    with screen(browser, B, IRA, "/missions/new") as page:
        page.get_by_role("textbox", name="Mission name").fill(mname())
        pick(page.get_by_role("combobox", name="Client"), "Port of Calderhaven Authority")
        page.get_by_role("spinbutton", name="Planned depth").fill("0")
        page.get_by_role("button", name="Create mission").click()
        summary = page.get_by_role("alert").filter(has_text="Fix these before creating the mission")
        focus_on(summary)
        summary.get_by_role("link", name="Planned depth must be between 1 and 200 m").click()
        focus_on(page.get_by_role("spinbutton", name="Planned depth"))
        assert urlparse(page.url).path == "/missions/new"


def test_dp11_idempotent_mission_creation(app_url):
    B = app_url.rstrip("/")
    P = api(B, IRA)
    name, key = mname(), idempotency_key()
    body = {"name": name, "client_org_id": "org-calderhaven", "survey_date": SURVEY_DATE, "survey_area": pts(AREA),
            "geofence": pts(FENCE), "planned_depth_m": 5}
    first = ok(P.post("/api/missions", json=body, headers={"Idempotency-Key": key}), 201)
    again = ok(P.post("/api/missions", json=body, headers={"Idempotency-Key": key}), 201)
    assert again["id"] == first["id"]
    err(P.post("/api/missions", json={**body, "name": name + " B"}, headers={"Idempotency-Key": key}), 409, "idempotency_conflict")
    name2, key2 = mname(), idempotency_key()
    rs = parallel([lambda: P.post("/api/missions", json={**body, "name": name2}, headers={"Idempotency-Key": key2})] * 6)
    assert {r.status_code for r in rs} == {201} and len({r.json()["id"] for r in rs}) == 1
    names = [m["name"] for m in ok(P.get("/api/missions"))]
    assert names.count(name) == 1 and names.count(name2) == 1 and (name + " B") not in names


def test_wf_fleet_readiness_assign(browser, app_url):
    B = app_url.rstrip("/")
    free(B, "v-shearwater", "v-kittiwake")
    set_interval(B, "v-shearwater", INTERVAL_MIN)
    m = create(B)
    with screen(browser, B, IRA, f"/missions/{m['id']}/plan", size=(375, 812)) as page:
        for lab in ("L01", "L02", "L03", "X01"):
            pick(page.get_by_role("combobox", name=f"Vessel for {lab}"), "Shearwater" if lab == "L01" else "Kittiwake")
        page.get_by_role("button", name="Save assignments").click()
        expect(page.get_by_role("status", name="Plan status")).to_have_text(overdue_msg(vessel(B, "v-shearwater")))
        assert all(l["status"] == "Pending" and l["vessel_id"] is None for l in get_lines(B, m["id"]).values())
        set_interval(B, "v-shearwater", INTERVAL_MAX)
        page.get_by_role("button", name="Save assignments").click()
        expect(page.get_by_role("status", name="Plan status")).to_have_text("Assignments saved")
    ls = get_lines(B, m["id"])
    assert ls["L01"]["vessel_id"] == "v-shearwater" and all(ls[l]["vessel_id"] == "v-kittiwake" for l in ("L02", "L03", "X01"))
    assert all(l["status"] == "Assigned" for l in ls.values())


def test_wf_fleet_readiness_service_retry(browser, app_url):
    B = app_url.rstrip("/")
    vid = "v-gannet"
    G = {"<vessel>": VNAME[vid]}
    free(B, vid)
    T = api(B, TAMSIN)
    services = vpath(vid, "/services")
    before = len(ok(T.get(services)))
    note = "Port thruster seals replaced"
    with screen(browser, B, TAMSIN, "/launch", size=(375, 812)) as page:
        keys, dropped = [], []

        def flaky(route):
            if route.request.method != "POST":
                return route.continue_()
            keys.append(route.request.headers.get("Idempotency-Key".lower()))
            if not dropped:
                dropped.append(route.fetch())
                return route.abort()
            route.continue_()

        page.route(route_of(services), flaky)
        opener = page.get_by_role("region", name="Fleet service").get_by_role("button", name=say(T_LOG_SERVICE_BTN, G))
        opener.click()
        dlg = page.get_by_role("dialog", name="Log thruster service")
        dlg.get_by_role("textbox", name="Service note").fill(note)
        dlg.get_by_role("button", name="Save service").click()
        expect(page.get_by_role("status", name="Launch status")).to_have_text(say(T_NO_REACH_SERVICE, G))
        expect(dlg.get_by_role("textbox", name="Service note")).to_have_value(note)
        dlg.get_by_role("button", name="Save service").click()
        expect(dlg).to_have_count(0)
        expect(page.get_by_role("status", name="Launch status")).to_have_text(say(T_SERVICE_LOGGED, G))
    assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
    assert len(ok(T.get(services))) == before + 1
    assert vessel(B, vid)["hours_since_service"] == 0

    key = idempotency_key()
    hull, other, burst = "Hull check", "Other note", "Burst"
    first = ok(T.post(services, json={"note": hull}, headers={"Idempotency-Key": key}), 201)
    assert ok(T.post(services, json={"note": hull}, headers={"Idempotency-Key": key}), 201) == first
    err(T.post(services, json={"note": other}, headers={"Idempotency-Key": key}), 409, "idempotency_conflict")
    key2 = idempotency_key()
    rs = parallel([lambda: T.post(services, json={"note": burst}, headers={"Idempotency-Key": key2})] * 5)
    assert {r.status_code for r in rs} == {201} and len({r.json()["id"] for r in rs}) == 1
    for bad in ("", "x" * (NOTE_MAX + 1)):
        assert err(T.post(services, json={"note": bad}), 422, "validation", ("errors",))["errors"]["note"] == "Enter a service note of up to 500 characters"
    assert len(ok(T.get(services))) == before + 3
    ok(T.post(vpath(vid, "/afloat"), json={}))
    b = err(T.post(services, json={"note": hull}), 409, "vessel_afloat")
    assert b["message"] == say(T_AFLOAT_SERVICE, G)
    ok(T.post(vpath(vid, "/recovered"), json={}))
    assert len(ok(T.get(services))) == before + 3


def test_dp13_vessel_pickers_reachable(browser, app_url):
    B = app_url.rstrip("/")
    m = create(B, area=[(5000, 8000), (5400, 8000), (5400, 8300), (5000, 8300)], fence=[(4950, 7950), (5450, 7950), (5450, 8350), (4950, 8350)],
               planned_depth_m=10, overlap_pct=20)
    current = get_lines(B, m["id"])
    last_label = list(current)[-1]
    last_main = [lab for lab, l in current.items() if l["kind"] == "planned"][-1]
    for size in ((375, 812), (768, 1024)):
        with screen(browser, B, IRA, f"/missions/{m['id']}/plan", size=size) as page:
            last = page.get_by_role("combobox", name=say(T_VESSEL_FOR, {"<line>": last_label}))
            last.scroll_into_view_if_needed()
            tap(last)
            box = page.get_by_role("listbox")
            expect(box).to_be_visible()
            assert inside_viewport(page, box)
            options = box.get_by_role("option")
            expect(options).to_have_text(["Unassigned", "Kittiwake", "Petrel", "Shearwater", "Gannet"])
            for i in range(options.count()):
                assert inside_viewport(page, options.nth(i)) and hit(options.nth(i))
            tap(options.filter(has_text="Gannet"))
            expect(page.get_by_role("listbox")).to_have_count(0)
            poll(lambda: "Gannet" in shown_value(last), WAIT_S, "last row picks Gannet")
            row = page.get_by_role("combobox", name=say(T_VESSEL_FOR, {"<line>": last_main}))
            row.focus()
            page.keyboard.press("Alt+ArrowDown")
            expect(page.get_by_role("listbox")).to_be_visible()
            page.keyboard.press("Escape")
            gone(page, page.get_by_role("listbox"))
            assert "Unassigned" in shown_value(row)
            page.keyboard.press("Alt+ArrowDown")
            page.keyboard.press("ArrowDown")
            page.keyboard.press("ArrowDown")
            page.keyboard.press("Enter")
            expect(page.get_by_role("listbox")).to_have_count(0)
            poll(lambda: any(v in shown_value(row) for v in ("Kittiwake", "Petrel")), WAIT_S, "keyboard picks a vessel")


def test_dp14_overdue_block(app_url):
    B = app_url.rstrip("/")
    free(B, "v-petrel")
    T = api(B, TAMSIN)
    m = create(B)
    ls = get_lines(B, m["id"])
    set_interval(B, "v-petrel", INTERVAL_MIN)
    v = vessel(B, "v-petrel")
    assert v["service_overdue"] is True
    assert err(assign(B, m["id"], {ls["L01"]["id"]: "v-petrel"}), 409, "service_overdue")["message"] == overdue_msg(v)
    assert err(T.post(vpath("v-petrel", "/afloat"), json={}), 409, "service_overdue")["message"] == overdue_msg(v)
    assert vessel(B, "v-petrel")["afloat"] is False and get_lines(B, m["id"])["L01"]["status"] == "Pending"
    h = v["hours_since_service"]
    if INTERVAL_MIN <= h <= INTERVAL_MAX and Decimal(str(h)) == r1(h):
        set_interval(B, "v-petrel", h)
        assert vessel(B, "v-petrel")["service_overdue"] is False
    set_interval(B, "v-petrel", INTERVAL_MAX)
    ok(assign(B, m["id"], {l["id"]: "v-petrel" for l in ls.values()}))
    ok(T.post(vpath("v-petrel", "/afloat"), json={}))
    set_interval(B, "v-petrel", INTERVAL_MIN)
    assert err(transition(B, m["id"], "Launched"), 409, "service_overdue")["message"] == overdue_msg(vessel(B, "v-petrel"))
    assert get_mission(B, m["id"])["status"] == "Planned"
    set_interval(B, "v-petrel", INTERVAL_MAX)
    ok(transition(B, m["id"], "Launched"))
    set_interval(B, "v-petrel", INTERVAL_MIN)
    err(line_cmd(B, "v-petrel", ls["L01"]["id"], "start"), 409, "service_overdue")
    assert get_lines(B, m["id"])["L01"]["status"] == "Assigned"
    free(B, "v-petrel")


def test_dp15_thruster_hours(app_url):
    B = app_url.rstrip("/")
    m, ls = launched(B, "v-kittiwake")
    v0 = vessel(B, "v-kittiwake")
    t = next_t(B, "v-kittiwake")
    steps = [(0, 2.0, 0.0), (30, 2.0, 0.0)]
    for dt, speed, heading in steps:
        ok(ingest(B, "v-kittiwake", fx(t + timedelta(seconds=dt), 10.0, 1.0, heading=heading, speed=speed)), 201)
    ok(line_cmd(B, "v-kittiwake", ls["L01"]["id"], "start"))
    clock, counted = t + timedelta(seconds=30), 0
    for dt, speed, heading, counts in ((30, 2.0, 0.0, True), (30, 0.3, 0.0, False), (90, 2.0, 0.0, False),
                                       (60, 5.0, 0.0, True), (20, 2.0, 90.0, True)):
        clock += timedelta(seconds=dt)
        ok(ingest(B, "v-kittiwake", fx(clock, 10.0, 5.0, heading=heading, speed=speed)), 201)
        counted += dt if counts else 0
    ok(line_cmd(B, "v-kittiwake", ls["L01"]["id"], "end"))
    ok(ingest(B, "v-kittiwake", fx(clock + timedelta(seconds=30), 10.0, 6.0)), 201)
    v1 = vessel(B, "v-kittiwake")
    for k in ("thruster_hours_total", "hours_since_service"):
        assert abs((v1[k] - v0[k]) - counted / HOUR_S) <= 2 * HOURS_ROUND, (k, v1[k] - v0[k], counted)
    free(B, "v-kittiwake")


def test_dp17_vessel_committed_race(app_url):
    B = app_url.rstrip("/")
    free(B, "v-gannet")
    ms = [create(B) for _ in range(3)]
    firsts = [get_lines(B, m["id"])["L01"]["id"] for m in ms]
    rs = parallel([lambda m=m, l=l: assign(B, m["id"], {l: "v-gannet"}) for m, l in zip(ms, firsts)])
    codes = [r.status_code for r in rs]
    assert codes.count(200) == 1 and codes.count(409) == 2
    winner = ms[codes.index(200)]
    for m, r in zip(ms, rs):
        if r.status_code == 409:
            assert err(r, 409, "vessel_committed")["message"] == say(T_COMMITTED, {"<vessel>": "Gannet", "<mission>": winner["name"]})
            assert get_lines(B, m["id"])["L01"]["status"] == "Pending"
    assert vessel(B, "v-gannet")["mission_id"] == winner["id"]
    free(B, "v-gannet")


def test_dp18_service_interval(browser, app_url):
    B = app_url.rstrip("/")
    vid = "v-kittiwake"
    K = {"<vessel>": VNAME[vid]}
    free(B, vid)
    P = api(B, IRA)
    path = vpath(vid)
    v = vessel(B, vid)
    for bad in (INTERVAL_MIN - 1, INTERVAL_MAX + 0.5, 100.25):
        assert err(P.patch(path, json={"service_interval_h": bad, "version": v["version"]}), 422, "validation", ("errors",))["errors"]["service_interval_h"] == "Service interval must be between 50 and 1000 h"
    for bad in ({"service_interval_h": 300}, {"service_interval_h": 300, "version": "1"}):
        assert err(P.patch(path, json=bad), 422, "validation", ("errors",))["errors"]["version"] == "Send the vessel version you last read"
    v2 = ok(P.patch(path, json={"service_interval_h": 300, "version": v["version"]}))
    assert v2["version"] == v["version"] + 1 and v2["service_interval_h"] == 300
    stale = err(P.patch(path, json={"service_interval_h": 250, "version": v["version"]}), 409, "stale_version", ("current",))
    assert stale["current"]["version"] == v2["version"] and stale["current"]["service_interval_h"] == 300
    hours = v2["hours_since_service"]
    low = max(INTERVAL_MIN, math.floor(hours) - 1)
    if hours > low:
        set_interval(B, vid, low)
        assert vessel(B, vid)["service_overdue"] is True
    set_interval(B, vid, INTERVAL_MAX)
    assert vessel(B, vid)["service_overdue"] is False

    typed, theirs = 400, 450
    with screen(browser, B, IRA, f"/fleet/{vid}") as page:
        field = page.get_by_role("spinbutton", name="Service interval")
        field.fill(str(typed))
        set_interval(B, vid, theirs)
        page.get_by_role("button", name="Save interval").click()
        heard(page, say(T_STALE, K))
        expect(page.get_by_text(say(T_CURRENT, {"<interval>": theirs}))).to_be_visible()
        expect(field).to_have_value(str(typed))
        field.press("Enter")
        heard(page, say(T_INTERVAL_SAVED, K))
    assert vessel(B, vid)["service_interval_h"] == typed
    set_interval(B, vid, INTERVAL_MAX)


def test_wf_slipway_launch(browser, app_url):
    B = app_url.rstrip("/")
    m, _ = launched(B, "v-kittiwake", {"L03": "v-gannet", "X01": "v-gannet"}, launch=False)
    for vid in ("v-kittiwake", "v-gannet"):
        ok(api(B, TAMSIN).post(f"/api/vessels/{vid}/recovered", json={}))
    with screen(browser, B, TAMSIN, "/launch", size=(375, 812)) as tech:
        section = tech.get_by_role("region", name=m["name"])
        for vid in ("v-kittiwake", "v-gannet"):
            tap(section.get_by_role("button", name=say(T_MARK_AFLOAT_BTN, {"<vessel>": VNAME[vid]})))
            expect(tech.get_by_role("status", name="Launch status")).to_have_text(say(T_IS_AFLOAT, {"<vessel>": VNAME[vid]}))
        assert all(vessel(B, v)["afloat"] for v in ("v-kittiwake", "v-gannet"))
        layout(tech)
        with screen(browser, B, IRA, f"/missions/{m['id']}/plan") as boss:
            boss.get_by_role("button", name="Launch mission").click()
            expect(boss.get_by_role("status", name="Plan status")).to_have_text("Mission launched")
        assert get_mission(B, m["id"])["status"] == "Launched"
        until(tech, HAS, "Launched", WAIT_S)
        expect(section).to_contain_text("Launched")
    with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
        expect(page.get_by_role("region", name="Mission header")).to_contain_text("Launched")
    free(B, "v-kittiwake", "v-gannet")


def test_dp20_mission_state_machine(app_url):
    B = app_url.rstrip("/")
    free(B, "v-kittiwake")
    m = create(B)
    b = err(transition(B, m["id"], "Complete", TAMSIN), 409, "illegal_transition", ("from", "to"))
    assert (b["from"], b["to"], b["message"]) == ("Planned", "Complete", say(T_ILLEGAL, {"<from>": "Planned", "<to>": "Complete"}))
    for to in ("Surveying", "Recovering", "Planned"):
        err(transition(B, m["id"], to), 409, "illegal_transition", ("from", "to"))
    err(transition(B, m["id"], "Floating"), 422)
    assert err(transition(B, m["id"], "Launched"), 409, "lines_unassigned")["message"] == "Assign every line and crossline before launching"
    ok(assign(B, m["id"], {l["id"]: "v-kittiwake" for l in get_lines(B, m["id"]).values()}))
    assert err(transition(B, m["id"], "Launched"), 409, "vessels_not_afloat")["message"] == say(T_NOT_AFLOAT, {"<vessels>": "Kittiwake"})
    err(transition(B, m["id"], "Launched", TAMSIN), 403, "forbidden")
    ok(api(B, TAMSIN).post(vpath("v-kittiwake", "/afloat"), json={}))
    rs = parallel([lambda: transition(B, m["id"], "Launched")] * 6)
    assert [r.status_code for r in rs].count(200) == 1
    for r in rs:
        if r.status_code != 200:
            err(r, 409, "illegal_transition", ("from", "to"))
    err(transition(B, m["id"], "Aborted", TAMSIN), 403, "forbidden")
    ok(transition(B, m["id"], "Aborted"))
    for to in ("Aborted", "Launched", "Complete"):
        assert err(transition(B, m["id"], to, TAMSIN if to == "Complete" else IRA), 409, "illegal_transition", ("from", "to"))["from"] == "Aborted"
    assert get_mission(B, m["id"])["status"] == "Aborted"

    r, ls = recovering(B, "v-kittiwake")
    err(transition(B, r["id"], "Complete"), 403, "forbidden")
    err(transition(B, r["id"], "Complete", TAMSIN), 409, "lines_awaiting_upload")
    for l in ls.values():
        ok(upload(api(B, TAMSIN), l, payload(l["label"])), 201)
    assert err(transition(B, r["id"], "Complete", TAMSIN), 409, "vessels_afloat")["message"] == say(T_RECOVER_ALL, {"<vessels>": "Kittiwake"})
    assert get_mission(B, r["id"])["status"] == "Recovering"
    free(B, "v-kittiwake")


def test_dp21_line_state_machine(app_url):
    B = app_url.rstrip("/")
    m, ls = launched(B, "v-gannet", area=TINY)
    l01, x01 = ls["L01"], ls["X01"]
    b = err(line_cmd(B, "v-gannet", l01["id"], "end"), 409, "illegal_transition", ("from", "to"))
    assert (b["from"], b["to"], b["message"]) == ("Assigned", "Surveyed", say(T_LINE_MOVE, {"<line>": "L01", "<from>": "Assigned", "<to>": "Surveyed"}))
    free(B, "v-kittiwake")
    err(line_cmd(B, "v-kittiwake", l01["id"], "start"), 404, "not_found")
    assert ok(line_cmd(B, "v-gannet", l01["id"], "start"))["line"]["status"] == "Running"
    assert get_mission(B, m["id"])["status"] == "Surveying"
    err(line_cmd(B, "v-gannet", x01["id"], "start"), 409, "vessel_busy")
    b = err(assign(B, m["id"], {l01["id"]: "v-gannet"}), 409, "illegal_transition", ("from", "to"))
    assert (b["from"], b["to"], b["message"]) == ("Running", "Assigned", "Only pending or assigned lines can be reassigned")
    assert ok(assign(B, m["id"], {x01["id"]: None}))[0]["status"] == "Pending"
    ok(assign(B, m["id"], {x01["id"]: "v-gannet"}))
    line = ok(line_cmd(B, "v-gannet", l01["id"], "end"))["line"]
    assert line["status"] == "Surveyed" and line["file"]["state"] == "Awaiting upload"
    b = err(line_cmd(B, "v-gannet", l01["id"], "start"), 409, "illegal_transition", ("from", "to"))
    assert (b["from"], b["to"], b["message"]) == ("Surveyed", "Running", say(T_LINE_MOVE, {"<line>": "L01", "<from>": "Surveyed", "<to>": "Running"}))
    assert ok(upload(api(B, TAMSIN), l01, payload("L01")), 201)["status"] == "Delivered"
    assert get_mission(B, m["id"])["status"] == "Surveying"
    survey(B, "v-gannet", get_lines(B, m["id"])["X01"])
    assert get_mission(B, m["id"])["status"] == "Recovering"
    free(B, "v-gannet")


def test_dp22_afloat_only_when_confirmed(browser, app_url):
    B = app_url.rstrip("/")
    m, _ = launched(B, "v-kittiwake", {"L03": "v-petrel", "X01": "v-petrel"}, launch=False)
    for vid in ("v-kittiwake", "v-petrel"):
        ok(api(B, TAMSIN).post(vpath(vid, "/recovered"), json={}))
    set_interval(B, "v-petrel", INTERVAL_MIN)
    K, Pt = {"<vessel>": "Kittiwake"}, {"<vessel>": "Petrel"}
    afloat_glob, recovered_glob = route_of(vpath("v-kittiwake", "/afloat")), route_of(vpath("v-kittiwake", "/recovered"))
    with screen(browser, B, TAMSIN, "/launch", size=(375, 812)) as page:
        section, status = page.get_by_role("region", name=m["name"]), page.get_by_role("status", name="Launch status")
        expect(section).to_contain_text("Ashore")
        page.route(afloat_glob, lambda route: route.abort())
        tap(section.get_by_role("button", name=say(T_MARK_AFLOAT_BTN, K)))
        expect(status).to_have_text(say(T_NO_REACH_ASHORE, K))
        expect(section).not_to_contain_text("Afloat")
        page.unroute(afloat_glob)
        with held(page, afloat_glob) as h:
            tap(section.get_by_role("button", name=say(T_MARK_AFLOAT_BTN, K)))
            pending = section.get_by_role("button", name="Marking…")
            expect(pending).to_be_disabled()
            expect(status).to_have_text(say(T_MARKING_AFLOAT, K))
            expect(section).not_to_contain_text("Afloat")
            h.release()
        expect(status).to_have_text(say(T_IS_AFLOAT, K))
        expect(section).to_contain_text("Afloat")
        petrel = section.get_by_role("button", name=say(T_MARK_AFLOAT_BTN, Pt))
        tap(petrel)
        expect(status).to_have_text(overdue_msg(vessel(B, "v-petrel")))
        focus_on(petrel)
        assert section.inner_text().split().count("Afloat") == 1
        page.route(recovered_glob, lambda route: route.abort())
        tap(section.get_by_role("button", name=say(T_MARK_RECOVERED_BTN, K)))
        expect(status).to_have_text(say(T_NO_REACH_AFLOAT, K))
        expect(section).to_contain_text("Afloat")
    assert vessel(B, "v-kittiwake")["afloat"] is True and vessel(B, "v-petrel")["afloat"] is False
    free(B, "v-kittiwake", "v-petrel")


def test_wf_live_telemetry_board(browser, app_url):
    B = app_url.rstrip("/")
    free(B, "v-kittiwake")
    vid = "v-kittiwake"
    e1, n1, e2, speed = 123.4, 456.7, 130.0, 1.6
    with screen(browser, B, IRA, f"/fleet/{vid}") as page:
        page.evaluate("window.__stay = 1")
        t1 = next_t(B, vid)
        ok(ingest(B, vid, fx(t1, e1, n1, speed=speed, battery=77)), 201)
        see(page, en(e1, n1), FIX_SCREEN_S + SLACK_S)
        expect(card(page, vid)).to_contain_text(en(e1, n1))
        detail = page.get_by_role("region", name="Detail")
        expect(detail).to_contain_text(en(e1, n1))
        recent = page.get_by_role("list", name="Recent fixes")
        row = say(T_FIX_ROW, {"<HH:MM:SS>": hms(t1), "<easting>": r1(e1), "<northing>": r1(n1), "<speed>": f"{r1(speed)} m/s"})
        expect(recent.get_by_role("listitem").first).to_contain_text(row)
        recent.get_by_role("listitem").first.focus()
        ok(ingest(B, vid, fx(t1 + timedelta(seconds=5), e2, n1, speed=speed, battery=76)), 201)
        see(page, en(e2, n1), FIX_SCREEN_S + SLACK_S)
        expect(card(page, vid)).to_contain_text(en(e2, n1))
        expect(recent.get_by_role("listitem").first).to_contain_text(en(e2, n1))
        assert hms(t1) in page.evaluate("document.activeElement.innerText")
        assert page.evaluate("window.__stay") == 1 and urlparse(page.url).path == f"/fleet/{vid}"


def test_dp24_fix_ingest(app_url):
    B = app_url.rstrip("/")
    vid = "v-gannet"
    t = next_t(B, vid)
    r = ok(ingest(B, vid, fx(t, 1.0, 1.0)), 201)
    assert (r["vessel_id"], r["link_state"], r["duplicate"]) == (vid, "Live", False)
    assert ok(ingest(B, vid, fx(t, 1.0, 1.0)))["duplicate"] is True
    assert err(ingest(B, vid, fx(t - timedelta(seconds=5), 1.0, 1.0)), 409, "out_of_order")["message"] == "This fix is older than the vessel's latest fix"
    batch = [fx(t + timedelta(seconds=s), float(s), 2.0) for s in (30, 10, 20)] + [fx(t, 1.0, 1.0)]
    b = ok(ingest(B, vid, {"fixes": batch}), 201)
    assert (b["accepted"], b["replayed"], b["last_t"][:19]) == (3, 1, iso(t + timedelta(seconds=30))[:19])
    stored = ok(api(B, IRA).get(f"/api/vessels/{vid}/fixes"))
    assert [parse(f["t"]) for f in stored[:4]] == [t + timedelta(seconds=s) for s in (30, 20, 10, 0)]
    assert vessel(B, vid)["last_fix"]["position"] == {"easting": 30.0, "northing": 2.0}
    b = err(ingest(B, vid, {"fixes": [fx(t + timedelta(seconds=40), 1.0, 1.0), fx(t + timedelta(seconds=5), 1.0, 1.0)]}), 409, "stale_fix", ("index",))
    assert b["index"] == 1
    e = err(ingest(B, vid, {"fixes": [fx(t + timedelta(seconds=50), 1.0, 1.0)] * 2}), 422, "validation", ("errors",))
    assert e["errors"]["fixes.1.t"] == "Each fix in a batch needs its own time"
    over = [fx(t + timedelta(seconds=100 + i), 1.0, 1.0) for i in range(BATCH_MAX + 1)]
    assert err(ingest(B, vid, {"fixes": over}), 422, "validation", ("errors",))["errors"]["fixes"] == "Send 1 to 100 fixes"
    for field, value, message in (("heading_deg", 360, "Heading must be at least 0 and below 360"), ("speed_mps", 21, "Speed must be between 0 and 20 m/s"),
                                  ("battery_pct", 101, "Battery must be between 0 and 100 %"), ("depth_m", 0, "Depth must be above 0 and at most 500 m"),
                                  ("t", "yesterday", "Send t as an ISO 8601 UTC time"), ("easting", "east", "Send easting in metres")):
        assert err(ingest(B, vid, {**fx(t + timedelta(seconds=60), 1.0, 1.0), field: value}), 422, "validation", ("errors",))["errors"][field] == message
    assert parse(ok(api(B, IRA).get(f"/api/vessels/{vid}/fixes"))[0]["t"]) == t + timedelta(seconds=30)
    bad = httpx.post(f"{B}/api/ingest/fixes", json=fx(t + timedelta(seconds=60), 1.0, 1.0), headers={"X-Ingest-Key": "ik-wrong"}, timeout=HTTP_S)
    err(bad, 401, "invalid_ingest_key")
    rs = parallel([lambda: ingest(B, vid, fx(t + timedelta(seconds=60), 3.0, 3.0))] * 6)
    assert sorted(r.status_code for r in rs) == [200] * 5 + [201]
    assert sum(1 for f in ok(api(B, IRA).get(f"/api/vessels/{vid}/fixes")) if parse(f["t"]) == t + timedelta(seconds=60)) == 1
    full = [fx(t + timedelta(seconds=61 + i), 1.0, 1.0) for i in range(BATCH_MAX)]
    assert ok(ingest(B, vid, {"fixes": full}), 201)["accepted"] == BATCH_MAX
    assert ok(ingest(B, vid, {"fixes": full[:3]}))["accepted"] == 0


def test_dp25_server_link_state(browser, app_url):
    B = app_url.rstrip("/")
    free(B, "v-gannet")
    fix(B, "v-gannet", 5.0, 5.0)
    assert vessel(B, "v-gannet")["link_state"] == "Live"
    with screen(browser, B, IRA, "/fleet") as page:
        page.clock.set_system_time(datetime(2031, 6, 1, tzinfo=timezone.utc))
        expect(card(page, "v-gannet")).to_contain_text("Live")
        poll(lambda: vessel(B, "v-gannet")["link_state"] == "Stale", LIVE_S + SLACK_S, "Stale")
        see(page, say(T_LINK_STALE, {"<vessel>": "Gannet"}), LINK_SCREEN_S + SLACK_S)
        expect(card(page, "v-gannet")).to_contain_text("Stale")
        poll(lambda: vessel(B, "v-gannet")["link_state"] == "Lost", LOST_S + SLACK_S, "Lost")
        see(page, say(T_LINK_LOST_ANN, {"<vessel>": "Gannet"}), LINK_SCREEN_S + SLACK_S)
        expect(card(page, "v-gannet")).to_contain_text("Lost")
        fix(B, "v-gannet", 5.0, 6.0)
        see(page, say(T_LINK_LIVE, {"<vessel>": "Gannet"}), LINK_SCREEN_S + SLACK_S)
        expect(card(page, "v-gannet")).to_contain_text("Live")


def test_dp26_closed_sheets_inert(browser, app_url):
    B = app_url.rstrip("/")
    free(B, "v-gannet")
    m = create(B)
    for size in ((768, 1024), (375, 812)):
        with screen(browser, B, IRA, "/fleet/v-gannet", size=size) as page:
            sheet = page.get_by_role("dialog", name=say(T_DETAIL, {"<vessel>": "Gannet"}))
            expect(sheet).to_be_visible()
            sheet.get_by_role("button", name="Close").click()
            gone(page, sheet)
            assert urlparse(page.url).path == "/fleet"
            fix(B, "v-gannet", 11.0, 22.0)
            see(page, en(11.0, 22.0))
            expect(page.get_by_role("dialog")).to_have_count(0)
            names = tab_order(page, 40)
            assert not {"Close", "Save interval", "Service interval"} & set(names)
            layout(page)
    with screen(browser, B, IRA, f"/missions/{m['id']}", size=(768, 1024)) as page:
        page.get_by_role("button", name="Mission detail").click()
        sheet = page.get_by_role("dialog", name="Mission detail")
        expect(sheet).to_be_visible()
        sheet.get_by_role("button", name="Close").click()
        gone(page, sheet)
        gone(page, page.get_by_role("table", name="Lines"))
        assert "Close" not in tab_order(page, 30)


def test_wf_link_lost_alert(browser, app_url, mail):
    B = app_url.rstrip("/")
    m, _ = launched(B, "v-gannet", area=TINY)
    fix(B, "v-gannet", *INSIDE)
    G = {"<vessel>": "Gannet"}
    heading = say(T_LINK_LOST, G)
    with screen(browser, B, IRA, "/fleet") as page:
        listen(page)
        poll(lambda: alerts(B, m["id"], "link_lost", status="open"), LOST_S + SLACK_S, "link_lost alert")
        see(page, heading, LINK_SCREEN_S + SLACK_S)
        art = page.get_by_role("region", name="Alerts").get_by_role("article").filter(
            has=page.get_by_role("heading", name=heading, level=3)).filter(has_text="Active")
        expect(art).to_have_count(1)
    msgs = inbox(mail, say(T_SUBJ_LINK, {**G, "<mission>": m["name"]}), 2)
    assert sorted(a for msg in msgs for a in addresses(msg["To"])) == sorted([IRA, WREN])
    free(B, "v-gannet")


def short_escalation():
    return 20


def test_dp28_alert_email_and_escalation(app_url, mail):
    B = short_url()
    m, _ = launched(B, "v-gannet", area=TINY)
    fix(B, "v-gannet", *INSIDE)
    fix(B, "v-gannet", *OUTSIDE)
    subject = say(T_SUBJ_BREACH, {"<vessel>": "Gannet", "<mission>": m["name"]})
    esc_subject = say(T_SUBJ_ESC, {"<original alert subject>": subject})
    msgs = inbox(mail, subject, 2)
    assert sorted(a for msg in msgs for a in addresses(msg["To"])) == sorted([IRA, WREN])
    assert all(len(addresses(msg["To"])) == 1 for msg in msgs)
    esc = inbox(mail, esc_subject, 3, seconds=short_escalation() + MAIL_S + SLACK_S)
    assert sorted(a for msg in esc for a in addresses(msg["To"])) == sorted([IRA, WREN, TAMSIN])
    first = alerts(B, m["id"], "geofence_breach")[0]
    poll(lambda: next(a for a in alerts(B, m["id"]) if a["id"] == first["id"])["escalation"] == "Emailed", MAIL_S, "escalation Emailed")
    fix(B, "v-gannet", *INSIDE)
    fix(B, "v-gannet", *OUTSIDE)
    second = max(alerts(B, m["id"], "geofence_breach"), key=lambda a: a["raised_at"])
    ok(api(B, IRA).post(f"/api/alerts/{second['id']}/ack", json={}))
    fix(B, "v-gannet", *INSIDE)
    poll(lambda: len([x for x in mail.messages() if x.get("Subject") == subject]) >= 4, MAIL_S + SLACK_S, "second breach emails")
    deadline = time.monotonic() + short_escalation() + MAIL_S
    while time.monotonic() < deadline:
        assert len([x for x in mail.messages() if x.get("Subject") == esc_subject]) == 3
        threading.Event().wait(POLL_S * 4)
    assert next(a for a in alerts(B, m["id"]) if a["id"] == second["id"])["escalation"] == "None"
    free(B, "v-gannet")


def test_dp29_alert_states(browser, app_url):
    B = app_url.rstrip("/")
    m, _ = launched(B, "v-gannet", area=TINY)
    P, W = api(B, IRA), api(B, WREN)
    fix(B, "v-gannet", *INSIDE)
    fix(B, "v-gannet", *OUTSIDE)
    a = alerts(B, m["id"], "geofence_breach")[0]
    heading = say(T_BREACH, {"<vessel>": "Gannet"})
    assert (a["state"], a["heading"], a["vessel_name"], a["position"]) == ("Active", heading, "Gannet", {"easting": OUTSIDE[0], "northing": OUTSIDE[1]})
    assert [(h["state"], h["by"]) for h in a["history"]] == [("Active", "Swathdeck")]
    acked = ok(P.post(f"/api/alerts/{a['id']}/ack", json={}))
    assert (acked["state"], acked["acknowledged_by"]) == ("Acknowledged", NAMES[IRA])
    assert acked["acknowledged_at"] == acked["history"][-1]["at"]
    assert ok(W.post(f"/api/alerts/{a['id']}/ack", json={})) == acked
    with screen(browser, B, IRA, "/fleet") as page:
        attribution = say(T_ACK_BY, {"<name>": NAMES[IRA], "<HH:MM:SS>": hms(parse(acked["acknowledged_at"]))})
        art = page.get_by_role("region", name="Alerts").get_by_role("article").filter(has_text=attribution)
        expect(art).to_have_count(1)
        expect(art.get_by_role("button", name=ack_name("Gannet"))).to_have_count(0)
        fix(B, "v-gannet", *INSIDE)
        closed = next(x for x in alerts(B, m["id"]) if x["id"] == a["id"])
        assert closed["state"] == "Closed" and [(h["state"], h["by"]) for h in closed["history"]] == [("Active", "Swathdeck"), ("Acknowledged", NAMES[IRA]), ("Closed", "Swathdeck")]
        assert a["id"] not in {x["id"] for x in alerts(B, m["id"], status="open")}
        until(page, "t => !document.body.innerText.includes(t)", attribution, WAIT_S)
        fix(B, "v-gannet", *OUTSIDE)
        fix(B, "v-gannet", *INSIDE)
        b = next(x for x in alerts(B, m["id"], status="open"))
        assert b["state"] == "Rectified" and b["rectified_at"] == b["history"][-1]["at"]
        rectified = say(T_RECTIFIED, {"<HH:MM:SS>": hms(parse(b["rectified_at"]))})
        until(page, HAS, rectified, WAIT_S)
        art = page.get_by_role("region", name="Alerts").get_by_role("article").filter(has_text=rectified)
        art.get_by_role("button", name=ack_name("Gannet")).click()
        see(page, "Alert acknowledged")
    done = next(x for x in alerts(B, m["id"]) if x["id"] == b["id"])
    assert done["state"] == "Closed" and done["acknowledged_by"] == NAMES[IRA]
    assert [h["state"] for h in done["history"]] == ["Active", "Rectified", "Closed"]
    free(B, "v-gannet")


def test_dp30_acknowledge_by_keyboard(browser, app_url):
    ack_board(browser, app_url, keep_focus=False)


def test_dp31_board_keeps_focus(browser, app_url):
    ack_board(browser, app_url, keep_focus=True)


def ack_board(browser, app_url, keep_focus):
    B = app_url.rstrip("/")
    m, _ = launched(B, "v-kittiwake", {"L02": "v-gannet", "L03": "v-shearwater"})
    for vid in ("v-kittiwake", "v-gannet", "v-shearwater"):
        fix(B, vid, *INSIDE)
    fix(B, "v-kittiwake", *OUTSIDE)
    fix(B, "v-gannet", *OUTSIDE)
    with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
        region = page.get_by_role("region", name="Alerts")
        bk = region.get_by_role("button", name=ack_name("Kittiwake"))
        bg = region.get_by_role("button", name=ack_name("Gannet"))
        expect(bk).to_be_visible()
        expect(bg).to_be_visible()
        old = region.get_by_role("article").filter(has=page.get_by_role("button", name=ack_name("Kittiwake")))
        bk.focus()
        fix(B, "v-shearwater", *OUTSIDE)
        see(page, say(T_BREACH, {"<vessel>": "Shearwater"}), FIX_SCREEN_S + SLACK_S)
        if keep_focus:
            focus_on(bk)
            assert not [a for a in animations(old) if a.get("playState") == "running"]
        else:
            bk.focus()
        page.keyboard.press("Enter")
        heard(page, "Alert acknowledged")
        states = {a["vessel_id"]: a for a in alerts(B, m["id"], "geofence_breach", status="open")}
        assert states["v-kittiwake"]["acknowledged_by"] == NAMES[IRA] and states["v-gannet"]["state"] == "Active" and states["v-shearwater"]["state"] == "Active"
        if keep_focus:
            free(B, "v-kittiwake", "v-gannet", "v-shearwater")
            return
        focus_on(bg)
        page.keyboard.press("Enter")
        focus_on(region.get_by_role("button", name=ack_name("Shearwater")))
    again = ok(api(B, WREN).post(f"/api/alerts/{states['v-kittiwake']['id']}/ack", json={}))
    assert again["acknowledged_by"] == NAMES[IRA] and len(again["history"]) == 2
    free(B, "v-kittiwake", "v-gannet", "v-shearwater")


def test_dp32_mail_outage(browser, mail):
    B = mail_down_url()
    poll(lambda: ok(api(B, IRA).get("/api/status"))["mail"] == "down", STATUS_S + SLACK_S, "mail down")
    m, _ = launched(B, "v-gannet", area=TINY)
    fix(B, "v-gannet", *INSIDE)
    with screen(browser, B, IRA, "/fleet") as page:
        see(page, "Alert email is delayed — alerts still show on this board.", STATUS_S + SLACK_S)
        fix(B, "v-gannet", *OUTSIDE)
        heading = say(T_BREACH, {"<vessel>": "Gannet"})
        see(page, heading, FIX_SCREEN_S + SLACK_S)
        heard(page, heading)
        expect(page.get_by_role("region", name="Alerts").get_by_role("article").filter(has_text=heading)).to_contain_text("Email queued")
    assert alerts(B, m["id"], "geofence_breach")[0]["email"] == "Queued"
    assert not [x for x in mail.messages() if m["name"] in x.get("Subject", "")]


def test_wf_geofence_breach(browser, app_url, mail):
    B = app_url.rstrip("/")
    m, _ = launched(B, "v-gannet", area=TINY)
    fix(B, "v-gannet", *INSIDE)
    G = {"<vessel>": "Gannet"}
    heading, back = say(T_BREACH, G), say(T_BACK_INSIDE, G)
    with screen(browser, B, IRA, "/fleet", size=(375, 812)) as page:
        fix(B, "v-gannet", *OUTSIDE)
        see(page, heading, FIX_SCREEN_S + SLACK_S)
        heard(page, heading)
        art = page.get_by_role("region", name="Alerts").get_by_role("article").filter(
            has=page.get_by_role("heading", name=heading, level=3))
        btn = art.get_by_role("button", name=ack_name("Gannet"))
        art.scroll_into_view_if_needed()
        box, bb = art.bounding_box(), btn.bounding_box()
        assert box["x"] >= 0 and box["x"] + box["width"] <= 375 + 0.5
        assert bb["height"] >= TOUCH_MIN_PX and bb["x"] + bb["width"] <= 375 + 0.5
        fix(B, "v-gannet", *INSIDE)
        see(page, back, FIX_SCREEN_S + SLACK_S)
        heard(page, back)
        layout(page)
    msgs = inbox(mail, say(T_SUBJ_BREACH, {**G, "<mission>": m["name"]}), 2)
    assert sorted(a for x in msgs for a in addresses(x["To"])) == sorted([IRA, WREN])
    free(B, "v-gannet")


def test_dp34_one_alert_per_excursion(app_url, mail):
    B = app_url.rstrip("/")
    m, _ = launched(B, "v-gannet", area=TINY)
    fix(B, "v-gannet", *INSIDE)
    t = next_t(B, "v-gannet")
    rs = parallel([lambda: ingest(B, "v-gannet", fx(t, *OUTSIDE))] * 6)
    assert sorted(r.status_code for r in rs) == [200] * 5 + [201]
    fix(B, "v-gannet", OUTSIDE[0] + 5, OUTSIDE[1])
    assert len(alerts(B, m["id"], "geofence_breach")) == 1
    subject = say(T_SUBJ_BREACH, {"<vessel>": "Gannet", "<mission>": m["name"]})
    inbox(mail, subject, 2)
    assert sorted(a for x in mail.messages(settle=5) if x.get("Subject") == subject for a in addresses(x["To"])) == sorted([IRA, WREN])
    fix(B, "v-gannet", *INSIDE)
    fix(B, "v-gannet", *OUTSIDE)
    assert len(alerts(B, m["id"], "geofence_breach")) == 2
    msgs = inbox(mail, subject, 4)
    assert sorted(a for x in msgs for a in addresses(x["To"])) == sorted([IRA, IRA, WREN, WREN])
    free(B, "v-gannet")


def test_dp35_alert_history_append_only(app_url):
    B = app_url.rstrip("/")
    m, _ = launched(B, "v-gannet", area=TINY)
    fix(B, "v-gannet", *INSIDE)
    fix(B, "v-gannet", *OUTSIDE)
    a = alerts(B, m["id"], "geofence_breach")[0]
    P, W = api(B, IRA), api(B, WREN)
    rs = parallel([lambda c=c: c.post(f"/api/alerts/{a['id']}/ack", json={}) for c in (P, W) * 4])
    bodies = [ok(r) for r in rs]
    steady = lambda a: {k: v for k, v in a.items() if k not in ("email", "escalation")}
    assert all(steady(b) == steady(bodies[0]) for b in bodies)
    acks = [h for h in bodies[0]["history"] if h["state"] == "Acknowledged"]
    assert len(acks) == 1 and acks[0]["by"] in (NAMES[IRA], NAMES[WREN]) and bodies[0]["acknowledged_by"] == acks[0]["by"]
    times = [parse(h["at"]) for h in bodies[0]["history"]]
    assert times == sorted(times)
    for method in ("PATCH", "PUT", "DELETE"):
        err(P.request(method, f"/api/alerts/{a['id']}", json=None if method == "DELETE" else {"state": "Closed"}), 404, "not_found")
    err(P.post(f"/api/alerts/{a['id']}", json={}), 404, "not_found")
    err(P.get(f"/api/alerts/{a['id']}/ack"), 404, "not_found")
    err(P.delete("/api/alerts"), 404, "not_found")
    assert steady(next(x for x in alerts(B, m["id"]) if x["id"] == a["id"])) == steady(bodies[0])
    free(B, "v-gannet")


def test_wf_live_coverage_console(browser, app_url):
    B = app_url.rstrip("/")
    m, ls = launched(B, "v-kittiwake")
    with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
        page.evaluate("window.__stay = 1")
        header = page.get_by_role("region", name="Mission header")
        chart = page.get_by_role("application", name="Coverage chart")
        before = decode(capture(chart))
        expect(header.get_by_role("group", name="Crossline agreement")).to_contain_text("—")
        survey(B, "v-kittiwake", ls["L01"], depth=5.0)
        api_m = get_mission(B, m["id"])
        until(page, HAS, f"{api_m['counters']['coverage_pct']}", WAIT_S)
        assert num(header.get_by_role("group", name="Coverage").inner_text()) == Decimal(str(api_m["counters"]["coverage_pct"]))
        expect(header.get_by_role("group", name="Lines remaining")).to_contain_text(str(api_m["counters"]["lines_remaining"]))
        expect(header.get_by_role("group", name="Open holidays")).to_contain_text(str(api_m["counters"]["open_holidays"]))
        changed(before, decode(capture(chart)))
        survey(B, "v-kittiwake", ls["X01"], depth=5.0)
        ag = get_mission(B, m["id"])["crossline_agreement"]
        if ag["compared"]:
            until(page, HAS, f"% of {ag['compared']}", WAIT_S)
        assert page.evaluate("window.__stay") == 1
    free(B, "v-kittiwake")


def coverage_run(B):
    m, ls = launched(B, "v-kittiwake")
    t = [next_t(B, "v-kittiwake")]
    runs = []

    def run(label, points, headings, speeds, depths):
        fixes = []
        for (e, n), h, s, d in zip(points, headings, speeds, depths):
            fixes.append(fx(t[0], float(e), float(n), heading=h, speed=s, depth=d))
            t[0] += timedelta(seconds=10)
        ok(line_cmd(B, "v-kittiwake", ls[label]["id"], "start"))
        ok(ingest(B, "v-kittiwake", {"fixes": fixes}), 201)
        ok(line_cmd(B, "v-kittiwake", ls[label]["id"], "end"))
        runs.append((label, ls[label]["kind"], fixes))

    run("L01", [(10, n) for n in (0, 10, 20, 30, 40)], [0, 0, 20, 0, 0], [2] * 5, [8.8] * 5)
    run("L02", [(30, n) for n in (0, 10, 15, 20, 30, 40)], [0, 0, 45, 0, 0, 0], [2] * 6, [5.0] * 6)
    run("L03", [(50, n) for n in (0, 10, 20, 25, 30, 40)], [180] * 6, [2, 2, 2, 2, 3.5, 2], [3.8] * 6)
    crossline = lambda: run("X01", [(e, 20) for e in (0, 20, 40, 60)], [90] * 4, [2] * 4, [8.9, 8.9, 5.0, 3.0])
    return m, runs, crossline


def open_holidays_of(B, m):
    return [h for h in ok(api(B, IRA).get(f"/api/missions/{m['id']}/holidays")) if h["status"] != "Closed"]


def test_dp37_coverage_grid(app_url):
    B = app_url.rstrip("/")
    m, runs, _ = coverage_run(B)
    mdl = model(AREA, 2, 4, 0, runs)
    cov = ok(api(B, IRA).get(f"/api/missions/{m['id']}/coverage"))
    assert cov["cell_size_m"] == CELL and cov["origin"] == {"easting": 0, "northing": 0}
    assert (cov["cols"], cov["rows"], cov["overlap"]) == (mdl["cols"], mdl["rows"], mdl["overlap"])
    covered = sum(1 for row in mdl["overlap"] for c in row if c > 0)
    assert Decimal(str(cov["counters"]["coverage_pct"])) == r1(covered / (mdl["cols"] * mdl["rows"]) * 100)
    lines_now = get_lines(B, m["id"])
    for lab, length in mdl["covered"].items():
        assert abs(lines_now[lab]["covered_m"] - length) < 1e-6, lab
    assert lines_now["L03"]["covered_m"] < lines_now["L03"]["length_m"] and lines_now["L02"]["covered_m"] < lines_now["L02"]["length_m"]
    tracks = {tr["label"]: tr for tr in ok(api(B, IRA).get(f"/api/missions/{m['id']}/tracks"))["tracks"]}
    assert len(tracks["L03"]["points"]) == 6 and any(p["northing"] == 30 for p in tracks["L03"]["points"])
    assert len(tracks["L02"]["points"]) == 6 and any(p["northing"] == 15 for p in tracks["L02"]["points"])
    free(B, "v-kittiwake")


def test_dp38_holidays_and_specks(app_url):
    B = app_url.rstrip("/")
    m, runs, crossline = coverage_run(B)
    hol, specks = groups(model(AREA, 2, 4, 0, runs), 0, [10, 30, 50], [True] * 3)
    assert hol and specks, "the off-heading gap leaves a speck and the over-speed gap a holiday"
    first = open_holidays_of(B, m)
    assert {frozenset(map(tuple, h["cells"])) for h in first} == set(hol)
    for h in first:
        assert re.fullmatch(r"H\d+", h["label"])
        assert h["area_m2"] == h["cell_count"] * CELL_AREA == len(h["cells"]) * CELL_AREA
    assert not any(set(map(tuple, h["cells"])) & s for h in first for s in specks)
    assert get_mission(B, m["id"])["counters"]["open_holidays"] == len(hol)
    crossline()
    hol2, _ = groups(model(AREA, 2, 4, 0, runs), 0, [10, 30, 50], [True] * 3)
    after = open_holidays_of(B, m)
    assert {frozenset(map(tuple, h["cells"])) for h in after} == set(hol2)
    for h in after:
        same = next((p for p in first if set(map(tuple, p["cells"])) == set(map(tuple, h["cells"]))), None)
        if same:
            assert same["label"] == h["label"]
    free(B, "v-kittiwake")


def test_dp39_counters_agree(app_url):
    B = app_url.rstrip("/")
    m, runs, crossline = coverage_run(B)
    P, O = api(B, IRA), api(B, ODILE)
    for stage in (0, 1):
        if stage:
            crossline()
        counters = get_mission(B, m["id"])["counters"]
        lines_now = get_lines(B, m["id"])
        assert counters["lines_remaining"] == sum(l["status"] in ("Pending", "Assigned", "Running") for l in lines_now.values()) == 1 - stage
        assert counters["open_holidays"] == sum(h["status"] == "Open" for h in open_holidays_of(B, m))
        assert next(x for x in ok(P.get("/api/missions")) if x["id"] == m["id"])["counters"] == counters
        assert ok(P.get(f"/api/missions/{m['id']}/coverage"))["counters"] == counters
        assert ok(O.get(f"/api/missions/{m['id']}"))["counters"] == counters
        assert next(x for x in ok(O.get("/api/missions")) if x["id"] == m["id"])["counters"] == counters
        rows = ok(P.get(f"/api/missions/{m['id']}/coverage.csv")).text.split("\r\n")
        for lab, l in lines_now.items():
            row = next(r for r in rows if f",{lab}," in r).split(",")
            assert row[-3:] == [str(r1(l["length_m"])), str(r1(l["covered_m"])), str(r1(min(100, l["covered_m"] / l["length_m"] * 100)))]
    assert get_mission(B, m["id"])["status"] == "Recovering"
    free(B, "v-kittiwake")


def test_dp40_crossline_agreement(app_url):
    B = app_url.rstrip("/")
    m, runs, crossline = coverage_run(B)
    assert get_mission(B, m["id"])["crossline_agreement"] == {"compared": 0, "within": 0, "pct": None, "meets_order": None}
    crossline()
    compared, within = agreement(model(AREA, 2, 4, 0, runs), "special", {"X01"}, {"L01", "L02", "L03"})
    assert compared and within < compared
    ag = get_mission(B, m["id"])["crossline_agreement"]
    p = r1(within / compared * 100)
    assert (ag["compared"], ag["within"], Decimal(str(ag["pct"])), ag["meets_order"]) == (compared, within, p, p >= MEETS_PCT)
    assert ok(api(B, ODILE).get(f"/api/missions/{m['id']}"))["crossline_agreement"] == ag
    free(B, "v-kittiwake")


def test_dp41_console_state_survives_repaints(browser, app_url):
    B = app_url.rstrip("/")
    m, ls = launched(B, "v-kittiwake")
    ok(line_cmd(B, "v-kittiwake", ls["L01"]["id"], "start"))
    with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
        chart = page.get_by_role("application", name="Coverage chart")
        chart.focus()
        e0, n0 = readout(page)
        page.keyboard.press(RIGHT)
        e1, n1 = readout(page)
        assert abs(e1 - e0 - LENS_STEP_M) < READ_TOL and abs(n1 - n0) < READ_TOL
        page.keyboard.press("Enter")
        heard(page, "No holiday under the lens")
        t = next_t(B, "v-kittiwake")
        ok(ingest(B, "v-kittiwake", {"fixes": [fx(t + timedelta(seconds=10 * i), 10.0, 10.0 * i) for i in range(4)]}), 201)
        advance(page, 3 * REFRESH_MS)
        until(page, "() => true", None, 5)
        assert readout(page) == (e1, n1)
    with screen(browser, B, IRA, f"/missions/{m['id']}", size=(768, 1024)) as page:
        opener = page.get_by_role("button", name="Mission detail")
        opener.click()
        sheet = page.get_by_role("dialog", name="Mission detail")
        expect(sheet).to_be_visible()
        sheet.get_by_role("button", name="Close").click()
        opener.click()
        advance(page, 1000)
        expect(sheet).to_be_visible()
        assert inside_viewport(page, sheet)
    free(B, "v-kittiwake")


def test_dp42_coverage_csv(app_url):
    B = app_url.rstrip("/")
    tag = os.urandom(3).hex()
    name = f"Été, \"Quay\" {tag}"
    m = create(B, name=name)
    assert csv_field(name) != name
    expected_rows = [",".join([csv_field(name), l["label"], l["kind"], "", l["status"], str(r1(l["length_m"])), str(r1(l["covered_m"])),
                               str(r1(min(100, l["covered_m"] / l["length_m"] * 100)))]) for l in get_lines(B, m["id"]).values()]
    disposition = say(T_CSV_DISPOSITION, {"<slug>": slug(name, m["id"])})
    for email in (IRA, TAMSIN, ODILE):
        r = ok(api(B, email).get(f"/api/missions/{m['id']}/coverage.csv"))
        assert r.headers["content-type"].replace(" ", "").lower() == "text/csv; charset=utf-8".replace(" ", "")
        assert r.headers["content-disposition"] == disposition
        raw = r.content.decode("utf-8")
        assert raw.endswith("\r\n") and "\n" not in raw.replace("\r\n", "")
        rows = raw.split("\r\n")[:-1]
        assert rows[0] == "mission,line,kind,vessel,status,length_m,covered_m,coverage_pct"
        assert rows[1:] == expected_rows
    bare = create(B, name="!!!")
    assert ok(api(B, IRA).get(f"/api/missions/{bare['id']}/coverage.csv")).headers["content-disposition"] == say(T_CSV_DISPOSITION, {"<slug>": bare["id"]})


def test_wf_holiday_infill_lens(browser, app_url):
    B = app_url.rstrip("/")
    with ExitStack() as stack:
        m, ls, west, east = holiday_mission(B, stack)
        k_beat = ExitStack()
        k_beat.enter_context(heartbeat(B, "v-kittiwake", 10.0, 40.0))
        img_name = say(T_INFILL_IMG, {"<line>": "I01"})
        with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
            header = page.get_by_role("region", name="Mission header")
            expect(header.get_by_role("group", name="Open holidays")).to_contain_text("2")
            chart = page.get_by_role("application", name="Coverage chart")
            west_cells = {tuple(c) for c in west["cells"]}
            origin = ok(api(B, IRA).get(f"/api/missions/{m['id']}/coverage"))["origin"]
            cell_of = lens_onto(page, chart, west_cells, origin)
            chart.focus()
            lens_shown(page)
            page.keyboard.press(RIGHT)
            page.keyboard.press(LEFT)
            assert cell_of(*readout(page)) in west_cells, readout(page)
            expect(page.get_by_role("group", name="Lens readout")).to_contain_text(say(T_LENS_ROW, {"<holiday>": west["label"], "<area>": int(west["area_m2"])}))
            expect(page.get_by_role("img", name=img_name)).to_have_count(0)
            page.keyboard.press("Enter")
            heard(page, say(T_QUEUED, {"<line>": "I01", "<vessel>": "Kittiwake"}))
            expect(page.get_by_role("img", name=img_name)).to_be_visible()
            expect(header.get_by_role("group", name="Open holidays")).to_contain_text("1")
            h = next(x for x in ok(api(B, IRA).get(f"/api/missions/{m['id']}/holidays")) if x["id"] == west["id"])
            assert h["status"] == "Queued" and h["infill_line_id"]
            k_beat.close()
            infill = get_lines(B, m["id"])["I01"]
            survey(B, "v-kittiwake", infill, depth=2.4)
            see(page, say(T_HOL_CLOSED, {"<holiday>": west["label"]}), FIX_SCREEN_S + SLACK_S)
        assert next(x for x in ok(api(B, IRA).get(f"/api/missions/{m['id']}/holidays")) if x["id"] == west["id"])["status"] == "Closed"
        assert get_mission(B, m["id"])["counters"]["open_holidays"] == 1
    free(B, "v-kittiwake", "v-gannet")


def test_dp44_holiday_lens(browser, app_url):
    B = app_url.rstrip("/")
    with infill_console(browser, B, reduced_motion="no-preference") as (page, m, west, east):
        chart = page.get_by_role("application", name="Coverage chart")
        chart.focus()
        lens_shown(page)
        e0, n0 = readout(page)
        page.keyboard.press(RIGHT)
        e1, n1 = readout(page)
        assert abs(e1 - e0 - LENS_STEP_M) < READ_TOL and abs(n1 - n0) < READ_TOL
        page.keyboard.press(f"Shift+{UP}")
        e2, n2 = readout(page)
        assert abs(n2 - n1 - LENS_SHIFT_M) < READ_TOL and abs(e2 - e1) < READ_TOL
        page.keyboard.press(f"Shift+{DOWN}")
        page.keyboard.press(LEFT)
        walk(page, e0, n0, east["centroid"])
        expect(page.get_by_role("group", name="Lens readout")).to_contain_text(say(T_LENS_ROW, {"<holiday>": east["label"], "<area>": int(east["area_m2"])}))
        at_keys = readout(page)
        box = chart.bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.25)
        page.mouse.move(box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.3)
        advance(page, 500)
        until(page, "() => true", None, 5)
        assert readout(page) != at_keys
        lens_shown(page)


def test_dp45_queue_infill_once(app_url):
    B = app_url.rstrip("/")
    P = api(B, IRA)
    with ExitStack() as stack:
        m, ls, west, east = holiday_mission(B, stack)
        k_beat = ExitStack()
        k_beat.enter_context(heartbeat(B, "v-kittiwake", 10.0, 40.0))
        poll(lambda: vessel(B, "v-kittiwake")["link_state"] == "Live", WAIT_S, "Kittiwake Live")
        hol = lambda hid: next(x for x in ok(P.get(f"/api/missions/{m['id']}/holidays")) if x["id"] == hid)
        assert hol(west["id"])["nearest_vessel"] == {"id": "v-kittiwake", "name": "Kittiwake"}
        set_interval(B, "v-kittiwake", INTERVAL_MIN)
        assert hol(west["id"])["nearest_vessel"] == {"id": "v-gannet", "name": "Gannet"}
        set_interval(B, "v-kittiwake", INTERVAL_MAX)
        rs = parallel([lambda: P.post(f"/api/missions/{m['id']}/holidays/{west['id']}/infill", json={})] * 6)
        assert sorted(r.status_code for r in rs) == [200] * 5 + [201]
        line = next(r.json() for r in rs if r.status_code == 201)["line"]
        assert len({r.json()["line"]["id"] for r in rs}) == 1
        assert (line["label"], line["kind"], line["status"], line["vessel_id"], line["holiday_id"]) == ("I01", "infill", "Assigned", "v-kittiwake", west["id"])
        x = west["centroid"]["easting"]
        assert line["start"] == {"easting": x, "northing": 0} and line["end"] == {"easting": x, "northing": 40}
        body = next(r.json() for r in rs if r.status_code == 201)
        assert body["holiday"]["status"] == "Queued" and body["counters"] == get_mission(B, m["id"])["counters"]
        assert sum(1 for l in get_lines(B, m["id"]).values() if l["kind"] == "infill") == 1
        set_interval(B, "v-kittiwake", INTERVAL_MIN)
        ashore(B, "v-gannet")
        assert err(P.post(f"/api/missions/{m['id']}/holidays/{east['id']}/infill", json={}), 409, "no_eligible_vessel")["message"] == say(T_NO_ELIGIBLE, {"<holiday>": east["label"]})
        for vid in ("v-kittiwake", "v-gannet"):
            set_interval(B, vid, INTERVAL_MAX)
        k_beat.close()
        survey(B, "v-kittiwake", get_lines(B, m["id"])["I01"], depth=2.4)
        assert err(P.post(f"/api/missions/{m['id']}/holidays/{west['id']}/infill", json={}), 409, "holiday_closed")["message"] == say(T_HOL_CLOSED_409, {"<holiday>": west["label"]})
        err(api(B, TAMSIN).post(f"/api/missions/{m['id']}/holidays/{east['id']}/infill", json={}), 403, "forbidden")
        ok(transition(B, m["id"], "Aborted"))
        assert err(P.post(f"/api/missions/{m['id']}/holidays/{east['id']}/infill", json={}), 409, "mission_not_surveying")["message"] == "Infill can be queued only while the mission is surveying"
    free(B, "v-kittiwake", "v-gannet")


@contextmanager
def infill_console(browser, B, reduced_motion="reduce"):
    try:
        with ExitStack() as stack:
            m, ls, west, east = holiday_mission(B, stack)
            stack.enter_context(heartbeat(B, "v-kittiwake", 10.0, 40.0))
            poll(lambda: vessel(B, "v-kittiwake")["link_state"] == "Live", WAIT_S, "Kittiwake Live")
            with screen(browser, B, IRA, f"/missions/{m['id']}", reduced_motion=reduced_motion) as page:
                yield page, m, west, east
    finally:
        free(B, "v-kittiwake", "v-gannet")


def queue_button(page, holiday):
    return page.get_by_role("list", name="Holidays").get_by_role("button", name=say(T_QUEUE_BTN, {"<holiday>": holiday["label"]}))


def test_dp46_infill_only_when_confirmed(browser, app_url):
    B = app_url.rstrip("/")
    with infill_console(browser, B) as (page, m, west, east):
        btn = queue_button(page, west)
        item = page.get_by_role("list", name="Holidays").get_by_role("listitem").filter(
            has=page.get_by_role("button", name=say(T_QUEUE_BTN, {"<holiday>": west["label"]})))
        opens = page.get_by_role("region", name="Mission header").get_by_role("group", name="Open holidays")
        img = page.get_by_role("img", name=say(T_INFILL_IMG, {"<line>": "I01"}))
        queued_to = say(T_QUEUED_TO, {"<vessel>": "Kittiwake"})
        expect(opens).to_contain_text("2")
        posts = []
        page.on("request", lambda r: posts.append(r) if r.method == "POST" and r.url.endswith("/infill") else None)
        page.route(INFILL_GLOB, lambda route: route.abort())
        btn.click()
        heard(page, say(T_NO_REACH_QUEUE, {"<holiday>": west["label"]}))
        expect(img).to_have_count(0)
        expect(item).not_to_contain_text(queued_to)
        expect(opens).to_contain_text("2")
        page.unroute(INFILL_GLOB)
        with held(page, INFILL_GLOB) as h:
            btn.click()
            expect(btn).to_be_disabled()
            expect(btn).to_have_text("Queueing…")
            btn.press("Enter")
            expect(img).to_have_count(0)
            expect(item).not_to_contain_text(queued_to)
            expect(opens).to_contain_text("2")
            h.release()
        expect(img).to_be_visible()
        expect(item).to_contain_text(queued_to)
        expect(opens).to_contain_text("1")
        assert len(posts) == 2
        set_interval(B, "v-kittiwake", INTERVAL_MIN)
        g = vessel(B, "v-gannet")
        if g["running_line_id"]:
            ok(line_cmd(B, "v-gannet", g["running_line_id"], "end"))
        ok(api(B, TAMSIN).post(vpath("v-gannet", "/recovered"), json={}))
        ebtn = queue_button(page, east)
        with page.expect_response(INFILL_GLOB) as resp:
            ebtn.click()
        assert resp.value.status == 409
        expect(ebtn).to_contain_text("Queue infill")
        focus_on(ebtn)
        expect(page.get_by_role("img", name=say(T_INFILL_IMG, {"<line>": "I02"}))).to_have_count(0)
        assert next(h for h in ok(api(B, IRA).get(f"/api/missions/{m['id']}/holidays")) if h["id"] == east["id"])["status"] == "Open"
        assert sum(1 for l in get_lines(B, m["id"]).values() if l["kind"] == "infill") == 1


def test_dp47_announced_infill_results(browser, app_url):
    B = app_url.rstrip("/")
    with infill_console(browser, B) as (page, m, west, east):
        btn = queue_button(page, west)
        W_ = {"<holiday>": west["label"]}
        I_K = {"<line>": "I01", "<vessel>": "Kittiwake"}
        page.route(INFILL_GLOB, lambda route: route.abort())
        btn.click()
        heard(page, say(T_NO_REACH_QUEUE, W_))
        page.unroute(INFILL_GLOB)
        with held(page, INFILL_GLOB) as h:
            btn.click()
            heard(page, say(T_QUEUEING, W_))
            h.release()
        heard(page, say(T_QUEUED, I_K))
        btn.click()
        heard(page, say(T_REPLAY, I_K))
        set_interval(B, "v-kittiwake", INTERVAL_MIN)
        ashore(B, "v-gannet")
        queue_button(page, east).click()
        heard(page, say(T_NO_ELIGIBLE, {"<holiday>": east["label"]}))


def test_dp48_reduced_motion_list(browser, app_url):
    B = app_url.rstrip("/")
    with infill_console(browser, B) as (page, m, west, east):
        btn = queue_button(page, west)
        item = page.get_by_role("list", name="Holidays").get_by_role("listitem").filter(
            has=page.get_by_role("button", name=say(T_QUEUE_BTN, {"<holiday>": west["label"]})))
        expect(item).to_contain_text(say(T_LENS_ROW, {"<holiday>": west["label"], "<area>": int(west["area_m2"])}))
        expect(item).to_contain_text(say(T_NEAREST, {"<vessel>": "Kittiwake"}))
        btn.click()
        focus_on(page.get_by_role("table", name="Lines").get_by_role("row").filter(has_text="I01"))
        overlay = page.get_by_role("img", name=say(T_INFILL_IMG, {"<line>": "I01"}))
        expect(overlay).to_be_visible()
        assert not moving(overlay)
        page.get_by_role("application", name="Coverage chart").focus()
        lens = lens_shown(page)
        assert not moving(lens)


def test_dp48_lens_open_motion(browser, app_url):
    B = app_url.rstrip("/")
    m = create(B)
    with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
        page.get_by_role("application", name="Coverage chart").focus()
        lens = lens_shown(page)
        timings = lens.evaluate("e => e.getAnimations({subtree: true}).map(a => { const t = a.effect.getComputedTiming(); return [t.endTime, t.iterations]; })")
        assert all(end <= LENS_OPEN_MS and it != float("inf") for end, it in timings), timings


def test_dp49_infill_moves_off_lost_vessel(browser, app_url):
    B = app_url.rstrip("/")
    with ExitStack() as stack:
        m, ls, west, east = holiday_mission(B, stack)
        k_beat = ExitStack()
        k_beat.enter_context(heartbeat(B, "v-kittiwake", 10.0, 40.0))
        poll(lambda: vessel(B, "v-kittiwake")["link_state"] == "Live", WAIT_S, "Kittiwake Live")
        line = ok(api(B, IRA).post(f"/api/missions/{m['id']}/holidays/{west['id']}/infill", json={}), 201)["line"]
        assert line["vessel_id"] == "v-kittiwake"
        with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
            listen(page)
            k_beat.close()
            poll(lambda: get_lines(B, m["id"])["I01"]["vessel_id"] == "v-gannet", LOST_S + LINK_SCREEN_S + SLACK_S, "infill moved")
            moved = page.get_by_role("table", name="Lines").get_by_role("row").filter(has_text="I01").filter(has_text="Gannet")
            end = time.monotonic() + LINK_SCREEN_S + SLACK_S
            while not (page.evaluate(SAID, say(T_MOVED, {"<line>": "I01", "<vessel>": "Gannet"})) or moved.count()):
                assert time.monotonic() < end, "infill move neither announced nor shown"
                page.clock.run_for(FRAME_MS * 3)
        after = get_lines(B, m["id"])
        assert after["L02"]["vessel_id"] == "v-kittiwake" and after["L03"]["vessel_id"] == "v-gannet"
        assert next(h for h in ok(api(B, IRA).get(f"/api/missions/{m['id']}/holidays")) if h["id"] == west["id"])["status"] == "Queued"
        assert ok(api(B, IRA).get(f"/api/missions/{m['id']}/vessels/v-gannet/infill-order"))["line_ids"][-1] == line["id"]
    free(B, "v-kittiwake", "v-gannet")


def test_dp50_reorder_infill_queue(browser, app_url):
    B = app_url.rstrip("/")
    P = api(B, IRA)
    with ExitStack() as stack:
        m, ls, west, east = holiday_mission(B, stack)
        stack.enter_context(heartbeat(B, "v-kittiwake", 10.0, 40.0))
        poll(lambda: vessel(B, "v-kittiwake")["link_state"] == "Live", WAIT_S, "Kittiwake Live")
        i1 = ok(P.post(f"/api/missions/{m['id']}/holidays/{west['id']}/infill", json={}), 201)["line"]
        i2 = ok(P.post(f"/api/missions/{m['id']}/holidays/{east['id']}/infill", json={}), 201)["line"]
        path = f"/api/missions/{m['id']}/vessels/v-kittiwake/infill-order"
        assert ok(P.get(path))["line_ids"] == [i1["id"], i2["id"]]
        assert ok(P.put(path, json={"line_ids": [i2["id"], i1["id"]]}))["line_ids"] == [i2["id"], i1["id"]]
        err(P.put(path, json={"line_ids": [i1["id"]]}), 409, "stale_order")
        err(P.put(path, json={"line_ids": [i1["id"], i1["id"]]}), 409, "stale_order")
        err(P.put(path, json={"line_ids": [ls["L02"]["id"], i1["id"]]}), 404, "not_found")
        err(P.get(f"/api/missions/{m['id']}/vessels/v-petrel/infill-order"), 404, "not_found")
        assert ok(P.get(path))["line_ids"] == [i2["id"], i1["id"]]
        with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
            queue = page.get_by_role("list", name=say(T_QUEUE_LIST, {"<vessel>": "Kittiwake"}))
            first = queue.get_by_role("listitem").first
            expect(first).to_contain_text(say(T_QUEUE_ROW, {"<position>": 1, "<line>": "I02", "<holiday>": east["label"]}))
            first.focus()
            page.keyboard.press("Alt+ArrowDown")
            heard(page, say(T_REORDERED, {"<line>": "I02", "<n>": 2, "<total>": 2}))
            expect(queue.get_by_role("listitem").nth(1)).to_contain_text(say(T_QUEUE_ROW, {"<position>": 2, "<line>": "I02", "<holiday>": east["label"]}))
            assert "I02" in page.evaluate("document.activeElement.innerText")
        assert ok(P.get(path))["line_ids"] == [i1["id"], i2["id"]]
    free(B, "v-kittiwake", "v-gannet")


def test_wf_line_file_upload_phone(browser, app_url):
    B = app_url.rstrip("/")
    m, ls = recovering(B)
    data = payload("L01") * 200
    L = {"<line>": "L01"}
    with screen(browser, B, TAMSIN, "/launch", size=(375, 812)) as page:
        page.evaluate("""() => { window.__progress = []; new MutationObserver(() => {
            for (const x of document.body.innerText.matchAll(/Uploading (\\d+)%/g)) window.__progress.push(+x[1]); })
            .observe(document.body, {subtree: true, childList: true, characterData: true}); }""")
        section = page.get_by_role("region", name=m["name"])
        expect(section).to_contain_text("Awaiting upload")
        section.get_by_role("button", name=say(T_UPLOAD_BTN, L)).click()
        dlg = page.get_by_role("dialog", name="Upload line file")
        expect(dlg).to_contain_text("L01")
        box = dlg.bounding_box()
        assert box["x"] >= 0 and box["x"] + box["width"] <= 375 + 0.5
        dlg.get_by_label("Line file").set_input_files({"name": fname("L01"), "mimeType": "application/octet-stream", "buffer": data})
        dlg.get_by_role("textbox", name="SHA-256").fill(sha(data))
        up = dlg.get_by_role("button", name="Upload")
        assert up.bounding_box()["height"] >= TOUCH_MIN_PX
        up.click()
        expect(page.get_by_role("status", name="Launch status")).to_have_text(say(T_STORED, L))
        expect(section).to_contain_text("Stored")
        assert all(n <= 99 for n in page.evaluate("window.__progress"))
    line = get_lines(B, m["id"])["L01"]
    assert line["status"] == "Delivered" and line["file"]["state"] == "Stored" and line["file"]["sha256"] == sha(data)
    assert S3().get(f"lines/{m['id']}/{line['id']}/{fname('L01')}") == data
    free(B, "v-gannet")


def test_dp52_stored_after_confirmed_write(app_url):
    B = app_url.rstrip("/")
    m, ls = recovering(B)
    T = api(B, TAMSIN)
    l01, x01 = ls["L01"], ls["X01"]
    data = payload("L01")
    prefix = f"lines/{m['id']}/{l01['id']}/"
    assert err(upload(T, l01, data, digest="0" * 64), 422, "validation", ("errors",))["errors"]["sha256"] == "Checksum does not match this file. Nothing was stored."
    assert err(upload(T, l01, data, digest="abc"), 422, "validation", ("errors",))["errors"]["sha256"] == "Enter the 64-character SHA-256 from the logger"
    assert err(upload(T, l01, data, name=".hidden"), 422, "validation", ("errors",))["errors"]["file_name"] == "Use a file name of 1 to 120 letters, digits, dots, underscores or hyphens"
    assert err(upload(T, l01, b""), 422, "validation", ("errors",))["errors"]["file"] == "The file is empty"
    assert S3().keys(prefix) == [] and get_lines(B, m["id"])["L01"]["file"]["state"] == "Awaiting upload"
    first = ok(upload(T, l01, data, digest=sha(data).upper()), 201)
    assert (first["status"], first["file"]["state"], first["file"]["sha256"], first["file"]["size_bytes"]) == ("Delivered", "Stored", sha(data), len(data))
    assert S3().keys(prefix) == [prefix + fname("L01")] and S3().get(prefix + fname("L01")) == data
    fresh_m = create(B)
    err(upload(T, get_lines(B, fresh_m["id"])["L01"], data), 409, "line_not_surveyed")
    free(B, "v-gannet")


def test_dp53_upload_replay_and_conflict(app_url):
    B = app_url.rstrip("/")
    m, ls = recovering(B)
    T = api(B, TAMSIN)
    l01, x01 = ls["L01"], ls["X01"]
    data = payload("L01")
    prefix = f"lines/{m['id']}/{l01['id']}/"
    first = ok(upload(T, l01, data), 201)
    assert ok(upload(T, l01, data)) == first
    assert err(upload(T, l01, data + b"!"), 409, "already_delivered")["message"] == say(T_DIFFERENT, {"<line>": "L01"})
    assert S3().get(prefix + fname("L01")) == data
    variants = [payload("X01") for _ in range(4)]
    rs = parallel([lambda d=d: upload(T, x01, d, name=fname("X01")) for d in variants])
    assert sorted(r.status_code for r in rs) == [201, 409, 409, 409]
    winner = variants[[r.status_code for r in rs].index(201)]
    assert S3().get(f"lines/{m['id']}/{x01['id']}/{fname('X01')}") == winner
    free(B, "v-gannet")


def test_dp54_upload_after_session_ends(browser, app_url):
    B = app_url.rstrip("/")
    m, ls = recovering(B)
    data = payload("L01")
    with screen(browser, B, TAMSIN, "/launch") as page:
        puts = []
        page.on("request", lambda r: puts.append(r) if r.method == "PUT" and r.url.endswith("/file") else None)
        page.get_by_role("region", name=m["name"]).get_by_role("button", name=say(T_UPLOAD_BTN, {"<line>": "L01"})).click()
        dlg = page.get_by_role("dialog", name="Upload line file")
        dlg.get_by_label("Line file").set_input_files({"name": fname("L01"), "mimeType": "application/octet-stream", "buffer": data})
        dlg.get_by_role("textbox", name="SHA-256").fill(sha(data))
        assert page.request.delete(f"{B}/api/session").status == 204
        dlg.get_by_role("button", name="Upload").click()
        expect(dlg).to_contain_text(say(T_SESSION_ENDED, {"<line>": "L01"}))
        expect(dlg.get_by_role("textbox", name="SHA-256")).to_have_value(sha(data))
        dlg.get_by_role("textbox", name="Email").fill(TAMSIN)
        dlg.get_by_label("Password", exact=True).fill(PASSWORD)
        dlg.get_by_role("button", name="Sign in and upload").click()
        expect(page.get_by_role("status", name="Launch status")).to_have_text(say(T_STORED, {"<line>": "L01"}))
        assert len(puts) == 2
    assert S3().get(f"lines/{m['id']}/{ls['L01']['id']}/{fname('L01')}") == data
    free(B, "v-gannet")


def test_dp55_abandoned_transfers(app_url):
    B = app_url.rstrip("/")
    m, ls = recovering(B)
    T = api(B, TAMSIN)
    ok(upload(T, ls["X01"], payload("X01") * 5000), 201)
    full = os.urandom(1_000_000)
    sent = 64 * 1024
    headers = {"Content-Type": "application/octet-stream", "X-Line-File-Name": fname("L01"), "X-Content-SHA256": sha(full),
               "Content-Length": str(len(full))}

    class Abandoned(Exception):
        pass

    def partial():
        yield full[:sent]
        raise Abandoned()

    for _ in range(ABANDONS):
        try:
            T.put(f"/api/lines/{ls['L01']['id']}/file", content=partial(), headers=headers)
        except (Abandoned, httpx.HTTPError):
            pass
    for _ in range(5):
        with T.stream("GET", f"/api/lines/{ls['X01']['id']}/file") as r:
            next(r.iter_bytes())
    start = time.monotonic()
    ok(httpx.get(f"{B}/api/health", timeout=HTTP_S))
    assert time.monotonic() - start < HEALTH_MAX_S
    pg = Postgres()
    poll(lambda: not pg.rows(IDLE_TX_SQL), NEXT_UPLOAD_S, "no idle transaction")
    assert S3().keys(f"lines/{m['id']}/{ls['L01']['id']}/") == []
    assert get_lines(B, m["id"])["L01"]["file"]["state"] == "Awaiting upload"
    start = time.monotonic()
    ok(upload(T, ls["L01"], full), 201)
    assert time.monotonic() - start < NEXT_UPLOAD_S
    free(B, "v-gannet")


def test_wf_storage_outage_launch_list(browser):
    B = minio_down_url()
    poll(lambda: ok(api(B, TAMSIN).get("/api/status"))["storage"] == "down", STATUS_S + SLACK_S, "storage down")
    with screen(browser, B, TAMSIN, "/launch", size=(375, 812)) as page:
        expect(page.get_by_role("heading", name="Launch list", level=1)).to_be_visible()
        banner = page.get_by_role("status", name="Service status")
        expect(banner).to_have_text("Line-file storage is unreachable — uploads are paused and will resume on their own.")
        advance(page, STATUS_S * 1000)
        expect(banner).to_have_text("Line-file storage is unreachable — uploads are paused and will resume on their own.")
        layout(page)
    assert ok(httpx.get(f"{B}/api/health", timeout=HTTP_S)) == {"status": "ok"}


def test_dp57_storage_outage_responses(app_url):
    B = minio_down_url()
    poll(lambda: ok(api(B, TAMSIN).get("/api/status"))["storage"] == "down", STATUS_S + SLACK_S, "storage down")
    start = time.monotonic()
    assert ok(httpx.get(f"{B}/api/health", timeout=HTTP_S)) == {"status": "ok"}
    assert time.monotonic() - start < HEALTH_MAX_S
    m, ls = recovering(B)
    T, O = api(B, TAMSIN), api(B, ODILE)
    responses = [upload(T, ls["L01"], payload("L01")), T.get(f"/api/lines/{ls['L01']['id']}/file"),
                 O.get(f"/api/missions/{m['id']}/report"), O.get(f"/api/missions/{CALDER}/report")]
    for r in responses:
        assert r.status_code == 503 and r.json() == STORAGE_503 and r.headers["retry-after"] == RETRY_AFTER
    assert get_lines(B, m["id"])["L01"]["status"] == "Surveyed" and get_lines(B, m["id"])["L01"]["file"]["state"] == "Awaiting upload"
    free(B, "v-gannet")


def test_dp58_outage_errors_reveal_nothing(app_url):
    B = minio_down_url()
    poll(lambda: ok(api(B, TAMSIN).get("/api/status"))["storage"] == "down", STATUS_S + SLACK_S, "storage down")
    m, ls = recovering(B)
    tech, client = api(B, TAMSIN), api(B, ODILE)
    responses = [upload(tech, ls["L01"], payload("L01")), tech.get(f"/api/lines/{ls['L01']['id']}/file"),
                 client.get(f"/api/missions/{m['id']}/report")]
    for r in responses:
        err(r, 503, "storage_unavailable")
    leaks = ["127.0.0.1", ":9", "ECONNREFUSED", "S3ServiceException", "NetworkingError", "at /", ".ts:", ".js:"]
    if os.environ.get("S3_BUCKET"):
        leaks.append(os.environ["S3_BUCKET"])
    P = api(B, IRA)
    others = [
        (P.post("/api/plan-preview", content=b"depth=5", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type", ()),
        (P.get("/api/no-such-thing"), 404, "not_found", ()),
        (httpx.get(f"{B}/api/vessels", timeout=HTTP_S), 401, "unauthenticated", ()),
        (P.post("/api/plan-preview", json={"survey_area": "x"}), 422, "validation", ("errors",)),
        (P.post("/api/plan-preview", content=b"{not json", headers={"Content-Type": "application/json"}), None, None, None),
    ]
    for r, status, code, extra in others:
        if status:
            err(r, status, code, extra)
        else:
            assert r.status_code < 500 or r.json() == {"error": "internal", "message": "Something went wrong on the server."}
            assert set(r.json()) <= {"error", "message", "errors"}
    for r in responses + [o[0] for o in others]:
        blob = r.text + " ".join(f"{k}: {v}" for k, v in r.headers.items())
        assert "X-Powered-By".lower() not in {k.lower() for k in r.headers}
        assert not [x for x in leaks if x in blob], blob[:300]
    free(B, "v-gannet")


def test_dp59_held_upload_resumes_once(browser, app_url):
    B = app_url.rstrip("/")
    m, ls = recovering(B)
    data = {lab: payload(lab) for lab in ("L01", "X01")}
    fail, puts = {"on": True}, []
    with screen(browser, B, TAMSIN, "/launch") as page:
        page.route(STATUS_GLOB, lambda route: route.fulfill(status=200, content_type="application/json",
                   body=json.dumps({"storage": "down" if fail["on"] else "up", "mail": "up"})))

        def put_route(route):
            if route.request.method != "PUT":
                return route.continue_()
            puts.append(route.request.url)
            if fail["on"]:
                return route.fulfill(status=503, headers={"Retry-After": RETRY_AFTER}, content_type="application/json", body=json.dumps(STORAGE_503))
            route.continue_()

        page.route(FILE_GLOB, put_route)
        section = page.get_by_role("region", name=m["name"])
        dlg = page.get_by_role("dialog", name="Upload line file")

        def send(lab):
            L = {"<line>": lab}
            section.get_by_role("button", name=say(T_UPLOAD_BTN, L)).click()
            expect(dlg.get_by_role("textbox", name="SHA-256")).to_have_value("")
            assert dlg.get_by_label("Line file").evaluate("e => e.files.length") == 0
            dlg.get_by_label("Line file").set_input_files({"name": fname(lab), "mimeType": "application/octet-stream", "buffer": data[lab]})
            dlg.get_by_role("textbox", name="SHA-256").fill(sha(data[lab]))
            dlg.get_by_role("button", name="Upload").click()
            expect(dlg).to_contain_text(say(T_WAITING, L))
            expect(page.get_by_role("status", name="Launch status")).to_have_text(say(T_STORAGE_UPLOAD, L))
            expect(section).to_contain_text("Waiting for storage")

        send("L01")
        dlg.get_by_role("button", name="Cancel").click()
        gone(page, dlg)
        expect(section).not_to_contain_text("Waiting for storage")
        send("X01")
        dlg.get_by_role("button", name="Hide").click()
        focus_on(section.get_by_role("button", name=say(T_UPLOAD_BTN, {"<line>": "X01"})))
        send("L01")
        page.keyboard.press("Escape")
        gone(page, dlg)
        focus_on(section.get_by_role("button", name=say(T_UPLOAD_BTN, {"<line>": "L01"})))
        fail["on"] = False
        see(page, say(T_STORED, {"<line>": "L01"}), STATUS_S + SLACK_S)
        advance(page, STATUS_S * 1000)
        page.evaluate("0")
    l01 = [u for u in puts if ls["L01"]["id"] in u]
    x01 = [u for u in puts if ls["X01"]["id"] in u]
    assert len(l01) == 3 and len(x01) == 1
    now = get_lines(B, m["id"])
    assert now["L01"]["status"] == "Delivered" and now["X01"]["file"]["state"] == "Awaiting upload"
    assert S3().get(f"lines/{m['id']}/{ls['L01']['id']}/{fname('L01')}") == data["L01"]
    assert S3().keys(f"lines/{m['id']}/{ls['X01']['id']}/") == []
    free(B, "v-gannet")


def test_dp60_downloads_while_storage_down(browser, app_url):
    B = app_url.rstrip("/")
    m, ls, files = completed(B)
    state = {"storage": "down"}
    names = [say(T_DOWNLOAD, {"<line>": lab}) for lab in ls] + ["Download coverage report"]
    with screen(browser, B, ODILE, f"/surveys/{m['id']}") as page:
        page.route(STATUS_GLOB, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({**state, "mail": "up"})))
        advance(page, STATUS_POLL_MS + SECOND_MS)
        for name in names:
            btn = page.get_by_role("button", name=name)
            expect(btn).to_be_disabled()
            expect(btn).to_have_text("Storage unavailable")
            expect(page.get_by_role("link", name=name)).to_have_count(0)
        state["storage"] = "up"
        advance(page, STATUS_POLL_MS + SECOND_MS)
        for name in names:
            expect(page.get_by_role("link", name=name)).to_be_visible()


def test_wf_mission_completion(browser, app_url, mail):
    complete_from_launch_list(browser, app_url, mail, honest=False)


def test_dp62_complete_only_when_confirmed(browser, app_url, mail):
    complete_from_launch_list(browser, app_url, mail, honest=True)


def complete_from_launch_list(browser, app_url, mail, honest):
    B = app_url.rstrip("/")
    m, ls, files = delivered(B)
    G, M = {"<vessel>": "Gannet"}, {"<mission>": m["name"]}
    with screen(browser, B, TAMSIN, "/launch") as page:
        section, status = page.get_by_role("region", name=m["name"]), page.get_by_role("status", name="Launch status")
        expect(section).to_contain_text("Recovering")
        done = section.get_by_role("button", name="Mark mission complete")
        if honest:
            done.click()
            expect(status).to_have_text(say(T_RECOVER_ALL, {"<vessels>": "Gannet"}))
            focus_on(done)
            expect(section).to_contain_text("Recovering")
        section.get_by_role("button", name=say(T_MARK_RECOVERED_BTN, G)).click()
        expect(status).to_have_text(say(T_IS_RECOVERED, G))
        if honest:
            page.route(TRANSITION_GLOB, lambda route: route.abort())
            done.click()
            expect(status).to_have_text(say(T_NO_REACH_COMPLETE, M))
            expect(section).to_contain_text("Recovering")
            assert get_mission(B, m["id"])["status"] == "Recovering"
            page.unroute(TRANSITION_GLOB)
            with held(page, TRANSITION_GLOB) as h:
                done.click()
                expect(section.get_by_role("button", name="Completing…")).to_be_disabled()
                expect(section).not_to_contain_text("Complete")
                h.release()
        else:
            done.click()
        pattern = re.escape(say(T_COMPLETE, {**M, "<n>": "@N@"})).replace("@N@", r"(\d+)")
        until(page, "re => new RegExp(re).test(document.body.innerText)", pattern, WAIT_S)
        poll(lambda: get_mission(B, m["id"])["status"] == "Complete", WAIT_S, "mission Complete")
        open_names = [x["name"] for x in ok(api(B, TAMSIN).get("/api/missions"))
                      if x["id"] != m["id"] and x["status"] in ("Planned", "Launched", "Surveying", "Recovering")]
        expect(status).to_have_text(say(T_COMPLETE, {**M, "<n>": len(open_names)}))
        expect(section).to_contain_text("Complete")
        if honest:
            assert page.evaluate("document.activeElement.innerText.trim()") in open_names + ["Launch list"]
    assert get_mission(B, m["id"])["status"] == "Complete"
    if honest:
        return
    with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
        expect(page.get_by_role("region", name="Mission header")).to_contain_text("Complete")
    assert f"reports/{m['id']}/coverage-report.json" in S3().keys(f"reports/{m['id']}/")
    msgs = inbox(mail, say(T_SUBJ_REPORT, M), 1)
    assert [a for x in msgs for a in addresses(x["To"])] == [ODILE]


def report_case(B):
    m, ls, files = delivered(B, "v-kittiwake", {"X01": "v-gannet"}, org="org-saltmere")
    for vid in ("v-kittiwake", "v-gannet"):
        ok(api(B, TAMSIN).post(f"/api/vessels/{vid}/recovered", json={}))
    rs = parallel([lambda: transition(B, m["id"], "Complete", TAMSIN)] * 5)
    poll(lambda: get_mission(B, m["id"])["report"]["state"] == "Ready", WAIT_S, "report Ready")
    mission = get_mission(B, m["id"])
    key = f"reports/{m['id']}/coverage-report.json"
    raw = S3().get(key)
    free(B, "v-kittiwake", "v-gannet")
    return rs, mission, ls, key, raw, json.loads(raw)


def test_dp63_completion_once_and_in_order(app_url, mail):
    B = app_url.rstrip("/")
    rs, mission, ls, key, raw, rep = report_case(B)
    assert sorted(r.status_code for r in rs) == [200] + [409] * 4
    for r in rs:
        if r.status_code == 409:
            err(r, 409, "illegal_transition", ("from", "to"))
    assert (mission["status"], mission["report"]["state"]) == ("Complete", "Ready")
    assert S3().keys(f"reports/{mission['id']}/") == [key]
    subject = say(T_SUBJ_REPORT, {"<mission>": mission["name"]})
    inbox(mail, subject, 1)
    assert len([x for x in mail.messages(settle=5) if x.get("Subject") == subject]) == 1


def test_dp64_report_canonical_bytes(app_url):
    B = app_url.rstrip("/")
    rs, mission, ls, key, raw, rep = report_case(B)
    assert canon(rep).encode("utf-8") == raw
    assert list(rep) == ["mission_id", "mission_name", "client_name", "completed_at", "generated_at", "generated_at_local", "coverage_pct",
                         "open_holidays", "crossline_count", "crossline_agreement", "delivered_lines", "vessel_totals", "holidays"]
    m = mission
    assert (rep["mission_id"], rep["mission_name"], rep["client_name"]) == (m["id"], m["name"], "Saltmere Dredging Ltd")
    assert (rep["coverage_pct"], rep["open_holidays"], rep["crossline_count"]) == (m["counters"]["coverage_pct"], m["counters"]["open_holidays"], m["crossline_count"])
    assert list(rep["crossline_agreement"]) == ["compared", "within", "pct", "meets_order"] and rep["crossline_agreement"] == m["crossline_agreement"]
    assert rep["delivered_lines"] == [{"label": l["label"], "kind": l["kind"], "file_name": l["file"]["name"], "size_bytes": l["file"]["size_bytes"],
                                       "sha256": l["file"]["sha256"], "key": f"lines/{m['id']}/{l['id']}/{l['file']['name']}"} for l in ls.values()]
    hols = [h for h in ok(api(B, IRA).get(f"/api/missions/{m['id']}/holidays")) if h["status"] in ("Open", "Queued")]
    assert rep["holidays"] == [{"label": h["label"], "area_m2": h["area_m2"], "cell_count": h["cell_count"]} for h in hols]
    for _ in range(2):
        r = api(B, BRAM).get(f"/api/missions/{m['id']}/report")
        ok(r)
        assert r.content == raw and r.headers["x-content-sha256"] == sha(raw)
    assert S3().get(key) == raw


def test_dp65_report_time_zone_and_totals(app_url):
    B = app_url.rstrip("/")
    rs, mission, ls, key, raw, rep = report_case(B)
    done = parse(mission["completed_at"]).replace(microsecond=0)
    local = done.astimezone(ZoneInfo("Europe/Amsterdam"))
    assert rep["completed_at"] == mission["completed_at"] and rep["generated_at"] == iso(done)
    assert rep["generated_at_local"] == local.replace(tzinfo=None).isoformat() + offset_str(local)
    totals = []
    for name in sorted({l["vessel_name"] for l in ls.values()}):
        mine = [l for l in ls.values() if l["vessel_name"] == name]
        totals.append({"vessel": name, "lines": len(mine), "length_m": float(r1(sum(l["length_m"] for l in mine))), "covered_m": float(r1(sum(l["covered_m"] for l in mine)))})
    assert rep["vessel_totals"] == totals


def test_dp66_report_ready_email(app_url, mail):
    B = app_url.rstrip("/")
    rs, mission, ls, key, raw, rep = report_case(B)
    m = mission
    M = {"<mission>": m["name"]}
    subject = say(T_SUBJ_REPORT, M)
    inbox(mail, subject, 1)
    msgs = [x for x in mail.messages(settle=5) if x.get("Subject") == subject]
    assert len(msgs) == 1 and addresses(msgs[0]["To"]) == [BRAM] and not addresses(msgs[0].get("Cc") or []) and not addresses(msgs[0].get("Bcc") or [])
    body = text(msgs[0])
    done = parse(m["completed_at"]).replace(microsecond=0)
    local = done.astimezone(ZoneInfo("Europe/Amsterdam"))
    ag = rep["crossline_agreement"]
    fifth = say(T_R5, {"<coverage_pct>": canon(rep["coverage_pct"]), "<open_holidays>": rep["open_holidays"],
                       "<pct>": canon(ag["pct"]), "<compared>": ag["compared"]})
    if not ag["compared"]:
        fifth = fifth.split("Crossline agreement")[0] + "Crossline agreement —"
    expected = [say(T_R1, M), say(T_R2, {"<YYYY-MM-DD HH:MM>": ymdhm(local), "<offset>": offset_str(local)}),
                say(T_R3, {"<YYYY-MM-DD HH:MM>": ymdhm(done)}), say(T_R4, {"<hex>": sha(raw)}), fifth]
    lines = body.replace("\r\n", "\n").rstrip("\n").split("\n")
    assert len(lines) == 6
    assert lines[:5] == expected
    head, tail = T_R6.split("<APP_PUBLIC_URL>")
    assert lines[5].startswith(head) and lines[5].endswith(tail.replace("<mission id>", m["id"]))
    for leak in ("@fathomwright.test", ODILE, "Port of Calderhaven", "ik-", "thruster", "Calderhaven North Basin"):
        assert leak not in body and leak.encode() not in raw


def test_dp67_survey_vessel_filter(browser, app_url):
    B = app_url.rstrip("/")
    m, ls, files = delivered(B, "v-kittiwake", {"X01": "v-gannet"})
    with screen(browser, B, ODILE, f"/surveys/{m['id']}?vessel=v-gannet") as page:
        table = page.get_by_role("table", name="Line files")
        expect(table.get_by_role("row").filter(has_text="X01")).to_have_count(1)
        expect(table.get_by_role("row").filter(has_text="L01")).to_have_count(0)
        history = page.evaluate("history.length")
        pick(page.get_by_role("combobox", name="Vessel"), "Kittiwake")
        expect(table.get_by_role("row").filter(has_text="L01")).to_have_count(1)
        expect(table.get_by_role("row").filter(has_text="X01")).to_have_count(0)
        assert parse_qs(urlparse(page.url).query)["vessel"] == ["v-kittiwake"] and page.evaluate("history.length") == history
        pick(page.get_by_role("combobox", name="Vessel"), "All vessels")
        assert "vessel" not in parse_qs(urlparse(page.url).query)
        page.goto(f"{B}/surveys/{m['id']}?vessel=v-nowhere")
        expect(page.get_by_text("No such vessel on this survey")).to_be_visible()
        shows_choice(page.get_by_role("combobox", name="Vessel"), "All vessels")
        for lab in ("L01", "X01"):
            expect(table.get_by_role("row").filter(has_text=lab)).to_have_count(1)
    free(B, "v-kittiwake", "v-gannet")


def test_wf_client_review(browser, app_url):
    B = app_url.rstrip("/")
    m, ls, files = completed(B)
    metric(B, ODILE)
    with open_app(browser, f"{B}/surveys/{m['id']}") as page:
        page.wait_for_url(lambda u: urlparse(u).path == "/sign-in")
        login_form(page, ODILE)
        page.wait_for_url(lambda u: path_q(u) == f"/surveys/{m['id']}")
        mission = ok(api(B, ODILE).get(f"/api/missions/{m['id']}"))
        header = page.get_by_role("region", name="Mission header")
        assert num(header.get_by_role("group", name="Coverage").inner_text()) == Decimal(str(mission["counters"]["coverage_pct"]))
        expect(header.get_by_role("group", name="Crossline agreement")).to_be_visible()
        expect(page.get_by_role("list", name="Vessels")).to_contain_text("Gannet")
        expect(page.get_by_role("list", name="Vessels")).to_contain_text("Off survey")
        with page.expect_download() as d:
            page.get_by_role("link", name=say(T_DOWNLOAD, {"<line>": "L01"})).click()
        assert Path(d.value.path()).read_bytes() == files["L01"]
        with page.expect_download() as d:
            page.get_by_role("link", name="Download coverage CSV").click()
        assert Path(d.value.path()).read_bytes().startswith(b"mission,line,kind,vessel,status,length_m,covered_m,coverage_pct\r\n")
        with page.expect_download() as d:
            page.get_by_role("link", name="Download coverage report").click()
        assert Path(d.value.path()).read_bytes() == S3().get(f"reports/{m['id']}/coverage-report.json")


def test_dp72_download_recorded_bytes(browser, app_url):
    B = app_url.rstrip("/")
    m, ls, files = completed(B)
    r = ok(api(B, ODILE).get(f"/api/lines/{ls['L01']['id']}/file"))
    assert r.content == files["L01"] == S3().get(f"lines/{m['id']}/{ls['L01']['id']}/{fname('L01')}")
    assert r.headers["x-content-sha256"] == sha(files["L01"]) and r.headers["content-type"] == "application/octet-stream"
    assert r.headers["content-disposition"] == say(T_DISPOSITION, {"<file name>": fname("L01")})
    with screen(browser, B, ODILE, f"/surveys/{m['id']}") as page:
        line_row = page.get_by_role("table", name="Line files").get_by_role("row").filter(has_text="L01")
        expect(line_row).to_contain_text(say(T_SHA_ROW, {"<sha256>": sha(files["L01"])}))


def test_dp69_client_isolation(browser, app_url):
    B = app_url.rstrip("/")
    Bm, P = api(B, BRAM), api(B, IRA)
    line = get_lines(B, CALDER)["L01"]
    hol = f"/api/missions/{CALDER}/holidays"
    for path in (f"/api/missions/{CALDER}", f"/api/missions/{CALDER}/lines", hol, f"/api/missions/{CALDER}/coverage",
                 f"/api/missions/{CALDER}/coverage.csv", f"/api/missions/{CALDER}/tracks", f"/api/missions/{CALDER}/report",
                 f"/api/lines/{line['id']}/file", f"/api/missions/{CALDER}/vessels/v-gannet/infill-order"):
        err(Bm.get(path), 404, "not_found")
    assert CALDER not in Bm.get("/api/missions").text
    err(Bm.put(f"/api/lines/{line['id']}/file", content=b"x", headers={"Content-Type": "application/octet-stream", "X-Line-File-Name": "a.raw", "X-Content-SHA256": sha(b"x")}), 404, "not_found")
    m = create(B)
    err(assign(B, m["id"], {get_lines(B, m["id"])["L01"]["id"]: "v-nowhere"}), 404, "not_found")
    err(assign(B, m["id"], {"line-nowhere": "v-gannet"}), 404, "not_found")
    err(P.post("/api/missions", json={"name": mname(), "client_org_id": "org-nowhere", "survey_date": SURVEY_DATE,
                                      "survey_area": pts(AREA), "geofence": pts(FENCE), "planned_depth_m": 5}), 404, "not_found")
    with screen(browser, B, BRAM, "/surveys") as page:
        for path in (f"/surveys/{CALDER}", "/fleet", "/no-such-screen"):
            page.goto(B + path)
            expect(page.get_by_role("heading", name="Page not found")).to_be_visible()
            expect(page.get_by_text("That page does not exist or is not shared with you.")).to_be_visible()
            assert "Calderhaven" not in page.inner_text("body")


def test_dp70_client_scope(app_url):
    client_scope(app_url, projection=False)


def test_dp71_client_projection(app_url):
    client_scope(app_url, projection=True)


def client_scope(app_url, projection):
    B = app_url.rstrip("/")
    a, la = launched(B, "v-kittiwake", area=TINY)
    survey(B, "v-kittiwake", la["L01"], depth=2.5)
    O = api(B, ODILE)
    if projection:
        am = ok(O.get(f"/api/missions/{a['id']}"))
        assert am["vessels"][0]["link_state"] in ("Live", "Stale", "Lost") and set(am["vessels"][0]) == {"id", "name", "link_state"}
        hols = ok(O.get(f"/api/missions/{a['id']}/holidays"))
        assert hols and all(h["nearest_vessel"] is None for h in hols)
    ok(transition(B, a["id"], "Aborted"))
    far = [(5000, 9000), (5020, 9000), (5020, 9060), (5000, 9060)]
    b, lb = launched(B, "v-kittiwake", org="org-saltmere", area=far, fence=[(4900, 8900), (5100, 8900), (5100, 9200), (4900, 9200)])
    survey(B, "v-kittiwake", lb["L01"])
    paths = [f"/api/missions/{a['id']}", f"/api/missions/{a['id']}/lines", f"/api/missions/{a['id']}/tracks", f"/api/missions/{a['id']}/holidays",
             f"/api/missions/{a['id']}/coverage", "/api/missions", f"/api/missions/{a['id']}/coverage.csv", "/api/me", "/api/status"]
    for path in paths:
        r = O.get(path)
        ok(r)
        txt = r.text
        if not projection:
            assert b["id"] not in txt and b["name"] not in txt and "Saltmere" not in txt
        elif "json" in r.headers.get("content-type", ""):
            assert not [k for k in walk_keys(r.json()) if any(w in k for w in ("thruster", "service", "ingest", "acknowledged"))], path
    if projection:
        assert ok(O.get(f"/api/missions/{a['id']}"))["vessels"][0]["link_state"] is None
    else:
        tracks = ok(O.get(f"/api/missions/{a['id']}/tracks"))["tracks"]
        assert tracks and all(p["easting"] <= 20 and p["northing"] <= 60 for tr in tracks for p in tr["points"])
    free(B, "v-kittiwake")


def test_dp73_surveys_paging(browser, app_url):
    B = app_url.rstrip("/")
    for _ in range(PAGE_SIZE + 1):
        create(B, org="org-saltmere")
    order = [m["name"] for m in ok(api(B, BRAM).get("/api/missions"))]
    total = len(order)
    with screen(browser, B, BRAM, "/surveys") as page:
        expect(page.get_by_role("heading", name="Your surveys")).to_be_visible()
        expect(page.get_by_text(say(T_SHOWING, {"<shown>": PAGE_SIZE, "<total>": total}))).to_be_visible()
        links = page.get_by_role("table", name="Surveys").get_by_role("link")
        expect(links).to_have_count(PAGE_SIZE)
        assert links.all_inner_texts() == order[:PAGE_SIZE]
        page.get_by_role("button", name="Load more surveys").click()
        shown = min(2 * PAGE_SIZE, total)
        expect(page.get_by_role("status", name="Survey list")).to_have_text(say(T_SHOWING, {"<shown>": shown, "<total>": total}))
        expect(links).to_have_count(shown)
        assert links.all_inner_texts() == order[:shown]
        focus_on(links.nth(PAGE_SIZE))
        if shown == total:
            expect(page.get_by_role("button", name="Load more surveys")).to_have_count(0)


def test_dp74_units(browser, app_url):
    B = app_url.rstrip("/")
    free(B, "v-kittiwake")
    m = create(B)
    fix(B, "v-kittiwake", 100.0, 200.0, speed=2.0)
    try:
        with screen(browser, B, IRA, "/fleet/v-kittiwake") as page:
            units = page.get_by_role("radiogroup", name="Units")
            expect(units.get_by_role("radio", name="Metric")).to_be_checked()
            expect(card(page, "v-kittiwake")).to_contain_text(en(100.0, 200.0))
            check(units.get_by_role("radio", name="Imperial"))
            expect(card(page, "v-kittiwake")).to_contain_text(en(100 / FT, 200 / FT))
            expect(card(page, "v-kittiwake")).to_contain_text(f"{r1(2 / KN)} kn")
            assert ok(api(B, IRA).get("/api/me"))["units"] == "imperial"
        assert vessel(B, "v-kittiwake")["last_fix"]["position"] == {"easting": 100.0, "northing": 200.0}
        assert f",{r1(get_lines(B, m['id'])['L01']['length_m'])}," in ok(api(B, IRA).get(f"/api/missions/{m['id']}/coverage.csv")).text
    finally:
        metric(B, IRA)


def test_dp75_breakpoints(browser, app_url):
    B = app_url.rstrip("/")
    m = create(B)
    for size in ((1280, 800), (768, 1024), (375, 812)):
        with screen(browser, B, IRA, f"/missions/{m['id']}", size=size) as page:
            fleet, chart = page.get_by_role("region", name="Fleet"), page.get_by_role("region", name="Survey chart")
            lines = page.get_by_role("table", name="Lines")
            fb, cb = fleet.bounding_box(), chart.bounding_box()
            if size[0] == 1280:
                lb = lines.bounding_box()
                assert fb["x"] < cb["x"] < lb["x"] and inside_viewport(page, chart)
                expect(page.get_by_role("button", name="Mission detail")).to_have_count(0)
            elif size[0] == 768:
                assert fb["x"] < cb["x"]
                expect(page.get_by_role("button", name="Mission detail")).to_be_visible()
                expect(lines).to_have_count(0)
            else:
                assert cb["y"] + cb["height"] <= lines.bounding_box()["y"] + 0.5
                ch = page.get_by_role("application", name="Coverage chart").bounding_box()["height"]
                assert CHART_MIN_PX <= ch <= size[1] / 2
                expect(page.get_by_role("button", name="Mission detail")).to_have_count(0)
            layout(page)
    with screen(browser, B, IRA, "/fleet") as page:
        expect(page.get_by_role("region", name="Detail")).to_contain_text("Select a vessel")


def test_dp76_keyboard_dialogs(browser, app_url):
    B = app_url.rstrip("/")
    free(B, "v-kittiwake")
    inside = "d => d.contains(document.activeElement)"
    with screen(browser, B, TAMSIN, "/launch") as page:
        opener = page.get_by_role("region", name="Fleet service").get_by_role("button", name=say(T_LOG_SERVICE_BTN, {"<vessel>": "Kittiwake"}))
        opener.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Log thruster service")
        focus_on(dlg.get_by_role("textbox", name="Service note"))
        page.keyboard.press("Shift+Tab")
        assert dlg.evaluate(inside)
        for _ in range(6):
            page.keyboard.press("Tab")
            assert dlg.evaluate(inside)
        page.keyboard.press("Escape")
        gone(page, dlg)
        focus_on(opener)
    m = create(B)
    with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
        page.get_by_role("application", name="Coverage chart").focus()
        e0, n0 = readout(page)
        page.get_by_role("button", name="Zoom in").focus()
        page.keyboard.press(UP)
        e1, n1 = readout(page)
        assert abs(n1 - n0 - LENS_STEP_M) < READ_TOL and abs(e1 - e0) < READ_TOL


def test_dp77_touch_chart(browser, app_url):
    B = app_url.rstrip("/")
    m = create(B)
    with screen(browser, B, IRA, f"/missions/{m['id']}", size=(375, 812)) as page:
        chart = page.get_by_role("application", name="Coverage chart")
        chart.scroll_into_view_if_needed()
        tap(chart)
        advance(page, 100)
        lens_shown(page)
        expect(page.get_by_role("group", name="Lens readout")).to_contain_text("E ")
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 2})
        page.get_by_role("button", name="Zoom in").click()
        before = decode(capture(chart))
        grip, step = 150, 10
        dispatch = "Input.dispatchTouchEvent"
        box = chart.bounding_box()
        x, y = box["x"] + grip, box["y"] + grip
        cdp.send(dispatch, {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for i in range(1, 9):
            cdp.send(dispatch, {"type": "touchMove", "touchPoints": [{"x": x + step * i, "y": y}]})
        cdp.send(dispatch, {"type": "touchEnd", "touchPoints": []})
        advance(page, 500)
        changed(before, decode(capture(chart)))
        assert page.evaluate("window.scrollX") == 0
        layout(page)


def test_dp78_no_decorative_loops(browser, app_url):
    B = app_url.rstrip("/")
    m, _ = launched(B, "v-gannet", area=TINY, launch=False)
    ok(api(B, TAMSIN).post(vpath("v-gannet", "/recovered"), json={}))
    endless = "() => document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity).length"
    for email, path in ((IRA, "/fleet"), (IRA, f"/missions/{m['id']}"), (TAMSIN, "/launch")):
        with screen(browser, B, email, path) as page:
            advance(page, 3 * SECOND_MS)
            assert page.evaluate(endless) == 0
            poll(lambda: page.evaluate("() => document.getAnimations().filter(a => a.playState === 'running').length") == 0, 5, path)
            if path == "/launch":
                section = page.get_by_role("region", name=m["name"])
                with held(page, route_of(vpath("v-gannet", "/afloat"))) as h:
                    section.get_by_role("button", name=say(T_MARK_AFLOAT_BTN, {"<vessel>": "Gannet"})).click()
                    expect(section.get_by_role("button", name="Marking…")).to_be_visible()
                    assert page.evaluate(endless) == 0
                    h.release()
    free(B, "v-gannet")


def test_dp81_health(app_url):
    r = httpx.get(f"{app_url.rstrip('/')}/api/health", timeout=HTTP_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_dp82_seed_records(app_url):
    for base in (app_url.rstrip("/"), minio_down_url()):
        assert [(v["id"], v["name"]) for v in ok(api(base, IRA).get("/api/vessels"))] == [(v, VNAME[v]) for v in SEED_ORDER]
        orgs = {o["id"]: (o["name"], o["time_zone"]) for o in ok(api(base, IRA).get("/api/client-orgs"))}
        assert orgs == {"org-calderhaven": ("Port of Calderhaven Authority", "Europe/London"), "org-saltmere": ("Saltmere Dredging Ltd", "Europe/Amsterdam")}
        for email, role in ((IRA, "principal_surveyor"), (WREN, "principal_surveyor"), (TAMSIN, "launch_technician"), (ODILE, "client_reviewer"), (BRAM, "client_reviewer")):
            me = ok(api(base, email).get("/api/me"))
            assert (me["name"], me["role"]) == (NAMES[email], role)
        ids = {m["id"] for m in ok(api(base, IRA).get("/api/missions"))}
        assert {CALDER, SALT} <= ids
    fresh_v = ok(api(minio_down_url(), IRA).get("/api/vessels"))
    assert {v["id"]: v["service_interval_h"] for v in fresh_v}["v-gannet"] in (300, INTERVAL_MAX)


def test_dp83_server_boundary(app_url):
    B = app_url.rstrip("/")
    P = api(B, IRA)

    def sized(n):
        base = json.dumps({"survey_area": pts(AREA), "planned_depth_m": 5, "pad": ""})
        return base[:-2] + "x" * (n - len(base)) + '"}'

    assert len(sized(JSON_MAX)) == JSON_MAX
    assert P.post("/api/plan-preview", content=sized(JSON_MAX), headers={"Content-Type": "application/json"}).status_code != 413
    err(P.post("/api/plan-preview", content=sized(JSON_MAX + 1), headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    line = get_lines(B, CALDER)["L01"]
    big = b"\0" * (FILE_MAX + 1)
    err(upload(api(B, TAMSIN), line, big, digest="0" * 64), 413, "payload_too_large")
    for path in ("/package.json", "/run.json", "/.env", "/package-lock.json", "/tsconfig.json", "/src/server.ts", "/THIRD_PARTY_NOTICES.md"):
        assert httpx.get(B + path, timeout=HTTP_S).status_code == 404, path
    evil = {"Origin": "http://evil.test"}
    for r in (httpx.get(f"{B}/api/health", headers=evil, timeout=HTTP_S), httpx.options(f"{B}/api/session", headers={**evil, "Access-Control-Request-Method": "POST"}, timeout=HTTP_S),
              httpx.get(f"{B}/", headers=evil, timeout=HTTP_S)):
        cors = "Access-Control-".lower()
        assert not [k for k in r.headers if k.lower().startswith(cors)] and "X-Powered-By".lower() not in {k.lower() for k in r.headers}
    index = httpx.get(f"{B}/", timeout=HTTP_S).text
    assets = [index] + [httpx.get(B + p, timeout=HTTP_S).text for p in set(re.findall(ASSET_RE, index))]
    secrets = [os.environ.get(k) for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL")]
    password = urlparse(os.environ.get("DATABASE_URL", "")).password
    for s in [x for x in secrets + [password] if x and len(x) >= 6]:
        assert not [a for a in assets if s in a]


T_SAVED_PHONE = "Saved on this phone — <n> waiting to send"
ROW_QUEUED = "Queued — will send when online"
T_WAITING_SEND = "Waiting to send (<n>)"
T_DISCARD = "Discard <vessel> <action>"
T_QUEUE_ITEM = "<vessel> · <action> · <HH:MM> UTC"
T_NOT_SENT = "Not sent — <API message>"
T_NOT_SENT_EARLIER = "Not sent — an earlier action for <vessel> was refused"
OFFLINE_FLAG = "__verifier_offline"
OFFLINE_SHIM = ("(() => Object.defineProperty(Navigator.prototype, 'onLine', {configurable: true, "
                "get() { return localStorage.getItem('" + OFFLINE_FLAG + "') !== '1'; }}))()")


def go_offline(page):
    page.evaluate("f => { localStorage.setItem(f, '1'); window.dispatchEvent(new Event('offline')); }", OFFLINE_FLAG)


def go_online(page):
    page.evaluate("f => { localStorage.removeItem(f); window.dispatchEvent(new Event('online')); }", OFFLINE_FLAG)


def offline_page(page):
    page.add_init_script(OFFLINE_SHIM)
    page.reload()
    expect(page.get_by_role("heading", name="Launch list", level=1)).to_be_visible()
    listen(page)


NOT_SENT_REC = """() => { window.__notSent = []; const grab = () => {
  for (const x of document.body.innerText.matchAll(/Not sent — [^\\n]*/g)) if (!window.__notSent.includes(x[0])) window.__notSent.push(x[0]); };
  new MutationObserver(grab).observe(document.body, {subtree: true, childList: true, characterData: true}); grab(); }"""
NOT_SENT_SEEN = "cs => (window.__notSent || []).some(t => cs.some(c => t.includes(c)))"


def offline_section(B):
    m, _ = launched(B, "v-kittiwake", {"L03": "v-petrel", "X01": "v-petrel"}, launch=False)
    for vid in ("v-kittiwake", "v-petrel"):
        ok(api(B, TAMSIN).post(vpath(vid, "/recovered"), json={}))
    return m


def offline_service(page, name, note):
    page.get_by_role("region", name="Fleet service").get_by_role("button", name=say(T_LOG_SERVICE_BTN, {"<vessel>": name})).click()
    dlg = page.get_by_role("dialog", name="Log thruster service")
    dlg.get_by_role("textbox", name="Service note").fill(note)
    dlg.get_by_role("button", name="Save service").click()
    advance(page, 300)
    if dlg.count():
        page.keyboard.press("Escape")
        gone(page, dlg)


def test_wf_offline_slipway_replay(browser, app_url):
    B = app_url.rstrip("/")
    m = offline_section(B)
    free(B, "v-gannet")
    set_interval(B, "v-petrel", INTERVAL_MIN)
    T = api(B, TAMSIN)
    counts = {vid: len(ok(T.get(vpath(vid, "/services")))) for vid in ("v-petrel", "v-gannet")}
    K, Pt, G = {"<vessel>": "Kittiwake"}, {"<vessel>": "Petrel"}, {"<vessel>": "Gannet"}
    note = "Impeller cleared at slipway"
    with screen(browser, B, TAMSIN, "/launch", size=(375, 812)) as page:
        offline_page(page)
        sent = []
        page.on("request", lambda r: sent.append((urlparse(r.url).path, r.headers.get("idempotency-key")))
                if r.method == "POST" and "/api/vessels/" in r.url else None)
        section, status = page.get_by_role("region", name=m["name"]), page.get_by_role("status", name="Launch status")
        go_offline(page)
        section.get_by_role("button", name=say(T_MARK_AFLOAT_BTN, K)).click()
        expect(status).to_have_text(say(T_SAVED_PHONE, {"<n>": 1}))
        expect(section).to_contain_text(ROW_QUEUED)
        section.get_by_role("button", name=say(T_MARK_AFLOAT_BTN, Pt)).click()
        expect(status).to_have_text(say(T_SAVED_PHONE, {"<n>": 2}))
        offline_service(page, "Petrel", note)
        expect(status).to_have_text(say(T_SAVED_PHONE, {"<n>": 3}))
        offline_service(page, "Gannet", note)
        expect(status).to_have_text(say(T_SAVED_PHONE, {"<n>": 4}))
        expect(page.get_by_role("button", name=say(T_WAITING_SEND, {"<n>": 4}))).to_be_visible()
        page.reload()
        expect(page.get_by_role("button", name=say(T_WAITING_SEND, {"<n>": 4}))).to_be_visible()
        listen(page)
        assert not sent and vessel(B, "v-kittiwake")["afloat"] is False
        refused = [say(T_NOT_SENT, {"<API message>": overdue_msg(vessel(B, "v-petrel"))}), say(T_NOT_SENT_EARLIER, Pt)]
        page.evaluate(NOT_SENT_REC)
        go_online(page)
        heard(page, say(T_IS_AFLOAT, K))
        heard(page, say(T_SERVICE_LOGGED, G))
        until(page, NOT_SENT_SEEN, refused, WAIT_S)
        gone(page, page.get_by_role("button", name=re.compile("^" + re.escape("Waiting to send"))))
    assert [p for p, _ in sent] == [vpath("v-kittiwake", "/afloat"), vpath("v-petrel", "/afloat"), vpath("v-gannet", "/services")]
    assert sent[2][1]
    assert vessel(B, "v-kittiwake")["afloat"] is True and vessel(B, "v-petrel")["afloat"] is False
    assert len(ok(T.get(vpath("v-petrel", "/services")))) == counts["v-petrel"]
    assert len(ok(T.get(vpath("v-gannet", "/services")))) == counts["v-gannet"] + 1
    free(B, "v-kittiwake", "v-petrel", "v-gannet")


def test_wf_offline_slipway_discard(browser, app_url):
    B = app_url.rstrip("/")
    m = offline_section(B)
    K, Pt = {"<vessel>": "Kittiwake"}, {"<vessel>": "Petrel"}
    with screen(browser, B, TAMSIN, "/launch", size=(375, 812)) as page:
        offline_page(page)
        sent = []
        page.on("request", lambda r: sent.append(urlparse(r.url).path) if r.method == "POST" and "/api/vessels/" in r.url else None)
        section = page.get_by_role("region", name=m["name"])
        go_offline(page)
        section.get_by_role("button", name=say(T_MARK_AFLOAT_BTN, K)).click()
        section.get_by_role("button", name=say(T_MARK_AFLOAT_BTN, Pt)).click()
        page.get_by_role("button", name=say(T_WAITING_SEND, {"<n>": 2})).click()
        dlg = page.get_by_role("dialog", name="Waiting to send")
        item = re.escape(say(T_QUEUE_ITEM, {**K, "<action>": "afloat", "<HH:MM>": "@"})).replace("@", r"\d{2}:\d{2}")
        expect(dlg).to_contain_text(re.compile(item))
        listed = dlg.inner_text()
        assert listed.index("Kittiwake") < listed.index("Petrel")
        dlg.get_by_role("button", name=say(T_DISCARD, {**Pt, "<action>": "afloat"})).click()
        expect(page.get_by_role("button", name=say(T_WAITING_SEND, {"<n>": 1}))).to_be_visible()
        if dlg.count():
            page.keyboard.press("Escape")
            gone(page, dlg)
        go_online(page)
        heard(page, say(T_IS_AFLOAT, K))
        gone(page, page.get_by_role("button", name=re.compile("^" + re.escape("Waiting to send"))))
    assert sent == [vpath("v-kittiwake", "/afloat")]
    assert vessel(B, "v-kittiwake")["afloat"] is True and vessel(B, "v-petrel")["afloat"] is False
    free(B, "v-kittiwake", "v-petrel")


T_NOT_OWNER = "Only <owner name> can do this for <mission>."
T_HANDED_SUBJ = "<mission> handed to you"
T_HANDED_BODY = "<previous owner> handed <mission> to you at <YYYY-MM-DD HH:MM> UTC."
T_HANDED_ANN = "<previous owner> handed <mission> to you"
T_HANDED_TO = "Handed <mission> to <name>"
T_OWNED_BY = "Owned by <owner name>"


def test_wf_mission_handover_api(app_url, mail):
    B = app_url.rstrip("/")
    P, W = api(B, IRA), api(B, WREN)
    m = create(B)
    assert (m["owner_id"], m["owner_name"], m["version"]) == ("u-ira", NAMES[IRA], 1)
    path = f"/api/missions/{m['id']}/handover"
    b = err(W.post(path, json={"to_user_id": "u-wren", "version": m["version"]}), 403, "not_mission_owner")
    assert b["message"] == say(T_NOT_OWNER, {"<owner name>": NAMES[IRA], "<mission>": m["name"]})
    err(W.post(f"/api/missions/{m['id']}/transitions", json={"to": "Launched"}), 403, "not_mission_owner")
    for target in ("u-tamsin", "u-ira"):
        assert err(P.post(path, json={"to_user_id": target, "version": m["version"]}), 422, "validation", ("errors",))["errors"]["to_user_id"] == "Choose another principal surveyor"
    stale = err(P.post(path, json={"to_user_id": "u-wren", "version": m["version"] + 5}), 409, "stale_version", ("current",))
    assert stale["current"]["version"] == m["version"] and stale["current"]["owner_id"] == "u-ira"
    rs = parallel([lambda: P.post(path, json={"to_user_id": "u-wren", "version": m["version"]})] * 4)
    codes = [r.status_code for r in rs]
    assert codes.count(200) == 1 and all(c in (403, 409) for c in codes if c != 200), codes
    after = get_mission(B, m["id"])
    assert (after["owner_id"], after["owner_name"], after["version"]) == ("u-wren", NAMES[WREN], m["version"] + 1)
    subject = say(T_HANDED_SUBJ, {"<mission>": m["name"]})
    inbox(mail, subject, 1)
    msgs = [x for x in mail.messages(settle=5) if x.get("Subject") == subject]
    assert len(msgs) == 1 and addresses(msgs[0]["To"]) == [WREN]
    line = re.escape(say(T_HANDED_BODY, {"<previous owner>": NAMES[IRA], "<mission>": m["name"], "<YYYY-MM-DD HH:MM>": "@"})).replace("@", r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}")
    assert re.search(line, text(msgs[0]))
    a, _ = launched(B, "v-gannet", area=TINY)
    ok(transition(B, a["id"], "Aborted"))
    err(P.post(f"/api/missions/{a['id']}/handover", json={"to_user_id": "u-wren", "version": 0}), 409, "mission_not_open")
    free(B, "v-gannet")


def test_wf_mission_handover_console(browser, app_url):
    B = app_url.rstrip("/")
    m = create(B)
    path = f"/missions/{m['id']}"
    with screen(browser, B, WREN, "/fleet") as wren, screen(browser, B, IRA, path) as ira:
        ira.get_by_role("button", name="Hand over", exact=True).click()
        dlg = ira.get_by_role("dialog", name="Hand over mission")
        pick(dlg.get_by_role("combobox", name="Surveyor"), NAMES[WREN])
        dlg.get_by_role("button", name="Hand over", exact=True).click()
        heard(ira, say(T_HANDED_TO, {"<mission>": m["name"], "<name>": NAMES[WREN]}))
        heard(wren, say(T_HANDED_ANN, {"<previous owner>": NAMES[IRA], "<mission>": m["name"]}), LINK_SCREEN_S + SLACK_S)
        gone(ira, dlg)
        assert path_q(ira.url) == path and path_q(wren.url) == "/fleet"
        for page in (ira,):
            page.reload()
            for name in ("Launch mission", "Hand over"):
                expect(page.get_by_role("button", name=name, exact=True)).to_be_disabled()
            expect(page.get_by_text(say(T_OWNED_BY, {"<owner name>": NAMES[WREN]})).first).to_be_visible()
    assert get_mission(B, m["id"])["owner_id"] == "u-wren"


RERUN_REASON = "Backscatter dropped mid-line"
T_RERUN_ADDED = "<new label> added — assign a vessel to run it"
T_RERUN_BTN = "Re-run <label>"


def test_wf_line_rerun_api(app_url):
    B = app_url.rstrip("/")
    P, T = api(B, IRA), api(B, TAMSIN)
    m, ls = launched(B, "v-gannet", area=TINY)
    orig = ls["L01"]
    survey(B, "v-gannet", orig, depth=2.5)
    files = {"L01": payload("L01"), "L01R1": payload("L01R1"), "X01": payload("X01")}
    ok(upload(T, orig, files["L01"]), 201)
    path = f"/api/missions/{m['id']}/lines/{orig['id']}/rerun"
    for bad in ("ab", "  ab  "):
        assert err(P.post(path, json={"reason": bad}), 422, "validation", ("errors",))["errors"]["reason"] == "Give a reason of 3 to 200 characters"
    err(api(B, WREN).post(path, json={"reason": RERUN_REASON}), 403, "not_mission_owner")
    before = get_mission(B, m["id"])
    assert before["counters"]["open_holidays"] >= 1
    rerun = ok(P.post(path, json={"reason": RERUN_REASON}), 201)["line"]
    assert (rerun["label"], rerun["kind"], rerun["status"], rerun["vessel_id"], rerun["rerun_of"]) == ("L01R1", "planned", "Pending", None, orig["id"])
    assert rerun["start"] == orig["start"] and rerun["end"] == orig["end"] and rerun["length_m"] == orig["length_m"]
    assert get_mission(B, m["id"])["counters"]["lines_remaining"] == before["counters"]["lines_remaining"] + 1
    labels = list(get_lines(B, m["id"]))
    assert labels.index("L01R1") == labels.index("L01") + 1
    err(P.post(path, json={"reason": RERUN_REASON}), 409, "rerun_open")
    cov_path = f"/api/missions/{m['id']}/coverage"
    cov0 = ok(P.get(cov_path))
    ok(assign(B, m["id"], {rerun["id"]: "v-gannet"}))
    survey(B, "v-gannet", get_lines(B, m["id"])["L01R1"], depth=5.0)
    cov1 = ok(P.get(cov_path))
    assert cov1["overlap"] == cov0["overlap"] and cov1["counters"]["coverage_pct"] == cov0["counters"]["coverage_pct"]
    ok(upload(T, get_lines(B, m["id"])["L01R1"], files["L01R1"]), 201)
    now = get_lines(B, m["id"])
    assert (now["L01"]["status"], now["L01"]["file"]["state"], now["L01R1"]["status"]) == ("Superseded", "Stored", "Delivered")
    cov2 = ok(P.get(cov_path))
    assert max(c for row in cov2["overlap"] for c in row) == 1
    assert cov2["counters"]["coverage_pct"] == 100 and cov2["counters"]["open_holidays"] == 0
    assert S3().get(f"lines/{m['id']}/{orig['id']}/{fname('L01')}") == files["L01"]
    err(upload(T, now["L01"], files["L01"] + b"!"), 409, "line_not_surveyed")
    rows = ok(P.get(f"/api/missions/{m['id']}/coverage.csv")).text.split("\r\n")
    assert next(r for r in rows if r.split(",")[1:2] == ["L01"]).split(",")[4] == "Superseded"
    survey(B, "v-gannet", now["X01"])
    ok(upload(T, now["X01"], files["X01"]), 201)
    assert get_mission(B, m["id"])["status"] == "Recovering"
    err(P.post(f"/api/missions/{m['id']}/lines/{now['X01']['id']}/rerun", json={"reason": RERUN_REASON}), 409, "mission_not_active")
    ok(T.post(vpath("v-gannet", "/recovered"), json={}))
    ok(transition(B, m["id"], "Complete", TAMSIN))
    poll(lambda: get_mission(B, m["id"])["report"]["state"] == "Ready", WAIT_S, "report Ready")
    rep = json.loads(S3().get(f"reports/{m['id']}/coverage-report.json"))
    assert [d["label"] for d in rep["delivered_lines"]] == ["L01", "L01R1", "X01"]
    assert [(v["vessel"], v["lines"]) for v in rep["vessel_totals"]] == [("Gannet", 2)]
    free(B, "v-gannet")


def test_wf_line_rerun_console(browser, app_url):
    B = app_url.rstrip("/")
    m, ls = launched(B, "v-gannet", area=TINY)
    survey(B, "v-gannet", ls["L01"])
    with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
        lines = page.get_by_role("table", name="Lines")
        lines.get_by_role("button", name=say(T_RERUN_BTN, {"<label>": "L01"})).click()
        dlg = page.get_by_role("dialog", name="Re-run line")
        dlg.get_by_role("textbox", name="Reason").fill(RERUN_REASON)
        dlg.get_by_role("button", name="Create re-run").click()
        heard(page, say(T_RERUN_ADDED, {"<new label>": "L01R1"}))
        focus_on(lines.get_by_role("row").filter(has_text="L01R1"))
    line = get_lines(B, m["id"])["L01R1"]
    assert (line["status"], line["rerun_of"]) == ("Pending", ls["L01"]["id"])
    free(B, "v-gannet")


FOCUSED_CELL = """() => { const c = document.activeElement && document.activeElement.closest('[role=gridcell]');
  return c ? [c.getAttribute('aria-rowindex'), c.getAttribute('aria-colindex'), c.innerText.trim()] : null; }"""
TAB_STOPS = "g => [...g.querySelectorAll('[role=gridcell]')].filter(c => c.tabIndex >= 0).length"
CELLS = "g => [...g.querySelectorAll('[role=gridcell]')].map(c => [c.hasAttribute('aria-rowindex') && c.hasAttribute('aria-colindex'), c.innerText.trim()])"


def test_wf_coverage_grid_keyboard(browser, app_url):
    B = app_url.rstrip("/")
    with infill_console(browser, B, reduced_motion="no-preference") as (page, m, west, east):
        cov = ok(api(B, IRA).get(f"/api/missions/{m['id']}/coverage"))
        rows, cols, origin = cov["rows"], cov["cols"], cov["origin"]
        toggle = page.get_by_role("button", name="View as table")
        toggle.click()
        expect(toggle).to_have_attribute("aria-pressed", "true")
        assert parse_qs(urlparse(page.url).query)["view"] == ["table"]
        grid = page.get_by_role("grid", name="Coverage table")
        expect(grid).to_have_attribute("aria-rowcount", str(rows))
        expect(grid).to_have_attribute("aria-colcount", str(cols))
        assert grid.evaluate(TAB_STOPS) == 1
        grid.get_by_role("gridcell").first.focus()
        page.keyboard.press("Control+Home")
        hole = f"{west['label']} 0"
        assert page.evaluate(FOCUSED_CELL) == ["1", "1", hole]
        lens_group = page.get_by_role("group", name="Lens readout")
        expect(lens_group).to_contain_text(en(origin["easting"] + CELL / 2, origin["northing"] + CELL * (rows - 1) + CELL / 2))
        expect(lens_group).to_contain_text(say(T_LENS_ROW, {"<holiday>": west["label"], "<area>": int(west["area_m2"])}))
        page.keyboard.press("Enter")
        heard(page, say(T_QUEUED, {"<line>": "I01", "<vessel>": "Kittiwake"}))
        assert next(h for h in ok(api(B, IRA).get(f"/api/missions/{m['id']}/holidays")) if h["id"] == west["id"])["status"] == "Queued"
        page.keyboard.press("End")
        assert page.evaluate(FOCUSED_CELL) == ["1", str(cols), "0"]
        page.keyboard.press("Enter")
        heard(page, "No holiday under the lens")
        page.keyboard.press(RIGHT)
        assert page.evaluate(FOCUSED_CELL)[:2] == ["1", str(cols)]
        page.keyboard.press("Control+End")
        assert page.evaluate(FOCUSED_CELL)[:2] == [str(rows), str(cols)]
        page.keyboard.press(DOWN)
        assert page.evaluate(FOCUSED_CELL)[:2] == [str(rows), str(cols)]
        page.keyboard.press("Home")
        assert page.evaluate(FOCUSED_CELL) == [str(rows), "1", hole]
        assert sum(1 for l in get_lines(B, m["id"]).values() if l["kind"] == "infill") == 1


def test_wf_coverage_grid_phone(browser, app_url):
    B = app_url.rstrip("/")
    m = create(B)
    with screen(browser, B, IRA, f"/missions/{m['id']}?view=table", size=(375, 812)) as page:
        toggle = page.get_by_role("button", name="View as table")
        expect(toggle).to_have_attribute("aria-pressed", "true")
        grid = page.get_by_role("grid", name="Coverage table")
        expect(grid).to_be_visible()
        cells = grid.evaluate(CELLS)
        assert cells and all(indexed for indexed, _ in cells) and {t for _, t in cells} == {"0"}
        assert grid.evaluate(TAB_STOPS) == 1
        layout(page)
        toggle.click()
        expect(page.get_by_role("application", name="Coverage chart")).to_be_visible()
        assert "view" not in parse_qs(urlparse(page.url).query)


HISTORY_PAGE = 50
HISTORY_SAVES = HISTORY_PAGE + 2
T_HISTORY = "History of <mission>"
T_EVENT = "<YYYY-MM-DD HH:MM:SS> UTC · <actor> · <summary>"
T_SHOWING_EVENTS = "Showing <shown> events"
ASSIGNED_ONE = "Assignments saved (1 lines)"


def history_mission(B):
    free(B, "v-gannet")
    m = create(B)
    l01 = get_lines(B, m["id"])["L01"]["id"]
    for i in range(HISTORY_SAVES):
        ok(assign(B, m["id"], {l01: None if i % 2 else "v-gannet"}))
    return m


def event_re(actor, summary):
    return re.escape(say(T_EVENT, {"<YYYY-MM-DD HH:MM:SS>": "@", "<actor>": actor, "<summary>": summary})).replace("@", r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")


def test_wf_mission_history_api(app_url):
    B = app_url.rstrip("/")
    m = history_mission(B)
    T = api(B, TAMSIN)
    path = f"/api/missions/{m['id']}/history"
    ca = "created,assignments"
    first = ok(T.get(path, params={"kinds": ca}))
    assert len(first["events"]) == HISTORY_PAGE and first["next"]
    keys = [(parse(e["at"]), e["seq"]) for e in first["events"]]
    assert keys == sorted(keys, reverse=True)
    assert all((e["kind"], e["actor"], e["summary"]) == ("assignments", NAMES[IRA], ASSIGNED_ONE) for e in first["events"])
    second = ok(T.get(path, params={"kinds": ca, "before": first["next"]}))
    assert second["next"] is None and len(second["events"]) == HISTORY_SAVES + 1 - HISTORY_PAGE
    last = second["events"][-1]
    assert (last["kind"], last["actor"], last["summary"]) == ("created", NAMES[IRA], "Mission created")
    assert not {e["seq"] for e in first["events"]} & {e["seq"] for e in second["events"]}
    only = ok(T.get(path, params={"kinds": "created"}))
    assert [e["summary"] for e in only["events"]] == ["Mission created"]
    assert len(ok(T.get(path, params={"kinds": "created,assignments"}))["events"]) == HISTORY_PAGE
    assert err(T.get(path, params={"kinds": "weather"}), 422, "validation", ("errors",))["errors"]["kinds"] == "Choose kinds from the published list"
    err(api(B, ODILE).get(path), 403, "forbidden")
    free(B, "v-gannet")


def test_wf_mission_history_screen(browser, app_url):
    B = app_url.rstrip("/")
    m = history_mission(B)
    path = f"/missions/{m['id']}/history"
    with screen(browser, B, TAMSIN, path) as page:
        page.goto(f"{B}{path}?kinds=created,assignments")
        expect(page.get_by_role("heading", name=say(T_HISTORY, {"<mission>": m["name"]}), level=1)).to_be_visible()
        events = page.get_by_role("list", name="Mission events").get_by_role("listitem")
        status = page.get_by_role("status", name="History status")
        expect(events).to_have_count(HISTORY_PAGE)
        expect(status).to_have_text(say(T_SHOWING_EVENTS, {"<shown>": HISTORY_PAGE}))
        expect(events.first).to_have_text(re.compile(event_re(NAMES[IRA], ASSIGNED_ONE)))
        more = page.get_by_role("button", name="Load older events")
        more.focus()
        page.keyboard.press("Enter")
        expect(events).to_have_count(HISTORY_SAVES + 1)
        expect(status).to_have_text(say(T_SHOWING_EVENTS, {"<shown>": HISTORY_SAVES + 1}))
        poll(lambda: events.nth(HISTORY_PAGE).evaluate("e => e.contains(document.activeElement)"), WAIT_S, "focus on the first older event")
        expect(more).to_have_count(0)
        expect(events.last).to_have_text(re.compile(event_re(NAMES[IRA], "Mission created")))
        page.goto(f"{B}{path}?kinds=created")
        expect(events).to_have_count(1)
        kinds = page.get_by_role("group", name="Event kinds")
        expect(kinds.get_by_role("checkbox", name="Created")).to_be_checked()
        expect(kinds.get_by_role("checkbox", name="Assignments")).not_to_be_checked()
    free(B, "v-gannet")


HOLD_REASON = "Swell above launch limit"


def quiet_link_lost(B, mid):
    deadline = time.monotonic() + LINK_SCREEN_S + SLACK_S
    while time.monotonic() < deadline:
        assert not alerts(B, mid, "link_lost"), "link-lost alert raised while held"
        threading.Event().wait(POLL_S * 4)


def test_wf_weather_hold_api(app_url):
    B = app_url.rstrip("/")
    P = api(B, IRA)
    m, ls = launched(B, "v-gannet", area=TINY)
    hold, resume = f"/api/missions/{m['id']}/hold", f"/api/missions/{m['id']}/resume"
    err(P.post(hold, json={"reason": HOLD_REASON}), 409, "mission_not_surveying")
    fix(B, "v-gannet", *INSIDE)
    ok(line_cmd(B, "v-gannet", ls["L01"]["id"], "start"))
    err(P.post(hold, json={"reason": HOLD_REASON}), 409, "line_running")
    ok(line_cmd(B, "v-gannet", ls["L01"]["id"], "end"))
    assert err(P.post(hold, json={"reason": "ab"}), 422, "validation", ("errors",))["errors"]["reason"] == "Give a reason of 3 to 120 characters"
    err(api(B, WREN).post(hold, json={"reason": HOLD_REASON}), 403, "not_mission_owner")
    err(P.post(resume, json={}), 409, "mission_not_on_hold")
    assert ok(P.post(hold, json={"reason": HOLD_REASON}))["hold"]["reason"] == HOLD_REASON
    err(P.post(hold, json={"reason": HOLD_REASON}), 409, "mission_on_hold")
    err(line_cmd(B, "v-gannet", ls["X01"]["id"], "start"), 409, "mission_on_hold")
    fix(B, "v-gannet", *OUTSIDE)
    assert len(alerts(B, m["id"], "geofence_breach")) == 1
    fix(B, "v-gannet", *INSIDE)
    poll(lambda: vessel(B, "v-gannet")["link_state"] == "Lost", LOST_S + SLACK_S, "Lost while held")
    quiet_link_lost(B, m["id"])
    assert ok(P.post(resume, json={}))["hold"] is None
    poll(lambda: alerts(B, m["id"], "link_lost"), LINK_SCREEN_S + SLACK_S, "link-lost alert after resume")
    free(B, "v-gannet")


def test_wf_weather_hold_console(browser, app_url):
    B = app_url.rstrip("/")
    m, ls = launched(B, "v-gannet", area=TINY)
    survey(B, "v-gannet", ls["L01"])
    G = {"<vessel>": "Gannet"}
    with screen(browser, B, IRA, f"/missions/{m['id']}") as page:
        page.clock.set_system_time(datetime(2031, 6, 1, tzinfo=timezone.utc))
        header = page.get_by_role("region", name="Mission header")
        page.get_by_role("button", name="Hold for weather").click()
        dlg = page.get_by_role("dialog", name="Hold for weather")
        dlg.get_by_role("textbox", name="Reason").fill(HOLD_REASON)
        dlg.get_by_role("button", name="Hold survey").click()
        heard(page, "Survey held")
        expect(header).to_contain_text(f"On hold: {HOLD_REASON}")
        assert get_mission(B, m["id"])["hold"]["reason"] == HOLD_REASON
        poll(lambda: vessel(B, "v-gannet")["link_state"] == "Lost", LOST_S + SLACK_S, "Lost while held")
        quiet_link_lost(B, m["id"])
        header.get_by_role("button", name="Resume survey").click()
        heard(page, "Survey resumed")
        heard(page, say(T_LINK_LOST, G), LINK_SCREEN_S + SLACK_S)
        expect(header).not_to_contain_text("On hold:")
    assert get_mission(B, m["id"])["hold"] is None and alerts(B, m["id"], "link_lost")
    free(B, "v-gannet")


T_FLAG_SUBJ = "<client> flagged <label> on <mission>"
T_REPLY_SUBJ = "Reply on <label> for <mission>"
T_FLAG_BTN = "Flag <label>"
T_FLAG_SENT = "Flag sent for <label>"
T_FLAG_ITEM = "<client> · <mission> · <label> · <comment>"
T_REPLY_BTN = "Reply to <label>"
T_REPLY_SENT = "Reply sent for <label>"
CALDER_ORG = "Port of Calderhaven Authority"


def test_wf_client_flags_api(app_url, mail):
    B = app_url.rstrip("/")
    m, ls, files = delivered(B)
    O, P = api(B, ODILE), api(B, IRA)
    path = f"/api/missions/{m['id']}/lines/{ls['L01']['id']}/flags"
    comment, reply = unique("Depth step near")[0], unique("Checked against tide")[0]
    err(api(B, BRAM).post(path, json={"comment": comment}), 404, "not_found")
    err(P.post(path, json={"comment": comment}), 403, "forbidden")
    pending = create(B)
    err(O.post(f"/api/missions/{pending['id']}/lines/{get_lines(B, pending['id'])['L01']['id']}/flags", json={"comment": comment}), 409, "line_not_delivered")
    for bad in ("   ", "x" * (NOTE_MAX + 1)):
        assert err(O.post(path, json={"comment": bad}), 422, "validation", ("errors",))["errors"]["comment"] == "Write a comment of 1 to 500 characters"
    flag = ok(O.post(path, json={"comment": comment}), 201)
    assert (flag["line_label"], flag["comment"], flag["state"], flag["reply"]) == ("L01", comment, "Open", None)
    assert [f["id"] for f in ok(P.get("/api/flags?state=open")) if f["comment"] == comment] == [flag["id"]]
    err(O.get("/api/flags"), 403, "forbidden")
    answered = ok(P.post(f"/api/flags/{flag['id']}/reply", json={"text": reply}))
    assert answered["state"] == "Answered"
    err(P.post(f"/api/flags/{flag['id']}/reply", json={"text": reply}), 409, "flag_answered")
    assert flag["id"] not in {f["id"] for f in ok(P.get("/api/flags?state=open"))}
    subject = say(T_FLAG_SUBJ, {"<client>": CALDER_ORG, "<label>": "L01", "<mission>": m["name"]})
    inbox(mail, subject, 2)
    staff = [x for x in mail.messages(settle=5) if x.get("Subject") == subject]
    assert sorted(a for x in staff for a in addresses(x["To"])) == sorted([IRA, WREN])
    for x in staff:
        body = text(x).replace("\r\n", "\n").split("\n")
        assert comment in body and any(l.rstrip().endswith("/flags") for l in body)
    rsubject = say(T_REPLY_SUBJ, {"<label>": "L01", "<mission>": m["name"]})
    inbox(mail, rsubject, 1)
    back = [x for x in mail.messages(settle=5) if x.get("Subject") == rsubject]
    assert len(back) == 1 and addresses(back[0]["To"]) == [ODILE]
    body = text(back[0])
    lines = body.replace("\r\n", "\n").split("\n")
    assert reply in lines and any(l.rstrip().endswith(f"/surveys/{m['id']}") for l in lines)
    assert "@fathomwright.test" not in body
    free(B, "v-gannet")


def test_wf_client_flags_screens(browser, app_url):
    B = app_url.rstrip("/")
    m, ls, files = delivered(B)
    comment = unique("Soundings shifted east")[0]
    reply = unique("Re-checked offsets")[0]
    with screen(browser, B, ODILE, f"/surveys/{m['id']}") as page:
        table = page.get_by_role("table", name="Line files")
        table.get_by_role("button", name=say(T_FLAG_BTN, {"<label>": "X01"})).click()
        dlg = page.get_by_role("dialog", name="Flag line")
        dlg.get_by_role("textbox", name="Comment").fill(comment)
        expect(dlg.get_by_role("status", name="Comment length")).to_have_text(f"{len(comment)}/500")
        dlg.get_by_role("button", name="Send flag").click()
        heard(page, say(T_FLAG_SENT, {"<label>": "X01"}))
        expect(table.get_by_role("row").filter(has_text="X01")).to_contain_text("Flagged")
    flag = next(f for f in ok(api(B, IRA).get("/api/flags?state=open")) if f["comment"] == comment)
    assert flag["line_label"] == "X01"
    with screen(browser, B, IRA, "/fleet") as page:
        page.get_by_role("link", name=re.compile("^" + re.escape("Client flags (") + r"\d+\)$")).click()
        page.wait_for_url(lambda u: urlparse(u).path == "/flags")
        expect(page.get_by_role("heading", name="Client flags", level=1)).to_be_visible()
        item = page.get_by_role("list", name="Open flags").get_by_role("listitem").filter(has_text=comment)
        expect(item).to_contain_text(say(T_FLAG_ITEM, {"<client>": CALDER_ORG, "<mission>": m["name"], "<label>": "X01", "<comment>": comment}))
        item.get_by_role("button", name=say(T_REPLY_BTN, {"<label>": "X01"})).click()
        dlg = page.get_by_role("dialog", name="Reply to flag")
        dlg.get_by_role("textbox", name="Reply").fill(reply)
        dlg.get_by_role("button", name="Send reply").click()
        expect(page.get_by_role("status", name="Flags status")).to_have_text(say(T_REPLY_SENT, {"<label>": "X01"}))
        expect(item).to_have_count(0)
    assert next(f for f in ok(api(B, IRA).get("/api/flags", params={"state": "all"})) if f["id"] == flag["id"])["state"] == "Answered"
    free(B, "v-gannet")


T_SELECTED = "<n> lines selected"
T_BULK = "Assigned <n> lines to <vessel> — Undo available for 10 seconds"
T_UNDID = "Undid assignment of <n> lines"
T_SELECT_BOX = "Select <label>"
UNDO_MS = 10 * SECOND_MS


def release(route):
    try:
        route.continue_()
        route.request.response()
    except Exception:
        pass


def focus_on(locator, seconds=WAIT_S):
    page, end = locator.page, time.monotonic() + seconds
    while not (locator.count() and locator.first.evaluate("e => e === document.activeElement")):
        assert time.monotonic() < end, "element never took focus"
        page.clock.run_for(FRAME_MS)


def moving(locator):
    return [a for a in animations(locator) if a.get("playState") == "running" and float(a.get("duration") or 0) > 1]


def bulk_assign(page, labels, vessel_name):
    table = page.get_by_role("table", name="Line plan")
    boxes = [table.get_by_role("checkbox", name=say(T_SELECT_BOX, {"<label>": lab})) for lab in labels]
    already = all(b.is_checked() for b in boxes)
    if not already:
        boxes[0].focus()
        page.keyboard.press(SELECT_ALL)
    for b in boxes:
        expect(b).to_be_checked()
    if not already:
        heard(page, say(T_SELECTED, {"<n>": len(labels)}))
    page.get_by_role("button", name="Assign selected").click()
    dlg = page.get_by_role("dialog", name="Assign selected lines")
    pick(dlg.get_by_role("combobox", name="Vessel"), vessel_name)
    confirm = [b for b in dlg.get_by_role("button").all()
               if (b.get_attribute("aria-label") or b.inner_text()).strip() not in ("Cancel", "Close")]
    assert confirm, "no confirm button in the Assign selected lines dialog"
    confirm[0].click()
    heard(page, say(T_BULK, {"<n>": len(labels), "<vessel>": vessel_name}))


def bulk_mission(B):
    free(B, "v-petrel", "v-gannet", "v-kittiwake")
    m = create(B)
    ls = get_lines(B, m["id"])
    ok(assign(B, m["id"], {l["id"]: "v-petrel" for l in ls.values()}))
    return m, list(ls)


def test_wf_bulk_reassign_undo(browser, app_url):
    B = app_url.rstrip("/")
    m, labels = bulk_mission(B)
    with screen(browser, B, IRA, f"/missions/{m['id']}/plan") as page:
        posts = []
        page.on("request", lambda r: posts.append(r.post_data_json) if r.method == "POST" and r.url.endswith("/assignments") else None)
        bulk_assign(page, labels, "Gannet")
        assert len(posts) == 1 and len(posts[0]["assignments"]) == len(labels)
        assert all(l["vessel_id"] == "v-gannet" for l in get_lines(B, m["id"]).values())
        advance(page, UNDO_MS - 2 * SECOND_MS)
        page.get_by_role("button", name="Undo").click()
        heard(page, say(T_UNDID, {"<n>": len(labels)}))
        assert len(posts) == 2
    assert all(l["vessel_id"] == "v-petrel" and l["status"] == "Assigned" for l in get_lines(B, m["id"]).values())
    free(B, "v-petrel", "v-gannet", "v-kittiwake")


def test_wf_bulk_reassign_refused_and_expired(browser, app_url):
    B = app_url.rstrip("/")
    m, labels = bulk_mission(B)
    with screen(browser, B, IRA, f"/missions/{m['id']}/plan") as page:
        bulk_assign(page, labels, "Gannet")
        set_interval(B, "v-petrel", INTERVAL_MIN)
        page.get_by_role("button", name="Undo").click()
        heard(page, f"Could not undo: {overdue_msg(vessel(B, 'v-petrel'))}")
        assert all(l["vessel_id"] == "v-gannet" for l in get_lines(B, m["id"]).values())
        set_interval(B, "v-petrel", INTERVAL_MAX)
        bulk_assign(page, labels, "Kittiwake")
        expect(page.get_by_role("button", name="Undo")).to_be_visible()
        advance(page, UNDO_MS + SECOND_MS)
        gone(page, page.get_by_role("button", name="Undo"))
    assert all(l["vessel_id"] == "v-kittiwake" for l in get_lines(B, m["id"]).values())
    free(B, "v-petrel", "v-gannet", "v-kittiwake")


APP = Path("/app")


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    for font in ("Newsreader", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices


def test_if_licences_allowed():
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert not bad, bad
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    assert "SIL Open Font License" in notices


def test_if_no_extra_datastore():
    names = {p.name for p in shipped_packages()}
    assert not names & {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "lowdb", "nedb", "level", "lmdb"}
    files = [p for p in APP.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not files, files
    assert Postgres().tables()


def test_if_service_config_untouched():
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    write_tools = {"Write", "Edit", "MultiEdit", "NotebookEdit", "str_replace_based_edit_tool", "str_replace_editor",
                   "write_file", "edit_file", "create_file", "apply_patch"}

    def tool_calls(node):
        if isinstance(node, dict):
            name = node.get("name") or node.get("tool_name") or node.get("function_name")
            args = node.get("input", node.get("arguments", node.get("args")))
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = None
            if isinstance(name, str) and isinstance(args, dict):
                yield name, args
            for v in node.values():
                yield from tool_calls(v)
        elif isinstance(node, list):
            for v in node:
                yield from tool_calls(v)

    writes = []
    for name, args in tool_calls(json.loads(path.read_text())):
        if name not in write_tools or args.get("command") == "view":
            continue
        for key in ("file_path", "path", "notebook_path"):
            target = args.get(key)
            if isinstance(target, str) and re.search(r"compose[^/]*\.ya?ml$", target):
                writes.append((name, target))
    assert not writes, writes


def test_if_no_outside_requests(browser, app_url):
    B = app_url.rstrip("/")
    m = create(B)
    for email, path in ((IRA, "/fleet"), (IRA, f"/missions/{m['id']}"), (ODILE, f"/surveys/{CALDER}")):
        with screen(browser, B, email, path) as page:
            seen = []
            page.on("request", lambda r: seen.append(r.url))
            page.reload()
            advance(page, 3 * SECOND_MS)
            page.evaluate("0")
            assert all(same_origin(u, B) or u.startswith(("data:", "blob:")) for u in seen), seen
