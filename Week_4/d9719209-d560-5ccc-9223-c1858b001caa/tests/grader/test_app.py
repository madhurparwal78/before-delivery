from __future__ import annotations

import base64
import email.utils
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Page, expect

from conftest import *
from datetime import datetime, timedelta, timezone


GRADING_KEY = os.environ.get("GRADING_KEY", "")
HTTP_S = 120.0
UI_MS = 15_000
UI_S = 15
UPLOAD_MS = 90_000
MAIL_S = 45
EXPIRY_S = 120
STREAM_READ_S = 25
MENU_STEPS = 8
PAGES = 40
SWIPE_STEPS = 6
NOISE_BLOCK = 32
ACCOUNT_AGE_DAYS = 30
FEED_POSTS = 30
PROBE_ID = "999999999999"
FOREIGN_ORIGIN = "http://evil.example"
HOT_TOL = 0.001
PX_TOL = 1.0
COOKIE_NAME = "mh_session"
SEED_COMMUNITY = "fieldnotes"
SORT_NEW = "new"
SORT_TOP = "top"
STATUS_ALL = "all"
SPOILER_WORDS = "hidden words"
EDITED_COMMENT = "Edited comment."
EDITED_POST_BODY = "Edited body text."
EDIT_MD = "second *body*"
SECRET_BODY = "secret body"
LOUD_WORD = "loudword"
DRAFT_BODY = "Draft body stays."

LIVE_MS = 3000
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
PAGE_SIZE = 25
MODLOG_PAGE = 25
HOT_EPOCH = 1704067200
HOT_DIVISOR = 45000
WORKED_RANK = 1404.52
WORKED_TOL = 0.005
WORKED_SCORE = 10
BIG_SCORE = 12345
NEG_SCORE = -15000
TOTP_STEP_S = 30
TOTP_MOD = 1_000_000
TOTP_SECRET_CHARS = 32
USERNAME_MAX = 20
PASSWORD_MIN = 10
PASSWORD_MAX = 128
NAME_MAX = 21
TITLE_MAX = 300
COMMUNITY_TITLE_MAX = 100
BODY_MAX = 40_000
COMMENT_MAX = 10_000
ALT_MAX = 300
PRIVATE_NOTE_MAX = 1000
PUBLIC_NOTE_MAX = 300
EXPLANATION_MAX = 2000
KEY_MAX = 100
JSON_LIMIT = 100_000
MAX_IMAGE_BYTES = 20_000_000
MAX_PIXELS = 50_000_000
PIXEL_SIDE = 10_000
MEDIA_SLOTS = (320, 640, 1080)
GALLERY_IMAGES = 6
TREE_DEPTH = 12
WIDE_LEVELS = 8
PHONE_LEVELS = 5
ARCHIVE_DAYS = 183
COMMUNITY_AGE_DAYS = 7
OWNED_LIMIT = 5
MOD_2FA_THRESHOLD = 1000
VERIFY_RESEND_LIMIT = 3
LOCKOUT_ATTEMPTS = 5
REPORT_DEADLINE_S = 86400
QUEUE_REFRESH_MS = 5000
HEARTBEAT_S = 15
RETRY_LINE = "retry: 3000"
RATE_WINDOW_S = 60
TOUCH_MIN = 44
FOLD_MAX_MS = 500
SCORE_ROLL_MAX_MS = 250
DIALOG_MAX_MS = 250
SHORT_LOCK_HOUR_S = 4
SHORT_DEADLINE_S = 8
SHORT_RESET_TTL_S = 8
SHORT_VERIFY_TTL_S = 8
SHORT_LOCKOUT_S = 10
SHORT_EDIT_WINDOW_S = 8
SHORT_VOTE_LIMIT = 5
LOCK_HOURS = {"1h": 1, "24h": 24, "7d": 168}
LOCK_REASONS = {"1h": "1 hour", "24h": "24 hours", "7d": "7 days"}
SEED_PASSWORD = "moothall-seed-2026"
SEED_ADMIN_SECRET = "JBSWY3DPEHPK3PXP"
SEED_ACCOUNT_DAYS = 400
RESERVED = ["admin", "api", "mod", "mods", "moothall", "all", "popular", "home", "settings", "about", "u", "c",
            "new", "help", "login", "signup", "media"]
ALLOWED_TAGS = {"p", "em", "strong", "a", "ul", "ol", "li", "blockquote", "code", "pre", "table", "thead", "tbody",
                "tr", "th", "td", "span", "br", "hr"}
ALLOWED_ATTRS = {"href", "rel", "class"}
LINK_REL = "nofollow ugc noopener noreferrer"
SCRIPT_FIXTURES = [
    "<script>window.__mh=1</script>",
    '<img src=x onerror="window.__mh=1">',
    "[tap](javascript:window.__mh=1)",
    "[tap](JaVaScRiPt:window.__mh=1)",
    '<svg><animate onbegin="window.__mh=1"/></svg>',
]
LICENCE_ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0",
                     "OFL-1.1"}
FONT_NAMES = ["Bricolage Grotesque", "Atkinson Hyperlegible", "Atkinson Hyperlegible Mono"]
FILE_DATASTORES = {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "@seald-io/nedb", "level", "leveldown",
                   "lmdb", "mongodb", "mongoose", "mysql", "mysql2", "pouchdb"}
COMPOSE_RE = re.compile(r"(docker-)?compose[^/\s'\"]*\.ya?ml")
LAYOUT_PROPS = {"height", "width", "max-height", "min-height", "margin", "margin-top", "margin-bottom", "padding",
                "padding-top", "padding-bottom", "top", "left", "right", "bottom", "flex-basis",
                "grid-template-rows"}
MOVE_FADE_PROPS = {"transform", "translate", "scale", "rotate", "opacity"}

PUBLIC_USER_KEYS = {"username", "createdAt"}
OWN_ACCOUNT_KEYS = {"id", "username", "email", "emailVerified", "totpEnabled", "role", "createdAt"}
IMAGE_KEYS = {"id", "alt", "width", "height", "src", "srcset"}
POST_KEYS = {"id", "communityName", "author", "title", "bodyHtml", "images", "spoiler", "score", "myVote",
             "commentCount", "createdAt", "editedAt", "state", "removal", "locked", "lockedUntil", "pinned",
             "archived", "version", "url"}
COMMENT_KEYS = {"id", "postId", "parentId", "author", "bodyHtml", "score", "myVote", "depth", "descendantCount",
                "createdAt", "editedAt", "state", "canEdit", "replies"}
COMMUNITY_KEYS = {"id", "name", "title", "description", "type", "memberCount", "rules", "showModNames",
                  "createdAt", "viewer"}
VIEWER_KEYS = {"joined", "isModerator", "isOwner", "canPost"}
RULE_KEYS = {"id", "title", "description"}
ENTRY_KEYS = {"id", "action", "target", "publicReason", "at", "moderator"}
REPORT_KEYS = {"reference", "target", "category", "explanation", "createdAt", "deadlineAt", "secondsRemaining",
               "overdue", "status"}
CURRENT_KEYS = {"version", "state", "locked", "lockedUntil", "pinned"}
REFERENCE_RE = re.compile(r"^MH-[A-Z0-9]{8}$")

GALLERY_SPECS = [("JPEG", 2400, 1600, "image/jpeg", "jpg"), ("PNG", 1200, 800, "image/png", "png"),
                 ("WEBP", 800, 600, "image/webp", "webp"), ("JPEG", 2400, 1600, "image/jpeg", "jpg"),
                 ("PNG", 1200, 800, "image/png", "png"), ("WEBP", 800, 600, "image/webp", "webp")]


def id_selector(ident: str) -> str:
    return "#" + ident


def by_id(scope: Any, ident: str) -> Any:
    return scope.locator(id_selector(ident))


def session_cookie_ok(header: str) -> bool:
    lowered = header.lower()
    return f"{COOKIE_NAME}=" in lowered and all(a.lower() in lowered for a in ("HttpOnly", "SameSite=Lax"))


def short_url() -> str:
    return os.environ["APP_SHORT_URL"]


def storage_down_url() -> str:
    return os.environ["APP_STORAGE_DOWN_URL"]


def valkey_down_url() -> str:
    return os.environ["APP_VALKEY_DOWN_URL"]


def pg(suffix: str = "") -> Any:
    return Postgres(suffix) if suffix else Postgres()


def s3(suffix: str = "") -> Any:
    return S3(suffix) if suffix else S3()


def server_now(base: str) -> datetime:
    r = httpx.get(base + "/api/health", timeout=HTTP_S)
    return email.utils.parsedate_to_datetime(r.headers["date"])


def response_time(r: httpx.Response) -> datetime:
    return email.utils.parsedate_to_datetime(r.headers["date"])


def wait_server_past(base: str, moment: datetime, what: str) -> None:
    deadline = time.monotonic() + EXPIRY_S
    while time.monotonic() < deadline:
        if server_now(base) >= moment + timedelta(seconds=1):
            return
    pytest.fail(f"server clock never passed {moment.isoformat()} while waiting for {what}")


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def utc_label(value: str) -> str:
    t = parse_time(value).astimezone(timezone.utc)
    return f"{t.day} {t.strftime('%b')} {t.year}, {t.strftime('%H:%M')} UTC"


def score_label(score: int) -> str:
    if abs(score) < 10_000:
        return str(score)
    tenths = abs(score) // 100
    return f"{'-' if score < 0 else ''}{tenths // 10}.{tenths % 10}k"


def count_label(n: int, one: str, many: str) -> str:
    return f"1 {one}" if n == 1 else f"{n} {many}"


def hot_rank(score: int, created: datetime) -> float:
    import math
    sign = (score > 0) - (score < 0)
    return sign * math.log10(max(abs(score), 1)) + (created.timestamp() - HOT_EPOCH) / HOT_DIVISOR


def totp_code(secret: str, moment: datetime, offset: int = 0) -> str:
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    counter = int(moment.timestamp()) // TOTP_STEP_S + offset
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    start = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[start:start + 4])[0] & 0x7FFFFFFF) % TOTP_MOD
    return f"{value:06d}"


