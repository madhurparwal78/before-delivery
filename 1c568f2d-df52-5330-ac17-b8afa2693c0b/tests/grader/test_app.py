from __future__ import annotations

import csv
import io
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import tomllib
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urljoin, urlsplit

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    Keycloak,
    Postgres,
    advance,
    axe,
    layout,
    open_app,
    same_origin,
    select,
    state_styles,
    tab_order,
)
from grader import APP_PATH, as_app


PASSPHRASE = "deku-demo-pw-2026"
ROSA = "rosa.aldridge@example.com"
TOBIAS = "tobias.lund@example.com"
PRIYA = "priya.raman@example.com"
DAN = "dan.whitlock@example.com"
HALIMA = "halima.osei@example.com"
GREGOR = "gregor.pyne@example.com"
ACCOUNTS = {
    ROSA: ("Rosa Aldridge", "maker"),
    TOBIAS: ("Tobias Lund", "maker"),
    PRIYA: ("Priya Raman", "licence_reviewer"),
    DAN: ("Dan Whitlock", "access_reviewer"),
    HALIMA: ("Halima Osei", "lead"),
    GREGOR: ("Gregor Pyne", "auditor"),
}
STATES = (
    "draft", "submitted", "in_review", "changes_requested", "cleared",
    "scheduled", "published", "withdrawn", "rejected",
)
RAIL = (
    "Submit for clearance", "Start review", "Record licence review", "Record accessibility review",
    "Clear for the wall", "Return for changes", "Reject", "Schedule", "Publish now", "Unschedule",
    "Withdraw", "Revise",
)
STAFF_PATHS = ("/", "/catalogue", "/schedule", "/budget", "/audit", "/settings")
ALLOWED_LICENCES = ("CC0", "Public domain", "CC BY 4.0", "CC BY-SA 4.0")
CSV_HEADER = "when,piece_id,piece_title,actor,role,from_state,to_state,reason"

CATALOGUE_SIZE = 20000
PAGE_LIMIT = 60
SEED_MAX = 2147483647
SIMILAR_LIMIT = 50
SIMILAR_FLOOR = 40
DUPLICATE_SCORE = 85
PAIR_A, PAIR_B = 101, 102
BLOCKED_EVERY = 20
REMAINDER_BASE = 1000
NO_ARTIST_REMAINDER = 7
NO_LICENCE_URL_REMAINDER = 13
BLOCKED_ID = 6020
NO_ARTIST_ID = 4007
NO_LICENCE_URL_ID = 5013
FEE_MAX = 500000
TITLE_MAX = 80
SUMMARY_MIN = 20
SUMMARY_MAX = 600
REASON_MIN = 10
REASON_MAX = 400
CITE_MAX = 40
BODY_LIMIT = 65536
LOCKOUT_LIMIT = 5
CUTOUT_MIN_PX = 48
CUTOUT_MAX_PX = 220
STAMP_MIN_MS = 250
STAMP_MAX_MS = 600
CARD_MAX_MS = 500
CARD_STAGGER_MAX_MS = 100
CARD_STAGGER_CAP = 12
TARGET_PX = 44
FOCUS_RING_PX = 2
QUEUE_WIDE_PX = 1000
WALL_COLUMNS = ((320, 1), (600, 1), (700, 2), (800, 2), (1000, 3), (1300, 3), (1400, 4))
VIEWPORTS = ((320, 800), (375, 812), (768, 1024), (1280, 800))
HEALTH_MAX_S = 2
IDENTITY_RECOVERY_S = 60


HTTP_TIMEOUT = 60
POLL_SECONDS = 60
RESTART_SECONDS = 300
WALK_PAGE_CAP = 400
TAB_PRESSES = 80
ADVANCE_MS = 1000
RATIO_SLACK_PX = 2
CLEAN_SCAN_FROM = 2001
NOWHERE_ID = 987654321
FAR_DAY_MIN = 400
FAR_DAY_SPAN = 4000
OBJECT_PROBE = 9999999
TYPED_DOLLARS = 5
MULTIPLIER = 10
CENTS_PER_DOLLAR = 100
SUMMARY = "A small hands-on exhibit piece made for the public wall."
REASON = "Needs a clearer label for colour-blind visitors"
WITHDRAW_REASON = "Withdrawn to free the featured day for a check"
WRONG_PASS = "not-the-passphrase-0"
UNDERSCORE_HOST = "clearhouse_app:4173"
EVIL_ORIGIN = "http://evil.example:9"
APP_DIR = Path("/app")

_sessions: dict[tuple[str, str], dict[str, Any]] = {}
_clean: list[int] = []

RECORDER = """
(() => {
  if (window.__motion) return;
  window.__motion = [];
  const seen = new WeakSet();
  const record = (target, anim) => {
    if (!anim || seen.has(anim)) return;
    seen.add(anim);
    const t = anim.effect ? anim.effect.getComputedTiming() : {};
    const base = anim.startTime ?? document.timeline.currentTime ?? 0;
    window.__motion.push({target, start: base + (Number(t.delay) || 0),
                          duration: Number(t.activeDuration) || 0, end: Number(t.endTime) || 0});
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const anim = original.apply(this, args);
    record(this, anim);
    return anim;
  };
  const collect = (event) => {
    const el = event.target;
    if (el && el.getAnimations) for (const a of el.getAnimations()) record((a.effect && a.effect.target) || el, a);
  };
  document.addEventListener('animationstart', collect, true);
  document.addEventListener('transitionrun', collect, true);
})();
"""

BUSY = """() => {
  for (const n of document.getElementsByTagName('*')) if (n.getAttribute('aria-busy') === 'true') return true;
  return false;
}"""


def call(base: str, method: str, path: str, token: str | None = None, body: Any = None, *,
         raw: bytes | None = None, headers: dict[str, str] | None = None,
         params: dict[str, Any] | None = None) -> httpx.Response:
    sent = dict(headers or {})
    if token:
        sent["Authorization"] = f"Bearer {token}"
    extra: dict[str, Any] = {}
    if raw is not None:
        extra["content"] = raw
    elif body is not None:
        extra["json"] = body
    return httpx.request(method, base + path, headers=sent, params=params, timeout=HTTP_TIMEOUT,
                         follow_redirects=False, **extra)


def ok(r: httpx.Response, status: int) -> httpx.Response:
    assert r.status_code == status, f"expected {status}, got {r.status_code}: {r.text[:600]}"
    return r


def refused(r: httpx.Response, status: int, message: str, field: str | None = None) -> dict:
    ok(r, status)
    err = r.json()["error"]
    assert err["message"] == message, err
    if field is not None:
        assert err.get("field") == field, err
    return r.json()


def poll(fn: Callable[[], Any], seconds: float = POLL_SECONDS, what: str = "condition") -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        assert time.monotonic() < deadline, f"timed out waiting for {what}"


def together(*fns: Callable[[], httpx.Response]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(fns))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(fns)) as pool:
        futures = [pool.submit(run, fn) for fn in fns]
        return [f.result() for f in futures]


def sign_in(base: str, email: str, password: str = PASSPHRASE) -> httpx.Response:
    return call(base, "POST", "/api/auth/login", body={"email": email, "password": password})


def account(base: str, email: str) -> dict[str, Any]:
    key = (base, email)
    if key not in _sessions:
        r = ok(sign_in(base, email), 200)
        token = r.json()["access_token"]
        me = ok(call(base, "GET", "/api/auth/me", token), 200).json()
        _sessions[key] = {"token": token, "cookies": dict(r.cookies), **me}
    return _sessions[key]


def tok(base: str, email: str) -> str:
    return account(base, email)["token"]


def pg() -> Postgres:
    return Postgres()


