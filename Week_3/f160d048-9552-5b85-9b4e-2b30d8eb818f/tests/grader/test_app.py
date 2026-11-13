from __future__ import annotations

import calendar
import csv
import io
import json
import math
import os
import random
import re
import string
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from email.utils import parseaddr
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    addresses,
    advance,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    post_json,
    same_origin,
    select,
    session,
    shipped_packages,
    tap,
    text,
    unique,
)

HTTP_TIMEOUT = 60
LIVE_SECONDS = 15
MAIL_SECONDS = 90
STEP_MS = 50
MARGIN_SECONDS = 10
TIMING_RUNS = 5
TAB_LIMIT = 120
CONCURRENT = 6
SWIPE_STEPS = 6
EDGE_PX = 2
TAB_SWIPE = 120
SHEET_SWIPE = 160
OLD_DAYS = 3650
CLOCK_PROBE = 60
PASSWORD = "bench-probe-pass-1"
GRADING_TOKEN = os.environ.get("GRADING_TOKEN", "")

JSON_LIMIT = 65536
MIN_PAY_REPORTS = int(os.environ.get("MIN_PAY_REPORTS", "5"))
CLAIM_LAPSE_SECONDS = int(os.environ.get("CLAIM_LAPSE_SECONDS", "600"))
EDIT_WINDOW_MINUTES = int(os.environ.get("EDIT_WINDOW_MINUTES", "15"))
EMAIL_CODE_TTL_SECONDS = int(os.environ.get("EMAIL_CODE_TTL_SECONDS", "600"))
ALERT_BATCH_SECONDS = int(os.environ.get("ALERT_BATCH_SECONDS", "300"))
RESUME_MAX_BYTES = int(os.environ.get("RESUME_MAX_BYTES", "5242880"))
UPLOAD_RATE_PER_MINUTE = int(os.environ.get("UPLOAD_RATE_PER_MINUTE", "5"))
OUTBOX_RETRY_SECONDS = int(os.environ.get("OUTBOX_RETRY_SECONDS", "30"))
TOAST_SECONDS = int(os.environ.get("TOAST_SECONDS", "5"))
YEAR_DAYS = 365
SAME_TIME_MS = 100
DEBOUNCE_MS = 300
STAR_FILL_MS = 160
SAVE_TOGGLE_MS = 200
FILTER_SHEET_MS = 280
TOAST_MS = 200
CARD_DROP_MS = 240
BAND_CROSSFADE_MS = 420
BAND_UNHATCH_MS = 320
BAND_COUNT_MS = 600
SPLIT_PX = 2
TABLET_READING = (0.55, 0.62)
PHONE_TILE = (0.25, 0.40)
EXCERPT_CHARS = 140
CODE_REQUESTS = 3
MAX_OPTIONS = 8
VIEWPORTS = {
    "phone": {"width": 375, "height": 812},
    "tablet": {"width": 768, "height": 1024},
    "desktop": {"width": 1280, "height": 800},
}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
ANON = "Anonymous bench member"
CHANNEL_SLUG = "bench-pay-talk"
CHANNEL_NAME = "Bench pay talk"
PRIVATE_NAME = "Asha Private"
APPLICANT_NAME = "Asha Probe"

CITY_NAMES = {"harrowgate": "Harrowgate", "kelvane": "Kelvane", "brindlemoor": "Brindlemoor", "saltmere": "Saltmere"}
ROLE_NAMES = {"research_assistant": "Research Assistant", "qc_analyst": "QC Analyst", "lab_manager": "Lab Manager", "core_facility": "Core Facility Specialist"}
REMOTE_NAMES = {"on_site": "On site", "hybrid": "Hybrid", "remote": "Remote"}
BAND_FLOORS = [
    ("10_plus", 1000000),
    ("8_10", 800000),
    ("6_8", 600000),
    ("4_6", 400000),
]

MESSAGES = {
    "unauthenticated": "Sign in to continue.",
    "invalid_credentials": "Email or password is not right.",
    "not_found": "We could not find that.",
    "forbidden": "Your account cannot do that.",
    "not_verified": "Verify your employer team first.",
    "rate_limited": "Too many tries. Wait a minute and try again.",
    "not_claimed": "Claim this post before deciding.",
    "claim_expired": "Your claim on this post expired. Claim it again to decide.",
    "in_review": "A moderator is reviewing this post. Try again shortly.",
    "duplicate_review": "You have already reviewed this employer this year.",
    "duplicate_application": "You have already applied for this job.",
    "idempotency_mismatch": "This application was already sent with different answers.",
    "job_closed": "This job is no longer taking applications.",
    "already_replied": "Your team has already replied to this review.",
    "invalid_transition": "That stage move is not allowed.",
    "edit_window_closed": "This post can no longer be edited.",
    "validation_failed": "Check the highlighted fields.",
    "contains_email": "Remove the email address before posting. Posts stay anonymous.",
    "contains_phone": "Remove the phone number before posting. Posts stay anonymous.",
    "resume_not_pdf": "Upload a PDF file.",
    "resume_too_large": "The resume must be 5 MB or smaller.",
    "code_invalid": "That code is not right. Check the email and try again.",
    "code_expired": "That code has expired. Ask for a new one.",
    "token_invalid": "This link has expired or was already used.",
    "search_unavailable": "Search is unavailable right now. The job is saved as a draft; list it again in a moment.",
    "storage_unavailable": "We could not store your resume right now. Your answers are kept; try again in a moment.",
    "payload_too_large": "That request is too large.",
}
FIELD_COPY = {
    "annual_pay": "Enter yearly pay between ₹1,00,000 and ₹50,00,000.",
    "years_experience": "Enter 0 to 40 years.",
    "role_family": "Choose a role.",
    "city": "Choose a city.",
    "text": "Write 20 to 3,000 characters.",
    "outcome": "Choose what happened.",
    "difficulty": "Choose a rating from 1 to 5.",
    "overall": "Choose a rating from 1 to 5.",
    "title": "Add a title of 5 to 120 characters.",
    "reason": "Choose a reason.",
    "details": "Add 5 to 200 characters.",
    "pay_high": "The top of the range must be at least the bottom.",
    "description": "Write 40 to 5,000 characters.",
    "resume": "Choose a PDF resume.",
}
COMPANY_KEYS = {"slug", "name", "city", "city_name", "size", "verified", "mark_url", "viewer_unlocked", "rating", "reviews", "pay_rows", "interview_notes", "jobs"}
REVIEW_KEYS = {"id", "title", "overall", "work_life", "pay", "management", "pros", "cons", "truncated", "posted_month", "author_label", "reply"}
PAY_ROW_KEYS = {"role_family", "role_name", "city", "city_name", "report_count", "threshold", "band"}
HIT_KEYS = {"slug", "name", "city", "city_name", "size", "verified", "rating", "review_count", "pay_report_count"}
JOB_KEYS = {"id", "title", "company_name", "company_slug", "city", "role_family", "remote", "pay_low", "pay_high", "pay_band", "description", "status", "listed_at"}
JOB_SUMMARY_KEYS = {"id", "title", "company_name", "company_slug", "city", "city_name", "role_family", "remote", "pay_low", "pay_high", "pay_band", "listed_at"}
APPLICANT_KEYS = {"id", "job_id", "candidate_name", "contact_email", "phone", "cover_note", "stage", "applied_on", "updated_on", "resume_file_id"}
CHANNEL_POST_KEYS = {"id", "channel_slug", "body", "posted_month", "author_label", "quote"}
MEMBER_ROW_KEYS = {"id", "display_name", "email", "role", "company_slug"}
THRESHOLD_KEYS = {"company_slug", "role_family", "city", "report_count", "threshold", "shown"}
HEALTH_KEYS = {"database", "search", "storage", "mail", "outbox_pending", "search_sync_pending"}
CSV_HEADER = "application_id,candidate_name,job_title,stage,applied_on,updated_on"
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}

PROS = "Patient seniors explain every assay step and the bench is calm and tidy."
CONS = "Shift handover notes are sometimes thin and the cold room is crowded."
LONG_PROS = ("Patient seniors explain every assay step on the bench " * 6).strip()
NOTE_TEXT = "Two rounds with a practical pipetting test and a calm panel chat."
DESCRIPTION = "Bench role in a calm lab with clear training, careful handover notes and steady hours."
REPLY_BODY = "Thank you for the review, we have added a second bench trainer this season."


def word(n: int = 8) -> str:
    return "".join(random.choice(string.ascii_lowercase) for _ in range(n))


def email_for(prefix: str) -> str:
    return next((v for v in unique(prefix) if "@" in v), f"{prefix}.{word()}@probe.test")


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def month_year(posted_month: str) -> str:
    year, month = posted_month.split("-")
    return f"{calendar.month_name[int(month)]} {year}"


def rupees(amount: int) -> str:
    digits = str(amount)
    if len(digits) <= 3:
        return "₹" + digits
    head, tail = digits[:-3], digits[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return "₹" + ",".join(groups) + "," + tail


def from_rupees(copy: str) -> int:
    return int(copy.replace("₹", "").replace(",", ""))


def band_of(pay_low: int) -> str:
    return next((band for band, floor in BAND_FLOORS if pay_low >= floor), "under_4")


def percentile(values: list[int], q: Fraction) -> int:
    ordered = sorted(values)
    pos = (len(ordered) - 1) * q
    lo = math.floor(pos)
    hi = min(lo + 1, len(ordered) - 1)
    exact = ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)
    return math.floor(exact + Fraction(1, 2))


def band_for(values: list[int]) -> dict[str, int]:
    return {"low": percentile(values, Fraction(1, 4)), "median": percentile(values, Fraction(1, 2)), "high": percentile(values, Fraction(3, 4))}


def mean_one_decimal(values: list[int]) -> float:
    return math.floor(Fraction(sum(values), len(values)) * 10 + Fraction(1, 2)) / 10


def star_name(n: int) -> str:
    return "1 star" if n == 1 else f"{n} stars"


def step_heading(k: int, name: str) -> str:
    return f"Step {k} of 4: {name}"


SESSION_COOKIE = "cb_session"


def assert_session_cookie(header: str) -> None:
    attrs = [part.strip().lower() for part in header.split(";")]
    assert attrs[0].startswith(SESSION_COOKIE + "="), header
    assert "HttpOnly".lower() in attrs, header
    assert "SameSite Lax".lower().replace(" ", "=") in attrs, header
    assert "path=" + "/" in attrs, header


