from __future__ import annotations

import base64
import contextlib
import csv
import hashlib
import hmac
import importlib
import io
import json
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import xml.etree.ElementTree as ET
import zlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlencode, urlparse
from xml.sax.saxutils import escape

import httpx
import pytest
from playwright.sync_api import Page

import conftest
from conftest import (addresses, advance, check, click, fill, layout, open_app, select, shipped_packages, state_styles,
                      tab_order, text)


def _client(name: str) -> Any:
    for module in ("conftest", "postgres", "minio", "clients", "clients.postgres", "clients.minio",
                   "postgres_client", "minio_client"):
        try:
            found = getattr(importlib.import_module(module), name, None)
        except ImportError:
            continue
        if found is not None:
            return found
    raise ImportError(name)


Postgres = _client("Postgres")
S3 = _client("S3")


PASSWORD = "farshore-demo-26"
THEO, MARA, PRIYA = "theo@lanternfish.test", "mara@lanternfish.test", "priya@lanternfish.test"
JUN, SOL = "jun@paperkite.test", "sol@paperkite.test"
ADA = "ada@tidepool.test"
OPERATOR = "operator@farshore.test"
JUN_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
WS_NAMES = {"lanternfish": "Lanternfish Games", "paperkite": "Paper Kite Studio", "tidepool": "Tidepool Tools"}
LF, PK, TP = "lanternfish", "paperkite", "tidepool"
WRONG_PASSWORD = "wrong-password-0"
REGION_NAMES = {"cascade": "Cascade", "meridian": "Meridian", "monsoon": "Monsoon", "pampas": "Pampas"}
CASCADE, MONSOON, PAMPAS = REGION_NAMES["cascade"], REGION_NAMES["monsoon"], REGION_NAMES["pampas"]
FRESH_PASSWORD = "verifier-password-2026"

JSON_LIMIT = 65536
SIGNIN_FAILURES = 5
RECOVERY_CODES = 10
TOTP_STEP_S = 30
TOTP_DIGITS = 6
BUCKET_MIN, BUCKET_MAX = 3, 63
KEY_MAX_BYTES = 1024
META_LIMIT = 2048
TAG_COUNT = 10
TAG_KEY_MAX = 128
TAG_VALUE_MAX = 256
UPLOAD_LIMIT = 50_000_000
PART_NUMBER_MAX = 1000
PART_MAX = 16_777_216
PART_MIN = 5_242_880
SKEW_PROBE_MIN = 20
DESCRIPTION_MAX = 140
PAGE_CAP = 1000
DEFAULT_PAGE = 100
CAP_KEYS = 1005
PREFIX_MAX = 1024
TAG_FILTER_MAX = 256
SEARCH_Q_MAX = 128
SEARCH_MAX = 50
TIME_BUDGET_S = 2
SETTLE_S = 10
SLOWDOWN_RETRY_AFTER = "30"
NONCURRENT_DAYS_MAX = 3650
KEEP_MAX = 100
ABORT_DAYS_MAX = 365
RETENTION_MAX_DAYS = 3650
BULK_KEYS_MAX = 1000
UNDO_S = 30
DELETE_OBJECTS_BODY_MAX = 2_097_152
ENDPOINT_LIMIT = 5
FIRST_ATTEMPT_S = 3
DEFAULT_BACKOFF_S = 10
BACKOFF_SLACK_S = 3
WEBHOOK_ATTEMPTS = 6
LINK_MAX_S = 604_800
LINK_RATE = 30
HOUR_S = 3600
INVITE_RATE = 10
GB_HOURS_DIVISOR = 3_600_000_000_000
SANDBOX_QUOTA = 1_000_000
SANDBOX_EGRESS = 2_000_000
INDIE_STORAGE = 50_000_000_000
SHORT_DAY_S = 4
SHORT_STEP_UP_S = 20
SHORT_OVERLAP_S = 8
SHORT_IDLE_S = 6
SHORT_BACKOFF_S = 1
OPS_REREAD_MS = 2000
KEYS_REREAD_MS = 15000
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]

OPS_MESSAGE = "This area is for the Farshore operator."
TWO_STEP_MESSAGE = "Enter the code from your authenticator app to finish signing in."
STEP_UP_MESSAGE = "Confirm it's you with a code from your authenticator app."
CODE_CHOICE = "Enter a code from your app or a recovery code."
WRONG_CODE = "That code didn't work. Use the current code from your app."
WRONG_RECOVERY = "That recovery code didn't work or was already used."
NEW_PASSWORD_RULE = "Use 12 to 128 characters, different from your current password."
RETAIN_RULE = "Pick a time after now and within 3,650 days."
CURSOR_RULE = "This page link is no longer valid."
LOCK_MESSAGE = "This version is under retention or legal hold."
BUCKET_RULE = "Bucket names are 3 to 63 lowercase letters, digits or hyphens, starting and ending with a letter or digit."
PLACEMENT_RULE = "Choose 1 to 4 different regions; the first is the origin."
KEY_RULE = "This key can't be stored."
META_RULE = "User metadata is limited to 2,048 bytes in total."
TAGS_RULE = "Up to 10 tags; keys 1 to 128 characters, values up to 256."
SVG_RULE = "SVG files with scripts are not accepted."
FIELD_RULE = "This field can't be set."
REQUIRED_RULE = "This field is required."
DISPOSITION_KEY = 'qa/ゲーム "final".bin'
DISPOSITION_EXAMPLE = "attachment; filename=\"___ _final_.bin\"; filename*=UTF-8''%E3%82%B2%E3%83%BC%E3%83%A0%20%22final%22.bin"

TIME_RE = r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC"
AMOUNT_RE = re.compile(r"^(0|[1-9]\d*)(\.\d*[1-9])?$")
WHSEC_RE = re.compile(r"^whsec_[A-Za-z0-9_-]{43}$")
SECRET_RE = re.compile(r"^[A-Za-z0-9]{40}$")
KEY_ID_RE = re.compile(r"^FSK[A-Z0-9]{17}$")
BASE32_RE = re.compile(r"^[A-Z2-7]{32}$")
RECOVERY_RE = re.compile(r"^[a-z0-9]{5}-[a-z0-9]{5}$")


HTTP_TIMEOUT = 120
WAIT_S = 30
LONG_WAIT_S = 180
UI_WAIT_S = 15
GRACE_S = 5
POLL_S = 0.25
STEP_MS = 100
UI_CALL_MS = 2000
POOL_SIZE = 8
TAB_PRESSES = 40
MANY_KEYS = DEFAULT_PAGE + 1
BOT_ERROR_STATUS = 503
S3_SCOPE_REGION = "us-east-1"
CRC32C_POLY = 0x82F63B78

PAGING_KEYS = ["a b.txt", "a+b.txt", "dir/x.bin", "dir/y.bin", "dir2/z.bin", "plain.txt", "r 1+2%.bin",
               "ゲーム/セーブ.bin", "zz/ü.bin"]


def poll(fn: Callable[[], Any], seconds: float = WAIT_S, what: str = "condition", interval: float = POLL_S) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        threading.Event().wait(interval)


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        futures = [pool.submit(run, c) for c in calls]
        return [f.result() for f in futures]


def in_pool(calls: list[Callable[[], Any]]) -> list[Any]:
    with ThreadPoolExecutor(POOL_SIZE) as pool:
        futures = [pool.submit(c) for c in calls]
        return [f.result() for f in futures]


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def parse_iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def shown(value: str) -> str:
    return parse_iso(value).strftime("%Y-%m-%d %H:%M:%S UTC")


def date_of(r: httpx.Response) -> datetime:
    return parsedate_to_datetime(r.headers["date"])


def server_now(base: str) -> datetime:
    return date_of(httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT))


def count(n: int) -> str:
    return f"{n:,}"


def fresh_email() -> str:
    return f"verifier-{uuid.uuid4().hex[:12]}@example.test"


def fresh_bucket() -> str:
    return "vf-" + uuid.uuid4().hex[:12]


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def crc32_b64(data: bytes) -> str:
    return b64(struct.pack(">I", zlib.crc32(data) & 0xFFFFFFFF))


_CRC32C_TABLE = []
for _n in range(256):
    _c = _n
    for _ in range(8):
        _c = (_c >> 1) ^ (CRC32C_POLY if _c & 1 else 0)
    _CRC32C_TABLE.append(_c)


def crc32c_b64(data: bytes) -> str:
    crc = 0xFFFFFFFF
    for byte in data:
        crc = (crc >> 8) ^ _CRC32C_TABLE[(crc ^ byte) & 0xFF]
    return b64(struct.pack(">I", crc ^ 0xFFFFFFFF))


def md5_etag(data: bytes) -> str:
    return '"' + hashlib.md5(data).hexdigest() + '"'


def url_name(name: str) -> str:
    return quote(name, safe="-_.~/").replace("%20", "+")


def fits(template: str, value: str) -> bool:
    pattern = "".join(".+" if part.startswith("<") else re.escape(part) for part in re.split(r"(<[^>]+>)", template))
    return re.fullmatch(pattern, value) is not None


def region_words(n: int) -> str:
    return "1 region" if n == 1 else f"{count(n)} regions"


def other_sessions(n: int) -> str:
    return "1 other session" if n == 1 else f"{count(n)} other sessions"


def stored_copy(key: str, copies: int) -> str:
    return f"Stored {key} as version <short version>. Copies pending in {region_words(copies)}."


def ready_copy(placed: int, short: str) -> str:
    return f"Ready to ship: all {count(placed)} regions hold version {short}."


def deleted_copy(deleted: int, gone: int) -> str:
    middle = f" {count(gone)} were already gone." if gone else ""
    return f"Deleted {count(deleted)} objects.{middle} Undo until <undo until>."


def restored_copy(restored: int, kept: int, removed: int) -> str:
    return (f"Restored {count(restored)} objects." + (f" {count(kept)} kept their newer version." if kept else "")
            + (f" {count(removed)} were removed for good." if removed else ""))


def assert_error(r: httpx.Response, status: int, code: str, field: str | None = None,
                 message: str | None = None) -> dict:
    assert r.status_code == status, (r.status_code, r.text)
    body = r.json()
    assert body["error"] == code, body
    assert isinstance(body.get("message"), str), body
    if field is not None:
        assert field in body.get("errors", {}), body
        if message is not None:
            assert body["errors"][field] == message, body
    return body


def parse_xml(raw: bytes) -> ET.Element:
    root = ET.fromstring(raw)
    for element in root.iter():
        element.tag = element.tag.split("}")[-1]
    return root


def assert_s3_error(r: httpx.Response, status: int, code: str) -> ET.Element:
    assert r.status_code == status, (r.status_code, r.text)
    assert r.headers.get("content-type", "").startswith("application/xml"), r.headers
    root = parse_xml(r.content)
    assert root.tag == "Error" and root.findtext("Code") == code, r.text
    assert root.find("Message") is not None and root.find("RequestId") is not None
    return root


class Api:
    def __init__(self, base: str, cookie: str | None = None, device: str = "verifier"):
        self.base = base.rstrip("/")
        self.token = cookie
        self.device = device

    def call(self, method: str, path: str, body: Any = None, params: dict | None = None, headers: dict | None = None,
             xrw: bool = True, content: bytes | None = None) -> httpx.Response:
        h = {"User-Agent": self.device}
        if self.token:
            h["Cookie"] = f"fs_session={self.token}"
        if method not in ("GET", "HEAD") and xrw:
            h["X-Requested-With"] = "farshore"
        if body is not None:
            content = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        r = httpx.request(method, self.base + path, params=params, content=content, headers=h, timeout=HTTP_TIMEOUT)
        for cookie in r.headers.get_list("set-cookie"):
            if cookie.startswith("fs_session="):
                self.token = cookie.split(";")[0].split("=", 1)[1] or None
        return r

    def get(self, path: str, params: dict | None = None, headers: dict | None = None) -> httpx.Response:
        return self.call("GET", path, params=params, headers=headers)

    def post(self, path: str, body: Any = None, params: dict | None = None, headers: dict | None = None,
             xrw: bool = True) -> httpx.Response:
        return self.call("POST", path, body, params, headers, xrw)

    def put(self, path: str, body: Any = None, params: dict | None = None, headers: dict | None = None,
            content: bytes | None = None) -> httpx.Response:
        return self.call("PUT", path, body, params, headers, content=content)

    def patch(self, path: str, body: Any = None, params: dict | None = None) -> httpx.Response:
        return self.call("PATCH", path, body, params)

    def delete(self, path: str, params: dict | None = None, content: bytes | None = None,
               headers: dict | None = None) -> httpx.Response:
        return self.call("DELETE", path, params=params, headers=headers, content=content)


_last_step: dict[str, int] = {}


def totp(secret: str, step: int) -> str:
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    mac = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    code = (struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** TOTP_DIGITS)
    return str(code).zfill(TOTP_DIGITS)


