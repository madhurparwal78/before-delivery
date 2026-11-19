import contextlib
import datetime as dt
import hashlib
import html as htmllib
import json
import math
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, unquote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (Postgres, advance, animations, axe, capture, changed, check, click, decode, difference, fill,
                      idempotency_key, layout, open_app, select, state_styles, tab_order)

try:
    from conftest import DEPLOYED_APP
except ImportError:
    DEPLOYED_APP = os.environ.get("DEPLOYED_APP", "/app")


UTC = dt.timezone.utc
_UNSET = object()

HTTP_TIMEOUT_S = 15
JOB_DEADLINE_S = 60
UI_DEADLINE_S = 20
COPY_BOOT_S = 180
DB_RETURN_S = 60
POLL_MS = 500
STEP_MS = 250
CLOCK_PROBE_MS = 1000
LOOP_FRAMES = 3
POLL_INTERVAL_S = 0.2
EDGE_SLACK_S = 1
SLACK_S = 120
STABLE_TRIES = 5
CONCURRENT = 6
SUBPIXEL = 0.5

PASSWORD = "deku-demo-pw-2026"
MEMBER_PASSWORD = "verifier-pass-2026"
ADMIN_EMAIL, ADMIN_NAME = "admin@example.com", "Priya Natarajan"
EDITOR_EMAIL, EDITOR_NAME = "editor@example.com", "Marco Bell"
VIEWER_EMAIL, VIEWER_NAME = "viewer@example.com", "Dana Okafor"
OUTSIDER_EMAIL, OUTSIDER_NAME = "outsider@example.com", "Sasha Reyes"
LUMEN_WORKSPACE, OUTPOST_WORKSPACE = "Lumen Freight", "Outpost Data"
OUTPOST_SOURCE, OUTPOST_DESTINATION, OUTPOST_CONNECTION = "Outpost Events", "Outpost Warehouse", "Outpost Sync"
SEEDED_CONNECTION = "Shop Orders to Warehouse"

COLLECTIONS = ["users", "workspaces", "memberships", "invites", "connector_definitions", "sources", "destinations",
               "connections", "jobs", "audit_events", "builder_projects"]

STREAMS = ("customers", "orders", "invoices")
STREAM_SIZES = {"customers": 25, "orders": 120, "invoices": 40}
STREAM_FIELDS = {
    "customers": ["id", "name", "email", "country", "updated_at"],
    "orders": ["id", "customer_id", "amount_cents", "status", "updated_at"],
    "invoices": ["id", "order_id", "total_cents", "status", "updated_at"],
}
STREAM_STEP = {"customers": dt.timedelta(days=1), "orders": dt.timedelta(hours=1), "invoices": dt.timedelta(hours=3)}
SAMPLE_EPOCH = dt.datetime(2026, 1, 1, tzinfo=UTC)
SYNC_MODES = ["full_refresh_overwrite", "full_refresh_append", "incremental_append", "incremental_dedup"]
MODE_LABELS = {"full_refresh_overwrite": "Full refresh overwrite", "full_refresh_append": "Full refresh append",
               "incremental_append": "Incremental append", "incremental_dedup": "Incremental dedup"}
PLAN_MINIMUMS = {"starter": 60, "team": 15, "scale": 5, "private": 5}
FINAL = {"succeeded", "failed", "cancelled"}

CATALOG = [
    ("Sample Commerce API", "source", "Finance & Ops Analytics", ["cloud", "oss", "hybrid"], True),
    ("PostgreSQL", "source", "Databases", ["cloud", "oss", "hybrid"], False),
    ("MySQL", "source", "Databases", ["cloud", "oss", "hybrid"], False),
    ("MongoDB", "source", "Databases", ["cloud", "oss"], False),
    ("Ticket Desk", "source", "Sales & Support Analytics", ["cloud", "hybrid"], False),
    ("CRM Cloud", "source", "Sales & Support Analytics", ["cloud"], False),
    ("Ad Network", "source", "Marketing Analytics", ["cloud", "oss"], False),
    ("Product Events", "source", "Product Analytics", ["cloud", "oss", "hybrid"], False),
    ("File Drop CSV", "source", "Files", ["cloud", "oss", "hybrid"], False),
    ("Issue Tracker", "source", "Engineering Analytics", ["cloud", "oss"], False),
    ("Docs Workspace", "source", "Unstructured", ["cloud"], False),
    ("Team Calendar", "source", "Others", ["oss"], False),
    ("Wayline Warehouse", "destination", "Warehouses and Lakes", ["cloud", "oss", "hybrid"], True),
    ("Cloud Warehouse", "destination", "Warehouses and Lakes", ["cloud", "hybrid"], False),
    ("Lakehouse Tables", "destination", "Warehouses and Lakes", ["cloud", "oss"], False),
    ("Object Storage", "destination", "Files", ["cloud", "oss", "hybrid"], False),
    ("Vector Store", "destination", "Unstructured", ["cloud"], False),
]
CATALOG_SIZE = 17

APPENDED_MID_RUN = 30
NEXT_JOB_ORDERS = 150
FULL_SEED_RECORDS = 185
LOCKOUT_FAILURES = 5
LOCKOUT_DEFAULT_S = 900
INVITE_TTL_DEFAULT_S = 604800
INVITE_TTL_SHORT_S = 3
IDEMPOTENCY_TTL_SHORT_S = 6
NEXT_MAX = 2000
Q_MAX = 100
INPUT_BUDGET_S = 1
NAME_MAX = 80
INTERVAL_MAX = 1440
KEY_MAX = 255
LIMIT_MAX = 100
RECORDS_PAGE = 50
HISTORY_PAGE = 10
JOB_MIN_RUNNING_S = 8
JOB_MAX_S = 30
DEBOUNCE_MS = 300
HISTORY_REFRESH_MS = 5000
COUNT_UP_MS = 1500
FADE_MAX_MS = 500
STREAM_VIEWERS = 50
STREAM_BUDGET_S = 1
STREAM_RELEASE_S = 10
TOUCH_PX = 44

NARROWEST = 320
PHONE, PHONE_H = 375, 812
TABLET, TABLET_H = 768, 1024
WIDE, WIDE_H = 1280, 800
BELOW_TABLET, BELOW_RAIL, RAIL, BELOW_WIDE = 767, 991, 992, 1279

COPY_DB_OUTAGE = "Wayline can't reach its database right now. It keeps retrying on its own."
COPY_OUTAGE = "Wayline couldn't confirm this action. Check the list before trying again."
COPY_PERMISSION = "You don't have permission to do that."
COPY_WRONG_PASSWORD = "Email or password is incorrect."
COPY_UNKNOWN_FIELD = "This field is not accepted here."
COPY_INVITE_CREATED = "Invite created"
COPY_ALREADY_INVITED = "This person already has an open invitation."
COPY_ALREADY_MEMBER = "This person is already a member."
COPY_ROLE_UPDATED = "Role updated"
COPY_LAST_ADMIN = "The workspace needs at least one admin."
COPY_EXPIRED_INVITE = "This invitation has expired. Ask an admin for a new one."
COPY_REJECTED_KEY = "The source rejected the API key."
COPY_SOURCE_CREATED = "Source created"
COPY_NAME_TAKEN = "A connection with this name already exists."
COPY_DRAFT_RESTORED = "Signed in again. Your connection draft is restored."
COPY_STARTING = "Starting sync…"
COPY_RUNNING = "Sync running"
COPY_SUCCEEDED = "Sync succeeded"
COPY_CANCELLED = "Sync cancelled"
COPY_RESET = "Connection reset"
COPY_TURNED_OFF = "Connection turned off"
COPY_TURNED_ON = "Connection turned on"
COPY_PAUSED = "This connection is paused. Turn it on to sync."
COPY_ALREADY_RUNNING = "A sync is already running for this connection."
COPY_VERSION_MISMATCH = "This connection changed since you opened it. Showing the latest version."
COPY_BAD_LINK = "This page link is no longer valid."
COPY_BAD_YAML = "This YAML can't be read. Fix it before switching tabs."

REJECT_PREFIX = "revoked-"
SANDBOX_KEY = "sandbox-key-2026"
STARTING_MANIFEST = {
    "base_url": "/mock-api/v1",
    "auth": {"type": "api_key", "header": "X-Api-Key"},
    "streams": [{"name": "invoices", "path": "/invoices", "primary_key": ["id"], "record_selector": "data",
                 "paginator": {"page_size": 3}}],
}
INVOICES = [
    ("INV-1042", "AceTech Corp", 125000, "paid"),
    ("INV-1043", "Globex", 98000, "open"),
    ("INV-1044", "Initech", 45050, "paid"),
    ("INV-1045", "Umbrella Retail", 230000, "open"),
    ("INV-1046", "Soylent Foods", 15000, "paid"),
    ("INV-1047", "Hooli Labs", 87500, "void"),
    ("INV-1048", "Vandelay Imports", 64000, "open"),
]
INVOICE_SCHEMA = {"id": "string", "customer": "string", "total_cents": "integer", "status": "string"}
AUDIT_GENESIS = "0" * 64
CONSOLE = "/app"
ORDERS_TABLE = "shop_orders"
MALFORMED_ID = "abc"
WRONG_SANDBOX_KEY = "wrong-sandbox-key"
NUL_KEY = "probe\u0000key-01"


def app(rest: str = "") -> str:
    return CONSOLE + rest


def etag(version: int) -> str:
    return f'"{version}"'


def console_paths(pipe: "Pipe") -> list[str]:
    return [app(rest) for rest in ("", "/sources", "/destinations", f"/connections/{pipe.cid}", "/connections/new",
                                   f"/destinations/{pipe.did}/tables/{ORDERS_TABLE}", "/builder", "/settings")]

MARKETING_H1 = {
    "/": "Keep every system in step with your AI.",
    "/connectors": "Reach the data in every system you run.",
    "/pricing": "Plans that grow with your pipelines",
    "/connector-builder": "Build and deploy custom connectors",
    "/data-replication": "The open standard for data movement",
    "/hybrid": "Run the data plane yourself. Skip the upkeep.",
    "/mcp": "The Wayline MCP Server",
    "/context-layer": "One context layer for every agent, across every business system",
    "/why-open-source": "Own your context.",
    "/compare": "Compare the data movement tools",
    "/data-engineering-resources": "All Data Engineering Resources",
    "/signin": "Sign in to your Wayline account",
}
HOME_SUBCOPY = ("Link 300+ business systems to your analytics and model layers. Copy data, query it by meaning, "
                "and let agents act across the whole company. Run it in your warehouse, private cloud, or your own servers.")
PLANS = ("Starter", "Team", "Scale", "Private Cloud")
COMPARISON = {
    "Fastest Sync Interval": ("1 hr", "15 min", "5 min", "5 min"),
    "Cron Schedules": ("Included", "Included", "Included", "Included"),
    "Builder": ("Included", "Included", "Included", "Included"),
    "Single Sign-On": ("Not included", "Not included", "Included", "Included"),
    "Audit Log": ("Included", "Included", "Included", "Included"),
}
CAPTIONS = ("Every record that moves makes a sound.", "Rising pitch means more rows are arriving.",
            "Quiet means the pipeline is caught up.", "Wayline turns your syncs into signal.")
CHAPTERS = {"Arrival": 0, "Volume": 12, "Caught up": 24}
FILM_PATH = "assets/data-sonification-black-hole-at-the-center-of-the-perse-c38f6693.webm"
FILM_BYTES = 3113129
FILM_SHA256 = "796615525a18932854a8d00836ee5d745516c08bbcdba50e82c3b5033e28884d"

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class Api:
    def __init__(self, base: str, token: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.token = token
        self.user: dict | None = None
        self.email: str | None = None

    def request(self, method: str, path: str, payload: Any = _UNSET, *, raw: str | None = None,
                headers: dict | None = None, params: Any = None) -> httpx.Response:
        h = dict(headers or {})
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        content = None
        if raw is not None:
            content = raw
            h.setdefault("Content-Type", "application/json")
        elif payload is not _UNSET:
            content = json.dumps(payload)
            h.setdefault("Content-Type", "application/json")
        return httpx.request(method, self.base + path, content=content, headers=h, params=params,
                             timeout=HTTP_TIMEOUT_S, follow_redirects=False)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, payload: Any = _UNSET, **kw: Any) -> httpx.Response:
        return self.request("POST", path, payload, **kw)

    def patch(self, path: str, payload: Any = _UNSET, **kw: Any) -> httpx.Response:
        return self.request("PATCH", path, payload, **kw)

    def put(self, path: str, payload: Any = _UNSET, **kw: Any) -> httpx.Response:
        return self.request("PUT", path, payload, **kw)


def body(resp: httpx.Response, status: int) -> dict:
    assert resp.status_code == status, (resp.request.method, str(resp.request.url), resp.status_code, resp.text[:500])
    return resp.json()


def refused(resp: httpx.Response, status: int, code: str) -> dict:
    data = body(resp, status)
    assert data.get("error") == code, data
    assert data.get("request_id") and data["request_id"] == resp.headers.get("x-request-id"), (data, dict(resp.headers))
    return data


def invalid(resp: httpx.Response, field: str) -> dict:
    data = refused(resp, 400, "validation")
    assert field in data.get("fields", {}), data
    return data


def invalid_prefix(resp: httpx.Response, prefix: str) -> dict:
    data = refused(resp, 400, "validation")
    assert any(k == prefix or k.startswith(prefix + ".") for k in data.get("fields", {})), data
    return data


def invalid_any(resp: httpx.Response, *fields: str) -> dict:
    data = refused(resp, 400, "validation")
    assert set(fields) & set(data.get("fields", {})), data
    return data


def tag() -> str:
    return uuid.uuid4().hex[:8]


def person(prefix: str = "Member") -> tuple[str, str]:
    t = tag()
    return f"{prefix} {t}", f"{prefix.lower()}-{t}@example.com"


def login(base: str, email: str, password: str = PASSWORD) -> Api:
    data = body(Api(base).post("/api/auth/login", {"email": email, "password": password}), 200)
    api = Api(base, data["token"])
    api.user = data["user"]
    api.email = data["user"]["email"]
    return api


def invite(admin: Api, role: str, *, email: str | None = None, name: str | None = None) -> dict:
    if email is None or name is None:
        n, e = person("Member")
        name, email = name or n, email or e
    return body(admin.post("/api/members", {"email": email, "name": name, "role": role}), 201)


def new_member(base: str, role: str) -> Api:
    inv = invite(login(base, ADMIN_EMAIL), role)
    data = body(Api(base).post("/api/auth/accept-invite", {"invite_token": inv["invite_token"], "password": MEMBER_PASSWORD}), 200)
    api = Api(base, data["token"])
    api.user = data["user"]
    api.email = data["user"]["email"]
    return api


def make_source(api: Api, *, key: str | None = None, start_date: str = "2026-01-01") -> dict:
    payload = {"name": f"Source {tag()}", "definition_id": "sample-commerce-api",
               "config": {"api_key": key or f"key-{uuid.uuid4().hex}", "start_date": start_date}}
    return body(api.post("/api/sources", payload), 201)["source"]


def make_destination(api: Api) -> dict:
    return body(api.post("/api/destinations", {"name": f"Warehouse {tag()}", "definition_id": "wayline-warehouse"}), 201)["destination"]


def stream_entry(name: str, mode: str = "full_refresh_overwrite", *, selected: bool = True, custom: bool = False) -> dict:
    return {"name": name, "selected": selected, "sync_mode": mode,
            "cursor_field": None if custom else "updated_at", "primary_key": ["id"]}


def connection_body(source_id: str, destination_id: str, modes: dict[str, str], *, name: str | None = None,
                    prefix: str = "shop_", schedule: dict | None = None, policy: str = "propagate") -> dict:
    return {"name": name or f"Connection {tag()}", "source_id": source_id, "destination_id": destination_id,
            "namespace_prefix": prefix,
            "streams": [stream_entry(s, modes.get(s, "full_refresh_overwrite"), selected=s in modes) for s in STREAMS],
            "schedule": schedule or {"type": "manual"}, "schema_change_policy": policy}


@dataclass
class Pipe:
    source: dict
    destination: dict
    connection: dict

    @property
    def cid(self) -> str:
        return self.connection["id"]

    @property
    def did(self) -> str:
        return self.destination["id"]


def make_pipe(api: Api, modes: dict[str, str] | None = None, *, key: str | None = None,
              start_date: str = "2026-01-01", policy: str = "propagate") -> Pipe:
    src = make_source(api, key=key, start_date=start_date)
    dst = make_destination(api)
    conn = body(api.post("/api/connections", connection_body(src["id"], dst["id"], modes or {s: "full_refresh_overwrite" for s in STREAMS},
                                                             policy=policy)), 201)["connection"]
    return Pipe(src, dst, conn)


def connection(api: Api, cid: str) -> dict:
    return body(api.get(f"/api/connections/{cid}"), 200)["connection"]


def patch_connection(api: Api, cid: str, changes: dict, version: int | None = None) -> httpx.Response:
    v = connection(api, cid)["version"] if version is None else version
    return api.patch(f"/api/connections/{cid}", changes, headers={"If-Match": f'"{v}"'})


def sync(api: Api, cid: str, key: str | None = None) -> dict:
    headers = {"Idempotency-Key": key} if key else {}
    r = api.post(f"/api/connections/{cid}/sync", {}, headers=headers)
    assert r.status_code in (200, 201), r.text
    return r.json()["job"]


def get_job(api: Api, jid: str) -> dict:
    return body(api.get(f"/api/jobs/{jid}"), 200)["job"]


def wait_job(api: Api, jid: str, statuses: set[str] = FINAL) -> dict:
    return poll(lambda: (lambda j: j if j["status"] in statuses else None)(get_job(api, jid)), JOB_DEADLINE_S,
                f"job {jid} to reach {statuses}")


def run_job(api: Api, cid: str) -> dict:
    job = wait_job(api, sync(api, cid)["id"])
    assert job["status"] == "succeeded", job
    return job


def quick_job(api: Api, cid: str) -> dict:
    job = sync(api, cid)
    body(api.post(f"/api/jobs/{job['id']}/cancel", {}), 200)
    return get_job(api, job["id"])


def logs(api: Api, jid: str) -> list[dict]:
    return body(api.get(f"/api/jobs/{jid}/logs"), 200)["lines"]


def jobs_of(api: Api, cid: str | None = None) -> list[dict]:
    out: list[dict] = []
    params: dict[str, Any] = {"limit": LIMIT_MAX}
    if cid:
        params["connection_id"] = cid
    while True:
        data = body(api.get("/api/jobs", params=params), 200)
        out += data["jobs"]
        if not data["has_more"]:
            return out
        params["cursor"] = data["next_cursor"]


def tables(api: Api, did: str) -> dict[str, int]:
    return {t["name"]: t["row_count"] for t in body(api.get(f"/api/destinations/{did}/tables"), 200)["tables"]}


def state(api: Api, cid: str) -> dict[str, Any]:
    return {s["name"]: s["cursor_value"] for s in body(api.get(f"/api/connections/{cid}/state"), 200)["streams"]}


def sample_event(api: Api, sid: str, payload: dict) -> dict:
    return body(api.post(f"/api/sources/{sid}/sample-events", payload), 200)


def records_page(api: Api, did: str, table: str, limit: Any = None, cursor: str | None = None) -> httpx.Response:
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if cursor is not None:
        params["cursor"] = cursor
    return api.get(f"/api/destinations/{did}/tables/{table}/records", params=params)


def all_records(api: Api, did: str, table: str) -> list[dict]:
    out: list[dict] = []
    cursor = None
    while True:
        data = body(records_page(api, did, table, limit=LIMIT_MAX, cursor=cursor), 200)
        out += data["records"]
        if not data["has_more"]:
            return out
        cursor = data["next_cursor"]


def audit(admin: Api) -> list[dict]:
    return body(admin.get("/api/audit"), 200)["events"]


def sse_events(text: str) -> list[dict]:
    events = []
    for block in re.split(r"\r?\n\r?\n", text):
        event: dict[str, Any] = {"event": "message", "id": None, "data": None}
        data_lines = []
        for line in block.splitlines():
            if not line or line.startswith(":"):
                continue
            field, _, value = line.partition(":")
            value = value[1:] if value.startswith(" ") else value
            if field == "data":
                data_lines.append(value)
            elif field in ("event", "id"):
                event[field] = value
        if data_lines:
            event["data"] = "\n".join(data_lines)
            events.append(event)
    return events


def together(n: int, fn: Callable[[int], Any]) -> list[Any]:
    barrier = threading.Barrier(n)
    def run(i: int) -> Any:
        barrier.wait()
        return fn(i)
    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(run, range(n)))


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    end = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        assert time.monotonic() < end, f"timed out waiting for {what}"
        threading.Event().wait(POLL_INTERVAL_S)


def wait_seconds(seconds: float, base: str) -> None:
    end = time.monotonic() + seconds
    poll(lambda: (httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S), time.monotonic() >= end)[1],
         seconds + HTTP_TIMEOUT_S, f"{seconds} s to pass")


def parse_ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def slug(name: str) -> str:
    return name.lower().replace(" ", "-")


def warehouse_schema(did: str) -> str:
    return "warehouse_" + re.sub(r"[^a-z0-9_]", "_", did.lower())


def expected_ids(stream: str, start: str) -> list[int]:
    begin = dt.datetime.fromisoformat(start).replace(tzinfo=UTC)
    return [i for i in range(1, STREAM_SIZES[stream] + 1) if SAMPLE_EPOCH + i * STREAM_STEP[stream] >= begin]


def page_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", markup)
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", markup))).strip()


def nth_sunday(year: int, month: int, n: int) -> dt.date:
    first = dt.date(year, month, 1)
    return first + dt.timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))


def cron_values(text: str, lo: int, hi: int) -> set[int]:
    out: set[int] = set()
    for item in text.split(","):
        base, _, step = item.partition("/")
        if base == "*":
            a, b = lo, hi
        elif "-" in base:
            a, b = (int(x) for x in base.split("-"))
        else:
            a = b = int(base)
        out |= set(range(a, b + 1, int(step) if step else 1))
    return out


def cron_next(expr: str, zone: str, after: dt.datetime) -> dt.datetime:
    mi, ho, dom, mon, dow = expr.split()
    minutes, hours = cron_values(mi, 0, 59), cron_values(ho, 0, 23)
    days, months = cron_values(dom, 1, 31), cron_values(mon, 1, 12)
    weekdays = {d % 7 for d in cron_values(dow, 0, 7)}
    dom_free, dow_free = dom.startswith("*"), dow.startswith("*")
    z = ZoneInfo(zone)
    def day_ok(local: dt.datetime) -> bool:
        d_ok, w_ok = local.day in days, (local.weekday() + 1) % 7 in weekdays
        if not dom_free and not dow_free:
            return d_ok or w_ok
        return d_ok and w_ok
    start = after.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    for h in range(5 * 366 * 24):
        hour_start = start + dt.timedelta(hours=h)
        local_hour = hour_start.astimezone(z)
        if local_hour.month not in months or not day_ok(local_hour):
            continue
        for m in range(60):
            t = hour_start + dt.timedelta(minutes=m)
            if t <= after:
                continue
            local = t.astimezone(z)
            if local.fold or local.minute not in minutes or local.hour not in hours:
                continue
            if local.month in months and day_ok(local):
                return t
    raise AssertionError(f"no match for {expr}")


def next_run_text(iso: str, zone: str) -> str:
    t = parse_ts(iso).astimezone(ZoneInfo(zone))
    off = int(t.utcoffset().total_seconds() // 60)
    sign = "+" if off >= 0 else "-"
    return (f"{WEEKDAYS[t.weekday()]} {t.day} {MONTHS[t.month - 1]} {t.year}, {t.hour:02d}:{t.minute:02d} {zone} "
            f"(UTC{sign}{abs(off) // 60:02d}:{abs(off) % 60:02d})")


def short_url() -> str:
    return os.environ["APP_SHORT_URL"].rstrip("/")


def db_down_url() -> str:
    return os.environ["APP_DB_DOWN_URL"].rstrip("/")


PSQL_TIMEOUT_S = 60


def psql_admin(sql: str) -> None:
    done = subprocess.run(["psql", os.environ["DATABASE_URL"], "-v", "ON_ERROR_STOP=1", "-c", sql],
                          capture_output=True, text=True, timeout=PSQL_TIMEOUT_S)
    assert done.returncode == 0, done.stderr


@contextlib.contextmanager
def scratch_database() -> Iterator[str]:
    name = f"wayline_copy_{tag()}"
    psql_admin(f'CREATE DATABASE "{name}"')
    try:
        yield urlparse(os.environ["DATABASE_URL"])._replace(path="/" + name).geturl()
    finally:
        psql_admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def deployed_root() -> Path:
    return Path(DEPLOYED_APP)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class AppCopy:
    def __init__(self, database_url: str) -> None:
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.database_url = database_url
        self.log = tempfile.NamedTemporaryFile(prefix="wayline-copy-", suffix=".log", delete=False)
        self.proc: subprocess.Popen | None = None

    def start(self) -> None:
        serve = json.loads((deployed_root() / "run.json").read_text())["serve"]
        env = {**os.environ, "DATABASE_URL": self.database_url, "DB_URL": self.database_url,
               "APP_PUBLIC_PORT": str(self.port), "APP_PUBLIC_URL": self.base}
        self.proc = subprocess.Popen(serve, shell=True, cwd=deployed_root(), env=env, stdout=self.log,
                                     stderr=subprocess.STDOUT, start_new_session=True)

    def tail(self) -> str:
        return Path(self.log.name).read_text(errors="replace")[-3000:]

    def alive(self) -> bool:
        assert self.proc is not None and self.proc.poll() is None, f"app copy exited:\n{self.tail()}"
        return True

    def health(self) -> httpx.Response | None:
        try:
            return httpx.get(self.base + "/api/health", timeout=HTTP_TIMEOUT_S)
        except httpx.TransportError:
            return None

    def wait_ready(self, seconds: float) -> None:
        poll(lambda: self.alive() and (lambda r: r is not None and r.status_code == 200)(self.health()), seconds,
             "the app copy to be ready")

    def kill(self) -> None:
        if self.proc and self.proc.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(self.proc.pid, signal.SIGKILL)
            self.proc.wait(timeout=HTTP_TIMEOUT_S)

    def restart(self) -> None:
        self.kill()
        self.start()
        self.wait_ready(COPY_BOOT_S)


@contextlib.contextmanager
def app_copy(database_url: str) -> Iterator[AppCopy]:
    copy = AppCopy(database_url)
    try:
        copy.start()
        copy.wait_ready(COPY_BOOT_S)
        yield copy
    finally:
        copy.kill()


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]

    def start(self) -> None:
        self.sock.listen(64)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            upstream = socket.create_connection(self.target)
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        finally:
            with contextlib.suppress(OSError):
                dst.shutdown(socket.SHUT_WR)

    def stop(self) -> None:
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()


def via_relay(database_url: str, port: int) -> str:
    u = urlparse(database_url)
    userinfo = u.netloc.rsplit("@", 1)[0] + "@" if "@" in u.netloc else ""
    return u._replace(netloc=f"{userinfo}127.0.0.1:{port}").geturl()