def quoted(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def column_heading(stage: str, count: int) -> str:
    return f"{stage} ({count})"


def pdf_bytes(size: int | None = None) -> bytes:
    head, tail = b"%PDF-1.4\n%probe resume\n", b"\n%%EOF\n"
    if size is None:
        return head + b"1 0 obj << >> endobj" + tail
    return head + b"0" * (size - len(head) - len(tail)) + tail


def png_bytes() -> bytes:
    return PNG_SIGNATURE + b"\x00\x00\x00\rIHDRprobe"


def outage_url(env: str) -> str:
    value = os.environ.get(env)
    if not value:
        pytest.fail(f"{env} is not set; the outage instance must be reachable")
    return value.rstrip("/")


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def __call__(self, method: str, path: str, who: str | None = None, **kw: Any) -> httpx.Response:
        headers = dict(kw.pop("headers", {}))
        if who:
            headers["Cookie"] = f"cb_session={who}"
        return httpx.request(method, self.base + path, headers=headers, timeout=HTTP_TIMEOUT, **kw)

    def get(self, path: str, who: str | None = None, **kw: Any) -> httpx.Response:
        return self("GET", path, who, **kw)

    def post(self, path: str, body: Any = None, who: str | None = None, **kw: Any) -> httpx.Response:
        if body is not None:
            kw["json"] = body
        return self("POST", path, who, **kw)

    def patch(self, path: str, body: Any, who: str | None = None) -> httpx.Response:
        return self("PATCH", path, who, json=body)

    def put(self, path: str, who: str | None = None, **kw: Any) -> httpx.Response:
        return self("PUT", path, who, **kw)

    def delete(self, path: str, who: str | None = None) -> httpx.Response:
        return self("DELETE", path, who)


def assert_error(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, f"{r.request.method} {r.request.url} answered {r.status_code} {r.text[:300]}; expected {status} {code}"
    body = r.json()
    assert body.get("error") == code, body
    assert body.get("message") == (MESSAGES[code] if message is None else message), body
    allowed = {"fields"} if code == "validation_failed" else {"field"} if code in ("contains_email", "contains_phone") else set()
    assert set(body) - {"error", "message"} <= allowed, body
    return body


def assert_fields(r: httpx.Response, *fields: str) -> dict[str, str]:
    body = assert_error(r, 422, "validation_failed")
    for field in fields:
        assert body["fields"].get(field) == FIELD_COPY[field], body
    return body["fields"]


def seed(base: str, **parts: Any) -> tuple[dict[str, str], dict[str, str]]:
    r = post_json(base, "/api/grading/setup", parts, **{"X-Grading-Token": GRADING_TOKEN})
    assert r.status_code == 201, f"grading setup answered {r.status_code} {r.text[:500]}"
    data = r.json()
    return data["ids"], data["sessions"]


def clock(base: str, seconds: int = 0) -> datetime:
    r = post_json(base, "/api/grading/clock", {"advance_seconds": seconds}, **{"X-Grading-Token": GRADING_TOKEN})
    assert r.status_code == 200, f"grading clock answered {r.status_code} {r.text[:300]}"
    return parse_time(r.json()["now"])


def person(key: str, role: str = "member", company: str | None = None, unlocked: bool = False) -> dict[str, Any]:
    user = {"key": key, "role": role, "display_name": f"{key.capitalize()} {word(6).capitalize()}", "email": email_for(key), "password": PASSWORD, "unlocked": unlocked}
    if company:
        user["company"] = company
    return user


def lab(key: str, city: str = "harrowgate", verified: bool = True, size: str = "11-50", mark: bool = False) -> dict[str, Any]:
    w = word()
    company = {"key": key, "name": f"Probe {w.capitalize()} Assay", "slug": f"probe-{w}", "city": city, "size": size, "verified": verified, "email_domain": f"{w}.test"}
    if mark:
        company["mark"] = True
    return company


def review(key: str, company: str, author: str, at: str, state: str = "approved", rating: tuple[int, int, int, int] = (4, 4, 4, 4), **over: Any) -> dict[str, Any]:
    overall, work_life, pay, management = rating
    post = {"key": key, "kind": "review", "company": company, "author": author, "state": state, "created_at": at,
            "overall": overall, "work_life": work_life, "pay": pay, "management": management,
            "title": f"Bench review {word(6)}", "pros": PROS, "cons": CONS}
    post.update(over)
    return post


def pay_report(key: str, company: str, author: str, at: str, amount: int, state: str = "approved", role: str = "qc_analyst", city: str = "harrowgate", **over: Any) -> dict[str, Any]:
    post = {"key": key, "kind": "pay_report", "company": company, "author": author, "state": state, "created_at": at,
            "role_family": role, "city": city, "annual_pay": amount, "years_experience": 2}
    post.update(over)
    return post


def job(key: str, company: str, title: str, at: str, city: str = "harrowgate", role: str = "qc_analyst", remote: str = "on_site", low: int = 450000, high: int = 520000, status: str = "listed") -> dict[str, Any]:
    return {"key": key, "company": company, "title": title, "role_family": role, "city": city, "remote": remote,
            "pay_low": low, "pay_high": high, "description": DESCRIPTION, "status": status, "listed_at": at}


def application(key: str, job_key: str, user: str, at: str, name: str, contact: str, stage: str = "submitted") -> dict[str, Any]:
    return {"key": key, "job": job_key, "user": user, "candidate_name": name, "contact_email": contact, "stage": stage, "applied_at": at}


def review_body(company_id: str, **over: Any) -> dict[str, Any]:
    body = {"kind": "review", "company_id": company_id, "overall": 4, "work_life": 4, "pay": 3, "management": 4,
            "title": f"Calm bench {word(5)}", "pros": PROS, "cons": CONS}
    body.update(over)
    return body


def job_body(title: str, **over: Any) -> dict[str, Any]:
    body = {"title": title, "role_family": "qc_analyst", "city": "harrowgate", "remote": "on_site",
            "pay_low": 450000, "pay_high": 520000, "description": DESCRIPTION}
    body.update(over)
    return body


def apply(api: Api, job_id: str, who: str, resume: bytes | None, filename: str = "resume.pdf", ctype: str = "application/pdf", name: str = "Asha Probe", contact: str | None = None,
          key: str | None = None, phone: str = "", note: str = "") -> httpx.Response:
    parts: dict[str, Any] = {"candidate_name": (None, name), "contact_email": (None, contact or email_for("contact")),
                             "phone": (None, phone), "cover_note": (None, note)}
    if resume is not None:
        parts["resume"] = (filename, resume, ctype)
    return api.post(f"/api/jobs/{job_id}/applications", who=who, files=parts, headers={"Idempotency-Key": key or str(uuid.uuid4())})


def company_json(api: Api, slug: str, who: str | None = None) -> dict[str, Any]:
    r = api.get(f"/api/companies/{slug}", who)
    assert r.status_code == 200, r.text
    return r.json()


def pay_row(company: dict[str, Any], role: str, city: str) -> dict[str, Any] | None:
    return next((row for row in company["pay_rows"] if row["role_family"] == role and row["city"] == city), None)


def queue_item(api: Api, who: str, post_id: str) -> dict[str, Any] | None:
    r = api.get("/api/moderation/queue", who)
    assert r.status_code == 200, r.text
    return next((p for p in r.json()["posts"] if p["id"] == post_id), None)


def decide(api: Api, post_id: str, who: str, decision: str = "approve", **extra: Any) -> None:
    claim = api.post(f"/api/moderation/{post_id}/claim", who=who)
    assert claim.status_code == 200, claim.text
    r = api.post(f"/api/moderation/{post_id}/decision", {"decision": decision, **extra}, who=who)
    assert r.status_code == 200, r.text


def my_posts(api: Api, who: str) -> list[dict[str, Any]]:
    r = api.get("/api/me/posts", who)
    assert r.status_code == 200, r.text
    return r.json()["posts"]


def my_applications(api: Api, who: str) -> list[dict[str, Any]]:
    r = api.get("/api/me/applications", who)
    assert r.status_code == 200, r.text
    return r.json()["applications"]


def mails_to(mail: Any, to: str, subject: str | None = None) -> list[dict[str, Any]]:
    found = []
    for message in mail.messages():
        if to.lower() in [a.lower() for a in addresses(message.get("To"))] and (subject is None or message.get("Subject") == subject):
            found.append(message)
    return found


def await_mail(base: str, mail: Any, to: str, subject: str, count: int = 1, nudge: bool = False) -> list[dict[str, Any]]:
    deadline = time.monotonic() + MAIL_SECONDS
    while time.monotonic() < deadline:
        found = mails_to(mail, to, subject)
        if len(found) >= count:
            return found
        if nudge:
            clock(base, OUTBOX_RETRY_SECONDS)
    pytest.fail(f"Mailpit never received {count} email(s) to {to} with subject {subject!r}")


def exactly_once(base: str, mail: Any, to: str, subject: str) -> dict[str, Any]:
    await_mail(base, mail, to, subject)
    clock(base, OUTBOX_RETRY_SECONDS)
    found = mails_to(mail, to, subject)
    assert len(found) == 1, f"expected exactly one {subject!r} to {to}, Mailpit holds {len(found)}"
    return found[0]


LISTEN = """(el) => { window.__heard = [];
  new MutationObserver(() => window.__heard.push(el.textContent || '')).observe(el, {childList: true, subtree: true, characterData: true}); }"""


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements")


def listen(page: Page) -> None:
    region = announcements(page)
    region.wait_for(state="attached")
    region.evaluate(LISTEN)


def heard(page: Page) -> list[str]:
    return list(page.evaluate("() => window.__heard || []")) + [texts(announcements(page))]


def hear(page: Page, phrase: str, seconds: float = LIVE_SECONDS) -> None:
    eventually(page, lambda: any(phrase in t for t in heard(page)), f"status Announcements to read {phrase!r}", seconds)
    page.evaluate("() => { window.__heard = []; }")


def texts(loc: Locator) -> str:
    return " ".join(loc.all_text_contents())


def page_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def attr(loc: Locator, name: str) -> str | None:
    values = loc.evaluate_all("(els, n) => els.map(e => e.getAttribute(n))", name)
    return values[0] if values else None


def is_focused(loc: Locator) -> bool:
    return bool(loc.evaluate_all("els => els.some(e => e === document.activeElement)"))


LIVE_STREAMS: dict[int, list[str]] = {}


def track_live(page: Page) -> None:
    key = id(page)
    seen: list[str] = []
    LIVE_STREAMS[key] = seen

    def on_request(request: Any) -> None:
        try:
            if request.resource_type == "document" and request.frame == page.main_frame:
                seen.clear()
            elif urlparse(request.url).path == "/api/live":
                seen.append(request.url)
        except PlaywrightError:
            pass

    page.on("request", on_request)
    page.on("close", lambda _page: LIVE_STREAMS.pop(key, None))


def live_ready(page: Page) -> None:
    eventually(page, lambda: bool(LIVE_STREAMS.get(id(page))), "the page to open its live stream (GET /api/live)")
    advance(page, STEP_MS)


def settled_box(page: Page, loc: Locator) -> None:
    last: list[Any] = [None]

    def still() -> bool:
        box = loc.bounding_box()
        same = box is not None and box == last[0]
        last[0] = box
        return same

    eventually(page, still, f"{loc} to stop moving")


def described(loc: Locator) -> str:
    return loc.evaluate("e => (e.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)"
                        ".map(i => (document.getElementById(i) || {}).textContent || '').join(' ')")


def rect(loc: Locator) -> dict[str, float]:
    return loc.evaluate("e => { const r = e.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height}; }")


def centre_in_view(loc: Locator) -> None:
    loc.evaluate("e => e.scrollIntoView({block: 'center'})")


def by_id(page: Page, record_id: str) -> Locator:
    return page.locator(f'[data-id="{record_id}"]')


def query(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlparse(page.url).query)


def eventually(page: Page, check: Callable[[], bool], what: str, seconds: float = LIVE_SECONDS) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except PlaywrightError:
            pass
        advance(page, STEP_MS)
    pytest.fail(f"Expected {what} within {seconds} s")


def tab_to(page: Page, target: Locator, key: str = "Tab") -> None:
    for _ in range(TAB_LIMIT):
        if is_focused(target):
            return
        page.keyboard.press(key)
    if not is_focused(target):
        pytest.fail(f"Keyboard {key} never reached {target}")


def reload(page: Page) -> None:
    page.reload()
    advance(page, STEP_MS)
    listen(page)


@contextmanager
def opened(browser: Browser, base: str, path: str, who: str | None = None, size: str = "desktop", reduced: bool = False) -> Iterator[Page]:
    with open_app(browser, base + "/", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size(VIEWPORTS[size])
        if who:
            page.context.add_cookies([{"name": "cb_session", "value": who, "url": base}])
        track_live(page)
        page.goto(base + path)
        advance(page, STEP_MS)
        listen(page)
        yield page


def pick(page: Page, combo: Locator, option: str, typed: str | None = None) -> None:
    combo.click()
    combo.fill("")
    combo.press_sequentially(typed or option)
    choice = page.get_by_role("option", name=option, exact=True)
    eventually(page, lambda: choice.count() > 0, f"option {option!r} under {combo}")
    choice.first.click()


def swipe(page: Page, target: Locator, dx: float, dy: float, from_top: bool = False) -> None:
    box = target.bounding_box()
    assert box, f"{target} has no box to swipe on"
    height = page.viewport_size["height"]
    if not from_top and min(box["y"] + box["height"], height) - max(box["y"], 0) < 2 * EDGE_PX:
        target.scroll_into_view_if_needed()
        box = target.bounding_box()
        assert box, f"{target} has no box to swipe on"
    x = box["x"] + box["width"] / 2
    y = box["y"] + EDGE_PX if from_top else (max(box["y"], 0) + min(box["y"] + box["height"], height)) / 2
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for i in range(1, SWIPE_STEPS + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * i / SWIPE_STEPS, "y": y + dy * i / SWIPE_STEPS}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def gone_or_state(loc: Locator, state: str) -> bool:
    return loc.count() == 0 or attr(loc, "data-state") == state


MOTION_JS = """(name) => { const e = Array.from(document.querySelectorAll('*')).find(x => x.getAttribute('data-motion') === name);
  return e ? {ms: e.getAttribute('data-motion-ms'), state: e.getAttribute('data-state'), text: e.textContent || ''} : null; }"""


def motion_of(page: Page, name: str) -> dict[str, Any] | None:
    return page.evaluate(MOTION_JS, name)


def test_health_routes(app_url):
    down = outage_url("APP_SEARCH_DOWN_URL")
    for path in ("/api/health", "/health"):
        r = httpx.get(app_url.rstrip("/") + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, r.text
        r = httpx.get(down + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "unavailable"}, r.text


def test_grading_routes(app_url):
    api = Api(app_url)
    company = lab("c")
    for headers in ({}, {"X-Grading-Token": GRADING_TOKEN + "x"}):
        assert_error(httpx.post(api.base + "/api/grading/setup", json={"companies": [company]}, headers=headers, timeout=HTTP_TIMEOUT), 404, "not_found")
        assert_error(httpx.post(api.base + "/api/grading/clock", json={"advance_seconds": CLOCK_PROBE}, headers=headers, timeout=HTTP_TIMEOUT), 404, "not_found")
    assert_error(api.get(f"/api/companies/{company['slug']}"), 404, "not_found")
    r = post_json(app_url, "/api/grading/setup", {"companies": [company], "users": [person("member")]}, **{"X-Grading-Token": GRADING_TOKEN})
    assert r.status_code == 201, r.text
    assert {"ids", "sessions"} <= set(r.json()) and "c" in r.json()["ids"] and "member" in r.json()["sessions"]
    assert company_json(api, company["slug"])["name"] == company["name"]
    me = api.get("/api/me", r.json()["sessions"]["member"])
    assert me.status_code == 200 and me.json()["role"] == "member"
    before = clock(app_url, 0)
    after = clock(app_url, CLOCK_PROBE)
    assert timedelta(seconds=CLOCK_PROBE) <= after - before < timedelta(seconds=CLOCK_PROBE + HTTP_TIMEOUT)


ERROR_CASES = ["unauthenticated", "body-id-404-before-422", "role-403-before-422", "payload-413-first", "payload-at-limit", "malformed-json", "field-errors", "cross-origin"]


def padded(size: int) -> bytes:
    shell = b'{"pad":""}'
    return b'{"pad":"' + b"x" * (size - len(shell)) + b'"}'


@pytest.mark.parametrize("case", ERROR_CASES, ids=ERROR_CASES)
def test_error_shape_and_precedence(app_url, case):
    api = Api(app_url)
    ids, s = seed(app_url, companies=[lab("c")], users=[person("member"), person("mod", "moderator")])
    good = review_body(ids["c"])
    json_type = {"Content-Type": "application/json"}
    if case == "unauthenticated":
        assert_error(api.get("/api/me"), 401, "unauthenticated")
        assert_error(api.post("/api/posts", good), 401, "unauthenticated")
    elif case == "body-id-404-before-422":
        assert_error(api.post("/api/posts", {**good, "company_id": f"missing-{word()}", "overall": 9}, s["member"]), 404, "not_found")
    elif case == "role-403-before-422":
        assert_error(api.post("/api/posts", {**good, "overall": 9}, s["mod"]), 403, "forbidden")
    elif case == "payload-413-first":
        assert_error(api("POST", "/api/posts", content=padded(JSON_LIMIT + 1), headers=json_type), 413, "payload_too_large")
    elif case == "payload-at-limit":
        assert_error(api("POST", "/api/posts", content=padded(JSON_LIMIT), headers=json_type), 401, "unauthenticated")
    elif case == "malformed-json":
        assert_error(api("POST", "/api/posts", s["member"], content=b'{"kind":', headers=json_type), 422, "validation_failed")
    elif case == "field-errors":
        fields = assert_fields(api.post("/api/posts", {**good, "overall": 0, "title": "abc"}, s["member"]), "overall", "title")
        assert set(fields) == {"overall", "title"}
    else:
        r = api.post("/api/posts", good, s["member"], headers={"Origin": "http://elsewhere.invalid"})
        assert_error(r, 403, "forbidden")
        assert my_posts(api, s["member"]) == []


@pytest.mark.parametrize("pref", ["full", "reduced"], ids=["full", "reduced"])
def test_motion_toast(app_url, browser, pref):
    w = word()
    _, s = seed(app_url, users=[person("member")])
    with opened(browser, app_url, f"/jobs?q={w}", s["member"], reduced=pref == "reduced") as page:
        assert page.evaluate("() => document.documentElement.getAttribute('data-motion-pref')") == pref
        page.get_by_role("button", name="Save alert").click()
        toast = lambda: motion_of(page, "toast") or {}
        eventually(page, lambda: f"Alert saved for {w}" in toast().get("text", ""), "the toast with the alert text")
        if pref == "full":
            assert toast()["ms"] == str(TOAST_MS)
            assert toast()["state"] == "opening"
            advance(page, TOAST_MS)
            eventually(page, lambda: toast().get("state") == "open", "the toast to open")
        else:
            assert toast()["ms"] == "0"
            eventually(page, lambda: toast().get("state") == "open", "the toast open at once")
        advance(page, TOAST_SECONDS * 1000 // 2)
        assert toast()["state"] == "open"
        advance(page, TOAST_SECONDS * 1000 + TOAST_MS)
        assert toast().get("state", "closed") == "closed", f"toast state is {toast().get('state')}"


def test_mail_outbox_waits_out_outage(app_url, mail):
    down = Api(outage_url("APP_MAIL_DOWN_URL"))
    now = clock(app_url)
    w = word()
    company = lab("c")
    author = person("author")
    post = review("rv", "c", "author", iso(now), state="claimed", claimed_by="mod", title=f"Outbox title {w}", pros=f"Kind seniors and a calm bench {w} with steady hours.")
    ids, s = seed(app_url, companies=[company], users=[author, person("mod", "moderator"), person("founder", "founder")], posts=[post])
    r = down.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "approve"}, s["mod"])
    assert r.status_code == 200 and r.json()["state"] == "approved", r.text
    health = down.get("/api/founder/health", s["founder"])
    assert health.status_code == 200, health.text
    assert health.json()["mail"] == "unavailable" and isinstance(health.json()["outbox_pending"], int)
    subject = "Your post on Candour Bench was approved"
    message = await_mail(app_url, mail, author["email"], subject, nudge=True)[0]
    body = text(message)
    assert f"Your review for {company['name']} was approved." in body
    assert w not in body, "outcome email carries post text"
    clock(app_url, OUTBOX_RETRY_SECONDS)
    assert len(mails_to(mail, author["email"], subject)) == 1, "outcome email sent more than once"


def test_founder_console_api(app_url, mail):
    api = Api(app_url)
    now = clock(app_url)
    company = lab("c")
    amounts = [431117, 452229, 473331]
    posts = [pay_report(f"p{i}", "c", "author", iso(now), v) for i, v in enumerate(amounts)] + [review("rv", "c", "author", iso(now))]
    ids, s = seed(app_url, companies=[company], posts=posts,
                  users=[person("founder", "founder"), person("member"), person("author"), person("rec", "recruiter", company="c")])
    founder = s["founder"]
    assert_error(api.get("/api/founder/health", s["member"]), 403, "forbidden")
    health = api.get("/api/founder/health", founder).json()
    assert HEALTH_KEYS <= set(health)
    assert all(health[k] == "ok" for k in ("database", "search", "storage", "mail")), health

    w = word()
    new = {"name": f"Probe {w.capitalize()} Bioworks", "slug": f"probe-{w}-bio", "city": "saltmere", "size": "1-10", "email_domain": f"{w}.test"}
    r = api.post("/api/founder/companies", new, founder)
    assert r.status_code == 201 and set(r.json()) == HIT_KEYS and r.json()["slug"] == new["slug"], r.text
    assert company_json(api, new["slug"])["city"] == "saltmere"

    work = email_for("employer")
    r = api.post("/api/founder/employer-users", {"company_slug": new["slug"], "display_name": "Probe Admin", "email": work, "role": "employer_admin"}, founder)
    assert r.status_code == 201 and MEMBER_ROW_KEYS <= set(r.json()) and r.json()["role"] == "employer_admin", r.text
    assert_error(api.post("/api/founder/employer-users", {"company_slug": f"missing-{w}", "display_name": "Probe Admin", "email": email_for("nobody"), "role": "recruiter"}, founder), 404, "not_found")
    letter = await_mail(app_url, mail, work, "Set your Candour Bench password")[0]
    token = re.search(r"/reset-password\?token=([^\s&\"'<>]+)", text(letter))
    assert token, "set-password email has no reset link"
    signed = api.post("/api/auth/reset", {"token": token.group(1), "password": PASSWORD})
    assert signed.status_code == 200 and signed.json()["user"]["role"] == "employer_admin", signed.text
    assert_error(api.post("/api/auth/reset", {"token": token.group(1), "password": PASSWORD}), 422, "token_invalid")

    assert_error(api.get("/api/moderation/queue", s["member"]), 403, "forbidden")
    r = api.post("/api/founder/moderators", {"user_id": ids["member"]}, founder)
    assert r.status_code == 200 and r.json()["role"] == "moderator", r.text
    assert api.get("/api/moderation/queue", s["member"]).status_code == 200
    assert_error(api.post("/api/founder/moderators", {"user_id": ids["member"]}, founder), 409, "invalid_transition")
    members = api.get("/api/founder/members", founder).json()["members"]
    assert next(m for m in members if m["id"] == ids["member"])["role"] == "moderator"

    r = api.post(f"/api/founder/companies/{company['slug']}/revoke-verification", who=founder)
    assert r.status_code == 200 and set(r.json()) == HIT_KEYS and r.json()["verified"] is False, r.text
    assert company_json(api, company["slug"])["verified"] is False
    assert_error(api.post(f"/api/employer/reviews/{ids['rv']}/reply", {"body": REPLY_BODY}, s["rec"]), 403, "not_verified")

    t = api.get("/api/founder/thresholds", founder)
    assert t.status_code == 200
    rows = [row for row in t.json()["rows"] if row["company_slug"] == company["slug"]]
    assert rows and all(THRESHOLD_KEYS <= set(row) for row in rows)
    assert rows[0]["report_count"] == len(amounts) and rows[0]["threshold"] == MIN_PAY_REPORTS and rows[0]["shown"] is False
    assert not any(str(v) in t.text or rupees(v) in t.text for v in amounts), "thresholds carry a pay figure"


def test_founder_console_ui(app_url, browser):
    api = Api(app_url)
    now = clock(app_url)
    company = lab("c")
    amounts = [431123, 452237, 473341]
    member = person("member")
    ids, s = seed(app_url, companies=[company], users=[person("founder", "founder"), member],
                  posts=[pay_report(f"p{i}", "c", "member", iso(now), v) for i, v in enumerate(amounts)])
    with opened(browser, app_url, "/founder", s["founder"]) as page:
        for name in ("Service health", "Members", "Companies", "Pay thresholds"):
            expect(page.get_by_role("table", name=name)).to_be_visible()
        thresholds = texts(page.get_by_role("table", name="Pay thresholds"))
        assert not any(rupees(v) in thresholds or str(v) in thresholds for v in amounts)
        page.get_by_role("button", name=f"Make {member['display_name']} a moderator").click()
        hear(page, f"{member['display_name']} is now a moderator.")
        row = page.get_by_role("table", name="Members").get_by_role("row").filter(has_text=member["display_name"])
        eventually(page, lambda: "Moderator" in texts(row), "the member row to read Moderator")
        page.get_by_role("button", name=f"Revoke verification for {company['name']}").click()
        hear(page, f"Verification revoked for {company['name']}.")
        crow = page.get_by_role("table", name="Companies").get_by_role("row").filter(has_text=company["name"])
        eventually(page, lambda: "Not verified" in texts(crow), "the company row to read Not verified")
    members = api.get("/api/founder/members", s["founder"]).json()["members"]
    assert next(m for m in members if m["id"] == ids["member"])["role"] == "moderator"
    assert company_json(api, company["slug"])["verified"] is False


AUTH_CASES = ["sign-in", "join", "forgot"]


def median_ms(call: Callable[[], httpx.Response]) -> tuple[float, httpx.Response]:
    samples, last = [], None
    for _ in range(TIMING_RUNS):
        start = time.perf_counter()
        last = call()
        samples.append((time.perf_counter() - start) * 1000)
    samples.sort()
    return samples[len(samples) // 2], last


@pytest.mark.parametrize("case", AUTH_CASES, ids=AUTH_CASES)
def test_auth_reveals_nobody(app_url, mail, case):
    api = Api(app_url)
    known = person("known")
    seed(app_url, users=[known])
    if case == "sign-in":
        known_ms, wrong = median_ms(lambda: api.post("/api/auth/sign-in", {"email": known["email"], "password": PASSWORD + "x"}))
        unknown_ms, miss = median_ms(lambda: api.post("/api/auth/sign-in", {"email": email_for("nobody"), "password": PASSWORD + "x"}))
        assert_error(wrong, 401, "invalid_credentials")
        assert wrong.json() == miss.json()
        ok = api.post("/api/auth/sign-in", {"email": known["email"], "password": PASSWORD})
        assert ok.status_code == 200 and {"id", "display_name", "role", "unlocked"} <= set(ok.json()["user"]), ok.text
        assert_session_cookie(ok.headers.get("set-cookie", ""))
    elif case == "join":
        fresh = [email_for("joiner") for _ in range(TIMING_RUNS)]
        known_ms, r_known = median_ms(lambda: api.post("/api/auth/join", {"display_name": "Probe Joiner", "email": known["email"], "password": PASSWORD}))
        unknown_ms, r_new = median_ms(lambda: api.post("/api/auth/join", {"display_name": "Probe Joiner", "email": fresh.pop(), "password": PASSWORD}))
        assert r_known.status_code == r_new.status_code == 202
        assert r_known.json() == r_new.json() == {"status": "check_email"}
        existing = await_mail(app_url, mail, known["email"], "You already have a Candour Bench account")[0]
        assert "/sign-in" in text(existing) and "/forgot-password" in text(existing)
        target = email_for("newcomer")
        api.post("/api/auth/join", {"display_name": "Probe Newcomer", "email": target, "password": PASSWORD})
        letter = await_mail(app_url, mail, target, "Finish joining Candour Bench")[0]
        token = re.search(r"/join/confirm\?token=([^\s&\"'<>]+)", text(letter))
        assert token, "join email has no confirm link"
        confirmed = api.post("/api/auth/join/confirm", {"token": token.group(1)})
        assert confirmed.status_code == 201 and SESSION_COOKIE in confirmed.headers.get("set-cookie", ""), confirmed.text
        assert_error(api.post("/api/auth/join/confirm", {"token": token.group(1)}), 422, "token_invalid")
    else:
        stranger = email_for("stranger")
        known_ms, r_known = median_ms(lambda: api.post("/api/auth/forgot", {"email": known["email"]}))
        unknown_ms, r_unknown = median_ms(lambda: api.post("/api/auth/forgot", {"email": stranger}))
        assert r_known.status_code == r_unknown.status_code == 202
        assert r_known.json() == r_unknown.json() == {"status": "sent"}
        letter = await_mail(app_url, mail, known["email"], "Reset your Candour Bench password", count=TIMING_RUNS)[0]
        token = re.search(r"/reset-password\?token=([^\s&\"'<>]+)", text(letter))
        assert token
        changed = api.post("/api/auth/reset", {"token": token.group(1), "password": PASSWORD + "2"})
        assert changed.status_code == 200, changed.text
        assert api.post("/api/auth/sign-in", {"email": known["email"], "password": PASSWORD + "2"}).status_code == 200
        assert mails_to(mail, stranger) == [], "an unknown address received mail"
    assert abs(known_ms - unknown_ms) < SAME_TIME_MS, f"known {known_ms:.0f} ms vs unknown {unknown_ms:.0f} ms"


def to_ratings(page: Page, company_name: str) -> None:
    pick(page, page.get_by_role("combobox", name="Company"), company_name)
    page.get_by_role("button", name="Next", exact=True).click()
    expect(page.get_by_role("heading", name="Step 2 of 4: Ratings")).to_be_focused()


def test_star_ratings(app_url, browser):
    company = lab("c")
    _, s = seed(app_url, companies=[company], users=[person("member")])
    with opened(browser, app_url, "/contribute/review", s["member"]) as page:
        to_ratings(page, company["name"])
        overall = page.get_by_role("radiogroup", name="Overall rating")
        star = lambda group, n: group.get_by_role("radio", name=star_name(n), exact=True)
        page.keyboard.press("Tab")
        expect(star(overall, 1)).to_be_focused()
        page.keyboard.press("Space")
        expect(star(overall, 1)).to_be_checked()
        expect(overall).to_have_attribute("data-motion", "star-fill")
        expect(overall).to_have_attribute("data-motion-ms", str(STAR_FILL_MS))
        expect(overall).to_have_attribute("data-state", "running")
        advance(page, STAR_FILL_MS)
        expect(overall).to_have_attribute("data-state", "done")
        hear(page, "Overall rating: 1 of 5")
        for key, n in (("ArrowRight", 2), ("End", 5), ("ArrowRight", 1), ("ArrowLeft", 5), ("Home", 1), ("ArrowUp", 2), ("ArrowDown", 1)):
            page.keyboard.press(key)
            expect(star(overall, n)).to_be_checked()
            expect(star(overall, n)).to_be_focused()
            hear(page, f"Overall rating: {n} of 5")
        pay = page.get_by_role("radiogroup", name="Pay rating")
        star(pay, 3).click()
        expect(star(pay, 3)).to_be_checked()
        hear(page, "Pay rating: 3 of 5")


def test_company_picker(app_url, browser):
    api = Api(app_url)
    w = word()
    north = {"key": "n", "name": f"Probe {w.capitalize()} North Assay", "slug": f"probe-{w}-north", "city": "harrowgate", "size": "11-50", "verified": True, "email_domain": f"{w}n.test"}
    south = {"key": "s", "name": f"Probe {w.capitalize()} South Assay", "slug": f"probe-{w}-south", "city": "kelvane", "size": "11-50", "verified": True, "email_domain": f"{w}s.test"}
    _, s = seed(app_url, companies=[south, north], users=[person("member")])
    options = api.get("/api/companies/options", params={"q": w.upper()}).json()["options"]
    assert [o["name"] for o in options] == [north["name"], south["name"]]
    assert all(set(o) == {"id", "name", "city"} for o in options)
    with opened(browser, app_url, "/contribute/review", s["member"]) as page:
        combo = page.get_by_role("combobox", name="Company")
        listbox = page.get_by_role("listbox", name="Company suggestions")
        combo.focus()
        page.keyboard.type(w)
        advance(page, DEBOUNCE_MS)
        eventually(page, lambda: listbox.get_by_role("option").count() == 2, "two Company suggestions")
        active = lambda: page.evaluate("id => (document.getElementById(id) || {}).textContent || ''", combo.get_attribute("aria-activedescendant") or "")
        for key, name, i in (("ArrowDown", north, 1), ("ArrowDown", south, 2), ("ArrowDown", south, 2), ("ArrowUp", north, 1)):
            page.keyboard.press(key)
            assert name["name"] in active(), f"aria-activedescendant does not point at {name['name']}"
            hear(page, f"{name['name']}, {i} of 2")
        page.keyboard.press("Escape")
        expect(listbox).to_be_hidden()
        assert combo.input_value() == w
        combo.fill("")
        page.keyboard.type(w)
        advance(page, DEBOUNCE_MS)
        eventually(page, lambda: listbox.get_by_role("option").count() == 2, "Company suggestions after retyping")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        expect(listbox).to_be_hidden()
        assert combo.input_value() == north["name"]


def test_one_review_per_company_per_year(app_url):
    api = Api(app_url)
    now = clock(app_url)
    ids, s = seed(app_url, companies=[lab("c1"), lab("c2"), lab("c3")], users=[person("member")],
                  posts=[review("old", "c2", "member", iso(now - timedelta(days=YEAR_DAYS))),
                         review("recent", "c3", "member", iso(now - timedelta(days=YEAR_DAYS - 1)))])
    first = api.post("/api/posts", review_body(ids["c1"]), s["member"])
    assert first.status_code == 201, first.text
    assert_error(api.post("/api/posts", review_body(ids["c1"]), s["member"]), 409, "duplicate_review")
    assert len([p for p in my_posts(api, s["member"]) if p["kind"] == "review" and p["id"] == first.json()["id"]]) == 1
    assert api.delete(f"/api/posts/{first.json()['id']}", s["member"]).status_code == 204
    assert_error(api.post("/api/posts", review_body(ids["c1"]), s["member"]), 409, "duplicate_review")
    assert api.post("/api/posts", review_body(ids["c2"]), s["member"]).status_code == 201
    assert_error(api.post("/api/posts", review_body(ids["c3"]), s["member"]), 409, "duplicate_review")


def walk_review_steps(page: Page, company_name: str, w: str, title: str) -> None:
    combo = page.get_by_role("combobox", name="Company")
    combo.focus()
    page.keyboard.type(w)
    eventually(page, lambda: page.get_by_role("option", name=company_name, exact=True).count() > 0, "the company in Company suggestions")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    assert combo.input_value() == company_name
    tab_to(page, page.get_by_role("button", name="Next", exact=True))
    page.keyboard.press("Enter")
    expect(page.get_by_role("heading", name="Step 2 of 4: Ratings")).to_be_focused()
    expect(page.get_by_role("list", name="Review steps").get_by_role("listitem").filter(has_text="Ratings")).to_have_attribute("aria-current", "step")
    for group, keys in (("Overall rating", ["End"]), ("Work-life balance rating", ["Space", "ArrowRight", "ArrowRight", "ArrowRight"]),
                        ("Pay rating", ["Home", "ArrowRight", "ArrowRight"]), ("Management rating", ["End", "ArrowLeft"])):
        first = page.get_by_role("radiogroup", name=group).get_by_role("radio", name="1 star", exact=True)
        tab_to(page, first) if not is_focused(first) else None
        for key in keys:
            page.keyboard.press(key)
    tab_to(page, page.get_by_role("button", name="Next", exact=True))
    page.keyboard.press("Enter")
    expect(page.get_by_role("heading", name="Step 3 of 4: Your review")).to_be_focused()
    for name, value in (("Title", title), ("Pros", PROS), ("Cons", CONS)):
        tab_to(page, page.get_by_role("textbox", name=name, exact=True))
        page.keyboard.type(value)
    tab_to(page, page.get_by_role("button", name="Next", exact=True))
    page.keyboard.press("Enter")
    expect(page.get_by_role("heading", name="Step 4 of 4: Check and post")).to_be_focused()


def test_wf_review_keyboard_happy(app_url, browser, meilisearch):
    api = Api(app_url)
    w = word()
    company = lab("c")
    company["name"] = f"Probe {w.capitalize()} Assay"
    ids, s = seed(app_url, companies=[company], users=[person("member"), person("mod", "moderator")])
    title = f"Steady bench {w}"
    with opened(browser, app_url, "/contribute/review", s["member"]) as page:
        expect(page.get_by_role("heading", name=step_heading(1, "Company"))).to_be_visible()
        expect(page.get_by_role("list", name="Review steps").get_by_role("listitem").filter(has_text="Company")).to_have_attribute("aria-current", "step")
        walk_review_steps(page, company["name"], w, title)
        assert title in page_text(page)
        tab_to(page, page.get_by_role("button", name="Post review"))
        page.keyboard.press("Enter")
        hear(page, "Thanks. Your review is waiting for a moderator.")
        eventually(page, lambda: urlparse(page.url).path == "/me/contributions", "My contributions after posting")
        item = page.get_by_role("list", name="My contributions").get_by_role("listitem").filter(has_text=title)
        eventually(page, lambda: "Pending" in texts(item), "the review to read Pending")
        pending_id = next(p for p in my_posts(api, s["member"]) if p["label"] == title)["id"]
        response = page.goto(app_url.rstrip("/") + f"/companies/{company['slug']}/reviews/{pending_id}")
        advance(page, STEP_MS)
        expect_not_found(page, response)
    post = next(p for p in my_posts(api, s["member"]) if p["label"] == title)
    assert post["state"] == "pending" and post["kind"] == "review"
    queued = queue_item(api, s["mod"], post["id"])
    assert queued and (queued["overall"], queued["work_life"], queued["pay"], queued["management"]) == (5, 4, 3, 4)
    hit = next(h for h in api.get("/api/companies/search", params={"q": w}).json()["hits"] if h["slug"] == company["slug"])
    assert hit["review_count"] == 0 and hit["rating"] is None
    meilisearch.settled()
    assert meilisearch.document("companies", ids["c"])["review_count"] == 0


def test_wf_review_keyboard_invalid_step(app_url, browser):
    api = Api(app_url)
    company = lab("c")
    _, s = seed(app_url, companies=[company], users=[person("member")])
    with opened(browser, app_url, "/contribute/review", s["member"]) as page:
        combo = page.get_by_role("combobox", name="Company")
        combo.focus()
        tab_to(page, page.get_by_role("button", name="Next", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: "Choose a company." in described(combo), "the company error linked to the combobox")
        expect(combo).to_be_focused()
        expect(page.get_by_role("heading", name=step_heading(1, "Company"))).to_be_visible()
        to_ratings(page, company["name"])
        page.keyboard.press("Tab")
        page.keyboard.press("End")
        tab_to(page, page.get_by_role("button", name="Next", exact=True))
        page.keyboard.press("Enter")
        group = page.get_by_role("radiogroup", name="Work-life balance rating")
        first = group.get_by_role("radio", name="1 star", exact=True)
        eventually(page, lambda: "Choose a rating from 1 to 5." in described(group) + described(first), "the rating error linked to its group")
        expect(first).to_be_focused()
        tab_to(page, page.get_by_role("button", name="Back"))
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name=step_heading(1, "Company"))).to_be_focused()
        assert combo.input_value() == company["name"]
        page.get_by_role("button", name="Next", exact=True).click()
        expect(page.get_by_role("radiogroup", name="Overall rating").get_by_role("radio", name="5 stars")).to_be_checked()
    assert my_posts(api, s["member"]) == []


POST_CASES = {
    "pay-lowest": ("pay_report", {"annual_pay": 100000}, None),
    "pay-below": ("pay_report", {"annual_pay": 99999}, "annual_pay"),
    "pay-highest": ("pay_report", {"annual_pay": 5000000}, None),
    "pay-above": ("pay_report", {"annual_pay": 5000001}, "annual_pay"),
    "years-forty": ("pay_report", {"years_experience": 40}, None),
    "years-over": ("pay_report", {"years_experience": 41}, "years_experience"),
    "bad-role": ("pay_report", {"role_family": "glassblower"}, "role_family"),
    "bad-city": ("pay_report", {"city": "nowhere"}, "city"),
    "note-ok": ("interview_note", {}, None),
    "note-short": ("interview_note", {"text": "x" * 19}, "text"),
    "note-longest": ("interview_note", {"text": "y" * 3000}, None),
    "note-too-long": ("interview_note", {"text": "y" * 3001}, "text"),
    "bad-outcome": ("interview_note", {"outcome": "ghosted"}, "outcome"),
    "bad-difficulty": ("interview_note", {"difficulty": 6}, "difficulty"),
}


POST_CASE_IDS = ["pay-lowest", "pay-below", "pay-highest", "pay-above", "years-forty", "years-over", "bad-role", "bad-city", "note-ok", "note-short", "note-longest", "note-too-long", "bad-outcome", "bad-difficulty"]


@pytest.mark.parametrize("case", POST_CASE_IDS, ids=POST_CASE_IDS)
def test_pay_reports_and_interview_notes(app_url, case):
    api = Api(app_url)
    company = lab("c")
    ids, s = seed(app_url, companies=[company], users=[person("member"), person("mod", "moderator"), person("viewer", unlocked=True)])
    kind, over, field = POST_CASES[case]
    if kind == "pay_report":
        body = {"kind": kind, "company_id": ids["c"], "role_family": "qc_analyst", "city": "harrowgate", "annual_pay": 450000, "years_experience": 3}
        label = f"Pay report: QC Analyst at {company['name']}"
    else:
        body = {"kind": kind, "company_id": ids["c"], "role_family": "lab_manager", "difficulty": 3, "outcome": "no_reply", "text": NOTE_TEXT}
        label = f"Interview note: Lab Manager at {company['name']}"
    r = api.post("/api/posts", {**body, **over}, s["member"])
    if field:
        assert_fields(r, field)
        assert my_posts(api, s["member"]) == []
        return
    assert r.status_code == 201, r.text
    created = r.json()
    assert set(created) == {"id", "kind", "state", "label", "company_name", "posted_month"}
    assert (created["state"], created["kind"], created["label"], created["company_name"]) == ("pending", kind, label, company["name"])
    assert re.fullmatch(r"\d{4}-\d{2}", created["posted_month"])
    queued = queue_item(api, s["mod"], created["id"])
    assert queued and queued["state"] == "pending" and queued["label"] == label
    seen = company_json(api, company["slug"], s["viewer"])
    assert seen["pay_rows"] == [] and seen["interview_notes"] == []


def test_wf_contribute_unlock_happy(app_url, browser):
    api = Api(app_url)
    now = clock(app_url)
    company = lab("c")
    amounts = [480100, 510200, 530300, 560400, 580500]
    member = person("member")
    ids, s = seed(app_url, companies=[company], users=[member, person("other"), person("mod", "moderator")],
                  posts=[review("rv", "c", "other", iso(now), pros=LONG_PROS)] + [pay_report(f"p{i}", "c", "other", iso(now), v) for i, v in enumerate(amounts)])
    locked = company_json(api, company["slug"], s["member"])
    assert locked["viewer_unlocked"] is False
    assert locked["reviews"][0]["pros"] == LONG_PROS[:EXCERPT_CHARS] and locked["reviews"][0]["truncated"] is True
    assert pay_row(locked, "qc_analyst", "harrowgate")["band"] is None
    with opened(browser, app_url, f"/companies/{company['slug']}", s["member"]) as page:
        panel = page.get_by_role("region", name="Contribute once to unlock")
        expect(panel).to_contain_text("Share one review, pay report or interview note to unlock full pay and review detail.")
        body = page_text(page)
        assert LONG_PROS[:EXCERPT_CHARS].strip() in body and LONG_PROS not in body and "…" in body
        assert not any(rupees(v) in page.content() for v in band_for(amounts).values())
        company_page = page.context.new_page()
        track_live(company_page)
        company_page.goto(page.url)
        advance(company_page, STEP_MS)
        listen(company_page)
        expect(company_page.get_by_role("region", name="Contribute once to unlock")).to_be_visible()
        live_ready(company_page)
        share = panel.get_by_role("link", name="Share something")
        share.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: urlparse(page.url).path == "/contribute", "the contribute chooser")
        page.get_by_role("link", name="Report your pay").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: urlparse(page.url).path == "/contribute/pay", "the pay form")
        pick(page, page.get_by_role("combobox", name="Company"), company["name"])
        select(page.get_by_role("combobox", name="Role"), "QC Analyst")
        select(page.get_by_role("combobox", name="City"), "Harrowgate")
        page.get_by_role("spinbutton", name="Annual pay in rupees").fill("500000")
        page.get_by_role("spinbutton", name="Years of experience").fill("2")
        page.get_by_role("button", name="Post pay report").click()
        hear(page, "Thanks. Your pay report is waiting for a moderator.")
        post = next(p for p in my_posts(api, s["member"]) if p["kind"] == "pay_report")
        assert post["state"] == "pending" and post["label"] == f"Pay report: QC Analyst at {company['name']}"
        item = by_id(page, post["id"])
        eventually(page, lambda: "Pending" in texts(item), "the pay report to read Pending")
        live_ready(page)
        decide(api, post["id"], s["mod"])
        eventually(page, lambda: "Approved" in texts(item), "the pay report to read Approved live")
        hear(company_page, "Full pay and review detail is now unlocked.")
        unlocked = company_json(api, company["slug"], s["member"])
        band = pay_row(unlocked, "qc_analyst", "harrowgate")["band"]
        assert band == band_for(amounts + [500000])
        eventually(company_page, lambda: LONG_PROS in page_text(company_page) and rupees(band["median"]) in page_text(company_page), "full text and figures live")
        expect(company_page.get_by_role("region", name="Contribute once to unlock")).to_have_count(0)
        reload(company_page)
        eventually(company_page, lambda: LONG_PROS in page_text(company_page), "full text after reload")
    other = api.post("/api/auth/sign-in", {"email": member["email"], "password": PASSWORD})
    second = other.cookies.get("cb_session")
    assert second and second != s["member"]
    with opened(browser, app_url, f"/companies/{company['slug']}", second) as device:
        eventually(device, lambda: LONG_PROS in page_text(device), "full text on another device")
    assert api.delete(f"/api/posts/{post['id']}", s["member"]).status_code == 204
    assert api.get("/api/me", s["member"]).json()["unlocked"] is True


def test_wf_contribute_unlock_invalid_recovery(app_url, browser):
    api = Api(app_url)
    company = lab("c")
    _, s = seed(app_url, companies=[company], users=[person("member")])
    with opened(browser, app_url, "/contribute/pay", s["member"]) as page:
        pick(page, page.get_by_role("combobox", name="Company"), company["name"])
        select(page.get_by_role("combobox", name="Role"), "QC Analyst")
        select(page.get_by_role("combobox", name="City"), "Harrowgate")
        pay = page.get_by_role("spinbutton", name="Annual pay in rupees")
        pay.fill("99999")
        page.get_by_role("spinbutton", name="Years of experience").fill("2")
        page.get_by_role("button", name="Post pay report").click()
        eventually(page, lambda: FIELD_COPY["annual_pay"] in described(pay), "the pay error linked under its field")
        assert my_posts(api, s["member"]) == []
        pay.fill("100000")
        page.get_by_role("button", name="Post pay report").click()
        hear(page, "Thanks. Your pay report is waiting for a moderator.")
    posts = my_posts(api, s["member"])
    assert len(posts) == 1 and posts[0]["state"] == "pending"
    assert api.get("/api/me", s["member"]).json()["unlocked"] is False


def test_edit_and_delete_posts(app_url, meilisearch):
    api = Api(app_url)
    now = clock(app_url)
    c1, c2, c3 = lab("c1"), lab("c2"), lab("c3")
    ids, s = seed(app_url, companies=[c1, c2, c3], users=[person("author"), person("viewer", unlocked=True), person("mod", "moderator")],
                  posts=[review("fresh", "c1", "author", iso(now - timedelta(minutes=1))),
                         review("late", "c2", "author", iso(now - timedelta(minutes=EDIT_WINDOW_MINUTES))),
                         review("claimed", "c2", "author", iso(now), state="claimed", claimed_by="mod"),
                         review("gone", "c3", "author", iso(now)),
                         pay_report("pay", "c3", "author", iso(now), 520000)])
    edit = review_body(ids["c1"], title=f"Edited bench {word(5)}")
    edit.pop("kind"); edit.pop("company_id")
    r = api.patch(f"/api/posts/{ids['fresh']}", edit, s["author"])
    assert r.status_code == 200 and r.json()["state"] == "pending" and r.json()["label"] == edit["title"], r.text
    seen = company_json(api, c1["slug"], s["viewer"])
    assert seen["rating"]["review_count"] == 0 and seen["reviews"] == []
    meilisearch.settled()
    assert meilisearch.document("companies", ids["c1"])["review_count"] == 0
    assert_error(api.patch(f"/api/posts/{ids['late']}", edit, s["author"]), 409, "edit_window_closed")
    assert_error(api.patch(f"/api/posts/{ids['claimed']}", edit, s["author"]), 409, "in_review")
    assert_error(api.delete(f"/api/posts/{ids['claimed']}", s["author"]), 409, "in_review")
    assert queue_item(api, s["mod"], ids["claimed"])["state"] == "claimed"
    for refused in (api.delete(f"/api/posts/{ids['gone']}", s["viewer"]), api.patch(f"/api/posts/{ids['gone']}", edit, s["viewer"])):
        assert refused.status_code in (403, 404), refused.text
    assert company_json(api, c3["slug"], s["viewer"])["rating"]["review_count"] == 1
    assert api.delete(f"/api/posts/{ids['gone']}", s["author"]).status_code == 204
    assert meilisearch.document("companies", ids["c3"])["review_count"] == 0, "search document not updated before the delete answered"
    assert_error(api.get(f"/api/companies/{c3['slug']}/reviews/{ids['gone']}"), 404, "not_found")
    page = httpx.get(api.base + f"/companies/{c3['slug']}/reviews/{ids['gone']}", timeout=HTTP_TIMEOUT)
    assert page.status_code == 404
    seen = company_json(api, c3["slug"], s["viewer"])
    assert seen["rating"]["review_count"] == 0 and all(rv["id"] != ids["gone"] for rv in seen["reviews"])
    assert api.delete(f"/api/posts/{ids['pay']}", s["author"]).status_code == 204
    assert pay_row(company_json(api, c3["slug"], s["viewer"]), "qc_analyst", "harrowgate") is None
    assert_error(api.delete(f"/api/posts/{ids['gone']}", s["author"]), 404, "not_found")
    assert all(p["id"] not in (ids["gone"], ids["pay"]) for p in my_posts(api, s["author"]))


def test_anonymous_posts(app_url, browser):
    api = Api(app_url)
    now = clock(app_url)
    w = word()
    channel = {"key": "ch", "name": f"Probe {w.capitalize()} talk", "slug": f"probe-{w}-talk"}
    company = lab("c")
    author, mod1 = person("author"), person("mod1", "moderator")
    ids, s = seed(app_url, companies=[company], channels=[channel],
                  users=[author, mod1, person("mod2", "moderator"), person("viewer", unlocked=True), person("writer")],
                  posts=[review("rv", "c", "author", iso(now), title=f"Anon review {w}"),
                         review("own", "c", "mod1", iso(now), state="pending", title=f"Own post {w}")])
    ok = api.post(f"/api/channels/{channel['slug']}/posts", {"body": f"QC pay near ₹6,40,000 here {w}"}, s["author"])
    assert ok.status_code == 201, ok.text
    post = ok.json()
    assert set(post) == CHANNEL_POST_KEYS and post["author_label"] == ANON and post["quote"] is None
    assert re.fullmatch(r"\d{4}-\d{2}", post["posted_month"])
    for body, code in ((f"Write to reach.me@benchmail.test {w}", "contains_email"), (f"Call 98765 43210 {w}", "contains_phone"),
                       (f"Ring +91-98765-43210 {w}", "contains_phone"), (f"Try 987.654.3210 {w}", "contains_phone")):
        assert assert_error(api.post(f"/api/channels/{channel['slug']}/posts", {"body": body}, s["author"]), 422, code)["field"] == "body"
    both = review_body(ids["c"], title="Call 98765 43210 now", cons="Mail me at reach.me@benchmail.test for detail")
    assert assert_error(api.post("/api/posts", both, s["writer"]), 422, "contains_email")["field"] == "cons"
    phone = review_body(ids["c"], pros="Ask for the lead on 98765 43210 any day")
    assert assert_error(api.post("/api/posts", phone, s["writer"]), 422, "contains_phone")["field"] == "pros"
    note = {"kind": "interview_note", "company_id": ids["c"], "role_family": "qc_analyst", "difficulty": 2, "outcome": "offer", "text": "Panel was kind, write reach.me@benchmail.test"}
    assert assert_error(api.post("/api/posts", note, s["writer"]), 422, "contains_email")["field"] == "text"
    assert my_posts(api, s["writer"]) == []
    listed = api.get(f"/api/channels/{channel['slug']}/posts", s["viewer"]).json()["posts"]
    assert [p["id"] for p in listed] == [post["id"]]
    seen = company_json(api, company["slug"], s["viewer"])
    assert all(set(rv) == REVIEW_KEYS and rv["author_label"] == ANON for rv in seen["reviews"])
    responses = [api.get(f"/api/companies/{company['slug']}", s["viewer"]), api.get(f"/api/companies/{company['slug']}/reviews/{ids['rv']}"),
                 api.get(f"/api/channels/{channel['slug']}/posts", s["viewer"]), api.get("/api/companies/search", params={"q": company["name"]}),
                 api.get("/api/moderation/queue", s["mod2"])]
    for r in responses:
        assert r.status_code == 200, r.text
        for secret in (author["display_name"], author["email"], mod1["display_name"], mod1["email"]):
            assert secret not in r.text, f"{r.request.url} carries an author identity"
    assert queue_item(api, s["mod1"], ids["own"]) is None
    assert_error(api.post(f"/api/moderation/{ids['own']}/claim", who=s["mod1"]), 404, "not_found")
    assert queue_item(api, s["mod2"], ids["own"]) is not None
    with opened(browser, app_url, f"/companies/{company['slug']}", s["viewer"]) as page:
        article = by_id(page, ids["rv"])
        eventually(page, lambda: ANON in texts(article) and month_year(seen["reviews"][0]["posted_month"]) in texts(article), "the review to show the anonymous label and its month")
        assert author["display_name"] not in page.content()


def test_wf_channels_live_post(app_url, browser):
    api = Api(app_url)
    w, w2 = word(), word()
    _, s = seed(app_url, users=[person("alice"), person("bobby")])
    path = f"/channels/{CHANNEL_SLUG}"
    with opened(browser, app_url, path, s["alice"]) as mine, opened(browser, app_url, path, s["bobby"]) as theirs:
        expect(mine.get_by_role("heading", name="Bench pay talk")).to_be_visible()
        composer = mine.get_by_role("textbox", name="Write a post")
        composer.focus()
        mine.keyboard.type(f"Line one {w}")
        mine.keyboard.press("Shift+Enter")
        mine.keyboard.type("line two")
        mine.keyboard.press("Enter")
        hear(mine, f"Posted in {CHANNEL_NAME}.")
        log = mine.get_by_role("log", name=f"Posts in {CHANNEL_NAME}")
        eventually(mine, lambda: w in texts(log.get_by_role("article").last), "the new post at the bottom of the log")
        assert composer.input_value() == ""
        expect(composer).to_be_focused()
        other_log = theirs.get_by_role("log", name=f"Posts in {CHANNEL_NAME}")
        arrived = other_log.get_by_role("article").filter(has_text=w)
        eventually(theirs, lambda: arrived.count() == 1 and ANON in texts(arrived), "the post live in the other window")
        hear(theirs, f"New post in {CHANNEL_NAME}")
        mine.keyboard.type(f"Text me on 98765 43210 {w2}")
        mine.keyboard.press("Enter")
        eventually(mine, lambda: MESSAGES["contains_phone"] in described(composer), "the phone refusal under the composer")
    posts = api.get(f"/api/channels/{CHANNEL_SLUG}/posts", s["bobby"]).json()["posts"]
    sent = [p for p in posts if w in p["body"]]
    assert len(sent) == 1 and sent[0]["body"] == f"Line one {w}\nline two" and sent[0]["author_label"] == ANON
    assert not any(w2 in p["body"] for p in posts)


def test_wf_channels_live_catch_up(app_url, browser):
    w = word()
    _, s = seed(app_url, users=[person("alice"), person("bobby")])
    path = f"/channels/{CHANNEL_SLUG}"
    with opened(browser, app_url, path, s["alice"]) as mine, opened(browser, app_url, path, s["bobby"]) as theirs:
        log = theirs.get_by_role("log", name=f"Posts in {CHANNEL_NAME}")
        expect(log).to_be_visible()
        first_word = word()
        opener = mine.get_by_role("textbox", name="Write a post")
        opener.focus()
        mine.keyboard.type(f"Primer {first_word}")
        mine.keyboard.press("Enter")
        hear(mine, f"Posted in {CHANNEL_NAME}.")
        primer = log.get_by_role("article").filter(has_text=first_word)
        eventually(theirs, lambda: primer.count() == 1, "the first post live in the window that is about to drop")
        theirs.evaluate("() => { window.__same_page = true; }")
        theirs.context.set_offline(True)
        closed = post_json(app_url, "/api/grading/live/close", {}, **{"X-Grading-Token": GRADING_TOKEN})
        assert closed.status_code == 200, closed.text
        composer = mine.get_by_role("textbox", name="Write a post")
        for n in (1, 2):
            composer.focus()
            mine.keyboard.type(f"Missed {n} {w}")
            mine.keyboard.press("Enter")
            hear(mine, f"Posted in {CHANNEL_NAME}.")
        missed = log.get_by_role("article").filter(has_text=w)
        assert missed.count() == 0, "a post reached the offline window"
        theirs.context.set_offline(False)
        eventually(theirs, lambda: missed.count() == 2, "both missed posts after the reconnect")
        bodies = missed.all_text_contents()
        assert f"Missed 1 {w}" in bodies[0] and f"Missed 2 {w}" in bodies[1] and all(ANON in b for b in bodies)
        hear(theirs, f"2 new posts in {CHANNEL_NAME}")
        assert theirs.evaluate("() => window.__same_page === true"), "the page reloaded instead of replaying"
        advance(theirs, STEP_MS)
        assert missed.count() == 2, "a replayed post appeared twice"


def test_wf_channels_live_quote_removed(app_url, browser):
    api = Api(app_url)
    now = clock(app_url)
    w = word()
    channel = {"key": "ch", "name": f"Probe {w.capitalize()} talk", "slug": f"probe-{w}-talk"}
    company = lab("c")
    title = f"Quoted bench {w}"
    ids, s = seed(app_url, companies=[company], channels=[channel], users=[person("author"), person("alice"), person("bobby")],
                  posts=[review("rv", "c", "author", iso(now), title=title, pros=LONG_PROS)])
    link = f"/companies/{company['slug']}/reviews/{ids['rv']}"
    with opened(browser, app_url, f"/channels/{channel['slug']}", s["alice"]) as page:
        page.get_by_role("textbox", name="Write a post").fill(f"Worth reading {link}")
        page.get_by_role("button", name="Post", exact=True).click()
        log = page.get_by_role("log", name=f"Posts in {channel['name']}")
        eventually(page, lambda: title in texts(log.get_by_role("article").last) and LONG_PROS[:EXCERPT_CHARS].strip() in texts(log.get_by_role("article").last), "the quote under the post")
    posts = api.get(f"/api/channels/{channel['slug']}/posts", s["bobby"]).json()["posts"]
    quoted = next(p for p in posts if link in p["body"])
    assert quoted["quote"] == {"review_id": ids["rv"], "company_slug": company["slug"], "title": title, "excerpt": LONG_PROS[:EXCERPT_CHARS]}
    assert api.delete(f"/api/posts/{ids['rv']}", s["author"]).status_code == 204
    posts = api.get(f"/api/channels/{channel['slug']}/posts", s["bobby"]).json()["posts"]
    assert next(p for p in posts if p["id"] == quoted["id"])["quote"] == {"removed": True}
    with opened(browser, app_url, f"/channels/{channel['slug']}", s["bobby"]) as page:
        article = by_id(page, quoted["id"])
        eventually(page, lambda: "Quoted review removed." in texts(article), "the removed-quote copy")
        assert title not in texts(article)
        response = page.goto(app_url.rstrip("/") + link)
        advance(page, STEP_MS)
        expect_not_found(page, response)


def test_outcomes_reach_author(app_url, browser, mail):
    api = Api(app_url)
    now = clock(app_url)
    company = lab("c")
    author = person("author")
    ids, s = seed(app_url, companies=[company], users=[author, person("mod", "moderator")],
                  posts=[review("rv", "c", "author", iso(now), state="pending"), pay_report("pay", "c", "author", iso(now), 455500, state="pending")])
    with opened(browser, app_url, "/me/contributions", s["author"]) as page:
        item = by_id(page, ids["rv"])
        assert api.post(f"/api/moderation/{ids['rv']}/claim", who=s["mod"]).status_code == 200
        eventually(page, lambda: "Claimed" in texts(item), "the review to read Claimed live")
        assert api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "approve"}, s["mod"]).status_code == 200
        eventually(page, lambda: "Approved" in texts(item), "the review to read Approved live")
        hear(page, f"Your review for {company['name']} was approved.")
        decide(api, ids["pay"], s["mod"], "reject", reason="Duplicate post")
        eventually(page, lambda: "Rejected: Duplicate post" in texts(by_id(page, ids["pay"])), "the pay report to read Rejected live")
        hear(page, f"Your pay report for {company['name']} was rejected: Duplicate post.")
    approved = exactly_once(app_url, mail, author["email"], "Your post on Candour Bench was approved")
    assert f"Your review for {company['name']} was approved." in text(approved)
    rejected = exactly_once(app_url, mail, author["email"], "Your post on Candour Bench was rejected")
    assert f"Your pay report for {company['name']} was rejected." in text(rejected) and "Reason: Duplicate post." in text(rejected)
    states = {p["id"]: p["state"] for p in my_posts(api, s["author"])}
    assert states[ids["rv"]] == "approved" and states[ids["pay"]] == "rejected"


