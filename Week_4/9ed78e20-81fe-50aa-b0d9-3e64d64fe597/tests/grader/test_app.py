from __future__ import annotations

import concurrent.futures
import contextlib
import fnmatch
import datetime as dt
import hashlib
import html
import json
import math
import os
import re
import signal
import socket
import statistics
import subprocess
import tempfile
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, BrowserContext, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Mailpit,
    Postgres,
    addresses,
    advance,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    licence_allowed,
    same_origin,
    shipped_packages,
    select,
    unique,
    until,
)


LONDON = ZoneInfo("Europe/London")
PASSWORD = "open-record-seed-2026"
INES = "ines.halloran@aldermoor.example"
TOMAS = "tomas.reyes@aldermoor.example"
ELENI = "eleni.marsh@aldermoor.example"
KOFI = "kofi.brennan@aldermoor.example"
SANA = "sana.qadir@aldermoor.example"
JULES = "jules.okonkwo@aldermoor.example"
ADA = "ada.penrose@aldermoor.example"
NOOR = "noor.vance@aldermoor.example"
THESES = [
    "A claim is only as good as the row beneath it.",
    "Release is a decision with names on it.",
    "Every surface tells the same story at the same moment.",
    "Withdrawal should be as thorough as publication.",
    "Candidates deserve to know where they stand.",
]
BENCH = "ReasonBench-Hard"
EVAL_DATE = "2026-09-14"
COMPARATOR = "halvard-3"
KESTREL2 = "kestrel-2"
WREN1 = "wren-1"
INTRO_K2 = "introducing-kestrel-2"
SIGN_OFF_POST = "how-we-sign-off-a-release"
POLICY_ROLE = "policy-lead-europe"
SEARCH_TERM = "evaluation"
APPLICANT_NAME = "Imogen Tarrant"
NEIGHBOUR_NAME = "Other Person"
NOTES_NAME = "my-notes"
ESCAPE_PROBE = "<b>wall</b>"
EVALUATION_HITS = {
    ("model", "kestrel-2"),
    ("news", "introducing-kestrel-2"),
    ("news", "how-we-sign-off-a-release"),
    ("news", "why-every-score-links-to-a-row"),
    ("role", "research-engineer-evaluations"),
}
STAGE_LABELS = {"submitted": "Submitted", "screening": "Screening", "interview": "Interview",
                "final_review": "Final review", "offer": "Offer", "declined": "Not progressing",
                "withdrawn": "Withdrawn"}
NOT_PUBLISHED = {"error": "not_found", "message": "Nothing is published at this address."}
GONE_ITEM = {"error": "gone", "message": "This item has been withdrawn."}
GONE_ROLE = {"error": "gone", "message": "This role has closed."}
BAD_LINK = {"error": "not_found", "message": "This tracking link is not valid."}
FORBIDDEN = {"error": "forbidden", "message": "Your current roles do not allow this."}
AUTHOR_REFUSED = {"error": "author_cannot_approve",
                  "message": "Authors cannot approve, sign off, clear, schedule or release their own work."}
VERSION_REQUIRED = {"error": "version_required", "message": "Send the version you are changing in If-Match."}
STALE = {"error": "stale_version", "message": "Someone else changed this item. Reload to see the latest version."}
RESEND_BODY = {"message": "If that address has applied for a role with us, we've sent its tracking links to it."}
RESUME_MESSAGE = "Attach a PDF résumé of at most 5,000,000 bytes."
RECEIVED = "Application received. Your receipt and tracking link are on their way to {email}."

NEWS_PAGE_SIZE = 10
SEARCH_PAGE_LIMIT = 3
SEARCH_MAX_PAGES = 200
SMTP_MAX_CONNECTIONS = 1000
REVEAL_MAX_STEPS = 2000
JSON_MAX_BYTES = 100_000
MULTIPART_MAX_BYTES = 6_000_000
RESUME_MAX_BYTES = 5_000_000
TITLE_MAX = 120
DESCRIPTION_MAX = 8_000
SUMMARY_MAX = 500
REASON_MAX = 2_000
RESEND_LIMIT = 3
TIMING_TOLERANCE_S = 0.25
LOCKOUT_FAILURES = 5
LOCKOUT_S = 30
PUBLIC_LIMIT = 600
CANDIDATE_LIMIT = 60
SIGNIN_LIMIT = 20
CONSOLE_WRITE_LIMIT = 120
RATE_WINDOW_S = 60
RELEASE_LAG_S = 5
VOID_LAG_S = 60
EXPIRY_NOTICE_LAG_S = 60
RETENTION_LAG_S = 60
READY_LAG_S = 10
MAIL_DEADLINE_S = 60 + 10
TOKEN_MIN_CHARS = 32
TAP_TARGET_PX = 44
NARROW_PX = 375
REVEAL_MIN_MS = 500
REVEAL_MAX_MS = 800
BAR_MIN_MS = 400
BAR_MAX_MS = 600
STAGGER_MIN_MS = 40
STAGGER_MAX_MS = 80
LINE_MIN_MS = 500
LINE_MAX_MS = 650
FADE_MIN_MS = 200
FADE_MAX_MS = 300
CONTINUITY_MIN_MS = 300
CONTINUITY_MAX_MS = 500
CHART_ENTRY_ADVANCE_MS = 1_500
EARLY_SAMPLE_MS = 100


HTTP_TIMEOUT_S = 30
POLL_INTERVAL_S = 0.25
SETTLE_S = 3
BOOT_DEADLINE_S = 180
UI_TIMEOUT_MS = 15_000
SLACK_S = 2
FRAME_MS = 17
REDUCED_SETTLE_MS = 100
SHORT_VIEWPORT_PX = 360
TITLE_WRAPPER_CHARS = 80
FAR_EMBARGO = "2030-06-03T09:00"
FREE_CONTROLS = 3
RETENTION_PROBE_S = 5
APP_ROOT = Path("/app")
ATOM = "{http://www.w3.org/2005/Atom}"
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1", "CC0-1.0"}

expect.set_options(timeout=UI_TIMEOUT_MS)
_PAUSE = threading.Event()


def poll(check: Callable[[], Any], seconds: float, what: str, interval: float = POLL_INTERVAL_S) -> Any:
    deadline = time.monotonic() + seconds
    for _ in range(int(seconds / interval) + 2):
        value = check()
        if value:
            return value
        if time.monotonic() >= deadline:
            break
        _PAUSE.wait(interval)
    raise AssertionError(f"{what}: not observed within {seconds} s")


def wait_until_instant(moment: dt.datetime, what: str) -> None:
    remaining = (moment - now()).total_seconds()
    poll(lambda: now() >= moment, max(remaining, 0) + SLACK_S, what)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(moment: dt.datetime) -> str:
    return moment.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def instant(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def page_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", markup)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", markup)))


def text(message: dict[str, Any]) -> str:
    plain = (message.get("Text") or "").replace("\r\n", "\n")
    markup = message.get("HTML") or ""
    return "\n".join(part for part in (plain, page_text(markup), markup) if part)


def staff_name(email: str) -> str:
    return " ".join(part.capitalize() for part in email.split("@")[0].split("."))


def is_staff(value: Any, email: str) -> bool:
    values = value.values() if isinstance(value, dict) else [value]
    return any(isinstance(v, str) and v.strip().lower() in {email.lower(), staff_name(email).lower()} for v in values)


def london_text(moment: dt.datetime) -> str:
    local = moment.astimezone(LONDON)
    return f"{local.day} {local.strftime('%B')} {local.year}, {local:%H:%M}"


def london_input(moment: dt.datetime) -> str:
    return moment.astimezone(LONDON).strftime("%Y-%m-%dT%H:%M:%S")