def sql_text(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def audit_count(pid: int) -> int:
    return int(pg().rows(f"SELECT count(*) AS n FROM audit_entries WHERE piece_id = {int(pid)}")[0]["n"])


def stored(pid: int) -> dict:
    return pg().rows(
        f"SELECT state, version, fee_cents, title FROM pieces WHERE id = {int(pid)}")[0]


def money(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def fresh_title(tag: str) -> str:
    return f"{tag} {uuid.uuid4().hex[:10]}"


def server_today(base: str) -> date:
    r = call(base, "GET", "/api/health")
    return parsedate_to_datetime(r.headers["date"]).date()


def usable(i: int) -> bool:
    return i % BLOCKED_EVERY != 0 and i % REMAINDER_BASE not in (NO_ARTIST_REMAINDER, NO_LICENCE_URL_REMAINDER)


def clean_objects(base: str, n: int) -> list[int]:
    i = CLEAN_SCAN_FROM + len(_clean) * 3
    while len(_clean) < n:
        if usable(i) and i not in _clean:
            r = ok(call(base, "GET", f"/api/objects/{i}/similar", tok(base, PRIYA), params={"limit": 1}), 200)
            res = r.json()["results"]
            if not res or res[0]["score"] < DUPLICATE_SCORE:
                _clean.append(i)
        i += 1
    return list(_clean[:n])


def get_object(base: str, oid: int) -> dict:
    return ok(call(base, "GET", f"/api/objects/{oid}", tok(base, PRIYA)), 200).json()


def get_piece(base: str, email: str, pid: int) -> dict:
    return ok(call(base, "GET", f"/api/pieces/{pid}", tok(base, email)), 200).json()


def create_piece(base: str, owner: str = ROSA, *, title: str | None = None, fee: int = 0,
                 objects: list[int] | None = None) -> dict:
    r = call(base, "POST", "/api/pieces", tok(base, owner),
             {"title": title or fresh_title("Piece"), "summary": SUMMARY, "fee_cents": fee})
    piece = ok(r, 201).json()
    if objects:
        r = call(base, "PUT", f"/api/pieces/{piece['id']}/objects", tok(base, owner),
                 {"version": piece["version"], "object_ids": objects})
        piece = ok(r, 200).json()["piece"]
    return piece


def step(base: str, email: str, piece: dict, action: str, **extra: Any) -> dict:
    r = call(base, "POST", f"/api/pieces/{piece['id']}/transition", tok(base, email),
             {"version": piece["version"], "action": action, **extra})
    return ok(r, 200).json()


def review(base: str, email: str, piece: dict, kind: str, result: str = "pass",
           reason: str | None = None) -> dict:
    body = {"version": piece["version"], "kind": kind, "result": result}
    if reason is not None:
        body["reason"] = reason
    r = call(base, "POST", f"/api/pieces/{piece['id']}/reviews", tok(base, email), body)
    return ok(r, 201).json()["piece"]


def advance_to(base: str, target: str, *, owner: str = ROSA, fee: int = 0, title: str | None = None,
               objects: list[int] | None = None) -> dict:
    piece = create_piece(base, owner, title=title, fee=fee, objects=objects or clean_objects(base, 2))
    if target == "draft":
        return piece
    piece = step(base, owner, piece, "submit")
    if target == "submitted":
        return piece
    piece = step(base, PRIYA, piece, "start_review")
    if target == "in_review":
        return piece
    piece = review(base, PRIYA, piece, "licence")
    if target == "licence_passed":
        return piece
    piece = review(base, DAN, piece, "accessibility")
    if target == "passed":
        return piece
    return step(base, HALIMA, piece, "clear")


def flagged(base: str, oid: int) -> list[int]:
    found, offset = [], 0
    while True:
        r = ok(call(base, "GET", f"/api/objects/{oid}/similar", tok(base, PRIYA),
                    params={"limit": SIMILAR_LIMIT, "offset": offset}), 200)
        res = r.json()["results"]
        found += [x["object"]["id"] for x in res if x["score"] >= DUPLICATE_SCORE]
        if not res or res[-1]["score"] < DUPLICATE_SCORE:
            return found
        offset += len(res)


def ack(base: str, email: str, pid: int, oid: int, dup: int) -> httpx.Response:
    return call(base, "POST", f"/api/pieces/{pid}/duplicate-acks", tok(base, email),
                {"object_id": oid, "duplicate_object_id": dup})


def schedule_month(base: str, month: str) -> list[dict]:
    return ok(call(base, "GET", "/api/schedule", tok(base, HALIMA), params={"month": month}), 200).json()


def free_today(base: str) -> str:
    today = server_today(base).isoformat()
    for slot in schedule_month(base, today[:7]):
        if slot["day"] == today:
            holder = get_piece(base, HALIMA, slot["piece"]["id"])
            if holder["state"] == "scheduled":
                step(base, HALIMA, holder, "unschedule")
            else:
                step(base, HALIMA, holder, "withdraw", reason=WITHDRAW_REASON)
    assert all(s["day"] != today for s in schedule_month(base, today[:7]))
    return today


def free_future_day(base: str) -> str:
    today = server_today(base)
    while True:
        offset = FAR_DAY_MIN + uuid.uuid4().int % FAR_DAY_SPAN
        day = (today + timedelta(days=offset)).isoformat()
        if all(s["day"] != day for s in schedule_month(base, day[:7])):
            return day


def published_piece(base: str, objects: list[int] | None = None) -> dict:
    title = fresh_title("Shown")
    import_pieces(base, [entry(base, title, "published", objects=objects)])
    pid = pg().rows(f"SELECT id FROM pieces WHERE title = {sql_text(title)}")[0]["id"]
    return get_piece(base, HALIMA, int(pid))


def budget(base: str) -> dict:
    return ok(call(base, "GET", "/api/budget", tok(base, HALIMA)), 200).json()


def committed_in_db(quarter: str) -> int:
    year, q = quarter.split("-Q")
    start_month = (int(q) - 1) * 3 + 1
    start = f"{year}-{start_month:02d}-01T00:00:00Z"
    end_year, end_month = (int(year) + 1, 1) if start_month + 3 > 12 else (int(year), start_month + 3)
    end = f"{end_year}-{end_month:02d}-01T00:00:00Z"
    row = pg().rows(
        "SELECT coalesce(sum(fee_cents), 0) AS s FROM pieces WHERE state IN ('cleared','scheduled','published') "
        f"AND cleared_at >= {sql_text(start)} AND cleared_at < {sql_text(end)}")[0]
    return int(row["s"])


def pack_doc(base: str, name: str, entries: list[dict], author: str = "Rosa Aldridge",
             version: str = "1") -> dict:
    b = budget(base)
    return {
        "meta": {"saveVersion": version, "name": name, "author": author, "created": 0, "updated": 0,
                 "uuid": str(uuid.uuid4())},
        "config": {"quarter": b["quarter"], "budget_cents": b["budget_cents"]},
        "pieces": entries,
    }


def entry(base: str, title: str, state: str, fee: int = 0, objects: list[int] | None = None) -> dict:
    return {"title": title, "summary": SUMMARY, "fee_cents": fee, "state": state,
            "object_ids": objects or clean_objects(base, 1)}


def import_pieces(base: str, entries: list[dict], author: str = "Rosa Aldridge") -> None:
    r = call(base, "POST", "/api/pack", tok(base, HALIMA), pack_doc(base, fresh_title("Pack"), entries, author))
    ok(r, 201)


def visible(markup: str) -> str:
    body = re.sub(r"(?is)<(script|style)\b[^>]*>.*?</\1\s*>", " ", markup)
    return re.sub(r"\s+", " ", unescape(re.sub(r"(?s)<[^>]*>", " ", body))).strip()


def cleared_today(base: str) -> int:
    text = visible(ok(call(base, "GET", "/wall"), 200).text)
    m = re.search(r"(\d+) pieces cleared today|(1) piece cleared today", text)
    assert m, "cleared-today line missing from /wall"
    return int(m.group(1) or m.group(2))


def page_get(base: str, email: str | None, path: str) -> httpx.Response:
    cookies = account(base, email)["cookies"] if email else {}
    with httpx.Client(cookies=cookies, timeout=HTTP_TIMEOUT, follow_redirects=False) as client:
        return client.get(base + path)


@contextmanager
def staff(browser: Browser, base: str, email: str, path: str = "/", **options: Any) -> Iterator[Page]:
    cookies = account(base, email)["cookies"]
    with open_app(browser, base + "/wall", **options) as p:
        p.context.add_cookies([{"name": n, "value": v, "url": base} for n, v in cookies.items()])
        p.goto(base + path)
        yield p


def ui_sign_in(p: Page, email: str, password: str = PASSPHRASE) -> None:
    p.get_by_role("textbox", name="Work email").fill(email)
    p.get_by_label("Passphrase").fill(password)
    p.get_by_role("button", name="Sign in").click()


def desk_updates(p: Page):
    return p.get_by_role("status", name="Desk updates")


def rail(p: Page, present: set[str]) -> None:
    for name in RAIL:
        button = p.get_by_role("button", name=name, exact=True)
        if name in present:
            expect(button).to_be_visible()
            expect(button).to_be_enabled()
        else:
            expect(button).to_have_count(0)


def search_queue(p: Page, text: str) -> None:
    p.get_by_role("searchbox", name="Search pieces").fill(text)
    advance(p, ADVANCE_MS)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_wf_deployment_health_and_hosts(app_url: str, browser: Browser) -> None:
    r = ok(call(app_url, "GET", "/api/health"), 200)
    assert r.headers["content-type"].startswith("application/json")
    assert r.elapsed.total_seconds() < HEALTH_MAX_S
    body = r.json()
    assert body["status"] == "ok" and body["ok"] is True and body["identity"] in ("up", "down")
    poll(lambda: call(app_url, "GET", "/api/health").json().get("identity") == "up",
         IDENTITY_RECOVERY_S, "identity up on the live deployment")
    public_host = urlsplit(os.environ.get("APP_PUBLIC_URL", app_url)).netloc
    for host in ("localhost", public_host, UNDERSCORE_HOST):
        h = {"Host": host}
        assert ok(call(app_url, "GET", "/api/health", headers=h), 200).json()["ok"] is True
        wall = ok(call(app_url, "GET", "/wall", headers=h), 200)
        assert "Every piece here names its sources" in wall.text
        me = ok(call(app_url, "GET", "/api/auth/me", tok(app_url, GREGOR), headers=h), 200)
        assert me.json()["role"] == "auditor"
        assert call(app_url, "GET", "/budget", headers=h).is_redirect
    with open_app(browser, app_url + "/wall") as p:
        expect(p.get_by_text("Small exhibits, cleared for the floor")).to_be_visible()


def test_wf_deployment_server_rendered(app_url: str) -> None:
    oid = clean_objects(app_url, 1)[0]
    obj = get_object(app_url, oid)
    draft = create_piece(app_url, ROSA, objects=[oid])
    shown = published_piece(app_url)
    expected = {
        "/": [draft["title"], "Rosa Aldridge", "Needs my decision"],
        f"/pieces/{draft['id']}": [draft["title"], SUMMARY, obj["title"]],
        "/catalogue": ["objects in the catalogue", "Shuffle"],
        f"/catalogue/{oid}": [obj["title"], "Similar objects"],
        "/schedule": ["Today", "Previous month"],
        "/budget": ["Committed", "Remaining"],
        "/audit": ["Export CSV", "Actor"],
        "/settings": ["Rows per page", "High contrast"],
    }
    for path, texts in expected.items():
        r = ok(page_get(app_url, ROSA, path), 200)
        assert r.headers["content-type"].startswith("text/html"), path
        for text in texts:
            assert text in r.text, f"{text!r} missing from first HTML of {path}"
        anonymous = page_get(app_url, None, path)
        assert anonymous.is_redirect, path
        assert urlsplit(anonymous.headers["location"]).path == "/login", path
    wall = ok(page_get(app_url, None, "/wall"), 200)
    assert shown["title"] in wall.text and f"/wall/{shown['id']}" in wall.text
    plaque = ok(page_get(app_url, None, f"/wall/{shown['id']}"), 200)
    assert shown["title"] in plaque.text and "Sources" in plaque.text and "Credits" in plaque.text


def test_wf_deployment_self_contained(app_url: str, browser: Browser) -> None:
    shown = published_piece(app_url)
    paths = ["/", f"/pieces/{shown['id']}", "/catalogue", f"/catalogue/{PAIR_A}", "/schedule", "/budget",
             "/audit", "/settings", "/wall", f"/wall/{shown['id']}"]
    with staff(browser, app_url, HALIMA, "/") as p:
        requests: list[str] = []
        p.on("request", lambda req: requests.append(req.url))
        for path in paths:
            p.goto(app_url + path)
            p.wait_for_load_state("networkidle")
            for link in p.get_by_role("link").all():
                href = link.get_attribute("href")
                if href:
                    target = urljoin(p.url, href)
                    if urlsplit(target).scheme in ("http", "https"):
                        assert same_origin(target, app_url), f"off-site link {target} on {path}"
        offsite = [u for u in requests if urlsplit(u).scheme in ("http", "https") and not same_origin(u, app_url)]
        assert not offsite, offsite
    with open_app(browser, app_url + "/login") as p:
        requests = []
        p.on("request", lambda req: requests.append(req.url))
        p.reload()
        p.wait_for_load_state("networkidle")
        assert all(same_origin(u, app_url) for u in requests if urlsplit(u).scheme in ("http", "https"))


def test_wf_deployment_identity_outage(app_url: str, browser: Browser) -> None:
    down = os.environ["APP_KEYCLOAK_DOWN_URL"].rstrip("/")
    poll(lambda: call(down, "GET", "/api/health").json().get("identity") == "down",
         POLL_SECONDS, "identity down on the outage instance")
    health = ok(call(down, "GET", "/api/health"), 200)
    assert health.json()["ok"] is True and health.elapsed.total_seconds() < HEALTH_MAX_S
    existing = account(app_url, GREGOR)
    assert ok(call(down, "GET", "/api/auth/me", existing["token"]), 200).json()["role"] == "auditor"
    ok(call(down, "GET", "/api/pieces", existing["token"]), 200)
    ok(call(down, "GET", "/wall"), 200)
    known_bodies = []
    for _ in range(LOCKOUT_LIMIT + 1):
        r = sign_in(down, f"  {DAN.upper()} ")
        refused(r, 503, "Sign-in is unavailable right now. Try again shortly")
        known_bodies.append(r.content)
    unknown = sign_in(down, f"nobody-{uuid.uuid4().hex[:8]}@example.com")
    refused(unknown, 503, "Sign-in is unavailable right now. Try again shortly")
    assert unknown.content == known_bodies[0]
    assert "access_token" in ok(sign_in(app_url, DAN), 200).json()
    with open_app(browser, down + "/login") as p:
        expect(p.get_by_role("textbox", name="Work email")).to_be_visible()
        ui_sign_in(p, HALIMA)
        expect(p.get_by_role("alert")).to_contain_text("Sign-in is unavailable right now. Try again shortly")


def test_wf_access_sign_in(app_url: str, browser: Browser) -> None:
    for email, (name, role) in ACCOUNTS.items():
        r = ok(sign_in(app_url, email), 200)
        token = r.json()["access_token"]
        assert isinstance(token, str) and token and PASSPHRASE not in token
        assert token in r.cookies.values()
        me = ok(call(app_url, "GET", "/api/auth/me", token), 200).json()
        assert {k: me[k] for k in ("email", "name", "role")} == {"email": email, "name": name, "role": role}
        assert isinstance(me["id"], str)
        row = pg().rows(f"SELECT role FROM accounts WHERE id = {sql_text(me['id'])}")
        assert row and row[0]["role"] == role
    realm = {(u.get("email") or "").lower() for u in Keycloak().users()}
    assert set(ACCOUNTS) <= realm
    with open_app(browser, app_url + "/login") as p:
        ui_sign_in(p, ROSA)
        p.wait_for_url(lambda u: urlsplit(u).path == "/")
        expect(p.get_by_text("Rosa Aldridge").first).to_be_visible()
        expect(p.get_by_role("button", name="Sign out")).to_be_visible()
        script_cookies = p.evaluate("() => document.cookie")
        session_values = [c["value"] for c in p.context.cookies()
                          if call(app_url, "GET", "/api/auth/me", c["value"]).status_code == 200]
        assert session_values and not any(v in script_cookies for v in session_values)


def test_sign_out(app_url: str, browser: Browser) -> None:
    token = ok(sign_in(app_url, TOBIAS), 200).json()["access_token"]
    ok(call(app_url, "POST", "/api/auth/logout", token), 204)
    refused(call(app_url, "GET", "/api/auth/me", token), 401, "Sign in first")
    refused(call(app_url, "POST", "/api/pieces", token,
                 {"title": fresh_title("Revoked"), "summary": SUMMARY, "fee_cents": 0}), 401, "Sign in first")
    with open_app(browser, app_url + "/login") as p:
        ui_sign_in(p, TOBIAS)
        p.wait_for_url(lambda u: urlsplit(u).path == "/")
        cookies = {c["name"]: c["value"] for c in p.context.cookies()}
        assert ok(call(app_url, "GET", "/api/auth/me",
                       headers={"Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items())}), 200)
        p.get_by_role("button", name="Sign out").click()
        p.wait_for_url(lambda u: urlsplit(u).path == "/wall")
        refused(call(app_url, "GET", "/api/auth/me",
                     headers={"Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items())}), 401, "Sign in first")
        p.goto(app_url + "/")
        assert urlsplit(p.url).path == "/login"


def test_wf_access_lockout(app_url: str) -> None:
    known = sign_in(app_url, GREGOR, WRONG_PASS)
    unknown = sign_in(app_url, f"nobody-{uuid.uuid4().hex[:8]}@example.com", WRONG_PASS)
    refused(known, 401, "Email or passphrase is not recognised")
    assert unknown.status_code == known.status_code and unknown.content == known.content
    refused(sign_in(app_url, "", PASSPHRASE), 400, "Enter your work email", "email")
    refused(sign_in(app_url, GREGOR, ""), 400, "Enter your passphrase", "password")
    for _ in range(LOCKOUT_LIMIT - 2):
        refused(sign_in(app_url, f"  {GREGOR.upper()} ", WRONG_PASS), 401, "Email or passphrase is not recognised")
    ok(sign_in(app_url, f"  {GREGOR.upper()} "), 200)
    for _ in range(LOCKOUT_LIMIT - 1):
        refused(sign_in(app_url, GREGOR, WRONG_PASS), 401, "Email or passphrase is not recognised")
    ok(sign_in(app_url, GREGOR), 200)
    stranger = f"stranger-{uuid.uuid4().hex[:8]}@example.com"
    variants = [stranger, f"  {stranger.upper()} ", stranger.title(), f" {stranger}", stranger.upper()]
    bodies = []
    for variant in variants:
        r = sign_in(app_url, variant, WRONG_PASS)
        refused(r, 401, "Email or passphrase is not recognised")
        bodies.append(r.content)
    assert len(set(bodies)) == 1
    refused(sign_in(app_url, stranger, WRONG_PASS), 429, "Too many attempts, wait 15 minutes")
    refused(sign_in(app_url, f" {stranger.upper()}  ", WRONG_PASS), 429, "Too many attempts, wait 15 minutes")
    other = f"other-{uuid.uuid4().hex[:8]}@example.com"
    refused(sign_in(app_url, other, WRONG_PASS), 401, "Email or passphrase is not recognised")


def test_sign_in_redirects(app_url: str, browser: Browser) -> None:
    for path in (*STAFF_PATHS, f"/pieces/{NOWHERE_ID}", f"/catalogue/{NOWHERE_ID}"):
        r = page_get(app_url, None, path)
        assert r.is_redirect, path
        loc = urlsplit(r.headers["location"])
        assert loc.path == "/login" and parse_qs(loc.query).get("next") == [path], r.headers["location"]
    assert ok(page_get(app_url, None, "/wall"), 200)
    plaque = page_get(app_url, None, f"/wall/{NOWHERE_ID}")
    assert plaque.status_code == 404 and not plaque.is_redirect
    signed = page_get(app_url, ROSA, "/login")
    assert signed.is_redirect and urlsplit(signed.headers["location"]).path == "/"
    with open_app(browser, app_url + "/budget") as p:
        assert urlsplit(p.url).path == "/login"
        ui_sign_in(p, ROSA)
        p.wait_for_url(lambda u: urlsplit(u).path == "/budget")
    evil_host = urlsplit(EVIL_ORIGIN).netloc
    for bad in ("/" * 2 + evil_host + "/budget", EVIL_ORIGIN + "/budget"):
        with open_app(browser, f"{app_url}/login?next={bad}") as p:
            ui_sign_in(p, ROSA)
            p.wait_for_url(lambda u: urlsplit(u).path != "/login")
            assert same_origin(p.url, app_url) and urlsplit(p.url).path == "/"


def test_wf_access_draft_privacy(app_url: str) -> None:
    rosa, tobias = account(app_url, ROSA), account(app_url, TOBIAS)
    draft = create_piece(app_url, TOBIAS)
    pid = draft["id"]
    refused(call(app_url, "GET", f"/api/pieces/{pid}", rosa["token"]), 404, "Not found")
    refused(call(app_url, "PATCH", f"/api/pieces/{pid}", rosa["token"],
                 {"version": draft["version"], "title": fresh_title("Taken")}), 404, "Not found")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", rosa["token"],
                 {"version": draft["version"], "action": "submit"}), 404, "Not found")
    refused(call(app_url, "PUT", f"/api/schedule/{free_future_day(app_url)}", tok(app_url, ROSA),
                 {"piece_id": pid}), 404, "Not found")
    page = page_get(app_url, ROSA, f"/pieces/{pid}")
    assert page.status_code == 404 and "That page is not here" in page.text
    for who, owner_id in ((rosa, rosa["id"]), (tobias, tobias["id"])):
        counts = ok(call(app_url, "GET", "/api/pieces", who["token"]), 200).json()["counts"]
        assert set(counts) == set(STATES)
        mine = pg().rows(f"SELECT count(*) AS n FROM pieces WHERE state = 'draft' AND owner_id = {sql_text(owner_id)}")
        assert counts["draft"] == int(mine[0]["n"])
    hidden = ok(call(app_url, "GET", "/api/pieces", rosa["token"], params={"q": draft["title"]}), 200).json()
    assert hidden["total"] == 0 and hidden["rows"] == []
    seen = ok(call(app_url, "GET", "/api/pieces", tok(app_url, GREGOR), params={"q": draft["title"]}), 200).json()
    assert [row["id"] for row in seen["rows"]] == [pid]
    target = advance_to(app_url, "in_review", owner=TOBIAS)
    before, audits = stored(target["id"]), audit_count(target["id"])
    attempts = [
        (ROSA, "POST", f"/api/pieces/{target['id']}/transition", {"version": target["version"], "action": "clear"}),
        (ROSA, "PATCH", f"/api/pieces/{target['id']}", {"version": target["version"], "title": fresh_title("Hijack")}),
        (DAN, "POST", f"/api/pieces/{target['id']}/reviews", {"version": target["version"], "kind": "licence", "result": "pass"}),
        (PRIYA, "POST", f"/api/pieces/{target['id']}/transition",
         {"version": target["version"], "action": "return_for_changes", "reason": REASON}),
        (PRIYA, "POST", "/api/pieces", {"title": fresh_title("Reviewer"), "summary": SUMMARY, "fee_cents": 0}),
        (HALIMA, "POST", "/api/pieces", {"title": fresh_title("Lead"), "summary": SUMMARY, "fee_cents": 0}),
    ]
    for email, method, path, body in attempts:
        refused(call(app_url, method, path, tok(app_url, email), body), 403, "Your role may not do that")
    assert stored(target["id"]) == before and audit_count(target["id"]) == audits
    for email in ACCOUNTS:
        for path in (*STAFF_PATHS, f"/pieces/{target['id']}"):
            assert page_get(app_url, email, path).status_code == 200, (email, path)
    fresh = create_piece(app_url, TOBIAS, objects=clean_objects(app_url, 1))
    refused(call(app_url, "GET", f"/api/pieces/{fresh['id']}", rosa["token"]), 404, "Not found")
    step(app_url, TOBIAS, fresh, "submit")
    assert get_piece(app_url, ROSA, fresh["id"])["state"] == "submitted"


def test_wf_access_auditor_read_only(app_url: str, browser: Browser) -> None:
    gregor = tok(app_url, GREGOR)
    draft = create_piece(app_url, ROSA, objects=clean_objects(app_url, 1))
    live = advance_to(app_url, "in_review", objects=[PAIR_A])
    for piece in (draft, live):
        assert ok(call(app_url, "GET", f"/api/pieces/{piece['id']}", gregor), 200).json()["id"] == piece["id"]
    quarter = budget(app_url)["quarter"]
    snapshot = {p["id"]: (stored(p["id"]), audit_count(p["id"])) for p in (draft, live)}
    writes = [
        ("POST", "/api/pieces", {"title": fresh_title("Audit"), "summary": SUMMARY, "fee_cents": 0}),
        ("PATCH", f"/api/pieces/{draft['id']}", {"version": draft["version"], "title": fresh_title("Audit")}),
        ("PUT", f"/api/pieces/{draft['id']}/objects", {"version": draft["version"], "object_ids": clean_objects(app_url, 2)}),
        ("POST", f"/api/pieces/{live['id']}/transition", {"version": live["version"], "action": "return_for_changes", "reason": REASON}),
        ("POST", f"/api/pieces/{live['id']}/reviews", {"version": live["version"], "kind": "licence", "result": "pass"}),
        ("POST", f"/api/pieces/{live['id']}/duplicate-acks", {"object_id": PAIR_A, "duplicate_object_id": PAIR_B}),
        ("PUT", f"/api/schedule/{free_future_day(app_url)}", {"piece_id": live["id"]}),
        ("PATCH", f"/api/budget/{quarter}", {"piece_id": live["id"], "delta_cents": 100}),
        ("PATCH", f"/api/budget/{quarter}", {"reset": True}),
        ("POST", "/api/pack", pack_doc(app_url, fresh_title("Pack"), [entry(app_url, fresh_title("Packed"), "draft")])),
    ]
    for method, path, body in writes:
        refused(call(app_url, method, path, gregor, body), 403, "Your role may not do that")
    ack_rows = pg().rows(f"SELECT count(*) AS n FROM duplicate_acks WHERE piece_id = {live['id']}")
    assert int(ack_rows[0]["n"]) == 0
    assert {p: (stored(p), audit_count(p)) for p in snapshot} == snapshot
    ok(call(app_url, "PUT", "/api/preferences", gregor, {"date_display": "relative"}), 200)
    with staff(browser, app_url, GREGOR, f"/pieces/{live['id']}") as p:
        expect(p.get_by_text("Read only")).to_be_visible()
        rail(p, set())


def test_wf_review_rules_own_piece(app_url: str) -> None:
    piece = advance_to(app_url, "in_review")
    pid, before, audits = piece["id"], stored(piece["id"]), audit_count(piece["id"])
    for kind in ("licence", "accessibility"):
        refused(call(app_url, "POST", f"/api/pieces/{pid}/reviews", tok(app_url, ROSA),
                     {"version": piece["version"], "kind": kind, "result": "pass"}),
                403, "You cannot review your own piece")
    for action in ("clear", "publish"):
        refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, ROSA),
                     {"version": piece["version"], "action": action}), 403, "You cannot review your own piece")
    assert stored(pid) == before and audit_count(pid) == audits
    assert int(pg().rows(f"SELECT count(*) AS n FROM reviews WHERE piece_id = {pid}")[0]["n"]) == 0


def test_second_reviewer(app_url: str) -> None:
    piece = advance_to(app_url, "licence_passed")
    pid = piece["id"]
    before = stored(pid)
    refused(call(app_url, "POST", f"/api/pieces/{pid}/reviews", tok(app_url, PRIYA),
                 {"version": piece["version"], "kind": "accessibility", "result": "pass"}),
            403, "A second reviewer is required")
    assert stored(pid) == before
    done = review(app_url, DAN, piece, "accessibility")
    assert done["accessibility_review"] == "pass"
    rows = pg().rows(f"SELECT kind, reviewer_id FROM reviews WHERE piece_id = {pid} ORDER BY kind")
    assert {r["kind"]: str(r["reviewer_id"]) for r in rows} == {
        "accessibility": account(app_url, DAN)["id"], "licence": account(app_url, PRIYA)["id"]}


def test_citation_checks(app_url: str) -> None:
    empty = create_piece(app_url, ROSA)
    refused(call(app_url, "POST", f"/api/pieces/{empty['id']}/transition", tok(app_url, ROSA),
                 {"version": empty["version"], "action": "submit"}), 400, "Cite at least one object", "object_ids")
    good = clean_objects(app_url, 1)[0]
    cited = [good, BLOCKED_ID, NO_ARTIST_ID, NO_LICENCE_URL_ID]
    blocked, no_artist, no_url = (get_object(app_url, i) for i in cited[1:])
    assert blocked["license"] == "All rights reserved"
    assert not (no_artist["artist"] or "").strip() and not no_url.get("license_url")
    piece = create_piece(app_url, ROSA, objects=cited)
    body = refused(call(app_url, "POST", f"/api/pieces/{piece['id']}/transition", tok(app_url, ROSA),
                        {"version": piece["version"], "action": "submit"}),
                   400, "Some cited objects cannot be used", "object_ids")
    assert body["error"]["lines"] == [
        f"{blocked['title']}: Licence is not on the allowed list",
        f"{no_artist['title']}: No artist is attributed",
        f"{no_url['title']}: No licence address is recorded",
    ]
    assert stored(piece["id"])["state"] == "draft"
    refused(call(app_url, "PUT", f"/api/pieces/{piece['id']}/objects", tok(app_url, ROSA),
                 {"version": piece["version"], "object_ids": list(range(1, CITE_MAX + 2))}),
            400, "Cite at most 40 objects", "object_ids")
    refused(call(app_url, "PUT", f"/api/pieces/{piece['id']}/objects", tok(app_url, ROSA),
                 {"version": piece["version"], "object_ids": [good, good]}),
            400, "Each object may be cited once", "object_ids")
    positions = pg().rows(f"SELECT object_id FROM piece_objects WHERE piece_id = {piece['id']} ORDER BY position")
    assert [r["object_id"] for r in positions] == cited


def test_wf_review_rules_duplicate_ack(app_url: str, browser: Browser) -> None:
    piece = advance_to(app_url, "in_review", objects=[PAIR_A])
    pid = piece["id"]
    dups = flagged(app_url, PAIR_A)
    assert PAIR_B in dups
    refused(call(app_url, "POST", f"/api/pieces/{pid}/reviews", tok(app_url, PRIYA),
                 {"version": piece["version"], "kind": "licence", "result": "pass"}),
            409, "Acknowledge every flagged duplicate first")
    twin = get_object(app_url, PAIR_B)
    with staff(browser, app_url, DAN, f"/catalogue/{PAIR_A}?piece={pid}") as p:
        expect(p.get_by_role("list", name="Similar objects")).to_contain_text(twin["title"])
        expect(p.get_by_role("button", name=f"Acknowledge {twin['title']}")).to_have_count(0)
    with staff(browser, app_url, PRIYA, f"/catalogue/{PAIR_A}?piece={NOWHERE_ID}") as p:
        expect(p.get_by_role("list", name="Similar objects")).to_contain_text("Possible duplicate")
        expect(p.get_by_role("button", name=f"Acknowledge {twin['title']}")).to_have_count(0)
        p.goto(f"{app_url}/catalogue/{PAIR_A}?piece={pid}")
        p.get_by_role("button", name=f"Acknowledge {twin['title']}").click()
        expect(desk_updates(p)).to_contain_text("Duplicate acknowledged")
    for dup in dups:
        if dup != PAIR_B:
            body = ok(ack(app_url, PRIYA, pid, PAIR_A, dup), 201).json()
            assert (body["piece_id"], body["object_id"], body["duplicate_object_id"]) == (pid, PAIR_A, dup)
            assert body["acknowledged_at"].endswith("Z")
    refused(ack(app_url, PRIYA, pid, PAIR_A, PAIR_B), 409, "That duplicate is already acknowledged")
    rival = advance_to(app_url, "in_review", objects=[PAIR_A])
    raced = together(lambda: ack(app_url, PRIYA, rival["id"], PAIR_A, PAIR_B),
                     lambda: ack(app_url, PRIYA, rival["id"], PAIR_A, PAIR_B))
    assert sorted(r.status_code for r in raced) == [201, 409], [r.text for r in raced]
    assert next(r for r in raced if r.status_code == 409).json()["error"]["message"] == \
        "That duplicate is already acknowledged"
    assert len(pg().rows(f"SELECT acknowledged_by FROM duplicate_acks WHERE piece_id = {rival['id']}")) == 1
    other = clean_objects(app_url, 1)[0]
    refused(ack(app_url, PRIYA, pid, other, PAIR_B), 400, "That object is not cited by this piece", "object_id")
    refused(ack(app_url, PRIYA, pid, PAIR_A, other), 400, "That object is not a flagged duplicate", "duplicate_object_id")
    rows = pg().rows(f"SELECT duplicate_object_id, acknowledged_by, acknowledged_at FROM duplicate_acks "
                     f"WHERE piece_id = {pid} AND object_id = {PAIR_A}")
    assert sorted(r["duplicate_object_id"] for r in rows) == sorted(dups)
    assert all(str(r["acknowledged_by"]) == account(app_url, PRIYA)["id"] and r["acknowledged_at"] for r in rows)
    assert get_piece(app_url, PRIYA, pid)["version"] == piece["version"]
    assert review(app_url, PRIYA, piece, "licence")["licence_review"] == "pass"


def test_wf_review_rules_revise_round(app_url: str, browser: Browser) -> None:
    piece = advance_to(app_url, "in_review", objects=[PAIR_A])
    pid = piece["id"]
    for dup in flagged(app_url, PAIR_A):
        ok(ack(app_url, PRIYA, pid, PAIR_A, dup), 201)
    piece = review(app_url, DAN, review(app_url, PRIYA, piece, "licence"), "accessibility")
    with staff(browser, app_url, HALIMA, f"/pieces/{pid}") as p:
        p.get_by_role("button", name="Return for changes").click()
        dialog = p.get_by_role("dialog", name="Return for changes")
        dialog.get_by_role("textbox", name="Reason").fill(REASON)
        dialog.get_by_role("button", name="Confirm").click()
        expect(desk_updates(p)).to_contain_text(f"{piece['title']} moved to changes_requested")
    piece = get_piece(app_url, ROSA, pid)
    assert piece["state"] == "changes_requested"
    for email in (TOBIAS, HALIMA):
        refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, email),
                     {"version": piece["version"], "action": "revise"}), 403, "Your role may not do that")
    with staff(browser, app_url, ROSA, f"/pieces/{pid}") as p:
        p.get_by_role("button", name="Revise").click()
        expect(desk_updates(p)).to_contain_text(f"{piece['title']} moved to draft")
        expect(p.get_by_text("Not yet")).to_have_count(2)
    piece = get_piece(app_url, ROSA, pid)
    assert piece["state"] == "draft" and piece["licence_review"] is None and piece["accessibility_review"] is None
    assert int(pg().rows(f"SELECT count(*) AS n FROM reviews WHERE piece_id = {pid}")[0]["n"]) == 0
    assert int(pg().rows(f"SELECT count(*) AS n FROM duplicate_acks WHERE piece_id = {pid}")[0]["n"]) == 0
    piece = step(app_url, PRIYA, step(app_url, ROSA, piece, "submit"), "start_review")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/reviews", tok(app_url, PRIYA),
                 {"version": piece["version"], "kind": "licence", "result": "pass"}),
            409, "Acknowledge every flagged duplicate first")
    trail = [r["to_state"] for r in pg().rows(
        f"SELECT to_state FROM audit_entries WHERE piece_id = {pid} AND from_state IS NOT NULL AND from_state <> '' "
        "ORDER BY created_at, id")]
    assert trail[-8:] == ["submitted", "in_review", "in_review", "in_review", "changes_requested", "draft",
                          "submitted", "in_review"]


