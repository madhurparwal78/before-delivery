from __future__ import annotations

import base64
import http.client
import json
import os
import re
import subprocess
import threading
import time
import unicodedata
import xml.etree.ElementTree as ElementTree
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from datetime import date, datetime, timedelta, timezone
from datetime import time as wall_time
from email.parser import Parser as MetadataParser
from pathlib import Path
from signal import SIGTERM
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    Keycloak,
    Postgres,
    addresses,
    advance,
    axe,
    capture,
    center,
    changed,
    check,
    click,
    decode,
    fill,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    post_json,
    same_origin,
    select,
    serve_copy,
    session,
    state_styles,
    style,
    focused_name,
    text,
    unique,
)


SEED_PASSWORD = "deku-demo-pw-2026"
REVIEWER = "reviewer@example.com"
ANALYST = "analyst@example.com"
REVIEWER_ROLE = "partner-reviewer"

TEXT_LIMITS = {
    "first_name": 80,
    "last_name": 80,
    "work_email": 254,
    "job_title": 120,
    "company_name": 160,
    "website": 2048,
    "goals": 2000,
}
NOTE_LIMIT = 1000
BODY_LIMIT_BYTES = 65536
MAX_DEPTH = 32
MAX_NUMBER_CHARS = 64
KEY_MAX = 255
LIST_LIMIT_CAP = 50
PRESS_PAGE_SIZE = 10
LOGIN_FAILURES = 5
DEFAULT_WINDOW_S = 300
SHORT_TTL_S = 6
SHORT_WINDOW_S = 8
FIRST_ATTEMPT_S = 3
BACKOFF_CAP_S = 30
REPLY_DUE_HOURS = 16
CARD_MIN_MS = 100
CARD_MAX_MS = 300
RING_MIN_PX = 2
RING_MAX_GAP_PX = 4

DESKTOP = (1280, 800)
PHONE = (375, 812)
PHONE_TALL = (390, 844)
WIDE = (1920, 1200)
NARROW = (320, 800)

FIELDS = [
    "first_name", "last_name", "work_email", "job_title", "company_name", "website", "company_type",
    "employee_band", "markets", "customer_segment", "partnership_interests", "goals", "consent",
]
TEXT_FIELDS = ["first_name", "last_name", "work_email", "job_title", "company_name", "website", "goals"]
SELECT_FIELDS = ["company_type", "employee_band", "customer_segment"]
GROUP_FIELDS = ["markets", "partnership_interests"]
CONSENT_LABEL = "I consent to Relayo contacting me about this application."
FIELD_NAMES = {
    "first_name": "First name",
    "last_name": "Last name",
    "work_email": "Work email",
    "job_title": "Job title",
    "company_name": "Company name",
    "website": "Website URL",
    "company_type": "Company type",
    "employee_band": "Number of employees",
    "markets": "Primary markets served",
    "customer_segment": "Primary customer segment",
    "partnership_interests": "Partnership interests",
    "goals": "Partnership goals",
    "consent": CONSENT_LABEL,
}

COMPANY_TYPES = [
    "SaaS or Technology Platform", "IT Services or MSP or VAR", "Systems Integrator", "Consultant or Agency",
    "Marketplace or Distributor", "Community or Association", "Content or Affiliate Publisher", "Other",
]
EMPLOYEE_BANDS = ["1 to 9", "10 to 25", "26 to 100", "101 to 500", "501 to 1000", "1001 to 5000", "5001 plus"]
MARKETS = ["North America", "EMEA", "APAC", "LATAM", "Global"]
SEGMENTS = ["SMB", "Mid-Market", "Enterprise", "Education", "Government or Public Sector", "Other"]
INTERESTS = [
    "build an integration", "refer customers", "resell", "bundle into a product or service",
    "offer through a marketplace or distribution channel", "support customer implementation or adoption",
    "offer to members or community", "explore co-marketing or co-selling", "not sure yet", "other",
]

MSG_REQUIRED = "This field is required."
MSG_CONSENT = "You must give consent to apply."
MSG_LIMIT = "Must be at most {} characters."
MSG_UNSUPPORTED = "Remove unsupported characters from this field."
MSG_EMAIL = "Enter a valid work email address."
MSG_WEBSITE = "Enter a URL starting with http:// or https://."
MSG_OPTION = "Choose one of the listed options."
MSG_DECISION = "Choose approve or reject."
MSG_NOTE_TEXT = "Enter the note as text."
DUPLICATE_MESSAGE = "An application for this work email already exists."

SUMMARY_HEADING = "Please correct the fields below."
OUTAGE_ALERT = "We couldn't reach Relayo. Your answers are still here."
THANK_YOU = "Thank you, {}. Our partner team reviews every application and replies by email."
LIST_OUTAGE = "This list is unavailable right now. Try again in a minute."
NO_ACCESS = "Your account does not have access to partner applications."
SIGNED_OUT = "You have signed out."
WAIT_COPY = "Too many sign-in attempts. Try again in {} seconds."
WAIT_COPY_ONE = "Too many sign-in attempts. Try again in 1 second."
WAIT_OVER = "You can sign in again."
APPROVED_COPY = "Application approved. The applicant will be emailed."
REJECTED_COPY = "Application rejected. The applicant will be emailed."
NOTE_HINT = "Up to 1000 characters. Never sent to the applicant."
PAGE_NOT_FOUND = "Page not found"
BEYOND_LAST = "No press items on this page."

SUBJECTS = {
    "receipt": "We received your Relayo partner application",
    "approved": "Your Relayo partner application: Approved",
    "rejected": "Your Relayo partner application: Not approved",
}
RECEIPT_BODY = (
    "Hello {first},\n\nThank you for applying to the Relayo partner program on behalf of {company}. "
    "Our partner team reviews every application and replies by email.\n\nThe Relayo partner team"
)
APPROVED_SENTENCE = "Your application has been approved, and a partner manager will contact you at this address."
REJECTED_SENTENCE = "After review, we are not able to offer a partnership at this time."

APPLICATION_KEYS = {
    "id", "first_name", "last_name", "work_email", "job_title", "company_name", "website", "company_type",
    "employee_band", "markets", "customer_segment", "partnership_interests", "goals", "consent", "status",
    "reviewer", "decision_note", "created_at", "decided_at", "reply_due_at", "outcome_email_status",
}
INTEGRATION_KEYS = {"slug", "name", "description", "category", "icon_ref"}
ARTICLE_KEYS = {"slug", "title", "category", "summary", "author", "read_time", "cover_ref", "published_at"}
PRESS_KEYS = {"id", "date", "category", "headline", "link"}

INTEGRATION_COUNTS = {
    "Collaboration": 4, "CRM": 5, "Calendar": 3, "Desktop App": 2, "Mobile": 2, "Browser Extensions": 2,
    "Storage": 3, "Analytics": 3, "Dialers": 3, "Video Conferencing": 3,
}
NAMED_INTEGRATIONS = {
    "huddleboard": "Huddleboard", "pipewell-crm": "Pipewell CRM", "datebook-calendar": "Datebook Calendar",
    "relayo-desktop": "Relayo for Desktop", "relayo-mobile": "Relayo Mobile",
    "tabnote-extension": "Tabnote Extension", "vaultbox-drive": "Vaultbox Drive", "signalgraph": "Signalgraph",
    "ringstead-dialer": "Ringstead Dialer", "framecall-video": "Framecall Video",
}
UNPUBLISHED_INTEGRATIONS = ["ledgerline-crm", "coldstore-archive"]
PUBLISHED_INTEGRATIONS = 30
ALL_INTEGRATIONS = 32
ARTICLE_COUNTS = {"Product Updates": 12, "Sales": 5, "Education": 3, "Media": 2, "Hiring": 2, "Company": 1}
PUBLIC_ARTICLES = 25
ALL_ARTICLES = 28
PUBLIC_PRESS = 25
ALL_PRESS = 28
PUBLIC_NEWS = 21
PUBLIC_RELEASES = 4
ARTICLE_SLUG = "meeting-notes-that-write-themselves"
ARTICLE_TITLE = "Meeting notes that write themselves"
HIDDEN_ARTICLES = ["draft-q4-roadmap", "unpublished-pricing-notes", "scheduled-2099-launch"]
SCHEDULED_PRESS = "Relayo at the 2099 partner summit"
JOBS_ALL = 6
JOBS_OPEN = 4
RESOURCES_PUBLISHED = 10

STEP_LABELS = ["Before the meeting", "During the meeting", "After the meeting"]
AGENTS = ["Sales Agent", "Education Agent", "Media Agent", "SDR Agent", "Recruiting Agent"]

BERLIN = ZoneInfo("Europe/Berlin")
OPENING = wall_time(9)
CLOSING = wall_time(17)
HOLIDAYS = {date.fromisoformat(day) for day in "2026-01-01, 2026-04-03, 2026-04-06, 2026-05-01, 2026-05-14, 2026-05-25, 2026-10-03, 2026-12-24, 2026-12-25, 2026-12-26, 2026-12-31, 2027-01-01, 2027-03-26, 2027-03-29, 2027-05-01, 2027-05-06, 2027-05-17, 2027-10-03, 2027-12-24, 2027-12-25, 2027-12-26, 2027-12-31".split(", ")}

LICENCE_PATTERNS = [
    r"\bMIT\b", r"\bBSD\b", r"BSD-2-Clause", r"BSD-3-Clause", r"\bApache\b", r"Apache-2\.0", r"\bISC\b",
    r"PSF-2\.0", r"Python Software Foundation", r"MPL-2\.0", r"Mozilla Public License 2\.0",
    r"Permission is hereby granted, free of charge", r"Redistribution and use in source and binary forms",
    r"Permission to use, copy, modify, and(/or)? distribute this software",
]
APP_ROOT = Path("/app")
VENV_TOOLING = {"pip", "setuptools", "wheel"}
SQLITE_MAGIC = b"SQLite format 3\x00"
WIDTHS = (320, 390, 768, 1920)
FOCUS_SETTLE_S = 3
LISTS = {
    "integrations": ("/integrations", "Integration categories", "Integrations", "All Integrations", "CRM"),
    "blog": ("/blog", "Blog categories", "Articles", "All", "Sales"),
    "press": ("/press", "Press categories", "Press items", "All", "News"),
}
LIST_IDS = ["integrations", "blog", "press"]
EMPTY_STATES = {
    "integrations": ("No integrations match this category.", "Show all integrations", "0 integrations"),
    "blog": ("No articles match this category.", "Show all articles", "0 articles"),
    "press": ("No press items match this category.", "Show all press", "0 press items"),
}
DESKTOP_AXE_IDS = ["home", "sales-agent", "integrations", "resources", "press", "blog", "partner-program"]
PHONE_AXE_IDS = ["home", "integrations", "partner-program"]
LAYOUT_IDS = ["home", "integrations", "careers"]
SHELL_IDS = ["home", "integrations", "partner-program"]
PAGE_PATHS = {
    "home": "/", "sales-agent": "/sales-agent", "integrations": "/integrations", "resources": "/resources",
    "press": "/press", "blog": "/blog", "partner-program": "/partner-program", "careers": "/careers",
}


HTTP_TIMEOUT_S = 30
UI_DEADLINE_S = 30
BOOT_DEADLINE_S = 180
MAIL_DEADLINE_S = 60
MAIL_SETTLE_S = 5
LOOK_MS = 500
STEP_MS = 100
IDLE_MS = 1000
POLL_S = 0.25
CLOCK_SLACK_S = 0.5
WALK_MAX_PAGES = 200
COPY_PORT = 4191
BURST = 10
TAB_SWEEP = 40
MISSING_ID = 987654321
UNREACHABLE_DB = "postgresql://relayo:relayo@127.0.0.1:9/relayo"
SWIPE_PX = 120
SHORT_SWIPE_PX = 30
VERTICAL_SWIPE_PX = 220
WHITE_SPACE = (
    "\t\n\x0b\x0c\r \x85\xa0\u1680" + "".join(chr(c) for c in range(0x2000, 0x200B)) + "\u2028\u2029\u202f\u205f\u3000"
)
TEXT_SPACING_CSS = (
    "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } "
    "p { margin-bottom: 2em !important; }"
)
QUEUE_COUNTS_PATTERN = re.compile(r"^[0-9]+ pending, [0-9]+ approved, [0-9]+ rejected$")


def fresh(prefix: str = "visitor") -> tuple[str, str]:
    first, second = unique(prefix)
    email, token = (first, second) if "@" in first else (second, first)
    return token, email.lower()


def application(email: str, token: str, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "first_name": "Ada",
        "last_name": f"Lovelace {token}",
        "work_email": email,
        "job_title": "Partner lead",
        "company_name": f"Company {token}",
        "website": "https://example.com",
        "company_type": COMPANY_TYPES[2],
        "employee_band": EMPLOYEE_BANDS[1],
        "markets": [MARKETS[1]],
        "customer_segment": SEGMENTS[0],
        "partnership_interests": [INTERESTS[0]],
        "goals": "Bring Relayo notes to our clients.",
        "consent": True,
    }
    body.update(overrides)
    return body


def encode(body: Any, **dumps: Any) -> bytes:
    return json.dumps(body, **dumps).encode("ascii")


def call(method: str, base: str, path: str, *, token: str | None = None, content: bytes | None = None,
         key: Any = None, content_type: str | None = "application/json", headers: dict[str, Any] | None = None,
         params: Any = None) -> httpx.Response:
    sent: dict[str, Any] = dict(headers or {})
    if token is not None:
        sent["Authorization"] = f"Bearer {token}"
    if key is not None:
        sent["Idempotency-Key"] = key
    if content is not None and content_type is not None:
        sent["Content-Type"] = content_type
    with httpx.Client(timeout=HTTP_TIMEOUT_S) as client:
        return client.request(method, base.rstrip("/") + path, content=content, headers=sent, params=params)


def raw(base: str, method: str, raw_path: str, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], bytes]:
    parts = urlsplit(base)
    connection = http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=HTTP_TIMEOUT_S)
    try:
        connection.request(method, raw_path, headers=headers or {})
        response = connection.getresponse()
        return response.status, {k.lower(): v for k, v in response.getheaders()}, response.read()
    finally:
        connection.close()


def create(base: str, body: Any, key: Any = None) -> httpx.Response:
    return call("POST", base, "/api/partner-applications", content=encode(body), key=key)