def fresh_slug(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def fresh_word() -> str:
    return "qv" + uuid.uuid4().hex[:10]


def fresh_email(prefix: str = "visitor") -> str:
    return unique(prefix)[1].strip().lower()


def error_of(response: httpx.Response) -> str | None:
    try:
        return response.json().get("error")
    except ValueError:
        return None


def send(client: httpx.Client, method: str, path: str, **kwargs: Any) -> httpx.Response:
    last: dict[str, httpx.Response] = {}

    def attempt() -> httpx.Response | None:
        response = client.request(method, path, **kwargs)
        last["r"] = response
        if response.status_code == 429 and error_of(response) == "rate_limited":
            return None
        return response

    try:
        return poll(attempt, RATE_WINDOW_S + SLACK_S * 3, f"{method} {path} outside a rate-limit window", 1.0)
    except AssertionError:
        return last["r"]


_CLIENTS: dict[str, httpx.Client] = {}


def client(base: str) -> httpx.Client:
    if base not in _CLIENTS:
        _CLIENTS[base] = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    return _CLIENTS[base]


def get(base: str, path: str, **kwargs: Any) -> httpx.Response:
    return send(client(base), "GET", path, **kwargs)


PROBE_TOKEN = "0" * 40


def forwarded() -> str:
    n = uuid.uuid4().int
    return f"10.{n % 250}.{(n >> 8) % 250}.{(n >> 16) % 250 + 1}"


def headroom(base: str, bucket: str, needed: int) -> None:
    def probe() -> httpx.Response:
        if bucket == "candidate":
            return client(base).get(f"/api/track/{PROBE_TOKEN}")
        if bucket == "signin":
            return client(base).post("/api/console/session",
                                     json={"email": fresh_email("probe"), "password": "not-the-password"})
        return client(base).get("/api/public/benefits")

    def ready() -> bool:
        response = probe()
        if response.status_code == 429:
            return False
        return int(response.headers.get("RateLimit-Remaining", "0")) >= needed

    poll(ready, RATE_WINDOW_S + SLACK_S * 3, f"{bucket} rate-limit headroom", 1.0)


def minio_down() -> str:
    return os.environ["APP_MINIO_DOWN_URL"].rstrip("/")


def mailpit_down() -> str:
    return os.environ["APP_MAILPIT_DOWN_URL"].rstrip("/")


class Console:
    def __init__(self, base: str, email: str) -> None:
        self.base = base
        self.email = email
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
        response = send(self.http, "POST", "/api/console/session", json={"email": email, "password": PASSWORD})
        assert response.status_code == 200, f"sign-in {email} on {base}: {response.status_code} {response.text}"

    def call(self, method: str, path: str, body: Any = None, *, version: int | None = None,
             key: str | bool | None = None, headers: dict[str, str] | None = None,
             params: dict[str, Any] | None = None) -> httpx.Response:
        sent = dict(headers or {})
        if version is not None:
            sent["If-Match"] = f'"{version}"'
        if method != "GET" and key is not False:
            sent["Idempotency-Key"] = key if isinstance(key, str) else idempotency_key()
        if method == "GET":
            return send(self.http, method, path, headers=sent, params=params)
        return send(self.http, method, path, json={} if body is None else body, headers=sent)

    def cookie_header(self) -> str:
        return "; ".join(f"{name}={value}" for name, value in self.http.cookies.items())


_CONSOLES: dict[tuple[str, str], Console] = {}


def console(base: str, email: str) -> Console:
    if (base, email) not in _CONSOLES:
        _CONSOLES[(base, email)] = Console(base, email)
    return _CONSOLES[(base, email)]


def race(*calls: Callable[[], httpx.Response]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return call()

    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        return [future.result() for future in [pool.submit(run, call) for call in calls]]


def content_of(response: httpx.Response) -> dict[str, Any]:
    body = response.json()
    return body.get("content", body)


def content_get(base: str, item_id: str) -> dict[str, Any]:
    response = console(base, ELENI).call("GET", f"/api/console/content/{item_id}")
    assert response.status_code == 200, response.text
    return response.json()["content"]


def act(base: str, who: str, item: dict[str, Any], verb: str, body: dict[str, Any] | None = None,
        status: int = 200) -> dict[str, Any]:
    response = console(base, who).call("POST", f"/api/console/content/{item['id']}/{verb}", body or {},
                                       version=item["version"])
    assert response.status_code == status, f"{verb} by {who}: {response.status_code} {response.text}"
    return content_of(response)


def new_news(base: str, *, author: str = INES, subject: str = "research", tags: list[str] | None = None,
             title: str | None = None, body: str | None = None, summary: str | None = None) -> dict[str, Any]:
    payload = {"kind": "news", "slug": fresh_slug("news"), "title": title or f"Field note {fresh_word()}",
               "summary": summary or "A short note from the record.",
               "body": body or "## Overview\nA plain paragraph for the record.",
               "subject": subject, "tags": tags or ["field-notes"]}
    response = console(base, author).call("POST", "/api/console/content", payload)
    assert response.status_code == 201, response.text
    return response.json()["content"]


def approved_news(base: str, *, author: str = INES, approver: str = ELENI, **kwargs: Any) -> dict[str, Any]:
    item = new_news(base, author=author, **kwargs)
    item = act(base, author, item, "submit")
    return act(base, approver, item, "approve")


def published_news(base: str, *, author: str = INES, approver: str = ELENI, **kwargs: Any) -> dict[str, Any]:
    item = approved_news(base, author=author, approver=approver, **kwargs)
    item = act(base, approver, item, "schedule", {"release_at_local": FAR_EMBARGO})
    return act(base, approver, item, "release")


def claim(claim_id: str, text_: str, delta: str, *, eval_date: str = EVAL_DATE) -> dict[str, Any]:
    return {"id": claim_id, "text": text_, "benchmark": BENCH, "eval_date": eval_date,
            "comparator": COMPARATOR, "stated_delta": delta}


def route_title() -> str:
    return f"Osprey {uuid.uuid4().int % 900000 + 100000}"


def record_row(base: str, who: str, subject: str, score: str, *, benchmark: str = BENCH,
               eval_date: str = EVAL_DATE) -> dict[str, Any]:
    response = console(base, who).call("POST", "/api/console/benchmark-rows", {
        "subject": subject, "benchmark": benchmark, "eval_date": eval_date, "score": score,
        "source_note": "Verifier harness run."})
    assert response.status_code == 201, response.text
    return response.json()["row"]


ROUTE_SCORE = "72.5"
ROUTE_DELTA = "+4.3"


def new_route(base: str, *, author: str = TOMAS, title: str | None = None, summary: str | None = None,
              claims: list[dict[str, Any]] | None = None, body: str | None = None, linked: str | None = None,
              row: bool = True) -> dict[str, Any]:
    title = title or route_title()
    claims = claims if claims is not None else [
        claim("c1", f"On {BENCH}, {title} scores {ROUTE_SCORE}, 4.3 points above Halvard 3.", "4.3")]
    payload: dict[str, Any] = {"kind": "model", "slug": fresh_slug("route"), "title": title,
                               "summary": summary or "A careful reader built for the record.",
                               "body": body or "## What it is\nA careful reader for long documents. [claim:c1]",
                               "claims": claims}
    if linked:
        payload["linked_news_slug"] = linked
    response = console(base, author).call("POST", "/api/console/content", payload)
    assert response.status_code == 201, response.text
    item = response.json()["content"]
    if row:
        record_row(base, author, item["slug"], ROUTE_SCORE)
    return item


def signoff(base: str, who: str, item: dict[str, Any], kind: str) -> httpx.Response:
    return console(base, who).call("POST", f"/api/console/content/{item['id']}/release-record/signoffs",
                                   {"kind": kind, "note": ""})


def record_call(base: str, who: str, item: dict[str, Any], verb: str) -> httpx.Response:
    return console(base, who).call("POST", f"/api/console/content/{item['id']}/release-record/{verb}", {})


def release_record(base: str, item: dict[str, Any]) -> dict[str, Any]:
    response = console(base, ELENI).call("GET", f"/api/console/content/{item['id']}/release-record")
    assert response.status_code == 200, response.text
    return response.json()["record"]


def cleared_route(base: str, route: dict[str, Any], *, author: str = TOMAS) -> dict[str, Any]:
    route = act(base, author, route, "submit")
    assert signoff(base, ELENI, route, "safety").status_code == 201
    assert signoff(base, KOFI, route, "legal").status_code == 201
    assert record_call(base, KOFI, route, "validate-claims").status_code == 200
    assert record_call(base, ELENI, route, "clear").status_code == 200
    return act(base, ELENI, content_get(base, route["id"]), "approve")


def published_route(base: str, **kwargs: Any) -> dict[str, Any]:
    route = cleared_route(base, new_route(base, **kwargs))
    route = act(base, ELENI, route, "schedule", {"release_at_local": FAR_EMBARGO})
    return act(base, ELENI, route, "release")


def audit(base: str, **params: Any) -> list[dict[str, Any]]:
    response = console(base, ADA).call("GET", "/api/console/audit", params={"limit": 500, **params})
    assert response.status_code == 200, response.text
    return response.json()["entries"]


def audit_ids(base: str) -> set[str]:
    return {str(e["id"]) for e in audit(base)}


def route_audit(base: str, route: dict[str, Any], since: set[str] | None = None) -> list[dict[str, Any]]:
    targets = {str(route["id"])}
    record_id = release_record(base, route).get("id")
    if record_id is not None:
        targets.add(str(record_id))
    entries = [e for target in targets for e in audit(base, target_id=target)]
    entries += [e for e in audit(base) if e["action"].startswith(("signoff.", "release_record."))
                and (str(route["id"]) in json.dumps(e.get("detail")) or (since is not None and str(e["id"]) not in since))]
    return sorted({e["id"]: e for e in entries}.values(), key=lambda e: e["at"], reverse=True)


def lapse_voids(base: str, route: dict[str, Any], since: set[str], detail: dict[str, Any]) -> list[dict[str, Any]]:
    voids = [e for e in route_audit(base, route) if e["action"] == "release_record.void"]
    if voids:
        assert len(voids) == 1, voids
        return voids
    voids = [e for e in route_audit(base, route, since=since)
             if e["action"] == "release_record.void" and e.get("detail") == detail]
    assert voids, "no release_record.void entry for the lapsed sign-off"
    return voids


def new_requisition(base: str, recruiter: str = SANA, *, office: str = "london", discipline: str = "research",
                    title: str | None = None, description: str | None = None, recruiters: list[str] | None = None,
                    open_it: bool = True) -> dict[str, Any]:
    slug = fresh_slug("role")
    response = console(base, recruiter).call("POST", "/api/console/requisitions", {
        "slug": slug, "title": title or f"Records Fellow {slug[-8:]}", "discipline": discipline, "office": office,
        "description": description or "Work with the record team on careful reading of long documents.",
        "recruiters": recruiters or [recruiter]})
    assert response.status_code == 201, response.text
    requisition = response.json()["requisition"]
    return requisition_act(base, recruiter, requisition, "open") if open_it else requisition


def requisition_act(base: str, who: str, requisition: dict[str, Any], verb: str,
                    body: dict[str, Any] | None = None, status: int = 200) -> dict[str, Any]:
    response = console(base, who).call("POST", f"/api/console/requisitions/{requisition['id']}/{verb}", body or {},
                                       version=requisition["version"])
    assert response.status_code == status, f"{verb}: {response.status_code} {response.text}"
    return response.json().get("requisition", response.json())


def make_pdf(size: int | None = None) -> bytes:
    head = b"%PDF-1.4\n% verifier fixture " + uuid.uuid4().hex.encode() + b"\n"
    if size is None:
        return head + b"%%EOF\n"
    return (head + b"0" * max(size - len(head), 0))[:size]


def apply(base: str, role_slug: str, name: str, email: str, pdf: bytes | None = None, *, key: str | None = None,
          consent: str = "yes", filename: str = "resume.pdf", content_type: str = "application/pdf") -> httpx.Response:
    headers = {"Idempotency-Key": key} if key else {}
    return send(client(base), "POST", f"/api/careers/roles/{role_slug}/applications",
                data={"name": name, "email": email, "consent": consent},
                files={"resume": (filename, make_pdf() if pdf is None else pdf, content_type)}, headers=headers)


def applications(base: str, recruiter: str, requisition: dict[str, Any]) -> list[dict[str, Any]]:
    response = console(base, recruiter).call("GET", f"/api/console/requisitions/{requisition['id']}/applications")
    assert response.status_code == 200, response.text
    return response.json()["applications"]


def application_for(base: str, recruiter: str, requisition: dict[str, Any], email: str) -> dict[str, Any]:
    match = [a for a in applications(base, recruiter, requisition) if a["email"] == email.strip().lower()]
    assert len(match) == 1, match
    response = console(base, recruiter).call("GET", f"/api/console/applications/{match[0]['id']}")
    assert response.status_code == 200, response.text
    return response.json()["application"]


def newest(decisions: list[dict[str, Any]], stage: str) -> dict[str, Any]:
    into = [d for d in decisions if d["to"] == stage]
    assert into, decisions
    return max(into, key=lambda d: instant(d["at"]))


def move(base: str, who: str, application: dict[str, Any], to: str, rationale: str = "Strong written exercise.",
         version: int | None = None) -> httpx.Response:
    return console(base, who).call("POST", f"/api/console/applications/{application['id']}/stage",
                                   {"to": to, "rationale": rationale},
                                   version=application["version"] if version is None else version)


def inbox(mail: Mailpit, email: str, subject: str | None = None) -> list[dict[str, Any]]:
    found = []
    for message in mail.messages(0, 0.1):
        recipients = [a.lower() for a in addresses(message.get("To"))]
        if email.lower() in recipients and (subject is None or str(message.get("Subject", "")).startswith(subject)):
            found.append(message)
    return found


def await_mail(mail: Mailpit, email: str, subject: str, count: int = 1,
               seconds: float = MAIL_DEADLINE_S) -> list[dict[str, Any]]:
    return poll(lambda: (lambda found: found if len(found) >= count else None)(inbox(mail, email, subject)),
                seconds, f"{count} message(s) '{subject}' to {email}", 1.0)


def settled(mail: Mailpit, email: str, subject: str | None = None) -> list[dict[str, Any]]:
    mail.messages(0, SETTLE_S)
    return inbox(mail, email, subject)


def distinct(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for message in messages:
        seen.setdefault(str(message.get("MessageID") or message.get("ID")), message)
    return list(seen.values())


def token_in(message: dict[str, Any]) -> str:
    body = text(message)
    quoted = re.findall(r"""/track/([A-Za-z0-9._~-]+)["']""", body)
    if quoted:
        return quoted[-1]
    bare = re.findall(r"/track/([A-Za-z0-9._~-]+)", body)
    assert bare, body
    return bare[-1].rstrip(".")


def applied_with_token(base: str, mail: Mailpit, requisition: dict[str, Any], name: str = "Rowan Ellery",
                       email: str | None = None, pdf: bytes | None = None) -> tuple[str, str]:
    email = email or fresh_email("candidate")
    response = apply(base, requisition["slug"], name, email, pdf)
    assert response.status_code == 201, response.text
    receipt = await_mail(mail, email, f"Application received: {requisition['title']}")[0]
    return email, token_in(receipt)


def grants(base: str) -> list[dict[str, Any]]:
    response = console(base, ADA).call("GET", "/api/console/grants")
    assert response.status_code == 200, response.text
    return response.json()["grants"]


def revoke(base: str, grant: dict[str, Any], status: int = 200) -> httpx.Response:
    response = console(base, ADA).call("POST", f"/api/console/grants/{grant['id']}/revoke", {},
                                       version=grant["version"])
    assert response.status_code == status, response.text
    return response


def clear_grants(base: str, email: str, role: str) -> None:
    for grant in grants(base):
        if grant["staff_email"] == email and grant["role"] == role and grant["status"] == "active":
            revoke(base, grant)


def grant(base: str, email: str, role: str, expires_at: dt.datetime) -> dict[str, Any]:
    clear_grants(base, email, role)
    response = console(base, ADA).call("POST", "/api/console/grants",
                                       {"staff_email": email, "role": role, "expires_at": iso(expires_at)})
    assert response.status_code == 201, response.text
    return response.json()["grant"]


def all_news(base: str, **params: Any) -> list[dict[str, Any]]:
    first = get(base, "/api/public/news", params=params).json()
    items = list(first["items"])
    for number in range(2, first["pages"] + 1):
        items += get(base, "/api/public/news", params={**params, "page": number}).json()["items"]
    return items


def search_all(base: str, q: str, **params: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor = None
    for _ in range(SEARCH_MAX_PAGES):
        query = {"q": q, **params, **({"cursor": cursor} if cursor else {})}
        response = get(base, "/api/public/search", params=query)
        assert response.status_code == 200, response.text
        body = response.json()
        items += body["items"]
        cursor = body["next_cursor"]
        if not cursor:
            return items
    pytest.fail(f"search {q!r}: next_cursor still set after {SEARCH_MAX_PAGES} pages (L793: the cursor ends)")


def feed(base: str) -> tuple[str | None, list[tuple[str, str]]]:
    response = get(base, "/feed.xml")
    assert response.status_code == 200 and "atom+xml" in response.headers["content-type"]
    root = ET.fromstring(response.content)
    entries = [(entry.findtext(ATOM + "id") or "", entry.findtext(ATOM + "updated") or "")
               for entry in root.findall(ATOM + "entry")]
    return root.findtext(ATOM + "updated"), entries


def sitemap_paths(base: str) -> list[str]:
    response = get(base, "/sitemap.xml")
    assert response.status_code == 200 and "xml" in response.headers["content-type"]
    root = ET.fromstring(response.content)
    return [urlparse(el.text or "").path or "/" for el in root.iter() if el.tag.endswith("loc")]


def expected_rail(base: str) -> list[str]:
    entries = [(-instant(m["published_at"]).timestamp(), 0, m["title"], m["slug"])
               for m in get(base, "/api/public/models").json()["items"]]
    entries += [(-instant(n["published_at"]).timestamp(), 1, n["title"], n["slug"]) for n in all_news(base)]
    return [entry[3] for entry in sorted(entries)[:5]]


def assert_rail(base: str) -> None:
    rail = [e["slug"] for e in get(base, "/api/public/home").json()["rail"]]
    published = {m["slug"]: instant(m["published_at"]) for m in get(base, "/api/public/models").json()["items"]}
    published |= {n["slug"]: instant(n["published_at"]) for n in all_news(base)}
    assert len(rail) == min(5, len(published)) and set(rail) <= set(published), rail
    times = [published[slug] for slug in rail]
    assert times == sorted(times, reverse=True), rail
    assert all(when <= times[-1] for slug, when in published.items() if slug not in rail), rail
    expected = expected_rail(base)
    assert sorted(published[s] for s in expected) == sorted(times), (rail, expected)


def assert_in_order(haystack: str, titles: list[str]) -> None:
    lines = [line.strip() for line in haystack.splitlines()]

    def position(title: str) -> int:
        exact = [i for i, line in enumerate(lines) if line == title]
        loose = [i for i, line in enumerate(lines) if title in line]
        return (exact or loose or [-1])[0]

    positions = [position(title) for title in titles]
    assert all(p >= 0 for p in positions), (titles, positions)
    assert positions == sorted(positions), (titles, positions)


def in_order(text: str, titles: list[str]) -> bool:
    try:
        assert_in_order(text, titles)
    except AssertionError:
        return False
    return True


def wait_query(page: Page, **expected: str | None) -> None:
    def matches(url: str) -> bool:
        query = parse_qs(urlparse(url).query)
        return all(query.get(key) == [value] if value is not None else key not in query
                   for key, value in expected.items())

    page.wait_for_url(matches)


def facet_name(facets: list[dict[str, Any]], value: str, label_key: str = "label") -> str:
    facet = next(f for f in facets if f["value"] == value)
    return f"{facet[label_key]} ({facet['count']})"


def staff_page(browser: Browser, base: str, email: str, **context_args: Any) -> tuple[BrowserContext, Page]:
    headroom(base, "signin", 1)
    context = browser.new_context(base_url=base, **context_args)
    page = context.new_page()
    page.goto("/console/sign-in")
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    expect(page).to_have_url(re.compile(r"/console/?$"))
    return context, page


FOCUSED_NAME_JS = """() => { const e = document.activeElement; if (!e || e === document.body) return '';
  const by = (e.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)?.innerText || '').join(' ');
  return (by || e.getAttribute('aria-label') || [...(e.labels || [])].map((l) => l.innerText).join(' ')
    || e.innerText || e.getAttribute('title') || e.getAttribute('placeholder') || '').trim(); }"""
FOCUS_LOOK_JS = """(el) => { const keys = ['outline-style', 'outline-width', 'outline-color', 'box-shadow',
  'border-top-color', 'border-bottom-color', 'border-bottom-width', 'background-color', 'text-decoration-line',
  'text-decoration-thickness', 'color'];
  const read = (pseudo) => { const s = getComputedStyle(el, pseudo); return keys.map((k) => s.getPropertyValue(k)).join('|')
    + '|' + s.getPropertyValue('content'); };
  const wrap = el.parentElement;  // a ring drawn by the wrapping element counts too
  const around = wrap ? keys.map((k) => getComputedStyle(wrap).getPropertyValue(k)).join('|') : '';
  return [read(null), read('::before'), read('::after'), around].join('#'); }"""


def tab_order(page: Page, presses: int) -> list[str]:
    names = []
    for _ in range(presses):
        page.keyboard.press("Tab")
        names.append(page.evaluate(FOCUSED_NAME_JS))
    return names


def console_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Console status")


def native(locator: Locator) -> bool:
    return locator.evaluate("(e) => e.tagName") == "SELECT"


def choose(locator: Locator, value: str, label: str) -> None:
    del value
    select(locator, label)


VIEW_TRANSITION_IDLE_JS = """() => !document.getAnimations().some(
  (a) => String((a.effect && a.effect.pseudoElement) || '').startsWith('::view-transition'))"""
SELECTED_LABEL_JS = """(e) => e.tagName === 'SELECT' && e.selectedOptions.length
  ? (e.selectedOptions[0].label || e.selectedOptions[0].text || '').trim() : null"""


def _settled(page: Page) -> bool:
    try:
        return page.evaluate(VIEW_TRANSITION_IDLE_JS)
    except PlaywrightError:
        return False


def choose_filter(page: Page, locator: Locator, value: str, label: str) -> None:
    already = locator.evaluate(SELECTED_LABEL_JS) == label
    before = page.url
    choose(locator, value, label)
    if not already:
        poll(lambda: page.url != before, UI_TIMEOUT_MS / 1000, f"choosing {label} pushes a new address")
    page.wait_for_load_state("load")
    poll(lambda: _settled(page), UI_TIMEOUT_MS / 1000, "the view transition ends")


def offers(locator: Locator, label: str) -> bool:
    if native(locator):
        return label in [t.strip() for t in locator.evaluate("(e) => [...e.options].map((o) => o.label || o.text)")]
    locator.click()
    found = locator.page.get_by_role("option", name=label, exact=True).count() > 0
    locator.press("Escape")
    return found


MOTION_RECORDER = """
(() => {
  const log = [];
  window.__motion = log;
  const entry = (el, kind, timing, fake, real) => {
    const target = el instanceof Element ? el : null;
    const row = target && target.closest('[data-row-id]');
    const line = target && target.closest('[data-tether-line]');
    const reveal = target && target.closest('[data-reveal]');
    return {kind, row: row ? row.getAttribute('data-row-id') : null,
      line: line ? line.getAttribute('data-tether-line') : null, reveal: !!reveal,
      heading: !!(target && target.closest('h1')),
      title: target ? (target.textContent || '').trim().slice(0, 200) : '',
      delay: Number(timing.delay) || 0, duration: Number(timing.duration) || 0, fake, real};
  };
  const describe = (el, kind, timing) => log.push(
    entry(el, kind, timing, performance.now(), Number(document.timeline.currentTime) || 0));
  // requestAnimationFrame motion leaves no Animation object: time each element's runs of per-frame style or
  // geometry writes on the page clock instead. A pause longer than a few frames ends a run, so a one-off write at
  // load (bars set to zero, a pending section hidden) is not merged into the later motion.
  const GAP_MS = 50;
  const open = new Map();
  const done = [];
  new MutationObserver((records) => {
    const fake = performance.now();
    for (const record of records) {
      const run = open.get(record.target);
      if (run && fake - run.last <= GAP_MS) { run.last = fake; continue; }
      if (run) done.push([record.target, run]);
      open.set(record.target, {first: fake, last: fake, real: Number(document.timeline.currentTime) || 0});
    }
  }).observe(document, {subtree: true, attributes: true,
    attributeFilter: ['style', 'transform', 'opacity', 'width', 'height', 'x', 'y', 'd', 'stroke-dashoffset']});
  window.__motionFrames = () => done.concat([...open]).filter(([, r]) => r.last > r.first)
    .map(([el, r]) => entry(el, 'frames', {delay: 0, duration: r.last - r.first}, r.first, r.real));
  window.__motionReset = () => { log.length = 0; done.length = 0; open.clear(); };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const animation = original.call(this, keyframes, options);
    try { describe(this, 'waapi', animation.effect.getComputedTiming()); } catch (error) {}
    return animation;
  };
  document.addEventListener('transitionrun', (event) => {
    const match = event.target.getAnimations().find((a) => a.transitionProperty === event.propertyName);
    if (match) describe(event.target, 'transition', match.effect.getComputedTiming());
  }, true);
  document.addEventListener('animationstart', (event) => {
    const match = event.target.getAnimations().find((a) => a.animationName === event.animationName);
    if (match) describe(event.target, 'css-animation', {delay: 0, duration: match.effect.getComputedTiming().duration});
  }, true);
})();
"""

DELTA_TEXT = """() => [...document.querySelectorAll('[data-tether-delta]')]
  .map((el) => (el.textContent || '').trim()).find((t) => t) || ''"""
LOCAL_TIME_JS = """(iso) => { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {day: 'numeric',
 month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(iso))
 .map((p) => [p.type, p.value])); return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`; }"""


RESET_MOTION_JS = "() => { if (window.__motionReset) window.__motionReset(); }"
LINE_TRANSITION_MS_JS = """(id) => { const ms = (t) => t.endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000;
  const declared = (el) => { const style = getComputedStyle(el), props = style.transitionProperty.split(',');
    const times = style.transitionDuration.split(','); const at = props.findIndex((p) => ['stroke-dashoffset', 'all'].includes(p.trim()));
    return at < 0 ? 0 : ms(times[at % times.length].trim()); };
  const roots = [...document.querySelectorAll('[data-tether-line]')].filter((el) => el.getAttribute('data-tether-line') === id);
  return Math.max(0, ...roots.flatMap((el) => [el, ...el.querySelectorAll('*')]).map(declared)); }"""


def recorded(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("() => (window.__motion ? window.__motion.slice() : [])"
                         ".concat(window.__motionFrames ? window.__motionFrames() : [])")


def lasts(record: dict[str, Any], low: float, high: float) -> bool:
    slack = FRAME_MS if record["kind"] == "frames" else 0
    return low - slack <= record["duration"] <= high + slack


ROWS_JS = """(el) => Object.fromEntries([...el.querySelectorAll('[data-row-id]')]
  .map((row) => [row.getAttribute('data-row-id'), row.getAttribute('data-cited') || '']))"""
ROW_ORDER_JS = "(el) => [...el.querySelectorAll('[data-row-id]')].map((row) => row.getAttribute('data-row-id'))"
TETHER_LINE_JS = """(id) => { const lines = [...document.querySelectorAll('[data-tether-line]')]
  .filter((el) => el.getAttribute('data-tether-line') === id);
  if (!lines.length) return null;
  const line = lines.find((el) => el.getClientRects().length) || lines[0];
  const label = (el) => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'),
    getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content].join(' ');
  return {text: label(line) + ' ' + (line.parentElement ? label(line.parentElement) : ''),
          hidden: line.closest('[aria-hidden="true"], [inert]') !== null}; }"""
CLAIM_JS = "(id) => new URLSearchParams(location.search).get('claim') === id"
REVEAL_STATES_JS = "() => [...document.querySelectorAll('[data-reveal]')].map((el) => el.getAttribute('data-reveal'))"
REVEAL_LAST_JS = """() => { const all = document.querySelectorAll('[data-reveal]');
  all[all.length - 1].scrollIntoView(); return true; }"""
CURRENT_STEP_JS = """(el) => { const step = el.querySelector('[aria-current="step"]');
  return step ? (step.textContent || '').trim() : ''; }"""


def settle_to(page: Page, read: Callable[[], Any], want: Any, what: str, seconds: float = 30) -> None:
    deadline = time.monotonic() + seconds
    while (value := read()) != want:
        if time.monotonic() > deadline:
            raise AssertionError(f"{what}: {value!r}, never {want!r}")
        advance(page, 48)


def pressed(page: Page, marker: Locator, value: str) -> None:
    settle_to(page, lambda: marker.get_attribute("aria-pressed"), value, "aria-pressed")


def tether_rows(page: Page) -> dict[str, str]:
    return page.get_by_role("figure", name="Benchmark results").evaluate(ROWS_JS)


def tether_line(page: Page, claim_id: str) -> dict[str, Any] | None:
    return page.evaluate(TETHER_LINE_JS, claim_id)


def tether_announcement(model: dict[str, Any], number: int) -> str:
    cited = next(c for c in model["claims"] if c["number"] == number)
    rows = {str(r["id"]): r for r in model["rows"]}
    mine, other = rows[str(cited["model_row_id"])], rows[str(cited["comparator_row_id"])]
    day = dt.date.fromisoformat(cited["eval_date"])
    when = f"{day.day} {day.strftime('%B')} {day.year}"
    return (f"Claim {number}: {cited['benchmark']}, {model['title']} {mine['score']} versus "
            f"{other['subject_name']} {other['score']}, evaluated {when}.")


@contextlib.contextmanager
def spawned(**env: str) -> Iterator[str]:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    log = tempfile.NamedTemporaryFile(prefix="open-record-copy-", suffix=".log", delete=False)
    process = subprocess.Popen(manifest["serve"], shell=True, cwd=str(DEPLOYED_APP), stdout=log,
                               stderr=subprocess.STDOUT, start_new_session=True,
                               env={**os.environ, "APP_PUBLIC_PORT": str(port), **env})
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-4000:]

    def healthy() -> bool:
        if process.poll() is not None:
            raise AssertionError(f"copy exited with {process.returncode}:\n{tail()}")
        try:
            return httpx.get(base + "/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        poll(healthy, BOOT_DEADLINE_S, f"spawned copy health\n{tail()}", 0.5)
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=HTTP_TIMEOUT_S)


def test_wf_public_reading_journey(browser: Browser, app_url: str) -> None:
    home = get(app_url, "/api/public/home").json()
    assert [t["heading"] for t in home["theses"]] == THESES
    context = browser.new_context()
    page = context.new_page()
    page.goto(app_url + "/")
    expect(page.get_by_role("heading", level=1, name="The open record of Aldermoor Labs")).to_be_visible()
    theses = page.get_by_role("list", name="Theses")
    for number, heading in enumerate(THESES, start=1):
        expect(theses.get_by_role("heading", name=f"Thesis {number}. {heading}")).to_have_count(1)
    rail = page.get_by_role("complementary", name="Latest from the record")
    assert len(home["rail"]) == 5
    rail_links = rail.get_by_role("link")
    expect(rail_links.first).to_be_visible()
    hrefs = [urlparse(h or "").path.rstrip("/") for h in
             rail_links.evaluate_all("(links) => links.map((a) => a.getAttribute('href') || '')")]

    def rail_path(entry: dict[str, Any]) -> str:
        return f"/{'models' if entry['kind'] == 'model' else 'news'}/{entry['slug']}"

    for entry in home["rail"]:
        assert hrefs.count(rail_path(entry)) == 1, (rail_path(entry), hrefs)
    assert_in_order(rail.inner_text(), [entry["title"] for entry in home["rail"]])
    post = next(entry for entry in home["rail"] if entry["kind"] == "news")
    rail_links.nth(hrefs.index(rail_path(post))).click()
    page.wait_for_url(lambda url: urlparse(url).path == f"/news/{post['slug']}")
    expect(page.get_by_role("heading", name=post["title"], exact=True).first).to_be_visible()
    page.get_by_role("navigation", name="Primary").get_by_role("link", name="Newsroom").click()
    page.wait_for_url(lambda url: urlparse(url).path.rstrip("/") == "/news")
    facets = get(app_url, "/api/public/news").json()["facets"]
    page.get_by_role("navigation", name="Subjects").get_by_role(
        "link", name=facet_name(facets["subjects"], "safety")).click()
    wait_query(page, subject="safety")
    narrowed = get(app_url, "/api/public/news", params={"subject": "safety"}).json()["facets"]
    page.get_by_role("navigation", name="Tags").get_by_role(
        "link", name=facet_name(narrowed["tags"], "evaluations", "value")).click()
    wait_query(page, subject="safety", tag="evaluations")
    listing = get(app_url, "/api/public/news", params={"subject": "safety", "tag": "evaluations"}).json()
    assert SIGN_OFF_POST in [item["slug"] for item in listing["items"]]
    title = next(item["title"] for item in listing["items"] if item["slug"] == SIGN_OFF_POST)
    main = page.get_by_role("main")
    assert_in_order(main.inner_text(), [item["title"] for item in listing["items"]])
    main.get_by_role("link", name=re.compile(re.escape(title))).first.click()
    expect(page.get_by_role("heading", name=title, exact=True).first).to_be_visible()
    assert context.cookies() == []
    context.close()


def test_wf_public_reading_shared_newsroom(browser: Browser, app_url: str) -> None:
    params = {"subject": "safety", "tag": "evaluations"}
    api = get(app_url, "/api/public/news", params=params).json()
    everything = all_news(app_url)
    shown = {item["slug"] for item in api["items"]}
    context = browser.new_context()
    page = context.new_page()
    page.goto(app_url + "/news?" + urlencode(params))
    main = page.get_by_role("main")
    assert_in_order(main.inner_text(), [item["title"] for item in api["items"]])
    for other in everything:
        if other["slug"] not in shown:
            expect(main.get_by_role("link", name=other["title"], exact=True)).to_have_count(0)
    subjects = page.get_by_role("navigation", name="Subjects")
    for facet in api["facets"]["subjects"]:
        expect(subjects.get_by_role("link", name=f"{facet['label']} ({facet['count']})")).to_be_visible()
    tags = page.get_by_role("navigation", name="Tags")
    for facet in api["facets"]["tags"]:
        expect(tags.get_by_role("link", name=f"{facet['value']} ({facet['count']})")).to_be_visible()
    safety_name = facet_name(api["facets"]["subjects"], "safety")
    expect(subjects.get_by_role("link", name=safety_name)).to_have_attribute("aria-current", "true")
    subjects.get_by_role("link", name="All subjects").click()
    wait_query(page, subject=None)
    expect(subjects.get_by_role("link", name="All subjects")).to_have_attribute("aria-current", "true")
    page.go_back()
    wait_query(page, subject="safety")
    expect(subjects.get_by_role("link", name=safety_name)).to_have_attribute("aria-current", "true")
    page.go_forward()
    wait_query(page, subject=None)
    second = get(app_url, "/api/public/news", params={"page": 2}).json()
    page.goto(app_url + "/news?" + urlencode({"page": 2}))
    page_two = {item["slug"] for item in second["items"]}
    if second["items"]:
        assert_in_order(main.inner_text(), [item["title"] for item in second["items"]])
    for item in get(app_url, "/api/public/news").json()["items"]:
        if item["slug"] not in page_two:
            expect(main.get_by_role("link", name=item["title"], exact=True)).to_have_count(0)
    assert context.cookies() == []
    context.close()


def test_every_surface_lists_published_record(browser: Browser, app_url: str) -> None:
    word = fresh_word()
    post = published_news(app_url, title=f"Surface check {word}")
    models = get(app_url, "/api/public/models").json()["items"]
    model_slugs = [m["slug"] for m in models]
    assert {"kestrel-2", "kestrel-1"} <= set(model_slugs)
    assert not {"wren-1", "kestrel-3"} & set(model_slugs)
    assert [instant(m["published_at"]) for m in models] == sorted((instant(m["published_at"]) for m in models),
                                                                   reverse=True)
    news = all_news(app_url)
    news_slugs = [n["slug"] for n in news]
    assert post["slug"] in news_slugs
    assert not {"introducing-wren-1", "red-team-findings-q3"} & set(news_slugs)
    assert news_slugs == [n["slug"] for n in sorted(news, key=lambda n: (-instant(n["published_at"]).timestamp(),
                                                                           n["slug"]))]
    updated, entries = feed(app_url)
    feed_slugs = [entry_id.rsplit("/news/", 1)[-1] for entry_id, _ in entries]
    assert sorted(feed_slugs) == sorted(news_slugs) and len(feed_slugs) == len(set(feed_slugs))
    assert all(entry_id.endswith(f"/news/{slug}") for (entry_id, _), slug in zip(entries, feed_slugs))
    published = {n["slug"]: instant(n["published_at"]) for n in news}
    assert [instant(u) for _, u in entries] == [published[slug] for slug in feed_slugs]
    assert [published[slug] for slug in feed_slugs] == sorted(published.values(), reverse=True)
    assert updated and instant(updated) == instant(news[0]["published_at"])
    roles = [r["slug"] for r in get(app_url, "/api/public/roles").json()["items"]]
    assert "research-scientist-alignment" not in roles and "operations-coordinator-london" not in roles
    never = fresh_slug("never")
    for kind, hidden_slug in (("models", "wren-1"), ("models", "kestrel-3"), ("news", "introducing-wren-1")):
        for prefix in ("/api/public", ""):
            probe = get(app_url, f"{prefix}/{kind}/{hidden_slug}")
            reference = get(app_url, f"{prefix}/{kind}/{never}")
            assert probe.status_code == reference.status_code == 404, (prefix, kind, hidden_slug)
            assert probe.content == reference.content, (prefix, kind, hidden_slug)
    expected_paths = {"/", "/models", "/news", "/search", "/careers"} | {f"/models/{s}" for s in model_slugs} \
        | {f"/news/{s}" for s in news_slugs} | {f"/careers/{s}" for s in roles}
    paths = sitemap_paths(app_url)
    assert sorted(set(paths)) == sorted(expected_paths) and len(paths) == len(set(paths))
    assert_rail(app_url)
    assert [i["slug"] for i in search_all(app_url, word)] == [post["slug"]]
    hidden = {i["slug"] for i in search_all(app_url, "Wren")}
    assert not hidden & {"wren-1", "introducing-wren-1"}
    context = browser.new_context()
    page = context.new_page()
    page.goto(app_url + "/models")
    assert_in_order(page.get_by_role("main").inner_text(), [m["title"] for m in models])
    primary = page.get_by_role("navigation", name="Primary")
    menu = primary.get_by_role("button", name="Models")
    menu.click()
    expect(menu).to_have_attribute("aria-expanded", "true")
    for model in models:
        expect(primary.get_by_role("link", name=model["title"], exact=True)).to_be_visible()
    for hidden_title in ("Wren 1", "Kestrel 3"):
        expect(primary.get_by_role("link", name=hidden_title, exact=True)).to_have_count(0)
    assert_in_order(primary.inner_text(), [m["title"] for m in models])
    context.close()


def test_wf_public_reading_model_route(browser: Browser, app_url: str, mail: Mailpit) -> None:
    model = get(app_url, f"/api/public/models/{KESTREL2}").json()
    audios = [s for s in model["samples"] if s["kind"] == "audio"]
    sequence = next(s for s in model["samples"] if s["kind"] == "image_sequence")
    assert len(audios) >= 2
    frames = len(sequence["urls"])
    context = browser.new_context(timezone_id="Asia/Tokyo")
    page = context.new_page()
    page.goto(app_url + "/models")
    page.get_by_role("main").get_by_role("link", name=re.compile(re.escape(model["title"]))).first.click()
    expect(page.get_by_role("heading", name=model["title"], exact=True).first).to_be_visible()
    sections = page.get_by_role("navigation", name="Sections")
    for heading in ("What Kestrel 2 is", "How we evaluated it", "Where it falls short"):
        expect(sections.get_by_role("link", name=heading)).to_have_count(1)
    sections.get_by_role("link", name="How we evaluated it").click()
    expect(page.get_by_role("heading", name="How we evaluated it")).to_be_in_viewport()
    main = page.get_by_role("main")
    expect(main).to_contain_text(f"{model['read_time_minutes']} min read")
    local = page.evaluate(LOCAL_TIME_JS, model["published_at"])
    london = london_text(instant(model["published_at"]))
    expect(main).to_contain_text(f"Published {local} your time ({london} London)")
    table = page.get_by_role("table", name="Recorded evaluation rows")
    for row in model["rows"]:
        expect(table).to_contain_text(row["score"])
    expect(page.get_by_role("figure", name="Benchmark results")).to_be_visible()
    samples = page.get_by_role("region", name="Samples")
    one, two = audios[0]["title"], audios[1]["title"]
    samples.get_by_role("button", name=f"Play {one}").click()
    expect(samples.get_by_role("button", name=f"Pause {one}")).to_be_visible()
    samples.get_by_role("button", name=f"Play {two}").click()
    expect(samples.get_by_role("button", name=f"Pause {two}")).to_be_visible()
    expect(samples.get_by_role("button", name=f"Play {one}")).to_be_visible()
    frame = samples.get_by_role("status", name="Frame position")
    second = 2
    samples.get_by_role("button", name="Next frame").click()
    expect(frame).to_have_text(f"Frame {second} of {frames}")
    samples.get_by_role("button", name="Previous frame").click()
    samples.get_by_role("button", name="Previous frame").click()
    expect(frame).to_have_text(f"Frame {frames} of {frames}")
    response = get(app_url, audios[0]["urls"][0])
    assert response.status_code == 200 and response.content[:4] == b"RIFF"
    context.close()


def test_benchmarks_only_from_recorded_rows(browser: Browser, app_url: str) -> None:
    route = published_route(app_url)
    model = get(app_url, f"/api/public/models/{route['slug']}").json()
    by_subject = {(row["subject"], row["score"]) for row in model["rows"]}
    assert by_subject == {(route["slug"], ROUTE_SCORE), ("halvard-3", "68.2"), ("morrow-l", "70.9")}
    assert [row["subject"] for row in model["rows"]] == [route["slug"], "halvard-3", "morrow-l"]
    assert model["claims"][0]["delta"] == ROUTE_DELTA
    context = browser.new_context()
    page = context.new_page()
    page.goto(f"{app_url}/models/{route['slug']}")
    figure = page.get_by_role("figure", name="Benchmark results")
    assert sorted(tether_rows(page)) == sorted(str(row["id"]) for row in model["rows"])
    table = page.get_by_role("table", name="Recorded evaluation rows")
    def row_links(area: Locator, row_id: Any) -> int:
        hrefs = area.get_by_role("link").evaluate_all("links => links.map(a => a.getAttribute('href') || '')")
        return sum(href.endswith(f"#row-{row_id}") for href in hrefs)

    for row in model["rows"]:
        for area in (figure, table):
            poll(lambda: row_links(area, row["id"]), UI_TIMEOUT_MS / 1000, f"a link to row-{row['id']}")
    own = next(row for row in model["rows"] if row["subject"] == route["slug"])
    assert row_links(page.get_by_role("main"), own["id"]) >= 2
    context.close()


def test_sample_gallery_from_object_storage(browser: Browser, app_url: str) -> None:
    s3 = S3()
    model = get(app_url, f"/api/public/models/{KESTREL2}").json()
    by_id = {sample["id"]: sample for sample in model["samples"]}
    assert by_id["pitch-contour"]["kind"] == "audio" and by_id["denoise-sequence"]["kind"] == "image_sequence"
    assert len(by_id["denoise-sequence"]["urls"]) == 12
    expected = {f"samples/{KESTREL2}/{sid}/clip.wav" for sid in ("pitch-contour", "rhythm-continuation")} \
        | {f"samples/{KESTREL2}/denoise-sequence/frame-{n:02d}.png" for n in range(1, 13)}
    poll(lambda: expected <= set(s3.keys(f"samples/{KESTREL2}/")), MAIL_DEADLINE_S, "sample objects in storage")
    for sample in model["samples"]:
        for url in sample["urls"]:
            assert url.startswith("/media/samples/")
            response = get(app_url, url)
            assert response.status_code == 200
            assert response.content == s3.get("samples/" + url[len("/media/samples/"):])
            signature = b"RIFF" if url.endswith(".wav") else b"\x89PNG"
            assert response.content.startswith(signature)
            assert response.headers.get("content-type")
    assert get(app_url, f"/media/samples/{KESTREL2}/missing-sample/clip.wav").status_code == 404
    down = minio_down()
    offline = get(down, f"/api/public/models/{KESTREL2}")
    assert offline.status_code == 200
    assert offline.json()["samples"] == [] and offline.json()["samples_available"] is False
    media = get(down, by_id["pitch-contour"]["urls"][0])
    assert media.status_code == 503
    assert media.json() == {"error": "storage_unavailable", "message": "Samples are unavailable right now."}
    context = browser.new_context()
    page = context.new_page()
    audio_title = by_id["pitch-contour"]["title"]
    response = page.goto(f"{down}/models/{KESTREL2}")
    assert response is not None and response.status == 200
    expect(page.get_by_role("region", name="Samples")).to_contain_text(
        "Samples are unavailable right now. The recorded benchmarks above are unaffected.")
    expect(page.get_by_role("region", name="Samples").get_by_role("button", name=f"Play {audio_title}")) \
        .to_have_count(0)
    context.close()


def test_wf_claim_tether_activation(browser: Browser, app_url: str) -> None:
    model = get(app_url, f"/api/public/models/{KESTREL2}").json()
    first_claim = next(c for c in model["claims"] if c["number"] == 1)
    c2 = next(c for c in model["claims"] if c["number"] == 2)
    assert c2["delta"] == "+4.3"
    delta = c2["delta"]
    cited = {str(c2["model_row_id"]), str(c2["comparator_row_id"])}
    with open_app(browser, f"{app_url}/models/{KESTREL2}") as page:
        page.add_init_script(MOTION_RECORDER)
        page.reload()
        marker = page.get_by_role("button", name=f"Claim {c2['number']}")
        pressed(page, marker, "false")
        history = page.evaluate("history.length")
        page.evaluate(RESET_MOTION_JS)
        marker.click()
        advance(page, EARLY_SAMPLE_MS)
        assert page.evaluate(DELTA_TEXT) != delta
        pressed(page, marker, "true")
        until(page, CLAIM_JS, c2["id"])
        assert page.evaluate("history.length") == history
        until(page, f"(id) => ({TETHER_LINE_JS})(id) !== null", c2["id"])
        until(page, f"(d) => ({DELTA_TEXT})() === d", delta)
        rows = tether_rows(page)
        assert cited <= set(rows), rows
        for row_id, state in rows.items():
            assert state == ("true" if row_id in cited else "false"), (row_id, state)
        status = page.get_by_role("status", name="Claim tether")
        settle_to(page, lambda: (status.text_content() or "").strip(), tether_announcement(model, c2["number"]),
                  "tether announcement")
        motion = recorded(page)
        native = [m for m in motion if m["kind"] != "frames"]
        motion = native or motion
        line = [m for m in motion if m["line"] == c2["id"] and m["duration"] > 0]
        if line and not any(lasts(m, LINE_MIN_MS, LINE_MAX_MS) for m in line):
            declared = page.evaluate(LINE_TRANSITION_MS_JS, c2["id"])
            assert LINE_MIN_MS <= declared <= LINE_MAX_MS, (line, declared)
        fades = [m for m in motion if m["row"] and m["row"] not in cited and m["duration"] > 0]
        if fades:
            assert any(lasts(m, FADE_MIN_MS, FADE_MAX_MS) for m in fades), fades
        page.keyboard.press("Escape")
        until(page, CLAIM_JS, None)
        first = page.get_by_role("button", name=f"Claim {first_claim['number']}")
        first.focus()
        page.keyboard.press("Enter")
        pressed(page, first, "true")
        until(page, CLAIM_JS, first_claim["id"])
        page.keyboard.press("Escape")
        until(page, CLAIM_JS, None)
    context = browser.new_context(viewport={"width": 1280, "height": 800}, has_touch=False)
    page = context.new_page()
    page.goto(f"{app_url}/models/{KESTREL2}")
    marker = page.get_by_role("button", name=f"Claim {c2['number']}")
    marker.hover()
    poll(lambda: page.evaluate(CLAIM_JS, c2["id"]), UI_TIMEOUT_MS / 1000, "hover claims the marker")
    page.mouse.move(1, 1)
    poll(lambda: page.evaluate(CLAIM_JS, None), UI_TIMEOUT_MS / 1000, "leaving the marker releases the claim")
    expect(marker).to_have_attribute("aria-pressed", "false")
    context.close()


def test_wf_claim_tether_reversal(browser: Browser, app_url: str) -> None:
    model = get(app_url, f"/api/public/models/{KESTREL2}").json()
    c2 = next(c for c in model["claims"] if c["number"] == 2)
    name = f"Claim {c2['number']}"
    delta = c2["delta"]
    announced = tether_announcement(model, c2["number"])
    route = f"{app_url}/models/{KESTREL2}"
    with open_app(browser, f"{route}?claim={c2['id']}") as page:
        marker = page.get_by_role("button", name=name)
        status = page.get_by_role("status", name="Claim tether")
        status_text = lambda: (status.text_content() or "").strip()
        until(page, f"(d) => ({DELTA_TEXT})() === d", delta)
        pressed(page, marker, "true")
        assert tether_line(page, c2["id"]) is not None
        assert "false" in tether_rows(page).values()
        settle_to(page, status_text, announced, "restored announcement")
        page.keyboard.press("Escape")
        advance(page, 50)
        settle_to(page, status_text, f"Claim {c2['number']} released.", "release announcement")
        assert marker.get_attribute("aria-pressed") == "true"
        assert parse_qs(urlparse(page.url).query).get("claim") == [c2["id"]]
        until(page, CLAIM_JS, None)
        pressed(page, marker, "false")
        marker.click()
        until(page, f"(d) => ({DELTA_TEXT})() === d", delta)
        marker.click()
        page.mouse.move(1, 1)
        until(page, CLAIM_JS, None)
        pressed(page, marker, "false")
    with open_app(browser, f"{route}?claim=c99") as page:
        advance(page, 500)
        for listed in model["claims"]:
            assert page.get_by_role("button", name=f"Claim {listed['number']}").get_attribute("aria-pressed") \
                == "false"
    with open_app(browser, route, reduced_motion="reduce") as page:
        page.get_by_role("button", name=name).click()
        advance(page, REDUCED_SETTLE_MS)
        assert page.evaluate(DELTA_TEXT) == delta
        until(page, CLAIM_JS, c2["id"])
        reduced = page.get_by_role("status", name="Claim tether")
        settle_to(page, lambda: (reduced.text_content() or "").strip(), announced, "reduced-motion announcement")
    with open_app(browser, route) as page:
        page.set_viewport_size({"width": NARROW_PX, "height": 812})
        page.reload()
        page.get_by_role("button", name=name).click()
        until(page, f"(id) => ({TETHER_LINE_JS})(id) !== null", c2["id"])
        bracket = tether_line(page, c2["id"])
        assert bracket and name in bracket["text"] and bracket["hidden"], bracket
    with open_app(browser, f"{app_url}/models/{WREN1}?claim={c2['id']}") as page:
        expect(page.get_by_role("heading", name="Nothing is published here")).to_be_visible()
        expect(page.get_by_role("button", name=name)).to_have_count(0)


def test_wf_editorial_review_journey(browser: Browser, app_url: str) -> None:
    item = new_news(app_url, author=INES)
    ines_context, ines = staff_page(browser, app_url, INES)
    ines.goto(f"/console/content/{item['id']}")
    ines.get_by_role("button", name="Submit for review").click()
    expect(console_status(ines)).to_have_text("Submitted for review.")
    kofi_context, kofi = staff_page(browser, app_url, KOFI)
    kofi.goto(f"/console/content/{item['id']}")
    remark = "Name the source in the second paragraph."
    kofi.get_by_role("textbox", name="Comment").fill(remark)
    kofi.get_by_role("button", name="Add comment").click()
    expect(console_status(kofi)).to_have_text("Comment added.")
    eleni_context, eleni = staff_page(browser, app_url, ELENI)
    eleni.goto(f"/console/content/{item['id']}")
    eleni.get_by_role("button", name="Return to author").click()
    dialog = eleni.get_by_role("dialog", name="Return to author")
    dialog.get_by_role("textbox", name="Reason").fill("Tighten the summary.")
    dialog.get_by_role("button", name="Return").click()
    expect(console_status(eleni)).to_have_text("Returned to author.")
    ines.reload()
    revised = "## Overview\nA revised paragraph for the record."
    ines.get_by_role("textbox", name="Body").fill(revised)
    ines.get_by_role("button", name="Save draft").click()
    expect(console_status(ines)).to_have_text("Draft saved.")
    ines.get_by_role("button", name="Submit for review").click()
    expect(console_status(ines)).to_have_text("Submitted for review.")
    kofi.reload()
    kofi.get_by_role("button", name="Approve").click()
    expect(console_status(kofi)).to_have_text("Approved.")
    final = content_get(app_url, item["id"])
    assert final["status"] == "approved" and final["body"] == revised
    assert [c["body"] for c in final["comments"]].count(remark) == 1
    actions = Counter((e["action"], e["actor"]) for e in audit(app_url, target_id=item["id"]))
    assert actions[("content.submit", INES)] == 2 and actions[("content.return", ELENI)] == 1
    assert actions[("content.approve", KOFI)] == 1
    comment_ids = {str(c["id"]) for c in final["comments"] if c["body"] == remark and "id" in c}
    commented = [e for e in audit(app_url, action="content.comment")
                 if e["actor"] == KOFI and (str(e["target_id"]) in comment_ids | {str(item["id"])}
                                            or str(item["id"]) in json.dumps(e.get("detail")))]
    assert len(commented) == 1, commented
    entry = next(e for e in audit(app_url, target_id=item["id"]) if e["action"] == "content.approve")
    tamper = console(app_url, KOFI).call("PATCH", f"/api/console/audit/{entry['id']}", {"actor": INES})
    assert tamper.status_code == 405 and tamper.json()["error"] == "audit_immutable"
    assert next(e for e in audit(app_url, target_id=item["id"]) if e["id"] == entry["id"])["actor"] == KOFI
    for context in (ines_context, kofi_context, eleni_context):
        context.close()


def test_wf_editorial_review_return_needs_reason(browser: Browser, app_url: str) -> None:
    item = act(app_url, INES, new_news(app_url, author=INES), "submit")
    context, page = staff_page(browser, app_url, ELENI)
    page.goto(f"/console/content/{item['id']}")
    opener = page.get_by_role("button", name="Return to author")
    opener.click()
    dialog = page.get_by_role("dialog", name="Return to author")
    reason = dialog.get_by_role("textbox", name="Reason")
    confirm = dialog.get_by_role("button", name="Return", exact=True)
    held_back = confirm.is_disabled()
    if not held_back:
        confirm.click()

    def refused() -> bool:
        if held_back:
            return True
        if "Please fix the highlighted fields." in (console_status(page).text_content() or ""):
            return True
        return reason.is_visible() and reason.evaluate(
            "(e) => e.matches(':invalid') || e.getAttribute('aria-invalid') === 'true'")

    poll(refused, UI_TIMEOUT_MS / 1000, "the empty reason is refused")
    assert content_get(app_url, item["id"])["status"] == "in_review"
    if not dialog.is_visible():
        opener.click()
    reason.fill("Say which row the second figure comes from.")
    dialog.get_by_role("button", name="Return").click()
    expect(console_status(page)).to_have_text("Returned to author.")
    assert content_get(app_url, item["id"])["status"] == "returned"
    context.close()


ILLEGAL_TARGET = {"submit": "in_review", "approve": "approved", "return": "returned", "schedule": "scheduled",
                  "release": "published", "withdraw": "withdrawn"}


def test_content_lifecycle_illegal_moves(app_url: str) -> None:
    bodies = {"return": {"reason": "Tighten it."}, "schedule": {"release_at_local": FAR_EMBARGO}}

    def refuse(item: dict[str, Any], who: str, verb: str) -> None:
        response = console(app_url, who).call("POST", f"/api/console/content/{item['id']}/{verb}",
                                              bodies.get(verb, {}), version=item["version"])
        assert response.status_code == 409, (verb, item["status"], response.text)
        assert response.json() == {"error": "illegal_transition",
                                   "message": f"This item cannot move from {item['status']} to {ILLEGAL_TARGET[verb]}."}
        after = content_get(app_url, item["id"])
        assert (after["status"], after["version"]) == (item["status"], item["version"])

    item = new_news(app_url, author=INES)
    for verb in ("approve", "return", "schedule", "release", "withdraw"):
        refuse(item, ELENI, verb)
    item = act(app_url, INES, item, "submit")
    refuse(item, INES, "submit")
    for verb in ("schedule", "release", "withdraw"):
        refuse(item, ELENI, verb)
    item = act(app_url, ELENI, item, "return", {"reason": "Tighten it."})
    refuse(item, ELENI, "approve")
    item = act(app_url, INES, item, "submit")
    item = act(app_url, ELENI, item, "approve")
    for verb in ("approve", "return", "release", "withdraw"):
        refuse(item, KOFI, verb)
    item = act(app_url, ELENI, item, "schedule", {"release_at_local": FAR_EMBARGO})
    refuse(item, KOFI, "approve")
    item = act(app_url, ELENI, item, "release")
    for verb in ("approve", "schedule"):
        refuse(item, KOFI, verb)
    refuse(item, INES, "submit")
    item = act(app_url, KOFI, item, "withdraw")
    for verb in ("withdraw", "release"):
        refuse(item, ELENI, verb)


def test_authors_never_approve_own_work(app_url: str) -> None:
    news = act(app_url, TOMAS, new_news(app_url, author=TOMAS), "submit")
    ines_try = console(app_url, INES).call("POST", f"/api/console/content/{news['id']}/approve", {},
                                           version=news["version"])
    assert ines_try.status_code == 403 and ines_try.json() == FORBIDDEN

    def refuse(item: dict[str, Any], verb: str, body: dict[str, Any] | None = None) -> None:
        response = console(app_url, TOMAS).call("POST", f"/api/console/content/{item['id']}/{verb}", body or {},
                                                version=item["version"])
        assert response.status_code == 403 and response.json() == AUTHOR_REFUSED, (verb, response.text)
        assert content_get(app_url, item["id"])["version"] == item["version"]

    refuse(news, "approve")
    refuse(news, "return", {"reason": "Tighten it."})
    news = act(app_url, ELENI, news, "approve")
    refuse(news, "schedule", {"release_at_local": FAR_EMBARGO})
    news = act(app_url, ELENI, news, "schedule", {"release_at_local": FAR_EMBARGO})
    refuse(news, "release")
    route = act(app_url, TOMAS, new_route(app_url, author=TOMAS), "submit")
    own = signoff(app_url, TOMAS, route, "safety")
    assert own.status_code == 403 and own.json() == AUTHOR_REFUSED
    assert signoff(app_url, ELENI, route, "safety").status_code == 201
    assert signoff(app_url, KOFI, route, "legal").status_code == 201
    assert record_call(app_url, KOFI, route, "validate-claims").status_code == 200
    clear = record_call(app_url, TOMAS, route, "clear")
    assert clear.status_code == 403 and clear.json() == AUTHOR_REFUSED
    assert release_record(app_url, route)["status"] == "claims_validated"


def test_read_time_server_derived(app_url: str) -> None:
    exact = published_news(app_url, body="## Alpha\n" + " ".join(["word"] * 224))
    over = published_news(app_url, body="## Alpha\n" + " ".join(["word"] * 225))
    assert get(app_url, f"/api/public/news/{exact['slug']}").json()["read_time_minutes"] == 1
    over_minutes = get(app_url, f"/api/public/news/{over['slug']}").json()["read_time_minutes"]
    assert over_minutes == 2
    assert f"{over_minutes} min read" in page_text(get(app_url, f"/news/{over['slug']}").text)
    draft = new_news(app_url)
    assert draft["read_time_minutes"] is None
    patch = console(app_url, INES).call("PATCH", f"/api/console/content/{draft['id']}",
                                        {"title": "New title", "read_time_minutes": 9}, version=draft["version"])
    assert patch.status_code == 422
    assert patch.json() == {"error": "read_only_fields", "message": "Some fields are set by the server.",
                            "fields": {"read_time_minutes": "This field is set by the server."}}
    after = content_get(app_url, draft["id"])
    assert after["title"] == draft["title"] and after["read_time_minutes"] is None


OWNED_KEY_IDS = ["id", "status", "version", "author", "published_at", "release_at", "comments", "colour"]
OWNED_KEYS = {
    "id": "forged-id",
    "status": "published",
    "version": 7,
    "author": "tomas.reyes@aldermoor.example",
    "published_at": "2026-01-01T00:00:00Z",
    "release_at": "2027-01-01T00:00:00Z",
    "comments": [],
    "colour": "oxide",
}


@pytest.mark.parametrize("key", OWNED_KEY_IDS, ids=OWNED_KEY_IDS)
def test_server_owned_fields(app_url: str, key: str) -> None:
    refusal = {"error": "read_only_fields", "message": "Some fields are set by the server.",
               "fields": {key: "This field is set by the server."}}
    ines = console(app_url, INES)
    slug = fresh_slug("news")
    payload = {"kind": "news", "slug": slug, "title": "Owned field probe", "summary": "A short note.",
               "body": "## Overview\nA plain paragraph.", "subject": "research", "tags": ["field-notes"],
               key: OWNED_KEYS[key]}
    created = ines.call("POST", "/api/console/content", payload)
    assert created.status_code == 422 and created.json() == refusal
    payload.pop(key)
    item = ines.call("POST", "/api/console/content", payload)
    assert item.status_code == 201, "a refused create must not have reserved the slug"
    item = item.json()["content"]
    patched = ines.call("PATCH", f"/api/console/content/{item['id']}", {"title": "Changed", key: OWNED_KEYS[key]},
                        version=item["version"])
    assert patched.status_code == 422 and patched.json() == refusal
    submitted = ines.call("POST", f"/api/console/content/{item['id']}/submit", {key: OWNED_KEYS[key]},
                          version=item["version"])
    assert submitted.status_code == 422 and submitted.json() == refusal
    after = content_get(app_url, item["id"])
    assert (after["title"], after["version"], after["status"], after["author"]) == \
        ("Owned field probe", item["version"], "draft", item["author"])
    assert is_staff(after["author"], INES)
    assert [e["action"] for e in audit(app_url, target_id=item["id"])] == ["content.create"]


def test_wf_responsible_release_journey(browser: Browser, app_url: str) -> None:
    title = route_title()
    route = new_route(app_url, author=INES, title=title, claims=[
        claim("c1", f"On {BENCH}, {title} scores {ROUTE_SCORE}, 4.3 points above Halvard 3.", "4.3"),
        {**claim("c2", f"On LongDoc-QA, {title} scores 82.6, 2.0 points above Halvard 3.", "2.0"),
         "benchmark": "LongDoc-QA"}],
        body="## What it is\nA careful reader. [claim:c1]\n\n## How it reads\nLong documents. [claim:c2]")
    record_row(app_url, INES, route["slug"], "82.6", benchmark="LongDoc-QA")
    ines_context, ines = staff_page(browser, app_url, INES)
    ines.goto(f"/console/content/{route['id']}")
    ines.get_by_role("button", name="Submit for review").click()
    expect(console_status(ines)).to_have_text("Submitted for review.")
    eleni_context, eleni = staff_page(browser, app_url, ELENI)
    eleni.goto(f"/console/content/{route['id']}")
    eleni.get_by_role("region", name="Release record").get_by_role("button", name="Record safety sign-off").click()
    expect(console_status(eleni)).to_have_text(f"{'Safety'} sign-off recorded.")
    kofi_context, kofi = staff_page(browser, app_url, KOFI)
    kofi.goto(f"/console/content/{route['id']}")
    panel = kofi.get_by_role("region", name="Release record")
    panel.get_by_role("button", name="Record legal sign-off").click()
    expect(console_status(kofi)).to_have_text(f"{'Legal'} sign-off recorded.")
    panel.get_by_role("button", name="Validate claims").click()
    expect(console_status(kofi)).to_have_text("Claims validated.")
    eleni.reload()
    eleni.get_by_role("region", name="Release record").get_by_role("button", name="Clear release record").click()
    expect(console_status(eleni)).to_have_text("Release record cleared.")
    kofi.reload()
    kofi.get_by_role("button", name="Approve").click()
    expect(console_status(kofi)).to_have_text("Approved.")
    record = release_record(app_url, route)
    assert record["status"] == "cleared" and is_staff(record["cleared_by"], ELENI)
    assert is_staff(record["safety"]["by"], ELENI) and is_staff(record["legal"]["by"], KOFI)
    scheduled = act(app_url, ELENI, content_get(app_url, route["id"]), "schedule", {"release_at_local": FAR_EMBARGO})
    assert scheduled["status"] == "scheduled"
    for context in (ines_context, eleni_context, kofi_context):
        context.close()


def test_release_record_signoffs(app_url: str, mail: Mailpit) -> None:
    route = new_route(app_url, author=TOMAS)
    early = signoff(app_url, ELENI, route, "safety")
    assert early.status_code == 409 and early.json() == {
        "error": "not_in_review", "message": "Sign-offs are recorded while a route is in review or approved."}
    eligible = {g["staff_email"] for g in grants(app_url)
                if g["role"] == "approver" and g["status"] == "active"} - {TOMAS}
    route = act(app_url, TOMAS, route, "submit")
    subject = f"Release record awaiting sign-off: {route['title']}"
    for email in eligible:
        await_mail(mail, email, subject)
    for email in eligible:
        assert len(distinct(settled(mail, email, subject))) == 1
    assert settled(mail, TOMAS, subject) == []
    own = signoff(app_url, TOMAS, route, "safety")
    assert own.status_code == 403 and own.json() == AUTHOR_REFUSED
    before_signoffs = audit_ids(app_url)
    same_kind = race(lambda: signoff(app_url, ELENI, route, "safety"), lambda: signoff(app_url, KOFI, route, "safety"))
    assert sorted(r.status_code for r in same_kind) == [201, 409]
    loser = next(r for r in same_kind if r.status_code == 409)
    assert loser.json() == {"error": "already_signed", "message": "This sign-off is already recorded."}
    winner = ELENI if same_kind[0].status_code == 201 else KOFI
    other = KOFI if winner == ELENI else ELENI
    assert signoff(app_url, other, route, "legal").status_code == 201
    record = release_record(app_url, route)
    assert record["status"] == "signed" and is_staff(record["safety"]["by"], winner) \
        and is_staff(record["legal"]["by"], other)
    entries = route_audit(app_url, route, since=before_signoffs)
    signed = [e for e in entries if e["action"] in ("signoff.safety", "signoff.legal")]
    assert len(signed) == 2 and {e["actor"] for e in signed} == {winner, other}
    tamper = console(app_url, ADA).call("DELETE", f"/api/console/audit/{signed[0]['id']}", {})
    assert tamper.status_code == 405 and tamper.json()["error"] == "audit_immutable"
    second = act(app_url, TOMAS, new_route(app_url, author=TOMAS), "submit")
    both = race(lambda: signoff(app_url, ELENI, second, "safety"), lambda: signoff(app_url, ELENI, second, "legal"))
    assert sorted(r.status_code for r in both) == [201, 409]
    assert next(r for r in both if r.status_code == 409).json() == {
        "error": "distinct_approver_required",
        "message": "Safety and legal sign-off must come from different approvers."}
    route = act(app_url, KOFI, content_get(app_url, route["id"]), "return", {"reason": "Shorten the summary."})
    before_edit = audit_ids(app_url)
    patched = console(app_url, TOMAS).call("PATCH", f"/api/console/content/{route['id']}",
                                           {"summary": "A shorter summary."}, version=route["version"])
    assert patched.status_code == 200, patched.text
    voided = release_record(app_url, route)
    assert voided["status"] == "open" and voided["safety"] is None and voided["legal"] is None
    voids = [e for e in route_audit(app_url, route, since=before_edit) if e["action"] == "release_record.void"]
    assert len(voids) == 1 and voids[0]["detail"] == {"reason": "route_edited"}


CLAIM_CASES = ["passes", "delta_mismatch", "sign_mismatch", "number_mismatch", "missing_rows", "marker_missing",
               "unknown_marker"]


@pytest.mark.parametrize("case", CLAIM_CASES, ids=CLAIM_CASES)
def test_claim_validation(app_url: str, case: str) -> None:
    title = route_title()
    text_ = f"In Q3 testing on {EVAL_DATE}, {title} scored {ROUTE_SCORE} on {BENCH}, 4.3 points above Halvard 3 at 68.2."
    delta = "+4.30"
    eval_date = EVAL_DATE
    body = "## What it is\nA careful reader. [claim:c1]"
    if case == "delta_mismatch":
        delta = "5.1"
    if case == "sign_mismatch":
        delta = "-4.3"
    if case == "number_mismatch":
        text_ = f"On {BENCH}, {title} scores {ROUTE_SCORE}, 9.9 points above Halvard 3."
    if case == "missing_rows":
        eval_date = "2026-09-15"
    if case == "marker_missing":
        body = "## What it is\nA careful reader."
    if case == "unknown_marker":
        body = "## What it is\nA careful reader. [claim:c1] [claim:c9]"
    route = new_route(app_url, author=TOMAS, title=title, body=body,
                      claims=[claim("c1", text_, delta, eval_date=eval_date)])
    route = act(app_url, TOMAS, route, "submit")
    assert signoff(app_url, ELENI, route, "safety").status_code == 201
    assert signoff(app_url, KOFI, route, "legal").status_code == 201
    response = record_call(app_url, KOFI, route, "validate-claims")
    if case == "passes":
        assert response.status_code == 200, response.text
        record = response.json()["record"]
        assert record["status"] == "claims_validated" and all(v["ok"] for v in record["last_validation"])
        return
    assert response.status_code == 422, response.text
    body_ = response.json()
    assert body_["error"] == "claims_invalid" and body_["message"] == "Some claims do not match the recorded rows."
    fields = body_["fields"]
    expected = {
        "delta_mismatch": ("c1", "Stated difference 5.1 does not match the recorded difference +4.3."),
        "sign_mismatch": ("c1", "Stated difference -4.3 does not match the recorded difference +4.3."),
        "number_mismatch": ("c1", "The number 9.9 in the claim text does not match the cited rows."),
        "marker_missing": ("c1", "Claim c1 is not marked in the body."),
        "unknown_marker": ("body", "The body marks claim c9, which is not defined."),
    }
    if case == "missing_rows":
        assert isinstance(fields.get("c1"), str) and fields["c1"]
        if fields["c1"].startswith("No recorded row for "):
            assert eval_date in fields["c1"]
    else:
        assert fields[expected[case][0]] == expected[case][1]
    record = release_record(app_url, route)
    assert record["status"] == "signed" and record["claims_validated_at"] is None
    clear = record_call(app_url, ELENI, route, "clear")
    assert clear.status_code == 409 and clear.json() == {
        "error": "claims_not_validated", "message": "Validate the claims before clearing this record."}


def test_wf_responsible_release_signoff_lapse(browser: Browser, app_url: str) -> None:
    revoked_grant = grant(app_url, INES, "approver", now() + dt.timedelta(days=30))
    route = act(app_url, TOMAS, new_route(app_url, author=TOMAS), "submit")
    assert signoff(app_url, INES, route, "legal").status_code == 201
    assert signoff(app_url, KOFI, route, "safety").status_code == 201
    assert record_call(app_url, KOFI, route, "validate-claims").status_code == 200
    ada_context, ada = staff_page(browser, app_url, ADA)
    ada.goto("/console/grants")
    before_revoke = audit_ids(app_url)
    ada.get_by_role("table", name="Grants").get_by_role("button", name=f"Revoke {'approver'} for {INES}").click()
    expect(console_status(ada)).to_have_text("Role revoked.")
    record = release_record(app_url, route)
    assert record["status"] == "safety_signed" and record["legal"] is None
    assert record["claims_validated_at"] is None and record["last_validation"] is None
    revoked = {"reason": "signoff_lapsed", "kind": "legal", "signer": INES}
    voids = lapse_voids(app_url, route, before_revoke, revoked)
    assert all(is_staff(v["actor"], ADA) and v["detail"] == revoked for v in voids), voids
    eleni_context, eleni = staff_page(browser, app_url, ELENI)
    eleni.goto(f"/console/content/{route['id']}")
    panel = eleni.get_by_role("region", name="Release record")
    expect(panel).to_be_visible(timeout=UI_TIMEOUT_MS)
    clear_button = panel.get_by_role("button", name="Clear release record")
    if clear_button.count() and not clear_button.is_disabled():
        clear_button.click()
        expect(console_status(eleni)).to_contain_text("Validate the claims before clearing this record.")
    assert release_record(app_url, route)["status"] == "safety_signed"
    assert revoked_grant["status"] == "active"

    lapsing = act(app_url, TOMAS, new_route(app_url, author=TOMAS), "submit")
    late = act(app_url, TOMAS, new_route(app_url, author=TOMAS), "submit")
    expiry = (now() + dt.timedelta(seconds=RATE_WINDOW_S + 30)).replace(microsecond=0)
    grant(app_url, INES, "approver", expiry)
    assert signoff(app_url, INES, lapsing, "safety").status_code == 201
    assert signoff(app_url, KOFI, lapsing, "legal").status_code == 201
    assert record_call(app_url, KOFI, lapsing, "validate-claims").status_code == 200
    before_expiry = audit_ids(app_url)
    wait_until_instant(expiry, "grant expiry")
    after_expiry = signoff(app_url, INES, late, "safety")
    assert after_expiry.status_code == 403 and after_expiry.json() == FORBIDDEN
    gap = record_call(app_url, ELENI, lapsing, "clear")
    assert gap.status_code == 409 and error_of(gap) in {"signoff_lapsed", "claims_not_validated"}
    if error_of(gap) == "signoff_lapsed":
        assert gap.json()["message"] == "A sign-off holder no longer holds the approver role. Record that sign-off again."

    def fell_back() -> bool:
        current = release_record(app_url, lapsing)
        return current["status"] == "legal_signed" and current["safety"] is None \
            and current["claims_validated_at"] is None and current["last_validation"] is None

    poll(fell_back, VOID_LAG_S + SLACK_S, "sign-off voided after expiry", 1.0)
    expired = {"reason": "signoff_lapsed", "kind": "safety", "signer": INES}
    voids = lapse_voids(app_url, lapsing, before_expiry, expired)
    assert all(v["actor"] == "system:grants" and v["detail"] == expired for v in voids), voids
    ada_context.close()
    eleni_context.close()


HIDDEN_STATES = ["draft", "in_review", "returned", "approved", "scheduled", "withdrawn_unpublished"]


@pytest.mark.parametrize("state", HIDDEN_STATES, ids=HIDDEN_STATES)
def test_unreleased_slugs_look_unknown(app_url: str, state: str) -> None:
    word = fresh_word()
    item = new_news(app_url, title=f"Hidden note {word}")
    if state != "draft":
        item = act(app_url, INES, item, "submit")
    if state == "returned":
        item = act(app_url, ELENI, item, "return", {"reason": "Tighten it."})
    if state in ("approved", "scheduled", "withdrawn_unpublished"):
        item = act(app_url, ELENI, item, "approve")
    if state in ("scheduled", "withdrawn_unpublished"):
        item = act(app_url, ELENI, item, "schedule", {"release_at_local": FAR_EMBARGO})
    if state == "withdrawn_unpublished":
        item = act(app_url, ELENI, item, "withdraw")
    assert content_get(app_url, item["id"])["status"] == state.replace("_unpublished", "")
    missing = fresh_slug("never")
    for kind, hidden in (("news", item["slug"]), ("models", "kestrel-3"), ("models", "wren-1"),
                         ("news", "introducing-wren-1"), ("news", "red-team-findings-q3")):
        reference_api = get(app_url, f"/api/public/{kind}/{missing}")
        assert reference_api.status_code == 404 and reference_api.json() == NOT_PUBLISHED
        reference_page = get(app_url, f"/{kind}/{missing}")
        assert reference_page.status_code == 404 and "Nothing is published here" in reference_page.text
        assert missing not in reference_page.text
        for path, reference in ((f"/api/public/{kind}/{hidden}", reference_api),
                                (f"/{kind}/{hidden}", reference_page),
                                (f"/{kind}/{hidden}?claim=c1", get(app_url, f"/{kind}/{missing}?claim=c1"))):
            response = get(app_url, path)
            assert response.status_code == 404 and response.content == reference.content, path
    assert search_all(app_url, word) == []
    assert item["slug"] not in [n["slug"] for n in all_news(app_url)]


EMBARGO_CASES = {
    "summer_time": ("2027-07-01T09:00", "2027-07-01T08:00:00Z"),
    "winter_time": ("2027-01-15T09:00", "2027-01-15T09:00:00Z"),
    "clocks_back": ("2027-10-31T01:30", "2027-10-31T00:30:00Z"),
    "clocks_forward": ("2027-03-28T01:30", "That time does not exist in London because the clocks go forward."),
    "past": ("2026-01-01T09:00", "Choose a time in the future."),
    "malformed": ("1 July 2027 9am", "Use the form YYYY-MM-DDTHH:mm."),
}


@pytest.mark.parametrize("case", list(EMBARGO_CASES), ids=list(EMBARGO_CASES))
def test_embargo_london_time(app_url: str, case: str) -> None:
    local, expected = EMBARGO_CASES[case]
    item = approved_news(app_url)
    response = console(app_url, ELENI).call("POST", f"/api/console/content/{item['id']}/schedule",
                                            {"release_at_local": local}, version=item["version"])
    if expected.endswith("Z"):
        assert response.status_code == 200, response.text
        body = response.json()
        content = body.get("content", body)
        assert content["release_at"] == expected and content["status"] == "scheduled"
        assert content["release_at_local"].startswith(local)
        assert (body.get("zone") or content.get("zone")) == "Europe/London"
        return
    assert response.status_code == 422, response.text
    assert response.json()["error"] == "validation_failed"
    assert response.json()["fields"]["release_at_local"] == expected
    after = content_get(app_url, item["id"])
    assert (after["status"], after["version"]) == ("approved", item["version"])


def test_wf_embargoed_launch_all_surfaces(browser: Browser, app_url: str) -> None:
    word = fresh_word()
    news = approved_news(app_url, title=f"Introducing {word}")
    route = cleared_route(app_url, new_route(app_url, linked=news["slug"], summary=f"The {word} reader."))
    headroom(app_url, "public", PUBLIC_LIMIT // 3)
    moment = (now() + dt.timedelta(seconds=25)).replace(microsecond=0)
    route = act(app_url, KOFI, route, "schedule", {"release_at_local": london_input(moment)})
    assert instant(route["release_at"]) == moment
    assert content_get(app_url, news["id"])["status"] == "scheduled"
    for path in (f"/api/public/models/{route['slug']}", f"/api/public/news/{news['slug']}"):
        assert get(app_url, path).status_code == 404
    assert route["slug"] not in sitemap_paths(app_url) and search_all(app_url, word) == []
    assert all(not entry_id.endswith(news["slug"]) for entry_id, _ in feed(app_url)[1])
    assert route["slug"] not in [e["slug"] for e in get(app_url, "/api/public/home").json()["rail"]]
    first_seen: dict[str, dt.datetime] = {}

    def released() -> bool:
        model_status = get(app_url, f"/api/public/models/{route['slug']}").status_code
        news_status = get(app_url, f"/api/public/news/{news['slug']}").status_code
        if model_status == 200:
            assert news_status == 200, "the announcement must release in the same transaction"
            first_seen["at"] = now()
            return True
        assert now() < moment + dt.timedelta(seconds=RELEASE_LAG_S + SLACK_S)
        return False

    poll(released, (moment - now()).total_seconds() + RELEASE_LAG_S + SLACK_S * 2, "embargo release", 0.5)
    assert first_seen["at"] >= moment - dt.timedelta(seconds=1)
    assert first_seen["at"] <= moment + dt.timedelta(seconds=RELEASE_LAG_S + SLACK_S)
    model = get(app_url, f"/api/public/models/{route['slug']}").json()
    post = get(app_url, f"/api/public/news/{news['slug']}").json()
    assert instant(model["published_at"]) == moment and instant(post["published_at"]) == moment
    assert model["linked_news"] == {"slug": news["slug"], "title": news["title"]}
    assert post["linked_model"] == {"slug": route["slug"], "title": route["title"]}
    assert route["slug"] in [m["slug"] for m in get(app_url, "/api/public/models").json()["items"]]
    rail = [e["slug"] for e in get(app_url, "/api/public/home").json()["rail"]]
    if route["slug"] in rail and news["slug"] in rail:
        assert rail.index(route["slug"]) < rail.index(news["slug"])
    assert_rail(app_url)
    assert any(entry_id.endswith(f"/news/{news['slug']}") for entry_id, _ in feed(app_url)[1])
    assert {f"/models/{route['slug']}", f"/news/{news['slug']}"} <= set(sitemap_paths(app_url))
    assert {i["slug"] for i in search_all(app_url, word)} == {route["slug"], news["slug"]}
    releases = [e for e in audit(app_url, target_id=route["id"]) if e["action"] == "content.release"]
    assert len(releases) == 1 and releases[0]["actor"] == "system:scheduler"
    detail = json.dumps(releases[0]["detail"]).lower()
    assert KOFI in detail or staff_name(KOFI).lower() in detail
    context = browser.new_context()
    page = context.new_page()
    page.goto(app_url + "/")
    page.get_by_role("navigation", name="Primary").get_by_role("button", name="Models").click()
    expect(page.get_by_role("navigation", name="Primary").get_by_role("link", name=route["title"], exact=True)) \
        .to_be_visible()
    context.close()


RACE_CASES = ["approve_vs_return", "approve_vs_approve", "release_vs_withdraw", "withdraw_vs_withdraw",
              "fired_release_vs_withdraw"]


@pytest.mark.parametrize("case", RACE_CASES, ids=RACE_CASES)
def test_one_winner_concurrent_actions(app_url: str, case: str) -> None:
    def post(who: str, item: dict[str, Any], verb: str, body: dict[str, Any] | None = None) -> Callable[[], httpx.Response]:
        return lambda: console(app_url, who).call("POST", f"/api/console/content/{item['id']}/{verb}", body or {},
                                                  version=item["version"])

    if case == "fired_release_vs_withdraw":
        item = approved_news(app_url)
        moment = (now() + dt.timedelta(seconds=12)).replace(microsecond=0)
        item = act(app_url, ELENI, item, "schedule", {"release_at_local": london_input(moment)})
        poll(lambda: get(app_url, f"/api/public/news/{item['slug']}").status_code == 200,
             (moment - now()).total_seconds() + RELEASE_LAG_S + SLACK_S, "scheduled release", 0.5)
        late = post(KOFI, item, "withdraw")()
        assert late.status_code == 412 and late.json() == STALE
        assert get(app_url, f"/api/public/news/{item['slug']}").status_code == 200
        assert content_get(app_url, item["id"])["status"] == "published"
        return
    if case in ("approve_vs_return", "approve_vs_approve"):
        item = act(app_url, INES, new_news(app_url), "submit")
        second = post(KOFI, item, "return", {"reason": "Tighten it."}) if case == "approve_vs_return" \
            else post(KOFI, item, "approve")
        results = race(post(ELENI, item, "approve"), second)
    elif case == "release_vs_withdraw":
        item = act(app_url, ELENI, approved_news(app_url), "schedule", {"release_at_local": FAR_EMBARGO})
        results = race(post(ELENI, item, "release"), post(KOFI, item, "withdraw"))
    else:
        item = published_news(app_url)
        results = race(post(ELENI, item, "withdraw"), post(KOFI, item, "withdraw"))
    assert sorted(r.status_code for r in results) == [200, 412], [r.text for r in results]
    assert next(r for r in results if r.status_code == 412).json() == STALE
    assert content_get(app_url, item["id"])["version"] == item["version"] + 1


def test_wf_embargoed_launch_journey(browser: Browser, app_url: str) -> None:
    news = approved_news(app_url)
    route = cleared_route(app_url, new_route(app_url, linked=news["slug"]))
    context, page = staff_page(browser, app_url, ELENI)
    moment = (now() + dt.timedelta(seconds=45)).replace(microsecond=0)
    page.goto(f"/console/content/{route['id']}")
    page.get_by_role("button", name="Schedule release").click()
    dialog = page.get_by_role("dialog", name="Schedule release")
    dialog.get_by_role("textbox", name="Release time (London)").fill(london_input(moment))
    dialog.get_by_role("button", name="Confirm schedule").click()
    expect(console_status(page)).to_have_text(f"Release scheduled for {london_text(moment)} London.")
    visitor = browser.new_context()
    reader = visitor.new_page()
    for path in (f"/models/{route['slug']}", f"/news/{news['slug']}"):
        response = reader.goto(app_url + path)
        assert response is not None and response.status == 404
        expect(reader.get_by_role("heading", name="Nothing is published here")).to_be_visible()
    poll(lambda: get(app_url, f"/api/public/models/{route['slug']}").status_code == 200,
         (moment - now()).total_seconds() + RELEASE_LAG_S + SLACK_S, "embargo release", 0.5)
    response = reader.goto(f"{app_url}/models/{route['slug']}")
    assert response is not None and response.status == 200
    expect(reader.get_by_role("heading", name=route["title"]).first).to_be_visible()
    hrefs = reader.get_by_role("main").get_by_role("link").evaluate_all(
        "(links) => links.map((a) => a.getAttribute('href') || '')")
    assert any(urlparse(h).path == f"/news/{news['slug']}" for h in hrefs), hrefs
    response = reader.goto(f"{app_url}/news/{news['slug']}")
    assert response is not None and response.status == 200
    assert content_get(app_url, route["id"])["status"] == "published"
    assert content_get(app_url, news["id"])["status"] == "published"
    context.close()
    visitor.close()


def test_wf_withdrawal_journey(browser: Browser, app_url: str) -> None:
    word = fresh_word()
    tag = "wd" + uuid.uuid4().hex[:8]
    post = published_news(app_url, subject="policy", tags=[tag], title=f"Withdrawn note {word}")
    assert get(app_url, "/api/public/news", params={"tag": tag}).json()["total"] == 1
    context, page = staff_page(browser, app_url, ELENI)
    page.goto(f"/console/content/{post['id']}")
    page.get_by_role("button", name="Withdraw", exact=True).click()
    page.get_by_role("dialog", name="Withdraw this item?").get_by_role("button", name="Confirm withdrawal").click()
    expect(console_status(page)).to_have_text("Withdrawn.")
    withdrawals = [e for e in audit(app_url, target_id=post["id"]) if e["action"] == "content.withdraw"]
    assert len(withdrawals) == 1 and withdrawals[0]["actor"] == ELENI
    tamper = console(app_url, ELENI).call("PUT", f"/api/console/audit/{withdrawals[0]['id']}", {"actor": KOFI})
    assert tamper.status_code == 405 and tamper.json()["error"] == "audit_immutable"
    api = get(app_url, f"/api/public/news/{post['slug']}")
    assert api.status_code == 410 and api.json() == GONE_ITEM
    listing = get(app_url, "/api/public/news").json()
    assert tag not in [t["value"] for t in listing["facets"]["tags"]]
    assert get(app_url, "/api/public/news", params={"tag": tag}).json()["total"] == 0
    assert post["slug"] not in [n["slug"] for n in all_news(app_url)]
    assert post["slug"] not in [e["slug"] for e in get(app_url, "/api/public/home").json()["rail"]]
    assert all(not entry_id.endswith(f"/news/{post['slug']}") for entry_id, _ in feed(app_url)[1])
    assert f"/news/{post['slug']}" not in sitemap_paths(app_url)
    assert search_all(app_url, word) == []
    visitor = browser.new_context()
    reader = visitor.new_page()
    response = reader.goto(f"{app_url}/news/{post['slug']}")
    assert response is not None and response.status == 410
    expect(reader.get_by_role("heading", name="This post has been withdrawn.")).to_be_visible()
    reader.goto(f"{app_url}/news?tag={tag}")
    expect(reader.get_by_role("main")).to_contain_text("No posts match these filters.")
    context.close()
    visitor.close()


def test_wf_withdrawal_model_route(browser: Browser, app_url: str) -> None:
    word = fresh_word()
    news = approved_news(app_url)
    route = published_route(app_url, linked=news["slug"], summary=f"The {word} reader.")
    assert get(app_url, f"/api/public/news/{news['slug']}").status_code == 200
    context, page = staff_page(browser, app_url, KOFI)
    page.goto(f"/console/content/{route['id']}")
    page.get_by_role("button", name="Withdraw", exact=True).click()
    page.get_by_role("dialog", name="Withdraw this item?").get_by_role("button", name="Confirm withdrawal").click()
    expect(console_status(page)).to_have_text("Withdrawn.")
    for path in (f"/api/public/models/{route['slug']}", f"/api/public/news/{news['slug']}"):
        response = get(app_url, path)
        assert response.status_code == 410 and response.json() == GONE_ITEM
    assert route["slug"] not in [m["slug"] for m in get(app_url, "/api/public/models").json()["items"]]
    assert news["slug"] not in [n["slug"] for n in all_news(app_url)]
    assert not {f"/models/{route['slug']}", f"/news/{news['slug']}"} & set(sitemap_paths(app_url))
    assert search_all(app_url, word) == []
    visitor = browser.new_context()
    reader = visitor.new_page()
    response = reader.goto(f"{app_url}/models/{route['slug']}")
    assert response is not None and response.status == 410
    expect(reader.get_by_role("heading", name="This model route has been withdrawn.")).to_be_visible()
    reader.goto(app_url + "/")
    reader.get_by_role("navigation", name="Primary").get_by_role("button", name="Models").click()
    expect(reader.get_by_role("navigation", name="Primary").get_by_role("link", name=route["title"], exact=True)) \
        .to_have_count(0)
    context.close()
    visitor.close()


def test_derived_values_after_withdrawal(app_url: str) -> None:
    tag = "dv" + uuid.uuid4().hex[:8]
    linked = approved_news(app_url, subject="company", tags=[tag])
    route = published_route(app_url, linked=linked["slug"])
    sibling = published_news(app_url, subject="company", tags=[tag])
    assert get(app_url, f"/api/public/models/{route['slug']}").json()["linked_news"]["slug"] == linked["slug"]
    current = content_get(app_url, linked["id"])
    racers = race(*[(lambda who=who: console(app_url, who).call(
        "POST", f"/api/console/content/{linked['id']}/withdraw", {}, version=current["version"]))
        for who in (ELENI, KOFI)])
    assert sorted(r.status_code for r in racers) == [200, 412], [r.text for r in racers]
    assert next(r for r in racers if r.status_code == 412).json() == STALE
    assert content_get(app_url, linked["id"])["version"] == current["version"] + 1
    model = get(app_url, f"/api/public/models/{route['slug']}").json()
    assert model["linked_news"] is None
    assert f"/news/{linked['slug']}" not in get(app_url, f"/models/{route['slug']}").text
    items = all_news(app_url)
    head = get(app_url, "/api/public/news").json()
    assert head["total"] == len(items)
    assert head["pages"] == max(1, math.ceil(len(items) / NEWS_PAGE_SIZE))
    subjects = Counter(n["subject"] for n in items)
    assert {f["value"]: f["count"] for f in head["facets"]["subjects"]} == \
        {s: subjects.get(s, 0) for s in ("research", "safety", "policy", "company")}
    tag_counts = Counter(t for n in items for t in n["tags"])
    shown = [(f["value"], f["count"]) for f in head["facets"]["tags"]]
    assert sorted(shown) == sorted(tag_counts.items())
    values = [value for value, _ in shown]
    assert values == sorted(values) or values == sorted(values, key=lambda v: (re.sub(r"[^a-z0-9]", "", v.lower()), v))
    filtered = get(app_url, "/api/public/news", params={"tag": tag}).json()
    assert filtered["total"] == 1 and [i["slug"] for i in filtered["items"]] == [sibling["slug"]]
    assert {f["value"]: f["count"] for f in filtered["facets"]["subjects"]}["company"] == 1
    assert_rail(app_url)
    updated, _ = feed(app_url)
    assert updated and instant(updated) == max(instant(n["published_at"]) for n in items)
    assert get(app_url, f"/api/public/news/{sibling['slug']}").json()["linked_model"] is None


def test_requisition_lifecycle(app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url, open_it=False)
    assert requisition["status"] == "draft" and requisition["version"] == 1
    draft = get(app_url, f"/api/public/roles/{requisition['slug']}")
    assert draft.status_code == 404 and draft.json() == NOT_PUBLISHED
    early = console(app_url, SANA).call("POST", f"/api/console/requisitions/{requisition['id']}/close",
                                        {"reason": "Budget moved."}, version=requisition["version"])
    assert early.status_code == 409 and early.json()["error"] == "illegal_transition"
    requisition = requisition_act(app_url, SANA, requisition, "open")
    assert requisition["status"] == "open" and requisition["version"] == 2
    assert get(app_url, f"/api/public/roles/{requisition['slug']}").status_code == 200
    again = console(app_url, SANA).call("POST", f"/api/console/requisitions/{requisition['id']}/open", {},
                                        version=requisition["version"])
    assert again.status_code == 409 and again.json()["error"] == "illegal_transition"
    first, second = fresh_email("closing"), fresh_email("closing")
    for email in (first, second):
        assert apply(app_url, requisition["slug"], "Rowan Ellery", email).status_code == 201
    screened = application_for(app_url, SANA, requisition, second)
    assert move(app_url, SANA, screened, "screening").status_code == 200
    before = {email: application_for(app_url, SANA, requisition, email) for email in (first, second)}
    reason = "Budget moved to next year."
    requisition = requisition_act(app_url, SANA, requisition, "close", {"reason": reason})
    assert requisition["status"] == "closed"
    closes = [e for e in audit(app_url, target_id=str(requisition["id"])) if e["action"] == "requisition.close"]
    assert len(closes) == 1 and closes[0]["actor"] == SANA
    tamper = console(app_url, SANA).call("DELETE", f"/api/console/audit/{closes[0]['id']}", {})
    assert tamper.status_code == 405 and tamper.json()["error"] == "audit_immutable"
    for email, earlier in before.items():
        after = application_for(app_url, SANA, requisition, email)
        assert after["stage"] == "declined" and after["version"] == earlier["version"] + 1
        closing = newest(after["decisions"], "declined")
        assert closing["rationale"] == f"Requisition closed: {reason}"
        assert is_staff(closing["by"], SANA) and closing["to"] == "declined"
        expected_notices = 2 if email == second else 1
        notices = await_mail(mail, email, "Update on your Aldermoor application", expected_notices)
        assert any(f"Your application is now at: {STAGE_LABELS['declined']}." in text(n) for n in notices)
        by_sana = [e for e in audit(app_url, target_id=str(after["id"])) if e["actor"] == SANA]
        by_sana += [e for e in audit(app_url, target_id=str(requisition["id"]))
                    if e["actor"] == SANA and str(after["id"]) in json.dumps(e.get("detail"))]
        assert len(by_sana) >= sum(1 for d in after["decisions"] if is_staff(d["by"], SANA))
    gone = get(app_url, f"/api/public/roles/{requisition['slug']}")
    assert gone.status_code == 410 and gone.json() == GONE_ROLE
    page = get(app_url, f"/careers/{requisition['slug']}")
    assert page.status_code == 410 and "This role has closed." in page.text
    late = apply(app_url, requisition["slug"], "Rowan Ellery", fresh_email("late"))
    assert late.status_code == 409 and late.json() == {
        "error": "requisition_closed", "message": "This role is no longer accepting applications."}
    closed_again = console(app_url, SANA).call("POST", f"/api/console/requisitions/{requisition['id']}/close",
                                               {"reason": reason}, version=requisition["version"])
    assert closed_again.status_code == 409


def test_wf_careers_publishing_shared_filters(browser: Browser, app_url: str) -> None:
    requisition = new_requisition(app_url, JULES, office="zurich", discipline="policy")
    context = browser.new_context()
    page = context.new_page()
    page.goto(app_url + "/careers")
    form = page.get_by_role("form", name="Filter roles")
    choose_filter(page, form.get_by_role("combobox", name="Discipline"), "policy", "Policy")
    expect(page).to_have_url(re.compile(r"=policy"))
    choose_filter(page, form.get_by_role("combobox", name="Office"), "zurich", "Zurich")
    choose_filter(page, form.get_by_role("combobox", name="Region"), "europe", "Europe")
    expect(page).to_have_url(re.compile(r"=europe"))
    values = {v for vs in parse_qs(urlparse(page.url).query).values() for v in vs}
    assert {"policy", "zurich", "europe"} <= values, page.url
    api = get(app_url, "/api/public/roles",
              params={"discipline": "policy", "office": "zurich", "region": "europe"}).json()["items"]
    assert requisition["slug"] in [r["slug"] for r in api]
    titles = [r["title"] for r in api]
    shared = browser.new_context()
    other = shared.new_page()
    other.goto(page.url)
    for view in (page, other):
        assert_in_order(view.get_by_role("main").inner_text(), titles)
        expect(view.get_by_role("main").get_by_role("link", name="Infrastructure Engineer")).to_have_count(0)
    assert shared.cookies() == []
    page.go_back()
    expect(page).not_to_have_url(re.compile(r"=europe"))
    expect(page).to_have_url(re.compile(r"=zurich"))
    context.close()
    shared.close()


def test_benefits_in_force_today(app_url: str) -> None:
    today = dt.datetime.now(LONDON).date()
    summary = f"Supplementary health insurance, revised {uuid.uuid4().hex[:6]}."
    todays = console(app_url, SANA).call("POST", "/api/console/benefits",
                                         {"region": "europe", "effective_from": today.isoformat(), "summary": summary})
    assert todays.status_code in (201, 409), todays.text
    tomorrow = console(app_url, SANA).call("POST", "/api/console/benefits", {
        "region": "europe", "effective_from": (today + dt.timedelta(days=1)).isoformat(), "summary": "Not yet."})
    assert tomorrow.status_code in (201, 409), tomorrow.text
    regions = {r["region"]: r for r in get(app_url, "/api/public/benefits").json()["regions"]}
    europe = regions["europe"]["entry"]
    if dt.datetime.now(LONDON).date() != today:
        assert europe["effective_from"] in (today.isoformat(), (today + dt.timedelta(days=1)).isoformat())
        return
    assert europe["effective_from"] == today.isoformat()
    if todays.status_code == 201:
        assert europe["summary"] == summary and europe["id"] == todays.json()["entry"]["id"]
    else:
        assert todays.json()["error"] == "entry_exists"
    uk_expected = "2027-01-01" if today >= dt.date(2027, 1, 1) else "2026-01-01"
    assert regions["uk"]["entry"]["effective_from"] == uk_expected
    assert get(app_url, f"/api/public/roles/{POLICY_ROLE}").json()["benefits"] == europe
    assert europe["summary"] in get(app_url, "/careers").text


def test_wf_careers_publishing_journey(browser: Browser, app_url: str) -> None:
    requisition = new_requisition(app_url, JULES, office="toronto", discipline="engineering", open_it=False)
    context, page = staff_page(browser, app_url, JULES)
    page.goto(f"/console/requisitions/{requisition['id']}")
    page.get_by_role("button", name="Open requisition").click()
    expect(console_status(page)).to_have_text("Requisition opened.")
    today = dt.datetime.now(LONDON).date().isoformat()
    benefits = console(app_url, JULES).call("POST", "/api/console/benefits", {
        "region": "north-america", "effective_from": today, "summary": "Health, dental and vision cover, 27 days' leave."})
    assert benefits.status_code in (201, 409), benefits.text
    entry = {r["region"]: r for r in get(app_url, "/api/public/benefits").json()["regions"]}["north-america"]["entry"]
    visitor = browser.new_context()
    reader = visitor.new_page()
    reader.goto(app_url + "/careers")
    form = reader.get_by_role("form", name="Filter roles")
    choose_filter(reader, form.get_by_role("combobox", name="Discipline"), "engineering", "Engineering")
    choose_filter(reader, form.get_by_role("combobox", name="Office"), "toronto", "Toronto")
    choose_filter(reader, form.get_by_role("combobox", name="Region"), "north-america", "North America")
    reader.get_by_role("main").get_by_role("link", name=re.compile(re.escape(requisition["title"]))).first.click()
    expect(reader.get_by_role("heading", name=requisition["title"]).first).to_be_visible()
    expect(reader.get_by_role("main")).to_contain_text(entry["summary"])
    role = get(app_url, f"/api/public/roles/{requisition['slug']}").json()
    assert role["region"] == "north-america" and role["benefits"] == entry
    context.close()
    visitor.close()


LIMIT_CASES = ["title_at_limit", "title_over", "description_at_limit", "description_over", "summary_at_limit",
               "summary_over", "reason_at_limit", "reason_over", "date_feb_30", "date_month_13"]


@pytest.mark.parametrize("case", LIMIT_CASES, ids=LIMIT_CASES)
def test_careers_text_limits(app_url: str, case: str) -> None:
    sana = console(app_url, SANA)
    glyph = "𝔄"
    over = case.endswith("_over")
    if case.startswith(("title", "description")):
        size = (TITLE_MAX if case.startswith("title") else DESCRIPTION_MAX) + (1 if over else 0)
        field = "title" if case.startswith("title") else "description"
        value = glyph * size
        payload = {"slug": fresh_slug("role"), "title": "Limit probe", "discipline": "research", "office": "london",
                   "description": "A short description.", "recruiters": [SANA], field: f"  {value}  "}
        response = sana.call("POST", "/api/console/requisitions", payload)
        if over:
            message = {"title": "Enter a title of at most 120 characters.",
                       "description": "Enter a description of at most 8,000 characters."}[field]
            assert response.status_code == 422 and response.json()["fields"][field] == message
            return
        assert response.status_code == 201, response.text
        requisition_act(app_url, SANA, response.json()["requisition"], "open")
        assert get(app_url, f"/api/public/roles/{payload['slug']}").json()[field] == value
        return
    if case.startswith("reason"):
        requisition = new_requisition(app_url)
        reason = glyph * (REASON_MAX + (1 if over else 0))
        response = sana.call("POST", f"/api/console/requisitions/{requisition['id']}/close", {"reason": reason},
                             version=requisition["version"])
        if over:
            assert response.status_code == 422
            assert response.json()["fields"]["reason"] == "Say why this requisition is closing."
        else:
            assert response.status_code == 200, response.text
        return
    if case.startswith("summary"):
        summary = glyph * (SUMMARY_MAX + (1 if over else 0))
        for _ in range(5):
            past = (dt.date(2000, 1, 1) + dt.timedelta(days=uuid.uuid4().int % 9000)).isoformat()
            response = sana.call("POST", "/api/console/benefits",
                                 {"region": "uk", "effective_from": past, "summary": f" {summary} "})
            if not (response.status_code == 409 and error_of(response) == "entry_exists"):
                break
        if over:
            assert response.status_code == 422
            assert response.json()["fields"]["summary"] == "Enter a summary of at most 500 characters."
        else:
            assert response.status_code == 201 and response.json()["entry"]["summary"] == summary
        return
    bad = {"date_feb_30": "2027-02-30", "date_month_13": "2027-13-01"}[case]
    response = sana.call("POST", "/api/console/benefits", {"region": "uk", "effective_from": bad, "summary": "Probe."})
    assert response.status_code == 422
    assert response.json()["fields"]["effective_from"] == "Use a real date in the form YYYY-MM-DD."


def test_wf_candidate_application_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url, office="edinburgh")
    benefits = get(app_url, f"/api/public/roles/{requisition['slug']}").json()["benefits"]
    name = "Zoë D'Arcy, Jr"
    headroom(app_url, "candidate", 5)
    email = fresh_email("applicant")
    pdf = make_pdf()
    context = browser.new_context()
    page = context.new_page()
    page.goto(app_url + "/careers")
    form = page.get_by_role("form", name="Filter roles")
    choose_filter(page, form.get_by_role("combobox", name="Discipline"), "research", "Research")
    choose_filter(page, form.get_by_role("combobox", name="Office"), "edinburgh", "Edinburgh")
    choose_filter(page, form.get_by_role("combobox", name="Region"), "uk", "United Kingdom")
    page.get_by_role("main").get_by_role("link", name=re.compile(re.escape(requisition["title"]))).first.click()
    if benefits:
        expect(page.get_by_role("main")).to_contain_text(benefits["summary"])
    apply_form = page.get_by_role("form", name=f"Apply for {requisition['title']}")
    apply_form.get_by_role("textbox", name="Full name").fill(name)
    apply_form.get_by_role("textbox", name="Email").fill(email)
    apply_form.get_by_label("Résumé (PDF)").set_input_files(
        {"name": "cv.pdf", "mimeType": "application/pdf", "buffer": pdf})
    apply_form.get_by_role("checkbox", name="I consent to Aldermoor Labs processing my application").check()
    status = page.get_by_role("status", name="Application status")
    with held(page, "**/api/careers/roles/*/applications") as gate:
        apply_form.get_by_role("button", name="Submit application").click()
        expect(status).to_have_text("Sending your application…")
        expect(apply_form.get_by_role("button", name="Submit application")).to_be_disabled()
        gate.release()
    expect(status).to_have_text(RECEIVED.format(email=email))
    receipt = await_mail(mail, email, f"Application received: {requisition['title']}")
    assert len(distinct(receipt)) == 1
    body = text(receipt[0])
    assert requisition["title"] in body and re.search(r"AR-[A-Z2-7]{8}", body)
    tracking = get(app_url, f"/api/track/{token_in(receipt[0])}")
    assert tracking.status_code == 200 and tracking.json()["role"]["title"] == requisition["title"]
    keys = S3().keys(f"resumes/{requisition['id']}/")
    assert len(keys) == 1 and re.fullmatch(rf"resumes/{re.escape(str(requisition['id']))}/[0-9a-f]{{32}}\.pdf", keys[0])
    assert S3().get(keys[0]) == pdf
    context.close()


RESUME_CASES = ["smallest_pdf", "largest_pdf", "one_byte_over", "empty", "html_named_pdf", "pdf_named_txt"]


@pytest.mark.parametrize("case", RESUME_CASES, ids=RESUME_CASES)
def test_resume_checks(app_url: str, mail: Mailpit, case: str) -> None:
    requisition = new_requisition(app_url)
    email = fresh_email("resume")
    filename, content_type = "resume.pdf", "application/pdf"
    payload = {"smallest_pdf": b"%PDF-", "largest_pdf": make_pdf(RESUME_MAX_BYTES),
               "one_byte_over": make_pdf(RESUME_MAX_BYTES + 1), "empty": b"",
               "html_named_pdf": b"<html>not a pdf</html>", "pdf_named_txt": make_pdf()}[case]
    if case == "pdf_named_txt":
        filename, content_type = f"{NOTES_NAME}.txt", "text/plain"
    response = apply(app_url, requisition["slug"], "Rowan Ellery", email, payload, filename=filename,
                     content_type=content_type)
    prefix = f"resumes/{requisition['id']}/"
    if case in ("smallest_pdf", "largest_pdf", "pdf_named_txt"):
        assert response.status_code == 201, response.text
        keys = S3().keys(prefix)
        assert len(keys) == 1 and re.fullmatch(rf"{re.escape(prefix)}[0-9a-f]{{32}}\.pdf", keys[0])
        assert Path(filename).stem not in keys[0][len(prefix):]
        assert S3().get(keys[0]) == payload
        return
    assert response.status_code == 422, response.text
    assert response.json()["error"] == "validation_failed"
    assert response.json()["fields"]["resume"] == RESUME_MESSAGE
    assert S3().keys(prefix) == [] and applications(app_url, SANA, requisition) == []
    retry = apply(app_url, requisition["slug"], "Rowan Ellery", email)
    assert retry.status_code == 201
    await_mail(mail, email, "Application received")
    assert len(distinct(settled(mail, email, "Application received"))) == 1


def test_one_application_per_email(app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url)
    email = fresh_email("dup")
    pdf = make_pdf()
    results = race(*[(lambda: apply(app_url, requisition["slug"], "Rowan Ellery", email, pdf)) for _ in range(5)])
    assert sorted(r.status_code for r in results) == [200, 200, 200, 200, 201]
    bodies = [r.json() for r in results]
    assert all(body == bodies[0] for body in bodies)
    application = bodies[0]["application"]
    assert re.fullmatch(r"AR-[A-Z2-7]{8}", application["reference"]) and application["stage"] == "submitted"
    later = apply(app_url, requisition["slug"], "Another Name", f"  {email.upper()}  ", make_pdf())
    assert later.status_code == 200 and later.json() == bodies[0]
    assert len(S3().keys(f"resumes/{requisition['id']}/")) == 1
    assert len(applications(app_url, SANA, requisition)) == 1
    await_mail(mail, email, "Application received")
    assert len(distinct(settled(mail, email, "Application received"))) == 1


def test_wf_candidate_application_storage_outage(browser: Browser, app_url: str, mail: Mailpit) -> None:
    down = minio_down()
    requisition = new_requisition(app_url)
    first, second = fresh_email("outage"), fresh_email("outage")
    headroom(app_url, "candidate", 5)
    message = "We couldn't store your résumé just now. Nothing was submitted; please try again in a few minutes."
    response = apply(down, requisition["slug"], "Rowan Ellery", first)
    assert response.status_code == 503
    assert response.json() == {"error": "storage_unavailable", "message": message}
    context = browser.new_context()
    page = context.new_page()
    page.goto(f"{down}/careers/{requisition['slug']}")
    form = page.get_by_role("form", name=f"Apply for {requisition['title']}")
    form.get_by_role("textbox", name="Full name").fill("Rowan Ellery")
    form.get_by_role("textbox", name="Email").fill(second)
    form.get_by_label("Résumé (PDF)").set_input_files({"name": "cv.pdf", "mimeType": "application/pdf",
                                                        "buffer": make_pdf()})
    form.get_by_role("checkbox", name="I consent to Aldermoor Labs processing my application").check()
    form.get_by_role("button", name="Submit application").click()
    expect(page.get_by_role("status", name="Application status")).to_have_text(message)
    assert S3().keys(f"resumes/{requisition['id']}/") == []
    assert applications(app_url, SANA, requisition) == []
    retry = apply(app_url, requisition["slug"], "Rowan Ellery", first)
    assert retry.status_code == 201
    await_mail(mail, first, "Application received")
    assert len(distinct(settled(mail, first, "Application received"))) == 1
    assert settled(mail, second) == []
    context.close()


def test_receipts_survive_mail_outage(app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url)
    email = fresh_email("mailout")
    response = apply(mailpit_down(), requisition["slug"], "Rowan Ellery", email)
    assert response.status_code == 201, response.text
    receipts = await_mail(mail, email, f"Application received: {requisition['title']}")
    ids = {str(m.get("MessageID", "")).strip("<>") for m in receipts}
    assert len(ids) == 1 and re.fullmatch(r"outbox-[^@\s]+@aldermoor\.example", ids.pop())
    assert receipts[0]["From"]["Address"] == mail_from_address()


ADDRESS_CASES = ["accented_name", "name_line_break", "name_line_separator", "name_control", "email_comma",
                 "email_line_break", "email_semicolon", "email_space", "email_angle"]


@pytest.mark.parametrize("case", ADDRESS_CASES, ids=ADDRESS_CASES)
def test_candidate_mail_addressing(app_url: str, mail: Mailpit, case: str) -> None:
    requisition = new_requisition(app_url)
    email = fresh_email("addr")
    spy = fresh_email("spy")
    name, address = "Rowan Ellery", email
    if case == "accented_name":
        name, address = '  Zoë "Zed" O\'Neil, Esq.  ', f"  {email.upper()}  "
    elif case == "name_line_break":
        name = f"Mallory\r\nBcc: {spy}"
    elif case == "name_line_separator":
        name = "Mallory\u2028Bcc"
    elif case == "name_control":
        name = "Mallory\x07"
    else:
        address = {"email_comma": f"{email},{spy}", "email_line_break": f"{email}\r\nBcc: {spy}",
                   "email_semicolon": f"{email};{spy}", "email_space": f"{email} {spy}",
                   "email_angle": f"<{email}>"}[case]
    response = apply(app_url, requisition["slug"], name, address)
    if case == "accented_name":
        assert response.status_code == 201, response.text
        message = await_mail(mail, email, "Application received")[0]
        assert addresses(message.get("To")) == [email] and not message.get("Cc") and not message.get("Bcc")
        assert message["To"][0]["Name"] == name.strip()
        return
    field = "name" if case.startswith("name") else "email"
    assert response.status_code == 422, response.text
    assert response.json()["fields"][field] == ("Enter your full name." if field == "name"
                                                else "Enter a valid email address.")
    assert applications(app_url, SANA, requisition) == []
    assert S3().keys(f"resumes/{requisition['id']}/") == []
    assert apply(app_url, requisition["slug"], "Rowan Ellery", email).status_code == 201
    await_mail(mail, email, "Application received")
    assert settled(mail, spy) == [] and len(distinct(settled(mail, email, "Application received"))) == 1


def test_wf_candidate_tracking_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url)
    email, token = applied_with_token(app_url, mail, requisition)
    application = application_for(app_url, SANA, requisition, email)
    assert move(app_url, SANA, application, "screening").status_code == 200
    headroom(app_url, "candidate", 5)
    context = browser.new_context(timezone_id="Europe/London")
    page = context.new_page()
    page.goto(f"{app_url}/track/{token}")
    expect(page.get_by_role("heading", name=requisition["title"])).to_be_visible()
    progress = page.get_by_role("list", name="Stage progress")
    poll(lambda: STAGE_LABELS["screening"] in progress.evaluate(CURRENT_STEP_JS), UI_TIMEOUT_MS / 1000,
         "current stage step")
    tracking = get(app_url, f"/api/track/{token}").json()
    expect(page.get_by_role("main")).to_contain_text(
        f"{instant(tracking['submitted_at']).astimezone(LONDON).day}")
    page.get_by_role("button", name="Withdraw application").click()
    dialog = page.get_by_role("dialog", name="Withdraw application?")
    dialog.get_by_role("button", name="Withdraw").click()
    expect(page.get_by_role("status", name="Application status")).to_have_text("Your application has been withdrawn.")
    after = application_for(app_url, SANA, requisition, email)
    assert after["stage"] == "withdrawn"
    withdrawal = newest(after["decisions"], "withdrawn")
    assert "candidate" in json.dumps(withdrawal["by"]).lower()
    assert withdrawal["rationale"] == "Withdrawn by candidate"
    assert get(app_url, f"/api/track/{token}").json()["stage"] == "withdrawn"
    context.close()


def test_tracking_shows_stage_only(app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url)
    email, token = applied_with_token(app_url, mail, requisition, name=APPLICANT_NAME)
    neighbour = fresh_email("neighbour")
    assert apply(app_url, requisition["slug"], NEIGHBOUR_NAME, neighbour).status_code == 201
    application = application_for(app_url, SANA, requisition, email)
    secret_note, secret_reason = f"note-{uuid.uuid4().hex}", f"reason-{uuid.uuid4().hex}"
    assert console(app_url, SANA).call("POST", f"/api/console/applications/{application['id']}/notes",
                                       {"body": secret_note}).status_code == 201
    assert move(app_url, SANA, application, "screening", secret_reason).status_code == 200
    response = get(app_url, f"/api/track/{token}")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"role", "stage", "stage_label", "submitted_at", "stage_changed_at"}
    assert set(body["role"]) == {"title", "office"} and body["role"]["title"] == requisition["title"]
    assert (body["stage"], body["stage_label"]) == ("screening", "Screening")
    page = get(app_url, f"/track/{token}")
    for leaked in (secret_note, secret_reason, email, neighbour, APPLICANT_NAME, NEIGHBOUR_NAME):
        assert leaked not in response.text
    for leaked in (secret_note, secret_reason, email, neighbour, NEIGHBOUR_NAME):
        assert leaked not in page.text
    for r in (response, page):
        assert "no-store" in r.headers.get("Cache-Control", "")
        assert r.headers.get("Referrer-Policy") == "no-referrer"


def test_resend_reveals_nothing(app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url)
    known = [fresh_email("known") for _ in range(3)]
    for email in known:
        assert apply(app_url, requisition["slug"], "Rowan Ellery", email).status_code == 201
    unknown = [fresh_email("unknown") for _ in range(3)]
    headroom(app_url, "candidate", 7)
    timings: dict[str, list[float]] = {"known": [], "unknown": []}
    for kind, emails in (("known", known), ("unknown", unknown)):
        for email in emails:
            response = send(client(app_url), "POST", "/api/careers/tracking-links", json={"email": email})
            timings[kind].append(response.elapsed.total_seconds())
            assert response.status_code == 202 and response.json() == RESEND_BODY
    assert abs(statistics.mean(timings["known"]) - statistics.mean(timings["unknown"])) < TIMING_TOLERANCE_S
    for email in known:
        await_mail(mail, email, "Your Aldermoor application links")
    for email in unknown:
        assert settled(mail, email) == []
    bad = send(client(app_url), "POST", "/api/careers/tracking-links", json={"email": "not-an-address"})
    assert bad.status_code == 422 and bad.json()["fields"]["email"] == "Enter a valid email address."


def test_tracking_link_lifetime(app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url)
    email, original = applied_with_token(app_url, mail, requisition)
    assert len(original) >= TOKEN_MIN_CHARS and re.fullmatch(r"[A-Za-z0-9._~-]+", original)
    application = application_for(app_url, SANA, requisition, email)
    reissued = console(app_url, SANA).call("POST", f"/api/console/applications/{application['id']}/tracking-link/reissue", {})
    assert reissued.status_code == 200 and "reissued_at" in reissued.json()
    second = token_in(await_mail(mail, email, f"Your new tracking link: {requisition['title']}")[-1])
    old = get(app_url, f"/api/track/{original}")
    assert old.status_code == 404 and old.json() == BAD_LINK
    stale_withdraw = send(client(app_url), "POST", f"/api/track/{original}/withdraw", json={})
    assert stale_withdraw.status_code == 404 and stale_withdraw.json() == BAD_LINK
    assert get(app_url, f"/api/track/{second}").status_code == 200
    send(client(app_url), "POST", "/api/careers/tracking-links", json={"email": email})
    third = token_in(await_mail(mail, email, "Your Aldermoor application links")[-1])
    assert get(app_url, f"/api/track/{second}").status_code == 404
    assert get(app_url, f"/api/track/{third}").status_code == 200
    invalid_page = get(app_url, f"/track/{uuid.uuid4().hex}{uuid.uuid4().hex}")
    assert invalid_page.status_code == 404 and "This tracking link is not valid." in invalid_page.text
    resume_keys = S3().keys(f"resumes/{requisition['id']}/")
    assert len(resume_keys) == 1
    with spawned(APPLICATION_RETENTION_SECONDS=str(RETENTION_PROBE_S)) as short:
        recruiter = console(short, SANA)
        requisition_act(short, SANA, recruiter.call(
            "GET", f"/api/console/requisitions/{requisition['id']}").json()["requisition"], "close",
            {"reason": "Role filled."})

        def erased() -> bool:
            current = recruiter.call("GET", f"/api/console/applications/{application['id']}").json()
            return get(short, f"/api/track/{third}").status_code == 404 \
                and S3().keys(f"resumes/{requisition['id']}/") == [] \
                and current["application"]["name"] == "Erased applicant" \
                and current["application"]["email"] in ("", None)

        poll(erased, RETENTION_PROBE_S + 3 * RETENTION_LAG_S + SLACK_S, "retention erasure", 1.0)
    erasures = [e for e in audit(app_url, target_id=application["id"]) if e["action"] == "application.erase"]
    assert len(erasures) == 1 and erasures[0]["actor"] == "system:retention"
    assert email not in json.dumps(audit(app_url, target_id=application["id"]))


def test_wf_candidate_tracking_resend_throttle(browser: Browser, app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url)
    email, _ = applied_with_token(app_url, mail, requisition)
    headroom(app_url, "candidate", 8)
    context = browser.new_context()
    page = context.new_page()
    page.goto(app_url + "/careers")
    form = page.get_by_role("form", name="Resend my tracking links")
    status = form.get_by_role("status", name="Resend status")
    for attempt in range(5):
        form.get_by_role("textbox", name="Email").fill(email)
        form.get_by_role("button", name="Resend links").click()
        expect(status).to_have_text(RESEND_BODY["message"])
        if attempt == RESEND_LIMIT - 1:
            await_mail(mail, email, "Your Aldermoor application links", RESEND_LIMIT)
    sent = distinct(settled(mail, email, "Your Aldermoor application links"))
    assert len(sent) == RESEND_LIMIT
    working = [token for token in (token_in(m) for m in sent) if get(app_url, f"/api/track/{token}").status_code == 200]
    assert len(working) == 1, working
    context.close()


def test_wf_recruiter_pipeline_illegal_move(browser: Browser, app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url)
    email = fresh_email("stages")
    assert apply(app_url, requisition["slug"], "Rowan Ellery", email).status_code == 201
    application = application_for(app_url, SANA, requisition, email)
    context, page = staff_page(browser, app_url, SANA)
    page.goto(f"/console/applications/{application['id']}")
    illegal = f"This item cannot move from {application['stage']} to {'interview'}."
    stage_box = page.get_by_role("combobox", name="Move to stage")
    if offers(stage_box, "Interview"):
        choose(stage_box, "interview", "Interview")
        page.get_by_role("textbox", name="Decision rationale").fill("Skipping ahead.")
        page.get_by_role("button", name="Record decision").click()
        expect(console_status(page)).to_contain_text(illegal)
    else:
        skipped = move(app_url, SANA, application, "interview", "Skipping ahead.")
        assert skipped.status_code == 409 and skipped.json()["message"] == illegal
    unchanged = application_for(app_url, SANA, requisition, email)
    assert (unchanged["stage"], unchanged["version"]) == ("submitted", application["version"])
    empty = move(app_url, SANA, application, "screening", "   ")
    assert empty.status_code == 422 and empty.json()["fields"]["rationale"] == "Record the reason for this decision."
    secret = f"rationale-{uuid.uuid4().hex}"
    page.reload()
    choose(page.get_by_role("combobox", name="Move to stage"), "screening", "Screening")
    page.get_by_role("textbox", name="Decision rationale").fill(secret)
    page.get_by_role("button", name="Record decision").click()
    expect(console_status(page)).to_have_text("Decision recorded. The candidate will be told the new stage by email.")
    moved = application_for(app_url, SANA, requisition, email)
    assert moved["stage"] == "screening" and moved["version"] == application["version"] + 1
    latest = newest(moved["decisions"], "screening")
    assert (latest["from"], latest["to"], latest["rationale"]) == ("submitted", "screening", secret)
    assert is_staff(latest["by"], SANA)
    notice = await_mail(mail, email, "Update on your Aldermoor application")[0]
    assert f"Your application is now at: {STAGE_LABELS['screening']}." in text(notice)
    assert secret not in text(notice)
    context.close()


def test_resumes_only_for_assigned_recruiters(app_url: str) -> None:
    requisition = new_requisition(app_url)
    email = fresh_email("cv")
    pdf = make_pdf()
    assert apply(app_url, requisition["slug"], "Rowan Ellery", email, pdf).status_code == 201
    application = application_for(app_url, SANA, requisition, email)
    download = console(app_url, SANA).call("GET", f"/api/console/applications/{application['id']}/resume")
    assert download.status_code == 200 and download.content == pdf
    assert download.headers["content-type"].startswith("application/pdf")
    assert download.headers["Content-Disposition"] == f'attachment; filename="resume-{application["reference"]}.pdf"'
    unknown_id = str(uuid.uuid4())
    for who in (JULES, ELENI):
        mine = console(app_url, who).call("GET", f"/api/console/applications/{application['id']}/resume")
        missing = console(app_url, who).call("GET", f"/api/console/applications/{unknown_id}/resume")
        assert mine.status_code == missing.status_code == 404
        assert mine.content == missing.content and pdf not in mine.content
    offline = console(minio_down(), SANA).call("GET", f"/api/console/applications/{application['id']}/resume")
    assert offline.status_code == 503
    assert offline.json() == {"error": "storage_unavailable", "message": "Résumés are unavailable right now."}


def test_wf_recruiter_pipeline_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    requisition = new_requisition(app_url)
    pdf = make_pdf()
    email, token = applied_with_token(app_url, mail, requisition, email=fresh_email("pipeline"), pdf=pdf)
    application = application_for(app_url, SANA, requisition, email)
    context, page = staff_page(browser, app_url, SANA, accept_downloads=True)
    page.goto(f"/console/applications/{application['id']}")
    with page.expect_download() as download:
        page.get_by_role("link", name="Download résumé").click()
    assert Path(download.value.path()).read_bytes() == pdf
    note = "Clear account of the harness design."
    page.get_by_role("textbox", name="Interview note").fill(note)
    page.get_by_role("button", name="Add note").click()
    expect(console_status(page)).to_have_text("Note added.")
    page.get_by_role("button", name="Reissue tracking link").click()
    expect(console_status(page)).to_have_text("A new tracking link is on its way to the candidate.")
    fresh = token_in(await_mail(mail, email, f"Your new tracking link: {requisition['title']}")[-1])
    assert fresh != token
    old = get(app_url, f"/api/track/{token}")
    assert old.status_code == 404 and old.json() == BAD_LINK
    for stage in ("screening", "interview", "final_review", "offer"):
        page.reload()
        choose(page.get_by_role("combobox", name="Move to stage"), stage, STAGE_LABELS[stage])
        page.get_by_role("textbox", name="Decision rationale").fill(f"Ready for {STAGE_LABELS[stage]}.")
        page.get_by_role("button", name="Record decision").click()
        expect(console_status(page)).to_have_text(
            "Decision recorded. The candidate will be told the new stage by email.")
    final = application_for(app_url, SANA, requisition, email)
    assert final["stage"] == "offer"
    chain = [("submitted", "screening"), ("screening", "interview"), ("interview", "final_review"), ("final_review", "offer")]
    at = {(d["from"], d["to"]): instant(d["at"]) for d in final["decisions"]}
    assert sorted(at) == sorted(chain) and len(final["decisions"]) == len(chain), final["decisions"]
    times = [at[step] for step in chain]
    assert times == sorted(times), final["decisions"]
    assert all(d["rationale"] and is_staff(d["by"], SANA) for d in final["decisions"])
    assert [n["body"] for n in final["notes"]] == [note]
    await_mail(mail, email, "Update on your Aldermoor application", 4)
    assert get(app_url, f"/api/track/{fresh}").json()["stage"] == "offer"
    late = send(client(app_url), "POST", f"/api/track/{fresh}/withdraw", json={})
    assert late.status_code == 409 and late.json()["error"] == "illegal_transition"
    stages = [e for e in audit(app_url, target_id=str(application["id"])) if e["action"] == "application.stage"]
    assert len(stages) == 4 and all(e["actor"] == SANA for e in stages)
    tamper = console(app_url, SANA).call("PATCH", f"/api/console/audit/{stages[0]['id']}", {"actor": JULES})
    assert tamper.status_code == 405 and tamper.json()["error"] == "audit_immutable"
    context.close()


STAGE_RACES = ["moves_same_version", "withdraw_vs_offer", "close_vs_move"]


@pytest.mark.parametrize("case", STAGE_RACES, ids=STAGE_RACES)
def test_stage_move_races(app_url: str, mail: Mailpit, case: str) -> None:
    requisition = new_requisition(app_url, recruiters=[SANA, JULES])
    email, token = applied_with_token(app_url, mail, requisition)
    application = application_for(app_url, SANA, requisition, email)
    if case == "moves_same_version":
        results = race(*[(lambda who=who: move(app_url, who, application, "screening"))
                         for who in (SANA, JULES, SANA, JULES)])
        assert sorted(r.status_code for r in results) == [200, 412, 412, 412]
        after = application_for(app_url, SANA, requisition, email)
        assert len(after["decisions"]) == 1 and after["version"] == application["version"] + 1
        await_mail(mail, email, "Update on your Aldermoor application")
        assert len(distinct(settled(mail, email, "Update on your Aldermoor application"))) == 1
        assert len([e for e in audit(app_url, target_id=application["id"]) if e["action"] == "application.stage"]) == 1
        return
    if case == "withdraw_vs_offer":
        for stage in ("screening", "interview", "final_review"):
            assert move(app_url, SANA, application, stage).status_code == 200
            application = application_for(app_url, SANA, requisition, email)
        decisions = len(application["decisions"])
        offer, withdraw = race(lambda: move(app_url, SANA, application, "offer"),
                               lambda: send(client(app_url), "POST", f"/api/track/{token}/withdraw", json={}))
        if offer.status_code == 200:
            assert withdraw.status_code == 409 and withdraw.json() == {
                "error": "illegal_transition", "message": "This item cannot move from offer to withdrawn."}
        else:
            assert (withdraw.status_code, offer.status_code) == (200, 412)
        after = application_for(app_url, SANA, requisition, email)
        assert len(after["decisions"]) == decisions + 1 and after["version"] == application["version"] + 1
        return
    requisition_act(app_url, SANA, console(app_url, SANA).call(
        "GET", f"/api/console/requisitions/{requisition['id']}").json()["requisition"], "close", {"reason": "Filled."})
    late = move(app_url, JULES, application, "screening")
    assert late.status_code == 412 and late.json() == STALE
    after = application_for(app_url, SANA, requisition, email)
    assert after["stage"] == "declined" and len(after["decisions"]) == 1


def test_wf_access_governance_sign_in(browser: Browser, app_url: str) -> None:
    headroom(app_url, "signin", 5)
    context = browser.new_context(base_url=app_url)
    page = context.new_page()
    page.goto("/console/sign-in")
    page.get_by_role("textbox", name="Email").fill(NOOR)
    page.get_by_label("Password").fill("not-the-password")
    page.get_by_role("button", name="Sign in").click()
    expect(page.get_by_role("status", name="Sign-in status")).to_have_text(
        "That email and password do not match a staff account.")
    unknown = send(client(app_url), "POST", "/api/console/session",
                   json={"email": fresh_email("ghost"), "password": "not-the-password"})
    assert unknown.status_code == 401 and unknown.json() == {
        "error": "invalid_credentials", "message": "That email and password do not match a staff account."}
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    expect(page).to_have_url(re.compile(r"/console/?$"))
    cookies = context.cookies()
    assert len(cookies) == 1 and cookies[0]["httpOnly"] is True and cookies[0]["sameSite"] == "Strict"
    noor = Console(app_url, NOOR)
    me = noor.call("GET", "/api/console/me")
    assert me.status_code == 200 and me.json()["email"] == NOOR
    content = noor.call("GET", "/api/console/content")
    assert content.status_code == 403 and content.json() == FORBIDDEN
    assert noor.call("DELETE", "/api/console/session", key=False).status_code == 204
    after = noor.call("GET", "/api/console/me")
    assert after.status_code == 401 and after.json() == {"error": "unauthenticated", "message": "Sign in to continue."}
    context.close()


def test_time_limited_grants(app_url: str, mail: Mailpit) -> None:
    admin = console(app_url, ADA)
    invalid = admin.call("POST", "/api/console/grants", {"staff_email": fresh_email("nobody"), "role": "pilot",
                                                         "expires_at": "2020-01-01T00:00:00Z"})
    assert invalid.status_code == 422
    messages = {"staff_email": "No staff account has that email.",
                "role": "Choose editor, approver, recruiter or administrator.",
                "expires_at": "Choose an expiry in the future."}
    fields = invalid.json()["fields"]
    assert fields and all(messages.get(key) == value for key, value in fields.items()), fields
    noor = Console(app_url, NOOR)
    editor = grant(app_url, NOOR, "editor", now() + dt.timedelta(days=30))
    duplicate = admin.call("POST", "/api/console/grants", {"staff_email": NOOR, "role": "editor",
                                                           "expires_at": iso(now() + dt.timedelta(days=30))})
    assert duplicate.status_code == 409 and duplicate.json() == {
        "error": "grant_exists", "message": "That person already holds this role."}
    assert noor.call("GET", "/api/console/content").status_code == 200
    revoked = revoke(app_url, editor).json()["grant"]
    assert revoked["status"] == "revoked" and revoked["version"] == editor["version"] + 1
    assert is_staff(revoked["revoked_by"], ADA)
    assert noor.call("GET", "/api/console/content").json() == FORBIDDEN
    again = revoke(app_url, revoked, 409)
    assert again.json() == {"error": "grant_inactive", "message": "This grant has already ended."}
    subject = "Your Recruiter access ends soon"
    before = len(distinct(inbox(mail, NOOR, subject)))
    expiry = (now() + dt.timedelta(seconds=EXPIRY_NOTICE_LAG_S + 10 * SLACK_S)).replace(microsecond=0)
    grant(app_url, NOOR, "recruiter", expiry)
    assert noor.call("GET", "/api/console/requisitions").status_code == 200
    wait_until_instant(expiry, "recruiter grant expiry")
    refused = noor.call("GET", "/api/console/requisitions")
    assert refused.status_code == 403 and refused.json() == FORBIDDEN
    notices = await_mail(mail, NOOR, subject, before + 1, EXPIRY_NOTICE_LAG_S + SLACK_S)
    assert len(distinct(settled(mail, NOOR, subject))) == before + 1
    assert all(addresses(n.get("To")) == [NOOR] for n in notices)


def app_role_sql(sql: str) -> subprocess.CompletedProcess[str]:
    url = urlparse(os.environ["DATABASE_URL"])
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGHOST": url.hostname or "", "PGPORT": str(url.port or 5432),
           "PGDATABASE": url.path.lstrip("/"), "PGUSER": unquote(url.username or ""), "PGPASSWORD": unquote(url.password or "")}
    return subprocess.run(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", f"BEGIN; {sql}; ROLLBACK;"], env=env,
                          capture_output=True, text=True, timeout=30, check=False)


def audit_table_refuses_changes() -> None:
    found = Postgres().rows("select table_schema as s, column_name as c from information_schema.columns "
                            "where table_name = 'audit_entries' order by ordinal_position limit 1")
    assert found, "no audit_entries table"
    table, column = f'"{found[0]["s"]}".audit_entries', f'"{found[0]["c"]}"'
    one = f"(select ctid from {table} limit 1)"
    before = Postgres().rows(f"select count(*)::int as n from {table}")[0]["n"]
    assert before > 0
    seen = app_role_sql(f"select count(*) from {table}")
    assert seen.returncode == 0, seen.stderr
    for statement in (f"update {table} set {column} = {column} where ctid = {one}",
                      f"delete from {table} where ctid = {one}", f"truncate {table}"):
        result = app_role_sql(statement)
        assert result.returncode != 0 and result.stderr.strip(), f"the database allowed: {statement}"
    assert Postgres().rows(f"select count(*)::int as n from {table}")[0]["n"] >= before


def test_audit_append_only(app_url: str, mail: Mailpit) -> None:
    item = new_news(app_url, author=INES)
    created = [e for e in audit(app_url, target_id=item["id"]) if e["action"] == "content.create"]
    assert len(created) == 1 and created[0]["actor"] == INES
    for method in ("PUT", "PATCH", "DELETE"):
        response = console(app_url, KOFI).call(method, f"/api/console/audit/{created[0]['id']}", {"actor": KOFI})
        assert response.status_code == 405 and response.json() == {
            "error": "audit_immutable", "message": "Audit entries cannot be changed or removed."}
    assert audit(app_url, target_id=item["id"])[0]["hash"] == created[0]["hash"]
    audit_table_refuses_changes()
    requisition = new_requisition(app_url)
    email, token = applied_with_token(app_url, mail, requisition, name=APPLICANT_NAME)
    application = application_for(app_url, SANA, requisition, email)
    assert send(client(app_url), "POST", f"/api/track/{token}/withdraw", json={}).status_code == 200
    by_candidate = [e for e in audit(app_url, target_id=application["id"]) if e["actor"] == "candidate"]
    assert len(by_candidate) == 1
    dumped = json.dumps(audit(app_url, target_id=application["id"]), ensure_ascii=False)
    assert email not in dumped and APPLICANT_NAME not in dumped


def test_wf_access_governance_journey(browser: Browser, app_url: str) -> None:
    clear_grants(app_url, INES, "approver")
    first = act(app_url, TOMAS, new_news(app_url, author=TOMAS), "submit")
    second = act(app_url, TOMAS, new_news(app_url, author=TOMAS), "submit")
    ines = console(app_url, INES)
    context, page = staff_page(browser, app_url, ADA)
    page.goto("/console/grants")
    form = page.get_by_role("form", name="Grant a role")
    form.get_by_role("textbox", name="Staff email").fill(INES)
    choose(form.get_by_role("combobox", name="Role"), "approver", "Approver")
    expires = form.get_by_role("textbox", name="Expires (London)")
    for spelling in ("2030-01-01T09:00", "2030-01-01T09:00:00", "2030-01-01 09:00", "1 January 2030 09:00",
                     "01/01/2030 09:00"):
        expires.fill(spelling)
        form.get_by_role("button", name="Grant role").click()
        with contextlib.suppress(AssertionError):
            expect(console_status(page)).to_have_text("Role granted.", timeout=5_000)
            break
    expect(console_status(page)).to_have_text("Role granted.")
    approved = ines.call("POST", f"/api/console/content/{first['id']}/approve", {}, version=first["version"])
    assert approved.status_code == 200
    page.reload()
    page.get_by_role("table", name="Grants").get_by_role("button", name=f"Revoke {'approver'} for {INES}").click()
    expect(console_status(page)).to_have_text("Role revoked.")
    refused = ines.call("POST", f"/api/console/content/{second['id']}/approve", {}, version=second["version"])
    assert refused.status_code == 403 and refused.json() == FORBIDDEN
    page.goto("/console/audit")
    page.get_by_role("button", name="Verify chain").click()
    expect(console_status(page)).to_have_text(re.compile(r"^Audit chain verified: \d+ entries\.$"))
    granted = next(g for g in grants(app_url) if g["staff_email"] == INES and g["role"] == "approver"
                   and g["status"] == "revoked" and is_staff(g["revoked_by"], ADA))
    grant_actions = {(e["action"], e["actor"]) for e in audit(app_url, target_id=granted["id"])}
    assert {("grant.create", ADA), ("grant.revoke", ADA)} <= grant_actions
    assert ("content.approve", INES) in {(e["action"], e["actor"]) for e in audit(app_url, target_id=first["id"])}
    context.close()


def test_signin_lockout(app_url: str) -> None:
    stranger = fresh_email("stranger")
    with spawned(TRUST_FORWARDED_FOR="true") as base:
        http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)

        def attempt(email: str, password: str = "not-the-password") -> httpx.Response:
            return http.post("/api/console/session", json={"email": email, "password": password},
                             headers={"X-Forwarded-For": forwarded()})

        for _ in range(LOCKOUT_FAILURES):
            known, unknown = attempt(NOOR), attempt(stranger)
            assert known.status_code == unknown.status_code == 401 and known.json() == unknown.json()
        locked = {email: attempt(email, PASSWORD) for email in (NOOR, stranger)}
        for response in locked.values():
            seconds = int(response.headers["Retry-After"])
            assert response.status_code == 429 and 1 <= seconds <= LOCKOUT_S
            assert response.json() == {
                "error": "signin_locked",
                "message": f"Too many failed sign-ins for this email. Try again in {seconds} seconds."}
        assert locked[NOOR].json()["error"] == locked[stranger].json()["error"]
        unlock = now() + dt.timedelta(seconds=max(int(r.headers["Retry-After"]) for r in locked.values()))
        still = attempt(NOOR)
        assert still.status_code == 429
        assert int(still.headers["Retry-After"]) <= int(locked[NOOR].headers["Retry-After"])
        wait_until_instant(unlock + dt.timedelta(seconds=1), "first lock end")
        for email in (NOOR, stranger):
            attempt(email)
            relocked = attempt(email)
            assert relocked.status_code == 429 and LOCKOUT_S < int(relocked.headers["Retry-After"]) <= 2 * LOCKOUT_S
        wait_until_instant(now() + dt.timedelta(seconds=int(relocked.headers["Retry-After"]) + 1), "second lock end")
        assert attempt(NOOR, PASSWORD).status_code == 200


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def test_audit_chain(app_url: str) -> None:
    new_news(app_url)
    entries = sorted(audit(app_url, limit=100), key=lambda e: e["seq"])
    for previous, entry in zip(entries, entries[1:]):
        assert entry["seq"] == previous["seq"] + 1 and entry["prev_hash"] == previous["hash"]
    for entry in entries:
        if entry["seq"] == 1:
            assert entry["prev_hash"] == "0" * 64
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", entry["at"])
        assert isinstance(entry["target_id"], str)
        fields = {k: entry[k] for k in ("seq", "at", "actor", "action", "target_type", "target_id", "detail")}
        digest = hashlib.sha256((entry["prev_hash"] + "\n" + canonical(fields)).encode("utf-8")).hexdigest()
        assert entry["hash"] == digest, entry["seq"]

    def agree() -> bool:
        verify = console(app_url, ADA).call("GET", "/api/console/audit/verify").json()
        head = audit(app_url, limit=1)[0]
        count = Postgres().rows("select count(*)::int as n from audit_entries")[0]["n"]
        assert verify["valid"] is True
        return verify["entries"] == head["seq"] == count and verify["head"] == head["hash"]

    poll(agree, SLACK_S * 5, "verify, head and table agree")