def test_wf_review_rules_published_fields(app_url: str) -> None:
    draft = create_piece(app_url, ROSA)
    refused(call(app_url, "PATCH", f"/api/pieces/{draft['id']}", tok(app_url, ROSA),
                 {"version": draft["version"], "state": "cleared", "owner_id": "x"}),
            400, "state cannot be set here", "state")
    assert stored(draft["id"])["state"] == "draft" and stored(draft["id"])["version"] == draft["version"]
    live = advance_to(app_url, "in_review")
    refused(call(app_url, "POST", f"/api/pieces/{live['id']}/reviews", tok(app_url, PRIYA),
                 {"version": live["version"], "kind": "licence", "result": "pass",
                  "reviewer_id": account(app_url, DAN)["id"]}),
            400, "reviewer_id cannot be set here", "reviewer_id")
    assert int(pg().rows(f"SELECT count(*) AS n FROM reviews WHERE piece_id = {live['id']}")[0]["n"]) == 0
    title = fresh_title("Mass")
    refused(call(app_url, "POST", "/api/pieces", tok(app_url, ROSA),
                 {"title": title, "zeta": 1, "summary": SUMMARY, "fee_cents": 0, "alpha": 2}),
            400, "zeta cannot be set here", "zeta")
    assert pg().rows(f"SELECT id FROM pieces WHERE title = {sql_text(title)}") == []
    refused(call(app_url, "PUT", "/api/preferences", tok(app_url, DAN), {"rows_per_page": 25, "account_id": "x"}),
            400, "account_id cannot be set here", "account_id")
    dan = account(app_url, DAN)["id"]
    rows = pg().rows(f"SELECT rows_per_page FROM preferences WHERE account_id = {sql_text(dan)}")
    assert all(r["rows_per_page"] != 25 for r in rows)


def _checked(base: str, email: str, piece: dict, do: Callable[[], dict], to_state: str) -> dict:
    before = audit_count(piece["id"])
    after = do()
    assert after["state"] == to_state and after["version"] == piece["version"] + 1
    assert audit_count(piece["id"]) == before + 1
    last = pg().rows(f"SELECT from_state, to_state, actor_id FROM audit_entries WHERE piece_id = {piece['id']} "
                     "ORDER BY created_at DESC, id DESC LIMIT 1")[0]
    assert (last["from_state"], last["to_state"]) == (piece["state"], to_state)
    assert str(last["actor_id"]) == account(base, email)["id"]
    return after


