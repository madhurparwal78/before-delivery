from __future__ import annotations

import base64
import functools
from html import unescape
import hashlib
import json
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
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from datetime import time as clock_time
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit
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
    click,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    select,
    shipped_packages,
    text,
    unique,
)


HTTP_TIMEOUT = 120
MAIL_WAIT_S = 90
UI_WAIT_S = 150
UI_MS = 30000
CHECK_MS = 300
STEP_MS = 250
SAMPLE_MS = 50
COPY_BOOT_S = 240
SWEEP_WAIT_S = 240
SHORT_TTL_S = 5
PREVIEW_TTL_S = 30
EMAIL_MAX = 254
GRACE_LONG_S = 172800
RETENTION_S = 10
SWEEP_MAX_S = 60

PASSWORD = "field-test-pass-01"
PASSPHRASE = "tidewrack quay vault phrase"
TZ = "Europe/Lisbon"
OPS_EMAIL = "ops@tidewrack.example"
OPS_PASSWORD = "cairn-ops-7731-dev"
INES_EMAIL = "ines.marlow@casefile.example"

APPROVAL_DETECT_MS = 5000
UNLOCK_MS = 5000
PULL_INTERVAL_MS = 15000
RETRY_MS = 10000
SAVE_SETTLE_MS = 2000
CROSSING_MAX_MS = 1000

MIN_ENVELOPE = 32
MAX_ENVELOPE = 2000000
API_LIMIT = 1000000
PUSH_LIMIT = 4000000
PREVIEW_LIMIT = 5000000
PBKDF2_ITERATIONS = 600000
MAX_CANDIDATES = 500
SYNC_GRACE_DAYS = 7
TAKEDOWN_DAYS = 14
WARNING_DAYS = 3
PARALLEL = 8

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
VIEWPORTS = {"375": PHONE, "768": TABLET, "1280": DESKTOP}
VIEWPORT_IDS = ["375", "768", "1280"]

HOP_COUNTS = {0: (1, 4), 1: (4, 6), 2: (7, 4), 3: (9, 4), 4: (10, 3)}
SLIDE_SETTLE_MS = 500
TAB_BUDGET = 150
RING_MARGIN = 8
PEEK_RATIO = 0.25
ACTIVE_TAGS = {"img", "iframe", "object", "embed", "style", "svg", "math", "frame", "base", "video", "audio"}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Unlicense", "BlueOak-1.0.0", "SIL OFL 1.1", "OFL-1.1"}
TEST_DIRS = {"test", "tests", "__tests__", "e2e", "fixtures", "spec"}
SQLITE_HEADER = b"SQLite format 3\x00"
LICENCE_SPELLINGS = {"mit license": "MIT", "isc license": "ISC", "bsd": "BSD-3-Clause", "new bsd": "BSD-3-Clause",
                     "simplified bsd": "BSD-2-Clause", "apache 2.0": "Apache-2.0", "apache-2": "Apache-2.0",
                     "apache license 2.0": "Apache-2.0", "apache license, version 2.0": "Apache-2.0",
                     "the unlicense": "Unlicense", "ofl": "OFL-1.1", "sil ofl": "OFL-1.1"}
LICENCE_MARKERS = ("permission is hereby granted, free of charge", "permission to use, copy, modify, and/or distribute",
                   "apache license\n", "version 2.0, january 2004", "redistribution and use in source and binary forms",
                   "free and unencumbered software released into the public domain", "blue oak model license",
                   "sil open font license")
DENIED_MARKERS = ("gnu general public license", "gnu lesser general public license", "gnu affero general public license",
                  "mozilla public license", "server side public license", "business source license",
                  "attribution-noncommercial")
BOUNDARY_CASES = ["content_type", "cross_origin", "api_body_limit", "push_body_limit", "preview_body_limit", "source_files"]
SOURCE_PROBES = ["/run.json", "/package.json", "/package-lock.json", "/.env", "/.git/config", "/tsconfig.json", "/src/server.ts"]
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")

FIELD_LAPTOP = "field laptop"
FIELD_PHONE = "field phone"
HARBOUR_PHONE = "harbour phone"
PIER_PHONE = "pier phone"
LATE_PHONE = "late phone"
STUDIO_LAPTOP = "studio laptop"
OWNER_LAPTOP = "owner laptop"
FORBIDDEN_STORES = ("SQLite", "Redis")

COUNTS_COPY = "notes public <N> · links severed <M>"
ANNOUNCE_COPY = "Hop <h>: <N> notes public, <M> links severed"
MATCH_COPY = "Server boundary matches: <N> public · <M> severed"
CONFIRM_COPY = "Publish <N> notes and cut <M> links?"
PUBLISHED_COPY = "Published <N> notes · <M> links severed"
HOP_NAME = "Hop <h>"
NODE_PUBLIC = "<title>, hop <h>, public"
NODE_OUTSIDE = "<title>, hop <h>, outside"
CUT_NAME = "Cut link <n>"
PAUSED_COPY = "sync paused: storage unavailable — <n> queued"
CONFLICT_TITLE = "<original title> (conflict copy, <device name>)"
INVITE_CREATED = "Invite created — an email is on its way to <email>"
INVITE_ACCEPTED = "You've joined the vault. Enter the vault passphrase from <inviter> to unlock it."
RESTORE_BUTTON = "Restore r<rev>"
RESTORE_ASK = "Restore r<rev> as a new revision?"
RESTORED_COPY = "Restored r<rev> as r<new>"
REV_LABEL = "r<rev>"
RESTORED_FROM = "restored from r<rev>"
SIGNED_IN = "Signed in as <email>"
LAPSE_DONE = "Lapse check done: <w> warnings sent, <t> dossiers taken down"
SYNC_ENDS = "Sync ends <when>"
NO_RESULTS = "No published notes match <q>."


def fill_copy(template: str, values: dict[str, Any]) -> str:
    for key, value in values.items():
        template = template.replace(f"<{key}>", str(value))
    return template


def copy_regex(template: str, values: dict[str, Any] | None = None, anchored: bool = True,
               raw: dict[str, str] | None = None) -> re.Pattern:
    pattern = re.escape(template)
    for key, value in (values or {}).items():
        pattern = pattern.replace(f"<{key}>", re.escape(str(value)))
    for key, value in (raw or {}).items():
        pattern = pattern.replace(f"<{key}>", value)
    pattern = re.sub(r"<[A-Za-z ]+>", lambda _: r"(\d+)", pattern)
    return re.compile(f"^{pattern}$" if anchored else pattern)


def counts_copy(n: int, m: int) -> str:
    return fill_copy(COUNTS_COPY, {"N": n, "M": m})


def match_copy(n: int, m: int) -> str:
    return fill_copy(MATCH_COPY, {"N": n, "M": m})


def announce_copy(hop: int) -> str:
    n, m = HOP_COUNTS[hop]
    return fill_copy(ANNOUNCE_COPY, {"h": hop, "N": n, "M": m})


def hop_name(hop: int) -> str:
    return fill_copy(HOP_NAME, {"h": hop})


def node_name(template: str, title: str, hop: int) -> str:
    return fill_copy(template, {"title": title, "h": hop})


def slug_of(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")

ROOT_TITLE = "Port Ellery fuel contracts"
SAMPLE = [
    ("N0", "Port Ellery fuel contracts", [], {"case": "PE-2026-03"}, False,
     "# What we found\n\nThe 2025 fuel tender is laid out in [[Tender timeline 2025]]. The winning bidder was [[Saltmarsh Logistics]], confirmed by the [[Tender award letter]]. Pricing was checked with [[Harbour pilot, Vigo|a harbour pilot]]."),
    ("N1", "Tender timeline 2025", [], {}, False,
     "- 3 March: tender opens, run by [[Mara Quint]].\n- 28 March: board approves, see [[Board minutes, March]]."),
    ("N2", "Saltmarsh Logistics", ["Saltmarsh"], {}, False,
     "Registered in Port Ellery. Fuel is supplied through [[Ellery Bunkering SA]]. Tender contact: [[Mara Quint]]."),
    ("N3", "Tender award letter", [], {}, False,
     "Approval recorded in [[Board minutes, March]]; summary in [[Port Ellery fuel contracts]].\n\nPasted from the scraped portal:\n\n<script>alert('x')</script>\n\n<img src=\"x\" onerror=\"alert('x')\">\n\n[portal copy](javascript:alert('x')) and [registry](https://registry.example/filing/2291)"),
    ("N4", "Mara Quint", ["M. Quint"], {"role": "procurement officer"}, False,
     "Ran the tender. Reports to [[D. Hallam]]. Bid sheet came from [[Procurement clerk]]."),
    ("N5", "Board minutes, March", [], {}, False, "The board approved the award. [[M. Quint]] presented."),
    ("N6", "Ellery Bunkering SA", [], {}, False, "Filing history in [[Registry filing 2024]]."),
    ("N7", "D. Hallam", [], {}, False, "Director. Also sits on [[Northgate Holdings]]."),
    ("N8", "Registry filing 2024", [], {}, False, "Lists [[Northgate Holdings]] as majority owner."),
    ("N9", "Northgate Holdings", [], {}, False, "Parent company. Unconfirmed: [[Offshore account lead]]."),
    ("N10", "Offshore account lead", ["Cayman lead"], {"status": "unverified tip-off"}, False, "Tip received by phone. Do not publish."),
    ("P1", "Harbour pilot, Vigo", ["Pilot V."], {"contact": "signal only"}, True,
     "Met twice at the marina. Confirms [[Ellery Bunkering SA]] delivery volumes."),
    ("P2", "Procurement clerk", ["Clerk K."], {}, True, "Handed over the bid sheet. Links to [[Northgate Holdings]]."),
    ("N11", "Call log scratch", [], {}, False, "Unanswered calls to the registry office."),
]
TITLES = {key: title for key, title, *_ in SAMPLE}
HOPS = {"N0": 0, "N1": 1, "N2": 1, "N3": 1, "N4": 2, "N5": 2, "N6": 2, "N7": 3, "N8": 3, "N9": 4}
PAGE_SLUGS = {"N1": "tender-timeline-2025", "N2": "saltmarsh-logistics", "N3": "tender-award-letter",
              "N4": "mara-quint", "N5": "board-minutes-march", "N6": "ellery-bunkering-sa",
              "N7": "d-hallam", "N8": "registry-filing-2024", "N9": "northgate-holdings"}
NEVER_PUBLIC = ["Harbour pilot, Vigo", "Pilot V.", "signal only", "Procurement clerk", "Clerk K.",
                "Offshore account lead", "Cayman lead", "unverified tip-off", "Call log scratch"]


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, headers={"Origin": origin_of(self.base)},
                                 timeout=HTTP_TIMEOUT, follow_redirects=False)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.get(path, **kw)

    def post(self, path: str, body: Any = None, key: str | None = None, **headers: str) -> httpx.Response:
        if key is not None:
            headers["Idempotency-Key"] = key
        if body is None:
            return self.http.post(path, headers=headers)
        return self.http.post(path, json=body, headers=headers)

    def raw(self, method: str, path: str, content: bytes, **headers: str) -> httpx.Response:
        return self.http.request(method, path, content=content, headers=headers)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)


@dataclass
class Acct:
    api: Api
    email: str
    name: str
    account: dict
    device: dict
    base: str