def test_wf_search_and_history_record_as_of(browser: Browser, app_url: str) -> None:
    moment = "2026-09-01T00:00:00Z"
    later_moment = "2026-10-01T00:00:00Z"
    news = get(app_url, "/api/public/news", params={"as_of": moment}).json()
    assert instant(news["as_of"]) == instant(moment) and news["total"] == 4
    assert {i["slug"] for i in news["items"]} == {"how-we-sign-off-a-release", "why-every-score-links-to-a-row",
                                                   "an-update-on-corvane-group", "introducing-kestrel-1"}
    assert {f["value"]: f["count"] for f in news["facets"]["subjects"]} == \
        {"research": 1, "safety": 1, "policy": 1, "company": 1}
    assert [m["slug"] for m in get(app_url, "/api/public/models", params={"as_of": moment}).json()["items"]] == ["kestrel-1"]
    hidden = get(app_url, f"/api/public/models/{KESTREL2}", params={"as_of": moment})
    never = get(app_url, f"/api/public/models/{fresh_slug('never')}", params={"as_of": moment})
    assert hidden.status_code == 404 and hidden.content == never.content and hidden.json() == NOT_PUBLISHED
    later = get(app_url, f"/api/public/news/{INTRO_K2}", params={"as_of": later_moment}).json()
    assert later["linked_model"] == {"slug": KESTREL2, "title": "Kestrel 2"}
    for bad in ("2999-01-01T00:00:00Z", "2026-09-01"):
        response = get(app_url, "/api/public/news", params={"as_of": bad})
        assert response.status_code == 422
        assert response.json()["fields"]["as_of"] == "Choose a past instant in the form YYYY-MM-DDTHH:mm:ssZ."
    post = published_news(app_url)
    after = instant(post["published_at"]).replace(microsecond=0) + dt.timedelta(seconds=1)
    wait_until_instant(after, "an instant after publication")
    act(app_url, ELENI, content_get(app_url, post["id"]), "withdraw")
    stamp = iso(after)
    assert post["slug"] not in [i["slug"] for i in all_news(app_url, as_of=stamp)]
    gone = get(app_url, f"/api/public/news/{post['slug']}", params={"as_of": stamp})
    assert gone.status_code == 410 and gone.json() == GONE_ITEM
    context = browser.new_context()
    page = context.new_page()
    page.goto(f"{app_url}/news?{urlencode({'as_of': moment})}")
    banner = page.get_by_role("region", name="Record as of")
    expect(banner).to_contain_text(
        f"You are reading the record as it stood at {london_text(instant(moment))} London.")
    current = banner.get_by_role("link", name="Read the current record")
    expect(current).to_be_visible()
    assert "as_of" not in (current.get_attribute("href") or "")
    page.get_by_role("navigation", name="Subjects").get_by_role(
        "link", name=facet_name(news["facets"]["subjects"], "safety")).click()
    wait_query(page, as_of=moment, subject="safety")
    context.close()