def test_wf_state_machine_legal_steps(app_url: str) -> None:
    piece = create_piece(app_url, ROSA, objects=clean_objects(app_url, 2))
    piece = _checked(app_url, ROSA, piece, lambda: step(app_url, ROSA, piece, "submit"), "submitted")
    assert piece["submitted_fee_cents"] == piece["fee_cents"]
    p1 = piece
    piece = _checked(app_url, PRIYA, p1, lambda: step(app_url, PRIYA, p1, "start_review"), "in_review")
    p2 = piece
    piece = _checked(app_url, PRIYA, p2, lambda: review(app_url, PRIYA, p2, "licence"), "in_review")
    refused(call(app_url, "POST", f"/api/pieces/{piece['id']}/reviews", tok(app_url, PRIYA),
                 {"version": piece["version"], "kind": "licence", "result": "pass"}),
            409, "That review is already recorded")
    p3 = piece
    piece = _checked(app_url, DAN, p3, lambda: review(app_url, DAN, p3, "accessibility"), "in_review")
    p4 = piece
    piece = _checked(app_url, HALIMA, p4, lambda: step(app_url, HALIMA, p4, "clear"), "cleared")
    cleared_at = piece["cleared_at"]
    assert cleared_at and cleared_at.endswith("Z")
    far = free_future_day(app_url)
    p5 = piece
    piece = _checked(app_url, HALIMA, p5, lambda: step(app_url, HALIMA, p5, "schedule", day=far), "scheduled")
    before, audits = stored(piece["id"]), audit_count(piece["id"])
    refused(call(app_url, "POST", f"/api/pieces/{piece['id']}/transition", tok(app_url, HALIMA),
                 {"version": piece["version"], "action": "publish"}), 409, f"{far} has not arrived yet")
    assert stored(piece["id"]) == before and audit_count(piece["id"]) == audits
    p6 = piece
    piece = _checked(app_url, HALIMA, p6, lambda: step(app_url, HALIMA, p6, "unschedule"), "cleared")
    assert piece["cleared_at"] == cleared_at
    today = free_today(app_url)
    p7 = piece
    piece = _checked(app_url, HALIMA, p7, lambda: step(app_url, HALIMA, p7, "schedule", day=today), "scheduled")
    p8 = piece
    shown = _checked(app_url, HALIMA, p8, lambda: step(app_url, HALIMA, p8, "publish"), "published")
    assert shown["published_at"] and shown["published_at"].endswith("Z") and shown["cleared_at"] == cleared_at
    stamp = pg().rows(f"SELECT published_at FROM pieces WHERE id = {shown['id']}")[0]["published_at"]
    assert stamp is not None
    p9 = shown
    shown = _checked(app_url, HALIMA, p9, lambda: step(app_url, HALIMA, p9, "withdraw", reason=REASON), "withdrawn")
    p10 = shown
    _checked(app_url, ROSA, p10, lambda: step(app_url, ROSA, p10, "revise"), "draft")
    other = advance_to(app_url, "in_review")
    other = _checked(app_url, PRIYA, other,
                     lambda: review(app_url, PRIYA, other, "licence", "fail", REASON), "changes_requested")
    o2 = other
    _checked(app_url, HALIMA, o2, lambda: step(app_url, HALIMA, o2, "reject", reason=REASON), "rejected")
    third = advance_to(app_url, "in_review")
    _checked(app_url, HALIMA, third,
             lambda: step(app_url, HALIMA, third, "return_for_changes", reason=REASON), "changes_requested")


def test_wf_state_machine_illegal_steps(app_url: str) -> None:
    draft = create_piece(app_url, ROSA, objects=clean_objects(app_url, 1))
    submitted = advance_to(app_url, "submitted", objects=[PAIR_A])
    live = advance_to(app_url, "in_review")
    cleared = advance_to(app_url, "cleared")
    dead = step(app_url, HALIMA, advance_to(app_url, "in_review"), "reject", reason=REASON)
    cases = [
        (ROSA, draft, {"action": "launch"}, "draft"),
        (ROSA, draft, {"action": "revise"}, "draft"),
        (ROSA, submitted, {"action": "submit"}, "submitted"),
        (HALIMA, submitted, {"action": "clear"}, "submitted"),
        (PRIYA, live, {"action": "start_review"}, "in_review"),
        (HALIMA, live, {"action": "withdraw", "reason": REASON}, "in_review"),
        (HALIMA, cleared, {"action": "publish"}, "cleared"),
        (ROSA, dead, {"action": "revise"}, "rejected"),
        (HALIMA, dead, {"action": "return_for_changes", "reason": REASON}, "rejected"),
    ]
    for email, piece, body, state in cases:
        before, audits = stored(piece["id"]), audit_count(piece["id"])
        refused(call(app_url, "POST", f"/api/pieces/{piece['id']}/transition", tok(app_url, email),
                     {"version": piece["version"], **body}), 409, f"That is not a legal step from {state}")
        assert stored(piece["id"]) == before and audit_count(piece["id"]) == audits
    before = stored(submitted["id"])
    refused(call(app_url, "POST", f"/api/pieces/{submitted['id']}/reviews", tok(app_url, PRIYA),
                 {"version": submitted["version"], "kind": "licence", "result": "pass"}),
            409, "That is not a legal step from submitted")
    refused(ack(app_url, PRIYA, submitted["id"], PAIR_A, PAIR_B), 409, "That is not a legal step from submitted")
    assert stored(submitted["id"]) == before
    assert int(pg().rows(f"SELECT count(*) AS n FROM duplicate_acks WHERE piece_id = {submitted['id']}")[0]["n"]) == 0


def test_wf_state_machine_version_conflict(app_url: str) -> None:
    stale_msg = "This piece changed while you were deciding. Reload and try again"
    draft = create_piece(app_url, ROSA)
    newer = ok(call(app_url, "PATCH", f"/api/pieces/{draft['id']}", tok(app_url, ROSA),
                    {"version": draft["version"], "title": fresh_title("Newer")}), 200).json()
    body = refused(call(app_url, "PATCH", f"/api/pieces/{draft['id']}", tok(app_url, ROSA),
                        {"version": draft["version"], "title": fresh_title("Older")}), 409, stale_msg)
    assert body["current"]["version"] == newer["version"] and body["current"]["title"] == newer["title"]
    assert stored(draft["id"])["title"] == newer["title"]
    piece = advance_to(app_url, "in_review")
    pid, audits = piece["id"], audit_count(piece["id"])
    responses = together(
        lambda: call(app_url, "POST", f"/api/pieces/{pid}/reviews", tok(app_url, PRIYA),
                     {"version": piece["version"], "kind": "licence", "result": "pass"}),
        lambda: call(app_url, "POST", f"/api/pieces/{pid}/reviews", tok(app_url, DAN),
                     {"version": piece["version"], "kind": "accessibility", "result": "pass"}),
    )
    assert sorted(r.status_code for r in responses) == [201, 409], [r.text for r in responses]
    loser = next(r for r in responses if r.status_code == 409)
    assert loser.json()["error"]["message"] == stale_msg
    assert loser.json()["current"]["version"] == piece["version"] + 1
    assert int(pg().rows(f"SELECT count(*) AS n FROM reviews WHERE piece_id = {pid}")[0]["n"]) == 1
    assert audit_count(pid) == audits + 1 and stored(pid)["version"] == piece["version"] + 1


def test_field_rules(app_url: str) -> None:
    rosa = tok(app_url, ROSA)
    title_msg, summary_msg = "A title of 1 to 80 characters is required", "A summary of 20 to 600 characters is required"
    fee_msg, reason_msg = "A fee must be between $0.00 and $5,000.00", "A reason of 10 to 400 characters is required"
    stem = uuid.uuid4().hex[:10]
    bad = [
        ({"title": "   ", "summary": SUMMARY, "fee_cents": 0}, "title", title_msg),
        ({"title": stem + "x" * (TITLE_MAX + 1 - len(stem)), "summary": SUMMARY, "fee_cents": 0}, "title", title_msg),
        ({"title": f"{stem} short", "summary": "  " + "s" * (SUMMARY_MIN - 1) + "  ", "fee_cents": 0}, "summary", summary_msg),
        ({"title": f"{stem} long", "summary": "s" * (SUMMARY_MAX + 1), "fee_cents": 0}, "summary", summary_msg),
        ({"title": f"{stem} high", "summary": SUMMARY, "fee_cents": FEE_MAX + 1}, "fee_cents", fee_msg),
        ({"title": f"{stem} low", "summary": SUMMARY, "fee_cents": -1}, "fee_cents", fee_msg),
        ({"title": f"{stem} part", "summary": SUMMARY, "fee_cents": 12.5}, "fee_cents", fee_msg),
        ({"title": f"{stem} text", "summary": SUMMARY, "fee_cents": "100"}, "fee_cents", fee_msg),
    ]
    for body, field, message in bad:
        refused(call(app_url, "POST", "/api/pieces", rosa, body), 400, message, field)
    assert pg().rows(f"SELECT id FROM pieces WHERE title LIKE {sql_text(stem + '%')}") == []
    edge = ok(call(app_url, "POST", "/api/pieces", rosa,
                   {"title": stem + "y" * (TITLE_MAX - len(stem)), "summary": " " + "s" * SUMMARY_MIN + " ",
                    "fee_cents": FEE_MAX}), 201).json()
    dup = call(app_url, "POST", "/api/pieces", rosa, {"title": edge["title"].upper(), "summary": SUMMARY, "fee_cents": 0})
    ok(dup, 400)
    err = dup.json()["error"]
    assert err["field"] == "title" and err["message"].startswith("A piece named ") and err["message"].endswith(" already exists")
    refused(call(app_url, "PATCH", f"/api/pieces/{edge['id']}", rosa, {"version": edge["version"], "fee_cents": FEE_MAX + 1}),
            400, fee_msg, "fee_cents")
    assert stored(edge["id"])["version"] == edge["version"]
    kind = pg().rows(f"SELECT pg_typeof(fee_cents)::text AS t, fee_cents FROM pieces WHERE id = {edge['id']}")[0]
    assert kind["t"] in ("integer", "bigint", "smallint") and kind["fee_cents"] == FEE_MAX
    live = advance_to(app_url, "in_review")
    for reason in ("short", "r" * (REASON_MAX + 1)):
        refused(call(app_url, "POST", f"/api/pieces/{live['id']}/transition", tok(app_url, HALIMA),
                     {"version": live["version"], "action": "return_for_changes", "reason": reason}),
                400, reason_msg, "reason")
    refused(call(app_url, "POST", f"/api/pieces/{live['id']}/reviews", tok(app_url, PRIYA),
                 {"version": live["version"], "kind": "licence", "result": "maybe"}),
            400, "Result must be pass or fail", "result")
    assert stored(live["id"])["version"] == live["version"]
    spaced = f"  {REASON}  "
    step(app_url, HALIMA, live, "return_for_changes", reason=spaced)
    last = pg().rows(f"SELECT reason FROM audit_entries WHERE piece_id = {live['id']} ORDER BY created_at DESC, id DESC LIMIT 1")
    assert last[0]["reason"] == spaced


def test_wf_state_machine_refusal_order(app_url: str) -> None:
    stale_msg = "This piece changed while you were deciding. Reload and try again"
    piece = advance_to(app_url, "licence_passed")
    pid, v = piece["id"], piece["version"]
    before, audits = stored(pid), audit_count(pid)
    big = b"x" * (BODY_LIMIT + 1)
    refused(call(app_url, "POST", "/api/pieces", raw=big, headers={"Content-Type": "text/plain", "Origin": EVIL_ORIGIN}),
            413, "That request is too large")
    padded = json.dumps({"date_display": "relative"}).encode()
    padded += b" " * (BODY_LIMIT - len(padded))
    ok(call(app_url, "PUT", "/api/preferences", tok(app_url, GREGOR), raw=padded,
            headers={"Content-Type": "application/json"}), 200)
    refused(call(app_url, "GET", f"/api/nowhere-{uuid.uuid4().hex[:6]}"), 404, "Not found")
    refused(call(app_url, "DELETE", "/api/audit"), 405, "That cannot be done here")
    refused(call(app_url, "POST", "/api/pieces", raw=b"title", headers={"Content-Type": "text/plain", "Origin": EVIL_ORIGIN}),
            403, "Cross-site requests are refused")
    refused(call(app_url, "POST", "/api/pieces", raw=b"title", headers={"Content-Type": "text/plain"}), 415, "Send JSON")
    ok(call(app_url, "PUT", "/api/preferences", tok(app_url, GREGOR), {"date_display": "relative"},
            headers={"Origin": app_url}), 200)
    refused(call(app_url, "POST", f"/api/pieces/{NOWHERE_ID}/transition", body={"bogus": 1}), 401, "Sign in first")
    refused(call(app_url, "POST", f"/api/pieces/{NOWHERE_ID}/transition", tok(app_url, HALIMA), {"bogus": 1}), 404, "Not found")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, GREGOR), [v]), 400, "Send a JSON object")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, GREGOR),
                 {"state": "cleared", "version": v - 1, "action": "clear"}), 400, "state cannot be set here", "state")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, GREGOR), {"version": v - 1, "action": "clear"}),
            403, "Your role may not do that")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/reviews", tok(app_url, ROSA),
                 {"version": v - 1, "kind": "accessibility", "result": "maybe"}), 403, "You cannot review your own piece")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/reviews", tok(app_url, PRIYA),
                 {"version": v - 1, "kind": "accessibility", "result": "pass"}), 403, "A second reviewer is required")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, TOBIAS), {"action": "clear"}),
            403, "Your role may not do that")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, HALIMA), {"action": "publish"}),
            400, "A version is required", "version")
    body = refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, HALIMA),
                        {"version": v - 1, "action": "publish"}), 409, stale_msg)
    assert body["current"]["version"] == v
    refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, HALIMA),
                 {"version": v, "action": "withdraw", "reason": "short"}), 409, "That is not a legal step from in_review")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, HALIMA),
                 {"version": v, "action": "reject", "reason": "short"}),
            400, "A reason of 10 to 400 characters is required", "reason")
    refused(call(app_url, "POST", f"/api/pieces/{pid}/transition", tok(app_url, HALIMA), {"version": v, "action": "clear"}),
            409, "Both reviews must pass before clearing")
    assert stored(pid) == before and audit_count(pid) == audits


