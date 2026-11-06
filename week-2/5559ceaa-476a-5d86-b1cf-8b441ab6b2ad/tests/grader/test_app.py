from __future__ import annotations

import base64
import contextlib
import datetime as dt
import email.utils
import hashlib
import hmac
import io
import json
import os
import pathlib
import re
import socket
import stat
import subprocess
import threading
import time
import unicodedata
import urllib.parse
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    S3,
    Mailpit,
    Postgres,
    addresses,
    advance,
    animations,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    motion,
    open_app,
    post_json,
    same_origin,
    sample,
    settle,
    state_styles,
    style,
    tab_order,
    text,
    unique,
)


HTTP_TIMEOUT = 30
MAIL_WAIT_S = 45
MAIL_SETTLE_S = 0.3
SAVE_WAIT_S = 60
UI_MS = 15000
FAIL_WAIT_S = 120
EXPIRY_WAIT_S = 60
SWEEP_SLACK_S = 3
TIME_SLACK_S = 120
TAB_PRESSES = 45
NPM_TIMEOUT = 300
RELAY_CHUNK = 65536
OUTAGE_HOST = "127.0.0.1"
OUTAGE_PORT = 9
S3_DEFAULT_REGION = "us-east-1"

LIVE_MS = 1000
DEBOUNCE_MS = 500
REDIRECT_MS = 3000
BATON_MAX_MS = 340
BATON_SAMPLES = 24
FRAME_MS = 16
PANEL_MAX_MS = 250
SHARE_REFRESH_MS = 30000
NAME_MAX = 80
GROUP_SEATS = 6
PATH_MAX = 255
ZIP_ENTRIES = 500
ZIP_FILE_MAX = 1_000_000
ZIP_TOTAL_MAX = 20_000_000
RATIO_FLOOR = 10_000
RATIO_MAX = 100
SWEEP_S = 10
TOKEN_CHARS = 43
LINK_HOURS_MAX = 336
UPLOAD_RETRY_S = 10
MAIL_RETRY_S = 30
SAMPLE_LEAD_S = 86400
HOUR_S = 3600
PLAN_TTL_S = 3600
JSON_LIMIT = 2_000_000
ZIP_LIMIT = 5_000_000
FRAME_LIMIT = 2_000_000
LINK_HOURS_DEFAULT = 48
WIDE_MIN = 1280
MID_MIN = 768
CLOSE_REMOVED = 4403
CLOSE_TOO_BIG = 1009

SAMPLE_TITLE = "Sample: Tip Calculator"
SIGN_IN_SUBJECT = "Your Relay Bench sign-in link"
REVIEW_SUBJECT = "A Relay Bench checkpoint to review: "
ERASED = "Erased learner"
SEED_FILES = {
    "README.md": "# Tip Calculator\n\nSplit a bill and add a tip. Run the tests with `node src/tip.test.js`.\n",
    "index.html": "<!doctype html>\n<title>Tip Calculator</title>\n<script type=\"module\" src=\"src/tip.js\"></script>\n",
    "src/tip.js": "export function tip(bill, percent) {\n  return Math.round(bill * percent) / 100;\n}\n",
    "src/tip.test.js": "import { tip } from \"./tip.js\";\n\nconsole.assert(tip(50, 20) === 10, \"20% of 50 is 10\");\n",
}
STARTER_TIP = "export function tip(bill, percent) {\n  return 0;\n}\n"
TIP_LINE = "return Math.round(bill * percent) / 100;"

DRIVE_PATH = "src/main.js"
DRIVE_TEXT = "let total = 0;\n"
LONG_PATH = "notes/long.txt"
LONG_LINES = 120
OLD_PATH = "notes/old.txt"
NOT_EMAIL = "not-an-email"
FOREIGN_ORIGIN = "http://cross-origin.invalid"
SCHEDULED_FOR = "2100-01-01T09:00:00Z"
FUTURE_DEVICE_TIME = dt.datetime(2100, 1, 1, tzinfo=dt.timezone.utc)
PART_BYTES = 960_000
GARBAGE = b"not the file bytes"
JUNK_TOKEN = "x" * TOKEN_CHARS
DEMO_LEARNER = "Robin Vale"
STARTER = "Starter"
MINUTE_40 = "Minute 40"
FORBIDDEN_STORES = ("SQLite", "Redis")
TRAVERSAL_TEXT = "leaves the project folder"
EXPIRED_PATH = "late.txt"
TOP_PATH = "top.md"
UNKNOWN_API = "/api/no-such-route"
EXTRA_PATH = "src/extra.js"
HOMEWORK_README = "# Homework\n"
ESCAPE_PATH = "../escape.txt"
SERVED_PROBES = ("/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/.env", "/src/server.ts")


def planned_copy(new: int, changed: int, unchanged: int, orphans: int) -> str:
    return f"{new} new, {changed} changed, {unchanged} unchanged, {orphans} only in the project."


def applied_copy(added: int, replaced: int, kept: int) -> str:
    return f"Import applied: {added} added, {replaced} replaced, {kept} kept."


def rejected_copy(count: int) -> str:
    return f"Zip rejected: {count} problem(s) found. Nothing was imported."
AB_TABLE = bytes.maketrans(bytes(range(256)), bytes(b"ab"[i & 1] for i in range(256)))

TOKEN_RE = re.compile(r"/auth/verify\?token=([A-Za-z0-9_\-.~%]+)")
UUID_URL = re.compile(r"/projects/([0-9a-f-]{36})$")
WS_URL = "/socket"
CHANGING_BUTTON = re.compile(
    r"^(Save|Delete|Remove|Rename|Restore|Revoke|Regenerate|Create|Send|Apply|Erase|Undo|Schedule|Start|End|Pause|Resume|Take|Pass|New|Import)\b")
SEEK_FLIGHT = """(e, n) => {
  const moving = document.getAnimations().filter((a) => {
    const t = a.effect && a.effect.target;
    return t && (t === e || e.contains(t) || t.contains(e));
  });
  const ends = moving.map((a) => a.effect.getComputedTiming().endTime).filter(Number.isFinite);
  if (!ends.length) return [];
  const total = Math.max(...ends), out = [];
  moving.forEach((a) => a.pause());
  for (let i = 0; i <= n; i++) {
    moving.forEach((a) => { a.currentTime = total * i / n; });
    const r = e.getBoundingClientRect();
    out.push({t: total * i / n, x: r.x, y: r.y, width: r.width, height: r.height});
  }
  // Finish so finish/transitionend/animation.finished fire and a build waiting on the landing carries on.
  moving.forEach((a) => (Number.isFinite(a.effect.getComputedTiming().endTime) ? a.finish() : a.play()));
  return out;
}"""


def env_url(name: str) -> str:
    value = os.environ.get(name, "")
    assert value, f"{name} is not set for the verifier"
    return value.rstrip("/")