def wrong_code(secret: str, moment: datetime) -> str:
    valid = {totp_code(secret, moment, k) for k in range(-2, 3)}
    candidate = int(totp_code(secret, moment))
    for _ in range(10):
        candidate = (candidate + TOTP_MOD // 2 + 1) % TOTP_MOD
        if f"{candidate:06d}" not in valid:
            return f"{candidate:06d}"
    pytest.fail("could not build a non-matching 6-digit code")


def fresh(prefix: str, size: int) -> str:
    name, _ = unique(prefix)
    return prefix + hashlib.sha1(f"{name}{secrets.token_hex(4)}".encode()).hexdigest()[: size - len(prefix)]


def fresh_email(username: str) -> str:
    _, addr = unique(username)
    if "@" in addr and "." in addr.split("@")[-1]:
        return addr.strip().lower()
    return f"{username}@example.test".lower()


def fresh_password() -> str:
    return "pw-" + secrets.token_hex(8)


def eventually(check: Callable[[], Any], what: str, seconds: float = UI_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = check()
        if last:
            return last
    pytest.fail(f"{what} (last observed {last!r})")


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def expect_status(r: httpx.Response, status: int, what: str) -> Any:
    assert r.status_code == status, (
        f"{what}: {r.request.method} {r.request.url.path} answered {r.status_code} {r.text[:400]}; expected {status}")
    if r.content and "json" in r.headers.get("content-type", ""):
        return r.json()
    return None


def expect_error(r: httpx.Response, status: int, code: str, what: str,
                 fields: dict[str, str | None] | None = None) -> dict[str, Any]:
    assert r.status_code == status, (
        f"{what}: {r.request.method} {r.request.url.path} answered {r.status_code} {r.text[:400]}; "
        f"expected {status} {code}")
    error = r.json()["error"]
    assert error["code"] == code, f"{what}: error code {error['code']!r}, expected {code!r}"
    for name, copy in (fields or {}).items():
        got = error.get("fields", {})
        assert name in got, f"{what}: fields lacks {name!r}: {got}"
        if copy is not None:
            assert got[name] == copy, f"{what}: fields[{name!r}] is {got[name]!r}, expected {copy!r}"
    return error


class Member:
    def __init__(self, base: str, username: str, addr: str, password: str, member_id: str, secret: str | None,
                 token: str | None = None) -> None:
        self.base, self.username, self.email, self.password = base, username, addr, password
        self.id, self.secret = str(member_id), secret
        self.client = httpx.Client(base_url=base, timeout=HTTP_S)
        if token:
            self.client.cookies.set("mh_session", token)

    @property
    def token(self) -> str:
        return self.client.cookies.get("mh_session") or ""

    def req(self, method: str, path: str, body: Any = None, *, key: str | None = None,
            headers: dict[str, str] | None = None) -> httpx.Response:
        h = dict(headers or {})
        if key is not None:
            h["Idempotency-Key"] = key
        if body is None:
            return self.client.request(method, path, headers=h)
        return self.client.request(method, path, json=body, headers=h)

    def get(self, path: str) -> httpx.Response:
        return self.req("GET", path)

    def sign_in(self) -> httpx.Response:
        body: dict[str, Any] = {"login": self.username, "password": self.password}
        if self.secret:
            body["totp"] = totp_code(self.secret, server_now(self.base))
        return self.client.post("/api/auth/login", json=body)

    def on(self, base: str) -> "Member":
        return Member(base, self.username, self.email, self.password, self.id, self.secret, self.token)

    def clone(self) -> "Member":
        return self.on(self.base)


def visitor(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_S)


def grading(base: str, path: str, body: Any, status: int = 201) -> Any:
    r = post_json(base, "/api/grading" + path, body, **{"X-Grading-Key": GRADING_KEY})
    assert r.status_code == status, f"POST /api/grading{path} answered {r.status_code}: {r.text[:300]}"
    return r.json()


def new_member(base: str, *, verified: bool = True, age: int = ACCOUNT_AGE_DAYS, role: str = "user",
               totp_on: bool = False, sign_in: bool = True, prefix: str = "m") -> Member:
    username = fresh(prefix, 16)
    addr = fresh_email(username)
    password = fresh_password()
    made = grading(base, "/users", {"username": username, "email": addr, "password": password, "verified": verified,
                                    "accountAgeDays": age, "role": role, "totp": totp_on})
    member = Member(base, username, addr, password, made["id"], made["totpSecret"])
    if sign_in:
        r = member.sign_in()
        assert r.status_code == 200, f"grading user {username} could not sign in: {r.status_code} {r.text[:200]}"
    return member


def new_community(base: str, owner: Member, *, moderators: tuple[Member, ...] = (), members: tuple[Member, ...] = (),
                  kind: str = "public", member_count: int | None = None,
                  rules: list[dict[str, str]] | None = None) -> dict[str, Any]:
    name = fresh("c", 15)
    mods = [owner.username] + [m.username for m in moderators]
    everyone = list(dict.fromkeys(mods + [m.username for m in members]))
    rules = rules if rules is not None else [{"title": "Stay on topic " + name[-5:], "description": "Keep to it."}]
    made = grading(base, "/communities", {
        "name": name, "title": "Title " + name, "type": kind, "owner": owner.username, "moderators": mods,
        "members": everyone, "memberCount": member_count if member_count is not None else len(everyone),
        "rules": rules})
    return {"name": made["name"], "ruleIds": [str(i) for i in made["ruleIds"]], "rules": rules}


def new_post(base: str, community: str, author: Member, *, title: str | None = None, body: str = "Plain body text.",
             score: int = 0, created: datetime | None = None, spoiler: bool = False) -> dict[str, Any]:
    title = title or "Post " + fresh("t", 14)
    created = created or server_now(base) - timedelta(minutes=1)
    made = grading(base, "/posts", {"community": community, "author": author.username, "title": title,
                                    "bodyMd": body, "score": score, "createdAt": iso(created), "spoiler": spoiler})
    return {"id": str(made["id"]), "url": made["url"], "hotRank": made["hotRank"], "title": title,
            "created": created, "score": score}


def create_post(member: Member, community: str, title: str, body: str = "Body text.", *,
                images: list[dict[str, Any]] | None = None, spoiler: bool = False,
                key: str | None = None) -> httpx.Response:
    payload: dict[str, Any] = {"title": title, "bodyMd": body, "spoiler": spoiler}
    if images is not None:
        payload["images"] = images
    return member.req("POST", f"/api/communities/{community}/posts", payload, key=key or idempotency_key())


def add_comment(member: Member, post_id: str, body: str, parent: str | None = None,
                key: str | None = None) -> httpx.Response:
    return member.req("POST", f"/api/posts/{post_id}/comments", {"bodyMd": body, "parentId": parent},
                      key=key or idempotency_key())


def comment_id(member: Member, post_id: str, body: str, parent: str | None = None) -> str:
    return str(expect_status(add_comment(member, post_id, body, parent), 201, "create comment")["comment"]["id"])


def cast(member: Member, kind: str, target: str, value: int) -> httpx.Response:
    return member.req("PUT", f"/api/{kind}/{target}/vote", {"value": value})


def version_of(member: Member, post_id: str) -> int:
    return expect_status(member.get(f"/api/posts/{post_id}"), 200, "read post version")["version"]


def mod_action(member: Member, method: str, post_id: str, action: str, **extra: Any) -> httpx.Response:
    return member.req(method, f"/api/posts/{post_id}/{action}", {"version": version_of(member, post_id), **extra})


def walk_pages(client: Any, path: str) -> list[dict[str, Any]]:
    pages, cursor = [], None
    for _ in range(PAGES):
        sep = "&" if "?" in path else "?"
        url = path + (f"{sep}cursor={cursor}" if cursor else "")
        body = expect_status(client.get(url), 200, f"GET {url}")
        pages.append(body)
        cursor = body["nextCursor"]
        if cursor is None:
            return pages
    pytest.fail(f"GET {path} never returned nextCursor null within {PAGES} pages")


def posts_titled(client: Any, username: str, title: str) -> list[dict[str, Any]]:
    return [p for page in walk_pages(client, f"/api/users/{username}/posts") for p in page["items"]
            if p["title"] == title]


def modlog(client: Any, name: str) -> list[dict[str, Any]]:
    return [e for page in walk_pages(client, f"/api/communities/{name}/modlog") for e in page["items"]]


def flat(tree: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for node in tree:
        out.append(node)
        out.extend(flat(node.get("replies", [])))
    return out


def votes_of(member_id: str, kind: str, target: str, suffix: str = "") -> list[int]:
    rows = pg(suffix).rows(
        f"SELECT value FROM votes WHERE member_id = {int(member_id)} AND target_type = '{kind}' "
        f"AND target_id = {int(target)}")
    return [int(r["value"]) for r in rows]


def post_row(post_id: str, suffix: str = "") -> dict[str, Any]:
    rows = pg(suffix).rows(f"SELECT id, score, comment_count, hot_rank, state FROM posts WHERE id = {int(post_id)}")
    assert rows, f"posts has no row {post_id}"
    return rows[0]


def post_count(post_id: str, suffix: str = "") -> int:
    return len(pg(suffix).rows(f"SELECT id FROM posts WHERE id = {int(post_id)}"))


def file_report(base: str, post_id: str, *, reporter: str | None = None, member: Member | None = None,
                category: str = "privacy") -> httpx.Response:
    body: dict[str, Any] = {"targetType": "post", "targetId": post_id, "category": category,
                            "explanation": "This post publishes a private home address.", "goodFaith": True}
    if reporter is not None:
        body["reporterEmail"] = reporter
    if member is not None:
        return member.req("POST", "/api/reports", body)
    return visitor(base).post("/api/reports", json=body)


def mails_for(mail: Any, to: str, subject: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages() if to.lower() in [a.lower() for a in addresses(m.get("To"))]
            and m.get("Subject") == subject]


def wait_mail(mail: Any, to: str, subject: str, count: int = 1, seconds: float = MAIL_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    found: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        found = mails_for(mail, to, subject)
        if len(found) >= count:
            return found
    pytest.fail(f"Mailpit never received {count} mail(s) '{subject}' to {to}; saw {len(found)}")


def token_path(body: str, route: str) -> str:
    m = re.search(re.escape(route) + r"\?token=([^\s<>\"')\]]+)", body)
    assert m, f"mail body has no link to {route}?token=: {body[:400]}"
    return f"{route}?token={m.group(1)}"


def token_of(path: str) -> str:
    return path.split("token=", 1)[1]


class Stream:
    def __init__(self, base: str, topics: str, *, token: str | None = None, last_id: str | None = None) -> None:
        self.lines: list[str] = []
        self.events: list[dict[str, str]] = []
        self.status: int | None = None
        self.body = b""
        self.cond = threading.Condition()
        self.done = False
        headers = {"Accept": "text/event-stream"}
        if last_id:
            headers["Last-Event-ID"] = last_id
        self.client = httpx.Client(base_url=base, timeout=httpx.Timeout(HTTP_S, read=STREAM_READ_S),
                                   cookies={"mh_session": token} if token else None)
        self.thread = threading.Thread(target=self._run, args=(f"/api/stream?topics={topics}", headers), daemon=True)
        self.thread.start()

    def _run(self, path: str, headers: dict[str, str]) -> None:
        try:
            with self.client.stream("GET", path, headers=headers) as r:
                with self.cond:
                    self.status = r.status_code
                    self.cond.notify_all()
                if r.status_code != 200:
                    data = r.read()
                    with self.cond:
                        self.body = data
                        self.cond.notify_all()
                    return
                current: dict[str, str] = {}
                for line in r.iter_lines():
                    if self.done:
                        return
                    with self.cond:
                        self.lines.append(line)
                        if line == "":
                            if "event" in current or "data" in current:
                                self.events.append(current)
                            current = {}
                        elif not line.startswith(":"):
                            field, _, value = line.partition(":")
                            current[field] = value[1:] if value.startswith(" ") else value
                        self.cond.notify_all()
        except Exception:
            with self.cond:
                self.cond.notify_all()

    def wait(self, predicate: Callable[["Stream"], Any], seconds: float, what: str) -> Any:
        deadline = time.monotonic() + seconds
        with self.cond:
            while time.monotonic() < deadline:
                found = predicate(self)
                if found:
                    return found
                self.cond.wait(timeout=max(0.0, deadline - time.monotonic()))
        pytest.fail(f"event stream: {what} within {seconds} s; lines so far {self.lines[-12:]}")

    def matching(self, event: str, check: Callable[[dict[str, Any]], bool] = lambda d: True) -> list[dict[str, Any]]:
        out = []
        for e in self.events:
            if e.get("event") == event:
                data = json.loads(e.get("data", "null"))
                if check(data):
                    out.append({"id": e.get("id"), "data": data})
        return out

    def ready(self) -> None:
        self.wait(lambda s: s.status is not None and (s.status != 200 or s.lines), UI_S, "connected")

    def close(self) -> None:
        self.done = True
        self.client.close()

    def __enter__(self) -> "Stream":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


def stream_id(value: str) -> tuple[int, int]:
    ms, _, seq = value.partition("-")
    return int(ms), int(seq or 0)


def picture(fmt: str, width: int, height: int, gps: bool = False) -> bytes:
    from PIL import Image
    cols, rows = max(1, width // NOISE_BLOCK), max(1, height // NOISE_BLOCK)
    tile = Image.frombytes("RGB", (cols, rows), os.urandom(cols * rows * 3))
    img = tile.resize((width, height), Image.NEAREST)
    buf = BytesIO()
    if fmt == "JPEG":
        exif = Image.Exif()
        if gps:
            exif[0x8825] = {1: "N", 2: (51.0, 28.0, 38.0), 3: "W", 4: (0.0, 7.0, 39.0)}
        img.save(buf, "JPEG", quality=85, exif=exif.tobytes())
        if gps:
            assert Image.open(BytesIO(buf.getvalue())).getexif().get_ifd(0x8825), "fixture JPEG must carry GPS EXIF"
    else:
        img.save(buf, fmt)
    return buf.getvalue()


def png_bytes(width: int, height: int, total: int | None = None) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    row = b"\x00" + bytes([secrets.randbelow(256)]) * width
    packer = zlib.compressobj(1)
    idat = b"".join(packer.compress(row) for _ in range(height)) + packer.flush()
    head = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
    tail = chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    if total is None:
        return head + tail
    return head + chunk(b"prVt", os.urandom(total - len(head) - len(tail) - 12)) + tail


def upload(member: Member, data: bytes, filename: str, ctype: str) -> httpx.Response:
    return member.client.post("/api/images", files={"file": (filename, data, ctype)})


def webp_chunks(data: bytes) -> list[bytes]:
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP", "stored object is not a WebP file"
    names, pos = [], 12
    while pos + 8 <= len(data):
        names.append(data[pos:pos + 4])
        size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        pos += 8 + size + (size & 1)
    return names


def srcset_for(image_id: str, width: int) -> str:
    parts, last = [], None
    for slot in MEDIA_SLOTS:
        stored = min(slot, width)
        if stored != last:
            parts.append(f"/media/{image_id}/{slot}.webp {stored}w")
        last = stored
    return ", ".join(parts)


def image_keys(sha: str) -> set[str]:
    return {f"images/{sha}/original.webp"} | {f"images/{sha}/{slot}.webp" for slot in MEDIA_SLOTS}


@contextmanager
def tab(browser: Browser, base: str, member: Member | None = None, size: dict[str, int] = DESKTOP, path: str = "/",
        reduced: str = "no-preference", clock_at: datetime | None = None,
        block_stream: bool = False) -> Iterator[Page]:
    with open_app(browser, base + "/api/health", reduced_motion=reduced) as page:
        page.set_viewport_size(size)
        if member is not None:
            page.context.add_cookies([{"name": "mh_session", "value": member.token, "url": base}])
        if clock_at is not None:
            page.clock.set_system_time(clock_at)
        if block_stream:
            page.route("**/api/stream*", lambda route: route.abort())
        page.goto(base + path)
        yield page


def live_ready(page: Page) -> None:
    expect(by_id(page, "live-indicator")).to_have_text("Live", timeout=UI_MS)


def announced(page: Page, copy: Any, timeout: int = UI_MS, alert: bool = False) -> None:
    expect(by_id(page, "live-alert" if alert else "live-status")).to_contain_text(copy, timeout=timeout)


ANNOUNCED_JS = "(c) => ['live-status', 'live-alert'].some(id => (document.getElementById(id)?.textContent || '').includes(c))"


def announced_anywhere(page: Page, copy: str) -> None:
    deadline = time.monotonic() + UI_S
    while time.monotonic() < deadline:
        try:
            if page.evaluate(ANNOUNCED_JS, copy):
                return
            advance(page, 48)
        except PlaywrightError as exc:
            if "context was destroyed" not in str(exc) and "navigat" not in str(exc):
                raise
            page.wait_for_load_state("load")
    pytest.fail(f"'{copy}' never appeared in live-status or live-alert")


DESCRIBED_JS = """el => (el.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)
  .map(id => (document.getElementById(id) || {}).textContent || '').join(' ')"""


def described(locator: Any) -> str:
    return locator.evaluate(DESCRIBED_JS)


def field_error(locator: Any, copy: str) -> None:
    expect(locator).to_have_attribute("aria-invalid", "true", timeout=UI_MS)
    eventually(lambda: copy in described(locator), f"field error '{copy}' linked by aria-describedby")


def card_ids(page: Page) -> list[str]:
    return page.get_by_role("article").evaluate_all(
        "els => els.map(e => e.id).filter(id => id.startsWith('post-')).map(id => id.slice(5))")


def active_id(page: Page) -> str:
    return page.evaluate("() => document.activeElement ? document.activeElement.id : ''")


def menu_item(page: Page, button: Any, item: str) -> None:
    button.focus()
    page.keyboard.press("Enter")
    expect(page.get_by_role("menuitem").first).to_be_focused(timeout=UI_MS)
    target = page.get_by_role("menuitem", name=item, exact=True)
    expect(target).to_be_visible()
    for _ in range(MENU_STEPS):
        if target.evaluate("el => el === document.activeElement"):
            page.keyboard.press("Enter")
            return
        page.keyboard.press("ArrowDown")
    pytest.fail(f"menu item '{item}' never received focus with Down")


def swipe_left(page: Page, locator: Any) -> None:
    box = locator.bounding_box()
    y = box["y"] + box["height"] / 2
    start, end = box["x"] + box["width"] * 0.85, box["x"] + box["width"] * 0.15
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": start, "y": y}]})
    for step in range(1, SWIPE_STEPS + 1):
        x = start + (end - start) * step / SWIPE_STEPS
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


VISIBLE_IMAGES_LOADED_JS = """el => {
  const imgs = [...el.querySelectorAll('img')].filter(i => i.getClientRects().length && i.getBoundingClientRect().width > 0
    && i.getBoundingClientRect().right > 0 && i.getBoundingClientRect().left < window.innerWidth);
  return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0);
}"""

HIDDEN_INERT_JS = """id => { const el = document.getElementById(id);
  return !el || (!!el.closest('[inert]') && !el.checkVisibility({opacityProperty: true, visibilityProperty: true})); }"""

RECORDER_JS = """() => {
  if (window.__mhRec) return;
  const rec = window.__mhRec = [];
  const seen = new WeakSet();
  const note = (a) => {
    if (!a || seen.has(a) || !a.effect) return;
    seen.add(a);
    const timing = a.effect.getComputedTiming();
    let props = [];
    try { props = a.effect.getKeyframes().flatMap(k => Object.keys(k)); } catch (e) {}
    if (a.transitionProperty) props.push(a.transitionProperty);
    props = [...new Set(props)].filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p));
    rec.push({ anim: a, target: a.effect.target, start: document.timeline.currentTime, end: timing.endTime,
               iterations: timing.iterations, props });
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); note(a); return a; };
  const sweep = () => document.getAnimations().forEach(note);
  for (const name of ['transitionrun', 'transitionstart', 'animationstart']) document.addEventListener(name, sweep, true);
  window.__mhSweep = sweep;
}"""

RECORDS_JS = """(sel) => {
  window.__mhSweep();
  return window.__mhRec.filter(r => r.target && r.target.closest && r.target.closest(sel)).map(r => ({
    start: r.start, end: r.end === Infinity ? -1 : r.end, iterations: r.iterations === Infinity ? -1 : r.iterations,
    props: r.props, done: !['running', 'pending'].includes(r.anim.playState) }));
}"""

INFINITE_JS = """() => document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity).length"""


def settled_records(page: Page, selector: str, seconds: float = UI_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    previous = -1
    records: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        page.clock.run_for(100)
        records = page.evaluate(RECORDS_JS, selector)
        if records and len(records) == previous and all(r["done"] for r in records):
            return records
        previous = len(records)
    return records


def span_ms(records: list[dict[str, Any]]) -> float:
    return max(r["start"] + r["end"] for r in records) - min(r["start"] for r in records)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def app_copy(overrides: dict[str, str | None]) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = {k: v for k, v in os.environ.items()}
    for k, v in overrides.items():
        if v is None:
            env.pop(k, None)
        else:
            env[k] = v
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_bytes()[-3000:].decode(errors="replace")

    try:
        deadline = time.monotonic() + EXPIRY_S
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}; log tail:\n{tail()}")
            try:
                r = httpx.get(base + "/api/health", timeout=5)
                if r.status_code == 200 and r.json().get("status") == "ok":
                    break
            except httpx.HTTPError:
                continue
        else:
            pytest.fail(f"app copy never reported healthy; log tail:\n{tail()}")
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


@pytest.mark.timeout(600)
def test_wf_signup_verify_keyboard_happy(browser: Browser, app_url: str, mail: Any) -> None:
    owner = new_member(app_url)
    community = new_community(app_url, owner)
    post = new_post(app_url, community["name"], owner, score=3)
    username = fresh("s", 16)
    addr = fresh_email(username)
    password = fresh_password()
    with tab(browser, app_url, size=PHONE, path="/signup") as page:
        page.get_by_role("textbox", name="Email", exact=True).focus()
        page.keyboard.type(addr)
        page.keyboard.press("Tab")
        expect(page.get_by_role("textbox", name="Username", exact=True)).to_be_focused()
        page.keyboard.type(username)
        page.keyboard.press("Tab")
        expect(page.get_by_label("Password", exact=True)).to_be_focused()
        page.keyboard.type(password)
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name="Check your inbox", exact=True)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_text(f"We sent a confirmation link to {addr}.", exact=True).first).to_be_visible()
        me = page.request.get(app_url + "/api/me").json()
        assert me["emailVerified"] is False and me["username"] == username

        page.goto(app_url + post["url"])
        up = page.get_by_role("button", name="Upvote", exact=True)
        up.focus()
        page.keyboard.press("Enter")
        announced(page, "Verify your email to vote")
        expect(up).to_have_attribute("aria-pressed", "false")
        expect(by_id(page, f"score-post-{post['id']}")).to_have_text("3")
        assert votes_of(me["id"], "post", post["id"]) == [], "an unverified vote must store nothing"

        message = wait_mail(mail, addr, "Confirm your Moothall email")[0]
        page.goto(app_url + token_path(text(message), "/verify"))
        expect(page.get_by_role("heading", name="Email confirmed", exact=True)).to_be_visible(timeout=UI_MS)

        page.goto(app_url + post["url"])
        up = page.get_by_role("button", name="Upvote", exact=True)
        up.focus()
        page.keyboard.press("Enter")
        expect(up).to_have_attribute("aria-pressed", "true")
        expect(by_id(page, f"score-post-{post['id']}")).to_have_text("4")
        announced(page, "Upvoted. Score 4")
    assert votes_of(me["id"], "post", post["id"]) == [1]
    assert int(post_row(post["id"])["score"]) == 4


@pytest.mark.timeout(600)
def test_wf_signup_verify_invalid_recovery(browser: Browser, app_url: str, mail: Any) -> None:
    taken = new_member(app_url)
    username = fresh("s", 16)
    addr = fresh_email(username)
    with tab(browser, app_url, size=PHONE, path="/signup") as page:
        email_box = page.get_by_role("textbox", name="Email", exact=True)
        user_box = page.get_by_role("textbox", name="Username", exact=True)
        pass_box = page.get_by_label("Password", exact=True)
        email_box.fill("not-an-email")
        user_box.fill("ab")
        pass_box.fill("short")
        pass_box.press("Enter")
        field_error(email_box, "Enter a valid email address")
        field_error(user_box, "Usernames are 3 to 20 letters, digits, underscores or hyphens")
        field_error(pass_box, "Passwords are 10 to 128 characters")
        expect(email_box).to_be_focused()

        email_box.fill(addr)
        pass_box.fill(fresh_password())
        user_box.fill(taken.username.upper())
        pass_box.press("Enter")
        field_error(user_box, "That username is taken")
        expect(user_box).to_be_focused()
        expect(email_box).not_to_have_attribute("aria-invalid", "true")

        user_box.fill(username)
        user_box.press("Enter")
        expect(page.get_by_role("heading", name="Check your inbox", exact=True)).to_be_visible(timeout=UI_MS)
    wait_mail(mail, addr, "Confirm your Moothall email")
    assert len(mails_for(mail, addr, "Confirm your Moothall email")) == 1
    assert visitor(app_url).get(f"/api/users/{username}").status_code == 200


@pytest.mark.timeout(600)
def test_wf_signup_verify_resend(browser: Browser, app_url: str, mail: Any) -> None:
    username = fresh("s", 16)
    addr = fresh_email(username)
    with tab(browser, app_url, size=PHONE, path="/signup") as page:
        page.get_by_role("textbox", name="Email", exact=True).fill(addr)
        page.get_by_role("textbox", name="Username", exact=True).fill(username)
        page.get_by_label("Password", exact=True).fill(fresh_password())
        page.get_by_role("button", name="Create account", exact=True).click()
        expect(page.get_by_role("heading", name="Check your inbox", exact=True)).to_be_visible(timeout=UI_MS)
        first = token_path(text(wait_mail(mail, addr, "Confirm your Moothall email")[0]), "/verify")
        page.get_by_role("button", name="Resend email", exact=True).first.click()
        announced(page, "Confirmation email sent")
        paths = {token_path(text(m), "/verify") for m in wait_mail(mail, addr, "Confirm your Moothall email", 2)}
        newest = next(p for p in paths if p != first)

        page.goto(app_url + "/")
        expect(page.get_by_text("Confirm your email address to vote, post and reply.", exact=True).first).to_be_visible()
        page.goto(app_url + first)
        expect(page.get_by_role("heading", name="This link has expired or was already used", exact=True)).to_be_visible(
            timeout=UI_MS)
        page.goto(app_url + newest)
        expect(page.get_by_role("heading", name="Email confirmed", exact=True)).to_be_visible(timeout=UI_MS)
        assert page.request.get(app_url + "/api/me").json()["emailVerified"] is True


@pytest.mark.timeout(600)
def test_wf_signup_verify_both_taken_focus(browser: Browser, app_url: str, mail: Any) -> None:
    taken = new_member(app_url)
    username = fresh("s", 16)
    addr = fresh_email(username)
    with tab(browser, app_url, size=PHONE, path="/signup") as page:
        email_box = page.get_by_role("textbox", name="Email", exact=True)
        user_box = page.get_by_role("textbox", name="Username", exact=True)
        pass_box = page.get_by_label("Password", exact=True)
        email_box.fill(taken.email)
        user_box.fill(taken.username)
        pass_box.fill(fresh_password())
        pass_box.press("Enter")
        field_error(email_box, "That email is already registered")
        field_error(user_box, "That username is taken")
        expect(email_box).to_be_focused(timeout=UI_MS)
        expect(pass_box).not_to_have_attribute("aria-invalid", "true")

        email_box.fill(addr)
        user_box.fill(username)
        user_box.press("Enter")
        expect(page.get_by_role("heading", name="Check your inbox", exact=True)).to_be_visible(timeout=UI_MS)
    wait_mail(mail, addr, "Confirm your Moothall email")
    assert visitor(app_url).get(f"/api/users/{username}").status_code == 200


@pytest.mark.timeout(600)
def test_wf_signup_verify_resend_limit_announced(browser: Browser, app_url: str, mail: Any) -> None:
    username = fresh("s", 16)
    addr = fresh_email(username)
    subject = "Confirm your Moothall email"
    with tab(browser, app_url, size=PHONE, path="/signup") as page:
        page.get_by_role("textbox", name="Email", exact=True).fill(addr)
        page.get_by_role("textbox", name="Username", exact=True).fill(username)
        page.get_by_label("Password", exact=True).fill(fresh_password())
        page.get_by_role("button", name="Create account", exact=True).click()
        expect(page.get_by_role("heading", name="Check your inbox", exact=True)).to_be_visible(timeout=UI_MS)
        wait_mail(mail, addr, subject)
        resend = page.get_by_role("button", name="Resend email", exact=True).first
        for n in range(2, VERIFY_RESEND_LIMIT + 1):
            resend.click()
            announced(page, "Confirmation email sent")
            wait_mail(mail, addr, subject, n)
        resend.click()
        announced(page, "Too many emails sent — try again later")
    assert len(mails_for(mail, addr, subject)) == VERIFY_RESEND_LIMIT, "a refused resend must send nothing"


def test_signup_validation_and_conflicts(app_url: str) -> None:
    cases = [
        ("email", {"email": "no-at-sign.example.test"}, "Enter a valid email address"),
        ("email", {"email": "@example.test"}, "Enter a valid email address"),
        ("email", {"email": "someone@localhost"}, "Enter a valid email address"),
        ("username", {"username": "ab"}, "Usernames are 3 to 20 letters, digits, underscores or hyphens"),
        ("username", {"username": "u" * (USERNAME_MAX + 1)}, "Usernames are 3 to 20 letters, digits, underscores or hyphens"),
        ("username", {"username": "bad name"}, "Usernames are 3 to 20 letters, digits, underscores or hyphens"),
        ("password", {"password": "p" * (PASSWORD_MIN - 1)}, "Passwords are 10 to 128 characters"),
        ("password", {"password": "p" * (PASSWORD_MAX + 1)}, "Passwords are 10 to 128 characters"),
    ]
    for field, change, copy in cases:
        username = fresh("v", 16)
        body = {"email": fresh_email(username), "username": username, "password": fresh_password(), **change}
        r = visitor(app_url).post("/api/auth/signup", json=body)
        expect_error(r, 422, "VALIDATION", f"sign-up with a bad {field}", {field: copy})
        if field != "username":
            assert visitor(app_url).get(f"/api/users/{username}").status_code == 404, "refused sign-up stored a user"

    username = fresh("v", USERNAME_MAX)
    assert len(username) == USERNAME_MAX
    addr = fresh_email(username)
    client = visitor(app_url)
    r = client.post("/api/auth/signup", json={"email": "  " + addr.upper() + "  ", "username": username,
                                              "password": "p" * PASSWORD_MIN})
    account = expect_status(r, 201, "valid sign-up at the length limits")
    assert set(account) == OWN_ACCOUNT_KEYS
    assert account["email"].lower() == addr and account["emailVerified"] is False
    assert account["totpEnabled"] is False and account["role"] == "user" and account["username"] == username
    assert session_cookie_ok(r.headers.get("set-cookie", ""))
    assert [c.path for c in client.cookies.jar if c.name == COOKIE_NAME] == ["/"]
    assert expect_status(client.get("/api/me"), 200, "session after sign-up")["username"] == username

    other = fresh("v", 16)
    r = visitor(app_url).post("/api/auth/signup", json={"email": addr, "username": other,
                                                        "password": "p" * PASSWORD_MAX})
    expect_error(r, 409, "NAME_TAKEN", "email taken in another case", {"email": "That email is already registered"})
    r = visitor(app_url).post("/api/auth/signup", json={"email": fresh_email(other), "username": username.upper(),
                                                        "password": fresh_password()})
    expect_error(r, 409, "NAME_TAKEN", "username taken in another case", {"username": "That username is taken"})
    r = visitor(app_url).post("/api/auth/signup", json={"email": addr, "username": username.lower(),
                                                        "password": fresh_password()})
    expect_error(r, 409, "NAME_TAKEN", "both taken", {"username": "That username is taken",
                                                      "email": "That email is already registered"})
    assert visitor(app_url).get(f"/api/users/{other}").status_code == 404


def test_unverified_gate_and_verification(app_url: str, mail: Any) -> None:
    owner = new_member(app_url)
    community = new_community(app_url, owner)
    name = community["name"]
    post = new_post(app_url, name, owner, score=5)
    username = fresh("v", 16)
    addr = fresh_email(username)
    client = visitor(app_url)
    me = expect_status(client.post("/api/auth/signup", json={"email": addr, "username": username,
                                                             "password": fresh_password()}), 201, "sign-up")
    message = wait_mail(mail, addr, "Confirm your Moothall email")[0]
    assert [a.lower() for a in addresses(message.get("To"))] == [addr]
    body = text(message)
    assert re.search(r"https?://\S+/verify\?token=", body), "verification link must be absolute"
    token = token_of(token_path(body, "/verify"))

    expect_error(client.put(f"/api/posts/{post['id']}/vote", json={"value": 1}), 403, "EMAIL_UNVERIFIED", "vote")
    assert votes_of(me["id"], "post", post["id"]) == []
    joined = expect_status(client.put(f"/api/communities/{name}/membership"), 200, "unverified join")
    assert joined["joined"] is True
    title = "Unverified " + fresh("t", 12)
    r = client.post(f"/api/communities/{name}/posts", json={"title": title},
                    headers={"Idempotency-Key": idempotency_key()})
    expect_error(r, 403, "EMAIL_UNVERIFIED", "post")
    assert posts_titled(visitor(app_url), username, title) == []
    r = client.post(f"/api/posts/{post['id']}/comments", json={"bodyMd": "hello", "parentId": None},
                    headers={"Idempotency-Key": idempotency_key()})
    expect_error(r, 403, "EMAIL_UNVERIFIED", "reply")
    assert int(post_row(post["id"])["comment_count"]) == 0
    r = client.post("/api/communities", json={"name": fresh("c", 15), "title": "T", "description": "",
                                              "type": "public"})
    expect_error(r, 403, "EMAIL_UNVERIFIED", "create community")

    expect_error(client.post("/api/auth/verify", json={"token": token + "x"}), 422, "VALIDATION", "bad token",
                 {"token": None})
    assert expect_status(client.post("/api/auth/verify", json={"token": token}), 200, "verify") == {
        "emailVerified": True}
    expect_error(client.post("/api/auth/verify", json={"token": token}), 422, "VALIDATION", "reused token",
                 {"token": None})
    assert client.get("/api/me").json()["emailVerified"] is True
    assert expect_status(client.put(f"/api/posts/{post['id']}/vote", json={"value": 1}), 200, "verified vote")[
        "score"] == 6
    assert votes_of(me["id"], "post", post["id"]) == [1]


def test_verify_resend_limit(app_url: str, mail: Any) -> None:
    username = fresh("v", 16)
    addr = fresh_email(username)
    client = visitor(app_url)
    expect_status(client.post("/api/auth/signup", json={"email": addr, "username": username,
                                                        "password": fresh_password()}), 201, "sign-up")
    subject = "Confirm your Moothall email"
    tokens = [token_of(token_path(text(wait_mail(mail, addr, subject)[0]), "/verify"))]
    for n in range(2, VERIFY_RESEND_LIMIT + 1):
        assert expect_status(client.post("/api/auth/verify/resend"), 202, "resend") == {"sent": True}
        seen = {token_of(token_path(text(m), "/verify")) for m in wait_mail(mail, addr, subject, n)}
        tokens.append(next(t for t in seen if t not in tokens))
    r = client.post("/api/auth/verify/resend")
    error = expect_error(r, 429, "RATE_LIMITED", "resend over the limit")
    assert int(r.headers["retry-after"]) >= 1 and error["retryAfter"] == int(r.headers["retry-after"])
    assert len(mails_for(mail, addr, subject)) == VERIFY_RESEND_LIMIT, "a refused resend must send nothing"
    for old in tokens[:-1]:
        expect_error(client.post("/api/auth/verify", json={"token": old}), 422, "VALIDATION", "superseded link",
                     {"token": None})
    expect_status(client.post("/api/auth/verify", json={"token": tokens[-1]}), 200, "newest link")

    second = fresh("v", 16)
    second_addr = fresh_email(second)
    other = visitor(app_url)
    expect_status(other.post("/api/auth/signup", json={"email": second_addr, "username": second,
                                                       "password": fresh_password()}), 201, "sign-up")
    token = token_of(token_path(text(wait_mail(mail, second_addr, subject)[0]), "/verify"))
    expect_status(other.post("/api/auth/verify", json={"token": token}), 200, "verify")
    expect_error(other.post("/api/auth/verify/resend"), 409, "CONFLICT", "resend when verified")
    assert len(mails_for(mail, second_addr, subject)) == 1


def test_verify_link_expiry(mail: Any) -> None:
    base = short_url()
    username = fresh("v", 16)
    addr = fresh_email(username)
    client = visitor(base)
    r = client.post("/api/auth/signup", json={"email": addr, "username": username, "password": fresh_password()})
    expect_status(r, 201, "short-instance sign-up")
    token = token_of(token_path(text(wait_mail(mail, addr, "Confirm your Moothall email")[0]), "/verify"))
    wait_server_past(base, response_time(r) + timedelta(seconds=SHORT_VERIFY_TTL_S), "verification link expiry")
    expect_error(client.post("/api/auth/verify", json={"token": token}), 422, "VALIDATION", "expired link",
                 {"token": None})
    assert client.get("/api/me").json()["emailVerified"] is False


@pytest.mark.timeout(600)
def test_wf_vote_score_keyboard_across_tabs(browser: Browser, app_url: str) -> None:
    voter, watcher = new_member(app_url), new_member(app_url)
    community = new_community(app_url, voter, members=(watcher,))
    name = community["name"]
    post = new_post(app_url, name, voter, score=7)
    big = new_post(app_url, name, voter, score=BIG_SCORE)
    neg = new_post(app_url, name, voter, score=NEG_SCORE)
    pid = post["id"]
    with tab(browser, app_url, watcher, DESKTOP, post["url"]) as other, \
            tab(browser, app_url, voter, DESKTOP, "/") as page:
        live_ready(other)
        other_score = by_id(other, f"score-post-{pid}")
        card = by_id(page, f"post-{pid}")
        score = by_id(page, f"score-post-{pid}")
        up = card.get_by_role("button", name="Upvote", exact=True)
        down = card.get_by_role("button", name="Downvote", exact=True)
        expect(score).to_have_text("7", timeout=UI_MS)
        expect(by_id(page, f"score-post-{big['id']}")).to_have_text("12.3k")
        expect(by_id(page, f"score-post-{neg['id']}")).to_have_text("-15.0k")

        steps = [
            (lambda: (card.focus(), page.keyboard.press("a")), "true", "false", 8, "Upvoted. Score 8"),
            (lambda: (card.focus(), page.keyboard.press("z")), "false", "true", 6, "Downvoted. Score 6"),
            (lambda: down.click(), "false", "false", 7, "Vote removed. Score 7"),
            (lambda: (up.focus(), page.keyboard.press("Enter")), "true", "false", 8, "Upvoted. Score 8"),
            (lambda: (up.focus(), page.keyboard.press("Space")), "false", "false", 7, "Vote removed. Score 7"),
            (lambda: (down.focus(), page.keyboard.press("Enter")), "false", "true", 6, "Downvoted. Score 6"),
        ]
        for act, up_state, down_state, value, copy in steps:
            act()
            expect(up).to_have_attribute("aria-pressed", up_state)
            expect(down).to_have_attribute("aria-pressed", down_state)
            expect(score).to_have_text(str(value))
            announced(page, copy)
            expect(other_score).to_have_text(str(value), timeout=LIVE_MS)

        page.reload()
        card = by_id(page, f"post-{pid}")
        expect(card.get_by_role("button", name="Downvote", exact=True)).to_have_attribute("aria-pressed", "true",
                                                                                          timeout=UI_MS)
        expect(by_id(page, f"score-post-{pid}")).to_have_text("6")
        page.goto(app_url + f"/c/{name}")
        expect(by_id(page, f"score-post-{pid}")).to_have_text("6", timeout=UI_MS)
        page.goto(app_url + post["url"])
        expect(by_id(page, f"score-post-{pid}")).to_have_text("6", timeout=UI_MS)
    body = expect_status(voter.get(f"/api/posts/{pid}"), 200, "read post")
    assert body["score"] == 6 and body["myVote"] == -1
    assert votes_of(voter.id, "post", pid) == [-1]
    assert int(post_row(pid)["score"]) == 6


@pytest.mark.timeout(600)
def test_wf_vote_score_rate_limit_rollback(browser: Browser) -> None:
    base = short_url()
    voter = new_member(base)
    community = new_community(base, voter)
    post = new_post(base, community["name"], voter, score=0)
    pid = post["id"]
    for value in (1, 0, 1, 0, 0)[:SHORT_VOTE_LIMIT]:
        expect_status(cast(voter, "posts", pid, value), 200, "vote inside the limit")
    with tab(browser, base, voter, DESKTOP, post["url"]) as page:
        up = page.get_by_role("button", name="Upvote", exact=True)
        expect(by_id(page, f"score-post-{pid}")).to_have_text("0", timeout=UI_MS)
        up.click()
        announced(page, re.compile(r"Slow down — try again in \d+ s"))
        expect(up).to_have_attribute("aria-pressed", "false")
        expect(by_id(page, f"score-post-{pid}")).to_have_text("0")
    assert votes_of(voter.id, "post", pid, "_short") == []
    assert int(post_row(pid, "_short")["score"]) == 0


def test_wf_vote_score_signed_out_prompt(browser: Browser, app_url: str) -> None:
    owner = new_member(app_url)
    community = new_community(app_url, owner)
    post = new_post(app_url, community["name"], owner, score=2)
    sent: list[str] = []
    with tab(browser, app_url, None, DESKTOP, post["url"]) as page:
        page.on("request", lambda req: sent.append(req.url) if req.method == "PUT" else None)
        up = page.get_by_role("button", name="Upvote", exact=True)
        up.click()
        announced(page, "Sign in to vote")
        expect(up).to_have_attribute("aria-pressed", "false")
        expect(by_id(page, f"score-post-{post['id']}")).to_have_text("2")
    assert not [u for u in sent if "/vote" in u], f"a signed-out press sent {sent}"
    assert visitor(app_url).get(f"/api/posts/{post['id']}").json()["score"] == 2


def test_vote_rows_and_arithmetic(app_url: str) -> None:
    owner, voter = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(voter,))
    name = community["name"]
    post = new_post(app_url, name, owner, score=7)
    pid = post["id"]
    created = parse_time(voter.get(f"/api/posts/{pid}").json()["createdAt"])
    assert abs(post["hotRank"] - hot_rank(7, created)) < HOT_TOL

    def check(score: int, mine: int, rows: list[int]) -> None:
        body = voter.get(f"/api/posts/{pid}").json()
        assert (body["score"], body["myVote"]) == (score, mine)
        row = post_row(pid)
        assert int(row["score"]) == score
        assert abs(float(row["hot_rank"]) - hot_rank(score, created)) < HOT_TOL
        assert votes_of(voter.id, "post", pid) == rows

    first = expect_status(cast(voter, "posts", pid, 1), 200, "upvote")
    assert first == {"score": 8, "myVote": 1}
    check(8, 1, [1])
    assert expect_status(cast(voter, "posts", pid, 1), 200, "repeat") == first
    check(8, 1, [1])
    assert expect_status(cast(voter, "posts", pid, -1), 200, "switch") == {"score": 6, "myVote": -1}
    check(6, -1, [-1])
    assert expect_status(cast(voter, "posts", pid, 0), 200, "undo") == {"score": 7, "myVote": 0}
    check(7, 0, [])

    cid = comment_id(owner, pid, "A comment to vote on.")
    assert expect_status(cast(voter, "comments", cid, -1), 200, "comment downvote") == {"score": -1, "myVote": -1}
    assert expect_status(cast(voter, "comments", cid, 1), 200, "comment switch") == {"score": 1, "myVote": 1}
    assert votes_of(voter.id, "comment", cid) == [1]
    tree = voter.get(f"/api/posts/{pid}/comments").json()["tree"]
    assert next(c for c in flat(tree) if str(c["id"]) == cid)["score"] == 1

    expect_error(cast(voter, "posts", pid, 2), 422, "VALIDATION", "value 2", {"value": None})
    expect_error(cast(voter, "posts", PROBE_ID, 1), 404, "NOT_FOUND", "unknown post")
    removed = new_post(app_url, name, owner)
    expect_status(mod_action(owner, "POST", removed["id"], "removal", reason="spam"), 200, "remove")
    expect_error(cast(voter, "posts", removed["id"], 1), 409, "REMOVED", "vote on removed")
    deleted = new_post(app_url, name, owner)
    expect_status(owner.req("DELETE", f"/api/posts/{deleted['id']}"), 200, "delete")
    expect_error(cast(voter, "posts", deleted["id"], 1), 409, "CONFLICT", "vote on deleted")
    archived = new_post(app_url, name, owner, created=server_now(app_url) - timedelta(days=ARCHIVE_DAYS + 1))
    expect_error(cast(voter, "posts", archived["id"], 1), 409, "ARCHIVED", "vote on archived")
    for target in (removed, deleted, archived):
        assert votes_of(voter.id, "post", target["id"]) == []


def test_vote_concurrency(app_url: str) -> None:
    owner = new_member(app_url)
    voters = [new_member(app_url) for _ in range(8)]
    community = new_community(app_url, owner, members=tuple(voters))
    one = new_post(app_url, community["name"], owner, score=0)
    responses = together([lambda m=voters[0].clone(): cast(m, "posts", one["id"], 1) for _ in range(10)])
    assert all(r.status_code == 200 for r in responses), [r.status_code for r in responses]
    assert votes_of(voters[0].id, "post", one["id"]) == [1]
    assert int(post_row(one["id"])["score"]) == 1
    many = new_post(app_url, community["name"], owner, score=0)
    responses = together([lambda m=v.clone(): cast(m, "posts", many["id"], 1) for v in voters])
    assert all(r.status_code == 200 for r in responses)
    assert int(post_row(many["id"])["score"]) == len(voters)
    assert visitor(app_url).get(f"/api/posts/{many['id']}").json()["score"] == len(voters)


def test_vote_rate_limit(valkey: Any) -> None:
    base = short_url()
    voter, other = new_member(base), new_member(base)
    community = new_community(base, voter, members=(other,))
    post = new_post(base, community["name"], voter, score=0)
    pid = post["id"]
    for value in (1, 1, 0, 1, -1)[:SHORT_VOTE_LIMIT]:
        expect_status(cast(voter, "posts", pid, value), 200, "vote inside the limit")
    r = cast(voter, "posts", pid, 0)
    error = expect_error(r, 429, "RATE_LIMITED", "vote over the limit")
    retry = int(r.headers["retry-after"])
    assert 1 <= retry <= RATE_WINDOW_S and error["retryAfter"] == retry
    assert votes_of(voter.id, "post", pid, "_short") == [-1]
    assert int(post_row(pid, "_short")["score"]) == -1
    key = f"short:rl:vote:{voter.id}"
    assert key in valkey.keys(f"short:rl:vote:{voter.id}*"), "the vote counter must live in Valkey"
    assert 0 < valkey.ttl(key) <= RATE_WINDOW_S
    expect_status(cast(other, "posts", pid, 1), 200, "another member is not limited")


@pytest.mark.timeout(600)
def test_wf_home_feed_sort_and_paging(browser: Browser, app_url: str) -> None:
    owner, reader = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(reader,))
    now = server_now(app_url)
    posts = [new_post(app_url, community["name"], owner, score=(i * 7) % 13,
                      created=now - timedelta(minutes=5 * (i + 1))) for i in range(FEED_POSTS)]
    removed = posts[3]["id"]
    expect_status(mod_action(owner, "POST", removed, "removal", reason="spam"), 200, "remove")

    def api(sort: str) -> list[str]:
        return [str(p["id"]) for pg_ in walk_pages(reader, f"/api/feed?sort={sort}") for p in pg_["items"]]

    with tab(browser, app_url, reader, DESKTOP, "/") as page:
        tabs = {n: page.get_by_role("tab", name=n, exact=True) for n in ("Hot", "New", "Top")}
        expect(tabs["Hot"]).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        hot = api("hot")
        eventually(lambda: card_ids(page) == hot[:PAGE_SIZE], "home Hot cards follow GET /api/feed?sort=hot")
        tabs["Hot"].focus()
        for key, label, sort in (("ArrowRight", "New", "new"), ("End", "Top", "top"), ("Home", "Hot", "hot"),
                                 ("End", "Top", "top")):
            page.keyboard.press(key)
            expect(tabs[label]).to_have_attribute("aria-selected", "true")
            expect(page).to_have_url(re.compile(rf"[?&]sort={sort}"))
            expected = api(sort)
            eventually(lambda e=expected: card_ids(page) == e[:PAGE_SIZE], f"{label} cards follow the API order")
        top = api("top")
        assert removed not in top and len(top) == FEED_POSTS - 1
        more = page.get_by_role("button", name="Load more posts", exact=True)
        more.focus()
        page.keyboard.press("Enter")
        eventually(lambda: card_ids(page) == top, "Load more appends the second page")
        expect(by_id(page, f"post-{top[PAGE_SIZE]}")).to_be_focused()
        expect(page.get_by_text("You've reached the end", exact=True)).to_be_visible()
        assert removed not in card_ids(page)
        page.keyboard.press("k")
        expect(by_id(page, f"post-{top[PAGE_SIZE - 1]}")).to_be_focused()
        page.keyboard.press("j")
        page.keyboard.press("j")
        expect(by_id(page, f"post-{top[PAGE_SIZE + 1]}")).to_be_focused()
        page.keyboard.press("Enter")
        page.wait_for_url(re.compile(rf"/post/{top[PAGE_SIZE + 1]}$"), timeout=UI_MS)


@pytest.mark.timeout(600)
def test_wf_home_feed_counts_agree(browser: Browser, app_url: str) -> None:
    owner, reader, writer = new_member(app_url), new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(reader, writer))
    post = new_post(app_url, community["name"], owner, score=4)
    pid = post["id"]
    ids = [comment_id(writer, pid, f"Comment number {i}.") for i in range(3)]
    with tab(browser, app_url, reader, DESKTOP, "/") as home:
        counter = by_id(home, f"comments-post-{pid}")
        expect(counter).to_have_text("3 comments", timeout=UI_MS)
        live_ready(home)
        for path in (f"/c/{community['name']}", post["url"]):
            with tab(browser, app_url, reader, DESKTOP, path) as other:
                expect(by_id(other, f"comments-post-{pid}")).to_have_text("3 comments", timeout=UI_MS)
                expect(by_id(other, f"score-post-{pid}")).to_have_text("4")
        expect_status(writer.req("DELETE", f"/api/comments/{ids[0]}"), 200, "delete comment")
        expect(counter).to_have_text("2 comments", timeout=LIVE_MS)
        expect_status(writer.req("DELETE", f"/api/comments/{ids[1]}"), 200, "delete comment")
        expect(counter).to_have_text("1 comment", timeout=LIVE_MS)
        comment_id(writer, pid, "One more comment.")
        expect(counter).to_have_text("2 comments", timeout=LIVE_MS)
    assert reader.get(f"/api/posts/{pid}").json()["commentCount"] == 2
    assert int(post_row(pid)["comment_count"]) == 2