def expect_not_found(page: Page, response: Any) -> None:
    assert response is not None and response.status == 404, f"the page answered {response and response.status}; expected HTTP 404"
    expect(page.get_by_role("heading", name="Page not found", exact=True)).to_be_visible()
    expect(page.get_by_role("link", name="Search lab jobs", exact=True)).to_be_visible()
    assert "It may have been removed, or the link is wrong." in page_text(page)


def queue_setup(app_url: str, *posts_spec: Callable[[str], dict[str, Any]], mods: int = 2) -> tuple[dict, dict, dict, list[dict]]:
    now = clock(app_url)
    old = now - timedelta(days=OLD_DAYS)
    company = lab("c")
    users = [person("author"), person("author2"), person("viewer", unlocked=True)] + [person(f"mod{i}", "moderator") for i in range(1, mods + 1)]
    posts = [spec(iso(old + timedelta(minutes=i))) for i, spec in enumerate(posts_spec)]
    ids, s = seed(app_url, companies=[company], users=users, posts=posts)
    return ids, s, company, users


def test_wf_moderation_live_keyboard_approve(app_url, browser):
    api = Api(app_url)
    w = word()
    ids, s, company, users = queue_setup(app_url,
                                         lambda at: review("ra", "c", "author", at, state="pending", title=f"First bench {w}", rating=(5, 4, 3, 2)),
                                         lambda at: review("rb", "c", "author2", at, state="pending", title=f"Second bench {w}"))
    m1 = users[3]
    with opened(browser, app_url, "/moderation", s["mod1"]) as p1, opened(browser, app_url, "/moderation", s["mod2"]) as p2:
        expect(p1.get_by_role("table", name="Moderation queue")).to_be_visible()
        claim_a = p1.get_by_role("button", name=f"Claim First bench {w}")
        tab_to(p1, claim_a)
        p1.keyboard.press("Enter")
        row1 = by_id(p1, ids["ra"])
        eventually(p1, lambda: "Claimed by you" in texts(row1), "the claimed row to read Claimed by you")
        expect(p1.get_by_role("radio", name="Approve")).to_be_focused()
        hear(p1, f"Claimed First bench {w}.")
        eventually(p2, lambda: f"Claimed by {m1['display_name']}" in texts(by_id(p2, ids["ra"])), "the other queue to show the claimant")
        p1.keyboard.press("Space")
        expect(p1.get_by_role("radio", name="Approve")).to_be_checked()
        seen = lambda: [x.strip() for x in p2.get_by_role("list", name=f"History of First bench {w}").get_by_role("listitem").all_text_contents()]
        history = [f"Claimed by {m1['display_name']}", f"Claim renewed by {m1['display_name']}"]
        eventually(p2, lambda: seen() == history, "the claim and its renewal in the other queue's history live")
        tab_to(p1, p1.get_by_role("button", name="Submit decision"))
        p1.keyboard.press("Enter")
        eventually(p1, lambda: "Approved by you" in texts(row1), "the row to read Approved by you")
        eventually(p2, lambda: seen() == history + [f"Approved by {m1['display_name']}"], "the approval in the other queue's history live")
        hear(p1, f"Approved First bench {w}.")
        expect(p1.get_by_role("button", name=f"Claim Second bench {w}")).to_be_focused()
        eventually(p2, lambda: f"Approved by {m1['display_name']}" in texts(by_id(p2, ids["ra"])), "the other queue to show the decision")
    assert queue_item(api, s["mod2"], ids["ra"]) is None
    rating = company_json(api, company["slug"], s["viewer"])["rating"]
    assert rating == {"overall": 5.0, "work_life": 4.0, "pay": 3.0, "management": 2.0, "review_count": 1}


