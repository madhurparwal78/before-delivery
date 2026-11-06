from __future__ import annotations

import base64
import contextlib
import copy
import hashlib
import importlib
import json
import math
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
import zlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from email import message_from_string
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    addresses,
    advance,
    animations,
    app_user_env,
    as_app_user,
    capture,
    decode,
    difference,
    held,
    mail_from_address,
    motion,
    open_app,
    sample,
    select,
    session,
    state_styles,
    text,
)

SESSION_COOKIE = "sw_session"
HOST_SESSION_COOKIE = "__Host-sw_session"
AUTOSAVE_MAX_MS = 2000
TALLY_MAX_MS = 1200
REDUCED_MOTION_MS = 50
SHARE_REFRESH_MS = 10_000
DELIVERY_MAX_S = 30
GRID = 24
NUDGE = 8
NUDGE_SHIFT = 24
NEW_SHAPE_W = 144
NEW_SHAPE_H = 72
PAIR_LIMIT = 5
IP_LIMIT = 20
TIMING_SPREAD_MS = 100
TIMING_SAMPLES = 5
INVITE_RATE_LIMIT = 20
LOOKUP_LIMIT = 20
IMPORT_ANSWER_S = 2
HEALTH_ANSWER_S = 1
STATUS_ANSWER_S = 3
MAX_DEPTH = 64
MAX_ELEMENTS = 20_000
MAX_ATTRIBUTES = 64
MAX_TEXT = 10_000
FILE_PART_MAX = 2_000_000
ZOOM_MAX = 400
PINCH_TOLERANCE_PX = 2
FRAME_MS = 16
REAL_SLACK_MS = 400
TSCONFIG_DEPTH = 8
SOURCE_SKIP = {"node_modules", "dist", "build", ".git"}
GROUND = (243, 240, 232)
INK = (22, 32, 46)
SCOPE_RED = (200, 50, 63)
TEAL = (43, 111, 119)
BACKGROUND_CORNER = 24
DUPLICATE_OFFSET = 24
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
CSP_TEMPLATE = "default-src 'self'; script-src 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'nonce-{n}'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
DOWNLOAD_CSP = "default-src 'none'; sandbox"
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
FILENAME_SAFE = "!#$&+-.^_`|~"
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "Zlib", "OFL-1.1"}

HTTP_TIMEOUT = 30.0
EXPECT_MS = 15_000
EXPECT_S = 30
POLL_S = 0.5
SAVE_STEP_MS = 750
DELIVERY_WAIT_S = 60
QUIET_S = 15
LOCK_WAIT_S = 150
IDLE_WAIT_S = 7
SIGNIN_WINDOW_WAIT_S = 63
ABSOLUTE_WAIT_S = 63
INVITE_TTL_WAIT_S = 17
LINK_WAIT_S = 7
KEEPALIVE_S = 1.5
COPY_BOOT_S = 180
FADE_MS = 400

DANA = ("dana.okafor@harborlane.test", "Harbor-Lead-2026!")
RAVI = ("ravi.sato@harborlane.test", "Harbor-Net-2026!a")
LEE = ("lee.varga@northgate-qsa.test", "Northgate-QSA-2026!")
MORGAN = ("morgan.fell@harborlane.test", "Harbor-Ops-2026!")
SAM = ("sam.whitlow@kestrelpay.test", "Kestrel-Owner-2026!")
HARBOR_ID = "5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01"
FLOWS_PAGE_ID = "5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12"
KESTREL_ID = "9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b702"
KESTREL_PAGE_ID = "9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b712"
FLOWS_NAME = "Account data flows"
CDE = "Cardholder Data Environment"
CONNECTED = "Connected-to systems"
OUT = "Out of scope"
FLOW_ZONES = [
    {"id": "zone-connected", "kind": "connected", "name": "Connected-to systems", "note": "", "x": 48, "y": 96, "width": 384, "height": 432},
    {"id": "zone-cde", "kind": "cde", "name": "Cardholder Data Environment", "note": "Reviewed with assessor<br>September 2026", "x": 480, "y": 96, "width": 576, "height": 432},
    {"id": "zone-out", "kind": "out_of_scope", "name": "Out of scope", "note": "", "x": 1104, "y": 96, "width": 384, "height": 432},
]
FLOW_SHAPES = [
    ("shp-checkout", "web_app", "Checkout web app", 168, 168),
    ("shp-admin", "workstation", "Admin workstation", 168, 360),
    ("shp-payapi", "api_service", "Payment API", 600, 168),
    ("shp-vault", "database", "Card vault", 600, 360),
    ("shp-settle", "server", "Settlement batch", 840, 360),
    ("shp-analytics", "cloud_service", "Analytics", 1224, 168),
    ("shp-acquirer", "third_party", "Acquirer gateway", 1224, 600),
    ("shp-fraud", "api_service", "Fraud screening", 600, 600),
]
FLOW_CONNECTORS = [
    ("con-checkout-pay", "Card data <b>(TLS)</b>", "shp-checkout", "e", "shp-payapi", "w", [[312, 204], [600, 204]]),
    ("con-pay-vault", "Token lookup", "shp-payapi", "s", "shp-vault", "n", [[672, 240], [672, 360]]),
    ("con-vault-settle", "Batch records", "shp-vault", "e", "shp-settle", "w", [[744, 396], [840, 396]]),
    ("con-settle-acq", "Settlement file", "shp-settle", "e", "shp-acquirer", "n", [[984, 396], [1080, 396], [1080, 576], [1296, 576], [1296, 600]]),
    ("con-admin-pay", "Admin console", "shp-admin", "e", "shp-vault", "w", [[312, 396], [600, 396]]),
    ("con-pay-analytics", "Order events (no card data)", "shp-payapi", "n", "shp-analytics", "n", [[672, 168], [672, 144], [1296, 144], [1296, 168]]),
    ("con-fraud-settle", "Risk score", "shp-fraud", "e", "shp-settle", "s", [[744, 636], [912, 636], [912, 432]]),
]
SYSTEM_KINDS = {
    "server": "Server", "database": "Database", "firewall": "Firewall", "router": "Router",
    "load_balancer": "Load balancer", "web_app": "Web application", "api_service": "API service",
    "payment_terminal": "Payment terminal", "workstation": "Workstation", "cloud_service": "Cloud service",
    "third_party": "Third party", "backup_storage": "Backup storage",
}
ZONE_KINDS = {"cde": "Cardholder data environment", "connected": "Connected-to", "out_of_scope": "Out of scope"}
FLOW_BY_ID = {sid: (kind, label, x, y) for sid, kind, label, x, y in FLOW_SHAPES}
SPOOFED_HOST = "evil.test"
PROBE_ZONE = "Probe zone"
PROBE_ZONE_ID = "zone-z"
MARKER_ZONE = "Marker zone"
NEW_LABEL = "Chargeback feed"
JOURNEY_LABEL = "Token request"
NOT_AN_EMAIL = "not-an-email"
SECOND_PAGE = "Second page"
WRONG_PASSWORD = "Not-the-password-1"
SHORT_PASSWORD = "short"
TYPED_TEXT = "partial"
LEGACY_NAME = "legacy-scope.xml"
LEGACY_ZONE = "Legacy CDE"
LEGACY_FROM = "Old server"
LEGACY_TO = "Old host"
LEGACY_FLOW = "Old flow"
PROBE_SVG_NAME = "probe.svg"
BENIGN_LABEL = "Local box"
DISPOSITION_EXAMPLE = "filename=\"scope _v2_; caf_.xml\"; filename*=UTF-8''scope%20%22v2%22%3B%20caf%C3%A9.xml"


def seed_label(sid: str) -> str:
    return FLOW_BY_ID[sid][1]


def plain_seed(label: str) -> str:
    return label.replace("<b>", "").replace("</b>", "")


def flow_item(cid: str, direction: str) -> str:
    _, label, a, _, b, _, _ = next(c for c in FLOW_CONNECTORS if c[0] == cid)
    return f"{plain_seed(label)}: {seed_label(a)} to {seed_label(b)}, {direction}"


def connector_name(source: str, target: str) -> str:
    return f"Connector from {source} to {target}"


def connected_sentence(source: str, target: str) -> str:
    return f"Connected {source} to {target}."

SVG_NS = ET.fromstring('<svg xmlns="http://www.w3.org/2000/svg"/>').tag[1:].split("}")[0]
LEGACY_XML = (
    "\ufeff<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<diagram>\r\n  <page name=\"Legacy scope\">\r\n"
    "    <zone id=\"z1\" kind=\"cde\" name=\"Legacy CDE\" x=\"0\" y=\"0\" width=\"480\" height=\"336\"><note>Old note</note></zone>\r\n"
    "    <system id=\"s1\" kind=\"server\" label=\"Old server\" x=\"48\" y=\"48\" width=\"144\" height=\"72\"/>\r\n"
    "    <system id=\"s2\" kind=\"mainframe\" label=\"Old host\" x=\"288\" y=\"192\" width=\"144\" height=\"72\"/>\r\n"
    "    <flow id=\"f1\" from=\"s1\" to=\"s2\" label=\"Old flow\"/>\r\n  </page>\r\n</diagram>\r\n"
).encode("utf-8")
HOSTILE_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#x6A;avascript:alert(1)"><rect width="10" height="10"/></a></svg>'
).encode()
BENIGN_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="336"><rect data-kind="server" data-id="r1" x="48" y="48" width="144" height="72"><title>Local box</title></rect><use href="#r1"/></svg>'
).encode()

_NO = object()


def _service(name: str) -> Any:
    for module in ("conftest", "postgres_client", "minio_client", "mailpit_client", "services", "clients"):
        try:
            mod = importlib.import_module(module)
        except ImportError:
            continue
        if hasattr(mod, name):
            return getattr(mod, name)
    raise ImportError(name)


def s3(suffix: str = "") -> Any:
    cls = _service("S3")
    return cls(suffix) if suffix else cls()


def short_url() -> str:
    return os.environ["APP_SHORT_URL"].rstrip("/")


def storage_down_url() -> str:
    return os.environ["APP_STORAGE_DOWN_URL"].rstrip("/")


def mail_down_url() -> str:
    return os.environ["APP_MAIL_DOWN_URL"].rstrip("/")


def public_url(base: str) -> str:
    return os.environ.get("APP_PUBLIC_URL", base).rstrip("/")


def cookie_name(base: str) -> str:
    return HOST_SESSION_COOKIE if public_url(base).startswith("https:") else SESSION_COOKIE


def fresh_email(tag: str) -> str:
    return f"{tag}.{uuid.uuid4().hex[:12]}@example.test"


def fresh_title(tag: str) -> str:
    return f"{tag} {uuid.uuid4().hex[:10]}"


def poll(predicate: Callable[[], Any], seconds: float = EXPECT_S, message: str = "") -> Any:
    end = time.monotonic() + seconds
    pause = threading.Event()
    while True:
        value = predicate()
        if value:
            return value
        if time.monotonic() > end:
            raise AssertionError(message or "condition not reached before the deadline")
        pause.wait(POLL_S)


def wait_server_time(base: str, seconds: float) -> None:
    end = time.monotonic() + seconds
    pause = threading.Event()
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        while time.monotonic() < end:
            client.get(base + "/api/health")
            pause.wait(min(POLL_S, max(0.0, end - time.monotonic())))


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, follow_redirects=False)
        self.csrf = ""
        self.email = ""
        self.password = ""

    def call(self, method: str, path: str, body: Any = _NO, headers: dict | None = None, csrf: bool = True, **kw: Any) -> httpx.Response:
        h = dict(headers or {})
        if csrf and method not in ("GET", "HEAD", "OPTIONS") and self.csrf and "X-CSRF-Token" not in h:
            h["X-CSRF-Token"] = self.csrf
        if body is not _NO:
            kw["content"] = json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        return self.http.request(method, path, headers=h, **kw)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, body: Any = _NO, **kw: Any) -> httpx.Response:
        return self.call("POST", path, body, **kw)

    def put(self, path: str, body: Any = _NO, **kw: Any) -> httpx.Response:
        return self.call("PUT", path, body, **kw)

    def patch(self, path: str, body: Any = _NO, **kw: Any) -> httpx.Response:
        return self.call("PATCH", path, body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("DELETE", path, **kw)

    def signin(self, email: str, password: str, wait: bool = True) -> httpx.Response:
        end = time.monotonic() + LOCK_WAIT_S
        while True:
            r = self.http.post("/api/session", json={"email": email, "password": password})
            if r.status_code == 429 and wait and time.monotonic() < end:
                wait_server_time(self.base, int(r.headers.get("Retry-After", "1")) + 1)
                continue
            break
        if r.status_code == 200:
            self.csrf = r.json()["csrfToken"]
            self.email, self.password = email, password
        return r

    def cookie(self) -> tuple[str, str]:
        for c in self.http.cookies.jar:
            if c.name in (SESSION_COOKIE, HOST_SESSION_COOKIE):
                return c.name, c.value or ""
        raise AssertionError("no session cookie held")

    def new_diagram(self, title: str) -> tuple[str, str]:
        r = self.post("/api/diagrams", {"title": title})
        assert r.status_code == 201, r.text
        d = r.json()["diagram"]
        return d["id"], d["pages"][0]["id"]

    def put_page(self, did: str, doc: dict) -> httpx.Response:
        return self.put(f"/api/diagrams/{did}/pages/{doc['id']}", doc)

    def page(self, did: str, pid: str) -> dict:
        r = self.get(f"/api/diagrams/{did}/pages/{pid}")
        assert r.status_code == 200, r.text
        return r.json()

    def shares(self, did: str) -> list[dict]:
        r = self.get(f"/api/diagrams/{did}/shares")
        assert r.status_code == 200, r.text
        return r.json()["shares"]

    def share_for(self, did: str, email: str) -> dict | None:
        found = [s for s in self.shares(did) if s["email"] == email.lower()]
        return found[0] if found else None

    def export(self, did: str, key: str | None = None, body: Any = None) -> httpx.Response:
        headers = {"Idempotency-Key": key} if key else {}
        return self.post(f"/api/diagrams/{did}/exports", {} if body is None else body, headers=headers)

    def import_file(self, did: str, name: str, payload: bytes, ctype: str = "application/xml") -> httpx.Response:
        return self.post(f"/api/diagrams/{did}/imports", files={"file": (name, payload, ctype)})

    def link(self, path: str) -> str:
        r = self.get(path)
        assert r.status_code == 303, r.text
        location = r.headers["location"]
        assert location.startswith("/api/downloads/")
        return location

    def download(self, path: str) -> httpx.Response:
        return self.get(self.link(path))

    def audit(self, did: str) -> list[dict]:
        r = self.get(f"/api/diagrams/{did}/audit")
        assert r.status_code == 200, r.text
        return r.json()["events"]


def signed_in(base: str, creds: tuple[str, str]) -> Api:
    api = Api(base)
    r = api.signin(*creds)
    assert r.status_code == 200, r.text
    return api


def raw_signin(base: str, email: str, password: str, **headers: str) -> httpx.Response:
    return httpx.post(base + "/api/session", json={"email": email, "password": password}, headers=headers, timeout=HTTP_TIMEOUT)


def set_cookie_header(r: httpx.Response, name: str) -> str:
    for raw in r.headers.get_list("set-cookie"):
        if raw.startswith(name + "="):
            return raw
    raise AssertionError(f"no {name} cookie set")


def set_cookie_value(r: httpx.Response, name: str) -> str:
    return set_cookie_header(r, name).split(";", 1)[0].split("=", 1)[1]


def cookie_attributes(r: httpx.Response, name: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for part in set_cookie_header(r, name).split(";")[1:]:
        k, _, v = part.strip().partition("=")
        attrs[k.lower()] = v
    return attrs


def error_code(r: httpx.Response) -> str:
    return r.json().get("error", "")


def no_cors_headers(r: httpx.Response) -> None:
    assert not [k for k in r.headers if k.lower().startswith("access-control-")], dict(r.headers)


def blank_doc(pid: str, version: int, name: str = "Page 1", zones=(), shapes=(), connectors=()) -> dict:
    return {"id": pid, "name": name, "version": version, "zones": list(zones), "shapes": list(shapes), "connectors": list(connectors)}


def shp(sid: str, kind: str, label: str, x: int, y: int, z: int, w: int = NEW_SHAPE_W, h: int = NEW_SHAPE_H, group: str | None = None) -> dict:
    return {"id": sid, "kind": kind, "label": label, "x": x, "y": y, "width": w, "height": h, "z": z, "groupId": group}


def zone(zid: str, kind: str, name: str, x: int, y: int, w: int, h: int, note: str = "") -> dict:
    return {"id": zid, "kind": kind, "name": name, "note": note, "x": x, "y": y, "width": w, "height": h}


def con(cid: str, label: str, a: str, ap: str, b: str, bp: str, points: list) -> dict:
    return {"id": cid, "label": label, "from": {"shapeId": a, "port": ap}, "to": {"shapeId": b, "port": bp}, "points": copy.deepcopy(points)}


def flows_doc(pid: str, version: int = 1) -> dict:
    shapes = [shp(sid, kind, label, x, y, z) for z, (sid, kind, label, x, y) in enumerate(FLOW_SHAPES, start=1)]
    return blank_doc(pid, version, FLOWS_NAME, copy.deepcopy(FLOW_ZONES), shapes, [con(*c) for c in FLOW_CONNECTORS])


def copy_flows(owner: Api, tag: str) -> tuple[str, str, str]:
    title = fresh_title(tag)
    did, pid = owner.new_diagram(title)
    r = owner.put_page(did, flows_doc(pid))
    assert r.status_code == 200, r.text
    return did, pid, title


def one_box(owner: Api, tag: str) -> tuple[str, str, str]:
    title = fresh_title(tag)
    did, pid = owner.new_diagram(title)
    r = owner.put_page(did, blank_doc(pid, 1, shapes=[shp("box", "server", "Probe box", 96, 96, 1)]))
    assert r.status_code == 200, r.text
    return did, pid, title


def port(shape: dict, side: str) -> list[int]:
    x, y, w, h = shape["x"], shape["y"], shape["width"], shape["height"]
    return {"n": [x + w // 2, y], "e": [x + w, y + h // 2], "s": [x + w // 2, y + h], "w": [x, y + h // 2]}[side]


def assert_attached(doc: dict) -> None:
    shapes = {s["id"]: s for s in doc["shapes"]}
    for c in doc["connectors"]:
        a, b = shapes[c["from"]["shapeId"]], shapes[c["to"]["shapeId"]]
        assert c["points"][0] == port(a, c["from"]["port"]), c
        assert c["points"][-1] == port(b, c["to"]["port"]), c
        for p, q in zip(c["points"], c["points"][1:]):
            assert p[0] == q[0] or p[1] == q[1], c


def zone_derived(derived: dict, zid: str) -> dict:
    return next(z for z in derived["zones"] if z["id"] == zid)


def tally_text(n: int, m: int) -> str:
    return f"{n} system{'' if n == 1 else 's'} · {m} crossing{'' if m == 1 else 's'}"


def tally_sentence(n: int, m: int) -> str:
    return f"{n} system{'' if n == 1 else 's'}, {m} crossing{'' if m == 1 else 's'}."


def snap(value: float) -> int:
    return int(math.floor(value / GRID + 0.5)) * GRID


TOKEN_RE = re.compile(r"/invite/([A-Za-z0-9_-]+)")


def mails_to(mail: Any, email: str, contains: str = "", minimum: int = 1, seconds: float = DELIVERY_WAIT_S) -> list[dict]:
    end = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages() if email.lower() in [a.lower() for a in addresses(m.get("To"))] and contains in text(m)]
        if len(found) >= minimum or time.monotonic() > end:
            return found


def exactly_one(mail: Any, email: str, contains: str) -> dict:
    first = mails_to(mail, email, contains)
    assert len(first) >= 1, f"no message for {email}"
    again = mails_to(mail, email, contains, minimum=2, seconds=QUIET_S)
    assert len(again) == 1, f"{len(again)} messages for {email}"
    return again[0]


def invite_token(mail: Any, email: str, title: str, exclude: tuple = ()) -> str:
    def find() -> str | None:
        for m in mails_to(mail, email, title):
            match = TOKEN_RE.search(text(m))
            if match and match.group(1) not in exclude:
                return match.group(1)
        return None
    return poll(find, DELIVERY_WAIT_S, f"no invitation for {email}")


def accept(api: Api, token: str, body: dict) -> httpx.Response:
    end = time.monotonic() + LOCK_WAIT_S
    while True:
        r = api.post(f"/api/invites/{token}/accept", body)
        if r.status_code == 429 and time.monotonic() < end:
            wait_server_time(api.base, int(r.headers.get("Retry-After", "1")) + 1)
            continue
        return r


@dataclass
class Person:
    api: Api
    email: str
    password: str
    did: str
    pid: str
    owner: Api
    title: str


def new_person(base: str, mail: Any, role: str = "viewer") -> Person:
    owner = signed_in(base, DANA)
    title = fresh_title("Access")
    did, pid = owner.new_diagram(title)
    email = fresh_email("person")
    r = owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": role})
    assert r.status_code == 201, r.text
    token = invite_token(mail, email, title)
    api = Api(base)
    password = "Probe-pass-" + uuid.uuid4().hex[:12]
    r = accept(api, token, {"displayName": "Probe Person", "password": password})
    assert r.status_code == 200, r.text
    api.csrf = api.get("/api/session").json()["csrfToken"]
    api.email, api.password = email, password
    return Person(api, email, password, did, pid, owner, title)


def grant(owner: Api, mail: Any, did: str, title: str, member: Api, role: str) -> None:
    r = owner.post(f"/api/diagrams/{did}/shares", {"email": member.email, "role": role})
    assert r.status_code == 201, r.text
    token = invite_token(mail, member.email, title)
    r = accept(member, token, {})
    assert r.status_code == 200, r.text


def add_member(owner: Api, mail: Any, did: str, title: str, role: str) -> str:
    email = fresh_email("member")
    assert owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": role}).status_code == 201
    token = invite_token(mail, email, title)
    r = accept(Api(owner.base), token, {"displayName": "Probe Member", "password": "Probe-pass-" + uuid.uuid4().hex[:12]})
    assert r.status_code == 200, r.text
    return email


def clear_lock(base: str, creds: tuple[str, str]) -> Api:
    return signed_in(base, creds)


def burst(fns: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(fns))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(fns)) as pool:
        return list(pool.map(run, fns))


@contextlib.contextmanager
def app_page(browser: Browser, url: str, size: tuple[int, int] = DESKTOP, reduced: str = "no-preference") -> Iterator[Page]:
    gen = open_app(browser, url, reduced_motion=reduced)
    managed = hasattr(gen, "__enter__")
    pg = gen.__enter__() if managed else next(gen)
    try:
        pg.set_viewport_size({"width": size[0], "height": size[1]})
        yield pg
    finally:
        if managed:
            gen.__exit__(None, None, None)
        else:
            gen.close()


def sign_into(pg: Page, api: Api) -> None:
    name, value = api.cookie()
    pg.context.add_cookies([{"name": name, "value": value, "url": api.base}])


def open_editor(pg: Page, api: Api, did: str, pid: str) -> Any:
    sign_into(pg, api)
    resp = pg.goto(f"{api.base}/d/{did}/p/{pid}")
    advance(pg, 100)
    expect(canvas(pg)).to_be_visible(timeout=EXPECT_MS)
    return resp


def ui_signin(scope: Any, creds: tuple[str, str]) -> None:
    scope.get_by_role("textbox", name="Email").fill(creds[0])
    scope.get_by_label("Password", exact=True).fill(creds[1])
    scope.get_by_role("button", name="Sign in", exact=True).click()


def canvas(pg: Page):
    return pg.get_by_role("application", name="Diagram canvas")


def announcements(pg: Page):
    return pg.get_by_role("status", name="Announcements")


def save_state(pg: Page):
    return pg.get_by_role("status", name="Save state")


ANNOUNCE_LOG = """e => {
  if (e.__verifierLog) return;
  e.__verifierLog = [];
  let prev = e.textContent || '';
  new MutationObserver(() => {
    const now = e.textContent || '';
    if (now !== prev) { e.__verifierLog.push(now); prev = now; }
  }).observe(e, {subtree: true, childList: true, characterData: true});
}"""


def watch_announcements(pg: Page) -> None:
    announcements(pg).evaluate(ANNOUNCE_LOG)


def times_announced(pg: Page, sentence: str) -> int:
    count, had = 0, False
    for shown in announcements(pg).evaluate("e => e.__verifierLog || []"):
        has = sentence in shown
        count += has and not had
        had = has
    return count


def dialog(pg: Page, name: str):
    return pg.get_by_role("dialog", name=name, exact=True)


def button(scope: Any, name: str):
    return scope.get_by_role("button", name=name, exact=True)


def shape_btn(pg: Page, label: str, kind_name: str):
    return pg.get_by_role("button", name=f"{label}, {kind_name}", exact=True)


def seed_btn(pg: Page, sid: str):
    kind, label, _, _ = FLOW_BY_ID[sid]
    return shape_btn(pg, label, SYSTEM_KINDS[kind])


def zone_btn(pg: Page, name: str):
    return pg.get_by_role("button", name=f"Zone {name}", exact=True)


def tally(pg: Page, zone_name: str):
    return pg.get_by_role("group", name=re.compile("^" + re.escape(zone_name) + " tally"))


def markers(pg: Page, zone_name: str, direction: str):
    return pg.get_by_role("img", name=f"Crossing on {zone_name}, {direction}", exact=True)


def inside(loc: Any) -> bool:
    return bool(loc.evaluate("e => e.contains(document.activeElement)"))


def record(pg: Page, method: str, fragment: str) -> list:
    seen: list = []
    pg.on("request", lambda r: seen.append(r) if r.method == method and fragment in r.url else None)
    return seen


def wait_saved(pg: Page) -> None:
    state = save_state(pg)
    for _ in range(40):
        advance(pg, 500)
        try:
            expect(state).to_have_text("Saved", timeout=SAVE_STEP_MS)
            return
        except AssertionError:
            continue
    expect(state).to_have_text("Saved", timeout=1)


def combo_label(loc: Any) -> str:
    return loc.evaluate("e => e.tagName === 'SELECT' ? e.selectedOptions[0].label : e.textContent.trim()")


def refresh_shares(pg: Page, did: str) -> None:
    with pg.expect_response(lambda r: f"/api/diagrams/{did}/shares" in r.url and r.request.method == "GET", timeout=EXPECT_MS):
        advance(pg, SHARE_REFRESH_MS)


RING_MARGIN = 6
RING_DIFF = 1.0


def ring_pixels(pg: Page, b: dict) -> Any:
    vp = pg.viewport_size
    assert vp is not None
    x0, y0 = max(0.0, b["x"] - RING_MARGIN), max(0.0, b["y"] - RING_MARGIN)
    x1, y1 = min(float(vp["width"]), b["x"] + b["width"] + RING_MARGIN), min(float(vp["height"]), b["y"] + b["height"] + RING_MARGIN)
    shot = session(pg).send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False,
                                                        "clip": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0, "scale": 1}})
    return decode(base64.b64decode(shot["data"]))