def test_wf_home_feed_url_sort_and_empty(browser: Browser, app_url: str) -> None:
    owner, reader = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(reader,))
    for score in (1, 9, 4):
        new_post(app_url, community["name"], owner, score=score)
    top = [str(p["id"]) for p in reader.get(f"/api/feed?sort={SORT_TOP}").json()["items"]]
    with tab(browser, app_url, reader, DESKTOP, f"/?sort={SORT_TOP}") as page:
        expect(page.get_by_role("tab", name="Top", exact=True)).to_have_attribute("aria-selected", "true",
                                                                                  timeout=UI_MS)
        eventually(lambda: card_ids(page) == top, "?sort=top opens the Top order")
    lonely = new_member(app_url)
    with tab(browser, app_url, lonely, DESKTOP, "/") as page:
        expect(page.get_by_text("Join a community to fill your home feed", exact=True)).to_be_visible(timeout=UI_MS)
        assert card_ids(page) == []


YIELD_JS = """() => new Promise(done => { const c = new MessageChannel(); c.port1.onmessage = () => done(true);
  c.port2.postMessage(0); })"""


def test_wf_home_feed_empty_copy_every_sort(browser: Browser, app_url: str) -> None:
    owner, lonely = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner)
    new_post(app_url, community["name"], owner, score=3)
    empty = "Join a community to fill your home feed"
    with tab(browser, app_url, lonely, DESKTOP, "/") as page:
        sorts = page.get_by_role("tablist", name="Sort posts", exact=True)
        tabs = {n: sorts.get_by_role("tab", name=n, exact=True) for n in ("Hot", "New", "Top")}
        expect(tabs["Hot"]).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        expect(page.get_by_text(empty, exact=True)).to_be_visible()
        tabs["Hot"].focus()
        for key, label, sort in (("ArrowRight", "New", SORT_NEW), ("End", "Top", SORT_TOP)):
            with page.expect_response(lambda r, s=sort: f"sort={s}" in r.url, timeout=UI_MS) as fetched:
                page.keyboard.press(key)
            fetched.value.finished()
            expect(tabs[label]).to_have_attribute("aria-selected", "true")
            expect(page).to_have_url(re.compile(rf"[?&]sort={sort}"))
            for _ in range(20):
                page.evaluate(YIELD_JS)
            expect(page.get_by_text(empty, exact=True)).to_be_visible(timeout=UI_MS)
            assert card_ids(page) == [], f"{label}: a member with no communities sees cards"
            expect(page.get_by_role("button", name="Load more posts", exact=True)).to_have_count(0)


def decode_cursor(cursor: str) -> list[str]:
    assert "=" not in cursor, "cursor must be base64url without padding"
    return base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode().split("|")


def test_feed_order_and_cursor(app_url: str) -> None:
    owner, reader = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(reader,))
    name = community["name"]
    now = server_now(app_url)
    made = []
    for i in range(FEED_POSTS):
        score = [5, 5, 3, 3, 0, -2][i % 6]
        made.append(new_post(app_url, name, owner, score=score,
                              created=now - timedelta(minutes=10 * (i // 2) + 1)))
    for m in made:
        assert abs(m["hotRank"] - hot_rank(m["score"], m["created"])) < HOT_TOL
    expected = {
        "hot": [m["id"] for m in sorted(made, key=lambda m: (m["hotRank"], int(m["id"])), reverse=True)],
        "new": [m["id"] for m in sorted(made, key=lambda m: (m["created"], int(m["id"])), reverse=True)],
        "top": [m["id"] for m in sorted(made, key=lambda m: (m["score"], int(m["id"])), reverse=True)],
    }
    for sort, order in expected.items():
        for path in (f"/api/feed?sort={sort}", f"/api/communities/{name}/posts?sort={sort}"):
            pages = walk_pages(reader, path)
            assert [str(p["id"]) for pg_ in pages for p in pg_["items"]] == order, f"{path} order"
            assert [len(pg_["items"]) for pg_ in pages] == [PAGE_SIZE, FEED_POSTS - PAGE_SIZE]
            parts = decode_cursor(pages[0]["nextCursor"])
            assert parts[0] == sort and parts[-1] == order[PAGE_SIZE - 1] and len(parts) == 3
            assert pages[-1]["nextCursor"] is None
            if "communities" in path:
                assert pages[0]["pinned"] == []
    assert [str(p["id"]) for p in reader.get("/api/feed").json()["items"]] == expected["hot"][:PAGE_SIZE]
    new_cursor = reader.get(f"/api/feed?sort={SORT_NEW}").json()["nextCursor"]
    for path in ("/api/feed", f"/api/communities/{name}/posts"):
        expect_error(reader.get(f"{path}?sort=bogus"), 422, "VALIDATION", "bad sort", {"sort": "This sort is not valid"})
        expect_error(reader.get(f"{path}?sort=top&cursor={new_cursor}"), 422, "VALIDATION", "cursor of another sort",
                     {"cursor": "This cursor is not valid"})
        expect_error(reader.get(f"{path}?sort=hot&cursor=!!!!"), 422, "VALIDATION", "undecodable cursor",
                     {"cursor": "This cursor is not valid"})

    other = new_community(app_url, owner)
    worked = new_post(app_url, other["name"], owner, score=WORKED_SCORE,
                      created=datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert abs(worked["hotRank"] - WORKED_RANK) < WORKED_TOL
    assert abs(float(post_row(worked["id"])["hot_rank"]) - WORKED_RANK) < WORKED_TOL


def test_feed_moved_post_not_repeated(app_url: str) -> None:
    owner, reader, voter = new_member(app_url), new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(reader, voter))
    name = community["name"]
    now = server_now(app_url)
    for i in range(PAGE_SIZE):
        new_post(app_url, name, owner, score=2, created=now - timedelta(minutes=40 - i))
    mover = new_post(app_url, name, owner, score=1, created=now - timedelta(minutes=1))
    for path in (f"/api/communities/{name}/posts?sort=top", "/api/feed?sort=top"):
        first = expect_status(reader.get(path), 200, path)
        ids = [str(p["id"]) for p in first["items"]]
        assert mover["id"] not in ids and len(ids) == PAGE_SIZE
        expect_status(cast(voter, "posts", mover["id"], 1), 200, "move the post up")
        second = expect_status(reader.get(f"{path}&cursor={first['nextCursor']}"), 200, "second page")
        later = [str(p["id"]) for p in second["items"]]
        assert mover["id"] not in later, "a post moved above the cursor came back on a later page"
        assert not set(ids) & set(later)
        expect_status(cast(voter, "posts", mover["id"], 0), 200, "reset")


def test_projection_keys_by_role(app_url: str) -> None:
    owner, author, other = new_member(app_url), new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(author, other))
    name = community["name"]
    me = expect_status(author.get("/api/me"), 200, "me")
    assert set(me) == OWN_ACCOUNT_KEYS and me["email"].lower() == author.email
    public = expect_status(visitor(app_url).get(f"/api/users/{author.username}"), 200, "public user")
    assert set(public) == PUBLIC_USER_KEYS
    created = expect_status(create_post(author, name, "Keys " + fresh("t", 10), "Body *md*."), 201, "post")
    assert set(created) == POST_KEYS | {"bodyMd"}
    pid = str(created["id"])
    seen_texts: list[str] = []
    for caller, keys in ((visitor(app_url), POST_KEYS), (other.client, POST_KEYS), (owner.client, POST_KEYS),
                         (author.client, POST_KEYS | {"bodyMd"})):
        r = caller.get(f"/api/posts/{pid}")
        body = expect_status(r, 200, "read post")
        assert set(body) == keys, f"post keys {sorted(set(body) ^ keys)}"
        assert set(body["author"]) == PUBLIC_USER_KEYS
        if caller is not author.client:
            seen_texts.append(r.text)
    view = visitor(app_url).get(f"/api/posts/{pid}").json()
    assert view["myVote"] == 0 and view["url"] == f"/c/{name}/post/{pid}" and view["version"] == 1
    assert (view["state"], view["removal"], view["locked"], view["lockedUntil"], view["pinned"], view["archived"]) == (
        "published", None, False, None, False, False)
    feed = visitor(app_url).get(f"/api/communities/{name}/posts?sort=new")
    assert all(set(p) == POST_KEYS for p in feed.json()["items"])
    seen_texts.append(feed.text)

    made = expect_status(add_comment(author, pid, "A keyed comment."), 201, "comment")
    assert set(made) == {"comment", "commentCount"}
    for caller, keys in ((visitor(app_url), COMMENT_KEYS), (owner.client, COMMENT_KEYS),
                         (author.client, COMMENT_KEYS | {"bodyMd"})):
        r = caller.get(f"/api/posts/{pid}/comments")
        nodes = flat(expect_status(r, 200, "tree")["tree"])
        assert nodes and all(set(n) == keys for n in nodes), f"comment keys {[sorted(n) for n in nodes]}"
        if caller is not author.client:
            seen_texts.append(r.text)

    r = visitor(app_url).get(f"/api/communities/{name}")
    com = expect_status(r, 200, "community")
    assert set(com) == COMMUNITY_KEYS and set(com["viewer"]) == VIEWER_KEYS
    assert not any(com["viewer"].values()) and all(set(rule) == RULE_KEYS for rule in com["rules"])
    mine = other.get(f"/api/communities/{name}").json()["viewer"]
    assert mine["joined"] is True and mine["isModerator"] is False and mine["isOwner"] is False
    seen_texts += [r.text, other.get(f"/api/users/{author.username}/posts").text]
    for blob in seen_texts:
        assert author.email not in blob.lower() and owner.email not in blob.lower(), "another member's email leaked"


@pytest.mark.timeout(1200)
def test_wf_image_post_phone_gallery(browser: Browser, app_url: str) -> None:
    author = new_member(app_url)
    community = new_community(app_url, author)
    files = [{"name": f"photo{n}.{ext}", "mimeType": mime, "buffer": picture(fmt, w, h, gps=fmt == "JPEG")}
             for n, (fmt, w, h, mime, ext) in enumerate(GALLERY_SPECS, start=1)]
    alts = [f"Alt {n} {fresh('a', 8)}" for n in range(1, GALLERY_IMAGES + 1)]
    title = "Gallery " + fresh("g", 12)
    last = GALLERY_IMAGES
    with tab(browser, app_url, author, PHONE, f"/c/{community['name']}/submit") as page:
        page.get_by_role("textbox", name="Title", exact=True).fill(title)
        with page.expect_file_chooser() as chooser:
            tap(page.get_by_label("Add images", exact=True))
        chooser.value.set_files(files)
        for n in range(1, last + 1):
            expect(page.get_by_role("group", name=f"Image {n} of {last}", exact=True)).to_be_visible(timeout=UPLOAD_MS)
            expect(by_id(page, f"image-tile-{n}")).not_to_contain_text(f"Uploading image {n}", timeout=UPLOAD_MS)
            page.get_by_role("textbox", name=f"Alt text for image {n}", exact=True).fill(alts[n - 1])
        first_tile, second_tile = 1, 2
        expect(page.get_by_role("button", name=f"Move image {first_tile} up", exact=True)).to_have_attribute(
            "aria-disabled", "true")
        expect(page.get_by_role("button", name=f"Move image {last} down", exact=True)).to_have_attribute(
            "aria-disabled", "true")
        page.get_by_role("button", name=f"Move image {first_tile} down", exact=True).focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name=f"Move image {second_tile} down", exact=True)).to_be_focused()
        page.get_by_role("button", name=f"Move image {last} up", exact=True).focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name=f"Move image {last - 1} up", exact=True)).to_be_focused()
        order = [1, 0, 2, 3, 5, 4]
        for n, index in enumerate(order, start=1):
            expect(page.get_by_role("textbox", name=f"Alt text for image {n}", exact=True)).to_have_value(alts[index])
        check(page.get_by_role("checkbox", name="Spoiler", exact=True))
        page.get_by_role("button", name="Post", exact=True).focus()
        page.keyboard.press("Enter")
        page.keyboard.press("Enter")
        page.wait_for_url(re.compile(r"/c/[^/]+/post/\d+$"), timeout=UI_MS)
        post_url = page.url

    created = posts_titled(author, author.username, title)
    assert len(created) == 1, f"pressing Post twice created {len(created)} posts"
    post = created[0]
    assert post["spoiler"] is True and [i["alt"] for i in post["images"]] == [alts[i] for i in order]
    for f in files:
        sha = hashlib.sha256(f["buffer"]).hexdigest()
        assert image_keys(sha) <= set(s3().keys(f"images/{sha}/")), f"storage lacks the variants of {f['name']}"

    with tab(browser, app_url, None, PHONE, post_url.split(app_url, 1)[-1]) as reader:
        region = reader.get_by_role("region", name="Images", exact=True)
        show = reader.get_by_role("button", name="Show spoiler", exact=True).first
        expect(show).to_be_visible(timeout=UI_MS)
        eventually(lambda: region.evaluate(VISIBLE_IMAGES_LOADED_JS), "gallery image loaded")
        blurred = decode(capture(region))
        tap(show)
        eventually(lambda: region.evaluate(VISIBLE_IMAGES_LOADED_JS), "revealed image loaded")
        sharp = decode(capture(region))
        changed(blurred, sharp)
        assert sharp.variance() > blurred.variance(), "the spoiler image was not blurred before Show spoiler"
        counter = by_id(reader, "gallery-counter")
        expect(counter).to_have_text(f"Image 1 of {last}")
        swipe_left(reader, region)
        expect(counter).to_have_text(f"Image 2 of {last}")
        region.focus()
        reader.keyboard.press("ArrowRight")
        expect(counter).to_have_text(f"Image 3 of {last}")
        reader.keyboard.press("ArrowLeft")
        expect(counter).to_have_text(f"Image 2 of {last}")
        reader.get_by_role("button", name="Next image", exact=True).click()
        expect(counter).to_have_text(f"Image 3 of {last}")
        reader.get_by_role("button", name="Previous image", exact=True).click()
        expect(counter).to_have_text(f"Image 2 of {last}")


def test_wf_image_post_alt_fallback(browser: Browser, app_url: str) -> None:
    author = new_member(app_url)
    community = new_community(app_url, author)
    ids = []
    for fmt, w, h, mime, ext in GALLERY_SPECS[1:3]:
        ids.append(str(expect_status(upload(author, picture(fmt, w, h), f"x.{ext}", mime), 201, "upload")["id"]))
    title = "Fallback " + fresh("t", 10)
    post = expect_status(create_post(author, community["name"], title, images=[{"id": i, "alt": ""} for i in ids]),
                         201, "image post")
    assert [i["alt"] for i in post["images"]] == [None, None]
    with tab(browser, app_url, None, DESKTOP, post["url"]) as page:
        one, two, total = 1, 2, len(ids)
        first = page.get_by_role("img", name=f"Image {one} of {total} posted by {author.username}", exact=True)
        expect(first).to_be_visible(timeout=UI_MS)
        srcset = first.get_attribute("srcset") or ""
        for entry in post["images"][0]["srcset"].split(", "):
            assert entry in srcset, f"rendered srcset {srcset!r} lacks {entry!r}"
        page.get_by_role("button", name="Next image", exact=True).click()
        expect(page.get_by_role("img", name=f"Image {two} of {total} posted by {author.username}",
                                exact=True)).to_be_visible()
        expect(by_id(page, "gallery-counter")).to_have_text(f"Image {two} of {total}")


@pytest.mark.timeout(900)
def test_image_processing_variants(app_url: str) -> None:
    owner, stranger = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner)
    specs = [("JPEG", 2400, 1600, "image/jpeg", "a.jpg", True), ("PNG", 1200, 800, "image/png", "b.png", False),
             ("WEBP", 800, 600, "image/webp", "c.webp", False), ("PNG", 300, 200, "image/png", "d.png", False)]
    from PIL import Image
    uploaded = []
    for fmt, w, h, mime, filename, gps in specs:
        data = picture(fmt, w, h, gps=gps)
        image = expect_status(upload(owner, data, filename, mime), 201, f"upload {filename}")
        iid = str(image["id"])
        assert set(image) == IMAGE_KEYS and image["alt"] is None
        assert (image["width"], image["height"]) == (w, h)
        assert image["src"] == f"/media/{iid}/640.webp"
        assert image["srcset"] == srcset_for(iid, w)
        sha = hashlib.sha256(data).hexdigest()
        keys = set(s3().keys(f"images/{sha}/"))
        assert image_keys(sha) <= keys
        for key in image_keys(sha):
            blob = s3().get(key)
            chunks = webp_chunks(blob)
            assert b"EXIF" not in chunks and b"XMP " not in chunks, f"{key} keeps metadata"
            decoded = Image.open(BytesIO(blob))
            assert not decoded.getexif(), f"{key} keeps EXIF"
            slot = key.rsplit("/", 1)[1].split(".")[0]
            want = w if slot == "original" else min(int(slot), w)
            assert decoded.size[0] == want and abs(decoded.size[1] - round(want * h / w)) <= 1
        uploaded.append(iid)
        again = expect_status(upload(owner, data, filename, mime), 201, "same file again")
        assert set(s3().keys(f"images/{sha}/")) == keys and again["srcset"] == srcset_for(str(again["id"]), w)

    first = uploaded[0]
    r = owner.get(f"/media/{first}/640.webp")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/webp") and r.content[:4] == b"RIFF"
    assert visitor(app_url).get(f"/media/{first}/640.webp").status_code == 404
    assert stranger.get(f"/media/{first}/640.webp").status_code == 404
    assert owner.get(f"/media/{first}/500.webp").status_code == 404
    expect_status(create_post(owner, community["name"], "Media " + fresh("t", 8), images=[{"id": first, "alt": "x"}]),
                  201, "attach")
    for slot in MEDIA_SLOTS:
        assert visitor(app_url).get(f"/media/{first}/{slot}.webp").status_code == 200
    assert visitor(app_url).get(f"/media/{first}/original.webp").status_code == 404


