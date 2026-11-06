from __future__ import annotations

import calendar
import concurrent.futures
import contextlib
import csv
import email.utils
import hashlib
import hmac
import io
import json
import os
import re
import socket
import struct
import subprocess
import threading
import time
import uuid
import zlib
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    addresses,
    advance,
    animations,
    idempotency_key,
    layout,
    motion,
    open_app,
    same_origin,
    select,
    settle,
    style,
    tab_order,
)
from conftest import held
from conftest import text as message_text


APP_ROOT = Path("/app")
MICRO = 1_000_000
UPLOAD_LIMIT = 10_000_000
JSON_LIMIT = 65_536
HALFTONE_EXAMPLE_MICRO = 20_971_518
HALFTONE_RATE_ID = "r_2"
TOPUP_MIN = 100
HARD_CAP_MAX = 10_000_000
TAP_MIN = 44
ENDPOINT_LIMIT = 5
WEBHOOK_RETRIES = 5
DISABLE_AT = 6
SLOT_FILL_S = 2
LIVE_UPDATE_S = 2
NOTICE_S = 10
STATUS_CHECK_S = 10
RESUME_S = 30
TOPUP_RETRY_S = 15
SWEEP_S = 15
SEQUENCE_MAX_MS = 1000
RIBBON_MIN_MS = 380
RIBBON_MAX_MS = 460
FAST_RETRY_BASE_S = 1
ORDER_FAILS = 4
KB_HOLD_S = 12
FAST_RETENTION_DAY_S = 2
EXPIRY_MARGIN_S = 0.5
OUTAGE_PORT = 1999

HTTP_TIMEOUT = 30
GRACE_S = 15
JOB_DONE_S = 120
UI_WAIT_S = 10
UI_TIMEOUT_MS = 5000
STEP_MS = 250
FINE_STEP_MS = 50
POLL_S = 0.2
OBSERVE_S = 4
MOTION_SAMPLES = 40
SAMPLE_MS = SEQUENCE_MAX_MS / MOTION_SAMPLES
DETECT_MS = 2 * SAMPLE_MS
RETRY_TOLERANCE_S = 1.5
RATE_LEAD_S = 10
GUARDS = 3
CANCELS = 6
EPS_SHARE = 0.05
TAIL_SHARE = 0.001
MIN_DELTA_PX = 0.05
OUTAGE_ENVS = ("APP_FAST_URL", "APP_STORAGE_DOWN_URL", "APP_KILLBILL_DOWN_URL")
FINAL = {"succeeded", "failed", "cancelled"}
MINUTE_LEAD_S = 30
MINUTE_S = 60
RATE_WAIT_S = 150
ROOMY_FLOOR_CREDITS = 2000
ROOMY_TOPUP_CREDITS = 20_000
HARD_HEADROOM = 50
LOWER_SOFT_CAP = 250
RACERS = 4

STOREFRONT = "t_storefront"
CAMPAIGNS = "t_campaigns"
TEAM_NAMES = {STOREFRONT: "Storefront", CAMPAIGNS: "Campaigns"}
SEED_CONCURRENCY = {STOREFRONT: 2, CAMPAIGNS: 1}
OPENING_GRANT = {
    STOREFRONT: 5_000 * MICRO,
    CAMPAIGNS: 600 * MICRO,
}
PASSCODE = "lumen-pass-2026"
KEYS = {
    "mara": "dpk_mara_4c19e7",
    "theo": "dpk_theo_82ad30",
    "ines": "dpk_ines_5be611",
    "rafael": "dpk_rafael_0f7c42",
    "june": "dpk_june_d39a58",
    "sol": "dpk_sol_61e2bf",
}
EMAILS = {
    "mara": "mara@halden.example",
    "theo": "theo@halden.example",
    "ines": "ines@halden.example",
    "rafael": "rafael@halden.example",
    "june": "june@halden.example",
    "sol": "sol@halden.example",
}
MEMBERS = {
    "mara": ("m_mara", "Mara Okonkwo", "member", STOREFRONT),
    "theo": ("m_theo", "Theo Lindqvist", "member", STOREFRONT),
    "ines": ("m_ines", "Ines Calloway", "member", CAMPAIGNS),
    "rafael": ("m_rafael", "Rafael Duarte", "admin", None),
    "june": ("m_june", "June Whitford", "finance", None),
    "sol": ("m_sol", "Sol Abernathy", "compliance", None),
}
MAIL_SENDER = "dispatch@lumenfold.example"
ORG_TZ = "America/New_York"
OTHER_TZ = "Europe/London"
FAR_FUTURE_LOCAL = "2030-11-03T01:30:00"
PAST_LOCAL = "2026-01-01T00:00:00"
GAP_LOCAL = "2030-03-10T02:30:00"
CROSS_ORIGIN = "http://elsewhere.example"
MURMUR_TEXT = "x" * 100

ACTIVE = {"leased", "running"}
IN_FLIGHT = ("queued", "leased", "running")
UNIT_LABELS = {"image": "images", "megapixel": "megapixels", "video_second": "video-seconds", "audio_second": "audio-seconds"}
METER_SEGMENTS = [("Settled", "settled_micro"), ("Reserved", "reserved_micro"), ("Available", "available_micro")]
MOVEMENT_FLOW = {
    "opening_grant": ("funding", "available"),
    "top_up": ("funding", "available"),
    "reserve": ("available", "reserved"),
    "settle": ("reserved", "settled"),
    "release": ("reserved", "available"),
}
FULL_JOB_KEYS = {
    "id", "team_id", "model", "status", "priority", "submitted_by", "submitted_at", "started_at", "finished_at",
    "attempts", "failure_reason", "waiting_reason", "queue_position", "rate", "unit", "estimated_units",
    "billed_units", "reserved_micro", "charged_micro", "released_micro", "outputs", "payload_visible", "input",
    "input_assets",
}
RESTRICTED_JOB_KEYS = FULL_JOB_KEYS - {"input", "input_assets"}
JOBS_CSV_COLUMNS = ["job_id", "team", "model", "status", "submitted_by", "submitted_at", "finished_at", "unit",
                    "billed_units", "rate_micro_per_unit", "charged_micro", "prompt"]
LEDGER_CSV_COLUMNS = ["movement_id", "kind", "created_at", "job_id", "topup_id", "kb_invoice_id", "account", "amount_micro"]
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
FONTS = ["Bricolage Grotesque", "IBM Plex Sans"]

REFUSED_COPY = "This address is not allowed. Use a public address."
FUTURE_COPY = "Choose a moment in the future."
NOT_EXIST_COPY = f"That time does not exist in {ORG_TZ} because clocks move forward."
RATE_FORMAT_COPY = "Enter a rate from 0.000001 to 1000000 with at most six decimals."
TIME_FORMAT_COPY = "Use the format YYYY-MM-DD HH:MM."
STORAGE_NOTICE = "Storage is unreachable. New jobs wait in the queue, and uploads and image links are paused."
BILLING_NOTICE = "Billing is unreachable. Top-ups stay pending until it returns."
WAITING_COPY = "Waiting for storage"
HIDDEN_COPY = "Hidden — restricted payload"
BLOCKED_COPY = "Blocked for playground"
NO_MATCH_COPY = "No media matches."
SIGN_IN_ERROR = "That email and passcode do not match."
DECLINED_COPY = "Billing declined the top-up; no credits were added."
GONE_COPY = "That asset is already gone."
OUTLINE_PROPS = ("outline-width", "outline-style", "outline-color", "box-shadow", "border-width", "border-color")
KEY_MAX = 255
JOURNEY_TOPUP = 1_000
SINK_FAIL = 500
REDIRECT_STATUS = 302
EARLY_TOLERANCE_S = 0.25
JOB_ID_RE = r"j_\d+"
SECRET_RE = r"whsec_[0-9a-f]{32}"
IMG_PATH = "/img.png"
HOP_PATH = "/hop.png"
TARGET_PATH = "/target.png"
REDIRECT_TO_LOOPBACK = "http://127.0.0.1:{port}" + TARGET_PATH
LOCATION = "Location"
NOT_JSON = "text/plain"
OUTAGE_FILE = "frame.png"
LOCAL_FORMAT = "%Y-%m-%dT%H:%M:%S"
SHOWN_FORMAT = "%Y-%m-%d %H:%M"
KB_ACCOUNT_ID = "accountId"
KB_PAYMENT_ID = "paymentId"
MAIL_SUBJECT = "Subject"
MAIL_TO = "To"
MAIL_FROM_FIELD = "From"
ENCODING = "utf-8"
CLIPBOARD = ["clipboard-read", "clipboard-write"]
READ_CLIPBOARD = "() => navigator.clipboard.readText()"
IS_FOCUSED = "el => el === document.activeElement"
HOLDS_FOCUS = "d => d.contains(document.activeElement)"
ARIA_DISABLED = "aria-disabled"
JOBS_GLOB = "**/api/jobs"
KEY_HEADER = "Idempotency-Key"
SET_COOKIE = "set-cookie"
CORS_HEADER = "access-control-allow-origin"
CORS_METHODS = ("GET", "OPTIONS")
PREFLIGHT_HEADER = "Access-Control-Request-Method"
LOCAL_SCHEMES = ("data:", "blob:")
LOCKFILE = "package-lock.json"
SKIP_DIRS = ("node_modules", ".git")
DB_SUFFIXES = {".sqlite", ".sqlite3", ".db", ".rdb", ".leveldb"}
DATASTORE_PROCS = {"redis-server", "mongod", "memcached", "etcd"}
PROC = Path("/proc")
PROC_NAME_FILE = "comm"
REFUSED_HOOKS = [
    "http://127.0.0.1:{port}/h",
    "http://[::1]:{port}/h",
    "http://2130706433:{port}/h",
    "http://169.254.169.254/h",
    "http://10.0.0.1/h",
]

SINK_HOST = (os.environ.get("OUTBOUND_ALLOWED_HOSTS", "").split(",")[0].strip() or socket.gethostname())

_TICK = threading.Event()

METER_VALUES = (
    "el => ({now: el.getAttribute('aria-valuenow') ?? el.getAttribute('value'),"
    " max: el.getAttribute('aria-valuemax') ?? el.getAttribute('max')})"
)
GRAB_ANIMATIONS = """() => {
  window.__grabbed = [];
  window.__grabbing = true;
  const hold = a => {
    if (!window.__grabbing) return;
    try { a.pause(); a.currentTime = 0; window.__grabbed.push(a); } catch (e) {}
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); hold(a); return a; };
  document.addEventListener('transitionrun', ev => {
    for (const a of ev.target.getAnimations()) { if (!window.__grabbed.includes(a)) hold(a); }
  }, true);
}"""
LOOPING = """() => document.getAnimations().filter(a => {
  const t = a.effect && a.effect.getComputedTiming();
  return t && t.iterations === Infinity && a.playState === 'running';
}).length"""
REGRAB = "() => { window.__grabbing = true; }"
RELEASE_HELD = """() => {
  window.__grabbing = false;
  (window.__grabbed || []).filter(a => a.playState === 'paused'
    && Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a => a.finish());
  window.__grabbed = [];
}"""
SEEK_HELD = """(el, [scope, n]) => {
  const held = (window.__grabbed || []).filter(a => a.playState === 'paused' && a.effect && a.effect.target
    && scope.contains(a.effect.target) && Number.isFinite(a.effect.getComputedTiming().endTime));
  if (!held.length) return null;
  const total = Math.max(...held.map(a => a.effect.getComputedTiming().endTime));
  const path = [];
  for (let i = 0; i < n; i++) {
    held.forEach(a => { a.currentTime = total * i / n; });
    path.push({t: total * i / n, width: el.getBoundingClientRect().width});
  }
  held.forEach(a => a.finish());
  return {total, path, durations: held.map(a => a.effect.getComputedTiming().activeDuration)};
}"""


def base_of(url: str) -> str:
    return url.rstrip("/")


def instance(env: str) -> str:
    return os.environ[env].rstrip("/")


def env_url(name: str) -> str:
    return os.environ[name]


def word() -> str:
    return f"w{uuid.uuid4().hex[:12]}"


def murmur_text() -> str:
    token = word()
    return token + "x" * (len(MURMUR_TEXT) - len(token))


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while True:
        try:
            last = fn()
        except (httpx.HTTPError, AssertionError, KeyError, StopIteration):
            last = None
        if last:
            return last
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}")
        _TICK.wait(POLL_S)


def eventually(page: Page, predicate: Callable[[], Any], seconds: float = UI_WAIT_S, what: str = "condition",
               step_ms: float = STEP_MS) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            if predicate():
                return
        except (PlaywrightError, httpx.HTTPError, KeyError, ValueError, TypeError):
            pass
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}")
        advance(page, step_ms)
        _TICK.wait(POLL_S)


def squash(value: str) -> str:
    return " ".join(value.split())


def see(page: Page, locator: Any, seconds: float = UI_WAIT_S, step_ms: float = STEP_MS) -> None:
    eventually(page, lambda: locator.count() > 0 and locator.first.is_visible(), seconds, f"{locator} visible", step_ms)


def gone(page: Page, locator: Any, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: locator.count() == 0 or not locator.first.is_visible(), seconds, f"{locator} gone")


def see_text(page: Page, locator: Any, wanted: str, seconds: float = UI_WAIT_S) -> None:
    eventually(page, lambda: squash(wanted) in squash(locator.first.inner_text(timeout=UI_TIMEOUT_MS)),
               seconds, f"text {wanted!r}")


def parallel(n: int, fn: Callable[[int], Any]) -> list[Any]:
    gate = threading.Barrier(n)

    def run(i: int) -> Any:
        gate.wait()
        return fn(i)

    with concurrent.futures.ThreadPoolExecutor(n) as pool:
        return list(pool.map(run, range(n)))


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def long_date(value: str, tz: str) -> str:
    d = iso(value).astimezone(ZoneInfo(tz))
    return f"{d.day} {calendar.month_name[d.month]} {d.year}"


def charge(units: str, rate_micro: int) -> int:
    return int((Decimal(units) * rate_micro).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def credits_text(micro: int) -> str:
    amount = (Decimal(micro) / MICRO).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return format(amount, ",.2f")


def rate_text(micro: int) -> str:
    return format(Decimal(micro) / MICRO, ".6f")


def units_text(units: str, unit: str) -> str:
    value = Decimal(units)
    if unit == "image":
        return str(int(value))
    if unit == "megapixel":
        return format(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), "f")
    return format(value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP), "f")


def mail_text(message: dict[str, Any]) -> str:
    return message_text(message)


def with_subject(mail: Any, subject: str, expected: int = 0, quick: bool = False) -> list[dict[str, Any]]:
    got = mail.messages(settle=0) if quick else mail.messages(expected=expected)
    return [m for m in got if m[MAIL_SUBJECT] == subject]


def field_path(name: str) -> str:
    return "input." + name


def run_form(model: str) -> str:
    return f"Run {model}"


def lane_name(model: str) -> str:
    return f"{model} lane"


def upload_button(title: str) -> str:
    return f"Upload image for {title}"


def clear_button(title: str) -> str:
    return f"Clear {title}"


def context_box(model: str, context: str) -> str:
    return f"{model} {context}"


def notch_units(units: str, unit: str) -> str:
    return f"{units_text(units, unit)} {UNIT_LABELS[unit]}"


def megapixels(width: int, height: int, n: int = 1) -> str:
    return format((Decimal(width * height * n) / MICRO).normalize(), "f")


def upload_key(team: str, asset_id: str, ext: str = "png") -> str:
    return f"uploads/{team}/{asset_id}.{ext}"


def output_key(team: str, job_id: str, n: int = 1, ext: str = "png") -> str:
    return f"outputs/{team}/{job_id}/{n}.{ext}"


def rates_path(slug: str, rate_id: str | None = None) -> str:
    path = f"/api/models/{slug}/rates"
    return path if rate_id is None else f"{path}/{rate_id}"


def usd(credits: int) -> str:
    return format(Decimal(credits) / 100, ".2f")


def whole_credits(credits: int) -> str:
    return format(credits, ",")


def kb_payment_ids(killbill: Any, account: dict[str, Any] | None) -> list[str]:
    return [p[KB_PAYMENT_ID] for p in killbill.payments(account[KB_ACCOUNT_ID])] if account else []


def has_focus(locator: Any) -> bool:
    return bool(locator.evaluate(IS_FOCUSED))


def png_file(name: str) -> dict[str, Any]:
    return {"name": name, "mimeType": "image/png", "buffer": png()}


def call(base: str, who: str | None, method: str, path: str, body: Any = None, params: dict[str, Any] | None = None,
         headers: dict[str, str] | None = None, content: Any = None) -> httpx.Response:
    sent = dict(headers or {})
    if who:
        sent["Authorization"] = f"Bearer {KEYS[who]}"
    kwargs: dict[str, Any] = {"headers": sent, "params": params, "timeout": HTTP_TIMEOUT}
    if content is not None:
        kwargs["content"] = content
    elif body is not None:
        kwargs["json"] = body
    return httpx.request(method, base + path, **kwargs)


def expect_status(response: httpx.Response, status: int) -> httpx.Response:
    assert response.status_code == status, f"{response.request.method} {response.request.url}: {response.status_code} {response.text[:500]}"
    return response


def data(response: httpx.Response, status: int) -> Any:
    return expect_status(response, status).json()


def error_of(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    err = data(response, status)["error"]
    assert err["code"] == code, err
    assert isinstance(err["message"], str) and err["message"]
    return err


@contextlib.contextmanager
def session_client(base: str, who: str) -> Iterator[httpx.Client]:
    with httpx.Client(base_url=base, timeout=HTTP_TIMEOUT) as client:
        expect_status(client.post("/api/session", json={"email": EMAILS[who], "passcode": PASSCODE}), 200)
        yield client


def server_now(base: str) -> datetime:
    r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
    return email.utils.parsedate_to_datetime(r.headers["date"]).astimezone(timezone.utc)


def system(base: str) -> dict[str, Any]:
    return data(call(base, "mara", "GET", "/api/system"), 200)


def quill(prompt: str, n: int = 1) -> dict[str, Any]:
    return {"prompt": prompt, "style": "photo", "num_images": n}


def halftone(prompt: str, width: int = 1024, height: int = 1024, n: int = 1, init: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"prompt": prompt, "width": width, "height": height, "num_images": n}
    if init is not None:
        body["init_image"] = init
    return body


def reel(prompt: str, duration: int = 5, start: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"prompt": prompt, "duration_seconds": duration}
    if start is not None:
        body["start_image"] = start
    return body


def murmur(script: str, max_seconds: int = 30) -> dict[str, Any]:
    return {"text": script, "voice": "ash", "max_seconds": max_seconds}


def submit(base: str, who: str, model: str, inp: dict[str, Any], key: str | None = None,
           priority: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"model": model, "input": inp}
    if priority is not None:
        body["priority"] = priority
    return call(base, who, "POST", "/api/jobs", body=body, headers={"Idempotency-Key": key or idempotency_key()})


def submitted(base: str, who: str, model: str, inp: dict[str, Any], key: str | None = None,
              priority: str | None = None) -> dict[str, Any]:
    return data(submit(base, who, model, inp, key=key, priority=priority), 201)["job"]


def job(base: str, who: str, job_id: str) -> dict[str, Any]:
    return data(call(base, who, "GET", f"/api/jobs/{job_id}"), 200)["job"]


def wait_job(base: str, job_id: str, states: set[str], seconds: float = JOB_DONE_S) -> dict[str, Any]:
    return poll(lambda: (j if (j := job(base, "rafael", job_id))["status"] in states else None), seconds,
                f"{job_id} to reach {sorted(states)}")


def cancel(base: str, who: str, job_id: str) -> httpx.Response:
    return call(base, who, "POST", f"/api/jobs/{job_id}/cancel")


def team_jobs(base: str, team: str, who: str = "rafael", status: str | None = None) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"team": team, "limit": 200}
    if status:
        params["status"] = status
    return data(call(base, who, "GET", "/api/jobs", params=params), 200)["jobs"]


def newest_job_id(base: str, team: str) -> str | None:
    jobs = data(call(base, "rafael", "GET", "/api/jobs", params={"team": team, "limit": 1}), 200)["jobs"]
    return jobs[0]["id"] if jobs else None


def ledger(base: str, team: str) -> dict[str, Any]:
    return data(call(base, "june", "GET", f"/api/teams/{team}/ledger"), 200)


def movements(base: str, team: str, job_id: str | None = None, kind: str | None = None,
              topup_id: str | None = None) -> list[dict[str, Any]]:
    out = ledger(base, team)["movements"]
    if job_id is not None:
        out = [m for m in out if m["job_id"] == job_id]
    if kind is not None:
        out = [m for m in out if m["kind"] == kind]
    if topup_id is not None:
        out = [m for m in out if m["topup_id"] == topup_id]
    return out


def entries(movement: dict[str, Any]) -> dict[str, int]:
    return {e["account"]: e["amount_micro"] for e in movement["entries"]}


def reserve_count(base: str, team: str) -> int:
    return len(movements(base, team, kind="reserve"))


def meter(base: str, team: str, who: str = "rafael") -> dict[str, Any]:
    return data(call(base, who, "GET", f"/api/teams/{team}/meter"), 200)


def current_rate(base: str, slug: str) -> dict[str, Any]:
    return data(call(base, "mara", "GET", f"/api/models/{slug}"), 200)["model"]["current_rate"]


def policy(base: str) -> dict[str, Any]:
    return data(call(base, "rafael", "GET", "/api/policy"), 200)["policy"]


def team_policy(p: dict[str, Any], team: str) -> dict[str, Any]:
    return next(t for t in p["teams"] if t["id"] == team)


def save_policy(base: str, mutate: Callable[[dict[str, Any]], Any]) -> dict[str, Any]:
    def attempt() -> dict[str, Any] | None:
        p = policy(base)
        mutate(p)
        r = call(base, "rafael", "PUT", "/api/policy", body=p)
        if r.status_code == 412:
            return None
        return data(r, 200)["policy"]
    return poll(attempt, GRACE_S, "policy save")


