from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import queue
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import unicodedata
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import parse_qs, parse_qsl, quote, unquote, urlencode, urlparse

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect

from conftest import post_json as kit_post_json
from conftest import (
    DEPLOYED_APP,
    Postgres,
    S3,
    advance,
    animations,
    axe,
    capture,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    session,
    settle,
    shipped_packages,
    state_styles,
    tab_order,
    unique,
)

HTTP_TIMEOUT = 30
UI_WAIT = 30
SETTLE_WAIT = 90
PROVIDER_WAIT = 60
STEP_MS = 50
POLL_SLACK_S = 1
BOOT_WAIT = 30
TAB_PRESSES = 60
GEOM_TOL = 2
QUIET_S = 3
OBSERVE_S = 15

SEED_NAME = "Tessera-3"
SEED_EPOCH = "2026-03-14T00:00:00Z"
SEED_EPOCH_GMT = "2026-073/00:00:00"
SEED_COUNT = 720
SEED_LINE_COUNT = 6
FIRST_UTC = datetime(2026, 3, 14, 1, 0, 0, tzinfo=timezone.utc)
FIRST_MET = 3600
STEP_S = 10
ORBIT_R = 1797400
ORBIT_DR = 40000
ORBIT_S = 1650
ORBIT_DS = 50
ORBIT_INC_DEG = 30
MOON_R = 1737400
NMI_M = Decimal(1852)
FT_M = Decimal("0.3048")
DERIVED_TOL = 0.001
FRAME_M_TOL = 0.01
FRAME_DEG_TOL = 0.0001
HOLD_GAP_S = 600
MAX_FRAMES = 3000
JSON_LIMIT = 16384
CAPTURE_LIMIT = 5000000
LINE_LIMIT = 1024
SAMPLE_CAP = 50000
PARSE_BUDGET_S = 10
PARSER_FAILURE_BUDGET_S = 30
PICK_PX = 24
LENS_PX = 160
SEARCH_DEBOUNCE_MS = 250
RETRY_MS = 1000
STATUS_CHECK_MS = 10000
RATE_LIMIT = 120
RATE_WINDOW_S = 60
DEFAULT_EXPIRY_S = 2592000
MAX_EXPIRY_S = 31536000
STREAM_DELIVERY_S = 2
LIVE_PAGE_MS = 5000
READER_KEY_TTL_S = 30
SESSION_RELEASE_S = 5
RETRY_WINDOW_S = 5
WEBHOOK_CATCHUP_S = 15
MAX_REPLAY_GAP = 1000
FREE_QUOTA = 268435456
ONE_GIB_QUOTA = 1073741824
MAX_SAFE = 2**53 - 1

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}

TESSERA = "TESSERA-3"
TESSERA_ETAG = '"hollis-tessera3-v1"'
BASELINE_VECTORS = [
    (1773450000000, 1837.4, 0.0, 0.0, 0.0, 1.38564, 0.8),
    (1773453600000, -1757.4, 0.0, 0.0, 0.0, -1.47224, -0.85),
    (1773457200000, 1837.4, 0.0, 0.0, 0.0, 1.38564, 0.8),
]
SEED_REF_FROM = 1773450000
SEED_REF_TO = 1773457190

SEED_HEAD = (
    "# Tessera-3 orbit 1, Kestrel Ground capture (invented demo data)",
    "# frame: Moon-centred Moon-fixed; metres and metres per second",
    "# S,utc,x_m,y_m,z_m,vx_m_s,vy_m_s,vz_m_s",
)
SEED_TRANSCRIPT = {
    0: ("KESTREL", "Tessera, Kestrel. Acquisition of signal, loud and clear."),
    120: ("TESSERA", "Kestrel, Tessera. Star tracker locked, attitude nominal."),
    355: ("KESTREL", "Coming up on perilune. Altimeter should read two zero kilometres."),
    360: ("TESSERA", "Perilune. Doppler steady, all channels green."),
    600: ("KESTREL", "Two minutes to loss of signal."),
    719: ("TESSERA", "Kestrel, Tessera. See you on the next pass."),
}
SEED_EVENT_TITLE = "Perilune pass"

NAME_MSG = "Enter a mission name of 1 to 80 characters."
EPOCH_MSG = "Enter the epoch as YYYY-MM-DDTHH:MM:SSZ."
FILENAME_MSG = "Send the capture name percent-encoded as UTF-8: 1 to 120 characters, no control characters, slashes or backslashes."
SHA_MSG = "Send the capture's SHA-256 as 64 lowercase hex characters."
EMPTY_MSG = "The capture is empty."
MISMATCH_MSG = "The SHA-256 does not match the bytes received."
KEY_MSG = "Send an Idempotency-Key of 1 to 64 letters, digits or dashes."
MET_MSG = "Give MET as a whole number of seconds."
NO_SAMPLE_MSG = "No sample at or before this time."
TITLE_MSG = "Enter a title of 1 to 120 characters."
NOTE_MSG = "Keep the private note to 2,000 characters or fewer."
CTRL_MSG = "Remove control characters and line or paragraph separators."
Q_MSG = "Enter 1 to 200 characters to search for."
FPS_MSG = "Choose fps 1, 5, 10 or 25."
FROM_MSG = "Give from as whole MET seconds within the track."
TO_MSG = "Give to as whole MET seconds from from to the end of the track."
FRAMES_MSG = "Ask for at most 3000 frames."
KM_MSG = "Choose km or nmi."
SPEED_MSG = "Choose m_s or ft_s."
REF_NULL_MSG = "Only null clears the reference target here."
OBJECT_MSG = "Send a JSON object."
TARGET_MSG = "Enter a target of 1 to 32 capital letters, digits or dashes."
UNKNOWN_TARGET_MSG = "The ephemeris service does not know this target."
LM_NAME_MSG = "Enter a landmark name of 1 to 40 characters."
LAT_MSG = "Give latitude in degrees from -90 to 90, with at most 6 decimals."
LON_MSG = "Give longitude in degrees above -180 and up to 180, with at most 6 decimals."
URL_MSG = "Enter an http or https URL of up to 2048 characters."
EXPIRY_FMT_MSG = "Send the expiry as YYYY-MM-DDTHH:MM:SSZ."
EXPIRY_RANGE_MSG = "Choose an expiry after now and within 365 days."
PLAN_MSG = "Choose archive-free, archive-1 or archive-10-annual."
DOY_ERR = "Use GMT day-of-year: YYYY-DDD/HH:MM:SS."
MET_ERR = "Use a MET like +000:01:00:00 or T-000:00:05:00."
LAT_ERR = "Use a latitude like 12.5° S or −12.5."
LON_ERR = "Use a longitude like 45.25° W or −45.25."
BANNER_STORAGE = "Capture storage is offline. Uploads, deletions and capture downloads are paused; the replay still plays."
BANNER_SEARCH = "Transcript search is offline. The track, loupe and transcript still work."
BANNER_QUEUE = "The parsing queue is offline. Uploads are stored and will be parsed when it returns."
BANNER_WEBHOOKS = "Webhooks are offline. Changes are kept and sent to subscribers when it returns."
BANNER_BILLING = "Billing is offline. Uploads keep your current quota; plan changes are paused."
EMPTY_AUTHOR_HEADING = "No passes on this mission yet"
EMPTY_AUTHOR_LINE = "Upload a capture to draw the first ground track."
EMPTY_SHARE_HEADING = "This replay has no passes yet"
WITHDRAWN_HEADING = "This replay link has been withdrawn"
WITHDRAWN_LINE = "The author turned this link off. Ask them for a new one."
EXPIRED_HEADING = "This replay link has expired"
EXPIRED_LINE = "Ask the author for a new link."
RATE_HEADING = "Too many requests for this replay link"
UNKNOWN_LINK_HEADING = "No replay at this link"
MISSION_404_HEADING = "Mission not found"
PAGE_404_HEADING = "Page not found"
REASONS = {
    "line_too_long": "line is longer than 1024 bytes",
    "unknown_record": "unknown record type",
    "too_many_samples": "more than 50000 samples",
    "bad_field": "a field cannot be read",
    "out_of_order": "sample time is not after the previous sample",
    "no_samples": "no sample lines",
    "parser_failed": "the parser stopped unexpectedly",
}
EVENT_TYPES = {"pass.parsed", "pass.rejected", "pass.deleted", "event.pinned", "share.revoked"}


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def half(value: Decimal, places: str) -> str:
    q = value.quantize(Decimal(places), rounding=ROUND_HALF_UP)
    s = format(q, "f")
    return s[1:] if s.startswith("-") and q == 0 else s


def dist(metres: float, unit: str = "km") -> str:
    factor = Decimal(1000) if unit == "km" else NMI_M
    return f"{half(Decimal(metres) / factor, '0.1')} {unit}"


def spd(ms: float, unit: str = "m_s") -> str:
    if unit == "m_s":
        return f"{half(Decimal(ms), '1')} m/s"
    return f"{half(Decimal(ms) / FT_M, '1')} ft/s"


def num_dist(metres: float, unit: str = "km") -> str:
    return dist(metres, unit).split(" ")[0]


def num_spd(ms: float, unit: str = "m_s") -> str:
    return spd(ms, unit).split(" ")[0]