@pytest.mark.timeout(900)
def test_image_upload_limits(app_url: str) -> None:
    member = new_member(app_url)
    expect_status(upload(member, png_bytes(64, 48), "notes.txt", "text/plain"), 201, "PNG named .txt")
    for data, filename, mime in ((b"hello, this is text", "pic.png", "image/png"),
                                 (b"GIF89a\x01\x00\x01\x00\x00\x00\x00;", "pic.gif", "image/gif")):
        expect_error(upload(member, data, filename, mime), 422, "VALIDATION", f"sniffed {filename}",
                     {"file": "Use a JPEG, PNG or WebP image"})
    expect_status(upload(member, png_bytes(16, 16, MAX_IMAGE_BYTES), "max.png", "image/png"), 201, "exactly max bytes")
    expect_error(upload(member, png_bytes(16, 16, MAX_IMAGE_BYTES + 1), "over.png", "image/png"), 413, "VALIDATION",
                 "one byte over", {"file": "This image is too large"})
    height = MAX_PIXELS // PIXEL_SIDE
    expect_status(upload(member, png_bytes(PIXEL_SIDE, height), "edge.png", "image/png"), 201, "exactly 50 MP")
    expect_error(upload(member, png_bytes(PIXEL_SIDE + 1, height), "huge.png", "image/png"), 422, "VALIDATION",
                 "over 50 MP", {"file": "Images can be at most 50 megapixels"})


def test_image_post_storage_confirmation(app_url: str) -> None:
    down = storage_down_url()
    owner, stranger = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(stranger,))
    name = community["name"]
    image = str(expect_status(upload(owner, picture("PNG", 400, 300), "p.png", "image/png"), 201, "upload")["id"])
    foreign = str(expect_status(upload(stranger, picture("PNG", 400, 300), "q.png", "image/png"), 201, "upload")["id"])
    outage = owner.on(down)
    expect_error(upload(outage, picture("PNG", 400, 300), "r.png", "image/png"), 503, "STORAGE_UNAVAILABLE",
                 "upload during outage")
    title = "Outage " + fresh("t", 10)
    expect_error(create_post(outage, name, title, images=[{"id": image, "alt": "a"}]), 503, "STORAGE_UNAVAILABLE",
                 "image post during outage")
    assert posts_titled(owner, owner.username, title) == []
    assert outage.get(f"/media/{image}/640.webp").status_code == 503
    text_title = "Text " + fresh("t", 10)
    expect_status(create_post(outage, name, text_title), 201, "text post during storage outage")

    for bad in (foreign, PROBE_ID):
        bad_title = "Bad " + fresh("t", 10)
        expect_error(create_post(owner, name, bad_title, images=[{"id": bad, "alt": "a"}]), 409, "IMAGES_NOT_READY",
                     f"image id {bad}")
        assert posts_titled(owner, owner.username, bad_title) == []
    ok_title = "Images " + fresh("t", 10)
    expect_status(create_post(owner, name, ok_title, images=[{"id": image, "alt": "a"}]), 201, "image post")
    again = "Again " + fresh("t", 10)
    expect_error(create_post(owner, name, again, images=[{"id": image, "alt": "a"}]), 409, "IMAGES_NOT_READY",
                 "already attached image")
    assert len(posts_titled(owner, owner.username, ok_title)) == 1


@pytest.mark.timeout(600)
def test_wf_composer_single_publish(browser: Browser, app_url: str) -> None:
    author = new_member(app_url)
    community = new_community(app_url, author)
    name = community["name"]
    title = "Composer " + fresh("t", 10)
    keys: list[str | None] = []
    with tab(browser, app_url, author, DESKTOP, f"/c/{name}/submit") as page:
        page.on("request", lambda req: keys.append(req.headers.get("idempotency-key"))
                if req.method == "POST" and req.url.endswith(f"/api/communities/{name}/posts") else None)
        page.get_by_role("textbox", name="Title", exact=True).fill(title)
        page.get_by_role("textbox", name="Body", exact=True).fill(f"Some **{LOUD_WORD}** here.")
        page.get_by_role("tab", name="Write", exact=True).focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("tab", name="Preview", exact=True)).to_have_attribute("aria-selected", "true")
        strong = page.get_by_text(LOUD_WORD, exact=True)
        expect(strong).to_be_visible(timeout=UI_MS)
        assert strong.evaluate("el => el.tagName.toLowerCase()") == "strong"
        page.keyboard.press("ArrowLeft")
        with held(page, f"**/api/communities/{name}/posts") as hold:
            page.get_by_role("button", name="Post", exact=True).focus()
            page.keyboard.press("Enter")
            expect(page.get_by_role("button", name="Posting...", exact=True)).to_be_visible(timeout=UI_MS)
            page.keyboard.press("Enter")
            hold.release()
        page.wait_for_url(re.compile(r"/c/[^/]+/post/\d+$"), timeout=UI_MS)
        created = posts_titled(author, author.username, title)
        assert len(created) == 1, f"double Post created {len(created)} posts"
        assert keys and len(set(keys)) == 1 and keys[0], f"Idempotency-Key headers {keys}"

        menu_item(page, page.get_by_role("button", name="More actions", exact=True).first, "Edit post")
        expect(page.get_by_text("Titles can't be edited", exact=True)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("textbox", name="Title", exact=True)).to_have_count(0)
        page.get_by_role("textbox", name="Body", exact=True).fill(EDITED_POST_BODY)
        page.get_by_role("button", name="Save", exact=True).click()
        announced(page, "Post updated")
        expect(page.get_by_text("edited", exact=True).first).to_be_visible()
    body = author.get(f"/api/posts/{created[0]['id']}").json()
    assert body["title"] == title and body["bodyMd"] == EDITED_POST_BODY and body["editedAt"]


@pytest.mark.timeout(600)
def test_wf_composer_storage_outage(browser: Browser, app_url: str) -> None:
    down = storage_down_url()
    author = new_member(app_url)
    community = new_community(app_url, author)
    copy = "Image uploads are unavailable right now. Your draft is kept."
    title = "Draft " + fresh("t", 10)
    sent: list[str] = []
    with tab(browser, down, author.on(down), PHONE, f"/c/{community['name']}/submit") as page:
        page.on("request", lambda req: sent.append(req.url) if req.method == "POST" and "/posts" in req.url else None)
        page.get_by_role("textbox", name="Title", exact=True).fill(title)
        page.get_by_role("textbox", name="Body", exact=True).fill(DRAFT_BODY)
        page.get_by_label("Add images", exact=True).set_input_files(
            [{"name": f"o{n}.png", "mimeType": "image/png", "buffer": picture("PNG", 400, 300)} for n in (1, 2)])
        for n in (1, 2):
            expect(by_id(page, f"image-tile-{n}")).to_contain_text(copy, timeout=UPLOAD_MS)
        announced(page, copy, alert=True)
        expect(page.get_by_role("button", name="Retry upload", exact=True).first).to_be_focused()
        expect(page.get_by_role("textbox", name="Title", exact=True)).to_have_value(title)
        expect(page.get_by_role("textbox", name="Body", exact=True)).to_have_value(DRAFT_BODY)
        page.get_by_role("button", name="Post", exact=True).click()
        expect(page.get_by_text("Wait for every image to upload, or remove the ones that failed",
                                exact=True).first).to_be_visible(timeout=UI_MS)
    assert not sent, f"Post with failed tiles sent {sent}"
    assert posts_titled(author, author.username, title) == []


def test_wf_composer_validation(browser: Browser, app_url: str) -> None:
    author = new_member(app_url)
    community = new_community(app_url, author)
    title = "Fixed " + fresh("t", 10)
    with tab(browser, app_url, author, DESKTOP, f"/c/{community['name']}/submit") as page:
        box = page.get_by_role("textbox", name="Title", exact=True)
        page.get_by_role("button", name="Post", exact=True).click()
        field_error(box, "Titles are 1 to 300 characters")
        expect(box).to_be_focused()
        box.fill(title)
        page.get_by_role("button", name="Post", exact=True).click()
        page.wait_for_url(re.compile(r"/post/\d+$"), timeout=UI_MS)
    assert len(posts_titled(author, author.username, title)) == 1


def test_wf_composer_marks_every_invalid_field(browser: Browser, app_url: str) -> None:
    author = new_member(app_url)
    community = new_community(app_url, author)
    title = "Both " + fresh("t", 10)
    with tab(browser, app_url, author, DESKTOP, f"/c/{community['name']}/submit") as page:
        box = page.get_by_role("textbox", name="Title", exact=True)
        body = page.get_by_role("textbox", name="Body", exact=True)
        body.fill("x" * (BODY_MAX + 1))
        page.get_by_role("button", name="Post", exact=True).click()
        field_error(box, "Titles are 1 to 300 characters")
        field_error(body, "Bodies are at most 40,000 characters")
        expect(box).to_be_focused()
        box.fill(title)
        body.fill("x" * BODY_MAX)
        page.get_by_role("button", name="Post", exact=True).click()
        page.wait_for_url(re.compile(r"/post/\d+$"), timeout=UI_MS)
    assert len(posts_titled(author, author.username, title)) == 1


@pytest.mark.timeout(600)
def test_wf_composer_images_field_error(browser: Browser, app_url: str) -> None:
    author = new_member(app_url)
    community = new_community(app_url, author)
    name = community["name"]
    title = "Tiles " + fresh("t", 10)
    sent: list[str] = []
    with tab(browser, app_url, author, DESKTOP, f"/c/{name}/submit") as page:
        page.on("request", lambda req: sent.append(req.url)
                if req.method == "POST" and req.url.endswith(f"/api/communities/{name}/posts") else None)
        page.get_by_role("textbox", name="Title", exact=True).fill(title)
        files = page.get_by_label("Add images", exact=True)
        files.set_input_files([{"name": "pic.png", "mimeType": "image/png", "buffer": b"hello, this is text"}])
        expect(by_id(page, "image-tile-1")).to_contain_text("Use a JPEG, PNG or WebP image", timeout=UPLOAD_MS)
        page.get_by_role("button", name="Post", exact=True).click()
        field_error(files, "Wait for every image to upload, or remove the ones that failed")
    assert not sent, f"Post with a failed tile sent {sent}"
    assert posts_titled(author, author.username, title) == []


class TagCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[str] = []
        self.attrs: list[str] = []
        self.links: list[dict[str, str | None]] = []
        self.spoilers = 0
        self.data: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append(tag)
        self.attrs += [k for k, _ in attrs]
        found = dict(attrs)
        if tag == "a":
            self.links.append(found)
        if tag == "span" and "spoiler" in (found.get("class") or "").split():
            self.spoilers += 1

    handle_startendtag = handle_starttag

    def handle_data(self, data: str) -> None:
        self.data.append(data)


MARKDOWN = "\n\n".join([
    "Some *soft* and **loud** words with a [link](https://example.test/page) and `code`.",
    "- one\n- two", "1. first\n2. second", "> quoted", "```\nblock code\n```",
    "| a | b |\n|---|---|\n| 1 | 2 |", "---", "line one  \nline two", f"Spoiler: >!{SPOILER_WORDS}!<",
    "[mail](mailto:someone@example.test)", *SCRIPT_FIXTURES])


def assert_sanitised(html: str, what: str) -> None:
    parsed = TagCollector()
    parsed.feed(html)
    assert set(parsed.tags) <= ALLOWED_TAGS, f"{what}: tags outside the allow-list {set(parsed.tags) - ALLOWED_TAGS}"
    assert set(parsed.attrs) <= ALLOWED_ATTRS, f"{what}: attributes {set(parsed.attrs) - ALLOWED_ATTRS}"
    assert {"em", "strong", "a", "code", "ul", "ol", "li", "blockquote", "pre", "table", "thead", "tbody", "tr",
            "th", "td", "hr", "br", "span", "p"} <= set(parsed.tags), f"{what}: missing subset elements"
    assert parsed.spoilers == 1
    for link in parsed.links:
        href = (link.get("href") or "").strip().lower()
        assert href.startswith(("http:", "https:", "mailto:")), f"{what}: link {href!r}"
        assert link.get("rel") == LINK_REL
    assert not re.search(r"=\s*[\"']?\s*javascript:", html, re.I), f"{what}: a javascript: URL in an attribute"
    joined = "".join(parsed.data)
    assert SCRIPT_FIXTURES[0] in joined and SCRIPT_FIXTURES[1] in joined, f"{what}: raw HTML must show as text"


def test_markdown_sanitiser(browser: Browser, app_url: str) -> None:
    author = new_member(app_url)
    community = new_community(app_url, author)
    post = expect_status(create_post(author, community["name"], "Markdown " + fresh("t", 8), MARKDOWN), 201, "post")
    assert_sanitised(post["bodyHtml"], "post body")
    preview = expect_status(author.req("POST", "/api/markdown/preview", {"bodyMd": MARKDOWN}), 200, "preview")
    assert preview["html"] == post["bodyHtml"], "preview must use the publishing renderer"
    made = expect_status(add_comment(author, str(post["id"]), MARKDOWN), 201, "comment")
    assert_sanitised(made["comment"]["bodyHtml"], "comment body")
    with tab(browser, app_url, None, DESKTOP, post["url"]) as page:
        expect(page.get_by_text(SPOILER_WORDS).first).to_be_attached(timeout=UI_MS)
        found = page.evaluate("""() => ({
          mh: typeof window.__mh,
          iframes: document.getElementsByTagName('iframe').length,
          animates: document.getElementsByTagName('animate').length,
          js: [...document.getElementsByTagName('a')].filter(a => /^\\s*javascript:/i.test(a.getAttribute('href') || '')).length,
          handlers: [...document.querySelectorAll('*')].filter(el => [...el.attributes].some(at => at.name.toLowerCase().startsWith('on'))).length
        })""")
    assert found == {"mh": "undefined", "iframes": 0, "animates": 0, "js": 0, "handlers": 0}, found


def test_idempotent_creation(app_url: str) -> None:
    author = new_member(app_url)
    community = new_community(app_url, author)
    name = community["name"]
    title = "Idem " + fresh("t", 10)
    r = author.req("POST", f"/api/communities/{name}/posts", {"title": title})
    expect_error(r, 422, "VALIDATION", "missing key", {"idempotencyKey": "Idempotency-Key header is required"})
    expect_error(create_post(author, name, title, key="k" * (KEY_MAX + 1)), 422, "VALIDATION", "overlong key",
                 {"idempotencyKey": None})
    assert posts_titled(author, author.username, title) == []
    key = idempotency_key()
    first = create_post(author, name, title, key=key)
    stored = expect_status(first, 201, "first create")
    replay = create_post(author, name, title, key=key)
    assert replay.status_code == 201 and replay.json() == stored
    expect_error(create_post(author, name, title + " changed", key=key), 422, "VALIDATION", "same key, new body",
                 {"idempotencyKey": "This key was already used for a different request"})
    assert len(posts_titled(author, author.username, title)) == 1

    racing = "Race " + fresh("t", 10)
    key = idempotency_key()
    results = together([lambda m=author.clone(): create_post(m, name, racing, key=key) for _ in range(8)])
    assert all(r.status_code == 201 for r in results), [r.status_code for r in results]
    assert len({json.dumps(r.json(), sort_keys=True) for r in results}) == 1
    assert len(posts_titled(author, author.username, racing)) == 1

    pid = str(stored["id"])
    key = idempotency_key()
    results = together([lambda m=author.clone(): add_comment(m, pid, "Only once.", key=key) for _ in range(8)])
    assert all(r.status_code == 201 for r in results)
    assert len({str(r.json()["comment"]["id"]) for r in results}) == 1
    assert int(post_row(pid)["comment_count"]) == 1
    expect_status(mod_action(author, "POST", pid, "lock", duration="indefinite"), 200, "lock")
    replay = add_comment(author, pid, "Only once.", key=key)
    assert replay.status_code == 201 and replay.json() == results[0].json(), "replay must precede the lock check"
    expect_error(add_comment(author, pid, "Different body.", key=key), 422, "VALIDATION", "comment key reuse",
                 {"idempotencyKey": "This key was already used for a different request"})
    assert int(post_row(pid)["comment_count"]) == 1


def test_post_edit_and_delete(app_url: str) -> None:
    owner, author, other = new_member(app_url), new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(author, other))
    name = community["name"]
    title = "Editable " + fresh("t", 10)
    pid = str(expect_status(create_post(author, name, title, "first"), 201, "post")["id"])
    edited = expect_status(author.req("PATCH", f"/api/posts/{pid}", {"bodyMd": EDIT_MD}), 200, "edit")
    parsed = TagCollector()
    parsed.feed(edited["bodyHtml"])
    assert edited["editedAt"] and "em" in parsed.tags and edited["title"] == title
    expect_error(author.req("PATCH", f"/api/posts/{pid}", {"bodyMd": "third", "title": "New title"}), 422,
                 "VALIDATION", "title edit", {"title": "Titles can't be edited"})
    assert author.get(f"/api/posts/{pid}").json()["bodyMd"] == EDIT_MD
    expect_error(other.req("PATCH", f"/api/posts/{pid}", {"bodyMd": "hijack"}), 403, "FORBIDDEN", "non-author edit")
    expect_error(author.req("PATCH", f"/api/posts/{pid}", {"bodyMd": "x" * (BODY_MAX + 1)}), 422, "VALIDATION",
                 "overlong body", {"bodyMd": "Bodies are at most 40,000 characters"})
    expect_status(author.req("PATCH", f"/api/posts/{pid}", {"bodyMd": "x" * BODY_MAX}), 200, "body at the limit")

    cid = comment_id(other, pid, "A comment that stays.")
    deleted = expect_status(author.req("DELETE", f"/api/posts/{pid}"), 200, "delete")
    assert deleted["state"] == "deleted" and deleted["title"] == "[deleted by author]"
    assert deleted["bodyHtml"] is None and deleted["author"] is None and deleted["images"] == []
    assert deleted["bodyMd"] is None
    view = visitor(app_url).get(f"/api/posts/{pid}").json()
    assert (view["title"], view["bodyHtml"], view["author"]) == ("[deleted by author]", None, None)
    tree = visitor(app_url).get(f"/api/posts/{pid}/comments").json()["tree"]
    assert cid in [str(c["id"]) for c in flat(tree)], "comments must stay under a deleted post"
    expect_error(author.req("DELETE", f"/api/posts/{pid}"), 409, "CONFLICT", "delete twice")
    expect_error(author.req("PATCH", f"/api/posts/{pid}", {"bodyMd": "x"}), 409, "CONFLICT", "edit deleted")
    expect_error(add_comment(other, pid, "late"), 409, "CONFLICT", "comment on deleted")
    assert pid not in [str(p["id"]) for p in visitor(app_url).get(f"/api/communities/{name}/posts?sort=new").json()["items"]]

    removed = str(expect_status(create_post(author, name, "Removed " + fresh("t", 8)), 201, "post")["id"])
    expect_status(mod_action(owner, "POST", removed, "removal", reason="spam"), 200, "remove")
    expect_error(author.req("PATCH", f"/api/posts/{removed}", {"bodyMd": "x"}), 409, "REMOVED", "edit removed")
    old = new_post(app_url, name, author, created=server_now(app_url) - timedelta(days=ARCHIVE_DAYS + 1))
    expect_error(author.req("PATCH", f"/api/posts/{old['id']}", {"bodyMd": "x"}), 409, "ARCHIVED", "edit archived")
    expect_status(author.req("DELETE", f"/api/posts/{removed}"), 200, "delete a removed post")


def levels_of(base: str, pid: str, author: Member, depth: int, siblings: int) -> list[list[str]]:
    made = grading(base, "/comment-trees", {"postId": pid, "author": author.username, "depth": depth,
                                            "siblings": siblings})
    return [[str(i) for i in level] for level in made["levels"]]


@pytest.mark.timeout(600)
def test_wf_deep_replies_continue_and_live(browser: Browser, app_url: str) -> None:
    owner, writer, watcher = new_member(app_url), new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(writer, watcher))
    name = community["name"]
    post = new_post(app_url, name, owner)
    pid = post["id"]
    levels = levels_of(app_url, pid, owner, TREE_DEPTH, 1)
    deepest = levels[PHONE_LEVELS - 1][0]
    with tab(browser, app_url, watcher, DESKTOP, post["url"]) as wide:
        for k in range(WIDE_LEVELS):
            expect(by_id(wide, f"comment-{levels[k][0]}")).to_have_attribute("aria-level", str(k + 1), timeout=UI_MS)
        expect(by_id(wide, f"comment-{levels[WIDE_LEVELS][0]}")).to_have_count(0)
        expect(by_id(wide, f"comment-{levels[WIDE_LEVELS - 1][0]}").get_by_role(
            "link", name="Continue this thread", exact=True)).to_be_visible()
        first = by_id(wide, f"comment-{levels[0][0]}")
        first.focus()
        live_ready(wide)

        with tab(browser, app_url, writer, PHONE, post["url"]) as phone:
            node = by_id(phone, f"comment-{deepest}")
            expect(node).to_have_attribute("aria-level", str(PHONE_LEVELS), timeout=UI_MS)
            expect(by_id(phone, f"comment-{levels[PHONE_LEVELS][0]}")).to_have_count(0)
            node.get_by_role("link", name="Continue this thread", exact=True).click()
            phone.wait_for_url(re.compile(rf"/post/{pid}/comment/{deepest}(\?[^#]*)?$"), timeout=UI_MS)
            expect(by_id(phone, f"comment-{deepest}")).to_have_attribute("aria-level", "1", timeout=UI_MS)
            expect(phone.get_by_role("link", name="Back to full thread", exact=True)).to_be_visible()
            phone.goto(app_url + post["url"])
            node = by_id(phone, f"comment-{deepest}")
            node.get_by_role("button", name="Reply", exact=True).first.click()
            box = phone.get_by_role("textbox", name=f"Reply to {owner.username}", exact=True)
            expect(box).to_be_focused()
            marker = "Deep reply " + fresh("r", 8)
            box.fill(marker)
            phone.get_by_role("button", name="Post reply", exact=True).click()
            phone.wait_for_url(re.compile(rf"/post/{pid}/comment/{deepest}(\?[^#]*)?$"), timeout=UI_MS)
            thread = writer.get(f"/api/comments/{deepest}/thread").json()["tree"]
            new = next(str(c["id"]) for c in flat(thread) if c["author"] and c["author"]["username"] == writer.username)
            expect(by_id(phone, f"comment-{new}")).to_be_focused(timeout=UI_MS)

        expect(by_id(wide, f"comment-{new}")).to_be_visible(timeout=LIVE_MS)
        announced(wide, f"New reply from {writer.username}")
        assert active_id(wide) == f"comment-{levels[0][0]}", "a live reply moved the reader's focus"
    assert int(post_row(pid)["comment_count"]) == TREE_DEPTH + 1


def test_wf_deep_replies_double_reply(browser: Browser, app_url: str) -> None:
    owner, member = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(member,))
    post = new_post(app_url, community["name"], owner)
    pid = post["id"]
    with tab(browser, app_url, member, DESKTOP, post["url"]) as page:
        page.get_by_role("textbox", name="Add a comment", exact=True).fill("Top level once.")
        with held(page, f"**/api/posts/{pid}/comments") as hold:
            page.get_by_role("button", name="Comment", exact=True).focus()
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
            hold.release()
        expect(by_id(page, f"comments-post-{pid}")).to_have_text("1 comment", timeout=UI_MS)
        top = str(member.get(f"/api/posts/{pid}/comments").json()["tree"][0]["id"])
        by_id(page, f"comment-{top}").get_by_role("button", name="Reply", exact=True).first.click()
        page.get_by_role("textbox", name=f"Reply to {member.username}", exact=True).fill("Reply once.")
        with held(page, f"**/api/posts/{pid}/comments") as hold:
            page.get_by_role("button", name="Post reply", exact=True).focus()
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
            hold.release()
        announced(page, "Reply posted")
        expect(by_id(page, f"comments-post-{pid}")).to_have_text("2 comments", timeout=UI_MS)
    nodes = flat(member.get(f"/api/posts/{pid}/comments").json()["tree"])
    assert len(nodes) == 2 and int(post_row(pid)["comment_count"]) == 2


def test_comment_tree_api(app_url: str) -> None:
    owner, voter = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(voter,))
    post = new_post(app_url, community["name"], owner)
    pid = post["id"]
    levels = levels_of(app_url, pid, owner, TREE_DEPTH, 2)
    assert [len(level) for level in levels] == [2] * TREE_DEPTH
    expected = {}
    for k, level in enumerate(levels):
        expected[level[0]] = 2 * (TREE_DEPTH - 1 - k)
        expected[level[1]] = 0
    body = expect_status(visitor(app_url).get(f"/api/posts/{pid}/comments?depth=3"), 200, "depth 3")
    nodes = flat(body["tree"])
    assert len(nodes) == 6 and max(n["depth"] for n in nodes) == 3
    assert [str(i) for i in body["more"]] == [levels[2][0]]
    default = visitor(app_url).get(f"/api/posts/{pid}/comments").json()
    nodes = flat(default["tree"])
    assert len(nodes) == 2 * WIDE_LEVELS and [str(i) for i in default["more"]] == [levels[WIDE_LEVELS - 1][0]]
    for n in nodes:
        assert n["descendantCount"] == expected[str(n["id"])], f"descendantCount of {n['id']}"
    thread = visitor(app_url).get(f"/api/comments/{levels[4][0]}/thread").json()["tree"]
    assert str(thread[0]["id"]) == levels[4][0] and thread[0]["depth"] == 5
    for bad, field in (("depth=9", "depth"), ("depth=0", "depth"), ("sort=bogus", "sort")):
        expect_error(visitor(app_url).get(f"/api/posts/{pid}/comments?{bad}"), 422, "VALIDATION", bad, {field: None})
    expect_error(visitor(app_url).get(f"/api/posts/{pid}/comments?sort=bogus"), 422, "VALIDATION", "sort copy",
                 {"sort": "This sort is not valid"})

    low, high = sorted(levels[0], key=int)
    expect_status(cast(voter, "comments", low, 1), 200, "vote the older sibling")
    top = [str(c["id"]) for c in visitor(app_url).get(f"/api/posts/{pid}/comments?sort=top&depth=1").json()["tree"]]
    assert top == [low, high]
    plain = [str(c["id"]) for c in visitor(app_url).get(f"/api/posts/{pid}/comments?depth=1").json()["tree"]]
    assert plain == top, "omitted sort must be Top"
    newest = [str(c["id"]) for c in visitor(app_url).get(f"/api/posts/{pid}/comments?sort=new&depth=1").json()["tree"]]
    assert newest == [high, low]