def test_wf_moderation_live_keyboard_reject(app_url, browser):
    api = Api(app_url)
    ids, s, company, _ = queue_setup(app_url, lambda at: pay_report("pay", "c", "author", at, 466600, state="pending"))
    label = f"Pay report: QC Analyst at {company['name']}"
    details = "Mentions a named supervisor"
    with opened(browser, app_url, "/moderation", s["mod1"]) as page:
        tab_to(page, page.get_by_role("button", name=f"Claim {label}"))
        page.keyboard.press("Enter")
        expect(page.get_by_role("radio", name="Approve")).to_be_focused()
        page.keyboard.press("ArrowDown")
        expect(page.get_by_role("radio", name="Reject")).to_be_checked()
        reasons = page.get_by_role("radiogroup", name="Reason")
        expect(reasons).to_be_visible()
        page.keyboard.press("Tab")
        assert reasons.evaluate("g => g.contains(document.activeElement)"), "Tab from Decision did not enter Reason"
        tab_to(page, page.get_by_role("button", name="Submit decision"))
        page.keyboard.press("Enter")
        first = reasons.get_by_role("radio").first
        eventually(page, lambda: FIELD_COPY["reason"] in described(reasons) + described(first), "the reason error under Reason")
        expect(first).to_be_focused()
        for _ in range(4):
            page.keyboard.press("ArrowDown")
        expect(reasons.get_by_role("radio", name="Other")).to_be_checked()
        tab_to(page, page.get_by_role("textbox", name="Reason details"))
        page.keyboard.type(details)
        tab_to(page, page.get_by_role("button", name="Submit decision"))
        page.keyboard.press("Enter")
        eventually(page, lambda: "Rejected by you" in texts(by_id(page, ids["pay"])), "the row to read Rejected by you")
        hear(page, f"Rejected {label}.")
    assert next(p for p in my_posts(api, s["author"]) if p["id"] == ids["pay"])["state"] == "rejected"
    with opened(browser, app_url, "/me/contributions", s["author"]) as mine:
        eventually(mine, lambda: f"Rejected: {details}" in texts(by_id(mine, ids["pay"])), "the author to see the typed reason")


def test_first_claim_wins(app_url):
    api = Api(app_url)
    now = clock(app_url)
    mods = [person(f"mod{i}", "moderator") for i in range(CONCURRENT)]
    company = lab("c")
    ids, s = seed(app_url, companies=[company], users=mods + [person("author"), person("author2"), person("member"), person("viewer", unlocked=True)],
                  posts=[review("rv", "c", "author", iso(now), state="pending"), review("rv2", "c", "author2", iso(now), state="pending")])
    gate = threading.Barrier(CONCURRENT)

    def go(key: str) -> tuple[str, httpx.Response]:
        gate.wait()
        return key, api.post(f"/api/moderation/{ids['rv']}/claim", who=s[key])

    with ThreadPoolExecutor(CONCURRENT) as pool:
        results = list(pool.map(go, [m["key"] for m in mods]))
    wins = [(k, r) for k, r in results if r.status_code == 200]
    assert len(wins) == 1, [r.status_code for _, r in results]
    winner_key, win = wins[0]
    winner = next(m["display_name"] for m in mods if m["key"] == winner_key)
    assert win.json() == {"id": ids["rv"], "state": "claimed", "claimed_by_name": winner}
    for key, r in results:
        if key != winner_key:
            assert_error(r, 409, "already_claimed", f"Already claimed by {winner}.")
    loser = next(k for k, _ in results if k != winner_key)
    assert queue_item(api, s[loser], ids["rv"])["claimed_by_name"] == winner
    assert_error(api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "approve"}, s[loser]), 409, "already_claimed", f"Already claimed by {winner}.")
    assert_fields(api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "reject"}, s[winner_key]), "reason")
    assert_fields(api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "reject", "reason": "Other"}, s[winner_key]), "details")
    done = api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "approve"}, s[winner_key])
    assert done.status_code == 200 and done.json() == {"id": ids["rv"], "state": "approved", "decided_by_name": winner}
    for who in (loser, winner_key):
        assert_error(api.post(f"/api/moderation/{ids['rv']}/claim", who=s[who]), 409, "already_decided", f"Already approved by {winner}.")
    assert_error(api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "reject", "reason": "Duplicate post"}, s[loser]), 409, "already_decided", f"Already approved by {winner}.")
    assert company_json(api, company["slug"], s["viewer"])["rating"]["review_count"] == 1
    assert_error(api.post(f"/api/moderation/{ids['rv2']}/decision", {"decision": "approve"}, s[loser]), 409, "not_claimed")
    assert_error(api.post(f"/api/moderation/{ids['rv2']}/claim", who=s["member"]), 404, "not_found")


def test_claims_lapse(app_url, browser):
    api = Api(app_url)
    ids, s, _, users = queue_setup(app_url, lambda at: review("rv", "c", "author", at, state="pending"))
    m1 = users[3]
    with opened(browser, app_url, "/moderation", s["mod2"]) as page:
        row = by_id(page, ids["rv"])
        eventually(page, lambda: "Pending" in texts(row), "the queue row to render")
        live_ready(page)
        assert api.post(f"/api/moderation/{ids['rv']}/claim", who=s["mod1"]).status_code == 200
        clock(app_url, CLAIM_LAPSE_SECONDS - MARGIN_SECONDS)
        again = api.post(f"/api/moderation/{ids['rv']}/claim", who=s["mod1"])
        assert again.status_code == 200 and again.json()["state"] == "claimed"
        assert queue_item(api, s["mod2"], ids["rv"])["state"] == "claimed"
        eventually(page, lambda: f"Claimed by {m1['display_name']}" in texts(row), "the row to show the claimant")
        clock(app_url, MARGIN_SECONDS)
        lapsed = queue_item(api, s["mod2"], ids["rv"])
        assert lapsed["state"] == "pending" and lapsed["claimed_by_name"] is None
        eventually(page, lambda: "Pending" in texts(row) and "Claim expired" in texts(row), "the row to return to Pending live")
    assert_error(api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "approve"}, s["mod1"]), 409, "claim_expired")
    assert_error(api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "approve"}, s["mod2"]), 409, "not_claimed")
    assert api.post(f"/api/moderation/{ids['rv']}/claim", who=s["mod2"]).status_code == 200


def stale_press(app_url: str, browser: Browser, decide_first: bool) -> None:
    api = Api(app_url)
    w = word()
    ids, s, company, users = queue_setup(app_url, lambda at: review("rv", "c", "author", at, state="pending", title=f"Stale bench {w}"))
    m1 = users[3]
    with opened(browser, app_url, "/moderation", s["mod2"]) as page:
        button = page.get_by_role("button", name=f"Claim Stale bench {w}")
        tab_to(page, button)
        with held(page, "**/api/moderation/*/claim") as gate:
            page.keyboard.press("Enter")
            assert api.post(f"/api/moderation/{ids['rv']}/claim", who=s["mod1"]).status_code == 200
            if decide_first:
                assert api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "approve"}, s["mod1"]).status_code == 200
            gate.release()
        copy = f"Already approved by {m1['display_name']}." if decide_first else f"Already claimed by {m1['display_name']}."
        eventually(page, lambda: copy in texts(page.get_by_role("alert")), f"the conflict alert {copy!r}")
        row = by_id(page, ids["rv"])
        status = f"Approved by {m1['display_name']}" if decide_first else f"Claimed by {m1['display_name']}"
        eventually(page, lambda: status in texts(row), f"the row status {status!r} live")
        if decide_first:
            reload(page)
            eventually(page, lambda: by_id(page, ids["rv"]).count() == 0, "the decided post gone from the queue after reload")
        else:
            m2 = users[4]
            with opened(browser, app_url, "/moderation", s["mod1"]) as winner:
                expect(winner.get_by_role("table", name="Moderation queue")).to_be_visible()
                clock(app_url, CLAIM_LAPSE_SECONDS)
                eventually(page, lambda: "Pending" in texts(row) and "Claim expired" in texts(row), "the lapsed claim back to Pending live")
                eventually(winner, lambda: "Pending" in texts(by_id(winner, ids["rv"])), "the lapse live in the winner's queue")
                tab_to(page, button)
                page.keyboard.press("Enter")
                eventually(page, lambda: "Claimed by you" in texts(row), "the claimed row to read Claimed by you")
                expect(page.get_by_role("radio", name="Approve")).to_be_focused()
                hear(page, f"Claimed Stale bench {w}.")
                eventually(winner, lambda: f"Claimed by {m2['display_name']}" in texts(by_id(winner, ids["rv"])), "the new claimant live in the other queue")
            assert queue_item(api, s["mod1"], ids["rv"])["claimed_by_name"] == m2["display_name"]
            return
    state = queue_item(api, s["mod1"], ids["rv"])
    if decide_first:
        assert state is None
        rating = company_json(api, company["slug"], s["viewer"])["rating"]
        assert rating["review_count"] == 1
    else:
        assert state["state"] == "claimed" and state["claimed_by_name"] == m1["display_name"]


def test_wf_claim_conflict_stale_claim(app_url, browser):
    stale_press(app_url, browser, decide_first=False)