def ensure(condition: Any, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def eventually(page: Page, fn: Callable[[], Any], seconds: float = UI_DEADLINE_S) -> None:
    end = time.monotonic() + seconds
    while True:
        try:
            fn()
            return
        except AssertionError:
            if time.monotonic() >= end:
                raise
            advance(page, STEP_MS)


def see(page: Page, loc: Locator, seconds: float = UI_DEADLINE_S) -> None:
    eventually(page, lambda: expect(loc).to_be_visible(timeout=POLL_MS), seconds)


def says(page: Page, loc: Locator, text: str, seconds: float = UI_DEADLINE_S) -> None:
    eventually(page, lambda: expect(loc).to_contain_text(text, timeout=POLL_MS), seconds)


def gone(page: Page, loc: Locator) -> None:
    eventually(page, lambda: expect(loc).to_have_count(0, timeout=POLL_MS))


def ready(loc: Locator, seconds: float = UI_DEADLINE_S) -> Locator:
    """The locator once it is visible and enabled, waiting with the page clock moving: `ready(x).focus()`."""
    eventually(loc.page, lambda: (expect(loc).to_be_visible(timeout=POLL_MS), expect(loc).to_be_enabled(timeout=POLL_MS)), seconds)
    return loc


def dismiss_consent(page: Page) -> None:
    see(page, page.get_by_role("heading", level=1))
    card = page.get_by_role("region", name="Cookie consent")
    try:
        see(page, card, 2)
    except AssertionError:
        return
    click(card.get_by_role("button", name="Dismiss"))
    gone(page, card)


def on_path(page: Page, path: str) -> None:
    eventually(page, lambda: ensure(urlparse(page.url).path == path, f"{page.url} is not {path}"))


def on_connection_page(page: Page) -> None:
    def opened() -> None:
        path = urlparse(page.url).path
        ensure(path.startswith(app("/connections/")) and path != app("/connections/new"), page.url)
    eventually(page, opened)


def check_box(loc: Locator) -> None:
    check(loc)


def visible_items(loc: Locator) -> list[Locator]:
    return [loc.nth(i) for i in range(loc.count()) if loc.nth(i).is_visible()]


def ui_login(page: Page, base: str, email: str, password: str = PASSWORD, *, go: bool = True) -> None:
    if go:
        page.goto(base + "/login")
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password", exact=True), password)
    click(page.get_by_role("button", name="Sign in"))


@contextlib.contextmanager
def console(browser: Browser, base: str, email: str, password: str = PASSWORD, *, path: str = CONSOLE,
            width: int = WIDE, height: int = WIDE_H, reduced: str = "no-preference",
            init: str | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/login", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": width, "height": height})
        if init:
            page.add_init_script(init)
            page.reload()
        ui_login(page, base, email, password, go=False)
        on_path(page, CONSOLE)
        if path != CONSOLE:
            page.goto(base + path)
        yield page


def job_row(page: Page, job_id: str) -> Locator:
    return page.get_by_role("table", name="Job history").get_by_role("row").filter(
        has=page.get_by_role("rowheader", name=f"Job {job_id[:8]}"))


def description(loc: Locator) -> str:
    return loc.evaluate("""el => (el.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)
        .map(id => { const n = document.getElementById(id); return n ? n.textContent.trim() : ''; }).join(' ')""")


def choose_role(loc: Locator, role: str, verify: bool = True) -> None:
    labels = loc.evaluate("el => el.tagName === 'SELECT' ? Array.from(el.options).map(o => o.text) : []")
    select(loc, next((l for l in labels if l.strip().lower() == role), role.capitalize()), verify=verify)


ANALYTICS_NAME = re.compile(r"^(_ga|_gid|_gat|_gcl|_fbp|_fbc|_hj|_pk_|_clck|_clsk|ajs_|amp_|amplitude|mp_|mixpanel|segment|utm_|analytics|_uet|hubspot|__hs)", re.I)


def no_analytics(page: Page) -> None:
    names = [c["name"] for c in page.context.cookies()]
    names += page.evaluate("() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]")
    assert not [n for n in names if ANALYTICS_NAME.search(n)], names


def shown_option(loc: Locator) -> str:
    return loc.evaluate("el => el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : el.textContent")


def collapse(texts: list[str]) -> list[str]:
    out: list[str] = []
    for t in texts:
        if t and (not out or out[-1] != t):
            out.append(t)
    return out