def set_team(base: str, team: str, **fields: Any) -> dict[str, Any]:
    return save_policy(base, lambda p: team_policy(p, team).update(fields))


def roomy(base: str, team: str, concurrency: int | None = None) -> None:
    def mutate(p: dict[str, Any]) -> None:
        t = team_policy(p, team)
        t.update(concurrency=concurrency or SEED_CONCURRENCY[team], payload_visibility="team",
                 soft_cap_credits=HARD_CAP_MAX, hard_cap_credits=HARD_CAP_MAX,
                 context_defaults={"api": "allowed", "playground": "allowed"})
        t["model_access"] = {slug: {"api": "inherit", "playground": "inherit"} for slug in t["model_access"]}
    save_policy(base, mutate)
    if base in outage_bases():
        return
    if meter(base, team)["available_micro"] < ROOMY_FLOOR_CREDITS * MICRO:
        data(call(base, "june", "POST", "/api/topups", body={"team_id": team, "credits": ROOMY_TOPUP_CREDITS}), 201)


def drain(base: str, team: str) -> None:
    def flying() -> list[str]:
        return [j["id"] for status in IN_FLIGHT for j in team_jobs(base, team, status=status)]
    for job_id in flying():
        cancel(base, "rafael", job_id)
    poll(lambda: not flying(), GRACE_S, f"{team} drained")


def outage_bases() -> set[str]:
    return {instance(e) for e in OUTAGE_ENVS if e in os.environ}


def frozen_queue() -> str:
    down = instance("APP_STORAGE_DOWN_URL")
    poll(lambda: system(down)["storage"] == "down", STATUS_CHECK_S + GRACE_S, "storage down")
    roomy(down, STOREFRONT)
    drain(down, STOREFRONT)
    return down