def test_ranked_search(app_url: str) -> None:
    word = fresh_word()
    title_hit = published_news(app_url, title=f"Ledger {word}", body="## Notes\nA plain paragraph.")
    summary_hit = published_news(app_url, summary=f"A note on the {word} ledger.")
    body_hit = published_news(app_url, body=f"## Notes\nThe {word} appears near the harbour {ESCAPE_PROBE}.")
    found = search_all(app_url, word)
    assert [i["slug"] for i in found] == [title_hit["slug"], summary_hit["slug"], body_hit["slug"]]
    assert found[0]["rank"] > found[1]["rank"] > found[2]["rank"]
    highlight = found[2]["highlight"]
    assert f"<mark>{word}</mark>" in highlight and ESCAPE_PROBE not in highlight
    assert ESCAPE_PROBE in html.unescape(highlight.replace("<mark>", "").replace("</mark>", ""))
    assert "<mark>" not in found[0]["highlight"]
    assert [i["slug"] for i in search_all(app_url, f"{word} -harbour")] == [title_hit["slug"], summary_hit["slug"]]
    assert [i["slug"] for i in search_all(app_url, f'"the {word} appears"')] == [body_hit["slug"]]
    assert search_all(app_url, word, kind="role") == [] and search_all(app_url, word, kind="poem") == []
    seen = {(i["kind"], i["slug"]) for i in search_all(app_url, "evaluation")}
    assert seen == EVALUATION_HITS
    paged = search_all(app_url, "evaluation", limit=2)
    assert [(i["kind"], i["slug"]) for i in paged] == [(i["kind"], i["slug"]) for i in search_all(app_url, "evaluation")]
    first = get(app_url, "/api/public/search", params={"q": word, "limit": 1}).json()
    act(app_url, ELENI, content_get(app_url, body_hit["id"]), "withdraw")
    rest = search_all(app_url, word, limit=1, cursor=first["next_cursor"])
    assert [i["slug"] for i in first["items"] + rest] == [title_hit["slug"], summary_hit["slug"]]
    foreign = get(app_url, "/api/public/search", params={"q": "evaluation", "cursor": first["next_cursor"]})
    assert foreign.status_code == 422
    assert foreign.json()["fields"]["cursor"] == "This cursor does not belong to this search."
    for params, field, message in (({"q": word, "limit": 0}, "limit", "Choose a limit from 1 to 50."),
                                   ({"q": word, "limit": 51}, "limit", "Choose a limit from 1 to 50."),
                                   ({"q": ""}, "q", "Enter between 1 and 200 characters."),
                                   ({"q": "a" * 201}, "q", "Enter between 1 and 200 characters.")):
        response = get(app_url, "/api/public/search", params=params)
        assert response.status_code == 422 and response.json()["fields"][field] == message


