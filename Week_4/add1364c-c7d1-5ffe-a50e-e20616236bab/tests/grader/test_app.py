from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from datetime import time as dtime
from pathlib import Path
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    Keycloak,
    Postgres,
    animations,
    axe,
    center,
    check,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    same_origin,
    select,
    session,
    shipped_packages,
    tab_order,
)


COOKIE = "lockset_session"
SEED_PASSWORD = "KeysKept-2026"
JOINER_PASSWORD = "Joiner-pass-2026"
OFFICE_KEY = os.environ.get("OFFICE_KEY", "bl")
OFFICE_TZ = ZoneInfo("America/Chicago")
OFFICE_TZ_NAME = "America/Chicago"
HTTP_TIMEOUT_S = 30
POLL_S = 0.5
SEAT_WAIT_S = 40
SHORT_SESSION_S = 40
SHORT_LOCK_S = 30
PUSH_MS = 5000
SLACK_MS = 3000
LIVE_WINDOW_S = 1200
RULER_NIGHTS = 60
MIN_TARGET_PX = 44
LEEWAY_DAYS = 14
NEW_VAULT_MIN = 12
AUDIT_LIMIT_MAX = 100
AUDIT_PAGE = 50
AUDIT_MAX_PAGES = 40
IMPORT_MAX_ROWS = 2000
BODY_LIMIT = 16384
IMPORT_BODY_LIMIT = 1000000
SPRING_INTERVAL = 90
FALL_INTERVAL = 28
SCOPE_LOSS_BUSINESS_DAYS = 2
OVERDUE_BUSINESS_DAY = 11
SEED_LAST_TURNED_DAYS = 40
SEED_OVERDUE_DUE_DAYS = 7
HIDE_MS = 30000
GAP_MS = 10000
GEOMETRY_TOLERANCE_PX = 4
SEAT_PLAN = "lockset-seat-annual"
SEAT_PRICE = "48.00"
AUDIT_FLIPS = 30
TYPED_A = "half-typed"
TYPED_B = "typed-text"
TYPED_C = "typing-in-progress"
ROW_LAST = "Last row"
MULTI = "multi\r\nline"
SINGLE_NAME = "Cher"
PROBE_DAY = "2026-01-01"
OLD_DAY = "2020-01-01"
SHIFT_TIME = "10:15"
EVIL_HOST = "evil.example"
SLASHES = "/" + "/" + EVIL_HOST
MISSING_PEOPLE = "/api/people/missing-"
MISSING_RULES = "/api/rules/missing-"
UNKNOWN_API = "/api/no-such-endpoint"
BRUTE_KEY = "bruteForceProtected"
DEVICE_SKEW = datetime(2031, 6, 15, 12, 0, tzinfo=timezone.utc)
JSON_TYPE = "application/json; charset=utf-8"
PRINTER = "Front desk printer admin"
VIEWPORTS = {"375": (375, 812), "768": (768, 1024), "1280": (1280, 800)}
VIEWPORT_IDS = ["375", "768", "1280"]

BAD_CREDS = "That username and password don't match."
ACCOUNT_OFF = "This sign-in is switched off. Ask the office manager."
LOCKED_RE = re.compile(r"^Too many tries\. Sign-in for this username reopens at \w{3} \d{1,2} \w{3}, \d{2}:\d{2} C[SD]T\.$")
LEEWAY_COPY = "This login is past its 14-day leeway. Turn it before revealing."
RULE_CHANGED = "This rule changed since you opened it. Reload it and try again."
RULE_DRAFT_SAVED = "Rule saved as a draft."
PICK_LATER = "Pick a date after today."
LINE_DECIDED = "This line is already decided."
DECIDE_ALL = "Decide every line before signing off."
BILLING_DOWN = "Billing can't be reached. Seat changes wait here and are not counted until billing confirms them."
FEED_DOWN_LAST = "The breach feed can't be reached. Showing the last good check from {}."
FEED_DOWN_NONE = "The breach feed can't be reached. No check has succeeded yet."
CHOICE_SAVED = "Choice saved."
CHECK_FIELDS = "Check the highlighted fields."
NOT_FOUND_HEADING = "Nothing in this drawer"
EMPTY_VAULT = "Nothing filed here yet."
ACCESS_CHANGED = "Your access changed. Some vaults are no longer shown."
NO_FIELD = "Lockset does not accept this field."
MSG_UNREADABLE = "The file could not be read."
MSG_NOT_UTF8 = "Save the spreadsheet as UTF-8 CSV and try again."
MSG_HEADER = "The first row must be the Lockset column headings."
MSG_TOO_MANY = "Import at most 2,000 rows at a time."
MSG_FILENAME = "Give the file a name of 1 to 120 characters."
IMPORT_HEADER = "Vault,Login for,Website,Username,Password,Who knows it,Last changed"
LEGACY_PATH = "D:\\Office\\marta\\Desktop\\Passwords FINAL v3.csv"
LEGACY_NAME = "Passwords FINAL v3.csv"
REASONS = ["Unknown vault", "Wrong number of columns", "Password must be 1 to 128 characters",
           "Login for must be 1 to 60 characters", "Website must be a domain or URL",
           "Username must be 1 to 120 characters", "Last changed must be M/D/YYYY"]
PADDING_ROW = {"suffix": "0" * 35, "count": 0}
BREACHED_BASELINE = {"domain": "gridhaven.example", "title": "Gridhaven Hosting control panel",
                     "breached_on": "2026-08-19", "data_classes": ["Email addresses", "Passwords"]}


def tok() -> str:
    return os.urandom(4).hex()


def sid(value: Any) -> str | None:
    return None if value is None else str(value)