def cancel_running(base: str, candidates: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    for job_id in candidates:
        before = wait_job(base, job_id, ACTIVE | FINAL)
        if before["status"] not in ACTIVE:
            continue
        r = cancel(base, "mara", job_id)
        if r.status_code == 200:
            return before, r.json()["job"]
    raise AssertionError("no candidate job was caught running")


def upload(base: str, who: str, blob: bytes, media_type: str = "image/png") -> httpx.Response:
    return call(base, who, "POST", "/api/uploads", content=blob, headers={"Content-Type": media_type})


def asset(base: str, who: str, asset_id: str) -> httpx.Response:
    return call(base, who, "GET", f"/api/assets/{asset_id}")


def lineage(base: str, who: str, asset_id: str) -> dict[str, Any]:
    return data(call(base, who, "GET", f"/api/assets/{asset_id}/lineage"), 200)


def search(base: str, who: str, q: str, **filters: str) -> list[str]:
    return [a["id"] for a in data(call(base, who, "GET", "/api/assets", params={"q": q, **filters}), 200)["assets"]]


def deliveries(base: str, endpoint_id: str) -> list[dict[str, Any]]:
    return data(call(base, "rafael", "GET", f"/api/webhook-endpoints/{endpoint_id}/deliveries"), 200)["deliveries"]


def endpoint_state(base: str, team: str, endpoint_id: str) -> dict[str, Any]:
    listed = data(call(base, "rafael", "GET", "/api/webhook-endpoints", params={"team": team}), 200)["endpoints"]
    return next(e for e in listed if e["id"] == endpoint_id)


def clear_endpoints(base: str, team: str) -> None:
    listed = data(call(base, "rafael", "GET", "/api/webhook-endpoints", params={"team": team}), 200)["endpoints"]
    for e in listed:
        expect_status(call(base, "rafael", "DELETE", f"/api/webhook-endpoints/{e['id']}"), 204)


def verify_signature(record: dict[str, Any], secret: str) -> dict[str, Any]:
    stamp = record["headers"]["dispatch-timestamp"]
    expected = hmac.new(secret.encode(), stamp.encode() + b"." + record["body"], hashlib.sha256).hexdigest()
    assert record["headers"]["dispatch-signature"] == f"v1={expected}"
    body = json.loads(record["body"])
    assert re.fullmatch(r"evt_[0-9a-f]{24}", body["id"])
    assert record["headers"]["dispatch-event-id"] == body["id"]
    assert record["headers"]["content-type"].startswith("application/json")
    return body


def unsigned(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def fetch_status(url: str) -> int:
    return httpx.get(url, timeout=HTTP_TIMEOUT).status_code


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def png(total: int | None = None, width: int = 4, height: int = 4) -> bytes:
    raw = b"".join(b"\x00" + b"\xff\x80\x40" * width for _ in range(height))
    head = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + _chunk(b"IDAT", zlib.compress(raw))
    tail = _chunk(b"IEND", b"")
    if total is None:
        return head + tail
    pad = total - len(head) - len(tail) - 12
    return head + _chunk(b"paDd", b"\x00" * pad) + tail


def png_size(blob: bytes) -> tuple[int, int]:
    assert blob[:8] == b"\x89PNG\r\n\x1a\n"
    w, h = struct.unpack(">II", blob[16:24])
    return w, h


def wav_seconds(blob: bytes) -> Decimal:
    assert blob[:4] == b"RIFF" and blob[8:12] == b"WAVE"
    pos, byte_rate, size = 12, 0, 0
    while pos + 8 <= len(blob):
        kind = blob[pos:pos + 4]
        n = struct.unpack("<I", blob[pos + 4:pos + 8])[0]
        if kind == b"fmt ":
            byte_rate = struct.unpack("<I", blob[pos + 16:pos + 20])[0]
        if kind == b"data":
            size = n
            break
        pos += 8 + n + (n & 1)
    return Decimal(size) / Decimal(byte_rate)


class Sink:

    def __init__(self, plan: tuple[int, ...] = (), default: int = 200,
                 routes: dict[str, tuple[int, dict[str, str], bytes]] | None = None) -> None:
        self.plan = list(plan)
        self.default = default
        self.routes = dict(routes or {})
        self.records: list[dict[str, Any]] = []
        self.lock = threading.Lock()

    def __enter__(self) -> "Sink":
        sink = self

        class Handler(BaseHTTPRequestHandler):
            def _serve(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                path = self.path.split("?")[0]
                with sink.lock:
                    sink.records.append({"method": self.command, "path": path, "body": body, "at": time.monotonic(),
                                         "headers": {k.lower(): v for k, v in self.headers.items()}})
                    if self.command == "POST":
                        status = sink.plan.pop(0) if sink.plan else sink.default
                        extra: dict[str, str] = {}
                        payload = b""
                    else:
                        status, extra, payload = sink.routes.get(path, (404, {}, b""))
                self.send_response(status)
                for k, v in extra.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(payload)

            do_GET = do_POST = do_HEAD = _serve

            def log_message(self, *args: Any) -> None:
                return

        self.server = ThreadingHTTPServer(("0.0.0.0", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.server.shutdown()
        self.server.server_close()

    def url(self, path: str) -> str:
        return f"http://{SINK_HOST}:{self.port}/{path.lstrip('/')}"

    def posts(self) -> list[dict[str, Any]]:
        with self.lock:
            return [r for r in self.records if r["method"] == "POST"]


class Relay:

    def __init__(self, port: int, target: str) -> None:
        parts = urlsplit(target)
        self.port = port
        self.target = (parts.hostname or "127.0.0.1", parts.port or (443 if parts.scheme == "https" else 80))
        self.conns: list[socket.socket] = []
        self.stopping = False

    def __enter__(self) -> "Relay":
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.listen(64)
        threading.Thread(target=self._accept, daemon=True).start()
        return self

    def _accept(self) -> None:
        while not self.stopping:
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
            except OSError:
                client.close()
                continue
            self.conns += [client, upstream]
            threading.Thread(target=self._pump, args=(client, upstream), daemon=True).start()
            threading.Thread(target=self._pump, args=(upstream, client), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while chunk := src.recv(65536):
                dst.sendall(chunk)
        except OSError:
            pass
        with contextlib.suppress(OSError):
            dst.shutdown(socket.SHUT_WR)

    def __exit__(self, *exc: Any) -> None:
        self.stopping = True
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()
        for conn in self.conns:
            with contextlib.suppress(OSError):
                conn.shutdown(socket.SHUT_RDWR)
            conn.close()


class Proxy:

    SKIP = {"connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
            "accept-encoding", "content-length", "content-encoding", "date", "server"}
    REFUSAL = b'{"message": "Declined by the test proxy"}'

    def __init__(self, port: int, target: str, pick: Callable[[str, str], bool], hold_s: float = 0.0,
                 refuse: int | None = None) -> None:
        self.port, self.target, self.pick, self.hold_s = port, target.rstrip("/"), pick, hold_s
        self.refuse = refuse
        self.withheld: list[str] = []
        self.refused: list[str] = []
        self.lock = threading.Lock()
        self.conns: list[socket.socket] = []

    def __enter__(self) -> "Proxy":
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _body(self) -> bytes:
                if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                    chunks = []
                    while size := int(self.rfile.readline().split(b";")[0].strip() or b"0", 16):
                        chunks.append(self.rfile.read(size))
                        self.rfile.readline()
                    while self.rfile.readline().strip():
                        pass
                    return b"".join(chunks)
                length = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(length) if length else b""

            def _serve(self) -> None:
                body = self._body()
                if proxy.refuse is not None and proxy.pick(self.command, self.path):
                    with proxy.lock:
                        proxy.refused.append(f"{self.command} {self.path}")
                    self._reply(proxy.refuse, {"Content-Type": "application/json"}, Proxy.REFUSAL)
                    return
                headers = {k: v for k, v in self.headers.items() if k.lower() not in Proxy.SKIP}
                answer = httpx.request(self.command, proxy.target + self.path, headers=headers, content=body,
                                       timeout=HTTP_TIMEOUT)
                with proxy.lock:
                    withhold = proxy.refuse is None and not proxy.withheld and proxy.pick(self.command, self.path)
                    if withhold:
                        proxy.withheld.append(f"{self.command} {self.path}")
                if withhold:
                    time.sleep(proxy.hold_s)
                    self.close_connection = True
                    return
                self._reply(answer.status_code, answer.headers, answer.content)

            def _reply(self, status: int, headers: Any, content: bytes) -> None:
                self.send_response(status)
                for k, v in headers.items():
                    if k.lower() not in Proxy.SKIP:
                        self.send_header(k, v)
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(content)
                self.close_connection = True

            do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = _serve

            def log_message(self, *args: Any) -> None:
                return

        class Server(ThreadingHTTPServer):
            def get_request(self) -> tuple[socket.socket, Any]:
                conn, addr = super().get_request()
                proxy.conns.append(conn)
                return conn, addr

        self.server = Server(("127.0.0.1", self.port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.server.shutdown()
        self.server.server_close()
        for conn in self.conns:
            with contextlib.suppress(OSError):
                conn.shutdown(socket.SHUT_RDWR)
            conn.close()


@contextlib.contextmanager
def ui(browser: Any, base: str, who: str, width: int = 1280, height: int = 800,
       reduced_motion: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, base + "/", reduced_motion=reduced_motion) as page:
        page.set_default_timeout(UI_TIMEOUT_MS)
        page.set_viewport_size({"width": width, "height": height})
        form = page.get_by_role("form", name="Sign in")
        see(page, form)
        form.get_by_role("textbox", name="Email").fill(EMAILS[who])
        form.get_by_label("Passcode").fill(PASSCODE)
        form.get_by_role("button", name="Sign in").click()
        see(page, page.get_by_role("button", name="Sign out"))
        yield page


def go(page: Page, screen: str) -> None:
    link = page.get_by_role("navigation", name="Primary").get_by_role("link", name=screen, exact=True)
    if not (link.count() and link.first.is_visible()):
        menu = page.get_by_role("button", name="Menu")
        if menu.count() and menu.first.is_visible():
            menu.first.click()
    see(page, link)
    link.first.click()
    advance(page, STEP_MS)


def choose_team(page: Page, team: str) -> None:
    boxes = page.get_by_role("combobox", name="Team", exact=True)
    see(page, boxes)
    for i in range(boxes.count()):
        if boxes.nth(i).is_visible():
            select(boxes.nth(i), TEAM_NAMES[team])
    advance(page, STEP_MS)


def notices(page: Page) -> Any:
    return page.get_by_role("status", name="Notices")


def see_alert(page: Page, wanted: str) -> None:
    eventually(page, lambda: any(squash(wanted) in squash(a.inner_text(timeout=UI_TIMEOUT_MS))
                                 for a in page.get_by_role("alert").all()), UI_WAIT_S, f"text {wanted!r} in an alert")


def notch(page: Page, job_id: str, units_label: str) -> Any:
    return (page.get_by_role("region", name="Credit meter").get_by_role("list", name="In-flight jobs")
            .get_by_role("button", name=f"Job {job_id}, {units_label} reserved"))


def row_for(table: Any, needle: str) -> Any:
    return table.get_by_role("row").filter(has_text=needle)


def width_of(locator: Any) -> float:
    box = locator.bounding_box()
    assert box, locator
    return float(box["width"])


def ribbon_mismatch(page: Page, base: str, team: str) -> str | None:
    bal = ledger(base, team)["balances"]
    region = page.get_by_role("region", name="Credit meter")
    shown = squash(region.inner_text(timeout=UI_TIMEOUT_MS))
    widths: dict[str, float] = {}
    for name, key in METER_SEGMENTS:
        if f"{name} {credits_text(bal[key])}" not in shown:
            return f"numeral {name} != {credits_text(bal[key])}: {shown}"
        segment = region.get_by_role("meter", name=name)
        values = segment.evaluate(METER_VALUES)
        if abs(Decimal(values["now"]) - Decimal(bal[key]) / MICRO) >= Decimal("0.01"):
            return f"meter {name} value {values['now']}"
        if abs(Decimal(values["max"]) - Decimal(bal["granted_micro"]) / MICRO) >= Decimal("0.01"):
            return f"meter {name} max {values['max']}"
        widths[name] = width_of(segment)
    inner = sum(widths.values())
    for name, key in METER_SEGMENTS:
        drawn = Decimal(bal[key]) / Decimal(bal["granted_micro"]) * Decimal(str(inner))
        if abs(Decimal(str(widths[name])) - drawn) > 1:
            return f"width {name} {widths[name]} vs {drawn}"
    return None


def assert_ribbon(page: Page, base: str, team: str) -> None:
    eventually(page, lambda: ribbon_mismatch(page, base, team) is None, LIVE_UPDATE_S + GRACE_S, "ribbon to match ledger")
    assert ribbon_mismatch(page, base, team) is None


def path_widths(path: list[dict[str, float]]) -> tuple[list[float], list[float]]:
    times = [float(p.get("t", i * SAMPLE_MS)) for i, p in enumerate(path)]
    return times, [float(p["width"]) for p in path]


def settle_time(times: list[float], widths: list[float], tol: float) -> float:
    first = next(i for i, w in enumerate(widths) if abs(w - widths[0]) > tol)
    final = widths[-1]
    last = max(i for i, w in enumerate(widths) if abs(w - final) > tol)
    return times[min(last + 1, len(times) - 1)] - times[max(first - 1, 0)]


def ribbon_path(page: Page, region: Any, segment: Any,
                arrived: Callable[[], Any]) -> tuple[list[float], list[float], list[float]]:
    times, widths, calm, seen = [0.0], [width_of(segment)], 0.0, False
    deadline = time.monotonic() + LIVE_UPDATE_S + GRACE_S
    try:
        while not (seen and calm >= SEQUENCE_MAX_MS):
            if time.monotonic() > deadline:
                raise AssertionError(f"the ribbon change never arrived and came to rest: {widths}")
            scope = region.element_handle()
            held = segment.evaluate(SEEK_HELD, [scope, MOTION_SAMPLES])
            scope.dispose()
            if held:
                _TICK.wait(POLL_S)
                seeked = [p["width"] for p in held["path"]] + [width_of(segment)]
                if max(seeked) - min(seeked) > MIN_DELTA_PX:
                    return [p["t"] for p in held["path"]] + [held["total"]], seeked, held["durations"]
            if not seen:
                with contextlib.suppress(PlaywrightError):
                    seen = bool(arrived())
                calm = 0.0 if seen else calm
            advance(page, SAMPLE_MS)
            _TICK.wait(SAMPLE_MS / 1000)
            times.append(times[-1] + SAMPLE_MS)
            widths.append(width_of(segment))
            calm = 0.0 if abs(widths[-1] - widths[-2]) > MIN_DELTA_PX else calm + SAMPLE_MS
        return times, widths, []
    finally:
        page.evaluate(RELEASE_HELD)


def find_job(base: str, team: str, prompt: str) -> dict[str, Any] | None:
    for j in team_jobs(base, team):
        inp = j.get("input") or {}
        if inp.get("prompt") == prompt or inp.get("text") == prompt:
            return j
    return None


def test_submit_job(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    newest = newest_job_id(base, STOREFRONT)
    error_of(call(base, "mara", "POST", "/api/jobs", body={"model": "quill-still", "input": quill(word())}), 400, "idempotency_key_required")
    error_of(submit(base, "mara", "quill-still", quill(word()), key="k" * (KEY_MAX + 1)), 400, "idempotency_key_required")
    error_of(call(base, None, "POST", "/api/jobs", body={"model": "quill-still", "input": quill(word())},
                  headers={"Idempotency-Key": idempotency_key()}), 401, "unauthenticated")
    assert newest_job_id(base, STOREFRONT) == newest
    rate = current_rate(base, "quill-still")
    prompt = word()
    created = submitted(base, "mara", "quill-still", quill(prompt, 2))
    try:
        assert set(created) == FULL_JOB_KEYS
        assert created["status"] == "queued" and created["team_id"] == STOREFRONT and created["model"] == "quill-still"
        assert created["priority"] == "normal" and created["submitted_by"] == {"id": "m_mara", "name": "Mara Okonkwo"}
        assert re.fullmatch(JOB_ID_RE, created["id"]) and created["submitted_at"].endswith("Z")
        assert created["input"]["prompt"] == prompt and created["payload_visible"] is True
        assert created["rate"]["id"] == rate["id"] and created["estimated_units"] == "2"
        assert created["reserved_micro"] == charge("2", rate["micro_per_unit"])
        assert created["billed_units"] is None and created["charged_micro"] is None
        reserves = movements(base, STOREFRONT, job_id=created["id"], kind="reserve")
        assert len(reserves) == 1
        assert entries(reserves[0]) == {"available": -created["reserved_micro"], "reserved": created["reserved_micro"]}
        assert [j["id"] for j in team_jobs(base, STOREFRONT) if (j.get("input") or {}).get("prompt") == prompt] == [created["id"]]
    finally:
        cancel(base, "rafael", created["id"])


def test_replay_returns_original(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    roomy(base, CAMPAIGNS)
    key = idempotency_key()
    prompt = word()
    first = submit(base, "mara", "reel-10", {"prompt": prompt, "duration_seconds": 5}, key=key, priority="normal")
    original = data(first, 201)
    try:
        moves = len(ledger(base, STOREFRONT)["movements"])
        newest = newest_job_id(base, STOREFRONT)
        again = submit(base, "mara", "reel-10", {"duration_seconds": 5, "prompt": prompt}, key=key)
        assert again.status_code == 201 and again.json() == original
        assert again.headers.get("Idempotent-Replayed") == "true"
        assert len(ledger(base, STOREFRONT)["movements"]) == moves
        assert newest_job_id(base, STOREFRONT) == newest
        assert original["job"]["id"] in [r["job_id"] for r in meter(base, STOREFRONT)["recent_replays"]]
        other_team = data(submit(base, "ines", "reel-10", reel(prompt), key=key), 201)["job"]
        assert other_team["id"] != original["job"]["id"] and other_team["team_id"] == CAMPAIGNS
        cancel(base, "rafael", other_team["id"])
    finally:
        cancel(base, "rafael", original["job"]["id"])


def test_replay_outlives_refusals(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    key, prompt = idempotency_key(), word()
    original = data(submit(base, "ines", "quill-still", quill(prompt), key=key), 201)

    def replayed(after: str) -> None:
        again = submit(base, "ines", "quill-still", quill(prompt), key=key)
        assert again.status_code == 201 and again.json() == original, f"replay after {after}: {again.status_code} {again.text[:300]}"
        assert again.headers.get("Idempotent-Replayed") == "true"

    try:
        wait_job(base, original["job"]["id"], {"succeeded"})
        replayed("the job finished")
        save_policy(base, lambda p: team_policy(p, CAMPAIGNS)["model_access"].update(
            {"quill-still": {"api": "blocked", "playground": "inherit"}}))
        replayed("the model was blocked")
        error_of(submit(base, "ines", "quill-still", quill(prompt)), 403, "model_blocked")
        roomy(base, CAMPAIGNS)
        cap = -(-meter(base, CAMPAIGNS)["period"]["spend_micro"] // MICRO) + 1
        set_team(base, CAMPAIGNS, soft_cap_credits=cap, hard_cap_credits=cap)
        replayed("the hard cap was reached")
        error_of(submit(base, "ines", "quill-still", quill(prompt)), 429, "budget_hard_cap")
    finally:
        roomy(base, CAMPAIGNS)
        cancel(base, "rafael", submitted(base, "ines", "quill-still", quill(word()))["id"])


def test_key_reused_with_other_body(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    key = idempotency_key()
    prompt = word()
    created = submitted(base, "mara", "quill-still", quill(prompt), key=key)
    try:
        reserves = reserve_count(base, STOREFRONT)
        newest = newest_job_id(base, STOREFRONT)
        variants = [("halftone-xl", halftone(prompt), None), ("quill-still", quill(word()), None), ("quill-still", quill(prompt), "high")]
        for model, inp, priority in variants:
            error_of(submit(base, "mara", model, inp, key=key, priority=priority), 409, "idempotency_key_reused")
        assert reserve_count(base, STOREFRONT) == reserves and newest_job_id(base, STOREFRONT) == newest
        assert job(base, "mara", created["id"])["priority"] == "normal"
        fresh = idempotency_key()
        error_of(submit(base, "mara", "quill-still", {"style": "photo", "num_images": 1}, key=fresh), 422, "validation_failed")
        later = submitted(base, "mara", "quill-still", quill(word()), key=fresh)
        cancel(base, "rafael", later["id"])
    finally:
        cancel(base, "rafael", created["id"])


def test_parallel_retries_make_one_job(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    key = idempotency_key()
    prompt = word()
    responses = parallel(RACERS, lambda _: submit(base, "mara", "reel-10", reel(prompt), key=key))
    bodies = [data(r, 201)["job"] for r in responses]
    winner = bodies[0]["id"]
    try:
        assert all(b["id"] == winner for b in bodies)
        assert sum(r.headers.get("Idempotent-Replayed") != "true" for r in responses) == 1
        assert len(movements(base, STOREFRONT, job_id=winner, kind="reserve")) == 1
        assert [j["id"] for j in team_jobs(base, STOREFRONT) if (j.get("input") or {}).get("prompt") == prompt] == [winner]
    finally:
        cancel(base, "rafael", winner)


def test_schema_validation(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    reserves = reserve_count(base, STOREFRONT)
    newest = newest_job_id(base, STOREFRONT)
    missing = error_of(submit(base, "mara", "quill-still", {"style": "photo", "num_images": 1}), 422, "validation_failed")
    assert missing["fields"] == {"input.prompt": "Required."}
    two = error_of(submit(base, "mara", "quill-still", {"prompt": word(), "style": "oil paint", "num_images": 9}), 422, "validation_failed")
    assert set(two["fields"]) == {field_path("style"), field_path("num_images")}
    assert all(isinstance(v, str) and v for v in two["fields"].values())
    wide = error_of(submit(base, "mara", "halftone-xl", halftone(word(), width=800)), 422, "validation_failed")
    assert set(wide["fields"]) == {field_path("width")}
    long_prompt = error_of(submit(base, "mara", "reel-10", reel("p" * 2001)), 422, "validation_failed")
    assert set(long_prompt["fields"]) == {"input.prompt"}
    long_voice = error_of(submit(base, "mara", "murmur-voice", murmur(MURMUR_TEXT, 121)), 422, "validation_failed")
    assert set(long_voice["fields"]) == {field_path("max_seconds")}
    assert reserve_count(base, STOREFRONT) == reserves and newest_job_id(base, STOREFRONT) == newest


def test_job_lifecycle_and_cancel(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT, concurrency=1)
    drain(base, STOREFRONT)
    try:
        blocker = submitted(base, "mara", "quill-still", quill(word()))
        wait_job(base, blocker["id"], ACTIVE, SLOT_FILL_S + GRACE_S)
        guards = [submitted(base, "mara", "quill-still", quill(word()), priority="high")["id"] for _ in range(GUARDS)]
        queued = submitted(base, "mara", "reel-10", reel(word()))
        error_of(cancel(base, "ines", queued["id"]), 404, "not_found")
        error_of(cancel(base, "june", queued["id"]), 403, "forbidden")
        stopped = data(cancel(base, "theo", queued["id"]), 200)["job"]
        assert stopped["status"] == "cancelled" and stopped["released_micro"] == queued["reserved_micro"]
        again = data(cancel(base, "mara", queued["id"]), 200)["job"]
        assert again == stopped
        releases = movements(base, STOREFRONT, job_id=queued["id"], kind="release")
        assert len(releases) == 1 and entries(releases[0]) == {"reserved": -queued["reserved_micro"], "available": queued["reserved_micro"]}
        up = data(upload(base, "mara", png()), 201)["asset"]
        doomed = submitted(base, "mara", "reel-10", reel(word(), start=f"asset:{up['id']}"))
        expect_status(call(base, "sol", "DELETE", f"/api/assets/{up['id']}"), 204)
        caught, running = cancel_running(base, [blocker["id"], *guards])
        assert running["status"] == "cancelled" and running["released_micro"] == caught["reserved_micro"]
        released = movements(base, STOREFRONT, job_id=caught["id"], kind="release")
        assert len(released) == 1 and entries(released[0])["available"] == caught["reserved_micro"]
        for guard in guards:
            cancel(base, "rafael", guard)
        failed = wait_job(base, doomed["id"], FINAL)
        assert failed["status"] == "failed" and failed["failure_reason"] == "input_deleted" and failed["attempts"] == 1
        assert failed["released_micro"] == doomed["reserved_micro"] and failed["charged_micro"] is None
        err = error_of(cancel(base, "mara", doomed["id"]), 409, "job_not_cancellable")
        assert err["status"] == "failed"
        done = wait_job(base, submitted(base, "mara", "quill-still", quill(word()))["id"], {"succeeded"})
        assert done["started_at"] and done["finished_at"] and done["attempts"] >= 1
        err = error_of(cancel(base, "rafael", done["id"]), 409, "job_not_cancellable")
        assert err["status"] == "succeeded"
        assert len(movements(base, STOREFRONT, job_id=done["id"], kind="release")) == 0
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_parallel_cancels_release_once(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT, concurrency=1)
    drain(base, STOREFRONT)
    try:
        job = submitted(base, "mara", "reel-10", reel(word()))
        wait_job(base, job["id"], ACTIVE, SLOT_FILL_S + GRACE_S)
        who = ("mara", "theo", "rafael")
        answers = parallel(CANCELS, lambda i: cancel(base, who[i % len(who)], job["id"]))
        for answer in answers:
            got = data(answer, 200)["job"]
            assert got["id"] == job["id"] and got["status"] == "cancelled"
            assert got["released_micro"] == job["reserved_micro"]
        releases = movements(base, STOREFRONT, job_id=job["id"], kind="release")
        assert len(releases) == 1
        assert entries(releases[0]) == {"reserved": -job["reserved_micro"], "available": job["reserved_micro"]}
        final = wait_job(base, job["id"], FINAL)
        assert final["status"] == "cancelled" and final["released_micro"] == job["reserved_micro"]
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_wf_api_submit_retry(browser: Any) -> None:
    base = frozen_queue()
    try:
        with ui(browser, base, "mara", reduced_motion="reduce") as page:
            key = idempotency_key()
            body = reel(word(), 10)
            first = submitted(base, "mara", "reel-10", body, key=key)
            tab = notch(page, first["id"], notch_units("10", "video_second"))
            see(page, tab, LIVE_UPDATE_S + GRACE_S, FINE_STEP_MS)
            advance(page, SEQUENCE_MAX_MS * 2)
            rest = style(tab, *OUTLINE_PROPS)
            reserves = reserve_count(base, STOREFRONT)
            again = submit(base, "mara", "reel-10", body, key=key)
            assert data(again, 201)["job"]["id"] == first["id"] and again.headers.get("Idempotent-Replayed") == "true"
            eventually(page, lambda: bool(animations(tab)) or style(tab, *OUTLINE_PROPS) != rest,
                       LIVE_UPDATE_S + GRACE_S, "replay highlight", STEP_MS)
            see_text(page, page.get_by_role("status", name="Meter announcements"),
                     f"Job {first['id']} already reserved; nothing added", LIVE_UPDATE_S + GRACE_S)
            tabs = (page.get_by_role("region", name="Credit meter").get_by_role("list", name="In-flight jobs")
                    .get_by_role("button", name=f"Job {first['id']},"))
            assert tabs.count() == 1
            assert reserve_count(base, STOREFRONT) == reserves
            go(page, "Jobs")
            table = page.get_by_role("table", name="Jobs")
            see(page, row_for(table, first["id"]), LIVE_UPDATE_S + GRACE_S)
            assert row_for(table, first["id"]).count() == 1
        assert len(movements(base, STOREFRONT, job_id=first["id"], kind="reserve")) == 1
    finally:
        drain(base, STOREFRONT)


def test_wf_api_submit_cancel(browser: Any) -> None:
    base = frozen_queue()
    try:
        with ui(browser, base, "mara") as page:
            queued = submitted(base, "mara", "reel-10", reel(word()))
            lane = page.get_by_role("list", name=lane_name("Reel 10"))
            button = lane.get_by_role("button", name=f"Cancel job {queued['id']}")
            see(page, button, LIVE_UPDATE_S + GRACE_S)
            button.click()
            see_text(page, notices(page), f"Job {queued['id']} cancelled; {credits_text(queued['reserved_micro'])} credits released.")
            gone(page, notch(page, queued["id"], notch_units("5", "video_second")), LIVE_UPDATE_S + GRACE_S)
        assert job(base, "mara", queued["id"])["status"] == "cancelled"
        releases = movements(base, STOREFRONT, job_id=queued["id"], kind="release")
        assert len(releases) == 1 and entries(releases[0])["available"] == queued["reserved_micro"]
    finally:
        drain(base, STOREFRONT)


def test_concurrency_budget(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT, concurrency=2)
    drain(base, STOREFRONT)
    try:
        blocker = submitted(base, "mara", "quill-still", quill(word(), 8))["id"]
        wait_job(base, blocker, ACTIVE, SLOT_FILL_S + GRACE_S)
        racers = parallel(RACERS, lambda _: data(submit(base, "mara", "quill-still", quill(word())), 201)["job"]["id"])
        assert len(set(racers)) == RACERS

        def statuses() -> dict[str, str]:
            return {j["id"]: j["status"] for status in IN_FLIGHT for j in team_jobs(base, STOREFRONT, status=status)}

        poll(lambda: sum(statuses().get(r) in ACTIVE for r in racers) >= 1, SLOT_FILL_S + GRACE_S, "one racer to start")
        deadline = time.monotonic() + OBSERVE_S
        while time.monotonic() < deadline:
            now = statuses()
            assert sum(s in ACTIVE for s in now.values()) <= 2, now
            if now.get(blocker) in ACTIVE:
                assert sum(now.get(r) in ACTIVE for r in racers) == 1, now
            _TICK.wait(POLL_S)
        for r in racers:
            j = job(base, "mara", r)
            if j["status"] == "queued":
                assert j["attempts"] == 0 and not movements(base, STOREFRONT, job_id=r, kind="release")
                assert len(movements(base, STOREFRONT, job_id=r, kind="reserve")) == 1
            else:
                assert j["attempts"] == 1
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_dispatch_order(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT, concurrency=1)
    drain(base, STOREFRONT)
    try:
        blocker = submitted(base, "mara", "quill-still", quill(word()))["id"]
        wait_job(base, blocker, ACTIVE, SLOT_FILL_S + GRACE_S)
        low = submitted(base, "mara", "quill-still", quill(word()), priority="low")["id"]
        normal = submitted(base, "mara", "reel-10", reel(word()))["id"]
        high = submitted(base, "theo", "quill-still", quill(word()), priority="high")["id"]
        later = submitted(base, "mara", "halftone-xl", halftone(word()), priority="normal")["id"]
        expected = [high, normal, later, low]
        assert [job(base, "mara", j)["queue_position"] for j in expected] == [1, 2, 3, 4]
        expect_status(cancel(base, "rafael", blocker), 200)
        wait_job(base, high, ACTIVE, SLOT_FILL_S + GRACE_S)
        assert all(job(base, "mara", j)["status"] == "queued" for j in (normal, later, low))
        expect_status(cancel(base, "rafael", high), 200)
        wait_job(base, normal, ACTIVE, SLOT_FILL_S + GRACE_S)
        assert [job(base, "mara", j)["queue_position"] for j in (later, low)] == [1, 2]
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_blocked_while_queued(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT, concurrency=1)
    drain(base, STOREFRONT)

    def block_api(p: dict[str, Any]) -> None:
        team_policy(p, STOREFRONT)["model_access"]["quill-still"] = {"api": "blocked", "playground": "inherit"}

    try:
        holder = submitted(base, "mara", "reel-10", reel(word()))["id"]
        wait_job(base, holder, ACTIVE, SLOT_FILL_S + GRACE_S)
        guards = [submitted(base, "mara", "reel-10", reel(word()), priority="high")["id"] for _ in range(GUARDS)]
        keyed = submitted(base, "mara", "quill-still", quill(word()))
        with session_client(base, "mara") as client:
            played = data(client.post("/api/jobs", json={"model": "quill-still", "input": quill(word())},
                                      headers={"Idempotency-Key": idempotency_key()}), 201)["job"]
        save_policy(base, block_api)
        for slot_job in [*guards, holder]:
            cancel(base, "rafael", slot_job)
        failed = wait_job(base, keyed["id"], FINAL, SLOT_FILL_S + GRACE_S)
        assert failed["status"] == "failed" and failed["failure_reason"] == "model_blocked", failed
        reserved = keyed["reserved_micro"]
        assert failed["released_micro"] == reserved
        released = movements(base, STOREFRONT, job_id=keyed["id"], kind="release")
        assert len(released) == 1 and entries(released[0]) == {"reserved": -reserved, "available": reserved}
        assert not movements(base, STOREFRONT, job_id=keyed["id"], kind="settle")
        assert wait_job(base, played["id"], FINAL)["status"] == "succeeded"
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_queue_lanes(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT, concurrency=1)
    drain(base, STOREFRONT)
    try:
        blocker = submitted(base, "mara", "quill-still", quill(word()))["id"]
        wait_job(base, blocker, ACTIVE, SLOT_FILL_S + GRACE_S)
        a = submitted(base, "mara", "reel-10", reel(word()))["id"]
        b = submitted(base, "mara", "reel-10", reel(word()))["id"]
        c = submitted(base, "mara", "halftone-xl", halftone(word()))["id"]

        def lanes(who: str = "mara") -> dict[str, dict[str, Any]]:
            params = {"team": STOREFRONT}
            return {lane["model"]: lane for lane in data(call(base, who, "GET", "/api/queue", params=params), 200)["lanes"]}

        now = lanes()
        assert {"quill-still", "halftone-xl", "reel-10"} <= set(now)
        assert [j["id"] for j in now["reel-10"]["queued"]] == [a, b]
        assert [j["queue_position"] for j in now["reel-10"]["queued"]] == [1, 2]
        assert [j["id"] for j in now["halftone-xl"]["queued"]] == [c] and now["halftone-xl"]["queued"][0]["queue_position"] == 3
        assert blocker in [j["id"] for j in now["quill-still"]["running"]]
        assert lanes("rafael")["reel-10"]["queued"][0]["id"] == a
        error_of(call(base, "ines", "GET", "/api/queue", params={"team": STOREFRONT}), 404, "not_found")
        expect_status(cancel(base, "rafael", a), 200)
        poll(lambda: [(j["id"], j["queue_position"]) for j in lanes()["reel-10"]["queued"]] == [(b, 1)],
             LIVE_UPDATE_S + 1, "lane update after cancel")
        assert lanes()["halftone-xl"]["queued"][0]["queue_position"] == 2
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_wf_concurrency_dispatch_lanes(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT, concurrency=1)
    drain(base, STOREFRONT)
    try:
        with ui(browser, base, "mara") as page:
            ids = [submitted(base, "mara", "quill-still", quill(word()))["id"] for _ in range(3)]
            first, second, third = ids
            wait_job(base, first, ACTIVE, SLOT_FILL_S + GRACE_S)
            lane = page.get_by_role("list", name=lane_name("Quill Still"))
            eventually(page, lambda: any(f"{first} · {s}" in lane.inner_text() for s in ACTIVE),
                       LIVE_UPDATE_S + GRACE_S, "first job running in its lane")
            see_text(page, lane, f"{second} · queued #1")
            see_text(page, lane, f"{third} · queued #2")
            wait_job(base, second, ACTIVE, JOB_DONE_S)
            see_text(page, lane, f"{third} · queued #1", LIVE_UPDATE_S + GRACE_S)
        done = [wait_job(base, j, {"succeeded"}) for j in ids]
        assert iso(done[1]["started_at"]) >= iso(done[0]["finished_at"])
        assert iso(done[2]["started_at"]) >= iso(done[1]["finished_at"])
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_wf_concurrency_dispatch_cancel_queued(browser: Any) -> None:
    base = frozen_queue()
    try:
        with ui(browser, base, "mara") as page:
            a = submitted(base, "mara", "reel-10", reel(word()))
            b = submitted(base, "mara", "reel-10", reel(word()))
            lane = page.get_by_role("list", name=lane_name("Reel 10"))
            see_text(page, lane, f"{b['id']} · queued #2")
            lane.get_by_role("button", name=f"Cancel job {a['id']}").click()
            see_text(page, lane, f"{b['id']} · queued #1", LIVE_UPDATE_S + GRACE_S)
        assert job(base, "mara", a["id"])["status"] == "cancelled"
        assert job(base, "mara", b["id"])["queue_position"] == 1
        assert [m["kind"] for m in movements(base, STOREFRONT, job_id=a["id"])].count("release") == 1
    finally:
        drain(base, STOREFRONT)


def field_facts(locator: Any) -> dict[str, Any]:
    return locator.evaluate(
        "el => ({multi: el.tagName === 'TEXTAREA' || el.getAttribute('aria-multiline') === 'true',"
        " min: el.getAttribute('min') ?? el.getAttribute('aria-valuemin'),"
        " max: el.getAttribute('max') ?? el.getAttribute('aria-valuemax'),"
        " value: (el.value ?? el.getAttribute('aria-valuenow')),"
        " shown: (el.selectedOptions && el.selectedOptions.length) ? el.selectedOptions[0].textContent : el.textContent})")


def estimate_copy(units: str, unit: str, rate_micro: int) -> str:
    return f"Estimated {credits_text(charge(units, rate_micro))} credits for {units_text(units, unit)} {UNIT_LABELS[unit]}"


def test_schema_form(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    rate = current_rate(base, "halftone-xl")["micro_per_unit"]
    with ui(browser, base, "ines") as page:
        rail = page.get_by_role("navigation", name="Catalogue")
        for heading in ("Image", "Video", "Audio"):
            expect(rail.get_by_role("heading", name=heading)).to_be_visible()
        rail.get_by_role("button", name="Halftone XL", exact=True).click()
        form = page.get_by_role("form", name=run_form("Halftone XL"))
        see(page, form)
        assert rail.get_by_role("button", name="Halftone XL", exact=True).get_attribute("aria-pressed") == "true"
        prompt = form.get_by_role("textbox", name="Prompt", exact=True)
        eventually(page, lambda: has_focus(prompt), UI_WAIT_S, "focus on first field")
        assert field_facts(prompt)["multi"] is True
        assert "Required" in form.inner_text()
        fields = [form.get_by_role("combobox", name="Width"), form.get_by_role("combobox", name="Height"),
                  form.get_by_role("spinbutton", name="Number of images"), form.get_by_role("textbox", name="Starting image")]
        reached: list[int] = []
        for _ in range(12):
            page.keyboard.press("Tab")
            reached += [i for i, field in enumerate(fields) if i not in reached and has_focus(field)]
            if len(reached) == len(fields):
                break
        assert reached == [0, 1, 2, 3], f"Tab reached the schema fields in order {reached}, not Width, Height, count, image"
        assert "1024" in field_facts(form.get_by_role("combobox", name="Width"))["shown"]
        assert "1024" in field_facts(form.get_by_role("combobox", name="Height"))["shown"]
        count = form.get_by_role("spinbutton", name="Number of images")
        facts = field_facts(count)
        assert (str(facts["min"]), str(facts["max"]), str(facts["value"])) == ("1", "4", "1")
        expect(form.get_by_role("textbox", name="Starting image")).to_be_visible()
        expect(form.get_by_role("button", name=upload_button("Starting image"))).to_be_visible()
        expect(form.get_by_role("button", name=clear_button("Starting image"))).to_be_visible()
        see(page, page.get_by_text(estimate_copy(megapixels(1024, 1024), "megapixel", rate)))
        count.fill("2")
        see(page, page.get_by_text(estimate_copy(megapixels(1024, 1024, 2), "megapixel", rate)))
        rail.get_by_role("button", name="Quill Still", exact=True).click()
        form = page.get_by_role("form", name=run_form("Quill Still"))
        see(page, form)
        style = field_facts(form.get_by_role("combobox", name="Style"))
        assert "photo" in f"{style['value'] or ''} {style['shown'] or ''}".lower()
        facts = field_facts(form.get_by_role("spinbutton", name="Number of images"))
        assert (str(facts["min"]), str(facts["max"]), str(facts["value"])) == ("1", "8", "1")
        assert form.get_by_role("textbox", name="Starting image").count() == 0
        assert rail.get_by_role("button", name="Halftone XL", exact=True).get_attribute("aria-pressed") == "false"


SSRF_CASES = {
    "exempt-host": "allowed",
    "loopback": "http://127.0.0.1:{port}/img.png",
    "ipv6-loopback": "http://[::1]:{port}/img.png",
    "decimal": "http://2130706433:{port}/img.png",
    "octal": "http://0177.0.0.1:{port}/img.png",
    "hex": "http://0x7f000001:{port}/img.png",
    "mapped-ipv6": "http://[::ffff:127.0.0.1]:{port}/img.png",
    "metadata": "http://169.254.169.254/latest/meta-data/",
    "private-10": "http://10.0.0.1/img.png",
    "private-172": "http://172.16.0.1/img.png",
    "private-192": "http://192.168.0.1/img.png",
    "cgnat": "http://100.64.0.1/img.png",
    "redirect-to-loopback": "redirect",
}


@pytest.mark.parametrize("case", list(SSRF_CASES), ids=list(SSRF_CASES))
def test_image_url_fetch(app_url: str, case: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    with Sink() as sink:
        if SSRF_CASES[case] == "allowed":
            served = png()
            sink.routes[IMG_PATH] = (200, {"Content-Type": "image/png"}, served)
            created = submitted(base, "mara", "reel-10", reel(word(), start=sink.url(IMG_PATH)))
            try:
                assert len(created["input_assets"]) == 1
                fetched = data(asset(base, "mara", created["input_assets"][0]), 200)["asset"]
                assert fetched["kind"] == "upload" and fetched["team_id"] == STOREFRONT
                assert S3().get(upload_key(STOREFRONT, fetched["id"])) == served
                assert [r["path"] for r in sink.records] == [IMG_PATH]
            finally:
                cancel(base, "rafael", created["id"])
            return
        if SSRF_CASES[case] == "redirect":
            sink.routes[HOP_PATH] = (REDIRECT_STATUS, {LOCATION: REDIRECT_TO_LOOPBACK.format(port=sink.port)}, b"")
            url = sink.url(HOP_PATH)
        else:
            url = SSRF_CASES[case].format(port=sink.port)
        reserves = reserve_count(base, STOREFRONT)
        newest = newest_job_id(base, STOREFRONT)
        err = error_of(submit(base, "mara", "reel-10", reel(word(), start=url)), 422, "validation_failed")
        assert err["fields"][field_path("start_image")] == REFUSED_COPY
        assert [r for r in sink.records if r["path"] != HOP_PATH] == []
        assert reserve_count(base, STOREFRONT) == reserves
        assert newest_job_id(base, STOREFRONT) == newest


def test_upload_image(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    blob = png(total=UPLOAD_LIMIT)
    made = data(upload(base, "mara", blob), 201)["asset"]
    assert made["kind"] == "upload" and made["media_type"] == "image/png"
    assert made["job_id"] is None and made["model"] is None and made["bytes"] == UPLOAD_LIMIT
    key = upload_key(STOREFRONT, made["id"])
    assert key in S3().keys(f"uploads/{STOREFRONT}/")
    assert S3().get(key) == blob
    assert httpx.get(made["url"], timeout=HTTP_TIMEOUT).content == blob
    error_of(upload(base, "mara", blob + b"a"), 413, "payload_too_large")
    error_of(upload(base, "mara", b"hello", media_type=NOT_JSON), 415, "unsupported_media_type")
    error_of(upload(base, "june", png()), 403, "forbidden")
    used = submitted(base, "mara", "reel-10", reel(word(), start=f"asset:{made['id']}"))
    try:
        assert used["input_assets"] == [made["id"]]
    finally:
        cancel(base, "rafael", used["id"])


def test_derived_from_lineage(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    roomy(base, CAMPAIGNS)
    source = wait_job(base, submitted(base, "mara", "quill-still", quill(word()))["id"], {"succeeded"})
    a1 = source["outputs"][0]
    derived = submitted(base, "mara", "halftone-xl", halftone(word(), n=2, init=f"asset:{a1}"))
    assert derived["input_assets"] == [a1]
    derived = wait_job(base, derived["id"], {"succeeded"})
    b1, b2 = derived["outputs"]
    assert data(asset(base, "mara", b1), 200)["asset"]["derived_from"] == [a1]
    graph = lineage(base, "mara", a1)
    ids = [n["id"] for n in graph["nodes"]]
    assert {a1, b1, b2} <= set(ids) and ids.index(a1) < ids.index(b1)
    assert {"from": a1, "to": b1} in graph["edges"] and {"from": a1, "to": b2} in graph["edges"]
    positions = [(ids.index(e["from"]), ids.index(e["to"])) for e in graph["edges"]]
    assert positions == sorted(positions)
    reused = submitted(base, "ines", "reel-10", reel(word(), start=f"asset:{a1}"))
    try:
        assert reused["input_assets"] == [a1]
    finally:
        cancel(base, "rafael", reused["id"])


def test_wf_playground_run_reuse(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    drain(base, CAMPAIGNS)
    first_prompt, second_prompt = word(), word()
    with ui(browser, base, "ines") as page:
        page.get_by_role("navigation", name="Catalogue").get_by_role("button", name="Quill Still", exact=True).click()
        form = page.get_by_role("form", name=run_form("Quill Still"))
        see(page, form)
        form.get_by_role("textbox", name="Prompt", exact=True).fill(first_prompt)
        form.get_by_role("button", name="Run", exact=True).click()
        first = poll(lambda: find_job(base, CAMPAIGNS, first_prompt), GRACE_S, "playground job")
        see_text(page, notices(page), f"Job {first['id']} queued — {credits_text(first['reserved_micro'])} credits reserved.")
        a1 = wait_job(base, first["id"], {"succeeded"})["outputs"][0]
        lineage_strip = page.get_by_role("region", name="Lineage")
        see(page, lineage_strip.get_by_role("button", name=f"Asset {a1}"), LIVE_UPDATE_S + GRACE_S)
        go(page, "Library")
        page.get_by_role("searchbox", name="Search media").fill(first_prompt)
        result = page.get_by_role("list", name="Results").get_by_role("button", name=f"Asset {a1}")
        see(page, result)
        result.click()
        page.get_by_role("dialog", name=f"Asset {a1}").get_by_role("button", name="Use as input").click()
        reel_form = page.get_by_role("form", name=run_form("Reel 10"))
        see(page, reel_form)
        expect(reel_form.get_by_role("textbox", name="Start frame")).to_have_value(f"asset:{a1}")
        reel_form.get_by_role("textbox", name="Prompt", exact=True).fill(second_prompt)
        reel_form.get_by_role("button", name="Run", exact=True).click()
        second = poll(lambda: find_job(base, CAMPAIGNS, second_prompt), GRACE_S, "second playground job")
        assert second["model"] == "reel-10" and second["input_assets"] == [a1]
        v1 = wait_job(base, second["id"], {"succeeded"})["outputs"][0]
        see(page, page.get_by_role("region", name="Lineage").get_by_role("button", name=f"Asset {v1}"), LIVE_UPDATE_S + GRACE_S)
    assert {"from": a1, "to": v1} in lineage(base, "ines", v1)["edges"]
    bal = ledger(base, CAMPAIGNS)["balances"]
    shown = meter(base, CAMPAIGNS, "ines")
    for key in ("granted_micro", "available_micro", "reserved_micro", "settled_micro"):
        assert shown[key] == bal[key]


def test_wf_playground_run_invalid(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    prompt = word()
    with ui(browser, base, "ines") as page:
        page.get_by_role("navigation", name="Catalogue").get_by_role("button", name="Halftone XL", exact=True).click()
        form = page.get_by_role("form", name=run_form("Halftone XL"))
        see(page, form)
        newest = newest_job_id(base, CAMPAIGNS)
        field = form.get_by_role("textbox", name="Prompt", exact=True)
        form.get_by_role("button", name="Run", exact=True).click()
        eventually(page, lambda: has_focus(field), UI_WAIT_S, "focus on invalid field")
        assert newest_job_id(base, CAMPAIGNS) == newest
        field.fill(prompt)
        with held(page, JOBS_GLOB) as hold:
            form.get_by_role("button", name="Run", exact=True).click()
            see(page, page.get_by_role("button", name="Submitting…"))
            hold.release()
        created = poll(lambda: find_job(base, CAMPAIGNS, prompt), GRACE_S, "fixed submission")
        see_text(page, notices(page), f"Job {created['id']} queued")
    cancel(base, "rafael", created["id"])


def test_wf_playground_run_network_retry(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    prompt = word()
    keys: list[str | None] = []
    lost = {"done": False}

    def flaky(route: Any, request: Any) -> None:
        if request.method != "POST":
            route.continue_()
            return
        keys.append(request.headers.get(KEY_HEADER.lower()))
        if not lost["done"]:
            lost["done"] = True
            route.fetch()
            route.abort("failed")
            return
        route.continue_()

    with ui(browser, base, "ines") as page:
        page.route(JOBS_GLOB, flaky)
        page.get_by_role("navigation", name="Catalogue").get_by_role("button", name="Quill Still", exact=True).click()
        form = page.get_by_role("form", name=run_form("Quill Still"))
        see(page, form)
        form.get_by_role("textbox", name="Prompt", exact=True).fill(prompt)
        form.get_by_role("button", name="Run", exact=True).click()
        eventually(page, lambda: len(keys) >= 2, UI_WAIT_S, "the resend")
        created = poll(lambda: find_job(base, CAMPAIGNS, prompt), GRACE_S, "retried job")
        see_text(page, notices(page), f"Job {created['id']}")
    try:
        assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
        assert [j["id"] for j in team_jobs(base, CAMPAIGNS) if (j.get("input") or {}).get("prompt") == prompt] == [created["id"]]
        assert len([m for m in movements(base, CAMPAIGNS, job_id=created["id"]) if m["kind"] == "reserve"]) == 1
    finally:
        cancel(base, "rafael", created["id"])


UNIT_CASES = {
    "quill-still": ({"style": "photo", "num_images": 3}, "3", "3", "image"),
    "halftone-xl": ({"width": 1536, "height": 1024, "num_images": 4}, "6.291456", "6.291456", "megapixel"),
    "reel-10": ({"duration_seconds": 10}, "10", "10", "video_second"),
    "murmur-voice": ({"voice": "ash", "max_seconds": 30}, "30", "7", "audio_second"),
}


@pytest.mark.parametrize("slug", list(UNIT_CASES), ids=list(UNIT_CASES))
def test_unit_rules(app_url: str, slug: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    extra, estimated, billed, unit = UNIT_CASES[slug]
    inp = dict(extra)
    if slug == "murmur-voice":
        inp["text"] = murmur_text()
    else:
        inp["prompt"] = word()
    rate = current_rate(base, slug)
    created = submitted(base, "mara", slug, inp)
    assert created["rate"]["id"] == rate["id"] and created["rate"]["micro_per_unit"] == rate["micro_per_unit"]
    assert created["unit"] == unit and created["estimated_units"] == estimated
    assert created["reserved_micro"] == charge(estimated, rate["micro_per_unit"])
    done = wait_job(base, created["id"], {"succeeded"})
    assert done["billed_units"] == billed
    assert done["charged_micro"] == charge(billed, rate["micro_per_unit"])


def test_exact_settlement(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    created = submitted(base, "mara", "halftone-xl", halftone(word(), 1536, 1024, 4))
    assert created["rate"]["id"] == HALFTONE_RATE_ID
    assert created["reserved_micro"] == HALFTONE_EXAMPLE_MICRO
    done = wait_job(base, created["id"], {"succeeded"})
    assert done["billed_units"] == "6.291456" and done["charged_micro"] == HALFTONE_EXAMPLE_MICRO
    moved = movements(base, STOREFRONT, job_id=done["id"])
    settles = [m for m in moved if m["kind"] == "settle"]
    assert len(settles) == 1
    assert entries(settles[0]) == {"reserved": -HALFTONE_EXAMPLE_MICRO, "settled": HALFTONE_EXAMPLE_MICRO}
    assert not [m for m in moved if m["kind"] == "release"]


def test_release_unused(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    created = submitted(base, "mara", "murmur-voice", murmur(murmur_text()))
    done = wait_job(base, created["id"], {"succeeded"})
    unused = done["reserved_micro"] - done["charged_micro"]
    assert unused > 0 and done["released_micro"] == unused
    moved = movements(base, STOREFRONT, job_id=done["id"])
    assert sorted(m["kind"] for m in moved) == ["release", "reserve", "settle"]
    release = next(m for m in moved if m["kind"] == "release")
    assert entries(release) == {"reserved": -unused, "available": unused}
    for m in moved:
        assert len(m["entries"]) == 2 and sum(entries(m).values()) == 0


def test_outputs_stored(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    images = submitted(base, "mara", "quill-still", quill(word(), 2))
    voice = submitted(base, "mara", "murmur-voice", murmur(murmur_text()))
    done = wait_job(base, images["id"], {"succeeded"})
    keys = S3().keys(f"outputs/{STOREFRONT}/{done['id']}/")
    assert {output_key(STOREFRONT, done["id"], 1), output_key(STOREFRONT, done["id"], 2)} <= set(keys)
    for n, aid in enumerate(done["outputs"], start=1):
        stored = S3().get(output_key(STOREFRONT, done["id"], n))
        assert png_size(stored) == (1024, 1024)
        meta = data(asset(base, "mara", aid), 200)["asset"]
        assert meta["media_type"] == "image/png" and (meta["width"], meta["height"]) == (1024, 1024)
        assert httpx.get(meta["url"], timeout=HTTP_TIMEOUT).content == stored
        assert fetch_status(unsigned(meta["url"])) != 200
    spoken = wait_job(base, voice["id"], {"succeeded"})
    wav = S3().get(output_key(STOREFRONT, spoken["id"], 1, "wav"))
    assert wav_seconds(wav) == Decimal(spoken["billed_units"])


def test_ribbon_matches_ledger(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    drain(base, STOREFRONT)
    with ui(browser, base, "mara") as page:
        assert_ribbon(page, base, STOREFRONT)
        created = submitted(base, "mara", "reel-10", reel(word(), 10))
        see(page, notch(page, created["id"], notch_units("10", "video_second")), LIVE_UPDATE_S + GRACE_S)
        assert_ribbon(page, base, STOREFRONT)
        wait_job(base, created["id"], {"succeeded"})
        gone(page, notch(page, created["id"], notch_units("10", "video_second")), LIVE_UPDATE_S + GRACE_S)
        assert_ribbon(page, base, STOREFRONT)


def test_wf_metered_pricing_settle(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    prompt = word()
    with ui(browser, base, "ines") as page:
        page.get_by_role("navigation", name="Catalogue").get_by_role("button", name="Halftone XL", exact=True).click()
        form = page.get_by_role("form", name=run_form("Halftone XL"))
        see(page, form)
        form.get_by_role("textbox", name="Prompt", exact=True).fill(prompt)
        select(form.get_by_role("combobox", name="Width"), "1536")
        form.get_by_role("spinbutton", name="Number of images").fill("4")
        form.get_by_role("button", name="Run", exact=True).click()
        created = poll(lambda: find_job(base, CAMPAIGNS, prompt), GRACE_S, "halftone job")
        done = wait_job(base, created["id"], {"succeeded"})
        go(page, "Jobs")
        row = row_for(page.get_by_role("table", name="Jobs"), done["id"])
        see(page, row, LIVE_UPDATE_S + GRACE_S)
        eventually(page, lambda: credits_text(HALFTONE_EXAMPLE_MICRO) in row.inner_text(), LIVE_UPDATE_S + GRACE_S, "settled cost")
        text_row = row.inner_text()
        assert units_text("6.291456", "megapixel") in text_row and rate_text(done["rate"]["micro_per_unit"]) in text_row
    assert done["charged_micro"] == HALFTONE_EXAMPLE_MICRO
    settle_mv = next(m for m in movements(base, CAMPAIGNS, job_id=done["id"]) if m["kind"] == "settle")
    assert entries(settle_mv)["settled"] == HALFTONE_EXAMPLE_MICRO


def test_wf_metered_pricing_release(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    drain(base, CAMPAIGNS)
    script = murmur_text()
    with ui(browser, base, "ines") as page:
        page.get_by_role("navigation", name="Catalogue").get_by_role("button", name="Murmur Voice", exact=True).click()
        form = page.get_by_role("form", name=run_form("Murmur Voice"))
        see(page, form)
        form.get_by_role("textbox", name="Script").fill(script)
        form.get_by_role("button", name="Run", exact=True).click()
        created = poll(lambda: find_job(base, CAMPAIGNS, script), GRACE_S, "murmur job")
        done = wait_job(base, created["id"], {"succeeded"})
        release = [m for m in movements(base, CAMPAIGNS, job_id=done["id"]) if m["kind"] == "release"]
        assert len(release) == 1 and entries(release[0])["available"] == done["reserved_micro"] - done["charged_micro"]
        assert_ribbon(page, base, CAMPAIGNS)


def org_tz(base: str) -> str:
    if policy(base)["timezone"] != ORG_TZ:
        save_policy(base, lambda p: p.update(timezone=ORG_TZ))
    return ORG_TZ


def rate_ids(base: str, slug: str) -> list[dict[str, Any]]:
    return data(call(base, "june", "GET", f"/api/models/{slug}/rates"), 200)["rates"]


def test_rate_schedule_and_withdraw(app_url: str) -> None:
    base = base_of(app_url)
    tz = org_tz(base)
    before = current_rate(base, "quill-still")
    body = {"micro_per_unit": before["micro_per_unit"] + MICRO, "effective_at_local": FAR_FUTURE_LOCAL}
    error_of(call(base, "mara", "POST", rates_path("quill-still"), body=body), 403, "forbidden")
    rate = data(call(base, "june", "POST", rates_path("quill-still"), body=body), 201)["rate"]
    try:
        first = datetime.fromisoformat(FAR_FUTURE_LOCAL).replace(tzinfo=ZoneInfo(tz), fold=0).astimezone(timezone.utc)
        assert iso(rate["effective_at"]) == first
        listed = {r["id"]: r for r in rate_ids(base, "quill-still")}
        assert listed[rate["id"]]["status"] == "scheduled"
        assert listed["r_1"]["status"] in ("past", "current")
        assert current_rate(base, "quill-still")["id"] == before["id"]
    finally:
        expect_status(call(base, "june", "DELETE", rates_path("quill-still", rate["id"])), 204)
    assert rate["id"] not in [r["id"] for r in rate_ids(base, "quill-still") if r["status"] == "scheduled"]
    error_of(call(base, "june", "DELETE", rates_path("quill-still", "r_1")), 409, "rate_already_effective")
    past = error_of(call(base, "june", "POST", rates_path("quill-still"),
                         body={"micro_per_unit": MICRO, "effective_at_local": PAST_LOCAL}), 422, "validation_failed")
    assert past["fields"]["effective_at_local"] == FUTURE_COPY
    gap = error_of(call(base, "june", "POST", rates_path("quill-still"),
                        body={"micro_per_unit": MICRO, "effective_at_local": GAP_LOCAL}), 422, "validation_failed")
    assert gap["fields"]["effective_at_local"] == NOT_EXIST_COPY
    error_of(call(base, "june", "POST", rates_path("quill-still"),
                  body={"micro_per_unit": 0, "effective_at_local": FAR_FUTURE_LOCAL}), 422, "validation_failed")


def test_submission_time_rate(app_url: str) -> None:
    base = base_of(app_url)
    tz = org_tz(base)
    roomy(base, STOREFRONT, concurrency=1)
    drain(base, STOREFRONT)
    try:
        first_guard = submitted(base, "mara", "quill-still", quill(word()))["id"]
        wait_job(base, first_guard, ACTIVE, SLOT_FILL_S + GRACE_S)
        guards = [first_guard] + [submitted(base, "mara", "quill-still", quill(word()), priority="high")["id"]
                                  for _ in range(GUARDS)]
        old = current_rate(base, "quill-still")
        new_micro = old["micro_per_unit"] + MICRO
        local = (server_now(base) + timedelta(seconds=RATE_LEAD_S)).astimezone(ZoneInfo(tz)).strftime(LOCAL_FORMAT)
        scheduled = data(call(base, "june", "POST", rates_path("quill-still"),
                              body={"micro_per_unit": new_micro, "effective_at_local": local}), 201)["rate"]
        early = submitted(base, "mara", "quill-still", quill(word(), 2))
        assert early["status"] == "queued"
        assert early["rate"]["id"] == old["id"] and early["reserved_micro"] == charge("2", old["micro_per_unit"])
        poll(lambda: current_rate(base, "quill-still")["id"] == scheduled["id"], RATE_LEAD_S + GRACE_S, "new rate in effect")
        late = submitted(base, "mara", "quill-still", quill(word(), 2))
        assert late["rate"]["id"] == scheduled["id"] and late["reserved_micro"] == charge("2", new_micro)
        for guard in guards:
            cancel(base, "rafael", guard)
        early_done = wait_job(base, early["id"], {"succeeded"})
        late_done = wait_job(base, late["id"], {"succeeded"})
        assert iso(early_done["finished_at"]) > iso(scheduled["effective_at"])
        assert early_done["rate"]["id"] == old["id"] and early_done["charged_micro"] == charge("2", old["micro_per_unit"])
        assert late_done["charged_micro"] == charge("2", new_micro)
        for done in (early_done, late_done):
            settle_mv = [m for m in movements(base, STOREFRONT, job_id=done["id"]) if m["kind"] == "settle"]
            assert len(settle_mv) == 1 and entries(settle_mv[0]) == {"reserved": -done["charged_micro"], "settled": done["charged_micro"]}
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_wf_rate_change_journey(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    tz = org_tz(base)
    roomy(base, STOREFRONT)
    old = current_rate(base, "reel-10")
    new_micro = old["micro_per_unit"] + MICRO
    target = server_now(base) + timedelta(seconds=MINUTE_LEAD_S + MINUTE_S)
    local = target.astimezone(ZoneInfo(tz)).replace(second=0, microsecond=0)
    shown_local = local.strftime(SHOWN_FORMAT)
    with ui(browser, base, "june") as page:
        go(page, "Finance")
        form = page.get_by_role("form", name="Schedule rate change")
        select(form.get_by_role("combobox", name="Model"), "Reel 10")
        form.get_by_role("textbox", name="New rate (credits per unit)").fill(format(Decimal(new_micro) / MICRO, "f"))
        form.get_by_role("textbox", name="Effective at").fill(shown_local)
        form.get_by_role("button", name="Schedule").click()
        see_text(page, notices(page), "New rate for " + "Reel 10" + f" takes effect {shown_local} {tz}.")
        scheduled = next(r for r in rate_ids(base, "reel-10") if r["status"] == "scheduled" and r["micro_per_unit"] == new_micro)
        before = submitted(base, "mara", "reel-10", reel(word()))
        poll(lambda: current_rate(base, "reel-10")["id"] == scheduled["id"], RATE_WAIT_S, "Reel 10 rate change")
        after = submitted(base, "mara", "reel-10", reel(word()))
        try:
            go(page, "Jobs")
            choose_team(page, STOREFRONT)
            table = page.get_by_role("table", name="Jobs")
            see_text(page, row_for(table, before["id"]), rate_text(old["micro_per_unit"]))
            see_text(page, row_for(table, after["id"]), rate_text(new_micro))
            reserves = {m["job_id"]: entries(m)["reserved"] for m in movements(base, STOREFRONT, kind="reserve")}
            assert reserves[before["id"]] == charge("5", old["micro_per_unit"])
            assert reserves[after["id"]] == charge("5", new_micro)
        finally:
            cancel(base, "rafael", before["id"])
            cancel(base, "rafael", after["id"])


def test_wf_rate_change_invalid_and_withdraw(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    org_tz(base)
    before = rate_ids(base, "quill-still")
    with ui(browser, base, "june") as page:
        go(page, "Finance")
        form = page.get_by_role("form", name="Schedule rate change")
        select(form.get_by_role("combobox", name="Model"), "Quill Still")
        form.get_by_role("textbox", name="New rate (credits per unit)").fill("1,000")
        form.get_by_role("textbox", name="Effective at").fill("2026/11/02 9am")
        form.get_by_role("button", name="Schedule").click()
        see(page, page.get_by_text(RATE_FORMAT_COPY))
        see(page, page.get_by_text(TIME_FORMAT_COPY))
        assert rate_ids(base, "quill-still") == before
        far = data(call(base, "june", "POST", rates_path("quill-still"),
                        body={"micro_per_unit": MICRO, "effective_at_local": FAR_FUTURE_LOCAL}), 201)["rate"]
        page.reload()
        go(page, "Finance")
        select(page.get_by_role("form", name="Schedule rate change").get_by_role("combobox", name="Model"), "Quill Still")
        button = page.get_by_role("table", name="Rate schedule").get_by_role("button", name=f"Withdraw rate {far['id']}")
        see(page, button)
        button.click()
        see_text(page, notices(page), f"Scheduled rate {far['id']} withdrawn.")
    assert far["id"] not in [r["id"] for r in rate_ids(base, "quill-still") if r["status"] == "scheduled"]


def test_register_endpoint(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    clear_endpoints(base, STOREFRONT)
    with Sink() as sink:
        for url in (template.format(port=sink.port) for template in REFUSED_HOOKS):
            err = error_of(call(base, "mara", "POST", "/api/webhook-endpoints", body={"url": url}), 422, "validation_failed")
            assert err["fields"]["url"] == REFUSED_COPY
        assert sink.records == []
        error_of(call(base, "june", "POST", "/api/webhook-endpoints", body={"url": sink.url("x")}), 403, "forbidden")
        made = [data(call(base, "mara", "POST", "/api/webhook-endpoints", body={"url": sink.url(f"{word()}{n}")}), 201)["endpoint"]
                for n in range(ENDPOINT_LIMIT)]
        try:
            first = made[0]
            assert re.fullmatch(SECRET_RE, first["secret"])
            assert first["state"] == "active" and first["consecutive_failures"] == 0 and first["team_id"] == STOREFRONT
            listed = data(call(base, "mara", "GET", "/api/webhook-endpoints", params={"team": STOREFRONT}), 200)["endpoints"]
            assert first["id"] in [e["id"] for e in listed] and all("secret" not in e for e in listed)
            error_of(call(base, "mara", "POST", "/api/webhook-endpoints", body={"url": sink.url("sixth")}), 409, "endpoint_limit_reached")
            error_of(call(base, "ines", "DELETE", f"/api/webhook-endpoints/{first['id']}"), 404, "not_found")
        finally:
            clear_endpoints(base, STOREFRONT)


def test_signed_events(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    drain(base, STOREFRONT)
    clear_endpoints(base, STOREFRONT)
    set_team(base, STOREFRONT, payload_visibility="restricted")
    try:
        with Sink() as mara_sink, Sink() as theo_sink:
            mine = data(call(base, "mara", "POST", "/api/webhook-endpoints", body={"url": mara_sink.url(word())}), 201)["endpoint"]
            theirs = data(call(base, "theo", "POST", "/api/webhook-endpoints", body={"url": theo_sink.url(word())}), 201)["endpoint"]
            done = submitted(base, "mara", "quill-still", quill(word()))
            stopped = submitted(base, "mara", "quill-still", quill(word()))
            expect_status(cancel(base, "mara", stopped["id"]), 200)
            wait_job(base, done["id"], {"succeeded"})
            for sink, endpoint, visible in ((mara_sink, mine, True), (theo_sink, theirs, False)):
                poll(lambda s=sink: len(s.posts()) >= 2, GRACE_S, "two events")

                def delivered(e: dict[str, Any] = endpoint) -> list[dict[str, Any]] | None:
                    got = [d for d in deliveries(base, e["id"]) if d["outcome"] == "delivered"]
                    return got if len(got) >= 2 else None

                logged = poll(delivered, GRACE_S, "delivery log")
                assert all(d["attempt"] == 1 for d in logged)
                events = [verify_signature(r, endpoint["secret"]) for r in sink.posts()]
                by_job = {e["data"]["job"]["id"]: e for e in events}
                assert len(events) == 2 and set(by_job) == {done["id"], stopped["id"]}
                assert by_job[done["id"]]["type"] == "job.succeeded"
                assert by_job[stopped["id"]]["type"] == "job.cancelled"
                for e in events:
                    projected = e["data"]["job"]
                    assert projected["payload_visible"] is visible
                    assert set(projected) == (FULL_JOB_KEYS if visible else RESTRICTED_JOB_KEYS)
    finally:
        clear_endpoints(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_delivery_retries() -> None:
    fast = instance("APP_FAST_URL")
    roomy(fast, STOREFRONT)
    drain(fast, STOREFRONT)
    clear_endpoints(fast, STOREFRONT)
    with Sink(plan=(SINK_FAIL, SINK_FAIL), default=200) as sink:
        endpoint = data(call(fast, "mara", "POST", "/api/webhook-endpoints", body={"url": sink.url(word())}), 201)["endpoint"]
        try:
            submitted(fast, "mara", "quill-still", quill(word()))
            poll(lambda: len(sink.posts()) >= 3, JOB_DONE_S, "three attempts")
            first, second, third = sink.posts()[:3]
            assert first["body"] == second["body"] == third["body"]
            for r in (first, second, third):
                verify_signature(r, endpoint["secret"])
            gap1, gap2 = second["at"] - first["at"], third["at"] - second["at"]
            assert FAST_RETRY_BASE_S - EARLY_TOLERANCE_S <= gap1 <= FAST_RETRY_BASE_S + RETRY_TOLERANCE_S
            assert 2 * FAST_RETRY_BASE_S - EARLY_TOLERANCE_S <= gap2 <= 2 * FAST_RETRY_BASE_S + RETRY_TOLERANCE_S
            log = poll(lambda: (d if len(d := deliveries(fast, endpoint["id"])) >= 3 else None), GRACE_S, "delivery log")
            ordered = sorted(log, key=lambda d: d["attempt"])
            assert [d["outcome"] for d in ordered[:3]] == ["failed", "failed", "delivered"]
            assert len({d["event_id"] for d in ordered}) == 1 and ordered[2]["next_attempt_at"] is None
            state = endpoint_state(fast, STOREFRONT, endpoint["id"])
            assert state["state"] == "active" and state["consecutive_failures"] == 0
            assert len(sink.posts()) == 3
        finally:
            clear_endpoints(fast, STOREFRONT)


def test_delivery_order() -> None:
    fast = instance("APP_FAST_URL")
    roomy(fast, STOREFRONT)
    drain(fast, STOREFRONT)
    clear_endpoints(fast, STOREFRONT)
    with Sink(plan=(SINK_FAIL,) * ORDER_FAILS, default=200) as sink:
        data(call(fast, "mara", "POST", "/api/webhook-endpoints", body={"url": sink.url(word())}), 201)
        try:
            first = wait_job(fast, submitted(fast, "mara", "quill-still", quill(word()))["id"], {"succeeded"})["id"]
            poll(lambda: sink.posts(), JOB_DONE_S, "first attempt")
            later = [wait_job(fast, submitted(fast, "mara", "quill-still", quill(word()))["id"], {"succeeded"})["id"]
                     for _ in range(2)]
            expected = [first] * (ORDER_FAILS + 1) + later

            def jobs_sent() -> list[str] | None:
                sent = [json.loads(r["body"])["data"]["job"]["id"] for r in sink.posts()]
                return sent if len(sent) >= len(expected) else None

            assert poll(jobs_sent, JOB_DONE_S, "every attempt") == expected
        finally:
            clear_endpoints(fast, STOREFRONT)


def test_endpoint_disable_and_reenable(mail: Any) -> None:
    fast = instance("APP_FAST_URL")
    roomy(fast, STOREFRONT)
    drain(fast, STOREFRONT)
    clear_endpoints(fast, STOREFRONT)
    with Sink(default=SINK_FAIL) as sink:
        url = sink.url(word())
        endpoint = data(call(fast, "mara", "POST", "/api/webhook-endpoints", body={"url": url}), 201)["endpoint"]
        try:
            submitted(fast, "mara", "quill-still", quill(word()))
            poll(lambda: endpoint_state(fast, STOREFRONT, endpoint["id"])["state"] == "disabled", JOB_DONE_S + GRACE_S, "disable")
            assert len(sink.posts()) == 1 + WEBHOOK_RETRIES == DISABLE_AT
            assert endpoint_state(fast, STOREFRONT, endpoint["id"])["consecutive_failures"] == DISABLE_AT
            subject = f"Webhook endpoint disabled: {TEAM_NAMES[STOREFRONT]}"
            found = poll(lambda: [m for m in with_subject(mail, subject, quick=True) if url in mail_text(m)], GRACE_S, "disable email")
            assert len(found) == 1
            assert set(addresses(found[0][MAIL_TO])) == {EMAILS["rafael"]}
            assert str(SINK_FAIL) in mail_text(found[0]) and endpoint["secret"] not in mail_text(found[0])
            skipped = wait_job(fast, submitted(fast, "mara", "quill-still", quill(word()))["id"], {"succeeded"})
            poll(lambda: any(d["job_id"] == skipped["id"] and d["outcome"] == "skipped_disabled" for d in deliveries(fast, endpoint["id"])),
                 GRACE_S, "skipped delivery")
            assert len(sink.posts()) == DISABLE_AT
            error_of(call(fast, "mara", "POST", f"/api/webhook-endpoints/{endpoint['id']}/enable"), 403, "forbidden")
            error_of(call(fast, "june", "POST", f"/api/webhook-endpoints/{endpoint['id']}/enable"), 403, "forbidden")
            back = data(call(fast, "rafael", "POST", f"/api/webhook-endpoints/{endpoint['id']}/enable"), 200)["endpoint"]
            assert back["state"] == "active" and back["consecutive_failures"] == 0
            error_of(call(fast, "rafael", "POST", f"/api/webhook-endpoints/{endpoint['id']}/enable"), 409, "endpoint_not_disabled")
            sink.default = 200
            later = submitted(fast, "mara", "quill-still", quill(word()))
            poll(lambda: any(json.loads(r["body"])["data"]["job"]["id"] == later["id"] for r in sink.posts()), JOB_DONE_S, "next event")
            assert not any(json.loads(r["body"])["data"]["job"]["id"] == skipped["id"] for r in sink.posts())
        finally:
            clear_endpoints(fast, STOREFRONT)


def test_wf_webhooks_journey(browser: Any) -> None:
    fast = instance("APP_FAST_URL")
    roomy(fast, STOREFRONT)
    drain(fast, STOREFRONT)
    clear_endpoints(fast, STOREFRONT)
    with Sink() as sink:
        url = sink.url(word())
        try:
            with ui(browser, fast, "mara") as page:
                page.context.grant_permissions(CLIPBOARD)
                go(page, "Webhooks")
                form = page.get_by_role("form", name="Add endpoint")
                form.get_by_role("textbox", name="Endpoint URL").fill(url)
                form.get_by_role("button", name="Add endpoint").click()
                dialog = page.get_by_role("dialog", name="Signing secret")
                see(page, dialog)
                dialog.get_by_role("button", name="Copy secret").click()
                secret = page.evaluate(READ_CLIPBOARD)
                assert re.fullmatch(SECRET_RE, secret)
                dialog.get_by_role("button", name="Done").click()
                table = page.get_by_role("table", name="Endpoints")
                see_text(page, row_for(table, url), "Active")
                first = submitted(fast, "mara", "quill-still", quill(word()))
                poll(lambda: sink.posts(), JOB_DONE_S, "first delivery")
                verify_signature(sink.posts()[0], secret)
                table.get_by_role("button", name=f"Deliveries for {url}").click()
                log = page.get_by_role("table", name="Deliveries")
                eventually(page, lambda: log.get_by_role("cell").count() > 0, UI_WAIT_S, "a row in the delivery log")
                sink.default = SINK_FAIL
                submitted(fast, "mara", "quill-still", quill(word()))
                eid = data(call(fast, "mara", "GET", "/api/webhook-endpoints", params={"team": STOREFRONT}), 200)["endpoints"][0]["id"]
                poll(lambda: endpoint_state(fast, STOREFRONT, eid)["state"] == "disabled", JOB_DONE_S + GRACE_S, "disable")
                page.reload()
                go(page, "Webhooks")
                see_text(page, row_for(page.get_by_role("table", name="Endpoints"), url), "Disabled")
            with ui(browser, fast, "rafael") as admin:
                go(admin, "Webhooks")
                button = admin.get_by_role("table", name="Endpoints").get_by_role("button", name=f"Re-enable {url}")
                team_box = admin.get_by_role("combobox", name="Team", exact=True)
                eventually(admin, lambda: (button.count() > 0 and button.first.is_visible())
                           or (team_box.count() > 0 and team_box.first.is_visible()),
                           UI_WAIT_S, "the Storefront endpoint or a Team selector")
                if not (button.count() > 0 and button.first.is_visible()):
                    choose_team(admin, STOREFRONT)
                see(admin, button)
                button.click()
                see_text(admin, notices(admin), "Endpoint re-enabled.")
            assert endpoint_state(fast, STOREFRONT, eid)["state"] == "active"
            sink.default = 200
            seen = len(sink.posts())
            later = submitted(fast, "mara", "quill-still", quill(word()))
            poll(lambda: any(json.loads(r["body"])["data"]["job"]["id"] == later["id"] for r in sink.posts()[seen:]), JOB_DONE_S, "post re-enable delivery")
            verify_signature(sink.posts()[-1], secret)
        finally:
            clear_endpoints(fast, STOREFRONT)


def test_wf_webhooks_refused_address(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    refused = "http://127.0.0.1/hook"
    with ui(browser, base, "mara") as page:
        go(page, "Webhooks")
        form = page.get_by_role("form", name="Add endpoint")
        form.get_by_role("textbox", name="Endpoint URL").fill(refused)
        form.get_by_role("button", name="Add endpoint").click()
        see(page, page.get_by_text(REFUSED_COPY).first)
    listed = data(call(base, "mara", "GET", "/api/webhook-endpoints", params={"team": STOREFRONT}), 200)["endpoints"]
    assert refused not in [e["url"] for e in listed]


def purchase_ok(payment: dict[str, Any], amount: str) -> bool:
    return any(t.get("transactionType") == "PURCHASE" and t.get("status") == "SUCCESS" and Decimal(str(t.get("amount"))) == Decimal(amount)
               for t in payment.get("transactions", []))


def kb_invoice_call(method: str, path: str) -> bool:
    lowered = path.lower()
    return method == "POST" and "invoice" in lowered and "payment" not in lowered


def kb_payment_call(method: str, path: str) -> bool:
    lowered = path.lower()
    return method == "POST" and "payment" in lowered and "paymentmethod" not in lowered


def kb_invoices_for(killbill: Any, account_id: str, topup_id: str) -> list[dict[str, Any]]:
    response = killbill.client.get(f"/accounts/{account_id}/invoices", params={"includeInvoiceComponents": "true"})
    assert response.status_code == 200, response.text
    return [i for i in response.json()
            if any(item.get("description") == f"Dispatch credits {topup_id}" for item in i.get("items") or [])]


def kb_invoice_payments(killbill: Any, invoice_id: str) -> list[dict[str, Any]]:
    response = killbill.client.get(f"/invoices/{invoice_id}/payments")
    assert response.status_code == 200, response.text
    return response.json()


def test_topup_through_killbill(app_url: str, killbill: Any) -> None:
    base = base_of(app_url)
    account = killbill.account_by_key(CAMPAIGNS)
    before = len(kb_payment_ids(killbill, account))
    for bad in (150, 50, 100_100):
        error_of(call(base, "june", "POST", "/api/topups", body={"team_id": CAMPAIGNS, "credits": bad}), 422, "validation_failed")
    error_of(call(base, "mara", "POST", "/api/topups", body={"team_id": CAMPAIGNS, "credits": TOPUP_MIN}), 403, "forbidden")
    error_of(call(base, "rafael", "POST", "/api/topups", body={"team_id": CAMPAIGNS, "credits": TOPUP_MIN}), 403, "forbidden")
    account = killbill.account_by_key(CAMPAIGNS)
    assert len(kb_payment_ids(killbill, account)) == before
    topup = data(call(base, "june", "POST", "/api/topups", body={"team_id": CAMPAIGNS, "credits": TOPUP_MIN}), 201)["topup"]
    assert topup["status"] == "paid" and topup["amount_usd"] == usd(TOPUP_MIN) and topup["paid_at"]
    account = killbill.account_by_key(CAMPAIGNS)
    assert account[KB_ACCOUNT_ID] == topup["kb_account_id"] and account["currency"] == "USD" and account["name"] == TEAM_NAMES[CAMPAIGNS]
    payments = killbill.payments(account[KB_ACCOUNT_ID])
    assert len(payments) == before + 1
    paid = next(p for p in payments if p[KB_PAYMENT_ID] == topup["kb_payment_id"])
    assert purchase_ok(paid, topup["amount_usd"])
    moved = movements(base, CAMPAIGNS, topup_id=topup["id"])
    assert len(moved) == 1 and moved[0]["kind"] == "top_up" and moved[0]["kb_invoice_id"] == topup["kb_invoice_id"]
    assert entries(moved[0]) == {"funding": -TOPUP_MIN * MICRO, "available": TOPUP_MIN * MICRO}


def test_ledger_pairs(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    done = wait_job(base, submitted(base, "mara", "murmur-voice", murmur(murmur_text()))["id"], {"succeeded"})
    stopped = submitted(base, "mara", "quill-still", quill(word()))
    cancel(base, "mara", stopped["id"])
    kinds = {m["kind"] for m in movements(base, STOREFRONT) if m["job_id"] in (done["id"], stopped["id"])}
    assert kinds == {"reserve", "settle", "release"}
    for team in (STOREFRONT, CAMPAIGNS):
        book = ledger(base, team)
        sums: dict[str, int] = {}
        for m in book["movements"]:
            minus, plus = MOVEMENT_FLOW[m["kind"]]
            pair = entries(m)
            assert len(m["entries"]) == 2 and set(pair) == {minus, plus}
            assert pair[minus] < 0 < pair[plus] and pair[minus] + pair[plus] == 0
            for account_name, amount in pair.items():
                sums[account_name] = sums.get(account_name, 0) + amount
        grants = [m for m in book["movements"] if m["kind"] == "opening_grant"]
        assert len(grants) == 1 and entries(grants[0])["available"] == OPENING_GRANT[team]
        bal = book["balances"]
        for account_name in ("available", "reserved", "settled"):
            assert bal[f"{account_name}_micro"] == sums.get(account_name, 0)
        assert bal["granted_micro"] == -sums["funding"] == bal["available_micro"] + bal["reserved_micro"] + bal["settled_micro"]


def test_topup_billing_outage(app_url: str, killbill: Any) -> None:
    base = base_of(app_url)
    for team in (STOREFRONT, CAMPAIGNS):
        if killbill.account_by_key(team) is None:
            data(call(base, "june", "POST", "/api/topups", body={"team_id": team, "credits": TOPUP_MIN}), 201)
    down = instance("APP_KILLBILL_DOWN_URL")
    poll(lambda: system(down)["billing"] == "down", STATUS_CHECK_S + GRACE_S, "billing down")
    available = meter(down, STOREFRONT)["available_micro"]
    topup = data(call(down, "june", "POST", "/api/topups", body={"team_id": STOREFRONT, "credits": TOPUP_MIN}), 202)["topup"]
    assert topup["status"] == "pending" and topup["pending_reason"] == "billing_unavailable"
    assert not movements(down, STOREFRONT, topup_id=topup["id"])
    assert meter(down, STOREFRONT)["available_micro"] == available
    account = killbill.account_by_key(STOREFRONT)
    before = set(kb_payment_ids(killbill, account))
    with Relay(OUTAGE_PORT, env_url("KILLBILL_URL")):
        def paid() -> dict[str, Any] | None:
            listed = data(call(down, "june", "GET", "/api/topups", params={"team": STOREFRONT}), 200)["topups"]
            mine = next(t for t in listed if t["id"] == topup["id"])
            return mine if mine["status"] != "pending" else None
        final = poll(paid, TOPUP_RETRY_S + STATUS_CHECK_S + GRACE_S, "pending top-up to complete")
    moved = movements(down, STOREFRONT, topup_id=topup["id"])
    account = killbill.account_by_key(STOREFRONT)
    new = [p for p in kb_payment_ids(killbill, account) if p not in before]
    if final["status"] == "paid":
        assert final["kb_invoice_id"]
        assert len(moved) == 1 and moved[0]["kb_invoice_id"] == final["kb_invoice_id"]
        assert entries(moved[0]) == {"funding": -TOPUP_MIN * MICRO, "available": TOPUP_MIN * MICRO}
        assert new == [final["kb_payment_id"]]
    else:
        assert final["status"] == "failed" and final["failure_reason"] == "billing_rejected"
        assert not moved and new == []
        assert meter(down, STOREFRONT)["available_micro"] == available


def test_receipt_after_outage(app_url: str, killbill: Any, mail: Any) -> None:
    base = base_of(app_url)
    if killbill.account_by_key(STOREFRONT) is None:
        data(call(base, "june", "POST", "/api/topups", body={"team_id": STOREFRONT, "credits": TOPUP_MIN}), 201)
    down = instance("APP_KILLBILL_DOWN_URL")
    poll(lambda: system(down)["billing"] == "down", STATUS_CHECK_S + GRACE_S, "billing down")
    credits = 3 * TOPUP_MIN
    topup = data(call(down, "june", "POST", "/api/topups", body={"team_id": STOREFRONT, "credits": credits}), 202)["topup"]
    with Relay(OUTAGE_PORT, env_url("KILLBILL_URL")):
        def settled() -> dict[str, Any] | None:
            listed = data(call(down, "june", "GET", "/api/topups", params={"team": STOREFRONT}), 200)["topups"]
            mine = next(t for t in listed if t["id"] == topup["id"])
            return mine if mine["status"] != "pending" else None
        final = poll(settled, TOPUP_RETRY_S + STATUS_CHECK_S + GRACE_S, "pending top-up to complete")
    assert final["status"] == "paid", final
    subject = f"Top-up receipt: {whole_credits(credits)} credits for {TEAM_NAMES[STOREFRONT]}"
    poll(lambda: [m for m in with_subject(mail, subject, quick=True) if final["kb_invoice_id"] in mail_text(m)],
         GRACE_S, "receipt")
    found = [m for m in with_subject(mail, subject, expected=1) if final["kb_invoice_id"] in mail_text(m)]
    assert len(found) == 1
    assert addresses(found[0][MAIL_TO]) == [EMAILS["june"]]


def test_topup_unanswered_call(app_url: str, killbill: Any) -> None:
    base = base_of(app_url)
    if killbill.account_by_key(STOREFRONT) is None:
        data(call(base, "june", "POST", "/api/topups", body={"team_id": STOREFRONT, "credits": TOPUP_MIN}), 201)
    account = killbill.account_by_key(STOREFRONT)[KB_ACCOUNT_ID]
    down = instance("APP_KILLBILL_DOWN_URL")
    for pick in (kb_invoice_call, kb_payment_call):
        available = meter(down, STOREFRONT)["available_micro"]
        with Proxy(OUTAGE_PORT, env_url("KILLBILL_URL"), pick, KB_HOLD_S) as proxy:
            poll(lambda: system(down)["billing"] == "up", STATUS_CHECK_S + GRACE_S, "billing up")
            sent = call(down, "june", "POST", "/api/topups", body={"team_id": STOREFRONT, "credits": TOPUP_MIN})
            assert sent.status_code in (201, 202), f"{sent.status_code} {sent.text[:300]}"
            topup = sent.json()["topup"]

            def settled() -> dict[str, Any] | None:
                listed = data(call(down, "june", "GET", "/api/topups", params={"team": STOREFRONT}), 200)["topups"]
                mine = next(t for t in listed if t["id"] == topup["id"])
                return mine if mine["status"] != "pending" else None

            final = poll(settled, KB_HOLD_S + 3 * TOPUP_RETRY_S + GRACE_S, f"top-up after a withheld {pick.__name__}")
            assert proxy.withheld, f"no {pick.__name__} reached Kill Bill through the outage port"
        assert final["status"] == "paid", final
        invoices = kb_invoices_for(killbill, account, topup["id"])
        assert [i["invoiceId"] for i in invoices] == [final["kb_invoice_id"]]
        assert Decimal(str(invoices[0]["balance"])) == 0
        paid = [p for p in kb_invoice_payments(killbill, final["kb_invoice_id"]) if purchase_ok(p, final["amount_usd"])]
        assert [p[KB_PAYMENT_ID] for p in paid] == [final["kb_payment_id"]]
        moved = movements(down, STOREFRONT, topup_id=topup["id"])
        assert len(moved) == 1 and moved[0]["kind"] == "top_up" and moved[0]["kb_invoice_id"] == final["kb_invoice_id"]
        assert entries(moved[0]) == {"funding": -TOPUP_MIN * MICRO, "available": TOPUP_MIN * MICRO}
        assert meter(down, STOREFRONT)["available_micro"] == available + TOPUP_MIN * MICRO


def test_topup_declined(browser: Any, killbill: Any) -> None:
    down = instance("APP_KILLBILL_DOWN_URL")
    with Proxy(OUTAGE_PORT, env_url("KILLBILL_URL"), kb_invoice_call, refuse=400) as proxy:
        poll(lambda: system(down)["billing"] == "up", STATUS_CHECK_S + GRACE_S, "billing up")
        available = meter(down, CAMPAIGNS)["available_micro"]
        known = {t["id"] for t in data(call(down, "june", "GET", "/api/topups", params={"team": CAMPAIGNS}), 200)["topups"]}
        with ui(browser, down, "june") as page:
            go(page, "Finance")
            choose_team(page, CAMPAIGNS)
            form = page.get_by_role("form", name="Top up credits")
            form.get_by_role("spinbutton", name="Credits").fill(str(TOPUP_MIN))
            form.get_by_role("button", name="Top up").click()
            see_alert(page, DECLINED_COPY)
        assert proxy.refused
    listed = data(call(down, "june", "GET", "/api/topups", params={"team": CAMPAIGNS}), 200)["topups"]
    fresh = [t for t in listed if t["id"] not in known]
    assert len(fresh) == 1 and fresh[0]["credits"] == TOPUP_MIN
    topup = fresh[0]
    assert topup["status"] == "failed" and topup["failure_reason"] == "billing_rejected"
    assert not movements(down, CAMPAIGNS, topup_id=topup["id"])
    assert meter(down, CAMPAIGNS)["available_micro"] == available
    account = killbill.account_by_key(CAMPAIGNS)
    assert account is None or not kb_invoices_for(killbill, account[KB_ACCOUNT_ID], topup["id"])


def test_topup_receipt(app_url: str, mail: Any) -> None:
    base = base_of(app_url)
    credits = 2 * TOPUP_MIN
    topup = data(call(base, "june", "POST", "/api/topups", body={"team_id": STOREFRONT, "credits": credits}), 201)["topup"]
    subject = f"Top-up receipt: {whole_credits(credits)} credits for {TEAM_NAMES[STOREFRONT]}"
    poll(lambda: [m for m in with_subject(mail, subject, quick=True) if topup["kb_invoice_id"] in mail_text(m)],
         GRACE_S, "receipt")
    found = [m for m in with_subject(mail, subject, expected=1) if topup["kb_invoice_id"] in mail_text(m)]
    assert len(found) == 1
    assert addresses(found[0][MAIL_TO]) == [EMAILS["june"]]
    assert MAIL_SENDER in addresses(found[0][MAIL_FROM_FIELD])
    assert topup["amount_usd"] == usd(credits) and topup["amount_usd"] in mail_text(found[0])


def test_wf_topups_reconcile(app_url: str, browser: Any, killbill: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    drain(base, CAMPAIGNS)
    with ui(browser, base, "june") as page:
        go(page, "Finance")
        choose_team(page, CAMPAIGNS)
        form = page.get_by_role("form", name="Top up credits")
        known = {t["id"] for t in data(call(base, "june", "GET", "/api/topups", params={"team": CAMPAIGNS}), 200)["topups"]}
        form.get_by_role("spinbutton", name="Credits").fill(str(JOURNEY_TOPUP))
        form.get_by_role("button", name="Top up").click()
        see_text(page, notices(page), f"Added {whole_credits(JOURNEY_TOPUP)} credits to {TEAM_NAMES[CAMPAIGNS]}.")
        listed = data(call(base, "june", "GET", "/api/topups", params={"team": CAMPAIGNS}), 200)["topups"]
        fresh = [t for t in listed if t["id"] not in known]
        assert len(fresh) == 1 and fresh[0]["credits"] == JOURNEY_TOPUP
        topup = fresh[0]
        assert topup["status"] == "paid" and topup["team_id"] == CAMPAIGNS
        see_text(page, row_for(page.get_by_role("table", name="Top-ups"), topup["kb_invoice_id"]), "Paid")
        see(page, row_for(page.get_by_role("table", name="Ledger"), topup["kb_invoice_id"]))
        with page.expect_download() as info:
            page.get_by_role("link", name="Export ledger CSV").click()
        rows = list(csv.DictReader(io.StringIO(Path(info.value.path()).read_text(encoding=ENCODING))))
        assert list(rows[0]) == LEDGER_CSV_COLUMNS
        sums: dict[str, int] = {}
        for row in rows:
            sums[row["account"]] = sums.get(row["account"], 0) + int(row["amount_micro"])
        shown = meter(base, CAMPAIGNS)
        region = page.get_by_role("region", name="Credit meter")
        for name, key in METER_SEGMENTS:
            account_name = key.removesuffix("_micro")
            assert sums.get(account_name, 0) == shown[key]
            see_text(page, region, f"{name} {credits_text(sums.get(account_name, 0))}")
        assert -sums["funding"] == shown["granted_micro"]
    account = killbill.account_by_key(CAMPAIGNS)
    assert topup["kb_payment_id"] in kb_payment_ids(killbill, account)


def test_wf_topups_billing_down(browser: Any) -> None:
    down = instance("APP_KILLBILL_DOWN_URL")
    available = meter(down, CAMPAIGNS)["available_micro"]
    with ui(browser, down, "june") as page:
        go(page, "Finance")
        choose_team(page, CAMPAIGNS)
        form = page.get_by_role("form", name="Top up credits")
        form.get_by_role("spinbutton", name="Credits").fill(str(TOPUP_MIN))
        form.get_by_role("button", name="Top up").click()
        copy = f"Billing is unreachable. Your top-up of {TOPUP_MIN} credits is pending; no credits have been added yet."
        eventually(page, lambda: any(squash(copy) in squash(region.inner_text(timeout=UI_TIMEOUT_MS))
                                     for region in (*notices(page).all(), *page.get_by_role("alert").all())),
                   UI_WAIT_S, f"text {copy!r} in Notices or an alert")
        listed = data(call(down, "june", "GET", "/api/topups", params={"team": CAMPAIGNS}), 200)["topups"]
        pending = next(t for t in listed if t["credits"] == TOPUP_MIN and t["status"] == "pending")
        assert pending["pending_reason"] == "billing_unavailable"
        see(page, page.get_by_role("table", name="Top-ups").get_by_text("Pending").first)
    assert not movements(down, CAMPAIGNS, topup_id=pending["id"])
    assert meter(down, CAMPAIGNS)["available_micro"] == available


def test_storage_outage_queue() -> None:
    down = instance("APP_STORAGE_DOWN_URL")
    poll(lambda: system(down)["storage"] == "down", STATUS_CHECK_S + GRACE_S, "storage down")
    drain(down, STOREFRONT)
    created = submitted(down, "mara", "quill-still", quill(word()))
    waiting = job(down, "mara", created["id"])
    assert waiting["status"] == "queued" and waiting["waiting_reason"] == "storage_unavailable" and waiting["queue_position"] == 1
    reserve = [m for m in movements(down, STOREFRONT, job_id=created["id"]) if m["kind"] == "reserve"]
    assert len(reserve) == 1 and entries(reserve[0]) == {"available": -created["reserved_micro"], "reserved": created["reserved_micro"]}
    assert meter(down, STOREFRONT)["reserved_micro"] == ledger(down, STOREFRONT)["balances"]["reserved_micro"]
    error_of(upload(down, "mara", png()), 503, "storage_unavailable")
    with Sink(routes={IMG_PATH: (200, {"Content-Type": "image/png"}, png())}) as sink:
        newest = newest_job_id(down, STOREFRONT)
        error_of(submit(down, "mara", "reel-10", reel(word(), start=sink.url(IMG_PATH))), 503, "storage_unavailable")
        assert newest_job_id(down, STOREFRONT) == newest
    with Relay(OUTAGE_PORT, env_url("S3_ENDPOINT")):
        done = wait_job(down, created["id"], {"succeeded"}, RESUME_S + JOB_DONE_S)
        assert done["waiting_reason"] is None and done["outputs"]


def test_service_status_notice(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    down = instance("APP_STORAGE_DOWN_URL")
    with ui(browser, down, "mara") as page:
        region = page.get_by_role("region", name="Service status")
        for screen in ("Run", "Jobs", "Library", "Webhooks"):
            go(page, screen)
            see_text(page, region, STORAGE_NOTICE, NOTICE_S + GRACE_S)
        with Relay(OUTAGE_PORT, env_url("S3_ENDPOINT")):
            eventually(page, lambda: region.count() == 0 or STORAGE_NOTICE not in squash(region.inner_text()),
                       NOTICE_S + GRACE_S, "notice removed")
    with ui(browser, instance("APP_KILLBILL_DOWN_URL"), "june") as page:
        see_text(page, page.get_by_role("region", name="Service status"), BILLING_NOTICE, NOTICE_S + GRACE_S)
    with ui(browser, base, "mara") as page:
        advance(page, NOTICE_S * 1000)
        region = page.get_by_role("region", name="Service status")
        shown = squash(region.inner_text()) if region.count() else ""
        assert STORAGE_NOTICE not in shown and BILLING_NOTICE not in shown


def test_boot_with_dependencies_down() -> None:
    for env, service in (("APP_STORAGE_DOWN_URL", "storage"), ("APP_KILLBILL_DOWN_URL", "billing")):
        url = instance(env)
        health = httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT)
        assert health.status_code == 200 and health.json() == {"status": "ok"}
        shell = httpx.get(url + "/", timeout=HTTP_TIMEOUT)
        assert shell.status_code == 200 and shell.text
        with session_client(url, "mara") as client:
            assert client.get("/api/me").json()["member"]["id"] == "m_mara"
        poll(lambda: system(url)[service] == "down", STATUS_CHECK_S + GRACE_S, f"{service} reported down")


def test_wf_storage_outage_waiting(browser: Any) -> None:
    down = instance("APP_STORAGE_DOWN_URL")
    drain(down, CAMPAIGNS)
    prompt = word()
    with ui(browser, down, "ines") as page:
        page.get_by_role("navigation", name="Catalogue").get_by_role("button", name="Quill Still", exact=True).click()
        form = page.get_by_role("form", name=run_form("Quill Still"))
        see(page, form)
        form.get_by_role("textbox", name="Prompt", exact=True).fill(prompt)
        form.get_by_role("button", name="Run", exact=True).click()
        created = poll(lambda: find_job(down, CAMPAIGNS, prompt), GRACE_S, "outage job")
        see_text(page, page.get_by_role("list", name=lane_name("Quill Still")), WAITING_COPY)
        page.get_by_role("navigation", name="Catalogue").get_by_role("button", name="Reel 10", exact=True).click()
        with page.expect_file_chooser() as chooser:
            page.get_by_role("button", name=upload_button("Start frame")).click()
        chooser.value.set_files(png_file(OUTAGE_FILE))
        see(page, page.get_by_text("Storage is unreachable. Try the upload again when it returns.").first)
    assert job(down, "ines", created["id"])["waiting_reason"] == "storage_unavailable"
    drain(down, CAMPAIGNS)


def test_wf_storage_outage_recover(browser: Any) -> None:
    down = instance("APP_STORAGE_DOWN_URL")
    poll(lambda: system(down)["storage"] == "down", STATUS_CHECK_S + GRACE_S, "storage down")
    drain(down, STOREFRONT)
    created = submitted(down, "mara", "quill-still", quill(word()))
    with ui(browser, down, "mara") as page:
        lane = page.get_by_role("list", name=lane_name("Quill Still"))
        see_text(page, lane, WAITING_COPY)
        with Relay(OUTAGE_PORT, env_url("S3_ENDPOINT")):
            wait_job(down, created["id"], {"succeeded"}, RESUME_S + JOB_DONE_S)
            eventually(page, lambda: created["id"] not in lane.inner_text(), LIVE_UPDATE_S + GRACE_S, "lane cleared")


ACCESS_CASES = {
    "team-setting": {"org": ("allowed", "allowed"), "defaults": ("blocked", "inherit"), "team": ("allowed", "blocked"), "resolved": ("allowed", "blocked")},
    "team-default": {"org": ("allowed", "allowed"), "defaults": ("blocked", "inherit"), "team": ("inherit", "inherit"), "resolved": ("blocked", "allowed")},
    "org-setting": {"org": ("blocked", "allowed"), "defaults": ("inherit", "inherit"), "team": ("inherit", "inherit"), "resolved": ("blocked", "allowed")},
}


@pytest.mark.parametrize("case", list(ACCESS_CASES), ids=list(ACCESS_CASES))
def test_model_access_resolution(app_url: str, case: str) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    spec = ACCESS_CASES[case]

    def mutate(p: dict[str, Any]) -> None:
        p["org_model_access"]["quill-still"] = {"api": spec["org"][0], "playground": spec["org"][1]}
        t = team_policy(p, CAMPAIGNS)
        t["context_defaults"] = {"api": spec["defaults"][0], "playground": spec["defaults"][1]}
        t["model_access"]["quill-still"] = {"api": spec["team"][0], "playground": spec["team"][1]}

    try:
        save_policy(base, mutate)
        models = data(call(base, "ines", "GET", "/api/models"), 200)["models"]
        resolved = next(m for m in models if m["slug"] == "quill-still")["access"]
        assert resolved == {"api": spec["resolved"][0], "playground": spec["resolved"][1]}
        reserves = reserve_count(base, CAMPAIGNS)
        api = submit(base, "ines", "quill-still", quill(word()))
        with session_client(base, "ines") as client:
            pg = client.post("/api/jobs", json={"model": "quill-still", "input": quill(word())},
                             headers={"Idempotency-Key": idempotency_key()})
        made = 0
        for response, outcome in ((api, spec["resolved"][0]), (pg, spec["resolved"][1])):
            if outcome == "allowed":
                made += 1
                cancel(base, "rafael", data(response, 201)["job"]["id"])
            else:
                error_of(response, 403, "model_blocked")
        assert reserve_count(base, CAMPAIGNS) == reserves + made
    finally:
        save_policy(base, lambda p: p["org_model_access"].update({"quill-still": {"api": "allowed", "playground": "allowed"}}))
        roomy(base, CAMPAIGNS)


def test_restricted_payloads(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    set_team(base, STOREFRONT, payload_visibility="restricted")
    prompt = word()
    try:
        done = wait_job(base, submitted(base, "mara", "quill-still", quill(prompt))["id"], {"succeeded"})
        mine = job(base, "mara", done["id"])
        assert set(mine) == FULL_JOB_KEYS and mine["input"]["prompt"] == prompt and mine["payload_visible"] is True
        with session_client(base, "mara") as client:
            assert client.get(f"/api/jobs/{done['id']}").json()["job"]["input"]["prompt"] == prompt
        for who in ("theo", "rafael", "sol"):
            seen = job(base, who, done["id"])
            assert set(seen) == RESTRICTED_JOB_KEYS and seen["payload_visible"] is False
            assert seen["status"] == "succeeded" and seen["charged_micro"] == done["charged_micro"]
        listed = next(j for j in team_jobs(base, STOREFRONT, "theo") if j["id"] == done["id"])
        assert set(listed) == RESTRICTED_JOB_KEYS
        output = done["outputs"][0]
        assert data(asset(base, "mara", output), 200)["asset"]["prompt"] == prompt
        for who in ("theo", "ines"):
            hidden = data(asset(base, who, output), 200)["asset"]
            assert "prompt" not in hidden and "derived_from" not in hidden
        assert output not in search(base, "theo", prompt)
        up = data(upload(base, "mara", png()), 201)["asset"]
        for who in ("theo", "ines"):
            error_of(asset(base, who, up["id"]), 404, "not_found")
        for who in ("rafael", "sol"):
            assert "url" not in data(asset(base, who, up["id"]), 200)["asset"]
        assert up["id"] not in search(base, "theo", up["id"])
        set_team(base, STOREFRONT, payload_visibility="team")
        assert set(job(base, "theo", done["id"])) == FULL_JOB_KEYS
    finally:
        roomy(base, STOREFRONT)


def test_lineage_respects_visibility(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    set_team(base, STOREFRONT, payload_visibility="restricted")
    try:
        a = output_of(base, "mara", word())["outputs"][0]
        b = wait_job(base, submitted(base, "mara", "halftone-xl", halftone(word(), init=f"asset:{a}"))["id"],
                     {"succeeded"})["outputs"][0]
        edge = {"from": a, "to": b}
        for start in (a, b):
            graph = lineage(base, "mara", start)
            assert [n["id"] for n in graph["nodes"]] == [a, b] and graph["edges"] == [edge], start
            assert all("prompt" in n for n in graph["nodes"]), start
        for who in ("theo", "rafael", "sol", "ines"):
            for start in (a, b):
                graph = lineage(base, who, start)
                assert [n["id"] for n in graph["nodes"]] == [start] and graph["edges"] == [], (who, start)
                assert "prompt" not in graph["nodes"][0], (who, start)
        set_team(base, STOREFRONT, payload_visibility="team")
        for who in ("theo", "rafael", "sol"):
            graph = lineage(base, who, b)
            assert [n["id"] for n in graph["nodes"]] == [a, b] and graph["edges"] == [edge], who
        for start in (a, b):
            graph = lineage(base, "ines", start)
            assert [n["id"] for n in graph["nodes"]] == [start] and graph["edges"] == [], start
    finally:
        roomy(base, STOREFRONT)


def test_jobs_csv_visibility(app_url: str, mail: Any) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    set_team(base, STOREFRONT, payload_visibility="restricted")
    prompt = word()
    created = submitted(base, "mara", "quill-still", quill(prompt))
    try:
        def row(who: str) -> dict[str, str]:
            r = expect_status(call(base, who, "GET", "/api/jobs.csv", params={"team": STOREFRONT}), 200)
            assert r.headers["content-type"].startswith("text/csv")
            rows = list(csv.DictReader(io.StringIO(r.text)))
            assert list(rows[0]) == JOBS_CSV_COLUMNS
            return next(x for x in rows if x["job_id"] == created["id"])
        assert row("mara")["prompt"] == prompt
        assert row("theo")["prompt"] == "" and row("rafael")["prompt"] == ""
        set_team(base, STOREFRONT, payload_visibility="team")
        assert row("theo")["prompt"] == prompt
        assert not [m for m in mail.messages() if prompt in mail_text(m)]
    finally:
        cancel(base, "rafael", created["id"])
        roomy(base, STOREFRONT)


def test_policy_versions(app_url: str) -> None:
    base = base_of(app_url)
    start = policy(base)
    saved = data(call(base, "rafael", "PUT", "/api/policy", body=start), 200)["policy"]
    assert saved["version"] == start["version"] + 1
    versions = data(call(base, "june", "GET", "/api/policy/versions"), 200)["versions"]
    assert versions[0]["version"] == saved["version"]
    stale = json.loads(json.dumps(start))
    team_policy(stale, CAMPAIGNS)["concurrency"] = 3
    err = error_of(call(base, "rafael", "PUT", "/api/policy", body=stale), 412, "policy_version_stale")
    assert err["current_version"] == saved["version"]
    assert policy(base) == saved
    error_of(call(base, "june", "PUT", "/api/policy", body=saved), 403, "forbidden")
    for bad in ({"concurrency": 21}, {"soft_cap_credits": HARD_CAP_MAX, "hard_cap_credits": 1}):
        body = json.loads(json.dumps(saved))
        team_policy(body, CAMPAIGNS).update(bad)
        error_of(call(base, "rafael", "PUT", "/api/policy", body=body), 422, "validation_failed")
    body = json.loads(json.dumps(saved))
    body["retention_days"] = 45
    error_of(call(base, "rafael", "PUT", "/api/policy", body=body), 422, "validation_failed")
    body = json.loads(json.dumps(saved))
    body["teams"].append(dict(team_policy(body, CAMPAIGNS), id="t_unknown"))
    error_of(call(base, "rafael", "PUT", "/api/policy", body=body), 422, "validation_failed")
    assert policy(base)["version"] == saved["version"]
    results = parallel(2, lambda _: call(base, "rafael", "PUT", "/api/policy", body=saved).status_code)
    assert sorted(results) == [200, 412]
    assert policy(base)["version"] == saved["version"] + 1


def test_wf_admin_policy_journey(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    roomy(base, CAMPAIGNS)
    prompt = word()
    done = wait_job(base, submitted(base, "mara", "quill-still", quill(prompt))["id"], {"succeeded"})
    try:
        with ui(browser, base, "theo") as theo:
            go(theo, "Jobs")
            see_text(theo, row_for(theo.get_by_role("table", name="Jobs"), done["id"]), prompt)
            version = policy(base)["version"]
            with ui(browser, base, "rafael") as admin:
                go(admin, "Admin")
                form = admin.get_by_role("form", name="Org policy")
                campaigns = form.get_by_role("group", name="Campaigns")
                select(campaigns.get_by_role("combobox", name=context_box("Murmur Voice", "playground")), "Blocked")
                campaigns.get_by_role("spinbutton", name="Soft cap (credits)").fill(str(LOWER_SOFT_CAP))
                select(form.get_by_role("group", name="Storefront").get_by_role("combobox", name="Payload visibility"), "Restricted")
                form.get_by_role("button", name="Save policy").click()
                see_text(admin, notices(admin), f"Policy saved as version {version + 1}.")
                see_text(admin, admin.get_by_role("list", name="Policy versions"), str(version + 1))
            saved = policy(base)
            assert saved["version"] == version + 1
            assert team_policy(saved, CAMPAIGNS)["model_access"]["murmur-voice"]["playground"] == "blocked"
            assert team_policy(saved, CAMPAIGNS)["soft_cap_credits"] == LOWER_SOFT_CAP
            assert team_policy(saved, STOREFRONT)["payload_visibility"] == "restricted"
            theo.reload()
            go(theo, "Jobs")
            row = row_for(theo.get_by_role("table", name="Jobs"), done["id"])
            see_text(theo, row, HIDDEN_COPY)
            assert prompt not in row.inner_text() and credits_text(done["charged_micro"]) in row.inner_text()
        with ui(browser, base, "ines") as ines:
            see_text(ines, ines.get_by_role("navigation", name="Catalogue"), BLOCKED_COPY)
            murmur_button = ines.get_by_role("navigation", name="Catalogue").get_by_role("button", name="Murmur Voice", exact=True)
            assert murmur_button.is_disabled() or murmur_button.get_attribute(ARIA_DISABLED) == "true"
        with session_client(base, "ines") as client:
            r = client.post("/api/jobs", json={"model": "murmur-voice", "input": murmur(murmur_text())}, headers={"Idempotency-Key": idempotency_key()})
            error_of(r, 403, "model_blocked")
    finally:
        roomy(base, STOREFRONT)
        roomy(base, CAMPAIGNS)


def test_wf_admin_policy_stale(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    with ui(browser, base, "rafael") as page:
        go(page, "Admin")
        form = page.get_by_role("form", name="Org policy")
        see(page, form)
        newer = data(call(base, "rafael", "PUT", "/api/policy", body=policy(base)), 200)["policy"]
        form.get_by_role("group", name="Campaigns").get_by_role("spinbutton", name="Concurrency").fill("3")
        form.get_by_role("button", name="Save policy").click()
        see_text(page, page.get_by_role("alert").first,
                 f"Someone saved a newer policy (version {newer['version']}). Reload to see it before saving again.")
    assert policy(base) == newer


def output_of(base: str, who: str, prompt: str, n: int = 1) -> dict[str, Any]:
    return wait_job(base, submitted(base, who, "quill-still", quill(prompt, n))["id"], {"succeeded"})


def test_delete_asset(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    done = output_of(base, "mara", word())
    aid = done["outputs"][0]
    key = output_key(STOREFRONT, done["id"])
    link = data(asset(base, "mara", aid), 200)["asset"]["url"]
    error_of(call(base, "mara", "DELETE", f"/api/assets/{aid}"), 403, "forbidden")
    error_of(call(base, "june", "DELETE", f"/api/assets/{aid}"), 403, "forbidden")
    assert key in S3().keys(f"outputs/{STOREFRONT}/{done['id']}/")
    expect_status(call(base, "sol", "DELETE", f"/api/assets/{aid}"), 204)
    assert key not in S3().keys(f"outputs/{STOREFRONT}/{done['id']}/")
    assert fetch_status(link) != 200
    for who in ("mara", "theo", "ines", "rafael", "june", "sol"):
        err = error_of(asset(base, who, aid), 410, "asset_gone")
        assert err["reason"] == "deleted" and err["removed_at"].endswith("Z")
    error_of(call(base, "sol", "DELETE", f"/api/assets/{aid}"), 410, "asset_gone")
    error_of(call(base, "mara", "DELETE", f"/api/assets/{aid}"), 403, "forbidden")
    error_of(call(base, "mara", "GET", f"/api/assets/{aid}/lineage"), 410, "asset_gone")
    assert aid in job(base, "mara", done["id"])["outputs"]
    set_team(base, STOREFRONT, payload_visibility="restricted")
    try:
        up = data(upload(base, "mara", png()), 201)["asset"]
        expect_status(call(base, "sol", "DELETE", f"/api/assets/{up['id']}"), 204)
        error_of(asset(base, "theo", up["id"]), 404, "not_found")
        error_of(asset(base, "mara", up["id"]), 410, "asset_gone")
    finally:
        roomy(base, STOREFRONT)


def test_delete_during_storage_outage() -> None:
    down = instance("APP_STORAGE_DOWN_URL")
    with Relay(OUTAGE_PORT, env_url("S3_ENDPOINT")):
        poll(lambda: system(down)["storage"] == "up", STATUS_CHECK_S + GRACE_S, "storage up")
        up = data(upload(down, "mara", png()), 201)["asset"]
    poll(lambda: system(down)["storage"] == "down", STATUS_CHECK_S + GRACE_S, "storage down again")
    error_of(call(down, "sol", "DELETE", f"/api/assets/{up['id']}"), 503, "storage_unavailable")
    expect_status(asset(down, "mara", up["id"]), 200)
    assert up["id"] in search(down, "mara", up["id"])
    with Relay(OUTAGE_PORT, env_url("S3_ENDPOINT")):
        poll(lambda: system(down)["storage"] == "up", STATUS_CHECK_S + GRACE_S, "storage back")
        expect_status(call(down, "sol", "DELETE", f"/api/assets/{up['id']}"), 204)
    err = error_of(asset(down, "mara", up["id"]), 410, "asset_gone")
    assert err["reason"] == "deleted"


def test_retention_expiry() -> None:
    fast = instance("APP_FAST_URL")
    roomy(fast, STOREFRONT)
    try:
        save_policy(fast, lambda p: p.update(retention_days=7))
        up = data(upload(fast, "mara", png()), 201)["asset"]
        assert (iso(up["expires_at"]) - iso(up["created_at"])).total_seconds() == 7 * FAST_RETENTION_DAY_S
        save_policy(fast, lambda p: p.update(retention_days=90))
        assert data(asset(fast, "mara", up["id"]), 200)["asset"]["expires_at"] == up["expires_at"]
        derived = wait_job(fast, submitted(fast, "mara", "halftone-xl", halftone(word(), init=f"asset:{up['id']}"))["id"], {"succeeded"})
        output = derived["outputs"][0]
        err = poll(lambda: (r if (r := asset(fast, "mara", up["id"])).status_code == 410 else None),
                   7 * FAST_RETENTION_DAY_S + GRACE_S, "expiry")
        assert err.json()["error"]["reason"] == "expired"
        assert up["id"] not in search(fast, "mara", up["id"])
        node = next(n for n in lineage(fast, "mara", output)["nodes"] if n["id"] == up["id"])
        assert node["state"] == "tombstone" and node["reason"] == "expired"
        poll(lambda: upload_key(STOREFRONT, up["id"]) not in S3().keys(f"uploads/{STOREFRONT}/"),
             SWEEP_S + GRACE_S, "expired object removed")
    finally:
        save_policy(fast, lambda p: p.update(retention_days=30))


def test_expiry_at_the_instant() -> None:
    fast = instance("APP_FAST_URL")
    roomy(fast, STOREFRONT)
    try:
        save_policy(fast, lambda p: p.update(retention_days=7))
        up = data(upload(fast, "mara", png()), 201)["asset"]
        expect_status(asset(fast, "mara", up["id"]), 200)
        _TICK.wait(max(0.0, (iso(up["expires_at"]) - datetime.now(timezone.utc)).total_seconds() + EXPIRY_MARGIN_S))
        err = error_of(asset(fast, "mara", up["id"]), 410, "asset_gone")
        assert err["reason"] == "expired"
        error_of(call(fast, "mara", "GET", f"/api/assets/{up['id']}/lineage"), 410, "asset_gone")
        assert up["id"] not in search(fast, "mara", up["id"])
    finally:
        save_policy(fast, lambda p: p.update(retention_days=30))


def test_lineage_tombstones(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    a1 = output_of(base, "mara", word())["outputs"][0]
    second = word()
    b1 = wait_job(base, submitted(base, "mara", "halftone-xl", halftone(second, init=f"asset:{a1}"))["id"], {"succeeded"})["outputs"][0]
    expect_status(call(base, "rafael", "DELETE", f"/api/assets/{a1}"), 204)
    graph = lineage(base, "mara", b1)
    nodes = {n["id"]: n for n in graph["nodes"]}
    assert set(nodes[a1]) == {"id", "state", "removed_at", "reason"}
    assert nodes[a1]["state"] == "tombstone" and nodes[a1]["reason"] == "deleted"
    assert nodes[b1]["state"] == "live" and nodes[b1]["prompt"] == second and nodes[b1]["thumbnail_url"]
    assert {"from": a1, "to": b1} in graph["edges"]
    error_of(call(base, "mara", "GET", f"/api/assets/{a1}/lineage"), 410, "asset_gone")


def test_lineage_through_tombstones(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)

    def derived(source: str) -> str:
        return wait_job(base, submitted(base, "mara", "halftone-xl", halftone(word(), init=f"asset:{source}"))["id"],
                        {"succeeded"})["outputs"][0]

    a = output_of(base, "mara", word())["outputs"][0]
    b = derived(a)
    c = derived(b)
    c2 = derived(b)
    d = derived(c)
    expect_status(call(base, "rafael", "DELETE", f"/api/assets/{b}"), 204)
    edges = [{"from": a, "to": b}, {"from": b, "to": c}, {"from": b, "to": c2}, {"from": c, "to": d}]
    for start in (a, c2, d):
        graph = lineage(base, "mara", start)
        assert [n["id"] for n in graph["nodes"]] == [a, b, c, c2, d], start
        assert graph["edges"] == edges, start
        tomb = next(n for n in graph["nodes"] if n["id"] == b)
        assert set(tomb) == {"id", "state", "removed_at", "reason"}
        assert tomb["state"] == "tombstone" and tomb["reason"] == "deleted"


def test_media_search(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    roomy(base, CAMPAIGNS)
    key = word()
    o1, o2 = output_of(base, "mara", f"{key} lantern", 2)["outputs"]
    assert {o1, o2} <= set(search(base, "mara", key))
    assert {o1, o2} <= set(search(base, "mara", f"{key.upper()} QUILL"))
    assert not {o1, o2} & set(search(base, "mara", f"{key} halftone"))
    assert o1 in search(base, "mara", key, kind="output", model="quill-still", team=STOREFRONT)
    assert o1 not in search(base, "mara", key, kind="upload")
    assert not {o1, o2} & set(search(base, "ines", key))
    assert o1 in search(base, "ines", o1)
    expect_status(call(base, "sol", "DELETE", f"/api/assets/{o2}"), 204)
    found = search(base, "mara", key)
    assert o1 in found and o2 not in found
    set_team(base, STOREFRONT, payload_visibility="restricted")
    try:
        assert o1 not in search(base, "theo", key)
        assert o1 in search(base, "mara", key)
    finally:
        roomy(base, STOREFRONT)


def test_wf_retention_deletion_compliance(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    first, second = word(), word()
    source = output_of(base, "mara", first)
    a1 = source["outputs"][0]
    b1 = wait_job(base, submitted(base, "mara", "reel-10", reel(second, start=f"asset:{a1}"))["id"], {"succeeded"})["outputs"][0]
    with ui(browser, base, "sol") as page:
        go(page, "Library")
        box = page.get_by_role("searchbox", name="Search media")
        box.fill(first)
        results = page.get_by_role("list", name="Results")
        see(page, results.get_by_role("button", name=f"Asset {a1}"))
        results.get_by_role("button", name=f"Asset {a1}").click()
        page.get_by_role("dialog", name=f"Asset {a1}").get_by_role("button", name="Delete").click()
        confirm = page.get_by_role("alertdialog", name="Delete asset")
        see(page, confirm)
        expect(confirm.get_by_role("button", name="Keep")).to_be_focused()
        confirm.get_by_role("button", name="Delete permanently").click()
        see_text(page, notices(page), f"Asset {a1} deleted from storage, search and lineage.")
        eventually(page, lambda: has_focus(box), UI_WAIT_S, "focus to search")
        box.fill("")
        box.fill(first)
        see(page, page.get_by_text(NO_MATCH_COPY))
        assert output_key(STOREFRONT, source["id"]) not in S3().keys(f"outputs/{STOREFRONT}/{source['id']}/")
        removed = error_of(asset(base, "sol", a1), 410, "asset_gone")["removed_at"]
        box.fill(second)
        see(page, results.get_by_role("button", name=f"Asset {b1}"))
        results.get_by_role("button", name=f"Asset {b1}").click()
        dialog = page.get_by_role("dialog", name=f"Asset {b1}")
        see(page, dialog.get_by_role("button", name=f"Removed asset {a1}"))
        see_text(page, dialog, f"Removed {long_date(removed, policy(base)['timezone'])} (deleted)")


def test_delete_gone_asset_in_library(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    prompt = word()
    aid = output_of(base, "mara", prompt)["outputs"][0]
    raced: list[int] = []

    def gone_first(route: Any, request: Any) -> None:
        if request.method == "DELETE" and not raced:
            raced.append(call(base, "rafael", "DELETE", f"/api/assets/{aid}").status_code)
        route.continue_()

    with ui(browser, base, "sol") as page:
        go(page, "Library")
        page.get_by_role("searchbox", name="Search media").fill(prompt)
        result = page.get_by_role("list", name="Results").get_by_role("button", name=f"Asset {aid}")
        see(page, result)
        result.click()
        page.get_by_role("dialog", name=f"Asset {aid}").get_by_role("button", name="Delete").click()
        confirm = page.get_by_role("alertdialog", name="Delete asset")
        see(page, confirm)
        page.route(re.compile(rf"/api/assets/{re.escape(aid)}(?:[?#]|$)"), gone_first)
        confirm.get_by_role("button", name="Delete permanently").click()
        see_alert(page, GONE_COPY)
    assert raced == [204], f"the admin's delete answered {raced}"
    error_of(asset(base, "sol", aid), 410, "asset_gone")


def test_wf_retention_deletion_keep(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    prompt = word()
    done = output_of(base, "mara", prompt)
    aid = done["outputs"][0]
    with ui(browser, base, "sol") as page:
        go(page, "Library")
        page.get_by_role("searchbox", name="Search media").fill(prompt)
        result = page.get_by_role("list", name="Results").get_by_role("button", name=f"Asset {aid}")
        see(page, result)
        result.click()
        dialog = page.get_by_role("dialog", name=f"Asset {aid}")
        delete = dialog.get_by_role("button", name="Delete")
        delete.click()
        confirm = page.get_by_role("alertdialog", name="Delete asset")
        see(page, confirm)
        page.keyboard.press("Escape")
        gone(page, confirm)
        eventually(page, lambda: has_focus(delete), UI_WAIT_S, "focus back to Delete")
        delete.click()
        see(page, confirm)
        confirm.get_by_role("button", name="Keep").click()
        gone(page, confirm)
    expect_status(asset(base, "sol", aid), 200)
    assert output_key(STOREFRONT, done["id"]) in S3().keys(f"outputs/{STOREFRONT}/{done['id']}/")


def check_period(base: str, period: dict[str, Any], tz: str) -> None:
    zone = ZoneInfo(tz)
    start = iso(period["starts_at"]).astimezone(zone)
    assert (start.day, start.hour, start.minute, start.second) == (1, 0, 0, 0)
    nxt = datetime(start.year + (start.month == 12), start.month % 12 + 1, 1, tzinfo=zone)
    assert iso(period["ends_at"]) == nxt.astimezone(timezone.utc)
    assert period["label"] == f"{calendar.month_name[start.month]} {start.year}"
    assert iso(period["starts_at"]) <= server_now(base) < iso(period["ends_at"])


def test_budget_period(app_url: str) -> None:
    base = base_of(app_url)
    org_tz(base)
    check_period(base, meter(base, STOREFRONT)["period"], ORG_TZ)
    try:
        save_policy(base, lambda p: p.update(timezone=OTHER_TZ))
        check_period(base, meter(base, STOREFRONT)["period"], OTHER_TZ)
    finally:
        save_policy(base, lambda p: p.update(timezone=ORG_TZ))


def test_soft_cap_warning(app_url: str, browser: Any, mail: Any) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    drain(base, STOREFRONT)
    try:
        spend = meter(base, STOREFRONT)["period"]["spend_micro"]
        soft = spend // MICRO + 1
        set_team(base, STOREFRONT, soft_cap_credits=soft, hard_cap_credits=HARD_CAP_MAX)
        assert meter(base, STOREFRONT)["cap_state"] == "under"
        prompt = word()
        submitted(base, "mara", "reel-10", reel(prompt))
        shown = meter(base, STOREFRONT)
        assert shown["cap_state"] == "soft_cap_passed" and shown["period"]["soft_cap_micro"] == soft * MICRO
        assert shown["period"]["soft_cap_offset_micro"] == (shown["settled_micro"] + shown["reserved_micro"]
                                                           - shown["period"]["spend_micro"] + soft * MICRO)
        subject = f"Soft cap passed: {TEAM_NAMES[STOREFRONT]}, {shown['period']['label']}"
        poll(lambda: with_subject(mail, subject, quick=True), GRACE_S, "soft cap email")
        submitted(base, "mara", "reel-10", reel(word()))
        found = with_subject(mail, subject, expected=1)
        assert len(found) == 1
        assert set(addresses(found[0][MAIL_TO])) == {EMAILS["rafael"], EMAILS["june"]}
        assert prompt not in mail_text(found[0])
        with ui(browser, base, "mara") as page:
            see(page, page.get_by_role("region", name="Credit meter").get_by_role("img", name="Soft cap marker"))
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_hard_cap_throttle(app_url: str, mail: Any) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    drain(base, STOREFRONT)
    try:
        spend = meter(base, STOREFRONT)["period"]["spend_micro"]
        cap = -(-spend // MICRO) + HARD_HEADROOM
        set_team(base, STOREFRONT, soft_cap_credits=cap, hard_cap_credits=cap)
        submitted(base, "mara", "quill-still", quill(word()))
        reserves = reserve_count(base, STOREFRONT)
        newest = newest_job_id(base, STOREFRONT)
        err = error_of(submit(base, "mara", "reel-10", reel(word(), 10)), 429, "budget_hard_cap")
        shown = meter(base, STOREFRONT)
        assert err["period_ends_at"] == shown["period"]["ends_at"]
        assert reserve_count(base, STOREFRONT) == reserves and newest_job_id(base, STOREFRONT) == newest
        assert shown["cap_state"] == "hard_cap_reached"
        subject = f"Hard cap reached: {TEAM_NAMES[STOREFRONT]}, {shown['period']['label']}"
        poll(lambda: with_subject(mail, subject, quick=True), GRACE_S, "hard cap email")
        error_of(submit(base, "mara", "reel-10", reel(word(), 10)), 429, "budget_hard_cap")
        found = with_subject(mail, subject, expected=1)
        assert len(found) == 1
        assert set(addresses(found[0][MAIL_TO])) == {EMAILS[w] for w in ("rafael", "june", "mara", "theo")}
        assert long_date(shown["period"]["ends_at"], policy(base)["timezone"]) in mail_text(found[0])
    finally:
        drain(base, STOREFRONT)
        roomy(base, STOREFRONT)


def test_wf_budget_caps_journey(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    drain(base, CAMPAIGNS)
    try:
        spend = meter(base, CAMPAIGNS)["period"]["spend_micro"]
        reservation = charge("5", current_rate(base, "reel-10")["micro_per_unit"])
        set_team(base, CAMPAIGNS, soft_cap_credits=(spend + reservation) // MICRO, hard_cap_credits=-(-(spend + reservation) // MICRO))
        key = idempotency_key()
        prompt = word()
        accepted = submitted(base, "ines", "reel-10", reel(prompt), key=key)
        with ui(browser, base, "ines") as page:
            region = page.get_by_role("region", name="Credit meter")
            see(page, region.get_by_role("img", name="Soft cap marker"))
            page.get_by_role("navigation", name="Catalogue").get_by_role("button", name="Reel 10", exact=True).click()
            form = page.get_by_role("form", name=run_form("Reel 10"))
            see(page, form)
            form.get_by_role("textbox", name="Prompt", exact=True).fill(word())
            form.get_by_role("button", name="Run", exact=True).click()
            period = meter(base, CAMPAIGNS)["period"]
            end = long_date(period["ends_at"], policy(base)["timezone"])
            throttled = f"{TEAM_NAMES[CAMPAIGNS]} reached its hard cap for {period['label']}. New jobs are throttled until {end}."
            eventually(page, lambda: any(squash(throttled) in squash(a.inner_text(timeout=UI_TIMEOUT_MS))
                                         for a in page.get_by_role("alert").all()), UI_WAIT_S, f"text {throttled!r} in an alert")
            see_text(page, region, f"Hard cap reached — new jobs are throttled until {end}")
        replay = submit(base, "ines", "reel-10", reel(prompt), key=key)
        assert data(replay, 201)["job"]["id"] == accepted["id"] and replay.headers.get("Idempotent-Replayed") == "true"
        assert meter(base, CAMPAIGNS)["cap_state"] == "hard_cap_reached"
        assert newest_job_id(base, CAMPAIGNS) == accepted["id"]
    finally:
        drain(base, CAMPAIGNS)
        roomy(base, CAMPAIGNS)


def test_wf_budget_caps_raise(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    drain(base, CAMPAIGNS)
    try:
        spend = meter(base, CAMPAIGNS)["period"]["spend_micro"]
        cap = -(-spend // MICRO)
        set_team(base, CAMPAIGNS, soft_cap_credits=cap, hard_cap_credits=cap)
        error_of(submit(base, "ines", "quill-still", quill(word())), 429, "budget_hard_cap")
        with ui(browser, base, "rafael") as page:
            go(page, "Admin")
            group = page.get_by_role("form", name="Org policy").get_by_role("group", name="Campaigns")
            group.get_by_role("spinbutton", name="Hard cap (credits)").fill(str(HARD_CAP_MAX))
            group.get_by_role("spinbutton", name="Soft cap (credits)").fill(str(HARD_CAP_MAX))
            page.get_by_role("button", name="Save policy").click()
            see_text(page, notices(page), "Policy saved as version")
        assert team_policy(policy(base), CAMPAIGNS)["hard_cap_credits"] == HARD_CAP_MAX
        submitted(base, "ines", "quill-still", quill(word()))
    finally:
        drain(base, CAMPAIGNS)
        roomy(base, CAMPAIGNS)


NAV_BY_ROLE = {
    "mara": {"Run", "Jobs", "Library", "Webhooks"},
    "rafael": {"Jobs", "Library", "Webhooks", "Finance", "Admin"},
    "june": {"Jobs", "Library", "Finance", "Admin"},
    "sol": {"Jobs", "Library"},
}


def test_sign_in_and_roles(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    for who, (mid, name, role, team) in MEMBERS.items():
        me = data(call(base, who, "GET", "/api/me"), 200)["member"]
        assert (me["id"], me["name"], me["role"], me["team_id"], me["email"]) == (mid, name, role, team, EMAILS[who])
        with session_client(base, who) as client:
            assert client.get("/api/me").json()["member"]["id"] == mid
        error_of(httpx.post(base + "/api/session", json={"email": EMAILS[who], "passcode": PASSCODE + "x"}, timeout=HTTP_TIMEOUT), 401, "unauthenticated")
    error_of(call(base, None, "GET", "/api/me"), 401, "unauthenticated")
    refused = [
        ("GET", "/api/policy", "mara", None), ("PUT", "/api/policy", "june", policy(base)),
        ("POST", "/api/topups", "rafael", {"team_id": CAMPAIGNS, "credits": TOPUP_MIN}),
        ("POST", "/api/topups", "sol", {"team_id": CAMPAIGNS, "credits": TOPUP_MIN}),
        ("GET", f"/api/teams/{STOREFRONT}/ledger", "mara", None), ("GET", f"/api/teams/{STOREFRONT}/ledger", "sol", None),
        ("POST", rates_path("quill-still"), "rafael", {"micro_per_unit": MICRO, "effective_at_local": FAR_FUTURE_LOCAL}),
    ]
    for method, path, who, body in refused:
        error_of(call(base, who, method, path, body=body), 403, "forbidden")
    error_of(submit(base, "rafael", "quill-still", quill(word())), 403, "forbidden")
    error_of(call(base, "mara", "GET", f"/api/teams/{CAMPAIGNS}/meter"), 404, "not_found")
    expect_status(call(base, "sol", "GET", f"/api/teams/{CAMPAIGNS}/meter"), 200)
    expect_status(call(base, "june", "GET", "/api/policy"), 200)
    assert [t["id"] for t in data(call(base, "mara", "GET", "/api/teams"), 200)["teams"]] == [STOREFRONT]
    for who, links in NAV_BY_ROLE.items():
        with ui(browser, base, who) as page:
            nav = page.get_by_role("navigation", name="Primary")
            shown = {name for name in ("Run", "Jobs", "Library", "Webhooks", "Finance", "Admin")
                     if nav.get_by_role("link", name=name, exact=True).count() > 0}
            assert shown == links, (who, shown)


VIEWPORTS = {
    "375x812": (375, 812),
    "768x1024": (768, 1024),
    "1280x800": (1280, 800),
}
TAP_ROLES = ["button", "link", "checkbox", "combobox", "textbox", "searchbox", "spinbutton", "radio", "switch", "tab"]


def small_targets(page: Page) -> list[str]:
    bad = []
    for role in TAP_ROLES:
        for el in page.get_by_role(role).all():
            if not el.is_visible():
                continue
            box = el.bounding_box()
            if not box or box["width"] <= 1 or box["height"] <= 1:
                continue
            if box["width"] < TAP_MIN - 0.5 or box["height"] < TAP_MIN - 0.5:
                bad.append(f"{role} {el.get_attribute('aria-label') or el.inner_text()[:40]!r} {box['width']:.0f}x{box['height']:.0f}")
    return bad


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layout(app_url: str, browser: Any, viewport: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    width, height = VIEWPORTS[viewport]
    for who, screens in (("mara", ["Run", "Jobs", "Library", "Webhooks"]), ("rafael", ["Jobs", "Library", "Webhooks", "Finance", "Admin"])):
        with ui(browser, base, who, width=width, height=height) as page:
            menu = page.get_by_role("button", name="Menu")
            assert (menu.count() > 0 and menu.first.is_visible()) == (width == 375)
            for screen in screens:
                go(page, screen)
                advance(page, SEQUENCE_MAX_MS)
                layout(page)
                assert not small_targets(page), (screen, small_targets(page))
                if screen == "Run":
                    if width < 1024:
                        see(page, page.get_by_role("button", name="Catalogue"))
                    else:
                        see(page, page.get_by_role("navigation", name="Catalogue"))


def test_keyboard_and_focus(browser: Any) -> None:
    base = frozen_queue()
    try:
        blocker = submitted(base, "mara", "quill-still", quill(word()))["id"]
        waiting = submitted(base, "mara", "quill-still", quill(word()))["id"]
        with ui(browser, base, "mara") as page:
            page.reload()
            one = notch_units("1", "image")
            see(page, notch(page, waiting, one))
            expected = ["Skip to main content", "Run", "Jobs", "Library", "Webhooks", "Sign out",
                        "Quill Still", "Halftone XL", "Reel 10", "Murmur Voice",
                        f"Job {blocker}, {one} reserved", f"Job {waiting}, {one} reserved"]
            assert tab_order(page, len(expected)) == expected
            opener = page.get_by_role("region", name="Queue").get_by_role("button", name=f"Open job {waiting}")
            opener.focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name=f"Job {waiting}")
            see(page, dialog)
            for key, presses in (("Tab", 8), ("Shift+Tab", 4)):
                for _ in range(presses):
                    page.keyboard.press(key)
                    assert dialog.evaluate(HOLDS_FOCUS)
            page.keyboard.press("Escape")
            gone(page, dialog)
            eventually(page, lambda: has_focus(opener), UI_WAIT_S, "focus back to opener")
    finally:
        drain(base, STOREFRONT)


def test_ribbon_motion(browser: Any) -> None:
    base = frozen_queue()
    try:
        with ui(browser, base, "mara") as page:
            region = page.get_by_role("region", name="Credit meter")
            available = region.get_by_role("meter", name="Available")
            see(page, available)
            page.evaluate(GRAB_ANIMATIONS)
            key = idempotency_key()
            created = submitted(base, "mara", "reel-10", reel(word(), 10), key=key)
            tab = notch(page, created["id"], notch_units("10", "video_second"))
            times, widths, durations = ribbon_path(page, region, available, lambda: tab.count() > 0 and tab.first.is_visible())
            see(page, tab, LIVE_UPDATE_S + GRACE_S, FINE_STEP_MS)
            delta = widths[0] - widths[-1]
            eps = delta * EPS_SHARE
            assert delta > MIN_DELTA_PX, widths
            assert all(b <= a + eps for a, b in zip(widths, widths[1:])), widths
            assert any(widths[-1] + eps < w < widths[0] - eps for w in widths[1:-1]), widths
            if durations:
                assert RIBBON_MIN_MS <= max(durations) <= RIBBON_MAX_MS, durations
            else:
                assert settle_time(times, widths, delta * TAIL_SHARE) <= RIBBON_MAX_MS + DETECT_MS
            settle(region)
            rest = width_of(available)
            replay = submit(base, "mara", "reel-10", reel(created["input"]["prompt"], 10), key=key)
            assert replay.headers.get("Idempotent-Replayed") == "true"
            advance(page, SEQUENCE_MAX_MS * 2)
            settle(region)
            assert abs(width_of(available) - rest) <= eps
            page.evaluate(REGRAB)
            expect_status(cancel(base, "mara", created["id"]), 200)
            announcements = page.get_by_role("status", name="Meter announcements")
            released = f"Job {created['id']} released"
            times, widths, _ = ribbon_path(page, region, available, lambda: announcements.count() > 0
                                           and squash(released) in squash(announcements.first.inner_text()))
            grown = widths[-1] - widths[0]
            assert grown > MIN_DELTA_PX and all(b >= a - grown * EPS_SHARE for a, b in zip(widths, widths[1:])), widths
            assert settle_time(times, widths, grown * TAIL_SHARE) <= RIBBON_MAX_MS + DETECT_MS
            settle(region)
            see_text(page, announcements, released, LIVE_UPDATE_S + GRACE_S)
            see_text(page, region, f"Available {credits_text(ledger(base, STOREFRONT)['balances']['available_micro'])}")
            assert page.evaluate(LOOPING) == 0
    finally:
        drain(base, STOREFRONT)


def test_reduced_motion(browser: Any) -> None:
    base = frozen_queue()
    try:
        reduced_motion_journey(browser, base)
    finally:
        drain(base, STOREFRONT)


def reduced_motion_journey(browser: Any, base: str) -> None:
    with ui(browser, base, "mara", reduced_motion="reduce") as page:
        region = page.get_by_role("region", name="Credit meter")
        announcements = page.get_by_role("status", name="Meter announcements")
        key = idempotency_key()
        created = submitted(base, "mara", "reel-10", reel(word(), 10), key=key)
        tab = notch(page, created["id"], notch_units("10", "video_second"))
        see(page, tab, LIVE_UPDATE_S + GRACE_S, FINE_STEP_MS)
        bal = ledger(base, STOREFRONT)["balances"]
        widths = {name: width_of(region.get_by_role("meter", name=name)) for name, _ in METER_SEGMENTS}
        inner = sum(widths.values())
        assert abs(widths["Available"] - bal["available_micro"] / bal["granted_micro"] * inner) <= 1
        _, path = path_widths(motion(region.get_by_role("meter", name="Available"), SEQUENCE_MAX_MS // 2))
        assert max(path) - min(path) <= 0.5
        see_text(page, announcements,
                 f"Job {created['id']} reserved {notch_units('10', 'video_second')}, {credits_text(bal['available_micro'])} credits available")
        tab.focus()
        expect(tab).to_be_focused()
        submit(base, "mara", "reel-10", reel(created["input"]["prompt"], 10), key=key)
        see_text(page, announcements, f"Job {created['id']} already reserved; nothing added", LIVE_UPDATE_S + GRACE_S)
        expect_status(cancel(base, "mara", created["id"]), 200)
        after = ledger(base, STOREFRONT)["balances"]["available_micro"]
        see_text(page, announcements, f"Job {created['id']} released {credits_text(created['reserved_micro'])} credits, {credits_text(after)} credits available",
                 LIVE_UPDATE_S + GRACE_S)


def test_server_boundary(app_url: str) -> None:
    base = base_of(app_url)
    roomy(base, STOREFRONT)
    with httpx.Client(base_url=base, timeout=HTTP_TIMEOUT) as client:
        login = expect_status(client.post("/api/session", json={"email": EMAILS["mara"], "passcode": PASSCODE}), 200)
        cookie = login.headers.get(SET_COOKIE, "").lower()
        assert "HttpOnly".lower() in cookie and "SameSite=Strict".lower() in cookie
        newest = newest_job_id(base, STOREFRONT)
        r = client.post("/api/jobs", json={"model": "quill-still", "input": quill(word())},
                        headers={"Origin": CROSS_ORIGIN, "Idempotency-Key": idempotency_key()})
        error_of(r, 403, "cross_origin")
        assert newest_job_id(base, STOREFRONT) == newest
        same = data(client.post("/api/jobs", json={"model": "quill-still", "input": quill(word())},
                                headers={"Origin": base, "Idempotency-Key": idempotency_key()}), 201)["job"]
        cancel(base, "rafael", same["id"])
    bearer = data(call(base, "mara", "POST", "/api/jobs", body={"model": "quill-still", "input": quill(word())},
                       headers={"Origin": CROSS_ORIGIN, "Idempotency-Key": idempotency_key()}), 201)["job"]
    cancel(base, "rafael", bearer["id"])
    for method in CORS_METHODS:
        r = httpx.request(method, base + "/api/health", headers={"Origin": CROSS_ORIGIN, PREFLIGHT_HEADER: "POST"}, timeout=HTTP_TIMEOUT)
        assert CORS_HEADER not in {k.lower() for k in r.headers}
    core = json.dumps({"email": EMAILS["mara"], "passcode": PASSCODE})
    exact = core[:-1] + " " * (JSON_LIMIT - len(core)) + "}"
    assert len(exact.encode()) == JSON_LIMIT
    expect_status(call(base, None, "POST", "/api/session", content=exact, headers={"Content-Type": "application/json"}), 200)
    error_of(call(base, None, "POST", "/api/session", content=exact + " ", headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    error_of(call(base, None, "POST", "/api/session", content=core, headers={"Content-Type": NOT_JSON}), 415, "unsupported_media_type")
    error_of(call(base, None, "POST", "/api/session", content="{\"email\":", headers={"Content-Type": "application/json"}), 400, "malformed_json")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/node_modules/.package-lock.json", "/src/server.ts"):
        assert httpx.get(base + path, timeout=HTTP_TIMEOUT).status_code == 404, path


def test_wf_cross_cutting_sign_in(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    with open_app(browser, base + "/") as page:
        page.set_default_timeout(UI_TIMEOUT_MS)
        page.set_viewport_size({"width": 1280, "height": 800})
        form = page.get_by_role("form", name="Sign in")
        see(page, form)
        form.get_by_role("textbox", name="Email").fill(EMAILS["mara"])
        form.get_by_label("Passcode").fill("wrong-passcode")
        form.get_by_role("button", name="Sign in").click()
        see_text(page, page.get_by_role("alert").first, SIGN_IN_ERROR)
        form.get_by_label("Passcode").fill(PASSCODE)
        form.get_by_role("button", name="Sign in").click()
        see(page, page.get_by_role("region", name="Credit meter"))
        cookies = {c["name"]: c["value"] for c in page.context.cookies()}
        assert httpx.get(base + "/api/me", cookies=cookies, timeout=HTTP_TIMEOUT).status_code == 200
        page.get_by_role("button", name="Sign out").click()
        advance(page, STEP_MS)
        poll(lambda: httpx.get(base + "/api/me", cookies=cookies, timeout=HTTP_TIMEOUT).status_code == 401, GRACE_S, "session ended")


def test_wf_cross_cutting_mobile_nav(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    roomy(base, CAMPAIGNS)
    with ui(browser, base, "ines", width=768, height=1024) as page:
        opener = page.get_by_role("button", name="Catalogue")
        opener.click()
        dialog = page.get_by_role("dialog", name="Catalogue")
        see(page, dialog)
        dialog.get_by_role("button", name="Halftone XL", exact=True).click()
        gone(page, dialog)
        prompt = page.get_by_role("form", name=run_form("Halftone XL")).get_by_role("textbox", name="Prompt", exact=True)
        eventually(page, lambda: has_focus(prompt), UI_WAIT_S, "focus to form")
        opener.click()
        see(page, dialog)
        page.keyboard.press("Escape")
        gone(page, dialog)
        eventually(page, lambda: has_focus(opener), UI_WAIT_S, "focus back to Catalogue")
        page.set_viewport_size({"width": 375, "height": 812})
        page.get_by_role("button", name="Menu").click()
        see(page, page.get_by_role("navigation", name="Primary").get_by_role("link", name="Jobs", exact=True))


def shipped_packages() -> tuple[Path, dict[tuple[str, str], str]]:
    root = APP_ROOT if (APP_ROOT / "node_modules").is_dir() else Path(DEPLOYED_APP)
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json"], cwd=root, capture_output=True, text=True, timeout=600)
    tree = json.loads(out.stdout)
    found: dict[tuple[str, str], str] = {}

    def walk(deps: dict[str, Any] | None) -> None:
        for name, info in (deps or {}).items():
            if not info.get("version"):
                continue
            key = (name, info.get("version", ""))
            if key not in found:
                found[key] = ""
                walk(info.get("dependencies"))
    walk(tree.get("dependencies"))
    for manifest in (root / "node_modules").rglob("package.json"):
        try:
            meta = json.loads(manifest.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        key = (meta.get("name", ""), meta.get("version", ""))
        if key in found and not found[key]:
            lic = meta.get("license", "")
            found[key] = lic.get("type", "") if isinstance(lic, dict) else str(lic)
    return root, found


def licence_ok(lic: str) -> bool:
    s = lic.strip().strip("()").strip()
    if " OR " in s:
        return any(licence_ok(p) for p in s.split(" OR "))
    if " AND " in s:
        return all(licence_ok(p) for p in s.split(" AND "))
    return s in ALLOWED_LICENCES


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text(encoding=ENCODING))
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices_text = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding=ENCODING)
    _, found = shipped_packages()
    missing = sorted({name for name, _ in found if name not in notices_text})
    assert not missing, missing
    for font in FONTS:
        assert font in notices_text


def test_if_licences_allowed() -> None:
    _, found = shipped_packages()
    bad = sorted(f"{n}@{v}: {lic or 'none'}" for (n, v), lic in found.items() if not licence_ok(lic))
    assert not bad, bad


def test_if_state_only_postgres_minio() -> None:
    assert Postgres().tables()
    for folder, dirs, files in os.walk(DEPLOYED_APP):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            assert Path(f).suffix not in DB_SUFFIXES, os.path.join(folder, f)
    for proc in PROC.iterdir():
        if proc.name.isdigit():
            try:
                comm = (proc / PROC_NAME_FILE).read_text().strip()
            except OSError:
                continue
            assert comm not in DATASTORE_PROCS, comm


def test_if_service_definitions_untouched(app_url: str, killbill: Any) -> None:
    base = base_of(app_url)
    topup = data(call(base, "june", "POST", "/api/topups", body={"team_id": CAMPAIGNS, "credits": TOPUP_MIN}), 201)["topup"]
    account = killbill.account_by_key(CAMPAIGNS)
    assert account and topup["kb_payment_id"] in kb_payment_ids(killbill, account)
    up = data(upload(base, "mara", png()), 201)["asset"]
    assert upload_key(STOREFRONT, up["id"]) in S3().keys(f"uploads/{STOREFRONT}/")


def test_if_no_third_party_origins(app_url: str, browser: Any) -> None:
    base = base_of(app_url)
    media_hosts = {urlsplit(a["url"]).netloc for a in data(call(base, "mara", "GET", "/api/assets"), 200)["assets"] if a.get("url")}
    seen: list[str] = []
    with ui(browser, base, "mara") as page:
        page.on("request", lambda req: seen.append(req.url))
        for screen in ("Run", "Jobs", "Library", "Webhooks"):
            go(page, screen)
            advance(page, SEQUENCE_MAX_MS)
    foreign = [u for u in seen if not u.startswith(LOCAL_SCHEMES) and not same_origin(u, base) and urlsplit(u).netloc not in media_hosts]
    assert not foreign, foreign


def test_if_lockfile() -> None:
    assert (APP_ROOT / LOCKFILE).is_file()
    manifest = json.loads((APP_ROOT / "run.json").read_text(encoding=ENCODING))
    assert "npm ci" in manifest["install"]