def test_wf_search_and_history_journey(browser: Browser, app_url: str) -> None:
    first = get(app_url, "/api/public/search", params={"q": SEARCH_TERM, "limit": SEARCH_PAGE_LIMIT}).json()
    second = get(app_url, "/api/public/search", params={"q": SEARCH_TERM, "limit": SEARCH_PAGE_LIMIT,
                                                        "cursor": first["next_cursor"]}).json()
    context = browser.new_context()
    page = context.new_page()
    page.goto(app_url + "/search")
    page.get_by_role("searchbox", name="Search terms").fill(SEARCH_TERM)
    page.get_by_role("button", name="Search").click()
    wait_query(page, q=SEARCH_TERM)
    results = page.get_by_role("list", name="Search results")
    expect(results.get_by_role("listitem")).to_have_count(SEARCH_PAGE_LIMIT)
    assert_in_order(results.inner_text(), [i["title"] for i in first["items"]])
    page.get_by_role("link", name="More results").click()
    page.wait_for_url(lambda url: parse_qs(urlparse(url).query).get("q") == [SEARCH_TERM]
                      and bool(parse_qs(urlparse(url).query).get("cursor", [""])[0]))
    assert "limit" not in parse_qs(urlparse(page.url).query)
    expect(results.get_by_role("listitem")).to_have_count(2)
    expect(page.get_by_role("link", name="More results")).to_have_count(0)
    shared = browser.new_context()
    other = shared.new_page()
    other.goto(page.url)
    assert_in_order(other.get_by_role("list", name="Search results").inner_text(), [i["title"] for i in second["items"]])
    page.go_back()
    wait_query(page, cursor=None)
    expect(results.get_by_role("listitem")).to_have_count(SEARCH_PAGE_LIMIT)
    poll(lambda: in_order(results.inner_text(), [i["title"] for i in first["items"]]), UI_TIMEOUT_MS / 1000,
         "Back restores the first page of results")
    page.get_by_role("navigation", name="Kinds").get_by_role("link", name="News").click()
    wait_query(page, kind="news", cursor=None)
    expect(results.get_by_role("listitem")).to_have_count(3)
    expect(page.get_by_role("link", name="More results")).to_have_count(0)
    assert context.cookies() == [] and shared.cookies() == []
    context.close()
    shared.close()