def luminance(css: str) -> float:
    nums = [float(x) for x in re.findall(r"[\d.]+", css)[:3]]
    def ch(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(nums[0]) + 0.7152 * ch(nums[1]) + 0.0722 * ch(nums[2])


BACKGROUND_JS = """el => { let n = el; while (n) { const c = getComputedStyle(n).backgroundColor;
  if (c && c !== 'transparent' && !/rgba\\([^)]*,\\s*0\\)$/.test(c)) return c; n = n.parentElement; }
  return getComputedStyle(document.documentElement).backgroundColor; }"""

LOOPS_JS = """() => document.getAnimations().filter(a => a.playState === 'running' && a.effect &&
  a.effect.getComputedTiming().iterations === Infinity).length"""

FRAMES_INIT = """(() => { window.__wlFrames = 0; const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) { window.__wlFrames++; return raf.call(window, cb); }; })();"""

AUDIO_INIT = """(() => {
  window.__wlAudio = {starts: [], media: 0}; const first = new WeakMap();
  if (window.AudioParam) for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
    const orig = AudioParam.prototype[m];
    AudioParam.prototype[m] = function (v, ...rest) { if (!first.has(this)) first.set(this, v); return orig.call(this, v, ...rest); };
  }
  for (const k of ['OscillatorNode', 'AudioBufferSourceNode', 'ConstantSourceNode']) { if (!window[k]) continue;
    const orig = window[k].prototype.start;
    window[k].prototype.start = function (...a) { const f = this.frequency;
      window.__wlAudio.starts.push({kind: k, freq: f ? (first.has(f) ? first.get(f) : f.value) : null});
      return orig.apply(this, a); }; }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { if (this instanceof HTMLAudioElement) window.__wlAudio.media++; return play.apply(this, a); };
})();"""

FOCUS_JS = """() => { const el = document.activeElement; if (!el || el === document.body) return null;
  const shown = n => { const s = getComputedStyle(n); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none'); };
  return {name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 60),
          shown: shown(el) || (!!el.parentElement && shown(el.parentElement))}; }"""

BOX_JS = """el => { const t = (el.labels && el.labels.length && (el.type === 'checkbox' || el.type === 'radio')) ? el.labels[0] : el;
  const r = t.getBoundingClientRect(); return {w: r.width, h: r.height, name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}; }"""


def frames_during(page: Page, ms: float) -> int:
    before = page.evaluate("() => window.__wlFrames || 0")
    advance(page, ms)
    return page.evaluate("() => window.__wlFrames || 0") - before


def assert_focus_visible(page: Page, presses: int) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        info = page.evaluate(FOCUS_JS)
        if info:
            assert info["shown"], f"no visible focus indicator on {info}"


def assert_targets(page: Page, locs: list[Locator], where: str) -> None:
    for loc in locs:
        for item in visible_items(loc):
            box = item.evaluate(BOX_JS)
            if box["w"] <= 1 and box["h"] <= 1:
                continue
            assert box["w"] >= TOUCH_PX - SUBPIXEL and box["h"] >= TOUCH_PX - SUBPIXEL, (where, box)


def control_locators(scope: Page | Locator) -> list[Locator]:
    return [scope.get_by_role(r) for r in ("button", "switch", "combobox", "textbox", "spinbutton", "checkbox", "radio", "tab")]


def test_health_ready(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    page = httpx.get(app_url + "/login", timeout=HTTP_TIMEOUT_S)
    assert page.status_code == 200
    me = body(login(app_url, ADMIN_EMAIL).get("/api/me"), 200)["user"]
    assert me["email"] == ADMIN_EMAIL and me["role"] == "admin"


def test_stored_collections(app_url):
    pg = Postgres()
    assert set(COLLECTIONS) <= {t.split(".")[-1].strip('"') for t in pg.tables()}
    admin = login(app_url, ADMIN_EMAIL)
    name, email = person("Mixed")
    mixed = email[0].upper() + email[1:].replace("@", "@E")
    inv = invite(admin, "viewer", email=mixed, name=name)
    body(Api(app_url).post("/api/auth/accept-invite", {"invite_token": inv["invite_token"], "password": MEMBER_PASSWORD}), 200)
    rows = pg.rows(f"SELECT row_to_json(u)::text AS t FROM users u WHERE row_to_json(u)::text LIKE '%{mixed.lower()}%'")
    assert len(rows) == 1 and mixed not in rows[0]["t"]
    assert pg.rows("SELECT workspace_id, lower(trim(name)) AS n, count(*) AS c FROM connections "
                   "GROUP BY 1, 2 HAVING count(*) > 1") == []
    assert pg.rows("SELECT connection_id, count(*) AS c FROM jobs WHERE status IN ('pending', 'running') "
                   "GROUP BY 1 HAVING count(*) > 1") == []
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    run_job(editor, pipe.cid)
    schema = warehouse_schema(pipe.did)
    assert pg.rows(f"SELECT count(*) AS n FROM \"{schema}\".\"shop_orders\"")[0]["n"] == STREAM_SIZES["orders"]
    homes = {r["table_schema"] for r in pg.rows("SELECT table_schema FROM information_schema.tables WHERE table_name = 'connections'")}
    assert "public" in homes


def test_seed_first_start_state(app_url):
    out = login(app_url, OUTSIDER_EMAIL)
    assert body(out.get("/api/stats"), 200) == {"records_synced": 0, "latency_seconds": None, "freshness_seconds": None}
    assert body(out.get("/api/jobs"), 200) == {"jobs": [], "next_cursor": None, "has_more": False}
    assert body(out.get("/api/audit"), 200) == {"events": []}
    ws = body(out.get("/api/workspace"), 200)["workspace"]
    assert ws["name"] == OUTPOST_WORKSPACE and ws["plan"] == "starter" and ws["min_interval_minutes"] == PLAN_MINIMUMS["starter"]
    dests = body(out.get("/api/destinations"), 200)["destinations"]
    assert [d["name"] for d in dests] == [OUTPOST_DESTINATION]
    assert body(out.get(f"/api/destinations/{dests[0]['id']}/tables"), 200) == {"tables": []}
    sources = body(out.get("/api/sources"), 200)["sources"]
    assert [s["name"] for s in sources] == [OUTPOST_SOURCE]
    assert sources[0]["config"].get("start_date") == "2026-01-01" and sources[0]["config"].get("api_key_set") is True
    conns = body(out.get("/api/connections"), 200)["connections"]
    assert [c["name"] for c in conns] == [OUTPOST_CONNECTION]
    c = conns[0]
    assert c["version"] == 1 and c["next_run_at"] is None and c["status"] == "active"
    assert c["namespace_prefix"] == "outpost_" and c["schema_change_policy"] == "propagate" and c["schedule"]["type"] == "manual"
    assert {s["name"]: (s["selected"], s["sync_mode"]) for s in c["streams"]} == {s: (True, "full_refresh_overwrite") for s in STREAMS}
    assert state(out, c["id"]) == {s: None for s in STREAMS}
    admin = login(app_url, ADMIN_EMAIL)
    assert body(admin.get("/api/workspace"), 200)["workspace"]["name"] == LUMEN_WORKSPACE
    members = {m["email"]: m for m in body(admin.get("/api/members"), 200)["members"]}
    for email, name in ((ADMIN_EMAIL, ADMIN_NAME), (EDITOR_EMAIL, EDITOR_NAME), (VIEWER_EMAIL, VIEWER_NAME)):
        assert members[email]["name"] == name
    defs = body(Api(app_url).get("/api/connector-definitions"), 200)["definitions"]
    assert len(defs) == CATALOG_SIZE
    pg = Postgres()
    for email in (ADMIN_EMAIL, EDITOR_EMAIL, VIEWER_EMAIL, OUTSIDER_EMAIL):
        assert pg.rows(f"SELECT count(*) AS n FROM users u WHERE row_to_json(u)::text LIKE '%\"{email}\"%'")[0]["n"] == 1
    for ws_name in (LUMEN_WORKSPACE, OUTPOST_WORKSPACE):
        assert pg.rows(f"SELECT count(*) AS n FROM workspaces w WHERE row_to_json(w)::text LIKE '%\"{ws_name}\"%'")[0]["n"] == 1
    for name, *_ in CATALOG:
        assert pg.rows(f"SELECT count(*) AS n FROM connector_definitions d WHERE row_to_json(d)::text LIKE '%\"{name}\"%'")[0]["n"] == 1


def test_wf_deployment_and_seed_restart_recovery():
    with scratch_database() as db, app_copy(db) as copy:
        editor = new_member(copy.base, "editor")
        pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
        job = sync(editor, pipe.cid)
        wait_job(editor, job["id"], {"running"})
        copy.restart()
        got = get_job(editor, job["id"])
        assert got["status"] == "failed" and got["failure_reason"] == "interrupted", (got, copy.tail())
        assert got["attempts"][-1]["status"] == "failed" and got["attempts"][-1]["failure_reason"] == "interrupted"
        assert got["ended_at"] is not None and got["records_committed"] == 0
        lines = logs(editor, job["id"])
        assert lines[-1]["message"] == "Sync failed: interrupted"
        events = sse_events(Api(copy.base).get(f"/api/jobs/{job['id']}/events", params={"token": editor.token}).text)
        assert events[-1]["event"] == "status" and json.loads(events[-1]["data"]) == {"status": "failed"}
        assert [json.loads(e["data"])["message"] for e in events if e["event"] == "log"] == [l["message"] for l in lines]
        assert tables(editor, pipe.did) == {}
        assert state(editor, pipe.cid) == {s: None for s in STREAMS}
        admin = login(copy.base, ADMIN_EMAIL)
        failed = [e for e in audit(admin) if e["target_id"] == job["id"] and e["action"] == "sync.failed"]
        assert len(failed) == 1 and failed[0]["actor_email"] == editor.email
        copy.restart()
        assert len([e for e in audit(admin) if e["target_id"] == job["id"] and e["action"] == "sync.failed"]) == 1
        assert get_job(editor, job["id"])["ended_at"] == got["ended_at"]
        again = sync(editor, pipe.cid)
        assert again["id"] != job["id"]
        body(editor.post(f"/api/jobs/{again['id']}/cancel", {}), 200)


def test_wf_deployment_and_seed_edits_survive():
    with scratch_database() as db, app_copy(db) as copy:
        admin = login(copy.base, ADMIN_EMAIL)
        seeded = next(c for c in body(admin.get("/api/connections"), 200)["connections"] if c["name"] == SEEDED_CONNECTION)
        viewer = next(m for m in body(admin.get("/api/members"), 200)["members"] if m["email"] == VIEWER_EMAIL)
        new_name = f"Renamed {tag()}"
        renamed = body(patch_connection(admin, seeded["id"], {"name": new_name}), 200)["connection"]
        assert renamed["version"] == seeded["version"] + 1
        body(admin.patch("/api/workspace", {"plan": "scale"}), 200)
        body(admin.patch(f"/api/members/{viewer['id']}", {"role": "editor"}), 200)
        before = run_job(admin, seeded["id"])
        base_orders = next(p["records_committed"] for p in before["per_stream"] if p["stream"] == "orders")
        sample_event(admin, seeded["source_id"], {"stream": "orders", "append": APPENDED_MID_RUN})
        version = connection(admin, seeded["id"])["version"]
        copy.restart()
        after = connection(admin, seeded["id"])
        assert after["name"] == new_name and after["version"] == version and after["status"] == "active"
        assert SEEDED_CONNECTION not in [c["name"] for c in body(admin.get("/api/connections"), 200)["connections"]]
        assert body(admin.get("/api/workspace"), 200)["workspace"]["plan"] == "scale"
        assert next(m for m in body(admin.get("/api/members"), 200)["members"] if m["email"] == VIEWER_EMAIL)["role"] == "editor"
        job = run_job(admin, seeded["id"])
        orders = next(p["records_committed"] for p in job["per_stream"] if p["stream"] == "orders")
        assert orders == base_orders + APPENDED_MID_RUN


def test_wf_deployment_and_seed_db_down(browser):
    base = db_down_url()
    h = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert h.status_code == 503 and h.json() == {"status": "starting"}
    refused(Api(base).get("/api/connections"), 503, "service_unavailable")
    refused(Api(base).post("/api/auth/login", {"email": ADMIN_EMAIL, "password": PASSWORD}), 503, "service_unavailable")
    for route, h1 in MARKETING_H1.items():
        r = httpx.get(base + route, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and h1 in page_text(r.text), route
    for route in ("/login", "/accept-invite", CONSOLE, app("/sources"), app(f"/connections/{MALFORMED_ID}")):
        assert httpx.get(base + route, timeout=HTTP_TIMEOUT_S).status_code == 200, route
    film = httpx.get(base + "/media/data-in-sound.webm", headers={"Range": "bytes=0-99"}, timeout=HTTP_TIMEOUT_S)
    assert film.status_code == 206
    assert httpx.get(base + "/media/data-in-sound.en.vtt", timeout=HTTP_TIMEOUT_S).status_code == 200
    missing = httpx.get(base + "/no-such-page-wayline", timeout=HTTP_TIMEOUT_S)
    assert missing.status_code == 404 and "home" in page_text(missing.text).lower()
    _, email = person("outage")
    with open_app(browser, base + "/login") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        ui_login(page, base, email, PASSWORD, go=False)
        says(page, page.get_by_role("alert"), COPY_DB_OUTAGE)
        eventually(page, lambda: expect(page.get_by_role("textbox", name="Email")).to_have_value(email, timeout=POLL_MS))
        on_path(page, "/login")
        eventually(page, lambda: expect(page.get_by_role("button", name="Sign in")).to_be_enabled(timeout=POLL_MS))


def test_wf_deployment_and_seed_db_returns():
    with scratch_database() as db:
        u = urlparse(db)
        relay = Relay(u.hostname, u.port or 5432)
        copy = AppCopy(via_relay(db, relay.port))
        try:
            copy.start()
            first = poll(lambda: copy.alive() and copy.health(), COPY_BOOT_S, "copy to listen")
            assert first.status_code == 503 and first.json() == {"status": "starting"}
            refused(Api(copy.base).post("/api/auth/login", {"email": ADMIN_EMAIL, "password": PASSWORD}), 503, "service_unavailable")
            assert httpx.get(copy.base + "/login", timeout=HTTP_TIMEOUT_S).status_code == 200
            pid = copy.proc.pid
            relay.start()
            copy.wait_ready(DB_RETURN_S)
            assert copy.proc.pid == pid
            login(copy.base, ADMIN_EMAIL)
        finally:
            copy.kill()
            relay.stop()


def test_sessions_and_lockout(app_url):
    member = new_member(app_url, "viewer")
    session = login(app_url, member.email, MEMBER_PASSWORD)
    body(session.get("/api/me"), 200)
    assert session.post("/api/auth/logout").status_code == 204
    refused(session.get("/api/me"), 401, "unauthenticated")
    login(app_url, f"  {member.email.upper()}  ", MEMBER_PASSWORD)
    anon = Api(app_url)
    wrong = {"password": "not-the-password", "next": app("/sources")}
    for _ in range(LOCKOUT_FAILURES - 1):
        refused(anon.post("/api/auth/login", {"email": member.email, **wrong}), 401, "invalid_credentials")
    login(app_url, member.email, MEMBER_PASSWORD)
    _, unknown = person("ghost")
    skip = {"date", "x-request-id", "content-length", "retry-after"}
    for _ in range(LOCKOUT_FAILURES):
        rk = anon.post("/api/auth/login", {"email": member.email, **wrong})
        ru = anon.post("/api/auth/login", {"email": unknown, **wrong})
        for r in (rk, ru):
            refused(r, 401, "invalid_credentials")
            assert app("/sources") not in r.text
        dk = {k: v for k, v in rk.json().items() if k != "request_id"}
        du = {k: v for k, v in ru.json().items() if k != "request_id"}
        assert dk == du and set(rk.headers) - skip == set(ru.headers) - skip
    for email in (member.email, unknown):
        r = anon.post("/api/auth/login", {"email": email, "password": MEMBER_PASSWORD})
        refused(r, 429, "too_many_attempts")
        assert 1 <= int(r.headers["retry-after"]) <= LOCKOUT_DEFAULT_S


def test_lockout_expires_short():
    base = short_url()
    member = new_member(base, "viewer")
    anon = Api(base)
    for _ in range(LOCKOUT_FAILURES):
        refused(anon.post("/api/auth/login", {"email": member.email, "password": "not-the-password"}), 401, "invalid_credentials")
    r = anon.post("/api/auth/login", {"email": member.email, "password": MEMBER_PASSWORD})
    refused(r, 429, "too_many_attempts")
    wait_seconds(int(r.headers["retry-after"]) + EDGE_SLACK_S, base)
    login(base, member.email, MEMBER_PASSWORD)


def test_signup_closed(app_url):
    name, email = person("signup")
    for api in (Api(app_url), login(app_url, ADMIN_EMAIL)):
        refused(api.post("/api/auth/signup", {"email": email, "password": MEMBER_PASSWORD, "name": name}), 404, "not_found")
    refused(Api(app_url).post("/api/auth/accept-invite", {"invite_token": f"forged-{tag()}", "password": MEMBER_PASSWORD}), 404, "not_found")
    refused(Api(app_url).post("/api/auth/login", {"email": email, "password": MEMBER_PASSWORD}), 401, "invalid_credentials")
    assert Postgres().rows(f"SELECT count(*) AS n FROM users u WHERE row_to_json(u)::text LIKE '%{email.lower()}%'")[0]["n"] == 0


def test_viewer_read_only(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor)
    project = body(editor.post("/api/builder/projects", {"name": f"Project {tag()}", "manifest": STARTING_MANIFEST}), 201)["project"]
    job = sync(editor, pipe.cid)
    viewer = new_member(app_url, "viewer")
    cid, sid, did, jid, pid = pipe.cid, pipe.source["id"], pipe.did, job["id"], project["id"]
    for path in ("/api/connections", f"/api/connections/{cid}", f"/api/connections/{cid}/state", "/api/sources",
                 f"/api/sources/{sid}", f"/api/sources/{sid}/catalog", "/api/destinations", f"/api/destinations/{did}/tables",
                 "/api/jobs", f"/api/jobs/{jid}", f"/api/jobs/{jid}/logs", "/api/stats", "/api/workspace", "/api/me"):
        body(viewer.get(path), 200)
    assert cid in [c["id"] for c in body(viewer.get("/api/connections"), 200)["connections"]]
    attempt_name = f"Viewer {tag()}"
    writes = [
        ("POST", "/api/sources", {"name": attempt_name, "definition_id": "sample-commerce-api", "config": {"api_key": "viewer-key-01", "start_date": "2026-01-01"}}),
        ("POST", "/api/destinations", {"name": attempt_name, "definition_id": "wayline-warehouse"}),
        ("POST", "/api/connections", connection_body(sid, did, {"orders": "full_refresh_overwrite"}, name=attempt_name, prefix="viewer_")),
        ("POST", f"/api/sources/{sid}/check", {}),
        ("POST", f"/api/sources/{sid}/sample-events", {"stream": "orders", "append": 1}),
        ("POST", f"/api/connections/{cid}/sync", {}),
        ("POST", f"/api/connections/{cid}/reset", {}),
        ("POST", f"/api/jobs/{jid}/cancel", {}),
        ("GET", "/api/builder/projects", _UNSET),
        ("GET", f"/api/builder/projects/{pid}", _UNSET),
        ("POST", "/api/builder/projects", {"name": attempt_name, "manifest": STARTING_MANIFEST}),
        ("PUT", f"/api/builder/projects/{pid}", {"name": attempt_name, "manifest": STARTING_MANIFEST}),
        ("POST", f"/api/builder/projects/{pid}/test", {"stream": "invoices", "api_key": SANDBOX_KEY}),
        ("POST", f"/api/builder/projects/{pid}/publish", {}),
    ]
    for method, path, payload in writes:
        refused(viewer.request(method, path, payload), 403, "forbidden")
    refused(viewer.patch(f"/api/connections/{cid}", {"name": attempt_name}, headers={"If-Match": etag(1)}), 403, "forbidden")
    assert connection(editor, cid)["version"] == 1
    assert get_job(editor, jid)["status"] in {"pending", "running"}
    assert len(jobs_of(editor, cid)) == 1
    assert attempt_name not in [s["name"] for s in body(editor.get("/api/sources"), 200)["sources"]]
    body(viewer.patch("/api/me/preferences", {"theme": "dark"}), 200)
    body(editor.post(f"/api/jobs/{jid}/cancel", {}), 200)


def test_editor_limits(app_url):
    editor = new_member(app_url, "editor")
    admin = login(app_url, ADMIN_EMAIL)
    plan = body(admin.get("/api/workspace"), 200)["workspace"]["plan"]
    name, email = person("blocked")
    for method, path, payload in [
        ("GET", "/api/members", _UNSET),
        ("POST", "/api/members", {"email": email, "name": name, "role": "viewer"}),
        ("PATCH", f"/api/members/{admin.user['id']}", {"role": "viewer"}),
        ("PATCH", f"/api/members/{editor.user['id']}", {"role": "admin", "workspace_id": "x"}),
        ("PATCH", "/api/workspace", {"plan": "scale"}),
        ("GET", "/api/audit", _UNSET),
        ("GET", "/api/audit/1", _UNSET),
    ]:
        refused(editor.request(method, path, payload), 403, "forbidden")
    assert body(admin.get("/api/workspace"), 200)["workspace"]["plan"] == plan
    assert body(editor.get("/api/me"), 200)["user"]["role"] == "editor"
    assert Postgres().rows(f"SELECT count(*) AS n FROM invites i WHERE row_to_json(i)::text LIKE '%{email.lower()}%'")[0]["n"] == 0


def test_console_requires_session(app_url):
    ended = login(app_url, VIEWER_EMAIL)
    assert ended.post("/api/auth/logout").status_code == 204
    endpoints = [("GET", "/api/me"), ("PATCH", "/api/me/preferences"), ("GET", "/api/members"), ("POST", "/api/members"),
                 ("GET", "/api/workspace"), ("GET", "/api/stats"), ("GET", "/api/sources"), ("POST", "/api/sources"),
                 ("GET", "/api/destinations"), ("GET", "/api/connections"), ("POST", "/api/connections"),
                 ("GET", f"/api/connections/{MALFORMED_ID}"), ("POST", f"/api/connections/{MALFORMED_ID}/sync"), ("GET", "/api/jobs"),
                 ("GET", f"/api/jobs/{MALFORMED_ID}"), ("GET", f"/api/jobs/{MALFORMED_ID}/events"), ("GET", "/api/builder/projects"),
                 ("GET", "/api/audit"), ("POST", "/api/auth/logout")]
    for token in (None, f"junk-{tag()}", ended.token):
        for method, path in endpoints:
            payload = {} if method in ("POST", "PATCH") else _UNSET
            refused(Api(app_url, token).request(method, path, payload), 401, "unauthenticated")


def test_role_change_immediate(app_url):
    admin = login(app_url, ADMIN_EMAIL)
    member = new_member(app_url, "editor")
    make_source(member)
    body(admin.patch(f"/api/members/{member.user['id']}", {"role": "viewer"}), 200)
    refused(member.post("/api/sources", {"name": f"After {tag()}", "definition_id": "sample-commerce-api",
                                          "config": {"api_key": "after-key-01", "start_date": "2026-01-01"}}), 403, "forbidden")
    assert body(member.get("/api/me"), 200)["user"]["role"] == "viewer"
    body(admin.patch(f"/api/members/{member.user['id']}", {"role": "admin"}), 200)
    body(member.get("/api/audit"), 200)
    body(admin.patch(f"/api/members/{member.user['id']}", {"role": "editor"}), 200)
    refused(member.patch("/api/workspace", {"plan": "team"}), 403, "forbidden")


REFUSED_NEXT = ["https://evil.example", "//evil.example/app", "/\\evil.example", "/%2F%2Fevil.example",
                "/app/../api/members", "/app/%2e%2e/login", "javascript:alert(1)", "/application", "/app@evil.example"]


def test_return_address_rule(app_url):
    member = new_member(app_url, "viewer")
    anon = Api(app_url)
    def redirect(nxt: Any) -> str:
        payload = {"email": member.email, "password": MEMBER_PASSWORD}
        if nxt is not _UNSET:
            payload["next"] = nxt
        return body(anon.post("/api/auth/login", payload), 200)["redirect_to"]
    for nxt in REFUSED_NEXT + ["", _UNSET]:
        assert redirect(nxt) == CONSOLE, nxt
    kept = app(f"/connections/{MALFORMED_ID}?x=1")
    assert redirect(kept) == kept
    assert redirect(app("/./sources")) == app("/sources")
    invalid(anon.post("/api/auth/login", {"email": member.email, "password": MEMBER_PASSWORD, "next": 5}), "next")
    invalid(anon.post("/api/auth/login", {"email": member.email, "password": MEMBER_PASSWORD, "next": app("/" + "a" * NEXT_MAX)}), "next")


def test_unknown_fields_refused(app_url):
    admin = login(app_url, ADMIN_EMAIL)
    member = new_member(app_url, "editor")
    def unknown(resp: httpx.Response, field: str) -> None:
        data = invalid(resp, field)
        assert data["fields"][field] == COPY_UNKNOWN_FIELD
    theme = body(member.get("/api/me"), 200)["user"]["preferences"]["theme"]
    other = "dark" if theme == "light" else "light"
    unknown(member.patch("/api/me/preferences", {"theme": other, "role": "admin"}), "role")
    me = body(member.get("/api/me"), 200)["user"]
    assert me["preferences"]["theme"] == theme and me["role"] == "editor"
    inv = invite(admin, "viewer")
    unknown(Api(app_url).post("/api/auth/accept-invite", {"invite_token": inv["invite_token"], "password": MEMBER_PASSWORD, "role": "admin"}), "role")
    unknown(Api(app_url).post("/api/auth/accept-invite", {"invite_token": inv["invite_token"], "password": MEMBER_PASSWORD, "workspace_id": "x"}), "workspace_id")
    accepted = body(Api(app_url).post("/api/auth/accept-invite", {"invite_token": inv["invite_token"], "password": MEMBER_PASSWORD}), 200)
    assert accepted["user"]["role"] == "viewer"
    pipe = make_pipe(member)
    unknown(patch_connection(member, pipe.cid, {"name": f"Bumped {tag()}", "version": 9}), "version")
    after = connection(member, pipe.cid)
    assert after["version"] == 1 and after["name"] == pipe.connection["name"]
    unknown(admin.patch(f"/api/members/{member.user['id']}", {"role": "viewer", "workspace_id": "x"}), "workspace_id")
    unknown(admin.patch(f"/api/members/{member.user['id']}", {"role": "viewer", "email": "x@example.com"}), "email")
    assert body(member.get("/api/me"), 200)["user"]["role"] == "editor"
    assert not [e for e in audit(admin) if e["target_id"] == member.user["id"] and e["action"] == "member.role_changed"]
    src_name = f"Extra {tag()}"
    unknown(member.post("/api/sources", {"name": src_name, "definition_id": "sample-commerce-api",
                                         "config": {"api_key": "extra-key-01", "start_date": "2026-01-01", "api_key_set": True}}), "config.api_key_set")
    assert src_name not in [s["name"] for s in body(member.get("/api/sources"), 200)["sources"]]
    conn_body = connection_body(pipe.source["id"], make_destination(member)["id"], {"orders": "full_refresh_overwrite"})
    conn_body["streams"][0]["known_fields"] = ["id"]
    unknown(member.post("/api/connections", conn_body), "streams.0.known_fields")
    conn_body2 = connection_body(pipe.source["id"], pipe.did, {"orders": "full_refresh_overwrite"}, prefix="extra_")
    conn_body2["schedule"]["bogus"] = 1
    unknown(member.post("/api/connections", conn_body2), "schedule.bogus")
    names = [c["name"] for c in body(member.get("/api/connections"), 200)["connections"]]
    assert conn_body["name"] not in names and conn_body2["name"] not in names


def test_every_failing_field_named(app_url):
    member = new_member(app_url, "editor")
    theme = body(member.get("/api/me"), 200)["user"]["preferences"]["theme"]
    data = invalid(member.patch("/api/me/preferences", {"theme": "dark\u0000", "role": "admin"}), "theme")
    assert data["fields"].get("role") == COPY_UNKNOWN_FIELD, data
    me = body(member.get("/api/me"), 200)["user"]
    assert me["preferences"]["theme"] == theme and me["role"] == "editor"


def test_published_surface(app_url):
    admin = login(app_url, ADMIN_EMAIL)
    for api in (Api(app_url), admin):
        for path in ("/api/docs", "/api/openapi.json", "/api/connections/", "/api//connections"):
            refused(api.get(path), 404, "not_found")
    for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect", "/run.json", "/.venv", "/node_modules"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S, follow_redirects=False)
        assert r.status_code == 404, path
    cases = [("DELETE", f"/api/connections/{MALFORMED_ID}", {"GET", "PATCH"}), ("PUT", "/api/connections", {"GET", "POST"}),
             ("POST", "/api/me", {"GET"}), ("OPTIONS", "/api/audit", {"GET"}), ("TRACE", "/api/audit", {"GET"}),
             ("POST", "/api/audit/1", {"GET"}), ("DELETE", "/api/audit/1", {"GET"}), ("PATCH", "/api/audit/1", {"GET"})]
    for api in (Api(app_url), admin):
        for method, path, allow in cases:
            r = api.request(method, path)
            refused(r, 405, "method_not_allowed")
            assert {m.strip() for m in r.headers["allow"].split(",")} == allow, (method, path)
            assert not [h for h in r.headers if h.lower().startswith("access-control-")]
        head = api.request("HEAD", "/api/me")
        assert head.status_code == 405 and {m.strip() for m in head.headers["allow"].split(",")} == {"GET"}


def test_wf_sessions_and_roles_return_after_signin(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor)
    target = app(f"/connections/{pipe.cid}")
    with open_app(browser, app_url + target) as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        on_path(page, "/login")
        assert parse_qs(urlparse(page.url).query)["next"] == [target]
        ui_login(page, app_url, editor.email, MEMBER_PASSWORD, go=False)
        on_path(page, target)
        see(page, page.get_by_role("heading", level=1, name=pipe.connection["name"]))
        click(page.get_by_role("button", name="Account menu"))
        click(page.get_by_role("menuitem", name="Sign out"))
        on_path(page, "/")
        page.goto(app_url + app("/sources"))
        on_path(page, "/login")
        page.goto(app_url + "/login?next=" + quote("https://evil.example", safe=""))
        ui_login(page, app_url, editor.email, MEMBER_PASSWORD, go=False)
        on_path(page, CONSOLE)


def test_wf_sessions_and_roles_wrong_password(browser, app_url):
    member = new_member(app_url, "viewer")
    _, unknown_email = person("nobody")
    with open_app(browser, app_url + "/login") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        status = page.get_by_role("status", name="Sign-in status")
        for email in (unknown_email, member.email):
            ui_login(page, app_url, email, "not-the-password", go=False)
            says(page, status, COPY_WRONG_PASSWORD)
            on_path(page, "/login")
        for _ in range(LOCKOUT_FAILURES - 1):
            Api(app_url).post("/api/auth/login", {"email": member.email, "password": "not-the-password"})
        with page.expect_response(lambda r: r.url.endswith("/api/auth/login") and r.status == 429) as info:
            ui_login(page, app_url, member.email, MEMBER_PASSWORD, go=False)
        minutes = math.ceil(int(info.value.headers["retry-after"]) / 60)
        says(page, status, f"Too many sign-in attempts. Try again in {minutes} min.")
        on_path(page, "/login")


def test_wf_sessions_and_roles_landing_routes(browser, app_url):
    admin = login(app_url, ADMIN_EMAIL)
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor)
    outsider = login(app_url, OUTSIDER_EMAIL)
    foreign_conn = body(outsider.get("/api/connections"), 200)["connections"][0]["id"]
    foreign_dest = body(outsider.get("/api/destinations"), 200)["destinations"][0]["id"]
    with console(browser, app_url, editor.email, MEMBER_PASSWORD) as page:
        for refused_path in (app("/members"), app("/audit")):
            page.goto(app_url + app("/sources"))
            page.goto(app_url + refused_path)
            on_path(page, CONSOLE)
            says(page, page.get_by_role("alert"), COPY_PERMISSION)
            page.go_back()
            eventually(page, lambda p=refused_path: ensure(urlparse(page.url).path != p, "Back returned to the refused page"))
        page.goto(app_url + "/login")
        on_path(page, CONSOLE)
        for cid in (foreign_conn, MALFORMED_ID):
            page.goto(app_url + app(f"/connections/{cid}"))
            see(page, page.get_by_role("heading", level=1, name="Connection not found"))
            eventually(page, lambda: expect(page.get_by_role("link", name="Back to connections")).to_have_attribute("href", re.compile(re.escape(CONSOLE) + "$"), timeout=POLL_MS))
        for path in (app(f"/destinations/{foreign_dest}/tables/outpost_{STREAMS[1]}"), app(f"/destinations/{pipe.did}/tables/SHOP_ORDERS")):
            page.goto(app_url + path)
            see(page, page.get_by_role("heading", level=1, name="Table not found"))
            see(page, page.get_by_role("link", name="Back to destinations"))
        page.goto(app_url + CONSOLE)
        see(page, page.get_by_role("heading", level=1, name="Connections"))
        page.keyboard.press("Control+k")
        palette = page.get_by_role("dialog", name="Command palette")
        see(page, palette)
        fill(palette.get_by_role("textbox", name="Search commands"), "Members")
        advance(page, DEBOUNCE_MS)
        expect(palette.get_by_role("option", name=re.compile("Members"))).to_have_count(0)
        page.keyboard.press("Escape")
        body(admin.patch(f"/api/members/{editor.user['id']}", {"role": "viewer"}), 200)
        page.goto(app_url + app("/connections/new"))
        on_path(page, CONSOLE)
        says(page, page.get_by_role("alert"), COPY_PERMISSION)
        page.goto(app_url + app("/sources"))
        see(page, page.get_by_role("heading", level=1))
        eventually(page, lambda: expect(page.get_by_role("button", name="Create source")).to_have_count(0, timeout=POLL_MS))


def test_invitations(app_url):
    admin = login(app_url, ADMIN_EMAIL)
    name, email = person("invitee")
    invalid(admin.post("/api/members", {"email": email, "name": name, "role": "owner"}), "role")
    sent = time.time()
    inv = invite(admin, "editor", email=email, name=name)
    rec = inv["invite"]
    assert rec["email"] == email and rec["name"] == name and rec["role"] == "editor" and rec["id"] != inv["invite_token"]
    assert abs(parse_ts(rec["expires_at"]).timestamp() - (sent + INVITE_TTL_DEFAULT_S)) < SLACK_S
    refused(admin.post("/api/members", {"email": f"  {email.upper()} ", "name": name, "role": "viewer"}), 409, "already_invited")
    assert email not in [m["email"] for m in body(admin.get("/api/members"), 200)["members"]]
    anon = Api(app_url)
    refused(anon.post("/api/auth/accept-invite", {"invite_token": rec["id"], "password": MEMBER_PASSWORD}), 404, "not_found")
    invalid(anon.post("/api/auth/accept-invite", {"invite_token": inv["invite_token"], "password": "short-pass1"}), "password")
    acc = body(anon.post("/api/auth/accept-invite", {"invite_token": inv["invite_token"], "password": MEMBER_PASSWORD}), 200)
    assert acc["user"]["role"] == "editor"
    assert body(Api(app_url, acc["token"]).get("/api/me"), 200)["user"]["role"] == "editor"
    refused(anon.post("/api/auth/accept-invite", {"invite_token": inv["invite_token"], "password": MEMBER_PASSWORD}), 409, "invite_used")
    members = {m["email"]: m for m in body(admin.get("/api/members"), 200)["members"]}
    assert members[email]["role"] == "editor" and members[email]["id"] == acc["user"]["id"]
    refused(admin.post("/api/members", {"email": email.upper(), "name": name, "role": "viewer"}), 409, "already_member")
    other = body(admin.post("/api/members", {"email": OUTSIDER_EMAIL, "name": OUTSIDER_NAME, "role": "viewer"}), 201)
    refused(anon.post("/api/auth/accept-invite", {"invite_token": other["invite_token"], "password": MEMBER_PASSWORD}), 409, "invite_unusable")
    assert body(login(app_url, OUTSIDER_EMAIL).get("/api/me"), 200)["user"]["role"] == "admin"


def test_invite_expiry_short():
    base = short_url()
    admin = login(base, ADMIN_EMAIL)
    name, email = person("late")
    old = invite(admin, "viewer", email=email, name=name)
    wait_seconds(INVITE_TTL_SHORT_S + EDGE_SLACK_S, base)
    anon = Api(base)
    refused(anon.post("/api/auth/accept-invite", {"invite_token": old["invite_token"], "password": MEMBER_PASSWORD}), 410, "invite_expired")
    assert Postgres("_short").rows(f"SELECT count(*) AS n FROM users u WHERE row_to_json(u)::text LIKE '%{email.lower()}%'")[0]["n"] == 0
    fresh = invite(admin, "viewer", email=email, name=name)
    assert fresh["invite"]["id"] != old["invite"]["id"] and fresh["invite_token"] != old["invite_token"]
    body(anon.post("/api/auth/accept-invite", {"invite_token": fresh["invite_token"], "password": MEMBER_PASSWORD}), 200)
    refused(anon.post("/api/auth/accept-invite", {"invite_token": old["invite_token"], "password": MEMBER_PASSWORD}), 410, "invite_expired")


def test_roles_and_last_admin(app_url):
    admin = login(app_url, ADMIN_EMAIL)
    member = new_member(app_url, "viewer")
    assert body(admin.patch(f"/api/members/{member.user['id']}", {"role": "admin"}), 200)["member"]["role"] == "admin"
    assert body(admin.patch(f"/api/members/{member.user['id']}", {"role": "editor"}), 200)["member"]["role"] == "editor"
    invalid(admin.patch(f"/api/members/{member.user['id']}", {"role": "owner"}), "role")
    roles = {m["email"]: m["role"] for m in body(admin.get("/api/members"), 200)["members"]}
    assert roles[member.email] == "editor"
    changes = [e for e in audit(admin) if e["target_id"] == member.user["id"] and e["action"] == "member.role_changed"]
    assert len(changes) == 2 and all(e["actor_email"] == ADMIN_EMAIL for e in changes)
    outsider = login(app_url, OUTSIDER_EMAIL)
    refused(outsider.patch(f"/api/members/{outsider.user['id']}", {"role": "editor"}), 409, "last_admin")
    assert body(outsider.get("/api/me"), 200)["user"]["role"] == "admin"


def test_member_and_audit_ids_before_role(app_url):
    editor = new_member(app_url, "editor")
    outsider = login(app_url, OUTSIDER_EMAIL)
    for uid in (MALFORMED_ID, str(uuid.uuid4()), outsider.user["id"]):
        refused(editor.patch(f"/api/members/{uid}", {"role": "viewer"}), 404, "not_found")
    for seq in (MALFORMED_ID, "999999999"):
        refused(editor.get(f"/api/audit/{seq}"), 404, "not_found")
    refused(editor.patch(f"/api/members/{editor.user['id']}", {"role": "viewer"}), 403, "forbidden")


def test_audit_chain(app_url):
    admin = login(app_url, ADMIN_EMAIL)
    editor = new_member(app_url, "editor")
    sources = together(CONCURRENT, lambda i: make_source(editor))
    inv = invite(admin, "viewer")
    events = audit(admin)
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    prev = AUDIT_GENESIS
    for e in events:
        assert e["prev_hash"] == prev
        text = f"{e['prev_hash']}|{e['seq']}|{e['action']}|{e['target_id']}|{e['actor_email']}"
        assert e["hash"] == hashlib.sha256(text.encode()).hexdigest()
        prev = e["hash"]
    for src in sources:
        mine = [e for e in events if e["target_id"] == src["id"]]
        assert [(e["action"], e["actor_email"]) for e in mine] == [("source.created", editor.email)]
    invited = [e for e in events if e["target_id"] == inv["invite"]["id"]]
    assert [(e["action"], e["actor_email"]) for e in invited] == [("member.invited", ADMIN_EMAIL)]
    one = invited[0]
    assert body(admin.get(f"/api/audit/{one['seq']}"), 200)["event"] == one
    refused(admin.get(f"/api/audit/{MALFORMED_ID}"), 404, "not_found")
    for method in ("PATCH", "PUT", "DELETE"):
        refused(admin.request(method, f"/api/audit/{one['seq']}", {"action": "x"}), 405, "method_not_allowed")
    refused(admin.post("/api/audit", {"action": "x"}), 405, "method_not_allowed")
    assert body(admin.get(f"/api/audit/{one['seq']}"), 200)["event"] == one


def test_wf_members_and_audit_invite(browser, app_url):
    name, email = person("Invitee")
    admin = login(app_url, ADMIN_EMAIL)
    with console(browser, app_url, ADMIN_EMAIL, path=app("/members")) as page:
        status = page.get_by_role("status", name="Members status")
        email_box = page.get_by_role("textbox", name="Email")
        see(page, email_box)
        fill(email_box, email)
        fill(page.get_by_role("textbox", name="Name"), name)
        choose_role(page.get_by_role("combobox", name="Role", exact=True), "editor")
        click(page.get_by_role("button", name="Invite member"))
        says(page, status, COPY_INVITE_CREATED)
        found = re.findall(r"/accept-invite\?token=([A-Za-z0-9_\-.~%]+)", page.content())
        assert found, "invite link not shown"
        token = unquote(found[0])
        fill(email_box, email)
        fill(page.get_by_role("textbox", name="Name"), name)
        choose_role(page.get_by_role("combobox", name="Role", exact=True), "editor")
        click(page.get_by_role("button", name="Invite member"))
        eventually(page, lambda: expect(email_box).to_have_accessible_description(re.compile(re.escape(COPY_ALREADY_INVITED)), timeout=POLL_MS))
        page.reload()
        see(page, email_box)
        assert "/accept-invite?token=" not in page.content()
        with open_app(browser, app_url + f"/accept-invite?token={token}") as invitee:
            fill(invitee.get_by_label("Password", exact=True), MEMBER_PASSWORD)
            click(invitee.get_by_role("button", name="Accept invitation"))
            on_path(invitee, CONSOLE)
        member = next(m for m in body(admin.get("/api/members"), 200)["members"] if m["email"] == email)
        assert member["role"] == "editor"
        page.reload()
        role = page.get_by_role("combobox", name=f"Role for {name}")
        see(page, role)
        choose_role(role, "viewer")
        says(page, status, COPY_ROLE_UPDATED)
        assert next(m for m in body(admin.get("/api/members"), 200)["members"] if m["email"] == email)["role"] == "viewer"
        fill(email_box, email)
        fill(page.get_by_role("textbox", name="Name"), name)
        choose_role(page.get_by_role("combobox", name="Role", exact=True), "viewer")
        click(page.get_by_role("button", name="Invite member"))
        eventually(page, lambda: expect(email_box).to_have_accessible_description(re.compile(re.escape(COPY_ALREADY_MEMBER)), timeout=POLL_MS))
        page.goto(app_url + app("/settings"))
        see(page, page.get_by_role("combobox", name="Plan"))
    editor = new_member(app_url, "editor")
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app("/settings")) as page:
        see(page, page.get_by_role("switch", name="Dark theme"))
        eventually(page, lambda: expect(page.get_by_role("combobox", name="Plan")).to_have_count(0, timeout=POLL_MS))


def test_wf_members_and_audit_last_admin(browser, app_url):
    with console(browser, app_url, OUTSIDER_EMAIL, path=app("/members")) as page:
        role = page.get_by_role("combobox", name=f"Role for {OUTSIDER_NAME}")
        see(page, role)
        choose_role(role, "editor", verify=False)
        says(page, page.get_by_role("status", name="Members status"), COPY_LAST_ADMIN)
        eventually(page, lambda: ensure("admin" in shown_option(role).lower(), shown_option(role)))
    assert body(login(app_url, OUTSIDER_EMAIL).get("/api/me"), 200)["user"]["role"] == "admin"


def test_wf_members_and_audit_expired_invite(browser):
    base = short_url()
    admin = login(base, ADMIN_EMAIL)
    _, email = person("expired")
    inv = invite(admin, "viewer", email=email)
    wait_seconds(INVITE_TTL_SHORT_S + EDGE_SLACK_S, base)
    with open_app(browser, base + f"/accept-invite?token={inv['invite_token']}") as page:
        fill(page.get_by_label("Password", exact=True), MEMBER_PASSWORD)
        click(page.get_by_role("button", name="Accept invitation"))
        says(page, page.get_by_role("status", name="Invitation status"), COPY_EXPIRED_INVITE)
        on_path(page, "/accept-invite")
    refused(Api(base).post("/api/auth/login", {"email": email, "password": MEMBER_PASSWORD}), 401, "invalid_credentials")


def test_catalog_api(app_url):
    anon = Api(app_url)
    def ids(params: Any = None) -> set[str]:
        return {d["id"] for d in body(anon.get("/api/connector-definitions", params=params), 200)["definitions"]}
    def want(pred: Callable[..., bool]) -> set[str]:
        return {slug(n) for n, t, c, a, r in CATALOG if pred(n, t, c, a)}
    defs = {d["id"]: d for d in body(anon.get("/api/connector-definitions"), 200)["definitions"]}
    assert set(defs) == want(lambda *_: True)
    for name, typ, cat, avail, runnable in CATALOG:
        d = defs[slug(name)]
        assert (d["name"], d["slug"], d["type"], d["category"], set(d["availability"]), d["runnable"], d["custom"], d["version"]) == \
            (name, slug(name), typ, cat, set(avail), runnable, False, 1)
    assert ids({"type": "source"}) == want(lambda n, t, c, a: t == "source")
    assert ids({"type": "agent"}) == set()
    assert ids({"category": "Databases"}) == want(lambda n, t, c, a: c == "Databases")
    assert ids({"availability": "hybrid"}) == want(lambda n, t, c, a: "hybrid" in a)
    assert ids([("type", "source"), ("type", "destination")]) == want(lambda *_: True)
    assert ids({"availability": "oss,hybrid"}) == want(lambda n, t, c, a: "oss" in a or "hybrid" in a)
    assert ids({"type": "destination", "availability": "oss", "category": "Files"}) == \
        want(lambda n, t, c, a: t == "destination" and "oss" in a and c == "Files")
    assert ids({"q": "SQL"}) == {"postgresql", "mysql"}
    assert body(anon.get(f"/api/connector-definitions/{slug('PostgreSQL')}"), 200)["definition"]["name"] == "PostgreSQL"
    refused(anon.get(f"/api/connector-definitions/none-{tag()}"), 404, "not_found")


def test_catalog_search_literal(app_url):
    anon = Api(app_url)
    def search(q: str) -> httpx.Response:
        return anon.get("/api/connector-definitions", params={"q": q})
    for q in ("%", "_", "\\"):
        assert body(search(q), 200)["definitions"] == []
    assert {d["id"] for d in body(search("  sQl  "), 200)["definitions"]} == {"postgresql", "mysql"}
    assert len(body(search("   "), 200)["definitions"]) == CATALOG_SIZE
    assert body(search("x" * Q_MAX), 200)["definitions"] == []
    for q in ("x" * (Q_MAX + 1), "sq\x01l"):
        start = time.monotonic()
        invalid(search(q), "q")
        assert time.monotonic() - start < INPUT_BUDGET_S


def test_input_rules(app_url):
    editor = new_member(app_url, "editor")
    src = make_source(editor)
    dst = make_destination(editor)
    name = f"Input {tag()}"
    good = {"name": name, "definition_id": "sample-commerce-api", "config": {"api_key": "probe-key-0001", "start_date": "2026-01-01"}}
    conn = connection_body(src["id"], dst["id"], {"orders": "full_refresh_overwrite"}, name=name)
    cases = [
        ("POST", "/api/sources", {**good, "name": 5}, None, "name"),
        ("POST", "/api/sources", {**good, "config": "x"}, None, "config"),
        ("POST", "/api/sources", {**good, "name": "bad\u0000name"}, None, "name"),
        ("POST", "/api/sources", {**good, "config": {"api_key": NUL_KEY, "start_date": "2026-01-01"}}, None, "config.api_key"),
        ("POST", "/api/connections", {**conn, "streams": {}}, None, "streams"),
        ("PATCH", "/api/me/preferences", {"sync_sounds": "yes"}, None, "sync_sounds"),
        ("POST", "/api/sources", _UNSET, "[]", "body"),
        ("POST", "/api/sources", _UNSET, "{not json", "body"),
    ]
    for method, path, payload, raw, field in cases:
        start = time.monotonic()
        r = editor.request(method, path, payload, raw=raw)
        assert time.monotonic() - start < INPUT_BUDGET_S, (path, field)
        invalid(r, field)
        assert NUL_KEY not in r.text
    assert name not in [s["name"] for s in body(editor.get("/api/sources"), 200)["sources"]]
    assert name not in [c["name"] for c in body(editor.get("/api/connections"), 200)["connections"]]


def test_sources(app_url):
    editor = new_member(app_url, "editor")
    def payload(**over: Any) -> dict:
        p = {"name": f"Src {tag()}", "definition_id": "sample-commerce-api", "config": {"api_key": "valid-key-01", "start_date": "2026-01-01"}}
        p.update(over)
        return p
    refused(editor.post("/api/sources", payload(definition_id="postgresql")), 422, "connector_not_installed")
    refused(editor.post("/api/destinations", {"name": f"D {tag()}", "definition_id": "cloud-warehouse"}), 422, "connector_not_installed")
    invalid(editor.post("/api/sources", payload(definition_id="wayline-warehouse")), "definition_id")
    invalid(editor.post("/api/sources", payload(definition_id=f"none-{tag()}")), "definition_id")
    invalid(editor.post("/api/sources", payload(config={"api_key": "short", "start_date": "2026-01-01"})), "config.api_key")
    invalid(editor.post("/api/sources", payload(config={"api_key": "valid-key-01", "start_date": "01/01/2026"})), "config.start_date")
    invalid(editor.post("/api/sources", payload(name="x" * (NAME_MAX + 1))), "name")
    invalid(editor.post("/api/sources", payload(name="")), "name")
    src = make_source(editor)
    assert src["config"]["api_key_set"] is True and "api_key" not in src["config"] and src["config"]["start_date"] == "2026-01-01"
    assert body(editor.get(f"/api/sources/{src['id']}"), 200)["source"]["id"] == src["id"]
    assert body(editor.post(f"/api/sources/{src['id']}/check", {}), 200)["status"] == "succeeded"
    bad = make_source(editor, key=f"{REJECT_PREFIX}{tag()}")
    assert body(editor.post(f"/api/sources/{bad['id']}/check"), 200) == {"status": "failed", "message": COPY_REJECTED_KEY}
    streams = {s["name"]: s for s in body(editor.get(f"/api/sources/{src['id']}/catalog"), 200)["streams"]}
    assert set(streams) == set(STREAMS)
    for name, s in streams.items():
        assert s["fields"] == STREAM_FIELDS[name] and s["primary_key"] == ["id"] and s["cursor_field"] == "updated_at"
        assert set(s["supported_sync_modes"]) == set(SYNC_MODES)
    added = sample_event(editor, src["id"], {"stream": "orders", "add_field": "region"})
    assert "region" in added["fields"]
    after = {s["name"]: s for s in body(editor.get(f"/api/sources/{src['id']}/catalog"), 200)["streams"]}
    assert after["orders"]["fields"] == STREAM_FIELDS["orders"] + ["region"]


def test_source_names_every_failing_field(app_url):
    editor = new_member(app_url, "editor")
    both = invalid(editor.post("/api/sources", {"name": f"Source {tag()}", "definition_id": "sample-commerce-api",
                                                "config": {"api_key": "short", "start_date": "2026-13-45"}}), "config.api_key")
    assert "config.start_date" in both["fields"], both
    named = invalid(editor.post("/api/sources", {"name": "", "definition_id": "sample-commerce-api",
                                                 "config": {"api_key": "short", "start_date": "2026-01-01"}}), "name")
    assert "config.api_key" in named["fields"], named


def test_secret_never_leaks(app_url):
    editor = new_member(app_url, "editor")
    admin = login(app_url, ADMIN_EMAIL)
    key = f"secret-{uuid.uuid4().hex}"
    bad_key = f"{REJECT_PREFIX}{uuid.uuid4().hex}"
    refused_key = f"refused-{uuid.uuid4().hex}"
    def clean(resp: httpx.Response, *secrets: str) -> None:
        for s in secrets:
            assert s not in resp.text and all(s not in v for v in resp.headers.values())
    r = editor.post("/api/sources", {"name": f"S {tag()}", "definition_id": "sample-commerce-api",
                                     "config": {"api_key": refused_key, "start_date": "2026-13-45"}})
    invalid(r, "config.start_date")
    clean(r, refused_key)
    r = editor.post("/api/sources", {"name": f"S {tag()}", "definition_id": "sample-commerce-api",
                                     "config": {"api_key": key, "start_date": "2026-01-01"}})
    src = body(r, 201)["source"]
    clean(r, key)
    for path in ("/api/sources", f"/api/sources/{src['id']}"):
        clean(editor.get(path), key)
    clean(editor.post(f"/api/sources/{src['id']}/check", {}), key)
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"}, key=bad_key)
    clean(editor.post(f"/api/sources/{pipe.source['id']}/check", {}), bad_key)
    job = wait_job(editor, sync(editor, pipe.cid)["id"])
    assert job["status"] == "failed" and job["failure_reason"] == "auth_failed"
    for path in (f"/api/jobs/{job['id']}", f"/api/jobs/{job['id']}/logs"):
        clean(editor.get(path), bad_key)
    clean(editor.get(f"/api/jobs/{job['id']}/events", params={"token": editor.token}), bad_key)
    clean(admin.get("/api/audit"), key, bad_key)
    pg = Postgres()
    for t in pg.rows("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"):
        for secret in (key, bad_key, refused_key):
            n = pg.rows(f"SELECT count(*) AS n FROM public.\"{t['t']}\" AS x WHERE row_to_json(x)::text LIKE '%{secret}%'")[0]["n"]
            assert n == 0, (t["t"], "stores the key as readable text")


def test_wf_catalog_and_sources_catalog_address(browser, app_url):
    with open_app(browser, app_url + "/connectors?q=sql&availability=oss") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        dismiss_consent(page)
        count = page.get_by_role("status", name="Catalog results")
        search = page.get_by_role("textbox", name="Search connectors")
        says(page, count, "Showing 2")
        eventually(page, lambda: expect(search).to_have_value("sql", timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_role("checkbox", name="OSS")).to_be_checked(timeout=POLL_MS))
        see(page, page.get_by_role("link", name="PostgreSQL", exact=True))
        see(page, page.get_by_role("link", name="MySQL", exact=True))
        check_box(page.get_by_role("checkbox", name="Destinations"))
        says(page, count, "Showing 0")
        assert parse_qs(urlparse(page.url).query).get("type") == ["destination"]
        page.reload()
        says(page, count, "Showing 0")
        eventually(page, lambda: expect(page.get_by_role("checkbox", name="Destinations")).to_be_checked(timeout=POLL_MS))
        page.go_back()
        says(page, count, "Showing 2")
        eventually(page, lambda: expect(page.get_by_role("checkbox", name="Destinations")).not_to_be_checked(timeout=POLL_MS))
        dismiss_consent(page)
        click(page.get_by_role("button", name="Clear all"))
        says(page, count, f"Showing {CATALOG_SIZE}")
        eventually(page, lambda: expect(search).to_have_value("", timeout=POLL_MS))
        assert urlparse(page.url).query == ""
        page.goto(app_url + "/connectors?q=%25")
        says(page, count, "Showing 0")
        eventually(page, lambda: expect(search).to_have_value("%", timeout=POLL_MS))


def test_wf_catalog_and_sources_latest_wins(browser, app_url):
    stash: list[Any] = []
    with open_app(browser, app_url + "/connectors") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        def handler(route: Any) -> None:
            q = parse_qs(urlparse(route.request.url).query).get("q", [""])[0]
            if q == "my":
                stash.append(route)
            else:
                route.continue_()
        page.route("**/api/connector-definitions**", handler)
        count = page.get_by_role("status", name="Catalog results")
        says(page, count, f"Showing {CATALOG_SIZE}")
        dismiss_consent(page)
        search = page.get_by_role("textbox", name="Search connectors")
        fill(search, "my")
        eventually(page, lambda: ensure(stash, "first search not sent"))
        fill(search, "post")
        posts = sum("post" in n.lower() for n, *_ in CATALOG)
        says(page, count, f"Showing {posts}")
        try:
            with page.expect_response(lambda r: "q=my" in r.url, timeout=POLL_MS):
                stash[0].continue_()
        except PlaywrightError:
            pass
        advance(page, DEBOUNCE_MS)
        expect(count).to_have_text(f"Showing {posts}")
        expect(page.get_by_role("link", name="PostgreSQL", exact=True)).to_be_visible()
        expect(page.get_by_role("link", name="MySQL", exact=True)).to_have_count(0)
        assert parse_qs(urlparse(page.url).query).get("q") == ["post"]


def test_wf_catalog_and_sources_new_source(browser, app_url):
    editor = new_member(app_url, "editor")
    name = f"UI Source {tag()}"
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app("/sources")) as page:
        key = page.get_by_label("API key", exact=True)
        start = page.get_by_role("textbox", name="Start date")
        see(page, key)
        assert key.get_attribute("type") == "password" and start.get_attribute("type") in (None, "text")
        assert "YYYY-MM-DD" in description(start) + (start.get_attribute("placeholder") or "")
        fill(page.get_by_role("textbox", name="Name"), name)
        select(page.get_by_role("combobox", name="Connector"), "Sample Commerce API")
        fill(key, "short")
        fill(start, "2026-01-01")
        before = description(key)
        click(page.get_by_role("button", name="Create source"))
        eventually(page, lambda: ensure(description(key) != before, "no field error beneath API key"))
        assert name not in [s["name"] for s in body(editor.get("/api/sources"), 200)["sources"]]
        fill(key, f"ui-key-{tag()}")
        click(page.get_by_role("button", name="Create source"))
        says(page, page.get_by_role("status", name="Source form status"), COPY_SOURCE_CREATED)
    created = [s for s in body(editor.get("/api/sources"), 200)["sources"] if s["name"] == name]
    assert len(created) == 1 and created[0]["config"]["start_date"] == "2026-01-01"