def lat_fmt(v: float) -> str:
    q = Decimal(abs(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{q}° {'S' if v < 0 and q != 0 else 'N'}"


def lon_fmt(v: float) -> str:
    q = Decimal(abs(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    west = v < 0 and q != 0 and q != Decimal(180)
    return f"{q}° {'W' if west else 'E'}"


def met_label(seconds: int) -> str:
    a = abs(seconds)
    d, rest = divmod(a, 86400)
    h, rest = divmod(rest, 3600)
    m, s = divmod(rest, 60)
    return f"{'T-' if seconds < 0 else '+'}{d:03d}:{h:02d}:{m:02d}:{s:02d}"


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def gmt(text: str) -> str:
    dt = parse_iso(text)
    return f"{dt.year:04d}-{dt.timetuple().tm_yday:03d}/{dt:%H:%M:%S}"


def size_fmt(n: int) -> str:
    for unit, factor in (("GiB", 1 << 30), ("MiB", 1 << 20), ("KiB", 1 << 10)):
        if n >= factor:
            return f"{(Decimal(n) / Decimal(factor)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)} {unit}"
    return f"{n} B"


def money(cents: int) -> str:
    return f"{'-' if cents < 0 else ''}{abs(cents) // 100}.{abs(cents) % 100:02d}"


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * MOON_R * math.asin(math.sqrt(a))


def plate_lines(s: dict, du: str = "km", su: str = "m_s") -> list[str]:
    return [
        f"MET {s['met_label']}",
        f"GMT {gmt(s['utc'])}",
        f"LAT {lat_fmt(s['lat_deg'])}",
        f"LON {lon_fmt(s['lon_deg'])}",
        f"ALT {dist(s['altitude_m'], du)}",
        f"SPD {spd(s['speed_m_s'], su)}",
    ]


def csv_cell(text: str, is_text: bool) -> str:
    if is_text and text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        text = "'" + text
    if any(c in text for c in (",", '"', "\r", "\n")):
        text = '"' + text.replace('"', '""') + '"'
    return text


def fallback_name(name: str) -> str:
    return "".join("_" if not (0x20 <= ord(c) <= 0x7E) or c in '"\\%' else c for c in name)


def jcs(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def entry_hash(e: dict) -> str:
    body = {k: e[k] for k in ("seq", "at", "kind", "data", "prev")}
    return hashlib.sha256(jcs(body).encode("utf-8")).hexdigest()


def d1(v: float) -> str:
    s = format(Decimal(repr(v)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP), "f")
    return "0.0" if s == "-0.0" else s


def orbit(k: int) -> tuple[float, ...]:
    th = 2 * math.pi * k / SEED_COUNT
    r = ORBIT_R + ORBIT_DR * math.cos(th)
    c, s30 = math.cos(math.radians(ORBIT_INC_DEG)), math.sin(math.radians(ORBIT_INC_DEG))
    sp = ORBIT_S - ORBIT_DS * math.cos(th)
    return (r * math.cos(th), r * math.sin(th) * c, r * math.sin(th) * s30,
            -sp * math.sin(th), sp * math.cos(th) * c, sp * math.cos(th) * s30)


def sample_line(k: int, start: datetime = FIRST_UTC) -> str:
    return "S," + iso(start + timedelta(seconds=STEP_S * k)) + "," + ",".join(d1(v) for v in orbit(k))


def line_at(k: int, speaker: str, text: str, start: datetime = FIRST_UTC) -> str:
    return f"T,{iso(start + timedelta(seconds=STEP_S * k))},{speaker},{text}"


def lines(*items: str, sep: str = "\n") -> bytes:
    return (sep.join(items) + sep).encode("utf-8")


def orbit_capture(ks, transcript: dict | None = None, head=SEED_HEAD, start: datetime = FIRST_UTC) -> bytes:
    out = list(head)
    for k in ks:
        out.append(sample_line(k, start))
        if transcript and k in transcript:
            out.append(line_at(k, *transcript[k], start=start))
    return lines(*out)


def seed_capture() -> bytes:
    return orbit_capture(range(SEED_COUNT), SEED_TRANSCRIPT)


def small_capture(n: int = 3, transcript: dict | None = None) -> bytes:
    tag = unique("cap")[0]
    return orbit_capture(range(n), transcript if transcript is not None else {0: ("KESTREL", f"Signal {tag}")}, head=(f"# {tag}",))


def parse_samples(data: bytes) -> list[tuple[datetime, list[float]]]:
    out = []
    for raw in data.decode("utf-8-sig").split("\n"):
        raw = raw.rstrip("\r")
        if raw.startswith("S,"):
            f = raw.split(",")
            out.append((parse_iso(f[1]), [float(x) for x in f[2:8]]))
    return out


def filler(size: int, tag: str) -> bytes:
    head = f"# fill {tag}\n".encode()
    block = b"#" * (LINE_LIMIT - 1) + b"\n"
    body = head + block * (size // len(block) + 1)
    return body[:size]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


INT_KEYS = {"sample_count", "total_bytes", "change_version", "vector_count", "unix_ms", "size_bytes", "price_cents",
            "quota_bytes", "used_bytes", "balance_cents", "transcript_line_count", "rejected_line", "index", "met",
            "met_ms", "k", "seq", "length", "first_bad_seq", "count", "limit_bytes", "fps"}
INSTANT_KEYS = {"epoch_utc", "created_at", "fetched_at", "expires_utc", "utc", "at"}
CONTRACT_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
CONTRACT_MET_LABEL = re.compile(r"^(\+|T-)\d{3,}:\d{2}:\d{2}:\d{2}$")


def _walk(value, share: bool, where: str = "$") -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            at = f"{where}.{k}"
            assert not (share and k == "note"), f"share response carries a note at {at}"
            if k in INT_KEYS and v is not None:
                assert type(v) is int, f"{at} must be a JSON integer, got {v!r}"
            if k in INSTANT_KEYS and v is not None:
                assert isinstance(v, str) and CONTRACT_INSTANT.match(v), f"{at} must be YYYY-MM-DDTHH:MM:SSZ, got {v!r}"
            if k == "met_label" and v is not None:
                assert CONTRACT_MET_LABEL.match(v), f"{at} is not a MET label: {v!r}"
            if k not in ("data", "errors"):
                _walk(v, share, at)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _walk(v, share, f"{where}[{i}]")


def contract(resp: httpx.Response) -> httpx.Response:
    path = resp.request.url.path
    share = path.startswith(("/s/", "/api/share/"))
    if share:
        assert "no-store" in resp.headers.get("cache-control", ""), f"{path}: share responses carry Cache-Control: no-store"
    ctype = resp.headers.get("content-type", "")
    if resp.request.method != "HEAD" and resp.content and ctype.split(";")[0].strip().lower() == "application/json":
        assert ctype == "application/json; charset=utf-8", f"{path}: JSON Content-Type is {ctype!r}"
        _walk(resp.json(), share)
    return resp


def call(method: str, base: str, path: str, **kw) -> httpx.Response:
    kw.setdefault("timeout", HTTP_TIMEOUT)
    return contract(httpx.request(method, base + path, **kw))


def post_json(*args, **kw) -> httpx.Response:
    return contract(kit_post_json(*args, **kw))


def jget(base: str, path: str, **kw) -> dict:
    r = call("GET", base, path, **kw)
    assert r.status_code == 200, f"GET {path} answered {r.status_code}: {r.text[:300]}"
    return r.json()


def expect_error(r: httpx.Response, status: int, body: dict) -> None:
    assert r.status_code == status, f"expected {status} {body}, got {r.status_code}: {r.text[:400]}"
    assert r.json() == body, f"expected body {body}, got {r.text[:400]}"


def outage(env: str) -> str:
    url = os.environ.get(env)
    if not url:
        pytest.fail(f"{env} is not set; the outage instance named in the spec must be reachable")
    return url.rstrip("/")


def make_mission(base: str, epoch: str = SEED_EPOCH, name: str | None = None) -> dict:
    r = post_json(base, "/api/missions", {"name": name or unique("Mission")[0], "epoch_utc": epoch})
    assert r.status_code == 201, f"POST /api/missions: {r.status_code} {r.text[:300]}"
    return r.json()


def mission(base: str, mid: str) -> dict:
    return jget(base, f"/api/missions/{mid}")


NO_KEY = ""


def upload(base: str, mid: str, data: bytes, name: str = "pass.cap", key: str | None = None,
           digest: str | None = None, ctype: str = "application/octet-stream", raw_name=None) -> httpx.Response:
    headers = {"Content-Type": ctype, "X-Capture-SHA256": digest if digest is not None else sha(data),
               "X-Capture-Filename": raw_name if raw_name is not None else quote(name, safe="")}
    if key != NO_KEY:
        headers["Idempotency-Key"] = key or idempotency_key()
    return call("POST", base, f"/api/missions/{mid}/passes", content=data, headers=headers)


def settled_pass(base: str, pid: str, seconds: float = SETTLE_WAIT) -> dict:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        p = jget(base, f"/api/passes/{pid}")
        if p["state"] in ("parsed", "rejected"):
            return p
    pytest.fail(f"pass {pid} never reached parsed or rejected within {seconds} s (parse budget)")


def parsed_mission(base: str, data: bytes | None = None, epoch: str = SEED_EPOCH, name: str = "orbit.cap", mname: str | None = None):
    m = make_mission(base, epoch, mname)
    data = data if data is not None else seed_capture()
    r = upload(base, m["id"], data, name)
    assert r.status_code == 202, f"upload answered {r.status_code}: {r.text[:300]}"
    p = settled_pass(base, r.json()["id"])
    assert p["state"] == "parsed", f"capture did not parse: {p}"
    return mission(base, m["id"]), p, data


def track(base: str, mid: str) -> list[dict]:
    return jget(base, f"/api/missions/{mid}/track")["samples"]


def pin(base: str, mid: str, met, title: str, note: str | None = None, key: str | None = None) -> httpx.Response:
    body = {"met": met, "title": title}
    if note is not None:
        body["note"] = note
    return post_json(base, f"/api/missions/{mid}/events", body, key=key or idempotency_key())


def make_share(base: str, mid: str, expires: str | None = None) -> dict:
    r = call("POST", base, f"/api/missions/{mid}/share", json={"expires_utc": expires} if expires else None)
    assert r.status_code == 201, f"POST share: {r.status_code} {r.text[:300]}"
    return r.json()


def patch(base: str, mid: str, body, ctype: str = "application/merge-patch+json") -> httpx.Response:
    content = body if isinstance(body, (bytes, str)) else json.dumps(body)
    return call("PATCH", base, f"/api/missions/{mid}", content=content, headers={"Content-Type": ctype})


def add_landmark(base: str, mid: str, name: str, lat: float, lon: float) -> httpx.Response:
    return call("POST", base, f"/api/missions/{mid}/landmarks", json={"name": name, "lat_deg": lat, "lon_deg": lon})


def set_reference(base: str, mid: str, target: str) -> httpx.Response:
    return call("PUT", base, f"/api/missions/{mid}/reference", json={"target": target})


def audit(base: str, mid: str) -> list[dict]:
    return jget(base, f"/api/missions/{mid}/audit")["entries"]


def mdocs(meili, mid: str, **flt) -> list[dict]:
    expr = " AND ".join([f"mission_id = '{mid}'"] + [f"{k} = '{v}'" for k, v in flt.items()])
    return meili.search("transcript_items", "", filter=expr, limit=1000)["hits"]


def together(fns: list) -> list:
    barrier = threading.Barrier(len(fns))

    def run(fn):
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(fns)) as ex:
        return [f.result() for f in [ex.submit(run, fn) for fn in fns]]


def wait_for(fn, what: str, seconds: float = PROVIDER_WAIT):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
    pytest.fail(f"{what} (last observation: {str(last)[:300]})")


def svix_messages(svix, mid: str) -> list[dict]:
    try:
        return svix.messages(mid)
    except Exception:
        return []


def journal(wiremock, target: str) -> list[dict]:
    out = []
    for e in wiremock.client.get("/__admin/requests").json()["requests"]:
        req = e["request"]
        url = req.get("url") or ""
        if urlparse(url).path == "/v3/vectors" and parse_qs(urlparse(url).query).get("target") == [target]:
            out.append(req)
    return sorted(out, key=lambda r: r.get("loggedDate", 0))


def header_of(req: dict, name: str):
    for k, v in (req.get("headers") or {}).items():
        if k.lower() == name.lower():
            return v if isinstance(v, str) else (v[0] if isinstance(v, list) else v.get("values", [None])[0] if isinstance(v, dict) else v)
    return None


def vectors_body(target: str, vecs=BASELINE_VECTORS, frame: str = "MCMF") -> dict:
    return {"target": target, "frame": frame, "units": {"position": "km", "velocity": "km/s", "time": "unix_ms"},
            "vectors": [{"t": t, "x": x, "y": y, "z": z, "vx": vx, "vy": vy, "vz": vz} for t, x, y, z, vx, vy, vz in vecs]}


def probe_target(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


@contextmanager
def sse(url: str, headers: dict | None = None):
    events: queue.Queue = queue.Queue()
    client = httpx.Client(timeout=httpx.Timeout(HTTP_TIMEOUT, read=OBSERVE_S * 4))
    cm = client.stream("GET", url, headers=headers or {})
    resp = cm.__enter__()

    def pump():
        ev: dict = {}
        try:
            for raw in resp.iter_lines():
                if raw == "":
                    if ev:
                        events.put({**ev, "at": time.monotonic()})
                    ev = {}
                elif raw.startswith(":"):
                    continue
                else:
                    k, _, v = raw.partition(":")
                    v = v[1:] if v.startswith(" ") else v
                    ev[k] = (ev[k] + "\n" + v) if k == "data" and k in ev else v
        except Exception:
            pass
        events.put(None)

    if resp.status_code == 200:
        threading.Thread(target=pump, daemon=True).start()
    try:
        yield resp, events
    finally:
        try:
            cm.__exit__(None, None, None)
        finally:
            client.close()


def next_event(events: queue.Queue, seconds: float):
    try:
        return events.get(timeout=seconds)
    except queue.Empty:
        return "timeout"


class Relay:

    def __init__(self, url: str):
        u = urlparse(url)
        self.netloc = u.netloc
        self.target = (u.hostname, u.port or (443 if u.scheme == "https" else 80))
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        self.up = False
        self.closed = False
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()
        threading.Thread(target=self._accept, daemon=True).start()

    def rewrite(self, url: str) -> str:
        creds = self.netloc.rsplit("@", 1)[0] + "@" if "@" in self.netloc else ""
        return url.replace(self.netloc, f"{creds}127.0.0.1:{self.port}", 1)

    def _accept(self):
        while not self.closed:
            try:
                c, _ = self.sock.accept()
            except OSError:
                return
            if not self.up:
                c.close()
                continue
            try:
                s = socket.create_connection(self.target, timeout=3)
            except OSError:
                c.close()
                continue
            with self.lock:
                self.conns += [c, s]
            for a, b in ((c, s), (s, c)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    def _pipe(self, a: socket.socket, b: socket.socket):
        try:
            while not self.closed:
                chunk = a.recv(65536)
                if not chunk:
                    break
                b.sendall(chunk)
        except OSError:
            pass
        finally:
            for x in (a, b):
                try:
                    x.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                x.close()

    def set(self, up: bool):
        self.up = up
        if not up:
            with self.lock:
                for c in self.conns:
                    try:
                        c.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    c.close()
                self.conns.clear()

    def close(self):
        self.set(False)
        self.closed = True
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def app_copy(**overrides: str):
    app = Path(DEPLOYED_APP)
    manifest = json.loads((app / "run.json").read_text())
    port = free_port()
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    env.pop("APP_PUBLIC_URL", None)
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=app, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text(errors="replace")[-3000:]

    deadline = time.monotonic() + BOOT_WAIT
    ready = False
    while time.monotonic() < deadline and not ready:
        if proc.poll() is not None:
            pytest.fail(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            ready = httpx.get(base + "/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            ready = False
    if not ready:
        os.killpg(proc.pid, signal.SIGKILL)
        pytest.fail(f"app copy did not answer /api/health within {BOOT_WAIT} s:\n{tail()}")
    try:
        yield base
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


def role(page, r: str, name: str, **kw):
    return page.get_by_role(r, name=name, exact=True, **kw)


def text_of(loc) -> str:
    return norm(loc.first.inner_text(timeout=2000)) if loc.count() else ""


def ui(page, check, what: str, seconds: float = UI_WAIT, step_ms: float = STEP_MS) -> None:
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except PlaywrightError as e:
            last = e
        advance(page, step_ms)
    pytest.fail(f"{what} (last error: {last})")


def shows(page, loc, text: str, what: str | None = None, seconds: float = UI_WAIT) -> None:
    ui(page, lambda: text in text_of(loc), what or f"{text!r} shown", seconds)


def appears(page, loc, what: str) -> None:
    ui(page, lambda: loc.count() > 0 and loc.first.is_visible(), what)


def gone(page, loc, what: str) -> None:
    ui(page, lambda: loc.count() == 0 or not loc.first.is_visible(), what)


def is_focused(loc) -> bool:
    return loc.count() > 0 and loc.first.evaluate("el => el === document.activeElement || el.contains(document.activeElement)")


def slider(page):
    return role(page, "slider", "Track loupe")


def slider_now(page) -> int:
    return int(slider(page).evaluate("el => Number(el.getAttribute('aria-valuenow') ?? el.value)"))


def slider_text(page) -> str:
    return slider(page).evaluate("el => el.getAttribute('aria-valuetext')")


def current_buttons(page) -> int:
    return role(page, "list", "Transcript lines").evaluate("el => el.querySelectorAll('button[aria-current=\"true\"]').length")


def plate(page) -> str:
    return text_of(role(page, "group", "Readout"))


def params(page) -> dict:
    return dict(parse_qsl(urlparse(page.url).query, keep_blank_values=True))


WATCH_JS = """el => { if (el.__log) return; const log = []; el.__log = log; let last = null;
  const rec = () => { const t = el.textContent.replace(/\\s+/g, ' ').trim(); if (t && t !== last) log.push(t); last = t; };
  new MutationObserver(rec).observe(el, {subtree: true, childList: true, characterData: true}); rec(); }"""


def watch(loc) -> None:
    loc.first.evaluate(WATCH_JS)


def heard(loc) -> list[str]:
    return loc.first.evaluate("el => el.__log || []")


def upload_ui(page, name: str, data: bytes) -> None:
    page.get_by_label("Capture file").set_input_files(files=[{"name": name, "mimeType": "application/octet-stream", "buffer": data}])


def author_url(base: str, mid: str, **q) -> str:
    return f"{base}/missions/{mid}" + ("?" + urlencode(q) if q else "")


def share_url(base: str, token: str, **q) -> str:
    return f"{base}/s/{token}" + ("?" + urlencode(q) if q else "")


@contextmanager
def opened(browser, url: str, viewport: dict | None = None, **kw):
    with open_app(browser, url, **kw) as page:
        if viewport:
            page.set_viewport_size(viewport)
        yield page


@contextmanager
def live_page(browser, url: str, viewport: dict = DESKTOP, **ctx):
    context = browser.new_context(viewport=viewport, accept_downloads=True, **ctx)
    page = context.new_page()
    page.goto(url)
    try:
        yield page
    finally:
        context.close()


def project(box: dict, lat: float, lon: float, lon0: float) -> tuple[float, float, bool]:
    cx, cy, rad = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, box["width"] / 2
    phi, dl = math.radians(lat), math.radians(lon - lon0)
    return cx + rad * math.cos(phi) * math.sin(dl), cy - rad * math.sin(phi), math.cos(phi) * math.cos(dl) > 0


def nearest(samples: list[dict], box: dict, lon0: float, pt) -> tuple[int, tuple[float, float], float]:
    best = None
    for s in samples:
        x, y, vis = project(box, s["lat_deg"], s["lon_deg"], lon0)
        if vis:
            d = math.hypot(x - pt[0], y - pt[1])
            if best is None or d < best[2]:
                best = (s["index"], (x, y), d)
    return best


def far_point(samples, box, lon0):
    for fx in (0.03, 0.97, 0.5):
        for fy in (0.03, 0.97):
            pt = (box["x"] + fx * box["width"], box["y"] + fy * box["height"])
            if nearest(samples, box, lon0, pt)[2] > 2 * PICK_PX:
                return pt
    pytest.fail("no point on the Track loupe is far from every visible sample")


def lens_centre(page) -> tuple[float, float, dict]:
    b = role(page, "img", "Loupe").bounding_box()
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, b


def png_pixels(data: bytes) -> tuple[int, int, list[list[tuple[int, int, int]]]]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "capture is not a PNG"
    pos, idat, w = 8, b"", 0
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        if kind == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and ctype in (2, 6), "unsupported PNG layout"
            bpp = 3 if ctype == 2 else 4
        elif kind == b"IDAT":
            idat += body
        pos += 12 + n
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev = [], bytearray(stride)
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b, c = prev[i], prev[i - bpp] if i >= bpp else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append([tuple(line[x * bpp:x * bpp + 3]) for x in range(w)])
        prev = line
    return w, h, rows


def luminance(rgb) -> float:
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def pdf_title(data: bytes) -> str | None:
    m = re.search(rb"/Title\s*<([0-9A-Fa-f]+)>", data)
    if m:
        raw = bytes.fromhex(m.group(1).decode())
    else:
        m = re.search(rb"/Title\s*\(((?:\\.|[^\\)])*)\)", data, re.S)
        if not m:
            return None
        raw = re.sub(rb"\\(.)", lambda x: {b"n": b"\n", b"r": b"\r", b"t": b"\t"}.get(x.group(1), x.group(1)), m.group(1))
    return raw[2:].decode("utf-16-be") if raw[:2] == b"\xfe\xff" else raw.decode("latin-1")


def disposition_names(value: str) -> tuple[str | None, str | None]:
    plain = re.search(r'filename="((?:[^"\\]|\\.)*)"', value)
    ext = re.search(r"filename\*=UTF-8''([^;\s]+)", value, re.I)
    return (plain.group(1) if plain else None, unquote(ext.group(1)) if ext else None)


def test_create_mission_api(app_url):
    name = unique("Mission")[0]
    r = post_json(app_url, "/api/missions", {"name": f"  {name}  ", "epoch_utc": SEED_EPOCH})
    assert r.status_code == 201, r.text
    m = r.json()
    assert (m["name"], m["epoch_utc"], m["distance_unit"], m["speed_unit"], m["sample_count"], m["perilune"], m["change_version"]) == (name, SEED_EPOCH, "km", "m_s", 0, None, 0)
    assert jget(app_url, f"/api/missions/{m['id']}")["epoch_utc"] == SEED_EPOCH
    assert post_json(app_url, "/api/missions", {"name": "n" * 80, "epoch_utc": SEED_EPOCH}).status_code == 201
    epoch_msg = "Enter the epoch as YYYY-MM-DDTHH:MM:SSZ."
    for bad in ("2026-03-14", "2026-03-14T00:00:00.5Z", "2026-03-14T00:00:00+00:00", "2026-02-30T00:00:00Z", 123, None):
        expect_error(post_json(app_url, "/api/missions", {"name": "ok", "epoch_utc": bad}), 422, {"error": "validation", "errors": {"epoch_utc": epoch_msg}})
    for bad in ("", "   ", "n" * 81):
        expect_error(post_json(app_url, "/api/missions", {"name": bad, "epoch_utc": SEED_EPOCH}), 422, {"error": "validation", "errors": {"name": NAME_MSG}})
    expect_error(post_json(app_url, "/api/missions", {"name": "", "epoch_utc": "x"}), 422, {"error": "validation", "errors": {"name": NAME_MSG, "epoch_utc": epoch_msg}})


def raw_upload(base, mid, data, key=None, sha=None, name="raw.cap", ctype="application/octet-stream"):
    import hashlib
    headers = {"Content-Type": ctype, "X-Capture-Filename": name, "X-Capture-SHA256": sha or hashlib.sha256(data).hexdigest(),
               "Idempotency-Key": key or idempotency_key()}
    return call("POST", base, f"/api/missions/{mid}/passes", content=data, headers=headers, timeout=HTTP_TIMEOUT * 4)


def test_empty_mission_console(app_url, browser):
    m = make_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        appears(page, page.get_by_role("heading", name="No passes on this mission yet", exact=True), "empty-mission heading")
        appears(page, page.get_by_text("Upload a capture to draw the first ground track.", exact=True), "empty-mission line")
        assert slider(page).count() == 0 and role(page, "group", "Readout").count() == 0
        assert role(page, "textbox", "Go to GMT").count() == 0 and role(page, "button", "Play").count() == 0 and role(page, "button", "Pin event").count() == 0
        appears(page, role(page, "region", "Landmarks"), "Landmarks region stays")
        appears(page, role(page, "region", "Reference"), "Reference region stays")
        appears(page, role(page, "region", "Subscribers"), "Subscribers region stays")
    with opened(browser, share_url(app_url, tok), DESKTOP, reduced_motion="reduce") as page:
        appears(page, page.get_by_role("heading", name="This replay has no passes yet", exact=True), "share empty heading")
        assert slider(page).count() == 0
    assert call("GET", app_url, f"/s/{tok}").status_code == 200


def test_upload_storage_confirmed(app_url):
    m = make_mission(app_url)
    mid, data, key = m["id"], small_capture(), idempotency_key()
    wrong = "0" * 64
    r = raw_upload(app_url, mid, data, key=key, sha=wrong)
    expect_error(r, 422, {"error": "validation", "errors": {"sha256": "The SHA-256 does not match the bytes received."}})
    assert S3().keys(f"captures/{mid}/") == [] and mission(app_url, mid)["passes"] == [] and mission(app_url, mid)["total_bytes"] == 0
    ok = raw_upload(app_url, mid, data, key=key)
    assert ok.status_code == 202 and "idempotency-replayed" not in ok.headers
    p = ok.json()
    assert p["state"] == "stored" and p["size_bytes"] == len(data)
    assert S3().get(f"captures/{mid}/{p['id']}.cap") == data
    assert p["sha256"] == __import__("hashlib").sha256(data).hexdigest()
    assert [e["kind"] for e in audit(app_url, mid)][:2] == ["mission.created", "pass.stored"]
    expect_error(raw_upload(app_url, mid, small_capture(4), sha="ABC"), 422, {"error": "validation", "errors": {"sha256": "Send the capture's SHA-256 as 64 lowercase hex characters."}})


def test_upload_refusals(app_url):
    m = make_mission(app_url)
    mid, data = m["id"], small_capture()
    first = raw_upload(app_url, mid, data)
    assert first.status_code == 202
    expect_error(raw_upload(app_url, mid, data, name="other-name.cap"), 409, {"error": "duplicate_capture", "pass_id": first.json()["id"]})
    expect_error(raw_upload(app_url, mid, b""), 422, {"error": "validation", "errors": {"body": "The capture is empty."}})
    expect_error(raw_upload(app_url, mid, data + b"x", ctype="text/plain"), 415, {"error": "unsupported_media_type"})
    expect_error(raw_upload(app_url, mid, b"#" * (CAPTURE_LIMIT + 1)), 413, {"error": "capture_too_large", "limit_bytes": CAPTURE_LIMIT})
    assert len(mission(app_url, mid)["passes"]) == 1 and len(S3().keys(f"captures/{mid}/")) == 1
    call("DELETE", app_url, f"/api/passes/{first.json()['id']}") if settled_pass(app_url, first.json()["id"]) else None


def test_upload_announcements(app_url, browser):
    m = make_mission(app_url)
    good = small_capture(3, {0: ("KESTREL", "one")})
    bad = lines(sample_line(0), "X,1")
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        status = role(page, "status", "Upload status")
        appears(page, role(page, "region", "Passes"), "Passes region")
        watch(status)
        upload_ui(page, "a.cap", good)
        shows(page, status, "a.cap parsed: 3 samples, 1 transcript line.", seconds=SETTLE_WAIT)
        upload_ui(page, "dup.cap", good)
        shows(page, status, "dup.cap is already on this mission.")
        upload_ui(page, "bad.cap", bad)
        shows(page, status, f"bad.cap rejected at line 2: {REASONS['unknown_record']}.", seconds=SETTLE_WAIT)
        for _ in range(6):
            advance(page, STATUS_CHECK_MS)
        log = heard(status)
    for msg in ("a.cap parsed: 3 samples, 1 transcript line.", "dup.cap is already on this mission.", f"bad.cap rejected at line 2: {REASONS['unknown_record']}."):
        assert log.count(msg) == 1, f"{msg!r} once; heard {log}"
    assert sum(1 for x in log if x.startswith("a.cap stored, checksum verified.")) == 1
    assert sum(1 for x in log if x.startswith("Uploading a.cap")) == 1
    assert len(mission(app_url, m["id"])["passes"]) == 2


def test_wf_capture_upload_happy(app_url, browser, ntfy):
    fname = "tessera – ✓ pass.cap"
    data = small_capture(3, {0: ("KESTREL", "hello")})
    with opened(browser, app_url + "/", DESKTOP, reduced_motion="reduce") as page:
        name = unique("First")[0]
        role(page, "textbox", "Mission name").fill(name)
        role(page, "textbox", "Epoch (GMT)").fill(SEED_EPOCH_GMT)
        role(page, "button", "Create mission").click()
        appears(page, page.get_by_role("heading", name=name, level=1, exact=True), "console opens")
        appears(page, page.get_by_text(f"Epoch {SEED_EPOCH_GMT}", exact=True), "epoch in day-of-year form")
        mid = urlparse(page.url).path.rsplit("/", 1)[-1]
        attempts = []

        def drop_first(route):
            if route.request.method != "POST":
                route.fallback()
                return
            attempts.append(route.request.headers)
            if len(attempts) == 1:
                route.abort()
            else:
                route.continue_()

        page.route("**/api/missions/*/passes", drop_first)
        upload_ui(page, fname, data)
        ui(page, lambda: len(attempts) >= 2, "the console resends the dropped upload")
        assert attempts[0]["idempotency-key"] == attempts[1]["idempotency-key"]
        shows(page, role(page, "list", "Passes"), fname)
        shows(page, role(page, "list", "Passes"), "Parsed: 3 samples", seconds=SETTLE_WAIT)
        appears(page, page.get_by_text(re.compile(r"^Perilune ")).first, "perilune in the header")
        assert decode(capture(slider(page))).variance() > 0
    passes = mission(app_url, mid)["passes"]
    assert len(passes) == 1 and passes[0]["filename"] == unicodedata.normalize("NFC", fname) and passes[0]["state"] == "parsed"
    assert len(S3().keys(f"captures/{mid}/")) == 1
    alerts = ntfy.messages(f"perilune-{mid}", expected=1)
    assert len(alerts) == 1


@pytest.mark.timeout(300)
def test_wf_capture_upload_bad_lines(app_url, browser, ntfy):
    m = make_mission(app_url)
    mid = m["id"]
    long_line = (b"# one\n" + sample_line(0).encode() + b"\n# " + b"x" * 1997 + b"\n" + sample_line(1).encode() + b"\n")
    crash = lines("# crash " + uuid.uuid4().hex, "S,2026-03-14T01:00:00Z,0.0,0.0,0.0,0.0,1.0,0.0")
    with opened(browser, author_url(app_url, mid), DESKTOP, reduced_motion="reduce") as page:
        upload_ui(page, "long.cap", long_line)
        reason = REASONS["line_too_long"]
        shows(page, role(page, "list", "Passes"), f"Rejected at line 3: {reason}", seconds=SETTLE_WAIT)
        shows(page, role(page, "status", "Upload status"), f"long.cap rejected at line 3: {reason}.")
        alerts = [a for a in ntfy.messages(f"perilune-{mid}", expected=1) if a.get("priority") == 4]
        assert len(alerts) == 1
        r = upload(app_url, mid, crash, "crash.cap")
        assert r.status_code == 202
        cp = settled_pass(app_url, r.json()["id"], PARSER_FAILURE_BUDGET_S + POLL_SLACK_S)
        assert (cp["state"], cp["rejected_reason"], cp["rejected_line"]) == ("rejected", "parser_failed", None)
        page.reload()
        shows(page, role(page, "list", "Passes"), f"Rejected: {REASONS['parser_failed']}")
        urgent = [a for a in ntfy.messages(f"perilune-{mid}", expected=2) if a.get("priority") == 5]
        assert len(urgent) == 1
        btn = role(page, "button", "Delete long.cap")
        btn.focus()
        page.keyboard.press("Enter")
        dlg = role(page, "alertdialog", "Delete pass")
        appears(page, dlg, "Delete pass dialog")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        gone(page, dlg, "dialog closes")
        ui(page, lambda: is_focused(role(page, "list", "Passes")), "focus lands on the Passes list")
        btn2 = role(page, "button", "Delete crash.cap")
        btn2.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        ui(page, lambda: role(page, "button", "Delete crash.cap").count() == 0, "second rejected pass deleted")
        upload_ui(page, "fixed.cap", small_capture())
        shows(page, role(page, "list", "Passes"), "Parsed: 3 samples", seconds=SETTLE_WAIT)
    assert [x["filename"] for x in mission(app_url, mid)["passes"]] == ["fixed.cap"]


def _s(k: int) -> bytes:
    return sample_line(k).encode()


_T_UTC = iso(FIRST_UTC)
_BOM = b"\xef\xbb\xbf"
LINE_CASES = {
    "comments-and-blanks-counted": (b"# c\n\n \t\n" + _s(0) + b"\nX,1\n", ("rejected", 5, "unknown_record")),
    "byte-order-mark-at-start": (_BOM + _s(0) + b"\n" + _s(1) + b"\n", ("parsed", None, None)),
    "stray-mark": (_s(0) + b"\n" + _BOM + _s(1) + b"\n", ("rejected", 2, "bad_field")),
    "crlf-lines": (_s(0) + b"\r\n" + _s(1) + b"\r\n", ("parsed", None, None)),
    "fields-at-limits": (_s(0) + b"\n" + f"T,{_T_UTC},{'s' * 40},{'t' * 500}\n".encode(), ("parsed", None, None)),
    "speaker-41": (_s(0) + b"\n" + f"T,{_T_UTC},{'s' * 41},hello\n".encode(), ("rejected", 2, "bad_field")),
    "text-501": (_s(0) + b"\n" + f"T,{_T_UTC},SPK,{'t' * 501}\n".encode(), ("rejected", 2, "bad_field")),
    "empty-speaker": (_s(0) + b"\n" + f"T,{_T_UTC},,hello\n".encode(), ("rejected", 2, "bad_field")),
    "seven-fields": (b"S,2026-03-14T01:00:00Z,1837400.0,0.0,0.0,0.0,1385.6\n" + _s(0) + b"\n", ("rejected", 1, "bad_field")),
    "exponent-number": (b"S,2026-03-14T01:00:00Z,1.8374e6,0.0,0.0,0.0,1385.6,800.0\n", ("rejected", 1, "bad_field")),
    "impossible-utc": (b"S,2026-02-30T01:00:00Z,1837400.0,0.0,0.0,0.0,1385.6,800.0\n", ("rejected", 1, "bad_field")),
    "invalid-utf8": (b"S,2026-03-14T01:00:00Z,\xff,0.0,0.0,0.0,1385.6,800.0\n", ("rejected", 1, "bad_field")),
    "unknown-record": (_s(0) + b"\nX,1\n", ("rejected", 2, "unknown_record")),
    "out-of-order": (_s(1) + b"\n" + _s(0) + b"\n", ("rejected", 2, "out_of_order")),
    "equal-times": (_s(0) + b"\n" + _s(0) + b"\n", ("rejected", 2, "out_of_order")),
    "no-samples": (b"# only\n" + f"T,{_T_UTC},A,hi\n".encode(), ("rejected", 3, "no_samples")),
    "no-final-newline": (_s(0) + b"\n" + _s(1), ("parsed", None, None)),
}


LINE_CASE_IDS = ["comments-and-blanks-counted", "byte-order-mark-at-start", "stray-mark", "crlf-lines", "fields-at-limits", "speaker-41", "text-501", "empty-speaker", "seven-fields", "exponent-number", "impossible-utc", "invalid-utf8", "unknown-record", "out-of-order", "equal-times", "no-samples", "no-final-newline"]


@pytest.mark.parametrize("case", LINE_CASE_IDS, ids=LINE_CASE_IDS)
def test_capture_line_format(app_url, case):
    data, (state, line, reason) = LINE_CASES[case]
    m = make_mission(app_url)
    r = upload(app_url, m["id"], data, "format.cap")
    assert r.status_code == 202, r.text
    p = settled_pass(app_url, r.json()["id"])
    assert (p["state"], p["rejected_line"], p["rejected_reason"]) == (state, line, reason), p
    if state == "parsed":
        assert p["sample_count"] >= 1 and len(track(app_url, m["id"])) == p["sample_count"]
    else:
        assert track(app_url, m["id"]) == []
    assert call("GET", app_url, f"/api/passes/{p['id']}/capture").content == data


def test_parse_outcome(app_url, meilisearch):
    m = make_mission(app_url)
    mid = m["id"]
    good = upload(app_url, mid, small_capture(3, {0: ("KESTREL", "one"), 2: ("TESSERA", "two")}), "good.cap")
    gp = settled_pass(app_url, good.json()["id"])
    assert (gp["state"], gp["sample_count"], gp["transcript_line_count"], gp["rejected_line"], gp["rejected_reason"]) == ("parsed", 3, 2, None, None)
    assert len(mdocs(meilisearch, mid)) == 2
    v = mission(app_url, mid)["change_version"]
    bad = lines(sample_line(5), sample_line(6), f"T,{_T_UTC},GHOST,ghost line", "X,1")
    bp = settled_pass(app_url, upload(app_url, mid, bad, "bad.cap").json()["id"])
    assert (bp["state"], bp["rejected_line"], bp["rejected_reason"], bp["sample_count"]) == ("rejected", 4, "unknown_record", 0)
    assert len(track(app_url, mid)) == 3 and mission(app_url, mid)["sample_count"] == 3
    assert len(mdocs(meilisearch, mid)) == 2
    assert "GHOST" not in [s["name"] for s in jget(app_url, f"/api/missions/{mid}/speakers")["speakers"]]
    assert mission(app_url, mid)["change_version"] == v + 1
    last = audit(app_url, mid)[-1]
    assert last["kind"] == "pass.rejected" and last["data"] == {"pass_id": bp["id"], "rejected_line": 4, "rejected_reason": "unknown_record"}
    nos = settled_pass(app_url, upload(app_url, mid, lines("# nothing"), "none.cap").json()["id"])
    assert (nos["state"], nos["rejected_line"], nos["rejected_reason"]) == ("rejected", 2, "no_samples")


def test_upload_idempotent_replay(app_url):
    m = make_mission(app_url)
    mid, data, key = m["id"], small_capture(), idempotency_key()
    first = upload(app_url, mid, data, "k.cap", key=key)
    assert first.status_code == 202 and "idempotency-replayed" not in first.headers
    again = upload(app_url, mid, data, "k.cap", key=key)
    assert again.status_code == 202 and again.headers.get("idempotency-replayed") == "true" and again.json()["id"] == first.json()["id"]
    assert len(mission(app_url, mid)["passes"]) == 1 and len(S3().keys(f"captures/{mid}/")) == 1
    expect_error(upload(app_url, mid, small_capture(4), "k.cap", key=key), 422, {"error": "idempotency_key_reused"})
    expect_error(upload(app_url, mid, data, "renamed.cap", key=key), 422, {"error": "idempotency_key_reused"})
    nokey = call("POST", app_url, f"/api/missions/{mid}/passes", content=data, headers={"Content-Type": "application/octet-stream",
                 "X-Capture-Filename": "k.cap", "X-Capture-SHA256": __import__("hashlib").sha256(data).hexdigest()})
    expect_error(nokey, 422, {"error": "validation", "errors": {"idempotency_key": KEY_MSG}})
    race_key, race_data = idempotency_key(), small_capture(5)
    results = together([lambda: upload(app_url, mid, race_data, "race.cap", key=race_key) for _ in range(3)])
    firsts = [r for r in results if r.status_code == 202 and "idempotency-replayed" not in r.headers]
    assert len(firsts) == 1 and all(r.status_code in (202, 409) for r in results)
    assert all(r.json() == {"error": "idempotency_request_in_progress"} for r in results if r.status_code == 409)
    assert len([x for x in mission(app_url, mid)["passes"] if x["filename"] == "race.cap"]) == 1


LINE_LIMIT = 1024
SAMPLE_CAP = 50000
PARSE_BUDGET_S = 10


def test_bounded_parsing(app_url):
    m = make_mission(app_url)
    mid = m["id"]
    ok = settled_pass(app_url, upload(app_url, mid, b"#" * LINE_LIMIT + b"\n" + _s(0) + b"\n", "edge.cap").json()["id"])
    assert ok["state"] == "parsed"
    over = settled_pass(app_url, upload(app_url, mid, b"#" * (LINE_LIMIT + 1) + b"\n" + _s(0) + b"\n", "over.cap").json()["id"])
    assert (over["state"], over["rejected_line"], over["rejected_reason"]) == ("rejected", 1, "line_too_long")
    many = "\n".join(f"S,{iso(FIRST_UTC + timedelta(seconds=k))},1837400.0,0.0,0.0,0.0,1385.6,800.0" for k in range(SAMPLE_CAP + 1)) + "\n"
    r = upload(app_url, mid, many.encode(), "many.cap")
    assert r.status_code == 202
    t0 = time.monotonic()
    p = settled_pass(app_url, r.json()["id"], PARSE_BUDGET_S + POLL_SLACK_S)
    assert time.monotonic() - t0 <= PARSE_BUDGET_S + POLL_SLACK_S
    assert (p["state"], p["rejected_line"], p["rejected_reason"]) == ("rejected", SAMPLE_CAP + 1, "too_many_samples")
    r = upload(app_url, mid, b"#" * CAPTURE_LIMIT, "huge.cap")
    assert r.status_code == 202
    t0 = time.monotonic()
    p = settled_pass(app_url, r.json()["id"], PARSE_BUDGET_S + POLL_SLACK_S)
    assert time.monotonic() - t0 <= PARSE_BUDGET_S + POLL_SLACK_S
    assert (p["state"], p["rejected_line"], p["rejected_reason"]) == ("rejected", 1, "line_too_long")
    for x in mission(app_url, mid)["passes"]:
        call("DELETE", app_url, f"/api/passes/{x['id']}")


def test_capture_conditional_range(app_url):
    import base64
    import hashlib
    data = _BOM + b"# kept\n" + small_capture()
    m, p, _ = parsed_mission(app_url, data)
    size, sha = len(data), p["sha256"]
    tok = make_share(app_url, m["id"])["token"]
    etag = f'"{sha}"'
    digest = "sha-256=:" + base64.b64encode(hashlib.sha256(data).digest()).decode() + ":"
    for path in (f"/api/passes/{p['id']}/capture", f"/api/share/{tok}/captures/{p['id']}"):
        r = call("GET", app_url, path)
        assert r.status_code == 200 and r.content == data
        assert r.headers["etag"] == etag and r.headers["repr-digest"] == digest and r.headers["accept-ranges"] == "bytes"
        assert r.headers["content-type"] == "application/octet-stream" and int(r.headers["content-length"]) == size and "last-modified" not in r.headers
        h = call("HEAD", app_url, path)
        assert h.status_code == 200 and h.content == b"" and h.headers["etag"] == etag and h.headers["repr-digest"] == digest
        for inm in (etag, f"W/{etag}", "*"):
            n = call("GET", app_url, path, headers={"If-None-Match": inm})
            assert n.status_code == 304 and n.headers["etag"] == etag and n.content == b""
        assert call("GET", app_url, path, headers={"If-None-Match": '"other"'}).status_code == 200
        expect_error(call("GET", app_url, path, headers={"If-Match": '"other"', "If-None-Match": etag}), 412, {"error": "precondition_failed"})
        assert call("GET", app_url, path, headers={"If-Match": etag}).status_code == 200
        for rng, lo, hi in (("bytes=0-9", 0, 9), ("bytes=-5", size - 5, size - 1), ("bytes=5-", 5, size - 1), ("bytes=0-99999999", 0, size - 1)):
            s = call("GET", app_url, path, headers={"Range": rng})
            assert s.status_code == 206 and s.content == data[lo:hi + 1], rng
            assert s.headers["content-range"] == f"bytes {lo}-{hi}/{size}" and s.headers["repr-digest"] == digest
        hr = call("HEAD", app_url, path, headers={"Range": "bytes=0-9"})
        assert hr.status_code == 206 and hr.content == b"" and hr.headers["content-range"] == f"bytes 0-9/{size}"
        bad = call("GET", app_url, path, headers={"Range": f"bytes={size + 100}-"})
        expect_error(bad, 416, {"error": "range_not_satisfiable"})
        assert bad.headers["content-range"] == f"bytes */{size}"
        assert call("HEAD", app_url, path, headers={"Range": f"bytes={size + 100}-"}).status_code == 416
        mism = call("GET", app_url, path, headers={"Range": f"bytes={size + 100}-", "If-Range": '"other"'})
        assert mism.status_code == 200 and mism.content == data
        assert call("GET", app_url, path, headers={"Range": "items=0-3"}).status_code == 200
        assert call("GET", app_url, path, headers={"Range": "bytes=0-3", "If-Range": etag}).status_code == 206
    pin(app_url, m["id"], 7200 if False else FIRST_MET, "Csv etag")
    path = f"/api/share/{tok}/events.csv"
    r = call("GET", app_url, path)
    assert r.headers["etag"] == '"' + hashlib.sha256(r.content).hexdigest() + '"'
    h = call("HEAD", app_url, path)
    assert h.status_code == 200 and h.content == b"" and h.headers["etag"] == r.headers["etag"]


def test_capture_filename_utf8(app_url):
    m = make_mission(app_url)
    mid = m["id"]
    decomposed = "cafe\u0301 ✓–pass \"q\" 100%.cap"
    nfc = unicodedata.normalize("NFC", decomposed)
    r = upload(app_url, mid, small_capture(), decomposed)
    assert r.status_code == 202 and r.json()["filename"] == nfc
    pid = r.json()["id"]
    settled_pass(app_url, pid)
    cd = call("GET", app_url, f"/api/passes/{pid}/capture").headers["content-disposition"]
    assert cd.startswith("attachment")
    plain, ext = disposition_names(cd)
    assert plain == fallback_name(nfc) and ext == nfc
    r2 = upload(app_url, mid, small_capture(), "plain-pass.cap")
    settled_pass(app_url, r2.json()["id"])
    cd2 = call("GET", app_url, f"/api/passes/{r2.json()['id']}/capture").headers["content-disposition"]
    assert disposition_names(cd2) == ("plain-pass.cap", None)
    long_ok = "e\u0301" * 120
    assert upload(app_url, mid, small_capture(), long_ok).status_code == 202
    stored = [e["data"]["filename"] for e in audit(app_url, mid) if e["kind"] == "pass.stored"]
    assert nfc in stored and unicodedata.normalize("NFC", long_ok) in stored
    for raw in (b"caf\xc3\xa9.cap", "%G1x", "%FFx", "a%2Fb", "a%5Cb", "a%01b", "", "a" * 121):
        expect_error(upload(app_url, mid, small_capture(), raw_name=raw), 422, {"error": "validation", "errors": {"filename": FILENAME_MSG}})


def test_redelivered_parse_adds_nothing(app_url, meilisearch, svix, ntfy):
    m = make_mission(app_url)
    mid, count = m["id"], 5
    ids = []
    for i in range(count):
        r = upload(app_url, mid, small_capture(3, {0: ("KESTREL", f"line a {i}"), 1: ("TESSERA", f"line b {i}")}))
        assert r.status_code == 202
        ids.append(r.json()["id"])
    for pid in ids:
        assert settled_pass(app_url, pid)["state"] == "parsed"
    wait_for(lambda: len([x for x in svix_messages(svix, mid) if x.get("eventType") == "pass.parsed"]) >= count, "one pass.parsed webhook per pass")
    ntfy.messages(f"perilune-{mid}", expected=count)
    deadline = time.monotonic() + OBSERVE_S
    while time.monotonic() < deadline:
        assert len(track(app_url, mid)) == 3 * count
        assert len(jget(app_url, f"/api/missions/{mid}/transcript")["lines"]) == 2 * count
        assert len(mdocs(meilisearch, mid)) == 2 * count
        assert mission(app_url, mid)["change_version"] == count
        kinds = [e["kind"] for e in audit(app_url, mid)]
        assert kinds.count("pass.parsed") == count and kinds.count("pass.stored") == count
    hooks = [x for x in svix_messages(svix, mid) if x.get("eventType") == "pass.parsed"]
    assert len(hooks) == count and len({x["eventId"] for x in hooks}) == count
    assert len(ntfy.messages(f"perilune-{mid}")) == count


def test_push_alerts(app_url, ntfy):
    name = unique("Mission")[0] + " é"
    m = make_mission(app_url, name=name)
    mid = m["id"]
    topic = f"perilune-{mid}"
    r = upload(app_url, mid, small_capture(3, {0: ("KESTREL", "one")}), "ok.cap")
    p = settled_pass(app_url, r.json()["id"])
    first = ntfy.messages(topic, expected=1)[0]
    assert (first.get("title"), first.get("message"), first.get("priority", 3), first.get("tags")) == (f"{name}: pass parsed", "ok.cap: 3 samples, 1 transcript line.", 3, ["white_check_mark"])
    met0 = track(app_url, mid)[0]["met"]
    assert first.get("click") is None or first["click"].endswith(f"/missions/{mid}?t={met0}")
    upload(app_url, mid, lines(sample_line(0), "X,1"), "bad.cap")
    second = [a for a in ntfy.messages(topic, expected=2) if a.get("priority") == 4]
    assert [(a["title"], a["message"], a["tags"]) for a in second] == [(f"{name}: pass rejected", f"bad.cap: line 2, {REASONS['unknown_record']}.", ["warning"])]
    assert second[0].get("click") is None or second[0]["click"].endswith(f"/missions/{mid}")
    upload(app_url, mid, lines("S,2026-03-14T01:00:00Z,0.0,0.0,0.0,0.0,1.0,0.0"), "crash.cap")
    third = [a for a in ntfy.messages(topic, expected=3, timeout=PARSER_FAILURE_BUDGET_S + OBSERVE_S) if a.get("priority") == 5]
    assert [(a["title"], a["message"], a["tags"]) for a in third] == [(f"{name}: pass rejected", f"crash.cap: {REASONS['parser_failed']}.", ["rotating_light"])]
    assert len(ntfy.messages(topic)) == 3 and p["state"] == "parsed"
    seed = next(x for x in jget(app_url, "/api/missions")["missions"] if x["name"] == SEED_NAME)
    assert not [a for a in ntfy.messages(f"perilune-{seed['id']}") if a.get("title") == f"{SEED_NAME}: pass parsed"]


def test_derived_values(app_url):
    m, p, data = parsed_mission(app_url)
    before = track(app_url, m["id"])
    assert len(before) == SEED_COUNT
    for s, (_, v) in zip(before, parse_samples(data)):
        x, y, z, vx, vy, vz = v
        r = math.sqrt(x * x + y * y + z * z)
        assert abs(s["altitude_m"] - (r - MOON_R)) <= DERIVED_TOL
        assert abs(s["lat_deg"] - math.degrees(math.atan2(z, math.hypot(x, y)))) <= DERIVED_TOL
        assert abs((s["lon_deg"] - math.degrees(math.atan2(y, x)) + 180) % 360 - 180) <= DERIVED_TOL
        assert -180 < s["lon_deg"] <= 180
        assert abs(s["speed_m_s"] - math.sqrt(vx * vx + vy * vy + vz * vz)) <= DERIVED_TOL
    peri = m["perilune"]
    assert (peri["met"], peri["met_label"]) == (7200, "+000:02:00:00")
    assert abs(peri["altitude_m"] - min(s["altitude_m"] for s in before)) <= DERIVED_TOL
    assert abs(peri["lon_deg"] - 180) <= DERIVED_TOL and peri["residual_m"] is None
    assert patch(app_url, m["id"], {"distance_unit": "nmi", "speed_unit": "ft_s"}).status_code == 200
    assert track(app_url, m["id"]) == before and mission(app_url, m["id"])["perilune"] == peri


def test_met_labels(app_url):
    epoch = iso(FIRST_UTC + timedelta(seconds=30))
    m, p, _ = parsed_mission(app_url, orbit_capture(range(6), {1: ("KESTREL", "early")}, head=("# met",)), epoch=epoch)
    tr = track(app_url, m["id"])
    assert [(s["met"], s["met_label"]) for s in tr] == [(t, met_label(t)) for t in (-30, -20, -10, 0, 10, 20)]
    assert tr[0]["met_label"] == "T-000:00:00:30" and tr[3]["met_label"] == "+000:00:00:00"
    line = jget(app_url, f"/api/missions/{m['id']}/transcript")["lines"][0]
    assert (line["met"], line["met_label"]) == (-20, "T-000:00:00:20")
    ev = pin(app_url, m["id"], -15, "early pin")
    assert ev.status_code == 201 and (ev.json()["met"], ev.json()["met_label"]) == (-20, "T-000:00:00:20")
    old = "2023-01-01T00:00:00Z"
    m2, _, _ = parsed_mission(app_url, small_capture(), epoch=old)
    s0 = track(app_url, m2["id"])[0]
    expected = int((FIRST_UTC - parse_iso(old)).total_seconds())
    assert (s0["met"], s0["met_label"]) == (expected, met_label(expected))


def test_loupe_lens_and_readout(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tr, lon0 = track(app_url, m["id"]), m["perilune"]["lon_deg"]
    with opened(browser, author_url(app_url, m["id"]), TABLET, reduced_motion="reduce") as page:
        appears(page, slider(page), "Track loupe")
        slider(page).scroll_into_view_if_needed()
        box = slider(page).bounding_box()
        lens = role(page, "img", "Loupe")
        page.mouse.move(0, 0)
        far = far_point(tr, box, lon0)
        page.mouse.move(*far)
        advance(page, 500)
        assert lens.count() == 0, "no sample within 24 px keeps the lens closed"
        page.mouse.move(0, 0)
        pt = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        k, (px, py), _ = nearest(tr, box, lon0, pt)
        page.mouse.move(*pt)
        appears(page, lens, "lens opens on pointer enter")
        cx, cy, lb = lens_centre(page)
        assert abs(lb["width"] - LENS_PX) <= GEOM_TOL and abs(lb["height"] - LENS_PX) <= GEOM_TOL
        assert math.hypot(cx - px, cy - py) <= GEOM_TOL
        assert slider_now(page) == k
        for line in plate_lines(tr[k]):
            assert line in plate(page), f"plate lacks {line!r}: {plate(page)}"
        assert "ΔR" not in plate(page)
        assert decode(capture(lens)).variance() > 0
        page.mouse.move(0, 0)
        gone(page, lens, "lens shrinks away when the pointer leaves")
        assert f"MET {tr[k]['met_label']}" in plate(page)
        slider(page).focus()
        appears(page, lens, "lens opens on keyboard focus")
        cx, cy, _ = lens_centre(page)
        assert math.hypot(cx - px, cy - py) <= GEOM_TOL


def test_wf_track_loupe_keyboard(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tr = track(app_url, m["id"])
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        appears(page, slider(page), "Track loupe")
        s = slider(page)
        assert s.evaluate("el => [el.getAttribute('aria-valuemin') ?? el.min, el.getAttribute('aria-valuemax') ?? el.max].map(Number)") == [0, SEED_COUNT - 1]
        s.focus()
        steps = [("ArrowRight", 1), ("ArrowUp", 2), ("ArrowLeft", 1), ("ArrowDown", 0), ("Shift+ArrowRight", 60), ("End", SEED_COUNT - 1),
                 ("Shift+ArrowRight", SEED_COUNT - 1), ("Shift+ArrowLeft", SEED_COUNT - 61), ("Home", 0), ("Shift+ArrowLeft", 0)]
        for key, index in steps:
            page.keyboard.press(key)
            ui(page, lambda: slider_now(page) == index, f"{key} moves the lens to sample {index}")
            sample = tr[index]
            assert slider_text(page) == f"{sample['met_label']}, altitude {dist(sample['altitude_m'])}"
            ui(page, lambda: params(page).get("t") == str(sample["met"]), f"key-up writes t={sample['met']}")
    api = tr[0]
    assert (api["met"], api["index"]) == (FIRST_MET, 0)


def test_moment_links(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tr, lon0 = track(app_url, m["id"]), m["perilune"]["lon_deg"]
    with opened(browser, author_url(app_url, m["id"], x="keep", t="7205"), TABLET, reduced_motion="reduce") as page:
        ui(page, lambda: slider_now(page) == 360, "t=7205 places the lens on the sample at or before it")
        assert "MET +000:02:00:00" in plate(page) and role(page, "img", "Loupe").count() == 0
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        ui(page, lambda: params(page).get("t") == "7210" and params(page).get("x") == "keep", "key step writes t and keeps x")
        slider(page).blur()
        box = slider(page).bounding_box()
        k, (px, py), _ = nearest(tr, box, lon0, (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2))
        page.mouse.move(0, 0)
        page.mouse.move(px, py)
        page.mouse.down()
        page.mouse.up()
        ui(page, lambda: params(page).get("t") == str(tr[k]["met"]), "pointer release writes t")
    for bad in ("abc", "5", "7200.5"):
        with opened(browser, author_url(app_url, m["id"], t=bad), DESKTOP, reduced_motion="reduce") as page:
            appears(page, slider(page), "Track loupe")
            ui(page, lambda: slider_now(page) == 0 and "MET +000:01:00:00" in plate(page), f"t={bad} uses the first sample")


def test_current_transcript_line(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    name = {k: f"{met_label(FIRST_MET + STEP_S * k)} {sp}: {tx}" for k, (sp, tx) in SEED_TRANSCRIPT.items()}
    with opened(browser, author_url(app_url, m["id"], t="7170"), DESKTOP, reduced_motion="reduce") as page:
        lst = role(page, "list", "Transcript lines")
        line = lambda k: lst.get_by_role("button", name=name[k], exact=True)
        ui(page, lambda: line(355).get_attribute("aria-current") == "true", "line k=355 is current at MET 7170")
        assert all(line(k).get_attribute("aria-current") != "true" for k in name if k != 355)
        inview = line(355).evaluate("""el => { const r = el.getBoundingClientRect(); let a = el.parentElement;
            while (a && !(['auto','scroll'].includes(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight)) a = a.parentElement;
            const b = a ? a.getBoundingClientRect() : {top: 0, bottom: innerHeight};
            return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; }""")
        assert inview, "the current line scrolls into view"
        line(120).click()
        ui(page, lambda: slider_now(page) == 120 and params(page).get("t") == "4800", "click moves the lens to the line")
        assert line(120).get_attribute("aria-current") == "true"
        line(600).focus()
        page.keyboard.press("Enter")
        ui(page, lambda: slider_now(page) == 600 and params(page).get("t") == "9600", "Enter on a line moves the lens")


def test_wf_track_loupe_touch(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tr, lon0 = track(app_url, m["id"]), m["perilune"]["lon_deg"]
    with opened(browser, author_url(app_url, m["id"]), PHONE, reduced_motion="reduce") as page:
        appears(page, slider(page), "Track loupe")
        slider(page).scroll_into_view_if_needed()
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        box = slider(page).bounding_box()
        k1, (x1, y1), _ = nearest(tr, box, lon0, (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2))
        x2, y2, vis = project(box, tr[330]["lat_deg"], tr[330]["lon_deg"], lon0)
        assert vis
        k2 = nearest(tr, box, lon0, (x2, y2))[0]
        scroll0 = page.evaluate("scrollY")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x1, "y": y1}]})
        appears(page, role(page, "img", "Loupe"), "touch opens the lens")
        ui(page, lambda: slider_now(page) == k1, "touch start picks the nearest sample")
        for f in (0.25, 0.5, 0.75, 1.0):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x1 + (x2 - x1) * f, "y": y1 + (y2 - y1) * f}]})
            advance(page, STEP_MS)
        ui(page, lambda: slider_now(page) == k2, "dragging moves the lens")
        assert page.evaluate("scrollY") == scroll0, "dragging the lens must not scroll the page"
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        ui(page, lambda: params(page).get("t") == str(tr[k2]["met"]), "lifting the finger writes t")
        assert role(page, "img", "Loupe").count() == 1
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        lens = role(page, "img", "Loupe")
        b = lens.bounding_box()
        assert abs(b["width"] - LENS_PX) <= GEOM_TOL and animations(lens) == []
        assert animations(role(page, "group", "Readout")) == [], "numerals change in place under reduced motion"
    with opened(browser, author_url(app_url, m["id"]), PHONE, reduced_motion="no-preference") as page:
        appears(page, slider(page), "Track loupe")
        slider(page).focus()
        lens = role(page, "img", "Loupe")
        ui(page, lambda: lens.count() > 0, "lens opens on focus")
        b = lens.bounding_box()
        assert animations(lens) or b["width"] < LENS_PX - GEOM_TOL, "with motion on the lens grows rather than appearing at full size"
    assert jget(app_url, f"/api/missions/{m['id']}/track")["samples"][k2]["met"] == tr[k2]["met"]


def test_wf_track_loupe_go_to_gmt(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    link = make_share(app_url, m["id"])
    for url in (author_url(app_url, m["id"]), share_url(app_url, link["token"])):
        with opened(browser, url, DESKTOP, reduced_motion="reduce") as page:
            box = role(page, "textbox", "Go to GMT")
            appears(page, box, "Go to GMT")
            box.fill("2026-073/02:00:05")
            box.press("Enter")
            ui(page, lambda: slider_now(page) == 360 and params(page).get("t") == "7200", "Go to GMT jumps to k=360 and writes t")
            assert "MET +000:02:00:00" in plate(page) and is_focused(box) and role(page, "img", "Loupe").count() == 0
            box.fill("2026-073/01:30:00")
            role(page, "button", "Go").click()
            ui(page, lambda: slider_now(page) == 180 and params(page).get("t") == "5400", "Go button jumps to k=180")
            box.fill("2026-073/00:00:00")
            box.press("Enter")
            ui(page, lambda: slider_now(page) == 0, "a time before every sample uses the first sample")
            box.fill("2026-073/24:00:00")
            box.press("Enter")
            appears(page, page.get_by_text(DOY_ERR, exact=True), "day-of-year field error")
            assert box.get_attribute("aria-invalid") == "true" and slider_now(page) == 0
    assert track(app_url, m["id"])[360]["met"] == 7200


def test_pointer_picking(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tr, lon0 = track(app_url, m["id"]), m["perilune"]["lon_deg"]
    for scale in (1, 2):
        with opened(browser, author_url(app_url, m["id"]), TABLET, scale=scale, reduced_motion="reduce") as page:
            appears(page, slider(page), "Track loupe")
            slider(page).scroll_into_view_if_needed()
            box = slider(page).bounding_box()
            x, y, vis = project(box, tr[300]["lat_deg"], tr[300]["lon_deg"], lon0)
            assert vis
            pt = (x + 10, y - 6)
            k, (px, py), d = nearest(tr, box, lon0, pt)
            assert d <= PICK_PX
            page.mouse.move(0, 0)
            page.mouse.move(*pt)
            appears(page, role(page, "img", "Loupe"), f"lens opens at dpr {scale}")
            cx, cy, _ = lens_centre(page)
            assert slider_now(page) == k and math.hypot(cx - px, cy - py) <= GEOM_TOL
            page.mouse.move(*far_point(tr, box, lon0))
            advance(page, 500)
            cx2, cy2, _ = lens_centre(page)
            assert slider_now(page) == k and math.hypot(cx2 - cx, cy2 - cy) <= GEOM_TOL, "a far move leaves the lens where it is"


def test_forced_colours_disc(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    with opened(browser, author_url(app_url, m["id"]), TABLET, reduced_motion="reduce") as page:
        appears(page, slider(page), "Track loupe")
        before = capture(slider(page))
        page.emulate_media(forced_colors="active")
        advance(page, 500)
        after = capture(slider(page))
        assert difference(decode(before), decode(after)) > 0, "the disc is redrawn when forced colours turn on"
        canvas_rgb = tuple(page.evaluate("""() => { const d = document.createElement('div'); d.style.color = 'Canvas'; document.body.append(d);
            const c = getComputedStyle(d).color.match(/\\d+/g).slice(0, 3).map(Number); d.remove(); return c; }"""))
        w, h, rows = png_pixels(after)
        disc = [rows[y][x] for y in range(0, h, 3) for x in range(0, w, 3) if (x - w / 2) ** 2 + (y - h / 2) ** 2 < (w / 2.2) ** 2]
        common = max(set(disc), key=disc.count)
        assert max(abs(a - b) for a, b in zip(common, canvas_rgb)) <= 8, "disc fill is the Canvas colour"
        centre = [rows[y][x] for y in range(h // 2 - 4, h // 2 + 5) for x in range(w // 2 - 4, w // 2 + 5)]
        assert max(contrast(c, canvas_rgb) for c in centre) >= 3, "track and perilune mark keep 3:1 against the disc"
        slider(page).focus()
        appears(page, role(page, "img", "Loupe"), "lens")
        _, _, lrows = png_pixels(capture(role(page, "img", "Loupe")))
        assert max(contrast(c, canvas_rgb) for r in lrows for c in r) >= 3


def expected_frame(tr, samples, t_ms):
    t = t_ms / 1000
    a = max(i for i, s in enumerate(tr) if s["met"] <= t)
    if a + 1 >= len(tr) or tr[a + 1]["met"] - tr[a]["met"] > HOLD_GAP_S:
        s = tr[a]
        return s["altitude_m"], s["lat_deg"], s["lon_deg"], s["speed_m_s"]
    h = tr[a + 1]["met"] - tr[a]["met"]
    sv, bv = samples[a][1], samples[a + 1][1]
    u = (t - tr[a]["met"]) / h
    p = [(2 * u**3 - 3 * u**2 + 1) * sv[i] + (u**3 - 2 * u**2 + u) * h * sv[3 + i] + (-2 * u**3 + 3 * u**2) * bv[i] + (u**3 - u**2) * h * bv[3 + i] for i in range(3)]
    v = [((6 * u**2 - 6 * u) * sv[i] + (3 * u**2 - 4 * u + 1) * h * sv[3 + i] + (-6 * u**2 + 6 * u) * bv[i] + (3 * u**2 - 2 * u) * h * bv[3 + i]) / h for i in range(3)]
    r = math.sqrt(sum(c * c for c in p))
    return r - MOON_R, math.degrees(math.atan2(p[2], math.hypot(p[0], p[1]))), math.degrees(math.atan2(p[1], p[0])), math.sqrt(sum(c * c for c in v))


def test_frames_api(app_url):
    m, p, data = parsed_mission(app_url)
    mid, tr, samples = m["id"], track(app_url, m["id"]), parse_samples(seed_capture())
    body = jget(app_url, f"/api/missions/{mid}/frames?from=3600&to=3610&fps=1")
    fr = body["frames"]
    assert body["fps"] == 1 and [f["met_ms"] for f in fr] == [FIRST_MET * 1000 + 1000 * k for k in range(11)]
    assert all(type(f["k"]) is int and type(f["met_ms"]) is int for f in fr)
    for f, s in ((fr[0], tr[0]), (fr[10], tr[1])):
        assert abs(f["altitude_m"] - s["altitude_m"]) <= FRAME_M_TOL and abs(f["lat_deg"] - s["lat_deg"]) <= FRAME_DEG_TOL
    for fps in (5, 10, 25):
        frs = jget(app_url, f"/api/missions/{mid}/frames?from=3600&to=3620&fps={fps}")["frames"]
        assert [f["met_ms"] for f in frs] == [FIRST_MET * 1000 + round(k * 1000 / fps) for k in range(len(frs))] and len(frs) == 20 * fps + 1
        for f in frs:
            alt, lat, lon, sp = expected_frame(tr, samples, f["met_ms"])
            assert abs(f["altitude_m"] - alt) <= FRAME_M_TOL and abs(f["speed_m_s"] - sp) <= FRAME_M_TOL
            assert abs(f["lat_deg"] - lat) <= FRAME_DEG_TOL and abs((f["lon_deg"] - lon + 180) % 360 - 180) <= FRAME_DEG_TOL
    assert len(jget(app_url, f"/api/missions/{mid}/frames?from=3600&to={FIRST_MET + MAX_FRAMES - 1}&fps=1")["frames"]) == MAX_FRAMES
    expect_error(call("GET", app_url, f"/api/missions/{mid}/frames?from=3600&to={FIRST_MET + MAX_FRAMES}&fps=1"), 422, {"error": "validation", "errors": {"to": FRAMES_MSG}})
    expect_error(call("GET", app_url, f"/api/missions/{mid}/frames?from=0&to=99999&fps=2"), 422, {"error": "validation", "errors": {"fps": FPS_MSG, "from": FROM_MSG, "to": TO_MSG}})
    expect_error(call("GET", app_url, f"/api/missions/{mid}/frames?from=3610&to=3600&fps=1"), 422, {"error": "validation", "errors": {"to": TO_MSG}})
    expect_error(call("GET", app_url, f"/api/missions/{mid}/frames?from=3600.5&to=3610&fps=1"), 422, {"error": "validation", "errors": {"from": FROM_MSG}})
    gap = lines("# gap", sample_line(0), sample_line(0, FIRST_UTC + timedelta(seconds=HOLD_GAP_S + 1)),
                sample_line(1, FIRST_UTC + timedelta(seconds=HOLD_GAP_S + 1)), sample_line(1, FIRST_UTC + timedelta(seconds=2 * HOLD_GAP_S + 1)))
    g, _, gdata = parsed_mission(app_url, gap)
    gtr, gs = track(app_url, g["id"]), parse_samples(gap)
    held_frame = jget(app_url, f"/api/missions/{g['id']}/frames?from=3900&to=3900&fps=1")["frames"][0]
    assert abs(held_frame["altitude_m"] - gtr[0]["altitude_m"]) <= FRAME_M_TOL and abs(held_frame["speed_m_s"] - gtr[0]["speed_m_s"]) <= FRAME_M_TOL
    t = gtr[2]["met"] + HOLD_GAP_S // 2
    f = jget(app_url, f"/api/missions/{g['id']}/frames?from={t}&to={t}&fps=1")["frames"][0]
    assert abs(f["altitude_m"] - expected_frame(gtr, gs, t * 1000)[0]) <= FRAME_M_TOL, "a gap of exactly 600 s is interpolated"
    empty = make_mission(app_url)
    expect_error(call("GET", app_url, f"/api/missions/{empty['id']}/frames?from=0&to=1&fps=1"), 409, {"error": "mission_has_no_samples"})


def frame_lines(epoch: str, f: dict) -> list[str]:
    sec = f["met_ms"] // 1000
    return [f"MET {met_label(sec)}", f"GMT {gmt(iso(parse_iso(epoch) + timedelta(seconds=sec)))}", f"LAT {lat_fmt(f['lat_deg'])}",
            f"LON {lon_fmt(f['lon_deg'])}", f"ALT {dist(f['altitude_m'])}", f"SPD {spd(f['speed_m_s'])}"]


def read_plate_until(page, expected: list[str], step_ms: float, tries: int, what: str) -> None:
    for _ in range(tries):
        if all(line in plate(page) for line in expected):
            return
        advance(page, step_ms)
    if all(line in plate(page) for line in expected):
        return
    pytest.fail(f"{what}: expected {expected}, plate shows {plate(page)!r}")


def test_wf_playback_play(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tr = track(app_url, m["id"])
    elapsed = 1050
    frames = jget(app_url, f"/api/missions/{m['id']}/frames?from={FIRST_MET}&to={FIRST_MET + 2}&fps=10")["frames"]
    shown = max((f for f in frames if f["met_ms"] <= FIRST_MET * 1000 + elapsed), key=lambda f: f["met_ms"])
    with opened(browser, author_url(app_url, m["id"]), DESKTOP) as page:
        appears(page, slider(page), "Track loupe")
        assert role(page, "radio", "1×").is_checked()
        role(page, "button", "Play").click()
        pause = role(page, "button", "Pause")
        appears(page, pause, "Play becomes Pause")
        assert is_focused(pause) and role(page, "radio", "10×").is_disabled()
        advance(page, elapsed)
        read_plate_until(page, frame_lines(SEED_EPOCH, shown), 2, 40, "1x playback shows the server frame")
        pause.click()
        appears(page, role(page, "button", "Play"), "Pause returns to Play")
        ui(page, lambda: slider_now(page) == 0 and params(page).get("t") == str(FIRST_MET), "Pause snaps to the played sample and writes t")
        assert not role(page, "radio", "1×").is_disabled()
        role(page, "radio", "60×").check()
        role(page, "button", "Play").click()
        appears(page, role(page, "button", "Pause"), "playing at 60x")
        advance(page, 1000)
        read_plate_until(page, ["MET +000:01:01:00"], 1, 17, "60x for one second of page time reaches MET +000:01:01:00")
        role(page, "button", "Pause").click()
        ui(page, lambda: slider_now(page) == 6 and params(page).get("t") == str(FIRST_MET + 6 * STEP_S), "Pause on sample k=6")
        read_plate_until(page, plate_lines(tr[6]), STEP_MS, 20, "plate shows the paused sample's own values")
        start = tr[6]["met"]
        grid = jget(app_url, f"/api/missions/{m['id']}/frames?from={start}&to={start + 6}&fps=25")["frames"]
        window = [frame_lines(SEED_EPOCH, f) for f in grid if (start + 5) * 1000 <= f["met_ms"] < (start + 6) * 1000]
        role(page, "radio", "10×").check()
        role(page, "button", "Play").click()
        appears(page, role(page, "button", "Pause"), "playing at 10x")
        advance(page, 500)
        ui(page, lambda: any(all(line in plate(page) for line in lines) for lines in window), "10x shows the interpolated server frame between samples", step_ms=2)
        role(page, "button", "Pause").click()
    assert tr[6]["met"] == FIRST_MET + 6 * STEP_S


def test_wf_playback_reduced_motion(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tr = track(app_url, m["id"])
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        appears(page, slider(page), "Track loupe")
        role(page, "button", "Play").click()
        appears(page, role(page, "button", "Pause"), "playing")
        advance(page, 5050)
        read_plate_until(page, plate_lines(tr[0]), 2, 20, "reduced motion shows sample k=0, not an interpolated frame")
        advance(page, 5000)
        read_plate_until(page, plate_lines(tr[1]), 2, 20, "reduced motion moves to sample k=1")
        role(page, "button", "Pause").click()
        ui(page, lambda: slider_now(page) == 1 and params(page).get("t") == str(tr[1]["met"]), "Pause writes t")


def test_pin_event_api(app_url):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    base = mission(app_url, mid)["change_version"]
    r = pin(app_url, mid, 7205, 'Perilune, "pass"', "private words")
    assert r.status_code == 201, r.text
    ev = r.json()
    assert (ev["met"], ev["met_label"], ev["title"], ev["note"], ev["pass_id"]) == (7200, "+000:02:00:00", 'Perilune, "pass"', "private words", p["id"])
    assert abs(ev["sample"]["altitude_m"] - track(app_url, mid)[360]["altitude_m"]) <= DERIVED_TOL
    assert jget(app_url, f"/api/missions/{mid}/events")["events"] == [ev]
    assert mission(app_url, mid)["change_version"] == base + 1
    cases = [
        ({"met": 7200.5, "title": "t"}, {"met": MET_MSG}), ({"met": "+000:02:00:00", "title": "t"}, {"met": MET_MSG}),
        ({"met": FIRST_MET - 300, "title": "t"}, {"met": NO_SAMPLE_MSG}), ({"met": 7200, "title": ""}, {"title": TITLE_MSG}),
        ({"met": 7200, "title": "t" * 121}, {"title": TITLE_MSG}), ({"met": 7200, "title": "t", "note": "n" * 2001}, {"note": NOTE_MSG}),
        ({"title": "t"}, {"met": MET_MSG}),
    ]
    for body, errors in cases:
        expect_error(post_json(app_url, f"/api/missions/{mid}/events", body, key=idempotency_key()), 422, {"error": "validation", "errors": errors})
    assert pin(app_url, mid, 7200, "t" * 120, "n" * 2000).status_code == 201
    assert len(jget(app_url, f"/api/missions/{mid}/events")["events"]) == 2 and mission(app_url, mid)["change_version"] == base + 2


def test_wf_event_pinning_keyboard(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    title, note = unique("Pinned")[0], unique("note")[0]
    with opened(browser, author_url(app_url, m["id"], t="7200"), DESKTOP, reduced_motion="reduce") as page:
        ui(page, lambda: slider_now(page) == 360, "lens on k=360")
        slider(page).focus()
        page.keyboard.press("Enter")
        dlg = role(page, "dialog", "Pin event")
        appears(page, dlg, "Pin event dialog")
        met, ttl, nt = role(dlg, "textbox", "MET"), role(dlg, "textbox", "Title"), role(dlg, "textbox", "Private note")
        save, cancel = role(dlg, "button", "Save event"), role(dlg, "button", "Cancel")
        assert is_focused(ttl) and met.input_value() == "+000:02:00:00"
        appears(page, dlg.get_by_role("heading", name="Pin at +000:02:00:00", exact=True), "dialog heading")
        for key, target in (("Tab", nt), ("Tab", save), ("Tab", cancel), ("Tab", met), ("Shift+Tab", cancel)):
            page.keyboard.press(key)
            assert is_focused(target), f"{key} keeps focus inside the dialog"
        page.keyboard.press("Escape")
        gone(page, dlg, "Escape closes the dialog")
        assert is_focused(slider(page)) and jget(app_url, f"/api/missions/{m['id']}/events")["events"] == []
        page.keyboard.press("Enter")
        appears(page, dlg, "dialog reopens")
        met.fill("+000:01:00:05")
        ttl.fill(title)
        nt.fill(note)
        save.dblclick()
        gone(page, dlg, "dialog closes after saving")
        shows(page, role(page, "status", "Console status"), "Event pinned at +000:01:00:00.")
        ui(page, lambda: is_focused(slider(page)), "focus returns to the loupe")
        shows(page, role(page, "table", "Events"), note)
    events = jget(app_url, f"/api/missions/{m['id']}/events")["events"]
    assert [(e["met"], e["title"], e["note"]) for e in events] == [(FIRST_MET, title, note)]


def test_private_note_never_leaks(app_url, browser, meilisearch, svix):
    m, p, _ = parsed_mission(app_url)
    mid, note = m["id"], "Secret " + uuid.uuid4().hex[:10]
    r = pin(app_url, mid, 7200, "Public title", note)
    assert r.status_code == 201 and note not in str(dict(r.headers))
    link = make_share(app_url, mid)
    tok = link["token"]
    assert note in json.dumps(jget(app_url, f"/api/missions/{mid}/events"), ensure_ascii=False)
    assert note in norm(pdf_text(call("GET", app_url, f"/api/missions/{mid}/dossier.pdf").content))
    surfaces = [call("GET", app_url, f"/s/{tok}")] + [call("GET", app_url, f"/api/share/{tok}{s}") for s in ("", "/events", "/track", "/transcript", "/speakers", "/search?q=Secret", "/search?q=Public", "/events.csv")]
    surfaces += [call("GET", app_url, f"/api/missions/{mid}/search?q=Secret"), call("GET", app_url, f"/api/missions/{mid}/audit")]
    for resp in surfaces:
        assert note not in resp.text and note not in str(dict(resp.headers)), f"note leaked via {resp.request.url}"
    assert note not in norm(pdf_text(call("GET", app_url, f"/api/share/{tok}/dossier.pdf").content))
    with sse(f"{app_url}/api/share/{tok}/stream") as (resp, events):
        first = next_event(events, HTTP_TIMEOUT)
        assert isinstance(first, dict) and note not in json.dumps(first)
    assert all(note not in json.dumps(d) for d in mdocs(meilisearch, mid))
    hook = wait_for(lambda: [x for x in svix_messages(svix, mid) if x.get("eventType") == "event.pinned"], "event.pinned webhook")
    assert note not in json.dumps(hook)
    scan = """() => { const out = [document.title, localStorage && JSON.stringify(localStorage), sessionStorage && JSON.stringify(sessionStorage)];
        for (const el of document.querySelectorAll('*')) for (const a of el.attributes) if (a.name === 'title' || a.name.startsWith('aria-') || a.name.startsWith('data-')) out.push(a.value);
        return out.join(' '); }"""
    with opened(browser, share_url(app_url, tok), DESKTOP, reduced_motion="reduce") as page:
        shows(page, role(page, "table", "Events"), "Public title")
        assert note not in page.content() and note not in page.evaluate(scan)
        dbs = page.evaluate("async () => indexedDB.databases ? (await indexedDB.databases()).map(d => d.name).join(' ') : ''")
        assert note not in dbs
    with opened(browser, author_url(app_url, mid), DESKTOP, reduced_motion="reduce") as page:
        shows(page, role(page, "table", "Events"), note)
        assert note not in page.evaluate(scan) and note not in plate(page)


def test_pin_idempotent(app_url):
    m, p, _ = parsed_mission(app_url)
    mid, key = m["id"], idempotency_key()
    base = mission(app_url, mid)["change_version"]
    first = pin(app_url, mid, 7200, "Once", key=key)
    assert first.status_code == 201 and "idempotency-replayed" not in first.headers
    again = post_json(app_url, f"/api/missions/{mid}/events", {"met": 7200, "title": " Once ", "note": ""}, key=key)
    assert again.status_code == 201 and again.headers.get("idempotency-replayed") == "true" and again.json()["id"] == first.json()["id"]
    expect_error(pin(app_url, mid, 7200, "Other", key=key), 422, {"error": "idempotency_key_reused"})
    expect_error(post_json(app_url, f"/api/missions/{mid}/events", {"met": 7200, "title": "x"}), 422, {"error": "validation", "errors": {"idempotency_key": KEY_MSG}})
    double = idempotency_key()
    results = together([lambda: pin(app_url, mid, 3600, "Double", key=double) for _ in range(3)])
    assert len([r for r in results if r.status_code == 201 and "idempotency-replayed" not in r.headers]) == 1
    assert all(r.status_code in (201, 409) for r in results)
    titles = [e["title"] for e in jget(app_url, f"/api/missions/{mid}/events")["events"]]
    assert titles.count("Once") == 1 and titles.count("Double") == 1
    assert mission(app_url, mid)["change_version"] == base + 2 and [e["kind"] for e in audit(app_url, mid)].count("event.pinned") == 2


def test_search_follows_changes(app_url, browser, meilisearch):
    m, p, _ = parsed_mission(app_url, small_capture(3, {0: ("KESTREL", "zephyrfollow line")}))
    mid = m["id"]
    lines_ = jget(app_url, f"/api/missions/{mid}/transcript")["lines"]
    assert all(meilisearch.document("transcript_items", f"line-{x['id']}") for x in lines_)
    r = pin(app_url, mid, FIRST_MET, "zephyrfollow event")
    assert meilisearch.document("transcript_items", f"event-{r.json()['id']}") is not None, "the pin answered before its document was written"
    with opened(browser, author_url(app_url, mid, q="zephyrfollow"), DESKTOP, reduced_motion="reduce") as page:
        status = role(page, "status", "Search status")
        shows(page, status, '2 results for "zephyrfollow"')
        role(page, "button", "Pin event").click()
        dlg = role(page, "dialog", "Pin event")
        role(dlg, "textbox", "Title").fill("zephyrfollow second")
        role(dlg, "button", "Save event").click()
        shows(page, status, '3 results for "zephyrfollow"')
        assert role(page, "searchbox", "Search transcript").input_value() == "zephyrfollow"
        assert role(page, "list", "Search results").get_by_role("button").count() == 3
    assert call("DELETE", app_url, f"/api/passes/{p['id']}").status_code == 204
    assert mdocs(meilisearch, mid, pass_id=p["id"]) == []


def test_wf_event_pinning_typed_met(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    link, title = make_share(app_url, m["id"]), unique("Typed")[0]
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        posts = []
        page.on("request", lambda rq: posts.append(rq) if rq.method == "POST" and rq.url.endswith("/events") else None)
        opener = role(page, "button", "Pin event")
        opener.click()
        dlg = role(page, "dialog", "Pin event")
        met = role(dlg, "textbox", "MET")
        role(dlg, "textbox", "Title").fill(title)
        met.fill("1:00:05")
        role(dlg, "button", "Save event").click()
        appears(page, dlg.get_by_text(MET_ERR, exact=True), "MET field error")
        assert is_focused(met) and met.get_attribute("aria-invalid") == "true" and posts == []
        met.fill("T-000:00:05:00")
        role(dlg, "button", "Save event").click()
        appears(page, dlg.get_by_text(NO_SAMPLE_MSG, exact=True), "API error under MET")
        met.fill("+000:01:00:05")
        role(dlg, "button", "Save event").click()
        gone(page, dlg, "dialog closes")
        ui(page, lambda: is_focused(opener), "focus returns to Pin event")
        shows(page, role(page, "table", "Events"), "+000:01:00:00")
        assert [rq.post_data_json["met"] for rq in posts] == [-300, 3605]
    with opened(browser, share_url(app_url, link["token"]), DESKTOP, reduced_motion="reduce") as page:
        shows(page, role(page, "table", "Events"), f"+000:01:00:00 {title}")
    with opened(browser, share_url(app_url, link["token"], t=7200), DESKTOP, reduced_motion="reduce") as page:
        ui(page, lambda: "MET +000:02:00:00" in plate(page), "share moment link places the lens")
        ui(page, lambda: current_buttons(page) == 1, "the line at the moment carries current-state")
    assert [(e["met"], e["title"]) for e in jget(app_url, f"/api/missions/{m['id']}/events")["events"]] == [(FIRST_MET, title)]


def test_text_fields_refuse_control_characters(app_url):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    for bad in ("a\u0085b", "a\u2028b", "a\u2029b", "a\tb", " name\n", "a\x7fb"):
        expect_error(post_json(app_url, "/api/missions", {"name": bad, "epoch_utc": SEED_EPOCH}), 422, {"error": "validation", "errors": {"name": CTRL_MSG}})
        expect_error(pin(app_url, mid, 7200, bad), 422, {"error": "validation", "errors": {"title": CTRL_MSG}})
        expect_error(pin(app_url, mid, 7200, "ok", bad), 422, {"error": "validation", "errors": {"note": CTRL_MSG}})
        expect_error(add_landmark(app_url, mid, bad, 0, 0), 422, {"error": "validation", "errors": {"name": CTRL_MSG}})
    assert pin(app_url, mid, 7200, "e\u0301" * 120).json()["title"] == "é" * 120
    family = "👩\u200d🚀"
    assert post_json(app_url, "/api/missions", {"name": family + "m" * 77, "epoch_utc": SEED_EPOCH}).status_code == 201
    expect_error(post_json(app_url, "/api/missions", {"name": family + "m" * 78, "epoch_utc": SEED_EPOCH}), 422, {"error": "validation", "errors": {"name": NAME_MSG}})
    assert add_landmark(app_url, mid, "A\u030a" * 40, 0, 0).status_code == 201
    assert jget(app_url, f"/api/missions/{mid}/events")["events"][0]["title"] == "é" * 120


def test_unit_conversion_rounding(app_url, browser):
    data = lines("# rounding", "S,2026-03-14T01:00:00Z,1837450.0,0.0,0.0,1600.5,0.0,0.0",
                 "S,2026-03-14T01:00:10Z,1737350.0,0.0,0.0,1600.5,0.0,0.0", "S,2026-03-14T01:00:20Z,1737360.0,0.0,0.0,0.0,0.0,1.0")
    m, p, _ = parsed_mission(app_url, data)
    mid, tr = m["id"], track(app_url, m["id"])
    for s in tr:
        assert pin(app_url, mid, s["met"], f"at {s['index']}").status_code == 201
    assert dist(tr[0]["altitude_m"]) == "100.1 km"
    link = make_share(app_url, mid)
    with opened(browser, author_url(app_url, mid, t=str(FIRST_MET)), DESKTOP, reduced_motion="reduce") as page:
        ui(page, lambda: "ALT 100.1 km" in plate(page) and f"SPD {spd(1600.5)}" in plate(page), "plate rounds half away")
        table = text_of(role(page, "table", "Events"))
        for s in tr:
            assert dist(s["altitude_m"]) in table and spd(s["speed_m_s"]) in table
    with opened(browser, share_url(app_url, link["token"], distance="nmi", speed="ft_s"), DESKTOP, reduced_motion="reduce") as page:
        shows(page, role(page, "table", "Events"), dist(tr[0]["altitude_m"], "nmi"))
        table = text_of(role(page, "table", "Events"))
        for s in tr:
            assert dist(s["altitude_m"], "nmi") in table and spd(s["speed_m_s"], "ft_s") in table
    for du, su in (("km", "m_s"), ("nmi", "ft_s")):
        rows = call("GET", app_url, f"/api/share/{link['token']}/events.csv?distance={du}&speed={su}").text.split("\r\n")[1:-1]
        assert [r.split(",")[3:5] for r in rows] == [[num_dist(s["altitude_m"], du), num_spd(s["speed_m_s"], su)] for s in tr]
    peri = min(tr, key=lambda s: s["altitude_m"])
    assert f"ALT {dist(peri['altitude_m'])}" in norm(pdf_text(call("GET", app_url, f"/api/missions/{mid}/dossier.pdf").content))
    assert f"ALT {dist(peri['altitude_m'], 'nmi')}" in norm(pdf_text(call("GET", app_url, f"/api/share/{link['token']}/dossier.pdf?distance=nmi&speed=ft_s").content))


def test_saved_units(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    assert patch(app_url, m["id"], {"distance_unit": "nmi"}).status_code == 200
    tok = make_share(app_url, m["id"])["token"]
    assert jget(app_url, f"/api/share/{tok}")["mission"]["distance_unit"] == "nmi"
    cases = [({}, "nmi", "m/s"), ({"distance": "km"}, "km", "m/s"), ({"distance": "bogus", "speed": "ft_s"}, "nmi", "ft/s")]
    for q, du, su in cases:
        with opened(browser, share_url(app_url, tok, t=str(FIRST_MET), **q), DESKTOP, reduced_motion="reduce") as page:
            ui(page, lambda: f"ALT {dist(100000, du)}" in plate(page) and su in plate(page), f"share opens in {du} and {su}")
    with opened(browser, share_url(app_url, tok, t=str(FIRST_MET)), DESKTOP, reduced_motion="reduce") as page:
        ui(page, lambda: "nmi" in plate(page), "saved nmi")
        role(page, "radio", "km").check()
        ui(page, lambda: params(page).get("distance") == "km" and "ALT 100.0 km" in plate(page), "reader choice writes distance")
    with opened(browser, author_url(app_url, m["id"], t=str(FIRST_MET), distance="km"), DESKTOP, reduced_motion="reduce") as page:
        ui(page, lambda: f"ALT {dist(100000, 'nmi')}" in plate(page), "author console ignores distance in its address")
    assert mission(app_url, m["id"])["distance_unit"] == "nmi"


RAIL_NAMES = [("radio", "km"), ("radio", "nmi"), ("radio", "m/s"), ("radio", "ft/s"), ("checkbox", "Event pins"), ("checkbox", "Transcript ticks")]
HIDDEN_JS = """el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && cs.visibility !== 'hidden' && el.checkVisibility();
  const hidden = !!el.closest('[inert],[aria-hidden="true"]') || !el.checkVisibility() || cs.visibility === 'hidden';
  return {onScreen, hidden}; }"""


def test_wf_units_and_channels_drawer(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    for vp in (PHONE, TABLET):
        with opened(browser, author_url(app_url, m["id"]), vp, reduced_motion="reduce") as page:
            btn = role(page, "button", "Channels")
            appears(page, btn, "Channels button")
            assert btn.get_attribute("aria-expanded") == "false"
            for r, name in RAIL_NAMES:
                for el in page.get_by_role(r, name=name, exact=True, include_hidden=True).all():
                    st = el.evaluate(HIDDEN_JS)
                    assert not st["onScreen"] and st["hidden"], f"closed drawer exposes {name}"
            names = tab_order(page, TAB_PRESSES)
            assert not (set(names) & ({n for _, n in RAIL_NAMES} | {"Close channels"}))
            btn.focus()
            page.keyboard.press("Enter")
            dlg = role(page, "dialog", "Channels")
            appears(page, dlg, "drawer opens")
            ui(page, lambda: is_focused(role(dlg, "radio", "km")), "focus moves to the checked Distance radio")
            assert btn.get_attribute("aria-expanded") == "true"
            for _ in range(10):
                page.keyboard.press("Tab")
                assert dlg.evaluate("el => el.contains(document.activeElement)"), "Tab stays inside the drawer"
            page.keyboard.press("Escape")
            ui(page, lambda: is_focused(btn), "Escape returns focus to Channels")
            assert role(page, "radio", "km").count() == 0 or not role(page, "radio", "km").evaluate(HIDDEN_JS)["onScreen"]
        if vp is TABLET:
            with opened(browser, author_url(app_url, m["id"]), vp, reduced_motion="reduce") as page:
                role(page, "button", "Channels").click()
                dlg = role(page, "dialog", "Channels")
                appears(page, dlg, "drawer")
                role(dlg, "radio", "nmi").check()
                role(dlg, "button", "Close channels").click()
                ui(page, lambda: is_focused(role(page, "button", "Channels")), "Close channels returns focus")
                ui(page, lambda: mission(app_url, m["id"])["distance_unit"] == "nmi", "choice saved on the mission")
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        appears(page, role(page, "complementary", "Channels"), "rail at 1280")
        assert role(page, "button", "Channels").count() == 0 or not role(page, "button", "Channels").is_visible()


def test_wf_units_and_channels_tablet(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    assert pin(app_url, m["id"], 7200, "Peri").status_code == 201
    tok = make_share(app_url, m["id"])["token"]
    s = track(app_url, m["id"])[360]
    with opened(browser, author_url(app_url, m["id"], t="7200"), TABLET, reduced_motion="reduce") as page:
        patches = []
        page.on("request", lambda rq: patches.append(rq) if rq.method == "PATCH" else None)
        btn = role(page, "button", "Channels")
        appears(page, btn, "Channels")
        btn.focus()
        page.keyboard.press("Enter")
        dlg = role(page, "dialog", "Channels")
        appears(page, dlg, "drawer")
        role(dlg, "radio", "nmi").check()
        role(dlg, "radio", "ft/s").check()
        page.keyboard.press("Escape")
        shows(page, role(page, "status", "Console status"), "Units saved: nmi and ft/s.")
        ui(page, lambda: f"ALT {dist(s['altitude_m'], 'nmi')}" in plate(page) and f"SPD {spd(s['speed_m_s'], 'ft_s')}" in plate(page), "plate converted")
        table = text_of(role(page, "table", "Events"))
        assert dist(s["altitude_m"], "nmi") in table and spd(s["speed_m_s"], "ft_s") in table
        assert [rq.post_data_json for rq in patches] == [{"distance_unit": "nmi"}, {"speed_unit": "ft_s"}]
        assert all(rq.headers["content-type"].startswith("application/merge-patch+json") for rq in patches)
    with opened(browser, share_url(app_url, tok, t="7200"), TABLET, reduced_motion="reduce") as page:
        ui(page, lambda: f"ALT {dist(s['altitude_m'], 'nmi')}" in plate(page), "share page opens in saved units")
        assert spd(s["speed_m_s"], "ft_s") in text_of(role(page, "table", "Events"))
    got = mission(app_url, m["id"])
    assert (got["distance_unit"], got["speed_unit"]) == ("nmi", "ft_s")


COVER_JS = """([channels, plate]) => { const el = document.activeElement;
  if (!el || el === document.body) return {skip: true};
  const r = el.getBoundingClientRect(); let band = channels;
  while (band && !['sticky', 'fixed'].includes(getComputedStyle(band).position)) band = band.parentElement;
  const br = band ? band.getBoundingClientRect() : null, inBand = !!band && band.contains(el);
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const pr = plate ? plate.getBoundingClientRect() : null, inPlate = !!plate && plate.contains(el);
  const overPlate = !!pr && !inPlate && r.left < pr.right - 1 && r.right > pr.left + 1 && r.top < pr.bottom - 1 && r.bottom > pr.top + 1;
  return {skip: false, label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40),
    topOk: inBand || !br || r.top >= br.bottom - 0.5, hit: !!top && (el === top || el.contains(top)),
    overPlate, slider: el.getAttribute('role') === 'slider' || el.type === 'range', bandTop: br ? br.top : 0}; }"""


def test_focused_controls_uncovered(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    assert pin(app_url, m["id"], 7200, "Cover check", "n").status_code == 201
    for vp in (PHONE, TABLET, DESKTOP):
        with opened(browser, author_url(app_url, m["id"]), vp, reduced_motion="reduce") as page:
            appears(page, slider(page), "Track loupe")
            layout(page)
            ch = role(page, "button", "Channels")
            handles = [ch.element_handle() if vp is not DESKTOP else None, role(page, "group", "Readout").element_handle()]
            for _ in range(TAB_PRESSES):
                page.keyboard.press("Tab")
                st = page.evaluate(COVER_JS, handles)
                if st["skip"]:
                    continue
                assert st["topOk"], f"{st['label']} is under the MET band at {vp}"
                assert st["hit"], f"{st['label']} is covered at its centre at {vp}"
                assert not st["overPlate"] or (vp is DESKTOP and st["slider"]), f"{st['label']} is under the readout plate at {vp}"
            if vp is not DESKTOP:
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                advance(page, STEP_MS)
                assert abs(ch.bounding_box()["y"]) <= ch.bounding_box()["height"] + GEOM_TOL, "the band stays pinned at the top"
            if vp is PHONE:
                region = role(page, "region", "Events")
                assert region.evaluate("el => el.tabIndex >= 0")
                region.evaluate("el => { el.scrollIntoView(); el.scrollLeft = el.scrollWidth; }")
                note = role(page, "columnheader", "Note")
                b = note.bounding_box()
                assert note.evaluate("(el, p) => { const t = document.elementFromPoint(p[0], p[1]); return el === t || el.contains(t); }", [b["x"] + b["width"] / 2, b["y"] + b["height"] / 2])


def test_merge_patch(app_url):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    base = mission(app_url, mid)["change_version"]
    expect_error(patch(app_url, mid, {"name": "x"}, "application/json"), 415, {"error": "unsupported_media_type"})
    expect_error(patch(app_url, mid, []), 422, {"error": "validation", "errors": {"body": OBJECT_MSG}})
    expect_error(patch(app_url, mid, {"distance_unit": None}), 422, {"error": "validation", "errors": {"distance_unit": KM_MSG}})
    expect_error(patch(app_url, mid, {"speed_unit": "kn"}), 422, {"error": "validation", "errors": {"speed_unit": SPEED_MSG}})
    expect_error(patch(app_url, mid, {"reference_target": TESSERA}), 422, {"error": "validation", "errors": {"reference_target": REF_NULL_MSG}})
    expect_error(patch(app_url, mid, {"name": None}), 422, {"error": "validation", "errors": {"name": NAME_MSG}})
    expect_error(patch(app_url, mid, {"name": "Renamed", "speed_unit": "kn"}), 422, {"error": "validation", "errors": {"speed_unit": SPEED_MSG}})
    assert mission(app_url, mid)["name"] == m["name"]
    r = patch(app_url, mid, {"speed_unit": "ft_s"})
    assert r.status_code == 200 and (r.json()["speed_unit"], r.json()["name"], r.json()["change_version"]) == ("ft_s", m["name"], base)
    assert set_reference(app_url, mid, TESSERA).status_code == 200
    v = mission(app_url, mid)["change_version"]
    r = patch(app_url, mid, {"reference_target": None})
    assert r.status_code == 200 and r.json()["reference"] is None and r.json()["change_version"] == v + 1
    assert all(s["residual_m"] is None for s in track(app_url, mid))
    assert audit(app_url, mid)[-1]["kind"] == "mission.updated" and audit(app_url, mid)[-1]["data"] == {"reference_target": None}


def test_deleted_means_gone(app_url, meilisearch):
    m, p, data = parsed_mission(app_url)
    mid, pid = m["id"], p["id"]
    pin(app_url, mid, 7200, "Perilune pass gone")
    tok = make_share(app_url, mid)["token"]
    assert call("DELETE", app_url, f"/api/passes/{pid}").status_code == 204
    for path in (f"/api/passes/{pid}", f"/api/passes/{pid}/capture"):
        expect_error(call("GET", app_url, path), 410, {"error": "pass_deleted"})
    expect_error(call("DELETE", app_url, f"/api/passes/{pid}"), 410, {"error": "pass_deleted"})
    expect_error(call("GET", app_url, f"/api/share/{tok}/captures/{pid}"), 404, {"error": "not_found"})
    got = mission(app_url, mid)
    assert (got["passes"], got["sample_count"], got["total_bytes"], got["perilune"]) == ([], 0, 0, None)
    for base_path in (f"/api/missions/{mid}", f"/api/share/{tok}"):
        assert jget(app_url, f"{base_path}/track")["samples"] == [] and jget(app_url, f"{base_path}/transcript")["lines"] == []
        assert jget(app_url, f"{base_path}/events")["events"] == [] and jget(app_url, f"{base_path}/speakers")["speakers"] == []
        assert jget(app_url, f"{base_path}/search?q=perilune")["count"] == 0
    assert jget(app_url, f"/api/share/{tok}")["passes"] == []
    assert call("GET", app_url, f"/api/share/{tok}/events.csv").text.count("\r\n") == 1
    assert S3().keys(f"captures/{mid}/") == []
    assert Postgres().rows(f"SELECT id FROM outbox WHERE kind = 'pass.parse' AND pass_id = '{pid}'") == []
    deadline = time.monotonic() + OBSERVE_S
    while time.monotonic() < deadline:
        assert mdocs(meilisearch, mid, pass_id=pid) == [], "catch-up must never re-index a deleted pass"


def test_all_or_nothing_delete(app_url, meilisearch):
    m, p, data = parsed_mission(app_url)
    mid, pid = m["id"], p["id"]

    def snapshot():
        return (mission(app_url, mid)["change_version"], len(audit(app_url, mid)), len(track(app_url, mid)),
                S3().get(f"captures/{mid}/{pid}.cap"), len(mdocs(meilisearch, mid)), jget(app_url, f"/api/passes/{pid}")["state"])

    before = snapshot()
    expect_error(call("DELETE", outage("APP_STORAGE_DOWN_URL"), f"/api/passes/{pid}"), 503, {"error": "storage_unavailable"})
    assert snapshot() == before
    expect_error(call("DELETE", outage("APP_SEARCH_DOWN_URL"), f"/api/passes/{pid}"), 503, {"error": "search_unavailable"})
    deadline = time.monotonic() + OBSERVE_S
    while time.monotonic() < deadline:
        assert snapshot() == before
    results = together([lambda: call("DELETE", app_url, f"/api/passes/{pid}") for _ in range(5)])
    assert sorted(r.status_code for r in results) == [204, 410, 410, 410, 410]
    assert all(r.json() == {"error": "pass_deleted"} for r in results if r.status_code == 410)
    assert [e["kind"] for e in audit(app_url, mid)].count("pass.deleted") == 1


def test_wf_pass_deletion_keyboard(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    fname = p["filename"]
    with opened(browser, author_url(app_url, m["id"], t=7200), DESKTOP, reduced_motion="reduce") as page:
        ui(page, lambda: current_buttons(page) == 1, "the pass's line at the moment carries current-state")
    with opened(browser, author_url(app_url, m["id"], q="perilune"), DESKTOP, reduced_motion="reduce") as page:
        status = role(page, "status", "Search status")
        shows(page, status, '2 results for "perilune"')
        btn = role(page, "button", f"Delete {fname}")
        btn.focus()
        page.keyboard.press("Enter")
        dlg = role(page, "alertdialog", "Delete pass")
        appears(page, dlg, "Delete pass dialog")
        assert f"Delete {fname}? Its samples, transcript lines, pinned events and stored capture are removed for good." in text_of(dlg)
        keep, confirm = role(dlg, "button", "Keep pass"), role(dlg, "button", "Delete pass")
        assert is_focused(keep)
        for key, target in (("Tab", confirm), ("Tab", keep), ("Shift+Tab", confirm)):
            page.keyboard.press(key)
            assert is_focused(target)
        page.keyboard.press("Escape")
        gone(page, dlg, "Escape keeps the pass")
        assert is_focused(btn) and jget(app_url, f"/api/passes/{p['id']}")["state"] == "parsed"
        page.keyboard.press("Enter")
        appears(page, dlg, "dialog again")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        gone(page, dlg, "dialog closes after deleting")
        shows(page, role(page, "status", "Console status"), f"{fname} deleted.")
        ui(page, lambda: is_focused(role(page, "list", "Passes")), "focus lands on the Passes list")
        shows(page, status, 'No results for "perilune"')
        assert role(page, "list", "Search results").get_by_role("button").count() == 0
    expect_error(call("GET", app_url, f"/api/passes/{p['id']}"), 410, {"error": "pass_deleted"})
    assert S3().keys(f"captures/{m['id']}/") == []


def test_wf_pass_deletion_outage(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    base, fname = outage("APP_STORAGE_DOWN_URL"), p["filename"]
    with opened(browser, author_url(base, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        appears(page, page.get_by_role("alert").filter(has_text=BANNER_STORAGE), "storage banner")
        btn = role(page, "button", f"Delete {fname}")
        btn.click()
        role(page, "alertdialog", "Delete pass").get_by_role("button", name="Delete pass", exact=True).click()
        shows(page, role(page, "status", "Console status"), f"{fname} was not deleted. Capture storage is offline.")
        gone(page, role(page, "alertdialog", "Delete pass"), "dialog closes on failure")
        ui(page, lambda: is_focused(btn), "focus returns to the delete button")
        assert fname in text_of(role(page, "list", "Passes"))
    assert jget(app_url, f"/api/passes/{p['id']}")["state"] == "parsed"


def test_audit_chain(app_url):
    m = make_mission(app_url)
    mid = m["id"]
    data = small_capture()
    r = upload(app_url, mid, data)
    p = settled_pass(app_url, r.json()["id"])
    note = "audit-note-" + uuid.uuid4().hex[:6]
    pin(app_url, mid, FIRST_MET, "Audit pin", note)
    expect_error(pin(app_url, mid, FIRST_MET, ""), 422, {"error": "validation", "errors": {"title": TITLE_MSG}})
    lm = add_landmark(app_url, mid, "Crater", -12.5, 45.25).json()
    link = make_share(app_url, mid)
    call("DELETE", app_url, f"/api/missions/{mid}/share")
    entries = audit(app_url, mid)
    kinds = [e["kind"] for e in entries]
    assert kinds == ["mission.created", "pass.stored", "pass.parsed", "event.pinned", "landmark.added", "share.created", "share.revoked"]
    assert entries[0]["data"] == {"name": m["name"], "epoch_utc": SEED_EPOCH}
    assert entries[4]["data"] == {"landmark_id": lm["id"], "name": "Crater", "lat_deg": -12.5, "lon_deg": 45.25}
    assert note not in json.dumps(entries) and link["token"] not in json.dumps(entries)
    prev = "0" * 64
    for i, e in enumerate(entries, 1):
        assert e["seq"] == i and e["prev"] == prev and e["hash"] == entry_hash(e)
        prev = e["hash"]
    assert jget(app_url, f"/api/missions/{mid}/audit/verify") == {"ok": True, "length": len(entries)}
    call("DELETE", app_url, f"/api/passes/{p['id']}")
    after = audit(app_url, mid)
    assert after[:len(entries)] == entries and [e["kind"] for e in after[len(entries):]] == ["pass.deleted"]
    assert after[-1]["data"] == {"pass_id": p["id"]} and after[-1]["prev"] == entries[-1]["hash"] and after[-1]["hash"] == entry_hash(after[-1])
    assert jget(app_url, f"/api/missions/{mid}/audit/verify") == {"ok": True, "length": len(after)}
    tok = make_share(app_url, mid)["token"]
    assert call("GET", app_url, f"/api/share/{tok}/audit").status_code == 404
    busy = parsed_mission(app_url)[0]["id"]
    hooks = [lambda i=i: call("POST", app_url, f"/api/missions/{busy}/subscribers", json={"url": f"https://example.com/hook/{i}"}) for i in range(2)]
    pins = [lambda i=i: pin(app_url, busy, FIRST_MET + i * STEP_S, unique("Race")[0]) for i in range(4)]
    assert sorted(r.status_code for r in together(hooks + pins)) == [201] * 6
    chain = audit(app_url, busy)
    assert [e["seq"] for e in chain] == list(range(1, len(chain) + 1))
    assert jget(app_url, f"/api/missions/{busy}/audit/verify") == {"ok": True, "length": len(chain)}


def test_search_scoped(app_url):
    wa, wb, wn = (uuid.uuid4().hex[:8].replace("0", "q") + w for w in ("alpha", "bravo", "notes"))
    a, _, _ = parsed_mission(app_url, small_capture(3, {0: ("KESTREL", f"first {wa}"), 2: ("TESSERA", f"third {wa}")}))
    b, _, _ = parsed_mission(app_url, small_capture(3, {0: ("KESTREL", f"other {wb}")}))
    add_landmark(app_url, a["id"], f"{wa} rim", 1, 1)
    pin(app_url, a["id"], FIRST_MET + STEP_S, f"Event {wa}", f"{wn}")
    res = jget(app_url, f"/api/missions/{a['id']}/search?q={wa}")
    assert res["query"] == wa and res["count"] == 3 == len(res["hits"])
    assert [(h["kind"], h["met"], h["speaker"]) for h in res["hits"]] == [("line", FIRST_MET, "KESTREL"), ("event", FIRST_MET + STEP_S, None), ("line", FIRST_MET + 2 * STEP_S, "TESSERA")]
    assert res["hits"][1]["text"] == f"Event {wa}" and res["hits"][0]["met_label"] == met_label(FIRST_MET)
    assert jget(app_url, f"/api/missions/{a['id']}/search?q={wb}")["count"] == 0
    assert jget(app_url, f"/api/missions/{a['id']}/search?q={wn}")["count"] == 0
    tok = make_share(app_url, a["id"])["token"]
    assert jget(app_url, f"/api/share/{tok}/search?q={wa}")["count"] == 3 and jget(app_url, f"/api/share/{tok}/search?q={wb}")["count"] == 0
    wc = uuid.uuid4().hex[:8].replace("0", "q") + "charlie"
    c, _, _ = parsed_mission(app_url, orbit_capture(range(60), {k: ("K", f"{wc} {k}") for k in range(60)}, head=("# many",)))
    many = jget(app_url, f"/api/missions/{c['id']}/search?q={wc}")
    assert many["count"] == 50 == len(many["hits"]) and [h["met"] for h in many["hits"]] == sorted(h["met"] for h in many["hits"])
    for q in ("", "   ", "x" * 201):
        expect_error(call("GET", app_url, f"/api/missions/{a['id']}/search", params={"q": q}), 422, {"error": "validation", "errors": {"q": Q_MSG}})
    assert call("GET", app_url, f"/api/missions/{a['id']}/search", params={"q": "x" * 200}).status_code == 200


def test_latest_query_wins(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    first, second = "perilune", "acquisition"
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        held_routes = []

        def handler(route):
            if parse_qs(urlparse(route.request.url).query).get("q") == [first]:
                held_routes.append(route)
            else:
                route.fallback()

        page.route("**/api/missions/*/search*", handler)
        box = role(page, "searchbox", "Search transcript")
        appears(page, box, "search box")
        box.fill(first)
        ui(page, lambda: bool(held_routes), "first query sent after the debounce")
        box.press_sequentially(" ")
        box.fill(second)
        status, results = role(page, "status", "Search status"), role(page, "list", "Search results")
        shows(page, status, f'1 result for "{second}"')
        held_routes[0].fallback()
        for _ in range(20):
            advance(page, SEARCH_DEBOUNCE_MS)
        names = [b.text_content() for b in results.get_by_role("button").all()]
        assert len(names) == 1 and "Acquisition" in names[0], f"stale results shown: {names}"
        assert text_of(status) == f'1 result for "{second}"'


def test_search_announcements(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    pin(app_url, m["id"], 7200, SEED_EVENT_TITLE, "Check against Kestrel log sheet 14 before publishing.")
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        box, status = role(page, "searchbox", "Search transcript"), role(page, "status", "Search status")
        appears(page, box, "search box")
        watch(status)
        with held(page, "**/api/missions/*/search*") as h:
            box.fill("perilune")
            shows(page, status, "Searching...")
            h.release()
        shows(page, status, '3 results for "perilune"')
        box.fill("log sheet")
        shows(page, status, 'No results for "log sheet"')
        box.fill("acquisition")
        shows(page, status, '1 result for "acquisition"')
        for _ in range(10):
            advance(page, STATUS_CHECK_MS)
        box.fill("")
        ui(page, lambda: text_of(status) == "" and role(page, "list", "Search results").get_by_role("button").count() == 0, "clearing empties results and status")
        log = heard(status)
    for msg in ('3 results for "perilune"', 'No results for "log sheet"', '1 result for "acquisition"'):
        assert log.count(msg) == 1, f"{msg} once; heard {log}"
    with opened(browser, author_url(outage("APP_SEARCH_DOWN_URL"), m["id"]), DESKTOP, reduced_motion="reduce") as page:
        role(page, "searchbox", "Search transcript").fill("perilune")
        shows(page, role(page, "status", "Search status"), "Search is offline.")


def test_wf_share_and_read_jump(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    target = f"+000:02:00:00 TESSERA: {SEED_TRANSCRIPT[360][1]}"
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        box, status = role(page, "searchbox", "Search transcript"), role(page, "status", "Search status")
        appears(page, box, "search box")
        box.press_sequentially("perilune")
        shows(page, status, '2 results for "perilune"')
        assert [norm(x.inner_text()) for x in role(page, "list", "Speakers").get_by_role("listitem").all()] == ["KESTREL 3", "TESSERA 3"]
        role(page, "button", "Pin event").click()
        dlg = role(page, "dialog", "Pin event")
        role(dlg, "textbox", "Title").fill(SEED_EVENT_TITLE)
        role(dlg, "button", "Save event").click()
        shows(page, status, '3 results for "perilune"')
        assert box.input_value() == "perilune"
        role(page, "list", "Search results").get_by_role("button", name=target, exact=True).click()
        ui(page, lambda: slider_now(page) == 360 and params(page).get("t") == "7200" and params(page).get("q") == "perilune", "result moves lens and address")
        assert "MET +000:02:00:00" in plate(page)
        assert role(page, "list", "Transcript lines").get_by_role("button", name=target, exact=True).get_attribute("aria-current") == "true"
        role(page, "button", f"Delete {p['filename']}").click()
        role(page, "alertdialog", "Delete pass").get_by_role("button", name="Delete pass", exact=True).click()
        shows(page, status, 'No results for "perilune"')
    assert jget(app_url, f"/api/missions/{m['id']}/search?q=perilune")["count"] == 0


def test_share_link_capability(app_url):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    a = make_share(app_url, mid)
    assert re.fullmatch(r"[A-Za-z0-9_-]{32,}", a["token"]) and a["url"] == f"/s/{a['token']}"
    assert mission(app_url, mid)["share"]["token"] == a["token"]
    b = make_share(app_url, mid)
    assert b["token"] != a["token"]
    expect_error(call("GET", app_url, f"/api/share/{a['token']}"), 410, {"error": "link_revoked"})
    assert call("GET", app_url, f"/api/share/{b['token']}").status_code == 200
    racers = together([lambda: call("POST", app_url, f"/api/missions/{mid}/share") for _ in range(4)])
    assert all(r.status_code == 201 for r in racers)
    live = [r.json()["token"] for r in racers if call("GET", app_url, f"/api/share/{r.json()['token']}").status_code == 200]
    assert live == [mission(app_url, mid)["share"]["token"]]
    assert call("DELETE", app_url, f"/api/missions/{mid}/share").status_code == 204
    expect_error(call("GET", app_url, f"/api/share/{live[0]}"), 410, {"error": "link_revoked"})
    page = call("GET", app_url, f"/s/{live[0]}")
    assert page.status_code == 410 and WITHDRAWN_HEADING in page.text and WITHDRAWN_LINE in page.text
    expect_error(call("DELETE", app_url, f"/api/missions/{mid}/share"), 404, {"error": "no_active_link"})
    junk = "x" * 40
    expect_error(call("GET", app_url, f"/api/share/{junk}"), 404, {"error": "not_found"})
    assert call("GET", app_url, f"/s/{junk}").status_code == 404 and UNKNOWN_LINK_HEADING in call("GET", app_url, f"/s/{junk}").text


def test_share_read_only(app_url):
    m, p, _ = parsed_mission(app_url)
    rej = upload(app_url, m["id"], lines(sample_line(0), "X,1"))
    rp = settled_pass(app_url, rej.json()["id"])
    tok = make_share(app_url, m["id"])["token"]
    v = mission(app_url, m["id"])["change_version"]
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for path in (f"/api/share/{tok}", f"/api/share/{tok}/events", f"/s/{tok}"):
            r = call(method, app_url, path, json={"title": "x"})
            assert r.status_code == 405 and r.headers.get("allow") == "GET, HEAD", f"{method} {path}"
            assert r.json() == {"error": "read_only"}
    assert mission(app_url, m["id"])["change_version"] == v
    body = jget(app_url, f"/api/share/{tok}")
    assert [x["id"] for x in body["passes"]] == [p["id"]] and set(body["passes"][0]) == {"id", "filename", "size_bytes", "sha256", "sample_count", "transcript_line_count"}
    expect_error(call("GET", app_url, f"/api/share/{tok}/captures/{rp['id']}"), 404, {"error": "not_found"})
    for path in ("", "/track", "/events", "/events.csv", "/search?q=perilune"):
        assert "no-store" in call("GET", app_url, f"/api/share/{tok}{path}").headers.get("cache-control", "")
    assert "no-store" in call("GET", app_url, f"/s/{tok}").headers.get("cache-control", "")
    assert "no-store" in call("GET", app_url, f"/api/share/{'y' * 40}").headers.get("cache-control", "")


def test_wf_share_and_read_phone(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    pin(app_url, m["id"], 7200, SEED_EVENT_TITLE)
    expiry = parse_iso(m["created_at"]) + timedelta(days=10)
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as author:
        role(author, "textbox", "Link expiry (GMT)").fill(gmt(iso(expiry)))
        role(author, "button", "Create share link").click()
        shows(author, role(author, "status", "Console status"), f"Share link ready. It expires {gmt(iso(expiry))}.")
        url = role(author, "textbox", "Share link").input_value()
        assert url.startswith("http") and "/s/" in url
        shows(author, role(author, "region", "Share"), f"Expires {gmt(iso(expiry))}")
        tok = url.rsplit("/s/", 1)[1]
        assert mission(app_url, m["id"])["share"]["expires_utc"] == iso(expiry)
        with live_page(browser, share_url(app_url, tok), PHONE) as reader:
            expect(slider(reader)).to_be_visible(timeout=UI_WAIT * 1000)
            slider(reader).focus()
            reader.keyboard.press("ArrowRight")
            expect(slider(reader)).to_have_attribute("aria-valuetext", re.compile(r"^\+000:01:00:10"), timeout=UI_WAIT * 1000)
            role(reader, "searchbox", "Search transcript").fill("perilune")
            expect(role(reader, "status", "Search status")).to_have_text('3 results for "perilune"', timeout=UI_WAIT * 1000)
            with reader.expect_download() as dl:
                role(reader, "link", "Download event list").click()
            csv = Path(dl.value.path()).read_bytes().decode("utf-8")
            assert csv.startswith("met_label,met_seconds,title,altitude_km,speed_m_s,residual_km\r\n") and SEED_EVENT_TITLE in csv
            reader.set_viewport_size(TABLET)
            advance(reader, STEP_MS)
            layout(reader)
            d, pl = slider(reader).bounding_box(), role(reader, "group", "Readout").bounding_box()
            assert pl["x"] >= d["x"] + d["width"] - GEOM_TOL and abs(pl["y"] - d["y"]) <= GEOM_TOL, "768 puts the readout beside the disc"
            reader.set_viewport_size(DESKTOP)
            advance(reader, STEP_MS)
            layout(reader)
            d, rail = slider(reader).bounding_box(), role(reader, "complementary", "Channels").bounding_box()
            assert rail["x"] + rail["width"] <= d["x"] + GEOM_TOL, "1280 puts the channel rail left of the disc"
            role(author, "button", "Revoke share link").click()
            shows(author, role(author, "status", "Console status"), "Share link revoked. It no longer works.")
            expect(reader.get_by_role("heading", name=WITHDRAWN_HEADING, exact=True)).to_be_visible(timeout=LIVE_PAGE_MS)
    expect_error(call("GET", app_url, f"/api/share/{tok}"), 410, {"error": "link_revoked"})


def test_capture_download_exact(app_url, browser):
    data = b"\xef\xbb\xbf# kept comment\r\n" + small_capture()
    m, p, _ = parsed_mission(app_url, data, name="exact.cap")
    tok = make_share(app_url, m["id"])["token"]
    assert call("GET", app_url, f"/api/passes/{p['id']}/capture").content == data
    assert call("GET", app_url, f"/api/share/{tok}/captures/{p['id']}").content == data
    assert S3().get(f"captures/{m['id']}/{p['id']}.cap") == data
    for url, where in ((author_url(app_url, m["id"]), "Passes"), (share_url(app_url, tok), "Captures")):
        with opened(browser, url, DESKTOP, reduced_motion="reduce") as page:
            link = role(page, "list", where).get_by_role("link", name="Download exact.cap", exact=True)
            appears(page, link, f"download link in {where}")
            with page.expect_download() as dl:
                link.click()
            assert Path(dl.value.path()).read_bytes() == data


def test_event_list_csv(app_url):
    epoch = iso(FIRST_UTC + timedelta(seconds=30))
    data = orbit_capture(range(6), head=("# csv",))
    m, p, _ = parsed_mission(app_url, data, epoch=epoch)
    titles = [(-30, "=SUM(1,2)"), (0, "@cmd"), (10, "-minus"), (10, "+plus"), (20, 'Quote "q", comma')]
    for met, t in titles:
        assert pin(app_url, m["id"], met, t, "never in csv").status_code == 201
    tok = make_share(app_url, m["id"])["token"]
    for du, su in (("km", "m_s"), ("nmi", "ft_s")):
        r = call("GET", app_url, f"/api/share/{tok}/events.csv?distance={du}&speed={su}")
        assert r.status_code == 200 and r.headers["content-type"] == "text/csv; charset=utf-8; header=present"
        assert r.headers["content-disposition"] == 'attachment; filename="events.csv"' and not r.content.startswith(b"\xef\xbb\xbf")
        evs = jget(app_url, f"/api/share/{tok}/events")["events"]
        rows = [f"met_label,met_seconds,title,altitude_{du},speed_{su},residual_{du}"]
        for e in evs:
            rows.append(",".join([csv_cell(e["met_label"], True), str(e["met"]), csv_cell(e["title"], True),
                                  num_dist(e["sample"]["altitude_m"], du), num_spd(e["sample"]["speed_m_s"], su), ""]))
        assert r.text == "\r\n".join(rows) + "\r\n"
    body = call("GET", app_url, f"/api/share/{tok}/events.csv").text
    assert "T-000:00:00:30" in body and "'T-" not in body and "'+000:00:00:00" in body and "never in csv" not in body
    expect_error(call("GET", app_url, f"/api/share/{tok}/events.csv?distance=mi"), 422, {"error": "validation", "errors": {"distance": KM_MSG}})
    expect_error(call("GET", app_url, f"/api/share/{tok}/events.csv?speed=kn"), 422, {"error": "validation", "errors": {"speed": SPEED_MSG}})


@pytest.mark.timeout(300)
def test_share_link_expiry(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    a = make_share(app_url, mid)
    assert parse_iso(a["expires_utc"]) - parse_iso(a["created_at"]) == timedelta(seconds=DEFAULT_EXPIRY_S)
    now = parse_iso(a["created_at"])
    for bad, msg in (("2026-13-01T00:00:00Z", EXPIRY_FMT_MSG), ("soon", EXPIRY_FMT_MSG), (iso(now - timedelta(days=1)), EXPIRY_RANGE_MSG),
                     (iso(now + timedelta(seconds=MAX_EXPIRY_S + 120)), EXPIRY_RANGE_MSG)):
        expect_error(call("POST", app_url, f"/api/missions/{mid}/share", json={"expires_utc": bad}), 422, {"error": "validation", "errors": {"expires_utc": msg}})
    expect_error(call("POST", app_url, f"/api/missions/{mid}/share", content=b"x", headers={"Content-Type": "text/plain"}), 415, {"error": "unsupported_media_type"})
    expect_error(call("POST", app_url, f"/api/missions/{mid}/share", content=b"{", headers={"Content-Type": "application/json"}), 400, {"error": "invalid_json"})
    edge = make_share(app_url, mid)
    edge_now = parse_iso(edge["created_at"])
    assert call("POST", app_url, f"/api/missions/{mid}/share", json={"expires_utc": iso(edge_now + timedelta(seconds=MAX_EXPIRY_S - 60))}).status_code == 201
    link = make_share(app_url, mid, iso(parse_iso(edge["created_at"]) + timedelta(seconds=25)))
    tok, exp = link["token"], parse_iso(link["expires_utc"])
    with live_page(browser, share_url(app_url, tok), DESKTOP) as reader:
        expect(slider(reader)).to_be_visible(timeout=UI_WAIT * 1000)
        assert call("GET", app_url, f"/api/share/{tok}").status_code == 200
        deadline = time.monotonic() + RATE_WINDOW_S
        seen_expired = False
        while time.monotonic() < deadline and not seen_expired:
            h = call("GET", app_url, "/api/health")
            server_now = datetime.strptime(h.headers["date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc)
            seen_expired = server_now >= exp + timedelta(seconds=1)
        assert seen_expired, "the server clock never passed the link expiry"
        expect_error(call("GET", app_url, f"/api/share/{tok}"), 410, {"error": "link_expired"})
        expect(reader.get_by_role("heading", name=EXPIRED_HEADING, exact=True)).to_be_visible(timeout=LIVE_PAGE_MS)
    expect_error(call("GET", app_url, f"/api/share/{tok}/stream"), 410, {"error": "link_expired"})
    page = call("GET", app_url, f"/s/{tok}")
    assert page.status_code == 410 and EXPIRED_LINE in page.text
    assert mission(app_url, mid)["share"] is None
    expect_error(call("DELETE", app_url, f"/api/missions/{mid}/share"), 404, {"error": "no_active_link"})


def test_reader_view_address(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    count = jget(app_url, f"/api/share/{tok}/search", params={"q": "pass+1 Kestrel"})["count"]
    copy = f'No results for "pass+1 Kestrel"' if count == 0 else f'1 result for "pass+1 Kestrel"' if count == 1 else f'{count} results for "pass+1 Kestrel"'
    with opened(browser, f"{app_url}/s/{tok}?x=1&q=pass%2B1+Kestrel&distance=nmi&t=7200", DESKTOP, reduced_motion="reduce") as page:
        box = role(page, "searchbox", "Search transcript")
        ui(page, lambda: box.input_value() == "pass+1 Kestrel", "q fills the box")
        shows(page, role(page, "status", "Search status"), copy)
        ui(page, lambda: "ALT 10.8 nmi" in plate(page), "distance=nmi applies")
        box.fill("a b+c")
        ui(page, lambda: "q=a+b%2Bc" in urlparse(page.url).query, "q written with the form serializer")
        role(page, "radio", "km").check()
        ui(page, lambda: params(page).get("distance") == "km" and params(page).get("x") == "1", "unit written, x kept")
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        ui(page, lambda: params(page).get("t") == "7210", "t written")
        url = page.url
    with opened(browser, url, DESKTOP, reduced_motion="reduce") as page:
        ui(page, lambda: role(page, "searchbox", "Search transcript").input_value() == "a b+c" and slider_now(page) == 361 and "ALT" in plate(page) and " km" in plate(page), "address restores the view")
    with opened(browser, author_url(app_url, m["id"], q="x" * 201), DESKTOP, reduced_motion="reduce") as page:
        appears(page, slider(page), "console")
        assert role(page, "searchbox", "Search transcript").input_value() == ""
    with opened(browser, author_url(app_url, m["id"], q="perilune"), DESKTOP, reduced_motion="reduce") as page:
        shows(page, role(page, "status", "Search status"), '2 results for "perilune"')


def test_speaker_summary(app_url, browser):
    plan = [("__proto__", 3), ("constructor", 2), ("toString", 2), ("B", 1), ("a", 1), ("\uff5e", 1), ("\U0001f600", 1)]
    ts, k = {}, 0
    for name, n in plan:
        for _ in range(n):
            ts[k] = (name, f"line {k}")
            k += 1
    m, p, _ = parsed_mission(app_url, orbit_capture(range(k), ts, head=("# speakers",)))
    parsed_mission(app_url, small_capture(2, {0: ("__proto__", "other mission")}))
    expected = [{"name": "__proto__", "lines": 3}, {"name": "constructor", "lines": 2}, {"name": "toString", "lines": 2},
                {"name": "B", "lines": 1}, {"name": "a", "lines": 1}, {"name": "\uff5e", "lines": 1}, {"name": "\U0001f600", "lines": 1}]
    assert jget(app_url, f"/api/missions/{m['id']}/speakers")["speakers"] == expected
    tok = make_share(app_url, m["id"])["token"]
    assert jget(app_url, f"/api/share/{tok}/speakers")["speakers"] == expected
    for url in (author_url(app_url, m["id"]), share_url(app_url, tok)):
        with opened(browser, url, DESKTOP, reduced_motion="reduce") as page:
            lst = role(page, "list", "Speakers")
            ui(page, lambda: lst.get_by_role("listitem").count() == len(expected), "Speakers list")
            assert [norm(x.inner_text()) for x in lst.get_by_role("listitem").all()] == [f"{s['name']} {s['lines']}" for s in expected]


def test_wf_outages_storage(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    base, tok = outage("APP_STORAGE_DOWN_URL"), make_share(app_url, m["id"])["token"]
    assert jget(base, "/api/status")["storage"] == "down"
    expect_error(upload(base, m["id"], small_capture()), 503, {"error": "storage_unavailable"})
    for path in (f"/api/passes/{p['id']}/capture", f"/api/share/{tok}/captures/{p['id']}"):
        for h in ({}, {"Range": "bytes=0-1"}, {"If-None-Match": f'"{p["sha256"]}"'}):
            expect_error(call("GET", base, path, headers=h), 503, {"error": "storage_unavailable"})
        assert call("HEAD", base, path).status_code == 503
    with opened(browser, author_url(base, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        appears(page, page.get_by_role("alert").filter(has_text=BANNER_STORAGE), "storage banner")
        assert text_of(page.get_by_role("alert").filter(has_text=BANNER_STORAGE)) == BANNER_STORAGE
        upload_ui(page, "down.cap", small_capture())
        shows(page, role(page, "status", "Upload status"), "down.cap was not stored. Capture storage is offline.")
        role(page, "link", f"Download {p['filename']}").click()
        shows(page, role(page, "status", "Download status"), f"{p['filename']} was not downloaded. Capture storage is offline.")
        assert urlparse(page.url).path == f"/missions/{m['id']}"
        role(page, "button", "Play").click()
        advance(page, STEP_S * 1000 + 1000)
        ui(page, lambda: "MET +000:01:00:00" not in plate(page), "replay still plays")
    with opened(browser, share_url(base, tok, t=7200), DESKTOP, reduced_motion="reduce") as page:
        appears(page, page.get_by_role("alert").filter(has_text=BANNER_STORAGE), "storage banner on the share page")
        ui(page, lambda: "MET +000:02:00:00" in plate(page), "moment link places the lens during the outage")
    assert [x["id"] for x in mission(app_url, m["id"])["passes"]] == [p["id"]]


@pytest.mark.timeout(600)
def test_storage_recovery(app_url, browser):
    relay = Relay(os.environ["S3_ENDPOINT"])
    try:
        with app_copy(S3_ENDPOINT=relay.rewrite(os.environ["S3_ENDPOINT"])) as base:
            m = make_mission(base)
            data, key = small_capture(), idempotency_key()
            expect_error(upload(base, m["id"], data, key=key), 503, {"error": "storage_unavailable"})
            assert jget(base, "/api/status")["storage"] == "down"
            with opened(browser, author_url(base, m["id"]), DESKTOP, reduced_motion="reduce") as page:
                banner = page.get_by_role("alert").filter(has_text=BANNER_STORAGE)
                appears(page, banner, "storage banner while down")
                relay.set(True)
                ui(page, lambda: banner.count() == 0, "banner clears by itself", seconds=UI_WAIT * 2, step_ms=500)
            r = upload(base, m["id"], data, key=key)
            assert r.status_code == 202 and "idempotency-replayed" not in r.headers
            assert jget(base, "/api/status")["storage"] == "up"
            assert S3().get(f"captures/{m['id']}/{r.json()['id']}.cap") == data
    finally:
        relay.close()


def test_wf_outages_search(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    base, tok = outage("APP_SEARCH_DOWN_URL"), make_share(app_url, m["id"])["token"]
    assert jget(base, "/api/status")["search"] == "down"
    expect_error(call("GET", base, f"/api/missions/{m['id']}/search?q=perilune"), 503, {"error": "search_unavailable"})
    expect_error(call("GET", base, f"/api/share/{tok}/search?q=perilune"), 503, {"error": "search_unavailable"})
    assert pin(base, m["id"], 7200, "Saved while search is down").status_code == 201
    r = upload(base, m["id"], small_capture())
    assert r.status_code == 202 and settled_pass(base, r.json()["id"])["state"] == "parsed"
    for url in (author_url(base, m["id"]), share_url(base, tok)):
        with opened(browser, url, DESKTOP, reduced_motion="reduce") as page:
            appears(page, page.get_by_role("alert").filter(has_text=BANNER_SEARCH), "search banner")
    assert "Saved while search is down" in [e["title"] for e in jget(app_url, f"/api/missions/{m['id']}/events")["events"]]


@pytest.mark.timeout(600)
def test_search_recovery(app_url, browser):
    relay = Relay(os.environ["MEILISEARCH_URL"])
    word = "recov" + uuid.uuid4().hex[:6].replace("0", "q")
    try:
        with app_copy(MEILISEARCH_URL=relay.rewrite(os.environ["MEILISEARCH_URL"])) as base:
            m, p, _ = parsed_mission(app_url)
            assert pin(base, m["id"], 7200, f"Title {word}").status_code == 201
            expect_error(call("GET", base, f"/api/missions/{m['id']}/search?q={word}"), 503, {"error": "search_unavailable"})
            with opened(browser, author_url(base, m["id"]), DESKTOP, reduced_motion="reduce") as page:
                banner = page.get_by_role("alert").filter(has_text=BANNER_SEARCH)
                appears(page, banner, "search banner")
                relay.set(True)
                ui(page, lambda: banner.count() == 0, "search banner clears by itself", seconds=UI_WAIT * 2, step_ms=500)
            wait_for(lambda: call("GET", base, f"/api/missions/{m['id']}/search?q={word}").status_code == 200 and
                     call("GET", base, f"/api/missions/{m['id']}/search?q={word}").json()["count"] == 1, "the outage title becomes searchable", OBSERVE_S + RETRY_WINDOW_S)
    finally:
        relay.close()


def test_refused_changes_leave_no_trace(app_url, svix):
    m, p, data = parsed_mission(app_url)
    mid = m["id"]
    tok = make_share(app_url, mid)["token"]

    def state():
        mm = mission(app_url, mid)
        return (mm["change_version"], len(audit(app_url, mid)), mm["total_bytes"], len(mm["passes"]), mm["landmarks"],
                sorted(S3().keys(f"captures/{mid}/")), jget(app_url, f"/api/missions/{mid}/subscribers")["subscribers"])

    before = state()
    wait_for(lambda: [x for x in svix_messages(svix, mid) if x.get("eventType") == "pass.parsed"], "pass.parsed webhook")
    hooks_before = len(svix_messages(svix, mid))
    with sse(f"{app_url}/api/share/{tok}/stream") as (resp, events):
        assert isinstance(next_event(events, HTTP_TIMEOUT), dict)
        expect_error(upload(outage("APP_STORAGE_DOWN_URL"), mid, small_capture()), 503, {"error": "storage_unavailable"})
        expect_error(call("DELETE", outage("APP_STORAGE_DOWN_URL"), f"/api/passes/{p['id']}"), 503, {"error": "storage_unavailable"})
        expect_error(call("DELETE", outage("APP_SEARCH_DOWN_URL"), f"/api/passes/{p['id']}"), 503, {"error": "search_unavailable"})
        expect_error(call("POST", outage("APP_WEBHOOKS_DOWN_URL"), f"/api/missions/{mid}/subscribers", json={"url": "https://club.example/hooks/perilune"}), 503, {"error": "webhooks_unavailable"})
        assert next_event(events, QUIET_S) == "timeout", "a refused change must not reach the stream"
    assert state() == before and S3().get(f"captures/{mid}/{p['id']}.cap") == data
    assert len(svix_messages(svix, mid)) == hooks_before
    assert add_landmark(outage("APP_SEARCH_DOWN_URL"), mid, "Search down mark", 1, 1).status_code == 201
    assert pin(outage("APP_SEARCH_DOWN_URL"), mid, 7200, "Search down pin").status_code == 201
    assert mission(app_url, mid)["change_version"] == before[0] + 2


def test_outbox_transactional(app_url):
    m = make_mission(app_url)
    mid = m["id"]
    for base in (app_url, outage("APP_QUEUE_DOWN_URL")):
        r = upload(base, mid, small_capture())
        assert r.status_code == 202
        rows = Postgres().rows(f"SELECT kind FROM outbox WHERE pass_id = '{r.json()['id']}'")
        assert [x["kind"] for x in rows] == ["pass.parse"], "the parse job is queued in the stored transaction"
        settled_pass(app_url, r.json()["id"])
    note = "outbox-note-" + uuid.uuid4().hex[:6]
    pin(app_url, mid, FIRST_MET, "Outbox pin", note)
    v = mission(app_url, mid)["change_version"]
    rows = Postgres().rows(f"SELECT event_id, payload::text AS payload FROM outbox WHERE kind = 'webhook.send' AND event_id LIKE '{mid}:%' ORDER BY event_id")
    assert sorted(x["event_id"] for x in rows) == sorted(f"{mid}:{i}" for i in range(1, v + 1))
    assert all(note not in (x["payload"] or "") for x in rows)
    wait_for(lambda: all(x["delivered"] for x in Postgres().rows(f"SELECT delivered_at IS NOT NULL AS delivered FROM outbox WHERE kind = 'webhook.send' AND event_id LIKE '{mid}:%'")),
             "webhook rows are delivered through the broker")


def test_queue_topology(rabbitmq):
    qs = rabbitmq.queues()
    parse = qs["perilune.parse.q"]["arguments"]
    assert (parse.get("x-queue-type"), parse.get("x-delivery-limit"), parse.get("x-dead-letter-exchange")) == ("quorum", 3, "perilune.parse.dlx")
    for name in ("perilune.parse.dead", "perilune.parse.failed", "perilune.webhooks.q"):
        assert qs[name]["arguments"].get("x-queue-type") == "quorum" and qs[name]["durable"]
    for name in ("perilune.parse.q", "perilune.parse.failed", "perilune.webhooks.q"):
        assert qs[name]["consumers"] >= 1, f"{name} has no consumer"
    assert qs["perilune.parse.dead"]["consumers"] == 0
    assert {"perilune.parse", "perilune.parse.dlx", "perilune.webhooks"} <= set(rabbitmq.exchanges())
    binds = {(b.get("source"), b.get("destination"), b.get("routing_key")) for b in rabbitmq.bindings()}
    assert ("perilune.parse", "perilune.parse.q", "parse") in binds and ("perilune.webhooks", "perilune.webhooks.q", "send") in binds
    assert {("perilune.parse.dlx", q) for q in ("perilune.parse.dead", "perilune.parse.failed")} <= {(s, d) for s, d, _ in binds}


def test_parser_failure_dead_lettered(app_url, rabbitmq):
    m = make_mission(app_url)
    r = upload(app_url, m["id"], lines("# crash " + uuid.uuid4().hex, "S,2026-03-14T01:00:00Z,0.0,0.0,0.0,0.0,1.0,0.0"))
    t0 = time.monotonic()
    p = settled_pass(app_url, r.json()["id"], PARSER_FAILURE_BUDGET_S + POLL_SLACK_S)
    assert time.monotonic() - t0 <= PARSER_FAILURE_BUDGET_S + POLL_SLACK_S
    assert (p["state"], p["rejected_reason"], p["rejected_line"]) == ("rejected", "parser_failed", None)
    dead = rabbitmq.peek("perilune.parse.dead", 1000)
    bodies = [x["payload"] if isinstance(x["payload"], dict) else json.loads(x["payload"]) for x in dead]
    assert any(b.get("pass_id") == p["id"] for b in bodies), "the job is kept in perilune.parse.dead"
    assert [e["kind"] for e in audit(app_url, m["id"])].count("pass.rejected") == 1


def test_queue_outage(app_url, browser):
    base = outage("APP_QUEUE_DOWN_URL")
    m = make_mission(app_url)
    assert jget(base, "/api/status")["queue"] == "down"
    ids = []
    for _ in range(3):
        r = upload(base, m["id"], small_capture())
        assert r.status_code == 202 and r.json()["state"] == "stored"
        ids.append(r.json()["id"])
    with opened(browser, author_url(base, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        appears(page, page.get_by_role("alert").filter(has_text=BANNER_QUEUE), "queue banner")
        upload_ui(page, "queued.cap", small_capture())
        shows(page, role(page, "status", "Upload status"), "queued.cap stored, checksum verified. Queued for parsing...")
    for pid in ids:
        assert settled_pass(app_url, pid)["state"] == "parsed"
    assert [e["kind"] for e in audit(app_url, m["id"])].count("pass.parsed") >= 3


def test_renderer_outage(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    base, tok = outage("APP_RENDERER_DOWN_URL"), make_share(app_url, m["id"])["token"]
    for path in (f"/api/missions/{m['id']}/dossier.pdf", f"/api/share/{tok}/dossier.pdf"):
        expect_error(call("GET", base, path), 503, {"error": "renderer_unavailable"})
        assert call("HEAD", base, path).status_code == 503
    assert call("GET", base, f"/api/share/{tok}/events.csv").status_code == 200 and len(track(base, m["id"])) == SEED_COUNT
    with opened(browser, author_url(base, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        role(page, "link", "Download dossier").click()
        shows(page, role(page, "status", "Download status"), "The dossier was not created. The PDF renderer is offline.")
        assert urlparse(page.url).path == f"/missions/{m['id']}"


def test_landmark_records(app_url):
    m = make_mission(app_url)
    mid = m["id"]
    cases = [({"name": "", "lat_deg": 0, "lon_deg": 0}, {"name": LM_NAME_MSG}), ({"name": "n" * 41, "lat_deg": 0, "lon_deg": 0}, {"name": LM_NAME_MSG}),
             ({"name": "a", "lat_deg": 90.5, "lon_deg": 0}, {"lat_deg": LAT_MSG}), ({"name": "a", "lat_deg": 12.1234567, "lon_deg": 0}, {"lat_deg": LAT_MSG}),
             ({"name": "a", "lat_deg": "12", "lon_deg": 0}, {"lat_deg": LAT_MSG}), ({"name": "a", "lat_deg": 0, "lon_deg": -180}, {"lon_deg": LON_MSG}),
             ({"name": "a", "lat_deg": 0, "lon_deg": 180.5}, {"lon_deg": LON_MSG})]
    for body, errors in cases:
        expect_error(call("POST", app_url, f"/api/missions/{mid}/landmarks", json=body), 422, {"error": "validation", "errors": errors})
    made = [add_landmark(app_url, mid, n, la, lo) for n, la, lo in (("North", 90, 180), ("South", -90, -179.999999), ("Mid", 12.123456, 0), ("D", 0, 0))]
    assert all(r.status_code == 201 for r in made)
    racers = together([lambda i=i: add_landmark(app_url, mid, f"Race {i}", 0, 0) for i in range(3)])
    assert sorted(r.status_code for r in racers) == [201, 409, 409]
    assert all(r.json() == {"error": "landmark_limit", "message": "A mission holds at most 5 landmarks."} for r in racers if r.status_code == 409)
    expect_error(add_landmark(app_url, mid, "North", 0, 0), 409, {"error": "landmark_limit", "message": "A mission holds at most 5 landmarks."})
    listed = mission(app_url, mid)["landmarks"]
    assert [x["name"] for x in listed][:4] == ["North", "South", "Mid", "D"] and listed[2]["lat_deg"] == 12.123456
    lid = listed[0]["id"]
    assert call("DELETE", app_url, f"/api/missions/{mid}/landmarks/{lid}").status_code == 204
    expect_error(call("DELETE", app_url, f"/api/missions/{mid}/landmarks/{lid}"), 404, {"error": "landmark_not_found"})
    assert len(mission(app_url, mid)["landmarks"]) == 4


def test_landmark_coordinate_entry(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    valid = [("12.5° S", "45.25° W", -12.5, -45.25), ("−12.5", "-45.25", -12.5, -45.25), ("12.5s", "45.25 w", -12.5, -45.25), ("12.5 N", "45.25°E", 12.5, 45.25), ("0", "180", 0, 180)]
    invalid = [("-12.5 S", "1", "Latitude", LAT_ERR), ("12.5 E", "1", "Latitude", LAT_ERR), ("91", "1", "Latitude", LAT_ERR),
               ("1", "-180", "Longitude", LON_ERR), ("1", "1.1234567", "Longitude", LON_ERR), ("1", "12 N", "Longitude", LON_ERR)]
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        posts = []
        page.on("request", lambda rq: posts.append(rq) if rq.method == "POST" and rq.url.endswith("/landmarks") else None)
        name, lat, lon = role(page, "textbox", "Landmark name"), role(page, "textbox", "Latitude"), role(page, "textbox", "Longitude")
        appears(page, name, "landmark form")
        for i, (la, lo, elat, elon) in enumerate(valid):
            n = f"Mark {i}"
            name.fill(n)
            lat.fill(la)
            lon.fill(lo)
            role(page, "button", "Add landmark").click()
            ui(page, lambda: len(posts) == i + 1, f"{la}, {lo} is sent")
            assert (posts[-1].post_data_json["lat_deg"], posts[-1].post_data_json["lon_deg"]) == (elat, elon)
            shows(page, role(page, "status", "Console status"), f"Landmark {n} added.")
            role(page, "button", f"Remove {n}").click()
            shows(page, role(page, "status", "Console status"), f"Landmark {n} removed.")
        sent = len(posts)
        for la, lo, field, msg in invalid:
            name.fill("Bad")
            lat.fill(la)
            lon.fill(lo)
            role(page, "button", "Add landmark").click()
            appears(page, page.get_by_text(msg, exact=True), f"{field} error for {la}, {lo}")
            assert role(page, "textbox", field).get_attribute("aria-invalid") == "true" and is_focused(role(page, "textbox", field))
        assert len(posts) == sent, "refused coordinates must send nothing"
    assert mission(app_url, m["id"])["landmarks"] == []


def test_landmark_ranges(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    tok = make_share(app_url, mid)["token"]
    with opened(browser, author_url(app_url, mid, t=str(FIRST_MET)), TABLET, reduced_motion="reduce") as page:
        appears(page, slider(page), "disc")
        before = capture(slider(page))
    add_landmark(app_url, mid, "East", 0, 90)
    add_landmark(app_url, mid, "Far side", 0, 180)
    far = dist(haversine(0, 0, 0, 180))
    for url in (author_url(app_url, mid, t=str(FIRST_MET)), share_url(app_url, tok, t=str(FIRST_MET))):
        with opened(browser, url, TABLET, reduced_motion="reduce") as page:
            ui(page, lambda: "Range to East 2729.1 km".casefold() in plate(page).casefold(), "range line in km")
            text = plate(page).casefold()
            assert text.index("Range to East 2729.1 km".casefold()) < text.index(f"Range to Far side {far}".casefold())
            items = [norm(x.inner_text()) for x in role(page, "list", "Landmarks").get_by_role("listitem").all()]
            assert items[0].startswith("East 0.00° N, 90.00° E") and items[1].startswith("Far side 0.00° N, 180.00° E")
            if "/missions/" in url:
                assert difference(decode(before), decode(capture(slider(page)))) > 0, "the visible landmark is drawn on the disc"
    patch(app_url, mid, {"distance_unit": "nmi"})
    with opened(browser, author_url(app_url, mid, t=str(FIRST_MET)), TABLET, reduced_motion="reduce") as page:
        ui(page, lambda: "Range to East 1473.6 nmi".casefold() in plate(page).casefold(), "range line in nmi")


def test_wf_landmarks_and_reference_mark(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    n = unique("Landing")[0]
    with opened(browser, author_url(app_url, m["id"], t=str(FIRST_MET)), DESKTOP, reduced_motion="reduce") as page:
        name = role(page, "textbox", "Landmark name")
        name.fill(n)
        role(page, "textbox", "Latitude").fill("12.5° S")
        role(page, "textbox", "Longitude").fill("45.25° W")
        role(page, "textbox", "Longitude").press("Enter")
        shows(page, role(page, "status", "Console status"), f"Landmark {n} added.")
        assert is_focused(name) and name.input_value() == ""
        shows(page, role(page, "list", "Landmarks"), f"{n} 12.50° S, 45.25° W")
        ui(page, lambda: f"Range to {n}".casefold() in plate(page).casefold(), "range line")
        name.fill(n.upper())
        role(page, "textbox", "Latitude").fill("1")
        role(page, "textbox", "Longitude").fill("1")
        role(page, "button", "Add landmark").click()
        appears(page, page.get_by_text("A landmark with this name already exists.", exact=True), "name taken error")
        ui(page, lambda: is_focused(name), "focus on Landmark name")
        remove = role(page, "button", f"Remove {n}")
        remove.focus()
        page.keyboard.press("Enter")
        shows(page, role(page, "status", "Console status"), f"Landmark {n} removed.")
        ui(page, lambda: remove.count() == 0 and is_focused(name), "item gone and focus on Landmark name")
        assert f"Range to {n}".casefold() not in plate(page).casefold()
    assert mission(app_url, m["id"])["landmarks"] == []


def test_caseless_landmark_names(app_url):
    pairs = [("Straße", "STRASSE"), ("Å rim", "A\u030a RIM"), ("ﬃ crater", "FFI CRATER"), ("İzmir", "i\u0307zmir"), ("Σίσυφος", "ΣΊΣΥΦΟΣ")]
    for first, second in pairs:
        mid = make_mission(app_url)["id"]
        assert add_landmark(app_url, mid, first, 0, 0).status_code == 201
        expect_error(add_landmark(app_url, mid, second, 0, 0), 409, {"error": "landmark_name_taken", "message": "A landmark with this name already exists."})
        assert add_landmark(app_url, mid, first + " two", 0, 0).status_code == 201
        assert len(mission(app_url, mid)["landmarks"]) == 2


def test_reference_fetch_paged(app_url, wiremock):
    m, p, _ = parsed_mission(app_url)
    target, base = probe_target("PG"), os.environ.get("WIREMOCK_URL", "").rstrip("/")
    assert base, "WIREMOCK_URL must name the ephemeris stand-in"
    nxt = f"{base}/v3/vectors?target={target}&page=2"
    page1 = ('{"target":"%s","frame":"MCMF","units":{"position":"km","velocity":"km/s","time":"unix_ms"},"vectors":['
             '{"t":1.77345E12,"x":1.8374e3,"y":0,"z":0,"vx":0,"vy":1.38564,"vz":8E-1},'
             '{"t":1773453600000,"x":-1757.4,"y":0.0,"z":0.0,"vx":0.0,"vy":-1.47224,"vz":-0.85}]}') % target
    wiremock.stub("GET", "/v3/vectors", body=page1, headers={"Content-Type": "application/json", "Link": f'<{nxt}>; rel="next"'}, query={"target": {"equalTo": target}, "page": {"absent": True}})
    wiremock.stub("GET", "/v3/vectors", json=vectors_body(target, BASELINE_VECTORS[2:]), query={"target": {"equalTo": target}, "page": {"equalTo": "2"}})
    r = set_reference(app_url, m["id"], target)
    assert r.status_code == 200 and r.json()["outcome"] == "updated"
    ref = r.json()["mission"]["reference"]
    assert (ref["target"], ref["state"], ref["vector_count"]) == (target, "ready", 3)
    vecs = jget(app_url, f"/api/missions/{m['id']}/reference")["vectors"]
    assert [v["unix_ms"] for v in vecs] == [v[0] for v in BASELINE_VECTORS] and all(type(v["unix_ms"]) is int for v in vecs)
    for v, b in zip(vecs, BASELINE_VECTORS):
        assert abs(v["x_m"] - b[1] * 1000) <= DERIVED_TOL and abs(v["vy_m_s"] - b[5] * 1000) <= DERIVED_TOL and abs(v["vz_m_s"] - b[6] * 1000) <= DERIVED_TOL
    reqs = journal(wiremock, target)
    q = parse_qs(urlparse(reqs[0]["url"]).query)
    assert (q["from"], q["to"], q["step"]) == ([str(SEED_REF_FROM)], [str(SEED_REF_TO)], ["60"])
    assert len(reqs) == 2 and reqs[1]["url"] == urlparse(nxt).path + "?" + urlparse(nxt).query


def test_ephemeris_client_considerate(app_url, wiremock):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    secs, dated, longwait = probe_target("RA"), probe_target("RD"), probe_target("RL")
    wiremock.stub("GET", "/v3/vectors", status=429, headers={"Retry-After": "1"}, query={"target": {"equalTo": secs}})
    wiremock.stub("GET", "/v3/vectors", status=429, headers={"Retry-After": "Sun, 06 Nov 1994 08:49:37 GMT"}, query={"target": {"equalTo": dated}})
    wiremock.stub("GET", "/v3/vectors", status=429, headers={"Retry-After": "31"}, query={"target": {"equalTo": longwait}})
    for t, n in ((secs, 2), (dated, 2), (longwait, 1)):
        r = set_reference(app_url, mid, t)
        assert r.status_code == 200 and r.json()["outcome"] == "unavailable"
        assert len(journal(wiremock, t)) == n, f"{t}: expected {n} requests"
    a, b = journal(wiremock, secs)
    assert b["loggedDate"] - a["loggedDate"] >= 1000 - 50
    assert set_reference(app_url, mid, TESSERA).json()["outcome"] == "updated"
    r = call("POST", app_url, f"/api/missions/{mid}/reference/refresh")
    assert r.status_code == 200 and r.json()["outcome"] == "unchanged"
    reqs = journal(wiremock, TESSERA)[-2:]
    assert header_of(reqs[0], "If-None-Match") is None and header_of(reqs[1], "If-None-Match") == TESSERA_ETAG
    slow = probe_target("SQ")
    wiremock.stub("GET", "/v3/vectors", json=vectors_body(slow), delay_ms=1500, query={"target": {"equalTo": slow}})
    assert set_reference(app_url, mid, slow).status_code == 200
    second = outage("APP_SECOND_URL")
    together([lambda b=b: call("POST", b, f"/api/missions/{mid}/reference/refresh") for b in (app_url, second, app_url)])
    stamps = [x["loggedDate"] for x in journal(wiremock, slow)]
    assert len(stamps) == 4 and all(y - x >= 1500 - 50 for x, y in zip(stamps, stamps[1:])), "requests overlapped"


def test_ephemeris_failures(app_url, wiremock):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    assert set_reference(app_url, mid, TESSERA).status_code == 200
    before = mission(app_url, mid)
    expect_error(set_reference(app_url, mid, probe_target("NONE")), 422, {"error": "validation", "errors": {"target": UNKNOWN_TARGET_MSG}})
    expect_error(set_reference(app_url, mid, "lower"), 422, {"error": "validation", "errors": {"target": TARGET_MSG}})
    assert mission(app_url, mid)["reference"] == before["reference"] and mission(app_url, mid)["change_version"] == before["change_version"]
    bad, slow, broken = probe_target("BF"), probe_target("SL"), probe_target("FT")
    wiremock.stub("GET", "/v3/vectors", json=vectors_body(bad, frame="ECEF"), query={"target": {"equalTo": bad}})
    wiremock.stub("GET", "/v3/vectors", json=vectors_body(slow), delay_ms=4000, query={"target": {"equalTo": slow}})
    wiremock.stub("GET", "/v3/vectors", fault="CONNECTION_RESET_BY_PEER", query={"target": {"equalTo": broken}})
    for t in (bad, slow, broken):
        r = set_reference(app_url, mid, t)
        assert r.status_code == 200 and r.json()["outcome"] == "unavailable" and r.json()["mission"]["reference"]["state"] == "unavailable"
        assert all(s["residual_m"] is None for s in track(app_url, mid))
    down = set_reference(outage("APP_EPHEMERIS_DOWN_URL"), mid, TESSERA)
    assert down.status_code == 200 and down.json()["outcome"] == "unavailable"
    assert pin(app_url, mid, 7200, "still works").status_code == 201
    assert set_reference(app_url, mid, TESSERA).json()["outcome"] == "updated" and mission(app_url, mid)["reference"]["state"] == "ready"


def test_residuals(app_url, browser):
    data = orbit_capture(range(-1, SEED_COUNT), SEED_TRANSCRIPT)
    m, p, _ = parsed_mission(app_url, data)
    mid = m["id"]
    pin(app_url, mid, 7200, "Peri ref")
    assert "ΔR" not in json.dumps([s["residual_m"] for s in track(app_url, mid) if s["residual_m"] is not None])
    assert set_reference(app_url, mid, TESSERA).status_code == 200
    tr = track(app_url, mid)
    vecs = [(t, x * 1000, y * 1000, z * 1000) for t, x, y, z, *_ in BASELINE_VECTORS]
    for s, (utc, v) in zip(tr, parse_samples(data)):
        ms = int(utc.timestamp() * 1000)
        if ms < vecs[0][0] or ms > vecs[-1][0]:
            assert s["residual_m"] is None
            continue
        i = max(j for j, vv in enumerate(vecs) if vv[0] <= ms)
        a, b = vecs[i], vecs[min(i + 1, len(vecs) - 1)]
        f = 0 if b[0] == a[0] else (ms - a[0]) / (b[0] - a[0])
        ref = [a[c] + (b[c] - a[c]) * f for c in (1, 2, 3)]
        assert abs(s["residual_m"] - math.dist(v[:3], ref)) <= DERIVED_TOL
    assert dist(tr[1]["residual_m"]) == "0.0 km" and dist(tr[181]["residual_m"]) == "1797.8 km"
    tok = make_share(app_url, mid)["token"]
    with opened(browser, share_url(app_url, tok, t=str(FIRST_MET - STEP_S)), DESKTOP, reduced_motion="reduce") as page:
        ui(page, lambda: "ΔR —" in plate(page), "null residual shows a dash")
        role(page, "textbox", "Go to GMT").fill("2026-073/01:30:00")
        role(page, "textbox", "Go to GMT").press("Enter")
        ui(page, lambda: "ΔR 1797.8 km" in plate(page), "ΔR at k=180")
    assert call("GET", app_url, f"/api/share/{tok}/events.csv").text.split("\r\n")[1].endswith(",20.0,1700,0.0")
    assert "ΔR 0.0 km" in norm(pdf_text(call("GET", app_url, f"/api/missions/{mid}/dossier.pdf").content))
    bare, _, _ = parsed_mission(app_url, small_capture())
    assert all(s["residual_m"] is None for s in track(app_url, bare["id"]))


def test_wf_landmarks_and_reference_set(app_url, browser, wiremock):
    m, p, _ = parsed_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    with opened(browser, author_url(app_url, m["id"], t="5400"), DESKTOP, reduced_motion="reduce") as page:
        status = role(page, "status", "Console status")
        role(page, "textbox", "Reference target").fill(TESSERA)
        role(page, "button", "Set reference").click()
        shows(page, status, f"Reference {TESSERA} ready: 3 vectors.")
        shows(page, role(page, "region", "Reference"), f"Reference {TESSERA}: ready, 3 vectors")
        ui(page, lambda: "ΔR 1797.8 km" in plate(page), "ΔR on the plate")
        role(page, "button", "Refresh reference").click()
        shows(page, status, f"Reference {TESSERA} unchanged.")
        with opened(browser, share_url(app_url, tok, t="5400"), DESKTOP, reduced_motion="reduce") as reader:
            ui(reader, lambda: "ΔR 1797.8 km" in plate(reader), "share page repeats ΔR")
        role(page, "textbox", "Reference target").fill("")
        role(page, "button", "Set reference").click()
        shows(page, status, "Reference cleared.")
        ui(page, lambda: "ΔR" not in plate(page) and role(page, "button", "Refresh reference").count() == 0, "ΔR and Refresh gone after clear")
    assert mission(app_url, m["id"])["reference"] is None
    q = parse_qs(urlparse(journal(wiremock, TESSERA)[0]["url"]).query)
    assert (q["from"], q["to"], q["step"]) == ([str(SEED_REF_FROM)], [str(SEED_REF_TO)], ["60"])


def test_console_state_survives_timers(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    with opened(browser, author_url(app_url, m["id"], t="7200", q="perilune"), DESKTOP, reduced_motion="reduce") as page:
        shows(page, role(page, "status", "Search status"), '2 results for "perilune"')
        role(page, "button", "Pin event").click()
        dlg = role(page, "dialog", "Pin event")
        title = role(dlg, "textbox", "Title")
        title.fill("draft title")
        url = page.url
        for _ in range(4):
            advance(page, STATUS_CHECK_MS)
        assert dlg.is_visible() and title.input_value() == "draft title" and is_focused(title)
        assert role(page, "searchbox", "Search transcript").input_value() == "perilune" and slider_now(page) == 360 and page.url == url
    with opened(browser, share_url(app_url, tok, t="7200", q="perilune"), PHONE, reduced_motion="reduce") as page:
        shows(page, role(page, "status", "Search status"), '2 results for "perilune"')
        role(page, "button", "Channels").click()
        drawer = role(page, "dialog", "Channels")
        appears(page, drawer, "drawer open")
        ui(page, lambda: is_focused(role(drawer, "radio", "km")), "focus in drawer")
        url = page.url
        pin(app_url, m["id"], 7200, "Pushed perilune event")
        shows(page, role(page, "table", "Events"), "Pushed perilune event")
        for _ in range(2):
            advance(page, STATUS_CHECK_MS)
        assert drawer.is_visible() and is_focused(role(drawer, "radio", "km"))
        assert role(page, "searchbox", "Search transcript").input_value() == "perilune" and slider_now(page) == 360 and page.url == url


def test_change_stream(app_url):
    m, p, _ = parsed_mission(app_url)
    mid, second = m["id"], outage("APP_SECOND_URL")
    tok = make_share(app_url, mid)["token"]
    v0 = mission(app_url, mid)["change_version"]
    with sse(f"{second}/api/share/{tok}/stream") as (resp, events):
        assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
        e = next_event(events, HTTP_TIMEOUT)
        assert (e["event"], e["id"], json.loads(e["data"])) == ("mission-changed", str(v0), {"version": v0})
        pin(app_url, mid, 7200, "stream one")
        answered = time.monotonic()
        e = next_event(events, HTTP_TIMEOUT)
        assert e["id"] == str(v0 + 1) and e["at"] - answered <= STREAM_DELIVERY_S
        add_landmark(app_url, mid, "Stream mark", 0, 0)
        assert next_event(events, HTTP_TIMEOUT)["id"] == str(v0 + 2)
    with sse(f"{app_url}/api/share/{tok}/stream", {"Last-Event-ID": str(v0)}) as (resp, events):
        assert [next_event(events, HTTP_TIMEOUT)["id"] for _ in range(2)] == [str(v0 + 1), str(v0 + 2)]
    with sse(f"{app_url}/api/share/{tok}/stream", {"Last-Event-ID": str(v0 + 2)}) as (resp, events):
        assert next_event(events, QUIET_S) == "timeout"
        pin(app_url, mid, 7200, "stream two")
        assert next_event(events, HTTP_TIMEOUT)["id"] == str(v0 + 3)
    for junk in ("abc", str(v0 - MAX_REPLAY_GAP - 5)):
        with sse(f"{app_url}/api/share/{tok}/stream", {"Last-Event-ID": junk}) as (resp, events):
            assert next_event(events, HTTP_TIMEOUT)["id"] == str(v0 + 3)
    with sse(f"{second}/api/share/{tok}/stream") as (resp, events):
        next_event(events, HTTP_TIMEOUT)
        call("DELETE", app_url, f"/api/missions/{mid}/share")
        assert next_event(events, HTTP_TIMEOUT)["id"] == str(v0 + 4)
        assert next_event(events, HTTP_TIMEOUT) is None, "the stream ends after the revocation message"
    expect_error(call("GET", app_url, f"/api/share/{tok}/stream"), 410, {"error": "link_revoked"})


def test_wf_share_live_reader(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    mid, tok = m["id"], make_share(app_url, m["id"])["token"]
    with live_page(browser, share_url(outage("APP_SECOND_URL"), tok, t="7200"), DESKTOP) as reader:
        expect(slider(reader)).to_be_visible(timeout=UI_WAIT * 1000)
        ui(reader, lambda: current_buttons(reader) == 1, "the current line's button carries current-state")
        pin(app_url, mid, 7200, "Live pin")
        expect(role(reader, "table", "Events")).to_contain_text("Live pin", timeout=LIVE_PAGE_MS)
        add_landmark(app_url, mid, "Live mark", 0, 180)
        expect(role(reader, "list", "Landmarks")).to_contain_text("Live mark", timeout=LIVE_PAGE_MS)
        set_reference(app_url, mid, TESSERA)
        expect(role(reader, "group", "Readout")).to_contain_text("ΔR", timeout=LIVE_PAGE_MS)
        r = upload(app_url, mid, small_capture(), "live.cap")
        settled_pass(app_url, r.json()["id"])
        expect(role(reader, "list", "Captures").get_by_role("link", name="Download live.cap", exact=True)).to_be_visible(timeout=LIVE_PAGE_MS)
        call("DELETE", app_url, f"/api/passes/{r.json()['id']}")
        expect(role(reader, "list", "Captures").get_by_role("link", name="Download live.cap", exact=True)).to_have_count(0, timeout=LIVE_PAGE_MS)
        call("DELETE", app_url, f"/api/missions/{mid}/share")
        expect(reader.get_by_role("heading", name=WITHDRAWN_HEADING, exact=True)).to_be_visible(timeout=LIVE_PAGE_MS)
    expect_error(call("GET", app_url, f"/api/share/{tok}"), 410, {"error": "link_revoked"})


def test_share_rate_limit(app_url, valkey):
    m, p, _ = parsed_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    bases = [app_url, outage("APP_SECOND_URL")]
    for i in range(1, RATE_LIMIT + 1):
        r = call("GET", bases[i % 2], f"/api/share/{tok}/track" if i % 3 else f"/api/share/{tok}")
        assert r.status_code == 200 and r.headers["ratelimit-policy"] == "120;w=60"
        fields = dict(x.strip().split("=") for x in r.headers["ratelimit"].split(","))
        assert fields["limit"] == "120" and fields["remaining"] == str(RATE_LIMIT - i) and int(fields["reset"]) >= 1
    over = call("GET", app_url, f"/api/share/{tok}")
    expect_error(over, 429, {"error": "rate_limited"})
    assert 1 <= int(over.headers["retry-after"]) <= RATE_WINDOW_S and "remaining=0" in over.headers["ratelimit"]
    html = call("GET", bases[1], f"/s/{tok}")
    assert html.status_code == 429 and RATE_HEADING in html.text
    assert 1 <= valkey.ttl(f"perilune:share-rate:{tok}") <= RATE_WINDOW_S
    call("DELETE", app_url, f"/api/missions/{m['id']}/share")
    expect_error(call("GET", app_url, f"/api/share/{tok}"), 429, {"error": "rate_limited"})
    tok2 = make_share(app_url, m["id"])["token"]
    for _ in range(RATE_LIMIT + 5):
        r = call("GET", outage("APP_CACHE_DOWN_URL"), f"/api/share/{tok2}")
        assert r.status_code == 200 and "ratelimit" not in r.headers


def test_wf_share_live_count(app_url, browser, valkey):
    m, p, _ = parsed_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    with live_page(browser, author_url(app_url, m["id"]), DESKTOP) as author:
        share = role(author, "region", "Share")
        expect(share).to_contain_text("Readers now: 0", timeout=UI_WAIT * 1000)
        context = browser.new_context(viewport=PHONE)
        reader = context.new_page()
        reader.goto(share_url(outage("APP_SECOND_URL"), tok))
        expect(slider(reader)).to_be_visible(timeout=UI_WAIT * 1000)
        expect(share).to_contain_text("Readers now: 1", timeout=LIVE_PAGE_MS)
        keys = valkey.keys(f"perilune:reader:{m['id']}:*")
        assert len(keys) == 1 and 0 < valkey.ttl(keys[0]) <= READER_KEY_TTL_S
        context.close()
        expect(share).to_contain_text("Readers now: 0", timeout=LIVE_PAGE_MS)
    assert valkey.keys(f"perilune:reader:{m['id']}:*") == []
    with live_page(browser, author_url(outage("APP_CACHE_DOWN_URL"), m["id"]), DESKTOP) as author:
        expect(role(author, "region", "Share")).to_contain_text("Readers now: unknown", timeout=UI_WAIT * 1000)
    with sse(f"{outage('APP_CACHE_DOWN_URL')}/api/missions/{m['id']}/stream") as (resp, events):
        e = next_event(events, HTTP_TIMEOUT)
        assert e["event"] == "readers" and json.loads(e["data"]) == {"readers": None}


def test_released_on_close(app_url):
    m, p, _ = parsed_mission(app_url, filler(3000000, "close") + b"\n" + small_capture())
    tok = make_share(app_url, m["id"])["token"]
    for _ in range(10):
        with sse(f"{app_url}/api/share/{tok}/stream") as (resp, events):
            next_event(events, HTTP_TIMEOUT)
        for path in (f"/api/share/{tok}/captures/{p['id']}", f"/api/passes/{p['id']}/capture"):
            with httpx.stream("GET", app_url + path, timeout=HTTP_TIMEOUT) as r:
                next(r.iter_bytes(1024))
    sql = ("SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user "
           "AND state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')")
    deadline, clean = time.monotonic() + SESSION_RELEASE_S, False
    while time.monotonic() < deadline and not clean:
        clean = Postgres().rows(sql)[0]["n"] == 0
    assert clean, "app sessions stayed active or idle in transaction after the clients left"
    assert call("GET", app_url, f"/s/{tok}").status_code == 200 and call("GET", app_url, "/api/health").status_code == 200


def test_wf_full_replay_journey_doy(app_url, browser):
    with opened(browser, app_url + "/", DESKTOP, reduced_motion="reduce") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "Pacific/Kiritimati"})
        posts = []
        page.on("request", lambda rq: posts.append(rq) if rq.method == "POST" and rq.url.endswith("/api/missions") else None)
        epoch = role(page, "textbox", "Epoch (GMT)")
        role(page, "textbox", "Mission name").fill(unique("Doy")[0])
        for bad in ("2027-366/00:00:00", "2028-061/00:00:60", "2028-61/00:00:30", "2028-03-01T00:00:30Z"):
            epoch.fill(bad)
            role(page, "button", "Create mission").click()
            appears(page, page.get_by_text(DOY_ERR, exact=True), "day-of-year error")
            assert is_focused(epoch) and epoch.get_attribute("aria-invalid") == "true"
        assert posts == []
        epoch.fill("2028-061/00:00:30")
        role(page, "button", "Create mission").click()
        ui(page, lambda: len(posts) == 1, "mission request sent")
        assert posts[0].post_data_json["epoch_utc"] == "2028-03-01T00:00:30Z"
        appears(page, page.get_by_text("Epoch 2028-061/00:00:30", exact=True), "epoch shown in day-of-year form")
        mid = urlparse(page.url).path.rsplit("/", 1)[-1]
    assert mission(app_url, mid)["epoch_utc"] == "2028-03-01T00:00:30Z"
    m, p, _ = parsed_mission(app_url)
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "America/Los_Angeles"})
        posts = []
        page.on("request", lambda rq: posts.append(rq) if rq.method == "POST" and rq.url.endswith("/share") else None)
        field = role(page, "textbox", "Link expiry (GMT)")
        field.fill("2026-400/00:00:00")
        role(page, "button", "Create share link").click()
        appears(page, page.get_by_text(DOY_ERR, exact=True), "expiry error")
        assert posts == [] and is_focused(field)
        target = parse_iso(m["created_at"]).replace(hour=23, minute=59, second=59) + timedelta(days=30)
        field.fill(gmt(iso(target)))
        role(page, "button", "Create share link").click()
        ui(page, lambda: len(posts) == 1, "share request sent")
        assert posts[0].post_data_json == {"expires_utc": iso(target)}
    assert mission(app_url, m["id"])["share"]["expires_utc"] == iso(target)


def test_instants_doy_shown(app_url, browser):
    epoch = "2026-03-14T00:00:00Z"
    m, p, _ = parsed_mission(app_url, epoch=epoch)
    link = make_share(app_url, m["id"])
    exp = link["expires_utc"]
    iso_re = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
    assert all(iso_re.match(x) for x in (mission(app_url, m["id"])["epoch_utc"], exp, link["created_at"], track(app_url, m["id"])[0]["utc"]))
    with opened(browser, author_url(app_url, m["id"], t="7200"), DESKTOP, reduced_motion="reduce") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "Asia/Kathmandu"})
        page.reload()
        appears(page, page.get_by_text(f"Epoch {SEED_EPOCH_GMT}", exact=True), "header epoch")
        shows(page, role(page, "region", "Share"), f"Expires {gmt(exp)}")
        ui(page, lambda: "GMT 2026-073/02:00:00" in plate(page), "plate GMT line")
    with opened(browser, share_url(app_url, link["token"]), DESKTOP, reduced_motion="reduce") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "Pacific/Honolulu"})
        page.reload()
        appears(page, page.get_by_text(f"Expires {gmt(exp)}", exact=True), "share page expiry line")
        appears(page, page.get_by_text(f"Epoch {SEED_EPOCH_GMT}", exact=True), "share page epoch")


@pytest.mark.timeout(1200)
def test_wf_full_replay_journey_two_instances(app_url, browser):
    name, lm, note = unique("Journey")[0], unique("Site")[0], "journey-note-" + uuid.uuid4().hex[:6]
    data = seed_capture()
    with opened(browser, app_url + "/", DESKTOP, reduced_motion="reduce") as author:
        role(author, "textbox", "Mission name").fill(name)
        role(author, "textbox", "Epoch (GMT)").fill(SEED_EPOCH_GMT)
        role(author, "button", "Create mission").click()
        appears(author, author.get_by_role("heading", name=name, level=1, exact=True), "console")
        mid = urlparse(author.url).path.rsplit("/", 1)[-1]
        upload_ui(author, "journey.cap", data)
        shows(author, role(author, "list", "Passes"), f"Parsed: {SEED_COUNT} samples", seconds=SETTLE_WAIT)
        role(author, "button", "Pin event").click()
        dlg = role(author, "dialog", "Pin event")
        role(dlg, "textbox", "MET").fill("+000:02:00:00")
        role(dlg, "textbox", "Title").fill(SEED_EVENT_TITLE)
        role(dlg, "textbox", "Private note").fill(note)
        role(dlg, "button", "Save event").click()
        shows(author, role(author, "status", "Console status"), "Event pinned at +000:02:00:00.")
        role(author, "textbox", "Landmark name").fill(lm)
        role(author, "textbox", "Latitude").fill("0")
        role(author, "textbox", "Longitude").fill("90 E")
        role(author, "button", "Add landmark").click()
        shows(author, role(author, "status", "Console status"), f"Landmark {lm} added.")
        role(author, "textbox", "Reference target").fill(TESSERA)
        role(author, "button", "Set reference").click()
        shows(author, role(author, "status", "Console status"), f"Reference {TESSERA} ready: 3 vectors.")
        role(author, "radio", "nmi").check()
        shows(author, role(author, "status", "Console status"), "Units saved: nmi and m/s.")
        role(author, "button", "Create share link").click()
        url = role(author, "textbox", "Share link").input_value()
        tok = url.rsplit("/s/", 1)[1]
        with live_page(browser, share_url(outage("APP_SECOND_URL"), tok), PHONE, timezone_id="Pacific/Honolulu") as reader:
            box = role(reader, "textbox", "Go to GMT")
            expect(box).to_be_visible(timeout=UI_WAIT * 1000)
            box.fill("2026-073/02:00:05")
            box.press("Enter")
            readout = role(reader, "group", "Readout")
            for line in ("ALT 10.8 nmi", f"ΔR {dist(0, 'nmi')}", f"Range to {lm} 1473.6 nmi"):
                ui(reader, lambda line=line: line.casefold() in plate(reader).casefold(), f"readout shows {line}")
            ui(reader, lambda: current_buttons(reader) == 1, "the current line's button carries current-state")
            role(reader, "button", "Channels").click()
            role(reader, "dialog", "Channels").get_by_role("radio", name="km", exact=True).check()
            role(reader, "button", "Close channels").click()
            expect(readout).to_contain_text("ALT 20.0 km", use_inner_text=True, timeout=UI_WAIT * 1000)
            assert reader.url.endswith("distance=km") or "distance=km" in reader.url
            with reader.expect_download() as dl:
                role(reader, "list", "Captures").get_by_role("link", name="Download journey.cap", exact=True).click()
            assert Path(dl.value.path()).read_bytes() == data
            with reader.expect_download() as dl:
                role(reader, "link", "Download event list").click()
            assert f"'+000:02:00:00,7200,{SEED_EVENT_TITLE},20.0,1700,0.0\r\n" in Path(dl.value.path()).read_bytes().decode("utf-8")
            with reader.expect_download() as dl:
                role(reader, "link", "Download dossier").click()
            dossier = Path(dl.value.path()).read_bytes()
            assert pdf_pages(dossier) >= 1 and "ALT 20.0 km" in norm(pdf_text(dossier)) and note not in pdf_text(dossier)
            shows(author, role(author, "region", "Share"), "Readers now: 1", seconds=LIVE_PAGE_MS / 1000 + POLL_SLACK_S)
            role(author, "button", "Pin event").click()
            role(dlg, "textbox", "Title").fill("Second live event")
            role(dlg, "button", "Save event").click()
            expect(role(reader, "table", "Events")).to_contain_text("Second live event", timeout=LIVE_PAGE_MS)
            assert note not in reader.content()
            with live_page(browser, reader.url.split("?")[0] + "?t=7200", DESKTOP) as again:
                ui(again, lambda: "MET +000:02:00:00" in plate(again), "moment link opens on the second instance")
            role(author, "button", "Revoke share link").click()
            expect(reader.get_by_role("heading", name=WITHDRAWN_HEADING, exact=True)).to_be_visible(timeout=LIVE_PAGE_MS)
    r = call("GET", outage("APP_SECOND_URL"), f"/api/passes/{mission(app_url, mid)['passes'][0]['id']}/capture", headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and r.content == data[:100]
    expect_error(call("GET", app_url, f"/api/share/{tok}"), 410, {"error": "link_revoked"})


def test_mission_dossier(app_url):
    name = unique("Dossier")[0] + " é"
    m, p, _ = parsed_mission(app_url, mname=name)
    note = "dossier-note-" + uuid.uuid4().hex[:6]
    pin(app_url, m["id"], 7200, SEED_EVENT_TITLE, note)
    add_landmark(app_url, m["id"], "East", 0, 90)
    tok = make_share(app_url, m["id"])["token"]
    for path, units, has_note in ((f"/api/missions/{m['id']}/dossier.pdf", ("km", "m_s"), True), (f"/api/share/{tok}/dossier.pdf?distance=nmi&speed=ft_s", ("nmi", "ft_s"), False)):
        r = call("GET", app_url, path)
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf") and pdf_pages(r.content) >= 1
        plain, ext = disposition_names(r.headers["content-disposition"])
        assert ext == f"{name}-dossier.pdf" and plain == fallback_name(f"{name}-dossier.pdf")
        assert pdf_title(r.content) == name
        text = norm(pdf_text(r.content))
        s = track(app_url, m["id"])[360]
        order = [name, f"Mission dossier · Epoch {SEED_EPOCH_GMT}", "Perilune MET", "Events", "Landmarks", "Reference"]
        idx = [text.find(x) for x in order]
        assert all(i >= 0 for i in idx) and idx == sorted(idx), f"sections out of order: {idx}"
        for line in plate_lines(s, *units):
            assert line in text, f"dossier lacks {line}"
        assert f"East 0.00° N, 90.00° E, range {dist(haversine(s['lat_deg'], s['lon_deg'], 0, 90), units[0])} at perilune" in text
        assert "No reference target" in text and "ΔR" not in text
        assert re.search(r"Generated \d{4}-\d{3}/\d{2}:\d{2}:\d{2} · Perilune Ledger", text)
        assert (note in text) is has_note
        h = call("HEAD", app_url, path)
        assert h.status_code == 200 and h.content == b"" and h.headers["content-type"] == r.headers["content-type"]
        assert h.headers["content-disposition"] == r.headers["content-disposition"]
    empty = make_mission(app_url)
    text = norm(pdf_text(call("GET", app_url, f"/api/missions/{empty['id']}/dossier.pdf").content))
    assert "No samples yet" in text and "No events" in text and "No landmarks" in text


def plan(base: str = None) -> dict:
    return jget(base, "/api/plan")


def put_plan(base: str, pid: str) -> httpx.Response:
    return call("PUT", base, "/api/plan", json={"plan": pid}, timeout=HTTP_TIMEOUT * 2)


def fill_to(base: str, mid: str, remaining: int) -> list[str]:
    ids = []
    for i in range(400):
        pl = plan(base)
        rem = pl["quota_bytes"] - pl["used_bytes"]
        if rem <= remaining:
            return ids
        r = upload(base, mid, filler(min(CAPTURE_LIMIT, rem - remaining), f"{mid}-{i}"))
        assert r.status_code == 202, r.text
        ids.append(r.json()["id"])
    pytest.fail("could not fill the Archive quota")


def drain(base: str, ids: list[str]) -> None:
    for pid in ids:
        if call("GET", base, f"/api/passes/{pid}").status_code == 200:
            settled_pass(base, pid)
            call("DELETE", base, f"/api/passes/{pid}")


def test_archive_plan_billing(app_url, killbill):
    try:
        r = put_plan(app_url, "archive-1")
        assert r.status_code == 200, r.text
        pl = r.json()
        assert (pl["plan"], pl["label"], pl["price_cents"], pl["period"], pl["quota_bytes"], pl["billing"]) == ("archive-1", "Archive 1 GiB", 400, "month", ONE_GIB_QUOTA, "up")
        assert all(type(pl[k]) is int for k in ("price_cents", "quota_bytes", "used_bytes", "balance_cents"))
        acct = killbill.account_by_key("perilune-author")
        assert acct and acct["currency"] == "USD" and acct["name"] == "Perilune Ledger author"
        subs = [s for s in killbill.subscriptions(acct["accountId"]) if s.get("state") == "ACTIVE"]
        assert len(subs) == 1 and subs[0]["planName"] == "archive-1" and subs[0]["chargedThroughDate"] == pl["next_billing_date"]
        amounts = [Decimal(str(i["amount"])) for inv in killbill.invoices(acct["accountId"]) for i in inv.get("items", [])]
        assert Decimal("4.00") in amounts and int(Decimal("4.00") * 100) == pl["price_cents"]
        with_balance = killbill.client.get("/accounts", params={"externalKey": "perilune-author", "accountWithBalance": "true"}).json()
        assert int(Decimal(str(with_balance["accountBalance"])) * 100) == pl["balance_cents"]
        n = len(killbill.invoices(acct["accountId"]))
        assert put_plan(app_url, "archive-1").json()["plan"] == "archive-1" and len(killbill.invoices(acct["accountId"])) == n
        expect_error(put_plan(app_url, "archive-5"), 422, {"error": "validation", "errors": {"plan": PLAN_MSG}})
        down = outage("APP_BILLING_DOWN_URL")
        expect_error(put_plan(down, "archive-10-annual"), 503, {"error": "billing_unavailable"})
        dp = plan(down)
        assert (dp["plan"], dp["billing"], dp["next_billing_date"], dp["balance_cents"]) == ("archive-1", "down", None, None)
        assert plan(app_url)["plan"] == "archive-1"
    finally:
        put_plan(app_url, "archive-free")


def test_archive_plan_display(app_url, browser):
    pl = plan(app_url)
    prices = {"archive-free": "Free", "archive-1": "4.00 USD/month", "archive-10-annual": "24.00 USD/month, billed 288.00 USD yearly"}
    radios = {"archive-free": "Free, 256.0 MiB", "archive-1": "Archive 1 GiB, 4.00 USD/month", "archive-10-annual": "Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly"}
    with opened(browser, app_url + "/", DESKTOP, reduced_motion="reduce") as page:
        region = role(page, "region", "Archive plan")
        shows(page, region, f"Plan {pl['label']}: {prices[pl['plan']]}")
        text = text_of(region)
        assert f"Used {size_fmt(pl['used_bytes'])} of {size_fmt(pl['quota_bytes'])}" in text
        assert f"Next invoice {pl['next_billing_date'] or '—'}" in text
        assert f"Balance {money(pl['balance_cents']) + ' USD' if pl['balance_cents'] is not None else '—'}" in text
        group = role(page, "radiogroup", "Plan")
        for pid, label in radios.items():
            assert role(group, "radio", label).is_checked() is (pid == pl["plan"])
        appears(page, page.get_by_role("heading", name="Missions", level=1, exact=True), "Missions heading")


@pytest.mark.timeout(1800)
def test_storage_quota(app_url):
    assert put_plan(app_url, "archive-free").status_code == 200
    m = make_mission(app_url)
    ids = []
    try:
        ids += fill_to(app_url, m["id"], 3000000)
        racers = together([lambda i=i: upload(app_url, m["id"], filler(1200000, f"race-{m['id']}-{i}")) for i in range(3)])
        assert sorted(r.status_code for r in racers) == [202, 202, 409]
        ids += [r.json()["id"] for r in racers if r.status_code == 202]
        pl = plan(app_url)
        rem = pl["quota_bytes"] - pl["used_bytes"]
        expect_error(upload(app_url, m["id"], filler(rem + 1, f"over-{m['id']}")), 409, {"error": "quota_exceeded", "quota_bytes": FREE_QUOTA, "used_bytes": pl["used_bytes"]})
        exact = upload(app_url, m["id"], filler(rem, f"exact-{m['id']}"))
        assert exact.status_code == 202
        ids.append(exact.json()["id"])
        assert plan(app_url)["used_bytes"] == FREE_QUOTA
    finally:
        drain(app_url, ids)


@pytest.mark.timeout(1800)
def test_wf_archive_plan_upgrade(app_url, browser, killbill):
    assert put_plan(app_url, "archive-free").status_code == 200
    m = make_mission(app_url)
    ids = fill_to(app_url, m["id"], 1000)
    big = filler(2000, f"upgrade-{m['id']}")
    try:
        used = plan(app_url)["used_bytes"]
        with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
            upload_ui(page, "big.cap", big)
            shows(page, role(page, "status", "Upload status"), f"big.cap is over your Archive quota ({size_fmt(used)} of {size_fmt(FREE_QUOTA)}).")
        with opened(browser, app_url + "/", DESKTOP, reduced_motion="reduce") as page:
            role(page, "radiogroup", "Plan").get_by_role("radio", name="Archive 1 GiB, 4.00 USD/month", exact=True).check()
            role(page, "button", "Change plan").click()
            shows(page, role(page, "status", "Plan status"), "Plan changed to Archive 1 GiB.", seconds=UI_WAIT * 2)
            pl = plan(app_url)
            region = role(page, "region", "Archive plan")
            for line in ("Plan Archive 1 GiB: 4.00 USD/month", f"Used {size_fmt(pl['used_bytes'])} of 1.0 GiB", f"Next invoice {pl['next_billing_date']}", f"Balance {money(pl['balance_cents'])} USD"):
                shows(page, region, line)
        acct = killbill.account_by_key("perilune-author")
        sub = [s for s in killbill.subscriptions(acct["accountId"]) if s.get("state") == "ACTIVE"][0]
        assert sub["planName"] == "archive-1" and sub["chargedThroughDate"] == pl["next_billing_date"]
        with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
            upload_ui(page, "big.cap", big)
            shows(page, role(page, "status", "Upload status"), "big.cap stored, checksum verified.")
        ids += [x["id"] for x in mission(app_url, m["id"])["passes"] if x["filename"] == "big.cap"]
        assert len(ids) and any(x["filename"] == "big.cap" for x in mission(app_url, m["id"])["passes"])
    finally:
        drain(app_url, ids)
        put_plan(app_url, "archive-free")


def test_wf_archive_plan_billing_outage(app_url, browser, killbill):
    base = outage("APP_BILLING_DOWN_URL")
    before = plan(app_url)
    acct = killbill.account_by_key("perilune-author")
    subs_before = killbill.subscriptions(acct["accountId"]) if acct else []
    with opened(browser, base + "/", DESKTOP, reduced_motion="reduce") as page:
        appears(page, page.get_by_role("alert").filter(has_text=BANNER_BILLING), "billing banner")
        region = role(page, "region", "Archive plan")
        lines_before = text_of(region)
        other = "Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly" if before["plan"] != "archive-10-annual" else "Free, 256.0 MiB"
        role(page, "radio", other).check()
        role(page, "button", "Change plan").click()
        shows(page, role(page, "status", "Plan status"), "The plan was not changed. Billing did not confirm it.")
        assert not role(page, "radio", other).is_checked() and is_focused(role(page, "button", "Change plan"))
        assert text_of(region).replace("The plan was not changed. Billing did not confirm it.", "").strip() == lines_before
    assert plan(app_url)["plan"] == before["plan"]
    if acct:
        assert killbill.subscriptions(acct["accountId"]) == subs_before


def test_subscribers(app_url, svix):
    m = make_mission(app_url)
    mid = m["id"]
    sub = lambda u: call("POST", app_url, f"/api/missions/{mid}/subscribers", json={"url": u})
    for bad in ("ftp://club.example/x", "https://user@club.example/x", "https://club.example/x#frag", "not a url", "https://club.example/" + "a" * 2030):
        expect_error(sub(bad), 422, {"error": "validation", "errors": {"url": URL_MSG}})
    a = sub("  https://club.example/hooks/perilune  ")
    assert a.status_code == 201 and a.json()["url"] == "https://club.example/hooks/perilune"
    expect_error(sub("https://club.example/hooks/perilune"), 409, {"error": "subscriber_exists", "message": "This URL is already subscribed."})
    eps = svix.endpoints(mid)
    assert [e["url"] for e in eps] == ["https://club.example/hooks/perilune"] and set(eps[0].get("filterTypes") or []) == EVENT_TYPES
    sub("https://club.example/hooks/two")
    assert sub("https://club.example/hooks/three").status_code == 201
    expect_error(sub("https://club.example/hooks/perilune"), 409, {"error": "subscriber_limit", "message": "A mission has at most 3 subscribers."})
    listed = jget(app_url, f"/api/missions/{mid}/subscribers")["subscribers"]
    assert len(listed) == 3 and listed[0]["id"] == a.json()["id"]
    down = outage("APP_WEBHOOKS_DOWN_URL")
    expect_error(call("DELETE", down, f"/api/missions/{mid}/subscribers/{a.json()['id']}"), 503, {"error": "webhooks_unavailable"})
    assert len(jget(app_url, f"/api/missions/{mid}/subscribers")["subscribers"]) == 3
    assert call("DELETE", app_url, f"/api/missions/{mid}/subscribers/{a.json()['id']}").status_code == 204
    expect_error(call("DELETE", app_url, f"/api/missions/{mid}/subscribers/{a.json()['id']}"), 404, {"error": "subscriber_not_found"})
    assert "https://club.example/hooks/perilune" not in [e["url"] for e in svix.endpoints(mid)]
    assert mission(app_url, mid)["change_version"] == 0
    assert [e["kind"] for e in audit(app_url, mid)].count("subscriber.added") == 3


def test_wf_subscriber_webhooks_add(app_url, browser, svix):
    m = make_mission(app_url)
    url = f"https://club.example/hooks/{uuid.uuid4().hex[:6]}"
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        field = role(page, "textbox", "Subscriber URL")
        appears(page, role(page, "region", "Subscribers").get_by_text("No subscribers", exact=True), "empty subscribers")
        field.fill(url)
        field.press("Enter")
        shows(page, role(page, "status", "Console status"), f"Subscriber {url} added.")
        assert field.input_value() == "" and is_focused(field)
        assert [e["url"] for e in svix.endpoints(m["id"])] == [url]
        role(page, "button", f"Remove {url}").click()
        shows(page, role(page, "status", "Console status"), f"Subscriber {url} removed.")
        ui(page, lambda: is_focused(field), "focus moves to Subscriber URL")
    assert svix.endpoints(m["id"]) == [] and jget(app_url, f"/api/missions/{m['id']}/subscribers")["subscribers"] == []


def test_wf_subscriber_webhooks_outage(app_url, browser, svix):
    m = make_mission(app_url)
    base = outage("APP_WEBHOOKS_DOWN_URL")
    with opened(browser, author_url(base, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        appears(page, page.get_by_role("alert").filter(has_text=BANNER_WEBHOOKS), "webhooks banner")
        role(page, "textbox", "Subscriber URL").fill("https://club.example/hooks/perilune")
        role(page, "button", "Add subscriber").click()
        shows(page, role(page, "status", "Console status"), "Subscribers could not be changed. Webhooks are offline.")
    assert jget(app_url, f"/api/missions/{m['id']}/subscribers")["subscribers"] == []
    try:
        assert svix.endpoints(m["id"]) == []
    except Exception:
        pass


def test_signed_webhooks(app_url, svix):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    note = "hook-note-" + uuid.uuid4().hex[:6]
    ev = pin(app_url, mid, 7200, "Hooked", note).json()
    add_landmark(app_url, mid, "No hook", 0, 0)
    rej = settled_pass(app_url, upload(app_url, mid, lines(sample_line(0), "X,1"), "rej.cap").json()["id"])
    make_share(app_url, mid)
    make_share(app_url, mid)
    call("DELETE", app_url, f"/api/passes/{rej['id']}")
    pin(outage("APP_WEBHOOKS_DOWN_URL"), mid, 3600, "During outage")
    final = mission(app_url, mid)["change_version"]
    expected_types = ["pass.parsed", "event.pinned", "pass.rejected", "share.revoked", "pass.deleted", "event.pinned"]
    msgs = wait_for(lambda: (lambda x: x if len(x) >= len(expected_types) else None)(svix_messages(svix, mid)), "every change reaches Svix", WEBHOOK_CATCHUP_S + PROVIDER_WAIT)
    deadline = time.monotonic() + OBSERVE_S
    while time.monotonic() < deadline:
        msgs = svix_messages(svix, mid)
        assert len(msgs) == len(expected_types), "each change must create exactly one message"
    assert sorted(x["eventType"] for x in msgs) == sorted(expected_types)
    assert note not in json.dumps(msgs)
    for x in msgs:
        pl = x["payload"]
        assert x["eventId"] in (f"{mid}:{pl['version']}", f"{mid}.{pl['version']}") and pl["type"] == x["eventType"] and pl["mission_id"] == mid
        assert type(pl["occurred_at"]) is int and 1 <= pl["version"] <= final
    pinned = next(x["payload"] for x in msgs if x["eventType"] == "event.pinned" and x["payload"]["data"]["event"]["id"] == ev["id"])
    assert pinned["data"] == {"event": {"id": ev["id"], "pass_id": p["id"], "met": 7200, "met_label": "+000:02:00:00", "title": "Hooked"}}
    parsed = next(x["payload"] for x in msgs if x["eventType"] == "pass.parsed")["data"]["pass"]
    assert set(parsed) == {"id", "filename", "size_bytes", "sha256", "sample_count", "transcript_line_count"} and parsed["sample_count"] == SEED_COUNT
    rj = next(x["payload"] for x in msgs if x["eventType"] == "pass.rejected")["data"]["pass"]
    assert (rj["rejected_line"], rj["rejected_reason"]) == (2, "unknown_record")
    assert next(x["payload"] for x in msgs if x["eventType"] == "pass.deleted")["data"] == {"pass_id": rej["id"]}
    assert next(x["payload"] for x in msgs if x["eventType"] == "share.revoked")["data"] == {}


def test_wf_cross_cutting_layouts(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    with opened(browser, share_url(app_url, tok), PHONE, reduced_motion="reduce") as page:
        appears(page, slider(page), "disc")
        boxes = lambda: {k: loc.bounding_box() for k, loc in (("disc", slider(page)), ("plate", role(page, "group", "Readout")), ("goto", role(page, "textbox", "Go to GMT")),
                         ("play", role(page, "button", "Play")), ("transcript", role(page, "region", "Transcript")), ("events", role(page, "region", "Events")),
                         ("landmarks", role(page, "region", "Landmarks")), ("captures", role(page, "list", "Captures")))}
        layout(page)
        b = boxes()
        order = ["disc", "plate", "goto", "play", "transcript", "events", "landmarks", "captures"]
        assert [b[k]["y"] for k in order] == sorted(b[k]["y"] for k in order), "one-column reading order"
        assert abs(b["disc"]["width"] - b["disc"]["height"]) <= GEOM_TOL and b["plate"]["y"] >= b["disc"]["y"] + b["disc"]["height"] - GEOM_TOL
        assert b["disc"]["width"] >= b["events"]["width"] - GEOM_TOL
        page.set_viewport_size(TABLET)
        advance(page, STEP_MS)
        layout(page)
        b = boxes()
        assert b["plate"]["x"] >= b["disc"]["x"] + b["disc"]["width"] - GEOM_TOL and abs(b["plate"]["y"] - b["disc"]["y"]) <= GEOM_TOL
        assert b["disc"]["x"] + b["disc"]["width"] <= TABLET["width"] * 2 / 3 + GEOM_TOL and b["transcript"]["y"] >= b["disc"]["y"] + b["disc"]["height"] - GEOM_TOL
        page.set_viewport_size(DESKTOP)
        page.evaluate("window.scrollTo(0, 0)")
        advance(page, STEP_MS)
        layout(page)
        b, rail = boxes(), role(page, "complementary", "Channels").bounding_box()
        assert rail["x"] + rail["width"] <= b["disc"]["x"] + GEOM_TOL and b["transcript"]["x"] >= b["disc"]["x"] + b["disc"]["width"] - GEOM_TOL
        assert max(rail["y"], b["disc"]["y"], b["transcript"]["y"]) < DESKTOP["height"]
        assert role(page, "button", "Channels").count() == 0 or not role(page, "button", "Channels").is_visible()
    with opened(browser, author_url(app_url, m["id"]), PHONE, reduced_motion="reduce") as page:
        for vp in (PHONE, TABLET, DESKTOP, {"width": 1920, "height": 1080}):
            page.set_viewport_size(vp)
            advance(page, STEP_MS)
            layout(page)
    assert jget(app_url, f"/api/share/{tok}")["mission"]["sample_count"] == SEED_COUNT


OUTAGE_STATUS = {"APP_STORAGE_DOWN_URL": "storage", "APP_SEARCH_DOWN_URL": "search", "APP_QUEUE_DOWN_URL": "queue",
                 "APP_CACHE_DOWN_URL": "cache", "APP_BILLING_DOWN_URL": "billing", "APP_WEBHOOKS_DOWN_URL": "webhooks",
                 "APP_EPHEMERIS_DOWN_URL": None, "APP_RENDERER_DOWN_URL": None, "APP_PUSH_DOWN_URL": None}


def test_wf_cross_cutting_boot(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    for env, service in OUTAGE_STATUS.items():
        base = outage(env)
        assert jget(base, "/api/health") == {"status": "ok"}
        if service:
            assert jget(base, "/api/status")[service] == "down", f"{env} must report {service} down"
        for path in ("/", f"/missions/{m['id']}", f"/s/{tok}"):
            r = call("GET", base, path)
            assert r.status_code == 200 and r.headers["content-type"].startswith("text/html"), f"{env} {path}"
        with sse(f"{base}/api/missions/{m['id']}/stream") as (resp, events):
            assert resp.status_code == 200 and isinstance(next_event(events, HTTP_TIMEOUT), dict)
    with opened(browser, outage("APP_STORAGE_DOWN_URL") + "/", DESKTOP, reduced_motion="reduce") as page:
        appears(page, page.get_by_role("heading", name="Missions", level=1, exact=True), "Missions page on an outage instance")


def test_server_boundary(app_url):
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/src/server.ts", "/tsconfig.json", "/captures/x.cap"):
        assert call("GET", app_url, path).status_code == 404, path
    expect_error(call("GET", app_url, "/api/nope"), 404, {"error": "not_found"})
    r = call("GET", app_url, "/nowhere")
    assert r.status_code == 404 and PAGE_404_HEADING in r.text
    r = call("GET", app_url, f"/missions/{uuid.uuid4()}")
    assert r.status_code == 404 and MISSION_404_HEADING in r.text
    r = call("PUT", app_url, "/api/missions")
    assert r.status_code == 405 and r.json() == {"error": "method_not_allowed"} and r.headers.get("allow")
    body = json.dumps({"name": unique("Edge")[0], "epoch_utc": SEED_EPOCH})
    exact = body + " " * (JSON_LIMIT - len(body.encode()))
    assert call("POST", app_url, "/api/missions", content=exact, headers={"Content-Type": "application/json"}).status_code == 201
    expect_error(call("POST", app_url, "/api/missions", content=exact + " ", headers={"Content-Type": "application/json"}), 413, {"error": "body_too_large", "limit_bytes": JSON_LIMIT})
    expect_error(call("POST", app_url, "/api/missions", content=exact + " ", headers={"Content-Type": "text/plain"}), 413, {"error": "body_too_large", "limit_bytes": JSON_LIMIT})
    expect_error(call("POST", app_url, "/api/missions", content="{", headers={"Content-Type": "text/plain"}), 415, {"error": "unsupported_media_type"})
    expect_error(call("POST", app_url, "/api/missions", content="{", headers={"Content-Type": "application/json"}), 400, {"error": "invalid_json"})
    expect_error(call("POST", app_url, f"/api/missions/{uuid.uuid4()}/events", content="{", headers={"Content-Type": "application/json"}), 404, {"error": "not_found"})
    r = call("GET", app_url, "/api/missions", headers={"Origin": "https://club.example"})
    assert not any(k.lower().startswith("access-control-") for k in r.headers)
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "MEILISEARCH_API_KEY", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "SVIX_API_KEY", "NTFY_PASSWORD")]
    secrets = [s for s in secrets if len(s) >= 6]
    m, p, _ = parsed_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    pages = [call("GET", app_url, x).text for x in ("/", f"/missions/{m['id']}", f"/s/{tok}", "/api/status", "/api/missions", "/api/plan")]
    assets = {a for html in pages[:3] for a in re.findall(r'(?:src|href)="(/[^"]+)"', html)}
    pages += [call("GET", app_url, a).text for a in assets]
    for s in secrets:
        assert all(s not in text for text in pages), "a credential reached the browser"


def test_accessible_controls(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    tok = make_share(app_url, m["id"])["token"]
    for url in (app_url + "/", author_url(app_url, m["id"]), share_url(app_url, tok)):
        with opened(browser, url, DESKTOP, reduced_motion="reduce") as page:
            ui(page, lambda: page.get_by_role("heading", level=1).count() > 0, "page heading")
            axe(page)
            for r in ("button", "link", "radio", "checkbox"):
                for el in page.get_by_role(r).all():
                    if el.is_visible():
                        b = el.bounding_box()
                        assert b["width"] >= 44 - 0.5 and b["height"] >= 44 - 0.5, f"{r} {el.text_content()!r} is {b['width']}x{b['height']}"
            if "/missions/" in url:
                for name in ("Play", "Go", "Pin event", "Revoke share link"):
                    rest, focus = state_styles(role(page, "button", name), "outline-style", "outline-width", state="focus")
                    assert focus["outline-style"] != "none" and float(focus["outline-width"].removesuffix("px")) > 0, f"{name} focus outline"
                for r, name in (("slider", "Track loupe"), ("group", "Readout"), ("searchbox", "Search transcript"), ("table", "Events"), ("region", "Passes"),
                                ("status", "Upload status"), ("status", "Console status"), ("status", "Download status"), ("list", "Speakers")):
                    assert role(page, r, name).count() == 1, f"{r} {name!r} missing"


def test_strict_json(app_url):
    m, p, _ = parsed_mission(app_url)
    mid = m["id"]
    for raw in ('{"name":"a","name":"b","epoch_utc":"2026-03-14T00:00:00Z"}', '{"name":"\\ud800","epoch_utc":"2026-03-14T00:00:00Z"}',
                '{"\\udc00x":1,"name":"a","epoch_utc":"2026-03-14T00:00:00Z"}'):
        expect_error(call("POST", app_url, "/api/missions", content=raw, headers={"Content-Type": "application/json"}), 400, {"error": "invalid_json"})
    for n in (MAX_SAFE + 1, -(MAX_SAFE + 1)):
        raw = '{"met":%d,"title":"x"}' % n
        expect_error(call("POST", app_url, f"/api/missions/{mid}/events", content=raw, headers={"Content-Type": "application/json", "Idempotency-Key": idempotency_key()}), 400, {"error": "invalid_json"})
    r = call("POST", app_url, f"/api/missions/{mid}/events", content='{"met":%d,"title":"x"}' % MAX_SAFE, headers={"Content-Type": "application/json", "Idempotency-Key": idempotency_key()})
    assert r.status_code == 201 and r.json()["met"] == 7190 + FIRST_MET
    checks = [(mission(app_url, mid), ("sample_count", "total_bytes", "change_version")), (jget(app_url, "/api/plan"), ("price_cents", "quota_bytes", "used_bytes")),
              (audit(app_url, mid)[0], ("seq",)), (jget(app_url, f"/api/missions/{mid}/frames?from=3600&to=3601&fps=1")["frames"][0], ("k", "met_ms")),
              (track(app_url, mid)[0], ("index", "met")), (p, ("size_bytes", "sample_count", "transcript_line_count"))]
    for obj, keys in checks:
        for k in keys:
            assert type(obj[k]) is int, f"{k} must be a JSON integer, got {obj[k]!r}"


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Unicode-3.0", "OFL-1.1"}
FONTS = ("Archivo", "IBM Plex Sans", "IBM Plex Mono")


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing[:20]}"
    assert all(f in notices for f in FONTS)


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence or "", ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert "OFL" in notices


def test_if_state_only_in_provided_services():
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "level", "redis-server", "mongodb", "mysql", "mysql2", "lmdb", "pouchdb"}
    assert not [p.name for p in shipped_packages() if p.name in forbidden]
    stray = [str(f) for root in (Path("/app"), Path(DEPLOYED_APP)) for f in root.rglob("*") if "node_modules" not in f.parts and f.suffix in (".cap", ".pdf", ".sqlite", ".db")]
    assert not stray, f"local state files: {stray[:10]}"


def test_if_service_definitions_unchanged(app_url):
    status = jget(app_url, "/api/status")
    assert status == {"storage": "up", "search": "up", "queue": "up", "cache": "up", "billing": "up", "webhooks": "up"}


def test_if_typescript_source():
    skip = {"node_modules", "dist", "build", "out", ".git", ".next", "coverage"}
    files = [f for f in Path("/app").rglob("*") if f.is_file() and not skip & set(f.parts)]
    assert any(f.suffix in (".ts", ".tsx") for f in files)
    tooling = {"scripts", "tools"}
    js = [f.name for f in files if f.suffix in (".js", ".mjs", ".cjs", ".jsx") and not tooling & set(f.parts) and not re.search(r"(config|rc)\.(c|m)?js$|^\.", f.name)]
    assert not js, f"plain JavaScript outside tool configuration: {js[:10]}"


def test_if_bundled_assets(app_url, browser):
    m, p, _ = parsed_mission(app_url)
    with opened(browser, author_url(app_url, m["id"]), DESKTOP, reduced_motion="reduce") as page:
        urls = []
        page.on("request", lambda rq: urls.append(rq.url))
        page.reload()
        appears(page, slider(page), "console")
        assert all(same_origin(u, app_url) or u.startswith(("data:", "blob:")) for u in urls), [u for u in urls if not same_origin(u, app_url)][:5]
        faces = page.evaluate("async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/['\"]/g, '')); }")
        assert all(any(f in face for face in faces) for f in FONTS), f"loaded faces: {faces}"


RUNG_CASES = [
    "unknown_mission_over_malformed", "unknown_mission_over_wrong_type", "revoked_link_over_read_only",
    "deleted_pass_over_method", "method_over_too_large", "too_large_over_wrong_type",
    "wrong_type_over_malformed", "malformed_over_validation", "conflict_over_validation",
    "patch_unknown_over_wrong_type", "patch_wrong_type_over_malformed", "patch_malformed_over_null_name",
]


def _two_rungs(b: str, case: str) -> str:
    ghost = str(uuid.uuid4())
    big = b'{"name":"' + b"x" * (JSON_LIMIT + 4000) + b'","epoch_utc":"' + SEED_EPOCH.encode() + b'"}'
    js = {"Content-Type": "application/json"}
    if case == "unknown_mission_over_malformed":
        r = call("POST", b, f"/api/missions/{ghost}/landmarks", content=b"{", headers=js)
        want = (404, {"error": "not_found"})
    elif case == "unknown_mission_over_wrong_type":
        r = call("POST", b, f"/api/missions/{ghost}/events", content=b"met=1", headers={"Content-Type": "text/plain", "Idempotency-Key": idempotency_key()})
        want = (404, {"error": "not_found"})
    elif case == "revoked_link_over_read_only":
        m, _, _ = parsed_mission(b)
        token = make_share(b, m["id"])["token"]
        assert call("DELETE", b, f"/api/missions/{m['id']}/share").status_code == 204
        r = call("POST", b, f"/api/share/{token}", content=b"{}", headers=js)
        want = (410, {"error": "link_revoked"})
    elif case == "deleted_pass_over_method":
        _, p, _ = parsed_mission(b)
        assert call("DELETE", b, f"/api/passes/{p['id']}").status_code == 204
        r = call("PUT", b, f"/api/passes/{p['id']}/capture", content=b"x", headers={"Content-Type": "application/octet-stream"})
        want = (410, {"error": "pass_deleted"})
    elif case == "method_over_too_large":
        r = call("PUT", b, "/api/missions", content=big, headers=js)
        if not r.headers.get("allow"):
            return f"{case}: 405 without Allow"
        want = (405, {"error": "method_not_allowed"})
    elif case == "too_large_over_wrong_type":
        r = call("POST", b, "/api/missions", content=big, headers={"Content-Type": "text/plain"})
        want = (413, {"error": "body_too_large", "limit_bytes": JSON_LIMIT})
    elif case == "wrong_type_over_malformed":
        r = call("POST", b, "/api/missions", content=b"{", headers={"Content-Type": "text/plain"})
        want = (415, {"error": "unsupported_media_type"})
    elif case == "malformed_over_validation":
        r = call("POST", b, "/api/missions", content=b'{"name":"a","name":"b","epoch_utc":"not an instant"}', headers=js)
        want = (400, {"error": "invalid_json"})
    elif case == "conflict_over_validation":
        m = make_mission(b)
        for i in range(5):
            assert add_landmark(b, m["id"], f"Mark {i}", 0.0, float(i)).status_code == 201
        r = add_landmark(b, m["id"], "Mark 5", 91.0, 0.0)
        want = (409, {"error": "landmark_limit", "message": "A mission holds at most 5 landmarks."})
    elif case == "patch_unknown_over_wrong_type":
        r = patch(b, ghost, {"name": None}, ctype="application/json")
        want = (404, {"error": "not_found"})
    elif case == "patch_wrong_type_over_malformed":
        r = patch(b, make_mission(b)["id"], b"{", ctype="application/json")
        want = (415, {"error": "unsupported_media_type"})
    else:
        r = patch(b, make_mission(b)["id"], b'{"name":null,"name":null}')
        want = (400, {"error": "invalid_json"})
    got = (r.status_code, r.json() if r.content else None)
    return "" if got == want else f"{case}: got {r.status_code} {r.text[:200]}, want {want}"


def test_error_precedence_two_rungs(app_url):
    wrong = [w for w in (_two_rungs(app_url.rstrip("/"), case) for case in RUNG_CASES) if w]
    assert not wrong, wrong