def test_wf_queue_desk_queue(app_url: str, browser: Browser) -> None:
    rosa = tok(app_url, ROSA)
    ok(call(app_url, "PUT", "/api/preferences", rosa, {"rows_per_page": 25}), 200)
    stem = uuid.uuid4().hex[:8]
    made = []
    for i in range(26):
        made.append(ok(call(app_url, "POST", "/api/pieces", rosa,
                            {"title": f"{stem} {i:02d}", "summary": SUMMARY, "fee_cents": (i + 1) * 100}), 201).json())
    other_draft = create_piece(app_url, TOBIAS, title=f"{stem} hidden")
    first = ok(call(app_url, "GET", "/api/pieces", rosa, params={"q": stem, "page": 1}), 200).json()
    assert other_draft["id"] not in [row["id"] for row in first["rows"]]
    audited = ok(call(app_url, "GET", "/api/pieces", tok(app_url, GREGOR), params={"q": stem}), 200).json()
    assert audited["total"] == len(made) + 1
    assert set(first["counts"]) == set(STATES)
    assert first["total"] == len(made) and first["rows_per_page"] == 25 and len(first["rows"]) == 25
    assert all("summary" not in row for row in first["rows"])
    second = ok(call(app_url, "GET", "/api/pieces", rosa, params={"q": stem, "page": 2}), 200).json()
    assert len(second["rows"]) == len(made) - 25 and second["page"] == 2
    assert ok(call(app_url, "GET", "/api/pieces", rosa, params={"q": stem, "page": 3}), 200).json()["rows"] == []
    ok(call(app_url, "PUT", "/api/preferences", rosa, {"rows_per_page": 100}), 200)

    def sorted_rows(sort: str) -> list[dict]:
        return ok(call(app_url, "GET", "/api/pieces", rosa, params={"q": stem, "sort": sort}), 200).json()["rows"]

    def stamps(rows: list[dict]) -> list[datetime]:
        return [datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")) for r in rows]

    ordered = [p["title"] for p in made]
    assert [r["title"] for r in sorted_rows("title")] == ordered
    oldest, newest = sorted_rows("oldest"), sorted_rows("newest")
    assert sorted(r["title"] for r in oldest) == sorted(r["title"] for r in newest) == sorted(ordered)
    assert stamps(oldest) == sorted(stamps(oldest))
    assert stamps(newest) == sorted(stamps(newest), reverse=True)
    assert [r["title"] for r in sorted_rows("fee")] == ordered[::-1]
    counts = first["counts"]
    assert counts["draft"] >= len(made)
    upper = ok(call(app_url, "GET", "/api/pieces", rosa, params={"q": stem.upper()}), 200).json()
    assert upper["total"] == len(made)
    ok(call(app_url, "PUT", "/api/preferences", rosa, {"rows_per_page": 50}), 200)
    with staff(browser, app_url, ROSA, "/") as p:
        search_queue(p, f"{stem} 07")
        link = p.get_by_role("link", name=f"{stem} 07", exact=True)
        expect(link).to_be_visible()
        expect(p.get_by_role("link", name=f"{stem} 08", exact=True)).to_have_count(0)
        row = p.get_by_role("row").filter(has=link)
        expect(row).to_contain_text("draft")
        expect(row).to_contain_text("Rosa Aldridge")
        expect(row.get_by_text("Not yet")).to_have_count(2)
        expect(p.get_by_text(re.compile(r"\d+ of \d+ pieces")).first).to_be_visible()
        assert link.get_attribute("href").endswith(f"/pieces/{made[7]['id']}")


def _needs(browser: Browser, base: str, email: str, stem: str, shown: set[str], hidden: set[str]) -> None:
    with staff(browser, base, email, "/") as p:
        search_queue(p, stem)
        for title in shown | hidden:
            expect(p.get_by_role("link", name=title, exact=True)).to_be_visible()
        p.get_by_role("checkbox", name="Needs my decision").check()
        advance(p, ADVANCE_MS)
        for title in hidden:
            expect(p.get_by_role("link", name=title, exact=True)).to_have_count(0)
        for title in shown:
            expect(p.get_by_role("link", name=title, exact=True)).to_be_visible()
        if not shown:
            expect(p.get_by_text("No pieces match that search")).to_be_visible()


def test_wf_queue_desk_needs_my_decision(app_url: str, browser: Browser) -> None:
    stem = uuid.uuid4().hex[:8]
    draft = create_piece(app_url, ROSA, title=f"{stem} Draft")
    piece = advance_to(app_url, "submitted", title=f"{stem} Piece")
    d, t = draft["title"], piece["title"]
    _needs(browser, app_url, PRIYA, stem, {t}, {d})
    _needs(browser, app_url, DAN, stem, {t}, {d})
    _needs(browser, app_url, ROSA, stem, {d}, {t})
    _needs(browser, app_url, HALIMA, stem, set(), {t, d})
    with staff(browser, app_url, GREGOR, "/") as p:
        expect(p.get_by_role("checkbox", name="Needs my decision")).to_be_disabled()
    piece = review(app_url, PRIYA, step(app_url, PRIYA, piece, "start_review"), "licence")
    _needs(browser, app_url, PRIYA, stem, set(), {t, d})
    _needs(browser, app_url, DAN, stem, {t}, {d})
    _needs(browser, app_url, HALIMA, stem, set(), {t, d})
    review(app_url, DAN, piece, "accessibility")
    _needs(browser, app_url, DAN, stem, set(), {t, d})
    _needs(browser, app_url, HALIMA, stem, {t}, {d})


def test_wf_queue_desk_decision_rail(app_url: str, browser: Browser) -> None:
    draft = create_piece(app_url, ROSA, objects=clean_objects(app_url, 1))
    submitted = advance_to(app_url, "submitted")
    half = advance_to(app_url, "licence_passed")
    both = advance_to(app_url, "passed")
    cleared = advance_to(app_url, "cleared")
    cases = [
        (ROSA, draft, {"Submit for clearance"}),
        (PRIYA, submitted, {"Start review"}),
        (DAN, submitted, {"Start review"}),
        (DAN, half, {"Record accessibility review"}),
        (PRIYA, half, set()),
        (ROSA, half, set()),
        (HALIMA, both, {"Clear for the wall", "Return for changes", "Reject"}),
        (HALIMA, cleared, {"Schedule"}),
    ]
    for email, piece, present in cases:
        with staff(browser, app_url, email, f"/pieces/{piece['id']}") as p:
            expect(p.get_by_role("heading", name=piece["title"])).to_be_visible()
            rail(p, present)
            if email == ROSA and piece is draft:
                expect(p.get_by_role("button", name="Save draft")).to_be_visible()
                expect(p.get_by_role("button", name="Add object")).to_be_visible()
    hidden = create_piece(app_url, TOBIAS, objects=clean_objects(app_url, 1))
    assert page_get(app_url, ROSA, f"/pieces/{hidden['id']}").status_code == 404
    with staff(browser, app_url, ROSA, f"/pieces/{hidden['id']}") as p:
        expect(p.get_by_role("heading", name="That page is not here")).to_be_visible()
        rail(p, set())
    with staff(browser, app_url, TOBIAS, f"/pieces/{hidden['id']}") as p:
        rail(p, {"Submit for clearance"})
    for email, visible in ((ROSA, True), (HALIMA, False), (PRIYA, False), (GREGOR, False)):
        with staff(browser, app_url, email, "/") as p:
            button = p.get_by_role("button", name="New piece")
            if visible:
                expect(button).to_be_visible()
            else:
                expect(button).to_have_count(0)


def test_wf_queue_desk_list_failure(app_url: str, browser: Browser) -> None:
    piece = create_piece(app_url, ROSA)
    with staff(browser, app_url, ROSA, "/") as p:
        p.route("**/*", lambda route: route.abort() if route.request.resource_type in ("fetch", "xhr")
                else route.continue_())
        search_queue(p, piece["title"])
        expect(p.get_by_text("Could not load that list")).to_be_visible()
        expect(p.get_by_role("button", name="Try again")).to_be_visible()
        expect(p.get_by_role("searchbox", name="Search pieces")).to_be_enabled()
        expect(p.get_by_role("link", name="Catalogue")).to_be_visible()
        p.unroute("**/*")
        p.get_by_role("button", name="Try again").click()
        advance(p, ADVANCE_MS)
        expect(p.get_by_role("link", name=piece["title"], exact=True)).to_be_visible()
        expect(p.get_by_text("Could not load that list")).to_have_count(0)


def _walk(base: str, token: str, **params: Any) -> tuple[list[int], dict, dict]:
    ids: list[int] = []
    cursor, first = None, None
    for _ in range(WALK_PAGE_CAP):
        query = dict(params, limit=PAGE_LIMIT)
        if cursor:
            query["cursor"] = cursor
        body = ok(call(base, "GET", "/api/objects", token, params=query), 200).json()
        first = first or body
        ids += [o["id"] for o in body["objects"]]
        if body["wrap"]:
            return ids, body, first
        cursor = body["nextCursor"]
    raise AssertionError("catalogue walk never wrapped")


def test_wf_catalogue_walk(app_url: str) -> None:
    token = tok(app_url, ROSA)
    ids, last, first = _walk(app_url, token, seed=1)
    assert len(ids) == CATALOGUE_SIZE and set(ids) == set(range(1, CATALOGUE_SIZE + 1))
    assert first["total"] == CATALOGUE_SIZE and first["wrap"] is False
    again = ok(call(app_url, "GET", "/api/objects", token, params={"seed": 1, "cursor": last["nextCursor"]}), 200).json()
    assert [o["id"] for o in again["objects"]] == [o["id"] for o in first["objects"]]
    nxt = first["nextCursor"]
    a = ok(call(app_url, "GET", "/api/objects", token, params={"seed": 1, "cursor": nxt}), 200).json()
    b = ok(call(app_url, "GET", "/api/objects", token, params={"seed": 1, "cursor": nxt}), 200).json()
    assert [o["id"] for o in a["objects"]] == [o["id"] for o in b["objects"]]
    one, _, head1 = _walk(app_url, token, seed=1, license="CC0")
    two, _, head2 = _walk(app_url, token, seed=SEED_MAX, license="CC0")
    assert len(one) == len(set(one)) == head1["total"] and set(one) == set(two)
    assert one != two
    assert all(o["license"] == "CC0" for o in head1["objects"] + head2["objects"])
    clamped = ok(call(app_url, "GET", "/api/objects", token, params={"limit": PAGE_LIMIT + 1}), 200).json()
    assert len(clamped["objects"]) == PAGE_LIMIT
    probe = get_object(app_url, 1)["title"]
    hits, _, found = _walk(app_url, token, q=probe.lower())
    assert 1 in hits
    assert all(probe.lower() in (o["title"] + " " + (o["artist"] or "")).lower() for o in found["objects"])
    refused(call(app_url, "GET", "/api/objects", token, params={"cursor": "not-a-cursor"}),
            400, "That cursor is not valid", "cursor")


def _visible_text_near(p: Page, link: Any, text: str) -> bool:
    return p.evaluate(
        """([link, text]) => {
          const r = link.getBoundingClientRect();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            if (!n.textContent.includes(text)) continue;
            const el = n.parentElement;
            if (!el.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
            const q = el.getBoundingClientRect();
            if (!(q.width && q.height && q.right > r.left && q.left < r.right)) continue;
            // checkVisibility ignores ancestor clipping, so a strip hidden by a max-height:0 overflow:hidden
            // wrapper or a clip/transform slide still has a sized box: require it inside every clipping ancestor
            let clipped = false;
            for (let a = el.parentElement; a && a !== document.body && !clipped; a = a.parentElement) {
              const s = getComputedStyle(a);
              if (s.overflow === 'visible' && s.clipPath === 'none') continue;
              const c = a.getBoundingClientRect();
              clipped = q.bottom <= c.top || q.top >= c.bottom || q.right <= c.left || q.left >= c.right;
            }
            if (!clipped) return true;
          }
          return false;
        }""", [link.element_handle(), text])


def test_wf_catalogue_board(app_url: str, browser: Browser) -> None:
    board_seed = 7
    objs = ok(call(app_url, "GET", "/api/objects", tok(app_url, ROSA), params={"seed": board_seed}), 200).json()["objects"]
    with staff(browser, app_url, ROSA, f"/catalogue?seed={board_seed}") as p:
        p.set_viewport_size({"width": 1280, "height": 800})
        usable_objs = [o for o in objs if o["license"] in ALLOWED_LICENCES][:6]
        for o in usable_objs:
            link = p.get_by_role("link", name=o["title"], exact=True)
            img = link.get_by_role("img", name=o["title"], exact=True)
            expect(img).to_be_visible()
            box = img.bounding_box()
            longer = max(box["width"], box["height"])
            assert CUTOUT_MIN_PX - RATIO_SLACK_PX <= longer <= CUTOUT_MAX_PX + RATIO_SLACK_PX, (o["id"], box)
            assert abs(box["width"] * o["height"] - box["height"] * o["width"]) <= RATIO_SLACK_PX * max(o["width"], o["height"])
        for o in [x for x in objs if x["license"] not in ALLOWED_LICENCES]:
            expect(p.get_by_role("link", name=o["title"], exact=True)).to_have_count(0)
        target = usable_objs[0]
        link = p.get_by_role("link", name=target["title"], exact=True)
        p.mouse.move(0, 0)
        assert not _visible_text_near(p, link, target["artist"])
        link.focus()
        poll(lambda: _visible_text_near(p, link, target["artist"]) and _visible_text_near(p, link, target["license"]),
             POLL_SECONDS, "strip revealed on focus")
        p.get_by_role("searchbox", name="Search objects").focus()
        link.hover()
        poll(lambda: _visible_text_near(p, link, target["artist"]), POLL_SECONDS, "strip revealed on hover")
        names = [l.get_attribute("href") for l in p.get_by_role("link").all()]
        p.reload()
        assert [l.get_attribute("href") for l in p.get_by_role("link").all()] == names
        expect(p.get_by_role("button", name="Previous")).to_be_disabled()
        p.get_by_role("button", name="Next").click()
        p.wait_for_url(re.compile(r"cursor="))
        p.get_by_role("button", name="Previous").click()
        expect(p.get_by_role("link", name=target["title"], exact=True)).to_be_visible()
        p.get_by_role("button", name="Shuffle").click()
        p.wait_for_url(lambda u: parse_qs(urlsplit(u).query).get("seed", [str(board_seed)])[0] != str(board_seed))
        seed = int(parse_qs(urlsplit(p.url).query)["seed"][0])
        assert 1 <= seed <= SEED_MAX
        blocked = get_object(app_url, BLOCKED_ID)
        box = p.get_by_role("searchbox", name="Search objects")
        box.fill(blocked["title"])
        box.press("Enter")
        advance(p, ADVANCE_MS)
        expect(p.get_by_role("img", name=f"{blocked['title']}, licence not cleared for reuse")).to_be_visible()
        expect(p.get_by_role("link", name=blocked["title"], exact=True)).to_have_count(0)


def test_wf_catalogue_similar(app_url: str, browser: Browser) -> None:
    token = tok(app_url, PRIYA)

    def similar(oid: int, **params: Any) -> list[dict]:
        r = ok(call(app_url, "GET", f"/api/objects/{oid}/similar", token, params={"limit": SIMILAR_LIMIT, **params}), 200)
        assert r.json()["id"] == oid
        return r.json()["results"]

    res = similar(PAIR_A)
    assert res == similar(PAIR_A)
    assert all(isinstance(x["score"], int) and SIMILAR_FLOOR < x["score"] <= 100 for x in res)
    assert [(-x["score"], x["object"]["id"]) for x in res] == sorted((-x["score"], x["object"]["id"]) for x in res)
    assert similar(PAIR_A, offset=1)[: len(res) - 1] == res[1:]
    scores = {x["object"]["id"]: x["score"] for x in res}
    assert scores[PAIR_B] >= DUPLICATE_SCORE
    for other, score in list(scores.items())[:3]:
        back = {x["object"]["id"]: x["score"] for x in similar(other)}
        assert back[PAIR_A] == score
    obj, twin = get_object(app_url, PAIR_A), get_object(app_url, PAIR_B)
    with staff(browser, app_url, PRIYA, f"/catalogue/{PAIR_A}") as p:
        listing = p.get_by_role("list", name="Similar objects")
        expect(listing).to_contain_text(twin["title"])
        expect(listing).to_contain_text("Possible duplicate")
        expect(listing).to_contain_text(str(scores[PAIR_B]))
        for label in ("Title", "Artist", "Licence", "Licence address", "Source page", "Description", "Extract"):
            expect(p.get_by_text(label, exact=True).first).to_be_visible()
        expect(p.get_by_text(f"{obj['width']} by {obj['height']}")).to_be_visible()
        expect(p.get_by_role("link", name=obj["license_url"])).to_have_count(0)
        p.goto(f"{app_url}/catalogue/{NO_ARTIST_ID}")
        expect(p.get_by_text("Not recorded").first).to_be_visible()


def test_wf_budget_concurrent_clears(app_url: str) -> None:
    start = budget(app_url)
    assert start["committed_cents"] == committed_in_db(start["quarter"])
    assert start["remaining_cents"] == start["budget_cents"] - start["committed_cents"]
    room = start["remaining_cents"]
    fee = room // 2 + 1
    assert 0 < fee <= FEE_MAX
    a = advance_to(app_url, "passed", fee=fee)
    b = advance_to(app_url, "passed", fee=fee)
    audits = {p["id"]: audit_count(p["id"]) for p in (a, b)}
    responses = together(*[
        (lambda piece=piece: call(app_url, "POST", f"/api/pieces/{piece['id']}/transition", tok(app_url, HALIMA),
                                  {"version": piece["version"], "action": "clear"}))
        for piece in (a, b)])
    assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
    loser_index = [r.status_code for r in responses].index(409)
    loser, winner = (a, b) if loser_index == 0 else (b, a)
    assert responses[loser_index].json()["error"]["message"] == \
        f"Clearing this piece would exceed the quarter budget by {money(2 * fee - room)}"
    assert stored(loser["id"])["state"] == "in_review" and stored(loser["id"])["version"] == loser["version"]
    assert audit_count(loser["id"]) == audits[loser["id"]]
    mid = budget(app_url)
    assert mid["committed_cents"] == start["committed_cents"] + fee == committed_in_db(mid["quarter"])
    assert mid["remaining_cents"] == room - fee
    assert winner["id"] in [row["id"] for row in mid["rows"]]
    ok(call(app_url, "PATCH", f"/api/budget/{mid['quarter']}", tok(app_url, HALIMA),
            {"piece_id": winner["id"], "delta_cents": -fee}), 200)
    end = budget(app_url)
    assert end["committed_cents"] == start["committed_cents"] == committed_in_db(end["quarter"])


def test_wf_budget_fee_adjust_and_reset(app_url: str, browser: Browser) -> None:
    piece = advance_to(app_url, "cleared")
    pid, title = piece["id"], piece["title"]
    quarter = budget(app_url)["quarter"]
    with staff(browser, app_url, HALIMA, "/budget") as p:
        field = p.get_by_role("spinbutton", name=f"Amount for {title}")
        row = p.get_by_role("row").filter(has=field)
        for name in ("x10", "x100", "x1,000", "Apply"):
            expect(row.get_by_role("button", name=name, exact=True)).to_be_visible()
        multiplied = TYPED_DOLLARS * MULTIPLIER
        new_fee = multiplied * CENTS_PER_DOLLAR
        field.fill(str(TYPED_DOLLARS))
        row.get_by_role("button", name="x10", exact=True).click()
        expect(field).to_have_value(re.compile(rf"^{multiplied}(\.0+)?$"))
        row.get_by_role("button", name="Apply").click()
        expect(desk_updates(p)).to_contain_text(f"Fee for {title} is now {money(new_fee)}")
        assert stored(pid)["fee_cents"] == new_fee
        last = pg().rows(f"SELECT reason FROM audit_entries WHERE piece_id = {pid} ORDER BY created_at DESC, id DESC LIMIT 1")
        assert last[0]["reason"] == f"Fee changed from {money(0)} to {money(new_fee)}"
        p.get_by_role("button", name="Reset quarter").click()
        dialog = p.get_by_role("alertdialog", name="Reset every fee this quarter?")
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="Cancel").click()
        assert stored(pid)["fee_cents"] == new_fee
        p.get_by_role("button", name="Reset quarter").click()
        p.get_by_role("alertdialog", name="Reset every fee this quarter?").get_by_role("button", name="Reset fees").click()
        expect(desk_updates(p)).to_contain_text("Every fee this quarter is back to its submitted value")
    assert stored(pid)["fee_cents"] == 0
    current = get_piece(app_url, HALIMA, pid)
    before, audits = stored(pid), audit_count(pid)
    refused(call(app_url, "PATCH", f"/api/budget/{quarter}", tok(app_url, ROSA), {"piece_id": pid, "delta_cents": 100}),
            403, "Your role may not do that")
    outside = create_piece(app_url, ROSA)
    refused(call(app_url, "PATCH", f"/api/budget/{quarter}", tok(app_url, HALIMA), {"piece_id": outside["id"], "delta_cents": 100}),
            400, "That piece does not count against this quarter", "piece_id")
    remaining = budget(app_url)["remaining_cents"]
    refused(call(app_url, "PATCH", f"/api/budget/{quarter}", tok(app_url, HALIMA),
                 {"piece_id": pid, "delta_cents": remaining + 1, "version": current["version"]}),
            409, f"Adjusting this fee would exceed the quarter budget by {money(1)}")
    low = call(app_url, "PATCH", f"/api/budget/{quarter}", tok(app_url, HALIMA), {"piece_id": pid, "delta_cents": -1})
    ok(low, 400)
    assert low.json()["error"]["message"] == "A fee must be between $0.00 and $5,000.00"
    assert stored(pid) == before and audit_count(pid) == audits
    assert budget(app_url)["committed_cents"] <= budget(app_url)["budget_cents"]