def focus_ring_visible(pg: Page) -> bool:
    if pg.evaluate(
            "() => { const e = document.activeElement; if (!e || e === document.body) return false;"
            " const s = getComputedStyle(e); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'; }"):
        return True
    handle = pg.evaluate_handle("() => document.activeElement")
    if not pg.evaluate("e => !!e && e !== document.body", handle):
        return False
    b = handle.evaluate("e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }")
    focused = ring_pixels(pg, b)
    handle.evaluate("e => e.blur()")
    advance(pg, FRAME_MS * 2)
    rest = ring_pixels(pg, b)
    handle.evaluate("e => e.focus({focusVisible: true, preventScroll: true})")
    advance(pg, FRAME_MS * 2)
    return difference(rest, focused) > RING_DIFF


RECT = "e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }"


def realtime_path(loc, total_ms: float) -> list[dict]:
    page, t0, stepped, out = loc.page, time.monotonic(), 0, []
    while True:
        elapsed = (time.monotonic() - t0) * 1000
        if elapsed - stepped >= FRAME_MS:
            advance(page, elapsed - stepped)
            stepped += round(elapsed - stepped)
        out.append({"t": elapsed, **loc.evaluate(RECT)})
        if elapsed > total_ms + REAL_SLACK_MS:
            return out


def announced(pg: Page, region: Any, text: str) -> None:
    until_true(pg, lambda: text in " ".join((region.text_content() or "").split()), f"the announcement {text!r}")


def expect_tally_shows(pg: Page, zone_name: str, n: int, m: int) -> None:
    want, loc = tally_text(n, m), tally(pg, zone_name)

    def shown() -> bool:
        if loc.count() == 0:
            return False
        name = loc.first.evaluate("e => { const by = e.getAttribute('aria-labelledby'); return (by ? by.split(/\\s+/)"
                                  ".map(i => (document.getElementById(i) || {}).textContent || '').join(' ') : '') + ' '"
                                  " + (e.getAttribute('aria-label') || '') + ' ' + (e.textContent || ''); }")
        return want in " ".join(name.split())
    until_true(pg, shown, f"{zone_name} tally {want}")


def until_true(pg: Page, check: Callable[[], Any], what: str) -> None:
    deadline = time.monotonic() + EXPECT_S
    while not check():
        assert time.monotonic() < deadline, f"timed out waiting for {what}"
        advance(pg, FRAME_MS)


OPEN_OVERLAYS = """() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')].filter(e => {
  const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
    && s.visibility !== 'hidden' && s.display !== 'none';
}).length"""

PARKED = """(e, c) => {
  if (c.contains(e)) return true;
  const d = e.closest('[role="dialog"], [role="alertdialog"], dialog');
  if (!d) return false;
  const r = d.getBoundingClientRect();
  return r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight;
}"""


def chrome_layout(pg: Page) -> None:
    viewport = pg.viewport_size
    assert viewport is not None
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    until_true(pg, lambda: pg.evaluate(OPEN_OVERLAYS) == 0, "closed sheets and drawers to leave the viewport")
    inside = canvas(pg).element_handle()
    controls = pg.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if control.is_visible() and not control.evaluate(PARKED, inside):
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            b = control.bounding_box()
            assert b and b["x"] >= -1 and b["x"] + b["width"] <= viewport["width"] + 1, b


FOCUSED_NAME = """() => {
  const e = document.activeElement;
  if (!e || e === document.body) return '';
  const by = e.getAttribute('aria-labelledby');
  if (by) {
    const named = by.split(/\\s+/).map(id => (document.getElementById(id)?.textContent || '').trim()).join(' ').trim();
    if (named) return named;
  }
  const label = e.getAttribute('aria-label');
  if (label) return label.trim();
  if (e.labels && e.labels[0]) return e.labels[0].innerText.trim();
  return (e.innerText || e.title || e.getAttribute('placeholder') || '').trim();
}"""


def focus_names(pg: Page, presses: int) -> list[str]:
    names = []
    for _ in range(presses):
        pg.keyboard.press("Tab")
        names.append(pg.evaluate(FOCUSED_NAME))
    return names


def straightened(points: list) -> list:
    out: list = []
    for pt in [list(q) for q in points]:
        if out and out[-1] == pt:
            continue
        if len(out) >= 2 and (out[-2][0] == out[-1][0] == pt[0] or out[-2][1] == out[-1][1] == pt[1]):
            out[-1] = pt
            continue
        out.append(pt)
    return out


def view_scale(a, b, a_id: str, b_id: str) -> float:
    ab, bb = a.bounding_box(), b.bounding_box()
    dx, dy = FLOW_BY_ID[b_id][2] - FLOW_BY_ID[a_id][2], FLOW_BY_ID[b_id][3] - FLOW_BY_ID[a_id][3]
    return (bb["x"] - ab["x"]) / dx if abs(dx) >= abs(dy) else (bb["y"] - ab["y"]) / dy


def jsonc(text: str) -> Any:
    text = re.sub(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*.*?\*/', lambda m: m.group(0) if m.group(0).startswith('"') else "",
                  text, flags=re.S)
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", text))


def tsconfig_path(base: Path, ref: str) -> Path:
    path = base / ref
    if path.is_dir():
        return path / "tsconfig.json"
    return path if path.exists() or path.suffix == ".json" else path.with_name(path.name + ".json")


def tsconfig_package(base: Path, spec: str) -> Path | None:
    import conftest
    app, deployed = Path("/app"), Path(getattr(conftest, "DEPLOYED_APP"))
    rel = base.relative_to(app) if base.is_relative_to(app) else Path()
    for root in (base, app, deployed / rel, deployed):
        path = root / "node_modules" / spec
        if path.is_dir():
            manifest = path / "package.json"
            field = json.loads(manifest.read_text()).get("tsconfig") if manifest.exists() else None
            path = path / (field if isinstance(field, str) else "tsconfig.json")
        elif not path.exists() and path.suffix != ".json":
            path = path.with_name(path.name + ".json")
        if path.exists():
            return path
    return None


def tsconfig_strict(path: Path, depth: int = 0) -> bool | None:
    assert depth < TSCONFIG_DEPTH and path.exists(), f"tsconfig chain broken at {path}"
    cfg = jsonc(path.read_text())
    strict = (cfg.get("compilerOptions") or {}).get("strict")
    if strict is not None:
        return strict is True
    ext = cfg.get("extends")
    for parent in reversed([ext] if isinstance(ext, str) else ext or []):
        if not isinstance(parent, str):
            continue
        target = tsconfig_path(path.parent, parent) if parent.startswith(".") else tsconfig_package(path.parent, parent)
        found = tsconfig_strict(target, depth + 1) if target else None
        if found is not None:
            return found
    refs = [tsconfig_strict(tsconfig_path(path.parent, r["path"]), depth + 1)
            for r in cfg.get("references") or [] if isinstance(r, dict) and isinstance(r.get("path"), str)]
    found = [r for r in refs if r is not None]
    return all(found) if found else None


def tsconfigs(root: Path) -> list[Path]:
    found = []
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SOURCE_SKIP]
        if "tsconfig.json" in files:
            found.append(Path(folder) / "tsconfig.json")
    return sorted(found)


def distinct_frames(path: list[dict]) -> set:
    return {tuple(round(float(v), 1) for k, v in sorted(f.items()) if k not in ("t", "time", "ms") and isinstance(v, (int, float))) for f in path}


def png_pixels(data: bytes) -> tuple[int, int, Callable[[int, int], tuple]]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat, palette = 8, b"", b""
    width = height = depth = color = interlace = 0
    while pos < len(data):
        length = int.from_bytes(data[pos:pos + 4], "big")
        kind, chunk = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height = int.from_bytes(chunk[0:4], "big"), int.from_bytes(chunk[4:8], "big")
            depth, color, interlace = chunk[8], chunk[9], chunk[12]
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"PLTE":
            palette = chunk
    assert depth == 8 and interlace == 0, "unsupported PNG layout"
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    raw, stride, rows, prev, i = zlib.decompress(idat), width * channels, [], bytearray(width * channels), 0
    for _ in range(height):
        f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - channels] if x >= channels else 0
            b = prev[x]
            c = prev[x - channels] if x >= channels else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line

    def px(x: int, y: int) -> tuple:
        o = x * channels
        if color in (2, 6):
            return tuple(rows[y][o:o + 3])
        if color == 3:
            k = rows[y][o]
            return tuple(palette[k * 3:k * 3 + 3])
        return (rows[y][o],) * 3

    return width, height, px


def ascii_filename(name: str) -> str:
    return "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in name)


def star_filename(name: str) -> str:
    return "".join(chr(b) if chr(b).isascii() and (chr(b).isalnum() or chr(b) in FILENAME_SAFE) else f"%{b:02X}" for b in name.encode())


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower())


DP01_CASES = ["http public URL cookie sw_session", "fixation: pre-existing cookie value answers 401 after sign-in"]


@pytest.mark.parametrize("case", DP01_CASES, ids=DP01_CASES)
def test_dp01_signin_session_cookie(app_url, case):
    base = app_url.rstrip("/")
    name = cookie_name(base)
    first = raw_signin(base, *MORGAN)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["user"]["email"] == MORGAN[0] and body["csrfToken"]
    value = set_cookie_value(first, name)
    if case == DP01_CASES[0]:
        attrs = cookie_attributes(first, name)
        assert "HttpOnly".lower() in attrs and attrs.get("SameSite".lower(), "").lower() == "Lax".lower()
        assert attrs.get("Path".lower()) == "/" and "Domain".lower() not in attrs
        if name == HOST_SESSION_COOKIE:
            assert "Secure".lower() in attrs
        echo = httpx.get(base + "/api/session", headers={"Cookie": f"{name}={value}"}, timeout=HTTP_TIMEOUT)
        assert echo.status_code == 200 and echo.json()["csrfToken"] == body["csrfToken"]
        second = raw_signin(base, *MORGAN)
        assert set_cookie_value(second, name) != value and second.json()["csrfToken"] != body["csrfToken"]
    else:
        second = raw_signin(base, *MORGAN, Cookie=f"{name}={value}")
        assert second.status_code == 200
        new_value = set_cookie_value(second, name)
        assert new_value != value and second.json()["csrfToken"] != body["csrfToken"]
        old = httpx.get(base + "/api/session", headers={"Cookie": f"{name}={value}"}, timeout=HTTP_TIMEOUT)
        assert old.status_code == 401 and error_code(old) == "unauthenticated"
        new = httpx.get(base + "/api/session", headers={"Cookie": f"{name}={new_value}"}, timeout=HTTP_TIMEOUT)
        assert new.status_code == 200


DP02_CASES = ["pair lock after 5", "ip lock after 20 across emails", "unknown email identical body and headers", "median timing within 100 ms", "correct password during lock answers 429"]


@pytest.mark.parametrize("case", DP02_CASES, ids=DP02_CASES)
def test_dp02_signin_lockout(mail, case):
    base = short_url()
    p = new_person(base, mail)
    creds = (p.email, p.password)
    wrong = "Wrong-pass-" + uuid.uuid4().hex[:8]
    clear_lock(base, creds)
    if case == "pair lock after 5":
        first = raw_signin(base, p.email, wrong)
        assert first.status_code == 401 and error_code(first) == "invalid_credentials"
        for _ in range(PAIR_LIMIT - 1):
            raw_signin(base, p.email, wrong)
        locked = raw_signin(base, p.email, wrong)
        assert locked.status_code == 429 and error_code(locked) == "signin_locked"
        assert int(locked.headers["Retry-After"]) >= 1
    elif case == "ip lock after 20 across emails":
        try:
            locked_at = None
            for i in range(IP_LIMIT + 1):
                r = raw_signin(base, fresh_email("unknown"), wrong)
                if r.status_code == 429:
                    locked_at = i
                    break
            assert locked_at is not None, "no IP lock after 20 failures across emails"
            later = raw_signin(base, fresh_email("unknown"), wrong)
            assert later.status_code == 429 and error_code(later) == "signin_locked" and int(later.headers["Retry-After"]) >= 1
            right = raw_signin(base, *creds)
            assert right.status_code == 429
        finally:
            wait_server_time(base, SIGNIN_WINDOW_WAIT_S)
    elif case == "unknown email identical body and headers":
        known = raw_signin(base, p.email, wrong)
        unknown_email = fresh_email("unknown")
        unknown = raw_signin(base, unknown_email, wrong)
        assert known.status_code == unknown.status_code
        assert known.json() == unknown.json()
        strip = lambda r: {k.lower(): v for k, v in r.headers.items() if k.lower() not in ("date", "Retry-After".lower())}
        assert strip(known) == strip(unknown)
        for _ in range(PAIR_LIMIT):
            k2 = raw_signin(base, p.email, wrong)
            u2 = raw_signin(base, unknown_email, wrong)
        assert k2.status_code == u2.status_code == 429
        assert k2.json() == u2.json() and set(strip(k2)) == set(strip(u2))
        assert "Retry-After" in k2.headers and "Retry-After" in u2.headers
    elif case == "median timing within 100 ms":
        for _ in range(3):
            clear_lock(base, creds)
            unknown, known, ok = [], [], True
            for _ in range(TIMING_SAMPLES):
                t = time.perf_counter()
                r1 = raw_signin(base, fresh_email("unknown"), wrong)
                unknown.append((time.perf_counter() - t) * 1000)
                t = time.perf_counter()
                r2 = raw_signin(base, p.email, wrong)
                known.append((time.perf_counter() - t) * 1000)
                ok = ok and r1.status_code == 401 and r2.status_code == 401
            if ok:
                assert abs(sorted(unknown)[2] - sorted(known)[2]) <= TIMING_SPREAD_MS, (unknown, known)
                return
        raise AssertionError("could not measure five unlocked attempts")
    else:
        for _ in range(PAIR_LIMIT):
            raw_signin(base, p.email, wrong)
        right = raw_signin(base, *creds)
        assert right.status_code == 429 and error_code(right) == "signin_locked" and int(right.headers["Retry-After"]) >= 1


DP03_CASES = ["idle", "absolute despite activity"]


@pytest.mark.parametrize("case", DP03_CASES, ids=DP03_CASES)
def test_dp03_session_expiry(case):
    base = short_url()
    api = signed_in(base, MORGAN)
    assert api.get("/api/diagrams").status_code == 200
    if case == "idle":
        wait_server_time(base, IDLE_WAIT_S)
    else:
        start = time.monotonic()
        while time.monotonic() - start < ABSOLUTE_WAIT_S:
            r = api.get("/api/session")
            if time.monotonic() - start < ABSOLUTE_WAIT_S - 10:
                assert r.status_code == 200, "activity did not keep the session alive"
            wait_server_time(base, KEEPALIVE_S)
    r = api.get("/api/diagrams")
    assert r.status_code == 401 and error_code(r) == "session_expired"


DP04_CASES = ["page save", "create export", "import file", "share action"]


@pytest.mark.parametrize("case", DP04_CASES, ids=DP04_CASES)
def test_dp04_sign_in_to_continue_resends(browser, case):
    base = short_url()
    owner = signed_in(base, DANA)
    did, pid, _ = one_box(owner, "Resume")
    invitee = fresh_email("resume")
    method, frag = {"page save": ("PUT", f"/pages/{pid}"), "create export": ("POST", "/exports"),
                    "import file": ("POST", "/imports"), "share action": ("POST", "/shares")}[case]
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        reqs = record(pg, method, f"/api/diagrams/{did}{frag}")
        if case == "create export":
            button(pg, "Files").click()
            expect(dialog(pg, "Diagram files")).to_be_visible()
        elif case == "import file":
            button(pg, "Import").click()
            dialog(pg, "Import diagram file").get_by_label("Diagram file").set_input_files(
                {"name": "legacy-probe.xml", "mimeType": "text/xml", "buffer": LEGACY_XML})
        elif case == "share action":
            button(pg, "Share").click()
            share = dialog(pg, "Share diagram")
            share.get_by_role("textbox", name="Email").fill(invitee)
            select(share.get_by_role("combobox", name="Role", exact=True), "Viewer")
        wait_server_time(base, IDLE_WAIT_S)
        if case == "page save":
            box = shape_btn(pg, "Probe box", "Server")
            box.focus()
            pg.keyboard.press("Space")
            pg.keyboard.press("ArrowRight")
            advance(pg, AUTOSAVE_MAX_MS + 100)
        elif case == "create export":
            button(dialog(pg, "Diagram files"), "Create export").click()
        elif case == "import file":
            button(dialog(pg, "Import diagram file"), "Import file").click()
        else:
            button(dialog(pg, "Share diagram"), "Send invitation").click()
        resume = dialog(pg, "Sign in to continue")
        expect(resume).to_be_visible(timeout=EXPECT_MS)
        expect(resume).to_contain_text("Your session ended. Sign in again and we will save your change.")
        expect(resume.get_by_role("textbox", name="Email")).to_have_value(DANA[0])
        owner = clear_lock(base, DANA)
        resume.get_by_label("Password", exact=True).fill(DANA[1])
        button(resume, "Sign in").click()
        expect(resume).to_be_hidden(timeout=EXPECT_MS)
        until_true(pg, lambda: len(reqs) >= 2, "the kept request to be resent")
        advance(pg, AUTOSAVE_MAX_MS * 2)
        new_csrf = pg.request.get(base + "/api/session").json()["csrfToken"]
        assert len(reqs) == 2
        assert reqs[1].headers["x-csrf-token"] == new_csrf != reqs[0].headers.get("x-csrf-token")
        if case == "create export":
            assert reqs[0].headers["idempotency-key"] == reqs[1].headers["idempotency-key"]
        elif case == "import file":
            assert reqs[0].url == reqs[1].url
        else:
            assert reqs[0].post_data == reqs[1].post_data
    owner = signed_in(base, DANA)
    if case == "page save":
        page = poll(lambda: (lambda d: d if d["page"]["shapes"][0]["x"] == 96 + NUDGE else None)(owner.page(did, pid)))
        assert page["page"]["shapes"][0]["x"] == 96 + NUDGE
    elif case == "create export":
        exports = poll(lambda: owner.get(f"/api/diagrams/{did}/exports").json()["exports"])
        assert len(exports) == 1
    elif case == "import file":
        imports = poll(lambda: owner.get(f"/api/diagrams/{did}/imports").json()["imports"])
        assert len(imports) == 1 and imports[0]["sha256"] == hashlib.sha256(LEGACY_XML).hexdigest()
        assert s3("-short").get(f"imports/{did}/{imports[0]['id']}/original") == LEGACY_XML
    else:
        assert len([s for s in owner.shares(did) if s["email"] == invitee]) == 1