def person(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    return (first, second) if "@" in first else (second, first)


def label(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4().hex[:8]}"


def sha(data: bytes | str) -> str:
    raw = data.encode() if isinstance(data, str) else data
    return hashlib.sha256(raw).hexdigest()


def parse_iso(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def server_now(response: httpx.Response) -> dt.datetime:
    return email.utils.parsedate_to_datetime(response.headers["date"])


def near(a: dt.datetime, b: dt.datetime, slack: float = TIME_SLACK_S) -> bool:
    return abs((a - b).total_seconds()) <= slack


def stamp(moment: dt.datetime) -> str:
    return f"{moment.day} {moment.strftime('%b')} {moment.year}, {moment.strftime('%H:%M')}"


def normalise(path: str) -> str:
    path = path.replace("\\", "/")
    if path.startswith("./"):
        path = path[2:]
    path = re.sub(r"/+", "/", path)
    return unicodedata.normalize("NFC", path)


def poll(probe: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = probe()
        if last:
            return last
    raise AssertionError(f"timed out after {seconds}s waiting for {what}; last={last!r}")


def err(response: httpx.Response) -> dict[str, Any]:
    return response.json()["error"]


def expect_error(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    body = err(response)
    assert body["code"] == code, response.text
    assert isinstance(body.get("message"), str)
    return body


class Api:
    def __init__(self, base: str, cookies: dict[str, str] | None = None) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, cookies=cookies)
        self.user: dict[str, Any] = {}
        self.landing = ""
        self.email = ""
        self.name = ""

    def request(self, method: str, path: str, body: Any = None, key: str | None = None,
                headers: dict[str, str] | None = None, content: bytes | None = None) -> httpx.Response:
        sent = dict(headers or {})
        if key is not None:
            sent["Idempotency-Key"] = key
        if content is not None:
            return self.http.request(method, path, headers=sent, content=content)
        if body is None:
            return self.http.request(method, path, headers=sent)
        return self.http.request(method, path, headers=sent, json=body)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, body: Any = None, key: str | None = None, **kw: Any) -> httpx.Response:
        return self.request("POST", path, {} if body is None else body, key, **kw)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.request("PUT", path, body)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.request("PATCH", path, body)

    def delete(self, path: str, body: Any = None) -> httpx.Response:
        return self.request("DELETE", path, body)

    def verify(self, token: str) -> "Api":
        r = self.post("/api/auth/verify", {"token": token})
        assert r.status_code == 200, r.text
        self.user = r.json()["user"]
        self.landing = r.json()["landing"]
        self.name = self.user["name"]
        self.email = self.user.get("email") or ""
        return self

    def clone(self, base: str) -> "Api":
        other = Api(base, {c.name: c.value for c in self.http.cookies.jar})
        other.user, other.landing, other.email, other.name = self.user, self.landing, self.email, self.name
        return other


def cookie_list(api: Api) -> list[dict[str, Any]]:
    return [{"name": c.name, "value": c.value, "url": api.base} for c in api.http.cookies.jar]


def browser_api(page: Page, base: str) -> Api:
    return Api(base, {c["name"]: c["value"] for c in page.context.cookies()})


def to_address(message: dict[str, Any], address: str) -> bool:
    return address.lower() in [a.lower() for a in addresses(message.get("To"))]


def inbox(mail: Mailpit, address: str, subject: str | None = None, settle_s: float = 1.5) -> list[dict[str, Any]]:
    return [m for m in mail.messages(settle=settle_s)
            if to_address(m, address) and (subject is None or m.get("Subject") == subject)]


def await_inbox(mail: Mailpit, address: str, count: int, subject: str | None = None,
                seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    poll(lambda: len(inbox(mail, address, subject, MAIL_SETTLE_S)) >= count, seconds, f"{count} mail to {address}")
    return inbox(mail, address, subject)


def tokens(messages: list[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for m in messages:
        found += [urllib.parse.unquote(t) for t in TOKEN_RE.findall(text(m))]
    return found


def all_tokens(mail: Mailpit, address: str) -> set[str]:
    return set(tokens(inbox(mail, address)))


def wait_token(mail: Mailpit, address: str, known: frozenset[str] | set[str] = frozenset(),
               subject: str | None = None) -> str:
    def fresh() -> list[str]:
        return [t for t in tokens(inbox(mail, address, subject, MAIL_SETTLE_S)) if t not in known]
    return poll(fresh, MAIL_WAIT_S, f"a new sign-in link for {address}")[0]


def sign_in(mail: Mailpit, base: str, address: str, known: frozenset[str] | set[str] = frozenset()) -> Api:
    api = Api(base)
    r = api.post("/api/auth/magic-link", {"email": address})
    assert r.status_code == 202, r.text
    api.verify(wait_token(mail, address, known, SIGN_IN_SUBJECT))
    api.email = address
    return api


def new_mentor(mail: Mailpit, base: str) -> Api:
    return sign_in(mail, base, person("mentor")[0])


def new_project(api: Api, kind: str = "group", title: str | None = None) -> dict[str, Any]:
    r = api.post("/api/projects", {"title": title or label("Bench"), "kind": kind})
    assert r.status_code == 201, r.text
    return r.json()["project"]


def invite(api: Api, pid: str, address: str, name: str, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/projects/{pid}/invites", {"email": address, "name": name}, key=key or idempotency_key())


def join(mail: Mailpit, mentor: Api, pid: str, prefix: str = "learner") -> Api:
    address, name = person(prefix)
    r = invite(mentor, pid, address, name)
    assert r.status_code == 201, r.text
    learner = Api(mentor.base).verify(wait_token(mail, address))
    learner.email = address
    return learner


def group(mail: Mailpit, base: str, learners: int, kind: str = "group") -> tuple[Api, dict[str, Any], list[Api]]:
    mentor = new_mentor(mail, base)
    project = new_project(mentor, kind)
    return mentor, project, [join(mail, mentor, project["id"]) for _ in range(learners)]


def project_of(api: Api, pid: str) -> dict[str, Any]:
    r = api.get(f"/api/projects/{pid}")
    assert r.status_code == 200, r.text
    return r.json()["project"]


def sample_project(api: Api) -> dict[str, Any]:
    projects = api.get("/api/projects").json()["projects"]
    return next(p for p in projects if p["title"] == SAMPLE_TITLE)


def member(api: Api, pid: str, user_id: str) -> dict[str, Any] | None:
    return next((m for m in project_of(api, pid)["members"] if m["user_id"] == user_id), None)


def schedule(api: Api, pid: str) -> dict[str, Any]:
    r = api.post(f"/api/projects/{pid}/sessions", {"title": label("Session"), "scheduled_for": SCHEDULED_FOR})
    assert r.status_code == 201, r.text
    return r.json()["session"]


def act(api: Api, sid: str, action: str) -> httpx.Response:
    return api.post(f"/api/sessions/{sid}/{action}")


def go_live(api: Api, pid: str) -> dict[str, Any]:
    r = act(api, schedule(api, pid)["id"], "start")
    assert r.status_code == 200, r.text
    return r.json()["session"]


def session_of(api: Api, sid: str) -> dict[str, Any]:
    r = api.get(f"/api/sessions/{sid}")
    assert r.status_code == 200, r.text
    return r.json()["session"]


def claim(api: Api, sid: str, version: int) -> httpx.Response:
    return api.post(f"/api/sessions/{sid}/baton/claim", {"version": version})


def pass_baton(api: Api, sid: str, to: str, version: int) -> httpx.Response:
    return api.post(f"/api/sessions/{sid}/baton/pass", {"to_user_id": to, "version": version})


def add_file(api: Api, pid: str, path: str, content: str) -> dict[str, Any]:
    r = api.post(f"/api/projects/{pid}/files", {"path": path, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["file"]


def file_map(api: Api, pid: str) -> dict[str, dict[str, Any]]:
    r = api.get(f"/api/projects/{pid}/files")
    assert r.status_code == 200, r.text
    return {f["path"]: f for f in r.json()["files"]}


def read_file(api: Api, pid: str, fid: str) -> str:
    r = api.get(f"/api/projects/{pid}/files/{fid}")
    assert r.status_code == 200, r.text
    return r.json()["file"]["content"]


def put_file(api: Api, pid: str, f: dict[str, Any], content: str) -> httpx.Response:
    return api.put(f"/api/projects/{pid}/files/{f['id']}", {"content": content, "base_revision": f["revision"]})


def save_ok(api: Api, pid: str, f: dict[str, Any], content: str) -> dict[str, Any]:
    r = put_file(api, pid, f, content)
    assert r.status_code == 200, r.text
    return r.json()["file"]


def checkpoint_of(api: Api, cid: str) -> dict[str, Any]:
    r = api.get(f"/api/checkpoints/{cid}")
    assert r.status_code == 200, r.text
    return r.json()["checkpoint"]


def wait_saved(api: Api, cid: str, seconds: float = SAVE_WAIT_S) -> dict[str, Any]:
    def saved() -> dict[str, Any] | None:
        cp = checkpoint_of(api, cid)
        assert cp["state"] != "failed", cp
        return cp if cp["state"] == "saved" else None
    return poll(saved, seconds, f"checkpoint {cid} saved")


def make_checkpoint(api: Api, pid: str, name: str | None = None) -> dict[str, Any]:
    r = api.post(f"/api/projects/{pid}/checkpoints", {"name": name or label("Save")})
    assert r.status_code in (201, 202), r.text
    return wait_saved(api, r.json()["checkpoint"]["id"])


def sample_checkpoints(api: Api, pid: str, seconds: float = SAVE_WAIT_S) -> dict[str, dict[str, Any]]:
    def both() -> dict[str, dict[str, Any]] | None:
        cps = {c["name"]: c for c in api.get(f"/api/projects/{pid}/checkpoints").json()["checkpoints"]}
        ready = all(cps.get(n, {}).get("state") == "saved" for n in ("Starter", "Minute 40"))
        return cps if ready else None
    return poll(both, seconds, "seeded checkpoints saved")


def restore(api: Api, cid: str) -> httpx.Response:
    return api.post(f"/api/checkpoints/{cid}/restore")


def undo(api: Api, rid: str) -> httpx.Response:
    return api.post(f"/api/restores/{rid}/undo")


def upload(api: Api, pid: str, payload: bytes, content_type: str = "application/zip") -> httpx.Response:
    return api.request("POST", f"/api/projects/{pid}/imports", content=payload, headers={"Content-Type": content_type})


def apply(api: Api, iid: str, decisions: dict[str, str]) -> httpx.Response:
    return api.post(f"/api/imports/{iid}/apply", {"decisions": decisions})


def create_link(api: Api, cid: str, hours: Any, address: str | None = None, key: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"expires_in_hours": hours}
    if address is not None:
        body["email"] = address
    return api.post(f"/api/checkpoints/{cid}/reviewer-links", body, key=key or idempotency_key())


def token_of(link: dict[str, Any]) -> str:
    return link["url"].rsplit("/review/", 1)[1]


def audit_of(api: Api, pid: str) -> list[dict[str, Any]]:
    r = api.get(f"/api/projects/{pid}/audit")
    assert r.status_code == 200, r.text
    return r.json()["events"]


def blob_key(pid: str, data: bytes) -> str:
    return f"projects/{pid}/blobs/{sha(data)}"


def manifest_key(pid: str, cid: str) -> str:
    return f"projects/{pid}/checkpoints/{cid}/manifest.json"


def b64sha(data: bytes) -> str:
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


def make_zip(entries: list[tuple[Any, ...]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        for entry in entries:
            info = zipfile.ZipInfo(entry[0])
            info.compress_type = zipfile.ZIP_DEFLATED
            if len(entry) > 2:
                info.external_attr = entry[2]
            archive.writestr(info, entry[1])
    return buf.getvalue()


def ab_text(size: int) -> bytes:
    return os.urandom(size).translate(AB_TABLE)


def handshake(api: Api, pid: str) -> httpx.Response:
    return api.get(f"/api/projects/{pid}/socket", headers={
        "Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": base64.b64encode(os.urandom(16)).decode()})


def private_headers(r: httpx.Response) -> None:
    assert "no-store" in r.headers.get("cache-control", ""), r.headers
    assert r.headers.get("referrer-policy") == "no-referrer", r.headers
    assert "noindex" in r.headers.get("x-robots-tag", ""), r.headers


def s3_call(method: str, key: str, body: bytes = b"", headers: dict[str, str] | None = None) -> httpx.Response:
    endpoint = env_url("S3_ENDPOINT")
    region = os.environ.get("S3_REGION") or S3_DEFAULT_REGION
    bucket = os.environ["S3_BUCKET"]
    access, secret = os.environ["S3_ACCESS_KEY_ID"], os.environ["S3_SECRET_ACCESS_KEY"]
    now = dt.datetime.now(dt.timezone.utc)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload = hashlib.sha256(body).hexdigest()
    signed = {"host": urllib.parse.urlsplit(endpoint).netloc, "x-amz-content-sha256": payload, "x-amz-date": amz_date}
    signed.update({k.lower(): v for k, v in (headers or {}).items()})
    names = sorted(signed)
    path = "/" + urllib.parse.quote(bucket, safe="") + "/" + urllib.parse.quote(key, safe="/-_.~")
    canonical = "\n".join([method, path, "", "".join(f"{n}:{signed[n].strip()}\n" for n in names), ";".join(names), payload])
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = ("AWS4" + secret).encode()
    for part in (day, region, "s3", "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    sent = {n: signed[n] for n in names if n != "host"}
    sent["Authorization"] = f"AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={';'.join(names)}, Signature={signature}"
    return httpx.request(method, endpoint + path, content=body, headers=sent, timeout=HTTP_TIMEOUT)


def stored_checksum(key: str) -> str | None:
    r = s3_call("HEAD", key, headers={"x-amz-checksum-mode": "ENABLED"})
    assert r.status_code == 200, (key, r.status_code)
    return r.headers.get("x-amz-checksum-sha256")


class Relay:

    def __init__(self, target: tuple[str, int]) -> None:
        self.target = target
        self.links: list[socket.socket] = []
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind((OUTAGE_HOST, OUTAGE_PORT))
        self.server.listen()
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target)
            except OSError:
                client.close()
                continue
            self.links += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while chunk := src.recv(RELAY_CHUNK):
                dst.sendall(chunk)
        except OSError:
            pass
        finally:
            with contextlib.suppress(OSError):
                dst.shutdown(socket.SHUT_WR)

    def __enter__(self) -> "Relay":
        return self

    def __exit__(self, *exc: Any) -> None:
        with contextlib.suppress(OSError):
            self.server.shutdown(socket.SHUT_RDWR)
        self.server.close()
        for s in self.links:
            with contextlib.suppress(OSError):
                s.close()


def s3_target() -> tuple[str, int]:
    parts = urllib.parse.urlsplit(env_url("S3_ENDPOINT"))
    return parts.hostname or "", parts.port or (443 if parts.scheme == "https" else 80)


def rows_mentioning(pg: Postgres, needle: str) -> list[dict[str, Any]]:
    cols = pg.rows("SELECT table_schema AS s, table_name AS t, column_name AS c FROM information_schema.columns "
                   "WHERE table_schema NOT IN ('pg_catalog','information_schema') AND data_type IN "
                   "('text','character varying','character','json','jsonb','ARRAY','USER-DEFINED')")

    def q(ident: str) -> str:
        return '"' + ident.replace('"', '""') + '"'
    lit = needle.lower().replace("'", "''")
    parts = [f"SELECT '{(c['s'] + '.' + c['t'] + '.' + c['c']).replace(chr(39), '')}' AS hit FROM {q(c['s'])}.{q(c['t'])} "
             f"WHERE strpos(lower({q(c['c'])}::text), '{lit}') > 0" for c in cols]
    return pg.rows(" UNION ALL ".join(parts)) if parts else []


SOCKET_OPEN_JS = """(url) => new Promise((resolve) => {
  const ws = new WebSocket(url);
  window.__frames = []; window.__close = null; window.__ws = ws;
  ws.onmessage = (e) => { window.__frames.push(JSON.parse(e.data)); };
  ws.onclose = (e) => { window.__close = {code: e.code, reason: e.reason, at: Date.now()}; resolve(false); };
  ws.onopen = () => resolve(true);
})"""
FRAME_MATCH_JS = """([type, want]) => (window.__frames || []).filter((f) => f.type === type &&
  Object.entries(want).every(([k, v]) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), f) === v))"""


class Sock:
    def __init__(self, browser: Browser, api: Api, pid: str) -> None:
        self.context = browser.new_context()
        self.context.add_cookies(cookie_list(api))
        self.page = self.context.new_page()
        self.page.goto(api.base + "/api/health")
        url = api.base.replace("http", "ws", 1) + f"/api/projects/{pid}{WS_URL}"
        assert self.page.evaluate(SOCKET_OPEN_JS, url), "project socket did not open"

    def send(self, frame: Any) -> None:
        self.page.evaluate("(f) => window.__ws.send(typeof f === 'string' ? f : JSON.stringify(f))", frame)

    def matches(self, kind: str, want: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return self.page.evaluate(FRAME_MATCH_JS, [kind, want or {}])

    def wait(self, kind: str, want: dict[str, Any] | None = None, timeout: float = UI_MS) -> dict[str, Any]:
        self.page.wait_for_function(f"(a) => ({FRAME_MATCH_JS})(a).length > 0", arg=[kind, want or {}],
                                    timeout=timeout, polling=50)
        return self.matches(kind, want)[0]

    def wait_closed(self, timeout: float = UI_MS) -> dict[str, Any]:
        self.page.wait_for_function("() => window.__close !== null", timeout=timeout, polling=50)
        return self.page.evaluate("() => window.__close")

    def now(self) -> float:
        return self.page.evaluate("() => Date.now()")

    def close(self) -> None:
        self.context.close()


@contextlib.contextmanager
def ui(browser: Browser, api: Api, path: str, size: tuple[int, int] = (1280, 800),
       timezone: str | None = None) -> Iterator[Page]:
    context = browser.new_context(viewport={"width": size[0], "height": size[1]}, timezone_id=timezone)
    cookies = cookie_list(api)
    if cookies:
        context.add_cookies(cookies)
    page = context.new_page()
    page.goto(api.base + path)
    try:
        yield page
    finally:
        context.close()


@contextlib.contextmanager
def clocked(browser: Browser, api: Api, size: tuple[int, int] = (1280, 800),
            reduced: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, api.base + "/sign-in", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        page.context.add_cookies(cookie_list(api))
        yield page


def btn(scope: Page | Locator, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def status(page: Page, name: str, hidden: bool = False) -> Locator:
    return page.get_by_role("status", name=name, exact=True, include_hidden=hidden)


def participants(page: Page, hidden: bool = False) -> Locator:
    return page.get_by_role("list", name="Participants", include_hidden=hidden).get_by_role("listitem", include_hidden=hidden)


def participant(page: Page, name: str, hidden: bool = False) -> Locator:
    return participants(page, hidden).filter(has_text=name)


def ledger_rows(page: Page) -> Locator:
    return page.get_by_role("list", name="Checkpoints").get_by_role("listitem")


def code_editor(page: Page) -> Locator:
    return page.get_by_role("textbox", name="Code editor")


def tree_item(page: Page, segment: str, folder: bool = False) -> Locator:
    pattern = rf"^{re.escape(segment)}\/?(\s|$)" if folder else rf"(^|\/){re.escape(segment)}(\s|,|$)"
    return page.get_by_role("tree", name="Files").get_by_role("treeitem", name=re.compile(pattern)).first


def open_file(page: Page, path: str) -> None:
    for segment in path.split("/")[:-1]:
        folder = tree_item(page, segment, folder=True)
        expect(folder).to_be_visible(timeout=UI_MS)
        if folder.get_attribute("aria-expanded") == "false":
            folder.click()
    item = tree_item(page, path.rsplit("/", 1)[-1])
    item.click()
    item.press("Enter")
    expect(page.get_by_role("tab", name=path, exact=True)).to_be_visible(timeout=UI_MS)


EDITOR_TEXT_JS = "(el) => (el instanceof HTMLTextAreaElement ? el.value : el.innerText)"


def editor_contains(page: Page, needle: str, timeout: float = UI_MS) -> None:
    handle = code_editor(page).element_handle()
    page.wait_for_function(f"([el, n]) => ({EDITOR_TEXT_JS})(el).includes(n)", arg=[handle, needle],
                           timeout=timeout, polling=50)


def type_at_end(page: Page, typed: str) -> None:
    code_editor(page).click()
    page.keyboard.press("Control+End")
    page.keyboard.type(typed)


def full_tab_order(page: Page, presses: int = TAB_PRESSES) -> list[str]:
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    names: list[str] = []
    for _ in range(presses):
        if names and names[-1] == "Code editor":
            page.keyboard.press("Escape")
        names += [n.split("\n")[0].strip() for n in tab_order(page, 1)]
    return names


def in_order(names: list[str], wanted: list[str]) -> bool:
    at = 0
    for name in names:
        if at < len(wanted) and name == wanted[at]:
            at += 1
    return at == len(wanted)


def rect_center(s: dict[str, float]) -> tuple[float, float]:
    x, y = s.get("x", s.get("left", 0.0)), s.get("y", s.get("top", 0.0))
    return x + s["width"] / 2, y + s["height"] / 2


def inside(point: tuple[float, float], box: dict[str, float]) -> bool:
    return box["x"] - 1 <= point[0] <= box["x"] + box["width"] + 1 and box["y"] - 1 <= point[1] <= box["y"] + box["height"] + 1


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def same_rect(a: dict[str, float], b: dict[str, float]) -> bool:
    for key, tol in (("x", 1.0), ("y", 1.0), ("width", 1.0), ("height", 1.0), ("opacity", 0.02)):
        if key in a and key in b and abs(a[key] - b[key]) > tol:
            return False
    return True


def box(locator: Locator) -> dict[str, float]:
    found = locator.bounding_box()
    assert found, "element has no box"
    return found


def one_state(item: Locator) -> str:
    words = [w for w in ("driving", "viewing", "offline") if w in item.inner_text()]
    assert len(words) == 1, item.inner_text()
    return words[0]


def session_frame_for(user_id: str) -> Callable[[Any], bool]:
    def check(payload: Any) -> bool:
        with contextlib.suppress(ValueError, TypeError, AttributeError):
            frame = json.loads(payload)
            return frame.get("type") == "session" and (frame.get("session") or {}).get("driver_id") == user_id
        return False
    return check


def test_magic_link_request_and_verify(app_url: str, mail: Mailpit) -> None:
    known, _ = person("known")
    mentor = sign_in(mail, app_url, known)
    pid = sample_project(mentor)["id"]
    assert mentor.landing == f"/projects/{pid}"
    seen = all_tokens(mail, known)
    stranger, _ = person("stranger")
    r_known = post_json(app_url, "/api/auth/magic-link", {"email": known})
    r_new = post_json(app_url, "/api/auth/magic-link", {"email": stranger})
    assert r_known.status_code == r_new.status_code == 202
    assert r_known.json() == r_new.json() == {"status": "accepted"}
    token = wait_token(mail, known, seen, SIGN_IN_SUBJECT)
    new_mail = await_inbox(mail, stranger, 1)
    assert len(new_mail) == 1 and len(inbox(mail, known, SIGN_IN_SUBJECT)) == 2
    known_mail = next(m for m in inbox(mail, known) if token in tokens([m]))
    for m in (known_mail, new_mail[0]):
        assert mail_from_address() in addresses(m.get("From"))
        assert m.get("Subject") == SIGN_IN_SUBJECT

    def scrub(m: dict[str, Any], address: str) -> str:
        body = text(m)
        for value in tokens([m]) + [address, address.split("@")[0]]:
            body = body.replace(value, "~")
        return body
    assert scrub(known_mail, known) == scrub(new_mail[0], stranger)
    again = Api(app_url)
    v = again.post("/api/auth/verify", {"token": token})
    assert v.status_code == 200 and v.json()["user"]["id"] == mentor.user["id"]
    assert v.json()["landing"] == f"/projects/{pid}"
    assert again.get("/api/me").json()["user"]["id"] == mentor.user["id"]
    expect_error(post_json(app_url, "/api/auth/verify", {"token": token}), 410, "link_used")
    expect_error(post_json(app_url, "/api/auth/verify", {"token": JUNK_TOKEN}), 404, "link_not_found")
    expect_error(post_json(app_url, "/api/auth/magic-link", {"email": NOT_EMAIL}), 422, "validation")
    new_project(mentor)
    seen = all_tokens(mail, known)
    assert sign_in(mail, app_url, known, seen).landing == "/"


def test_sign_in_link_expiry(mail: Mailpit) -> None:
    base = env_url("APP_SHORT_URL")
    mentor = new_mentor(mail, base)
    pid = sample_project(mentor)["id"]
    cid = sample_checkpoints(mentor, pid)["Minute 40"]["id"]
    late, _ = person("late")
    assert post_json(base, "/api/auth/magic-link", {"email": late}).status_code == 202
    late_token = wait_token(mail, late, subject=SIGN_IN_SUBJECT)
    made = create_link(mentor, cid, 1)
    assert made.status_code == 201, made.text
    token = token_of(made.json()["link"])
    poll(lambda: httpx.get(f"{base}/api/review/{token}").status_code == 410, EXPIRY_WAIT_S, "short timers elapsed")
    api = Api(base)
    expect_error(api.post("/api/auth/verify", {"token": late_token}), 410, "link_expired")
    expect_error(api.get("/api/me"), 401, "unauthenticated")


def test_reviewer_link_expiry(mail: Mailpit) -> None:
    base = env_url("APP_SHORT_URL")
    mentor = new_mentor(mail, base)
    pid = sample_project(mentor)["id"]
    cid = sample_checkpoints(mentor, pid)["Minute 40"]["id"]
    made = create_link(mentor, cid, 1)
    assert made.status_code == 201, made.text
    link = made.json()["link"]
    token = token_of(link)
    gone = poll(lambda: (lambda r: r if r.status_code == 410 else None)(httpx.get(f"{base}/api/review/{token}")),
                EXPIRY_WAIT_S, "reviewer link expiry")
    assert err(gone)["code"] == "link_expired"
    private_headers(gone)
    listed = mentor.get(f"/api/checkpoints/{cid}/reviewer-links").json()["links"]
    assert next(x for x in listed if x["id"] == link["id"])["state"] == "expired"
    expect_error(mentor.post(f"/api/reviewer-links/{link['id']}/revoke"), 409, "illegal_transition")
    expect_error(mentor.post(f"/api/reviewer-links/{link['id']}/regenerate"), 409, "illegal_transition")


def test_sample_workspace_seed(app_url: str, mail: Mailpit) -> None:
    address, _ = person("seed")
    api = Api(app_url)
    assert api.post("/api/auth/magic-link", {"email": address}).status_code == 202
    v = api.post("/api/auth/verify", {"token": wait_token(mail, address)})
    assert v.status_code == 200
    user = v.json()["user"]
    assert user["kind"] == "mentor" and user["name"] == address.split("@")[0]
    projects = api.get("/api/projects").json()["projects"]
    assert len(projects) == 1
    p = projects[0]
    assert (p["title"], p["kind"], p["role"], p["student_count"]) == (SAMPLE_TITLE, "one_to_one", "mentor", 1)
    detail = project_of(api, p["id"])
    roles = {m["name"]: (m["role"], m["email_status"]) for m in detail["members"]}
    assert roles == {user["name"]: ("mentor", "none"), "Robin Vale": ("student", "none")}
    assert len(detail["sessions"]) == 1
    s = detail["sessions"][0]
    assert (s["title"], s["state"], s["driver_id"], s["version"]) == ("Sample session", "scheduled", None, 0)
    assert near(parse_iso(s["scheduled_for"]), server_now(v) + dt.timedelta(seconds=SAMPLE_LEAD_S))
    files = file_map(api, p["id"])
    assert sorted(files) == sorted(SEED_FILES)
    for path, content in SEED_FILES.items():
        f = files[path]
        assert (f["revision"], f["sha256"], f["size"]) == (1, sha(content), len(content.encode()))
        assert read_file(api, p["id"], f["id"]) == content
    cps = sample_checkpoints(api, p["id"])
    listed = api.get(f"/api/projects/{p['id']}/checkpoints").json()["checkpoints"]
    assert [c["name"] for c in listed] == ["Minute 40", "Starter"]
    for name, tip_text in (("Starter", STARTER_TIP), ("Minute 40", SEED_FILES["src/tip.js"])):
        cp = checkpoint_of(api, cps[name]["id"])
        assert cp["created_by"]["id"] == user["id"] and cp["file_count"] == 4
        assert sorted(x["path"] for x in cp["files"]) == sorted(SEED_FILES)
        tip_id = next(x["file_id"] for x in cp["files"] if x["path"] == "src/tip.js")
        r = api.get(f"/api/checkpoints/{cp['id']}/files/{tip_id}")
        assert r.status_code == 200 and r.json()["file"]["content"] == tip_text


def test_samples_separate_and_identical(app_url: str, mail: Mailpit) -> None:
    a, b = new_mentor(mail, app_url), new_mentor(mail, app_url)
    pa, pb = sample_project(a)["id"], sample_project(b)["id"]
    assert pa != pb
    fa, fb = file_map(a, pa), file_map(b, pb)
    assert {k: v["sha256"] for k, v in fa.items()} == {k: v["sha256"] for k, v in fb.items()}
    assert not {v["id"] for v in fa.values()} & {v["id"] for v in fb.values()}
    ca, cb = sample_checkpoints(a, pa), sample_checkpoints(b, pb)
    assert set(ca) == set(cb) and not {c["id"] for c in ca.values()} & {c["id"] for c in cb.values()}
    tip = fa["src/tip.js"]["id"]
    for path in (f"/api/projects/{pa}", f"/api/projects/{pa}/files", f"/api/projects/{pa}/files/{tip}",
                 f"/api/projects/{pa}/checkpoints", f"/api/checkpoints/{ca['Starter']['id']}",
                 f"/api/sessions/{project_of(a, pa)['sessions'][0]['id']}"):
        expect_error(b.get(path), 404, "not_found")
    assert audit_of(a, pa) == []
    for cp in ca.values():
        assert a.get(f"/api/checkpoints/{cp['id']}/reviewer-links").json()["links"] == []
    keys = S3().keys(f"projects/{pa}/")
    blobs = {k.rsplit("/", 1)[1] for k in keys if "/blobs/" in k}
    assert blobs == {sha(c) for c in list(SEED_FILES.values()) + [STARTER_TIP]}
    assert sorted(k for k in keys if "/blobs/" not in k) == sorted(manifest_key(pa, c["id"]) for c in ca.values())


def assert_sample_screen(page: Page) -> None:
    expect(page.get_by_role("heading", level=1)).to_have_text("Sample session", timeout=UI_MS)
    expect(participant(page, "Robin Vale")).to_be_visible()
    expect(ledger_rows(page).nth(0)).to_contain_text("Minute 40")
    expect(ledger_rows(page).nth(1)).to_contain_text("Starter")
    for name in ("README.md", "index.html"):
        expect(tree_item(page, name)).to_be_visible()
    folder = tree_item(page, "src", folder=True)
    if folder.get_attribute("aria-expanded") == "false":
        folder.click()
    for name in ("tip.js", "tip.test.js"):
        expect(tree_item(page, name)).to_be_visible()
    expect(page.get_by_role("tree", name="Files").get_by_role("treeitem")).to_have_count(5)


def test_wf_onboarding_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    address, _ = person("first")
    with ui(browser, Api(app_url), "/sign-in") as page:
        page.get_by_role("textbox", name="Email").fill(address)
        btn(page, "Email me a sign-in link").click()
        expect(status(page, "Sign-in status")).to_have_text("Check your inbox. The link works once.", timeout=UI_MS)
        link = next(u for u in re.findall(r"https?://\S+", text(await_inbox(mail, address, 1, SIGN_IN_SUBJECT)[0]))
                    if TOKEN_RE.search(u))
        parts = urllib.parse.urlsplit(link)
        page.goto(f"{app_url}{parts.path}?{parts.query}")
        page.reload()
        btn(page, "Finish signing in").click()
        expect(page).to_have_url(UUID_URL, timeout=UI_MS)
        pid = UUID_URL.search(page.url).group(1)
        assert_sample_screen(page)
        page.reload()
        expect(page).to_have_url(re.compile(f"/projects/{pid}$"))
        assert_sample_screen(page)
        api = browser_api(page, app_url)
    projects = api.get("/api/projects").json()["projects"]
    assert [(p["id"], p["title"]) for p in projects] == [(pid, SAMPLE_TITLE)]
    assert {k: v["sha256"] for k, v in file_map(api, pid).items()} == {k: sha(v) for k, v in SEED_FILES.items()}


def test_wf_onboarding_invalid_email(browser: Browser, app_url: str, mail: Mailpit) -> None:
    address, _ = person("fix")
    with ui(browser, Api(app_url), "/sign-in") as page:
        field = page.get_by_role("textbox", name="Email")
        field.fill(NOT_EMAIL)
        field.press("Enter")
        expect(status(page, "Sign-in status")).to_have_text("Enter an email address like name@example.com.", timeout=UI_MS)
        expect(field).to_have_value(NOT_EMAIL)
        field.fill(address)
        btn(page, "Email me a sign-in link").click()
        expect(status(page, "Sign-in status")).to_have_text("Check your inbox. The link works once.", timeout=UI_MS)
    assert len(await_inbox(mail, address, 1, SIGN_IN_SUBJECT)) == 1


def test_wf_onboarding_used_link(browser: Browser, app_url: str, mail: Mailpit) -> None:
    address, _ = person("used")
    assert post_json(app_url, "/api/auth/magic-link", {"email": address}).status_code == 202
    path = "/auth/verify?token=" + wait_token(mail, address, subject=SIGN_IN_SUBJECT)
    with ui(browser, Api(app_url), path) as page:
        btn(page, "Finish signing in").click()
        expect(page).to_have_url(UUID_URL, timeout=UI_MS)
    with ui(browser, Api(app_url), path) as page:
        btn(page, "Finish signing in").click()
        expect(status(page, "Sign-in status")).to_have_text(
            "This sign-in link has already been used. Request a new one.", timeout=UI_MS)
    with ui(browser, Api(app_url), "/auth/verify?token=" + JUNK_TOKEN) as page:
        btn(page, "Finish signing in").click()
        expect(status(page, "Sign-in status")).to_have_text("This sign-in link isn't valid. Request a new one.", timeout=UI_MS)


def test_wf_onboarding_mail_outage(browser: Browser, mail: Mailpit) -> None:
    base = env_url("APP_MAILPIT_DOWN_URL")
    address, _ = person("nomail")
    expect_error(post_json(base, "/api/auth/magic-link", {"email": address}), 503, "mail_unavailable")
    with ui(browser, Api(base), "/sign-in") as page:
        page.get_by_role("textbox", name="Email").fill(address)
        btn(page, "Email me a sign-in link").click()
        expect(status(page, "Sign-in status")).to_have_text(
            "Sign-in email can't be sent right now. Try again in a minute.", timeout=UI_MS)
        expect(page.get_by_role("textbox", name="Email")).to_have_value(address)
    deadline = time.monotonic() + MAIL_RETRY_S + MAIL_RETRY_S / 2
    while time.monotonic() < deadline:
        assert inbox(mail, address, settle_s=MAIL_SETTLE_S) == []


def test_projects_and_seats(app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    for body in ({"title": "", "kind": "group"}, {"title": "x" * (NAME_MAX + 1), "kind": "group"},
                 {"title": label("Kind"), "kind": "classroom"}):
        expect_error(mentor.post("/api/projects", body), 422, "validation")
    assert mentor.post("/api/projects", {"title": "t" * NAME_MAX, "kind": "group"}).status_code == 201
    solo = new_project(mentor, "one_to_one")
    assert solo["kind"] == "one_to_one"
    first = join(mail, mentor, solo["id"])
    expect_error(first.post("/api/projects", {"title": label("Mine"), "kind": "group"}), 403, "forbidden")
    extra, extra_name = person("extra")
    expect_error(invite(mentor, solo["id"], extra, extra_name), 409, "seat_taken")
    assert invite(mentor, solo["id"], first.email, first.name).status_code == 201
    assert [m["role"] for m in project_of(mentor, solo["id"])["members"]].count("student") == 1
    team = new_project(mentor, "group")
    for _ in range(GROUP_SEATS):
        address, name = person("seat")
        assert invite(mentor, team["id"], address, name).status_code == 201
    over, over_name = person("over")
    expect_error(invite(mentor, team["id"], over, over_name), 409, "group_full")
    assert [m["role"] for m in project_of(mentor, team["id"])["members"]].count("student") == GROUP_SEATS
    listed = next(p for p in mentor.get("/api/projects").json()["projects"] if p["id"] == team["id"])
    assert listed["student_count"] == GROUP_SEATS and listed["kind"] == "group"
    assert inbox(mail, extra) == [] and inbox(mail, over) == []


def test_wf_members_seat_full(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, _ = group(mail, app_url, 1, "one_to_one")
    address, name = person("second")
    with ui(browser, mentor, f"/projects/{project['id']}") as page:
        btn(page, "Members").click()
        page.get_by_role("textbox", name="Learner email").fill(address)
        page.get_by_role("textbox", name="Learner name").fill(name)
        btn(page, "Send invite").click()
        expect(status(page, "Members status", True)).to_have_text(
            "This one-to-one project already has a learner. Remove them first.", timeout=UI_MS)
    assert [m["role"] for m in project_of(mentor, project["id"])["members"]].count("student") == 1
    assert inbox(mail, address) == []


def test_invites_idempotency_and_landing(app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    first = new_project(mentor, "group")
    ana = join(mail, mentor, first["id"], "ana")
    second = new_project(mentor, "group")
    seen = all_tokens(mail, ana.email)
    key = idempotency_key()
    r = invite(mentor, second["id"], ana.email, ana.name, key)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["invite"]["email_status"] == "sent" and body["member"]["role"] == "student"
    assert body["member"]["user_id"] == ana.user["id"]
    subject = f"{mentor.name} invited you to {second['title']}"
    assert len(await_inbox(mail, ana.email, 1, subject)) == 1
    replay = invite(mentor, second["id"], ana.email, ana.name, key)
    assert replay.status_code == 201 and replay.json() == body
    expect_error(invite(mentor, second["id"], ana.email, label("Other"), key), 409, "idempotency_conflict")
    missing = mentor.post(f"/api/projects/{second['id']}/invites", {"email": ana.email, "name": ana.name})
    assert "Idempotency-Key" in expect_error(missing, 422, "validation")["fields"]
    assert len(inbox(mail, ana.email, subject)) == 1
    token = wait_token(mail, ana.email, seen, subject)
    assert Api(app_url).verify(token).landing == f"/projects/{second['id']}"
    third = new_project(mentor, "group")
    seen = all_tokens(mail, ana.email)
    assert invite(mentor, third["id"], ana.email, ana.name).status_code == 201
    later = wait_token(mail, ana.email, seen)
    assert mentor.delete(f"/api/projects/{third['id']}/members/{ana.user['id']}").status_code == 204
    assert Api(app_url).verify(later).landing == "/"


def test_wf_members_queued(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    down = mentor.clone(env_url("APP_MAILPIT_DOWN_URL"))
    pid = new_project(down, "group")["id"]
    api_email, api_name = person("queued")
    r = invite(down, pid, api_email, api_name)
    assert r.status_code == 201, r.text
    assert r.json()["invite"]["email_status"] == "queued" and r.json()["member"]["email_status"] == "queued"
    ui_email, ui_name = person("queuedui")
    with ui(browser, down, f"/projects/{pid}") as page:
        btn(page, "Members").click()
        page.get_by_role("textbox", name="Learner email").fill(ui_email)
        page.get_by_role("textbox", name="Learner name").fill(ui_name)
        btn(page, "Send invite").click()
        region = status(page, "Members status", True)
        expect(region).to_contain_text(f"Invite recorded for {ui_email}.", timeout=UI_MS)
        expect(region).to_contain_text("Email queued")
    for address, name in ((api_email, api_name), (ui_email, ui_name)):
        def delivered() -> bool:
            row = next(m for m in project_of(down, pid)["members"] if m["name"] == name)
            if row["email_status"] == "sent":
                assert len(inbox(mail, address, settle_s=MAIL_SETTLE_S)) == 1
                return True
            assert row["email_status"] == "queued", row
            return False
        poll(delivered, MAIL_RETRY_S * 3, f"queued invite to {address} delivered")
        assert len(inbox(mail, address)) == 1


def test_member_removal_immediate(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (student,) = group(mail, app_url, 1)
    pid = project["id"]
    f = add_file(mentor, pid, DRIVE_PATH, DRIVE_TEXT)
    live = go_live(mentor, pid)
    r = claim(student, live["id"], live["version"])
    assert r.status_code == 200, r.text
    version = r.json()["session"]["version"]
    sock = Sock(browser, student, pid)
    try:
        started = sock.now()
        assert mentor.delete(f"/api/projects/{pid}/members/{student.user['id']}").status_code == 204
        expect_error(student.get(f"/api/projects/{pid}"), 404, "not_found")
        expect_error(put_file(student, pid, f, "late\n"), 404, "not_found")
        closed = sock.wait_closed()
        assert sock.matches("access_revoked")
        assert closed["code"] == CLOSE_REMOVED and closed["reason"] == "removed"
        assert closed["at"] - started <= LIVE_MS
    finally:
        sock.close()
    after = session_of(mentor, live["id"])
    assert after["driver_id"] == mentor.user["id"] and after["version"] == version + 1
    expect_error(mentor.delete(f"/api/projects/{pid}/members/{mentor.user['id']}"), 403, "forbidden")


def test_audit_attributed(app_url: str, mail: Mailpit) -> None:
    mentor, project, (stay, leave) = group(mail, app_url, 2)
    pid = project["id"]
    outsider = new_mentor(mail, app_url)
    add_file(mentor, pid, "doc/a.txt", "a\n")
    add_file(mentor, pid, "doc/b.txt", "b\n")
    cp = make_checkpoint(mentor, pid)
    r = restore(stay, cp["id"])
    assert r.status_code == 200, r.text
    rid = r.json()["restore"]["id"]
    assert undo(stay, rid).status_code == 200
    expect_error(undo(stay, rid), 409, "restore_already_undone")
    moved = mentor.post(f"/api/projects/{pid}/folders/rename", {"from": "doc", "to": "docs"})
    assert moved.status_code == 200, moved.text
    target = next(x for x in moved.json()["files"] if x["path"] == "docs/b.txt")
    assert mentor.delete(f"/api/projects/{pid}/files/{target['id']}").status_code == 204
    plan = upload(mentor, pid, make_zip([("docs/new.txt", b"new\n")]))
    assert plan.status_code == 201, plan.text
    assert apply(mentor, plan.json()["import"]["id"], {}).status_code == 200
    link = create_link(mentor, cp["id"], 1).json()["link"]
    assert mentor.post(f"/api/reviewer-links/{link['id']}/regenerate").status_code == 200
    assert mentor.post(f"/api/reviewer-links/{link['id']}/revoke").status_code == 200
    assert mentor.delete(f"/api/projects/{pid}/members/{leave.user['id']}").status_code == 204
    events = audit_of(mentor, pid)
    expected = {"member_removed": 1, "checkpoint_restored": 1, "restore_undone": 1, "import_applied": 1,
                "file_renamed": 2, "file_deleted": 1, "reviewer_link_created": 1,
                "reviewer_link_regenerated": 1, "reviewer_link_revoked": 1}
    for kind, count in expected.items():
        assert [e["type"] for e in events].count(kind) == count, (kind, events)
    for e in events:
        if e["type"] not in expected:
            continue
        actor = stay if e["type"] in ("checkpoint_restored", "restore_undone") else mentor
        assert (e["actor"]["id"], e["actor"]["name"]) == (actor.user["id"], actor.name), e
        parse_iso(e["at"])
    stamps = [parse_iso(e["at"]) for e in events]
    assert stamps == sorted(stamps, reverse=True)
    removed = next(e for e in events if e["type"] == "member_removed")
    assert leave.user["id"] in json.dumps(removed["subject"]) or leave.name in json.dumps(removed["subject"])
    expect_error(stay.get(f"/api/projects/{pid}/audit"), 403, "forbidden")
    expect_error(leave.get(f"/api/projects/{pid}/audit"), 404, "not_found")
    expect_error(outsider.get(f"/api/projects/{pid}/audit"), 404, "not_found")


def test_wf_members_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    ana = join(mail, mentor, new_project(mentor, "group")["id"], "ana")
    title = label("Group")
    with ui(browser, mentor, "/") as page:
        btn(page, "New project").click()
        dialog = page.get_by_role("dialog", name="New project")
        dialog.get_by_role("textbox", name="Project title").fill(title)
        dialog.get_by_role("radio", name="Group").check()
        btn(dialog, "Create project").click()
        expect(page).to_have_url(UUID_URL, timeout=UI_MS)
        pid = UUID_URL.search(page.url).group(1)
        created = project_of(mentor, pid)
        assert (created["title"], created["kind"]) == (title, "group")
        page.reload()
        expect(page).to_have_url(re.compile(f"/projects/{pid}$"))
        expect(page.get_by_role("heading", level=1)).to_have_text("No session scheduled", timeout=UI_MS)
        seen = all_tokens(mail, ana.email)
        btn(page, "Members").click()
        page.get_by_role("textbox", name="Learner email").fill(ana.email)
        page.get_by_role("textbox", name="Learner name").fill(ana.name)
        btn(page, "Send invite").click()
        region = status(page, "Members status", True)
        expect(region).to_contain_text(f"Invite recorded for {ana.email}.", timeout=UI_MS)
        expect(region).to_contain_text("Email sent")
        token = wait_token(mail, ana.email, seen, f"{mentor.name} invited you to {title}")
        with ui(browser, Api(app_url), "/auth/verify?token=" + token) as learner_page:
            btn(learner_page, "Finish signing in").click()
            expect(learner_page).to_have_url(re.compile(f"/projects/{pid}$"), timeout=UI_MS)
            expect(participant(page, ana.name, True)).to_contain_text("viewing", timeout=UI_MS)
            btn(page, f"Remove {ana.name}").click()
            btn(page.get_by_role("alertdialog", name=f"Remove {ana.name}?"), "Remove").click()
            expect(region).to_have_text(f"{ana.name} was removed. Their access has ended.", timeout=UI_MS)
            expect(page.get_by_role("list", name="Members").get_by_role("listitem").filter(has_text=ana.name)).to_have_count(0)
            expect(participant(page, ana.name, True)).to_have_count(0)
            expect(status(learner_page, "Editor status")).to_contain_text("You were removed from this project.", timeout=UI_MS)
            learner_api = browser_api(learner_page, app_url)
            expect_error(learner_api.get(f"/api/projects/{pid}"), 404, "not_found")
            expect(learner_page).to_have_url(re.compile(r"/$"), timeout=REDIRECT_MS + UI_MS)
            expect(learner_page.get_by_role("link", name=title)).to_have_count(0)
    assert member(mentor, pid, ana.user["id"]) is None


def test_session_lifecycle(app_url: str, mail: Mailpit) -> None:
    mentor, project, (student,) = group(mail, app_url, 1)
    pid = project["id"]
    expect_error(mentor.post(f"/api/projects/{pid}/sessions", {"title": "", "scheduled_for": SCHEDULED_FOR}), 422, "validation")
    s = schedule(mentor, pid)
    assert (s["state"], s["driver_id"], s["version"]) == ("scheduled", None, 0)
    sid = s["id"]

    def illegal(action: str, src: str, dst: str) -> None:
        body = expect_error(act(mentor, sid, action), 409, "illegal_transition")
        assert (body["from"], body["to"]) == (src, dst)
    for action, dst in (("pause", "paused"), ("resume", "live"), ("end", "ended")):
        illegal(action, "scheduled", dst)
    expect_error(act(student, sid, "start"), 403, "forbidden")
    live = act(mentor, sid, "start").json()["session"]
    assert (live["state"], live["driver_id"], live["version"]) == ("live", mentor.user["id"], 1)
    illegal("resume", "live", "live")
    other = schedule(mentor, pid)
    assert expect_error(act(mentor, other["id"], "start"), 409, "session_already_live")["session_id"] == sid
    paused = act(mentor, sid, "pause").json()["session"]
    assert (paused["state"], paused["driver_id"], paused["version"]) == ("paused", mentor.user["id"], 1)
    expect_error(act(mentor, other["id"], "start"), 409, "session_already_live")
    illegal("pause", "paused", "paused")
    resumed = act(mentor, sid, "resume").json()["session"]
    assert (resumed["state"], resumed["driver_id"]) == ("live", mentor.user["id"])
    ended = act(mentor, sid, "end").json()["session"]
    assert (ended["state"], ended["driver_id"], ended["version"]) == ("ended", None, 2)
    for action, dst in (("start", "live"), ("pause", "paused"), ("resume", "live"), ("end", "ended")):
        illegal(action, "ended", dst)
    assert act(mentor, other["id"], "start").status_code == 200


def test_baton_claim_race(app_url: str, mail: Mailpit) -> None:
    mentor, project, students = group(mail, app_url, 3)
    s = schedule(mentor, project["id"])
    assert expect_error(claim(students[0], s["id"], 0), 409, "session_not_live")["state"] == "scheduled"
    live = act(mentor, s["id"], "start").json()["session"]
    expect_error(claim(mentor, s["id"], live["version"]), 409, "already_driving")
    expect_error(students[0].post(f"/api/sessions/{s['id']}/baton/claim", {}), 422, "validation")
    barrier = threading.Barrier(len(students))

    def fire(student: Api) -> httpx.Response:
        barrier.wait()
        return claim(student, s["id"], live["version"])
    with ThreadPoolExecutor(len(students)) as pool:
        results = list(pool.map(fire, students))
    winners = [st for st, r in zip(students, results) if r.status_code == 200]
    assert len(winners) == 1, [r.text for r in results]
    for r in results:
        if r.status_code != 200:
            body = expect_error(r, 409, "baton_taken")
            assert (body["driver_id"], body["driver_name"], body["version"]) == (winners[0].user["id"], winners[0].name, live["version"] + 1)
    after = session_of(mentor, s["id"])
    assert (after["driver_id"], after["version"]) == (winners[0].user["id"], live["version"] + 1)


def test_wf_baton_race(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a, b) = group(mail, app_url, 2)
    pid = project["id"]
    add_file(mentor, pid, DRIVE_PATH, DRIVE_TEXT)
    live = go_live(mentor, pid)
    with ui(browser, a, f"/projects/{pid}") as pa, ui(browser, b, f"/projects/{pid}") as pb:
        expect(btn(pa, "Take the baton")).to_be_visible(timeout=UI_MS)
        expect(btn(pb, "Take the baton")).to_be_visible(timeout=UI_MS)
        with held(pb, "**/baton/claim") as hold:
            btn(pb, "Take the baton").click()
            expect(status(pb, "Baton status")).to_contain_text("Claiming the baton…", timeout=UI_MS)
            btn(pa, "Take the baton").click()
            poll(lambda: session_of(mentor, live["id"])["driver_id"] == a.user["id"], UI_MS / 1000, "first claim")
            hold.release()
        expect(status(pb, "Baton status")).to_contain_text(f"{a.name} took the baton first.", timeout=UI_MS)
        expect(participant(pa, a.name)).to_contain_text("driving", timeout=UI_MS)
    final = session_of(mentor, live["id"])
    assert (final["driver_id"], final["version"]) == (a.user["id"], live["version"] + 1)


def test_baton_pass(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a, b, c) = group(mail, app_url, 3)
    pid = project["id"]
    live = go_live(mentor, pid)
    sid, v = live["id"], live["version"]
    sock = Sock(browser, b, pid)
    try:
        r = pass_baton(mentor, sid, a.user["id"], v)
        assert r.status_code == 200 and r.json()["session"]["driver_id"] == a.user["id"]
        assert r.json()["session"]["version"] == v + 1
        sock.wait("session", {"session.driver_id": a.user["id"], "session.version": v + 1})
        r = pass_baton(a, sid, b.user["id"], v + 1)
        assert r.status_code == 200 and r.json()["session"]["version"] == v + 2
        expect_error(pass_baton(c, sid, c.user["id"], v + 2), 403, "forbidden")
        body = expect_error(pass_baton(mentor, sid, a.user["id"], v + 1), 409, "baton_taken")
        assert (body["driver_id"], body["version"]) == (b.user["id"], v + 2)
        expect_error(pass_baton(mentor, sid, b.user["id"], v + 2), 409, "already_driving")
        assert "to_user_id" in expect_error(pass_baton(mentor, sid, str(uuid.uuid4()), v + 2), 422, "validation")["fields"]
        assert act(mentor, sid, "pause").status_code == 200
        assert expect_error(pass_baton(mentor, sid, a.user["id"], v + 2), 409, "session_not_live")["state"] == "paused"
    finally:
        sock.close()
    final = session_of(mentor, sid)
    assert (final["driver_id"], final["version"]) == (b.user["id"], v + 2)


def test_old_driver_refused(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    f = add_file(mentor, pid, DRIVE_PATH, DRIVE_TEXT)
    live = go_live(mentor, pid)
    assert pass_baton(mentor, live["id"], a.user["id"], live["version"]).status_code == 200
    sock = Sock(browser, a, pid)
    try:
        with ui(browser, a, f"/projects/{pid}") as page:
            open_file(page, DRIVE_PATH)
            assert claim(mentor, live["id"], live["version"] + 1).status_code == 200
            assert expect_error(put_file(a, pid, f, "stolen\n"), 403, "not_driver")["driver_id"] == mentor.user["id"]
            sock.send({"type": "edit", "file_id": f["id"], "base_revision": f["revision"], "content": "stolen\n"})
            sock.wait("edit_rejected", {"file_id": f["id"], "code": "not_driver"})
            expect(code_editor(page)).to_have_attribute("aria-readonly", "true", timeout=UI_MS)
            expect(status(page, "Editor status")).to_contain_text(f"You are viewing — {mentor.name} is driving.")
            before = code_editor(page).evaluate(EDITOR_TEXT_JS)
            type_at_end(page, "zzz")
            assert code_editor(page).evaluate(EDITOR_TEXT_JS) == before
    finally:
        sock.close()
    now = file_map(mentor, pid)[DRIVE_PATH]
    assert (now["revision"], now["sha256"]) == (f["revision"], f["sha256"])


def test_presence_rail(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a, b) = group(mail, app_url, 2)
    pid = project["id"]
    with ui(browser, mentor, f"/projects/{pid}") as page:
        items = participants(page)
        expect(items).to_have_count(3, timeout=UI_MS)
        for i, who in enumerate((mentor, a, b)):
            expect(items.nth(i)).to_contain_text(who.name)
            one_state(items.nth(i))
        expect(items.nth(1)).to_contain_text("offline")
        sock = Sock(browser, a, pid)
        try:
            expect(items.nth(1)).to_contain_text("viewing", timeout=LIVE_MS)
            assert member(mentor, pid, a.user["id"])["online"] is True
            go_live(mentor, pid)
            expect(items.nth(0)).to_contain_text("driving", timeout=LIVE_MS)
            expect(items.filter(has_text="driving")).to_have_count(1)
            expect(page.get_by_role("img", name="Baton")).to_have_count(1)
        finally:
            sock.close()
        expect(items.nth(1)).to_contain_text("offline", timeout=LIVE_MS)
        for i in range(3):
            one_state(items.nth(i))


def run_baton_change(browser: Browser, app_url: str, mail: Mailpit, reduced: str,
                     check: Callable[[Page, list[dict[str, float]], dict[str, float], dict[str, float], dict[str, float], Api, Api], None]) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    live = go_live(mentor, pid)
    with clocked(browser, mentor, reduced=reduced) as page:
        with page.expect_websocket(lambda w: WS_URL in w.url, timeout=UI_MS) as info:
            page.goto(f"{mentor.base}/projects/{pid}")
        ws = info.value
        baton = page.get_by_role("img", name="Baton")
        expect(baton).to_have_count(1, timeout=UI_MS)
        expect(participant(page, a.name)).to_be_visible()
        settle(baton)
        old, new = box(participant(page, mentor.name)), box(participant(page, a.name))
        with ws.expect_event("framereceived", predicate=session_frame_for(a.user["id"]), timeout=UI_MS):
            assert claim(a, live["id"], live["version"]).status_code == 200
        page.clock.run_for(FRAME_MS)
        path = baton.evaluate(SEEK_FLIGHT, BATON_SAMPLES) or motion(baton, BATON_MAX_MS, settle_ms=0)
        settle(baton)
        check(page, path, sample(baton), old, new, mentor, a)
        expect(status(page, "Baton status")).to_contain_text(f"{a.name} is now driving", timeout=UI_MS)
        expect(participant(page, a.name)).to_contain_text("driving")
        expect(participant(page, mentor.name)).to_contain_text("viewing")
        expect(page.get_by_role("img", name="Baton")).to_have_count(1)


def test_baton_pass_motion(browser: Browser, app_url: str, mail: Mailpit) -> None:
    def check(page: Page, path: list[dict[str, float]], final: dict[str, float], old: dict[str, float],
              new: dict[str, float], mentor: Api, a: Api) -> None:
        start, end, mid = rect_center(path[0]), rect_center(path[-1]), rect_center(path[len(path) // 2])
        assert inside(start, old), (start, old)
        assert inside(end, new), (end, new)
        assert distance(end, rect_center(final)) <= 2
        assert distance(mid, start) > 1 and distance(mid, end) > 1, path
    run_baton_change(browser, app_url, mail, "no-preference", check)


def test_baton_reduced_motion(browser: Browser, app_url: str, mail: Mailpit) -> None:
    def check(page: Page, path: list[dict[str, float]], final: dict[str, float], old: dict[str, float],
              new: dict[str, float], mentor: Api, a: Api) -> None:
        for s in path[1:]:
            assert inside(rect_center(s), new), (s, new)
    run_baton_change(browser, app_url, mail, "reduce", check)


def test_wf_baton_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    f = add_file(mentor, pid, DRIVE_PATH, DRIVE_TEXT)
    live = go_live(mentor, pid)
    marker = label("typed")
    with ui(browser, mentor, f"/projects/{pid}") as pm, ui(browser, a, f"/projects/{pid}") as pa:
        open_file(pm, DRIVE_PATH)
        open_file(pa, DRIVE_PATH)
        btn(pa, "Take the baton").click()
        expect(participant(pm, a.name)).to_contain_text("driving", timeout=UI_MS)
        expect(code_editor(pa)).not_to_have_attribute("aria-readonly", "true", timeout=UI_MS)
        type_at_end(pa, marker)
        editor_contains(pm, marker, DEBOUNCE_MS + LIVE_MS)
        btn(pm, "Pass the baton").click()
        pm.get_by_role("menu", name="Pass to").get_by_role("menuitem", name=mentor.name).click()
        expect(code_editor(pa)).to_have_attribute("aria-readonly", "true", timeout=UI_MS)
        expect(status(pa, "Editor status")).to_contain_text(f"You are viewing — {mentor.name} is driving.")
    assert marker in read_file(mentor, pid, f["id"])
    after = session_of(mentor, live["id"])
    assert (after["driver_id"], after["version"]) == (mentor.user["id"], live["version"] + 2)
    expect_error(put_file(a, pid, file_map(a, pid)[DRIVE_PATH], "late\n"), 403, "not_driver")


def test_wf_baton_not_live(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    live = go_live(mentor, pid)
    with ui(browser, a, f"/projects/{pid}") as page:
        with held(page, "**/baton/claim") as hold:
            btn(page, "Take the baton").click()
            assert act(mentor, live["id"], "pause").status_code == 200
            hold.release()
        expect(status(page, "Baton status")).to_contain_text("The baton is only passed during a live session.", timeout=UI_MS)
    after = session_of(mentor, live["id"])
    assert (after["state"], after["driver_id"]) == ("paused", mentor.user["id"])


def test_write_rule(app_url: str, mail: Mailpit) -> None:
    mentor, project, (a, b) = group(mail, app_url, 2)
    pid = project["id"]
    f = add_file(mentor, pid, "src/rule.js", "1\n")
    cp = make_checkpoint(mentor, pid)
    f = save_ok(a, pid, f, "2\n")
    extra = add_file(b, pid, "src/b.js", "b\n")
    assert b.delete(f"/api/projects/{pid}/files/{extra['id']}").status_code == 204
    live = go_live(mentor, pid)
    for r in (put_file(a, pid, f, "x\n"), a.post(f"/api/projects/{pid}/files", {"path": "src/c.js", "content": "c\n"}),
              a.delete(f"/api/projects/{pid}/files/{f['id']}"), restore(a, cp["id"])):
        assert expect_error(r, 403, "not_driver")["driver_id"] == mentor.user["id"]
    assert file_map(mentor, pid)["src/rule.js"]["revision"] == f["revision"]
    f = save_ok(mentor, pid, f, "3\n")
    assert pass_baton(mentor, live["id"], a.user["id"], live["version"]).status_code == 200
    f = save_ok(a, pid, f, "4\n")
    assert expect_error(put_file(mentor, pid, f, "y\n"), 403, "not_driver")["driver_id"] == a.user["id"]
    expect_error(a.patch(f"/api/projects/{pid}/files/{f['id']}", {"path": "src/rule2.js"}), 403, "forbidden")
    renamed = mentor.patch(f"/api/projects/{pid}/files/{f['id']}", {"path": "src/rule2.js"})
    assert renamed.status_code == 200, renamed.text
    assert b.post(f"/api/projects/{pid}/checkpoints", {"name": label("Live")}).status_code in (201, 202)
    assert act(mentor, live["id"], "pause").status_code == 200
    for r in (put_file(a, pid, f, "z\n"), put_file(mentor, pid, f, "z\n"),
              b.post(f"/api/projects/{pid}/files", {"path": "src/d.js", "content": "d\n"})):
        expect_error(r, 409, "session_paused")
    assert b.post(f"/api/projects/{pid}/checkpoints", {"name": label("Paused")}).status_code in (201, 202)
    assert mentor.patch(f"/api/projects/{pid}/files/{f['id']}", {"path": "src/rule3.js"}).status_code == 200
    now = file_map(mentor, pid)["src/rule3.js"]
    assert (now["revision"], now["sha256"]) == (f["revision"], f["sha256"])
    assert act(mentor, live["id"], "end").status_code == 200
    now = save_ok(b, pid, now, "5\n")
    save_ok(a, pid, now, "6\n")


def test_wf_live_editing_paused(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    f = add_file(mentor, pid, DRIVE_PATH, DRIVE_TEXT)
    live = go_live(mentor, pid)
    assert pass_baton(mentor, live["id"], a.user["id"], live["version"]).status_code == 200
    with ui(browser, a, f"/projects/{pid}") as page:
        open_file(page, DRIVE_PATH)
        assert act(mentor, live["id"], "pause").status_code == 200
        expect(status(page, "Editor status")).to_contain_text(
            "Session paused — editing resumes when the mentor resumes.", timeout=UI_MS)
        expect(code_editor(page)).to_have_attribute("aria-readonly", "true")
    expect_error(put_file(a, pid, f, "x\n"), 409, "session_paused")
    expect_error(put_file(mentor, pid, f, "x\n"), 409, "session_paused")
    assert file_map(mentor, pid)[DRIVE_PATH]["sha256"] == f["sha256"]


def test_wf_live_editing_between_sessions(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    f = add_file(mentor, pid, DRIVE_PATH, DRIVE_TEXT)
    first, second = label("learner"), label("mentor")
    with ui(browser, mentor, f"/projects/{pid}") as pm, ui(browser, a, f"/projects/{pid}") as pa:
        open_file(pm, DRIVE_PATH)
        open_file(pa, DRIVE_PATH)
        type_at_end(pa, "\n" + first)
        expect(status(pa, "Editor status")).to_contain_text("All changes saved", timeout=UI_MS)
        editor_contains(pm, first, DEBOUNCE_MS + LIVE_MS)
        type_at_end(pm, "\n" + second)
        editor_contains(pa, second, DEBOUNCE_MS + LIVE_MS)
    body = read_file(mentor, pid, f["id"])
    assert first in body and second in body


def test_concurrent_saves(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a, b) = group(mail, app_url, 2)
    pid = project["id"]
    f = add_file(mentor, pid, "src/race.js", "base\n")
    sa, sb = Sock(browser, a, pid), Sock(browser, b, pid)
    try:
        http_clients = [mentor, a, b]
        contents = {id(c): f"{label('http')}\n" for c in http_clients}
        socket_contents = [f"{label('socket')}\n", f"{label('socket')}\n"]
        barrier = threading.Barrier(len(http_clients) + 1)

        def fire(client: Api) -> httpx.Response:
            barrier.wait()
            return put_file(client, pid, f, contents[id(client)])
        with ThreadPoolExecutor(len(http_clients)) as pool:
            futures = [pool.submit(fire, c) for c in http_clients]
            barrier.wait()
            for sock, content in zip((sa, sb), socket_contents):
                sock.send({"type": "edit", "file_id": f["id"], "base_revision": f["revision"], "content": content})
            results = [x.result() for x in futures]
        sa.wait("file", {"file.id": f["id"], "file.revision": f["revision"] + 1})
        final = read_file(mentor, pid, f["id"])
        now = file_map(mentor, pid)["src/race.js"]
        assert now["revision"] == f["revision"] + 1 and now["sha256"] == sha(final)
        http_wins = [r for r in results if r.status_code == 200]
        socket_win = final in socket_contents
        assert len(http_wins) + int(socket_win) == 1
        assert final in list(contents.values()) + socket_contents
        for r in results:
            if r.status_code != 200:
                assert expect_error(r, 412, "stale_revision")["current_revision"] == f["revision"] + 1
        for sock, content in zip((sa, sb), socket_contents):
            if content != final:
                sock.wait("edit_rejected", {"file_id": f["id"], "code": "stale_revision", "current_revision": f["revision"] + 1})
    finally:
        sa.close()
        sb.close()


LINE_VISIBLE_JS = """([needle]) => {
  const clipped = (rect, el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(s.overflowY)) {
        const r = p.getBoundingClientRect();
        if (rect.bottom <= r.top || rect.top >= r.bottom) return true;
      }
    }
    return rect.bottom <= 0 || rect.top >= innerHeight;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof HTMLTextAreaElement) {
      const idx = n.value.split('\\n').findIndex((l) => l.includes(needle));
      if (idx < 0) continue;
      const s = getComputedStyle(n);
      const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
      const top = idx * lh + parseFloat(s.paddingTop || '0');
      if (top + lh > n.scrollTop && top < n.scrollTop + n.clientHeight) return true;
      continue;
    }
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const at = n.textContent.indexOf(needle);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(n, at); range.setEnd(n, at + needle.length);
    const rect = range.getBoundingClientRect();
    if (rect.height > 0 && !clipped(rect, n.parentElement)) return true;
  }
  return false;
}"""


def test_follow_participant(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    add_file(mentor, pid, LONG_PATH, "".join(f"line {i:03d}\n" for i in range(1, LONG_LINES + 1)))
    go_live(mentor, pid)
    last, first = f"line {LONG_LINES:03d}", "line 001"
    with ui(browser, a, f"/projects/{pid}") as pa, ui(browser, mentor, f"/projects/{pid}") as pm:
        open_file(pm, LONG_PATH)
        code_editor(pm).click()
        pm.keyboard.press("Control+End")
        follow = btn(pa, f"Follow {mentor.name}")
        follow.click()
        expect(follow).to_have_attribute("aria-pressed", "true")
        expect(pa.get_by_role("tab", name=LONG_PATH, exact=True)).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        expect(status(pa, "Editor status")).to_contain_text(f"Following {mentor.name} · {LONG_PATH}")
        pa.wait_for_function(LINE_VISIBLE_JS, arg=[last], timeout=UI_MS, polling=50)
        pm.keyboard.press("Control+Home")
        pa.wait_for_function(LINE_VISIBLE_JS, arg=[first], timeout=UI_MS, polling=50)
        pa.keyboard.press("Escape")
        expect(follow).to_have_attribute("aria-pressed", "false")
        follow.click()
        expect(follow).to_have_attribute("aria-pressed", "true")
        code_editor(pa).click()
        expect(follow).to_have_attribute("aria-pressed", "false")


def test_project_scoped_access(app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    own = new_project(mentor)["id"]
    learner = join(mail, mentor, own)
    other = new_project(mentor)["id"]
    f = add_file(mentor, other, "src/x.js", "x\n")
    cp = make_checkpoint(mentor, other)
    s = schedule(mentor, other)
    rid = restore(mentor, cp["id"]).json()["restore"]["id"]
    iid = upload(mentor, other, make_zip([("src/y.js", b"y\n")])).json()["import"]["id"]
    g = str(uuid.uuid4())
    cases = [
        ("GET", f"/api/projects/{other}", f"/api/projects/{g}", None),
        ("GET", f"/api/projects/{other}/files", f"/api/projects/{g}/files", None),
        ("GET", f"/api/projects/{other}/files/{f['id']}", f"/api/projects/{g}/files/{g}", None),
        ("PUT", f"/api/projects/{other}/files/{f['id']}", f"/api/projects/{g}/files/{g}", {"content": "z\n", "base_revision": 1}),
        ("GET", f"/api/projects/{other}/checkpoints", f"/api/projects/{g}/checkpoints", None),
        ("GET", f"/api/checkpoints/{cp['id']}", f"/api/checkpoints/{g}", None),
        ("GET", f"/api/checkpoints/{cp['id']}/files/{f['id']}", f"/api/checkpoints/{g}/files/{g}", None),
        ("GET", f"/api/sessions/{s['id']}", f"/api/sessions/{g}", None),
        ("POST", f"/api/checkpoints/{cp['id']}/restore", f"/api/checkpoints/{g}/restore", {}),
        ("POST", f"/api/restores/{rid}/undo", f"/api/restores/{g}/undo", {}),
        ("POST", f"/api/imports/{iid}/apply", f"/api/imports/{g}/apply", {"decisions": {}}),
        ("GET", f"/api/projects/{other}/audit", f"/api/projects/{g}/audit", None),
    ]
    for method, path, ghost, body in cases:
        r, ghosted = learner.request(method, path, body), learner.request(method, ghost, body)
        expect_error(r, 404, "not_found")
        assert r.json() == ghosted.json(), path
    assert learner.get(f"/api/projects/{own}").status_code == 200
    assert handshake(learner, other).status_code == 404
    assert handshake(Api(app_url), other).status_code == 401
    assert file_map(mentor, other)["src/x.js"]["revision"] == f["revision"]


def test_checkpoint_save_provider_confirmed(app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = new_project(mentor, "one_to_one")["id"]
    wrong, plain = f"{label('wrong')}\n".encode(), f"{label('plain')}\n".encode()
    add_file(mentor, pid, "data/wrong.txt", wrong.decode())
    add_file(mentor, pid, "data/plain.txt", plain.decode())
    assert s3_call("PUT", blob_key(pid, wrong), GARBAGE).status_code == 200
    assert s3_call("PUT", blob_key(pid, plain), plain).status_code == 200
    name = label("Confirmed")
    r = mentor.post(f"/api/projects/{pid}/checkpoints", {"name": name})
    assert r.status_code in (201, 202), r.text
    cp = wait_saved(mentor, r.json()["checkpoint"]["id"])
    store = S3()
    assert store.get(blob_key(pid, wrong)) == wrong
    for data in (wrong, plain):
        assert stored_checksum(blob_key(pid, data)) == b64sha(data)
    manifest = json.loads(store.get(manifest_key(pid, cp["id"])))
    assert (manifest["checkpoint_id"], manifest["project_id"], manifest["name"]) == (cp["id"], pid, name)
    assert manifest["created_at"]
    files = file_map(mentor, pid)
    assert [x["path"] for x in manifest["files"]] == sorted(files)
    blobs = store.keys(f"projects/{pid}/blobs/")
    for entry in manifest["files"]:
        f = files[entry["path"]]
        assert (entry["file_id"], entry["sha256"], entry["size"]) == (f["id"], f["sha256"], f["size"])
        assert f"projects/{pid}/blobs/{entry['sha256']}" in blobs
    assert checkpoint_of(mentor, cp["id"])["file_count"] == len(files)


def test_wf_checkpoints_outage(browser: Browser, mail: Mailpit) -> None:
    base = env_url("APP_MINIO_DOWN_URL")
    mentor = new_mentor(mail, base)
    pid = new_project(mentor, "one_to_one")["id"]
    add_file(mentor, pid, "README.md", "# Outage\n")
    name = label("Outage")
    with ui(browser, mentor, f"/projects/{pid}") as page:
        expect(page.get_by_role("heading", level=1)).to_be_visible(timeout=UI_MS)
        page.evaluate("() => { window.__sameDocument = true; }")
        page.get_by_role("textbox", name="Checkpoint name").fill(name)
        btn(page, "Save checkpoint").click()
        region = status(page, "Checkpoint status")
        expect(region).to_have_text(
            f'Checkpoint "{name}" is pending upload. Keep working — storage is unreachable right now.', timeout=UI_MS)
        expect(ledger_rows(page).first).to_contain_text(name)
        row = ledger_rows(page).filter(has_text=name)
        expect(row).to_contain_text("Pending upload")
        save_ok(mentor, pid, file_map(mentor, pid)["README.md"], "# Still editing\n")
        expect(row).to_contain_text("Failed", timeout=FAIL_WAIT_S * 1000)
        expect(region).to_have_text(f'Checkpoint "{name}" couldn\'t be uploaded. Save it again.')
        assert page.evaluate("() => window.__sameDocument === true")
    listed = mentor.get(f"/api/projects/{pid}/checkpoints").json()["checkpoints"]
    assert next(c for c in listed if c["name"] == name)["state"] == "failed"


def test_checkpoint_pending_recovers(mail: Mailpit) -> None:
    base = env_url("APP_MINIO_DOWN_URL")
    mentor = new_mentor(mail, base)
    pid = sample_project(mentor)["id"]
    r = mentor.post(f"/api/projects/{pid}/checkpoints", {"name": label("Recover")})
    assert r.status_code == 202, r.text
    cp = r.json()["checkpoint"]
    assert cp["state"] == "pending_upload"
    expect_error(mentor.get(f"/api/checkpoints/{cp['id']}/files/{file_map(mentor, pid)['README.md']['id']}"), 409, "checkpoint_not_saved")
    save_ok(mentor, pid, file_map(mentor, pid)["README.md"], "# Changed after the save\n")
    with Relay(s3_target()):
        wait_saved(mentor, cp["id"], UPLOAD_RETRY_S * 3)
        manifest = json.loads(S3().get(manifest_key(pid, cp["id"])))
    readme = next(x for x in manifest["files"] if x["path"] == "README.md")
    assert readme["sha256"] == sha(SEED_FILES["README.md"])


def test_wf_checkpoints_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    add_file(mentor, pid, DRIVE_PATH, DRIVE_TEXT)
    add_file(mentor, pid, LONG_PATH, "one\n")
    name = label("Ledger")
    with ui(browser, a, f"/projects/{pid}") as page:
        page.get_by_role("textbox", name="Checkpoint name").fill(name)
        with held(page, "**/checkpoints") as hold:
            btn(page, "Save checkpoint").click()
            expect(status(page, "Checkpoint status")).to_have_text("Saving checkpoint…", timeout=UI_MS)
            expect(btn(page, "Save checkpoint")).to_be_disabled()
            hold.release()
        expect(status(page, "Checkpoint status")).to_have_text(f'Checkpoint "{name}" saved.', timeout=UI_MS)
        top = ledger_rows(page).first
        expect(top).to_contain_text(name)
        expect(top).to_contain_text(a.name)
        expect(top).to_contain_text("Saved")
        expect(top).to_contain_text(re.compile(r"\b\d{2}:\d{2}\b"))
        expect(top).to_contain_text("2")
    cp = mentor.get(f"/api/projects/{pid}/checkpoints").json()["checkpoints"][0]
    assert (cp["name"], cp["state"], cp["created_by"]["id"], cp["file_count"]) == (name, "saved", a.user["id"], 2)
    assert manifest_key(pid, cp["id"]) in S3().keys(f"projects/{pid}/checkpoints/")


def test_wf_checkpoints_invalid(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = new_project(mentor, "one_to_one")["id"]
    add_file(mentor, pid, DRIVE_PATH, DRIVE_TEXT)
    name = label("Enter")
    with ui(browser, mentor, f"/projects/{pid}") as page:
        field = page.get_by_role("textbox", name="Checkpoint name")
        for bad in ("", "n" * (NAME_MAX + 1)):
            field.fill(bad)
            if bad and len(field.input_value()) <= NAME_MAX:
                continue
            field.press("Enter")
            expect(status(page, "Checkpoint status")).to_have_text("Give the checkpoint a name of 1 to 80 characters.", timeout=UI_MS)
        assert mentor.get(f"/api/projects/{pid}/checkpoints").json()["checkpoints"] == []
        field.fill(name)
        field.press("Enter")
        expect(status(page, "Checkpoint status")).to_have_text(f'Checkpoint "{name}" saved.', timeout=UI_MS)
        expect(ledger_rows(page).first).to_contain_text(name)
    assert [c["name"] for c in mentor.get(f"/api/projects/{pid}/checkpoints").json()["checkpoints"]] == [name]


PANEL_SIZES = {
    "375x812": (375, 812),
    "767": (767, 812),
    "768x1024": (768, 1024),
    "1279": (1279, 800),
    "1280x800": (1280, 800),
}
CLOSED_CONTROLS = [("complementary", "Checkpoint ledger"), ("textbox", "Checkpoint name"),
                   ("button", "Save checkpoint"), ("button", "Open Minute 40"), ("button", "Restore Minute 40")]


def ledger_closed(page: Page) -> None:
    for role, name in CLOSED_CONTROLS:
        expect(page.get_by_role(role, name=name, exact=True)).to_have_count(0)
    names = full_tab_order(page)
    assert "Ledger" in names
    assert not {n for _, n in CLOSED_CONTROLS} & set(names), names


@pytest.mark.parametrize("size", list(PANEL_SIZES), ids=list(PANEL_SIZES))
def test_wf_checkpoints_panels(browser: Browser, app_url: str, mail: Mailpit, size: str) -> None:
    width, height = PANEL_SIZES[size]
    mentor = new_mentor(mail, app_url)
    pid = sample_project(mentor)["id"]
    with ui(browser, mentor, f"/projects/{pid}", (width, height)) as page:
        expect(page.get_by_role("heading", level=1)).to_have_text("Sample session", timeout=UI_MS)
        layout(page)
        ledger = btn(page, "Ledger")
        rail, editor = page.get_by_role("complementary", name="Presence"), code_editor(page)
        panel = page.get_by_role("complementary", name="Checkpoint ledger")
        if width >= WIDE_MIN:
            expect(ledger).to_have_attribute("aria-expanded", "true")
            expect(btn(page, "Show files")).to_have_count(0)
            expect(page.get_by_role("tree", name="Files")).to_be_visible()
            rb, eb, lb = box(rail), box(editor), box(panel)
            assert rb["x"] + rb["width"] <= eb["x"] + 1 and eb["x"] + eb["width"] <= lb["x"] + 1
            assert lb["x"] + lb["width"] <= width + 1
            narrow = eb["width"]
            ledger.click()
            expect(ledger).to_have_attribute("aria-expanded", "false")
            ledger_closed(page)
            assert box(editor)["width"] > narrow
            ledger.click()
            expect(ledger).to_have_attribute("aria-expanded", "true")
            expect(panel).to_be_visible()
        else:
            expect(ledger).to_have_attribute("aria-expanded", "false")
            ledger_closed(page)
            expect(page.get_by_role("tree", name="Files")).to_have_count(0)
            rb, eb = box(rail), box(editor)
            if width >= MID_MIN:
                assert rb["x"] + rb["width"] <= eb["x"] + 1
            else:
                assert rb["y"] + rb["height"] <= eb["y"] + 1
                tops = [box(participant(page, n))["y"] for n in (mentor.name, "Robin Vale")]
                assert abs(tops[0] - tops[1]) < 2
            ledger.click()
            expect(ledger).to_have_attribute("aria-expanded", "true")
            expect(panel).to_be_visible()
            expect(page.get_by_role("button", name="Save checkpoint")).to_be_in_viewport()
            lb = box(panel)
            if width >= MID_MIN:
                assert lb["x"] + lb["width"] >= width - 2 and lb["x"] > eb["x"]
            else:
                assert lb["y"] + lb["height"] >= height - 2
            ledger.click()
            expect(ledger).to_have_attribute("aria-expanded", "false")
            ledger_closed(page)
            btn(page, "Show files").click()
            expect(page.get_by_role("tree", name="Files")).to_be_visible()
        layout(page)


def test_restore_byte_exact_and_damage(app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = new_project(mentor, "one_to_one")["id"]
    a = add_file(mentor, pid, "src/a.js", "A1\n")
    b = add_file(mentor, pid, "src/b.js", "B1\n")
    cp = make_checkpoint(mentor, pid)
    a2 = save_ok(mentor, pid, a, "A2\n")
    assert mentor.delete(f"/api/projects/{pid}/files/{b['id']}").status_code == 204
    add_file(mentor, pid, "src/d.js", "D\n")
    r = restore(mentor, cp["id"])
    assert r.status_code == 200 and r.json()["restore"]["state"] == "applied", r.text
    now = file_map(mentor, pid)
    assert {p: (f["id"], f["sha256"]) for p, f in now.items()} == {
        "src/a.js": (a["id"], sha("A1\n")), "src/b.js": (b["id"], sha("B1\n"))}
    assert now["src/a.js"]["revision"] == a2["revision"] + 1
    assert read_file(mentor, pid, b["id"]) == "B1\n"
    e_bytes = f"{label('damage')}\n".encode()
    e = add_file(mentor, pid, "src/e.js", e_bytes.decode())
    cp2 = make_checkpoint(mentor, pid)
    token = token_of(create_link(mentor, cp2["id"], 1).json()["link"])
    assert s3_call("PUT", blob_key(pid, e_bytes), GARBAGE).status_code == 200
    before, events = file_map(mentor, pid), len(audit_of(mentor, pid))
    for resp in (mentor.get(f"/api/checkpoints/{cp2['id']}/files/{e['id']}"), restore(mentor, cp2["id"]),
                 httpx.get(f"{app_url}/api/review/{token}")):
        assert expect_error(resp, 409, "checkpoint_damaged")["paths"] == ["src/e.js"]
    assert file_map(mentor, pid) == before
    assert len(audit_of(mentor, pid)) == events


def test_undo_restore(app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = new_project(mentor, "one_to_one")["id"]
    a = add_file(mentor, pid, "src/a.js", "A1\n")
    add_file(mentor, pid, "src/b.js", "B1\n")
    cp = make_checkpoint(mentor, pid)
    save_ok(mentor, pid, a, "A2\n")
    add_file(mentor, pid, "src/c.js", "C\n")

    def snapshot() -> dict[str, tuple[str, str]]:
        return {p: (f["id"], f["sha256"]) for p, f in file_map(mentor, pid).items()}

    def restored() -> str:
        r = restore(mentor, cp["id"])
        assert r.status_code == 200, r.text
        return r.json()["restore"]["id"]
    before = snapshot()
    rid = restored()
    r = undo(mentor, rid)
    assert r.status_code == 200 and r.json()["restore"]["state"] == "undone"
    assert snapshot() == before
    expect_error(undo(mentor, rid), 409, "restore_already_undone")
    rid = restored()
    save_ok(mentor, pid, file_map(mentor, pid)["src/a.js"], "A3\n")
    after_write = snapshot()
    expect_error(undo(mentor, rid), 409, "restore_superseded")
    assert snapshot() == after_write
    first = restored()
    restored()
    expect_error(undo(mentor, first), 409, "restore_superseded")
    rid = restored()
    assert mentor.patch(f"/api/projects/{pid}/files/{a['id']}", {"path": "src/a2.js"}).status_code == 200
    expect_error(undo(mentor, rid), 409, "restore_superseded")
    restored()
    pre = snapshot()
    rid = restored()
    make_checkpoint(mentor, pid)
    assert undo(mentor, rid).status_code == 200 and snapshot() == pre
    rid = restored()
    plan = upload(mentor, pid, make_zip([("src/a.js", b"zip version\n"), ("src/b.js", b"B1\n")])).json()["import"]
    assert apply(mentor, plan["id"], {"src/a.js": "keep"}).status_code == 200
    assert undo(mentor, rid).status_code == 200


def test_wf_restore_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1, "one_to_one")
    pid = project["id"]
    tip = add_file(mentor, pid, "src/tip.js", SEED_FILES["src/tip.js"])
    add_file(mentor, pid, "README.md", SEED_FILES["README.md"])
    cp = make_checkpoint(a, pid, "Minute 40")
    newer = f"{label('newer')}\n"
    save_ok(a, pid, tip, newer)
    before = {p: (f["id"], f["sha256"]) for p, f in file_map(a, pid).items()}
    with ui(browser, a, f"/projects/{pid}") as page:
        open_file(page, "src/tip.js")
        editor_contains(page, newer.strip())
        btn(page, "Restore Minute 40").click()
        region = status(page, "Restore status")
        expect(region).to_contain_text(f'Restored "{MINUTE_40}".', timeout=UI_MS)
        undo_button = region.get_by_role("button", name="Undo restore")
        expect(undo_button).to_be_visible()
        editor_contains(page, TIP_LINE)
        files = file_map(a, pid)
        assert {x["path"]: x["sha256"] for x in checkpoint_of(a, cp["id"])["files"]} == {p: f["sha256"] for p, f in files.items()}
        undo_button.click()
        expect(region).to_contain_text("Restore undone.", timeout=UI_MS)
        editor_contains(page, newer.strip())
    assert {p: (f["id"], f["sha256"]) for p, f in file_map(a, pid).items()} == before


def test_wf_restore_superseded(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1, "one_to_one")
    pid = project["id"]
    tip = add_file(mentor, pid, "src/tip.js", SEED_FILES["src/tip.js"])
    readme = add_file(mentor, pid, "README.md", SEED_FILES["README.md"])
    make_checkpoint(a, pid, "Minute 40")
    save_ok(a, pid, tip, f"{label('newer')}\n")
    with ui(browser, a, f"/projects/{pid}") as page:
        btn(page, "Restore Minute 40").click()
        region = status(page, "Restore status")
        undo_button = region.get_by_role("button", name="Undo restore")
        expect(undo_button).to_be_visible(timeout=UI_MS)
        with held(page, "**/undo") as hold:
            undo_button.click()
            expect(region).to_contain_text("Undoing restore…", timeout=UI_MS)
            edit = save_ok(mentor, pid, file_map(mentor, pid)["README.md"], "# mentor edit\n")
            hold.release()
        expect(region).to_contain_text("This restore can't be undone because files changed after it.", timeout=UI_MS)
    assert file_map(mentor, pid)["README.md"]["sha256"] == edit["sha256"] and edit["id"] == readme["id"]


ZIP_CASES = ["path_traversal", "absolute_path", "path_too_long", "symlink", "disallowed_type", "content_mismatch",
             "unsafe_svg", "duplicate_path", "file_too_large", "total_too_large", "too_many_entries",
             "ratio_exceeded", "not_a_zip"]


def rejected_zip(reason: str, good: str) -> tuple[bytes, list[tuple[set[str], str, int | None]], list[str]]:
    ok = (good, b"fine\n")
    svg = b'<svg xmlns="http://www.w3.org/2000/svg">'
    if reason == "not_a_zip":
        return b"this is not a zip archive\n", [({""}, "not_a_zip", None)], []
    if reason == "too_many_entries":
        return make_zip([ok] + [(f"many/f-{i}.txt", b"x") for i in range(ZIP_ENTRIES)]), [({""}, reason, ZIP_ENTRIES)], []
    if reason == "total_too_large":
        count = ZIP_TOTAL_MAX // PART_BYTES + 1
        parts = [(f"part-{i:02d}.txt", ab_text(PART_BYTES)) for i in range(1, count + 1)]
        return make_zip([ok] + parts), [({parts[-1][0]}, reason, ZIP_TOTAL_MAX)], [good]
    over, edge = "p" * (PATH_MAX - 3) + ".txt", "q" * (PATH_MAX - 4) + ".txt"
    table: dict[str, tuple[list[tuple[Any, ...]], list[tuple[set[str], str, int | None]], list[str]]] = {
        "path_traversal": ([("../escape.txt", b"x"), ("src/../../up.txt", b"x")],
                           [({"../escape.txt"}, reason, None), ({"src/../../up.txt"}, reason, None)], []),
        "absolute_path": ([("/abs.txt", b"x"), ("C:/abs.txt", b"x")],
                          [({"/abs.txt"}, reason, None), ({"C:/abs.txt"}, reason, None)], []),
        "path_too_long": ([(over, b"x"), (edge, b"x")], [({over}, reason, None)], [edge]),
        "symlink": ([("link.txt", b"ok.txt", (stat.S_IFLNK | 0o777) << 16)], [({"link.txt"}, reason, None)], []),
        "disallowed_type": ([("tool.exe", b"MZ")], [({"tool.exe"}, reason, None)], []),
        "content_mismatch": ([("nul.txt", b"a\x00b"), ("latin.txt", b"\xff\xfe\xfd")],
                             [({"nul.txt"}, reason, None), ({"latin.txt"}, reason, None)], []),
        "unsafe_svg": ([("script.svg", svg + b"<script>alert(1)</script></svg>"),
                        ("handler.svg", b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')],
                       [({"script.svg"}, reason, None), ({"handler.svg"}, reason, None)], []),
        "duplicate_path": ([("dup.txt", b"1"), ("./dup.txt", b"2")], [({"dup.txt", "./dup.txt"}, reason, None)], []),
        "file_too_large": ([("big.txt", ab_text(ZIP_FILE_MAX + 1)), ("edge.txt", ab_text(ZIP_FILE_MAX))],
                           [({"big.txt"}, reason, ZIP_FILE_MAX)], ["edge.txt"]),
        "ratio_exceeded": ([("bomb.txt", b"a" * (RATIO_FLOOR * RATIO_MAX))], [({"bomb.txt"}, reason, RATIO_MAX)], []),
    }
    entries, expected, clean = table[reason]
    return make_zip([ok] + entries), expected, clean + [good]


@pytest.mark.parametrize("reason", ZIP_CASES, ids=ZIP_CASES)
def test_zip_rejected(app_url: str, mail: Mailpit, reason: str) -> None:
    mentor = new_mentor(mail, app_url)
    pid = new_project(mentor, "one_to_one")["id"]
    add_file(mentor, pid, "README.md", "keep\n")
    before = file_map(mentor, pid)
    good = f"ok-{uuid.uuid4().hex[:8]}.txt"
    payload, expected, clean = rejected_zip(reason, good)
    entries = expect_error(upload(mentor, pid, payload), 422, "import_rejected")["entries"]
    for paths, why, limit in expected:
        hits = [e for e in entries if e["path"] in paths and e["reason"] == why]
        assert hits, (paths, why, entries[:5])
        if limit is not None:
            assert hits[0]["limit"] == limit
    assert not [e for e in entries if e["path"] in clean]
    assert file_map(mentor, pid) == before


def test_import_plan(app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = new_project(mentor, "one_to_one")["id"]
    cafe = unicodedata.normalize("NFC", "notes/café.md")
    a = add_file(mentor, pid, "src/a.js", "A\n")
    b = add_file(mentor, pid, "src/b.js", "B\n")
    add_file(mentor, pid, "keep.md", "K\n")
    c = add_file(mentor, pid, cafe, "C\n")
    before = file_map(mentor, pid)
    payload = make_zip([("src/", b""), ("./src/a.js", b"A\n"), ("src//b.js", b"B2\n"), ("src\\c.js", b"new\n"),
                        (unicodedata.normalize("NFD", cafe), b"C\n"), ("__MACOSX/src/._a.js", b"junk"), ("src/.DS_Store", b"junk")])
    r = upload(mentor, pid, payload)
    assert r.status_code == 201, r.text
    plan = r.json()["import"]
    assert plan["state"] == "planned"
    got = {normalise(e["path"]): (e["status"], e["file_id"]) for e in plan["entries"]}
    assert got == {"src/a.js": ("unchanged", a["id"]), "src/b.js": ("changed", b["id"]),
                   "src/c.js": ("new", None), cafe: ("unchanged", c["id"])}
    assert plan["only_in_project"] == ["keep.md"]
    assert {"__MACOSX/src/._a.js", "src/.DS_Store"} <= {normalise(p) for p in plan["ignored"]}
    assert near(parse_iso(plan["expires_at"]), server_now(r) + dt.timedelta(seconds=PLAN_TTL_S))
    assert file_map(mentor, pid) == before
    key = f"quarantine/{plan['id']}.zip"
    assert key in S3().keys("quarantine/") and S3().get(key) == payload
    expect_error(upload(mentor, pid, payload, "application/json"), 415, "unsupported_media_type")
    assert expect_error(upload(mentor, pid, b"0" * (ZIP_LIMIT + 1)), 413, "too_large")["limit_bytes"] == ZIP_LIMIT


def test_import_plan_expiry_sweep(mail: Mailpit) -> None:
    base = env_url("APP_SHORT_URL")
    store = S3("-short")
    mentor = new_mentor(mail, base)
    pid = new_project(mentor, "one_to_one")["id"]
    add_file(mentor, pid, "a.txt", "a\n")
    before = file_map(mentor, pid)
    r = upload(mentor, pid, make_zip([("b.txt", b"b\n")]))
    assert r.status_code == 201, r.text
    plan = r.json()["import"]
    key = f"quarantine/{plan['id']}.zip"
    assert key in store.keys("quarantine/")
    left = (parse_iso(plan["expires_at"]) - server_now(r)).total_seconds()
    poll(lambda: key not in store.keys("quarantine/"), left + SWEEP_S + SWEEP_SLACK_S, "quarantine sweep")
    assert file_map(mentor, pid) == before


def test_import_apply_expired_order(mail: Mailpit) -> None:
    base = env_url("APP_SHORT_URL")
    store = S3("-short")
    mentor = new_mentor(mail, base)
    pid = new_project(mentor, "one_to_one")["id"]
    add_file(mentor, pid, "a.txt", "a\n")
    r = upload(mentor, pid, make_zip([(EXPIRED_PATH, b"b\n")]))
    assert r.status_code == 201, r.text
    plan = r.json()["import"]
    key = f"quarantine/{plan['id']}.zip"
    poll(lambda: key not in store.keys("quarantine/"), EXPIRY_WAIT_S, "plan expiry")
    body = expect_error(apply(mentor, plan["id"], {}), 410, "import_plan_expired")
    assert body["expires_at"] == plan["expires_at"]
    assert EXPIRED_PATH not in file_map(mentor, pid)
    other = new_project(mentor, "one_to_one")["id"]
    done = upload(mentor, other, make_zip([("c.txt", b"c\n")])).json()["import"]
    assert apply(mentor, done["id"], {}).status_code == 200
    later = upload(mentor, other, make_zip([("d.txt", b"d\n")]))
    later_key = f"quarantine/{later.json()['import']['id']}.zip"
    poll(lambda: later_key not in store.keys("quarantine/"), EXPIRY_WAIT_S, "second sweep")
    expect_error(apply(mentor, done["id"], {}), 409, "import_already_applied")


def test_import_apply(app_url: str, mail: Mailpit) -> None:
    mentor, project, (student,) = group(mail, app_url, 1, "one_to_one")
    pid = project["id"]
    a = add_file(mentor, pid, "a.js", "A\n")
    b = add_file(mentor, pid, "b.js", "B\n")
    add_file(mentor, pid, "c.js", "C\n")
    payload = make_zip([("a.js", b"A2\n"), ("b.js", b"B2\n"), ("c.js", b"C\n"), ("d.js", b"D\n")])
    expect_error(upload(student, pid, payload), 403, "forbidden")
    plan = upload(mentor, pid, payload).json()["import"]
    expect_error(student.post(f"/api/imports/{plan['id']}/apply", {"decisions": {"a.js": "keep", "b.js": "keep"}}), 403, "forbidden")
    for decisions in ({"a.js": "replace"}, {"a.js": "replace", "b.js": "keep", "c.js": "keep"}):
        assert "decisions" in expect_error(apply(mentor, plan["id"], decisions), 422, "validation")["fields"]
    r = apply(mentor, plan["id"], {"a.js": "replace", "b.js": "keep"})
    assert r.status_code == 200, r.text
    done = r.json()["import"]
    assert (done["state"], done["added"], done["replaced"], done["kept"], done["unchanged"]) == ("applied", 1, 1, 1, 1)
    files = file_map(mentor, pid)
    assert sorted(files) == ["a.js", "b.js", "c.js", "d.js"]
    assert files["a.js"]["id"] == a["id"] and files["a.js"]["revision"] == a["revision"] + 1
    assert read_file(mentor, pid, a["id"]) == "A2\n" and files["b.js"]["sha256"] == b["sha256"]
    poll(lambda: f"quarantine/{plan['id']}.zip" not in S3().keys("quarantine/"), SWEEP_S, "quarantine deleted on apply")
    expect_error(apply(mentor, plan["id"], {"a.js": "replace", "b.js": "keep"}), 409, "import_already_applied")
    old = upload(mentor, pid, make_zip([("e.js", b"E\n")])).json()["import"]
    newer = upload(mentor, pid, make_zip([("e.js", b"E\n")])).json()["import"]
    expect_error(apply(mentor, old["id"], {}), 409, "import_plan_stale")
    poll(lambda: f"quarantine/{old['id']}.zip" not in S3().keys("quarantine/"), SWEEP_S, "quarantine deleted on supersede")
    add_file(mentor, pid, "e.js", "taken\n")
    expect_error(apply(mentor, newer["id"], {}), 409, "import_plan_stale")
    changed = upload(mentor, pid, make_zip([("b.js", b"B3\n")])).json()["import"]
    save_ok(mentor, pid, file_map(mentor, pid)["b.js"], "B4\n")
    expect_error(apply(mentor, changed["id"], {"b.js": "replace"}), 409, "import_plan_stale")
    pending = upload(mentor, pid, make_zip([("f.js", b"F\n")])).json()["import"]
    live = go_live(mentor, pid)
    expect_error(apply(mentor, pending["id"], {}), 409, "session_in_progress")
    expect_error(apply(mentor, plan["id"], {"a.js": "replace", "b.js": "keep"}), 409, "session_in_progress")
    assert act(mentor, live["id"], "end").status_code == 200
    current = file_map(mentor, pid)
    same = make_zip([(p, read_file(mentor, pid, f["id"]).encode()) for p, f in current.items()])
    again = upload(mentor, pid, same).json()["import"]
    assert {e["status"] for e in again["entries"]} == {"unchanged"}
    r = apply(mentor, again["id"], {})
    assert r.status_code == 200 and (r.json()["import"]["added"], r.json()["import"]["replaced"]) == (0, 0)
    assert file_map(mentor, pid) == current


def homework(mail: Mailpit, base: str) -> tuple[Api, Api, str, bytes]:
    mentor, project, (a,) = group(mail, base, 1, "one_to_one")
    pid = project["id"]
    tip = add_file(mentor, pid, "src/tip.js", STARTER_TIP)
    add_file(mentor, pid, "README.md", SEED_FILES["README.md"])
    add_file(mentor, pid, "index.html", SEED_FILES["index.html"])
    save_ok(a, pid, tip, SEED_FILES["src/tip.js"])
    payload = make_zip([("src/tip.js", b"zip tip\n"), ("README.md", HOMEWORK_README.encode()), (EXTRA_PATH, b"extra\n")])
    return mentor, a, pid, payload


def check_zip(page: Page, payload: bytes) -> None:
    btn(page, "Import zip").click()
    page.get_by_label("Starter zip").set_input_files(files=[{"name": "homework.zip", "mimeType": "application/zip", "buffer": payload}])
    btn(page, "Check zip").click()


def test_wf_import_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, a, pid, payload = homework(mail, app_url)
    with ui(browser, mentor, f"/projects/{pid}") as page:
        check_zip(page, payload)
        expect(status(page, "Import status", True)).to_contain_text(planned_copy(1, 2, 0, 1), timeout=UI_MS)
        review = page.get_by_role("dialog", name="Review import")
        for path in ("src/tip.js", "README.md"):
            expect(review.get_by_role("radiogroup", name=path).get_by_role("radio", name="Keep student's")).to_be_checked()
        review.get_by_role("radiogroup", name="README.md").get_by_role("radio", name="Replace with zip").check()
        btn(review, "Apply import").click()
        expect(status(page, "Import status", True)).to_contain_text(applied_copy(1, 1, 1), timeout=UI_MS)
        expect(review).to_be_hidden(timeout=UI_MS)
        open_file(page, EXTRA_PATH)
    files = file_map(mentor, pid)
    assert sorted(files) == sorted({"src/tip.js", "README.md", "index.html", EXTRA_PATH})
    assert read_file(mentor, pid, files["src/tip.js"]["id"]) == SEED_FILES["src/tip.js"]
    assert read_file(mentor, pid, files["README.md"]["id"]) == HOMEWORK_README


def test_wf_import_rejected(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, a, pid, _ = homework(mail, app_url)
    before = file_map(mentor, pid)
    with ui(browser, mentor, f"/projects/{pid}") as page:
        check_zip(page, make_zip([(ESCAPE_PATH, b"x\n")]))
        region = status(page, "Import status", True)
        expect(region).to_contain_text(rejected_copy(1), timeout=UI_MS)
        expect(region).to_contain_text(f"{ESCAPE_PATH} — {TRAVERSAL_TEXT}")
    assert file_map(mentor, pid) == before


def test_wf_import_expired(browser: Browser, mail: Mailpit) -> None:
    base = env_url("APP_SHORT_URL")
    mentor, a, pid, payload = homework(mail, base)
    before = file_map(mentor, pid)
    with ui(browser, mentor, f"/projects/{pid}") as page:
        with page.expect_response(lambda resp: resp.url.endswith(f"/api/projects/{pid}/imports"), timeout=UI_MS) as info:
            check_zip(page, payload)
        key = f"quarantine/{info.value.json()['import']['id']}.zip"
        review = page.get_by_role("dialog", name="Review import")
        expect(review).to_be_visible(timeout=UI_MS)
        poll(lambda: key not in S3("-short").keys("quarantine/"), EXPIRY_WAIT_S, "plan expiry sweep")
        expect(btn(review, "Apply import")).to_be_enabled()
        btn(review, "Apply import").click()
        expect(status(page, "Import status", True)).to_contain_text("This zip check has expired. Upload it again.", timeout=UI_MS)
    assert file_map(mentor, pid) == before


def test_wf_import_clock_ahead(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, a, pid, payload = homework(mail, app_url)
    with clocked(browser, mentor) as page:
        page.clock.set_system_time(FUTURE_DEVICE_TIME)
        page.goto(f"{mentor.base}/projects/{pid}")
        check_zip(page, payload)
        review = page.get_by_role("dialog", name="Review import")
        expect(review).to_be_visible(timeout=UI_MS)
        page.clock.fast_forward(PLAN_TTL_S * 1000)
        expect(btn(review, "Apply import")).to_be_enabled()
        btn(review, "Apply import").click()
        expect(status(page, "Import status", True)).to_contain_text(applied_copy(1, 0, 2), timeout=UI_MS)
    assert EXTRA_PATH in file_map(mentor, pid)


def test_rename_and_delete(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    x = add_file(mentor, pid, "src/x.js", "x\n")
    y = add_file(mentor, pid, "src/y.js", "y\n")
    z = add_file(mentor, pid, TOP_PATH, "z\n")
    cp = make_checkpoint(mentor, pid)
    sock = Sock(browser, a, pid)
    try:
        expect_error(a.patch(f"/api/projects/{pid}/files/{x['id']}", {"path": "src/x2.js"}), 403, "forbidden")
        assert expect_error(mentor.patch(f"/api/projects/{pid}/files/{x['id']}", {"path": TOP_PATH}), 409, "path_taken")["path"] == TOP_PATH
        assert "from" in expect_error(mentor.post(f"/api/projects/{pid}/folders/rename", {"from": "nothing", "to": "else"}), 422, "validation")["fields"]
        moved = mentor.post(f"/api/projects/{pid}/folders/rename", {"from": "src", "to": "lib"})
        assert moved.status_code == 200, moved.text
        assert {f["id"]: (f["path"], f["revision"]) for f in moved.json()["files"]} == {
            x["id"]: ("lib/x.js", x["revision"]), y["id"]: ("lib/y.js", y["revision"])}
        sock.wait("file", {"file.id": x["id"], "file.path": "lib/x.js"}, LIVE_MS)
        sock.wait("file", {"file.id": y["id"], "file.path": "lib/y.js"}, LIVE_MS)
        r = mentor.patch(f"/api/projects/{pid}/files/{z['id']}", {"path": f"docs/{TOP_PATH}"})
        assert r.status_code == 200 and (r.json()["file"]["id"], r.json()["file"]["revision"]) == (z["id"], z["revision"])
        saved = save_ok(a, pid, x, "x2\n")
        assert (saved["id"], saved["path"], saved["revision"]) == (x["id"], "lib/x.js", x["revision"] + 1)
        assert mentor.delete(f"/api/projects/{pid}/files/{y['id']}").status_code == 204
        sock.wait("file_deleted", {"file_id": y["id"]}, LIVE_MS)
    finally:
        sock.close()
    rows = {f["file_id"]: (f["path"], f["current_path"]) for f in checkpoint_of(mentor, cp["id"])["files"]}
    assert rows == {x["id"]: ("src/x.js", "lib/x.js"), y["id"]: ("src/y.js", None), z["id"]: (TOP_PATH, f"docs/{TOP_PATH}")}


def test_wf_rename_live(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    tip = add_file(mentor, pid, "src/tip.js", STARTER_TIP)
    add_file(mentor, pid, "README.md", SEED_FILES["README.md"])
    make_checkpoint(mentor, pid, "Starter")
    go_live(mentor, pid)
    typed = label("minute 41")
    with clocked(browser, mentor) as pm, ui(browser, a, f"/projects/{pid}") as pa:
        pm.goto(f"{mentor.base}/projects/{pid}")
        open_file(pm, "src/tip.js")
        code_editor(pm).click()
        advance(pm, LIVE_MS)
        btn(pa, f"Follow {mentor.name}").click()
        expect(pa.get_by_role("tab", name="src/tip.js", exact=True)).to_be_visible(timeout=UI_MS)
        btn(pa, f"Open {STARTER}").click()
        dialog = pa.get_by_role("dialog", name=f"Checkpoint {STARTER}")
        expect(dialog).to_contain_text("src/tip.js", timeout=UI_MS)
        pm.keyboard.press("Control+End")
        pm.keyboard.type("\n" + typed)
        assert mentor.post(f"/api/projects/{pid}/folders/rename", {"from": "src", "to": "lib"}).status_code == 200
        expect(pa.get_by_role("tab", name="lib/tip.js", exact=True, include_hidden=True)).to_be_visible(timeout=LIVE_MS)
        expect(status(pa, "Editor status", True)).to_contain_text(f"Following {mentor.name} · lib/tip.js", timeout=LIVE_MS)
        expect(dialog).to_contain_text("now lib/tip.js", timeout=LIVE_MS)
        expect(dialog).to_contain_text("src/tip.js")
        expect(pm.get_by_role("tab", name="lib/tip.js", exact=True)).to_be_visible(timeout=LIVE_MS)
        advance(pm, DEBOUNCE_MS + LIVE_MS)
        poll(lambda: typed in read_file(mentor, pid, tip["id"]), UI_MS / 1000, "typed line saved")
        expect(status(pm, "Editor status")).not_to_contain_text("A newer version of")
    now = file_map(mentor, pid)["lib/tip.js"]
    assert (now["id"], now["revision"]) == (tip["id"], tip["revision"] + 1)


def test_wf_rename_delete(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (a,) = group(mail, app_url, 1)
    pid = project["id"]
    old = add_file(mentor, pid, OLD_PATH, "old\n")
    cp = make_checkpoint(mentor, pid, "Starter")
    with ui(browser, mentor, f"/projects/{pid}") as pm, ui(browser, a, f"/projects/{pid}") as pa:
        open_file(pa, OLD_PATH)
        btn(pa, f"Open {STARTER}").click()
        dialog = pa.get_by_role("dialog", name=f"Checkpoint {STARTER}")
        expect(dialog).to_contain_text(OLD_PATH, timeout=UI_MS)
        open_file(pm, OLD_PATH)
        btn(pm, "Delete file").click()
        confirm = pm.get_by_role("alertdialog", name=f"Delete {OLD_PATH}?")
        expect(btn(confirm, "Cancel")).to_be_focused()
        btn(confirm, "Delete").click()
        expect(dialog).to_contain_text("deleted since", timeout=LIVE_MS)
        expect(pa.get_by_role("tab", name=OLD_PATH, exact=True, include_hidden=True)).to_have_count(0, timeout=LIVE_MS)
    assert OLD_PATH not in file_map(mentor, pid)
    row = next(f for f in checkpoint_of(mentor, cp["id"])["files"] if f["file_id"] == old["id"])
    assert (row["path"], row["current_path"]) == (OLD_PATH, None)


def test_reviewer_link_create(app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = sample_project(mentor)["id"]
    cid = sample_checkpoints(mentor, pid)["Minute 40"]["id"]
    for hours in (0, LINK_HOURS_MAX + 1, 1.5):
        expect_error(create_link(mentor, cid, hours), 422, "validation")
    expect_error(mentor.post(f"/api/checkpoints/{cid}/reviewer-links", {"expires_in_hours": 1}), 422, "validation")
    made = []
    for hours in (1, LINK_HOURS_MAX):
        r = create_link(mentor, cid, hours)
        assert r.status_code == 201, r.text
        link = r.json()["link"]
        assert link["email_status"] == "none" and link["state"] == "active"
        assert near(parse_iso(link["expires_at"]), server_now(r) + dt.timedelta(seconds=hours * HOUR_S))
        made.append(token_of(link))
    guest, _ = person("guest")
    key = idempotency_key()
    r = create_link(mentor, cid, LINK_HOURS_DEFAULT, guest, key)
    assert r.status_code == 201, r.text
    link = r.json()["link"]
    token = token_of(link)
    assert re.fullmatch(rf"[A-Za-z0-9_-]{{{TOKEN_CHARS}}}", token) and token not in made
    assert link["url"].startswith("http") and link["url"].endswith(f"/review/{token}")
    assert (link["checkpoint_id"], link["state"], link["email_status"]) == (cid, "active", "sent")
    expires = parse_iso(link["expires_at"])
    assert near(expires, server_now(r) + dt.timedelta(seconds=LINK_HOURS_DEFAULT * HOUR_S))
    message = await_inbox(mail, guest, 1)
    assert len(message) == 1
    assert message[0]["Subject"] == REVIEW_SUBJECT + "Minute 40"
    body = text(message[0])
    assert link["url"] in body and f"{stamp(expires.astimezone(dt.timezone.utc))} UTC" in body
    for private in (mentor.email, mentor.name, mentor.user["id"], SAMPLE_TITLE, "Robin Vale", "Starter", pid, cid):
        assert private not in body + message[0]["Subject"], private
    replay = create_link(mentor, cid, LINK_HOURS_DEFAULT, guest, key)
    assert replay.status_code == 201 and replay.json() == r.json()
    expect_error(create_link(mentor, cid, LINK_HOURS_DEFAULT + 1, guest, key), 409, "idempotency_conflict")
    assert len(inbox(mail, guest)) == 1
    other, team, (student,) = group(mail, app_url, 1)
    add_file(other, team["id"], DRIVE_PATH, DRIVE_TEXT)
    cp = make_checkpoint(other, team["id"])
    expect_error(create_link(student, cp["id"], 1), 403, "forbidden")
    expect_error(student.get(f"/api/checkpoints/{cp['id']}/reviewer-links"), 403, "forbidden")
    down = new_mentor(mail, env_url("APP_MINIO_DOWN_URL"))
    pending = down.post(f"/api/projects/{sample_project(down)['id']}/checkpoints", {"name": label("Pending")})
    assert pending.status_code == 202
    body = expect_error(create_link(down, pending.json()["checkpoint"]["id"], 1), 409, "checkpoint_not_saved")
    assert body["state"] == "pending_upload"


def test_reviewer_link_lifecycle_and_privacy(app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = sample_project(mentor)["id"]
    cps = sample_checkpoints(mentor, pid)
    cid = cps["Minute 40"]["id"]
    link = create_link(mentor, cid, LINK_HOURS_DEFAULT).json()["link"]
    token = token_of(link)
    r = httpx.get(f"{app_url}/api/review/{token}")
    assert r.status_code == 200, r.text
    private_headers(r)
    shown = r.json()["checkpoint"]
    assert set(shown) <= {"name", "saved_at", "expires_at", "files"} and shown["name"] == "Minute 40"
    assert shown["saved_at"] and shown["expires_at"] == link["expires_at"]
    assert {f["path"]: f["content"] for f in shown["files"]} == SEED_FILES
    assert all(set(f) <= {"path", "content"} for f in shown["files"])
    file_ids = [f["file_id"] for f in checkpoint_of(mentor, cid)["files"]]
    secrets = [mentor.email, mentor.name, mentor.user["id"], SAMPLE_TITLE, "Robin Vale", "Starter", pid, cid, cps["Starter"]["id"], *file_ids]
    page = mentor.get(f"/review/{token}")
    private_headers(page)
    for body in (r.text, page.text):
        for value in secrets:
            assert value not in body, value
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for t in (token, JUNK_TOKEN):
            denied = httpx.request(method, f"{app_url}/api/review/{t}", json={})
            expect_error(denied, 405, "method_not_allowed")
            private_headers(denied)
    assert httpx.get(f"{app_url}/api/review/{token}").json() == r.json()
    missing = httpx.get(f"{app_url}/api/review/{JUNK_TOKEN}")
    expect_error(missing, 404, "link_not_found")
    private_headers(missing)
    private_headers(httpx.get(f"{app_url}/review/{JUNK_TOKEN}"))
    fresh = mentor.post(f"/api/reviewer-links/{link['id']}/regenerate")
    assert fresh.status_code == 200, fresh.text
    renewed = fresh.json()["link"]
    assert token_of(renewed) != token and renewed["expires_at"] == link["expires_at"]
    expect_error(httpx.get(f"{app_url}/api/review/{token}"), 404, "link_not_found")
    assert httpx.get(f"{app_url}/api/review/{token_of(renewed)}").status_code == 200
    revoked = mentor.post(f"/api/reviewer-links/{link['id']}/revoke")
    assert revoked.status_code == 200 and revoked.json()["link"]["state"] == "revoked"
    gone = httpx.get(f"{app_url}/api/review/{token_of(renewed)}")
    expect_error(gone, 410, "link_revoked")
    private_headers(gone)
    expect_error(mentor.post(f"/api/reviewer-links/{link['id']}/revoke"), 409, "illegal_transition")
    expect_error(mentor.post(f"/api/reviewer-links/{link['id']}/regenerate"), 409, "illegal_transition")


def share_dialog(page: Page, checkpoint: str) -> Locator:
    btn(page, f"Share {checkpoint}").click()
    dialog = page.get_by_role("dialog", name="Share with a reviewer")
    expect(dialog).to_be_visible(timeout=UI_MS)
    return dialog


def test_wf_reviewer_links_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = sample_project(mentor)["id"]
    sample_checkpoints(mentor, pid)
    guest, _ = person("parent")
    second, _ = person("peer")
    with clocked(browser, mentor) as page:
        page.goto(f"{mentor.base}/projects/{pid}")
        dialog = share_dialog(page, "Minute 40")
        hours = dialog.get_by_role("spinbutton", name="Expires in hours")
        expect(hours).to_have_value(str(LINK_HOURS_DEFAULT))
        address = dialog.get_by_role("textbox", name="Reviewer email (optional)")
        address.fill(guest)
        btn(dialog, "Create link").click()
        region = status(page, "Share status", True)
        expect(region).to_contain_text(re.compile(r"Reviewer link created\. It expires \d{1,2} \w{3} \d{4}, \d{2}:\d{2}\."), timeout=UI_MS)
        expect(region).to_contain_text("Email sent")
        copy = region.text_content() or ""
        link_box = dialog.get_by_role("textbox", name="Reviewer link")
        expect(link_box).to_have_value(re.compile(rf"/review/[A-Za-z0-9_-]{{{TOKEN_CHARS}}}$"))
        url = link_box.input_value()
        rows = dialog.get_by_role("list", name="Reviewer links").get_by_role("listitem")
        expect(rows.filter(has_text="Active")).to_have_count(1)
        message = await_inbox(mail, guest, 1)[0]
        assert url in text(message)
        link = mentor.get(f"/api/checkpoints/{sample_checkpoints(mentor, pid)['Minute 40']['id']}/reviewer-links").json()["links"][0]
        with ui(browser, Api(app_url), urllib.parse.urlsplit(url).path, timezone="UTC") as guest_page:
            expect(guest_page.get_by_role("heading", level=1)).to_have_text("Minute 40", timeout=UI_MS)
            expect(guest_page.get_by_text(f"Link expires {stamp(parse_iso(link['expires_at']))}")).to_be_visible()
            files = guest_page.get_by_role("list", name="Files")
            for path in SEED_FILES:
                expect(guest_page.get_by_role("region", name=path, exact=True)).to_be_visible()
            expect(guest_page.get_by_role("region", name="src/tip.js", exact=True)).to_contain_text(TIP_LINE)
            expect(files).to_be_visible()
            changing = guest_page.get_by_role("button", name=CHANGING_BUTTON)
            expect(changing).to_have_count(0)
            fields = guest_page.get_by_role("textbox")
            assert not [i for i in range(fields.count()) if fields.nth(i).is_editable()]
            assert guest_page.title() == "Checkpoint review — Relay Bench"
            body = guest_page.content()
            for value in (SAMPLE_TITLE, mentor.name, mentor.email, "Robin Vale", pid):
                assert value not in body, value
            address.fill(second)
            address.focus()
            assert mentor.post(f"/api/reviewer-links/{link['id']}/revoke").status_code == 200
            advance(page, SHARE_REFRESH_MS)
            expect(rows.filter(has_text="Revoked")).to_have_count(1, timeout=UI_MS)
            expect(address).to_have_value(second)
            expect(address).to_be_focused()
            expect(hours).to_have_value(str(LINK_HOURS_DEFAULT))
            expect(link_box).to_have_value(url)
            expect(region).to_have_text(copy)
            guest_page.reload()
            expect(status(guest_page, "Review status")).to_have_text("This review link was revoked.", timeout=UI_MS)
    assert httpx.get(f"{app_url}/api/review/{token_of(link)}").status_code == 410


def test_wf_reviewer_links_regenerate(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = sample_project(mentor)["id"]
    cid = sample_checkpoints(mentor, pid)["Minute 40"]["id"]
    with ui(browser, mentor, f"/projects/{pid}") as page:
        dialog = share_dialog(page, "Minute 40")
        btn(dialog, "Create link").click()
        region = status(page, "Share status", True)
        expect(region).to_contain_text("Reviewer link created.", timeout=UI_MS)
        expect(region).not_to_contain_text("Email")
        old = dialog.get_by_role("textbox", name="Reviewer link").input_value()
        row = dialog.get_by_role("list", name="Reviewer links").get_by_role("listitem").first
        btn(row, "Regenerate").click()
        expect(region).to_have_text("New link created. The old link no longer opens.", timeout=UI_MS)
        with ui(browser, Api(app_url), urllib.parse.urlsplit(old).path) as guest_page:
            expect(status(guest_page, "Review status")).to_have_text("This review link doesn't exist.", timeout=UI_MS)
        current = mentor.get(f"/api/checkpoints/{cid}/reviewer-links").json()["links"][0]
        assert token_of(current) != old.rsplit("/", 1)[1]
        assert httpx.get(f"{app_url}/api/review/{token_of(current)}").status_code == 200
        btn(row, "Revoke").click()
        expect(region).to_have_text("Link revoked. It no longer opens.", timeout=UI_MS)
        expect(row).to_contain_text("Revoked")
    expect_error(httpx.get(f"{app_url}/api/review/{token_of(current)}"), 410, "link_revoked")


def test_wf_reviewer_links_expired(browser: Browser, mail: Mailpit) -> None:
    base = env_url("APP_SHORT_URL")
    mentor = new_mentor(mail, base)
    pid = sample_project(mentor)["id"]
    cid = sample_checkpoints(mentor, pid)["Minute 40"]["id"]
    with ui(browser, mentor, f"/projects/{pid}") as page:
        dialog = share_dialog(page, "Minute 40")
        dialog.get_by_role("spinbutton", name="Expires in hours").fill("1")
        btn(dialog, "Create link").click()
        expect(status(page, "Share status", True)).to_contain_text("Reviewer link created.", timeout=UI_MS)
        url = dialog.get_by_role("textbox", name="Reviewer link").input_value()
        token = url.rsplit("/", 1)[1]
        poll(lambda: httpx.get(f"{base}/api/review/{token}").status_code == 410, EXPIRY_WAIT_S, "link expiry")
        with ui(browser, Api(base), f"/review/{token}") as guest_page:
            expect(status(guest_page, "Review status")).to_have_text("This review link has expired.", timeout=UI_MS)
        rows = dialog.get_by_role("list", name="Reviewer links").get_by_role("listitem")
        expect(rows.filter(has_text="Expired")).to_have_count(1, timeout=SHARE_REFRESH_MS + UI_MS)
    assert mentor.get(f"/api/checkpoints/{cid}/reviewer-links").json()["links"][0]["state"] == "expired"


def test_learner_erasure(app_url: str, mail: Mailpit) -> None:
    first = new_mentor(mail, app_url)
    solo = new_project(first, "one_to_one")["id"]
    learner = join(mail, first, solo, "erase")
    add_file(learner, solo, "work/solo.txt", f"{label('solo')}\n")
    make_checkpoint(learner, solo)
    second = new_mentor(mail, app_url)
    team = new_project(second, "group")["id"]
    add_file(second, team, "shared/base.txt", "base\n")
    kept = make_checkpoint(second, team)
    seen = all_tokens(mail, learner.email)
    assert invite(second, team, learner.email, learner.name).status_code == 201
    wait_token(mail, learner.email, seen)
    own = f"{label('own')}\n".encode()
    add_file(learner, team, "mine/own.txt", own.decode())
    theirs = make_checkpoint(learner, team)
    assert restore(learner, kept["id"]).status_code == 200
    assert invite(second.clone(env_url("APP_MAILPIT_DOWN_URL")), team, learner.email, learner.name).status_code == 201
    expect_error(second.delete("/api/me", {"confirm": "ERASE"}), 403, "forbidden")
    assert "confirm" in expect_error(learner.delete("/api/me", {"confirm": "erase"}), 422, "validation")["fields"]
    r = learner.delete("/api/me", {"confirm": "ERASE"})
    assert r.status_code == 204, r.text
    expect_error(learner.get("/api/me"), 401, "unauthenticated")
    expect_error(first.get(f"/api/projects/{solo}"), 404, "not_found")
    store = S3()
    poll(lambda: store.keys(f"projects/{solo}/") == [], SAVE_WAIT_S, "one-to-one objects removed")
    expect_error(second.get(f"/api/checkpoints/{theirs['id']}"), 404, "not_found")
    keys = store.keys(f"projects/{team}/")
    assert manifest_key(team, theirs["id"]) not in keys and blob_key(team, own) not in keys
    assert manifest_key(team, kept["id"]) in keys
    for f in checkpoint_of(second, kept["id"])["files"]:
        assert f"projects/{team}/blobs/{f['sha256']}" in keys
    assert member(second, team, learner.user["id"]) is None
    restores = [e for e in audit_of(second, team) if e["type"] == "checkpoint_restored"]
    assert len(restores) == 1 and restores[0]["actor"]["name"] == ERASED and not restores[0]["actor"]["id"]
    pg = Postgres()
    assert rows_mentioning(pg, learner.email) == [] and rows_mentioning(pg, learner.name) == []


def erase_through_ui(page: Page, typed: str) -> None:
    btn(page, "Account").click()
    page.get_by_role("menu", name="Account").get_by_role("menuitem", name="Erase my account").click()
    dialog = page.get_by_role("alertdialog", name="Erase your account?")
    dialog.get_by_role("textbox", name="Type ERASE to confirm").fill(typed)
    btn(dialog, "Erase account").click()


def test_wf_erasure_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (learner,) = group(mail, app_url, 1, "one_to_one")
    with ui(browser, learner, "/") as page:
        erase_through_ui(page, "ERASE")
        expect(page).to_have_url(re.compile(r"/sign-in"), timeout=UI_MS)
        expect(status(page, "Sign-in status")).to_have_text("Your account and your work have been erased.")
    expect_error(learner.get("/api/me"), 401, "unauthenticated")
    expect_error(mentor.get(f"/api/projects/{project['id']}"), 404, "not_found")


def test_wf_erasure_confirm_error(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor, project, (learner,) = group(mail, app_url, 1, "one_to_one")
    with ui(browser, learner, "/") as page:
        erase_through_ui(page, "erase")
        expect(status(page, "Account status")).to_have_text("Type ERASE to confirm.", timeout=UI_MS)
    assert learner.get("/api/me").status_code == 200
    assert mentor.get(f"/api/projects/{project['id']}").status_code == 200


def test_wf_erasure_storage_outage(browser: Browser, mail: Mailpit) -> None:
    mentor, project, (learner,) = group(mail, env_url("APP_MINIO_DOWN_URL"), 1, "one_to_one")
    with ui(browser, learner, "/") as page:
        erase_through_ui(page, "ERASE")
        expect(status(page, "Account status")).to_have_text(
            "Storage is unreachable, so your account can't be erased right now. Nothing was removed.", timeout=UI_MS)
    assert learner.get("/api/me").status_code == 200
    assert mentor.get(f"/api/projects/{project['id']}").status_code == 200


def test_health_on_every_instance(app_url: str) -> None:
    for base in (app_url, env_url("APP_MINIO_DOWN_URL"), env_url("APP_MAILPIT_DOWN_URL"), env_url("APP_SHORT_URL")):
        r = httpx.get(f"{base.rstrip('/')}/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, (base, r.text)


def test_server_boundary(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(app_url))
    title = label("Foreign")
    expect_error(mentor.request("POST", "/api/projects", {"title": title, "kind": "group"}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    assert title not in [p["title"] for p in mentor.get("/api/projects").json()["projects"]]
    assert mentor.request("POST", "/api/projects", {"title": label("Same"), "kind": "group"}, headers={"Origin": origin}).status_code == 201
    pid = sample_project(mentor)["id"]
    f = file_map(mentor, pid)["README.md"]
    path = f"/api/projects/{pid}/files/{f['id']}"

    def sized(total: int) -> bytes:
        shell = json.dumps({"content": "", "base_revision": f["revision"]}, separators=(",", ":"))
        return shell.replace('""', '"' + "a" * (total - len(shell)) + '"').encode()
    big = mentor.request("PUT", path, content=sized(JSON_LIMIT + 1), headers={"Content-Type": "application/json"})
    assert expect_error(big, 413, "too_large")["limit_bytes"] == JSON_LIMIT
    edge = mentor.request("PUT", path, content=sized(JSON_LIMIT), headers={"Content-Type": "application/json"})
    assert edge.status_code != 413
    assert file_map(mentor, pid)["README.md"]["sha256"] == f["sha256"]
    expect_error(mentor.request("POST", "/api/projects", content=b"title", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    expect_error(mentor.get(UNKNOWN_API), 404, "not_found")
    secrets = [v for v in (os.environ.get(n, "") for n in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL")) if len(v) >= 8]
    for probe in SERVED_PROBES:
        served = httpx.get(f"{app_url}{probe}").text
        assert "run-manifest-v1" not in served, probe
        for value in secrets:
            assert value not in served, probe
    html = httpx.get(f"{app_url}/sign-in").text
    assets = [html] + [httpx.get(urllib.parse.urljoin(app_url + "/", ref)).text
                       for ref in re.findall(r'(?:src|href)="(/[^"]+)"', html)]
    for body in assets:
        for value in secrets:
            assert value not in body
    sock = Sock(browser, mentor, pid)
    try:
        sock.send({"type": "cursor", "file_id": "x" * FRAME_LIMIT, "line": 1, "column": 1})
        assert sock.wait_closed()["code"] == CLOSE_TOO_BIG
    finally:
        sock.close()


def test_storage_outage_serves_core(mail: Mailpit) -> None:
    base = env_url("APP_MINIO_DOWN_URL")
    mentor = new_mentor(mail, base)
    pid = new_project(mentor, "one_to_one")["id"]
    f = add_file(mentor, pid, DRIVE_PATH, DRIVE_TEXT)
    live = go_live(mentor, pid)
    save_ok(mentor, pid, f, "let total = 1;\n")
    assert act(mentor, live["id"], "end").status_code == 200
    expect_error(upload(mentor, pid, make_zip([("b.txt", b"b\n")])), 503, "storage_unavailable")


def test_keyboard_and_focus(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = sample_project(mentor)["id"]
    sample_checkpoints(mentor, pid)
    with ui(browser, mentor, f"/projects/{pid}") as page:
        expect(page.get_by_role("heading", level=1)).to_have_text("Sample session", timeout=UI_MS)
        names = full_tab_order(page)
        assert names[:2] == ["Skip to editor", "Account"], names
        wanted = ["Skip to editor", "Account", "Start session", "Members", f"Follow {DEMO_LEARNER}", "New file", "Import zip",
                  "Code editor", "Ledger", "Checkpoint name", "Save checkpoint", "Open Minute 40", "Restore Minute 40",
                  "Share Minute 40", "Open Starter", "Restore Starter", "Share Starter"]
        assert in_order(names, wanted), names
        if "Schedule session" in names:
            assert names.index("Schedule session") < names.index("Start session")
        allowed = set(wanted) | {"Schedule session", "Rename", "Delete file", "Take the baton", "Pass the baton"}
        fileish = ("README.md", "index.html", "tip.js", "tip.test.js", "src")
        assert not [n for n in names if n and n not in allowed and not any(p in n for p in fileish)], names
        assert not [n for n in names if n.startswith("Close ")]
        members = btn(page, "Members")
        ring = ("outline-style", "outline-width", "outline-color", "box-shadow")
        members.evaluate("e => e.blur()")
        rest, focused = state_styles(members, *ring, state="focus")
        assert rest != focused
        members.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Members")
        expect(page.get_by_role("textbox", name="Learner email")).to_be_focused(timeout=UI_MS)
        handle = dialog.element_handle()
        for _ in range(12):
            page.keyboard.press("Tab")
            assert handle.evaluate("(d) => d.contains(document.activeElement)")
        remove = btn(page, f"Remove {DEMO_LEARNER}")
        remove.click()
        confirm = page.get_by_role("alertdialog", name=f"Remove {DEMO_LEARNER}?")
        expect(btn(confirm, "Cancel")).to_be_focused(timeout=UI_MS)
        page.keyboard.press("Escape")
        expect(confirm).to_be_hidden(timeout=UI_MS)
        expect(remove).to_be_focused()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden(timeout=UI_MS)
        expect(members).to_be_focused()
    assert member(mentor, pid, next(m["user_id"] for m in project_of(mentor, pid)["members"] if m["name"] == DEMO_LEARNER))


def test_motion_discipline(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    for reduced in ("no-preference", "reduce"):
        with clocked(browser, mentor, reduced=reduced) as page:
            page.goto(f"{mentor.base}/")
            projects = page.get_by_role("list", name="Projects")
            expect(projects).to_be_visible(timeout=UI_MS)
            btn(page, "New project").click()
            dialog = page.get_by_role("dialog", name="New project")
            path = dialog.evaluate(SEEK_FLIGHT, BATON_SAMPLES) or motion(dialog, PANEL_MAX_MS, settle_ms=0)
            settle(dialog)
            final = sample(dialog)
            assert same_rect(path[-1], final), (path[-1], final)
            assert path[-1].get("t", 0) <= PANEL_MAX_MS + FRAME_MS, path[-1]
            if reduced == "reduce":
                assert all(same_rect(s, final) for s in path), path
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden(timeout=UI_MS)
            settle(projects)
            assert animations(projects) == []
            settle(btn(page, "New project"))
            assert [a for a in animations(btn(page, "New project")) if a.get("playState") == "running"] == []
        with clocked(browser, mentor, reduced=reduced) as page:
            page.goto(f"{mentor.base}/projects/{sample_project(mentor)['id']}")
            rail = page.get_by_role("complementary", name="Presence")
            expect(rail).to_be_visible(timeout=UI_MS)
            settle(rail)
            assert animations(rail) == []


def manifest_licence(name: str, child: dict[str, Any]) -> Any:
    root = pathlib.Path(child["path"]) if child.get("path") else pathlib.Path("/app/node_modules") / name
    manifest = root / "package.json"
    return json.loads(manifest.read_text()).get("license") if manifest.is_file() else None


def shipped_packages() -> dict[tuple[str, str], Any]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd="/app",
                         capture_output=True, text=True, timeout=NPM_TIMEOUT)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple[str, str], Any] = {}

    def walk(node: dict[str, Any]) -> None:
        for name, child in (node.get("dependencies") or {}).items():
            if child.get("version"):
                found[(name, child["version"])] = child.get("license") or manifest_licence(name, child)
            walk(child)
    walk(tree)
    return found


def squash(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def font_family(path: pathlib.Path) -> str:
    name = squash(re.split(r"[-_\[\s.]", path.stem)[0])
    return re.sub(r"(variable|var|vf|regular|italic|bold|light|medium)+$", "", name) or name


def font_files() -> list[pathlib.Path]:
    skip = {"node_modules", ".git", "dist", "build"}
    return [p for p in pathlib.Path("/app").rglob("*") if p.suffix.lower() in (".woff2", ".woff", ".ttf", ".otf")
            and not skip & set(p.parts)]


def test_if_run_manifest() -> None:
    data = json.loads(pathlib.Path("/app/run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = pathlib.Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({name for name, _ in shipped_packages() if name not in notices})
    assert not missing, missing
    for font in font_files():
        assert font_family(font) in squash(notices), font


def test_if_licences() -> None:
    allow = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0"}
    bad = []
    for (name, version), lic in shipped_packages().items():
        value = lic.get("type") if isinstance(lic, dict) else lic
        expr = str(value or "").replace("(", "").replace(")", "")
        options = [[t.strip() for t in alt.split(" AND ")] for alt in expr.split(" OR ")]
        if not any(all(t in allow for t in alt) for alt in options):
            bad.append((name, version, value))
    assert not bad, bad
    if font_files():
        assert "OFL-1.1" in pathlib.Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore() -> None:
    stores = [s.lower() for s in FORBIDDEN_STORES]
    names = {name.lower() for name, _ in shipped_packages()}
    assert not [n for n in names if any(s in n for s in stores)], names
    for proc in pathlib.Path("/proc").glob("[0-9]*/comm"):
        with contextlib.suppress(OSError):
            command = proc.read_text().strip().lower()
            assert not any(s in command for s in stores), command


PROTECTED = re.compile(r"(^|/)(\.env(?!\.example$|\.sample$)[\w.-]*|(docker-)?compose[\w.-]*\.ya?ml)$")


def edited_paths(node: Any) -> Iterator[str]:
    if isinstance(node, dict):
        tool = " ".join(str(node.get(k, "")) for k in ("name", "tool", "tool_name", "function")).lower()
        if "write" in tool or "edit" in tool:
            blob = json.dumps(node)
            for raw in re.findall(r'"(?:file_path|path|filename)\\?"\s*:\s*\\?"([^"\\]+)', blob):
                yield raw
        for value in node.values():
            yield from edited_paths(value)
    elif isinstance(node, list):
        for value in node:
            yield from edited_paths(value)


def test_if_service_config_untouched() -> None:
    app, trajectory = pathlib.Path("/app"), pathlib.Path("/logs/agent/trajectory.json")
    if (app / ".git").exists():
        tracked = subprocess.run(["git", "-C", "/app", "ls-files"], capture_output=True, text=True).stdout.split()
        guarded = [p for p in tracked if PROTECTED.search(p)]
        if guarded:
            diff = subprocess.run(["git", "-C", "/app", "diff", "--name-only", "HEAD", "--", *guarded], capture_output=True, text=True)
            assert diff.stdout.strip() == "", diff.stdout
    if trajectory.exists():
        hits = [p for p in edited_paths(json.loads(trajectory.read_text())) if PROTECTED.search(p)]
        assert not hits, hits


LINE_COMMENT = "/" * 2


def jsonc(raw: str) -> Any:
    out: list[str] = []
    i, n = 0, len(raw)
    while i < n:
        ch = raw[i]
        if ch == '"':
            j = i + 1
            while j < n and raw[j] != '"':
                j += 2 if raw[j] == "\\" else 1
            out.append(raw[i:j + 1])
            i = j + 1
        elif raw.startswith(LINE_COMMENT, i):
            j = raw.find("\n", i)
            i = n if j < 0 else j
        elif raw.startswith("/*", i):
            j = raw.find("*/", i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(ch)
            i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def ts_base(folder: pathlib.Path, ref: str) -> pathlib.Path | None:
    roots = [folder / ref] if ref.startswith((".", "/")) else [d / "node_modules" / ref for d in (folder, *folder.parents)]
    for root in roots:
        for option in (root, root.with_name(root.name + ".json"), root / "tsconfig.json"):
            if option.is_file():
                return option
    return None


def ts_config(cfg: pathlib.Path) -> tuple[dict[str, Any], dict[str, Any], bool]:
    data = jsonc(cfg.read_text())
    options: dict[str, Any] = {}
    scope: dict[str, Any] = {}
    unresolved = False
    bases = data.get("extends") or []
    for base in [bases] if isinstance(bases, str) else bases:
        target = ts_base(cfg.parent, base)
        if target is None:
            unresolved = True
            continue
        o, s, u = ts_config(target)
        options.update(o)
        scope.update(s)
        unresolved |= u
    options.update(data.get("compilerOptions") or {})
    scope.update({k: data[k] for k in ("files", "include") if k in data})
    return options, scope, unresolved


def test_if_typescript_strict() -> None:
    skip = {"node_modules", ".git", "dist", "build", "public"}
    configs = [p for p in pathlib.Path("/app").rglob("tsconfig*.json") if not skip & set(p.parts)]
    assert configs
    judged = 0
    for cfg in configs:
        options, scope, unresolved = ts_config(cfg)
        compiles = any(scope.get(k) for k in ("files", "include")) or (not scope and cfg.name == "tsconfig.json")
        if not compiles:
            continue
        judged += 1
        assert options.get("strict") is True or (unresolved and "strict" not in options), cfg
    assert judged, configs
    sources = [p for p in pathlib.Path("/app").rglob("*") if not skip & set(p.parts) and p.is_file()]
    assert [p for p in sources if p.suffix in (".ts", ".tsx")]
    js = [p for p in sources if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and ".config." not in p.name
          and "src" in p.relative_to("/app").parts]
    assert not js, js


def test_if_no_third_party_hosts(browser: Browser, app_url: str, mail: Mailpit) -> None:
    mentor = new_mentor(mail, app_url)
    pid = sample_project(mentor)["id"]
    cid = sample_checkpoints(mentor, pid)["Minute 40"]["id"]
    token = token_of(create_link(mentor, cid, 1).json()["link"])
    seen: list[str] = []
    for path, api in (("/sign-in", Api(app_url)), (f"/projects/{pid}", mentor), (f"/review/{token}", Api(app_url))):
        with ui(browser, api, "/api/health") as page:
            page.on("request", lambda req: seen.append(req.url))
            page.on("websocket", lambda ws: seen.append(ws.url))
            page.goto(app_url + path)
            page.wait_for_load_state("networkidle")
    foreign = [u for u in seen if not u.startswith(("data:", "blob:", "about:")) and not same_origin(u.replace("ws", "http", 1), app_url)]
    assert not foreign, foreign