def test_plan_limits():
    base = short_url()
    admin = login(base, ADMIN_EMAIL)
    editor = new_member(base, "editor")
    src, dst = make_source(editor), make_destination(editor)
    def create(schedule: dict) -> httpx.Response:
        return editor.post("/api/connections", connection_body(src["id"], dst["id"], {"orders": "full_refresh_overwrite"},
                                                               prefix=f"p{tag()}_", schedule=schedule))
    try:
        for plan, minimum in PLAN_MINIMUMS.items():
            ws = body(admin.patch("/api/workspace", {"plan": plan}), 200)["workspace"]
            assert ws["plan"] == plan and ws["min_interval_minutes"] == minimum
        invalid(admin.patch("/api/workspace", {"plan": "enterprise"}), "plan")
        body(admin.patch("/api/workspace", {"plan": "team"}), 200)
        refused(create({"type": "interval", "interval_minutes": 5}), 422, "frequency_exceeds_plan")
        kept = body(create({"type": "interval", "interval_minutes": PLAN_MINIMUMS["team"]}), 201)["connection"]
        for expr in ("*/10 * * * *", "0,50 * * * *"):
            refused(create({"type": "cron", "cron_expression": expr, "time_zone": "UTC"}), 422, "frequency_exceeds_plan")
        body(create({"type": "cron", "cron_expression": "*/15 * * * *", "time_zone": "UTC"}), 201)
        body(admin.patch("/api/workspace", {"plan": "starter"}), 200)
        refused(create({"type": "cron", "cron_expression": "0,15 * * * *", "time_zone": "UTC"}), 422, "frequency_exceeds_plan")
        refused(create({"type": "interval", "interval_minutes": PLAN_MINIMUMS["team"]}), 422, "frequency_exceeds_plan")
        body(create({"type": "cron", "cron_expression": "5 * * * *", "time_zone": "UTC"}), 201)
        body(create({"type": "interval", "interval_minutes": PLAN_MINIMUMS["starter"]}), 201)
        assert connection(editor, kept["id"])["schedule"]["interval_minutes"] == PLAN_MINIMUMS["team"]
    finally:
        admin.patch("/api/workspace", {"plan": "team"})


def test_connection_creation(app_url):
    editor = new_member(app_url, "editor")
    src, dst = make_source(editor), make_destination(editor)
    name = f"Create {tag()}"
    payload = connection_body(src["id"], dst["id"], {"orders": "incremental_append", "customers": "full_refresh_overwrite"}, name=name)
    conn = body(editor.post("/api/connections", payload), 201)["connection"]
    assert conn["status"] == "active" and conn["version"] == 1 and conn["next_run_at"] is None
    for key in ("name", "source_id", "destination_id", "namespace_prefix", "schema_change_policy"):
        assert conn[key] == payload[key]
    assert conn["schedule"] == {"type": "manual"}
    echoed = {s["name"]: s for s in conn["streams"]}
    assert echoed["orders"]["sync_mode"] == "incremental_append" and echoed["orders"]["selected"] is True
    assert set(echoed["orders"]["known_fields"]) == set(STREAM_FIELDS["orders"])
    assert editor.get(f"/api/connections/{conn['id']}").headers["etag"] == etag(conn["version"])
    refused(editor.post("/api/connections", {**payload, "name": f"  {name.upper()}  ", "namespace_prefix": "other_"}), 409, "name_taken")
    refused(editor.post("/api/connections", {**payload, "name": f"Other {tag()}"}), 409, "table_conflict")
    body(editor.post("/api/connections", {**payload, "name": f"Elsewhere {tag()}", "destination_id": make_destination(editor)["id"]}), 201)
    assert Postgres().rows(f"SELECT count(*) AS n FROM connections WHERE lower(name) = '{name.lower()}'")[0]["n"] == 1


def test_connection_validation(app_url):
    editor = new_member(app_url, "editor")
    src, dst = make_source(editor), make_destination(editor)
    foreign_src = body(login(app_url, OUTSIDER_EMAIL).get("/api/sources"), 200)["sources"][0]["id"]
    names = []
    def attempt(mutate: Callable[[dict], Any]) -> httpx.Response:
        p = connection_body(src["id"], dst["id"], {"orders": "incremental_append"})
        mutate(p)
        names.append(p["name"])
        return editor.post("/api/connections", p)
    invalid_prefix(attempt(lambda p: p["streams"].append(stream_entry("payments"))), "streams")
    invalid_prefix(attempt(lambda p: p.update(streams=p["streams"][:2])), "streams")
    invalid_prefix(attempt(lambda p: [s.update(selected=False) for s in p["streams"]]), "streams")
    invalid_prefix(attempt(lambda p: p["streams"][1].update(sync_mode="mirror")), "streams")
    invalid_prefix(attempt(lambda p: p["streams"][1].update(cursor_field=None)), "streams")
    invalid_prefix(attempt(lambda p: p["streams"][1].update(sync_mode="incremental_dedup", primary_key=["customer_id"])), "streams")
    for prefix in ("Shop_", "1shop_", "s" * 32, "shop-"):
        invalid(attempt(lambda p, x=prefix: p.update(namespace_prefix=x)), "namespace_prefix")
    for minutes in (0, INTERVAL_MAX + 1):
        invalid_prefix(attempt(lambda p, m=minutes: p.update(schedule={"type": "interval", "interval_minutes": m})), "schedule")
    for expr in ("0 12 * * MON", "0 12 ? * *", "0 12 L * *", "60 * * * *", "5-1 * * * *", "*/0 * * * *", "0 12 * *", "0 0 31 2 *"):
        invalid(attempt(lambda p, e=expr: p.update(schedule={"type": "cron", "cron_expression": e, "time_zone": "UTC"})), "schedule.cron_expression")
    invalid(attempt(lambda p: p.update(schedule={"type": "cron", "cron_expression": "0 12 * * *", "time_zone": "Mars/Olympus"})), "schedule.time_zone")
    invalid(attempt(lambda p: p.update(source_id=foreign_src)), "source_id")
    invalid(attempt(lambda p: p.update(destination_id=f"none-{tag()}")), "destination_id")
    stored = {c["name"] for c in body(editor.get("/api/connections"), 200)["connections"]}
    assert not stored & set(names)


def test_next_run_rules(app_url):
    editor = new_member(app_url, "editor")
    src = make_source(editor)
    ref = parse_ts(src["created_at"])
    ny = ZoneInfo("America/New_York")
    year = ref.year
    fall = nth_sunday(year, 11, 1)
    if ref >= dt.datetime(year, 11, fall.day, 1, 30, tzinfo=ny):
        fall = nth_sunday(year + 1, 11, 1)
    spring = nth_sunday(year, 3, 2)
    if ref >= dt.datetime(year, 3, spring.day, 3, 0, tzinfo=ny):
        spring = nth_sunday(year + 1, 3, 2)
    def create(schedule: dict) -> dict:
        p = connection_body(src["id"], make_destination(editor)["id"], {"orders": "full_refresh_overwrite"}, schedule=schedule)
        return body(editor.post("/api/connections", p), 201)["connection"]
    assert create({"type": "manual"})["next_run_at"] is None
    interval = create({"type": "interval", "interval_minutes": PLAN_MINIMUMS["starter"]})
    assert parse_ts(interval["next_run_at"]) == parse_ts(interval["created_at"]) + dt.timedelta(minutes=PLAN_MINIMUMS["starter"])
    for expr, zone in ((f"30 1 {fall.day} 11 *", "America/New_York"), (f"30 2 {spring.day} 3 *", "America/New_York"),
                       ("0 12 13 * 5", "Europe/Berlin"), ("0 12 * * 5", "Asia/Tokyo")):
        conn = create({"type": "cron", "cron_expression": expr, "time_zone": zone})
        assert conn["schedule"]["time_zone"] == zone
        assert parse_ts(conn["next_run_at"]) == cron_next(expr, zone, parse_ts(conn["created_at"])), (expr, zone)
    assert create({"type": "cron", "cron_expression": "0 12 * * *"})["schedule"]["time_zone"] == "UTC"
    off = body(patch_connection(editor, interval["id"], {"status": "inactive"}), 200)["connection"]
    assert off["next_run_at"] is None
    on = body(patch_connection(editor, interval["id"], {"status": "active"}), 200)["connection"]
    job = sync(editor, on["id"])
    started = wait_job(editor, job["id"], {"running"})["started_at"]
    body(editor.post(f"/api/jobs/{job['id']}/cancel", {}), 200)
    anchored = connection(editor, on["id"])
    assert parse_ts(anchored["next_run_at"]) == parse_ts(started) + dt.timedelta(minutes=PLAN_MINIMUMS["starter"])
    moved = body(patch_connection(editor, on["id"], {"schedule": {"type": "manual"}}), 200)["connection"]
    assert moved["next_run_at"] is None


def wizard_to_schedule(page: Page, source: str, destination: str, modes: dict[str, str]) -> None:
    see(page, page.get_by_role("combobox", name="Source"))
    select(page.get_by_role("combobox", name="Source"), source)
    click(page.get_by_role("button", name="Next"))
    see(page, page.get_by_role("combobox", name="Destination"))
    select(page.get_by_role("combobox", name="Destination"), destination)
    click(page.get_by_role("button", name="Next"))
    see(page, page.get_by_role("checkbox", name=f"Sync {STREAMS[1]}"))
    for s in STREAMS:
        box = page.get_by_role("checkbox", name=f"Sync {s}")
        if s in modes:
            if not box.is_checked():
                check_box(box)
            select(page.get_by_role("combobox", name=f"Sync mode for {s}"), MODE_LABELS[modes[s]])
        elif box.is_checked():
            click(box)
    click(page.get_by_role("button", name="Next"))
    see(page, page.get_by_role("combobox", name="Schedule"))