def test_wf_sign_in_session_timers(browser, mail):
    base = short_url()
    p = new_person(base, mail)
    did, pid, _ = one_box(p.api, "Timers")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, p.api, did, pid)
        puts = record(pg, "PUT", f"/pages/{pid}")
        wait_server_time(base, IDLE_WAIT_S)
        box = shape_btn(pg, "Probe box", "Server")
        box.focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ArrowRight")
        advance(pg, AUTOSAVE_MAX_MS + 100)
        resume = dialog(pg, "Sign in to continue")
        expect(resume).to_be_visible(timeout=EXPECT_MS)
        password = resume.get_by_label("Password", exact=True)
        password.fill(WRONG_PASSWORD)
        button(resume, "Sign in").click()
        alert = resume.get_by_role("alert")
        expect(alert).to_have_text("Email or password is incorrect.", timeout=EXPECT_MS)
        password.fill(TYPED_TEXT)
        expect(pg.get_by_role("status", name="Save state", include_hidden=True)).to_have_text("Saving...")
        for _ in range(4):
            advance(pg, SHARE_REFRESH_MS)
        pg.keyboard.press("Escape")
        expect(resume).to_be_visible()
        expect(password).to_have_value(TYPED_TEXT)
        assert inside(resume)
        expect(alert).to_have_text("Email or password is incorrect.")
        assert len(puts) == 1
        for _ in range(PAIR_LIMIT):
            password.fill(WRONG_PASSWORD)
            with pg.expect_response(lambda r: r.request.method == "POST" and urllib.parse.urlparse(r.url).path == "/api/session",
                                    timeout=EXPECT_MS):
                button(resume, "Sign in").click()
            advance(pg, 100)
        expect(alert).to_have_text("Too many sign-in attempts. Try again later.", timeout=EXPECT_MS)
        advance(pg, SHARE_REFRESH_MS)
        expect(resume).to_be_visible()
        assert len(puts) == 1
        end = time.monotonic() + LOCK_WAIT_S
        while resume.is_visible() and time.monotonic() < end:
            wait_server_time(base, 3)
            if not resume.is_visible():
                break
            password.fill(p.password)
            with pg.expect_response(lambda r: r.request.method == "POST" and urllib.parse.urlparse(r.url).path == "/api/session",
                                    timeout=EXPECT_MS):
                button(resume, "Sign in").click()
            advance(pg, 100)
        expect(resume).to_be_hidden(timeout=EXPECT_MS)
        poll(lambda: len(puts) == 2)
    owner = signed_in(base, (p.email, p.password))
    assert owner.page(did, pid)["page"]["shapes"][0]["x"] == 96 + NUDGE


DP62_CASES = ["sign-out on one instance, other instance refuses", "password change"]


@pytest.mark.parametrize("case", DP62_CASES, ids=DP62_CASES)
def test_dp62_sessions_end_everywhere(app_url, mail, case):
    base = app_url.rstrip("/")
    p = new_person(base, mail)
    other = signed_in(storage_down_url(), (p.email, p.password))
    assert other.get("/api/session").status_code == 200
    if case == DP62_CASES[0]:
        assert p.api.delete("/api/session").status_code == 204
        for api in (other, p.api):
            r = api.get("/api/diagrams")
            assert r.status_code == 401 and error_code(r) == "unauthenticated"
    else:
        old_name, old_value = p.api.cookie()
        new_pw = "Probe-new-" + uuid.uuid4().hex[:12]
        r = p.api.post("/api/session/password", {"currentPassword": p.password, "newPassword": new_pw})
        assert r.status_code == 200 and r.json()["csrfToken"] != p.api.csrf
        fresh_cookie = set_cookie_value(r, cookie_name(base))
        assert fresh_cookie != old_value
        stale = httpx.get(base + "/api/session", headers={"Cookie": f"{old_name}={old_value}"}, timeout=HTTP_TIMEOUT)
        assert stale.status_code == 401
        assert other.get("/api/diagrams").status_code == 401
        assert httpx.get(base + "/api/session", headers={"Cookie": f"{old_name}={fresh_cookie}"}, timeout=HTTP_TIMEOUT).status_code == 200
        assert raw_signin(base, p.email, new_pw).status_code == 200


@pytest.mark.parametrize("case", DP62_CASES, ids=DP62_CASES)
def test_wf_sign_in_session_ui(browser, app_url, mail, case):
    base = app_url.rstrip("/")
    p = new_person(base, mail)
    if case == DP62_CASES[1]:
        _password_change_flow(browser, base, p)
        return
    elsewhere = signed_in(storage_down_url(), (p.email, p.password))
    with app_page(browser, base + "/") as pg:
        expect(pg).to_have_url(re.compile(r"/signin"))
        ui_signin(pg, (p.email, p.password))
        expect(pg).to_have_url(base + "/")
        expect(pg.get_by_role("heading", name="Diagrams", level=1)).to_be_visible()
        expect(pg.get_by_role("list", name="Your diagrams").get_by_role("link", name=p.title)).to_be_visible()
        held_cookie = next(c for c in pg.context.cookies() if c["name"] in (SESSION_COOKIE, HOST_SESSION_COOKIE))
        button(pg, "Sign out").click()
        expect(pg).to_have_url(base + "/signin")
    r = httpx.get(base + "/api/session", headers={"Cookie": f"{held_cookie['name']}={held_cookie['value']}"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 401 and error_code(r) == "unauthenticated"
    assert elsewhere.get("/api/diagrams").status_code == 401


def _password_change_flow(browser: Browser, base: str, p: Person) -> None:
    other = signed_in(base, (p.email, p.password))
    new_pw = "Probe-new-" + uuid.uuid4().hex[:12]
    with app_page(browser, base + "/signin") as pg:
        sign_into(pg, p.api)
        pg.goto(base + "/")
        button(pg, "Change password").click()
        dlg = dialog(pg, "Change password")
        current, new = dlg.get_by_label("Current password"), dlg.get_by_label("New password")
        current.fill(WRONG_PASSWORD)
        new.fill(new_pw)
        button(dlg, "Save password").click()
        expect(dlg).to_contain_text("Current password is incorrect.", timeout=EXPECT_MS)
        current.fill(p.password)
        new.fill(SHORT_PASSWORD)
        button(dlg, "Save password").click()
        expect(dlg).to_contain_text("Use 12 to 128 characters.", timeout=EXPECT_MS)
        new.fill(p.password)
        button(dlg, "Save password").click()
        expect(dlg).to_contain_text("Choose a password different from your current one.", timeout=EXPECT_MS)
        new.fill(new_pw)
        button(dlg, "Save password").click()
        expect(dlg).to_be_hidden(timeout=EXPECT_MS)
        announced(pg, announcements(pg), "Password changed. Your other sessions were signed out.")
        assert other.get("/api/diagrams").status_code == 401
        pg.reload()
        expect(pg.get_by_role("heading", name="Diagrams", level=1)).to_be_visible(timeout=EXPECT_MS)
    assert raw_signin(base, p.email, new_pw).status_code == 200


def test_dp05_diagram_list_and_creation(app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail)
    listed = {d["id"]: d["role"] for d in p.api.get("/api/diagrams").json()["diagrams"]}
    assert listed == {p.did: "viewer"}
    title = fresh_title("Owned")
    r = p.api.post("/api/diagrams", {"title": title})
    assert r.status_code == 201
    d = r.json()["diagram"]
    assert d["role"] == "owner" and d["title"] == title and d["pages"][0]["name"] == "Page 1" and d["pages"][0]["version"] == 1
    rows = p.api.get("/api/diagrams").json()["diagrams"]
    assert rows[0]["id"] == d["id"] and rows[0]["role"] == "owner"
    hidden, _ = p.owner.new_diagram(fresh_title("Hidden"))
    assert hidden not in {x["id"] for x in p.api.get("/api/diagrams").json()["diagrams"]}
    lee = {x["id"]: x["role"] for x in signed_in(base, LEE).get("/api/diagrams").json()["diagrams"]}
    assert lee.get(HARBOR_ID) == "viewer"
    morgan = {x["id"] for x in signed_in(base, MORGAN).get("/api/diagrams").json()["diagrams"]}
    assert HARBOR_ID not in morgan and KESTREL_ID not in morgan
    share = p.owner.share_for(p.did, p.email)
    assert p.owner.delete(f"/api/diagrams/{p.did}/shares/{share['id']}").status_code == 204
    assert p.did not in {x["id"] for x in p.api.get("/api/diagrams").json()["diagrams"]}


DP06_CASES = ["page of diagram A under diagram B", "share id of another diagram", "export pageIds with a foreign page", "PUT body id differs from path", "viewer forbidden on PUT", "editor forbidden on audit"]


@pytest.mark.parametrize("case", DP06_CASES, ids=DP06_CASES)
def test_dp06_object_level_access(app_url, mail, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    a, pa, _ = copy_flows(owner, "Diagram A")
    b, pb, _ = one_box(owner, "Diagram B")
    if case == DP06_CASES[0]:
        for path in (f"/api/diagrams/{b}/pages/{pa}", f"/api/diagrams/{b}/pages/{pa}/zones/zone-cde",
                     f"/api/diagrams/{b}/pages/{pa}/shapes/shp-payapi", f"/api/diagrams/{b}/pages/{pa}/connectors/con-pay-vault",
                     f"/api/diagrams/{a}/pages/{pb}/shapes/shp-payapi"):
            r = owner.get(path)
            assert r.status_code == 404 and error_code(r) == "not_found", path
        r = owner.put(f"/api/diagrams/{b}/pages/{pa}", flows_doc(pa, 2))
        assert r.status_code == 404
        assert owner.page(a, pa)["page"]["version"] == 2
    elif case == DP06_CASES[1]:
        email = fresh_email("share")
        sid = owner.post(f"/api/diagrams/{a}/shares", {"email": email, "role": "viewer"}).json()["share"]["id"]
        for r in (owner.patch(f"/api/diagrams/{b}/shares/{sid}", {"role": "editor"}), owner.delete(f"/api/diagrams/{b}/shares/{sid}")):
            assert r.status_code == 404 and error_code(r) == "not_found"
        s = owner.share_for(a, email)
        assert s["status"] == "invited" and s["role"] == "viewer"
    elif case == DP06_CASES[2]:
        r = owner.export(a, idempotency_key_value(), {"pageIds": [pa, pb]})
        assert r.status_code == 404 and error_code(r) == "not_found"
        assert owner.get(f"/api/diagrams/{a}/exports").json()["exports"] == []
        assert s3().keys(f"exports/{a}/") == []
    elif case == DP06_CASES[3]:
        r2 = owner.post(f"/api/diagrams/{a}/pages", {"name": "Second page"})
        p2 = r2.json()["page"]["id"]
        doc = flows_doc(p2, 1)
        r = owner.put(f"/api/diagrams/{a}/pages/{pa}", doc)
        assert r.status_code == 404 and error_code(r) == "not_found"
        assert owner.page(a, pa)["page"]["version"] == 2 and owner.page(a, p2)["page"]["version"] == 1
    elif case == DP06_CASES[4]:
        p = new_person(base, mail, role="viewer")
        r = p.api.put_page(p.did, blank_doc(p.pid, 1, shapes=[shp("x", "server", "X", 0, 0, 1)]))
        assert r.status_code == 403 and error_code(r) == "forbidden"
        morgan = signed_in(base, MORGAN)
        r = morgan.put_page(p.did, blank_doc(p.pid, 1))
        assert r.status_code == 404
        page = p.owner.page(p.did, p.pid)["page"]
        assert page["version"] == 1 and page["shapes"] == []
    else:
        p = new_person(base, mail, role="editor")
        r = p.api.get(f"/api/diagrams/{p.did}/audit")
        assert r.status_code == 403 and error_code(r) == "forbidden"
        r = p.api.get(f"/api/diagrams/{KESTREL_ID}/audit")
        assert r.status_code == 404 and error_code(r) == "not_found"


def idempotency_key_value() -> str:
    return "probe-" + uuid.uuid4().hex


def test_dp07_diagram_not_found_page(browser, app_url):
    base = app_url.rstrip("/")
    morgan = signed_in(base, MORGAN)
    with app_page(browser, base + "/signin") as pg:
        sign_into(pg, morgan)
        for path in (f"/d/{HARBOR_ID}/p/{FLOWS_PAGE_ID}", f"/d/{KESTREL_ID}/p/{KESTREL_PAGE_ID}"):
            resp = pg.goto(base + path)
            assert resp.status == 404
            expect(pg.get_by_role("heading", level=1)).to_have_text("Diagram not found")
            expect(pg.get_by_text("We couldn't find that diagram. It may have been deleted, or you may not have access to it.")).to_be_visible()
        resp = pg.goto(base + "/no-such-screen-" + uuid.uuid4().hex[:6])
        assert resp.status == 404
        expect(pg.get_by_role("heading", level=1)).to_have_text("Page not found")
        expect(pg.get_by_text("We couldn't find that page.")).to_be_visible()


DP48_NEXT = {
    "protocol-relative": "//evil.test/x",
    "slash backslash": "/\\evil.test",
    "absolute https": "https://evil.test",
    "javascript scheme": "javascript:alert(1)",
}


@pytest.mark.parametrize("case", list(DP48_NEXT), ids=list(DP48_NEXT))
def test_dp48_next_and_landing_routes(browser, app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Landing")
    target = f"/d/{did}/p/{pid}"
    with app_page(browser, base + "/signin") as pg:
        pg.goto(base + target)
        expect(pg).to_have_url(re.compile(r"/signin\?"))
        assert urllib.parse.parse_qs(urllib.parse.urlparse(pg.url).query)["next"] == [target]
        ui_signin(pg, DANA)
        expect(pg).to_have_url(base + target, timeout=EXPECT_MS)
        pg.goto(base + "/signin?next=" + urllib.parse.quote(DP48_NEXT[case], safe=""))
        expect(pg).to_have_url(base + "/", timeout=EXPECT_MS)
        pg.goto(base + f"/d/{did}")
        expect(pg).to_have_url(base + target, timeout=EXPECT_MS)
    with app_page(browser, base + "/signin?next=" + urllib.parse.quote(DP48_NEXT[case], safe="")) as pg:
        ui_signin(pg, DANA)
        expect(pg).to_have_url(base + "/", timeout=EXPECT_MS)


def test_dp60_delete_removes_everything(browser, app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail, role="editor")
    owner = p.owner
    assert owner.put_page(p.did, blank_doc(p.pid, 1, shapes=[shp("box", "server", "Probe box", 96, 96, 1)])).status_code == 200
    pending = fresh_email("pending")
    assert owner.post(f"/api/diagrams/{p.did}/shares", {"email": pending, "role": "viewer"}).status_code == 201
    token = invite_token(mail, pending, p.title)
    eid = owner.export(p.did, idempotency_key_value()).json()["export"]["id"]
    link = owner.link(f"/api/diagrams/{p.did}/exports/{eid}/files/png")
    iid = owner.import_file(p.did, "evidence.xml", LEGACY_XML).json()["import"]["id"]
    queued = fresh_email("queued")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, p.api, p.did, p.pid)
        md = signed_in(mail_down_url(), DANA)
        assert md.post(f"/api/diagrams/{p.did}/shares", {"email": queued, "role": "viewer"}).status_code == 201
        assert owner.delete(f"/api/diagrams/{p.did}").status_code == 204
        for path in (f"/api/diagrams/{p.did}", f"/api/diagrams/{p.did}/pages/{p.pid}", f"/api/diagrams/{p.did}/shares",
                     f"/api/diagrams/{p.did}/exports", f"/api/diagrams/{p.did}/imports", f"/api/diagrams/{p.did}/audit",
                     f"/api/diagrams/{p.did}/imports/{iid}/original", f"/api/diagrams/{p.did}/exports/{eid}/files/png", link):
            r = owner.get(path)
            assert r.status_code == 404 and error_code(r) == "not_found", path
        assert owner.delete(f"/api/diagrams/{p.did}").status_code == 404
        assert httpx.get(base + f"/api/invites/{token}", timeout=HTTP_TIMEOUT).status_code == 404
        for api in (owner, p.api):
            assert p.did not in {d["id"] for d in api.get("/api/diagrams").json()["diagrams"]}
        box = shape_btn(pg, "Probe box", "Server")
        box.focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ArrowRight")
        advance(pg, AUTOSAVE_MAX_MS + 100)
        expect(pg.get_by_role("heading", level=1)).to_have_text("Diagram not found", timeout=EXPECT_MS)
    assert mails_to(mail, queued, minimum=1, seconds=DELIVERY_MAX_S + QUIET_S) == []


def test_wf_diagram_access_viewer(browser, app_url, mail):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, title = copy_flows(owner, "Viewer")
    lee = signed_in(base, LEE)
    grant(owner, mail, did, title, lee, "viewer")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, lee, did, pid)
        puts = record(pg, "PUT", f"/pages/{pid}")
        for name, n, m in ((CDE, 3, 5), (CONNECTED, 2, 2), (OUT, 1, 1)):
            expect_tally_shows(pg, name, n, m)
        expect(markers(pg, CDE, "entering")).to_have_count(3)
        expect(markers(pg, CDE, "leaving")).to_have_count(2)
        expect(save_state(pg)).to_have_text("Read only")
        assert button(pg, "Share").count() == 0 and button(pg, "Import").count() == 0
        expect(button(pg, "Add Server")).to_be_disabled()
        zone_btn(pg, CDE).focus()
        pg.keyboard.press("Space")
        insp = pg.get_by_role("complementary", name="Inspector")
        expect(insp.get_by_role("textbox", name="Zone name")).not_to_be_editable()
        systems = insp.get_by_role("list", name=f"Systems in {CDE}").get_by_role("listitem")
        expect(systems).to_have_count(3)
        expect(systems.first).to_contain_text("Payment API")
        flows = insp.get_by_role("list", name=f"Flows crossing {CDE}").get_by_role("listitem")
        expect(flows).to_have_text([
            flow_item("con-checkout-pay", "entering"),
            flow_item("con-admin-pay", "entering"),
            flow_item("con-fraud-settle", "entering"),
            flow_item("con-pay-analytics", "leaving"),
            flow_item("con-settle-acq", "leaving"),
        ])
        seed_btn(pg, "shp-payapi").focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ArrowRight")
        advance(pg, AUTOSAVE_MAX_MS * 2)
        assert puts == []
    assert owner.page(did, pid)["page"]["version"] == 2


def test_wf_diagram_access_create(browser, app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail)
    title = fresh_title("Created")
    with app_page(browser, base + "/signin") as pg:
        sign_into(pg, p.api)
        pg.goto(base + "/")
        button(pg, "New diagram").click()
        dlg = dialog(pg, "New diagram")
        dlg.get_by_role("textbox", name="Title").fill(title)
        button(dlg, "Create diagram").click()
        expect(pg).to_have_url(re.compile(r"/d/[^/]+/p/[^/]+$"), timeout=EXPECT_MS)
        advance(pg, FADE_MS)
        expect(canvas(pg)).to_be_focused()
        did = urllib.parse.urlparse(pg.url).path.split("/")[2]
        row = next(d for d in p.api.get("/api/diagrams").json()["diagrams"] if d["id"] == did)
        assert row["title"] == title and row["role"] == "owner"
        pg.get_by_role("link", name="All diagrams").click()
        expect(pg).to_have_url(base + "/", timeout=EXPECT_MS)
        expect(pg.get_by_role("list", name="Your diagrams").get_by_role("listitem").filter(has_text=title)).to_contain_text("Owner")


DP09_CASES = ["spoofed Host header"]


@pytest.mark.parametrize("case", DP09_CASES, ids=DP09_CASES)
def test_dp09_invitation_email(app_url, mail, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    title = fresh_title("Invite")
    did, _ = owner.new_diagram(title)
    email = fresh_email("Invitee").replace("Invitee", "INVITEE")
    r = owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "editor"}, headers={"Host": SPOOFED_HOST})
    assert r.status_code == 201, r.text
    share = r.json()["share"]
    assert share["email"] == email.lower() and share["status"] == "invited" and share["role"] == "editor"
    msg = exactly_one(mail, email, title)
    assert msg["Subject"] == "You have been invited to a diagram on Scopewright"
    assert addresses(msg["From"]) in ([mail_from_address().lower()], ["no-reply@scopewright.test"]), msg["From"]
    body = text(msg)
    assert f"Dana Okafor invited you to {title} as editor." in body
    match = re.search(r"Accept: (\S+)/invite/([A-Za-z0-9_-]+)", body)
    assert match and match.group(1) == public_url(base) and SPOOFED_HOST not in body
    expires = datetime.fromisoformat(share["expiresAt"].replace("Z", "+00:00")).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert f"This link expires at {expires} (UTC)." in body
    info = httpx.get(base + f"/api/invites/{match.group(2)}", timeout=HTTP_TIMEOUT).json()["invite"]
    assert info["diagramTitle"] == title and info["inviterName"] == "Dana Okafor" and info["role"] == "editor" and info["accountExists"] is False


def test_dp10_accept_only_addressee_before_expiry(browser, app_url, mail):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    title = fresh_title("Accept")
    did, pid = owner.new_diagram(title)
    email = fresh_email("addressee")
    owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"})
    token = invite_token(mail, email, title)
    r = signed_in(base, MORGAN).post(f"/api/invites/{token}/accept", {})
    assert r.status_code == 403 and error_code(r) == "invite_email_mismatch"
    assert owner.share_for(did, email)["status"] == "invited"
    newcomer = Api(base)
    r = newcomer.post(f"/api/invites/{token}/accept", {"displayName": "Probe Addressee", "password": "Probe-pass-" + uuid.uuid4().hex[:12]})
    assert r.status_code == 200 and r.json() == {"diagramId": did, "firstPageId": pid, "role": "viewer"}
    assert owner.share_for(did, email)["status"] == "active"
    short = short_url()
    sowner = signed_in(short, DANA)
    stitle = fresh_title("Expiry")
    sdid, _ = sowner.new_diagram(stitle)
    late = fresh_email("late")
    sowner.post(f"/api/diagrams/{sdid}/shares", {"email": late, "role": "viewer"})
    stoken = invite_token(mail, late, stitle)
    wait_server_time(short, INVITE_TTL_WAIT_S)
    assert httpx.get(short + f"/api/invites/{stoken}", timeout=HTTP_TIMEOUT).status_code == 410
    r = accept(Api(short), stoken, {"displayName": "Too Late", "password": "Probe-pass-" + uuid.uuid4().hex[:12]})
    assert r.status_code == 410 and error_code(r) == "invite_expired"
    assert signed_in(short, DANA).share_for(sdid, late)["status"] == "expired"
    with app_page(browser, short + f"/invite/{stoken}") as pg:
        expect(pg.get_by_role("heading", level=1)).to_have_text("This invitation has expired", timeout=EXPECT_MS)
        expect(pg.get_by_text("Ask the diagram owner to send you a new one.")).to_be_visible()


DP11_CASES = ["foreign Origin", "Origin null", "Sec-Fetch-Site cross-site without Origin", "cross-site form post", "missing token", "token of another session", "OPTIONS preflight"]


@pytest.mark.parametrize("case", DP11_CASES, ids=DP11_CASES)
def test_dp11_cross_site_refused(app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    title = fresh_title("Csrf")
    did, _ = owner.new_diagram(title)
    renamed = fresh_title("Forged")
    path = f"/api/diagrams/{did}"
    if case == "foreign Origin":
        r, code = owner.patch(path, {"title": renamed}, headers={"Origin": "https://evil.test"}), "cross_site_request"
    elif case == "Origin null":
        r, code = owner.patch(path, {"title": renamed}, headers={"Origin": "null"}), "cross_site_request"
    elif case == "Sec-Fetch-Site cross-site without Origin":
        r, code = owner.patch(path, {"title": renamed}, headers={"Sec-Fetch-Site": "cross-site"}), "cross_site_request"
    elif case == "cross-site form post":
        r = owner.call("POST", "/api/diagrams", csrf=False, content=urllib.parse.urlencode({"title": renamed}).encode(),
                       headers={"Origin": "https://evil.test", "Content-Type": "application/x-www-form-urlencoded"})
        code = "cross_site_request"
    elif case == "missing token":
        r, code = owner.patch(path, {"title": renamed}, csrf=False), "csrf_token_invalid"
    elif case == "token of another session":
        other = signed_in(base, DANA)
        r, code = owner.patch(path, {"title": renamed}, headers={"X-CSRF-Token": other.csrf}), "csrf_token_invalid"
    else:
        r = owner.call("OPTIONS", path, headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "PATCH"})
        no_cors_headers(r)
        g = owner.get("/api/diagrams", headers={"Origin": "https://evil.test"})
        no_cors_headers(g)
        return
    assert r.status_code == 403 and error_code(r) == code, r.text
    no_cors_headers(r)
    titles = {d["title"] for d in owner.get("/api/diagrams").json()["diagrams"]}
    assert renamed not in titles and title in titles


def test_dp52_capability_tokens(app_url, mail):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    title = fresh_title("Capability")
    did, _ = owner.new_diagram(title)
    email = fresh_email("capability")
    owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"})
    token = invite_token(mail, email, title)
    assert re.fullmatch(r"[A-Za-z0-9_-]+", token)
    assert len(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))) >= 16
    assert token not in owner.get(f"/api/diagrams/{did}/shares").text
    for r in (httpx.get(base + f"/api/invites/{token}", timeout=HTTP_TIMEOUT), httpx.get(base + f"/invite/{token}", timeout=HTTP_TIMEOUT)):
        assert r.headers["referrer-policy"] == "no-referrer" and "no-store" in r.headers["cache-control"]
    clients = [Api(base) for _ in range(5)]
    body = {"displayName": "Racer", "password": "Probe-pass-" + uuid.uuid4().hex[:12]}
    results = burst([lambda c=c: c.post(f"/api/invites/{token}/accept", body) for c in clients])
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 404, 404, 404, 404], codes
    assert Api(base).post(f"/api/invites/{token}/accept", body).status_code == 404


