from __future__ import annotations

import csv
import io
import json
import os
import re
import subprocess
import sys
import threading
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from time import monotonic
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import conftest
import httpx
import pytest
from conftest import (
    advance,
    animations,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    same_origin,
    select,
    state_styles,
    tab_order,
    unique,
    until,
)
from playwright.sync_api import Browser, Locator, Page, expect

Mailpit = Any
KillBill = Any


def _kit(name: str) -> Any:
    if hasattr(conftest, name):
        return getattr(conftest, name)
    root = Path(conftest.__file__).resolve().parent
    for module in list(sys.modules.values()):
        source = getattr(module, "__file__", None)
        if source and Path(source).resolve().is_relative_to(root) and hasattr(module, name):
            return getattr(module, name)
    raise LookupError(name)


def S3() -> Any:
    return _kit("S3")()


def Postgres() -> Any:
    return _kit("Postgres")()


def text(message: dict[str, Any]) -> str:
    return _kit("text")(message)


def addresses(field: Any) -> list[str]:
    return _kit("addresses")(field)


def mail_from_address() -> str:
    return _kit("mail_from_address")()


DEPLOYED_APP = Path(getattr(conftest, "DEPLOYED_APP", "/app"))


PASSWORD = "credwell-demo-1"
SESSION_COOKIE = "credwell_session"
PLANNER = "planner@sorrelpike.test"
AUTHOR = "author@sorrelpike.test"
AUTHOR2 = "author2@sorrelpike.test"
GRACE = "coord@harbourview.test"
MARCUS = "coord@lindenvalley.test"
ANA = "ana.ruiz@harbourview.test"
BEN = "ben.osei@harbourview.test"
CARA = "cara.lind@lindenvalley.test"
ELI = "eli.brandt@lindenvalley.test"
DEV = "dev.patel@mail.test"
HARBOURVIEW = "Harbourview Regional Hospital"
LINDEN = "Linden Valley Medical Center"
PROVIDER_ORG = "Sorrel & Pike Learning"
PROVIDER_NAME = "Sorrel & Pike Learning"
ACCREDITATION = ("Sorrel & Pike Learning is approved as a provider of nursing continuing professional development "
                 "by the Meridian Council for Nursing Education.")
PROVIDER_TZ = ZoneInfo("America/Chicago")

SEEDED = {
    "planner": (PLANNER, "Odette Marsh", "planner", PROVIDER_ORG, None, None, None),
    "author": (AUTHOR, "Felix Amari", "author", PROVIDER_ORG, None, None, None),
    "author2": (AUTHOR2, "Priya Holloway", "author", PROVIDER_ORG, None, None, None),
    "grace": (GRACE, "Grace Tamura", "coordinator", HARBOURVIEW, "harbourview", None, None),
    "marcus": (MARCUS, "Marcus Eide", "coordinator", LINDEN, "linden-valley", None, None),
    "ana": (ANA, "Ana Ruiz", "learner", HARBOURVIEW, "harbourview", "RN-4410293", "1988-03-14"),
    "ben": (BEN, "Ben Osei", "learner", HARBOURVIEW, "harbourview", "RN-5520874", "1991-07-02"),
    "cara": (CARA, "Cara Lindqvist", "learner", LINDEN, "linden-valley", "RN-6631055", "1985-11-23"),
    "eli": (ELI, "Eli Brandt", "learner", LINDEN, "linden-valley", "RN-8853277", "1979-05-09"),
    "dev": (DEV, "Dev Patel", "learner", None, None, "RN-7742166", "1993-01-30"),
}
ROLE_CASES = {
    "learner": ["ana", "ben", "cara", "eli", "dev"],
    "coordinator": ["grace", "marcus"],
    "planner": ["planner"],
    "author": ["author", "author2"],
}

KB_DOWN_ENV = "APP_KILLBILL_DOWN_URL"
MINIO_DOWN_ENV = "APP_MINIO_DOWN_URL"
SHORT_CLOCK_ENV = "APP_SHORT_CLOCK_URL"

WRONG_ANSWER = "That is not the best answer. Review the lesson and try again."
NOT_ACCEPTED = "This field is not accepted."
CSV_HEADER = "nurse_name,nurse_email,course_title,serial,issued_on,contact_hours,funding"
SEED_HARBOURVIEW_COVERAGE = "50.00"