def test_wf_claim_conflict_phone_queue(app_url, browser):
    api = Api(app_url)
    w = word()
    ids, s, company, users = queue_setup(app_url,
                                         lambda at: review("ra", "c", "author", at, state="pending", title=f"Taken bench {w}"),
                                         lambda at: review("rb", "c", "author2", at, state="pending", title=f"Phone bench {w}"))
    m1, m2 = users[3], users[4]
    width = VIEWPORTS["phone"]["width"]
    with opened(browser, app_url, "/moderation", s["mod1"], size="phone") as page, opened(browser, app_url, "/moderation", s["mod2"]) as other:
        table = page.get_by_role("table", name="Moderation queue")
        expect(table).to_be_visible()
        for name in ("Type", "Summary", "Status"):
            expect(table.get_by_role("columnheader", name=name, exact=True)).to_be_visible()
        for name in ("Company", "Posted"):
            expect(table.get_by_role("columnheader", name=name, exact=True)).to_be_hidden()
        assert page.evaluate("() => document.documentElement.scrollWidth") <= width + 1, "the phone queue scrolls sideways"
        taken = page.get_by_role("button", name=f"Claim Taken bench {w}")
        tab_to(page, taken)
        with held(page, "**/api/moderation/*/claim") as gate:
            page.keyboard.press("Enter")
            assert api.post(f"/api/moderation/{ids['ra']}/claim", who=s["mod2"]).status_code == 200
            gate.release()
        eventually(page, lambda: f"Already claimed by {m2['display_name']}." in texts(page.get_by_role("alert")), "the conflict alert on the phone")
        claim = page.get_by_role("button", name=f"Claim Phone bench {w}")
        tab_to(page, claim)
        page.keyboard.press("Enter")
        row = by_id(page, ids["rb"])
        eventually(page, lambda: "Claimed by you" in texts(row), "the phone row to read Claimed by you")
        expect(page.get_by_role("radio", name="Approve")).to_be_focused()
        status = row.get_by_text("Claimed by you").first
        decision = page.get_by_role("radiogroup", name="Decision")
        assert rect(decision)["top"] >= rect(status)["bottom"] - SPLIT_PX, "the claimed detail does not open below its row"
        spans = decision.evaluate("g => { let e = g; for (let i = 0; i < 4 && e; i++, e = e.parentElement) {"
                                  " const r = e.getBoundingClientRect(); if (r.width >= 0.85 * innerWidth) return r.width; } return 0; }")
        assert spans >= width * 0.85, "the claimed detail is not full width"
        eventually(other, lambda: f"Claimed by {m1['display_name']}" in texts(by_id(other, ids["rb"])), "the phone claim live in the desktop queue")
    assert queue_item(api, s["mod2"], ids["rb"])["claimed_by_name"] == m1["display_name"]


def test_wf_claim_conflict_lease_history(app_url, browser):
    api = Api(app_url)
    w = word()
    label = f"Lease bench {w}"
    ids, s, _, users = queue_setup(app_url, lambda at: review("rv", "c", "author", at, state="pending", title=label))
    m1 = users[3]
    claimed, renewed = f"Claimed by {m1['display_name']}", f"Claim renewed by {m1['display_name']}"
    with opened(browser, app_url, "/moderation", s["mod1"]) as mine, opened(browser, app_url, "/moderation", s["mod2"]) as theirs:
        items = lambda page: [x.strip() for x in page.get_by_role("list", name=f"History of {label}").get_by_role("listitem").all_text_contents()]
        claim = mine.get_by_role("button", name=f"Claim {label}")
        tab_to(mine, claim)
        mine.keyboard.press("Enter")
        approve = mine.get_by_role("radio", name="Approve")
        expect(approve).to_be_focused()
        hear(mine, f"Claimed {label}.")
        mine.keyboard.press("Space")
        expect(approve).to_be_checked()
        for page in (mine, theirs):
            eventually(page, lambda p=page: items(p) == [claimed, renewed], "the claim and its renewal in the history list live")
        clock(app_url, CLAIM_LAPSE_SECONDS)
        for page in (mine, theirs):
            eventually(page, lambda p=page: items(p) == [claimed, renewed, "Claim expired"], "Claim expired in the history list live")
        eventually(mine, lambda: MESSAGES["claim_expired"] in texts(mine.get_by_role("alert")), "the lease-ended alert")
        expect(claim).to_be_visible()
        expect(mine.get_by_role("button", name="Submit decision")).to_be_hidden()
        eventually(theirs, lambda: "Pending" in texts(by_id(theirs, ids["rv"])), "the post back to Pending in the other queue")
    assert_error(api.post(f"/api/moderation/{ids['rv']}/decision", {"decision": "approve"}, s["mod1"]), 409, "claim_expired")
    assert_error(api.post(f"/api/moderation/{ids['rv']}/renew", who=s["mod1"]), 409, "claim_expired")
    events = api.get(f"/api/moderation/{ids['rv']}/history", s["mod2"]).json()["events"]
    assert [e["type"] for e in events] == ["claimed", "renewed", "expired"], events
    assert events[0]["by_name"] == m1["display_name"] and events[2]["by_name"] is None


def test_wf_claim_conflict_stale_decision(app_url, browser):
    stale_press(app_url, browser, decide_first=True)


def test_rating_averages(app_url, browser, meilisearch):
    api = Api(app_url)
    now = clock(app_url)
    company, empty = lab("c"), lab("e")
    ratings = [(4, 3, 1, 5), (5, 3, 2, 5), (4, 4, 2, 5), (4, 4, 2, 4)]
    posts = [review(f"r{i}", "c", f"a{i}", iso(now), rating=r) for i, r in enumerate(ratings)]
    posts += [review("pend", "c", "a8", iso(now), state="pending", rating=(1, 1, 1, 1)),
              review("rej", "c", "a9", iso(now), state="rejected", decided_by="mod", reason="Duplicate post", rating=(1, 1, 1, 1))]
    users = [person(f"a{i}") for i in (0, 1, 2, 3, 8, 9)] + [person("mod", "moderator"), person("viewer", unlocked=True)]
    ids, s = seed(app_url, companies=[company, empty], users=users, posts=posts)

    def expected(rows: list[tuple[int, int, int, int]]) -> dict[str, Any]:
        cols = list(zip(*rows))
        return {"overall": mean_one_decimal(list(cols[0])), "work_life": mean_one_decimal(list(cols[1])), "pay": mean_one_decimal(list(cols[2])),
                "management": mean_one_decimal(list(cols[3])), "review_count": len(rows)}

    def agree(rows: list[tuple[int, int, int, int]]) -> None:
        want = expected(rows)
        assert company_json(api, company["slug"], s["viewer"])["rating"] == want
        hit = next(h for h in api.get("/api/companies/search", params={"q": company["name"]}).json()["hits"] if h["slug"] == company["slug"])
        assert (hit["rating"], hit["review_count"]) == (want["overall"], want["review_count"])
        meilisearch.settled()
        doc = meilisearch.document("companies", ids["c"])
        assert (doc["rating"], doc["review_count"]) == (want["overall"], want["review_count"])

    agree(ratings)
    assert company_json(api, empty["slug"])["rating"] == {"overall": None, "work_life": None, "pay": None, "management": None, "review_count": 0}
    with opened(browser, app_url, f"/companies/{empty['slug']}", s["viewer"]) as page:
        eventually(page, lambda: "No ratings yet" in page_text(page), "No ratings yet on a company without reviews")
        decide(api, ids["pend"], s["mod"])
        agree(ratings + [(1, 1, 1, 1)])
        page.goto(app_url.rstrip("/") + f"/companies/{company['slug']}")
        want = expected(ratings + [(1, 1, 1, 1)])
        eventually(page, lambda: f"{want['overall']:.1f}" in page_text(page) and f"{want['review_count']} reviews" in page_text(page)
                   and f"{want['management']:.1f}" in page_text(page), "the recomputed rating after reload")


def test_pay_ranges_behind_threshold(app_url, browser, meilisearch):
    api = Api(app_url)
    now = clock(app_url)
    under, open_ = lab("u"), lab("o")
    low_values = [431007, 452009, 473011, 494013]
    open_values = [300000, 400000, 400001, 400002, 400004, 500000]
    posts = [pay_report(f"u{i}", "u", "author", iso(now), v) for i, v in enumerate(low_values)]
    posts += [pay_report("upend", "u", "author", iso(now), 515017, state="pending")]
    posts += [pay_report(f"o{i}", "o", "author", iso(now), v) for i, v in enumerate(open_values)]
    posts += [pay_report("opend", "o", "author", iso(now), 4999999, state="pending"),
              pay_report("orej", "o", "author", iso(now), 100000, state="rejected", decided_by="mod", reason="Duplicate post")]
    ids, s = seed(app_url, companies=[under, open_], posts=posts,
                  users=[person("author"), person("mod", "moderator"), person("viewer", unlocked=True), person("locked"), person("founder", "founder")])
    row = pay_row(company_json(api, under["slug"], s["viewer"]), "qc_analyst", "harrowgate")
    assert set(row) == PAY_ROW_KEYS and (row["report_count"], row["threshold"], row["band"]) == (len(low_values), MIN_PAY_REPORTS, None)
    opened_row = pay_row(company_json(api, open_["slug"], s["viewer"]), "qc_analyst", "harrowgate")
    assert opened_row["report_count"] == len(open_values) and opened_row["band"] == band_for(open_values)
    for who in (s["locked"], None):
        r = api.get(f"/api/companies/{open_['slug']}", who)
        assert pay_row(r.json(), "qc_analyst", "harrowgate")["band"] is None
        assert all(str(v) not in r.text for v in band_for(open_values).values() if v != 400000)
    leaks = [api.get(f"/api/companies/{under['slug']}", s["viewer"]).text, api.get("/api/companies/search", params={"q": under["name"]}).text,
             api.get("/api/founder/thresholds", s["founder"]).text]
    meilisearch.settled()
    leaks.append(json.dumps(meilisearch.document("companies", ids["u"])))
    for blob in leaks:
        assert not any(str(v) in blob or rupees(v) in blob for v in low_values), "an under-threshold figure left the server"
    hits = {h["slug"]: h for h in api.get("/api/companies/search", params={"q": "Probe"}).json()["hits"] + api.get("/api/companies/search", params={"q": under["name"]}).json()["hits"] + api.get("/api/companies/search", params={"q": open_["name"]}).json()["hits"]}
    assert hits[under["slug"]]["pay_report_count"] == len(low_values) and hits[open_["slug"]]["pay_report_count"] == len(open_values)
    assert meilisearch.document("companies", ids["o"])["pay_report_count"] == len(open_values)
    seeds = {"fernhollow-assay-labs": (11, "₹5,45,000", "₹6,00,000", "₹6,70,000"), "larkspur-core-facility": (6, "₹5,70,000", "₹6,20,000", "₹6,85,000")}
    for slug, (count, low, median, high) in seeds.items():
        seeded = company_json(api, slug, s["viewer"])["pay_rows"][0]
        assert seeded["report_count"] == count and seeded["band"] == {"low": from_rupees(low), "median": from_rupees(median), "high": from_rupees(high)}
    thistle = company_json(api, "thistlecombe-biologics", s["viewer"])["pay_rows"][0]
    assert thistle["report_count"] == 3 and thistle["band"] is None
    with opened(browser, app_url, f"/companies/{under['slug']}", s["viewer"]) as page:
        cell = by_id(page, "qc_analyst:harrowgate")
        eventually(page, lambda: f"{len(low_values)} of {MIN_PAY_REPORTS} reports. The range opens at {MIN_PAY_REPORTS}." in texts(cell), "the under-threshold count sentence")
        assert not any(rupees(v) in page.content() for v in low_values)


def band_world(app_url: str, extra_open_row: bool = False, fifth_state: str = "claimed") -> tuple[dict, dict, dict, list[int]]:
    now = clock(app_url)
    company = lab("c")
    values = [470100, 495300, 520700, 548900]
    posts = [pay_report(f"p{i}", "c", "author", iso(now), v) for i, v in enumerate(values)]
    fifth_at = iso(now) if fifth_state == "claimed" else iso(now - timedelta(days=OLD_DAYS))
    posts.append(pay_report("fifth", "c", "author", fifth_at, 571500, state=fifth_state, **({"claimed_by": "mod"} if fifth_state == "claimed" else {})))
    posts += [review(f"r{i}", "c", f"a{i}", iso(now), pros=LONG_PROS) for i in range(3)]
    posts += [{"key": f"n{i}", "kind": "interview_note", "company": "c", "author": "author", "state": "approved", "created_at": iso(now),
               "role_family": "qc_analyst", "difficulty": 3, "outcome": "offer", "text": NOTE_TEXT * 12} for i in range(12)]
    if extra_open_row:
        posts += [pay_report(f"m{i}", "c", "author", iso(now), 700000 + i * 10000, role="lab_manager") for i in range(MIN_PAY_REPORTS)]
    ids, s = seed(app_url, companies=[company], posts=posts,
                  users=[person("author"), person("mod", "moderator"), person("viewer", unlocked=True)] + [person(f"a{i}") for i in range(3)])
    return ids, s, company, values + [571500]


def test_wf_band_resolve_live(app_url, browser):
    api = Api(app_url)
    ids, s, company, values = band_world(app_url, fifth_state="pending")
    band = band_for(values)
    with opened(browser, app_url, f"/companies/{company['slug']}", s["viewer"]) as page:
        row = by_id(page, "qc_analyst:harrowgate")
        tile = page.locator("[data-band]")
        eventually(page, lambda: "4 of 5 reports. The range opens at 5." in texts(row), "the under-threshold row")
        centre_in_view(row)
        eventually(page, lambda: attr(tile, "data-band") == "qc_analyst:harrowgate", "the tile to follow the pay row")
        advance(page, BAND_CROSSFADE_MS)
        hatch = motion_of(page, "band-unhatch") or {}
        assert hatch.get("state") == "covered" and hatch.get("ms") == str(BAND_UNHATCH_MS)
        assert "4 of 5 reports. The range opens at 5." in texts(tile)
        assert not any(rupees(v) in page.content() or str(v) in page.content() for v in list(band.values()) + values)
        label = f"Pay report: QC Analyst at {company['name']}"
        with opened(browser, app_url, "/moderation", s["mod"]) as mod:
            claim = mod.get_by_role("button", name=f"Claim {label}", exact=True)
            tab_to(mod, claim)
            mod.keyboard.press("Enter")
            mrow = by_id(mod, ids["fifth"])
            eventually(mod, lambda: "Claimed by you" in texts(mrow), "the moderator's row to read Claimed by you")
            approve = mod.get_by_role("radio", name="Approve")
            expect(approve).to_be_focused()
            mod.keyboard.press("Space")
            expect(approve).to_be_checked()
            tab_to(mod, mod.get_by_role("button", name="Submit decision"))
            mod.keyboard.press("Enter")
            eventually(mod, lambda: "Approved by you" in texts(mrow), "the moderator's row to read Approved by you")
            hear(mod, f"Approved {label}.")
        expect(row).to_contain_text(f"{len(values)} reports", timeout=LIVE_SECONDS * 1000)
        phase = lambda name: (motion_of(page, name) or {}).get("state")
        eventually(page, lambda: phase("band-unhatch") == "running", "band-unhatch running")
        advance(page, BAND_UNHATCH_MS)
        eventually(page, lambda: phase("band-unhatch") == "done", "band-unhatch done")
        eventually(page, lambda: phase("band-count") == "running", "band-count running")
        assert (motion_of(page, "band-count") or {}).get("ms") == str(BAND_COUNT_MS)
        advance(page, BAND_COUNT_MS)
        eventually(page, lambda: phase("band-count") == "done", "band-count done")
        hear(page, "Pay range now shown for QC Analyst")
        for figure in (rupees(band["low"]), rupees(band["high"]), f"Median {rupees(band['median'])}"):
            expect(tile).to_contain_text(figure)
        expect(page.locator('[data-part="median-tick"]').first).to_be_attached()
    assert pay_row(company_json(api, company["slug"], s["viewer"]), "qc_analyst", "harrowgate")["band"] == band


def test_wf_band_resolve_reduced_motion(app_url, browser):
    api = Api(app_url)
    ids, s, company, values = band_world(app_url)
    band = band_for(values)
    with opened(browser, app_url, f"/companies/{company['slug']}", s["viewer"], reduced=True) as page:
        row = by_id(page, "qc_analyst:harrowgate")
        tile = page.locator("[data-band]")
        eventually(page, lambda: "4 of 5 reports" in texts(row), "the under-threshold row")
        centre_in_view(row)
        eventually(page, lambda: attr(tile, "data-band") == "qc_analyst:harrowgate", "the tile to follow the pay row")
        assert attr(tile, "data-motion-ms") == "0"
        assert api.post(f"/api/moderation/{ids['fifth']}/decision", {"decision": "approve"}, s["mod"]).status_code == 200
        expect(tile).to_contain_text(f"Median {rupees(band['median'])}", timeout=LIVE_SECONDS * 1000)
        for name in ("band-unhatch", "band-count"):
            m = motion_of(page, name)
            assert m is None or m["state"] == "done", f"{name} state is {m}"
        hear(page, "Pay range now shown for QC Analyst")


def test_wf_band_resolve_scroll_both_ways(app_url, browser):
    _, s, company, _ = band_world(app_url, extra_open_row=True)
    with opened(browser, app_url, f"/companies/{company['slug']}", s["viewer"]) as page:
        tile = page.locator("[data-band]")
        heading = page.get_by_role("heading", name=company["name"], exact=True)
        expect(page.get_by_role("figure", name=f"{company['name']}, Harrowgate. 3 reviews")).to_be_visible()
        assert attr(tile, "data-band") == "none"
        for key in ("qc_analyst:harrowgate", "lab_manager:harrowgate", "qc_analyst:harrowgate"):
            centre_in_view(by_id(page, key))
            eventually(page, lambda: attr(tile, "data-band") == key, f"data-band {key}")
            assert attr(tile, "data-state") in ("running", "done")
            advance(page, BAND_CROSSFADE_MS)
            expect(tile).to_have_attribute("data-state", "done")
        heading.evaluate("e => e.scrollIntoView({block: 'start'})")
        page.evaluate("() => window.scrollTo(0, 0)")
        eventually(page, lambda: attr(tile, "data-band") == "none", "data-band none above the first row")


def code_from(base: str, mail: Any, to: str) -> tuple[str, int]:
    message = await_mail(base, mail, to, "Your Candour Bench verification code")[0]
    found = re.search(r"Your code is (\d{6})\. It expires in (\d+) minutes\.", text(message))
    assert found, "verification email lacks the published code sentence"
    return found.group(1), int(found.group(2))


def test_employer_verification_code(app_url, mail, meilisearch):
    api = Api(app_url)
    c1, c2, c3 = lab("c1", verified=False), lab("c2", verified=False), lab("c3", verified=False)
    ids, s = seed(app_url, companies=[c1, c2, c3], users=[person("admin", "employer_admin", "c1"), person("rec", "recruiter", "c1"),
                                                          person("admin2", "employer_admin", "c2"), person("admin3", "employer_admin", "c3")])
    req = lambda who, email: api.post("/api/employer/verification/request", {"email": email}, s[who])
    at = lambda c, n: f"{n}.{word(4)}@{c['email_domain']}"
    assert_error(req("rec", at(c1, "r")), 403, "forbidden")
    first, second, third, fourth = at(c1, "a"), at(c1, "b"), at(c1, "c"), at(c1, "d")
    r = req("admin", first)
    assert r.status_code == 202 and r.json() == {"status": "queued"}
    code1, minutes = code_from(app_url, mail, first)
    assert minutes == math.ceil(EMAIL_CODE_TTL_SECONDS / 60)
    assert req("admin", second).status_code == 202
    code2, _ = code_from(app_url, mail, second)
    if code1 != code2:
        assert_error(api.post("/api/employer/verification/confirm", {"code": code1}, s["admin"]), 422, "code_invalid")
    assert req("admin", third).status_code == 202
    code3, _ = code_from(app_url, mail, third)
    limited = req("admin", fourth)
    assert_error(limited, 429, "rate_limited")
    assert limited.headers.get("Retry-After", "").isdigit()
    wrong = next(c for c in ("123456", "654321") if c != code3)
    assert_error(api.post("/api/employer/verification/confirm", {"code": wrong}, s["admin"]), 422, "code_invalid")
    ok = api.post("/api/employer/verification/confirm", {"code": code3}, s["admin"])
    assert ok.status_code == 200 and ok.json() == {"verified": True}
    assert company_json(api, c1["slug"])["verified"] is True
    meilisearch.settled()
    assert meilisearch.document("companies", ids["c1"])["verified"] is True
    assert mails_to(mail, fourth) == []
    bad = assert_error(req("admin2", "x@other.test"), 422, "validation_failed")
    assert bad["fields"]["email"] == f"Use an address at {c2['email_domain']}."
    mail_e, mail_f = at(c2, "e"), at(c3, "f")
    assert req("admin2", mail_e).status_code == 202
    code_e, _ = code_from(app_url, mail, mail_e)
    assert req("admin3", mail_f).status_code == 202
    code_f, _ = code_from(app_url, mail, mail_f)
    clock(app_url, EMAIL_CODE_TTL_SECONDS - MARGIN_SECONDS)
    assert api.post("/api/employer/verification/confirm", {"code": code_f}, s["admin3"]).status_code == 200
    clock(app_url, MARGIN_SECONDS)
    assert_error(api.post("/api/employer/verification/confirm", {"code": code_e}, s["admin2"]), 422, "code_expired")
    assert company_json(api, c2["slug"])["verified"] is False