def test_dp52_replaced_token_dies(mail):
    base = short_url()
    owner = signed_in(base, DANA)
    title = fresh_title("Replace")
    did, _ = owner.new_diagram(title)
    email = fresh_email("replace")
    first = owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"}).json()["share"]["id"]
    old = invite_token(mail, email, title)
    wait_server_time(base, INVITE_TTL_WAIT_S)
    owner = signed_in(base, DANA)
    r = owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "editor"})
    assert r.status_code == 201 and r.json()["share"]["id"] != first
    new = invite_token(mail, email, title, exclude=(old,))
    assert accept_lookup(base, old).status_code == 404
    assert accept_lookup(base, new).status_code == 200
    ids = {s["id"] for s in owner.shares(did)}
    assert first not in ids


def accept_lookup(base: str, token: str) -> httpx.Response:
    end = time.monotonic() + LOCK_WAIT_S
    while True:
        r = httpx.get(base + f"/api/invites/{token}", timeout=HTTP_TIMEOUT)
        if r.status_code != 429 or time.monotonic() > end:
            return r
        wait_server_time(base, int(r.headers.get("Retry-After", "1")) + 1)


def test_dp52_invite_and_lookup_limits(browser, mail):
    base = short_url()
    owner = signed_in(base, DANA)
    title = fresh_title("Limits")
    did, _ = owner.new_diagram(title)
    emails = [fresh_email(f"limit{i}") for i in range(INVITE_RATE_LIMIT + 1)]
    for email in emails[:INVITE_RATE_LIMIT]:
        r = owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"})
        assert r.status_code == 201, r.text
    r = owner.post(f"/api/diagrams/{did}/shares", {"email": emails[-1], "role": "viewer"})
    assert r.status_code == 429 and error_code(r) == "invite_rate_limited" and int(r.headers["Retry-After"]) >= 1
    assert owner.share_for(did, emails[-1]) is None
    valid = invite_token(mail, emails[0], title)
    limited = None
    for _ in range(LOOKUP_LIMIT + 1):
        r = httpx.get(base + f"/api/invites/{uuid.uuid4().hex}", timeout=HTTP_TIMEOUT)
        if r.status_code == 429:
            limited = r
            break
    assert limited is not None and error_code(limited) == "invite_lookup_limited"
    r = httpx.get(base + f"/api/invites/{valid}", timeout=HTTP_TIMEOUT)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1
    with app_page(browser, base + f"/invite/{valid}") as pg:
        expect(pg.get_by_role("heading", level=1)).to_have_text("Too many attempts", timeout=EXPECT_MS)
        expect(pg.get_by_text("Wait a few minutes and open the link again.")).to_be_visible()


DP64_CASES = ["email with CRLF refused", "title with non-ASCII in body only"]


@pytest.mark.parametrize("case", DP64_CASES, ids=DP64_CASES)
def test_dp64_mail_headers_carry_no_user_text(app_url, mail, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    if case == DP64_CASES[0]:
        did, _ = owner.new_diagram(fresh_title("Crlf"))
        spy = fresh_email("spy")
        r = owner.post(f"/api/diagrams/{did}/shares", {"email": f"victim@example.test\r\nBcc: {spy}", "role": "viewer"})
        assert r.status_code == 422 and error_code(r) == "validation" and "email" in r.json()["fields"]
        r = owner.patch(f"/api/diagrams/{did}", {"title": "Title\r\nBcc: " + spy})
        assert r.status_code == 422
        assert owner.shares(did) == []
        assert mails_to(mail, spy, minimum=1, seconds=QUIET_S) == []
    else:
        title = "Café Ünïon " + uuid.uuid4().hex[:8]
        did, _ = owner.new_diagram(title)
        email = fresh_email("utf")
        owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"})
        msg = exactly_one(mail, email, title)
        assert msg["Subject"] == "You have been invited to a diagram on Scopewright"
        raw = mail.raw(msg["ID"])
        head = re.split(r"\r?\n\r?\n", raw, maxsplit=1)[0]
        assert head.isascii() and "Dana Okafor" not in head and title not in head
        parsed = message_from_string(raw)
        assert parsed.get_content_type() == "text/plain" and parsed.get_content_charset() == "utf-8"
        assert str(parsed["Content-Transfer-Encoding"]).strip().lower() == "quoted-printable"
        assert f"Dana Okafor invited you to {title} as viewer." in text(msg)


def test_wf_share_invite_dialog(browser, app_url, mail):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, title = copy_flows(owner, "Share")
    email = fresh_email("engineer")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        button(pg, "Share").click()
        dlg = dialog(pg, "Share diagram")
        dlg.get_by_role("textbox", name="Email").fill(email)
        select(dlg.get_by_role("combobox", name="Role", exact=True), "Editor")
        button(dlg, "Send invitation").click()
        announced(pg, announcements(pg), f"Invitation created for {email}.")
        expect(dlg.get_by_role("table", name="People with access").get_by_role("row").filter(has_text=email)).to_be_visible()
    token = invite_token(mail, email, title)
    with app_page(browser, base + f"/invite/{token}") as pg:
        expect(pg.get_by_role("heading", level=1)).to_be_visible(timeout=EXPECT_MS)
        pg.get_by_role("textbox", name="Display name").fill("Probe Engineer")
        pg.get_by_label("Password", exact=True).fill("Probe-pass-" + uuid.uuid4().hex[:12])
        button(pg, "Accept invitation").click()
        expect(pg).to_have_url(base + f"/d/{did}/p/{pid}", timeout=EXPECT_MS)
    share = owner.share_for(did, email)
    assert share["status"] == "active" and share["role"] == "editor"


def test_wf_share_invite_signin_to_accept(browser, app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail)
    did, pid, title = copy_flows(p.owner, "Existing")
    p.owner.post(f"/api/diagrams/{did}/shares", {"email": p.email, "role": "viewer"})
    token = invite_token(mail, p.email, title)
    with app_page(browser, base + f"/invite/{token}") as pg:
        pg.get_by_role("link", name="Sign in to accept").click()
        expect(pg).to_have_url(re.compile(r"/signin\?"), timeout=EXPECT_MS)
        assert urllib.parse.parse_qs(urllib.parse.urlparse(pg.url).query)["next"] == [f"/invite/{token}"]
        ui_signin(pg, (p.email, p.password))
        expect(pg).to_have_url(base + f"/invite/{token}", timeout=EXPECT_MS)
        button(pg, "Accept invitation").click()
        expect(pg).to_have_url(base + f"/d/{did}/p/{pid}", timeout=EXPECT_MS)
    assert {d["id"]: d["role"] for d in p.api.get("/api/diagrams").json()["diagrams"]}[did] == "viewer"


def test_dp13_share_state_machine(app_url, mail):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    title = fresh_title("States")
    did, _ = owner.new_diagram(title)
    email = fresh_email("states")
    sid = owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "editor"}).json()["share"]["id"]
    first_token = invite_token(mail, email, title)
    r = owner.post(f"/api/diagrams/{did}/shares", {"email": email.upper(), "role": "editor"})
    assert r.status_code == 409 and error_code(r) == "invite_pending"
    r = owner.post(f"/api/diagrams/{did}/shares", {"email": DANA[0], "role": "viewer"})
    assert r.status_code == 409 and error_code(r) == "already_member"
    r = owner.patch(f"/api/diagrams/{did}/shares/{sid}", {"role": "viewer"})
    assert r.status_code == 409 and error_code(r) == "share_pending"
    assert owner.delete(f"/api/diagrams/{did}/shares/{sid}").status_code == 204
    for r in (owner.delete(f"/api/diagrams/{did}/shares/{sid}"), owner.patch(f"/api/diagrams/{did}/shares/{sid}", {"role": "viewer"})):
        assert r.status_code == 409 and error_code(r) == "share_ended"
    sid2 = owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "editor"}).json()["share"]["id"]
    token = invite_token(mail, email, title, exclude=(first_token,))
    assert accept(Api(base), token, {"displayName": "State Probe", "password": "Probe-pass-" + uuid.uuid4().hex[:12]}).status_code == 200
    r = owner.patch(f"/api/diagrams/{did}/shares/{sid2}", {"role": "editor"})
    assert r.status_code == 200 and r.json()["share"]["role"] == "editor"
    r = owner.patch(f"/api/diagrams/{did}/shares/{sid2}", {"role": "viewer"})
    assert r.status_code == 200 and r.json()["share"]["role"] == "viewer" and r.json()["share"]["status"] == "active"
    r = owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"})
    assert r.status_code == 409 and error_code(r) == "already_member"
    assert owner.delete(f"/api/diagrams/{did}/shares/{sid2}").status_code == 204
    r = owner.patch(f"/api/diagrams/{did}/shares/{sid2}", {"role": "editor"})
    assert r.status_code == 409 and error_code(r) == "share_ended"
    assert owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"}).status_code == 201
    assert Api(base).post(f"/api/invites/{token}/accept", {}).status_code == 404


def test_dp14_role_change_applies_next_request(app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail, role="editor")
    assert p.api.put_page(p.did, blank_doc(p.pid, 1, shapes=[shp("a", "server", "A", 0, 0, 1)])).status_code == 200
    sid = p.owner.share_for(p.did, p.email)["id"]
    assert p.owner.patch(f"/api/diagrams/{p.did}/shares/{sid}", {"role": "viewer"}).status_code == 200
    r = p.api.put_page(p.did, blank_doc(p.pid, 2))
    assert r.status_code == 403 and error_code(r) == "forbidden"
    assert p.api.page(p.did, p.pid)["page"]["version"] == 2
    assert p.owner.delete(f"/api/diagrams/{p.did}/shares/{sid}").status_code == 204
    r = p.api.get(f"/api/diagrams/{p.did}/pages/{p.pid}")
    assert r.status_code == 404 and error_code(r) == "not_found"


def test_dp15_access_changed_notice(app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail, role="editor")
    sid = p.owner.share_for(p.did, p.email)["id"]
    p.owner.patch(f"/api/diagrams/{p.did}/shares/{sid}", {"role": "viewer"})
    msg = exactly_one(mail, p.email, f"Your role on {p.title} is now viewer.")
    assert msg["Subject"] == "Your access to a diagram on Scopewright changed"
    p.owner.delete(f"/api/diagrams/{p.did}/shares/{sid}")
    msg = exactly_one(mail, p.email, f"You no longer have access to {p.title}.")
    assert msg["Subject"] == "Your access to a diagram on Scopewright changed"


def test_dp49_share_refresh_and_banner_survive_timers(browser, app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail, role="editor")
    p.owner.put_page(p.did, blank_doc(p.pid, 1, shapes=[shp("box", "server", "Probe box", 96, 96, 1)]))
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, p.owner, p.did, p.pid)
        button(pg, "Share").click()
        dlg = dialog(pg, "Share diagram")
        email = dlg.get_by_role("textbox", name="Email")
        email.fill(NOT_AN_EMAIL)
        role = dlg.get_by_role("combobox", name="Role", exact=True)
        select(role, "Viewer")
        button(dlg, "Send invitation").click()
        expect(dlg.get_by_text("Enter a valid email address.")).to_be_visible(timeout=EXPECT_MS)
        email.focus()
        for _ in range(3):
            refresh_shares(pg, p.did)
        expect(email).to_have_value(NOT_AN_EMAIL)
        assert combo_label(role) == "Viewer"
        expect(dlg.get_by_text("Enter a valid email address.")).to_be_visible()
        expect(email).to_be_focused()
        button(dlg, f"Remove {p.email}").click()
        confirm = pg.get_by_role("alertdialog", name="Remove access")
        advance(pg, FADE_MS)
        expect(button(confirm, "Cancel")).to_be_focused()
        refresh_shares(pg, p.did)
        expect(confirm).to_be_visible()
        expect(button(confirm, "Cancel")).to_be_focused()
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, p.api, p.did, p.pid)
        puts = record(pg, "PUT", f"/pages/{p.pid}")
        sid = p.owner.share_for(p.did, p.email)["id"]
        assert p.owner.patch(f"/api/diagrams/{p.did}/shares/{sid}", {"role": "viewer"}).status_code == 200
        box = shape_btn(pg, "Probe box", "Server")
        box.focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ArrowRight")
        advance(pg, AUTOSAVE_MAX_MS + 100)
        banner = pg.get_by_role("alert").filter(has_text="Your role on this diagram is now viewer. Your last change was not saved.")
        expect(banner).to_be_visible(timeout=EXPECT_MS)
        for _ in range(6):
            advance(pg, SHARE_REFRESH_MS)
            pg.keyboard.press("ArrowRight")
        expect(banner).to_be_visible()
        expect(save_state(pg)).to_have_text("Read only")
        assert len(puts) == 1


def test_dp55_share_dialog_by_keyboard(browser, app_url, mail):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, title = copy_flows(owner, "Keyboard share")
    x = add_member(owner, mail, did, title, "editor")
    y = add_member(owner, mail, did, title, "viewer")
    z = fresh_email("pending")
    owner.post(f"/api/diagrams/{did}/shares", {"email": z, "role": "viewer"})
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        patches = record(pg, "PATCH", f"/api/diagrams/{did}/shares/")
        button(pg, "Share").focus()
        pg.keyboard.press("Enter")
        advance(pg, FADE_MS)
        dlg = dialog(pg, "Share diagram")
        dlg.get_by_role("textbox", name="Email").focus()
        names = ["Email"] + focus_names(pg, 12)
        run = ["Email", "Role", "Send invitation", f"Role for {x}", f"Remove {x}", f"Role for {y}", f"Remove {y}", f"Withdraw invitation for {z}"]
        assert any(names[i:i + len(run)] == run for i in range(len(names))), names
        combo = dlg.get_by_role("combobox", name=f"Role for {x}")
        combo.focus()
        pg.keyboard.press("ArrowDown")
        announced(pg, announcements(pg), f"Access updated for {x}.")
        expect(combo).to_be_focused()
        poll(lambda: len(patches) >= 1)
        assert len(patches) == 1
        remove_y = button(dlg, f"Remove {y}")
        remove_y.focus()
        pg.keyboard.press("Enter")
        advance(pg, FADE_MS)
        confirm = pg.get_by_role("alertdialog", name="Remove access")
        expect(button(confirm, "Cancel")).to_be_focused()
        pg.keyboard.press("Tab")
        expect(button(confirm, "Remove access")).to_be_focused()
        pg.keyboard.press("Tab")
        expect(button(confirm, "Cancel")).to_be_focused()
        pg.keyboard.press("Shift+Tab")
        expect(button(confirm, "Remove access")).to_be_focused()
        pg.keyboard.press("Escape")
        advance(pg, FADE_MS)
        expect(confirm).to_be_hidden()
        expect(remove_y).to_be_focused()
        pg.keyboard.press("Enter")
        advance(pg, FADE_MS)
        pg.keyboard.press("Tab")
        pg.keyboard.press("Enter")
        announced(pg, announcements(pg), f"Removed {y}.")
        advance(pg, FADE_MS)
        withdraw = button(dlg, f"Withdraw invitation for {z}")
        expect(withdraw).to_be_focused()
        pg.keyboard.press("Enter")
        announced(pg, announcements(pg), f"Invitation withdrawn for {z}.")
        advance(pg, FADE_MS)
        expect(combo).to_be_focused()
    assert owner.share_for(did, x)["role"] == "viewer"
    assert owner.share_for(did, y) is None and owner.share_for(did, z) is None


DP66_CASES = ["editor 403", "non-member 404", "PATCH 405", "replay writes no event"]


@pytest.mark.parametrize("case", DP66_CASES, ids=DP66_CASES)
def test_dp66_audit_trail(app_url, mail, case):
    base = app_url.rstrip("/")
    if case == "editor 403":
        p = new_person(base, mail, role="editor")
        actions = [(e["action"], e["detail"]) for e in p.owner.audit(p.did)]
        assert ("share.invited", {"email": p.email, "role": "editor"}) in actions
        assert ("share.accepted", {"email": p.email, "role": "editor"}) in actions
        r = p.api.get(f"/api/diagrams/{p.did}/audit")
        assert r.status_code == 403 and error_code(r) == "forbidden"
    elif case == "non-member 404":
        owner = signed_in(base, DANA)
        did, _ = owner.new_diagram(fresh_title("Audit"))
        r = signed_in(base, MORGAN).get(f"/api/diagrams/{did}/audit")
        assert r.status_code == 404 and error_code(r) == "not_found"
        short = short_url()
        p = new_person(short, mail)
        clear_lock(short, (p.email, p.password))
        wrong = "Wrong-pass-" + uuid.uuid4().hex[:8]
        for _ in range(PAIR_LIMIT):
            raw_signin(short, p.email, wrong)
        me = signed_in(short, (p.email, p.password))
        events = me.get("/api/account/audit").json()["events"]
        assert [e["action"] for e in events].count("signin.failed") >= PAIR_LIMIT - 1
        assert [e["action"] for e in events].count("signin.locked") == 1
        assert all("ip" in e["detail"] for e in events if e["action"].startswith("signin."))
        assert wrong not in json.dumps(events)
        morgan_events = signed_in(short, MORGAN).get("/api/account/audit").json()["events"]
        assert all(e["actor"] != p.email for e in morgan_events)
    elif case == "PATCH 405":
        owner = signed_in(base, DANA)
        did, _ = owner.new_diagram(fresh_title("Audit"))
        before = len(owner.audit(did))
        for method in ("PATCH", "POST", "DELETE", "PUT"):
            for path in (f"/api/diagrams/{did}/audit", "/api/account/audit"):
                for api in (owner, Api(base)):
                    r = api.call(method, path, {})
                    assert r.status_code == 405 and error_code(r) == "method_not_allowed" and r.headers["allow"] == "GET"
        assert len(owner.audit(did)) == before
    else:
        owner = signed_in(base, DANA)
        did, _, _ = one_box(owner, "Audit replay")
        key = idempotency_key_value()
        eid = owner.export(did, key).json()["export"]["id"]
        replay = owner.export(did, key)
        assert replay.status_code == 201 and replay.headers.get("Idempotent-Replayed") == "true"
        created = [e for e in owner.audit(did) if e["action"] == "export.created" and e["detail"] == {"exportId": eid}]
        assert len(created) == 1


def test_wf_role_change_downgrade(browser, app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail, role="editor")
    p.owner.put_page(p.did, flows_doc(p.pid))
    with app_page(browser, base + "/signin") as eng:
        open_editor(eng, p.api, p.did, p.pid)
        puts = record(eng, "PUT", f"/pages/{p.pid}")
        with app_page(browser, base + "/signin") as lead:
            open_editor(lead, p.owner, p.did, p.pid)
            button(lead, "Share").click()
            dlg = dialog(lead, "Share diagram")
            select(dlg.get_by_role("combobox", name=f"Role for {p.email}"), "Viewer")
            announced(lead, announcements(lead), f"Access updated for {p.email}.")
        assert p.owner.share_for(p.did, p.email)["role"] == "viewer"
        seed_btn(eng, "shp-payapi").focus()
        eng.keyboard.press("Space")
        eng.keyboard.press("ArrowRight")
        advance(eng, AUTOSAVE_MAX_MS + 100)
        expect(eng.get_by_role("alert").filter(has_text="Your role on this diagram is now viewer. Your last change was not saved.")).to_be_visible(timeout=EXPECT_MS)
        expect(save_state(eng)).to_have_text("Read only")
        expect(button(eng, "Add Server")).to_be_disabled()
        assert len(puts) == 1
    page = p.owner.page(p.did, p.pid)["page"]
    assert next(s for s in page["shapes"] if s["id"] == "shp-payapi")["x"] == FLOW_BY_ID["shp-payapi"][2]


def test_wf_role_change_remove(browser, app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail, role="editor")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, p.owner, p.did, p.pid)
        button(pg, "Share").click()
        dlg = dialog(pg, "Share diagram")
        button(dlg, f"Remove {p.email}").click()
        button(pg.get_by_role("alertdialog", name="Remove access"), "Remove access").click()
        announced(pg, announcements(pg), f"Removed {p.email}.")
    assert p.owner.share_for(p.did, p.email) is None
    assert ("share.revoked", {"email": p.email}) in [(e["action"], e["detail"]) for e in p.owner.audit(p.did)]
    exactly_one(mail, p.email, f"You no longer have access to {p.title}.")
    assert p.api.get(f"/api/diagrams/{p.did}").status_code == 404