def test_wf_schedule_wall_concurrent_booking(app_url: str) -> None:
    day = free_future_day(app_url)
    a, b = advance_to(app_url, "cleared"), advance_to(app_url, "cleared")
    audits = {p["id"]: audit_count(p["id"]) for p in (a, b)}
    responses = together(*[
        (lambda piece=piece: call(app_url, "PUT", f"/api/schedule/{day}", tok(app_url, HALIMA), {"piece_id": piece["id"]}))
        for piece in (a, b)])
    assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
    lose = [r.status_code for r in responses].index(409)
    loser, winner = (a, b) if lose == 0 else (b, a)
    assert responses[lose].json()["error"]["message"] == f"{day} already has a featured piece"
    assert responses[1 - lose].json()["day"] == day and responses[1 - lose].json()["piece_id"] == winner["id"]
    assert stored(loser["id"])["state"] == "cleared" and stored(loser["id"])["version"] == loser["version"]
    assert audit_count(loser["id"]) == audits[loser["id"]]
    assert stored(winner["id"])["state"] == "scheduled" and audit_count(winner["id"]) == audits[winner["id"]] + 1
    assert len(pg().rows(f"SELECT piece_id FROM schedule_slots WHERE day = {sql_text(day)}")) == 1
    yesterday = (server_today(app_url) - timedelta(days=1)).isoformat()
    refused(call(app_url, "PUT", f"/api/schedule/{yesterday}", tok(app_url, HALIMA), {"piece_id": loser["id"]}),
            400, "Pick today or a later date", "day")
    refused(call(app_url, "POST", f"/api/pieces/{loser['id']}/transition", tok(app_url, HALIMA),
                 {"version": loser["version"], "action": "schedule", "day": "next week"}),
            400, "Use a day written as YYYY-MM-DD", "day")
    assert stored(loser["id"])["state"] == "cleared"
    ok(call(app_url, "DELETE", f"/api/schedule/{day}", tok(app_url, HALIMA)), 204)
    assert stored(winner["id"])["state"] == "cleared"
    assert pg().rows(f"SELECT piece_id FROM schedule_slots WHERE day = {sql_text(day)}") == []
    ok(call(app_url, "DELETE", f"/api/schedule/{day}", tok(app_url, HALIMA)), 404)


def test_wf_schedule_wall_publish_journey(app_url: str, browser: Browser) -> None:
    piece = advance_to(app_url, "passed")
    pid, title = piece["id"], piece["title"]
    with staff(browser, app_url, HALIMA, f"/pieces/{pid}") as p:
        p.get_by_role("button", name="Clear for the wall").click()
        expect(desk_updates(p)).to_contain_text(f"{title} moved to cleared")
    piece = get_piece(app_url, HALIMA, pid)
    assert piece["state"] == "cleared"
    unpublished = page_get(app_url, None, f"/wall/{pid}")
    assert unpublished.status_code == 404 and not unpublished.is_redirect
    day = free_today(app_url)
    with staff(browser, app_url, HALIMA, "/schedule") as p:
        cell = p.get_by_role("button", name=f"{day}, free", exact=True).or_(
            p.get_by_role("gridcell", name=f"{day}, free", exact=True)).first
        cell.click()
        dialog = p.get_by_role("dialog", name="Book a day")
        dialog.get_by_role("button", name=title).click()
        confirm = dialog.get_by_role("button", name="Confirm")
        if confirm.is_visible():
            confirm.click()
        poll(lambda: stored(pid)["state"] == "scheduled", POLL_SECONDS, "booking stored")
    assert any(s["day"] == day and s["piece"]["id"] == pid for s in schedule_month(app_url, day[:7]))
    assert f"/wall/{pid}" not in ok(page_get(app_url, None, "/wall"), 200).text
    version, audits = stored(pid)["version"], audit_count(pid)
    with staff(browser, app_url, HALIMA, f"/pieces/{pid}") as p:
        p.get_by_role("button", name="Publish now").click()
        expect(desk_updates(p)).to_contain_text(f"{title} moved to published")
    published = get_piece(app_url, HALIMA, pid)
    assert published["state"] == "published" and published["version"] == version + 1
    assert published["published_at"] and published["published_at"].endswith("Z")
    assert audit_count(pid) == audits + 1
    last = pg().rows(f"SELECT from_state, to_state FROM audit_entries WHERE piece_id = {pid} "
                     "ORDER BY created_at DESC, id DESC LIMIT 1")[0]
    assert last == {"from_state": "scheduled", "to_state": "published"}
    sid, stitle = pid, title
    with open_app(browser, app_url + "/wall") as p:
        assert urlsplit(p.url).path == "/wall"
        cards = p.get_by_role("list", name="Published pieces").get_by_role("link")
        expect(cards.first).to_have_accessible_name(stitle)
        assert cards.first.get_attribute("href").endswith(f"/wall/{sid}")
    ok(page_get(app_url, None, f"/wall/{sid}"), 200)
    audits = audit_count(sid)
    with staff(browser, app_url, HALIMA, f"/pieces/{sid}") as p:
        p.get_by_role("button", name="Withdraw").click()
        dialog = p.get_by_role("dialog", name="Withdraw")
        dialog.get_by_role("textbox", name="Reason").fill(WITHDRAW_REASON)
        dialog.get_by_role("button", name="Confirm").click()
        expect(desk_updates(p)).to_contain_text(f"{stitle} moved to withdrawn")
    assert stored(sid)["state"] == "withdrawn"
    assert f"/wall/{sid}" not in ok(page_get(app_url, None, "/wall"), 200).text
    gone = page_get(app_url, None, f"/wall/{sid}")
    assert gone.status_code == 404 and "That page is not here" in gone.text
    assert pg().rows(f"SELECT day FROM schedule_slots WHERE piece_id = {sid}") == []
    assert audit_count(sid) == audits + 1
    last = pg().rows(f"SELECT to_state, reason FROM audit_entries WHERE piece_id = {sid} ORDER BY created_at DESC, id DESC LIMIT 1")[0]
    assert last == {"to_state": "withdrawn", "reason": WITHDRAW_REASON}


def test_plaque_visitor_count(app_url: str, browser: Browser) -> None:
    today = server_today(app_url).isoformat()
    holder = pg().rows(
        "SELECT s.piece_id, s.day::text AS day FROM schedule_slots s JOIN pieces p ON p.id = s.piece_id "
        f"WHERE p.state = 'published' ORDER BY (s.day = {sql_text(today)}::date) DESC, s.day DESC LIMIT 1")
    assert holder, "no published piece holds a booked day"
    pid, day = int(holder[0]["piece_id"]), holder[0]["day"]
    title = get_piece(app_url, HALIMA, pid)["title"]

    def visits() -> int:
        return int(pg().rows(f"SELECT view_count FROM schedule_slots WHERE piece_id = {pid}")[0]["view_count"])

    start = visits()
    with httpx.Client(timeout=HTTP_TIMEOUT) as visitor:
        ok(visitor.get(f"{app_url}/wall/{pid}"), 200)
        ok(visitor.get(f"{app_url}/wall/{pid}"), 200)
    assert visits() == start + 1
    with httpx.Client(timeout=HTTP_TIMEOUT) as visitor:
        ok(visitor.get(f"{app_url}/wall/{pid}"), 200)
    assert visits() == start + 2
    slot = [s for s in schedule_month(app_url, day[:7]) if s["day"] == day][0]
    assert slot["view_count"] == start + 2
    unbooked = published_piece(app_url)
    with httpx.Client(timeout=HTTP_TIMEOUT) as visitor:
        ok(visitor.get(f"{app_url}/wall/{unbooked['id']}"), 200)
    assert pg().rows(f"SELECT view_count FROM schedule_slots WHERE piece_id = {unbooked['id']}") == []
    if day == today:
        line = f"{start + 2} visitors opened this piece"
        with staff(browser, app_url, HALIMA, "/schedule") as p:
            panel = p.get_by_role("region", name="Today")
            expect(panel).to_contain_text(title)
            expect(panel).to_contain_text(line)


def test_plaque(app_url: str) -> None:
    objs = clean_objects(app_url, 2)
    sources = [get_object(app_url, i) for i in objs]
    piece = published_piece(app_url, objects=objs)
    markup = ok(page_get(app_url, None, f"/wall/{piece['id']}"), 200).text
    plaque = visible(markup)
    positions = []
    for o in sources:
        for value in (o["title"], o["artist"], o["license"]):
            assert value in plaque, value
        assert o["license_url"] in plaque or o["license_url"] in markup, o["license_url"]
        positions.append(plaque.index(o["title"], plaque.index("Sources")))
    cleared_line = f"Cleared {piece['cleared_at'][:10]} by Halima Osei"
    assert plaque.index("Sources") < min(positions) and max(positions) < plaque.index("Credits")
    assert plaque.index("Credits") < plaque.index("Rosa Aldridge", plaque.index("Credits")) < plaque.index(cleared_line)


def test_wf_schedule_wall_cleared_today(app_url: str) -> None:
    piece = advance_to(app_url, "passed")
    pid = piece["id"]
    count0 = cleared_today(app_url)
    piece = step(app_url, HALIMA, piece, "clear")
    assert cleared_today(app_url) == count0 + 1
    day = free_future_day(app_url)
    ok(call(app_url, "PUT", f"/api/schedule/{day}", tok(app_url, HALIMA), {"piece_id": pid}), 200)
    ok(call(app_url, "DELETE", f"/api/schedule/{day}", tok(app_url, HALIMA)), 204)
    assert stored(pid)["state"] == "cleared"
    assert cleared_today(app_url) == count0 + 1
    shown = published_piece(app_url)
    assert cleared_today(app_url) == count0 + 2
    for path in ("/wall", f"/wall/{shown['id']}"):
        html = ok(page_get(app_url, None, path), 200).text
        assert "Small exhibits, cleared for the floor" in html and "Every piece here names its sources" in html, path
    step(app_url, HALIMA, shown, "withdraw", reason=WITHDRAW_REASON)
    assert stored(shown["id"])["state"] == "withdrawn"
    assert cleared_today(app_url) == count0 + 2


def test_wf_records_audit_csv(app_url: str, browser: Browser) -> None:
    formula = "=HYPERLINK(1) needs a clearer label"
    quoted = '@note, the "colour" key is unclear'
    piece = advance_to(app_url, "in_review", title=f"+Plus lamp {uuid.uuid4().hex[:8]}")
    pid = piece["id"]
    piece = step(app_url, HALIMA, piece, "return_for_changes", reason=formula)
    step(app_url, HALIMA, piece, "reject", reason=quoted)
    hidden = advance_to(app_url, "in_review", owner=TOBIAS)
    hidden = review(app_url, PRIYA, hidden, "licence", "fail", REASON)
    step(app_url, TOBIAS, hidden, "revise")
    hid = hidden["id"]
    gregor = tok(app_url, GREGOR)
    total = audit_count(pid)
    listed = ok(call(app_url, "GET", "/api/audit", gregor, params={"piece": pid}), 200).json()
    assert listed["total"] == total and len(listed["rows"]) == min(total, listed["rows_per_page"])
    stamps = [r["created_at"] for r in listed["rows"]]
    assert stamps == sorted(stamps, reverse=True) and all(s.endswith("Z") for s in stamps)
    assert {r["reason"] for r in listed["rows"]} >= {formula, quoted}
    assert listed["rows_per_page"] == ok(call(app_url, "GET", "/api/preferences", gregor), 200).json()["rows_per_page"]
    halima = account(app_url, HALIMA)["id"]
    for params, where in (
        ({"to": "changes_requested"}, "to_state = 'changes_requested'"),
        ({"actor": halima}, f"actor_id = {sql_text(halima)}"),
    ):
        body = ok(call(app_url, "GET", "/api/audit", gregor, params={"piece": pid, **params}), 200).json()
        expected = int(pg().rows(f"SELECT count(*) AS n FROM audit_entries WHERE piece_id = {pid} AND {where}")[0]["n"])
        assert body["total"] == expected and expected > 0
    today = server_today(app_url)
    assert ok(call(app_url, "GET", "/api/audit", gregor,
                   params={"piece": pid, "from": today.isoformat(), "until": today.isoformat()}), 200).json()["total"] == total
    assert ok(call(app_url, "GET", "/api/audit", gregor,
                   params={"piece": pid, "until": (today - timedelta(days=1)).isoformat()}), 200).json()["total"] == 0
    export = ok(call(app_url, "GET", "/api/audit/export", gregor, params={"piece": pid}), 200)
    assert export.headers["content-type"].startswith("text/csv")
    disposition = export.headers["content-disposition"]
    assert "attachment" in disposition and "clearhouse-audit.csv" in disposition
    raw = export.content
    assert not raw.startswith(b"\xef\xbb\xbf") and raw.endswith(b"\r\n") and raw.count(b"\n") == raw.count(b"\r\n")
    text = raw.decode("utf-8")
    assert text.split("\r\n")[0] == CSV_HEADER
    rows = list(csv.reader(io.StringIO(text, newline="")))[1:]
    assert len(rows) == total
    assert all(r[1] == str(pid) and r[2] == "'" + piece["title"] for r in rows)
    assert ["'" + formula] == [r[7] for r in rows if r[6] == "changes_requested"]
    assert '"' + "'" + quoted.replace('"', '""') + '"' in text
    for method in ("DELETE", "PATCH", "PUT"):
        refused(call(app_url, method, "/api/audit", gregor, {"reason": "x"}), 405, "That cannot be done here")
    assert audit_count(pid) == total
    rosa = tok(app_url, ROSA)
    assert ok(call(app_url, "GET", "/api/audit", rosa, params={"piece": hid}), 200).json() | {} \
        and ok(call(app_url, "GET", "/api/audit", rosa, params={"piece": hid}), 200).json()["total"] == 0
    assert ok(call(app_url, "GET", "/api/audit", rosa, params={"piece": hid}), 200).json()["rows"] == []
    lone = ok(call(app_url, "GET", "/api/audit/export", rosa, params={"piece": hid}), 200).content.decode("utf-8")
    assert lone == CSV_HEADER + "\r\n"
    assert ok(call(app_url, "GET", "/api/audit", gregor, params={"piece": hid}), 200).json()["total"] == audit_count(hid)
    with staff(browser, app_url, ROSA, "/audit") as p:
        with p.expect_download() as download:
            p.get_by_role("link", name="Export CSV").click()
        content = Path(download.value.path()).read_bytes().decode("utf-8")
    assert content.split("\r\n")[0] == CSV_HEADER
    every = list(csv.reader(io.StringIO(content, newline="")))[1:]
    assert all(r[1] != str(hid) for r in every)
    assert any(r[1] == str(pid) for r in every)