def parse_utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def env_url(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        pytest.fail(f"{name} is not set; the verifier needs that outage instance")
    return value.rstrip("/")


def wait_until(fn: Callable[[], Any], seconds: float, message: str) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        threading.Event().wait(POLL_S)
    pytest.fail(message)


class Api:
    def __init__(self, base: str, handle: str | None = None, password: str = SEED_PASSWORD) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)
        self.person: dict[str, Any] | None = None
        self.login: dict[str, Any] | None = None
        if handle:
            r = self.http.post("/api/sessions", json={"username": handle, "password": password})
            assert r.status_code == 201, f"sign-in for {handle} answered {r.status_code}: {r.text[:200]}"
            self.login = r.json()
            self.person = self.login["person"]

    def request(self, method: str, path: str, body: Any = None, key: str | None = None,
                headers: dict[str, str] | None = None, params: dict[str, Any] | None = None) -> httpx.Response:
        h = dict(headers or {})
        if key:
            h["Idempotency-Key"] = key
        kw: dict[str, Any] = {"headers": h, "params": params}
        if body is not None:
            kw["json"] = body
        return self.http.request(method, path, **kw)

    def get(self, path: str, **params: Any) -> httpx.Response:
        return self.request("GET", path, params=params)

    def post(self, path: str, body: Any = None, key: str | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
        return self.request("POST", path, {} if body is None else body, key, headers)

    def put(self, path: str, body: Any, key: str | None = None) -> httpx.Response:
        return self.request("PUT", path, body, key)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.request("PATCH", path, body)

    def delete(self, path: str) -> httpx.Response:
        return self.request("DELETE", path)


def ok(resp: httpx.Response, status: int) -> httpx.Response:
    assert resp.status_code == status, f"expected {status}, got {resp.status_code}: {resp.text[:300]}"
    return resp


def refused(resp: httpx.Response, status: int, code: str, message: str | None = None) -> dict[str, Any]:
    assert resp.status_code == status, f"expected {status} {code}, got {resp.status_code}: {resp.text[:300]}"
    err = resp.json()["error"]
    assert err["code"] == code, err
    if message is not None:
        assert err["message"] == message, err
    return err


def invalid_on(resp: httpx.Response, field: str, message: str | None = None) -> dict[str, str]:
    assert resp.status_code == 422, f"expected 422 on {field}, got {resp.status_code}: {resp.text[:300]}"
    body = resp.json()
    assert body["error"]["code"] == "invalid", body
    assert field in body["fields"], body
    if message is not None:
        assert body["fields"][field] == message, body
    return body["fields"]


def clock(base: str) -> dict[str, Any]:
    return ok(httpx.get(base + "/api/clock", timeout=HTTP_TIMEOUT_S), 200).json()


def server_now(base: str) -> datetime:
    return parse_utc(clock(base)["now"])


def office_today(base: str) -> date:
    return date.fromisoformat(clock(base)["office_date"])


def midnight(d: date) -> datetime:
    return datetime.combine(d, dtime(0, 0), tzinfo=OFFICE_TZ)


def offset_at(d: date) -> str:
    return midnight(d).tzname() or ""


def office_date_text(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b}"


def office_stamp(moment: datetime) -> str:
    local = moment.astimezone(OFFICE_TZ)
    return f"{office_date_text(local.date())}, {local:%H:%M} {local.tzname()}"


def takes_force(eff: date) -> str:
    return f"Takes force 00:00 {offset_at(eff)}, {office_date_text(eff)}"


def in_force_from(eff: date) -> str:
    return f"In force from 00:00 {offset_at(eff)}, {office_date_text(eff)}"


def draft_stub(n: int, eff: date) -> str:
    return (f"Draft, waiting for the managing partner's signature: at least {n} characters "
            f"from 00:00 {offset_at(eff)}, {office_date_text(eff)}")


def ruler_text(d: date) -> str:
    return f"{office_date_text(d)} {d.year}, 00:00 {offset_at(d)}"


def business_after(d: date, n: int) -> date:
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def next_19(moment: datetime) -> datetime:
    local = moment.astimezone(OFFICE_TZ)
    cand = datetime.combine(local.date(), dtime(19, 0), tzinfo=OFFICE_TZ)
    if cand <= local:
        cand = datetime.combine(local.date() + timedelta(days=1), dtime(19, 0), tzinfo=OFFICE_TZ)
    return cand


def next_office_minute(base: str, lead_s: int) -> datetime:
    now = server_now(base).astimezone(OFFICE_TZ)
    t = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
    while (t - now).total_seconds() < lead_s:
        t += timedelta(minutes=1)
    return t


def ms_until(base: str, at: datetime) -> float:
    return (at - server_now(base)).total_seconds() * 1000


def local_minute(moment: datetime) -> str:
    return moment.astimezone(OFFICE_TZ).strftime("%Y-%m-%dT%H:%M")


def vaults(api: Api) -> list[dict[str, Any]]:
    return ok(api.get("/api/vaults"), 200).json()["vaults"]


def vault_named(api: Api, name: str) -> dict[str, Any]:
    for v in vaults(api):
        if v["name"] == name:
            return v
    pytest.fail(f"vault {name} is not listed")


def vault_detail(api: Api, vault_id: Any) -> dict[str, Any]:
    return ok(api.get(f"/api/vaults/{vault_id}"), 200).json()


def seeded_login(api: Api, vault_name: str, label: str) -> dict[str, Any]:
    for c in vault_detail(api, vault_named(api, vault_name)["id"])["credentials"]:
        if c["label"] == label:
            return c
    pytest.fail(f"login {label} is not in {vault_name}")


def people(api: Api) -> list[dict[str, Any]]:
    return ok(api.get("/api/people"), 200).json()["people"]


def person(api: Api, person_id: Any) -> dict[str, Any]:
    for p in people(api):
        if sid(p["id"]) == sid(person_id):
            return p
    pytest.fail(f"person {person_id} is not listed")


def seeded_person(api: Api, handle: str) -> dict[str, Any]:
    for p in people(api):
        if p["handle"] == handle:
            return p
    pytest.fail(f"person {handle} is not listed")


def new_vault(om: Api, off: bool = False) -> dict[str, Any]:
    return ok(om.post("/api/vaults", {"name": f"Vault {tok()}", "off_when_travelling": off}), 201).json()


def new_vendor(om: Api) -> dict[str, Any]:
    return ok(om.post("/api/vendors", {"name": f"Vendor {tok()}", "domain": f"v{tok()}.example"}), 201).json()


def new_login(om: Api, vault: dict[str, Any], vendor: dict[str, Any], secret: str | None = None,
              label: str | None = None) -> dict[str, Any]:
    secret = secret or f"Sk-{tok()}-{tok()}"
    body = {"vault_id": vault["id"], "vendor_id": vendor["id"], "label": label or f"Login {tok()}",
            "username": f"user-{tok()}", "secret": secret}
    c = ok(om.post("/api/credentials", body), 201).json()
    c["_secret"] = secret
    return c


def joiner_body(handle: str, full_name: str, email: str | None = None, role: str = "staff_accountant",
                vault_ids: list[Any] | None = None, aliases: list[str] | None = None,
                password: str | None = None, term: dict[str, str] | None = None) -> dict[str, Any]:
    return {"full_name": full_name, "email": email or f"{handle}@brannocklyle.example", "handle": handle,
            "role": role, "aliases": aliases or [], "vault_ids": vault_ids or [],
            "initial_password": password or JOINER_PASSWORD, "term": term}


def joiner(om: Api, role: str = "staff_accountant", vault_ids: list[Any] | None = None,
           term: dict[str, str] | None = None) -> tuple[dict[str, Any], str, str]:
    h = f"j{tok()}"
    body = joiner_body(h, f"Joiner {tok()}", role=role, vault_ids=vault_ids, term=term)
    return ok(om.post("/api/people", body, key=idempotency_key()), 201).json(), h, JOINER_PASSWORD


def leave(om: Api, person_id: Any, key: str | None = None) -> httpx.Response:
    return om.post(f"/api/people/{person_id}/leave", {"confirm": True}, key=key)


def kc_users(handle: str, key: str = OFFICE_KEY) -> list[dict[str, Any]]:
    username = f"{key}.{handle}"
    return [u for u in Keycloak().users(search=username) if u.get("username") == username]


def seat_subs(killbill: Any, key: str, handle: str | None = None) -> list[dict[str, Any]]:
    acct = killbill.account_by_key(key)
    if not acct:
        return []
    subs = killbill.subscriptions(acct["accountId"])
    if handle:
        subs = [s for s in subs if f"{key}-seat-{handle}" in json.dumps(s)]
    return subs


def draft_rule(api: Api, vault_id: Any, min_length: int, eff: date) -> dict[str, Any]:
    return ok(api.post("/api/rules", {"vault_id": vault_id, "min_length": min_length, "effective_on": eff.isoformat()}), 201).json()


def schedule_rule(om: Api, mp: Api, vault_id: Any, min_length: int, eff: date) -> dict[str, Any]:
    d = draft_rule(om, vault_id, min_length, eff)
    return ok(mp.post(f"/api/rules/{d['id']}/sign", {"version": d["version"]}), 200).json()


def as_of(api: Api, night: date) -> dict[str, Any]:
    return ok(api.get("/api/as-of", night=night.isoformat()), 200).json()


def as_of_vault(body: dict[str, Any], vault_id: Any) -> dict[str, Any]:
    for v in body["vaults"]:
        if sid(v["vault_id"]) == sid(vault_id):
            return v
    pytest.fail("vault missing from the as-of answer")


def audit(api: Api, day: Any, order: str = "oldest", limit: int = AUDIT_LIMIT_MAX, max_pages: int = AUDIT_MAX_PAGES) -> list[dict[str, Any]]:
    day = day.isoformat() if isinstance(day, date) else day
    out: list[dict[str, Any]] = []
    after = None
    for _ in range(max_pages):
        params: dict[str, Any] = {"day": day, "order": order, "limit": limit}
        if after:
            params["after"] = after
        body = ok(api.get("/api/audit", **params), 200).json()
        out += body["entries"]
        after = body["next_cursor"]
        if not after:
            return out
    return out


def audit_about(api: Api, subject_id: Any, day: Any = None, full: bool = False) -> list[dict[str, Any]]:
    full = full or day is not None
    day = day or office_today(api.base)
    day = day.isoformat() if isinstance(day, date) else day
    found: list[dict[str, Any]] = []
    after = None
    for _ in range(AUDIT_MAX_PAGES):
        params: dict[str, Any] = {"day": day, "order": "newest", "limit": AUDIT_LIMIT_MAX}
        if after:
            params["after"] = after
        body = ok(api.get("/api/audit", **params), 200).json()
        hits = [e for e in body["entries"] if sid(e["subject"].get("id")) == sid(subject_id)]
        found += hits
        after = body["next_cursor"]
        if not after or (found and not hits and not full):
            break
    return sorted(found, key=lambda e: e["seq"])


def calendar_entries(api: Api, month: str) -> list[dict[str, Any]]:
    out = []
    for d in ok(api.get("/api/rotations/calendar", month=month), 200).json()["days"]:
        for e in d["entries"]:
            out.append(dict(e, _day=d["office_date"]))
    return out


def current_review(api: Api) -> dict[str, Any]:
    reviews = ok(api.get("/api/reviews"), 200).json()["reviews"]
    return ok(api.get(f"/api/reviews/{reviews[0]['id']}"), 200).json()


def review_at_least(api: Api, decided: int) -> dict[str, Any]:
    def committed() -> dict[str, Any] | None:
        review = current_review(api)
        return review if review["decided"] >= decided else None

    return wait_until(committed, (PUSH_MS + SLACK_MS) / 1000,
                      f"the review never reached {decided} decided lines")


def lines_for(review: dict[str, Any], person_id: Any) -> list[dict[str, Any]]:
    return [ln for ln in review["lines"] if sid(ln["person_id"]) == sid(person_id)]


def csv_bytes(rows: list[str], bom: bool = True, crlf: bool = True) -> bytes:
    eol = "\r\n" if crlf else "\n"
    text = eol.join([IMPORT_HEADER, *rows]) + eol
    return (b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8")


def import_file(om: Api, data: bytes, filename: str = LEGACY_NAME, key: str | None = None) -> httpx.Response:
    return om.post("/api/imports", {"filename": filename, "file_base64": base64.b64encode(data).decode()}, key=key)


def pg_hits(marker: str) -> int:
    pg = Postgres()
    total = 0
    for t in pg.tables():
        name = t if "." in t else f'"{t}"'
        rows = pg.rows(f"select count(*) as c from {name} x where x::text like '%{marker}%'")
        total += int(rows[0]["c"])
    return total


def header_value(entry: dict[str, Any], name: str) -> str | None:
    headers = (entry.get("request") or entry).get("headers") or {}
    for k, v in headers.items():
        if k.lower() == name.lower():
            return str(v[0] if isinstance(v, list) else v).lower()
    return None


@contextmanager
def desk_page(browser: Browser, api: Api, path: str, size: str = "1280", reduced: bool = False,
              skew: datetime | None = None) -> Iterator[Page]:
    w, h = VIEWPORTS[size]
    ctx = browser.new_context(viewport={"width": w, "height": h}, has_touch=size != "1280",
                              reduced_motion="reduce" if reduced else "no-preference")
    try:
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=api.base)
        value = api.http.cookies.get(COOKIE)
        if value:
            ctx.add_cookies([{"name": COOKIE, "value": value, "url": api.base}])
        page = ctx.new_page()
        if skew:
            page.clock.install(time=skew)
        else:
            page.clock.install()
        page.goto(api.base + path)
        yield page
    finally:
        ctx.close()


def status(page: Page) -> Any:
    return page.get_by_role("status", name="Desk status")


def alert(page: Page) -> Any:
    return page.get_by_role("alert", name="Desk alert")


class Hold:
    def __init__(self, page: Page, needle: str) -> None:
        self.page = page
        self.pending: list[Any] = []
        self.match = lambda url: needle in url
        page.route(self.match, self._grab)

    def _grab(self, route: Any) -> None:
        self.pending.append(route)

    def release(self) -> None:
        self.page.unroute(self.match, self._grab)
        for route in self.pending:
            try:
                route.continue_()
            except Exception:
                pass
        self.pending = []


def slider_value(slider: Any) -> str | None:
    return slider.evaluate("e => e.getAttribute('aria-valuenow') ?? e.value")


def slider_text(slider: Any) -> str | None:
    return slider.evaluate("e => e.getAttribute('aria-valuetext')")


def focused_text(page: Page) -> str:
    return page.evaluate("(() => { const e = document.activeElement; if (!e) return '';"
                         " return (e.getAttribute('aria-label') || e.textContent || '').replace(/\\s+/g, ' ').trim(); })()")


def test_sign_in(app_url: str) -> None:
    om = Api(app_url, "marta")
    anon = Api(app_url)
    r = ok(anon.post("/api/sessions", {"username": "deandra", "password": SEED_PASSWORD}), 201)
    body = r.json()
    assert body["person"]["handle"] == "deandra" and body["person"]["role"] == "staff_accountant"
    assert body["landing"] == f"/desk/vaults/{vaults(Api(app_url, 'deandra'))[0]['id']}"
    assert parse_utc(body["session_ends_at"]) > server_now(app_url)
    cookie = r.headers.get("set-cookie", "").lower()
    assert COOKIE in cookie and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie
    assert ok(anon.get("/api/me"), 200).json()["person"]["handle"] == "deandra"
    ok(anon.delete("/api/sessions"), 204)
    refused(anon.get("/api/me"), 401, "signed_out")
    refused(Api(app_url).post("/api/sessions", {"username": "deandra", "password": "wrong-" + tok()}), 401, "bad_credentials", BAD_CREDS)
    refused(Api(app_url).post("/api/sessions", {"username": "ghost" + tok(), "password": SEED_PASSWORD}), 401, "bad_credentials", BAD_CREDS)
    p, h, pw = joiner(om)
    assert p["status"] == "invited"
    Api(app_url, h, pw)
    assert person(om, p["id"])["status"] == "active"
    ok(leave(om, p["id"]), 200)
    refused(Api(app_url).post("/api/sessions", {"username": h, "password": pw}), 401, "account_disabled", ACCOUNT_OFF)


@pytest.mark.timeout(300)
def test_sign_in_lockout() -> None:
    base = env_url("APP_SHORT_URL")
    anon = Api(base)

    def fail(handle: str, n: int) -> list[httpx.Response]:
        return [anon.post("/api/sessions", {"username": handle, "password": "wrong-" + tok()}) for _ in range(n)]

    for r in fail("desmond", 4):
        refused(r, 401, "bad_credentials", BAD_CREDS)
    ok(anon.post("/api/sessions", {"username": "desmond", "password": SEED_PASSWORD}), 201)
    for r in fail("desmond", 4):
        refused(r, 401, "bad_credentials", BAD_CREDS)
    ghost = f"ghost{tok()}"
    answers: dict[str, httpx.Response] = {}
    for handle in ("samantha", ghost):
        for r in fail(handle, 5):
            refused(r, 401, "bad_credentials", BAD_CREDS)
        right = SEED_PASSWORD if handle == "samantha" else "anything-" + tok()
        locked = anon.post("/api/sessions", {"username": handle, "password": right})
        err = refused(locked, 429, "sign_in_locked")
        assert LOCKED_RE.match(err["message"]), err
        assert 1 <= int(locked.headers["Retry-After"]) <= SHORT_LOCK_S
        answers[handle] = locked
    a, b = answers["samantha"], answers[ghost]
    assert a.status_code == b.status_code
    assert abs(int(a.headers["Retry-After"]) - int(b.headers["Retry-After"])) <= 3
    names = lambda r: {k.lower() for k in r.headers} - {"date", "content-length"}
    assert names(a) == names(b)
    assert set(a.json()["error"]) == set(b.json()["error"])
    wait_until(lambda: anon.post("/api/sessions", {"username": "samantha", "password": SEED_PASSWORD}).status_code == 201,
               SHORT_LOCK_S + 20, "the lock never reopened")


@pytest.mark.timeout(600)
def test_session_limit(app_url: str) -> None:
    base = env_url("APP_SHORT_URL")
    started = server_now(base)
    api = Api(base, "desmond")
    ends = parse_utc(api.login["session_ends_at"])
    assert 0 < (ends - started).total_seconds() <= SHORT_SESSION_S + 5
    efin = seeded_login(api, "Vendor portals", "EFIN account")
    ok(api.post(f"/api/credentials/{efin['id']}/reveal", {}), 200)
    wait_until(lambda: api.get("/api/me").status_code == 401, SHORT_SESSION_S + 30, "the session never ended at its limit")
    for r in (api.get("/api/me"), api.get("/api/vaults"), api.post(f"/api/credentials/{efin['id']}/reveal", {})):
        refused(r, 401, "session_ended")
    ok(Api(base, "desmond").get("/api/me"), 200)
    cbase = env_url("APP_CLOSING_URL")
    closing = wait_until(lambda: PREP["closing"], PREP_SIGNIN_S + 30,
                         f"the closing-instance session was never prepared at collection: {PREP['errors']}")
    started, cutoff = closing["started"], closing["ends"]
    expected = min(started + timedelta(hours=8), next_19(started))
    assert abs((cutoff - expected).total_seconds()) <= 20
    left = max((cutoff - server_now(cbase)).total_seconds(), 0)
    if left <= LIVE_WINDOW_S:
        ended_at = wait_until(lambda: PREP["ended"][0] if PREP["ended"] else None, left + 30,
                              "no session-ended event reached the early event stream at the 19:00 cut-off")
        assert -1 <= (ended_at - cutoff).total_seconds() <= PUSH_MS / 1000 + SLACK_MS / 1000
        refused(closing["api"].get("/api/vaults"), 401, "session_ended")
    pb = Api(app_url, "deandra")
    now = server_now(app_url)
    assert abs((parse_utc(pb.login["session_ends_at"]) - min(now + timedelta(hours=8), next_19(now))).total_seconds()) <= 30


def test_reveal_copy_audited(app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    secret = f"Sk-{tok()}-{tok()}"
    c = new_login(om, v, vend, secret=secret)
    p, h, pw = joiner(om, vault_ids=[v["id"]])
    sa = Api(app_url, h, pw)
    _, oh, opw = joiner(om)
    outsider = Api(app_url, oh, opw)
    rule_id = vault_detail(om, v["id"])["vault"]["rule_in_force"]["id"]
    rv = ok(sa.post(f"/api/credentials/{c['id']}/reveal", {}), 200).json()
    cp = ok(sa.post(f"/api/credentials/{c['id']}/copy", {}), 200).json()
    for got in (rv, cp):
        assert got["secret"] == secret and sid(got["credential_id"]) == sid(c["id"]) and sid(got["rule_id"]) == sid(rule_id)
    mine = [e for e in audit_about(om, c["id"]) if e["action"] in ("reveal", "copy")]
    assert [e["action"] for e in mine] == ["reveal", "copy"]
    assert sid(mine[0]["id"]) == sid(rv["audit_id"]) and sid(mine[1]["id"]) == sid(cp["audit_id"])
    for e in mine:
        assert sid(e["actor"]["person_id"]) == sid(p["id"]) and sid(e["details"]["rule_id"]) == sid(rule_id)
    for r in (outsider.post(f"/api/credentials/{c['id']}/reveal", {}), outsider.post(f"/api/credentials/{c['id']}/copy", {})):
        refused(r, 404, "not_found")
        assert secret not in r.text
    refused(Api(app_url).post(f"/api/credentials/{c['id']}/reveal", {}), 401, "signed_out")
    assert len([e for e in audit_about(om, c["id"]) if e["action"] in ("reveal", "copy")]) == 2
    assert secret not in ok(sa.get(f"/api/credentials/{c['id']}"), 200).text


def test_leeway_refusal(app_url: str) -> None:
    printer = seeded_login(Api(app_url, "marta"), "Office", PRINTER)
    assert printer["out_of_policy"] is True
    desmond, om = Api(app_url, "desmond"), Api(app_url, "marta")
    before = len([e for e in audit_about(om, printer["id"]) if e["action"] in ("reveal", "copy")])
    for path in ("reveal", "copy"):
        r = desmond.post(f"/api/credentials/{printer['id']}/{path}", {})
        refused(r, 423, "turn_required", LEEWAY_COPY)
        assert "password" not in r.json().get("secret", "")
    refused(Api(app_url, "deandra").post(f"/api/credentials/{printer['id']}/reveal", {}), 404, "not_found")
    assert len([e for e in audit_about(om, printer["id"]) if e["action"] in ("reveal", "copy")]) == before


def test_wf_sign_in_and_reveal_road(browser: Browser, app_url: str) -> None:
    anon = Api(app_url)
    dee = Api(app_url, "deandra")
    first = vaults(dee)[0]
    om = Api(app_url, "marta")
    efin, practice = seeded_login(om, "Vendor portals", "EFIN account"), seeded_login(om, "Vendor portals", "Practice admin")
    secret_a, secret_b = "Efile-maple-2020!", "Tally-room-door-41"
    with desk_page(browser, anon, "/sign-in", size="375") as page:
        fill(page.get_by_label("Username"), "deandra")
        fill(page.get_by_label("Password"), SEED_PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        expect(page).to_have_url(f"{app_url}/desk/vaults/{first['id']}")
        click(page.get_by_role("tab", name="Vendor portals", exact=True))
        click(page.get_by_role("button", name="Reveal EFIN account"))
        expect(page.get_by_text(secret_a)).to_be_visible()
        expect(status(page)).to_have_text("EFIN account revealed.")
        page.clock.run_for(20000)
        click(page.get_by_role("button", name="Reveal Practice admin"))
        expect(page.get_by_text(secret_b)).to_be_visible()
        click(page.get_by_role("button", name="Copy Practice admin"))
        expect(status(page)).to_have_text("Practice admin copied.")
        assert page.evaluate("navigator.clipboard.readText()") == secret_b
        click(page.get_by_role("button", name=f"Turn {efin['label']}"))
        dlg = page.get_by_role("dialog", name=f"Turn {efin['label']}")
        fill(dlg.get_by_label("New password"), TYPED_C)
        page.clock.run_for(HIDE_MS - 20000 + 1000)
        expect(status(page)).to_have_text("EFIN account hidden.")
        expect(page.get_by_text(secret_a)).to_have_count(0)
        expect(dlg.get_by_label("New password")).to_have_value(TYPED_C)
        expect(page.get_by_text(secret_b)).to_be_visible()
        page.clock.run_for(HIDE_MS)
        expect(status(page)).to_have_text("Practice admin hidden.")
        expect(page.get_by_text(secret_b)).to_have_count(0)
    assert [e["action"] for e in audit_about(om, efin["id"]) if e["action"] in ("reveal", "copy")][-1:] == ["reveal"]
    assert [e["action"] for e in audit_about(om, practice["id"]) if e["action"] in ("reveal", "copy")][-2:] == ["reveal", "copy"]


def test_wf_sign_in_and_reveal_sign_in_errors(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    p, h, pw = joiner(om)
    ok(leave(om, p["id"]), 200)
    with desk_page(browser, Api(app_url), "/sign-in", size="375") as page:
        fill(page.get_by_label("Username"), "deandra")
        fill(page.get_by_label("Password"), "wrong-" + tok())
        click(page.get_by_role("button", name="Sign in"))
        expect(alert(page)).to_have_text(BAD_CREDS)
        expect(page.get_by_label("Username")).to_be_focused()
        fill(page.get_by_label("Username"), h)
        fill(page.get_by_label("Password"), pw)
        click(page.get_by_role("button", name="Sign in"))
        expect(alert(page)).to_have_text(ACCOUNT_OFF)
        expect(page.get_by_label("Username")).to_be_focused()


def test_hide_timers(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    a, b = new_login(om, v, vend), new_login(om, v, vend)
    office = vault_named(om, "Office")
    with desk_page(browser, om, f"/desk/vaults/{office['id']}") as page:
        click(page.get_by_role("button", name=f"Reveal {PRINTER}"))
        expect(alert(page)).to_have_text(LEEWAY_COPY)
        click(page.get_by_role("tab", name=v["name"], exact=True))
        click(page.get_by_role("button", name=f"Reveal {a['label']}"))
        expect(page.get_by_text(a["_secret"])).to_be_visible()
        page.clock.run_for(GAP_MS)
        click(page.get_by_role("button", name=f"Reveal {b['label']}"))
        expect(page.get_by_text(b["_secret"])).to_be_visible()
        click(page.get_by_role("button", name=f"Turn {a['label']}"))
        dlg = page.get_by_role("dialog", name=f"Turn {a['label']}")
        fill(dlg.get_by_label("New password"), TYPED_A)
        page.clock.run_for(HIDE_MS - GAP_MS + 1000)
        expect(status(page)).to_have_text(f"{a['label']} hidden.")
        expect(page.get_by_text(a["_secret"])).to_have_count(0)
        expect(dlg).to_be_visible()
        expect(dlg.get_by_label("New password")).to_have_value(TYPED_A)
        expect(page.get_by_text(b["_secret"])).to_be_visible()
        expect(alert(page)).to_have_text(LEEWAY_COPY)
        page.keyboard.press("Escape")
        page.clock.run_for(GAP_MS)
        expect(status(page)).to_have_text(f"{b['label']} hidden.")
        expect(page.get_by_text(b["_secret"])).to_have_count(0)
        click(page.get_by_role("button", name=f"Reveal {a['label']}"))
        expect(page.get_by_text(a["_secret"])).to_be_visible()
        page.clock.run_for(HIDE_MS - 1000)
        expect(page.get_by_text(a["_secret"])).to_be_visible()
        page.clock.run_for(2000)
        expect(page.get_by_text(a["_secret"])).to_have_count(0)


def test_vault_visibility(app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    a, b, vend = new_vault(om), new_vault(om), new_vendor(om)
    ca, cb = new_login(om, a, vend), new_login(om, b, vend)
    p, h, pw = joiner(om, vault_ids=[a["id"]])
    sa = Api(app_url, h, pw)
    listed = vaults(sa)
    ids = [sid(x["id"]) for x in listed]
    assert sid(a["id"]) in ids and sid(b["id"]) not in ids
    assert all(x["pending_rules"] == [] for x in listed)
    assert [sid(c["id"]) for c in vault_detail(sa, a["id"])["credentials"]] == [sid(ca["id"])]
    refused(sa.get(f"/api/vaults/{b['id']}"), 404, "not_found")
    for r in (sa.get(f"/api/credentials/{cb['id']}"), sa.post(f"/api/credentials/{cb['id']}/reveal", {}),
              sa.post(f"/api/credentials/{cb['id']}/copy", {}), sa.put(f"/api/credentials/{cb['id']}/secret", {"secret": "Zz-" + tok() + tok()}),
              sa.get(f"/api/vaults/missing-{tok()}")):
        refused(r, 404, "not_found")
    tomorrow = (office_today(app_url) + timedelta(days=1)).isoformat()
    for r in (sa.get("/api/as-of", night=tomorrow), sa.get("/api/rules"), sa.get("/api/audit"), sa.get("/api/people")):
        refused(r, 403, "forbidden")
    for who in (om, mp):
        have = {sid(x["id"]) for x in vaults(who)}
        assert {sid(a["id"]), sid(b["id"])} <= have
        assert {sid(x["vault_id"]) for x in as_of(who, office_today(app_url) + timedelta(days=1))["vaults"]} >= {sid(a["id"]), sid(b["id"])}


def test_empty_vault(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    with desk_page(browser, om, f"/desk/vaults/{v['id']}") as page:
        panel = page.get_by_role("tabpanel", name=v["name"])
        expect(panel.get_by_role("heading", level=2, name=v["name"])).to_be_visible()
        expect(panel).to_contain_text(EMPTY_VAULT)
        expect(panel.get_by_role("listitem")).to_have_count(0)
        c = new_login(om, v, vend)
        page.reload()
        expect(page.get_by_role("list", name=f"Logins in {v['name']}").get_by_role("listitem")).to_have_count(1)
        expect(page.get_by_text(c["label"])).not_to_have_count(0)
        expect(page.get_by_text(EMPTY_VAULT)).to_have_count(0)


def test_logins_stored(app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    secret = f"Plain{tok()}Sk{tok()}"
    c = new_login(om, v, vend, secret=secret)
    assert pg_hits(v["name"]) >= 1 and pg_hits(vend["domain"]) >= 1
    assert pg_hits(secret) == 0, "the secret is stored in plain text"
    assert ok(om.post(f"/api/credentials/{c['id']}/reveal", {}), 200).json()["secret"] == secret
    assert secret not in json.dumps(vault_detail(om, v["id"])) and secret not in ok(om.get(f"/api/credentials/{c['id']}"), 200).text
    dup = om.post("/api/credentials", {"vault_id": v["id"], "vendor_id": vend["id"], "label": "Again", "username": c["username"], "secret": secret})
    assert dup.status_code == 422
    invalid_on(om.post("/api/credentials", {"vault_id": v["id"], "vendor_id": vend["id"], "label": "Short", "username": "u" + tok(), "secret": "Ab-1"}), "secret")


@pytest.mark.parametrize("size", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_inert_panels(browser: Browser, app_url: str, size: str) -> None:
    om = Api(app_url, "marta")
    payroll = vault_named(om, "Payroll")
    with desk_page(browser, om, f"/desk/vaults/{payroll['id']}", size=size) as page:
        expect(page.get_by_role("tab", name="Banking", exact=True)).to_be_visible()
        expect(page.get_by_role("tabpanel")).to_have_count(1)
        expect(page.get_by_role("button", name="Reveal Payroll admin")).to_be_visible()
        for label in ("Business portal", "Operating account", "Card admin"):
            expect(page.get_by_role("button", name=f"Reveal {label}")).to_have_count(0)
        names = tab_order(page, 70)
        assert not [n for n in names if any(label in n for label in ("Business portal", "Operating account", "Card admin"))]
        if size != "375":
            expect(page.get_by_role("button", name="Menu")).to_have_count(0)
            expect(page.get_by_role("navigation", name="Desk").get_by_role("link", name="Rotations")).to_be_visible()
    if size == "375":
        with desk_page(browser, om, "/desk", size="375") as page:
            menu = page.get_by_role("button", name="Menu")
            expect(menu).to_have_attribute("aria-expanded", "false")
            expect(page.get_by_role("link", name="Rotations", exact=True)).to_have_count(0)
            assert "Rotations" not in tab_order(page, 12)
        with desk_page(browser, om, "/desk", size="375") as page:
            menu = page.get_by_role("button", name="Menu")
            click(menu)
            expect(menu).to_have_attribute("aria-expanded", "true")
            expect(page.get_by_role("link", name="Rotations", exact=True)).to_be_visible()
            page.keyboard.press("Escape")
            expect(menu).to_be_focused()
            expect(page.get_by_role("link", name="Rotations", exact=True)).to_have_count(0)


def test_landing_routes(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    other = new_vault(om)
    sa = Api(app_url, "deandra")
    first = vaults(sa)[0]
    visible = f"/desk/vaults/{first['id']}"

    def land(handle: str, nxt: str | None) -> str:
        body: dict[str, Any] = {"username": handle, "password": SEED_PASSWORD}
        if nxt is not None:
            body["next"] = nxt
        return ok(Api(app_url).post("/api/sessions", body), 201).json()["landing"]

    default = f"/desk/vaults/{first['id']}"
    assert land("deandra", None) == default
    for bad in (SLASHES, f"https://{EVIL_HOST}/desk", "/desk\\evil", "/billing", f"/desk/vaults/{other['id']}", "/nowhere"):
        assert land("deandra", bad) == default, bad
    assert land("deandra", visible) == visible and land("deandra", "/travel") == "/travel"
    assert land("marta", "/billing") == "/billing" and land("marta", f"/audit?day={PROBE_DAY}") == f"/audit?day={PROBE_DAY}"
    assert land("marta", SLASHES) == f"/desk/vaults/{vaults(om)[0]['id']}"
    with desk_page(browser, Api(app_url), "/billing") as page:
        expect(page).to_have_url(f"{app_url}/sign-in?next=%2Fbilling")


def test_published_fields(app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend)
    p, _, _ = joiner(om, vault_ids=[v["id"]])
    name = f"Vault {tok()}"
    eff = (office_today(app_url) + timedelta(days=5)).isoformat()
    cases = [
        ("POST", "/api/vaults", {"name": name, "off_when_travelling": False, "id": "x"}, "id"),
        ("POST", "/api/vaults", {"name": 12345, "off_when_travelling": False}, "name"),
        ("POST", "/api/vaults", {"name": name, "off_when_travelling": "yes"}, "off_when_travelling"),
        ("PATCH", f"/api/vaults/{v['id']}", {"status": "x"}, "status"),
        ("POST", "/api/vendors", {"name": f"Vendor {tok()}", "domain": f"x{tok()}.example", "secret": "x"}, "secret"),
        ("POST", "/api/credentials", {"vault_id": v["id"], "vendor_id": vend["id"], "label": "L", "username": "u" + tok(), "secret": "Zz-" + tok() + tok(), "held_by": []}, "held_by"),
        ("PUT", f"/api/credentials/{c['id']}/secret", {"secret": "Zz-" + tok() + tok(), "last_turned_on": OLD_DAY}, "last_turned_on"),
        ("POST", "/api/rules", {"vault_id": v["id"], "min_length": 20, "effective_on": eff, "state": "in_force"}, "state"),
        ("PATCH", f"/api/people/{p['id']}", {"seat": "released"}, "seat"),
        ("POST", "/api/people", dict(joiner_body(f"j{tok()}", "Extra Key"), status="active"), "status"),
    ]
    for method, path, body, field in cases:
        fields = invalid_on(Api.request(om, method, path, body), field)
        if field in ("id", "status", "secret", "held_by", "last_turned_on", "state", "seat"):
            assert fields[field] == NO_FIELD
    assert all(x["name"] != name for x in vaults(om))
    assert ok(om.get(f"/api/credentials/{c['id']}"), 200).json()["last_turned_on"] != OLD_DAY
    assert person(om, p["id"])["status"] != "left" and person(om, p["id"])["seat"] != "released"
    assert ok(om.get("/api/rules", vault_id=v["id"]), 200).json()["rules"][0]["state"] == "in_force"
    refused(om.patch(f"/api/people/{om.person['id']}", {"status": "left"}), 409, "own_record")


def test_wf_vault_drawer_tabs(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    vs = vaults(om)
    first, second, last = vs[0], vs[1], vs[-1]
    with desk_page(browser, om, "/desk") as page:
        tabs = page.get_by_role("tablist", name="Vaults")
        expect(tabs).to_be_visible()
        page.get_by_role("tab", name=first["name"], exact=True).focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("tab", name=second["name"], exact=True)).to_be_focused()
        assert f"/desk/vaults/{second['id']}" not in page.url
        page.keyboard.press("Enter")
        expect(page).to_have_url(f"{app_url}/desk/vaults/{second['id']}")
        expect(page.get_by_role("tabpanel", name=second["name"])).to_be_visible()
        page.keyboard.press("End")
        expect(page.get_by_role("tab", name=last["name"], exact=True)).to_be_focused()
        page.keyboard.press("Home")
        expect(page.get_by_role("tab", name=first["name"], exact=True)).to_be_focused()
        assert f"/desk/vaults/{first['id']}" not in page.url
        page.keyboard.press("Space")
        expect(page).to_have_url(f"{app_url}/desk/vaults/{first['id']}")
        click(page.get_by_role("tab", name=second["name"], exact=True))
        page.reload()
        expect(page.get_by_role("tabpanel", name=second["name"])).to_be_visible()


def test_wf_vault_drawer_filing(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    vend = new_vendor(om)
    vname, label, user, secret = f"Vault {tok()}", f"Login {tok()}", f"user-{tok()}", f"Sk-{tok()}-{tok()}"
    with desk_page(browser, om, "/desk") as page:
        click(page.get_by_role("button", name="New vault"))
        dlg = page.get_by_role("dialog", name="New vault")
        fill(dlg.get_by_label("Vault name"), vname)
        click(dlg.get_by_role("button", name="File vault"))
        expect(status(page)).to_have_text(f"{vname} filed.")
        made = vault_named(om, vname)
        expect(page).to_have_url(f"{app_url}/desk/vaults/{made['id']}")
        expect(page.get_by_role("heading", level=2, name=vname)).to_be_focused()
        expect(page.get_by_text(EMPTY_VAULT)).to_be_visible()
        click(page.get_by_role("button", name="Add login"))
        add = page.get_by_role("dialog", name="Add login")
        select(add.get_by_role("combobox", name="Vendor"), vend["name"])
        fill(add.get_by_label("Login for"), label)
        fill(add.get_by_label("Username"), user)
        fill(add.get_by_label("Password"), secret)
        click(add.get_by_role("button", name="File login"))
        expect(status(page)).to_have_text(f"{label} filed.")
        expect(page).to_have_url(f"{app_url}/desk/vaults/{made['id']}")
        expect(page.get_by_role("button", name=f"Reveal {label}")).to_be_focused()
    creds = vault_detail(om, made["id"])["credentials"]
    assert [(c["label"], c["username"]) for c in creds] == [(label, user)]
    assert ok(om.post(f"/api/credentials/{creds[0]['id']}/reveal", {}), 200).json()["secret"] == secret


def test_wf_vault_drawer_layout(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    banking = vault_named(om, "Banking")
    columns: dict[str, int] = {}
    for size in VIEWPORT_IDS:
        with desk_page(browser, om, f"/desk/vaults/{banking['id']}", size=size) as page:
            items = page.get_by_role("list", name=f"Logins in {banking['name']}").get_by_role("listitem")
            expect(items.first).to_be_visible()
            assert items.count() >= 3
            layout(page)
            assert page.get_by_role("tablist", name="Vaults").bounding_box()["y"] < page.get_by_role("tabpanel").bounding_box()["y"] + GEOMETRY_TOLERANCE_PX
            xs: list[float] = []
            for i in range(items.count()):
                x = items.nth(i).bounding_box()["x"]
                if all(abs(x - other) > GEOMETRY_TOLERANCE_PX for other in xs):
                    xs.append(x)
            columns[size] = len(xs)
    assert columns == {"375": 1, "768": 2, "1280": 1}, columns


def test_renames_forward(app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend)
    old_v, old_vend = v["name"], vend["name"]
    new_v, new_vend = f"Vault {tok()}", f"Vendor {tok()}"
    pv = ok(om.patch(f"/api/vaults/{v['id']}", {"name": new_v}), 200).json()
    assert pv["name"] == new_v and pv["formerly"] == old_v
    ok(om.patch(f"/api/vendors/{vend['id']}", {"name": new_vend}), 200)
    got = ok(om.get(f"/api/credentials/{c['id']}"), 200).json()
    assert got["vendor"]["name"] == new_vend and got["vendor"]["formerly"] == old_vend
    vendor = next(x for x in ok(om.get("/api/vendors"), 200).json()["vendors"] if sid(x["id"]) == sid(vend["id"]))
    assert vendor["formerly"] == old_vend
    assert [(r["old"], r["new"]) for r in vendor["renames"]] == [(old_vend, new_vend)] and vendor["renames"][0]["by"] and vendor["renames"][0]["at"]
    assert vault_named(om, new_v)["formerly"] == old_v
    created = [e for e in audit_about(om, v["id"]) if e["action"] == "vault_create"]
    assert len(created) == 1 and created[0]["subject"]["name"] == old_v
    assert len([e for e in audit_about(om, v["id"]) if e["action"] == "vault_rename"]) == 1
    assert [e for e in audit_about(om, vend["id"]) if e["action"] == "vendor_create"][0]["subject"]["name"] == old_vend
    ok(om.patch(f"/api/vaults/{v['id']}", {"off_when_travelling": True}), 200)
    acts = [e["action"] for e in audit_about(om, v["id"])]
    assert acts.count("vault_change") == 1 and acts.count("vault_rename") == 1
    invalid_on(om.patch(f"/api/vendors/{vend['id']}", {"name": "x"}), "name")


def test_wf_renames_and_audit_rebrand(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend)
    p, _, _ = joiner(om, vault_ids=[v["id"]])
    run_day = office_today(app_url) + timedelta(days=2)
    ok(om.post("/api/rotations", {"credential_id": c["id"], "interval_days": 30, "at_time": "09:00", "first_run_on": run_day.isoformat()}), 201)
    old, new = vend["name"], f"Rebrand {tok()}"
    shown = f"{new} (formerly {old})"
    with desk_page(browser, om, f"/desk/vaults/{v['id']}") as page:
        click(page.get_by_role("button", name=f"Rename vendor {old}"))
        dlg = page.get_by_role("dialog", name="Rename vendor")
        fill(dlg.get_by_label("New name"), new)
        click(dlg.get_by_role("button", name="Save name"))
        expect(status(page)).to_have_text(f"Renamed to {new}.")
        expect(page.get_by_text(shown).first).to_be_visible()
        page.goto(f"{app_url}/rotations?month={run_day:%Y-%m}")
        row = page.get_by_role("list", name="Office days").get_by_role("listitem").filter(has_text=office_date_text(run_day))
        expect(row).to_contain_text(shown)
        page.goto(app_url + "/reviews")
        review = current_review(om)
        expect(page.get_by_role("region", name=f"{review['quarter']} access review")).to_contain_text(shown)
    assert ok(om.get(f"/api/credentials/{c['id']}"), 200).json()["vendor"]["formerly"] == old
    line = lines_for(current_review(om), p["id"])[0]
    assert line["vendors"] == [{"name": new, "formerly": old}]
    entries = audit_about(om, vend["id"])
    assert [e["subject"]["name"] for e in entries if e["action"] == "vendor_create"] == [old]
    assert len([e for e in entries if e["action"] == "vendor_rename"]) == 1


def test_audit_entries(app_url: str) -> None:
    om = Api(app_url, "marta")
    a, b, vend = new_vault(om), new_vault(om), new_vendor(om)
    c = new_login(om, b, vend)
    p, h, pw = joiner(om, vault_ids=[a["id"], b["id"]])
    Api(app_url, h, pw)
    ok(om.patch(f"/api/people/{p['id']}", {"vault_ids": [a["id"]]}), 200)
    ok(om.put(f"/api/credentials/{c['id']}/secret", {"secret": f"Sk-{tok()}-{tok()}"}), 200)
    ok(om.post(f"/api/credentials/{c['id']}/reveal", {}), 200)
    mine = sorted(audit_about(om, p["id"]) + audit_about(om, c["id"]), key=lambda e: e["seq"])
    pairs = [(e["action"], sid(e["subject"]["id"])) for e in mine]
    seqs = [e["seq"] for e in mine]
    assert seqs == sorted(set(seqs)) and all(isinstance(s, int) for s in seqs)
    first = lambda action, who: next(i for i, pr in enumerate(pairs) if pr == (action, sid(who["id"])))
    assert first("person_join", p) < first("person_change", p) < first("scope_removed", p) < first("turn_due", c)
    assert first("turn_due", c) < first("secret_edit", c) < first("turn_done", c) < first("reveal", c)
    due = next(e for e in mine if e["action"] == "turn_due")
    assert due["details"]["confirmed_by"]
    assert not [e for e in mine if sid(e["actor"].get("person_id")) == sid(p["id"])], "sign-in wrote an audit entry"
    sample = mine[0]
    assert {"id", "seq", "at", "office_day", "office_time", "offset", "actor", "action", "subject", "details"} <= set(sample)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for path in ("/api/audit", f"/api/audit/{sample['id']}"):
            refused(om.request(method, path, {}), 405, "method_not_allowed")
    assert len([e for e in audit_about(om, c["id"]) if e["action"] == "credential_create"]) == 1


def test_audit_office_day(app_url: str) -> None:
    base = env_url("APP_EVENING_URL")
    om = Api(base, "marta")
    prep = evening_prep()
    e = audit_about(om, prep["vault_id"], prep["office_day"])[0]
    assert e["office_day"] == prep["office_day"]
    at = parse_utc(e["at"])
    local = at.astimezone(OFFICE_TZ)
    assert e["office_day"] == local.date().isoformat() and e["office_time"] == local.strftime("%H:%M") and e["offset"] == local.tzname()
    ids = lambda d: {sid(x["id"]) for x in audit(om, d)}
    assert sid(e["id"]) in ids(local.date())
    assert sid(e["id"]) not in ids(local.date() + timedelta(days=1)) and sid(e["id"]) not in ids(local.date() - timedelta(days=1))
    if at.date() != local.date():
        assert sid(e["id"]) not in ids(at.date())
    oldest = [x["seq"] for x in audit(om, local.date())]
    newest = [x["seq"] for x in audit(om, local.date(), order="newest")]
    assert oldest == sorted(oldest) and newest == sorted(newest, reverse=True) and sorted(oldest) == sorted(newest)


def test_audit_paging() -> None:
    base = env_url("APP_FEED_DOWN_URL")
    om = Api(base, "marta")
    v = new_vault(om)
    state = {"on": False}

    def flip(n: int) -> None:
        for _ in range(n):
            state["on"] = not state["on"]
            ok(om.patch(f"/api/vaults/{v['id']}", {"off_when_travelling": state["on"]}), 200)

    flip(AUDIT_FLIPS)
    day = audit_about(om, v["id"])[0]["office_day"]
    snapshot = {sid(e["id"]) for e in audit(om, day)}
    paged: list[dict[str, Any]] = []
    cursor = None
    for i in range(AUDIT_MAX_PAGES * 4):
        params: dict[str, Any] = {"day": day, "order": "oldest", "limit": 7}
        if cursor:
            params["after"] = cursor
        body = ok(om.get("/api/audit", **params), 200).json()
        assert len(body["entries"]) <= 7
        paged += body["entries"]
        if i == 1:
            flip(6)
        cursor = body["next_cursor"]
        if not cursor:
            break
    else:
        pytest.fail("the cursors never ended")
    seqs = [e["seq"] for e in paged]
    assert seqs == sorted(set(seqs)), "paging repeated or reordered an entry"
    paged_ids = {sid(e["id"]) for e in paged}
    final = {sid(e["id"]) for e in audit(om, day)}
    assert snapshot <= paged_ids and paged_ids == final
    first = ok(om.get("/api/audit", day=day, order="oldest", limit=1), 200).json()
    assert first["next_cursor"]
    invalid_on(om.get("/api/audit", day=day, order="newest", limit=1, after=first["next_cursor"]), "after")
    other = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
    invalid_on(om.get("/api/audit", day=other, order="oldest", limit=1, after=first["next_cursor"]), "after")
    invalid_on(om.get("/api/audit", day=day, after="not-a-cursor"), "after")
    for bad in (AUDIT_LIMIT_MAX + 1, 0, "abc"):
        invalid_on(om.get("/api/audit", day=day, limit=bad), "limit")
    invalid_on(om.get("/api/audit", day="2026-02-30"), "day")
    invalid_on(om.get("/api/audit", day=day, order="sideways"), "order")
    assert len(ok(om.get("/api/audit", day=day, limit=AUDIT_LIMIT_MAX), 200).json()["entries"]) <= AUDIT_LIMIT_MAX
    assert ok(om.get("/api/audit", day=day), 200).json()["order"] == "oldest"


def test_wf_renames_and_audit_footer(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    state = False
    for _ in range(AUDIT_PAGE + 2):
        state = not state
        ok(om.patch(f"/api/vaults/{v['id']}", {"off_when_travelling": state}), 200)
    newest = ok(om.get("/api/audit", order="newest", limit=10), 200).json()["entries"]
    with desk_page(browser, om, f"/desk/vaults/{v['id']}") as page:
        footer = page.get_by_role("contentinfo")
        expect(footer.get_by_role("heading", level=2, name="Back of the drawer")).to_be_attached()
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        expect(footer.get_by_role("heading", level=2, name="Back of the drawer")).to_be_in_viewport()
        expect(footer).to_contain_text(v["name"])
        assert newest[0]["subject"]["name"] in footer.inner_text()
    today = office_today(app_url)
    with desk_page(browser, om, f"/audit?day={today.isoformat()}") as page:
        table = page.get_by_role("table", name="Audit entries")
        more = page.get_by_role("button", name="More entries")
        expect(more).to_be_visible()
        rows = table.get_by_role("row").count()
        assert AUDIT_PAGE <= rows <= AUDIT_PAGE + 1
        scroll = page.evaluate("window.scrollY")
        click(more)
        expect(table.get_by_role("row")).not_to_have_count(rows)
        assert page.evaluate("window.scrollY") == scroll or page.evaluate("window.scrollY") >= scroll
    _, h, pw = joiner(om, vault_ids=[vaults(om)[0]["id"]])
    with desk_page(browser, Api(app_url, h, pw), "/desk") as page:
        expect(page.get_by_role("tablist", name="Vaults")).to_be_visible()
        expect(page.get_by_role("heading", name="Back of the drawer")).to_have_count(0)
        expect(page.get_by_role("contentinfo")).to_have_count(0)


def test_day_and_month_in_address(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    today = office_today(app_url)
    d1, d2 = today - timedelta(days=2), today - timedelta(days=1)
    with desk_page(browser, om, "/audit?day=not-a-date") as page:
        expect(page).to_have_url(f"{app_url}/audit?day={today.isoformat()}")
        page.goto(f"{app_url}/audit?day={d1.isoformat()}")
        expect(page.get_by_label("Office day")).to_have_value(d1.isoformat())
        fill(page.get_by_label("Office day"), d2.isoformat())
        expect(page).to_have_url(f"{app_url}/audit?day={d2.isoformat()}")
        page.go_back()
        expect(page).to_have_url(f"{app_url}/audit?day={d1.isoformat()}")
        expect(page.get_by_label("Office day")).to_have_value(d1.isoformat())
        page.go_forward()
        expect(page).to_have_url(f"{app_url}/audit?day={d2.isoformat()}")
        page.reload()
        expect(page.get_by_label("Office day")).to_have_value(d2.isoformat())
        page.goto(f"{app_url}/rotations?month=2027-13")
        expect(page).to_have_url(f"{app_url}/rotations?month={today:%Y-%m}")
        page.goto(f"{app_url}/rotations")
        expect(page).to_have_url(f"{app_url}/rotations?month={today:%Y-%m}")


def test_joiner_on_record(app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    h = f"j{tok()}"
    name = f"Rhoda {tok()}"
    p = ok(om.post("/api/people", joiner_body(h, name, vault_ids=[v["id"]], aliases=["Rho"]), key=idempotency_key()), 201).json()
    assert p["handle"] == h and p["status"] == "invited" and p["aliases"] == ["Rho"] and p["left_at"] is None
    assert [sid(x) for x in p["vault_ids"]] == [sid(v["id"])] and p["seat"] in ("confirmed", "waiting_on_billing")
    assert any(sid(x["id"]) == sid(p["id"]) for x in people(om))
    users = kc_users(h)
    assert len(users) == 1
    u = users[0]
    assert u["enabled"] is True and u["emailVerified"] is True
    assert u["firstName"] == name.split(" ")[0] and u["lastName"] == name.split(" ", 1)[1]
    assert u["email"] == f"{OFFICE_KEY}.{h}@people.lockset.example"
    Api(app_url, h, JOINER_PASSWORD)
    h2 = f"j{tok()}"
    ok(om.post("/api/people", joiner_body(h2, SINGLE_NAME), key=idempotency_key()), 201)
    one = kc_users(h2)[0]
    assert one["firstName"] == SINGLE_NAME and one["lastName"] == SINGLE_NAME
    bad_cases = {
        "handle": {"handle": "A!"}, "email": {"email": "marta.lindqvist@brannocklyle.example"}, "role": {"role": "boss"},
        "aliases": {"aliases": [f"a{i}" for i in range(6)]}, "vault_ids": {"vault_ids": [f"nope-{tok()}"]},
        "initial_password": {"initial_password": "x" * 11}, "full_name": {"full_name": "A"},
    }
    for field, change in bad_cases.items():
        hh = f"j{tok()}"
        body = joiner_body(hh, f"Bad {tok()}")
        body.update(change)
        if field != "handle":
            body["handle"] = hh
        invalid_on(om.post("/api/people", body), field)
        assert kc_users(body["handle"]) == [] and all(x["handle"] != body["handle"] for x in people(om))
    today = office_today(app_url)
    ob_h = f"j{tok()}"
    invalid_on(om.post("/api/people", joiner_body(ob_h, "Outside One", role="outside_bookkeeper")), "term")
    invalid_on(om.post("/api/people", joiner_body(f"j{tok()}", "Staff Term", term={"starts_on": today.isoformat(), "ends_on": today.isoformat()})), "term")
    invalid_on(om.post("/api/people", joiner_body(f"j{tok()}", "Late End", role="outside_bookkeeper",
                                                   term={"starts_on": today.isoformat(), "ends_on": (today - timedelta(days=1)).isoformat()})), "term")
    term = {"starts_on": today.isoformat(), "ends_on": (today + timedelta(days=10)).isoformat()}
    ob = ok(om.post("/api/people", joiner_body(ob_h, "Outside One", role="outside_bookkeeper", term=term)), 201).json()
    assert ob["term"] == term and kc_users(ob_h)[0]["enabled"] is True
    assert "term_start" in [e["action"] for e in audit_about(om, ob["id"])]
    fut_h = f"j{tok()}"
    ok(om.post("/api/people", joiner_body(fut_h, "Outside Two", role="outside_bookkeeper",
                                          term={"starts_on": (today + timedelta(days=3)).isoformat(), "ends_on": (today + timedelta(days=9)).isoformat()})), 201)
    assert kc_users(fut_h)[0]["enabled"] is False
    assert Api(app_url).post("/api/sessions", {"username": fut_h, "password": JOINER_PASSWORD}).status_code == 401


def test_joiner_seat(app_url: str, killbill: Any) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    p, h, _ = joiner(om)
    wait_until(lambda: person(om, p["id"])["seat"] == "confirmed", SEAT_WAIT_S, "the seat was never confirmed")
    acct = killbill.account_by_key(OFFICE_KEY)
    assert acct and acct["currency"] == "USD" and acct["name"] == "Brannock & Lyle"
    subs = seat_subs(killbill, OFFICE_KEY, h)
    assert len(subs) == 1 and subs[0]["state"] == "ACTIVE" and subs[0]["planName"] == SEAT_PLAN and subs[0].get("chargedThroughDate")
    actions = [e["action"] for e in audit_about(om, p["id"])]
    assert actions[0] == "person_join" and "seat_confirmed" in actions
    wait_until(lambda: ok(mp.get("/api/billing"), 200).json()["seats"] == len(
        [s for s in seat_subs(killbill, OFFICE_KEY) if s["state"] == "ACTIVE" and s["planName"] == SEAT_PLAN]),
        SEAT_WAIT_S, "Billing seats differ from Kill Bill's ACTIVE seats")


def test_wf_joiner_add(browser: Browser, app_url: str, killbill: Any) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    h, name = f"j{tok()}", f"Nina {tok()}"
    with desk_page(browser, om, "/people") as page:
        click(page.get_by_role("button", name="Add joiner"))
        dlg = page.get_by_role("dialog", name="Add joiner")
        expect(dlg.get_by_label("Full name")).to_be_focused()
        fill(dlg.get_by_label("Full name"), name)
        fill(dlg.get_by_label("Email"), f"{h}@brannocklyle.example")
        fill(dlg.get_by_label("Handle"), h)
        select(dlg.get_by_role("combobox", name="Role"), "Staff accountant")
        fill(dlg.get_by_label("Aliases"), "Nin")
        check(dlg.get_by_role("checkbox", name=v["name"]))
        fill(dlg.get_by_label("Initial password"), JOINER_PASSWORD)
        dlg.get_by_role("button", name="Add to the office").dblclick()
        expect(status(page)).to_have_text(re.compile(rf"^{re.escape(name)} joined\. (Seat confirmed by billing|Their seat is waiting on billing)\.$"))
        row = page.get_by_role("table", name="People").get_by_role("row").filter(has_text=name)
        expect(row).to_have_count(1)
        expect(row).to_contain_text(re.compile("Seat confirmed|Waiting on billing"))
        expect(row).to_contain_text("Seat confirmed", timeout=SEAT_WAIT_S * 1000)
    matches = [x for x in people(om) if x["handle"] == h]
    assert len(matches) == 1 and len(kc_users(h)) == 1 and len(seat_subs(killbill, OFFICE_KEY, h)) == 1
    assert [e["action"] for e in audit_about(om, matches[0]["id"])].count("person_join") == 1


def test_wf_joiner_invalid_recovery(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    h = f"j{tok()}"
    before = len(people(om))
    with desk_page(browser, om, "/people") as page:
        opener = page.get_by_role("button", name="Add joiner")
        click(opener)
        dlg = page.get_by_role("dialog", name="Add joiner")
        fill(dlg.get_by_label("Full name"), f"Valid {tok()}")
        fill(dlg.get_by_label("Email"), "not-an-email")
        fill(dlg.get_by_label("Handle"), h)
        fill(dlg.get_by_label("Initial password"), JOINER_PASSWORD)
        click(dlg.get_by_role("button", name="Add to the office"))
        expect(dlg).to_be_visible()
        expect(dlg.get_by_label("Email")).to_be_focused()
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(opener).to_be_focused()
    assert len(people(om)) == before and kc_users(h) == []


def test_people_live(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    with desk_page(browser, om, "/people") as page:
        expect(page.get_by_role("heading", level=1, name="People")).to_be_visible()
        add = page.get_by_role("button", name="Add joiner")
        add.focus()
        page.evaluate("window.__probe = 1")
        p, _, _ = joiner(om)
        row = page.get_by_role("table", name="People").get_by_role("row").filter(has_text=p["full_name"])
        expect(row).to_contain_text("Seat confirmed", timeout=SEAT_WAIT_S * 1000)
        assert page.evaluate("window.__probe") == 1, "the People page reloaded"
        expect(add).to_be_focused()


def test_one_joiner_per_handle(app_url: str, killbill: Any) -> None:
    om = Api(app_url, "marta")
    h = f"j{tok()}"
    with ThreadPoolExecutor(5) as ex:
        rs = list(ex.map(lambda i: om.post("/api/people", joiner_body(h, f"Race {tok()}", email=f"{h}.{i}@brannocklyle.example"), key=idempotency_key()), range(5)))
    assert sorted(r.status_code for r in rs) == [201, 422, 422, 422, 422]
    for r in rs:
        if r.status_code == 422:
            invalid_on(r, "handle")
    won = next(r for r in rs if r.status_code == 201).json()
    assert len([x for x in people(om) if x["handle"] == h]) == 1 and len(kc_users(h)) == 1
    wait_until(lambda: len(seat_subs(killbill, OFFICE_KEY, h)) >= 1, SEAT_WAIT_S, "no seat bundle was created")
    assert len(seat_subs(killbill, OFFICE_KEY, h)) == 1
    assert [e["action"] for e in audit_about(om, won["id"])].count("person_join") == 1
    email = f"shared{tok()}@brannocklyle.example"
    handles = [f"j{tok()}" for _ in range(4)]
    with ThreadPoolExecutor(4) as ex:
        rs = list(ex.map(lambda hh: om.post("/api/people", joiner_body(hh, f"Race {tok()}", email=email), key=idempotency_key()), handles))
    assert sorted(r.status_code for r in rs) == [201, 422, 422, 422]
    for r in rs:
        if r.status_code == 422:
            invalid_on(r, "email")
    assert len([x for x in people(om) if x["email"] == email]) == 1


def test_leave_effects(app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend)
    p, h, pw = joiner(om, vault_ids=[v["id"]])
    sa = Api(app_url, h, pw)
    ok(sa.put(f"/api/credentials/{c['id']}/secret", {"secret": f"Sk-{tok()}-{tok()}"}), 200)
    res = ok(leave(om, p["id"]), 200).json()
    assert res["person"]["status"] == "left" and res["person"]["vault_ids"] == [] and res["person"]["left_at"]
    assert res["seat"] in ("released", "release_waiting")
    for r in (sa.get("/api/me"), sa.get("/api/vaults"), sa.post(f"/api/credentials/{c['id']}/reveal", {})):
        refused(r, 401, "signed_out")
    refused(Api(app_url).post("/api/sessions", {"username": h, "password": pw}), 401, "account_disabled", ACCOUNT_OFF)
    assert kc_users(h)[0]["enabled"] is False
    held_by = ok(om.get(f"/api/credentials/{c['id']}"), 200).json()["held_by"]
    assert [(sid(x["person_id"]), x["left"]) for x in held_by] == [(sid(p["id"]), True)]
    entries = audit_about(om, p["id"])
    acts = [e["action"] for e in entries]
    assert "person_leave" in acts and acts.count("scope_removed") == 1
    detail = next(e for e in entries if e["action"] == "person_leave")["details"]
    assert detail["confirmed_by"] and "turns_due" in detail
    refused(leave(om, p["id"]), 409, "already_left", f"{p['full_name']} has already left.")
    refused(om.patch(f"/api/people/{p['id']}", {"aliases": ["z"]}), 409, "already_left")
    refused(om.post(f"/api/people/{p['id']}/travel", {"starts_at": "2030-01-01T09:00", "ends_at": "2030-01-02T09:00"}), 409, "already_left")
    refused(om.post(f"/api/people/{om.person['id']}/leave", {"confirm": True}), 409, "own_record")
    q, _, _ = joiner(om)
    invalid_on(om.post(f"/api/people/{q['id']}/leave", {"confirm": False}), "confirm")
    refused(Api(app_url, "deandra").post(f"/api/people/{q['id']}/leave", {"confirm": True}), 403, "forbidden")
    assert person(om, q["id"])["status"] != "left"
    invalid_on(om.post("/api/people", joiner_body(h, f"Again {tok()}")), "handle")


def test_turns_due_after_leave(app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c1, c2 = new_login(om, v, vend), new_login(om, v, vend)
    p, _, _ = joiner(om, vault_ids=[v["id"]])
    res = ok(leave(om, p["id"]), 200).json()
    day = date.fromisoformat(next(e for e in audit_about(om, p["id"]) if e["action"] == "person_leave")["office_day"])
    due = business_after(day, SCOPE_LOSS_BUSINESS_DAYS)
    assert sorted(sid(t["credential_id"]) for t in res["turns_due"]) == sorted([sid(c1["id"]), sid(c2["id"])])
    assert all(t["due_by"] == due.isoformat() for t in res["turns_due"])
    mine = [e for e in calendar_entries(om, f"{due:%Y-%m}") if sid(e["credential_id"]) in (sid(c1["id"]), sid(c2["id"])) and e["kind"] == "scope_loss"]
    assert len(mine) == 2 and all(e["_day"] == due.isoformat() and e["state"] == "due" for e in mine)
    for c in (c1, c2):
        turn = [e for e in audit_about(om, c["id"]) if e["action"] == "turn_due"]
        assert len(turn) == 1 and turn[0]["details"]["confirmed_by"]
    ok(om.put(f"/api/credentials/{c1['id']}/secret", {"secret": f"Sk-{tok()}-{tok()}"}), 200)
    after = [e for e in calendar_entries(om, f"{due:%Y-%m}") if sid(e["credential_id"]) == sid(c1["id"]) and e["kind"] == "scope_loss"]
    assert after and all(e["state"] == "turned" for e in after)


def test_leaver_seat_release(app_url: str, killbill: Any) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    p, h, _ = joiner(om)
    wait_until(lambda: person(om, p["id"])["seat"] == "confirmed", SEAT_WAIT_S, "the seat was never confirmed")
    paid_to = seat_subs(killbill, OFFICE_KEY, h)[0]["chargedThroughDate"][:10]
    active = lambda: len([s for s in seat_subs(killbill, OFFICE_KEY) if s["state"] == "ACTIVE" and s["planName"] == SEAT_PLAN])
    wait_until(lambda: ok(mp.get("/api/billing"), 200).json()["seats"] == active(), SEAT_WAIT_S, "Billing never matched Kill Bill")
    seats_before = ok(mp.get("/api/billing"), 200).json()["seats"]
    ok(leave(om, p["id"]), 200)
    wait_until(lambda: person(om, p["id"])["seat"] == "released", SEAT_WAIT_S, "the release was never confirmed")
    sub = seat_subs(killbill, OFFICE_KEY, h)[0]
    assert sub["state"] == "CANCELLED" and sub["billingEndDate"][:10] == paid_to == sub["chargedThroughDate"][:10]
    wait_until(lambda: ok(mp.get("/api/billing"), 200).json()["seats"] == seats_before - 1 == active(), SEAT_WAIT_S, "the seat count did not drop by one")
    assert "seat_released" in [e["action"] for e in audit_about(om, p["id"])]


def test_idempotent_people(app_url: str) -> None:
    om = Api(app_url, "marta")
    h, body, key = f"j{tok()}", None, idempotency_key()
    body = joiner_body(h, f"Idem {tok()}")
    r1 = ok(om.post("/api/people", body, key=key), 201)
    r2 = om.post("/api/people", body, key=key)
    assert r2.status_code == 201 and r2.json() == r1.json()
    assert len([x for x in people(om) if x["handle"] == h]) == 1 and len(kc_users(h)) == 1
    assert [e["action"] for e in audit_about(om, r1.json()["id"])].count("person_join") == 1
    refused(om.post("/api/people", dict(body, full_name=f"Other {tok()}"), key=key), 409, "idempotency_conflict")
    pid = r1.json()["id"]
    lk = idempotency_key()
    first = ok(leave(om, pid, key=lk), 200)
    replay = leave(om, pid, key=lk)
    assert replay.status_code == 200 and replay.json() == first.json()
    refused(leave(om, pid, key=idempotency_key()), 409, "already_left")
    v = new_vault(om)
    data, ik = csv_bytes([f"{v['name']},Idem,i{tok()}.example,u1,Pw-{tok()},Dee,"]), idempotency_key()
    a = ok(import_file(om, data, key=ik), 201)
    b = import_file(om, data, key=ik)
    assert b.status_code == 201 and b.json() == a.json()
    refused(import_file(om, data + b"\r\n,,,,,,\r\nx", key=ik), 409, "idempotency_conflict")
    assert len(vault_detail(om, v["id"])["credentials"]) == 1
    q, _, _ = joiner(om)
    with ThreadPoolExecutor(6) as ex:
        rs = list(ex.map(lambda _: leave(om, q["id"]), range(6)))
    assert sorted(r.status_code for r in rs) == [200, 409, 409, 409, 409, 409]
    for r in rs:
        if r.status_code == 409:
            refused(r, 409, "already_left")


def test_wf_leaver_evening(browser: Browser) -> None:
    base = env_url("APP_EVENING_URL")
    om = Api(base, "marta")
    theo = seeded_person(om, "theo")
    old_browser = Api(base, "theo")
    held_vaults = {sid(x) for x in theo["vault_ids"]}
    count = sum(v["credential_count"] for v in vaults(om) if sid(v["id"]) in held_vaults)
    with desk_page(browser, om, "/people") as page:
        row = page.get_by_role("table", name="People").get_by_role("row").filter(has_text="Theo Vasquez")
        opener = row.get_by_role("button", name=f"Leave for {theo['full_name']}")
        click(opener)
        dlg = page.get_by_role("dialog", name="Confirm leaver")
        expect(dlg.get_by_role("button", name="Confirm leave")).to_be_focused()
        click(dlg.get_by_role("button", name="Confirm leave"))
        expect(status(page)).to_have_text(re.compile(rf"^Theo Vasquez has left\. {count} logins are due to turn by .+\.$"))
        text = status(page).inner_text()
        expect(row).to_contain_text(re.compile("Release waiting on billing|Released"))
    day = date.fromisoformat(next(e for e in audit_about(om, theo["id"]) if e["action"] == "person_leave")["office_day"])
    due = business_after(day, SCOPE_LOSS_BUSINESS_DAYS)
    assert text == f"Theo Vasquez has left. {count} logins are due to turn by {office_date_text(due)}."
    for r in (old_browser.get("/api/me"), old_browser.get("/api/vaults")):
        refused(r, 401, "signed_out")
    assert kc_users("theo", "blev")[0]["enabled"] is False
    after = seeded_person(om, "theo")
    assert after["status"] == "left" and after["vault_ids"] == []
    entries = audit_about(om, theo["id"], day)
    assert len([e for e in entries if e["action"] == "scope_removed"]) == len(held_vaults)
    local = parse_utc(next(e for e in entries if e["action"] == "person_leave")["at"]).astimezone(OFFICE_TZ)
    assert next(e for e in entries if e["action"] == "person_leave")["office_day"] == local.date().isoformat()
    prep = evening_prep()
    due_prep = business_after(date.fromisoformat(prep["office_day"]), SCOPE_LOSS_BUSINESS_DAYS)
    assert prep["turns_due"] and {t["due_by"] for t in prep["turns_due"]} == {due_prep.isoformat()}
    prep_leave = next(x for x in audit_about(om, prep["person_id"], prep["office_day"]) if x["action"] == "person_leave")
    assert prep_leave["office_day"] == prep["office_day"]


def test_wf_leaver_cancel(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    p, _, _ = joiner(om)
    with desk_page(browser, om, "/people") as page:
        row = page.get_by_role("table", name="People").get_by_role("row").filter(has_text=p["full_name"])
        opener = row.get_by_role("button", name=f"Leave for {p['full_name']}")
        click(opener)
        dlg = page.get_by_role("dialog", name="Confirm leaver")
        expect(dlg).to_be_visible()
        names = [dlg.get_by_role("button").nth(i).inner_text().strip() for i in range(2)]
        assert names == ["Confirm leave", "Cancel"]
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(opener).to_be_focused()
    assert person(om, p["id"])["status"] != "left"


def test_mover_changes(app_url: str) -> None:
    om = Api(app_url, "marta")
    a, b, vend = new_vault(om), new_vault(om), new_vendor(om)
    cb = new_login(om, b, vend)
    p, h, pw = joiner(om, vault_ids=[a["id"], b["id"]])
    sa = Api(app_url, h, pw)
    ok(sa.get(f"/api/vaults/{b['id']}"), 200)
    res = ok(om.patch(f"/api/people/{p['id']}", {"vault_ids": [a["id"]], "aliases": ["Mo"]}), 200).json()
    assert [sid(x) for x in res["vault_ids"]] == [sid(a["id"])] and res["aliases"] == ["Mo"]
    refused(sa.get(f"/api/vaults/{b['id']}"), 404, "not_found")
    refused(sa.post(f"/api/credentials/{cb['id']}/reveal", {}), 404, "not_found")
    ok(sa.get("/api/me"), 200)
    ok(sa.get(f"/api/vaults/{a['id']}"), 200)
    day = office_today(app_url)
    due = business_after(day, SCOPE_LOSS_BUSINESS_DAYS)
    turns = [e for e in calendar_entries(om, f"{due:%Y-%m}") if sid(e["credential_id"]) == sid(cb["id"]) and e["kind"] == "scope_loss"]
    assert turns and turns[0]["due_by"] == due.isoformat()
    ok(om.patch(f"/api/people/{p['id']}", {"role": "managing_partner"}), 200)
    have = {sid(x["id"]) for x in vaults(sa)}
    assert {sid(x["id"]) for x in vaults(om)} <= have
    ok(sa.get("/api/rules", vault_id=a["id"]), 200)
    invalid_on(om.patch(f"/api/people/{p['id']}", {"role": "outside_bookkeeper", "vault_ids": [a["id"]]}), "term")
    ends = (day + timedelta(days=30)).isoformat()
    ob = ok(om.patch(f"/api/people/{p['id']}", {"role": "outside_bookkeeper", "vault_ids": [a["id"]], "term_ends_on": ends}), 200).json()
    assert ob["term"] == {"starts_on": day.isoformat(), "ends_on": ends}
    refused(om.patch(f"/api/people/{om.person['id']}", {"aliases": ["x"]}), 409, "own_record")
    refused(Api(app_url, "deandra").patch(f"/api/people/{p['id']}", {"aliases": ["x"]}), 403, "forbidden")
    refused(om.patch(f"{MISSING_PEOPLE}{tok()}", {"aliases": ["x"]}), 404, "not_found")


@pytest.mark.timeout(500)
def test_travel_windows(app_url: str) -> None:
    om = Api(app_url, "marta")
    tv, nv = new_vault(om, off=True), new_vault(om)
    p, h, pw = joiner(om, vault_ids=[tv["id"], nv["id"]])
    sa = Api(app_url, h, pw)
    path = f"/api/people/{p['id']}/travel"
    local = server_now(app_url).astimezone(OFFICE_TZ).replace(second=0, microsecond=0)
    for body in ({"starts_at": local_minute(local + timedelta(hours=1)), "ends_at": local_minute(local + timedelta(minutes=30))},
                 {"starts_at": local_minute(local - timedelta(days=2)), "ends_at": local_minute(local - timedelta(days=1))},
                 {"starts_at": local_minute(local), "ends_at": local_minute(local + timedelta(days=61))}):
        assert sa.post(path, body).status_code == 422
    future = ok(sa.post(path, {"starts_at": local_minute(local + timedelta(days=1)), "ends_at": local_minute(local + timedelta(days=2))}), 201).json()
    ok(sa.delete(f"{path}/{future['id']}"), 204)
    assert person(om, p["id"])["travel"] == []
    win = ok(sa.post(path, {"starts_at": local_minute(local - timedelta(minutes=1)), "ends_at": local_minute(local + timedelta(minutes=2))}), 201).json()
    assert win["starts_at"] == local_minute(local - timedelta(minutes=1))
    refused(sa.get(f"/api/vaults/{tv['id']}"), 404, "not_found")
    ok(sa.get(f"/api/vaults/{nv['id']}"), 200)
    assert sid(tv["id"]) not in {sid(x["id"]) for x in vaults(sa)} and person(om, p["id"])["status"] == "travelling"
    refused(sa.delete(f"{path}/{win['id']}"), 409, "travel_started")
    refused(Api(app_url, "deandra").post(path, {"starts_at": local_minute(local + timedelta(days=1)), "ends_at": local_minute(local + timedelta(days=2))}), 403, "forbidden")
    wait_until(lambda: sa.get(f"/api/vaults/{tv['id']}").status_code == 200, 240, "the vault never returned at the end minute")
    acts = [e["action"] for e in audit_about(om, p["id"])]
    assert acts.count("travel_set") == 2 and acts.count("travel_cancel") == 1


@pytest.mark.timeout(1800)
def test_engagement_term(app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    today = office_today(app_url)
    p, h, pw = joiner(om, role="outside_bookkeeper", vault_ids=[v["id"]],
                      term={"starts_on": today.isoformat(), "ends_on": (today + timedelta(days=10)).isoformat()})
    assert p["status"] == "on_term"
    ob = Api(app_url, h, pw)
    assert sid(v["id"]) in {sid(x["id"]) for x in vaults(ob)}
    f, fh, fpw = joiner(om, role="outside_bookkeeper", vault_ids=[v["id"]],
                        term={"starts_on": (today + timedelta(days=3)).isoformat(), "ends_on": (today + timedelta(days=10)).isoformat()})
    assert Api(app_url).post("/api/sessions", {"username": fh, "password": fpw}).status_code == 401
    base = env_url("APP_EVENING_URL")
    eom = Api(base, "marta")
    now = server_now(base)
    local = now.astimezone(OFFICE_TZ)
    end_at = datetime.combine(local.date(), dtime(23, 59), tzinfo=OFFICE_TZ)
    remaining = (end_at - now).total_seconds()
    if 0 < remaining <= LIVE_WINDOW_S:
        ev = new_vault(eom)
        q, qh, qpw = joiner(eom, role="outside_bookkeeper", vault_ids=[ev["id"]],
                            term={"starts_on": local.date().isoformat(), "ends_on": local.date().isoformat()})
        qa = Api(base, qh, qpw)
        ok(qa.get(f"/api/vaults/{ev['id']}"), 200)
        wait_until(lambda: person(eom, q["id"])["status"] == "left", remaining + 30, "the term did not end at 23:59")
        refused(qa.get("/api/me"), 401, "signed_out")
        refused(qa.get(f"/api/vaults/{ev['id']}"), 401, "signed_out")
        assert kc_users(qh, "blev")[0]["enabled"] is False
        ended = [e for e in audit_about(eom, q["id"]) if e["action"] == "term_end"]
        assert len(ended) == 1 and ended[0]["actor"] == {"system": "Lockset"} and ended[0]["office_time"] == "23:59"


@pytest.mark.timeout(400)
def test_open_page_follows_server(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    tv, nv = new_vault(om, off=True), new_vault(om)
    p, h, pw = joiner(om, vault_ids=[tv["id"], nv["id"]])
    sa = Api(app_url, h, pw)
    opens = next_office_minute(app_url, lead_s=70)
    path = f"/api/people/{p['id']}/travel"
    ok(sa.post(path, {"starts_at": local_minute(opens), "ends_at": local_minute(opens + timedelta(minutes=10))}), 201)
    with desk_page(browser, sa, f"/desk/vaults/{nv['id']}", skew=DEVICE_SKEW) as page:
        tab = page.get_by_role("tab", name=tv["name"], exact=True)
        expect(tab).to_be_visible()
        remaining = ms_until(app_url, opens)
        assert remaining > 0, "the page loaded after the boundary"
        expect(tab).to_have_count(0, timeout=remaining + PUSH_MS + SLACK_MS)
        expect(status(page)).to_have_text(ACCESS_CHANGED)
        ok(sa.get("/api/me"), 200)


@pytest.mark.timeout(400)
def test_wf_movers_and_travel_window(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    tv, nv = new_vault(om, off=True), new_vault(om)
    p, h, pw = joiner(om, vault_ids=[tv["id"], nv["id"]])
    sa = Api(app_url, h, pw)
    opens = next_office_minute(app_url, lead_s=90)
    with desk_page(browser, sa, "/travel") as page:
        click(page.get_by_role("button", name="Add travel window"))
        dlg = page.get_by_role("dialog", name="Travel window")
        fill(dlg.get_by_label("Starts"), local_minute(opens))
        fill(dlg.get_by_label("Ends"), local_minute(opens + timedelta(minutes=10)))
        click(dlg.get_by_role("button", name="Save travel window"))
        expect(status(page)).to_have_text("Travel window saved.")
        click(page.get_by_role("navigation", name="Desk").get_by_role("link", name="Drawer", exact=True))
        expect(page.get_by_role("tab", name=tv["name"], exact=True)).to_be_visible()
        remaining = ms_until(app_url, opens)
        expect(status(page)).to_have_text(ACCESS_CHANGED, timeout=max(remaining, 0) + PUSH_MS + SLACK_MS)
        expect(page.get_by_role("tab", name=tv["name"], exact=True)).to_have_count(0)
        expect(page.get_by_role("tab", name=nv["name"], exact=True)).to_be_visible()
    assert len(person(om, p["id"])["travel"]) == 1


@pytest.mark.parametrize("cause", ["mover_change", "review_removal"], ids=["mover_change", "review_removal"])
def test_wf_movers_and_travel_dropped(browser: Browser, app_url: str, cause: str) -> None:
    om = Api(app_url, "marta")
    a, b, vend = new_vault(om), new_vault(om), new_vendor(om)
    cb = new_login(om, b, vend)
    new_login(om, a, vend)
    p, h, pw = joiner(om, vault_ids=[a["id"], b["id"]])
    sa = Api(app_url, h, pw)
    with desk_page(browser, sa, f"/desk/vaults/{b['id']}") as page:
        click(page.get_by_role("button", name=f"Reveal {cb['label']}"))
        expect(page.get_by_text(cb["_secret"])).to_be_visible()
        click(page.get_by_role("button", name=f"Turn {cb['label']}"))
        dlg = page.get_by_role("dialog", name=f"Turn {cb['label']}")
        fill(dlg.get_by_label("New password"), TYPED_B)
        if cause == "mover_change":
            ok(om.patch(f"/api/people/{p['id']}", {"vault_ids": [a["id"]]}), 200)
        else:
            line = next(ln for ln in lines_for(current_review(om), p["id"]) if sid(ln["vault_id"]) == sid(b["id"]))
            ok(om.post(f"/api/reviews/{current_review(om)['id']}/lines/{line['id']}", {"decision": "remove"}), 200)
        expect(page.get_by_role("tab", name=b["name"], exact=True)).to_have_count(0, timeout=PUSH_MS + SLACK_MS)
        expect(alert(page)).to_have_text(f"Your access to {b['name']} ended.")
        expect(page.get_by_text(cb["_secret"])).to_have_count(0)
        expect(page.get_by_text(TYPED_B)).to_have_count(0)
        expect(page.get_by_role("dialog")).to_have_count(0)
        expect(page.get_by_role("heading", level=2, name=a["name"])).to_be_focused()
    ok(sa.get("/api/me"), 200)
    refused(sa.get(f"/api/vaults/{b['id']}"), 404, "not_found")


def test_rule_lifecycle(app_url: str) -> None:
    om, mp, sa = Api(app_url, "marta"), Api(app_url, "graham"), Api(app_url, "deandra")
    v, v2 = new_vault(om), new_vault(om)
    today = office_today(app_url)
    eff = today + timedelta(days=9)
    first = draft_rule(om, v["id"], 15, eff)
    assert (first["state"], first["version"], first["signed_by"]) == ("drafted", 1, None)
    assert first["stub_text"] == draft_stub(15, eff) and first["drafted_by"]
    refused(om.post(f"/api/rules/{first['id']}/sign", {"version": 1}), 403, "forbidden")
    refused(sa.get("/api/rules", vault_id=v["id"]), 403, "forbidden")
    dup = draft_rule(om, v["id"], 16, eff)
    signed = ok(mp.post(f"/api/rules/{first['id']}/sign", {"version": 1}), 200).json()
    assert (signed["state"], signed["version"]) == ("scheduled", 2) and signed["signed_by"] and signed["stub_text"] == takes_force(eff)
    refused(mp.post(f"/api/rules/{first['id']}/sign", {"version": 2}), 409, "not_a_draft")
    refused(mp.post(f"/api/rules/{dup['id']}/sign", {"version": 7}), 409, "rule_changed", RULE_CHANGED)
    refused(mp.post(f"/api/rules/{dup['id']}/sign", {"version": 1}), 409, "rule_date_taken")
    refused(om.patch(f"/api/rules/{first['id']}", {"version": 9, "min_length": 19}), 409, "rule_changed", RULE_CHANGED)
    edited = ok(om.patch(f"/api/rules/{first['id']}", {"version": 2, "min_length": 19}), 200).json()
    assert (edited["state"], edited["version"], edited["min_length"]) == ("drafted", 3, 19)
    resigned = ok(mp.post(f"/api/rules/{first['id']}/sign", {"version": 3}), 200).json()
    assert (resigned["state"], resigned["version"]) == ("scheduled", 4)
    hosting = vault_named(om, "Hosting")["rule_in_force"]["id"]
    refused(mp.post(f"/api/rules/{hosting}/sign", {"version": 2}), 409, "rule_in_force")
    refused(om.patch(f"/api/rules/{hosting}", {"version": "x", "min_length": 20}), 409, "rule_in_force")
    old = next(r for r in ok(om.get("/api/rules", vault_id=vault_named(om, "Office")["id"]), 200).json()["rules"] if r["state"] == "superseded")
    refused(mp.post(f"/api/rules/{old['id']}/sign", {"version": old["version"]}), 409, "rule_superseded")
    refused(om.patch(f"/api/rules/{old['id']}", {"version": old["version"], "min_length": 20}), 409, "rule_superseded")
    invalid_on(om.post("/api/rules", {"vault_id": v2["id"], "min_length": 15, "effective_on": today.isoformat()}), "effective_on")
    for bad in (7, 65):
        invalid_on(om.post("/api/rules", {"vault_id": v2["id"], "min_length": bad, "effective_on": eff.isoformat()}), "min_length")
    ok(mp.post("/api/rules", {"vault_id": v2["id"], "min_length": 20, "effective_on": eff.isoformat()}), 201)
    refused(om.get(f"{MISSING_RULES}{tok()}"), 404, "not_found")
    draft = draft_rule(om, v["id"], 17, eff + timedelta(days=1))
    invalid_on(om.patch(f"/api/rules/{draft['id']}", {"min_length": 18}), "version")
    invalid_on(mp.post(f"/api/rules/{draft['id']}/sign", {"version": "x"}), "version")
    assert ok(om.get(f"/api/rules/{draft['id']}"), 200).json()["version"] == 1
    actions = [e["action"] for e in audit_about(om, v["id"])]
    assert actions.count("rule_draft") == 3 and actions.count("rule_sign") == 2 and actions.count("rule_edit") == 1


@pytest.mark.timeout(600)
def test_rule_in_force(app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend)
    schedule_rule(om, mp, v["id"], 20, office_today(app_url) + timedelta(days=1))
    ok(om.put(f"/api/credentials/{c['id']}/secret", {"secret": "Ab-123456789"}), 200)
    invalid_on(om.put(f"/api/credentials/{c['id']}/secret", {"secret": "Ab-12345678"}), "secret",
               f"{v['name']} needs at least {NEW_VAULT_MIN} characters.")
    detail = vault_detail(om, v["id"])["vault"]
    assert detail["rule_in_force"]["min_length"] == NEW_VAULT_MIN
    rv = ok(om.post(f"/api/credentials/{c['id']}/reveal", {}), 200).json()
    assert sid(rv["rule_id"]) == sid(detail["rule_in_force"]["id"])
    base = env_url("APP_MIDNIGHT_URL")
    mom = Api(base, "marta")
    banking = vault_named(mom, "Banking")
    rules = ok(mom.get("/api/rules", vault_id=banking["id"]), 200).json()["rules"]
    new_rule = next(r for r in rules if r["min_length"] == 16)
    old_id = next(r["id"] for r in rules
                  if sid(r["id"]) != sid(new_rule["id"]) and r["state"] in ("in_force", "superseded"))
    eff = date.fromisoformat(new_rule["effective_on"])
    portal = seeded_login(mom, "Banking", "Business portal")
    wait_s = (midnight(eff) - server_now(base)).total_seconds()
    if 0 < wait_s <= LIVE_WINDOW_S:
        before = ok(mom.post(f"/api/credentials/{portal['id']}/reveal", {}), 200).json()
        assert sid(before["rule_id"]) == sid(old_id)
        wait_until(lambda: server_now(base) >= midnight(eff), wait_s + 5, "server clock never reached office midnight")
    assert server_now(base) >= midnight(eff), "midnight instance clock is before the rule night and too far to wait"
    wait_until(lambda: vault_named(mom, "Banking")["rule_in_force"]["min_length"] == 16, PUSH_MS / 1000 + 5,
               "Banking rule did not take force at office midnight")
    states = {sid(r["id"]): r["state"] for r in ok(mom.get("/api/rules", vault_id=banking["id"]), 200).json()["rules"]}
    assert states[sid(new_rule["id"])] == "in_force" and states[sid(old_id)] == "superseded"
    after = ok(mom.post(f"/api/credentials/{portal['id']}/reveal", {}), 200).json()
    assert sid(after["rule_id"]) == sid(new_rule["id"])
    invalid_on(mom.put(f"/api/credentials/{portal['id']}/secret", {"secret": "Ab-12345678901"}), "secret",
               "Banking needs at least 16 characters.")


def test_out_of_policy_flag(app_url: str) -> None:
    om = Api(app_url, "marta")
    a = seeded_login(om, "Office", PRINTER)
    b = seeded_login(Api(app_url, "desmond"), "Office", PRINTER)
    keys = ("out_of_policy", "out_of_policy_since", "leeway_ends_at", "rule_id", "health")
    assert {k: a[k] for k in keys} == {k: b[k] for k in keys}
    since = date.fromisoformat(a["out_of_policy_since"])
    assert parse_utc(a["leeway_ends_at"]) == midnight(since + timedelta(days=LEEWAY_DAYS))
    assert sid(a["rule_id"]) == sid(vault_named(om, "Office")["rule_in_force"]["id"])
    mp = Api(app_url, "graham")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend, secret="Ab-1234567890")
    schedule_rule(om, mp, v["id"], 16, office_today(app_url) + timedelta(days=4))
    got = ok(om.get(f"/api/credentials/{c['id']}"), 200).json()
    assert got["out_of_policy"] is False and got["out_of_policy_since"] is None and got["leeway_ends_at"] is None


def test_rule_versions(app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    v = new_vault(om)
    rule = draft_rule(om, v["id"], 20, office_today(app_url) + timedelta(days=6))
    with ThreadPoolExecutor(5) as ex:
        rs = list(ex.map(lambda n: om.patch(f"/api/rules/{rule['id']}", {"version": 1, "min_length": 21 + n}), range(5)))
    assert sorted(r.status_code for r in rs) == [200, 409, 409, 409, 409]
    for r in rs:
        if r.status_code == 409:
            refused(r, 409, "rule_changed", RULE_CHANGED)
    assert [e["action"] for e in audit_about(om, v["id"])].count("rule_edit") == 1
    refused(mp.post(f"/api/rules/{rule['id']}/sign", {"version": 1}), 409, "rule_changed", RULE_CHANGED)
    with ThreadPoolExecutor(4) as ex:
        rs = list(ex.map(lambda _: mp.post(f"/api/rules/{rule['id']}/sign", {"version": 2}), range(4)))
    assert sorted(r.status_code for r in rs) == [200, 409, 409, 409]
    for r in rs:
        if r.status_code == 409:
            refused(r, 409, "not_a_draft")
    assert ok(om.get(f"/api/rules/{rule['id']}"), 200).json()["version"] == 3


def test_wf_rules_sign(browser: Browser, app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    v = new_vault(om)
    eff = office_today(app_url) + timedelta(days=11)
    with desk_page(browser, om, f"/desk/vaults/{v['id']}") as opage:
        click(opage.get_by_role("button", name="New rule"))
        dlg = opage.get_by_role("dialog", name="New rule")
        select(dlg.get_by_role("combobox", name="Vault"), v["name"])
        fill(dlg.get_by_role("spinbutton", name="Minimum length"), "37")
        fill(dlg.get_by_label("Takes force on"), eff.isoformat())
        click(dlg.get_by_role("button", name="Save draft"))
        expect(status(opage)).to_have_text(RULE_DRAFT_SAVED)
        with desk_page(browser, mp, f"/desk/vaults/{v['id']}") as mpage:
            stubs = mpage.get_by_role("list", name="Pending rules")
            mine = stubs.get_by_role("listitem").filter(has_text=draft_stub(37, eff))
            expect(mine).to_have_count(1)
            ostub = opage.get_by_role("list", name="Pending rules").get_by_role("listitem").filter(has_text=draft_stub(37, eff))
            click(ostub.get_by_role("button", name="Edit rule"))
            edit = opage.get_by_role("dialog", name="Edit rule")
            fill(edit.get_by_role("spinbutton", name="Minimum length"), "38")
            click(edit.get_by_role("button", name="Save rule"))
            expect(status(opage)).to_have_text(RULE_DRAFT_SAVED)
            click(mine.get_by_role("button", name="Sign rule"))
            expect(alert(mpage)).to_have_text(RULE_CHANGED)
            fresh = stubs.get_by_role("listitem").filter(has_text=draft_stub(38, eff))
            expect(fresh).to_have_count(1)
            click(fresh.get_by_role("button", name="Sign rule"))
            expect(status(mpage)).to_have_text(f"Rule signed. Takes force 00:00 {offset_at(eff)}, {office_date_text(eff)}.")
            expect(stubs).to_contain_text(takes_force(eff))
    rules = ok(om.get("/api/rules", vault_id=v["id"]), 200).json()["rules"]
    mine_rules = [r for r in rules if r["effective_on"] == eff.isoformat()]
    assert len(mine_rules) == 1 and mine_rules[0]["state"] == "scheduled" and mine_rules[0]["min_length"] == 38
    assert mine_rules[0]["version"] == 3 and mine_rules[0]["signed_by"]


def test_wf_rules_past_date(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    with desk_page(browser, om, "/desk") as page:
        click(page.get_by_role("button", name="New rule"))
        dlg = page.get_by_role("dialog", name="New rule")
        select(dlg.get_by_role("combobox", name="Vault"), v["name"])
        fill(dlg.get_by_role("spinbutton", name="Minimum length"), "20")
        fill(dlg.get_by_label("Takes force on"), office_today(app_url).isoformat())
        click(dlg.get_by_role("button", name="Save draft"))
        expect(dlg).to_contain_text(PICK_LATER)
        expect(dlg.get_by_label("Takes force on")).to_be_focused()
    rules = ok(om.get("/api/rules", vault_id=v["id"]), 200).json()["rules"]
    assert rules == [r for r in rules if r["state"] == "in_force"]


def test_as_of(app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    v, vend = new_vault(om), new_vendor(om)
    new_login(om, v, vend, secret="Ab-1234567890")
    new_login(om, v, vend, secret=f"Sk-{tok()}-{tok()}")
    today = office_today(app_url)
    eff = today + timedelta(days=3)
    rule = schedule_rule(om, mp, v["id"], 16, eff)
    draft_rule(om, v["id"], 30, today + timedelta(days=5))
    before = as_of(om, eff - timedelta(days=1))
    bv = as_of_vault(before, v["id"])
    assert bv["cylinder"] == "pending" and bv["rule_in_force"]["min_length"] == NEW_VAULT_MIN and bv["out_of_policy_count"] == 0
    assert [(s["text"], s["in_force"], sid(s["rule_id"])) for s in bv["stubs"]] == [(takes_force(eff), False, sid(rule["id"]))]
    at = as_of(om, eff)
    av = as_of_vault(at, v["id"])
    assert av["cylinder"] == "in_force" and av["rule_in_force"]["min_length"] == 16
    assert av["rule_in_force"]["effective_on"] == eff.isoformat() and av["out_of_policy_count"] == 1
    assert [(s["text"], s["in_force"]) for s in av["stubs"]] == [(in_force_from(eff), True)]
    assert at["offset"] == offset_at(eff) and parse_utc(at["starts_at"]) == midnight(eff)
    assert at["out_of_policy_count"] == sum(x["out_of_policy_count"] for x in at["vaults"])
    later = as_of_vault(as_of(om, today + timedelta(days=5)), v["id"])
    assert later["out_of_policy_count"] == 1 and all(s["min_length"] != 30 for s in later["stubs"])
    for bad in (today, today + timedelta(days=RULER_NIGHTS + 1)):
        invalid_on(om.get("/api/as-of", night=bad.isoformat()), "night")


def test_night_ruler_keyboard(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    today = office_today(app_url)
    with desk_page(browser, om, "/desk", skew=DEVICE_SKEW) as page:
        expect(page.get_by_role("region", name="Lockset turns at midnight")).to_be_visible()
        slider = page.get_by_role("slider", name="Night ruler")
        slider.focus()
        steps = [("Home", 1), ("End", RULER_NIGHTS), ("ArrowLeft", RULER_NIGHTS - 1), ("ArrowUp", RULER_NIGHTS),
                 ("ArrowDown", RULER_NIGHTS - 1), ("Home", 1), ("ArrowRight", 2)]
        for key, value in steps:
            page.keyboard.press(key)
            wait_until(lambda: slider_value(slider) == str(value), 5, f"{key} did not move the ruler to {value}")
            assert slider_text(slider) == ruler_text(today + timedelta(days=value)), (key, slider_text(slider))


def test_cylinders_follow(browser: Browser, app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    v, vend = new_vault(om), new_vendor(om)
    new_login(om, v, vend, secret="Ab-1234567890")
    today = office_today(app_url)
    k = 13
    eff = today + timedelta(days=k)
    schedule_rule(om, mp, v["id"], 16, eff)
    pending_img = f"{v['name']} lock: rule pending"
    force_img = f"{v['name']} lock: rule in force"
    with desk_page(browser, om, f"/desk/vaults/{v['id']}") as page:
        slider = page.get_by_role("slider", name="Night ruler")
        stubs = page.get_by_role("list", name="Pending rules")
        slider.focus()
        page.keyboard.press("Home")
        expect(page.get_by_role("img", name=pending_img)).to_have_count(1)
        for _ in range(k - 2):
            page.keyboard.press("ArrowRight")
        wait_until(lambda: slider_value(slider) == str(k - 1), 5, "ruler did not reach the night before the rule")
        expect(page.get_by_role("img", name=pending_img)).to_have_count(1)
        hold = Hold(page, f"night={eff.isoformat()}")
        with page.expect_request(lambda r: f"night={eff.isoformat()}" in r.url):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        wait_until(lambda: slider_value(slider) == str(k - 1), 5, "ruler did not move back")
        hold.release()
        expect(page.get_by_role("img", name=pending_img)).to_have_count(1)
        expect(stubs).to_contain_text(takes_force(eff))
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("img", name=force_img)).to_have_count(1)
        expect(stubs).to_contain_text(in_force_from(eff))
        expect(page.get_by_text(f"{as_of(om, eff)['out_of_policy_count']} logins out of policy on this night")).to_be_visible()
        page.keyboard.press("ArrowLeft")
        expect(page.get_by_role("img", name=pending_img)).to_have_count(1)
        expect(stubs).to_contain_text(takes_force(eff))
        prev = eff - timedelta(days=1)
        expect(page.get_by_text(f"{as_of(om, prev)['out_of_policy_count']} logins out of policy on this night")).to_be_visible()


@pytest.mark.timeout(600)
def test_midnight_push() -> None:
    base = env_url("APP_MIDNIGHT_URL")
    om = Api(base, "marta")
    banking = vault_named(om, "Banking")
    rule = next(r for r in ok(om.get("/api/rules", vault_id=banking["id"]), 200).json()["rules"] if r["min_length"] == 16)
    eff = date.fromisoformat(rule["effective_on"])
    wait_s = (midnight(eff) - server_now(base)).total_seconds()
    wait_until(lambda: PREP["cylinder"], max(wait_s, 0) + PUSH_MS / 1000 + SLACK_MS / 1000 + 30,
               f"the drawer opened at collection never announced 'Banking rule now in force.' and turned the Banking cylinder: {PREP['errors']}")
    got = wait_until(lambda: [p for p in PREP["push"] if sid(p["data"].get("vault_id")) == sid(banking["id"])],
                     max(wait_s, 0) + PUSH_MS / 1000 + SLACK_MS / 1000,
                     "no rule-in-force event for Banking reached the early event stream")[0]
    assert got["data"]["name"] == "Banking" and sid(got["data"]["rule_id"]) == sid(rule["id"])
    assert -1 <= (got["server_now"] - midnight(eff)).total_seconds() <= PUSH_MS / 1000 + SLACK_MS / 1000
    wait_until(lambda: [e for e in audit_about(om, banking["id"], eff) if e["action"] == "rule_in_force"],
               PUSH_MS / 1000 + 5, "no rule_in_force entry on the rule's office day")
    entries = audit_about(om, banking["id"], eff)
    rif = [e for e in entries if e["action"] == "rule_in_force"]
    assert len(rif) == 1 and rif[0]["office_time"] == "00:00" and rif[0]["offset"] == offset_at(eff)
    assert len([e for e in entries if e["action"] == "rule_superseded"]) == 1
    assert not [e for e in audit_about(om, banking["id"], eff - timedelta(days=1)) if e["action"] == "rule_in_force"]


def test_wf_night_ruler_scrub(browser: Browser, app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    v, vend = new_vault(om), new_vendor(om)
    new_login(om, v, vend, secret="Ab-1234567890")
    today = office_today(app_url)
    eff = today + timedelta(days=17)
    schedule_rule(om, mp, v["id"], 16, eff)
    with desk_page(browser, om, f"/desk/vaults/{v['id']}", skew=DEVICE_SKEW) as page:
        slider = page.get_by_role("slider", name="Night ruler")
        region = page.get_by_role("region", name="Lockset turns at midnight")
        expect(page.get_by_role("img", name=f"{v['name']} lock: rule pending")).to_have_count(1)
        rb = region.bounding_box()
        x, y = center(slider)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(rb["x"] + rb["width"] - 2, y, steps=12)
        page.mouse.up()
        wait_until(lambda: slider_value(slider) == str(RULER_NIGHTS), 5, "drag right did not reach the last midnight")
        last = today + timedelta(days=RULER_NIGHTS)
        expect(page.get_by_role("img", name=f"{v['name']} lock: rule in force")).to_have_count(1)
        expect(page.get_by_role("list", name="Pending rules")).to_contain_text(in_force_from(eff))
        expect(page.get_by_text(f"{as_of(om, last)['out_of_policy_count']} logins out of policy on this night")).to_be_visible()
        x, y = center(slider)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(rb["x"] + 1, y, steps=12)
        page.mouse.up()
        wait_until(lambda: slider_value(slider) == "1", 5, "drag left did not reach the first midnight")
        expect(page.get_by_role("img", name=f"{v['name']} lock: rule pending")).to_have_count(1)
        expect(page.get_by_role("list", name="Pending rules")).to_contain_text(takes_force(eff))
        first = today + timedelta(days=1)
        expect(page.get_by_text(f"{as_of(om, first)['out_of_policy_count']} logins out of policy on this night")).to_be_visible()


def test_wf_night_ruler_touch(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    today = office_today(app_url)
    with desk_page(browser, om, "/desk", size="768", reduced=True) as page:
        slider = page.get_by_role("slider", name="Night ruler")
        region = page.get_by_role("region", name="Lockset turns at midnight")
        expect(slider).to_be_visible()
        box = slider.bounding_box()
        assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX, box
        rb = region.bounding_box()
        scroll0 = page.evaluate("[scrollX, scrollY]")
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        x, y = center(slider)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for i in range(1, 11):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                                                  "touchPoints": [{"x": x + (rb["x"] + rb["width"] * 0.6 - x) * i / 10, "y": y}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        touched = wait_until(lambda: (lambda val: val if val not in ("", "1", None) else None)(slider_value(slider)), 5,
                             "a touch drag did not move the night ruler")
        assert page.evaluate("[scrollX, scrollY]") == scroll0, "the page scrolled during a handle drag"
        assert slider_text(slider) == ruler_text(today + timedelta(days=int(touched)))
        x, y = center(slider)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(rb["x"] + 1, y, steps=8)
        page.mouse.up()
        wait_until(lambda: slider_value(slider) == "1", 5, "a mouse drag did not move the ruler back")
        x, y = center(slider)
        for kind, px in (("mousePressed", x), ("mouseMoved", rb["x"] + rb["width"] * 0.4), ("mouseReleased", rb["x"] + rb["width"] * 0.4)):
            cdp.send("Input.dispatchMouseEvent", {"type": kind, "x": px, "y": y, "button": "left", "buttons": 1,
                                                  "clickCount": 1, "pointerType": "pen"})
        penned = wait_until(lambda: (lambda val: val if val not in ("", "1", None) else None)(slider_value(slider)), 5,
                            "a pen drag did not move the night ruler")
        assert slider_text(slider) == ruler_text(today + timedelta(days=int(penned)))
        assert page.evaluate("[scrollX, scrollY]") == scroll0


def _next_spring(after: date) -> date:
    for y in (after.year, after.year + 1):
        first = date(y, 3, 1)
        d = first + timedelta(days=(6 - first.weekday()) % 7 + 7)
        if d > after:
            return d
    pytest.fail("no spring-forward Sunday found")


def _next_fall(after: date) -> date:
    for y in (after.year, after.year + 1):
        first = date(y, 11, 1)
        d = first + timedelta(days=(6 - first.weekday()) % 7)
        if d > after:
            return d
    pytest.fail("no fall-back Sunday found")


def test_rotation_dst(app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c1, c2 = new_login(om, v, vend), new_login(om, v, vend)
    today = office_today(app_url)
    spring, fall = _next_spring(today), _next_fall(today)
    r = ok(om.post("/api/rotations", {"credential_id": c1["id"], "interval_days": SPRING_INTERVAL, "at_time": "02:30",
                                      "first_run_on": spring.isoformat()}), 201).json()
    runs = r["next_runs"]
    assert len(runs) == 6
    assert (runs[0]["office_date"], runs[0]["office_time"], runs[0]["offset"], runs[0]["shifted"]) == (spring.isoformat(), "03:00", "CDT", True)
    assert parse_utc(runs[0]["at"]) == datetime.combine(spring, dtime(3, 0), tzinfo=OFFICE_TZ)
    second = spring + timedelta(days=SPRING_INTERVAL)
    assert (runs[1]["office_date"], runs[1]["office_time"], runs[1]["shifted"]) == (second.isoformat(), "02:30", False)
    assert parse_utc(runs[1]["at"]) == datetime.combine(second, dtime(2, 30), tzinfo=OFFICE_TZ)
    assert ok(om.get(f"/api/rotations/{r['id']}"), 200).json()["next_runs"] == runs
    marked = [e for e in calendar_entries(om, f"{spring:%Y-%m}") if sid(e.get("rotation_id")) == sid(r["id"])]
    assert [(e["_day"], e["office_time"], e["shifted"]) for e in marked] == [(spring.isoformat(), "03:00", True)]
    f = ok(om.post("/api/rotations", {"credential_id": c2["id"], "interval_days": FALL_INTERVAL, "at_time": "01:30",
                                      "first_run_on": fall.isoformat()}), 201).json()
    fr = f["next_runs"]
    assert (fr[0]["office_date"], fr[0]["office_time"], fr[0]["offset"], fr[0]["shifted"]) == (fall.isoformat(), "01:30", "CDT", False)
    fall_back_run = datetime.combine(fall, dtime(1, 30), tzinfo=OFFICE_TZ).replace(fold=0)
    assert parse_utc(fr[0]["at"]) == fall_back_run.astimezone(timezone.utc)
    nxt = fall + timedelta(days=FALL_INTERVAL)
    assert (fr[1]["office_date"], fr[1]["office_time"], fr[1]["offset"]) == (nxt.isoformat(), "01:30", "CST")
    once = [e for e in calendar_entries(om, f"{fall:%Y-%m}") if sid(e.get("rotation_id")) == sid(f["id"])]
    assert [e["_day"] for e in once] == [fall.isoformat()]


@pytest.mark.timeout(400)
def test_rotation_states(app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend)
    at = next_office_minute(app_url, lead_s=45)
    run_day = at.date()
    r = ok(om.post("/api/rotations", {"credential_id": c["id"], "interval_days": 30, "at_time": at.strftime("%H:%M"),
                                      "first_run_on": run_day.isoformat()}), 201).json()
    month = f"{run_day:%Y-%m}"

    def entry() -> dict | None:
        mine = [e for e in calendar_entries(om, month) if sid(e.get("rotation_id")) == sid(r["id"]) and e["_day"] == run_day.isoformat()]
        assert len(mine) == 1, mine
        return mine[0]

    assert entry()["state"] == "scheduled" and entry()["turn_id"] is None
    due = wait_until(lambda: (lambda e: e if e["state"] == "due" and e["turn_id"] else None)(entry()),
                     ms_until(app_url, at) / 1000 + 15, "the run never became due at its instant")
    assert due["due_by"] == business_after(run_day, SCOPE_LOSS_BUSINESS_DAYS).isoformat()
    assert ok(om.get(f"/api/credentials/{c['id']}"), 200).json()["next_turn"]["office_date"] == run_day.isoformat()
    assert len([e for e in audit_about(om, c["id"], run_day) if e["action"] == "rotation_due"]) == 1
    ok(om.put(f"/api/credentials/{c['id']}/secret", {"secret": f"Sk-{tok()}-{tok()}"}), 200)
    assert entry()["state"] == "turned"
    cred = ok(om.get(f"/api/credentials/{c['id']}"), 200).json()
    assert cred["last_turned_on"] == office_today(app_url).isoformat()
    assert [sid(h["person_id"]) for h in cred["held_by"]] == [sid(om.person["id"])]
    acts = [e["action"] for e in audit_about(om, c["id"])]
    assert acts.count("rotation_due") == 1 and acts.count("turn_done") == 1
    op = seeded_login(om, "Banking", "Operating account")
    t_day = date.fromisoformat(op["last_turned_on"]) + timedelta(days=SEED_LAST_TURNED_DAYS)
    due_by = t_day - timedelta(days=SEED_OVERDUE_DUE_DAYS)
    seeded = [e for e in calendar_entries(om, f"{due_by:%Y-%m}") if sid(e["credential_id"]) == sid(op["id"]) and e["kind"] == "scope_loss"]
    assert any(e["due_by"] == due_by.isoformat() and e["state"] == "overdue" for e in seeded), seeded


def test_one_rotation_per_login(app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend)
    first = office_today(app_url) + timedelta(days=2)
    body = {"credential_id": c["id"], "interval_days": 30, "at_time": "09:00", "first_run_on": first.isoformat()}
    with ThreadPoolExecutor(5) as ex:
        rs = list(ex.map(lambda _: om.post("/api/rotations", body), range(5)))
    assert sorted(r.status_code for r in rs) == [201, 409, 409, 409, 409]
    for r in rs:
        if r.status_code == 409:
            refused(r, 409, "rotation_exists")
    rid = next(r for r in rs if r.status_code == 201).json()["id"]
    assert [e["action"] for e in audit_about(om, c["id"])].count("rotation_schedule") == 1
    changed = ok(om.patch(f"/api/rotations/{rid}", dict(body, interval_days=7, at_time=SHIFT_TIME)), 200).json()
    assert [r["office_date"] for r in changed["next_runs"][:2]] == [first.isoformat(), (first + timedelta(days=7)).isoformat()]
    assert all(r["office_time"] == SHIFT_TIME for r in changed["next_runs"])
    assert [e["action"] for e in audit_about(om, c["id"])].count("rotation_change") == 1


def test_wf_rotations_schedule(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend)
    run_day = office_today(app_url) + timedelta(days=2)
    with desk_page(browser, om, f"/rotations?month={run_day:%Y-%m}") as page:
        expect(page.get_by_role("heading", level=1, name="Rotation calendar")).to_be_visible()
        click(page.get_by_role("button", name="Schedule rotation"))
        dlg = page.get_by_role("dialog", name="Schedule rotation")
        select(dlg.get_by_role("combobox", name="Login"), f"{c['label']} ({vend['name']})")
        fill(dlg.get_by_role("spinbutton", name="Every (days)"), "30")
        fill(dlg.get_by_label("Office time"), "09:00")
        fill(dlg.get_by_label("First run on"), run_day.isoformat())
        dlg.get_by_role("button", name="Save schedule").dblclick()
        run_at = datetime.combine(run_day, dtime(9, 0), tzinfo=OFFICE_TZ)
        expect(status(page)).to_have_text(f"Rotation scheduled. Next turn {office_stamp(run_at)}.")
        row = page.get_by_role("list", name="Office days").get_by_role("listitem").filter(has_text=office_date_text(run_day))
        expect(row).to_contain_text(c["label"])
    assert [e["action"] for e in audit_about(om, c["id"])].count("rotation_schedule") == 1
    refused(om.post("/api/rotations", {"credential_id": c["id"], "interval_days": 30, "at_time": "09:00",
                                       "first_run_on": run_day.isoformat()}), 409, "rotation_exists")


def test_wf_rotations_moved_run(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    v, vend = new_vault(om), new_vendor(om)
    c = new_login(om, v, vend)
    today = office_today(app_url)
    spring = _next_spring(today)
    ok(om.post("/api/rotations", {"credential_id": c["id"], "interval_days": SPRING_INTERVAL, "at_time": "02:30",
                                  "first_run_on": spring.isoformat()}), 201)
    with desk_page(browser, om, f"/rotations?month={today:%Y-%m}") as page:
        month = today.replace(day=1)
        for _ in range(15):
            if month == spring.replace(day=1):
                break
            click(page.get_by_role("button", name="Next month"))
            month = (month + timedelta(days=32)).replace(day=1)
            expect(page).to_have_url(f"{app_url}/rotations?month={month:%Y-%m}")
        row = page.get_by_role("list", name="Office days").get_by_role("listitem").filter(has_text=office_date_text(spring))
        expect(row).to_contain_text(c["label"])
        expect(row).to_contain_text("Moved from 02:30: the clocks skip that hour.")
        page.reload()
        expect(row).to_contain_text("Moved from 02:30: the clocks skip that hour.")


def test_review_calendar(app_url: str) -> None:
    om = Api(app_url, "marta")
    today = office_today(app_url)
    review = current_review(om)
    q_start = date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
    opened = q_start if q_start.weekday() < 5 else business_after(q_start, 1)
    overdue = business_after(opened, OVERDUE_BUSINESS_DAY - 1)
    assert review["opened_on"] == opened.isoformat() and review["overdue_from"] == overdue.isoformat()
    if review["status"] != "signed_off":
        assert review["status"] == ("overdue" if today >= overdue else "open")
    base = env_url("APP_MIDNIGHT_URL")
    mom = Api(base, "marta")
    mtoday = office_today(base)
    mrev = current_review(mom)
    mq = date(mtoday.year, 3 * ((mtoday.month - 1) // 3) + 1, 1)
    mopened = mq if mq.weekday() < 5 else business_after(mq, 1)
    assert mrev["opened_on"] == mopened.isoformat()
    if mopened > date.fromisoformat(clock(base)["office_date"]) - timedelta(days=2) and mopened.month in (1, 4, 7, 10):
        opens = [e for e in audit(mom, mopened) if e["action"] == "review_open"]
        assert len(opens) == 1 and opens[0]["office_time"] == "00:00"


def test_review_decisions(app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    a, b, vend = new_vault(om), new_vault(om), new_vendor(om)
    lb = new_login(om, b, vend)
    p, h, pw = joiner(om, vault_ids=[a["id"], b["id"]])
    sa = Api(app_url, h, pw)
    review = current_review(om)
    assert review["status"] in ("open", "overdue")
    la, lbn = lines_for(review, p["id"])
    rid = review["id"]
    kept = ok(om.post(f"/api/reviews/{rid}/lines/{la['id']}", {"decision": "keep"}), 200).json()
    assert kept["decision"] == "kept" and kept["decided_via"] == "review"
    refused(om.post(f"/api/reviews/{rid}/lines/{la['id']}", {"decision": "remove"}), 409, "line_decided", LINE_DECIDED)
    refused(sa.post(f"/api/reviews/{rid}/lines/{lbn['id']}", {"decision": "keep"}), 403, "forbidden")
    refused(mp.post(f"/api/reviews/{rid}/lines/{lbn['id']}", {"decision": "keep"}), 403, "forbidden")
    removed = ok(om.post(f"/api/reviews/{rid}/lines/{lbn['id']}", {"decision": "remove"}), 200).json()
    assert removed["decision"] == "removed"
    refused(sa.get(f"/api/vaults/{b['id']}"), 404, "not_found")
    ok(sa.get(f"/api/vaults/{a['id']}"), 200)
    assert any(e["action"] == "turn_due" for e in audit_about(om, lb["id"]))
    q, _, _ = joiner(om, vault_ids=[a["id"]])
    line = lines_for(current_review(om), q["id"])[0]
    with ThreadPoolExecutor(2) as ex:
        rs = list(ex.map(lambda d: om.post(f"/api/reviews/{rid}/lines/{line['id']}", {"decision": d}), ("keep", "remove")))
    assert sorted(r.status_code for r in rs) == [200, 409]
    refused(om.post(f"/api/reviews/{rid}/sign-off", {}), 403, "forbidden")
    if current_review(om)["decided"] < current_review(om)["total"]:
        refused(mp.post(f"/api/reviews/{rid}/sign-off", {}), 409, "lines_undecided", DECIDE_ALL)
    base = env_url("APP_CLOSING_URL")
    com, cmp_ = Api(base, "marta"), Api(base, "graham")
    crev = current_review(com)
    if crev["status"] != "signed_off":
        for ln in crev["lines"]:
            if ln["decision"] == "undecided":
                ok(com.post(f"/api/reviews/{crev['id']}/lines/{ln['id']}", {"decision": "keep"}), 200)
        ok(cmp_.post(f"/api/reviews/{crev['id']}/sign-off", {}), 200)
        assert current_review(com)["status"] == "signed_off"
    refused(cmp_.post(f"/api/reviews/{crev['id']}/sign-off", {}), 409, "review_signed_off")
    refused(com.post(f"/api/reviews/{crev['id']}/lines/{crev['lines'][0]['id']}", {"decision": "remove"}), 409, "review_signed_off")


def test_review_lines_follow_scope(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    a, b = new_vault(om), new_vault(om)
    p, _, _ = joiner(om, vault_ids=[a["id"]])
    review = current_review(om)
    assert review["status"] in ("open", "overdue")
    assert [ln["decision"] for ln in lines_for(review, p["id"])] == ["undecided"]
    with desk_page(browser, om, "/reviews") as page:
        region = page.get_by_role("region", name=f"{review['quarter']} access review")
        progress = region.get_by_role("status", name="Review progress")
        expect(progress).to_have_text(f"{review['decided']} of {review['total']} lines decided")
        link = page.get_by_role("navigation", name="Desk").get_by_role("link", name="Reviews", exact=True)
        link.focus()
        ok(om.patch(f"/api/people/{p['id']}", {"vault_ids": [b["id"]]}), 200)
        after = current_review(om)
        expect(progress).to_have_text(f"{after['decided']} of {after['total']} lines decided", timeout=PUSH_MS + SLACK_MS)
        expect(link).to_be_focused()
    mine = {sid(ln["vault_id"]): ln for ln in lines_for(after, p["id"])}
    closed = mine[sid(a["id"])]
    assert closed["decision"] == "removed" and closed["decided_by"] is None and closed["decided_via"] == "scope_change"
    assert mine[sid(b["id"])]["decision"] == "undecided"
    assert after["total"] == review["total"] + 1 and after["decided"] == review["decided"] + 1
    assert any(e["action"] == "review_line_added" for e in audit(om, office_today(app_url), order="newest", limit=AUDIT_LIMIT_MAX))


def test_wf_access_reviews_keyboard(browser: Browser, app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    a, b = new_vault(om), new_vault(om)
    p, h, pw = joiner(om, vault_ids=[a["id"], b["id"]])
    name = p["full_name"]
    review = current_review(om)
    with desk_page(browser, om, "/reviews") as page:
        region = page.get_by_role("region", name=f"{review['quarter']} access review")
        progress = region.get_by_role("status", name="Review progress")
        page.get_by_role("button", name=f"Keep {name} on {a['name']}").focus()
        page.keyboard.press("Enter")
        r1 = review_at_least(om, review["decided"] + 1)
        expect(status(page)).to_have_text(f"{name} kept on {a['name']}. {r1['decided']} of {r1['total']} lines decided.")
        expect(progress).to_have_text(f"{r1['decided']} of {r1['total']} lines decided")
        expect(page.get_by_role("button", name=f"Keep {name} on {b['name']}")).to_be_focused()
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name=f"Remove {name} from {b['name']}")).to_be_focused()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name=f"Remove {name} from {b['name']}")
        expect(dlg).to_contain_text(f"Their access to {b['name']} ends now.")
        expect(dlg.get_by_role("button", name="Remove access")).to_be_focused()
        page.keyboard.press("Enter")
        r2 = review_at_least(om, r1["decided"] + 1)
        expect(status(page)).to_have_text(f"{name} removed from {b['name']}. {r2['decided']} of {r2['total']} lines decided.")
        expect(progress).to_have_text(f"{r2['decided']} of {r2['total']} lines decided")
        moved = focused_text(page)
        assert moved.startswith("Keep ") or moved == f"{review['quarter']} access review", moved
    refused(Api(app_url, h, pw).get(f"/api/vaults/{b['id']}"), 404, "not_found")
    decisions = {sid(ln["vault_id"]): (ln["decision"], ln["decided_via"]) for ln in lines_for(r2, p["id"])}
    assert decisions == {sid(a["id"]): ("kept", "review"), sid(b["id"]): ("removed", "review")}
    with desk_page(browser, mp, "/reviews", size="768") as page:
        expect(page.get_by_role("heading", level=1, name="Access reviews")).to_be_visible()
        for _ in range(80):
            page.keyboard.press("Tab")
            if focused_text(page) == "Sign off review":
                break
        assert focused_text(page) == "Sign off review", "Tab never reached Sign off review"
        page.keyboard.press("Enter")
        if r2["decided"] < r2["total"]:
            expect(alert(page)).to_have_text(DECIDE_ALL)
        else:
            expect(status(page)).to_have_text("Review signed off.")


def test_wf_access_reviews_remove_dialog(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    a = new_vault(om)
    p, _, _ = joiner(om, vault_ids=[a["id"]])
    label = f"Remove {p['full_name']} from {a['name']}"
    with desk_page(browser, om, "/reviews") as page:
        opener = page.get_by_role("button", name=label)
        opener.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name=label)
        names = [dlg.get_by_role("button", name="Remove access"), dlg.get_by_role("button", name="Cancel")]
        expect(names[0]).to_be_focused()
        for key in ["Tab"] * 5 + ["Shift+Tab"] * 4:
            page.keyboard.press(key)
            assert dlg.evaluate("d => d.contains(document.activeElement)"), f"focus left the dialog after {key}"
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        click(page.get_by_role("dialog", name=label).get_by_role("button", name="Cancel"))
        expect(opener).to_be_focused()
    assert [ln["decision"] for ln in lines_for(current_review(om), p["id"])] == ["undecided"]


def test_billing_from_killbill(app_url: str, killbill: Any) -> None:
    mp = Api(app_url, "graham")
    for _ in range(3):
        before = [s for s in seat_subs(killbill, OFFICE_KEY) if s.get("state") == "ACTIVE" and s.get("planName") == SEAT_PLAN]
        bill = ok(mp.get("/api/billing"), 200).json()
        after = [s for s in seat_subs(killbill, OFFICE_KEY) if s.get("state") == "ACTIVE" and s.get("planName") == SEAT_PLAN]
        if len(before) == len(after):
            break
    assert bill["reachable"] is True and bill["seat_price"] == SEAT_PRICE and bill["currency"] == "USD"
    assert bill["seats"] == len(after)
    earliest = min(s["chargedThroughDate"][:10] for s in after)
    assert bill["next_invoice"]["date"] == earliest and bill["licence_term_ends_on"] == earliest
    n = len([s for s in after if s["chargedThroughDate"][:10] == earliest])
    assert bill["next_invoice"]["amount"] == f"{n * float(SEAT_PRICE):.2f}"
    refused(Api(app_url, "deandra").get("/api/billing"), 403, "forbidden")


def test_one_office(app_url: str, killbill: Any) -> None:
    other = env_url("APP_FEED_DOWN_URL")
    oom = Api(other, "marta")
    p, h, pw = joiner(oom)
    assert len(kc_users(h, "blfd")) == 1
    wait_until(lambda: seat_subs(killbill, "blfd", h), SEAT_WAIT_S, "no seat bundle on the other office's account")
    assert seat_subs(killbill, OFFICE_KEY, h) == []
    om = Api(app_url, "marta")
    refused(Api(app_url).post("/api/sessions", {"username": h, "password": pw}), 401, "bad_credentials", BAD_CREDS)
    assert all(x["handle"] != h for x in people(om))
    bill = ok(om.get("/api/billing"), 200).json()
    mine = [s for s in seat_subs(killbill, OFFICE_KEY) if s.get("state") == "ACTIVE" and s.get("planName") == SEAT_PLAN]
    assert bill["seats"] == len(mine)
    same = ok(om.post("/api/people", joiner_body(h, f"Ada {tok()}", email=f"{h}.x@brannocklyle.example")), 201).json()
    assert same["handle"] == h and len(kc_users(h)) == 1 and len(kc_users(h, "blfd")) == 1


def test_wf_billing_outage(browser: Browser) -> None:
    base = env_url("APP_KILLBILL_DOWN_URL")
    om = Api(base, "marta")
    p, _, _ = joiner(om)
    assert p["seat"] == "waiting_on_billing"
    bill = ok(om.get("/api/billing"), 200).json()
    assert bill["reachable"] is False and bill["seats"] is None and bill["next_invoice"] is None and bill["licence_term_ends_on"] is None
    assert any(sid(w["person_id"]) == sid(p["id"]) and w["change"] == "add" for w in bill["waiting"])
    assert any(e["action"] == "seat_waiting" for e in audit_about(om, p["id"]))
    with desk_page(browser, om, "/billing") as page:
        expect(page.get_by_role("alert").filter(has_text=BILLING_DOWN)).to_have_count(1)
        waiting = page.get_by_role("list", name="Waiting on billing")
        item = waiting.get_by_role("listitem").filter(has_text=p["full_name"])
        expect(item).to_contain_text("Waiting on billing")
        page.goto(base + "/people")
        expect(page.get_by_role("alert").filter(has_text=BILLING_DOWN)).to_have_count(1)
        row = page.get_by_role("table", name="People").get_by_role("row").filter(has_text=p["full_name"])
        expect(row).to_contain_text("Waiting on billing")
    assert person(om, p["id"])["seat"] == "waiting_on_billing"


def test_wf_billing_tablet(browser: Browser, app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    bill = ok(mp.get("/api/billing"), 200).json()
    with desk_page(browser, mp, "/billing", size="768") as page:
        expect(page.get_by_role("heading", level=1, name="Billing")).to_be_visible()
        expect(page.get_by_text(bill["next_invoice"]["amount"])).not_to_have_count(0)
        expect(page.get_by_text(office_date_text(date.fromisoformat(bill["licence_term_ends_on"])))).not_to_have_count(0)
        expect(page.get_by_text(re.compile(rf"(^|\D){bill['seats']}(\D|$)"))).not_to_have_count(0)
        page.evaluate("window.__probe = 1")
        p, _, _ = joiner(om)
        wait_until(lambda: person(om, p["id"])["seat"] == "confirmed", SEAT_WAIT_S, "seat never confirmed")
        new = ok(mp.get("/api/billing"), 200).json()
        assert new["seats"] == bill["seats"] + 1
        expect(page.get_by_text(re.compile(rf"(^|\D){new['seats']}(\D|$)"))).not_to_have_count(0, timeout=PUSH_MS + SLACK_MS)
        expect(page.get_by_text(new["next_invoice"]["amount"])).not_to_have_count(0, timeout=PUSH_MS + SLACK_MS)
        assert page.evaluate("window.__probe") == 1, "the Billing page reloaded"
        layout(page)


def test_breach_range(app_url: str, wiremock: Any) -> None:
    om = Api(app_url, "marta")
    v, vend, vend2 = new_vault(om), new_vendor(om), new_vendor(om)
    s1, s2 = f"Ex-{tok()}-{tok()}", f"Pd-{tok()}-{tok()}"
    c1, c2 = new_login(om, v, vend, secret=s1), new_login(om, v, vend, secret=s2)
    c3 = new_login(om, v, vend2)
    h1, h2 = hashlib.sha1(s1.encode()).hexdigest().upper(), hashlib.sha1(s2.encode()).hexdigest().upper()
    wiremock.stub("GET", f"/v1/range/{h1[:5]}", json={"results": [{"suffix": h1[5:].lower(), "count": 5}, PADDING_ROW]})
    wiremock.stub("GET", f"/v1/range/{h2[:5]}", json={"results": [{"suffix": h2[5:], "count": 0}, PADDING_ROW]})
    wiremock.stub("GET", "/v1/breached-domains", json={"domains": [BREACHED_BASELINE, dict(BREACHED_BASELINE, domain=vend2["domain"])]})
    report = ok(om.post("/api/health-report/checks", {}), 200).json()
    health = {sid(c["id"]): c["health"] for c in report["credentials"]}
    assert health.get(sid(c1["id"])) == "exposed" and health.get(sid(c3["id"])) == "vendor_breached"
    assert sid(c2["id"]) not in health and ok(om.get(f"/api/credentials/{c2['id']}"), 200).json()["health"] == "sound"
    assert health.get(sid(seeded_login(om, "Office", PRINTER)["id"])) == "exposed"
    assert health.get(sid(seeded_login(om, "Hosting", "Website host")["id"])) == "vendor_breached"
    ranged = wiremock.requests(f"/v1/range/{h1[:5]}")
    assert ranged and all(header_value(r, "Add-Padding") == "true" for r in ranged)
    journal = json.dumps(wiremock.requests())
    for leak in (h1, h1[5:], h1[5:].lower(), s1, h2[5:], s2):
        assert leak not in journal, "a full hash, suffix or secret reached the breach feed"


def test_health_report_daily(app_url: str) -> None:
    om = Api(app_url, "marta")
    ok(om.post("/api/health-report/checks", {}), 200)
    today = office_today(app_url)
    r = ok(om.get("/api/health-report"), 200).json()
    assert r["office_date"] == today.isoformat() and r["last_good_check_at"]
    creds = r["credentials"]
    assert all(c["health"] != "sound" for c in creds)
    assert r["counts"]["exposed"] == len([c for c in creds if c["health"] == "exposed"])
    assert r["counts"]["vendor_breached"] == len([c for c in creds if c["health"] == "vendor_breached"])
    assert r["counts"]["out_of_policy"] >= len([c for c in creds if c["out_of_policy"]])
    assert parse_utc(r["last_good_check_at"]).astimezone(OFFICE_TZ).date() == today
    past = ok(om.get("/api/health-report", day=(today - timedelta(days=1)).isoformat()), 200).json()
    assert past["office_date"] == (today - timedelta(days=1)).isoformat()
    empty = ok(om.get("/api/health-report", day="2020-01-01"), 200).json()
    assert empty["last_good_check_at"] is None and empty["credentials"] == []
    assert empty["counts"] == {"exposed": 0, "vendor_breached": 0, "out_of_policy": 0, "turns_due": 0, "turns_overdue": 0}
    invalid_on(om.get("/api/health-report", day=(today + timedelta(days=1)).isoformat()), "day")
    invalid_on(om.get("/api/health-report", day="2026-02-30"), "day")
    refused(Api(app_url, "deandra").get("/api/health-report"), 403, "forbidden")


def test_feed_outage_recovery(app_url: str, wiremock: Any) -> None:
    om = Api(app_url, "marta")
    good = ok(om.post("/api/health-report/checks", {}), 200).json()["last_good_check_at"]
    wiremock.fault("GET", "/v1/breached-domains")
    r = om.post("/api/health-report/checks", {})
    last = ok(om.get("/api/health-report"), 200).json()
    refused(r, 503, "breach_feed_unreachable", FEED_DOWN_LAST.format(office_stamp(parse_utc(last["last_good_check_at"]))))
    assert last["feed"] == "unreachable" and parse_utc(last["last_good_check_at"]) >= parse_utc(good)
    wiremock.stub("GET", "/v1/breached-domains", json={"domains": [BREACHED_BASELINE]})
    back = ok(om.post("/api/health-report/checks", {}), 200).json()
    assert back["feed"] == "ok" and parse_utc(back["last_good_check_at"]) > parse_utc(good)
    down = Api(env_url("APP_FEED_DOWN_URL"), "marta")
    refused(down.post("/api/health-report/checks", {}), 503, "breach_feed_unreachable", FEED_DOWN_NONE)
    rep = ok(down.get("/api/health-report"), 200).json()
    assert rep["feed"] == "unreachable" and rep["last_good_check_at"] is None


def test_wf_health_check(browser: Browser, app_url: str, wiremock: Any) -> None:
    om = Api(app_url, "marta")
    today = office_today(app_url)
    with desk_page(browser, om, "/health") as page:
        expect(page.get_by_role("heading", level=1, name="Health report")).to_be_visible()
        expect(page.get_by_text(f"Report for {office_date_text(today)} ({OFFICE_TZ_NAME})")).to_be_visible()
        with held(page, "**/api/health-report/checks") as hold:
            click(page.get_by_role("button", name="Check now"))
            expect(page.get_by_role("button", name="Checking the breach feed")).to_be_visible()
            hold.release()
        expect(status(page)).to_have_text(re.compile(r"^Breach check finished at .+\.$"))
        stamp = office_stamp(parse_utc(ok(om.get("/api/health-report"), 200).json()["last_good_check_at"]))
        expect(status(page)).to_have_text(f"Breach check finished at {stamp}.")
        wiremock.fault("GET", "/v1/breached-domains")
        click(page.get_by_role("button", name="Check now"))
        band = page.get_by_role("alert").filter(has_text=FEED_DOWN_LAST.format(
            office_stamp(parse_utc(ok(om.get("/api/health-report"), 200).json()["last_good_check_at"]))))
        expect(band).to_have_count(1)
        wiremock.stub("GET", "/v1/breached-domains", json={"domains": [BREACHED_BASELINE]})
        click(page.get_by_role("button", name="Check now"))
        expect(status(page)).to_have_text(re.compile(r"^Breach check finished at .+\.$"))
        expect(page.get_by_role("alert").filter(has_text="The breach feed can't be reached.")).to_have_count(0)
    assert ok(om.get("/api/health-report"), 200).json()["feed"] == "ok"


def test_wf_health_latest_day(browser: Browser, app_url: str, wiremock: Any) -> None:
    om = Api(app_url, "marta")
    today = office_today(app_url)
    d1, d2 = today - timedelta(days=3), today - timedelta(days=1)
    with desk_page(browser, om, "/health") as page:
        expect(page.get_by_role("heading", level=1, name="Health report")).to_be_visible()
        hold = Hold(page, f"day={d1.isoformat()}")
        field = page.get_by_label("Office day")
        with page.expect_request(lambda r: f"day={d1.isoformat()}" in r.url):
            fill(field, d1.isoformat())
        fill(field, d2.isoformat())
        line = f"Report for {office_date_text(d2)} ({OFFICE_TZ_NAME})"
        expect(page.get_by_text(line)).to_be_visible()
        hold.release()
        expect(page.get_by_text(line)).to_be_visible()
        expect(page.get_by_text(f"Report for {office_date_text(d1)} ({OFFICE_TZ_NAME})")).to_have_count(0)
    wiremock.stub("GET", "/v1/breached-domains", json={"domains": [BREACHED_BASELINE]}, delay_ms=2000)
    with ThreadPoolExecutor(2) as ex:
        rs = list(ex.map(lambda _: om.post("/api/health-report/checks", {}), range(2)))
    a, b = (ok(r, 200).json() for r in rs)
    assert a["last_good_check_at"] == b["last_good_check_at"], "overlapping checks ran separately"


def test_import_matching(app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    d = [f"r{tok()}.example" for _ in range(5)]
    stranger = f"Zed{tok()} Quill"
    rows = [f"{v['name']},Row one,https://www.{d[0]},u1,Pw-{tok()},deandra.okafor@brannocklyle.example,3/2/2026",
            f"{v['name'].lower()},Row two,{d[1]},u2,Pw-{tok()},  deandra   OKAFOR ,1/15/2026",
            f"{v['name']},Row three,{d[2]},u3,Pw-{tok()},Dee,",
            f"{v['name']},Row four,{d[3]},u4,Pw-{tok()},Theo; Priya Raman / Dee,6/30/2026",
            f"{v['name']},Row five,{d[4]},u5,Pw-{tok()},{stranger},"]
    body = ok(import_file(om, csv_bytes(rows)), 201).json()
    assert body["counts"] == {"created": 4, "matched": 0, "held": 1, "rejected": 0}
    by_row = {r["row"]: r for r in body["rows"]}
    ids = {h: sid(seeded_person(om, h)["id"]) for h in ("deandra", "theo", "priya")}
    assert [(n["match"], sid(n["person_id"])) for n in by_row[1]["names"]] == [("email", ids["deandra"])]
    assert [(n["match"], sid(n["person_id"])) for n in by_row[2]["names"]] == [("full_name", ids["deandra"])]
    assert [(n["match"], sid(n["person_id"])) for n in by_row[3]["names"]] == [("alias", ids["deandra"])]
    assert [n["match"] for n in by_row[4]["names"]] == ["alias", "full_name", "alias"]
    assert by_row[5]["outcome"] == "held" and by_row[5]["names"][0]["held"] == "no_match"
    creds = {c["label"]: c for c in vault_detail(om, v["id"])["credentials"]}
    assert set(creds) == {"Row one", "Row two", "Row three", "Row four"}
    assert {sid(h["person_id"]) for h in creds["Row four"]["held_by"]} == {ids["theo"], ids["priya"], ids["deandra"]}
    assert creds["Row one"]["vendor"]["domain"] == d[0] and creds["Row one"]["last_turned_on"] == date(2026, 3, 2).isoformat()
    assert creds["Row three"]["last_turned_on"] == office_today(app_url).isoformat()
    vend = next(x for x in ok(om.get("/api/vendors"), 200).json()["vendors"] if x["domain"] == d[0])
    assert vend["name"] == d[0]
    assert all(stranger.lower() not in x["full_name"].lower() for x in people(om))


def test_held_rows(app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    rows = [f"{v['name']},Held one,h{tok()}.example,h1,Pw-{tok()},D. Okafor,",
            f'{v["name"]},Held two,h{tok()}.example,h2,Pw-{tok()},"Okafor, D.",',
            f"{v['name']},Held three,h{tok()}.example,h3,Pw-{tok()},Sam,"]
    body = ok(import_file(om, csv_bytes(rows)), 201).json()
    assert body["counts"]["held"] == 3 and vault_detail(om, v["id"])["credentials"] == []
    by_row = {r["row"]: r for r in body["rows"]}
    names = lambda r: [c["full_name"] for c in by_row[r]["names"][0]["candidates"]]
    assert by_row[1]["names"][0]["held"] == "no_match" and names(1) == ["Deandra Okafor", "Desmond Okafor"]
    assert by_row[2]["names"][0]["text"] == "Okafor, D." and names(2) == ["Deandra Okafor", "Desmond Okafor"]
    assert by_row[3]["names"][0]["held"] == "ambiguous" and names(3) == ["Sam Whitfield", "Samantha Lyle"]
    dee, theo = seeded_person(om, "deandra")["id"], seeded_person(om, "theo")["id"]
    iid = body["id"]
    invalid_on(om.post(f"/api/imports/{iid}/rows/2/choice", {"text": "Okafor, D.", "person_id": theo}), "person_id")
    invalid_on(om.post(f"/api/imports/{iid}/rows/2/choice", {"text": "Somebody", "person_id": dee}), "text")
    row1 = ok(om.post(f"/api/imports/{iid}/rows/1/choice", {"text": "D. Okafor", "person_id": dee}), 200).json()
    assert row1["outcome"] == "created"
    row3 = ok(om.post(f"/api/imports/{iid}/rows/3/choice", {"text": "Sam", "person_id": None}), 200).json()
    assert row3["outcome"] == "created"
    refused(om.post(f"/api/imports/{iid}/rows/3/choice", {"text": "Sam", "person_id": None}), 409, "row_not_held")
    creds = {c["label"]: c for c in vault_detail(om, v["id"])["credentials"]}
    assert set(creds) == {"Held one", "Held three"}
    assert [sid(h["person_id"]) for h in creds["Held one"]["held_by"]] == [sid(dee)] and creds["Held three"]["held_by"] == []
    again = ok(om.get(f"/api/imports/{iid}"), 200).json()
    assert {r["row"]: r["outcome"] for r in again["rows"]} == {1: "created", 2: "held", 3: "created"}


def test_reimport(app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    dom = f"re{tok()}.example"
    rows = [f"{v['name']},Again one,{dom},a1,Pw-{tok()},Dee,", f"{v['name']},Again two,{dom},a2,Pw-{tok()},Theo,",
            f"Nowhere{tok()},X,{dom},a3,Pw-{tok()},Dee,"]
    first = ok(import_file(om, csv_bytes(rows)), 201).json()
    assert first["counts"] == {"created": 2, "matched": 0, "held": 0, "rejected": 1}
    for data in (csv_bytes(rows), csv_bytes(rows, bom=False, crlf=False)):
        again = ok(import_file(om, data), 201).json()
        assert again["counts"] == {"created": 0, "matched": 2, "held": 0, "rejected": 1}
        assert all(r["names"] == [] for r in again["rows"] if r["outcome"] == "matched")
    assert len(vault_detail(om, v["id"])["credentials"]) == 2
    assert [x["domain"] for x in ok(om.get("/api/vendors"), 200).json()["vendors"]].count(dom) == 1
    v2 = new_vault(om)
    data = csv_bytes([f"{v2['name']},Race {i},race{tok()}.example,r{i},Pw-{tok()},Dee," for i in range(4)])
    with ThreadPoolExecutor(2) as ex:
        rs = list(ex.map(lambda _: import_file(om, data), range(2)))
    assert all(r.status_code == 201 for r in rs)
    assert len(vault_detail(om, v2["id"])["credentials"]) == 4


def test_import_bytes(app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    raw = (f'\ufeff{IMPORT_HEADER}\r\n{v["name"]},"Wi-Fi, ""guest""",q{tok()}.example,"{MULTI}",Pw-{tok()},Dee,\r\n'
           f'\r\n,,,,,,\r\n{v["name"]},{ROW_LAST},q{tok()}.example,last,Pw-{tok()},Dee,').encode("utf-8")
    body = ok(import_file(om, raw, filename=LEGACY_PATH), 201).json()
    assert body["filename"] == LEGACY_NAME
    assert [r["row"] for r in body["rows"]] == [1, 2] and body["counts"]["created"] == 2
    creds = {c["label"]: c for c in vault_detail(om, v["id"])["credentials"]}
    assert creds['Wi-Fi, "guest"']["username"] == MULTI and ROW_LAST in creds
    assert ok(import_file(om, csv_bytes([]), filename="C:/Office/old.csv"), 201).json()["filename"] == "old.csv"
    bad = csv_bytes([f"{v['name']},Caf\u00e9,q{tok()}.example,c,Pw-{tok()},Dee,"]).replace("\u00e9".encode(), b"\x96")
    invalid_on(import_file(om, bad), "file_base64", MSG_NOT_UTF8)
    invalid_on(import_file(om, csv_bytes([]) + b"\x00"), "file_base64", MSG_NOT_UTF8)
    invalid_on(import_file(om, b"Vault;Login for\r\n"), "file_base64", MSG_HEADER)
    enc = base64.b64encode(csv_bytes([])).decode()
    spaced = enc[:8] + " " + enc[8:]
    invalid_on(om.post("/api/imports", {"filename": "a.csv", "file_base64": spaced}), "file_base64", MSG_UNREADABLE)
    many = csv_bytes([f"{v['name']},N{i},q.example,n{i},p," for i in range(IMPORT_MAX_ROWS + 1)])
    invalid_on(import_file(om, many), "file_base64", MSG_TOO_MANY)
    invalid_on(import_file(om, csv_bytes([]), filename="C:\\Office\\"), "filename", MSG_FILENAME)
    invalid_on(import_file(om, csv_bytes([]), filename="x" * 121), "filename", MSG_FILENAME)
    assert len(vault_detail(om, v["id"])["credentials"]) == 2


def test_import_no_secret_echo(app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    d = f"n{tok()}.example"
    marks = [f"Mk{tok()}cell" for _ in range(8)]
    rows = [f"Nowhere{tok()},a,{marks[0]}",
            f"{v['name']},Label,{d},user,{marks[1]},Dee",
            f"{v['name']},,{d},user,{marks[2] + 'P' * 128},Dee,",
            f"{v['name']},,{d},user,{marks[3]},Dee,",
            f"{v['name']},Label,http://,user,{marks[4]},Dee,",
            f"{v['name']},Label,{d},,{marks[5]},Dee,",
            f"{v['name']},Label,{d},user,{marks[6]},Dee,13/45/2026",
            f"{v['name']},Fine,{d},fine,{marks[7]},Dee,"]
    top = ok(om.get("/api/audit", order="newest", limit=1), 200).json()["entries"]
    floor = top[0]["seq"] if top else 0
    r = ok(import_file(om, csv_bytes(rows)), 201)
    body = r.json()
    assert [(x["row"], x["reason"]) for x in body["rows"] if x["outcome"] == "rejected"] == list(enumerate(REASONS, 1))
    assert all(m not in r.text for m in marks)
    entries = [e for e in audit(om, office_today(app_url), order="newest", max_pages=1)
               if e["seq"] > floor and e["action"] == "import_row"]
    assert len(entries) == len(rows)
    assert all(set(e["details"]) == {"row", "outcome", "reason"} for e in entries)
    assert all(m not in json.dumps(entries) for m in marks)
    err = import_file(om, f"Wrong,{marks[0]}\r\n".encode())
    refused(err, 422, "invalid")
    assert marks[0] not in err.text
    for m in marks:
        assert pg_hits(m) == 0, "a Password cell is stored in plain text"


def test_wf_legacy_import_upload(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    held_label = f"Tax {tok()}"
    rows = [f"{v['name']},Plain {tok()},w{tok()}.example,p1,Pw-{tok()},Dee,3/2/2026",
            f"{v['name']},{held_label},w{tok()}.example,p2,Pw-{tok()},D. Okafor,1/15/2026",
            f"Archive{tok()},Old fax portal,faxly.example,bl-fax,fax12345,Marta,"]
    data = csv_bytes(rows)
    with desk_page(browser, om, "/import") as page:
        expect(page.get_by_role("heading", level=1, name="Import a spreadsheet")).to_be_visible()
        page.get_by_label("Spreadsheet file").set_input_files({"name": LEGACY_NAME, "mimeType": "text/csv", "buffer": data})
        with page.expect_request(lambda r: r.url.endswith("/api/imports") and r.method == "POST") as req:
            click(page.get_by_role("button", name="Import rows"))
        sent = json.loads(req.value.post_data)
        assert base64.b64decode(sent["file_base64"]) == data, "the page did not send the file's bytes as read"
        expect(status(page)).to_have_text("1 filed, 0 already on file, 1 held for your choice, 1 rejected.")
        expect(page.get_by_text(LEGACY_NAME)).not_to_have_count(0)
        table = page.get_by_role("table", name="Import rows")
        expect(table).to_contain_text("Held for your choice")
        expect(table).to_contain_text("Unknown vault")
        select(page.get_by_role("combobox", name="Who is D. Okafor?"), "Deandra Okafor")
        click(page.get_by_role("button", name="Save choice"))
        expect(status(page)).to_have_text(CHOICE_SAVED)
    creds = {c["label"]: c for c in vault_detail(om, v["id"])["credentials"]}
    assert [sid(h["person_id"]) for h in creds[held_label]["held_by"]] == [sid(seeded_person(om, "deandra")["id"])]


def test_wf_legacy_import_bad_file(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    v = new_vault(om)
    data = csv_bytes([f"{v['name']},Caf\u00e9,w{tok()}.example,c,Pw-{tok()},Dee,"]).replace("\u00e9".encode(), b"\x96")
    with desk_page(browser, om, "/import") as page:
        page.get_by_label("Spreadsheet file").set_input_files({"name": LEGACY_NAME, "mimeType": "text/csv", "buffer": data})
        click(page.get_by_role("button", name="Import rows"))
        expect(alert(page)).to_have_text(CHECK_FIELDS)
        expect(page.get_by_text(MSG_NOT_UTF8)).to_be_visible()
    assert vault_detail(om, v["id"])["credentials"] == []


DESK_HEADINGS = {"/rotations": "Rotation calendar", "/reviews": "Access reviews", "/people": "People",
                 "/billing": "Billing", "/health": "Health report", "/import": "Import a spreadsheet", "/audit": "Audit trail"}


@pytest.mark.parametrize("size", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_published_layouts(browser: Browser, app_url: str, size: str) -> None:
    om = Api(app_url, "marta")
    with desk_page(browser, om, "/desk", size=size) as page:
        tablist = page.get_by_role("tablist", name="Vaults")
        expect(tablist).to_be_visible()
        layout(page)
        ruler = page.get_by_role("region", name="Lockset turns at midnight").bounding_box()
        pending = page.get_by_role("region", name="Pending rules").bounding_box()
        tabs = tablist.bounding_box()
        panel = page.get_by_role("tabpanel").bounding_box()
        if size == "1280":
            assert pending["x"] >= tabs["x"] + tabs["width"] - GEOMETRY_TOLERANCE_PX
            assert abs(pending["y"] - tabs["y"]) <= GEOMETRY_TOLERANCE_PX
            assert ruler["y"] >= tabs["y"] and ruler["x"] < pending["x"]
            page.evaluate("scrollTo(0, 300)")
            assert abs(page.get_by_role("region", name="Pending rules").bounding_box()["y"] - pending["y"]) <= GEOMETRY_TOLERANCE_PX
        else:
            assert ruler["y"] < pending["y"] < tabs["y"] < panel["y"]
        for path, heading in DESK_HEADINGS.items():
            page.goto(app_url + path)
            expect(page.get_by_role("heading", level=1, name=heading)).to_be_visible()
            layout(page)
    _, h, pw = joiner(om, vault_ids=[vaults(om)[0]["id"]])
    with desk_page(browser, Api(app_url, h, pw), "/desk", size=size) as page:
        expect(page.get_by_role("tablist", name="Vaults")).to_be_visible()
        expect(page.get_by_role("region", name="Pending rules")).to_have_count(0)
        layout(page)
        page.goto(app_url + "/billing")
        expect(page.get_by_role("heading", name=NOT_FOUND_HEADING)).to_be_visible()
        expect(page.get_by_role("link", name="Drawer")).not_to_have_count(0)


def test_motion_reduced(browser: Browser, app_url: str) -> None:
    om, mp = Api(app_url, "marta"), Api(app_url, "graham")
    v = new_vault(om)
    schedule_rule(om, mp, v["id"], 16, office_today(app_url) + timedelta(days=23))
    for reduced in (False, True):
        with desk_page(browser, om, f"/desk/vaults/{v['id']}", reduced=reduced) as page:
            tablist = page.get_by_role("tablist", name="Vaults")
            expect(page.get_by_role("img", name=f"{v['name']} lock: rule pending")).to_have_count(1)
            settled = animations(tablist)
            assert all(a.get("iterations") not in (float("inf"), "Infinity") for a in settled), settled
            slider = page.get_by_role("slider", name="Night ruler")
            slider.focus()
            page.keyboard.press("End")
            turned = page.get_by_role("img", name=f"{v['name']} lock: rule in force")
            expect(turned).to_have_count(1)
            running = animations(turned)
            if reduced:
                assert running == [], f"reduced motion still animates the cylinder: {running}"
            else:
                assert running, "the cylinder changed state without a turn"


def test_keyboard_announcements(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    payroll = vaults(om)[0]
    with desk_page(browser, om, f"/desk/vaults/{payroll['id']}") as page:
        expect(page.get_by_role("tablist", name="Vaults")).to_be_visible()
        names = tab_order(page, 60)
        order = ["Drawer", "Sign out", "Night ruler", "New rule", payroll["name"], "New vault"]
        idx = [next((i for i, n in enumerate(names) if n == want), -1) for want in order]
        assert -1 not in idx and idx == sorted(idx), (names, idx)
        page.get_by_role("button", name="New vault").focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="New vault")
        expect(dlg.get_by_label("Vault name")).to_be_focused()
        for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(key)
            assert dlg.evaluate("d => d.contains(document.activeElement)"), f"focus left the dialog after {key}"
        page.keyboard.press("Escape")
        expect(dlg).to_have_count(0)
        expect(page.get_by_role("button", name="New vault")).to_be_focused()
        axe(page)


def test_health_boot_boundary(app_url: str) -> None:
    for url in (app_url, env_url("APP_KILLBILL_DOWN_URL"), env_url("APP_FEED_DOWN_URL")):
        r = ok(httpx.get(url + "/api/health", timeout=HTTP_TIMEOUT_S), 200)
        assert r.json() == {"status": "ok"}
    om = Api(app_url, "marta")
    name = f"Vault {tok()}"
    refused(om.post("/api/vaults", {"name": name, "off_when_travelling": False}, headers={"Origin": "http://evil.example"}),
            403, "cross_origin")
    assert all(x["name"] != name for x in vaults(om))

    def sized(total: int) -> bytes:
        shell = json.dumps({"name": "", "off_when_travelling": False}, separators=(",", ":")).encode()
        return json.dumps({"name": "x" * (total - len(shell)), "off_when_travelling": False}, separators=(",", ":")).encode()

    hdr = {"Content-Type": JSON_TYPE}
    assert len(sized(BODY_LIMIT)) == BODY_LIMIT
    invalid_on(om.http.post("/api/vaults", content=sized(BODY_LIMIT), headers=hdr), "name")
    refused(om.http.post("/api/vaults", content=sized(BODY_LIMIT + 1), headers=hdr), 413, "too_large")
    refused(om.http.post("/api/vaults", content=sized(BODY_LIMIT + 1), headers=dict(hdr, Origin="http://evil.example")),
            403, "cross_origin")
    shell = len(json.dumps({"filename": "", "file_base64": ""}, separators=(",", ":")))
    b64 = (IMPORT_BODY_LIMIT - shell - 1) // 4 * 4
    fname = "f" * (IMPORT_BODY_LIMIT - shell - b64)
    exact = json.dumps({"filename": fname, "file_base64": "A" * b64}, separators=(",", ":")).encode()
    assert len(exact) == IMPORT_BODY_LIMIT
    assert om.http.post("/api/imports", content=exact, headers=hdr).status_code == 422
    over = json.dumps({"filename": fname + "f", "file_base64": "A" * b64}, separators=(",", ":")).encode()
    refused(om.http.post("/api/imports", content=over, headers=hdr), 413, "too_large")
    refused(om.http.post("/api/vaults", content=b"name=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    nf = refused(om.get(UNKNOWN_API), 404, "not_found")
    assert set(nf) <= {"code", "message"}
    for path, marker in (("/run.json", "run-manifest-v1"), ("/package-lock.json", "lockfileVersion"),
                         ("/.env", "DATABASE_URL"), ("/package.json", '"dependencies"')):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S)
        assert marker not in r.text, f"{path} is served"


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
APP_DIR = Path(os.sep) / "app"


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_notices() -> None:
    text = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    assert "Funnel Display" in text and "Funnel Sans" in text


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad
    assert "OFL-1.1" in (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_postgres_only() -> None:
    assert Postgres().tables()
    stores = {"sqlite3", "better-sqlite3", "ioredis", "redis", "lowdb", "nedb", "level", "lmdb"}
    manifest = json.loads((APP_DIR / "package.json").read_text()) if (APP_DIR / "package.json").is_file() else {}
    declared = sorted(stores.intersection(manifest.get("dependencies") or {}))
    assert not declared, declared
    sources = [p for p in APP_DIR.rglob("*") if p.suffix in (".ts", ".tsx", ".js", ".mjs", ".cjs")
               and "node_modules" not in p.parts and not p.name.endswith(".d.ts")]
    used = sorted({f"{p.relative_to(APP_DIR)}: {name}" for p in sources for name in stores
                   if re.search(r"""(?:require\(|from\s*)['"]""" + re.escape(name) + r"""['"]""",
                                p.read_text(errors="ignore"))})
    assert not used, used
    files = [p for p in APP_DIR.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not files, files


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    om = Api(app_url, "marta")
    seen: list[str] = []
    with desk_page(browser, om, "/") as page:
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        expect(page.get_by_role("heading", level=1, name="KEYS KEPT HERE")).to_be_visible()
        page.goto(app_url + "/desk")
        expect(page.get_by_role("tablist", name="Vaults")).to_be_visible()
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_typescript_lockfile() -> None:
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    assert lock.get("lockfileVersion")
    ts = [p for p in APP_DIR.rglob("*.ts") if "node_modules" not in p.parts and not p.name.endswith(".d.ts")]
    assert ts, "no TypeScript source under /app"


def test_if_services_untouched() -> None:
    trajectory = Path(os.sep) / "logs" / "agent" / "trajectory.json"
    if not trajectory.is_file():
        return
    text = trajectory.read_text()
    write_marker = re.compile(r"-X\s*(PUT|POST)|kcadm\S*\s+update|\.put\(|\bPUT\b")
    writes = [m.start() for m in re.finditer(BRUTE_KEY, text) if write_marker.search(text[max(0, m.start() - 300):m.start() + 100])]
    assert not writes, "the trajectory writes Keycloak brute-force settings"


PREP_STREAM_S = 900
PREP_SIGNIN_S = 240
PREP: dict[str, Any] = {"push": [], "ended": [], "closing": None, "evening": None, "errors": [], "cylinder": False}


def evening_prep() -> dict[str, Any]:
    return wait_until(lambda: PREP["evening"], 120, "the evening-instance preparation never finished")


def _sign_in_retry(base: str, handle: str) -> tuple[Api, datetime]:
    deadline = time.monotonic() + PREP_SIGNIN_S
    while time.monotonic() < deadline:
        started = server_now(base)
        try:
            return Api(base, handle), started
        except Exception:
            threading.Event().wait(POLL_S)
    raise RuntimeError(f"sign-in for {handle} never succeeded")


def _prep_midnight_page(base: str) -> None:
    try:
        from playwright.sync_api import sync_playwright
        api, _ = _sign_in_retry(base, "marta")
        with sync_playwright() as pw:
            chrome = pw.chromium.launch()
            try:
                ctx = chrome.new_context(viewport={"width": 1280, "height": 800})
                ctx.add_cookies([{"name": COOKIE, "value": api.http.cookies.get(COOKIE), "url": base}])
                page = ctx.new_page()
                page.goto(base + "/desk")
                expect(page.get_by_role("tablist", name="Vaults")).to_be_visible(timeout=60000)
                expect(status(page)).to_have_text("Banking rule now in force.", timeout=PREP_STREAM_S * 1000)
                expect(page.get_by_role("img", name="Banking lock: rule in force")).to_have_count(1, timeout=PUSH_MS)
                PREP["cylinder"] = True
            finally:
                chrome.close()
    except Exception as exc:
        PREP["errors"].append(f"midnight page: {exc!r}")


def _stream_events(api: Api, on_event: Callable[[str, dict[str, Any]], None], seconds: float) -> None:
    deadline = time.monotonic() + seconds
    with api.http.stream("GET", "/api/events", timeout=httpx.Timeout(HTTP_TIMEOUT_S, read=seconds)) as resp:
        name = ""
        for line in resp.iter_lines():
            if time.monotonic() > deadline:
                return
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                try:
                    data = json.loads(line[5:].strip() or "{}")
                except ValueError:
                    data = {}
                on_event(name, data)


def _prep_midnight(base: str) -> None:
    try:
        api, _ = _sign_in_retry(base, "marta")

        def on(name: str, data: dict[str, Any]) -> None:
            if name == "rule-in-force":
                PREP["push"].append({"data": data, "server_now": server_now(base)})

        _stream_events(api, on, PREP_STREAM_S)
    except Exception as exc:
        PREP["errors"].append(f"midnight: {exc!r}")


def _prep_closing(base: str) -> None:
    try:
        api, started = _sign_in_retry(base, "desmond")
        PREP["closing"] = {"api": api, "started": started, "ends": parse_utc(api.login["session_ends_at"])}

        def on(name: str, data: dict[str, Any]) -> None:
            if name == "session-ended":
                PREP["ended"].append(server_now(base))

        _stream_events(api, on, PREP_STREAM_S)
    except Exception as exc:
        PREP["errors"].append(f"closing: {exc!r}")


def _prep_evening(base: str) -> None:
    try:
        om = Api(base, "marta")
        now = clock(base)
        v, vend = new_vault(om), new_vendor(om)
        new_login(om, v, vend)
        p, _, _ = joiner(om, vault_ids=[v["id"]])
        res = ok(leave(om, p["id"]), 200).json()
        PREP["evening"] = {"vault_id": v["id"], "person_id": p["id"], "office_day": now["office_date"],
                           "utc_day": now["now"][:10], "turns_due": res["turns_due"]}
    except Exception as exc:
        PREP["errors"].append(f"evening: {exc!r}")


for _env, _fn in (("APP_MIDNIGHT_URL", _prep_midnight), ("APP_MIDNIGHT_URL", _prep_midnight_page),
                  ("APP_CLOSING_URL", _prep_closing), ("APP_EVENING_URL", _prep_evening)):
    _url = os.environ.get(_env)
    if _url:
        threading.Thread(target=_fn, args=(_url.rstrip("/"),), daemon=True).start()