def _burst(request: Callable[[int], httpx.Response], limit: int) -> list[httpx.Response]:
    def opening() -> list[httpx.Response] | None:
        first = request(0)
        fresh = first.status_code != 429 and first.headers.get("RateLimit-Remaining") == str(limit - 1)
        return [first] if fresh else None

    seen = poll(opening, RATE_WINDOW_S + SLACK_S * 3, "a fresh rate-limit window", 1.0)
    for index in range(1, limit + 1):
        response = request(index)
        seen.append(response)
        if response.status_code == 429:
            break
    return seen


def _assert_limited(seen: list[httpx.Response], limit: int, what: str) -> None:
    last = seen[-1]
    assert last.status_code == 429, f"{what}: no 429 within {limit + 1} requests"
    retry = last.headers.get("Retry-After")
    assert retry == last.headers.get("RateLimit-Reset") and int(retry) >= 1
    assert last.json() == {"error": "rate_limited", "message": f"Too many requests. Try again in {retry} seconds."}
    served = seen[:-1]
    assert all(r.headers.get("RateLimit-Limit") == str(limit) for r in served), what
    remaining = [int(r.headers["RateLimit-Remaining"]) for r in served]
    if remaining:
        assert remaining[-1] == 0 and all(b == a - 1 for a, b in zip(remaining, remaining[1:])), what