def next_code(secret: str) -> str:
    step = max(int(time.time()) // TOTP_STEP_S, _last_step.get(secret, -1) + 1)
    poll(lambda: int(time.time()) // TOTP_STEP_S + 1 >= step, TOTP_STEP_S * 3, "next authenticator step")
    _last_step[secret] = step
    return totp(secret, step)


def sign_in(base: str, email: str, password: str = PASSWORD, secret: str | None = None,
            device: str = "verifier") -> Api:
    api = Api(base, device=device)
    r = api.post("/api/session", {"email": email, "password": password})
    if r.status_code == 202:
        assert secret, f"{email} needs a code"
        r = api.post("/api/session/two-step", {"code": next_code(secret)})
    assert r.status_code == 200, (email, r.status_code, r.text)
    return api


def enrol(api: Api) -> tuple[str, list[str]]:
    secret = api.post("/api/me/two-step/setup").json()["secret"]
    r = api.post("/api/me/two-step/enable", {"code": next_code(secret)})
    assert r.status_code == 200, r.text
    return secret, r.json()["recovery_codes"]


@dataclass
class Member:
    api: Api
    user_id: str
    email: str
    password: str


def mails(mail: Any, to: str, subject: str) -> list[dict]:
    return [m for m in mail.messages(0, 0)
            if to.lower() in [a.lower() for a in addresses(m.get("To"))] and m.get("Subject") == subject]


def invite_tokens(mail: Any, email: str, n: int) -> list[str]:
    found = poll(lambda: [m for m in mail.messages(0, 0)
                          if email.lower() in [a.lower() for a in addresses(m.get("To"))]
                          and str(m.get("Subject", "")).startswith("You're invited to")] if True else [], WAIT_S,
                 "invite emails")
    found = poll(lambda: (lambda ms: ms if len(ms) >= n else [])(
        [m for m in mail.messages(0, 0) if email.lower() in [a.lower() for a in addresses(m.get("To"))]
         and str(m.get("Subject", "")).startswith("You're invited to")]), WAIT_S, "invite emails") or found
    found.sort(key=lambda m: str(m.get("Created") or m.get("Date") or ""))
    return [re.search(r"/invite/([A-Za-z0-9_\-]+)", text(m)).group(1) for m in found]


def new_member(base: str, mail: Any, ws: str, owner_email: str, role: str) -> Member:
    owner = sign_in(base, owner_email)
    email = fresh_email()
    invited_role = "developer" if role == "owner" else role

    def invite() -> bool:
        r = owner.post(f"/api/w/{ws}/invites", {"email": email, "role": invited_role})
        assert r.status_code in (201, 429), r.text
        return r.status_code == 201

    poll(invite, LONG_WAIT_S, "invite slot", interval=float(GRACE_S))
    token = invite_tokens(mail, email, 1)[-1]
    api = Api(base)
    r = api.post(f"/api/invites/{token}/accept", {"name": "Verifier " + uuid.uuid4().hex[:6], "password": FRESH_PASSWORD})
    assert r.status_code == 201, r.text
    user_id = api.get("/api/me").json()["user"]["id"]
    if role == "owner":
        assert owner.patch(f"/api/w/{ws}/members/{user_id}", {"role": "owner"}).status_code == 200
    return Member(api, user_id, email, FRESH_PASSWORD)


def remove_member(base: str, ws: str, owner_email: str, member: Member) -> None:
    sign_in(base, owner_email).delete(f"/api/w/{ws}/members/{member.user_id}")


def make_bucket(api: Api, ws: str, placement: list[str]) -> str:
    name = fresh_bucket()
    r = api.post(f"/api/w/{ws}/buckets", {"name": name, "placement": placement})
    assert r.status_code == 201, r.text
    return name


def upload(api: Api, ws: str, bucket: str, key: str, data: bytes, headers: dict | None = None,
           size: int | None = None) -> httpx.Response:
    h = {"Content-Type": "application/octet-stream", "X-Upload-Size": str(len(data) if size is None else size)}
    h.update(headers or {})
    return api.put(f"/api/w/{ws}/buckets/{bucket}/object", params={"key": key}, headers=h, content=data)


def stored(api: Api, ws: str, bucket: str, key: str, data: bytes, headers: dict | None = None) -> dict:
    r = upload(api, ws, bucket, key, data, headers)
    assert r.status_code == 201, (key, r.status_code, r.text)
    return r.json()


def content(api: Api, ws: str, bucket: str, key: str, version: str | None = None) -> httpx.Response:
    params = {"key": key, **({"version": version} if version else {})}
    return api.get(f"/api/w/{ws}/buckets/{bucket}/object/content", params=params)


def versions_of(api: Api, ws: str, bucket: str, key: str) -> list[dict]:
    return api.get(f"/api/w/{ws}/buckets/{bucket}/object/versions", params={"key": key}).json()["versions"]


def bucket_info(api: Api, ws: str, bucket: str) -> dict:
    return api.get(f"/api/w/{ws}/buckets/{bucket}").json()


def replicas_of(api: Api, ws: str, bucket: str, key: str, version: str | None = None) -> httpx.Response:
    params = {"key": key, **({"version": version} if version else {})}
    return api.get(f"/api/w/{ws}/buckets/{bucket}/object/replicas", params=params)


def wait_replica(api: Api, ws: str, bucket: str, key: str, region: str, state: str, version: str | None = None,
                 seconds: float = SETTLE_S + GRACE_S) -> dict:
    def found() -> dict | None:
        r = replicas_of(api, ws, bucket, key, version)
        if r.status_code != 200:
            return None
        replica = next(x for x in r.json()["replicas"] if x["region"] == region)
        return replica if replica["state"] == state else None

    return poll(found, seconds, f"{key} {region} {state}")


def wait_settled(api: Api, ws: str, bucket: str, key: str, seconds: float = SETTLE_S + GRACE_S) -> dict:
    return poll(lambda: (lambda b: b if b.get("ready") else None)(replicas_of(api, ws, bucket, key).json()),
                seconds, f"{key} settled")


def mint_link(api: Api, ws: str, bucket: str, key: str, seconds: int = HOUR_S, version: str | None = None) -> dict:
    params = {"key": key, **({"version": version} if version else {})}
    r = api.post(f"/api/w/{ws}/buckets/{bucket}/object/links", {"expires_in_seconds": seconds}, params=params)
    assert r.status_code == 201, r.text
    return r.json()


def make_key(api: Api, ws: str, permission: str = "read-write", buckets: list[str] | None = None,
             prefix: str | None = None, expires_at: str | None = None, description: str = "verifier key") -> dict:
    r = api.post(f"/api/w/{ws}/keys", {"description": description, "permission": permission, "buckets": buckets,
                                       "prefix": prefix, "expires_at": expires_at})
    assert r.status_code == 201, r.text
    return r.json()


def cred_of(key: dict) -> tuple[str, str]:
    return key["key_id"], key["secret"]


def drop_key(api: Api, ws: str, key_id: str) -> None:
    api.post(f"/api/w/{ws}/keys/{key_id}/disable")
    api.delete(f"/api/w/{ws}/keys/{key_id}")


def drop_endpoint(api: Api, ws: str, endpoint_id: str) -> None:
    api.post(f"/api/w/{ws}/webhooks/{endpoint_id}/disable")
    api.delete(f"/api/w/{ws}/webhooks/{endpoint_id}")


def bucket_rows(api: Api, ws: str, bucket: str) -> list[dict]:
    rows: list[dict] = []
    cursor = None
    while True:
        body = api.get(f"/api/w/{ws}/usage/rows", params={"cursor": cursor} if cursor else None).json()
        rows += [r for r in body["rows"] if r["bucket"] == bucket]
        cursor = body.get("next_cursor")
        if not cursor:
            return rows


def units(api: Api, ws: str, bucket: str) -> Decimal:
    return sum((Decimal(r["amount"]) for r in bucket_rows(api, ws, bucket) if r["unit"] == "request-units"), Decimal(0))


def ops_region(ops: Api, region: str) -> dict:
    return next(r for r in ops.get("/api/ops/regions").json()["regions"] if r["id"] == region)


def region_path(region: str) -> str:
    return f"/api/ops/regions/{region}/state"


def suspension_path(ws: str, action: str) -> str:
    return f"/api/ops/workspaces/{ws}/{action}"


@contextlib.contextmanager
def regions_offline(base: str, *regions: str) -> Iterator[Api]:
    ops = sign_in(base, OPERATOR)
    for region in regions:
        ops.post(f"/api/ops/regions/{region}/state", {"state": "offline"})
    try:
        yield ops
    finally:
        for region in regions:
            sign_in(base, OPERATOR).post(f"/api/ops/regions/{region}/state", {"state": "online"})


def bucket_blobs(observer: Any, bucket: str) -> list[str]:
    return [k for region in REGION_NAMES for k in observer.keys(f"regions/{region}/{bucket}/")]


def minio_copies(observer: Any, bucket: str, version_id: str) -> list[str]:
    return [k for k in bucket_blobs(observer, bucket) if k.endswith(f"/{version_id}")]


def db_mentions(pg: Any, value: str) -> list[str]:
    hits = []
    for table in pg.tables():
        ident = ".".join('"' + p.replace('"', '""') + '"' for p in table.split("."))
        n = pg.rows(f"SELECT count(*) AS n FROM {ident} t WHERE strpos(t::text, $v${value}$v$) > 0")[0]["n"]
        if int(n):
            hits.append(table)
    return hits


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def s3(base: str, cred: tuple[str, str], method: str, bucket: str, key: str | None = None, query: dict | None = None,
       body: bytes = b"", headers: dict | None = None, payload: str | None = None,
       builder: Callable[[bytes, str, str, str], bytes] | None = None, when: datetime | None = None,
       root: str = "/s3", region: str = S3_SCOPE_REGION) -> httpx.Response:
    access, secret = cred
    path = root + "/" + quote(bucket, safe="")
    if key is not None:
        path += "/" + quote(key, safe="/-_.~")
    canonical_query = "&".join(f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}" for k, v in sorted((query or {}).items()))
    amz_date = (when or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    day = amz_date[:8]
    scope = f"{day}/{region}/s3/aws4_request"
    hdrs = {k.lower(): str(v) for k, v in (headers or {}).items()}
    hdrs.update({"host": urlparse(base).netloc, "x-amz-date": amz_date,
                 "x-amz-content-sha256": payload or hashlib.sha256(body).hexdigest()})
    signed = sorted(h for h in hdrs if h == "host" or h.startswith("x-amz-") or h in ("content-md5", "content-encoding"))
    canonical = "\n".join([method, path, canonical_query, "".join(f"{h}:{hdrs[h].strip()}\n" for h in signed),
                           ";".join(signed), hdrs["x-amz-content-sha256"]])
    sts = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    signing_key = _hmac(_hmac(_hmac(_hmac(("AWS4" + secret).encode(), day), region), "s3"), "aws4_request")
    signature = hmac.new(signing_key, sts.encode(), hashlib.sha256).hexdigest()
    hdrs["authorization"] = f"AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={';'.join(signed)}, Signature={signature}"
    if builder:
        body = builder(signing_key, amz_date, scope, signature)
    del hdrs["host"]
    url = base.rstrip("/") + path + ("?" + canonical_query if canonical_query else "")
    return httpx.request(method, url, content=body, headers=hdrs, timeout=HTTP_TIMEOUT)


EMPTY_SHA = hashlib.sha256(b"").hexdigest()


def signed_chunks(data: bytes, size: int, tamper: bool = False) -> Callable[[bytes, str, str, str], bytes]:
    def build(key: bytes, amz_date: str, scope: str, seed: str) -> bytes:
        out, previous = b"", seed
        pieces = [data[i:i + size] for i in range(0, len(data), size)] + [b""]
        for index, chunk in enumerate(pieces):
            sts = "\n".join(["AWS4-HMAC-SHA256-PAYLOAD", amz_date, scope, previous, EMPTY_SHA, hashlib.sha256(chunk).hexdigest()])
            signature = hmac.new(key, sts.encode(), hashlib.sha256).hexdigest()
            sent = ("0" * len(signature)) if tamper and index == 0 else signature
            out += f"{len(chunk):x};chunk-signature={sent}\r\n".encode() + chunk + b"\r\n"
            previous = signature
        return out

    return build


def trailer_body(data: bytes, size: int, name: str, value: str) -> bytes:
    out = b""
    for i in range(0, len(data), size):
        chunk = data[i:i + size]
        out += f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n"
    return out + b"0\r\n" + f"{name}:{value}\r\n".encode() + b"\r\n"


def chunk_headers(data: bytes, extra: dict | None = None) -> dict:
    return {"content-encoding": "aws-chunked", "x-amz-decoded-content-length": str(len(data)), **(extra or {})}


def list_v2(base: str, cred: tuple[str, str], bucket: str, **params: str) -> httpx.Response:
    query = {"list-type": "2", **{k.replace("_", "-"): v for k, v in params.items()}}
    return s3(base, cred, "GET", bucket, query=query)


def multipart_start(base: str, cred: tuple[str, str], bucket: str, key: str, headers: dict | None = None) -> str:
    r = s3(base, cred, "POST", bucket, key, query={"uploads": ""}, headers=headers)
    assert r.status_code == 200, r.text
    return parse_xml(r.content).findtext("UploadId")


def part(base: str, cred: tuple[str, str], bucket: str, key: str, upload_id: str, number: int, data: bytes,
         headers: dict | None = None) -> httpx.Response:
    return s3(base, cred, "PUT", bucket, key, query={"partNumber": str(number), "uploadId": upload_id}, body=data,
              headers=headers)


def complete_xml(parts: list[tuple[int, str]], extras: dict | None = None) -> bytes:
    inner = "".join(f"<Part><PartNumber>{n}</PartNumber><ETag>{escape(e)}</ETag>{(extras or {}).get(n, '')}</Part>"
                    for n, e in parts)
    return f"<CompleteMultipartUpload>{inner}</CompleteMultipartUpload>".encode()


def complete(base: str, cred: tuple[str, str], bucket: str, key: str, upload_id: str, xml: bytes,
             headers: dict | None = None) -> httpx.Response:
    return s3(base, cred, "POST", bucket, key, query={"uploadId": upload_id}, body=xml, headers=headers)


def delete_objects(base: str, cred: tuple[str, str], bucket: str, entries: list[tuple[str, str | None]],
                   quiet: bool = False) -> httpx.Response:
    inner = "".join(f"<Object><Key>{escape(k)}</Key>" + (f"<VersionId>{escape(v)}</VersionId>" if v else "") + "</Object>"
                    for k, v in entries)
    xml = ("<Delete>" + ("<Quiet>true</Quiet>" if quiet else "") + inner + "</Delete>").encode()
    return s3(base, cred, "POST", bucket, query={"delete": ""}, body=xml,
              headers={"content-md5": b64(hashlib.md5(xml).digest())})


class Sink:
    def __init__(self) -> None:
        self.records: list[dict] = []
        self.failing: set[int] = set()
        sink = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                sink.records.append({"at": time.monotonic(), "raw": raw,
                                     "headers": {k.lower(): v for k, v in self.headers.items()}})
                try:
                    sequence = json.loads(raw).get("sequence")
                except ValueError:
                    sequence = None
                self.send_response(BOT_ERROR_STATUS if sequence in sink.failing else 200)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *args: Any) -> None:
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/hook"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def of(self, sequence: int) -> list[dict]:
        return [r for r in list(self.records) if json.loads(r["raw"]).get("sequence") == sequence]

    def close(self) -> None:
        self.server.shutdown()
        with contextlib.suppress(OSError):
            self.server.socket.shutdown(socket.SHUT_RDWR)
        self.server.server_close()


def verify_signature(record: dict, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in record["headers"]["farshore-signature"].split(","))
    expected = hmac.new(secret.encode(), parts["t"].encode() + b"." + record["raw"], hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])


@contextlib.contextmanager
def app_page(browser: Any, url: str, reduced_motion: str = "no-preference") -> Iterator[Page]:
    opened = open_app(browser, url, reduced_motion=reduced_motion)
    if hasattr(opened, "__enter__"):
        with opened as page:
            page.set_default_timeout(UI_CALL_MS)
            yield page
    else:
        page = next(opened)
        page.set_default_timeout(UI_CALL_MS)
        try:
            yield page
        finally:
            next(opened, None)


def wait_ui(page: Page, predicate: Callable[[], Any], seconds: float = UI_WAIT_S, what: str = "ui state") -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            if predicate():
                return
        except Exception:
            pass
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        advance(page, STEP_MS)
        threading.Event().wait(POLL_S)


def path_of(page: Page) -> str:
    return urlparse(page.url).path


def query_of(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlparse(page.url).query, keep_blank_values=True)


def status_text(page: Page, name: str) -> str:
    return " ".join((page.get_by_role("status", name=name).text_content() or "").split())


def body_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def is_focused(locator: Any) -> bool:
    return locator.evaluate("e => e === document.activeElement")


def session_cookie(page: Page) -> str:
    return next(c["value"] for c in page.context.cookies() if c["name"] == "fs_session")


def ui_sign_in(page: Page, email: str, password: str = PASSWORD, secret: str | None = None) -> None:
    box = page.get_by_role("textbox", name="Email")
    wait_ui(page, box.is_visible, what="sign-in form")
    fill(box, email)
    fill(page.get_by_label("Password", exact=True), password)
    click(page.get_by_role("button", name="Sign in"))
    code_box = page.get_by_role("textbox", name="Authenticator code")
    if secret:
        wait_ui(page, code_box.is_visible, what="code step")
        fill(code_box, next_code(secret))
        click(page.get_by_role("button", name="Verify"))
    wait_ui(page, lambda: path_of(page) != "/signin" or code_box.is_visible(), what="signed in")


def nav_to(page: Page, name: str) -> None:
    opener = page.get_by_role("button", name="Workspaces and buckets")
    if opener.is_visible():
        click(opener)
    link = page.get_by_role("navigation", name="Workspace").get_by_role("link", name=name, exact=True)
    wait_ui(page, link.is_visible, what=f"{name} link")
    click(link)


def downloaded(page: Page, locator: Any) -> bytes:
    with page.expect_download(timeout=WAIT_S * 1000) as info:
        click(locator)
    return Path(info.value.path()).read_bytes()


def count_texts(page: Page, status: Any) -> None:
    status.evaluate("""e => {
        e.__seen = [];
        const push = () => { const t = e.textContent.trim().replace(/\\s+/g, ' ');
                             if (t && e.__seen[e.__seen.length - 1] !== t) e.__seen.push(t); };
        new MutationObserver(push).observe(e, {childList: true, subtree: true, characterData: true});
    }""")


def seen_texts(status: Any) -> list[str]:
    return status.evaluate("e => e.__seen || []")


def in_order(names: list[str], wanted: list[str]) -> bool:
    position = 0
    for name in wanted:
        try:
            position = names.index(name, position) + 1
        except ValueError:
            return False
    return True


DRAG_SCRIPT = """(el, arg) => {
    const dt = new DataTransfer();
    for (const f of arg.files) dt.items.add(new File([f.body], f.name, {type: 'application/octet-stream'}));
    const kinds = arg.phase === 'hover' ? ['dragenter', 'dragover'] : ['dragover', 'drop'];
    for (const k of kinds) el.dispatchEvent(new DragEvent(k, {bubbles: true, cancelable: true, dataTransfer: dt}));
}"""


def test_health_and_dependencies(app_url: str) -> None:
    for base in (app_url.rstrip("/"), env_url("APP_KILLBILL_DOWN_URL")):
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert r.headers["content-type"].startswith("application/json")


NEVER_SERVED = ["/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts",
                "/dist/server.js", "/node_modules/.package-lock.json", "/.git/config"]


def test_server_boundary(app_url: str) -> None:
    base = app_url.rstrip("/")
    for path in NEVER_SERVED:
        r = httpx.get(base + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404, path
    r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
    assert "server" not in r.headers
    theo = sign_in(base, THEO)
    core = json.dumps({"name": "NOT A NAME", "placement": ["cascade"]})
    at_limit = core[:-1] + " " * (JSON_LIMIT - len(core)) + "}"
    assert len(at_limit.encode()) == JSON_LIMIT
    headers = {"Content-Type": "application/json"}
    r = theo.call("POST", f"/api/w/{LF}/buckets", content=at_limit.encode(), headers=headers)
    assert_error(r, 422, "validation_failed", "name")
    r = theo.call("POST", f"/api/w/{LF}/buckets", content=(at_limit + " ").encode(), headers=headers)
    assert_error(r, 413, "payload_too_large")
    r = Api(base).post("/api/session", {"email": THEO, "password": PASSWORD})
    cookies = r.headers.get_list("set-cookie")
    assert len(cookies) == 1 and cookies[0].startswith("fs_session=")
    assert "HttpOnly".lower() in cookies[0].lower() and "SameSite=Lax".lower() in cookies[0].lower()
    token = cookies[0].split(";")[0].split("=", 1)[1]
    assert token not in r.text and token not in Api(base, cookie=token).get("/api/me").text
    page = httpx.get(base + "/", timeout=HTTP_TIMEOUT).text + httpx.get(base + "/signin", timeout=HTTP_TIMEOUT).text
    assets = set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', page))
    served = page + "".join(httpx.get(base + a, timeout=HTTP_TIMEOUT).text for a in assets)
    for name in ("FARSHORE_SECRET_KEY", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "KILLBILL_PASSWORD",
                 "KILLBILL_API_SECRET", "DATABASE_URL"):
        value = os.environ.get(name)
        if value and len(value) >= 8 and not re.fullmatch(r"[a-z]+", value):
            assert value not in served, name


def test_error_shape_and_precedence(app_url: str) -> None:
    base = app_url.rstrip("/")
    body = {"name": fresh_bucket(), "placement": ["cascade"]}
    assert_error(Api(base).post(f"/api/w/{LF}/buckets", body, xrw=False), 403, "forbidden")
    assert_error(Api(base).post(f"/api/w/{LF}/buckets", body), 401, "unauthenticated")
    pending = Api(base)
    assert pending.post("/api/session", {"email": JUN, "password": PASSWORD}).status_code == 202
    assert_error(pending.post(f"/api/w/{PK}/buckets", body, xrw=False), 403, "forbidden")
    assert_error(pending.get(f"/api/w/{PK}/buckets"), 401, "two_step_required")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    invalid = theo.post(f"/api/w/{LF}/buckets", {"name": "NO", "placement": ["atlantis"]})
    errors = assert_error(invalid, 422, "validation_failed")["errors"]
    assert errors["name"] == BUCKET_RULE and errors["placement"] == PLACEMENT_RULE
    assert_error(theo.get(f"/api/w/{PK}/buckets"), 404, "not_found")
    with regions_offline(base, "pampas"):
        bucket = make_bucket(theo, "lanternfish", ["pampas"])
        key = make_key(mara, "lanternfish", buckets=[bucket])
        assert_error(upload(theo, "lanternfish", bucket, "a/../b", b"x"), 422, "validation_failed", "key", KEY_RULE)
        assert_error(upload(theo, "lanternfish", bucket, "fine.bin", b"x"), 503, "region_offline")
        assert_s3_error(s3(base, cred_of(key), "PUT", bucket, "a\\b", body=b"x"), 400, "InvalidArgument")
        assert_s3_error(s3(base, cred_of(key), "PUT", bucket, "fine.bin", body=b"x"), 503, "SlowDown")
    bogus = ("FSK" + "0" * 17, "x" * 40)
    assert_s3_error(s3(base, bogus, "GET", bucket, query={"acl": ""}), 403, "InvalidAccessKeyId")
    assert_s3_error(s3(base, cred_of(key), "GET", bucket, query={"acl": ""}), 501, "NotImplemented")
    assert_s3_error(s3(base, cred_of(key), "GET", bucket), 501, "NotImplemented")
    assert_s3_error(s3(base, cred_of(key), "GET", fresh_bucket(), "k"), 404, "NoSuchBucket")
    assert_s3_error(s3(base, cred_of(key), "GET", "paperkite-replays", "season-1/manifest.json"), 403, "AccessDenied")
    drop_key(mara, "lanternfish", key["key_id"])


def test_wf_team_access_signin_and_roles(browser: Any, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    member = new_member(base, mail, "tidepool", ADA, "developer")
    unknown = fresh_email()
    for attempt in range(SIGNIN_FAILURES):
        known = Api(base).post("/api/session", {"email": member.email, "password": WRONG_PASSWORD})
        other = Api(base).post("/api/session", {"email": unknown, "password": WRONG_PASSWORD})
        assert_error(known, 401, "invalid_credentials")
        assert known.json() == other.json()
        assert set(known.headers) - {"date"} == set(other.headers) - {"date"}
    throttled = Api(base).post("/api/session", {"email": member.email.upper(), "password": member.password})
    other = Api(base).post("/api/session", {"email": unknown, "password": member.password})
    for r in (throttled, other):
        body = assert_error(r, 429, "rate_limited")
        assert int(r.headers["retry-after"]) >= 1 and body["retry_after_seconds"] >= 1
    assert set(throttled.json()) == set(other.json()) and set(throttled.headers) - {"date"} == set(other.headers) - {"date"}
    remove_member(base, "tidepool", ADA, member)
    r = Api(base).post("/api/session", {"email": THEO, "password": PASSWORD})
    assert r.status_code == 200 and r.json()["user"]["email"] == THEO and r.json()["user"]["operator"] is False
    assert {"workspace": {"slug": "lanternfish", "name": "Lanternfish Games"}, "role": "developer"} in r.json()["memberships"]
    theo, priya, mara = sign_in(base, THEO), sign_in(base, PRIYA), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    stored(theo, "lanternfish", bucket, "roles.bin", b"roles")
    assert_error(upload(priya, "lanternfish", bucket, "p.bin", b"x"), 403, "forbidden")
    assert_error(priya.post(f"/api/w/{LF}/buckets", {"name": fresh_bucket(), "placement": ["cascade"]}), 403, "forbidden")
    assert_error(priya.put(f"/api/w/{LF}/buckets/{bucket}/lifecycle",
                           {"noncurrent_days": None, "keep_newest_noncurrent": 0, "abort_multipart_days": None}), 403, "forbidden")
    own = mint_link(priya, "lanternfish", bucket, "roles.bin")
    theirs = mint_link(theo, "lanternfish", bucket, "roles.bin")
    assert_error(priya.post(f"/api/w/{LF}/links/{theirs['id']}/revoke"), 403, "forbidden")
    assert priya.post(f"/api/w/{LF}/links/{own['id']}/revoke").status_code == 200
    assert theo.post(f"/api/w/{LF}/links/{mint_link(priya, LF, bucket, 'roles.bin')['id']}/revoke").status_code == 200
    for section in ("members", "keys", "usage", "webhooks", "audit", "encryption"):
        path = f"/api/w/{LF}/{section}"
        assert_error(theo.get(path), 403, "forbidden")
        assert mara.get(path).status_code == 200, path
    with app_page(browser, base + "/signin") as page:
        fill(page.get_by_role("textbox", name="Email"), fresh_email())
        fill(page.get_by_label("Password", exact=True), WRONG_PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        wait_ui(page, lambda: page.get_by_role("alert").inner_text().strip() == "Email or password is incorrect.")
    for who, links in ((THEO, ["Objects", "Share links"]),
                       (MARA, ["Objects", "Share links", "Team", "Access keys", "Usage", "Webhooks", "Security"])):
        with app_page(browser, base + f"/console/{LF}/{bucket}") as page:
            ui_sign_in(page, who)
            nav = page.get_by_role("navigation", name="Workspace")
            wait_ui(page, nav.is_visible)
            names = [" ".join(t.split()) for t in nav.get_by_role("link").all_inner_texts()]
            assert names == links, names


def test_responsive_layout(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    for path, who in (("/", None), (f"/console/{PK}", SOL), ("/ops", OPERATOR)):
        with app_page(browser, base + path) as page:
            if who:
                ui_sign_in(page, who)
                wait_ui(page, lambda: path_of(page).startswith(path))
            for width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                advance(page, STEP_MS)
                layout(page)
                if who == SOL:
                    opener = page.get_by_role("button", name="Workspaces and buckets")
                    if width < VIEWPORTS[-1][0]:
                        wait_ui(page, opener.is_visible)
                        click(opener)
                        dialog = page.get_by_role("dialog", name="Navigation")
                        wait_ui(page, dialog.is_visible)
                        assert dialog.get_by_role("navigation", name="Buckets").is_visible()
                        click(dialog.get_by_role("button", name="Close navigation"))
                        wait_ui(page, lambda: not dialog.is_visible())
                    else:
                        wait_ui(page, page.get_by_role("navigation", name="Buckets").is_visible)


def test_keyboard_and_focus(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    manifest = "season-1/manifest.json"
    url = base + f"/console/{PK}/paperkite-replays?prefix=" + quote("season-1/", safe="")
    with app_page(browser, url) as page:
        page.set_viewport_size({"width": VIEWPORTS[-1][0], "height": VIEWPORTS[-1][1]})
        ui_sign_in(page, SOL)
        opener = page.get_by_role("button", name=f"Open {manifest}")
        wait_ui(page, opener.is_visible)
        page.evaluate("() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); }")
        names = tab_order(page, TAB_PRESSES)
        assert names[0] == "Skip to objects", names
        assert in_order(names, ["Skip to objects", "New bucket", "Objects", "Share links", "Account", "Sign out",
                                "Search objects", "Prefix", "Tag filter", "Apply filters", "Upload files", "Lifecycle rules",
                                "Select all on this page", f"Select {manifest}",
                                f"Open {manifest}"]), names
        assert "Paper Kite Studio" not in names
        rest, focused = state_styles(page.get_by_role("button", name="Upload files"), "outline-style", "outline-width",
                                     "outline-color", "box-shadow", state="focus")
        assert rest != focused
        opener.focus()
        page.keyboard.press("Enter")
        heading = page.get_by_role("region", name="Object inspector").get_by_role("heading", name="season-1/manifest.json")
        wait_ui(page, lambda: is_focused(heading) and query_of(page).get("object") == ["season-1/manifest.json"])
        page.keyboard.press("Escape")
        wait_ui(page, lambda: "object" not in query_of(page) and is_focused(opener))
        rules = page.get_by_role("button", name="Lifecycle rules")
        rules.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Lifecycle rules")
        wait_ui(page, dialog.is_visible)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: not dialog.is_visible() and is_focused(rules))
        page.set_viewport_size({"width": VIEWPORTS[1][0], "height": VIEWPORTS[1][1]})
        page.reload()
        wait_ui(page, page.get_by_role("button", name="Workspaces and buckets").is_visible)
        assert tab_order(page, 3) == ["Skip to objects", "Workspaces and buckets", "Search objects"]
        menu = page.get_by_role("button", name="Workspaces and buckets")
        menu.focus()
        page.keyboard.press("Enter")
        nav = page.get_by_role("dialog", name="Navigation")
        wait_ui(page, nav.is_visible)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: not nav.is_visible() and is_focused(menu))


def test_wf_bucket_setup_create_in_console(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    name = fresh_bucket()
    with app_page(browser, base + "/signin") as page:
        fill(page.get_by_role("textbox", name="Email"), THEO)
        fill(page.get_by_label("Password", exact=True), WRONG_PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        wait_ui(page, lambda: page.get_by_role("alert").inner_text().strip() == "Email or password is incorrect.")
        ui_sign_in(page, THEO)
        first = page.get_by_role("heading", level=2, name="lanternfish-avatars", exact=True)
        wait_ui(page, first.is_visible, what="first bucket")
        click(page.get_by_role("button", name="New bucket"))
        dialog = page.get_by_role("dialog", name="New bucket")
        wait_ui(page, dialog.is_visible)
        fill(dialog.get_by_role("textbox", name="Bucket name"), name)
        select(dialog.get_by_role("combobox", name="Origin region"), "Cascade")
        replicas = dialog.get_by_role("group", name="Replica regions")
        check(replicas.get_by_role("checkbox", name="Meridian"))
        check(replicas.get_by_role("checkbox", name="Monsoon"))
        click(dialog.get_by_role("button", name="Create bucket"))
        heading = page.get_by_role("heading", level=2, name=name, exact=True)
        wait_ui(page, lambda: path_of(page) == f"/console/{LF}/{name}" and urlparse(page.url).query == "")
        wait_ui(page, lambda: heading.is_visible() and is_focused(heading), what="focus on heading")
        link = page.get_by_role("navigation", name="Buckets").get_by_role("link", name=re.compile("^" + re.escape(name)))
        assert link.get_attribute("aria-current") == "page"
        placement = "Cascade, Meridian, Monsoon"
        assert placement in link.inner_text()
        assert status_text(page, "Bucket status") == f"Created {name} in {placement}."
        wait_ui(page, lambda: status_text(page, "Results status") == "No objects match.")
        page.reload()
        wait_ui(page, heading.is_visible, what="same screen after reload")
        page.go_back()
        wait_ui(page, first.is_visible, what="back to the earlier bucket")
    info = bucket_info(sign_in(base, THEO), "lanternfish", name)
    assert info["placement"] == ["cascade", "meridian", "monsoon"] and info["object_count"] == 0


BAD_NAMES = ["ab", "a" * (BUCKET_MAX + 1), "Abc-bucket", "-abc", "abc-", "xn--abc", "a_b", "ab.c", "ab c"]


def test_wf_bucket_setup_name_rules(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    for name in BAD_NAMES:
        r = theo.post(f"/api/w/{LF}/buckets", {"name": name, "placement": ["cascade"]})
        assert_error(r, 422, "validation_failed", "name", BUCKET_RULE)
        assert_error(theo.get(f"/api/w/{LF}/buckets/{quote(name, safe='')}"), 404, "not_found")
    for placement in ([], ["cascade", "cascade"], ["atlantis"], ["cascade", "meridian", "monsoon", "pampas", "cascade"]):
        r = theo.post(f"/api/w/{LF}/buckets", {"name": fresh_bucket(), "placement": placement})
        assert_error(r, 422, "validation_failed", "placement", PLACEMENT_RULE)
    shortest = uuid.uuid4().hex[:BUCKET_MIN]
    longest = ("vf-" + uuid.uuid4().hex * 4)[:BUCKET_MAX]
    for name in (shortest, longest):
        r = theo.post(f"/api/w/{LF}/buckets", {"name": name, "placement": ["cascade", "meridian", "monsoon", "pampas"]})
        assert r.status_code == 201, r.text
        assert r.json()["name"] == name and r.json()["object_count"] == 0


def test_wf_bucket_setup_name_race(app_url: str) -> None:
    base = app_url.rstrip("/")
    name = fresh_bucket()
    callers = [(sign_in(base, THEO), "lanternfish"), (sign_in(base, SOL), "paperkite"), (sign_in(base, ADA), "tidepool")]
    results = together([lambda a=a, ws=ws: a.post(f"/api/w/{ws}/buckets", {"name": name, "placement": ["cascade"]})
                        for a, ws in callers])
    assert sorted(r.status_code for r in results) == [201, 409, 409]
    for r in results:
        if r.status_code == 409:
            assert_error(r, 409, "bucket_name_taken")
    owners = [ws for a, ws in callers if name in [b["name"] for b in a.get(f"/api/w/{ws}/buckets").json()["buckets"]]]
    assert len(owners) == 1
    a, ws = callers[0]
    assert_error(a.post(f"/api/w/{ws}/buckets", {"name": name, "placement": ["cascade"]}), 409, "bucket_name_taken")


def test_wf_bucket_setup_published_fields(app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    name = fresh_bucket()
    r = theo.post(f"/api/w/{LF}/buckets", {"name": name, "placement": ["cascade"], "workspace": PK,
                                           "object_count": 9})
    errors = assert_error(r, 422, "validation_failed")["errors"]
    assert errors["workspace"] == FIELD_RULE and errors["object_count"] == FIELD_RULE
    assert name not in [b["name"] for b in theo.get(f"/api/w/{LF}/buckets").json()["buckets"]]
    r = theo.post(f"/api/w/{LF}/buckets", {"name": "NO", "placement": ["cascade"], "stored_bytes": 1})
    assert set(assert_error(r, 422, "validation_failed")["errors"]) >= {"name", "stored_bytes"}
    assert_error(theo.post(f"/api/w/{LF}/buckets", {"placement": ["cascade"]}), 422, "validation_failed", "name",
                 REQUIRED_RULE)
    lifecycle = f"/api/w/{LF}/buckets/{make_bucket(theo, LF, ['cascade'])}/lifecycle"
    r = theo.put(lifecycle, {"noncurrent_days": 1, "keep_newest_noncurrent": 0, "abort_multipart_days": None, "bucket": "x"})
    assert_error(r, 422, "validation_failed", "bucket", FIELD_RULE)
    assert theo.get(lifecycle).json()["noncurrent_days"] is None
    session = Api(base)
    r = session.post("/api/session", {"email": THEO, "password": PASSWORD, "remember": True})
    assert_error(r, 422, "validation_failed", "remember", FIELD_RULE)
    assert not r.headers.get_list("set-cookie")
    generation = mara.get(f"/api/w/{LF}/encryption").json()["generation"]
    assert_error(mara.post(f"/api/w/{LF}/encryption/rotate", {"generation": generation + 5}), 422,
                 "validation_failed", "generation", FIELD_RULE)
    assert mara.get(f"/api/w/{LF}/encryption").json()["generation"] == generation
    key = make_key(mara, "lanternfish")
    assert_error(mara.post(f"/api/w/{LF}/keys/{key['key_id']}/rotate", {"secret": "x"}), 422,
                 "validation_failed", "secret", FIELD_RULE)
    row = next(k for k in mara.get(f"/api/w/{LF}/keys").json()["keys"] if k["key_id"] == key["key_id"])
    assert row["previous_secret_expires_at"] is None
    drop_key(mara, "lanternfish", key["key_id"])
    member = new_member(base, mail, "tidepool", ADA, "viewer")
    r = member.api.put("/api/me/password", {"current_password": member.password, "new_password": member.password + "-x",
                                            "role": "owner"})
    assert_error(r, 422, "validation_failed", "role", FIELD_RULE)
    sign_in(base, member.email, member.password)
    remove_member(base, "tidepool", ADA, member)


def test_wf_console_upload_drop_and_pick(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian", "monsoon"])
    files = [{"name": "replay-a.bin", "body": "replay a bytes"}, {"name": "replay-b.bin", "body": "replay b"}]
    dropped = ["drops/" + f["name"] for f in files]
    with app_page(browser, base + f"/console/lanternfish/{bucket}") as page:
        ui_sign_in(page, THEO)
        table = page.get_by_role("table", name="Objects")
        wait_ui(page, table.is_visible)
        table.evaluate(DRAG_SCRIPT, {"phase": "hover", "files": files})
        wait_ui(page, lambda: f"Drop to upload to {bucket}/" in body_text(page))
        table.evaluate(DRAG_SCRIPT, {"phase": "drop", "files": files})
        dialog = page.get_by_role("dialog", name="Upload")
        wait_ui(page, dialog.is_visible)
        listed = dialog.get_by_role("list", name="Files to upload").inner_text()
        assert all(source["name"] in listed for source in files)
        fill(dialog.get_by_role("textbox", name="Key prefix"), "drops/")
        fill(dialog.get_by_role("textbox", name="Tags"), "env=qa,team=net")
        click(dialog.get_by_role("button", name="Start upload"))
        wait_ui(page, lambda: len(theo.get(f"/api/w/{LF}/buckets/{bucket}/objects",
                                           params={"prefix": "drops/"}).json()["items"]) == 2, seconds=WAIT_S)
        wait_ui(page, lambda: any(fits(stored_copy(k, 2), status_text(page, "Upload status")) for k in dropped))
        page.keyboard.press("Escape")
        with page.expect_file_chooser(timeout=WAIT_S * 1000) as chooser:
            click(page.get_by_role("button", name="Upload files"))
        chooser.value.set_files([{"name": "picked.bin", "mimeType": "application/octet-stream", "buffer": b"picked bytes"}])
        wait_ui(page, dialog.is_visible)
        click(dialog.get_by_role("button", name="Start upload"))
        wait_ui(page, lambda: fits(stored_copy("picked.bin", 2), status_text(page, "Upload status")), seconds=WAIT_S)
    items = theo.get(f"/api/w/{LF}/buckets/{bucket}/objects", params={"prefix": "drops/"}).json()["items"]
    assert sorted(i["key"] for i in items) == sorted(dropped)
    for item, source in zip(sorted(items, key=lambda i: i["key"]), files):
        assert item["tags"] == {"env": "qa", "team": "net"} and item["size"] == len(source["body"])
        assert content(theo, "lanternfish", bucket, item["key"]).content == source["body"].encode()
        assert len(versions_of(theo, "lanternfish", bucket, item["key"])) == 1
    assert content(theo, "lanternfish", bucket, "picked.bin").content == b"picked bytes"
    assert bucket_info(theo, "lanternfish", bucket)["object_count"] == 3


SVG_OPEN = b'<svg width="4" height="4" xmlns="http://www.w3.org/2000/svg"'
SCRIPTED_SVGS = [SVG_OPEN + b'><script>alert(1)</script></svg>',
                 SVG_OPEN + b' onload="alert(1)"><rect/></svg>',
                 SVG_OPEN + b' xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)">'
                 b'<rect/></a></svg>']
BAD_KEYS = ["/lead", "a\\b", "a\x01b", "a\x7fb", "a/./b", "../x", "k" * (KEY_MAX_BYTES + 1), "🎮" * (KEY_MAX_BYTES // 4 + 1)]


def test_wf_console_upload_refusals(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    observer = S3()
    before = bucket_info(theo, "lanternfish", bucket)
    units_before = units(mara, "lanternfish", bucket)
    try:
        r = upload(theo, "lanternfish", bucket, "size.bin", b"four", size=5)
        assert_error(r, 422, "validation_failed", "size",
                     f"Declared size {len(b'four') + 1} bytes does not match {len(b'four')} bytes received.")
        assert_error(upload(theo, "lanternfish", bucket, "big.bin", b"\0" * (UPLOAD_LIMIT + 1)), 413, "payload_too_large")
        for bad in BAD_KEYS:
            assert_error(upload(theo, "lanternfish", bucket, bad, b"x"), 422, "validation_failed", "key", KEY_RULE)
        for index, svg in enumerate(SCRIPTED_SVGS):
            r = upload(theo, "lanternfish", bucket, f"art-{index}.svg", svg, headers={"Content-Type": "image/svg+xml"})
            assert_error(r, 422, "validation_failed", "content", SVG_RULE)
            assert_s3_error(s3(base, cred_of(key), "PUT", bucket, f"s3-art-{index}.svg", body=svg), 400, "InvalidArgument")
        assert_s3_error(s3(base, cred_of(key), "PUT", bucket, "a\\b", body=b"x"), 400, "InvalidArgument")
        for k in ["size.bin", "big.bin"] + [f"art-{i}.svg" for i in range(len(SCRIPTED_SVGS))]:
            assert_error(theo.get(f"/api/w/{LF}/buckets/{bucket}/object", params={"key": k}), 404, "not_found")
        assert bucket_info(theo, "lanternfish", bucket) == before
        assert units(mara, "lanternfish", bucket) == units_before
        assert bucket_blobs(observer, bucket) == []
        assert stored(theo, "lanternfish", bucket, "k" * KEY_MAX_BYTES, b"x")["key"] == "k" * KEY_MAX_BYTES
        assert stored(theo, "lanternfish", bucket, "🎮" * (KEY_MAX_BYTES // 4), b"x")["size"] == 1
        svg = stored(theo, "lanternfish", bucket, "plain.svg", SVG_OPEN + b'><rect/></svg>',
                     headers={"Content-Type": "text/plain"})
        assert svg["content_type"] == "image/svg+xml"
        html = stored(theo, "lanternfish", bucket, "notes.txt", b"\xef\xbb\xbf  <!DOCTYPE html><p>x</p>",
                      headers={"Content-Type": "text/plain"})
        assert html["content_type"] == "text/html"
        assert stored(theo, "lanternfish", bucket, "limit.bin", b"\0" * UPLOAD_LIMIT)["size"] == UPLOAD_LIMIT
    finally:
        drop_key(mara, "lanternfish", key["key_id"])


DOWNLOAD_HEADERS = {"x-content-type-options": "nosniff", "content-security-policy": "sandbox",
                    "cache-control": "private, no-store"}


def test_wf_console_upload_downloads(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    data = os.urandom(DEFAULT_PAGE)
    page_bytes = b"<!doctype html><script>document.title='x'</script>"
    try:
        stored(theo, "lanternfish", bucket, DISPOSITION_KEY, data)
        stored(theo, "lanternfish", bucket, "site/page.html", page_bytes, headers={"Content-Type": "text/html"})
        link = mint_link(theo, "lanternfish", bucket, DISPOSITION_KEY)
        responses = [content(theo, "lanternfish", bucket, DISPOSITION_KEY), httpx.get(link["url"], timeout=HTTP_TIMEOUT),
                     s3(base, cred_of(key), "GET", bucket, DISPOSITION_KEY)]
        for r in responses:
            assert r.status_code == 200 and r.content == data
            assert r.headers["content-disposition"] == DISPOSITION_EXAMPLE
            for name, value in DOWNLOAD_HEADERS.items():
                assert r.headers[name] == value, name
        assert not [h for h in responses[0].headers if h.startswith("x-amz-checksum")]
        risky = [content(theo, "lanternfish", bucket, "site/page.html"),
                 httpx.get(mint_link(theo, "lanternfish", bucket, "site/page.html")["url"], timeout=HTTP_TIMEOUT)]
        for r in risky:
            assert r.headers["content-type"].startswith("application/octet-stream") and r.content == page_bytes
            leaf = "page.html"
            assert r.headers["content-disposition"] == f'attachment; filename="{leaf}"; filename*=UTF-8\'\'{leaf}'
        got = s3(base, cred_of(key), "GET", bucket, "site/page.html")
        assert got.headers["content-type"].startswith("text/html") and got.content == page_bytes
        assert got.headers["content-disposition"].startswith("attachment;")
        assert got.headers["content-security-policy"] == "sandbox"
    finally:
        drop_key(mara, "lanternfish", key["key_id"])


def test_wf_console_upload_idempotent_retry(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    sink = Sink()
    endpoint = mara.post(f"/api/w/{LF}/webhooks", {"url": sink.url, "events": ["object.created"], "buckets": [bucket],
                                                         "description": ""})
    assert endpoint.status_code == 201, endpoint.text
    try:
        idem = {"Idempotency-Key": "upload-" + uuid.uuid4().hex}
        first = upload(theo, "lanternfish", bucket, "retry.bin", b"retry body", headers=idem)
        assert first.status_code == 201
        units_after_first = units(mara, "lanternfish", bucket)
        replay = upload(theo, "lanternfish", bucket, "retry.bin", b"retry body", headers=idem)
        assert replay.status_code == 201 and replay.json() == first.json()
        assert replay.headers.get("Idempotent-Replayed") == "true"
        assert_error(upload(theo, "lanternfish", bucket, "retry.bin", b"other body", headers=idem), 409, "idempotency_key_reused")
        assert_error(upload(theo, "lanternfish", bucket, "other.bin", b"retry body", headers=idem), 409, "idempotency_key_reused")
        assert_error(upload(theo, "lanternfish", bucket, "x.bin", b"x", headers={"Idempotency-Key": "k" * (SEARCH_Q_MAX + 1)}),
                     422, "validation_failed", "idempotency_key")
        assert len(versions_of(theo, "lanternfish", bucket, "retry.bin")) == 1
        info = bucket_info(theo, "lanternfish", bucket)
        assert info["object_count"] == 1 and info["stored_bytes"] == len(b"retry body")
        assert units(mara, "lanternfish", bucket) == units_after_first
        poll(lambda: sink.of(1), FIRST_ATTEMPT_S + GRACE_S, "first event")
        quiet_until = time.monotonic() + FIRST_ATTEMPT_S + GRACE_S
        poll(lambda: time.monotonic() > quiet_until, LONG_WAIT_S, "no second event")
        assert len(sink.records) == 1 and sink.of(2) == []
    finally:
        drop_endpoint(mara, "lanternfish", endpoint.json()["id"])
        sink.close()


def tagging(pairs: list[tuple[str, str]]) -> str:
    return urlencode(pairs)


def test_metadata_and_tag_limits(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    cred = cred_of(key)
    name = "note"
    try:
        exact = {f"x-amz-meta-{name}": "v" * (META_LIMIT - len(name))}
        over = {f"x-amz-meta-{name}": "v" * (META_LIMIT - len(name) + 1)}
        stored(theo, "lanternfish", bucket, "meta.bin", b"m", headers=exact)
        meta = theo.get(f"/api/w/{LF}/buckets/{bucket}/object", params={"key": "meta.bin"}).json()["metadata"]
        assert meta == {name: "v" * (META_LIMIT - len(name))}
        assert_error(upload(theo, "lanternfish", bucket, "meta2.bin", b"m", headers=over), 422, "validation_failed",
                     "metadata", META_RULE)
        assert s3(base, cred, "PUT", bucket, "s3-meta.bin", body=b"m", headers=exact).status_code == 200
        assert_s3_error(s3(base, cred, "PUT", bucket, "s3-meta2.bin", body=b"m", headers=over), 400, "MetadataTooLarge")
        good = [[(f"k{i}", "v") for i in range(TAG_COUNT)], [("k" * TAG_KEY_MAX, "v" * TAG_VALUE_MAX)],
                [("🎮" * TAG_KEY_MAX, "👩‍💻" * TAG_VALUE_MAX)], [("empty", "")]]
        bad = [[(f"k{i}", "v") for i in range(TAG_COUNT + 1)], [("k" * (TAG_KEY_MAX + 1), "v")],
               [("k", "v" * (TAG_VALUE_MAX + 1))], [("", "v")], [("dup", "1"), ("dup", "2")]]
        for index, pairs in enumerate(good):
            item = stored(theo, "lanternfish", bucket, f"tags-{index}.bin", b"t", headers={"x-amz-tagging": tagging(pairs)})
            got = theo.get(f"/api/w/{LF}/buckets/{bucket}/object", params={"key": item["key"]}).json()["tags"]
            assert got == dict(pairs)
            assert s3(base, cred, "PUT", bucket, f"s3-tags-{index}.bin", body=b"t",
                      headers={"x-amz-tagging": tagging(pairs)}).status_code == 200
        for index, pairs in enumerate(bad):
            r = upload(theo, "lanternfish", bucket, f"bad-{index}.bin", b"t", headers={"x-amz-tagging": tagging(pairs)})
            assert_error(r, 422, "validation_failed", "tags", TAGS_RULE)
            r = s3(base, cred, "PUT", bucket, f"s3-bad-{index}.bin", body=b"t", headers={"x-amz-tagging": tagging(pairs)})
            assert_s3_error(r, 400, "InvalidTag")
            assert_s3_error(s3(base, cred, "GET", bucket, f"s3-bad-{index}.bin"), 404, "NoSuchKey")
    finally:
        drop_key(mara, "lanternfish", key["key_id"])


def test_wf_manifest_overwrite_concurrent_writers(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian", "monsoon"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    v1 = stored(theo, "lanternfish", bucket, "season-1/manifest.json", b'{"season":1}')
    writers = [sign_in(base, THEO) for _ in range(5)]
    bodies = [f'{{"season":1,"writer":{i}}}'.encode() for i in range(5)]
    results = together([lambda a=a, b=b: upload(a, "lanternfish", bucket, "season-1/manifest.json", b,
                                                headers={"If-Match": v1["etag"]}) for a, b in zip(writers, bodies)])
    assert sorted(r.status_code for r in results) == [201, 412, 412, 412, 412]
    winner = next(r for r in results if r.status_code == 201).json()
    for r in results:
        if r.status_code == 412:
            assert assert_error(r, 412, "precondition_failed")["current_etag"] == winner["etag"]
    assert len(versions_of(theo, "lanternfish", bucket, "season-1/manifest.json")) == 2
    info = bucket_info(theo, "lanternfish", bucket)
    assert info["object_count"] == 1 and info["stored_bytes"] == (v1["size"] + winner["size"]) * 3
    assert_error(upload(theo, "lanternfish", bucket, "missing.json", b"x", headers={"If-Match": v1["etag"]}), 404, "not_found")
    assert_error(upload(theo, "lanternfish", bucket, "season-1/manifest.json", b"x", headers={"If-None-Match": "*"}),
                 412, "precondition_failed")
    r = s3(base, cred_of(key), "PUT", bucket, "season-1/manifest.json", body=b"stale", headers={"If-Match": v1["etag"]})
    assert_s3_error(r, 412, "PreconditionFailed")
    assert_s3_error(s3(base, cred_of(key), "PUT", bucket, "nothing.json", body=b"x", headers={"If-Match": v1["etag"]}),
                    404, "NoSuchKey")
    assert bucket_info(theo, "lanternfish", bucket) == info
    assert theo.delete(f"/api/w/{LF}/buckets/{bucket}/object", params={"key": "season-1/manifest.json"}).status_code == 204
    after_delete = bucket_info(theo, "lanternfish", bucket)
    assert after_delete["object_count"] == 0 and after_delete["stored_bytes"] == info["stored_bytes"]
    assert_error(upload(theo, "lanternfish", bucket, "season-1/manifest.json", b"x", headers={"If-Match": winner["etag"]}),
                 404, "not_found")
    r = theo.delete(f"/api/w/{LF}/buckets/{bucket}/object/version",
                    params={"key": "season-1/manifest.json", "version": v1["version_id"]})
    assert r.status_code == 204
    assert bucket_info(theo, "lanternfish", bucket)["stored_bytes"] == winner["size"] * 3
    drop_key(mara, "lanternfish", key["key_id"])


def test_wf_manifest_overwrite_release_readiness(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian", "pampas"])
    first = stored(theo, "lanternfish", bucket, "season-1/manifest.json", b'{"season":1,"build":"1.4.2"}')
    wait_settled(theo, "lanternfish", bucket, "season-1/manifest.json")
    new_bytes = b'{"season":1,"build":"1.4.3"}'
    url = base + f"/console/{LF}/{bucket}?object=" + quote("season-1/manifest.json", safe="")
    with app_page(browser, url) as page:
        ui_sign_in(page, THEO)
        inspector = page.get_by_role("region", name="Object inspector")
        wait_ui(page, lambda: status_text(page, "Release readiness") == ready_copy(3, first["version_id"][:8]))
        with regions_offline(base, "pampas"):
            page.on("filechooser", lambda fc: fc.set_files([{"name": "manifest.json", "mimeType": "application/json",
                                                              "buffer": new_bytes}]))
            click(inspector.get_by_role("button", name="Upload new version"))
            dialog = page.get_by_role("dialog", name="Upload")
            wait_ui(page, dialog.is_visible)
            check(dialog.get_by_role("checkbox", name="Only overwrite the version I opened"))
            click(dialog.get_by_role("button", name="Start upload"))
            wait_ui(page, lambda: fits(stored_copy("season-1/manifest.json", 2), status_text(page, "Upload status")),
                    seconds=WAIT_S)
            stale = upload(sign_in(base, THEO), "lanternfish", bucket, "season-1/manifest.json", b"teammate",
                           headers={"If-Match": first["etag"]})
            assert_error(stale, 412, "precondition_failed")
            wait_ui(page, lambda: status_text(page, "Release readiness") == f"Not ready: {count(1)} failed. Retry before shipping.",
                    seconds=SETTLE_S + UI_WAIT_S)
            assert inspector.get_by_role("button", name=f"Retry {PAMPAS}").is_visible()
        current = next(v for v in versions_of(theo, "lanternfish", bucket, "season-1/manifest.json") if v["current"])
        assert current["etag"] == md5_etag(new_bytes)
        wait_ui(page, lambda: status_text(page, "Release readiness") == ready_copy(3, current["version_id"][:8]),
                seconds=SETTLE_S + UI_WAIT_S)
    info = bucket_info(theo, "lanternfish", bucket)
    assert info["object_count"] == 1 and info["stored_bytes"] == (first["size"] + len(new_bytes)) * 3


def test_wf_s3_pipeline_signed_access(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    scoped, other = make_bucket(theo, "lanternfish", ["cascade"]), make_bucket(theo, "lanternfish", ["cascade"])
    stored(theo, "lanternfish", scoped, "obj.bin", b"scoped bytes")
    stored(theo, "lanternfish", other, "obj.bin", b"other bytes")
    read = make_key(mara, "lanternfish", "read", [scoped])
    write = make_key(mara, "lanternfish", "read-write", [scoped])
    got = s3(base, cred_of(read), "GET", scoped, "obj.bin")
    assert got.status_code == 200 and got.content == b"scoped bytes"
    row = next(k for k in mara.get(f"/api/w/{LF}/keys").json()["keys"] if k["key_id"] == read["key_id"])
    assert row["last_used_at"] is not None
    assert_s3_error(s3(base, cred_of(read), "PUT", scoped, "new.bin", body=b"x"), 403, "AccessDenied")
    assert s3(base, cred_of(write), "PUT", scoped, "new.bin", body=b"x").status_code == 200
    assert_s3_error(s3(base, cred_of(write), "GET", other, "obj.bin"), 403, "AccessDenied")
    assert_s3_error(s3(base, (write["key_id"], "x" * 40), "GET", scoped, "obj.bin"), 403, "SignatureDoesNotMatch")
    skewed = datetime.now(timezone.utc) - timedelta(minutes=SKEW_PROBE_MIN)
    assert_s3_error(s3(base, cred_of(write), "GET", scoped, "obj.bin", when=skewed), 403, "RequestTimeTooSkewed")
    assert_s3_error(s3(base, ("FSK" + "Z" * 17, "x" * 40), "GET", scoped, "obj.bin", when=skewed), 403, "InvalidAccessKeyId")
    assert_s3_error(s3(base, cred_of(write), "GET", "paperkite-replays", "season-1/manifest.json"), 403, "AccessDenied")
    assert mara.post(f"/api/w/{LF}/keys/{write['key_id']}/disable").status_code == 200
    assert_s3_error(s3(base, cred_of(write), "GET", scoped, "obj.bin"), 403, "InvalidAccessKeyId")
    assert mara.delete(f"/api/w/{LF}/keys/{write['key_id']}").status_code == 204
    assert_s3_error(s3(base, cred_of(write), "GET", scoped, "obj.bin"), 403, "InvalidAccessKeyId")
    drop_key(mara, "lanternfish", read["key_id"])


def test_wf_s3_pipeline_multipart(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    cred = cred_of(key)
    p1, p2 = os.urandom(PART_MIN), os.urandom(DEFAULT_PAGE)
    try:
        upload_id = multipart_start(base, cred, bucket, "builds/big.bin")
        e1 = part(base, cred, bucket, "builds/big.bin", upload_id, 1, p1).headers["etag"]
        e2 = part(base, cred, bucket, "builds/big.bin", upload_id, 2, p2).headers["etag"]
        xml = complete_xml([(1, e1), (2, e2)])
        units_before = units(mara, "lanternfish", bucket)
        first = complete(base, cred, bucket, "builds/big.bin", upload_id, xml, {"If-None-Match": "*"})
        assert first.status_code == 200, first.text
        expected = '"' + hashlib.md5(hashlib.md5(p1).digest() + hashlib.md5(p2).digest()).hexdigest() + '-2"'
        assert parse_xml(first.content).findtext("ETag") == expected
        again = complete(base, cred, bucket, "builds/big.bin", upload_id, xml, {"If-None-Match": "*"})
        assert again.status_code == 200 and parse_xml(again.content).findtext("ETag") == expected
        assert again.headers["x-amz-version-id"] == first.headers["x-amz-version-id"]
        assert_s3_error(complete(base, cred, bucket, "builds/big.bin", upload_id, complete_xml([(1, e1)])), 400, "InvalidPart")
        assert len(versions_of(theo, "lanternfish", bucket, "builds/big.bin")) == 1
        assert units(mara, "lanternfish", bucket) == units_before + 1
        assert s3(base, cred, "GET", bucket, "builds/big.bin").content == p1 + p2
        cond = multipart_start(base, cred, bucket, "builds/cond.bin")
        c1 = part(base, cred, bucket, "builds/cond.bin", cond, 1, b"cond").headers["etag"]
        assert s3(base, cred, "PUT", bucket, "builds/cond.bin", body=b"landed first").status_code == 200
        assert_s3_error(complete(base, cred, bucket, "builds/cond.bin", cond, complete_xml([(1, c1)]), {"If-None-Match": "*"}),
                        412, "PreconditionFailed")
        assert complete(base, cred, bucket, "builds/cond.bin", cond, complete_xml([(1, c1)])).status_code == 200
        assert s3(base, cred, "GET", bucket, "builds/cond.bin").content == b"cond"
        limits = multipart_start(base, cred, bucket, "builds/limits.bin")
        for number in (0, PART_NUMBER_MAX + 1):
            assert_s3_error(part(base, cred, bucket, "builds/limits.bin", limits, number, b"x"), 400, "InvalidArgument")
        assert_s3_error(part(base, cred, bucket, "builds/limits.bin", limits, 1, b"\0" * (PART_MAX + 1)), 413, "EntityTooLarge")
        s1 = part(base, cred, bucket, "builds/limits.bin", limits, 1, b"small one").headers["etag"]
        s2 = part(base, cred, bucket, "builds/limits.bin", limits, 2, b"small two").headers["etag"]
        assert_s3_error(complete(base, cred, bucket, "builds/limits.bin", limits, complete_xml([(1, s1), (2, s2)])), 400,
                        "EntityTooSmall")
        assert_s3_error(complete(base, cred, bucket, "builds/limits.bin", limits, complete_xml([(2, s2), (1, s1)])), 400,
                        "InvalidPartOrder")
        assert_s3_error(complete(base, cred, bucket, "builds/limits.bin", limits, complete_xml([(1, s2)])), 400, "InvalidPart")
        assert s3(base, cred, "DELETE", bucket, "builds/limits.bin", query={"uploadId": limits}).status_code == 204
        assert_s3_error(part(base, cred, bucket, "builds/limits.bin", limits, 1, b"x"), 404, "NoSuchUpload")
    finally:
        drop_key(mara, "lanternfish", key["key_id"])


def test_wf_s3_pipeline_paging(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    in_pool([lambda k=k: stored(theo, "lanternfish", bucket, k, k.encode()) for k in PAGING_KEYS])
    key = make_key(mara, "lanternfish", "read-write", [bucket])
    cred = cred_of(key)
    try:
        seen: list[str] = []
        token = None
        pages = 0
        while True:
            params = {"delimiter": "/", "max_keys": "3", "encoding_type": "url"}
            if token:
                params["continuation_token"] = token
            r = list_v2(base, cred, bucket, **params)
            assert r.status_code == 200, r.text
            root = parse_xml(r.content)
            assert root.findtext("EncodingType") == "url"
            names = [e.findtext("Key") for e in root.findall("Contents")] + \
                    [e.findtext("Prefix") for e in root.findall("CommonPrefixes")]
            assert int(root.findtext("KeyCount")) == len(names) <= 3
            seen += names
            pages += 1
            if pages == 1:
                stored(theo, "lanternfish", bucket, "p-new.txt", b"after cursor")
                stored(theo, "lanternfish", bucket, "a-new.txt", b"before cursor")
                theo.delete(f"/api/w/{LF}/buckets/{bucket}/object", params={"key": "zz/ü.bin"})
            if root.findtext("IsTruncated") != "true":
                break
            token = root.findtext("NextContinuationToken")
        expected = ["a b.txt", "a+b.txt", "dir/", "dir2/", "p-new.txt", "plain.txt", "r 1+2%.bin", "ゲーム/"]
        assert sorted(seen) == sorted(url_name(n) for n in expected) and len(seen) == len(set(seen))
        assert url_name("r 1+2%.bin") == "r+1%2B2%25.bin" and "r+1%2B2%25.bin" in seen
        plain = parse_xml(list_v2(base, cred, bucket, prefix="r").content)
        assert [e.findtext("Key") for e in plain.findall("Contents")] == ["r 1+2%.bin"]
        console_seen: list[str] = []
        cursor = None
        while True:
            params = {"delimiter": "/", "limit": "3"}
            if cursor:
                params["cursor"] = cursor
            body = theo.get(f"/api/w/{LF}/buckets/{bucket}/objects", params=params).json()
            assert len(body["items"]) + len(body["common_prefixes"]) <= 3
            console_seen += [i["key"] for i in body["items"]] + body["common_prefixes"]
            cursor = body["next_cursor"]
            if not cursor:
                break
        assert sorted(console_seen) == sorted(expected + ["a-new.txt"]) and len(console_seen) == len(set(console_seen))
        assert_s3_error(list_v2(base, cred, bucket, max_keys="-1"), 400, "InvalidArgument")
        assert_s3_error(list_v2(base, cred, bucket, continuation_token="tampered"), 400, "InvalidArgument")
        assert_s3_error(list_v2(base, cred, bucket, encoding_type="xml"), 400, "InvalidArgument")
        r = theo.get(f"/api/w/{LF}/buckets/{bucket}/objects", params={"cursor": "tampered"})
        assert_error(r, 422, "validation_failed", "cursor", CURSOR_RULE)
        for limit in ("0", str(PAGE_CAP + 1)):
            assert_error(theo.get(f"/api/w/{LF}/buckets/{bucket}/objects", params={"limit": limit}), 422,
                         "validation_failed", "limit")
        big = make_bucket(theo, "lanternfish", ["cascade"])
        in_pool([lambda i=i: stored(theo, "lanternfish", big, f"k{i:05d}", b"x") for i in range(CAP_KEYS)])
        wide = make_key(mara, "lanternfish", "read", [big])
        root = parse_xml(list_v2(base, cred_of(wide), big, max_keys=str(PAGE_CAP * 5)).content)
        assert root.findtext("MaxKeys") == str(PAGE_CAP) and root.findtext("KeyCount") == str(PAGE_CAP)
        assert root.findtext("IsTruncated") == "true"
        body = theo.get(f"/api/w/{LF}/buckets/{big}/objects", params={"limit": str(PAGE_CAP)}).json()
        assert len(body["items"]) == PAGE_CAP and body["next_cursor"]
        drop_key(mara, "lanternfish", wide["key_id"])
    finally:
        drop_key(mara, "lanternfish", key["key_id"])


def test_wf_s3_pipeline_chunked_checksums(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    key = make_key(mara, "lanternfish", "read-write", [bucket])
    cred = cred_of(key)
    data = os.urandom(DEFAULT_PAGE * 300)
    signed = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD"
    try:
        r = s3(base, cred, "PUT", bucket, "c/signed.bin", payload=signed, builder=signed_chunks(data, PART_MIN // 64),
               headers=chunk_headers(data, {"x-amz-checksum-crc32": crc32_b64(data)}))
        assert r.status_code == 200, r.text
        assert r.headers["x-amz-checksum-crc32"] == crc32_b64(data) and r.headers["etag"] == md5_etag(data)
        got = s3(base, cred, "GET", bucket, "c/signed.bin", headers={"x-amz-checksum-mode": "ENABLED"})
        assert got.content == data and got.headers["x-amz-checksum-crc32"] == crc32_b64(data)
        assert "x-amz-checksum-crc32" not in s3(base, cred, "GET", bucket, "c/signed.bin").headers
        r = s3(base, cred, "PUT", bucket, "c/trailer.bin", payload="STREAMING-UNSIGNED-PAYLOAD-TRAILER",
               body=trailer_body(data, PART_MIN // 64, "x-amz-checksum-crc32c", crc32c_b64(data)),
               headers=chunk_headers(data, {"x-amz-trailer": "x-amz-checksum-crc32c"}))
        assert r.status_code == 200, r.text
        assert s3(base, cred, "GET", bucket, "c/trailer.bin").content == data
        for name, digest in (("sha1", hashlib.sha1(data).digest()), ("sha256", hashlib.sha256(data).digest())):
            assert s3(base, cred, "PUT", bucket, f"c/{name}.bin", body=data,
                      headers={f"x-amz-checksum-{name}": b64(digest)}).status_code == 200
        refusals = [
            ("SignatureDoesNotMatch", 403, dict(payload=signed, builder=signed_chunks(data, PART_MIN // 64, tamper=True),
                                                headers=chunk_headers(data))),
            ("IncompleteBody", 400, dict(payload=signed, builder=signed_chunks(data[:-1], PART_MIN // 64), headers=chunk_headers(data))),
            ("BadDigest", 400, dict(body=data, headers={"x-amz-checksum-crc32": crc32_b64(b"other")})),
            ("BadDigest", 400, dict(body=data, headers={"content-md5": b64(hashlib.md5(b"other").digest())})),
            ("InvalidArgument", 400, dict(body=data, headers={"x-amz-checksum-crc32": crc32_b64(data),
                                                              "x-amz-checksum-sha1": b64(hashlib.sha1(data).digest())})),
            ("InvalidArgument", 400, dict(body=data, headers={"x-amz-checksum-crc32": "not-base64"})),
            ("InvalidArgument", 400, dict(payload=signed, builder=signed_chunks(data, PART_MIN // 64),
                                          headers={"content-encoding": "aws-chunked"})),
            ("InvalidArgument", 400, dict(payload="STREAMING-UNSIGNED-PAYLOAD-TRAILER",
                                          body=trailer_body(data, PART_MIN // 64, "x-amz-checksum-sha1", crc32_b64(data)),
                                          headers=chunk_headers(data, {"x-amz-trailer": "x-amz-checksum-crc32"}))),
            ("NotImplemented", 501, dict(payload="STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER", body=b"0\r\n\r\n",
                                         headers=chunk_headers(data))),
        ]
        for index, (code, status, options) in enumerate(refusals):
            assert_s3_error(s3(base, cred, "PUT", bucket, f"c/bad-{index}.bin", **options), status, code)
            assert_s3_error(s3(base, cred, "GET", bucket, f"c/bad-{index}.bin"), 404, "NoSuchKey")
        upload_id = multipart_start(base, cred, bucket, "c/mp.bin", {"x-amz-checksum-algorithm": "CRC32"})
        r = s3(base, cred, "PUT", bucket, "c/mp.bin", query={"partNumber": "1", "uploadId": upload_id}, payload=signed,
               builder=signed_chunks(data, PART_MIN // 64), headers=chunk_headers(data, {"x-amz-checksum-crc32": crc32_b64(data)}))
        assert r.status_code == 200 and r.headers["x-amz-checksum-crc32"] == crc32_b64(data)
        assert_s3_error(part(base, cred, bucket, "c/mp.bin", upload_id, 2, data,
                             {"x-amz-checksum-sha256": b64(hashlib.sha256(data).digest())}), 400, "InvalidArgument")
        wrong = complete_xml([(1, r.headers["etag"])], {1: f"<ChecksumCRC32>{crc32_b64(b'x')}</ChecksumCRC32>"})
        assert_s3_error(complete(base, cred, bucket, "c/mp.bin", upload_id, wrong), 400, "InvalidPart")
        right = complete_xml([(1, r.headers["etag"])], {1: f"<ChecksumCRC32>{crc32_b64(data)}</ChecksumCRC32>"})
        assert complete(base, cred, bucket, "c/mp.bin", upload_id, right).status_code == 200
        got = s3(base, cred, "GET", bucket, "c/mp.bin", headers={"x-amz-checksum-mode": "ENABLED"})
        assert got.content == data and "x-amz-checksum-crc32" not in got.headers
    finally:
        drop_key(mara, "lanternfish", key["key_id"])


def test_wf_browse_and_filter_viewer_deep_link(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    in_pool([lambda i=i: stored(theo, "lanternfish", bucket, f"season-1/r-{i:03d}.bin", f"replay {i}".encode(),
                                headers={"x-amz-tagging": "env=qa"}) for i in range(MANY_KEYS)])
    prod_key = "season-1/prod.bin"
    stored(theo, "lanternfish", bucket, prod_key, b"prod", headers={"x-amz-tagging": "env=prod"})
    target = f"season-1/r-{MANY_KEYS - 1:03d}.bin"
    with app_page(browser, base + f"/console/lanternfish/{bucket}") as page:
        ui_sign_in(page, PRIYA)
        wait_ui(page, page.get_by_role("textbox", name="Prefix").is_visible)
        fill(page.get_by_role("textbox", name="Prefix"), "season-1/")
        fill(page.get_by_role("textbox", name="Tag filter"), "env=qa")
        click(page.get_by_role("button", name="Apply filters"))
        wait_ui(page, lambda: fits("<n> objects on this page", status_text(page, "Results status"))
                and query_of(page).get("tag_filter") == ["env=qa"])
        assert query_of(page)["prefix"] == ["season-1/"]
        assert page.get_by_role("button", name=f"Open {prod_key}").count() == 0
        opener = page.get_by_role("button", name=f"Open {target}")
        pages = 1
        while opener.count() == 0:
            assert page.get_by_role("button", name="Next page").is_enabled()
            before = page.url
            click(page.get_by_role("button", name="Next page"))
            wait_ui(page, lambda: page.url != before and fits("<n> objects on this page",
                                                              status_text(page, "Results status")))
            pages += 1
        click(opener)
        inspector = page.get_by_role("region", name="Object inspector")
        wait_ui(page, inspector.is_visible)
        query = query_of(page)
        assert query["object"] == [target]
        if pages > 1:
            assert query["prev"][0] == "" and len(query["prev"]) == pages - 1 and query["cursor"]
        rows = page.get_by_role("table", name="Objects").get_by_role("button").all_inner_texts()
        for name in ("Upload files", "Delete selected", "Lifecycle rules", "New bucket", "Upload new version", "Delete object"):
            assert page.get_by_role("button", name=name).count() == 0, name
        assert page.get_by_role("checkbox", name="Select all on this page").count() == 0
        assert page.get_by_role("button", name=re.compile("^Retention for ")).count() == 0
        assert downloaded(page, inspector.get_by_role("button", name="Download")) == f"replay {MANY_KEYS - 1}".encode()
        copied = page.url
        page.go_back()
        wait_ui(page, lambda: page.url != copied and "object" not in query_of(page))
    assert_error(upload(sign_in(base, PRIYA), "lanternfish", bucket, target, b"x"), 403, "forbidden")
    with app_page(browser, copied) as agent:
        wait_ui(agent, lambda: path_of(agent) == "/signin")
        ui_sign_in(agent, MARA)
        wait_ui(agent, lambda: query_of(agent) == query and path_of(agent) == f"/console/{LF}/{bucket}")
        wait_ui(agent, agent.get_by_role("region", name="Object inspector").get_by_role("heading", name=target).is_visible)
        table = agent.get_by_role("table", name="Objects")
        wait_ui(agent, lambda: table.get_by_role("button").all_inner_texts() == rows)


FILTER_ERRORS = {
    "env=qa and and team=art": "Tag filter could not be read near character 12.",
    "env=qa and": "Tag filter could not be read near character 11.",
    "(env=qa": "Tag filter could not be read near character 8.",
    "x" * (TAG_FILTER_MAX + 1): "Tag filters are limited to 256 characters.",
    " or ".join(f"k{i}=v" for i in range(TAG_COUNT + 1)): "Tag filters are limited to 10 comparisons.",
    "((((a=1))))": "Tag filters are limited to 3 levels of parentheses.",
}


def test_wf_browse_and_filter_bounds(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    for key, tags in {"a": "env=qa&team=art", "b": "env=qa", "c": "build=1.4.2", "d": "team=net"}.items():
        stored(theo, "lanternfish", bucket, key, b"x", headers={"x-amz-tagging": tags})
    path = f"/api/w/{LF}/buckets/{bucket}/objects"
    for expression, message in FILTER_ERRORS.items():
        assert_error(theo.get(path, params={"tag_filter": expression}), 422, "validation_failed", "tag_filter", message)
    assert_error(theo.get(path, params={"tag_filter": "env=qa AND team=art"}), 422, "validation_failed", "tag_filter")
    assert_error(theo.get(path, params={"prefix": "p" * (PREFIX_MAX + 1)}), 422, "validation_failed", "prefix")
    assert_error(theo.get(path, params={"delimiter": "/" * 2}), 422, "validation_failed", "delimiter")
    assert_error(theo.get(f"/api/w/{LF}/search", params={"q": "q" * (SEARCH_Q_MAX + 1)}), 422, "validation_failed", "q")
    cases = {"env=qa and not team=art": ["b"], "not team=art": ["b", "c", "d"], "team!=art": ["d"], "build=1.4*": ["c"],
             "env=* or team=net": ["a", "b", "d"], "env=qa or team=net and not team=net": ["a", "b"],
             " and ".join(["(((env=qa)))"] * 3) + " and " + " and ".join(f"k{i}!=v" for i in range(7)): [],
             "x" * (TAG_FILTER_MAX - 2) + "=*": []}
    for expression, keys in cases.items():
        started = time.monotonic()
        r = theo.get(path, params={"tag_filter": expression})
        assert time.monotonic() - started < TIME_BUDGET_S
        assert r.status_code == 200, (expression, r.text)
        assert sorted(i["key"] for i in r.json()["items"]) == keys, expression


def test_wf_browse_and_filter_search_isolation(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, sol = sign_in(base, THEO), sign_in(base, SOL)
    tok = uuid.uuid4().hex[:10]
    mine = theo.post(f"/api/w/{LF}/buckets", {"name": f"vf{tok}-replays", "placement": ["cascade"]})
    theirs = sol.post(f"/api/w/{PK}/buckets", {"name": f"vf{tok}-replay", "placement": ["cascade"]})
    assert mine.status_code == theirs.status_code == 201
    in_pool([lambda i=i: stored(theo, "lanternfish", f"vf{tok}-replays", f"{tok}/r-{i:02d}.bin", b"x")
             for i in range(SEARCH_MAX + 2)])
    stored(sol, "paperkite", f"vf{tok}-replay", f"{tok}/r-00.bin", b"x")
    for q, caller, ws, bucket in ((tok, theo, "lanternfish", f"vf{tok}-replays"),
                                  (tok.upper(), theo, "lanternfish", f"vf{tok}-replays"),
                                  (tok, sol, "paperkite", f"vf{tok}-replay")):
        items = caller.get(f"/api/w/{ws}/search", params={"q": q}).json()["items"]
        assert items and {i["bucket"] for i in items} == {bucket}
        assert [(i["bucket"], i["key"]) for i in items] == sorted((i["bucket"], i["key"]) for i in items)
    assert len(theo.get(f"/api/w/{LF}/search", params={"q": tok}).json()["items"]) == SEARCH_MAX
    assert len(sol.get(f"/api/w/{PK}/search", params={"q": tok}).json()["items"]) == 1


def test_wf_share_links_mint_and_download(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    stored(theo, "lanternfish", bucket, "season-1/replays/r-0001.bin", b"\0" * META_LIMIT)
    url = base + f"/console/{LF}/{bucket}?object=" + quote("season-1/replays/r-0001.bin", safe="")
    with app_page(browser, url) as page:
        ui_sign_in(page, PRIYA)
        inspector = page.get_by_role("region", name="Object inspector")
        wait_ui(page, inspector.is_visible)
        click(inspector.get_by_role("button", name="Share link"))
        dialog = page.get_by_role("dialog", name="Share link")
        wait_ui(page, dialog.is_visible)
        select(dialog.get_by_role("combobox", name="Expires in"), "1 hour")
        click(dialog.get_by_role("button", name="Create link"))
        box = dialog.get_by_role("textbox", name="Link URL")
        wait_ui(page, lambda: "/l/" in box.input_value())
        link_url = box.input_value()
        share = status_text(page, "Share status")
        assert fits("Link ready. It expires <expires at>.", share) and re.search(TIME_RE, share)
        recipient = httpx.get(link_url, timeout=HTTP_TIMEOUT)
        assert recipient.status_code == 200 and recipient.content == b"\0" * META_LIMIT
        assert recipient.headers["content-disposition"].startswith("attachment;")
        page.keyboard.press("Escape")
        nav_to(page, "Share links")
        row = page.get_by_role("table", name="Share links").get_by_role("row").filter(has_text="season-1/replays/r-0001.bin")
        wait_ui(page, row.first.is_visible)
        click(row.first.get_by_role("button", name="Revoke link"))
        wait_ui(page, lambda: status_text(page, "Share status") == "Link revoked. It stops working on the next request.")
    gone = httpx.get(link_url, headers={"Accept": "text/html"}, timeout=HTTP_TIMEOUT)
    assert gone.status_code == 410 and "This link was revoked." in gone.text
    for word in (bucket, "r-0001", "lanternfish", "Lanternfish", "Priya"):
        assert word not in gone.text
    assert httpx.get(link_url + "/other.bin", timeout=HTTP_TIMEOUT).status_code == 404


ALLOWED_LINK_HEADERS = {"content-type", "content-length", "etag", "last-modified", "x-content-type-options",
                        "content-security-policy", "cache-control", "content-disposition", "retry-after", "date",
                        "connection", "keep-alive"}


def test_wf_share_links_scope_expiry_privacy(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    v1 = stored(theo, "lanternfish", bucket, "qa/r.bin", b"version one", headers={"x-amz-meta-owner": "secretive",
                                                                                 "x-amz-tagging": "env=qa"})
    stored(theo, "lanternfish", bucket, "qa/sibling.bin", b"sibling")
    for seconds in (0, LINK_MAX_S + 1):
        r = theo.post(f"/api/w/{LF}/buckets/{bucket}/object/links", {"expires_in_seconds": seconds}, params={"key": "qa/r.bin"})
        assert_error(r, 422, "validation_failed", "expires_in_seconds")
    assert mint_link(theo, "lanternfish", bucket, "qa/r.bin", LINK_MAX_S)["state"] == "active"
    link = mint_link(theo, "lanternfish", bucket, "qa/r.bin")
    assert link["version_id"] == v1["version_id"] and link["url"].startswith(base + "/l/")
    stored(theo, "lanternfish", bucket, "qa/r.bin", b"version two")
    for r in (httpx.get(link["url"], timeout=HTTP_TIMEOUT),
              httpx.get(link["url"], params={"key": "qa/sibling.bin", "version": "x"}, timeout=HTTP_TIMEOUT),
              httpx.head(link["url"], timeout=HTTP_TIMEOUT)):
        assert r.status_code == 200
        assert set(r.headers) <= ALLOWED_LINK_HEADERS, set(r.headers) - ALLOWED_LINK_HEADERS
        for word in (bucket, "lanternfish", "cascade", "qa/", "secretive"):
            assert word not in str(dict(r.headers))
    assert httpx.get(link["url"], timeout=HTTP_TIMEOUT).content == b"version one"
    assert httpx.get(link["url"] + "/other.bin", timeout=HTTP_TIMEOUT).status_code == 404
    unknown = httpx.get(base + "/l/" + "A" * 43, headers={"Accept": "text/html"}, timeout=HTTP_TIMEOUT)
    assert unknown.status_code == 404 and "This link doesn't exist." in unknown.text
    short = mint_link(theo, "lanternfish", bucket, "qa/sibling.bin", 2)
    expires = parse_iso(short["expires_at"])

    def expired() -> bool:
        r = httpx.get(short["url"], timeout=HTTP_TIMEOUT)
        if r.status_code == 200:
            assert date_of(r) <= expires
            return False
        assert date_of(r) >= expires
        body = assert_error(r, 410, "link_expired")
        assert body["message"] == "This link has expired."
        assert set(r.headers) <= ALLOWED_LINK_HEADERS and "Content-Disposition" not in r.headers
        return True

    poll(expired, WAIT_S, "link expiry")


def test_wf_share_links_revocation_and_rate(app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    stored(theo, "lanternfish", bucket, "a.bin", b"a")
    old = stored(theo, "lanternfish", bucket, "b.bin", b"b1")
    stored(theo, "lanternfish", bucket, "b.bin", b"b2")
    stored(theo, "lanternfish", bucket, "c.bin", b"c")
    by_request = mint_link(theo, "lanternfish", bucket, "a.bin")
    by_delete = mint_link(theo, "lanternfish", bucket, "c.bin")
    by_version = mint_link(theo, "lanternfish", bucket, "b.bin", version=old["version_id"])
    viewer = new_member(base, mail, "lanternfish", MARA, "viewer")
    by_removal = mint_link(viewer.api, "lanternfish", bucket, "a.bin")
    assert theo.post(f"/api/w/{LF}/links/{by_request['id']}/revoke").json()["state"] == "revoked"
    assert_error(theo.post(f"/api/w/{LF}/links/{by_request['id']}/revoke"), 409, "invalid_transition")
    theo.delete(f"/api/w/{LF}/buckets/{bucket}/object", params={"key": "c.bin"})
    theo.delete(f"/api/w/{LF}/buckets/{bucket}/object/version", params={"key": "b.bin", "version": old["version_id"]})
    remove_member(base, "lanternfish", MARA, viewer)
    for link in (by_request, by_delete, by_version, by_removal):
        r = httpx.get(link["url"], timeout=HTTP_TIMEOUT)
        assert assert_error(r, 410, "link_revoked")["message"] == "This link was revoked."
    rate = mint_link(theo, "lanternfish", bucket, "a.bin")
    statuses = [httpx.get(rate["url"], timeout=HTTP_TIMEOUT) for _ in range(LINK_RATE + 1)]
    assert all(r.status_code == 200 for r in statuses[:LINK_RATE])
    body = assert_error(statuses[-1], 429, "rate_limited")
    assert int(statuses[-1].headers["retry-after"]) >= 1 and body["retry_after_seconds"] >= 1


def mail_from_ok(message: dict) -> bool:
    return "no-reply@farshore.test" in [a.lower() for a in addresses(message.get("From"))]


def test_wf_team_access_invite_and_join(browser: Any, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    email = fresh_email()
    with app_page(browser, base + "/console/lanternfish") as page:
        ui_sign_in(page, MARA)
        nav_to(page, "Team")
        click(page.get_by_role("button", name="Invite teammate"))
        dialog = page.get_by_role("dialog", name="Invite teammate")
        wait_ui(page, dialog.is_visible)
        fill(dialog.get_by_role("textbox", name="Email"), email)
        select(dialog.get_by_role("combobox", name="Role"), "Viewer")
        click(dialog.get_by_role("button", name="Send invite"))
        wait_ui(page, lambda: fits(f"Invite created for {email}. It expires <expires at>.", status_text(page, "Invite status")))
    message = poll(lambda: mails(mail, email, f"You're invited to {WS_NAMES[LF]} on Farshore"), WAIT_S, "invite email")[0]
    body = text(message)
    assert "viewer" in body and re.search(TIME_RE, body)
    assert mail_from_ok(message)
    token = re.search(r"/invite/([A-Za-z0-9_\-]+)", body).group(1)
    with app_page(browser, base + f"/invite/{token}") as page:
        wait_ui(page, page.get_by_role("heading", name=f"Join {WS_NAMES[LF]}").is_visible)
        fill(page.get_by_role("textbox", name="Your name"), "Invited Viewer")
        fill(page.get_by_label("Password", exact=True), FRESH_PASSWORD)
        click(page.get_by_role("button", name="Join workspace"))
        wait_ui(page, lambda: path_of(page).startswith("/console"))
    members = sign_in(base, MARA).get(f"/api/w/{LF}/members").json()["members"]
    joined = next(m for m in members if m["email"] == email)
    assert joined["role"] == "viewer"
    sign_in(base, MARA).delete(f"/api/w/{LF}/members/{joined['user_id']}")


def test_wf_team_access_invite_rate_and_reissue(app_url: str, mail: Any) -> None:
    base = env_url("APP_SHORT_SESSIONS_URL")
    mara = sign_in(base, MARA)
    first = fresh_email()
    invites = f"/api/w/{LF}/invites"
    assert mara.post(invites, {"email": first, "role": "viewer"}).status_code == 201
    assert mara.post(invites, {"email": first, "role": "developer"}).status_code == 201
    results = [mara.post(invites, {"email": fresh_email(), "role": "viewer"})
               for _ in range(INVITE_RATE - 1)]
    assert [r.status_code for r in results[:-1]] == [201] * (INVITE_RATE - 2)
    body = assert_error(results[-1], 429, "rate_limited")
    assert int(results[-1].headers["retry-after"]) >= 1 and body["retry_after_seconds"] >= 1
    old, new = invite_tokens(mail, first, 2)[:2]
    assert httpx.get(base + f"/api/invites/{old}", timeout=HTTP_TIMEOUT).status_code == 404
    live = httpx.get(base + f"/api/invites/{new}", timeout=HTTP_TIMEOUT)
    assert live.status_code == 200 and live.json()["role"] == "developer"
    states = [i["state"] for i in sign_in(base, MARA).get(invites).json()["invites"] if i["email"] == first]
    assert sorted(states) == ["pending", "replaced"]


def test_wf_team_access_roles_and_removal(app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    mara = sign_in(base, MARA)
    bucket = make_bucket(sign_in(base, THEO), "lanternfish", ["cascade"])
    dev = new_member(base, mail, "lanternfish", MARA, "developer")
    assert upload(dev.api, "lanternfish", bucket, "dev.bin", b"x").status_code == 201
    assert mara.patch(f"/api/w/{LF}/members/{dev.user_id}", {"role": "viewer"}).json()["role"] == "viewer"
    assert_error(upload(dev.api, "lanternfish", bucket, "dev2.bin", b"x"), 403, "forbidden")
    assert mara.patch(f"/api/w/{LF}/members/{dev.user_id}", {"role": "viewer"}).status_code == 200
    link = mint_link(dev.api, "lanternfish", bucket, "dev.bin")
    assert mara.delete(f"/api/w/{LF}/members/{dev.user_id}").status_code == 204
    assert_error(dev.api.get(f"/api/w/{LF}/buckets"), 404, "not_found")
    assert_error(httpx.get(link["url"], timeout=HTTP_TIMEOUT), 410, "link_revoked")
    a, b = (new_member(base, mail, "lanternfish", MARA, "owner") for _ in range(2))
    results = together([lambda: a.api.patch(f"/api/w/{LF}/members/{b.user_id}", {"role": "viewer"}),
                        lambda: b.api.patch(f"/api/w/{LF}/members/{a.user_id}", {"role": "viewer"})])
    codes = sorted(r.status_code for r in results)
    assert codes[0] == 200 and codes[1] in (403, 409)
    roles = {m["user_id"]: m["role"] for m in mara.get(f"/api/w/{LF}/members").json()["members"]}
    assert sorted([roles[a.user_id], roles[b.user_id]]) == ["owner", "viewer"]
    ada = sign_in(base, ADA)
    ada_id = ada.get("/api/me").json()["user"]["id"]
    assert_error(ada.patch(f"/api/w/{TP}/members/{ada_id}", {"role": "viewer"}), 409, "last_owner")
    assert_error(ada.delete(f"/api/w/{TP}/members/{ada_id}"), 409, "last_owner")
    entries = mara.get(f"/api/w/{LF}/audit", params={"action": "member.role_changed", "actor": MARA}).json()["entries"]
    assert any(e["target"] == dev.email and e["detail"] == " -> ".join(["developer", "viewer"]) for e in entries)
    for member in (a, b):
        remove_member(base, "lanternfish", MARA, member)


def test_wf_usage_billing_usage_page(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    mara, sol, theo = sign_in(base, MARA), sign_in(base, SOL), sign_in(base, THEO)
    tok = uuid.uuid4().hex[:10]
    assert sol.post(f"/api/w/{PK}/buckets", {"name": f"vf{tok}-replays", "placement": ["cascade"]}).status_code == 201
    stored(sol, "paperkite", f"vf{tok}-replays", "x.bin", b"paper kite")
    assert theo.post(f"/api/w/{LF}/buckets", {"name": f"vf{tok}-replay", "placement": ["cascade"]}).status_code == 201
    stored(theo, "lanternfish", f"vf{tok}-replay", "x.bin", b"lanternfish")
    with app_page(browser, base + f"/console/{LF}") as page:
        ui_sign_in(page, MARA)
        nav_to(page, "Usage")
        meter = page.get_by_role("meter", name="Stored")
        wait_ui(page, meter.is_visible)
        usage = mara.get(f"/api/w/{LF}/usage").json()
        assert usage["stored_bytes"] == sum(b["stored_bytes"] for b in mara.get(f"/api/w/{LF}/buckets").json()["buckets"])
        value = meter.evaluate("e => e.getAttribute('aria-valuenow') ?? String(e.value)")
        assert float(value) == pytest.approx(min(100.0, usage["percent"]["storage"]))
        pct = Decimal(str(usage["percent"]["storage"])).quantize(Decimal("0.1"), ROUND_HALF_UP)
        page_text = body_text(page)
        assert f"{count(usage['stored_bytes'])} of {count(INDIE_STORAGE)} bytes ({pct}%)" in page_text
        assert f"Reserved for open uploads {count(usage['reserved_bytes'])} bytes" in page_text
        assert page.get_by_role("meter", name="Egress this month").is_visible()
        line = status_text(page, "Billing sync")
        copies = ["Billing in sync. Confirmed through <confirmed through>.",
                  "Billing sync pending. Closed hours post within a minute.",
                  "Billing sync delayed. Metered totals here are complete; billing has confirmed usage through <confirmed through>."]
        assert any(fits(c, line) for c in copies), line
        assert page.get_by_role("button", name="Download CSV").is_visible()


def test_wf_usage_billing_export_csv(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    mara, sol, theo = sign_in(base, MARA), sign_in(base, SOL), sign_in(base, THEO)
    tok = uuid.uuid4().hex[:10]
    assert sol.post(f"/api/w/{PK}/buckets", {"name": f"vf{tok}-replays", "placement": ["cascade"]}).status_code == 201
    stored(sol, "paperkite", f"vf{tok}-replays", "x.bin", b"paper kite")
    assert theo.post(f"/api/w/{LF}/buckets", {"name": f"vf{tok}-replay", "placement": ["cascade"]}).status_code == 201
    stored(theo, "lanternfish", f"vf{tok}-replay", "x.bin", b"lanternfish")
    with app_page(browser, base + f"/console/{LF}") as page:
        ui_sign_in(page, MARA)
        nav_to(page, "Usage")
        button = page.get_by_role("button", name="Download CSV")
        wait_ui(page, button.is_visible)
        csv_bytes = downloaded(page, button)
    lines = csv_bytes.decode().split("\n")
    assert lines[0] == "window_start_utc,window_end_utc,bucket,unit,amount,tracking_id,billing_state" and lines[-1] == ""
    names = {b["name"] for b in mara.get(f"/api/w/{LF}/buckets").json()["buckets"]}
    rows = [line.split(",") for line in lines[1:-1]]
    assert rows and all(r[2] in names for r in rows) and f"vf{tok}-replays" not in {r[2] for r in rows}
    assert f"vf{tok}-replay" in {r[2] for r in rows}
    assert [r[0] for r in rows] == sorted(r[0] for r in rows)
    for r in rows:
        assert AMOUNT_RE.match(r[4]) and r[5] == f"fs-{LF}-{r[2]}-{r[3]}-" + r[0].replace("-", "").replace(":", "")
    export = mara.get(f"/api/w/{LF}/usage/export.csv")
    assert export.headers["content-type"].startswith("text/csv")
    assert fits(f'attachment; filename="farshore-{LF}-<period>.csv"', export.headers["content-disposition"])
    assert f"vf{tok}-replays" not in export.text
    assert_error(mara.get(f"/api/w/{LF}/usage/export.csv", params={"period": "2026-13"}), 422, "validation_failed", "period")


def test_wf_usage_billing_exactly_once(app_url: str, killbill: Any) -> None:
    base = app_url.rstrip("/")
    theo, mara, ops = sign_in(base, THEO), sign_in(base, MARA), sign_in(base, OPERATOR)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian", "monsoon"])
    item = stored(theo, "lanternfish", bucket, "usage.bin", os.urandom(SANDBOX_QUOTA - 1))
    acknowledged = parse_iso(item["last_modified"])
    for _ in range(2):
        r = ops.post("/api/ops/billing/sync")
        assert r.status_code == 200 and r.json()["queued"] == 0, r.text
    rows = bucket_rows(mara, "lanternfish", bucket)
    ids = [r["tracking_id"] for r in rows]
    assert len(ids) == len(set(ids))
    storage = [r for r in rows if r["unit"] == "storage-gb-hours"]
    assert storage
    for row in storage:
        start, end = parse_iso(row["window_start"]), parse_iso(row["window_end"])
        held_s = int((end - max(start, acknowledged)).total_seconds())
        expected = (Decimal(item["size"] * 3 * held_s) / Decimal(GB_HOURS_DIVISOR)).quantize(Decimal("0.000000001"), ROUND_HALF_UP)
        assert AMOUNT_RE.match(row["amount"]) and Decimal(row["amount"]) == expected, row
        assert row["tracking_id"] == f"fs-{LF}-{bucket}-{row['unit']}-" + start.strftime("%Y%m%dT%H%M%SZ")
        assert row["billing_state"] == "posted"
    assert units(mara, "lanternfish", bucket) == 1
    account = killbill.account_by_key(f"farshore-{LF}")
    assert account
    keys = [s.get("externalKey") for s in killbill.subscriptions(account["accountId"])]
    assert f"farshore-{LF}-plan" in keys


class Relay:

    def __init__(self, target_url: str) -> None:
        target = urlparse(target_url)
        self.target = (target.hostname, target.port or (443 if target.scheme == "https" else 80))
        self.up = False
        self.closed = False
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.url = f"{target.scheme}://127.0.0.1:{self.sock.getsockname()[1]}{target.path}".rstrip("/")
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self.closed:
            try:
                client, _ = self.sock.accept()
            except OSError:
                return
            if not self.up:
                client.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
            except OSError:
                client.close()
                continue
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(a: socket.socket, b: socket.socket) -> None:
        try:
            while True:
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

    def close(self) -> None:
        self.closed = True
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()


def own_database(suffix: str) -> str:
    url = os.environ["DATABASE_URL"]
    name = urlparse(url).path.lstrip("/") + suffix
    r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{name}"'],
                       capture_output=True, text=True, timeout=HTTP_TIMEOUT)
    assert r.returncode == 0, r.stderr
    return url + suffix


def own_bucket(suffix: str) -> str:
    name = os.environ["S3_BUCKET"] + suffix
    cred = (os.environ["S3_ACCESS_KEY_ID"], os.environ["S3_SECRET_ACCESS_KEY"])
    region = os.environ.get("S3_REGION") or S3_SCOPE_REGION
    r = s3(os.environ["S3_ENDPOINT"], cred, "PUT", name, root="", region=region)
    assert r.status_code == 200, r.text
    assert S3(suffix).keys("") == []
    return name


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    port = free_port()
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile(prefix="farshore-copy-", suffix=".log", delete=False)
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    proc = subprocess.Popen(serve, shell=True, cwd=conftest.DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-4000:]

    def up() -> bool:
        assert proc.poll() is None, "app copy exited:\n" + tail()
        with contextlib.suppress(httpx.HTTPError):
            return httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).status_code == 200
        return False

    def seeded() -> bool:
        assert proc.poll() is None, "app copy exited:\n" + tail()
        return Api(base).post("/api/session", {"email": THEO, "password": PASSWORD}).status_code == 200

    try:
        poll(up, LONG_WAIT_S, "app copy health")
        poll(seeded, LONG_WAIT_S, "app copy seed", interval=1.0)
        yield base
        assert proc.poll() is None, "app copy restarted or exited:\n" + tail()
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=WAIT_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


SHORT_SYNC_S = "2"


def test_wf_usage_billing_killbill_outage(browser: Any) -> None:
    relay = Relay(os.environ["KILLBILL_URL"])
    tag = uuid.uuid4().hex[:8]
    overrides = {"DATABASE_URL": own_database("_billing_" + tag), "S3_BUCKET": own_bucket("-billing-" + tag),
                 "KILLBILL_URL": relay.url, "FARSHORE_BILLING_SYNC_SECONDS": SHORT_SYNC_S}
    try:
        with app_copy(overrides) as down:
            theo = sign_in(down, THEO)
            bucket = make_bucket(theo, "lanternfish", ["cascade"])
            assert upload(theo, "lanternfish", bucket, "queued.bin", b"queued usage").status_code == 201
            r = sign_in(down, OPERATOR).post("/api/ops/billing/sync")
            assert r.status_code == 202 and r.json()["queued"] > 0 and r.json()["state"] == "delayed"
            billing = sign_in(down, OPERATOR).get("/api/ops/billing").json()
            assert billing["state"] == "delayed" and billing["last_error"]
            assert sign_in(down, MARA).get(f"/api/w/{LF}/usage").json()["billing"]["state"] == "delayed"
            with app_page(browser, down + "/console/lanternfish") as page:
                ui_sign_in(page, MARA)
                nav_to(page, "Usage")
                wait_ui(page, lambda: fits("Billing sync delayed. Metered totals here are complete; billing has confirmed "
                                           "usage through <confirmed through>.", status_text(page, "Billing sync")))
            queued = [row for row in bucket_rows(sign_in(down, MARA), "lanternfish", bucket)
                      if row["billing_state"] == "queued"]
            assert queued
            relay.up = True
            ops = sign_in(down, OPERATOR)
            poll(lambda: (lambda b: b["queued_rows"] == 0 and b["state"] != "delayed")(ops.get("/api/ops/billing").json()),
                 LONG_WAIT_S, "queue drained without restart", interval=1.0)
            mara = sign_in(down, MARA)
            poll(lambda: mara.get(f"/api/w/{LF}/usage").json()["billing"]["state"] == "in_sync", LONG_WAIT_S,
                 "billing line back in sync", interval=1.0)
            again = ops.post("/api/ops/billing/sync")
            assert again.status_code == 200 and again.json()["queued"] == 0
            rows = bucket_rows(mara, "lanternfish", bucket)
            queued_ids = {q["tracking_id"] for q in queued}
            assert all(row["billing_state"] == "posted" for row in rows if row["tracking_id"] in queued_ids)
            assert len({row["tracking_id"] for row in rows}) == len(rows)
    finally:
        relay.close()


def cleanup_versions(api: Api, ws: str, bucket: str, keys: list[str]) -> None:
    for key in keys:
        api.delete(f"/api/w/{ws}/buckets/{bucket}/object", params={"key": key})
        r = api.get(f"/api/w/{ws}/buckets/{bucket}/object/versions", params={"key": key})
        for v in r.json().get("versions", []) if r.status_code == 200 else []:
            api.delete(f"/api/w/{ws}/buckets/{bucket}/object/version", params={"key": key, "version": v["version_id"]})


TIDEPOOL_STORAGE_PEAK = [0]


def test_wf_usage_billing_quota(app_url: str) -> None:
    base = app_url.rstrip("/")
    ada = sign_in(base, ADA)
    bucket = make_bucket(ada, "tidepool", ["cascade"])
    key = make_key(ada, "tidepool", buckets=[bucket])
    keys: list[str] = []
    part_size, console_size = SANDBOX_QUOTA * 6 // 10, SANDBOX_QUOTA // 2
    try:
        upload_id = multipart_start(base, cred_of(key), bucket, "ci/part.bin")
        assert part(base, cred_of(key), bucket, "ci/part.bin", upload_id, 1, b"\0" * part_size).status_code == 200
        assert ada.get(f"/api/w/{TP}/usage").json()["reserved_bytes"] >= part_size
        refused = upload(ada, "tidepool", bucket, "console.bin", b"\0" * console_size)
        body = assert_error(refused, 409, "quota_exceeded")
        assert body["quota_bytes"] == SANDBOX_QUOTA and body["reserved_bytes"] >= part_size
        assert_s3_error(s3(base, cred_of(key), "PUT", bucket, "ci/put.bin", body=b"\0" * console_size), 403, "QuotaExceeded")
        assert s3(base, cred_of(key), "DELETE", bucket, "ci/part.bin", query={"uploadId": upload_id}).status_code == 204
        assert ada.get(f"/api/w/{TP}/usage").json()["reserved_bytes"] == 0
        assert upload(ada, "tidepool", bucket, "console.bin", b"\0" * console_size).status_code == 201
        keys.append("console.bin")
        usage = ada.get(f"/api/w/{TP}/usage").json()
        remaining = SANDBOX_QUOTA - usage["stored_bytes"] - usage["reserved_bytes"]
        size = remaining // 3 + 1
        racers = [sign_in(base, ADA) for _ in range(5)]
        results = together([lambda a=a, i=i: upload(a, "tidepool", bucket, f"race-{i}.bin", b"\0" * size)
                            for i, a in enumerate(racers)])
        assert sorted(r.status_code for r in results) == [201, 201, 409, 409, 409]
        keys += [f"race-{i}.bin" for i, r in enumerate(results) if r.status_code == 201]
        after = ada.get(f"/api/w/{TP}/usage").json()
        assert after["stored_bytes"] + after["reserved_bytes"] <= SANDBOX_QUOTA
        TIDEPOOL_STORAGE_PEAK[0] = max(TIDEPOOL_STORAGE_PEAK[0], after["stored_bytes"])
    finally:
        cleanup_versions(ada, "tidepool", bucket, keys)
        drop_key(ada, "tidepool", key["key_id"])


def test_usage_threshold_alerts(app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    ada = sign_in(base, ADA)
    bucket = make_bucket(ada, "tidepool", ["cascade"])
    try:
        usage = ada.get(f"/api/w/{TP}/usage").json()
        already = {"storage": max(usage["stored_bytes"], TIDEPOOL_STORAGE_PEAK[0]), "egress": usage["egress_bytes"]}
        fill_bytes = SANDBOX_QUOTA - usage["stored_bytes"] - usage["reserved_bytes"]
        assert upload(ada, "tidepool", bucket, "fill.bin", b"\0" * fill_bytes).status_code == 201
        cleanup_versions(ada, "tidepool", bucket, ["fill.bin"])
        assert upload(ada, "tidepool", bucket, "fill.bin", b"\0" * fill_bytes).status_code == 201
        egress = ada.get(f"/api/w/{TP}/usage").json()["egress_bytes"]
        while egress < SANDBOX_EGRESS:
            assert content(ada, "tidepool", bucket, "fill.bin").status_code == 200
            egress += fill_bytes
        for pct in (80, 100):
            for metric, included in (("storage", SANDBOX_QUOTA), ("egress", SANDBOX_EGRESS)):
                subject = f"{WS_NAMES[TP]} has used {pct}% of included {metric}"
                if already[metric] * 100 >= included * pct:
                    assert len(mails(mail, ADA, subject)) <= 1, subject
                    continue
                found = poll(lambda s=subject: mails(mail, ADA, s), WAIT_S, subject)
                assert len(found) == 1, subject
                assert f"{count(included)} bytes" in text(found[0])
    finally:
        cleanup_versions(ada, "tidepool", bucket, ["fill.bin"])


def test_wf_operator_console_live(browser: Any, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "pampas"])
    reason = "verifier abuse report " + uuid.uuid4().hex[:8]
    tidepool = WS_NAMES[TP]
    try:
        with app_page(browser, base + "/signin") as page:
            ui_sign_in(page, OPERATOR)
            wait_ui(page, lambda: path_of(page).startswith("/ops"))
            click(page.get_by_role("link", name="Regions"))
            table = page.get_by_role("table", name="Region backlog")
            wait_ui(page, table.is_visible)
            click(page.get_by_role("button", name=f"Take {PAMPAS} offline"))
            wait_ui(page, lambda: status_text(page, "Operator status") == f"{PAMPAS} is now offline.")
            row = table.get_by_role("row").filter(has_text=PAMPAS)
            before = row.inner_text()
            stored(theo, "lanternfish", bucket, "live.bin", b"live figures")
            wait_replica(theo, "lanternfish", bucket, "live.bin", "pampas", "failed")
            failed = ops_region(sign_in(base, OPERATOR), "pampas")["failed"]
            wait_ui(page, lambda: row.inner_text() != before and count(failed) in row.inner_text(), what="live failed count")
            assert status_text(page, "Operator status") == f"{PAMPAS} is now offline."
            click(page.get_by_role("button", name=f"Bring {PAMPAS} online"))
            wait_ui(page, lambda: status_text(page, "Operator status") == f"{PAMPAS} is now online.")
            wait_settled(theo, "lanternfish", bucket, "live.bin")
            click(page.get_by_role("link", name="Workspaces"))
            click(page.get_by_role("button", name=f"Suspend {tidepool}"))
            dialog = page.get_by_role("dialog", name="Suspend workspace")
            box = dialog.get_by_role("textbox", name="Reason")
            wait_ui(page, box.is_visible)
            box.press_sequentially(reason)
            advance(page, OPS_REREAD_MS * 2)
            assert box.input_value() == reason and is_focused(box)
            assert box.evaluate("e => e.selectionStart") == len(reason)
            click(dialog.get_by_role("button", name="Suspend"))
            wait_ui(page, lambda: status_text(page, "Operator status") == f"{tidepool} suspended.")
            found = poll(lambda: [m for m in mails(mail, ADA, f"{tidepool} is suspended on Farshore") if reason in text(m)])
            assert len(found) == 1
            click(page.get_by_role("button", name=f"Reinstate {tidepool}"))
            wait_ui(page, lambda: status_text(page, "Operator status") == f"{tidepool} reinstated.")
            click(page.get_by_role("link", name="Billing"))
            click(page.get_by_role("button", name="Sync billing now"))
            wait_ui(page, lambda: fits("Billing sync: <posted> rows posted, <queued> still queued.",
                                       status_text(page, "Operator status")), seconds=LONG_WAIT_S)
    finally:
        ops = sign_in(base, OPERATOR)
        ops.post(region_path("pampas"), {"state": "online"})
        ops.post(suspension_path(TP, "reinstate"))


def test_wf_operator_region_maintenance(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, ops = sign_in(base, THEO), sign_in(base, OPERATOR)
    replica_bucket = make_bucket(theo, "lanternfish", ["cascade", "pampas"])
    origin_bucket = make_bucket(theo, "lanternfish", ["pampas", "cascade"])
    mara = sign_in(base, MARA)
    key = make_key(mara, "lanternfish", buckets=[origin_bucket])
    operators = [sign_in(base, OPERATOR) for _ in range(3)]
    try:
        start = ops_region(ops, "pampas")["failed"]
        results = together([lambda o=o: o.post(region_path("pampas"), {"state": "offline"}) for o in operators])
        assert sorted(r.status_code for r in results) == [200, 409, 409]
        for k in ("m1.bin", "m2.bin", "m3.bin"):
            stored(theo, "lanternfish", replica_bucket, k, k.encode())
        for k in ("m1.bin", "m2.bin", "m3.bin"):
            replica = wait_replica(theo, "lanternfish", replica_bucket, k, "pampas", "failed")
            assert replica["error"] == "region_offline"
        assert ops_region(ops, "pampas")["failed"] - start == 3
        assert_error(upload(theo, "lanternfish", origin_bucket, "o.bin", b"x"), 503, "region_offline")
        slow = s3(base, cred_of(key), "PUT", origin_bucket, "o.bin", body=b"x")
        assert_s3_error(slow, 503, "SlowDown")
        assert slow.headers["retry-after"] == SLOWDOWN_RETRY_AFTER
        attempts = {k: wait_replica(theo, "lanternfish", replica_bucket, k, "pampas", "failed")["attempts"]
                    for k in ("m1.bin", "m2.bin", "m3.bin")}
        results = together([lambda o=o: o.post(region_path("pampas"), {"state": "online"}) for o in operators[:2]])
        assert sorted(r.status_code for r in results) == [200, 409]
        for k, before in attempts.items():
            settled = wait_replica(theo, "lanternfish", replica_bucket, k, "pampas", "settled", seconds=SETTLE_S + GRACE_S)
            assert settled["attempts"] == before + 1
        assert ops_region(ops, "pampas")["failed"] == start
    finally:
        sign_in(base, OPERATOR).post(region_path("pampas"), {"state": "online"})
        drop_key(mara, "lanternfish", key["key_id"])


def test_wf_operator_suspension(app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    ada = sign_in(base, ADA)
    bucket = make_bucket(ada, "tidepool", ["cascade"])
    stored(ada, "tidepool", bucket, "s.bin", b"suspend me")
    key = make_key(ada, "tidepool", buckets=[bucket])
    link = mint_link(ada, "tidepool", bucket, "s.bin")
    upload_id = multipart_start(base, cred_of(key), bucket, "open.bin")
    sink = Sink()
    sink.failing.add(1)
    endpoint = ada.post(f"/api/w/{TP}/webhooks", {"url": sink.url, "events": ["object.created"], "buckets": [bucket],
                                                     "description": ""}).json()
    reason = "verifier suspension " + uuid.uuid4().hex[:8]
    operators = [sign_in(base, OPERATOR) for _ in range(3)]
    try:
        stored(ada, "tidepool", bucket, "event.bin", b"event")
        poll(lambda: sink.of(1), FIRST_ATTEMPT_S + GRACE_S, "first attempt")
        results = together([lambda o=o: o.post(suspension_path(TP, "suspend"), {"reason": reason}) for o in operators])
        assert sorted(r.status_code for r in results) == [200, 409, 409]
        sink.failing.clear()
        w = f"/api/w/{TP}/buckets/{bucket}"
        for r in (upload(ada, "tidepool", bucket, "n.bin", b"x"), content(ada, "tidepool", bucket, "s.bin"),
                  ada.delete(f"{w}/object", params={"key": "s.bin"}), ada.post(f"{w}/objects/delete", {"keys": ["s.bin"]}),
                  ada.post(f"/api/w/{TP}/buckets", {"name": fresh_bucket(), "placement": ["cascade"]}),
                  ada.post(f"{w}/object/links", {"expires_in_seconds": HOUR_S}, params={"key": "s.bin"}),
                  httpx.get(link["url"], timeout=HTTP_TIMEOUT)):
            assert_error(r, 403, "workspace_suspended")
        assert "This link is paused." in httpx.get(link["url"], headers={"Accept": "text/html"}, timeout=HTTP_TIMEOUT).text
        for r in (s3(base, cred_of(key), "GET", bucket, "s.bin"), part(base, cred_of(key), bucket, "open.bin", upload_id, 1, b"p"),
                  delete_objects(base, cred_of(key), bucket, [("s.bin", None)])):
            assert_s3_error(r, 403, "AccountSuspended")
        for path in (f"{w}/objects", f"/api/w/{TP}/usage", f"/api/w/{TP}/audit", f"/api/w/{TP}/webhooks"):
            assert ada.get(path).status_code == 200, path
        held_until = time.monotonic() + DEFAULT_BACKOFF_S + BACKOFF_SLACK_S + GRACE_S
        poll(lambda: time.monotonic() > held_until, LONG_WAIT_S, "backoff window while suspended")
        assert len(sink.of(1)) == 1
        found = poll(lambda: [m for m in mails(mail, ADA, f"{WS_NAMES[TP]} is suspended on Farshore") if reason in text(m)])
        assert len(found) == 1
        rows = Postgres().rows(f"SELECT actor, detail FROM audit_entries WHERE workspace_slug = '{TP}' "
                               "AND action = 'workspace.suspended' ORDER BY seq DESC LIMIT 1")
        assert rows[0] == {"actor": "operator", "detail": reason}
        assert sign_in(base, OPERATOR).post(suspension_path(TP, "reinstate")).status_code == 200
        assert upload(ada, "tidepool", bucket, "after.bin", b"x").status_code == 201
        r = part(base, cred_of(key), bucket, "open.bin", upload_id, 1, b"part")
        assert r.status_code == 200
        assert complete(base, cred_of(key), bucket, "open.bin", upload_id, complete_xml([(1, r.headers["etag"])])).status_code == 200
        poll(lambda: len(sink.of(1)) >= 2, LONG_WAIT_S, "held delivery resumed")
        assert httpx.get(link["url"], timeout=HTTP_TIMEOUT).status_code == 200
    finally:
        sign_in(base, OPERATOR).post(suspension_path(TP, "reinstate"))
        drop_endpoint(ada, "tidepool", endpoint["id"])
        cleanup_versions(ada, "tidepool", bucket, ["s.bin", "event.bin", "after.bin", "open.bin"])
        drop_key(ada, "tidepool", key["key_id"])
        sink.close()


OPS_PATHS = ["/api/ops/regions", "/api/ops/billing", "/api/ops/workspaces/lanternfish/suspend",
             "/api/ops/workspaces/no-such-ws-x/suspend", "/api/ops/regions/atlantis/state", "/api/ops/unknown-path",
             "/api/ops/lifecycle/run"]


def test_wf_operator_gate(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    pending = Api(base)
    assert pending.post("/api/session", {"email": JUN, "password": PASSWORD}).status_code == 202
    theo = sign_in(base, THEO)
    bodies = []
    for path in OPS_PATHS:
        method = "POST" if path.endswith(("suspend", "state", "run")) else "GET"
        assert_error(Api(base).call(method, path, {}), 401, "unauthenticated")
        assert_error(pending.call(method, path, {}), 401, "two_step_required")
        r = theo.call(method, path, {})
        assert r.status_code == 403
        bodies.append(r.json())
    assert all(b == {"error": "forbidden", "message": OPS_MESSAGE} for b in bodies)
    ops = sign_in(base, OPERATOR)
    for ws, section in ((LF, "buckets"), ("no-such-ws-x", "buckets"), (LF, "usage")):
        path = f"/api/w/{ws}/{section}"
        assert_error(ops.get(path), 404, "not_found")
    with app_page(browser, base + "/ops") as page:
        ui_sign_in(page, THEO)
        wait_ui(page, lambda: path_of(page).startswith("/console"), what="member sent to console")
    with app_page(browser, base + "/console") as page:
        ui_sign_in(page, OPERATOR)
        wait_ui(page, lambda: path_of(page).startswith("/ops"), what="operator sent to ops")


def test_wf_replica_wake_settle_on_etag(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian", "monsoon"])
    data = os.urandom(DEFAULT_PAGE * 50)
    item = stored(theo, "lanternfish", bucket, "rep.bin", data)
    body = wait_settled(theo, "lanternfish", bucket, "rep.bin")
    assert body["ready"] is True and body["etag"] == md5_etag(data)
    assert [r["region"] for r in body["replicas"]] == ["cascade", "meridian", "monsoon"]
    ack = parse_iso(body["acknowledged_at"])
    for replica in body["replicas"]:
        if replica["role"] == "origin":
            assert replica["settle_ms"] == 0 and replica["attempts"] == 0 and replica["state"] == "settled"
        else:
            settled = parse_iso(replica["settled_at"])
            assert settled >= ack and 0 <= replica["settle_ms"] <= SETTLE_S * 1000 and replica["attempts"] >= 1
            assert abs(replica["settle_ms"] / 1000 - (settled - ack).total_seconds()) <= 1
    copies = minio_copies(S3(), bucket, item["version_id"])
    assert sorted(c.split("/")[1] for c in copies) == ["cascade", "meridian", "monsoon"]
    big = stored(theo, "lanternfish", bucket, "fast.bin", os.urandom(UPLOAD_LIMIT // 2))
    stored(theo, "lanternfish", bucket, "fast.bin", b"newer")
    first_seen = replicas_of(theo, "lanternfish", bucket, "fast.bin", big["version_id"]).json()["replicas"]
    unsettled = {r["region"] for r in first_seen if r["role"] == "replica" and r["settled_at"] is None}
    assert all(r["state"] == "superseded" for r in first_seen if r["role"] == "replica")
    quiet_until = time.monotonic() + SETTLE_S + GRACE_S
    poll(lambda: time.monotonic() > quiet_until, LONG_WAIT_S, "superseded copies finish")
    for replica in replicas_of(theo, "lanternfish", bucket, "fast.bin", big["version_id"]).json()["replicas"]:
        if replica["role"] == "replica":
            assert replica["state"] == "superseded"
            if replica["region"] in unsettled:
                assert replica["settled_at"] is None and replica["settle_ms"] is None


def test_wf_replica_wake_state_machine(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "pampas"])
    region = "pampas"
    retry = f"/api/w/{LF}/buckets/{bucket}/object/replicas/{region}/retry"
    with regions_offline(base, "pampas") as ops:
        current = stored(theo, "lanternfish", bucket, "live.bin", b"live")
        gone = stored(theo, "lanternfish", bucket, "gone.bin", b"gone")
        wait_replica(theo, "lanternfish", bucket, "live.bin", "pampas", "failed")
        wait_replica(theo, "lanternfish", bucket, "gone.bin", "pampas", "failed")
        r = theo.post(retry, params={"key": "live.bin"})
        assert r.status_code == 202 and r.json()["state"] == "pending"
        wait_replica(theo, "lanternfish", bucket, "live.bin", "pampas", "failed", seconds=SETTLE_S + GRACE_S)
        batch = theo.post(f"/api/w/{LF}/buckets/{bucket}/objects/delete", {"keys": ["gone.bin"]}).json()
        assert wait_replica(theo, "lanternfish", bucket, "gone.bin", "pampas", "superseded", gone["version_id"])
        assert_error(theo.post(retry, params={"key": "gone.bin", "version": gone["version_id"]}), 409, "invalid_transition")
        assert ops.post(region_path(region), {"state": "online"}).status_code == 200
    wait_replica(theo, "lanternfish", bucket, "live.bin", "pampas", "settled", seconds=SETTLE_S + GRACE_S)
    states = replicas_of(theo, "lanternfish", bucket, "gone.bin", gone["version_id"]).json()["replicas"]
    assert next(r for r in states if r["region"] == "pampas")["state"] == "superseded"
    assert_error(theo.post(retry, params={"key": "live.bin"}), 409, "invalid_transition")
    undone = theo.post(f"/api/w/{LF}/batches/{batch['batch_id']}/undo")
    assert undone.status_code == 200
    wait_replica(theo, "lanternfish", bucket, "gone.bin", "pampas", "settled", seconds=SETTLE_S + GRACE_S)
    stored(theo, "lanternfish", bucket, "live.bin", b"live two")
    r = theo.delete(f"/api/w/{LF}/buckets/{bucket}/object/version", params={"key": "live.bin", "version": current["version_id"]})
    assert r.status_code == 204
    assert_error(replicas_of(theo, "lanternfish", bucket, "live.bin", current["version_id"]), 404, "not_found")
    poll(lambda: minio_copies(S3(), bucket, current["version_id"]) == [], WAIT_S, "removed bytes")


def wake_state(page: Page, regions: list[str]) -> tuple[dict, list[str], str]:
    figure = page.get_by_role("figure", name="Replica map")
    pins = figure.evaluate(
        """(f, regions) => regions.map(r => {
            const pin = f.querySelector(`[data-region="${r}"]`);
            const wake = f.querySelector(`[data-wake="${r}"]`);
            const numeral = f.querySelector(`[data-numeral="${r}"]`);
            return {state: pin && pin.dataset.state, progress: wake && wake.dataset.progress,
                    numeral: numeral && numeral.textContent.trim()};
        })""", regions)
    items = [" ".join(i.split()) for i in page.get_by_role("list", name="Replica status").get_by_role("listitem").all_text_contents()]
    return dict(zip(regions, pins)), items, status_text(page, "Replica announcements")


def test_wf_replica_wake_inspector_wake(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    regions = ["cascade", "monsoon", "pampas"]
    bucket = make_bucket(theo, "lanternfish", regions)
    with regions_offline(base, "monsoon", "pampas"):
        stored(theo, "lanternfish", bucket, "wake.bin", b"wake")
        for region in ("monsoon", "pampas"):
            wait_replica(theo, "lanternfish", bucket, "wake.bin", region, "failed")
        with app_page(browser, base + f"/console/lanternfish/{bucket}?object=wake.bin") as page:
            ui_sign_in(page, THEO)
            wait_ui(page, lambda: wake_state(page, regions)[1] == [f"{CASCADE}: origin, settled", f"{MONSOON}: failed",
                                                                   f"{PAMPAS}: failed"])
            pins, _, _ = wake_state(page, regions)
            assert [pins[r]["state"] for r in regions] == ["origin", "failed", "failed"]
            operators = [sign_in(base, OPERATOR) for _ in range(2)]
            together([lambda o=o, r=r: o.post(f"/api/ops/regions/{r}/state", {"state": "online"})
                      for o, r in zip(operators, ("monsoon", "pampas"))])
            fills: dict[str, int] = {}
            samples = 0
            deadline = time.monotonic() + LONG_WAIT_S
            while len(fills) < 2 and time.monotonic() < deadline:
                advance(page, STEP_MS / 2)
                samples += 1
                pins, items, announced = wake_state(page, regions)
                moving = [r for r in ("monsoon", "pampas") if pins[r]["progress"] not in (None, "", "0.00", "1.00")]
                assert len(moving) <= 1, pins
                for region in ("monsoon", "pampas"):
                    if region not in fills and pins[region]["state"] == "settled":
                        fills[region] = samples
                        assert pins[region]["progress"] == "1.00"
                        assert any(i.startswith(f"{REGION_NAMES[region]}: settled in ") for i in items)
                        assert announced.startswith(f"{REGION_NAMES[region]} settled in ")
            assert len(fills) == 2
            body = replicas_of(theo, "lanternfish", bucket, "wake.bin").json()
            ordered = sorted((r for r in body["replicas"] if r["role"] == "replica"),
                             key=lambda r: (r["settled_at"], regions.index(r["region"])))
            if ordered[0]["settled_at"] != ordered[1]["settled_at"]:
                assert sorted(fills, key=fills.get) == [r["region"] for r in ordered]
            assert len(set(fills.values())) == 2
            for replica in ordered:
                numeral = f"{count(replica['settle_ms'])} ms"
                wait_ui(page, lambda n=numeral, r=replica["region"]: wake_state(page, regions)[0][r]["numeral"] == n)
                assert f"{REGION_NAMES[replica['region']]}: settled in {numeral}" in wake_state(page, regions)[1]
            assert status_text(page, "Release readiness") == ready_copy(3, body["version_id"][:8])


def test_wf_replica_wake_status_list_and_announcements(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    regions = ["cascade", "pampas"]
    bucket = make_bucket(theo, "lanternfish", regions)
    with regions_offline(base, "pampas") as ops:
        stored(theo, "lanternfish", bucket, "status.bin", b"status one")
        wait_replica(theo, "lanternfish", bucket, "status.bin", "pampas", "failed")
        with app_page(browser, base + f"/console/lanternfish/{bucket}?object=status.bin") as page:
            ui_sign_in(page, THEO)
            wait_ui(page, lambda: wake_state(page, regions)[1] == [f"{CASCADE}: origin, settled", f"{PAMPAS}: failed"])
            assert wake_state(page, regions)[0]["pampas"]["state"] == "failed"
            announcements = page.get_by_role("status", name="Replica announcements")
            count_texts(page, announcements)
            click(page.get_by_role("button", name=f"Retry {PAMPAS}"))
            wait_ui(page, lambda: wake_state(page, regions)[1][-1] == f"{PAMPAS}: pending"
                    and wake_state(page, regions)[0]["pampas"]["state"] == "pending")
            wait_ui(page, lambda: wake_state(page, regions)[1][-1] == f"{PAMPAS}: failed"
                    and wake_state(page, regions)[0]["pampas"]["state"] == "failed", seconds=SETTLE_S + UI_WAIT_S)
            newer = stored(theo, "lanternfish", bucket, "status.bin", b"status two")
            reset = f"New version {newer['version_id'][:8]}. Copies pending in {region_words(1)}."
            wait_ui(page, lambda: reset in seen_texts(announcements))
            wait_replica(theo, "lanternfish", bucket, "status.bin", "pampas", "failed")
            wait_ui(page, lambda: wake_state(page, regions)[1][-1] == f"{PAMPAS}: failed"
                    and wake_state(page, regions)[0]["pampas"]["state"] == "failed")
            assert ops.post(region_path("pampas"), {"state": "online"}).status_code == 200
            settled = wait_replica(theo, "lanternfish", bucket, "status.bin", "pampas", "settled", seconds=SETTLE_S + GRACE_S)
            final = f"{count(settled['settle_ms'])} ms"
            wait_ui(page, lambda: f"{PAMPAS} settled in {final}" in seen_texts(announcements)
                    and wake_state(page, regions)[1][-1] == f"{PAMPAS}: settled in {final}"
                    and wake_state(page, regions)[0]["pampas"]["state"] == "settled")
            assert in_order(seen_texts(announcements), [f"{PAMPAS} retrying", f"{PAMPAS} failed", reset,
                                                        f"{PAMPAS} settled in {final}"])


def test_replica_wake_reduced_motion(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    regions = ["cascade", "pampas"]
    bucket = make_bucket(theo, "lanternfish", regions)
    with regions_offline(base, "pampas"):
        stored(theo, "lanternfish", bucket, "calm.bin", b"calm")
        wait_replica(theo, "lanternfish", bucket, "calm.bin", "pampas", "failed")
        with app_page(browser, base + f"/console/lanternfish/{bucket}?object=calm.bin", reduced_motion="reduce") as page:
            ui_sign_in(page, THEO)
            wait_ui(page, lambda: f"{PAMPAS}: failed" in wake_state(page, regions)[1])
            sign_in(base, OPERATOR).post(region_path("pampas"), {"state": "online"})
            settled = wait_replica(theo, "lanternfish", bucket, "calm.bin", "pampas", "settled", seconds=SETTLE_S + GRACE_S)
            final = f"{count(settled['settle_ms'])} ms"
            deadline = time.monotonic() + UI_WAIT_S
            while time.monotonic() < deadline:
                advance(page, STEP_MS / 4)
                pins, items, announced = wake_state(page, regions)
                if pins["pampas"]["state"] == "settled":
                    assert pins["pampas"]["progress"] == "1.00" and pins["pampas"]["numeral"] == final
                    assert f"{PAMPAS}: settled in {final}" in items and announced == f"{PAMPAS} settled in {final}"
                    return
            raise AssertionError("settle never shown")


LIFECYCLE_BAD = [("noncurrent_days", 0, "Expire noncurrent versions after 1 to 3,650 days, or leave it off."),
                 ("noncurrent_days", NONCURRENT_DAYS_MAX + 1, "Expire noncurrent versions after 1 to 3,650 days, or leave it off."),
                 ("keep_newest_noncurrent", -1, "Keep 0 to 100 newest noncurrent versions."),
                 ("keep_newest_noncurrent", KEEP_MAX + 1, "Keep 0 to 100 newest noncurrent versions."),
                 ("abort_multipart_days", 0, "Abort incomplete uploads after 1 to 365 days, or leave it off."),
                 ("abort_multipart_days", ABORT_DAYS_MAX + 1, "Abort incomplete uploads after 1 to 365 days, or leave it off.")]


def test_wf_lifecycle_retention_rules(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, priya = sign_in(base, THEO), sign_in(base, PRIYA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    path = f"/api/w/{LF}/buckets/{bucket}/lifecycle"
    initial = priya.get(path).json()
    assert (initial["noncurrent_days"], initial["keep_newest_noncurrent"], initial["abort_multipart_days"]) == (None, 0, None)
    valid = {"noncurrent_days": NONCURRENT_DAYS_MAX, "keep_newest_noncurrent": KEEP_MAX, "abort_multipart_days": ABORT_DAYS_MAX}
    assert_error(priya.put(path, valid), 403, "forbidden")
    for field, value, message in LIFECYCLE_BAD:
        assert_error(theo.put(path, {**valid, field: value}), 422, "validation_failed", field, message)
    assert theo.get(path).json()["noncurrent_days"] is None
    assert theo.put(path, valid).json()["noncurrent_days"] == NONCURRENT_DAYS_MAX
    with app_page(browser, base + f"/console/lanternfish/{bucket}") as page:
        ui_sign_in(page, THEO)
        opener = page.get_by_role("button", name="Lifecycle rules")
        wait_ui(page, opener.is_visible)
        click(opener)
        dialog = page.get_by_role("dialog", name="Lifecycle rules")
        spins = [dialog.get_by_role("spinbutton", name=n) for n in ("Expire noncurrent versions after (days)",
                                                                     "Keep newest noncurrent versions",
                                                                     "Abort incomplete uploads after (days)")]
        wait_ui(page, spins[0].is_visible)
        assert [s.input_value() for s in spins] == [str(NONCURRENT_DAYS_MAX), str(KEEP_MAX), str(ABORT_DAYS_MAX)]
        fill(spins[0], "0")
        click(dialog.get_by_role("button", name="Save rules"))
        wait_ui(page, lambda: status_text(page, "Lifecycle status") == "Rules not saved. Fix the highlighted fields.")
        for spin in spins:
            fill(spin, "1")
        click(dialog.get_by_role("button", name="Save rules"))
        wait_ui(page, lambda: status_text(page, "Lifecycle status") == f"Lifecycle rules saved for {bucket}.")
    saved = theo.get(path).json()
    assert (saved["noncurrent_days"], saved["keep_newest_noncurrent"], saved["abort_multipart_days"]) == (1, 1, 1)


def test_wf_lifecycle_retention_noncurrent_expiry(app_url: str) -> None:
    base = env_url("APP_SHORT_URL")
    theo, mara, ops = sign_in(base, THEO), sign_in(base, MARA), sign_in(base, OPERATOR)
    observer = S3("-short-timers")
    bucket = make_bucket(theo, "lanternfish", ["cascade", "pampas"])
    region = "pampas"
    ops.post(region_path(region), {"state": "offline"})
    try:
        assert theo.put(f"/api/w/{LF}/buckets/{bucket}/lifecycle", {"noncurrent_days": 1, "keep_newest_noncurrent": 1,
                                                                           "abort_multipart_days": None}).status_code == 200
        made = [stored(theo, "lanternfish", bucket, "manifest.json", f"v{i}".encode()) for i in range(1, 5)]
        v1, v2, v3, v4 = (m["version_id"] for m in made)
        link = mint_link(theo, "lanternfish", bucket, "manifest.json", version=v1)
        assert mara.put(f"/api/w/{LF}/buckets/{bucket}/object/legal-hold", {"on": True},
                        params={"key": "manifest.json", "version": v2}).status_code == 200
        due = parse_iso(next(v for v in versions_of(theo, "lanternfish", bucket, "manifest.json")
                             if v["version_id"] == v1)["noncurrent_since"]) + timedelta(seconds=SHORT_DAY_S)

        def expired() -> bool:
            r = theo.get(f"/api/w/{LF}/buckets/{bucket}/object/versions", params={"key": "manifest.json"})
            present = v1 in [v["version_id"] for v in r.json()["versions"]]
            if date_of(r) < due:
                assert present
            return not present

        poll(expired, SHORT_DAY_S * 3 + GRACE_S, "v1 expiry")
        assert_error(content(theo, "lanternfish", bucket, "manifest.json", v1), 404, "not_found")
        assert_error(replicas_of(theo, "lanternfish", bucket, "manifest.json", v1), 404, "not_found")
        assert_error(httpx.get(link["url"], timeout=HTTP_TIMEOUT), 410, "link_revoked")
        poll(lambda: minio_copies(observer, bucket, v1) == [], WAIT_S, "v1 bytes removed")
        run = ops.post("/api/ops/lifecycle/run").json()
        assert run["skipped_locked"] >= 1
        ids = [v["version_id"] for v in versions_of(theo, "lanternfish", bucket, "manifest.json")]
        assert ids == [v4, v3, v2]
        assert bucket_info(theo, "lanternfish", bucket)["stored_bytes"] == sum(m["size"] for m in made[1:]) * 2
        ops.post(region_path(region), {"state": "online"})
        ops.post("/api/ops/lifecycle/run")
        assert v1 not in [v["version_id"] for v in versions_of(theo, "lanternfish", bucket, "manifest.json")]
        assert f"regions/{region}/{bucket}/{v1}" not in observer.keys(f"regions/{region}/{bucket}/")
        assert mara.put(f"/api/w/{LF}/buckets/{bucket}/object/legal-hold", {"on": False},
                        params={"key": "manifest.json", "version": v2}).status_code == 200
        poll(lambda: v2 not in [v["version_id"] for v in versions_of(theo, "lanternfish", bucket, "manifest.json")],
             SHORT_DAY_S * 3, "v2 expiry after release")
    finally:
        ops.post(region_path(region), {"state": "online"})


def test_lifecycle_aborts_incomplete_uploads(app_url: str) -> None:
    base = env_url("APP_SHORT_URL")
    ada = sign_in(base, ADA)
    bucket = make_bucket(ada, "tidepool", ["cascade"])
    assert ada.put(f"/api/w/{TP}/buckets/{bucket}/lifecycle", {"noncurrent_days": None, "keep_newest_noncurrent": 0,
                                                                   "abort_multipart_days": 1}).status_code == 200
    key = make_key(ada, "tidepool", buckets=[bucket])
    cred = cred_of(key)
    upload_id = multipart_start(base, cred, bucket, "stale.bin")
    before = ada.get(f"/api/w/{TP}/usage").json()["reserved_bytes"]
    r = part(base, cred, bucket, "stale.bin", upload_id, 1, b"\0" * (DEFAULT_PAGE * 10))
    assert r.status_code == 200
    assert ada.get(f"/api/w/{TP}/usage").json()["reserved_bytes"] == before + DEFAULT_PAGE * 10
    observer = S3("-short-timers")
    assert observer.keys(f"uploads/{upload_id}/")
    poll(lambda: observer.keys(f"uploads/{upload_id}/") == [], SHORT_DAY_S * 3 + GRACE_S, "parts removed")
    assert ada.get(f"/api/w/{TP}/usage").json()["reserved_bytes"] == before
    assert_s3_error(part(base, cred, bucket, "stale.bin", upload_id, 2, b"x"), 404, "NoSuchUpload")
    assert_s3_error(complete(base, cred, bucket, "stale.bin", upload_id, complete_xml([(1, r.headers["etag"])])), 404, "NoSuchUpload")
    assert_s3_error(s3(base, cred, "DELETE", bucket, "stale.bin", query={"uploadId": upload_id}), 404, "NoSuchUpload")


def test_wf_lifecycle_retention_locks(app_url: str) -> None:
    base = env_url("APP_SHORT_URL")
    theo, mara, priya = sign_in(base, THEO), sign_in(base, MARA), sign_in(base, PRIYA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    made = [stored(theo, "lanternfish", bucket, "r.bin", f"r{i}".encode()) for i in range(3)]
    v0, v1 = made[0]["version_id"], made[1]["version_id"]
    w = f"/api/w/{LF}/buckets/{bucket}/object"
    now = server_now(base)
    retain = now + timedelta(seconds=SHORT_DAY_S * 5)
    p0 = {"key": "r.bin", "version": v0}
    assert theo.put(f"{w}/retention", {"retain_until": iso(retain)}, params=p0).json()["locked"] is True
    p1 = {"key": "r.bin", "version": v1}
    assert mara.put(f"{w}/legal-hold", {"on": True}, params=p1).json()["legal_hold"] is True
    body = assert_error(theo.delete(f"{w}/version", params=p1), 409, "object_locked")
    assert body["legal_hold"] is True and "retain_until" in body
    r = s3(base, cred_of(key), "DELETE", bucket, "r.bin", query={"versionId": v1})
    assert assert_s3_error(r, 403, "AccessDenied").findtext("Message") == LOCK_MESSAGE
    result = parse_xml(delete_objects(base, cred_of(key), bucket, [("r.bin", v0)]).content)
    assert result.find("Error").findtext("Code") == "AccessDenied"
    current = made[2]["version_id"]
    assert_error(theo.delete(f"{w}/version", params={"key": "r.bin", "version": current}), 409, "invalid_transition")
    stored(theo, "lanternfish", bucket, "r.bin", b"overwrite allowed")
    batch = theo.post(f"/api/w/{LF}/buckets/{bucket}/objects/delete", {"keys": ["r.bin"]}).json()
    assert theo.post(f"/api/w/{LF}/batches/{batch['batch_id']}/undo").status_code == 200
    assert theo.delete(w, params={"key": "r.bin"}).status_code == 204

    def unlocked() -> bool:
        r = theo.delete(f"{w}/version", params=p0)
        if r.status_code == 409:
            assert date_of(r) <= retain
            return False
        assert r.status_code == 204 and date_of(r) >= retain
        return True

    poll(unlocked, SHORT_DAY_S * 8 + GRACE_S, "retention lapse")
    assert_error(theo.put(f"{w}/retention", {"retain_until": iso(retain + timedelta(hours=1))}, params=p0), 404, "not_found")
    assert mara.put(f"{w}/legal-hold", {"on": False}, params=p1).status_code == 200
    assert theo.delete(f"{w}/version", params=p1).status_code == 204
    drop_key(mara, "lanternfish", key["key_id"])


def test_retention_and_legal_hold_rules(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara, priya = sign_in(base, THEO), sign_in(base, MARA), sign_in(base, PRIYA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    old = stored(theo, "lanternfish", bucket, "dispute.bin", b"disputed one")
    stored(theo, "lanternfish", bucket, "dispute.bin", b"disputed two")
    w = f"/api/w/{LF}/buckets/{bucket}/object"
    params = {"key": "dispute.bin", "version": old["version_id"]}
    now = server_now(base)
    retain = now + timedelta(hours=1)
    assert_error(priya.put(f"{w}/retention", {"retain_until": iso(retain)}, params=params), 403, "forbidden")
    for bad in (now - timedelta(hours=1), now + timedelta(days=RETENTION_MAX_DAYS, hours=1)):
        assert_error(theo.put(f"{w}/retention", {"retain_until": iso(bad)}, params=params), 422, "validation_failed",
                     "retain_until", RETAIN_RULE)
    unset = next(v for v in versions_of(theo, "lanternfish", bucket, "dispute.bin") if v["version_id"] == old["version_id"])
    assert unset["retain_until"] is None
    first = theo.put(f"{w}/retention", {"retain_until": iso(retain - timedelta(seconds=1))}, params=params)
    assert first.status_code == 200 and first.json()["locked"] is True
    assert_error(theo.put(f"{w}/retention", {"retain_until": iso(retain - timedelta(seconds=2))}, params=params), 409,
                 "retention_locked")
    extended = mara.put(f"{w}/retention", {"retain_until": iso(retain)}, params=params)
    assert extended.status_code == 200 and extended.json()["retain_until"] == iso(retain)
    same = theo.put(f"{w}/retention", {"retain_until": iso(retain)}, params=params)
    assert same.status_code == 200 and same.json()["retain_until"] == iso(retain)
    row = next(v for v in versions_of(theo, "lanternfish", bucket, "dispute.bin") if v["version_id"] == old["version_id"])
    assert row["retain_until"] == iso(retain) and row["legal_hold"] is False
    hold = f"{w}/legal-hold"
    assert_error(theo.put(hold, {"on": True}, params=params), 403, "forbidden")
    assert_error(mara.put(hold, {"on": "yes"}, params=params), 422, "validation_failed", "on", "Choose on or off.")
    on = mara.put(hold, {"on": True}, params=params)
    assert on.status_code == 200 and on.json()["legal_hold"] is True and on.json()["locked"] is True
    assert mara.put(hold, {"on": True}, params=params).json()["legal_hold"] is True
    off = mara.put(hold, {"on": False}, params=params)
    assert off.status_code == 200 and off.json()["legal_hold"] is False and off.json()["locked"] is True
    row = next(v for v in versions_of(theo, "lanternfish", bucket, "dispute.bin") if v["version_id"] == old["version_id"])
    assert row["legal_hold"] is False


def test_wf_lifecycle_retention_dialog_survives_polling(browser: Any, app_url: str) -> None:
    base = env_url("APP_SHORT_URL")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "pampas"])
    with regions_offline(base, "pampas"):
        old = stored(theo, "lanternfish", bucket, "d.bin", b"old")
        stored(theo, "lanternfish", bucket, "d.bin", b"new")
        short = old["version_id"][:8]
        with app_page(browser, base + f"/console/lanternfish/{bucket}?object=d.bin") as page:
            ui_sign_in(page, THEO)
            opener = page.get_by_role("button", name=f"Retention for {short}")
            wait_ui(page, opener.is_visible)
            click(opener)
            dialog = page.get_by_role("dialog", name="Retention")
            box = dialog.get_by_role("textbox", name="Retain until (UTC)")
            wait_ui(page, box.is_visible)
            typed = (server_now(base) + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M")
            box.press_sequentially(typed)
            advance(page, OPS_REREAD_MS * 2)
            assert box.input_value() == typed and is_focused(box) and box.evaluate("e => e.selectionStart") == len(typed)
            page.keyboard.press("Escape")
            wait_ui(page, lambda: not box.is_visible())
            assert is_focused(page.get_by_role("button", name=f"Retention for {short}"))
            click(page.get_by_role("button", name=f"Retention for {short}"))
            wait_ui(page, box.is_visible)
            fill(box, typed + ":00")
            click(dialog.get_by_role("button", name="Save retention"))
            wait_ui(page, lambda: fits(f"Version {short} held until <time>.", status_text(page, "Version status")))
    held_version = next(v for v in versions_of(theo, "lanternfish", bucket, "d.bin") if v["version_id"] == old["version_id"])
    assert held_version["retain_until"] == typed.replace(" ", "T") + ":00Z"


def test_wf_webhooks_endpoints_ui(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    mara = sign_in(base, MARA)
    bucket = make_bucket(sign_in(base, THEO), "lanternfish", ["cascade"])
    url = f"http://127.0.0.1:9/{uuid.uuid4().hex[:8]}"
    extra: list[str] = []
    try:
        with app_page(browser, base + "/console/lanternfish") as page:
            ui_sign_in(page, MARA)
            nav_to(page, "Webhooks")
            click(page.get_by_role("button", name="Add endpoint"))
            dialog = page.get_by_role("dialog", name="Add webhook endpoint")
            wait_ui(page, dialog.is_visible)
            fill(dialog.get_by_role("textbox", name="Endpoint URL"), url)
            check(dialog.get_by_role("group", name="Events").get_by_role("checkbox", name="object.created"))
            check(dialog.get_by_role("group", name="Buckets").get_by_role("checkbox", name=bucket))
            fill(dialog.get_by_role("textbox", name="Description"), "build bot")
            click(dialog.get_by_role("button", name="Create endpoint"))
            secret_box = dialog.get_by_role("textbox", name="Signing secret")
            wait_ui(page, secret_box.is_visible)
            secret = secret_box.input_value()
            assert WHSEC_RE.match(secret)
            assert status_text(page, "Webhook status") == "Endpoint added. Copy the signing secret now; Farshore won't show it again."
            page.keyboard.press("Escape")
            wait_ui(page, lambda: not dialog.is_visible())
            assert secret not in page.content()
            row = page.get_by_role("table", name="Webhook endpoints").get_by_role("row").filter(has_text=url)
            wait_ui(page, row.is_visible)
            assert row.get_by_role("link", name=f"Deliveries for {url}").is_visible()
            for button, copy in (("Disable endpoint", "Endpoint disabled. New events are not queued for it."),
                                 ("Enable endpoint", "Endpoint enabled."),
                                 ("Disable endpoint", "Endpoint disabled. New events are not queued for it."),
                                 ("Delete endpoint", "Endpoint deleted.")):
                click(row.get_by_role("button", name=button))
                wait_ui(page, lambda c=copy: status_text(page, "Webhook status") == c)
        listed = mara.get(f"/api/w/{LF}/webhooks")
        assert secret not in listed.text and url not in listed.text
        assert db_mentions(Postgres(), secret) == []
        for field, body in (("url", {"url": "http://user:pw@127.0.0.1/x"}), ("events", {"events": []}),
                            ("description", {"description": "d" * (DESCRIPTION_MAX + 1)}), ("buckets", {"buckets": [fresh_bucket()]})):
            payload = {"url": url, "events": ["object.created"], "buckets": None, "description": "", **body}
            assert_error(mara.post(f"/api/w/{LF}/webhooks", payload), 422, "validation_failed", field)
        existing = len(mara.get(f"/api/w/{LF}/webhooks").json()["endpoints"])
        for _ in range(ENDPOINT_LIMIT - existing):
            r = mara.post(f"/api/w/{LF}/webhooks", {"url": url, "events": ["object.deleted"], "buckets": None, "description": ""})
            assert r.status_code == 201
            extra.append(r.json()["id"])
        r = mara.post(f"/api/w/{LF}/webhooks", {"url": url, "events": ["object.deleted"], "buckets": None, "description": ""})
        assert_error(r, 409, "endpoint_limit")
        if extra:
            assert_error(mara.delete(f"/api/w/{LF}/webhooks/{extra[0]}"), 409, "invalid_transition")
            assert_error(mara.post(f"/api/w/{LF}/webhooks/{extra[0]}/enable"), 409, "invalid_transition")
    finally:
        for endpoint_id in extra:
            drop_endpoint(mara, "lanternfish", endpoint_id)


EVENT_FIELDS = {"id", "type", "sequence", "occurred_at", "bucket", "key", "version_id", "etag", "size"}


def test_wf_webhooks_signed_ordered_delivery(app_url: str, mail: Any) -> None:
    base = env_url("APP_SHORT_URL")
    mara, theo = sign_in(base, MARA), sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian"])
    bot, other = Sink(), Sink()
    bot.failing.add(1)
    subject = f"Webhook delivery failed in {WS_NAMES[LF]}"
    mails_before = len(mails(mail, MARA, subject))
    endpoints = []
    try:
        for sink in (bot, other):
            r = mara.post(f"/api/w/{LF}/webhooks", {"url": sink.url, "events": ["object.created"], "buckets": [bucket],
                                                          "description": ""})
            assert r.status_code == 201
            endpoints.append(r.json())
        uploaded_at = time.monotonic()
        for i in range(1, 4):
            stored(theo, "lanternfish", bucket, f"builds/b{i}.bin", f"build {i}".encode(),
                   headers={"x-amz-meta-uploader": "theo-ci", "x-amz-tagging": "env=ci"})
        poll(lambda: len(other.records) == 3, FIRST_ATTEMPT_S * 3 + GRACE_S, "other endpoint deliveries")
        assert len(bot.of(2)) == 0
        poll(lambda: len(bot.of(3)) == 1, LONG_WAIT_S, "bot dead letter then later sequences")
        first = bot.of(1)
        assert len(first) == WEBHOOK_ATTEMPTS
        assert max(r["at"] for r in first) < bot.of(2)[0]["at"] < bot.of(3)[0]["at"]
        for k in range(1, WEBHOOK_ATTEMPTS):
            gap = first[k]["at"] - first[k - 1]["at"]
            low = SHORT_BACKOFF_S * 2 ** (k - 1)
            assert low - POLL_S <= gap <= low + BACKOFF_SLACK_S + GRACE_S, (k, gap)
        assert [r["headers"]["farshore-delivery-attempt"] for r in first] == [str(k) for k in range(1, WEBHOOK_ATTEMPTS + 1)]
        assert len({r["raw"] for r in first}) == 1 and len({r["headers"]["farshore-event-id"] for r in first}) == 1
        assert first[0]["headers"]["farshore-event-id"] == other.of(1)[0]["headers"]["farshore-event-id"]
        deliveries = mara.get(f"/api/w/{LF}/webhooks/{endpoints[0]['id']}/deliveries").json()["deliveries"]
        dead = next(d for d in deliveries if d["sequence"] == 1)
        assert dead["state"] == "dead" and dead["attempts"] == WEBHOOK_ATTEMPTS and dead["last_error"] == "http_status"
        found = poll(lambda: len(mails(mail, MARA, subject)) == mails_before + 1 and mails(mail, MARA, subject), WAIT_S, "dead email")
        body = text(found[-1])
        assert urlparse(bot.url).hostname in body and "object.created" in body and str(WEBHOOK_ATTEMPTS) in body
        assert endpoints[0]["secret"] not in body and json.loads(first[0]["raw"])["key"] not in body
        bot.failing.clear()
        r = mara.post(f"/api/w/{LF}/webhooks/{endpoints[0]['id']}/deliveries/{dead['id']}/redeliver")
        assert r.status_code == 202 and r.json()["state"] == "pending"
        poll(lambda: len(bot.of(1)) == WEBHOOK_ATTEMPTS + 1, WAIT_S, "redelivery")
        assert bot.of(1)[-1]["at"] > bot.of(3)[0]["at"] and bot.of(1)[-1]["headers"]["farshore-delivery-attempt"] == "1"
        delivered = next(d for d in mara.get(f"/api/w/{LF}/webhooks/{endpoints[0]['id']}/deliveries").json()["deliveries"]
                         if d["sequence"] == 2)
        assert_error(mara.post(f"/api/w/{LF}/webhooks/{endpoints[0]['id']}/deliveries/{delivered['id']}/redeliver"),
                     409, "invalid_transition")
    finally:
        for endpoint in endpoints:
            drop_endpoint(mara, "lanternfish", endpoint["id"])
        bot.close()
        other.close()


def test_wf_webhooks_signed_events_per_endpoint(app_url: str) -> None:
    base = app_url.rstrip("/")
    mara, theo = sign_in(base, MARA), sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian"])
    stuck, bot = Sink(), Sink()
    stuck.failing.update({1, 2, 3})
    endpoints = []
    try:
        for sink in (stuck, bot):
            r = mara.post(f"/api/w/{LF}/webhooks", {"url": sink.url, "events": ["object.created"], "buckets": [bucket],
                                                          "description": ""})
            assert r.status_code == 201
            endpoints.append(r.json())
        uploaded_at = time.monotonic()
        made = [stored(theo, "lanternfish", bucket, f"builds/b{i}.bin", f"build {i}".encode(),
                       headers={"x-amz-meta-uploader": "theo-ci", "x-amz-tagging": "env=ci"}) for i in range(1, 4)]
        poll(lambda: len(bot.records) == 3, FIRST_ATTEMPT_S * 3 + GRACE_S, "bot deliveries")
        poll(lambda: stuck.of(1), FIRST_ATTEMPT_S + GRACE_S, "stuck first attempt")
        assert bot.of(1)[0]["at"] - uploaded_at <= FIRST_ATTEMPT_S + GRACE_S
        events = [json.loads(r["raw"]) for r in bot.records]
        assert [e["sequence"] for e in events] == [1, 2, 3]
        for event, item in zip(events, made):
            assert set(event) == EVENT_FIELDS and event["type"] == "object.created"
            assert (event["bucket"], event["key"], event["version_id"], event["etag"], event["size"]) == \
                (bucket, item["key"], item["version_id"], item["etag"], item["size"])
        assert stuck.of(2) == [] and stuck.of(3) == []
        assert stuck.of(1)[0]["headers"]["farshore-event-id"] == bot.of(1)[0]["headers"]["farshore-event-id"]
        for sink, endpoint in ((stuck, endpoints[0]), (bot, endpoints[1])):
            for record in sink.records:
                assert verify_signature(record, endpoint["secret"])
                assert record["headers"]["content-type"].startswith("application/json")
                assert record["headers"]["farshore-event-type"] == "object.created"
                for word in (b"lanternfish", b"theo", b"cascade", b"meridian", b"uploader", b"env=ci"):
                    assert word not in record["raw"]
    finally:
        for endpoint in endpoints:
            drop_endpoint(mara, "lanternfish", endpoint["id"])
        stuck.close()
        bot.close()


def test_wf_bulk_delete_undo_ui(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian"])
    keys = [f"season-1/replays/r-{i}.bin" for i in range(1, 4)]
    originals = {k: stored(theo, "lanternfish", bucket, k, k.encode()) for k in keys}
    before = bucket_info(theo, "lanternfish", bucket)
    with app_page(browser, base + f"/console/lanternfish/{bucket}?prefix=" + quote("season-1/replays/", safe="")) as page:
        ui_sign_in(page, THEO)
        for k in keys:
            box = page.get_by_role("checkbox", name=f"Select {k}")
            wait_ui(page, box.is_visible)
            check(box)
        click(page.get_by_role("button", name="Delete selected"))
        dialog = page.get_by_role("dialog", name="Delete objects")
        wait_ui(page, dialog.is_visible)
        for k in keys:
            assert k in dialog.inner_text()
        click(dialog.get_by_role("button", name="Delete objects"))
        results = page.get_by_role("list", name="Delete results").get_by_role("listitem")
        wait_ui(page, lambda: sorted(t.strip() for t in results.all_inner_texts()) == sorted(f"{k}: deleted" for k in keys))
        deleted_line = status_text(page, "Delete status")
        assert fits(deleted_copy(3, 0), deleted_line) and re.search(TIME_RE, deleted_line)
        assert page.get_by_role("button", name=f"Open {keys[0]}").count() == 0
        newer = stored(theo, "lanternfish", bucket, keys[2], b"re-uploaded by CI")
        click(page.get_by_role("button", name="Undo delete"))
        expected = sorted([f"{keys[0]}: restored", f"{keys[1]}: restored", f"{keys[2]}: kept newer version"])
        wait_ui(page, lambda: sorted(t.strip() for t in results.all_inner_texts()) == expected)
        assert status_text(page, "Delete status") == restored_copy(2, 1, 0)
        wait_ui(page, lambda: page.get_by_role("button", name="Undo delete").count() == 0)
    for k in keys[:2]:
        current = next(v for v in versions_of(theo, "lanternfish", bucket, k) if v["current"])
        assert (current["version_id"], current["etag"]) == (originals[k]["version_id"], originals[k]["etag"])
        wait_settled(theo, "lanternfish", bucket, k)
    assert next(v for v in versions_of(theo, "lanternfish", bucket, keys[2]) if v["current"])["version_id"] == newer["version_id"]
    after = bucket_info(theo, "lanternfish", bucket)
    assert after["object_count"] == before["object_count"]
    assert after["stored_bytes"] == before["stored_bytes"] + newer["size"] * 2


def test_wf_bulk_delete_api_window_and_replay(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    path = f"/api/w/{LF}/buckets/{bucket}/objects/delete"
    for k in ("a", "b", "c"):
        stored(theo, "lanternfish", bucket, k, k.encode())
    for keys in ([], ["a", "a"], [f"k{i}" for i in range(BULK_KEYS_MAX + 1)], ["a/../b"]):
        assert_error(theo.post(path, {"keys": keys}), 422, "validation_failed", "keys")
    idem = {"Idempotency-Key": "bulk-" + uuid.uuid4().hex}
    first = theo.post(path, {"keys": ["a", "b", "missing"]}, headers=idem)
    replay = theo.post(path, {"keys": ["a", "b", "missing"]}, headers=idem)
    assert first.status_code == replay.status_code == 200 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replayed") == "true"
    assert [r["outcome"] for r in first.json()["results"]] == ["deleted", "deleted", "not_found"]
    assert_error(theo.post(path, {"keys": ["c"]}, headers=idem), 409, "idempotency_key_reused")
    assert bucket_info(theo, "lanternfish", bucket)["object_count"] == 1
    empty = theo.post(path, {"keys": ["missing"]}).json()
    assert empty["batch_id"] is None and empty["undo_until"] is None
    removed = first.json()["results"][1]["version_id"]
    theo.delete(f"/api/w/{LF}/buckets/{bucket}/object/version", params={"key": "b", "version": removed})
    batch = first.json()["batch_id"]
    undoers = [sign_in(base, THEO) for _ in range(3)]
    results = together([lambda u=u: u.post(f"/api/w/{LF}/batches/{batch}/undo") for u in undoers])
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    winner = next(r for r in results if r.status_code == 200).json()
    assert [r["outcome"] for r in winner["results"]] == ["restored", "gone"]
    loser = assert_error(next(r for r in results if r.status_code == 409), 409, "invalid_transition")
    assert (loser["from"], loser["to"]) == ("undone", "undone")
    late = theo.post(path, {"keys": ["c"]}).json()
    until = parse_iso(late["undo_until"])
    poll(lambda: server_now(base) >= until, UNDO_S + GRACE_S * 2, "undo window close")
    assert_error(theo.post(f"/api/w/{LF}/batches/{late['batch_id']}/undo"), 410, "undo_expired")
    assert bucket_info(theo, "lanternfish", bucket)["object_count"] == 1


def test_wf_bulk_delete_s3_delete_objects(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    cred = cred_of(key)
    old = stored(theo, "lanternfish", bucket, "n.bin", b"noncurrent")
    cur = stored(theo, "lanternfish", bucket, "n.bin", b"current one")
    held_v = stored(theo, "lanternfish", bucket, "h.bin", b"held")
    stored(theo, "lanternfish", bucket, "h.bin", b"held two")
    stored(theo, "lanternfish", bucket, "p.bin", b"plain")
    mara.put(f"/api/w/{LF}/buckets/{bucket}/object/legal-hold", {"on": True},
             params={"key": "h.bin", "version": held_v["version_id"]})
    before, units_before = bucket_info(theo, "lanternfish", bucket), units(mara, "lanternfish", bucket)
    entries = [("p.bin", None), ("ghost.bin", None), ("a/../b", None), ("n.bin", cur["version_id"]),
               ("h.bin", held_v["version_id"]), ("n.bin", "unknown-version"), ("n.bin", old["version_id"]), ("p.bin", None)]
    root = parse_xml(delete_objects(base, cred, bucket, entries).content)
    outcomes = [(e.tag, e.findtext("Key"), e.findtext("Code")) for e in root]
    assert outcomes == [("Deleted", "p.bin", None), ("Deleted", "ghost.bin", None), ("Error", "a/../b", "InvalidArgument"),
                        ("Error", "n.bin", "InvalidArgument"), ("Error", "h.bin", "AccessDenied"),
                        ("Deleted", "n.bin", None), ("Deleted", "n.bin", None)]
    assert root[6].findtext("VersionId") == old["version_id"]
    after = bucket_info(theo, "lanternfish", bucket)
    assert after["object_count"] == before["object_count"] - 1
    assert after["stored_bytes"] == before["stored_bytes"] - old["size"] * 2
    assert units(mara, "lanternfish", bucket) - units_before == 2
    quiet = parse_xml(delete_objects(base, cred, bucket, [("ghost.bin", None), ("a/../b", None)], quiet=True).content)
    assert [e.tag for e in quiet] == ["Error"]
    scoped = make_key(mara, "lanternfish", buckets=[bucket], prefix="keep/")
    stored(theo, "lanternfish", bucket, "keep/x.bin", b"x")
    root = parse_xml(delete_objects(base, cred_of(scoped), bucket, [("keep/x.bin", None), ("h.bin", None)]).content)
    assert [(e.tag, e.findtext("Code")) for e in root] == [("Deleted", None), ("Error", "AccessDenied")]
    for count_entries in (0, BULK_KEYS_MAX + 1):
        assert_s3_error(delete_objects(base, cred, bucket, [(f"k{i}", None) for i in range(count_entries)]), 400, "MalformedXML")
    padded = b"<Delete><Object><Key>k</Key></Object><!--" + b"x" * DELETE_OBJECTS_BODY_MAX + b"--></Delete>"
    assert_s3_error(s3(base, cred, "POST", bucket, query={"delete": ""}, body=padded), 413, "EntityTooLarge")
    bad_md5 = s3(base, cred, "POST", bucket, query={"delete": ""}, body=b"<Delete><Object><Key>k</Key></Object></Delete>",
                 headers={"content-md5": b64(hashlib.md5(b"other").digest())})
    assert_s3_error(bad_md5, 400, "BadDigest")
    mara.put(f"/api/w/{LF}/buckets/{bucket}/object/legal-hold", {"on": False},
             params={"key": "h.bin", "version": held_v["version_id"]})
    drop_key(mara, "lanternfish", key["key_id"])
    drop_key(mara, "lanternfish", scoped["key_id"])


def test_wf_two_step_sessions_jun_deep_link(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    landing = f"/console/{PK}/paperkite-replays"
    target = landing + "?object=" + quote("season-1/manifest.json", safe="")
    with app_page(browser, base + target) as page:
        wait_ui(page, lambda: path_of(page) == "/signin")
        ui_sign_in(page, JUN)
        heading = page.get_by_role("heading", name="Enter the code from your authenticator app")
        wait_ui(page, heading.is_visible)
        assert "Codes change every 30 seconds." in body_text(page)
        pending = session_cookie(page)
        probe = Api(base, cookie=pending)
        for path in (f"/api/w/{PK}/buckets", "/api/me", "/api/me/sessions", "/api/ops/regions"):
            body = assert_error(probe.get(path), 401, "two_step_required")
            assert body["message"] == TWO_STEP_MESSAGE
        for path in ("/account", "/ops", target):
            page.goto(base + path)
            wait_ui(page, lambda: path_of(page) == "/signin" and heading.is_visible(), what=f"{path} redirect")
        fill(page.get_by_role("textbox", name="Authenticator code"), totp(JUN_SECRET, 0))
        click(page.get_by_role("button", name="Verify"))
        wait_ui(page, lambda: page.get_by_role("alert").inner_text().strip() == "That code didn't work.")
        code = next_code(JUN_SECRET)
        fill(page.get_by_role("textbox", name="Authenticator code"), code)
        click(page.get_by_role("button", name="Verify"))
        wait_ui(page, lambda: path_of(page) == landing
                and query_of(page).get("object") == ["season-1/manifest.json"])
        inspector = page.get_by_role("region", name="Object inspector")
        wait_ui(page, inspector.get_by_role("heading", name="season-1/manifest.json").is_visible)
        active = session_cookie(page)
        assert active != pending
        assert_error(Api(base, cookie=pending).get("/api/me"), 401, "unauthenticated")
        assert Api(base, cookie=active).get("/api/me").status_code == 200
    again = Api(base)
    assert again.post("/api/session", {"email": JUN, "password": PASSWORD}).status_code == 202
    assert_error(again.post("/api/session/two-step", {"code": code}), 401, "invalid_credentials")
    assert_error(again.post("/api/session/two-step", {"code": code, "recovery_code": "kite1-jun01"}), 422,
                 "validation_failed", "code", CODE_CHOICE)
    assert again.post("/api/session/two-step", {"code": next_code(JUN_SECRET)}).status_code == 200


def test_wf_two_step_sessions_enrol_and_codes(browser: Any, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    member = new_member(base, mail, "tidepool", ADA, "developer")
    with app_page(browser, base + "/account") as page:
        ui_sign_in(page, member.email, member.password)
        region = page.get_by_role("region", name="Two-step sign-in")
        wait_ui(page, region.is_visible)
        click(region.get_by_role("button", name="Turn on two-step sign-in"))
        setup = region.get_by_role("textbox", name="Setup key")
        wait_ui(page, lambda: BASE32_RE.match(setup.input_value()))
        secret = setup.input_value()
        assert status_text(page, "Two-step status") == "Add this key to your authenticator app, then enter the code it shows."
        status = page.get_by_role("status", name="Two-step status")
        count_texts(page, status)
        fill(region.get_by_role("textbox", name="Authenticator code"), next_code(secret))
        click(region.get_by_role("button", name="Verify and turn on"))
        codes = region.get_by_role("list", name="Recovery codes").get_by_role("listitem")
        wait_ui(page, lambda: codes.count() == RECOVERY_CODES)
        recovery = [c.strip() for c in codes.all_inner_texts()]
        assert all(RECOVERY_RE.match(c) for c in recovery)
        done = "Two-step sign-in is on. Save your recovery codes now; Farshore won't show them again."
        assert status_text(page, "Two-step status") == done and seen_texts(status).count(done) == 1
    turned_on = poll(lambda: mails(mail, member.email, "Two-step sign-in turned on for your Farshore account"))[0]
    for leaked in [secret] + recovery:
        assert leaked not in text(turned_on)
    assert db_mentions(Postgres(), secret) == [] and db_mentions(Postgres(), recovery[0].replace("-", "")) == []
    state = sign_in(base, member.email, member.password, secret).get("/api/me/two-step").json()
    assert state["enabled"] is True and state["recovery_codes_left"] == RECOVERY_CODES
    rec = Api(base)
    assert rec.post("/api/session", {"email": member.email, "password": member.password}).status_code == 202
    assert rec.post("/api/session/two-step", {"recovery_code": recovery[0].replace("-", "").upper()}).status_code == 200
    reuse = Api(base)
    reuse.post("/api/session", {"email": member.email, "password": member.password})
    assert_error(reuse.post("/api/session/two-step", {"recovery_code": recovery[0]}), 401, "invalid_credentials")
    signed = Api(base)
    signed.post("/api/session", {"email": member.email, "password": member.password})
    code = next_code(secret)
    assert signed.post("/api/session/two-step", {"code": code}).status_code == 200
    assert_error(signed.post("/api/me/two-step/confirm", {"code": code}), 422, "validation_failed", "code", WRONG_CODE)
    assert_error(signed.post("/api/me/two-step/confirm", {"code": totp(secret, _last_step[secret] - 1)}), 422,
                 "validation_failed", "code", WRONG_CODE)
    assert_error(signed.post("/api/me/two-step/confirm", {"recovery_code": "zzzzz-zzzzz"}), 422, "validation_failed",
                 "recovery_code", WRONG_RECOVERY)
    assert_error(signed.post("/api/me/two-step/setup"), 409, "invalid_transition")
    assert signed.delete("/api/me/two-step", content=json.dumps({"code": next_code(secret)}).encode(),
                         headers={"Content-Type": "application/json"}).status_code == 204
    assert poll(lambda: mails(mail, member.email, "Two-step sign-in turned off for your Farshore account"))
    off = assert_error(signed.delete("/api/me/two-step", content=b'{"code":"000000"}', headers={"Content-Type": "application/json"}),
                       409, "invalid_transition")
    assert (off["from"], off["to"]) == ("off", "off")
    assert_error(signed.post("/api/me/two-step/enable", {"code": "000000"}), 409, "invalid_transition")
    assert_error(signed.post("/api/me/two-step/confirm", {"code": "000000"}), 409, "invalid_transition")
    remove_member(base, "tidepool", ADA, member)


def test_wf_two_step_sessions_sessions_and_password(browser: Any, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    member = new_member(base, mail, "lanternfish", MARA, "developer")
    secret, _ = enrol(member.api)
    member.api.delete("/api/session")
    with app_page(browser, base + "/account") as page:
        ui_sign_in(page, member.email, member.password, secret)
        wait_ui(page, lambda: path_of(page) == "/account")
        second = sign_in(base, member.email, member.password, secret, device="second browser")
        created = next(s for s in second.get("/api/me/sessions").json()["sessions"] if s["current"])["created_at"]
        page.reload()
        table = page.get_by_role("table", name="Sessions")
        wait_ui(page, lambda: "This session" in table.inner_text())
        status = page.get_by_role("status", name="Sessions status")
        count_texts(page, status)
        click(page.get_by_role("button", name=f"Sign out session from {shown(created)}"))
        wait_ui(page, lambda: status_text(page, "Sessions status") == "Session signed out.")
        r = second.get("/api/me")
        assert_error(r, 401, "unauthenticated")
        assert any("fs_session=" in c and "Max-Age=0".lower() in c.lower() for c in r.headers.get_list("Set-Cookie"))
        third = sign_in(base, member.email, member.password, secret)
        pending = Api(base)
        assert pending.post("/api/session", {"email": member.email, "password": member.password}).status_code == 202
        count_texts(page, status)
        click(page.get_by_role("button", name="Sign out other sessions"))
        signed_out = f"Signed out {other_sessions(2)}."
        wait_ui(page, lambda: status_text(page, "Sessions status") == signed_out)
        assert seen_texts(status).count(signed_out) == 1
        assert_error(third.get("/api/me"), 401, "unauthenticated")
        assert_error(pending.post("/api/session/two-step", {"code": "000000"}), 401, "unauthenticated")
        page.reload()
        wait_ui(page, lambda: path_of(page) == "/account" and page.get_by_role("region", name="Sessions").is_visible())
    replaced = Api(base)
    assert replaced.post("/api/session", {"email": member.email, "password": member.password}).status_code == 202
    old_token = replaced.token
    assert replaced.post("/api/session", {"email": member.email, "password": member.password}).status_code == 202
    assert_error(Api(base, cookie=old_token).post("/api/session/two-step", {"code": "000000"}), 401, "unauthenticated")
    remove_member(base, "lanternfish", MARA, member)


def test_wf_two_step_sessions_step_up(browser: Any, app_url: str, mail: Any) -> None:
    base = env_url("APP_SHORT_URL")
    owner = new_member(base, mail, "lanternfish", MARA, "owner")
    secret, _ = enrol(owner.api)
    body = {"description": "step-up", "permission": "read", "buckets": None}
    keys_path = f"/api/w/{LF}/keys"
    assert assert_error(owner.api.post(keys_path, body), 403, "step_up_required")["message"] == STEP_UP_MESSAGE
    confirmed = owner.api.post("/api/me/two-step/confirm", {"code": next_code(secret)})
    until = parse_iso(confirmed.json()["confirmed_until"])
    assert owner.api.post(keys_path, body).status_code == 201
    other = sign_in(base, owner.email, owner.password, secret)
    assert_error(other.post(keys_path, body), 403, "step_up_required")
    assert_error(other.post(f"/api/w/{LF}/encryption/rotate"), 403, "step_up_required")
    theo = sign_in(base, THEO)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    item = stored(theo, "lanternfish", bucket, "hold.bin", b"hold")
    hold = f"/api/w/{LF}/buckets/{bucket}/object/legal-hold"
    params = {"key": "hold.bin", "version": item["version_id"]}
    assert other.put(hold, {"on": True}, params=params).status_code == 200
    assert_error(other.put(hold, {"on": False}, params=params), 403, "step_up_required")
    developer = new_member(base, mail, "lanternfish", MARA, "developer")
    enrol(developer.api)
    assert_error(developer.api.post(keys_path, body), 403, "forbidden")

    def lapsed() -> bool:
        r = owner.api.post(keys_path, body)
        if r.status_code == 201:
            assert date_of(r) <= until
            return False
        assert_error(r, 403, "step_up_required")
        assert date_of(r) >= until
        return True

    poll(lapsed, SHORT_STEP_UP_S + GRACE_S * 2, "confirmation lapse", interval=1.0)
    with app_page(browser, base + "/console/lanternfish") as page:
        ui_sign_in(page, owner.email, owner.password, secret)
        nav_to(page, "Access keys")
        click(page.get_by_role("button", name="Create access key"))
        dialog = page.get_by_role("dialog", name="Create access key")
        fill(dialog.get_by_role("textbox", name="Description"), "ui step-up")
        check(dialog.get_by_role("radiogroup", name="Permission").get_by_role("radio", name="Read only"))
        check(dialog.get_by_role("group", name="Buckets").get_by_role("checkbox", name="All buckets"))
        click(dialog.get_by_role("button", name="Create key"))
        confirm = page.get_by_role("dialog", name="Confirm it's you")
        box = confirm.get_by_role("textbox", name="Authenticator code")
        wait_ui(page, box.is_visible)
        assert is_focused(box)
        fill(box, next_code(secret))
        click(confirm.get_by_role("button", name="Confirm"))
        wait_ui(page, lambda: SECRET_RE.match(dialog.get_by_role("textbox", name="Secret access key").input_value()))
        assert fits("Key <key id> created. Copy the secret now; Farshore won't show it again.", status_text(page, "Key status"))
    descriptions = [k["description"] for k in sign_in(base, MARA).get(keys_path).json()["keys"]]
    assert descriptions.count("ui step-up") == 1


def test_wf_two_step_sessions_password_change(browser: Any, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    member = new_member(base, mail, "lanternfish", MARA, "developer")
    secret, _ = enrol(member.api)
    new_password = FRESH_PASSWORD + "-new"
    with app_page(browser, base + "/account") as page:
        ui_sign_in(page, member.email, member.password, secret)
        wait_ui(page, lambda: path_of(page) == "/account")
        other = sign_in(base, member.email, member.password, secret)
        pending = Api(base)
        assert pending.post("/api/session", {"email": member.email, "password": member.password}).status_code == 202
        region = page.get_by_role("region", name="Password")
        wait_ui(page, region.is_visible)
        fill(region.get_by_label("Current password", exact=True), "wrong-current-password")
        fill(region.get_by_label("New password", exact=True), new_password)
        click(region.get_by_role("button", name="Change password"))
        wait_ui(page, lambda: status_text(page, "Password status") == "Your current password is incorrect.")
        fill(region.get_by_label("Current password", exact=True), member.password)
        fill(region.get_by_label("New password", exact=True), "short")
        click(region.get_by_role("button", name="Change password"))
        wait_ui(page, lambda: status_text(page, "Password status") == NEW_PASSWORD_RULE)
        fill(region.get_by_label("New password", exact=True), new_password)
        pw_status = page.get_by_role("status", name="Password status")
        count_texts(page, pw_status)
        click(region.get_by_role("button", name="Change password"))
        changed_copy = f"Password changed. {other_sessions(3)} signed out."
        wait_ui(page, lambda: status_text(page, "Password status") == changed_copy)
        assert seen_texts(pw_status).count(changed_copy) == 1
        assert region.get_by_label("New password", exact=True).input_value() == ""
        assert region.get_by_label("Current password", exact=True).input_value() == ""
        for ended in (member.api, other):
            assert_error(ended.get("/api/me"), 401, "unauthenticated")
        assert_error(pending.post("/api/session/two-step", {"code": "000000"}), 401, "unauthenticated")
        page.reload()
        wait_ui(page, lambda: path_of(page) == "/account" and region.is_visible())
        assert Api(base, cookie=session_cookie(page)).get("/api/me").status_code == 200
    assert_error(Api(base).post("/api/session", {"email": member.email, "password": member.password}), 401, "invalid_credentials")
    assert Api(base).post("/api/session", {"email": member.email, "password": new_password}).status_code == 202
    changed = poll(lambda: mails(mail, member.email, "Your Farshore password was changed"))[0]
    body = text(changed)
    assert "3" in body and FRESH_PASSWORD not in body and "lanternfish" not in body
    remove_member(base, "lanternfish", MARA, member)


def test_session_idle_and_absolute_lifetimes(app_url: str) -> None:
    base = env_url("APP_SHORT_SESSIONS_URL")
    idle = sign_in(base, THEO)
    quiet_since = time.monotonic()
    poll(lambda: time.monotonic() - quiet_since > SHORT_IDLE_S + 1, SHORT_IDLE_S * 3, "idle period")
    r = idle.get("/api/me")
    assert_error(r, 401, "unauthenticated")
    assert any("Max-Age=0".lower() in c.lower() for c in r.headers.get_list("Set-Cookie"))
    active = sign_in(base, THEO)
    started = time.monotonic()
    poll(lambda: active.get("/api/me").status_code == 401, LONG_WAIT_S, "absolute lifetime")
    assert time.monotonic() - started > SHORT_IDLE_S
    assert_error(active.get("/api/me"), 401, "unauthenticated")


def test_wf_access_keys_lifecycle_ui(browser: Any, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    mara = sign_in(base, MARA)
    bucket = make_bucket(sign_in(base, THEO), "lanternfish", ["cascade"])
    description = "ci key " + uuid.uuid4().hex[:8]
    with app_page(browser, base + "/console/lanternfish") as page:
        ui_sign_in(page, MARA)
        nav_to(page, "Access keys")
        click(page.get_by_role("button", name="Create access key"))
        dialog = page.get_by_role("dialog", name="Create access key")
        wait_ui(page, dialog.is_visible)
        fill(dialog.get_by_role("textbox", name="Description"), description)
        check(dialog.get_by_role("radiogroup", name="Permission").get_by_role("radio", name="Read and write"))
        check(dialog.get_by_role("group", name="Buckets").get_by_role("checkbox", name=bucket))
        click(dialog.get_by_role("button", name="Create key"))
        secret_box = dialog.get_by_role("textbox", name="Secret access key")
        wait_ui(page, lambda: SECRET_RE.match(secret_box.input_value()))
        secret = secret_box.input_value()
        key_id = re.search(r"FSK[A-Z0-9]{17}", status_text(page, "Key status")).group(0)
        assert status_text(page, "Key status") == f"Key {key_id} created. Copy the secret now; Farshore won't show it again."
        page.keyboard.press("Escape")
        wait_ui(page, lambda: not dialog.is_visible())
        assert secret not in page.content()
        row = page.get_by_role("table", name="Access keys").get_by_role("row").filter(has_text=key_id)
        click(row.get_by_role("button", name="Disable key"))
        wait_ui(page, lambda: status_text(page, "Key status") == f"Key {key_id} disabled. Requests signed with it fail from now on.")
        click(row.get_by_role("button", name="Delete key"))
        wait_ui(page, lambda: status_text(page, "Key status") == f"Key {key_id} deleted.")
    assert KEY_ID_RE.match(key_id)
    assert key_id not in mara.get(f"/api/w/{LF}/keys").text
    owners = [m["email"] for m in mara.get(f"/api/w/{LF}/members").json()["members"] if m["role"] == "owner"]
    for owner in owners:
        notice = poll(lambda o=owner: mails(mail, o, f"New access key {key_id} in {WS_NAMES[LF]}"))
        assert len(notice) == 1
        body = text(notice[0])
        assert key_id in body and description in body and "read-write" in body and "Mara Okonkwo" in body and secret not in body
    assert db_mentions(Postgres(), secret) == []
    live = make_key(mara, "lanternfish")
    bad = assert_error(mara.delete(f"/api/w/{LF}/keys/{live['key_id']}"), 409, "invalid_transition")
    assert (bad["from"], bad["to"]) == ("active", "deleted")
    mara.post(f"/api/w/{LF}/keys/{live['key_id']}/disable")
    assert_error(mara.post(f"/api/w/{LF}/keys/{live['key_id']}/disable"), 409, "invalid_transition")
    assert mara.delete(f"/api/w/{LF}/keys/{live['key_id']}").status_code == 204
    for field, extra in (("description", {"description": "d" * (DESCRIPTION_MAX + 1)}), ("prefix", {"prefix": "/lead"}),
                         ("expires_at", {"expires_at": iso(server_now(base) - timedelta(hours=1))}),
                         ("buckets", {"buckets": [fresh_bucket()]}), ("permission", {"permission": "admin"})):
        payload = {"description": "", "permission": "read", "buckets": None, **extra}
        assert_error(mara.post(f"/api/w/{LF}/keys", payload), 422, "validation_failed", field)


def test_wf_access_keys_prefix_and_expiry(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade"])
    stored(theo, "lanternfish", bucket, "other/a.bin", b"other")
    key = make_key(mara, "lanternfish", buckets=[bucket], prefix="builds/")
    cred = cred_of(key)
    assert s3(base, cred, "PUT", bucket, "builds/a.bin", body=b"build").status_code == 200
    assert s3(base, cred, "GET", bucket, "builds/a.bin").content == b"build"
    for method, k, query in (("PUT", "other/b.bin", None), ("GET", "other/a.bin", None), ("DELETE", "other/a.bin", None),
                             ("POST", "other/m.bin", {"uploads": ""})):
        assert_s3_error(s3(base, cred, method, bucket, k, query=query, body=b"x" if method == "PUT" else b""), 403, "AccessDenied")
    for prefix in (None, "build", "other/"):
        params = {"prefix": prefix} if prefix else {}
        assert_s3_error(list_v2(base, cred, bucket, **params), 403, "AccessDenied")
    for prefix in ("builds/", "builds/sub"):
        assert list_v2(base, cred, bucket, prefix=prefix).status_code == 200
    expires = server_now(base) + timedelta(seconds=SHORT_DAY_S + 1)
    timed = make_key(mara, "lanternfish", buckets=[bucket], expires_at=iso(expires))

    def stopped() -> bool:
        r = s3(base, cred_of(timed), "GET", bucket, "other/a.bin")
        if r.status_code == 200:
            assert date_of(r) <= expires
            return False
        assert_s3_error(r, 403, "InvalidAccessKeyId")
        assert date_of(r) >= expires
        return True

    poll(stopped, SHORT_DAY_S * 4, "key expiry")
    row = next(k for k in mara.get(f"/api/w/{LF}/keys").json()["keys"] if k["key_id"] == timed["key_id"])
    assert row["expired"] is True
    bad = assert_error(mara.post(f"/api/w/{LF}/keys/{timed['key_id']}/rotate"), 409, "invalid_transition")
    assert (bad["from"], bad["to"]) == ("expired", "rotated")
    assert mara.post(f"/api/w/{LF}/keys/{timed['key_id']}/disable").status_code == 200
    assert mara.delete(f"/api/w/{LF}/keys/{timed['key_id']}").status_code == 204
    drop_key(mara, "lanternfish", key["key_id"])


def test_wf_access_keys_rotation_overlap(browser: Any, app_url: str, mail: Any) -> None:
    base = env_url("APP_SHORT_URL")
    mara = sign_in(base, MARA)
    bucket = make_bucket(sign_in(base, THEO), "lanternfish", ["cascade"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    with app_page(browser, base + "/signin") as page:
        page.clock.set_system_time(datetime.now(timezone.utc) + timedelta(hours=5))
        ui_sign_in(page, MARA)
        nav_to(page, "Access keys")
        row = page.get_by_role("table", name="Access keys").get_by_role("row").filter(has_text=key["key_id"])
        wait_ui(page, row.is_visible)
        click(row.get_by_role("button", name="Rotate key"))
        dialog = page.get_by_role("dialog", name="Rotate access key")
        wait_ui(page, dialog.is_visible)
        assert f"Rotate {key['key_id']}? The previous secret keeps working until the overlap ends." in dialog.inner_text()
        click(dialog.get_by_role("button", name="Rotate"))
        box = dialog.get_by_role("textbox", name="New secret access key")
        wait_ui(page, lambda: SECRET_RE.match(box.input_value()))
        new_secret = box.input_value()
        listed = next(k for k in mara.get(f"/api/w/{LF}/keys").json()["keys"] if k["key_id"] == key["key_id"])
        overlap_end = listed["previous_secret_expires_at"]
        assert status_text(page, "Key status") == f"Key {key['key_id']} rotated. The previous secret works until {shown(overlap_end)}."
        page.keyboard.press("Escape")
        wait_ui(page, lambda: f"Previous secret works until {shown(overlap_end)}" in row.inner_text())
        old = cred_of(key)
        data = b"chunked with the old secret"
        r = s3(base, old, "PUT", bucket, "rot.bin", payload="STREAMING-AWS4-HMAC-SHA256-PAYLOAD",
               builder=signed_chunks(data, PART_MIN // 64), headers=chunk_headers(data))
        assert r.status_code == 200
        assert s3(base, (key["key_id"], new_secret), "GET", bucket, "rot.bin").content == data
        assert_error(mara.post(f"/api/w/{LF}/keys/{key['key_id']}/rotate"), 409, "rotation_in_progress")
        assert next(k for k in mara.get(f"/api/w/{LF}/keys").json()["keys"]
                    if k["key_id"] == key["key_id"])["previous_secret_last_used_at"]
        end = parse_iso(overlap_end)

        def old_stopped() -> bool:
            r = s3(base, old, "GET", bucket, "rot.bin")
            if r.status_code == 200:
                assert date_of(r) <= end
                return False
            assert_s3_error(r, 403, "SignatureDoesNotMatch")
            assert date_of(r) >= end
            return True

        poll(old_stopped, SHORT_OVERLAP_S * 3, "overlap end")
        advance(page, KEYS_REREAD_MS + STEP_MS * 10)
        wait_ui(page, lambda: "Previous secret works until" not in row.inner_text())
    assert s3(base, (key["key_id"], new_secret), "GET", bucket, "rot.bin").status_code == 200
    second = make_key(mara, "lanternfish", buckets=[bucket])
    rotators = [sign_in(base, MARA) for _ in range(3)]
    results = together([lambda m=m: m.post(f"/api/w/{LF}/keys/{second['key_id']}/rotate") for m in rotators])
    assert sorted(r.status_code for r in results) == [200, 409, 409]
    assert all(r.json()["error"] == "rotation_in_progress" for r in results if r.status_code == 409)
    notice = poll(lambda: mails(mail, MARA, f"Access key {key['key_id']} rotated in {WS_NAMES[LF]}"))[0]
    assert key["key_id"] in text(notice) and new_secret not in text(notice) and key["secret"] not in text(notice)
    assert "lanternfish" not in text(notice) and "cascade" not in text(notice).lower()


def test_wf_encryption_ciphertext_everywhere(app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara = sign_in(base, THEO), sign_in(base, MARA)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    cred = cred_of(key)
    marker = b"PLAINTEXT-MARKER-" + uuid.uuid4().hex.encode()
    data = marker * DEFAULT_PAGE
    observer = S3()
    try:
        a = stored(theo, "lanternfish", bucket, "same-a.bin", data)
        b = stored(theo, "lanternfish", bucket, "same-b.bin", data)
        s3(base, cred, "PUT", bucket, "s3.bin", body=data, headers={"x-amz-checksum-crc32": crc32_b64(data)})
        s3(base, cred, "PUT", bucket, "chunked.bin", payload="STREAMING-AWS4-HMAC-SHA256-PAYLOAD",
           builder=signed_chunks(data, DEFAULT_PAGE * 10), headers=chunk_headers(data))
        upload_id = multipart_start(base, cred, bucket, "mp.bin")
        etag = part(base, cred, bucket, "mp.bin", upload_id, 1, data).headers["etag"]
        staged = observer.keys(f"uploads/{upload_id}/")
        assert staged and all(marker not in observer.get(k) for k in staged)
        complete(base, cred, bucket, "mp.bin", upload_id, complete_xml([(1, etag)]))
        for k in ("same-a.bin", "same-b.bin", "s3.bin", "chunked.bin", "mp.bin"):
            wait_settled(theo, "lanternfish", bucket, k)
            assert content(theo, "lanternfish", bucket, k).content == data
        blobs = [observer.get(k) for k in bucket_blobs(observer, bucket)]
        assert len(blobs) == 10 and all(marker not in blob and blob != data for blob in blobs)
        origin = "cascade"
        a_copy = observer.get(f"regions/{origin}/{bucket}/{a['version_id']}")
        assert a_copy != observer.get(f"regions/{origin}/{bucket}/{b['version_id']}")
        got = s3(base, cred, "GET", bucket, "s3.bin", headers={"x-amz-checksum-mode": "ENABLED"})
        assert got.headers["etag"] == md5_etag(data) and got.headers["x-amz-checksum-crc32"] == crc32_b64(data)
        for seed_bucket, seed in (("tidepool-builds", b"tidepool build 0.9.0"), ("lanternfish-avatars", b"Avatar uploads land here."),
                                  ("lanternfish-replays", b'{"season":1,"build":"1.4.2"}')):
            seeded = bucket_blobs(observer, seed_bucket)
            assert seeded and all(seed not in observer.get(k) for k in seeded)
    finally:
        drop_key(mara, "lanternfish", key["key_id"])


def test_wf_encryption_workspace_key_rotation(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    theo, mara, ada = sign_in(base, THEO), sign_in(base, MARA), sign_in(base, ADA)
    bucket = make_bucket(theo, "lanternfish", ["cascade", "meridian"])
    key = make_key(mara, "lanternfish", buckets=[bucket])
    data = os.urandom(META_LIMIT)
    s3(base, cred_of(key), "PUT", bucket, "disputed.bin", body=data, headers={"x-amz-checksum-crc32": crc32_b64(data)})
    wait_settled(theo, "lanternfish", bucket, "disputed.bin")
    link = mint_link(theo, "lanternfish", bucket, "disputed.bin")
    observer = S3()
    snapshot = {k: observer.get(k) for k in bucket_blobs(observer, bucket)}
    before = mara.get(f"/api/w/{LF}/encryption").json()
    other = ada.get(f"/api/w/{TP}/encryption").json()
    with app_page(browser, base + "/console/lanternfish") as page:
        ui_sign_in(page, MARA)
        nav_to(page, "Security")
        region = page.get_by_role("region", name="Encryption")
        wait_ui(page, lambda: f"Workspace key generation {count(before['generation'])}" in region.inner_text())
        click(region.get_by_role("button", name="Rotate workspace key"))
        dialog = page.get_by_role("dialog", name="Rotate workspace key")
        wait_ui(page, dialog.is_visible)
        assert "Rotate the workspace key? Object bytes stay where they are; only their data keys are re-wrapped." in dialog.inner_text()
        click(dialog.get_by_role("button", name="Rotate"))
        wait_ui(page, lambda: fits(f"Workspace key rotated to generation {count(before['generation'] + 1)}. <m> data keys re-wrapped.",
                                   status_text(page, "Encryption status")), seconds=LONG_WAIT_S)
    after = mara.get(f"/api/w/{LF}/encryption").json()
    assert after["generation"] == before["generation"] + 1 and list(after["wrapped"]) == [str(after["generation"])]
    rotators = [sign_in(base, MARA) for _ in range(3)]
    results = together([lambda m=m: m.post(f"/api/w/{LF}/encryption/rotate") for m in rotators])
    assert all(r.status_code in (200, 409) for r in results)
    assert all(r.json()["error"] == "rotation_in_progress" for r in results if r.status_code == 409)
    final = mara.get(f"/api/w/{LF}/encryption").json()
    assert final["generation"] == after["generation"] + sum(r.status_code == 200 for r in results)
    assert ada.get(f"/api/w/{TP}/encryption").json()["generation"] == other["generation"]
    assert {k: observer.get(k) for k in snapshot} == snapshot
    got = s3(base, cred_of(key), "GET", bucket, "disputed.bin", headers={"x-amz-checksum-mode": "ENABLED"})
    assert got.content == data and got.headers["etag"] == md5_etag(data) and got.headers["x-amz-checksum-crc32"] == crc32_b64(data)
    assert httpx.get(link["url"], timeout=HTTP_TIMEOUT).content == data
    assert content(theo, "lanternfish", bucket, "disputed.bin").content == data
    drop_key(mara, "lanternfish", key["key_id"])


def chain_hash(row: dict) -> str:
    canonical = "\n".join([str(row["seq"]), row["at_s"], row["actor"], row["action"], row["target"], row["detail"], row["prev_hash"]])
    return hashlib.sha256(canonical.encode()).hexdigest()


def test_wf_audit_trail_chain_and_verify(app_url: str) -> None:
    base = app_url.rstrip("/")
    priya, mara = sign_in(base, PRIYA), sign_in(base, MARA)
    bucket = make_bucket(sign_in(base, THEO), "lanternfish", ["cascade"])
    viewers = [sign_in(base, PRIYA) for _ in range(6)]
    together([lambda v=v, i=i: upload(v, "lanternfish", bucket, f"deny-{i}.bin", b"x") for i, v in enumerate(viewers)])
    rows = Postgres().rows(
        "SELECT seq, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS at_s, actor, action, target, detail, "
        f"prev_hash, hash FROM audit_entries WHERE workspace_slug = '{LF}' ORDER BY seq")
    assert [int(r["seq"]) for r in rows] == list(range(1, len(rows) + 1))
    previous = "0" * 64
    for row in rows:
        assert row["prev_hash"] == previous and row["hash"] == chain_hash(row), row["seq"]
        previous = row["hash"]
    denials = [r for r in rows if r["action"] == "permission.denied" and r["target"].startswith("deny-") and bucket in r["detail"]]
    assert len(denials) == 6 and len({r["seq"] for r in denials}) == 6
    verify = mara.get(f"/api/w/{LF}/audit/verify").json()
    assert verify["ok"] is True and verify["first_broken_seq"] is None and verify["entries"] >= len(rows)
    for method in ("PUT", "PATCH", "DELETE"):
        assert mara.call(method, f"/api/w/{LF}/audit", {}).status_code == 404
    assert priya.get(f"/api/w/{LF}/audit").status_code == 403


FORMULA_KEY = '=HYPERLINK("https://x.test","y")'
FORMULA_CSV = '"\'=HYPERLINK(""https://x.test"",""y"")"'


def test_wf_audit_trail_page_filters_csv(browser: Any, app_url: str) -> None:
    base = app_url.rstrip("/")
    bucket = make_bucket(sign_in(base, THEO), "lanternfish", ["cascade"])
    priya = sign_in(base, PRIYA)
    assert_error(upload(priya, "lanternfish", bucket, FORMULA_KEY, b"x"), 403, "forbidden")
    in_pool([lambda i=i: upload(priya, "lanternfish", bucket, f"page-{i}.bin", b"x") for i in range(SEARCH_MAX + 5)])
    assert_error(sign_in(base, SOL).get(f"/api/w/{PK}/members"), 403, "forbidden")
    with app_page(browser, base + "/console/lanternfish") as page:
        ui_sign_in(page, MARA)
        nav_to(page, "Security")
        trail = page.get_by_role("region", name="Audit trail")
        wait_ui(page, trail.is_visible)
        select(trail.get_by_role("combobox", name="Action"), "permission.denied")
        fill(trail.get_by_role("textbox", name="Actor"), PRIYA)
        click(trail.get_by_role("button", name="Apply audit filters"))
        wait_ui(page, lambda: query_of(page).get("action") == ["permission.denied"] and query_of(page).get("actor") == [PRIYA])
        table = page.get_by_role("table", name="Audit trail")
        wait_ui(page, lambda: table.get_by_role("row").count() > SEARCH_MAX)
        first_page = table.inner_text()
        click(trail.get_by_role("button", name="Older entries"))
        wait_ui(page, lambda: "cursor" in query_of(page) and query_of(page).get("prev") == [""])
        wait_ui(page, lambda: table.inner_text() != first_page)
        older = table.inner_text()
        copied = page.url
        click(trail.get_by_role("button", name="Verify chain"))
        wait_ui(page, lambda: fits("Chain verified: <n> entries intact.", status_text(page, "Audit status")))
        shown_count = int(re.search(r"[\d,]+", status_text(page, "Audit status")).group(0).replace(",", ""))
        csv_bytes = downloaded(page, trail.get_by_role("button", name="Download audit CSV"))
        page.go_back()
        wait_ui(page, lambda: "cursor" not in query_of(page) and table.inner_text() == first_page)
    with app_page(browser, copied) as fresh:
        ui_sign_in(fresh, MARA)
        wait_ui(fresh, lambda: query_of(fresh) == parse_qs(urlparse(copied).query, keep_blank_values=True))
        wait_ui(fresh, lambda: fresh.get_by_role("table", name="Audit trail").inner_text() == older)
    mara = sign_in(base, MARA)
    assert shown_count <= mara.get(f"/api/w/{LF}/audit/verify").json()["entries"]
    raw = csv_bytes.decode()
    assert raw.startswith("seq,at_utc,actor,action,target,detail,prev_hash,hash\n") and raw.endswith("\n")
    assert FORMULA_CSV in raw
    parsed = list(csv.reader(io.StringIO(raw)))[1:]
    assert all(r[2] == PRIYA and r[3] == "permission.denied" for r in parsed)
    assert [int(r[0]) for r in parsed] == sorted(int(r[0]) for r in parsed)
    stored_rows = Postgres().rows(f"SELECT seq, hash FROM audit_entries WHERE workspace_slug = '{LF}' "
                                  "AND action = 'permission.denied'")
    lantern = {(int(r["seq"]), r["hash"]) for r in stored_rows}
    assert {(int(r[0]), r[7]) for r in parsed} <= lantern
    assert mara.get(f"/api/w/{LF}/audit", params={"actor": SOL}).json()["entries"] == []
    for field, params in (("action", {"action": "nope"}), ("actor", {"actor": "a" * (SEARCH_Q_MAX * 3)}), ("cursor", {"cursor": "x"})):
        assert_error(mara.get(f"/api/w/{LF}/audit", params=params), 422, "validation_failed", field)


def test_wf_audit_trail_what_is_recorded(app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    pg = Postgres()
    start = int(pg.rows(f"SELECT coalesce(max(seq), 0) AS n FROM audit_entries WHERE workspace_slug = '{TP}'")[0]["n"])
    ada = sign_in(base, ADA)
    bucket = make_bucket(ada, "tidepool", ["cascade"])
    item = stored(ada, "tidepool", bucket, "aud.bin", b"audit")
    member = new_member(base, mail, "tidepool", ADA, "developer")
    unknown = fresh_email()
    Api(base).post("/api/session", {"email": unknown, "password": WRONG_PASSWORD})
    Api(base).post("/api/session", {"email": member.email, "password": WRONG_PASSWORD})
    signed = sign_in(base, member.email, member.password)
    secret, recovery = enrol(signed)
    with_code = sign_in(base, member.email, member.password, secret)
    bad = Api(base)
    bad.post("/api/session", {"email": member.email, "password": member.password})
    bad.post("/api/session/two-step", {"code": totp(secret, 0)})
    rec = Api(base)
    rec.post("/api/session", {"email": member.email, "password": member.password})
    rec.post("/api/session/two-step", {"recovery_code": recovery[1]})
    with_code.delete("/api/me/two-step", content=json.dumps({"code": next_code(secret)}).encode(),
                     headers={"Content-Type": "application/json"})
    new_password = member.password + "-2"
    with_code.put("/api/me/password", {"current_password": member.password, "new_password": new_password})
    with_code.post("/api/me/two-step/setup", xrw=False)
    ada.patch(f"/api/w/{TP}/members/{member.user_id}", {"role": "viewer"})
    upload(with_code, "tidepool", bucket, "denied.bin", b"x")
    key = make_key(ada, "tidepool", "read", [bucket], description="audit key")
    rotated = ada.post(f"/api/w/{TP}/keys/{key['key_id']}/rotate").json()
    denied_key = "s3-denied.bin"
    s3(base, (key["key_id"], rotated["secret"]), "PUT", bucket, denied_key, body=b"x")
    ada.post(f"/api/w/{TP}/keys/{key['key_id']}/disable")
    ada.delete(f"/api/w/{TP}/keys/{key['key_id']}")
    hold = f"/api/w/{TP}/buckets/{bucket}/object/legal-hold"
    ada.put(hold, {"on": True}, params={"key": "aud.bin", "version": item["version_id"]})
    ada.put(hold, {"on": False}, params={"key": "aud.bin", "version": item["version_id"]})
    generation = ada.post(f"/api/w/{TP}/encryption/rotate").json()["generation"]
    ada.delete(f"/api/w/{TP}/members/{member.user_id}")
    rows = pg.rows(f"SELECT actor, action, target, detail FROM audit_entries WHERE workspace_slug = '{TP}' AND seq > {start}")
    entries = [(r["actor"], r["action"], r["target"], r["detail"]) for r in rows]
    m = member.email
    expected = [(ADA, "invite.created", m, "developer"), (m, "invite.accepted", m, "developer"),
                (m, "session.sign_in_failed", m, "password"), (m, "session.signed_in", m, "password"),
                (m, "two_step.enabled", m, ""), (m, "session.signed_in", m, "two-step"),
                (m, "session.sign_in_failed", m, "two-step code"), (m, "session.signed_in", m, "recovery code"),
                (m, "two_step.disabled", m, ""), (m, "password.changed", m, ""),
                (ADA, "member.role_changed", m, " -> ".join(["developer", "viewer"])),
                (m, "permission.denied", "denied.bin", f"PUT /api/w/{TP}/buckets/{bucket}/object"),
                (ADA, "access_key.created", key["key_id"], "audit key"), (ADA, "access_key.rotated", key["key_id"], ""),
                (f"key:{key['key_id']}", "permission.denied", denied_key, f"PUT /s3/{bucket}/{denied_key}"),
                (ADA, "access_key.disabled", key["key_id"], ""), (ADA, "access_key.deleted", key["key_id"], ""),
                (ADA, "legal_hold.changed", "aud.bin", f"{item['version_id']} on"),
                (ADA, "legal_hold.changed", "aud.bin", f"{item['version_id']} off"),
                (ADA, "encryption.rotated", "tidepool", f"generation {generation}"), (ADA, "member.removed", m, "")]
    for entry in expected:
        assert entries.count(entry) == 1, entry
    assert not [e for e in entries if unknown in e]
    assert len([e for e in entries if e[1] == "permission.denied" and e[0] == m]) == 1
    flat = json.dumps(rows)
    for leaked in (member.password, new_password, secret, rotated["secret"], key["secret"], recovery[1], with_code.token or "-"):
        assert leaked not in flat


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notices, package.name
    for asset in ("Space Grotesk", "IBM Plex Sans", "JetBrains Mono", "Lucide"):
        assert asset in notices, asset


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def test_if_licences_allowed() -> None:
    for package in shipped_packages():
        options = set(re.split(r"\s+OR\s+", package.licence.strip("()")))
        assert options & ALLOWED_LICENCES, (package.name, package.licence)
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert notices.strip()


FORBIDDEN_STORES = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "level", "lowdb", "nedb", "@electric-sql/pglite",
                    "lmdb", "realm", "pouchdb"}


def test_if_only_postgres_and_minio() -> None:
    package = json.loads(Path("/app/package.json").read_text())
    declared = set(package.get("dependencies", {})) | set(package.get("devDependencies", {}))
    assert not declared & FORBIDDEN_STORES
    for path in Path("/app").rglob("*"):
        if "node_modules" in path.parts or ".git" in path.parts:
            continue
        assert path.suffix not in (".sqlite", ".sqlite3", ".db", ".rdb"), path
    assert "audit_entries" in " ".join(Postgres().tables())


def test_if_services_unchanged(mail: Any, killbill: Any) -> None:
    assert Postgres().rows("SELECT 1 AS one") == [{"one": 1}]
    assert isinstance(S3().keys("regions/"), list)
    assert isinstance(mail.messages(0, 0), list)
    assert killbill.account_by_key("farshore-lanternfish") is not None


def test_if_typescript_source() -> None:
    ts = [p for p in Path("/app").rglob("*.ts") if "node_modules" not in p.parts]
    assert ts
    for path in Path("/app").rglob("*"):
        if path.suffix not in (".js", ".mjs", ".cjs") or {"node_modules", "dist", "build", ".git", "out"} & set(path.parts):
            continue
        assert "config" in path.name or path.name.startswith("."), path
