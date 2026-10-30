from __future__ import annotations

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
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    PocketBase,
    S3,
    addresses,
    advance,
    animations,
    camera,
    capture,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    same_origin,
    scene_frames,
    select,
    state_styles,
    style,
    text,
    unique,
    until,
)

PASSWORD = "orrery-demo-2026"
SESSION_COOKIE = "orrery_session"
CARD = {"number": "4242424242424242", "expMonth": 12, "expYear": 2030, "cvc": "123"}
DECLINED_CARD = "4000000000000002"
SEED_VIEWER = "ines@kestrel.test"
SEED_SCENE = "sc_arc_one"
FERNHALL_POSER = "orr_fernhallposer6d1f3b5a7c9e2b4d608a1fde"
BERLIN = "Europe/Berlin"
CHICAGO = "America/Chicago"

TRIAL_DEFAULT_S = 1_209_600
TRIAL_SHORT_S = 20
DUNNING_DAY_SHORT_S = 5
REALTIME_S = 1
SCHEDULER_LAG_S = 2
PUBLISH_MIN_S = 5
PUBLISH_MAX_DAYS = 365
LINK_MIN_S = 10
LINK_MAX_DAYS = 30
TOKEN_MIN_S = 10
TOKEN_MAX_DAYS = 365
MODEL_LIMIT = 20_000_000
TEXTURE_LIMIT = 8_000_000
TEXTURE_MAX_PX = 4096
FILE_NAME_MAX = 120
BODY_LIMIT = 1_000_000
ASSET_BODY_LIMIT = 20_100_000
TRIAL_SEATS = 8
TEAM_SEATS = 8
BUSINESS_SEATS = 20
TEAM_TOKEN_LIMIT = 5
MAX_LAYERS = 8
MAX_BATCH = 200
NAME_MAX = 80
TOKEN_NAME_MAX = 60
COMMENT_MAX = 2000
MENTION_MAX = 20
EXTRA_SEATS_MAX = 500
POSITION_MAX = 1000
ROTATION_MAX = 360
SCALE_MIN = 0.001
FOV_MIN = 10
FOV_MAX = 120
DURATION_MAX_MS = 2000
HIGHLIGHT_MS = 420
COUNT_MS = 240
FADE_MS = 160
FADED_OPACITY = 0.35
QUARTER_S = 0.25
IDLE_START_MS = 3000
TURN_MIN_S = 25
TURN_MAX_S = 35
HOVER_MAX_MS = 250
DIALOG_IN_MAX_MS = 400
DIALOG_OUT_MAX_MS = 250
BUSY_MIN_MS = 750
BUSY_MAX_MS = 1250
BANNER_S = 5
EDITOR_BUDGET_S = 3
HOME_BUDGET_S = 2
GRAPH_BUDGET_S = 1
GRAPH_OPS = 1000
SEED_LATEST = 9
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
VIEWPORT_IDS = ["375x812", "768x1024", "1280x800"]
VIEWPORTS = {"375x812": PHONE, "768x1024": TABLET, "1280x800": DESKTOP}

HTTP_TIMEOUT_S = 180
POLL_S = 0.25
MAIL_SETTLE_S = 0.5
MAIL_WAIT_S = 45
UI_MS = 20_000
RT_MS = REALTIME_S * 1000 + 3_000
FRAME_STEP_MS = 48
DRAG_PAST_PX = 40
THUMB_INSET_PX = 8
WAIT_S = 60
CLOCK_SKEW_S = 1
PUBLISH_LEAD_S = 7
UI_PUBLISH_LEAD_S = 20
SHORT_TTL_S = 12
DAY_S = 86_400
RACERS = 5
CUP = "Cup"
LID = "Lid"
BRAVO = "Bravo"
BODY = "Body"
LIFTED = "Lifted"
LIFT_ID = "st_lift"
RAISED = "Raised"
HERO = "Hero"
FRONT = "Front"
SIDE = "Side"
AGENT_VIEW = "Agentview"
NOPE = "Nope"
MODEL_FILE = "chair.glb"
TEXTURE_FILE = "wood.png"
LAUNCH_LABEL = "Launch"
OFFLINE_LABEL = "Offline billing"
LOCAL_PREFIX = "Local"
FOREIGN_PREFIX = "Foreign"
MENTION_PREFIX = "Mira"
REVIEW_COPY = "Review copy · read only"
CORS_ALLOW_ORIGIN = "Access-Control-Allow-Origin"
DATASTORE_PACKAGES = ("SQLite", "Redis")

_NO = object()
_TICK = threading.Event()


def poll(check: Callable[[], Any], seconds: float = WAIT_S, what: str = "condition") -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = check()
        if value:
            return value
        assert time.monotonic() < deadline, f"timed out after {seconds}s waiting for {what}"
        _TICK.wait(POLL_S)


def server_time(response: httpx.Response) -> datetime:
    header = response.headers.get("date")
    if header:
        return parsedate_to_datetime(header).astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local(value: str | datetime, tz: str) -> str:
    moment = parse_iso(value) if isinstance(value, str) else value
    return moment.astimezone(ZoneInfo(tz)).strftime("%Y-%m-%d %H:%M:%S") + f" ({tz})"


def clock(value: str, tz: str) -> str:
    return parse_iso(value).astimezone(ZoneInfo(tz)).strftime("%H:%M:%S")


def dollars(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def fresh(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    return (first, second) if "@" in second else (second, first)


def tag() -> str:
    return "q" + uuid.uuid4().hex[:8]


def nid(prefix: str = "n") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def r4(value: float) -> float:
    return round(float(value), 4)


def app_path(*parts: str) -> str:
    return "/".join(["", "app", *parts])


DASHBOARD_URL = re.compile(re.escape(app_path()) + "/?$")


def version_row(number: Any, label: str, state: str) -> str:
    return f"v{number} · {label} · {state}"


class Api:
    def __init__(self, base: str, bearer: str | None = None, session: str | None = None, origin: bool = True) -> None:
        self.base = base.rstrip("/")
        parts = urlsplit(self.base)
        self.origin = f"{parts.scheme}://{parts.netloc}"
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, headers={"Origin": self.origin} if origin else {})
        self.session: str | None = None
        if bearer:
            self.http.headers["Authorization"] = f"Bearer {bearer}"
        if session:
            self.use(session)

    def use(self, session: str) -> None:
        self.session = session
        self.http.headers["Cookie"] = f"{SESSION_COOKIE}={session}"

    def adopt(self, response: httpx.Response) -> httpx.Response:
        cookies = "; ".join(response.headers.get_list("set-cookie"))
        found = re.search(rf"{SESSION_COOKIE}=([^;,\s]+)", cookies)
        assert found, f"no session cookie in {cookies!r}"
        self.use(found.group(1))
        return response

    def call(self, method: str, path: str, body: Any = _NO, key: str | None = None, headers: dict | None = None, **kw: Any) -> httpx.Response:
        extra = dict(headers or {})
        if key is not None:
            extra["Idempotency-Key"] = key
        if body is not _NO:
            kw["json"] = body
        return self.http.request(method, path, headers=extra, **kw)

    def ok(self, method: str, path: str, body: Any = _NO, status: int = 200, key: str | None = None) -> Any:
        response = self.call(method, path, body, key=key)
        assert response.status_code == status, f"{method} {path}: {response.status_code} {response.text[:500]}"
        return response.json() if response.content else None

    def now(self) -> datetime:
        return server_time(self.http.get("/api/health"))


def login(base: str, email: str, password: str = PASSWORD) -> Api:
    api = Api(base)
    response = api.call("POST", "/api/auth/login", {"email": email, "password": password})
    assert response.status_code == 200, response.text
    api.adopt(response)
    return api


class Person:
    def __init__(self, api: Api, member: dict, name: str, email: str) -> None:
        self.api, self.member, self.name, self.email = api, member, name, email
        self.id = member["id"]


class Agent:
    def __init__(self, base: str, body: dict) -> None:
        self.body = body
        self.id = body["id"]
        self.name = body["name"]
        self.secret = body["token"]
        self.api = Api(base, bearer=self.secret)


class Ws:
    def __init__(self, base: str, tz: str = BERLIN, prefix: str = "owner") -> None:
        self.base = base.rstrip("/")
        self.tz = tz
        self.owner_name, self.owner_email = fresh(prefix)
        self.name = f"{self.owner_name} Works"[:NAME_MAX]
        self.owner = Api(self.base)
        response = self.owner.call("POST", "/api/signup", {
            "workspaceName": self.name, "name": self.owner_name, "email": self.owner_email,
            "password": PASSWORD, "timeZone": tz})
        assert response.status_code == 201, response.text
        self.owner.adopt(response)
        self.signup_response = response
        body = response.json()
        self.id = body["workspace"]["id"]
        self.owner_member = body["member"]
        self.subscription = body["subscription"]

    def invite(self, email: str, role: str, by: Api | None = None) -> dict:
        return (by or self.owner).ok("POST", "/api/members/invites", {"email": email, "role": role}, 201)

    def join(self, mail: Any, role: str, name: str | None = None, by: Api | None = None) -> Person:
        generated, email = fresh(role.replace("_", ""))
        name = name or generated
        self.invite(email, role, by)
        token = invite_token(mail, email)
        api = Api(self.base)
        response = api.call("POST", f"/api/invites/{token}/accept", {"name": name, "password": PASSWORD})
        assert response.status_code == 201, response.text
        api.adopt(response)
        return Person(api, response.json()["member"], name, email)

    def token(self, scope: str, name: str | None = None, seconds: int = DAY_S * 30, by: Api | None = None) -> Agent:
        name = name or f"Bot {uuid.uuid4().hex[:8]}"
        expires = (by or self.owner).now() + timedelta(seconds=seconds)
        body = (by or self.owner).ok("POST", "/api/agent-tokens", {"name": name, "scope": scope, "expiresAt": iso(expires)}, 201)
        return Agent(self.base, body)


def dashboard(api: Api) -> dict:
    return api.ok("GET", "/api/dashboard")


def audit(api: Api) -> list[dict]:
    return api.ok("GET", "/api/audit?limit=500")["entries"]


def newer_first(entries: list[dict], newer: int, older: int) -> None:
    newer_at, older_at = parse_iso(entries[newer]["at"]), parse_iso(entries[older]["at"])
    assert newer_at >= older_at, (entries[newer], entries[older])
    if newer_at != older_at:
        assert newer < older, (newer, older)


def subject_of(message: dict) -> str:
    return str(message.get("Subject", ""))


def to_of(message: dict) -> list[str]:
    return [a.lower() for a in addresses(message.get("To"))]


def _matches(message: dict, to: str | None, subject: Any) -> bool:
    if to is not None and to.lower() not in to_of(message):
        return False
    if subject is None:
        return True
    value = subject_of(message)
    return bool(subject(value)) if callable(subject) else value == subject


def find_mail(mail: Any, *, to: str | None = None, subject: Any = None, count: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages(settle=MAIL_SETTLE_S) if _matches(m, to, subject)]
        if len(found) >= count or time.monotonic() >= deadline:
            return found


def mail_now(mail: Any, *, to: str | None = None, subject: Any = None) -> list[dict]:
    return find_mail(mail, to=to, subject=subject, count=10 ** 9, seconds=0)


def invite_token(mail: Any, email: str) -> str:
    found = find_mail(mail, to=email, subject=lambda s: s.startswith("Join ") and s.endswith(" on Orrery Studio"))
    assert found, f"no invitation email for {email}"
    match = re.search(r"/invite/([A-Za-z0-9_\-.~%]+)", text(found[-1]))
    assert match, text(found[-1])
    return match.group(1)


class Scene:
    def __init__(self, sid: str, name: str, root: str, ids: dict[str, str]) -> None:
        self.id, self.name, self.root, self.ids = sid, name, root, ids


def op(kind: str, payload: dict) -> dict:
    return {"type": kind, "payload": payload}


def move(node_id: str, **fields: Any) -> dict:
    return op("transform.set", {"id": node_id, **fields})


def mesh(node_id: str, name: str, parent: str, **fields: Any) ->dict:
    node = {"id": node_id, "name": name, "kind": "mesh", "parentId": parent, "primitive": "box", "assetId": None,
            "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1], "materialLayers": [], "visible": True}
    node.update(fields)
    return node


def apply(api: Api, sid: str, *ops: dict, status: int = 201) -> Any:
    return api.ok("POST", f"/api/scenes/{sid}/ops", {"ops": list(ops)}, status)


def release(api: Api, sid: str, node_id: str) -> None:
    api.ok("DELETE", f"/api/scenes/{sid}/locks/{node_id}", status=204)


def new_scene(api: Api, names: tuple[str, ...] = ("Cup",), release_locks: bool = False, big: bool = False, name: str | None = None) -> Scene:
    name = name or f"Scene {uuid.uuid4().hex[:8]}"
    sid = api.ok("POST", "/api/scenes", {"name": name}, 201)["id"]
    graph = api.ok("GET", f"/api/scenes/{sid}")["graph"]
    root = next(n["id"] for n in graph["nodes"] if n["parentId"] is None)
    ids: dict[str, str] = {}
    if names:
        extra = {"scale": [3, 3, 3]} if big else {}
        nodes = [mesh(nid(), n, root, **extra) for n in names]
        apply(api, sid, *[op("node.add", {"node": n}) for n in nodes])
        ids = {n["name"]: n["id"] for n in nodes}
        if release_locks:
            for node_id in ids.values():
                release(api, sid, node_id)
    return Scene(sid, name, root, ids)


def scene_of(api: Api, sid: str) -> dict:
    return api.ok("GET", f"/api/scenes/{sid}")


def graph_at(api: Api, sid: str, at: int) -> dict:
    return api.ok("GET", f"/api/scenes/{sid}/graph?at={at}")


def node_in(graph: dict, node_id: str) -> dict | None:
    return next((n for n in graph["nodes"] if n["id"] == node_id), None)


def ops_of(api: Api, sid: str) -> list[dict]:
    return api.ok("GET", f"/api/scenes/{sid}/ops?limit=1000")["ops"]


def locks_of(api: Api, sid: str) -> list[dict]:
    return api.ok("GET", f"/api/scenes/{sid}/locks")["locks"]


def canon(value: Any) -> str:
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, (int, float)):
        rounded = round(float(value), 4)
        return str(int(rounded)) if rounded == int(rounded) else repr(rounded)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canon(v) for v in value) + "]"
    return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(value[k]) for k in sorted(value)) + "}"


def graph_hash(graph: dict) -> str:
    g = json.loads(json.dumps(graph))
    g["nodes"] = sorted(g["nodes"], key=lambda n: n["id"])
    for state in g["states"]:
        state["overrides"] = sorted(state["overrides"], key=lambda o: (o["nodeId"], o["field"]))
    g["states"] = sorted(g["states"], key=lambda s: s["id"])
    g["transitions"] = sorted(g["transitions"], key=lambda t: (t["from"], t["trigger"]))
    g["cameraViews"] = sorted(g["cameraViews"], key=lambda c: c["name"])
    return hashlib.sha256(canon(g).encode()).hexdigest()


def versions_of(api: Api, sid: str) -> list[dict]:
    return api.ok("GET", f"/api/scenes/{sid}/versions")["versions"]


def version_of(api: Api, sid: str, vid: str) -> dict:
    return next(v for v in versions_of(api, sid) if v["id"] == vid)


def approved(creator: Api, approver: Api, sid: str, label: str = "Launch") -> dict:
    v = creator.ok("POST", f"/api/scenes/{sid}/versions", {"label": label}, 201)
    creator.ok("POST", f"/api/versions/{v['id']}/submit", status=200)
    return approver.ok("POST", f"/api/versions/{v['id']}/approve", status=200)


def go_live(scheduler: Api, approver: Api, sid: str, creator: Api | None = None, label: str = "Launch", thumb: bool = False) -> dict:
    creator = creator or scheduler
    v = approved(creator, approver, sid, label)
    if thumb:
        r = scheduler.call("PUT", f"/api/versions/{v['id']}/thumbnail", content=png(), headers={"Content-Type": "image/png"})
        assert r.status_code == 204, r.text
    at = scheduler.now() + timedelta(seconds=PUBLISH_LEAD_S)
    scheduler.ok("POST", f"/api/versions/{v['id']}/schedule", {"publishAt": iso(at)}, 200)
    return poll(lambda: (lambda x: x if x["state"] == "published" else None)(version_of(scheduler, sid, v["id"])),
                WAIT_S, "go-live")


def glb(total: int | None = None, version: int = 2, length_delta: int = 0) -> bytes:
    positions = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
           "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
           "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "max": [1, 1, 0], "min": [0, 0, 0]}],
           "bufferViews": [{"buffer": 0, "byteLength": len(positions)}], "buffers": [{"byteLength": len(positions)}]}
    raw = json.dumps(doc).encode()
    raw += b" " * (-len(raw) % 4)
    body = struct.pack("<I", len(raw)) + b"JSON" + raw + struct.pack("<I", len(positions)) + b"BIN\x00" + positions
    if total is not None:
        pad = total - 12 - len(body) - 8
        body += struct.pack("<I", pad) + b"PADD" + b"\x00" * pad
    size = 12 + len(body)
    return b"glTF" + struct.pack("<II", version, size + length_delta) + body


def png(width: int = 4, height: int = 4, total: int | None = None) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    rows = b"".join(b"\x00" + b"\x80\x40\x20" * width for _ in range(height))
    head = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows))
    tail = chunk(b"IEND", b"")
    if total is not None:
        filler = total - len(head) - len(tail) - 12 - 4
        head += chunk(b"tEXt", b"pad\x00" + b"a" * filler)
    return head + tail


def jpeg(width: int = 4, height: int = 4) -> bytes:
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 17, 8, height, width, 3) + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    return b"\xff\xd8" + app0 + sof + b"\xff\xd9"


SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def upload(api: Api, kind: str, name: str, data: bytes) -> httpx.Response:
    return api.http.post("/api/assets", data={"kind": kind}, files={"file": (name, data, "application/octet-stream")})


def s3_keys(prefix: str) -> list[str]:
    return S3().keys(prefix)


def checkout(api: Api, plan: str = "team", period: str = "monthly", extra: int = 0, key: str | None = None, card: dict | None = None) -> httpx.Response:
    return api.call("POST", "/api/billing/checkout",
                    {"plan": plan, "period": period, "extraSeats": extra, "card": card or CARD}, key=key or idempotency_key())


def active_ws(base: str, extra: int = 0, tz: str = BERLIN) -> tuple[Ws, dict]:
    ws = Ws(base, tz)
    r = checkout(ws.owner, extra=extra)
    assert r.status_code == 201, r.text
    return ws, r.json()


def webhook(base: str, secret: str, event: dict, signature: str | None = None) -> httpx.Response:
    raw = json.dumps(event).encode()
    sig = signature or "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return httpx.post(base + "/api/billing/webhook", content=raw, timeout=HTTP_TIMEOUT_S,
                      headers={"Content-Type": "application/json", "Orrery-Signature": sig})


def secret_of(ws: Ws) -> str:
    return ws.owner.ok("GET", "/api/billing/gateway")["signingSecret"]


def fail_payment(ws: Ws, payment_id: str) -> httpx.Response:
    return webhook(ws.base, secret_of(ws), {"id": nid("evt"), "type": "payment.failed", "workspaceId": ws.id,
                                            "paymentId": payment_id, "reason": "card_declined"})


def kb_payments(killbill: Any, ws_id: str) -> list[dict]:
    account = killbill.account_by_key(ws_id)
    return killbill.payments(account["accountId"]) if account else []


def kb_tx(payments: list[dict], kind: str) -> list[dict]:
    found: list[dict] = []

    def walk(o: Any) -> None:
        if isinstance(o, dict):
            if kind in o.values():
                found.append(o)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(payments)
    return found


def kb_purchase(killbill: Any, ws_id: str, external_key: str) -> dict | None:
    found = {t["transactionId"]: t for t in kb_tx(kb_payments(killbill, ws_id), "PURCHASE")
             if t.get("transactionId") and t.get("transactionExternalKey") == external_key}
    assert len(found) <= 1, f"{len(found)} PURCHASE transactions carry {external_key}"
    return next(iter(found.values()), None)


def tx_cents(tx: dict) -> set[int]:
    return {round(float(v) * 100) for v in tx.values() if isinstance(v, (int, float)) and not isinstance(v, bool)}


def invoices_of(api: Api) -> dict:
    return api.ok("GET", "/api/billing/invoices")


def receipt_subject(invoice: dict) -> str:
    return f"Receipt for invoice {invoice['number']}: {dollars(invoice['amountCents'])}"


@contextmanager
def app_page(browser: Browser, base: str, path: str | None, api: Api | None = None, *, size: tuple[int, int] = DESKTOP,
             reduced: bool = False, no_webgl: bool = False, live: bool = True) -> Iterator[Page]:
    base = base.rstrip("/")
    with open_app(browser, base + "/api/health", reduced_motion="reduce" if reduced else "no-preference", no_webgl=no_webgl) as pg:
        pg.set_viewport_size({"width": size[0], "height": size[1]})
        if api is not None and api.session:
            pg.context.add_cookies([{"name": SESSION_COOKIE, "value": api.session, "url": base}])
        if live:
            pg.clock.resume()
        if path is not None:
            pg.goto(base + path)
        yield pg


def num(loc: Locator) -> float:
    value = loc.get_attribute("aria-valuenow")
    if value in (None, ""):
        value = loc.input_value()
    return float(value)


def any_visible(loc: Locator) -> bool:
    return any(match.is_visible() for match in loc.all())


def inspector(pg: Page, field: str) -> Locator:
    return pg.get_by_role("region", name="Inspector").get_by_role("spinbutton", name=field, exact=True)


def viewport(pg: Page) -> Locator:
    return pg.get_by_role("region", name="Viewport")


def commit(loc: Locator, value: str) -> None:
    fill(loc, value)
    loc.press("Enter")


def sheet(pg: Page) -> None:
    pg.get_by_role("button", name="Versions", exact=True).first.click()


def stepped(pg: Page, check: Callable[[], Any], seconds: float = UI_MS / 1000, what: str = "condition") -> Any:
    deadline = time.monotonic() + seconds
    while not (value := check()):
        assert time.monotonic() < deadline, f"timed out after {seconds}s waiting for {what}"
        advance(pg, FRAME_STEP_MS)
    return value


def slider_is(slider: Locator, key: str, want: int, pg: Page | None = None) -> None:
    def at() -> bool:
        return slider.evaluate(SLIDER_JS)[key] == want
    if pg is None:
        poll(at, UI_MS / 1000, f"slider {key} {want}")
    else:
        stepped(pg, at, what=f"slider {key} {want}")


def shows(pg: Page, loc: Locator, want: str) -> None:
    stepped(pg, lambda: " ".join((loc.text_content() or "").split()) == want, what=repr(want))
    expect(loc).to_have_text(want)


def listed(pg: Page, items: Locator, want: list[str]) -> None:
    stepped(pg, lambda: [" ".join(t.split()) for t in items.all_text_contents()] == want, what=repr(want))
    expect(items).to_have_text(want)


def focus_tree(tree: Locator) -> None:
    first = tree.get_by_role("treeitem").first
    first.focus()
    if not _is_active(first) and not tree.evaluate("(el) => el.contains(document.activeElement)"):
        tree.focus()


def pick_mention(pg: Page, picker: Locator) -> None:
    if not picker.evaluate(OPTION_ACTIVE_JS):
        pg.keyboard.press("ArrowDown")
    pg.keyboard.press("Enter")


def one_word(prefix: str) -> str:
    return prefix + "".join(chr(ord("a") + int(c, 16)) for c in uuid.uuid4().hex[:8])


SLIDER_JS = ("(e) => { if (e instanceof HTMLInputElement) return {min: e.min === '' ? 0 : Number(e.min),"
             " max: e.max === '' ? 100 : Number(e.max), now: Number(e.value)};"
             " const a = (n, d) => { const v = e.getAttribute('aria-value' + n); return v === null || v === '' ? d : Number(v); };"
             " return {min: a('min', 0), max: a('max', 100), now: a('now', NaN)}; }")
TICKS_LEFT_JS = ("() => Math.min(Infinity, ...Array.from(document.querySelectorAll('[data-author-kind]'))"
                 ".map(e => e.getBoundingClientRect().left))")
HEADER_JS = ("(w) => { const num = new RegExp('(^|[^0-9])' + w.n + '([^0-9]|$)'); let best = null;"
             " for (const e of document.body.querySelectorAll('*')) { const c = e.cloneNode(true);"
             " c.querySelectorAll('[role=listbox], [role=option], select, option').forEach(n => n.remove());"
             " const t = c.textContent || ''; if (!t.includes(w.copy) || !t.includes(w.name)) continue;"
             " if (!num.test(t.split(w.name).join(' ').split(w.copy).join(' '))) continue;"
             " if (best === null || t.length < best.length) best = t; }"
             " return best; }")
OPTION_ACTIVE_JS = ("(lb) => { const id = document.activeElement && document.activeElement.getAttribute('aria-activedescendant');"
                    " return Array.from(lb.querySelectorAll('[role=option], option')).some(o =>"
                    " o.getAttribute('aria-selected') === 'true' || o.selected === true || (!!id && o.id === id)); }")
MID_DRAG_JS = ("(w) => { const v = document.querySelector('[data-graph-hash]');"
               " const s = v ? Number(v.getAttribute('data-op-seq')) : NaN; return s > 0 && s < w.latest; }")


VIEW_JS = ("(w) => { const v = document.querySelector('[data-graph-hash]');"
           " return !!v && v.getAttribute('data-op-seq') === String(w.seq) && (!w.hash || v.getAttribute('data-graph-hash') === w.hash); }")
READY_JS = "() => !!document.querySelector('[data-graph-hash]')"
TICK_COUNT_JS = "() => document.querySelectorAll('[data-author-kind]').length"
TICK_JS = ("(w) => { const t = Array.from(document.querySelectorAll('[data-author-kind]'))"
           ".find(e => e.getAttribute('data-op-seq') === String(w.seq));"
           " return t ? {kind: t.getAttribute('data-author-kind'),"
           " running: t.getAnimations({subtree: true}).filter(a => a.playState === 'running').length} : null; }")