def test_shared_rate_limits(app_url: str) -> None:
    with spawned(TRUST_FORWARDED_FOR="true") as one, spawned(TRUST_FORWARDED_FOR="true") as two:
        raw = [httpx.Client(base_url=b, timeout=HTTP_TIMEOUT_S) for b in (one, two)]
        cookie = Console(one, NOOR).cookie_header()
        unknown_item = str(uuid.uuid4())
        peer = {name: {"X-Forwarded-For": forwarded()} for name in ("public", "candidate", "sign-in")}
        checks = {
            "public": (lambda i: raw[i % 2].get("/api/public/benefits", headers=peer["public"]), PUBLIC_LIMIT),
            "candidate": (lambda i: raw[i % 2].post("/api/careers/tracking-links",
                                                    json={"email": fresh_email("burst")},
                                                    headers=peer["candidate"]), CANDIDATE_LIMIT),
            "sign-in": (lambda i: raw[i % 2].post("/api/console/session",
                                                  json={"email": fresh_email("burst"), "password": "wrong"},
                                                  headers=peer["sign-in"]), SIGNIN_LIMIT),
            "console": (lambda i: raw[i % 2].post(f"/api/console/content/{unknown_item}/comments",
                                                  json={"body": "x"},
                                                  headers={"Cookie": cookie, "X-Forwarded-For": forwarded()}),
                        CONSOLE_WRITE_LIMIT),
        }
        for what, (request, limit) in checks.items():
            _assert_limited(_burst(request, limit), limit, what)
        health = raw[0].get("/api/health")
        assert health.status_code == 200 and "RateLimit-Limit" not in health.headers


def test_idempotent_writes(app_url: str, mail: Mailpit) -> None:
    item = new_news(app_url)
    kofi = console(app_url, KOFI)
    key = idempotency_key()
    path = f"/api/console/content/{item['id']}/comments"
    first = kofi.call("POST", path, {"body": "Check the dates."}, key=key)
    replay = kofi.call("POST", path, {"body": "Check the dates."}, key=key)
    assert first.status_code == replay.status_code == 201 and first.json() == replay.json()
    assert replay.headers.get("Idempotency-Replayed") == "true"
    assert [c["body"] for c in content_get(app_url, item["id"])["comments"]] == ["Check the dates."]
    reused = kofi.call("POST", path, {"body": "Different."}, key=key)
    assert reused.status_code == 409 and reused.json() == {
        "error": "idempotency_key_reused", "message": "This Idempotency-Key was already used for a different request."}
    for bad in ("x" * 256, "spaced key", "tab\tkey"):
        response = kofi.call("POST", path, {"body": "Probe."}, key=bad)
        assert response.status_code == 422 and response.json() == {
            "error": "invalid_idempotency_key",
            "message": "Idempotency-Key must be 1 to 255 visible ASCII characters."}
    submitted = act(app_url, INES, new_news(app_url), "submit")
    approve_key = idempotency_key()
    once = console(app_url, ELENI).call("POST", f"/api/console/content/{submitted['id']}/approve", {},
                                        version=submitted["version"], key=approve_key)
    twice = console(app_url, ELENI).call("POST", f"/api/console/content/{submitted['id']}/approve", {},
                                         version=submitted["version"], key=approve_key)
    assert once.status_code == twice.status_code == 200 and once.json() == twice.json()
    assert content_get(app_url, submitted["id"])["version"] == submitted["version"] + 1
    requisition = new_requisition(app_url)
    email = fresh_email("idem")
    pdf = make_pdf()
    application_key = idempotency_key()
    a = apply(app_url, requisition["slug"], "Rowan Ellery", email, pdf, key=application_key)
    b = apply(app_url, requisition["slug"], "Rowan Ellery", email, pdf, key=application_key)
    assert a.status_code == b.status_code == 201 and a.json() == b.json()
    assert b.headers.get("Idempotency-Replayed") == "true"
    conflict = apply(app_url, requisition["slug"], "Rowan Ellery", fresh_email("idem"), pdf, key=application_key)
    assert conflict.status_code == 409 and conflict.json()["error"] == "idempotency_key_reused"
    await_mail(mail, email, "Application received")
    assert len(distinct(settled(mail, email, "Application received"))) == 1


def test_many_instances_one_platform(app_url: str) -> None:
    other, third = mailpit_down(), minio_down()
    tomas = Console(other, TOMAS)
    cookie = {"Cookie": tomas.cookie_header()}
    for base in (app_url, third):
        assert httpx.get(base + "/api/console/me", headers=cookie, timeout=HTTP_TIMEOUT_S).status_code == 200
    created = tomas.call("POST", "/api/console/content", {
        "kind": "news", "slug": fresh_slug("news"), "title": "Cross-instance note", "summary": "A short note.",
        "body": "## Overview\nA plain paragraph.", "subject": "company", "tags": ["field-notes"]})
    assert created.status_code == 201
    item = created.json()["content"]
    assert content_get(app_url, item["id"])["version"] == item["version"]
    key = idempotency_key()
    path = f"/api/console/content/{item['id']}/comments"
    headers = {**cookie, "Idempotency-Key": key}
    first = httpx.post(app_url + path, json={"body": "Shared."}, headers=headers, timeout=HTTP_TIMEOUT_S)
    again = httpx.post(third + path, json={"body": "Shared."}, headers=headers, timeout=HTTP_TIMEOUT_S)
    assert first.status_code == again.status_code == 201 and first.json() == again.json()
    assert again.headers.get("Idempotency-Replayed") == "true"
    clash = httpx.post(other + path, json={"body": "Other."}, headers=headers, timeout=HTTP_TIMEOUT_S)
    assert clash.status_code == 409
    assert httpx.delete(app_url + "/api/console/session", headers=cookie, timeout=HTTP_TIMEOUT_S).status_code == 204
    for base in (other, third):
        assert httpx.get(base + "/api/console/me", headers=cookie, timeout=HTTP_TIMEOUT_S).status_code == 401


JOB_KEYS = {"id", "kind", "state", "attempts", "refusals", "last_error", "next_attempt_at", "created_at", "finished_at"}
REFUSAL_PROBES = 5
REFUSAL_ROUNDS = 4


@contextlib.contextmanager
def refusing_smtp() -> Iterator[int]:
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(16)

    def serve(conn: socket.socket) -> None:
        with contextlib.suppress(OSError), conn, conn.makefile("rb") as reader:
            conn.sendall(b"220 refusing stub\r\n")
            for raw in reader:
                verb = raw[:4].upper()
                if verb == b"QUIT":
                    conn.sendall(b"221 bye\r\n")
                    return
                if verb in (b"RCPT", b"DATA"):
                    conn.sendall(b"550 5.7.1 refused\r\n")
                else:
                    conn.sendall(b"250 OK\r\n")

    def accept() -> None:
        for _ in range(SMTP_MAX_CONNECTIONS):
            try:
                conn, _ = listener.accept()
            except OSError:
                return
            threading.Thread(target=serve, args=(conn,), daemon=True).start()

    thread = threading.Thread(target=accept, daemon=True)
    thread.start()
    try:
        yield listener.getsockname()[1]
    finally:
        with contextlib.suppress(OSError):
            listener.shutdown(socket.SHUT_RDWR)
        listener.close()
        thread.join(timeout=HTTP_TIMEOUT_S)


def test_wf_platform_operations_job_queue(browser: Browser, app_url: str, mail: Mailpit) -> None:
    started = now() - dt.timedelta(seconds=SLACK_S)
    admin = console(app_url, ADA)
    requisition = new_requisition(app_url)
    applied_with_token(app_url, mail, requisition)
    emails: list[str] = []

    def dead_refused() -> list[dict[str, Any]]:
        jobs = admin.call("GET", "/api/console/jobs", params={"kind": "mail", "state": "dead"}).json()["jobs"]
        return [j for j in jobs if j["last_error"] == "mail_refused" and instant(j["created_at"]) >= started]

    with refusing_smtp() as port, spawned(SMTP_HOST="127.0.0.1", SMTP_PORT=str(port), JOB_MAX_ATTEMPTS="1",
                                         OUTBOX_RETRY_SECONDS="1",
                                         TRUST_FORWARDED_FOR="true") as copy:
        dead: list[dict[str, Any]] = []
        for _ in range(REFUSAL_ROUNDS):
            for email in (fresh_email("refused") for _ in range(REFUSAL_PROBES)):
                emails.append(email)
                response = send(client(copy), "POST", f"/api/careers/roles/{requisition['slug']}/applications",
                                data={"name": "Rowan Ellery", "email": email, "consent": "yes"},
                                files={"resume": ("resume.pdf", make_pdf(), "application/pdf")},
                                headers={"X-Forwarded-For": forwarded()})
                assert response.status_code == 201, response.text
            with contextlib.suppress(AssertionError):
                dead = poll(dead_refused, MAIL_DEADLINE_S / REFUSAL_ROUNDS, "a refused mail job in the dead list", 1.0)
            if dead:
                break
        assert dead, "no refused mail job reached the dead list"
    job = dead[0]
    assert JOB_KEYS <= set(job) and job["kind"] == "mail" and job["state"] == "dead"
    assert job["refusals"] == 1 and job["attempts"] >= 1
    listed = admin.call("GET", "/api/console/jobs").json()["jobs"]
    assert all(JOB_KEYS <= set(j) for j in listed)
    dumped = json.dumps(listed)
    assert not any(email in dumped for email in emails) and "resumes/" not in dumped
    assert all(j["last_error"] in (None, "mail_unreachable", "mail_refused", "storage_unreachable", "storage_refused")
               for j in listed)
    done = poll(lambda: admin.call("GET", "/api/console/jobs", params={"state": "done"}).json()["jobs"],
                MAIL_DEADLINE_S, "a done job in the done list", 1.0)
    assert all(j["state"] == "done" for j in done)
    refused = admin.call("POST", f"/api/console/jobs/{done[0]['id']}/retry", {})
    assert refused.status_code == 409 and refused.json() == {
        "error": "job_not_dead", "message": "Only dead jobs can be retried."}
    context, page = staff_page(browser, app_url, ADA)
    page.goto("/console/jobs")
    page.get_by_role("navigation", name="Job states").get_by_role("link", name="Dead").click()
    with page.expect_response(lambda r: r.url.endswith(f"/api/console/jobs/{job['id']}/retry")) as info:
        page.get_by_role("button", name=f"Retry job {job['id']}").click()
    expect(console_status(page)).to_have_text("Job queued for retry.")
    assert info.value.status == 200
    retried = info.value.json()["job"]
    assert retried["id"] == job["id"] and retried["state"] == "pending"
    assert retried["attempts"] == 0 and retried["refusals"] == 0
    retries = [e for e in audit(app_url, target_id=str(job["id"])) if e["action"] == "job.retry"]
    assert len(retries) == 1 and retries[0]["actor"] == ADA

    def delivered() -> bool:
        jobs = admin.call("GET", "/api/console/jobs", params={"kind": "mail", "state": "done"}).json()["jobs"]
        return any(j["id"] == job["id"] for j in jobs)

    poll(delivered, MAIL_DEADLINE_S, "retried job delivered", 1.0)
    context.close()