def test_wf_connection_setup_dashboard(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"}, key=f"{REJECT_PREFIX}{tag()}")
    job = wait_job(editor, sync(editor, pipe.cid)["id"])
    assert job["status"] == "failed"
    with console(browser, app_url, editor.email, MEMBER_PASSWORD) as page:
        see(page, page.get_by_role("heading", level=1, name="Connections"))
        for label in ("Records synced", "Latency", "Freshness"):
            see(page, page.get_by_text(label, exact=True).first)
        see(page, page.get_by_text(re.compile(r"\d+ connections need attention")).first)
        eventually(page, lambda: expect(page.get_by_text("All syncs healthy")).to_have_count(0, timeout=POLL_MS))
        link = page.get_by_role("link", name=re.compile(re.escape(pipe.connection["name"])))
        see(page, link)
        texts = [pipe.source["name"], pipe.destination["name"], "Failed", "—"]
        row_text = lambda: link.evaluate("""(a, texts) => {
            for (let e = a; e && e !== document.body; e = e.parentElement) {
                if (e !== a && e.querySelectorAll('a[href*="/connections/"]').length > 1) return '';
                if (texts.every(t => e.textContent.includes(t))) return e.textContent;  // DOM words, before text-transform
            }
            return '';
        }""", texts)
        eventually(page, lambda: ensure(row_text(), f"no row around the link shows {texts}"))
        click(link)
        on_path(page, app(f"/connections/{pipe.cid}"))
        page.goto(app_url + CONSOLE)
        click(page.get_by_role("button", name="New connection"))
        on_path(page, app("/connections/new"))


def test_wf_connection_setup_wizard(browser, app_url):
    editor = new_member(app_url, "editor")
    src, dst = make_source(editor), make_destination(editor)
    name = f"Wizard {tag()}"
    with console(browser, app_url, editor.email, MEMBER_PASSWORD) as page:
        see(page, page.get_by_role("heading", level=1, name="Connections"))
        click(page.get_by_role("button", name="New connection"))
        on_path(page, app("/connections/new"))
        see(page, page.get_by_role("combobox", name="Source"))
        current = page.evaluate("""() => { const el = Array.from(document.getElementsByTagName('*'))
            .find(n => n.getAttribute('aria-current') === 'step'); if (!el) return null;
            let n = el; while (n && n.tagName !== 'OL') n = n.parentElement;
            return {text: el.textContent.trim(), inList: !!n}; }""")
        assert current and current["inList"], current
        assert "Source" in current["text"] and "Destination" not in current["text"], current
        wizard_to_schedule(page, src["name"], dst["name"], {"orders": "incremental_append", "invoices": "full_refresh_append"})
        schedule = page.get_by_role("combobox", name="Schedule")
        select(schedule, "Cron")
        see(page, page.get_by_role("combobox", name="Time zone"))
        eventually(page, lambda: expect(page.get_by_role("spinbutton", name="Interval minutes")).to_have_count(0, timeout=POLL_MS))
        select(schedule, "Every N minutes")
        see(page, page.get_by_role("spinbutton", name="Interval minutes"))
        gone(page, page.get_by_role("combobox", name="Time zone"))
        fill(page.get_by_role("spinbutton", name="Interval minutes"), str(PLAN_MINIMUMS["starter"]))
        fill(page.get_by_role("textbox", name="Connection name"), name)
        fill(page.get_by_role("textbox", name="Namespace prefix"), "shop_")
        select(page.get_by_role("combobox", name="Schema change policy"), "Ignore")
        click(page.get_by_role("button", name="Back"))
        customers, orders = STREAMS[0], STREAMS[1]
        see(page, page.get_by_role("checkbox", name=f"Sync {orders}"))
        eventually(page, lambda: expect(page.get_by_role("checkbox", name=f"Sync {orders}")).to_be_checked(timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_role("checkbox", name=f"Sync {customers}")).not_to_be_checked(timeout=POLL_MS))
        assert shown_option(page.get_by_role("combobox", name=f"Sync mode for {orders}")).strip() == MODE_LABELS["incremental_append"]
        click(page.get_by_role("button", name="Next"))
        eventually(page, lambda: expect(page.get_by_role("textbox", name="Connection name")).to_have_value(name, timeout=POLL_MS))
        click(page.get_by_role("button", name="Create connection"))
        on_connection_page(page)
        see(page, page.get_by_role("heading", level=1, name=name))
        see(page, page.get_by_role("img", name=f"Data flow from {src['name']} to {dst['name']}"))
        see(page, page.get_by_role("table", name="Streams"))
        eventually(page, lambda: expect(page.get_by_role("table", name="Job history").get_by_role("rowheader")).to_have_count(0, timeout=POLL_MS))
    conn = next(c for c in body(editor.get("/api/connections"), 200)["connections"] if c["name"] == name)
    modes = {s["name"]: (s["selected"], s["sync_mode"]) for s in conn["streams"]}
    assert modes["orders"] == (True, "incremental_append") and modes["invoices"] == (True, "full_refresh_append")
    assert modes["customers"][0] is False
    assert conn["schedule"] == {"type": "interval", "interval_minutes": PLAN_MINIMUMS["starter"]}
    assert conn["schema_change_policy"] == "ignore" and conn["namespace_prefix"] == "shop_"


def test_wf_connection_setup_refusals(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    minimum = body(editor.get("/api/workspace"), 200)["workspace"]["min_interval_minutes"]
    fresh = f"Refused {tag()}"
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app("/connections/new")) as page:
        wizard_to_schedule(page, pipe.source["name"], pipe.destination["name"], {"customers": "full_refresh_overwrite"})
        name_box = page.get_by_role("textbox", name="Connection name")
        fill(name_box, pipe.connection["name"])
        fill(page.get_by_role("textbox", name="Namespace prefix"), "other_")
        click(page.get_by_role("button", name="Create connection"))
        see(page, page.get_by_text(COPY_NAME_TAKEN).first)
        eventually(page, lambda: expect(name_box).to_be_focused(timeout=POLL_MS))
        fill(name_box, fresh)
        select(page.get_by_role("combobox", name="Schedule"), "Every N minutes")
        fill(page.get_by_role("spinbutton", name="Interval minutes"), "5")
        click(page.get_by_role("button", name="Create connection"))
        see(page, page.get_by_text(f"Your plan allows syncs at most every {minimum} minutes.").first)
        on_path(page, app("/connections/new"))
    assert fresh not in [c["name"] for c in body(editor.get("/api/connections"), 200)["connections"]]


def test_wf_connection_setup_next_run_zone(browser, app_url):
    editor = new_member(app_url, "editor")
    src = make_source(editor)
    ref = parse_ts(src["created_at"])
    ny = ZoneInfo("America/New_York")
    fall = nth_sunday(ref.year, 11, 1)
    if ref >= dt.datetime(ref.year, 11, fall.day, 1, 30, tzinfo=ny):
        fall = nth_sunday(ref.year + 1, 11, 1)
    cron = body(editor.post("/api/connections", connection_body(src["id"], make_destination(editor)["id"], {"orders": "full_refresh_overwrite"},
                schedule={"type": "cron", "cron_expression": f"30 1 {fall.day} 11 *", "time_zone": "America/New_York"})), 201)["connection"]
    interval = body(editor.post("/api/connections", connection_body(src["id"], make_destination(editor)["id"], {"orders": "full_refresh_overwrite"},
                    schedule={"type": "interval", "interval_minutes": PLAN_MINIMUMS["starter"]})), 201)["connection"]
    cron_text = next_run_text(cron["next_run_at"], "America/New_York")
    assert cron_text.endswith("01:30 America/New_York (UTC-04:00)")
    interval_text = next_run_text(interval["next_run_at"], "UTC")
    assert interval_text.endswith("UTC (UTC+00:00)")
    with console(browser, app_url, editor.email, MEMBER_PASSWORD) as page:
        see(page, page.get_by_role("link", name=cron["name"]))
        see(page, page.get_by_text(cron_text).first)
        see(page, page.get_by_text(interval_text).first)
        for conn, text in ((cron, cron_text), (interval, interval_text)):
            page.goto(app_url + app(f"/connections/{conn['id']}"))
            see(page, page.get_by_role("heading", level=1, name=conn["name"]))
            see(page, page.get_by_text(text).first)


def test_one_job_at_a_time(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    job = sync(editor, pipe.cid)
    refused(editor.post(f"/api/connections/{pipe.cid}/sync", {}), 409, "sync_already_running")
    refused(editor.post(f"/api/connections/{pipe.cid}/reset", {}), 409, "sync_already_running")
    pg = Postgres()
    assert pg.rows(f"SELECT count(*) AS n FROM jobs WHERE connection_id = '{pipe.cid}'")[0]["n"] == 1
    body(editor.post(f"/api/jobs/{job['id']}/cancel", {}), 200)
    body(patch_connection(editor, pipe.cid, {"status": "inactive"}), 200)
    refused(editor.post(f"/api/connections/{pipe.cid}/sync", {}), 409, "connection_inactive")
    assert pg.rows(f"SELECT count(*) AS n FROM jobs WHERE connection_id = '{pipe.cid}'")[0]["n"] == 1


def test_simultaneous_requests(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    results = together(CONCURRENT, lambda i: editor.post(f"/api/connections/{pipe.cid}/sync", {}))
    wins = [r for r in results if r.status_code == 201]
    assert len(wins) == 1
    for r in results:
        if r.status_code != 201:
            refused(r, 409, "sync_already_running")
    pg = Postgres()
    assert pg.rows(f"SELECT count(*) AS n FROM jobs WHERE connection_id = '{pipe.cid}'")[0]["n"] == 1
    body(editor.post(f"/api/jobs/{wins[0].json()['job']['id']}/cancel", {}), 200)
    name = f"Race {tag()}"
    dests = [make_destination(editor)["id"] for _ in range(CONCURRENT)]
    results = together(CONCURRENT, lambda i: editor.post("/api/connections", connection_body(
        pipe.source["id"], dests[i], {"orders": "full_refresh_overwrite"}, name=name, prefix=f"r{i}_")))
    assert [r.status_code for r in results].count(201) == 1
    for r in results:
        if r.status_code != 201:
            refused(r, 409, "name_taken")
    assert pg.rows(f"SELECT count(*) AS n FROM connections WHERE lower(name) = '{name.lower()}'")[0]["n"] == 1
    dst = make_destination(editor)
    results = together(CONCURRENT, lambda i: editor.post("/api/connections", connection_body(
        pipe.source["id"], dst["id"], {"orders": "full_refresh_overwrite"}, prefix="same_")))
    assert [r.status_code for r in results].count(201) == 1
    for r in results:
        if r.status_code != 201:
            refused(r, 409, "table_conflict")


def test_idempotency(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    k = idempotency_key()
    payload = connection_body(pipe.source["id"], make_destination(editor)["id"], {"orders": "full_refresh_overwrite"})
    first = body(editor.post("/api/connections", payload, headers={"Idempotency-Key": k}), 201)["connection"]
    spaced = json.dumps(dict(reversed(list(payload.items()))), indent=2)
    replay = editor.post("/api/connections", raw=spaced, headers={"Idempotency-Key": k})
    assert replay.status_code in (200, 201) and replay.json()["connection"]["id"] == first["id"]
    refused(editor.post("/api/connections", {**payload, "name": f"Other {tag()}"}, headers={"Idempotency-Key": k}), 422, "idempotency_key_reused")
    refused(editor.post(f"/api/connections/{pipe.cid}/sync", {}, headers={"Idempotency-Key": k}), 422, "idempotency_key_reused")
    s = idempotency_key()
    r1 = editor.post(f"/api/connections/{pipe.cid}/sync", {}, headers={"Idempotency-Key": s})
    job = body(r1, 201)["job"]
    assert job["trigger_request_id"] == r1.headers["x-request-id"]
    again = editor.post(f"/api/connections/{pipe.cid}/sync", {}, headers={"Idempotency-Key": s})
    assert again.status_code in (200, 201) and again.json()["job"]["id"] == job["id"]
    refused(editor.post(f"/api/connections/{pipe.cid}/sync", {}), 409, "sync_already_running")
    body(editor.post(f"/api/jobs/{job['id']}/cancel", {}), 200)
    late = editor.post(f"/api/connections/{pipe.cid}/sync", {}, headers={"Idempotency-Key": s})
    assert late.status_code in (200, 201)
    assert late.json()["job"]["id"] == job["id"] and late.json()["job"]["trigger_request_id"] == job["trigger_request_id"]
    assert len(jobs_of(editor, pipe.cid)) == 1
    t = idempotency_key()
    burst_body = connection_body(pipe.source["id"], make_destination(editor)["id"], {"orders": "full_refresh_overwrite"})
    burst = together(CONCURRENT, lambda i: editor.post("/api/connections", burst_body, headers={"Idempotency-Key": t}))
    ids = set()
    for r in burst:
        if r.status_code in (200, 201):
            ids.add(r.json()["connection"]["id"])
        else:
            refused(r, 409, "idempotency_key_in_flight")
    assert len(ids) == 1
    assert Postgres().rows(f"SELECT count(*) AS n FROM connections WHERE name = '{burst_body['name']}'")[0]["n"] == 1
    other = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    u = idempotency_key()
    burst = together(CONCURRENT, lambda i: editor.post(f"/api/connections/{other.cid}/sync", {}, headers={"Idempotency-Key": u}))
    job_ids = set()
    for r in burst:
        if r.status_code in (200, 201):
            job_ids.add(r.json()["job"]["id"])
        else:
            refused(r, 409, "idempotency_key_in_flight")
    assert len(job_ids) == 1 and len(jobs_of(editor, other.cid)) == 1
    body(editor.post(f"/api/jobs/{job_ids.pop()}/cancel", {}), 200)
    for bad in ("x" * (KEY_MAX + 1), "has space"):
        invalid(editor.post(f"/api/connections/{other.cid}/sync", {}, headers={"Idempotency-Key": bad}), "Idempotency-Key")


def test_key_lifetime_short():
    base = short_url()
    editor = new_member(base, "editor")
    src = make_source(editor)
    k = idempotency_key()
    payload = connection_body(src["id"], make_destination(editor)["id"], {"orders": "full_refresh_overwrite"})
    first = body(editor.post("/api/connections", payload, headers={"Idempotency-Key": k}), 201)["connection"]
    assert editor.post("/api/connections", payload, headers={"Idempotency-Key": k}).json()["connection"]["id"] == first["id"]
    wait_seconds(IDEMPOTENCY_TTL_SHORT_S + EDGE_SLACK_S, base)
    refused(editor.post("/api/connections", payload, headers={"Idempotency-Key": k}), 409, "name_taken")
    other = connection_body(src["id"], make_destination(editor)["id"], {"orders": "full_refresh_overwrite"})
    second = body(editor.post("/api/connections", other, headers={"Idempotency-Key": k}), 201)["connection"]
    assert second["id"] != first["id"]
    assert editor.post("/api/connections", other, headers={"Idempotency-Key": k}).json()["connection"]["id"] == second["id"]
    s = idempotency_key()
    job1 = sync(editor, second["id"], key=s)
    wait_seconds(IDEMPOTENCY_TTL_SHORT_S + EDGE_SLACK_S, base)
    if get_job(editor, job1["id"])["status"] not in FINAL:
        assert editor.post(f"/api/jobs/{job1['id']}/cancel", {}).status_code in (200, 409)
    wait_job(editor, job1["id"])
    active = sync(editor, second["id"])
    refused(editor.post(f"/api/connections/{second['id']}/sync", {}, headers={"Idempotency-Key": s}), 409, "sync_already_running")
    body(editor.post(f"/api/jobs/{active['id']}/cancel", {}), 200)
    job2 = sync(editor, second["id"], key=s)
    assert job2["id"] != job1["id"]
    assert editor.post(f"/api/connections/{second['id']}/sync", {}, headers={"Idempotency-Key": s}).json()["job"]["id"] == job2["id"]
    body(editor.post(f"/api/jobs/{job2['id']}/cancel", {}), 200)


def test_wf_concurrency_and_idempotency_lost_answer(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    sync_keys: list[str] = []
    create_keys: list[str] = []
    lost = {"sync": True, "create": False}
    def on_sync(route: Any) -> None:
        sync_keys.append(route.request.headers.get("idempotency-key"))
        if lost["sync"]:
            lost["sync"] = False
            route.fetch()
            route.abort()
        else:
            route.continue_()
    def on_create(route: Any) -> None:
        if route.request.method != "POST":
            route.continue_()
            return
        create_keys.append(route.request.headers.get("idempotency-key"))
        if lost["create"]:
            lost["create"] = False
            route.fetch()
            route.abort()
        else:
            route.continue_()
    name = f"Lost {tag()}"
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}")) as page:
        page.route("**/api/connections/*/sync", on_sync)
        page.route("**/api/connections", on_create)
        sync_now = page.get_by_role("button", name="Sync now")
        see(page, sync_now)
        click(sync_now)
        says(page, page.get_by_role("alert"), COPY_OUTAGE)
        eventually(page, lambda: expect(sync_now).to_be_enabled(timeout=POLL_MS))
        click(sync_now)
        says(page, page.get_by_role("status", name="Sync status"), COPY_SUCCEEDED, JOB_DEADLINE_S)
        assert len(sync_keys) == 2 and sync_keys[0] and sync_keys[0] == sync_keys[1]
        assert len(jobs_of(editor, pipe.cid)) == 1
        click(sync_now)
        eventually(page, lambda: ensure(len(sync_keys) == 3, "third sync request"))
        assert sync_keys[2] != sync_keys[0]
        poll(lambda: len(jobs_of(editor, pipe.cid)) == 2, UI_DEADLINE_S, "a second job")
        body(editor.post(f"/api/jobs/{jobs_of(editor, pipe.cid)[0]['id']}/cancel", {}), 200)
        page.goto(app_url + app("/connections/new"))
        wizard_to_schedule(page, pipe.source["name"], pipe.destination["name"], {"customers": "full_refresh_overwrite"})
        name_box = page.get_by_role("textbox", name="Connection name")
        fill(name_box, pipe.connection["name"])
        fill(page.get_by_role("textbox", name="Namespace prefix"), "lost_")
        create = page.get_by_role("button", name="Create connection")
        click(create)
        see(page, page.get_by_text(COPY_NAME_TAKEN).first)
        fill(name_box, name)
        lost["create"] = True
        click(create)
        says(page, page.get_by_role("alert"), COPY_OUTAGE)
        eventually(page, lambda: expect(name_box).to_have_value(name, timeout=POLL_MS))
        eventually(page, lambda: expect(create).to_be_enabled(timeout=POLL_MS))
        click(create)
        on_connection_page(page)
        see(page, page.get_by_role("heading", level=1, name=name))
    assert len(create_keys) == 3 and create_keys[0] != create_keys[1] and create_keys[1] == create_keys[2]
    assert [c["name"] for c in body(editor.get("/api/connections"), 200)["connections"]].count(name) == 1


def test_wf_concurrency_and_idempotency_draft_after_401(browser, app_url):
    editor = new_member(app_url, "editor")
    other = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    name = f"Draft {tag()}"
    keys: list[str] = []
    deny = {"next": True}
    def on_create(route: Any) -> None:
        if route.request.method != "POST":
            route.continue_()
            return
        keys.append(route.request.headers.get("idempotency-key"))
        if deny["next"]:
            deny["next"] = False
            route.fulfill(status=401, headers={"Content-Type": "application/json"},
                          body=json.dumps({"error": "unauthenticated", "request_id": "probe-request-01"}))
        else:
            route.continue_()
    wizard = app("/connections/new")
    prefix = "draft_"
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=wizard) as page:
        page.route("**/api/connections", on_create)
        wizard_to_schedule(page, pipe.source["name"], pipe.destination["name"], {"customers": "full_refresh_overwrite"})
        fill(page.get_by_role("textbox", name="Connection name"), name)
        fill(page.get_by_role("textbox", name="Namespace prefix"), prefix)
        click(page.get_by_role("button", name="Create connection"))
        on_path(page, "/login")
        ui_login(page, app_url, editor.email, MEMBER_PASSWORD, go=False)
        on_path(page, wizard)
        says(page, page.get_by_role("status", name="Connection form status"), COPY_DRAFT_RESTORED)
        eventually(page, lambda: expect(page.get_by_role("textbox", name="Connection name")).to_have_value(name, timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_role("textbox", name="Namespace prefix")).to_have_value(prefix, timeout=POLL_MS))
        click(page.get_by_role("button", name="Create connection"))
        on_connection_page(page)
        assert len(keys) == 2 and keys[0] != keys[1]
        page.goto(app_url + wizard)
        see(page, page.get_by_role("combobox", name="Source"))
        eventually(page, lambda: expect(page.get_by_role("textbox", name="Connection name")).to_have_count(0, timeout=POLL_MS))
    assert [c["name"] for c in body(editor.get("/api/connections"), 200)["connections"]].count(name) == 1
    other_name = f"Draft {tag()}"
    deny["next"] = True
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=wizard) as page:
        page.route("**/api/connections", on_create)
        wizard_to_schedule(page, pipe.source["name"], pipe.destination["name"], {"invoices": "full_refresh_overwrite"})
        fill(page.get_by_role("textbox", name="Connection name"), other_name)
        fill(page.get_by_role("textbox", name="Namespace prefix"), "drafttwo_")
        click(page.get_by_role("button", name="Create connection"))
        on_path(page, "/login")
        ui_login(page, app_url, other.email, MEMBER_PASSWORD, go=False)
        eventually(page, lambda: ensure(urlparse(page.url).path.startswith(CONSOLE), page.url))
        page.goto(app_url + wizard)
        see(page, page.get_by_role("combobox", name="Source"))
        eventually(page, lambda: expect(page.get_by_role("textbox", name="Connection name")).to_have_count(0, timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_text(COPY_DRAFT_RESTORED)).to_have_count(0, timeout=POLL_MS))
    assert other_name not in [c["name"] for c in body(editor.get("/api/connections"), 200)["connections"]]


def test_job_events_stream(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite", "customers": "full_refresh_overwrite"})
    job = sync(editor, pipe.cid)
    with httpx.Client(timeout=httpx.Timeout(JOB_DEADLINE_S)) as client:
        with client.stream("GET", f"{app_url}/api/jobs/{job['id']}/events", params={"token": editor.token}) as resp:
            assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
            text = ""
            for chunk in resp.iter_text():
                text += chunk
                if "event: status" in text and text.rstrip().endswith("}"):
                    break
            live = sse_events(text)
    lines = logs(editor, wait_job(editor, job["id"])["id"])
    log_events = [e for e in live if e["event"] == "log"]
    assert [json.loads(e["data"]) for e in log_events] == lines
    assert [e["id"] for e in log_events] == [str(i) for i in range(1, len(lines) + 1)]
    assert live[-1]["event"] == "status" and live[-1]["id"] is None and json.loads(live[-1]["data"]) == {"status": "succeeded"}
    resumed = sse_events(editor.get(f"/api/jobs/{job['id']}/events", headers={"Last-Event-ID": "2"}).text)
    assert [e["id"] for e in resumed if e["event"] == "log"] == [str(i) for i in range(3, len(lines) + 1)]
    assert resumed[-1]["event"] == "status"
    junk = sse_events(editor.get(f"/api/jobs/{job['id']}/events", headers={"Last-Event-ID": "two"}).text)
    assert len([e for e in junk if e["event"] == "log"]) == len(lines)
    for params in (None, {"token": f"junk-{tag()}"}):
        r = Api(app_url).get(f"/api/jobs/{job['id']}/events", params=params)
        refused(r, 401, "unauthenticated")
        assert "application/json" in r.headers["content-type"]


def test_event_streams_release_db(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    pg = Postgres()
    app_sessions = ("SELECT state FROM pg_stat_activity WHERE datname = current_database() "
                    "AND usename <> current_user AND pid <> pg_backend_pid()")
    job = sync(editor, pipe.cid)
    wait_job(editor, job["id"], {"running"})
    baseline = len(pg.rows(app_sessions))
    opened = []
    try:
        for _ in range(STREAM_VIEWERS):
            client = httpx.Client(timeout=httpx.Timeout(JOB_DEADLINE_S))
            resp = client.send(client.build_request("GET", f"{app_url}/api/jobs/{job['id']}/events",
                                                    params={"token": editor.token}), stream=True)
            assert resp.status_code == 200
            opened.append((client, resp))
        for path in ("/api/health", f"/api/jobs/{job['id']}"):
            start = time.monotonic()
            r = editor.get(path)
            assert r.status_code == 200 and time.monotonic() - start < STREAM_BUDGET_S, path
        assert len(pg.rows(app_sessions)) < baseline + STREAM_VIEWERS
    finally:
        for client, resp in opened:
            resp.close()
            client.close()
    body(editor.post(f"/api/jobs/{job['id']}/cancel", {}), 200)
    def released() -> bool:
        rows = pg.rows(app_sessions)
        return len(rows) <= baseline and not [r for r in rows if r["state"] in ("active", "idle in transaction")]
    poll(released, STREAM_RELEASE_S, "app sessions to be released")


RECORD_TEXTS_JS = """el => { window.__wlTexts = []; const push = () => window.__wlTexts.push(el.textContent.trim()); push();
  new MutationObserver(push).observe(el, {childList: true, subtree: true, characterData: true}); }"""


def test_wf_live_sync_sync_now(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite", "customers": "full_refresh_overwrite"})
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}")) as page:
        see(page, page.get_by_role("heading", level=1, name=pipe.connection["name"]))
        status = page.get_by_role("status", name="Sync status")
        status.evaluate(RECORD_TEXTS_JS)
        click(page.get_by_role("button", name="Sync now"))
        job = poll(lambda: (jobs_of(editor, pipe.cid) or [None])[0], UI_DEADLINE_S, "the job")
        says(page, status, COPY_SUCCEEDED, JOB_DEADLINE_S)
        says(page, job_row(page, job["id"]), "Succeeded")
        assert collapse(page.evaluate("() => window.__wlTexts")) == [COPY_STARTING, COPY_RUNNING, COPY_SUCCEEDED]
        log_text = page.get_by_role("log", name="Live log").inner_text()
        for line in logs(editor, job["id"]):
            assert log_text.count(line["message"]) == 1, line["message"]
    assert tables(editor, pipe.did) == {"shop_orders": STREAM_SIZES["orders"], "shop_customers": STREAM_SIZES["customers"]}


def test_wf_live_sync_cancel_reset_switch(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    run_job(editor, pipe.cid)
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}")) as page:
        status = page.get_by_role("status", name="Sync status")
        click(page.get_by_role("button", name="Sync now"))
        cancel = page.get_by_role("button", name="Cancel")
        see(page, cancel)
        click(cancel)
        says(page, status, COPY_CANCELLED)
        latest = jobs_of(editor, pipe.cid)[0]
        assert latest["status"] == "cancelled" and latest["records_committed"] == 0
        assert tables(editor, pipe.did) == {"shop_orders": STREAM_SIZES["orders"]}
        reset = page.get_by_role("button", name="Reset")
        click(reset)
        dialog = page.get_by_role("alertdialog", name="Reset connection")
        see(page, dialog)
        eventually(page, lambda: expect(dialog.get_by_role("button", name="Keep tables")).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Escape")
        gone(page, dialog)
        eventually(page, lambda: expect(reset).to_be_focused(timeout=POLL_MS))
        assert tables(editor, pipe.did) == {"shop_orders": STREAM_SIZES["orders"]}
        click(reset)
        click(page.get_by_role("alertdialog", name="Reset connection").get_by_role("button", name="Reset tables"))
        says(page, status, COPY_RESET)
        assert tables(editor, pipe.did) == {"shop_orders": 0}
        switch = page.get_by_role("switch", name="Connection active")
        eventually(page, lambda: expect(switch).to_be_checked(timeout=POLL_MS))
        click(switch)
        says(page, page.get_by_role("status", name="Connection status"), COPY_TURNED_OFF)
        assert connection(editor, pipe.cid)["status"] == "inactive"
        click(page.get_by_role("button", name="Sync now"))
        says(page, status, COPY_PAUSED)
        click(switch)
        says(page, page.get_by_role("status", name="Connection status"), COPY_TURNED_ON)
        assert connection(editor, pipe.cid)["status"] == "active"


def test_wf_live_sync_reconnect(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    seen: list[str | None] = []
    def handler(route: Any) -> None:
        seen.append(route.request.headers.get("last-event-id"))
        if len(seen) == 1:
            job_id = re.search(r"/api/jobs/([^/]+)/events", route.request.url).group(1)
            first = poll(lambda: logs(editor, job_id), JOB_DEADLINE_S, "a first log line")[0]
            route.fulfill(status=200, headers={"Content-Type": "text/event-stream"},
                          body=f"id: 1\nevent: log\ndata: {json.dumps(first)}\n\n")
        else:
            route.continue_()
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}")) as page:
        page.route("**/api/jobs/*/events*", handler)
        click(page.get_by_role("button", name="Sync now"))
        says(page, page.get_by_role("status", name="Sync status"), COPY_SUCCEEDED, JOB_DEADLINE_S)
        assert len(seen) >= 2 and seen[1] == "1"
        job = jobs_of(editor, pipe.cid)[0]
        log_text = page.get_by_role("log", name="Live log").inner_text()
        for line in logs(editor, job["id"]):
            assert log_text.count(line["message"]) == 1, line["message"]


def test_flow_diagram_motion(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    flow = f"Data flow from {pipe.source['name']} to {pipe.destination['name']}"
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}"), init=FRAMES_INIT) as page:
        img = page.get_by_role("img", name=flow)
        see(page, img)
        assert animations(img) == [] and frames_during(page, CLOCK_PROBE_MS) < LOOP_FRAMES
        click(page.get_by_role("button", name="Sync now"))
        says(page, page.get_by_role("status", name="Sync status"), COPY_RUNNING)
        before = decode(capture(img))
        moving = bool(animations(img)) or frames_during(page, CLOCK_PROBE_MS) >= LOOP_FRAMES
        if not moving:
            changed(before, decode(capture(img)))
        body(editor.post(f"/api/jobs/{jobs_of(editor, pipe.cid)[0]['id']}/cancel", {}), 200)
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}"), reduced="reduce", init=FRAMES_INIT) as page:
        img = page.get_by_role("img", name=flow)
        see(page, img)
        click(page.get_by_role("button", name="Sync now"))
        says(page, page.get_by_role("status", name="Sync status"), COPY_RUNNING)
        before = decode(capture(img))
        assert animations(img) == [] and frames_during(page, CLOCK_PROBE_MS) < LOOP_FRAMES
        assert difference(before, decode(capture(img))) < 0.01
        body(editor.post(f"/api/jobs/{jobs_of(editor, pipe.cid)[0]['id']}/cancel", {}), 200)


def test_sync_sounds(browser, app_url):
    for sounds in (True, False):
        editor = new_member(app_url, "editor")
        body(editor.patch("/api/me/preferences", {"sync_sounds": sounds}), 200)
        pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
        with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}"), init=AUDIO_INIT) as page:
            switch = page.get_by_role("switch", name="Sync sounds")
            see(page, switch)
            if sounds:
                eventually(page, lambda: expect(switch).to_be_checked(timeout=POLL_MS))
            else:
                eventually(page, lambda: expect(switch).not_to_be_checked(timeout=POLL_MS))
            click(page.get_by_role("button", name="Sync now"))
            says(page, page.get_by_role("status", name="Sync status"), COPY_SUCCEEDED, JOB_DEADLINE_S)
            oscillators = lambda: [s for s in page.evaluate("() => window.__wlAudio.starts") if s["kind"] == "OscillatorNode"]
            if sounds:
                eventually(page, lambda: ensure(len(oscillators()) >= 2, "no two-note chime"))
            else:
                advance(page, CLOCK_PROBE_MS)
            audio = page.evaluate("() => window.__wlAudio")
            assert audio["media"] == 0
            if sounds:
                notes = [s["freq"] for s in oscillators()]
                assert notes[1] > notes[0], notes
            else:
                assert audio["starts"] == []


def test_full_refresh_sync(app_url):
    editor = new_member(app_url, "editor")
    start = "2026-01-03"
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite", "customers": "full_refresh_append"}, start_date=start)
    j1 = run_job(editor, pipe.cid)
    orders = expected_ids("orders", start)
    assert orders == list(range(48, 120 + 1))
    customers = expected_ids("customers", start)
    assert [r["id"] for r in all_records(editor, pipe.did, "shop_orders")] == orders
    assert [r["id"] for r in all_records(editor, pipe.did, "shop_customers")] == customers
    pg = Postgres()
    assert pg.rows(f"SELECT count(*) AS n FROM \"{warehouse_schema(pipe.did)}\".\"shop_orders\"")[0]["n"] == len(orders)
    j2 = run_job(editor, pipe.cid)
    rows = all_records(editor, pipe.did, "shop_orders")
    assert [r["id"] for r in rows] == orders and {r["_wayline_job_id"] for r in rows} == {j2["id"]}
    cust = all_records(editor, pipe.did, "shop_customers")
    assert [r["id"] for r in cust] == customers + customers
    assert [r["_wayline_job_id"] for r in cust] == [j1["id"]] * len(customers) + [j2["id"]] * len(customers)
    row = next(r for r in rows if r["id"] == 48)
    assert row["customer_id"] == (48 - 1) % 25 + 1 and row["amount_cents"] == 1000 + 25 * 48
    assert state(editor, pipe.cid)["orders"] is None


def test_incremental_sync(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "incremental_append", "invoices": "incremental_dedup"})
    run_job(editor, pipe.cid)
    cur = state(editor, pipe.cid)
    assert parse_ts(cur["orders"]) == SAMPLE_EPOCH + STREAM_SIZES["orders"] * STREAM_STEP["orders"]
    assert parse_ts(cur["invoices"]) == SAMPLE_EPOCH + STREAM_SIZES["invoices"] * STREAM_STEP["invoices"]
    assert cur["customers"] is None
    sample_event(editor, pipe.source["id"], {"stream": "orders", "append": APPENDED_MID_RUN})
    sample_event(editor, pipe.source["id"], {"stream": "invoices", "update_ids": [1, 2]})
    j2 = run_job(editor, pipe.cid)
    assert {p["stream"]: p["records_committed"] for p in j2["per_stream"]} == {"orders": APPENDED_MID_RUN, "invoices": 2}
    orders = all_records(editor, pipe.did, "shop_orders")
    assert [r["id"] for r in orders] == list(range(1, NEXT_JOB_ORDERS + 1))
    invoices = all_records(editor, pipe.did, "shop_invoices")
    assert sorted(r["id"] for r in invoices) == list(range(1, STREAM_SIZES["invoices"] + 1))
    assert {r["id"]: r["status"] for r in invoices}[1] == "refunded"
    cur = state(editor, pipe.cid)
    assert parse_ts(cur["orders"]) == max(parse_ts(r["updated_at"]) for r in orders)
    assert parse_ts(cur["invoices"]) == max(parse_ts(r["updated_at"]) for r in invoices)
    assert run_job(editor, pipe.cid)["records_committed"] == 0
    assert tables(editor, pipe.did) == {"shop_orders": NEXT_JOB_ORDERS, "shop_invoices": STREAM_SIZES["invoices"]}


def test_reconciled_figures(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_append", "invoices": "full_refresh_overwrite"})
    run_job(editor, pipe.cid)
    job = run_job(editor, pipe.cid)
    assert job["records_committed"] == sum(p["records_committed"] for p in job["per_stream"])
    stamped = 0
    for name, count in tables(editor, pipe.did).items():
        rows = all_records(editor, pipe.did, name)
        data = body(records_page(editor, pipe.did, name), 200)
        assert count == data["total_count"] == len(rows)
        stamped += sum(1 for r in rows if r["_wayline_job_id"] == job["id"])
    assert stamped == job["records_committed"]
    for _ in range(STABLE_TRIES):
        s1 = body(editor.get("/api/stats"), 200)
        done = [j for j in jobs_of(editor) if j["status"] == "succeeded"]
        s2 = body(editor.get("/api/stats"), 200)
        if s1["records_synced"] == s2["records_synced"]:
            break
    assert s1["records_synced"] == sum(j["records_committed"] for j in done)
    last = sorted(done, key=lambda j: j["ended_at"], reverse=True)[:HISTORY_PAGE]
    mean = sum((parse_ts(j["ended_at"]) - parse_ts(j["started_at"])).total_seconds() for j in last) / len(last)
    assert abs(s1["latency_seconds"] - mean) < 1
    assert s1["freshness_seconds"] >= 0


def test_job_record(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite", "customers": "full_refresh_overwrite"})
    j1 = run_job(editor, pipe.cid)
    assert j1["connection_id"] == pipe.cid and j1["connection_version"] == 1 and j1["definition_version"] == 1
    assert [(a["number"], a["status"], a["failure_reason"]) for a in j1["attempts"]] == [(1, "succeeded", None)]
    assert j1["failure_reason"] is None
    assert {p["stream"]: p["records_committed"] for p in j1["per_stream"]} == {"orders": STREAM_SIZES["orders"], "customers": STREAM_SIZES["customers"]}
    created, started, ended = (parse_ts(j1[k]) for k in ("created_at", "started_at", "ended_at"))
    assert (ended - started).total_seconds() >= JOB_MIN_RUNNING_S and (ended - created).total_seconds() <= JOB_MAX_S
    assert all(j1[k].endswith("Z") for k in ("created_at", "started_at", "ended_at"))
    lines = logs(editor, j1["id"])
    assert all(set(l) >= {"at", "level", "message"} for l in lines)
    msgs = [l["message"] for l in lines]
    reads = {f"stream {s}: {STREAM_SIZES[s]} records read" for s in ("orders", "customers")}
    commits = {f"stream {s}: {STREAM_SIZES[s]} records committed" for s in ("orders", "customers")}
    assert msgs[0] == "Sync started" and msgs[-1] == "Sync succeeded"
    assert set(msgs[1:3]) == reads and set(msgs[3:5]) == commits and len(msgs) == 6
    j2 = run_job(editor, pipe.cid)
    assert [j["id"] for j in jobs_of(editor, pipe.cid)] == [j2["id"], j1["id"]]


def test_job_keeps_starting_versions(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite", "customers": "full_refresh_overwrite"})
    j1 = sync(editor, pipe.cid)
    wait_job(editor, j1["id"], {"running"})
    streams = [stream_entry("customers", selected=False), stream_entry("orders", "full_refresh_append"), stream_entry("invoices", selected=False)]
    assert body(patch_connection(editor, pipe.cid, {"streams": streams}, 1), 200)["connection"]["version"] == 2
    sample_event(editor, pipe.source["id"], {"stream": "orders", "append": APPENDED_MID_RUN})
    sample_event(editor, pipe.source["id"], {"stream": "orders", "add_field": "promo"})
    j1 = wait_job(editor, j1["id"])
    assert j1["status"] == "succeeded" and j1["connection_version"] == 1
    assert {p["stream"]: p["records_committed"] for p in j1["per_stream"]} == {"orders": STREAM_SIZES["orders"], "customers": STREAM_SIZES["customers"]}
    assert all(r.get("promo") is None for r in all_records(editor, pipe.did, "shop_orders"))
    j2 = run_job(editor, pipe.cid)
    assert j2["connection_version"] == 2
    assert {p["stream"]: p["records_committed"] for p in j2["per_stream"]} == {"orders": NEXT_JOB_ORDERS}
    rows = all_records(editor, pipe.did, "shop_orders")
    assert len(rows) == STREAM_SIZES["orders"] + NEXT_JOB_ORDERS
    assert all(r["promo"] == f"promo-{r['id']}" for r in rows if r["_wayline_job_id"] == j2["id"])
    assert tables(editor, pipe.did)["shop_customers"] == STREAM_SIZES["customers"]


def test_all_or_nothing_visibility(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "incremental_append", "customers": "full_refresh_append", "invoices": "full_refresh_append"})
    run_job(editor, pipe.cid)
    old_tables, old_state = tables(editor, pipe.did), state(editor, pipe.cid)
    sample_event(editor, pipe.source["id"], {"stream": "orders", "append": APPENDED_MID_RUN})
    job = sync(editor, pipe.cid)
    samples = []
    deadline = time.monotonic() + JOB_DEADLINE_S
    while True:
        j_before = get_job(editor, job["id"])
        t = tables(editor, pipe.did)
        s = state(editor, pipe.cid)
        total = body(records_page(editor, pipe.did, "shop_orders", limit=1), 200)["total_count"]
        j_after = get_job(editor, job["id"])
        samples.append((j_before, t, s, total, j_after))
        if j_after["status"] in FINAL:
            break
        assert time.monotonic() < deadline, "job did not finish"
    assert get_job(editor, job["id"])["status"] == "succeeded"
    new_tables, new_state = tables(editor, pipe.did), state(editor, pipe.cid)
    assert new_tables != old_tables and new_state != old_state
    for j_before, t, s, total, j_after in samples:
        assert t in (old_tables, new_tables), t
        assert s in (old_state, new_state), s
        assert not (t == new_tables and s == old_state), "tables committed before cursors"
        if s == new_state:
            assert total == new_tables["shop_orders"]
        if j_before["status"] == "succeeded":
            assert t == new_tables and s == new_state
        if t == new_tables or s == new_state or total == new_tables["shop_orders"]:
            assert j_after["status"] == "succeeded"
        if j_before["status"] != "succeeded":
            assert j_before["records_committed"] == 0 and all(p["records_committed"] == 0 for p in j_before["per_stream"])
    doomed = sync(editor, pipe.cid)
    wait_job(editor, doomed["id"], {"running"})
    during = (tables(editor, pipe.did), state(editor, pipe.cid))
    body(editor.post(f"/api/jobs/{doomed['id']}/cancel", {}), 200)
    ended = wait_job(editor, doomed["id"])
    assert ended["status"] == "cancelled" and ended["records_committed"] == 0
    assert during == (new_tables, new_state)
    assert (tables(editor, pipe.did), state(editor, pipe.cid)) == (new_tables, new_state)
    for name in new_tables:
        assert doomed["id"] not in {r["_wayline_job_id"] for r in all_records(editor, pipe.did, name)}


SNAPSHOT_JS = """([status, streams, history]) => { window.__wlSnaps = [];
  const snap = () => window.__wlSnaps.push({status: status.textContent.trim(), streams: streams.innerText, history: history.innerText});
  snap(); new MutationObserver(snap).observe(document.body, {childList: true, subtree: true, characterData: true}); }"""


def test_wf_sync_engine_streams_table_commit(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "incremental_append", "customers": "full_refresh_overwrite"})
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}")) as page:
        streams = page.get_by_role("table", name="Streams")
        see(page, streams.get_by_role("rowheader", name="orders"))
        eventually(page, lambda: expect(streams.get_by_role("rowheader")).to_have_count(2, timeout=POLL_MS))
        eventually(page, lambda: expect(streams.get_by_role("columnheader")).to_have_text(["Stream", "Sync mode", "Rows", "Cursor"], timeout=POLL_MS))
        orders_row = streams.get_by_role("row").filter(has=page.get_by_role("rowheader", name="orders"))
        eventually(page, lambda: expect(orders_row).to_contain_text(MODE_LABELS["incremental_append"], timeout=POLL_MS))
        eventually(page, lambda: expect(orders_row.get_by_role("cell").nth(1)).to_have_text("—", timeout=POLL_MS))
        status = page.get_by_role("status", name="Sync status")
        history = page.get_by_role("table", name="Job history")
        page.evaluate(SNAPSHOT_JS, [status.element_handle(), streams.element_handle(), history.element_handle()])
        click(page.get_by_role("button", name="Sync now"))
        says(page, status, COPY_SUCCEEDED, JOB_DEADLINE_S)
        cursor = state(editor, pipe.cid)["orders"]
        eventually(page, lambda: expect(orders_row).to_contain_text(cursor, timeout=POLL_MS))
        eventually(page, lambda: expect(orders_row).to_contain_text(str(STREAM_SIZES["orders"]), timeout=POLL_MS))
        final = streams.inner_text()
        snaps = page.evaluate("() => window.__wlSnaps")
        old = snaps[0]["streams"]
        for snap in snaps:
            assert snap["streams"] in (old, final), snap
            fresh = snap["streams"] == final
            assert fresh == ("Succeeded" in snap["history"]), snap
            assert fresh == (snap["status"] == COPY_SUCCEEDED), snap


def test_wf_sync_engine_destinations_counts(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite", "invoices": "full_refresh_overwrite"})
    run_job(editor, pipe.cid)
    counts = tables(editor, pipe.did)
    pg = Postgres()
    for name, count in counts.items():
        assert pg.rows(f"SELECT count(*) AS n FROM \"{warehouse_schema(pipe.did)}\".\"{name}\"")[0]["n"] == count
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app("/destinations")) as page:
        for name, count in counts.items():
            see(page, page.get_by_role("link", name=re.compile(re.escape(name))).first)
            see(page, page.get_by_text(str(count), exact=True).first)
        click(page.locator(f'a[href$="/destinations/{pipe.did}/tables/{ORDERS_TABLE}"]'))
        on_path(page, app(f"/destinations/{pipe.did}/tables/{ORDERS_TABLE}"))
        see(page, page.get_by_text(f"{counts['shop_orders']} records", exact=True).first)


def test_schema_change_policies(app_url):
    editor = new_member(app_url, "editor")
    admin = login(app_url, ADMIN_EMAIL)
    prop = make_pipe(editor, {"orders": "full_refresh_append"}, policy="propagate")
    ign = make_pipe(editor, {"orders": "full_refresh_overwrite"}, policy="ignore")
    pau = make_pipe(editor, {"orders": "full_refresh_overwrite"}, policy="pause")
    for p in (prop, ign, pau):
        run_job(editor, p.cid)
        sample_event(editor, p.source["id"], {"stream": "orders", "add_field": "region"})
    j2 = run_job(editor, prop.cid)
    rows = all_records(editor, prop.did, "shop_orders")
    assert len(rows) == 2 * STREAM_SIZES["orders"]
    for r in rows:
        assert r["region"] == (f"region-{r['id']}" if r["_wayline_job_id"] == j2["id"] else None)
    c = connection(editor, prop.cid)
    assert c["version"] == 2 and "region" in next(s for s in c["streams"] if s["name"] == "orders")["known_fields"]
    run_job(editor, ign.cid)
    assert all(r.get("region") is None for r in all_records(editor, ign.did, "shop_orders"))
    c = connection(editor, ign.cid)
    assert c["version"] == 1 and "region" not in next(s for s in c["streams"] if s["name"] == "orders")["known_fields"]
    failed = wait_job(editor, sync(editor, pau.cid)["id"])
    assert failed["status"] == "failed" and failed["failure_reason"] == "schema_change_detected"
    c = connection(editor, pau.cid)
    assert c["status"] == "inactive" and c["version"] == 2
    assert all(r["_wayline_job_id"] != failed["id"] for r in all_records(editor, pau.did, "shop_orders"))
    assert refused(patch_connection(editor, pau.cid, {"status": "active"}, 1), 412, "version_mismatch")["current_version"] == 2
    back = body(patch_connection(editor, pau.cid, {"status": "active"}, 2), 200)["connection"]
    assert back["status"] == "active" and back["version"] == 3
    assert "region" in next(s for s in back["streams"] if s["name"] == "orders")["known_fields"]
    j3 = run_job(editor, pau.cid)
    assert all(r["region"] == f"region-{r['id']}" for r in all_records(editor, pau.did, "shop_orders") if r["_wayline_job_id"] == j3["id"])
    sample_event(editor, pau.source["id"], {"stream": "orders", "add_field": "zone"})
    again = wait_job(editor, sync(editor, pau.cid)["id"])
    assert again["failure_reason"] == "schema_change_detected" and connection(editor, pau.cid)["status"] == "inactive"
    assert len([e for e in audit(admin) if e["target_id"] == pau.cid and e["action"] == "connection.updated"]) == 1


def test_schema_ignore_survives_manual_switch(app_url):
    # Schema changes: ignore keeps a new field out on every later sync; only a schema pause re-adopts fields.
    editor = new_member(app_url, "editor")
    ign = make_pipe(editor, {"orders": "full_refresh_overwrite"}, policy="ignore")
    run_job(editor, ign.cid)
    sample_event(editor, ign.source["id"], {"stream": "orders", "add_field": "region"})
    run_job(editor, ign.cid)
    off = body(patch_connection(editor, ign.cid, {"status": "inactive"}), 200)["connection"]
    assert off["status"] == "inactive"
    back = body(patch_connection(editor, ign.cid, {"status": "active"}), 200)["connection"]
    assert back["status"] == "active"
    assert "region" not in next(s for s in back["streams"] if s["name"] == "orders")["known_fields"]
    run_job(editor, ign.cid)
    assert all(r.get("region") is None for r in all_records(editor, ign.did, "shop_orders"))

def test_reset_empties_tables(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "incremental_append", "customers": "incremental_dedup", "invoices": "full_refresh_overwrite"})
    job = run_job(editor, pipe.cid)
    page1 = body(records_page(editor, pipe.did, "shop_orders", limit=HISTORY_PAGE), 200)
    page2 = body(records_page(editor, pipe.did, "shop_orders", limit=HISTORY_PAGE, cursor=page1["next_cursor"]), 200)
    before = connection(editor, pipe.cid)
    after = body(editor.post(f"/api/connections/{pipe.cid}/reset", {}), 200)["connection"]
    assert (after["status"], after["version"]) == (before["status"], before["version"])
    assert [s["known_fields"] for s in after["streams"]] == [s["known_fields"] for s in before["streams"]]
    assert tables(editor, pipe.did) == {f"shop_{s}": 0 for s in STREAMS}
    for s in STREAMS:
        assert body(records_page(editor, pipe.did, f"shop_{s}"), 200) == \
            {"records": [], "next_cursor": None, "prev_cursor": None, "has_more": False, "total_count": 0}
    for cursor in (page1["next_cursor"], page2["prev_cursor"]):
        refused(records_page(editor, pipe.did, "shop_orders", cursor=cursor), 400, "invalid_cursor")
    assert state(editor, pipe.cid) == {s: None for s in STREAMS}
    assert [j["id"] for j in jobs_of(editor, pipe.cid)] == [job["id"]]
    pg = Postgres()
    for s in STREAMS:
        assert pg.rows(f"SELECT count(*) AS n FROM \"{warehouse_schema(pipe.did)}\".\"shop_{s}\"")[0]["n"] == 0
    assert run_job(editor, pipe.cid)["records_committed"] == FULL_SEED_RECORDS


def test_reset_meets_sync(app_url):
    editor = new_member(app_url, "editor")
    fresh = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    body(editor.post(f"/api/connections/{fresh.cid}/reset", {}), 200)
    assert tables(editor, fresh.did) == {}
    off = body(patch_connection(editor, fresh.cid, {"status": "inactive"}), 200)["connection"]
    reset = body(editor.post(f"/api/connections/{fresh.cid}/reset"), 200)["connection"]
    assert reset["status"] == "inactive" and reset["version"] == off["version"]
    pipe = make_pipe(editor, {"orders": "full_refresh_append"})
    first = run_job(editor, pipe.cid)
    reset_r, sync_r = together(2, lambda i: editor.post(f"/api/connections/{pipe.cid}/{'reset' if i == 0 else 'sync'}", {}))
    job = wait_job(editor, body(sync_r, 201)["job"]["id"])
    assert job["status"] == "succeeded"
    stamps = [r["_wayline_job_id"] for r in all_records(editor, pipe.did, "shop_orders")]
    if reset_r.status_code == 200:
        assert set(stamps) == {job["id"]} and len(stamps) == STREAM_SIZES["orders"]
    else:
        refused(reset_r, 409, "sync_already_running")
        assert stamps.count(first["id"]) == STREAM_SIZES["orders"] and stamps.count(job["id"]) == STREAM_SIZES["orders"]


def test_cancel_and_failure(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "incremental_append"})
    run_job(editor, pipe.cid)
    before_tables, before_state = tables(editor, pipe.did), state(editor, pipe.cid)
    sample_event(editor, pipe.source["id"], {"stream": "orders", "append": APPENDED_MID_RUN})
    job = sync(editor, pipe.cid)
    wait_job(editor, job["id"], {"running"})
    assert body(editor.post(f"/api/jobs/{job['id']}/cancel", {}), 200)["job"]["status"] == "cancelled"
    done = wait_job(editor, job["id"])
    assert done["status"] == "cancelled" and done["records_committed"] == 0
    assert all(p["records_committed"] == 0 for p in done["per_stream"])
    assert logs(editor, job["id"])[-1]["message"] == "Sync cancelled"
    assert tables(editor, pipe.did) == before_tables and state(editor, pipe.cid) == before_state
    assert job["id"] not in {r["_wayline_job_id"] for r in all_records(editor, pipe.did, "shop_orders")}
    refused(editor.post(f"/api/jobs/{job['id']}/cancel", {}), 409, "job_not_active")
    bad = make_pipe(editor, {"orders": "incremental_append"}, key=f"{REJECT_PREFIX}{tag()}")
    failed = wait_job(editor, sync(editor, bad.cid)["id"])
    assert failed["status"] == "failed" and failed["failure_reason"] == "auth_failed"
    assert [(a["number"], a["status"], a["failure_reason"]) for a in failed["attempts"]] == \
        [(n, "failed", "auth_failed") for n in (1, 2, 3)]
    msgs = [l["message"] for l in logs(editor, failed["id"])]
    for n in (1, 2, 3):
        assert f"attempt {n} failed: auth_failed" in msgs
    assert msgs[-1] == f"Sync failed: {failed['failure_reason']}"
    assert tables(editor, bad.did) == {} and state(editor, bad.cid) == {s: None for s in STREAMS}