def test_wf_employer_verify_reply_happy(app_url, browser, mail):
    api = Api(app_url)
    now = clock(app_url)
    company = lab("c", verified=False)
    title = f"Reply bench {word(5)}"
    ids, s = seed(app_url, companies=[company], users=[person("admin", "employer_admin", "c"), person("author"), person("reader", unlocked=True)],
                  posts=[review("rv", "c", "author", iso(now), title=title)])
    work = f"team.{word(4)}@{company['email_domain']}"
    with opened(browser, app_url, "/employer", s["admin"]) as page, opened(browser, app_url, f"/companies/{company['slug']}", s["reader"]) as reader:
        page.get_by_role("textbox", name="Work email").fill(work)
        page.get_by_role("button", name="Send code").click()
        hear(page, f"A code is on its way to {work}.")
        code, _ = code_from(app_url, mail, work)
        page.get_by_role("textbox", name="Verification code").fill(code)
        page.get_by_role("button", name="Verify").click()
        hear(page, "Your team is verified.")
        eventually(page, lambda: "Verified employer" in page_text(page), "Verified employer on the employer home")
        assert company_json(api, company["slug"])["verified"] is True
        page.goto(app_url.rstrip("/") + f"/companies/{company['slug']}")
        listen(page)
        page.get_by_role("button", name=f"Reply to {title}").click()
        page.get_by_role("textbox", name="Your public reply").fill(REPLY_BODY)
        page.get_by_role("button", name="Post reply").click()
        hear(page, "Reply posted.")
        reply = company_json(api, company["slug"], s["reader"])["reviews"][0]["reply"]
        assert reply == {"company_name": company["name"], "body": REPLY_BODY, "posted_month": reply["posted_month"]}
        region = reader.get_by_role("region", name=f"Response from {company['name']}")
        eventually(reader, lambda: f"{company['name']} replied in {month_year(reply['posted_month'])}" in texts(region) and REPLY_BODY in texts(region), "the reply live under the review")
        expect(page.get_by_role("button", name=f"Reply to {title}")).to_have_count(0)
        assert_error(api.post(f"/api/employer/reviews/{ids['rv']}/reply", {"body": REPLY_BODY}, s["admin"]), 409, "already_replied")
        assert api.delete(f"/api/posts/{ids['rv']}", s["author"]).status_code == 204
        response = reader.goto(app_url.rstrip("/") + f"/companies/{company['slug']}/reviews/{ids['rv']}")
        advance(reader, STEP_MS)
        expect_not_found(reader, response)


def test_wf_employer_verify_reply_other_company(app_url, browser):
    api = Api(app_url)
    now = clock(app_url)
    mine, other, unverified = lab("c"), lab("d"), lab("u", verified=False)
    title = f"Cross bench {word(5)}"
    replier = person("rec", "recruiter", "c")
    ids, s = seed(app_url, companies=[mine, other, unverified], users=[replier, person("x", "recruiter", "d"), person("ux", "recruiter", "u"), person("author")],
                  posts=[review("rv", "c", "author", iso(now), title=title), review("urv", "u", "author", iso(now))])
    with opened(browser, app_url, f"/companies/{mine['slug']}", s["x"]) as page:
        eventually(page, lambda: title in page_text(page), "the review on the company page")
        expect(page.get_by_role("button", name=f"Reply to {title}")).to_have_count(0)
    assert_error(api.post(f"/api/employer/reviews/{ids['rv']}/reply", {"body": REPLY_BODY}, s["x"]), 404, "not_found")
    assert company_json(api, mine["slug"])["reviews"][0]["reply"] is None
    assert_error(api.post(f"/api/employer/reviews/{ids['urv']}/reply", {"body": REPLY_BODY}, s["ux"]), 403, "not_verified")
    assert assert_error(api.post(f"/api/employer/reviews/{ids['rv']}/reply", {"body": "Call our desk on 98765 43210 today"}, s["rec"]), 422, "contains_phone")["field"] == "body"
    r = api.post(f"/api/employer/reviews/{ids['rv']}/reply", {"body": REPLY_BODY}, s["rec"])
    assert r.status_code == 201 and {"review_id", "company_name", "body", "posted_month"} <= set(r.json()), r.text
    seen = api.get(f"/api/companies/{mine['slug']}")
    assert set(seen.json()["reviews"][0]["reply"]) == {"company_name", "body", "posted_month"}
    assert replier["display_name"] not in seen.text and replier["email"] not in seen.text


def search_world(app_url: str) -> tuple[dict, dict, dict, str, list[dict]]:
    now = clock(app_url)
    w = word()
    company = lab("c")
    company["name"] = f"Probe {w.capitalize()} Assay"
    specs = [job("j1", "c", f"QC Analyst {w}", iso(now - timedelta(hours=4))),
             job("j2", "c", f"Senior QC Analyst {w}", iso(now - timedelta(hours=3)), remote="remote", low=650000, high=700000),
             job("j3", "c", f"Research Assistant {w}", iso(now - timedelta(hours=2)), city="kelvane", role="research_assistant", remote="hybrid", low=399999, high=420000),
             job("j4", "c", f"Bench Lead {w}", iso(now - timedelta(hours=1)), city="kelvane", role="lab_manager", low=400000, high=480000),
             job("j5", "c", f"Draft Tech {w}", iso(now), status="draft"),
             job("j6", "c", f"Closed Tech {w}", iso(now), status="closed")]
    ids, s = seed(app_url, companies=[company], users=[person("member"), person("author"), person("viewer", unlocked=True)], jobs=specs,
                  posts=[review("rv", "c", "author", iso(now), rating=(4, 4, 4, 4)), review("pend", "c", "author", iso(now), state="pending")])
    return ids, s, company, w, specs


def test_job_and_company_search(app_url, meilisearch):
    api = Api(app_url)
    ids, s, company, w, specs = search_world(app_url)
    listed = [j for j in specs if j["status"] == "listed"]
    typo = w[:3] + w[4:]
    for q in (w, typo):
        body = api.get("/api/jobs/search", params={"q": q}).json()
        assert {h["id"] for h in body["hits"]} == {ids[j["key"]] for j in listed}, f"q={q}"
        assert body["total"] == len(listed)
    body = api.get("/api/jobs/search", params={"q": w}).json()
    assert all(JOB_SUMMARY_KEYS <= set(h) for h in body["hits"])
    for j in listed:
        hit = next(h for h in body["hits"] if h["id"] == ids[j["key"]])
        assert hit["pay_band"] == band_of(j["pay_low"]) and hit["city_name"] == CITY_NAMES[j["city"]]
    for facet, field in (("city", "city"), ("role_family", "role_family"), ("remote", "remote"), ("pay_band", None)):
        want: dict[str, int] = {}
        for j in listed:
            value = j[field] if field else band_of(j["pay_low"])
            want[value] = want.get(value, 0) + 1
        assert {k: v for k, v in body["facets"][facet].items() if v} == want, facet
    pick_ids = lambda params: {h["id"] for h in api.get("/api/jobs/search", params=params).json()["hits"]}
    assert pick_ids([("q", w), ("city", "harrowgate"), ("remote", "remote")]) == {ids["j2"]}
    assert pick_ids([("q", w), ("city", "harrowgate"), ("city", "kelvane")]) == {ids[j["key"]] for j in listed}
    assert pick_ids([("q", w), ("role", "qc_analyst"), ("band", "4_6")]) == {ids["j1"]}
    options = api.get("/api/jobs/suggest", params={"q": w}).json()["options"]
    assert set(options) <= {j["title"] for j in listed} and len(options) <= MAX_OPTIONS and f"Draft Tech {w}" not in options
    assert_error(api.get(f"/api/jobs/{ids['j5']}", s["member"]), 404, "not_found")
    meilisearch.settled()
    assert meilisearch.document("jobs", ids["j5"]) is None and meilisearch.document("jobs", ids["j6"]) is None
    assert meilisearch.document("jobs", ids["j1"])["title"] == f"QC Analyst {w}"
    companies = api.get("/api/companies/search", params={"q": typo}).json()
    hit = next(h for h in companies["hits"] if h["slug"] == company["slug"])
    assert set(hit) == HIT_KEYS and hit["review_count"] == 1 and hit["rating"] == 4.0
    assert companies["facets"]["city"].get("harrowgate", 0) >= 1


def test_wf_job_search_keyboard_chips(app_url, browser):
    api = Api(app_url)
    _, s, company, w, _ = search_world(app_url)
    with opened(browser, app_url, f"/jobs?q={w}", s["member"]) as page:
        eventually(page, lambda: "4 jobs found" in page_text(page), "the count line for the query")
        city = page.get_by_role("group", name="City")
        harrow = city.get_by_role("button", name="Harrowgate", exact=True)
        harrow.focus()
        page.keyboard.press("Space")
        expect(harrow).to_have_attribute("aria-pressed", "true")
        advance(page, DEBOUNCE_MS - 1)
        assert "Filter added: Harrowgate." not in " ".join(heard(page)), "announced before the debounce"
        advance(page, 1)
        hear(page, "Filter added: Harrowgate. 2 jobs found.")
        assert query(page).get("city") == ["harrowgate"] and query(page).get("q") == [w]
        city.get_by_role("button", name="Kelvane", exact=True).focus()
        page.keyboard.press("Enter")
        advance(page, DEBOUNCE_MS)
        hear(page, "Filter added: Kelvane. 4 jobs found.")
        role = page.get_by_role("group", name="Role")
        ra = role.get_by_role("button", name="Research Assistant", exact=True)
        ra.focus()
        page.keyboard.press("Space")
        advance(page, DEBOUNCE_MS)
        hear(page, "Filter added: Research Assistant. 1 job found.")
        results = page.get_by_role("list", name="Job results")
        expect(results.get_by_role("link", name=f"Research Assistant {w} at {company['name']}")).to_be_visible()
        page.keyboard.press("Delete")
        expect(ra).to_have_attribute("aria-pressed", "false")
        qc = role.get_by_role("button", name="QC Analyst", exact=True)
        expect(qc).to_be_focused()
        advance(page, DEBOUNCE_MS)
        hear(page, "Filter removed: Research Assistant. 4 jobs found.")
        page.keyboard.press("Backspace")
        expect(qc).to_have_attribute("aria-pressed", "false")
        expect(qc).to_be_focused()
        salt = city.get_by_role("button", name="Saltmere", exact=True)
        salt.focus()
        page.keyboard.press("Space")
        page.keyboard.press("Delete")
        expect(page.get_by_role("button", name="Clear filters")).to_be_focused()
        advance(page, DEBOUNCE_MS)
        reload(page)
        eventually(page, lambda: "4 jobs found" in page_text(page), "results restored after reload")
        expect(page.get_by_role("group", name="City").get_by_role("button", name="Kelvane", exact=True)).to_have_attribute("aria-pressed", "true")
        assert sorted(query(page).get("city", [])) == ["harrowgate", "kelvane"]
    assert api.get("/api/jobs/search", params=[("q", w), ("city", "harrowgate"), ("city", "kelvane")]).json()["total"] == 4


def test_wf_job_search_keyboard_typo_suggestion(app_url, browser):
    _, s, company, w, _ = search_world(app_url)
    with opened(browser, app_url, "/jobs", s["member"]) as page:
        box = page.get_by_role("combobox", name="Job title")
        box.focus()
        page.keyboard.type(w[:3] + w[4:])
        advance(page, DEBOUNCE_MS)
        options = page.get_by_role("listbox", name="Job title suggestions").get_by_role("option")
        eventually(page, lambda: options.count() > 0, "Job title suggestions for the misspelling")
        first, total = options.first.text_content().strip(), options.count()
        assert w in first and total <= MAX_OPTIONS
        page.keyboard.press("ArrowDown")
        hear(page, f"{first}, 1 of {total}")
        page.keyboard.press("Enter")
        assert box.input_value() == first
        eventually(page, lambda: query(page).get("q") == [first], "the chosen title in the URL")
        eventually(page, lambda: page.get_by_role("list", name="Job results").get_by_role("link", name=f"{first} at {company['name']}", exact=True).count() == 1, "the chosen job in results")