def created(base: str, prefix: str = "visitor", **overrides: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    token, email = fresh(prefix)
    body = application(email, token, **overrides)
    response = create(base, body)
    assert response.status_code == 201, response.text
    return body, response.json()


def sign_in(base: str, email: str, password: str = SEED_PASSWORD) -> httpx.Response:
    return call("POST", base, "/api/auth/login", content=encode({"email": email, "password": password}))


def token_for(base: str, email: str = REVIEWER) -> str:
    response = sign_in(base, email)
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def decide(base: str, app_id: Any, decision: Any, token: str | None, note: Any = ..., **extra: Any) -> httpx.Response:
    body: dict[str, Any] = {"decision": decision, **extra}
    if note is not ...:
        body["note"] = note
    return call("POST", base, f"/api/review/partner-applications/{app_id}/decision", token=token, content=encode(body))


def read_application(base: str, app_id: Any, token: str | None) -> httpx.Response:
    return call("GET", base, f"/api/review/partner-applications/{app_id}", token=token)


def read_queue(base: str, token: str | None, params: Any = None) -> httpx.Response:
    return call("GET", base, "/api/review/partner-applications", token=token, params=params)


def error_of(response: httpx.Response) -> Any:
    return response.json().get("error")


def strict_json(response: httpx.Response) -> Any:
    return json.loads(response.content.decode("utf-8"))


def claims(token: str) -> dict[str, Any]:
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def berlin_cell(value: str) -> str:
    return parse_time(value).astimezone(BERLIN).strftime("%Y-%m-%d %H:%M") + " Berlin"


def nfc_len(value: str) -> int:
    return len(unicodedata.normalize("NFC", value))


def stored_text(value: str) -> str:
    return unicodedata.normalize("NFC", value).strip(WHITE_SPACE)


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    gate = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        gate.wait()
        return fn()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def poll(check_fn: Callable[[], Any], seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        try:
            return check_fn()
        except AssertionError:
            if time.monotonic() >= deadline:
                raise
            threading.Event().wait(POLL_S)


def walk(base: str, path: str, **params: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    query = dict(params)
    for _ in range(WALK_MAX_PAGES):
        response = call("GET", base, path, params=list(query.items()))
        assert response.status_code == 200, response.text
        data = response.json()
        items.extend(data["items"])
        if data["next_cursor"] is None:
            return items
        query["cursor"] = data["next_cursor"]
    raise AssertionError(f"{path} never ended its cursor walk")


def reply_due(created_at: datetime) -> datetime:
    remaining = timedelta(hours=REPLY_DUE_HOURS)
    day = created_at.astimezone(BERLIN).date()
    while True:
        if day.weekday() < 5 and day not in HOLIDAYS:
            opens = datetime.combine(day, OPENING, BERLIN).astimezone(timezone.utc)
            closes = datetime.combine(day, CLOSING, BERLIN).astimezone(timezone.utc)
            start = max(created_at, opens)
            if start < closes:
                if start + remaining <= closes:
                    return (start + remaining).replace(microsecond=0)
                remaining -= closes - start
        day += timedelta(days=1)


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def applications_for(email: str) -> list[dict[str, Any]]:
    return Postgres().rows(
        "SELECT id, first_name, last_name, work_email, job_title, company_name, website, company_type, "
        "employee_band, markets, customer_segment, partnership_interests, goals, consent, status, reviewer, "
        "decision_note, decided_at, extract(epoch FROM created_at)::float8 AS created_epoch "
        f"FROM partner_applications WHERE work_email = {sql_text(email)} ORDER BY id"
    )


def emails_for(app_id: int) -> list[dict[str, Any]]:
    return Postgres().rows(
        "SELECT id, kind, recipient, subject, body, status, attempts, "
        "extract(epoch FROM last_attempt_at)::float8 AS last_epoch, "
        "extract(epoch FROM next_attempt_at)::float8 AS next_epoch, "
        "extract(epoch FROM sent_at)::float8 AS sent_epoch, "
        "extract(epoch FROM created_at)::float8 AS created_epoch "
        f"FROM outbound_emails WHERE application_id = {int(app_id)} ORDER BY id"
    )


def emails_mentioning(email: str) -> list[dict[str, Any]]:
    return Postgres().rows(
        f"SELECT id, kind FROM outbound_emails WHERE strpos(lower(recipient), {sql_text(email.lower())}) > 0"
    )


def failures_for(email_key: str) -> int:
    rows = Postgres().rows(f"SELECT count(*) AS n FROM sign_in_failures WHERE email_key = {sql_text(email_key)}")
    return int(rows[0]["n"])


def mails_to(mail: Any, email: str, subject: str | None = None, expected: int = 1) -> list[dict[str, Any]]:
    def matching(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            m for m in messages
            if email.lower() in [a.lower() for a in addresses(m.get("To"))]
            and (subject is None or m.get("Subject") == subject)
        ]

    def arrived() -> None:
        assert len(matching(mail.messages())) >= expected, f"fewer than {expected} messages to {email}"

    if expected:
        poll(arrived, MAIL_DEADLINE_S)
    return matching(mail.messages(0, settle=MAIL_SETTLE_S))


@contextmanager
def keycloak_admin() -> Iterator[httpx.Client]:
    root = os.environ["KEYCLOAK_URL"].rstrip("/")
    realm = os.environ["KEYCLOAK_REALM"]
    with httpx.Client(timeout=HTTP_TIMEOUT_S) as client:
        grant = client.post(
            f"{root}/realms/{realm}/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": os.environ["AUTH_CLIENT_ID"],
                "client_secret": os.environ["AUTH_CLIENT_SECRET"],
            },
        )
        grant.raise_for_status()
        client.headers["Authorization"] = f"Bearer {grant.json()['access_token']}"
        client.base_url = httpx.URL(f"{root}/admin/realms/{realm}")
        yield client


def keycloak_user_id(admin: httpx.Client, email: str) -> str:
    users = admin.get("/users", params={"email": email, "exact": "true"}).json()
    return next(u["id"] for u in users if u.get("email") == email)


def set_role(email: str, present: bool) -> None:
    with keycloak_admin() as admin:
        role = admin.get(f"/roles/{REVIEWER_ROLE}").json()
        path = f"/users/{keycloak_user_id(admin, email)}/role-mappings/realm"
        response = admin.post(path, json=[role]) if present else admin.request("DELETE", path, json=[role])
        assert response.is_success, response.text


def set_enabled(email: str, enabled: bool) -> None:
    with keycloak_admin() as admin:
        user_path = f"/users/{keycloak_user_id(admin, email)}"
        representation = admin.get(user_path).json()
        representation["enabled"] = enabled
        response = admin.put(user_path, json=representation)
        assert response.is_success, response.text


@contextmanager
def app_copy(tmp_path: Path, **overrides: str) -> Iterator[tuple[str, subprocess.Popen, Any]]:
    log = (tmp_path / "copy.log").open("w+")
    proc = serve_copy(COPY_PORT, log, **overrides)
    try:
        yield f"http://127.0.0.1:{COPY_PORT}", proc, log
    finally:
        with suppress(ProcessLookupError):
            os.killpg(proc.pid, SIGTERM)
        with suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=HTTP_TIMEOUT_S)
        log.close()


def log_tail(log: Any) -> str:
    log.flush()
    log.seek(0)
    return log.read()[-4000:]


def copy_health(base: str, proc: subprocess.Popen, log: Any) -> httpx.Response:
    assert proc.poll() is None, f"copy exited:\n{log_tail(log)}"
    try:
        return httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
    except httpx.TransportError as exc:
        raise AssertionError(f"copy not answering yet: {exc}") from exc


@contextmanager
def entered(manager: Any) -> Iterator[Any]:
    if hasattr(manager, "__enter__"):
        with manager as value:
            yield value
    else:
        value = next(manager)
        try:
            yield value
        finally:
            with suppress(StopIteration):
                next(manager)


@contextmanager
def visit(browser: Browser, url: str, size: tuple[int, int] = DESKTOP, **options: Any) -> Iterator[Page]:
    with entered(open_app(browser, url, **options)) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        yield page


def eventually(page: Page, check_fn: Callable[[], Any], seconds: float = UI_DEADLINE_S) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        try:
            return check_fn()
        except AssertionError:
            if time.monotonic() >= deadline:
                raise
            advance(page, STEP_MS)


def shows(page: Page, locator: Locator) -> None:
    eventually(page, lambda: expect(locator).to_be_visible(timeout=LOOK_MS))


def shows_any(page: Page, locator: Locator) -> None:
    eventually(page, lambda: assert_true(any(m.is_visible() for m in locator.all()), "no visible match"))


def body_says(page: Page, copy: str) -> None:
    eventually(page, lambda: assert_true(" ".join(copy.split()).casefold()
                                         in " ".join(page.evaluate("document.body.innerText").split()).casefold(), copy))


MOTION_JS = """(el) => el.getAnimations({subtree: true}).filter(a => {
  const t = a.effect && a.effect.target;
  if (a.playState !== 'running' || !t) return false;
  if ((Number(a.effect.getTiming().duration) || 0) < 20) return false;
  return !(t.closest && t.closest('button'));
}).map(a => a.animationName || a.transitionProperty || '')"""


def motion(locator: Locator) -> list[str]:
    return locator.evaluate(MOTION_JS)


def reads(page: Page, locator: Locator, value: Any) -> None:
    eventually(page, lambda: expect(locator).to_have_text(value, timeout=LOOK_MS))


def gone(page: Page, locator: Locator) -> None:
    eventually(page, lambda: expect(locator).to_have_count(0, timeout=LOOK_MS))


def marked(page: Page, locator: Locator, attribute: str = "aria-current", value: str = "true") -> None:
    eventually(page, lambda: expect(locator).to_have_attribute(attribute, value, timeout=LOOK_MS))


def query_of(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlsplit(page.url).query, keep_blank_values=True)


def at(tab: Page, path: str, /, **query: str) -> None:
    def check_url() -> None:
        assert urlsplit(tab.url).path == path, tab.url
        assert query_of(tab) == {k: [v] for k, v in query.items()}, tab.url

    eventually(tab, check_url)


def dismiss_cookies(page: Page) -> None:
    panel = page.get_by_role("dialog", name="Cookie preferences")
    shows(page, panel)
    click(panel.get_by_role("button", name="Reject All"))
    eventually(page, lambda: expect(panel).to_be_hidden(timeout=LOOK_MS))


SHOWN_BOX_JS = """e => { const r = e.getBoundingClientRect();
  const usable = r.width >= 4 && r.height >= 4 && r.right > 0 && r.left < innerWidth;
  const shown = usable || !(e.labels && e.labels.length) ? r : e.labels[0].getBoundingClientRect();
  return {x: shown.left, y: shown.top, width: shown.width, height: shown.height}; }"""


def in_view(page: Page, locator: Locator) -> None:
    box = locator.evaluate(SHOWN_BOX_JS)
    banner = page.get_by_role("banner").bounding_box()
    viewport = page.viewport_size
    assert box is not None and banner is not None and viewport is not None
    assert box["y"] >= banner["y"] + banner["height"] - 1, f"{box} under the header {banner}"
    assert box["y"] + box["height"] <= viewport["height"] + 1, f"{box} below the viewport"
    assert box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1, f"{box} beside the viewport"


def checkbox_label(option: str) -> str:
    return option[:1].upper() + option[1:]


def partner_form(page: Page) -> Locator:
    return page.get_by_role("form", name="Partner application")


def text_field(page: Page, name: str) -> Locator:
    return partner_form(page).get_by_role("textbox", name=FIELD_NAMES[name], exact=True)


def fill_partner_form(page: Page, body: dict[str, Any]) -> None:
    form = partner_form(page)
    shows(page, form)
    for name in TEXT_FIELDS:
        if isinstance(body.get(name), str):
            fill(text_field(page, name), body[name])
    for name in SELECT_FIELDS:
        if body.get(name):
            select(form.get_by_role("combobox", name=FIELD_NAMES[name], exact=True), body[name])
    for name in GROUP_FIELDS:
        group = form.get_by_role("group", name=FIELD_NAMES[name])
        for option in body.get(name) or []:
            check(group.get_by_role("checkbox", name=checkbox_label(option), exact=True))
    if body.get("consent") is True:
        check(form.get_by_role("checkbox", name=CONSENT_LABEL, exact=True))


def submit_button(page: Page) -> Locator:
    return partner_form(page).get_by_role("button", name="Submit application")


def ui_sign_in(page: Page, email: str, password: str = SEED_PASSWORD) -> None:
    form = page.get_by_role("form", name="Staff sign in")
    shows(page, form)
    fill(form.get_by_role("textbox", name="Email"), email)
    fill(form.get_by_label("Password"), password)
    click(form.get_by_role("button", name="Sign in"))


@contextmanager
def review_page(browser: Browser, app_url: str, email: str = REVIEWER, query: str = "",
                size: tuple[int, int] = DESKTOP) -> Iterator[Page]:
    with visit(browser, f"{app_url}/review{query}", size) as page:
        dismiss_cookies(page)
        ui_sign_in(page, email)
        yield page


def queue_table(page: Page) -> Locator:
    return page.get_by_role("table", name="Partner applications")


def is_queue_response(response: Any) -> bool:
    return urlsplit(response.url).path == "/api/review/partner-applications" and response.request.method == "GET"


def results(page: Page) -> Locator:
    return page.get_by_role("status", name="Results")


STEP_FLAG_JS = """(e) => {
  let n = e;
  for (let i = 0; n && i < 4; i++, n = n.parentElement) {
    if (n.getAttribute('aria-current') === 'step') return true;
  }
  for (const d of e.getElementsByTagName('*')) {
    if (d.getAttribute('aria-current') === 'step') return true;
  }
  return false;
}"""

FOCUS_PROBE_JS = """() => {
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return {ok: true, name: ''};
  const r = e.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const inside = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
  const top = inside ? document.elementFromPoint(x, y) : null;
  return {ok: inside && !!top && (top === e || e.contains(top)),
          name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60)};
}"""

FOCUS_STYLE_JS = """() => {
  const e = window.__probe;
  const read = (n, p) => { const s = getComputedStyle(n, p);
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor, s.borderBottomColor,
            s.backgroundColor, s.textDecorationLine, s.opacity, s.content].join('|'); };
  const near = []; for (let n = e.parentElement, i = 0; n && i < 3; n = n.parentElement, i++) near.push(read(n, null));
  for (const n of [e.previousElementSibling, e.nextElementSibling]) if (n) near.push(read(n, null));
  return [read(e, null), read(e, '::before'), read(e, '::after'), ...near].join('#');
}"""


SETTLEABLE_JS = """(list) => list.filter(a => a.effect && a.timeline === document.timeline
  && ['running', 'pending'].includes(a.playState)
  && Number.isFinite(Number(a.effect.getComputedTiming().endTime)))"""

SETTLE_DOCUMENT_JS = """() => {
  const settleable = """ + SETTLEABLE_JS + """;
  window.__verifierSettled = false;
  Promise.all(settleable(document.getAnimations()).map(a => a.finished.catch(() => null)))
    .then(() => { window.__verifierSettled = true; });
}"""

SETTLE_BOUND_S = 3


def await_settled(page: Page) -> None:
    with suppress(AssertionError):
        poll(lambda: assert_true(page.evaluate("() => window.__verifierSettled === true"), "still animating"),
             SETTLE_BOUND_S)


def steady(page: Page, script: str) -> str:
    page.evaluate(SETTLE_DOCUMENT_JS)
    await_settled(page)
    return page.evaluate(script)

REFLOW_JS = """(roots) => {
  const problems = [];
  const vw = document.documentElement.clientWidth;
  const formLike = (e) => ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(e.tagName)
    || ['combobox', 'listbox', 'option', 'textbox', 'spinbutton'].includes(e.getAttribute && e.getAttribute('role'));
  const tiny = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) {
      const r = n.getBoundingClientRect(); const s = getComputedStyle(n);
      if (r.width <= 1 || r.height <= 1) return true;
      if ((s.clip && s.clip !== 'auto') || (s.clipPath && s.clipPath !== 'none')) return true;
      if (r.right <= 0 || r.left >= vw || r.bottom + scrollY <= 0) return true; } return false; };
  const insideControl = (e) => { for (let n = e; n; n = n.parentElement) if (formLike(n)) return true; return false; };
  const textRects = (el) => { const out = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) { if (!n.textContent.trim() || !n.parentElement) continue;
      if (insideControl(n.parentElement) || tiny(n.parentElement)) continue;
      const s = getComputedStyle(n.parentElement); if (s.visibility === 'hidden') continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) out.push(r); } return out; };
  const ownText = (e) => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const clips = (e, ancestor) => { if (formLike(e) || tiny(e) || (!ancestor && !ownText(e))) return false; const s = getComputedStyle(e);
    const hx = ['hidden', 'clip'].includes(s.overflowX), hy = ['hidden', 'clip'].includes(s.overflowY);
    return (hx && e.scrollWidth > e.clientWidth + 1) || (hy && e.scrollHeight > e.clientHeight + 1); };
  const seen = new Set();
  for (const root of roots) {
    for (const r of textRects(root)) if (r.left < -1 || r.right > vw + 1) problems.push('outside viewport: ' + Math.round(r.left) + '..' + Math.round(r.right));
    const family = [root, ...root.getElementsByTagName('*')];
    const above = new Set();
    for (let n = root.parentElement; n; n = n.parentElement) { family.push(n); above.add(n); }
    for (const e of family) { if (seen.has(e)) continue; seen.add(e);
      if (clips(e, above.has(e))) problems.push('clipped: ' + e.tagName + ' ' + (e.textContent || '').trim().slice(0, 40)); }
    if (root.tagName === 'FORM') {
      for (const c of root.elements) {
        const textual = c.tagName === 'TEXTAREA' || c.tagName === 'SELECT' ||
          (c.tagName === 'INPUT' && !['checkbox', 'radio', 'hidden', 'submit', 'button'].includes(c.type));
        if (!textual) continue;
        const parts = [{name: 'control', rects: [c.getBoundingClientRect()]}];
        for (const l of c.labels || []) parts.push({name: 'label', rects: textRects(l)});
        for (const id of (c.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)) {
          const d = document.getElementById(id); if (d) parts.push({name: 'description ' + id, rects: textRects(d)}); }
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++)
          for (const a of parts[i].rects) for (const b of parts[j].rects) {
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (w > 1 && h > 1) problems.push('overlap on ' + (c.name || c.id) + ': ' + parts[i].name + ' / ' + parts[j].name); }
      }
    }
  }
  return problems;
}"""

LIVE_MESSAGE_JS = """(field, message) => {
  for (const id of (field.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)) {
    const d = document.getElementById(id);
    if (!d || !d.textContent.includes(message)) continue;
    for (let n = d; n; n = n.parentElement) {
      const live = n.getAttribute('aria-live'); const role = n.getAttribute('role');
      if (live === 'polite' || live === 'assertive' || ['status', 'alert', 'log'].includes(role) || n.tagName === 'OUTPUT') return true;
    }
  }
  return false;
}"""


def step_current(steps: Locator, label: str) -> bool:
    return steps.get_by_text(label, exact=True).first.evaluate(STEP_FLAG_JS)


def swipe(page: Page, start: tuple[float, float], dx: float, dy: float) -> None:
    cdp = session(page)
    x, y = start
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for step in range(1, 7):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * step / 6, "y": y + dy * step / 6}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def px(value: str) -> float:
    match = re.match(r"-?[0-9.]+", value or "")
    return float(match.group()) if match else 0.0


def seconds_list(value: str) -> list[float]:
    out = []
    for part in (value or "").split(","):
        part = part.strip()
        if part.endswith("ms"):
            out.append(float(part[:-2]) / 1000)
        elif part.endswith("s"):
            out.append(float(part[:-1]))
    return out


CARD_JS = """el => {
  const nodes = [...el.querySelectorAll('*')];
  for (let n = el, i = 0; n && i < 5 && n.getAttribute('role') !== 'list' && n.tagName !== 'UL' && n.tagName !== 'OL'; i++, n = n.parentElement)
    nodes.push(n);
  window.__cardIds = window.__cardIds || new WeakMap(); window.__cardNext = window.__cardNext || 1;
  return nodes.map(n => { if (!window.__cardIds.has(n)) window.__cardIds.set(n, window.__cardNext++);
    const s = getComputedStyle(n), b = getComputedStyle(n, '::before'), a = getComputedStyle(n, '::after');
    return {id: window.__cardIds.get(n), top: n.getBoundingClientRect().top, duration: s.transitionDuration,
            shadow: [s.boxShadow, b.boxShadow, b.opacity, a.boxShadow, a.opacity, s.filter].join('|')}; });
}"""

RUNNING_MS_JS = """el => { let longest = 0;
  for (let n = el, i = 0; n && i < 3 && n.getAttribute('role') !== 'list' && n.tagName !== 'UL' && n.tagName !== 'OL'; i++, n = n.parentElement)
    for (const a of n.getAnimations({subtree: true})) longest = Math.max(longest, Number(a.effect?.getTiming().duration) || 0);
  return longest; }"""


SETTLE_CARD_JS = """el => {
  const settleable = """ + SETTLEABLE_JS + """;
  const found = [];
  for (let n = el, i = 0; n && i < 3 && n.getAttribute('role') !== 'list' && n.tagName !== 'UL' && n.tagName !== 'OL'; i++, n = n.parentElement)
    found.push(...n.getAnimations({subtree: true}));
  window.__verifierSettled = false;
  Promise.all(settleable(found).map(a => a.finished.catch(() => null)))
    .then(() => { window.__verifierSettled = true; });
}"""


def steady_card(card: Locator) -> list[dict[str, Any]]:
    card.evaluate(SETTLE_CARD_JS)
    await_settled(card.page)
    return card.evaluate(CARD_JS)


def test_wf_cross_cutting_health(app_url: str, tmp_path: Path) -> None:
    ready = call("GET", app_url, "/api/health")
    assert ready.status_code == 200 and ready.json() == {"status": "ok"}
    with app_copy(tmp_path, DATABASE_URL=UNREACHABLE_DB) as (base, proc, log):
        first = poll(lambda: copy_health(base, proc, log), BOOT_DEADLINE_S)
        assert first.status_code == 503, first.text
        assert first.json() == {"status": "starting"}
        again = copy_health(base, proc, log)
        assert again.status_code == 503 and proc.poll() is None, log_tail(log)


ROUTE_IDS = [
    "home", "sales-agent", "education-agent", "media-agent", "sdr-agent", "recruiting-agent", "resources",
    "integrations", "integration-detail", "careers", "press", "blog", "blog-detail", "partner-program", "review",
]
ROUTES = {
    "home": "/", "sales-agent": "/sales-agent", "education-agent": "/education-agent", "media-agent": "/media-agent",
    "sdr-agent": "/sdr-agent", "recruiting-agent": "/recruiting-agent", "resources": "/resources",
    "integrations": "/integrations", "integration-detail": "/integration/huddleboard", "careers": "/careers",
    "press": "/press", "blog": "/blog", "blog-detail": f"/blog/{ARTICLE_SLUG}", "partner-program": "/partner-program",
    "review": "/review",
}
PAGE_HEADINGS = {
    "home": "Every meeting, captured and ready to act on.", "sales-agent": "Relayo Sales Agent",
    "education-agent": "Relayo Education Agent", "media-agent": "Relayo Media Agent",
    "sdr-agent": "Relayo SDR Agent", "recruiting-agent": "Relayo Recruiting Agent",
}


@pytest.mark.parametrize("case", ROUTE_IDS, ids=ROUTE_IDS)
def test_routes_open_directly(browser: Browser, app_url: str, case: str) -> None:
    direct = call("GET", app_url, ROUTES[case])
    assert direct.status_code == 200
    with visit(browser, f"{app_url}{ROUTES[case]}") as page:
        shows(page, page.get_by_role("banner"))
        shows(page, page.get_by_role("contentinfo"))
        if case in PAGE_HEADINGS:
            shows(page, page.get_by_role("heading", level=1, name=PAGE_HEADINGS[case]))