SEARCH_MAX = 100
COMMENT_MAX = 1000
LINK_LIFETIME_DAYS = 90
BODY_LIMIT = 65536
PAGE_POLL_MS = 5000
PRESS_STEP_MS = 250
TAP_MIN = 44
TOKEN_MIN_CHARS = -(-128 // 6)
VIEWPORTS = {
    "375x812": (375, 812, 3),
    "768x1024": (768, 1024, 2),
    "1280x800": (1280, 800, 1),
}

OPEN_START_DATE = "2030-04-06"
OPEN_CLOSE_DATE = "2030-04-03"
OPEN_CLOSES_AT = "2030-04-04T04:59:59.999Z"
OPEN_CLOSE_LINE = "Enrolment closes Apr 3, 2030 at 11:59 PM CT"
PAST_START_DATE = "2026-01-20"
PAST_CLOSE_DATE = "2026-01-15"
PAST_CLOSES_AT = "2026-01-16T05:59:59.999Z"
CLOSE_CASES = {
    "dst-start-eve": ("2030-03-09", "2030-03-10T05:59:59.999Z", "Mar 9, 2030"),
    "dst-start-day": ("2030-03-10", "2030-03-11T04:59:59.999Z", "Mar 10, 2030"),
    "dst-end-day": ("2030-11-03", "2030-11-04T05:59:59.999Z", "Nov 3, 2030"),
    "winter": ("2026-01-15", "2026-01-16T05:59:59.999Z", "Jan 15, 2026"),
}

FAR_SCHEDULE_A = "2030-04-06"
FAR_SCHEDULE_B = "2030-11-03"
REFUND_REASON = "My plans changed."
RETURN_NOTE = "Add references."
UI_RETURN_NOTE = "Cite the wound-care guideline."
COVER_NOW = "20.00"
COVER_SCHEDULED_A = "75.00"
COVER_SCHEDULED_B = "60.00"
COVER_AGAIN = "30.00"
COVER_CHANGED = "25.00"
STATE_LABELS = {"draft": "Draft", "in_review": "In review", "published": "Published", "withdrawn": "Withdrawn"}
DATASTORE_NAMES = ("SQLite", "Redis")
SWEEP_TOLERANCE = Decimal("0.05")
WEDGES = ("(seal) => Object.fromEntries([...seal.querySelectorAll('[data-module-id]')].map(w => "
          "[w.getAttribute('data-module-id'), {state: w.getAttribute('data-state'), sweep: w.getAttribute('data-sweep')}]))")
LESSON_OPTIONS = ("Option A", "Option B", "Option C")
DEFAULT_LESSONS = ((30, 1), (20, 0))
DEFAULT_EVALUATION = 10
HOURS_IDS = ["delirium-shape", "wound-shape", "quarter"]
HOURS_CASES = {
    "delirium-shape": (((25, 0), (20, 1)), 10, "0.75"),
    "wound-shape": (((30, 2), (30, 0)), 10, "1.00"),
    "quarter": (((40, 1), (34, 0)), 15, "1.25"),
}
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

SERIAL_RE = re.compile(r"SPL-(\d{4})-\d{6}")
INSTANT_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z")
DOWNLOAD_RE = re.compile(r"https?://[^\s\"'<>]+/api/certificates/[^/\s\"'<>]+/pdf\?token=[^\s\"'<>]+")

HTTP_TIMEOUT_S = 30
CLOCK_WAIT_S = 45
SEAL_WAIT_S = 60
MAIL_WAIT_S = 20
NO_MAIL_WAIT_S = 3
MAIL_SETTLE_S = 0.5
POLL_INTERVAL_S = 0.25
REST_WAIT_S = 3
PRESS_WAIT_S = 20
MOTION_FLOOR_MS = 10
TAB_LIMIT = 60
NPM_TIMEOUT_S = 120

_PAUSE = threading.Event()
_NO_BODY = object()

NUMERAL_IS = "(h) => (document.querySelector('[data-seal-numeral]')?.textContent || '').trim() === h"
RING_HAS = "(s) => (document.querySelector('[data-seal-ring]')?.textContent || '').includes(s)"
SEAL_STATE_IS = "(v) => document.querySelector('[data-seal-state]')?.getAttribute('data-seal-state') === v"
ON_SEAL = "(id) => location.pathname === `/learn/${id}/seal`"
SEAL_RECORDER = """
(() => {
  const log = { numerals: [], states: [] };
  window.__sealLog = log;
  const push = (list, value) => { if (value && list[list.length - 1] !== value) list.push(value); };
  const scan = () => {
    const numeral = document.querySelector('[data-seal-numeral]');
    if (numeral) push(log.numerals, (numeral.textContent || '').trim());
    const seal = document.querySelector('[data-seal-state]');
    if (seal) push(log.states, seal.getAttribute('data-seal-state'));
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
})();
"""
RUNNING_ANIMATIONS = ("() => document.getAnimations().filter(a => a.playState === 'running')"
                      ".map(a => String(a.animationName || a.transitionProperty || a.id || 'animation'))")


class Api:
    def __init__(self, base: str, email: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)
        self.id = ""
        self.name = ""
        self.role = ""
        self.user: dict[str, Any] = {}
        if email:
            r = self.http.post("/api/session", json={"email": email, "password": PASSWORD})
            assert r.status_code == 200, (email, r.status_code, r.text[:300])
            self.user = r.json()["user"]
            self.id, self.name, self.role = self.user["id"], self.user["display_name"], self.user["role"]

    def send(self, method: str, path: str, body: Any = _NO_BODY, *, key: str | None = None,
             version: int | None = None, params: dict[str, str] | None = None,
             headers: dict[str, str] | None = None) -> httpx.Response:
        h = dict(headers or {})
        if key is not None:
            h["Idempotency-Key"] = key
        if version is not None:
            h["If-Match"] = f'"{version}"'
        if body is _NO_BODY:
            return self.http.request(method, path, headers=h, params=params)
        return self.http.request(method, path, headers=h, params=params, json=body)

    def get(self, path: str, params: dict[str, str] | None = None) -> httpx.Response:
        return self.send("GET", path, params=params)

    def post(self, path: str, body: Any = _NO_BODY, key: str | None = None, version: int | None = None,
             **headers: str) -> httpx.Response:
        return self.send("POST", path, body, key=key, version=version, headers=headers)

    def patch(self, path: str, body: Any, version: int | None = None, **headers: str) -> httpx.Response:
        return self.send("PATCH", path, body, version=version, headers=headers)

    def delete(self, path: str, **headers: str) -> httpx.Response:
        return self.send("DELETE", path, headers=headers)

    def raw(self, method: str, path: str, content: bytes, content_type: str = "application/json",
            **headers: str) -> httpx.Response:
        return self.http.request(method, path, content=content, headers={"Content-Type": content_type, **headers})


def ok(r: httpx.Response, status: int = 200) -> Any:
    assert r.status_code == status, (r.request.method, str(r.request.url), r.status_code, r.text[:500])
    return r.json() if r.content else {}


def fails(r: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert r.status_code == status, (str(r.request.url), r.status_code, r.text[:500])
    assert r.headers.get("content-type", "").startswith("application/json"), r.headers.get("content-type")
    body = r.json()
    assert body.get("error") == code, body
    return body


def invalid(r: httpx.Response, errors: dict[str, str]) -> None:
    assert r.status_code == 422, (str(r.request.url), r.status_code, r.text[:500])
    assert r.json() == {"errors": errors}


def outage(env: str) -> str:
    url = os.environ.get(env, "")
    assert url, f"{env} is not set"
    return url.rstrip("/")


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def cents(value: str) -> int:
    return int(Decimal(value) * 100)


def money(amount: int) -> str:
    return f"{amount // 100}.{amount % 100:02d}"


def hours_text(minutes: int) -> str:
    quarters = minutes * 4 // 60
    return f"{quarters // 4}.{quarters % 4 * 25:02d}"


def split(list_price: str, percent: str) -> tuple[str, str]:
    employer = cents(list_price) * cents(percent) // 10000
    return money(employer), money(cents(list_price) - employer)


def lessons(course: dict[str, Any]) -> list[dict[str, Any]]:
    return [m for m in course["modules"] if m["kind"] == "lesson"]


def mon_d_yyyy(d: date) -> str:
    return f"{MONTHS[d.month - 1]} {d.day}, {d.year}"


def parse_instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def server_time(r: httpx.Response) -> datetime:
    return parsedate_to_datetime(r.headers["date"])


def provider_today(api: Api) -> date:
    return server_time(api.get("/api/health")).astimezone(PROVIDER_TZ).date()


def poll(fn: Callable[[], Any], pred: Callable[[Any], bool], seconds: float, what: str) -> Any:
    deadline = monotonic() + seconds
    while True:
        value = fn()
        if pred(value):
            return value
        assert monotonic() < deadline, f"timed out waiting for {what}: {value!r}"[:800]
        _PAUSE.wait(POLL_INTERVAL_S)


def together(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        futures = [pool.submit(run, fn) for fn in calls]
        return [f.result() for f in futures]


def new_title(prefix: str) -> str:
    return f"{prefix} {unique('course')[0]}"[:120]


def set_display_name(api: Api, name: str) -> None:
    ok(api.patch("/api/me", {"display_name": name}))
    api.name = name


def course_body(title: str, price: str, lessons: tuple[tuple[int, int], ...], evaluation: int, fmt: str) -> dict[str, Any]:
    modules: list[dict[str, Any]] = []
    for n, (minutes, right) in enumerate(lessons, start=1):
        modules.append({"title": f"Lesson {n}", "minutes": minutes, "kind": "lesson", "body": f"Lesson {n} text.",
                        "question": {"prompt": f"Question {n}?", "options": list(LESSON_OPTIONS), "answer_index": right}})
    modules.append({"title": "Post-evaluation", "minutes": evaluation, "kind": "evaluation"})
    return {"title": title, "summary": "A short invented summary.", "format": fmt, "list_price": price, "modules": modules}


def draft_course(base: str, price: str = "75.00") -> tuple[Api, dict[str, Any]]:
    author = Api(base, AUTHOR)
    body = course_body(new_title("Draft"), price, DEFAULT_LESSONS, DEFAULT_EVALUATION, "self_paced")
    course = ok(author.post("/api/courses", body), 201)["course"]
    assert (course["state"], course["version"]) == ("draft", 1)
    return author, course


def published_course(base: str, price: str = "90.00", lessons: tuple[tuple[int, int], ...] = DEFAULT_LESSONS,
                     evaluation: int = DEFAULT_EVALUATION, fmt: str = "self_paced", title: str | None = None) -> dict[str, Any]:
    author, planner = Api(base, AUTHOR), Api(base, PLANNER)
    body = course_body(title or new_title("Course"), price, lessons, evaluation, "cohort" if fmt == "cohort" else "self_paced")
    created = ok(author.post("/api/courses", body), 201)["course"]
    path = f"/api/courses/{created['id']}"
    ok(author.post(f"{path}/transitions", {"to": "in_review"}, version=1))
    ok(planner.post(f"{path}/transitions", {"to": "published"}, version=2))
    course = ok(planner.get(path))["course"]
    modules = sorted(course["modules"], key=lambda m: m["position"])
    course["modules"] = modules
    course["answers"] = {m["id"]: right for m, (_, right) in zip([m for m in modules if m["kind"] == "lesson"], lessons)}
    course["evaluation_id"] = next(m["id"] for m in modules if m["kind"] == "evaluation")
    return course


def withdraw(base: str, course: dict[str, Any]) -> None:
    planner = Api(base, PLANNER)
    current = ok(planner.get(f"/api/courses/{course['id']}"))["course"]
    ok(planner.post(f"/api/courses/{course['id']}/transitions", {"to": "withdrawn"}, version=current["version"]))


def quote(api: Api, course_id: str) -> dict[str, Any]:
    return ok(api.get("/api/checkout/quote", params={"course_id": course_id}))


def checkout(api: Api, course: dict[str, Any], cohort_id: str | None = None, share: str | None = None,
             key: str | None = None) -> httpx.Response:
    if share is None:
        r = api.get("/api/checkout/quote", params={"course_id": course["id"]})
        share = r.json()["learner_share"] if r.status_code == 200 else "0.00"
    body = {"course_id": course["id"], "cohort_id": cohort_id, "quoted_learner_share": share}
    return api.post("/api/checkout", body, key=key or idempotency_key())


def enrol(api: Api, course: dict[str, Any], cohort_id: str | None = None) -> dict[str, Any]:
    return ok(checkout(api, course, cohort_id), 201)["enrolment"]


def enrolments_for(api: Api, course_id: str) -> list[dict[str, Any]]:
    return [e for e in ok(api.get("/api/me/enrolments"))["enrolments"] if e["course_id"] == course_id]


def answer(api: Api, enrolment_id: str, module_id: str, index: int) -> httpx.Response:
    return api.post(f"/api/enrolments/{enrolment_id}/modules/{module_id}/answer", {"option_index": index})


def study(api: Api, enrolment_id: str, course: dict[str, Any], only: int | None = None) -> None:
    for module_id, right in list(course["answers"].items())[:only]:
        ok(answer(api, enrolment_id, module_id, right))


def evaluate(api: Api, enrolment_id: str, body: dict[str, Any] | None = None) -> httpx.Response:
    return api.post(f"/api/enrolments/{enrolment_id}/evaluation", body if body is not None else {"rating": 5, "met_outcomes": True})


def certificate(api: Api, cert_id: str) -> dict[str, Any]:
    return ok(api.get(f"/api/certificates/{cert_id}"))["certificate"]


def sealed(cert: dict[str, Any]) -> bool:
    return cert["state"] == "sealed" and not cert["reissue_pending"]


def wait_cert(api: Api, cert_id: str, pred: Callable[[dict[str, Any]], bool], seconds: float = SEAL_WAIT_S) -> dict[str, Any]:
    return poll(lambda: certificate(api, cert_id), pred, seconds, f"certificate {cert_id}")


def certify(api: Api, course: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    e = enrol(api, course)
    study(api, e["id"], course)
    r = evaluate(api, e["id"])
    assert r.status_code in (201, 202), r.text[:300]
    return e, wait_cert(api, r.json()["certificate"]["id"], sealed)


def share_link(api: Api, cert_id: str) -> dict[str, Any]:
    return ok(api.post(f"/api/certificates/{cert_id}/share-links"), 201)["link"]


def links_of(api: Api, cert_id: str) -> dict[str, dict[str, Any]]:
    return {l["id"]: l for l in ok(api.get(f"/api/certificates/{cert_id}/share-links"))["links"]}


def token_of(url: str) -> str:
    return url.rsplit("/verify/", 1)[1].split("?")[0].split("#")[0]


def refund_request(api: Api, enrolment_id: str, reason: str = REFUND_REASON) -> httpx.Response:
    return api.post(f"/api/enrolments/{enrolment_id}/refund-request", {"reason": reason})


def queue_entry(planner: Api, request_id: str) -> dict[str, Any]:
    return next(r for r in ok(planner.get("/api/refund-requests"))["refund_requests"] if r["id"] == request_id)


def add_cohort(planner: Api, course_id: str, cap: int, close_date: str = OPEN_CLOSE_DATE,
               starts_on: str = OPEN_START_DATE) -> dict[str, Any]:
    body = {"name": f"Cohort {unique('cohort')[0]}"[:80], "seat_cap": cap, "starts_on": starts_on, "close_date": close_date}
    return ok(planner.post(f"/api/courses/{course_id}/cohorts", body), 201)["cohort"]


def cohort_of(api: Api, cohort_id: str) -> dict[str, Any]:
    return ok(api.get(f"/api/cohorts/{cohort_id}"))["cohort"]


def buy_pack(api: Api, course_id: str, seats: int, key: str | None = None) -> httpx.Response:
    return api.post("/api/sponsor/packs", {"course_id": course_id, "seats": seats}, key=key or idempotency_key())


def assign(api: Api, pack_id: str, nurse_id: str) -> httpx.Response:
    return api.post(f"/api/sponsor/packs/{pack_id}/assignments", {"nurse_id": nurse_id})


def pack_of(api: Api, pack_id: str) -> dict[str, Any]:
    return next(p for p in ok(api.get("/api/sponsor/packs"))["packs"] if p["id"] == pack_id)


def ledger(api: Api, pack_id: str) -> dict[str, Any]:
    return ok(api.get(f"/api/sponsor/packs/{pack_id}/ledger"))


def movements(entries: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for e in entries:
        grouped.setdefault(e["movement_id"], []).append(e)
    return grouped


def export_rows(api: Api, start: str, end: str) -> tuple[dict[str, Any], str]:
    export = ok(api.post("/api/sponsor/exports", {"from": start, "to": end}), 201)["export"]
    r = api.get(export["download_url"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv"), r.text[:300]
    return export, r.text


def csv_records(raw: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(raw)))


def capability_headers(r: httpx.Response) -> None:
    assert "no-store" in r.headers.get("cache-control", "").lower(), (str(r.request.url), r.headers.get("cache-control"))
    assert r.headers.get("referrer-policy", "").lower() == "no-referrer", (str(r.request.url), r.headers.get("referrer-policy"))


def pdf_strings(pdf: bytes) -> str:
    assert pdf.startswith(b"%PDF")
    parts = [pdf]
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S):
        try:
            parts.append(zlib.decompress(m.group(1)))
        except zlib.error:
            continue
    return b"\n".join(parts).decode("latin-1")


def pdf_text(pdf: str) -> str:
    return "\n".join(re.findall(r"\((?:\\.|[^\\)])*\)", pdf))


def kb_txs(payment: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [t for t in payment.get("transactions") or [] if t.get("transactionType") == kind]


def kb_cents(amount: Any) -> int:
    return int(Decimal(str(amount)) * 100)


def kb_purchase(killbill: KillBill, payment_key: str, account_key: str) -> int:
    payment = killbill.payment_by_key(payment_key)
    account = killbill.account_by_key(account_key)
    assert payment is not None and account is not None, (payment_key, account_key)
    assert payment["accountId"] == account["accountId"]
    purchases = kb_txs(payment, "PURCHASE")
    assert len(purchases) == 1, payment
    return kb_cents(purchases[0]["amount"])


def mail_to(mail: Mailpit, subject: str, to: str | None = None, expected: int = 1,
            seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = monotonic() + seconds
    while True:
        found = [m for m in mail.messages(settle=MAIL_SETTLE_S) if m.get("Subject") == subject
                 and (to is None or to.lower() in [a.lower() for a in addresses(m.get("To"))])]
        if len(found) >= expected or monotonic() >= deadline:
            return found


def only_mail(mail: Mailpit, subject: str, to: str | None) -> list[dict[str, Any]]:
    found = mail_to(mail, subject, to)
    return found if len(found) != 1 else mail_to(mail, subject, to, expected=2, seconds=NO_MAIL_WAIT_S * 2)


@contextmanager
def ui(browser: Browser, base: str, email: str | None, path: str | None, *, recorder: bool = False,
       reduced_motion: str = "no-preference", paused: bool = False,
       viewport: tuple[int, int] | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/signin", reduced_motion=reduced_motion) as page:
        if viewport:
            page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        if not paused:
            page.clock.resume()
        if email:
            api = Api(base, email)
            page.context.add_cookies([{"name": SESSION_COOKIE, "value": api.http.cookies.get(SESSION_COOKIE) or "", "url": base}])
        if recorder:
            page.add_init_script(SEAL_RECORDER)
        if path:
            page.goto(base + path)
        yield page


def status(page: Page) -> Locator:
    return page.get_by_role("status", name="Activity status")


def alert(page: Page, copy: str) -> Locator:
    return page.get_by_role("alert").filter(has_text=copy)


def entry(page: Page, title: str) -> Locator:
    return page.get_by_role("row").or_(page.get_by_role("listitem")).or_(page.get_by_role("article")).filter(has_text=title).last


def focused(target: Locator) -> bool:
    return bool(target.evaluate("(el) => el === document.activeElement || el.contains(document.activeElement)"))


POINTER_TARGET = """e => {
  const hits = t => { t.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
    const r = t.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y); return hit === t || t.contains(hit) || e.contains(hit) ? [x, y] : null; };
  const label = (e.labels && e.labels[0]) || e.closest('label');
  return hits(e) || (label && hits(label)); }"""


def pick(radio: Locator) -> None:
    expect(radio).to_be_visible()
    expect(radio).to_be_enabled()
    point = radio.evaluate(POINTER_TARGET)
    assert point, "radio and its label are obscured at the pointer target"
    radio.page.mouse.click(*point)


def course_block(region: Locator, title: str, control: Locator) -> Locator:
    return region.locator("*").filter(has_text=title).filter(has=control).last


def seats_remaining(n: int) -> re.Pattern[str]:
    return re.compile(rf"Seats remaining\s*:?\s*{n}(?!\d)")


def contrast_violations(page: Page) -> list[dict[str, Any]]:
    page.add_script_tag(path=str(conftest.AXE))
    page.evaluate(
        """() => { window.__contrast = null;
          axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } })
            .then(r => { window.__contrast = { violations: r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })) }; },
                  e => { window.__contrast = { error: String(e) }; }); }"""
    )
    for _ in range(625):
        result = page.evaluate("() => window.__contrast")
        if result is not None:
            assert "error" not in result, result
            return result["violations"]
        advance(page, 16)
    raise AssertionError("axe contrast audit did not settle under controlled time")


def tab_until(page: Page, target: Locator, shift: bool = False) -> None:
    for _ in range(TAB_LIMIT):
        if focused(target):
            return
        page.keyboard.press("Shift+Tab" if shift else "Tab")
    assert focused(target), "control not reachable with Tab"


@contextmanager
def held_sealing(page: Page, enrolment_id: str) -> Iterator[None]:
    def sealing(node: Any) -> Any:
        if isinstance(node, list):
            return [sealing(v) for v in node]
        if not isinstance(node, dict):
            return node
        node = {k: sealing(v) for k, v in node.items()}
        if node.get("enrolment_id") == enrolment_id and "serial" in node:
            node.update(state="sealing", issued_on=None, reissue_pending=False,
                        versions=[{**v, "state": "sealing", "sealed_on": None} for v in node.get("versions") or []])
        elif node.get("id") == enrolment_id and node.get("state") == "certified":
            node["state"] = "completed"
        return node

    def answer(route: Any) -> None:
        response = route.fetch()
        if "json" not in (response.headers.get("content-type") or ""):
            route.fulfill(response=response)
            return
        evaluation = route.request.method == "POST" and route.request.url.endswith("/evaluation")
        route.fulfill(response=response, status=202 if evaluation and response.status == 201 else response.status,
                      json=sealing(response.json()))

    page.route("**/api/**", answer)
    try:
        yield
    finally:
        page.unroute("**/api/**", answer)


def perceptible(listed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [a for a in listed if a["duration"] > MOTION_FLOOR_MS]


def seal_log(page: Page) -> dict[str, list[str]]:
    return page.evaluate("() => window.__sealLog")


def settled_numerals(page: Page) -> list[str]:
    numerals = seal_log(page)["numerals"]
    while len(numerals) > 1 and numerals[0] == "0.00":
        numerals = numerals[1:]
    return numerals


def running(page: Page) -> list[str]:
    return page.evaluate(RUNNING_ANIMATIONS)


def step_until(page: Page, ready: Callable[[], bool], seconds: float, step: float = PRESS_STEP_MS) -> None:
    deadline = monotonic() + seconds
    while not ready():
        assert monotonic() < deadline, "timed out waiting for the completion screen to settle"
        advance(page, step)
        _PAUSE.wait(POLL_INTERVAL_S)


def ring_visible(styles: dict[str, str]) -> bool:
    outline = styles.get("outline-style", "none") not in ("none", "") and styles.get("outline-width", "0px") not in ("0px", "")
    return outline or styles.get("box-shadow", "none") not in ("none", "")


def small_controls(page: Page) -> list[str]:
    bad: list[str] = []
    for role in ("button", "link", "textbox", "combobox", "spinbutton", "searchbox"):
        for loc in page.get_by_role(role).all():
            if not loc.is_visible():
                continue
            box = loc.bounding_box()
            if not box or box["width"] <= 1 or box["height"] <= 1:
                continue
            if box["width"] < TAP_MIN - 0.5 or box["height"] < TAP_MIN - 0.5:
                bad.append(f"{role} {loc.evaluate('(el) => el.textContent || el.getAttribute(\"aria-label\") || \"\"')!r}: {box}")
    return bad


def provider_date(instant: str) -> date:
    return parse_instant(instant).astimezone(PROVIDER_TZ).date()


def test_health(app_url: str) -> None:
    for base in (app_url, outage(KB_DOWN_ENV), outage(MINIO_DOWN_ENV), outage(SHORT_CLOCK_ENV)):
        r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, (base, r.text[:200])
        assert r.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize("role", list(ROLE_CASES), ids=list(ROLE_CASES))
def test_seeded_sign_in_and_roles(browser: Browser, app_url: str, role: str) -> None:
    anon = Api(app_url)
    for who in ROLE_CASES[role]:
        email, name, seeded_role, org, _, licence, dob = SEEDED[who]
        api = Api(app_url, email)
        me = ok(api.get("/api/me"))["user"]
        assert (me["email"], me["role"]) == (email, seeded_role)
        assert (me["organisation"] or {}).get("name") == org
        if seeded_role == "learner":
            assert (me["licence_number"], me["date_of_birth"]) == (licence, dob)
        invalid(anon.post("/api/session", {"email": email, "password": "not-the-password"}),
                {"password": "Email or password is incorrect."})
    email = SEEDED[ROLE_CASES[role][0]][0]
    with ui(browser, app_url, None, None, viewport=(1280, 800)) as page:
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("heading", name="Courses", level=1)).to_be_visible()
        nav = page.get_by_role("navigation", name="Main")
        expect(nav.get_by_role("link", name="Courses")).to_be_visible()
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()
        expected = {"Transcript": role == "learner", "Hospital seats": role == "coordinator",
                    "Planner": role == "planner", "Authoring": role in ("author", "planner")}
        for link, shown in expected.items():
            expect(nav.get_by_role("link", name=link, exact=True)).to_have_count(1 if shown else 0)
    api = Api(app_url, email)
    refused = {
        "learner": [("GET", "/api/refund-requests"), ("GET", "/api/sponsor/dashboard"), ("GET", "/api/planner/certificates"), ("POST", "/api/courses")],
        "coordinator": [("GET", "/api/me/transcript"), ("GET", "/api/refund-requests"), ("POST", "/api/courses"), ("GET", "/api/me/enrolments")],
        "planner": [("GET", "/api/me/transcript"), ("GET", "/api/sponsor/packs"), ("POST", "/api/courses")],
        "author": [("GET", "/api/sponsor/dashboard"), ("GET", "/api/refund-requests"), ("GET", "/api/me/transcript")],
    }[role]
    for method, path in refused:
        r = api.send(method, path, {}) if method == "POST" else api.send(method, path)
        fails(r, 403, "forbidden")
    allowed = {"learner": "/api/me/transcript", "coordinator": "/api/sponsor/dashboard",
               "planner": "/api/refund-requests", "author": "/api/courses"}[role]
    assert api.get(allowed).status_code == 200


def test_error_shape_and_precedence(app_url: str) -> None:
    anon = Api(app_url)
    for method, path in (("PUT", "/api/courses"), ("DELETE", "/api/me")):
        fails(anon.send(method, path, {}), 405, "method_not_allowed")
    big = b'{"x":"' + b"a" * BODY_LIMIT + b'"}'
    fails(anon.raw("POST", "/api/checkout", big), 413, "payload_too_large")
    fails(anon.raw("POST", "/api/checkout", b"{}", "text/plain"), 415, "unsupported_media_type")
    fails(anon.raw("POST", "/api/checkout", b'{"course_id":'), 400, "invalid_json")
    fails(anon.post("/api/checkout", {}), 401, "unauthenticated")
    fails(anon.get("/api/me"), 401, "unauthenticated")
    grace, ana = Api(app_url, GRACE), Api(app_url, ANA)
    fails(grace.get(f"/api/enrolments/{uuid.uuid4()}"), 404, "not_found")
    fails(ana.get(f"/api/sponsor/learners/{uuid.uuid4()}"), 404, "not_found")
    course = published_course(app_url)
    fails(ana.patch(f"/api/courses/{course['id']}", {"title": ""}), 403, "forbidden")
    author, draft = draft_course(app_url)
    path = f"/api/courses/{draft['id']}"
    fails(author.patch(path, {"title": ""}), 428, "version_required")
    ok(author.patch(path, {"summary": "Second draft."}, version=1))
    r = Api(app_url, PLANNER).post(f"{path}/transitions", {"to": "published"}, version=1)
    assert r.status_code == 412 and r.json() == {"error": "stale_version", "current_version": 2}
    bad = {"title": "", "summary": "s", "format": "self_paced", "list_price": "5000.01", "modules": []}
    invalid(author.post("/api/courses", bad), {
        "title": "Enter a course title of 1 to 120 characters.",
        "list_price": "Enter a price from 0.00 to 5000.00 with two decimals.",
        "modules": "Add at least one lesson and exactly one post-evaluation, placed last."})
    gone = published_course(app_url)
    withdraw(app_url, gone)
    fails(checkout(ana, gone, share="abc"), 409, "course_not_open")
    down = Api(outage(KB_DOWN_ENV), ANA)
    invalid(checkout(down, course, share="abc"), {"quoted_learner_share": "Refresh the quote and try again."})
    assert enrolments_for(ana, course["id"]) == []


def test_server_boundary(app_url: str) -> None:
    anon = Api(app_url)
    prefix, suffix = b'{"email":"', b'","password":"x"}'
    exact = prefix + b"a" * (BODY_LIMIT - len(prefix) - len(suffix)) + suffix
    assert len(exact) == BODY_LIMIT
    r = anon.raw("POST", "/api/session", exact)
    assert r.status_code == 422, r.text[:200]
    over = prefix + b"a" * (BODY_LIMIT + 1 - len(prefix) - len(suffix)) + suffix
    fails(anon.raw("POST", "/api/session", over), 413, "payload_too_large")
    fails(anon.raw("POST", "/api/session", b"email=x", "application/x-www-form-urlencoded"), 415, "unsupported_media_type")
    fails(anon.raw("POST", "/api/session", b'{"email":'), 400, "invalid_json")
    ana = Api(app_url, ANA)
    foreign = "http://evil.example"
    fails(ana.patch("/api/me", {"display_name": "Cross Site"}, Origin=foreign), 403, "cross_origin")
    fails(ana.delete("/api/session", Origin=foreign), 403, "cross_origin")
    me = ok(ana.get("/api/me"))["user"]
    assert me["display_name"] == ana.name
    assert ana.patch("/api/me", {"display_name": ana.name}, Origin=origin_of(app_url)).status_code == 200
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json"):
        r = anon.get(path)
        assert r.status_code == 404, path
        assert "run-manifest-v1" not in r.text, path


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_three_viewports(browser: Browser, app_url: str, viewport: str) -> None:
    width, height, total_rows = VIEWPORTS[viewport]
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    e, cert = certify(dev, course)
    token = token_of(share_link(dev, cert["id"])["url"])
    module_id = next(iter(course["answers"]))
    screens: dict[str | None, list[tuple[str, str, str]]] = {
        None: [("/signin", "button", "Sign in"), (f"/verify/{token}", "heading", "Certificate verification")],
        DEV: [("/courses", "heading", "Courses"), (f"/courses/{course['id']}", "heading", course["title"]),
              ("/learning", "heading", "My learning"), ("/transcript", "heading", "Transcript"),
              (f"/learn/{e['id']}/{module_id}", "heading", "Lesson 1"), (f"/learn/{e['id']}/seal", "heading", "Your contact-hour seal")],
        GRACE: [("/sponsor", "heading", "Hospital seats")],
        PLANNER: [("/planner", "heading", "Planner"), ("/author", "heading", "Authoring")],
    }
    for email, paths in screens.items():
        with ui(browser, app_url, email, None, viewport=(width, height)) as page:
            for path, role, name in paths:
                page.goto(app_url + path)
                expect(page.get_by_role(role, name=name).first).to_be_visible()
                layout(page)
                if email and width == 375:
                    expect(page.get_by_role("button", name="Menu")).to_be_visible()
                if path == "/sponsor":
                    totals = page.get_by_role("region", name="Totals")
                    tops = sorted((totals.get_by_text(label, exact=True).bounding_box() or {"y": -1})["y"]
                                  for label in ("Seats purchased", "Assigned", "Available", "Expired", "Completions", "Hours awarded"))
                    rows = 1 + sum(1 for a, b in zip(tops, tops[1:]) if b - a > 4)
                    assert rows == total_rows, tops


def test_calm_motion(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    e, _ = certify(dev, course)
    with ui(browser, app_url, DEV, None) as page:
        for path, name in (("/courses", "Courses"), (f"/courses/{course['id']}", course["title"]), ("/learning", "My learning"),
                           ("/transcript", "Transcript"), (f"/learn/{e['id']}/seal", "Your contact-hour seal")):
            page.goto(app_url + path)
            expect(page.get_by_role("heading", name=name).first).to_be_visible()
            poll(lambda: running(page), lambda a: a == [], REST_WAIT_S, f"motion at rest on {path}")
        expect(page.get_by_role("button", name="Show result now")).to_have_count(0)
        page.goto(app_url + "/courses")
        link = page.get_by_role("link", name=course["title"])
        props = ("transform", "translate", "scale", "rotate", "top", "left", "margin-top", "margin-left")
        for target in (link, page.get_by_role("button", name="Sign out")):
            rest, hover = state_styles(target, *props, state="hover")
            assert {p: rest.get(p) for p in props} == {p: hover.get(p) for p in props}


def test_keyboard_focus_and_dialogs(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    fresh = published_course(app_url)
    dev = Api(app_url, DEV)
    certify(dev, course)
    with ui(browser, app_url, None, "/signin", viewport=(1280, 800)) as page:
        expect(page.get_by_role("button", name="Sign in")).to_be_visible()
        order = tab_order(page, 6)
        positions = [order.index(n) for n in ("Email", "Password", "Sign in")]
        assert positions == sorted(positions), order
        for target in (page.get_by_role("textbox", name="Email"), page.get_by_role("button", name="Sign in")):
            rest, focus = state_styles(target, "outline-style", "outline-width", "box-shadow", state="focus")
            assert ring_visible(focus) and focus != rest, (rest, focus)
    with ui(browser, app_url, DEV, f"/courses/{fresh['id']}", viewport=(1280, 800)) as page:
        expect(page.get_by_role("button", name="Enrol")).to_be_visible()
        order = tab_order(page, TAB_LIMIT)
        assert "Courses" in order and "Enrol" in order and order.index("Courses") < order.index("Enrol"), order
        rest, focus = state_styles(page.get_by_role("button", name="Enrol"), "outline-style", "outline-width", "box-shadow", state="focus")
        assert ring_visible(focus) and focus != rest
    with ui(browser, app_url, DEV, "/transcript", viewport=(1280, 800)) as page:
        share = page.get_by_role("table", name="Certificates").get_by_role("row").filter(has_text=course["title"]).get_by_role("button", name="Share")
        tab_until(page, share)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Share with a verifier")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("textbox", name="Verification link")).to_be_focused()
        for key in ("Tab", "Shift+Tab"):
            for _ in range(12):
                page.keyboard.press(key)
                assert focused(dialog), key
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(share).to_be_focused()
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        tab_until(page, dialog.get_by_role("button", name="Close"))
        page.keyboard.press("Enter")
        expect(dialog).to_be_hidden()
        expect(share).to_be_focused()


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    other = published_course(app_url)
    dev = Api(app_url, DEV)
    e = enrol(dev, course)
    study(dev, e["id"], course)
    hours = hours_text(60)
    with ui(browser, app_url, DEV, f"/learn/{e['id']}/evaluation", recorder=True, reduced_motion="reduce", paused=True) as page:
        pick(page.get_by_role("radiogroup", name="Overall rating").get_by_role("radio", name="3"))
        pick(page.get_by_role("radiogroup", name="Did this activity meet its stated outcomes?").get_by_role("radio", name="No"))
        click(page.get_by_role("button", name="Submit evaluation"))
        step_until(page, lambda: page.evaluate(ON_SEAL, e["id"]), PRESS_WAIT_S)
        cert = wait_cert(dev, ok(dev.get(f"/api/enrolments/{e['id']}"))["enrolment"]["certificate_id"], sealed)
        step_until(page, lambda: page.evaluate(SEAL_STATE_IS, "sealed"), SEAL_WAIT_S, step=PAGE_POLL_MS)
        seal = page.get_by_role("img", name="Contact-hour seal")
        assert page.evaluate(NUMERAL_IS, hours), seal_log(page)
        assert page.evaluate(RING_HAS, cert["serial"])
        expect(page.get_by_role("button", name="Show result now")).to_have_count(0)
        expect(page.get_by_role("status", name="Seal status")).to_contain_text(f"Certificate sealed: {hours} contact hours, serial {cert['serial']}")
        assert settled_numerals(page) == [hours], seal_log(page)
        assert perceptible(animations(seal)) == []
    with ui(browser, app_url, DEV, f"/courses/{other['id']}", reduced_motion="reduce", paused=True) as page:
        click(page.get_by_role("button", name="Enrol"))
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog).to_be_visible()
        assert perceptible(animations(dialog)) == []


def test_contrast_and_tap_targets(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    e, cert = certify(dev, course)
    token = token_of(share_link(dev, cert["id"])["url"])
    module_id = next(iter(course["answers"]))
    screens: dict[str | None, list[tuple[str, str, str]]] = {
        None: [("/signin", "button", "Sign in"), (f"/verify/{token}", "heading", "Certificate verification")],
        DEV: [("/courses", "heading", "Courses"), (f"/courses/{course['id']}", "heading", course["title"]),
              ("/learning", "heading", "My learning"), ("/transcript", "heading", "Transcript"),
              (f"/learn/{e['id']}/{module_id}", "heading", "Lesson 1"), (f"/learn/{e['id']}/seal", "heading", "Your contact-hour seal")],
        GRACE: [("/sponsor", "heading", "Hospital seats")],
        PLANNER: [("/planner", "heading", "Planner"), ("/author", "heading", "Authoring")],
    }
    for email, paths in screens.items():
        with ui(browser, app_url, email, None, viewport=(375, 812)) as page:
            for path, role, name in paths:
                page.goto(app_url + path)
                expect(page.get_by_role(role, name=name).first).to_be_visible()
                assert contrast_violations(page) == [], path
                assert small_controls(page) == [], path


def test_employer_and_learner_shares(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    sepsis_like, delirium_like, free = published_course(app_url, price="90.00"), published_course(app_url, price="45.50"), published_course(app_url, price="0.00")
    ana, cara, dev = Api(app_url, ANA), Api(app_url, CARA), Api(app_url, DEV)
    cases = [
        (ana, sepsis_like, "45.00", "45.00", "co_pay", HARBOURVIEW, "credwell-hospital-harbourview"),
        (cara, delirium_like, "15.16", "30.34", "co_pay", LINDEN, "credwell-hospital-linden-valley"),
        (dev, delirium_like, "0.00", "45.50", "card", None, None),
    ]
    for nurse, course, employer, learner, funding, sponsor, hospital_key in cases:
        q = quote(nurse, course["id"])
        assert (q["list_price"], q["employer_share"], q["learner_share"], q["sponsor"]) == (course["list_price"], employer, learner, sponsor)
        assert cents(q["employer_share"]) + cents(q["learner_share"]) == cents(q["list_price"])
        e = enrol(nurse, course)
        assert (e["employer_share"], e["learner_share"], e["funding"], e["state"]) == (employer, learner, funding, "confirmed")
        assert kb_purchase(killbill, f"enrol-{e['id']}-learner", f"credwell-nurse-{nurse.id}") == cents(learner)
        account = killbill.account_by_key(f"credwell-nurse-{nurse.id}")
        assert account is not None and account["currency"] == "USD"
        if hospital_key:
            assert kb_purchase(killbill, f"enrol-{e['id']}-employer", hospital_key) == cents(employer)
        else:
            assert killbill.payment_by_key(f"enrol-{e['id']}-employer") is None
    e = enrol(dev, free)
    assert (e["learner_share"], e["employer_share"], e["funding"]) == ("0.00", "0.00", "card")
    assert killbill.payment_by_key(f"enrol-{e['id']}-learner") is None
    assert killbill.payment_by_key(f"enrol-{e['id']}-employer") is None
    assert len(mail_to(mail, f"Credwell receipt: {free['title']}", DEV)) == 1


def test_checkout_idempotency(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    course, other, twin_course = published_course(app_url), published_course(app_url), published_course(app_url)
    ana = Api(app_url, ANA)
    share = quote(ana, course["id"])["learner_share"]
    body = {"course_id": course["id"], "cohort_id": None, "quoted_learner_share": share}
    fails(ana.post("/api/checkout", body), 400, "idempotency_key_required")
    fails(ana.post("/api/checkout", body, key="short"), 400, "idempotency_key_required")
    key = idempotency_key()
    fails(ana.post("/api/checkout", {**body, "quoted_learner_share": money(cents(share) + 1)}, key=key), 409, "quote_changed")
    assert enrolments_for(ana, course["id"]) == []
    first = ana.post("/api/checkout", body, key=key)
    e = ok(first, 201)["enrolment"]
    replay = ana.post("/api/checkout", body, key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    fails(ana.post("/api/checkout", {**body, "course_id": other["id"]}, key=key), 409, "idempotency_key_reused")
    assert enrolments_for(ana, other["id"]) == []
    assert [x["id"] for x in enrolments_for(ana, course["id"])] == [e["id"]]
    account = killbill.account_by_key(f"credwell-nurse-{ana.id}")
    assert account is not None
    paid = [p for p in killbill.payments(account["accountId"]) if p.get("paymentExternalKey") == f"enrol-{e['id']}-learner"]
    assert len(paid) == 1 and len(kb_txs(paid[0], "PURCHASE")) == 1
    assert len(only_mail(mail, f"Credwell receipt: {course['title']}", ANA)) == 1

    shared_key = idempotency_key()
    clients = [Api(app_url, ANA), Api(app_url, ANA)]
    twin_body = {"course_id": twin_course["id"], "cohort_id": None, "quoted_learner_share": quote(ana, twin_course["id"])["learner_share"]}
    results = together(*[lambda c=c: c.post("/api/checkout", twin_body, key=shared_key) for c in clients])
    assert [r.status_code for r in results] == [201, 201], [r.text for r in results]
    assert results[0].json() == results[1].json()
    assert len(enrolments_for(ana, twin_course["id"])) == 1
    assert len(only_mail(mail, f"Credwell receipt: {twin_course['title']}", ANA)) == 1


def test_checkout_atomic(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    course = published_course(app_url, price="90.00")
    ana = Api(app_url, ANA)
    q = quote(ana, course["id"])
    account = killbill.account_by_key(f"credwell-nurse-{ana.id}")
    before = len(killbill.payments(account["accountId"])) if account else 0
    key = idempotency_key()
    fails(checkout(Api(outage(KB_DOWN_ENV), ANA), course, share=q["learner_share"], key=key), 503, "payments_unavailable")
    assert enrolments_for(ana, course["id"]) == []
    account = killbill.account_by_key(f"credwell-nurse-{ana.id}")
    assert (len(killbill.payments(account["accountId"])) if account else 0) == before
    assert mail_to(mail, f"Credwell receipt: {course['title']}", ANA, seconds=NO_MAIL_WAIT_S) == []
    e = ok(checkout(ana, course, share=q["learner_share"], key=key), 201)["enrolment"]
    assert e["state"] == "confirmed"
    assert kb_purchase(killbill, f"enrol-{e['id']}-learner", f"credwell-nurse-{ana.id}") == cents(q["learner_share"])
    assert kb_purchase(killbill, f"enrol-{e['id']}-employer", "credwell-hospital-harbourview") == cents(q["employer_share"])
    receipts = only_mail(mail, f"Credwell receipt: {course['title']}", ANA)
    assert len(receipts) == 1
    body = text(receipts[0])
    for part in (ana.name, course["title"], f"You paid ${q['learner_share']}", e["id"]):
        assert part in body, part
    assert addresses(receipts[0].get("From")) == [mail_from_address()]


def test_keyboard_checkout(browser: Browser, app_url: str) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    add_cohort(planner, course["id"], cap=3)
    target = add_cohort(planner, course["id"], cap=3)
    with ui(browser, app_url, ANA, f"/courses/{course['id']}") as page:
        group = page.get_by_role("radiogroup", name="Cohort")
        expect(group).to_be_visible()
        tab_until(page, group)
        radio = group.get_by_role("radio", name=target["name"])
        if not radio.is_checked():
            page.keyboard.press("Space")
        for _ in range(4):
            if radio.is_checked():
                break
            page.keyboard.press("ArrowDown")
        expect(radio).to_be_checked()
        enrol_button = page.get_by_role("button", name="Enrol")
        tab_until(page, enrol_button)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog).to_be_visible()
        assert focused(dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(enrol_button).to_be_focused()
        page.keyboard.press("Space")
        expect(dialog).to_be_visible()
        pay = dialog.get_by_role("button", name=re.compile(r"^(Pay \$|Confirm enrolment$)"))
        tab_until(page, pay)
        page.keyboard.press("Enter")
        expect(dialog).to_be_hidden()
        expect(page.get_by_role("link", name="Continue learning")).to_be_focused()
    [e] = enrolments_for(Api(app_url, ANA), course["id"])
    assert e["cohort_id"] == target["id"] and e["state"] == "confirmed"


def test_last_cohort_seat_race(app_url: str, mail: Mailpit) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    cohort = add_cohort(planner, course["id"], cap=1)
    nurses = [Api(app_url, e) for e in (ANA, BEN, CARA, DEV)]
    shares = [quote(n, course["id"])["learner_share"] for n in nurses]
    results = together(*[lambda n=n, s=s: checkout(n, course, cohort["id"], share=s) for n, s in zip(nurses, shares)])
    winners = [i for i, r in enumerate(results) if r.status_code == 201]
    assert len(winners) == 1, [(r.status_code, r.text[:200]) for r in results]
    for i, r in enumerate(results):
        if i != winners[0]:
            assert r.status_code == 409 and r.json() == {"error": "cohort_full", "waitlist": True}, r.text
            assert enrolments_for(nurses[i], course["id"]) == []
    view = cohort_of(planner, cohort["id"])
    assert view["seats_remaining"] == 0 and [x["nurse_name"] for x in view["roster"]] == [nurses[winners[0]].name]
    receipts = only_mail(mail, f"Credwell receipt: {course['title']}", None)
    assert len(receipts) == 1 and SEEDED_EMAIL_OF(nurses[winners[0]]) in [a.lower() for a in addresses(receipts[0].get("To"))]


def SEEDED_EMAIL_OF(api: Api) -> str:
    return str(api.user["email"]).lower()


def test_cohort_waitlist(app_url: str) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    cohort = add_cohort(planner, course["id"], cap=1)
    roomy = add_cohort(planner, course["id"], cap=5)
    path = f"/api/cohorts/{cohort['id']}/waitlist"
    ana = Api(app_url, ANA)
    fails(Api(app_url, BEN).post(f"/api/cohorts/{roomy['id']}/waitlist"), 409, "seats_available")
    enrol(ana, course, cohort["id"])
    fails(ana.post(path), 409, "already_enrolled")
    joiners = [Api(app_url, e) for e in (BEN, CARA, DEV)]
    results = together(*[lambda j=j: j.post(path) for j in joiners])
    assert [r.status_code for r in results] == [201, 201, 201], [r.text for r in results]
    entries = {j.id: r.json()["waitlist_entry"] for j, r in zip(joiners, results)}
    assert sorted(e["position"] for e in entries.values()) == [1, 2, 3]
    again = joiners[0].post(path)
    assert again.status_code == 200 and again.json()["waitlist_entry"] == entries[joiners[0].id]
    view = cohort_of(planner, cohort["id"])
    assert [w["position"] for w in view["waitlist"]] == [1, 2, 3]
    order = [w["nurse_name"] for w in view["waitlist"]]
    leaver = next(j for j in joiners if j.name == order[1])
    assert leaver.delete(path).status_code == 204
    view = cohort_of(planner, cohort["id"])
    assert [(w["position"], w["nurse_name"]) for w in view["waitlist"]] == [(1, order[0]), (2, order[2])]
    fails(leaver.delete(path), 404, "not_found")
    ok(planner.patch(f"/api/cohorts/{cohort['id']}", {"seat_cap": 2}))
    last = next(j for j in joiners if j.name == order[2])
    enrol(last, course, cohort["id"])
    assert [w["nurse_name"] for w in cohort_of(planner, cohort["id"])["waitlist"]] == [order[0]]


def test_cohort_enrolment_closes(app_url: str) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    closed = add_cohort(planner, course["id"], cap=5, close_date=PAST_CLOSE_DATE, starts_on=PAST_START_DATE)
    assert (closed["closes_at"], closed["open"]) == (PAST_CLOSES_AT, False)
    dev = Api(app_url, DEV)
    assert server_time(dev.get("/api/health")) > parse_instant(closed["closes_at"])
    fails(checkout(dev, course, closed["id"]), 409, "enrolment_closed")
    fails(dev.post(f"/api/cohorts/{closed['id']}/waitlist"), 409, "enrolment_closed")
    assert enrolments_for(dev, course["id"]) == []
    today = provider_today(dev)
    same_day = add_cohort(planner, course["id"], cap=1, close_date=today.isoformat(), starts_on=today.isoformat())
    expected = datetime.combine(today, time(23, 59, 59, 999000), tzinfo=PROVIDER_TZ).astimezone(timezone.utc)
    assert parse_instant(same_day["closes_at"]) == expected and same_day["open"] is True
    assert enrol(dev, course, same_day["id"])["cohort_id"] == same_day["id"]
    eli = Api(app_url, ELI)
    opioid = next(c for c in ok(eli.get("/api/courses"))["courses"] if c["title"] == "Safe Opioid Stewardship")
    cohorts = {c["name"]: c for c in ok(eli.get(f"/api/courses/{opioid['id']}"))["course"]["cohorts"]}
    winter = cohorts["Winter archive cohort"]
    assert (winter["closes_at"], winter["open"]) == ("2026-01-16T05:59:59.999Z", False)
    assert cohorts["Spring evening cohort"]["closes_at"] == "2030-04-04T04:59:59.999Z"
    fails(checkout(eli, opioid, winter["id"]), 409, "enrolment_closed")


def test_seats_remaining_recomputed(app_url: str) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    cohort = add_cohort(planner, course["id"], cap=3)
    ana, ben, cara = Api(app_url, ANA), Api(app_url, BEN), Api(app_url, CARA)

    def remaining() -> int:
        seen = {cohort_of(planner, cohort["id"])["seats_remaining"], cohort_of(cara, cohort["id"])["seats_remaining"],
                next(c for c in ok(cara.get(f"/api/courses/{course['id']}"))["course"]["cohorts"] if c["id"] == cohort["id"])["seats_remaining"]}
        assert len(seen) == 1, seen
        return seen.pop()

    assert remaining() == 3
    enrol(ana, course, cohort["id"])
    ben_e = enrol(ben, course, cohort["id"])
    assert remaining() == 1
    request = ok(refund_request(ben, ben_e["id"]), 201)["refund_request"]
    ok(planner.post(f"/api/refund-requests/{request['id']}/approve", {}))
    assert remaining() == 2
    fails(planner.patch(f"/api/cohorts/{cohort['id']}", {"seat_cap": 0}), 409, "cap_below_enrolled")
    invalid(planner.patch(f"/api/cohorts/{cohort['id']}", {"seat_cap": 501}), {"seat_cap": "Seat cap must be a whole number from 1 to 500."})
    assert ok(planner.patch(f"/api/cohorts/{cohort['id']}", {"seat_cap": 1}))["cohort"]["seats_remaining"] == 0
    assert remaining() == 0
    fails(checkout(cara, course, cohort["id"]), 409, "cohort_full")
    ok(planner.patch(f"/api/cohorts/{cohort['id']}", {"seat_cap": 4}))
    assert remaining() == 3
    ok(planner.patch(f"/api/cohorts/{cohort['id']}", {"seat_cap": 2}))
    assert remaining() == 1
    dev = Api(app_url, DEV)
    cara_share, dev_share = quote(cara, course["id"])["learner_share"], quote(dev, course["id"])["learner_share"]
    results = together(lambda: checkout(cara, course, cohort["id"], share=cara_share),
                       lambda: checkout(dev, course, cohort["id"], share=dev_share))
    assert sorted(r.status_code for r in results) == [201, 409], [r.text for r in results]
    assert next(r for r in results if r.status_code == 409).json() == {"error": "cohort_full", "waitlist": True}
    assert remaining() == 0


def test_cohort_roster_private(app_url: str) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    cohort = add_cohort(planner, course["id"], cap=1)
    ana, dev = Api(app_url, ANA), Api(app_url, DEV)
    enrol(ana, course, cohort["id"])
    ok(dev.post(f"/api/cohorts/{cohort['id']}/waitlist"), 201)
    view = cohort_of(planner, cohort["id"])
    assert [r["nurse_name"] for r in view["roster"]] == [ana.name]
    assert [(w["position"], w["nurse_name"]) for w in view["waitlist"]] == [(1, dev.name)]
    for viewer in (Api(app_url, BEN), ana, dev, Api(app_url, GRACE), Api(app_url, AUTHOR)):
        r = viewer.get(f"/api/cohorts/{cohort['id']}")
        summary = ok(r)["cohort"]
        assert "roster" not in summary and "waitlist" not in summary and summary["seats_remaining"] == 0
        listed = ok(viewer.get(f"/api/courses/{course['id']}"))
        in_course = next(c for c in listed["course"]["cohorts"] if c["id"] == cohort["id"])
        assert "roster" not in in_course and "waitlist" not in in_course
        for name in (ana.name, dev.name):
            assert name not in r.text and name not in json.dumps(listed["course"]["cohorts"]), (viewer.role, name)


@pytest.mark.parametrize("case", list(CLOSE_CASES), ids=list(CLOSE_CASES))
def test_close_instant_provider_time(browser: Browser, app_url: str, case: str) -> None:
    close_date, closes_at, shown = CLOSE_CASES[case]
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    cohort = add_cohort(planner, course["id"], cap=2, close_date=close_date, starts_on=close_date)
    assert cohort["closes_at"] == closes_at
    now = server_time(planner.get("/api/health"))
    assert cohort["open"] is (now < parse_instant(closes_at))
    assert cohort_of(Api(app_url, ANA), cohort["id"])["closes_at"] == closes_at
    with ui(browser, app_url, ANA, f"/courses/{course['id']}") as page:
        group = page.get_by_role("radiogroup", name="Cohort")
        expect(group).to_contain_text(f"Enrolment closes {shown} at 11:59 PM CT")
        if not cohort["open"]:
            expect(group.get_by_role("radio", name=cohort["name"])).to_be_disabled()


def test_pack_purchase_charged_once(app_url: str, killbill: KillBill) -> None:
    course = published_course(app_url, price="45.50")
    grace = Api(app_url, GRACE)
    key = idempotency_key()
    first = buy_pack(grace, course["id"], 3, key=key)
    pack = ok(first, 201)["pack"]
    total = money(3 * cents("45.50"))
    assert (pack["seats_purchased"], pack["balance"], pack["price_total"], pack["state"]) == (3, 3, total, "active")
    replay = buy_pack(grace, course["id"], 3, key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    fails(buy_pack(grace, course["id"], 2, key=key), 409, "idempotency_key_reused")
    fails(grace.post("/api/sponsor/packs", {"course_id": course["id"], "seats": 1}), 400, "idempotency_key_required")
    assert kb_purchase(killbill, f"pack-{pack['id']}", "credwell-hospital-harbourview") == cents(total)
    hospital = killbill.account_by_key("credwell-hospital-harbourview")
    assert hospital is not None
    assert len([p for p in killbill.payments(hospital["accountId"]) if p.get("paymentExternalKey") == f"pack-{pack['id']}"]) == 1
    cohort_course = published_course(app_url, fmt="cohort")
    invalid(buy_pack(grace, cohort_course["id"], 0), {"course_id": "Seat packs are sold for self-paced courses only.",
                                                      "seats": "Buy from 1 to 500 seats."})
    withdrawn = published_course(app_url)
    withdraw(app_url, withdrawn)
    fails(buy_pack(grace, withdrawn["id"], 1), 409, "course_not_open")
    fails(buy_pack(Api(outage(KB_DOWN_ENV), GRACE), course["id"], 2), 503, "payments_unavailable")
    packs = ok(grace.get("/api/sponsor/packs"))["packs"]
    assert [p["id"] for p in packs if p["course_id"] in (course["id"], withdrawn["id"], cohort_course["id"])] == [pack["id"]]


def test_paired_seat_ledger(app_url: str) -> None:
    course = published_course(app_url)
    grace, ana, ben = Api(app_url, GRACE), Api(app_url, ANA), Api(app_url, BEN)
    pack = ok(buy_pack(grace, course["id"], 2), 201)["pack"]
    ana_assignment = ok(assign(grace, pack["id"], ana.id), 201)["assignment"]
    ben_assignment = ok(assign(grace, pack["id"], ben.id), 201)["assignment"]
    ok(grace.delete(f"/api/sponsor/assignments/{ben_assignment['id']}"))
    book = ledger(grace, pack["id"])
    grouped = movements(book["entries"])
    assert len(grouped) == 4
    seen: list[tuple[str, frozenset[tuple[str, int]], Any]] = []
    for entries in grouped.values():
        assert len(entries) == 2 and sum(e["seats"] for e in entries) == 0, entries
        kinds = {e["kind"] for e in entries}
        assert len(kinds) == 1
        ids = {e["assignment_id"] for e in entries}
        assert len(ids) == 1
        seen.append((kinds.pop(), frozenset((e["account"], e["seats"]) for e in entries), ids.pop()))
    expected = [
        ("purchase", frozenset({("pack", 2), ("purchases", -2)}), None),
        ("assignment", frozenset({("pack", -1), (f"nurse:{ana.id}", 1)}), ana_assignment["id"]),
        ("assignment", frozenset({("pack", -1), (f"nurse:{ben.id}", 1)}), ben_assignment["id"]),
        ("return", frozenset({("pack", 1), (f"nurse:{ben.id}", -1)}), ben_assignment["id"]),
    ]
    assert sorted(seen, key=repr) == sorted(expected, key=repr)
    pack_sum = sum(e["seats"] for e in book["entries"] if e["account"] == "pack")
    assert book["balance"] == pack_sum == 1 == pack_of(grace, pack["id"])["balance"]
    dash = ok(grace.get("/api/sponsor/dashboard"))
    assert dash["seats_purchased"] == dash["seats_assigned"] + dash["seats_available"] + dash["seats_expired"]


def test_seat_assignment_tenant_boundary(app_url: str, mail: Mailpit) -> None:
    course = published_course(app_url)
    grace, marcus = Api(app_url, GRACE), Api(app_url, MARCUS)
    ana, cara, dev = Api(app_url, ANA), Api(app_url, CARA), Api(app_url, DEV)
    pack = ok(buy_pack(grace, course["id"], 2), 201)["pack"]
    fails(assign(grace, pack["id"], cara.id), 404, "not_found")
    fails(assign(grace, pack["id"], dev.id), 404, "not_found")
    fails(assign(marcus, pack["id"], cara.id), 404, "not_found")
    fails(marcus.get(f"/api/sponsor/packs/{pack['id']}/ledger"), 404, "not_found")
    created = ok(assign(grace, pack["id"], ana.id), 201)
    assert created["assignment"]["state"] == "assigned" and created["assignment"]["nurse_id"] == ana.id
    [enrolment] = enrolments_for(ana, course["id"])
    assert (enrolment["state"], enrolment["funding"], enrolment["assignment_id"]) == ("confirmed", "seat", created["assignment"]["id"])
    fails(marcus.delete(f"/api/sponsor/assignments/{created['assignment']['id']}"), 404, "not_found")
    fails(assign(grace, pack["id"], ana.id), 409, "already_enrolled")
    invites = mail_to(mail, f"Your Credwell seat: {course['title']}", ANA)
    assert len(invites) == 1
    body = text(invites[0])
    assert HARBOURVIEW in body and course["title"] in body and f"/courses/{course['id']}" in body
    assert pack_of(grace, pack["id"])["balance"] == 1
    withdraw(app_url, course)
    fails(assign(grace, pack["id"], Api(app_url, BEN).id), 409, "course_not_open")


def test_last_pack_seat_race(app_url: str) -> None:
    course = published_course(app_url)
    grace = Api(app_url, GRACE)
    ana, ben = Api(app_url, ANA), Api(app_url, BEN)
    pack = ok(buy_pack(grace, course["id"], 1), 201)["pack"]
    g1, g2 = Api(app_url, GRACE), Api(app_url, GRACE)
    results = together(lambda: assign(g1, pack["id"], ana.id), lambda: assign(g2, pack["id"], ben.id))
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409], [r.text for r in results]
    loser = next(r for r in results if r.status_code == 409)
    assert loser.json() == {"error": "pack_empty"}
    book = ledger(grace, pack["id"])
    assert book["balance"] == 0
    assert sum(1 for e in book["entries"] if e["kind"] == "assignment") == 2
    losing_nurse = ana if results[0].status_code == 409 else ben
    assert enrolments_for(losing_nurse, course["id"]) == []


def test_return_unused_seat(app_url: str) -> None:
    course = published_course(app_url)
    grace, ana, ben = Api(app_url, GRACE), Api(app_url, ANA), Api(app_url, BEN)
    pack = ok(buy_pack(grace, course["id"], 2), 201)["pack"]
    ana_seat = ok(assign(grace, pack["id"], ana.id), 201)
    ben_seat = ok(assign(grace, pack["id"], ben.id), 201)
    assert pack_of(grace, pack["id"])["balance"] == 0
    returned = ok(grace.delete(f"/api/sponsor/assignments/{ana_seat['assignment']['id']}"))
    assert returned["assignment"]["state"] == "returned" and returned["enrolment"]["state"] == "withdrawn"
    assert ok(ana.get(f"/api/enrolments/{ana_seat['enrolment']['id']}"))["enrolment"]["state"] == "withdrawn"
    assert pack_of(grace, pack["id"])["balance"] == 1
    fails(grace.delete(f"/api/sponsor/assignments/{ana_seat['assignment']['id']}"), 409, "already_returned")
    module_id, index = next(iter(course["answers"].items()))
    ok(answer(ben, ben_seat["enrolment"]["id"], module_id, index))
    fails(grace.delete(f"/api/sponsor/assignments/{ben_seat['assignment']['id']}"), 409, "seat_in_use")
    assert ok(ben.get(f"/api/enrolments/{ben_seat['enrolment']['id']}"))["enrolment"]["state"] == "confirmed"
    returns = [e for e in ledger(grace, pack["id"])["entries"] if e["kind"] == "return"]
    assert sorted((e["account"], e["seats"]) for e in returns) == sorted([("pack", 1), (f"nurse:{ana.id}", -1)])


def test_pack_expiry_single_movement(app_url: str) -> None:
    main_course = published_course(app_url)
    grace_main = Api(app_url, GRACE)
    main_pack = ok(buy_pack(grace_main, main_course["id"], 1), 201)["pack"]
    bought, expires = parse_instant(main_pack["purchased_at"]), parse_instant(main_pack["expires_at"])
    assert (expires.year, expires.month) == (bought.year + 1, bought.month)

    short = outage(SHORT_CLOCK_ENV)
    course = published_course(short)
    grace = Api(short, GRACE)
    ana, ben = Api(short, ANA), Api(short, BEN)
    pack = ok(buy_pack(grace, course["id"], 3), 201)["pack"]
    bought, expires = parse_instant(pack["purchased_at"]), parse_instant(pack["expires_at"])
    life = (expires - bought).total_seconds()
    assert 0 < life <= CLOCK_WAIT_S and life == int(life), life
    ana_seat = ok(assign(grace, pack["id"], ana.id), 201)
    poll(lambda: server_time(grace.get("/api/health")), lambda now: now > expires + timedelta(seconds=1), CLOCK_WAIT_S, "pack expiry")
    touchers = [Api(short, GRACE) for _ in range(6)]
    reads = together(*[lambda g=g, i=i: g.get("/api/sponsor/packs") if i % 3 == 0 else
                       g.get(f"/api/sponsor/packs/{pack['id']}/ledger") if i % 3 == 1 else
                       g.get("/api/sponsor/dashboard") for i, g in enumerate(touchers)])
    assert all(r.status_code == 200 for r in reads), [r.text for r in reads]
    poll(lambda: pack_of(grace, pack["id"]), lambda p: p["state"] == "expired", CLOCK_WAIT_S, "expired pack")
    book = ledger(grace, pack["id"])
    expiry = [e for e in book["entries"] if e["kind"] == "expiry"]
    assert sorted((e["account"], e["seats"]) for e in expiry) == [("expired", 2), ("pack", -2)], expiry
    assert len({e["movement_id"] for e in expiry}) == 1 and book["balance"] == 0
    fails(assign(grace, pack["id"], ben.id), 409, "pack_expired")
    assert ok(ana.get(f"/api/enrolments/{ana_seat['enrolment']['id']}"))["enrolment"]["state"] == "confirmed"


def test_module_verification(app_url: str) -> None:
    course = published_course(app_url)
    ana = Api(app_url, ANA)
    e = enrol(ana, course)
    (first, first_ok), (second, second_ok) = course["answers"].items()
    module = ok(ana.get(f"/api/enrolments/{e['id']}/modules/{first}"))
    assert module["status"] == "unverified" and "answer_index" not in module["module"]["question"]
    fails(evaluate(ana, e["id"]), 409, "lessons_unverified")
    invalid(answer(ana, e["id"], first, (first_ok + 1) % 3), {"option_index": WRONG_ANSWER})
    assert ok(ana.get(f"/api/enrolments/{e['id']}/modules/{first}"))["status"] == "unverified"
    fails(answer(ana, e["id"], course["evaluation_id"], 0), 409, "not_a_lesson")
    after = ok(answer(ana, e["id"], first, first_ok))["enrolment"]
    assert (after["verified_minutes"], after["progress_percent"]) == (30, 50)
    again = ok(answer(ana, e["id"], first, (first_ok + 1) % 3))["enrolment"]
    assert again["verified_minutes"] == 30
    fails(evaluate(ana, e["id"]), 409, "lessons_unverified")
    after = ok(answer(ana, e["id"], second, second_ok))["enrolment"]
    assert (after["verified_minutes"], after["progress_percent"]) == (50, 83)
    invalid(evaluate(ana, e["id"], {"rating": 0, "met_outcomes": "maybe", "comment": "x" * (COMMENT_MAX + 1)}), {
        "rating": "Choose a rating from 1 to 5.", "met_outcomes": "Answer yes or no.",
        "comment": "Keep comments under 1000 characters."})
    r = evaluate(ana, e["id"])
    assert r.status_code in (201, 202)
    done = ok(ana.get(f"/api/enrolments/{e['id']}"))["enrolment"]
    assert all(m["status"] == "verified" for m in done["modules"])


def test_learner_records_private(app_url: str) -> None:
    course = published_course(app_url)
    ana, ben = Api(app_url, ANA), Api(app_url, BEN)
    e, cert = certify(ana, course)
    module_id = next(iter(course["answers"]))
    own_pdf = ana.get(f"/api/certificates/{cert['id']}/pdf")
    assert own_pdf.status_code == 200 and own_pdf.content.startswith(b"%PDF")
    for r in (ben.get(f"/api/enrolments/{e['id']}"), ben.get(f"/api/enrolments/{e['id']}/modules/{module_id}"),
              answer(ben, e["id"], module_id, 0), evaluate(ben, e["id"]), ben.get(f"/api/certificates/{cert['id']}"),
              ben.get(f"/api/certificates/{cert['id']}/pdf"), ben.get(f"/api/certificates/{cert['id']}/share-links"),
              ben.post(f"/api/certificates/{cert['id']}/share-links"), refund_request(ben, e["id"])):
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, (str(r.request.url), r.text)
    assert cert["id"] not in {c["id"] for c in ok(ben.get("/api/me/transcript"))["certificates"]}
    assert e["id"] not in {x["id"] for x in ok(ben.get("/api/me/enrolments"))["enrolments"]}
    assert links_of(ana, cert["id"]) == {}


@pytest.mark.parametrize("case", HOURS_IDS, ids=HOURS_IDS)
def test_awarded_contact_hours(app_url: str, case: str) -> None:
    lessons, evaluation, expected = HOURS_CASES[case]
    course = published_course(app_url, lessons=lessons, evaluation=evaluation)
    assert course["contact_hours"] == expected
    dev = Api(app_url, DEV)
    _, cert = certify(dev, course)
    assert cert["contact_hours"] == expected
    row = next(c for c in ok(dev.get("/api/me/transcript"))["certificates"] if c["id"] == cert["id"])
    assert row["contact_hours"] == expected
    token = token_of(share_link(dev, cert["id"])["url"])
    assert ok(Api(app_url).get(f"/api/verify/{token}"))["certificate"]["contact_hours"] == expected


def test_one_certificate_per_run(app_url: str, mail: Mailpit) -> None:
    course = published_course(app_url)
    ana = Api(app_url, ANA)
    e = enrol(ana, course)
    study(ana, e["id"], course)
    clients = [Api(app_url, ANA) for _ in range(4)]
    results = together(*[lambda c=c: evaluate(c, e["id"]) for c in clients])
    codes = [r.status_code for r in results]
    assert sum(c in (201, 202) for c in codes) == 1 and codes.count(200) == 3, codes
    certs = [r.json()["certificate"] for r in results]
    assert len({c["id"] for c in certs}) == 1 and len({c["serial"] for c in certs}) == 1
    later = evaluate(ana, e["id"], {"rating": 99})
    assert later.status_code == 200 and later.json()["certificate"]["id"] == certs[0]["id"]
    cert = wait_cert(ana, certs[0]["id"], sealed)
    match = SERIAL_RE.fullmatch(cert["serial"])
    assert match and match.group(1) == cert["issued_on"][:4]
    transcript_ids = [c["id"] for c in ok(ana.get("/api/me/transcript"))["certificates"]]
    assert transcript_ids.count(cert["id"]) == 1
    assert ok(ana.get(f"/api/enrolments/{e['id']}"))["enrolment"]["certificate_id"] == cert["id"]
    assert len(only_mail(mail, f"Your Credwell certificate: {course['title']}", ANA)) == 1


def test_certificate_pdf_email_together(app_url: str, mail: Mailpit) -> None:
    s3 = S3()
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    _, cert = certify(dev, course)
    key = f"certificates/sorrel-pike/{cert['serial']}/v1.pdf"
    assert key in s3.keys(f"certificates/sorrel-pike/{cert['serial']}/") and s3.get(key).startswith(b"%PDF")
    assert cert["issued_on"] is not None and cert["versions"][0]["state"] == "sealed"
    assert ok(dev.get(f"/api/enrolments/{cert['enrolment_id']}"))["enrolment"]["state"] == "certified"
    messages = only_mail(mail, f"Your Credwell certificate: {course['title']}", DEV)
    assert len(messages) == 1
    body = text(messages[0])
    for part in (cert["serial"], course["title"], cert["contact_hours"], cert["nurse_name"]):
        assert part in body, part
    link = DOWNLOAD_RE.search(body)
    assert link and link.group(0).startswith(origin_of(app_url)), body
    r = httpx.get(link.group(0), timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf") and r.content == s3.get(key)

    ben = Api(app_url, BEN)
    second = published_course(app_url)
    e = enrol(ben, second)
    study(ben, e["id"], second)
    down = Api(outage(MINIO_DOWN_ENV), BEN)
    r = evaluate(down, e["id"])
    assert r.status_code == 202, r.text
    pending = r.json()["certificate"]
    assert pending["state"] == "sealing" and pending["issued_on"] is None
    enrolment_state = ok(down.get(f"/api/enrolments/{e['id']}"))["enrolment"]["state"]
    now = certificate(down, pending["id"])
    if now["state"] == "sealing":
        assert enrolment_state == "completed"
        pdf = down.get(f"/api/certificates/{pending['id']}/pdf")
        assert pdf.status_code in (409, 503) and pdf.json()["error"] in ("pdf_pending", "storage_unavailable")
    early = mail_to(mail, f"Your Credwell certificate: {second['title']}", BEN, seconds=0)
    pending_key = f"certificates/sorrel-pike/{pending['serial']}/v1.pdf"
    if early:
        assert pending_key in s3.keys(f"certificates/sorrel-pike/{pending['serial']}/")
    done = wait_cert(ben, pending["id"], sealed)
    assert pending_key in s3.keys(f"certificates/sorrel-pike/{done['serial']}/")
    assert len(only_mail(mail, f"Your Credwell certificate: {second['title']}", BEN)) == 1
    fails(down.get(f"/api/certificates/{pending['id']}/pdf"), 503, "storage_unavailable")


def test_verification_links(app_url: str) -> None:
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    anon = Api(app_url)
    _, cert = certify(dev, course)
    first = share_link(dev, cert["id"])
    t1 = token_of(first["url"])
    assert len(t1) >= TOKEN_MIN_CHARS and re.fullmatch(r"[A-Za-z0-9_.~-]+", t1) and first["state"] == "active"
    assert parse_instant(first["expires_at"]) - parse_instant(first["created_at"]) == timedelta(days=LINK_LIFETIME_DAYS)
    assert anon.get(f"/api/verify/{t1}").status_code == 200
    second = share_link(dev, cert["id"])
    t2 = token_of(second["url"])
    assert t2 != t1
    fails(anon.get(f"/api/verify/{t1}"), 404, "not_found")
    assert anon.get(f"/api/verify/{t2}").status_code == 200
    links = links_of(dev, cert["id"])
    assert links[first["id"]]["state"] == "revoked" and links[second["id"]]["state"] == "active"
    assert [l["state"] for l in links.values()].count("active") == 1
    assert dev.delete(f"/api/certificates/{cert['id']}/share-links/{second['id']}").status_code == 204
    fails(anon.get(f"/api/verify/{t2}"), 404, "not_found")
    assert links_of(dev, cert["id"])[second["id"]]["state"] == "revoked"
    t3 = token_of(share_link(dev, cert["id"])["url"])
    ok(Api(app_url, PLANNER).post(f"/api/certificates/{cert['id']}/revoke", {"reason": "Issued in error."}))
    assert ok(anon.get(f"/api/verify/{t3}"))["certificate"]["state"] == "revoked"
    fails(anon.get(f"/api/verify/{t3}/pdf"), 404, "not_found")
    fails(dev.post(f"/api/certificates/{cert['id']}/share-links"), 409, "certificate_not_sealed")


def test_public_verification_page(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    _, cert = certify(dev, course)
    token = token_of(share_link(dev, cert["id"])["url"])
    anon = Api(app_url)
    shown = ok(anon.get(f"/api/verify/{token}"))["certificate"]
    assert set(shown) <= {"serial", "nurse_name", "course_title", "contact_hours", "issued_on", "state", "provider", "accreditation_statement"}
    assert (shown["serial"], shown["nurse_name"], shown["course_title"], shown["contact_hours"], shown["issued_on"], shown["state"]) == (
        cert["serial"], cert["nurse_name"], course["title"], cert["contact_hours"], cert["issued_on"], "sealed")
    assert shown["provider"] == PROVIDER_NAME and shown["accreditation_statement"] == ACCREDITATION
    pdf = anon.get(f"/api/verify/{token}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf") and pdf.content.startswith(b"%PDF")
    assert anon.send("HEAD", f"/api/verify/{token}").status_code == 200
    for path in (f"/api/verify/{token}", f"/api/verify/{token}/pdf"):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            r = dev.send(method, path, {})
            assert r.status_code == 405 and r.json() == {"error": "method_not_allowed"}, (method, path)
    assert ok(anon.get(f"/api/verify/{token}"))["certificate"] == shown
    with ui(browser, app_url, None, f"/verify/{token}") as page:
        expect(page.get_by_role("heading", name="Certificate verification")).to_be_visible()
        for label in ("Nurse", "Course", "Contact hours", "Serial", "Issued", "Status"):
            expect(page.get_by_text(label, exact=True).first).to_be_visible()
        for value in (cert["nurse_name"], course["title"], cert["serial"], PROVIDER_NAME):
            expect(page.get_by_text(value).first).to_be_visible()
        expect(page.get_by_role("link", name="Download PDF")).to_be_visible()
        expect(page.get_by_role("navigation", name="Main")).to_have_count(0)


def test_private_fields_stay_private(browser: Browser, app_url: str, mail: Mailpit) -> None:
    course = published_course(app_url, price="87.65")
    ana = Api(app_url, ANA)
    q = quote(ana, course["id"])
    e, cert = certify(ana, course)
    _, _, _, _, _, licence, dob = SEEDED["ana"]
    forbidden = {str(licence), str(dob), ANA, e["list_price"], e["learner_share"]}
    forbidden |= {v for v in (e["employer_share"], q["coverage_percent"]) if v != "0.00"}
    token = token_of(share_link(ana, cert["id"])["url"])
    copies = {
        "email": text(mail_to(mail, f"Your Credwell certificate: {course['title']}", ANA)[0]),
        "pdf": pdf_strings(ok_bytes(ana.get(f"/api/certificates/{cert['id']}/pdf"))),
        "verify api": Api(app_url).get(f"/api/verify/{token}").text,
    }
    with ui(browser, app_url, None, f"/verify/{token}") as page:
        expect(page.get_by_role("heading", name="Certificate verification")).to_be_visible()
        copies["verify page"] = page.content()
    for where, body in copies.items():
        for secret in forbidden:
            found_in = pdf_text(body) if where == "pdf" and re.fullmatch(r"\d+\.\d{2}", secret) else body
            assert secret not in found_in, f"{secret!r} leaked into {where}"


def ok_bytes(r: httpx.Response) -> bytes:
    assert r.status_code == 200, r.text[:300]
    return r.content


def test_exact_link_expiry(app_url: str, mail: Mailpit) -> None:
    main_course = published_course(app_url)
    main_dev = Api(app_url, DEV)
    certify(main_dev, main_course)
    message = mail_to(mail, f"Your Credwell certificate: {main_course['title']}", DEV)[0]
    url = DOWNLOAD_RE.search(text(message))
    assert url
    fresh = httpx.get(url.group(0), timeout=HTTP_TIMEOUT_S)
    assert fresh.status_code == 200 and fresh.content.startswith(b"%PDF")
    capability_headers(fresh)
    with_cookie = Api(app_url, BEN).http.get(url.group(0))
    assert with_cookie.status_code == 200
    other = re.sub(r"/api/certificates/[^/]+/pdf", f"/api/certificates/{uuid.uuid4()}/pdf", url.group(0))
    wrong = httpx.get(other, timeout=HTTP_TIMEOUT_S)
    assert wrong.status_code == 404
    capability_headers(wrong)

    short = outage(SHORT_CLOCK_ENV)
    course = published_course(short)
    dev = Api(short, DEV)
    _, cert = certify(dev, course)
    anon = Api(short)

    link = share_link(dev, cert["id"])
    created, expires = parse_instant(link["created_at"]), parse_instant(link["expires_at"])
    life = (expires - created).total_seconds()
    assert 0 < life <= CLOCK_WAIT_S and life == int(life), life
    token = token_of(link["url"])
    first = anon.get(f"/api/verify/{token}")
    assert first.status_code == 200
    capability_headers(first)
    capability_headers(anon.get(f"/api/verify/{token}/pdf"))
    capability_headers(anon.get(f"/verify/{token}"))
    edge = expires.replace(microsecond=0) + timedelta(seconds=2)
    late = poll(lambda: anon.get(f"/api/verify/{token}"), lambda r: server_time(r) >= edge, CLOCK_WAIT_S, "link expiry")
    assert late.status_code == 404
    capability_headers(late)
    capability_headers(anon.get(f"/api/verify/{token}/pdf"))
    capability_headers(anon.get(f"/verify/{token}"))
    assert links_of(dev, cert["id"])[link["id"]]["state"] == "expired"

    short_message = mail_to(mail, f"Your Credwell certificate: {course['title']}", DEV)[0]
    short_url = DOWNLOAD_RE.search(text(short_message))
    assert short_url
    gone = poll(lambda: httpx.get(short_url.group(0), timeout=HTTP_TIMEOUT_S), lambda r: r.status_code != 200, CLOCK_WAIT_S, "download expiry")
    assert gone.status_code == 404 and gone.json() == {"error": "not_found"}
    capability_headers(gone)


def test_refund_amount_rules(app_url: str) -> None:
    planner = Api(app_url, PLANNER)
    dev = Api(app_url, DEV)
    full = published_course(app_url, price="90.00")
    e = enrol(dev, full)
    invalid(refund_request(dev, e["id"], ""), {"reason": "Tell the planner why you are asking for a refund."})
    request = ok(refund_request(dev, e["id"]), 201)["refund_request"]
    fails(refund_request(dev, e["id"]), 409, "refund_pending")
    assert (request["refund_total"], request["employer_refund"], request["learner_refund"]) == ("90.00", "0.00", "90.00")
    assert ok(planner.post(f"/api/refund-requests/{request['id']}/approve", {}))["refund_request"]["refund_total"] == "90.00"

    half = published_course(app_url, price="90.00")
    e = enrol(dev, half)
    study(dev, e["id"], half, only=1)
    request = ok(refund_request(dev, e["id"]), 201)["refund_request"]
    assert ok(planner.post(f"/api/refund-requests/{request['id']}/approve", {}))["refund_request"]["refund_total"] == money(9000 * 30 // 60)

    finished = published_course(app_url)
    e = enrol(dev, finished)
    request = ok(refund_request(dev, e["id"]), 201)["refund_request"]
    study(dev, e["id"], finished)
    assert evaluate(dev, e["id"]).status_code in (201, 202)
    fails(planner.post(f"/api/refund-requests/{request['id']}/approve", {}), 409, "already_certified")
    assert queue_entry(planner, request["id"])["state"] == "pending"
    fails(refund_request(dev, e["id"]), 409, "already_certified")

    seat_course = published_course(app_url)
    grace, ben = Api(app_url, GRACE), Api(app_url, BEN)
    pack = ok(buy_pack(grace, seat_course["id"], 1), 201)["pack"]
    seat = ok(assign(grace, pack["id"], ben.id), 201)
    fails(refund_request(ben, seat["enrolment"]["id"]), 409, "not_refundable")

    short = outage(SHORT_CLOCK_ENV)
    windowed = published_course(short, price="90.00", lessons=((5, 0), (30, 1)), evaluation=5)
    short_dev, short_planner = Api(short, DEV), Api(short, PLANNER)
    e = enrol(short_dev, windowed)
    study(short_dev, e["id"], windowed, only=1)
    request = ok(refund_request(short_dev, e["id"]), 201)["refund_request"]
    assert request["refund_total"] == "90.00"
    prorated = money(9000 * 35 // 40)
    poll(lambda: queue_entry(short_planner, request["id"]), lambda r: r["refund_total"] == prorated, CLOCK_WAIT_S, "window end")
    assert ok(short_planner.post(f"/api/refund-requests/{request['id']}/approve", {}))["refund_request"]["refund_total"] == prorated


def test_refund_split_and_keys(app_url: str, killbill: KillBill) -> None:
    course = published_course(app_url, price="45.50", lessons=((25, 0), (20, 1)), evaluation=10)
    cara = Api(app_url, CARA)
    e = enrol(cara, course)
    study(cara, e["id"], course, only=1)
    request = ok(refund_request(cara, e["id"]), 201)["refund_request"]
    down = Api(outage(KB_DOWN_ENV), PLANNER)
    fails(down.post(f"/api/refund-requests/{request['id']}/approve", {}), 503, "payments_unavailable")
    planner = Api(app_url, PLANNER)
    still = queue_entry(planner, request["id"])
    assert still["state"] == "pending" and still["decided_by"] is None and still["decided_at"] is None
    assert ok(cara.get(f"/api/enrolments/{e['id']}"))["enrolment"]["state"] == "confirmed"
    approved = ok(planner.post(f"/api/refund-requests/{request['id']}/approve", {}))
    r = approved["refund_request"]
    assert (r["refund_total"], r["employer_refund"], r["learner_refund"]) == ("24.81", "8.26", "16.55")
    assert approved["enrolment"]["state"] == "refunded"
    fails(planner.post(f"/api/refund-requests/{request['id']}/approve", {}), 409, "request_closed")
    for side, amount in (("employer", "8.26"), ("learner", "16.55")):
        payment = killbill.payment_by_key(f"enrol-{e['id']}-{side}")
        assert payment is not None
        refunds = [t for t in kb_txs(payment, "REFUND") if t.get("transactionExternalKey") == f"refund-{request['id']}-{side}"]
        assert len(refunds) == 1 and kb_cents(refunds[0]["amount"]) == cents(amount), payment
        assert len(kb_txs(payment, "REFUND")) == 1


def test_attributed_refund_decisions(app_url: str, killbill: KillBill) -> None:
    planner = Api(app_url, PLANNER)
    dev = Api(app_url, DEV)
    course = published_course(app_url)
    e = enrol(dev, course)
    request = ok(refund_request(dev, e["id"]), 201)["refund_request"]
    note = "Approved under the seven-day rule."
    decided = ok(planner.post(f"/api/refund-requests/{request['id']}/approve", {"note": note}))["refund_request"]
    assert decided["state"] == "approved" and decided["decided_by"] == {"id": planner.id, "display_name": "Odette Marsh"}
    assert decided["decision_note"] == note and INSTANT_RE.fullmatch(decided["decided_at"])
    fails(planner.post(f"/api/refund-requests/{request['id']}/decline", {"note": "Changed mind."}), 409, "request_closed")
    fails(planner.post(f"/api/refund-requests/{request['id']}/approve", {}), 409, "request_closed")
    assert queue_entry(planner, request["id"]) == decided
    payment = killbill.payment_by_key(f"enrol-{e['id']}-learner")
    account = killbill.account_by_key(f"credwell-nurse-{dev.id}")
    assert payment is not None and account is not None
    writers = killbill.writers(account["accountId"], payment["paymentId"])
    assert {f"credwell:{dev.id}", f"credwell:{planner.id}"} <= writers and all(w.startswith("credwell:") for w in writers), writers

    second = published_course(app_url)
    e2 = enrol(dev, second)
    request2 = ok(refund_request(dev, e2["id"]), 201)["refund_request"]
    declined = ok(planner.post(f"/api/refund-requests/{request2['id']}/decline", {}))["refund_request"]
    assert declined["state"] == "declined" and declined["decided_by"]["id"] == planner.id and declined["decision_note"] is None
    fails(planner.post(f"/api/refund-requests/{request2['id']}/approve", {}), 409, "request_closed")
    assert queue_entry(planner, request2["id"]) == declined
    assert ok(dev.get(f"/api/enrolments/{e2['id']}"))["enrolment"]["state"] == "confirmed"
    payment2 = killbill.payment_by_key(f"enrol-{e2['id']}-learner")
    assert payment2 is not None and kb_txs(payment2, "REFUND") == []

    grace = Api(app_url, GRACE)
    pack = ok(buy_pack(grace, course["id"], 1), 201)["pack"]
    hospital = killbill.account_by_key("credwell-hospital-harbourview")
    pack_payment = killbill.payment_by_key(f"pack-{pack['id']}")
    assert hospital is not None and pack_payment is not None
    pack_writers = killbill.writers(hospital["accountId"], pack_payment["paymentId"])
    assert f"credwell:{grace.id}" in pack_writers and all(w.startswith("credwell:") for w in pack_writers)


def test_reissue_keeps_serial(app_url: str, mail: Mailpit) -> None:
    s3 = S3()
    planner = Api(app_url, PLANNER)
    course = published_course(app_url)
    ana = Api(app_url, ANA)
    _, cert = certify(ana, course)
    v1_key = f"certificates/sorrel-pike/{cert['serial']}/v1.pdf"
    v1 = s3.get(v1_key)
    r = planner.post(f"/api/certificates/{cert['id']}/reissue", {"reason": "Name correction."})
    assert r.status_code in (201, 202), r.text
    after = wait_cert(planner, cert["id"], lambda c: sealed(c) and c["version"] == 2)
    assert (after["serial"], after["contact_hours"], after["issued_on"]) == (cert["serial"], cert["contact_hours"], cert["issued_on"])
    assert [(v["version"], v["state"]) for v in after["versions"]] == [(1, "reissued"), (2, "sealed")]
    keys = s3.keys(f"certificates/sorrel-pike/{cert['serial']}/")
    assert v1_key in keys and f"certificates/sorrel-pike/{cert['serial']}/v2.pdf" in keys and s3.get(v1_key) == v1
    assert len(only_mail(mail, f"Your reissued Credwell certificate: {course['title']}", ANA)) == 1
    invalid(planner.post(f"/api/certificates/{cert['id']}/revoke", {"reason": ""}), {"reason": "Give a reason of 1 to 500 characters."})
    assert certificate(planner, cert["id"])["state"] == "sealed"

    ben = Api(app_url, BEN)
    _, target = certify(ben, published_course(app_url))
    deciders = [Api(outage(MINIO_DOWN_ENV), PLANNER) for _ in range(4)]
    calls = [lambda p=p, i=i: p.post(f"/api/certificates/{target['id']}/{'reissue' if i % 2 == 0 else 'revoke'}", {"reason": "Concurrent."})
             for i, p in enumerate(deciders)]
    results = together(*calls)
    accepted = [r for r in results if r.status_code in (200, 202)]
    resealed = any(v["version"] > 1 and v["state"] != "sealing" for v in certificate(planner, target["id"])["versions"])
    assert len(accepted) == 1 or (len(accepted) > 1 and resealed), [(r.status_code, r.text) for r in results]
    for r in results:
        if any(r is a for a in accepted):
            continue
        assert r.status_code == 409, r.text
        body = r.json()
        assert body["error"] in ("reissue_pending", "invalid_transition"), body
        if body["error"] == "invalid_transition":
            assert body["from"] == "revoked"


def test_transcript_totals_recomputed(app_url: str) -> None:
    cara = Api(app_url, CARA)
    original = cara.name
    planner = Api(app_url, PLANNER)

    def total() -> int:
        body = ok(cara.get("/api/me/transcript"))
        listed = sum(cents(c["contact_hours"]) for c in body["certificates"] if c["state"] == "sealed")
        assert cents(body["total_hours"]) == listed, body["total_hours"]
        assert len({c["id"] for c in body["certificates"]}) == len(body["certificates"])
        return cents(body["total_hours"])

    start = total()
    _, first = certify(cara, published_course(app_url))
    _, second = certify(cara, published_course(app_url))
    assert total() == start + cents(first["contact_hours"]) + cents(second["contact_hours"])
    try:
        set_display_name(cara, f"Cara Renamed {unique('name')[0]}"[:80])
        assert total() == start + cents(first["contact_hours"]) + cents(second["contact_hours"])
        r = Api(outage(MINIO_DOWN_ENV), PLANNER).post(f"/api/certificates/{first['id']}/reissue", {"reason": "Rename."})
        assert r.status_code == 202 and r.json()["certificate"]["reissue_pending"] is True
        assert total() == start + cents(first["contact_hours"]) + cents(second["contact_hours"])
        ok(planner.post(f"/api/certificates/{second['id']}/revoke", {"reason": "Issued in error."}))
        assert total() == start + cents(first["contact_hours"])
        wait_cert(cara, first["id"], lambda c: sealed(c) and c["version"] == 2)
        assert total() == start + cents(first["contact_hours"])
    finally:
        set_display_name(cara, original)


def test_copies_carry_version_name(app_url: str, mail: Mailpit) -> None:
    s3 = S3()
    ben, grace, planner = Api(app_url, BEN), Api(app_url, GRACE), Api(app_url, PLANNER)
    original = ben.name
    course = published_course(app_url)
    _, cert = certify(ben, course)
    token = token_of(share_link(ben, cert["id"])["url"])
    first_mail = DOWNLOAD_RE.search(text(mail_to(mail, f"Your Credwell certificate: {course['title']}", BEN)[0]))
    assert first_mail
    new_name = f"Ben Osei-Marsh {unique('name')[0]}"[:80]

    def names() -> dict[str, str]:
        _, raw = export_rows(grace, cert["issued_on"], cert["issued_on"])
        row = next(r for r in csv_records(raw) if r["serial"] == cert["serial"])
        record = ok(grace.get(f"/api/sponsor/learners/{ben.id}"))
        return {
            "certificate": certificate(ben, cert["id"])["nurse_name"],
            "transcript": next(c for c in ok(ben.get("/api/me/transcript"))["certificates"] if c["id"] == cert["id"])["nurse_name"],
            "verify": ok(Api(app_url).get(f"/api/verify/{token}"))["certificate"]["nurse_name"],
            "coordinator": next(c for c in record["certificates"] if c["id"] == cert["id"])["nurse_name"],
            "planner": next(c for c in ok(planner.get("/api/planner/certificates", params={"q": cert["serial"]}))["certificates"] if c["id"] == cert["id"])["nurse_name"],
            "csv": row["nurse_name"],
        }

    try:
        set_display_name(ben, new_name)
        assert set(names().values()) == {original}
        for q in (original, new_name):
            found = ok(planner.get("/api/planner/certificates", params={"q": q}))["certificates"]
            assert cert["id"] in {c["id"] for c in found}, q
        r = planner.post(f"/api/certificates/{cert['id']}/reissue", {"reason": "Name correction."})
        assert r.status_code in (201, 202)
        after = wait_cert(planner, cert["id"], lambda c: sealed(c) and c["version"] == 2)
        assert [v["nurse_name"] for v in after["versions"]] == [original, new_name]
        assert set(names().values()) == {new_name}
        reissued = mail_to(mail, f"Your reissued Credwell certificate: {course['title']}", BEN)
        assert len(reissued) == 1 and new_name in text(reissued[0])
        second_link = DOWNLOAD_RE.search(text(reissued[0]))
        assert second_link
        v1 = s3.get(f"certificates/sorrel-pike/{cert['serial']}/v1.pdf")
        v2 = s3.get(f"certificates/sorrel-pike/{cert['serial']}/v2.pdf")
        assert v1 != v2
        assert httpx.get(second_link.group(0), timeout=HTTP_TIMEOUT_S).content == v2
        assert httpx.get(first_mail.group(0), timeout=HTTP_TIMEOUT_S).content == v1
    finally:
        set_display_name(ben, original)


def test_hospital_isolation(app_url: str) -> None:
    grace, marcus = Api(app_url, GRACE), Api(app_url, MARCUS)
    ana, cara = Api(app_url, ANA), Api(app_url, CARA)
    year = str(provider_today(grace).year)

    def month(api: Api, key: str) -> tuple[int, int]:
        report = ok(api.get("/api/sponsor/reports/monthly", params={"year": key[:4]}))
        assert [m["month"] for m in report["months"]] == [f"{key[:4]}-{i:02d}" for i in range(1, 13)]
        entry_ = next(m for m in report["months"] if m["month"] == key[:7])
        return entry_["completions"], cents(entry_["hours"])

    today_key = f"{year}-{provider_today(grace).month:02d}"
    g0, m0 = month(grace, today_key), month(marcus, today_key)
    gd0, md0 = ok(grace.get("/api/sponsor/dashboard")), ok(marcus.get("/api/sponsor/dashboard"))
    course = published_course(app_url)
    _, ana_cert = certify(ana, course)
    _, cara_cert = certify(cara, course)
    assert ana_cert["issued_on"][:7] == today_key == cara_cert["issued_on"][:7]
    g1, m1 = month(grace, today_key), month(marcus, today_key)
    assert g1 == (g0[0] + 1, g0[1] + cents(ana_cert["contact_hours"]))
    assert m1 == (m0[0] + 1, m0[1] + cents(cara_cert["contact_hours"]))
    gd1, md1 = ok(grace.get("/api/sponsor/dashboard")), ok(marcus.get("/api/sponsor/dashboard"))
    assert gd1["completions"] == gd0["completions"] + 1 and md1["completions"] == md0["completions"] + 1
    assert cents(gd1["hours_awarded"]) == cents(gd0["hours_awarded"]) + cents(ana_cert["contact_hours"])

    everyone = ok(grace.get("/api/sponsor/learners", params={"q": ""}))["learners"]
    ids = {l["id"] for l in everyone}
    assert ana.id in ids and cara.id not in ids and Api(app_url, ELI).id not in ids
    assert all(l["email"].endswith("@harbourview.test") for l in everyone)
    assert ok(grace.get("/api/sponsor/learners", params={"q": "lindenvalley"}))["learners"] == []
    _, raw = export_rows(grace, ana_cert["issued_on"], ana_cert["issued_on"])
    assert ana_cert["serial"] in raw and cara_cert["serial"] not in raw
    _, raw = export_rows(marcus, cara_cert["issued_on"], cara_cert["issued_on"])
    assert cara_cert["serial"] in raw and ana_cert["serial"] not in raw
    invalid(grace.get("/api/sponsor/reports/monthly", params={"year": "1999"}), {"year": "Choose a year from 2000 to 2100."})


def test_safe_completions_export(app_url: str) -> None:
    s3 = S3()
    eli, marcus = Api(app_url, ELI), Api(app_url, MARCUS)
    original = eli.name
    hostile = '=1+2,"x"'
    course = published_course(app_url, title=f"@Formula {unique('course')[0]}")
    try:
        set_display_name(eli, hostile)
        _, cert = certify(eli, course)
    finally:
        set_display_name(eli, original)
    export, raw = export_rows(marcus, cert["issued_on"], cert["issued_on"])
    assert raw.splitlines()[0] == CSV_HEADER and raw.endswith("\n")
    row = next(r for r in csv_records(raw) if r["serial"] == cert["serial"])
    assert row["nurse_name"] == "'" + hostile and row["course_title"] == "'" + course["title"]
    assert (row["nurse_email"], row["issued_on"], row["contact_hours"], row["funding"]) == (ELI, cert["issued_on"], cert["contact_hours"], "co_pay")
    key = f"exports/linden-valley/{export['id']}.csv"
    assert key in s3.keys("exports/linden-valley/") and s3.get(key).decode() == raw
    down = Api(outage(MINIO_DOWN_ENV), MARCUS)
    fails(down.post("/api/sponsor/exports", {"from": cert["issued_on"], "to": cert["issued_on"]}), 503, "storage_unavailable")
    fails(down.get(export["download_url"]), 503, "storage_unavailable")


def test_coordinator_record_access(app_url: str) -> None:
    grace, marcus = Api(app_url, GRACE), Api(app_url, MARCUS)
    ana, ben, cara, dev = Api(app_url, ANA), Api(app_url, BEN), Api(app_url, CARA), Api(app_url, DEV)
    course = published_course(app_url)
    ana_enrolment, ana_cert = certify(ana, course)
    assert ana_enrolment["funding"] == "co_pay"
    dev_enrolment, dev_cert = certify(dev, course)
    cara_enrolment = enrol(cara, course)
    pack = ok(buy_pack(grace, course["id"], 1), 201)["pack"]
    ben_seat = ok(assign(grace, pack["id"], ben.id), 201)
    assert ok(grace.get(f"/api/enrolments/{ana_enrolment['id']}"))["enrolment"]["id"] == ana_enrolment["id"]
    assert ok(grace.get(f"/api/certificates/{ana_cert['id']}"))["certificate"]["serial"] == ana_cert["serial"]
    assert grace.get(f"/api/certificates/{ana_cert['id']}/pdf").content.startswith(b"%PDF")
    assert ok(grace.get(f"/api/enrolments/{ben_seat['enrolment']['id']}"))["enrolment"]["funding"] == "seat"
    record = ok(grace.get(f"/api/sponsor/learners/{ana.id}"))
    assert ana_enrolment["id"] in {e["id"] for e in record["enrolments"]}
    assert all(e["funding"] in ("co_pay", "seat") for e in record["enrolments"])
    for r in (grace.get(f"/api/enrolments/{dev_enrolment['id']}"), grace.get(f"/api/certificates/{dev_cert['id']}"),
              grace.get(f"/api/certificates/{dev_cert['id']}/pdf"), grace.get(f"/api/enrolments/{cara_enrolment['id']}"),
              grace.get(f"/api/sponsor/learners/{cara.id}"), grace.get(f"/api/sponsor/learners/{dev.id}"),
              marcus.get(f"/api/enrolments/{ana_enrolment['id']}"), marcus.get(f"/api/certificates/{ana_cert['id']}")):
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, str(r.request.url)


def searchable(item: dict[str, Any]) -> str:
    parts = [str(item.get(k, "")) for k in ("display_name", "email", "serial", "nurse_name")]
    parts += [str(v.get("nurse_name", "")) for v in item.get("versions") or []]
    return "\n".join(parts).lower()


def test_bounded_literal_search(app_url: str) -> None:
    grace, planner = Api(app_url, GRACE), Api(app_url, PLANNER)
    for api, path, items in ((grace, "/api/sponsor/learners", "learners"), (planner, "/api/planner/certificates", "certificates")):
        assert api.get(path, params={"q": "x" * SEARCH_MAX}).status_code == 200
        invalid(api.get(path, params={"q": "x" * (SEARCH_MAX + 1)}), {"q": "Search with at most 100 characters."})
        for literal in ("%", "_", "\\"):
            found = ok(api.get(path, params={"q": literal}))[items]
            assert all(literal in searchable(item) for item in found), (path, literal)
    hit = ok(grace.get("/api/sponsor/learners", params={"q": "ANA.RUIZ"}))["learners"]
    assert ANA in {l["email"] for l in hit}
    ok(grace.post("/api/sponsor/exports", {"from": "2030-01-01", "to": "2031-01-01"}), 201)
    invalid(grace.post("/api/sponsor/exports", {"from": "2030-01-01", "to": "2031-01-02"}), {"to": "Export at most 366 days at a time."})
    invalid(grace.post("/api/sponsor/exports", {"from": "2030-02-01", "to": "2030-01-01"}), {"to": "The end date must be on or after the start date."})
    invalid(grace.post("/api/sponsor/exports", {"from": "01/02/2030"}), {
        "from": "Enter a start date as YYYY-MM-DD.", "to": "Enter an end date as YYYY-MM-DD."})


def test_course_lifecycle(app_url: str) -> None:
    author, c = draft_course(app_url)
    path = f"/api/courses/{c['id']}"
    planner, author2, learner = Api(app_url, PLANNER), Api(app_url, AUTHOR2), Api(app_url, ANA)
    assert author2.get(path).status_code == 404 and learner.get(path).status_code == 404
    fails(author2.post(f"{path}/transitions", {"to": "in_review"}, version=1), 404, "not_found")
    body = fails(planner.post(f"{path}/transitions", {"to": "published"}, version=1), 409, "invalid_transition")
    assert (body["from"], body["to"]) == ("draft", "published")
    fails(author.post(f"{path}/transitions", {"to": "published"}, version=1), 403, "forbidden")
    fails(planner.post(f"{path}/transitions", {"to": "in_review"}, version=1), 403, "forbidden")
    fails(planner.post(f"{path}/transitions", {"to": "archived"}, version=1), 403, "forbidden")
    assert ok(author.get(path))["course"]["version"] == 1
    assert ok(author.patch(path, {"summary": "Edited."}, version=1))["course"]["version"] == 2
    assert ok(author.post(f"{path}/transitions", {"to": "in_review"}, version=2))["course"]["version"] == 3
    fails(author.post(f"{path}/transitions", {"to": "in_review"}, version=3), 409, "invalid_transition")
    fails(author.patch(path, {"summary": "Again."}, version=3), 409, "course_not_editable")
    assert ok(planner.patch(path, {"summary": "Planner edit."}, version=3))["course"]["version"] == 4
    invalid(planner.post(f"{path}/transitions", {"to": "draft"}, version=4), {"note": "Tell the author what to change."})
    returned = ok(planner.post(f"{path}/transitions", {"to": "draft", "note": RETURN_NOTE}, version=4))["course"]
    assert (returned["state"], returned["version"]) == ("draft", 5)
    ok(author.post(f"{path}/transitions", {"to": "in_review"}, version=5))
    ok(planner.post(f"{path}/transitions", {"to": "published"}, version=6))
    fails(planner.patch(path, {"summary": "Late."}, version=7), 409, "course_not_editable")
    withdrawn = ok(planner.post(f"{path}/transitions", {"to": "withdrawn"}, version=7))["course"]
    assert (withdrawn["state"], withdrawn["version"]) == ("withdrawn", 8)
    body = fails(planner.post(f"{path}/transitions", {"to": "published"}, version=8), 409, "invalid_transition")
    assert body["from"] == "withdrawn"
    history = ok(planner.get(f"{path}/history"))["history"]
    assert [(h["from"], h["to"], h["by"]["display_name"]) for h in history] == [
        ("draft", "in_review", "Felix Amari"), ("in_review", "draft", "Odette Marsh"), ("draft", "in_review", "Felix Amari"),
        ("in_review", "published", "Odette Marsh"), ("published", "withdrawn", "Odette Marsh")]
    assert history[1]["note"] == RETURN_NOTE
    assert learner.get(path).status_code == 200
    fails(checkout(learner, withdrawn), 409, "course_not_open")

    kept = published_course(app_url)
    dev = Api(app_url, DEV)
    _, cert = certify(dev, kept)
    token = token_of(share_link(dev, cert["id"])["url"])
    withdraw(app_url, kept)
    assert ok(Api(app_url).get(f"/api/verify/{token}"))["certificate"]["state"] == "sealed"
    assert certificate(dev, cert["id"])["state"] == "sealed"


def test_stale_course_edits(app_url: str) -> None:
    author, c = draft_course(app_url)
    path = f"/api/courses/{c['id']}"
    fails(author.patch(path, {"title": "No version"}), 428, "version_required")
    newer = new_title("Renamed")
    ok(author.patch(path, {"title": newer}, version=1))
    r = author.patch(path, {"title": new_title("Lost")}, version=1)
    assert r.status_code == 412 and r.json() == {"error": "stale_version", "current_version": 2}
    current = ok(author.get(path))["course"]
    assert (current["title"], current["version"]) == (newer, 2)
    r = Api(app_url, PLANNER).post(f"{path}/transitions", {"to": "published"}, version=1)
    assert r.status_code == 412 and r.json() == {"error": "stale_version", "current_version": 2}
    twin = Api(app_url, AUTHOR)
    results = together(lambda: author.post(f"{path}/transitions", {"to": "in_review"}, version=2),
                       lambda: twin.post(f"{path}/transitions", {"to": "in_review"}, version=2))
    assert sorted(r.status_code for r in results) == [200, 412]
    assert next(r for r in results if r.status_code == 412).json() == {"error": "stale_version", "current_version": 3}
    assert len(ok(author.get(f"{path}/history"))["history"]) == 1


def test_coverage_effective_dating(app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    grace, ana = Api(app_url, GRACE), Api(app_url, ANA)
    today = provider_today(grace)
    try:
        invalid(grace.patch("/api/sponsor/coverage", {"coverage_percent": "100.01", "effective_on": today.isoformat()}),
                {"coverage_percent": "Enter a percentage from 0 to 100 with at most two decimals."})
        invalid(grace.patch("/api/sponsor/coverage", {"coverage_percent": COVER_NOW, "effective_on": (today - timedelta(days=1)).isoformat()}),
                {"effective_on": "Choose today or a later date."})
        invalid(grace.patch("/api/sponsor/coverage", {}), {
            "coverage_percent": "Enter a percentage from 0 to 100 with at most two decimals.",
            "effective_on": "Choose today or a later date."})
        kept_course, stale_course = published_course(app_url), published_course(app_url)
        kept = enrol(ana, kept_course)
        stale_share = quote(ana, stale_course["id"])["learner_share"]
        coverage = ok(grace.patch("/api/sponsor/coverage", {"coverage_percent": COVER_NOW, "effective_on": today.isoformat()}))
        assert coverage["coverage_percent"] == COVER_NOW
        employer_now, learner_now = split(stale_course["list_price"], COVER_NOW)
        body = fails(checkout(ana, stale_course, share=stale_share), 409, "quote_changed")
        assert (body["quote"]["employer_share"], body["quote"]["learner_share"], body["quote"]["coverage_percent"]) == (employer_now, learner_now, COVER_NOW)
        assert enrolments_for(ana, stale_course["id"]) == []
        assert mail_to(mail, f"Credwell receipt: {stale_course['title']}", ANA, seconds=NO_MAIL_WAIT_S) == []
        again = ok(ana.get(f"/api/enrolments/{kept['id']}"))["enrolment"]
        assert (again["employer_share"], again["learner_share"]) == (kept["employer_share"], kept["learner_share"])
        scheduled = ok(grace.patch("/api/sponsor/coverage", {"coverage_percent": COVER_SCHEDULED_A, "effective_on": FAR_SCHEDULE_A}))
        assert scheduled == {"coverage_percent": COVER_NOW, "scheduled": {"coverage_percent": COVER_SCHEDULED_A, "effective_on": FAR_SCHEDULE_A}}
        replaced = ok(grace.patch("/api/sponsor/coverage", {"coverage_percent": COVER_SCHEDULED_B, "effective_on": FAR_SCHEDULE_B}))
        assert replaced["scheduled"] == {"coverage_percent": COVER_SCHEDULED_B, "effective_on": FAR_SCHEDULE_B}
        now = ok(grace.patch("/api/sponsor/coverage", {"coverage_percent": COVER_AGAIN, "effective_on": today.isoformat()}))
        assert now == {"coverage_percent": COVER_AGAIN, "scheduled": {"coverage_percent": COVER_SCHEDULED_B, "effective_on": FAR_SCHEDULE_B}}
        assert ok(grace.get("/api/sponsor/dashboard"))["coverage"] == now
        e = enrol(ana, stale_course)
        employer_again, learner_again = split(stale_course["list_price"], COVER_AGAIN)
        assert (e["employer_share"], e["learner_share"]) == (employer_again, learner_again)
        assert kb_purchase(killbill, f"enrol-{e['id']}-employer", "credwell-hospital-harbourview") == cents(employer_again)
    finally:
        grace.patch("/api/sponsor/coverage", {"coverage_percent": SEED_HARBOURVIEW_COVERAGE, "effective_on": provider_today(grace).isoformat()})
        grace.patch("/api/sponsor/coverage", {"coverage_percent": SEED_HARBOURVIEW_COVERAGE, "effective_on": FAR_SCHEDULE_B})


def test_unaccepted_fields_refused(app_url: str) -> None:
    ana = Api(app_url, ANA)
    name = ok(ana.get("/api/me"))["user"]["display_name"]
    invalid(ana.patch("/api/me", {"display_name": "Ana R", "role": "planner"}), {"role": NOT_ACCEPTED})
    me = ok(ana.get("/api/me"))["user"]
    assert me["display_name"] == name and me["role"] == "learner"
    course = published_course(app_url)
    body = {"course_id": course["id"], "cohort_id": None, "quoted_learner_share": quote(ana, course["id"])["learner_share"], "employer_share": "0.00"}
    invalid(ana.post("/api/checkout", body, key=idempotency_key()), {"employer_share": NOT_ACCEPTED})
    assert enrolments_for(ana, course["id"]) == []
    e = enrol(ana, course)
    (first, right), _ = course["answers"].items()
    invalid(ana.post(f"/api/enrolments/{e['id']}/modules/{first}/answer", {"option_index": (right + 1) % 3, "status": "verified"}),
            {"option_index": WRONG_ANSWER, "status": NOT_ACCEPTED})
    invalid(ana.post(f"/api/enrolments/{e['id']}/modules/{first}/answer", {"option_index": right, "verified_minutes": 60}),
            {"verified_minutes": NOT_ACCEPTED})
    assert ok(ana.get(f"/api/enrolments/{e['id']}"))["enrolment"]["verified_minutes"] == 0
    invalid(ana.post(f"/api/enrolments/{e['id']}/refund-request", {"reason": "r", "refund_total": "999.00"}), {"refund_total": NOT_ACCEPTED})
    study(ana, e["id"], course)
    invalid(evaluate(ana, e["id"], {"rating": 5, "met_outcomes": True, "contact_hours": "40.00"}), {"contact_hours": NOT_ACCEPTED})
    after = ok(ana.get(f"/api/enrolments/{e['id']}"))["enrolment"]
    assert after["state"] == "confirmed" and after["certificate_id"] is None


def test_wf_self_paced_checkout_happy(browser: Browser, app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    course = published_course(app_url, price="90.00")
    ana = Api(app_url, ANA)
    q = quote(ana, course["id"])
    with ui(browser, app_url, ANA, f"/courses/{course['id']}") as page:
        expect(page.get_by_role("heading", name=course["title"], level=1)).to_be_visible()
        click(page.get_by_role("button", name="Enrol"))
        dialog = page.get_by_role("dialog", name="Checkout")
        for copy in ("List price", f"Paid by {HARBOURVIEW}", "Your share", q["list_price"], q["employer_share"], q["learner_share"]):
            expect(dialog).to_contain_text(copy)
        pay = dialog.get_by_role("button", name=f"Pay ${q['learner_share']}")
        with held(page, "**/api/checkout") as hold:
            click(pay)
            expect(dialog.get_by_role("button", name="Recording your payment…")).to_be_disabled()
            hold.release()
        expect(dialog).to_be_hidden()
        expect(page.get_by_role("link", name="Continue learning")).to_be_focused()
        expect(status(page)).to_contain_text(f"You're enrolled in {course['title']}.")
    [e] = enrolments_for(ana, course["id"])
    assert e["state"] == "confirmed" and e["learner_share"] == q["learner_share"]
    assert kb_purchase(killbill, f"enrol-{e['id']}-learner", f"credwell-nurse-{ana.id}") == cents(q["learner_share"])
    if cents(q["employer_share"]):
        assert kb_purchase(killbill, f"enrol-{e['id']}-employer", "credwell-hospital-harbourview") == cents(q["employer_share"])
    assert len(only_mail(mail, f"Credwell receipt: {course['title']}", ANA)) == 1


def test_wf_self_paced_checkout_quote_changed(browser: Browser, app_url: str, killbill: KillBill, mail: Mailpit) -> None:
    course = published_course(app_url, price="90.00")
    ana, grace = Api(app_url, ANA), Api(app_url, GRACE)
    try:
        with ui(browser, app_url, ANA, f"/courses/{course['id']}") as page:
            old = quote(ana, course["id"])
            click(page.get_by_role("button", name="Enrol"))
            dialog = page.get_by_role("dialog", name="Checkout")
            old_pay = dialog.get_by_role("button", name=f"Pay ${old['learner_share']}")
            expect(old_pay).to_be_visible()
            ok(grace.patch("/api/sponsor/coverage", {"coverage_percent": COVER_CHANGED, "effective_on": provider_today(grace).isoformat()}))
            new = quote(ana, course["id"])
            assert (new["employer_share"], new["learner_share"]) == split(course["list_price"], COVER_CHANGED)
            click(old_pay)
            expect(alert(page, "The price changed while you were checking out.")).to_contain_text(f"Your share is now ${new['learner_share']}.")
            new_pay = dialog.get_by_role("button", name=f"Pay ${new['learner_share']}")
            expect(new_pay).to_be_focused()
            expect(dialog).to_contain_text(new["employer_share"])
            assert enrolments_for(ana, course["id"]) == []
            click(new_pay)
            expect(dialog).to_be_hidden()
            expect(page.get_by_role("link", name="Continue learning")).to_be_visible()
        [e] = enrolments_for(ana, course["id"])
        assert (e["employer_share"], e["learner_share"]) == (new["employer_share"], new["learner_share"])
        assert kb_purchase(killbill, f"enrol-{e['id']}-learner", f"credwell-nurse-{ana.id}") == cents(new["learner_share"])
        assert kb_purchase(killbill, f"enrol-{e['id']}-employer", "credwell-hospital-harbourview") == cents(new["employer_share"])
        assert len(only_mail(mail, f"Credwell receipt: {course['title']}", ANA)) == 1
    finally:
        grace.patch("/api/sponsor/coverage", {"coverage_percent": SEED_HARBOURVIEW_COVERAGE, "effective_on": provider_today(grace).isoformat()})


def test_wf_self_paced_checkout_outage(browser: Browser, app_url: str, mail: Mailpit) -> None:
    course = published_course(app_url, price="90.00")
    down = outage(KB_DOWN_ENV)
    with ui(browser, down, DEV, f"/courses/{course['id']}") as page:
        click(page.get_by_role("button", name="Enrol"))
        dialog = page.get_by_role("dialog", name="Checkout")
        click(dialog.get_by_role("button", name=re.compile(r"^Pay \$")))
        expect(alert(page, "Payments are unavailable right now. You have not been charged. Try again in a few minutes.")).to_be_visible()
        expect(dialog).to_be_visible()
    assert enrolments_for(Api(app_url, DEV), course["id"]) == []
    assert mail_to(mail, f"Credwell receipt: {course['title']}", DEV, seconds=NO_MAIL_WAIT_S) == []


def test_wf_cohort_enrolment_happy(browser: Browser, app_url: str, killbill: KillBill) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    cohort = add_cohort(planner, course["id"], cap=2)
    add_cohort(planner, course["id"], cap=2)
    with ui(browser, app_url, ANA, f"/courses/{course['id']}") as page:
        group = page.get_by_role("radiogroup", name="Cohort")
        expect(group).to_contain_text(f"{cohort['seat_cap']} seats remaining")
        pick(group.get_by_role("radio", name=cohort["name"]))
        click(page.get_by_role("button", name="Enrol"))
        dialog = page.get_by_role("dialog", name="Checkout")
        click(dialog.get_by_role("button", name=re.compile(r"^(Pay \$|Confirm enrolment)")))
        expect(dialog).to_be_hidden()
        page.reload()
        expect(page.get_by_role("radiogroup", name="Cohort")).to_contain_text(f"{cohort['seat_cap'] - 1} seats remaining")
    ana = Api(app_url, ANA)
    [e] = enrolments_for(ana, course["id"])
    assert e["cohort_id"] == cohort["id"]
    assert cohort_of(planner, cohort["id"])["seats_remaining"] == 1
    assert kb_purchase(killbill, f"enrol-{e['id']}-learner", f"credwell-nurse-{ana.id}") == cents(e["learner_share"])


def test_wf_cohort_enrolment_full_waitlist(browser: Browser, app_url: str) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    cohort = add_cohort(planner, course["id"], cap=1)
    with ui(browser, app_url, ANA, f"/courses/{course['id']}") as page:
        pick(page.get_by_role("radiogroup", name="Cohort").get_by_role("radio", name=cohort["name"]))
        click(page.get_by_role("button", name="Enrol"))
        dialog = page.get_by_role("dialog", name="Checkout")
        pay = dialog.get_by_role("button", name=re.compile(r"^(Pay \$|Confirm enrolment)"))
        expect(pay).to_be_visible()
        enrol(Api(app_url, DEV), course, cohort["id"])
        click(pay)
        expect(alert(page, "The last seat was just taken. Join the waitlist to hold your place in line.")).to_be_visible()
        position = len(cohort_of(planner, cohort["id"])["waitlist"]) + 1
        click(dialog.get_by_role("button", name="Join waitlist"))
        expect(status(page)).to_contain_text(f"You're number {position} on the waitlist.")
    view = cohort_of(planner, cohort["id"])
    assert [(w["position"], w["nurse_name"]) for w in view["waitlist"]] == [(1, Api(app_url, ANA).name)]
    assert enrolments_for(Api(app_url, ANA), course["id"]) == []


def test_wf_cohort_operations_planner(browser: Browser, app_url: str) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    name = f"Evening {unique('cohort')[0]}"[:80]
    planner = Api(app_url, PLANNER)
    with ui(browser, app_url, PLANNER, "/planner") as page:
        cohorts_region = page.get_by_role("region", name="Cohorts")
        new_cohort = page.get_by_role("button", name="New cohort")
        click(course_block(cohorts_region, course["title"], new_cohort).get_by_role("button", name="New cohort"))
        dialog = page.get_by_role("dialog", name="New cohort")
        fill(dialog.get_by_role("textbox", name="Cohort name"), name)
        fill(dialog.get_by_role("spinbutton", name="Seat cap"), "2")
        fill(dialog.get_by_role("textbox", name="Starts on"), OPEN_START_DATE)
        fill(dialog.get_by_role("textbox", name="Enrolment closes on"), OPEN_CLOSE_DATE)
        click(dialog.get_by_role("button", name="Create cohort"))
        expect(status(page)).to_contain_text("Cohort saved.")
        cohort = next(c for c in ok(planner.get(f"/api/courses/{course['id']}"))["course"]["cohorts"] if c["name"] == name)
        assert (cohort["seat_cap"], cohort["closes_at"]) == (2, OPEN_CLOSES_AT)
        ana, ben, dev = Api(app_url, ANA), Api(app_url, BEN), Api(app_url, DEV)
        enrol(ana, course, cohort["id"])
        enrol(ben, course, cohort["id"])
        ok(dev.post(f"/api/cohorts/{cohort['id']}/waitlist"), 201)
        page.goto(app_url + f"/planner/cohorts/{cohort['id']}")
        expect(page.get_by_role("heading", name=name)).to_be_visible()
        expect(page.locator("body")).to_contain_text(seats_remaining(cohort["seat_cap"] - 2))
        expect(page.get_by_text(OPEN_CLOSE_LINE)).to_be_visible()
        for nurse in (ana.name, ben.name):
            expect(page.get_by_role("table", name="Roster")).to_contain_text(nurse)
        expect(page.get_by_role("list", name="Waitlist")).to_contain_text(dev.name)
        new_cap = cohort["seat_cap"] + 1
        fill(page.get_by_role("spinbutton", name="Seat cap"), str(new_cap))
        click(page.get_by_role("button", name="Save seat cap"))
        expect(status(page)).to_contain_text("Cohort saved.")
        expect(page.locator("body")).to_contain_text(seats_remaining(new_cap - 2))
    after = cohort_of(planner, cohort["id"])
    assert (after["seat_cap"], after["seats_remaining"]) == (3, 1)


def test_wf_cohort_operations_cap_too_low(browser: Browser, app_url: str) -> None:
    course = published_course(app_url, fmt="cohort", price="140.00")
    planner = Api(app_url, PLANNER)
    cohort = add_cohort(planner, course["id"], cap=2)
    enrol(Api(app_url, ANA), course, cohort["id"])
    enrol(Api(app_url, CARA), course, cohort["id"])
    with ui(browser, app_url, PLANNER, f"/planner/cohorts/{cohort['id']}") as page:
        fill(page.get_by_role("spinbutton", name="Seat cap"), "1")
        click(page.get_by_role("button", name="Save seat cap"))
        expect(alert(page, "The seat cap can't be lower than the nurses already enrolled.")).to_be_visible()
    fails(planner.patch(f"/api/cohorts/{cohort['id']}", {"seat_cap": 1}), 409, "cap_below_enrolled")
    after = cohort_of(planner, cohort["id"])
    assert (after["seat_cap"], after["seats_remaining"]) == (2, 0)


def test_wf_seat_pack_purchase_happy(browser: Browser, app_url: str, killbill: KillBill) -> None:
    course = published_course(app_url, price="45.50")
    total = money(3 * cents("45.50"))
    with ui(browser, app_url, GRACE, "/sponsor") as page:
        click(page.get_by_role("button", name="Buy seats"))
        dialog = page.get_by_role("dialog", name="Buy seats")
        select(dialog.get_by_role("combobox", name="Course"), course["title"])
        seats = 3
        fill(dialog.get_by_role("spinbutton", name="Seats"), str(seats))
        click(dialog.get_by_role("button", name=f"Buy {seats} seats for ${total}"))
        expect(status(page)).to_contain_text(f"{seats} seats added to your hospital's packs.")
        row = page.get_by_role("table", name="Seat packs").get_by_role("row").filter(has_text=course["title"])
        expect(row).to_contain_text(str(seats))
        click(row.get_by_role("button", name="Show ledger"))
        expect(page.get_by_role("table", name="Ledger")).to_be_visible()
    grace = Api(app_url, GRACE)
    [pack] = [p for p in ok(grace.get("/api/sponsor/packs"))["packs"] if p["course_id"] == course["id"]]
    assert (pack["balance"], pack["price_total"]) == (3, total) and pack["expires_at"]
    assert kb_purchase(killbill, f"pack-{pack['id']}", "credwell-hospital-harbourview") == cents(total)


def test_wf_seat_pack_purchase_outage(browser: Browser, app_url: str) -> None:
    course = published_course(app_url, price="45.50")
    with ui(browser, outage(KB_DOWN_ENV), GRACE, "/sponsor") as page:
        click(page.get_by_role("button", name="Buy seats"))
        dialog = page.get_by_role("dialog", name="Buy seats")
        select(dialog.get_by_role("combobox", name="Course"), course["title"])
        fill(dialog.get_by_role("spinbutton", name="Seats"), "2")
        click(dialog.get_by_role("button", name=re.compile(r"^Buy 2 seats for \$")))
        expect(alert(page, "Payments are unavailable right now. Your hospital has not been charged. Try again in a few minutes.")).to_be_visible()
    packs = ok(Api(app_url, GRACE).get("/api/sponsor/packs"))["packs"]
    assert [p for p in packs if p["course_id"] == course["id"]] == []


def test_wf_seat_assignment_happy(browser: Browser, app_url: str, mail: Mailpit) -> None:
    course = published_course(app_url)
    grace = Api(app_url, GRACE)
    pack = ok(buy_pack(grace, course["id"], 2), 201)["pack"]
    ben = Api(app_url, BEN)
    with ui(browser, app_url, GRACE, "/sponsor") as page:
        row = page.get_by_role("table", name="Seat packs").get_by_role("row").filter(has_text=course["title"])
        click(row.get_by_role("button", name="Assign seat"))
        dialog = page.get_by_role("dialog", name="Assign seat")
        select(dialog.get_by_role("combobox", name="Nurse"), ben.name)
        click(dialog.get_by_role("button", name="Assign"))
        expect(status(page)).to_contain_text(f"Seat assigned to {ben.name}. We've emailed them an invitation.")
    [e] = enrolments_for(ben, course["id"])
    assert (e["state"], e["funding"]) == ("confirmed", "seat") and e["assignment_id"]
    assert pack_of(grace, pack["id"])["balance"] == 1
    assert len(mail_to(mail, f"Your Credwell seat: {course['title']}", BEN)) == 1


def test_wf_seat_assignment_return(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    grace, ana = Api(app_url, GRACE), Api(app_url, ANA)
    pack = ok(buy_pack(grace, course["id"], 1), 201)["pack"]
    seat = ok(assign(grace, pack["id"], ana.id), 201)
    with ui(browser, app_url, GRACE, "/sponsor") as page:
        search = page.get_by_role("searchbox", name="Search nurses")
        fill(search, ana.name)
        search.press("Enter")
        click(page.get_by_role("table", name="Nurses").get_by_role("row").filter(has_text=ana.name).get_by_role("button", name="Show enrolments"))
        enrolment_row = page.get_by_role("table", name="Nurse enrolments").get_by_role("row").filter(has_text=course["title"])
        click(enrolment_row.get_by_role("button", name="Return seat"))
        expect(status(page)).to_contain_text("Seat returned to the pack.")
    assert ok(ana.get(f"/api/enrolments/{seat['enrolment']['id']}"))["enrolment"]["state"] == "withdrawn"
    assert pack_of(grace, pack["id"])["balance"] == 1
    assert any(e["kind"] == "return" for e in ledger(grace, pack["id"])["entries"])


def test_wf_module_player_happy(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    e = enrol(dev, course)
    (first, right1), (_, right2) = course["answers"].items()
    lesson1, lesson2 = lessons(course)
    progress = (lesson1["minutes"] + lesson2["minutes"]) * 100 // course["total_minutes"]
    with ui(browser, app_url, DEV, f"/learn/{e['id']}/{first}") as page:
        nav = page.get_by_role("navigation", name="Course modules")
        expect(page.get_by_role("heading", name=lesson1["title"])).to_be_visible()
        expect(nav).to_contain_text("Not yet verified")
        expect(nav).not_to_contain_text(re.compile("Verified"))
        group = page.get_by_role("radiogroup", name=lesson1["question"]["prompt"])
        pick(group.get_by_role("radio", name=LESSON_OPTIONS[(right1 + 1) % 3]))
        click(page.get_by_role("button", name="Check answer"))
        expect(page.get_by_text(WRONG_ANSWER)).to_be_visible()
        expect(nav).not_to_contain_text(re.compile("Verified"))
        pick(group.get_by_role("radio", name=LESSON_OPTIONS[right1]))
        click(page.get_by_role("button", name="Check answer"))
        expect(status(page)).to_contain_text("Module verified.")
        expect(nav).to_contain_text("Verified")
        click(page.get_by_role("link", name="Next module"))
        expect(page.get_by_role("heading", name=lesson2["title"])).to_be_visible()
        pick(page.get_by_role("radiogroup", name=lesson2["question"]["prompt"]).get_by_role("radio", name=LESSON_OPTIONS[right2]))
        click(page.get_by_role("button", name="Check answer"))
        expect(page.get_by_role("link", name="Go to post-evaluation")).to_be_visible()
        page.goto(app_url + "/learning")
        bar = page.get_by_role("progressbar", name=f"{course['title']} progress")
        expect(bar).to_be_visible()
        assert bar.evaluate("(el) => Number(el.getAttribute('aria-valuenow') ?? el.value)") == progress
    after = ok(dev.get(f"/api/enrolments/{e['id']}"))["enrolment"]
    assert after["progress_percent"] == progress
    assert [m["status"] for m in after["modules"] if m["kind"] == "lesson"] == ["verified", "verified"]


def test_wf_module_player_keyboard(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    ben = Api(app_url, BEN)
    e = enrol(ben, course)
    (first, right1), (_, right2) = course["answers"].items()

    def choose(page: Page, prompt: str, index: int) -> Locator:
        group = page.get_by_role("radiogroup", name=prompt)
        tab_until(page, group)
        page.keyboard.press("Space")
        for _ in range(index):
            page.keyboard.press("ArrowDown")
        expect(group.get_by_role("radio", name=LESSON_OPTIONS[index])).to_be_checked()
        return group

    lesson1, lesson2 = lessons(course)
    with ui(browser, app_url, BEN, f"/learn/{e['id']}/{first}") as page:
        expect(page.get_by_role("heading", name=lesson1["title"])).to_be_visible()
        wrong = (right1 + 1) % 3
        group = choose(page, lesson1["question"]["prompt"], wrong)
        tab_until(page, page.get_by_role("button", name="Check answer"))
        page.keyboard.press("Enter")
        expect(page.get_by_text(WRONG_ANSWER)).to_be_visible()
        assert focused(group)
        if not group.get_by_role("radio").evaluate_all("(radios) => radios.includes(document.activeElement)"):
            page.keyboard.press("Tab")
        page.keyboard.press("ArrowUp" if right1 < wrong else "ArrowDown")
        expect(group.get_by_role("radio", name=LESSON_OPTIONS[right1])).to_be_checked()
        tab_until(page, page.get_by_role("button", name="Check answer"))
        page.keyboard.press("Enter")
        expect(page.get_by_role("link", name="Next module")).to_be_focused()
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name=lesson2["title"])).to_be_visible()
        choose(page, lesson2["question"]["prompt"], right2)
        tab_until(page, page.get_by_role("button", name="Check answer"))
        page.keyboard.press("Enter")
        expect(page.get_by_role("link", name="Go to post-evaluation")).to_be_focused()
        page.keyboard.press("Enter")
        expect(page.get_by_role("heading", name="Post-evaluation")).to_be_visible()
        submit = page.get_by_role("button", name="Submit evaluation")
        expect(submit).to_be_disabled()
        tab_until(page, page.get_by_role("radiogroup", name="Overall rating"))
        page.keyboard.press("Space")
        tab_until(page, page.get_by_role("radiogroup", name="Did this activity meet its stated outcomes?"))
        page.keyboard.press("Space")
        expect(submit).to_be_enabled()
        tab_until(page, submit)
        page.keyboard.press("Enter")
        until(page, ON_SEAL, e["id"], seconds=PRESS_WAIT_S)
        expect(page.get_by_role("heading", name="Your contact-hour seal")).to_be_visible()
    assert ok(ben.get(f"/api/enrolments/{e['id']}"))["enrolment"]["certificate_id"] is not None


def test_wf_certificate_issue_seal_press(browser: Browser, app_url: str, mail: Mailpit) -> None:
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    e = enrol(dev, course)
    study(dev, e["id"], course)
    hours = hours_text(60)
    with ui(browser, app_url, DEV, f"/learn/{e['id']}/evaluation", recorder=True, paused=True) as page:
        pick(page.get_by_role("radiogroup", name="Overall rating").get_by_role("radio", name="4"))
        pick(page.get_by_role("radiogroup", name="Did this activity meet its stated outcomes?").get_by_role("radio", name="Yes"))
        click(page.get_by_role("button", name="Submit evaluation"))
        step_until(page, lambda: page.evaluate(ON_SEAL, e["id"]), PRESS_WAIT_S)
        expect(page.get_by_role("button", name="Show result now")).to_be_visible()
        cert = wait_cert(dev, ok(dev.get(f"/api/enrolments/{e['id']}"))["enrolment"]["certificate_id"], sealed)
        step_until(page, lambda: page.evaluate(NUMERAL_IS, hours) and page.evaluate(RING_HAS, cert["serial"]), PRESS_WAIT_S)
        step_until(page, lambda: page.get_by_role("button", name="Show result now").count() == 0, PRESS_WAIT_S)
        numerals = seal_log(page)["numerals"]
        assert numerals[0] == "0.00" and numerals[-1] == hours, numerals
        values = [Decimal(n) for n in numerals]
        assert all(re.fullmatch(r"\d+\.\d{2}", n) for n in numerals) and values == sorted(values)
        assert all((v * 4) == (v * 4).to_integral_value() for v in values), numerals
        seal = page.get_by_role("img", name="Contact-hour seal")
        expect(seal).to_have_attribute("data-seal-state", "sealed")
        wedges = seal.evaluate(WEDGES)
        assert sum(1 for w in wedges.values() if w["state"] == "verified") == cert["verified_module_count"], wedges
        for module in course["modules"]:
            sweep = Decimal(wedges[module["id"]]["sweep"])
            assert abs(sweep - Decimal(module["minutes"] * 360) / course["total_minutes"]) <= SWEEP_TOLERANCE, wedges
        expect(page.get_by_role("status", name="Seal status")).to_contain_text(f"Certificate sealed: {hours} contact hours, serial {cert['serial']}")
        expect(page.get_by_role("button", name="Share with a verifier")).to_be_enabled()
        page.reload()
        step_until(page, lambda: page.evaluate(NUMERAL_IS, hours) and page.evaluate(RING_HAS, cert["serial"]), PRESS_WAIT_S)
        expect(page.get_by_role("button", name="Show result now")).to_have_count(0)
        assert settled_numerals(page) == [hours], seal_log(page)
    assert len(mail_to(mail, f"Your Credwell certificate: {course['title']}", DEV)) == 1


def test_wf_certificate_issue_pending(browser: Browser, app_url: str, mail: Mailpit) -> None:
    s3 = S3()
    course = published_course(app_url)
    ben = Api(app_url, BEN)
    e = enrol(ben, course)
    study(ben, e["id"], course)
    down = outage(MINIO_DOWN_ENV)
    with ui(browser, down, BEN, f"/learn/{e['id']}/evaluation", recorder=True, paused=True) as page:
        pick(page.get_by_role("radiogroup", name="Overall rating").get_by_role("radio", name="5"))
        pick(page.get_by_role("radiogroup", name="Did this activity meet its stated outcomes?").get_by_role("radio", name="Yes"))
        seal = page.get_by_role("img", name="Contact-hour seal")
        with held_sealing(page, e["id"]):
            click(page.get_by_role("button", name="Submit evaluation"))
            step_until(page, lambda: page.evaluate(ON_SEAL, e["id"]), PRESS_WAIT_S)
            expect(seal).to_have_attribute("data-seal-state", "pending")
            pending_label = page.get_by_text("Certificate PDF pending").first
            step_until(page, pending_label.is_visible, PRESS_WAIT_S)
            expect(seal).to_have_attribute("data-seal-state", "pending")
            expect(pending_label).to_be_visible()
            expect(page.get_by_role("button", name="Share with a verifier")).to_be_disabled()
            expect(status(page)).to_contain_text("Your evaluation is recorded. The certificate PDF is still being stored.")
        step_until(page, lambda: page.evaluate(SEAL_STATE_IS, "sealed"), SEAL_WAIT_S, step=PAGE_POLL_MS)
        assert "pending" in seal_log(page)["states"]
        share = page.get_by_role("button", name="Share with a verifier")
        step_until(page, share.is_enabled, PRESS_WAIT_S)
        expect(share).to_be_enabled()
        expect(page.get_by_role("status", name="Seal status")).to_contain_text("Certificate sealed:")
    cert = certificate(ben, ok(ben.get(f"/api/enrolments/{e['id']}"))["enrolment"]["certificate_id"])
    assert cert["state"] == "sealed"
    assert f"certificates/sorrel-pike/{cert['serial']}/v1.pdf" in s3.keys(f"certificates/sorrel-pike/{cert['serial']}/")
    assert len(only_mail(mail, f"Your Credwell certificate: {course['title']}", BEN)) == 1


def test_wf_certificate_issue_keyboard(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    ana = Api(app_url, ANA)
    e = enrol(ana, course)
    study(ana, e["id"], course)
    hours = hours_text(60)
    with ui(browser, app_url, ANA, f"/learn/{e['id']}/evaluation", paused=True) as page:
        expect(page.get_by_role("heading", name="Post-evaluation")).to_be_visible()
        submit = page.get_by_role("button", name="Submit evaluation")
        tab_until(page, page.get_by_role("radiogroup", name="Overall rating"))
        page.keyboard.press("Space")
        tab_until(page, page.get_by_role("radiogroup", name="Did this activity meet its stated outcomes?"))
        page.keyboard.press("Space")
        expect(submit).to_be_enabled()
        tab_until(page, submit)
        page.keyboard.press("Enter")
        step_until(page, lambda: page.evaluate(ON_SEAL, e["id"]), PRESS_WAIT_S, step=0)
        expect(page.get_by_role("heading", name="Your contact-hour seal")).to_be_focused()
        page.keyboard.press("Tab")
        skip = page.get_by_role("button", name="Show result now")
        expect(skip).to_be_focused()
        page.keyboard.press("Enter")
        cert = wait_cert(ana, ok(ana.get(f"/api/enrolments/{e['id']}"))["enrolment"]["certificate_id"], sealed)
        step_until(page, lambda: page.evaluate(NUMERAL_IS, hours) and page.evaluate(RING_HAS, cert["serial"]), PRESS_WAIT_S)
        step_until(page, lambda: skip.count() == 0, PRESS_WAIT_S)
        expect(page.get_by_role("button", name="Share with a verifier")).to_be_focused()
        expect(page.get_by_role("status", name="Seal status")).to_contain_text(f"Certificate sealed: {hours} contact hours, serial {cert['serial']}")
    assert cert["contact_hours"] == hours and cert["enrolment_id"] == e["id"]


def test_wf_transcript_share_happy(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    _, cert = certify(dev, course)
    with ui(browser, app_url, DEV, "/transcript") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        row = page.get_by_role("table", name="Certificates").get_by_role("row").filter(has_text=course["title"])
        click(row.get_by_role("button", name="Share"))
        dialog = page.get_by_role("dialog", name="Share with a verifier")
        box = dialog.get_by_role("textbox", name="Verification link")
        expect(box).to_have_value(re.compile(r"/verify/"))
        expect(status(page)).to_contain_text("Verification link ready. Anyone with this link can see this one certificate.")
        url = box.input_value()
        click(dialog.get_by_role("button", name="Copy link"))
        expect(status(page)).to_contain_text("Link copied.")
        assert page.evaluate("() => navigator.clipboard.readText()") == url
        token = token_of(url)
        with ui(browser, app_url, None, f"/verify/{token}") as verifier:
            expect(verifier.get_by_role("heading", name="Certificate verification")).to_be_visible()
            for value in (cert["nurse_name"], course["title"], cert["serial"], cert["contact_hours"]):
                expect(verifier.get_by_text(value).first).to_be_visible()
            href = verifier.get_by_role("link", name="Download PDF").get_attribute("href") or ""
            assert verifier.request.get(app_url + href if href.startswith("/") else href).body().startswith(b"%PDF")
            click(dialog.get_by_role("button", name="Revoke link"))
            expect(box).to_have_value("No active link")
            expect(status(page)).to_contain_text("Link revoked. It no longer opens the certificate.")
            verifier.reload()
            expect(verifier.get_by_role("heading", name="Link not valid")).to_be_visible()
    assert [l["state"] for l in links_of(dev, cert["id"]).values()] == ["revoked"]


def test_wf_transcript_share_expiry(browser: Browser, app_url: str) -> None:
    short = outage(SHORT_CLOCK_ENV)
    course = published_course(short)
    dev = Api(short, DEV)
    _, cert = certify(dev, course)
    with ui(browser, short, DEV, "/transcript") as page:
        row = page.get_by_role("table", name="Certificates").get_by_role("row").filter(has_text=course["title"])
        click(row.get_by_role("button", name="Share"))
        box = page.get_by_role("dialog", name="Share with a verifier").get_by_role("textbox", name="Verification link")
        expect(box).to_have_value(re.compile(r"/verify/"))
        token = token_of(box.input_value())
    [link] = links_of(dev, cert["id"]).values()
    expires = parse_instant(link["expires_at"])
    poll(lambda: dev.get("/api/health"), lambda r: server_time(r) >= expires.replace(microsecond=0) + timedelta(seconds=2), CLOCK_WAIT_S, "expiry")
    with ui(browser, short, None, f"/verify/{token}") as verifier:
        expect(verifier.get_by_role("heading", name="Link not valid")).to_be_visible()
    assert links_of(dev, cert["id"])[link["id"]]["state"] == "expired"


def test_wf_refunds_approve(browser: Browser, app_url: str, killbill: KillBill) -> None:
    course = published_course(app_url, price="90.00")
    dev = Api(app_url, DEV)
    e = enrol(dev, course)
    with ui(browser, app_url, DEV, "/learning") as page:
        click(entry(page, course["title"]).get_by_role("button", name="Request refund"))
        dialog = page.get_by_role("dialog", name="Request a refund")
        fill(dialog.get_by_role("textbox", name="Reason"), REFUND_REASON)
        click(dialog.get_by_role("button", name="Send request"))
        expect(status(page)).to_contain_text("Refund requested. The nurse planner will review it.")
    planner = Api(app_url, PLANNER)
    request = next(r for r in ok(planner.get("/api/refund-requests"))["refund_requests"] if r["enrolment_id"] == e["id"])
    with ui(browser, app_url, PLANNER, "/planner") as page:
        row = page.get_by_role("region", name="Refund requests").get_by_role("row").filter(has_text=course["title"])
        expect(row).to_contain_text(f"Refund due ${course['list_price']}")
        click(row.get_by_role("button", name="Approve refund"))
        expect(status(page)).to_contain_text(f"Refund of ${course['list_price']} recorded.")
        decided = queue_entry(planner, request["id"])
        expect(row).to_contain_text(f"Approved by Odette Marsh on {mon_d_yyyy(provider_date(decided['decided_at']))}")
    assert decided["state"] == "approved" and ok(dev.get(f"/api/enrolments/{e['id']}"))["enrolment"]["state"] == "refunded"
    payment = killbill.payment_by_key(f"enrol-{e['id']}-learner")
    assert payment is not None
    refunds = [t for t in kb_txs(payment, "REFUND") if t.get("transactionExternalKey") == f"refund-{request['id']}-learner"]
    assert len(refunds) == 1 and kb_cents(refunds[0]["amount"]) == cents(course["list_price"])


def test_wf_refunds_decline_and_outage(browser: Browser, app_url: str) -> None:
    planner, cara = Api(app_url, PLANNER), Api(app_url, CARA)
    blocked, declined = published_course(app_url), published_course(app_url)
    e1, e2 = enrol(cara, blocked), enrol(cara, declined)
    r1 = ok(refund_request(cara, e1["id"]), 201)["refund_request"]
    r2 = ok(refund_request(cara, e2["id"]), 201)["refund_request"]
    with ui(browser, outage(KB_DOWN_ENV), PLANNER, "/planner") as page:
        row = page.get_by_role("region", name="Refund requests").get_by_role("row").filter(has_text=blocked["title"])
        click(row.get_by_role("button", name="Approve refund"))
        expect(alert(page, "Payments are unavailable right now. Nothing was refunded. Try again in a few minutes.")).to_be_visible()
    still = queue_entry(planner, r1["id"])
    assert still["state"] == "pending" and still["decided_by"] is None
    assert ok(cara.get(f"/api/enrolments/{e1['id']}"))["enrolment"]["state"] == "confirmed"
    with ui(browser, app_url, PLANNER, "/planner") as page:
        row = page.get_by_role("region", name="Refund requests").get_by_role("row").filter(has_text=declined["title"])
        click(row.get_by_role("button", name="Decline refund"))
        expect(status(page)).to_contain_text("Refund declined.")
        done = queue_entry(planner, r2["id"])
        expect(row).to_contain_text(f"Declined by Odette Marsh on {mon_d_yyyy(provider_date(done['decided_at']))}")
    assert done["state"] == "declined"


def test_wf_certificate_reissue_name_correction(browser: Browser, app_url: str) -> None:
    ana, planner = Api(app_url, ANA), Api(app_url, PLANNER)
    original = ana.name
    course = published_course(app_url)
    _, cert = certify(ana, course)
    token = token_of(share_link(ana, cert["id"])["url"])
    new_name = f"Ana Ruiz-Marsh {unique('name')[0]}"[:80]
    try:
        set_display_name(ana, new_name)
        assert ok(Api(app_url).get(f"/api/verify/{token}"))["certificate"]["nurse_name"] == original
        with ui(browser, app_url, PLANNER, "/planner") as page:
            region = page.get_by_role("region", name="Certificates")
            search = region.get_by_role("searchbox", name="Search certificates")
            fill(search, cert["serial"])
            search.press("Enter")
            click(region.get_by_role("row").filter(has_text=cert["serial"]).get_by_role("button", name="Reissue"))
            dialog = page.get_by_role("dialog", name="Reissue certificate")
            fill(dialog.get_by_role("textbox", name="Reason"), "Name correction after marriage.")
            click(dialog.get_by_role("button", name="Confirm reissue"))
            expect(status(page)).to_contain_text(re.compile(r"Certificate reissued as version 2\.|Reissue recorded\. The new PDF is still being stored\."))
        after = wait_cert(planner, cert["id"], lambda c: sealed(c) and c["version"] == 2)
        assert after["serial"] == cert["serial"] and after["nurse_name"] == new_name
        with ui(browser, app_url, None, f"/verify/{token}") as verifier:
            expect(verifier.get_by_text(new_name).first).to_be_visible()
    finally:
        set_display_name(ana, original)


def test_wf_certificate_reissue_revoke(browser: Browser, app_url: str) -> None:
    dev = Api(app_url, DEV)
    course = published_course(app_url)
    _, cert = certify(dev, course)
    token = token_of(share_link(dev, cert["id"])["url"])
    with ui(browser, app_url, PLANNER, "/planner") as page:
        region = page.get_by_role("region", name="Certificates")
        search = region.get_by_role("searchbox", name="Search certificates")
        fill(search, cert["serial"])
        search.press("Enter")
        click(region.get_by_role("row").filter(has_text=cert["serial"]).get_by_role("button", name="Revoke"))
        dialog = page.get_by_role("dialog", name="Revoke certificate")
        fill(dialog.get_by_role("textbox", name="Reason"), "Issued in error.")
        click(dialog.get_by_role("button", name="Confirm revoke"))
        expect(status(page)).to_contain_text("Certificate revoked.")
    with ui(browser, app_url, DEV, "/transcript") as page:
        expect(page.get_by_role("table", name="Certificates").get_by_role("row").filter(has_text=course["title"])).to_contain_text("Revoked")
    assert certificate(dev, cert["id"])["state"] == "revoked"
    assert ok(Api(app_url).get(f"/api/verify/{token}"))["certificate"]["state"] == "revoked"
    fails(Api(app_url).get(f"/api/verify/{token}/pdf"), 404, "not_found")


def test_wf_sponsor_reporting_review(browser: Browser, app_url: str) -> None:
    ana = Api(app_url, ANA)
    course = published_course(app_url)
    _, cert = certify(ana, course)
    with ui(browser, app_url, GRACE, "/sponsor") as page:
        totals = page.get_by_role("region", name="Totals")
        for label in ("Seats purchased", "Assigned", "Available", "Expired", "Completions", "Hours awarded"):
            expect(totals.get_by_text(label, exact=True)).to_be_visible()
        search = page.get_by_role("searchbox", name="Search nurses")
        fill(search, "Ana")
        search.press("Enter")
        expect(page.get_by_role("table", name="Nurses")).to_contain_text(ana.name)
        select(page.get_by_role("combobox", name="Report year"), cert["issued_on"][:4])
        expect(page.get_by_role("table", name="Monthly hours")).to_be_visible()
        fill(page.get_by_role("textbox", name="From", exact=True), cert["issued_on"])
        fill(page.get_by_role("textbox", name="To", exact=True), cert["issued_on"])
        click(page.get_by_role("button", name="Export completions CSV"))
        expect(status(page)).to_contain_text(re.compile(r"Export ready: \d+ rows\."))
        href = page.get_by_role("link", name="Download CSV").get_attribute("href") or ""
        body = page.request.get(app_url + href if href.startswith("/") else href).text()
    assert body.splitlines()[0] == CSV_HEADER
    assert any(r["serial"] == cert["serial"] for r in csv_records(body))


def test_wf_sponsor_reporting_search_literal(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, GRACE, "/sponsor") as page:
        search = page.get_by_role("searchbox", name="Search nurses")
        fill(search, "%")
        search.press("Enter")
        table = page.get_by_role("table", name="Nurses")
        expect(table).not_to_contain_text("Ana Ruiz")
        expect(table).not_to_contain_text("Ben Osei")
        fill(search, "x" * (SEARCH_MAX + 1))
        search.press("Enter")
        expect(page.get_by_text("Search with at most 100 characters.")).to_be_visible()
        fill(page.get_by_role("textbox", name="From", exact=True), "2030-01-01")
        fill(page.get_by_role("textbox", name="To", exact=True), "2031-01-02")
        click(page.get_by_role("button", name="Export completions CSV"))
        expect(page.get_by_text("Export at most 366 days at a time.")).to_be_visible()


def test_wf_course_authoring_release(browser: Browser, app_url: str) -> None:
    author, course = draft_course(app_url)
    path = f"/api/courses/{course['id']}"
    ok(author.post(f"{path}/transitions", {"to": "in_review"}, version=1))
    with ui(browser, app_url, PLANNER, "/planner") as page:
        row = page.get_by_role("region", name="Review queue").get_by_role("row").filter(has_text=course["title"])
        queue = page.get_by_role("region", name="Review queue")
        note = page.get_by_role("textbox", name="Note to author")
        fill(course_block(queue, course["title"], note).get_by_role("textbox", name="Note to author").first, UI_RETURN_NOTE)
        click(row.get_by_role("button", name="Return to author"))
        expect(status(page)).to_contain_text(f"Course moved to {STATE_LABELS['draft']}.")
        returned = ok(author.get(path))["course"]
        assert (returned["state"], returned["version"]) == ("draft", 3)
        ok(author.patch(path, {"summary": "Now cites the guideline."}, version=3))
        ok(author.post(f"{path}/transitions", {"to": "in_review"}, version=4))
        page.reload()
        click(page.get_by_role("region", name="Review queue").get_by_role("row").filter(has_text=course["title"]).get_by_role("button", name="Approve and publish"))
        expect(status(page)).to_contain_text(f"Course moved to {STATE_LABELS['published']}.")
        page.reload()
        click(page.get_by_role("row").filter(has_text=course["title"]).get_by_role("button", name="Withdraw course").first)
        expect(status(page)).to_contain_text(f"Course moved to {STATE_LABELS['withdrawn']}.")
    final = ok(author.get(path))["course"]
    assert (final["state"], final["version"]) == ("withdrawn", 7)
    history = ok(author.get(f"{path}/history"))["history"]
    assert [(h["to"], h["by"]["display_name"]) for h in history] == [
        ("in_review", "Felix Amari"), ("draft", "Odette Marsh"), ("in_review", "Felix Amari"),
        ("published", "Odette Marsh"), ("withdrawn", "Odette Marsh")]
    assert history[1]["note"] == UI_RETURN_NOTE


def test_wf_course_authoring_withdrawn(browser: Browser, app_url: str) -> None:
    course = published_course(app_url)
    dev = Api(app_url, DEV)
    _, cert = certify(dev, course)
    token = token_of(share_link(dev, cert["id"])["url"])
    withdraw(app_url, course)
    with ui(browser, app_url, ANA, f"/courses/{course['id']}") as page:
        expect(page.get_by_text("This course has been withdrawn and is no longer open for enrolment.")).to_be_visible()
        expect(page.get_by_role("button", name="Enrol")).to_have_count(0)
    with ui(browser, app_url, DEV, f"/courses/{course['id']}") as page:
        expect(page.get_by_role("link", name="Continue learning")).to_be_visible()
    assert ok(Api(app_url).get(f"/api/verify/{token}"))["certificate"]["state"] == "sealed"
    assert ok(Api(app_url, ANA).get(f"/api/courses/{course['id']}"))["course"]["state"] == "withdrawn"


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0"}


def shipped_packages() -> dict[str, str]:
    cwd = "/app" if Path("/app/node_modules").is_dir() else str(DEPLOYED_APP)
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd,
                         capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
    tree = json.loads(out.stdout)
    packages: dict[str, str] = {}

    def licence(node: dict[str, Any]) -> str:
        value = node.get("license")
        if value is None and node.get("path"):
            value = json.loads((Path(node["path"]) / "package.json").read_text()).get("license")
        if isinstance(value, dict):
            value = value.get("type")
        return str(value)

    def installed(node: dict[str, Any]) -> bool:
        return not node.get("missing") and bool(node.get("path")) and (Path(node["path"]) / "package.json").is_file()

    def walk(node: dict[str, Any]) -> None:
        for name, child in (node.get("dependencies") or {}).items():
            if name not in packages and installed(child):
                packages[name] = licence(child)
                walk(child)

    walk(tree)
    return packages


def licence_allowed(expression: str) -> bool:
    cleaned = expression.replace("(", " ").replace(")", " ")
    return any(all(part.strip() in ALLOWED_LICENCES for part in alt.split(" AND ")) for alt in cleaned.split(" OR "))


def test_if_run_manifest() -> None:
    data = json.loads(Path("/app/run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in data.values())


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [n for n, lic in shipped_packages().items() if n not in notices or lic not in notices]
    assert missing == []
    for font in ("Newsreader", "Public Sans", "OFL-1.1"):
        assert font in notices, font


def test_if_licence_allowlist() -> None:
    bad = {n: lic for n, lic in shipped_packages().items() if not licence_allowed(lic)}
    assert bad == {}


def test_if_no_extra_datastore() -> None:
    assert [n for n in shipped_packages() if any(d.lower() in n.lower() for d in DATASTORE_NAMES)] == []
    stray = [str(p) for p in Path("/app").rglob("*") if "node_modules" not in p.parts and ".git" not in p.parts
             and p.suffix in (".sqlite", ".sqlite3", ".db")]
    assert stray == []


def test_if_services_unchanged(mail: Mailpit, killbill: KillBill) -> None:
    assert Postgres().tables()
    assert isinstance(S3().keys(""), list)
    assert isinstance(mail.messages(settle=0), list)
    killbill.account_by_key("credwell-hospital-harbourview")


def test_if_typescript_only() -> None:
    config = re.compile(r"(\.config\.|^\.[\w.-]*rc\.)(c|m)?js$")
    skipped = {"node_modules", ".git", "dist", "build"}
    offenders = [str(p) for p in Path("/app").rglob("*") if not skipped & set(p.parts)
                 and p.suffix in (".js", ".jsx", ".mjs", ".cjs") and not config.search(p.name)]
    assert offenders == []


def test_if_no_third_party_requests(browser: Browser, app_url: str) -> None:
    seen: list[str] = []
    with ui(browser, app_url, None, None) as page:
        page.on("request", lambda r: seen.append(r.url))
        page.goto(app_url + "/signin")
        fill(page.get_by_role("textbox", name="Email"), GRACE)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        expect(page.get_by_role("heading", name="Courses", level=1)).to_be_visible()
        page.goto(app_url + "/sponsor")
        expect(page.get_by_role("heading", name="Hospital seats")).to_be_visible()
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert foreign == []