def test_wf_job_search_keyboard_phone_sheet(app_url, browser):
    api = Api(app_url)
    _, s, _, w, _ = search_world(app_url)
    width = VIEWPORTS["phone"]["width"]
    with opened(browser, app_url, f"/jobs?q={w}", s["member"], size="phone") as page:
        eventually(page, lambda: "4 jobs found" in page_text(page), "the count line for the query")
        opener = page.get_by_role("button", name="Filters", exact=True)
        sheet = page.get_by_role("dialog", name="Filters")
        assert gone_or_state(sheet, "closed"), "the filter sheet is open before Filters is pressed"
        assert rect(page.get_by_role("list", name="Job results"))["width"] >= width * 0.85, "results do not take the full width"
        assert page.evaluate("() => document.documentElement.scrollWidth") <= width + 1, "the phone page scrolls sideways"
        tab_to(page, opener)
        page.keyboard.press("Enter")
        expect(sheet).to_have_attribute("data-state", "opening")
        advance(page, FILTER_SHEET_MS)
        expect(sheet).to_have_attribute("data-state", "open")
        assert sheet.evaluate("d => d.contains(document.activeElement)"), "focus did not move into the sheet"
        chip = sheet.get_by_role("group", name="City").get_by_role("button", name="Harrowgate", exact=True)
        tab_to(page, chip)
        page.keyboard.press("Space")
        expect(chip).to_have_attribute("aria-pressed", "true")
        advance(page, DEBOUNCE_MS)
        matches = 2
        hear(page, f"Filter added: Harrowgate. {matches} jobs found.")
        expect(page.get_by_role("button", name=f"Show {matches} jobs", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        advance(page, FILTER_SHEET_MS)
        assert gone_or_state(sheet, "closed"), "Escape did not close the filter sheet"
        expect(opener).to_be_focused()
        assert query(page).get("city") == ["harrowgate"] and query(page).get("q") == [w]
    assert api.get("/api/jobs/search", params=[("q", w), ("city", "harrowgate")]).json()["total"] == 2


def test_wf_job_search_keyboard_save_job(app_url, browser):
    ids, s, company, w, _ = search_world(app_url)
    title = f"QC Analyst {w}"
    with opened(browser, app_url, f"/jobs?q={w}", s["member"]) as page:
        eventually(page, lambda: "4 jobs found" in page_text(page), "the count line for the query")
        link = page.get_by_role("list", name="Job results").get_by_role("link", name=f"{title} at {company['name']}", exact=True)
        tab_to(page, link)
        page.keyboard.press("Enter")
        eventually(page, lambda: urlparse(page.url).path == f"/jobs/{ids['j1']}", "the job page opened by keyboard")
        listen(page)
        expect(page.get_by_role("button", name="Apply now")).to_be_visible()
        expect(page.get_by_role("region", name="Apply bar")).to_have_count(0)
        save = page.get_by_role("button", name="Save job")
        tab_to(page, save)
        page.keyboard.press("Space")
        expect(save).to_have_attribute("aria-pressed", "true")
        expect(save).to_have_attribute("data-motion", "save-toggle")
        expect(save).to_have_attribute("data-motion-ms", str(SAVE_TOGGLE_MS))
        expect(save).to_have_attribute("data-state", "running")
        advance(page, SAVE_TOGGLE_MS)
        expect(save).to_have_attribute("data-state", "done")
        hear(page, f"Saved {title} at {company['name']}.")
        response = page.goto(app_url.rstrip("/") + f"/jobs/{ids['j5']}")
        advance(page, STEP_MS)
        expect_not_found(page, response)


def test_wf_job_search_keyboard_empty(app_url, browser):
    _, s, _, w, _ = search_world(app_url)
    with opened(browser, app_url, f"/jobs?q={w}&city=saltmere", s["member"]) as page:
        eventually(page, lambda: "No jobs match these filters" in page_text(page), "the empty sentence")
        page.get_by_role("link", name="Show all jobs").click()
        results = page.get_by_role("list", name="Job results").get_by_role("listitem")
        eventually(page, lambda: results.count() > 0, "results after Show all jobs")
        assert "city" not in query(page)


def test_search_outage_fallback(app_url, browser):
    down = Api(outage_url("APP_SEARCH_DOWN_URL"))
    ids, s, company, w, specs = search_world(app_url)
    jobs = down.get("/api/jobs/search", params={"q": w}).json()
    assert jobs["fallback"] == "by_city"
    names = [c["city_name"] for c in jobs["cities"]]
    assert names == sorted(names)
    harrow = next(c for c in jobs["cities"] if c["city"] == "harrowgate")
    order = [j["id"] for j in harrow["jobs"]]
    assert ids["j1"] in order and ids["j2"] in order and ids["j5"] not in order and ids["j6"] not in order
    assert order.index(ids["j2"]) < order.index(ids["j1"]), "jobs not newest listed first"
    companies = down.get("/api/companies/search", params={"q": w}).json()
    assert companies["fallback"] == "by_city"
    bucket = next(c for c in companies["cities"] if c["city"] == company["city"])
    assert company["slug"] in [h["slug"] for h in bucket["companies"]]
    assert [h["name"] for h in bucket["companies"]] == sorted(h["name"] for h in bucket["companies"])
    assert down.get("/api/jobs/suggest", params={"q": w}).json() == {"options": []}
    with opened(browser, down.base, "/jobs", s["member"]) as page:
        eventually(page, lambda: "Search is unavailable right now. Showing all jobs by city instead." in texts(page.get_by_role("alert")), "the job outage banner")
        eventually(page, lambda: f"Senior QC Analyst {w}" in texts(page.get_by_role("list", name="Jobs by city")), "our job in the by-city list")
        page.goto(down.base + "/companies")
        eventually(page, lambda: "Search is unavailable right now. Showing all companies by city instead." in texts(page.get_by_role("alert")), "the company outage banner")
        eventually(page, lambda: company["name"] in texts(page.get_by_role("list", name="Companies by city")), "our company in the by-city list")


FIELD_JS = """(tile) => { let el = tile; const W = innerWidth, H = innerHeight;
  const fits = (e) => { const r = e.getBoundingClientRect(); return r.width < W - 4 && r.height <= H + 4; };
  while (el.parentElement && fits(el.parentElement)) el = el.parentElement;
  const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, height: r.height}; }"""


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_company_page_breakpoints(app_url, browser, size):
    ids, s, company, _ = band_world(app_url)
    w, h = VIEWPORTS[size]["width"], VIEWPORTS[size]["height"]
    with opened(browser, app_url, f"/companies/{company['slug']}", s["viewer"], size=size) as page:
        tile = page.locator("[data-band]")
        heading = page.get_by_role("heading", name=company["name"], exact=True)
        expect(tile).to_be_visible()
        layout(page)
        before = rect(tile)
        if size == "phone":
            assert abs(before["width"] - w) <= SPLIT_PX
            assert PHONE_TILE[0] * h <= before["height"] <= PHONE_TILE[1] * h
            assert rect(heading)["top"] >= before["bottom"] - SPLIT_PX
            expect(page.get_by_role("tablist", name="Company sections")).to_be_visible()
            page.evaluate("() => window.scrollBy(0, innerHeight)")
            advance(page, STEP_MS)
            assert abs(rect(tile)["top"]) <= SPLIT_PX, "tile did not stay pinned to the top"
            return
        field = tile.evaluate(FIELD_JS)
        expect(page.get_by_role("tablist", name="Company sections")).to_be_hidden()
        assert abs(field["right"] - w) <= SPLIT_PX and abs(field["height"] - h) <= SPLIT_PX
        if size == "desktop":
            assert abs(field["left"] - w / 2) <= SPLIT_PX
            assert abs(before["width"] - before["height"]) <= SPLIT_PX
            assert abs((before["left"] + before["right"]) / 2 - (field["left"] + field["right"]) / 2) <= SPLIT_PX
        else:
            assert TABLET_READING[0] * w - SPLIT_PX <= field["left"] <= TABLET_READING[1] * w + SPLIT_PX
            assert before["left"] >= field["left"] - SPLIT_PX and before["right"] <= w + SPLIT_PX
        assert rect(heading)["right"] <= field["left"] + SPLIT_PX
        heading_top = rect(heading)["top"]
        by_id(page, ids["n11"]).evaluate("e => e.scrollIntoView({block: 'end'})")
        advance(page, STEP_MS)
        assert rect(heading)["top"] < heading_top, "the reading column did not scroll"
        after = rect(tile)
        assert abs(after["top"] - before["top"]) <= SPLIT_PX and abs(after["left"] - before["left"]) <= SPLIT_PX, "tile moved while reading"


def test_wf_job_search_phone_filter_sheet(app_url, browser):
    api = Api(app_url)
    _, s, _, w, _ = search_world(app_url)
    with opened(browser, app_url, f"/jobs?q={w}", s["member"], size="phone") as page:
        opener = page.get_by_role("button", name="Filters", exact=True)
        sheet = page.get_by_role("dialog", name="Filters")

        def open_sheet() -> None:
            opener.click()
            expect(sheet).to_have_attribute("data-motion", "filter-sheet")
            expect(sheet).to_have_attribute("data-motion-ms", str(FILTER_SHEET_MS))
            expect(sheet).to_have_attribute("data-state", "opening")
            advance(page, FILTER_SHEET_MS)
            eventually(page, lambda: attr(sheet, "data-state") == "open", "the sheet to read open")
            eventually(page, lambda: sheet.evaluate("d => d.contains(document.activeElement)"), "focus to move into the sheet")

        def closed() -> None:
            advance(page, FILTER_SHEET_MS)
            eventually(page, lambda: gone_or_state(sheet, "closed"), "the sheet to close")
            eventually(page, lambda: is_focused(opener), "focus to return to button Filters")

        open_sheet()
        for key in ["Tab"] * 40 + ["Shift+Tab"] * 5:
            page.keyboard.press(key)
            assert sheet.evaluate("d => d.contains(document.activeElement)"), f"{key} left the sheet"
        sheet.get_by_role("group", name="City").get_by_role("button", name="Kelvane", exact=True).click()
        advance(page, DEBOUNCE_MS)
        show = page.get_by_role("button", name=f"Show {2} jobs")
        eventually(page, lambda: show.count() == 1, "the Show button with two jobs")
        sheet.get_by_role("group", name="Role").get_by_role("button", name="Lab Manager", exact=True).click()
        advance(page, DEBOUNCE_MS)
        single = page.get_by_role("button", name="Show 1 job", exact=True)
        eventually(page, lambda: single.count() == 1, "button Show 1 job")
        single.click()
        expect(sheet).to_have_attribute("data-state", "closing")
        closed()
        assert query(page).get("city") == ["kelvane"] and query(page).get("role") == ["lab_manager"]
        open_sheet()
        page.keyboard.press("Escape")
        closed()
        open_sheet()
        settled_box(page, sheet)
        swipe(page, sheet, 0, SHEET_SWIPE, from_top=True)
        closed()
    assert api.get("/api/jobs/search", params=[("q", w), ("city", "kelvane"), ("role", "lab_manager")]).json()["total"] == 1


def test_wf_job_search_phone_apply_bar(app_url, browser):
    api = Api(app_url)
    ids, s, _, w, _ = search_world(app_url)
    with opened(browser, app_url, f"/jobs/{ids['j1']}", s["member"], size="phone") as page:
        bar = page.get_by_role("region", name="Apply bar")
        expect(bar).to_be_visible()
        expect(bar.get_by_role("button", name="Apply now")).to_be_visible()
        expect(bar.get_by_role("button", name="Save job")).to_be_visible()
        layout(page)
        height = VIEWPORTS["phone"]["height"]
        assert abs(rect(bar)["bottom"] - height) <= SPLIT_PX
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        advance(page, STEP_MS)
        assert abs(rect(bar)["bottom"] - height) <= SPLIT_PX
        page.set_viewport_size(VIEWPORTS["desktop"])
        advance(page, STEP_MS)
        expect(bar).to_be_hidden()
        expect(page.get_by_role("button", name="Apply now")).to_be_visible()
        page.set_viewport_size(VIEWPORTS["phone"])
        advance(page, STEP_MS)
        bar.get_by_role("button", name="Apply now").click()
        eventually(page, lambda: urlparse(page.url).path == f"/jobs/{ids['j1']}/apply", "the apply form")
    assert api.get(f"/api/jobs/{ids['j1']}", s["member"]).json()["status"] == "listed"


def test_saved_jobs(app_url, browser):
    api = Api(app_url)
    ids, s, company, w, _ = search_world(app_url)
    _, empty = seed(app_url, users=[person("empty")])
    with opened(browser, app_url, "/saved", empty["empty"]) as page:
        eventually(page, lambda: "You have not saved any jobs yet." in page_text(page), "the empty saved-jobs sentence")
        expect(page.get_by_role("link", name="Search lab jobs").first).to_be_visible()
    title = f"QC Analyst {w}"
    with opened(browser, app_url, f"/jobs/{ids['j1']}", s["member"]) as page:
        save = page.get_by_role("button", name="Save job")
        expect(save).to_have_attribute("aria-pressed", "false")
        expect(save).to_have_text("Save job")
        expect(save).to_have_attribute("data-motion", "save-toggle")
        save.click()
        expect(save).to_have_attribute("aria-pressed", "true")
        expect(save).to_have_attribute("data-motion-ms", str(SAVE_TOGGLE_MS))
        expect(save).to_have_attribute("data-state", "running")
        advance(page, SAVE_TOGGLE_MS)
        expect(save).to_have_attribute("data-state", "done")
        expect(save).to_have_text("Saved")
        hear(page, f"Saved {title} at {company['name']}.")
        reload(page)
        expect(save).to_have_attribute("aria-pressed", "true")
        for _ in range(2):
            assert api.put(f"/api/saved-jobs/{ids['j2']}", s["member"]).json() == {"saved": True}
        assert [j["id"] for j in api.get("/api/saved-jobs", s["member"]).json()["jobs"]][:2] == [ids["j2"], ids["j1"]]
        page.goto(app_url.rstrip("/") + "/saved")
        saved = page.get_by_role("list", name="Saved jobs")
        eventually(page, lambda: by_id(page, ids["j1"]).count() == 1 and by_id(page, ids["j2"]).count() == 1, "both saved jobs listed")
        expect(saved).to_be_visible()
        page.goto(app_url.rstrip("/") + f"/jobs/{ids['j1']}")
        listen(page)
        page.get_by_role("button", name="Save job").click()
        hear(page, f"Removed {title} from saved jobs.")
        expect(page.get_by_role("button", name="Save job")).to_have_attribute("aria-pressed", "false")
    assert ids["j1"] not in [j["id"] for j in api.get("/api/saved-jobs", s["member"]).json()["jobs"]]
    for _ in range(2):
        assert api.delete(f"/api/saved-jobs/{ids['j2']}", s["member"]).json() == {"saved": False}


def test_company_section_tabs(app_url, browser):
    _, s, company, _ = band_world(app_url)
    path = f"/companies/{company['slug']}"
    with opened(browser, app_url, path, s["viewer"], size="phone") as page:
        tabs = page.get_by_role("tablist", name="Company sections")
        tab = lambda name: tabs.get_by_role("tab", name=name, exact=True)
        expect(tab("Reviews")).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("tabpanel")).to_have_count(1)
        tap(tab("Pay"))
        expect(tab("Pay")).to_have_attribute("aria-selected", "true")
        assert query(page).get("tab") == ["pay"]
        page.keyboard.press("ArrowRight")
        expect(tab("Interviews")).to_have_attribute("aria-selected", "true")
        assert query(page).get("tab") == ["interviews"]
        page.keyboard.press("ArrowLeft")
        expect(tab("Pay")).to_have_attribute("aria-selected", "true")
        for name in ("Interviews", "Jobs", "Jobs"):
            swipe(page, page.get_by_role("tabpanel"), -TAB_SWIPE, 0)
            advance(page, STEP_MS)
            expect(tab(name)).to_have_attribute("aria-selected", "true")
        assert query(page).get("tab") == ["jobs"]
        swipe(page, page.get_by_role("tabpanel"), TAB_SWIPE, 0)
        expect(tab("Interviews")).to_have_attribute("aria-selected", "true")
        page.goto(app_url.rstrip("/") + path + "?tab=jobs")
        expect(page.get_by_role("tablist", name="Company sections").get_by_role("tab", name="Jobs", exact=True)).to_have_attribute("aria-selected", "true")


def test_jobs_listed_once_indexed(app_url, meilisearch):
    api = Api(app_url)
    down = Api(outage_url("APP_SEARCH_DOWN_URL"))
    _, s = seed(app_url, companies=[lab("c"), lab("u", verified=False)], users=[person("rec", "recruiter", "c"), person("ux", "recruiter", "u"), person("member")])
    w = word()
    r = api.post("/api/employer/jobs", job_body(f"Listed {w}"), s["rec"])
    assert r.status_code == 201 and JOB_KEYS <= set(r.json()) and r.json()["status"] == "listed", r.text
    listed = r.json()
    assert meilisearch.document("jobs", listed["id"]) is not None, "job answered listed before its document was indexed"
    assert api.get(f"/api/jobs/{listed['id']}", s["member"]).json()["status"] == "listed"
    assert_error(down.post("/api/employer/jobs", job_body(f"Draft {w}"), s["rec"]), 503, "search_unavailable")
    draft = next(j for j in api.get("/api/employer/jobs", s["rec"]).json()["jobs"] if j["title"] == f"Draft {w}")
    assert draft["status"] == "draft"
    assert_error(api.get(f"/api/jobs/{draft['id']}", s["member"]), 404, "not_found")
    assert meilisearch.document("jobs", draft["id"]) is None
    assert_error(down.post(f"/api/employer/jobs/{draft['id']}/list", who=s["rec"]), 503, "search_unavailable")
    relisted = api.post(f"/api/employer/jobs/{draft['id']}/list", who=s["rec"])
    assert relisted.status_code == 200 and relisted.json()["status"] == "listed"
    assert meilisearch.document("jobs", draft["id"]) is not None
    closed = api.post(f"/api/employer/jobs/{listed['id']}/close", who=s["rec"])
    assert closed.status_code == 200 and closed.json()["status"] == "closed"
    assert meilisearch.document("jobs", listed["id"]) is None, "closed job still indexed when close answered"
    assert_error(apply(api, listed["id"], s["member"], pdf_bytes()), 409, "job_closed")
    assert_error(api.post("/api/employer/jobs", job_body(f"Unverified {w}"), s["ux"]), 403, "not_verified")
    assert_error(api.post("/api/employer/jobs", job_body(f"Member {w}"), s["member"]), 403, "forbidden")
    assert_fields(api.post("/api/employer/jobs", job_body(f"Range {w}", pay_low=600000, pay_high=500000), s["rec"]), "pay_high")
    assert_fields(api.post("/api/employer/jobs", job_body(f"Short {w}", description="Too short"), s["rec"]), "description")


def test_wf_job_alert_save_and_match(app_url, browser, mail):
    api = Api(app_url)
    w = word()
    company = lab("c")
    member = person("member")
    _, s = seed(app_url, companies=[company], users=[member, person("rec", "recruiter", "c")])
    label = f"{w}, Harrowgate"
    with opened(browser, app_url, f"/jobs?q={w}&city=harrowgate", s["member"]) as page:
        tab_to(page, page.get_by_role("button", name="Save alert"))
        page.keyboard.press("Enter")
        hear(page, f"Alert saved for {label}")
        toast = lambda: motion_of(page, "toast") or {}
        eventually(page, lambda: f"Alert saved for {label}" in toast().get("text", ""), "the toast with the alert text")
        advance(page, TOAST_MS)
        eventually(page, lambda: toast().get("state") == "open", "the toast to open")
        advance(page, TOAST_SECONDS * 1000 + TOAST_MS)
        eventually(page, lambda: toast().get("state", "closed") == "closed", "the toast to close after TOAST_SECONDS")
        alert = next(a for a in api.get("/api/alerts", s["member"]).json()["alerts"] if a["label"] == label)
        assert alert["new_count"] == 0
        tab_to(page, page.get_by_role("link", name="Alerts", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: urlparse(page.url).path == "/alerts", "the Alerts page reached by keyboard")
        item = by_id(page, alert["id"])
        eventually(page, lambda: label in texts(item) and "No new jobs" in texts(item), "the saved alert with No new jobs")
        first = api.post("/api/employer/jobs", job_body(f"Bench Tech {w}", pay_low=410000, pay_high=470000), s["rec"]).json()
        eventually(page, lambda: "1 new job" in texts(item), "the alert count live after a match")
        api.post("/api/employer/jobs", job_body(f"Bench Tech {w}", city="kelvane"), s["rec"])
        second = api.post("/api/employer/jobs", job_body(f"Bench Lead {w}", pay_low=520000, pay_high=610000), s["rec"]).json()
        eventually(page, lambda: "2 new jobs" in texts(item), "the alert count after a second match")
        clock(app_url, ALERT_BATCH_SECONDS)
        letter = exactly_once(app_url, mail, member["email"], f"2 new lab jobs for {label}")
        body = text(letter)
        lines = [f"{j['title']} at {company['name']}, Harrowgate, {rupees(j['pay_low'])} – {rupees(j['pay_high'])}" for j in (second, first)]
        assert all(line in body for line in lines) and body.index(lines[0]) < body.index(lines[1])
        assert f"/jobs/{first['id']}" in body and f"/jobs/{second['id']}" in body and "Kelvane" not in body
        page.get_by_role("link", name=f"See jobs for {label}").click()
        eventually(page, lambda: next(a for a in api.get("/api/alerts", s["member"]).json()["alerts"] if a["id"] == alert["id"])["new_count"] == 0, "seen to reset the count")


def test_wf_job_alert_closed_batch_silent(app_url, browser, mail):
    api = Api(app_url)
    w = word()
    member = person("member")
    _, s = seed(app_url, companies=[lab("c")], users=[member, person("rec", "recruiter", "c")])
    with opened(browser, app_url, f"/jobs?q={w}", s["member"]) as page:
        page.get_by_role("button", name="Save alert").click()
        hear(page, f"Alert saved for {w}")
    made = api.post("/api/employer/jobs", job_body(f"Bench Tech {w}"), s["rec"]).json()
    alert = next(a for a in api.get("/api/alerts", s["member"]).json()["alerts"] if a["label"] == w)
    assert alert["new_count"] == 1
    assert api.post(f"/api/employer/jobs/{made['id']}/close", who=s["rec"]).status_code == 200
    clock(app_url, ALERT_BATCH_SECONDS)
    clock(app_url, OUTBOX_RETRY_SECONDS)
    assert not [m for m in mails_to(mail, member["email"]) if w in (m.get("Subject") or "")], "a batch of closed jobs sent mail"


RESUME_CASES = ["pdf-odd-name", "png-named-pdf", "exact-max", "one-over-max", "big-not-pdf", "missing-file", "one-over-rate"]


@pytest.mark.parametrize("case", RESUME_CASES, ids=RESUME_CASES)
def test_resume_checks(app_url, case):
    api = Api(app_url)
    now = clock(app_url)
    jobs = [job(f"j{i}", "c", f"Bench Role {word(5)}", iso(now)) for i in range(UPLOAD_RATE_PER_MINUTE + 1)]
    ids, s = seed(app_url, companies=[lab("c")], users=[person("member")], jobs=jobs)
    target = ids["j0"]
    uploads = {"pdf-odd-name": (pdf_bytes(), "cv.txt", "text/plain", None), "png-named-pdf": (png_bytes(), "resume.pdf", "application/pdf", "resume_not_pdf"),
               "exact-max": (pdf_bytes(RESUME_MAX_BYTES), "resume.pdf", "application/pdf", None),
               "one-over-max": (pdf_bytes(RESUME_MAX_BYTES + 1), "resume.pdf", "application/pdf", "resume_too_large"),
               "big-not-pdf": (b"\x00" * (RESUME_MAX_BYTES + 1), "resume.pdf", "application/pdf", "resume_not_pdf"),
               "missing-file": (None, "", "", "validation_failed")}
    if case == "one-over-rate":
        for i in range(UPLOAD_RATE_PER_MINUTE):
            assert apply(api, ids[f"j{i}"], s["member"], pdf_bytes()).status_code == 201
        target = ids[f"j{UPLOAD_RATE_PER_MINUTE}"]
        r = apply(api, target, s["member"], pdf_bytes())
        assert_error(r, 429, "rate_limited")
        assert r.headers.get("Retry-After", "").isdigit()
    else:
        data, name, ctype, code = uploads[case]
        r = apply(api, target, s["member"], data, name, ctype)
        if code is None:
            assert r.status_code == 201, r.text
            created = r.json()
            assert created["stage"] == "submitted" and created["job_id"] == target
            assert S3().get(f"resumes/{created['resume_file_id']}.pdf") == data
            served = api.get(f"/api/files/{created['resume_file_id']}", s["member"])
            assert served.status_code == 200 and served.headers["content-type"].startswith("application/pdf") and served.content == data
            return
        if code == "validation_failed":
            assert_fields(r, "resume")
        else:
            assert_error(r, 422, code)
    assert all(a["job_id"] != target for a in my_applications(api, s["member"]))


def apply_world(app_url: str) -> tuple[dict, dict, dict]:
    now = clock(app_url)
    company = lab("c")
    ids, s = seed(app_url, companies=[company], users=[person("member"), person("other")], jobs=[job("j", "c", f"Bench Role {word(5)}", iso(now))])
    return ids, s, company


def fill_apply(page: Page, name: str, contact: str, resume: bytes, filename: str = "resume.pdf", ctype: str = "application/pdf") -> None:
    page.get_by_role("textbox", name="Full name").fill(name)
    page.get_by_role("textbox", name="Contact email").fill(contact)
    page.get_by_role("textbox", name="Phone (optional)").fill("+91 98765 43210")
    page.get_by_role("textbox", name="Note to the employer (optional)").fill("Happy to start soon.")
    page.get_by_label("Resume (PDF, up to 5 MB)").set_input_files({"name": filename, "mimeType": ctype, "buffer": resume})


def test_wf_apply_outage_storage_down(app_url, browser):
    api = Api(app_url)
    down = outage_url("APP_STORAGE_DOWN_URL")
    ids, s, _ = apply_world(app_url)
    name, contact, resume = f"Asha {word(5).capitalize()}", email_for("contact"), pdf_bytes()
    with opened(browser, down, f"/jobs/{ids['j']}/apply", s["member"]) as page:
        fill_apply(page, name, contact, resume)
        send = page.get_by_role("button", name="Send application")
        with held(page, "**/api/jobs/*/applications") as gate:
            send.click()
            expect(send).to_be_disabled()
            hear(page, "Sending your application")
            gate.release()
        eventually(page, lambda: MESSAGES["storage_unavailable"] in texts(page.get_by_role("alert")), "the storage outage alert")
        assert page.get_by_role("textbox", name="Full name").input_value() == name
        assert page.get_by_role("textbox", name="Contact email").input_value() == contact
        with page.expect_request(lambda r: r.method == "POST" and "/applications" in r.url) as sent:
            page.get_by_role("button", name="Try again").click()
        assert "multipart/form-data" in (sent.value.headers.get("content-type") or ""), "Try again did not resend the form"
        eventually(page, lambda: MESSAGES["storage_unavailable"] in texts(page.get_by_role("alert")), "the alert after Try again")
    assert all(a["job_id"] != ids["j"] for a in my_applications(api, s["member"]))


def test_wf_apply_outage_idempotency(app_url, browser):
    api = Api(app_url)
    down = outage_url("APP_STORAGE_DOWN_URL")
    ids, s, _ = apply_world(app_url)
    name, contact, resume = f"Asha {word(5).capitalize()}", email_for("contact"), pdf_bytes()
    keys: list[str | None] = []
    is_apply = lambda r: r.method == "POST" and urlparse(r.url).path == f"/api/jobs/{ids['j']}/applications"
    with opened(browser, down, f"/jobs/{ids['j']}/apply", s["member"]) as page:
        page.on("request", lambda r: keys.append(r.headers.get("idempotency-key")) if is_apply(r) else None)
        fill_apply(page, name, contact, resume)
        page.get_by_role("button", name="Send application").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: MESSAGES["storage_unavailable"] in texts(page.get_by_role("alert")), "the storage outage alert")
        page.get_by_role("button", name="Try again").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: len(keys) >= 2, "the Try again request")
    assert keys[0] and len(set(keys)) == 1, f"one form sent the keys {keys}"
    sent: list[str | None] = []
    with opened(browser, app_url, f"/jobs/{ids['j']}", s["member"], size="phone") as page:
        page.on("request", lambda r: sent.append(r.headers.get("idempotency-key")) if is_apply(r) else None)
        bar = page.get_by_role("region", name="Apply bar")
        bar.get_by_role("button", name="Apply now").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: urlparse(page.url).path == f"/jobs/{ids['j']}/apply", "the apply form from the Apply bar")
        fill_apply(page, name, contact, resume)
        page.get_by_role("button", name="Send application").focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name="Application sent")).to_be_focused(timeout=LIVE_SECONDS * 1000)
    assert len(sent) == 1 and sent[0] and sent[0] != keys[0], f"the healthy form sent the keys {sent}"
    mine = [a for a in my_applications(api, s["member"]) if a["job_id"] == ids["j"]]
    assert len(mine) == 1
    same = dict(name=name, contact=contact, key=sent[0], phone="+91 98765 43210", note="Happy to start soon.")
    again = apply(api, ids["j"], s["member"], resume, **same)
    assert again.status_code == 201 and again.json()["id"] == mine[0]["id"], again.text
    assert_error(apply(api, ids["j"], s["member"], resume, **{**same, "name": name + " Jr"}), 409, "idempotency_mismatch")
    assert len([a for a in my_applications(api, s["member"]) if a["job_id"] == ids["j"]]) == 1


def test_wf_apply_outage_happy_once(app_url, browser):
    api = Api(app_url)
    ids, s, _ = apply_world(app_url)
    store = S3()
    before = set(store.keys("resumes/"))
    resume = pdf_bytes()
    with opened(browser, app_url, f"/jobs/{ids['j']}", s["member"]) as page:
        expect(page.get_by_role("button", name="Apply now")).to_be_visible()
        expect(page.get_by_role("region", name="Apply bar")).to_have_count(0)
        page.get_by_role("button", name="Apply now").click()
        eventually(page, lambda: urlparse(page.url).path == f"/jobs/{ids['j']}/apply", "the apply form")
        fill_apply(page, APPLICANT_NAME, email_for("contact"), resume)
        page.get_by_role("button", name="Send application").click()
        expect(page.get_by_role("heading", name="Application sent")).to_be_focused(timeout=LIVE_SECONDS * 1000)
        response = page.goto(app_url.rstrip("/") + f"/jobs/{uuid.uuid4()}/apply")
        advance(page, STEP_MS)
        expect_not_found(page, response)
    mine = [a for a in my_applications(api, s["member"]) if a["job_id"] == ids["j"]]
    assert len(mine) == 1 and mine[0]["stage"] == "submitted"
    detail = api.get(f"/api/applications/{mine[0]['id']}", s["member"]).json()
    assert store.get(f"resumes/{detail['resume_file_id']}.pdf") == resume
    assert_error(apply(api, ids["j"], s["member"], resume), 409, "duplicate_application")
    gate = threading.Barrier(4)

    def go(_: int) -> httpx.Response:
        gate.wait()
        return apply(api, ids["j"], s["other"], resume)

    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(go, range(4)))
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    for r in results:
        if r.status_code == 409:
            assert_error(r, 409, "duplicate_application")
    winner = next(r for r in results if r.status_code == 201).json()
    assert set(store.keys("resumes/")) - before == {f"resumes/{detail['resume_file_id']}.pdf", f"resumes/{winner['resume_file_id']}.pdf"}