def ids_pair(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    email = first if "@" in first else second
    name = second if email == first else first
    if "@" not in email:
        email = f"{first}@casefile.example"
    return (name or prefix)[:40], email


def assert_error(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code}: {r.text[:500]}"
    err = r.json()["error"]
    assert err["code"] == code, r.text[:500]
    assert isinstance(err.get("message"), str)
    return err


def assert_field(r: httpx.Response, field: str) -> None:
    err = assert_error(r, 422, "validation_failed")
    assert field in err.get("fields", {}), r.text[:500]


def extra(r: httpx.Response, key: str) -> Any:
    body = r.json()
    return body["error"].get(key, body.get(key))


def create_account(base: str, prefix: str = "acct", tz: str = TZ, device: str = FIELD_LAPTOP) -> Acct:
    name, email = ids_pair(prefix)
    api = Api(base)
    r = api.post("/api/accounts", {"email": email, "password": PASSWORD, "display_name": name,
                                   "time_zone": tz, "device_name": device})
    assert r.status_code == 201, r.text
    body = r.json()
    return Acct(api, email, name, body["account"], body["device"], base)


def sign_in(base: str, acct: Acct, device_id: str | None, device: str = "field phone") -> Api:
    api = Api(base)
    r = api.post("/api/sessions", {"email": acct.email, "password": PASSWORD, "device_name": device,
                                   "device_id": device_id})
    assert r.status_code == 200, r.text
    return api


def subscribe(acct: Acct, addon: str) -> dict:
    r = acct.api.post("/api/billing/subscriptions", {"addon": addon})
    assert r.status_code == 201, r.text
    return r.json()


def cancel_addon(api: Api, addon: str) -> httpx.Response:
    return api.delete(f"/api/billing/subscriptions/{addon}")


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def envelope() -> dict:
    return {"salt": b64(os.urandom(16)), "iterations": PBKDF2_ITERATIONS, "iv": b64(os.urandom(12)),
            "wrapped_key": b64(os.urandom(48))}


def create_vault(api: Api, name: str | None = None) -> str:
    r = api.post("/api/vaults", {"name": name or f"Case vault {uuid.uuid4().hex[:6]}", "key_envelope": envelope()})
    assert r.status_code == 201, r.text
    return r.json()["vault"]["id"]


def sync_owner(base: str, prefix: str = "sync") -> tuple[Acct, str]:
    acct = create_account(base, prefix)
    subscribe(acct, "sync")
    return acct, create_vault(acct.api)


def blob(size: int = 64) -> bytes:
    return b"CRN1" + os.urandom(12) + os.urandom(size - 16)


def push_body(data: bytes, base: int | None) -> dict:
    return {"base_revision": base, "ciphertext": b64(data), "ciphertext_sha256": hashlib.sha256(data).hexdigest()}


def push(api: Api, vault: str, note: str, base: int | None, data: bytes, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/vaults/{vault}/notes/{note}/revisions", push_body(data, base), key=key or idempotency_key())


def pushed(api: Api, vault: str, note: str, base: int | None, data: bytes) -> int:
    r = push(api, vault, note, base, data)
    assert r.status_code == 201, r.text
    return r.json()["revision"]["rev"]


def restore(api: Api, vault: str, note: str, rev: int, base: int, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/vaults/{vault}/notes/{note}/restore", {"revision": rev, "base_revision": base},
                    key=key or idempotency_key())


def revisions(api: Api, vault: str) -> list[dict]:
    r = api.get(f"/api/vaults/{vault}/revisions", params={"after": 0, "limit": 500})
    assert r.status_code == 200, r.text
    return r.json()["revisions"]


def history(api: Api, vault: str, note: str) -> list[dict]:
    r = api.get(f"/api/vaults/{vault}/notes/{note}/history")
    assert r.status_code == 200, r.text
    return r.json()["revisions"]


def ops_api(base: str) -> Api:
    api = Api(base)
    r = api.post("/api/sessions", {"email": OPS_EMAIL, "password": OPS_PASSWORD, "device_name": "ops desk", "device_id": None})
    assert r.status_code == 200, r.text
    return api


def run_sweep(ops: Api) -> dict:
    deadline = time.monotonic() + SWEEP_WAIT_S
    while time.monotonic() < deadline:
        r = ops.post("/api/ops/sweep")
        if r.status_code == 200:
            return r.json()
        assert_error(r, 409, "sweep_running")
    pytest.fail("POST /api/ops/sweep never ran: every attempt answered 409 sweep_running")


@dataclass
class Case:
    ids: dict[str, str]

    def notes(self, private: tuple[str, ...] = ()) -> list[dict]:
        return [{"id": self.ids[k], "title": t, "aliases": list(a), "frontmatter": dict(f), "body": b,
                 "private": p or k in private} for k, t, a, f, p, b in SAMPLE]


def sample_case() -> Case:
    return Case({key: str(uuid.uuid4()) for key, *_ in SAMPLE})


def new_slug() -> str:
    return f"case-{uuid.uuid4().hex[:12]}"


def publisher(base: str, prefix: str = "pub") -> Acct:
    acct = create_account(base, prefix)
    subscribe(acct, "publish")
    return acct


def create_dossier(acct: Acct, case: Case, root: str = "N0") -> dict:
    r = acct.api.post("/api/dossiers", {"slug": new_slug(), "root_note_id": case.ids[root]})
    assert r.status_code == 201, r.text
    return r.json()["dossier"]


def publish(api: Api, dossier: dict, case: Case, radius: int, private: tuple[str, ...] = ()) -> httpx.Response:
    return api.post(f"/api/dossiers/{dossier['id']}/publish", {"radius": radius, "notes": case.notes(private)})


def published(acct: Acct, case: Case, radius: int, root: str = "N0") -> dict:
    d = create_dossier(acct, case, root)
    r = publish(acct.api, d, case, radius)
    assert r.status_code == 200, r.text
    return r.json()["dossier"]


def preview_link(api: Api, dossier: dict, case: Case, radius: int) -> httpx.Response:
    return api.post(f"/api/dossiers/{dossier['id']}/preview-links", {"radius": radius, "notes": case.notes()})


def dossier_state(api: Api, dossier: dict) -> dict:
    r = api.get(f"/api/dossiers/{dossier['id']}")
    assert r.status_code == 200, r.text
    return r.json()["dossier"]


def reader(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, headers={"Origin": origin_of(base)})


def store_objects(prefix: str) -> dict[str, bytes]:
    s3 = S3()
    return {key: s3.get(key) for key in s3.keys(prefix)}


def wait_empty(prefix: str) -> None:
    deadline = time.monotonic() + MAIL_WAIT_S
    while S3().keys(prefix):
        assert time.monotonic() < deadline, f"objects remain under {prefix}"


def settled_keys(prefix: str, done: Callable[[list[str]], bool]) -> list[str]:
    deadline = time.monotonic() + MAIL_WAIT_S
    while not done(keys := S3().keys(prefix)) and time.monotonic() < deadline:
        continue
    return keys


def leaks(objects: dict[str, bytes], needles: list[str]) -> list[tuple[str, str]]:
    found = []
    for key, data in objects.items():
        body = data.decode("utf-8", "replace")
        body = body.replace("&#39;", "'").replace("&amp;", "&").replace("&#x27;", "'")
        found += [(key, n) for n in needles if n in body]
    return found


def mails_now(mail: Any, email: str, subject: str | None = None) -> list[dict]:
    return [m for m in mail.messages()
            if email.lower() in [a.lower() for a in addresses(m.get("To"))]
            and (subject is None or subject in (m.get("Subject") or ""))]


def mails_to(mail: Any, email: str, subject: str | None = None, contains: str | None = None, expected: int = 1) -> list[dict]:
    deadline = time.monotonic() + MAIL_WAIT_S
    while time.monotonic() < deadline:
        found = [m for m in mails_now(mail, email, subject) if contains is None or contains in text(m)]
        if len(found) >= expected:
            return found
    return [m for m in mails_now(mail, email, subject) if contains is None or contains in text(m)]


def full_text(message: dict) -> str:
    return f"{message.get('Subject', '')}\n{text(message)}\n{message.get('HTML', '')}"


TOKEN_CHARS = r"[^\s\"'<>()\[\]]+"


def approval_token(mail: Any, email: str, device: str) -> str:
    found = mails_to(mail, email, "Approve a new Cairn device", contains=device)
    assert found, f"no approval email for {email}"
    match = re.search(rf"https?://\S+?/devices/approve/({TOKEN_CHARS})", text(found[-1]))
    assert match, text(found[-1])
    return match.group(1).rstrip(".,;:")


def invite_token(mail: Any, email: str) -> str:
    found = mails_to(mail, email, "invited you to a shared Cairn vault")
    assert found, f"no invite email for {email}"
    match = re.search(rf"https?://\S+?/invites/({TOKEN_CHARS})", text(found[-1]))
    assert match, text(found[-1])
    return match.group(1).rstrip(".,;:")


def add_partner(owner: Acct, vault: str, mail: Any) -> Acct:
    partner = create_account(owner.base, "partner", device="partner desk")
    r = owner.api.post(f"/api/vaults/{vault}/invites", {"email": partner.email})
    assert r.status_code == 201, r.text
    r = partner.api.post(f"/api/invites/{invite_token(mail, partner.email)}/accept")
    assert r.status_code == 200, r.text
    return partner


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def local_midnight_after(value: str, tz: str, days: int) -> datetime:
    local = ts(value).astimezone(ZoneInfo(tz))
    return datetime.combine(local.date() + timedelta(days=days), clock_time(0), tzinfo=ZoneInfo(tz))


def when_pattern(value: str, tz: str) -> str:
    local = ts(value).astimezone(ZoneInfo(tz))
    return rf"0?{local.day} {local.strftime('%b %Y, %H:%M')}"


def when_either(value: str, tz: str) -> str:
    later = (ts(value) + timedelta(seconds=60)).isoformat()
    return f"(?:{when_pattern(value, tz)}|{when_pattern(later, tz)})"


def wait_server_past(base: str, moment: datetime) -> None:
    deadline = time.monotonic() + MAIL_WAIT_S
    with httpx.Client(timeout=HTTP_TIMEOUT) as http:
        while time.monotonic() < deadline:
            r = http.get(f"{base}/api/health")
            if parsedate_to_datetime(r.headers["date"]) >= moment + timedelta(seconds=1):
                return
    pytest.fail(f"the server's Date header never passed {moment.isoformat()}")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def tail(path: str) -> str:
    return Path(path).read_text(errors="replace")[-4000:]


@contextmanager
def app_copy(overrides: dict[str, str]):
    manifest_path = Path(DEPLOYED_APP) / "run.json"
    manifest = json.loads((manifest_path if manifest_path.exists() else Path("/app/run.json")).read_text())
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ)
    env.update({"APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base})
    env.update(overrides)
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    try:
        deadline = time.monotonic() + COPY_BOOT_S
        while time.monotonic() < deadline:
            assert proc.poll() is None, f"app copy exited:\n{tail(log.name)}"
            try:
                if httpx.get(f"{base}/api/health", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            try:
                proc.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                pass
        else:
            pytest.fail(f"app copy never answered GET /api/health with 200:\n{tail(log.name)}")
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=30)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


class Relay:

    def __init__(self, host: str, port: int):
        self.target = (host, port)
        self.up = False
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(64)
        self.port = self.server.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while self.server.fileno() != -1:
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            if not self.up:
                conn.close()
                continue
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
                upstream.settimeout(None)
            except OSError:
                conn.close()
                continue
            for src, dst in ((conn, upstream), (upstream, conn)):
                threading.Thread(target=self._pipe, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def close(self) -> None:
        self.server.shutdown(socket.SHUT_RDWR)
        self.server.close()


def eventually(page: Page, probe: Callable[[], Any], budget_ms: int | None = None, seconds: float = UI_WAIT_S) -> int:
    spent = 0
    deadline = time.monotonic() + seconds
    while time.monotonic() <= deadline:
        try:
            probe()
            return spent
        except AssertionError:
            if budget_ms is None or spent + STEP_MS <= budget_ms:
                advance(page, STEP_MS)
                spent += STEP_MS
    probe()
    return spent


def sync_status(page: Page):
    return page.get_by_role("status", name="Sync status", exact=True)


def note_badge(page: Page):
    return page.get_by_role("status", name="Note sync status", exact=True)


def tree_item(page: Page, title: str):
    return page.get_by_role("tree", name="Notes").get_by_role("treeitem", name=title).first


def account_dialog(page: Page):
    dlg = page.get_by_role("dialog", name="Account")
    if not dlg.is_visible():
        click(page.get_by_role("button", name="Account", exact=True))
    expect(dlg).to_be_visible(timeout=UI_MS)
    return dlg


def close_dialogs(page: Page) -> None:
    for _ in range(4):
        if not page.get_by_role("dialog").first.is_visible():
            return
        page.keyboard.press("Escape")


def ui_create_account(page: Page, email: str, name: str, device: str) -> None:
    dlg = account_dialog(page)
    fill(dlg.get_by_role("textbox", name="Email", exact=True), email)
    fill(dlg.get_by_label("Password", exact=True), PASSWORD)
    fill(dlg.get_by_role("textbox", name="Display name", exact=True), name)
    fill(dlg.get_by_role("textbox", name="Device name", exact=True), device)
    settle_click(dlg.get_by_role("button", name="Create account", exact=True))
    expect(dlg.get_by_role("status", name="Account status")).to_contain_text(
        "Account created — this browser is your first device.", timeout=UI_MS)


def ui_sign_in(page: Page, email: str, password: str, device: str) -> None:
    dlg = account_dialog(page)
    fill(dlg.get_by_role("textbox", name="Email", exact=True), email)
    fill(dlg.get_by_label("Password", exact=True), password)
    fill(dlg.get_by_role("textbox", name="Device name", exact=True), device)
    settle_click(dlg.get_by_role("button", name="Sign in", exact=True))


def ui_plan(page: Page, button: str, expected: str | re.Pattern) -> None:
    dlg = account_dialog(page)
    plans = dlg.get_by_role("region", name="Plans")
    click(plans.get_by_role("button", name=button, exact=True))
    expect(plans.get_by_role("status", name="Plan status")).to_contain_text(expected, timeout=UI_MS)


def ui_control(page: Page, name: str) -> None:
    btn = page.get_by_role("button", name=name, exact=True).first
    if not btn.is_visible():
        account_dialog(page)
    click(page.get_by_role("button", name=name, exact=True).first)


def ui_enable_sync(page: Page) -> None:
    ui_control(page, "Enable sync for this notebook")
    dlg = page.get_by_role("dialog", name="Set vault passphrase")
    fill(dlg.get_by_label("Vault passphrase", exact=True), PASSPHRASE)
    fill(dlg.get_by_label("Confirm passphrase", exact=True), PASSPHRASE)
    settle_click(dlg.get_by_role("button", name="Create vault", exact=True))
    expect(page.get_by_role("status", name="Vault status").first).to_contain_text(
        "Vault created — this notebook now syncs", timeout=UI_MS)
    close_dialogs(page)


def ui_wait_synced(page: Page) -> None:
    eventually(page, lambda: expect(sync_status(page)).to_have_text("All changes synced", timeout=CHECK_MS))


def ui_new_note(page: Page, title: str, body: str) -> None:
    click(page.get_by_role("button", name="New note", exact=True))
    fill(page.get_by_role("textbox", name="Note title", exact=True), title)
    fill(page.get_by_role("textbox", name="Note body", exact=True), body)
    advance(page, SAVE_SETTLE_MS)


def ui_open_note(page: Page, title: str) -> None:
    click(tree_item(page, title))
    expect(page.get_by_role("textbox", name="Note title", exact=True)).to_have_value(title, timeout=UI_MS)


def ui_edit_body(page: Page, body: str) -> None:
    box = page.get_by_role("textbox", name="Note body", exact=True)
    if not box.is_visible():
        click(page.get_by_role("button", name="Edit", exact=True))
    fill(box, body)
    advance(page, SAVE_SETTLE_MS)


def body_contains(page: Page, needle: str, timeout: int = CHECK_MS) -> None:
    box = page.get_by_role("textbox", name="Note body", exact=True)
    if box.count() and box.is_visible():
        expect(box).to_have_value(re.compile(re.escape(needle)), timeout=timeout)
    else:
        expect(page.get_by_text(needle).first).to_be_visible(timeout=timeout)


def ui_unlock(page: Page) -> None:
    dlg = page.get_by_role("dialog", name="Unlock vault")
    try:
        eventually(page, lambda: expect(dlg).to_be_visible(timeout=CHECK_MS), budget_ms=APPROVAL_DETECT_MS, seconds=20)
    except AssertionError:
        combo = page.get_by_role("combobox", name="Notebook")
        label = combo.evaluate("""el => el.tagName !== 'SELECT' ? '' :
            [...el.options].map(o => (o.label || o.text || '').trim()).find(t => t.includes('· locked')) || ''""")
        if label:
            select(combo, label)
        else:
            click(combo)
            click(page.get_by_role("option", name=re.compile("· locked")).first)
        expect(dlg).to_be_visible(timeout=UI_MS)
    fill(dlg.get_by_label("Vault passphrase", exact=True), PASSPHRASE)
    settle_click(dlg.get_by_role("button", name="Unlock", exact=True))


def ui_second_device(browser: Any, page: Page, base: str, mail: Any, email: str, device: str) -> None:
    ui_sign_in(page, email, PASSWORD, device)
    close_dialogs(page)
    expect(sync_status(page)).to_have_text("Waiting for device approval — check your email", timeout=UI_MS)
    token = approval_token(mail, email, device)
    with open_app(browser, f"{base}/devices/approve/{token}") as tab:
        click(tab.get_by_role("button", name="Approve this device", exact=True))
        expect(tab.get_by_role("status", name="Device approval status")).to_have_text(
            "Device approved. You can close this tab.", timeout=UI_MS)
    unlock = page.get_by_role("dialog", name="Unlock vault")
    eventually(page, lambda: expect(unlock).to_be_visible(timeout=CHECK_MS), budget_ms=APPROVAL_DETECT_MS)
    fill(unlock.get_by_label("Vault passphrase", exact=True), PASSPHRASE)
    settle_click(unlock.get_by_role("button", name="Unlock", exact=True))


def ui_synced_note(page: Page, email: str, name: str, device: str, title: str, body: str, publish_too: bool = False) -> None:
    ui_create_account(page, email, name, device)
    ui_plan(page, "Add Sync", "Sync active")
    if publish_too:
        ui_plan(page, "Add Publish", "Publish active")
    close_dialogs(page)
    ui_new_note(page, title, body)
    ui_enable_sync(page)
    ui_wait_synced(page)


def ctx_json(page: Page, base: str, path: str) -> Any:
    r = page.context.request.get(base + path)
    assert r.ok, r.text()
    return r.json()


def ctx_vault(page: Page, base: str) -> str:
    vaults = ctx_json(page, base, "/api/vaults")["vaults"]
    assert vaults
    return vaults[0]["id"]


def ctx_api(page: Page, base: str, email: str) -> Api:
    device_id = ctx_json(page, base, "/api/me")["device"]["id"]
    api = Api(base)
    r = api.post("/api/sessions", {"email": email, "password": PASSWORD, "device_name": "unused", "device_id": device_id})
    assert r.status_code == 200, r.text
    return api


def ui_workbench(page: Page, email: str, name: str, root: str, slug: str) -> None:
    click(page.get_by_role("button", name="Load sample case", exact=True))
    expect(tree_item(page, root)).to_be_visible(timeout=UI_MS)
    ui_create_account(page, email, name, "desk laptop")
    ui_plan(page, "Add Publish", "Publish active")
    close_dialogs(page)
    ui_open_note(page, root)
    click(page.get_by_role("tab", name="Publish", exact=True))
    fill(page.get_by_role("textbox", name="Dossier address", exact=True), slug)
    click(page.get_by_role("button", name="Create dossier", exact=True))
    expect(page.get_by_role("status", name="Dossier state")).to_have_text("Draft", timeout=UI_MS)


def counts_say(counts: Any, n: int, m: int) -> None:
    try:
        shown = flat_text(counts)
    except PlaywrightError as error:
        raise AssertionError(f"counters not readable yet: {error}") from error
    assert counts_copy(n, m) in shown, shown


def preview_scope(region: Any) -> Any:
    return region.frame_locator("iframe").first.locator("body") if region.locator("iframe").count() else region


def flat_text(locator: Any) -> str:
    return " ".join(locator.inner_text().split())


def moving(locator: Any) -> list[str]:
    return locator.evaluate("""e => e.getAnimations({subtree: true}).filter(a => {
        const t = a.effect && a.effect.target, f = document.activeElement;
        const d = Number(a.effect && a.effect.getTiming().duration) || 0;
        if (a.playState !== 'running' || d <= 0) return false;
        const transition = typeof CSSTransition !== 'undefined' && a instanceof CSSTransition;
        if (transition && t && t.nodeType === 1 && !t.closest('[role="img"]')
            && ((f && (t === f || f.contains(t))) || t.matches(':hover'))) return false;
        return true;
      }).map(a => a.animationName || a.transitionProperty || a.id || a.constructor.name)""")


def ring_motion(ring: Any, counts: Any) -> list[str]:
    return ring.evaluate("""(e, c) => {
        const all = [...e.getAnimations({subtree: true}), ...(c ? c.getAnimations({subtree: true}) : [])];
        return [...new Set(all)].filter(a => {
          let t = a.effect && a.effect.target;
          if (t && t.nodeType !== 1 && t.element) t = t.element;
          if (!t || t.nodeType !== 1) return false;
          const d = Number(a.effect.getTiming().duration) || 0;
          if (a.playState !== 'running' || d <= 0) return false;
          const mark = t.closest('[role="img"]');
          return (mark && e.contains(mark)) || (c && c.contains(t));
        }).map(a => a.animationName || a.transitionProperty || a.id || a.constructor.name);
      }""", counts.element_handle())


def body_link(page: Page, name: str) -> Any:
    links = page.get_by_role("link", name=name)
    for index in range(links.count()):
        if links.nth(index).evaluate("e => !e.closest('[role=tree]')"):
            return links.nth(index)
    raise AssertionError(f"no link named {name!r} outside the notes tree")


def entry_names(listing: Any) -> list[str]:
    return re.findall(r'button "([^"]+)"', listing.aria_snapshot())


def assert_closed(locator: Any) -> None:
    if locator.count():
        expect(locator.first).not_to_be_in_viewport(ratio=PEEK_RATIO, timeout=CHECK_MS)


def fits(page: Page) -> None:
    viewport = page.viewport_size
    assert viewport is not None
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        box = control.bounding_box() if control.is_visible() else None
        on_screen = min(box["x"] + box["width"], viewport["width"]) - max(box["x"], 0) if box else 0
        if not box or on_screen < box["width"] / 2:
            continue
        control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
        box = control.bounding_box()
        assert box and box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1, control.aria_snapshot()


def focus_names(page: Page, presses: int) -> list[tuple[str, str]]:
    names = []
    for _ in range(presses):
        page.keyboard.press("Tab")
        focused = page.locator(":focus")
        snap = focused.first.aria_snapshot() if focused.count() else ""
        match = re.match(r'-\s+(\w+)(?:\s+"((?:[^"\\]|\\.)*)")?', snap)
        names.append((match.group(1), match.group(2) or "") if match else ("", ""))
    return names


def ring_visible(page: Page, locator: Any) -> bool:
    page.mouse.move(0, 0)
    page.evaluate("document.activeElement && document.activeElement.blur()")
    advance(page, SLIDE_SETTLE_MS)
    box = locator.bounding_box()
    assert box
    viewport = page.viewport_size
    x, y = max(box["x"] - RING_MARGIN, 0), max(box["y"] - RING_MARGIN, 0)
    clip = {"x": x, "y": y, "width": min(box["width"] + 2 * RING_MARGIN, viewport["width"] - x),
            "height": min(box["height"] + 2 * RING_MARGIN, viewport["height"] - y)}
    before = page.screenshot(clip=clip, animations="disabled")
    for _ in range(TAB_BUDGET):
        page.keyboard.press("Tab")
        if locator.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"):
            break
    else:
        raise AssertionError("Tab never reached the control")
    advance(page, SLIDE_SETTLE_MS)
    return page.screenshot(clip=clip, animations="disabled") != before


def choose(radio: Any) -> None:
    if radio.is_checked():
        return
    try:
        click(radio)
    except AssertionError:
        radio.evaluate("el => (el.labels && el.labels[0] ? el.labels[0] : el).click()")
    expect(radio).to_be_checked()


def ui_set_hop(page: Page, hop: int) -> tuple[int, int]:
    choose(page.get_by_role("radio", name=hop_name(hop), exact=True))
    n, m = HOP_COUNTS[hop]
    eventually(page, lambda: expect(page.get_by_role("status", name="Boundary check")).to_have_text(
        match_copy(n, m), timeout=CHECK_MS))
    return n, m


def ui_publish(page: Page, n: int, m: int) -> None:
    click(page.get_by_role("button", name="Publish dossier", exact=True))
    dlg = page.get_by_role("dialog", name="Publish dossier")
    expect(dlg).to_contain_text(fill_copy(CONFIRM_COPY, {"N": n, "M": m}))
    settle_click(dlg.get_by_role("button", name="Publish now", exact=True))
    expect(page.get_by_role("status", name="Publish status")).to_have_text(
        fill_copy(PUBLISHED_COPY, {"N": n, "M": m}), timeout=UI_MS)
    expect(page.get_by_role("status", name="Dossier state")).to_have_text("Published", timeout=UI_MS)
    eventually(page, lambda: expect(dlg).to_be_hidden(timeout=CHECK_MS))


def ctx_dossier(page: Page, base: str, slug: str) -> dict:
    return next(d for d in ctx_json(page, base, "/api/dossiers")["dossiers"] if d["slug"] == slug)


def settle_click(locator: Any) -> None:
    eventually(locator.page, lambda: click(locator))


def confirm(page: Page, pattern: re.Pattern) -> None:
    dlg = page.get_by_role("dialog").first
    try:
        expect(dlg).to_be_visible(timeout=CHECK_MS * 3)
    except AssertionError:
        return
    settle_click(dlg.get_by_role("button", name=pattern).last)


def slider_state(slider: Any) -> list:
    return slider.evaluate("el => [el.getAttribute('aria-valuenow') ?? String(el.value), el.getAttribute('aria-valuetext')]")


class Markup(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.elements: list[tuple[str, dict]] = []
        self.chunks: list[str] = []
        self.anchors: list[dict] = []
        self._anchor: dict | None = None
        self._script_text: list[str] = []
        self._in_script = False

    def handle_starttag(self, tag: str, attrs: list) -> None:
        values = {k: (v or "") for k, v in attrs}
        self.elements.append((tag, values))
        if tag == "a":
            self._anchor = {"attrs": values, "text": ""}
            self.anchors.append(self._anchor)
        self._in_script = tag == "script"

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        self.elements.append((tag, {k: (v or "") for k, v in attrs}))

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self._anchor = None
        if tag == "script":
            self._in_script = False

    def handle_data(self, data: str) -> None:
        if self._in_script:
            self._script_text.append(data)
            return
        self.chunks.append(data)
        if self._anchor is not None:
            self._anchor["text"] += data

    @property
    def text(self) -> str:
        return "".join(self.chunks)


def parse(html_text: str) -> Markup:
    parser = Markup()
    parser.feed(html_text)
    return parser


def test_accounts_create_and_errors(app_url):
    api = Api(app_url)
    name, email = ids_pair("signup")
    r = api.post("/api/accounts", {"email": email, "password": PASSWORD, "display_name": name,
                                   "time_zone": "America/Bogota", "device_name": "field laptop"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["account"]["email"].lower() == email.lower()
    assert body["account"]["display_name"] == name
    assert body["account"]["time_zone"] == "America/Bogota"
    assert body["account"]["operator"] is False
    assert body["device"]["approved"] is True
    cookie = r.headers.get("set-cookie", "")
    assert "cairn_session" in cookie
    for flag in ("httponly", "samesite=lax", "path=/"):
        assert flag in cookie.lower(), cookie
    me = api.get("/api/me")
    assert me.status_code == 200 and me.json()["account"]["id"] == body["account"]["id"]
    assert me.json()["account"]["time_zone"] == "America/Bogota"
    assert_error(Api(app_url).get("/api/me"), 401, "unauthenticated")

    again = Api(app_url).post("/api/sessions", {"email": email, "password": PASSWORD, "device_name": "x",
                                                 "device_id": body["device"]["id"]})
    assert again.status_code == 200 and again.json()["device"]["id"] == body["device"]["id"]
    assert again.json()["device"]["approved"] is True
    wrong = Api(app_url).post("/api/sessions", {"email": email, "password": PASSWORD + "x", "device_name": "x", "device_id": None})
    assert_error(wrong, 401, "invalid_credentials")
    devices = api.get("/api/devices").json()["devices"]
    assert len(devices) == 1, "a refused sign-in must not create a device"

    dup = Api(app_url).post("/api/accounts", {"email": email, "password": PASSWORD, "display_name": name,
                                               "time_zone": TZ, "device_name": "x"})
    assert_error(dup, 409, "email_taken")

    def attempt(**changes: Any) -> tuple[httpx.Response, str]:
        n, e = ids_pair("val")
        payload = {"email": e, "password": PASSWORD, "display_name": n, "time_zone": TZ, "device_name": "desk"}
        payload.update(changes)
        return Api(app_url).post("/api/accounts", payload), payload["email"]

    def long_email(total: int) -> str:
        local = uuid.uuid4().hex + "a" * 32
        tail_len = total - len(local) - 1 - len(".example") - 128
        return f"{local}@{'d' * 63}.{'d' * 63}.{'d' * tail_len}.example"

    invalid = [
        ("email", {"email": "not-an-address"}),
        ("email", {"email": long_email(EMAIL_MAX + 1)}),
        ("password", {"password": "p" * 9}),
        ("password", {"password": "p" * 129}),
        ("display_name", {"display_name": ""}),
        ("display_name", {"display_name": "n" * 61}),
        ("time_zone", {"time_zone": "Mars/Olympus_Mons"}),
        ("device_name", {"device_name": ""}),
        ("device_name", {"device_name": "d" * 41}),
    ]
    for field, change in invalid:
        r, addr = attempt(**change)
        assert_field(r, field)
        if "@" in addr and len(addr) <= 254:
            refused = Api(app_url).post("/api/sessions", {"email": addr, "password": change.get("password", PASSWORD),
                                                          "device_name": "x", "device_id": None})
            assert refused.status_code == 401, f"{field} rejection still created the account"
    for change in ({"password": "p" * 10}, {"password": "p" * 128}, {"display_name": "n" * 60}, {"device_name": "d" * 40},
                   {"email": long_email(EMAIL_MAX)}):
        r, _ = attempt(**change)
        assert r.status_code == 201, (change, r.text)


def test_new_device_approval_email(app_url, mail):
    acct, vault = sync_owner(app_url, "approve")
    marker = uuid.uuid4().hex[:10]
    vault_name = f"Quayside {marker}"
    vault2 = create_vault(acct.api, vault_name)
    assert vault2
    sign_in(app_url, acct, acct.device["id"], "field laptop")
    assert mails_now(mail, acct.email, "Approve a new Cairn device") == [], "re-using an approved device sent mail"
    phone = Api(app_url)
    r = phone.post("/api/sessions", {"email": acct.email, "password": PASSWORD, "device_name": HARBOUR_PHONE, "device_id": None})
    assert r.status_code == 200, r.text
    assert r.json()["device"]["approved"] is False
    found = mails_to(mail, acct.email, "Approve a new Cairn device")
    assert len(found) == 1, f"expected exactly one approval email, got {len(found)}"
    message = found[0]
    assert "no-reply@cairn.example" in [a.lower() for a in addresses(message.get("From"))]
    content = full_text(message)
    assert HARBOUR_PHONE in content
    assert re.search(rf"https?://\S+?/devices/approve/{TOKEN_CHARS}", text(message))
    assert vault_name not in content and marker not in content


def test_unapproved_device_refused(app_url, mail):
    acct, vault = sync_owner(app_url, "unappr")
    note = str(uuid.uuid4())
    data = blob()
    rev = pushed(acct.api, vault, note, None, data)
    phone = Api(app_url)
    r = phone.post("/api/sessions", {"email": acct.email, "password": PASSWORD, "device_name": PIER_PHONE, "device_id": None})
    assert r.status_code == 200 and r.json()["device"]["approved"] is False
    keys_before = S3().keys(f"vault-blobs/{vault}/")
    for path in (f"/api/vaults/{vault}", f"/api/vaults/{vault}/revisions", f"/api/vaults/{vault}/revisions/{rev}/blob",
                 f"/api/vaults/{vault}/notes/{note}/history"):
        assert_error(phone.get(path), 403, "device_not_approved")
    assert_error(push(phone, vault, note, rev, blob()), 403, "device_not_approved")
    assert len(revisions(acct.api, vault)) == 1
    assert S3().keys(f"vault-blobs/{vault}/") == keys_before

    stranger = create_account(app_url, "stranger")
    listed = [d["name"] for d in stranger.api.get("/api/devices").json()["devices"]]
    assert PIER_PHONE not in listed
    assert_error(stranger.api.get(f"/api/vaults/{vault}"), 404, "not_found")

    token = approval_token(mail, acct.email, PIER_PHONE)
    assert_error(Api(app_url).post(f"/api/device-approvals/{uuid.uuid4().hex}"), 404, "not_found")
    ok = Api(app_url).post(f"/api/device-approvals/{token}")
    assert ok.status_code == 200, ok.text
    assert ok.json()["device"]["approved"] is True
    assert_error(Api(app_url).post(f"/api/device-approvals/{token}"), 409, "link_used")
    got = phone.get(f"/api/vaults/{vault}/revisions/{rev}/blob")
    assert got.status_code == 200 and got.content == data


def test_device_approval_link_expires(mail):
    with app_copy({"CAIRN_DEVICE_APPROVAL_TTL_SECONDS": str(SHORT_TTL_S)}) as base:
        acct = create_account(base, "expire")
        phone = Api(base)
        r = phone.post("/api/sessions", {"email": acct.email, "password": PASSWORD, "device_name": LATE_PHONE, "device_id": None})
        assert r.status_code == 200, r.text
        created = ts(r.json()["device"]["created_at"])
        token = approval_token(mail, acct.email, LATE_PHONE)
        wait_server_past(base, created + timedelta(seconds=SHORT_TTL_S))
        assert_error(Api(base).post(f"/api/device-approvals/{token}"), 410, "link_expired")
        devices = {d["name"]: d for d in acct.api.get("/api/devices").json()["devices"]}
        assert devices[LATE_PHONE]["approved"] is False


def test_wf_account_devices_create_account(browser, app_url):
    name, email = ids_pair("uisign")
    with open_app(browser, app_url) as page:
        page.context.new_cdp_session(page).send("Emulation.setTimezoneOverride", {"timezoneId": TZ})
        page.reload()
        page.set_viewport_size(DESKTOP)
        ui_create_account(page, email, name, STUDIO_LAPTOP)
        dlg = account_dialog(page)
        devices = dlg.get_by_role("list", name="Devices")
        expect(devices).to_contain_text(STUDIO_LAPTOP)
        expect(devices).to_contain_text("approved")
        browser_zone = page.evaluate("Intl.DateTimeFormat().resolvedOptions().timeZone")
        me = ctx_json(page, app_url, "/api/me")
        assert me["account"]["time_zone"] == browser_zone
        assert me["account"]["email"].lower() == email.lower()
        assert me["device"]["approved"] is True
        with open_app(browser, app_url) as other:
            other.set_viewport_size(DESKTOP)
            ui_sign_in(other, email, PASSWORD + "nope", "borrowed laptop")
            box = account_dialog(other)
            expect(box.get_by_role("status", name="Account status")).to_contain_text("Wrong email or password.", timeout=UI_MS)
        listed = ctx_json(page, app_url, "/api/devices")["devices"]
        assert [d["name"] for d in listed] == [STUDIO_LAPTOP]


def test_wf_account_devices_second_device(browser, app_url, mail):
    name, email = ids_pair("twodev")
    title = f"Marina log {uuid.uuid4().hex[:8]}"
    with open_app(browser, app_url) as laptop:
        laptop.set_viewport_size(DESKTOP)
        ui_synced_note(laptop, email, name, "field laptop", title, "Night delivery seen.")
        with open_app(browser, app_url) as phone:
            phone.set_viewport_size(DESKTOP)
            ui_second_device(browser, phone, app_url, mail, email, FIELD_PHONE)
            eventually(phone, lambda: expect(tree_item(phone, title)).to_be_visible(timeout=CHECK_MS), budget_ms=UNLOCK_MS)
        devices = {d["name"]: d for d in ctx_json(laptop, app_url, "/api/devices")["devices"]}
        assert devices[FIELD_PHONE]["approved"] is True


def test_wf_field_sync_local_offline(browser, app_url):
    marker = uuid.uuid4().hex[:10]
    alpha, beta, gamma = f"Quay ledger {marker}", f"Dock clerk {marker}", f"Offline jot {marker}"
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        expect(sync_status(page)).to_have_text("Local only — not syncing", timeout=UI_MS)
        ui_new_note(page, beta, "Works the night shift.")
        ui_new_note(page, alpha, f"Paid through [[{beta}]].")
        eventually(page, lambda: expect(note_badge(page)).to_have_text("local only", timeout=CHECK_MS))
        ui_open_note(page, beta)
        click(page.get_by_role("tab", name="Backlinks", exact=True))
        expect(page.get_by_role("list", name="Backlinks").get_by_role("link", name=alpha)).to_be_visible(timeout=UI_MS)
        page.reload()
        expect(tree_item(page, alpha)).to_be_visible(timeout=UI_MS)
        page.context.set_offline(True)
        expect(tree_item(page, alpha)).to_be_visible(timeout=UI_MS)
        expect(tree_item(page, beta)).to_be_visible()
        ui_open_note(page, alpha)
        read = page.get_by_role("button", name="Read", exact=True)
        if read.count() and read.is_visible():
            click(read)
        click(body_link(page, beta))
        title_box = page.get_by_role("textbox", name="Note title", exact=True)
        expect(title_box).to_have_value(beta, timeout=UI_MS)
        eventually(page, lambda: expect(title_box).to_be_focused(timeout=CHECK_MS))
        ui_new_note(page, gamma, "Written with the network off.")
        expect(tree_item(page, gamma)).to_be_visible(timeout=UI_MS)
        page.context.set_offline(False)
        page.reload()
        expect(tree_item(page, gamma)).to_be_visible(timeout=UI_MS)
    assert db_mentions(marker) == []


def db_mentions(marker: str) -> list[str]:
    pg = Postgres()
    hits = []
    for table in pg.tables():
        ident = ".".join('"' + part.replace('"', '""') + '"' for part in table.split("."))
        rows = pg.rows(f"SELECT count(*) AS n FROM {ident} t WHERE t::text LIKE '%{marker}%'")
        if rows and int(rows[0]["n"]):
            hits.append(table)
    return hits


def test_ciphertext_only_sync(browser, app_url):
    name, email = ids_pair("cipher")
    marker_title, marker_body = uuid.uuid4().hex[:12], uuid.uuid4().hex[:12]
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_synced_note(page, email, name, "cipher laptop", f"Source {marker_title}", f"Met {marker_body} at the quay.")
        vault = ctx_vault(page, app_url)
    objects = store_objects(f"vault-blobs/{vault}/")
    assert objects
    for key, data in objects.items():
        assert re.fullmatch(rf"vault-blobs/{vault}/[0-9a-fA-F\-]{{36}}/\d+\.bin", key), key
        assert data[:4] == b"CRN1" and len(data) >= MIN_ENVELOPE
        assert marker_title.encode() not in data and marker_body.encode() not in data
    assert db_mentions(marker_title) == []
    assert db_mentions(marker_body) == []


def test_envelope_validation(app_url):
    acct, vault = sync_owner(app_url, "envel")
    note = str(uuid.uuid4())

    def send(body: dict) -> httpx.Response:
        return acct.api.post(f"/api/vaults/{vault}/notes/{note}/revisions", body, key=idempotency_key())

    good = blob(MIN_ENVELOPE)
    bad_prefix = b"XXXX" + good[4:]
    short = blob(MIN_ENVELOPE)[:MIN_ENVELOPE - 1]
    long = blob(MAX_ENVELOPE + 1)
    assert_field(send({"base_revision": None, "ciphertext": "%%%not base64%%%", "ciphertext_sha256": "0" * 64}), "ciphertext")
    assert_field(send(push_body(bad_prefix, None)), "ciphertext")
    assert_field(send(push_body(short, None)), "ciphertext")
    assert_field(send(push_body(long, None)), "ciphertext")
    wrong = push_body(good, None)
    wrong["ciphertext_sha256"] = hashlib.sha256(b64(good).encode()).hexdigest()
    assert_field(send(wrong), "ciphertext_sha256")
    r = send({**push_body(good, None), "base_revision": "first"})
    if r.status_code == 409:
        assert_error(r, 409, "revision_conflict")
    else:
        assert_field(r, "base_revision")
    assert revisions(acct.api, vault) == []
    assert S3().keys(f"vault-blobs/{vault}/") == []
    r = send(push_body(good, None))
    assert r.status_code == 201, r.text
    assert r.json()["revision"]["byte_length"] == MIN_ENVELOPE


def test_push_and_pull(app_url, mail):
    owner, vault = sync_owner(app_url, "pushpull")
    partner = add_partner(owner, vault, mail)
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    datas = [blob(), blob(), blob()]
    r1 = push(owner.api, vault, a, None, datas[0])
    assert r1.status_code == 201, r1.text
    rev1 = r1.json()["revision"]
    assert rev1["rev"] == 1 and rev1["base_revision"] is None and rev1["note_id"] == a
    assert rev1["ciphertext_sha256"] == hashlib.sha256(datas[0]).hexdigest()
    assert rev1["byte_length"] == len(datas[0]) and rev1["restored_from"] is None
    assert rev1["device_id"] == owner.device["id"] and rev1["device_name"] == FIELD_LAPTOP
    assert TIMESTAMP.match(rev1["created_at"])
    assert r1.json()["cursor"] == 1
    assert pushed(partner.api, vault, b, None, datas[1]) == 2
    assert_error(push(owner.api, vault, a, None, blob()), 409, "revision_conflict")
    assert pushed(owner.api, vault, a, 1, datas[2]) == 3
    s3 = S3()
    assert s3.get(f"vault-blobs/{vault}/{a}/1.bin") == datas[0]
    assert s3.get(f"vault-blobs/{vault}/{b}/2.bin") == datas[1]
    assert s3.get(f"vault-blobs/{vault}/{a}/3.bin") == datas[2]

    pulled = partner.api.get(f"/api/vaults/{vault}/revisions")
    assert pulled.status_code == 200
    assert [x["rev"] for x in pulled.json()["revisions"]] == [1, 2, 3]
    page = partner.api.get(f"/api/vaults/{vault}/revisions", params={"after": 1, "limit": 1}).json()
    assert [x["rev"] for x in page["revisions"]] == [2] and "next_after" in page
    for rev, data in ((1, datas[0]), (3, datas[2])):
        got = partner.api.get(f"/api/vaults/{vault}/revisions/{rev}/blob")
        assert got.status_code == 200 and got.content == data
        assert got.headers["content-type"].startswith("application/octet-stream")
    cursor = partner.api.get(f"/api/vaults/{vault}/cursor").json()
    assert cursor["cursor"] == 3
    assert_field(partner.api.get(f"/api/vaults/{vault}/revisions", params={"limit": 0}), "limit")
    assert_field(partner.api.get(f"/api/vaults/{vault}/revisions", params={"limit": 501}), "limit")
    assert_field(partner.api.get(f"/api/vaults/{vault}/revisions", params={"after": "soon"}), "after")


def test_retried_push_records_once(app_url, mail):
    owner, vault = sync_owner(app_url, "idem")
    note = str(uuid.uuid4())
    key = idempotency_key()
    data = blob()
    first = push(owner.api, vault, note, None, data, key)
    assert first.status_code == 201, first.text
    cursor = owner.api.get(f"/api/vaults/{vault}/cursor").json()["cursor"]
    replay = push(owner.api, vault, note, None, data, key)
    assert replay.status_code == 201
    assert replay.json() == first.json()
    assert replay.headers.get("cairn-replayed", "").lower() == "true"
    assert len(revisions(owner.api, vault)) == 1
    assert len(S3().keys(f"vault-blobs/{vault}/")) == 1
    assert owner.api.get(f"/api/vaults/{vault}/cursor").json()["cursor"] == cursor
    assert_error(push(owner.api, vault, note, None, blob(), key), 409, "idempotency_key_reused")
    assert len(revisions(owner.api, vault)) == 1

    for bad in (None, "short", "has spaces in it"):
        headers = {} if bad is None else {"Idempotency-Key": bad}
        r = owner.api.http.post(f"/api/vaults/{vault}/notes/{note}/revisions", json=push_body(blob(), 1), headers=headers)
        assert_field(r, "Idempotency-Key")

    partner = add_partner(owner, vault, mail)
    other = push(partner.api, vault, note, 1, blob(), key)
    assert other.status_code == 201, "keys are scoped to the device"

    down = sign_in(os.environ["APP_MINIO_DOWN_URL"], owner, owner.device["id"], "field laptop")
    head = revisions(owner.api, vault)[-1]["rev"]
    retry_key = idempotency_key()
    retry_data = blob()
    assert_error(push(down, vault, note, head, retry_data, retry_key), 503, "storage_unavailable")
    ok = push(owner.api, vault, note, head, retry_data, retry_key)
    assert ok.status_code == 201, "a 503 must leave the key free"
    assert ok.headers.get("cairn-replayed", "").lower() != "true"


def test_honest_sync_badge(browser, app_url):
    name, email = ids_pair("badge")
    title = f"Ledger {uuid.uuid4().hex[:8]}"
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_synced_note(page, email, name, "badge laptop", title, "first draft")
        eventually(page, lambda: expect(note_badge(page)).to_have_text("synced", timeout=CHECK_MS))
        api = ctx_api(page, app_url, email)
        vault = ctx_vault(page, app_url)
        with held(page, "**/revisions") as gate:
            ui_edit_body(page, "second draft")
            eventually(page, lambda: expect(note_badge(page)).to_have_text("pending", timeout=CHECK_MS))
            gate.release()
        eventually(page, lambda: expect(note_badge(page)).to_have_text("synced", timeout=CHECK_MS))
        note = revisions(api, vault)[-1]["note_id"]
        head = history(api, vault, note)[0]["rev"]
        oldest = history(api, vault, note)[-1]["rev"]
        with held(page, "**/revisions") as gate:
            ui_edit_body(page, "third draft")
            eventually(page, lambda: expect(note_badge(page)).to_have_text("pending", timeout=CHECK_MS))
            won = restore(api, vault, note, oldest, head)
            assert won.status_code == 201, won.text
            gate.release()
        eventually(page, lambda: expect(note_badge(page)).to_have_text("conflict", timeout=CHECK_MS))
        assert history(api, vault, note)[0]["rev"] == won.json()["revision"]["rev"], "the losing push must not be applied"


def test_wf_field_sync_two_devices(browser, app_url, mail):
    name, email = ids_pair("fieldsync")
    marker = uuid.uuid4().hex[:10]
    title = f"Pier notes {marker}"
    with open_app(browser, app_url) as laptop:
        laptop.set_viewport_size(DESKTOP)
        ui_synced_note(laptop, email, name, "field laptop", title, "first sighting")
        with open_app(browser, app_url) as phone:
            phone.set_viewport_size(DESKTOP)
            ui_second_device(browser, phone, app_url, mail, email, "field phone")
            eventually(phone, lambda: expect(tree_item(phone, title)).to_be_visible(timeout=CHECK_MS), budget_ms=UNLOCK_MS)
            ui_open_note(phone, title)
            ui_open_note(laptop, title)
            edit = f"second sighting {marker}"
            ui_edit_body(laptop, edit)
            ui_wait_synced(laptop)
            eventually(phone, lambda: body_contains(phone, edit), budget_ms=PULL_INTERVAL_MS)
            eventually(phone, lambda: expect(note_badge(phone)).to_have_text("synced", timeout=CHECK_MS))
            eventually(laptop, lambda: expect(note_badge(laptop)).to_have_text("synced", timeout=CHECK_MS))
        vault = ctx_vault(laptop, app_url)
        revs = ctx_json(laptop, app_url, f"/api/vaults/{vault}/revisions")["revisions"]
        assert len(revs) >= 2 and revs[-1]["device_name"] == FIELD_LAPTOP


def test_providers_down_stay_healthy(app_url):
    for env in ("APP_MINIO_DOWN_URL", "APP_KILLBILL_DOWN_URL"):
        health = httpx.get(f"{os.environ[env]}/api/health", timeout=HTTP_TIMEOUT)
        assert health.status_code == 200 and health.json() == {"status": "ok"}, env
    acct, vault = sync_owner(app_url, "boot")
    note = str(uuid.uuid4())
    rev = pushed(acct.api, vault, note, None, blob())
    s3down = sign_in(os.environ["APP_MINIO_DOWN_URL"], acct, acct.device["id"], "field laptop")
    assert_error(s3down.get(f"/api/vaults/{vault}/revisions/{rev}/blob"), 503, "storage_unavailable")
    listed = s3down.get(f"/api/vaults/{vault}/revisions")
    assert listed.status_code == 200 and [x["rev"] for x in listed.json()["revisions"]] == [rev]
    kbdown = sign_in(os.environ["APP_KILLBILL_DOWN_URL"], acct, acct.device["id"], "field laptop")
    assert_error(kbdown.post("/api/billing/subscriptions", {"addon": "publish"}), 503, "billing_unavailable")
    me = kbdown.get("/api/me")
    assert me.status_code == 200 and me.json()["account"]["id"] == acct.account["id"]
    assert acct.api.get("/api/billing").json()["publish"]["state"] == "none"


def test_storage_outage_refusals(app_url):
    down_url = os.environ["APP_MINIO_DOWN_URL"]
    acct, vault = sync_owner(app_url, "s3down")
    subscribe(acct, "publish")
    note = str(uuid.uuid4())
    rev = pushed(acct.api, vault, note, None, blob())
    case = sample_case()
    live = published(acct, case, 1)
    draft = create_dossier(acct, case)
    keys_before = S3().keys(f"vault-blobs/{vault}/")
    down = sign_in(down_url, acct, acct.device["id"], "field laptop")
    assert_error(push(down, vault, note, rev, blob()), 503, "storage_unavailable")
    assert_error(restore(down, vault, note, rev, rev), 503, "storage_unavailable")
    assert_error(down.get(f"/api/vaults/{vault}/revisions/{rev}/blob"), 503, "storage_unavailable")
    assert_error(preview_link(down, draft, case, 1), 503, "storage_unavailable")
    with reader(down_url) as http:
        page = http.get(f"/d/{live['slug']}/")
        assert page.status_code == 503 and "This dossier is temporarily unavailable." in page.text
        missing = http.get(f"/d/{new_slug()}/")
        assert missing.status_code == 404 and "This dossier isn't available." in unescape(missing.text)
    assert [x["rev"] for x in revisions(acct.api, vault)] == [rev]
    assert S3().keys(f"vault-blobs/{vault}/") == keys_before
    assert dossier_state(acct.api, draft)["state"] == "draft"
    assert acct.api.get(f"/api/dossiers/{draft['id']}/preview-links").json()["preview_links"] == []


def test_billing_outage_last_known_plan(app_url, killbill):
    down_url = os.environ["APP_KILLBILL_DOWN_URL"]
    acct, vault = sync_owner(app_url, "kbdown")
    subscribe(acct, "publish")
    note = str(uuid.uuid4())
    rev = pushed(acct.api, vault, note, None, blob())
    case = sample_case()
    dossier = create_dossier(acct, case)
    down = sign_in(down_url, acct, acct.device["id"], "field laptop")
    r = down.post("/api/billing/subscriptions", {"addon": "sync"})
    assert (r.status_code, extra(r, "code")) in {(503, "billing_unavailable"), (409, "already_subscribed")}, r.text
    assert_error(cancel_addon(down, "sync"), 503, "billing_unavailable")
    assert_error(cancel_addon(down, "publish"), 503, "billing_unavailable")
    assert pushed(down, vault, note, rev, blob()) == rev + 1
    r = publish(down, dossier, case, 1)
    assert r.status_code == 200, r.text
    cached = down.get("/api/billing").json()
    assert cached["sync"]["source"] == "cache" and cached["sync"]["state"] == "active"
    live = acct.api.get("/api/billing").json()
    assert live["sync"]["state"] == "active" and live["publish"]["state"] == "active"

    fresh = create_account(down_url, "nocache")
    r = fresh.api.post("/api/vaults", {"name": "Field vault", "key_envelope": envelope()})
    assert_error(r, 503, "billing_unavailable")
    assert_error(fresh.api.post("/api/dossiers", {"slug": new_slug(), "root_note_id": str(uuid.uuid4())}), 503, "billing_unavailable")
    assert fresh.api.get("/api/vaults").json()["vaults"] == []
    assert killbill_subscriptions(killbill, fresh.email) == []


def test_refused_publish_keeps_live_dossier(app_url):
    acct = publisher(app_url, "atomic")
    case = sample_case()
    d = published(acct, case, 1)
    slug = d["slug"]
    with reader(app_url) as http:
        root_before = http.get(f"/d/{slug}/")
        assert root_before.status_code == 200
        assert http.get(f"/d/{slug}/{PAGE_SLUGS['N4']}").status_code == 404
    keys_before = sorted(S3().keys(f"publish/{slug}/"))
    down = sign_in(os.environ["APP_MINIO_DOWN_URL"], acct, acct.device["id"], "field laptop")
    assert_error(publish(down, d, case, 4), 503, "storage_unavailable")
    after = dossier_state(acct.api, d)
    assert after["state"] == "published" and after["radius"] == 1 and after["public_count"] == HOP_COUNTS[1][0]
    with reader(app_url) as http:
        root_after = http.get(f"/d/{slug}/")
        assert root_after.status_code == 200 and root_after.text == root_before.text
        assert http.get(f"/d/{slug}/{PAGE_SLUGS['N4']}").status_code == 404
        assert http.get(f"/d/{slug}/{PAGE_SLUGS['N1']}").status_code == 200
    assert sorted(S3().keys(f"publish/{slug}/")) == keys_before


def test_takedown_storage_outage(app_url):
    acct = publisher(app_url, "tdout")
    case = sample_case()
    d = published(acct, case, 2)
    slug = d["slug"]
    down = sign_in(os.environ["APP_MINIO_DOWN_URL"], acct, acct.device["id"], "field laptop")
    assert_error(down.post(f"/api/dossiers/{d['id']}/unpublish"), 503, "storage_unavailable")
    with reader(app_url) as http:
        for path in ("", PAGE_SLUGS["N1"], "sitemap.xml", "search-index.json"):
            r = http.get(f"/d/{slug}/{path}")
            assert r.status_code == 404, (path, r.status_code)
    assert dossier_state(acct.api, d)["state"] == "published"
    r = acct.api.post(f"/api/dossiers/{d['id']}/unpublish")
    assert r.status_code == 200, r.text
    assert r.json()["dossier"]["state"] == "unpublished"
    assert S3().keys(f"publish/{slug}/") == []


def test_wf_provider_outages_storage_resume(browser):
    endpoint = urlsplit(os.environ["S3_ENDPOINT"])
    relay = Relay(endpoint.hostname, endpoint.port or (443 if endpoint.scheme == "https" else 80))
    try:
        with app_copy({"S3_ENDPOINT": f"http://127.0.0.1:{relay.port}"}) as base:
            name, email = ids_pair("resume")
            title = f"Breakwater {uuid.uuid4().hex[:8]}"
            paused = copy_regex(PAUSED_COPY)
            with open_app(browser, base) as page:
                page.set_viewport_size(DESKTOP)
                ui_create_account(page, email, name, "storm laptop")
                ui_plan(page, "Add Sync", "Sync active")
                close_dialogs(page)
                ui_new_note(page, title, "first entry")
                ui_enable_sync(page)
                eventually(page, lambda: expect(sync_status(page)).to_have_text(paused, timeout=CHECK_MS))
                ui_edit_body(page, "second entry")
                eventually(page, lambda: expect(sync_status(page)).to_have_text(paused, timeout=CHECK_MS))
                eventually(page, lambda: expect(note_badge(page)).to_have_text("paused", timeout=CHECK_MS), budget_ms=2 * RETRY_MS)

                def count() -> int:
                    shown = paused.match(flat_text(sync_status(page)))
                    assert shown, "status is not showing the paused copy right now"
                    return int(shown.group(1))

                def steady() -> None:
                    before = count()
                    advance(page, SAVE_SETTLE_MS)
                    assert count() == before, "queue count still changing"

                eventually(page, steady)
                queued = count()
                assert queued >= 1
                page.reload()
                eventually(page, lambda: expect(sync_status(page)).to_have_text(
                    fill_copy(PAUSED_COPY, {"n": queued}), timeout=CHECK_MS), budget_ms=2 * RETRY_MS)
                relay.up = True
                eventually(page, lambda: expect(sync_status(page)).to_have_text("All changes synced", timeout=CHECK_MS),
                           budget_ms=3 * RETRY_MS)
                ui_open_note(page, title)
                eventually(page, lambda: expect(note_badge(page)).to_have_text("synced", timeout=CHECK_MS))
                vault = ctx_vault(page, base)
                revs = ctx_json(page, base, f"/api/vaults/{vault}/revisions?after=0&limit=500")["revisions"]
            assert len(revs) == queued
            assert [r["base_revision"] for r in revs] == [None] + [r["rev"] for r in revs[:-1]]
            assert len(S3().keys(f"vault-blobs/{vault}/")) == queued
    finally:
        relay.close()


def test_wf_provider_outages_billing_ui(browser, app_url, killbill):
    down_url = os.environ["APP_KILLBILL_DOWN_URL"]
    name, email = ids_pair("kbui")
    with open_app(browser, down_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_create_account(page, email, name, "dock laptop")
        ui_plan(page, "Add Publish", "Billing is unavailable. Your plan hasn't changed — try again shortly.")
        api = ctx_api(page, down_url, email)
    main = Api(app_url)
    r = main.post("/api/sessions", {"email": email, "password": PASSWORD, "device_name": "x",
                                    "device_id": api.get("/api/me").json()["device"]["id"]})
    assert r.status_code == 200
    assert main.get("/api/billing").json()["publish"]["state"] == "none"
    assert killbill_subscriptions(killbill, email) == []


def test_invite_email_and_accept(app_url, mail):
    owner = create_account(app_url, "inviter")
    subscribe(owner, "sync")
    marker = uuid.uuid4().hex[:10]
    vault = create_vault(owner.api, f"Harbour case {marker}")
    partner = create_account(app_url, "invitee")
    stranger = create_account(app_url, "wrongone")
    r = owner.api.post(f"/api/vaults/{vault}/invites", {"email": partner.email})
    assert r.status_code == 201, r.text
    invite = r.json()["invite"]
    assert invite["email"].lower() == partner.email.lower() and TIMESTAMP.match(invite["expires_at"])
    found = mails_to(mail, partner.email, "invited you to a shared Cairn vault")
    assert len(found) == 1
    message = found[0]
    assert message["Subject"] == f"{owner.name} invited you to a shared Cairn vault"
    assert "no-reply@cairn.example" in [a.lower() for a in addresses(message.get("From"))]
    content = full_text(message)
    assert marker not in content
    token = invite_token(mail, partner.email)
    assert_error(Api(app_url).post(f"/api/invites/{token}/accept"), 401, "unauthenticated")
    assert_error(stranger.api.post(f"/api/invites/{token}/accept"), 403, "invite_email_mismatch")
    assert vault not in [v["id"] for v in stranger.api.get("/api/vaults").json()["vaults"]]
    assert_error(partner.api.post(f"/api/invites/{uuid.uuid4().hex}/accept"), 404, "not_found")
    ok = partner.api.post(f"/api/invites/{token}/accept")
    assert ok.status_code == 200 and ok.json()["vault"]["role"] == "partner"
    assert vault in [v["id"] for v in partner.api.get("/api/vaults").json()["vaults"]]
    assert_error(partner.api.post(f"/api/invites/{token}/accept"), 409, "link_used")
    assert_error(partner.api.post(f"/api/vaults/{vault}/invites", {"email": stranger.email}), 403, "not_vault_owner")
    assert_field(owner.api.post(f"/api/vaults/{vault}/invites", {"email": "nobody"}), "email")
    second = create_account(app_url, "casefold")
    assert owner.api.post(f"/api/vaults/{vault}/invites", {"email": second.email.upper()}).status_code == 201
    assert second.api.post(f"/api/invites/{invite_token(mail, second.email)}/accept").status_code == 200
    members = owner.api.get(f"/api/vaults/{vault}").json()["members"]
    assert {partner.name, second.name} <= {m["display_name"] for m in members}


def test_invite_link_expires(mail):
    with app_copy({"CAIRN_INVITE_TTL_SECONDS": str(SHORT_TTL_S)}) as base:
        owner, vault = sync_owner(base, "invexp")
        partner = create_account(base, "lateinv")
        r = owner.api.post(f"/api/vaults/{vault}/invites", {"email": partner.email})
        assert r.status_code == 201
        token = invite_token(mail, partner.email)
        wait_server_past(base, ts(r.json()["invite"]["expires_at"]))
        assert_error(partner.api.post(f"/api/invites/{token}/accept"), 410, "link_expired")
        assert partner.api.get("/api/vaults").json()["vaults"] == []


def test_vault_isolation(app_url):
    a, va = sync_owner(app_url, "isoa")
    b, vb = sync_owner(app_url, "isob")
    na, nb = str(uuid.uuid4()), str(uuid.uuid4())
    da, db = blob(), blob()
    pushed(a.api, va, na, None, da)
    pushed(b.api, vb, nb, None, db)
    keys_a = S3().keys(f"vault-blobs/{va}/")
    for path in (f"/api/vaults/{va}", f"/api/vaults/{va}/revisions", f"/api/vaults/{va}/revisions/1/blob",
                 f"/api/vaults/{va}/notes/{na}/history", f"/api/vaults/{va}/cursor",
                 f"/api/vaults/{uuid.uuid4()}/revisions"):
        assert_error(b.api.get(path), 404, "not_found")
    assert_error(b.api.post(f"/api/vaults/{va}/invites", {"email": b.email}), 404, "not_found")
    assert_error(push(b.api, va, na, 1, blob()), 404, "not_found")
    assert_error(b.api.post(f"/api/vaults/{va}/notes/{na}/revisions", {"base_revision": "junk"}, key=idempotency_key()), 404, "not_found")
    assert_error(restore(b.api, va, na, 1, 1), 404, "not_found")
    assert_error(restore(b.api, vb, na, 1, 1), 404, "not_found")
    own = b.api.get(f"/api/vaults/{vb}/revisions/1/blob")
    assert own.status_code == 200 and own.content == db and own.content != da
    borrowed = b.api.get(f"/api/vaults/{vb}/notes/{na}/history")
    if borrowed.status_code == 200:
        assert borrowed.json()["revisions"] == []
    else:
        assert_error(borrowed, 404, "not_found")
    assert_error(Api(app_url).get(f"/api/vaults/{va}/revisions"), 401, "unauthenticated")
    assert [r["rev"] for r in revisions(a.api, va)] == [1]
    assert S3().keys(f"vault-blobs/{va}/") == keys_a


def test_one_winner_per_base(app_url):
    acct, vault = sync_owner(app_url, "race")
    note = str(uuid.uuid4())

    def race(base: int | None) -> list[httpx.Response]:
        gate = threading.Barrier(PARALLEL)

        def one(_: int) -> httpx.Response:
            body = push_body(blob(), base)
            gate.wait()
            return acct.api.post(f"/api/vaults/{vault}/notes/{note}/revisions", body, key=idempotency_key())

        with ThreadPoolExecutor(PARALLEL) as pool:
            return list(pool.map(one, range(PARALLEL)))

    for base in (None, "winner"):
        start = None if base is None else head
        results = race(start)
        wins = [r for r in results if r.status_code == 201]
        assert len(wins) == 1, [r.status_code for r in results]
        head = wins[0].json()["revision"]["rev"]
        for r in results:
            if r.status_code != 201:
                assert_error(r, 409, "revision_conflict")
                assert extra(r, "head_revision") == head
    assert len(history(acct.api, vault, note)) == 2
    assert len(S3().keys(f"vault-blobs/{vault}/{note}/")) == 2


def test_wf_shared_vault_conflict_copy(browser, app_url, mail):
    owner_name, owner_email = ids_pair("owner")
    partner_name, partner_email = ids_pair("partner")
    marker = uuid.uuid4().hex[:8]
    title = f"Quay witness {marker}"
    partner_text = f"partner text {marker}"
    owner_text = f"owner text {marker}"
    with open_app(browser, app_url) as owner:
        owner.set_viewport_size(DESKTOP)
        ui_synced_note(owner, owner_email, owner_name, OWNER_LAPTOP, title, "base text")
        ui_control(owner, "Invite partner")
        inv = owner.get_by_role("dialog", name="Invite partner")
        fill(inv.get_by_role("textbox", name="Partner email", exact=True), partner_email)
        settle_click(inv.get_by_role("button", name="Send invite", exact=True))
        expect(owner.get_by_role("status", name="Vault status").first).to_contain_text(
            fill_copy(INVITE_CREATED, {"email": partner_email}), timeout=UI_MS)
        close_dialogs(owner)
        token = invite_token(mail, partner_email)
        ui_open_note(owner, title)
        owner.context.set_offline(True)
        with open_app(browser, app_url) as partner:
            partner.set_viewport_size(DESKTOP)
            ui_create_account(partner, partner_email, partner_name, "partner desk")
            close_dialogs(partner)
            partner.goto(f"{app_url}/invites/{token}")
            click(partner.get_by_role("button", name="Accept invite", exact=True))
            expect(partner.get_by_role("status", name="Vault status").first).to_have_text(
                fill_copy(INVITE_ACCEPTED, {"inviter": owner_name}), timeout=UI_MS)
            partner.goto(f"{app_url}/")
            ui_unlock(partner)
            eventually(partner, lambda: expect(tree_item(partner, title)).to_be_visible(timeout=CHECK_MS))
            ui_open_note(partner, title)
            ui_edit_body(partner, partner_text)
            ui_wait_synced(partner)

            ui_edit_body(owner, owner_text)
            owner.context.set_offline(False)
            conflict = owner.get_by_role("region", name="Conflict")
            eventually(owner, lambda: expect(conflict).to_contain_text(
                "Another device saved this note first. Your version is kept as a conflict copy.", timeout=CHECK_MS))
            copy_title = fill_copy(CONFLICT_TITLE, {"original title": title, "device name": OWNER_LAPTOP})
            expect(tree_item(owner, copy_title)).to_be_visible(timeout=UI_MS)
            body_contains(owner, partner_text, UI_MS)
            click(conflict.get_by_role("link", name="Open conflict copy"))
            body_contains(owner, owner_text, UI_MS)

            original = partner.get_by_role("tree", name="Notes").get_by_role("treeitem", name=title).filter(has_not_text=copy_title)
            click(original.first)
            expect(partner.get_by_role("textbox", name="Note title", exact=True)).to_have_value(title, timeout=UI_MS)
            click(partner.get_by_role("tab", name="History", exact=True))
            buttons = partner.get_by_role("list", name="Revisions").get_by_role("button", name=copy_regex(RESTORE_BUTTON))
            expect(buttons.first).to_be_visible(timeout=UI_MS)
            label = buttons.last.aria_snapshot()
            oldest = int(copy_regex(RESTORE_BUTTON, anchored=False).search(label).group(1))
            click(buttons.last)
            dlg = partner.get_by_role("dialog", name="Restore revision")
            expect(dlg).to_contain_text(fill_copy(RESTORE_ASK, {"rev": oldest}))
            settle_click(dlg.get_by_role("button", name="Restore", exact=True))
            done = copy_regex(RESTORED_COPY, {"rev": oldest})
            status = partner.get_by_role("status", name="Restore status")
            expect(status).to_have_text(done, timeout=UI_MS)
            new = int(done.match(status.inner_text().strip()).group(1))
            vault = ctx_vault(partner, app_url)
            revs = ctx_json(partner, app_url, f"/api/vaults/{vault}/revisions?after=0&limit=500")["revisions"]
        note = next(r["note_id"] for r in revs if r["rev"] == new)
        restored = next(r for r in revs if r["rev"] == new)
        assert restored["restored_from"] == oldest
        assert S3().get(f"vault-blobs/{vault}/{note}/{new}.bin") == S3().get(f"vault-blobs/{vault}/{note}/{oldest}.bin")


def test_wf_shared_vault_invite_wrong_account(browser, app_url, mail):
    owner, vault = sync_owner(app_url, "wrongacc")
    partner = create_account(app_url, "realpartner")
    assert owner.api.post(f"/api/vaults/{vault}/invites", {"email": partner.email}).status_code == 201
    token = invite_token(mail, partner.email)
    name, email = ids_pair("intruder")
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_create_account(page, email, name, "intruder laptop")
        close_dialogs(page)
        page.goto(f"{app_url}/invites/{token}")
        click(page.get_by_role("button", name="Accept invite", exact=True))
        expect(page.get_by_role("status", name="Vault status").first).to_have_text(
            "This invite was sent to a different email address.", timeout=UI_MS)
        assert vault not in [v["id"] for v in ctx_json(page, app_url, "/api/vaults")["vaults"]]
    assert partner.api.post(f"/api/invites/{token}/accept").status_code == 200


def test_version_history(app_url):
    acct, vault = sync_owner(app_url, "hist")
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    pushed(acct.api, vault, a, None, blob())
    pushed(acct.api, vault, b, None, blob())
    pushed(acct.api, vault, a, 1, blob())
    before = history(acct.api, vault, a)
    assert [r["rev"] for r in before] == [3, 1]
    r = restore(acct.api, vault, a, 1, 3)
    assert r.status_code == 201, r.text
    after = acct.api.get(f"/api/vaults/{vault}/notes/{a}/history").json()
    assert after["note_id"] == a
    entries = after["revisions"]
    assert [x["rev"] for x in entries] == [4, 3, 1]
    assert [x["base_revision"] for x in entries] == [3, 1, None]
    assert [x["restored_from"] for x in entries] == [1, None, None]
    for entry in entries:
        assert entry["device_name"] == FIELD_LAPTOP and TIMESTAMP.match(entry["created_at"])
    assert entries[1:] == before


def test_byte_exact_restore(app_url):
    acct, vault = sync_owner(app_url, "restore")
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    original = blob(200)
    pushed(acct.api, vault, a, None, original)
    pushed(acct.api, vault, a, 1, blob())
    other = pushed(acct.api, vault, b, None, blob())
    key = idempotency_key()
    r = restore(acct.api, vault, a, 1, 2, key)
    assert r.status_code == 201, r.text
    rev = r.json()["revision"]
    assert rev["rev"] == 4 and rev["base_revision"] == 2 and rev["restored_from"] == 1
    assert rev["ciphertext_sha256"] == hashlib.sha256(original).hexdigest() and rev["byte_length"] == len(original)
    assert S3().get(f"vault-blobs/{vault}/{a}/4.bin") == original
    assert acct.api.get(f"/api/vaults/{vault}/revisions/4/blob").content == original
    replay = restore(acct.api, vault, a, 1, 2, key)
    assert replay.status_code == 201 and replay.json() == r.json()
    assert replay.headers.get("cairn-replayed", "").lower() == "true"
    stale = restore(acct.api, vault, a, 1, 2)
    assert_error(stale, 409, "revision_conflict")
    assert extra(stale, "head_revision") == 4
    assert_error(restore(acct.api, vault, a, other, 4), 404, "not_found")
    assert [x["rev"] for x in history(acct.api, vault, a)] == [4, 2, 1]
    assert len(S3().keys(f"vault-blobs/{vault}/{a}/")) == 3


def test_concurrent_restore_one_winner(app_url):
    acct, vault = sync_owner(app_url, "rrace")
    note = str(uuid.uuid4())
    pushed(acct.api, vault, note, None, blob())
    pushed(acct.api, vault, note, 1, blob())
    gate = threading.Barrier(PARALLEL)

    def one(_: int) -> httpx.Response:
        gate.wait()
        return restore(acct.api, vault, note, 1, 2)

    with ThreadPoolExecutor(PARALLEL) as pool:
        results = list(pool.map(one, range(PARALLEL)))
    wins = [r for r in results if r.status_code == 201]
    assert len(wins) == 1, [r.status_code for r in results]
    head = wins[0].json()["revision"]["rev"]
    for r in results:
        if r.status_code != 201:
            assert_error(r, 409, "revision_conflict")
            assert extra(r, "head_revision") == head
    assert len(history(acct.api, vault, note)) == 3


def test_wf_version_history_restore(browser, app_url):
    name, email = ids_pair("histui")
    title = f"Tide table {uuid.uuid4().hex[:8]}"
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        first_body = "version one"
        ui_synced_note(page, email, name, "history laptop", title, first_body)
        ui_edit_body(page, "version two")
        vault = ctx_vault(page, app_url)

        def second_revision() -> None:
            assert len(ctx_json(page, app_url, f"/api/vaults/{vault}/revisions")["revisions"]) >= 2

        eventually(page, second_revision)
        ui_wait_synced(page)
        note = ctx_json(page, app_url, f"/api/vaults/{vault}/revisions")["revisions"][-1]["note_id"]
        entries = ctx_json(page, app_url, f"/api/vaults/{vault}/notes/{note}/history")["revisions"]
        click(page.get_by_role("tab", name="History", exact=True))
        listing = page.get_by_role("list", name="Revisions")
        expect(listing.get_by_role("listitem")).to_have_count(len(entries), timeout=UI_MS)
        expect(listing.get_by_role("listitem").first).to_contain_text(fill_copy(REV_LABEL, {"rev": entries[0]["rev"]}))
        oldest = entries[-1]["rev"]
        click(listing.get_by_role("button", name=fill_copy(RESTORE_BUTTON, {"rev": oldest}), exact=True))
        dlg = page.get_by_role("dialog", name="Restore revision")
        eventually(page, lambda: expect(dlg.get_by_role("button", name="Restore", exact=True)).to_be_focused(timeout=CHECK_MS))
        settle_click(dlg.get_by_role("button", name="Restore", exact=True))
        done = copy_regex(RESTORED_COPY, {"rev": oldest})
        status = page.get_by_role("status", name="Restore status")
        expect(status).to_have_text(done, timeout=UI_MS)
        new = int(done.match(status.inner_text().strip()).group(1))
        expect(listing.get_by_role("listitem").first).to_contain_text(fill_copy(REV_LABEL, {"rev": new}), timeout=UI_MS)
        expect(listing.get_by_role("listitem").first).to_contain_text(fill_copy(RESTORED_FROM, {"rev": oldest}))
        body_contains(page, first_body, UI_MS)
        after = ctx_json(page, app_url, f"/api/vaults/{vault}/notes/{note}/history")["revisions"]
    assert after[0]["rev"] == new and after[0]["restored_from"] == oldest
    assert after[1:] == entries
    assert S3().get(f"vault-blobs/{vault}/{note}/{new}.bin") == S3().get(f"vault-blobs/{vault}/{note}/{oldest}.bin")


def test_wf_version_history_cancel(browser, app_url):
    name, email = ids_pair("histcancel")
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_synced_note(page, email, name, "cancel laptop", f"Buoy chart {uuid.uuid4().hex[:8]}", "only version")
        vault = ctx_vault(page, app_url)
        before = ctx_json(page, app_url, f"/api/vaults/{vault}/revisions")["revisions"]
        click(page.get_by_role("tab", name="History", exact=True))
        listing = page.get_by_role("list", name="Revisions")
        opener = listing.get_by_role("button", name=copy_regex(RESTORE_BUTTON)).first
        expect(opener).to_be_visible(timeout=UI_MS)
        entries = entry_names(listing)
        dlg = page.get_by_role("dialog", name="Restore revision")
        click(opener)
        expect(dlg).to_be_visible()
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dlg).to_be_hidden(timeout=CHECK_MS))
        eventually(page, lambda: expect(opener).to_be_focused(timeout=CHECK_MS))
        click(opener)
        settle_click(dlg.get_by_role("button", name="Cancel", exact=True))
        eventually(page, lambda: expect(dlg).to_be_hidden(timeout=CHECK_MS))
        eventually(page, lambda: expect(opener).to_be_focused(timeout=CHECK_MS))
        assert entry_names(listing) == entries, "a dismissed restore must leave the history entries unchanged"
        assert ctx_json(page, app_url, f"/api/vaults/{vault}/revisions")["revisions"] == before


def test_manifest_preview(app_url):
    acct = publisher(app_url, "manifest")
    case = sample_case()
    d = create_dossier(acct, case)
    by_id = {v: k for k, v in case.ids.items()}
    for radius, (public, severed) in HOP_COUNTS.items():
        r = acct.api.post(f"/api/dossiers/{d['id']}/manifest-preview", {"radius": radius, "notes": case.notes()})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["radius"] == radius and body["public_count"] == public and body["severed_count"] == severed
        inside = body["inside"]
        assert {by_id[x["note_id"]]: x["hop"] for x in inside} == {k: h for k, h in HOPS.items() if h <= radius}
        assert inside == sorted(inside, key=lambda x: (x["hop"], x["note_id"]))
    root = case.ids["N0"]
    notes = case.notes()

    def preview(radius: Any, candidates: list[dict]) -> httpx.Response:
        return acct.api.post(f"/api/dossiers/{d['id']}/manifest-preview", {"radius": radius, "notes": candidates})

    assert_field(preview(5, notes), "radius")
    assert_field(preview(-1, notes), "radius")
    without_root = [n for n in notes if n["id"] != root]
    assert_field(preview(1, without_root), "notes")
    assert_error(preview(1, without_root), 422, "validation_failed")["fields"]["notes"] == "must include the root note"
    private_root = [{**n, "private": True} if n["id"] == root else n for n in notes]
    assert assert_error(preview(1, private_root), 422, "validation_failed")["fields"]["notes"] == "root note cannot be private"
    dup_title = notes + [{**notes[1], "id": str(uuid.uuid4()), "aliases": []}]
    assert assert_error(preview(1, dup_title), 422, "validation_failed")["fields"]["notes"] == "duplicate title or alias"
    dup_alias = notes + [{**notes[1], "id": str(uuid.uuid4()), "title": f"Spare {uuid.uuid4().hex[:6]}", "aliases": ["Saltmarsh"]}]
    assert assert_error(preview(1, dup_alias), 422, "validation_failed")["fields"]["notes"] == "duplicate title or alias"
    dup_id = notes + [{**notes[1], "title": f"Spare {uuid.uuid4().hex[:6]}", "aliases": []}]
    assert assert_error(preview(1, dup_id), 422, "validation_failed")["fields"]["notes"] == "duplicate id"
    filler = [{"id": str(uuid.uuid4()), "title": f"Filler {i}", "aliases": [], "frontmatter": {}, "body": "", "private": False}
              for i in range(MAX_CANDIDATES + 1 - len(notes))]
    assert assert_error(preview(1, notes + filler), 422, "validation_failed")["fields"]["notes"] == "at most 500 notes"
    stranger = publisher(app_url, "mfstranger")
    assert_error(stranger.api.post(f"/api/dossiers/{d['id']}/manifest-preview", {"radius": 1, "notes": notes}), 404, "not_found")
    assert S3().keys(f"publish/{d['slug']}/") == []
    assert dossier_state(acct.api, d)["state"] == "draft"


def test_wf_exposure_ring_keyboard(browser, app_url):
    name, email = ids_pair("ringkeys")
    slug = new_slug()
    answers: list[Any] = []
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        page.on("response", lambda resp: answers.append(resp) if "manifest-preview" in resp.url else None)
        ui_workbench(page, email, name, ROOT_TITLE, slug)
        slider = page.get_by_role("slider", name="Publish boundary")
        counts = page.get_by_role("group", name="Exposure counts")
        boundary = page.get_by_role("status", name="Boundary check")
        expect(page.get_by_role("radiogroup", name="Hop")).to_be_visible()
        expect(page.get_by_role("group", name="Exposure Ring")).to_be_visible()

        def settled(hop: int, since: int = 0, sample: bool = True) -> tuple[int, int]:
            seen: dict[str, int] = {}

            def probe() -> None:
                assert slider_state(slider) == [str(hop), hop_name(hop)]
                mine = [a for a in answers[since:] if a.status == 200 and (a.request.post_data_json or {}).get("radius") == hop]
                assert mine, "no manifest preview answer yet"
                body = mine[-1].json()
                n, m = body["public_count"], body["severed_count"]
                counts_say(counts, n, m)
                expect(boundary).to_have_text(match_copy(n, m), timeout=CHECK_MS)
                seen.update(n=n, m=m)

            eventually(page, probe)
            if sample:
                assert (seen["n"], seen["m"]) == HOP_COUNTS[hop]
            return seen["n"], seen["m"]

        slider.focus()
        if slider_state(slider)[0] == "4":
            slider.press("Home")
            settled(0)
        slider.press("End")
        settled(4)
        slider.press("Home")
        settled(0)
        preview = preview_scope(page.get_by_role("region", name="Live preview"))

        def hop_zero_page() -> None:
            expect(preview).to_contain_text("[withheld]", timeout=CHECK_MS)
            expect(preview).to_contain_text("a harbour pilot", timeout=CHECK_MS)
            for title in ("Tender timeline 2025", "Saltmarsh Logistics", "Tender award letter", "Harbour pilot, Vigo"):
                expect(preview).not_to_contain_text(title, timeout=CHECK_MS)
            expect(preview.get_by_role("link", name="a harbour pilot")).to_have_count(0, timeout=CHECK_MS)

        eventually(page, hop_zero_page)
        for hop in range(1, 5):
            slider.press("ArrowRight")
            settled(hop)
        for key, hop in (("ArrowLeft", 3), ("ArrowDown", 2), ("ArrowUp", 3), ("End", 4), ("Home", 0)):
            slider.press(key)
            settled(hop)
        choose(page.get_by_role("radio", name=hop_name(3), exact=True))
        settled(3)
        ui_open_note(page, "Saltmarsh Logistics")
        click(page.get_by_role("button", name="Pin as private"))
        expect(page.get_by_role("button", name="Pin as private", pressed=True)).to_be_visible(timeout=UI_MS)
        mark = len(answers)
        click(page.get_by_role("tab", name="Publish", exact=True))

        def recomputed() -> None:
            assert slider_state(slider) == ["3", hop_name(3)]
            match = copy_regex(COUNTS_COPY, anchored=False).search(flat_text(counts))
            assert match, flat_text(counts)
            n, m = (int(v) for v in match.groups()[:2])
            assert (n, m) != HOP_COUNTS[3], "pinning a hop-1 note must change the boundary"

        eventually(page, recomputed)
        for answer in [a for a in answers[mark:] if a.status == 200]:
            sent = (answer.request.post_data_json or {}).get("notes", [])
            assert all(not (x["title"] == "Saltmarsh Logistics" and not x.get("private")) for x in sent)


def test_wf_exposure_ring_crossing(browser, app_url):
    name, email = ids_pair("crossing")
    counter = copy_regex(COUNTS_COPY, anchored=False)
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_workbench(page, email, name, ROOT_TITLE, new_slug())
        ring = page.get_by_role("group", name="Exposure Ring")
        slider = page.get_by_role("slider", name="Publish boundary")
        counts = page.get_by_role("group", name="Exposure counts")
        preview = page.get_by_role("region", name="Live preview")
        cuts = ring.get_by_role("img", name=copy_regex(CUT_NAME))
        slider.focus()
        slider.press("Home")
        eventually(page, lambda: counts_say(counts, *HOP_COUNTS[0]))
        advance(page, CROSSING_MAX_MS)

        def run(key: str, start_hop: int, end_hop: int, node: str, link_present: bool) -> None:
            final = counts_copy(*HOP_COUNTS[end_hop])
            samples: list[tuple[str, bool]] = []
            deadline = time.monotonic() + UI_WAIT_S
            slider.press(key)
            while time.monotonic() < deadline:
                shown = flat_text(counts)
                ok = (preview_scope(preview).get_by_role("link", name=TITLES["N1"]).count() > 0) == link_present
                samples.append((shown, ok))
                if final in shown and ok:
                    break
                page.clock.run_for(SAMPLE_MS)
            else:
                pytest.fail(f"crossing never finished: counters never showed {final!r} with the preview settled: {samples[-5:]}")
            expect(ring.get_by_role("img", name=node)).to_have_count(1)
            assert cuts.count() > 0, "cut links must be drawn at every hop of the sample case"
            counted = next(i for i, (t, _) in enumerate(samples) if final in t)
            rendered = next(i for i, (_, ok) in enumerate(samples) if ok)
            assert rendered >= counted, f"live preview re-rendered before the counters finished: {samples}"
            lo, hi = sorted((HOP_COUNTS[start_hop][0], HOP_COUNTS[end_hop][0]))
            seen = {int(m.group(1)) for t, _ in samples[:counted] for m in [counter.search(t)] if m}
            assert seen & set(range(lo + 1, hi)), f"counters never counted: {samples}"

        run("ArrowRight", 0, 1, node_name(NODE_PUBLIC, TITLES["N1"], 1), True)
        advance(page, CROSSING_MAX_MS)
        run("ArrowLeft", 1, 0, node_name(NODE_OUTSIDE, TITLES["N1"], 1), False)


def test_wf_exposure_ring_reduced_motion(browser, app_url):
    name, email = ids_pair("reduced")
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        ui_workbench(page, email, name, ROOT_TITLE, new_slug())
        ring = page.get_by_role("group", name="Exposure Ring")
        slider = page.get_by_role("slider", name="Publish boundary")
        counts = page.get_by_role("group", name="Exposure counts")
        announce = page.get_by_role("status", name="Boundary announcement")
        preview = page.get_by_role("region", name="Live preview")
        slider.focus()
        if slider_state(slider)[0] == "0":
            slider.press("ArrowRight")
            page.clock.run_for(SAMPLE_MS)
        slider.press("Home")
        eventually(page, lambda: expect(announce).to_have_text(announce_copy(0), timeout=CHECK_MS))
        eventually(page, lambda: counts_say(counts, *HOP_COUNTS[0]))
        counter = copy_regex(COUNTS_COPY, anchored=False)

        def instant(action: Callable[[], None], start_hop: int, end_hop: int) -> None:
            final = counts_copy(*HOP_COUNTS[end_hop])
            lo, hi = sorted((HOP_COUNTS[start_hop][0], HOP_COUNTS[end_hop][0]))
            seen: list[int] = []
            deadline = time.monotonic() + UI_WAIT_S
            action()
            while time.monotonic() < deadline:
                shown = flat_text(counts)
                match = counter.search(shown)
                if match:
                    seen.append(int(match.group(1)))
                if final in shown:
                    break
                page.clock.run_for(SAMPLE_MS)
            else:
                pytest.fail(f"counters never reached hop {end_hop}: {seen[-5:]}")
            assert not set(seen) & set(range(lo + 1, hi)), f"counters counted under reduced motion: {seen}"

        instant(lambda: slider.press("ArrowRight"), 0, 1)
        expect(ring.get_by_role("img", name=node_name(NODE_PUBLIC, TITLES["N1"], 1))).to_have_count(1)
        eventually(page, lambda: expect(preview_scope(preview).get_by_role("link", name=TITLES["N1"]).first).to_be_visible(timeout=CHECK_MS))
        eventually(page, lambda: expect(announce).to_have_text(announce_copy(1), timeout=CHECK_MS))
        assert ring_motion(ring, counts) == []
        expect(page.get_by_role("radiogroup", name="Hop")).to_be_visible()
        instant(lambda: choose(page.get_by_role("radio", name=hop_name(2), exact=True)), 1, 2)
        eventually(page, lambda: expect(announce).to_have_text(announce_copy(2), timeout=CHECK_MS))
        assert ring_motion(ring, counts) == []
        slider.press("End")
        page.clock.run_for(SAMPLE_MS)
        eventually(page, lambda: counts_say(counts, *HOP_COUNTS[4]))
        eventually(page, lambda: expect(announce).to_have_text(announce_copy(4), timeout=CHECK_MS))
        assert ring_motion(ring, counts) == []


def test_wf_exposure_ring_preview_allowlist(browser, app_url):
    name, email = ids_pair("ringallow")
    dialogs: list[str] = []
    answers: list[Any] = []
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        page.on("response", lambda resp: answers.append(resp) if "manifest-preview" in resp.url else None)
        ui_workbench(page, email, name, "Tender award letter", new_slug())
        target = page.get_by_role("radio", name=hop_name(1), exact=True)
        if target.is_checked():
            choose(page.get_by_role("radio", name=hop_name(0), exact=True))
        choose(target)
        counts = page.get_by_role("group", name="Exposure counts")

        def matched() -> None:
            mine = [a for a in answers if a.status == 200 and (a.request.post_data_json or {}).get("radius") == 1]
            assert mine, "no manifest preview answer yet"
            body = mine[-1].json()
            counts_say(counts, body["public_count"], body["severed_count"])

        eventually(page, matched)
        advance(page, CROSSING_MAX_MS)
        preview = preview_scope(page.get_by_role("region", name="Live preview"))
        expect(preview).to_contain_text("<script>alert('x')</script>", timeout=UI_MS)
        expect(preview).to_contain_text("portal copy")
        expect(preview.get_by_role("link", name="portal copy")).to_have_count(0)
        expect(preview.get_by_role("link", name="registry")).to_have_attribute("href", "https://registry.example/filing/2291")
        assert preview.evaluate("e => [...e.querySelectorAll('img')].filter(i => i.getAttribute('src') === 'x').length") == 0
        advance(page, CROSSING_MAX_MS)
    assert dialogs == []


def test_dossier_lifecycle(app_url):
    acct = publisher(app_url, "life")
    case = sample_case()
    d = create_dossier(acct, case)
    assert d["state"] == "draft" and d["url"] == f"/d/{d['slug']}/"
    base = f"/api/dossiers/{d['id']}"

    def refused(path: str, state: str, body: Any = None) -> None:
        r = acct.api.post(f"{base}/{path}", body)
        assert_error(r, 409, "invalid_transition")
        assert extra(r, "state") == state

    refused("reopen", "draft")
    refused("unpublish", "draft")
    l1 = preview_link(acct.api, d, case, 1).json()["preview_link"]
    assert dossier_state(acct.api, d)["state"] == "in_review"
    l2 = preview_link(acct.api, d, case, 1).json()["preview_link"]
    links = {x["id"]: x["state"] for x in acct.api.get(f"{base}/preview-links").json()["preview_links"]}
    assert links[l1["id"]] == "replaced" and links[l2["id"]] == "active"
    assert acct.api.delete(f"{base}/preview-links/{l2['id']}").status_code == 200
    assert dossier_state(acct.api, d)["state"] == "draft"
    l3 = preview_link(acct.api, d, case, 1).json()["preview_link"]
    assert publish(acct.api, d, case, 1).status_code == 200
    assert dossier_state(acct.api, d)["state"] == "published"
    links = {x["id"]: x["state"] for x in acct.api.get(f"{base}/preview-links").json()["preview_links"]}
    assert links[l3["id"]] == "revoked"
    r = preview_link(acct.api, d, case, 1)
    assert_error(r, 409, "invalid_transition")
    assert extra(r, "state") == "published"
    refused("reopen", "published")
    gate = threading.Barrier(4)

    def one(_: int) -> httpx.Response:
        gate.wait()
        return publish(acct.api, d, case, 2)

    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(one, range(4)))
    assert any(r.status_code == 200 for r in results)
    for r in results:
        if r.status_code != 200:
            assert_error(r, 409, "publish_in_progress")
    assert acct.api.post(f"{base}/unpublish").json()["dossier"]["state"] == "unpublished"
    r = publish(acct.api, d, case, 1)
    assert_error(r, 409, "invalid_transition")
    assert extra(r, "state") == "unpublished"
    refused("unpublish", "unpublished")
    assert acct.api.post(f"{base}/reopen").json()["dossier"]["state"] == "draft"
    assert publish(acct.api, d, case, 1).json()["dossier"]["state"] == "published"
    other = publisher(app_url, "lifeother")
    assert_error(other.api.get(base), 404, "not_found")
    assert_error(acct.api.post("/api/dossiers", {"slug": d["slug"], "root_note_id": case.ids["N0"]}), 409, "slug_taken")
    assert_field(acct.api.post("/api/dossiers", {"slug": "Bad Slug!", "root_note_id": case.ids["N0"]}), "slug")
    nopub = create_account(app_url, "nopub")
    assert_error(nopub.api.post("/api/dossiers", {"slug": new_slug(), "root_note_id": case.ids["N0"]}), 402, "publish_not_entitled")


def same_app(href: str, app_url: str) -> bool:
    a, b = urlsplit(href), urlsplit(app_url)
    loopback = {"localhost", "127.0.0.1", "::1"}
    return a.netloc == b.netloc or (a.port == b.port and a.hostname in loopback and b.hostname in loopback)


def outside_ids(case: Case, radius: int) -> list[str]:
    inside = {k for k, h in HOPS.items() if h <= radius}
    return [note_id for key, note_id in case.ids.items() if key not in inside]


def served_pages(objects: dict[str, bytes]) -> dict[str, bytes]:
    return {k: v for k, v in objects.items() if k.endswith((".html", ".xml")) or "index" in k.rsplit("/", 1)[-1]}


def test_no_leak_beyond_boundary(app_url):
    acct = publisher(app_url, "leak")
    case = sample_case()
    narrow = published(acct, case, 1)
    wide = published(acct, case, 4)
    draft = create_dossier(acct, case)
    r = preview_link(acct.api, draft, case, 4)
    assert r.status_code == 201
    link_id = r.json()["preview_link"]["id"]
    outside_narrow = NEVER_PUBLIC + [TITLES[k] for k, h in HOPS.items() if h >= 2] + ["M. Quint", "procurement officer"]
    ids = list(case.ids.values())
    narrow_objects = store_objects(f"publish/{narrow['slug']}/")
    wide_objects = store_objects(f"publish/{wide['slug']}/")
    preview_objects = store_objects(f"preview/{link_id}/")
    assert narrow_objects and wide_objects and preview_objects
    assert leaks(narrow_objects, outside_narrow + outside_ids(case, 1)) == []
    assert leaks(wide_objects, NEVER_PUBLIC + outside_ids(case, 4)) == []
    assert leaks(preview_objects, NEVER_PUBLIC + outside_ids(case, 4)) == []
    for objects in (narrow_objects, wide_objects, preview_objects):
        assert leaks(served_pages(objects), ids) == []
    with reader(app_url) as http:
        root = parse(http.get(f"/d/{narrow['slug']}/").text)
        assert "a harbour pilot" in root.text
        assert not [a for a in root.anchors if "harbour pilot" in a["text"]]
        timeline = parse(http.get(f"/d/{narrow['slug']}/{PAGE_SLUGS['N1']}").text)
        assert "[withheld]" in timeline.text
        assert not [a for a in timeline.anchors if PAGE_SLUGS["N4"] in a["attrs"].get("href", "")]
        index = http.get(f"/d/{narrow['slug']}/search-index.json").json()
        titles = json.dumps(index)
        assert all(TITLES[k] not in titles for k, h in HOPS.items() if h >= 2)


def test_wf_publish_dossier_happy(browser, app_url):
    name, email = ids_pair("pubui")
    slug = new_slug()
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_workbench(page, email, name, ROOT_TITLE, slug)
        n, m = ui_set_hop(page, 2)
        ui_publish(page, n, m)
        dossier = ctx_dossier(page, app_url, slug)
    assert dossier["state"] == "published" and dossier["radius"] == 2 and dossier["public_count"] == n
    with open_app(browser, f"{app_url}/d/{slug}/") as reader_page:
        expect(reader_page.get_by_role("heading", level=1)).to_have_text(ROOT_TITLE)
        expect(reader_page.get_by_role("navigation", name="Dossier").get_by_role("link")).to_have_count(n)
    keys = S3().keys(f"publish/{slug}/")
    for suffix in ("index.html", "search-index.json", "previews.json", "sitemap.xml", "assets/reader.css",
                   "assets/reader.js", f"pages/{PAGE_SLUGS['N4']}.html"):
        assert any(k.endswith(suffix) for k in keys), suffix


def test_wf_publish_dossier_private_pin(browser, app_url):
    name, email = ids_pair("pinpub")
    slug = new_slug()
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_workbench(page, email, name, ROOT_TITLE, slug)
        ui_open_note(page, "Saltmarsh Logistics")
        click(page.get_by_role("button", name="Pin as private"))
        expect(page.get_by_role("button", name="Pin as private", pressed=True)).to_be_visible(timeout=UI_MS)
        advance(page, SAVE_SETTLE_MS)
        ui_open_note(page, ROOT_TITLE)
        click(page.get_by_role("tab", name="Publish", exact=True))
        choose(page.get_by_role("radio", name=hop_name(2), exact=True))
        advance(page, 4 * CROSSING_MAX_MS)
        eventually(page, lambda: expect(page.get_by_role("status", name="Boundary check")).to_contain_text(
            "Server boundary matches:", timeout=CHECK_MS))
        click(page.get_by_role("button", name="Publish dossier", exact=True))
        dlg = page.get_by_role("dialog", name="Publish dossier")
        ask = copy_regex(CONFIRM_COPY, anchored=False)
        expect(dlg).to_contain_text(ask)
        n, m = map(int, ask.search(dlg.inner_text()).groups())
        settle_click(dlg.get_by_role("button", name="Publish now", exact=True))
        expect(page.get_by_role("status", name="Publish status")).to_have_text(
            fill_copy(PUBLISHED_COPY, {"N": n, "M": m}), timeout=UI_MS)
        dossier = ctx_dossier(page, app_url, slug)
    assert (dossier["public_count"], dossier["severed_count"]) == (n, m)
    objects = store_objects(f"publish/{slug}/")
    assert objects and leaks(objects, ["Saltmarsh", "Harbour pilot, Vigo", "Procurement clerk"]) == []
    with reader(app_url) as http:
        assert http.get(f"/d/{slug}/{PAGE_SLUGS['N2']}").status_code == 404
        assert http.get(f"/d/{slug}/{PAGE_SLUGS['N1']}").status_code == 200


def test_preview_links(app_url):
    acct = publisher(app_url, "preview")
    case = sample_case()
    d = create_dossier(acct, case)
    published(acct, case, 1)
    r1 = preview_link(acct.api, d, case, 0)
    assert r1.status_code == 201, r1.text
    l1, url1 = r1.json()["preview_link"], r1.json()["url"]
    assert l1["state"] == "active" and re.fullmatch(r"/p/[A-Za-z0-9_\-]+=*/", url1)
    with reader(app_url) as http:
        page = http.get(url1)
        assert page.status_code == 200
        assert "noindex" in page.headers.get("x-robots-tag", "")
        assert "no-cache" in page.headers.get("cache-control", "")
        assert "Draft preview · expires" in unescape(page.text)
        assert http.get(f"{url1}{PAGE_SLUGS['N1']}").status_code == 404
        assert http.get(f"{url1}previews.json").status_code == 200
        for method in ("POST", "PUT", "DELETE", "PATCH"):
            assert http.request(method, url1).status_code == 405, method
        assert http.get(f"/p/{uuid.uuid4().hex}/").status_code == 404
        assert S3().keys(f"preview/{l1['id']}/")
        r2 = preview_link(acct.api, d, case, 1)
        l2, url2 = r2.json()["preview_link"], r2.json()["url"]
        ended = http.get(url1)
        assert ended.status_code == 410 and "This preview link has ended." in ended.text
        assert http.get(f"{url2}{PAGE_SLUGS['N1']}").status_code == 200
        listing = acct.api.get(f"/api/dossiers/{d['id']}/preview-links")
        states = [(x["id"], x["state"]) for x in listing.json()["preview_links"]]
        assert states == [(l2["id"], "active"), (l1["id"], "replaced")]
        assert url2.strip("/").split("/")[-1] not in listing.text
        revoked = acct.api.delete(f"/api/dossiers/{d['id']}/preview-links/{l2['id']}")
        assert revoked.status_code == 200 and revoked.json()["preview_link"]["state"] == "revoked"
        assert http.get(url2).status_code == 410
        assert http.get(f"{url2}{PAGE_SLUGS['N1']}").status_code == 410
    wait_empty(f"preview/{l2['id']}/")
    assert_error(acct.api.delete(f"/api/dossiers/{d['id']}/preview-links/{l2['id']}"), 409, "preview_link_inactive")


def test_preview_link_expires():
    with app_copy({"CAIRN_PREVIEW_TTL_SECONDS": str(PREVIEW_TTL_S)}) as base:
        acct = publisher(base, "pvexp")
        case = sample_case()
        d = create_dossier(acct, case)
        r = preview_link(acct.api, d, case, 1)
        assert r.status_code == 201
        link, url = r.json()["preview_link"], r.json()["url"]
        with reader(base) as http:
            assert http.get(url).status_code == 200
            wait_server_past(base, ts(link["expires_at"]))
            gone = http.get(url)
            assert gone.status_code == 410 and "This preview link has ended." in gone.text
        assert dossier_state(acct.api, d)["state"] == "draft"
        listing = acct.api.get(f"/api/dossiers/{d['id']}/preview-links").json()["preview_links"]
        assert listing[0]["state"] == "expired"


def test_wf_editor_preview_review(browser, app_url):
    name, email = ids_pair("editor")
    slug = new_slug()
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_workbench(page, email, name, ROOT_TITLE, slug)
        ui_set_hop(page, 1)
        click(page.get_by_role("button", name="Create preview link", exact=True))
        status = page.get_by_role("status", name="Preview link status")
        expect(status).to_contain_text("Preview link ready — expires ", timeout=UI_MS)
        url = page.get_by_role("textbox", name="Preview link").input_value()
        dossier = ctx_dossier(page, app_url, slug)
        tz = ctx_json(page, app_url, "/api/me")["account"]["time_zone"]
        link = ctx_json(page, app_url, f"/api/dossiers/{dossier['id']}/preview-links")["preview_links"][0]
        expect(status).to_have_text(re.compile("Preview link ready — expires " + when_either(link["expires_at"], tz)))
        path = urlsplit(url).path
        with open_app(browser, app_url + path) as editor:
            editor.set_viewport_size(PHONE)
            expect(editor.get_by_role("region", name="Draft preview")).to_contain_text("Draft preview · expires ")
            expect(editor.get_by_role("heading", level=1)).to_have_text(ROOT_TITLE)
            html = editor.content()
            assert [n for n in NEVER_PUBLIC + [TITLES["N4"], TITLES["N5"]] if n in html] == []
            in_main = editor.get_by_role("main").get_by_role("link", name="Tender timeline 2025", exact=True)
            click((in_main if in_main.count() else editor.get_by_role("link", name="Tender timeline 2025", exact=True)).first)
            expect(editor.get_by_role("heading", level=1)).to_have_text("Tender timeline 2025", timeout=UI_MS)
            page.once("dialog", lambda d: d.accept())
            click(page.get_by_role("button", name="Revoke preview link", exact=True))
            confirm(page, re.compile("Revoke"))
            expect(status).to_have_text("Preview link revoked", timeout=UI_MS)
            editor.reload()
            expect(editor.get_by_text("This preview link has ended.")).to_be_visible(timeout=UI_MS)
        listing = ctx_json(page, app_url, f"/api/dossiers/{dossier['id']}/preview-links")["preview_links"]
    assert listing[0]["state"] == "revoked"
    wait_empty(f"preview/{listing[0]['id']}/")


def test_wf_editor_preview_replace(browser, app_url):
    name, email = ids_pair("replace")
    slug = new_slug()
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_workbench(page, email, name, ROOT_TITLE, slug)
        ui_set_hop(page, 1)
        status = page.get_by_role("status", name="Preview link status")
        box = page.get_by_role("textbox", name="Preview link")
        click(page.get_by_role("button", name="Create preview link", exact=True))
        expect(status).to_contain_text("Preview link ready — expires ", timeout=UI_MS)
        first = box.input_value()
        click(page.get_by_role("button", name="Create preview link", exact=True))
        expect(box).to_have_value(re.compile(rf"^(?!{re.escape(first)}$)\S+$"), timeout=UI_MS)
        second = box.input_value()
        dossier = ctx_dossier(page, app_url, slug)
        states = [x["state"] for x in ctx_json(page, app_url, f"/api/dossiers/{dossier['id']}/preview-links")["preview_links"]]
    assert states[:2] == ["active", "replaced"]
    with open_app(browser, app_url + urlsplit(first).path) as editor:
        expect(editor.get_by_text("This preview link has ended.")).to_be_visible(timeout=UI_MS)
    with open_app(browser, app_url + urlsplit(second).path) as editor:
        expect(editor.get_by_role("heading", level=1)).to_have_text(ROOT_TITLE, timeout=UI_MS)


def test_takedown_removes_every_object(app_url):
    acct = publisher(app_url, "takedown")
    case = sample_case()
    d = published(acct, case, 4)
    slug = d["slug"]
    paths = ["", PAGE_SLUGS["N3"], "search?q=Tender", "sitemap.xml", "search-index.json", "previews.json",
             "assets/reader.css", "assets/reader.js"]
    with reader(app_url) as http:
        for path in paths:
            assert http.get(f"/d/{slug}/{path}").status_code == 200, path
        assert http.post(f"/d/{slug}/").status_code == 405
        assert S3().keys(f"publish/{slug}/")
        r = acct.api.post(f"/api/dossiers/{d['id']}/unpublish")
        assert r.status_code == 200 and r.json()["dossier"]["state"] == "unpublished"
        assert S3().keys(f"publish/{slug}/") == []
        for path in paths:
            gone = http.get(f"/d/{slug}/{path}")
            assert gone.status_code == 404, path
        assert "This dossier isn't available." in unescape(http.get(f"/d/{slug}/").text)


def test_narrowing_removes_pages(app_url):
    acct = publisher(app_url, "narrow")
    case = sample_case()
    d = published(acct, case, 4)
    slug = d["slug"]
    with reader(app_url) as http:
        assert http.get(f"/d/{slug}/{PAGE_SLUGS['N4']}").status_code == 200
        assert publish(acct.api, d, case, 1).status_code == 200
        for key in ("N4", "N5", "N6", "N7", "N8", "N9"):
            assert http.get(f"/d/{slug}/{PAGE_SLUGS[key]}").status_code == 404
        for path in ("search-index.json", "previews.json", "sitemap.xml"):
            body = http.get(f"/d/{slug}/{path}").text
            assert "Mara Quint" not in body and PAGE_SLUGS["N4"] not in body, path
        search = http.get(f"/d/{slug}/search", params={"q": "Mara"})
        assert fill_copy(NO_RESULTS, {"q": "Mara"}) in search.text
        keys = settled_keys(f"publish/{slug}/", lambda ks: not [k for k in ks if PAGE_SLUGS["N4"] in k]
                            and len({k.split("/")[2] for k in ks}) == 1)
        assert not [k for k in keys if PAGE_SLUGS["N4"] in k]
        assert len({k.split("/")[2] for k in keys}) == 1, "previous publish objects must be deleted"
        assert publish(acct.api, d, case, 1, private=("N2",)).status_code == 200
        assert http.get(f"/d/{slug}/{PAGE_SLUGS['N2']}").status_code == 404
        assert "Saltmarsh" not in http.get(f"/d/{slug}/search-index.json").text
        assert "Saltmarsh" not in http.get(f"/d/{slug}/previews.json").text
        assert PAGE_SLUGS["N2"] not in http.get(f"/d/{slug}/sitemap.xml").text
    settled_keys(f"publish/{slug}/", lambda _keys: leaks(store_objects(f"publish/{slug}/"), ["Saltmarsh"]) == [])
    assert leaks(store_objects(f"publish/{slug}/"), ["Saltmarsh"]) == []


def test_wf_takedown_dossier(browser, app_url):
    name, email = ids_pair("tdui")
    slug = new_slug()
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_workbench(page, email, name, ROOT_TITLE, slug)
        ui_publish(page, *ui_set_hop(page, 1))
        assert S3().keys(f"publish/{slug}/")
        click(page.get_by_role("button", name="Take down dossier", exact=True))
        settle_click(page.get_by_role("dialog", name="Take down dossier").get_by_role("button", name="Take down", exact=True))
        expect(page.get_by_role("status", name="Publish status")).to_have_text("Dossier taken down", timeout=UI_MS)
        expect(page.get_by_role("status", name="Dossier state")).to_have_text("Unpublished")
    assert S3().keys(f"publish/{slug}/") == []
    with open_app(browser, f"{app_url}/d/{slug}/") as reader_page:
        expect(reader_page.get_by_text("This dossier isn't available.")).to_be_visible(timeout=UI_MS)


def test_wf_takedown_reopen(browser, app_url):
    name, email = ids_pair("reopen")
    slug = new_slug()
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_workbench(page, email, name, ROOT_TITLE, slug)
        ui_publish(page, *ui_set_hop(page, 1))
        click(page.get_by_role("button", name="Take down dossier", exact=True))
        settle_click(page.get_by_role("dialog", name="Take down dossier").get_by_role("button", name="Take down", exact=True))
        expect(page.get_by_role("status", name="Publish status")).to_have_text("Dossier taken down", timeout=UI_MS)
        eventually(page, lambda: expect(page.get_by_role("dialog", name="Take down dossier")).to_be_hidden(timeout=CHECK_MS))
        click(page.get_by_role("button", name="Reopen as draft", exact=True))
        expect(page.get_by_role("status", name="Publish status")).to_have_text("Reopened as draft", timeout=UI_MS)
        expect(page.get_by_role("status", name="Dossier state")).to_have_text("Draft")
        assert ctx_dossier(page, app_url, slug)["state"] == "draft"


def test_allowlisted_pages(app_url):
    acct = publisher(app_url, "allow")
    case = sample_case()
    live = published(acct, case, 1)
    draft = create_dossier(acct, case)
    url = preview_link(acct.api, draft, case, 1).json()["url"]
    with reader(app_url) as http:
        for path in (f"/d/{live['slug']}/{PAGE_SLUGS['N3']}", f"{url}{PAGE_SLUGS['N3']}"):
            r = http.get(path)
            assert r.status_code == 200, path
            assert r.headers.get("content-security-policy")
            assert "no-cache" in r.headers.get("cache-control", "")
            doc = parse(r.text)
            scripts = [a for t, a in doc.elements if t == "script"]
            assert len(scripts) == 1 and scripts[0].get("src", "").endswith("assets/reader.js"), scripts
            assert "".join(doc._script_text).strip() == ""
            assert not [t for t, _ in doc.elements if t in ACTIVE_TAGS]
            for tag, attrs in doc.elements:
                assert not [k for k in attrs if k.startswith("on")], (tag, attrs)
                assert "style" not in attrs, tag
            for a in doc.anchors:
                href = a["attrs"].get("href", "")
                scheme = urlsplit(href).scheme
                assert scheme in ("", "http", "https", "mailto"), href
                if scheme in ("http", "https") and not same_app(href, app_url):
                    rel = a["attrs"].get("rel", "").split()
                    assert {"noopener", "noreferrer", "nofollow"} <= set(rel), a
            assert "<script>alert('x')</script>" in doc.text
            assert "<img src=\"x\" onerror=\"alert('x')\">" in doc.text
            assert "portal copy" in doc.text
            assert not [a for a in doc.anchors if "portal copy" in a["text"]]
            assert [a["attrs"]["href"] for a in doc.anchors if a["text"].strip() == "registry"] == ["https://registry.example/filing/2291"]
            assert "PE-2026-03" not in r.text


def test_wf_public_reading_phone(browser, app_url):
    acct = publisher(app_url, "reader")
    case = sample_case()
    d = published(acct, case, 4)
    slug = d["slug"]
    inside = {TITLES[k] for k in HOPS}
    with open_app(browser, f"{app_url}/d/{slug}/") as page:
        page.set_viewport_size(PHONE)
        h1 = page.get_by_role("heading", level=1)
        expect(h1).to_have_text(ROOT_TITLE, timeout=UI_MS)
        expect(page.get_by_role("navigation", name="Dossier").get_by_role("link")).to_have_count(HOP_COUNTS[4][0])
        layout(page)
        in_main = page.get_by_role("main").get_by_role("link", name="Tender award letter", exact=True)
        click((in_main if in_main.count() else page.get_by_role("link", name="Tender award letter", exact=True)).first)
        expect(h1).to_have_text("Tender award letter", timeout=UI_MS)
        click(page.get_by_role("region", name="Linked from").get_by_role("link", name=ROOT_TITLE, exact=True))
        expect(h1).to_have_text(ROOT_TITLE, timeout=UI_MS)
        fill(page.get_by_role("searchbox", name="Search this dossier"), "Northgate")
        click(page.get_by_role("button", name="Search", exact=True))
        results = page.get_by_role("list", name="Search results")
        expect(results.get_by_role("link", name="Northgate Holdings")).to_be_visible(timeout=UI_MS)
        names = [" ".join(x.split()) for x in results.get_by_role("link").all_inner_texts()]
        assert names and all(any(n.startswith(title) for title in inside) for n in names), names
        fill(page.get_by_role("searchbox", name="Search this dossier"), "Offshore")
        click(page.get_by_role("button", name="Search", exact=True))
        expect(page.get_by_text(fill_copy(NO_RESULTS, {"q": "Offshore"}))).to_be_visible(timeout=UI_MS)
        layout(page)
        assert publish(acct.api, d, case, 1).status_code == 200
        fill(page.get_by_role("searchbox", name="Search this dossier"), "Mara")
        click(page.get_by_role("button", name="Search", exact=True))
        expect(page.get_by_text(fill_copy(NO_RESULTS, {"q": "Mara"}))).to_be_visible(timeout=UI_MS)
        page.goto(f"{app_url}/d/{slug}/{PAGE_SLUGS['N4']}")
        expect(page.get_by_text("This dossier isn't available.")).to_be_visible(timeout=UI_MS)
    sitemap = next(v for k, v in store_objects(f"publish/{slug}/").items() if k.endswith("sitemap.xml")).decode()
    assert PAGE_SLUGS["N3"] in sitemap and slug_of(TITLES["N10"]) not in sitemap


def test_wf_takedown_narrowed(browser, app_url):
    acct = publisher(app_url, "narrowui")
    case = sample_case()
    d = published(acct, case, 4)
    slug = d["slug"]
    with open_app(browser, f"{app_url}/d/{slug}/{PAGE_SLUGS['N4']}") as page:
        page.set_viewport_size(PHONE)
        expect(page.get_by_role("heading", level=1)).to_have_text("Mara Quint", timeout=UI_MS)
        assert publish(acct.api, d, case, 1).status_code == 200
        page.reload()
        expect(page.get_by_text("This dossier isn't available.")).to_be_visible(timeout=UI_MS)
        page.goto(f"{app_url}/d/{slug}/")
        expect(page.get_by_role("navigation", name="Dossier").get_by_role("link", name="Mara Quint")).to_have_count(0)
    keys = settled_keys(f"publish/{slug}/", lambda ks: not [k for k in ks if PAGE_SLUGS["N4"] in k])
    assert not [k for k in keys if PAGE_SLUGS["N4"] in k]


def test_killbill_subscriptions(app_url, killbill):
    acct = create_account(app_url, "kb", tz="America/Bogota")
    body = subscribe(acct, "sync")
    assert body["sync"]["state"] == "active" and body["sync"]["source"] == "killbill"
    assert body["publish"]["state"] == "none"
    kb = killbill.account_by_key(acct.account["id"])
    assert kb is not None
    assert kb["email"].lower() == acct.email.lower() and kb["currency"] == "USD"
    assert kb["timeZone"] == "America/Bogota" and kb["name"] == acct.name
    assert killbill.account(acct.email)["externalKey"] == acct.account["id"]
    assert_error(acct.api.post("/api/billing/subscriptions", {"addon": "sync"}), 409, "already_subscribed")
    assert_field(acct.api.post("/api/billing/subscriptions", {"addon": "gold"}), "addon")
    assert_error(cancel_addon(acct.api, "publish"), 409, "not_subscribed")
    wait_invoiced(killbill, acct.email)
    r = cancel_addon(acct.api, "sync")
    assert r.status_code == 200, r.text
    sync = r.json()["sync"]
    assert sync["state"] == "ending"
    end = ts(sync["period_end"]).astimezone(ZoneInfo("America/Bogota"))
    assert end.hour == 0 and end.minute == 0
    assert ts(sync["period_end"]) > ts(sync["checked_at"])
    ops = ops_api(app_url)
    rows = {row["account"]["email"]: row for row in ops.get("/api/ops/accounts").json()["accounts"]}
    ines = rows[INES_EMAIL]
    assert ines["sync"]["state"] == "active" and ines["publish"]["state"] == "active"
    assert killbill.account_by_key(ines["account"]["id"]) is not None


def test_sync_grace_deadline(app_url, killbill):
    acct, vault = sync_owner(app_url, "grace")
    note = str(uuid.uuid4())
    rev = pushed(acct.api, vault, note, None, blob())
    wait_invoiced(killbill, acct.email)
    sync = cancel_addon(acct.api, "sync").json()["sync"]
    assert sync["state"] == "ending"
    assert ts(sync["writable_until"]) == local_midnight_after(sync["period_end"], TZ, SYNC_GRACE_DAYS)
    assert pushed(acct.api, vault, note, rev, blob()) == rev + 1
    assert len(revisions(acct.api, vault)) == 2
    assert acct.api.get("/api/billing").json()["sync"]["writable_until"] == sync["writable_until"]


def test_publish_retention_deadlines(app_url, mail, killbill):
    acct = publisher(app_url, "retain")
    case = sample_case()
    d = published(acct, case, 1)
    wait_invoiced(killbill, acct.email)
    pub = cancel_addon(acct.api, "publish").json()["publish"]
    assert pub["state"] == "ending"
    takedown = local_midnight_after(pub["period_end"], TZ, TAKEDOWN_DAYS)
    assert ts(pub["takedown_at"]) == takedown
    assert ts(pub["warning_at"]) == local_midnight_after(pub["period_end"], TZ, TAKEDOWN_DAYS - WARNING_DAYS)
    assert ts(pub["warning_at"]) < ts(pub["takedown_at"])
    run_sweep(ops_api(app_url))
    assert dossier_state(acct.api, d)["state"] == "published"
    with reader(app_url) as http:
        assert http.get(f"/d/{d['slug']}/").status_code == 200
    assert mails_now(mail, acct.email, "Cairn Publish: your dossiers go offline on") == []


def killbill_subscriptions(killbill: Any, email: str) -> list[dict]:
    account = killbill.account(email)
    if account is None:
        return []
    r = killbill.client.get(f"/accounts/{account['accountId']}/bundles")
    assert r.status_code in (200, 404), r.text
    return [s for b in (r.json() if r.status_code == 200 else []) for s in b.get("subscriptions") or []]


def wait_invoiced(killbill: Any, email: str) -> None:
    deadline = time.monotonic() + MAIL_WAIT_S
    while not any(s.get("chargedThroughDate") for s in killbill_subscriptions(killbill, email)):
        assert time.monotonic() < deadline, f"Kill Bill never invoiced the subscription for {email}"


def server_now(base: str) -> datetime:
    r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
    return parsedate_to_datetime(r.headers["date"])


def end_in_killbill(killbill: Any, account_id: str, plan: str, day: Any) -> None:
    kb_account = killbill.account_by_key(account_id)
    assert kb_account is not None
    root = os.environ["KILLBILL_URL"].rstrip("/")
    headers = {"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
               "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
               "X-Killbill-CreatedBy": "verifier"}
    auth = (os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"])
    with httpx.Client(timeout=HTTP_TIMEOUT, headers=headers, auth=auth) as http:
        r = http.get(f"{root}/1.0/kb/accounts/{kb_account['accountId']}/bundles")
        assert r.is_success, r.text
        subs = [s for b in r.json() for s in b.get("subscriptions", [])
                if s.get("planName") == plan and s.get("state") != "CANCELLED"]
        assert len(subs) == 1, subs
        r = http.delete(f"{root}/1.0/kb/subscriptions/{subs[0]['subscriptionId']}",
                        params={"requestedDate": day.isoformat(), "useRequestedDateForBilling": "true"})
        assert r.is_success, r.text


def test_sync_lapse_read_only(killbill):
    with app_copy({"CAIRN_SYNC_GRACE_SECONDS": str(GRACE_LONG_S)}) as grace_base:
        acct, vault = sync_owner(grace_base, "lapsesync")
        note = str(uuid.uuid4())
        first = blob()
        rev = pushed(acct.api, vault, note, None, first)
        day = server_now(grace_base).astimezone(ZoneInfo(TZ)).date()
        end_in_killbill(killbill, acct.account["id"], "cairn-sync-monthly", day)
        period_end = datetime.combine(day, clock_time(0), tzinfo=ZoneInfo(TZ))
        rev2 = pushed(acct.api, vault, note, rev, blob())
        sync = acct.api.get("/api/billing").json()["sync"]
        assert sync["state"] == "grace" and ts(sync["period_end"]) == period_end, sync
        with app_copy({"CAIRN_SYNC_GRACE_SECONDS": str(SHORT_TTL_S)}) as lapsed_base:
            wait_server_past(lapsed_base, period_end + timedelta(seconds=SHORT_TTL_S))
            api = sign_in(lapsed_base, acct, acct.device["id"], FIELD_LAPTOP)
            assert_error(push(api, vault, note, rev2, blob()), 403, "vault_read_only")
            assert_error(restore(api, vault, note, rev, rev2), 403, "vault_read_only")
            assert [r["rev"] for r in revisions(api, vault)] == [rev, rev2]
            got = api.get(f"/api/vaults/{vault}/revisions/{rev}/blob")
            assert got.status_code == 200 and got.content == first
            assert [r["rev"] for r in history(api, vault, note)] == [rev2, rev]
    assert len(S3().keys(f"vault-blobs/{vault}/")) == 2


def test_publish_lapse_takedown(killbill, mail):
    subject = "Cairn Publish: your dossiers go offline on"
    with app_copy({"CAIRN_PUBLISH_RETENTION_SECONDS": str(RETENTION_S),
                   "CAIRN_PUBLISH_WARNING_LEAD_SECONDS": str(SHORT_TTL_S),
                   "CAIRN_SWEEP_INTERVAL_SECONDS": str(SWEEP_MAX_S)}) as base:
        acct = publisher(base, "lapsepub")
        case = sample_case()
        d = published(acct, case, 1)
        slug = d["slug"]
        ops = ops_api(base)
        day = server_now(base).astimezone(ZoneInfo(TZ)).date()
        end_in_killbill(killbill, acct.account["id"], "cairn-publish-monthly", day)
        takedown = datetime.combine(day, clock_time(0), tzinfo=ZoneInfo(TZ)) + timedelta(seconds=RETENTION_S)
        wait_server_past(base, takedown)
        deadline = time.monotonic() + SWEEP_WAIT_S
        while dossier_state(acct.api, d)["state"] != "lapsed":
            assert time.monotonic() < deadline, "dossier never lapsed"
            r = ops.post("/api/ops/sweep")
            if r.status_code == 409:
                assert_error(r, 409, "sweep_running")
                continue
            assert r.status_code == 200, r.text
        warnings = mails_to(mail, acct.email, subject)
        assert len(warnings) == 1, f"expected exactly one warning email, got {len(warnings)}"
        message = warnings[0]
        assert re.search(when_pattern(takedown.isoformat(), TZ), message["Subject"]), message["Subject"]
        assert f"/d/{slug}/" in text(message)
        with reader(base) as http:
            assert http.get(f"/d/{slug}/").status_code == 404
        assert S3().keys(f"publish/{slug}/") == []


def run_lapse_check(page: Page, done: Callable[[], None]) -> None:
    deadline = time.monotonic() + SWEEP_WAIT_S
    while time.monotonic() <= deadline:
        click(page.get_by_role("button", name="Run lapse check now", exact=True))
        try:
            done()
            return
        except AssertionError:
            continue
    click(page.get_by_role("button", name="Run lapse check now", exact=True))
    done()


def test_wf_subscription_lapse_console(browser, app_url):
    acct, vault = sync_owner(app_url, "console")
    subscribe(acct, "publish")
    datas = [blob(100), blob(300)]
    note = str(uuid.uuid4())
    pushed(acct.api, vault, note, None, datas[0])
    pushed(acct.api, vault, note, 1, datas[1])
    case = sample_case()
    d = published(acct, case, 1)
    assert_error(acct.api.get("/api/ops/accounts"), 403, "not_operator")
    assert_error(acct.api.post("/api/ops/sweep"), 403, "not_operator")
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_sign_in(page, OPS_EMAIL, OPS_PASSWORD, "ops desk")
        expect(account_dialog(page).get_by_role("status", name="Account status")).to_contain_text(
            fill_copy(SIGNED_IN, {"email": OPS_EMAIL}), timeout=UI_MS)
        page.goto(f"{app_url}/ops")
        expect(page.get_by_role("status", name="Billing source")).to_have_text("Live from Kill Bill", timeout=UI_MS)
        rows = page.get_by_role("table", name="Accounts").get_by_role("row")
        row = (rows.filter(has_text=acct.email).or_(rows.filter(has_text=acct.name))
               .or_(rows.filter(has_text=acct.account["id"])))
        expect(row).to_contain_text(d["slug"], timeout=UI_MS)
        assert ROOT_TITLE not in row.inner_text()
        lapse = page.get_by_role("status", name="Lapse check")
        run_lapse_check(page, lambda: expect(lapse).to_have_text(copy_regex(LAPSE_DONE), timeout=UI_MS))
        entry = next(x for x in ctx_json(page, app_url, "/api/ops/accounts")["accounts"] if x["account"]["email"] == acct.email)
        assert entry["vault_count"] == 1 and entry["blob_count"] == 2
        assert entry["stored_bytes"] == sum(len(x) for x in datas)
        assert entry["blob_count"] == len(S3().keys(f"vault-blobs/{vault}/"))
        assert [x["slug"] for x in entry["live_dossiers"]] == [d["slug"]]
        assert acct.api.post(f"/api/dossiers/{d['id']}/unpublish").status_code == 200
        run_lapse_check(page, lambda: expect(row).not_to_contain_text(d["slug"], timeout=UI_MS))
        entry = next(x for x in ctx_json(page, app_url, "/api/ops/accounts")["accounts"] if x["account"]["email"] == acct.email)
        assert entry["live_dossiers"] == []


def test_wf_subscription_lapse_cancel_ui(browser, app_url, killbill):
    name, email = ids_pair("cancelui")
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        ui_create_account(page, email, name, "plan laptop")
        ui_plan(page, "Add Sync", "Sync active")
        wait_invoiced(killbill, email)
        ui_plan(page, "Cancel Sync", "Sync ends ")
        billing = ctx_json(page, app_url, "/api/billing")
        me = ctx_json(page, app_url, "/api/me")["account"]
        expect(account_dialog(page).get_by_role("status", name="Plan status")).to_contain_text(
            copy_regex(SYNC_ENDS, anchored=False,
                       raw={"when": when_pattern(billing["sync"]["period_end"], me["time_zone"])}))
    assert billing["sync"]["state"] == "ending"
    kb = killbill.account_by_key(me["id"])
    assert kb is not None and kb["email"].lower() == email.lower() and kb["currency"] == "USD"


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_responsive_layout(browser, app_url, viewport):
    size = VIEWPORTS[viewport]
    acct = publisher(app_url, "layout")
    d = published(acct, sample_case(), 1)
    with open_app(browser, app_url) as page:
        page.set_viewport_size(size)
        page.reload()
        files = page.get_by_role("button", name="Files", exact=True)
        context = page.get_by_role("button", name="Context", exact=True)
        rail = page.get_by_role("navigation", name="Case files")
        pane = page.get_by_role("complementary", name="Context")
        if size["width"] >= 1024:
            expect(rail).to_be_visible()
            expect(files).to_have_count(0) if files.count() == 0 else expect(files).to_be_hidden()
            click(page.get_by_role("button", name="Load sample case", exact=True))
        else:
            expect(files).to_be_visible()
            click(files)
            advance(page, SLIDE_SETTLE_MS)
            expect(rail).to_be_visible()
            click(page.get_by_role("button", name="Load sample case", exact=True))
            close_dialogs(page)
            page.keyboard.press("Escape")
            eventually(page, lambda: assert_closed(rail))
            eventually(page, lambda: (_ for _ in ()).throw(AssertionError("rail still moving")) if moving(page.locator("body")) else None)
        fits(page)
        if size["width"] < 760:
            expect(context).to_be_visible()
            assert_closed(pane)
            click(context)
            advance(page, SLIDE_SETTLE_MS)
        expect(pane).to_be_visible()
        click(pane.get_by_role("tab", name="Publish", exact=True))
        fits(page)
        for path in ("/ops", f"/devices/approve/{uuid.uuid4().hex}", f"/invites/{uuid.uuid4().hex}", f"/d/{d['slug']}/"):
            page.goto(app_url + path)
            fits(page)


def test_keyboard_and_focus(browser, app_url):
    with open_app(browser, app_url) as page:
        page.set_viewport_size(DESKTOP)
        click(page.get_by_role("button", name="Load sample case", exact=True))
        ui_open_note(page, ROOT_TITLE)
        page.evaluate("""() => { const s = document.createElement('span'); s.tabIndex = -1; s.id = 'tab-start';
                                 document.body.prepend(s); s.focus(); }""")
        names = focus_names(page, TAB_BUDGET)
        page.evaluate("() => document.getElementById('tab-start')?.remove()")
        wanted = (("button", "Account"), ("button", "New note"), ("textbox", "Note title"), ("tab", None))
        order = [next(i for i, (role, name) in enumerate(names) if role == r and (n is None or name == n))
                 for r, n in wanted]
        assert order == sorted(order), names
        for locator in (page.get_by_role("button", name="New note", exact=True), page.get_by_role("button", name="Account", exact=True)):
            assert ring_visible(page, locator), "no visible focus ring"
        opener = page.get_by_role("button", name="Account", exact=True)
        click(opener)
        dlg = page.get_by_role("dialog", name="Account")
        handle = dlg.element_handle()

        def focus_inside() -> None:
            assert page.evaluate("d => d.contains(document.activeElement)", handle), "focus is not in the dialog"

        eventually(page, focus_inside)
        for _ in range(15):
            page.keyboard.press("Tab")
            assert page.evaluate("d => d.contains(document.activeElement)", handle), "focus escaped the dialog"
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dlg).to_be_hidden(timeout=CHECK_MS))
        eventually(page, lambda: expect(opener).to_be_focused(timeout=CHECK_MS))
        page.set_viewport_size(TABLET)
        page.reload()
        files = page.get_by_role("button", name="Files", exact=True)
        click(files)
        advance(page, SLIDE_SETTLE_MS)
        expect(page.get_by_role("navigation", name="Case files")).to_be_visible()
        page.keyboard.press("Escape")
        eventually(page, lambda: assert_closed(page.get_by_role("navigation", name="Case files")))
        eventually(page, lambda: expect(files).to_be_focused(timeout=CHECK_MS))


@pytest.mark.parametrize("case", BOUNDARY_CASES, ids=BOUNDARY_CASES)
def test_server_boundary(app_url, case):
    api = Api(app_url)
    if case == "content_type":
        r = api.raw("POST", "/api/accounts", b"{}", **{"Content-Type": "text/plain"})
        assert_error(r, 415, "unsupported_media_type")
    elif case == "cross_origin":
        name, email = ids_pair("xorigin")
        r = api.http.post("/api/accounts", json={"email": email, "password": PASSWORD, "display_name": name,
                                                  "time_zone": TZ, "device_name": "x"},
                          headers={"Origin": "http://elsewhere.invalid"})
        assert_error(r, 403, "cross_origin")
        refused = Api(app_url).post("/api/sessions", {"email": email, "password": PASSWORD, "device_name": "x", "device_id": None})
        assert refused.status_code == 401
    elif case == "api_body_limit":
        for size, ok in ((API_LIMIT, True), (API_LIMIT + 1, False)):
            name, email = ids_pair("limit")
            body = json.dumps({"email": email, "password": PASSWORD, "display_name": name, "time_zone": TZ, "device_name": "x"}).encode()
            r = api.raw("POST", "/api/accounts", body + b" " * (size - len(body)), **{"Content-Type": "application/json"})
            if ok:
                assert r.status_code == 201, r.text
            else:
                assert_error(r, 413, "payload_too_large")
    elif case == "push_body_limit":
        acct, vault = sync_owner(app_url, "pushlim")
        for size, ok in ((PUSH_LIMIT, True), (PUSH_LIMIT + 1, False)):
            note = str(uuid.uuid4())
            body = json.dumps(push_body(blob(MAX_ENVELOPE), None)).encode()
            r = acct.api.raw("POST", f"/api/vaults/{vault}/notes/{note}/revisions", body + b" " * (size - len(body)),
                             **{"Content-Type": "application/json", "Idempotency-Key": idempotency_key()})
            if ok:
                assert r.status_code == 201, r.text[:300]
                assert r.json()["revision"]["byte_length"] == MAX_ENVELOPE
            else:
                assert_error(r, 413, "payload_too_large")
        assert len(revisions(acct.api, vault)) == 1
    elif case == "preview_body_limit":
        acct = publisher(app_url, "pvlim")
        sample = sample_case()
        d = create_dossier(acct, sample)
        for size, ok in ((PREVIEW_LIMIT, True), (PREVIEW_LIMIT + 1, False)):
            body = json.dumps({"radius": 1, "notes": sample.notes()}).encode()
            r = acct.api.raw("POST", f"/api/dossiers/{d['id']}/manifest-preview", body + b" " * (size - len(body)),
                             **{"Content-Type": "application/json"})
            if ok:
                assert r.status_code == 200 and r.json()["public_count"] == HOP_COUNTS[1][0]
            else:
                assert_error(r, 413, "payload_too_large")
    else:
        with reader(app_url) as http:
            for path in SOURCE_PROBES:
                assert http.get(path).status_code == 404, path
            shell = http.get("/")
            assert shell.status_code == 200
            doc = parse(shell.text)
            assets = [a.get("src") or a.get("href") for t, a in doc.elements if t in ("script", "link") and (a.get("src") or a.get("href"))]
            served = [shell.text] + [http.get(a).text for a in assets if not urlsplit(a).netloc]
        secrets = [os.environ.get(n, "") for n in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID",
                                                    "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY")]
        for secret in [s for s in secrets if len(s) >= 10]:
            assert not [b for b in served if secret in b], "a credential reached the browser"


def licence_index() -> dict[tuple[str, str], tuple[Any, Path]]:
    index: dict[tuple[str, str], tuple[Any, Path]] = {}
    for root in (Path(DEPLOYED_APP), Path("/app")):
        modules = root / "node_modules"
        if not modules.is_dir():
            continue
        for manifest in modules.rglob("package.json"):
            parent = manifest.parent
            scoped = parent.parent.name.startswith("@") and parent.parent.parent.name == "node_modules"
            if parent.parent.name != "node_modules" and not scoped:
                continue
            try:
                data = json.loads(manifest.read_text())
            except (ValueError, OSError):
                continue
            entry = (data.get("license") or data.get("licenses"), parent)
            index.setdefault((data.get("name"), data.get("version")), entry)
            folder = f"{parent.parent.name}/{parent.name}" if scoped else parent.name
            index.setdefault((folder, data.get("version")), entry)
    return index


def licence_text(value: Any) -> str:
    if isinstance(value, dict):
        return value.get("type", "")
    if isinstance(value, list):
        return " OR ".join(licence_text(v) for v in value)
    return value or ""


def licence_ok(expression: str) -> bool:
    allowed = {name.lower() for name in ALLOWED_LICENCES}
    flat = expression.replace("(", " ").replace(")", " ").replace("/", " OR ")
    return any(all(LICENCE_SPELLINGS.get(part.strip().lower(), part.strip()).lower() in allowed
                   for part in re.split(r"\s+AND\s+", alt, flags=re.I)) for alt in re.split(r"\s+OR\s+", flat, flags=re.I))


def package_licence_ok(entry: tuple[Any, Path] | None) -> bool:
    value, folder = entry or (None, None)
    if licence_ok(licence_text(value)):
        return True
    for file in sorted(folder.glob("LICEN[CS]E*")) if folder else []:
        body = file.read_text(errors="replace").lower()
        allowed = [body.find(m) for m in LICENCE_MARKERS if m in body]
        denied = [body.find(m) for m in DENIED_MARKERS if m in body]
        if allowed and (not denied or min(allowed) < min(denied)):
            return True
    return False


def family_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower())


def tooling(path: Path) -> bool:
    rel = path.relative_to("/app").parts
    return (path.name.startswith(".") or ".config." in path.name or re.search(r"rc\.[cm]?js$", path.name) is not None
            or rel[0] in ("scripts", "tools", "bin") or any(part in TEST_DIRS for part in rel[:-1])
            or re.search(r"\.(test|spec)\.[cm]?jsx?$", path.name) is not None)


def build_dirs() -> set[str]:
    found = set()
    for config in Path("/app").glob("tsconfig*.json"):
        try:
            relaxed = re.sub(r'("(?:\\.|[^"\\])*")|//[^\n]*|/\*.*?\*/', lambda m: m.group(1) or "", config.read_text(), flags=re.S)
            out = json.loads(re.sub(r",(\s*[}\]])", r"\1", relaxed)).get("compilerOptions", {}).get("outDir")
        except (ValueError, OSError):
            continue
        if out:
            found.add(Path(out).as_posix().strip("./"))
    return found


@functools.cache
def ts_stems() -> set[str]:
    return {p.name.split(".")[0] for p in Path("/app").rglob("*.ts*") if "node_modules" not in p.parts
            and p.suffix in (".ts", ".tsx") and not p.name.endswith(".d.ts")}


def generated(path: Path, outputs: set[str]) -> bool:
    rel = path.relative_to("/app").as_posix()
    if any(rel.startswith(out + "/") for out in outputs if out) or path.stem in ts_stems():
        return True
    content = path.read_text(errors="replace")
    return "sourceMappingURL=" in content[-2000:] or any(len(line) > 1000 for line in content.splitlines())


def sqlite_files() -> list[str]:
    found = []
    for root in {str(DEPLOYED_APP), "/app"}:
        for folder, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
            for name in files:
                try:
                    with open(os.path.join(folder, name), "rb") as handle:
                        if handle.read(16) == SQLITE_HEADER:
                            found.append(os.path.join(folder, name))
                except OSError:
                    continue
    return found


def real_name(name: str) -> str:
    for root in (Path(DEPLOYED_APP), Path("/app")):
        manifest = root / "node_modules" / name / "package.json"
        if manifest.is_file():
            try:
                return json.loads(manifest.read_text()).get("name") or name
            except ValueError:
                return name
    return name


def notices() -> str:
    path = Path("/app/THIRD_PARTY_NOTICES.md")
    assert path.exists(), "THIRD_PARTY_NOTICES.md is missing"
    return path.read_text(errors="replace")


def test_if_run_manifest():
    data = json.loads(Path("/app/run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data[key], str) and data[key].strip()


def test_if_third_party_notices():
    content = notices()
    missing = sorted({p.name for p in shipped_packages() if p.name not in content and real_name(p.name) not in content})
    assert missing == [], missing
    folded = family_text(content)
    for font in ("Fraunces", "IBM Plex"):
        assert family_text(font) in folded, font


def test_if_licences_allowed():
    index = licence_index()
    bad = []
    for package in shipped_packages():
        entry = index.get((package.name, package.version))
        if not (licence_ok(package.licence) or package_licence_ok(entry)):
            bad.append((package.name, package.version, package.licence))
    assert bad == [], bad


def test_if_no_extra_datastore():
    stores = [s.lower() for s in FORBIDDEN_STORES]
    assert sqlite_files() == [], "a SQLite database file exists on the server"
    running = []
    for cmdline in Path("/proc").glob("[0-9]*/cmdline"):
        try:
            cwd = os.readlink(cmdline.parent / "cwd")
            if not any(cwd == root or cwd.startswith(root + "/") for root in (str(DEPLOYED_APP), "/app")):
                continue
            running.append(cmdline.read_bytes().replace(b"\0", b" ").decode(errors="replace").lower())
        except OSError:
            continue
    assert not [c for c in running if any(s in c for s in stores)]


def test_if_service_config_unchanged():
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    data = json.loads(path.read_text(errors="replace"))
    config = re.compile(r"(^|/)environment/(docker-compose\.ya?ml|Dockerfile|\.env)$")
    touched: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name", ""))
            args = node.get("input") or node.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {}
            if name in {"Write", "Edit", "MultiEdit", "NotebookEdit"} and isinstance(args, dict):
                target = str(args.get("file_path") or args.get("path") or "")
                if config.search(target):
                    touched.append(target)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    assert touched == [], touched


def test_if_typescript_sources():
    skip = {"node_modules", "dist", "build", "out", "coverage"}
    outputs = build_dirs()
    js, ts_files = [], []
    for path in Path("/app").rglob("*"):
        rel = path.relative_to("/app").parts
        if any(p in skip or p.startswith(".") for p in rel[:-1]) or not path.is_file():
            continue
        if path.suffix in (".ts", ".tsx"):
            ts_files.append(path)
        elif path.suffix in (".js", ".jsx", ".mjs", ".cjs") and not tooling(path) and not generated(path, outputs):
            js.append(str(path))
    assert ts_files
    assert js == [], js


def test_if_bundled_assets(browser, app_url):
    content = notices()
    folded = family_text(content)
    for name in ("Fraunces", "IBM Plex"):
        assert family_text(name) in folded, name
    foreign: list[str] = []
    with open_app(browser, app_url) as page:
        page.on("request", lambda req: foreign.append(req.url)
                if req.url.startswith("http") and not same_app(req.url, app_url) else None)
        page.set_viewport_size(DESKTOP)
        page.reload()
        click(page.get_by_role("button", name="Load sample case", exact=True))
        page.goto(f"{app_url}/ops")
        page.goto(f"{app_url}/")
        expect(page.get_by_role("button", name="Account", exact=True)).to_be_visible(timeout=UI_MS)
    assert foreign == [], foreign