def test_comment_edit_window_and_deletion() -> None:
    base = short_url()
    owner, author = new_member(base), new_member(base)
    community = new_community(base, owner, members=(author,))
    post = new_post(base, community["name"], owner)
    pid = post["id"]
    made = add_comment(author, pid, "Editable comment.")
    parent = str(expect_status(made, 201, "comment")["comment"]["id"])
    child = comment_id(owner, pid, "Child reply.", parent)
    leaf = comment_id(author, pid, "Lonely leaf.")
    mine = next(c for c in flat(author.get(f"/api/posts/{pid}/comments").json()["tree"]) if str(c["id"]) == parent)
    theirs = next(c for c in flat(owner.get(f"/api/posts/{pid}/comments").json()["tree"]) if str(c["id"]) == parent)
    assert mine["canEdit"] is True and theirs["canEdit"] is False and "bodyMd" in mine and "bodyMd" not in theirs
    edited = expect_status(author.req("PATCH", f"/api/comments/{parent}", {"bodyMd": EDITED_COMMENT}), 200, "edit")
    assert edited["editedAt"]
    expect_error(owner.req("PATCH", f"/api/comments/{parent}", {"bodyMd": "x"}), 403, "FORBIDDEN", "non-author edit")
    wait_server_past(base, response_time(made) + timedelta(seconds=SHORT_EDIT_WINDOW_S), "edit window end")
    expect_error(author.req("PATCH", f"/api/comments/{parent}", {"bodyMd": "late"}), 409, "CONFLICT", "late edit")
    late = next(c for c in flat(author.get(f"/api/posts/{pid}/comments").json()["tree"]) if str(c["id"]) == parent)
    assert late["canEdit"] is False and late["bodyMd"] == EDITED_COMMENT

    assert expect_status(author.req("DELETE", f"/api/comments/{parent}"), 200, "delete parent") == {"commentCount": 2}
    tree = flat(visitor(base).get(f"/api/posts/{pid}/comments").json()["tree"])
    gone = next(c for c in tree if str(c["id"]) == parent)
    assert gone["state"] == "deleted" and gone["bodyHtml"] is None and gone["author"] is None
    assert child in [str(c["id"]) for c in tree]
    own = next(c for c in flat(author.get(f"/api/posts/{pid}/comments").json()["tree"]) if str(c["id"]) == parent)
    assert own["bodyMd"] is None
    assert expect_status(author.req("DELETE", f"/api/comments/{leaf}"), 200, "delete leaf") == {"commentCount": 1}
    assert leaf not in [str(c["id"]) for c in flat(visitor(base).get(f"/api/posts/{pid}/comments").json()["tree"])]
    expect_error(author.req("DELETE", f"/api/comments/{parent}"), 409, "CONFLICT", "delete twice")
    assert int(post_row(pid, "_short")["comment_count"]) == 1


def test_stream_events_and_resume(app_url: str, valkey: Any) -> None:
    owner, voter = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(voter,))
    post = new_post(app_url, community["name"], owner, score=1)
    elsewhere = new_post(app_url, community["name"], owner)
    pid = post["id"]
    with Stream(app_url, f"post:{pid}") as live, Stream(app_url, f"post:{elsewhere['id']}") as other:
        live.ready()
        other.ready()
        assert live.status == 200 and live.lines[0] == RETRY_LINE
        expect_status(cast(voter, "posts", pid, 1), 200, "vote")
        score = live.wait(lambda s: s.matching("score", lambda d: str(d["targetId"]) == pid), UI_S, "score event")[0]
        assert set(score["data"]) == {"targetType", "targetId", "postId", "score"}
        assert score["data"]["targetType"] == "post" and score["data"]["score"] == 2 and score["id"]
        assert valkey.command("XRANGE", "mh:events", score["id"], score["id"]), "SSE id must be the Valkey entry id"
        live.wait(lambda s: ": ping" in s.lines, HEARTBEAT_S + 3, "heartbeat comment")
        assert not other.matching("score", lambda d: str(d["postId"]) == pid), "events leaked to another topic"
        last = score["id"]
    cid = comment_id(voter, pid, "Arrives while away.")
    expect_status(cast(voter, "posts", pid, -1), 200, "vote while away")
    with Stream(app_url, f"post:{pid}", last_id=last) as resumed:
        resumed.wait(lambda s: s.matching("score", lambda d: d["score"] == 0), UI_S, "replayed score")
        mine = [e for e in resumed.events if e.get("event") in ("comment", "comments", "score")
                and str(json.loads(e["data"]).get("postId")) == pid]
        ids = [e["id"] for e in mine]
        assert len(ids) == len(set(ids)) and ids == sorted(ids, key=stream_id)
        assert all(stream_id(i) > stream_id(last) for i in ids)
        assert [e["event"] for e in mine].count("comment") == 1 and [e["event"] for e in mine].count("comments") == 1
        comment = resumed.matching("comment")[0]["data"]
        assert set(comment) == {"postId", "parentId", "comment"} and str(comment["comment"]["id"]) == cid
        assert set(comment["comment"]) == COMMENT_KEYS
        assert comment["comment"]["myVote"] == 0 and comment["comment"]["replies"] == []
        assert resumed.matching("comments")[0]["data"] == {"postId": comment["postId"], "commentCount": 1}


@pytest.mark.timeout(600)
def test_wf_fold_rail_keyboard(browser: Browser, app_url: str) -> None:
    owner, writer = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(writer,))
    post = new_post(app_url, community["name"], owner)
    levels = levels_of(app_url, post["id"], owner, 3, 2)
    root = levels[0][0]
    tree = visitor(app_url).get(f"/api/posts/{post['id']}/comments").json()["tree"]
    root_node = next(n for n in tree if str(n["id"]) == root)
    count = root_node["descendantCount"]
    first_reply = str(root_node["replies"][0]["id"])
    with tab(browser, app_url, owner, DESKTOP, post["url"]) as page:
        item = by_id(page, f"comment-{root}")
        rail = item.get_by_role("button", name=f"Fold replies to {owner.username}", exact=True).first
        expect(rail).to_be_visible(timeout=UI_MS)
        rail.focus()
        page.keyboard.press("Enter")
        pill = page.get_by_role("button", name=f"{count} replies folded", exact=True)
        expect(pill).to_be_focused()
        expect(item).to_have_attribute("aria-expanded", "false")
        until(page, HIDDEN_INERT_JS, f"comment-{first_reply}", UI_S)
        expect(page).to_have_url(re.compile(rf"[?&]fold={root}(&|$)"))
        page.keyboard.press("Enter")
        expect(rail).to_be_focused()
        expect(item).to_have_attribute("aria-expanded", "true")
        expect(by_id(page, f"comment-{first_reply}")).to_be_visible()

        item.focus()
        page.keyboard.press("ArrowLeft")
        expect(pill).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect(item).to_be_focused()
        expect(item).to_have_attribute("aria-expanded", "true")
        page.keyboard.press("ArrowRight")
        expect(by_id(page, f"comment-{first_reply}")).to_be_focused()

        page.goto(app_url + post["url"] + f"?fold={root}")
        expect(page.get_by_role("button", name=f"{count} replies folded", exact=True)).to_be_visible(timeout=UI_MS)
        expect(by_id(page, f"comment-{root}")).to_have_attribute("aria-expanded", "false")
        live_ready(page)
        pill = page.get_by_role("button", name=f"{count} replies folded", exact=True)
        pill.focus()
        handle = pill.element_handle()
        comment_id(writer, post["id"], "A reply inside the fold.", levels[1][0])
        expect(page.get_by_role("button", name=f"{count + 1} replies folded", exact=True)).to_be_visible(timeout=LIVE_MS)
        announced(page, f"New reply from {writer.username}")
        assert handle.evaluate("el => el === document.activeElement"), "a live reply moved focus off the pill"
        expect(by_id(page, f"comment-{root}")).to_have_attribute("aria-expanded", "false")


def test_wf_fold_rail_tap(browser: Browser, app_url: str) -> None:
    owner = new_member(app_url)
    community = new_community(app_url, owner)
    post = new_post(app_url, community["name"], owner)
    levels = levels_of(app_url, post["id"], owner, 2, 1)
    with tab(browser, app_url, owner, PHONE, post["url"]) as page:
        item = by_id(page, f"comment-{levels[0][0]}")
        tap(item.get_by_role("button", name=f"Fold replies to {owner.username}", exact=True).first)
        pill = page.get_by_role("button", name="1 reply folded", exact=True)
        expect(pill).to_be_visible(timeout=UI_MS)
        expect(item).to_have_attribute("aria-expanded", "false")
        until(page, HIDDEN_INERT_JS, f"comment-{levels[1][0]}", UI_S)
        tap(pill)
        expect(by_id(page, f"comment-{levels[1][0]}")).to_be_visible(timeout=UI_MS)
        expect(item).to_have_attribute("aria-expanded", "true")


@pytest.mark.timeout(600)
def test_wf_fold_rail_nested_live_count(browser: Browser, app_url: str) -> None:
    owner, writer = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(writer,))
    post = new_post(app_url, community["name"], owner)
    levels = levels_of(app_url, post["id"], owner, 3, 1)
    root, child, leaf = levels[0][0], levels[1][0], levels[2][0]
    tree = visitor(app_url).get(f"/api/posts/{post['id']}/comments").json()["tree"]
    count = next(n for n in tree if str(n["id"]) == root)["descendantCount"]
    with tab(browser, app_url, owner, DESKTOP, post["url"]) as page:
        inner = by_id(page, f"comment-{child}")
        inner_rail = inner.get_by_role("button", name=f"Fold replies to {owner.username}", exact=True).first
        expect(inner_rail).to_be_visible(timeout=UI_MS)
        inner_rail.focus()
        page.keyboard.press("Enter")
        expect(inner).to_have_attribute("aria-expanded", "false")
        outer = by_id(page, f"comment-{root}")
        outer_rail = outer.get_by_role("button", name=f"Fold replies to {owner.username}", exact=True).first
        outer_rail.focus()
        page.keyboard.press("Enter")
        pill = page.get_by_role("button", name=f"{count} replies folded", exact=True)
        expect(pill).to_be_focused()
        expect(outer).to_have_attribute("aria-expanded", "false")
        until(page, HIDDEN_INERT_JS, f"comment-{child}", UI_S)
        live_ready(page)
        handle = pill.element_handle()
        comment_id(writer, post["id"], "A reply deep inside both folds.", leaf)
        expect(page.get_by_role("button", name=f"{count + 1} replies folded", exact=True)).to_be_visible(
            timeout=LIVE_MS)
        announced(page, f"New reply from {writer.username}")
        assert handle.evaluate("el => el === document.activeElement"), "a live reply moved focus off the pill"
        expect(outer).to_have_attribute("aria-expanded", "false")


@pytest.mark.timeout(300)
def test_wf_fold_rail_tap_refold(browser: Browser, app_url: str) -> None:
    owner = new_member(app_url)
    community = new_community(app_url, owner)
    post = new_post(app_url, community["name"], owner)
    levels = levels_of(app_url, post["id"], owner, 3, 2)
    root, reply = levels[0][0], levels[1][0]
    tree = visitor(app_url).get(f"/api/posts/{post['id']}/comments").json()["tree"]
    count = next(n for n in tree if str(n["id"]) == root)["descendantCount"]
    with tab(browser, app_url, owner, PHONE, post["url"]) as page:
        item = by_id(page, f"comment-{root}")
        rail = item.get_by_role("button", name=f"Fold replies to {owner.username}", exact=True).first
        expect(rail).to_be_visible(timeout=UI_MS)
        page.evaluate(RECORDER_JS)
        tap(rail)
        pill = page.get_by_role("button", name=f"{count} replies folded", exact=True)
        expect(pill).to_be_focused()
        until(page, HIDDEN_INERT_JS, f"comment-{reply}", UI_S)
        tap(pill)
        expect(rail).to_be_focused()
        expect(item).to_have_attribute("aria-expanded", "true")
        settled_records(page, f"#comment-{root}")
        expect(by_id(page, f"comment-{reply}")).to_be_visible()
        box = rail.bounding_box()
        assert box is not None and box["width"] >= TOUCH_MIN and box["height"] >= TOUCH_MIN, (
            f"after unfolding, the fold rail's touch target is {box}")
        tap(rail)
        expect(pill).to_be_focused()
        expect(item).to_have_attribute("aria-expanded", "false")


@pytest.mark.timeout(600)
def test_fold_motion_and_reduced_motion(browser: Browser, app_url: str) -> None:
    owner, writer = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(writer,))
    post = new_post(app_url, community["name"], owner)
    pid = post["id"]
    levels = levels_of(app_url, pid, owner, 3, 2)
    root = levels[0][0]
    order = [str(n["id"]) for n in visitor(app_url).get(f"/api/posts/{pid}/comments?depth=1").json()["tree"]]
    above, below = order[0], order[1]

    with tab(browser, app_url, owner, DESKTOP, post["url"]) as page:
        item = by_id(page, f"comment-{root}")
        expect(item).to_be_visible(timeout=UI_MS)
        page.evaluate(RECORDER_JS)
        item.get_by_role("button", name=f"Fold replies to {owner.username}", exact=True).first.click()
        records = settled_records(page, f"#comment-{root}")
        assert records, "folding produced no animation"
        assert all(r["end"] >= 0 and r["iterations"] >= 0 for r in records), "fold animation never ends"
        assert span_ms(records) < FOLD_MAX_MS, f"fold sequence took {span_ms(records)} ms"
        props = {re.sub(r"[A-Z]", lambda m: "-" + m.group(0).lower(), p) for r in records for p in r["props"]}
        assert not props & LAYOUT_PROPS, f"fold animates layout properties {props & LAYOUT_PROPS}"
        assert props & MOVE_FADE_PROPS, f"fold animates {props}"
        page.get_by_role("button", name=re.compile(r"replies folded$")).click()
        expect(item).to_have_attribute("aria-expanded", "true")

        live_ready(page)
        top_before = by_id(page, f"comment-{above}").evaluate("el => el.getBoundingClientRect().top")
        rec_start = len(page.evaluate(RECORDS_JS, f"#comment-{below}"))
        new = comment_id(writer, pid, "Grows in below.", below)
        expect(by_id(page, f"comment-{new}")).to_be_attached(timeout=LIVE_MS)
        top_now = by_id(page, f"comment-{above}").evaluate("el => el.getBoundingClientRect().top")
        records = settled_records(page, f"#comment-{below}")
        top_after = by_id(page, f"comment-{above}").evaluate("el => el.getBoundingClientRect().top")
        assert abs(top_now - top_before) <= PX_TOL and abs(top_after - top_before) <= PX_TOL, "content above moved"
        assert len(records) > rec_start, "the live reply did not animate in"
        assert all(r["end"] >= 0 for r in records)

    with tab(browser, app_url, owner, DESKTOP, post["url"], reduced="reduce") as calm:
        item = by_id(calm, f"comment-{root}")
        expect(item).to_be_visible(timeout=UI_MS)
        calm.evaluate(RECORDER_JS)
        item.get_by_role("button", name=f"Fold replies to {owner.username}", exact=True).first.click()
        expect(calm.get_by_role("button", name=re.compile(r"replies folded$"))).to_be_focused()
        records = settled_records(calm, f"#comment-{root}")
        assert all(r["end"] == 0 for r in records), f"reduced-motion fold animated {records}"
        calm.get_by_role("button", name=re.compile(r"replies folded$")).click()
        expect(item).to_have_attribute("aria-expanded", "true")
        live_ready(calm)
        new = comment_id(writer, pid, "Tagged arrival.", below)
        fresh_item = by_id(calm, f"comment-{new}")
        expect(fresh_item.get_by_text("New", exact=True)).to_be_visible(timeout=LIVE_MS)
        records = settled_records(calm, f"#comment-{below}")
        assert all(r["end"] == 0 for r in records), "reduced motion must not animate the live reply"


@pytest.mark.timeout(900)
def test_wf_remove_post_watchers(browser: Browser, app_url: str, mail: Any) -> None:
    owner, author, reader = new_member(app_url), new_member(app_url), new_member(app_url)
    rule = "No duplicate sightings " + fresh("r", 6)
    community = new_community(app_url, owner, members=(author, reader), rules=[{"title": rule, "description": ""}])
    name = community["name"]
    new_post(app_url, name, author, score=0, created=server_now(app_url) - timedelta(hours=5))
    post = new_post(app_url, name, author, score=20)
    pid = post["id"]
    note = "private-" + fresh("n", 10)
    with tab(browser, app_url, author, DESKTOP, post["url"]) as author_tab, \
            tab(browser, app_url, reader, DESKTOP, f"/c/{name}") as reader_tab, \
            tab(browser, app_url, owner, DESKTOP, post["url"]) as mod_tab:
        live_ready(author_tab)
        live_ready(reader_tab)
        ids = eventually(lambda: card_ids(reader_tab) if pid in card_ids(reader_tab) else None, "reader sees card")
        following = ids[ids.index(pid) + 1]
        by_id(reader_tab, f"post-{pid}").focus()

        button = mod_tab.get_by_role("button", name="Moderator actions", exact=True)
        menu_item(mod_tab, button, "Remove post")
        dialog = mod_tab.get_by_role("dialog", name="Remove post", exact=True)
        expect(dialog).to_be_visible()
        assert dialog.evaluate("el => el.contains(document.activeElement)"), "dialog must take focus"
        mod_tab.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(button).to_be_focused()
        menu_item(mod_tab, button, "Remove post")
        radio = mod_tab.get_by_role("radio", name=rule, exact=True)
        radio.focus()
        mod_tab.keyboard.press("Space")
        expect(radio).to_be_checked()
        mod_tab.get_by_role("textbox", name="Private note (moderators only)", exact=True).focus()
        mod_tab.keyboard.type(note)
        mod_tab.get_by_role("button", name="Remove", exact=True).focus()
        mod_tab.keyboard.press("Enter")
        announced(mod_tab, "Post removed")

        expect(author_tab.get_by_role("heading", name=f"Removed by moderators: {rule}", exact=True)).to_be_visible(
            timeout=LIVE_MS)
        expect(by_id(reader_tab, f"post-{pid}")).to_have_count(0, timeout=LIVE_MS)
        announced(reader_tab, "Post removed by moderators")
        expect(by_id(reader_tab, f"post-{following}")).to_be_focused()

    message = wait_mail(mail, author.email, f"Your post in c/{name} was removed")[0]
    body = text(message)
    for piece in (post["title"], rule, f"This removal was made by the moderators of c/{name}.", f"/c/{name}/post/{pid}"):
        assert piece in body, f"statement of reasons lacks {piece!r}"
    assert note not in body

    with tab(browser, app_url, None, DESKTOP, f"/c/{name}/about/log") as log:
        table = log.get_by_role("table", name="Moderation log", exact=True)
        row = table.get_by_role("row").filter(has_text=f"Post {pid}")
        expect(row).to_contain_text("Removed post", timeout=UI_MS)
        expect(row).to_contain_text(rule)
        expect(log.get_by_text(note)).to_have_count(0)
        expect(table.get_by_role("columnheader", name="Private note", exact=True)).to_have_count(0)
        expect(table.get_by_role("columnheader", name="Moderator", exact=True)).to_have_count(0)
    raw = visitor(app_url).get(f"/api/communities/{name}/modlog")
    entry = next(e for e in raw.json()["items"] if e["target"] == {"type": "post", "id": pid})
    assert entry["action"] == "remove_post" and entry["publicReason"] == rule and set(entry) == ENTRY_KEYS
    assert note not in raw.text and entry["moderator"] is None


@pytest.mark.timeout(600)
def test_wf_remove_post_validation_restore(browser: Browser, app_url: str) -> None:
    owner, author = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(author,))
    post = new_post(app_url, community["name"], author)
    public = "Off topic " + fresh("p", 6)
    with tab(browser, app_url, owner, DESKTOP, post["url"]) as page:
        button = page.get_by_role("button", name="Moderator actions", exact=True)
        menu_item(page, button, "Remove post")
        page.get_by_role("button", name="Remove", exact=True).click()
        expect(page.get_by_text("Choose a reason", exact=True).first).to_be_visible()
        page.get_by_role("radio", name="Other", exact=True).check()
        page.get_by_role("button", name="Remove", exact=True).click()
        expect(page.get_by_text("Add a public note for Other", exact=True).first).to_be_visible()
        page.get_by_role("textbox", name="Public note", exact=True).fill(public)
        page.get_by_role("button", name="Remove", exact=True).click()
        announced(page, "Post removed")
        expect(page.get_by_text(f"Removed by moderators: {public}", exact=True).first).to_be_visible(timeout=UI_MS)
        button.focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("menuitem", name="Restore post", exact=True)).to_be_visible()
        expect(page.get_by_role("menuitem", name="Remove post", exact=True)).to_have_count(0)
        page.keyboard.press("Escape")
        menu_item(page, button, "Restore post")
        announced(page, "Post restored")
    assert visitor(app_url).get(f"/api/posts/{post['id']}").json()["state"] == "published"
    actions = [e["action"] for e in modlog(visitor(app_url), community["name"]) if e["target"]["id"] == post["id"]]
    assert actions == ["restore_post", "remove_post"]


def test_removal_rules_and_visibility(app_url: str, mail: Any) -> None:
    owner, author, other = new_member(app_url), new_member(app_url), new_member(app_url)
    foreign = new_community(app_url, owner)
    community = new_community(app_url, owner, members=(author, other))
    name, rule_id, rule = community["name"], community["ruleIds"][0], community["rules"][0]["title"]
    image = str(expect_status(upload(author, picture("PNG", 400, 300), "x.png", "image/png"), 201, "upload")["id"])
    title = "Removable " + fresh("t", 8)
    pid = str(expect_status(create_post(author, name, title, SECRET_BODY, images=[{"id": image, "alt": "a"}]),
                            201, "post")["id"])
    for extra, field in (({}, "reason"), ({"reason": "rule", "ruleId": foreign["ruleIds"][0]}, "ruleId"),
                         ({"reason": "other"}, "publicNote"),
                         ({"reason": "spam", "privateNote": "n" * (PRIVATE_NOTE_MAX + 1)}, "privateNote"),
                         ({"reason": "other", "publicNote": "p" * (PUBLIC_NOTE_MAX + 1)}, "publicNote")):
        expect_error(mod_action(owner, "POST", pid, "removal", **extra), 422, "VALIDATION", f"removal {extra}",
                     {field: None})
    expect_error(mod_action(other, "POST", pid, "removal", reason="spam"), 403, "FORBIDDEN", "non-moderator removal")
    assert visitor(app_url).get(f"/api/posts/{pid}").json()["state"] == "published"

    note = "never-public-" + fresh("n", 8)
    removed = expect_status(mod_action(owner, "POST", pid, "removal", reason="spam", privateNote=note), 200, "remove")
    assert removed["state"] == "removed" and removed["removal"]["publicReason"] == "Spam"
    for client in (visitor(app_url), other.client):
        r = client.get(f"/api/posts/{pid}")
        view = r.json()
        assert (view["title"], view["bodyHtml"], view["author"], view["images"]) == (None, None, None, [])
        assert note not in r.text and SECRET_BODY not in r.text
    mod_view = owner.get(f"/api/posts/{pid}").json()
    assert mod_view["title"] == title and SECRET_BODY in mod_view["bodyHtml"] and "bodyMd" not in mod_view
    own = author.get(f"/api/posts/{pid}").json()
    assert own["title"] == title and own["bodyMd"] == SECRET_BODY and own["images"]
    assert visitor(app_url).get(f"/media/{image}/640.webp").status_code == 404
    assert author.get(f"/media/{image}/640.webp").status_code == 200
    assert owner.get(f"/media/{image}/640.webp").status_code == 200
    for path in (f"/api/communities/{name}/posts?sort=new", f"/api/users/{author.username}/posts"):
        assert pid not in [str(p["id"]) for p in visitor(app_url).get(path).json()["items"]]
    expect_error(cast(other, "posts", pid, 1), 409, "REMOVED", "vote on removed")
    expect_error(add_comment(other, pid, "hello"), 409, "REMOVED", "comment on removed")
    expect_error(mod_action(owner, "POST", pid, "removal", reason="spam"), 409, "CONFLICT", "remove twice")

    expect_status(mod_action(owner, "DELETE", pid, "removal"), 200, "restore")
    expect_error(mod_action(owner, "DELETE", pid, "removal"), 409, "CONFLICT", "restore a published post")
    assert visitor(app_url).get(f"/api/posts/{pid}").json()["title"] == title
    again = expect_status(mod_action(owner, "POST", pid, "removal", reason="rule", ruleId=rule_id), 200, "remove by rule")
    assert again["removal"]["publicReason"] == rule
    mails = wait_mail(mail, author.email, f"Your post in c/{name} was removed", 2)
    assert len(mails) == 2 and all(note not in text(m) for m in mails)

    live = str(expect_status(create_post(author, name, "Commented " + fresh("t", 8)), 201, "post")["id"])
    cid = comment_id(author, live, "comment secret")
    body = expect_status(owner.req("POST", f"/api/comments/{cid}/removal", {"reason": "spam"}), 200, "remove comment")
    assert body["state"] == "removed" and body["bodyHtml"] and body["author"] and set(body) == COMMENT_KEYS
    public_view = next(c for c in flat(visitor(app_url).get(f"/api/posts/{live}/comments").json()["tree"])
                       if str(c["id"]) == cid) if visitor(app_url).get(f"/api/posts/{live}/comments").json()["tree"] else None
    if public_view is not None:
        assert public_view["bodyHtml"] is None and public_view["author"] is None
    assert int(post_row(live)["comment_count"]) == 0
    expect_error(owner.req("POST", f"/api/comments/{cid}/removal", {"reason": "spam"}), 409, "CONFLICT", "twice")
    assert len(mails_for(mail, author.email, f"Your post in c/{name} was removed")) == 2, "comment removal mailed"


