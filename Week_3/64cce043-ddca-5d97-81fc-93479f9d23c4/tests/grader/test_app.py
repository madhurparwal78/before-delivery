from __future__ import annotations

import html as html_text
import json
import os
import re
import uuid
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urljoin, urlsplit

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, Route, expect

from conftest import (
    Keycloak,
    Postgres,
    advance,
    animations,
    center,
    check,
    click,
    fill,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    select,
    shipped_packages,
    tab_order,
    unique,
)

APP_DIR = Path("/app")
SESSION_COOKIE = "strongroom_session"
SIGNIN_COOKIE = "strongroom_signin"
LIVE_S = 2
FILTER_S = 1
SEARCH_PAUSE_MS = 300
COMPANY_PAUSE_MS = 250
REORDER_PREVIEW_MS = 150
COUNT_MAX_MS = 500
GRANT_REFRESH_MS = 15000
KEEPALIVE_S = 15
RELEASE_S = 20
STREAM_ROUNDS = 60
SESSION_SLACK = 2
BODY_LIMIT = 65536
MIN_TARGET_PX = 44
SHORT_IDLE_S = 20
SHORT_DAY_S = 24
REALM_CHECK_S = 10
GRANT_HOUR_S = 3600
GRANT_HOURS = {"24h": 24, "7d": 168, "30d": 720}
RULE_LIMIT = 50
DEFAULT_RULES = 12
RACERS = 5
Q_LIMIT = 100
NEXT_LIMIT = 512
PRIORITY_MAX = 999
FIELD_LIMITS = {"company": 80, "value": 120, "notes": 500, "company_contains": 60}
DAY_S = 86400
HOUR_S = 3600
MINUTE_S = 60
BAND_EXPOSED = 40
BAND_SEVERE = 100
PHONE_BELOW = 600
TWO_COLUMN_FROM = 1024
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
SUGGESTION_MAX = 8
ANNOUNCED = "2026-10-20"
TEMP_PASSWORD = re.compile(r"Temporary password: ([A-Za-z0-9]{16})")
ALLOWED_LICENCES = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "PSF-2.0", "MPL-2.0", "OFL-1.1"}

LEVELS = ["critical", "high", "moderate", "low"]
LEVEL_LABEL = {"critical": "Critical", "high": "High", "moderate": "Moderate", "low": "Low"}
POINTS = {"critical": 20, "high": 10, "moderate": 4, "low": 1}

KINDS = [
    ("passport", "Passport", "Report the passport to the issuing office as compromised", "Apply for a replacement passport"),
    ("national_id", "National ID", "Report the ID number to the issuing authority", "Place a fraud alert with a credit bureau"),
    ("driving_licence", "Driving licence", "Ask the licensing office to flag the licence number", "Request a replacement licence"),
    ("bank_account", "Bank account", "Call the bank fraud line about this account", "Turn on alerts for every transaction"),
    ("payment_card", "Payment card", "Freeze the card in the issuer app", "Order a replacement card with a new number"),
    ("health_record", "Health record", "Ask the provider who accessed your record", "Check insurer statements for care you did not receive"),
    ("tax_id", "Tax ID", "File an identity theft report with the tax office", "Freeze your credit with each credit bureau"),
    ("password", "Password", "Change the password at this company", "Change it anywhere you reused it"),
    ("date_of_birth", "Date of birth", "Add a spoken passphrase to key accounts", "Treat messages that quote your birth date with suspicion"),
    ("home_address", "Home address", "Check for mail redirection you did not request", "Check your credit file for new accounts at this address"),
    ("phone", "Phone number", "Ask your carrier for a port-out lock", "Treat calls that mention this breach with suspicion"),
    ("email", "Email address", "Change the email account password", "Turn on two-step sign-in for the email account"),
]
LABEL = {code: label for code, label, _, _ in KINDS}
STEPS = {code: (one, two) for code, _, one, two in KINDS}
DEFAULT_RULE_LABELS = [
    "Passport is Critical", "National ID is Critical", "Tax ID is Critical", "Health record is High",
    "Bank account is High", "Payment card is High", "Driving licence is High", "Password is High",
    "Date of birth is Moderate", "Home address is Moderate", "Phone number is Low", "Email address is Low",
]
MESSAGES = {
    "signed_out": "Sign in to continue.",
    "cross_origin": "Request refused.",
    "access_ended": "This shared view has ended.",
    "owner_only": "Only the vault owner can do this.",
    "not_found": "Not found.",
    "holding_exists": "This company already holds that data kind in your ledger.",
    "rule_limit": "A vault holds at most 50 rules.",
    "stale_version": "This record changed in another window. Reload it and try again.",
    "step_already_done": "This step is already done.",
    "step_already_open": "This step is already open.",
    "step_out_of_order": "Finish the step before this one first.",
    "grant_active": "A trusted contact already has access. Revoke it first.",
    "no_active_grant": "There is no active grant.",
    "idempotency_conflict": "This Idempotency-Key was used with a different request.",
    "too_large": "Request body is too large.",
    "unsupported_media_type": "Send JSON.",
    "validation": "Check the highlighted fields.",
    "internal": "Something went wrong.",
    "identity_unavailable": "Sign-in service unavailable. Try again in a few minutes.",
}
OUTAGE_BANNER = "Sign-in service unavailable. Your ledger still works; signing in, changing passwords and granting access are paused."
BRIGHTWAY = [
    ("passport", "P 5520 4471 8", "Saved for online check-in"),
    ("date_of_birth", "1986-03-14", ""),
    ("email", "ada.marsh@example.com", ""),
]
OWNER_HOLDING_KEYS = {"id", "company", "data_kind", "value", "notes", "level", "rule_id", "affected", "version", "created_at", "updated_at"}
CONTACT_HOLDING_KEYS = {"id", "company", "data_kind", "level", "value", "affected"}
STEP_KEYS = {"id", "holding_id", "company", "data_kind", "level", "number", "text", "status", "points"}
EXPOSURE_KEYS = {"score", "band", "affected_count", "open_steps", "steps"}
CONTACT_BREACH_KEYS = {"id", "company", "announced_on", "data_kinds", "affected_holding_ids"}
CONTACT_GRANT_KEYS = {"status", "ends_at", "remaining_seconds", "levels", "owner_name"}

HTTP_TIMEOUT = 30
STREAM_READ_TIMEOUT = 60
POLL_MS = 150
SETTLE_S = 10
NAV_MS = 30000
WORKERS = 16
ISOLATION_ROUNDS = 100
TALL_VIEWPORT = 1400
BREAKPOINT_HEIGHT = 900
OLD_QUERY = "cop"
NOBODY = "Nobody"


def qs(**params: str) -> str:
    return "&".join(f"{k}={v}" for k, v in params.items())


def clinic_label(level: str) -> str:
    return f"Any kind at clinic is {LEVEL_LABEL[level]}"
OWNER_PASSWORD = "Probe-Owner-Pass-7"
CHANGED_PASSWORD = "Probe-Changed-Pass-7"
CONTACT_PASSWORD = "Probe-Contact-Pass-7"
VALUE = "Probe value 0001"
FOREIGN_ORIGIN = "http://evil.example"
FUTURE_DATE = "2999-12-31"
MALFORMED_DATE = "20/10/2026"
DEVICE_TIME = "2031-06-01T00:00:00Z"
SHORT_VALUE = "C-12"
EXTRA_COMPANIES = ["Aldmoor Gas", "Wren Post"]
NEVER_SERVED = ["/run.json", "/.venv/pyvenv.cfg", "/requirements.txt", "/.env", "/app/run.json", "/THIRD_PARTY_NOTICES.md", "/__main__.py"]


REDIRECTS = (301, 302, 303, 307, 308)


@dataclass
class Actor:
    app: httpx.Client
    kc: httpx.Client
    email: str
    password: str
    name: str
    base: str

    @property
    def session(self) -> str:
        value = self.app.cookies.get(SESSION_COOKIE)
        assert value, f"{self.email} holds no {SESSION_COOKIE} cookie"
        return value

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.app.get(path, **kw)

    def post(self, path: str, **kw: Any) -> httpx.Response:
        return self.app.post(path, **kw)

    def patch(self, path: str, **kw: Any) -> httpx.Response:
        return self.app.patch(path, **kw)

    def put(self, path: str, **kw: Any) -> httpx.Response:
        return self.app.put(path, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.app.delete(path, **kw)

    def on(self, base: str) -> httpx.Client:
        return httpx.Client(base_url=base, cookies={SESSION_COOKIE: self.session}, follow_redirects=False, timeout=HTTP_TIMEOUT)


def fresh(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    name, email = (second, first) if "@" in first else (first, second)
    if "@" not in email:
        email = re.sub(r"[^a-z0-9]+", ".", email.lower()).strip(".") + "@example.com"
    return name, email.lower()


def clients(base: str) -> tuple[httpx.Client, httpx.Client]:
    return (
        httpx.Client(base_url=base, follow_redirects=False, timeout=HTTP_TIMEOUT),
        httpx.Client(follow_redirects=False, timeout=HTTP_TIMEOUT),
    )


def start_login(app: httpx.Client, next_value: str | None = None) -> str:
    r = app.get("/auth/login", params=None if next_value is None else {"next": next_value})
    assert r.status_code == 302, f"GET /auth/login answered {r.status_code}; expected 302 to the realm (L699)"
    return r.headers["location"]


def _walk(kc: httpx.Client, url: str) -> tuple[str | None, httpx.Response | None]:
    for _ in range(10):
        if "/auth/callback" in urlsplit(url).path:
            return url, None
        r = kc.get(url)
        if r.status_code in REDIRECTS:
            url = urljoin(url, r.headers["location"])
            continue
        return None, r
    pytest.fail(f"the realm kept redirecting from {url}")


def _form_action(page: httpx.Response) -> str:
    for found in re.finditer(r'<form\b[^>]*\baction="([^"]*)"', page.text):
        action = html_text.unescape(found.group(1))
        if "login-actions" in action:
            return urljoin(str(page.url), action)
    pytest.fail(f"the realm page {page.url} shows no form (status {page.status_code})")


def _submit(kc: httpx.Client, page: httpx.Response, data: dict[str, str]) -> tuple[str | None, httpx.Response | None]:
    r = kc.post(_form_action(page), data=data)
    if r.status_code in REDIRECTS:
        return _walk(kc, urljoin(str(r.url), r.headers["location"]))
    return None, r


def realm_login(kc: httpx.Client, auth_url: str, email: str, password: str, *, register_name: str | None = None,
                new_password: str | None = None) -> tuple[str | None, httpx.Response | None]:
    callback, page = _walk(kc, auth_url)
    if callback:
        return callback, None
    assert page is not None
    if register_name is not None:
        link = re.search(r'href="([^"]*login-actions/registration[^"]*)"', page.text)
        assert link, "the realm sign-in page offers no registration link (self-registration stays as provided, L1122)"
        callback, page = _walk(kc, urljoin(str(page.url), html_text.unescape(link.group(1))))
        assert page is not None
        data = {"firstName": register_name, "lastName": register_name, "email": email, "username": email,
                "password": password, "password-confirm": password}
    else:
        data = {"username": email, "password": password}
    callback, page = _submit(kc, page, data)
    if callback is None and new_password is not None and page is not None and page.status_code == 200:
        callback, page = _submit(kc, page, {"password-new": new_password, "password-confirm": new_password})
    return callback, page


def finish(app: httpx.Client, callback_url: str, **kw: Any) -> httpx.Response:
    parts = urlsplit(callback_url)
    return app.get(parts.path + ("?" + parts.query if parts.query else ""), **kw)


def target(r: httpx.Response) -> str:
    parts = urlsplit(r.headers.get("location", ""))
    return parts.path + ("?" + parts.query if parts.query else "")


def sign_in(base: str, email: str, password: str, *, name: str = "", register: bool = False,
            new_password: str | None = None, next_value: str | None = None) -> tuple[Actor, httpx.Response]:
    app, kc = clients(base)
    auth = start_login(app, next_value)
    callback, page = realm_login(kc, auth, email, password, register_name=name if register else None, new_password=new_password)
    assert callback, f"the realm never returned {email} to /auth/callback (stopped with {page.status_code if page else None})"
    r = finish(app, callback)
    assert r.status_code == 303, f"/auth/callback answered {r.status_code}: {r.text[:200]}; expected 303 (L700)"
    assert app.cookies.get(SESSION_COOKIE), "no strongroom_session cookie after a successful callback (L700)"
    return Actor(app, kc, email, new_password or password, name, base), r


def new_owner(base: str) -> Actor:
    name, email = fresh("owner")
    owner, _ = sign_in(base, email, OWNER_PASSWORD, name=name, register=True)
    owner.name = expect_status(owner.get("/api/me"), 200)["name"]
    return owner


def realm_ends_session(actor: Actor) -> bool:
    app, _ = clients(actor.base)
    callback, _page = _walk(actor.kc, start_login(app))
    return callback is None


def expect_status(r: httpx.Response, status: int) -> Any:
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} answered {r.status_code}: {r.text[:400]}; expected {status}"
    return r.json() if r.content else None


def refused(r: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert r.status_code == status, f"{r.request.method} {r.request.url.path} answered {r.status_code}: {r.text[:400]}; expected {status} {code}"
    body = r.json()
    assert set(body) == {"error"}, f"error body carries extra keys: {body} (L629)"
    error = body["error"]
    assert set(error) <= {"code", "message", "fields"}, f"error carries extra keys: {body} (L630)"
    assert error["code"] == code and error["message"] == MESSAGES[code], f"expected {code} with its published message, got {body}"
    return error


def invalid(r: httpx.Response, field: str, message: str) -> None:
    error = refused(r, 422, "validation")
    assert error.get("fields", {}).get(field) == message, f"expected fields.{field} = {message!r}, got {error}"


def add_holding(o: Actor, company: str, kind: str, value: str = VALUE, notes: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"company": company, "data_kind": kind, "value": value}
    if notes:
        body["notes"] = notes
    return expect_status(o.post("/api/holdings", json=body), 201)["holding"]


def log_breach(o: Actor, company: str, kinds: list[str]) -> dict[str, Any]:
    body = {"company": company, "announced_on": ANNOUNCED, "data_kinds": kinds}
    return expect_status(o.post("/api/breaches", json=body), 201)["breach"]


def add_rule(o: Actor, kind: str, level: str, contains: str = "", priority: int | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"data_kind": kind, "level": level, "company_contains": contains}
    if priority is not None:
        body["priority"] = priority
    return expect_status(o.post("/api/rules", json=body), 201)["rule"]


def exposure_of(o: Actor) -> dict[str, Any]:
    return expect_status(o.get("/api/exposure"), 200)


def vault_rules(o: Actor) -> list[dict[str, Any]]:
    return expect_status(o.get("/api/rules"), 200)["rules"]


def holdings_of(o: Actor, **params: str) -> dict[str, Any]:
    return expect_status(o.get("/api/holdings", params=params), 200)


def holding_of(o: Actor, hid: str) -> dict[str, Any]:
    return expect_status(o.get(f"/api/holdings/{hid}"), 200)["holding"]


def find_step(exposure: dict[str, Any], text: str, company: str | None = None) -> dict[str, Any]:
    for step in exposure["steps"]:
        if step["text"] == text and (company is None or step["company"] == company):
            return step
    pytest.fail(f"no step {text!r} at {company} in {[(s['text'], s['company']) for s in exposure['steps']]}")


def ada_like(o: Actor) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    holdings = {kind: add_holding(o, "Brightway Air", kind, value, notes or None) for kind, value, notes in BRIGHTWAY}
    breach = log_breach(o, "Brightway Air", ["passport", "date_of_birth"])
    return holdings, breach


def band_for(score: int) -> str:
    if score == 0:
        return "Clear"
    if score < BAND_EXPOSED:
        return "Contained"
    return "Exposed" if score < BAND_SEVERE else "Severe"


def ghost(record_id: str) -> str:
    return str(uuid.uuid4())


def mask(value: str) -> str:
    positions = [i for i, c in enumerate(value) if c.isalnum()]
    keep = set(positions[-4:]) if len(positions) > 4 else set()
    return "".join("*" if c.isalnum() and i not in keep else c for i, c in enumerate(value))


def fmt_remaining(seconds: int) -> str:
    if seconds >= DAY_S:
        return f"{seconds // DAY_S}d {seconds % DAY_S // HOUR_S}h"
    if seconds >= HOUR_S:
        return f"{seconds // HOUR_S}h {seconds % HOUR_S // MINUTE_S}m"
    return f"{seconds // MINUTE_S}m {seconds % MINUTE_S}s"


def grant_to(owner: Actor, levels: list[str], duration: str = "30d") -> tuple[str, str, dict[str, Any], str]:
    name, email = fresh("contact")
    body = {"contact_name": name, "contact_email": email, "duration": duration, "levels": levels}
    created = expect_status(owner.post("/api/grant", json=body), 201)
    return name, email, created["grant"], created["temporary_password"]


def new_contact(owner: Actor, levels: list[str] | None = None, duration: str = "30d") -> tuple[Actor, dict[str, Any]]:
    name, email, grant, temporary = grant_to(owner, levels or list(LEVELS), duration)
    contact, r = sign_in(owner.base, email, temporary, name=name, new_password=CONTACT_PASSWORD)
    assert target(r) == "/shared", f"a contact's sign-in landed on {target(r)}; expected /shared (L1071)"
    return contact, grant


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=HTTP_TIMEOUT)
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    value = fn()
    while not value and time.monotonic() < deadline:
        value = fn()
    if not value:
        pytest.fail(f"{what} within {seconds} s")
    return value


def epoch(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def db_epoch(pg: Postgres) -> float:
    return float(pg.rows("select extract(epoch from clock_timestamp())::float8 as e")[0]["e"])


class Stream:
    def __init__(self, actor: Actor, base: str | None = None) -> None:
        self.events: list[tuple[str, Any, str, float]] = []
        self.closed = False
        self.cond = threading.Condition()
        self.client = httpx.Client(base_url=base or actor.base, cookies={SESSION_COOKIE: actor.session},
                                   timeout=httpx.Timeout(STREAM_READ_TIMEOUT, connect=HTTP_TIMEOUT))
        self._cm = self.client.stream("GET", "/api/events")
        self.response = self._cm.__enter__()
        assert self.response.status_code == 200, f"GET /api/events answered {self.response.status_code}; expected 200 (L737)"
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self) -> None:
        name, data = "message", []
        try:
            for line in self.response.iter_lines():
                if line.startswith(":"):
                    continue
                if line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].lstrip())
                elif line == "" and data:
                    raw = "\n".join(data)
                    try:
                        payload: Any = json.loads(raw)
                    except ValueError:
                        payload = raw
                    with self.cond:
                        self.events.append((name, payload, raw, time.time()))
                        self.cond.notify_all()
                    name, data = "message", []
        except (httpx.HTTPError, RuntimeError, ValueError):
            pass
        finally:
            with self.cond:
                self.closed = True
                self.cond.notify_all()

    def wait(self, predicate: Callable[["Stream"], bool], seconds: float) -> bool:
        with self.cond:
            return self.cond.wait_for(lambda: predicate(self), timeout=seconds)

    def changes(self, kind: str | None = None) -> list[dict[str, Any]]:
        return [p for n, p, _, _ in list(self.events) if n == "change" and isinstance(p, dict) and (kind is None or p.get("type") == kind)]

    def named(self, event: str) -> list[Any]:
        return [p for n, p, _, _ in list(self.events) if n == event]

    def close(self) -> None:
        try:
            self._cm.__exit__(None, None, None)
        finally:
            self.client.close()


@contextmanager
def stream_of(actor: Actor, base: str | None = None) -> Iterator[Stream]:
    s = Stream(actor, base)
    try:
        yield s
    finally:
        s.close()