TICK_STRENGTH = (
    "const cv = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});"
    " const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = 'rgba(0, 0, 0, 0)'; cv.fillStyle = c || 'rgba(0, 0, 0, 0)';"
    " cv.fillRect(0, 0, 1, 1); return Array.from(cv.getImageData(0, 0, 1, 1).data); };"
    " const strength = (seq) => { const t = Array.from(document.querySelectorAll('[data-author-kind]'))"
    ".find(e => e.getAttribute('data-op-seq') === String(seq)); if (!t) return 0;"
    " let g = [255, 255, 255]; for (let n = t.parentElement; n; n = n.parentElement) {"
    " const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] === 255) { g = c; break; } }"
    " const shown = (e) => { if (typeof e.checkVisibility === 'function' && !e.checkVisibility({visibilityProperty: true, opacityProperty: false}))"
    " return false; const r = e.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false;"
    " for (let n = e; n; n = n.parentElement) { const s = getComputedStyle(n);"
    " if (s.position === 'absolute' || s.position === 'fixed') { if (s.clip && s.clip !== 'auto') return false; }"
    " if (/inset\\(\\s*(50|[5-9]\\d|100)(\\.\\d+)?%/.test(s.clipPath || '')) return false; if (n === t) break; } return true; };"
    " const ink = (c, o) => { const v = rgba(c); return o * v[3] / 255 * Math.hypot(v[0] - g[0], v[1] - g[1], v[2] - g[2]); };"
    " let best = 0; const marks = (s, o, shape) => { best = Math.max(best, ink(s.backgroundColor, o),"
    " parseFloat(s.borderTopWidth) > 0 ? ink(s.borderTopColor, o) : 0, shape ? ink(s.fill, o * parseFloat(s.fillOpacity)) : 0,"
    " shape && s.stroke !== 'none' ? ink(s.stroke, o * parseFloat(s.strokeOpacity)) : 0); };"
    " const filtered = (s) => { const m = /opacity\\(([\\d.]+)(%?)\\)/.exec(s.filter || ''); return m ? parseFloat(m[1]) / (m[2] ? 100 : 1) : 1; };"
    " const walk = (e, carried) => { const s = getComputedStyle(e); const o = carried * parseFloat(s.opacity) * filtered(s);"
    " if (shown(e)) { marks(s, o, e instanceof SVGGeometryElement);"
    " if (Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) best = Math.max(best, ink(s.color, o));"
    " if (!(e instanceof SVGElement)) for (const p of ['::before', '::after']) { const q = getComputedStyle(e, p);"
    " if (q.content && q.content !== 'none' && q.display !== 'none' && q.visibility === 'visible') marks(q, o * parseFloat(q.opacity), false); } }"
    " for (const c of e.children) walk(c, o); }; walk(t, 1); return best; };"
)
TICK_STRENGTH_JS = "(seq) => { " + TICK_STRENGTH + " return strength(seq); }"
TICK_FADED_JS = "(w) => { " + TICK_STRENGTH + " return Math.abs(strength(w.seq) / w.full - w.o) < 0.05; }"
LOOPS_JS = ("() => document.getAnimations().filter(a => { const t = a.effect && a.effect.getComputedTiming();"
            " return t && t.iterations === Infinity && a.playState === 'running'; }).map(a => Number(a.effect.getComputedTiming().duration) || 0)")
RECORD_JS = (
    "() => {"
    " window.__motion = [];"
    " const ms = (s) => { const v = parseFloat(s) || 0; return s.trim().endsWith('ms') ? v : v * 1000; };"
    " const rec = (target, d, kf) => window.__motion.push({target, d, kf: String(kf)});"
    " document.addEventListener('animationstart', (e) => {"
    " const cs = getComputedStyle(e.target); const names = cs.animationName.split(',').map(n => n.trim());"
    " const durs = cs.animationDuration.split(','); const i = Math.max(0, names.indexOf(e.animationName));"
    " const a = e.target.getAnimations().find(x => x.animationName === e.animationName);"
    " rec(e.target, ms(durs[i % durs.length]), a ? JSON.stringify(a.effect.getKeyframes()) : e.animationName);"
    " }, true);"
    " document.addEventListener('transitionrun', (e) => {"
    " const cs = getComputedStyle(e.target); const props = cs.transitionProperty.split(',').map(p => p.trim());"
    " const durs = cs.transitionDuration.split(','); let i = props.indexOf(e.propertyName); if (i < 0) i = 0;"
    " rec(e.target, ms(durs[i % durs.length]), e.propertyName);"
    " }, true);"
    " const orig = Element.prototype.animate;"
    " Element.prototype.animate = function (kf, opts) {"
    " const d = typeof opts === 'number' ? opts : (opts && opts.duration) || 0;"
    " rec(this, Number(d) || 0, JSON.stringify(kf)); return orig.call(this, kf, opts);"
    " };"
    " }"
)
MOTION_FOR_JS = ("(el) => window.__motion.filter(m => el.contains(m.target) || m.target.contains(el))"
                 ".filter(m => m.target !== document.documentElement && m.target !== document.body).map(m => ({d: m.d, kf: m.kf}))")


def foreign_404(response: httpx.Response) -> None:
    assert response.status_code == 404 and response.json() == {"error": "not_found"}, response.text


def test_public_home_and_pricing(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url, "/") as pg:
        expect(pg.get_by_role("heading", level=1, name="3D scenes your whole team can trace")).to_be_visible(timeout=UI_MS)
        nav = pg.get_by_role("navigation", name="Main")
        for name in ("Product", "Pricing", "Sign in", "Start free trial"):
            expect(nav.get_by_role("link", name=name, exact=True)).to_have_count(1)
        assert pg.get_by_role("region").count() >= 5
        body = pg.evaluate("() => document.body.innerText")
        marks = [body.find(n) for n in ("01", "02", "03", "04", "05")]
        assert min(marks) >= 0 and marks == sorted(marks), marks
        pg.goto(app_url + "/pricing")
        period = pg.get_by_role("radiogroup", name="Billing period")
        expect(period.get_by_role("radio", name="Monthly")).to_be_checked(timeout=UI_MS)
        table = pg.get_by_role("table", name="Compare plans")
        monthly = table.inner_text().lower()
        for s in ("Team", "Business", "Price", "Included seats", "Extra seat", "Agent tokens", "Scheduled publishing",
                  "Review links", "$96.00", "$380.00", "$12.00", "$16.00", "/ month", "Up to 5", "Up to 25", "Included"):
            assert s.lower() in monthly, s
        assert "/ year" not in monthly
        period.get_by_role("radio", name="Annual").click()
        expect(table).to_contain_text("$3,800.00", timeout=UI_MS)
        annual = table.inner_text().lower()
        for s in ("$960.00", "$120.00", "$160.00", "/ year"):
            assert s in annual, s
        assert "$96.00" not in annual and "/ month" not in annual
        links = pg.get_by_role("link", name="Start free trial", exact=True)
        for i in range(links.count()):
            assert urlsplit(links.nth(i).evaluate("a => a.href")).path == "/signup"
        links.last.click()
        expect(pg).to_have_url(re.compile(r"/signup$"), timeout=UI_MS)


def _signup_ui(pg: Page, ws_name: str, name: str, email: str) -> None:
    form = pg.get_by_role("form", name="Start your trial")
    fill(form.get_by_role("textbox", name="Workspace name"), ws_name)
    fill(form.get_by_role("textbox", name="Your name"), name)
    fill(form.get_by_role("textbox", name="Work email"), email)
    fill(form.get_by_label("Password", exact=True), PASSWORD)
    select(form.get_by_role("combobox", name="Time zone"), BERLIN)
    form.get_by_role("button", name="Start 14-day trial").click()


def test_wf_public_site_trial_happy(browser: Browser, app_url: str) -> None:
    name, email = fresh("visitor")
    ws_name = f"{name} Lab"[:NAME_MAX]
    with app_page(browser, app_url, "/") as pg:
        pg.get_by_role("navigation", name="Main").get_by_role("link", name="Pricing").click()
        expect(pg).to_have_url(re.compile(r"/pricing$"), timeout=UI_MS)
        pg.get_by_role("radiogroup", name="Billing period").get_by_role("radio", name="Annual").click()
        expect(pg.get_by_role("table", name="Compare plans")).to_contain_text("/ year", timeout=UI_MS)
        pg.get_by_role("link", name="Start free trial", exact=True).last.click()
        expect(pg).to_have_url(re.compile(r"/signup$"), timeout=UI_MS)
        _signup_ui(pg, ws_name, name, email)
        expect(pg).to_have_url(DASHBOARD_URL, timeout=UI_MS)
        me = pg.request.get(app_url + "/api/me")
        assert me.status == 200
        body = me.json()
        assert body["member"]["role"] == "owner" and body["member"]["email"].lower() == email.lower()
        assert body["workspace"]["name"] == ws_name and body["workspace"]["timeZone"] == BERLIN
        sub = body["subscription"]
        assert sub["state"] == "trial"
        elapsed = (parse_iso(sub["trialEndsAt"]) - server_time(httpx.Response(200, headers=dict(me.headers)))).total_seconds()
        assert abs(elapsed - TRIAL_DEFAULT_S) <= WAIT_S
        expect(pg.get_by_role("region", name="Subscription")).to_contain_text(f"Trial ends {local(sub['trialEndsAt'], BERLIN)}", timeout=UI_MS)
        expect(pg.get_by_role("region", name="Seats")).to_contain_text(f"1 of {TRIAL_SEATS} seats used")
        expect(pg.get_by_role("region", name="Scenes")).to_contain_text(f"{0} scenes, {0} published")