def test_wf_records_preferences(app_url: str, browser: Browser) -> None:
    dan = account(app_url, DAN)
    got = ok(call(app_url, "GET", "/api/preferences", dan["token"]), 200).json()
    row = pg().rows(f"SELECT rows_per_page, date_display, high_contrast FROM preferences WHERE account_id = {sql_text(dan['id'])}")
    expected = row[0] if row else {"rows_per_page": 50, "date_display": "relative", "high_contrast": False}
    assert got == expected
    halima = account(app_url, HALIMA)

    def rows() -> list[dict]:
        return pg().rows(f"SELECT rows_per_page, date_display, high_contrast FROM preferences "
                         f"WHERE account_id = {sql_text(halima['id'])}")

    with staff(browser, app_url, HALIMA, "/settings") as p:
        select(p.get_by_role("combobox", name="Rows per page"), "25")
        expect(desk_updates(p)).to_contain_text("Preferences saved")
        poll(lambda: rows() and rows()[0]["rows_per_page"] == 25, POLL_SECONDS, "rows per page stored")
        p.get_by_role("radiogroup", name="Date display").get_by_role("radio", name="Absolute").check()
        poll(lambda: rows()[0]["date_display"] == "absolute", POLL_SECONDS, "date display stored")
        p.get_by_role("switch", name="High contrast").click()
        poll(lambda: rows()[0]["high_contrast"] is True, POLL_SECONDS, "high contrast stored")
    assert len(rows()) == 1
    for body, field, message in (
        ({"rows_per_page": 30}, "rows_per_page", "Rows per page must be 25, 50 or 100"),
        ({"date_display": "fuzzy"}, "date_display", "Date display must be relative or absolute"),
        ({"high_contrast": "yes"}, "high_contrast", "High contrast must be true or false"),
    ):
        refused(call(app_url, "PUT", "/api/preferences", halima["token"], body), 400, message, field)
    assert rows() == [{"rows_per_page": 25, "date_display": "absolute", "high_contrast": True}]
    fresh = ok(sign_in(app_url, HALIMA), 200).json()["access_token"]
    ok(call(app_url, "POST", "/api/auth/logout", fresh), 204)
    again = ok(sign_in(app_url, HALIMA), 200).json()["access_token"]
    assert ok(call(app_url, "GET", "/api/preferences", again), 200).json() == \
        {"rows_per_page": 25, "date_display": "absolute", "high_contrast": True}
    ok(call(app_url, "PUT", "/api/preferences", again,
            {"rows_per_page": 50, "date_display": "relative", "high_contrast": False}), 200)
    assert len(rows()) == 1


def test_wf_records_pack(app_url: str) -> None:
    halima = tok(app_url, HALIMA)
    mine = create_piece(app_url, ROSA, objects=clean_objects(app_url, 2))
    first = ok(call(app_url, "GET", "/api/pack", halima), 200).json()
    second = ok(call(app_url, "GET", "/api/pack", halima), 200).json()
    meta = first["meta"]
    assert meta["saveVersion"] == "1" and meta["author"] == "Halima Osei"
    assert meta["created"] == meta["updated"] and isinstance(meta["created"], int)
    assert meta["uuid"] != second["meta"]["uuid"]
    b = budget(app_url)
    assert first["config"] == {"quarter": b["quarter"], "budget_cents": b["budget_cents"]}
    assert len(first["pieces"]) == int(pg().rows("SELECT count(*) AS n FROM pieces")[0]["n"])
    exported = [p for p in first["pieces"] if p["title"] == mine["title"]]
    assert exported == [{"title": mine["title"], "summary": SUMMARY, "fee_cents": 0, "state": "draft",
                         "object_ids": clean_objects(app_url, 2)}]
    pieces_before = int(pg().rows("SELECT count(*) AS n FROM pieces")[0]["n"])
    good_title = fresh_title("Packed")

    def refuse(doc: dict, message: str) -> None:
        refused(call(app_url, "POST", "/api/pack", halima, doc), 400, message)
        assert int(pg().rows("SELECT count(*) AS n FROM pieces")[0]["n"]) == pieces_before
        assert pg().rows(f"SELECT id FROM pieces WHERE title = {sql_text(good_title)}") == []

    name = fresh_title("Pack")
    refuse(pack_doc(app_url, name, [entry(app_url, good_title, "draft")], version="2"), "Pack version 2 is not supported")
    nameless = pack_doc(app_url, name, [entry(app_url, good_title, "draft")])
    del nameless["meta"]["name"]
    refuse(nameless, "Pack is missing meta.name")
    refuse(pack_doc(app_url, name, [entry(app_url, good_title, "draft"),
                                    entry(app_url, fresh_title("Dear"), "draft", fee=FEE_MAX + 1)]),
           "Fee out of range in piece 2")
    refuse(pack_doc(app_url, name, [entry(app_url, good_title, "flying")]), "Piece 1 has an invalid state")
    refuse(pack_doc(app_url, name, [entry(app_url, good_title, "draft", objects=[OBJECT_PROBE])]),
           f"Unknown object {OBJECT_PROBE} in piece 1")
    refuse(pack_doc(app_url, name, [entry(app_url, good_title, "draft"), entry(app_url, mine["title"], "draft")]),
           f"A piece named {mine['title']} already exists")
    refuse(pack_doc(app_url, name, [entry(app_url, good_title, "cleared", fee=b["remaining_cents"] + 1)]),
           f"Pack would exceed the quarter budget by {money(1)}")
    refused(call(app_url, "POST", "/api/pack", tok(app_url, ROSA),
                 pack_doc(app_url, name, [entry(app_url, good_title, "draft")])), 403, "Your role may not do that")
    cleared_title = fresh_title("Packed")
    objs = clean_objects(app_url, 2)
    doc = pack_doc(app_url, name, [entry(app_url, good_title, "draft", objects=objs),
                                   entry(app_url, cleared_title, "cleared", objects=objs[::-1])],
                   author=TOBIAS.upper())
    assert ok(call(app_url, "POST", "/api/pack", halima, doc), 201).json() == {"imported": 2}
    tobias = account(app_url, TOBIAS)["id"]
    for title, state, order in ((good_title, "draft", objs), (cleared_title, "cleared", objs[::-1])):
        row = pg().rows(f"SELECT id, owner_id, version, state, fee_cents, submitted_fee_cents, cleared_at, published_at "
                        f"FROM pieces WHERE title = {sql_text(title)}")[0]
        assert (str(row["owner_id"]), row["version"], row["state"]) == (tobias, 1, state)
        assert row["submitted_fee_cents"] == row["fee_cents"] == 0 and row["published_at"] is None
        assert (row["cleared_at"] is not None) == (state == "cleared")
        audit = pg().rows(f"SELECT from_state, to_state, reason, actor_id FROM audit_entries WHERE piece_id = {row['id']}")
        assert len(audit) == 1 and not audit[0]["from_state"] and audit[0]["to_state"] == state
        assert audit[0]["reason"] == f"Imported from pack {name}" and str(audit[0]["actor_id"]) == account(app_url, HALIMA)["id"]
        cited = pg().rows(f"SELECT object_id FROM piece_objects WHERE piece_id = {row['id']} ORDER BY position")
        assert [c["object_id"] for c in cited] == order
        assert int(pg().rows(f"SELECT count(*) AS n FROM reviews WHERE piece_id = {row['id']}")[0]["n"]) == 0
    orphan = fresh_title("Packed")
    ok(call(app_url, "POST", "/api/pack", halima,
            pack_doc(app_url, fresh_title("Pack"), [entry(app_url, orphan, "draft")], author="Nobody In Particular")), 201)
    owner = pg().rows(f"SELECT owner_id FROM pieces WHERE title = {sql_text(orphan)}")[0]["owner_id"]
    assert str(owner) == account(app_url, ROSA)["id"]
    after = ok(call(app_url, "GET", "/api/pack", halima), 200).json()["pieces"]
    assert [p for p in after if p["title"] == cleared_title] == [
        {"title": cleared_title, "summary": SUMMARY, "fee_cents": 0, "state": "cleared", "object_ids": objs[::-1]}]


def test_wf_records_restart(app_url: str) -> None:
    acked = advance_to(app_url, "in_review", objects=[PAIR_A])
    ok(ack(app_url, PRIYA, acked["id"], PAIR_A, PAIR_B), 201)
    reviewed = advance_to(app_url, "licence_passed")
    booked = advance_to(app_url, "cleared")
    day = free_future_day(app_url)
    ok(call(app_url, "PUT", f"/api/schedule/{day}", tok(app_url, HALIMA), {"piece_id": booked["id"]}), 200)
    quarter = budget(app_url)["quarter"]
    ok(call(app_url, "PATCH", f"/api/budget/{quarter}", tok(app_url, HALIMA), {"piece_id": booked["id"], "delta_cents": 100}), 200)
    token = tok(app_url, GREGOR)
    snapshot = pg().rows("SELECT id, state, version, fee_cents FROM pieces ORDER BY id")
    audits = int(pg().rows("SELECT count(*) AS n FROM audit_entries")[0]["n"])
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    serve_env = {k: v for k, v in os.environ.items() if "_OBSERVER_" not in k}
    proc = subprocess.Popen(as_app(manifest["serve"]), cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT,
                            env={**serve_env, "PATH": APP_PATH, "HOME": "/home/app",
                                 "APP_PUBLIC_PORT": str(port)}, start_new_session=True)
    copy = f"http://127.0.0.1:{port}"

    def healthy() -> bool:
        if proc.poll() is not None:
            log.seek(0)
            raise AssertionError(f"copy exited {proc.returncode}: {log.read()[-3000:]}")
        try:
            return call(copy, "GET", "/api/health").status_code == 200
        except httpx.TransportError:
            return False

    try:
        poll(healthy, RESTART_SECONDS, "restarted copy health")
        assert ok(call(copy, "GET", "/api/auth/me", token), 200).json()["role"] == "auditor"
        assert ok(call(copy, "GET", f"/api/pieces/{reviewed['id']}", token), 200).json()["licence_review"] == "pass"
        acks = ok(call(copy, "GET", f"/api/pieces/{acked['id']}", token), 200).json()["duplicate_acks"]
        assert len(acks) == 1
        assert any(s["day"] == day and s["piece"]["id"] == booked["id"] for s in
                   ok(call(copy, "GET", "/api/schedule", token, params={"month": day[:7]}), 200).json())
        assert ok(call(copy, "GET", f"/api/pieces/{booked['id']}", token), 200).json()["fee_cents"] == 100
        assert pg().rows("SELECT id, state, version, fee_cents FROM pieces ORDER BY id") == snapshot
        assert int(pg().rows("SELECT count(*) AS n FROM audit_entries")[0]["n"]) == audits
        assert int(pg().rows("SELECT count(*) AS n FROM accounts")[0]["n"]) == len(ACCOUNTS)
        assert int(pg().rows("SELECT count(*) AS n FROM objects")[0]["n"]) == CATALOGUE_SIZE
        for title in ("Tide Clock", "Orbit Wheel", "Water Wheel", "Glow Worms"):
            assert int(pg().rows(f"SELECT count(*) AS n FROM pieces WHERE lower(title) = lower({sql_text(title)})")[0]["n"]) == 1
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=HTTP_TIMEOUT)
        log.close()
    ok(call(app_url, "DELETE", f"/api/schedule/{day}", tok(app_url, HALIMA)), 204)


def test_wf_accessible_review_keyboard(app_url: str, browser: Browser) -> None:
    piece = advance_to(app_url, "licence_passed")
    pid, title = piece["id"], piece["title"]
    view_name = f"View {get_object(app_url, clean_objects(app_url, 2)[0])['title']}"
    with staff(browser, app_url, DAN, f"/pieces/{pid}") as p:
        axe(p)
        expect(p.get_by_text("Passed").first).to_be_visible()
        expect(p.get_by_text("Not yet").first).to_be_visible()
        names = tab_order(p, TAB_PRESSES)
        opener_name = "Record accessibility review"
        assert names.index("Sign out") < names.index(view_name) < names.index(opener_name), names
        opener = p.get_by_role("button", name=opener_name)
        box = opener.bounding_box()
        assert box["width"] >= TARGET_PX and box["height"] >= TARGET_PX
        rest, focused = state_styles(opener, "outline-style", "outline-width", "box-shadow", state="focus")
        ring = (focused["outline-style"] != "none" and float(focused["outline-width"].rstrip("px") or 0) >= FOCUS_RING_PX) \
            or (focused["box-shadow"] not in ("none", rest["box-shadow"]))
        assert ring, focused
        opener.focus()
        p.keyboard.press("Enter")
        dialog = p.get_by_role("dialog", name=opener_name)
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("radio", name="Pass")).to_be_focused()
        p.keyboard.press("ArrowDown")
        expect(dialog.get_by_role("radio", name="Fail")).to_be_checked()
        p.keyboard.press("ArrowUp")
        expect(dialog.get_by_role("radio", name="Pass")).to_be_checked()
        cycle = tab_order(p, 10)
        assert set(cycle) <= {"Pass", "Fail", "Reason", "Save review", "Cancel", "Close"}, cycle
        assert {"Reason", "Save review", "Cancel", "Close", "Pass"} <= set(cycle)
        p.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        assert get_piece(app_url, DAN, pid)["accessibility_review"] is None
        p.keyboard.press("Space")
        expect(dialog).to_be_visible()
        p.keyboard.press("Space")
        expect(dialog.get_by_role("radio", name="Pass")).to_be_checked()
        dialog.get_by_role("button", name="Save review").focus()
        p.keyboard.press("Enter")
        announcement = " ".join(("Accessibility", "review recorded as", "passed"))
        expect(desk_updates(p)).to_contain_text(announcement)
        expect(p.get_by_role("img", name="Accessibility review passed")).to_be_visible()
        expect(p.get_by_role("heading", name=title)).to_be_focused()
    assert get_piece(app_url, DAN, pid)["accessibility_review"] == "pass"
    row = pg().rows(f"SELECT reviewer_id FROM reviews WHERE piece_id = {pid} AND kind = 'accessibility'")
    assert str(row[0]["reviewer_id"]) == account(app_url, DAN)["id"]
    with staff(browser, app_url, ROSA, "/") as p:
        axe(p)
        search_queue(p, title)
        expect(p.get_by_role("button", name="Clear search")).to_be_visible()