def test_mod_log_entries_and_views(app_url: str) -> None:
    owner, member, other = new_member(app_url), new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(member, other))
    name = community["name"]
    pid = new_post(app_url, name, member)["id"]
    cid = comment_id(member, pid, "Comment to remove.")
    note = "note-" + fresh("n", 8)
    steps = [
        ("lock", lambda: mod_action(owner, "POST", pid, "lock", duration="indefinite"), None),
        ("unlock", lambda: mod_action(owner, "DELETE", pid, "lock"), None),
        ("lock", lambda: mod_action(owner, "POST", pid, "lock", duration="1h"), "1 hour"),
        ("unlock", lambda: mod_action(owner, "DELETE", pid, "lock"), None),
        ("pin", lambda: mod_action(owner, "POST", pid, "pin"), None),
        ("unpin", lambda: mod_action(owner, "DELETE", pid, "pin"), None),
        ("remove_post", lambda: mod_action(owner, "POST", pid, "removal", reason="spam", privateNote=note), "Spam"),
        ("restore_post", lambda: mod_action(owner, "DELETE", pid, "removal"), None),
        ("remove_comment", lambda: owner.req("POST", f"/api/comments/{cid}/removal",
                                             {"reason": "other", "publicNote": "Off topic here"}), "Off topic here"),
        ("add_moderator", lambda: owner.req("POST", f"/api/communities/{name}/moderators",
                                            {"username": other.username}), None),
        ("approve_poster", lambda: owner.req("PUT", f"/api/communities/{name}/approved/{member.username}"), None),
        ("unapprove_poster", lambda: owner.req("DELETE", f"/api/communities/{name}/approved/{member.username}"), None),
        ("remove_moderator", lambda: owner.req("DELETE", f"/api/communities/{name}/moderators/{other.username}"), None),
    ]
    for action, run, _ in steps:
        r = run()
        assert r.status_code in (200, 201, 204), f"{action}: {r.status_code} {r.text[:200]}"
    before = len(modlog(owner, name))
    expect_error(mod_action(owner, "DELETE", pid, "lock"), 409, "CONFLICT", "unlock an open thread")
    assert len(modlog(owner, name)) == before, "a refused action wrote a log entry"

    public = modlog(visitor(app_url), name)
    assert [e["action"] for e in public] == [a for a, _, _ in reversed(steps)]
    assert [e["publicReason"] for e in public] == [r for _, _, r in reversed(steps)]
    assert all(set(e) == ENTRY_KEYS and e["moderator"] is None for e in public)
    times = [parse_time(e["at"]) for e in public]
    assert times == sorted(times, reverse=True)
    targets = {e["action"]: e["target"] for e in public}
    assert targets["lock"] == {"type": "post", "id": pid} and targets["remove_comment"] == {"type": "comment", "id": cid}
    assert targets["add_moderator"] == {"type": "user", "id": other.username}
    raw = visitor(app_url).get(f"/api/communities/{name}/modlog").text
    assert note not in raw and "privateNote" not in raw
    for viewer in (member, other):
        assert note not in viewer.get(f"/api/communities/{name}/modlog").text
    private = modlog(owner, name)
    assert all(set(e) == ENTRY_KEYS | {"privateNote"} for e in private)
    assert next(e for e in private if e["action"] == "remove_post")["privateNote"] == note
    assert all(e["moderator"]["username"] == owner.username for e in private)

    expect_status(owner.req("PATCH", f"/api/communities/{name}", {"showModNames": True}), 200, "show names")
    named = modlog(visitor(app_url), name)
    assert all(set(e["moderator"]) == PUBLIC_USER_KEYS and e["moderator"]["username"] == owner.username for e in named)
    for _ in range(7):
        expect_status(mod_action(owner, "POST", pid, "lock", duration="indefinite"), 200, "lock")
        expect_status(mod_action(owner, "DELETE", pid, "lock"), 200, "unlock")
    pages = walk_pages(visitor(app_url), f"/api/communities/{name}/modlog")
    assert [len(p["items"]) for p in pages] == [MODLOG_PAGE, len(steps) + 14 - MODLOG_PAGE]


def comment_box_visible(page: Page) -> bool:
    return page.get_by_role("textbox", name="Add a comment", exact=True).is_visible()


@pytest.mark.timeout(600)
def test_wf_lock_pin_wrong_clock(browser: Browser) -> None:
    base = short_url()
    owner, reader = new_member(base), new_member(base)
    community = new_community(base, owner, members=(reader,))
    post = new_post(base, community["name"], owner)
    pid = post["id"]
    wrong = server_now(base) + timedelta(days=3)
    with tab(browser, base, reader, DESKTOP, post["url"], clock_at=wrong) as reader_tab, \
            tab(browser, base, owner, DESKTOP, post["url"]) as mod_tab:
        expect(reader_tab.get_by_role("textbox", name="Add a comment", exact=True)).to_be_visible(timeout=UI_MS)
        live_ready(reader_tab)
        menu_item(mod_tab, mod_tab.get_by_role("button", name="Moderator actions", exact=True), "Lock thread")
        dialog = mod_tab.get_by_role("dialog", name="Lock thread", exact=True)
        dialog.get_by_role("radio", name="1 hour", exact=True).check()
        dialog.get_by_role("button", name="Lock", exact=True).click()
        state = eventually(lambda: (s := owner.get(f"/api/posts/{pid}").json())["locked"] is True
                           and s["lockedUntil"] and s, "the post reads as locked with an end time")
        expect(reader_tab.get_by_text("Locked by moderators", exact=True).first).to_be_visible(timeout=LIVE_MS)
        expect(reader_tab.get_by_role("textbox", name="Add a comment", exact=True)).to_have_count(0)
        remaining_ms = max(0.0, (parse_time(state["lockedUntil"]) - server_now(base)).total_seconds() * 1000)
        expect(reader_tab.get_by_role("textbox", name="Add a comment", exact=True)).to_be_visible(
            timeout=int(remaining_ms + LIVE_MS + UI_MS))
    assert visitor(base).get(f"/api/posts/{pid}").json()["locked"] is False


def test_wf_lock_pin_replace_pin(browser: Browser, app_url: str) -> None:
    owner = new_member(app_url)
    community = new_community(app_url, owner)
    name = community["name"]
    first, second, third = (new_post(app_url, name, owner) for _ in range(3))
    for p in (first, second):
        expect_status(mod_action(owner, "POST", p["id"], "pin"), 200, "pin")
    with tab(browser, app_url, owner, DESKTOP, third["url"]) as page:
        menu_item(page, page.get_by_role("button", name="Moderator actions", exact=True), "Pin post")
        dialog = page.get_by_role("dialog", name="Replace a pin", exact=True)
        expect(dialog).to_be_visible(timeout=UI_MS)
        group = dialog.get_by_role("radiogroup", name="Pinned post to replace", exact=True)
        group.get_by_role("radio", name=first["title"], exact=True).focus()
        page.keyboard.press("ArrowDown")
        expect(group.get_by_role("radio", name=second["title"], exact=True)).to_be_checked()
        dialog.get_by_role("button", name="Replace pin", exact=True).click()
        announced(page, "Post pinned")
    pinned = [str(p["id"]) for p in visitor(app_url).get(f"/api/communities/{name}/posts").json()["pinned"]]
    assert pinned == [first["id"], third["id"]]
    entries = modlog(visitor(app_url), name)
    assert [(e["action"], e["target"]["id"]) for e in entries[:2]] == [("pin", third["id"]), ("unpin", second["id"])]


def test_wf_lock_pin_race_lost(browser: Browser, app_url: str) -> None:
    owner, second = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, moderators=(second,))
    post = new_post(app_url, community["name"], owner)
    with tab(browser, app_url, second, DESKTOP, post["url"], block_stream=True) as page:
        button = page.get_by_role("button", name="Moderator actions", exact=True)
        expect(button).to_be_visible(timeout=UI_MS)
        expect_status(mod_action(owner, "POST", post["id"], "removal", reason="spam"), 200, "first moderator wins")
        menu_item(page, button, "Pin post")
        announced(page, "Another moderator acted first", alert=True)
        expect(page.get_by_text("Removed by moderators: Spam", exact=True).first).to_be_visible(timeout=UI_MS)
    actions = [e["action"] for e in modlog(owner, community["name"]) if e["target"]["id"] == post["id"]]
    assert actions == ["remove_post"]
    assert visitor(app_url).get(f"/api/posts/{post['id']}").json()["pinned"] is False


def test_wf_lock_pin_keyboard_dialog(browser: Browser, app_url: str) -> None:
    owner, reader = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(reader,))
    post = new_post(app_url, community["name"], owner)
    pid = post["id"]
    with tab(browser, app_url, reader, PHONE, post["url"]) as reader_tab, \
            tab(browser, app_url, owner, DESKTOP, post["url"]) as mod_tab:
        expect(reader_tab.get_by_role("textbox", name="Add a comment", exact=True)).to_be_visible(timeout=UI_MS)
        live_ready(reader_tab)
        button = mod_tab.get_by_role("button", name="Moderator actions", exact=True)
        menu_item(mod_tab, button, "Lock thread")
        dialog = mod_tab.get_by_role("dialog", name="Lock thread", exact=True)
        group = dialog.get_by_role("radiogroup", name="Duration", exact=True)
        expect(group.get_by_role("radio", name="Until unlocked", exact=True)).to_be_focused(timeout=UI_MS)
        mod_tab.keyboard.press("Escape")
        expect(dialog).to_have_count(0, timeout=UI_MS)
        expect(button).to_be_focused()
        menu_item(mod_tab, button, "Lock thread")
        expect(group.get_by_role("radio", name="Until unlocked", exact=True)).to_be_focused(timeout=UI_MS)
        mod_tab.keyboard.press("ArrowDown")
        expect(group.get_by_role("radio", name="1 hour", exact=True)).to_be_checked()
        dialog.get_by_role("button", name="Lock", exact=True).focus()
        mod_tab.keyboard.press("Enter")
        announced(mod_tab, "Thread locked")
        announced(reader_tab, "Thread locked", timeout=LIVE_MS)
        expect(reader_tab.get_by_text("Locked by moderators", exact=True).first).to_be_visible()
        expect(reader_tab.get_by_role("textbox", name="Add a comment", exact=True)).to_have_count(0)
        button.focus()
        mod_tab.keyboard.press("Enter")
        expect(mod_tab.get_by_role("menuitem", name="Unlock thread", exact=True)).to_be_visible(timeout=UI_MS)
        expect(mod_tab.get_by_role("menuitem", name="Lock thread", exact=True)).to_have_count(0)
        mod_tab.keyboard.press("Escape")
        expect(button).to_be_focused()
    state = owner.get(f"/api/posts/{pid}").json()
    assert state["locked"] is True and state["lockedUntil"]


@pytest.mark.timeout(600)
def test_server_timed_locks() -> None:
    base = short_url()
    owner, member = new_member(base), new_member(base)
    community = new_community(base, owner, members=(member,))
    name = community["name"]
    indefinite = new_post(base, name, owner)["id"]
    body = expect_status(mod_action(owner, "POST", indefinite, "lock", duration="indefinite"), 200, "lock")
    assert body["locked"] is True and body["lockedUntil"] is None
    expect_error(add_comment(member, indefinite, "blocked"), 409, "LOCKED", "reply to locked")
    expect_status(cast(member, "posts", indefinite, 1), 200, "vote on locked")
    expect_error(mod_action(owner, "POST", indefinite, "lock", duration="indefinite"), 409, "CONFLICT", "lock twice")
    expect_error(mod_action(owner, "POST", new_post(base, name, owner)["id"], "lock", duration="2h"), 422,
                 "VALIDATION", "bad duration", {"duration": None})
    for duration, hours in LOCK_HOURS.items():
        target = new_post(base, name, owner)["id"]
        r = mod_action(owner, "POST", target, "lock", duration=duration)
        until_at = parse_time(expect_status(r, 200, f"lock {duration}")["lockedUntil"])
        delta = (until_at - response_time(r)).total_seconds()
        assert hours * SHORT_LOCK_HOUR_S - 1 <= delta <= hours * SHORT_LOCK_HOUR_S + 2, f"{duration} lasted {delta}"
        entry = next(e for e in modlog(visitor(base), name) if e["target"]["id"] == target)
        assert entry["publicReason"] == LOCK_REASONS[duration]

    timed = new_post(base, name, owner)["id"]
    with Stream(base, f"post:{timed}") as live:
        live.ready()
        r = mod_action(owner, "POST", timed, "lock", duration="1h")
        until_at = parse_time(expect_status(r, 200, "lock 1h")["lockedUntil"])
        expect_error(add_comment(member, timed, "blocked"), 409, "LOCKED", "reply during timed lock")
        wait_server_past(base, until_at, "timed lock end")
        assert visitor(base).get(f"/api/posts/{timed}").json()["locked"] is False
        live.wait(lambda s: s.matching("post-state", lambda d: str(d["postId"]) == timed and d["locked"] is False),
                  LIVE_MS / 1000 + 2, "post-state with locked false after expiry")
    expect_status(add_comment(member, timed, "open again"), 201, "reply after expiry")
    actions = [e["action"] for e in modlog(owner, name) if e["target"]["id"] == timed]
    assert actions == ["lock"], "lock expiry must write no entry"


def test_moderator_races_and_pin_slots(app_url: str) -> None:
    owner, second = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, moderators=(second,))
    name = community["name"]
    pid = new_post(app_url, name, owner)["id"]
    version = version_of(owner, pid)
    calls = []
    for i in range(6):
        actor = (owner if i % 2 else second).clone()
        if i % 3 == 0:
            calls.append(lambda m=actor: m.req("POST", f"/api/posts/{pid}/removal", {"version": version, "reason": "spam"}))
        elif i % 3 == 1:
            calls.append(lambda m=actor: m.req("POST", f"/api/posts/{pid}/pin", {"version": version}))
        else:
            calls.append(lambda m=actor: m.req("POST", f"/api/posts/{pid}/lock", {"version": version,
                                                                                   "duration": "indefinite"}))
    results = together(calls)
    winners = [r for r in results if r.status_code == 200]
    assert len(winners) == 1, [r.status_code for r in results]
    for loser in (r for r in results if r.status_code != 200):
        error = expect_error(loser, 409, "CONFLICT", "race loser")
        assert set(error["current"]) == CURRENT_KEYS and error["current"]["version"] == version + 1
    assert len([e for e in modlog(owner, name) if e["target"]["id"] == pid]) == 1
    expect_error(owner.req("POST", f"/api/posts/{pid}/lock", {"version": version, "duration": "1h"}), 409, "CONFLICT",
                 "stale version")
    assert len([e for e in modlog(owner, name) if e["target"]["id"] == pid]) == 1

    name = new_community(app_url, owner, moderators=(second,))["name"]
    a, b, c, d = (new_post(app_url, name, owner)["id"] for _ in range(4))
    expect_status(mod_action(owner, "POST", a, "pin"), 200, "pin a")
    results = together([lambda m=owner.clone(), v=version_of(owner, b): m.req("POST", f"/api/posts/{b}/pin", {"version": v}),
                        lambda m=second.clone(), v=version_of(owner, c): m.req("POST", f"/api/posts/{c}/pin", {"version": v})])
    assert sorted(r.status_code for r in results) == [200, 409]
    loser = next(r for r in results if r.status_code == 409)
    error = expect_error(loser, 409, "SLOT_TAKEN", "last slot race")
    assert all(set(p) == {"id", "title"} for p in error["current"]["pinned"]) and len(error["current"]["pinned"]) == 2
    pinned = [str(p["id"]) for p in visitor(app_url).get(f"/api/communities/{name}/posts").json()["pinned"]]
    assert len(pinned) == 2 and pinned[0] == a
    expect_error(mod_action(owner, "POST", d, "pin"), 409, "SLOT_TAKEN", "third pin")
    expect_status(mod_action(owner, "POST", d, "pin", replacePostId=a), 200, "replace")
    page = visitor(app_url).get(f"/api/communities/{name}/posts").json()
    assert set(str(p["id"]) for p in page["pinned"]) == {pinned[1], d}
    assert not {str(p["id"]) for p in page["pinned"]} & {str(p["id"]) for p in page["items"]}
    expect_status(mod_action(owner, "POST", d, "removal", reason="spam"), 200, "remove a pinned post")
    assert visitor(app_url).get(f"/api/posts/{d}").json()["pinned"] is False


def test_wf_mod_team_revoke_post_page(browser: Browser, app_url: str) -> None:
    owner, moderator = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, moderators=(moderator,))
    name = community["name"]
    post = new_post(app_url, name, owner)
    with tab(browser, app_url, moderator, DESKTOP, post["url"]) as mod_page, \
            tab(browser, app_url, owner, DESKTOP, f"/c/{name}/about/mod") as tools:
        expect(mod_page.get_by_role("button", name="Moderator actions", exact=True)).to_be_visible(timeout=UI_MS)
        live_ready(mod_page)
        tools.get_by_role("tab", name="Moderators", exact=True).click()
        tools.get_by_role("button", name=f"Remove {moderator.username} as moderator", exact=True).click()
        expect(mod_page.get_by_role("button", name="Moderator actions", exact=True)).to_have_count(0, timeout=LIVE_MS)
        announced(mod_page, "Moderator tools removed")
    names = [m["username"] for m in owner.get(f"/api/communities/{name}/moderators").json()["items"]]
    assert moderator.username not in names


def test_wf_mod_team_revoke_mod_log(browser: Browser, app_url: str) -> None:
    owner, moderator = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, moderators=(moderator,))
    name = community["name"]
    pid = new_post(app_url, name, owner)["id"]
    note = "mods-only-" + fresh("n", 8)
    expect_status(mod_action(owner, "POST", pid, "removal", reason="spam", privateNote=note), 200, "remove")
    with tab(browser, app_url, moderator, DESKTOP, f"/c/{name}/about/log") as log:
        table = log.get_by_role("table", name="Moderation log", exact=True)
        expect(table.get_by_role("columnheader", name="Private note", exact=True)).to_be_visible(timeout=UI_MS)
        expect(log.get_by_text(note, exact=True)).to_be_visible()
        live_ready(log)
        expect_status(owner.req("DELETE", f"/api/communities/{name}/moderators/{moderator.username}"), 204, "remove")
        expect(log.get_by_text(note, exact=True)).to_have_count(0, timeout=LIVE_MS)
        expect(table.get_by_role("columnheader", name="Private note", exact=True)).to_have_count(0)
    assert note not in moderator.get(f"/api/communities/{name}/modlog").text


def test_wf_mod_team_add_moderator(browser: Browser, app_url: str) -> None:
    owner, member = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(member,))
    name = community["name"]
    post = new_post(app_url, name, owner)
    with tab(browser, app_url, owner, DESKTOP, f"/c/{name}/about/mod") as tools:
        tools.get_by_role("tab", name="Moderators", exact=True).click()
        tools.get_by_role("textbox", name="Username", exact=True).fill(member.username)
        tools.get_by_role("button", name="Add moderator", exact=True).click()
        expect(tools.get_by_role("button", name=f"Remove {member.username} as moderator", exact=True)).to_be_visible(
            timeout=UI_MS)
    assert member.username in [m["username"] for m in owner.get(f"/api/communities/{name}/moderators").json()["items"]]
    assert modlog(visitor(app_url), name)[0]["action"] == "add_moderator"
    with tab(browser, app_url, member, DESKTOP, post["url"]) as page:
        expect(page.get_by_role("button", name="Moderator actions", exact=True)).to_be_visible(timeout=UI_MS)


def test_wf_mod_team_keyboard_phone(browser: Browser, app_url: str) -> None:
    owner, moderator = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, moderators=(moderator,))
    name = community["name"]
    post = new_post(app_url, name, owner)
    with tab(browser, app_url, moderator, PHONE, post["url"]) as mod_page, \
            tab(browser, app_url, owner, DESKTOP, f"/c/{name}/about/mod") as tools:
        button = mod_page.get_by_role("button", name="Moderator actions", exact=True)
        expect(button).to_be_visible(timeout=UI_MS)
        live_ready(mod_page)
        button.focus()
        mod_page.keyboard.press("Enter")
        expect(mod_page.get_by_role("menuitem").first).to_be_focused(timeout=UI_MS)
        mod_page.keyboard.press("Escape")
        expect(button).to_be_focused()
        tools.get_by_role("tab", name="Moderators", exact=True).click()
        remove = tools.get_by_role("button", name=f"Remove {moderator.username} as moderator", exact=True)
        remove.focus()
        tools.keyboard.press("Enter")
        expect(remove).to_have_count(0, timeout=UI_MS)
        expect(mod_page.get_by_role("button", name="Moderator actions", exact=True)).to_have_count(0, timeout=LIVE_MS)
        announced(mod_page, "Moderator tools removed")
    expect_error(mod_action(moderator, "POST", post["id"], "lock", duration="indefinite"), 403, "FORBIDDEN",
                 "removed moderator")
    assert modlog(visitor(app_url), name)[0]["action"] == "remove_moderator"


def test_wf_mod_team_revoke_moderator_column(browser: Browser, app_url: str) -> None:
    owner, moderator = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, moderators=(moderator,))
    name = community["name"]
    pid = new_post(app_url, name, owner)["id"]
    assert visitor(app_url).get(f"/api/communities/{name}").json()["showModNames"] is False
    expect_status(mod_action(owner, "POST", pid, "lock", duration="indefinite"), 200, "lock")
    with tab(browser, app_url, moderator, DESKTOP, f"/c/{name}/about/log") as log, \
            tab(browser, app_url, owner, DESKTOP, f"/c/{name}/about/mod") as tools:
        table = log.get_by_role("table", name="Moderation log", exact=True)
        column = table.get_by_role("columnheader", name="Moderator", exact=True)
        row = table.get_by_role("row").filter(has_text="Locked thread")
        expect(column).to_be_visible(timeout=UI_MS)
        expect(row.get_by_text(f"u/{owner.username}", exact=True)).to_be_visible()
        live_ready(log)
        tools.get_by_role("tab", name="Moderators", exact=True).click()
        tools.get_by_role("button", name=f"Remove {moderator.username} as moderator", exact=True).click()
        expect(table.get_by_role("columnheader", name="Private note", exact=True)).to_have_count(0, timeout=LIVE_MS)
        expect(column).to_have_count(0, timeout=LIVE_MS)
        expect(row.get_by_text(f"u/{owner.username}", exact=True)).to_have_count(0)
    assert modlog(moderator, name)[0]["moderator"] is None


def test_wf_mod_team_revoke_other_community(browser: Browser, app_url: str) -> None:
    owner, moderator = new_member(app_url), new_member(app_url)
    left = new_community(app_url, owner, moderators=(moderator,))["name"]
    kept = new_community(app_url, owner, moderators=(moderator,))["name"]
    post = new_post(app_url, kept, owner)
    with tab(browser, app_url, moderator, DESKTOP, post["url"]) as mod_page, \
            tab(browser, app_url, owner, DESKTOP, f"/c/{left}/about/mod") as tools, \
            Stream(app_url, "home", token=moderator.token) as live:
        button = mod_page.get_by_role("button", name="Moderator actions", exact=True)
        expect(button).to_be_visible(timeout=UI_MS)
        live_ready(mod_page)
        live.ready()
        tools.get_by_role("tab", name="Moderators", exact=True).click()
        remove = tools.get_by_role("button", name=f"Remove {moderator.username} as moderator", exact=True)
        remove.click()
        expect(remove).to_have_count(0, timeout=UI_MS)
        live.wait(lambda s: s.matching("account", lambda d: d.get("kind") == "moderator-removed"
                                                and d.get("communityName") == left),
                  LIVE_MS / 1000 + 2, "moderator-removed for the other community")
        expect_status(mod_action(owner, "POST", post["id"], "lock", duration="indefinite"), 200, "lock kept post")
        announced(mod_page, "Thread locked")
        expect(button).to_be_visible()
    expect_status(mod_action(moderator, "DELETE", post["id"], "lock"), 200, "still a moderator of the kept community")


def test_moderator_roles(app_url: str) -> None:
    owner, moderator, member = new_member(app_url), new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, moderators=(moderator,), members=(member,))
    name = community["name"]
    pid = new_post(app_url, name, owner)["id"]
    expect_error(moderator.req("POST", f"/api/communities/{name}/moderators", {"username": member.username}), 403,
                 "FORBIDDEN", "moderator adding a moderator")
    expect_error(member.get(f"/api/communities/{name}/moderators"), 403, "FORBIDDEN", "member reading moderators")
    expect_error(mod_action(member, "POST", pid, "lock", duration="indefinite"), 403, "FORBIDDEN", "member lock")
    added = expect_status(owner.req("POST", f"/api/communities/{name}/moderators", {"username": member.username}), 201,
                          "add")
    assert added == {"username": member.username, "isOwner": False}
    expect_error(owner.req("POST", f"/api/communities/{name}/moderators", {"username": member.username}), 409,
                 "CONFLICT", "add twice")
    expect_error(owner.req("POST", f"/api/communities/{name}/moderators", {"username": fresh("z", 16)}), 404,
                 "NOT_FOUND", "unknown user")
    expect_error(owner.req("DELETE", f"/api/communities/{name}/moderators/{owner.username}"), 409, "CONFLICT", "owner")
    outsider = new_member(app_url)
    expect_error(owner.req("DELETE", f"/api/communities/{name}/moderators/{outsider.username}"), 409, "CONFLICT",
                 "non-moderator")
    listed = owner.get(f"/api/communities/{name}/moderators").json()["items"]
    assert {"username": owner.username, "isOwner": True} in listed
    with Stream(app_url, "home", token=moderator.token) as live:
        live.ready()
        expect_status(owner.req("DELETE", f"/api/communities/{name}/moderators/{moderator.username}"), 204, "remove")
        live.wait(lambda s: s.matching("account", lambda d: d == {"kind": "moderator-removed", "communityName": name}),
                  LIVE_MS / 1000 + 2, "moderator-removed account event")
    expect_error(mod_action(moderator, "POST", pid, "lock", duration="indefinite"), 403, "FORBIDDEN", "removed mod")
    assert visitor(app_url).get(f"/api/posts/{pid}").json()["locked"] is False


@pytest.mark.timeout(600)
def test_wf_account_security_2fa_setup(browser: Browser, app_url: str) -> None:
    owner, moderator = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, moderators=(moderator,), member_count=MOD_2FA_THRESHOLD + 1)
    name = community["name"]
    pid = new_post(app_url, name, owner)["id"]
    expect_error(mod_action(moderator, "POST", pid, "lock", duration="indefinite"), 403, "TOTP_REQUIRED", "before 2FA")
    equal = new_community(app_url, new_member(app_url), moderators=(moderator,), member_count=MOD_2FA_THRESHOLD)
    equal_post = new_post(app_url, equal["name"], moderator)["id"]
    expect_status(mod_action(moderator, "POST", equal_post, "lock", duration="indefinite"), 200, "threshold equal")
    with tab(browser, app_url, moderator, DESKTOP, f"/c/{name}/about/mod") as page:
        page.wait_for_url(re.compile(r"/settings/2fa\?next="), timeout=UI_MS)
        expect(page.get_by_role("heading", name="Set up two-factor authentication", exact=True)).to_be_visible()
        secret = by_id(page, "totp-secret").inner_text().strip()
        assert re.fullmatch(r"[A-Z2-7]+", secret) and len(secret) == TOTP_SECRET_CHARS, secret
        box = page.get_by_role("textbox", name="Authentication code", exact=True)
        box.fill(wrong_code(secret, server_now(app_url)))
        page.get_by_role("button", name="Turn on two-factor authentication", exact=True).click()
        expect(page.get_by_text("That code didn't match", exact=True).first).to_be_visible(timeout=UI_MS)
        box.fill(totp_code(secret, server_now(app_url)))
        page.get_by_role("button", name="Turn on two-factor authentication", exact=True).click()
        announced_anywhere(page, "Two-factor authentication is on")
        page.wait_for_url(re.compile(rf"/c/{name}/about/mod"), timeout=UI_MS)
    assert moderator.get("/api/me").json()["totpEnabled"] is True
    expect_status(mod_action(moderator, "POST", pid, "lock", duration="indefinite"), 200, "after 2FA")
    with tab(browser, app_url, None, DESKTOP, "/login") as login:
        login.get_by_role("textbox", name="Email or username", exact=True).fill(moderator.username)
        login.get_by_label("Password", exact=True).fill(moderator.password)
        login.get_by_role("button", name="Sign in", exact=True).click()
        code = login.get_by_role("textbox", name="Authentication code", exact=True)
        expect(code).to_be_visible(timeout=UI_MS)
        code.fill(totp_code(secret, server_now(app_url)))
        login.get_by_role("button", name="Verify", exact=True).click()
        login.wait_for_url(lambda url: "/login" not in url, timeout=UI_MS)
        assert login.request.get(app_url + "/api/me").json()["username"] == moderator.username