def test_wf_platform_operations_readiness(browser: Browser, app_url: str) -> None:
    def ready(base: str, expected: dict[str, Any]) -> None:
        def matches() -> bool:
            response = httpx.get(base + "/api/ready", timeout=HTTP_TIMEOUT_S)
            return response.status_code == 200 and response.json() == expected
        poll(matches, READY_LAG_S + SLACK_S, f"readiness on {base}", 1.0)

    ready(app_url, {"status": "ready", "dependencies": {"database": "up", "storage": "up", "mail": "up"},
                    "degraded_features": []})
    ready(minio_down(), {"status": "degraded", "dependencies": {"database": "up", "storage": "down", "mail": "up"},
                         "degraded_features": ["applications", "resume_downloads", "samples"]})
    ready(mailpit_down(), {"status": "degraded", "dependencies": {"database": "up", "storage": "up", "mail": "down"},
                           "degraded_features": ["mail_delivery"]})
    for base in (minio_down(), mailpit_down()):
        assert get(base, "/api/public/news").status_code == 200 and get(base, "/").status_code == 200
    banners = {minio_down(): "File storage is unreachable. Applications, résumé downloads and samples are paused.",
               mailpit_down(): "Mail delivery is delayed. Messages are queued and will be sent when mail returns."}
    for base, copy in banners.items():
        context, page = staff_page(browser, base, ADA)
        expect(page.get_by_role("status", name="Service status")).to_contain_text(copy)
        context.close()
    context, page = staff_page(browser, app_url, ADA)
    quiet = page.get_by_role("status", name="Service status")
    poll(lambda: quiet.count() == 0 or not (quiet.first.text_content() or "").strip(), UI_TIMEOUT_MS / 1000,
         "an empty service status")
    context.close()


VERSION_CASES = ["content", "application", "requisition", "grant"]


@pytest.mark.parametrize("case", VERSION_CASES, ids=VERSION_CASES)
def test_versions_on_editable_records(app_url: str, case: str) -> None:
    if case == "content":
        record = new_news(app_url)
        who, path, body, read = INES, f"/api/console/content/{record['id']}", {"title": "Edited"}, \
            f"/api/console/content/{record['id']}"
        method = "PATCH"
    elif case == "application":
        requisition = new_requisition(app_url)
        email = fresh_email("version")
        assert apply(app_url, requisition["slug"], "Rowan Ellery", email).status_code == 201
        record = application_for(app_url, SANA, requisition, email)
        who, method, path, body = SANA, "POST", f"/api/console/applications/{record['id']}/stage", \
            {"to": "screening", "rationale": "Strong."}
        read = f"/api/console/applications/{record['id']}"
    elif case == "requisition":
        record = new_requisition(app_url, open_it=False)
        who, method, path, body = SANA, "POST", f"/api/console/requisitions/{record['id']}/open", {}
        read = f"/api/console/requisitions/{record['id']}"
    else:
        record = grant(app_url, NOOR, "editor", now() + dt.timedelta(days=30))
        who, method, path, body, read = ADA, "POST", f"/api/console/grants/{record['id']}/revoke", {}, None
    actor = console(app_url, who)
    if read:
        fetched = actor.call("GET", read)
        assert fetched.headers.get("ETag") == f'"{record["version"]}"'
    missing = actor.call(method, path, body)
    assert missing.status_code == 428 and missing.json() == VERSION_REQUIRED
    stale = actor.call(method, path, body, version=record["version"] + 5)
    assert stale.status_code == 412 and stale.json() == STALE
    done = actor.call(method, path, body, version=record["version"])
    assert done.status_code == 200, done.text
    body = done.json()
    candidates = [body] + [value for value in body.values() if isinstance(value, dict)]
    assert any(c.get("version") == record["version"] + 1 for c in candidates), body


PUBLIC_PATHS = ["/", "/models", f"/models/{KESTREL2}", "/news", f"/news/{INTRO_K2}", f"/search?q={SEARCH_TERM}",
                "/careers", f"/careers/{POLICY_ROLE}"]


def test_wf_cross_cutting_cookie_free(browser: Browser, app_url: str) -> None:
    unknown_token = uuid.uuid4().hex
    api_paths = ["/api/public/home", "/api/public/models", "/api/public/news", f"/api/public/search?q={SEARCH_TERM}",
                 "/api/public/roles", "/api/public/benefits", f"/api/public/models/{KESTREL2}", "/feed.xml",
                 "/sitemap.xml", f"/api/track/{unknown_token}"]
    for path in PUBLIC_PATHS + api_paths:
        assert "Set-Cookie" not in get(app_url, path).headers, path
    sample = get(app_url, f"/api/public/models/{KESTREL2}").json()["samples"][0]["urls"][0]
    assert "Set-Cookie" not in get(app_url, sample).headers
    context = browser.new_context()
    page = context.new_page()
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    foreign: list[str] = []
    setters: list[str] = []
    page.on("request", lambda r: foreign.append(r.url)
            if r.url.startswith("http") and not same_origin(r.url, origin) else None)
    page.on("response", lambda r: setters.append(r.url) if r.header_value("Set-Cookie") else None)
    for path in PUBLIC_PATHS:
        page.goto(app_url + path)
        page.wait_for_load_state("networkidle")
    assert foreign == [] and setters == [] and context.cookies() == []
    context.close()


def test_run_manifest_and_health(app_url: str) -> None:
    health = get(app_url, "/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    home = get(app_url, "/api/public/home").json()
    assert [(t["number"], t["heading"]) for t in home["theses"]] == list(enumerate(THESES, start=1))
    kestrel = get(app_url, f"/api/public/models/{KESTREL2}").json()
    assert kestrel["title"] == "Kestrel 2" and instant(kestrel["published_at"]) == instant("2026-09-30T08:00:00Z")
    assert {(r["subject"], r["benchmark"], r["score"]) for r in kestrel["rows"]} >= {
        ("kestrel-2", "ReasonBench-Hard", "71.4"), ("halvard-3", "ReasonBench-Hard", "68.2")}
    me = console(app_url, ADA).call("GET", "/api/console/me").json()
    assert me["name"] == "Ada Penrose"


def test_server_boundary(app_url: str) -> None:
    item = new_news(app_url)
    kofi = console(app_url, KOFI)
    path = f"/api/console/content/{item['id']}/comments"
    cross = kofi.call("POST", path, {"body": "Probe."}, headers={"Origin": "https://elsewhere.example"})
    assert cross.status_code == 403 and cross.json() == {"error": "cross_origin",
                                                         "message": "Requests must come from this site."}
    assert content_get(app_url, item["id"])["comments"] == []

    def raw_json(size: int) -> httpx.Response:
        prefix, suffix = '{"body":"', '"}'
        payload = prefix + "a" * (size - len(prefix) - len(suffix)) + suffix
        return send(kofi.http, "POST", path, content=payload.encode(),
                    headers={"Content-Type": "application/json", "Idempotency-Key": idempotency_key()})

    assert raw_json(JSON_MAX_BYTES).status_code not in (413, 415)
    too_big = raw_json(JSON_MAX_BYTES + 1)
    assert too_big.status_code == 413 and too_big.json() == {"error": "payload_too_large",
                                                             "message": "That request is too large."}
    wrong = send(kofi.http, "POST", path, content=b"body=x", headers={"Content-Type": "text/plain"})
    assert wrong.status_code == 415 and wrong.json() == {"error": "unsupported_media_type",
                                                         "message": "Send this request as JSON."}
    requisition = new_requisition(app_url)
    as_json = send(client(app_url), "POST", f"/api/careers/roles/{requisition['slug']}/applications",
                   json={"name": "Rowan Ellery"})
    assert as_json.status_code == 415 and as_json.json()["message"] == "Send this request as a multipart form."
    boundary = "verifierboundary"

    def multipart(total: int) -> httpx.Response:
        head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\nRowan\r\n--{boundary}\r\n"
                f"Content-Disposition: form-data; name=\"resume\"; filename=\"cv.pdf\"\r\n"
                f"Content-Type: application/pdf\r\n\r\n").encode()
        tail = f"\r\n--{boundary}--\r\n".encode()
        body = head + b"%PDF-" + b"0" * (total - len(head) - len(tail) - 5) + tail
        return send(client(app_url), "POST", f"/api/careers/roles/{requisition['slug']}/applications", content=body,
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})

    assert multipart(MULTIPART_MAX_BYTES).status_code != 413
    assert multipart(MULTIPART_MAX_BYTES + 1).status_code == 413
    for secret in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json",
                   "/src/server.ts", "/media/samples/%2e%2e/%2e%2e/package.json"):
        response = get(app_url, secret)
        assert response.status_code == 404, secret
        assert "DATABASE_URL" not in response.text and "S3_SECRET" not in response.text
    page = get(app_url, "/")
    assert page.headers.get("X-Content-Type-Options") == "nosniff"
    assert page.headers.get("Content-Security-Policy", "").strip()
    assert get(app_url, "/api/public/home").headers.get("X-Content-Type-Options") == "nosniff"


VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layout(browser: Browser, app_url: str, size: str) -> None:
    width, height = VIEWPORTS[size]

    def check(page: Page) -> None:
        layout(page)
        for role in ("button", "textbox", "combobox", "searchbox"):
            for control in page.get_by_role(role).all():
                if control.is_visible():
                    box = control.bounding_box()
                    if box and box["width"] > 1 and box["height"] > 1:
                        assert box["width"] >= TAP_TARGET_PX and box["height"] >= TAP_TARGET_PX, \
                            (page.url, role, control.get_attribute("aria-label"), box)

    context = browser.new_context(viewport={"width": width, "height": height})
    page = context.new_page()
    for path in PUBLIC_PATHS:
        page.goto(app_url + path)
        check(page)
    page.goto(app_url + "/")
    menu = page.get_by_role("button", name="Menu", exact=True)
    if width < 720:
        expect(menu).to_have_attribute("aria-expanded", "false")
        menu.click()
        expect(menu).to_have_attribute("aria-expanded", "true")
    page.goto(app_url + "/console/sign-in")
    check(page)
    context.close()
    staff_context, staff = staff_page(browser, app_url, ADA, viewport={"width": width, "height": height})
    for path in ("/console", "/console/grants", "/console/audit", "/console/jobs"):
        staff.goto(path)
        check(staff)
    staff_context.close()


def test_wf_cross_cutting_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    context = browser.new_context()
    page = context.new_page()
    page.goto(app_url + "/")
    primary = ["Thesis", "Models", "Newsroom", "Search", "Careers"]
    order = tab_order(page, len(primary) + FREE_CONTROLS + 1)
    assert order[0] == "Skip to content" and set(primary) <= set(order[1:]), order
    spots = sorted(order.index(name) for name in primary)
    assert spots[0] <= FREE_CONTROLS + 1 and spots[-1] - spots[0] < len(primary) + FREE_CONTROLS, order
    newsroom = page.get_by_role("navigation", name="Primary").get_by_role("link", name="Newsroom")
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    rest = newsroom.evaluate(FOCUS_LOOK_JS)
    newsroom.focus()
    assert newsroom.evaluate(FOCUS_LOOK_JS) != rest
    models = page.get_by_role("navigation", name="Primary").get_by_role("button", name="Models")
    models.focus()
    page.keyboard.press("Enter")
    expect(models).to_have_attribute("aria-expanded", "true")
    page.keyboard.press("Escape")
    expect(models).to_have_attribute("aria-expanded", "false")
    expect(models).to_be_focused()
    page.goto(f"{app_url}/search?q={SEARCH_TERM}")
    order = tab_order(page, 12 + FREE_CONTROLS)
    expected_order = ["Search terms", "Search", "All kinds", "Models", "News", "Roles"]
    assert "Search terms" in order, order
    start = order.index("Search terms")
    assert order[start:start + len(expected_order)] == expected_order, order
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("/")
    expect(page.get_by_role("searchbox", name="Search terms")).to_be_focused()
    requisition = new_requisition(app_url)
    email, token = applied_with_token(app_url, mail, requisition)
    headroom(app_url, "candidate", 4)
    page.goto(f"{app_url}/track/{token}")
    opener = page.get_by_role("button", name="Withdraw application")
    opener.click()
    dialog = page.get_by_role("dialog", name="Withdraw application?")
    expect(dialog.get_by_role("button", name="Keep my application")).to_be_focused()
    for _ in range(5):
        page.keyboard.press("Tab")
        assert dialog.evaluate("(el) => el.contains(document.activeElement)")
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()
    expect(opener).to_be_focused()
    assert get(app_url, f"/api/track/{token}").json()["stage"] == "submitted"
    context.close()


def test_section_reveals(browser: Browser, app_url: str) -> None:
    route = f"{app_url}/models/{KESTREL2}"
    with open_app(browser, route) as page:
        page.set_viewport_size({"width": 1280, "height": SHORT_VIEWPORT_PX})
        page.add_init_script(MOTION_RECORDER)
        page.reload()
        states = page.evaluate(REVEAL_STATES_JS)
        assert states and states[-1] == "pending", states
        page.evaluate(RESET_MOTION_JS)
        page.evaluate(REVEAL_LAST_JS)
        deadline = time.monotonic() + SLACK_S * 5
        for _ in range(REVEAL_MAX_STEPS):
            advance(page, 16)
            reveals = [m for m in recorded(page) if m["reveal"] and m["duration"] > 0]
            if any(lasts(m, REVEAL_MIN_MS, REVEAL_MAX_MS) for m in reveals) or time.monotonic() > deadline:
                break
        assert any(lasts(m, REVEAL_MIN_MS, REVEAL_MAX_MS) for m in reveals), [m["duration"] for m in reveals]
        until(page, f"() => ({REVEAL_STATES_JS})().includes('done')")
    with open_app(browser, route, reduced_motion="reduce") as page:
        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        advance(page, REDUCED_SETTLE_MS)
        states = page.evaluate(REVEAL_STATES_JS)
        assert states and all(state == "done" for state in states), states


def test_scroll_linked_and_staggered_motion(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        theses = page.get_by_role("list", name="Theses")
        span = page.evaluate("() => document.documentElement.scrollHeight - innerHeight")
        positions = [round(span * step / 10) for step in range(11)]

        def sample(position: int) -> tuple[float, int]:
            page.evaluate("(y) => window.scrollTo(0, y)", position)
            advance(page, 50)
            value = theses.get_attribute("data-thesis-progress") or ""
            assert re.fullmatch(r"[01]\.\d\d", value), value
            current = theses.evaluate(
                "(el) => [...el.children].findIndex((c) => c.getAttribute('data-current') === 'true')")
            return float(value), current

        forward = [sample(p) for p in positions]
        backward = [sample(p) for p in reversed(positions)]
        values = [v for v, _ in forward]
        assert values == sorted(values) and values[-1] > values[0]
        assert [v for v, _ in backward] == sorted((v for v, _ in backward), reverse=True)
        currents = [c for _, c in forward if c >= 0]
        assert currents == sorted(currents) and len(set(currents)) > 1
    with open_app(browser, f"{app_url}/models/{KESTREL2}") as page:
        page.set_viewport_size({"width": 1280, "height": SHORT_VIEWPORT_PX})
        page.add_init_script(MOTION_RECORDER)
        page.reload()
        figure = page.get_by_role("figure", name="Benchmark results")
        expect(figure).to_have_attribute("data-entered", "false")
        page.evaluate(RESET_MOTION_JS)
        figure.scroll_into_view_if_needed()
        advance(page, CHART_ENTRY_ADVANCE_MS)
        until(page, "() => document.querySelector('[data-entered]')?.dataset.entered === 'true'")
        order = figure.evaluate(ROW_ORDER_JS)

        def started() -> dict[str, dict[str, Any]] | None:
            first: dict[str, dict[str, Any]] = {}
            for record in recorded(page):
                if record["row"] in order and record["duration"] > 0 and record["row"] not in first:
                    first[record["row"]] = record
            return first if set(first) == set(order) else None

        first = poll(started, (len(order) * STAGGER_MAX_MS + BAR_MAX_MS) / 1000 + SLACK_S, "every bar starts its entry")
        starts = [(r["real"] if r["kind"] == "css-animation" else r["fake"] + r["delay"]) for r in
                  (first[row] for row in order)]
        slack = FRAME_MS if any(first[row]["kind"] in ("css-animation", "frames") for row in order) else 0
        for gap in (b - a for a, b in zip(starts, starts[1:])):
            assert STAGGER_MIN_MS - slack <= gap <= STAGGER_MAX_MS + slack, starts
        for row in order:
            assert lasts(first[row], BAR_MIN_MS, BAR_MAX_MS), first[row]
    with open_app(browser, f"{app_url}/models/{KESTREL2}", reduced_motion="reduce") as page:
        figure = page.get_by_role("figure", name="Benchmark results")
        figure.scroll_into_view_if_needed()
        advance(page, REDUCED_SETTLE_MS)
        settle_to(page, lambda: figure.get_attribute("data-entered"), "true", "reduced-motion chart entry",
                  REDUCED_SETTLE_MS / 1000 + SLACK_S)


VIEW_TRANSITION_JS = """() => document.getAnimations()
  .filter((a) => String(a.effect && a.effect.pseudoElement || '').includes('view-transition'))
  .map((a) => Number(a.effect.getComputedTiming().duration) || 0)"""


def test_list_to_detail_continuity(browser: Browser, app_url: str) -> None:
    for reduced in ("no-preference", "reduce"):
        context = browser.new_context(reduced_motion=reduced)
        context.add_init_script(MOTION_RECORDER)
        page = context.new_page()
        page.goto(app_url + "/models")
        durations: list[float] = []
        title_motion: dict[tuple[float, float, str], dict[str, Any]] = {}
        page.get_by_role("main").get_by_role("link", name=re.compile("Kestrel 2")).first.click()

        def sample() -> None:
            with contextlib.suppress(Exception):
                durations.extend(page.evaluate(VIEW_TRANSITION_JS))
            with contextlib.suppress(Exception):
                for m in recorded(page):
                    if m["duration"] > 0 and (m["heading"] or ("Kestrel 2" in m["title"]
                                                               and len(m["title"]) <= TITLE_WRAPPER_CHARS)):
                        title_motion[(m["real"], m["fake"], m["kind"] + m["title"])] = m

        def arrived() -> bool:
            sample()
            return page.get_by_role("heading", name="Kestrel 2", exact=True).first.is_visible()

        poll(arrived, SLACK_S * 5, "detail heading", 0.02)
        sample()
        if reduced == "reduce":
            assert all(d < FRAME_MS for d in durations), durations
            assert all(m["duration"] < CONTINUITY_MIN_MS for m in title_motion.values()), title_motion
        else:
            def continuity() -> list[float]:
                sample()
                return [d for d in durations if CONTINUITY_MIN_MS <= d <= CONTINUITY_MAX_MS] + [
                    m for m in title_motion.values() if lasts(m, CONTINUITY_MIN_MS, CONTINUITY_MAX_MS)]

            poll(continuity, SLACK_S * 5, f"title motion in range {durations} {title_motion}", 0.02)
        page.go_back()
        expect(page.get_by_role("main").get_by_role("link", name=re.compile("Kestrel 2")).first).to_be_visible()
        context.close()


TOOL_DIRS = {"scripts", "tools", "config", "bin", ".husky"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".turbo"}
LICENCE_WORDS = {"MIT", "ISC", "BSD", "APACHE", "OPEN FONT LICENSE", "OPEN FONT LICENCE", "CC0"}


def _ignore_patterns() -> list[str]:
    ignore = APP_ROOT / ".gitignore"
    lines = ignore.read_text().splitlines() if ignore.exists() else []
    return [line.strip() for line in lines if line.strip() and not line.strip().startswith(("#", "!"))]


def _generated_dirs() -> set[str]:
    names = set(SKIP_DIRS)
    for entry in (e.strip("/") for e in _ignore_patterns()):
        if entry and not any(c in entry for c in "*?["):
            names.add(entry.split("/")[-1])
    for config in APP_ROOT.glob("tsconfig*.json"):
        with contextlib.suppress(Exception):
            out = json.loads(re.sub(r"(?m)^\s*//.*$", "", config.read_text()))
            names.add(Path(out["compilerOptions"]["outDir"]).name)
    return names


def _ignored(path: Path) -> bool:
    relative = path.relative_to(APP_ROOT).as_posix()
    for pattern in _ignore_patterns():
        anchored = pattern.startswith("/") or "/" in pattern.rstrip("/")
        pattern = pattern.strip("/")
        if fnmatch.fnmatch(relative, pattern) or (not anchored and fnmatch.fnmatch(path.name, pattern)):
            return True
    return False


def _source_files() -> Iterator[Path]:
    skip = _generated_dirs()
    for root, dirs, files in os.walk(APP_ROOT):
        dirs[:] = [d for d in dirs if d not in skip]
        for name in files:
            if not _ignored(Path(root, name)):
                yield Path(root, name)


LICENCE_SPELLINGS = {"APACHE 2.0": "Apache-2.0", "APACHE-2": "Apache-2.0", "APACHE LICENSE 2.0": "Apache-2.0",
                     "APACHE LICENSE, VERSION 2.0": "Apache-2.0", "BSD": "BSD-3-Clause", "BSD-3": "BSD-3-Clause",
                     "BSD-2": "BSD-2-Clause", "MIT LICENSE": "MIT", "MIT/X11": "MIT", "CC0": "CC0-1.0",
                     "OFL": "OFL-1.1"}
def licence_expression(value: str) -> str:
    text_ = str(value or "").strip()
    return LICENCE_SPELLINGS.get(text_.upper(), text_)


def _shipped_packages() -> dict[str, str]:
    return {p.name: licence_expression(p.licence) for p in shipped_packages(APP_ROOT)}


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest.get(field), str) and manifest[field].strip()


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name in _shipped_packages() if name not in notices]
    assert missing == []
    for asset in bundled_assets():
        assert asset in notices, asset


def bundled_assets() -> list[str]:
    assets = ["Newsreader", "Instrument Sans", "JetBrains Mono"]
    uses_icons = any("lucide" in name.lower() for name in _shipped_packages()) or any(
        "lucide" in p.read_text(errors="ignore").lower() for p in _source_files() if p.suffix in (".ts", ".tsx", ".css"))
    return assets + (["Lucide"] if uses_icons else [])


def test_if_licences() -> None:
    bad = {name: licence for name, licence in _shipped_packages().items() if not licence_allowed(licence, ALLOWED_LICENCES)}
    assert bad == {}
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text().splitlines()

    def names_allowed(block: str) -> bool:
        upper = block.upper()
        return any(licence.upper() in upper for licence in ALLOWED_LICENCES) or any(w in upper for w in LICENCE_WORDS)

    heading = re.compile(r"^\s*#")
    for asset in bundled_assets():
        blocks = []
        for i, line in enumerate(notices):
            if asset in line:
                above = next((notices[j] for j in range(i, -1, -1) if heading.match(notices[j])), "")
                blocks.append("\n".join([above, *notices[i:i + 8]]))
        assert any(names_allowed(block) for block in blocks), asset


def test_if_no_extra_datastore() -> None:
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "leveldown", "lmdb", "lokijs", "nedb", "@seald-io/nedb", "lowdb", "keyv", "node-cache", "lru-cache-fs"}
    direct = json.loads((APP_ROOT / "package.json").read_text()).get("dependencies") or {}
    assert forbidden & set(direct) == set()


def test_if_service_config_untouched() -> None:
    assert Postgres().rows("select 1 as one") == [{"one": 1}]
    assert isinstance(S3().keys("samples/"), list)
    assert mail_from_address()


def test_if_typescript_only() -> None:
    package = json.loads((APP_ROOT / "package.json").read_text())
    runs = " ".join([str(package.get("main") or "")] + [str(v) for k, v in (package.get("scripts") or {}).items()
                                                          if k in ("start", "dev", "serve")])

    def configuration(p: Path) -> bool:
        if re.search(r"(config|rc|setup|file)\.[cm]?jsx?$", p.name, re.IGNORECASE) or p.name.startswith("."):
            return True
        if any(p.with_suffix(ts).exists() for ts in (".ts", ".tsx", ".mts", ".cts")):
            return True
        parts = [part.lower() for part in p.relative_to(APP_ROOT).parts[:-1]]
        return (not parts or parts[0] in TOOL_DIRS) and p.name not in runs

    stray = [str(p) for p in _source_files() if p.suffix in (".js", ".mjs", ".cjs", ".jsx")
             and not configuration(p)]
    assert stray == []
    assert any(p.suffix in (".ts", ".tsx") for p in _source_files())


def test_if_generated_media() -> None:
    def sample_shaped(p: Path) -> bool:
        lowered = p.name.lower()
        return p.suffix.lower() in (".wav", ".pdf") or re.fullmatch(r"frame-\d\d\.png", lowered) is not None \
            or "samples" in {part.lower() for part in p.relative_to(APP_ROOT).parts[:-1]}

    media = [str(p) for p in _source_files() if sample_shaped(p) and p.suffix.lower() in
             (".wav", ".mp3", ".ogg", ".flac", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf")]
    assert media == []