def _stamp_motion(p: Page, stamp: Any) -> list[dict]:
    return p.evaluate(
        """(el) => window.__motion
            .filter(m => m.target === el || el.contains(m.target) || m.target === el.parentElement)
            .map(m => ({start: m.start, duration: m.duration, end: m.end}))""", stamp.element_handle())


def _card_motion(p: Page, links: list[Any]) -> list[list[dict]]:
    return p.evaluate(
        """(links) => links.map(link => window.__motion.filter(m => m.target === link || link.contains(m.target) ||
             (m.target.contains(link) && m.target.getElementsByTagName('a').length === 1))
             .map(m => ({start: m.start, duration: m.duration, end: m.end})))""",
        [link.element_handle() for link in links])


def test_wf_accessible_review_motion(app_url: str, browser: Browser) -> None:
    import_pieces(app_url, [entry(app_url, fresh_title("Card"), "published") for _ in range(3)])
    for mode in ("no-preference", "reduce"):
        piece = advance_to(app_url, "licence_passed")
        with staff(browser, app_url, DAN, f"/pieces/{piece['id']}", reduced_motion=mode) as p:
            p.context.add_init_script(RECORDER)
            p.reload()
            p.get_by_role("button", name="Record accessibility review").click()
            dialog = p.get_by_role("dialog", name="Record accessibility review")
            dialog.get_by_role("radio", name="Pass").check()
            dialog.get_by_role("button", name="Save review").click()
            stamp = p.get_by_role("img", name="Accessibility review passed")
            expect(stamp).to_be_visible()
            if mode == "no-preference":
                records = poll(lambda: _stamp_motion(p, stamp), POLL_SECONDS, "stamp animation")
                landing = max(r["end"] for r in records)
                assert STAMP_MIN_MS <= landing <= STAMP_MAX_MS, records
                p.reload()
                expect(stamp).to_be_visible()
                assert all(r["duration"] <= 1 for r in _stamp_motion(p, stamp))
            else:
                assert all(r["duration"] <= 1 for r in _stamp_motion(p, stamp))
        with open_app(browser, app_url + "/login", reduced_motion=mode) as p:
            p.add_init_script(RECORDER)
            p.goto(app_url + "/wall")
            links = p.get_by_role("list", name="Published pieces").get_by_role("link").all()
            assert len(links) >= 3
            for link in links:
                expect(link).to_be_attached()
            if mode == "no-preference":
                count = min(len(links), CARD_STAGGER_CAP + 1)
                motion = poll(lambda: (m := _card_motion(p, links[:count])) and all(m) and m, POLL_SECONDS, "card entries")
                starts = [min(r["start"] for r in card) for card in motion]
                for card in motion:
                    assert 0 < max(r["duration"] for r in card) <= CARD_MAX_MS, card
                for i in range(1, count):
                    gap = starts[i] - starts[i - 1]
                    if i < CARD_STAGGER_CAP:
                        assert 0 < gap < CARD_STAGGER_MAX_MS, starts
                    else:
                        assert abs(gap) < 1, starts
            else:
                for link in links[:4]:
                    expect(link).to_be_visible()
                assert all(r["duration"] <= 1 for card in _card_motion(p, links) for r in card)


def test_wf_cross_cutting_responsive(app_url: str, browser: Browser) -> None:
    import_pieces(app_url, [entry(app_url, fresh_title("Wide"), "published") for _ in range(4)])
    piece = create_piece(app_url, ROSA, objects=clean_objects(app_url, 2))
    with staff(browser, app_url, ROSA, "/") as p:
        for width, height in VIEWPORTS:
            p.set_viewport_size({"width": width, "height": height})
            for path in ("/", f"/pieces/{piece['id']}", "/catalogue", "/schedule", "/budget", "/audit", "/settings"):
                p.goto(app_url + path)
                layout(p)
        p.set_viewport_size({"width": 1280, "height": 800})
        p.goto(app_url + "/")
        for name in ("Fee", "Updated"):
            expect(p.get_by_role("columnheader", name=name)).to_be_visible()
        p.set_viewport_size({"width": QUEUE_WIDE_PX + 1, "height": 800})
        expect(p.get_by_role("columnheader", name="Fee")).to_be_visible()
        p.set_viewport_size({"width": QUEUE_WIDE_PX, "height": 800})
        expect(p.get_by_role("columnheader", name="Fee")).to_be_hidden()
        p.set_viewport_size({"width": 768, "height": 1024})
        expect(p.get_by_role("columnheader", name="Updated")).to_be_hidden()
        expect(p.get_by_role("checkbox", name="Needs my decision")).to_be_visible()
        p.set_viewport_size({"width": 375, "height": 812})
        search_queue(p, piece["title"])
        expect(p.get_by_role("link", name=piece["title"], exact=True)).to_be_visible()
        expect(p.get_by_role("columnheader", name="Fee")).to_be_hidden()
        filters = p.get_by_role("button", name="Filters")
        expect(filters).to_be_visible()
        expect(p.get_by_role("checkbox", name="Needs my decision")).to_be_hidden()
        filters.click()
        expect(p.get_by_role("checkbox", name="Needs my decision")).to_be_visible()
        assert "width=device-width" in (p.evaluate("() => document.querySelector('meta[name=viewport]')?.content") or "")
    with open_app(browser, app_url + "/wall") as p:
        for width, columns in WALL_COLUMNS:
            p.set_viewport_size({"width": width, "height": 900})
            p.goto(app_url + "/wall")
            layout(p)
            cards = p.get_by_role("list", name="Published pieces").get_by_role("link").all()[:4]
            lefts = {round(card.bounding_box()["x"]) for card in cards}
            assert len(lefts) == min(columns, len(cards)), (width, lefts)


def test_wf_cross_cutting_surface_copy(app_url: str, browser: Browser) -> None:
    advance_to(app_url, "cleared")
    with open_app(browser, app_url + "/login") as p:
        expect(p.get_by_role("textbox", name="Work email")).to_be_visible()
        expect(p.get_by_label("Passphrase")).to_be_visible()
        expect(p.get_by_role("button", name="Sign in")).to_be_visible()
        p.goto(app_url + "/wall")
        expect(p.get_by_text("Small exhibits, cleared for the floor")).to_be_visible()
        expect(p.get_by_text("Every piece here names its sources")).to_be_visible()
        expect(p.get_by_text(re.compile(r"^(\d+ pieces|1 piece) cleared today$"))).to_be_visible()
        p.goto(app_url + f"/nowhere-{uuid.uuid4().hex[:6]}")
        expect(p.get_by_role("heading", name="That page is not here")).to_be_visible()
        expect(p.get_by_text("It may have been withdrawn, or the address may be wrong.")).to_be_visible()
        expect(p.get_by_role("link", name="Back to the wall")).to_be_visible()
    assert call(app_url, "GET", f"/nowhere-{uuid.uuid4().hex[:6]}").status_code == 404
    with staff(browser, app_url, ROSA, "/") as p:
        expect(p.get_by_role("link", name="Clearhouse")).to_have_attribute("href", "/")
        expect(p.get_by_text("Fenwick Science Centre")).to_be_visible()
        for name in ("Queue", "Catalogue", "Schedule", "Budget", "Audit"):
            expect(p.get_by_role("link", name=name, exact=True)).to_be_visible()
        expect(p.get_by_role("link", name="Queue", exact=True)).to_have_attribute("aria-current", "page")
        expect(p.get_by_role("button", name="Sign out")).to_be_visible()
        expect(p.get_by_text("Rosa Aldridge").first).to_be_visible()
        expect(p.get_by_role("searchbox", name="Search pieces")).to_have_attribute("placeholder", "Title or maker")
        sort = p.get_by_role("combobox", name="Sort by")
        for option in ("Newest first", "Oldest first", "Title A to Z", "Fee high to low"):
            expect(sort.get_by_role("option", name=option, include_hidden=True)).to_have_count(1)
        for name in ("Only mine", "Needs my decision"):
            expect(p.get_by_role("checkbox", name=name)).to_be_visible()
        expect(p.get_by_role("button", name="Clear filters")).to_be_visible()
        expect(p.get_by_text(re.compile(r"^\d+ of \d+ pieces$"))).to_be_visible()
        for state in STATES:
            expect(p.get_by_text(state, exact=True).first).to_be_attached()
        p.goto(app_url + "/catalogue")
        expect(p.get_by_role("searchbox", name="Search objects")).to_be_visible()
        expect(p.get_by_role("button", name="Shuffle")).to_be_visible()
        licence = p.get_by_role("combobox", name="Licence")
        for option in ("All licences", *ALLOWED_LICENCES):
            expect(licence.get_by_role("option", name=option, exact=True, include_hidden=True)).to_have_count(1)
        expect(p.get_by_text(re.compile(r"^[\d,]+ objects in the catalogue$"))).to_be_visible()
        expect(p.get_by_text(re.compile(r"^Showing \d+ to \d+ of [\d,]+$"))).to_be_visible()
        expect(p.get_by_role("button", name="Previous", exact=True)).to_be_visible()
        expect(p.get_by_role("button", name="Next", exact=True)).to_be_visible()
        p.goto(app_url + "/schedule")
        for name in ("Previous month", "Next month"):
            expect(p.get_by_role("button", name=name)).to_be_visible()
        expect(p.get_by_role("grid", name=re.compile(r"^[A-Z][a-z]+ \d{4}$"))).to_be_visible()
        expect(p.get_by_role("region", name="Today")).to_be_visible()
        p.goto(app_url + "/audit")
        for label in ("Piece", "Actor", "To state", "From date", "Until date"):
            expect(p.get_by_label(label, exact=True)).to_be_visible()
        expect(p.get_by_role("link", name="Export CSV")).to_be_visible()
        for column in ("When", "Piece", "Actor", "From", "To", "Reason"):
            expect(p.get_by_role("columnheader", name=column, exact=True)).to_be_visible()
    with staff(browser, app_url, HALIMA, "/budget") as p:
        expect(p.get_by_role("heading", name=re.compile(r"^\d{4} Q[1-4]$"))).to_be_visible()
        for figure in ("Budget", "Committed", "Remaining"):
            expect(p.get_by_text(figure, exact=True).first).to_be_visible()
        expect(p.get_by_role("spinbutton", name=re.compile(r"^Amount for ")).first).to_be_visible()
        expect(p.get_by_role("button", name="Reset quarter")).to_be_visible()
        p.goto(app_url + "/settings")
        rows = p.get_by_role("combobox", name="Rows per page")
        for option in ("25", "50", "100"):
            expect(rows.get_by_role("option", name=option, exact=True, include_hidden=True)).to_have_count(1)
        group = p.get_by_role("radiogroup", name="Date display")
        for name in ("Relative", "Absolute"):
            expect(group.get_by_role("radio", name=name)).to_be_visible()
        expect(p.get_by_role("switch", name="High contrast")).to_be_visible()
        expect(p.get_by_role("button", name="Export pack")).to_be_visible()
        expect(p.get_by_label("Import pack")).to_be_attached()


def test_wf_cross_cutting_empty_and_loading(app_url: str, browser: Browser) -> None:
    nothing = f"zqx{uuid.uuid4().hex[:10]}"
    piece = create_piece(app_url, ROSA)
    with staff(browser, app_url, ROSA, "/") as p:
        search_queue(p, nothing)
        expect(p.get_by_text("No pieces match that search")).to_be_visible()
        pending: list[Any] = []
        p.route("**/*", lambda route: pending.append(route) if route.request.resource_type in ("fetch", "xhr")
                else route.continue_())
        search_queue(p, piece["title"])
        poll(lambda: (p.evaluate("() => 1"), bool(pending))[1], POLL_SECONDS, "held queue request")
        assert p.evaluate(BUSY)
        p.unroute("**/*")
        for route in pending:
            route.continue_()
        expect(p.get_by_role("link", name=piece["title"], exact=True)).to_be_visible()
        poll(lambda: not p.evaluate(BUSY), POLL_SECONDS, "list no longer busy")
        p.goto(app_url + "/catalogue")
        box = p.get_by_role("searchbox", name="Search objects")
        box.fill(nothing)
        box.press("Enter")
        advance(p, ADVANCE_MS)
        expect(p.get_by_text("No objects match that search")).to_be_visible()
        expect(box).to_have_value(nothing)


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _shipped() -> set[str]:
    uv, poetry = APP_DIR / "uv.lock", APP_DIR / "poetry.lock"
    if uv.exists():
        packages = tomllib.loads(uv.read_text())["package"]
        by_name = {_norm(p["name"]): p for p in packages}
        root = next(p for p in packages if "virtual" in p.get("source", {}) or "editable" in p.get("source", {}))
        todo, seen = [_norm(d["name"]) for d in root.get("dependencies", [])], set()
        while todo:
            name = todo.pop()
            if name in seen or name not in by_name:
                continue
            seen.add(name)
            todo += [_norm(d["name"]) for d in by_name[name].get("dependencies", [])]
        return seen
    if poetry.exists():
        packages = tomllib.loads(poetry.read_text())["package"]
        return {_norm(p["name"]) for p in packages
                if p.get("category", "main") == "main" and "main" in p.get("groups", ["main"])}
    names = set()
    for line in (APP_DIR / "requirements.txt").read_text().splitlines():
        line = line.split("#")[0].strip()
        if line and not line.startswith("-"):
            names.add(_norm(re.split(r"[\s\[=<>!~;@]", line, maxsplit=1)[0]))
    return names


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert isinstance(manifest["install"], str) and isinstance(manifest["build"], str)
    serve = manifest["serve"]
    assert isinstance(serve, str) and serve.strip()
    assert "nohup" not in serve and not serve.rstrip().endswith("&")


def test_if_user_readme() -> None:
    text = (APP_DIR / "USER_README.md").read_text()
    assert PASSPHRASE in text
    flat = re.sub(r"[-_\s]+", " ", text).lower()
    for email, (_, role) in ACCOUNTS.items():
        stem = re.sub(r"[-_\s]+", " ", role).split()[0][:5].lower()
        assert email in text and stem in flat, email


def test_if_artifact_dirs() -> None:
    for name in (".browser_screenshots", ".downloads"):
        folder = APP_DIR / name
        assert folder.is_dir() and not any(folder.iterdir()), name


def test_if_third_party_notices() -> None:
    notices = _norm((APP_DIR / "THIRD_PARTY_NOTICES.md").read_text())
    shipped = _shipped()
    assert shipped
    missing = [name for name in shipped if name not in notices]
    assert not missing, missing


def test_if_licence_allowlist() -> None:
    allow = ("MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "PSF-2.0", "MPL-2.0", "LGPL-3.0-or-later")
    lines = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text().splitlines()
    bad = []
    for name in _shipped():
        hits = [i for i, line in enumerate(lines) if name in _norm(line)]
        spans = []
        for i in hits:
            head = next((j for j in range(i, -1, -1) if lines[j].lstrip().startswith("#")), i)
            spans.append(" ".join(lines[head:i + 5]))
        window = " ".join(spans)
        families = {re.split(r"[-.\d]", licence)[0].lower() for licence in allow}
        if not any(re.search(rf"\b{family}\b", window, re.I) for family in families):
            bad.append(name)
    assert not bad, bad


def test_if_no_other_datastore() -> None:
    others = {"redis", "pymongo", "motor", "mysqlclient", "pymysql", "mysql-connector-python", "aiomysql",
              "aiosqlite", "pysqlite3", "tinydb", "cassandra-driver", "elasticsearch", "couchdb", "pymemcache",
              "python-memcached", "duckdb", "leveldb", "plyvel", "lmdb"}
    assert not (_shipped() & others)
    found = []
    for root in {APP_DIR, Path(DEPLOYED_APP)}:
        for path in root.rglob("*"):
            if path.suffix in (".db", ".sqlite", ".sqlite3") and "site-packages" not in path.parts:
                found.append(str(path))
    assert not found, found


def test_if_service_config_untouched() -> None:
    emails = {(u.get("email") or "").lower() for u in Keycloak().users()}
    assert emails <= set(ACCOUNTS), emails - set(ACCOUNTS)