@pytest.mark.timeout(600)
def test_wf_account_security_lockout_reset(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url
    member = new_member(base, sign_in=False)
    with tab(browser, base, None, DESKTOP, "/login") as page:
        for attempt in range(1, LOCKOUT_ATTEMPTS + 1):
            page.get_by_role("textbox", name="Email or username", exact=True).fill(member.username)
            page.get_by_label("Password", exact=True).fill("wrong-" + secrets.token_hex(4))
            page.get_by_role("button", name="Sign in", exact=True).click()
            copy = ("Too many failed sign-ins. Try again later or reset your password." if attempt == LOCKOUT_ATTEMPTS
                    else "Email or password is incorrect")
            announced(page, copy, alert=True)
        lockout = wait_mail(mail, member.email, "Sign-in attempts on your Moothall account")
        body = text(lockout[0])
        assert "Your account was locked after repeated failed sign-ins." in body and "/forgot" in body
        page.goto(base + "/forgot")
        page.get_by_role("textbox", name="Email", exact=True).fill(member.email)
        page.get_by_role("button", name="Send reset link", exact=True).click()
        expect(page.get_by_role("heading", name="Check your inbox", exact=True)).to_be_visible(timeout=UI_MS)
        path = token_path(text(wait_mail(mail, member.email, "Reset your Moothall password")[0]), "/reset")
        page.goto(base + path)
        new_password = fresh_password()
        page.get_by_label("New password", exact=True).fill(new_password)
        page.get_by_role("button", name="Set new password", exact=True).click()
        expect(page.get_by_role("heading", name="Password updated", exact=True)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("link", name="Sign in", exact=True).first).to_be_visible()
    assert len(mails_for(mail, member.email, "Sign-in attempts on your Moothall account")) == 1
    r = visitor(base).post("/api/auth/login", json={"login": member.username, "password": new_password})
    expect_status(r, 200, "sign-in after reset clears the lock")


@pytest.mark.timeout(600)
def test_wf_account_security_reset_expired_wrong_clock(browser: Browser, mail: Any) -> None:
    base = short_url()
    member = new_member(base, sign_in=False)
    r = visitor(base).post("/api/auth/password-reset", json={"email": member.email})
    expect_status(r, 202, "request reset")
    issued = response_time(r)
    path = token_path(text(wait_mail(mail, member.email, "Reset your Moothall password")[0]), "/reset")
    wait_server_past(base, issued + timedelta(seconds=SHORT_RESET_TTL_S), "reset link expiry")
    with tab(browser, base, None, DESKTOP, path, clock_at=issued) as page:
        page.get_by_label("New password", exact=True).fill(fresh_password())
        page.get_by_role("button", name="Set new password", exact=True).click()
        expect(page.get_by_text("This link has expired or was already used", exact=True).first).to_be_visible(
            timeout=UI_MS)
    expect_status(visitor(base).post("/api/auth/login", json={"login": member.username, "password": member.password}),
                  200, "old password still works")


def test_wf_account_security_keyboard_signin(browser: Browser, app_url: str) -> None:
    member = new_member(app_url, totp_on=True, sign_in=False)
    secret = member.secret
    assert secret, "the grading route returns the secret of a two-factor member"
    with tab(browser, app_url, None, PHONE, "/login") as page:
        login = page.get_by_role("textbox", name="Email or username", exact=True)
        login.focus()
        page.keyboard.type(member.username)
        page.keyboard.press("Tab")
        password = page.get_by_label("Password", exact=True)
        expect(password).to_be_focused()
        page.keyboard.type(member.password)
        page.keyboard.press("Enter")
        code = page.get_by_role("textbox", name="Authentication code", exact=True)
        expect(code).to_be_visible(timeout=UI_MS)
        expect(page.get_by_text("Enter the 6-digit code from your authenticator app", exact=True).first).to_be_visible()
        code.fill(wrong_code(secret, server_now(app_url)))
        code.press("Enter")
        field_error(code, "That code didn't match")
        expect(code).to_be_focused()
        code.fill(totp_code(secret, server_now(app_url)))
        code.press("Enter")
        page.wait_for_url(lambda url: "/login" not in url, timeout=UI_MS)
        assert page.request.get(app_url + "/api/me").json()["username"] == member.username


@pytest.mark.timeout(600)
def test_login_totp_and_lockout(mail: Any) -> None:
    base = short_url()
    member = new_member(base, totp_on=True, sign_in=False)
    secret = member.secret or ""
    login = lambda **extra: visitor(base).post("/api/auth/login", json={"login": member.username,
                                                                        "password": member.password, **extra})
    error = expect_error(login(), 401, "TOTP_REQUIRED", "missing code")
    assert error["message"] == "Enter the 6-digit code from your authenticator app"
    expect_error(login(totp="12345"), 422, "VALIDATION", "five digits",
                 {"totp": "Enter the 6-digit code from your authenticator app"})
    expect_error(login(totp=wrong_code(secret, server_now(base))), 401, "UNAUTHENTICATED", "wrong code",
                 {"totp": "That code didn't match"})
    r = login(totp=totp_code(secret, server_now(base)))
    account = expect_status(r, 200, "right code")
    assert set(account) == OWN_ACCOUNT_KEYS and account["totpEnabled"] is True
    assert session_cookie_ok(r.headers.get("set-cookie", ""))

    plain = new_member(base, sign_in=False)
    expect_status(visitor(base).post("/api/auth/login", json={"login": plain.email.upper(), "password": plain.password,
                                                              "totp": "abc"}), 200, "email login ignores totp")
    setup_client = plain.clone()
    expect_status(setup_client.sign_in(), 200, "sign in")
    setup = expect_status(setup_client.req("POST", "/api/me/totp/setup"), 200, "setup")
    assert re.fullmatch(r"[A-Z2-7]{32}", setup["secret"])
    assert setup["otpauthUri"] == (f"otpauth://totp/Moothall:{plain.username}?secret={setup['secret']}"
                                   f"&issuer=Moothall")
    expect_error(setup_client.req("POST", "/api/me/totp/enable", {"code": wrong_code(setup["secret"], server_now(base))}),
                 422, "VALIDATION", "wrong enable code", {"code": None})
    expect_status(setup_client.req("POST", "/api/me/totp/enable", {"code": totp_code(setup["secret"], server_now(base))}),
                  200, "enable")
    expect_error(setup_client.req("POST", "/api/me/totp/setup"), 409, "CONFLICT", "setup when on")

    target = new_member(base, sign_in=False)
    bad = {"login": target.username, "password": "wrong-password-x"}
    expect_error(visitor(base).post("/api/auth/login", json={"login": fresh("z", 16), "password": "x" * 12}), 401,
                 "UNAUTHENTICATED", "unknown login")
    for _ in range(LOCKOUT_ATTEMPTS - 1):
        expect_error(visitor(base).post("/api/auth/login", json=bad), 401, "UNAUTHENTICATED", "failure")
    r = visitor(base).post("/api/auth/login", json=bad)
    expect_error(r, 429, "RATE_LIMITED", "failure that locks")
    locked_at = response_time(r)
    assert 1 <= int(r.headers["retry-after"]) <= SHORT_LOCKOUT_S
    r = visitor(base).post("/api/auth/login", json={"login": target.username, "password": target.password})
    expect_error(r, 429, "RATE_LIMITED", "right password during lock")
    expect_error(visitor(base).post("/api/auth/login", json=bad), 429, "RATE_LIMITED", "another failure during lock")
    wait_mail(mail, target.email, "Sign-in attempts on your Moothall account")
    assert len(mails_for(mail, target.email, "Sign-in attempts on your Moothall account")) == 1
    wait_server_past(base, locked_at + timedelta(seconds=SHORT_LOCKOUT_S), "lockout end")
    expect_status(visitor(base).post("/api/auth/login", json={"login": target.username, "password": target.password}),
                  200, "sign-in after the lock")


@pytest.mark.timeout(600)
def test_password_reset(mail: Any) -> None:
    base = short_url()
    member = new_member(base)
    second = member.clone()
    expect_status(second.sign_in(), 200, "second session")
    stranger = fresh_email(fresh("z", 16))
    assert expect_status(visitor(base).post("/api/auth/password-reset", json={"email": stranger}), 202, "unknown") == {
        "sent": True}
    subject = "Reset your Moothall password"
    expect_status(visitor(base).post("/api/auth/password-reset", json={"email": member.email}), 202, "reset 1")
    old = token_of(token_path(text(wait_mail(mail, member.email, subject)[0]), "/reset"))
    expect_status(visitor(base).post("/api/auth/password-reset", json={"email": member.email.upper()}), 202, "reset 2")
    tokens = {token_of(token_path(text(m), "/reset")) for m in wait_mail(mail, member.email, subject, 2)}
    newest = next(t for t in tokens if t != old)
    assert mails_for(mail, stranger, subject) == []
    new_password = fresh_password()
    expect_error(visitor(base).post("/api/auth/password-reset/confirm", json={"token": old, "newPassword": new_password}),
                 422, "VALIDATION", "superseded token", {"token": None})
    expect_error(visitor(base).post("/api/auth/password-reset/confirm", json={"token": newest, "newPassword": "short"}),
                 422, "VALIDATION", "short password", {"newPassword": "Passwords are 10 to 128 characters"})
    confirmer = visitor(base)
    r = confirmer.post("/api/auth/password-reset/confirm", json={"token": newest, "newPassword": new_password})
    assert expect_status(r, 200, "confirm") == {"reset": True}
    assert confirmer.cookies.get(COOKIE_NAME) is None, "confirming a reset must not sign anyone in"
    for client in (member, second):
        expect_error(client.get("/api/me"), 401, "UNAUTHENTICATED", "old session after reset")
    expect_error(visitor(base).post("/api/auth/password-reset/confirm", json={"token": newest, "newPassword": new_password}),
                 422, "VALIDATION", "reused token", {"token": None})
    expect_error(visitor(base).post("/api/auth/login", json={"login": member.username, "password": member.password}),
                 401, "UNAUTHENTICATED", "old password")
    expect_status(visitor(base).post("/api/auth/login", json={"login": member.username, "password": new_password}),
                  200, "new password")
    r = visitor(base).post("/api/auth/password-reset", json={"email": member.email})
    wait_mail(mail, member.email, subject, 3)
    latest = {token_of(token_path(text(m), "/reset")) for m in mails_for(mail, member.email, subject)} - tokens
    wait_server_past(base, response_time(r) + timedelta(seconds=SHORT_RESET_TTL_S), "reset link expiry")
    expect_error(visitor(base).post("/api/auth/password-reset/confirm",
                                    json={"token": latest.pop(), "newPassword": fresh_password()}),
                 422, "VALIDATION", "expired link", {"token": None})


def test_wf_restricted_community_approve_live(browser: Browser, app_url: str) -> None:
    owner, member = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(member,), kind="restricted")
    name = community["name"]
    title = "Approved " + fresh("t", 8)
    with tab(browser, app_url, member, DESKTOP, f"/c/{name}/submit") as composer:
        notice = composer.get_by_text("Approved posters only", exact=True).first
        expect(notice).to_be_visible(timeout=UI_MS)
        live_ready(composer)
        with tab(browser, app_url, owner, DESKTOP, f"/c/{name}/about/mod") as tools:
            tools.get_by_role("tab", name="Approved posters", exact=True).click()
            tools.get_by_role("textbox", name="Username", exact=True).fill(member.username)
            tools.get_by_role("button", name="Approve", exact=True).click()
            expect(tools.get_by_role("button", name=f"Remove approval for {member.username}", exact=True,
                                     include_hidden=True)).to_have_count(1, timeout=UI_MS)
        announced(composer, f"You can now post in c/{name}", timeout=LIVE_MS)
        notices = composer.get_by_text("Approved posters only", exact=True)
        eventually(lambda: not notices.evaluate_all("els => els.some(e => e.checkVisibility())"),
                   "the Approved posters only notice is gone")
        composer.get_by_role("textbox", name="Title", exact=True).fill(title)
        composer.get_by_role("button", name="Post", exact=True).click()
        composer.wait_for_url(re.compile(r"/post/\d+$"), timeout=UI_MS)
    assert member.get(f"/api/communities/{name}").json()["viewer"]["canPost"] is True
    assert len(posts_titled(member, member.username, title)) == 1


def test_wf_restricted_community_member_count(browser: Browser, app_url: str) -> None:
    owner, member = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner)
    name = community["name"]
    with tab(browser, app_url, None, DESKTOP, f"/c/{name}") as watcher, \
            tab(browser, app_url, member, DESKTOP, f"/c/{name}") as page:
        counter = by_id(page, f"members-{name}")
        expect(counter).to_have_text("1 member", timeout=UI_MS)
        live_ready(watcher)
        join = page.get_by_role("button", name=re.compile(r"^(Join|Joined)$"))
        expect(join).to_have_attribute("aria-pressed", "false")
        join.click()
        expect(join).to_have_attribute("aria-pressed", "true")
        expect(join).to_have_text("Joined")
        expect(counter).to_have_text("2 members")
        expect(by_id(watcher, f"members-{name}")).to_have_text("2 members", timeout=LIVE_MS)
        assert visitor(app_url).get(f"/api/communities/{name}").json()["memberCount"] == 2
        join.click()
        expect(join).to_have_attribute("aria-pressed", "false")
        expect(counter).to_have_text("1 member")
        expect(by_id(watcher, f"members-{name}")).to_have_text("1 member", timeout=LIVE_MS)
    assert visitor(app_url).get(f"/api/communities/{name}").json()["memberCount"] == 1


def test_wf_restricted_community_create(browser: Browser, app_url: str) -> None:
    creator = new_member(app_url)
    name = fresh("c", 15)
    with tab(browser, app_url, creator, DESKTOP, "/communities/new") as page:
        name_box = page.get_by_role("textbox", name="Name", exact=True)
        name_box.fill("Admin")
        page.get_by_role("textbox", name="Title", exact=True).fill("A quiet place")
        page.get_by_role("radio", name="Restricted", exact=True).check()
        page.get_by_role("button", name="Create community", exact=True).click()
        field_error(name_box, "That name is reserved")
        name_box.fill(name)
        page.get_by_role("textbox", name="Description", exact=True).fill("Made in a test.")
        page.get_by_role("button", name="Create community", exact=True).click()
        page.wait_for_url(re.compile(rf"/c/{name}$"), timeout=UI_MS)
    made = creator.get(f"/api/communities/{name}").json()
    assert made["type"] == "restricted" and made["viewer"]["isOwner"] is True and made["memberCount"] == 1


def test_wf_restricted_community_keyboard_phone(browser: Browser, app_url: str) -> None:
    owner, member = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, members=(member,), kind="restricted")
    name = community["name"]
    title = "Keyboard " + fresh("t", 8)
    with tab(browser, app_url, member, PHONE, f"/c/{name}/submit") as composer:
        expect(composer.get_by_text("Approved posters only", exact=True).first).to_be_visible(timeout=UI_MS)
        live_ready(composer)
        with tab(browser, app_url, owner, DESKTOP, f"/c/{name}/about/mod") as tools:
            tools.get_by_role("tab", name="Approved posters", exact=True).click()
            field = tools.get_by_role("textbox", name="Username", exact=True)
            field.fill(member.username)
            field.press("Enter")
            expect(tools.get_by_role("button", name=f"Remove approval for {member.username}", exact=True,
                                     include_hidden=True)).to_have_count(1, timeout=UI_MS)
        announced(composer, f"You can now post in c/{name}", timeout=LIVE_MS)
        notices = composer.get_by_text("Approved posters only", exact=True)
        eventually(lambda: not notices.evaluate_all("els => els.some(e => e.checkVisibility())"),
                   "the Approved posters only notice is gone")
        title_box = composer.get_by_role("textbox", name="Title", exact=True)
        title_box.focus()
        composer.keyboard.type(title)
        composer.get_by_role("button", name="Post", exact=True).focus()
        composer.keyboard.press("Enter")
        composer.wait_for_url(re.compile(r"/post/\d+$"), timeout=UI_MS)
    assert len(posts_titled(member, member.username, title)) == 1
    assert modlog(visitor(app_url), name)[0]["action"] == "approve_poster"


def test_community_creation_rules(app_url: str) -> None:
    creator = new_member(app_url)

    def create(member: Member, name: str, **extra: Any) -> httpx.Response:
        return member.req("POST", "/api/communities", {"name": name, "title": "Title", "description": "",
                                                       "type": "public", **extra})

    for bad in ("ab", "has-hyphen", "x" * (NAME_MAX + 1), "sp ace"):
        expect_error(create(creator, bad), 422, "VALIDATION", f"name {bad!r}",
                     {"name": "Names are 3 to 21 letters, digits or underscores"})
    for word in RESERVED:
        if len(word) >= 3:
            expect_error(create(creator, word.upper()), 409, "RESERVED", f"reserved {word}",
                         {"name": "That name is reserved"})
    name = "Mx" + fresh("c", 13)
    made = expect_status(create(creator, name), 201, "create")
    assert set(made) == COMMUNITY_KEYS and made["name"] == name and made["memberCount"] == 1
    assert made["viewer"] == {"joined": True, "isModerator": True, "isOwner": True, "canPost": True}
    assert visitor(app_url).get(f"/api/communities/{name.lower()}").json()["name"] == name
    expect_error(create(creator, name.lower()), 409, "NAME_TAKEN", "case-insensitive duplicate",
                 {"name": "That name is taken"})
    for extra, field in (({"title": ""}, "title"), ({"title": "t" * (COMMUNITY_TITLE_MAX + 1)}, "title"),
                         ({"type": "secret"}, "type")):
        expect_error(create(creator, fresh("c", 15), **extra), 422, "VALIDATION", f"bad {field}", {field: None})
    young = new_member(app_url, age=COMMUNITY_AGE_DAYS - 1)
    expect_error(create(young, fresh("c", 15)), 403, "NOT_ELIGIBLE", "young account")
    expect_error(create(young, "admin"), 403, "NOT_ELIGIBLE", "age gate precedes the reserved check")
    exact = new_member(app_url, age=COMMUNITY_AGE_DAYS)
    expect_status(create(exact, fresh("c", 15)), 201, "account exactly at the age gate")
    for _ in range(OWNED_LIMIT - 1):
        expect_status(create(creator, fresh("c", 15)), 201, "owned community")
    sixth = fresh("c", 15)
    expect_error(create(creator, sixth), 403, "NOT_ELIGIBLE", "sixth community")
    assert visitor(app_url).get(f"/api/communities/{sixth}").status_code == 404


def test_membership_and_approved_posters(app_url: str) -> None:
    owner, member, commenter = new_member(app_url), new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner, kind="restricted", members=(commenter,))
    name = community["name"]
    base_count = visitor(app_url).get(f"/api/communities/{name}").json()["memberCount"]
    results = together([lambda m=member.clone(): m.req("PUT", f"/api/communities/{name}/membership") for _ in range(5)])
    assert all(r.json() == {"joined": True, "memberCount": base_count + 1} for r in results), [r.text for r in results]
    assert expect_status(member.req("PUT", f"/api/communities/{name}/membership"), 200, "join again") == {
        "joined": True, "memberCount": base_count + 1}
    assert visitor(app_url).get(f"/api/communities/{name}").json()["memberCount"] == base_count + 1
    assert expect_status(member.req("DELETE", f"/api/communities/{name}/membership"), 200, "leave") == {
        "joined": False, "memberCount": base_count}
    assert expect_status(member.req("DELETE", f"/api/communities/{name}/membership"), 200, "leave again") == {
        "joined": False, "memberCount": base_count}
    expect_error(owner.req("DELETE", f"/api/communities/{name}/membership"), 409, "CONFLICT", "owner leaves")

    title = "Restricted " + fresh("t", 8)
    expect_error(create_post(member, name, title), 403, "NOT_APPROVED", "unapproved post")
    assert posts_titled(member, member.username, title) == []
    approved = owner.req("PUT", f"/api/communities/{name}/approved/{member.username}")
    assert expect_status(approved, 200, "approve") == {"username": member.username, "approved": True}
    assert expect_status(owner.req("PUT", f"/api/communities/{name}/approved/{member.username}"), 200, "again") == {
        "username": member.username, "approved": True}
    expect_error(owner.req("PUT", f"/api/communities/{name}/approved/{fresh('z', 16)}"), 404, "NOT_FOUND", "unknown")
    assert member.username in [a["username"] for a in owner.get(f"/api/communities/{name}/approved").json()["items"]]
    pid = str(expect_status(create_post(member, name, title), 201, "approved post")["id"])
    expect_status(create_post(owner, name, "Mod " + fresh("t", 8)), 201, "moderator post")
    expect_status(add_comment(commenter, pid, "Anyone verified may comment."), 201, "comment")
    for _ in range(2):
        assert expect_status(owner.req("DELETE", f"/api/communities/{name}/approved/{member.username}"), 200,
                             "unapprove") == {"username": member.username, "approved": False}
    expect_error(create_post(member, name, "Again " + fresh("t", 8)), 403, "NOT_APPROVED", "after unapproval")