@contextmanager
def app_page(browser: Browser, base: str, path: str, actor: Actor | None = None, *, width: int = 1280, height: int = 800,
             reduced_motion: str = "no-preference", before: Callable[[Page], None] | None = None,
             device_time: str | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": width, "height": height})
        if actor is not None:
            page.context.add_cookies([{"name": SESSION_COOKIE, "value": actor.session, "url": base}])
        if device_time is not None:
            page.clock.set_system_time(device_time)
        if before is not None:
            before(page)
        page.goto(base + path)
        yield page


def realm_cookies(page: Page, actor: Actor) -> None:
    def browser_domain(domain: str) -> str:
        bare = domain.removesuffix(".local")
        return bare if bare != domain and "." not in bare.lstrip(".") else domain

    cookies = [{"name": c.name, "value": c.value or "", "domain": browser_domain(c.domain), "path": c.path or "/"}
               for c in actor.kc.cookies.jar]
    assert cookies, f"the realm kept no session for {actor.email}"
    page.context.add_cookies(cookies)


def eventually(page: Page, check_fn: Callable[[], None], seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    last = time.monotonic()
    failure: AssertionError | None = None
    while time.monotonic() < deadline:
        try:
            check_fn()
            return
        except AssertionError as error:
            failure = error
        now = time.monotonic()
        advance(page, max(1.0, (now - last) * 1000))
        last = now
    try:
        check_fn()
        return
    except AssertionError as error:
        failure = error
    pytest.fail(f"{what} (waited {seconds} s): {failure}")


def shows(page: Page, locator: Locator, text: str | re.Pattern[str], seconds: float = SETTLE_S) -> None:
    eventually(page, lambda: expect(locator).to_have_text(text, timeout=POLL_MS), seconds, f"{locator} reads {text!r}")


def gone(page: Page, locator: Locator, seconds: float = SETTLE_S) -> None:
    eventually(page, lambda: expect(locator).to_have_count(0, timeout=POLL_MS), seconds, f"{locator} closed")


def numeral(page: Page) -> int:
    text = page.get_by_role("region", name="Exposure").first.text_content() or ""
    found = re.search(r"Exposure score\D*?(\d+)", text)
    assert found, f'region "Exposure" shows no score numeral: {text[:200]!r}'
    return int(found.group(1))


def numeral_is(page: Page, value: int, seconds: float = SETTLE_S) -> None:
    def check_value() -> None:
        assert numeral(page) == value, f"numeral {numeral(page)} != {value}"
    eventually(page, check_value, seconds, f"the score numeral reads {value}")


def ledger(page: Page) -> list[tuple[str, str]]:
    rows = page.get_by_role("table", name="Holdings").get_by_role("row").all_text_contents()
    out: list[tuple[str, str]] = []
    company = ""
    for raw in rows:
        flat = " ".join(raw.split())
        if not flat:
            continue
        if any(re.search(rf"\b{label}\b", flat) for label in LEVEL_LABEL.values()):
            out.append((company, flat))
        else:
            company = flat
    return out


def ledger_row(page: Page, kind_label: str) -> Locator:
    return page.get_by_role("table", name="Holdings").get_by_role("row").filter(has_text=kind_label)


ACCESSIBLE_TEXT = """el => { const out = []; const walk = n => { const a = n.getAttribute && n.getAttribute('aria-label');
  if (a) out.push(a); for (const c of n.children) walk(c); }; walk(el); return out.join(' ') + ' ' + el.textContent; }"""


def touched(row: Locator) -> bool:
    return "Touched" in row.evaluate(ACCESSIBLE_TEXT)


def mark(page: Page) -> None:
    page.evaluate("window.__verifierStay = 1")


def still_marked(page: Page) -> bool:
    return page.evaluate("window.__verifierStay === 1")


def body_text(page: Page) -> str:
    return page.evaluate("document.body.innerText")


def open_breach_form(page: Page) -> Locator:
    click(page.get_by_role("button", name="Log breach"))
    form = page.get_by_role("form", name="Log breach")
    eventually(page, lambda: expect(form).to_be_visible(timeout=POLL_MS), SETTLE_S, 'form "Log breach" opens')
    return form


def kind_box(scope: Locator, label: str) -> Locator:
    return scope.get_by_role("group", name="Data kinds").get_by_role("checkbox", name=label, exact=True)


def step_box(page: Page, text: str, company: str) -> Locator:
    return page.get_by_role("list", name="Next steps").get_by_role("checkbox", name=f"{text}, {company}", exact=True)


def pick_company(page: Page, form: Locator, company: str) -> None:
    box = form.get_by_role("combobox", name="Company")
    fill(box, company)
    advance(page, COMPANY_PAUSE_MS)
    box.press("Escape")


def test_wf_sign_in_return_to_page(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport")
    breach = log_breach(owner, "Brightway Air", ["passport"])
    path = f"/vault/breaches/{breach['id']}"
    with httpx.Client(base_url=app_url, follow_redirects=False, timeout=HTTP_TIMEOUT) as anon:
        r = anon.get(path)
    assert r.status_code == 302, f"signed-out {path} answered {r.status_code}; expected 302 (L180)"
    location = urlsplit(r.headers["location"])
    assert location.path == "/" and parse_qs(location.query).get("next") == [path], r.headers["location"]
    with app_page(browser, app_url, path) as page:
        expect(page).to_have_url(re.compile(r"/\?next="))
        link = page.get_by_role("link", name="Sign in")
        href = urlsplit(link.get_attribute("href") or "")
        assert href.path == "/auth/login" and parse_qs(href.query).get("next") == [path], f"Sign in points to {href}"
        realm_cookies(page, owner)
        link.click()
        page.wait_for_url(re.compile(re.escape(path) + r"$"), timeout=NAV_MS)
        expect(page.get_by_role("heading", name="Breach at Brightway Air")).to_be_visible()
        me = page.request.get(app_url + "/api/me").json()
        assert me["role"] == "owner" and me["email"].lower() == owner.email
        page.goto(app_url + "/")
        expect(page).to_have_url(re.compile(r"/vault$"))
    with app_page(browser, app_url, "/") as page:
        link = page.get_by_role("link", name="Sign in")
        href = urlsplit(link.get_attribute("href") or "")
        assert href.path == "/auth/login" and not href.query, f"plain Sign in points to {href} (L181)"
        realm_cookies(page, owner)
        link.click()
        page.wait_for_url(re.compile(r"/vault$"), timeout=NAV_MS)
        expect(page.get_by_role("region", name="Exposure")).to_be_visible()
        expect(page.get_by_role("table", name="Holdings")).to_be_visible()
        assert page.request.get(app_url + "/api/me").json()["email"].lower() == owner.email


def test_wf_sign_in_state_bound(app_url: str) -> None:
    name, email = fresh("binding")
    a, kc = clients(app_url)
    r1 = a.get("/auth/login", params={"next": "/vault/rules"})
    r2 = a.get("/auth/login")
    for r in (r1, r2):
        assert r.status_code == 302, f"/auth/login answered {r.status_code}"
    names = [h.split("=", 1)[0].strip() for h in r1.headers.get_list("set-cookie")]
    assert names == [SIGNIN_COOKIE], f"/auth/login set cookies {names}; expected only {SIGNIN_COOKIE} (L699)"
    for leak in ("/vault/rules", "%2Fvault%2Frules"):
        assert leak not in r1.headers.get("set-cookie", "") and leak not in r1.headers["location"], "next leaked (L699)"
    queries = [parse_qs(urlsplit(r.headers["location"]).query) for r in (r1, r2)]
    for q in queries:
        assert q.get("state") and q.get("nonce") and q.get("code_challenge"), q
        assert q.get("code_challenge_method") == ["S256"], q
        assert urlsplit(q["redirect_uri"][0]).path == "/auth/callback", q["redirect_uri"]
    assert queries[0]["state"] != queries[1]["state"] and queries[0]["code_challenge"] != queries[1]["code_challenge"]

    def failed(r: httpx.Response, client: httpx.Client) -> None:
        assert r.status_code == 400, f"callback answered {r.status_code}; expected 400 sign-in failure (L700)"
        assert "Sign-in failed" in r.text and "Sign-in could not be completed. Start again." in r.text
        assert SESSION_COOKIE not in r.headers.get("set-cookie", ""), "a failed callback set a session cookie"
        refused(client.get("/api/me", headers={"Cookie": ""}), 401, "signed_out")

    b, _ = clients(app_url)
    start_login(b)
    failed(b.get("/auth/callback", params={"code": "probe"}), b)

    auth = start_login(a)
    callback, page = realm_login(kc, auth, email, OWNER_PASSWORD, register_name=name)
    assert callback, f"registration did not return to the app ({page.status_code if page else None})"
    pending = a.cookies.get(SIGNIN_COOKIE)
    foreign, _ = clients(app_url)
    start_login(foreign)
    failed(finish(foreign, callback), foreign)
    done = finish(a, callback)
    assert done.status_code == 303 and a.cookies.get(SESSION_COOKIE), f"the starting browser was refused: {done.status_code}"
    replay, _ = clients(app_url)
    failed(finish(replay, callback, headers={"Cookie": f"{SIGNIN_COOKIE}={pending}"}), replay)
    again = finish(a, callback)
    assert again.status_code == 400 and "Sign-in failed" in again.text, "a reused callback was accepted (L700)"


def test_new_account_empty_vault(app_url: str) -> None:
    name, email = fresh("newcomer")
    owner, r = sign_in(app_url, email, OWNER_PASSWORD, name=name, register=True)
    assert target(r) == "/vault"
    assert expect_status(owner.get("/api/me"), 200)["role"] == "owner"
    listing = holdings_of(owner)
    assert listing["items"] == [] and listing["total"] == 0
    assert listing["exposure"]["score"] == 0 and listing["exposure"]["band"] == "Clear"
    assert expect_status(owner.get("/api/breaches"), 200)["breaches"] == []
    rules = vault_rules(owner)
    assert [x["label"] for x in rules] == DEFAULT_RULE_LABELS
    assert [x["priority"] for x in rules] == list(range(1, DEFAULT_RULES + 1))
    again, _ = sign_in(app_url, email, OWNER_PASSWORD)
    assert [x["id"] for x in vault_rules(again)] == [x["id"] for x in rules], "a second sign-in made another vault"


NEXT_CASES = {
    "vault_query": "/vault/rules?from=link",
    "record_outside_view": "/vault/holdings/no-such-record",
    "max_length": "/vault/",
    "too_long": "/vault/",
    "protocol_relative": "//evil.example/vault",
    "backslash": "/\\evil.example/vault",
    "absolute": "http://evil.example/vault",
    "whitespace": "/vault/a b",
    "control": "/vault/\u0007",
    "other_role": "/shared",
    "not_a_screen": "/api/me",
}
SAFE_NEXT = {"vault_query", "record_outside_view", "max_length"}
NEXT_PAD = {"max_length": NEXT_LIMIT, "too_long": NEXT_LIMIT + 1}


@pytest.mark.parametrize("case", list(NEXT_CASES), ids=list(NEXT_CASES))
def test_wf_sign_in_safe_return(app_url: str, case: str) -> None:
    value = NEXT_CASES[case]
    if case in NEXT_PAD:
        value = value + "a" * (NEXT_PAD[case] - len(value))
    name, email = fresh("returner")
    owner, r = sign_in(app_url, email, OWNER_PASSWORD, name=name, register=True, next_value=value)
    expected = value if case in SAFE_NEXT else "/vault"
    assert target(r) == expected, f"next={value!r} returned to {target(r)!r}; expected {expected!r} (L1063-1071)"
    if case == "record_outside_view":
        page = owner.get(value)
        assert page.status_code == 404 and "Not found" in page.text


def test_wf_sign_in_one_vault(app_url: str) -> None:
    name, email = fresh("racer")
    first, kc = clients(app_url)
    callback, page = realm_login(kc, start_login(first), email, OWNER_PASSWORD, register_name=name)
    assert callback, f"registration stopped ({page.status_code if page else None})"
    pending = [(first, callback)]
    for _ in range(RACERS - 1):
        app, _unused = clients(app_url)
        cb, stop = realm_login(kc, start_login(app), email, OWNER_PASSWORD)
        assert cb, f"second sign-in stopped ({stop.status_code if stop else None})"
        pending.append((app, cb))
    results = together([lambda a=a, c=c: finish(a, c) for a, c in pending])
    assert [r.status_code for r in results] == [303] * RACERS
    seen = [tuple(sorted(x["id"] for x in expect_status(a.get("/api/rules"), 200)["rules"])) for a, _ in pending]
    assert len(seen[0]) == DEFAULT_RULES and len(set(seen)) == 1, f"sessions saw different vaults: {seen}"
    for a, _ in pending:
        assert expect_status(a.get("/api/holdings"), 200)["total"] == 0


def test_wf_ledger_holdings_add(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport", "P 5520 4471 8")
    add_holding(owner, "Tally Rent", "national_id", "QQ 12 34 56 C")
    with app_page(browser, app_url, "/vault", owner) as page:
        expect(page.get_by_role("table", name="Holdings")).to_be_visible()
        mark(page)
        opener = page.get_by_role("button", name="Add holding")
        click(opener)
        dialog = page.get_by_role("dialog", name="Add holding")
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=POLL_MS), SETTLE_S, "dialog opens")
        fill(dialog.get_by_role("textbox", name="Company"), "Larchfield Clinic")
        select(dialog.get_by_role("combobox", name="Data kind"), "Health record")
        fill(dialog.get_by_role("textbox", name="Value"), "Patient LC-208113")
        click(dialog.get_by_role("button", name="Save holding"))
        gone(page, page.get_by_role("dialog", name="Add holding"))

        def ordered() -> None:
            rows = ledger(page)
            companies = [c for c, _ in rows]
            assert [c.startswith(n) for c, n in zip(companies, ["Brightway Air", "Larchfield Clinic", "Tally Rent"])] == [True] * 3, rows
            larch = [t for c, t in rows if c.startswith("Larchfield Clinic")]
            assert larch and "Health record" in larch[0] and "High" in larch[0], rows
        eventually(page, ordered, SETTLE_S, "the new row sits in ledger order with level High")
        assert still_marked(page), "the page reloaded"
        expect(opener).to_be_focused()
    items = holdings_of(owner)["items"]
    assert [(h["company"], h["data_kind"], h["level"]) for h in items] == [
        ("Brightway Air", "passport", "critical"), ("Larchfield Clinic", "health_record", "high"), ("Tally Rent", "national_id", "critical")]


HOLDING_CASES = {
    "company_missing": ("company", None, "Required."),
    "company_blank": ("company", "   ", "Required."),
    "company_too_long": ("company", "over", "Too long."),
    "value_missing": ("value", None, "Required."),
    "value_too_long": ("value", "over", "Too long."),
    "notes_too_long": ("notes", "over", "Too long."),
    "kind_unknown": ("data_kind", "passport_scan", "Choose a data kind from the list."),
    "at_limits": ("", "limit", ""),
    "duplicate_spelling": ("company", " brightway   AIR ", "holding_exists"),
}


@pytest.mark.parametrize("case", list(HOLDING_CASES), ids=list(HOLDING_CASES))
def test_holding_validation(app_url: str, case: str) -> None:
    field, value, expected = HOLDING_CASES[case]
    owner = new_owner(app_url)
    base = add_holding(owner, "Brightway Air", "passport")
    if case == "at_limits":
        limits = {k: FIELD_LIMITS[k] for k in ("company", "value", "notes")}
        made = add_holding(owner, "C" * limits["company"], "phone", "v" * limits["value"], "n" * limits["notes"])
        assert (len(made["company"]), len(made["value"]), len(made["notes"])) == tuple(limits.values())
        return
    body: dict[str, Any] = {"company": "Copperleaf Bank", "data_kind": "passport", "value": VALUE}
    if value is None:
        body.pop(field)
    elif value == "over":
        body[field] = "x" * (FIELD_LIMITS[field] + 1)
    else:
        body[field] = value
    r = owner.post("/api/holdings", json=body)
    expected_total = 1
    if expected == "holding_exists":
        refused(r, 409, "holding_exists")
        other = add_holding(owner, "Copperleaf Bank", "passport")
        clash = owner.patch(f"/api/holdings/{other['id']}", json={"version": other["version"], "company": value})
        refused(clash, 409, "holding_exists")
        assert holding_of(owner, other["id"]) == other
        expected_total = 2
    else:
        invalid(r, field, expected)
        if value is not None:
            patched = owner.patch(f"/api/holdings/{base['id']}", json={"version": base["version"], field: body[field]})
            invalid(patched, field, expected)
    assert holding_of(owner, base["id"]) == base, "a refused write changed the holding"
    assert holdings_of(owner)["total"] == expected_total


def test_holding_no_client_fields(app_url: str) -> None:
    owner = new_owner(app_url)
    held = add_holding(owner, "Brightway Air", "passport", "P 5520 4471 8")
    for key, value in [("level", "low"), ("id", "x"), ("rule_id", None), ("affected", True), ("vault_id", "x"), ("version", 1), ("score", 0)]:
        r = owner.post("/api/holdings", json={"company": "Parcelwise", "data_kind": "phone", "value": VALUE, key: value})
        invalid(r, key, "This field cannot be set.")
    for key, value in [("level", "low"), ("created_at", ANNOUNCED), ("owner", "x"), ("affected", True)]:
        r = owner.patch(f"/api/holdings/{held['id']}", json={"version": held["version"], "value": VALUE, key: value})
        invalid(r, key, "This field cannot be set.")
    assert holding_of(owner, held["id"]) == held
    assert [h["company"] for h in holdings_of(owner)["items"]] == ["Brightway Air"]


def test_vault_scoped_ids(app_url: str) -> None:
    me = new_owner(app_url)
    other = new_owner(app_url)
    holdings, breach = ada_like(other)
    theirs = exposure_of(other)
    their_rules = vault_rules(other)
    ids = {"h": holdings["passport"]["id"], "b": breach["id"], "s": theirs["steps"][0]["id"], "r": their_rules[0]["id"]}
    their_passport = holding_of(other, ids["h"])
    calls = [
        ("GET", "/api/holdings/{}", "h", None),
        ("PATCH", "/api/holdings/{}", "h", {"version": 1, "value": VALUE}),
        ("DELETE", "/api/holdings/{}", "h", None),
        ("GET", "/api/breaches/{}", "b", None),
        ("PATCH", "/api/breaches/{}", "b", {"version": 1, "data_kinds": ["email"]}),
        ("DELETE", "/api/breaches/{}", "b", None),
        ("POST", "/api/steps/{}/done", "s", None),
        ("POST", "/api/steps/{}/reopen", "s", None),
        ("PATCH", "/api/rules/{}", "r", {"version": 1, "level": "low"}),
        ("DELETE", "/api/rules/{}", "r", None),
    ]
    for method, template, key, body in calls:
        foreign = me.app.request(method, template.format(ids[key]), json=body)
        never = me.app.request(method, template.format(ghost(ids[key])), json=body)
        refused(foreign, 404, "not_found")
        assert foreign.json() == never.json(), f"{method} {template}: foreign and never-existing ids answer differently"
    preview = {"company": "Brightway Air", "data_kinds": ["passport"]}
    foreign = me.post("/api/breaches/preview", json={**preview, "breach_id": ids["b"]})
    never = me.post("/api/breaches/preview", json={**preview, "breach_id": ghost(ids["b"])})
    refused(foreign, 404, "not_found")
    assert foreign.json() == never.json()
    after = exposure_of(other)
    assert after["score"] == theirs["score"] and [s["status"] for s in after["steps"]] == [s["status"] for s in theirs["steps"]]
    assert holding_of(other, ids["h"]) == their_passport and vault_rules(other) == their_rules


def test_wf_ledger_holdings_duplicate_race(app_url: str) -> None:
    owner = new_owner(app_url)
    spellings = ["Acme  Bank", "acme bank", " ACME Bank "]
    with stream_of(owner) as s:
        results = together([lambda c=c: owner.post("/api/holdings", json={"company": c, "data_kind": "bank_account", "value": VALUE})
                            for c in spellings * 2])
        winners = [r for r in results if r.status_code == 201]
        assert len(winners) == 1, [r.status_code for r in results]
        for r in results:
            if r.status_code != 201:
                refused(r, 409, "holding_exists")
        assert s.wait(lambda st: len(st.changes("holding.created")) >= 1, LIVE_S), "no holding.created event"
        assert not s.wait(lambda st: len(st.changes("holding.created")) > 1, LIVE_S), "losers sent notifications"
    items = holdings_of(owner)["items"]
    assert len([h for h in items if " ".join(h["company"].lower().split()) == "acme bank"]) == 1
    other = add_holding(owner, "Parcelwise", "phone")
    rename = lambda: owner.patch(f"/api/holdings/{other['id']}", json={"version": other["version"], "company": "Copperleaf Bank"})
    post = lambda: owner.post("/api/holdings", json={"company": "copperleaf bank", "data_kind": "phone", "value": VALUE})
    raced = together([rename, post])
    assert sorted(r.status_code for r in raced) in ([200, 409], [201, 409]), [r.status_code for r in raced]
    refused([r for r in raced if r.status_code == 409][0], 409, "holding_exists")


def test_request_isolation(app_url: str) -> None:
    a, b = new_owner(app_url), new_owner(app_url)
    pa = add_holding(a, "Brightway Air", "passport", "P 5520 4471 8")
    add_holding(b, "Quayside Mobile", "payment_card", "5412 7500 0000 1290")
    contact, _ = new_contact(a)
    expected = {a.email: ("owner", {"Brightway Air"}, "P 5520 4471 8"), b.email: ("owner", {"Quayside Mobile"}, "5412 7500 0000 1290"),
                contact.email: ("contact", {"Brightway Air"}, mask("P 5520 4471 8"))}
    def probe(actor: Actor, path: str) -> tuple[Actor, str, httpx.Response]:
        return actor, path, actor.get(path)
    jobs = [(actor, path) for _ in range(ISOLATION_ROUNDS) for actor in (a, b, contact) for path in ("/api/me", "/api/holdings")]
    with ThreadPoolExecutor(WORKERS) as pool:
        results = list(pool.map(lambda job: probe(*job), jobs))
    for actor, path, r in results:
        role, companies, value = expected[actor.email]
        body = expect_status(r, 200)
        if path == "/api/me":
            assert body["email"].lower() == actor.email and body["role"] == role, f"{actor.email} got {body}"
        else:
            assert {h["company"] for h in body["items"]} == companies and [h["value"] for h in body["items"]] == [value], body
    with stream_of(a) as sa, stream_of(b) as sb:
        made = add_holding(a, "Parcelwise", "phone")
        assert sa.wait(lambda st: any(c["id"] == made["id"] for c in st.changes()), LIVE_S)
        assert not sb.wait(lambda st: any(c.get("id") in (made["id"], pa["id"]) for c in st.changes()), LIVE_S), "b saw a's event"


def ledger_vault(owner: Actor) -> None:
    ada_like(owner)
    for kind, value in [("bank_account", "GB29 CPLF 6016 1331 9268 19"), ("payment_card", "4929 1180 2231 6604"), ("home_address", "14 Wren Row, Aldmoor")]:
        add_holding(owner, "Copperleaf Bank", kind, value)
    add_holding(owner, "Parcelwise", "home_address", "14 Wren Row, Aldmoor")
    add_holding(owner, "Parcelwise", "phone", "+44 7700 900412")


def test_wf_search_facets_filter(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ledger_vault(owner)
    with app_page(browser, app_url, "/vault", owner) as page:
        search = page.get_by_role("searchbox", name="Search holdings")
        results = page.get_by_role("status", name="Results")
        fill(search, "parcel")
        advance(page, SEARCH_PAUSE_MS)
        shows(page, results, "Holdings shown: 2.")
        assert {c for c, _ in ledger(page)} <= {c for c, _ in ledger(page) if c.startswith("Parcelwise")}
        fill(search, "")
        advance(page, SEARCH_PAUSE_MS)
        facets = holdings_of(owner)["facets"]
        select(page.get_by_role("combobox", name="Company"), f"Copperleaf Bank ({facets['company']['Copperleaf Bank']})")
        shows(page, results, "Holdings shown: 3.")
        level = holdings_of(owner, company="Copperleaf Bank")["facets"]["level"]["high"]
        select(page.get_by_role("combobox", name="Level"), f"High ({level})")
        shows(page, results, f"Holdings shown: {level}.")
        rows = ledger(page)
        assert rows and all(c.startswith("Copperleaf Bank") and "High" in t for c, t in rows), rows
        assert numeral(page) == 48
    assert holdings_of(owner, q="parcel")["total"] == 2 and holdings_of(owner, q="cop")["total"] == 3


def test_live_filter_timing(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ledger_vault(owner)
    with app_page(browser, app_url, "/vault", owner) as page:
        results = page.get_by_role("status", name="Results")
        search = page.get_by_role("searchbox", name="Search holdings")
        expect(search).to_be_visible()
        mark(page)
        search.click()
        page.keyboard.type("cop")
        advance(page, SEARCH_PAUSE_MS)
        expect(results).to_have_text("Holdings shown: 3.", timeout=FILTER_S * 1000)
        moderate = holdings_of(owner, q="cop")["facets"]["level"]["moderate"]
        select(page.get_by_role("combobox", name="Level"), f"Moderate ({moderate})")
        advance(page, 1)
        expect(results).to_have_text(f"Holdings shown: {moderate}.", timeout=FILTER_S * 1000)
        assert all("Moderate" in t for _, t in ledger(page))
        assert still_marked(page), "filtering reloaded the page"


def test_facets_per_vault(app_url: str) -> None:
    a, b = new_owner(app_url), new_owner(app_url)
    add_holding(a, "Copperleaf Bank", "bank_account")
    add_holding(a, "copperleaf  bank", "payment_card")
    add_holding(a, "Copperleaf Bank", "home_address")
    add_holding(a, "Parcelwise", "home_address")
    add_holding(a, "Parcelwise", "phone")
    add_holding(b, "Copperleaf Bank", "tax_id")
    log_breach(a, "Copperleaf Bank", ["bank_account"])
    high = holdings_of(a, level="high")
    assert high["total"] == 2 and len(high["items"]) == 2
    assert high["facets"]["level"] == {"high": 2, "moderate": 2, "low": 1}
    assert high["facets"]["data_kind"] == {"bank_account": 1, "payment_card": 1}
    assert high["facets"]["company"] == {"Copperleaf Bank": 2}
    assert high["exposure"]["score"] == exposure_of(a)["score"] == 2 * POINTS["high"]
    none = holdings_of(a, q="parcel", level="high")
    assert none["total"] == 0 and none["facets"]["company"] == {} and none["facets"]["level"] == {"moderate": 1, "low": 1}
    assert holdings_of(a)["facets"]["company"] == {"Copperleaf Bank": 3, "Parcelwise": 2}
    invalid(a.get("/api/holdings", params={"q": "x" * (Q_LIMIT + 1)}), "q", "Too long.")
    refused(a.get("/api/holdings", params={"level": "urgent"}), 422, "validation")
    refused(a.get("/api/holdings", params={"data_kind": "passport_scan"}), 422, "validation")


def test_contact_scoped_search(app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport", "P 5520 4471 8")
    add_holding(owner, "Copperleaf Bank", "bank_account", "GB29 CPLF 6016 1331 9268 19", "Joint account with Ines")
    add_holding(owner, "Copperleaf Bank", "home_address", "14 Wren Row, Aldmoor")
    add_holding(owner, "Parcelwise", "phone", "+44 7700 900412")
    log_breach(owner, "Brightway Air", ["passport"])
    log_breach(owner, "Copperleaf Bank", ["bank_account", "home_address"])
    contact, _ = new_contact(owner, ["high", "moderate"])
    for q, owner_total, contact_total in [("wren", 1, 0), ("joint", 1, 0), ("copper", 2, 2), ("home", 1, 1)]:
        assert holdings_of(owner, q=q)["total"] == owner_total, q
        assert holdings_of(contact, q=q)["total"] == contact_total, q
    seen = holdings_of(contact)
    assert seen["total"] == 2
    assert seen["facets"]["level"] == {"high": 1, "moderate": 1}
    assert seen["facets"]["data_kind"] == {"bank_account": 1, "home_address": 1}
    assert seen["facets"]["company"] == {"Copperleaf Bank": 2}
    scoped = 2 * POINTS["high"] + 2 * POINTS["moderate"]
    assert seen["exposure"]["score"] == scoped == exposure_of(contact)["score"]
    assert exposure_of(owner)["score"] == 68


def test_latest_input_wins(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ledger_vault(owner)
    with app_page(browser, app_url, "/vault", owner) as page:
        held: list[Route] = []
        settled: list[str] = []
        page.on("requestfinished", lambda req: settled.append(req.url))
        page.on("requestfailed", lambda req: settled.append(req.url))

        def hold_search(route: Route) -> None:
            if f"q={OLD_QUERY}" in route.request.url and not held:
                held.append(route)
                return
            route.continue_()
        page.route("**/api/holdings?*", hold_search)
        results = page.get_by_role("status", name="Results")
        search = page.get_by_role("searchbox", name="Search holdings")
        fill(search, "cop")
        advance(page, SEARCH_PAUSE_MS)
        eventually(page, lambda: None if held else pytest.fail("q=cop never requested"), SETTLE_S, "older query sent")
        results.evaluate("el => { window.__results = []; new MutationObserver(() => window.__results.push(el.textContent))"
                         ".observe(el, {subtree: true, childList: true, characterData: true}); }")
        fill(search, "parcel")
        advance(page, SEARCH_PAUSE_MS)
        shows(page, results, "Holdings shown: 2.")
        try:
            held[0].continue_()
        except PlaywrightError:
            pass

        def late_done() -> None:
            assert any(f"q={OLD_QUERY}" in u for u in settled), "older answer still in flight"
        eventually(page, late_done, SETTLE_S, "older answer arrives")
        advance(page, COUNT_MAX_MS)
        expect(results).to_have_text("Holdings shown: 2.")
        assert not any("Holdings shown: 3." in t for t in page.evaluate("window.__results")), "the older answer painted"
        assert all(c.startswith("Parcelwise") for c, _ in ledger(page))
        page.unroute("**/api/holdings?*")


def test_breach_preview_latest_wins(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ledger_vault(owner)
    with app_page(browser, app_url, "/vault", owner) as page:
        settled: list[str] = []
        page.on("requestfinished", lambda req: settled.append(req.url))
        page.on("requestfailed", lambda req: settled.append(req.url))
        held_preview: list[Route] = []

        def hold_preview(route: Route) -> None:
            body = route.request.post_data_json or {}
            if body.get("data_kinds") == ["bank_account"] and not held_preview:
                held_preview.append(route)
                return
            route.continue_()
        page.route("**/api/breaches/preview", hold_preview)
        form = open_breach_form(page)
        pick_company(page, form, "Copperleaf Bank")
        check(kind_box(form, "Bank account"))
        eventually(page, lambda: None if held_preview else pytest.fail("no preview held"), SETTLE_S, "first preview sent")
        status = page.get_by_role("status", name="Breach preview")
        status.evaluate("el => { window.__preview = []; new MutationObserver(() => window.__preview.push(el.textContent))"
                        ".observe(el, {subtree: true, childList: true, characterData: true}); }")
        check(kind_box(form, "Payment card"))
        older = expect_status(owner.post("/api/breaches/preview", json={"company": "Copperleaf Bank", "data_kinds": ["bank_account"]}), 200)
        latest = expect_status(owner.post("/api/breaches/preview", json={"company": "Copperleaf Bank", "data_kinds": ["bank_account", "payment_card"]}), 200)
        text = f"Preview: holdings touched 2, projected score {latest['score']}."
        shows(page, status, text)
        try:
            held_preview[0].continue_()
        except PlaywrightError:
            pass
        eventually(page, lambda: None if any("/api/breaches/preview" in u for u in settled) else pytest.fail("pending"), SETTLE_S, "older preview arrives")
        advance(page, COUNT_MAX_MS)
        expect(status).to_have_text(text)
        older_text = f"Preview: holdings touched 1, projected score {older['score']}."
        assert older_text not in page.evaluate("window.__preview"), "the older preview painted"
        assert numeral(page) == latest["score"]


def test_wf_search_facets_url(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ledger_vault(owner)
    with app_page(browser, app_url, "/vault", owner) as page:
        results = page.get_by_role("status", name="Results")
        expect(page.get_by_role("table", name="Holdings")).to_be_visible()
        mark(page)
        moderate = holdings_of(owner)["facets"]["level"]["moderate"]
        select(page.get_by_role("combobox", name="Level"), f"Moderate ({moderate})")
        shows(page, results, f"Holdings shown: {moderate}.")
        assert urlsplit(page.url).query == qs(level="moderate")
        length = page.evaluate("history.length")
        parcel = holdings_of(owner, level="moderate")["facets"]["company"]["Parcelwise"]
        select(page.get_by_role("combobox", name="Company"), f"Parcelwise ({parcel})")
        shows(page, results, f"Holdings shown: {parcel}.")
        assert urlsplit(page.url).query == qs(company="Parcelwise", level="moderate")
        assert page.evaluate("history.length") == length + 1
        fill(page.get_by_role("searchbox", name="Search holdings"), "home")
        advance(page, SEARCH_PAUSE_MS)
        shows(page, results, "Holdings shown: 1.")
        assert urlsplit(page.url).query == qs(q="home", company="Parcelwise", level="moderate")
        assert page.evaluate("history.length") == length + 1, "typing added a history entry"
        page.go_back()
        shows(page, results, f"Holdings shown: {moderate}.")
        assert urlsplit(page.url).query == qs(level="moderate")
        expect(page.get_by_role("searchbox", name="Search holdings")).to_have_value("")
        page.go_forward()
        shows(page, results, "Holdings shown: 1.")
        expect(page.get_by_role("searchbox", name="Search holdings")).to_have_value("home")
        assert still_marked(page), "Back or Forward reloaded the page"
    first: list[str] = []
    with app_page(browser, app_url, "/vault?q=parcel&level=moderate", owner,
                  before=lambda p: p.on("request", lambda r: first.append(r.url) if "/api/holdings" in r.url else None)) as page:
        shows(page, page.get_by_role("status", name="Results"), "Holdings shown: 1.")
        query = parse_qs(urlsplit(first[0]).query)
        assert query.get("q") == ["parcel"] and query.get("level") == ["moderate"], first[0]
    with app_page(browser, app_url, f"/vault?data_kind=passports&level=urgent&q={'x' * (Q_LIMIT + 1)}", owner) as page:
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/vault$"), timeout=POLL_MS), SETTLE_S, "bad filters dropped")
    with app_page(browser, app_url, "/vault?" + qs(company=NOBODY), owner) as page:
        eventually(page, lambda: expect(page.get_by_text("No holdings match these filters.")).to_be_visible(timeout=POLL_MS), SETTLE_S, "empty state")
        assert urlsplit(page.url).query == qs(company=NOBODY)


SEARCH_WIDTHS = (375, 599, 600, 768, 1023, 1024, 1280)


def test_wf_search_facets_breakpoints(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ledger_vault(owner)
    with app_page(browser, app_url, "/vault", owner) as page:
        for width in SEARCH_WIDTHS:
            page.set_viewport_size({"width": width, "height": BREAKPOINT_HEIGHT})
            page.goto(app_url + "/vault")
            table = page.get_by_role("table", name="Holdings")
            expect(table).to_be_visible()
            layout(page)
            t = table.bounding_box()
            if width >= TWO_COLUMN_FROM:
                assert page.get_by_role("region", name="Exposure").bounding_box()["x"] >= t["x"] + t["width"] - 1, f"no two columns at {width}"
            else:
                assert page.get_by_role("button", name="Log breach").bounding_box()["y"] < t["y"], f"score band not above the list at {width}"
            if width < PHONE_BELOW:
                expect(page.get_by_role("button", name="Menu")).to_be_visible()
            else:
                expect(page.get_by_role("button", name="Menu")).to_have_count(0)
            fill(page.get_by_role("searchbox", name="Search holdings"), "parcel")
            advance(page, SEARCH_PAUSE_MS)
            expect(page.get_by_role("status", name="Results")).to_have_text("Holdings shown: 2.", timeout=FILTER_S * 1000)
            assert all(c.startswith("Parcelwise") for c, _ in ledger(page)), f"wrong rows at {width}"


def test_wf_grading_rules_edit(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    phone = add_holding(owner, "Larchfield Clinic", "phone", "+44 7700 900412")
    log_breach(owner, "Larchfield Clinic", ["phone"])
    updates = lambda p: p.get_by_role("status", name="Exposure updates")
    with app_page(browser, app_url, "/vault/rules", owner, height=TALL_VIEWPORT) as page:
        click(page.get_by_role("button", name="Add rule"))
        dialog = page.get_by_role("dialog", name="Add rule")
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=POLL_MS), SETTLE_S, "Add rule opens")
        select(dialog.get_by_role("combobox", name="Data kind"), "Any kind")
        fill(dialog.get_by_role("textbox", name="Company contains"), "clinic")
        select(dialog.get_by_role("combobox", name="Level"), "Critical")
        fill(dialog.get_by_role("spinbutton", name="Priority"), "1")
        click(dialog.get_by_role("button", name="Save rule"))
        shows(page, updates(page), f"Rules updated. Exposure score {2 * POINTS['critical']}.")
        row = page.get_by_role("table", name="Preview levels").get_by_role("row").filter(has_text="Larchfield Clinic")
        shows(page, row, re.compile("Critical"))
        assert holding_of(owner, phone["id"])["level"] == "critical"
        click(page.get_by_role("button", name=f"Edit rule: {clinic_label('critical')}", exact=True))
        edit = page.get_by_role("dialog", name="Edit rule")
        eventually(page, lambda: expect(edit).to_be_visible(timeout=POLL_MS), SETTLE_S, "Edit rule opens")
        select(edit.get_by_role("combobox", name="Level"), "High")
        click(edit.get_by_role("button", name="Save rule"))
        shows(page, updates(page), f"Rules updated. Exposure score {2 * POINTS['high']}.")
        assert holding_of(owner, phone["id"])["level"] == "high"
        click(page.get_by_role("button", name=f"Delete rule: {clinic_label('high')}", exact=True))
        shows(page, updates(page), f"Rules updated. Exposure score {2 * POINTS['low']}.")
    assert holding_of(owner, phone["id"])["level"] == "low"
    assert clinic_label("high") not in [r["label"] for r in vault_rules(owner)]


def test_grading_order(app_url: str) -> None:
    owner = new_owner(app_url)
    phone = add_holding(owner, "Larchfield Clinic", "phone")
    assert holding_of(owner, phone["id"])["level"] == "low"
    loose = add_rule(owner, "any", "moderate", "clinic", 5)
    strict = add_rule(owner, "phone", "high", "", 5)
    assert loose["label"] == clinic_label("moderate")
    later = add_rule(owner, "any", "high", "LARCH", 5)
    got = holding_of(owner, phone["id"])
    assert got["level"] == "high" and got["rule_id"] == strict["id"], got
    first = add_rule(owner, "any", "moderate", "field", 1)
    got = holding_of(owner, phone["id"])
    assert got["level"] == "moderate" and got["rule_id"] == first["id"], got
    order = [r["id"] for r in vault_rules(owner) if r["priority"] == 5]
    assert order.index(strict["id"]) < order.index(later["id"]) and order[-1] == loose["id"], order
    for rule in vault_rules(owner):
        expect_status(owner.delete(f"/api/rules/{rule['id']}"), 204)
    got = holding_of(owner, phone["id"])
    assert got["level"] == "low" and got["rule_id"] is None


RULE_CASES = {
    "priority_zero": ("priority", 0, "Priority must be a whole number from 1 to 999."),
    "priority_over": ("priority", "over", "Priority must be a whole number from 1 to 999."),
    "priority_fraction": ("priority", 1.5, "Priority must be a whole number from 1 to 999."),
    "level_unknown": ("level", "urgent", "Choose a level from the list."),
    "kind_unknown": ("data_kind", "passport_scan", "Choose a data kind from the list."),
    "contains_too_long": ("company_contains", "over", "Too long."),
    "unknown_key": ("label", "Passport is Low", "This field cannot be set."),
    "limit": ("", "", "rule_limit"),
}


@pytest.mark.parametrize("case", list(RULE_CASES), ids=list(RULE_CASES))
def test_rule_validation(app_url: str, case: str) -> None:
    field, value, expected = RULE_CASES[case]
    owner = new_owner(app_url)
    if case == "limit":
        for _ in range(RULE_LIMIT - DEFAULT_RULES):
            add_rule(owner, "email", "low")
        before = vault_rules(owner)
        refused(owner.post("/api/rules", json={"data_kind": "email", "level": "low"}), 409, "rule_limit")
        assert vault_rules(owner) == before and len(before) == RULE_LIMIT
        return
    if value == "over":
        value = PRIORITY_MAX + 1 if field == "priority" else "x" * (FIELD_LIMITS[field] + 1)
    before = vault_rules(owner)
    invalid(owner.post("/api/rules", json={"data_kind": "passport", "level": "low", field: value}), field, expected)
    target_rule = before[0]
    invalid(owner.patch(f"/api/rules/{target_rule['id']}", json={"version": target_rule["version"], field: value}), field, expected)
    assert vault_rules(owner) == before


def test_owner_only(app_url: str) -> None:
    owner = new_owner(app_url)
    passport = add_holding(owner, "Brightway Air", "passport")
    bank = add_holding(owner, "Copperleaf Bank", "bank_account")
    breach = log_breach(owner, "Brightway Air", ["passport"])
    contact, grant = new_contact(owner, ["critical"])
    step = exposure_of(owner)["steps"][0]
    rule = vault_rules(owner)[0]
    passport_now = holding_of(owner, passport["id"])
    forbidden = [
        ("POST", "/api/holdings", {"company": "Parcelwise", "data_kind": "phone", "value": VALUE}),
        ("PATCH", f"/api/holdings/{passport['id']}", {"version": 1, "value": VALUE}),
        ("DELETE", f"/api/holdings/{passport['id']}", None),
        ("GET", "/api/rules", None),
        ("POST", "/api/rules", {"data_kind": "email", "level": "low"}),
        ("PUT", "/api/rules/order", {"rule_ids": [rule["id"]]}),
        ("POST", "/api/rules/preview", {"rule_ids": [rule["id"]]}),
        ("POST", "/api/breaches", {"company": "Brightway Air", "announced_on": ANNOUNCED, "data_kinds": ["email"]}),
        ("POST", "/api/breaches/preview", {"company": "Brightway Air", "data_kinds": ["email"]}),
        ("PATCH", f"/api/breaches/{breach['id']}", {"version": 1, "data_kinds": ["email"]}),
        ("DELETE", f"/api/breaches/{breach['id']}", None),
        ("POST", f"/api/steps/{step['id']}/done", None),
        ("GET", "/api/grant", None),
        ("POST", "/api/grant", {"contact_name": "x", "contact_email": "x@example.com", "duration": "24h", "levels": ["low"]}),
        ("PATCH", "/api/grant", {"levels": ["critical"]}),
        ("DELETE", "/api/grant", None),
        ("POST", "/api/account/password", {"current_password": CONTACT_PASSWORD, "new_password": CHANGED_PASSWORD}),
    ]
    for method, path, body in forbidden:
        refused(contact.app.request(method, path, json=body), 403, "owner_only")
    refused(contact.patch(f"/api/holdings/{bank['id']}", json={"version": 1, "value": VALUE}), 404, "not_found")
    refused(contact.patch(f"/api/rules/{rule['id']}", json={"version": 1, "level": "low"}), 404, "not_found")
    refused(contact.delete(f"/api/rules/{rule['id']}"), 404, "not_found")
    assert holding_of(owner, passport["id"]) == passport_now and exposure_of(owner)["score"] == 2 * POINTS["critical"]
    assert expect_status(owner.get("/api/grant"), 200)["grant"]["status"] == "active"
    assert expect_status(owner.get("/api/breaches"), 200)["breaches"][0]["id"] == breach["id"] and vault_rules(owner)[0] == rule


def test_wf_grading_rules_stale(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    rule = add_rule(owner, "any", "critical", "clinic")
    label = "Any kind at clinic is Critical"
    with app_page(browser, app_url, "/vault/rules", owner, height=TALL_VIEWPORT) as first, \
            app_page(browser, app_url, "/vault/rules", owner, height=TALL_VIEWPORT) as second:
        dialogs = []
        for page in (first, second):
            click(page.get_by_role("button", name=f"Edit rule: {label}", exact=True))
            dialog = page.get_by_role("dialog", name="Edit rule")
            eventually(page, lambda d=dialog: expect(d).to_be_visible(timeout=POLL_MS), SETTLE_S, "Edit rule opens")
            dialogs.append(dialog)
        select(dialogs[0].get_by_role("combobox", name="Level"), "High")
        click(dialogs[0].get_by_role("button", name="Save rule"))
        gone(first, first.get_by_role("dialog", name="Edit rule"))
        fill(dialogs[1].get_by_role("spinbutton", name="Priority"), "7")
        click(dialogs[1].get_by_role("button", name="Save rule"))
        alert = second.get_by_role("alert").filter(has_text=MESSAGES["stale_version"])
        eventually(second, lambda: expect(alert).to_be_visible(timeout=POLL_MS), SETTLE_S, "stale alert")
        expect(dialogs[1]).to_be_visible()
        expect(dialogs[1].get_by_role("spinbutton", name="Priority")).to_have_value("7")
        expect(alert).to_be_focused()
    saved = [r for r in vault_rules(owner) if r["id"] == rule["id"]][0]
    assert saved["level"] == "high" and saved["version"] == 2 and saved["priority"] == rule["priority"]
    held = add_holding(owner, "Brightway Air", "passport")
    expect_status(owner.patch(f"/api/holdings/{held['id']}", json={"version": 1, "value": "next"}), 200)
    refused(owner.patch(f"/api/holdings/{held['id']}", json={"version": 1, "company": ""}), 409, "stale_version")
    invalid(owner.patch(f"/api/holdings/{held['id']}", json={"value": "x"}), "version", "Send the version you loaded.")
    invalid(owner.patch(f"/api/holdings/{held['id']}", json={"version": 0, "value": "x"}), "version", "Send the version you loaded.")
    breach = log_breach(owner, "Brightway Air", ["passport"])
    expect_status(owner.patch(f"/api/breaches/{breach['id']}", json={"version": 1, "data_kinds": ["passport", "email"]}), 200)
    refused(owner.patch(f"/api/breaches/{breach['id']}", json={"version": 1, "data_kinds": []}), 409, "stale_version")
    current = holding_of(owner, held["id"])
    raced = together([lambda v=v: owner.patch(f"/api/holdings/{held['id']}", json={"version": current["version"], "value": v}) for v in ("left", "right")])
    assert sorted(r.status_code for r in raced) == [200, 409]
    winner = [r for r in raced if r.status_code == 200][0].json()["holding"]
    after = holding_of(owner, held["id"])
    assert after["value"] == winner["value"] and after["version"] == current["version"] + 1


def test_rule_limit_race(app_url: str) -> None:
    owner = new_owner(app_url)
    for _ in range(RULE_LIMIT - 1 - DEFAULT_RULES):
        add_rule(owner, "email", "low")
    results = together([lambda: owner.post("/api/rules", json={"data_kind": "phone", "level": "low"}) for _ in range(RACERS)])
    assert sorted(r.status_code for r in results) == [201] + [409] * (RACERS - 1)
    for r in results:
        if r.status_code == 409:
            refused(r, 409, "rule_limit")
    assert len(vault_rules(owner)) == RULE_LIMIT
    expect_status(owner.delete(f"/api/rules/{vault_rules(owner)[-1]['id']}"), 204)
    stale_ids = [r["id"] for r in vault_rules(owner)]
    newcomer = add_rule(owner, "password", "low")
    before = vault_rules(owner)
    invalid(owner.put("/api/rules/order", json={"rule_ids": list(reversed(stale_ids))}), "rule_ids", "List every rule exactly once.")
    with_ghost = [r["id"] for r in before] + [ghost(newcomer["id"])]
    invalid(owner.put("/api/rules/order", json={"rule_ids": with_ghost}), "rule_ids", "List every rule exactly once.")
    assert vault_rules(owner) == before


def test_rule_edit_moves_contact_view(app_url: str) -> None:
    owner = new_owner(app_url)
    rule = add_rule(owner, "any", "critical", "clinic", 1)
    health = add_holding(owner, "Larchfield Clinic", "health_record", "Patient LC-208113")
    phone = add_holding(owner, "Larchfield Clinic", "phone", "+44 7700 900412")
    add_holding(owner, "Parcelwise", "home_address", "14 Wren Row, Aldmoor")
    contact, _ = new_contact(owner, ["moderate", "low"])
    ids = {health["id"], phone["id"]}
    assert not ids & {h["id"] for h in holdings_of(contact)["items"]}
    with stream_of(contact) as s:
        moved = expect_status(owner.patch(f"/api/rules/{rule['id']}", json={"version": rule["version"], "level": "moderate"}), 200)["rule"]
        assert s.wait(lambda st: len(st.changes("view.changed")) >= 1, LIVE_S), "no view.changed within two seconds"
        seen = {h["id"]: h["value"] for h in holdings_of(contact)["items"]}
        assert seen.get(health["id"]) == "Patient LC-208113" and seen.get(phone["id"]) == "+44 7700 900412", seen
        expect_status(owner.patch(f"/api/rules/{rule['id']}", json={"version": moved["version"], "level": "high"}), 200)
        assert s.wait(lambda st: len(st.changes("view.changed")) >= 2, LIVE_S), "no second view.changed"
    assert not ids & {h["id"] for h in holdings_of(contact)["items"]}
    refused(contact.get(f"/api/holdings/{health['id']}"), 404, "not_found")


def reorder_vault(owner: Actor) -> dict[str, Any]:
    add_holding(owner, "Larchfield Clinic", "phone", "+44 7700 900412")
    log_breach(owner, "Larchfield Clinic", ["phone"])
    return add_rule(owner, "any", "high", "clinic")


def test_wf_rule_reorder_drag(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    rule = reorder_vault(owner)
    label = "Any kind at clinic is High"
    ids = [r["id"] for r in vault_rules(owner)]
    moved = [rule["id"]] + [i for i in ids if i != rule["id"]]
    projected = expect_status(owner.post("/api/rules/preview", json={"rule_ids": moved}), 200)["score"]
    with app_page(browser, app_url, "/vault/rules", owner, height=TALL_VIEWPORT) as page:
        handle = page.get_by_role("button", name=f"Move rule: {label}", exact=True)
        top = page.get_by_role("button", name=f"Move rule: {DEFAULT_RULE_LABELS[0]}", exact=True)
        expect(handle).to_be_visible()
        preview = page.get_by_role("region", name="Preview")
        row = page.get_by_role("table", name="Preview levels").get_by_role("row").filter(has_text="Larchfield Clinic")
        shows(page, row, re.compile("Low"))
        x0, y0 = center(handle)
        box = top.bounding_box()
        assert box, "the top rule's move handle has no box"
        y1 = box["y"] + box["height"] * 0.1
        page.mouse.move(x0, y0)
        page.mouse.down()
        for i in range(1, 11):
            page.mouse.move(x0, y0 + (y1 - y0) * i / 10)
            advance(page, REORDER_PREVIEW_MS)
        shows(page, row, re.compile("High"))
        shows(page, preview, re.compile(rf"Projected score {projected}\b"))
        assert vault_rules(owner)[0]["id"] != rule["id"], "the order saved before the drop"
        page.mouse.up()
        shows(page, page.get_by_role("status", name="Exposure updates"), f"Rule order saved. Exposure score {projected}.")
    assert vault_rules(owner)[0]["id"] == rule["id"] and exposure_of(owner)["score"] == projected


def test_preview_equals_saved(app_url: str) -> None:
    owner = new_owner(app_url)
    ada_like(owner)
    add_holding(owner, "Larchfield Clinic", "date_of_birth")
    add_holding(owner, "Larchfield Clinic", "passport")
    log_breach(owner, "Larchfield Clinic", ["date_of_birth", "passport"])
    clinic = add_rule(owner, "any", "low", "clinic")
    ids = [r["id"] for r in vault_rules(owner)]
    for order in (list(reversed(ids)), [clinic["id"]] + [i for i in ids if i != clinic["id"]]):
        preview = expect_status(owner.post("/api/rules/preview", json={"rule_ids": order}), 200)
        saved = expect_status(owner.put("/api/rules/order", json={"rule_ids": order}), 200)
        assert [r["id"] for r in saved["rules"]] == order and [r["priority"] for r in saved["rules"]] == list(range(1, len(order) + 1))
        listing = holdings_of(owner)
        assert preview["levels"] == [{"holding_id": h["id"], "level": h["level"]} for h in listing["items"]]
        assert preview["score"] == listing["exposure"]["score"] == saved["exposure"]["score"] == exposure_of(owner)["score"]


def test_wf_rule_reorder_keyboard(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    rule = reorder_vault(owner)
    label = "Any kind at clinic is High"
    total = len(vault_rules(owner))
    with app_page(browser, app_url, "/vault/rules", owner, height=TALL_VIEWPORT) as page:
        handle = page.get_by_role("button", name=f"Move rule: {label}", exact=True)
        status = page.get_by_role("status", name="Rule order")
        handle.focus()
        page.keyboard.press("Space")
        shows(page, status, f"Picked up {label}. Position {total} of {total}.")
        page.keyboard.press("ArrowUp")
        shows(page, status, f"Position {total - 1} of {total}.")
        page.keyboard.press("Escape")
        shows(page, status, "Move cancelled.")
        expect(handle).to_be_focused()
        assert vault_rules(owner)[-1]["id"] == rule["id"]
        page.keyboard.press("Space")
        shows(page, status, f"Picked up {label}. Position {total} of {total}.")
        for _ in range(total - 1):
            page.keyboard.press("ArrowUp")
            advance(page, REORDER_PREVIEW_MS)
        shows(page, status, f"Position 1 of {total}.")
        page.keyboard.press("Enter")
        shows(page, status, f"Dropped {label}. Position 1 of {total}.")
        eventually(page, lambda: expect(handle).to_be_focused(timeout=POLL_MS), SETTLE_S, "focus stays on the handle")
        poll(lambda: vault_rules(owner)[0]["id"] == rule["id"], SETTLE_S, "the dropped rule is saved first")


def test_wf_rule_reorder_refused(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    rule = reorder_vault(owner)
    label = "Any kind at clinic is High"
    with app_page(browser, app_url, "/vault/rules", owner, height=TALL_VIEWPORT) as page:
        held: list[Route] = []
        page.route("**/api/rules/order", lambda route: held.append(route))
        handle = page.get_by_role("button", name=f"Move rule: {label}", exact=True)
        handle.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowUp")
        advance(page, REORDER_PREVIEW_MS)
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("status", name="Rule order"), re.compile(rf"^Dropped {re.escape(label)}\."))
        eventually(page, lambda: None if held else pytest.fail("no reorder sent"), SETTLE_S, "reorder sent")
        add_rule(owner, "email", "high")
        page.unroute("**/api/rules/order")
        held[0].continue_()
        alert = page.get_by_role("alert").filter(has_text="The rules changed in another window. The order was not saved.")
        eventually(page, lambda: expect(alert).to_be_visible(timeout=POLL_MS), SETTLE_S, "refusal alert")
        shows(page, page.get_by_role("list", name="Rules").get_by_role("listitem").filter(has_text="Email address is High"), re.compile("Email address is High"))
        shows(page, page.get_by_role("region", name="Preview"), re.compile(rf"Projected score {exposure_of(owner)['score']}\b"))
        expect(handle).to_be_focused()
    saved = [r for r in vault_rules(owner) if r["id"] == rule["id"]][0]
    assert saved["priority"] == rule["priority"]


def test_wf_breach_logging_keyboard(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    for kind, value, notes in BRIGHTWAY:
        add_holding(owner, "Brightway Air", kind, value, notes or None)
    add_holding(owner, "Copperleaf Bank", "bank_account")
    today = Postgres().rows("select current_date::text as d")[0]["d"]
    with app_page(browser, app_url, "/vault", owner) as page:
        mark(page)
        form = open_breach_form(page)
        box = form.get_by_role("combobox", name="Company")
        expect(box).to_be_focused()
        expect(form.get_by_role("textbox", name="Announced on")).to_have_value(today)
        box.press("b")
        listbox = page.get_by_role("listbox", name="Company suggestions")
        eventually(page, lambda: expect(listbox.get_by_role("option")).to_have_text(["Brightway Air", "Copperleaf Bank"], timeout=POLL_MS), SETTLE_S, "suggestions for b")
        box.press("ArrowDown")
        box.press("Enter")
        gone(page, page.get_by_role("listbox", name="Company suggestions"))
        check(kind_box(form, "Passport"))
        check(kind_box(form, "Date of birth"))
        shows(page, page.get_by_role("status", name="Breach preview"), "Preview: holdings touched 2, projected score 48.")
        click(form.get_by_role("button", name="Save breach"))
        shows(page, page.get_by_role("status", name="Exposure updates"), "Breach logged. Holdings touched: 2. Exposure score 48.")
        eventually(page, lambda: expect(page.get_by_role("list", name="Next steps").get_by_role("checkbox")).to_have_count(4, timeout=POLL_MS), SETTLE_S, "four steps")
        expect(step_box(page, STEPS["passport"][0], "Brightway Air")).to_be_visible()
        assert still_marked(page)
    breaches = expect_status(owner.get("/api/breaches"), 200)["breaches"]
    assert [(b["company"], sorted(b["data_kinds"]), b["announced_on"]) for b in breaches] == [("Brightway Air", ["date_of_birth", "passport"], today)]
    assert exposure_of(owner)["score"] == 48


def copperleaf_vault(owner: Actor) -> None:
    for kind in ("bank_account", "payment_card", "home_address"):
        add_holding(owner, "Copperleaf Bank", kind)
    add_holding(owner, "Parcelwise", "phone")


def test_blast_preview_motion(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    copperleaf_vault(owner)
    kinds = ["bank_account", "payment_card", "home_address"]
    projected = expect_status(owner.post("/api/breaches/preview", json={"company": "Copperleaf Bank", "data_kinds": kinds}), 200)["score"]
    with app_page(browser, app_url, "/vault", owner) as page:
        form = open_breach_form(page)
        for code in kinds:
            check(kind_box(form, LABEL[code]))
        advance(page, COUNT_MAX_MS)
        rows = [ledger_row(page, LABEL[code]) for code in kinds]
        box = form.get_by_role("combobox", name="Company")

        def run(company: str) -> tuple[list[int | None], list[int]]:
            start = [touched(r) for r in rows]
            with page.expect_response(lambda r: "/api/breaches/preview" in r.url and company in (r.request.post_data or "")):
                fill(box, company)
                advance(page, COMPANY_PAUSE_MS)
            changed: list[int | None] = [None] * len(rows)
            values: list[int] = []
            for t in range(0, COUNT_MAX_MS + 1, 10):
                for i, r in enumerate(rows):
                    if changed[i] is None and touched(r) != start[i]:
                        changed[i] = t
                values.append(numeral(page))
                advance(page, 10)
            return changed, values

        lit, values = run("Copperleaf Bank")
        assert all(t is not None for t in lit), f"rows not all lit within {COUNT_MAX_MS} ms: {lit}"
        assert lit == sorted(lit) and len(set(lit)) > 1, f"rows did not light one by one in ledger order: {lit}"
        assert values[-1] == projected and values == sorted(values), values
        assert any(0 < v < projected for v in values), f"the numeral jumped instead of counting: {values}"
        assert "Preview" in (page.get_by_role("region", name="Exposure").text_content() or "")
        cleared, values = run("")
        assert all(t is not None for t in cleared), cleared
        assert cleared == sorted(cleared, reverse=True) and len(set(cleared)) > 1, f"rows did not clear in reverse: {cleared}"
        assert values[-1] == 0 and values == sorted(values, reverse=True), values


def test_reduced_motion_blast(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    copperleaf_vault(owner)
    kinds = ["bank_account", "payment_card"]
    projected = expect_status(owner.post("/api/breaches/preview", json={"company": "Copperleaf Bank", "data_kinds": kinds}), 200)["score"]
    with app_page(browser, app_url, "/vault", owner, reduced_motion="reduce") as page:
        form = open_breach_form(page)
        for code in kinds:
            check(kind_box(form, LABEL[code]))
        with page.expect_response(lambda r: "/api/breaches/preview" in r.url and "Copperleaf" in (r.request.post_data or "")):
            fill(form.get_by_role("combobox", name="Company"), "Copperleaf Bank")
            advance(page, COMPANY_PAUSE_MS)
        advance(page, 16)
        for code in kinds:
            row = ledger_row(page, LABEL[code])
            assert "Touched" in row.inner_text(), f"{code} row shows no visible Touched label at once"
            assert not animations(row), f"{code} row animates under reduced motion"
        assert numeral(page) == projected
        assert not animations(page.get_by_role("region", name="Exposure"))
        expect(page.get_by_role("status", name="Breach preview")).to_have_text(f"Preview: holdings touched 2, projected score {projected}.")


def test_committed_score_check(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    for kind, value, notes in BRIGHTWAY:
        add_holding(owner, "Brightway Air", kind, value, notes or None)
    mismatch = "The saved score differs from the preview. Showing the saved score."
    with app_page(browser, app_url, "/vault", owner) as page:
        form = open_breach_form(page)
        pick_company(page, form, "Brightway Air")
        check(kind_box(form, "Passport"))
        check(kind_box(form, "Date of birth"))
        shows(page, page.get_by_role("status", name="Breach preview"), "Preview: holdings touched 2, projected score 48.")
        click(form.get_by_role("button", name="Save breach"))
        numeral_is(page, 48)
        advance(page, COUNT_MAX_MS)
        expect(page.get_by_role("region", name="Exposure")).not_to_contain_text("Preview", use_inner_text=True)
        expect(page.get_by_role("alert").filter(has_text=mismatch)).to_have_count(0)

        def bump(route: Route) -> None:
            if route.request.method != "POST":
                route.continue_()
                return
            response = route.fetch()
            body = response.json()
            body["exposure"]["score"] += POINTS["low"]
            route.fulfill(response=response, json=body)
        page.route("**/api/breaches", bump)
        form = open_breach_form(page)
        pick_company(page, form, "Brightway Air")
        check(kind_box(form, "Email address"))
        preview = expect_status(owner.post("/api/breaches/preview", json={"company": "Brightway Air", "data_kinds": ["email"]}), 200)["score"]
        shows(page, page.get_by_role("status", name="Breach preview"), f"Preview: holdings touched 1, projected score {preview}.")
        click(form.get_by_role("button", name="Save breach"))
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text=mismatch)).to_be_visible(timeout=POLL_MS), SETTLE_S, "mismatch alert")


BREACH_CASES = {
    "company_missing": ("company", None, "Required."),
    "date_malformed": ("announced_on", "20/10/2026", "Use a date in the form YYYY-MM-DD."),
    "date_future": ("announced_on", "2999-12-31", "Date cannot be in the future."),
    "kinds_empty": ("data_kinds", [], "Tick at least one data kind."),
    "kinds_missing": ("data_kinds", None, "Tick at least one data kind."),
    "kinds_repeated": ("data_kinds", ["passport", "passport"], "Each data kind can appear once."),
    "kinds_unknown": ("data_kinds", ["passport_scan"], "Choose a data kind from the list."),
}


@pytest.mark.parametrize("case", list(BREACH_CASES), ids=list(BREACH_CASES))
def test_breach_validation(app_url: str, case: str) -> None:
    field, value, message = BREACH_CASES[case]
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport")
    existing = log_breach(owner, "Brightway Air", ["passport"])
    body: dict[str, Any] = {"company": "Brightway Air", "announced_on": ANNOUNCED, "data_kinds": ["email"]}
    if value is None:
        body.pop(field)
    else:
        body[field] = value
    invalid(owner.post("/api/breaches", json=body), field, message)
    if field == "data_kinds" and value is not None:
        invalid(owner.patch(f"/api/breaches/{existing['id']}", json={"version": 1, "data_kinds": value}), field, message)
    breaches = expect_status(owner.get("/api/breaches"), 200)["breaches"]
    assert [b["id"] for b in breaches] == [existing["id"]] and breaches[0]["version"] == 1


def test_wf_breach_logging_replay(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport")
    cookie = {"Cookie": f"{SESSION_COOKIE}={owner.session}"}
    body = {"company": "Brightway Air", "announced_on": ANNOUNCED, "data_kinds": ["passport"]}
    key_one, _ = fresh("key")
    first = post_json(app_url, "/api/breaches", body, key_one, **cookie)
    replay = post_json(app_url, "/api/breaches", body, key_one, **cookie)
    assert first.status_code == replay.status_code == 201 and first.json() == replay.json()
    refused(post_json(app_url, "/api/breaches", {**body, "data_kinds": ["email"]}, key_one, **cookie), 409, "idempotency_conflict")
    key_two, _ = fresh("key")
    raced = together([lambda: post_json(app_url, "/api/breaches", {**body, "announced_on": ANNOUNCED}, key_two, **cookie) for _ in range(RACERS)])
    assert [r.status_code for r in raced] == [201] * RACERS and len({json.dumps(r.json(), sort_keys=True) for r in raced}) == 1
    assert len(expect_status(owner.get("/api/breaches"), 200)["breaches"]) == 2
    expect_status(owner.delete(f"/api/breaches/{first.json()['breach']['id']}"), 204)
    after_delete = post_json(app_url, "/api/breaches", body, key_one, **cookie)
    assert after_delete.status_code == 201 and after_delete.json() == first.json()
    assert len(expect_status(owner.get("/api/breaches"), 200)["breaches"]) == 1
    with app_page(browser, app_url, "/vault", owner) as page:
        form = open_breach_form(page)
        pick_company(page, form, "Brightway Air")
        check(kind_box(form, "Passport"))
        form.get_by_role("button", name="Save breach").dblclick()
        shows(page, page.get_by_role("status", name="Exposure updates"), re.compile(r"^Breach logged\."))
    assert len(expect_status(owner.get("/api/breaches"), 200)["breaches"]) == 2, "a double-clicked Save logged twice"


def test_company_suggestions(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    companies = ["Brightway Air", "Copperleaf Bank", "Harbor Gym", "Larchfield Clinic", "Parcelwise", "Quayside Mobile", "Tally Rent", *EXTRA_COMPANIES]
    for company in companies:
        add_holding(owner, company, "email")
    expected = sorted(companies, key=str.lower)[:SUGGESTION_MAX]
    picked: list[str] = []
    with app_page(browser, app_url, "/vault", owner,
                  before=lambda p: p.on("request", lambda r: picked.append((r.post_data_json or {}).get("company", "")) if "/api/breaches/preview" in r.url else None)) as page:
        for width, height in VIEWPORTS.values():
            page.set_viewport_size({"width": width, "height": height})
            form = open_breach_form(page)
            box = form.get_by_role("combobox", name="Company")
            box.press("ArrowDown")
            options = page.get_by_role("listbox", name="Company suggestions").get_by_role("option")
            eventually(page, lambda: expect(options).to_have_text(expected, timeout=POLL_MS), SETTLE_S, f"suggestions at {width}")
            for i in range(options.count()):
                option = options.nth(i)
                option.scroll_into_view_if_needed()
                x, y = center(option)
                assert option.evaluate("(el, p) => el.contains(document.elementFromPoint(p[0], p[1]))", [x, y]), f"option {i} covered at {width}"
            click(options.last)
            gone(page, page.get_by_role("listbox", name="Company suggestions"))
            advance(page, COMPANY_PAUSE_MS)
            eventually(page, lambda: None if expected[-1] in picked else pytest.fail(str(picked[-3:])), SETTLE_S, "click picks")
            fill(box, "b")
            eventually(page, lambda: expect(options.first).to_be_visible(timeout=POLL_MS), SETTLE_S, "list reopens")
            names = options.all_text_contents()
            assert names == sorted(names, key=str.lower) and all("b" in n.lower() for n in names), names
            box.press("ArrowDown")
            active = box.get_attribute("aria-activedescendant")
            want = page.evaluate("id => document.getElementById(id) && document.getElementById(id).textContent.trim()", active) if active else None
            box.press("Enter")
            gone(page, page.get_by_role("listbox", name="Company suggestions"))
            expect(box).to_be_focused()
            advance(page, COMPANY_PAUSE_MS)
            eventually(page, lambda: None if picked and picked[-1] in names and (want is None or picked[-1] == want) else pytest.fail(str(picked[-1:])), SETTLE_S, "Enter picks the active option")
            box.press("ArrowDown")
            box.press("Escape")
            gone(page, page.get_by_role("listbox", name="Company suggestions"))
            expect(form).to_be_visible()
            box.press("Escape")
            gone(page, page.get_by_role("form", name="Log breach"))
            expect(page.get_by_role("button", name="Log breach")).to_be_focused()
    assert expect_status(owner.get("/api/breaches"), 200)["breaches"] == [], "Enter submitted the form"


def test_breach_form_closed_after_cancel(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport")
    with app_page(browser, app_url, "/vault", owner) as page:
        for width, height in VIEWPORTS.values():
            page.set_viewport_size({"width": width, "height": height})
            opener = page.get_by_role("button", name="Log breach")
            expect(page.get_by_role("textbox", name="Announced on")).to_have_count(0)
            form = open_breach_form(page)
            expect(form.get_by_role("textbox", name="Announced on")).to_be_visible()
            click(form.get_by_role("button", name="Cancel"))
            gone(page, page.get_by_role("form", name="Log breach"))
            expect(opener).to_be_focused()
            expect(page.get_by_role("textbox", name="Announced on")).to_have_count(0)
            expect(page.get_by_role("button", name="Save breach")).to_have_count(0)
            assert not {"Announced on", "Save breach", "Cancel"} & set(tab_order(page, 30)), f"closed form reachable at {width}"
    assert expect_status(owner.get("/api/breaches"), 200)["breaches"] == []


def test_wf_breach_detail_edit_kinds(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    holdings, breach = ada_like(owner)
    projected = expect_status(owner.post("/api/breaches/preview", json={"company": "Brightway Air", "data_kinds": ["passport"], "breach_id": breach["id"]}), 200)["score"]
    with app_page(browser, app_url, "/vault/breaches", owner) as page:
        click(page.get_by_role("link", name=f"Brightway Air — {ANNOUNCED}"))
        eventually(page, lambda: expect(page.get_by_role("heading", name="Breach at Brightway Air")).to_be_visible(timeout=POLL_MS), SETTLE_S, "detail opens")
        assert urlsplit(page.url).path == f"/vault/breaches/{breach['id']}"
        group = page.get_by_role("group", name="Data kinds")
        expect(group.get_by_role("checkbox", name="Passport", exact=True)).to_be_checked()
        expect(group.get_by_role("checkbox", name="Date of birth", exact=True)).to_be_checked()
        expect(group.get_by_role("checkbox", name="Email address", exact=True)).not_to_be_checked()
        rows = [" ".join(t.split()) for t in page.get_by_role("table", name="Affected holdings").get_by_role("row").all_text_contents()]
        body_rows = [r for r in rows if "Brightway Air" in r]
        assert len(body_rows) == 2 and "Passport" in body_rows[0] and "Date of birth" in body_rows[1], rows
        expect(page.get_by_role("list", name="Steps for this breach").get_by_role("listitem")).to_have_count(4)
        assert not re.search(rf"\b{projected}\b", body_text(page))
        group.get_by_role("checkbox", name="Date of birth", exact=True).uncheck()
        eventually(page, lambda: None if re.search(rf"\b{projected}\b", body_text(page)) else pytest.fail("no projected score"), SETTLE_S, "projection shown")
        click(page.get_by_role("button", name="Save kinds"))
        shows(page, page.get_by_role("status", name="Exposure updates"), f"Breach updated. Exposure score {projected}.")
    saved = expect_status(owner.get(f"/api/breaches/{breach['id']}"), 200)
    assert saved["breach"]["data_kinds"] == ["passport"] and saved["breach"]["version"] == 2
    assert saved["breach"]["affected_holding_ids"] == [holdings["passport"]["id"]] and exposure_of(owner)["score"] == projected


def test_edit_breach_kinds(app_url: str) -> None:
    owner = new_owner(app_url)
    holdings, breach = ada_like(owner)
    exposure = exposure_of(owner)
    passport_one = find_step(exposure, STEPS["passport"][0])
    dob_two = find_step(exposure, STEPS["date_of_birth"][1])
    expect_status(owner.post(f"/api/steps/{passport_one['id']}/done"), 200)
    expect_status(owner.post(f"/api/steps/{dob_two['id']}/done"), 200)
    narrowed = expect_status(owner.patch(f"/api/breaches/{breach['id']}", json={"version": 1, "data_kinds": ["passport"]}), 200)
    assert narrowed["breach"]["version"] == 2 and narrowed["breach"]["affected_holding_ids"] == [holdings["passport"]["id"]]
    assert holding_of(owner, holdings["date_of_birth"]["id"])["affected"] is False
    after = exposure_of(owner)
    assert {s["holding_id"] for s in after["steps"]} == {holdings["passport"]["id"]}
    assert find_step(after, STEPS["passport"][0])["id"] == passport_one["id"] and find_step(after, STEPS["passport"][0])["status"] == "done"
    assert after["score"] == narrowed["exposure"]["score"] == POINTS["critical"]
    widened = expect_status(owner.patch(f"/api/breaches/{breach['id']}", json={"version": 2, "data_kinds": ["passport", "date_of_birth"]}), 200)
    again = exposure_of(owner)
    assert find_step(again, STEPS["date_of_birth"][1])["status"] == "open", "the dropped holding kept its done mark"
    assert widened["breach"]["version"] == 3 and again["score"] == POINTS["critical"] + 2 * POINTS["moderate"]


def test_remove_breach(app_url: str) -> None:
    owner = new_owner(app_url)
    holdings, breach = ada_like(owner)
    path = f"/api/breaches/{breach['id']}"
    assert expect_status(owner.delete(path), 204) is None
    for method, body in (("GET", None), ("PATCH", {"version": 1, "data_kinds": ["email"]}), ("DELETE", None)):
        refused(owner.app.request(method, path, json=body), 404, "not_found")
    assert all(not holding_of(owner, h["id"])["affected"] for h in holdings.values())
    exposure = exposure_of(owner)
    assert exposure["score"] == 0 and exposure["steps"] == [] and exposure["band"] == "Clear" and exposure["affected_count"] == 0
    assert breach["id"] not in [b["id"] for b in expect_status(owner.get("/api/breaches"), 200)["breaches"]]


def test_not_found_page(browser: Browser, app_url: str) -> None:
    me, other = new_owner(app_url), new_owner(app_url)
    mine = add_holding(me, "Parcelwise", "phone")
    theirs, breach = ada_like(other)
    paths = [f"/vault/holdings/{theirs['passport']['id']}", f"/vault/breaches/{breach['id']}", f"/vault/holdings/{ghost(mine['id'])}", "/vault/nowhere", "/nowhere"]
    with app_page(browser, app_url, "/vault", me) as page:
        for path in paths:
            response = page.goto(app_url + path)
            assert response is not None and response.status == 404, f"{path} answered {response.status if response else None}"
            expect(page.get_by_role("heading", name="Not found")).to_be_visible()
            expect(page.get_by_text("This record does not exist or is not in your view.")).to_be_visible()
            expect(page.get_by_role("link", name="Back to ledger")).to_be_visible()
            assert "P 5520 4471 8" not in page.content()


def test_breach_form_survives_refresh(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport")
    with app_page(browser, app_url, "/vault", owner) as page:
        form = open_breach_form(page)
        pick_company(page, form, "Brightway Air")
        check(kind_box(form, "Passport"))
        check(kind_box(form, "Date of birth"))
        kind_box(form, "Date of birth").focus()
        status = page.get_by_role("status", name="Breach preview")
        shows(page, status, f"Preview: holdings touched 1, projected score {2 * POINTS['critical']}.")
        add_holding(owner, "Brightway Air", "date_of_birth", "1986-03-14")
        eventually(page, lambda: expect(ledger_row(page, "Date of birth")).to_have_count(1, timeout=POLL_MS), LIVE_S + 1, "redraw shows the new row")
        shows(page, status, "Preview: holdings touched 2, projected score 48.")
        expect(form).to_be_visible()
        expect(kind_box(form, "Passport")).to_be_checked()
        expect(kind_box(form, "Date of birth")).to_be_checked()
        expect(kind_box(form, "Date of birth")).to_be_focused()
        assert "Brightway Air" in (form.get_by_role("combobox", name="Company").input_value())


def test_unsaved_edits_survive_refresh(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport")
    add_holding(owner, "Brightway Air", "email")
    breach = log_breach(owner, "Brightway Air", ["passport"])
    with app_page(browser, app_url, f"/vault/breaches/{breach['id']}", owner) as page:
        group = page.get_by_role("group", name="Data kinds")
        dob = group.get_by_role("checkbox", name="Date of birth", exact=True)
        check(dob)
        dob.focus()
        expect_status(owner.patch(f"/api/breaches/{breach['id']}", json={"version": 1, "data_kinds": ["passport", "email"]}), 200)
        table = page.get_by_role("table", name="Affected holdings").get_by_role("row").filter(has_text="Email address")
        eventually(page, lambda: expect(table).to_have_count(1, timeout=POLL_MS), LIVE_S + 1, "affected table renewed")
        expect(dob).to_be_checked()
        expect(group.get_by_role("checkbox", name="Email address", exact=True)).not_to_be_checked()
        expect(dob).to_be_focused()
        click(page.get_by_role("button", name="Save kinds"))
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text=MESSAGES["stale_version"])).to_be_visible(timeout=POLL_MS), SETTLE_S, "stale alert")
        expect(group.get_by_role("checkbox", name="Email address", exact=True)).to_be_checked()
        expect(dob).not_to_be_checked()
    assert sorted(expect_status(owner.get(f"/api/breaches/{breach['id']}"), 200)["breach"]["data_kinds"]) == ["email", "passport"]


def test_wf_breach_detail_draft(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport")
    keys: list[str | None] = []
    visited: list[str] = []

    def expire_once(route: Route) -> None:
        if route.request.method == "POST":
            keys.append(route.request.headers.get("idempotency-key"))
            if len(keys) == 1:
                route.fulfill(status=401, json={"error": {"code": "signed_out", "message": MESSAGES["signed_out"]}})
                return
        route.continue_()
    with app_page(browser, app_url, "/vault", owner) as page:
        realm_cookies(page, owner)
        page.on("request", lambda req: visited.append(req.url))
        page.route("**/api/breaches", expire_once)
        form = open_breach_form(page)
        pick_company(page, form, "Brightway Air")
        check(kind_box(form, "Passport"))
        click(form.get_by_role("button", name="Save breach"))

        def restored() -> None:
            assert any("/auth/login" in u for u in visited), f"no sign-in round trip: {visited}"
            expect(page).to_have_url(re.compile(r"/vault$"), timeout=POLL_MS)
            expect(page.get_by_role("status", name="Draft restored")).to_have_text(
                "Your session ended. Your unsaved entries were kept; check them and save again.", timeout=POLL_MS)
        eventually(page, restored, NAV_MS / 1000, "draft restored after sign-in")
        form = page.get_by_role("form", name="Log breach")
        expect(kind_box(form, "Passport")).to_be_checked()
        expect(form.get_by_role("button", name="Save breach")).to_be_focused()
        assert expect_status(owner.get("/api/breaches"), 200)["breaches"] == [], "the draft saved itself"
        click(form.get_by_role("button", name="Save breach"))
        shows(page, page.get_by_role("status", name="Exposure updates"), re.compile(r"^Breach logged\."))
    assert len(keys) >= 2 and keys[0] and keys[-1] == keys[0], f"the restored save used another key: {keys}"
    assert len(expect_status(owner.get("/api/breaches"), 200)["breaches"]) == 1


def test_wf_next_steps_click(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ada_like(owner)
    text = STEPS["passport"][0]
    with app_page(browser, app_url, "/vault", owner) as page:
        box = step_box(page, text, "Brightway Air")
        click(box)
        shows(page, page.get_by_role("status", name="Exposure updates"), f"Step marked done. Exposure score {48 - POINTS['critical']}.")
        expect(box).to_be_checked()
        assert find_step(exposure_of(owner), text)["status"] == "done"
        click(box)
        shows(page, page.get_by_role("status", name="Exposure updates"), "Step reopened. Exposure score 48.")
        numeral_is(page, 48)
    assert find_step(exposure_of(owner), text)["status"] == "open" and exposure_of(owner)["score"] == 48


def test_step_order_and_score(app_url: str) -> None:
    owner = new_owner(app_url)
    assert exposure_of(owner)["band"] == "Clear"
    add_rule(owner, "any", "critical", "clinic", 1)
    holdings, _ = ada_like(owner)
    start = exposure_of(owner)
    assert start["score"] == 48 and start["band"] == "Exposed" and start["affected_count"] == 2 and start["open_steps"] == 4
    assert [(s["text"], s["points"], s["company"]) for s in start["steps"]] == [
        (STEPS["passport"][0], 20, "Brightway Air"), (STEPS["passport"][1], 20, "Brightway Air"),
        (STEPS["date_of_birth"][0], 4, "Brightway Air"), (STEPS["date_of_birth"][1], 4, "Brightway Air")]
    passphrase = find_step(start, STEPS["date_of_birth"][0])
    larch = add_holding(owner, "Larchfield Clinic", "date_of_birth", "1986-03-14")
    assert larch["level"] == "critical"
    preview = expect_status(owner.post("/api/breaches/preview", json={"company": "Larchfield Clinic", "data_kinds": ["date_of_birth"]}), 200)
    assert preview["current_score"] == 48 and preview["score"] == 84 and preview["affected_holding_ids"] == [larch["id"]]
    breach = log_breach(owner, "Larchfield Clinic", ["date_of_birth"])
    now = exposure_of(owner)
    assert now["score"] == 84 and now["open_steps"] == 5 and now["affected_count"] == 3
    order = [(s["text"], s["company"]) for s in now["steps"]]
    assert order == [(STEPS["passport"][0], "Brightway Air"), (STEPS["passport"][1], "Brightway Air"), (STEPS["date_of_birth"][0], "Brightway Air"),
                     (STEPS["date_of_birth"][1], "Larchfield Clinic"), (STEPS["date_of_birth"][1], "Brightway Air")], order
    shared = find_step(now, STEPS["date_of_birth"][0])
    assert shared["id"] == passphrase["id"] and shared["level"] == "critical" and shared["points"] == 20
    assert shared["holding_id"] == holdings["date_of_birth"]["id"] and shared["number"] == 1
    assert holdings_of(owner)["exposure"]["score"] == 84 and holdings_of(owner)["exposure"]["band"] == "Exposed"
    detail = expect_status(owner.get(f"/api/breaches/{breach['id']}"), 200)
    assert shared in detail["steps"]
    add_holding(owner, "Tally Rent", "national_id")
    tally = log_breach(owner, "Tally Rent", ["national_id"])
    assert exposure_of(owner)["band"] == band_for(84 + 2 * POINTS["critical"]) == "Severe"
    expect_status(owner.delete(f"/api/breaches/{tally['id']}"), 204)
    expect_status(owner.delete(f"/api/holdings/{larch['id']}"), 204)
    end = exposure_of(owner)
    assert end["score"] == 48 and find_step(end, STEPS["date_of_birth"][0])["id"] == passphrase["id"]


def test_step_transitions(app_url: str) -> None:
    owner = new_owner(app_url)
    ada_like(owner)
    sid = find_step(exposure_of(owner), STEPS["passport"][0])["id"]
    done = expect_status(owner.post(f"/api/steps/{sid}/done", json={}), 200)
    assert done["step"]["status"] == "done" and done["exposure"]["score"] == 48 - POINTS["critical"]
    refused(owner.post(f"/api/steps/{sid}/done"), 409, "step_already_done")
    reopened = expect_status(owner.post(f"/api/steps/{sid}/reopen"), 200)
    assert reopened["step"]["status"] == "open" and reopened["exposure"]["score"] == 48
    refused(owner.post(f"/api/steps/{sid}/reopen"), 409, "step_already_open")
    for verb, code in (("done", "step_already_done"), ("reopen", "step_already_open")):
        raced = together([lambda: owner.post(f"/api/steps/{sid}/{verb}") for _ in range(2)])
        assert sorted(r.status_code for r in raced) == [200, 409], [r.status_code for r in raced]
        refused([r for r in raced if r.status_code == 409][0], 409, code)
    refused(owner.post(f"/api/steps/{ghost(sid)}/done"), 404, "not_found")


def test_wf_next_steps_keyboard(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ada_like(owner)
    first = find_step(exposure_of(owner), STEPS["passport"][0])
    expect_status(owner.post(f"/api/steps/{first['id']}/done"), 200)
    with app_page(browser, app_url, "/vault", owner) as page:
        boxes = page.get_by_role("list", name="Next steps").get_by_role("checkbox")
        expect(boxes).to_have_count(4)
        page.get_by_role("button", name="Log breach").focus()
        for _ in range(40):
            page.keyboard.press("Tab")
            if boxes.evaluate_all("els => els.includes(document.activeElement)"):
                break
        expect(boxes.nth(1)).to_be_focused()
        page.keyboard.press("Home")
        expect(boxes.nth(0)).to_be_focused()
        page.keyboard.press("ArrowUp")
        expect(boxes.nth(0)).to_be_focused()
        page.keyboard.press("End")
        expect(boxes.nth(3)).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(boxes.nth(3)).to_be_focused()
        page.keyboard.press("ArrowUp")
        target_box = step_box(page, STEPS["date_of_birth"][0], "Brightway Air")
        expect(target_box).to_be_focused()
        page.keyboard.press("Space")
        shows(page, page.get_by_role("status", name="Exposure updates"), re.compile(r"^Step marked done\."))
        expect(target_box).to_be_focused()
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("status", name="Exposure updates"), re.compile(r"^Step reopened\."))
        expect(target_box).to_be_focused()
        page.keyboard.press("Tab")
        assert not boxes.evaluate_all("els => els.includes(document.activeElement)"), "the list is more than one Tab stop"
    assert find_step(exposure_of(owner), STEPS["date_of_birth"][0])["status"] == "open"


def test_exposure_announcements(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ada_like(owner)
    with app_page(browser, app_url, "/vault", owner) as page:
        click(page.get_by_role("button", name="Add holding"))
        dialog = page.get_by_role("dialog", name="Add holding")
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=POLL_MS), SETTLE_S, "dialog opens")
        fill(dialog.get_by_role("textbox", name="Company"), "Brightway Air")
        select(dialog.get_by_role("combobox", name="Data kind"), "Payment card")
        fill(dialog.get_by_role("textbox", name="Value"), "4929 1180 2231 6604")
        click(dialog.get_by_role("button", name="Save holding"))
        shows(page, page.get_by_role("status", name="Exposure updates"), f"Holding saved. Exposure score {exposure_of(owner)['score']}.")
        card = [h for h in holdings_of(owner)["items"] if h["data_kind"] == "payment_card"][0]
        page.goto(f"{app_url}/vault/holdings/{card['id']}")
        click(page.get_by_role("button", name="Delete holding"))
        alert = page.get_by_role("alertdialog", name="Delete holding?")
        click(alert.get_by_role("button", name="Delete", exact=True))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/vault$"), timeout=POLL_MS), SETTLE_S, "back on the ledger")
        shows(page, page.get_by_role("status", name="Exposure updates"), f"Holding deleted. Exposure score {exposure_of(owner)['score']}.")


def test_honest_step_toggles(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ada_like(owner)
    add_holding(owner, "Copperleaf Bank", "bank_account")
    log_breach(owner, "Copperleaf Bank", ["bank_account"])
    passport = find_step(exposure_of(owner), STEPS["passport"][0])
    with app_page(browser, app_url, "/vault", owner, before=lambda p: p.route("**/api/events", lambda r: r.abort())) as page:
        box = step_box(page, STEPS["passport"][0], "Brightway Air")
        expect(box).not_to_be_checked()
        expect_status(owner.post(f"/api/steps/{passport['id']}/done"), 200)
        box.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text="This step was already changed in another window.")).to_be_visible(timeout=POLL_MS), SETTLE_S, "conflict alert")
        expect(box).to_be_checked()
        numeral_is(page, exposure_of(owner)["score"])
        expect(box).to_be_focused()
        score = exposure_of(owner)["score"]
        second = step_box(page, STEPS["bank_account"][1], "Copperleaf Bank")
        second.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text=MESSAGES["step_out_of_order"])).to_be_visible(timeout=POLL_MS), SETTLE_S, "order alert")
        eventually(page, lambda: expect(second).not_to_be_checked(timeout=POLL_MS), SETTLE_S, "rolled back")
        assert numeral(page) == score
        expect(second).to_be_focused()
        bank = step_box(page, STEPS["bank_account"][0], "Copperleaf Bank")
        page.route("**/api/steps/**", lambda r: r.abort())
        bank.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text="Something went wrong. Your change was not saved.")).to_be_visible(timeout=POLL_MS), SETTLE_S, "failure alert")
        eventually(page, lambda: expect(bank).not_to_be_checked(timeout=POLL_MS), SETTLE_S, "rolled back after failure")
        assert numeral(page) == score
        expect(bank).to_be_focused()
        page.unroute("**/api/steps/**")
        held: list[Route] = []
        page.route("**/api/steps/**", lambda r: held.append(r))
        page.keyboard.press("Space")
        eventually(page, lambda: expect(bank).to_be_checked(timeout=POLL_MS), SETTLE_S, "flips at once")
        expect(page.get_by_role("list", name="Next steps")).to_contain_text("Working...")
        assert numeral(page) == score
        page.keyboard.press("Space")
        advance(page, COUNT_MAX_MS)
        assert len(held) == 1, f"a second toggle sent {len(held)} requests"
        page.unroute("**/api/steps/**")
        held[0].continue_()
        shows(page, page.get_by_role("status", name="Exposure updates"), f"Step marked done. Exposure score {score - POINTS['high']}.")
        numeral_is(page, score - POINTS["high"])
        expect(bank).to_be_focused()


def test_steps_in_order(app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Copperleaf Bank", "bank_account")
    log_breach(owner, "Copperleaf Bank", ["bank_account"])
    one = find_step(exposure_of(owner), STEPS["bank_account"][0])
    two = find_step(exposure_of(owner), STEPS["bank_account"][1])
    refused(owner.post(f"/api/steps/{two['id']}/done"), 409, "step_out_of_order")
    expect_status(owner.post(f"/api/steps/{one['id']}/done"), 200)
    expect_status(owner.post(f"/api/steps/{two['id']}/done"), 200)
    with stream_of(owner) as s:
        reopened = expect_status(owner.post(f"/api/steps/{one['id']}/reopen"), 200)
        assert reopened["step"]["id"] == one["id"] and reopened["exposure"]["score"] == 2 * POINTS["high"]
        assert s.wait(lambda st: {c["id"] for c in st.changes("step.updated")} >= {one["id"], two["id"]}, LIVE_S), "cascade events missing"
    assert {s_["status"] for s_ in exposure_of(owner)["steps"]} == {"open"}
    add_holding(owner, "Tally Rent", "national_id")
    log_breach(owner, "Tally Rent", ["national_id"])
    fraud = find_step(exposure_of(owner), STEPS["national_id"][1])
    report = find_step(exposure_of(owner), STEPS["national_id"][0])
    expect_status(owner.post(f"/api/steps/{fraud['id']}/done"), 200)
    expect_status(owner.post(f"/api/steps/{report['id']}/done"), 200)
    expect_status(owner.post(f"/api/steps/{report['id']}/reopen"), 200)
    assert find_step(exposure_of(owner), STEPS["national_id"][1])["status"] == "done", "a person-level step cascaded"


def test_shared_person_level_steps(app_url: str) -> None:
    owner = new_owner(app_url)
    add_rule(owner, "national_id", "moderate", "quayside", 1)
    quay = add_holding(owner, "Quayside Mobile", "national_id")
    tally = add_holding(owner, "Tally Rent", "national_id")
    first = log_breach(owner, "Quayside Mobile", ["national_id"])
    fraud = find_step(exposure_of(owner), STEPS["national_id"][1])
    assert (fraud["level"], fraud["points"], fraud["holding_id"], fraud["number"]) == ("moderate", POINTS["moderate"], quay["id"], 2)
    expect_status(owner.post(f"/api/steps/{fraud['id']}/done"), 200)
    second = log_breach(owner, "Tally Rent", ["national_id"])
    exposure = exposure_of(owner)
    shared = [s for s in exposure["steps"] if s["text"] == STEPS["national_id"][1]]
    assert len(shared) == 1 and shared[0]["id"] == fraud["id"] and shared[0]["status"] == "done"
    assert shared[0]["level"] == "critical" and shared[0]["points"] == POINTS["critical"] and shared[0]["holding_id"] == quay["id"]
    assert exposure["score"] == POINTS["moderate"] + POINTS["critical"]
    expect_status(owner.delete(f"/api/breaches/{first['id']}"), 204)
    left = find_step(exposure_of(owner), STEPS["national_id"][1])
    assert left["id"] == fraud["id"] and left["status"] == "done" and left["holding_id"] == tally["id"]
    expect_status(owner.delete(f"/api/breaches/{second['id']}"), 204)
    assert all(s["text"] != STEPS["national_id"][1] for s in exposure_of(owner)["steps"])
    log_breach(owner, "Tally Rent", ["national_id"])
    assert find_step(exposure_of(owner), STEPS["national_id"][1])["status"] == "open"


def test_wf_holding_deletion_confirm(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    holdings, _ = ada_like(owner)
    hid = holdings["passport"]["id"]
    with app_page(browser, app_url, f"/vault/holdings/{hid}", owner) as page:
        expect(page.get_by_text("Graded by Passport is Critical")).to_be_visible()
        opener = page.get_by_role("button", name="Delete holding")
        click(opener)
        dialog = page.get_by_role("alertdialog", name="Delete holding?")
        eventually(page, lambda: expect(dialog.get_by_role("button", name="Keep")).to_be_focused(timeout=POLL_MS), SETTLE_S, "focus on Keep")
        click(dialog.get_by_role("button", name="Keep"))
        gone(page, page.get_by_role("alertdialog", name="Delete holding?"))
        expect(opener).to_be_focused()
        click(opener)
        click(page.get_by_role("alertdialog", name="Delete holding?").get_by_role("button", name="Delete", exact=True))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/vault$"), timeout=POLL_MS), SETTLE_S, "back on /vault")
        eventually(page, lambda: expect(page.get_by_role("button", name="Add holding")).to_be_focused(timeout=POLL_MS), SETTLE_S, "focus on Add holding")
        expect(ledger_row(page, "Passport")).to_have_count(0)
    refused(owner.get(f"/api/holdings/{hid}"), 404, "not_found")


def test_deleted_leave_every_surface(app_url: str) -> None:
    owner = new_owner(app_url)
    holdings, breach = ada_like(owner)
    contact, _ = new_contact(owner)
    hid = holdings["passport"]["id"]
    expect_status(owner.delete(f"/api/holdings/{hid}"), 204)
    for actor in (owner, contact):
        refused(actor.get(f"/api/holdings/{hid}"), 404, "not_found")
        listing = holdings_of(actor)
        assert hid not in [h["id"] for h in listing["items"]] and listing["total"] == 2
        assert "passport" not in listing["facets"]["data_kind"] and listing["facets"]["company"] == {"Brightway Air": 2}
        assert holdings_of(actor, q="passport")["total"] == 0
        assert listing["exposure"]["score"] == 2 * POINTS["moderate"]
        assert all(s["holding_id"] != hid for s in exposure_of(actor)["steps"])
        detail = expect_status(actor.get(f"/api/breaches/{breach['id']}"), 200)
        assert detail["breach"]["affected_holding_ids"] == [holdings["date_of_birth"]["id"]]
        assert hid not in [h["id"] for h in detail["holdings"]]
    assert holdings_of(owner, q="5520")["total"] == 0
    refused(owner.delete(f"/api/holdings/{hid}"), 404, "not_found")


def test_id_only_events(app_url: str) -> None:
    owner = new_owner(app_url)
    secrets = ["P 5520 4471 8", "Saved for online check-in", "Brightway Air", owner.email]
    with stream_of(owner) as s:
        h = add_holding(owner, "Brightway Air", "passport", "P 5520 4471 8", "Saved for online check-in")
        expect_status(owner.patch(f"/api/holdings/{h['id']}", json={"version": 1, "notes": "Joint account with Ines"}), 200)
        rule = add_rule(owner, "any", "high", "bright")
        expect_status(owner.patch(f"/api/rules/{rule['id']}", json={"version": 1, "level": "moderate"}), 200)
        expect_status(owner.delete(f"/api/rules/{rule['id']}"), 204)
        b = log_breach(owner, "Brightway Air", ["passport"])
        expect_status(owner.patch(f"/api/breaches/{b['id']}", json={"version": 1, "data_kinds": ["passport", "email"]}), 200)
        sid = find_step(exposure_of(owner), STEPS["passport"][0])["id"]
        expect_status(owner.post(f"/api/steps/{sid}/done"), 200)
        _, _, grant, _ = grant_to(owner, ["low"])
        expect_status(owner.delete("/api/grant"), 200)
        expect_status(owner.delete(f"/api/breaches/{b['id']}"), 204)
        expect_status(owner.delete(f"/api/holdings/{h['id']}"), 204)
        expected = sorted([("holding.created", h["id"]), ("holding.updated", h["id"]), ("rule.created", rule["id"]), ("rule.updated", rule["id"]),
                           ("rule.deleted", rule["id"]), ("breach.created", b["id"]), ("breach.updated", b["id"]), ("step.updated", sid),
                           ("grant.created", grant["id"]), ("grant.updated", grant["id"]), ("breach.deleted", b["id"]), ("holding.deleted", h["id"])])
        got = lambda st: sorted((c.get("type"), c.get("id")) for c in st.changes())
        assert s.wait(lambda st: len(got(st)) >= len(expected), LIVE_S), f"events missing: {got(s)}"
        s.wait(lambda st: len(got(st)) > len(expected), LIVE_S)
        assert got(s) == expected, f"events {got(s)} != {expected}"
        for name, payload, raw, _ in s.events:
            assert name == "change" and set(payload) == {"type", "id"}, raw
            assert not any(secret in raw for secret in secrets), f"an event leaked a value: {raw}"


def test_stream_release(app_url: str) -> None:
    owner = new_owner(app_url)
    pg = Postgres()
    count = "select count(*)::int as n, count(*) filter (where state in ('active', 'idle in transaction'))::int as busy from pg_stat_activity where application_name = 'strongroom'"
    before = pg.rows(count)[0]["n"]
    with httpx.Client(base_url=app_url, cookies={SESSION_COOKIE: owner.session}, timeout=HTTP_TIMEOUT) as client:
        for _ in range(STREAM_ROUNDS):
            with client.stream("GET", "/api/events") as r:
                assert r.status_code == 200
    def released() -> bool:
        row = pg.rows(count)[0]
        return row["n"] <= before + SESSION_SLACK and row["busy"] == 0
    poll(released, RELEASE_S, "strongroom database sessions released after closed streams")
    expect_status(owner.get("/api/holdings"), 200)


def test_wf_holding_deletion_double_click(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    holdings, _ = ada_like(owner)
    hid = holdings["passport"]["id"]
    deletes: list[str] = []
    with stream_of(owner) as s:
        with app_page(browser, app_url, f"/vault/holdings/{hid}", owner,
                      before=lambda p: p.on("request", lambda r: deletes.append(r.url) if r.method == "DELETE" else None)) as page:
            click(page.get_by_role("button", name="Delete holding"))
            dialog = page.get_by_role("alertdialog", name="Delete holding?")
            eventually(page, lambda: expect(dialog).to_be_visible(timeout=POLL_MS), SETTLE_S, "confirm opens")
            dialog.get_by_role("button", name="Delete", exact=True).dblclick()
            eventually(page, lambda: expect(page).to_have_url(re.compile(r"/vault$"), timeout=POLL_MS), SETTLE_S, "back on /vault")
        assert len(deletes) == 1, f"{len(deletes)} DELETE requests sent"
        assert s.wait(lambda st: len(st.changes("holding.deleted")) >= 1, LIVE_S)
        refused(owner.delete(f"/api/holdings/{hid}"), 404, "not_found")
        assert not s.wait(lambda st: len(st.changes("holding.deleted")) > 1, LIVE_S), "more than one holding.deleted"


def test_wf_grant_access_dialog(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    name, email = fresh("granted")
    with app_page(browser, app_url, "/vault/contact", owner) as page:
        expect(page.get_by_text("No trusted contact. Add one to share a read-only view while you are away.")).to_be_visible()
        click(page.get_by_role("button", name="Add trusted contact"))
        dialog = page.get_by_role("dialog", name="Grant access")
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=POLL_MS), SETTLE_S, "dialog opens")
        fill(dialog.get_by_role("textbox", name="Contact name"), name)
        fill(dialog.get_by_role("textbox", name="Contact email"), email[0].upper() + email[1:])
        check(dialog.get_by_role("radio", name="7 days"))
        for level, label in LEVEL_LABEL.items():
            box = dialog.get_by_role("group", name="Levels shown").get_by_role("checkbox", name=label, exact=True)
            check(box) if level in ("critical", "high") else box.uncheck()
        click(dialog.get_by_role("button", name="Grant access", exact=True))
        eventually(page, lambda: expect(dialog.get_by_text(TEMP_PASSWORD)).to_be_visible(timeout=POLL_MS), SETTLE_S, "temporary password shown")
        temporary = TEMP_PASSWORD.search(dialog.text_content() or "").group(1)
        expect(dialog.get_by_role("button", name="Done")).to_be_focused()
        shows(page, page.get_by_role("status", name="Grant updates"), f"Access granted to {name}.")
        click(dialog.get_by_role("button", name="Done"))
        gone(page, page.get_by_role("dialog", name="Grant access"))
        assert temporary not in page.content(), "the temporary password stayed on the page"
    grant = expect_status(owner.get("/api/grant"), 200)["grant"]
    assert (grant["status"], grant["duration"], sorted(grant["levels"]), grant["contact_email"]) == ("active", "7d", ["critical", "high"], email)
    users = [u for u in Keycloak().users(email) if (u.get("email") or "").lower() == email]
    assert len(users) == 1, users
    user = users[0]
    assert user["username"] == email and user["enabled"] and user["emailVerified"] and user["firstName"] == name
    assert "UPDATE_PASSWORD" in (user.get("requiredActions") or []), user
    _, r = sign_in(app_url, email, temporary, new_password=CONTACT_PASSWORD)
    assert target(r) == "/shared"


def test_grant_rules(app_url: str) -> None:
    owner = new_owner(app_url)
    other = new_owner(app_url)
    _, _, grant, _ = grant_to(owner, ["low"], "30d")
    assert int(epoch(grant["ends_at"]) - epoch(grant["created_at"])) == GRANT_HOURS["30d"] * GRANT_HOUR_S
    assert grant["status"] == "active" and 0 < grant["remaining_seconds"] <= GRANT_HOURS["30d"] * GRANT_HOUR_S
    refused(owner.post("/api/grant", json={"contact_name": "", "contact_email": "x", "duration": "1y", "levels": []}), 409, "grant_active")
    expect_status(owner.delete("/api/grant"), 200)
    name, email = fresh("contact")
    good = {"contact_name": name, "contact_email": email, "duration": "24h", "levels": ["low"]}
    for field, value, message in [("duration", "1y", "Choose 24h, 7d or 30d."), ("levels", [], "Choose at least one level."),
                                  ("contact_email", "not-an-email", "Enter an email address."),
                                  ("contact_email", other.email, "This email cannot be used for a trusted contact."),
                                  ("contact_name", "", "Required."), ("status", "active", "This field cannot be set.")]:
        invalid(owner.post("/api/grant", json={**good, field: value}), field, message)
    assert expect_status(owner.get("/api/grant"), 200)["grant"]["status"] == "revoked"
    second = fresh("contact")[1]
    raced = together([lambda: owner.post("/api/grant", json=good), lambda: owner.post("/api/grant", json={**good, "contact_email": second})])
    assert sorted(r.status_code for r in raced) == [201, 409]
    refused([r for r in raced if r.status_code == 409][0], 409, "grant_active")


GRANT_DIALOG_NAMES = {"Contact name", "Contact email", "24 hours", "7 days", "30 days", "Critical", "High", "Moderate", "Low", "Grant access", "Cancel"}


def test_grant_dialog_keyboard(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    with app_page(browser, app_url, "/vault/contact", owner) as page:
        opener = page.get_by_role("button", name="Add trusted contact")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Grant access")
        eventually(page, lambda: expect(dialog.get_by_role("textbox", name="Contact name")).to_be_focused(timeout=POLL_MS), SETTLE_S, "focus on Contact name")
        names = tab_order(page, len(GRANT_DIALOG_NAMES) + 4)
        assert set(names) <= GRANT_DIALOG_NAMES, f"Tab left the dialog: {names}"
        dialog.get_by_role("textbox", name="Contact name").focus()
        page.keyboard.press("Shift+Tab")
        assert dialog.evaluate("d => d.contains(document.activeElement)"), "Shift+Tab left the dialog"
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("dialog", name="Grant access"))
        expect(opener).to_be_focused()
    assert expect_status(owner.get("/api/grant"), 200)["grant"] is None


def test_wf_grant_access_contact_view(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport", "P 5520 4471 8")
    add_holding(owner, "Copperleaf Bank", "home_address", "14 Wren Row, Aldmoor")
    log_breach(owner, "Brightway Air", ["passport"])
    contact, _ = new_contact(owner)
    with app_page(browser, app_url, "/shared", contact) as page:
        expect(page.get_by_role("heading", name=f"Shared by {owner.name}")).to_be_visible()
        remaining = expect_status(contact.get("/api/contact/grant"), 200)["remaining_seconds"]
        expect(page.get_by_role("status", name="Access time")).to_have_text(f"Access ends in {fmt_remaining(remaining)}")
        table = page.get_by_role("table", name="Holdings")
        expect(table).to_contain_text("* **** *471 8")
        expect(table).to_contain_text("14 Wren Row, Aldmoor")
        assert "P 5520 4471 8" not in page.content()
        assert numeral(page) == exposure_of(contact)["score"] == 2 * POINTS["critical"]
        items = page.get_by_role("list", name="Next steps").get_by_role("listitem")
        expect(items).to_have_count(2)
        expect(items.first).to_contain_text("Open")
        for control in ("Add holding", "Log breach"):
            expect(page.get_by_role("button", name=control)).to_have_count(0)
        expect(page.get_by_role("list", name="Next steps").get_by_role("checkbox")).to_have_count(0)
        page.goto(app_url + "/vault")
        expect(page).to_have_url(re.compile(r"/shared$"))


def test_contact_projection(app_url: str) -> None:
    owner = new_owner(app_url)
    holdings, breach = ada_like(owner)
    contact, _ = new_contact(owner)
    listing = holdings_of(contact)
    assert set(listing) == {"items", "total", "facets", "exposure"}
    assert all(set(h) == CONTACT_HOLDING_KEYS for h in listing["items"])
    assert set(holding_of(contact, holdings["passport"]["id"])) == CONTACT_HOLDING_KEYS
    exposure = exposure_of(contact)
    assert set(exposure) == EXPOSURE_KEYS and all(set(s) == STEP_KEYS for s in exposure["steps"])
    assert all(set(b) == CONTACT_BREACH_KEYS for b in expect_status(contact.get("/api/breaches"), 200)["breaches"])
    detail = expect_status(contact.get(f"/api/breaches/{breach['id']}"), 200)
    assert set(detail) == {"breach", "holdings", "steps"} and set(detail["breach"]) == CONTACT_BREACH_KEYS
    assert all(set(h) == CONTACT_HOLDING_KEYS for h in detail["holdings"])
    assert set(expect_status(contact.get("/api/contact/grant"), 200)) == CONTACT_GRANT_KEYS
    assert set(expect_status(contact.get("/api/me"), 200)) == {"role", "name", "email"}
    for path in ("/api/holdings", f"/api/holdings/{holdings['passport']['id']}", "/api/breaches", f"/api/breaches/{breach['id']}", "/api/exposure", "/api/contact/grant"):
        raw = contact.get(path).text
        assert "Saved for online check-in" not in raw and '"version"' not in raw and '"notes"' not in raw, path
    refused(owner.get("/api/contact/grant"), 404, "not_found")


def test_server_masking(app_url: str) -> None:
    assert mask("P 5520 4471 8") == "* **** *471 8" and mask("4929 1180 2231 6604") == "**** **** **** 6604"
    owner = new_owner(app_url)
    made = [add_holding(owner, c, k, v) for c, k, v in [
        ("Brightway Air", "passport", "P 5520 4471 8"), ("Copperleaf Bank", "payment_card", "4929 1180 2231 6604"),
        ("Tally Rent", "national_id", "QQ 12 34 56 C"), ("Tally Rent", "passport", SHORT_VALUE),
        ("Copperleaf Bank", "home_address", "14 Wren Row, Aldmoor"), ("Parcelwise", "phone", "+44 7700 900412")]]
    breach = log_breach(owner, "Tally Rent", ["passport", "national_id"])
    contact, _ = new_contact(owner)
    seen = {h["id"]: h["value"] for h in holdings_of(contact)["items"]}
    for h in made:
        want = mask(h["value"]) if h["level"] in ("critical", "high") else h["value"]
        assert seen[h["id"]] == want == holding_of(contact, h["id"])["value"], (h["value"], seen[h["id"]])
        assert holding_of(owner, h["id"])["value"] == h["value"]
    assert not any(c.isalnum() for c in seen[made[3]["id"]]), "a value of four or fewer letters and digits was not fully replaced"
    for h in expect_status(contact.get(f"/api/breaches/{breach['id']}"), 200)["holdings"]:
        assert h["value"] == seen[h["id"]]


def test_grant_realm_atomic(app_url: str) -> None:
    owner = new_owner(app_url)
    kc = Keycloak()
    emails = [fresh("contact")[1] for _ in range(2)]
    raced = together([lambda e=e: owner.post("/api/grant", json={"contact_name": "Ines Marsh", "contact_email": e, "duration": "30d", "levels": ["low"]}) for e in emails])
    assert sorted(r.status_code for r in raced) == [201, 409]
    winner = emails[[r.status_code for r in raced].index(201)]
    loser = emails[1 - emails.index(winner)]
    realm = lambda e: [u for u in kc.users(e) if (u.get("email") or "").lower() == e]
    assert len(realm(winner)) == 1 and realm(loser) == [], "the losing request created a realm user"
    user_id = realm(winner)[0]["id"]
    expect_status(owner.delete("/api/grant"), 200)
    again = together([lambda: owner.post("/api/grant", json={"contact_name": "Ines Marsh", "contact_email": winner, "duration": "30d", "levels": ["low"]}) for _ in range(2)])
    assert sorted(r.status_code for r in again) == [201, 409]
    assert [u["id"] for u in realm(winner)] == [user_id]
    temporary = [r for r in again if r.status_code == 201][0].json()["temporary_password"]
    _, r = sign_in(app_url, winner, temporary, new_password=CONTACT_PASSWORD)
    assert target(r) == "/shared"
    expect_status(owner.delete("/api/grant"), 200)
    down = os.environ["APP_KEYCLOAK_DOWN_URL"]
    stray = fresh("contact")[1]
    with owner.on(down) as client:
        refused(client.post("/api/grant", json={"contact_name": "Ines Marsh", "contact_email": stray, "duration": "30d", "levels": ["low"]}), 503, "identity_unavailable")
    latest = expect_status(owner.get("/api/grant"), 200)["grant"]
    assert latest["status"] == "revoked" and latest["contact_email"] == winner and realm(stray) == []


def scoped_vault(owner: Actor) -> dict[str, dict[str, Any]]:
    return {"critical": add_holding(owner, "Brightway Air", "passport", "P 5520 4471 8"),
            "high": add_holding(owner, "Copperleaf Bank", "payment_card", "4929 1180 2231 6604"),
            "moderate": add_holding(owner, "Copperleaf Bank", "home_address", "14 Wren Row, Aldmoor")}


def test_narrow_scope(app_url: str) -> None:
    owner = new_owner(app_url)
    made = scoped_vault(owner)
    contact, grant = new_contact(owner, ["critical", "high", "moderate"])
    with stream_of(contact) as s:
        narrowed = expect_status(owner.patch("/api/grant", json={"levels": ["critical", "moderate"]}), 200)["grant"]
        assert sorted(narrowed["levels"]) == ["critical", "moderate"]
        assert s.wait(lambda st: {"type": "grant.updated", "id": grant["id"]} in st.changes(), LIVE_S), "no grant.updated within two seconds"
    ids = [h["id"] for h in holdings_of(contact)["items"]]
    assert made["high"]["id"] not in ids and made["critical"]["id"] in ids
    refused(contact.get(f"/api/holdings/{made['high']['id']}"), 404, "not_found")
    assert realm_ends_session(contact), "the contact's realm session survived the narrow"
    invalid(owner.patch("/api/grant", json={"levels": ["critical", "moderate", "low"]}), "levels", "Scope can only be narrowed. Revoke and grant again to widen it.")
    invalid(owner.patch("/api/grant", json={"levels": []}), "levels", "Choose at least one level.")
    invalid(owner.patch("/api/grant", json={"levels": ["critical"], "contact_email": "x@example.com"}), "contact_email", "This field cannot be set.")
    same = expect_status(owner.patch("/api/grant", json={"levels": ["moderate", "critical"]}), 200)["grant"]
    assert sorted(same["levels"]) == ["critical", "moderate"]


def test_revoke_access(app_url: str) -> None:
    owner = new_owner(app_url)
    scoped_vault(owner)
    contact, _ = new_contact(owner)
    with stream_of(contact) as s:
        revoked = expect_status(owner.delete("/api/grant"), 200)["grant"]
        assert revoked["status"] == "revoked" and revoked["remaining_seconds"] == 0
        assert s.wait(lambda st: st.closed, LIVE_S), "the contact's stream stayed open"
        assert [(n, p) for n, p, _, _ in s.events] == [("access-ended", {})], s.events
    refused(contact.get("/api/holdings"), 401, "signed_out")
    assert realm_ends_session(contact)
    assert expect_status(owner.get("/api/grant"), 200)["grant"]["status"] == "revoked"


def test_contact_live_events(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    scoped_vault(owner)
    contact, grant = new_contact(owner)
    opened: list[str] = []

    def watch(p: Page) -> None:
        p.on("response", lambda r: opened.append(r.url) if "/api/events" in r.url else None)

    with stream_of(contact) as s, app_page(browser, app_url, "/shared", contact, before=watch) as page:
        updates = page.get_by_role("status", name="Shared updates")
        deadline = time.monotonic() + SETTLE_S
        while not opened and time.monotonic() < deadline:
            advance(page, POLL_MS)
        advance(page, LIVE_S * 1000)
        add_holding(owner, "Parcelwise", "phone", "+44 7700 900412")
        assert s.wait(lambda st: len(st.changes("view.changed")) >= 1, LIVE_S)
        shows(page, updates, "Shared view updated.", LIVE_S + 1)
        add_rule(owner, "phone", "low", "parcel")
        assert s.wait(lambda st: len(st.changes("view.changed")) >= 2, LIVE_S)
        before = len(s.changes())
        expect_status(owner.patch("/api/grant", json={"levels": ["critical", "high", "moderate"]}), 200)
        assert s.wait(lambda st: {"type": "grant.updated", "id": grant["id"]} in st.changes(), LIVE_S)
        shows(page, updates, "The owner narrowed what you can see.", LIVE_S + 1)
        assert all(c == {"type": "grant.updated", "id": grant["id"]} for c in s.changes()[before:]), s.changes()[before:]
        for name, payload, raw, _ in s.events:
            assert name == "change" and payload in ({"type": "view.changed", "id": None}, {"type": "grant.updated", "id": grant["id"]}), raw
            assert "Parcelwise" not in raw and "+44" not in raw


def test_wf_narrow_revoke_watched(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    scoped_vault(owner)
    contact, grant = new_contact(owner)
    contact_name = grant["contact_name"]
    with app_page(browser, app_url, "/vault/contact", owner) as own, app_page(browser, app_url, "/shared", contact) as shared:
        card = ledger_row(shared, "Payment card")
        expect(card).to_have_count(1)
        mark(shared)
        own.get_by_role("group", name="Levels shown").get_by_role("checkbox", name="High", exact=True).uncheck()
        click(own.get_by_role("button", name="Narrow scope"))
        shows(own, own.get_by_role("status", name="Grant updates"), "Scope narrowed.")
        eventually(shared, lambda: expect(card).to_have_count(0, timeout=POLL_MS), LIVE_S, "the High row left the contact's view")
        click(own.get_by_role("button", name="Revoke access"))
        click(own.get_by_role("alertdialog", name="Revoke access?").get_by_role("button", name="Revoke", exact=True))
        shows(own, own.get_by_role("status", name="Grant updates"), f"Access ended for {contact_name}.")
        eventually(own, lambda: expect(own.get_by_text("Revoked", exact=True)).to_be_visible(timeout=POLL_MS), SETTLE_S, "panel shows Revoked")
        expect(own.get_by_role("button", name="Narrow scope")).to_have_count(0)
        eventually(shared, lambda: expect(shared.get_by_role("heading", name="Access ended")).to_be_visible(timeout=POLL_MS), LIVE_S, "contact sees Access ended")
        expect(shared.get_by_text("This shared view has ended. Ask the vault owner for a new grant.")).to_be_visible()
        assert still_marked(shared), "the contact's screen reloaded"
    latest = expect_status(owner.get("/api/grant"), 200)["grant"]
    assert latest["status"] == "revoked" and "high" not in latest["levels"]


def test_wf_narrow_revoke_race(app_url: str) -> None:
    owner = new_owner(app_url)
    scoped_vault(owner)
    contact, grant = new_contact(owner)
    with stream_of(owner) as so, stream_of(contact) as sc:
        raced = together([lambda: owner.delete("/api/grant") for _ in range(3)])
        assert sorted(r.status_code for r in raced) == [200, 409, 409]
        for r in raced:
            if r.status_code == 409:
                refused(r, 409, "no_active_grant")
        assert so.wait(lambda st: len(st.changes("grant.updated")) >= 1, LIVE_S)
        assert sc.wait(lambda st: st.closed, LIVE_S)
        assert not so.wait(lambda st: len(st.changes("grant.updated")) > 1, LIVE_S), "more than one grant.updated"
        assert len(sc.named("access-ended")) == 1
    _, _, second, _ = grant_to(owner, ["critical", "high"])
    patch, delete = together([lambda: owner.patch("/api/grant", json={"levels": ["critical"]}), lambda: owner.delete("/api/grant")])
    assert delete.status_code == 200
    final = expect_status(owner.get("/api/grant"), 200)["grant"]
    assert final["id"] == second["id"] and final["status"] == "revoked"
    if patch.status_code == 200:
        assert final["levels"] == ["critical"]
    else:
        refused(patch, 409, "no_active_grant")
        assert sorted(final["levels"]) == ["critical", "high"]


def test_contact_cannot_grant(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    add_holding(owner, "Brightway Air", "passport")
    contact, grant = new_contact(owner, ["critical"])
    stray = fresh("intruder")[1]
    refused(contact.post("/api/grant", json={"contact_name": "Stray", "contact_email": stray, "duration": "24h", "levels": ["low"]}), 403, "owner_only")
    refused(contact.get("/api/grant"), 403, "owner_only")
    refused(contact.patch("/api/grant", json={"levels": ["critical"]}), 403, "owner_only")
    refused(contact.delete("/api/grant"), 403, "owner_only")
    latest = expect_status(owner.get("/api/grant"), 200)["grant"]
    assert latest["id"] == grant["id"] and latest["status"] == "active" and latest["levels"] == ["critical"]
    assert not [u for u in Keycloak().users(stray) if (u.get("email") or "").lower() == stray], "a realm user was created"
    expect_status(contact.get("/api/holdings"), 200)
    with app_page(browser, app_url, "/shared", contact) as page:
        expect(page.get_by_role("table", name="Holdings")).to_be_visible()
        for name in ("Revoke access", "Narrow scope", "Add trusted contact"):
            expect(page.get_by_role("button", name=name)).to_have_count(0)


def test_server_remaining_time(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    scoped_vault(owner)
    contact, _ = new_contact(owner)
    fetched: list[str] = []
    with app_page(browser, app_url, "/vault/contact", owner, device_time=DEVICE_TIME,
                  before=lambda p: p.on("request", lambda r: fetched.append(r.url) if urlsplit(r.url).path == "/api/grant" else None)) as page:
        remaining = expect_status(owner.get("/api/grant"), 200)["grant"]["remaining_seconds"]
        eventually(page, lambda: expect(page.get_by_text(f"Access ends in {fmt_remaining(remaining)}")).to_be_visible(timeout=POLL_MS), SETTLE_S, "owner remaining time")
        expect(page.get_by_text("Active", exact=True)).to_be_visible()
        seen = len(fetched)
        advance(page, GRANT_REFRESH_MS)
        eventually(page, lambda: None if len(fetched) > seen else pytest.fail("no refetch"), SETTLE_S, "grant refetched after 15 seconds")
        expect(page.get_by_text(f"Access ends in {fmt_remaining(remaining)}")).to_be_visible()
    with app_page(browser, app_url, "/shared", contact, device_time=DEVICE_TIME) as page:
        remaining = expect_status(contact.get("/api/contact/grant"), 200)["remaining_seconds"]
        shows(page, page.get_by_role("status", name="Access time"), f"Access ends in {fmt_remaining(remaining)}")
        expect(page.get_by_role("heading", name="Access ended")).to_have_count(0)


def short_grant() -> tuple[Actor, Actor, dict[str, Any], Postgres]:
    short = os.environ["APP_SHORT_URL"]
    owner = new_owner(short)
    add_holding(owner, "Copperleaf Bank", "home_address", "14 Wren Row, Aldmoor")
    contact, grant = new_contact(owner, ["moderate"], "24h")
    return owner, contact, grant, Postgres("_short")


def wait_for_end(contact: Actor, pg: Postgres, ends: float, owner: Actor | None = None) -> None:
    deadline = time.monotonic() + SHORT_DAY_S + HTTP_TIMEOUT
    while db_epoch(pg) < ends and time.monotonic() < deadline:
        contact.get("/api/me")
        if owner is not None:
            owner.get("/api/me")
    if db_epoch(pg) < ends:
        pytest.fail("the short grant never reached its end instant")


def test_wf_grant_expiry_edge(app_url: str) -> None:
    owner, contact, grant, pg = short_grant()
    ends = epoch(grant["ends_at"])
    assert int(ends - epoch(grant["created_at"])) == SHORT_DAY_S
    early = contact.get("/api/holdings")
    if db_epoch(pg) > ends - 1:
        pytest.fail("the contact finished signing in too close to the end instant to probe the edge")
    expect_status(early, 200)
    wait_for_end(contact, pg, ends, owner)
    refused(contact.get("/api/holdings"), 403, "access_ended")
    refused(contact.get("/api/exposure"), 403, "access_ended")
    status = expect_status(contact.get("/api/contact/grant"), 200)
    assert status["status"] == "expired" and status["remaining_seconds"] == 0
    assert expect_status(owner.get("/api/grant"), 200)["grant"]["status"] == "expired"


def test_access_ended_screen(browser: Browser, app_url: str) -> None:
    _, contact, grant, pg = short_grant()
    wait_for_end(contact, pg, epoch(grant["ends_at"]))
    with app_page(browser, contact.base, "/shared", contact) as page:
        eventually(page, lambda: expect(page.get_by_role("heading", name="Access ended")).to_be_visible(timeout=POLL_MS), SETTLE_S, "Access ended screen")
        expect(page.get_by_text("This shared view has ended. Ask the vault owner for a new grant.")).to_be_visible()
        expect(page.get_by_role("status", name="Shared updates")).to_have_text("Access ended.")
        expect(page.get_by_role("table", name="Holdings")).to_have_count(0)


def test_wf_grant_expiry_pushed(browser: Browser, app_url: str) -> None:
    _, contact, grant, pg = short_grant()
    ends = epoch(grant["ends_at"])
    with stream_of(contact) as s, app_page(browser, contact.base, "/shared", contact) as page:
        expect(page.get_by_role("table", name="Holdings")).to_be_visible()
        mark(page)
        t0 = time.time()
        db_now = db_epoch(pg)
        t1 = time.time()
        deadline = time.monotonic() + SHORT_DAY_S + HTTP_TIMEOUT
        while not s.wait(lambda st: bool(st.named("access-ended")), 0.5) and time.monotonic() < deadline:
            contact.get("/api/me")
        arrivals = [t for n, _, _, t in s.events if n == "access-ended"]
        assert len(arrivals) == 1, f"access-ended events: {s.events}"
        earliest, latest = arrivals[0] + db_now - t1, arrivals[0] + db_now - t0
        assert latest >= ends, f"access-ended arrived {ends - latest:.3f} s before the end instant"
        assert earliest <= ends + LIVE_S, f"access-ended arrived {earliest - ends:.3f} s after the end instant"
        assert s.wait(lambda st: st.closed, LIVE_S)
        eventually(page, lambda: expect(page.get_by_role("heading", name="Access ended")).to_be_visible(timeout=POLL_MS), LIVE_S, "open screen shows Access ended")
        assert still_marked(page)


def test_grant_dialog_survives_refresh(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    name, email = fresh("pending")
    fetched: list[str] = []
    with app_page(browser, app_url, "/vault/contact", owner,
                  before=lambda p: p.on("request", lambda r: fetched.append(r.url) if urlsplit(r.url).path == "/api/grant" else None)) as page:
        click(page.get_by_role("button", name="Add trusted contact"))
        dialog = page.get_by_role("dialog", name="Grant access")
        fill(dialog.get_by_role("textbox", name="Contact name"), name)
        fill(dialog.get_by_role("textbox", name="Contact email"), email)
        check(dialog.get_by_role("radio", name="7 days"))
        email_box = dialog.get_by_role("textbox", name="Contact email")
        email_box.focus()
        seen = len(fetched)
        add_holding(owner, "Parcelwise", "phone")
        advance(page, GRANT_REFRESH_MS)
        eventually(page, lambda: None if len(fetched) > seen else pytest.fail("no refresh"), SETTLE_S, "grant refreshed")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("textbox", name="Contact name")).to_have_value(name)
        expect(email_box).to_have_value(email)
        expect(dialog.get_by_role("radio", name="7 days")).to_be_checked()
        expect(email_box).to_be_focused()
        click(dialog.get_by_role("button", name="Grant access", exact=True))
        eventually(page, lambda: expect(dialog.get_by_text(TEMP_PASSWORD)).to_be_visible(timeout=POLL_MS), SETTLE_S, "password shown")
        seen = len(fetched)
        add_holding(owner, "Parcelwise", "email")
        advance(page, GRANT_REFRESH_MS)
        eventually(page, lambda: None if len(fetched) > seen else pytest.fail("no refresh"), SETTLE_S, "grant refreshed again")
        expect(dialog.get_by_text(TEMP_PASSWORD)).to_be_visible()
        expect(dialog.get_by_role("button", name="Done")).to_be_focused()
        temporary = TEMP_PASSWORD.search(dialog.text_content() or "").group(1)
        click(dialog.get_by_role("button", name="Done"))
        gone(page, page.get_by_role("dialog", name="Grant access"))
        assert temporary not in page.content()


SIGNED_OUT_ROUTES = [("GET", "/api/me"), ("GET", "/api/kinds"), ("GET", "/api/holdings"), ("GET", "/api/exposure"), ("GET", "/api/breaches"),
                     ("GET", "/api/grant"), ("GET", "/api/contact/grant"), ("GET", "/api/rules"), ("GET", "/api/events"), ("POST", "/api/holdings")]


def test_unfinished_sign_in(app_url: str) -> None:
    pending, _ = clients(app_url)
    start_login(pending)
    owner = new_owner(app_url)
    name, email, _, temporary = grant_to(owner, list(LEVELS))
    half, kc = clients(app_url)
    callback, stop = realm_login(kc, start_login(half), email, temporary)
    assert callback is None and stop is not None and stop.status_code == 200, "the realm issued a code before the password step"
    for client in (pending, half):
        assert client.cookies.get(SIGNIN_COOKIE) and not client.cookies.get(SESSION_COOKIE)
        for method, path in SIGNED_OUT_ROUTES:
            body = {"company": "x", "data_kind": "phone", "value": "x"} if method == "POST" else None
            refused(client.request(method, path, json=body), 401, "signed_out")
        page = client.get("/vault")
        assert page.status_code == 302 and urlsplit(page.headers["location"]).path == "/"
    users = [u for u in Keycloak().users(email) if (u.get("email") or "").lower() == email]
    assert users and "UPDATE_PASSWORD" in (users[0].get("requiredActions") or [])


def test_wf_account_security_change_password(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    with app_page(browser, app_url, "/vault/account", owner) as page:
        form = page.get_by_role("form", name="Change password")
        current, new = form.get_by_label("Current password"), form.get_by_label("New password")
        for cur, nxt, message in [(CHANGED_PASSWORD, CONTACT_PASSWORD, "Current password is incorrect."), (OWNER_PASSWORD, "short", "Use 12 to 128 characters."),
                                  (OWNER_PASSWORD, OWNER_PASSWORD, "New password must differ from the current one.")]:
            fill(current, cur)
            fill(new, nxt)
            click(form.get_by_role("button", name="Change password"))
            eventually(page, lambda m=message: expect(form).to_contain_text(m, timeout=POLL_MS), SETTLE_S, f"field error {message}")
            expect(page.get_by_role("alert").filter(has_text="Check these fields")).to_be_visible()
        fill(current, OWNER_PASSWORD)
        fill(new, CHANGED_PASSWORD)
        click(form.get_by_role("button", name="Change password"))
        shows(page, page.get_by_role("status", name="Account updates"), "Password changed. Other sessions are signed out.")
        expect(page).to_have_url(re.compile(r"/vault/account$"))
        assert page.request.get(app_url + "/api/me").status == 200
    app, kc = clients(app_url)
    callback, _ = realm_login(kc, start_login(app), owner.email, OWNER_PASSWORD)
    assert callback is None, "the old password still signs in"
    sign_in(app_url, owner.email, CHANGED_PASSWORD)


def test_password_change_ends_sessions(app_url: str) -> None:
    owner = new_owner(app_url)
    other, _ = sign_in(app_url, owner.email, OWNER_PASSWORD)
    contact, _ = new_contact(owner)
    changed = expect_status(owner.post("/api/account/password", json={"current_password": OWNER_PASSWORD, "new_password": CHANGED_PASSWORD}), 200)
    assert changed == {"status": "changed"}
    expect_status(owner.get("/api/me"), 200)
    refused(other.get("/api/me"), 401, "signed_out")
    refused(contact.get("/api/holdings"), 401, "signed_out")
    assert realm_ends_session(other) and realm_ends_session(contact), "a realm session survived the password change"


def test_wf_account_security_outage(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_KEYCLOAK_DOWN_URL"]
    owner = new_owner(app_url)
    scoped_vault(owner)
    contact, _ = new_contact(owner)
    with owner.on(down) as client, httpx.Client(base_url=down, timeout=HTTP_TIMEOUT) as anon:
        poll(lambda: anon.get("/api/status").json() == {"identity": "down"}, REALM_CHECK_S + LIVE_S, "GET /api/status reports down")
        assert holdings_of(owner)["total"] == expect_status(client.get("/api/holdings"), 200)["total"]
        expect_status(client.post("/api/holdings", json={"company": "Parcelwise", "data_kind": "phone", "value": VALUE}), 201)
        expect_status(client.patch("/api/grant", json={"levels": ["critical", "high"]}), 200)
        assert expect_status(client.delete("/api/grant"), 200)["grant"]["status"] == "revoked"
        refused(client.post("/api/grant", json={}), 503, "identity_unavailable")
        refused(client.post("/api/account/password", json={"current_password": OWNER_PASSWORD, "new_password": CHANGED_PASSWORD}), 503, "identity_unavailable")
        login = anon.get("/auth/login", follow_redirects=False)
        assert login.status_code == 503 and "Sign-in unavailable" in login.text and MESSAGES["identity_unavailable"] in login.text
    refused(contact.get("/api/holdings"), 401, "signed_out")
    sign_in(app_url, owner.email, OWNER_PASSWORD)
    with app_page(browser, down, "/") as page:
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text=OUTAGE_BANNER)).to_be_visible(timeout=POLL_MS), SETTLE_S, "outage banner")


def test_idle_session_expiry(app_url: str) -> None:
    short = os.environ["APP_SHORT_URL"]
    owner = new_owner(short)
    pg = Postgres("_short")
    with stream_of(owner) as s:
        expect_status(owner.get("/api/me"), 200)
        last = db_epoch(pg)
        deadline = time.monotonic() + SHORT_IDLE_S + HTTP_TIMEOUT
        while db_epoch(pg) < last + SHORT_IDLE_S and time.monotonic() < deadline:
            owner.get("/api/status")
        refused(owner.get("/api/holdings"), 401, "signed_out")
        assert s.wait(lambda st: st.closed, KEEPALIVE_S), "the idle session's stream outlived the next keep-alive"


def test_wf_cross_cutting_health(browser: Browser, app_url: str) -> None:
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT) as client:
        r = client.get("/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert r.headers["content-type"].startswith("application/json")
        assert client.get("/api/status").json() in ({"identity": "ok"}, {"identity": "down"})
    with app_page(browser, app_url, "/") as page:
        expect(page.get_by_role("heading", name="Strongroom Ledger")).to_be_visible()
        expect(page.get_by_role("link", name="Sign in")).to_be_visible()


def test_error_shape(app_url: str) -> None:
    owner = new_owner(app_url)
    held = add_holding(owner, "Brightway Air", "passport")
    bank = add_holding(owner, "Copperleaf Bank", "bank_account")
    contact, _ = new_contact(owner, ["critical"])
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT) as anon:
        assert anon.get("/api/holdings").json() == {"error": {"code": "signed_out", "message": MESSAGES["signed_out"]}}
        refused(anon.post("/api/holdings", json={}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
        refused(anon.post("/api/holdings", content=b" " * (BODY_LIMIT + 1), headers={"Content-Type": "application/json"}), 413, "too_large")
        refused(anon.post("/api/holdings", content=b"x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    assert owner.get(f"/api/holdings/{ghost(held['id'])}").json() == {"error": {"code": "not_found", "message": MESSAGES["not_found"]}}
    refused(owner.patch(f"/api/holdings/{ghost(held['id'])}", json={"version": 1, "company": ""}), 404, "not_found")
    invalid(owner.post("/api/holdings", json={"data_kind": "phone", "value": VALUE}), "company", "Required.")
    refused(contact.patch(f"/api/holdings/{bank['id']}", json={"version": 1, "company": ""}), 404, "not_found")
    refused(contact.patch(f"/api/holdings/{held['id']}", json={"version": 1, "company": ""}), 403, "owner_only")
    refused(contact.put("/api/rules/order", json={"rule_ids": ["no-such-rule"]}), 403, "owner_only")
    invalid(owner.put("/api/rules/order", json={"rule_ids": ["no-such-rule"]}), "rule_ids", "List every rule exactly once.")


def test_server_boundary(app_url: str) -> None:
    owner = new_owner(app_url)
    body = json.dumps({"company": "Parcelwise", "data_kind": "phone", "value": VALUE}).encode()
    exact = body[:-1] + b" " * (BODY_LIMIT - len(body)) + b"}"
    assert len(exact) == BODY_LIMIT
    headers = {"Content-Type": "application/json"}
    assert owner.post("/api/holdings", content=exact, headers=headers).status_code == 201
    refused(owner.post("/api/holdings", content=exact + b" ", headers=headers), 413, "too_large")
    refused(owner.post("/api/holdings", content=body, headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    refused(owner.post("/api/holdings", json={"company": "Tally Rent", "data_kind": "phone", "value": VALUE}, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    parts = urlsplit(app_url)
    same = owner.post("/api/holdings", json={"company": "Tally Rent", "data_kind": "phone", "value": VALUE}, headers={"Origin": f"{parts.scheme}://{parts.netloc}"})
    assert same.status_code == 201
    assert [h["company"] for h in holdings_of(owner)["items"]].count("Tally Rent") == 1
    for path in NEVER_SERVED:
        assert owner.get(path).status_code == 404, f"{path} was served"
    secrets = [v for v in (os.environ.get("AUTH_CLIENT_SECRET"), os.environ.get("DATABASE_URL")) if v]
    pages = [owner.get("/vault").text, owner.get("/").text]
    assets = {a for page in pages for a in re.findall(r'(?:src|href)="(/[^"]+)"', page)}
    for text in pages + [owner.get(a).text for a in assets]:
        assert not any(secret in text for secret in secrets), "a credential reached the browser"


def test_wf_cross_cutting_layout(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ledger_vault(owner)
    add_holding(owner, "Tally Rent", "national_id")
    contact, _ = new_contact(owner)
    for width, height in VIEWPORTS.values():
        for actor, path in ((owner, "/vault"), (owner, "/vault/rules"), (contact, "/shared")):
            with app_page(browser, app_url, path, actor, width=width, height=height) as page:
                anchor = page.get_by_role("list", name="Rules") if path == "/vault/rules" else page.get_by_role("table", name="Holdings")
                expect(anchor).to_be_visible()
                layout(page)
                if path != "/vault":
                    continue
                band = page.get_by_role("button", name="Log breach")
                table = page.get_by_role("table", name="Holdings").bounding_box()
                if width >= TWO_COLUMN_FROM:
                    column = page.get_by_role("region", name="Exposure").bounding_box()
                    assert column["x"] >= table["x"] + table["width"] - 1, "exposure column not beside the ledger"
                else:
                    assert band.bounding_box()["y"] < table["y"], "score band not above the list"
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                advance(page, COUNT_MAX_MS)
                box = band.bounding_box()
                assert box and 0 <= box["y"] and box["y"] + box["height"] <= height, f"score band not pinned at {width}"


def test_touch_reduced_motion(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ada_like(owner)
    size_js = "el => { const n = [el, el.parentElement, ...(el.labels ? Array.from(el.labels) : [])].filter(Boolean).map(x => x.getBoundingClientRect()); return [Math.max(...n.map(b => b.width)), Math.max(...n.map(b => b.height))]; }"
    with app_page(browser, app_url, "/vault", owner, width=375, height=812, reduced_motion="reduce") as page:
        expect(page.get_by_role("table", name="Holdings")).to_be_visible()
        controls = [page.get_by_role("button"), page.get_by_role("combobox"), page.get_by_role("list", name="Next steps").get_by_role("checkbox")]
        for group in controls:
            for i in range(group.count()):
                item = group.nth(i)
                if item.is_visible():
                    w, h = item.evaluate(size_js)
                    assert w >= MIN_TARGET_PX and h >= MIN_TARGET_PX, f"{item} is {w}x{h}"
        click(page.get_by_role("button", name="Menu"))
        links = page.get_by_role("navigation", name="Vault").get_by_role("link")
        for i in range(links.count()):
            box = links.nth(i).bounding_box()
            assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX
        page.keyboard.press("Escape")
        form = open_breach_form(page)
        form.get_by_role("combobox", name="Company").press("ArrowDown")
        options = page.get_by_role("listbox", name="Company suggestions").get_by_role("option")
        eventually(page, lambda: expect(options.first).to_be_visible(timeout=POLL_MS), SETTLE_S, "suggestions open")
        box = options.first.bounding_box()
        assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX
        for label in ("Passport", "Email address"):
            w, h = kind_box(form, label).evaluate(size_js)
            assert w >= MIN_TARGET_PX and h >= MIN_TARGET_PX
        page.keyboard.press("Escape")
        page.keyboard.press("Escape")
        box = step_box(page, STEPS["passport"][0], "Brightway Air")
        with page.expect_response(lambda r: "/api/steps/" in r.url):
            click(box)
        advance(page, 16)
        assert numeral(page) == exposure_of(owner)["score"], "the numeral did not change straight to the final value"
        assert not animations(page.get_by_role("region", name="Exposure"))


BREAKPOINTS = {"w599": 599, "w600": 600, "w1023": 1023, "w1024": 1024}


@pytest.mark.parametrize("case", list(BREAKPOINTS), ids=list(BREAKPOINTS))
def test_exact_breakpoints(browser: Browser, app_url: str, case: str) -> None:
    width = BREAKPOINTS[case]
    owner = new_owner(app_url)
    ada_like(owner)
    with app_page(browser, app_url, "/vault", owner, width=width, height=BREAKPOINT_HEIGHT) as page:
        table = page.get_by_role("table", name="Holdings")
        expect(table).to_be_visible()
        if width < PHONE_BELOW:
            expect(page.get_by_role("button", name="Menu")).to_be_visible()
            expect(page.get_by_role("link", name="Breaches")).to_have_count(0)
        else:
            expect(page.get_by_role("button", name="Menu")).to_have_count(0)
            expect(page.get_by_role("link", name="Breaches")).to_be_visible()
        t = table.bounding_box()
        if width >= TWO_COLUMN_FROM:
            assert page.get_by_role("region", name="Exposure").bounding_box()["x"] >= t["x"] + t["width"] - 1
        else:
            assert page.get_by_role("button", name="Log breach").bounding_box()["y"] < t["y"]
        page.goto(app_url + "/vault/rules")
        rules = page.get_by_role("list", name="Rules")
        expect(rules).to_be_visible()
        r, p = rules.bounding_box(), page.get_by_role("region", name="Preview").bounding_box()
        if width >= TWO_COLUMN_FROM:
            assert p["x"] >= r["x"] + r["width"] - 1, "Preview not beside the rules"
        else:
            assert p["y"] < r["y"], "Preview not above the rules"


CLOSED_NAMES = {"Ledger", "Breaches", "Rules", "Trusted contact", "Account", "Announced on", "Save breach"}


def test_closed_panels_unreachable(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ada_like(owner)
    with app_page(browser, app_url, "/vault", owner, width=375, height=812) as page:
        expect(page.get_by_role("table", name="Holdings")).to_be_visible()
        assert not CLOSED_NAMES & set(tab_order(page, 30))
        expect(page.get_by_role("link", name="Breaches")).to_have_count(0)
        expect(page.get_by_role("textbox", name="Announced on")).to_have_count(0)
        menu = page.get_by_role("button", name="Menu")
        click(menu)
        expect(menu).to_have_attribute("aria-expanded", "true")
        eventually(page, lambda: expect(page.get_by_role("link", name="Breaches")).to_be_visible(timeout=POLL_MS), SETTLE_S, "menu opens")
        page.keyboard.press("Escape")
        expect(menu).to_be_focused()
        gone(page, page.get_by_role("link", name="Breaches"))
        for width, height in (VIEWPORTS["tablet"], VIEWPORTS["desktop"]):
            page.set_viewport_size({"width": width, "height": height})
            page.goto(app_url + "/vault")
            expect(page.get_by_role("table", name="Holdings")).to_be_visible()
            expect(page.get_by_role("textbox", name="Announced on")).to_have_count(0)
            assert not {"Announced on", "Save breach"} & set(tab_order(page, 30))


def test_rules_list_shows_priority(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    with app_page(browser, app_url, "/vault/rules", owner, height=TALL_VIEWPORT) as page:
        rules = page.get_by_role("list", name="Rules")

        def item_shows(label: str, priority: int) -> None:
            item = rules.get_by_role("listitem").filter(has_text=label)

            def check_item() -> None:
                expect(item).to_have_count(1, timeout=POLL_MS)
                text = " ".join(item.evaluate(ACCESSIBLE_TEXT).split())
                assert re.search(rf"(?<!\d){priority}(?!\d)", text), f"rule {label!r} reads {text!r}, not its priority {priority}"
            eventually(page, check_item, SETTLE_S, f"{label} shows priority {priority}")

        click(page.get_by_role("button", name="Add rule"))
        add = page.get_by_role("dialog", name="Add rule")
        eventually(page, lambda: expect(add).to_be_visible(timeout=POLL_MS), SETTLE_S, "Add rule opens")
        select(add.get_by_role("combobox", name="Data kind"), "Passport")
        select(add.get_by_role("combobox", name="Level"), "Low")
        fill(add.get_by_role("spinbutton", name="Priority"), "500")
        click(add.get_by_role("button", name="Save rule"))
        gone(page, page.get_by_role("dialog", name="Add rule"))
        item_shows("Passport is Low", 500)
        email_rule = "Email address is Low"
        click(page.get_by_role("button", name=f"Edit rule: {email_rule}", exact=True))
        edit = page.get_by_role("dialog", name="Edit rule")
        eventually(page, lambda: expect(edit).to_be_visible(timeout=POLL_MS), SETTLE_S, "Edit rule opens")
        fill(edit.get_by_role("spinbutton", name="Priority"), "7")
        click(edit.get_by_role("button", name="Save rule"))
        gone(page, page.get_by_role("dialog", name="Edit rule"))
        item_shows("Email address is Low", 7)
    saved = {r["label"]: r["priority"] for r in vault_rules(owner)}
    assert saved["Passport is Low"] == 500 and saved["Email address is Low"] == 7, saved


def test_rule_dialog_focus_returns(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    label = "Email address is Low"
    with app_page(browser, app_url, "/vault/rules", owner, height=TALL_VIEWPORT) as page:
        opener = page.get_by_role("button", name=f"Edit rule: {label}", exact=True)
        dialog = page.get_by_role("dialog", name="Edit rule")
        click(opener)
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=POLL_MS), SETTLE_S, "Edit rule opens")
        page.keyboard.press("Escape")
        gone(page, dialog)
        eventually(page, lambda: expect(opener).to_be_focused(timeout=POLL_MS), SETTLE_S, "Escape returns focus to the Edit rule button")
        click(opener)
        eventually(page, lambda: expect(dialog).to_be_visible(timeout=POLL_MS), SETTLE_S, "Edit rule opens again")
        fill(dialog.get_by_role("spinbutton", name="Priority"), "40")
        click(dialog.get_by_role("button", name="Save rule"))
        gone(page, dialog)
        shows(page, page.get_by_role("status", name="Exposure updates"), "Rules updated. Exposure score 0.")
        eventually(page, lambda: expect(opener).to_be_focused(timeout=POLL_MS), SETTLE_S, "a successful save returns focus to the Edit rule button")
    assert [r for r in vault_rules(owner) if r["label"] == label][0]["priority"] == 40


def test_step_list_one_tab_stop_after_refused_click(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    ada_like(owner)
    in_list = "els => els.includes(document.activeElement)"
    with app_page(browser, app_url, "/vault", owner) as page:
        boxes = page.get_by_role("list", name="Next steps").get_by_role("checkbox")
        expect(boxes).to_have_count(4)

        def one_tab_stop(after: str) -> None:
            page.get_by_role("button", name="Log breach").focus()
            for _ in range(40):
                page.keyboard.press("Tab")
                if boxes.evaluate_all(in_list):
                    break
            assert boxes.evaluate_all(in_list), f"Tab never reached the next steps after {after}"
            page.keyboard.press("Tab")
            assert not boxes.evaluate_all(in_list), f"the list is more than one Tab stop after {after}"
            page.keyboard.press("Shift+Tab")
            assert boxes.evaluate_all(in_list), f"Shift+Tab did not return to the list after {after}"
            page.keyboard.press("Shift+Tab")
            assert not boxes.evaluate_all(in_list), f"the list is more than one Shift+Tab stop after {after}"

        second = step_box(page, STEPS["passport"][1], "Brightway Air")
        click(second)
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text=MESSAGES["step_out_of_order"])).to_be_visible(timeout=POLL_MS),
                   SETTLE_S, "order alert")
        eventually(page, lambda: expect(second).not_to_be_checked(timeout=POLL_MS), SETTLE_S, "rolled back")
        expect(second).to_be_focused()
        numeral_is(page, 48)
        one_tab_stop("a refused click")
        later = step_box(page, STEPS["date_of_birth"][1], "Brightway Air")
        page.route("**/api/steps/**", lambda r: r.abort())
        click(later)
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text="Something went wrong. Your change was not saved.")).to_be_visible(timeout=POLL_MS),
                   SETTLE_S, "failure alert")
        eventually(page, lambda: expect(later).not_to_be_checked(timeout=POLL_MS), SETTLE_S, "rolled back after failure")
        expect(later).to_be_focused()
        page.unroute("**/api/steps/**")
        one_tab_stop("a failed click")
    exposure = exposure_of(owner)
    assert exposure["score"] == 48 and {s["status"] for s in exposure["steps"]} == {"open"}


def test_wf_holding_deletion_escape_after_redraw(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    holdings, _ = ada_like(owner)
    hid = holdings["passport"]["id"]
    notes = "Renewed at the Larchfield office"
    with app_page(browser, app_url, f"/vault/holdings/{hid}", owner) as page:
        opener = page.get_by_role("button", name="Delete holding")
        eventually(page, lambda: expect(opener).to_be_visible(timeout=POLL_MS), SETTLE_S, "holding detail loads")
        click(opener)
        dialog = page.get_by_role("alertdialog", name="Delete holding?")
        eventually(page, lambda: expect(dialog.get_by_role("button", name="Keep")).to_be_focused(timeout=POLL_MS), SETTLE_S, "focus on Keep")
        current = holding_of(owner, hid)
        expect_status(owner.patch(f"/api/holdings/{hid}", json={"version": current["version"], "notes": notes}), 200)
        eventually(page, lambda: expect(page.get_by_text(notes)).to_be_visible(timeout=POLL_MS), SETTLE_S,
                   "holding detail redraws in place with the new notes")
        page.keyboard.press("Escape")
        gone(page, page.get_by_role("alertdialog", name="Delete holding?"))
        eventually(page, lambda: expect(page.get_by_role("button", name="Delete holding")).to_be_focused(timeout=POLL_MS), SETTLE_S,
                   "focus returns to Delete holding")
    expect_status(owner.get(f"/api/holdings/{hid}"), 200)


def test_narrow_scope_pending(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    scoped_vault(owner)
    grant_to(owner, list(LEVELS))
    with app_page(browser, app_url, "/vault/contact", owner) as page:
        narrow = page.get_by_role("button", name="Narrow scope")
        eventually(page, lambda: expect(narrow).to_be_enabled(timeout=POLL_MS), SETTLE_S, "grant panel shows Narrow scope")
        held: list[Route] = []
        page.route("**/api/grant", lambda r: held.append(r) if r.request.method == "PATCH" else r.fallback())
        page.get_by_role("group", name="Levels shown").get_by_role("checkbox", name="High", exact=True).uncheck()
        click(narrow)

        def sent() -> None:
            assert len(held) == 1, f"{len(held)} PATCH /api/grant requests held; expected 1"

        eventually(page, sent, SETTLE_S, "the narrow sent its PATCH")
        working = page.get_by_role("button").filter(has_text=re.compile(r"^\s*Working\.\.\.\s*$"))
        eventually(page, lambda: expect(working).to_have_count(1, timeout=POLL_MS), SETTLE_S,
                   'the narrow button reads "Working..." while its write is in flight')
        expect(working).to_be_disabled()
        page.unroute("**/api/grant")
        held[0].continue_()
        shows(page, page.get_by_role("status", name="Grant updates"), "Scope narrowed.")
        eventually(page, lambda: expect(page.get_by_role("button", name="Narrow scope")).to_be_enabled(timeout=POLL_MS), SETTLE_S,
                   "Narrow scope is back once the narrow lands")
    assert sorted(expect_status(owner.get("/api/grant"), 200)["grant"]["levels"]) == ["critical", "low", "moderate"]


def test_outage_banner_after_password_503(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_KEYCLOAK_DOWN_URL"]
    owner = new_owner(app_url)
    with httpx.Client(base_url=down, timeout=HTTP_TIMEOUT) as anon:
        poll(lambda: anon.get("/api/status").json() == {"identity": "down"}, REALM_CHECK_S + LIVE_S, "GET /api/status reports down")
    served: list[str] = []

    def realm_up_at_load(route: Route) -> None:
        served.append(route.request.url)
        route.fulfill(status=200, json={"identity": "ok"})

    with app_page(browser, down, "/vault/account", owner, before=lambda p: p.route("**/api/status*", realm_up_at_load)) as page:
        banner = page.get_by_role("alert").filter(has_text=OUTAGE_BANNER)
        form = page.get_by_role("form", name="Change password")

        def loaded() -> None:
            assert served, "the Account screen did not read GET /api/status on load"
            expect(form).to_be_visible(timeout=POLL_MS)
        eventually(page, loaded, SETTLE_S, "Account screen loaded with the realm reported up")
        gone(page, banner)
        page.unroute("**/api/status*")
        fill(form.get_by_label("Current password"), OWNER_PASSWORD)
        fill(form.get_by_label("New password"), CHANGED_PASSWORD)
        with page.expect_response(lambda r: urlsplit(r.url).path == "/api/account/password") as answered:
            click(form.get_by_role("button", name="Change password"))
        assert answered.value.status == 503, f"password change during the outage answered {answered.value.status}"
        eventually(page, lambda: expect(banner).to_be_visible(timeout=POLL_MS), SETTLE_S, "outage banner after the 503")
    sign_in(app_url, owner.email, OWNER_PASSWORD)


def manifest() -> dict[str, Any]:
    return json.loads((APP_DIR / "run.json").read_text())


def test_if_run_manifest() -> None:
    data = manifest()
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v.strip() for v in data.values())


def test_if_venv_tools() -> None:
    data = manifest()
    assert ".venv" in data["install"]
    for key in ("install", "build", "serve"):
        for part in re.split(r"&&|\|\||;", data[key]):
            words = [w for w in part.split() if not re.match(r"^[A-Z_]+=", w)]
            if not words:
                continue
            tool = words[0]
            ok = tool.startswith(".venv/bin/") or (tool in ("python", "python3") and len(words) > 2 and words[1] == "-m")
            assert ok, f"{key} calls {tool!r}; expected .venv/bin/<tool> or python -m <tool>"
            if tool.startswith(".venv/bin/python"):
                assert len(words) > 2 and words[1] == "-m", f"{key} runs a script directly: {part}"
    assert shipped_packages(), "install put nothing into .venv"


def test_if_notices() -> None:
    text = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name.lower() in text.lower(), f"{package.name} missing from notices"
        assert package.version in text, f"{package.name} {package.version} version missing"
    for font in ("Space Grotesk", "IBM Plex"):
        assert font in text, f"font {font} missing from notices"


def test_if_licences() -> None:
    for package in shipped_packages():
        assert licence_allowed(package.licence, ALLOWED_LICENCES), f"{package.name}: {package.licence}"
    assert "OFL-1.1" in (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_postgres_only(browser: Browser, app_url: str) -> None:
    stray = [p for p in APP_DIR.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and ".venv" not in p.parts]
    assert not stray, f"local datastore files: {stray}"
    assert Postgres().tables(), "the app keeps no tables in Postgres"
    owner = new_owner(app_url)
    ada_like(owner)
    with app_page(browser, app_url, "/vault", owner) as page:
        expect(page.get_by_role("table", name="Holdings")).to_be_visible()
        assert page.evaluate("[localStorage.length, sessionStorage.length]") == [0, 0]


def test_if_realm_untouched(app_url: str) -> None:
    owner = new_owner(app_url)
    assert [u for u in Keycloak().users(owner.email) if (u.get("email") or "").lower() == owner.email]


def test_if_no_cdn(browser: Browser, app_url: str) -> None:
    owner = new_owner(app_url)
    loaded: list[str] = []
    with app_page(browser, app_url, "/vault", owner, before=lambda p: p.on("request", lambda r: loaded.append(r.url))) as page:
        expect(page.get_by_role("table", name="Holdings")).to_be_visible()
        page.goto(app_url + "/vault/rules")
        expect(page.get_by_role("list", name="Rules")).to_be_visible()
    foreign = [u for u in loaded if not u.startswith("data:") and not same_origin(u, app_url)]
    assert not foreign, f"assets from other origins: {foreign}"