def test_wf_apply_outage_invalid_file(app_url, browser):
    api = Api(app_url)
    ids, s, _ = apply_world(app_url)
    with opened(browser, app_url, f"/jobs/{ids['j']}/apply", s["member"]) as page:
        fill_apply(page, APPLICANT_NAME, email_for("contact"), png_bytes())
        page.get_by_role("button", name="Send application").click()
        field = page.get_by_label("Resume (PDF, up to 5 MB)")
        eventually(page, lambda: MESSAGES["resume_not_pdf"] in described(field), "Upload a PDF file. under the resume field")
        assert page.get_by_role("textbox", name="Full name").input_value() == APPLICANT_NAME
        assert all(a["job_id"] != ids["j"] for a in my_applications(api, s["member"]))
        field.set_input_files({"name": "resume.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes()})
        page.get_by_role("button", name="Send application").click()
        expect(page.get_by_role("heading", name="Application sent")).to_be_visible(timeout=LIVE_SECONDS * 1000)
    assert len([a for a in my_applications(api, s["member"]) if a["job_id"] == ids["j"]]) == 1


STAGE_CASES = {
    "submitted-to-screening": ("submitted", "screening", "team", 200),
    "screening-to-interview": ("screening", "interview", "team", 200),
    "interview-to-offer": ("interview", "offer", "team", 200),
    "offer-to-interview": ("offer", "interview", "team", 200),
    "screening-to-submitted": ("screening", "submitted", "team", 200),
    "interview-to-declined": ("interview", "declined", "team", 200),
    "submitted-to-interview": ("submitted", "interview", "team", 409),
    "submitted-to-offer": ("submitted", "offer", "team", 409),
    "same-stage": ("screening", "screening", "team", 409),
    "declined-to-submitted": ("declined", "submitted", "team", 409),
    "declined-to-screening": ("declined", "screening", "team", 409),
    "other-team": ("submitted", "screening", "other", 404),
    "member": ("submitted", "screening", "member", 403),
    "unverified-team": ("submitted", "screening", "unverified", 403),
    "concurrent-same-move": ("submitted", "screening", "team", 200),
}


@pytest.mark.parametrize("case", list(STAGE_CASES), ids=list(STAGE_CASES))
def test_pipeline_stage_rules(app_url, case):
    api = Api(app_url)
    now = clock(app_url)
    start, goal, actor, status = STAGE_CASES[case]
    home = "u" if actor == "unverified" else "c"
    ids, s = seed(app_url, companies=[lab("c"), lab("d"), lab("u", verified=False)],
                  users=[person("team", "recruiter", home), person("other", "recruiter", "d"), person("member"), person("cand")],
                  jobs=[job("j", home, f"Bench Role {word(5)}", iso(now))],
                  applications=[application("a", "j", "cand", iso(now), "Asha Probe", email_for("contact"), stage=start)])
    who = s["team"] if actor in ("team", "unverified") else s[actor]
    move = lambda: api.post(f"/api/employer/applications/{ids['a']}/stage", {"stage": goal}, who)
    if case == "concurrent-same-move":
        gate = threading.Barrier(CONCURRENT)
        with ThreadPoolExecutor(CONCURRENT) as pool:
            results = list(pool.map(lambda _: (gate.wait(), move())[1], range(CONCURRENT)))
        assert sorted(r.status_code for r in results) == [200] + [409] * (CONCURRENT - 1)
        for r in results:
            if r.status_code == 409:
                assert_error(r, 409, "invalid_transition")
    else:
        r = move()
        if status == 200:
            assert r.status_code == 200 and set(r.json()) == APPLICANT_KEYS and r.json()["stage"] == goal, r.text
        else:
            if actor == "member":
                assert r.status_code in (403, 404) and r.json()["error"] in ("forbidden", "not_found"), r.text
            else:
                code = {404: "not_found", 409: "invalid_transition", 403: "not_verified"}[status]
                assert_error(r, status, code)
    final = api.get(f"/api/applications/{ids['a']}", s["cand"]).json()["stage"]
    assert final == (goal if status == 200 else start)


def test_application_privacy(app_url, browser):
    api = Api(app_url)
    now = clock(app_url)
    cand = person("cand")
    contact = email_for("contact")
    ids, s = seed(app_url, companies=[lab("c"), lab("d"), lab("m", mark=True)],
                  users=[person("rec", "recruiter", "c"), person("x", "recruiter", "d"), cand, person("other")],
                  posts=[review("rv", "c", "cand", iso(now))], jobs=[job("j", "c", f"Bench Role {word(5)}", iso(now))],
                  applications=[application("a", "j", "cand", iso(now), PRIVATE_NAME, contact)])
    leaks = [cand["display_name"], cand["email"]] + ([ids["cand"]] if len(str(ids["cand"])) >= 8 else [])
    listing = api.get(f"/api/employer/jobs/{ids['j']}/applicants", s["rec"])
    assert listing.status_code == 200
    row = next(a for a in listing.json()["applicants"] if a["id"] == ids["a"])
    assert set(row) == APPLICANT_KEYS and row["contact_email"] == contact and row["candidate_name"] == PRIVATE_NAME
    detail = api.get(f"/api/employer/applications/{ids['a']}", s["rec"])
    assert detail.status_code == 200 and set(detail.json()) == APPLICANT_KEYS
    for r in (listing, detail):
        assert not any(secret in r.text for secret in leaks), "applicant data links to the member account"
    assert_error(api.get(f"/api/employer/applications/{ids['a']}", s["x"]), 404, "not_found")
    assert_error(api.get(f"/api/employer/jobs/{ids['j']}/applicants", s["x"]), 404, "not_found")
    assert_error(api.post(f"/api/employer/applications/{ids['a']}/stage", {"stage": "screening"}, s["x"]), 404, "not_found")
    own = api.get(f"/api/applications/{ids['a']}", s["cand"])
    assert own.status_code == 200 and own.json()["candidate_name"] == PRIVATE_NAME
    assert_error(api.get(f"/api/applications/{ids['a']}", s["other"]), 404, "not_found")
    resume = own.json()["resume_file_id"]
    for who in (s["cand"], s["rec"]):
        got = api.get(f"/api/files/{resume}", who)
        assert got.status_code == 200 and got.content.startswith(b"%PDF-")
    for who in (s["other"], s["x"], None):
        assert_error(api.get(f"/api/files/{resume}", who), 404, "not_found")
    with opened(browser, app_url, f"/employer/applications/{ids['a']}", s["rec"]) as page:
        eventually(page, lambda: PRIVATE_NAME in page_text(page), "the applicant's shared details")
        assert not any(secret in page.content() for secret in leaks)


def test_applicants_csv_export(app_url):
    api = Api(app_url)
    w = word()
    title = f"QC Analyst, {w.capitalize()} Night Shift"
    specs = [("a1", "Rao, Asha", "2026-03-02T10:00:00Z", "offer"), ("a2", 'Said "Hi" Tran', "2026-03-04T09:00:00Z", "declined"),
             ("a3", "Line\nBreak", "2026-03-01T23:30:00Z", "submitted"), ("a4", "Tie Alpha", "2026-03-03T12:00:00Z", "screening"),
             ("a5", "Tie Beta", "2026-03-03T12:00:00Z", "interview")]
    users = [person(f"u{i}") for i in range(len(specs))]
    ids, s = seed(app_url, companies=[lab("c"), lab("d")], users=users + [person("rec", "recruiter", "c"), person("x", "recruiter", "d"), person("member")],
                  jobs=[job("j", "c", title, "2026-03-01T00:00:00Z")],
                  applications=[application(k, "j", f"u{i}", at, name, email_for("contact"), stage) for i, (k, name, at, stage) in enumerate(specs)])
    r = api.get(f"/api/employer/jobs/{ids['j']}/applicants.csv", s["rec"])
    assert r.status_code == 200
    assert r.headers["content-type"].lower().replace(" ", "") == "text/csv; charset=utf-8".replace(" ", "")
    disposition = r.headers.get("content-disposition", "")
    assert "attachment" in disposition and f"applicants-{ids['j']}.csv" in disposition
    assert not r.content.startswith(b"\xef\xbb\xbf")
    raw = r.content.decode("utf-8")
    assert raw.startswith(CSV_HEADER + "\r\n")
    flat = raw.replace("\r\n", "\n")
    assert all(quoted(name) in flat for _, name, _, _ in specs[:3]) and quoted(title) in raw
    rows = list(csv.reader(io.StringIO(raw, newline="")))[1:]
    rows = [row for row in rows if row]
    id_key = lambda v: (0, int(v)) if v.isdigit() else (1, v)
    ties = sorted([ids["a4"], ids["a5"]], key=id_key)
    assert [row[0] for row in rows] == [ids["a2"], *ties, ids["a1"], ids["a3"]]
    by_key = {ids[k]: (name, at[:10], stage) for k, name, at, stage in specs}
    for row in rows:
        name, day, stage = by_key[row[0]]
        assert row[1:5] == [name, title, stage, day]
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", row[5])
    assert not any(u["display_name"] in raw or u["email"] in raw for u in users), "CSV links applicants to member accounts"
    assert_error(api.get(f"/api/employer/jobs/{ids['j']}/applicants.csv", s["x"]), 404, "not_found")
    denied = api.get(f"/api/employer/jobs/{ids['j']}/applicants.csv", s["member"])
    assert denied.status_code in (403, 404) and denied.json()["error"] in ("forbidden", "not_found"), denied.text


def pipeline_world(app_url: str, stages: list[str], teammates: int = 1) -> tuple[dict, dict, dict, str, list[tuple[str, str, str]]]:
    now = clock(app_url)
    w = word()
    company = lab("c")
    title = f"QC Analyst {w.capitalize()}"
    apps = [(f"a{i}", f"Cand{i} {w.capitalize()}", email_for(f"contact{i}")) for i in range(len(stages))]
    users = [person(f"rec{i}", "recruiter", "c") for i in range(teammates)] + [person(f"u{i}") for i in range(len(stages))]
    ids, s = seed(app_url, companies=[company], users=users, jobs=[job("j", "c", title, iso(now))],
                  applications=[application(k, "j", f"u{i}", iso(now - timedelta(minutes=i)), name, contact, stages[i]) for i, (k, name, contact) in enumerate(apps)])
    return ids, s, company, title, apps


def test_wf_pipeline_keyboard_phone(app_url, browser):
    ids, s, _, _, apps = pipeline_world(app_url, ["submitted"])
    _, name, _ = apps[0]
    width = VIEWPORTS["phone"]["width"]
    with opened(browser, app_url, f"/employer/jobs/{ids['j']}", s["rec0"], size="phone") as board:
        columns = [board.get_by_role("list", name=stage, exact=True) for stage in ("Submitted", "Screening", "Interview", "Offer")]
        for column in columns:
            expect(column).to_be_attached()
        boxes = [rect(column) for column in columns]
        assert all(b["top"] >= a["bottom"] - SPLIT_PX for a, b in zip(boxes, boxes[1:])), f"the stage columns do not stack: {boxes}"
        assert board.evaluate("() => document.documentElement.scrollWidth") <= width + 1, "the phone pipeline scrolls sideways"
        card = board.get_by_role("button", name=f"{name}, Submitted", exact=True)
        expect(card).to_be_visible()
        card.focus()
        eventually(board, lambda: is_focused(card), "the card to take focus")
        board.keyboard.press("Space")
        hear(board, f"Picked up {name}, in Submitted. Use Left and Right to move, Space to drop, Escape to cancel.")
        board.keyboard.press("ArrowRight")
        hear(board, f"{name} over Screening.")
        board.keyboard.press("Space")
        advance(board, CARD_DROP_MS)
        hear(board, f"{name} moved to Screening.")
        moved = board.get_by_role("list", name="Screening", exact=True).get_by_role("button", name=f"{name}, Screening", exact=True)
        eventually(board, lambda: is_focused(moved), "focus on the moved card")


def test_wf_pipeline_keyboard_move(app_url, browser, mail):
    api = Api(app_url)
    ids, s, company, title, apps = pipeline_world(app_url, ["submitted"])
    key, name, contact = apps[0]
    with opened(browser, app_url, f"/employer/jobs/{ids['j']}", s["rec0"]) as board, opened(browser, app_url, "/applications", s["u0"]) as mine:
        card = board.get_by_role("button", name=f"{name}, Submitted", exact=True)
        card.focus()
        board.keyboard.press("Space")
        hear(board, f"Picked up {name}, in Submitted. Use Left and Right to move, Space to drop, Escape to cancel.")
        board.keyboard.press("ArrowRight")
        hear(board, f"{name} over Screening.")
        board.keyboard.press("Space")
        drop = lambda: motion_of(board, "card-drop") or {}
        eventually(board, lambda: drop().get("state") == "running", "card-drop running")
        assert drop()["ms"] == str(CARD_DROP_MS)
        advance(board, CARD_DROP_MS)
        eventually(board, lambda: drop().get("state") == "done", "card-drop done")
        hear(board, f"{name} moved to Screening.")
        moved = board.get_by_role("list", name="Screening").get_by_role("button", name=f"{name}, Screening", exact=True)
        expect(moved).to_be_focused()
        expect(board.get_by_role("heading", name=column_heading("Screening", 1))).to_be_visible()
        expect(board.get_by_role("heading", name=column_heading("Submitted", 0))).to_be_visible()
        eventually(mine, lambda: "Screening" in texts(by_id(mine, ids[key])), "the candidate's stage live")
        hear(mine, f"Your application for {title} is now at Screening.")
        response = mine.goto(app_url.rstrip("/") + f"/applications/{uuid.uuid4()}")
        advance(mine, STEP_MS)
        expect_not_found(mine, response)
    letter = exactly_once(app_url, mail, contact, f"Your application for {title} at {company['name']}")
    assert "Your application is now at the Screening stage." in text(letter)
    assert api.get(f"/api/applications/{ids[key]}", s["u0"]).json()["stage"] == "screening"


def test_wf_pipeline_keyboard_cancel_and_refuse(app_url, browser, mail):
    api = Api(app_url)
    ids, s, company, title, apps = pipeline_world(app_url, ["screening"])
    key, name, contact = apps[0]
    with opened(browser, app_url, f"/employer/jobs/{ids['j']}", s["rec0"]) as board:
        card = board.get_by_role("button", name=f"{name}, Screening", exact=True)
        card.focus()
        board.keyboard.press("Enter")
        board.keyboard.press("ArrowRight")
        board.keyboard.press("Escape")
        hear(board, f"Move cancelled. {name} stays in Screening.")
        card.focus()
        board.keyboard.press("Space")
        board.keyboard.press("ArrowRight")
        board.keyboard.press("ArrowLeft")
        board.keyboard.press("Space")
        hear(board, f"Move cancelled. {name} stays in Screening.")
        card.focus()
        board.keyboard.press("Space")
        board.keyboard.press("ArrowRight")
        board.keyboard.press("ArrowRight")
        hear(board, f"{name} over Offer.")
        board.keyboard.press("Space")
        hear(board, f"{name} cannot move to Offer.")
        expect(board.get_by_role("list", name="Screening").get_by_role("button", name=f"{name}, Screening", exact=True)).to_be_visible()
    assert api.get(f"/api/applications/{ids[key]}", s["u0"]).json()["stage"] == "screening"
    clock(app_url, OUTBOX_RETRY_SECONDS)
    assert mails_to(mail, contact) == []


def test_wf_applicants_csv_stage_chips(app_url, browser):
    api = Api(app_url)
    ids, s, _, _, _ = pipeline_world(app_url, ["submitted", "submitted", "screening", "interview"])
    with opened(browser, app_url, f"/employer/jobs/{ids['j']}", s["rec0"]) as page:
        chips = page.get_by_role("group", name="Stage filter")
        chip = lambda n: chips.get_by_role("button", name=n, exact=True)
        expect(page.get_by_role("list", name="Submitted")).to_be_visible()
        chip("Screening").focus()
        page.keyboard.press("Space")
        expect(chip("Screening")).to_have_attribute("aria-pressed", "true")
        advance(page, DEBOUNCE_MS)
        hear(page, "Filter added: Screening. 1 applicant shown.")
        expect(page.get_by_role("list", name="Screening")).to_be_visible()
        expect(page.get_by_role("list", name="Submitted")).to_be_hidden()
        chip("Interview").focus()
        page.keyboard.press("Enter")
        advance(page, DEBOUNCE_MS)
        hear(page, "Filter added: Interview. 2 applicants shown.")
        page.keyboard.press("Delete")
        expect(chip("Interview")).to_have_attribute("aria-pressed", "false")
        expect(chip("Offer")).to_be_focused()
        advance(page, DEBOUNCE_MS)
        hear(page, "Filter removed: Interview. 1 applicant shown.")
        page.keyboard.press("Delete")
        expect(chip("Offer")).to_have_attribute("aria-pressed", "false")
        expect(chip("Offer")).to_be_focused()
        chip("Declined").focus()
        page.keyboard.press("Space")
        page.keyboard.press("Backspace")
        expect(page.get_by_role("button", name="Clear filters")).to_be_focused()
        page.keyboard.press("Enter")
        for n in ("Submitted", "Screening", "Interview", "Offer", "Declined"):
            expect(chip(n)).to_have_attribute("aria-pressed", "false")
        expect(page.get_by_role("list", name="Submitted")).to_be_visible()
    assert len(api.get(f"/api/employer/jobs/{ids['j']}/applicants", s["rec0"]).json()["applicants"]) == 4


def test_wf_applicants_csv_live_counts_export(app_url, browser):
    api = Api(app_url)
    ids, s, _, _, apps = pipeline_world(app_url, ["submitted", "submitted", "screening"], teammates=3)
    path = f"/employer/jobs/{ids['j']}"
    with opened(browser, app_url, path, s["rec0"]) as one, opened(browser, app_url, path, s["rec1"]) as two:
        for page in (one, two):
            expect(page.get_by_role("heading", name=column_heading("Submitted", 2))).to_be_visible()
        assert api.post(f"/api/employer/applications/{ids['a0']}/stage", {"stage": "screening"}, s["rec2"]).status_code == 200
        for page in (one, two):
            eventually(page, lambda p=page: p.get_by_role("heading", name=column_heading("Screening", 2)).count() == 1 and p.get_by_role("heading", name=column_heading("Submitted", 1)).count() == 1, "column counts live in every team window")
        with one.expect_download() as download:
            one.get_by_role("button", name="Export applicants CSV").click()
        assert download.value.suggested_filename == f"applicants-{ids['j']}.csv"
        content = Path(download.value.path()).read_bytes().decode("utf-8")
        assert content.startswith(CSV_HEADER + "\r\n") and all(name in content for _, name, _ in apps)
        response = one.goto(app_url.rstrip("/") + f"/employer/jobs/{uuid.uuid4()}")
        advance(one, STEP_MS)
        expect_not_found(one, response)


APP_ROOT = Path("/app")


def test_if_run_manifest():
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in manifest.values())


def test_if_third_party_notices():
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    assert "Literata" in notices


def test_if_licences():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert not bad, f"disallowed licences: {bad[:20]}"
    assert "OFL-1.1" in (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore():
    banned = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "@seald-io/nedb", "level", "lmdb", "lokijs", "pouchdb"}
    assert not {p.name for p in shipped_packages()} & banned
    stray = [f for f in DEPLOYED_APP.rglob("*") if f.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in f.parts]
    assert not stray, f"file databases found: {stray[:5]}"
    assert Postgres().tables(), "PostgreSQL holds no tables"


def test_if_no_external_origins(app_url, browser):
    origin = app_url.rstrip("/")
    html = httpx.get(origin + "/", timeout=HTTP_TIMEOUT).text
    refs = re.findall(r"<(?:script|link|img)[^>]+(?:src|href)=[\"']([^\"']+)", html)
    for ref in refs:
        if urlparse(ref).netloc:
            assert same_origin(urljoin(origin + "/", ref), origin), ref
    for ref in refs:
        if ref.endswith(".css") and not urlparse(ref).netloc:
            css = httpx.get(urljoin(origin + "/", ref), timeout=HTTP_TIMEOUT).text
            for url in re.findall(r"url\(\s*['\"]?(https?:[^'\")]+)", css):
                assert same_origin(url, origin), url
    seen: list[str] = []
    with opened(browser, app_url, "/") as page:
        page.on("request", lambda r: seen.append(r.url))
        page.goto(origin + "/companies/fernhollow-assay-labs")
        advance(page, STEP_MS)
        page.goto(origin + "/jobs")
        advance(page, STEP_MS)
    foreign = [u for u in seen if u.startswith("http") and not same_origin(u, origin)]
    assert not foreign, f"cross-origin loads: {foreign[:5]}"


def test_if_service_config_untouched(app_url, mail):
    assert clock(app_url, 0)
    who = person("cfg")
    seed(app_url, users=[who])
    Api(app_url).post("/api/auth/forgot", {"email": who["email"]})
    message = await_mail(app_url, mail, who["email"], "Reset your Candour Bench password")[0]
    sender = addresses(message.get("From"))
    assert sender and sender[0].lower() == parseaddr(mail_from_address())[1].lower()


def test_if_strict_typescript():
    configs = [f for d in [APP_ROOT] + [p for p in APP_ROOT.iterdir() if p.is_dir() and p.name != "node_modules"] for f in d.glob("tsconfig*.json")]
    assert configs, "no tsconfig found"
    assert any(re.search(r'"strict"\s*:\s*true', f.read_text()) for f in configs)