def test_connection_versions(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    path = f"/api/connections/{pipe.cid}"
    refused(editor.patch(path, {"name": f"N {tag()}"}), 428, "precondition_required")
    data = refused(editor.patch(path, {"name": f"N {tag()}"}, headers={"If-Match": etag(9)}), 412, "version_mismatch")
    assert data["current_version"] == 1
    refused(editor.patch(path, {"name": f"N {tag()}"}, headers={"If-Match": str(1)}), 412, "version_mismatch")
    r = editor.patch(path, {"name": f"N {tag()}"}, headers={"If-Match": etag(1)})
    assert body(r, 200)["connection"]["version"] == 2 and r.headers["etag"] == etag(2)
    results = together(CONCURRENT, lambda i: editor.patch(path, {"name": f"Race {i} {tag()}"}, headers={"If-Match": etag(2)}))
    assert [x.status_code for x in results].count(200) == 1
    for x in results:
        if x.status_code != 200:
            refused(x, 412, "version_mismatch")
    assert connection(editor, pipe.cid)["version"] == 3
    invalid(editor.patch(path, {"status": "paused"}, headers={"If-Match": etag(3)}), "status")
    invalid(editor.patch(path, {"namespace_prefix": "x_"}, headers={"If-Match": etag(3)}), "namespace_prefix")
    run_job(editor, pipe.cid)
    body(editor.post(f"{path}/reset", {}), 200)
    assert connection(editor, pipe.cid)["version"] == 3


def test_wf_schema_and_reset_switch_mismatch(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}")) as page:
        switch = page.get_by_role("switch", name="Connection active")
        see(page, switch)
        renamed = f"Renamed {tag()}"
        stored = body(patch_connection(editor, pipe.cid, {"name": renamed, "schedule": {"type": "interval", "interval_minutes": PLAN_MINIMUMS["starter"]}}, 1), 200)["connection"]
        click(switch)
        says(page, page.get_by_role("status", name="Connection status"), COPY_VERSION_MISMATCH)
        see(page, page.get_by_role("heading", level=1, name=renamed))
        eventually(page, lambda: expect(switch).to_be_checked(timeout=POLL_MS))
        see(page, page.get_by_text(next_run_text(stored["next_run_at"], "UTC")).first)
        assert connection(editor, pipe.cid)["status"] == "active"
        click(switch)
        says(page, page.get_by_role("status", name="Connection status"), COPY_TURNED_OFF)
        eventually(page, lambda: expect(switch).not_to_be_checked(timeout=POLL_MS))
    final = connection(editor, pipe.cid)
    assert final["status"] == "inactive" and final["version"] == stored["version"] + 1


def test_wf_schema_and_reset_dialog_survives(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    run_job(editor, pipe.cid)
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}")) as page:
        streams = page.get_by_role("table", name="Streams")
        says(page, streams, str(STREAM_SIZES["orders"]))
        reset = page.get_by_role("button", name="Reset")
        click(reset)
        dialog = page.get_by_role("alertdialog", name="Reset connection")
        keep, confirm = dialog.get_by_role("button", name="Keep tables"), dialog.get_by_role("button", name="Reset tables")
        eventually(page, lambda: expect(keep).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Tab")
        eventually(page, lambda: expect(confirm).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Tab")
        eventually(page, lambda: expect(keep).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Shift+Tab")
        eventually(page, lambda: expect(confirm).to_be_focused(timeout=POLL_MS))
        marker = tag()
        dialog.evaluate("(el, m) => { el.__wlProbe = m; }", marker)
        job = sync(editor, pipe.cid)
        eventually(page, lambda: ensure(get_job(editor, job["id"])["status"] in FINAL, "job still running"), JOB_DEADLINE_S)
        advance(page, 2 * HISTORY_REFRESH_MS)
        expect(dialog).to_be_visible()
        assert dialog.evaluate("el => el.__wlProbe") == marker
        expect(confirm).to_be_focused()
        page.keyboard.press("Enter")
        says(page, page.get_by_role("status", name="Sync status"), COPY_RESET)
        gone(page, dialog)
        eventually(page, lambda: expect(reset).to_be_focused(timeout=POLL_MS))
        assert tables(editor, pipe.did) == {"shop_orders": 0}
        eventually(page, lambda: expect(streams).not_to_contain_text(str(STREAM_SIZES["orders"]), timeout=POLL_MS))
        shown = streams.inner_text()
        running = sync(editor, pipe.cid)
        click(reset)
        see(page, dialog)
        click(confirm)
        says(page, page.get_by_role("status", name="Sync status"), COPY_ALREADY_RUNNING)
        gone(page, dialog)
        eventually(page, lambda: expect(reset).to_be_focused(timeout=POLL_MS))
        assert streams.inner_text() == shown
        body(editor.post(f"/api/jobs/{running['id']}/cancel", {}), 200)


def test_workspace_isolation(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    job = run_job(editor, pipe.cid)
    project = body(editor.post("/api/builder/projects", {"name": f"Iso {tag()}", "manifest": STARTING_MANIFEST}), 201)["project"]
    body(editor.post(f"/api/builder/projects/{project['id']}/test", {"stream": "invoices", "api_key": SANDBOX_KEY}), 200)
    definition = body(editor.post(f"/api/builder/projects/{project['id']}/publish", {}), 201)["definition"]
    out = login(app_url, OUTSIDER_EMAIL)
    for path in (f"/api/connections/{pipe.cid}", f"/api/sources/{pipe.source['id']}", f"/api/destinations/{pipe.did}/tables",
                 f"/api/jobs/{job['id']}", f"/api/builder/projects/{project['id']}", f"/api/connector-definitions/{definition['id']}",
                 f"/api/connections/{pipe.cid}/state", f"/api/sources/{pipe.source['id']}/catalog"):
        refused(out.get(path), 404, "not_found")
    refused(out.patch(f"/api/connections/{pipe.cid}", {"name": "x"}, headers={"If-Match": etag(1)}), 404, "not_found")
    assert pipe.cid not in [c["id"] for c in body(out.get("/api/connections"), 200)["connections"]]
    assert pipe.source["id"] not in [s["id"] for s in body(out.get("/api/sources"), 200)["sources"]]
    assert pipe.did not in [d["id"] for d in body(out.get("/api/destinations"), 200)["destinations"]]
    assert job["id"] not in [j["id"] for j in jobs_of(out)]
    assert project["id"] not in [p["id"] for p in body(out.get("/api/builder/projects"), 200)["projects"]]
    assert definition["id"] not in [d["id"] for d in body(out.get("/api/connector-definitions"), 200)["definitions"]]
    assert definition["id"] in [d["id"] for d in body(editor.get("/api/connector-definitions"), 200)["definitions"]]
    own = sum(j["records_committed"] for j in jobs_of(out) if j["status"] == "succeeded")
    assert body(out.get("/api/stats"), 200)["records_synced"] == own
    targets = {pipe.cid, pipe.source["id"], pipe.did, job["id"], definition["id"]}
    assert not [e for e in audit(out) if e["target_id"] in targets]


def test_job_history_paging(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    other = body(editor.post("/api/connections", connection_body(pipe.source["id"], pipe.did, {"customers": "full_refresh_overwrite"}, prefix="other_")), 201)["connection"]
    made = [quick_job(editor, pipe.cid)["id"] for _ in range(5)]
    first = body(editor.get("/api/jobs", params={"connection_id": pipe.cid, "limit": 2}), 200)
    seen = [j["id"] for j in first["jobs"]]
    newcomer = quick_job(editor, pipe.cid)["id"]
    cursor, has_more = first["next_cursor"], first["has_more"]
    while has_more:
        page = body(editor.get("/api/jobs", params={"connection_id": pipe.cid, "limit": 2, "cursor": cursor}), 200)
        seen += [j["id"] for j in page["jobs"]]
        cursor, has_more = page["next_cursor"], page["has_more"]
    assert cursor is None and seen == list(reversed(made)) and newcomer not in seen
    listing = jobs_of(editor, pipe.cid)
    assert listing[0]["id"] == newcomer
    assert listing == sorted(listing, key=lambda j: (j["created_at"], j["id"]), reverse=True)
    for limit in (0, LIMIT_MAX + 1, "x"):
        invalid(editor.get("/api/jobs", params={"connection_id": pipe.cid, "limit": limit}), "limit")
    c = first["next_cursor"]
    mid = len(c) // 2
    for bad in (c[:mid] + ("A" if c[mid] != "A" else "B") + c[mid + 1:], c[:mid], "not-a-cursor"):
        refused(editor.get("/api/jobs", params={"connection_id": pipe.cid, "cursor": bad}), 400, "invalid_cursor")
    refused(editor.get("/api/jobs", params={"connection_id": other["id"], "cursor": c}), 400, "invalid_cursor")
    refused(editor.get("/api/jobs", params={"cursor": c}), 400, "invalid_cursor")
    refused(login(app_url, OUTSIDER_EMAIL).get("/api/jobs", params={"cursor": c}), 400, "invalid_cursor")
    refused(editor.get("/api/jobs", params={"connection_id": "abc"}), 404, "not_found")


def test_warehouse_records_paging(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite", "customers": "full_refresh_append"})
    run_job(editor, pipe.cid)
    pages = []
    cursor = None
    while True:
        page = body(records_page(editor, pipe.did, "shop_orders", limit=RECORDS_PAGE, cursor=cursor), 200)
        assert page["total_count"] == STREAM_SIZES["orders"]
        pages.append(page)
        if not page["has_more"]:
            break
        cursor = page["next_cursor"]
    assert [r["id"] for p in pages for r in p["records"]] == list(range(1, STREAM_SIZES["orders"] + 1))
    assert [len(p["records"]) for p in pages] == [RECORDS_PAGE, RECORDS_PAGE, STREAM_SIZES["orders"] - 2 * RECORDS_PAGE]
    assert pages[0]["prev_cursor"] is None and pages[-1]["next_cursor"] is None
    back = body(records_page(editor, pipe.did, "shop_orders", limit=RECORDS_PAGE, cursor=pages[2]["prev_cursor"]), 200)
    assert back["records"] == pages[1]["records"]
    back2 = body(records_page(editor, pipe.did, "shop_orders", limit=RECORDS_PAGE, cursor=back["prev_cursor"]), 200)
    assert back2["records"] == pages[0]["records"] and back2["prev_cursor"] is None
    resize = 30
    resized = body(records_page(editor, pipe.did, "shop_orders", limit=resize, cursor=pages[0]["next_cursor"]), 200)
    assert [r["id"] for r in resized["records"]] == list(range(RECORDS_PAGE + 1, RECORDS_PAGE + resize + 1))
    assert set(pages[0]["records"][0]) >= set(STREAM_FIELDS["orders"]) | {"_wayline_job_id", "_wayline_extracted_at"}
    for limit in (0, LIMIT_MAX + 1):
        invalid(records_page(editor, pipe.did, "shop_orders", limit=limit), "limit")
    cust_cursor = body(records_page(editor, pipe.did, "shop_customers", limit=HISTORY_PAGE), 200)["next_cursor"]
    refused(records_page(editor, pipe.did, "shop_orders", cursor=cust_cursor), 400, "invalid_cursor")
    run_job(editor, pipe.cid)
    refused(records_page(editor, pipe.did, "shop_orders", cursor=pages[0]["next_cursor"]), 400, "invalid_cursor")
    kept = body(records_page(editor, pipe.did, "shop_customers", limit=HISTORY_PAGE, cursor=cust_cursor), 200)
    assert kept["records"][0]["id"] == HISTORY_PAGE + 1 and kept["total_count"] == 2 * STREAM_SIZES["customers"]


def test_object_checks(app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    job = sync(editor, pipe.cid)
    out = login(app_url, OUTSIDER_EMAIL)
    jid, did = job["id"], pipe.did
    refused(Api(app_url).get(f"/api/jobs/{jid}"), 401, "unauthenticated")
    for path in (f"/api/jobs/{jid}", f"/api/jobs/{jid}/logs", f"/api/jobs/{jid}/events", f"/api/destinations/{did}/tables",
                 f"/api/destinations/{did}/tables/shop_orders/records"):
        refused(out.get(path), 404, "not_found")
    refused(Api(app_url).get(f"/api/jobs/{jid}/events", params={"token": out.token}), 404, "not_found")
    refused(out.post(f"/api/jobs/{jid}/cancel", {}), 404, "not_found")
    assert wait_job(editor, jid)["status"] == "succeeded"
    for bad in ("abc", quote("1'--", safe="")):
        for path in (f"/api/jobs/{bad}", f"/api/jobs/{bad}/logs", f"/api/jobs/{bad}/events", f"/api/destinations/{bad}/tables",
                     f"/api/destinations/{bad}/tables/shop_orders/records"):
            refused(editor.get(path), 404, "not_found")
        refused(editor.post(f"/api/jobs/{bad}/cancel", {}), 404, "not_found")
    other = make_destination(editor)
    for table in ("SHOP_ORDERS", "pg_catalog.pg_class", quote('"shop_orders"', safe=""), "%2e%2e", "public.shop_orders"):
        refused(editor.get(f"/api/destinations/{did}/tables/{table}/records"), 404, "not_found")
    refused(editor.get(f"/api/destinations/{other['id']}/tables/shop_orders/records"), 404, "not_found")
    admin = login(app_url, ADMIN_EMAIL)
    assert not [e for e in audit(admin) if e["target_id"] == jid and e["action"] == "sync.cancelled"]


def test_wf_history_and_records_records_url(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    run_job(editor, pipe.cid)
    base_path = app(f"/destinations/{pipe.did}/tables/{ORDERS_TABLE}")
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=base_path) as page:
        table = page.get_by_role("table", name=f"{ORDERS_TABLE} records")
        see(page, table)
        see(page, page.get_by_text(f"{STREAM_SIZES['orders']} records", exact=True).first)
        eventually(page, lambda: expect(table.get_by_role("columnheader")).to_have_text(STREAM_FIELDS["orders"] + ["_wayline_job_id", "_wayline_extracted_at"], timeout=POLL_MS))
        heads = table.get_by_role("rowheader")
        eventually(page, lambda: expect(heads).to_have_count(RECORDS_PAGE, timeout=POLL_MS))
        eventually(page, lambda: expect(heads.first).to_have_text("1", timeout=POLL_MS))
        prev, nxt = page.get_by_role("button", name="Previous page"), page.get_by_role("button", name="Next page")
        eventually(page, lambda: expect(prev).to_be_disabled(timeout=POLL_MS))
        click(nxt)
        eventually(page, lambda: expect(heads.first).to_have_text(str(RECORDS_PAGE + 1), timeout=POLL_MS))
        shared = page.url
        assert "cursor=" in shared
        page.reload()
        eventually(page, lambda: expect(heads.first).to_have_text(str(RECORDS_PAGE + 1), timeout=POLL_MS))
        page.go_back()
        eventually(page, lambda: expect(heads.first).to_have_text("1", timeout=POLL_MS))
        assert "cursor=" not in page.url
        page.go_forward()
        eventually(page, lambda: expect(heads.first).to_have_text(str(RECORDS_PAGE + 1), timeout=POLL_MS))
        link = urlparse(shared)
        with console(browser, app_url, VIEWER_EMAIL, path=f"{link.path}?{link.query}") as other:
            other_heads = other.get_by_role("table", name=f"{ORDERS_TABLE} records").get_by_role("rowheader")
            eventually(other, lambda: expect(other_heads.first).to_have_text(str(RECORDS_PAGE + 1), timeout=POLL_MS))
        body(editor.post(f"/api/connections/{pipe.cid}/reset", {}), 200)
        page.reload()
        says(page, page.get_by_role("alert"), COPY_BAD_LINK)
        eventually(page, lambda: expect(heads).to_have_count(0, timeout=POLL_MS))
        click(page.get_by_role("alert").get_by_role("link", name="First page"))
        on_path(page, base_path)
        assert "cursor=" not in page.url
        see(page, page.get_by_text("0 records", exact=True).first)
        eventually(page, lambda: expect(prev).to_be_disabled(timeout=POLL_MS))
        eventually(page, lambda: expect(nxt).to_be_disabled(timeout=POLL_MS))


def test_wf_history_and_records_job_history(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    for _ in range(2 * HISTORY_PAGE + 1):
        quick_job(editor, pipe.cid)
    viewer = new_member(app_url, "viewer")
    with console(browser, app_url, viewer.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}"), width=PHONE, height=PHONE_H) as page:
        history = page.get_by_role("table", name="Job history")
        heads = history.get_by_role("rowheader")
        eventually(page, lambda: expect(heads).to_have_count(HISTORY_PAGE, timeout=POLL_MS))
        eventually(page, lambda: expect(history.get_by_role("columnheader")).to_have_text(["Job", "Status", "Started", "Records", "Reason"], timeout=POLL_MS))
        listing = jobs_of(editor, pipe.cid)
        eventually(page, lambda: expect(heads).to_have_text([f"Job {j['id'][:8]}" for j in listing[:HISTORY_PAGE]], timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_role("button", name="Sync now")).to_have_count(0, timeout=POLL_MS))
        older = page.get_by_role("button", name="Load older jobs")
        ready(older).focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(heads).to_have_count(2 * HISTORY_PAGE, timeout=POLL_MS))
        eventually(page, lambda: expect(older).to_be_focused(timeout=POLL_MS))
        newcomer = sync(editor, pipe.cid)
        eventually(page, lambda: expect(heads.first).to_have_text(f"Job {newcomer['id'][:8]}", timeout=POLL_MS))
        eventually(page, lambda: expect(heads).to_have_count(2 * HISTORY_PAGE + 1, timeout=POLL_MS))
        eventually(page, lambda: expect(older).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Enter")
        total = 2 * HISTORY_PAGE + 2
        eventually(page, lambda: expect(heads).to_have_count(total, timeout=POLL_MS))
        names = heads.all_text_contents()
        assert len(set(names)) == total == len(jobs_of(editor, pipe.cid))
        says(page, page.get_by_role("status", name="Job history status"), f"Showing {total} jobs")
        gone(page, older)
    r = editor.post(f"/api/jobs/{newcomer['id']}/cancel", {})
    assert r.status_code == 200 or (r.status_code == 409 and r.json().get("error") == "job_not_active"), r.text


def test_wf_history_and_records_breakpoints(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    run_job(editor, pipe.cid)
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}"), width=BELOW_RAIL) as page:
        for width in (BELOW_TABLET, TABLET, BELOW_RAIL):
            page.set_viewport_size({"width": width, "height": WIDE_H})
            see(page, page.get_by_role("button", name="Open navigation"))
            eventually(page, lambda: expect(page.get_by_role("navigation", name="Console")).to_have_count(0, timeout=POLL_MS))
        for width in (RAIL, BELOW_WIDE, WIDE):
            page.set_viewport_size({"width": width, "height": WIDE_H})
            see(page, page.get_by_role("navigation", name="Console"))
            eventually(page, lambda: expect(page.get_by_role("button", name="Open navigation")).to_have_count(0, timeout=POLL_MS))
        history, log = page.get_by_role("table", name="Job history"), page.get_by_role("log", name="Live log")
        page.set_viewport_size({"width": BELOW_WIDE, "height": WIDE_H})
        advance(page, STEP_MS)
        h, l = history.bounding_box(), log.bounding_box()
        assert l["y"] >= h["y"] + h["height"] - 1
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        advance(page, STEP_MS)
        h, l = history.bounding_box(), log.bounding_box()
        assert l["x"] >= h["x"] + h["width"] - 1 and l["y"] < h["y"] + h["height"]
        page.set_viewport_size({"width": PHONE, "height": PHONE_H})
        opener = page.get_by_role("button", name="Open navigation")
        click(opener)
        drawer = page.get_by_role("dialog", name="Navigation")
        see(page, drawer)
        eventually(page, lambda: expect(drawer.get_by_role("button", name="Close navigation")).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Escape")
        gone(page, drawer)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=POLL_MS))
        click(opener)
        click(page.get_by_role("dialog", name="Navigation").get_by_role("link", name="Sources"))
        on_path(page, app("/sources"))
        gone(page, page.get_by_role("dialog", name="Navigation"))
        page.goto(app_url + app(f"/destinations/{pipe.did}/tables/{ORDERS_TABLE}"))
        frame = page.get_by_role("region", name=f"Scroll {ORDERS_TABLE} records")
        see(page, frame)
        rest, focused = state_styles(frame, "outline-style", "box-shadow", state="focus")
        assert rest != focused
        ready(frame).focus()
        eventually(page, lambda: expect(frame).to_be_focused(timeout=POLL_MS))
        assert frame.evaluate("el => el.scrollWidth > el.clientWidth")
        head = frame.get_by_role("rowheader").first
        x0 = head.bounding_box()["x"]
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        eventually(page, lambda: ensure(frame.evaluate("el => el.scrollLeft") > 0, "frame did not scroll sideways"))
        assert abs(head.bounding_box()["x"] - x0) < 1
        layout(page)


def test_sandbox_api(app_url):
    anon = Api(app_url)
    path = "/mock-api/v1/invoices"
    assert anon.get(path).status_code == 401
    assert anon.get(path, headers={"X-Api-Key": WRONG_SANDBOX_KEY}).status_code == 401
    key = {"X-Api-Key": SANDBOX_KEY}
    for size in (0, LIMIT_MAX + 1):
        assert anon.get(path, headers=key, params={"page_size": size}).status_code == 400
    got, page_no, nexts = [], 1, []
    while page_no is not None:
        data = body(anon.get(path, headers=key, params={"page": page_no}), 200)
        got += data["data"]
        nexts.append(data["next_page"])
        page_no = data["next_page"]
    assert nexts == [2, 3, None]
    assert [(d["id"], d["customer"], d["total_cents"], d["status"]) for d in got] == INVOICES
    assert body(anon.get(path, headers=key, params={"page": 4}), 200) == {"data": [], "next_page": None}
    assert len(body(anon.get(path, headers=key, params={"page_size": LIMIT_MAX}), 200)["data"]) == len(INVOICES)
    assert anon.get("/mock-api/v1/customers", headers=key).status_code == 404


def manifest_with(**stream_over: Any) -> dict:
    m = json.loads(json.dumps(STARTING_MANIFEST))
    m["streams"][0].update(stream_over)
    return m


def test_builder_test_read(app_url):
    editor = new_member(app_url, "editor")
    proj = body(editor.post("/api/builder/projects", {"name": f"Builder {tag()}", "manifest": STARTING_MANIFEST}), 201)["project"]
    assert proj["manifest"] == STARTING_MANIFEST
    res = body(editor.post(f"/api/builder/projects/{proj['id']}/test", {"stream": "invoices", "api_key": SANDBOX_KEY}), 200)
    assert [r["id"] for r in res["records"]] == [i[0] for i in INVOICES] and res["pages_read"] == 3
    assert res["detected_schema"] == INVOICE_SCHEMA
    assert "invoices" in body(editor.get(f"/api/builder/projects/{proj['id']}"), 200)["project"]["tested_streams"]
    r = editor.post(f"/api/builder/projects/{proj['id']}/test", {"stream": "invoices", "api_key": WRONG_SANDBOX_KEY})
    assert refused(r, 422, "source_http_error")["http_status"] == 401 and WRONG_SANDBOX_KEY not in r.text
    invalid(editor.post(f"/api/builder/projects/{proj['id']}/test", {"stream": "payments", "api_key": SANDBOX_KEY}), "stream")
    names = []
    def refused_manifest(manifest: dict, key: str) -> None:
        name = f"Bad {tag()}"
        names.append(name)
        invalid_any(editor.post("/api/builder/projects", {"name": name, "manifest": manifest}), key, f"manifest.{key}")
    refused_manifest(manifest_with(name="Bad-Name"), "streams.0.name")
    refused_manifest(manifest_with(path="invoices"), "streams.0.path")
    refused_manifest(manifest_with(paginator={"page_size": 0}), "streams.0.paginator.page_size")
    refused_manifest(manifest_with(paginator={"page_size": LIMIT_MAX + 1}), "streams.0.paginator.page_size")
    dup = json.loads(json.dumps(STARTING_MANIFEST))
    dup["streams"].append(dup["streams"][0])
    refused_manifest(dup, "streams.1.name")
    refused_manifest({**STARTING_MANIFEST, "streams": []}, "streams")
    stored = [p["name"] for p in body(editor.get("/api/builder/projects"), 200)["projects"]]
    assert not set(names) & set(stored)


REFUSED_BASES = ["/mock-api/../api/members", "/mock-api/%2e%2e/api/members", "/mock-api//evil.example/v1",
                 "/elsewhere/v1", "/mock-api/v1?x=1", "/mock-api/v1#x", "/mock-api\\v1", "/mock-api/u@host/v1"]


def test_builder_sandbox_only(app_url):
    editor = new_member(app_url, "editor")
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(8)
    hits: list[Any] = []
    def accept() -> None:
        while True:
            try:
                hits.append(listener.accept())
            except OSError:
                return
    threading.Thread(target=accept, daemon=True).start()
    port = listener.getsockname()[1]
    loopback = listener.getsockname()[0]
    authority = "/" * 2 + f"{loopback}:{port}"
    try:
        for base_url in REFUSED_BASES + [f"http:{authority}/mock-api/v1", f"{authority}/mock-api/v1"]:
            invalid_any(editor.post("/api/builder/projects", {"name": f"S {tag()}", "manifest": {**STARTING_MANIFEST, "base_url": base_url}}),
                        "base_url", "manifest.base_url")
        for path in ("/../../api/members", f"{authority}/x", "/%2e%2e/%2e%2e/api/members"):
            invalid_any(editor.post("/api/builder/projects", {"name": f"S {tag()}", "manifest": manifest_with(path=path)}),
                        "streams.0.path", "manifest.streams.0.path")
        proj = body(editor.post("/api/builder/projects", {"name": f"Dot {tag()}", "manifest": {**STARTING_MANIFEST, "base_url": "/mock-api/v1/./"}}), 201)["project"]
        res = body(editor.post(f"/api/builder/projects/{proj['id']}/test", {"stream": "invoices", "api_key": SANDBOX_KEY}), 200)
        assert len(res["records"]) == len(INVOICES)
        bad = {"name": proj["name"], "manifest": {**STARTING_MANIFEST, "base_url": "/mock-api/../api/members"}}
        invalid_any(editor.put(f"/api/builder/projects/{proj['id']}", bad), "base_url", "manifest.base_url")
        assert body(editor.get(f"/api/builder/projects/{proj['id']}"), 200)["project"]["manifest"]["base_url"] == "/mock-api/v1/./"
        assert hits == []
    finally:
        with contextlib.suppress(OSError):
            listener.shutdown(socket.SHUT_RDWR)
        listener.close()


def test_published_connectors(app_url):
    editor = new_member(app_url, "editor")
    proj = body(editor.post("/api/builder/projects", {"name": f"Pub {tag()}", "manifest": STARTING_MANIFEST}), 201)["project"]
    refused(editor.post(f"/api/builder/projects/{proj['id']}/publish", {}), 422, "stream_not_tested")
    body(editor.post(f"/api/builder/projects/{proj['id']}/test", {"stream": "invoices", "api_key": SANDBOX_KEY}), 200)
    d1 = body(editor.post(f"/api/builder/projects/{proj['id']}/publish", {}), 201)["definition"]
    assert (d1["type"], d1["custom"], d1["runnable"], d1["version"]) == ("source", True, True, 1)
    d2 = body(editor.post(f"/api/builder/projects/{proj['id']}/publish"), 201)["definition"]
    assert d2["id"] == d1["id"] and d2["version"] == 2
    assert d1["id"] not in {d["id"] for d in body(Api(app_url).get("/api/connector-definitions"), 200)["definitions"]}
    src = body(editor.post("/api/sources", {"name": f"Custom {tag()}", "definition_id": d1["id"], "config": {"api_key": SANDBOX_KEY}}), 201)["source"]
    catalog = body(editor.get(f"/api/sources/{src['id']}/catalog"), 200)["streams"]
    assert [s["name"] for s in catalog] == ["invoices"] and set(catalog[0]["fields"]) == set(INVOICE_SCHEMA)
    assert catalog[0]["cursor_field"] is None
    refused(editor.post(f"/api/sources/{src['id']}/sample-events", {"stream": "invoices", "append": 1}), 422, "sample_events_unsupported")
    dst = make_destination(editor)
    base = {"name": f"CustomConn {tag()}", "source_id": src["id"], "destination_id": dst["id"], "namespace_prefix": "sand_",
            "schedule": {"type": "manual"}, "schema_change_policy": "propagate"}
    invalid_prefix(editor.post("/api/connections", {**base, "streams": [stream_entry("invoices", "incremental_append", custom=True)]}), "streams")
    conn = body(editor.post("/api/connections", {**base, "streams": [stream_entry("invoices", custom=True)]}), 201)["connection"]
    j1 = sync(editor, conn["id"])
    assert j1["definition_version"] == 2
    wait_job(editor, j1["id"], {"running"})
    assert body(editor.post(f"/api/builder/projects/{proj['id']}/publish", {}), 201)["definition"]["version"] == 3
    j1 = wait_job(editor, j1["id"])
    assert j1["status"] == "succeeded" and j1["definition_version"] == 2 and j1["records_committed"] == len(INVOICES)
    assert [r["id"] for r in all_records(editor, dst["id"], "sand_invoices")] == [i[0] for i in INVOICES]
    assert run_job(editor, conn["id"])["definition_version"] == 3
    wrong = body(editor.post("/api/sources", {"name": f"Wrong {tag()}", "definition_id": d1["id"], "config": {"api_key": WRONG_SANDBOX_KEY}}), 201)["source"]
    assert body(editor.post(f"/api/sources/{wrong['id']}/check", {}), 200)["status"] == "failed"


def test_wf_builder_test_and_publish(browser, app_url):
    editor = new_member(app_url, "editor")
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app("/builder")) as page:
        see(page, page.get_by_role("tab", name="UI"))
        eventually(page, lambda: expect(page.get_by_role("textbox", name="Base URL")).to_have_value("/mock-api/v1", timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_role("textbox", name="Stream name")).to_have_value("invoices", timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_role("textbox", name="Path")).to_have_value("/invoices", timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_role("spinbutton", name="Page size")).to_have_value("3", timeout=POLL_MS))
        click(page.get_by_role("tab", name="YAML"))
        yaml_box = page.get_by_role("textbox", name="Manifest YAML")
        see(page, yaml_box)
        text = yaml_box.input_value()
        assert "name: invoices" in text and "page_size: 3" in text
        fill(yaml_box, text.replace("page_size: 3", f"page_size: {LIMIT_MAX}"))
        click(page.get_by_role("tab", name="UI"))
        eventually(page, lambda: expect(page.get_by_role("spinbutton", name="Page size")).to_have_value(str(LIMIT_MAX), timeout=POLL_MS))
        fill(page.get_by_role("spinbutton", name="Page size"), "3")
        click(page.get_by_role("tab", name="YAML"))
        eventually(page, lambda: expect(yaml_box).to_have_value(re.compile(r"page_size: 3\b"), timeout=POLL_MS))
        fill(page.get_by_label("API key", exact=True), SANDBOX_KEY)
        click(page.get_by_role("button", name="Test"))
        status = page.get_by_role("status", name="Builder status")
        says(page, status, f"Test read finished: {len(INVOICES)} records")
        see(page, page.get_by_text(f"{len(INVOICES)} records").first)
        for inv in INVOICES:
            see(page, page.get_by_text(inv[0]).first)
        see(page, page.get_by_text("total_cents").first)
        see(page, page.get_by_text("integer").first)
        before = {d["id"] for d in body(editor.get("/api/connector-definitions"), 200)["definitions"] if d["custom"]}
        click(page.get_by_role("button", name="Publish"))
        says(page, status, "Published version 1")
    customs = [d for d in body(editor.get("/api/connector-definitions"), 200)["definitions"] if d["custom"] and d["id"] not in before]
    assert len(customs) == 1 and customs[0]["type"] == "source" and customs[0]["version"] == 1


def test_wf_builder_bad_yaml(browser, app_url):
    editor = new_member(app_url, "editor")
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app("/builder")) as page:
        yaml_tab = page.get_by_role("tab", name="YAML")
        see(page, yaml_tab)
        click(yaml_tab)
        box = page.get_by_role("textbox", name="Manifest YAML")
        see(page, box)
        good = box.input_value()
        for broken in ("streams: [", "- just\n- a list", "streams: {name: x}"):
            fill(box, broken)
            click(page.get_by_role("tab", name="UI"))
            eventually(page, lambda: expect(box).to_have_accessible_description(re.compile(re.escape(COPY_BAD_YAML)), timeout=POLL_MS))
            eventually(page, lambda: expect(yaml_tab).to_have_attribute("aria-selected", "true", timeout=POLL_MS))
            eventually(page, lambda: expect(page.get_by_role("button", name="Test")).to_be_disabled(timeout=POLL_MS))
            eventually(page, lambda: expect(page.get_by_role("button", name="Publish")).to_be_disabled(timeout=POLL_MS))
        fill(box, good)
        eventually(page, lambda: expect(page.get_by_role("button", name="Test")).to_be_enabled(timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_text(COPY_BAD_YAML)).to_have_count(0, timeout=POLL_MS))
        click(page.get_by_role("tab", name="UI"))
        eventually(page, lambda: expect(page.get_by_role("tab", name="UI")).to_have_attribute("aria-selected", "true", timeout=POLL_MS))


def test_wf_builder_sandbox_refusal(browser, app_url):
    editor = new_member(app_url, "editor")
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app("/builder")) as page:
        base = page.get_by_role("textbox", name="Base URL")
        see(page, base)
        before = description(base)
        fill(base, REFUSED_BASES[0])
        fill(page.get_by_label("API key", exact=True), SANDBOX_KEY)
        click(page.get_by_role("button", name="Test"))
        eventually(page, lambda: ensure(description(base) != before, "no field error beneath Base URL"))
        eventually(page, lambda: expect(page.get_by_text(INVOICES[0][0])).to_have_count(0, timeout=POLL_MS))


def test_home_page(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        eventually(page, lambda: expect(page.get_by_role("heading", level=1)).to_have_text(MARKETING_H1["/"], use_inner_text=True, timeout=POLL_MS))
        see(page, page.get_by_text("14.8K STARS").first)
        see(page, page.get_by_text(HOME_SUBCOPY).first)
        for link in visible_items(page.get_by_role("link", name="Try it free")):
            assert urlparse(link.get_attribute("href") or "").path == "/login"
        see(page, page.get_by_role("link", name="Talk to sales").first)
        for heading in ("Old pipeline problems follow you into the agent era.", "One layer between your systems and everything built on them.",
                        "Private by design, not by promise.", "Hear your data move"):
            eventually(page, lambda heading=heading: expect(page.get_by_role("heading", name=heading)).to_have_count(1, timeout=POLL_MS))
        for text in ("Connector upkeep", "Split versions of the truth", "Control versus ease", "Metadata only", "AI agents", "Warehouses"):
            eventually(page, lambda text=text: expect(page.get_by_text(text).first).to_be_attached(timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_role("tablist", name="One layer").get_by_role("tab")).to_have_text(["01 Copy", "02 Query", "03 Act"], timeout=POLL_MS))
        hidden = page.evaluate("""() => Array.from(document.getElementsByTagName('canvas')).map(c => { let n = c;
            while (n) { if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return true; n = n.parentElement; } return false; })""")
        assert all(hidden)
        click(visible_items(page.get_by_role("link", name="Try it free"))[0])
        on_path(page, "/login")


def test_home_motion(browser, app_url):
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        page.add_init_script(FRAMES_INIT)
        page.reload()
        figure = page.get_by_text("9,000+", exact=True)
        figure.scroll_into_view_if_needed()
        eventually(page, lambda: expect(figure).to_be_visible(timeout=POLL_MS))
        for value in ("300+", "4B", "15%"):
            eventually(page, lambda value=value: expect(page.get_by_text(value, exact=True).first).to_be_attached(timeout=POLL_MS))
        target_y = page.evaluate("el => el.getBoundingClientRect().top + window.scrollY", figure.element_handle())
        assert page.evaluate(LOOPS_JS) == 0 and frames_during(page, CLOCK_PROBE_MS) < LOOP_FRAMES
        story = page.get_by_role("heading", name="Old pipeline problems follow you into the agent era.")
        story.scroll_into_view_if_needed()
        eventually(page, lambda: expect(story).to_be_visible(timeout=POLL_MS))
        assert page.evaluate("h => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.contains(h)).length",
                             story.element_handle()) == 0
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        page.add_init_script(FRAMES_INIT)
        page.reload()
        assert page.evaluate(LOOPS_JS) > 0 or frames_during(page, CLOCK_PROBE_MS) >= LOOP_FRAMES
        page.evaluate("y => window.scrollTo(0, Math.max(0, y - window.innerHeight / 2))", target_y)
        advance(page, COUNT_UP_MS / 5)
        assert page.get_by_text("9,000+", exact=True).count() == 0, "metric did not count up through intermediate values"
        advance(page, 2 * COUNT_UP_MS)
        see(page, page.get_by_text("9,000+", exact=True))
        page.evaluate("() => window.scrollTo(0, 0)")
        story = page.get_by_role("heading", name="Old pipeline problems follow you into the agent era.")
        story.scroll_into_view_if_needed()
        advance(page, STEP_MS / 5)
        durations = page.evaluate("""h => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.contains(h))
            .map(a => a.effect.getComputedTiming().duration)""", story.element_handle())
        assert all(isinstance(d, (int, float)) and d <= FADE_MAX_MS for d in durations)


def test_film(browser, app_url):
    film = httpx.get(app_url + "/media/data-in-sound.webm", timeout=HTTP_TIMEOUT_S)
    assert film.status_code == 200 and film.headers["content-type"].startswith("video/webm")
    assert len(film.content) == FILM_BYTES and hashlib.sha256(film.content).hexdigest() == FILM_SHA256
    part = httpx.get(app_url + "/media/data-in-sound.webm", headers={"Range": "bytes=0-99"}, timeout=HTTP_TIMEOUT_S)
    assert part.status_code == 206 and part.headers["content-range"] == f"bytes 0-99/{FILM_BYTES}" and len(part.content) == 100
    captions = httpx.get(app_url + "/media/data-in-sound.en.vtt", timeout=HTTP_TIMEOUT_S)
    chapters = httpx.get(app_url + "/media/data-in-sound.chapters.vtt", timeout=HTTP_TIMEOUT_S)
    for r in (captions, chapters):
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/vtt")
    assert [c for c in CAPTIONS if c in captions.text] == list(CAPTIONS)
    assert all(name in chapters.text for name in CHAPTERS)
    video = "() => document.getElementsByTagName('video')[0]"
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        dismiss_consent(page)
        tracks = page.evaluate(f"""() => {{ const v = ({video})(); return Array.from(v.getElementsByTagName('track'))
            .map(t => ({{kind: t.kind, src: t.src, lang: t.srclang, label: t.label}})); }}""")
        en = next(t for t in tracks if t["src"].endswith("/media/data-in-sound.en.vtt"))
        assert (en["kind"], en["lang"], en["label"]) == ("captions", "en", "English")
        assert any(t["kind"] == "chapters" and t["src"].endswith("/media/data-in-sound.chapters.vtt") for t in tracks)
        poll(lambda: page.evaluate(f"() => {{ const v = ({video})(); return !v.paused && v.muted && v.loop; }}"), UI_DEADLINE_S, "muted autoplay")
        unmute = page.get_by_role("button", name="Unmute film")
        eventually(page, lambda: expect(unmute).to_have_attribute("aria-pressed", "false", timeout=POLL_MS))
        click(unmute)
        eventually(page, lambda: expect(unmute).to_have_attribute("aria-pressed", "true", timeout=POLL_MS))
        assert page.evaluate(f"() => ({video})().muted") is False
        chapter_list = page.get_by_role("list", name="Chapters")
        for name, start in CHAPTERS.items():
            click(chapter_list.get_by_role("button", name=name))
            poll(lambda s=start: abs(page.evaluate(f"() => ({video})().currentTime") - s) < 1, UI_DEADLINE_S, f"seek to {name}")
        click(page.get_by_role("button", name="Show transcript"))
        for line in CAPTIONS:
            see(page, page.get_by_text(line).first)
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        advance(page, CLOCK_PROBE_MS)
        assert page.evaluate(f"() => ({video})().paused") is True


def test_consent_and_privacy(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        card = page.get_by_role("region", name="Cookie consent")
        see(page, card.get_by_role("button", name="Manage preferences"))
        no_analytics(page)
        click(card.get_by_role("button", name="Dismiss"))
        gone(page, card)
        for route in ("/", "/pricing", "/connectors"):
            page.goto(app_url + route)
            see(page, page.get_by_role("heading", level=1))
            eventually(page, lambda: expect(page.get_by_role("region", name="Cookie consent")).to_have_count(0, timeout=POLL_MS))
        ui_login(page, app_url, VIEWER_EMAIL)
        on_path(page, CONSOLE)
        no_analytics(page)


def test_marketing_routes(browser, app_url):
    for route, h1 in MARKETING_H1.items():
        r = httpx.get(app_url + route, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and h1 in page_text(r.text), route
    missing = httpx.get(app_url + "/no-such-page-wayline", timeout=HTTP_TIMEOUT_S, follow_redirects=False)
    assert missing.status_code == 404
    ctx = browser.new_context(java_script_enabled=False, viewport={"width": WIDE, "height": WIDE_H})
    try:
        page = ctx.new_page()
        for route, h1 in MARKETING_H1.items():
            page.goto(app_url + route)
            expect(page.get_by_role("heading", level=1)).to_contain_text(h1, use_inner_text=True)  # static: JavaScript is disabled in this context (no page clock, no scripts or timers); the server-rendered page is final once goto returns
        resp = page.goto(app_url + "/no-such-page-wayline")
        assert resp.status == 404
        expect(page.get_by_role("link", name=re.compile("home", re.I)).first).to_be_visible()  # static: JavaScript is disabled in this context (no page clock, no scripts or timers); the server-rendered 404 page is final once goto returns
    finally:
        ctx.close()


def test_marketing_chrome(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        reference = None
        for route in MARKETING_H1:
            page.goto(app_url + route)
            banner, footer = page.get_by_role("banner"), page.get_by_role("contentinfo")
            see(page, banner)
            names = (banner.get_by_role("link").all_text_contents(), banner.get_by_role("button").all_text_contents(),
                     footer.get_by_role("link").all_text_contents())
            reference = reference or names
            assert names == reference, route
            for text in ("Build with Wayline", "Ship agents and pipelines in minutes, not days.", "(c) 2026 Wayline. All rights reserved.",
                         "Product", "Resources", "Developers", "Legal"):
                eventually(page, lambda footer=footer, text=text: expect(footer).to_contain_text(text, timeout=POLL_MS))
            see(page, page.get_by_role("region", name="Cookie consent"))
        page.goto(app_url + "/")
        banner = page.get_by_role("banner")
        assert urlparse(banner.get_by_role("link", name="Docs").get_attribute("href")).path == "/data-engineering-resources"
        product, solutions = banner.get_by_role("button", name="Product"), banner.get_by_role("button", name="Solutions")
        click(product)
        eventually(page, lambda: expect(product).to_have_attribute("aria-expanded", "true", timeout=POLL_MS))
        click(product)
        eventually(page, lambda: expect(product).to_have_attribute("aria-expanded", "false", timeout=POLL_MS))
        click(product)
        click(solutions)
        eventually(page, lambda: expect(product).to_have_attribute("aria-expanded", "false", timeout=POLL_MS))
        eventually(page, lambda: expect(solutions).to_have_attribute("aria-expanded", "true", timeout=POLL_MS))
        click(page.get_by_role("heading", level=1))
        eventually(page, lambda: expect(solutions).to_have_attribute("aria-expanded", "false", timeout=POLL_MS))
        rest, hover = state_styles(banner.get_by_role("link", name="Try it free"), "background-color", state="hover")
        assert rest["background-color"] != hover["background-color"]
        if "rgb" in rest["background-color"] and "rgb" in hover["background-color"]:
            assert luminance(hover["background-color"]) < luminance(rest["background-color"])


def test_wf_marketing_site_pricing(browser, app_url):
    with open_app(browser, app_url + "/pricing") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        dismiss_consent(page)
        eventually(page, lambda: expect(page.get_by_role("heading", level=1)).to_have_text(MARKETING_H1["/pricing"], use_inner_text=True, timeout=POLL_MS))
        see(page, page.get_by_text("Try it free for 21 days with 250 credits, roughly 60 GB of syncs. No card needed.").first)
        for plan in PLANS:
            see(page, page.get_by_role("heading", name=plan, exact=True).first)
        for text in ("Best value past 25 GB", "From", "$15", "$140", "/month", "Custom"):
            see(page, page.get_by_text(text, exact=True).first)
        select(page.get_by_role("combobox", name="Credit package"), "80 credits · $340/mo")
        see(page, page.get_by_text("$340", exact=True))
        eventually(page, lambda: expect(page.get_by_text("$140", exact=True)).to_have_count(0, timeout=POLL_MS))
        see(page, page.get_by_role("table", name="Compare the plans"))
        eventually(page, lambda: expect(page.get_by_role("tablist", name="Plan")).to_have_count(0, timeout=POLL_MS))
        page.set_viewport_size({"width": TABLET, "height": TABLET_H})
        eventually(page, lambda: expect(page.get_by_role("tablist", name="Plan")).to_have_count(0, timeout=POLL_MS))
        page.set_viewport_size({"width": PHONE, "height": PHONE_H})
        tabs = page.get_by_role("tablist", name="Plan")
        see(page, tabs)
        eventually(page, lambda: expect(tabs.get_by_role("tab")).to_have_text(list(PLANS), timeout=POLL_MS))
        eventually(page, lambda: expect(tabs.get_by_role("tab", name="Starter")).to_have_attribute("aria-selected", "true", timeout=POLL_MS))
        click(tabs.get_by_role("tab", name="Team"))
        panel = page.get_by_role("tabpanel", name="Team")
        see(page, panel)
        eventually(page, lambda: expect(panel.get_by_role("table", name="Compare the plans").get_by_role("columnheader")).to_have_text(["Team"], timeout=POLL_MS))
        layout(page)


def comparison_cells(table: Locator) -> tuple[list[str], dict[str, list[str]]]:
    rows = table.get_by_role("row")
    header = rows.nth(0)
    assert header.get_by_role("cell").count() == 1 and header.get_by_role("cell").first.inner_text().strip() == ""
    cols = [t.strip() for t in header.get_by_role("columnheader").all_inner_texts()]
    out = {}
    for i in range(1, rows.count()):
        row = rows.nth(i)
        out[row.get_by_role("rowheader").inner_text().strip()] = [t.strip() for t in row.get_by_role("cell").all_inner_texts()]
    return cols, out


def test_wf_marketing_site_comparison(browser, app_url):
    with open_app(browser, app_url + "/pricing") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        dismiss_consent(page)
        table = page.get_by_role("table", name="Compare the plans")
        see(page, table)
        cols, rows = comparison_cells(table)
        assert cols == list(PLANS) and rows == {k: list(v) for k, v in COMPARISON.items()}
        axe(page)
        page.set_viewport_size({"width": PHONE, "height": PHONE_H})
        tabs = page.get_by_role("tablist", name="Plan")
        see(page, tabs)
        for i, plan in enumerate(PLANS):
            click(tabs.get_by_role("tab", name=plan, exact=True))
            panel = page.get_by_role("tabpanel", name=plan, exact=True)
            see(page, panel)
            eventually(page, lambda: expect(page.get_by_role("tabpanel")).to_have_count(1, timeout=POLL_MS))
            cols, rows = comparison_cells(panel.get_by_role("table", name="Compare the plans"))
            assert cols == [plan] and rows == {k: [v[i]] for k, v in COMPARISON.items()}
        axe(page)


def test_wf_marketing_site_keyboard(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        tabs = page.get_by_role("tablist", name="One layer")
        names = ["01 Copy", "02 Query", "03 Act"]
        ready(tabs.get_by_role("tab", name=names[0])).focus()
        captions = [page.get_by_role("tabpanel", name=names[0]).inner_text()]
        for key, expected in (("ArrowRight", 1), ("End", 2), ("ArrowRight", 0), ("ArrowLeft", 2), ("Home", 0), ("ArrowRight", 1)):
            page.keyboard.press(key)
            tab = tabs.get_by_role("tab", name=names[expected])
            eventually(page, lambda t=tab: expect(t).to_be_focused(timeout=POLL_MS))
            eventually(page, lambda tab=tab: expect(tab).to_have_attribute("aria-selected", "true", timeout=POLL_MS))
            see(page, page.get_by_role("tabpanel", name=names[expected]))
            captions.append(page.get_by_role("tabpanel", name=names[expected]).inner_text())
        assert len(set(captions)) == 3
        page.keyboard.press("Tab")
        assert page.evaluate("() => document.activeElement.getAttribute('role')") != "tab"
        product = page.get_by_role("banner").get_by_role("button", name="Product")
        ready(product).focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(product).to_have_attribute("aria-expanded", "true", timeout=POLL_MS))
        focused_link = "() => document.activeElement.tagName === 'A' ? document.activeElement.textContent.trim() : null"
        eventually(page, lambda: ensure(page.evaluate(focused_link), "focus not in the menu panel"))
        top = page.evaluate(focused_link)
        page.keyboard.press("ArrowUp")
        assert page.evaluate(focused_link)
        page.keyboard.press("ArrowDown")
        assert page.evaluate(focused_link) == top
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(product).to_have_attribute("aria-expanded", "false", timeout=POLL_MS))
        eventually(page, lambda: expect(product).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("ArrowDown")
        eventually(page, lambda: expect(product).to_have_attribute("aria-expanded", "true", timeout=POLL_MS))
        eventually(page, lambda: ensure(page.evaluate(focused_link), "focus not in the menu panel"))
        page.keyboard.press("Shift+Tab")
        eventually(page, lambda: expect(product).to_have_attribute("aria-expanded", "false", timeout=POLL_MS))
        page.set_viewport_size({"width": PHONE, "height": PHONE_H})
        menu = page.get_by_role("button", name="Menu")
        see(page, menu)
        click(menu)
        overlay = page.get_by_role("dialog", name="Menu")
        see(page, overlay)
        eventually(page, lambda: expect(overlay.get_by_role("button", name="Close menu")).to_be_focused(timeout=POLL_MS))
        handle = overlay.element_handle()
        controls = len(visible_items(overlay.get_by_role("link"))) + len(visible_items(overlay.get_by_role("button")))
        for key in ["Tab"] * (controls + 2) + ["Shift+Tab"] * 3:
            page.keyboard.press(key)
            assert page.evaluate("d => d.contains(document.activeElement)", handle)
        page.keyboard.press("Escape")
        gone(page, overlay)
        eventually(page, lambda: expect(menu).to_be_focused(timeout=POLL_MS))
    with open_app(browser, app_url + "/pricing") as page:
        page.set_viewport_size({"width": PHONE, "height": PHONE_H})
        tabs = page.get_by_role("tablist", name="Plan")
        starter = tabs.get_by_role("tab", name="Starter")
        see(page, starter)
        ready(starter).focus()
        for key, plan in (("ArrowLeft", "Private Cloud"), ("Home", "Starter"), ("ArrowRight", "Team"), ("End", "Private Cloud"), ("ArrowRight", "Starter")):
            page.keyboard.press(key)
            tab = tabs.get_by_role("tab", name=plan, exact=True)
            eventually(page, lambda t=tab: expect(t).to_be_focused(timeout=POLL_MS))
            eventually(page, lambda tab=tab: expect(tab).to_have_attribute("aria-selected", "true", timeout=POLL_MS))
            see(page, page.get_by_role("tabpanel", name=plan, exact=True))


NOTHING_INERT_JS = "() => Array.from(document.body.children).every(n => !n.inert && n.getAttribute('aria-hidden') !== 'true')"


def test_wf_marketing_site_closed_panels(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        def link_names() -> list[str]:
            return [n.strip() for n in page.get_by_role("link").all_text_contents()]
        closed = link_names()
        product = page.get_by_role("banner").get_by_role("button", name="Product")
        click(product)
        eventually(page, lambda: expect(product).to_have_attribute("aria-expanded", "true", timeout=POLL_MS))
        opened = link_names()
        panel_only = [n for n in set(opened) if opened.count(n) > closed.count(n)]
        assert panel_only, "a closed menu panel stays in the accessibility tree"
        click(product)
        eventually(page, lambda: expect(product).to_have_attribute("aria-expanded", "false", timeout=POLL_MS))
        visited = tab_order(page, len(closed) + 12)
        assert not [n for n in visited if n in panel_only and closed.count(n) == 0]
        click(page.get_by_role("region", name="Cookie consent").get_by_role("button", name="Dismiss"))
        gone(page, page.get_by_role("region", name="Cookie consent"))
        assert "Manage preferences" not in tab_order(page, len(closed) + 12)
        page.set_viewport_size({"width": PHONE, "height": PHONE_H})
        eventually(page, lambda: expect(page.get_by_role("dialog", name="Menu")).to_have_count(0, timeout=POLL_MS))
        eventually(page, lambda: expect(page.get_by_role("button", name="Close menu")).to_have_count(0, timeout=POLL_MS))
        layout(page)
        click(page.get_by_role("button", name="Menu"))
        see(page, page.get_by_role("dialog", name="Menu"))
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        gone(page, page.get_by_role("dialog", name="Menu"))
        see(page, page.get_by_role("heading", level=1))
        ready(product).focus()
        eventually(page, lambda: expect(product).to_be_focused(timeout=POLL_MS))
        assert page.evaluate(NOTHING_INERT_JS)
    with console(browser, app_url, VIEWER_EMAIL, width=PHONE, height=PHONE_H) as page:
        eventually(page, lambda: expect(page.get_by_role("dialog", name="Navigation")).to_have_count(0, timeout=POLL_MS))
        assert "Close navigation" not in tab_order(page, 15)
        click(page.get_by_role("button", name="Open navigation"))
        see(page, page.get_by_role("dialog", name="Navigation"))
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        gone(page, page.get_by_role("dialog", name="Navigation"))
        see(page, page.get_by_role("navigation", name="Console"))
        assert page.evaluate(NOTHING_INERT_JS)


def test_request_identity(app_url):
    editor = new_member(app_url, "editor")
    assert editor.get("/api/me").headers.get("x-request-id")
    err = editor.get(f"/api/jobs/{MALFORMED_ID}")
    assert refused(err, 404, "not_found")["request_id"] == err.headers["x-request-id"]
    mine = f"verifier-{tag()}"
    assert editor.get("/api/me", headers={"X-Request-Id": mine}).headers["x-request-id"] == mine
    assert editor.get("/api/me", headers={"X-Request-Id": "abc"}).headers["x-request-id"] != "abc"
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    trigger = f"trigger-{tag()}"
    job = body(editor.post(f"/api/connections/{pipe.cid}/sync", {}, headers={"X-Request-Id": trigger}), 201)["job"]
    assert job["trigger_request_id"] == trigger
    body(editor.post(f"/api/jobs/{job['id']}/cancel", {}), 200)
    assert get_job(editor, job["id"])["trigger_request_id"] == trigger


def test_wf_cross_cutting_preferences(browser, app_url):
    member = new_member(app_url, "viewer")
    invalid(member.patch("/api/me/preferences", {"theme": "sepia"}), "theme")
    with console(browser, app_url, member.email, MEMBER_PASSWORD) as page:
        heading = page.get_by_role("heading", level=1, name="Connections")
        see(page, heading)
        light = luminance(heading.evaluate(BACKGROUND_JS))
        dark_switch, sounds = page.get_by_role("switch", name="Dark theme"), page.get_by_role("switch", name="Sync sounds")
        click(dark_switch)
        click(sounds)
        says(page, page.get_by_role("status", name="Settings status").or_(page.get_by_text("Preferences saved")).first, "Preferences saved")
        eventually(page, lambda: ensure(luminance(heading.evaluate(BACKGROUND_JS)) < light, "dark theme did not darken the console"))
        page.reload()
        see(page, heading)
        eventually(page, lambda: expect(dark_switch).to_be_checked(timeout=POLL_MS))
        eventually(page, lambda: expect(sounds).to_be_checked(timeout=POLL_MS))
    prefs = body(login(app_url, member.email, MEMBER_PASSWORD).get("/api/me"), 200)["user"]["preferences"]
    assert prefs == {"sync_sounds": True, "theme": "dark"}


def test_wf_cross_cutting_command_palette(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    with console(browser, app_url, editor.email, MEMBER_PASSWORD) as page:
        sounds = page.get_by_role("switch", name="Sync sounds")
        see(page, sounds)
        ready(sounds).focus()
        page.keyboard.press("Control+k")
        palette = page.get_by_role("dialog", name="Command palette")
        see(page, palette)
        search = palette.get_by_role("textbox", name="Search commands")
        eventually(page, lambda: expect(search).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Escape")
        gone(page, palette)
        eventually(page, lambda: expect(sounds).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Control+k")
        see(page, palette)
        fill(search, pipe.connection["name"])
        see(page, palette.get_by_role("option", name=re.compile(re.escape(pipe.connection["name"]))))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        on_path(page, app(f"/connections/{pipe.cid}"))


def test_console_accessibility(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    run_job(editor, pipe.cid)
    paths = console_paths(pipe)
    for theme in ("light", "dark"):
        body(editor.patch("/api/me/preferences", {"theme": theme}), 200)
        with console(browser, app_url, editor.email, MEMBER_PASSWORD) as page:
            for path in paths:
                page.goto(app_url + path)
                see(page, page.get_by_role("heading", level=1))
                axe(page)
                assert_focus_visible(page, 12)


def test_console_touch_targets(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    run_job(editor, pipe.cid)
    paths = console_paths(pipe)
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, width=PHONE, height=PHONE_H) as page:
        for path in paths:
            page.goto(app_url + path)
            see(page, page.get_by_role("heading", level=1))
            assert_targets(page, control_locators(page), path)
        click(page.get_by_role("button", name="Open navigation"))
        drawer = page.get_by_role("dialog", name="Navigation")
        see(page, drawer)
        assert_targets(page, [drawer.get_by_role("link"), drawer.get_by_role("button")], "drawer")


def test_console_reduced_motion(browser, app_url):
    editor = new_member(app_url, "editor")
    pipe = make_pipe(editor, {"orders": "full_refresh_overwrite"})
    with console(browser, app_url, editor.email, MEMBER_PASSWORD, path=app(f"/connections/{pipe.cid}"), reduced="reduce", init=FRAMES_INIT) as page:
        click(page.get_by_role("button", name="Sync now"))
        says(page, page.get_by_role("status", name="Sync status"), COPY_RUNNING)
        job = jobs_of(editor, pipe.cid)[0]
        # Feedback states: while the job is under way its row reads Pending or Running.
        eventually(page, lambda: expect(job_row(page, job["id"])).to_contain_text(re.compile(r"Pending|Running"), timeout=POLL_MS))
        says(page, page.get_by_role("log", name="Live log"), "Sync started")
        assert page.evaluate(LOOPS_JS) == 0 and frames_during(page, CLOCK_PROBE_MS) < LOOP_FRAMES
        says(page, page.get_by_role("status", name="Sync status"), COPY_SUCCEEDED, JOB_DEADLINE_S)
        says(page, page.get_by_role("log", name="Live log"), "Sync succeeded")


def test_responsive_public(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        for width, height in ((NARROWEST, PHONE_H), (PHONE, PHONE_H), (TABLET, TABLET_H), (WIDE, WIDE_H)):
            page.set_viewport_size({"width": width, "height": height})
            for route in ("/", "/connectors", "/pricing", "/signin", "/login", "/compare"):
                page.goto(app_url + route)
                see(page, page.get_by_role("heading", level=1))
                layout(page)
        page.set_viewport_size({"width": PHONE, "height": PHONE_H})
        page.goto(app_url + "/")
        try_it = visible_items(page.get_by_role("link", name="Try it free"))[-1].bounding_box()
        sales = visible_items(page.get_by_role("link", name="Talk to sales"))[-1].bounding_box()
        assert sales["y"] >= try_it["y"] + try_it["height"] - 1 and abs(sales["width"] - try_it["width"]) < 1
        for width, folded in ((BELOW_RAIL, True), (RAIL, False)):
            page.set_viewport_size({"width": width, "height": WIDE_H})
            menu, product = page.get_by_role("button", name="Menu"), page.get_by_role("button", name="Product")
            if folded:
                see(page, menu)
                assert not visible_items(product)
            else:
                see(page, product)
                assert not visible_items(menu)
        page.goto(app_url + "/connectors")
        for width, columns in ((PHONE, 1), (TABLET, 2), (RAIL, 3), (WIDE, 3)):
            page.set_viewport_size({"width": width, "height": WIDE_H})
            see(page, page.get_by_role("link", name="PostgreSQL", exact=True))
            xs = {round(page.get_by_role("link", name=n, exact=True).bounding_box()["x"]) for n, *_ in CATALOG}
            assert len(xs) == columns, (width, xs)


def test_public_accessibility(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        for width, height in ((WIDE, WIDE_H), (PHONE, PHONE_H)):
            page.set_viewport_size({"width": width, "height": height})
            for route in MARKETING_H1:
                page.goto(app_url + route)
                see(page, page.get_by_role("heading", level=1))
                axe(page)
        page.set_viewport_size({"width": WIDE, "height": WIDE_H})
        for route in ("/", "/connectors", "/pricing", "/login"):
            page.goto(app_url + route)
            assert_focus_visible(page, 15)
        page.set_viewport_size({"width": PHONE, "height": PHONE_H})
        for route in ("/", "/pricing", "/connectors", "/signin", "/login"):
            page.goto(app_url + route)
            see(page, page.get_by_role("heading", level=1))
            assert_targets(page, control_locators(page) + [page.get_by_role("banner").get_by_role("link"),
                                                            page.get_by_role("contentinfo").get_by_role("link")], route)
        page.goto(app_url + "/")
        click(page.get_by_role("button", name="Menu"))
        overlay = page.get_by_role("dialog", name="Menu")
        see(page, overlay)
        assert_targets(page, [overlay.get_by_role("link"), overlay.get_by_role("button")], "menu overlay")


APP_ROOT = Path("/app")
ALLOWED_LICENCES = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "0BSD", "PSF-2.0"}
LICENCE_ALIASES = {"mit license": "MIT", "apache software license": "Apache-2.0", "apache 2.0": "Apache-2.0",
                   "apache license 2.0": "Apache-2.0", "apache-2": "Apache-2.0", "bsd license": "BSD-3-Clause", "bsd": "BSD-3-Clause",
                   "bsd-3": "BSD-3-Clause", "new bsd license": "BSD-3-Clause", "isc license (iscl)": "ISC", "isc license": "ISC",
                   "python software foundation license": "PSF-2.0", "psf": "PSF-2.0", "psf-2.0": "PSF-2.0"}


def licence_ok(text: str) -> bool:
    expr = text.strip()
    if " OR " in expr:
        return any(licence_ok(p) for p in expr.strip("()").split(" OR "))
    if " AND " in expr:
        return all(licence_ok(p) for p in expr.strip("()").split(" AND "))
    t = expr.strip("() ")
    return t in ALLOWED_LICENCES or LICENCE_ALIASES.get(t.lower()) in ALLOWED_LICENCES


def shipped_packages() -> dict[str, str]:
    root = deployed_root()
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=root, capture_output=True, text=True,
                         timeout=HTTP_TIMEOUT_S * 4)
    pkgs: dict[str, str] = {}
    def walk(node: dict) -> None:
        for name, dep in (node.get("dependencies") or {}).items():
            if not dep.get("version") or dep.get("missing"):
                continue
            lic = dep.get("license")
            pkgs[name] = lic.get("type", "") if isinstance(lic, dict) else (lic or "")
            walk(dep)
    listing = json.loads(out.stdout)
    assert "error" not in listing, ("npm ls failed", out.returncode, listing.get("error"))
    walk(listing)
    assert pkgs, ("npm ls listed no runtime packages", out.returncode, out.stderr[-500:])
    script = ("import json, importlib.metadata as m\nout = {}\nfor d in m.distributions():\n"
              "    md = d.metadata; n = md['Name']\n"
              "    if not n or n.lower() in ('pip', 'setuptools', 'wheel'): continue\n"
              "    cls = [c.split('::')[-1].strip() for c in md.get_all('Classifier') or [] if c.startswith('License ::')]\n"
              "    lic = md.get('License-Expression') or (cls[0] if cls else ((md.get('License') or '').splitlines() or [''])[0])\n"
              "    out[n] = lic\nprint(json.dumps(out))")
    py = subprocess.run([str(root / ".venv" / "bin" / "python"), "-c", script], capture_output=True, text=True, timeout=HTTP_TIMEOUT_S * 4)
    assert py.returncode == 0, ("venv package listing failed", py.stderr[-500:])
    python_pkgs = json.loads(py.stdout)
    assert python_pkgs, "the app venv lists no installed packages"
    pkgs.update(python_pkgs)
    return pkgs


def test_if_run_manifest():
    m = json.loads((APP_ROOT / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert isinstance(m["install"], str) and isinstance(m["build"], str)
    assert isinstance(m["serve"], str) and m["serve"].strip()


def test_if_python_venv():
    m = json.loads((APP_ROOT / "run.json").read_text())
    assert ".venv" in m["install"]
    for cmd in (m["install"], m["build"], m["serve"]):
        assert "sudo" not in cmd
        bare = re.findall(r"(?:^|[\s;&|(])(?<!-m\s)(pip3?|uvicorn|gunicorn|hypercorn)(?=\s|$)", cmd)
        assert not bare, cmd
        for interp, module in re.findall(r"(\S*python3?)\s+-m\s+(\w+)", cmd):
            assert ".venv/bin/" in interp or module == "venv", cmd


def test_if_user_readme():
    text = (APP_ROOT / "USER_README.md").read_text()
    for item in (ADMIN_EMAIL, EDITOR_EMAIL, VIEWER_EMAIL, PASSWORD):
        assert item in text


def test_if_reserved_dirs():
    for name in (".browser_screenshots", ".downloads"):
        d = APP_ROOT / name
        assert d.is_dir() and list(d.iterdir()) == []


def test_if_third_party_notices():
    text = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text().lower()
    for name in shipped_packages():
        assert name.lower() in text, name
    for item in ("inter", "fragment mono", "jetbrains mono", "perseus"):
        assert item in text


def test_if_licence_allowlist():
    bad = {n: l for n, l in shipped_packages().items() if not licence_ok(l)}
    assert not bad, bad
    text = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    assert ("OFL-1.1" in text or "SIL Open Font License" in text) and "public domain" in text.lower()


def test_if_no_other_datastore():
    for root in {APP_ROOT, deployed_root()}:
        for path in root.rglob("*"):
            if any(p in (".venv", "node_modules", ".git") for p in path.parts) or not path.is_file():
                continue
            assert path.suffix.lower() not in (".db", ".sqlite", ".sqlite3"), path
            with path.open("rb") as fh:
                assert fh.read(16) != b"SQLite format 3\x00", path
    for req in APP_ROOT.glob("requirements*.txt"):
        assert "Redis".lower() not in req.read_text().lower()


def test_if_film_identical():
    data = (APP_ROOT / FILM_PATH).read_bytes()
    assert len(data) == FILM_BYTES and hashlib.sha256(data).hexdigest() == FILM_SHA256