def test_dp17_version_conflict(app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = one_box(owner, "Race")
    docs = [blank_doc(pid, 2, shapes=[shp("box", "server", label, 96, 96, 1)]) for label in ("Left", "Right")]
    other = signed_in(base, DANA)
    results = burst([lambda: owner.put_page(did, docs[0]), lambda: other.put_page(did, docs[1])])
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409], codes
    loser = next(r for r in results if r.status_code == 409)
    assert error_code(loser) == "version_conflict"
    winner = next(i for i, r in enumerate(results) if r.status_code == 200)
    page = owner.page(did, pid)["page"]
    assert page["version"] == 3 and page["shapes"][0]["label"] == docs[winner]["shapes"][0]["label"]


def test_dp18_server_refuses_dangling_connectors(app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid = owner.new_diagram(fresh_title("Dangling"))
    a, b = shp("a", "server", "A", 96, 96, 1), shp("b", "server", "B", 336, 96, 2)
    good = [[240, 132], [336, 132]]
    variants = [
        con("c1", "", "a", "e", "b", "w", [[241, 132], [336, 132]]),
        con("c1", "", "a", "e", "ghost", "w", good),
        con("c1", "", "a", "e", "b", "w", [[240, 132], [288, 180], [336, 132]]),
    ]
    for bad in variants:
        r = owner.put_page(did, blank_doc(pid, 1, shapes=[a, b], connectors=[bad]))
        fields = json.dumps(r.json().get("fields", {}))
    assert r.status_code == 422 and error_code(r) == "dangling_connector" and ("c1" in fields or "connectors" in fields), fields
    assert owner.page(did, pid)["page"]["version"] == 1
    r = owner.put_page(did, blank_doc(pid, 1, shapes=[a, b], connectors=[con("c1", "", "a", "e", "b", "w", good)]))
    assert r.status_code == 200 and r.json()["page"]["version"] == 2


def test_dp19_library_search(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid = owner.new_diagram(fresh_title("Library"))
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        lib = pg.get_by_role("complementary", name="Shape library")
        adds = lib.get_by_role("button", name=re.compile(r"^Add "))
        for name in SYSTEM_KINDS.values():
            expect(button(lib, f"Add {name}")).to_be_visible()
        for name in ZONE_KINDS.values():
            expect(button(lib, f"Add {name} zone")).to_be_visible()
        total = len(SYSTEM_KINDS) + len(ZONE_KINDS)
        expect(adds).to_have_count(total)
        search = lib.get_by_role("searchbox", name="Search shapes")
        search.fill("  DATA ")
        expect(adds).to_have_count(2)
        expect(button(lib, "Add Database")).to_be_visible()
        expect(button(lib, "Add Cardholder data environment zone")).to_be_visible()
        expect(pg.get_by_text("No shapes match your search.").first).to_be_hidden()
        for miss in ("cde", "Connected-to systems"):
            search.fill(miss)
            expect(adds).to_have_count(0)
            expect(pg.get_by_text("No shapes match your search.")).to_be_visible()
        search.fill("   ")
        expect(adds).to_have_count(total)


def test_dp20_keyboard_place_and_nudge(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid = owner.new_diagram(fresh_title("Place"))
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        box = canvas(pg).bounding_box()
        ex, ey = snap(box["width"] / 2 - NEW_SHAPE_W / 2), snap(box["height"] / 2 - NEW_SHAPE_H / 2)
        button(pg, "Add Server").focus()
        pg.keyboard.press("Enter")
        placed = shape_btn(pg, "Server", "Server")
        expect(placed).to_be_visible()
        wait_saved(pg)
        s = owner.page(did, pid)["page"]["shapes"][0]
        assert (s["x"], s["y"], s["width"], s["height"], s["kind"], s["label"]) == (ex, ey, NEW_SHAPE_W, NEW_SHAPE_H, "server", "Server")
        placed.focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ArrowRight")
        pg.keyboard.press("Shift+ArrowDown")
        pg.keyboard.press("ControlOrMeta+s")
        wait_saved(pg)
        s = owner.page(did, pid)["page"]["shapes"][0]
        assert (s["x"], s["y"]) == (ex + NUDGE, ey + NUDGE_SHIFT)


def test_dp21_keyboard_edit_suite(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Keyboard")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        key = pg.keyboard.press
        seed_btn(pg, "shp-fraud").focus()
        key("c")
        announced(pg, announcements(pg), "Choose a shape to connect to. Press Escape to cancel.")
        target = seed_btn(pg, "shp-acquirer")
        for _ in range(10):
            if target.evaluate("e => e === document.activeElement"):
                break
            key("Tab")
        key("Enter")
        announced(pg, announcements(pg), connected_sentence(seed_label("shp-fraud"), seed_label("shp-acquirer")))
        link = pg.get_by_role("button", name=connector_name(seed_label("shp-fraud"), seed_label("shp-acquirer")), exact=True)
        link.focus()
        key("F2")
        label = pg.get_by_role("complementary", name="Inspector").get_by_role("textbox", name="Label")
        expect(label).to_be_focused()
        key("ControlOrMeta+a")
        pg.keyboard.type(NEW_LABEL)
        key("Enter")
        expect(link).to_be_focused()
        wait_saved(pg)
        doc = owner.page(did, pid)["page"]
        new = next(c for c in doc["connectors"] if c["from"]["shapeId"] == "shp-fraud" and c["to"]["shapeId"] == "shp-acquirer")
        assert new["label"] == NEW_LABEL and new["from"]["port"] == "e" and new["to"]["port"] == "w"
        assert straightened(new["points"]) == [list(port(shp("f", "", "", 600, 600, 0), "e")), list(port(shp("a", "", "", 1224, 600, 0), "w"))]
        seed_btn(pg, "shp-payapi").focus()
        key("Space")
        seed_btn(pg, "shp-vault").focus()
        key("Shift+Space")
        key("ControlOrMeta+g")
        seed_btn(pg, "shp-fraud").focus()
        key("Shift+Space")
        key("Alt+Shift+ArrowDown")
        wait_saved(pg)
        doc = owner.page(did, pid)["page"]
        by = {s["id"]: s for s in doc["shapes"]}
        fraud_bottom = FLOW_BY_ID["shp-fraud"][3] + NEW_SHAPE_H
        assert by["shp-vault"]["y"] + NEW_SHAPE_H == fraud_bottom
        assert by["shp-vault"]["y"] - by["shp-payapi"]["y"] == FLOW_BY_ID["shp-vault"][3] - FLOW_BY_ID["shp-payapi"][3]
        assert by["shp-payapi"]["groupId"] and by["shp-payapi"]["groupId"] == by["shp-vault"]["groupId"]
        assert_attached(doc)
        key("ControlOrMeta+d")
        wait_saved(pg)
        dup = owner.page(did, pid)["page"]
        assert len(dup["shapes"]) == len(doc["shapes"]) + 3 and len(dup["connectors"]) == len(doc["connectors"]) + 1
        copies = [s for s in dup["shapes"] if s["id"] not in by]
        assert min(c["z"] for c in copies) > max(s["z"] for s in doc["shapes"])
        group_copies = [c for c in copies if c["groupId"]]
        assert len(group_copies) == 2 and group_copies[0]["groupId"] == group_copies[1]["groupId"] != by["shp-payapi"]["groupId"]
        assert {(c["label"], c["x"], c["y"]) for c in copies} == {(by[i]["label"], by[i]["x"] + DUPLICATE_OFFSET, by[i]["y"] + DUPLICATE_OFFSET) for i in ("shp-payapi", "shp-vault", "shp-fraud")}
        assert_attached(dup)
        key("ControlOrMeta+z")
        wait_saved(pg)
        assert len(owner.page(did, pid)["page"]["shapes"]) == len(doc["shapes"])
        key("ControlOrMeta+Shift+Z")
        wait_saved(pg)
        assert len(owner.page(did, pid)["page"]["shapes"]) == len(doc["shapes"]) + 3
        key("ControlOrMeta+z")
        seed_btn(pg, "shp-payapi").focus()
        key("Space")
        key("ControlOrMeta+Shift+G")
        seed_btn(pg, "shp-acquirer").focus()
        key("Space")
        key("Delete")
        wait_saved(pg)
        final = owner.page(did, pid)["page"]
        ids = {s["id"]: s for s in final["shapes"]}
        assert "shp-acquirer" not in ids and len(ids) == len(doc["shapes"]) - 1
        assert ids["shp-payapi"]["groupId"] is None and ids["shp-vault"]["groupId"] is None
        assert all("shp-acquirer" not in (c["from"]["shapeId"], c["to"]["shapeId"]) for c in final["connectors"])
        assert_attached(final)


DP22_CASES = ["<b>a<i>b</b>c</i>", "<i><b>x</b></i>", "</b>y<b>", "<b><b>z</b></b>", "<img src=x onerror=alert(1)>"]
DP22_RENDER = {
    "<b>a<i>b</b>c</i>": ("<b>a[I]b</b>c[/I]", "<b>ab</b>c"),
    "<i><b>x</b></i>": ("[BI]x[/BI]", "x"),
    "</b>y<b>": ("</b>y<b>", "</b>y<b>"),
    "<b><b>z</b></b>": ("[B]z[/B]", "z"),
    "<img src=x onerror=alert(1)>": ("<img src=x onerror=alert(1)>", "<img src=x onerror=alert(1)>"),
}
LABEL_BASE_JS = """(root, label) => { let best = root;
 for (const el of root.querySelectorAll('*')) if (el.textContent.includes(label)) best = el;
 const s = getComputedStyle(best); return [parseInt(s.fontWeight), s.fontStyle]; }"""
RUNS_JS = """(root, ref) => { const out = []; const base = getComputedStyle(root);
 const bw = ref ? ref[0] : parseInt(base.fontWeight), bs = ref ? ref[1] : base.fontStyle;
 const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
 while ((n = w.nextNode())) { if (!n.data) continue; let b = false, i = false;
  for (let el = n.parentElement; el && el !== root; el = el.parentElement) {
   const s = getComputedStyle(el), tag = el.tagName.toUpperCase();
   if (tag === 'B' || tag === 'STRONG' || parseInt(s.fontWeight) > bw) b = true;
   if (tag === 'I' || tag === 'EM' || (s.fontStyle !== bs && s.fontStyle !== 'normal')) i = true; }
  out.push([n.data, b, i]); } return out; }"""


def canonical(runs: list) -> str:
    merged: list = []
    for t, b, i in runs:
        if merged and merged[-1][1:] == [b, i]:
            merged[-1][0] += t
        else:
            merged.append([t, b, i])
    out = ""
    for t, b, i in merged:
        tag = ("B" if b else "") + ("I" if i else "")
        out += f"[{tag}]{t}[/{tag}]" if tag else t
    return out


@pytest.mark.parametrize("case", DP22_CASES, ids=DP22_CASES)
def test_dp22_label_stack_rule(browser, app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid = owner.new_diagram(fresh_title("Labels"))
    doc = blank_doc(pid, 1, zones=[zone("zn", "connected", PROBE_ZONE, 480, 48, 480, 336, note=case)],
                    shapes=[shp("s1", "api_service", case, 96, 96, 1), shp("s2", "server", "Plain box", 96, 288, 2)],
                    connectors=[con("c1", case, "s1", "s", "s2", "n", [[168, 168], [168, 288]])])
    assert owner.put_page(did, doc).status_code == 200
    stored = owner.page(did, pid)["page"]
    assert stored["shapes"][0]["label"] == case and stored["connectors"][0]["label"] == case and stored["zones"][0]["note"] == case
    expected, plain = DP22_RENDER[case]
    with app_page(browser, base + "/signin") as pg:
        dialogs: list = []
        pg.on("dialog", lambda d: (dialogs.append(d.type), d.dismiss()))
        open_editor(pg, owner, did, pid)
        item = shape_btn(pg, plain, "API service")
        expect(item).to_be_visible()
        reference = shape_btn(pg, "Plain box", "Server")
        expect(reference).to_be_visible()
        label_base = reference.evaluate(LABEL_BASE_JS, "Plain box")
        assert expected in canonical(item.evaluate(RUNS_JS, label_base))
        note = pg.get_by_role("note", name=f"{PROBE_ZONE} note")
        assert expected in canonical(note.evaluate(RUNS_JS, None))
        advance(pg, 500)
        assert dialogs == []


def test_dp59_layer_order_announced(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Layers")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        puts = record(pg, "PUT", f"/pages/{pid}")
        ann = announcements(pg)
        pay = seed_btn(pg, "shp-payapi")
        pay.focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ControlOrMeta+]")
        announced(pg, ann, f"{seed_label('shp-payapi')} brought forward. Layer 4 of {len(FLOW_SHAPES)}.")
        expect(pay).to_be_focused()
        wait_saved(pg)
        z = {s["id"]: s["z"] for s in owner.page(did, pid)["page"]["shapes"]}
        assert z["shp-payapi"] == 4 and z["shp-vault"] == 3
        sent = len(puts)
        fraud = seed_btn(pg, "shp-fraud")
        fraud.focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ControlOrMeta+]")
        announced(pg, ann, f"{seed_label('shp-fraud')} is already at the front.")
        expect(fraud).to_be_focused()
        seed_btn(pg, "shp-checkout").focus()
        pg.keyboard.press("Space")
        back = button(pg.get_by_role("complementary", name="Inspector"), "Send backward")
        back.focus()
        pg.keyboard.press("Enter")
        announced(pg, ann, f"{seed_label('shp-checkout')} is already at the back.")
        expect(back).to_be_focused()
        advance(pg, AUTOSAVE_MAX_MS * 2)
        expect(save_state(pg)).to_have_text("Saved")
        assert len(puts) == sent
        seed_btn(pg, "shp-vault").focus()
        pg.keyboard.press("Space")
        pay.focus()
        pg.keyboard.press("Shift+Space")
        pg.keyboard.press("ControlOrMeta+[")
        pair = len(["shp-vault", "shp-payapi"])
        announced(pg, ann, f"{pair} shapes sent backward.")
        wait_saved(pg)
        z = {s["id"]: s["z"] for s in owner.page(did, pid)["page"]["shapes"]}
        assert (z["shp-checkout"], z["shp-vault"], z["shp-payapi"], z["shp-admin"]) == (1, 2, 3, 4)
        sent = len(puts)
        seed_btn(pg, "shp-checkout").focus()
        pg.keyboard.press("Space")
        seed_btn(pg, "shp-vault").focus()
        pg.keyboard.press("Shift+Space")
        pg.keyboard.press("ControlOrMeta+[")
        announced(pg, ann, f"{pair} shapes are already at the back.")
        advance(pg, AUTOSAVE_MAX_MS * 2)
        assert len(puts) == sent


def test_dp46_autosave_single_flight(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = one_box(owner, "Autosave")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        puts = record(pg, "PUT", f"/pages/{pid}")
        box = shape_btn(pg, "Probe box", "Server")
        box.focus()
        pg.keyboard.press("Space")
        with held(pg, f"**/api/diagrams/{did}/pages/{pid}") as gate:
            pg.keyboard.press("ArrowRight")
            advance(pg, AUTOSAVE_MAX_MS + 100)
            poll(lambda: len(puts) == 1)
            expect(save_state(pg)).to_have_text("Saving...")
            pg.keyboard.press("ArrowRight")
            pg.keyboard.press("ArrowDown")
            advance(pg, AUTOSAVE_MAX_MS * 2)
            pg.keyboard.press("ControlOrMeta+s")
            advance(pg, 100)
            assert len(puts) == 1
            expect(save_state(pg)).to_have_text("Saving...")
            gate.release()
        wait_saved(pg)
        assert len(puts) == 2
        assert [json.loads(r.post_data)["version"] for r in puts] == [2, 3]
        expect(pg.get_by_text("Someone else saved this page. Reload to see their changes.")).to_have_count(0)
    page = owner.page(did, pid)["page"]
    assert page["version"] == 4 and (page["shapes"][0]["x"], page["shapes"][0]["y"]) == (96 + 2 * NUDGE, 96 + NUDGE)


def test_wf_keyboard_redraw_journey(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Journey one")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        conflicts: list = []
        pg.on("response", lambda r: conflicts.append(r) if r.status == 409 else None)
        key = pg.keyboard.press
        add = button(pg, "Add API service")
        add.focus()
        assert focus_ring_visible(pg)
        key("Enter")
        new = shape_btn(pg, "API service", "API service")
        expect(new).to_be_visible()
        wait_saved(pg)
        placed = next(s for s in owner.page(did, pid)["page"]["shapes"] if s["label"] == "API service")
        cde_x = FLOW_ZONES[1]["x"]
        new.focus()
        key("Space")
        assert focus_ring_visible(pg)
        for _ in range(max(1, math.ceil((cde_x - NEW_SHAPE_W / 2 - placed["x"]) / NUDGE_SHIFT))):
            key("Shift+ArrowRight")
        advance(pg, TALLY_MAX_MS)
        announced(pg, announcements(pg), f"API service moved into {CDE}.")
        key("c")
        vault = seed_btn(pg, "shp-vault")
        for _ in range(12):
            if vault.evaluate("e => e === document.activeElement"):
                break
            key("Tab")
        key("Enter")
        announced(pg, announcements(pg), connected_sentence(SYSTEM_KINDS["api_service"], seed_label("shp-vault")))
        link = pg.get_by_role("button", name=connector_name(SYSTEM_KINDS["api_service"], seed_label("shp-vault")), exact=True)
        link.focus()
        key("Enter")
        until_true(pg, lambda: pg.evaluate("() => { const e = document.activeElement; return !!e && (e.tagName === 'INPUT' "
                                           "|| e.tagName === 'TEXTAREA' || e.isContentEditable); }"),
                   "focus to move to the inspector's Label field")
        key("ControlOrMeta+a")
        pg.keyboard.type(JOURNEY_LABEL)
        key("Enter")
        until_true(pg, lambda: link.evaluate("e => e === document.activeElement"), "focus to return to the connector")
        assert focus_ring_visible(pg)
        new.focus()
        key("Space")
        seed_btn(pg, "shp-payapi").focus()
        key("Shift+Space")
        key("ControlOrMeta+g")
        seed_btn(pg, "shp-settle").focus()
        key("Shift+Space")
        key("Alt+Shift+ArrowLeft")
        seed_btn(pg, "shp-payapi").focus()
        key("Space")
        key("ControlOrMeta+]")
        announced(pg, announcements(pg), "brought forward.")
        key("ControlOrMeta+d")
        key("ControlOrMeta+z")
        assert focus_ring_visible(pg)
        wait_saved(pg)
        saved = owner.page(did, pid)
        assert len(saved["page"]["shapes"]) == len(FLOW_SHAPES) + 1
        assert any(c["label"] == JOURNEY_LABEL for c in saved["page"]["connectors"])
        new_id = next(s["id"] for s in saved["page"]["shapes"] if s["label"] == "API service")
        assert new_id in zone_derived(saved["derived"], "zone-cde")["members"]
        assert_attached(saved["page"])
        assert conflicts == []
        pg.reload()
        advance(pg, 100)
        for z in FLOW_ZONES:
            d = zone_derived(saved["derived"], z["id"])
            expect_tally_shows(pg, z["name"], d["systems"], d["crossings"])
    assert owner.page(did, pid)["page"] == saved["page"]


def test_wf_keyboard_redraw_conflict(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = one_box(owner, "Conflict")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        assert owner.put_page(did, blank_doc(pid, 2, shapes=[shp("box", "server", "Elsewhere", 96, 96, 1)])).status_code == 200
        box = shape_btn(pg, "Probe box", "Server")
        box.focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ArrowRight")
        advance(pg, AUTOSAVE_MAX_MS + 100)
        banner = pg.get_by_role("alert").filter(has_text="Someone else saved this page. Reload to see their changes.")
        expect(banner).to_be_visible(timeout=EXPECT_MS)
        expect(save_state(pg)).to_have_text("Not saved")
        button(banner, "Reload page").click()
        expect(banner).to_be_hidden(timeout=EXPECT_MS)
        expect(save_state(pg)).to_have_text("Saved")
        expect(shape_btn(pg, "Elsewhere", "Server")).to_be_visible()
    assert owner.page(did, pid)["page"]["version"] == 3


DP24_CASES = ["ends on a port on the edge", "runs along an edge then leaves", "passes through a corner", "half-unit centre on an edge", "touches and returns", "enters and leaves counts twice"]
ZX, ZY, ZW, ZH = 240, 240, 480, 480


def dp24_case(case: str) -> tuple[list, list, list, list]:
    if case == DP24_CASES[0]:
        a, b = shp("a", "server", "A", 0, 444, 1), shp("b", "server", "B", ZX, 444, 2)
        return [a, b], [con("c", "", "a", "e", "b", "w", [port(a, "e"), port(b, "w")])], ["b"], []
    if case == DP24_CASES[1]:
        a, b = shp("a", "server", "A", 336, 300, 1), shp("b", "server", "B", 528, 28, 2)
        pa, pb = port(a, "n"), port(b, "s")
        return [a, b], [con("c", "", "a", "n", "b", "s", [pa, [pa[0], ZY], [pb[0], ZY], pb])], ["a"], [(pb[0], ZY, "out")]
    if case == DP24_CASES[2]:
        a, b = shp("a", "server", "A", 264, 264, 1), shp("b", "server", "B", 168, 28, 2)
        pa, pb = port(a, "w"), port(b, "s")
        return [a, b], [con("c", "", "a", "w", "b", "s", [pa, [ZX, pa[1]], pb])], ["a"], [(ZX, ZY, "out")]
    if case == DP24_CASES[3]:
        shapes = [shp("s1", "server", "S1", ZX - 73, 444, 1, w=145), shp("s2", "server", "S2", ZX - 72, 444, 2),
                  shp("s3", "server", "S3", ZX + ZW - 73, 444, 3, w=145), shp("s4", "server", "S4", ZX + ZW - 72, 444, 4, w=145)]
        return shapes, [], ["s2", "s3"], []
    if case == DP24_CASES[4]:
        a, b = shp("a", "server", "A", 0, 64, 1), shp("b", "server", "B", 428, 28, 2)
        pa, pb = port(a, "e"), port(b, "s")
        return [a, b], [con("c", "", "a", "e", "b", "s", [pa, [300, pa[1]], [300, ZY], [pb[0], ZY], pb])], [], []
    a, b = shp("a", "server", "A", 0, 444, 1), shp("b", "server", "B", 864, 444, 2)
    y = port(a, "e")[1]
    return [a, b], [con("c", "", "a", "e", "b", "w", [port(a, "e"), port(b, "w")])], [], [(ZX, y, "in"), (ZX + ZW, y, "out")]


@pytest.mark.parametrize("case", DP24_CASES, ids=DP24_CASES)
def test_dp24_server_derived_values(app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid = owner.new_diagram(fresh_title("Derived"))
    shapes, connectors, members, crossings = dp24_case(case)
    r = owner.put_page(did, blank_doc(pid, 1, zones=[zone(PROBE_ZONE_ID, "cde", PROBE_ZONE, ZX, ZY, ZW, ZH)], shapes=shapes, connectors=connectors))
    assert r.status_code == 200, r.text
    for derived in (r.json()["derived"], owner.page(did, pid)["derived"]):
        z = zone_derived(derived, PROBE_ZONE_ID)
        assert z["members"] == members and z["systems"] == len(members) and z["crossings"] == len(crossings)
        assert [(c["x"], c["y"], c["direction"]) for c in derived["crossings"] if c["zoneId"] == PROBE_ZONE_ID] == crossings
    zr = owner.get(f"/api/diagrams/{did}/pages/{pid}/zones/{PROBE_ZONE_ID}").json()["derived"]
    assert zr["members"] == members and zr["systems"] == len(members) and zr["crossings"] == len(crossings)
    assert sorted((c["x"], c["y"], c["direction"]) for c in zr["crossingPoints"]) == sorted(crossings)
    if connectors:
        cr = owner.get(f"/api/diagrams/{did}/pages/{pid}/connectors/c").json()["crossings"]
        assert sorted((c["x"], c["y"], c["direction"]) for c in cr) == sorted(crossings)


def nudge_fraud_to_edge(pg: Page) -> None:
    seed_btn(pg, "shp-fraud").focus()
    pg.keyboard.press("Space")
    for _ in range(4):
        pg.keyboard.press("Shift+ArrowUp")
        advance(pg, TALLY_MAX_MS)


def test_dp25_boundary_tally_and_undo(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Tally")
    into = f"Fraud screening moved into {CDE}. {tally_sentence(4, 4)}"
    out = f"Fraud screening moved out of {CDE}. {tally_sentence(3, 5)}"
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        nudge_fraud_to_edge(pg)
        ann = announcements(pg)
        assert "Fraud screening moved" not in ann.inner_text()
        risk = pg.get_by_role("button", name=connector_name(seed_label("shp-fraud"), seed_label("shp-settle")), exact=True)
        pg.keyboard.press("Shift+ArrowUp")
        assert into not in ann.inner_text()
        assert len(distinct_frames(realtime_path(risk, TALLY_MAX_MS))) >= 3, "connector did not morph"
        expect_tally_shows(pg, CDE, 4, 4)
        advance(pg, TALLY_MAX_MS)
        announced(pg, ann, into)
        expect(markers(pg, CDE, "entering")).to_have_count(2)
        pg.keyboard.press("ControlOrMeta+z")
        assert out not in ann.inner_text()
        assert len(distinct_frames(realtime_path(risk, TALLY_MAX_MS))) >= 3, "undo did not morph back"
        expect_tally_shows(pg, CDE, 3, 5)
        advance(pg, TALLY_MAX_MS)
        announced(pg, ann, out)
        expect(markers(pg, CDE, "entering")).to_have_count(3)


def test_dp26_reduced_motion_tally(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Reduced")
    with app_page(browser, base + "/signin", reduced="reduce") as pg:
        open_editor(pg, owner, did, pid)
        nudge_fraud_to_edge(pg)
        risk = pg.get_by_role("button", name=connector_name(seed_label("shp-fraud"), seed_label("shp-settle")), exact=True)
        pg.keyboard.press("Shift+ArrowUp")
        advance(pg, REDUCED_MOTION_MS)
        lasting = [a for a in animations(canvas(pg)) if a["duration"] > 1]
        assert lasting == [], lasting
        assert markers(pg, CDE, "entering").count() == 2
        first = sample(risk)
        advance(pg, TALLY_MAX_MS)
        assert {k: round(v, 1) for k, v in sample(risk).items()} == {k: round(v, 1) for k, v in first.items()}
        expect_tally_shows(pg, CDE, 4, 4)
        announced(pg, announcements(pg), f"Fraud screening moved into {CDE}. {tally_sentence(4, 4)}")


def test_dp47_zone_carry_resize_overlap(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Zones")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        puts = record(pg, "PUT", f"/pages/{pid}")
        insp = pg.get_by_role("complementary", name="Inspector")
        zone_btn(pg, CONNECTED).focus()
        pg.keyboard.press("Space")
        x = insp.get_by_role("spinbutton", name="X")
        x.fill(str(FLOW_ZONES[0]["x"] - GRID))
        x.press("Enter")
        wait_saved(pg)
        doc = owner.page(did, pid)["page"]
        by = {s["id"]: s for s in doc["shapes"]}
        assert next(z for z in doc["zones"] if z["id"] == "zone-connected")["x"] == FLOW_ZONES[0]["x"] - GRID
        assert by["shp-checkout"]["x"] == FLOW_BY_ID["shp-checkout"][2] - GRID and by["shp-admin"]["x"] == FLOW_BY_ID["shp-admin"][2] - GRID
        assert by["shp-payapi"]["x"] == FLOW_BY_ID["shp-payapi"][2]
        assert_attached(doc)
        sent = len(puts)
        x.fill(str(FLOW_ZONES[1]["x"] - FLOW_ZONES[0]["width"]))
        x.press("Enter")
        announced(pg, announcements(pg), "Zones can't overlap.")
        advance(pg, AUTOSAVE_MAX_MS * 2)
        assert len(puts) == sent
        zone_btn(pg, CDE).focus()
        pg.keyboard.press("Space")
        width = insp.get_by_role("spinbutton", name="Width")
        width.fill(str(FLOW_ZONES[1]["width"] + GRID))
        width.press("Enter")
        wait_saved(pg)
        doc2 = owner.page(did, pid)["page"]
        assert next(z for z in doc2["zones"] if z["id"] == "zone-cde")["width"] == FLOW_ZONES[1]["width"] + GRID
        assert [s for s in doc2["shapes"]] == doc["shapes"]
        sent = len(puts)
        width.fill(str(FLOW_ZONES[2]["x"] - FLOW_ZONES[1]["x"]))
        width.press("Enter")
        announced(pg, announcements(pg), "Zones can't overlap.")
        advance(pg, AUTOSAVE_MAX_MS * 2)
        assert len(puts) == sent
    bad = flows_doc(pid, 4)
    bad["zones"][1]["width"] = FLOW_ZONES[2]["x"] - FLOW_ZONES[1]["x"]
    r = owner.put_page(did, bad)
    assert r.status_code == 422 and error_code(r) == "validation"


def test_dp58_marker_direction_without_colour(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid = owner.new_diagram(fresh_title("Markers"))
    a, b = shp("a", "server", "Outside in", 0, 300, 1), shp("b", "server", "Inside in", 336, 300, 2)
    c, d = shp("c", "server", "Inside out", 336, 456, 3), shp("d", "server", "Outside out", 0, 456, 4)
    doc = blank_doc(pid, 1, zones=[zone("zm", "connected", MARKER_ZONE, 240, 240, 480, 336)], shapes=[a, b, c, d],
                    connectors=[con("in", "", "a", "e", "b", "w", [port(a, "e"), port(b, "w")]),
                                con("out", "", "c", "w", "d", "e", [port(c, "w"), port(d, "e")])])
    derived = owner.put_page(did, doc).json()["derived"]
    assert sorted(x["direction"] for x in derived["crossings"]) == ["in", "out"]
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        entering, leaving = markers(pg, MARKER_ZONE, "entering"), markers(pg, MARKER_ZONE, "leaving")
        expect(entering).to_have_count(1)
        expect(leaving).to_have_count(1)
        assert difference(decode(capture(entering)), decode(capture(leaving))) > 0


def test_wf_boundary_tally_drag(browser, app_url, mail):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, title = copy_flows(owner, "Drag")
    lee = signed_in(base, LEE)
    grant(owner, mail, did, title, lee, "viewer")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        button(pg, "Zoom out").click()
        button(pg, "Zoom out").click()
        fraud = seed_btn(pg, "shp-fraud")
        box = fraud.bounding_box()
        scale = box["width"] / NEW_SHAPE_W
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        pg.mouse.move(cx, cy)
        pg.mouse.down()
        pg.mouse.move(cx + 288 * scale, cy - 144 * scale, steps=12)
        pg.mouse.up()
        advance(pg, TALLY_MAX_MS)
        announced(pg, announcements(pg), f"Fraud screening moved into {CDE}. {tally_sentence(4, 4)}")
        wait_saved(pg)
        saved = owner.page(did, pid)
        z = zone_derived(saved["derived"], "zone-cde")
        assert z["systems"] == 4 and z["crossings"] == 4 and "shp-fraud" in z["members"]
        dirs = [c["direction"] for c in saved["derived"]["crossings"] if c["zoneId"] == "zone-cde"]
        with app_page(browser, base + "/signin") as view:
            open_editor(view, lee, did, pid)
            expect_tally_shows(view, CDE, 4, 4)
            expect(markers(view, CDE, "entering")).to_have_count(dirs.count("in"))
            expect(markers(view, CDE, "leaving")).to_have_count(dirs.count("out"))
        pg.keyboard.press("ControlOrMeta+z")
        advance(pg, TALLY_MAX_MS)
        announced(pg, announcements(pg), f"Fraud screening moved out of {CDE}. {tally_sentence(3, 5)}")
        wait_saved(pg)
    z = zone_derived(owner.page(did, pid)["derived"], "zone-cde")
    assert (z["systems"], z["crossings"]) == (3, 5)


def test_wf_boundary_tally_zone_nudge(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Nudge")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        puts = record(pg, "PUT", f"/pages/{pid}")
        zone_btn(pg, CONNECTED).focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("Shift+ArrowRight")
        advance(pg, TALLY_MAX_MS)
        assert f"{CONNECTED} moved" not in announcements(pg).inner_text()
        expect(markers(pg, CONNECTED, "leaving")).to_have_count(2)
        wait_saved(pg)
        saved = owner.page(did, pid)
        by = {s["id"]: s for s in saved["page"]["shapes"]}
        assert by["shp-checkout"]["x"] == FLOW_BY_ID["shp-checkout"][2] + NUDGE_SHIFT
        for z, n, m in (("zone-connected", 2, 2), ("zone-cde", 3, 5), ("zone-out", 1, 1)):
            d = zone_derived(saved["derived"], z)
            assert (d["systems"], d["crossings"]) == (n, m)
        sent = len(puts)
        pg.keyboard.press("Shift+ArrowRight")
        announced(pg, announcements(pg), "Zones can't overlap.")
        advance(pg, AUTOSAVE_MAX_MS * 2)
        assert len(puts) == sent
    assert owner.page(did, pid)["page"] == saved["page"]


DP28_CASES = ["DOCTYPE external entity", "billion laughs", "svg:script prefix", "SCRIPT upper case", "onload attribute", "&#x6A;avascript: href", "java&#9;script: href", "use href to another document", "foreignObject", "set attributeName=href", "animate values data:", "style url(javascript:)", "style @import", "png bytes named .svg", "benign href=#local accepted"]
_S = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
DP28_FILES = {
    "DOCTYPE external entity": '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY ext SYSTEM "file:///etc/passwd">]>' + _S + "<title>&ext;</title></svg>",
    "billion laughs": '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "lol">' + "".join(f'<!ENTITY {n} "{("&" + p + ";") * 10}">' for p, n in zip("abcdefgh", "bcdefghi")) + "]>" + _S + "<title>&i;</title></svg>",
    "svg:script prefix": '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg:svg>',
    "SCRIPT upper case": _S + "<SCRIPT>alert(1)</SCRIPT></svg>",
    "onload attribute": _S.replace(">", ' onLoad="alert(1)">', 1) + '<rect width="10" height="10"/></svg>',
    "&#x6A;avascript: href": HOSTILE_SVG.decode(),
    "java&#9;script: href": _S + '<a xlink:href="java&#9;script:alert(1)"><rect width="10" height="10"/></a></svg>',
    "use href to another document": _S + '<use href="other.svg#box"/></svg>',
    "foreignObject": _S + '<foreignObject width="10" height="10"><p xmlns="http://www.w3.org/1999/xhtml">x</p></foreignObject></svg>',
    "set attributeName=href": _S + '<a href="#a"><set attributeName="href" to="#b"/><rect width="10" height="10"/></a></svg>',
    "animate values data:": _S + '<rect width="10" height="10"><animate attributeName="fill" values="red; data:text/html,x"/></rect></svg>',
    "style url(javascript:)": _S + '<rect width="10" height="10" style="fill: url(&quot;javascript:alert(1)&quot;)"/></svg>',
    "style @import": _S + "<style>@import 'remote.css';</style></svg>",
    "benign href=#local accepted": BENIGN_SVG.decode(),
}
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 17


def assert_nothing_imported(owner: Api, did: str, suffix: str = "") -> None:
    assert owner.get(f"/api/diagrams/{did}/imports").json()["imports"] == []
    assert len(owner.get(f"/api/diagrams/{did}").json()["diagram"]["pages"]) == 1
    assert s3(suffix).keys(f"imports/{did}/") == []


@pytest.mark.parametrize("case", DP28_CASES, ids=DP28_CASES)
def test_dp28_import_type_and_unsafe_content(app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, _ = owner.new_diagram(fresh_title("Unsafe"))
    if case == "png bytes named .svg":
        r = owner.import_file(did, "picture.svg", PNG_BYTES, "image/svg+xml")
        assert r.status_code == 415 and error_code(r) == "unsupported_file_type"
        assert_nothing_imported(owner, did)
        return
    payload = DP28_FILES[case].encode()
    started = time.monotonic()
    r = owner.import_file(did, PROBE_SVG_NAME, payload, "image/svg+xml")
    assert time.monotonic() - started < IMPORT_ANSWER_S * 5
    if case == "benign href=#local accepted":
        assert r.status_code == 201, r.text
        imp = r.json()["import"]
        page = owner.page(did, imp["pageId"])["page"]
        assert page["name"] == f"Imported {PROBE_SVG_NAME}" and [s["label"] for s in page["shapes"]] == [BENIGN_LABEL]
    else:
        assert r.status_code == 422 and error_code(r) == "unsafe_file", r.text
        assert_nothing_imported(owner, did)


def test_dp29_original_kept_as_evidence(app_url, mail):
    base = app_url.rstrip("/")
    p = new_person(base, mail, role="viewer")
    r = p.owner.import_file(p.did, LEGACY_NAME, LEGACY_XML)
    assert r.status_code == 201, r.text
    imp = r.json()["import"]
    digest = hashlib.sha256(LEGACY_XML).hexdigest()
    assert imp["sha256"] == digest and imp["sizeBytes"] == len(LEGACY_XML) and imp["fileName"] == LEGACY_NAME
    store = s3()
    assert store.get(f"imports/{p.did}/{imp['id']}/original") == LEGACY_XML
    assert f"imports/{p.did}/{imp['id']}/model.json" in store.keys(f"imports/{p.did}/{imp['id']}/")
    page = p.api.page(p.did, imp["pageId"])["page"]
    assert page["name"] == f"Imported {LEGACY_NAME}"
    shapes = {s["label"]: s for s in page["shapes"]}
    assert shapes[LEGACY_TO]["kind"] == "server" and [z["name"] for z in page["zones"]] == [LEGACY_ZONE]
    flow = page["connectors"][0]
    assert flow["label"] == LEGACY_FLOW and flow["from"]["port"] == "e" and flow["to"]["port"] == "w"
    assert flow["points"] == [[192, 84], [240, 84], [240, 228], [288, 228]]
    got = p.api.download(f"/api/diagrams/{p.did}/imports/{imp['id']}/original")
    assert got.status_code == 200 and got.content == LEGACY_XML and got.headers["x-content-sha256"] == digest


DP56_CASES = ["depth 64 accepted", "depth 65 refused", "20000 elements accepted", "20001 elements refused", "65 attributes refused", "10001-character text refused", "depth 65 with script answers invalid_model", "1.9 MB nested g within 2 s"]
SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg">'


def nested(depth_below_root: int, inner: str = "") -> bytes:
    return (SVG_OPEN + "<g>" * depth_below_root + inner + "</g>" * depth_below_root + "</svg>").encode()


@pytest.mark.parametrize("case", DP56_CASES, ids=DP56_CASES)
def test_dp56_bounded_import_parsing(app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, _ = owner.new_diagram(fresh_title("Limits"))
    plan = {
        "depth 64 accepted": (nested(MAX_DEPTH - 1), 201),
        "depth 65 refused": (nested(MAX_DEPTH), 422),
        "20000 elements accepted": ((SVG_OPEN + "<g/>" * (MAX_ELEMENTS - 1) + "</svg>").encode(), 201),
        "20001 elements refused": ((SVG_OPEN + "<g/>" * MAX_ELEMENTS + "</svg>").encode(), 422),
        "65 attributes refused": ((SVG_OPEN + "<g " + " ".join(f'a{i}="1"' for i in range(MAX_ATTRIBUTES + 1)) + "/></svg>").encode(), 422),
        "10001-character text refused": ((SVG_OPEN + "<title>" + "x" * (MAX_TEXT + 1) + "</title></svg>").encode(), 422),
        "depth 65 with script answers invalid_model": (nested(MAX_DEPTH, "<script>alert(1)</script>"), 422),
        "1.9 MB nested g within 2 s": (nested(270_000), 422),
    }
    payload, status = plan[case]
    assert len(payload) <= FILE_PART_MAX
    result: dict = {}

    def upload() -> None:
        t = time.monotonic()
        result["r"] = owner.import_file(did, "limits.svg", payload, "image/svg+xml")
        result["s"] = time.monotonic() - t

    worker = threading.Thread(target=upload)
    worker.start()
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        while worker.is_alive():
            t = time.monotonic()
            assert client.get(base + "/api/health").status_code == 200
            assert time.monotonic() - t < HEALTH_ANSWER_S
    worker.join()
    r = result["r"]
    assert r.status_code == status, r.text
    assert result["s"] < IMPORT_ANSWER_S
    if status == 422:
        assert error_code(r) == "invalid_model"
        assert_nothing_imported(owner, did)
    if case == "65 attributes refused":
        ok = owner.import_file(did, "limits.svg", (SVG_OPEN + "<g " + " ".join(f'a{i}="1"' for i in range(MAX_ATTRIBUTES)) + "/></svg>").encode(), "image/svg+xml")
        assert ok.status_code == 201
    if case == "10001-character text refused":
        ok = owner.import_file(did, "limits.svg", (SVG_OPEN + "<title>" + "x" * MAX_TEXT + "</title></svg>").encode(), "image/svg+xml")
        assert ok.status_code == 201


def test_wf_import_legacy_success(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Import")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        button(pg, "Import").click()
        dlg = dialog(pg, "Import diagram file")
        dlg.get_by_label("Diagram file").set_input_files({"name": LEGACY_NAME, "mimeType": "text/xml", "buffer": LEGACY_XML})
        with held(pg, f"**/api/diagrams/{did}/imports") as gate:
            button(dlg, "Import file").click()
            announced(pg, announcements(pg), f"Importing {LEGACY_NAME}...")
            expect(button(dlg, "Importing...")).to_be_disabled()
            expect(pg.get_by_role("tab", name=f"Imported {LEGACY_NAME}")).to_have_count(0)
            gate.release()
        expect(dlg).to_be_hidden(timeout=EXPECT_MS)
        tab = pg.get_by_role("tab", name=f"Imported {LEGACY_NAME}")
        expect(pg.get_by_role("tab", name=f"Imported {LEGACY_NAME}", selected=True)).to_have_count(1)
        expect(tab).to_be_focused()
        announced(pg, announcements(pg), f"Imported {LEGACY_NAME} as a new page.")
        imp = owner.get(f"/api/diagrams/{did}/imports").json()["imports"][0]
        expect(pg).to_have_url(base + f"/d/{did}/p/{imp['pageId']}")
        expect(zone_btn(pg, LEGACY_ZONE)).to_be_visible()
        expect(pg.get_by_role("button", name=connector_name(LEGACY_FROM, LEGACY_TO), exact=True)).to_be_visible()
        button(pg, "Files").click()
        originals = dialog(pg, "Diagram files").get_by_role("table", name="Imported originals")
        expect(originals).to_contain_text(str(len(LEGACY_XML)), timeout=EXPECT_MS)
        expect(originals).to_contain_text(hashlib.sha256(LEGACY_XML).hexdigest())
    assert s3().get(f"imports/{did}/{imp['id']}/original") == LEGACY_XML


def test_wf_import_legacy_rejected(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Reject")
    error = "This file contains scripts, external entities or unsafe links and was not imported."
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        button(pg, "Import").click()
        dlg = dialog(pg, "Import diagram file")
        file_input = dlg.get_by_label("Diagram file")
        file_input.set_input_files({"name": "hostile.svg", "mimeType": "image/svg+xml", "buffer": HOSTILE_SVG})
        button(dlg, "Import file").click()
        expect(file_input).to_have_accessible_description(error, timeout=EXPECT_MS)
        expect(file_input).to_be_focused()
        announced(pg, announcements(pg), error)
        expect(dlg).to_be_visible()
        expect(pg.get_by_role("tablist", name="Pages", include_hidden=True).get_by_role("tab", include_hidden=True)).to_have_count(1)
        file_input.set_input_files({"name": "legacy-scope.xml", "mimeType": "text/xml", "buffer": LEGACY_XML})
        expect(file_input).not_to_have_accessible_description(error)
    assert_nothing_imported(owner, did)


def export_page(owner: Api, label: str = "Card switch") -> tuple[str, str, dict]:
    did, pid = owner.new_diagram(fresh_title("Export"))
    a, b = shp("a", "server", label, 96, 192, 1), shp("b", "database", "Vault copy", 624, 192, 2)
    doc = blank_doc(pid, 1, "Export page", zones=[zone("z1", "cde", "Probe CDE", 48, 48, 480, 336), zone("z2", "connected", "Probe link", 576, 48, 288, 336)],
                    shapes=[a, b], connectors=[con("c1", "Probe flow", "a", "e", "b", "w", [port(a, "e"), port(b, "w")])])
    assert owner.put_page(did, doc).status_code == 200
    return did, pid, doc


DP31_CASES = ["png size equals svg size", "png pixel colours", "svg round trip with connectors", 'escaped title A <b>x</b> & "y"']


@pytest.mark.parametrize("case", DP31_CASES, ids=DP31_CASES)
def test_dp31_export_confirmed_and_round_trip(app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    label = 'A <b>x</b> & "y"' if case == DP31_CASES[3] else "Card switch"
    did, pid, doc = export_page(owner, label)
    r = owner.export(did, idempotency_key_value())
    assert r.status_code == 201, r.text
    ex = r.json()["export"]
    assert ex["status"] == "ready" and [f["format"] for f in ex["files"]] == ["png", "svg", "json"]
    files = {}
    for f in ex["files"]:
        got = owner.download(f"/api/diagrams/{did}/exports/{ex['id']}/files/{f['format']}")
        stored = s3().get(f"exports/{did}/{ex['id']}/diagram.{f['format']}")
        assert got.content == stored and f["sizeBytes"] == len(stored) and f["sha256"] == hashlib.sha256(stored).hexdigest()
        files[f["format"]] = stored
    svg = ET.fromstring(files["svg"])
    ns = "{" + SVG_NS + "}"
    width, height = int(svg.get("width")), int(svg.get("height"))
    assert svg.get("viewBox") == f"0 0 {width} {height}"
    if case == DP31_CASES[0]:
        w, h, _ = png_pixels(files["png"])
        assert (w, h) == (width, height)
        data = json.loads(files["json"])
        assert data["diagram"]["id"] == did and data["pages"][0]["derived"] == owner.page(did, pid)["derived"]
    elif case == DP31_CASES[1]:
        group = next(g for g in svg.iter(ns + "g") if (g.get("transform") or "").startswith("translate("))
        tx, ty = (int(v) for v in re.findall(r"-?\d+", group.get("transform")))
        _, _, px = png_pixels(files["png"])
        for x, y in ((0, 0), (BACKGROUND_CORNER - 1, BACKGROUND_CORNER - 1)):
            assert px(x, y) == GROUND
        assert px(tx + 48, ty + 300) == SCOPE_RED and px(tx + 49, ty + 300) == SCOPE_RED
        assert px(tx + 576, ty + 300) == INK
        assert px(tx + 96, ty + 202) == INK and px(tx + 100, ty + 196) == GROUND
        assert px(tx + 552, ty + 228) == TEAL and px(tx + 552, ty + 227) == TEAL
    else:
        rects = {r.get("data-id"): r for r in svg.iter(ns + "rect") if r.get("data-id")}
        assert rects["a"].find(ns + "title").text == label
        assert not list(svg.iter(ns + "style")) and all("style" not in e.attrib for e in svg.iter())
        back = owner.import_file(did, "roundtrip.svg", files["svg"], "image/svg+xml")
        assert back.status_code == 201, back.text
        imported = owner.page(did, back.json()["import"]["pageId"])
        page = imported["page"]
        key_z = lambda z: (z["kind"], z["x"], z["y"], z["width"], z["height"], z["name"])
        key_s = lambda s: (s["kind"], s["x"], s["y"], s["width"], s["height"], s["label"])
        assert sorted(map(key_z, page["zones"])) == sorted(map(key_z, doc["zones"]))
        assert sorted(map(key_s, page["shapes"])) == sorted(map(key_s, doc["shapes"]))
        names = {s["id"]: s["label"] for s in page["shapes"]}
        c = page["connectors"][0]
        assert (c["label"], names[c["from"]["shapeId"]], c["from"]["port"], names[c["to"]["shapeId"]], c["to"]["port"], c["points"]) == \
            ("Probe flow", label, "e", "Vault copy", "w", doc["connectors"][0]["points"])
        zn = {z["id"]: z["name"] for z in page["zones"]}
        orig = owner.page(did, pid)["derived"]
        on = {z["id"]: z["name"] for z in doc["zones"]}
        assert sorted((zn[z["id"]], z["systems"], z["crossings"]) for z in imported["derived"]["zones"]) == sorted((on[z["id"]], z["systems"], z["crossings"]) for z in orig["zones"])
        assert sorted((zn[x["zoneId"]], x["x"], x["y"], x["direction"]) for x in imported["derived"]["crossings"]) == sorted((on[x["zoneId"]], x["x"], x["y"], x["direction"]) for x in orig["crossings"])


def test_dp32_export_replay(app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, _, _ = one_box(owner, "Replay")
    key = idempotency_key_value()
    first = owner.export(did, key)
    assert first.status_code == 201 and "Idempotent-Replayed" not in first.headers
    keys = s3().keys(f"exports/{did}/")
    again = owner.export(did, key)
    assert again.status_code == 201 and again.headers["Idempotent-Replayed"] == "true"
    assert again.json()["export"]["id"] == first.json()["export"]["id"] and s3().keys(f"exports/{did}/") == keys
    clients = [signed_in(base, DANA) for _ in range(4)]
    key2 = idempotency_key_value()
    results = burst([lambda c=c: c.export(did, key2) for c in clients])
    assert all(r.status_code in (201, 409) for r in results)
    assert all(error_code(r) == "idempotency_in_progress" for r in results if r.status_code == 409)
    assert len({r.json()["export"]["id"] for r in results if r.status_code == 201}) == 1
    assert len(owner.get(f"/api/diagrams/{did}/exports").json()["exports"]) == 2
    assert len(s3().keys(f"exports/{did}/")) == 6


DP61_CASES = ["another person's session", "after expiry 410", "after revocation 404", "signed out 401"]


@pytest.mark.parametrize("case", DP61_CASES, ids=DP61_CASES)
def test_dp61_download_links_bound(app_url, mail, case):
    base = short_url() if case == "after expiry 410" else app_url.rstrip("/")
    p = new_person(base, mail, role="viewer")
    eid = p.owner.export(p.did, idempotency_key_value()).json()["export"]["id"]
    link = p.api.link(f"/api/diagrams/{p.did}/exports/{eid}/files/json")
    assert p.api.get(link).status_code == 200
    if case == DP61_CASES[0]:
        for other in (p.owner, signed_in(base, MORGAN)):
            r = other.get(link)
            assert r.status_code == 404 and error_code(r) == "not_found"
    elif case == DP61_CASES[1]:
        end = time.monotonic() + LINK_WAIT_S
        while time.monotonic() < end:
            assert p.api.get("/api/session").status_code == 200
            wait_server_time(base, KEEPALIVE_S)
        r = p.api.get(link)
        assert r.status_code == 410 and error_code(r) == "link_expired"
        assert p.api.download(f"/api/diagrams/{p.did}/exports/{eid}/files/json").status_code == 200
    elif case == DP61_CASES[2]:
        sid = p.owner.share_for(p.did, p.email)["id"]
        p.owner.delete(f"/api/diagrams/{p.did}/shares/{sid}")
        r = p.api.get(link)
        assert r.status_code == 404 and error_code(r) == "not_found"
    else:
        assert p.api.delete("/api/session").status_code == 204
        r = httpx.get(base + link, timeout=HTTP_TIMEOUT)
        assert r.status_code == 401 and error_code(r) == "unauthenticated"


def multipart(filename: str, payload: bytes) -> tuple[bytes, str]:
    boundary = "scopewright" + uuid.uuid4().hex
    quoted = filename.replace("\\", "\\\\").replace('"', '\\"')
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{quoted}"; filename*=UTF-8\'\'{urllib.parse.quote(filename, safe="")}\r\n'
            "Content-Type: application/octet-stream\r\n\r\n").encode()
    return head + payload + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


DP63_NAMES = {
    "quoted name with semicolon and accent": 'scope "v2"; café.xml',
    "accented svg name": "diagramme-été.svg",
    "export svg": "",
}


@pytest.mark.parametrize("case", list(DP63_NAMES), ids=list(DP63_NAMES))
def test_dp63_downloads_cannot_run_script(app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, _, title = one_box(owner, "Scope export")
    if case == "export svg":
        ex = owner.export(did, idempotency_key_value()).json()["export"]
        r = owner.download(f"/api/diagrams/{did}/exports/{ex['id']}/files/svg")
        name = f"{slug(title)}-{ex['createdAt'][:10]}.svg"
        assert r.headers["content-type"].startswith("image/svg+xml")
        assert r.content == s3().get(f"exports/{did}/{ex['id']}/diagram.svg")
    else:
        filename = DP63_NAMES[case]
        payload = LEGACY_XML if filename.endswith(".xml") else BENIGN_SVG
        body, ctype = multipart(filename, payload)
        up = owner.post(f"/api/diagrams/{did}/imports", content=body, headers={"Content-Type": ctype})
        assert up.status_code == 201, up.text
        imp = up.json()["import"]
        assert imp["fileName"] == filename
        r = owner.download(f"/api/diagrams/{did}/imports/{imp['id']}/original")
        name = filename
        assert r.headers["content-type"].startswith("application/octet-stream") and r.content == payload
        assert r.headers["x-content-sha256"] == hashlib.sha256(payload).hexdigest()
    assert r.status_code == 200
    disposition = r.headers["content-disposition"]
    assert disposition == f"attachment; filename=\"{ascii_filename(name)}\"; filename*=UTF-8''{star_filename(name)}"
    if case == list(DP63_NAMES)[0]:
        assert disposition == "attachment; " + DISPOSITION_EXAMPLE
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["content-security-policy"] == DOWNLOAD_CSP


def test_wf_export_set_create(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Export set")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        button(pg, "Files").click()
        dlg = dialog(pg, "Diagram files")
        table = dlg.get_by_role("table", name="Exports")
        with held(pg, f"**/api/diagrams/{did}/exports") as gate:
            button(dlg, "Create export").click()
            expect(table).to_contain_text("Preparing", timeout=EXPECT_MS)
            expect(dlg.get_by_role("link", name="Download PNG")).to_have_count(0)
            expect(table).not_to_contain_text("Ready")
            gate.release()
        expect(table).to_contain_text("Ready", timeout=EXPECT_MS)
        announced(pg, announcements(pg), "Export ready.")
        ex = owner.get(f"/api/diagrams/{did}/exports").json()["exports"][0]
        for f in ex["files"]:
            expect(table).to_contain_text(f["sha256"])
            expect(table).to_contain_text(str(f["sizeBytes"]))
            assert s3().get(f"exports/{did}/{ex['id']}/diagram.{f['format']}") is not None
        for link in ("Download PNG", "Download SVG", "Download JSON"):
            expect(dlg.get_by_role("link", name=link)).to_be_visible()


def test_wf_export_set_download_files(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, title = copy_flows(owner, "Dated set")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        button(pg, "Files").click()
        dlg = dialog(pg, "Diagram files")
        button(dlg, "Create export").click()
        expect(dlg.get_by_role("table", name="Exports")).to_contain_text("Ready", timeout=EXPECT_MS)
        ex = owner.get(f"/api/diagrams/{did}/exports").json()["exports"][0]
        for fmt, name in (("png", "Download PNG"), ("svg", "Download SVG"), ("json", "Download JSON")):
            with pg.expect_download(timeout=EXPECT_MS) as info:
                dlg.get_by_role("link", name=name).first.click()
            download = info.value
            assert download.suggested_filename == f"{slug(title)}-{ex['createdAt'][:10]}.{fmt}"
            assert Path(download.path()).read_bytes() == s3().get(f"exports/{did}/{ex['id']}/diagram.{fmt}")


def test_dp34_storage_outage_api(browser, app_url):
    base = storage_down_url()
    down = signed_in(base, DANA)
    did, pid, _ = one_box(down, "Outage")
    r = down.put_page(did, blank_doc(pid, 2))
    assert r.status_code == 200
    r = down.import_file(did, "legacy.xml", LEGACY_XML)
    assert r.status_code == 503 and error_code(r) == "storage_unavailable"
    assert down.get(f"/api/diagrams/{did}/imports").json()["imports"] == []
    r = down.export(did, idempotency_key_value())
    assert r.status_code == 503 and error_code(r) == "storage_unavailable"
    ex = down.get(f"/api/diagrams/{did}/exports").json()["exports"]
    assert len(ex) == 1 and ex[0]["status"] == "failed" and ex[0]["files"] == []
    r = down.get(f"/api/diagrams/{did}/exports/{ex[0]['id']}/files/png")
    assert r.status_code == 409 and error_code(r) == "export_not_ready"
    t = time.monotonic()
    assert down.get("/api/status").json()["storage"] == "down" and time.monotonic() - t < STATUS_ANSWER_S
    primary = signed_in(app_url.rstrip("/"), DANA)
    ready = primary.export(did, idempotency_key_value()).json()["export"]["id"]
    first = down.get(f"/api/diagrams/{did}/exports/{ready}/files/png")
    final = down.get(first.headers["location"]) if first.status_code == 303 else first
    assert final.status_code == 503 and error_code(final) == "storage_unavailable"
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, down, did, pid)
        expect(pg.get_by_role("alert").filter(has_text="File storage is unavailable. Diagram edits still save, but exports and imports are paused until it returns.")).to_be_visible(timeout=EXPECT_MS)


DP50_CASES = ["All diagrams link", "page tab", "browser Back", "beforeunload prompt"]


@pytest.mark.parametrize("case", DP50_CASES, ids=DP50_CASES)
def test_dp50_no_optimistic_success_no_silent_exit(browser, app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, title = one_box(owner, "Leave")
    pid2 = owner.post(f"/api/diagrams/{did}/pages", {"name": SECOND_PAGE}).json()["page"]["id"]
    editor_path = f"/d/{did}/p/{pid}"
    target = {"All diagrams link": base + "/", "page tab": base + f"/d/{did}/p/{pid2}", "browser Back": base + "/"}.get(case)
    with app_page(browser, base + "/signin") as pg:
        sign_into(pg, owner)
        if case == "browser Back":
            pg.goto(base + "/")
            pg.get_by_role("link", name=title).click()
            expect(pg).to_have_url(base + editor_path, timeout=EXPECT_MS)
            advance(pg, 100)
        else:
            open_editor(pg, owner, did, pid)
        box = shape_btn(pg, "Probe box", "Server")
        box.focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ArrowRight")

        def leave() -> None:
            if case == "All diagrams link":
                pg.get_by_role("link", name="All diagrams").click()
            elif case == "page tab":
                pg.get_by_role("tab", name=SECOND_PAGE).click()
            else:
                pg.evaluate("() => history.back()")

        if case == "beforeunload prompt":
            seen: list = []
            pg.on("dialog", lambda d: (seen.append(d.type), d.dismiss()))
            with contextlib.suppress(Exception):
                pg.evaluate("() => location.reload()")
            poll(lambda: seen, EXPECT_S, "no leave-page prompt while edits were pending")
            assert len(seen) >= 1
            expect(pg).to_have_url(base + editor_path)
            expect(save_state(pg)).to_have_text("Unsaved changes")
            wait_saved(pg)
        else:
            glob = f"**/api/diagrams/{did}/pages/{pid}"
            pg.route(glob, lambda route: route.abort() if route.request.method == "PUT" else route.continue_())
            leave()
            expect(save_state(pg)).to_have_text("Not saved", timeout=EXPECT_MS)
            expect(pg.get_by_role("alert").filter(has_text="Something went wrong. Try again.")).to_be_visible()
            expect(pg).to_have_url(base + editor_path)
            pg.unroute(glob)
            with held(pg, glob) as gate:
                leave()
                expect(save_state(pg)).to_have_text("Saving...", timeout=EXPECT_MS)
                expect(pg).to_have_url(base + editor_path)
                gate.release()
            expect(pg).to_have_url(target, timeout=EXPECT_MS)
    page = owner.page(did, pid)["page"]
    assert page["version"] == 3 and page["shapes"][0]["x"] == 96 + NUDGE


def test_wf_storage_outage_banner_save(browser):
    base = storage_down_url()
    down = signed_in(base, DANA)
    did, pid, _ = one_box(down, "Outage edit")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, down, did, pid)
        expect(pg.get_by_role("alert").filter(has_text="File storage is unavailable. Diagram edits still save, but exports and imports are paused until it returns.")).to_be_visible(timeout=EXPECT_MS)
        box = shape_btn(pg, "Probe box", "Server")
        box.focus()
        pg.keyboard.press("Space")
        pg.keyboard.press("ArrowDown")
        wait_saved(pg)
    page = down.page(did, pid)["page"]
    assert page["version"] == 3 and page["shapes"][0]["y"] == 96 + NUDGE


def test_wf_storage_outage_export_failed(browser):
    base = storage_down_url()
    down = signed_in(base, DANA)
    did, pid, _ = one_box(down, "Outage export")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, down, did, pid)
        button(pg, "Files").click()
        dlg = dialog(pg, "Diagram files")
        button(dlg, "Create export").click()
        table = dlg.get_by_role("table", name="Exports")
        expect(table).to_contain_text("Failed", timeout=EXPECT_MS)
        expect(table).to_contain_text("Export failed. File storage did not confirm the files.")
        expect(table).not_to_contain_text("Ready")
        expect(dlg.get_by_role("link", name=re.compile(r"^Download (PNG|SVG|JSON)$"))).to_have_count(0)
    ex = down.get(f"/api/diagrams/{did}/exports").json()["exports"]
    assert [e["status"] for e in ex] == ["failed"]


def test_dp36_queued_delivery(app_url, mail):
    md = signed_in(mail_down_url(), DANA)
    title = fresh_title("Queued")
    did, _ = md.new_diagram(title)
    email = fresh_email("queued")
    r = md.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"})
    assert r.status_code == 201 and r.json()["share"]["delivery"] == "queued"
    exactly_one(mail, email, title)
    poll(lambda: md.share_for(did, email)["delivery"] == "sent", DELIVERY_WAIT_S)
    p = new_person(app_url.rstrip("/"), mail, role="editor")
    sid = signed_in(mail_down_url(), DANA).share_for(p.did, p.email)["id"]
    assert md.patch(f"/api/diagrams/{p.did}/shares/{sid}", {"role": "viewer"}).status_code == 200
    exactly_one(mail, p.email, f"Your role on {p.title} is now viewer.")


def test_dp51_concurrent_share_changes(app_url, mail):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    title = fresh_title("Concurrent")
    did, _ = owner.new_diagram(title)
    email = fresh_email("double")
    clients = [signed_in(base, DANA) for _ in range(5)]
    variants = [email, email.upper(), email.capitalize(), email, email.upper()]
    results = burst([lambda c=c, e=e: c.post(f"/api/diagrams/{did}/shares", {"email": e, "role": "viewer"}) for c, e in zip(clients, variants)])
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409, 409, 409, 409]
    assert all(error_code(r) == "invite_pending" for r in results if r.status_code == 409)
    exactly_one(mail, email, title)
    member = add_member(owner, mail, did, title, "editor")
    sid = owner.share_for(did, member)["id"]
    results = burst([lambda c=c: c.patch(f"/api/diagrams/{did}/shares/{sid}", {"role": "viewer"}) for c in clients])
    assert [r.status_code for r in results] == [200] * 5
    exactly_one(mail, member, f"Your role on {title} is now viewer.")
    results = burst([lambda c=c: c.delete(f"/api/diagrams/{did}/shares/{sid}") for c in clients])
    codes = sorted(r.status_code for r in results)
    assert codes == [204, 409, 409, 409, 409]
    exactly_one(mail, member, f"You no longer have access to {title}.")


def test_dp57_expiry_updated_in_place(browser, mail):
    base = short_url()
    owner = signed_in(base, DANA)
    did, pid, _ = one_box(owner, "Expiry row")
    email = fresh_email("expiring")
    owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"})
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        button(pg, "Share").click()
        dlg = dialog(pg, "Share diagram")
        withdraw = button(dlg, f"Withdraw invitation for {email}")
        withdraw.focus()
        handle = withdraw.element_handle()
        watch_announcements(pg)
        row = dlg.get_by_role("row").filter(has_text=email)
        end = time.monotonic() + INVITE_TTL_WAIT_S + DELIVERY_MAX_S
        while "Expired" not in row.inner_text() and time.monotonic() < end:
            pg.request.get(base + "/api/session")
            wait_server_time(base, KEEPALIVE_S)
            pg.request.get(base + "/api/session")
            refresh_shares(pg, did)
        expect(row).to_contain_text("Expired")
        for _ in range(2):
            pg.request.get(base + "/api/session")
            refresh_shares(pg, did)
        assert pg.evaluate("e => e.isConnected && e === document.activeElement", handle)
        assert times_announced(pg, f"Invitation expired for {email}.") == 1


def test_wf_mail_outage_delivery_in_place(browser, mail):
    base = mail_down_url()
    owner = signed_in(base, DANA)
    did, pid, title = one_box(owner, "Mail outage")
    email = fresh_email("assessor")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        button(pg, "Share").click()
        dlg = dialog(pg, "Share diagram")
        dlg.get_by_role("textbox", name="Email").fill(email)
        select(dlg.get_by_role("combobox", name="Role", exact=True), "Viewer")
        watch_announcements(pg)
        button(dlg, "Send invitation").click()
        announced(pg, announcements(pg), f"Invitation created for {email}.")
        row = dlg.get_by_role("row").filter(has_text=email)
        expect(row).to_contain_text("Not yet delivered")
        withdraw = button(dlg, f"Withdraw invitation for {email}")
        withdraw.focus()
        handle = withdraw.element_handle()
        end = time.monotonic() + DELIVERY_WAIT_S
        while "Not yet delivered" in row.inner_text() and time.monotonic() < end:
            refresh_shares(pg, did)
        expect(row).to_contain_text("Invited")
        refresh_shares(pg, did)
        assert pg.evaluate("e => e.isConnected && e === document.activeElement", handle)
        assert times_announced(pg, f"Invitation delivered to {email}.") == 1
    exactly_one(mail, email, title)


def test_wf_mail_outage_double_send(browser, mail):
    base = mail_down_url()
    owner = signed_in(base, DANA)
    did, pid, title = one_box(owner, "Double send")
    email = fresh_email("double")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        button(pg, "Share").click()
        dlg = dialog(pg, "Share diagram")
        dlg.get_by_role("textbox", name="Email").fill(email)
        button(dlg, "Send invitation").dblclick()
        announced(pg, announcements(pg), f"Invitation created for {email}.")
        expect(dlg.get_by_role("row").filter(has_text=email)).to_have_count(1)
    assert len([s for s in owner.shares(did) if s["email"] == email]) == 1
    exactly_one(mail, email, title)


DP38_CASES = ["375x812", "768x1024", "1280x800"]


@pytest.mark.parametrize("case", DP38_CASES, ids=DP38_CASES)
def test_dp38_published_layouts(browser, app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Layout")
    size = {"375x812": PHONE, "768x1024": TABLET, "1280x800": DESKTOP}[case]
    with app_page(browser, base + "/signin", size=size) as pg:
        open_editor(pg, owner, did, pid)
        chrome_layout(pg)
        cbox = canvas(pg).bounding_box()
        if case == "1280x800":
            lib = pg.get_by_role("complementary", name="Shape library").bounding_box()
            insp = pg.get_by_role("complementary", name="Inspector").bounding_box()
            assert lib["x"] + lib["width"] <= cbox["x"] + 1 and cbox["x"] + cbox["width"] <= insp["x"] + 1
            assert button(pg, "Inspector").count() == 0
        elif case == "768x1024":
            lib = pg.get_by_role("complementary", name="Shape library").bounding_box()
            assert lib["x"] + lib["width"] <= cbox["x"] + 1
            assert pg.get_by_role("complementary", name="Inspector").count() == 0
            expect(button(pg, "Zoom in")).to_be_visible()
            button(pg, "Inspector").click()
            advance(pg, FADE_MS)
            drawer = dialog(pg, "Inspector").bounding_box()
            assert abs(drawer["x"] + drawer["width"] - size[0]) <= 1 and drawer["height"] >= size[1] - 1
        else:
            banner = pg.get_by_role("banner")
            for loc in (banner.get_by_role("link", name="All diagrams"), banner.get_by_role("heading", level=1),
                        banner.get_by_role("status", name="Save state"), button(banner, "Files"), button(banner, "Share"),
                        banner.get_by_role("tablist", name="Pages")):
                expect(loc).to_be_visible()
            toolbar = pg.get_by_role("toolbar", name="Editor tools")
            xs = [button(toolbar, n).bounding_box()["x"] for n in ("Shapes", "Inspector", "Undo", "Redo", "Save")]
            assert xs == sorted(xs)
            for name in ("Zoom in", "Zoom out", "Import"):
                assert pg.get_by_role("button", name=name, exact=True, include_hidden=True).count() == 0
            assert pg.get_by_role("status", name="Zoom level", include_hidden=True).count() == 0
            assert pg.get_by_role("button", name="Undo", exact=True).count() == 1
            assert pg.get_by_role("complementary", name="Shape library").count() == 0
            tabs = banner.get_by_role("tablist", name="Pages").bounding_box()
            bar = toolbar.bounding_box()
            assert cbox["y"] >= tabs["y"] + tabs["height"] - 1 and cbox["y"] + cbox["height"] <= bar["y"] + 1


def touch(cdp: Any, kind: str, points: list) -> None:
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})


def swipe(cdp: Any, start: list, finish: list, steps: int = 6, pg: Page | None = None) -> None:
    touch(cdp, "touchStart", start)
    for k in range(1, steps + 1):
        touch(cdp, "touchMove", [(sx + (fx - sx) * k / steps, sy + (fy - sy) * k / steps) for (sx, sy), (fx, fy) in zip(start, finish)])
        if pg is not None:
            advance(pg, FRAME_MS)
    touch(cdp, "touchEnd", [])
    if pg is not None:
        advance(pg, FRAME_MS * 4)


def test_dp39_touch_pan_pinch_cancel(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Touch")
    with app_page(browser, base + "/signin", size=TABLET) as pg:
        open_editor(pg, owner, did, pid)
        cdp = session(pg)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        puts = record(pg, "PUT", f"/pages/{pid}")
        cb = canvas(pg).bounding_box()
        checkout = seed_btn(pg, "shp-checkout")
        before = checkout.bounding_box()
        pay = seed_btn(pg, "shp-payapi")
        p0 = pay.bounding_box()
        dx = round(cb["x"] + cb["width"] / 2 - (p0["x"] + p0["width"] / 2))
        start = (cb["x"] + cb["width"] - 24, cb["y"] + 720)
        swipe(cdp, [start], [(start[0] + dx, start[1] + 40)], pg=pg)
        advance(pg, 100)
        after = checkout.bounding_box()
        assert abs(after["x"] - before["x"] - dx) <= PINCH_TOLERANCE_PX and abs(after["y"] - before["y"] - 40) <= PINCH_TOLERANCE_PX
        pb = pay.bounding_box()
        c = (pb["x"] + pb["width"] / 2, pb["y"] + pb["height"] / 2)
        swipe(cdp, [c], [(c[0] + 48, c[1])], pg=pg)
        wait_saved(pg)
        assert next(s for s in owner.page(did, pid)["page"]["shapes"] if s["id"] == "shp-payapi")["x"] == FLOW_BY_ID["shp-payapi"][2] + 48
        sent = len(puts)
        vault = seed_btn(pg, "shp-vault")
        pb = pay.bounding_box()
        c = (pb["x"] + pb["width"] / 2, pb["y"] + pb["height"] / 2)
        touch(cdp, "touchStart", [c])
        touch(cdp, "touchMove", [(c[0] + 40, c[1])])
        touch(cdp, "touchStart", [(c[0] + 40, c[1]), (c[0] + 40, c[1] + 120)])
        touch(cdp, "touchMove", [(c[0] + 30, c[1] - 10), (c[0] + 50, c[1] + 140)])
        touch(cdp, "touchEnd", [])
        advance(pg, AUTOSAVE_MAX_MS * 2)
        assert len(puts) == sent
        pb, vb = pay.bounding_box(), vault.bounding_box()
        scale = (vb["y"] - pb["y"]) / (FLOW_BY_ID["shp-vault"][3] - FLOW_BY_ID["shp-payapi"][3])
        assert abs((pb["x"] - vb["x"]) / scale - 48) <= PINCH_TOLERANCE_PX
        assert abs((pb["y"] - vb["y"]) / scale - (FLOW_BY_ID["shp-payapi"][3] - FLOW_BY_ID["shp-vault"][3])) <= PINCH_TOLERANCE_PX
        cb = canvas(pg).bounding_box()
        m = (cb["x"] + cb["width"] / 2, cb["y"] + cb["height"] / 2)
        ref = checkout.bounding_box()
        s0 = view_scale(checkout, vault, "shp-checkout", "shp-vault")
        px_canvas = ((m[0] - ref["x"]) / s0, (m[1] - ref["y"]) / s0)
        swipe(cdp, [(m[0] - 40, m[1]), (m[0] + 40, m[1])], [(m[0] - 80, m[1]), (m[0] + 80, m[1])], pg=pg)
        advance(pg, 100)
        ref = checkout.bounding_box()
        s1 = view_scale(checkout, vault, "shp-checkout", "shp-vault")
        assert abs(ref["x"] + px_canvas[0] * s1 - m[0]) <= PINCH_TOLERANCE_PX and abs(ref["y"] + px_canvas[1] * s1 - m[1]) <= PINCH_TOLERANCE_PX
        expect(pg.get_by_role("status", name="Zoom level")).to_have_text(f"{math.floor(s1 * 100 + 0.5)}%")
        swipe(cdp, [(m[0] - 20, m[1]), (m[0] + 20, m[1])], [(m[0] - 200, m[1]), (m[0] + 200, m[1])], pg=pg)
        advance(pg, 100)
        expect(pg.get_by_role("status", name="Zoom level")).to_have_text(f"{ZOOM_MAX}%")
        assert len(puts) == sent


def test_dp53_closed_panels_unavailable(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Panels")
    with app_page(browser, base + "/signin", size=TABLET) as pg:
        open_editor(pg, owner, did, pid)
        assert dialog(pg, "Inspector").count() == 0 and button(pg, "Close inspector").count() == 0
        names = focus_names(pg, 40)
        assert "Close inspector" not in names and "Zone name" not in names
        zone = zone_btn(pg, CDE)
        zone.focus()
        pg.keyboard.press("Space")
        button(pg, "Inspector").click()
        advance(pg, FADE_MS)
        drawer = dialog(pg, "Inspector")
        expect(drawer.get_by_role("textbox", name="Zone name")).to_have_value(CDE)
        cb = pg.get_by_role("application", name="Diagram canvas", include_hidden=True).bounding_box()
        pg.mouse.click(cb["x"] + 24, cb["y"] + 600)
        expect(drawer).to_be_visible()
        expect(pg.get_by_role("button", name=f"Zone {CDE}", exact=True, include_hidden=True)).to_have_attribute("aria-pressed", "true")
        for _ in range(15):
            pg.keyboard.press("Tab")
            assert inside(drawer)
        pg.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        advance(pg, FADE_MS)
        expect(dialog(pg, "Inspector")).to_have_count(0)
        pane = pg.get_by_role("complementary", name="Inspector")
        expect(pane.get_by_role("textbox", name="Zone name")).to_have_value(CDE)
        assert inside(pane)
    with app_page(browser, base + "/signin", size=PHONE) as pg:
        open_editor(pg, owner, did, pid)
        assert dialog(pg, "Shape library").count() == 0 and button(pg, "Add Server").count() == 0
        shapes = button(pg, "Shapes")
        shapes.click()
        advance(pg, FADE_MS)
        expect(button(dialog(pg, "Shape library"), "Add Server")).to_be_visible()
        pg.keyboard.press("Escape")
        advance(pg, FADE_MS)
        expect(dialog(pg, "Shape library")).to_have_count(0)
        expect(shapes).to_be_focused()
        chrome_layout(pg)


def tablet_fixture(base: str, mail: Any) -> tuple[Api, str, str, dict, dict]:
    owner = signed_in(base, DANA)
    did, pid, title = copy_flows(owner, "Tablet review")
    lee = signed_in(base, LEE)
    grant(owner, mail, did, title, lee, "viewer")
    ex = owner.export(did, idempotency_key_value()).json()["export"]
    imp = owner.import_file(did, LEGACY_NAME, LEGACY_XML).json()["import"]
    return owner, did, pid, ex, imp


def test_wf_tablet_review_journey(browser, app_url, mail):
    base = app_url.rstrip("/")
    owner, did, pid, _, _ = tablet_fixture(base, mail)
    with app_page(browser, base + f"/d/{did}/p/{pid}", size=TABLET) as pg:
        expect(pg).to_have_url(re.compile(r"/signin\?"), timeout=EXPECT_MS)
        ui_signin(pg, LEE)
        expect(pg).to_have_url(base + f"/d/{did}/p/{pid}", timeout=EXPECT_MS)
        advance(pg, 100)
        expect(save_state(pg)).to_have_text("Read only")
        assert button(pg, "Share").count() == 0 and button(pg, "Import").count() == 0
        zone_btn(pg, CDE).focus()
        pg.keyboard.press("Space")
        button(pg, "Inspector").click()
        advance(pg, FADE_MS)
        drawer = dialog(pg, "Inspector")
        expect(drawer.get_by_role("list", name=f"Systems in {CDE}").get_by_role("listitem")).to_have_count(3)
        flows = drawer.get_by_role("list", name=f"Flows crossing {CDE}").get_by_role("listitem")
        expect(flows).to_have_count(5)
        expect(flows.filter(has_text=re.compile(r", entering$"))).to_have_count(3)
        expect(flows.filter(has_text=re.compile(r", leaving$"))).to_have_count(2)
        expect(drawer.get_by_role("textbox", name="Zone name")).not_to_be_editable()
    assert owner.page(did, pid)["page"]["version"] == 2


def test_wf_tablet_review_files(browser, app_url, mail):
    base = app_url.rstrip("/")
    owner, did, pid, ex, imp = tablet_fixture(base, mail)
    lee = signed_in(base, LEE)
    with app_page(browser, base + "/signin", size=TABLET) as pg:
        open_editor(pg, lee, did, pid)
        button(pg, "Files").click()
        dlg = dialog(pg, "Diagram files")
        expect(button(dlg, "Create export")).to_have_count(0)
        with pg.expect_download(timeout=EXPECT_MS) as info:
            dlg.get_by_role("link", name="Download PNG").first.click()
        assert Path(info.value.path()).read_bytes() == s3().get(f"exports/{did}/{ex['id']}/diagram.png")
        with pg.expect_download(timeout=EXPECT_MS) as info:
            dlg.get_by_role("link", name=f"Download original {LEGACY_NAME}").click()
        assert Path(info.value.path()).read_bytes() == LEGACY_XML
        resp = pg.goto(base + f"/d/{KESTREL_ID}/p/{KESTREL_PAGE_ID}")
        assert resp.status == 404
        expect(pg.get_by_role("heading", level=1)).to_have_text("Diagram not found")


def test_dp41_health_and_status(app_url):
    base = app_url.rstrip("/")
    for url, storage, mail_state in ((base, "up", "up"), (storage_down_url(), "down", "up"), (mail_down_url(), "up", "down")):
        r = httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        t = time.monotonic()
        s = httpx.get(url + "/api/status", timeout=HTTP_TIMEOUT)
        assert time.monotonic() - t < STATUS_ANSWER_S and s.json() == {"storage": storage, "mail": mail_state}


class ScriptTags(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.scripts: list[dict] = []
        self.refs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        a = dict(attrs)
        if tag == "script":
            self.scripts.append(a)
            if a.get("src"):
                self.refs.append(a["src"])
        if tag == "link" and a.get("href"):
            self.refs.append(a["href"])


DP42_CASES = ["nonce differs per response", "every script carries the nonce", "no unsafe-inline or unsafe-eval"]


@pytest.mark.parametrize("case", DP42_CASES, ids=DP42_CASES)
def test_dp42_security_headers(app_url, case):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = one_box(owner, "Headers")
    pages = [httpx.get(base + "/signin", timeout=HTTP_TIMEOUT), owner.get(f"/d/{did}/p/{pid}")]
    for r in pages + [owner.get("/api/diagrams")]:
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["referrer-policy"] == "same-origin" and r.headers["permissions-policy"] == PERMISSIONS_POLICY
        no_cors_headers(r)
    assert "no-store" in owner.get("/api/diagrams").headers["cache-control"]
    nonces = []
    for r in pages:
        csp = r.headers["content-security-policy"]
        nonce = re.search(r"'nonce-([^']+)'", csp).group(1)
        assert csp == CSP_TEMPLATE.format(n=nonce)
        nonces.append(nonce)
        if case == DP42_CASES[1]:
            parser = ScriptTags()
            parser.feed(r.text)
            assert parser.scripts and all(s.get("nonce") == nonce for s in parser.scripts)
            assert "javascript:" not in r.text and not re.search(r"<[^>]+\son[a-z]+\s*=", r.text, re.I)
        if case == DP42_CASES[2]:
            allowed = set(re.findall(r"'[^']+'", CSP_TEMPLATE.format(n=nonce)))
            assert set(re.findall(r"'[^']+'", csp)) <= allowed, csp
    if case == DP42_CASES[0]:
        again = httpx.get(base + "/signin", timeout=HTTP_TIMEOUT).headers["content-security-policy"]
        third = re.search(r"'nonce-([^']+)'", again).group(1)
        assert len(set(nonces + [third])) == 3
        assert len(base64.b64decode(third + "=" * (-len(third) % 4))) >= 16


def test_dp43_focus_ring_and_dialogs(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    did, pid, _ = copy_flows(owner, "Focus")
    with app_page(browser, base + "/signin") as pg:
        open_editor(pg, owner, did, pid)
        for opener_name, dialog_name in (("Share", "Share diagram"), ("Files", "Diagram files"), ("Import", "Import diagram file")):
            opener = button(pg, opener_name)
            rest, focused = state_styles(opener, "outline-style", "outline-width", "box-shadow", state="focus")
            assert focused != rest and (focused["outline-style"] != "none" or focused["box-shadow"] != "none")
            opener.focus()
            pg.keyboard.press("Enter")
            advance(pg, FADE_MS)
            dlg = dialog(pg, dialog_name)
            expect(dlg).to_be_visible()
            assert inside(dlg)
            for k in ["Tab"] * 12 + ["Shift+Tab"] * 12:
                pg.keyboard.press(k)
                assert inside(dlg), k
            pg.keyboard.press("Escape")
            advance(pg, FADE_MS)
            expect(dlg).to_be_hidden()
            expect(opener).to_be_focused()
        item = seed_btn(pg, "shp-payapi")
        rest, focused = state_styles(item, "outline-style", "outline-width", "box-shadow", state="focus")
        assert focused != rest
        item.focus()
        pg.keyboard.press("Space")
        pane = pg.get_by_role("complementary", name="Inspector")
        pane.get_by_role("textbox", name="Label").focus()
        left = False
        for _ in range(30):
            pg.keyboard.press("Tab")
            if not inside(pane):
                left = True
                break
        assert left, "Tab stayed inside the desktop inspector"
        for _ in range(5):
            pg.keyboard.press("Tab")
            assert not inside(pane)


def test_dp65_no_secrets_or_internals(app_url, mail):
    import conftest
    base = app_url.rstrip("/")
    deployed = Path(getattr(conftest, "DEPLOYED_APP"))
    serve = json.loads((deployed / "run.json").read_text())["serve"]
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port_no = s.getsockname()[1]
    url = f"http://127.0.0.1:{port_no}"
    log = tempfile.NamedTemporaryFile(prefix="scopewright-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(as_app_user(serve), cwd=deployed, stdout=log, stderr=subprocess.STDOUT,
                            env=app_user_env(APP_PUBLIC_PORT=str(port_no), APP_PUBLIC_URL=url))
    secrets: list[str] = [DANA[1]]
    try:
        wait_healthy(proc, url, log.name)
        owner = signed_in(url, DANA)
        secrets += [owner.cookie()[1], owner.csrf]
        title = fresh_title("Leak")
        did, _ = owner.new_diagram(title)
        email = fresh_email("leak")
        owner.post(f"/api/diagrams/{did}/shares", {"email": email, "role": "viewer"})
        token = invite_token(mail, email, title)
        password = "Probe-pass-" + uuid.uuid4().hex[:12]
        newcomer = Api(url)
        accept(newcomer, token, {"displayName": "Leak Probe", "password": password})
        secrets += [token, password, newcomer.cookie()[1]]
        eid = owner.export(did, idempotency_key_value()).json()["export"]["id"]
        link = owner.link(f"/api/diagrams/{did}/exports/{eid}/files/png")
        owner.get(link)
        secrets.append(link.rsplit("/", 1)[1])
        listing = owner.get("/api/diagrams").text + owner.get(f"/api/diagrams/{did}/shares").text
        assert owner.cookie()[1] not in listing and token not in listing and owner.csrf not in listing
        bad = owner.post("/api/diagrams", content=b'{"title":', headers={"Content-Type": "application/json"})
        assert 400 <= bad.status_code < 500 and set(bad.json()) >= {"error", "message"}
        assert not re.search(r"\bat .+:\d+|SELECT |node_modules", bad.text)
        html = httpx.get(url + "/signin", timeout=HTTP_TIMEOUT).text
        parser = ScriptTags()
        parser.feed(html)
        assets = html + "".join(httpx.get(urllib.parse.urljoin(url + "/", ref), timeout=HTTP_TIMEOUT).text for ref in parser.refs)
        env_secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
        env_secrets.append(urllib.parse.urlparse(os.environ.get("DATABASE_URL", "")).password or "")
        for value in [v for v in env_secrets if len(v) >= 6]:
            assert value not in assets
            secrets.append(value)
        for probe in ("/run.json", "/.env", "/package.json", "/tsconfig.json", "/dist/server.js", "/node_modules/.package-lock.json"):
            r = httpx.get(url + probe, timeout=HTTP_TIMEOUT)
            assert r.status_code == 404 and "run-manifest-v1" not in r.text, probe
    finally:
        proc.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=HTTP_TIMEOUT)
        log.close()
    output = Path(log.name).read_text(errors="replace")
    for value in secrets:
        assert value and value not in output, "server output leaked a secret"


def wait_healthy(proc: subprocess.Popen, url: str, log_path: str) -> None:
    def ready() -> bool:
        if proc.poll() is not None:
            raise AssertionError("copy exited: " + Path(log_path).read_text(errors="replace")[-2000:])
        try:
            return httpx.get(url + "/api/health", timeout=POLL_S).status_code == 200
        except httpx.HTTPError:
            return False

    poll(ready, COPY_BOOT_S, "copy did not become healthy")


def test_wf_cross_cutting_health(browser, app_url):
    for url in (app_url.rstrip("/"), storage_down_url(), mail_down_url()):
        assert httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
        with app_page(browser, url + "/signin") as pg:
            expect(button(pg, "Sign in")).to_be_visible(timeout=EXPECT_MS)
            expect(pg.get_by_role("textbox", name="Email")).to_be_visible()


def test_wf_cross_cutting_new_diagram_dialog(browser, app_url):
    base = app_url.rstrip("/")
    owner = signed_in(base, DANA)
    with app_page(browser, base + "/signin") as pg:
        sign_into(pg, owner)
        pg.goto(base + "/")
        opener = button(pg, "New diagram")
        opener.focus()
        pg.keyboard.press("Enter")
        advance(pg, FADE_MS)
        dlg = dialog(pg, "New diagram")
        expect(dlg.get_by_role("textbox", name="Title")).to_be_focused()
        for k in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            pg.keyboard.press(k)
            assert inside(dlg)
        pg.keyboard.press("Escape")
        advance(pg, FADE_MS)
        expect(dlg).to_be_hidden()
        expect(opener).to_be_focused()


def production_tree() -> list[dict]:
    out = subprocess.run(as_app_user("npm ls --omit=dev --all --long --json"), cwd="/app", env=app_user_env(),
                         capture_output=True, text=True, timeout=600)
    data = json.loads(out.stdout or "{}")
    found: dict[str, dict] = {}

    def walk(deps: dict) -> None:
        for name, info in (deps or {}).items():
            if info.get("version") and name not in found:
                lic = info.get("license")
                if lic is None and info.get("path"):
                    with contextlib.suppress(OSError, ValueError):
                        lic = json.loads((Path(info["path"]) / "package.json").read_text()).get("license")
                found[name] = {"name": name, "version": info["version"], "license": lic}
            walk(info.get("dependencies", {}))

    walk(data.get("dependencies", {}))
    return list(found.values())


def licence_ok(expr: Any) -> bool:
    if isinstance(expr, dict):
        expr = expr.get("type", "")
    text_expr = str(expr or "").strip()
    return any(all(part.strip("() ") in ALLOWED_LICENCES for part in re.split(r"\s+AND\s+", alt))
               for alt in re.split(r"\s+OR\s+", text_expr.strip("()")))


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p["name"] for p in production_tree() if p["name"] not in notices]
    assert missing == [], missing
    assert "IBM Plex" in notices


def test_if_licences_allowed():
    bad = [(p["name"], p["license"]) for p in production_tree() if not licence_ok(p["license"])]
    assert bad == [], bad
    assert "OFL" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore():
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "leveldown", "lowdb", "nedb", "lokijs", "pouchdb"}
    assert banned.isdisjoint({p["name"] for p in production_tree()})
    files = [p for p in Path("/app").rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert files == [], files
    procs = []
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            with contextlib.suppress(OSError):
                procs.append((entry / "comm").read_text().strip())
    assert "redis-server" not in procs


def test_if_services_untouched(mail):
    assert _service("Postgres")().tables()
    s3().keys("")
    mail.messages()
    assert raw_signin(os.environ.get("APP_PUBLIC_URL", "").rstrip("/") or storage_down_url(), *DANA).status_code in (200, 429)


def strip_jsonc(source: str) -> str:
    out: list[str] = []
    i, in_string = 0, False
    while i < len(source):
        ch = source[i]
        nxt = source[i + 1] if i + 1 < len(source) else ""
        if in_string:
            out.append(ch)
            if ch == "\\":
                out.append(nxt)
                i += 2
                continue
            in_string = ch != '"'
            i += 1
            continue
        if ch == "/" and nxt == "/":
            end = source.find("\n", i)
            i = len(source) if end < 0 else end
            continue
        if ch == "/" and nxt == "*":
            end = source.find("*" + "/", i + 2)
            i = len(source) if end < 0 else end + 2
            continue
        if ch in ("}", "]"):
            j = len(out) - 1
            while j >= 0 and out[j].isspace():
                j -= 1
            if j >= 0 and out[j] == ",":
                del out[j]
        in_string = ch == '"'
        out.append(ch)
        i += 1
    return "".join(out)


def test_if_typescript_strict():
    root = Path("/app/tsconfig.json")
    configs = [root] if root.exists() else tsconfigs(Path("/app"))
    assert configs, "no tsconfig.json in the app source"
    found = [r for r in (tsconfig_strict(c) for c in configs) if r is not None]
    assert found and all(found), "strict not enabled"


def test_if_no_third_party_origin(app_url):
    base = app_url.rstrip("/")
    html = httpx.get(base + "/signin", timeout=HTTP_TIMEOUT).text
    parser = ScriptTags()
    parser.feed(html)
    for ref in parser.refs:
        full = urllib.parse.urljoin(base + "/", ref)
        assert urllib.parse.urlparse(full).netloc == urllib.parse.urlparse(base).netloc, ref
        body = httpx.get(full, timeout=HTTP_TIMEOUT).text
        for target in re.findall(r"(?:url\(\s*['\"]?|@import\s+['\"])(https?://[^'\")\s]+)", body):
            assert urllib.parse.urlparse(target).netloc == urllib.parse.urlparse(base).netloc, target
        for host in ("fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com"):
            assert host not in body