def test_wf_cross_cutting_narrow_layout(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/partner-program", PHONE) as page:
        dismiss_cookies(page)
        first, last = text_field(page, "first_name"), text_field(page, "last_name")
        shows(page, first)
        eventually(page, lambda: layout(page))
        a, b = first.bounding_box(), last.bounding_box()
        assert a and b and b["y"] >= a["y"] + a["height"] - 1, "First and Last name share a row"
        submit_box = submit_button(page).bounding_box()
        assert submit_box and submit_box["x"] + submit_box["width"] <= PHONE[0] + 1
    body, app = created(app_url, "narrow")
    company = body["company_name"]
    with review_page(browser, app_url, size=PHONE) as page:
        approve = page.get_by_role("button", name=f"Approve {company}", exact=True)
        shows(page, approve)
        eventually(page, lambda: layout(page))
        approve.scroll_into_view_if_needed()
        box = approve.bounding_box()
        assert box and box["x"] >= -1 and box["x"] + box["width"] <= PHONE[0] + 1
        detail = read_application(app_url, app["id"], token_for(app_url)).json()
        shows_any(page, page.get_by_text(berlin_cell(detail["reply_due_at"])))
        click(approve)
        dialog = page.get_by_role("dialog", name="Approve application")
        shows(page, dialog)
        click(dialog.get_by_role("button", name="Confirm"))
        reads(page, page.get_by_role("status", name="Review status"), APPROVED_COPY)
    assert applications_for(body["work_email"])[0]["status"] == "approved"


BOUNDARY_IDS = [
    "too_large", "exact_size", "text_media_type", "media_before_auth", "unparseable", "top_level_array",
    "repeated_member", "depth_32", "depth_33", "number_64", "number_65", "nan", "infinity", "negative_infinity",
    "auth_before_json", "json_never_stored",
]


def with_member(payload: bytes, member: bytes) -> bytes:
    return b"{" + member + b", " + payload[1:]


@pytest.mark.parametrize("case", BOUNDARY_IDS, ids=BOUNDARY_IDS)
def test_request_size_and_type_limits(app_url: str, case: str) -> None:
    token, email = fresh("boundary")
    body = application(email, token)
    payload = encode(body)
    decision_path = "/api/review/partner-applications/1/decision"
    key = None
    path, content_type = "/api/partner-applications", "application/json"
    expected_status, expected_error = 400, "invalid_json"
    if case == "too_large":
        padding = BODY_LIMIT_BYTES + 1 - len(encode({**body, "pad": ""}))
        payload = encode({**body, "pad": "x" * padding})
        assert len(payload) == BODY_LIMIT_BYTES + 1
        expected_status, expected_error = 413, "payload_too_large"
    elif case == "exact_size":
        padding = BODY_LIMIT_BYTES - len(encode({**body, "pad": ""}))
        payload = encode({**body, "pad": "x" * padding})
        assert len(payload) == BODY_LIMIT_BYTES
        content_type = "application/json; charset=utf-8"
        expected_status, expected_error = 201, None
    elif case == "text_media_type":
        content_type = "text/plain"
        expected_status, expected_error = 415, "unsupported_media_type"
    elif case == "media_before_auth":
        path, content_type = decision_path, "text/plain"
        payload = encode({"decision": "approve"})
        expected_status, expected_error = 415, "unsupported_media_type"
    elif case == "unparseable":
        payload = payload[:-5]
    elif case == "top_level_array":
        payload = encode([body])
    elif case == "repeated_member":
        payload = with_member(payload, b'"consent": true')
    elif case in ("depth_32", "depth_33"):
        arrays = MAX_DEPTH - 1 if case == "depth_32" else MAX_DEPTH
        payload = with_member(payload, b'"nest": ' + b"[" * arrays + b"]" * arrays)
        if case == "depth_32":
            expected_status, expected_error = 201, None
    elif case in ("number_64", "number_65"):
        digits = MAX_NUMBER_CHARS if case == "number_64" else MAX_NUMBER_CHARS + 1
        payload = with_member(payload, b'"n": 1' + b"0" * (digits - 1))
        if case == "number_64":
            expected_status, expected_error = 201, None
    elif case == "nan":
        payload = with_member(payload, b'"n": NaN')
    elif case == "infinity":
        payload = with_member(payload, b'"n": Infinity')
    elif case == "negative_infinity":
        payload = with_member(payload, b'"n": -Infinity')
    elif case == "auth_before_json":
        path, payload = decision_path, b'{"decision": '
        expected_status, expected_error = 401, "unauthorized"
    elif case == "json_never_stored":
        key = idempotency_key()
        payload = payload[:-5]
    response = call("POST", app_url, path, content=payload, content_type=content_type, key=key)
    assert response.status_code == expected_status, response.text
    if expected_error is not None:
        assert error_of(response) == expected_error
    rows = applications_for(email)
    assert len(rows) == (1 if expected_status == 201 else 0)
    if case == "json_never_stored":
        retried = create(app_url, body, key=key)
        assert retried.status_code == 201, retried.text
        assert "Idempotent-Replayed" not in retried.headers
        assert len(applications_for(email)) == 1


def test_create_application_saved_pending(app_url: str) -> None:
    token, email = fresh("pending")
    body = application(email, token)
    response = post_json(app_url, "/api/partner-applications", body)
    assert response.status_code == 201, response.text
    data = response.json()
    assert set(data) == {"id", "status", "work_email"}
    assert isinstance(data["id"], int) and data["status"] == "pending" and data["work_email"] == email
    rows = applications_for(email)
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == data["id"] and row["status"] == "pending"
    assert row["company_name"] == body["company_name"] and row["markets"] == body["markets"]
    assert row["partnership_interests"] == body["partnership_interests"] and row["consent"] is True
    assert row["reviewer"] is None and row["decided_at"] is None


VALIDATION_IDS = [
    "missing_first_name", "blank_last_name", "over_long_company", "malformed_email", "malformed_website",
    "unknown_option", "repeated_market", "consent_false", "limit_before_unsupported", "several_fields",
]


def break_body(case: str, body: dict[str, Any]) -> dict[str, str]:
    if case == "missing_first_name":
        del body["first_name"]
        return {"first_name": MSG_REQUIRED}
    if case == "blank_last_name":
        body["last_name"] = " \u3000\u00a0 "
        return {"last_name": MSG_REQUIRED}
    if case == "over_long_company":
        body["company_name"] = "\U0001F680" * (TEXT_LIMITS["company_name"] + 1)
        return {"company_name": MSG_LIMIT.format(TEXT_LIMITS["company_name"])}
    if case == "malformed_email":
        body["work_email"] = "ada @example.com"
        return {"work_email": MSG_EMAIL}
    if case == "malformed_website":
        body["website"] = "ftp://example.com"
        return {"website": MSG_WEBSITE}
    if case == "unknown_option":
        body["company_type"] = "Reseller"
        body["customer_segment"] = SEGMENTS[0] + " "
        return {"company_type": MSG_OPTION, "customer_segment": MSG_OPTION}
    if case == "repeated_market":
        body["markets"] = [MARKETS[1], MARKETS[1]]
        return {"markets": MSG_OPTION}
    if case == "consent_false":
        body["consent"] = False
        return {"consent": MSG_CONSENT}
    if case == "limit_before_unsupported":
        body["goals"] = "g" * (TEXT_LIMITS["goals"] + 1) + "\u0001"
        return {"goals": MSG_LIMIT.format(TEXT_LIMITS["goals"])}
    body["job_title"] = None
    body["employee_band"] = ""
    body["markets"] = []
    body["partnership_interests"] = INTERESTS[0]
    del body["consent"]
    return {
        "job_title": MSG_REQUIRED, "employee_band": MSG_REQUIRED, "markets": MSG_REQUIRED,
        "partnership_interests": MSG_REQUIRED, "consent": MSG_CONSENT,
    }


@pytest.mark.parametrize("case", VALIDATION_IDS, ids=VALIDATION_IDS)
def test_server_side_validation(app_url: str, case: str) -> None:
    token, email = fresh("invalid")
    body = application(email, token)
    expected = break_body(case, body)
    response = create(app_url, body)
    assert response.status_code == 422, response.text
    data = strict_json(response)
    assert data["error"] == "validation_failed" and data["message"] == SUMMARY_HEADING
    assert data["errors"] == expected
    assert data["values"] == {name: body.get(name) for name in FIELDS}
    assert applications_for(email) == []
    assert emails_mentioning(email) == []


LIMIT_IDS = ["first_name", "last_name", "job_title", "company_name", "work_email", "website", "goals"]


def value_of_length(field_name: str, length: int, email: str) -> str:
    if field_name == "work_email":
        return "x" * (length - len(email)) + email
    if field_name == "website":
        prefix = "https://example.com/"
        return prefix + "p" * (length - len(prefix))
    return "\U0001F680" + "e\u0301" + "x" * (length - 2)


@pytest.mark.parametrize("case", LIMIT_IDS, ids=LIMIT_IDS)
def test_field_limits(app_url: str, case: str) -> None:
    limit = TEXT_LIMITS[case]
    token, email = fresh("limit")
    at_limit = value_of_length(case, limit, email)
    assert nfc_len(at_limit) == limit
    accepted = create(app_url, application(email, token, **{case: " " + at_limit + "\u00a0"}))
    assert accepted.status_code == 201, accepted.text
    stored_email = at_limit if case == "work_email" else email
    rows = applications_for(stored_email)
    assert len(rows) == 1 and nfc_len(rows[0][case]) == limit
    token2, email2 = fresh("limit")
    over = value_of_length(case, limit + 1, email2)
    refused = create(app_url, application(email2, token2, **{case: over}))
    assert refused.status_code == 422, refused.text
    assert refused.json()["errors"] == {case: MSG_LIMIT.format(limit)}
    assert applications_for(over if case == "work_email" else email2) == []


def test_normalised_storage(app_url: str) -> None:
    token, email = fresh("normal")
    local, domain = email.split("@")
    raw_body = application(
        email, token,
        work_email=f" \u212a\u00c9LODIE.{local}@{domain.upper()}\u3000",
        first_name="\u00a0\u2003Ade\u0301le\u205f",
        job_title="\u200bLead\u200b ",
        company_name=f"Line one\nCompany {token}\t",
        goals="\ufeffGoals \u00a0",
    )
    stored_email = f"k\u00e9lodie.{local}@{domain}"
    response = create(app_url, raw_body)
    assert response.status_code == 201, response.text
    assert response.json()["work_email"] == stored_email
    row = applications_for(stored_email)[0]
    assert row["work_email"] == stored_email
    assert row["first_name"] == stored_text(raw_body["first_name"])
    assert row["job_title"] == stored_text(raw_body["job_title"])
    assert row["company_name"] == stored_text(raw_body["company_name"])
    assert row["goals"] == stored_text(raw_body["goals"])
    token2, email2 = fresh("normal")
    echoed = {**raw_body, "work_email": f" {email2.upper()} ", "website": "example.com"}
    refused = create(app_url, echoed)
    assert refused.status_code == 422
    assert strict_json(refused)["values"] == {name: echoed.get(name) for name in FIELDS}


def test_wf_application_intake_fix_and_resubmit(browser: Browser, app_url: str) -> None:
    token, email = fresh("fix")
    body = application(email, token, work_email=f"  {email.upper()}", first_name="  Ade\u0301le  ")
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        fill_partner_form(page, {**body, "website": "example.com"})
        click(submit_button(page))
        shows(page, page.get_by_role("alert").filter(has_text=SUMMARY_HEADING))
        assert applications_for(email) == []
        fill(text_field(page, "website"), body["website"])
        click(submit_button(page))
        shows(page, page.get_by_role("region", name="Application received"))
    row = applications_for(email)[0]
    assert row["first_name"] == stored_text(body["first_name"]) and row["work_email"] == email and row["status"] == "pending"


def test_privileged_fields_ignored(app_url: str) -> None:
    token, email = fresh("privileged")
    body = application(
        email, token, id=MISSING_ID, status="approved", reviewer=REVIEWER, decision_note="pre-approved",
        created_at="2000-01-01T00:00:00Z", decided_at="2000-01-02T00:00:00Z",
    )
    response = create(app_url, body)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["status"] == "pending" and data["id"] != MISSING_ID
    row = applications_for(email)[0]
    assert row["id"] == data["id"] and row["status"] == "pending"
    assert row["reviewer"] is None and row["decision_note"] is None and row["decided_at"] is None
    assert datetime.fromtimestamp(row["created_epoch"], timezone.utc).year > 2000


UNSUPPORTED_IDS = ["nul", "control", "delete", "lone_surrogate"]
UNSUPPORTED = {"nul": "\u0000", "control": "\u001b", "delete": "\u007f", "lone_surrogate": "\ud83d"}


@pytest.mark.parametrize("case", UNSUPPORTED_IDS, ids=UNSUPPORTED_IDS)
def test_unsupported_characters_refused(app_url: str, case: str) -> None:
    char = UNSUPPORTED[case]
    token, email = fresh("unsupported")
    body = application(email, token, first_name=f"Ada{char}", goals=f"Goals{char}")
    response = create(app_url, body)
    assert response.status_code == 422, response.text
    data = strict_json(response)
    assert data["errors"] == {"first_name": MSG_UNSUPPORTED, "goals": MSG_UNSUPPORTED}
    assert data["values"]["first_name"] == body["first_name"] and data["values"]["goals"] == body["goals"]
    assert applications_for(email) == []
    allowed_token, allowed_email = fresh("unsupported")
    allowed = create(app_url, application(allowed_email, allowed_token, goals="Tab\there\nline\r\nbreak"))
    assert allowed.status_code == 201, allowed.text
    _, login_email = fresh("unsupported")
    login = sign_in(app_url, login_email, f"pw{char}")
    assert login.status_code == 401 and error_of(login) == "invalid_credentials"
    reviewer = token_for(app_url)
    note = decide(app_url, allowed.json()["id"], "approve", reviewer, note=f"Note{char}")
    assert note.status_code == 422, note.text
    note_data = strict_json(note)
    assert note_data["errors"] == {"note": MSG_UNSUPPORTED} and "values" not in note_data
    assert applications_for(allowed_email)[0]["status"] == "pending"
    for answer in (response, allowed, login, note):
        assert answer.status_code < 500


def test_receipt_recorded_once(app_url: str, mail: Any) -> None:
    token, email = fresh("receipt")
    body = application(email, token)
    key = idempotency_key()
    first = create(app_url, body, key=key)
    assert first.status_code == 201, first.text
    app_id = first.json()["id"]
    receipts = emails_for(app_id)
    assert [r["kind"] for r in receipts] == ["receipt"]
    assert receipts[0]["subject"] == SUBJECTS["receipt"] and email in receipts[0]["recipient"].lower()
    assert receipts[0]["status"] in ("queued", "sent")
    assert create(app_url, body, key=key).headers.get("Idempotent-Replayed") == "true"
    assert error_of(create(app_url, body)) == "duplicate_application"
    reused = create(app_url, {**body, "goals": "changed"}, key=key)
    assert reused.status_code == 422 and error_of(reused) == "idempotency_key_reused"
    assert len(emails_for(app_id)) == 1
    refused_token, refused_email = fresh("receipt")
    assert create(app_url, application(refused_email, refused_token, consent=False)).status_code == 422
    assert emails_mentioning(refused_email) == []
    messages = mails_to(mail, email, SUBJECTS["receipt"])
    assert len(messages) == 1
    expected = RECEIPT_BODY.format(first=body["first_name"], company=body["company_name"])
    assert " ".join(text(messages[0]).split()) == " ".join(expected.split())
    down_base = os.environ["APP_MAILPIT_DOWN_URL"]
    down_token, down_email = fresh("receipt")
    down = create(down_base, application(down_email, down_token))
    assert down.status_code == 201, down.text
    assert [r["kind"] for r in emails_for(down.json()["id"])] == ["receipt"]


NAME_CASES = [
    ("Zo\u00eb\nBcc: spy@example.net", 'O"Brien, Jr.'),
    ("Semi; <angle>", "@ back\\slash"),
    ("\u00e4" * TEXT_LIMITS["first_name"], "\u00f6" * TEXT_LIMITS["last_name"]),
]


def display_name(first: str, last: str) -> str:
    return re.sub("[\r\n\t\u0085\u2028\u2029]+", " ", f"{first} {last}")


def test_display_name_round_trip(app_url: str, mail: Any) -> None:
    for first, last in NAME_CASES:
        token, email = fresh("display")
        body = application(email, token, first_name=first, last_name=last)
        assert create(app_url, body).status_code == 201
        messages = mails_to(mail, email, SUBJECTS["receipt"])
        assert len(messages) == 1
        message = messages[0]
        assert addresses(message.get("To")) and [a.lower() for a in addresses(message["To"])] == [email]
        assert message["To"][0]["Name"] == display_name(first, last)
        assert not addresses(message.get("Cc")) and not addresses(message.get("Bcc"))
        assert message.get("Subject") == SUBJECTS["receipt"]
        assert mail_from_address().lower() in [a.lower() for a in addresses(message.get("From"))]
        leaked = [m for m in mail.messages() if body["company_name"] in text(m) and m is not message
                  and email not in [a.lower() for a in addresses(m.get("To"))]]
        assert leaked == []


def test_wf_application_intake_receipt_by_name(browser: Browser, app_url: str, mail: Any) -> None:
    token, email = fresh("byname")
    body = application(email, token, first_name="Zo\u00eb", last_name='O"Brien, Jr.')
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        fill_partner_form(page, body)
        click(submit_button(page))
        shows(page, page.get_by_role("region", name="Application received"))
    assert len(applications_for(email)) == 1
    messages = mails_to(mail, email, SUBJECTS["receipt"])
    assert len(messages) == 1
    assert messages[0]["To"][0]["Name"] == display_name(body["first_name"], body["last_name"])
    assert len(addresses(messages[0]["To"])) == 1


def test_reviewer_sign_in(app_url: str) -> None:
    response = sign_in(app_url, REVIEWER)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["token_type"] == "Bearer" and isinstance(data["expires_in"], int) and data["expires_in"] > 0
    token = data["access_token"]
    assert isinstance(token, str) and token.count(".") == 2 and claims(token).get("sid")
    if os.environ.get("AUTH_ISSUER_URL"):
        assert claims(token)["iss"] == os.environ["AUTH_ISSUER_URL"]
    assert read_queue(app_url, token).status_code == 200
    wrong = sign_in(app_url, ANALYST, "not-the-password")
    assert wrong.status_code == 401 and wrong.json() == {"error": "invalid_credentials"}
    assert sign_in(app_url, ANALYST).status_code == 200


TOKEN_IDS = ["missing", "malformed", "expired", "forged"]


def b64(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


@pytest.mark.parametrize("case", TOKEN_IDS, ids=TOKEN_IDS)
def test_queue_refuses_anonymous(app_url: str, case: str) -> None:
    headers: dict[str, str] = {}
    if case == "malformed":
        headers["Authorization"] = "Bearer not-a-token"
    elif case == "expired":
        headers["Authorization"] = "Bearer " + ".".join(
            [b64({"alg": "RS256", "typ": "JWT"}), b64({"exp": 1, "iat": 0, "sid": "gone"}), "c2lnbmF0dXJl"]
        )
    elif case == "forged":
        head, payload, signature = token_for(app_url).split(".")
        headers["Authorization"] = f"Bearer {head}.{payload}.{('B' if signature[0] == 'A' else 'A') + signature[1:]}"
    response = call("GET", app_url, "/api/review/partner-applications", headers=headers)
    assert response.status_code == 401
    assert response.json() == {"error": "unauthorized"}
    assert response.headers.get("WWW-Authenticate", "").lower().startswith("bearer")


def test_decision_refuses_non_reviewers(app_url: str) -> None:
    body, app = created(app_url, "refused")
    anonymous = decide(app_url, app["id"], "approve", None)
    assert anonymous.status_code == 401 and error_of(anonymous) == "unauthorized"
    analyst = decide(app_url, app["id"], "approve", token_for(app_url, ANALYST))
    assert analyst.status_code == 403 and analyst.json() == {"error": "forbidden"}
    row = applications_for(body["work_email"])[0]
    assert row["status"] == "pending" and row["reviewer"] is None and row["decided_at"] is None
    assert [e["kind"] for e in emails_for(app["id"])] == ["receipt"]


def test_two_seeded_identities(app_url: str, tmp_path: Path) -> None:
    observed = Keycloak()
    for email in (REVIEWER, ANALYST):
        assert any(u.get("email") == email for u in observed.users(email))
    assert read_queue(app_url, token_for(app_url)).status_code == 200
    assert read_queue(app_url, token_for(app_url, ANALYST)).status_code == 403
    try:
        set_role(REVIEWER, False)
        set_role(ANALYST, True)
        with app_copy(tmp_path) as (base, proc, log):
            def healthy() -> None:
                response = copy_health(base, proc, log)
                assert response.status_code == 200, response.text
            poll(healthy, BOOT_DEADLINE_S)
            assert read_queue(app_url, token_for(app_url)).status_code == 200
            assert read_queue(app_url, token_for(app_url, ANALYST)).status_code == 403
    finally:
        with suppress(AssertionError, httpx.HTTPError):
            set_role(ANALYST, False)
        with suppress(AssertionError, httpx.HTTPError):
            set_role(REVIEWER, True)


def test_forbidden_versus_unauthorized(app_url: str) -> None:
    analyst = token_for(app_url, ANALYST)
    for response in (
        read_queue(app_url, analyst),
        read_application(app_url, MISSING_ID, analyst),
        read_application(app_url, "abc", analyst),
        decide(app_url, MISSING_ID, "approve", analyst),
    ):
        assert response.status_code == 403 and error_of(response) == "forbidden"
    reviewer = token_for(app_url)
    for app_id in (MISSING_ID, "abc", 0, -1):
        response = read_application(app_url, app_id, reviewer)
        assert response.status_code == 404 and response.json() == {"error": "not_found"}
    missing = decide(app_url, MISSING_ID, "approve", reviewer)
    assert missing.status_code == 404 and error_of(missing) == "not_found"


def test_role_checked_every_request(app_url: str) -> None:
    token = token_for(app_url)
    assert read_queue(app_url, token).status_code == 200
    try:
        set_role(REVIEWER, False)
        refused = read_queue(app_url, token)
        assert refused.status_code == 403 and error_of(refused) == "forbidden"
    finally:
        set_role(REVIEWER, True)
    assert read_queue(app_url, token).status_code == 200


def test_sign_out_ends_one_session(app_url: str) -> None:
    first, second = token_for(app_url), token_for(app_url)
    out = call("POST", app_url, "/api/auth/logout", token=first)
    assert out.status_code == 204 and out.content == b""
    gone_token = read_queue(app_url, first)
    assert gone_token.status_code == 401 and error_of(gone_token) == "unauthorized"
    assert read_queue(app_url, second).status_code == 200
    again = call("POST", app_url, "/api/auth/logout", token=first)
    assert again.status_code == 401
    analyst = token_for(app_url, ANALYST)
    assert read_queue(app_url, analyst).status_code == 403
    try:
        set_enabled(ANALYST, False)
        assert read_queue(app_url, analyst).status_code == 401
    finally:
        set_enabled(ANALYST, True)
    assert read_queue(app_url, analyst).status_code == 401
    assert sign_in(app_url, ANALYST).status_code == 200


def test_wf_reviewer_access_sign_out(browser: Browser, app_url: str) -> None:
    created(app_url, "signout")
    other = token_for(app_url)
    with visit(browser, f"{app_url}/review") as page:
        dismiss_cookies(page)
        with page.expect_request(is_queue_request, timeout=UI_DEADLINE_S * 1000) as info:
            ui_sign_in(page, REVIEWER)
        page_token = info.value.headers["authorization"].split(" ", 1)[1]
        shows(page, queue_table(page))
        with page.expect_response(lambda r: urlsplit(r.url).path == "/api/auth/logout", timeout=UI_DEADLINE_S * 1000) as out:
            click(page.get_by_role("button", name="Sign out"))
        assert out.value.status == 204
        reads(page, page.get_by_role("status", name="Review status"), SIGNED_OUT)
        email_box = page.get_by_role("form", name="Staff sign in").get_by_role("textbox", name="Email")
        eventually(page, lambda: expect(email_box).to_be_focused(timeout=LOOK_MS))
    assert read_queue(app_url, page_token).status_code == 401
    assert read_queue(app_url, other).status_code == 200


def is_queue_request(request: Any) -> bool:
    return urlsplit(request.url).path == "/api/review/partner-applications" and request.method == "GET"


def test_wf_reviewer_access_refused_analyst(browser: Browser, app_url: str) -> None:
    body, app = created(app_url, "analystview")
    with visit(browser, f"{app_url}/review") as page:
        dismiss_cookies(page)
        with page.expect_response(is_queue_response, timeout=UI_DEADLINE_S * 1000) as info:
            ui_sign_in(page, ANALYST)
        assert info.value.status == 403
        alert = page.get_by_role("alert").filter(has_text=NO_ACCESS)
        shows(page, alert)
        eventually(page, lambda: expect(alert).to_be_focused(timeout=LOOK_MS))
        shows(page, page.get_by_role("button", name="Sign out"))
        for hidden in (queue_table(page), page.get_by_role("navigation", name="Application status"),
                       page.get_by_role("navigation", name="Queue order"), page.get_by_role("status", name="Queue counts")):
            gone(page, hidden)
        assert body["company_name"] not in page.content()
    assert read_queue(app_url, token_for(app_url, ANALYST)).status_code == 403
    assert applications_for(body["work_email"])[0]["status"] == "pending"
    assert app["status"] == "pending"


def test_sign_in_limit_lock(app_url: str) -> None:
    _, email = fresh("lock")
    for _ in range(LOGIN_FAILURES):
        failed = sign_in(app_url, email, "wrong-password")
        assert failed.status_code == 401 and failed.json() == {"error": "invalid_credentials"}
    assert failures_for(email) == LOGIN_FAILURES
    locked = sign_in(app_url, f"  {email.upper()} ", "wrong-password")
    assert locked.status_code == 429 and locked.json() == {"error": "too_many_attempts"}
    assert 1 <= int(locked.headers["Retry-After"]) <= DEFAULT_WINDOW_S
    assert failures_for(email) == LOGIN_FAILURES
    _, other = fresh("lock")
    missing = call("POST", app_url, "/api/auth/login", content=encode({"email": other}))
    assert missing.status_code == 422
    assert missing.json()["errors"] == {"password": MSG_REQUIRED} and "values" not in missing.json()
    assert failures_for(other) == 0
    assert sign_in(app_url, other, "pw\u0001").status_code == 401
    assert failures_for(other) == 1


def test_sign_in_limit_correct_password(app_url: str) -> None:
    base = os.environ["APP_SHORT_WINDOWS_URL"]

    def signs_in() -> None:
        assert sign_in(base, ANALYST).status_code == 200

    poll(signs_in, SHORT_WINDOW_S + HTTP_TIMEOUT_S)
    try:
        with ThreadPoolExecutor(LOGIN_FAILURES) as pool:
            failures = list(pool.map(lambda _: sign_in(base, ANALYST, "wrong-password").status_code,
                                     range(LOGIN_FAILURES)))
        assert failures == [401] * LOGIN_FAILURES, failures
        locked = sign_in(base, ANALYST)
        assert locked.status_code == 429 and error_of(locked) == "too_many_attempts"
        assert 1 <= int(locked.headers["Retry-After"]) <= SHORT_WINDOW_S
    finally:
        poll(signs_in, SHORT_WINDOW_S + HTTP_TIMEOUT_S)
    assert failures_for(ANALYST) == 0


def test_sign_in_limit_concurrent(app_url: str) -> None:
    _, email = fresh("burstlock")
    answers = together([lambda: sign_in(app_url, email, "wrong-password") for _ in range(BURST)])
    statuses = sorted(r.status_code for r in answers)
    assert statuses.count(401) == LOGIN_FAILURES
    assert statuses.count(429) == BURST - LOGIN_FAILURES
    assert failures_for(email) == LOGIN_FAILURES


def test_wf_reviewer_access_sign_in_wait(browser: Browser, app_url: str) -> None:
    _, email = fresh("countdown")
    for _ in range(LOGIN_FAILURES):
        assert sign_in(app_url, email, "wrong-password").status_code == 401
    with visit(browser, f"{app_url}/review") as page:
        dismiss_cookies(page)
        form = page.get_by_role("form", name="Staff sign in")
        email_box, password_box = form.get_by_role("textbox", name="Email"), form.get_by_label("Password")
        button = form.get_by_role("button", name="Sign in")
        logins: list[Any] = []
        page.on("request", lambda r: logins.append(r) if urlsplit(r.url).path == "/api/auth/login" else None)
        fill(email_box, f" {email.upper()} ")
        typed_password = f"wrong-{email}"
        fill(password_box, typed_password)
        with page.expect_response(lambda r: urlsplit(r.url).path == "/api/auth/login", timeout=UI_DEADLINE_S * 1000) as info:
            click(button)
        assert info.value.status == 429
        wait = int(info.value.headers["retry-after"])
        alert = page.get_by_role("alert").filter(has_text="Too many sign-in attempts.")
        shown = eventually(page, lambda: countdown(alert, wait))
        marked(page, button, "aria-disabled", "true")
        sent = len(logins)
        button.dispatch_event("click")
        password_box.press("Enter")
        if shown > 2:
            advance(page, 1000)
            before = shown
            shown = eventually(page, lambda: countdown(alert, before - 1, before - 2))
        assert len(logins) == sent
        _, other = fresh("countdown")
        fill(email_box, other)
        gone(page, alert)
        eventually(page, lambda: expect(button).not_to_have_attribute("aria-disabled", "true", timeout=LOOK_MS))
        fill(email_box, email)
        eventually(page, lambda: countdown(alert, shown, max(1, shown - 3)))
        advance(page, wait * 1000)
        gone(page, alert)
        reads(page, page.get_by_role("status", name="Review status"), WAIT_OVER)
        eventually(page, lambda: expect(button).not_to_have_attribute("aria-disabled", "true", timeout=LOOK_MS))
        expect(email_box).to_have_value(email)
        expect(password_box).to_have_value(typed_password)
    assert failures_for(email) == LOGIN_FAILURES


def test_wf_reviewer_access_withdrawn(browser: Browser, app_url: str) -> None:
    body, app = created(app_url, "withdrawn")
    company = body["company_name"]
    note = f"internal {company}"
    detail = read_application(app_url, app["id"], token_for(app_url)).json()
    with review_page(browser, app_url) as page:
        table = queue_table(page)
        link = table.get_by_role("link", name=company, exact=True)
        shows(page, link)
        click(link)
        shows(page, page.get_by_role("region", name="Application details"))
        click(table.get_by_role("button", name=f"Reject {company}", exact=True))
        dialog = page.get_by_role("dialog", name="Reject application")
        shows(page, dialog)
        fill(dialog.get_by_role("textbox", name="Internal note"), note)
        try:
            set_role(REVIEWER, False)
            click(dialog.get_by_role("button", name="Confirm"))
            alert = page.get_by_role("alert").filter(has_text=NO_ACCESS)
            shows(page, alert)
            eventually(page, lambda: expect(alert).to_be_focused(timeout=LOOK_MS))
            for removed in (table, dialog, page.get_by_role("region", name="Application details"),
                            page.get_by_role("status", name="Queue counts"),
                            page.get_by_role("navigation", name="Application status"),
                            page.get_by_role("navigation", name="Queue order")):
                gone(page, removed)
            shows(page, page.get_by_role("button", name="Sign out"))
            document = page.content()
            for secret in (company, body["work_email"], body["last_name"], note, berlin_cell(detail["reply_due_at"])):
                assert secret not in document, f"{secret!r} still in the page"
            assert applications_for(body["work_email"])[0]["status"] == "pending"
        finally:
            set_role(REVIEWER, True)
        page.reload()
        shows(page, queue_table(page).get_by_role("link", name=company, exact=True))


def test_private_answers_never_cached(app_url: str) -> None:
    reviewer = token_for(app_url)
    analyst = token_for(app_url, ANALYST)
    _, wrong_email = fresh("nostore")
    _, locked_email = fresh("nostore")
    for _ in range(LOGIN_FAILURES):
        sign_in(app_url, locked_email, "wrong-password")
    body, app = created(app_url, "nostore")
    assert decide(app_url, app["id"], "approve", reviewer).status_code == 200
    padding = "x" * (BODY_LIMIT_BYTES + 1)
    answers = {
        200: sign_in(app_url, REVIEWER),
        401: sign_in(app_url, wrong_email, "wrong-password"),
        422: call("POST", app_url, "/api/auth/login", content=encode({})),
        405: call("GET", app_url, "/api/auth/login"),
        415: call("POST", app_url, "/api/auth/login", content=b"x", content_type="text/plain"),
        413: call("POST", app_url, "/api/auth/login", content=encode({"email": padding})),
        400: call("POST", app_url, "/api/auth/login", content=b'{"email": '),
        429: sign_in(app_url, locked_email),
        204: call("POST", app_url, "/api/auth/logout", token=token_for(app_url)),
    }
    review = {
        200: read_queue(app_url, reviewer),
        401: read_queue(app_url, None),
        403: read_queue(app_url, analyst),
        404: read_application(app_url, MISSING_ID, reviewer),
        400: read_queue(app_url, reviewer, [("status", "archived")]),
        409: decide(app_url, app["id"], "reject", reviewer),
        422: decide(app_url, app["id"], "maybe", reviewer),
        405: call("PUT", app_url, f"/api/review/partner-applications/{app['id']}"),
        415: call("POST", app_url, f"/api/review/partner-applications/{app['id']}/decision", content=b"x", content_type="text/plain"),
    }
    for group in (answers, review):
        for status, response in group.items():
            assert response.status_code == status, (status, response.text)
            assert "no-store" in response.headers.get("Cache-Control", "").lower(), status
            assert "ETag" not in response.headers and "Last-Modified" not in response.headers, status
    assert body["work_email"]


def test_queue_status_filter(app_url: str) -> None:
    token = token_for(app_url)
    ids: dict[str, int] = {}
    for status, decision in (("pending", None), ("approved", "approve"), ("rejected", "reject")):
        _, app = created(app_url, "filter")
        if decision:
            assert decide(app_url, app["id"], decision, token).status_code == 200
        ids[status] = app["id"]
    for status, own in ids.items():
        for sort in ("submitted", "reply_due"):
            response = read_queue(app_url, token, [("status", status), ("sort", sort)])
            assert response.status_code == 200, response.text
            items = response.json()["items"]
            assert all(item["status"] == status for item in items)
            listed = {item["id"] for item in items}
            assert own in listed and not (set(ids.values()) - {own}) & listed
            if sort == "submitted":
                stamps = [parse_time(i["created_at"]) for i in items]
                assert stamps == sorted(stamps, reverse=True)
            else:
                stamps = [parse_time(i["reply_due_at"]) for i in items]
                assert stamps == sorted(stamps)


def assert_decision_effects(app_url: str, decision: str, status: str, kind: str) -> None:
    body, app = created(app_url, decision)
    token = token_for(app_url)
    response = decide(app_url, app["id"], decision, token, note="  Checked references \u00e9  ")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["id"] == app["id"] and data["status"] == status and data["reviewer"] == REVIEWER
    assert data["decided_at"] is not None and data["decision_note"] == "Checked references \u00e9"
    assert data["outcome_email_status"] in ("queued", "sent")
    row = applications_for(body["work_email"])[0]
    assert row["status"] == status and row["reviewer"] == REVIEWER and row["decided_at"] is not None
    outcome = [e for e in emails_for(app["id"]) if e["kind"] != "receipt"]
    assert [e["kind"] for e in outcome] == [kind]
    assert outcome[0]["subject"] == SUBJECTS[kind] and body["work_email"] in outcome[0]["recipient"].lower()


def test_approve_decision(app_url: str) -> None:
    assert_decision_effects(app_url, "approve", "approved", "approved")


def test_reject_decision(app_url: str) -> None:
    assert_decision_effects(app_url, "reject", "rejected", "rejected")


def test_decided_once(app_url: str) -> None:
    body, app = created(app_url, "once")
    token = token_for(app_url)
    assert decide(app_url, app["id"], "approve", token, note="first").status_code == 200
    before = applications_for(body["work_email"])[0]
    for decision in ("approve", "reject"):
        again = decide(app_url, app["id"], decision, token, note="second")
        assert again.status_code == 409
        assert again.json() == {"error": "already_decided", "status": "approved"}
    after = applications_for(body["work_email"])[0]
    for column in ("status", "reviewer", "decision_note", "decided_at"):
        assert after[column] == before[column]
    assert sorted(e["kind"] for e in emails_for(app["id"])) == ["approved", "receipt"]


def test_decision_body_validated(app_url: str) -> None:
    body, app = created(app_url, "decisionbody")
    token = token_for(app_url)
    cases = [
        (decide(app_url, app["id"], "maybe", token), {"decision": MSG_DECISION}),
        (call("POST", app_url, f"/api/review/partner-applications/{app['id']}/decision", token=token, content=encode({})),
         {"decision": MSG_DECISION}),
        (decide(app_url, app["id"], "approve", token, note=5), {"note": MSG_NOTE_TEXT}),
        (decide(app_url, app["id"], "approve", token, note="n" * (NOTE_LIMIT + 1)), {"note": MSG_LIMIT.format(NOTE_LIMIT)}),
    ]
    for response, errors in cases:
        assert response.status_code == 422, response.text
        data = response.json()
        assert data["error"] == "validation_failed" and data["errors"] == errors and "values" not in data
    row = applications_for(body["work_email"])[0]
    assert row["status"] == "pending" and row["decided_at"] is None
    assert [e["kind"] for e in emails_for(app["id"])] == ["receipt"]
    note = "\U0001F680" + "n" * (NOTE_LIMIT - 1)
    accepted = decide(app_url, app["id"], "approve", token, note=f" {note} ")
    assert accepted.status_code == 200 and accepted.json()["decision_note"] == note


def test_wf_reviewer_decision_reject_note_refused(browser: Browser, app_url: str) -> None:
    body, app = created(app_url, "rejectui")
    company = body["company_name"]
    with review_page(browser, app_url) as page:
        table = queue_table(page)
        reject = table.get_by_role("button", name=f"Reject {company}", exact=True)
        shows(page, reject)
        click(reject)
        dialog = page.get_by_role("dialog", name="Reject application")
        note_box = dialog.get_by_role("textbox", name="Internal note")
        eventually(page, lambda: expect(note_box).to_be_focused(timeout=LOOK_MS))
        expect(dialog).to_contain_text(NOTE_HINT)
        fill(note_box, "n" * (NOTE_LIMIT + 1))
        if len(note_box.input_value()) > NOTE_LIMIT:
            click(dialog.get_by_role("button", name="Confirm"))
            eventually(page, lambda: expect(dialog).to_contain_text(MSG_LIMIT.format(NOTE_LIMIT), timeout=LOOK_MS))
        assert applications_for(body["work_email"])[0]["status"] == "pending"
        refusal_note = f"Not a fit {app['id']}"
        fill(note_box, refusal_note)
        click(dialog.get_by_role("button", name="Confirm"))
        reads(page, page.get_by_role("status", name="Review status"), REJECTED_COPY)
    row = applications_for(body["work_email"])[0]
    assert row["status"] == "rejected" and row["decision_note"] == refusal_note
    assert app["id"] == row["id"]


def test_wf_reviewer_decision_approve(browser: Browser, app_url: str) -> None:
    body, app = created(app_url, "approveui")
    company = body["company_name"]
    note = "Strong channel fit"
    detail = read_application(app_url, app["id"], token_for(app_url)).json()
    with review_page(browser, app_url) as page:
        table = queue_table(page)
        link = table.get_by_role("link", name=company, exact=True)
        shows(page, link)
        marked(page, page.get_by_role("navigation", name="Application status").get_by_role("link", name="Pending"))
        counts = page.get_by_role("status", name="Queue counts")
        reads(page, counts, QUEUE_COUNTS_PATTERN)
        click(link)
        details = page.get_by_role("region", name="Application details")
        shows(page, details)
        for value in (body["work_email"], body["job_title"], body["goals"], berlin_cell(detail["reply_due_at"])):
            eventually(page, lambda v=value: expect(details).to_contain_text(v, timeout=LOOK_MS))
        click(table.get_by_role("button", name=f"Approve {company}", exact=True))
        dialog = page.get_by_role("dialog", name="Approve application")
        note_box = dialog.get_by_role("textbox", name="Internal note")
        eventually(page, lambda: expect(note_box).to_be_focused(timeout=LOOK_MS))
        fill(note_box, note)
        with page.expect_response(is_queue_response, timeout=UI_DEADLINE_S * 1000) as info:
            click(dialog.get_by_role("button", name="Confirm"))
        latest = info.value.json()["counts"]
        reads(page, page.get_by_role("status", name="Review status"), APPROVED_COPY)
        gone(page, link)
        reads(page, counts, f"{latest['pending']} pending, {latest['approved']} approved, {latest['rejected']} rejected")
        eventually(page, lambda: expect(details).to_contain_text(re.compile(r"Outcome email: (Queued|Sent)"), timeout=LOOK_MS))
    stored = read_application(app_url, app["id"], token_for(app_url)).json()
    assert stored["status"] == "approved" and stored["decision_note"] == note and stored["reviewer"] == REVIEWER


def test_outcome_email_contract(app_url: str, mail: Any) -> None:
    token = token_for(app_url)
    for decision, kind, sentence in (("approve", "approved", APPROVED_SENTENCE), ("reject", "rejected", REJECTED_SENTENCE)):
        body, app = created(app_url, "contract")
        note = f"secret-note-{app['id']}"
        assert decide(app_url, app["id"], decision, token, note=note).status_code == 200
        messages = mails_to(mail, body["work_email"], SUBJECTS[kind])
        assert len(messages) == 1
        message = messages[0]
        assert [a.lower() for a in addresses(message.get("To"))] == [body["work_email"]]
        assert mail_from_address().lower() in [a.lower() for a in addresses(message.get("From"))]
        content = text(message)
        assert body["company_name"] in content and f"Hello {body['first_name']}," in content
        assert sentence in " ".join(content.split())
        assert note not in json.dumps(message)


def test_outcome_email_header_safety(app_url: str, mail: Any) -> None:
    token_value, email = fresh("header")
    company = f"Acme {token_value}\r\nBcc: spy@example.net\r\nSubject: Free"
    body = application(email, token_value, company_name=company)
    response = create(app_url, body)
    assert response.status_code == 201, response.text
    assert applications_for(email)[0]["company_name"] == company
    assert decide(app_url, response.json()["id"], "approve", token_for(app_url)).status_code == 200
    messages = mails_to(mail, email, SUBJECTS["approved"])
    assert len(messages) == 1
    message = messages[0]
    assert message.get("Subject") == SUBJECTS["approved"]
    assert [a.lower() for a in addresses(message.get("To"))] == [email]
    assert not addresses(message.get("Cc")) and not addresses(message.get("Bcc"))
    stray = [m for m in mail.messages() if f"Acme {token_value}" in text(m)
             and email not in [a.lower() for a in addresses(m.get("To"))]]
    assert stray == []


def test_wf_reviewer_decision_status_view(browser: Browser, app_url: str) -> None:
    body, app = created(app_url, "statusview")
    assert decide(app_url, app["id"], "approve", token_for(app_url)).status_code == 200
    company = body["company_name"]
    with review_page(browser, app_url) as page:
        nav = page.get_by_role("navigation", name="Application status")
        pending, approved = nav.get_by_role("link", name="Pending"), nav.get_by_role("link", name="Approved")
        link = queue_table(page).get_by_role("link", name=company, exact=True)
        marked(page, pending)
        click(approved)
        at(page, "/review", status="approved")
        marked(page, approved)
        shows(page, link)
        page.go_back()
        at(page, "/review")
        marked(page, pending)
        gone(page, link)
        page.go_forward()
        at(page, "/review", status="approved")
        shows(page, link)
        page.reload()
        at(page, "/review", status="approved")
        marked(page, approved)
        shows(page, link)
        page.goto(f"{app_url}/review?status=archived")
        at(page, "/review")
        marked(page, pending)
    listed = read_queue(app_url, token_for(app_url), [("status", "approved")]).json()["items"]
    assert app["id"] in {i["id"] for i in listed}


def test_outcome_email_delivery_state(browser: Browser, app_url: str, mail: Any) -> None:
    body, app = created(app_url, "delivery")
    token = token_for(app_url)
    decided = decide(app_url, app["id"], "approve", token)
    assert decided.status_code == 200 and decided.json()["outcome_email_status"] in ("queued", "sent")

    def sent() -> dict[str, Any]:
        row = next(e for e in emails_for(app["id"]) if e["kind"] == "approved")
        assert row["status"] == "sent", row
        return row

    row = poll(sent, MAIL_DEADLINE_S)
    assert row["attempts"] >= 1 and row["sent_epoch"] is not None
    assert row["sent_epoch"] - row["created_epoch"] <= FIRST_ATTEMPT_S + HTTP_TIMEOUT_S
    assert read_application(app_url, app["id"], token).json()["outcome_email_status"] == "sent"
    messages = mails_to(mail, body["work_email"], SUBJECTS["approved"])
    assert len(messages) == 1
    assert messages[0].get("MessageID", "").strip("<>") == f"outbound-email-{row['id']}@relayo.example"
    with review_page(browser, app_url, query="?status=approved") as page:
        link = queue_table(page).get_by_role("link", name=body["company_name"], exact=True)
        shows(page, link)
        click(link)
        details = page.get_by_role("region", name="Application details")
        eventually(page, lambda: expect(details).to_contain_text(re.compile(r"Outcome email:\s*Sent"), timeout=LOOK_MS))
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    down_body, down_app = created(down, "delivery")
    held_decision = decide(down, down_app["id"], "reject", token_for(down))
    assert held_decision.status_code == 200 and held_decision.json()["outcome_email_status"] == "queued"

    def backoff_holds() -> None:
        outcome = next(e for e in emails_for(down_app["id"]) if e["kind"] == "rejected")
        if outcome["status"] == "queued" and outcome["attempts"]:
            wait = outcome["next_epoch"] - outcome["last_epoch"]
            assert abs(wait - min(2 ** outcome["attempts"], BACKOFF_CAP_S)) <= CLOCK_SLACK_S
        assert outcome["status"] == "sent" or outcome["attempts"] >= 2

    poll(backoff_holds, MAIL_DEADLINE_S)


def test_reply_due_business_hours(app_url: str) -> None:
    assert reply_due(parse_time("2026-10-23T14:00:00Z")) == parse_time("2026-10-27T15:00:00Z")
    assert reply_due(parse_time("2026-12-23T14:00:00Z")) == parse_time("2026-12-29T14:00:00Z")
    body, app = created(app_url, "replydue")
    token = token_for(app_url)
    detail = read_application(app_url, app["id"], token).json()
    assert re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", detail["reply_due_at"])
    created_at = datetime.fromtimestamp(applications_for(body["work_email"])[0]["created_epoch"], timezone.utc)
    assert parse_time(detail["reply_due_at"]) == reply_due(created_at)
    for item in read_queue(app_url, token).json()["items"]:
        written = parse_time(item["created_at"])
        assert parse_time(item["reply_due_at"]) in {reply_due(written), reply_due(written - timedelta(seconds=1))}, item["id"]


def test_queue_order_api(app_url: str) -> None:
    token = token_for(app_url)
    created(app_url, "order")
    for sort in ("submitted", "reply_due"):
        assert read_queue(app_url, token, [("sort", sort)]).status_code == 200
    for params in ([("sort", "oldest")], [("sort", "reply_due"), ("sort", "reply_due")]):
        response = read_queue(app_url, token, params)
        assert response.status_code == 400 and response.json() == {"error": "invalid_sort"}


def test_wf_reviewer_decision_queue_order(browser: Browser, app_url: str) -> None:
    body, app = created(app_url, "orderui")
    detail = read_application(app_url, app["id"], token_for(app_url)).json()
    with review_page(browser, app_url) as page:
        nav = page.get_by_role("navigation", name="Queue order")
        newest, due = nav.get_by_role("link", name="Newest first"), nav.get_by_role("link", name="Reply due first")
        table = queue_table(page)
        marked(page, newest)
        click(due)
        eventually(page, lambda: assert_true(query_of(page).get("sort") == ["reply_due"]
                                             and query_of(page).get("status", ["pending"]) == ["pending"], page.url))
        marked(page, due)
        api = [" ".join(i["company_name"].split())
               for i in read_queue(app_url, token_for(app_url), [("status", "pending"), ("sort", "reply_due")]).json()["items"]]

        def same_order() -> None:
            shown = [n for n in link_names(table) if n in set(api)]
            assert shown and shown == [n for n in api if n in set(shown)], shown

        eventually(page, same_order)
        row = table.get_by_role("row").filter(has=page.get_by_role("link", name=body["company_name"], exact=True))
        eventually(page, lambda: expect(row).to_contain_text(berlin_cell(detail["reply_due_at"]), timeout=LOOK_MS))
        page.go_back()
        at(page, "/review")
        marked(page, newest)
        page.go_forward()
        at(page, "/review", sort="reply_due")
        page.reload()
        marked(page, due)
        page.goto(f"{app_url}/review?sort=oldest")
        at(page, "/review")
        marked(page, newest)


def test_duplicate_email_race(app_url: str) -> None:
    token, email = fresh("dupe")
    variants = [email.upper() if i % 2 else email for i in range(BURST)]
    answers = together([lambda v=v: create(app_url, application(email, token, work_email=v)) for v in variants])
    assert [r.status_code for r in answers].count(201) == 1
    for response in answers:
        if response.status_code != 201:
            assert response.status_code == 409
            assert response.json() == {"error": "duplicate_application", "message": DUPLICATE_MESSAGE}
    rows = applications_for(email)
    assert len(rows) == 1 and len(emails_for(rows[0]["id"])) == 1


def test_decision_race(app_url: str, mail: Any) -> None:
    body, app = created(app_url, "decisionrace")
    token = token_for(app_url)
    answers = together([lambda d=("approve" if i % 2 else "reject"): decide(app_url, app["id"], d, token) for i in range(BURST)])
    winners = [r for r in answers if r.status_code == 200]
    assert len(winners) == 1
    final = winners[0].json()["status"]
    for response in answers:
        if response.status_code != 200:
            assert response.status_code == 409 and response.json() == {"error": "already_decided", "status": final}
    outcome = [e for e in emails_for(app["id"]) if e["kind"] != "receipt"]
    assert len(outcome) == 1
    delivered = [m for m in mails_to(mail, body["work_email"]) if m.get("Subject") in (SUBJECTS["approved"], SUBJECTS["rejected"])]
    if not delivered:
        delivered = mails_to(mail, body["work_email"], SUBJECTS["approved" if final == "approved" else "rejected"])
    assert len(delivered) == 1


def test_retried_submission(app_url: str) -> None:
    token, email = fresh("retry")
    body = application(email, token)
    key = idempotency_key()
    first = create(app_url, body, key=key)
    assert first.status_code == 201 and "Idempotent-Replayed" not in first.headers
    duplicate = create(app_url, body)
    assert duplicate.status_code == 409 and error_of(duplicate) == "duplicate_application"
    replay = create(app_url, body, key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replayed") == "true"
    rows = applications_for(email)
    assert len(rows) == 1 and len(emails_for(rows[0]["id"])) == 1


def test_wf_concurrency_dropped_connection_retry(browser: Browser, app_url: str, mail: Any) -> None:
    token, email = fresh("dropped")
    body = application(email, token)
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        keys: list[str | None] = []
        dropped = {"done": False}

        def drop_once(route: Any) -> None:
            keys.append(route.request.headers.get("idempotency-key"))
            if dropped["done"]:
                route.continue_()
                return
            dropped["done"] = True
            route.fetch()
            route.abort()

        page.route("**/api/partner-applications", drop_once)
        fill_partner_form(page, body)
        click(submit_button(page))
        alert = page.get_by_role("alert").filter(has_text=OUTAGE_ALERT)
        shows(page, alert)
        shows(page, alert.get_by_role("button", name="Try again"))
        assert len(applications_for(email)) == 1
        page.reload()
        eventually(page, lambda: expect(text_field(page, "company_name")).to_have_value(body["company_name"], timeout=LOOK_MS))
        click(submit_button(page))
        region = page.get_by_role("region", name="Application received")
        shows(page, region)
        eventually(page, lambda: expect(region).to_contain_text(THANK_YOU.format(body["company_name"]), timeout=LOOK_MS))
        assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
        page.reload()
        eventually(page, lambda: expect(text_field(page, "first_name")).to_have_value("", timeout=LOOK_MS))
    rows = applications_for(email)
    assert len(rows) == 1 and len(emails_for(rows[0]["id"])) == 1
    receipts = mails_to(mail, email, SUBJECTS["receipt"])
    assert len(receipts) == 1 and receipts[0]["To"][0]["Name"] == display_name(body["first_name"], body["last_name"])


def test_concurrent_distinct_applications(app_url: str) -> None:
    pairs = [fresh("distinct") for _ in range(BURST)]
    answers = together([lambda p=p: create(app_url, application(p[1], p[0])) for p in pairs])
    assert [r.status_code for r in answers] == [201] * BURST
    assert len({r.json()["id"] for r in answers}) == BURST
    for _, email in pairs:
        rows = applications_for(email)
        assert len(rows) == 1 and [e["kind"] for e in emails_for(rows[0]["id"])] == ["receipt"]


def test_idempotency_key_format(app_url: str) -> None:
    token, email = fresh("keyformat")
    body = application(email, token)
    for bad in ("", "two words", "x" * (KEY_MAX + 1), "cl\u00e9".encode(), "tab\tkey"):
        response = create(app_url, body, key=bad)
        assert response.status_code == 400 and response.json() == {"error": "invalid_idempotency_key"}
    assert applications_for(email) == []
    good = (idempotency_key() + "~" * KEY_MAX)[:KEY_MAX]
    assert create(app_url, body, key=good).status_code == 201


def test_idempotency_same_body_rule(app_url: str) -> None:
    token, email = fresh("samebody")
    body = application(email, token, company_name=f"Caf\u00e9 {token}")
    key = idempotency_key()
    first = call("POST", app_url, "/api/partner-applications", content=encode({**body, "extra": 1}), key=key)
    assert first.status_code == 201 and "Idempotent-Replayed" not in first.headers
    reordered = dict(reversed(list({**body, "extra": 1.0}.items())))
    replay = call("POST", app_url, "/api/partner-applications", content=encode(reordered, indent=3), key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replayed") == "true"
    for changed_body in ({**body, "extra": True}, {**body, "extra": 1, "company_name": f"Cafe\u0301 {token}"}, body):
        reused = create(app_url, changed_body, key=key)
        assert reused.status_code == 422 and reused.json() == {"error": "idempotency_key_reused"}
    rows = applications_for(email)
    assert len(rows) == 1 and len(emails_for(rows[0]["id"])) == 1
    token2, email2 = fresh("samebody")
    invalid_key, invalid = idempotency_key(), application(email2, token2, website="example.org")
    refused = create(app_url, invalid, key=invalid_key)
    again = create(app_url, invalid, key=invalid_key)
    assert refused.status_code == again.status_code == 422 and again.json() == refused.json()
    assert again.headers.get("Idempotent-Replayed") == "true"
    duplicate_key = idempotency_key()
    duplicate = create(app_url, body, key=duplicate_key)
    assert duplicate.status_code == 409 and error_of(duplicate) == "duplicate_application"
    repeated = create(app_url, body, key=duplicate_key)
    assert repeated.status_code == 409 and repeated.headers.get("Idempotent-Replayed") == "true"
    assert len(emails_for(rows[0]["id"])) == 1


def test_idempotency_simultaneous_identical(app_url: str) -> None:
    token, email = fresh("inflight")
    body, key = application(email, token), idempotency_key()
    answers = together([lambda: create(app_url, body, key=key) for _ in range(BURST)])
    fresh_answers = [r for r in answers if r.status_code == 201 and "Idempotent-Replayed" not in r.headers]
    assert len(fresh_answers) == 1
    for response in answers:
        if response is fresh_answers[0]:
            continue
        if response.status_code == 409:
            assert response.json() == {"error": "request_in_progress"}
        else:
            assert response.status_code == 201 and response.headers.get("Idempotent-Replayed") == "true"
            assert response.json() == fresh_answers[0].json()
    assert len(applications_for(email)) == 1


def test_wf_concurrency_double_submit(browser: Browser, app_url: str) -> None:
    token, email = fresh("doubleclick")
    body = application(email, token)
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        keys: list[str | None] = []
        page.on("request", lambda r: keys.append(r.headers.get("idempotency-key"))
                if urlsplit(r.url).path == "/api/partner-applications" and r.method == "POST" else None)
        fill_partner_form(page, body)
        submit_button(page).dblclick()
        shows(page, page.get_by_role("region", name="Application received"))
    assert keys and len(set(keys)) == 1 and keys[0]
    rows = applications_for(email)
    assert len(rows) == 1 and len(emails_for(rows[0]["id"])) == 1


def test_case_insensitive_email_uniqueness(app_url: str) -> None:
    token, email = fresh("caseless")
    local, domain = email.split("@")
    assert create(app_url, application(email, token, work_email=f"\u00c9LODIE.{local}@{domain.upper()}")).status_code == 201
    for variant in (f"\u00e9lodie.{local}@{domain}", f"E\u0301LODIE.{local}@{domain}"):
        response = create(app_url, application(email, token, work_email=variant))
        assert response.status_code == 409 and error_of(response) == "duplicate_application"
    assert len(applications_for(f"\u00e9lodie.{local}@{domain}")) == 1


def test_idempotency_key_lifetime(app_url: str) -> None:
    base = os.environ["APP_SHORT_WINDOWS_URL"]
    token, email = fresh("ttl")
    body, key = application(email, token), idempotency_key()
    started = time.monotonic()
    first = create(base, body, key=key)
    assert first.status_code == 201
    replays = {"n": 0}

    def expired() -> httpx.Response:
        response = create(base, body, key=key)
        if response.headers.get("Idempotent-Replayed") == "true":
            assert response.json() == first.json()
            replays["n"] += 1
            raise AssertionError("still replaying")
        return response

    fresh_answer = poll(expired, SHORT_TTL_S + HTTP_TIMEOUT_S)
    assert replays["n"] >= 1
    assert time.monotonic() - started >= SHORT_TTL_S - CLOCK_SLACK_S
    assert fresh_answer.status_code == 409 and error_of(fresh_answer) == "duplicate_application"
    repeat = create(base, body, key=key)
    assert repeat.status_code == 409 and repeat.headers.get("Idempotent-Replayed") == "true"
    token2, email2 = fresh("ttl")
    body2, key2 = application(email2, token2), idempotency_key()
    assert create(base, body2, key=key2).status_code == 201

    def lifetime_over() -> None:
        rows = Postgres().rows(
            f"SELECT extract(epoch FROM now()) >= extract(epoch FROM created_at) + {SHORT_TTL_S + CLOCK_SLACK_S} AS over "
            f"FROM partner_applications WHERE work_email = {sql_text(email2)}"
        )
        assert rows and rows[0]["over"]

    poll(lifetime_over, SHORT_TTL_S + HTTP_TIMEOUT_S)
    answers = together([lambda: create(base, body2, key=key2) for _ in range(BURST)])
    processed = [r for r in answers if r.status_code == 409 and error_of(r) == "duplicate_application"
                 and "Idempotent-Replayed" not in r.headers]
    assert len(processed) == 1
    for response in answers:
        if response is not processed[0]:
            assert error_of(response) == "request_in_progress" or response.headers.get("Idempotent-Replayed") == "true"
    for owner in (email, email2):
        rows = applications_for(owner)
        assert len(rows) == 1 and len(emails_for(rows[0]["id"])) == 1


def test_consistent_queue_counts(app_url: str) -> None:
    token = token_for(app_url)

    def writer() -> None:
        for index in range(BURST):
            _, app = created(app_url, "counts")
            if index % 2:
                decide(app_url, app["id"], "approve", token)

    observations: list[tuple[str | None, dict[str, Any]]] = []
    with ThreadPoolExecutor(max_workers=1) as pool:
        job = pool.submit(writer)
        while not job.done() or not observations:
            for status in (None, "pending", "approved"):
                params = [("status", status)] if status else None
                response = read_queue(app_url, token, params)
                assert response.status_code == 200
                observations.append((status, response.json()))
        job.result()
    for status, data in observations:
        assert set(data["counts"]) == {"pending", "approved", "rejected"}
        if status:
            assert data["counts"][status] == len(data["items"])
        else:
            assert sum(data["counts"].values()) == len(data["items"])


def test_published_integrations_only(app_url: str) -> None:
    items = call("GET", app_url, "/api/integrations").json()["items"]
    slugs = [i["slug"] for i in items]
    assert len(items) == PUBLISHED_INTEGRATIONS and len(set(slugs)) == PUBLISHED_INTEGRATIONS
    for slug, name in NAMED_INTEGRATIONS.items():
        assert {"slug": slug, "name": name} in [{"slug": i["slug"], "name": i["name"]} for i in items]
    assert not set(UNPUBLISHED_INTEGRATIONS) & set(slugs)
    order = [(i["name"].encode(), i["slug"].encode()) for i in items]
    assert order == sorted(order)
    assert slugs.index("relayo-mobile") < slugs.index("relayo-desktop")
    for category, count in INTEGRATION_COUNTS.items():
        narrowed = call("GET", app_url, "/api/integrations", params={"category": category}).json()["items"]
        assert len(narrowed) == count and all(i["category"] == category for i in narrowed)
    assert call("GET", app_url, "/api/integrations", params={"category": "Fax"}).json()["items"] == []


def test_wf_public_reads_open_integration(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/integrations") as page:
        dismiss_cookies(page)
        media: list[Any] = []
        page.on("response", lambda r: media.append(r) if urlsplit(r.url).path == "/media/integrations/huddleboard.svg" else None)
        card = page.get_by_role("list", name="Integrations").get_by_role("link", name="Huddleboard", exact=True)
        shows(page, card)
        click(card)
        at_path = lambda: assert_path(page, "/integration/huddleboard")
        eventually(page, at_path)
        body_says(page, "Huddleboard")
        shows(page, page.get_by_role("link", name="Back to integrations"))
        eventually(page, lambda: assert_true(page.evaluate(ICON_SHOWN_JS, ICON_PATH), "icon not shown"))
        assert call("GET", app_url, ICON_PATH).status_code == 200
        for slug in ("ledgerline-crm", "no-such-integration"):
            response = page.goto(f"{app_url}/integration/{slug}")
            assert response is not None and response.status == 404
            shows(page, page.get_by_role("heading", name=PAGE_NOT_FOUND))
            shows(page, page.get_by_role("link", name="Back to home"))
    assert call("GET", app_url, "/integration/huddleboard").status_code == 200


ICON_PATH = "/media/integrations/huddleboard.svg"
ICON_SHOWN_JS = """(path) => !!document.querySelector('main svg, [role=main] svg, article svg') || [...document.querySelectorAll('img, image, use, source, object')]
  .some(e => (e.currentSrc || e.src || e.getAttribute('href') || e.getAttribute('xlink:href') || e.getAttribute('data') || '').includes(path))
  || [...document.querySelectorAll('*')].some(e => getComputedStyle(e).backgroundImage.includes(path))"""


def assert_path(page: Page, path: str) -> None:
    assert urlsplit(page.url).path == path, page.url


def assert_true(condition: bool, message: str) -> None:
    assert condition, message


def test_wf_public_reads_open_article(browser: Browser, app_url: str) -> None:
    article = next(i for i in walk(app_url, "/api/blog", limit="50") if i["slug"] == ARTICLE_SLUG)
    assert article["title"] == ARTICLE_TITLE
    with visit(browser, f"{app_url}/blog") as page:
        dismiss_cookies(page)
        card = page.get_by_role("list", name="Articles").get_by_role("link", name=ARTICLE_TITLE, exact=True)
        shows(page, card)
        click(card)
        eventually(page, lambda: assert_path(page, f"/blog/{ARTICLE_SLUG}"))
        shows(page, page.get_by_role("heading", name=ARTICLE_TITLE))
        shows(page, page.get_by_text(article["author"]).first)
        published = parse_time(article["published_at"])
        years = {str(published.year), str(published.astimezone(BERLIN).year)}
        eventually(page, lambda: assert_true(any(y in page.evaluate("document.body.innerText") for y in years), "year not shown"))
        shows(page, page.get_by_role("link", name="Back to articles"))
        for slug in ("draft-q4-roadmap", "scheduled-2099-launch", "no-such-article"):
            response = page.goto(f"{app_url}/blog/{slug}")
            assert response is not None and response.status == 404
            shows(page, page.get_by_role("heading", name=PAGE_NOT_FOUND))


def test_blog_category_filter(app_url: str) -> None:
    everything = walk(app_url, "/api/blog", limit="2")
    assert len(everything) == PUBLIC_ARTICLES
    for category, count in ARTICLE_COUNTS.items():
        items = walk(app_url, "/api/blog", category=category, limit="2")
        assert len(items) == count and len({i["slug"] for i in items}) == count
        assert all(i["category"] == category for i in items)
        assert not set(HIDDEN_ARTICLES) & {i["slug"] for i in items}


def test_press_filter(browser: Browser, app_url: str) -> None:
    news = walk(app_url, "/api/press", category="News", limit="3")
    assert len(news) == PUBLIC_NEWS and all(i["category"] == "News" for i in news)
    assert len({i["id"] for i in news}) == PUBLIC_NEWS
    releases = walk(app_url, "/api/press", category="Press Releases", limit="3")
    assert len(releases) == PUBLIC_RELEASES and all(i["category"] == "Press Releases" for i in releases)
    assert len(walk(app_url, "/api/press", category="All")) == PUBLIC_PRESS
    with visit(browser, f"{app_url}/press") as page:
        nav = page.get_by_role("navigation", name="Press categories")
        shows(page, nav)
        eventually(page, lambda: expect(nav.get_by_role("link")).to_have_count(3, timeout=LOOK_MS))
        assert link_names(nav) == ["All", "News", "Press Releases"]


def test_seeded_corpus(browser: Browser, app_url: str, tmp_path: Path) -> None:
    def counts() -> dict[str, Any]:
        return Postgres().rows(
            "SELECT (SELECT count(*) FROM integrations) AS integrations, "
            "(SELECT count(DISTINCT slug) FROM integrations) AS integration_slugs, "
            "(SELECT count(*) FROM integrations WHERE published) AS published_integrations, "
            "(SELECT count(*) FROM articles) AS articles, "
            "(SELECT count(*) FROM articles WHERE published AND published_at <= now()) AS public_articles, "
            "(SELECT count(*) FROM press_items) AS press, "
            "(SELECT count(*) FROM press_items WHERE published AND date <= (now() AT TIME ZONE 'UTC')::date) AS public_press, "
            "(SELECT count(*) FROM jobs) AS jobs, (SELECT count(*) FROM jobs WHERE is_open) AS open_jobs, "
            "(SELECT count(*) FROM resource_cards WHERE published) AS resources"
        )[0]

    expected = {
        "integrations": ALL_INTEGRATIONS, "integration_slugs": ALL_INTEGRATIONS, "published_integrations": PUBLISHED_INTEGRATIONS,
        "articles": ALL_ARTICLES, "public_articles": PUBLIC_ARTICLES, "press": ALL_PRESS, "public_press": PUBLIC_PRESS,
        "jobs": JOBS_ALL, "open_jobs": JOBS_OPEN, "resources": RESOURCES_PUBLISHED,
    }
    assert {k: int(v) for k, v in counts().items()} == expected
    jobs = Postgres().rows("SELECT title, is_open FROM jobs")
    with visit(browser, f"{app_url}/careers") as page:
        for job in jobs:
            title = page.get_by_text(job["title"], exact=True)
            if job["is_open"]:
                shows_any(page, page.get_by_text(job["title"]))
            else:
                expect(title).to_have_count(0)
    with app_copy(tmp_path) as (base, proc, log):
        def healthy() -> None:
            assert copy_health(base, proc, log).status_code == 200
        poll(healthy, BOOT_DEADLINE_S)
        assert {k: int(v) for k, v in counts().items()} == expected


def test_stable_capped_paging(app_url: str) -> None:
    for path, sort_key in (("/api/blog", "published_at"), ("/api/press", "date")):
        whole = call("GET", app_url, path, params={"limit": "100"}).json()
        assert len(whole["items"]) <= LIST_LIMIT_CAP and whole["next_cursor"] is None
        single = walk(app_url, path, limit="1")
        assert [json.dumps(i, sort_keys=True) for i in single] == [json.dumps(i, sort_keys=True) for i in whole["items"]]
        stamps = [parse_time(i[sort_key]) if "T" in i[sort_key] else i[sort_key] for i in single]
        assert stamps == sorted(stamps, reverse=True)
        for bad in ("0", "-1", "abc", "1.5"):
            response = call("GET", app_url, path, params={"limit": bad})
            assert response.status_code == 400 and response.json() == {"error": "invalid_limit"}
        for bad_cursor in ("garbage", "eyJ4IjoxfQ"):
            response = call("GET", app_url, path, params={"cursor": bad_cursor})
            assert response.status_code == 400 and response.json() == {"error": "invalid_cursor"}
    sales_cursor = call("GET", app_url, "/api/blog", params={"category": "Sales", "limit": "1"}).json()["next_cursor"]
    for params in ({"cursor": sales_cursor}, {"cursor": sales_cursor, "category": "Product Updates"}):
        assert error_of(call("GET", app_url, "/api/blog", params=params)) == "invalid_cursor"
    assert error_of(call("GET", app_url, "/api/press", params={"cursor": sales_cursor, "category": "Sales"})) in ("invalid_cursor", "invalid_category")
    press_cursor = call("GET", app_url, "/api/press", params={"limit": "1"}).json()["next_cursor"]
    assert error_of(call("GET", app_url, "/api/blog", params={"cursor": press_cursor})) == "invalid_cursor"


def test_unknown_api_paths_and_methods(app_url: str) -> None:
    for path in ("/api/nope", "/api/partner-applications/1", "/api/review", "/api/integrations/huddleboard", "/api/debug"):
        response = call("GET", app_url, path)
        assert response.status_code == 404 and response.json() == {"error": "not_found"}
    get_head, post = {"GET", "HEAD"}, {"POST"}
    for method, path, allowed in (
        ("PUT", "/api/press", get_head), ("POST", "/api/integrations", get_head), ("DELETE", "/api/blog", get_head),
        ("POST", "/api/health", get_head), ("GET", "/api/partner-applications", post), ("GET", "/api/auth/login", post),
        ("GET", "/api/auth/logout", post), ("PUT", "/api/review/partner-applications/1", get_head),
        ("DELETE", "/api/review/partner-applications", get_head), ("GET", "/api/review/partner-applications/1/decision", post),
        ("OPTIONS", "/api/press", get_head),
    ):
        response = call(method, app_url, path)
        assert response.status_code == 405, (method, path, response.status_code)
        assert response.json() == {"error": "method_not_allowed"}
        assert {m.strip() for m in response.headers["Allow"].split(",")} == allowed
    head = call("HEAD", app_url, "/api/integrations")
    assert head.status_code == 200 and head.content == b""
    assert head.headers.get("content-type") == call("GET", app_url, "/api/integrations").headers.get("content-type")


def test_repeated_query_parameters(app_url: str) -> None:
    token = token_for(app_url)
    for path, params, code in (
        ("/api/blog", [("limit", "1"), ("limit", "1")], "invalid_limit"),
        ("/api/blog", [("cursor", "a"), ("cursor", "a")], "invalid_cursor"),
        ("/api/press", [("category", "News"), ("category", "News")], "invalid_category"),
        ("/api/integrations", [("category", "CRM"), ("category", "CRM")], "invalid_category"),
        ("/api/blog", [("limit", "0"), ("category", "Sales"), ("category", "Sales")], "invalid_category"),
        ("/api/press", [("cursor", "junk"), ("limit", "0")], "invalid_limit"),
    ):
        response = call("GET", app_url, path, params=params)
        assert response.status_code == 400 and response.json() == {"error": code}, (path, params)
    for params, code in (
        ([("status", "pending"), ("status", "pending")], "invalid_status"),
        ([("sort", "submitted"), ("sort", "submitted")], "invalid_sort"),
        ([("sort", "oldest"), ("status", "archived")], "invalid_status"),
    ):
        response = read_queue(app_url, token, params)
        assert response.status_code == 400 and response.json() == {"error": code}
    plain = call("GET", app_url, "/api/press").json()
    assert call("GET", app_url, "/api/press", params={"utm": "1"}).json() == plain


def test_documented_item_keys(app_url: str) -> None:
    for item in call("GET", app_url, "/api/integrations").json()["items"]:
        assert set(item) == INTEGRATION_KEYS
    for item in call("GET", app_url, "/api/blog", params={"limit": "50"}).json()["items"]:
        assert set(item) == ARTICLE_KEYS and item["published_at"].endswith("Z")
    for item in call("GET", app_url, "/api/press", params={"limit": "50"}).json()["items"]:
        assert set(item) == PRESS_KEYS and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", item["date"])
    _, app = created(app_url, "keys")
    token = token_for(app_url)
    assert set(read_application(app_url, app["id"], token).json()) == APPLICATION_KEYS
    queue = read_queue(app_url, token).json()
    assert {"items", "counts"} <= set(queue) and set(queue["counts"]) == {"pending", "approved", "rejected"}
    assert all(set(i) == APPLICATION_KEYS for i in queue["items"])


def test_effective_publication_moment(browser: Browser, app_url: str) -> None:
    for category in (None, "Product Updates"):
        params = {"limit": "3", **({"category": category} if category else {})}
        slugs = {i["slug"] for i in walk(app_url, "/api/blog", **params)}
        assert not set(HIDDEN_ARTICLES) & slugs
        assert len(slugs) == (ARTICLE_COUNTS["Product Updates"] if category else PUBLIC_ARTICLES)
    for category in ("All", "News"):
        headlines = {i["headline"] for i in walk(app_url, "/api/press", category=category, limit="3")}
        assert SCHEDULED_PRESS not in headlines
    with visit(browser, f"{app_url}/blog") as page:
        reads(page, results(page), f"{PUBLIC_ARTICLES} articles")
        page.goto(f"{app_url}/blog?category=Product%20Updates")
        reads(page, results(page), f"{ARTICLE_COUNTS['Product Updates']} articles")


def test_media_follows_publication(app_url: str) -> None:
    integrations = call("GET", app_url, "/api/integrations").json()["items"]
    articles = call("GET", app_url, "/api/blog", params={"limit": "50"}).json()["items"]
    paths = [i["icon_ref"] for i in integrations] + [a["cover_ref"] for a in articles]
    assert all(i["icon_ref"] == f"/media/integrations/{i['slug']}.svg" for i in integrations)
    assert all(a["cover_ref"] == f"/media/articles/{a['slug']}.svg" for a in articles)
    for path in paths + ["/media/integrations/huddleboard.svg?v=1"]:
        status, headers, content = raw(app_url, "GET", path)
        assert status == 200, path
        assert headers["content-type"].startswith("image/svg+xml") and "no-cache" in headers.get("cache-control", "")
        assert ElementTree.fromstring(content).tag.endswith("svg")
        head_status, head_headers, head_body = raw(app_url, "HEAD", path)
        assert head_status == 200 and head_body == b"" and head_headers["content-type"].startswith("image/svg+xml")
    for path in (
        "/media/integrations/ledgerline-crm.svg", "/media/integrations/coldstore-archive.svg",
        "/media/articles/draft-q4-roadmap.svg", "/media/articles/unpublished-pricing-notes.svg",
        "/media/articles/scheduled-2099-launch.svg", "/media/articles/scheduled-2099-launch.svg?preview=1",
        "/media/integrations/Huddleboard.svg", "/media/integrations/nope.svg", "/media/integrations/huddleboard.png",
        "/media/integrations/%2e%2e/articles/meeting-notes-that-write-themselves.svg",
        "/media/articles/../integrations/huddleboard.svg", "/media/integrations/sub%2Fhuddleboard.svg",
        "/media/integrations/",
    ):
        for method in ("GET", "HEAD"):
            assert raw(app_url, method, path)[0] == 404, (method, path)


def test_conditional_public_reads(app_url: str) -> None:
    for path, params in (("/api/integrations", {}), ("/api/blog", {"limit": "5"}), ("/api/press", {"category": "News"})):
        first = call("GET", app_url, path, params=params)
        tag = first.headers["ETag"]
        assert tag.startswith('"') and tag.endswith('"') and not tag.startswith("W/")
        assert "no-cache" in first.headers["Cache-Control"].lower() and "Last-Modified" not in first.headers
        second = call("GET", app_url, path, params=params)
        assert second.headers["ETag"] == tag and second.content == first.content
        for header in (tag, f"W/{tag}", "*", f'"other-tag", {tag}', f'"other-tag" ,  W/{tag}'):
            for method in ("GET", "HEAD"):
                hit = call(method, app_url, path, params=params, headers={"If-None-Match": header})
                assert hit.status_code == 304 and hit.content == b"", header
                assert hit.headers["ETag"] == tag and "no-cache" in hit.headers["Cache-Control"].lower()
        for header in ('"other-tag"', "unquoted-garbage"):
            assert call("GET", app_url, path, params=params, headers={"If-None-Match": header}).status_code == 200
        modified = call("GET", app_url, path, params=params, headers={"If-Modified-Since": "Fri, 01 Jan 2100 00:00:00 GMT"})
        assert modified.status_code == 200
    five = call("GET", app_url, "/api/blog", params={"limit": "5"}).headers["ETag"]
    six = call("GET", app_url, "/api/blog", params={"limit": "6"}).headers["ETag"]
    crm = call("GET", app_url, "/api/integrations", params={"category": "CRM"}).headers["ETag"]
    calendar = call("GET", app_url, "/api/integrations", params={"category": "Calendar"}).headers["ETag"]
    assert five != six and crm != calendar
    error = call("GET", app_url, "/api/blog", params={"limit": "0"}, headers={"If-None-Match": "*"})
    assert error.status_code == 400 and "ETag" not in error.headers


def option_texts(page: Page, combo: Locator) -> list[str]:
    native = combo.get_by_role("option", include_hidden=True)
    if native.count():
        return [" ".join(t.split()) for t in native.all_text_contents()]
    click(combo)
    options = page.get_by_role("option")
    shows(page, options.first)
    texts = [" ".join(t.split()) for t in options.all_text_contents()]
    page.keyboard.press("Escape")
    return texts


def test_thirteen_field_form(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        form = partner_form(page)
        shows(page, form)
        controls: list[Locator] = []
        for name in FIELDS:
            label = FIELD_NAMES[name]
            if name in TEXT_FIELDS:
                control = form.get_by_role("textbox", name=label, exact=True)
            elif name in SELECT_FIELDS:
                control = form.get_by_role("combobox", name=label, exact=True)
            elif name in GROUP_FIELDS:
                control = form.get_by_role("group", name=label, exact=True)
            else:
                control = form.get_by_role("checkbox", name=label, exact=True)
            expect(control).to_have_count(1)
            controls.append(control)
        controls.append(submit_button(page))
        for before, after in zip(controls, controls[1:]):
            assert before.evaluate("(a, b) => !!(a.compareDocumentPosition(b) & 4)", after.element_handle())
        goals = text_field(page, "goals")
        assert goals.evaluate("e => e.tagName === 'TEXTAREA' || e.getAttribute('aria-multiline') === 'true'")
        for name, options in (("company_type", COMPANY_TYPES), ("employee_band", EMPLOYEE_BANDS), ("customer_segment", SEGMENTS)):
            texts = option_texts(page, form.get_by_role("combobox", name=FIELD_NAMES[name], exact=True))
            assert texts[len(texts) - len(options):] == options and len(texts) - len(options) <= 1, (name, texts)
        for name, options in (("markets", MARKETS), ("partnership_interests", INTERESTS)):
            group = form.get_by_role("group", name=FIELD_NAMES[name], exact=True)
            expect(group.get_by_role("checkbox")).to_have_count(len(options))
            for option in options:
                expect(group.get_by_role("checkbox", name=checkbox_label(option), exact=True)).to_have_count(1)


def test_wf_experience_application_received(browser: Browser, app_url: str) -> None:
    token, email = fresh("received")
    body = application(email, token)
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        fill_partner_form(page, body)
        click(submit_button(page))
        region = page.get_by_role("region", name="Application received")
        shows(page, region)
        heading = region.get_by_role("heading", level=2, name="Application received")
        eventually(page, lambda: expect(heading).to_be_focused(timeout=LOOK_MS))
        eventually(page, lambda: expect(region).to_contain_text(THANK_YOU.format(body["company_name"]), timeout=LOOK_MS))
        gone(page, partner_form(page))
    rows = applications_for(email)
    assert len(rows) == 1 and rows[0]["company_name"] == body["company_name"] and rows[0]["status"] == "pending"


def test_errors_explained_in_place(browser: Browser, app_url: str) -> None:
    token, email = fresh("inplace")
    goals = "g" * (TEXT_LIMITS["goals"] + 1) + "\u0007"
    body = application(email, token, work_email="ada-at-example", goals=goals)
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        fill_partner_form(page, body)
        click(submit_button(page))
        shows(page, page.get_by_role("alert").filter(has_text=SUMMARY_HEADING))
        for name, message in (("work_email", MSG_EMAIL), ("goals", MSG_LIMIT.format(TEXT_LIMITS["goals"]))):
            field = text_field(page, name)
            marked(page, field, "aria-invalid", "true")
            eventually(page, lambda f=field, m=message: expect(f).to_have_accessible_description(re.compile(re.escape(m)), timeout=LOOK_MS))
            assert field.evaluate(LIVE_MESSAGE_JS, message), f"{name} message is not in a live region"
            expect(field).to_have_value(body[name])
        expect(text_field(page, "first_name")).not_to_have_attribute("aria-invalid", "true")
        expect(text_field(page, "first_name")).to_have_value(body["first_name"])
        eventually(page, lambda: expect(text_field(page, "work_email")).to_be_focused(timeout=LOOK_MS))
    assert applications_for("ada-at-example") == []


def test_limit_hints_and_goals_counter(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        for name in TEXT_FIELDS:
            field = text_field(page, name)
            shows(page, field)
            expect(field).to_have_accessible_description(re.compile(re.escape(f"Up to {TEXT_LIMITS[name]} characters")))
        counter = page.get_by_role("status", name="Goals character count")
        reads(page, counter, f"0 / {TEXT_LIMITS['goals']}")
        typed = "\u3000 Cafe\u0301 \U0001F680\u200b \u00a0"
        fill(text_field(page, "goals"), typed)
        reads(page, counter, f"{nfc_len(typed.strip())} / {TEXT_LIMITS['goals']}")
        fill(text_field(page, "goals"), "x" * (TEXT_LIMITS["goals"] + 1))
        reads(page, counter, f"{TEXT_LIMITS['goals'] + 1} / {TEXT_LIMITS['goals']}")


def test_over_long_paste_kept(browser: Browser, app_url: str) -> None:
    token, email = fresh("paste")
    over = "C" * (TEXT_LIMITS["company_name"] + 1)
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        fill_partner_form(page, application(email, token, company_name=None))
        field = text_field(page, "company_name")
        field.focus()
        page.keyboard.insert_text(over)
        expect(field).to_have_value(over)
        click(submit_button(page))
        message = MSG_LIMIT.format(TEXT_LIMITS["company_name"])
        eventually(page, lambda: expect(field).to_have_accessible_description(re.compile(re.escape(message)), timeout=LOOK_MS))
        expect(field).to_have_value(over)
    assert applications_for(email) == []


STORAGE_JS = "() => ({local: JSON.stringify({...localStorage}), session: JSON.stringify({...sessionStorage}), cookie: document.cookie})"


def test_tab_scoped_draft(browser: Browser, app_url: str) -> None:
    token, email = fresh("draft")
    body = application(email, token, first_name="  Ade\u0301le\u00a0")
    keys: list[str | None] = []
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)

        def drop(route: Any) -> None:
            keys.append(route.request.headers.get("idempotency-key"))
            route.abort()

        page.route("**/api/partner-applications", drop)
        fill_partner_form(page, body)
        click(submit_button(page))
        shows(page, page.get_by_role("alert").filter(has_text=OUTAGE_ALERT))
        page.reload()
        eventually(page, lambda: expect(text_field(page, "first_name")).to_have_value(body["first_name"], timeout=LOOK_MS))
        expect(text_field(page, "company_name")).to_have_value(body["company_name"])
        stored = page.evaluate(STORAGE_JS)
        assert keys and keys[0] and stored["session"]
        for place in (stored["local"], stored["cookie"], page.url, json.dumps(page.context.cookies())):
            assert body["company_name"] not in place and keys[0] not in place
        other = page.context.new_page()
        other.goto(f"{app_url}/partner-program")
        eventually(other, lambda: expect(text_field(other, "company_name")).to_have_value("", timeout=LOOK_MS))
        other.close()
        click(submit_button(page))
        eventually(page, lambda: assert_true(len(keys) == 2, f"{keys}"))
        assert keys[1] == keys[0]
        page.unroute("**/api/partner-applications")
        sent: list[str | None] = []
        page.on("request", lambda r: sent.append(r.headers.get("idempotency-key"))
                if urlsplit(r.url).path == "/api/partner-applications" and r.method == "POST" else None)
        new_title = f"Alliances {token}"
        fill(text_field(page, "job_title"), new_title)
        click(submit_button(page))
        shows(page, page.get_by_role("region", name="Application received"))
        assert sent and sent[-1] and sent[-1] != keys[0]
        after = page.evaluate(STORAGE_JS)
        assert body["company_name"] not in after["session"] and sent[-1] not in after["session"]
        page.reload()
        eventually(page, lambda: expect(text_field(page, "company_name")).to_have_value("", timeout=LOOK_MS))
    rows = applications_for(email)
    assert len(rows) == 1 and rows[0]["job_title"] == new_title


def test_wf_experience_cookies(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/") as page:
        requests: list[str] = []
        page.on("request", lambda r: requests.append(r.url))
        panel = page.get_by_role("dialog", name="Cookie preferences")
        shows(page, panel)
        page.keyboard.press("Escape")
        advance(page, IDLE_MS)
        expect(panel).to_be_visible()
        click(panel.get_by_role("button", name="Cookies Settings"))
        necessary = panel.get_by_role("checkbox", name="Strictly Necessary Cookies")
        shows(page, necessary)
        expect(necessary).to_be_checked()
        expect(necessary).to_be_disabled()
        optional = ["Performance Cookies", "Functional Cookies", "Targeting Cookies"]
        for name in optional:
            expect(panel.get_by_role("checkbox", name=name)).not_to_be_checked()
        click(panel.get_by_role("button", name="Confirm My Choices"))
        eventually(page, lambda: expect(panel).to_be_hidden(timeout=LOOK_MS))
        host = urlsplit(app_url).hostname
        assert any(c["domain"].lstrip(".") == host for c in page.context.cookies())
        page.reload()
        advance(page, IDLE_MS)
        expect(panel).to_be_hidden()
        for path in ("/", "/blog"):
            page.goto(f"{app_url}{path}")
            footer_button = page.get_by_role("contentinfo").get_by_role("button", name="Cookie preferences")
            click(footer_button)
            shows(page, panel)
            if not panel.get_by_role("checkbox", name=optional[0]).is_visible():
                click(panel.get_by_role("button", name="Cookies Settings"))
            for name in optional:
                expect(panel.get_by_role("checkbox", name=name)).not_to_be_checked()
            panel.get_by_role("checkbox", name=optional[0]).focus()
            page.keyboard.press("Escape")
            eventually(page, lambda: expect(panel).to_be_hidden(timeout=LOOK_MS))
            eventually(page, lambda b=footer_button: expect(b).to_be_focused(timeout=LOOK_MS))
        foreign = [u for u in requests if u.startswith("http") and not same_origin(u, app_url)]
        assert foreign == []


def test_before_during_after_story(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/", DESKTOP) as page:
        dismiss_cookies(page)
        region = page.get_by_role("region", name="Before, during and after")
        shows(page, region)
        steps = region.get_by_role("list").filter(has_text=STEP_LABELS[0]).filter(has_text=STEP_LABELS[2]).first
        top, height = region.evaluate("e => { const r = e.getBoundingClientRect(); return [r.top + scrollY, r.height]; }")
        span = height - DESKTOP[1]
        assert span > 0
        positions = [top + span * f for f in (1 / 6, 1 / 2, 5 / 6)]
        for position, index in zip(positions + positions[1::-1], [0, 1, 2, 1, 0]):
            page.evaluate("y => window.scrollTo(0, y)", position)

            def current(i: int = index) -> None:
                flags = [step_current(steps, label) for label in STEP_LABELS]
                assert flags == [n == i for n in range(3)], flags

            eventually(page, current)
    with visit(browser, f"{app_url}/", DESKTOP, reduced_motion="reduce") as page:
        dismiss_cookies(page)
        region = page.get_by_role("region", name="Before, during and after")
        for label in STEP_LABELS:
            shows(page, region.get_by_text(label, exact=True).first)
        region.scroll_into_view_if_needed()
        assert motion(region) == []


def test_error_summary_named_links(browser: Browser, app_url: str) -> None:
    token, email = fresh("summary")
    body = application(email, token, work_email="ada-at-example", website="example.com", markets=[], consent=False)
    failing = [("work_email", MSG_EMAIL), ("website", MSG_WEBSITE), ("markets", MSG_REQUIRED), ("consent", MSG_CONSENT)]
    with visit(browser, f"{app_url}/partner-program") as page:
        dismiss_cookies(page)
        fill_partner_form(page, body)
        click(submit_button(page))
        alert = page.get_by_role("alert").filter(has_text=SUMMARY_HEADING)
        shows(page, alert)
        links = alert.get_by_role("link")
        eventually(page, lambda: expect(links).to_have_count(len(failing), timeout=LOOK_MS))
        eventually(page, lambda: expect(text_field(page, "work_email")).to_be_focused(timeout=LOOK_MS))
        address, depth = page.url, page.evaluate("history.length")
        form = partner_form(page)
        targets = {
            "work_email": text_field(page, "work_email"),
            "website": text_field(page, "website"),
            "markets": form.get_by_role("group", name=FIELD_NAMES["markets"]).get_by_role("checkbox").first,
            "consent": form.get_by_role("checkbox", name=CONSENT_LABEL, exact=True),
        }
        for index, (name, message) in enumerate(failing):
            link = links.nth(index)
            expect(link).to_have_accessible_name(f"{FIELD_NAMES[name]}: {message}")
            if index % 2:
                link.focus()
                page.keyboard.press("Enter")
            else:
                click(link)
            eventually(page, lambda t=targets[name]: expect(t).to_be_focused(timeout=LOOK_MS))
            eventually(page, lambda t=targets[name]: in_view(page, t), FOCUS_SETTLE_S)
            assert page.url == address and page.evaluate("history.length") == depth
    assert applications_for("ada-at-example") == []


def check_reflow(page: Page, roots: list[Locator]) -> None:
    handles = [r.element_handle() for r in roots]
    for spacing in (False, True):
        tag = page.add_style_tag(content=TEXT_SPACING_CSS) if spacing else None
        try:
            layout(page)
            problems = page.evaluate(REFLOW_JS, handles)
            assert problems == [], (spacing, problems[:10])
        finally:
            if tag is not None:
                tag.evaluate("e => e.remove()")


def test_form_reflows_with_full_limit_text(browser: Browser, app_url: str) -> None:
    for size in (NARROW, DESKTOP):
        token, email = fresh("reflow")
        full_email = value_of_length("work_email", TEXT_LIMITS["work_email"], email)
        values = {name: value_of_length(name, TEXT_LIMITS[name], email) for name in TEXT_FIELDS if name != "work_email"}
        body = application(full_email, token, **values, consent=False)
        with visit(browser, f"{app_url}/partner-program", size) as page:
            dismiss_cookies(page)
            fill_partner_form(page, body)
            check_reflow(page, [partner_form(page)])
            click(submit_button(page))
            alert = page.get_by_role("alert").filter(has_text=SUMMARY_HEADING)
            shows(page, alert)
            check_reflow(page, [partner_form(page), alert])
            check(partner_form(page).get_by_role("checkbox", name=CONSENT_LABEL, exact=True))
            click(submit_button(page))
            region = page.get_by_role("region", name="Application received")
            shows(page, region)
            check_reflow(page, [region])
        assert len(applications_for(full_email)) == 1


def countdown(alert: Locator, high: int, low: int | None = None) -> int:
    shown = " ".join(alert.inner_text().split())
    match = re.fullmatch(r"Too many sign-in attempts\. Try again in (\d+) seconds?\.", shown)
    assert match, shown
    value = int(match.group(1))
    assert max(1, high - 1 if low is None else low) <= value <= high, shown
    assert shown == (WAIT_COPY_ONE if value == 1 else WAIT_COPY.format(value)), shown
    return value


def link_names(scope: Locator) -> list[str]:
    found = re.findall(r'- link "((?:[^"\\]|\\.)*)"', scope.aria_snapshot())
    return [" ".join(json.loads(f'"{name}"').split()) for name in found]


def list_names(page: Page, list_name: str) -> list[str]:
    return link_names(page.get_by_role("list", name=list_name))


def shows_names(page: Page, list_name: str, expected: list[str]) -> None:
    eventually(page, lambda: assert_true(list_names(page, list_name) == expected, f"{list_names(page, list_name)}"))


def shows_headlines(page: Page, headlines: list[str]) -> None:
    def check() -> None:
        names = link_names(page.get_by_role("list", name="Press items"))
        found = [next((i for i, n in enumerate(names) if h in n), -1) for h in headlines]
        assert -1 not in found and found == sorted(found) and len(names) >= len(headlines), (headlines, names)
    eventually(page, check)


def api_names(app_url: str, path: str, key: str, **params: str) -> list[str]:
    items = call("GET", app_url, path, params=params).json()["items"]
    return [" ".join(i[key].split()) for i in items]


def test_wf_browse_lists_category(browser: Browser, app_url: str) -> None:
    expected = api_names(app_url, "/api/integrations", "name", category="CRM")
    assert len(expected) == INTEGRATION_COUNTS["CRM"]
    with visit(browser, f"{app_url}/integrations") as page:
        dismiss_cookies(page)
        nav = page.get_by_role("navigation", name="Integration categories")
        crm = nav.get_by_role("link", name="CRM", exact=True)
        shows(page, crm)
        click(crm)
        at(page, "/integrations", category="CRM")
        marked(page, crm)
        eventually(page, lambda: expect(crm).to_be_focused(timeout=LOOK_MS))
        reads(page, results(page), f"{len(expected)} integrations")
        shows_names(page, "Integrations", expected)
        page.reload()
        marked(page, nav.get_by_role("link", name="CRM", exact=True))
        shows_names(page, "Integrations", expected)
        reads(page, results(page), f"{len(expected)} integrations")


@pytest.mark.parametrize("case", LIST_IDS, ids=LIST_IDS)
def test_empty_filter_result(browser: Browser, app_url: str, case: str) -> None:
    path = LISTS[case][0]
    copy, reset, zero = EMPTY_STATES[case]
    with visit(browser, f"{app_url}{path}?category=Fax") as page:
        dismiss_cookies(page)
        body_says(page, copy)
        reads(page, results(page), zero)
        link = page.get_by_role("link", name=reset, exact=True)
        shows(page, link)
        assert urlsplit(link.evaluate("e => e.href")).path == path
        click(link)
        at(page, path)
        eventually(page, lambda: expect(page.get_by_role("list", name=LISTS[case][2]).get_by_role("link").first).to_be_visible(timeout=LOOK_MS))


def test_history_restores_filters(browser: Browser, app_url: str) -> None:
    plans = [
        ("/integrations", "Integration categories", "Integrations", "integrations",
         [("Calendar", INTEGRATION_COUNTS["Calendar"]), ("Mobile", INTEGRATION_COUNTS["Mobile"])]),
        ("/blog", "Blog categories", "Articles", "articles",
         [("Sales", ARTICLE_COUNTS["Sales"]), ("Media", ARTICLE_COUNTS["Media"])]),
        ("/press", "Press categories", "Press items", "press items",
         [("News", min(PUBLIC_NEWS, PRESS_PAGE_SIZE)), ("Press Releases", PUBLIC_RELEASES)]),
    ]
    for path, nav_name, list_name, noun, choices in plans:
        with visit(browser, f"{app_url}{path}") as page:
            dismiss_cookies(page)
            nav = page.get_by_role("navigation", name=nav_name)
            shows(page, nav)
            page.evaluate("() => { window.__verifierMarker = 1; }")
            depth = page.evaluate("history.length")
            for name, count in choices:
                click(nav.get_by_role("link", name=name, exact=True))
                at(page, path, category=name)
                reads(page, results(page), f"{count} {noun}")
            assert page.evaluate("history.length") == depth + len(choices)
            (first, first_count), (second, second_count) = choices
            page.go_back()
            at(page, path, category=first)
            marked(page, nav.get_by_role("link", name=first, exact=True))
            reads(page, results(page), f"{first_count} {noun}")
            eventually(page, lambda: expect(page.get_by_role("list", name=list_name).get_by_role("link")).to_have_count(first_count, timeout=LOOK_MS))
            page.go_forward()
            at(page, path, category=second)
            marked(page, nav.get_by_role("link", name=second, exact=True))
            reads(page, results(page), f"{second_count} {noun}")
            assert page.evaluate("window.__verifierMarker") == 1


def test_wf_browse_lists_press_paging(browser: Browser, app_url: str) -> None:
    news = [" ".join(i["headline"].split()) for i in walk(app_url, "/api/press", category="News", limit="50")]
    with visit(browser, f"{app_url}/press?category=News") as page:
        dismiss_cookies(page)
        previous, more = page.get_by_role("button", name="Previous"), page.get_by_role("button", name="Load more")
        shows_headlines(page, news[:PRESS_PAGE_SIZE])
        marked(page, previous, "aria-disabled", "true")
        depth = page.evaluate("history.length")
        with entered(held(page, lambda url: "/api/press" in url)) as gate:
            click(more)
            marked(page, more, "aria-disabled", "true")
            marked(page, previous, "aria-disabled", "true")
            more.dispatch_event("click")
            gate.release()
        at(page, "/press", category="News", page="2")
        shows_headlines(page, news[PRESS_PAGE_SIZE:2 * PRESS_PAGE_SIZE])
        assert page.evaluate("history.length") == depth + 1
        first_link = page.get_by_role("list", name="Press items").get_by_role("link").first
        eventually(page, lambda: expect(first_link).to_be_focused(timeout=LOOK_MS))
        page.reload()
        shows_headlines(page, news[PRESS_PAGE_SIZE:2 * PRESS_PAGE_SIZE])
        page.go_back()
        at(page, "/press", category="News")
        shows_headlines(page, news[:PRESS_PAGE_SIZE])
        marked(page, previous, "aria-disabled", "true")
        for bad in ("abc", "0", "1"):
            page.goto(f"{app_url}/press?category=News&page={bad}")
            at(page, "/press", category="News")
            shows_headlines(page, news[:PRESS_PAGE_SIZE])
        page.goto(f"{app_url}/press?category=News&page=99")
        body_says(page, BEYOND_LAST)
        shows(page, page.get_by_role("link", name="Show all press", exact=True))
        expect(page.get_by_role("button", name="Load more")).to_have_count(0)
        expect(page.get_by_role("button", name="Previous")).to_have_count(0)


def test_latest_choice_wins(browser: Browser, app_url: str) -> None:
    calendar = api_names(app_url, "/api/integrations", "name", category="Calendar")
    with visit(browser, f"{app_url}/integrations") as page:
        dismiss_cookies(page)
        nav = page.get_by_role("navigation", name="Integration categories")
        crm, cal = nav.get_by_role("link", name="CRM", exact=True), nav.get_by_role("link", name="Calendar", exact=True)
        shows(page, crm)
        with entered(held(page, "**/api/integrations?category=CRM*")) as gate:
            click(crm)
            click(cal)
            at(page, "/integrations", category="Calendar")
            marked(page, cal)
            reads(page, results(page), f"{len(calendar)} integrations")
            gate.release()
        advance(page, IDLE_MS)
        shows_names(page, "Integrations", calendar)
        reads(page, results(page), f"{len(calendar)} integrations")
        at(page, "/integrations", category="Calendar")
        marked(page, cal)
        expect(crm).not_to_have_attribute("aria-current", "true")
        page.route(lambda url: "/api/integrations" in url and "category=Storage" in url,
                   lambda r: r.fulfill(status=503, body="{}", content_type="application/json"))
        storage = nav.get_by_role("link", name="Storage", exact=True)
        click(storage)
        shows(page, page.get_by_role("alert").filter(has_text=LIST_OUTAGE))
        at(page, "/integrations", category="Storage")
        marked(page, storage)
        page.unroute("**/api/integrations?category=Storage*")
        click(nav.get_by_role("link", name="Analytics", exact=True))
        reads(page, results(page), f"{INTEGRATION_COUNTS['Analytics']} integrations")


def test_safe_return_to_list(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/integrations?category=Calendar") as page:
        dismiss_cookies(page)
        card = page.get_by_role("list", name="Integrations").get_by_role("link", name="Datebook Calendar", exact=True)
        shows(page, card)
        assert parse_qs(urlsplit(card.evaluate("e => e.href")).query)["from"] == ["/integrations?category=Calendar"]
        click(card)
        eventually(page, lambda: assert_path(page, "/integration/datebook-calendar"))
        click(page.get_by_role("link", name="Back to integrations"))
        at(page, "/integrations", category="Calendar")
        marked(page, page.get_by_role("navigation", name="Integration categories").get_by_role("link", name="Calendar", exact=True))
        reads(page, results(page), f"{INTEGRATION_COUNTS['Calendar']} integrations")
        eventually(page, lambda: expect(card).to_be_focused(timeout=LOOK_MS))
        eventually(page, lambda: in_view(page, card), FOCUS_SETTLE_S)
        click(card)
        eventually(page, lambda: assert_path(page, "/integration/datebook-calendar"))
        page.go_back()
        at(page, "/integrations", category="Calendar")
        reads(page, results(page), f"{INTEGRATION_COUNTS['Calendar']} integrations")
        crafted = [
            "https://evil.example/integrations", "/" * 2 + "evil.example/integrations", "/integrations\\x",
            "javascript:alert(1)", "/blog?category=Sales", "/integrations?category=\u0001",
        ]
        for detail, link_name, plain, foreign in (
            ("/integration/datebook-calendar", "Back to integrations", "/integrations", crafted),
            (f"/blog/{ARTICLE_SLUG}", "Back to articles", "/blog", ["/integrations", "/" * 2 + "evil.example/blog"]),
        ):
            for value in foreign + [None]:
                suffix = "" if value is None else "?from=" + quote(value, safe="")
                page.goto(f"{app_url}{detail}{suffix}")
                back = page.get_by_role("link", name=link_name)
                shows(page, back)
                target = urlsplit(back.evaluate("e => e.href"))
                assert (target.scheme, target.path, target.query) == (urlsplit(app_url).scheme, plain, ""), (value, target)
        page.goto(f"{app_url}/blog/{ARTICLE_SLUG}?from=" + quote("/blog?category=Product Updates", safe=""))
        target = urlsplit(page.get_by_role("link", name="Back to articles").evaluate("e => e.href"))
        assert target.path == "/blog" and parse_qs(target.query) == {"category": ["Product Updates"]}


PSEUDO_RING_JS = """(e) => { let best = 0; const sig = [];
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const clear = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
  for (const p of ['::before', '::after']) { const s = getComputedStyle(e, p);
    sig.push(p, s.content, s.opacity, s.visibility, s.display);
    if (s.content === 'none') continue;
    for (const side of sides) sig.push(s['border' + side + 'Style'], s['border' + side + 'Width'], s['border' + side + 'Color']);
    sig.push(s.outlineStyle, s.outlineWidth, s.outlineColor);
    const shown = (parseFloat(s.opacity) || 0) > 0 && s.visibility === 'visible' && s.display !== 'none';
    if (!shown) continue;
    const ring = sides.every(x => !['none', 'hidden'].includes(s['border' + x + 'Style']) && !clear(s['border' + x + 'Color']));
    if (ring) best = Math.max(best, Math.min(...sides.map(x => parseFloat(s['border' + x + 'Width']) || 0)));
    if (s.outlineStyle !== 'none' && !clear(s.outlineColor)) best = Math.max(best, parseFloat(s.outlineWidth) || 0); }
  return {best, sig: sig.join('|')}; }"""


LINE_JS = """(e) => { const forcedBars = matchMedia('(forced-colors: active)').matches;
  let best = 0; const sig = [];
  for (const p of [null, '::before', '::after']) {
    const s = getComputedStyle(e, p);
    if (p && s.content === 'none') continue;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const st = s['border' + side + 'Style'];
      sig.push(st, s['border' + side + 'Width']);
      if (st !== 'none' && st !== 'hidden') best = Math.max(best, parseFloat(s['border' + side + 'Width']) || 0);
    }
    sig.push(s.outlineStyle, s.outlineWidth, s.textDecorationLine, s.textDecorationThickness);
    if (p && forcedBars === false) {
      const bg = s.backgroundColor; const h = parseFloat(s.height) || 0, w = parseFloat(s.width) || 0;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && h > 0 && w > 0) { best = Math.max(best, Math.min(h, w)); sig.push('bar', h, w, bg); }
    }
    if (s.outlineStyle !== 'none') best = Math.max(best, parseFloat(s.outlineWidth) || 0);
    if (s.textDecorationLine.includes('underline')) best = Math.max(best, parseFloat(s.textDecorationThickness) || 0);
  }
  return {best, sig: sig.join('|')};
}"""


@pytest.mark.parametrize("case", LIST_IDS, ids=LIST_IDS)
def test_marker_and_focus_beyond_colour(browser: Browser, app_url: str, case: str) -> None:
    path, nav_name, _, current_name, other_name = LISTS[case]
    for forced in (False, True):
        with visit(browser, f"{app_url}{path}") as page:
            if forced:
                page.emulate_media(forced_colors="active")
            dismiss_cookies(page)
            nav = page.get_by_role("navigation", name=nav_name)
            current = nav.get_by_role("link", name=current_name, exact=True)
            other = nav.get_by_role("link", name=other_name, exact=True)
            marked(page, current)
            ours, theirs = current.evaluate(LINE_JS), other.evaluate(LINE_JS)
            assert ours["best"] >= RING_MIN_PX, (forced, ours)
            if forced:
                assert ours["sig"] != theirs["sig"], (forced, ours, theirs)
            other.evaluate("e => { window.__ringProbe = e; }")
            rest_ring = steady(page, "() => (" + PSEUDO_RING_JS + ")(window.__ringProbe)")
            _, focused = state_styles(other, "outline-style", "outline-width", "outline-offset", "box-shadow", state="focus")
            current.focus()
            for _ in range(len(link_names(nav))):
                if other.evaluate("e => e === document.activeElement"):
                    break
                page.keyboard.press("Tab")
            assert other.evaluate("e => e === document.activeElement"), "Tab never reached the category link"
            other.evaluate("e => { window.__ringProbe = e; }")
            focus_ring = steady(page, "() => (" + PSEUDO_RING_JS + ")(window.__ringProbe)")
            if focus_ring["best"] >= RING_MIN_PX and focus_ring["sig"] != rest_ring["sig"]:
                pass
            elif forced or focused["outline-style"] != "none":
                assert focused["outline-style"] != "none", (forced, focused)
                assert px(focused["outline-width"]) >= RING_MIN_PX
                assert 0 <= px(focused["outline-offset"]) <= RING_MAX_GAP_PX
            else:
                assert focused["box-shadow"] != "none", focused


@pytest.mark.parametrize("case", DESKTOP_AXE_IDS, ids=DESKTOP_AXE_IDS)
def test_wcag_desktop(browser: Browser, app_url: str, case: str) -> None:
    with visit(browser, f"{app_url}{PAGE_PATHS[case]}", WIDE) as page:
        shows(page, page.get_by_role("banner"))
        axe(page)


@pytest.mark.parametrize("case", PHONE_AXE_IDS, ids=PHONE_AXE_IDS)
def test_wcag_phone(browser: Browser, app_url: str, case: str) -> None:
    with visit(browser, f"{app_url}{PAGE_PATHS[case]}", PHONE_TALL) as page:
        shows(page, page.get_by_role("banner"))
        axe(page)


@pytest.mark.parametrize("case", LAYOUT_IDS, ids=LAYOUT_IDS)
def test_no_sideways_scrolling(browser: Browser, app_url: str, case: str) -> None:
    for width in WIDTHS:
        with visit(browser, f"{app_url}{PAGE_PATHS[case]}", (width, DESKTOP[1])) as page:
            shows(page, page.get_by_role("banner"))
            eventually(page, lambda p=page: assert_true(
                p.evaluate("document.documentElement.scrollWidth <= innerWidth"), "page scrolls sideways"))


@pytest.mark.parametrize("case", SHELL_IDS, ids=SHELL_IDS)
def test_visible_focus(browser: Browser, app_url: str, case: str) -> None:
    with visit(browser, f"{app_url}{PAGE_PATHS[case]}") as page:
        shows(page, page.get_by_role("banner"))
        page.keyboard.press("Tab")
        assert page.evaluate("() => { const e = document.activeElement; window.__probe = e; return !!e && e !== document.body; }")
        focused = steady(page, FOCUS_STYLE_JS)
        page.evaluate("() => window.__probe.blur()")
        assert focused != steady(page, FOCUS_STYLE_JS), focused


@pytest.mark.parametrize("case", SHELL_IDS, ids=SHELL_IDS)
def test_no_console_errors(browser: Browser, app_url: str, case: str) -> None:
    with visit(browser, f"{app_url}/api/health") as page:
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{app_url}{PAGE_PATHS[case]}")
        shows(page, page.get_by_role("banner"))
        advance(page, IDLE_MS)
        assert errors == []


INFINITE_JS = """() => document.getAnimations().filter(a => a.playState === 'running' && a.effect
  && a.effect.getComputedTiming().iterations === Infinity).length"""


@pytest.mark.parametrize("case", SHELL_IDS, ids=SHELL_IDS)
def test_reduced_motion(browser: Browser, app_url: str, case: str) -> None:
    counts: dict[str, dict[str, int]] = {}
    for mode in ("no-preference", "reduce"):
        with visit(browser, f"{app_url}{PAGE_PATHS[case]}", reduced_motion=mode) as page:
            shows(page, page.get_by_role("banner"))
            advance(page, IDLE_MS)
            counts[mode] = {
                "heading": page.get_by_role("heading").count(),
                "link": len({" ".join(t.split()) for t in page.get_by_role("link").all_inner_texts()}),
                "button": page.get_by_role("button").count()
                - page.get_by_role("button", name=re.compile("^(Pause|Play) tool strip$")).count(),
            }
            if mode == "reduce":
                assert page.evaluate(INFINITE_JS) == 0
    for role in ("heading", "link", "button"):
        assert counts["reduce"][role] >= counts["no-preference"][role], counts


def test_card_hover(browser: Browser, app_url: str) -> None:
    for mode in ("no-preference", "reduce"):
        with visit(browser, f"{app_url}/integrations", reduced_motion=mode) as page:
            dismiss_cookies(page)
            cards = page.get_by_role("list", name="Integrations")
            card = cards.get_by_role("link").first
            shows(page, card)
            card.evaluate("e => e.scrollIntoView({block: 'center', behavior: 'instant'})")
            page.mouse.move(0, 0)
            rest = steady_card(card)
            card.hover()
            running = card.evaluate(RUNNING_MS_JS)
            hovered = steady_card(card)
            then = {n["id"]: n for n in hovered}
            pairs = [(a, then[a["id"]]) for a in rest if a["id"] in then]
            assert any(a["shadow"] != b["shadow"] for a, b in pairs), hovered
            rise = max(a["top"] - b["top"] for a, b in pairs)
            if mode == "reduce":
                assert abs(rise) < 0.5, rise
            else:
                assert rise >= 0.5, rise
                moved = [b for a, b in pairs if a["top"] - b["top"] >= 0.5]
                timings = [running] + [d * 1000 for b in moved for d in seconds_list(b["duration"])]
                assert any(CARD_MIN_MS <= t <= CARD_MAX_MS for t in timings), timings


def test_wf_accessibility_keyboard_focus(browser: Browser, app_url: str) -> None:
    for size in (DESKTOP, PHONE_TALL):
        for path in ("/", "/integrations", "/partner-program"):
            with visit(browser, f"{app_url}{path}", size) as page:
                shows(page, page.get_by_role("dialog", name="Cookie preferences"))
                hidden: list[str] = []
                for _ in range(TAB_SWEEP):
                    page.keyboard.press("Tab")

                    def visible() -> None:
                        probe = page.evaluate(FOCUS_PROBE_JS)
                        assert probe["ok"], probe["name"]

                    try:
                        eventually(page, visible, FOCUS_SETTLE_S)
                    except AssertionError as exc:
                        hidden.append(str(exc))
                assert hidden == [], (size, path, hidden)
        with visit(browser, f"{app_url}/", size) as page:
            dismiss_cookies(page)
            main = page.get_by_role("navigation", name="Main")
            if size == DESKTOP:
                opener = main.get_by_role("button", name="Agents")
            else:
                opener = page.get_by_role("button", name="Menu")
            opener.focus()
            marked(page, opener, "aria-expanded", "false")
            page.keyboard.press("Enter")
            marked(page, opener, "aria-expanded", "true")
            if size == DESKTOP:
                eventually(page, lambda o=opener: expect(o).to_be_focused(timeout=LOOK_MS))
                page.keyboard.press("Tab")
                eventually(page, lambda: expect(main.get_by_role("link", name="Sales Agent")).to_be_focused(timeout=LOOK_MS))
            page.keyboard.press("Escape")
            marked(page, opener, "aria-expanded", "false")
            eventually(page, lambda o=opener: expect(o).to_be_focused(timeout=LOOK_MS))


def use_case(n: int) -> str:
    return f"Use case {n} of 5: {AGENTS[n - 1]}"


def test_wf_accessibility_carousel_swipe(browser: Browser, app_url: str) -> None:
    with visit(browser, f"{app_url}/", PHONE_TALL, touch=True) as page:
        dismiss_cookies(page)
        carousel = page.get_by_role("region", name="Use cases")
        status = page.get_by_role("status", name="Current use case")
        reads(page, status, use_case(1))
        previous = carousel.get_by_role("button", name="Previous use case")
        marked(page, previous, "aria-disabled", "true")
        swipe(page, center(carousel), SWIPE_PX, 0)
        advance(page, IDLE_MS)
        reads(page, status, use_case(1))
        carousel.scroll_into_view_if_needed()
        swipe(page, center(carousel), -SWIPE_PX, 0)
        reads(page, status, use_case(2))
        swipe(page, center(carousel), -SHORT_SWIPE_PX, 0)
        advance(page, IDLE_MS)
        reads(page, status, use_case(2))
        before = page.evaluate("scrollY")
        swipe(page, center(carousel), -SHORT_SWIPE_PX, -VERTICAL_SWIPE_PX)
        eventually(page, lambda: assert_true(page.evaluate("scrollY") != before, "vertical swipe did not scroll"))
        reads(page, status, use_case(2))
        box = carousel.bounding_box()
        assert box is not None
        page.mouse.move(box["x"] + box["width"] * 0.8, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 0.1, box["y"] + box["height"] / 2)
        page.mouse.up()
        advance(page, IDLE_MS)
        reads(page, status, use_case(2))
        names = []
        for key in ("Tab", "Shift+Tab"):
            previous.focus()
            for _ in range(len(AGENTS) + 3):
                page.keyboard.press(key)
                if not carousel.evaluate("e => e.contains(document.activeElement)"):
                    break
                names.append(focused_name(page))
        explored = sorted({n for n in names if n.startswith("Explore the ")})
        assert explored == ["Explore the Education Agent"], names
        carousel.scroll_into_view_if_needed()
        swipe(page, center(carousel), SWIPE_PX, 0)
        reads(page, status, use_case(1))
    with visit(browser, f"{app_url}/", PHONE_TALL, reduced_motion="reduce", touch=True) as page:
        dismiss_cookies(page)
        carousel = page.get_by_role("region", name="Use cases")
        carousel.get_by_role("button", name="Next use case").focus()
        page.keyboard.press("Enter")
        reads(page, page.get_by_role("status", name="Current use case"), use_case(2))
        assert motion(carousel) == []


def canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def venv_roots() -> list[Path]:
    bases = {APP_ROOT, Path(DEPLOYED_APP)}
    return [base / ".venv" for base in bases]


def shipped_distributions() -> dict[str, tuple[Any, Path]]:
    installed: dict[str, tuple[Any, Path]] = {}
    for venv in venv_roots():
        for metadata in venv.glob("lib/python3*/site-packages/*.dist-info/METADATA"):
            parsed = MetadataParser().parsestr(metadata.read_text(errors="replace"))
            name = parsed.get("Name")
            if name and canonical(name) not in VENV_TOOLING:
                installed[canonical(name)] = (parsed, metadata.parent)
    found: dict[str, tuple[Any, Path]] = {}
    todo = [n for n in required_names() if n in installed]
    while todo:
        name = todo.pop()
        if name in found:
            continue
        found[name] = installed[name]
        for requirement in installed[name][0].get_all("Requires-Dist") or []:
            if "extra ==" in requirement:
                continue
            dependency = canonical(re.split(r"[\s<>=!~\[;@(]", requirement.strip())[0])
            if dependency in installed:
                todo.append(dependency)
    return found


def required_names() -> list[str]:
    names = []
    listed = re.findall(r"(?:--requirement[=\s]+|-r\s*)(\S+)", run_manifest()["install"])
    files = [APP_ROOT / f for f in listed] or [f for f in APP_ROOT.glob("requirements*.txt") if "dev" not in f.name]
    if not any(f.is_file() for f in files) and (APP_ROOT / "pyproject.toml").is_file():
        import tomllib
        project = tomllib.loads((APP_ROOT / "pyproject.toml").read_text()).get("project", {})
        return [canonical(re.split(r"[\s<>=!~\[;@]", d)[0]) for d in project.get("dependencies", [])]
    for requirements in files:
        if not requirements.is_file():
            continue
        for line in requirements.read_text().splitlines():
            line = line.split("#")[0].strip()
            if line and not line.startswith("-"):
                names.append(canonical(re.split(r"[\s<>=!~\[;@]", line)[0]))
    return names


def notices() -> str:
    return (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()


def run_manifest() -> dict[str, Any]:
    return json.loads((APP_ROOT / "run.json").read_text())


def test_if_user_readme() -> None:
    readme = (APP_ROOT / "USER_README.md").read_text()
    for literal in (REVIEWER, ANALYST, REVIEWER_ROLE, SEED_PASSWORD):
        assert literal in readme, literal


def test_if_run_manifest() -> None:
    manifest = run_manifest()
    assert isinstance(manifest, dict) and manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str), key


def test_if_third_party_notices() -> None:
    text_ = canonical(notices())
    shipped = shipped_distributions()
    for name in set(required_names()) | set(shipped):
        assert name in text_, f"{name} missing from THIRD_PARTY_NOTICES.md"
    for name, (metadata, dist_info) in shipped.items():
        if APP_ROOT in dist_info.parents:
            assert str(metadata.get("Version")) in notices(), f"{name} version missing"


def licence_text(metadata: Any, dist_info: Path) -> str:
    parts = [metadata.get("License-Expression") or "", metadata.get("License") or ""]
    parts += [c for c in metadata.get_all("Classifier") or [] if c.startswith("License ::")]
    if not any(re.search(pattern, " ".join(parts)) for pattern in LICENCE_PATTERNS):
        for licence_file in [f for f in dist_info.rglob("*") if f.is_file() and re.match(r"(LICEN[CS]E|COPYING|NOTICE)", f.name, re.I)]:
            parts.append(licence_file.read_text(errors="replace"))
    return " ".join(parts)


def allowed_licence(value: str) -> bool:
    return any(re.search(pattern, value) for pattern in LICENCE_PATTERNS)


def test_if_licences() -> None:
    shipped = shipped_distributions()
    for name, (metadata, dist_info) in shipped.items():
        assert allowed_licence(licence_text(metadata, dist_info)), name
    if not shipped:
        lines = notices().splitlines()
        for name in required_names():
            hits = [i for i, line in enumerate(lines) if name in canonical(line)]
            assert hits and allowed_licence(notices()), name


def test_if_only_three_services() -> None:
    for file in APP_ROOT.rglob("*"):
        if ".venv" in file.parts or not file.is_file():
            continue
        with file.open("rb") as handle:
            assert handle.read(len(SQLITE_MAGIC)) != SQLITE_MAGIC, f"embedded database file {file}"
    tables = set(Postgres().tables())
    for table in ("partner_applications", "outbound_emails", "sign_in_failures"):
        assert table in tables, table


def test_if_service_config_untouched() -> None:
    with keycloak_admin() as admin:
        assert admin.get(f"/roles/{REVIEWER_ROLE}").status_code == 200
        for email, holds in ((REVIEWER, True), (ANALYST, False)):
            user_id = keycloak_user_id(admin, email)
            roles = admin.get(f"/users/{user_id}/role-mappings/realm").json()
            assert (REVIEWER_ROLE in [r["name"] for r in roles]) is holds, email
    observed = Keycloak()
    for email in (REVIEWER, ANALYST):
        assert any(u.get("email") == email and u.get("enabled") for u in observed.users(email)), email


def test_if_empty_directories() -> None:
    for name in (".browser_screenshots", ".downloads"):
        folder = APP_ROOT / name
        assert folder.is_dir(), name
        assert list(folder.iterdir()) == [], name


def test_if_venv_dependencies() -> None:
    manifest = run_manifest()
    assert ".venv" in manifest["install"]
    for key in ("install", "build", "serve"):
        in_venv = re.search(r"(\.|source)\s+\S*\.venv/bin/activate|PATH=\S*\.venv/bin", manifest[key])
        for command in re.split(r"&&|;|\|\|", manifest[key]):
            if re.search(r"\bpip3?\b", command):
                assert ".venv/" in command or in_venv, f"{key} calls pip outside .venv: {command}"
    assert ".venv" in manifest["serve"]
    assert any(venv.is_dir() for venv in venv_roots())