@pytest.mark.timeout(900)
def test_wf_illegal_report_visitor_to_suspension(browser: Browser, app_url: str, mail: Any) -> None:
    owner, author = new_member(app_url), new_member(app_url)
    admin = new_member(app_url, role="admin", totp_on=True)
    community = new_community(app_url, owner, members=(author,))
    post = new_post(app_url, community["name"], author)
    reporter = fresh_email(fresh("r", 16))
    with tab(browser, app_url, None, DESKTOP, post["url"]) as page:
        menu_item(page, page.get_by_role("button", name="More actions", exact=True).first, "Report illegal content")
        dialog = page.get_by_role("dialog", name="Report illegal content", exact=True)
        expect(dialog).to_be_visible(timeout=UI_MS)
        dialog.get_by_role("radio", name="Hate speech or incitement", exact=True).focus()
        for _ in range(4):
            page.keyboard.press("ArrowDown")
        expect(dialog.get_by_role("radio", name="Privacy violation", exact=True)).to_be_checked()
        dialog.get_by_role("textbox", name="Explain why this is illegal", exact=True).focus()
        page.keyboard.type("It publishes a private home address.")
        dialog.get_by_role("textbox", name="Your email", exact=True).focus()
        page.keyboard.type(reporter)
        dialog.get_by_role("checkbox", name="I believe this report is accurate and complete", exact=True).focus()
        page.keyboard.press("Space")
        dialog.get_by_role("button", name="Send report", exact=True).focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name="Report received", exact=True)).to_be_visible(timeout=UI_MS)
        shown = page.get_by_text(re.compile(r"Your reference is MH-[A-Z0-9]{8}")).first.inner_text()
        reference = re.search(r"MH-[A-Z0-9]{8}", shown).group(0)
        expect(page.get_by_role("button", name="Close", exact=True)).to_be_focused()
        announced(page, f"Report sent. Reference {reference}")
    confirmation = text(wait_mail(mail, reporter, f"Report received: {reference}")[0])
    assert reference in confirmation and "We will review your report." in confirmation

    with tab(browser, app_url, author, DESKTOP, post["url"]) as author_tab, \
            tab(browser, app_url, admin, DESKTOP, "/admin/reports") as queue:
        live_ready(author_tab)
        expect(by_id(queue, f"report-{reference}")).to_be_visible(timeout=UI_MS)
        cell = by_id(queue, f"deadline-{reference}")
        expect(cell).to_have_text(re.compile(r"^\s*Due in \d+ h \d+ min\s*$"))
        raw = admin.get("/api/admin/reports?status=open")
        item = next(i for i in raw.json()["items"] if i["reference"] == reference)
        assert set(item) == REPORT_KEYS and item["category"] == "privacy" and reporter not in raw.text.lower()
        seconds = item["secondsRemaining"]
        options = set()
        for s in range(seconds, seconds + 120):
            minutes = -(-s // 60)
            options.add(f"Due in {minutes // 60} h {minutes % 60} min")
        assert cell.inner_text().strip() in options, f"deadline cell {cell.inner_text()!r} vs server {seconds}s"
        queue.get_by_role("button", name=f"Suspend {author.username}", exact=True).click()
        dialog = queue.get_by_role("dialog", name="Suspend account", exact=True)
        dialog.get_by_role("textbox", name="Reason", exact=True).fill("Repeated illegal posts.")
        dialog.get_by_role("button", name="Suspend", exact=True).click()
        announced(author_tab, "Your account has been suspended", timeout=LIVE_MS, alert=True)
        expect(author_tab.get_by_role("link", name="Sign in", exact=True)).to_be_visible(timeout=LIVE_MS)
    expect_error(author.get("/api/me"), 403, "SUSPENDED", "suspended session")


def test_wf_illegal_report_wrong_clock_deadline(browser: Browser, app_url: str) -> None:
    owner = new_member(app_url)
    admin = new_member(app_url, role="admin", totp_on=True)
    community = new_community(app_url, owner)
    post = new_post(app_url, community["name"], owner)
    reference = expect_status(file_report(app_url, post["id"], reporter=fresh_email(fresh("r", 16))), 201,
                              "report")["reference"]
    with tab(browser, app_url, admin, DESKTOP, "/admin/reports",
             clock_at=server_now(app_url) + timedelta(days=2)) as queue:
        cell = by_id(queue, f"deadline-{reference}")
        expect(cell).to_have_text(re.compile(r"^\s*Due in \d+ h \d+ min\s*$"), timeout=UI_MS)
        grading(app_url, f"/reports/{reference}/age", {"seconds": REPORT_DEADLINE_S + 60}, status=200)
        item = next(i for i in admin.get("/api/admin/reports?status=open").json()["items"] if i["reference"] == reference)
        assert item["overdue"] is True
        expect(cell).to_have_text(re.compile(r"^\s*Due in"))
        queue.clock.run_for(QUEUE_REFRESH_MS)
        expect(cell).to_have_text("Overdue", timeout=UI_MS)


def test_wf_illegal_report_dialog_validation(browser: Browser, app_url: str) -> None:
    owner = new_member(app_url)
    admin = new_member(app_url, role="admin", totp_on=True)
    community = new_community(app_url, owner)
    post = new_post(app_url, community["name"], owner)
    with tab(browser, app_url, None, DESKTOP, post["url"]) as page:
        button = page.get_by_role("button", name="More actions", exact=True).first
        menu_item(page, button, "Report illegal content")
        dialog = page.get_by_role("dialog", name="Report illegal content", exact=True)
        dialog.get_by_role("button", name="Send report", exact=True).click()
        for copy in ("Choose a type", "Explain why this is illegal", "Enter a valid email address",
                     "Confirm the statement to send"):
            expect(dialog.get_by_text(copy, exact=True).first).to_be_visible(timeout=UI_MS)
        field_error(dialog.get_by_role("textbox", name="Your email", exact=True), "Enter a valid email address")
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(button).to_be_focused()
    items = admin.get(f"/api/admin/reports?status={STATUS_ALL}").json()["items"]
    assert not [i for i in items if str(i["target"]["id"]) == post["id"]]


@pytest.mark.timeout(600)
def test_report_deadlines_and_privacy(mail: Any) -> None:
    base = short_url()
    owner, member = new_member(base), new_member(base)
    admin = new_member(base, role="admin", totp_on=True)
    no_totp = new_member(base, role="admin")
    community = new_community(base, owner, members=(member,))
    pid = new_post(base, community["name"], owner)["id"]
    good = {"targetType": "post", "targetId": pid, "category": "hate", "explanation": "Incites violence.",
            "goodFaith": True, "reporterEmail": fresh_email(fresh("r", 16))}
    for change, field in (({"category": None}, "category"), ({"explanation": ""}, "explanation"),
                          ({"explanation": "e" * (EXPLANATION_MAX + 1)}, "explanation"),
                          ({"reporterEmail": "nope"}, "reporterEmail"), ({"reporterEmail": None}, "reporterEmail"),
                          ({"goodFaith": False}, "goodFaith")):
        body = {k: v for k, v in {**good, **change}.items() if v is not None}
        expect_error(visitor(base).post("/api/reports", json=body), 422, "VALIDATION", f"report {field}", {field: None})
    reporter = good["reporterEmail"]
    r = visitor(base).post("/api/reports", json=good)
    filed = expect_status(r, 201, "visitor report")
    assert set(filed) == {"reference", "deadlineAt"} and REFERENCE_RE.match(filed["reference"])
    by_member = expect_status(file_report(base, pid, member=member), 201, "member report")
    raw = admin.get("/api/admin/reports?status=open")
    queue = expect_status(raw, 200, "queue")
    wait_mail(mail, reporter, f"Report received: {filed['reference']}")
    wait_mail(mail, member.email, f"Report received: {by_member['reference']}")
    assert reporter not in raw.text.lower() and member.email not in raw.text.lower()
    mine = {i["reference"]: i for i in queue["items"]}
    item = mine[filed["reference"]]
    assert set(item) == REPORT_KEYS and set(item["target"]) == {"type", "id", "url"}
    assert item["target"]["url"] == f"/c/{community['name']}/post/{pid}"
    assert (parse_time(item["deadlineAt"]) - parse_time(item["createdAt"])).total_seconds() == SHORT_DEADLINE_S
    expected = (parse_time(item["deadlineAt"]) - parse_time(queue["serverTime"])).total_seconds()
    assert abs(item["secondsRemaining"] - expected) <= 1 and item["overdue"] is False
    deadlines = [parse_time(i["deadlineAt"]) for i in queue["items"]]
    assert deadlines == sorted(deadlines)

    wait_server_past(base, parse_time(item["deadlineAt"]), "report deadline")
    late = next(i for i in admin.get("/api/admin/reports?status=open").json()["items"]
                if i["reference"] == filed["reference"])
    assert late["overdue"] is True and late["secondsRemaining"] <= 0
    resolved = expect_status(admin.req("POST", f"/api/admin/reports/{filed['reference']}/resolve",
                                       {"outcome": "actioned"}), 200, "resolve")
    assert resolved["status"] == "actioned" and set(resolved) == REPORT_KEYS
    expect_error(admin.req("POST", f"/api/admin/reports/{filed['reference']}/resolve", {"outcome": "dismissed"}), 409,
                 "CONFLICT", "resolve twice")
    assert filed["reference"] not in [i["reference"] for i in admin.get("/api/admin/reports?status=open").json()["items"]]
    assert filed["reference"] in [i["reference"] for i in admin.get(f"/api/admin/reports?status={STATUS_ALL}").json()["items"]]
    expect_error(member.get("/api/admin/reports"), 403, "FORBIDDEN", "member queue")
    expect_error(no_totp.get("/api/admin/reports"), 403, "TOTP_REQUIRED", "admin without 2FA")
    aged = grading(base, f"/reports/{by_member['reference']}/age", {"seconds": 5}, status=200)
    assert (parse_time(aged["deadlineAt"]) - parse_time(aged["createdAt"])).total_seconds() == SHORT_DEADLINE_S


def test_account_suspension(app_url: str) -> None:
    owner, target = new_member(app_url), new_member(app_url)
    admin = new_member(app_url, role="admin", totp_on=True)
    community = new_community(app_url, owner, members=(target,))
    pid = str(expect_status(create_post(target, community["name"], "Stays " + fresh("t", 8)), 201, "post")["id"])
    second = target.clone()
    expect_status(second.sign_in(), 200, "second session")
    expect_error(owner.req("POST", f"/api/admin/users/{target.username}/suspension", {"reason": "x"}), 403,
                 "FORBIDDEN", "non-admin suspends")
    with Stream(app_url, "home", token=target.token) as live:
        live.ready()
        done = admin.req("POST", f"/api/admin/users/{target.username}/suspension", {"reason": "Illegal content."})
        assert expect_status(done, 200, "suspend") == {"username": target.username, "suspended": True}
        live.wait(lambda s: s.matching("account", lambda d: d == {"kind": "suspended", "communityName": None}),
                  LIVE_MS / 1000 + 2, "suspended account event")
    for client in (target, second):
        expect_error(client.get("/api/me"), 403, "SUSPENDED", "old session")
        expect_error(cast(client, "posts", pid, 1), 403, "SUSPENDED", "old session vote")
    expect_error(visitor(app_url).post("/api/auth/login", json={"login": target.username, "password": target.password}),
                 403, "SUSPENDED", "correct sign-in")
    expect_error(visitor(app_url).post("/api/auth/login", json={"login": target.username, "password": "wrong-pass-1"}),
                 401, "UNAUTHENTICATED", "wrong password")
    assert visitor(app_url).get(f"/api/posts/{pid}").json()["state"] == "published"
    expect_error(admin.req("POST", f"/api/admin/users/{target.username}/suspension", {"reason": "again"}), 409,
                 "CONFLICT", "suspend twice")
    other_admin = new_member(app_url, role="admin", sign_in=False)
    expect_error(admin.req("POST", f"/api/admin/users/{other_admin.username}/suspension", {"reason": "x"}), 409,
                 "CONFLICT", "suspend an admin")


@pytest.mark.timeout(900)
def test_health_seed_and_restart(app_url: str) -> None:
    assert expect_status(httpx.get(app_url + "/api/health", timeout=HTTP_S), 200, "health") == {"status": "ok"}
    for base in (storage_down_url(), valkey_down_url()):
        assert expect_status(httpx.get(base + "/api/health", timeout=HTTP_S), 200, "outage health") == {
            "status": "unavailable"}
    seed = {"fieldnotes": ("Field Notes", "public", ["Say where and when", "No collecting from protected sites",
                                                     "Credit other people's photos"]),
            "brasswork": ("Brass Band Players", "public", ["Stay on brass"]),
            "quietbuilds": ("Quiet Builds", "restricted", ["Show your process"])}
    for name, (title, kind, rules) in seed.items():
        com = visitor(app_url).get(f"/api/communities/{name}").json()
        assert (com["title"], com["type"], com["showModNames"]) == (title, kind, False)
        assert [r["title"] for r in com["rules"]] == rules
    posts = {
        "fieldnotes": [("Grey heron at the weir, 6:40 this morning", "wren_hollis", 14),
                       ("Which hand lens do you actually carry?", "odalys_finch", 6),
                       ("Lichen survey on the north wall", "teodor_vane", 2)],
        "brasswork": [("Mouthpiece rim width for long rehearsals", "teodor_vane", 9),
                      ("Valve oil that survives a cold bandstand", "wren_hollis", 0)],
        "quietbuilds": [("Dovetail jig from scrap ply", "wren_hollis", 4)]}
    heron = None
    for name, expected in posts.items():
        items = [p for pg_ in walk_pages(visitor(app_url), f"/api/communities/{name}/posts?sort=new") for p in pg_["items"]]
        for title, author, score in expected:
            found = [p for p in items if p["title"] == title]
            assert len(found) == 1 and found[0]["author"]["username"] == author and found[0]["score"] == score, title
            if title.startswith("Grey heron"):
                heron = found[0]
    chain = visitor(app_url).get(f"/api/posts/{heron['id']}/comments").json()["tree"]
    authors = []
    while chain:
        authors.append(chain[0]["author"]["username"])
        chain = chain[0]["replies"]
    assert authors == ["odalys_finch", "teodor_vane", "wren_hollis", "odalys_finch"]
    for username in ("wren_hollis", "odalys_finch", "teodor_vane"):
        r = visitor(app_url).post("/api/auth/login", json={"login": username, "password": SEED_PASSWORD})
        me = expect_status(r, 200, f"seed sign-in {username}")
        assert me["email"] == f"{username}@example.test" and me["emailVerified"] is True
        assert parse_time(me["createdAt"]) <= server_now(app_url) - timedelta(days=SEED_ACCOUNT_DAYS - 1)
    r = visitor(app_url).post("/api/auth/login", json={"login": "larkspur_admin", "password": SEED_PASSWORD,
                                                       "totp": totp_code(SEED_ADMIN_SECRET, server_now(app_url))})
    assert expect_status(r, 200, "seed admin")["role"] == "admin"

    with app_copy({}) as copy:
        names = [c["name"] for c in visitor(copy).get(f"/api/communities?q={SEED_COMMUNITY}").json()["items"]]
        assert [n.lower() for n in names].count("fieldnotes") == 1
        again = [p for p in visitor(copy).get(f"/api/communities/{SEED_COMMUNITY}/posts?sort={SORT_NEW}").json()["items"]
                 if p["title"] == "Grey heron at the weir, 6:40 this morning"]
        assert len(again) == 1


@pytest.mark.timeout(900)
def test_grading_routes(app_url: str) -> None:
    username = fresh("g", 16)
    body = {"username": username, "email": fresh_email(username), "password": fresh_password(), "verified": True,
            "accountAgeDays": 10, "role": "user", "totp": False}
    for headers in ({}, {"X-Grading-Key": GRADING_KEY + "x"}):
        expect_error(post_json(app_url, "/api/grading/users", body, **headers), 404, "NOT_FOUND", "grading key check")
    assert visitor(app_url).get(f"/api/users/{username}").status_code == 404
    admin = new_member(app_url, role="admin", totp_on=True)
    assert re.fullmatch(r"[A-Z2-7]+", admin.secret or "") and admin.get("/api/me").json()["role"] == "admin"
    aged = new_member(app_url, age=10)
    created = parse_time(visitor(app_url).get(f"/api/users/{aged.username}").json()["createdAt"])
    assert abs((server_now(app_url) - created).total_seconds() - 10 * 86400) < 3600
    unverified = new_member(app_url, verified=False)
    assert unverified.get("/api/me").json()["emailVerified"] is False

    member = new_member(app_url)
    community = new_community(app_url, admin, members=(member,), member_count=42,
                              rules=[{"title": "R1", "description": ""}, {"title": "R2", "description": ""}])
    com = member.get(f"/api/communities/{community['name']}").json()
    assert com["memberCount"] == 42 and com["viewer"]["joined"] is True and len(community["ruleIds"]) == 2
    assert [str(r["id"]) for r in com["rules"]] == community["ruleIds"]
    expect_status(member.req("DELETE", f"/api/communities/{community['name']}/membership"), 200, "leave")
    assert visitor(app_url).get(f"/api/communities/{community['name']}").json()["memberCount"] == 41
    when = server_now(app_url) - timedelta(hours=3)
    post = new_post(app_url, community["name"], admin, score=17, created=when, spoiler=True)
    body = visitor(app_url).get(f"/api/posts/{post['id']}").json()
    assert body["score"] == 17 and body["spoiler"] is True and parse_time(body["createdAt"]) == when
    assert post["url"] == f"/c/{community['name']}/post/{post['id']}"
    assert abs(post["hotRank"] - hot_rank(17, when)) < HOT_TOL
    assert votes_of(admin.id, "post", post["id"]) == []
    levels = levels_of(app_url, post["id"], admin, 3, 2)
    assert [len(level) for level in levels] == [2, 2, 2]
    assert visitor(app_url).get(f"/api/posts/{post['id']}").json()["commentCount"] == 6
    reference = file_report(app_url, post["id"], reporter=fresh_email(fresh("r", 16))).json()["reference"]
    before = next(i for i in admin.get("/api/admin/reports").json()["items"] if i["reference"] == reference)
    moved = grading(app_url, f"/reports/{reference}/age", {"seconds": 3600}, status=200)
    assert moved["reference"] == reference
    assert (parse_time(before["createdAt"]) - parse_time(moved["createdAt"])).total_seconds() == 3600
    assert (parse_time(moved["deadlineAt"]) - parse_time(moved["createdAt"])).total_seconds() == REPORT_DEADLINE_S

    with app_copy({"GRADING_KEY": None}) as copy:
        r = post_json(copy, "/api/grading/users", {**body, "username": fresh("g", 16)}, **{"X-Grading-Key": GRADING_KEY})
        expect_error(r, 404, "NOT_FOUND", "grading route without GRADING_KEY")


def test_valkey_outage(browser: Browser, app_url: str) -> None:
    down = valkey_down_url()
    owner = new_member(app_url)
    community = new_community(app_url, owner)
    post = new_post(app_url, community["name"], owner, score=3)
    member = owner.on(down)
    expect_status(member.get(f"/api/communities/{community['name']}/posts"), 200, "read")
    expect_status(create_post(member, community["name"], "Outage " + fresh("t", 8)), 201, "post")
    expect_status(add_comment(member, post["id"], "Still replying."), 201, "reply")
    expect_error(cast(member, "posts", post["id"], 1), 503, "SERVICE_UNAVAILABLE", "vote")
    assert votes_of(owner.id, "post", post["id"]) == [] and int(post_row(post["id"])["score"]) == 3
    with Stream(down, f"post:{post['id']}") as live:
        live.ready()
        live.wait(lambda s: s.body, UI_S, "503 response body")
        assert live.status == 503 and json.loads(live.body)["error"]["code"] == "SERVICE_UNAVAILABLE"
    with tab(browser, down, member, DESKTOP, post["url"]) as page:
        expect(by_id(page, "live-indicator")).to_have_text("Live updates paused", timeout=UI_MS)
        announced_anywhere(page, "Live updates paused")
        up = page.get_by_role("button", name="Upvote", exact=True).first
        up.click()
        announced_anywhere(page, "Vote didn't save")
        expect(up).to_have_attribute("aria-pressed", "false")
        expect(by_id(page, f"score-post-{post['id']}")).to_have_text("3")
    assert votes_of(owner.id, "post", post["id"]) == []


def test_server_boundary(app_url: str) -> None:
    owner, member = new_member(app_url), new_member(app_url)
    community = new_community(app_url, owner)
    name = community["name"]
    post = new_post(app_url, name, owner, score=1)
    r = member.req("PUT", f"/api/communities/{name}/membership", headers={"Origin": FOREIGN_ORIGIN})
    expect_error(r, 403, "FORBIDDEN", "foreign origin")
    assert visitor(app_url).get(f"/api/communities/{name}").json()["memberCount"] == 1
    expect_error(visitor(app_url).put(f"/api/posts/{post['id']}/vote", json={"value": 1},
                                      headers={"Origin": FOREIGN_ORIGIN}), 403, "FORBIDDEN", "origin before auth")
    origin = app_url.rstrip("/")
    expect_status(member.req("PUT", f"/api/communities/{name}/membership", headers={"Origin": origin}), 200, "same origin")

    def raw_post(payload: bytes, ctype: str) -> httpx.Response:
        return member.client.post("/api/markdown/preview", content=payload, headers={"Content-Type": ctype})

    small = b'{"bodyMd":"x"}'
    expect_status(raw_post(small + b" " * (JSON_LIMIT - len(small)), "application/json"), 200, "exactly the limit")
    expect_error(raw_post(small + b" " * (JSON_LIMIT - len(small) + 1), "application/json"), 413, "VALIDATION", "over")
    expect_error(raw_post(small, "text/plain"), 415, "VALIDATION", "wrong content type")

    first, second = httpx.get(app_url + "/", timeout=HTTP_S), httpx.get(app_url + "/", timeout=HTTP_S)
    nonces = []
    for page in (first, second):
        csp = page.headers.get("content-security-policy", "")
        directives = {d.strip().split(" ")[0]: d.strip() for d in csp.split(";") if d.strip()}
        assert "default-src" in directives and "'self'" in directives["default-src"]
        script = directives.get("script-src", "")
        assert "'unsafe-inline'" not in script
        nonce = re.search(r"'nonce-([^']+)'", script)
        assert nonce, f"script-src lacks a nonce: {csp}"
        nonces.append(nonce.group(1))
        for tag_nonce in re.findall(r"<script[^>]*\snonce=\"([^\"]+)\"", page.text):
            assert tag_nonce == nonce.group(1)
    assert nonces[0] != nonces[1], "the CSP nonce must be fresh per response"
    for r in (first, visitor(app_url).get("/api/health"), visitor(app_url).get(f"/api/posts/{PROBE_ID}")):
        assert r.headers.get("x-content-type-options") == "nosniff"
    for path in ("/package.json", "/.env", "/run.json", "/node_modules/", "/src/"):
        r = visitor(app_url).get(path)
        assert r.status_code == 404, f"{path} answered {r.status_code}"
        assert not re.search(r"\n\s+at \S+ \(", r.text)
    broken = member.client.post("/api/markdown/preview", content=b"{not json", headers={"Content-Type": "application/json"})
    assert 400 <= broken.status_code < 500 and not re.search(r"\n\s+at \S+", broken.text)
    assert broken.json()["error"]["code"]


@pytest.mark.parametrize("size", [PHONE, TABLET, DESKTOP], ids=["phone", "tablet", "desktop"])
def test_responsive_layout(browser: Browser, app_url: str, size: dict[str, int]) -> None:
    member = new_member(app_url)
    heron = next(p for p in visitor(app_url).get(f"/api/communities/{SEED_COMMUNITY}/posts?sort={SORT_NEW}").json()["items"]
                 if p["title"].startswith("Grey heron"))
    paths = ["/", f"/c/{SEED_COMMUNITY}", heron["url"], "/communities", f"/c/{SEED_COMMUNITY}/about/log", "/signup",
             "/login"]
    with tab(browser, app_url, member, size, "/") as page:
        for path in paths:
            page.goto(app_url + path)
            page.wait_for_load_state("load")
            expect(by_id(page, "live-status")).to_be_attached(timeout=UI_MS)
            layout(page)
            if size is PHONE:
                small = page.get_by_role("button").evaluate_all(f"""els => els.filter(el => el.checkVisibility()
                  && !el.closest('[inert]')).map(el => [el.getAttribute('aria-label') || el.textContent.trim(),
                  el.getBoundingClientRect()]).filter(([n, r]) => r.width < {TOUCH_MIN} - 0.5 || r.height < {TOUCH_MIN} - 0.5)
                  .map(([n, r]) => `${{n}} ${{Math.round(r.width)}}x${{Math.round(r.height)}}`)""")
                assert not small, f"{path}: touch targets under 44 px: {small}"
        if size is PHONE:
            page.goto(app_url + "/")
            toggle = page.get_by_role("button", name="Communities", exact=True)
            expect(toggle).to_have_attribute("aria-expanded", "false", timeout=UI_MS)
            drawer = page.get_by_role("navigation", name="Communities", exact=True, include_hidden=True)
            assert drawer.evaluate("el => !!el.closest('[inert]') || el.hasAttribute('inert')"), "drawer must be inert"
            toggle.click()
            expect(toggle).to_have_attribute("aria-expanded", "true")
            assert drawer.evaluate("el => !el.closest('[inert]')")
            page.keyboard.press("Escape")
            expect(toggle).to_have_attribute("aria-expanded", "false")
            expect(toggle).to_be_focused()


def test_motion_and_reduced_motion(browser: Browser, app_url: str) -> None:
    owner = new_member(app_url)
    community = new_community(app_url, owner)
    post = new_post(app_url, community["name"], owner, score=5)
    score_sel = f"#score-post-{post['id']}"
    for reduced in ("no-preference", "reduce"):
        with tab(browser, app_url, owner, DESKTOP, post["url"], reduced=reduced) as page:
            expect(by_id(page, score_sel[1:])).to_be_visible(timeout=UI_MS)
            assert page.evaluate(INFINITE_JS) == 0, "an animation repeats forever"
            page.evaluate(RECORDER_JS)
            page.get_by_role("button", name="Upvote", exact=True).click()
            expect(by_id(page, score_sel[1:])).to_have_text("6")
            rolls = settled_records(page, score_sel)
            menu_item(page, page.get_by_role("button", name="More actions", exact=True).first, "Report illegal content")
            expect(page.get_by_role("dialog", name="Report illegal content", exact=True)).to_be_visible()
            dialogs = settled_records(page, "[role=dialog], dialog")
            assert page.evaluate(INFINITE_JS) == 0
            if reduced == "reduce":
                assert all(r["end"] == 0 for r in rolls + dialogs), "reduced motion must make changes instant"
            else:
                assert rolls and all(r["end"] >= 0 for r in rolls), "the score digits did not roll"
                assert span_ms(rolls) < SCORE_ROLL_MAX_MS, f"score roll took {span_ms(rolls)} ms"
                assert dialogs and span_ms(dialogs) < DIALOG_MAX_MS, f"dialog entry took {dialogs and span_ms(dialogs)}"
            page.get_by_role("button", name="Upvote", exact=True).evaluate("el => el.blur()")
        expect_status(cast(owner, "posts", post["id"], 0), 200, "reset vote")


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest.get(field), str) and manifest[field].strip(), f"run.json {field}"


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"notices omit {missing[:20]}"
    for font in FONT_NAMES:
        assert font in notices, f"notices omit the font {font}"
    assert "OFL" in notices or "Open Font License" in notices


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCE_ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"


def test_if_no_extra_datastore() -> None:
    tables = {t.split(".")[-1] for t in Postgres().tables()}
    assert any("vote" in t for t in tables) and any("post" in t for t in tables), f"tables {sorted(tables)}"
    shipped = {p.name for p in shipped_packages()}
    assert not shipped & FILE_DATASTORES, f"extra datastores shipped: {shipped & FILE_DATASTORES}"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    seen: list[str] = []
    with tab(browser, app_url, None, DESKTOP, "/") as page:
        page.on("request", lambda req: seen.append(req.url))
        for path in ("/", f"/c/{SEED_COMMUNITY}", "/communities", "/signup", "/login"):
            page.goto(app_url + path)
            page.wait_for_load_state("load")
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, f"cross-origin loads: {foreign[:10]}"


def test_if_service_config_unchanged() -> None:
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    data = json.loads(path.read_text())
    offenders: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            target = node.get("file_path") or node.get("path") or node.get("filePath")
            if isinstance(target, str) and COMPOSE_RE.search(target) and any(
                    k in node for k in ("content", "new_string", "old_string", "edits", "patch")):
                offenders.append(target)
            command = node.get("command")
            if isinstance(command, str) and COMPOSE_RE.search(command) and re.search(
                    r"(sed\s+-i|>\s*\S*compose|\btee\b|\bmv\b|\brm\b)", command):
                offenders.append(command[:200])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    assert not offenders, f"compose definitions changed: {offenders[:5]}"


def load_jsonc(path: Path) -> dict[str, Any]:
    source, out, i, in_string = path.read_text(), [], 0, False
    line_open, block_open, block_close = "/" * 2, "/" + "*", "*" + "/"
    while i < len(source):
        ch = source[i]
        if in_string:
            out.append(ch)
            if ch == "\\":
                out.append(source[i + 1])
                i += 1
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
            out.append(ch)
        elif source.startswith(line_open, i):
            i = source.find("\n", i)
            i = len(source) if i < 0 else i
            continue
        elif source.startswith(block_open, i):
            i = source.find(block_close, i) + 2
            continue
        else:
            out.append(ch)
        i += 1
    return json.loads(re.sub(r",\s*([}\]])", r"\1", "".join(out)))


def test_if_strict_typescript() -> None:
    def strict_of(path: Path, depth: int = 0) -> bool | None:
        if depth > 6 or not path.is_file():
            return None
        config = load_jsonc(path)
        found = config.get("compilerOptions", {}).get("strict")
        if found is not None:
            return bool(found)
        parents = config.get("extends", [])
        inherited: bool | None = None
        for parent in ([parents] if isinstance(parents, str) else parents):
            base = path.parent / parent if parent.startswith(".") else Path("/app/node_modules") / parent
            for candidate in (base, base.parent / (base.name + ".json"), base / "tsconfig.json"):
                if candidate.is_file():
                    result = strict_of(candidate.resolve(), depth + 1)
                    inherited = result if result is not None else inherited
                    break
        return inherited

    configs = [p for p in Path("/app").rglob("tsconfig*.json") if "node_modules" not in p.parts]
    results = [strict_of(p) for p in configs]
    assert any(r is True for r in results) and not any(r is False for r in results), (
        f"TypeScript strict mode is not enabled in {[str(p) for p in configs]}: {results}")
    manifest = json.loads(Path("/app/run.json").read_text())
    scripts = json.loads(Path("/app/package.json").read_text()).get("scripts", {})
    pending, combined = [manifest["build"]], ""
    for _ in range(6):
        if not pending:
            break
        command = pending.pop()
        combined += " " + command
        pending += [scripts[n] for n in re.findall(r"npm run (\S+)", command) if n in scripts]
    assert re.search(r"\btsc\b", combined), f"build does not type-check: {combined}"