def test_wf_public_site_trial_form_errors(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    with app_page(browser, app_url, "/signup") as pg:
        _signup_ui(pg, "Another", "Someone", ws.owner_email)
        poll(lambda: any_visible(pg.get_by_text("That email already has a workspace. Sign in instead.")), UI_MS / 1000, "taken-email copy")
        pg.goto(app_url + "/login")
        form = pg.get_by_role("form", name="Sign in")
        fill(form.get_by_role("textbox", name="Email"), ws.owner_email)
        fill(form.get_by_label("Password", exact=True), "not-the-password")
        form.get_by_role("button", name="Sign in").click()
        poll(lambda: any_visible(pg.get_by_text("Email or password is incorrect.")), UI_MS / 1000, "wrong-password copy")
        fill(form.get_by_label("Password", exact=True), PASSWORD)
        form.get_by_role("button", name="Sign in").click()
        expect(pg).to_have_url(DASHBOARD_URL, timeout=UI_MS)
        assert pg.request.get(app_url + "/api/me").json()["member"]["email"].lower() == ws.owner_email.lower()


def test_wf_public_site_trial_billing_down(browser: Browser) -> None:
    base = env_url("APP_KILLBILL_DOWN_URL")
    name, email = fresh("visitor")
    with app_page(browser, base, "/signup") as pg:
        _signup_ui(pg, f"{name} Down"[:NAME_MAX], name, email)
        expect(pg).to_have_url(DASHBOARD_URL, timeout=UI_MS)
        expect(pg.get_by_role("region", name="Subscription")).to_contain_text("Trial ends ", timeout=UI_MS)
        me = pg.request.get(base + "/api/me").json()
        assert me["member"]["role"] == "owner" and me["subscription"]["state"] == "trial"
        assert pg.request.get(base + "/api/billing").json()["subscription"]["state"] == "trial"


def test_sessions_and_credentials(app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner)
    agent = ws.token("read")
    anon = Api(app_url)
    r = anon.call("POST", "/api/auth/login", {"email": ws.owner_email, "password": PASSWORD})
    assert r.status_code == 200 and r.json()["member"]["email"].lower() == ws.owner_email.lower()
    assert r.json()["workspace"]["id"] == ws.id
    cookie = "; ".join(r.headers.get_list("set-cookie")).lower()
    for part in (f"{SESSION_COOKIE}=", "httponly", "samesite=lax", "path=/"):
        assert part in cookie, cookie
    for creds in ({"email": ws.owner_email, "password": "wrong-password"}, {"email": fresh("nobody")[1], "password": PASSWORD}):
        bad = anon.call("POST", "/api/auth/login", creds)
        assert bad.status_code == 401 and bad.json() == {"error": "invalid_credentials"}
    member = Api(app_url)
    member.adopt(r)
    assert member.ok("GET", "/api/me")["member"]["id"] == ws.owner_member["id"]
    me = agent.api.ok("GET", "/api/me")
    assert me["agent"]["name"] == agent.name and me["agent"]["scope"] == "read" and me["workspace"]["id"] == ws.id
    mixed = Api(app_url, bearer="orr_" + "x" * 40, session=member.session)
    assert mixed.call("GET", "/api/me").json() == {"error": "unauthenticated"}
    routes = [("GET", "/api/me"), ("GET", "/api/workspace"), ("GET", "/api/dashboard"), ("GET", "/api/members"),
              ("GET", "/api/audit"), ("GET", "/api/agent-tokens"), ("GET", "/api/scenes"), ("GET", "/api/search?q=ab"),
              ("GET", "/api/assets"), ("GET", "/api/billing"), ("GET", "/api/billing/invoices"), ("GET", f"/api/scenes/{sc.id}"),
              ("GET", f"/api/scenes/{sc.id}/ops"), ("GET", f"/api/scenes/{sc.id}/versions"), ("POST", "/api/scenes"),
              ("POST", f"/api/scenes/{sc.id}/ops"), ("POST", "/api/members/invites"), ("POST", "/api/agent-tokens"),
              ("POST", "/api/billing/checkout"), ("PATCH", "/api/workspace"), ("DELETE", f"/api/members/{ws.owner_member['id']}")]
    junk = Api(app_url, session="not-a-session")
    for method, path in routes:
        for client in (Api(app_url), junk):
            resp = client.call(method, path, {} if method != "GET" else _NO)
            assert resp.status_code == 401 and resp.json() == {"error": "unauthenticated"}, (method, path, resp.text)
    assert member.call("POST", "/api/auth/logout").status_code == 204
    assert member.call("GET", "/api/me").status_code == 401


def test_trial_end_short_clock(browser: Browser) -> None:
    base = env_url("APP_SHORT_CLOCK_URL")
    ws = Ws(base)
    ends = parse_iso(ws.subscription["trialEndsAt"])
    assert abs((ends - server_time(ws.signup_response)).total_seconds() - TRIAL_SHORT_S) <= CLOCK_SKEW_S
    r = ws.owner.call("POST", "/api/scenes", {"name": "Before the end"})
    if server_time(r) + timedelta(seconds=CLOCK_SKEW_S) <= ends:
        assert r.status_code == 201, r.text

    def suspended() -> bool:
        resp = ws.owner.call("GET", "/api/billing")
        at, state = server_time(resp), resp.json()["subscription"]["state"]
        if at + timedelta(seconds=CLOCK_SKEW_S) <= ends:
            assert state == "trial", f"suspended early at {at}"
        if at >= ends + timedelta(seconds=SCHEDULER_LAG_S + CLOCK_SKEW_S):
            assert state == "suspended", f"still {state} at {at}"
        return state == "suspended"
    poll(suspended, TRIAL_SHORT_S + WAIT_S, "trial end")
    r = ws.owner.call("POST", "/api/scenes", {"name": "After the end"})
    assert r.status_code == 402 and r.json() == {"error": "workspace_read_only"}
    assert ws.owner.call("GET", "/api/scenes").status_code == 200
    ended = [e for e in audit(ws.owner) if e["action"] == "subscription.trial_ended"]
    assert ended and all(e["actor"]["kind"] == "system" for e in ended)
    with app_page(browser, base, app_path(), ws.owner) as pg:
        expect(pg.get_by_role("status", name="Service status")).to_contain_text(
            "Your trial has ended. Start a paid plan to keep editing.", timeout=UI_MS)
    r = checkout(ws.owner)
    assert r.status_code == 201 and r.json()["subscription"]["state"] == "active", r.text
    assert ws.owner.call("POST", "/api/scenes", {"name": "Paid again"}).status_code == 201


def test_wf_members_seats_invite_join(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    admin = ws.join(mail, "admin")
    name, email = fresh("invitee")
    with app_page(browser, app_url, app_path(), admin.api) as pg:
        expect(pg.get_by_role("region", name="Seats")).to_contain_text(f"2 of {TRIAL_SEATS} seats used", timeout=UI_MS)
        pg.goto(app_url + app_path("members"))
        pg.get_by_role("button", name="Invite member").click()
        dialog = pg.get_by_role("dialog", name="Invite member")
        fill(dialog.get_by_role("textbox", name="Email"), email)
        select(dialog.get_by_role("combobox", name="Role"), "Editor")
        dialog.get_by_role("button", name="Send invite").click()
        expect(pg.get_by_role("status", name="Members status")).to_contain_text(
            f"Invitation created for {email}. The email is on its way.", timeout=UI_MS)
        pg.goto(app_url + app_path())
        expect(pg.get_by_role("region", name="Seats")).to_contain_text(f"3 of {TRIAL_SEATS} seats used", timeout=UI_MS)
    found = find_mail(mail, to=email, subject=f"Join {ws.name} on Orrery Studio")
    assert len(found) == 1
    sender = found[0].get("From") or {}
    assert addresses(sender) == [mail_from_address()] or [a.lower() for a in addresses(sender)] == [mail_from_address().lower()]
    assert sender.get("Name") == f"{admin.name} via Orrery Studio"
    token = re.search(r"/invite/([A-Za-z0-9_\-.~%]+)", text(found[0])).group(1)
    with app_page(browser, app_url, f"/invite/{token}") as pg:
        form = pg.get_by_role("form", name="Join workspace")
        fill(form.get_by_role("textbox", name="Your name"), name)
        fill(form.get_by_label("Password", exact=True), PASSWORD)
        form.get_by_role("button", name=f"Join {ws.name}").click()
        expect(pg).to_have_url(DASHBOARD_URL, timeout=UI_MS)
    listing = ws.owner.ok("GET", "/api/members")
    joined = [m for m in listing["members"] if m["email"].lower() == email.lower()]
    assert len(joined) == 1 and joined[0]["role"] == "editor" and joined[0]["name"] == name
    assert not [i for i in listing["invites"] if i["email"].lower() == email.lower()]


def test_role_permissions_forbidden(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    admin, billing = ws.join(mail, "admin"), ws.join(mail, "billing_manager")
    editor, viewer, target = ws.join(mail, "editor"), ws.join(mail, "viewer"), ws.join(mail, "viewer")
    sc = new_scene(ws.owner, release_locks=True)
    cup = sc.ids["Cup"]
    agent = ws.token("read")
    _, pending = fresh("pending")
    invite = ws.invite(pending, "viewer")
    version = ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Perm"}, 201)
    seq = scene_of(ws.owner, sc.id)["latestSeq"]
    no_scene = (admin, billing, viewer)
    actions = [
        ("POST", "/api/scenes", {"name": NOPE, "role": "owner", "workspaceId": ws.id}, no_scene),
        ("UPLOAD", "/api/assets", None, no_scene),
        ("THUMB", f"/api/versions/{version['id']}/thumbnail", None, no_scene),
        ("POST", f"/api/scenes/{sc.id}/ops", {"ops": [move(cup, position=[1, 0, 0])]}, no_scene),
        ("POST", f"/api/scenes/{sc.id}/undo", _NO, no_scene),
        ("POST", f"/api/scenes/{sc.id}/redo", _NO, no_scene),
        ("POST", f"/api/scenes/{sc.id}/restore", {"toSeq": 0}, no_scene),
        ("POST", f"/api/scenes/{sc.id}/locks", {"nodeId": cup}, no_scene),
        ("POST", f"/api/scenes/{sc.id}/locks/{cup}/takeover", _NO, no_scene),
        ("POST", "/api/members/invites", {"email": fresh("x")[1], "role": "viewer"}, (editor, viewer)),
        ("POST", "/api/members/invites", {"email": fresh("x")[1], "role": "admin"}, (billing,)),
        ("DELETE", f"/api/members/invites/{invite['id']}", _NO, (editor, viewer)),
        ("DELETE", f"/api/members/{target.id}", _NO, (billing, editor, viewer)),
        ("GET", "/api/agent-tokens", _NO, (billing, editor, viewer)),
        ("POST", "/api/agent-tokens", {"name": NOPE, "scope": "edit", "expiresAt": iso(ws.owner.now() + timedelta(days=1))}, (billing, editor, viewer)),
        ("DELETE", f"/api/agent-tokens/{agent.id}", _NO, (billing, editor, viewer)),
        ("GET", "/api/audit", _NO, (billing, editor, viewer)),
        ("PATCH", "/api/workspace", {"name": "Hijacked"}, (admin, billing, editor, viewer)),
        ("POST", "/api/billing/cancel", _NO, (admin, billing, editor, viewer)),
        ("GET", "/api/billing/gateway", _NO, (admin, billing, editor, viewer)),
        ("GET", "/api/billing", _NO, (admin, editor, viewer)),
        ("POST", "/api/billing/checkout", {"plan": "team", "period": "monthly", "extraSeats": 0, "card": CARD}, (admin, editor, viewer)),
    ]
    for method, path, body, denied in actions:
        for person in denied:
            if method == "UPLOAD":
                r = upload(person.api, "model", "probe.glb", glb())
            elif method == "THUMB":
                r = person.api.call("PUT", path, content=png(), headers={"Content-Type": "image/png"})
            else:
                key = idempotency_key() if path.startswith("/api/billing") and method == "POST" else None
                r = person.api.call(method, path, body, key=key)
            assert r.status_code == 403 and r.json() == {"error": "forbidden"}, (person.member["role"], method, path, r.text)
    assert NOPE not in [s["name"] for s in ws.owner.ok("GET", "/api/scenes")["scenes"]]
    assert scene_of(ws.owner, sc.id)["latestSeq"] == seq
    assert ws.owner.ok("GET", "/api/workspace")["name"] == ws.name
    listing = ws.owner.ok("GET", "/api/members")
    assert target.id in [m["id"] for m in listing["members"]] and invite["id"] in [i["id"] for i in listing["invites"]]
    assert [t["status"] for t in ws.owner.ok("GET", "/api/agent-tokens")["tokens"] if t["id"] == agent.id] == ["active"]
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "trial"


def test_last_seat_race(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    for _ in range(TRIAL_SEATS - 2):
        ws.invite(fresh("seat")[1], "viewer")
    d = dashboard(ws.owner)
    assert d["seatsUsed"] == TRIAL_SEATS - 1 and d["seatsPurchased"] == TRIAL_SEATS
    racers = [fresh("racer")[1] for _ in range(RACERS)]
    barrier = threading.Barrier(RACERS)

    def go(email: str) -> tuple[str, httpx.Response]:
        client = Api(app_url, session=ws.owner.session)
        barrier.wait()
        return email, client.call("POST", "/api/members/invites", {"email": email, "role": "viewer"})
    with ThreadPoolExecutor(RACERS) as pool:
        results = list(pool.map(go, racers))
    winners = [e for e, r in results if r.status_code == 201]
    assert len(winners) == 1, [(e, r.status_code) for e, r in results]
    losers = [e for e, r in results if r.status_code != 201]
    for e, r in results:
        if e in losers:
            assert r.status_code == 409 and r.json() == {"error": "no_seats_left", "seatsUsed": TRIAL_SEATS, "seatsPurchased": TRIAL_SEATS}
    assert dashboard(ws.owner)["seatsUsed"] == TRIAL_SEATS
    extra = ws.owner.call("POST", "/api/members/invites", {"email": fresh("late")[1], "role": "viewer"})
    assert extra.status_code == 409 and extra.json()["error"] == "no_seats_left"
    assert find_mail(mail, to=winners[0], subject=f"Join {ws.name} on Orrery Studio")
    for e in losers:
        assert not mail_now(mail, to=e)
    invite = next(i for i in ws.owner.ok("GET", "/api/members")["invites"] if i["email"].lower() == winners[0].lower())
    ws.owner.ok("DELETE", f"/api/members/invites/{invite['id']}", status=204)
    assert dashboard(ws.owner)["seatsUsed"] == TRIAL_SEATS - 1


def test_offboarding(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    editor = ws.join(mail, "editor")
    second = login(app_url, editor.email)
    sc = new_scene(ws.owner, release_locks=True)
    cup = sc.ids["Cup"]
    apply(editor.api, sc.id, move(cup, position=[1, 0, 0]))
    assert locks_of(ws.owner, sc.id)[0]["holder"]["name"] == editor.name
    poll(lambda: PocketBase().records("object_locks", f'scene="{sc.id}" && node="{cup}"'), RT_MS / 1000, "PocketBase lock")
    used = dashboard(ws.owner)["seatsUsed"]
    other = Ws(app_url)
    foreign_404(other.owner.call("DELETE", f"/api/members/{editor.id}"))
    foreign_404(other.owner.call("DELETE", "/api/members/mem_missing_probe"))
    assert editor.api.call("GET", "/api/me").status_code == 200
    assert ws.owner.call("DELETE", f"/api/members/{editor.id}").status_code == 204
    for api in (editor.api, second):
        assert api.call("GET", "/api/me").json() == {"error": "unauthenticated"}
    assert not [lk for lk in locks_of(ws.owner, sc.id) if lk["nodeId"] == cup]
    poll(lambda: not PocketBase().records("object_locks", f'scene="{sc.id}" && node="{cup}"'), RT_MS / 1000, "PocketBase lock cleared")
    assert dashboard(ws.owner)["seatsUsed"] == used - 1
    assert ops_of(ws.owner, sc.id)[-1]["author"]["name"] == editor.name
    admin = ws.join(mail, "admin")
    r = admin.api.call("DELETE", f"/api/members/{ws.owner_member['id']}")
    assert r.status_code == 409 and r.json() == {"error": "owner_cannot_be_removed"}


def test_wf_members_seats_offboard(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    viewer = ws.join(mail, "viewer")
    with app_page(browser, app_url, app_path("members"), ws.owner) as pg:
        pg.get_by_role("button", name=f"Remove {viewer.name}").click()
        pg.get_by_role("alertdialog", name="Remove member").get_by_role("button", name="Cancel").click()
        assert viewer.api.call("GET", "/api/me").status_code == 200
        pg.get_by_role("button", name=f"Remove {viewer.name}").click()
        pg.get_by_role("alertdialog", name="Remove member").get_by_role("button", name="Remove", exact=True).click()
        expect(pg.get_by_role("status", name="Members status")).to_contain_text(
            f"{viewer.name} was removed. Their seat is free.", timeout=UI_MS)
    assert viewer.api.call("GET", "/api/me").status_code == 401
    assert viewer.id not in [m["id"] for m in ws.owner.ok("GET", "/api/members")["members"]]
    assert dashboard(ws.owner)["seatsUsed"] == 1


def test_audit_trail(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    admin = ws.join(mail, "admin")
    sc = new_scene(ws.owner, release_locks=True)
    _, email = fresh("audited")
    invite = ws.invite(email, "viewer", by=admin.api)
    assert ws.owner.call("POST", "/api/members/invites", {"email": email, "role": "viewer"}).json() == {"error": "already_member"}
    agent = ws.token("edit")
    ws.owner.ok("PATCH", "/api/workspace", {"name": ws.name + " II"})
    ws.owner.ok("DELETE", f"/api/members/invites/{invite['id']}", status=204)
    apply(ws.owner, sc.id, move(sc.ids["Cup"], position=[1, 0, 0]))
    release(ws.owner, sc.id, sc.ids["Cup"])
    agent.api.ok("POST", f"/api/scenes/{sc.id}/restore", {"toSeq": 1}, 201)
    expected = [("scene.restored", sc.id, "agent", agent.name), ("invite.revoked", invite["id"], "member", ws.owner_name),
                ("workspace.updated", ws.id, "member", ws.owner_name), ("token.issued", agent.id, "member", ws.owner_name),
                ("member.invited", invite["id"], "member", admin.name), ("scene.created", sc.id, "member", ws.owner_name)]
    for reader in (admin.api, ws.owner):
        entries = audit(reader)
        stamps = [parse_iso(e["at"]) for e in entries]
        assert stamps == sorted(stamps, reverse=True)
        positions = []
        for action, target, kind, actor in expected:
            hits = [i for i, e in enumerate(entries) if e["action"] == action and e["target"]["id"] == target]
            assert len(hits) == 1, (action, hits)
            entry = entries[hits[0]]
            assert entry["actor"]["kind"] == kind and entry["actor"]["name"] == actor
            positions.append(hits[0])
        for newer, older in zip(positions, positions[1:]):
            newer_first(entries, newer, older)
    assert len(admin.api.ok("GET", "/api/audit?limit=2")["entries"]) <= 2


def test_dashboard_totals(browser: Browser, app_url: str) -> None:
    ws, other = Ws(app_url), Ws(app_url)
    before = dashboard(ws.owner)
    assert before["seatsPurchased"] == TRIAL_SEATS and before["subscription"]["state"] == "trial"
    new_scene(ws.owner, ())
    new_scene(ws.owner, ())
    ws.invite(fresh("dash")[1], "viewer")
    agent = ws.token("read")
    after = dashboard(ws.owner)
    assert after["scenes"] == before["scenes"] + 2 and after["seatsUsed"] == before["seatsUsed"] + 1
    assert after["activeAgentTokens"] == before["activeAgentTokens"] + 1 and after["publishedScenes"] == before["publishedScenes"]
    new_scene(other.owner, ())
    other.invite(fresh("dash")[1], "viewer")
    other.token("read")
    assert dashboard(ws.owner) == after
    with app_page(browser, app_url, app_path(), ws.owner) as pg:
        expect(pg.get_by_role("region", name="Seats")).to_contain_text(f"{after['seatsUsed']} of {after['seatsPurchased']} seats used", timeout=UI_MS)
        expect(pg.get_by_role("region", name="Scenes")).to_contain_text(f"{after['scenes']} scenes, {after['publishedScenes']} published")
        expect(pg.get_by_role("region", name="Agent tokens")).to_contain_text(f"{after['activeAgentTokens']} active agent tokens")
    ws.owner.ok("DELETE", f"/api/agent-tokens/{agent.id}", status=204)
    assert dashboard(ws.owner)["activeAgentTokens"] == before["activeAgentTokens"]


TOKEN_RE = re.compile(r"^orr_[A-Za-z0-9]{40,}$")


def test_agent_token_lifecycle(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    agent = ws.token("read")
    assert TOKEN_RE.match(agent.secret) and agent.body["status"] == "active"
    assert agent.body["issuedBy"]["kind"] == "member"
    listing = ws.owner.call("GET", "/api/agent-tokens")
    assert agent.secret not in listing.text
    assert agent.api.ok("GET", "/api/me")["agent"]["id"] == agent.id
    ws.owner.ok("DELETE", f"/api/agent-tokens/{agent.id}", status=204)
    assert agent.api.call("GET", "/api/me").status_code == 401
    again = ws.owner.call("DELETE", f"/api/agent-tokens/{agent.id}")
    assert again.status_code == 409 and again.json() == {"error": "invalid_transition", "from": "revoked", "to": "revoked"}
    now = ws.owner.now()
    for seconds in (TOKEN_MIN_S - 5, TOKEN_MAX_DAYS * DAY_S + DAY_S):
        r = ws.owner.call("POST", "/api/agent-tokens", {"name": "Bad", "scope": "read", "expiresAt": iso(now + timedelta(seconds=seconds))})
        assert r.status_code == 422 and "expiresAt" in r.json()["errors"]
    r = ws.owner.call("POST", "/api/agent-tokens", {"name": "n" * (TOKEN_NAME_MAX + 1), "scope": "read", "expiresAt": iso(now + timedelta(days=1))})
    assert r.status_code == 422
    short = ws.token("read", seconds=SHORT_TTL_S)
    expires = parse_iso(short.body["expiresAt"])
    warning = find_mail(mail, to=ws.owner_email, subject=f"Agent token {short.name} expires soon")
    assert warning and all(local(expires, BERLIN) in text(m) for m in warning)

    def expired() -> bool:
        r = short.api.call("GET", "/api/me")
        at = server_time(r)
        if at + timedelta(seconds=CLOCK_SKEW_S) <= expires:
            assert r.status_code == 200, f"rejected early at {at}"
        if at >= expires:
            assert r.status_code == 401, f"accepted at {at}"
        return r.status_code == 401
    poll(expired, SHORT_TTL_S + WAIT_S, "token expiry")
    assert [t["status"] for t in ws.owner.ok("GET", "/api/agent-tokens")["tokens"] if t["id"] == short.id] == ["expired"]
    for _ in range(TEAM_TOKEN_LIMIT):
        ws.token("read")
    r = ws.owner.call("POST", "/api/agent-tokens", {"name": "Sixth", "scope": "read", "expiresAt": iso(ws.owner.now() + timedelta(days=1))})
    assert r.status_code == 409 and r.json() == {"error": "token_limit_reached"}


def test_wf_agent_access_issue_revoke_ui(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    admin = ws.join(mail, "admin")
    name = f"Poser {tag()}"
    with app_page(browser, app_url, app_path("agents"), admin.api) as pg:
        pg.get_by_role("button", name="Issue token").first.click()
        dialog = pg.get_by_role("dialog", name="Issue agent token")
        fill(dialog.get_by_role("textbox", name="Token name"), name)
        dialog.get_by_role("radiogroup", name="Scope").get_by_role("radio", name="Edit").check()
        fill(dialog.get_by_role("textbox", name="Expires"), "tomorrow")
        dialog.get_by_role("button", name="Issue token").click()
        expect(dialog.get_by_text("Use YYYY-MM-DD HH:mm:ss.")).to_be_visible(timeout=UI_MS)
        assert name not in [t["name"] for t in ws.owner.ok("GET", "/api/agent-tokens")["tokens"]]
        expires = ws.owner.now() + timedelta(days=2)
        fill(dialog.get_by_role("textbox", name="Expires"), local(expires, BERLIN)[:19])
        dialog.get_by_role("button", name="Issue token").click()
        box = pg.get_by_role("region", name="New token")
        expect(box).to_contain_text("Copy this token now. It will not be shown again.", timeout=UI_MS)
        shown = box.evaluate("e => [e.innerText, ...Array.from(e.querySelectorAll('input, textarea'), i => i.value)].join(' ')")
        secret = re.search(r"orr_[A-Za-z0-9]{40,}", shown).group(0)
        expect(pg.get_by_role("status", name="Members status")).to_contain_text(f"Token {name} issued.")
        me = Api(app_url, bearer=secret).ok("GET", "/api/me")
        assert me["agent"]["name"] == name and me["agent"]["scope"] == "edit"
        token = next(t for t in ws.owner.ok("GET", "/api/agent-tokens")["tokens"] if t["name"] == name)
        assert token["expiresAt"] == iso(expires)
        pg.reload()
        expect(pg.get_by_role("table", name="Agent tokens")).to_contain_text(name, timeout=UI_MS)
        assert secret not in pg.content()
        pg.get_by_role("button", name=f"Revoke {name}").click()
        expect(pg.get_by_role("status", name="Members status")).to_contain_text(f"Token {name} revoked.", timeout=UI_MS)
    assert Api(app_url, bearer=secret).call("GET", "/api/me").status_code == 401


def test_agent_scope_limits(app_url: str, mail: Any, killbill: Any) -> None:
    ws, paid = active_ws(app_url)
    edit, read = ws.token("edit"), ws.token("read")
    sc = new_scene(ws.owner, release_locks=True)
    cup = sc.ids["Cup"]
    version = ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Scope"}, 201)
    member_id = ws.owner_member["id"]
    result = apply(edit.api, sc.id, move(cup, position=[1, 0, 0]))
    assert ops_of(ws.owner, sc.id)[-1]["author"] == {"kind": "agent", "id": ops_of(ws.owner, sc.id)[-1]["author"]["id"], "name": edit.name}
    assert graph_at(edit.api, sc.id, result["latestSeq"])["hash"] == result["hash"]
    vid, pid, iid = version["id"], paid["payment"]["id"], paid["invoice"]["id"]
    forbidden = [("POST", "/api/scenes", {"name": "x"}), ("POST", f"/api/scenes/{sc.id}/versions", {"label": "x"}),
                 ("POST", f"/api/versions/{vid}/submit", _NO), ("POST", f"/api/versions/{vid}/approve", _NO),
                 ("POST", f"/api/versions/{vid}/schedule", {"publishAt": iso(ws.owner.now() + timedelta(days=1))}),
                 ("POST", f"/api/versions/{vid}/unschedule", _NO), ("POST", f"/api/versions/{vid}/withdraw", _NO),
                 ("POST", f"/api/versions/{vid}/exports", _NO), ("POST", f"/api/versions/{vid}/review-links", {"expiresAt": iso(ws.owner.now() + timedelta(days=1))}),
                 ("POST", "/api/billing/checkout", {"plan": "business", "period": "annual", "extraSeats": 1, "card": CARD}),
                 ("POST", "/api/billing/plan", {"plan": "business", "period": "monthly"}), ("POST", "/api/billing/seats", {"extraSeats": 3}),
                 ("POST", f"/api/billing/payments/{pid}/refund", {}), ("POST", f"/api/billing/invoices/{iid}/pay", {"card": CARD}),
                 ("POST", "/api/billing/cancel", _NO), ("GET", "/api/billing", _NO), ("GET", "/api/billing/gateway", _NO),
                 ("POST", "/api/agent-tokens", {"name": "Child", "scope": "edit", "expiresAt": iso(ws.owner.now() + timedelta(days=1))}),
                 ("DELETE", f"/api/agent-tokens/{read.id}", _NO), ("POST", "/api/members/invites", {"email": fresh("a")[1], "role": "viewer"}),
                 ("DELETE", f"/api/members/{member_id}", _NO), ("GET", "/api/audit", _NO), ("GET", "/api/dashboard", _NO),
                 ("GET", "/api/members", _NO), ("GET", f"/api/scenes/{sc.id}/mentionable?q=", _NO),
                 ("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": cup, "body": "hi", "mentions": []}),
                 ("PATCH", "/api/workspace", {"name": "Agent owned"})]
    shaped = Api(app_url, bearer=edit.secret, session=ws.owner.session)
    for method, path, body in forbidden:
        key = idempotency_key() if path.startswith("/api/billing") and method == "POST" else None
        for client in (edit.api, shaped):
            r = client.call(method, path, body, key=key, headers={"X-Role": "owner"})
            assert r.status_code == 403 and r.json() == {"error": "forbidden"}, (method, path, r.text)
    r = edit.api.call("POST", "/api/billing/seats", {"extraSeats": 3, "scope": "admin", "role": "owner", "memberId": member_id}, key=idempotency_key())
    assert r.status_code == 403
    for kind in ("version.publish", "billing.seats.set"):
        r = edit.api.call("POST", f"/api/scenes/{sc.id}/ops", {"ops": [op(kind, {"id": cup})]})
        assert r.status_code == 422 and r.json() == {"errors": {"ops[0].type": "Unknown operation"}}
    for method, path, body in (("POST", f"/api/scenes/{sc.id}/ops", {"ops": [move(cup, position=[2, 0, 0])]}),
                               ("POST", f"/api/scenes/{sc.id}/locks", {"nodeId": cup}), ("POST", f"/api/scenes/{sc.id}/undo", _NO)):
        r = read.api.call(method, path, body)
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    assert read.api.call("GET", f"/api/scenes/{sc.id}/graph?at=0").status_code == 200
    fern = Api(app_url, bearer=FERNHALL_POSER)
    foreign_404(fern.call("GET", f"/api/scenes/{sc.id}"))
    foreign_404(fern.call("POST", f"/api/scenes/{sc.id}/ops", {"ops": [move(cup, position=[3, 0, 0])]}))
    foreign_404(edit.api.call("GET", f"/api/scenes/{SEED_SCENE}"))
    assert [v["id"] for v in versions_of(ws.owner, sc.id)] == [vid]
    assert len(kb_payments(killbill, ws.id)) == 1
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["seatsPurchased"] == TEAM_SEATS
    assert len(ws.owner.ok("GET", "/api/agent-tokens")["tokens"]) == 2


def test_wf_agent_access_batch_session(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, release_locks=True)
    cup = sc.ids["Cup"]
    agent = ws.token("edit")
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        expect(pg.get_by_role("tree", name="Scene hierarchy")).to_be_visible(timeout=UI_MS)
        assert agent.api.ok("GET", f"/api/scenes/{sc.id}")["graph"]["nodes"]
        r = agent.api.call("POST", f"/api/scenes/{sc.id}/presence", {"selection": cup, "cursor": [0.5, 0.5]})
        assert r.status_code == 204
        result = apply(agent.api, sc.id, move(cup, position=[1, 0, 0]),
                       op("camera.view.set", {"name": HERO, "position": [0, 1, 5], "target": [0, 0, 0], "fov": 40}))
        poll(lambda: (pg.evaluate(TICK_JS, {"seq": result["lastSeq"]}) or {}).get("kind") == "agent", RT_MS / 1000, "agent tick")
        expect(viewport(pg)).to_have_attribute("data-graph-hash", result["hash"], timeout=RT_MS)
        expect(pg.get_by_role("listbox", name="Camera views").get_by_role("option", name=HERO)).to_have_count(1, timeout=RT_MS)
        expect(pg.get_by_role("list", name="People in this scene")).to_contain_text(f"{agent.name} (agent) · {CUP}", timeout=RT_MS)
    tail = ops_of(ws.owner, sc.id)[-2:]
    assert [o["type"] for o in tail] == ["transform.set", "camera.view.set"]
    assert all(o["author"]["kind"] == "agent" and o["author"]["name"] == agent.name for o in tail)


def test_scene_library_and_search(app_url: str) -> None:
    mine, theirs = Ws(app_url), Ws(app_url)
    t = tag()
    created = mine.owner.ok("POST", "/api/scenes", {"name": f"Search {t} A"}, 201)
    assert created["latestSeq"] == 0 and created["name"] == f"Search {t} A"
    foreign = theirs.owner.ok("POST", "/api/scenes", {"name": f"Search {t} B"}, 201)
    asset = upload(mine.owner, "model", f"Model-{t}.glb", glb()).json()
    other_asset = upload(theirs.owner, "model", f"Model-{t}.glb", glb()).json()
    listed = {s["id"]: s for s in mine.owner.ok("GET", "/api/scenes")["scenes"]}
    assert listed[created["id"]]["publishedVersion"] is None and listed[created["id"]]["latestSeq"] == 0
    assert foreign["id"] not in listed
    result = mine.owner.ok("GET", f"/api/search?q={t.upper()}")
    assert [s["id"] for s in result["scenes"]] == [created["id"]]
    assert [a["id"] for a in result["assets"]] == [asset["id"]]
    assets = [a["id"] for a in mine.owner.ok("GET", "/api/assets")["assets"]]
    assert asset["id"] in assets and other_asset["id"] not in assets
    assert mine.owner.call("GET", "/api/search?q=a").status_code == 422
    assert mine.owner.call("POST", "/api/scenes", {"name": "n" * (NAME_MAX + 1)}).status_code == 422


def test_wf_scene_authoring_new_scene_search(browser: Browser, app_url: str) -> None:
    ws, other = Ws(app_url), Ws(app_url)
    t = tag()
    local_name, foreign_name = f"{LOCAL_PREFIX} {t}", f"{FOREIGN_PREFIX} {t}"
    other.owner.ok("POST", "/api/scenes", {"name": foreign_name}, 201)
    with app_page(browser, app_url, app_path("scenes"), ws.owner) as pg:
        pg.get_by_role("button", name="New scene").click()
        dialog = pg.get_by_role("dialog", name="New scene")
        fill(dialog.get_by_role("textbox", name="Scene name"), local_name)
        dialog.get_by_role("button", name="Create scene").click()
        poll(lambda: local_name in [s["name"] for s in ws.owner.ok("GET", "/api/scenes")["scenes"]], UI_MS / 1000, "scene created")
        pg.goto(app_url + app_path("scenes"))
        fill(pg.get_by_role("searchbox", name="Search scenes"), t)
        results = pg.get_by_role("list", name="Search results")
        expect(results.get_by_role("link", name=local_name)).to_be_visible(timeout=UI_MS)
        expect(results.get_by_role("link", name=foreign_name)).to_have_count(0)


def test_op_inverses_roundtrip(app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Alpha", "Bravo", "Gone"))
    a, b, gone = sc.ids["Alpha"], sc.ids["Bravo"], sc.ids["Gone"]
    layer = {"id": "l_base", "type": "base", "color": [0.2, 0.2, 0.2], "roughness": 0.5, "metalness": 0.1}
    setup = apply(ws.owner, sc.id, op("material.layer.add", {"id": a, "layer": layer}), op("state.add", {"state": {"id": "st_up", "name": "Up"}}),
                  op("material.layer.add", {"id": gone, "layer": dict(layer, id="l_gone")}),
                  op("state.override.set", {"stateId": "st_up", "nodeId": gone, "field": "visible", "value": False}))
    assert setup["lastSeq"] - setup["firstSeq"] == 3
    batch_ops = ops_of(ws.owner, sc.id)[-4:]
    assert len({o["batchId"] for o in batch_ops}) == 1 and [o["seq"] for o in batch_ops] == list(range(setup["firstSeq"], setup["lastSeq"] + 1))
    cases = [op("node.add", {"node": mesh(nid(), "Extra", sc.root)}), op("node.rename", {"id": a, "name": "Renamed"}),
             op("node.reparent", {"id": a, "parentId": b}), move(a, position=[1, 2, 3], rotation=[0, 45, 0]),
             op("material.layer.add", {"id": a, "layer": dict(layer, id="l_coat", type="clearcoat")}),
             op("material.layer.set", {"id": a, "layerId": "l_base", "color": [0.5, 0.5, 0.5], "roughness": 0.9}),
             op("material.layer.remove", {"id": a, "layerId": "l_base"}),
             op("state.override.set", {"stateId": "st_up", "nodeId": a, "field": "position", "value": [0, 1, 0]}),
             op("transition.set", {"from": "rest", "to": "st_up", "trigger": "hover", "durationMs": 300}),
             op("camera.view.set", {"name": "Wide", "position": [0, 2, 8], "target": [0, 0, 0], "fov": 50}),
             op("node.remove", {"id": gone})]
    inverse_kind = {"node.add": "node.remove", "node.remove": "node.add",
                    "material.layer.add": "material.layer.remove", "material.layer.remove": "material.layer.add"}
    for case in cases:
        before = scene_of(ws.owner, sc.id)
        forward = apply(ws.owner, sc.id, case)
        assert forward["hash"] != before["hash"], case["type"]
        stored = ops_of(ws.owner, sc.id)[-1]
        assert stored["type"] == case["type"] and stored["inverse"]["type"] == inverse_kind.get(case["type"], case["type"])
        back = apply(ws.owner, sc.id, {"type": stored["inverse"]["type"], "payload": stored["inverse"]["payload"]})
        assert back["hash"] == before["hash"], case["type"]
        assert graph_hash(scene_of(ws.owner, sc.id)["graph"]) == before["hash"]


def test_op_validation_atomic(app_url: str) -> None:
    ws, other = Ws(app_url), Ws(app_url)
    sc = new_scene(ws.owner, ("Alpha", "Bravo"))
    a, b = sc.ids["Alpha"], sc.ids["Bravo"]
    apply(ws.owner, sc.id, op("node.reparent", {"id": b, "parentId": a}), op("state.add", {"state": {"id": "st_up", "name": "Up"}}))
    accepted = [move(a, position=[POSITION_MAX, -POSITION_MAX, 0]), move(a, rotation=[ROTATION_MAX, -ROTATION_MAX, 0]),
                move(a, scale=[SCALE_MIN, POSITION_MAX, 1]),
                op("camera.view.set", {"name": "Lo", "position": [0, 0, 5], "target": [0, 0, 0], "fov": FOV_MIN}),
                op("camera.view.set", {"name": "Hi", "position": [0, 0, 5], "target": [0, 0, 0], "fov": FOV_MAX}),
                op("transition.set", {"from": "rest", "to": "st_up", "trigger": "click", "durationMs": 0}),
                op("transition.set", {"from": "rest", "to": "st_up", "trigger": "scroll", "durationMs": DURATION_MAX_MS})]
    for case in accepted:
        apply(ws.owner, sc.id, case)
    layer = {"id": "l0", "type": "base", "color": [0, 0, 0], "roughness": 0, "metalness": 1}
    apply(ws.owner, sc.id, *[op("material.layer.add", {"id": b, "layer": dict(layer, id=f"l{i}")}) for i in range(MAX_LAYERS)])
    model = upload(other.owner, "model", "chair.glb", glb()).json()
    rejected = [
        [move(a, position=[1, 0, 0]), move(a, position=[2, 0, 0]), move(a, position=[POSITION_MAX + 1, 0, 0])],
        [move(a, rotation=[ROTATION_MAX + 1, 0, 0])], [move(a, scale=[0, 1, 1])], [op("transform.set", {"id": a})],
        [op("camera.view.set", {"name": "Bad", "position": [0, 0, 5], "target": [0, 0, 0], "fov": FOV_MIN - 1})],
        [op("camera.view.set", {"name": "Bad", "position": [0, 0, 5], "target": [0, 0, 0], "fov": FOV_MAX + 1})],
        [op("transition.set", {"from": "rest", "to": "st_up", "trigger": "hover", "durationMs": DURATION_MAX_MS + 1})],
        [op("transition.set", {"from": "st_up", "to": "st_up", "trigger": "hover", "durationMs": 1})],
        [op("state.add", {"state": {"id": "rest", "name": "Again"}})],
        [op("state.override.set", {"stateId": "rest", "nodeId": a, "field": "visible", "value": False})],
        [op("node.remove", {"id": sc.root})], [op("node.remove", {"id": a})],
        [op("node.reparent", {"id": a, "parentId": b})], [op("node.add", {"node": mesh(a, "Dup", sc.root)})],
        [op("node.add", {"node": mesh("Bad ID!", "Bad", sc.root)})],
        [op("material.layer.add", {"id": b, "layer": dict(layer, id="l_over")})],
        [op("material.layer.set", {"id": b, "layerId": "l_missing", "roughness": 0.5})],
        [move(a, position=[1, 0, 0])] * (MAX_BATCH + 1), [],
    ]
    for batch in rejected:
        before = scene_of(ws.owner, sc.id)
        r = ws.owner.call("POST", f"/api/scenes/{sc.id}/ops", {"ops": batch})
        assert r.status_code == 422 and "errors" in r.json(), (batch[:1], r.text)
        after = scene_of(ws.owner, sc.id)
        assert after["latestSeq"] == before["latestSeq"] and after["hash"] == before["hash"]
    r = ws.owner.call("POST", f"/api/scenes/{sc.id}/ops", {"ops": rejected[0]})
    assert "ops[2].payload.position" in r.json()["errors"]
    r = ws.owner.call("POST", f"/api/scenes/{sc.id}/ops", {"ops": [op("node.spin", {"id": a})]})
    assert r.json() == {"errors": {"ops[0].type": "Unknown operation"}}
    for asset_id in (model["id"], "asset_missing_probe"):
        r = ws.owner.call("POST", f"/api/scenes/{sc.id}/ops", {"ops": [op("node.add", {"node": mesh(nid(), "Chair", sc.root, assetId=asset_id)})]})
        foreign_404(r)


def test_states_transitions_camera_views(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, (BODY,), release_locks=True, big=True)
    body = sc.ids[BODY]
    agent = ws.token("edit")
    apply(agent.api, sc.id, op("state.add", {"state": {"id": LIFT_ID, "name": LIFTED}}),
          op("state.override.set", {"stateId": LIFT_ID, "nodeId": body, "field": "position", "value": [0, 2, 0]}),
          op("transition.set", {"from": "rest", "to": LIFT_ID, "trigger": "hover", "durationMs": 300}),
          op("transition.set", {"from": "rest", "to": LIFT_ID, "trigger": "click", "durationMs": 200}),
          op("transition.set", {"from": "rest", "to": LIFT_ID, "trigger": "scroll", "durationMs": 500}),
          op("camera.view.set", {"name": FRONT, "position": [0, 1, 6], "target": [0, 0, 0], "fov": 45}))
    release(agent.api, sc.id, body)
    lift_state = lambda graph: next(s for s in graph["states"] if s["id"] == LIFT_ID)
    g = scene_of(ws.owner, sc.id)["graph"]
    rest = next(s for s in g["states"] if s["id"] == "rest")
    assert rest["name"] == "Rest" and rest["overrides"] == []
    assert lift_state(g)["overrides"] == [{"nodeId": body, "field": "position", "value": [0, 2, 0]}]
    assert sorted(t["trigger"] for t in g["transitions"]) == ["click", "hover", "scroll"]
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner, live=False) as pg:
        until(pg, READY_JS, None, UI_MS / 1000)
        expect(pg.get_by_role("listbox", name="Camera views").get_by_role("option", name=FRONT)).to_have_count(1, timeout=UI_MS)
        states = pg.get_by_role("listbox", name="States")
        expect(states.get_by_role("option").first).to_have_text(re.compile("Rest"))
        advance(pg, 1000)
        rest_pixels = decode(capture(viewport(pg)))
        states.get_by_role("option", name=LIFTED).click()
        advance(pg, 1000)
        lifted_pixels = decode(capture(viewport(pg)))
        assert difference(rest_pixels, lifted_pixels) > 0
        pg.get_by_role("treeitem", name=BODY).click()
        advance(pg, 500)
        commit(inspector(pg, "Position Y"), "3")
        poll(lambda: lift_state(scene_of(ws.owner, sc.id)["graph"])["overrides"]
             == [{"nodeId": body, "field": "position", "value": [0, 3, 0]}], UI_MS / 1000, "override written")
        assert node_in(scene_of(ws.owner, sc.id)["graph"], body)["position"] == [0, 0, 0]
        states.get_by_role("option", name="Rest").click()
        advance(pg, 1000)
        assert difference(lifted_pixels, decode(capture(viewport(pg)))) > 0
    release(ws.owner, sc.id, body)
    apply(agent.api, sc.id, op("transition.set", {"from": "rest", "to": LIFT_ID, "trigger": "hover", "durationMs": 600}),
          op("transition.set", {"from": "rest", "to": LIFT_ID, "trigger": "click", "durationMs": None}),
          op("camera.view.set", {"name": FRONT, "position": [0, 1, 7], "target": [0, 0, 0], "fov": 60}),
          op("camera.view.set", {"name": SIDE, "position": None, "target": [0, 0, 0], "fov": 60}),
          op("state.override.set", {"stateId": LIFT_ID, "nodeId": body, "field": "position", "value": None}))
    g = scene_of(ws.owner, sc.id)["graph"]
    hover = [t for t in g["transitions"] if t["trigger"] == "hover"]
    assert len(hover) == 1 and hover[0]["durationMs"] == 600 and not [t for t in g["transitions"] if t["trigger"] == "click"]
    assert [(c["name"], c["fov"]) for c in g["cameraViews"]] == [(FRONT, 60)]
    assert lift_state(g)["overrides"] == []
    apply(agent.api, sc.id, op("camera.view.set", {"name": FRONT, "position": None, "target": [0, 0, 0], "fov": 60}))
    assert scene_of(ws.owner, sc.id)["graph"]["cameraViews"] == []


def test_wf_scene_authoring_build(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, (CUP,), big=True)
    cup = sc.ids[CUP]
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        tree = pg.get_by_role("tree", name="Scene hierarchy")
        expect(tree).to_be_visible(timeout=UI_MS)
        boxes = [x.bounding_box() for x in (tree, viewport(pg), pg.get_by_role("region", name="Inspector"))]
        assert boxes[0]["x"] < boxes[1]["x"] < boxes[2]["x"]
        assert pg.get_by_role("slider", name="Operation log").bounding_box()["y"] >= boxes[1]["y"] + boxes[1]["height"] - 1
        tick_total = scene_of(ws.owner, sc.id)["latestSeq"]
        poll(lambda: pg.evaluate(TICK_COUNT_JS) == tick_total, UI_MS / 1000, "initial ticks")
        before = decode(capture(viewport(pg)))
        tree.get_by_role("treeitem", name=CUP).click()
        expect(tree.get_by_role("treeitem", name=CUP)).to_have_attribute("aria-selected", "true")
        commit(inspector(pg, "Position X"), "1.5")
        poll(lambda: node_in(scene_of(ws.owner, sc.id)["graph"], cup)["position"][0] == 1.5, UI_MS / 1000, "transform saved")
        state = scene_of(ws.owner, sc.id)
        expect(viewport(pg)).to_have_attribute("data-graph-hash", state["hash"], timeout=UI_MS)
        poll(lambda: pg.evaluate(TICK_COUNT_JS) == state["latestSeq"], UI_MS / 1000, "transform tick")
        assert difference(before, decode(capture(viewport(pg)))) > 0
        pg.get_by_role("button", name="Add material layer").click()
        pg.get_by_role("menu", name="Layer type").get_by_role("menuitem", name="Clearcoat").click()
        expect(pg.get_by_role("list", name="Material layers")).to_contain_text(re.compile("clearcoat", re.I), timeout=UI_MS)
        poll(lambda: [layer["type"] for layer in node_in(scene_of(ws.owner, sc.id)["graph"], cup)["materialLayers"]] == ["clearcoat"],
             UI_MS / 1000, "layer saved")
        state = scene_of(ws.owner, sc.id)
        poll(lambda: pg.evaluate(TICK_COUNT_JS) == state["latestSeq"], UI_MS / 1000, "layer tick")
        expect(viewport(pg)).to_have_attribute("data-op-seq", str(state["latestSeq"]))
    tail = ops_of(ws.owner, sc.id)[-2:]
    assert [o["type"] for o in tail] == ["transform.set", "material.layer.add"]
    assert all(o["author"]["kind"] == "member" for o in tail)


def _is_active(loc: Locator) -> bool:
    return loc.evaluate("(el) => el === document.activeElement || (!!el.id && document.activeElement"
                        " && document.activeElement.getAttribute('aria-activedescendant') === el.id)")


def test_keyboard_editing(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Alpha", BRAVO))
    bravo = sc.ids[BRAVO]
    pos = lambda: node_in(scene_of(ws.owner, sc.id)["graph"], bravo)

    def saved(field: str, index: int, want: float) -> None:
        poll(lambda: r4(pos()[field][index]) == r4(want), UI_MS / 1000, f"{field} {want}")
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        tree = pg.get_by_role("tree", name="Scene hierarchy")
        expect(tree.get_by_role("treeitem", name=BRAVO)).to_be_visible(timeout=UI_MS)
        focus_tree(tree)
        pg.keyboard.press("End")
        assert _is_active(tree.get_by_role("treeitem").last)
        pg.keyboard.press("Home")
        assert _is_active(tree.get_by_role("treeitem").first)
        pg.keyboard.type(BRAVO[0])
        poll(lambda: _is_active(tree.get_by_role("treeitem", name=BRAVO)), UI_MS / 1000, "type-ahead")
        pg.keyboard.press("Enter")
        expect(tree.get_by_role("treeitem", name=BRAVO)).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        poll(lambda: [lk["nodeId"] for lk in locks_of(ws.owner, sc.id) if lk["nodeId"] == bravo], UI_MS / 1000, "lock on select")
        steps = [("Position X", "position", 0, "ArrowUp", 0.1), ("Position X", "position", 0, "Shift+ArrowUp", 1.1),
                 ("Rotation X", "rotation", 0, "ArrowUp", 1), ("Rotation X", "rotation", 0, "Shift+ArrowUp", 16),
                 ("Scale X", "scale", 0, "ArrowUp", 1.01), ("Scale X", "scale", 0, "Shift+ArrowUp", 1.11)]
        for label, field, index, key, want in steps:
            inspector(pg, label).focus()
            pg.keyboard.press(key)
            saved(field, index, want)
        py = inspector(pg, "Position Y")
        commit(py, "2.5")
        saved("position", 1, 2.5)
        fill(py, "9")
        py.press("Escape")
        poll(lambda: num(py) == 2.5, UI_MS / 1000, "escape restores")
        assert pos()["position"][1] == 2.5
        add = pg.get_by_role("button", name="Add material layer")
        add.focus()
        pg.keyboard.press("Enter")
        menu = pg.get_by_role("menu", name="Layer type")
        expect(menu).to_be_visible(timeout=UI_MS)
        for _ in range(4):
            if _is_active(menu.get_by_role("menuitem", name="Clearcoat")):
                break
            pg.keyboard.press("ArrowDown")
        assert _is_active(menu.get_by_role("menuitem", name="Clearcoat"))
        pg.keyboard.press("Enter")
        poll(lambda: [x["type"] for x in pos()["materialLayers"]] == ["clearcoat"], UI_MS / 1000, "layer added")
        assert pg.get_by_role("list", name="Material layers").evaluate("(el) => el.contains(document.activeElement)")
        add.focus()
        pg.keyboard.press("Enter")
        expect(menu).to_be_visible(timeout=UI_MS)
        pg.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(add).to_be_focused()
        tree.get_by_role("treeitem", name=BRAVO).focus()
        pg.keyboard.press("Control+z")
        poll(lambda: ops_of(ws.owner, sc.id)[-1]["undoOf"] is not None and not pos()["materialLayers"], UI_MS / 1000, "undo")
        pg.keyboard.press("Control+Shift+z")
        poll(lambda: ops_of(ws.owner, sc.id)[-1]["redoOf"] is not None and pos()["materialLayers"], UI_MS / 1000, "redo")
        add_state = pg.get_by_role("button", name="Add state")
        add_state.focus()
        pg.keyboard.press("Enter")
        dialog = pg.get_by_role("dialog", name="Add state")
        expect(dialog).to_be_visible(timeout=UI_MS)
        for _ in range(6):
            pg.keyboard.press("Tab")
            assert dialog.evaluate("(el) => el.contains(document.activeElement)")
        pg.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(add_state).to_be_focused()
        pg.keyboard.press("Enter")
        dialog.get_by_role("textbox", name="State name").focus()
        pg.keyboard.type(RAISED)
        pg.keyboard.press("Enter")
        poll(lambda: RAISED in [s["name"] for s in scene_of(ws.owner, sc.id)["graph"]["states"]], UI_MS / 1000, "state added")
        expect(pg.get_by_role("listbox", name="States").get_by_role("option", name=RAISED)).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        latest = scene_of(ws.owner, sc.id)["latestSeq"]
        slider = pg.get_by_role("slider", name="Operation log")
        slider_is(slider, "max", latest)
        slider_is(slider, "min", 0)
        slider.focus()
        pg.keyboard.press("Home")
        slider_is(slider, "now", 0)
        pg.keyboard.press("ArrowRight")
        slider_is(slider, "now", 1)
        pg.keyboard.press("Shift+ArrowRight")
        slider_is(slider, "now", min(11, latest))
        pg.keyboard.press("End")
        slider_is(slider, "now", latest)


def _race(sid: str, node_id: str, claimants: list[tuple[str, Api, str]]) -> list[tuple[str, httpx.Response]]:
    barrier = threading.Barrier(len(claimants))

    def go(claimant: tuple[str, Api, str]) -> tuple[str, httpx.Response]:
        who, api, kind = claimant
        barrier.wait()
        if kind == "lock":
            return who, api.call("POST", f"/api/scenes/{sid}/locks", {"nodeId": node_id})
        return who, api.call("POST", f"/api/scenes/{sid}/ops", {"ops": [move(node_id, position=[1, 0, 0])]})
    with ThreadPoolExecutor(len(claimants)) as pool:
        return list(pool.map(go, claimants))


def test_lock_single_winner(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    editor = ws.join(mail, "editor")
    agent = ws.token("edit")
    sc = new_scene(ws.owner, ("One", "Two", "Three"), release_locks=True)
    apis = {ws.owner_name: ws.owner, editor.name: editor.api, agent.name: agent.api}
    for node_name, kinds in (("One", ("lock", "ops", "lock")), ("Two", ("ops", "lock", "ops"))):
        node_id = sc.ids[node_name]
        results = _race(sc.id, node_id, [(who, api, kind) for (who, api), kind in zip(apis.items(), kinds)])
        winners = [who for who, r in results if r.status_code in (200, 201)]
        assert len(winners) == 1, [(w, r.status_code, r.text) for w, r in results]
        winner = winners[0]
        for who, r in results:
            if who != winner:
                assert r.status_code == 409 and r.json()["error"] == "locked" and r.json()["nodeId"] == node_id
                assert r.json()["holder"]["name"] == winner
        held_locks = [lk for lk in locks_of(ws.owner, sc.id) if lk["nodeId"] == node_id]
        assert len(held_locks) == 1 and held_locks[0]["holder"]["name"] == winner
        records = poll(lambda: PocketBase().records("object_locks", f'scene="{sc.id}" && node="{node_id}"'), RT_MS / 1000, "lock record")
        assert len(records) == 1 and records[0]["holderName"] == winner
    one, three = sc.ids["One"], sc.ids["Three"]
    holder = locks_of(ws.owner, sc.id)
    holder_name = next(lk["holder"]["name"] for lk in holder if lk["nodeId"] == one)
    loser_name, loser = next((n, a) for n, a in apis.items() if n != holder_name)
    before = scene_of(ws.owner, sc.id)
    r = loser.call("POST", f"/api/scenes/{sc.id}/ops", {"ops": [move(three, position=[5, 0, 0]), move(one, position=[9, 0, 0])]})
    assert r.status_code == 409 and r.json()["nodeId"] == one and r.json()["holder"]["name"] == holder_name
    after = scene_of(ws.owner, sc.id)
    assert after["latestSeq"] == before["latestSeq"] and after["hash"] == before["hash"]
    assert three not in [lk["nodeId"] for lk in locks_of(ws.owner, sc.id)]
    r = loser.call("DELETE", f"/api/scenes/{sc.id}/locks/{one}")
    assert r.status_code == 409 and r.json() == {"error": "not_lock_holder"}
    taken = loser.ok("POST", f"/api/scenes/{sc.id}/locks/{one}/takeover")
    assert taken["lock"]["holder"]["name"] == loser_name and taken["previousHolder"]["name"] == holder_name
    r = apis[holder_name].call("POST", f"/api/scenes/{sc.id}/ops", {"ops": [move(one, position=[7, 0, 0])]})
    assert r.status_code == 409 and r.json()["error"] == "locked"
    poll(lambda: [x["holderName"] for x in PocketBase().records("object_locks", f'scene="{sc.id}" && node="{one}"')] == [loser_name],
         RT_MS / 1000, "takeover record")


def test_wf_object_locks_presence(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    editor = ws.join(mail, "editor")
    agent = ws.token("edit")
    sc = new_scene(ws.owner, (CUP, LID), release_locks=True)
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as watcher, \
            app_page(browser, app_url, app_path("scenes", sc.id), editor.api) as actor:
        cup = watcher.get_by_role("treeitem", name=CUP)
        expect(cup).to_be_visible(timeout=UI_MS)
        actor.get_by_role("treeitem", name=CUP).click()
        people = watcher.get_by_role("list", name="People in this scene")
        expect(people).to_contain_text(f"{editor.name} · {CUP}", timeout=RT_MS)
        expect(cup).to_have_accessible_description(f"Locked by {editor.name}", timeout=RT_MS)
        agent.api.call("POST", f"/api/scenes/{sc.id}/presence", {"selection": sc.ids[LID], "cursor": [0.2, 0.3]})
        expect(people).to_contain_text(f"{agent.name} (agent) · {LID}", timeout=RT_MS)
        actor.get_by_role("treeitem", name=LID).click()
        expect(people).to_contain_text(f"{editor.name} · {LID}", timeout=RT_MS)
        expect(cup).not_to_have_accessible_description(f"Locked by {editor.name}", timeout=RT_MS)


def test_pending_rollback(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, (CUP, LID))
    cup = sc.ids[CUP]
    agent = ws.token("edit")
    with app_page(browser, app_url, None, ws.owner) as pg:
        with held(pg, "**/api/scenes/*/events**"):
            pg.goto(app_url + app_path("scenes", sc.id))
            px = inspector(pg, "Position X")
            pg.get_by_role("treeitem", name=LID).click()
            seq = scene_of(ws.owner, sc.id)["latestSeq"]
            commit(px, str(POSITION_MAX * 5))
            status = pg.get_by_role("status", name="Editor status")
            expect(status).to_contain_text("must be between", timeout=UI_MS)
            expect(status).to_contain_text("Position X")
            poll(lambda: num(px) == 0, UI_MS / 1000, "out-of-range rollback")
            pg.get_by_role("treeitem", name=CUP).click()
            with held(pg, "**/api/scenes/*/ops") as gate:
                commit(px, "4")
                expect(px).to_have_attribute("data-pending", "true", timeout=UI_MS)
                poll(lambda: any_visible(pg.get_by_role("region", name="Inspector").get_by_text("Pending")), UI_MS / 1000, "visible Pending tag")
                assert num(px) == 4
                gate.release()
            expect(px).not_to_have_attribute("data-pending", "true", timeout=UI_MS)
            poll(lambda: node_in(scene_of(ws.owner, sc.id)["graph"], cup)["position"][0] == 4, UI_MS / 1000, "accepted")
            agent.api.ok("POST", f"/api/scenes/{sc.id}/locks/{cup}/takeover")
            commit(px, "7")
            expect(status).to_contain_text(f"Change to {CUP} rolled back: {agent.name} is editing it.", timeout=UI_MS)
            poll(lambda: num(px) == 4, UI_MS / 1000, "conflict rollback")
            expect(pg.get_by_role("dialog", name="Object locked")).to_have_count(0)
    assert node_in(scene_of(ws.owner, sc.id)["graph"], cup)["position"][0] == 4
    assert scene_of(ws.owner, sc.id)["latestSeq"] == seq + 1


def test_wf_object_locks_takeover(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    editor = ws.join(mail, "editor")
    sc = new_scene(ws.owner, (CUP,), release_locks=True)
    cup = sc.ids[CUP]
    with app_page(browser, app_url, app_path("scenes", sc.id), editor.api) as holder, \
            app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as taker:
        holder.get_by_role("treeitem", name=CUP).click()
        node = taker.get_by_role("treeitem", name=CUP)
        expect(node).to_have_accessible_description(f"Locked by {editor.name}", timeout=RT_MS)
        node.click()
        px = inspector(taker, "Position X")
        commit(px, "2")
        dialog = taker.get_by_role("dialog", name="Object locked")
        expect(dialog).to_contain_text(f"{editor.name} is editing {CUP}.", timeout=UI_MS)
        expect(dialog.get_by_role("button", name="Cancel")).to_be_focused()
        taker.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(px).to_be_focused()
        poll(lambda: num(px) == 0, UI_MS / 1000, "value restored")
        assert node_in(scene_of(ws.owner, sc.id)["graph"], cup)["position"][0] == 0
        commit(px, "2")
        expect(dialog).to_be_visible(timeout=UI_MS)
        dialog.get_by_role("button", name="Take over").focus()
        taker.keyboard.press("Enter")
        expect(taker.get_by_role("status", name="Editor status")).to_contain_text(f"You now hold {CUP}.", timeout=UI_MS)
        poll(lambda: node_in(scene_of(ws.owner, sc.id)["graph"], cup)["position"][0] == 2, UI_MS / 1000, "change applied")
        assert [lk["holder"]["name"] for lk in locks_of(ws.owner, sc.id) if lk["nodeId"] == cup] == [ws.owner_name]
        expect(holder.get_by_role("status", name="Editor status")).to_contain_text(f"{ws.owner_name} took over {CUP}.", timeout=RT_MS)
    poll(lambda: [x["holderName"] for x in PocketBase().records("object_locks", f'scene="{sc.id}" && node="{cup}"')] == [ws.owner_name],
         RT_MS / 1000, "PocketBase holder")


def test_operation_log_attribution(app_url: str) -> None:
    seed = login(app_url, SEED_VIEWER).call("GET", f"/api/scenes/{SEED_SCENE}/ops")
    assert seed.status_code == 200 and "@" not in seed.text
    seeded = seed.json()["ops"]
    assert [o["seq"] for o in seeded[:SEED_LATEST]] == list(range(1, SEED_LATEST + 1))
    assert seeded[0]["author"]["name"] == "Jun Okafor" and seeded[0]["author"]["kind"] == "member"
    assert seeded[3]["author"] == {"kind": "agent", "id": seeded[3]["author"]["id"], "name": "Catalogue poser"}
    assert seeded[5]["author"]["name"] == "Sol Navarro" and all(o["inverse"] for o in seeded)
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",), release_locks=True)
    cup = sc.ids["Cup"]
    agent = ws.token("edit")
    first = ops_of(ws.owner, sc.id)
    before = ws.owner.now()
    r = ws.owner.call("POST", f"/api/scenes/{sc.id}/ops", {"ops": [{"type": "transform.set", "createdAt": "2001-01-01T00:00:00Z",
                                                                     "payload": {"id": cup, "position": [1, 0, 0]}}]})
    assert r.status_code == 201
    after = server_time(r) + timedelta(seconds=CLOCK_SKEW_S)
    release(ws.owner, sc.id, cup)
    apply(agent.api, sc.id, move(cup, position=[2, 0, 0]))
    log = ws.owner.call("GET", f"/api/scenes/{sc.id}/ops")
    ops = log.json()["ops"]
    assert [o["seq"] for o in ops] == list(range(1, len(ops) + 1)) and log.json()["latestSeq"] == len(ops)
    assert ws.owner_email not in log.text and "@" not in log.text
    member_op, agent_op = ops[-2], ops[-1]
    assert before <= parse_iso(member_op["createdAt"]) <= after
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", member_op["createdAt"])
    assert member_op["author"]["kind"] == "member" and member_op["author"]["name"] == ws.owner_name
    assert member_op["inverse"]["type"] == "transform.set" and member_op["inverse"]["payload"]["position"] == [0, 0, 0]
    assert agent_op["author"]["kind"] == "agent" and agent_op["author"]["name"] == agent.name
    assert agent_op["inverse"]["payload"]["position"] == [1, 0, 0]
    page = ws.owner.ok("GET", f"/api/scenes/{sc.id}/ops?after={len(first)}&limit=1")["ops"]
    assert [o["seq"] for o in page] == [len(first) + 1]
    agent.api.ok("POST", f"/api/scenes/{sc.id}/undo", status=201)
    assert ops_of(ws.owner, sc.id)[:len(ops)] == ops


def test_per_author_undo_redo(app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Pin", "Qubit", "Rod"))
    p, q, rod = sc.ids["Pin"], sc.ids["Qubit"], sc.ids["Rod"]
    release(ws.owner, sc.id, q)
    release(ws.owner, sc.id, rod)
    agent = ws.token("edit")
    g = lambda: scene_of(ws.owner, sc.id)["graph"]
    b1 = apply(ws.owner, sc.id, move(p, position=[1, 0, 0]))
    a1 = apply(agent.api, sc.id, move(q, position=[2, 0, 0]))
    b2 = apply(ws.owner, sc.id, move(p, position=[1, 1, 0]))
    undone = ws.owner.ok("POST", f"/api/scenes/{sc.id}/undo", status=201)
    assert ops_of(ws.owner, sc.id)[-1]["undoOf"] == b2["batchId"] and undone["latestSeq"] == b2["latestSeq"] + 1
    assert node_in(g(), p)["position"] == [1, 0, 0] and node_in(g(), q)["position"] == [2, 0, 0]
    ws.owner.ok("POST", f"/api/scenes/{sc.id}/undo", status=201)
    assert ops_of(ws.owner, sc.id)[-1]["undoOf"] == b1["batchId"] and node_in(g(), q)["position"] == [2, 0, 0]
    agent.api.ok("POST", f"/api/scenes/{sc.id}/undo", status=201)
    last = ops_of(ws.owner, sc.id)[-1]
    assert last["undoOf"] == a1["batchId"] and last["author"]["kind"] == "agent" and node_in(g(), q)["position"] == [0, 0, 0]
    r = agent.api.call("POST", f"/api/scenes/{sc.id}/undo")
    assert r.status_code == 409 and r.json() == {"error": "nothing_to_undo"}
    ws.owner.ok("POST", f"/api/scenes/{sc.id}/redo", status=201)
    assert ops_of(ws.owner, sc.id)[-1]["redoOf"] == b1["batchId"] and node_in(g(), p)["position"] == [1, 0, 0]
    apply(ws.owner, sc.id, move(p, scale=[2, 2, 2]))
    r = ws.owner.call("POST", f"/api/scenes/{sc.id}/redo")
    assert r.status_code == 409 and r.json() == {"error": "nothing_to_redo"}
    apply(agent.api, sc.id, move(rod, position=[3, 0, 0]))
    ws.owner.ok("POST", f"/api/scenes/{sc.id}/locks/{rod}/takeover")
    apply(ws.owner, sc.id, op("node.remove", {"id": rod}))
    seq = scene_of(ws.owner, sc.id)["latestSeq"]
    r = agent.api.call("POST", f"/api/scenes/{sc.id}/undo")
    assert r.status_code == 409 and r.json() == {"error": "undo_conflict", "nodeId": rod}
    assert scene_of(ws.owner, sc.id)["latestSeq"] == seq
    other = Ws(app_url)
    foreign_404(other.owner.call("POST", f"/api/scenes/{sc.id}/undo"))
    foreign_404(other.owner.call("POST", f"/api/scenes/{sc.id}/restore", {"toSeq": 0}))
    assert scene_of(ws.owner, sc.id)["latestSeq"] == seq


def test_graph_replay_hash(browser: Browser, app_url: str) -> None:
    seed = login(app_url, SEED_VIEWER)
    for n in range(SEED_LATEST + 1):
        replay = graph_at(seed, SEED_SCENE, n)
        assert replay["seq"] == n and replay["hash"] == graph_hash(replay["graph"]), n
    g0 = graph_at(seed, SEED_SCENE, 0)["graph"]
    assert sorted(x["id"] for x in g0["nodes"]) == ["n_cam", "n_key", "n_root"]
    assert node_in(g0, "n_cam")["rotation"] == [-15, 0, 0]
    assert node_in(graph_at(seed, SEED_SCENE, 4)["graph"], "n_cup_l")["position"] == [-0.6, 0, 0]
    assert graph_at(seed, SEED_SCENE, SEED_LATEST)["graph"]["transitions"] == [{"from": "rest", "to": "st_hover", "trigger": "hover", "durationMs": 420}]
    latest = scene_of(seed, SEED_SCENE)["latestSeq"]
    for bad in (-1, latest + 1):
        r = seed.call("GET", f"/api/scenes/{SEED_SCENE}/graph?at={bad}")
        assert r.status_code == 422 and "at" in r.json()["errors"]
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",))
    cup = sc.ids["Cup"]
    for start in range(0, GRAPH_OPS, MAX_BATCH):
        apply(ws.owner, sc.id, *[move(cup, position=[(start + i + 1) / 100, 0, 0]) for i in range(MAX_BATCH)])
    total = GRAPH_OPS + 1
    started = time.monotonic()
    replay = graph_at(ws.owner, sc.id, total)
    assert time.monotonic() - started <= GRAPH_BUDGET_S
    assert replay["hash"] == graph_hash(replay["graph"]) and node_in(replay["graph"], cup)["position"][0] == GRAPH_OPS / 100
    assert node_in(graph_at(ws.owner, sc.id, 501)["graph"], cup)["position"][0] == 5
    small = new_scene(ws.owner, ("Lid",))
    state = scene_of(ws.owner, small.id)
    with app_page(browser, app_url, app_path("scenes", small.id), ws.owner) as pg:
        expect(viewport(pg)).to_have_attribute("data-graph-hash", state["hash"], timeout=UI_MS)
        expect(viewport(pg)).to_have_attribute("data-op-seq", str(state["latestSeq"]))


def _announce(op_: dict, latest: int, tz: str, node_name: str) -> str:
    kind = "agent" if op_["author"]["kind"] == "agent" else "person"
    return (f"Operation {op_['seq']} of {latest}: {op_['type']} on {node_name} by {op_['author']['name']} "
            f"({kind}) at {clock(op_['createdAt'], tz)}")


def test_rewind_timeline(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",), big=True)
    cup = sc.ids["Cup"]
    for k in range(1, 12):
        apply(ws.owner, sc.id, move(cup, position=[k, 0, 0]))
    release(ws.owner, sc.id, cup)
    agent = ws.token("edit")
    apply(agent.api, sc.id, move(cup, position=[20, 0, 0]))
    release(agent.api, sc.id, cup)
    ops = ops_of(ws.owner, sc.id)
    latest = len(ops)
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner, live=False) as pg:
        until(pg, READY_JS, None, UI_MS / 1000)
        pg.get_by_role("treeitem", name=CUP).click()
        slider = pg.get_by_role("slider", name="Operation log")
        slider_is(slider, "max", latest, pg)
        slider.focus()
        pg.keyboard.press("End")
        until(pg, VIEW_JS, {"seq": latest, "hash": ""}, QUARTER_S)
        full = {seq: pg.evaluate(TICK_STRENGTH_JS, seq) for seq in (latest, latest - 1)}
        assert all(full.values()), f"the ticks paint no visible mark: {full}"
        px = inspector(pg, "Position X")
        pg.keyboard.press("ArrowLeft")
        until(pg, VIEW_JS, {"seq": latest - 1, "hash": graph_at(ws.owner, sc.id, latest - 1)["hash"]}, QUARTER_S)
        counted, outlined = [], []
        for _ in range(COUNT_MS // 16 + 1):
            counted.append(num(px))
            outlined.append(cup in (viewport(pg).get_attribute("data-highlighted") or "").split(","))
            advance(pg, 16)
        assert any(outlined), "the changed node was never outlined within the quarter second"
        assert any(11 < value < 20 for value in counted), counted
        advance(pg, COUNT_MS)
        assert num(px) == 11
        advance(pg, HIGHLIGHT_MS * 2)
        assert (viewport(pg).get_attribute("data-highlighted") or "") == ""
        advance(pg, FADE_MS * 2)
        until(pg, TICK_FADED_JS, {"seq": latest, "o": FADED_OPACITY, "full": full[latest]}, FADE_MS * 4 / 1000)
        assert pg.evaluate(TICK_STRENGTH_JS, latest - 1) >= 0.95 * full[latest - 1]
        announcement = pg.get_by_role("status", name="Rewind announcement")
        shows(pg, announcement, _announce(ops[latest - 2], latest, BERLIN, CUP))
        expect(pg.get_by_role("button", name="Restore as new operation")).to_be_visible()
        expect(pg.get_by_role("button", name="Return to latest")).to_be_visible()
        expect(pg.get_by_role("region", name="Inspector")).to_contain_text(f"Viewing operation {latest - 1}. Return to latest to edit.")
        expect(px).not_to_be_editable()
        slider.focus()
        pg.keyboard.press("Shift+ArrowLeft")
        until(pg, VIEW_JS, {"seq": latest - 11, "hash": graph_at(ws.owner, sc.id, latest - 11)["hash"]}, UI_MS / 1000)
        pg.keyboard.press("Home")
        until(pg, VIEW_JS, {"seq": 0, "hash": graph_at(ws.owner, sc.id, 0)["hash"]}, UI_MS / 1000)
        shows(pg, announcement, "Start of log")
        pg.keyboard.press("End")
        until(pg, VIEW_JS, {"seq": latest, "hash": scene_of(ws.owner, sc.id)["hash"]}, UI_MS / 1000)
        shows(pg, announcement, _announce(ops[-1], latest, BERLIN, CUP))
        expect(pg.get_by_role("button", name="Restore as new operation")).to_be_hidden()
        box = slider.bounding_box()
        left = min(box["x"], pg.evaluate(TICKS_LEFT_JS))
        y = box["y"] + box["height"] / 2
        start = box["x"] + box["width"] - min(box["width"] / 2, THUMB_INSET_PX)
        end = max(0, left - DRAG_PAST_PX)
        pg.mouse.move(start, y)
        pg.mouse.down()
        pg.mouse.move((start + end) / 2, y, steps=30)
        until(pg, MID_DRAG_JS, {"latest": latest}, QUARTER_S * 4)
        pg.mouse.move(end, y, steps=30)
        pg.mouse.up()
        until(pg, VIEW_JS, {"seq": 0, "hash": graph_at(ws.owner, sc.id, 0)["hash"]}, QUARTER_S * 4)
        shows(pg, announcement, "Start of log")


def test_rewind_reduced_motion(browser: Browser, app_url: str) -> None:
    seed = login(app_url, SEED_VIEWER)
    ops = ops_of(seed, SEED_SCENE)
    assert len(ops) == SEED_LATEST
    with app_page(browser, app_url, app_path("scenes", SEED_SCENE), seed, reduced=True, live=False) as pg:
        until(pg, READY_JS, None, UI_MS / 1000)
        slider = pg.get_by_role("slider", name="Operation log")
        slider.focus()
        pg.keyboard.press("Home")
        until(pg, VIEW_JS, {"seq": 0, "hash": ""}, UI_MS / 1000)
        for seq in range(1, 4):
            pg.keyboard.press("ArrowRight")
            until(pg, VIEW_JS, {"seq": seq, "hash": ""}, UI_MS / 1000)
        pg.keyboard.press("ArrowRight")
        until(pg, VIEW_JS, {"seq": 4, "hash": graph_at(seed, SEED_SCENE, 4)["hash"]}, UI_MS / 1000)
        changes = pg.get_by_role("list", name="Changes").get_by_role("listitem")
        listed(pg, changes, ["Left cup position: [0, 0, 0] → [-0.6, 0, 0] by Catalogue poser"])
        shows(pg, pg.get_by_role("status", name="Rewind announcement"), _announce(ops[3], SEED_LATEST, BERLIN, "Left cup"))
        assert pg.evaluate(TICK_JS, {"seq": SEED_LATEST})["running"] == 0
        pg.keyboard.press("ArrowRight")
        until(pg, VIEW_JS, {"seq": 5, "hash": ""}, UI_MS / 1000)
        pg.keyboard.press("ArrowRight")
        until(pg, VIEW_JS, {"seq": 6, "hash": graph_at(seed, SEED_SCENE, 6)["hash"]}, UI_MS / 1000)
        listed(pg, changes, ["Headband layer 1 type: none → base by Sol Navarro",
                             "Headband layer 1 color: none → [0.12, 0.12, 0.11] by Sol Navarro",
                             "Headband layer 1 roughness: none → 0.6 by Sol Navarro",
                             "Headband layer 1 metalness: none → 0.1 by Sol Navarro"])
        pg.keyboard.press("End")
        until(pg, VIEW_JS, {"seq": SEED_LATEST, "hash": graph_at(seed, SEED_SCENE, SEED_LATEST)["hash"]}, UI_MS / 1000)
        listed(pg, changes, ["Left cup rotation in Hover: none → [0, 15, 0] by Sol Navarro",
                             "Scene graph state Hover: none → present by Sol Navarro",
                             "Scene graph transition Rest hover: none → 420 ms by Sol Navarro"])
        expect(viewport(pg)).to_have_attribute("data-op-seq", str(SEED_LATEST))
        assert pg.evaluate(LOOPS_JS) == []


def test_wf_op_log_rewind_restore(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",))
    cup = sc.ids["Cup"]
    for k in range(1, 4):
        apply(ws.owner, sc.id, move(cup, position=[k, 0, 0]))
    release(ws.owner, sc.id, cup)
    agent = ws.token("edit")
    apply(agent.api, sc.id, move(cup, rotation=[0, 30, 0]))
    release(agent.api, sc.id, cup)
    history = ops_of(ws.owner, sc.id)
    latest = len(history)
    target = latest - 3
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        slider = pg.get_by_role("slider", name="Operation log")
        slider_is(slider, "max", latest)
        slider.focus()
        pg.keyboard.press("End")
        for _ in range(3):
            pg.keyboard.press("ArrowLeft")
        slider_is(slider, "now", target)
        pg.get_by_role("button", name="Restore as new operation").click()
        expect(pg.get_by_role("status", name="Editor status")).to_contain_text(f"Restored to operation {target}.", timeout=UI_MS)
    state = scene_of(ws.owner, sc.id)
    assert state["latestSeq"] == latest + 3 and state["hash"] == graph_at(ws.owner, sc.id, target)["hash"]
    now_ops = ops_of(ws.owner, sc.id)
    assert now_ops[:latest] == history
    assert {o["restoreTo"] for o in now_ops[latest:]} == {target} and len({o["batchId"] for o in now_ops[latest:]}) == 1
    assert len([e for e in audit(ws.owner) if e["action"] == "scene.restored" and e["target"]["id"] == sc.id]) == 1
    r = ws.owner.call("POST", f"/api/scenes/{sc.id}/restore", {"toSeq": state["latestSeq"]})
    assert r.status_code == 422 and "toSeq" in r.json()["errors"]


def test_restore_lock_race(app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",))
    cup = sc.ids["Cup"]
    for k in range(1, 4):
        apply(ws.owner, sc.id, move(cup, position=[k, 0, 0]))
    release(ws.owner, sc.id, cup)
    agent = ws.token("edit")
    latest = scene_of(ws.owner, sc.id)["latestSeq"]
    barrier = threading.Barrier(2, timeout=HTTP_TIMEOUT_S)

    def restore() -> httpx.Response:
        barrier.wait()
        return ws.owner.call("POST", f"/api/scenes/{sc.id}/restore", {"toSeq": 1})

    def batch() -> httpx.Response:
        barrier.wait()
        return agent.api.call("POST", f"/api/scenes/{sc.id}/ops", {"ops": [move(cup, position=[9, 0, 0])]})
    with ThreadPoolExecutor(2) as pool:
        futures = pool.submit(restore), pool.submit(batch)
        restored, batched = futures[0].result(), futures[1].result()
    assert sorted([restored.status_code, batched.status_code]) == [201, 409], (restored.text, batched.text)
    state = scene_of(ws.owner, sc.id)
    if restored.status_code == 201:
        assert batched.json()["error"] == "locked" and batched.json()["holder"]["name"] == ws.owner_name
        assert state["hash"] == graph_at(ws.owner, sc.id, 1)["hash"] and state["latestSeq"] == latest + 3
    else:
        assert restored.json()["error"] == "locked" and restored.json()["holder"]["name"] == agent.name
        assert node_in(state["graph"], cup)["position"] == [9, 0, 0] and state["latestSeq"] == latest + 1


def test_wf_op_log_rewind_undo_ui(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",))
    cup = sc.ids["Cup"]
    apply(ws.owner, sc.id, move(cup, position=[1, 0, 0]))
    release(ws.owner, sc.id, cup)
    agent = ws.token("edit")
    apply(agent.api, sc.id, op("camera.view.set", {"name": AGENT_VIEW, "position": [0, 1, 5], "target": [0, 0, 0], "fov": 40}))
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        status = pg.get_by_role("status", name="Editor status")
        pg.get_by_role("button", name="Undo").click()
        expect(status).to_contain_text("Undone.", timeout=UI_MS)
        poll(lambda: node_in(scene_of(ws.owner, sc.id)["graph"], cup)["position"] == [0, 0, 0], UI_MS / 1000, "undo")
        pg.get_by_role("button", name="Redo").click()
        expect(status).to_contain_text("Redone.", timeout=UI_MS)
        poll(lambda: node_in(scene_of(ws.owner, sc.id)["graph"], cup)["position"] == [1, 0, 0], UI_MS / 1000, "redo")
        for _ in range(3):
            pg.get_by_role("button", name="Undo").click()
            pg.wait_for_function("() => true")
            expect(pg.get_by_role("button", name="Undo")).to_be_enabled(timeout=UI_MS)
        expect(status).to_contain_text("Nothing to undo.", timeout=UI_MS)
    assert [c["name"] for c in scene_of(ws.owner, sc.id)["graph"]["cameraViews"]] == [AGENT_VIEW]


def test_wf_asset_uploads_model_texture(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ())
    model, texture = glb(), png()
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        sheet(pg)
        status = pg.get_by_role("status", name="Upload status")
        with pg.expect_file_chooser() as chooser:
            pg.get_by_role("button", name="Upload model").click()
        chooser.value.set_files({"name": MODEL_FILE, "mimeType": "model/gltf-binary", "buffer": model})
        expect(status).to_contain_text(f"{MODEL_FILE} uploaded.", timeout=UI_MS)
        with pg.expect_file_chooser() as chooser:
            pg.get_by_role("button", name="Upload texture").click()
        chooser.value.set_files({"name": TEXTURE_FILE, "mimeType": "image/png", "buffer": texture})
        expect(status).to_contain_text(f"{TEXTURE_FILE} uploaded.", timeout=UI_MS)
        assets = {a["name"]: a for a in ws.owner.ok("GET", "/api/assets")["assets"]}
        listing = pg.get_by_role("list", name="Assets")
        for name in (MODEL_FILE, TEXTURE_FILE):
            expect(listing).to_contain_text(name)
        model_asset, texture_asset = assets[MODEL_FILE], assets[TEXTURE_FILE]
        pg.get_by_role("button", name=f"Add {model_asset['name']} to scene").click()
        poll(lambda: [n for n in scene_of(ws.owner, sc.id)["graph"]["nodes"] if n["assetId"] == model_asset["id"]],
             UI_MS / 1000, "mesh added")
    added = next(n for n in scene_of(ws.owner, sc.id)["graph"]["nodes"] if n["assetId"] == model_asset["id"])
    assert added["kind"] == "mesh"
    assert model_asset["kind"] == "model" and texture_asset["kind"] == "texture"
    for asset, data in ((model_asset, model), (texture_asset, texture)):
        key = f"ws/{ws.id}/assets/{asset['id']}"
        assert key in s3_keys(f"ws/{ws.id}/assets/") and S3().get(key) == data
    own = ws.owner.call("GET", f"/api/assets/{model_asset['id']}/file")
    assert own.status_code == 200 and own.content == model
    foreign_404(Ws(app_url).owner.call("GET", f"/api/assets/{model_asset['id']}/file"))


UPLOAD_CASE_IDS = ["model_ok", "model_upper_ext", "model_at_limit", "model_over_limit", "texture_png_ok", "texture_jpeg_ok",
                   "texture_at_limit", "texture_over_limit", "glb_wrong_length", "glb_wrong_version", "model_wrong_ext",
                   "png_as_model", "svg_texture", "png_named_jpg", "glb_named_png", "traversal_name", "backslash_name",
                   "long_name", "texture_too_wide", "name_before_size", "size_before_type", "unknown_kind"]


def _upload_case(case: str) -> tuple[str, str, bytes, int, Any]:
    too_large = lambda limit: {"error": "file_too_large", "limitBytes": limit}
    bad_type = {"error": "unsupported_type"}
    bad_name = {"errors": {"file": "File name is not allowed"}}
    return {
        "model_ok": ("model", "chair.glb", glb(), 201, None),
        "model_upper_ext": ("model", "CHAIR.GLB", glb(), 201, None),
        "model_at_limit": ("model", "big.glb", glb(total=MODEL_LIMIT), 201, None),
        "model_over_limit": ("model", "big.glb", glb(total=MODEL_LIMIT + 1), 413, too_large(MODEL_LIMIT)),
        "texture_png_ok": ("texture", "wood.png", png(), 201, None),
        "texture_jpeg_ok": ("texture", "wood.jpeg", jpeg(), 201, None),
        "texture_at_limit": ("texture", "big.png", png(total=TEXTURE_LIMIT), 201, None),
        "texture_over_limit": ("texture", "big.png", png(total=TEXTURE_LIMIT + 1), 413, too_large(TEXTURE_LIMIT)),
        "glb_wrong_length": ("model", "chair.glb", glb(length_delta=1), 415, bad_type),
        "glb_wrong_version": ("model", "chair.glb", glb(version=1), 415, bad_type),
        "model_wrong_ext": ("model", "chair.gltf", glb(), 415, bad_type),
        "png_as_model": ("model", "chair.glb", png(), 415, bad_type),
        "svg_texture": ("texture", "logo.svg", SVG, 415, bad_type),
        "png_named_jpg": ("texture", "wood.jpg", png(), 415, bad_type),
        "glb_named_png": ("texture", "wood.png", glb(), 415, bad_type),
        "traversal_name": ("model", "../chair.glb", glb(), 422, bad_name),
        "backslash_name": ("model", "dir\\chair.glb", glb(), 422, bad_name),
        "long_name": ("model", "a" * (FILE_NAME_MAX - 3) + ".glb", glb(), 422, bad_name),
        "texture_too_wide": ("texture", "wide.png", png(width=TEXTURE_MAX_PX + 1, height=1), 422,
                             {"errors": {"file": "Texture is larger than 4096 by 4096 pixels"}}),
        "name_before_size": ("model", "../big.glb", glb(total=MODEL_LIMIT + 1), 422, bad_name),
        "size_before_type": ("texture", "big.png", b"\x00" * (TEXTURE_LIMIT + 1), 413, too_large(TEXTURE_LIMIT)),
        "unknown_kind": ("video", "clip.glb", glb(), 422, None),
    }[case]


@pytest.mark.parametrize("case", UPLOAD_CASE_IDS, ids=UPLOAD_CASE_IDS)
def test_upload_checks(app_url: str, case: str) -> None:
    kind, name, data, status, body = _upload_case(case)
    ws = Ws(app_url)
    prefix = f"ws/{ws.id}/assets/"
    r = upload(ws.owner, kind, name, data)
    assert r.status_code == status, r.text[:300]
    if status == 201:
        asset = r.json()
        assert asset["bytes"] == len(data) and asset["kind"] == kind
        assert S3().get(prefix + asset["id"]) == data
    else:
        if body is not None:
            assert r.json() == body
        if status == 422 and body is None:
            assert "errors" in r.json()
        assert s3_keys(prefix) == [] and ws.owner.ok("GET", "/api/assets")["assets"] == []


def test_wf_asset_uploads_storage_down(browser: Browser) -> None:
    base = env_url("APP_MINIO_DOWN_URL")
    ws = Ws(base)
    assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
    sc = new_scene(ws.owner, ("Cup",))
    outage = {"error": "service_unavailable", "service": "file_storage"}
    r = upload(ws.owner, "model", "chair.glb", glb())
    assert r.status_code == 503 and r.json() == outage
    r = ws.owner.call("POST", f"/api/scenes/{sc.id}/versions", {"label": "Down"})
    assert r.status_code == 503 and r.json() == outage
    apply(ws.owner, sc.id, move(sc.ids["Cup"], position=[1, 0, 0]))
    ws.owner.ok("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": sc.ids["Cup"], "body": "Still editing", "mentions": []}, 201)
    assert versions_of(ws.owner, sc.id) == [] and s3_keys(f"ws/{ws.id}/") == []
    with app_page(browser, base, app_path("scenes", sc.id), ws.owner) as pg:
        sheet(pg)
        with pg.expect_file_chooser() as chooser:
            pg.get_by_role("button", name="Upload model").click()
        chooser.value.set_files({"name": "chair.glb", "mimeType": "model/gltf-binary", "buffer": glb()})
        expect(pg.get_by_role("status", name="Service status")).to_contain_text(
            "File storage is unavailable. Your edits are saved; uploads, versions and publishing will resume when it is back.",
            timeout=BANNER_S * 1000 + UI_MS)


def test_wf_comments_review_live_comments(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    viewer = ws.join(mail, "viewer")
    sc = new_scene(ws.owner, (CUP,))
    cup = sc.ids[CUP]
    body = f"Matte please {tag()}"
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        sheet(pg)
        comments = pg.get_by_role("region", name="Comments")
        expect(comments).to_be_visible(timeout=UI_MS)
        posted = viewer.api.ok("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": cup, "body": body, "mentions": []}, 201)
        assert posted["author"]["name"] == viewer.name and posted["resolved"] is False
        expect(comments).to_contain_text(body, timeout=RT_MS)
        pin = pg.get_by_role("button", name=f"Comment on {CUP}")
        expect(pin).to_be_visible(timeout=RT_MS)
        pin.click()
        expect(pg.get_by_role("treeitem", name=CUP)).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        comments.get_by_role("button", name="Resolve").first.click()
        poll(lambda: next(c for c in ws.owner.ok("GET", f"/api/scenes/{sc.id}/comments")["comments"] if c["id"] == posted["id"])["resolved"],
             UI_MS / 1000, "resolved")
        own = f"Owner note {tag()}"
        fill(pg.get_by_role("textbox", name="Comment"), own)
        pg.get_by_role("button", name="Post comment").click()
        expect(pg.get_by_role("status", name="Editor status")).to_contain_text("Comment posted.", timeout=UI_MS)
    listed = ws.owner.ok("GET", f"/api/scenes/{sc.id}/comments")["comments"]
    mine = [c for c in listed if c["body"] == own]
    assert len(mine) == 1 and mine[0]["nodeId"] == cup and mine[0]["author"]["name"] == ws.owner_name
    poll(lambda: [x["resolved"] for x in PocketBase().records("comments", f'commentId="{posted["id"]}"')] == [True], RT_MS / 1000, "PocketBase comment")
    assert ws.owner.ok("PATCH", f"/api/comments/{posted['id']}", {"resolved": False})["resolved"] is False
    r = viewer.api.call("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": cup, "body": "x" * (COMMENT_MAX + 1), "mentions": []})
    assert r.status_code == 422
    foreign_404(viewer.api.call("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": "n_missing_probe", "body": "x", "mentions": []}))


def test_mention_picker(browser: Browser, app_url: str, mail: Any) -> None:
    ws, other = Ws(app_url), Ws(app_url)
    t = tag()
    kept = ws.join(mail, "editor", name=f"Mx{t} Ana")
    gone = ws.join(mail, "viewer", name=f"Mx{t} Gil")
    other.join(mail, "editor", name=f"Mx{t} Bo")
    ws.owner.ok("DELETE", f"/api/members/{gone.id}", status=204)
    sc = new_scene(ws.owner, ("Cup",))
    r = ws.owner.call("GET", f"/api/scenes/{sc.id}/mentionable?q=Mx{t}")
    found = r.json()["members"]
    assert [m["name"] for m in found] == [kept.name] and found[0]["id"] == kept.id
    assert "email" not in found[0] and "@" not in r.text
    assert len(ws.owner.ok("GET", f"/api/scenes/{sc.id}/mentionable?q=")["members"]) <= MENTION_MAX
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        sheet(pg)
        pg.get_by_role("treeitem", name=CUP).click()
        box = pg.get_by_role("textbox", name="Comment")
        box.click()
        pg.keyboard.type(f"Look @Mx{t}")
        picker = pg.get_by_role("listbox", name="Mention a teammate")
        expect(picker.get_by_role("option")).to_have_text([re.compile(re.escape(kept.name))], timeout=UI_MS)
        pick_mention(pg, picker)
        expect(box).to_have_value(re.compile(re.escape(kept.name)))
        pg.get_by_role("button", name="Post comment").click()
        expect(pg.get_by_role("status", name="Editor status")).to_contain_text("Comment posted.", timeout=UI_MS)
    posted = [c for c in ws.owner.ok("GET", f"/api/scenes/{sc.id}/comments")["comments"] if kept.name in c["body"]]
    assert posted and posted[0]["mentions"] == [{"id": kept.id, "name": kept.name}]


def test_foreign_ids_not_found(app_url: str, mail: Any) -> None:
    mine, theirs = Ws(app_url), Ws(app_url)
    approver = theirs.join(mail, "viewer")
    member = theirs.join(mail, "editor")
    sc = new_scene(theirs.owner, ("Cup",))
    node = sc.ids["Cup"]
    comment = theirs.owner.ok("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": node, "body": "Theirs", "mentions": []}, 201)
    asset = upload(theirs.owner, "model", "chair.glb", glb()).json()
    token = theirs.token("read")
    invite = theirs.invite(fresh("foreign")[1], "viewer")
    published = go_live(theirs.owner, approver.api, sc.id)
    export = theirs.owner.ok("POST", f"/api/versions/{published['id']}/exports", status=201)
    draft = theirs.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Draft"}, 201)
    paid = checkout(theirs.owner).json()
    own = new_scene(mine.owner, ("Mine",))
    probe = "zz_missing_probe"
    pairs = [("GET", "/api/scenes/{}", sc.id, _NO), ("GET", "/api/scenes/{}/graph?at=0", sc.id, _NO),
             ("GET", "/api/scenes/{}/ops", sc.id, _NO), ("GET", "/api/scenes/{}/comments", sc.id, _NO),
             ("GET", "/api/scenes/{}/versions", sc.id, _NO), ("GET", "/api/scenes/{}/locks", sc.id, _NO),
             ("POST", "/api/scenes/{}/ops", sc.id, {"ops": [move(node, position=[1, 0, 0])]}),
             ("PATCH", "/api/comments/{}", comment["id"], {"resolved": True}),
             ("POST", "/api/versions/{}/submit", draft["id"], _NO), ("GET", "/api/versions/{}/review-links", draft["id"], _NO),
             ("GET", "/api/assets/{}/file", asset["id"], _NO), ("GET", "/api/exports/{}", export["id"], _NO),
             ("DELETE", "/api/members/{}", member.id, _NO), ("DELETE", "/api/members/invites/{}", invite["id"], _NO),
             ("DELETE", "/api/agent-tokens/{}", token.id, _NO), ("GET", "/api/billing/invoices/{}/pdf", paid["invoice"]["id"], _NO),
             ("POST", "/api/billing/payments/{}/refund", paid["payment"]["id"], {}),
             ("POST", "/api/billing/invoices/{}/pay", paid["invoice"]["id"], {"card": CARD})]
    for method, path, foreign_id, body in pairs:
        key = idempotency_key() if path.startswith("/api/billing") and method == "POST" else None
        a = mine.owner.call(method, path.format(foreign_id), body, key=key)
        b = mine.owner.call(method, path.format(probe), body, key=key)
        foreign_404(a)
        assert a.json() == b.json() and a.status_code == b.status_code, path
    for body in ({"nodeId": node, "body": "x", "mentions": []}, {"nodeId": own.ids["Mine"], "body": "x", "mentions": [member.id]}):
        foreign_404(mine.owner.call("POST", f"/api/scenes/{own.id}/comments", body))
    foreign_404(mine.owner.call("POST", f"/api/scenes/{own.id}/locks", {"nodeId": node}))
    assert not next(c for c in theirs.owner.ok("GET", f"/api/scenes/{sc.id}/comments")["comments"] if c["id"] == comment["id"])["resolved"]
    assert version_of(theirs.owner, sc.id, draft["id"])["state"] == "draft"
    listing = theirs.owner.ok("GET", "/api/members")
    assert member.id in [m["id"] for m in listing["members"]] and invite["id"] in [i["id"] for i in listing["invites"]]
    assert [t["status"] for t in theirs.owner.ok("GET", "/api/agent-tokens")["tokens"] if t["id"] == token.id] == ["active"]
    assert invoices_of(theirs.owner)["payments"][0]["refundedCents"] == 0


def test_wf_comments_review_approve(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    viewer = ws.join(mail, "viewer")
    teammate = ws.join(mail, "editor", name=one_word(MENTION_PREFIX))
    sc = new_scene(ws.owner, ("Headband",))
    band = sc.ids["Headband"]
    apply(ws.owner, sc.id, op("state.add", {"state": {"id": LIFT_ID, "name": LIFTED}}),
          op("state.override.set", {"stateId": LIFT_ID, "nodeId": band, "field": "position", "value": [0, 1, 0]}))
    release(ws.owner, sc.id, band)
    label = f"Review {tag()}"
    first = 1
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        sheet(pg)
        pg.get_by_role("button", name="Save version").click()
        dialog = pg.get_by_role("dialog", name="Save version")
        fill(dialog.get_by_role("textbox", name="Version label"), label)
        dialog.get_by_role("button", name="Save", exact=True).click()
        status = pg.get_by_role("status", name="Editor status")
        expect(status).to_contain_text(f"Version {first} saved.", timeout=UI_MS)
        expect(pg.get_by_text(version_row(first, label, "Draft"))).to_be_visible(timeout=UI_MS)
        pg.get_by_role("button", name="Submit for review").click()
        expect(status).to_contain_text("Submitted for review.", timeout=UI_MS)
        expect(pg.get_by_text(version_row(first, label, "In review"))).to_be_visible(timeout=UI_MS)
    version = versions_of(ws.owner, sc.id)[0]
    r = ws.owner.call("POST", f"/api/versions/{version['id']}/approve")
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    note = f"Band reads glossy {tag()}"
    with app_page(browser, app_url, app_path("scenes", sc.id), viewer.api) as pg:
        states = pg.get_by_role("listbox", name="States")
        states.get_by_role("option", name=LIFTED).click()
        expect(states.get_by_role("option", name=LIFTED)).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        states.get_by_role("option", name="Rest").click()
        pg.get_by_role("treeitem", name="Headband").click()
        sheet(pg)
        box = pg.get_by_role("textbox", name="Comment")
        box.click()
        pg.keyboard.type(f"{note} @{teammate.name}")
        picker = pg.get_by_role("listbox", name="Mention a teammate")
        expect(picker.get_by_role("option")).to_have_text([re.compile(re.escape(teammate.name))], timeout=UI_MS)
        pick_mention(pg, picker)
        pg.get_by_role("button", name="Post comment").click()
        status = pg.get_by_role("status", name="Editor status")
        expect(status).to_contain_text("Comment posted.", timeout=UI_MS)
        pg.get_by_role("button", name="Approve").click()
        expect(status).to_contain_text("Approved.", timeout=UI_MS)
    version = version_of(ws.owner, sc.id, version["id"])
    assert version["state"] == "in_review" and [a["member"]["id"] for a in version["approvals"]] == [viewer.id]
    posted = [c for c in ws.owner.ok("GET", f"/api/scenes/{sc.id}/comments")["comments"] if note in c["body"]]
    assert len(posted) == 1 and posted[0]["nodeId"] == band and posted[0]["mentions"] == [{"id": teammate.id, "name": teammate.name}]


def test_review_links_lifecycle(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    approver = ws.join(mail, "viewer")
    sc = new_scene(ws.owner, ("Cup",))
    draft = ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Draft"}, 201)
    apply(ws.owner, sc.id, move(sc.ids["Cup"], position=[4, 0, 0]))
    other = ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Other"}, 201)
    links = f"/api/versions/{draft['id']}/review-links"
    day = lambda: iso(ws.owner.now() + timedelta(seconds=DAY_S))
    link = ws.owner.ok("POST", links, {"expiresAt": day()}, 201)
    assert re.fullmatch(r"[A-Za-z0-9_-]{43,}", link["token"]) and link["url"] == f"/review/{link['token']}"
    anon = Api(app_url, origin=False)
    seen = anon.ok("GET", f"/api/review/{link['token']}?versionId={other['id']}&version=2")
    assert seen["scene"] == {"name": sc.name} and seen["version"]["number"] == draft["number"] and seen["version"]["state"] == "draft"
    assert graph_hash(seen["graph"]) == graph_at(ws.owner, sc.id, draft["seq"])["hash"]
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for path in (f"/api/review/{link['token']}", f"/review/{link['token']}", "/api/review/zz_unknown_probe"):
            r = anon.call(method, path, {})
            assert r.status_code == 405 and r.json() == {"error": "read_only"}, (method, path)
    fresh_link = ws.owner.ok("POST", f"/api/review-links/{link['id']}/regenerate")
    foreign_404(anon.call("GET", f"/api/review/{link['token']}"))
    assert anon.call("GET", f"/api/review/{fresh_link['token']}").status_code == 200
    ws.owner.ok("DELETE", f"/api/review-links/{link['id']}", status=204)
    foreign_404(anon.call("GET", f"/api/review/{fresh_link['token']}"))
    assert [x["status"] for x in ws.owner.ok("GET", links)["links"] if x["id"] == link["id"]] == ["revoked"]
    now = ws.owner.now()
    for seconds in (LINK_MIN_S - 5, LINK_MAX_DAYS * DAY_S + DAY_S):
        r = ws.owner.call("POST", links, {"expiresAt": iso(now + timedelta(seconds=seconds))})
        assert r.status_code == 422 and "expiresAt" in r.json()["errors"]
    short = ws.owner.ok("POST", links, {"expiresAt": iso(ws.owner.now() + timedelta(seconds=SHORT_TTL_S))}, 201)
    expires = parse_iso(short["expiresAt"])

    def expired() -> bool:
        r = anon.call("GET", f"/api/review/{short['token']}")
        at = server_time(r)
        if at + timedelta(seconds=CLOCK_SKEW_S) <= expires:
            assert r.status_code == 200
        if at >= expires:
            assert r.status_code == 410 and r.json() == {"error": "link_expired"}
        return r.status_code == 410
    poll(expired, SHORT_TTL_S + WAIT_S, "link expiry")
    switch = ws.owner.ok("POST", links, {"expiresAt": day()}, 201)
    ws.owner.ok("PATCH", "/api/workspace", {"reviewLinksEnabled": False})
    foreign_404(anon.call("GET", f"/api/review/{switch['token']}"))
    r = ws.owner.call("POST", links, {"expiresAt": day()})
    assert r.status_code == 409 and r.json() == {"error": "review_links_disabled"}
    ws.owner.ok("PATCH", "/api/workspace", {"reviewLinksEnabled": True})
    assert anon.call("GET", f"/api/review/{switch['token']}").status_code == 200
    ws.owner.ok("POST", f"/api/versions/{draft['id']}/submit")
    approver.api.ok("POST", f"/api/versions/{draft['id']}/approve")
    ws.owner.ok("POST", f"/api/versions/{draft['id']}/schedule", {"publishAt": iso(ws.owner.now() + timedelta(seconds=PUBLISH_LEAD_S))})
    assert anon.call("GET", f"/api/review/{switch['token']}").status_code == 200
    poll(lambda: version_of(ws.owner, sc.id, draft["id"])["state"] == "published", WAIT_S, "publish")
    foreign_404(anon.call("GET", f"/api/review/{switch['token']}"))
    r = ws.owner.call("POST", links, {"expiresAt": day()})
    assert r.status_code == 409 and r.json() == {"error": "version_not_reviewable"}


def test_wf_review_links_settings_off(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",))
    version = ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Off"}, 201)
    with app_page(browser, app_url, app_path("settings"), ws.owner) as pg:
        switch = pg.get_by_role("switch", name="Allow review links")
        expect(switch).to_be_checked(timeout=UI_MS)
        switch.click()
        pg.get_by_role("button", name="Save settings").click()
        poll(lambda: ws.owner.ok("GET", "/api/workspace")["reviewLinksEnabled"] is False, UI_MS / 1000, "setting saved")
        pg.goto(app_url + app_path("scenes", sc.id))
        sheet(pg)
        pg.get_by_role("button", name="Create review link").click()
        dialog = pg.get_by_role("dialog", name="Create review link")
        fill(dialog.get_by_role("textbox", name="Expires"), "2026/11/03 09:00")
        dialog.get_by_role("button", name="Create link").click()
        expect(dialog.get_by_text("Use YYYY-MM-DD HH:mm:ss.")).to_be_visible(timeout=UI_MS)
        fill(dialog.get_by_role("textbox", name="Expires"), local(ws.owner.now() + timedelta(seconds=DAY_S), BERLIN)[:19])
        dialog.get_by_role("button", name="Create link").click()
        expect(pg.get_by_role("status", name="Editor status")).to_contain_text("Review links are turned off for this workspace.", timeout=UI_MS)
    assert ws.owner.ok("GET", f"/api/versions/{version['id']}/review-links")["links"] == []


def test_wf_review_links_outside_reviewer(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    viewer = ws.join(mail, "viewer")
    sc = new_scene(ws.owner, (BODY,), big=True)
    body = sc.ids[BODY]
    apply(ws.owner, sc.id, op("state.add", {"state": {"id": LIFT_ID, "name": LIFTED}}),
          op("state.override.set", {"stateId": LIFT_ID, "nodeId": body, "field": "position", "value": [0, 1, 0]}))
    secret_note = f"Private remark {tag()}"
    viewer.api.ok("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": body, "body": secret_note, "mentions": []}, 201)
    ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Outside"}, 201)
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        pg.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=Api(app_url).origin)
        sheet(pg)
        pg.get_by_role("button", name="Create review link").click()
        dialog = pg.get_by_role("dialog", name="Create review link")
        expires = ws.owner.now() + timedelta(seconds=DAY_S)
        fill(dialog.get_by_role("textbox", name="Expires"), local(expires, BERLIN)[:19])
        dialog.get_by_role("button", name="Create link").click()
        status = pg.get_by_role("status", name="Editor status")
        expect(status).to_contain_text(f"Review link created. It expires {local(expires, BERLIN)}.", timeout=UI_MS)
        pg.get_by_role("button", name="Copy link").click()
        copied = poll(lambda: pg.evaluate("() => navigator.clipboard.readText()"), UI_MS / 1000, "clipboard")
        token = re.search(r"/review/([A-Za-z0-9_-]{43,})", copied).group(1)
        with app_page(browser, app_url, f"/review/{token}", reduced=True, live=False) as outsider:
            until(outsider, "(copy) => document.body.innerText.includes(copy)", REVIEW_COPY, UI_MS / 1000)
            header = outsider.evaluate(HEADER_JS, {"copy": REVIEW_COPY, "name": sc.name, "n": 1})
            assert header is not None, "no header reads the scene name, version 1 and the review copy"
            html = outsider.content()
            for private in (secret_note, viewer.name, viewer.email, ws.owner_name, ws.owner_email, "transform.set"):
                assert private not in html, private
            states = outsider.get_by_role("listbox", name="States")
            states.get_by_role("option", name=LIFTED).click()
            expect(states.get_by_role("option", name=LIFTED)).to_have_attribute("aria-selected", "true")
            advance(outsider, 1000)
            before = camera(outsider)
            box = outsider.get_by_role("region", name="Viewport").bounding_box()
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            outsider.mouse.move(cx, cy)
            outsider.mouse.down()
            outsider.mouse.move(cx + box["width"] / 4, cy, steps=8)
            outsider.mouse.up()
            advance(outsider, 500)
            assert camera(outsider) != before
            pg.get_by_role("button", name="Revoke link").click()
            expect(status).to_contain_text("Link revoked.", timeout=UI_MS)
            outsider.reload()
            until(outsider, "() => document.body.innerText.includes('This review link is not valid.')", None, UI_MS / 1000)
    foreign_404(Api(app_url).call("GET", f"/api/review/{token}"))


def _transition_error(r: httpx.Response, frm: str, to: str) -> None:
    assert r.status_code == 409 and r.json() == {"error": "invalid_transition", "from": frm, "to": to}, r.text


def test_version_lifecycle(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    viewer, admin = ws.join(mail, "viewer"), ws.join(mail, "admin")
    sc = new_scene(ws.owner, ("Cup",))
    v1 = ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "One"}, 201)
    assert v1["state"] == "draft" and v1["seq"] == scene_of(ws.owner, sc.id)["latestSeq"]
    key = f"ws/{ws.id}/scenes/{sc.id}/versions/{v1['id']}/snapshot.json"
    snap = json.loads(S3().get(key))
    assert snap["seq"] == v1["seq"] and snap["hash"] == graph_at(ws.owner, sc.id, v1["seq"])["hash"]
    apply(ws.owner, sc.id, move(sc.ids["Cup"], position=[6, 0, 0]))
    assert json.loads(S3().get(key)) == snap and version_of(ws.owner, sc.id, v1["id"])["seq"] == v1["seq"]
    path = lambda vid, action: f"/api/versions/{vid}/{action}"
    publish_at = lambda s: {"publishAt": iso(ws.owner.now() + timedelta(seconds=s))}
    for person, method, route, body in ((viewer, "POST", f"/api/scenes/{sc.id}/versions", {"label": "x"}),
                                        (admin, "POST", path(v1["id"], "submit"), _NO),
                                        (viewer, "POST", path(v1["id"], "schedule"), publish_at(DAY_S)),
                                        (admin, "POST", path(v1["id"], "withdraw"), _NO)):
        r = person.api.call(method, route, body)
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    _transition_error(ws.owner.call("POST", path(v1["id"], "withdraw")), "draft", "withdrawn")
    _transition_error(ws.owner.call("POST", path(v1["id"], "unschedule")), "draft", "in_review")
    _transition_error(ws.owner.call("POST", path(v1["id"], "schedule"), publish_at(DAY_S)), "draft", "scheduled")
    r = viewer.api.call("POST", path(v1["id"], "approve"))
    assert r.status_code == 409 and r.json() == {"error": "not_in_review"}
    assert ws.owner.ok("POST", path(v1["id"], "submit"))["state"] == "in_review"
    _transition_error(ws.owner.call("POST", path(v1["id"], "submit")), "in_review", "in_review")
    r = ws.owner.call("POST", path(v1["id"], "schedule"), publish_at(DAY_S))
    assert r.status_code == 409 and r.json() == {"error": "approval_required"}
    first = viewer.api.ok("POST", path(v1["id"], "approve"))
    assert len(viewer.api.ok("POST", path(v1["id"], "approve"))["approvals"]) == len(first["approvals"]) == 1
    for seconds in (PUBLISH_MIN_S - 3, PUBLISH_MAX_DAYS * DAY_S + DAY_S):
        r = ws.owner.call("POST", path(v1["id"], "schedule"), publish_at(seconds))
        assert r.status_code == 422 and "publishAt" in r.json()["errors"]
    assert ws.owner.ok("POST", path(v1["id"], "schedule"), publish_at(DAY_S))["state"] == "scheduled"
    v2 = approved(ws.owner, viewer.api, sc.id, "Two")
    r = ws.owner.call("POST", path(v2["id"], "schedule"), publish_at(DAY_S))
    assert r.status_code == 409 and r.json() == {"error": "another_version_scheduled"}
    _transition_error(ws.owner.call("POST", path(v1["id"], "withdraw")), "scheduled", "withdrawn")
    assert ws.owner.ok("POST", path(v1["id"], "unschedule"))["state"] == "in_review"
    ws.owner.ok("POST", path(v1["id"], "schedule"), publish_at(PUBLISH_LEAD_S))
    poll(lambda: version_of(ws.owner, sc.id, v1["id"])["state"] == "published", WAIT_S, "publish")
    _transition_error(ws.owner.call("POST", path(v1["id"], "unschedule")), "published", "in_review")
    assert ws.owner.ok("POST", path(v1["id"], "withdraw"))["state"] == "withdrawn"
    _transition_error(ws.owner.call("POST", path(v1["id"], "withdraw")), "withdrawn", "withdrawn")
    _transition_error(ws.owner.call("POST", path(v1["id"], "submit")), "withdrawn", "in_review")


def test_scheduled_publish_server_clock(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    editor, viewer = ws.join(mail, "editor"), ws.join(mail, "viewer")
    sc = new_scene(ws.owner, ("Cup",))
    v = approved(editor.api, viewer.api, sc.id, "Launch")
    at = ws.owner.now() + timedelta(seconds=PUBLISH_LEAD_S)
    scheduled = ws.owner.ok("POST", f"/api/versions/{v['id']}/schedule", {"publishAt": iso(at)})
    publish_at = parse_iso(scheduled["publishAt"])
    assert publish_at == at
    assert len(find_mail(mail, to=ws.owner_email, subject=f"Scheduled: {sc.name} v{v['number']} goes live {local(at, BERLIN)}")) == 1

    def live() -> dict | None:
        r = ws.owner.call("GET", f"/api/scenes/{sc.id}/versions")
        moment = server_time(r)
        current = next(x for x in r.json()["versions"] if x["id"] == v["id"])
        if moment + timedelta(seconds=CLOCK_SKEW_S) <= publish_at:
            assert current["state"] == "scheduled", f"published early at {moment}"
        if moment >= publish_at + timedelta(seconds=SCHEDULER_LAG_S + CLOCK_SKEW_S):
            assert current["state"] == "published", f"late at {moment}"
        return current if current["state"] == "published" else None
    published = poll(live, WAIT_S, "go-live")
    gap = (parse_iso(published["publishedAt"]) - publish_at).total_seconds()
    assert 0 <= gap <= SCHEDULER_LAG_S and published["embedId"]
    assert f"ws/{ws.id}/published/{published['embedId']}/scene.json" in s3_keys(f"ws/{ws.id}/published/")
    notices = find_mail(mail, subject=f"Published: {sc.name} v{v['number']}", seconds=MAIL_WAIT_S)
    notices = [m for m in notices if ws.owner_email.lower() in to_of(m)]
    assert notices
    for notice in notices:
        assert sorted(to_of(notice)) == sorted([ws.owner_email.lower(), editor.email.lower()])
        assert f"/embed/{published['embedId']}" in text(notice)
    entries = [e for e in audit(ws.owner) if e["action"] == "version.published" and e["target"]["id"] == v["id"]]
    assert entries and all(e["actor"] == {"kind": "system", "id": "system", "name": "Orrery scheduler"} for e in entries)
    second = go_live(ws.owner, viewer.api, sc.id, creator=editor.api, label="Encore")
    assert second["embedId"] == published["embedId"]
    assert version_of(ws.owner, sc.id, v["id"])["state"] == "withdrawn"


def _embed_scene(ws: Ws, approver: Api) -> tuple[Scene, dict]:
    sc = new_scene(ws.owner, ("Body",), big=True)
    body = sc.ids["Body"]
    apply(ws.owner, sc.id,
          op("state.add", {"state": {"id": "st_hover", "name": "Hovered"}}), op("state.add", {"state": {"id": "st_click", "name": "Clicked"}}),
          op("state.add", {"state": {"id": "st_scroll", "name": "Scrolled"}}),
          op("state.override.set", {"stateId": "st_hover", "nodeId": body, "field": "position", "value": [0, 1, 0]}),
          op("state.override.set", {"stateId": "st_click", "nodeId": body, "field": "scale", "value": [1, 1, 1]}),
          op("state.override.set", {"stateId": "st_scroll", "nodeId": body, "field": "position", "value": [2, 0, 0]}),
          op("transition.set", {"from": "rest", "to": "st_hover", "trigger": "hover", "durationMs": 300}),
          op("transition.set", {"from": "rest", "to": "st_click", "trigger": "click", "durationMs": 300}),
          op("transition.set", {"from": "st_hover", "to": "st_click", "trigger": "click", "durationMs": 300}),
          op("transition.set", {"from": "rest", "to": "st_scroll", "trigger": "scroll", "durationMs": 500}))
    return sc, go_live(ws.owner, approver, sc.id, thumb=True)


def _yaw(pg: Page) -> float:
    return float(pg.get_by_role("region", name="3D scene").get_attribute("data-yaw"))


def test_embed_renders_and_transitions(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    viewer = ws.join(mail, "viewer")
    sc, version = _embed_scene(ws, viewer.api)
    path = f"/embed/{version['embedId']}"
    yaw_rate = lambda seconds: (seconds * 360 / TURN_MAX_S, seconds * 360 / TURN_MIN_S)
    with app_page(browser, app_url, path, live=False) as pg:
        until(pg, "() => !!document.querySelector('[data-yaw]')", None, UI_MS / 1000)
        frame = pg.get_by_role("region", name="3D scene")
        frames = scene_frames(frame)
        assert any(f["draws"] > 0 for f in frames) and decode(capture(frame)).variance() > 0
        expect(pg.get_by_role("listbox", name="States")).to_be_visible()
        box = frame.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, min(box["y"] + box["height"] / 2, pg.viewport_size["height"] / 2)
        pg.mouse.move(cx, cy)
        advance(pg, 100)
        expect(frame).to_have_attribute("data-state", "st_hover")
        still = _yaw(pg)
        advance(pg, 2000)
        assert _yaw(pg) == still
        pg.mouse.move(-1, -1)
        advance(pg, 1000)
        expect(frame).to_have_attribute("data-state", "rest")
        resting = _yaw(pg)
        advance(pg, IDLE_START_MS - 1500)
        assert _yaw(pg) == resting
        advance(pg, 1500)
        start = _yaw(pg)
        advance(pg, 5000)
        delta = (_yaw(pg) - start) % 360
        low, high = yaw_rate(5)
        assert low <= delta <= high, delta
        assert 0 <= _yaw(pg) < 360
        pg.mouse.click(cx, cy)
        advance(pg, 100)
        expect(frame).to_have_attribute("data-state", "st_click")
    with app_page(browser, app_url, path, live=False) as pg:
        until(pg, "() => !!document.querySelector('[data-yaw]')", None, UI_MS / 1000)
        frame = pg.get_by_role("region", name="3D scene")
        height = pg.evaluate("() => window.innerHeight")
        total = pg.evaluate("() => document.scrollingElement.scrollHeight")
        assert total >= 2 * height - 1
        span = total - height
        seen = []
        for fraction, want in ((0, "rest"), (0.25, "rest"), (0.75, "st_scroll"), (1, "st_scroll"), (0.25, "rest")):
            pg.evaluate("(y) => window.scrollTo(0, y)", int(span * fraction))
            advance(pg, 200)
            expect(frame).to_have_attribute("data-state", want)
            seen.append(decode(capture(frame)))
        assert difference(seen[0], seen[3]) > 0
    with app_page(browser, app_url, path, reduced=True, live=False) as pg:
        until(pg, "() => !!document.querySelector('[data-yaw]')", None, UI_MS / 1000)
        frame = pg.get_by_role("region", name="3D scene")
        first = _yaw(pg)
        advance(pg, IDLE_START_MS + 3000)
        assert _yaw(pg) == first
        before = camera(pg)
        box = frame.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + min(box["height"], pg.viewport_size["height"]) / 2
        pg.mouse.move(cx, cy)
        advance(pg, 100)
        expect(frame).to_have_attribute("data-state", "st_hover")
        pg.mouse.down()
        pg.mouse.move(cx + box["width"] / 4, cy, steps=8)
        pg.mouse.up()
        advance(pg, 500)
        assert camera(pg) != before
    with app_page(browser, app_url, path, no_webgl=True) as pg:
        expect(pg.get_by_role("img", name=sc.name)).to_be_visible(timeout=UI_MS)
        expect(pg.get_by_text("Interactive 3D needs WebGL.")).to_be_visible()
    ws.owner.ok("POST", f"/api/versions/{version['id']}/withdraw")
    gone = Api(app_url).call("GET", f"/api/embed/{version['embedId']}")
    assert gone.status_code == 410 and gone.json() == {"error": "gone"}
    with app_page(browser, app_url, path) as pg:
        expect(pg.get_by_text("This scene is no longer available.")).to_be_visible(timeout=UI_MS)


def test_published_copies_only_published_data(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    viewer = ws.join(mail, "viewer")
    sc = new_scene(ws.owner, ("Body",))
    model = upload(ws.owner, "model", "chair.glb", glb()).json()
    spare = upload(ws.owner, "model", "spare.glb", glb()).json()
    apply(ws.owner, sc.id, op("node.add", {"node": mesh(nid(), "Chair", sc.root, assetId=model["id"])}))
    note = f"Leak check {tag()}"
    viewer.api.ok("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": sc.ids["Body"], "body": note, "mentions": []}, 201)
    v = approved(ws.owner, viewer.api, sc.id, "Public")
    link = ws.owner.ok("POST", f"/api/versions/{v['id']}/review-links", {"expiresAt": iso(ws.owner.now() + timedelta(seconds=DAY_S))}, 201)
    later_node, later_state = f"Later{tag()}", f"Unreleased{tag()}"
    apply(ws.owner, sc.id, op("node.add", {"node": mesh(nid(), later_node, sc.root)}),
          op("state.add", {"state": {"id": nid("st"), "name": later_state}}))
    draft = ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Later"}, 201)
    r = ws.owner.call("POST", f"/api/versions/{draft['id']}/exports")
    assert r.status_code == 409 and r.json() == {"error": "not_published"}
    ws.owner.ok("POST", f"/api/versions/{v['id']}/schedule", {"publishAt": iso(ws.owner.now() + timedelta(seconds=PUBLISH_LEAD_S))})
    published = poll(lambda: (lambda x: x if x["state"] == "published" else None)(version_of(ws.owner, sc.id, v["id"])), WAIT_S, "publish")
    private = [note, ws.owner_name, ws.owner_email, viewer.name, viewer.email, later_node, later_state, link["token"], '"inverse"', '"batchId"']
    snapshot_hash = graph_at(ws.owner, sc.id, v["seq"])["hash"]
    anon = Api(app_url, origin=False)
    payload_resp = anon.call("GET", f"/api/embed/{published['embedId']}")
    payload = payload_resp.json()
    assert set(payload) == {"scene", "version", "graph"} and payload["scene"] == {"name": sc.name}
    assert set(payload["version"]) == {"number", "label", "publishedAt"} and payload["version"]["label"] == "Public"
    assert graph_hash(payload["graph"]) == snapshot_hash
    for value in private:
        assert value not in payload_resp.text, value
    asset_ok = anon.call("GET", f"/api/embed/{published['embedId']}/assets/{model['id']}")
    assert asset_ok.status_code == 200 and asset_ok.content == glb()
    assert anon.call("GET", f"/api/embed/{published['embedId']}/assets/{spare['id']}").status_code == 404
    stored = S3().get(f"ws/{ws.id}/published/{published['embedId']}/scene.json").decode()
    for value in private:
        assert value not in stored, value
    export = ws.owner.ok("POST", f"/api/versions/{v['id']}/exports", status=201)
    assert export["versionId"] == v["id"]
    bundle = ws.owner.call("GET", f"/api/exports/{export['id']}")
    assert bundle.status_code == 200 and bundle.headers["content-type"].startswith("application/zip")
    assert export["bytes"] == len(bundle.content) and f"ws/{ws.id}/exports/{export['id']}.zip" in s3_keys(f"ws/{ws.id}/exports/")
    archive = zipfile.ZipFile(io.BytesIO(bundle.content))
    names = archive.namelist()
    for required in ("scene.json", f"assets/{model['id']}.glb", "viewer.html"):
        assert required in names, names
    assert [n for n in names if n.startswith("assets/") and not n.endswith("/")] == [f"assets/{model['id']}.glb"], names
    assert [n for n in names if n.rsplit("/", 1)[-1].startswith("scene")] == ["scene.json"], names
    assert graph_hash(json.loads(archive.read("scene.json"))["graph"]) == snapshot_hash
    for entry in archive.namelist():
        content = archive.read(entry).decode("utf-8", "replace")
        for value in private:
            assert value not in content, (entry, value)
    notices = [m for m in find_mail(mail, subject=f"Published: {sc.name} v{v['number']}") if ws.owner_email.lower() in to_of(m)]
    assert notices
    for notice in notices:
        body = text(notice)
        assert f"/embed/{published['embedId']}" in body
        for value in private:
            assert value not in body, value


def _schedule_ui(pg: Page, api: Api, number: int, tz: str) -> datetime:
    pg.get_by_role("button", name="Schedule publish").click()
    dialog = pg.get_by_role("dialog", name="Schedule publish")
    expect(dialog).to_contain_text(f"Time zone: {tz}", timeout=UI_MS)
    at = api.now() + timedelta(seconds=UI_PUBLISH_LEAD_S)
    wall = local(at, tz)
    fill(dialog.get_by_role("textbox", name="Publish date"), wall[:10])
    fill(dialog.get_by_role("textbox", name="Publish time"), wall[11:19])
    dialog.get_by_role("button", name="Schedule", exact=True).click()
    expect(pg.get_by_role("status", name="Editor status")).to_contain_text(f"Version {number} goes live {wall}.", timeout=UI_MS)
    return at


def test_wf_scheduled_publish_launch(browser: Browser, app_url: str, mail: Any) -> None:
    ws = Ws(app_url, tz=CHICAGO)
    viewer = ws.join(mail, "viewer")
    sc = new_scene(ws.owner, ("Body",), big=True)
    v = approved(ws.owner, viewer.api, sc.id, LAUNCH_LABEL)
    with app_page(browser, app_url, app_path("scenes", sc.id), ws.owner) as pg:
        sheet(pg)
        at = _schedule_ui(pg, ws.owner, v["number"], CHICAGO)
        expect(pg.get_by_text(version_row(v["number"], LAUNCH_LABEL, "Scheduled"))).to_be_visible(timeout=UI_MS)
        assert version_of(ws.owner, sc.id, v["id"])["publishAt"] == iso(at)
        expect(pg.get_by_text(version_row(v["number"], LAUNCH_LABEL, "Published"))).to_be_visible(timeout=(UI_PUBLISH_LEAD_S + WAIT_S) * 1000)
        pg.get_by_role("button", name="Create export").click()
        expect(pg.get_by_role("status", name="Editor status")).to_contain_text("Export ready.", timeout=UI_MS)
        with pg.expect_download() as download:
            pg.get_by_role("link", name="Download export").click()
        archive = zipfile.ZipFile(download.value.path())
        assert "scene.json" in archive.namelist() and "viewer.html" in archive.namelist()
        published = version_of(ws.owner, sc.id, v["id"])
        pg.goto(f"{app_url}/embed/{published['embedId']}")
        expect(pg.get_by_role("region", name="3D scene")).to_be_visible(timeout=UI_MS)
    assert published["state"] == "published"
    assert find_mail(mail, to=ws.owner_email, subject=f"Scheduled: {sc.name} v{v['number']} goes live {local(at, CHICAGO)}")


def test_wf_scheduled_publish_billing_down(browser: Browser, mail: Any) -> None:
    base = env_url("APP_KILLBILL_DOWN_URL")
    ws = Ws(base)
    viewer = ws.join(mail, "viewer")
    sc = new_scene(ws.owner, ("Body",))
    apply(ws.owner, sc.id, move(sc.ids["Body"], position=[1, 0, 0]))
    v = approved(ws.owner, viewer.api, sc.id, OFFLINE_LABEL)
    with app_page(browser, base, app_path("scenes", sc.id), ws.owner) as pg:
        sheet(pg)
        _schedule_ui(pg, ws.owner, v["number"], BERLIN)
        expect(pg.get_by_text(version_row(v["number"], OFFLINE_LABEL, "Published"))).to_be_visible(timeout=(UI_PUBLISH_LEAD_S + WAIT_S) * 1000)
    published = version_of(ws.owner, sc.id, v["id"])
    assert Api(base).call("GET", f"/api/embed/{published['embedId']}").status_code == 200


def _card_form(pg: Page, number: str) -> None:
    fill(pg.get_by_role("textbox", name="Card number"), number)
    fill(pg.get_by_role("textbox", name="Expiry (MM/YY)"), "12/30")
    fill(pg.get_by_role("textbox", name="CVC"), "123")


def test_wf_checkout_plans_checkout(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    ws = Ws(app_url)
    manager = ws.join(mail, "billing_manager")
    with app_page(browser, app_url, app_path("billing"), manager.api) as pg:
        pg.get_by_role("radiogroup", name="Plan").get_by_role("radio", name="Team").check()
        pg.get_by_role("radiogroup", name="Billing period").get_by_role("radio", name="Monthly").check()
        fill(pg.get_by_role("spinbutton", name="Extra seats"), "1")
        _card_form(pg, CARD["number"])
        pg.get_by_role("button", name="Start paid plan").click()
        status = pg.get_by_role("status", name="Billing status")
        expect(status).to_contain_text("A receipt is on its way.", timeout=UI_MS * 2)
        number = re.search(r"invoice (\S+)\. A receipt", status.inner_text()).group(1)
        expect(status).to_contain_text(f"Payment recorded for invoice {number}. A receipt is on its way.")
        pg.goto(app_url + app_path())
        plan_name, period_name = "Team", "monthly"
        expect(pg.get_by_role("region", name="Subscription")).to_contain_text(f"Active: {plan_name} {period_name}", timeout=UI_MS)
    billing = manager.api.ok("GET", "/api/billing")
    sub = billing["subscription"]
    assert (sub["state"], sub["plan"], sub["period"], sub["extraSeats"], sub["seatsPurchased"]) == ("active", "team", "monthly", 1, TEAM_SEATS + 1)
    assert billing["card"] == {"last4": "4242"} and CARD["number"] not in json.dumps(billing)
    invoice = next(i for i in invoices_of(manager.api)["invoices"] if str(i["number"]) == number)
    assert invoice["status"] == "paid" and invoice["balanceCents"] == 0
    purchases = kb_tx(kb_payments(killbill, ws.id), "PURCHASE")
    assert len(purchases) == 1 and invoice["amountCents"] in tx_cents(purchases[0])
    receipts = find_mail(mail, subject=receipt_subject(invoice))
    assert len(receipts) == 1 and sorted(to_of(receipts[0])) == sorted([ws.owner_email.lower(), manager.email.lower()])
    assert CARD["number"] not in text(receipts[0])


def test_wf_checkout_plans_declined(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    ws = Ws(app_url)
    with app_page(browser, app_url, app_path("billing"), ws.owner) as pg:
        pg.get_by_role("radiogroup", name="Plan").get_by_role("radio", name="Team").check()
        _card_form(pg, DECLINED_CARD)
        pg.get_by_role("button", name="Start paid plan").click()
        status = pg.get_by_role("status", name="Billing status")
        expect(status).to_contain_text("Your card was declined. Nothing was charged.", timeout=UI_MS * 2)
        assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "trial"
        assert kb_payments(killbill, ws.id) == []
        assert not mail_now(mail, to=ws.owner_email, subject=lambda s: s.startswith("Receipt for invoice "))
        _card_form(pg, CARD["number"])
        pg.get_by_role("button", name="Start paid plan").click()
        expect(status).to_contain_text("A receipt is on its way.", timeout=UI_MS * 2)
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "active"
    assert len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE")) == 1


def test_billing_idempotency(app_url: str, mail: Any, killbill: Any) -> None:
    ws = Ws(app_url)
    key = idempotency_key()
    first = checkout(ws.owner, key=key)
    assert first.status_code == 201
    replay = checkout(ws.owner, key=key)
    assert replay.status_code == 201 and replay.json() == first.json() and replay.headers.get("Idempotent-Replayed") == "true"
    conflict = checkout(ws.owner, key=key, extra=2)
    assert conflict.status_code == 409 and conflict.json() == {"error": "idempotency_key_reused"}
    blank = Ws(app_url)
    missing = blank.owner.call("POST", "/api/billing/checkout", {"plan": "team", "period": "monthly", "extraSeats": 0, "card": CARD})
    assert missing.status_code == 422 and missing.json() == {"errors": {"Idempotency-Key": "Required"}}
    assert blank.owner.ok("GET", "/api/billing")["subscription"]["state"] == "trial" and not kb_tx(kb_payments(killbill, blank.id), "PURCHASE")
    payments = kb_payments(killbill, ws.id)
    assert len(kb_tx(payments, "PURCHASE")) == 1 and kb_purchase(killbill, ws.id, f"{ws.id}:{key}")
    invoice = first.json()["invoice"]
    assert len(find_mail(mail, subject=receipt_subject(invoice), count=2, seconds=MAIL_WAIT_S / 3)) == 1
    racer = Ws(app_url)
    shared = idempotency_key()
    barrier = threading.Barrier(3)

    def go(_: int) -> httpx.Response:
        client = Api(app_url, session=racer.owner.session)
        barrier.wait()
        return checkout(client, key=shared)
    with ThreadPoolExecutor(3) as pool:
        results = list(pool.map(go, range(3)))
    fresh_answers = [r for r in results if r.status_code == 201 and r.headers.get("Idempotent-Replayed") != "true"]
    assert len(fresh_answers) == 1
    for r in results:
        if r is not fresh_answers[0]:
            assert (r.status_code == 409 and r.json() == {"error": "request_in_progress"}) or \
                   (r.status_code == 201 and r.json() == fresh_answers[0].json())
    assert len(kb_tx(kb_payments(killbill, racer.id), "PURCHASE")) == 1


def test_plan_change_proration(app_url: str, mail: Any, killbill: Any) -> None:
    ws = Ws(app_url)
    admin, editor = ws.join(mail, "admin"), ws.join(mail, "editor")
    r = ws.owner.call("POST", "/api/billing/plan", {"plan": "business", "period": "monthly"}, key=idempotency_key())
    assert r.status_code == 409 and r.json() == {"error": "subscription_not_active"}
    assert checkout(ws.owner).status_code == 201
    for person in (admin, editor):
        for method, path, body in (("POST", "/api/billing/plan", {"plan": "business", "period": "monthly"}),
                                   ("GET", "/api/billing/plan/preview?plan=business&period=monthly", _NO)):
            r = person.api.call(method, path, body, key=idempotency_key() if method == "POST" else None)
            assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    preview = ws.owner.ok("GET", "/api/billing/plan/preview?plan=business&period=monthly")
    assert preview["change"] == "immediate" and preview["amountCents"] > 0
    key = idempotency_key()
    changed = ws.owner.ok("POST", "/api/billing/plan", {"plan": "business", "period": "monthly"}, key=key)
    assert changed["change"] == "immediate" and changed["subscription"]["plan"] == "business"
    assert changed["subscription"]["seatsPurchased"] == BUSINESS_SEATS
    assert changed["invoice"]["amountCents"] == preview["amountCents"] == changed["payment"]["amountCents"]
    charge = kb_purchase(killbill, ws.id, f"{ws.id}:{key}")
    assert charge and preview["amountCents"] in tx_cents(charge)
    assert find_mail(mail, subject=receipt_subject(changed["invoice"]))
    r = ws.owner.call("POST", "/api/billing/plan", {"plan": "business", "period": "monthly"}, key=idempotency_key())
    assert r.status_code == 422 and r.json() == {"errors": {"plan": "Already on this plan"}}
    purchases = len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE"))
    down = ws.owner.ok("GET", "/api/billing/plan/preview?plan=team&period=monthly")
    assert down["change"] == "end_of_term" and down["amountCents"] == 0
    later = ws.owner.ok("POST", "/api/billing/plan", {"plan": "team", "period": "monthly"}, key=idempotency_key())
    assert later["change"] == "end_of_term" and later["subscription"]["plan"] == "business"
    assert later["subscription"]["pendingChange"]["plan"] == "team" and later["subscription"]["pendingChange"]["effectiveAt"] == later["effectiveAt"]
    assert len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE")) == purchases


def test_wf_checkout_plans_upgrade_preview(browser: Browser, app_url: str, killbill: Any) -> None:
    ws, _ = active_ws(app_url)
    plan_name, period_name = "Business", "monthly"
    with app_page(browser, app_url, app_path("billing"), ws.owner) as pg:
        pg.get_by_role("radiogroup", name="Plan").get_by_role("radio", name=plan_name).check()
        pg.get_by_role("radiogroup", name="Billing period").get_by_role("radio", name="Monthly").check()
        pg.get_by_role("button", name="Preview change").click()
        preview = pg.get_by_role("region", name="Proration preview")
        expect(preview).to_contain_text("Due today: $", timeout=UI_MS * 2)
        shown = re.search(r"Due today: (\$[\d,]+\.\d\d)", preview.inner_text()).group(1)
        api_preview = ws.owner.ok("GET", "/api/billing/plan/preview?plan=business&period=monthly")
        assert shown == dollars(api_preview["amountCents"])
        pg.get_by_role("button", name="Change plan").click()
        expect(pg.get_by_role("status", name="Billing status")).to_contain_text(
            f"Plan changed to {plan_name} {period_name}. Charged {shown}.", timeout=UI_MS * 2)
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["plan"] == "business"
    assert any(api_preview["amountCents"] in tx_cents(tx) for tx in kb_tx(kb_payments(killbill, ws.id), "PURCHASE"))


def test_seat_purchases(app_url: str, mail: Any, killbill: Any) -> None:
    ws, _ = active_ws(app_url)
    key = idempotency_key()
    up = ws.owner.ok("POST", "/api/billing/seats", {"extraSeats": 2}, key=key)
    assert up["change"] == "immediate" and up["subscription"]["seatsPurchased"] == TEAM_SEATS + 2
    assert up["invoice"]["amountCents"] == up["payment"]["amountCents"] > 0
    charge = kb_purchase(killbill, ws.id, f"{ws.id}:{key}")
    assert charge and up["invoice"]["amountCents"] in tx_cents(charge)
    assert dashboard(ws.owner)["seatsPurchased"] == TEAM_SEATS + 2
    assert find_mail(mail, subject=receipt_subject(up["invoice"]))
    r = ws.owner.call("POST", "/api/billing/seats", {"extraSeats": 2}, key=idempotency_key())
    assert r.status_code == 422 and r.json() == {"errors": {"extraSeats": "No change"}}
    assert ws.owner.call("POST", "/api/billing/seats", {"extraSeats": EXTRA_SEATS_MAX + 1}, key=idempotency_key()).status_code == 422
    purchases = len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE"))
    down = ws.owner.ok("POST", "/api/billing/seats", {"extraSeats": 1}, key=idempotency_key())
    assert down["change"] == "end_of_term" and down["subscription"]["seatsPurchased"] == TEAM_SEATS + 2
    assert down["subscription"]["pendingChange"]["extraSeats"] == 1
    assert len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE")) == purchases
    for _ in range(TEAM_SEATS + 1):
        ws.invite(fresh("seat")[1], "viewer")
    used = dashboard(ws.owner)["seatsUsed"]
    r = ws.owner.call("POST", "/api/billing/seats", {"extraSeats": 0}, key=idempotency_key())
    assert r.status_code == 409 and r.json() == {"error": "seats_in_use", "seatsUsed": used, "seatsAfter": TEAM_SEATS}


def test_billing_outage(browser: Browser, mail: Any, killbill: Any) -> None:
    base = env_url("APP_KILLBILL_DOWN_URL")
    ws = Ws(base)
    outage = {"error": "service_unavailable", "service": "billing"}
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "trial"
    key = idempotency_key()
    for _ in range(2):
        r = checkout(ws.owner, key=key)
        assert r.status_code == 503 and r.json() == outage
    for r in (ws.owner.call("GET", "/api/billing/invoices"), ws.owner.call("POST", "/api/billing/cancel", key=idempotency_key())):
        assert r.status_code == 503 and r.json() == outage
    r = webhook(base, secret_of(ws), {"id": nid("evt"), "type": "payment.failed", "workspaceId": ws.id, "paymentId": "pay_probe", "reason": "x"})
    assert r.status_code in (404, 503), r.text
    assert killbill.account_by_key(ws.id) is None
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "trial"
    sc = new_scene(ws.owner, ("Cup",))
    apply(ws.owner, sc.id, move(sc.ids["Cup"], position=[1, 0, 0]))
    ws.invite(fresh("down")[1], "viewer")
    with app_page(browser, base, app_path("billing"), ws.owner) as pg:
        pg.get_by_role("radiogroup", name="Plan").get_by_role("radio", name="Team").check()
        _card_form(pg, CARD["number"])
        pg.get_by_role("button", name="Start paid plan").click()
        copy = "Billing is unavailable right now. Nothing was charged. Editing and publishing keep working."
        expect(pg.get_by_role("status", name="Billing status")).to_contain_text(copy, timeout=UI_MS)
        expect(pg.get_by_role("status", name="Service status")).to_contain_text(copy, timeout=BANNER_S * 1000 + UI_MS)
    assert not mail_now(mail, to=ws.owner_email, subject=lambda s: s.startswith("Receipt for invoice "))


def test_payment_all_or_nothing(app_url: str, mail: Any, killbill: Any) -> None:
    down = Ws(env_url("APP_MINIO_DOWN_URL"))
    r = checkout(down.owner)
    assert r.status_code == 503 and r.json() == {"error": "service_unavailable", "service": "file_storage"}
    assert kb_tx(kb_payments(killbill, down.id), "PURCHASE") == []
    assert s3_keys(f"ws/{down.id}/") == []
    assert down.owner.ok("GET", "/api/billing")["subscription"]["state"] == "trial"
    assert not find_mail(mail, to=down.owner_email, subject=lambda s: s.startswith("Receipt for invoice "), seconds=MAIL_WAIT_S / 3)
    ws, paid = active_ws(app_url)
    invoice = paid["invoice"]
    key = f"ws/{ws.id}/invoices/{invoice['id']}.pdf"
    document = S3().get(key)
    assert document.startswith(b"%PDF-") and invoice["pdfAvailable"] is True
    served = ws.owner.call("GET", f"/api/billing/invoices/{invoice['id']}/pdf")
    assert served.status_code == 200 and served.headers["content-type"].startswith("application/pdf") and served.content == document
    assert paid["payment"]["id"] in json.dumps(kb_payments(killbill, ws.id))
    assert len(find_mail(mail, subject=receipt_subject(invoice))) == 1


def test_webhook_ledger(app_url: str, mail: Any, killbill: Any) -> None:
    ws, paid = active_ws(app_url)
    secret = secret_of(ws)
    invoice, payment = paid["invoice"], paid["payment"]
    failed = {"id": nid("evt"), "type": "payment.failed", "workspaceId": ws.id, "paymentId": payment["id"], "reason": "insufficient_funds"}
    r = webhook(app_url, secret, failed)
    assert r.status_code == 200 and r.json() == {"received": True, "duplicate": False}
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "past_due"
    reopened = next(i for i in invoices_of(ws.owner)["invoices"] if i["id"] == invoice["id"])
    assert reopened["status"] == "unpaid" and reopened["balanceCents"] == invoice["amountCents"]
    assert len(kb_tx(kb_payments(killbill, ws.id), "CHARGEBACK")) == 1
    assert webhook(app_url, secret, failed).json() == {"received": True, "duplicate": True}
    assert len(kb_tx(kb_payments(killbill, ws.id), "CHARGEBACK")) == 1
    r = webhook(app_url, secret, dict(failed, reason="other"))
    assert r.status_code == 409 and r.json() == {"error": "idempotency_key_reused"}
    r = webhook(app_url, secret, dict(failed, id=nid("evt")), signature="sha256=" + "0" * 64)
    assert r.status_code == 401 and r.json() == {"error": "invalid_signature"}
    r = webhook(app_url, secret, dict(failed, id=nid("evt"), workspaceId="ws_missing_probe"))
    assert r.status_code == 401 and r.json() == {"error": "invalid_signature"}
    assert webhook(app_url, secret, dict(failed, id=nid("evt"), type="payment.refunded")).status_code == 422
    succeeded = {"id": nid("evt"), "type": "payment.succeeded", "workspaceId": ws.id, "invoiceId": invoice["id"], "amountCents": invoice["amountCents"]}
    assert webhook(app_url, secret, dict(succeeded, id=nid("evt"), amountCents=invoice["amountCents"] + 1)).status_code == 422
    other, other_paid = active_ws(app_url)
    foreign_404(webhook(app_url, secret, dict(succeeded, id=nid("evt"), invoiceId=other_paid["invoice"]["id"])))
    foreign_404(webhook(app_url, secret, dict(succeeded, id=nid("evt"), invoiceId="inv_missing_probe")))
    r = webhook(app_url, secret, succeeded)
    assert r.json() == {"received": True, "duplicate": False}
    assert next(i for i in invoices_of(ws.owner)["invoices"] if i["id"] == invoice["id"])["status"] == "paid"
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "active"
    assert kb_purchase(killbill, ws.id, f"{ws.id}:{succeeded['id']}")
    purchases = len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE"))
    assert webhook(app_url, secret, succeeded).json() == {"received": True, "duplicate": True}
    assert webhook(app_url, secret, dict(succeeded, id=nid("evt"), amountCents=1)).json() == {"received": True, "duplicate": False}
    assert len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE")) == purchases
    assert len(find_mail(mail, subject=receipt_subject(invoice), count=3, seconds=MAIL_WAIT_S / 3)) == 2
    entries = audit(ws.owner)
    actions = [e["action"] for e in entries]
    newer_first(entries, actions.index("subscription.reactivated"), actions.index("invoice.paid"))
    newer_first(entries, actions.index("invoice.paid"), actions.index("subscription.past_due"))
    for name in ("subscription.reactivated", "invoice.paid", "subscription.past_due"):
        assert next(e for e in entries if e["action"] == name)["actor"]["kind"] == "system"


def test_refunds(app_url: str, mail: Any, killbill: Any) -> None:
    ws, paid = active_ws(app_url)
    manager = ws.join(mail, "billing_manager")
    payment, invoice = paid["payment"], paid["invoice"]
    path = f"/api/billing/payments/{payment['id']}/refund"
    key = idempotency_key()
    part = manager.api.ok("POST", path, {"amountCents": 100}, key=key)["payment"]
    assert part["refundedCents"] == 100
    replay = manager.api.call("POST", path, {"amountCents": 100}, key=key)
    assert replay.headers.get("Idempotent-Replayed") == "true" and replay.json()["payment"]["refundedCents"] == 100
    refunds = kb_tx(kb_payments(killbill, ws.id), "REFUND")
    assert len(refunds) == 1 and 100 in tx_cents(refunds[0])
    first = find_mail(mail, subject=f"Refund for invoice {invoice['number']}: {dollars(100)}")
    assert len(first) == 1 and sorted(to_of(first[0])) == sorted([ws.owner_email.lower(), manager.email.lower()])
    r = manager.api.call("POST", path, {"amountCents": payment["amountCents"]}, key=idempotency_key())
    assert r.status_code == 422 and r.json() == {"errors": {"amountCents": "More than the refundable balance"}}
    assert len(kb_tx(kb_payments(killbill, ws.id), "REFUND")) == 1
    rest = manager.api.ok("POST", path, {}, key=idempotency_key())["payment"]
    assert rest["refundedCents"] == payment["amountCents"]
    assert find_mail(mail, subject=f"Refund for invoice {invoice['number']}: {dollars(payment['amountCents'] - 100)}")
    sub = ws.owner.ok("GET", "/api/billing")["subscription"]
    assert (sub["plan"], sub["seatsPurchased"]) == ("team", TEAM_SEATS)


def _pay_invoice_ui(pg: Page, number: Any) -> None:
    _card_form(pg, CARD["number"])
    pg.get_by_role("button", name=f"Pay invoice {number}").click()


def test_wf_invoices_payments_pay_invoice(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    ws, paid = active_ws(app_url)
    manager = ws.join(mail, "billing_manager")
    invoice = paid["invoice"]
    assert fail_payment(ws, paid["payment"]["id"]).status_code == 200
    before = len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE"))
    with app_page(browser, app_url, app_path("billing"), manager.api) as pg:
        table = pg.get_by_role("table", name="Invoices")
        expect(table).to_contain_text(str(invoice["number"]), timeout=UI_MS)
        _pay_invoice_ui(pg, invoice["number"])
        expect(pg.get_by_role("status", name="Billing status")).to_contain_text(
            f"Payment recorded for invoice {invoice['number']}. A receipt is on its way.", timeout=UI_MS * 2)
        with pg.expect_download() as download:
            pg.get_by_role("link", name=f"Download invoice {invoice['number']}").click()
        assert Path(download.value.path()).read_bytes().startswith(b"%PDF-")
    assert next(i for i in invoices_of(manager.api)["invoices"] if i["id"] == invoice["id"])["status"] == "paid"
    assert len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE")) == before + 1
    to_owner = find_mail(mail, to=ws.owner_email, subject=receipt_subject(invoice), count=2)
    assert len(to_owner) == 2
    to_manager = mail_now(mail, to=manager.email, subject=receipt_subject(invoice))
    assert len(to_manager) == 1 and sorted(to_of(to_manager[0])) == sorted([ws.owner_email.lower(), manager.email.lower()])


def test_wf_invoices_payments_storage_down(browser: Browser, mail: Any, killbill: Any) -> None:
    base = env_url("APP_MINIO_DOWN_URL")
    ws = Ws(base)
    with app_page(browser, base, app_path("billing"), ws.owner) as pg:
        pg.get_by_role("radiogroup", name="Plan").get_by_role("radio", name="Team").check()
        _card_form(pg, CARD["number"])
        pg.get_by_role("button", name="Start paid plan").click()
        expect(pg.get_by_role("status", name="Service status")).to_contain_text(
            "File storage is unavailable. Your edits are saved; uploads, versions and publishing will resume when it is back.",
            timeout=BANNER_S * 1000 + UI_MS)
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "trial"
    assert kb_tx(kb_payments(killbill, ws.id), "PURCHASE") == []
    assert s3_keys(f"ws/{ws.id}/") == []
    assert not find_mail(mail, to=ws.owner_email, subject=lambda s: s.startswith("Receipt for invoice "), seconds=MAIL_WAIT_S / 3)


def test_dunning_short_clock(browser: Browser, mail: Any) -> None:
    base = env_url("APP_SHORT_CLOCK_URL")
    ws, paid = active_ws(base)
    manager = ws.join(mail, "billing_manager")
    r = fail_payment(ws, paid["payment"]["id"])
    assert r.status_code == 200
    sub = ws.owner.ok("GET", "/api/billing")["subscription"]
    assert sub["state"] == "past_due"
    grace = parse_iso(sub["graceEndsAt"])
    assert abs((grace - server_time(r)).total_seconds() - 7 * DUNNING_DAY_SHORT_S) <= CLOCK_SKEW_S
    day3 = grace - timedelta(seconds=4 * DUNNING_DAY_SHORT_S)
    day0 = find_mail(mail, subject=f"Payment failed for {ws.name}")
    day0 = [m for m in day0 if ws.owner_email.lower() in to_of(m)]
    assert day0 and all(sorted(to_of(m)) == sorted([ws.owner_email.lower(), manager.email.lower()]) for m in day0)
    assert ws.owner.call("POST", "/api/scenes", {"name": "Past due is fine"}).status_code == 201
    with app_page(browser, base, app_path(), ws.owner) as pg:
        expect(pg.get_by_role("status", name="Service status")).to_contain_text(
            f"Payment failed. Pay invoice {paid['invoice']['number']} by {local(grace, BERLIN)} to keep publishing.", timeout=UI_MS)

    def watch() -> bool:
        reminders = mail_now(mail, to=ws.owner_email, subject=f"Reminder: payment still due for {ws.name}")
        suspensions = mail_now(mail, to=ws.owner_email, subject=f"Publishing suspended for {ws.name}")
        resp = ws.owner.call("GET", "/api/billing")
        at, state = server_time(resp), resp.json()["subscription"]["state"]
        if at + timedelta(seconds=CLOCK_SKEW_S) <= day3:
            assert not reminders, "day-3 notice early"
        if at + timedelta(seconds=CLOCK_SKEW_S) <= grace:
            assert state == "past_due" and not suspensions, "suspended early"
        if at >= grace + timedelta(seconds=SCHEDULER_LAG_S + CLOCK_SKEW_S):
            assert state == "suspended", "suspension late"
        return state == "suspended" and bool(reminders) and bool(suspensions)
    poll(watch, 7 * DUNNING_DAY_SHORT_S + WAIT_S, "dunning")
    r = ws.owner.call("POST", "/api/scenes", {"name": "Suspended"})
    assert r.status_code == 402 and r.json() == {"error": "workspace_read_only"}
    entries = audit(ws.owner)
    for name in ("subscription.past_due", "subscription.suspended"):
        hits = [e for e in entries if e["action"] == name]
        assert hits and all(e["actor"]["kind"] == "system" for e in hits)


def test_failed_payment_replay(app_url: str, killbill: Any) -> None:
    ws, paid = active_ws(app_url)
    assert fail_payment(ws, paid["payment"]["id"]).json() == {"received": True, "duplicate": False}
    again = fail_payment(ws, paid["payment"]["id"])
    assert again.status_code == 200 and again.json() == {"received": True, "duplicate": False}
    assert len(kb_tx(kb_payments(killbill, ws.id), "CHARGEBACK")) == 1
    assert len([e for e in audit(ws.owner) if e["action"] == "subscription.past_due"]) == 1


def test_suspended_cancelled_read_only(app_url: str, mail: Any) -> None:
    ws = Ws(app_url)
    viewer, manager, target = ws.join(mail, "viewer"), ws.join(mail, "billing_manager"), ws.join(mail, "editor")
    sc = new_scene(ws.owner, ("Cup",))
    cup = sc.ids["Cup"]
    published = go_live(ws.owner, viewer.api, sc.id)
    draft = ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Draft"}, 201)
    pending = approved(ws.owner, viewer.api, sc.id, "Pending")
    comment = viewer.api.ok("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": cup, "body": "Note", "mentions": []}, 201)
    token = ws.token("read")
    invite = ws.invite(fresh("pending")[1], "viewer")
    apply(ws.owner, sc.id, move(cup, position=[1, 0, 0]))
    r = manager.api.call("POST", "/api/billing/cancel", key=idempotency_key())
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    assert ws.owner.ok("POST", "/api/billing/cancel", key=idempotency_key())["subscription"]["state"] == "cancelled"
    blocked = [("POST", "/api/scenes", {"name": "x"}), ("POST", f"/api/scenes/{sc.id}/ops", {"ops": [move(cup, position=[2, 0, 0])]}),
               ("POST", f"/api/scenes/{sc.id}/undo", _NO), ("POST", f"/api/scenes/{sc.id}/restore", {"toSeq": 0}),
               ("POST", f"/api/scenes/{sc.id}/locks/{cup}/takeover", _NO), ("POST", f"/api/scenes/{sc.id}/versions", {"label": "x"}),
               ("POST", f"/api/versions/{draft['id']}/submit", _NO),
               ("POST", f"/api/versions/{pending['id']}/schedule", {"publishAt": iso(ws.owner.now() + timedelta(seconds=DAY_S))}),
               ("POST", f"/api/versions/{published['id']}/exports", _NO),
               ("POST", f"/api/versions/{draft['id']}/review-links", {"expiresAt": iso(ws.owner.now() + timedelta(seconds=DAY_S))}),
               ("POST", f"/api/scenes/{sc.id}/comments", {"nodeId": cup, "body": "x", "mentions": []}),
               ("PATCH", f"/api/comments/{comment['id']}", {"resolved": True}),
               ("POST", "/api/members/invites", {"email": fresh("x")[1], "role": "viewer"}),
               ("POST", "/api/agent-tokens", {"name": "x", "scope": "read", "expiresAt": iso(ws.owner.now() + timedelta(seconds=DAY_S))})]
    for method, path, body in blocked:
        r = ws.owner.call(method, path, body)
        assert r.status_code == 402 and r.json() == {"error": "workspace_read_only"}, (path, r.text)
    r = viewer.api.call("POST", f"/api/versions/{pending['id']}/approve")
    assert r.status_code == 402
    assert upload(ws.owner, "model", "chair.glb", glb()).status_code == 402
    for path in ("/api/scenes", f"/api/scenes/{sc.id}", "/api/billing", "/api/members"):
        assert ws.owner.call("GET", path).status_code == 200
    gone = Api(app_url).call("GET", f"/api/embed/{published['embedId']}")
    assert gone.status_code == 410 and gone.json() == {"error": "gone"}
    assert ws.owner.call("POST", f"/api/scenes/{sc.id}/presence", {"selection": cup, "cursor": [0.5, 0.5]}).status_code == 204
    release(ws.owner, sc.id, cup)
    ws.owner.ok("DELETE", f"/api/members/{target.id}", status=204)
    ws.owner.ok("DELETE", f"/api/members/invites/{invite['id']}", status=204)
    ws.owner.ok("DELETE", f"/api/agent-tokens/{token.id}", status=204)
    ws.owner.ok("PATCH", "/api/workspace", {"timeZone": CHICAGO})
    assert ws.owner.ok("POST", f"/api/versions/{published['id']}/withdraw")["state"] == "withdrawn"
    second = login(app_url, viewer.email)
    assert second.call("POST", "/api/auth/logout").status_code == 204
    _transition_error(checkout(ws.owner), "cancelled", "active")
    _transition_error(ws.owner.call("POST", "/api/billing/cancel", key=idempotency_key()), "cancelled", "cancelled")
    assert len([e for e in audit(ws.owner) if e["action"] == "subscription.cancelled"]) == 1


def test_wf_dunning_cancel_ui(browser: Browser, app_url: str) -> None:
    ws, _ = active_ws(app_url)
    with app_page(browser, app_url, app_path("billing"), ws.owner) as pg:
        pg.get_by_role("button", name="Cancel subscription").first.click()
        dialog = pg.get_by_role("alertdialog", name="Cancel subscription")
        dialog.get_by_role("button", name="Keep subscription").click()
        expect(dialog).to_be_hidden(timeout=UI_MS)
        assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "active"
        pg.get_by_role("button", name="Cancel subscription").first.click()
        dialog.get_by_role("button", name="Cancel subscription").click()
        expect(pg.get_by_role("status", name="Billing status")).to_contain_text(
            "Subscription cancelled. The workspace is now read-only.", timeout=UI_MS * 2)
        expect(pg.get_by_role("status", name="Service status")).to_contain_text(
            "This subscription is cancelled. The workspace is read-only.", timeout=BANNER_S * 1000 + UI_MS)
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "cancelled"
    assert ws.owner.call("POST", "/api/scenes", {"name": "x"}).status_code == 402


def test_wf_dunning_recover(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    ws, paid = active_ws(app_url)
    manager = ws.join(mail, "billing_manager")
    invoice = paid["invoice"]
    assert fail_payment(ws, paid["payment"]["id"]).status_code == 200
    grace = ws.owner.ok("GET", "/api/billing")["subscription"]["graceEndsAt"]
    banner = f"Payment failed. Pay invoice {invoice['number']} by {local(grace, BERLIN)} to keep publishing."
    with app_page(browser, app_url, app_path(), manager.api) as pg:
        status = pg.get_by_role("status", name="Service status")
        expect(status).to_contain_text(banner, timeout=UI_MS)
        pg.goto(app_url + app_path("billing"))
        _pay_invoice_ui(pg, invoice["number"])
        expect(pg.get_by_role("status", name="Billing status")).to_contain_text(
            f"Payment recorded for invoice {invoice['number']}.", timeout=UI_MS * 2)
        expect(status).not_to_contain_text("Payment failed.", timeout=BANNER_S * 1000 + UI_MS)
    assert ws.owner.ok("GET", "/api/billing")["subscription"]["state"] == "active"
    assert len(kb_tx(kb_payments(killbill, ws.id), "PURCHASE")) == 2
    assert len(find_mail(mail, subject=receipt_subject(invoice), count=2)) == 2
    entries = audit(ws.owner)
    paid_idx = next(i for i, e in enumerate(entries) if e["action"] == "invoice.paid")
    back_idx = next(i for i, e in enumerate(entries) if e["action"] == "subscription.reactivated")
    newer_first(entries, back_idx, paid_idx)
    assert entries[paid_idx]["actor"]["name"] == manager.name and entries[back_idx]["actor"]["kind"] == "system"


def test_wf_cross_cutting_health(app_url: str) -> None:
    for base in (app_url, env_url("APP_KILLBILL_DOWN_URL"), env_url("APP_MINIO_DOWN_URL"), env_url("APP_SHORT_CLOCK_URL")):
        r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert r.headers["content-type"].startswith("application/json")


def test_server_boundary(app_url: str) -> None:
    ws = Ws(app_url)
    host = urlsplit(app_url).netloc
    evil = "http://evil.example"
    r = ws.owner.call("POST", "/api/scenes", {"name": "Cross"}, headers={"Origin": evil})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    assert "Cross" not in [s["name"] for s in ws.owner.ok("GET", "/api/scenes")["scenes"]]
    plain = Api(app_url, session=ws.owner.session, origin=False)
    assert plain.call("POST", "/api/scenes", {"name": "No origin"}).status_code == 201
    r = ws.owner.call("POST", "/api/scenes", {"name": "Proxied"}, headers={"Origin": f"https://{host}", "X-Forwarded-Proto": "https"})
    assert r.status_code == 201
    for method in ("GET", "OPTIONS"):
        resp = httpx.request(method, app_url + "/api/health", headers={"Origin": evil, "Access-Control-Request-Method": "POST"}, timeout=HTTP_TIMEOUT_S)
        assert CORS_ALLOW_ORIGIN not in resp.headers
    body = lambda size: b'{"name":"' + b"a" * (size - 11) + b'"}'
    json_headers = {"Content-Type": "application/json"}
    r = ws.owner.call("POST", "/api/scenes", content=body(BODY_LIMIT + 1), headers=json_headers)
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large", "limitBytes": BODY_LIMIT}
    assert ws.owner.call("POST", "/api/scenes", content=body(BODY_LIMIT), headers=json_headers).status_code != 413
    r = ws.owner.call("POST", "/api/scenes", content=body(BODY_LIMIT + 1), headers={**json_headers, "Origin": evil})
    assert r.status_code == 413
    r = ws.owner.call("POST", "/api/assets", content=b"x" * (ASSET_BODY_LIMIT + 1), headers={"Content-Type": "multipart/form-data; boundary=zz"})
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large", "limitBytes": ASSET_BODY_LIMIT}
    r = ws.owner.call("PUT", "/api/versions/v_probe/thumbnail", content=b"x" * (BODY_LIMIT + 1), headers={"Content-Type": "image/png"})
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large", "limitBytes": BODY_LIMIT}
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts", "/server/index.ts"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "POCKETBASE_ADMIN_PASSWORD", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "DATABASE_URL")]
    secrets = [s for s in secrets if len(s) >= 6 and not s.isalpha()]
    agent = ws.token("read")
    texts = [ws.owner.call("GET", p).text for p in ("/", app_path(), "/api/me", "/api/agent-tokens", "/api/billing")]
    for page in ("/", app_path()):
        for src in re.findall(r'src="([^"]+\.js)"', httpx.get(app_url + page, timeout=HTTP_TIMEOUT_S).text):
            texts.append(httpx.get(app_url.rstrip("/") + "/" + src.lstrip("/"), timeout=HTTP_TIMEOUT_S).text)
    blob = "\n".join(texts)
    for secret in secrets + [agent.secret, PASSWORD]:
        assert secret not in blob


@pytest.mark.parametrize("viewport_id", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_wf_cross_cutting_responsive(browser: Browser, app_url: str, mail: Any, viewport_id: str) -> None:
    size = VIEWPORTS[viewport_id]
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",))
    _, email = fresh("layout")
    ws.invite(email, "viewer")
    token = invite_token(mail, email)
    version = ws.owner.ok("POST", f"/api/scenes/{sc.id}/versions", {"label": "Layout"}, 201)
    link = ws.owner.ok("POST", f"/api/versions/{version['id']}/review-links", {"expiresAt": iso(ws.owner.now() + timedelta(seconds=DAY_S))}, 201)
    public = {"/": ("heading", "3D scenes your whole team can trace"), "/pricing": ("radiogroup", "Billing period"),
              "/signup": ("form", "Start your trial"), "/login": ("form", "Sign in"), f"/invite/{token}": ("form", "Join workspace"),
              f"/review/{link['token']}": ("listbox", "States")}
    signed_in = {app_path(): ("region", "Seats"), app_path("scenes"): ("searchbox", "Search scenes"), app_path("scenes", sc.id): ("tree", "Scene hierarchy"),
                 app_path("members"): ("button", "Invite member"), app_path("agents"): ("button", "Issue token"), app_path("audit"): ("navigation", "Workspace"),
                 app_path("billing"): ("radiogroup", "Plan"), app_path("settings"): ("switch", "Allow review links")}

    def fits(pg: Page, ready: dict[str, tuple[str, str]]) -> None:
        for path, (role, name) in ready.items():
            started = time.monotonic()
            pg.goto(app_url + path)
            expect(pg.get_by_role(role, name=name, include_hidden=True).first).to_be_attached(timeout=UI_MS)
            if path == "/" and size == DESKTOP:
                expect(pg.get_by_role(role, name=name)).to_be_visible()
                assert time.monotonic() - started <= HOME_BUDGET_S
            layout(pg)
    with app_page(browser, app_url, None, size=size) as pg:
        fits(pg, public)
    with app_page(browser, app_url, None, ws.owner, size=size) as pg:
        fits(pg, signed_in)
        pg.goto(app_url + app_path())
        tiles = [pg.get_by_role("region", name=n) for n in ("Seats", "Subscription", "Scenes", "Agent tokens")]
        expect(tiles[0]).to_be_visible(timeout=UI_MS)
        boxes = [t.bounding_box() for t in tiles]
        if size == DESKTOP:
            assert max(b["y"] for b in boxes) - min(b["y"] for b in boxes) <= 2 and [b["x"] for b in boxes] == sorted(b["x"] for b in boxes)
        elif size == TABLET:
            assert abs(boxes[0]["y"] - boxes[1]["y"]) <= 2 and boxes[2]["y"] >= boxes[0]["y"] + boxes[0]["height"] - 2
        else:
            for upper, lower in zip(boxes, boxes[1:]):
                assert lower["y"] >= upper["y"] + upper["height"] - 2
            expect(pg.get_by_role("navigation", name="Workspace").get_by_role("link", name="Scenes")).to_be_hidden()
        started = time.monotonic()
        pg.goto(app_url + app_path("scenes", sc.id))
        expect(viewport(pg)).to_be_visible(timeout=UI_MS)
        slider = pg.get_by_role("slider", name="Operation log").bounding_box()
        view = viewport(pg).bounding_box()
        if size == PHONE:
            for tab in ("Hierarchy", "Inspector", "Comments", "Versions"):
                expect(pg.get_by_role("tab", name=tab)).to_be_visible()
            assert view["y"] < slider["y"]
        else:
            tree = pg.get_by_role("tree", name="Scene hierarchy")
            expect(tree).to_be_visible()
            expect(pg.get_by_role("region", name="Inspector")).to_be_visible()
            if size == DESKTOP:
                assert time.monotonic() - started <= EDITOR_BUDGET_S
            t, i = tree.bounding_box(), pg.get_by_role("region", name="Inspector").bounding_box()
            if size == DESKTOP:
                assert t["x"] < view["x"] < i["x"]
            else:
                assert view["y"] + view["height"] <= min(t["y"], i["y"]) + 2
                assert t["x"] + t["width"] <= i["x"] + 2
                assert t["y"] < i["y"] + i["height"] and i["y"] < t["y"] + t["height"]
            assert slider["y"] >= max(t["y"] + t["height"], view["y"] + view["height"]) - 2


def test_interface_motion(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",))
    with app_page(browser, app_url, app_path("scenes"), ws.owner) as pg:
        button = pg.get_by_role("button", name="New scene")
        expect(button).to_be_visible(timeout=UI_MS)
        props = ("background-color", "color", "border-color", "box-shadow")
        rest, hover = state_styles(button, *props)
        assert rest != hover
        durations = [float(d.strip()[:-2]) if d.strip().endswith("ms") else float(d.strip()[:-1]) * 1000
                     for d in style(button, "transition-duration")["transition-duration"].split(",")]
        assert max(durations) <= HOVER_MAX_MS
        rest, focus = state_styles(button, "outline-style", "outline-width", "outline-color", "box-shadow", state="focus")
        assert rest != focus
        assert pg.evaluate(LOOPS_JS) == []
        box = button.bounding_box()
        pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        pg.mouse.down()
        pressed = button.bounding_box()
        assert 0.5 <= pressed["y"] - box["y"] <= 1.5
        pg.evaluate(RECORD_JS)
        pg.mouse.up()
        dialog = pg.get_by_role("dialog", name="New scene")
        expect(dialog).to_be_visible(timeout=UI_MS)
        entering = dialog.evaluate(MOTION_FOR_JS)
        assert entering and all(0 < m["d"] <= DIALOG_IN_MAX_MS for m in entering), entering
        handle = dialog.element_handle()
        pg.evaluate("() => { window.__motion = []; }")
        pg.keyboard.press("Escape")
        expect(dialog).to_be_hidden(timeout=UI_MS)
        leaving = pg.evaluate(MOTION_FOR_JS, handle)
        assert leaving and all(0 < m["d"] <= DIALOG_OUT_MAX_MS for m in leaving), leaving
        button.click()
        fill(dialog.get_by_role("textbox", name="Scene name"), "Busy")
        create = dialog.get_by_role("button", name="Create scene")
        with held(pg, "**/api/scenes") as gate:
            create.click()
            expect(create).to_be_disabled(timeout=UI_MS)
            loops = pg.evaluate(LOOPS_JS)
            assert loops and all(BUSY_MIN_MS <= d <= BUSY_MAX_MS for d in loops), loops
            gate.release()
        pg.goto(app_url + app_path("scenes", sc.id))
        expect(pg.get_by_role("tree", name="Scene hierarchy")).to_be_visible(timeout=UI_MS)
        assert pg.evaluate(LOOPS_JS) == []
    with app_page(browser, app_url, app_path("scenes"), ws.owner, reduced=True) as pg:
        pg.evaluate(RECORD_JS)
        pg.get_by_role("button", name="New scene").click()
        dialog = pg.get_by_role("dialog", name="New scene")
        expect(dialog).to_be_visible(timeout=UI_MS)
        assert not [m for m in dialog.evaluate(MOTION_FOR_JS) if "transform" in m["kf"]]
        fill(dialog.get_by_role("textbox", name="Scene name"), "Calm")
        with held(pg, "**/api/scenes") as gate:
            dialog.get_by_role("button").filter(has_text=re.compile("Create scene")).click()
            expect(dialog.get_by_text("Working…")).to_be_visible(timeout=UI_MS)
            assert pg.evaluate(LOOPS_JS) == []
            gate.release()


APP_ROOT = Path("/app")
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1", "CC0-1.0"}


def _shipped() -> list[tuple[str, str, Any]]:
    cwd = APP_ROOT if (APP_ROOT / "node_modules").exists() else Path(DEPLOYED_APP)
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd, capture_output=True, text=True, timeout=600)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple[str, str], Any] = {}

    def walk(deps: dict) -> None:
        for name, info in (deps or {}).items():
            if info.get("missing") or not info.get("version"):
                continue
            found.setdefault((name, str(info.get("version", ""))), info.get("license"))
            walk(info.get("dependencies", {}))
    walk(tree.get("dependencies", {}))
    return [(n, v, lic) for (n, v), lic in found.items()]


def _licence_ok(value: Any) -> bool:
    if isinstance(value, dict):
        value = value.get("type")
    if not isinstance(value, str):
        return False
    expr = value.replace("(", "").replace(")", "").strip()
    return any(all(part.strip() in ALLOWED_LICENCES for part in option.split(" AND ")) for option in expr.split(" OR "))


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name, _, _ in _shipped() if name not in notices]
    assert not missing, missing[:20]
    for font in ("Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices, font


def test_if_licences_allowed() -> None:
    shipped = _shipped()
    assert shipped
    bad = [(n, v, lic) for n, v, lic in shipped if not _licence_ok(lic)]
    assert not bad, bad[:20]


def test_if_datastores() -> None:
    lock = json.loads((APP_ROOT / "package-lock.json").read_text())
    names = [k.rsplit("node_modules/", 1)[-1].lower() for k in lock.get("packages", {})]
    assert not [n for n in names if any(store.lower() in n for store in DATASTORE_PACKAGES)]
    suffixes = (".sqlite", ".sqlite3", ".db", ".rdb")
    stray = [p for p in APP_ROOT.rglob("*") if p.suffix.lower() in suffixes and "node_modules" not in p.parts and ".git" not in p.parts]
    assert not stray, stray[:10]


def test_if_service_config(killbill: Any, mail: Any) -> None:
    assert isinstance(PocketBase().collections(), list)
    assert isinstance(S3().keys(""), list)
    assert killbill.account_by_key(nid("probe")) is None
    assert isinstance(mail.messages(settle=0), list)


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    ws = Ws(app_url)
    sc = new_scene(ws.owner, ("Cup",))
    origin = Api(app_url).origin
    with app_page(browser, app_url, None, ws.owner) as pg:
        urls: list[str] = []
        pg.on("request", lambda req: urls.append(req.url))
        for path in ("/", "/pricing", "/signup", "/app", f"/app/scenes/{sc.id}"):
            pg.goto(app_url + path)
            pg.wait_for_load_state("load")
        foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, origin)]
        assert not foreign, foreign[:10]


def test_if_typescript_strict() -> None:
    assert (APP_ROOT / "package-lock.json").is_file()
    sources = [p for p in APP_ROOT.rglob("*.ts*") if "node_modules" not in p.parts and p.suffix in (".ts", ".tsx")]
    assert sources
    configs = [p for p in APP_ROOT.glob("tsconfig*.json")]
    assert configs

    def strip_comments(raw: str) -> str:
        out: list[str] = []
        i, n, in_str = 0, len(raw), False
        while i < n:
            ch = raw[i]
            nxt = raw[i + 1] if i + 1 < n else ""
            if in_str:
                out.append(ch)
                if ch == "\\" and nxt:
                    out.append(nxt)
                    i += 2
                    continue
                if ch == '"':
                    in_str = False
                i += 1
                continue
            if ch == '"':
                in_str = True
                out.append(ch)
                i += 1
                continue
            if ch == "/" and nxt == "/":
                end = raw.find("\n", i)
                i = n if end < 0 else end
                continue
            if ch == "/" and nxt == "*":
                end = raw.find("*" + "/", i + 2)
                i = n if end < 0 else end + 2
                continue
            out.append(ch)
            i += 1
        return "".join(out)

    def strict(path: Path, seen: int = 0) -> bool:
        raw = strip_comments(path.read_text())
        data = json.loads(re.sub(r",(\s*[}\]])", r"\1", raw))
        if data.get("compilerOptions", {}).get("strict") is True:
            return True
        parent = data.get("extends")
        return bool(parent) and seen < 5 and (path.parent / parent).is_file() and strict(path.parent / parent, seen + 1)
    assert any(strict(p) for p in configs)
