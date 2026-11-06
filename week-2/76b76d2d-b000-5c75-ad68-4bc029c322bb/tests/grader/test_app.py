from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, time as dtime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import parse_qs, urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    AXE,
    CLOCK_START,
    DEPLOYED_APP,
    HERE,
    Postgres,
    addresses,
    advance,
    click,
    fill,
    held,
    idempotency_key,
    open_app,
    same_origin,
    select,
    tab_order,
    text as mail_text,
    unique,
)


TORONTO = ZoneInfo("America/Toronto")
LOCAL_FMT = "%Y-%m-%dT%H:%M"
APP_PORT = 4173
PRICES = {"regular": 1400, "reduced": 1100, "member": 1000, "member-guest": 1200, "group": 950}
FARE_LABELS = {"regular": ("Regular", "Ordinaire"), "reduced": ("Reduced (student, 65+)", "Réduit (étudiant, 65 ans et plus)"), "member": ("Member", "Membre"), "member-guest": ("Member guest", "Invité de membre"), "group": ("Group", "Groupe")}
TIER_LABELS = {"friend": ("Friend", "Ami"), "cinephile": ("Cinephile", "Cinéphile"), "projectionist": ("Projectionist", "Projectionniste")}
STAFF = {"finance": ("finance@halide.example", "Reel-Finance-2026!"), "door": ("door@halide.example", "Reel-Door-2026!"), "programmer": ("programmer@halide.example", "Reel-Programme-2026!")}
MH2_SEATS = [f"{row}{n}" for row in "ABCD" for n in range(1, 7)]
MH2_CAPACITY = 24
MH1_GROUP_SEATS = [f"A{n}" for n in range(1, 15)] + ["B1", "B2", "B3"]
MH1_CAPACITY = 140
AC1_CAPACITY = 48
GROUP_TOTAL = 18569
FSTOPS = ["22", "16", "11", "8", "5.6", "4", "2.8", "2", "1.4"]
SEGMENT_PX = 1000
DEEP_LINK_P = 700
ACTIVATION_P = 300
STAGE_ATTRS = ["data-segment", "data-iris-open", "data-iris-rotation", "data-iris-radius", "data-fstop", "data-rail-visible", "data-tint-mix", "data-renderer", "data-context"]
SEAT_TOLERANCE_PX = 2
MIN_TARGET_PX = 44
EDGE_PAD_PX = 8
REDUCED_MOTION_MAX_MS = 10
TRANSITION_MIN_MS = 240
TRANSITION_MAX_MS = 320
RESTORE_MAX_S = 1
NOTICE_S = 10
STEPUP_RESPONSE_S = 5
RESEND_SPACING_S = 30
RETRY_DELAYS_S = (5, 15, 45)
RETRY_EVERY_S = 60
RETRY_SLACK_S = 3
CHECKIN_OPENS = timedelta(minutes=45)
NAME_MAX = 80
BODY_LIMIT = 16384
CSV_HEADER = "kind,reference,occurred_at,patron_name,note,admission,gst,qst,uplift,gift,membership,credit_spent,paid,refunded"
DESKTOP = {"width": 1280, "height": 800}
VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}
NARROW_WIDTH = 768
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
FONTS = ["Instrument Serif", "Inter", "IBM Plex Mono"]
FORBIDDEN_DATASTORES = ["sqlite3", "better-sqlite3", "redis", "ioredis", "mongodb", "mongoose", "lowdb", "nedb", "level"]
CDN_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com"]
INTERNAL_HOSTS = ["killbill", "mailpit", "postgres", "127.0.0.1", "localhost"]
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")

STAGE_NAME = {"en": "Programme stage", "fr": "Scène du programme"}
STEPUP_SUBJECT = {"en": "Your Halide verification code", "fr": "Votre code de vérification Halide"}
BILLING_NOTICE = {"en": "Billing is temporarily unavailable. You can browse the programme, but booking, membership changes and refunds are paused.", "fr": "La facturation est temporairement indisponible. Vous pouvez consulter le programme, mais les réservations, les changements d'adhésion et les remboursements sont suspendus."}
MAIL_NOTICE = {"en": "Email delivery is delayed. Confirmations will be sent automatically when it recovers.", "fr": "L'envoi des courriels est retardé. Les confirmations seront envoyées automatiquement à son rétablissement."}
MAIL_DELAYED = "Email is delayed. It will be sent automatically when our mail service returns."
NOT_FOUND = {"en": "This page or record doesn't exist.", "fr": "Cette page ou cette fiche n'existe pas."}
UNAUTHENTICATED = {"en": "Please sign in to continue.", "fr": "Connectez-vous pour continuer."}
FORBIDDEN = {"en": "Your role can't do this.", "fr": "Votre rôle ne permet pas cette action."}
CROSS_ORIGIN = {"en": "This request must come from the Halide site.", "fr": "Cette requête doit provenir du site Halide."}
BODY_TOO_LARGE = {"en": "The request is too large.", "fr": "La requête est trop volumineuse."}
UNSUPPORTED = {"en": "Send the request as JSON.", "fr": "Envoyez la requête en JSON."}
INVALID_JSON = {"en": "The request body isn't valid JSON.", "fr": "Le corps de la requête n'est pas un JSON valide."}
VALIDATION = {"en": "Some fields need attention.", "fr": "Certains champs sont à corriger."}
REQUIRED = {"en": "Required.", "fr": "Obligatoire."}
BILLING_UNAVAILABLE = {"en": "Billing is temporarily unavailable. Nothing was charged or changed. Please try again in a few minutes.", "fr": "La facturation est temporairement indisponible. Rien n'a été facturé ni modifié. Réessayez dans quelques minutes."}
UPLIFT_MSG = {"en": "Enter an uplift between $1.00 and $500.00.", "fr": "Entrez une contribution entre 1,00 $ et 500,00 $."}
CREDIT_MSG = "Enter a credit between $1.00 and $500.00."
FARE_MSG = "This fare isn't available for this seat."
HOLD_EXPIRED_MSG = "Your seat hold has expired and the seats are back on sale. Choose your seats again."
REFUND_CLOSED_MSG = "Refunds close 2 hours before showtime. The box office can offer a goodwill credit."
PATHS = {
    "programme": "/<locale>/",
    "screening": "/<locale>/screenings/<screening id>",
    "checkout": "/<locale>/checkout/<hold id>",
    "guest": "/<locale>/b/<token>",
    "account": "/<locale>/account",
    "membership": "/<locale>/membership",
    "redeem": "/<locale>/gift/<token>",
    "staff": "/<locale>/staff",
}
FARE_BUTTON = "Fare for seat <seat>: <fare label>"
PAYER_NAME = "Payer name <n>"
PAYER_SEATS = "Seats for payer <n>"
TIER_LINE_FR = "Palier : "
SEAT_TAKEN_MSG = "Just taken by another patron: <seats>. Choose other seats."
ILLEGAL_MSG = "A season can't move from <from> to <to>."
LENGTH_MSG = "Use <min> to <max> characters."
SCREENINGS_ADDED = "<n> screenings added."
OPEN_ENQUIRY = "Open <ref>"
WITHDRAWN_MSG = "Season withdrawn. <n> bookings refunded."
REASON_LINE = "Reason: "
REPLY_KEY = "enquiry-reply:<enquiry ref>:<n>"
LOCALE_ROUTE = "/locale/<en|fr>"
CSV_TYPE = "text/csv; charset=utf-8"

WORKED = {
    "worked-example-1": {"fares": ["regular", "regular", "reduced"], "uplift": 0, "member": False, "admission": 3900, "gst": 195, "qst": 389, "total": 4484},
    "worked-example-2": {"fares": ["member", "member-guest"], "uplift": 500, "member": True, "admission": 2200, "gst": 110, "qst": 220, "total": 3030},
}
SPLIT_CASES = {"6-6-5": [[6, 6, 5], [6554, 6554, 5461]], "5-6-6": [[5, 6, 6], [5461, 6554, 6554]]}
DST_CASES = {
    "weekly-across-fall-back": ["2026-10-20T19:00", 4, ["2026-10-20T19:00:00-04:00", "2026-10-27T19:00:00-04:00", "2026-11-03T19:00:00-05:00", "2026-11-10T19:00:00-05:00"]],
    "repeated-hour": ["2026-11-01T01:30", 1, ["2026-11-01T01:30:00-04:00"]],
    "missing-hour": ["2027-03-14T02:30", 1, ["2027-03-14T03:30:00-04:00"]],
}
RECON_DAYS = {"fall-back-day": ["2026-11-01", 25], "spring-forward-day": ["2027-03-14", 23], "booking-day": [None, None]}
EVIL_NEXT = "/" * 2 + "evil.example/x"
TOO_LONG_NEXT = "/en/" + "a" * 600
NEXT_CASES = {
    "safe-path": ["/en/membership", True],
    "protocol-relative": [EVIL_NEXT, False],
    "backslash": ["/\\evil.example", False],
    "scheme": ["https://evil.example/", False],
    "encoded-slashes": ["/%2F%2Fevil.example", False],
    "ctrl-char": ["/en/%0Aaccount", False],
    "too-long": [TOO_LONG_NEXT, False],
}
ROLE_CASES = {
    "door-on-finance-credits": ["door", "POST", "/api/finance/credits"],
    "programmer-on-finance-audit": ["programmer", "GET", "/api/finance/audit"],
    "patron-on-finance-refund": ["patron", "POST", "/api/finance/bookings/HB-ZZZZZZ/refund"],
    "patron-on-enquiry-reply": ["patron", "POST", "/api/finance/enquiries/EQ-ZZZZZZ/reply"],
    "finance-on-door-screenings": ["finance", "GET", "/api/door/screenings"],
    "programmer-on-door-checkin": ["programmer", "POST", "/api/door/tickets/T-ZZZZZZZZ/check-in"],
    "door-on-programmer-seasons": ["door", "POST", "/api/programmer/seasons"],
    "finance-on-programmer-transition": ["finance", "POST", "/api/programmer/seasons/SLUG/transition"],
    "finance-on-patron-membership": ["finance", "GET", "/api/membership"],
}
MENU_CASES = ["billing-cadence", "fare"]
NEXT_CASE_IDS = ["safe-path", "protocol-relative", "backslash", "scheme", "encoded-slashes", "ctrl-char", "too-long"]


HTTP_TIMEOUT_S = 30
POLL_INTERVAL_S = 0.5
UI_WAIT_S = 20
CHECKOUT_WAIT_S = 40
MAIL_WAIT_S = 90
STEPUP_MAIL_S = 15
KB_WAIT_S = 30
APP_BOOT_S = 180
RETRY_OBSERVE_S = 150
CLOCK_STEP_MS = 100
NOTICE_STEP_MS = 500
COUNTDOWN_SLACK_S = 10
MIDNIGHT_GUARD_S = 180
TAB_LIMIT = 60
LOG_TAIL_CHARS = 4000
RELAY_CHUNK = 65536
NPM_TIMEOUT_S = 300
RACE_CLIENTS = 6
FAST_HOLD_TTL_S = 45
FAST_CODE_TTL_S = 45
FAST_VALID_S = 20
FAST_LOCKOUT_S = 150
PROBE_SERVER_TZ = "Pacific/Kiritimati"
PROBE_BROWSER_TZ = "Asia/Tokyo"
PATRON_PASSWORD = "Probe-Pass-2026!"
FILM_A = "Probe Ambre"
FILM_B = "Probe Lanterne"
REASON = "Probe reason for the audit list"
FORMULA_NAME = "=SUM(1+1) Probe"
FORMULA_NOTE = "@probe note"
SCRUB_POSITIONS = [125, 275, 450, 600, 760, 820, 950]
QUIET_DAY = "2026-01-15"
UNKNOWN_BOOKING = "HB-ZZZZZZ"
UNKNOWN_GIFT = "HG-ZZZZZZ"
UNKNOWN_ACCOUNT = "A-999999"
JUNK_TOKEN = "Z" * 43
EVIL_ORIGIN = "https://evil.example"
PROBE_PHONE = "+1 514 555 0100"
CARDHOLDER = "Probe Cardholder"
RELAY_REPLY = "Probe relay reply"
REPLY_TEXT = "Probe reply from the box office"
EXTRA_PURCHASE_CENTS = 1400
RESTORE_MARGIN_S = 5
KB_AUTHOR = "halide-verifier"

APP_DIR = Path("/app")


def norm(value: str) -> str:
    return value.replace("\u00a0", " ").replace("\u202f", " ")


def money(cents: int, locale: str = "en") -> str:
    whole, frac = divmod(cents, 100)
    if locale == "en":
        return f"${whole:,}.{frac:02d}"
    return f"{whole:,}".replace(",", " ") + f",{frac:02d} $"


def dollars(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def fmt(template: str, **values: Any) -> str:
    for key, value in values.items():
        template = template.replace(f"<{key.replace('_', ' ')}>", str(value))
    return template


def path(name: str, locale: str = "en", **values: Any) -> str:
    return fmt(PATHS[name], locale=locale, **values)


def link_re(name: str, locale: str = "(?:en|fr)") -> str:
    return PATHS[name].replace("<locale>", locale).replace("<token>", "([A-Za-z0-9_-]{43})")


def plan(tier: str, kind: str) -> str:
    return f"{tier}-{kind}"


def illegal(source: str, target: str) -> str:
    return ILLEGAL_MSG.replace("<from>", source).replace("<to>", target)


def name_re(value: str) -> re.Pattern[str]:
    return re.compile("^" + re.escape(value).replace("\\ ", r"[\s\u00a0\u202f]") + "$")


def taxes(subtotal: int) -> tuple[int, int]:
    return (subtotal * 5 + 50) // 100, (subtotal * 9975 + 50000) // 100000


def expected_total(fares: list[str], uplift: int = 0) -> int:
    total = uplift
    for fare, quantity in Counter(fares).items():
        subtotal = PRICES[fare] * quantity
        gst, qst = taxes(subtotal)
        total += subtotal + gst + qst
    return total


def cents(value: Any) -> int:
    return int((Decimal(str(value)) * 100).to_integral_value())


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


def poll(fn: Callable[[], Any], seconds: float, what: str = "condition") -> Any:
    deadline = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}")
        threading.Event().wait(POLL_INTERVAL_S)


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def error(response: httpx.Response) -> dict[str, Any]:
    return response.json()["error"]


class Api:
    def __init__(self, base: str, locale: str | None = "en") -> None:
        self.base = base
        self.locale = locale
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S, follow_redirects=False)

    def request(self, method: str, path: str, body: Any = None, *, key: str | None = None, headers: dict[str, str] | None = None, params: dict[str, Any] | None = None) -> httpx.Response:
        h: dict[str, str] = {}
        if self.locale:
            h["X-Halide-Locale"] = self.locale
        if key:
            h["Idempotency-Key"] = key
        h.update(headers or {})
        if body is None:
            return self.http.request(method, path, headers=h, params=params)
        return self.http.request(method, path, json=body, headers=h, params=params)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.request("POST", path, {} if body is None else body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("DELETE", path, **kw)


def person(prefix: str) -> tuple[str, str]:
    token, email = unique(prefix)
    return f"Probe {token}"[:NAME_MAX], email


def signup(base: str, locale: str = "en", prefix: str = "patron") -> SimpleNamespace:
    name, email = person(prefix)
    api = Api(base, locale)
    r = api.post("/api/auth/signup", {"name": name, "email": email, "password": PATRON_PASSWORD, "locale": locale})
    assert r.status_code == 201, r.text
    account = r.json()["account"]
    return SimpleNamespace(api=api, account=account, number=account["number"], email=email, name=name, locale=locale)


def staff(base: str, role: str, locale: str = "en") -> Api:
    api = Api(base, locale)
    email, password = STAFF[role]
    r = api.post("/api/auth/signin", {"email": email, "password": password})
    assert r.status_code == 200, r.text
    return api


def member(base: str, tier: str = "friend", cadence: str = "annual", locale: str = "en") -> SimpleNamespace:
    p = signup(base, locale)
    r = p.api.post("/api/membership", {"tier": tier, "cadence": cadence})
    assert r.status_code == 201, r.text
    p.join = r.json()
    return p


def goodwill(base: str, number: str, amount: int) -> dict[str, Any]:
    r = staff(base, "finance").post("/api/finance/credits", {"account_number": number, "amount_cents": amount, "reason": REASON})
    assert r.status_code == 201, r.text
    return r.json()["credit"]


def server_now(base: str) -> datetime:
    r = httpx.get(f"{base}/api/status", timeout=HTTP_TIMEOUT_S)
    return iso(r.json()["checked_at"]).astimezone(TORONTO)


def clear_of_midnight(base: str) -> None:
    now = server_now(base)
    left = (datetime.combine(now.date() + timedelta(days=1), dtime(0), TORONTO).astimezone(timezone.utc) - now.astimezone(timezone.utc)).total_seconds()
    if left < MIDNIGHT_GUARD_S:
        poll(lambda: server_now(base).date() > now.date(), left + 30, "past Toronto midnight")


def toronto_today(base: str) -> date:
    return server_now(base).date()


def far_local(base: str, days: int, hour: int = 19, minute: int = 0) -> datetime:
    return datetime.combine(toronto_today(base) + timedelta(days=days), dtime(hour, minute))


def soon_local(base: str, delta: timedelta) -> datetime:
    moment = (server_now(base).astimezone(timezone.utc) + delta).astimezone(TORONTO)
    return moment.replace(second=0, microsecond=0, tzinfo=None)


def new_slug() -> str:
    return "p" + uuid.uuid4().hex[:10]


def create_season(base: str, *, sale_offset_days: int, screenings: list[tuple[str, str, datetime]], schedule: bool = True, slug: str | None = None) -> SimpleNamespace:
    prog = staff(base, "programmer")
    slug = slug or new_slug()
    sale = toronto_today(base) + timedelta(days=sale_offset_days)
    title_en, title_fr = f"Probe {slug}", f"Essai {slug}"
    r = prog.post("/api/programmer/seasons", {"slug": slug, "title_en": title_en, "title_fr": title_fr, "public_sale_date": sale.isoformat()})
    assert r.status_code == 201, r.text
    ids = []
    for film, auditorium, local in screenings:
        r = prog.post(f"/api/programmer/seasons/{slug}/screenings", {"film_title": film, "format": "35mm", "auditorium": auditorium, "first_local": local.strftime(LOCAL_FMT), "weeks": 1})
        assert r.status_code == 201, r.text
        ids.append(r.json()["screenings"][0]["id"])
    if schedule:
        r = prog.post(f"/api/programmer/seasons/{slug}/transition", {"to": "scheduled"})
        assert r.status_code == 200, r.text
    return SimpleNamespace(slug=slug, title_en=title_en, title_fr=title_fr, ids=ids, sale=sale, starts=[s[2] for s in screenings], prog=prog)


def on_sale(base: str, auditorium: str = "MH2", days: int = 200, film: str = FILM_A) -> SimpleNamespace:
    return create_season(base, sale_offset_days=-5, screenings=[(film, auditorium, far_local(base, days))])


def make_hold(api: Api, screening_id: str, seats: list[str], group: bool = False) -> dict[str, Any]:
    r = api.post("/api/holds", {"screening_id": screening_id, "seats": seats, "group": group})
    assert r.status_code == 201, r.text
    return r.json()["hold"]


def checkout_body(hold: dict[str, Any], fares: dict[str, str], *, uplift: int = 0, guest: dict[str, str] | None = None, cardholder: str = CARDHOLDER, note: str = "", split: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"hold_id": hold["id"], "fares": fares, "uplift_cents": uplift, "cardholder_name": cardholder, "note": note}
    if guest:
        body["guest"] = guest
    if split:
        body["split"] = split
    return body


def guest_checkout(base: str, sid: str, seats: list[str], *, locale: str = "en", fares: list[str] | None = None, uplift: int = 0, note: str = "", name: str | None = None, email: str | None = None, phone: str | None = None) -> SimpleNamespace:
    api = Api(base, locale)
    gname, gemail = person("guest")
    name, email = name or gname, email or gemail
    hold = make_hold(api, sid, seats)
    guest = {"name": name, "email": email}
    if phone:
        guest["phone"] = phone
    fare_map = dict(zip(seats, fares or ["regular"] * len(seats)))
    r = api.post("/api/checkout", checkout_body(hold, fare_map, uplift=uplift, note=note, guest=guest), key=idempotency_key())
    assert r.status_code == 201, r.text
    data = r.json()
    return SimpleNamespace(api=api, booking=data["booking"], link=data["guest_link"], token=data["guest_link"].rsplit("/", 1)[1], email=email, name=name, hold=hold)


def patron_checkout(p: SimpleNamespace, sid: str, seats: list[str], fares: list[str], uplift: int = 0) -> dict[str, Any]:
    hold = make_hold(p.api, sid, seats)
    r = p.api.post("/api/checkout", checkout_body(hold, dict(zip(seats, fares)), uplift=uplift), key=idempotency_key())
    assert r.status_code == 201, r.text
    return r.json()["booking"]


def wait_status(base: str, field: str, value: str, seconds: float = NOTICE_S) -> None:
    poll(lambda: httpx.get(f"{base}/api/status", timeout=HTTP_TIMEOUT_S).json()[field] == value, seconds, f"status {field}={value}")


def mail_body(message: dict[str, Any]) -> str:
    return norm(mail_text(message))


def mail_to(mail: Any, address: str, subject: str | None = None) -> list[dict[str, Any]]:
    found = []
    for m in mail.messages():
        if address.lower() not in [a.lower() for a in addresses(m.get("To"))]:
            continue
        if subject is not None and subject not in norm(m.get("Subject", "")):
            continue
        found.append(m)
    return found


def await_mail(mail: Any, address: str, subject: str | None = None, count: int = 1, seconds: float = MAIL_WAIT_S, exclude: set[Any] | frozenset[Any] = frozenset()) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    while True:
        found = [m for m in mail_to(mail, address, subject) if m.get("ID") not in exclude]
        if len(found) >= count:
            return found
        if time.monotonic() > deadline:
            raise AssertionError(f"expected {count} email(s) to {address} with {subject!r}, saw {len(found)}")


def exactly_one(mail: Any, address: str, subject: str) -> dict[str, Any]:
    await_mail(mail, address, subject)
    found = mail_to(mail, address, subject)
    assert len(found) == 1, f"{len(found)} emails to {address} with {subject!r}"
    return found[0]


def code_in(message: dict[str, Any]) -> str:
    match = re.search(r"Code ?: (\d{6})", mail_body(message))
    assert match, mail_body(message)
    return match.group(1)


def seen_ids(mail: Any, address: str, subject: str) -> set[Any]:
    return {m.get("ID") for m in mail_to(mail, address, subject)}


def verify_stepup(p: SimpleNamespace, mail: Any, purpose: str = "checkout") -> dict[str, Any]:
    subject = STEPUP_SUBJECT[p.locale]
    seen = seen_ids(mail, p.email, subject)
    r = p.api.post("/api/stepup/start", {"purpose": purpose})
    assert r.status_code == 201, r.text
    code = code_in(await_mail(mail, p.email, subject, exclude=seen)[0])
    r = p.api.post("/api/stepup/verify", {"challenge_id": r.json()["challenge"]["id"], "code": code})
    assert r.status_code == 200, r.text
    return r.json()["stepup"]


def kb_account(killbill: Any, *, email: str | None = None, key: str | None = None) -> dict[str, Any]:
    return poll(lambda: killbill.account(email) if email else killbill.account_by_key(key), KB_WAIT_S, f"Kill Bill account {email or key}")


def kb_transactions(killbill: Any, account: dict[str, Any], kind: str) -> list[int]:
    found = []
    for payment in killbill.payments(account["accountId"]):
        for tx in payment.get("transactions", []):
            if tx.get("transactionType") == kind and tx.get("status") == "SUCCESS":
                found.append(cents(tx["amount"]))
    return found


def kb_request(method: str, path: str, body: Any = None, **params: str) -> Any:
    headers = {"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"], "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"], "Accept": "application/json"}
    if body is not None:
        headers["X-Killbill-CreatedBy"] = KB_AUTHOR
    r = httpx.request(method, os.environ["KILLBILL_URL"].rstrip("/") + path, params=params or None, json=body, headers=headers,
                      auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]), timeout=HTTP_TIMEOUT_S)
    assert r.status_code < 300, r.text
    return r.json() if r.content else None


def kb_invoices(account: dict[str, Any]) -> list[dict[str, Any]]:
    return kb_request("GET", f"/1.0/kb/accounts/{account['accountId']}/invoices", includeInvoiceComponents="true") or []


def kb_items(account: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for invoice in kb_invoices(account) for item in invoice.get("items") or []]


def kb_cba(account: dict[str, Any]) -> int:
    return cents(kb_request("GET", f"/1.0/kb/accounts/{account['accountId']}", accountWithBalanceAndCBA="true")["accountCBA"])


def assert_cba(account: dict[str, Any], expected: int) -> None:
    poll(lambda: kb_cba(account) == expected, KB_WAIT_S, f"Kill Bill account credit {expected}")


def kb_subscriptions(account: dict[str, Any]) -> list[dict[str, Any]]:
    bundles = kb_request("GET", f"/1.0/kb/accounts/{account['accountId']}/bundles") or []
    return [s for b in bundles for s in b.get("subscriptions") or []]


def assert_booking_invoice(account: dict[str, Any], booking: dict[str, Any]) -> None:
    ref = booking["ref"]
    mine = lambda item: (item.get("description") or "").startswith(ref + " ")
    invoices = [inv for inv in kb_invoices(account) if any(mine(it) for it in inv.get("items") or [])]
    assert len(invoices) == 1, f"{len(invoices)} Kill Bill invoices for {ref}"
    items = {it["description"]: (it["itemType"], cents(it["amount"])) for it in invoices[0]["items"] if mine(it)}
    expected: dict[str, tuple[str, int]] = {}
    for line in booking["lines"]:
        expected[f"{ref} ADM {line['fare']} x{line['quantity']}"] = ("EXTERNAL_CHARGE", line["subtotal_cents"])
        expected[f"{ref} GST {line['fare']}"] = ("TAX", line["gst_cents"])
        expected[f"{ref} QST {line['fare']}"] = ("TAX", line["qst_cents"])
    if booking["uplift_cents"]:
        expected[f"{ref} UPLIFT"] = ("EXTERNAL_CHARGE", booking["uplift_cents"])
    assert items == expected
    assert sum(amount for _, amount in items.values()) == booking["total_cents"]
    assert cents(invoices[0]["amount"]) == booking["total_cents"]


def ledger(pg: Any, number: str) -> list[dict[str, Any]]:
    return pg.rows(f"SELECT movement_id, ledger_account, amount_cents, kind, reference FROM credit_ledger WHERE account_number = '{number}'")


def assert_paired(rows: list[dict[str, Any]]) -> None:
    groups: dict[Any, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(row["movement_id"], []).append(row)
    for movement, pair in groups.items():
        assert len(pair) == 2, (movement, pair)
        assert sum(r["amount_cents"] for r in pair) == 0, pair


def member_balance(rows: list[dict[str, Any]]) -> int:
    return sum(r["amount_cents"] for r in rows if r["ledger_account"] == "member-credit")


def audit_rows(pg: Any, target: str) -> list[dict[str, Any]]:
    return pg.rows(f"SELECT id, at, actor, action, target, amount_cents, reason FROM audit_log WHERE target = '{target}' ORDER BY id")


def shown(loc: Any) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def attr(loc: Any, name: str) -> str | None:
    return loc.first.get_attribute(name) if loc.count() else None


def focused(loc: Any) -> bool:
    return loc.count() > 0 and bool(loc.first.evaluate("e => e === document.activeElement"))


MOTION_RECORDER = """(() => {
  const records = [];
  Object.defineProperty(window, '__probeMotion', {value: records});
  const note = (el, a) => records.push({el: (a && a.effect && a.effect.target) || el, d: Number(a && a.effect && a.effect.getTiming().duration) || 0});
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = animate.apply(this, args); note(this, a); return a; };
  for (const type of ['transitionrun', 'animationstart'])
    document.addEventListener(type, e => e.target.getAnimations({subtree: true}).forEach(a => note(e.target, a)), true);  // subtree includes ::before/::after
})();"""


GL_RECORDER = """(() => {
  const made = [];
  Object.defineProperty(window, '__probeGL', {value: made});
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const gl = get.call(this, kind, ...rest);
    if (gl && /webgl/.test(kind) && !made.includes(gl)) made.push(gl);
    return gl;
  };
})();"""


def fits(page: Any) -> None:
    wide = page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
    assert wide[0] <= wide[1] + 1, f"the page scrolls horizontally: {wide}"


@contextmanager
def mouse_page(browser: Any, url: str, reduced_motion: str = "no-preference") -> Any:
    context = browser.new_context(viewport=DESKTOP, has_touch=False, reduced_motion=reduced_motion, service_workers="block")
    try:
        context.add_init_script(path=str(HERE / "instrument.js"))
        context.add_init_script(MOTION_RECORDER)
        tab = context.new_page()
        tab.set_default_timeout(5000)
        tab.set_default_navigation_timeout(15000)
        tab.clock.install(time=CLOCK_START)
        tab.clock.pause_at(CLOCK_START + 10)
        tab.goto(url)
        yield tab
    finally:
        context.close()


def menu_motion(listbox: Any, opener: Any) -> list[float]:
    return listbox.first.evaluate(
        "(e, o) => { const near = []; for (let n = e.parentElement; n && n !== document.body && !n.contains(o); n = n.parentElement) near.push(n); "
        "return window.__probeMotion.filter(r => r.el === e || e.contains(r.el) || near.includes(r.el)).map(r => r.d); }",
        opener.first.element_handle())


def slide_motion(loc: Any) -> list[float]:
    return loc.first.evaluate("e => { const box = e.parentElement || e; return window.__probeMotion.filter(r => box.contains(r.el)).map(r => r.d); }")


def edge_change(loc: Any, state: str) -> tuple[bytes, bytes]:
    finish = "e => (e.parentElement || e).getAnimations({subtree: true}).forEach(a => { if (Number.isFinite(a.effect && a.effect.getComputedTiming().endTime)) a.finish(); })"
    page = loc.page
    page.mouse.move(0, 0)
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    loc.first.scroll_into_view_if_needed()
    loc.first.evaluate(finish)
    box, view = loc.first.bounding_box(), page.viewport_size
    x, y = max(0, box["x"] - EDGE_PAD_PX), max(0, box["y"] - EDGE_PAD_PX)
    clip = {"x": x, "y": y, "width": min(view["width"], box["x"] + box["width"] + EDGE_PAD_PX) - x, "height": min(view["height"], box["y"] + box["height"] + EDGE_PAD_PX) - y}
    rest = page.screenshot(clip=clip, animations="disabled")
    loc.hover() if state == "hover" else loc.focus()
    loc.first.evaluate(finish)
    return rest, page.screenshot(clip=clip, animations="disabled")


def axe_rules(page: Any, rules: list[str]) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate(
        """rules => { const result = {done: false, error: null, violations: []};
          Object.defineProperty(window, '__probeAxe', {value: () => structuredClone(result), configurable: true});
          axe.run(document, {runOnly: {type: 'rule', values: rules}}).then(v => {
            result.violations = v.violations.map(x => ({id: x.id, nodes: x.nodes.map(n => n.target)})); result.done = true;
          }, e => { result.error = String(e); result.done = true; }); }""", rules)
    eventually(page, lambda: page.evaluate("window.__probeAxe()")["done"], "axe settles")
    status = page.evaluate("window.__probeAxe()")
    assert status["error"] is None and not status["violations"], status


def holds_focus(loc: Any) -> bool:
    return loc.count() > 0 and bool(loc.first.evaluate(
        "e => { const a = document.activeElement; if (!a) return false; if (a === e || e.contains(a)) return true; "
        "const id = a.getAttribute('aria-activedescendant'); return !!id && document.getElementById(id) === e; }"))


def choose(page: Any, loc: Any) -> None:
    eventually(page, lambda: shown(loc), "control shown")
    if loc.is_checked():
        return
    hit = loc.first.evaluate(
        "e => { e.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'}); const r = e.getBoundingClientRect(); "
        "const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === e || e.contains(t)); }")
    if hit:
        click(loc)
    else:
        loc.first.focus()
        page.keyboard.press("Space")
    eventually(page, lambda: loc.is_checked(), "checked")


def press_in_place(loc: Any) -> None:
    loc.first.evaluate("e => e.focus({preventScroll: true})")
    loc.page.keyboard.press("Enter")


def text_in(loc: Any) -> str:
    return norm(loc.first.inner_text()) if loc.count() else ""


def body_text(page: Any) -> str:
    return norm(page.evaluate("() => document.body.innerText"))


def description(loc: Any) -> str:
    return norm(loc.first.evaluate("e => (e.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || '').join(' ')"))


def eventually(page: Any, predicate: Callable[[], bool], what: str, seconds: float = UI_WAIT_S, step_ms: float = CLOCK_STEP_MS) -> None:
    deadline = time.monotonic() + seconds
    while True:
        if predicate():
            return
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {seconds}s: {what}")
        advance(page, step_ms)


def tab_until(page: Any, loc: Any, key: str = "Tab", check: Callable[[Any], bool] = focused, limit: int = TAB_LIMIT) -> None:
    eventually(page, lambda: shown(loc), "control rendered before tabbing")
    for _ in range(limit):
        if check(loc):
            return
        page.keyboard.press(key)
    raise AssertionError("control never received keyboard focus")


def browser_call(page: Any, base: str, method: str, path: str, body: Any = None, locale: str = "en") -> Any:
    return page.request.fetch(f"{base}{path}", method=method, data=body, headers={"X-Halide-Locale": locale})


def browser_signin(page: Any, base: str, email: str, password: str = PATRON_PASSWORD) -> None:
    r = browser_call(page, base, "POST", "/api/auth/signin", {"email": email, "password": password})
    assert r.status == 200, r.text()


def browser_hold(page: Any, base: str, sid: str, seats: list[str], group: bool = False) -> dict[str, Any]:
    r = browser_call(page, base, "POST", "/api/holds", {"screening_id": sid, "seats": seats, "group": group})
    assert r.status == 201, r.text()
    return r.json()["hold"]


def seat(page: Any, code: str, locale: str = "en") -> Any:
    return page.get_by_role("gridcell", name=f"{'Seat' if locale == 'en' else 'Place'} {code}", exact=True)


def stage(page: Any, locale: str = "en") -> Any:
    return page.get_by_role("region", name=STAGE_NAME[locale], exact=True)


def stage_attrs(page: Any) -> dict[str, str | None]:
    region = stage(page)
    if not region.count():
        return {}
    return {name: region.first.get_attribute(name) for name in STAGE_ATTRS}


def iris_expected(p: float, diagonal: float, last: bool) -> dict[str, Any]:
    o = p / 400 if p < 400 else (1.0 if p < 700 else (1000 - p) / 300)
    v = 0.0 if p < 400 else ((p - 400) / 300 if p < 700 else (1000 - p) / 300)
    t = 0.0 if (p < 700 or last) else (p - 700) / 300
    return {"open": o, "rotation": 40 * o, "radius": (diagonal / 2) * (0.04 + 0.96 * o), "fstop": FSTOPS[min(8, math.floor(8 * o))], "rail": v, "tint": t}


def iris_matches(attrs: dict[str, str | None], exp: dict[str, Any], k: int) -> bool:
    try:
        return (
            attrs["data-segment"] == str(k)
            and abs(float(attrs["data-iris-open"] or "nan") - exp["open"]) <= 0.005
            and abs(float(attrs["data-iris-rotation"] or "nan") - exp["rotation"]) <= 0.2
            and abs(float(attrs["data-iris-radius"] or "nan") - exp["radius"]) <= 2
            and attrs["data-fstop"] == exp["fstop"]
            and abs(float(attrs["data-rail-visible"] or "nan") - exp["rail"]) <= 0.005
            and abs(float(attrs["data-tint-mix"] or "nan") - exp["tint"]) <= 0.005
        )
    except (KeyError, ValueError):
        return False


def scroll_to(page: Any, y: int) -> None:
    page.evaluate("y => window.scrollTo(0, y)", y)


def scroll_y(page: Any) -> int:
    return round(page.evaluate("() => window.scrollY"))


def diagonal(page: Any) -> float:
    return float(page.evaluate("() => Math.hypot(window.innerWidth, window.innerHeight)"))


def stage_index(base: str, slug: str) -> tuple[int, int]:
    slugs = [s["slug"] for s in Api(base).get("/api/seasons").json()["seasons"]]
    return slugs.index(slug), len(slugs)


def ui_stepup(page: Any, mail: Any, email: str, seen: set[Any]) -> None:
    dialog = page.get_by_role("dialog", name="Confirm it's you", exact=True)
    eventually(page, lambda: shown(dialog), "step-up dialog open")
    try:
        message = await_mail(mail, email, STEPUP_SUBJECT["en"], exclude=seen, seconds=STEPUP_MAIL_S)[0]
    except AssertionError:
        click(dialog.get_by_role("button", name="Send a new code", exact=True))
        message = await_mail(mail, email, STEPUP_SUBJECT["en"], exclude=seen)[0]
    fill(dialog.get_by_role("textbox", name="Verification code", exact=True), code_in(message))
    click(dialog.get_by_role("button", name="Verify", exact=True))
    eventually(page, lambda: not shown(dialog), "dialog closes after verify")


def choose_cadence(page: Any, label: str) -> None:
    target = page.get_by_role("button", name=f"Billing: {label}", exact=True)
    if shown(target):
        return
    click(page.get_by_role("button", name=re.compile(r"^Billing: ")))
    listbox = page.get_by_role("listbox", name="Billing cadence", exact=True)
    eventually(page, lambda: shown(listbox), "cadence menu")
    click(listbox.get_by_role("option", name=label, exact=True))
    eventually(page, lambda: shown(target), f"cadence {label}")


def pick_option(combo: Any, needle: str) -> None:
    find = "(el, n) => { const o = [...el.options].find(x => x.text.includes(n) || x.value.includes(n)); return o ? o.value : null; }"
    eventually(combo.page, lambda: combo.first.evaluate(find, needle) is not None, f"an option containing {needle}")
    select(combo, combo.first.evaluate(find, needle))


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()

    def start(self) -> None:
        if self.listener:
            return
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", self.port))
        listener.listen()
        self.listener = listener
        threading.Thread(target=self._accept, args=(listener,), daemon=True).start()

    def _accept(self, listener: socket.socket) -> None:
        while True:
            try:
                client, _ = listener.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.conns += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        try:
            while data := a.recv(RELAY_CHUNK):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def stop(self) -> None:
        if self.listener:
            try:
                self.listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.listener.close()
            self.listener = None
        with self.lock:
            conns, self.conns = self.conns, []
        for s in conns:
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            s.close()


@contextmanager
def app_copy(overrides: dict[str, str]) -> Any:
    port = free_port()
    env = dict(os.environ)
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    url = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text(errors="replace")[-LOG_TAIL_CHARS:]

    def healthy() -> bool:
        if proc.poll() is not None:
            raise AssertionError(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            r = httpx.get(f"{url}/api/health", timeout=HTTP_TIMEOUT_S)
            return r.status_code == 200 and r.json().get("status") == "ok"
        except httpx.HTTPError:
            return False

    try:
        try:
            poll(healthy, APP_BOOT_S, "app copy health")
        except AssertionError as exc:
            raise AssertionError(f"{exc}\n{tail()}") from exc
        yield url
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        log.close()


def kb_target() -> tuple[str, str, int, str]:
    parsed = urlparse(os.environ["KILLBILL_URL"])
    return parsed.scheme, parsed.hostname or "", parsed.port or 80, parsed.path


@pytest.fixture(scope="module")
def pg() -> Any:
    return Postgres()


@pytest.fixture(scope="module")
def fast_app() -> Any:
    with app_copy({
        "HOLD_TTL_SECONDS": str(FAST_HOLD_TTL_S),
        "STEPUP_CODE_TTL_SECONDS": str(FAST_CODE_TTL_S),
        "STEPUP_VALID_SECONDS": str(FAST_VALID_S),
        "STEPUP_LOCKOUT_SECONDS": str(FAST_LOCKOUT_S),
        "TZ": PROBE_SERVER_TZ,
    }) as url:
        yield url


@pytest.fixture(scope="module")
def relay_app() -> Any:
    scheme, host, port, path = kb_target()
    kb = Relay(host, port)
    kb.start()
    try:
        with app_copy({"KILLBILL_URL": f"{scheme}://127.0.0.1:{kb.port}{path}"}) as url:
            yield SimpleNamespace(url=url, kb=kb)
    finally:
        kb.stop()


def scratch_database() -> str:
    url = os.environ["DATABASE_URL"]
    name = "probe_" + uuid.uuid4().hex[:12]
    out = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-c", f"CREATE DATABASE {name}"], capture_output=True, text=True, timeout=HTTP_TIMEOUT_S)
    assert out.returncode == 0, out.stderr
    return urlparse(url)._replace(path="/" + name).geturl()


@pytest.fixture(scope="module")
def mail_app() -> Any:
    smtp = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    smtp.start()
    try:
        with app_copy({"DATABASE_URL": scratch_database(), "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(smtp.port)}) as url:
            yield SimpleNamespace(url=url, smtp=smtp)
    finally:
        smtp.stop()


@pytest.fixture(scope="module")
def mail_down_app() -> Any:
    with app_copy({"DATABASE_URL": scratch_database(), "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(free_port())}) as url:
        yield url


def mail_up(app: SimpleNamespace) -> None:
    app.smtp.start()
    wait_status(app.url, "mail", "up", NOTICE_S * 3)


def billing_up(relay: SimpleNamespace) -> None:
    relay.kb.start()
    wait_status(relay.url, "billing", "up", NOTICE_S * 3)


def test_wf_programme_browse_stage(browser, app_url):
    first, second = far_local(app_url, 260, 19, 0), far_local(app_url, 261, 21, 0)
    season = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_A, "MH2", first), (FILM_B, "AC1", second)])
    seasons = Api(app_url).get("/api/seasons").json()["seasons"]
    slugs = [s["slug"] for s in seasons]
    assert season.slug in slugs
    assert slugs == [s["slug"] for s in sorted(seasons, key=lambda s: (s["first_date"], s["slug"]))]
    assert all(s["state"] in ("scheduled", "member-priority", "on-sale") for s in seasons)
    with open_app(browser, f"{app_url}/en/?season={season.slug}") as page:
        page.set_viewport_size(DESKTOP)
        tabs = page.get_by_role("tablist", name="Seasons", exact=True).get_by_role("tab")
        eventually(page, lambda: tabs.count() == len(seasons), "one tab per season")
        for i, s in enumerate(seasons):
            named = page.get_by_role("tab", name=s["title_en"], exact=True)
            assert tabs.nth(i).evaluate("(e, o) => e === o", named.first.element_handle()), f"tab {i} is {s['title_en']}"
        assert page.get_by_role("heading", level=2, name=season.title_en, exact=True).count() == 1
        rail = page.get_by_role("list", name=f"Schedule — {season.title_en}", exact=True)
        link = rail.get_by_role("link", name=f"{FILM_A} — {first:%Y-%m-%d} {first:%H:%M} — MH2", exact=True)
        eventually(page, lambda: shown(link), "rail row link")
        assert rail.get_by_role("link", name=f"{FILM_B} — {second:%Y-%m-%d} {second:%H:%M} — AC1", exact=True).count() == 1
        eventually(page, lambda: f"{MH2_CAPACITY} left" in text_in(rail) and f"{AC1_CAPACITY} left" in text_in(rail), "seats left on rows")
        click(link)
        eventually(page, lambda: page.url.endswith(path("screening", screening_id=season.ids[0])), "row opens screening")
        eventually(page, lambda: shown(page.get_by_role("grid", name="Seat map", exact=True)), "seat map")
    screening = Api(app_url).get(f"/api/screenings/{season.ids[0]}").json()["screening"]
    assert screening["seats_remaining"] == MH2_CAPACITY and screening["film_title"] == FILM_A


def test_wf_programme_browse_french(browser, app_url):
    first = far_local(app_url, 262, 18, 30)
    season = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_A, "AC1", first)])
    with open_app(browser, f"{app_url}/fr/?season={season.slug}") as page:
        page.set_viewport_size(DESKTOP)
        assert_tab = page.get_by_role("tablist", name="Saisons", exact=True).get_by_role("tab", name=season.title_fr, exact=True)
        eventually(page, lambda: shown(assert_tab), "French tab")
        assert page.get_by_role("heading", level=2, name=season.title_fr, exact=True).count() == 1
        rail = page.get_by_role("list", name=f"Horaire — {season.title_fr}", exact=True)
        eventually(page, lambda: f"{AC1_CAPACITY} restantes" in text_in(rail), "French seats left")
        click(rail.get_by_role("link", name=f"{FILM_A} — {first:%Y-%m-%d} {first:%H:%M} — AC1", exact=True))
        eventually(page, lambda: page.url.endswith(path("screening", "fr", screening_id=season.ids[0])), "French screening")
        eventually(page, lambda: shown(page.get_by_role("grid", name="Plan de salle", exact=True)), "French seat map")
    seasons = Api(app_url, "fr").get("/api/seasons").json()["seasons"]
    assert [s for s in seasons if s["slug"] == season.slug][0]["title_fr"] == season.title_fr


def test_iris_scroll_mapping(browser, app_url):
    season = on_sale(app_url, "MH2", 270)
    k, n = stage_index(app_url, season.slug)
    with open_app(browser, f"{app_url}/en/?season={season.slug}") as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, lambda: scroll_y(page) == SEGMENT_PX * k + DEEP_LINK_P, "deep link position")
        diag = diagonal(page)
        for p in SCRUB_POSITIONS + list(reversed(SCRUB_POSITIONS)):
            scroll_to(page, SEGMENT_PX * k + p)
            exp = iris_expected(p, diag, k == n - 1)
            eventually(page, lambda: iris_matches(stage_attrs(page), exp, k), f"attributes at p={p}: {stage_attrs(page)} vs {exp}")
            eventually(page, lambda: f"f/{exp['fstop']}" in body_text(page), f"readout f/{exp['fstop']}")


def test_active_season_and_deep_link(browser, app_url):
    base = new_slug()
    day = far_local(app_url, 300)
    a = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_A, "MH2", day)], slug=f"{base}-a")
    b = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_B, "AC1", day)], slug=f"{base}-b")
    seasons = Api(app_url).get("/api/seasons").json()["seasons"]
    slugs = [s["slug"] for s in seasons]
    kb_ = slugs.index(b.slug)
    previous = seasons[kb_ - 1]
    with open_app(browser, f"{app_url}/en/?season={a.slug}") as page:
        page.set_viewport_size(DESKTOP)
        ka = slugs.index(a.slug)
        eventually(page, lambda: scroll_y(page) == SEGMENT_PX * ka + DEEP_LINK_P, "deep link lands at y=1000k+700")
        root = lambda: page.evaluate("() => document.documentElement.getAttribute('data-active-season')")
        announcer = page.get_by_role("status", name="Season announcer", exact=True)
        eventually(page, lambda: root() == a.slug, "initial active season")
        assert parse_qs(urlparse(page.url).query)["season"] == [a.slug]
        assert "screening" not in text_in(announcer)
        tab_a = page.get_by_role("tab", name=a.title_en, exact=True)
        eventually(page, lambda: attr(tab_a, "aria-selected") == "true" and attr(tab_a, "aria-current") == "true", "initial tab state")
        scroll_to(page, SEGMENT_PX * kb_ + ACTIVATION_P - 1)
        eventually(page, lambda: root() == previous["slug"], "below p=300 the previous season stays active")
        scroll_to(page, SEGMENT_PX * kb_ + ACTIVATION_P + 1)
        tab_b = page.get_by_role("tab", name=b.title_en, exact=True)
        eventually(page, lambda: root() == b.slug and attr(tab_b, "aria-selected") == "true" and attr(tab_b, "aria-current") == "true", "activation at p>=300")
        assert parse_qs(urlparse(page.url).query)["season"] == [b.slug]
        eventually(page, lambda: text_in(announcer) == f"{b.title_en} — 1 screening", "polite announcement")
        assert attr(page.get_by_role("tab", name=previous["title_en"], exact=True), "aria-selected") != "true"
        page.get_by_role("tab", name=b.title_en, exact=True).focus()
        page.keyboard.press("ArrowLeft")
        prev_tab = page.get_by_role("tab", name=previous["title_en"], exact=True)
        eventually(page, lambda: focused(prev_tab), "arrow moves between tabs")
        page.keyboard.press("Enter")
        eventually(page, lambda: scroll_y(page) == SEGMENT_PX * (kb_ - 1) + DEEP_LINK_P and root() == previous["slug"], "keyboard activation deep-links")
    with open_app(browser, f"{app_url}/en/?season={b.slug}") as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, lambda: scroll_y(page) == SEGMENT_PX * kb_ + DEEP_LINK_P, "shared link position")
        eventually(page, lambda: page.evaluate("() => document.documentElement.getAttribute('data-active-season')") == b.slug, "shared link active season")
    with open_app(browser, f"{app_url}/en/?season=no-such-season-probe") as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, lambda: shown(stage(page)), "stage drawn")
        assert scroll_y(page) == 0


def test_reduced_motion_and_svg_fallback(browser, app_url):
    season = on_sale(app_url, "MH2", 275)
    k, n = stage_index(app_url, season.slug)
    slugs = [s["slug"] for s in Api(app_url).get("/api/seasons").json()["seasons"]]
    with open_app(browser, f"{app_url}/en/?season={season.slug}", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        radius = round(diagonal(page) / 2)
        final = lambda idx: (lambda a: a.get("data-segment") == str(idx) and a.get("data-iris-open") == "1.000" and a.get("data-iris-rotation") == "40.0" and abs(int(a.get("data-iris-radius") or -99) - radius) <= 2 and a.get("data-fstop") == "1.4" and a.get("data-rail-visible") == "1.000" and a.get("data-tint-mix") == "0.000")(stage_attrs(page))
        eventually(page, lambda: final(k), f"reduced-motion final values {stage_attrs(page)}")
        before = scroll_y(page)
        page.get_by_role("tab", name=season.title_en, exact=True).focus()
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Enter")
        target = (k - 1) % n
        eventually(page, lambda: page.evaluate("() => document.documentElement.getAttribute('data-active-season')") == slugs[target] and final(target), "instant tab swap")
        assert scroll_y(page) == before
    with open_app(browser, f"{app_url}/en/?season={season.slug}", no_webgl=True) as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, lambda: stage_attrs(page).get("data-renderer") == "svg" and stage_attrs(page).get("data-context") == "none", "svg renderer without WebGL")
        diag = diagonal(page)
        scroll_to(page, SEGMENT_PX * k + SCRUB_POSITIONS[0])
        exp = iris_expected(SCRUB_POSITIONS[0], diag, k == n - 1)
        eventually(page, lambda: iris_matches(stage_attrs(page), exp, k), "svg iris follows scroll")
    with open_app(browser, f"{app_url}/en/?season={season.slug}") as page:
        page.set_viewport_size(DESKTOP)
        page.add_init_script(GL_RECORDER)
        page.reload()
        eventually(page, lambda: stage_attrs(page).get("data-renderer") == "webgl" and stage_attrs(page).get("data-context") == "ok", "webgl renderer")
        lost = page.evaluate("() => { const exts = window.__probeGL.map(gl => gl.getExtension('WEBGL_lose_context')).filter(Boolean); "
                             "window.__probeLose = exts; exts.forEach(x => x.loseContext()); return exts.length > 0; }")
        assert lost, "no WebGL context on the stage"
        eventually(page, lambda: stage_attrs(page).get("data-renderer") == "svg" and stage_attrs(page).get("data-context") == "lost", "svg after context loss")
        diag = diagonal(page)
        scroll_to(page, SEGMENT_PX * k + SCRUB_POSITIONS[1])
        exp = iris_expected(SCRUB_POSITIONS[1], diag, k == n - 1)
        eventually(page, lambda: iris_matches(stage_attrs(page), exp, k), "attributes keep following scroll while lost")
        page.evaluate("() => window.__probeLose.forEach(x => x.restoreContext())")
        eventually(page, lambda: stage_attrs(page).get("data-renderer") == "webgl" and stage_attrs(page).get("data-context") == "ok", "canvas returns", seconds=RESTORE_MAX_S + RESTORE_MARGIN_S)


def test_language_switch_in_place(browser, app_url):
    season = on_sale(app_url, "MH2", 280)
    sid = season.ids[0]
    for label, (width, height) in VIEWPORTS.items():
        with open_app(browser, f"{app_url}/en/screenings/{sid}") as page:
            page.set_viewport_size({"width": width, "height": height})
            grid_en = page.get_by_role("grid", name="Seat map", exact=True)
            eventually(page, lambda: shown(grid_en), f"seat map at {label}")
            click(seat(page, "A1"))
            eventually(page, lambda: attr(seat(page, "A1"), "aria-selected") == "true", "A1 selected")
            page.evaluate("() => { window.__probeMarker = 1; }")
            before = grid_en.first.bounding_box()
            switch = page.get_by_role("button", name="Français", exact=True)
            assert attr(switch, "lang") == "fr"
            press_in_place(switch)
            grid_fr = page.get_by_role("grid", name="Plan de salle", exact=True)
            eventually(page, lambda: page.evaluate("() => document.documentElement.lang") == "fr" and shown(grid_fr), f"French in place at {label}")
            assert urlparse(page.url).path == path("screening", "fr", screening_id=sid)
            assert page.evaluate("() => window.__probeMarker") == 1, "page was reloaded"
            assert attr(seat(page, "A1", "fr"), "aria-selected") == "true"
            after = grid_fr.first.bounding_box()
            for key in ("x", "y", "width", "height"):
                assert abs(after[key] - before[key]) <= SEAT_TOLERANCE_PX, (label, key, before, after)
            back = page.get_by_role("button", name="English", exact=True)
            assert attr(back, "lang") == "en"
            eventually(page, lambda: any(c["name"] == "halide_locale" and c["value"] == "fr" for c in page.context.cookies()), "choice remembered")
            press_in_place(back)
            eventually(page, lambda: page.evaluate("() => document.documentElement.lang") == "en" and shown(grid_en), "back to English")
            again = grid_en.first.bounding_box()
            for key in ("x", "y", "width", "height"):
                assert abs(again[key] - before[key]) <= SEAT_TOLERANCE_PX, (label, key, before, again)
    route = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=False)
    unprefixed = PATHS["membership"].replace("/<locale>", "")
    cases = ((path("membership"), path("membership", "fr")), (unprefixed, path("membership", "fr")), (EVIL_NEXT, path("programme", "fr")), (None, path("programme", "fr")))
    for nxt, expected in cases:
        r = route.get(LOCALE_ROUTE.replace("<en|fr>", "fr"), params={"next": nxt} if nxt else None)
        assert r.status_code == 303, r.text
        assert r.headers["location"] == expected, (nxt, r.headers["location"])
        assert r.cookies.get("halide_locale") == "fr"


def test_sale_times_toronto(browser, app_url, fast_app):
    for base in (app_url, fast_app):
        prog = staff(base, "programmer")
        slug = new_slug()
        r = prog.post("/api/programmer/seasons", {"slug": slug, "title_en": f"Probe {slug}", "title_fr": f"Essai {slug}", "public_sale_date": "2026-11-03"})
        assert r.status_code == 201, r.text
        row = [s for s in prog.get("/api/programmer/seasons").json()["seasons"] if s["slug"] == slug][0]
        assert row["priority_opens_at"] == "2026-10-31T10:00:00-04:00"
        assert row["public_opens_at"] == "2026-11-03T10:00:00-05:00"
    season = create_season(app_url, sale_offset_days=30, screenings=[(FILM_A, "MH2", far_local(app_url, 290))])
    priority = season.sale - timedelta(days=3)
    data = Api(app_url).get(f"/api/seasons/{season.slug}").json()["season"]
    assert data["state"] == "scheduled"
    assert iso(data["priority_opens_at"]) == datetime.combine(priority, dtime(10), TORONTO)
    assert iso(data["public_opens_at"]) == datetime.combine(season.sale, dtime(10), TORONTO)
    for locale, line in (("en", f"Members book from {priority} 10:00 · Everyone from {season.sale} 10:00 (Montréal time)"),
                         ("fr", f"Membres dès le {priority} à 10 h · Grand public dès le {season.sale} à 10 h (heure de Montréal)")):
        context = browser.new_context(timezone_id=PROBE_BROWSER_TZ, viewport=DESKTOP)
        try:
            page = context.new_page()
            page.goto(f"{app_url}/{locale}/?season={season.slug}")
            expect(page.locator("body")).to_contain_text(line, timeout=UI_WAIT_S * 1000)
        finally:
            context.close()


def test_wf_guest_checkout_happy(browser, app_url, killbill, mail):
    season = on_sale(app_url, "MH2", 205)
    sid = season.ids[0]
    name, email = person("guest")
    total = expected_total(["regular", "regular"])
    with open_app(browser, f"{app_url}/en/screenings/{sid}") as page:
        page.set_viewport_size(DESKTOP)
        for code in ("A1", "A2"):
            cell = seat(page, code)
            eventually(page, lambda: shown(cell), f"seat {code}")
            click(cell)
            eventually(page, lambda: attr(cell, "aria-selected") == "true", f"{code} selected")
        click(page.get_by_role("button", name="Hold seats", exact=True))
        eventually(page, lambda: path("checkout", hold_id="") in page.url, "checkout page")
        eventually(page, lambda: shown(page.get_by_role("timer", name="Hold time remaining", exact=True)), "countdown")
        fill(page.get_by_role("textbox", name="Full name", exact=True), name)
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_role("textbox", name="Cardholder name", exact=True), name)
        pay = page.get_by_role("button", name=f"Pay {money(total)}", exact=True)
        eventually(page, lambda: shown(pay) and pay.is_enabled(), "pay enabled")
        click(pay)
        eventually(page, lambda: shown(page.get_by_role("heading", name="Booking confirmed", exact=True)), "Booking confirmed", CHECKOUT_WAIT_S)
        tickets = text_in(page.get_by_role("table", name="Tickets", exact=True))
        assert "A1" in tickets and "A2" in tickets
        assert money(total) in text_in(page.get_by_role("table", name="Price summary", exact=True))
        assert f"We'll email your confirmation to {email}." in body_text(page)
    account = kb_account(killbill, key=f"guest-{email.lower()}")
    assert kb_transactions(killbill, account, "PURCHASE") == [total]
    message = exactly_one(mail, email, "Booking confirmed — HB-")
    token = re.search(link_re("guest", "en"), mail_body(message)).group(1)
    booking = Api(app_url).get(f"/api/guest/bookings/{token}").json()["booking"]
    assert booking["seats"] == ["A1", "A2"] and booking["state"] == "paid" and booking["total_cents"] == total


def test_wf_guest_checkout_link_recovery(browser, app_url, mail):
    season = on_sale(app_url, "MH2", 206)
    g = guest_checkout(app_url, season.ids[0], ["B1"])
    ref = g.booking["ref"]
    with open_app(browser, f"{app_url}/en/booking-link") as page:
        fill(page.get_by_role("textbox", name="Booking reference", exact=True), ref)
        fill(page.get_by_role("textbox", name="Email", exact=True), g.email)
        click(page.get_by_role("button", name="Email me a new link", exact=True))
        status = page.get_by_role("status", name="Form status", exact=True)
        eventually(page, lambda: "If the reference and email match, a new link is on its way and any earlier link no longer works." in text_in(status), "acknowledgement")
    message = exactly_one(mail, g.email, f"Your Halide booking link — {ref}")
    new_token = re.search(link_re("guest", "en"), mail_body(message)).group(1)
    assert new_token != g.token
    anon = Api(app_url)
    assert anon.get(f"/api/guest/bookings/{g.token}").status_code == 404
    assert anon.get(f"/api/guest/bookings/{new_token}").json()["booking"]["ref"] == ref


def test_wf_guest_checkout_release(browser, app_url):
    season = on_sale(app_url, "MH2", 207)
    sid = season.ids[0]
    with open_app(browser, f"{app_url}/en/screenings/{sid}") as page:
        cell = seat(page, "A3")
        eventually(page, lambda: shown(cell), "seat")
        click(cell)
        click(page.get_by_role("button", name="Hold seats", exact=True))
        eventually(page, lambda: path("checkout", hold_id="") in page.url, "checkout")
        hold_id = urlparse(page.url).path.rsplit("/", 1)[1]
        click(page.get_by_role("button", name="Release seats", exact=True))
        eventually(page, lambda: urlparse(page.url).path == path("screening", screening_id=sid), "back to screening")
        hold = browser_call(page, app_url, "GET", f"/api/holds/{hold_id}").json()["hold"]
    assert hold["state"] == "expired" and hold["ended_by"] == "patron"
    seats = {s["code"]: s["state"] for s in Api(app_url).get(f"/api/screenings/{sid}").json()["screening"]["seats"]}
    assert seats["A3"] == "available"


def test_hold_expiry_server_edge(fast_app):
    season = on_sale(fast_app, "MH2", 208)
    sid = season.ids[0]
    api = Api(fast_app)
    hold = make_hold(api, sid, ["A1"])
    span = (iso(hold["expires_at"]) - iso(hold["server_time"])).total_seconds()
    assert FAST_HOLD_TTL_S - 2 <= span <= FAST_HOLD_TTL_S + 1
    assert api.post(f"/api/holds/{hold['id']}/quote", {"fares": {"A1": "regular"}, "uplift_cents": 0}).status_code == 200
    expired = poll(lambda: (lambda h: h if iso(h["server_time"]) >= iso(h["expires_at"]) + timedelta(seconds=1) else None)(api.get(f"/api/holds/{hold['id']}").json()["hold"]), FAST_HOLD_TTL_S * 3, "hold expiry")
    assert expired["state"] == "expired" and expired["ended_by"] == "timeout"
    name, email = person("late")
    r = api.post("/api/checkout", checkout_body(hold, {"A1": "regular"}, guest={"name": name, "email": email}), key=idempotency_key())
    assert r.status_code == 410 and error(r)["code"] == "hold_expired" and error(r)["message"] == HOLD_EXPIRED_MSG
    assert api.post(f"/api/holds/{hold['id']}/quote", {"fares": {"A1": "regular"}, "uplift_cents": 0}).status_code == 410
    assert api.delete(f"/api/holds/{hold['id']}").status_code == 410
    screening = api.get(f"/api/screenings/{sid}").json()["screening"]
    assert {s["code"]: s["state"] for s in screening["seats"]}["A1"] == "available"
    assert screening["seats_remaining"] == MH2_CAPACITY


def test_wf_last_seat_race_expired_notice(browser, fast_app):
    season = on_sale(fast_app, "MH2", 209)
    sid = season.ids[0]
    name, email = person("expired")
    with open_app(browser, f"{fast_app}/en/screenings/{sid}") as page:
        cell = seat(page, "B2")
        eventually(page, lambda: shown(cell), "seat")
        click(cell)
        click(page.get_by_role("button", name="Hold seats", exact=True))
        eventually(page, lambda: path("checkout", hold_id="") in page.url, "checkout")
        hold_id = urlparse(page.url).path.rsplit("/", 1)[1]
        fill(page.get_by_role("textbox", name="Full name", exact=True), name)
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_role("textbox", name="Cardholder name", exact=True), name)
        pay = page.get_by_role("button", name=re.compile(r"^Pay "))
        eventually(page, lambda: shown(pay) and pay.first.is_enabled(), "pay button")
        poll(lambda: browser_call(page, fast_app, "GET", f"/api/holds/{hold_id}").json()["hold"]["state"] == "expired", FAST_HOLD_TTL_S * 3, "server expiry")
        click(pay)
        alert = page.get_by_role("alert", name="Checkout error", exact=True)
        eventually(page, lambda: HOLD_EXPIRED_MSG in text_in(alert), "hold-expired notice")
        assert alert.get_by_role("link", name="Choose seats again", exact=True).count() == 1
        assert not page.get_by_role("button", name=re.compile(r"^Pay ")).first.is_enabled()
        click(alert.get_by_role("link", name="Choose seats again", exact=True))
        eventually(page, lambda: urlparse(page.url).path == path("screening", screening_id=sid), "back to the screening")
    states = {s["code"]: s["state"] for s in Api(fast_app).get(f"/api/screenings/{sid}").json()["screening"]["seats"]}
    assert states["B2"] == "available"


def test_tax_arithmetic(app_url, killbill, mail):
    for case, spec in WORKED.items():
        season = on_sale(app_url, "MH2", 210)
        seats = MH2_SEATS[: len(spec["fares"])]
        fares = dict(zip(seats, spec["fares"]))
        if spec["member"]:
            p = member(app_url)
            api, email, guest = p.api, p.email, None
        else:
            name, email = person("tax")
            api, guest = Api(app_url), {"name": name, "email": email}
        hold = make_hold(api, season.ids[0], seats)
        quote = api.post(f"/api/holds/{hold['id']}/quote", {"fares": fares, "uplift_cents": spec["uplift"]}).json()["quote"]
        for line in quote["lines"]:
            subtotal = PRICES[line["fare"]] * line["quantity"]
            assert (line["unit_cents"], line["subtotal_cents"]) == (PRICES[line["fare"]], subtotal), case
            assert (line["gst_cents"], line["qst_cents"]) == taxes(subtotal), case
        figures = (spec["admission"], spec["gst"], spec["qst"], spec["uplift"], spec["total"])
        assert (quote["admission_cents"], quote["gst_cents"], quote["qst_cents"], quote["uplift_cents"], quote["total_cents"]) == figures, case
        r = api.post("/api/checkout", checkout_body(hold, fares, uplift=spec["uplift"], guest=guest), key=idempotency_key())
        assert r.status_code == 201, r.text
        booking = r.json()["booking"]
        assert (booking["admission_cents"], booking["gst_cents"], booking["qst_cents"], booking["uplift_cents"], booking["total_cents"]) == figures, case
        account = kb_account(killbill, email=email)
        assert spec["total"] in kb_transactions(killbill, account, "PURCHASE"), case
        body = mail_body(exactly_one(mail, email, f"Booking confirmed — {booking['ref']}"))
        for line in (f"Admission: {money(spec['admission'])}", f"GST (5%): {money(spec['gst'])}", f"QST (9.975%): {money(spec['qst'])}", f"Total: {money(spec['total'])}"):
            assert line in body, (case, line)
        if spec["uplift"]:
            assert f"Supporter uplift (not taxed): {money(spec['uplift'])}" in body
        csv_body = staff(app_url, "finance").get(f"/api/finance/reconciliation.csv?date={booking['paid_at'][:10]}").text
        rows = [r for r in csv.DictReader(io.StringIO(csv_body, newline="")) if r["kind"] == "booking" and r["reference"] == booking["ref"]]
        assert len(rows) == 1, case
        assert (rows[0]["admission"], rows[0]["gst"], rows[0]["qst"], rows[0]["uplift"]) == tuple(dollars(x) for x in figures[:4]), case


def test_one_invoice_per_booking(app_url, killbill):
    season = on_sale(app_url, "MH2", 211)
    sid = season.ids[0]
    name, email = person("invoice")
    mixed = email[0].upper() + email[1:]
    g = guest_checkout(app_url, sid, ["A1"], name=name, email=mixed, uplift=200)
    account = kb_account(killbill, key=f"guest-{mixed.lower()}")
    assert killbill.default_plugin(account["accountId"]) == "__EXTERNAL_PAYMENT__"
    payments = killbill.payments(account["accountId"])
    assert len(payments) == 1
    assert kb_transactions(killbill, account, "PURCHASE") == [g.booking["paid_cents"]]
    assert_booking_invoice(account, g.booking)
    p = signup(app_url)
    first = patron_checkout(p, sid, ["B1"], ["regular"])
    second = patron_checkout(p, sid, ["B2", "B3"], ["regular", "reduced"])
    account = kb_account(killbill, key=p.number)
    assert account["email"] == p.email
    assert sorted(kb_transactions(killbill, account, "PURCHASE")) == sorted([first["paid_cents"], second["paid_cents"]])
    assert len(killbill.payments(account["accountId"])) == 2
    for booking in (first, second):
        assert_booking_invoice(account, booking)


@pytest.mark.parametrize("flow", ["checkout", "gift"], ids=["checkout", "gift"])
def test_idempotency(app_url, killbill, mail, flow):
    name, email = person("idem")
    api = Api(app_url)
    if flow == "checkout":
        season = on_sale(app_url, "MH2", 212)
        hold = make_hold(api, season.ids[0], ["A1"])
        path = "/api/checkout"
        body = checkout_body(hold, {"A1": "regular"}, guest={"name": name, "email": email})
        changed = dict(body, cardholder_name="Probe Other Cardholder")
        subject = "Booking confirmed — HB-"
    else:
        _, recipient = person("idem-recipient")
        path = "/api/gifts"
        body = {"tier": "friend", "purchaser": {"name": name, "email": email}, "recipient": {"name": "Probe Recipient", "email": recipient, "locale": "en"}, "message": "", "cardholder_name": name}
        changed = dict(body, message="Probe different message")
        subject = "Gift membership receipt — HG-"
    r = api.post(path, body)
    assert r.status_code == 422 and error(r)["code"] == "validation"
    assert error(r)["fields"]["idempotency_key"] == "A retry key is required."
    assert killbill.account(email) is None
    key = idempotency_key()
    first = api.post(path, body, key=key)
    assert first.status_code == 201, first.text
    replay = api.post(path, body, key=key)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replayed") == "true"
    conflict = api.post(path, changed, key=key)
    assert conflict.status_code == 422 and error(conflict)["code"] == "idempotency_conflict"
    assert error(conflict)["message"] == "This retry key was already used for a different request."
    account = kb_account(killbill, email=email)
    assert len(kb_transactions(killbill, account, "PURCHASE")) == 1
    exactly_one(mail, email, subject)


def test_confirmation_email_french(app_url, mail):
    season = on_sale(app_url, "MH2", 213)
    start = season.starts[0]
    g = guest_checkout(app_url, season.ids[0], ["B1", "B2"], locale="fr", uplift=200)
    b = g.booking
    message = exactly_one(mail, g.email, f"Réservation confirmée — {b['ref']}")
    body = mail_body(message)
    total = expected_total(["regular", "regular"], 200)
    expected = [f"Référence de réservation : {b['ref']}", f"Film : {FILM_A}", f"Séance : {start:%Y-%m-%d} {start:%H:%M}", "Salle : Salle Nitrate (MH2)", "Places : B1, B2",
                f"Entrée : {money(2800, 'fr')}", f"TPS (5 %) : {money(140, 'fr')}", f"TVQ (9,975 %) : {money(279, 'fr')}",
                f"Contribution de soutien (non taxable) : {money(200, 'fr')}", f"Total : {money(total, 'fr')}", f"Payé aujourd'hui : {money(total, 'fr')}"]
    for line in expected:
        assert line in body, line
    for ticket in b["tickets"]:
        assert f"Billet {ticket['code']} — Place {ticket['seat']} — Ordinaire" in body
    assert re.search(r"Gérer votre réservation : \S+" + re.escape(g.link), body)
    assert "Crédit appliqué" not in body and "Booking reference:" not in body


def test_guest_booking_links(app_url, mail):
    season = on_sale(app_url, "MH2", 214)
    g = guest_checkout(app_url, season.ids[0], ["A1"])
    other = guest_checkout(app_url, season.ids[0], ["A2"])
    assert TOKEN_RE.match(g.token) and g.link == path("guest", token=g.token)
    anon = Api(app_url)
    assert anon.get(f"/api/guest/bookings/{g.token}").json()["booking"]["ref"] == g.booking["ref"]
    assert anon.get(f"/api/guest/bookings/{other.token}").json()["booking"]["ref"] == other.booking["ref"]
    r = anon.get(f"/api/guest/bookings/{JUNK_TOKEN}")
    assert r.status_code == 404 and error(r) == {"code": "not_found", "message": NOT_FOUND["en"]}
    subject = f"Your Halide booking link — {g.booking['ref']}"
    _, stranger = person("stranger")
    r = anon.post("/api/guest/booking-links", {"booking_ref": g.booking["ref"], "email": stranger})
    assert r.status_code == 202 and r.json() == {"status": "accepted"}
    assert anon.get(f"/api/guest/bookings/{g.token}").status_code == 200
    r = anon.post("/api/guest/booking-links", {"booking_ref": g.booking["ref"], "email": g.email})
    assert r.status_code == 202
    message = exactly_one(mail, g.email, subject)
    new = re.search(r"Manage your booking: \S+" + link_re("guest", "en"), mail_body(message)).group(1)
    assert anon.get(f"/api/guest/bookings/{g.token}").status_code == 404
    assert anon.get(f"/api/guest/bookings/{new}").status_code == 200
    assert not mail_to(mail, stranger)
    r = anon.post(f"/api/guest/bookings/{new}/refund", {})
    assert r.status_code == 200, r.text
    assert anon.get(f"/api/guest/bookings/{new}").status_code == 404


def test_checkout_atomic_on_billing_failure(app_url, relay_app, killbill, mail):
    billing_up(relay_app)
    base = relay_app.url
    season = on_sale(base, "MH2", 215)
    api = Api(base)
    name, email = person("atomic")
    hold = make_hold(api, season.ids[0], ["A1", "A2"])
    body = checkout_body(hold, {"A1": "regular", "A2": "regular"}, guest={"name": name, "email": email})
    relay_app.kb.stop()
    try:
        r = api.post("/api/checkout", body, key=idempotency_key())
        assert r.status_code == 503 and error(r) == {"code": "billing_unavailable", "message": BILLING_UNAVAILABLE["en"]}
        after = api.get(f"/api/holds/{hold['id']}").json()["hold"]
        assert after["state"] == "held" and after["expires_at"] == hold["expires_at"] and after["booking_ref"] is None
    finally:
        billing_up(relay_app)
    account = killbill.account(email)
    assert account is None or kb_transactions(killbill, account, "PURCHASE") == []
    assert not mail_to(mail, email)
    r = api.post("/api/checkout", body, key=idempotency_key())
    assert r.status_code == 201, r.text
    assert kb_transactions(killbill, kb_account(killbill, email=email), "PURCHASE") == [expected_total(["regular", "regular"])]
    exactly_one(mail, email, "Booking confirmed — HB-")
    race = on_sale(app_url, "MH2", 216)
    racer = Api(app_url)
    rname, remail = person("racer")
    rhold = make_hold(racer, race.ids[0], ["B1"])
    rbody = checkout_body(rhold, {"B1": "regular"}, guest={"name": rname, "email": remail})
    results = together([lambda k=idempotency_key(): racer.post("/api/checkout", rbody, key=k) for _ in range(4)])
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    assert all(error(r)["code"] == "hold_already_paid" for r in results if r.status_code == 409)
    assert len(kb_transactions(killbill, kb_account(killbill, email=remail), "PURCHASE")) == 1


def test_last_seat_race(app_url, killbill, mail):
    season = on_sale(app_url, "MH2", 217)
    sid = season.ids[0]
    clients = [Api(app_url) for _ in range(RACE_CLIENTS)]
    people = [person("racer") for _ in clients]
    results = together([lambda c=c: c.post("/api/holds", {"screening_id": sid, "seats": ["A1"], "group": False}) for c in clients])
    assert sorted(r.status_code for r in results) == [201] + [409] * (RACE_CLIENTS - 1)
    for r in results:
        if r.status_code == 409:
            assert error(r)["code"] == "seat_taken" and error(r)["seats"] == ["A1"]
            assert error(r)["message"] == fmt(SEAT_TAKEN_MSG, seats=MH2_SEATS[0])
    assert Api(app_url).get(f"/api/screenings/{sid}").json()["screening"]["seats_remaining"] == MH2_CAPACITY - 1
    w = [i for i, r in enumerate(results) if r.status_code == 201][0]
    name, email = people[w]
    r = clients[w].post("/api/checkout", checkout_body(results[w].json()["hold"], {"A1": "regular"}, guest={"name": name, "email": email}), key=idempotency_key())
    assert r.status_code == 201, r.text
    exactly_one(mail, email, "Booking confirmed — HB-")
    assert kb_transactions(killbill, kb_account(killbill, email=email), "PURCHASE") == [expected_total(["regular"])]
    for i, (_, other) in enumerate(people):
        if i != w:
            assert killbill.account(other) is None and not mail_to(mail, other)
            r = clients[i].post("/api/holds", {"screening_id": sid, "seats": ["A1"], "group": False})
            assert r.status_code == 409 and error(r)["code"] == "seat_taken"
    assert {s["code"]: s["state"] for s in Api(app_url).get(f"/api/screenings/{sid}").json()["screening"]["seats"]}["A1"] == "sold"
    rest = MH2_SEATS[1:]
    for chunk in (rest[:10], rest[10:20], rest[20:]):
        make_hold(Api(app_url), sid, chunk)
    r = Api(app_url).post("/api/holds", {"screening_id": sid, "seats": ["D6"], "group": False})
    assert r.status_code == 409 and error(r)["code"] == "seat_taken"
    assert Api(app_url).get(f"/api/screenings/{sid}").json()["screening"]["seats_remaining"] == 0


def test_wf_last_seat_race_ui_notice(browser, app_url):
    season = on_sale(app_url, "MH2", 218)
    sid = season.ids[0]
    with open_app(browser, f"{app_url}/en/screenings/{sid}") as page:
        cell = seat(page, "C1")
        eventually(page, lambda: shown(cell), "seat")
        click(cell)
        eventually(page, lambda: attr(cell, "aria-selected") == "true", "selected")
        make_hold(Api(app_url), sid, ["C1"])
        click(page.get_by_role("button", name="Hold seats", exact=True))
        alert = page.get_by_role("alert", name="Booking error", exact=True)
        eventually(page, lambda: fmt(SEAT_TAKEN_MSG, seats="C1") in text_in(alert), "seat_taken notice")
        eventually(page, lambda: attr(cell, "aria-disabled") == "true" and attr(cell, "aria-selected") != "true", "seat greyed and deselected")
    states = {s["code"]: s["state"] for s in Api(app_url).get(f"/api/screenings/{sid}").json()["screening"]["seats"]}
    assert states["C1"] == "held"


def test_wf_last_seat_race_sold_out(browser, app_url):
    season = on_sale(app_url, "MH2", 219)
    sid = season.ids[0]
    for chunk in (MH2_SEATS[:10], MH2_SEATS[10:20], MH2_SEATS[20:]):
        make_hold(Api(app_url), sid, chunk)
    with open_app(browser, f"{app_url}/en/screenings/{sid}") as page:
        eventually(page, lambda: "sold out" in body_text(page).lower(), "Sold out copy")
        eventually(page, lambda: all(attr(seat(page, c), "aria-disabled") == "true" for c in ("A1", "D6")), "every seat unavailable")
    assert Api(app_url).get(f"/api/screenings/{sid}").json()["screening"]["seats_remaining"] == 0


def test_member_fares_and_priority(browser, app_url):
    season = create_season(app_url, sale_offset_days=2, screenings=[(FILM_A, "MH2", far_local(app_url, 220))])
    sid = season.ids[0]
    assert Api(app_url).get(f"/api/seasons/{season.slug}").json()["season"]["state"] == "member-priority"
    refusal = f"Member priority booking is open. Booking opens to everyone on {season.sale} at 10:00."
    for api in (signup(app_url).api, Api(app_url)):
        r = api.post("/api/holds", {"screening_id": sid, "seats": ["A1"], "group": False})
        assert r.status_code == 403 and error(r) == {"code": "members_priority", "message": refusal}
    m = member(app_url, "friend", "annual")
    hold = make_hold(m.api, sid, ["A1", "A2", "A3"])
    quote = lambda fares: m.api.post(f"/api/holds/{hold['id']}/quote", {"fares": dict(zip(["A1", "A2", "A3"], fares)), "uplift_cents": 0})
    assert quote(["member", "member-guest", "regular"]).status_code == 200
    for fares, bad in ((["member", "member", "regular"], "A2"), (["member", "member-guest", "member-guest"], "A3"), (["group", "regular", "regular"], "A1")):
        r = quote(fares)
        assert r.status_code == 422 and error(r)["fields"][f"fares.{bad}"] == FARE_MSG, fares
    open_season = on_sale(app_url, "MH2", 221)
    plain = signup(app_url)
    phold = make_hold(plain.api, open_season.ids[0], ["A1"])
    r = plain.api.post(f"/api/holds/{phold['id']}/quote", {"fares": {"A1": "member"}, "uplift_cents": 0})
    assert r.status_code == 422 and error(r)["fields"]["fares.A1"] == FARE_MSG
    with open_app(browser, f"{app_url}/en/signin") as page:
        browser_signin(page, app_url, m.email)
        h = browser_hold(page, app_url, sid, ["B1", "B2", "B3"])
        page.goto(f"{app_url}/en/checkout/{h['id']}")
        for code, label in (("B1", "Member"), ("B2", "Member guest"), ("B3", "Regular")):
            fare = page.get_by_role("button", name=f"Fare for seat {code}: {label}", exact=True)
            eventually(page, lambda: shown(fare), f"default fare {label}")


def test_seat_map_keyboard(browser, app_url):
    season = on_sale(app_url, "MH2", 222)
    sid = season.ids[0]
    make_hold(Api(app_url), sid, ["D6"])
    with open_app(browser, f"{app_url}/en/screenings/{sid}") as page:
        page.set_viewport_size(DESKTOP)
        grid = page.get_by_role("grid", name="Seat map", exact=True)
        eventually(page, lambda: shown(grid) and attr(seat(page, "D6"), "aria-disabled") == "true", "grid with taken seat")
        assert grid.get_by_role("row").filter(has=page.get_by_role("gridcell")).count() == 4
        assert grid.get_by_role("gridcell").count() == MH2_CAPACITY
        tab_until(page, seat(page, "A1"), check=holds_focus)
        for key, target in (("ArrowRight", "A2"), ("ArrowDown", "B2"), ("ArrowUp", "A2"), ("Home", "A1"), ("ArrowLeft", "A1"), ("End", "A6"), ("ArrowRight", "A6"),
                            ("ArrowDown", "B6"), ("ArrowDown", "C6"), ("ArrowDown", "D6"), ("ArrowDown", "D6")):
            page.keyboard.press(key)
            eventually(page, lambda: holds_focus(seat(page, target)), f"{key} -> {target}")
        page.keyboard.press("Space")
        assert attr(seat(page, "D6"), "aria-selected") != "true"
        page.keyboard.press("ArrowLeft")
        d5 = seat(page, "D5")
        page.keyboard.press("Space")
        eventually(page, lambda: attr(d5, "aria-selected") == "true", "Space selects")
        page.keyboard.press("Enter")
        eventually(page, lambda: attr(d5, "aria-selected") != "true", "Enter deselects")
        page.keyboard.press("Space")
        eventually(page, lambda: attr(d5, "aria-selected") == "true", "Space selects again")
        page.keyboard.press("Tab")
        assert not any(holds_focus(seat(page, c)) for c in MH2_SEATS), "grid is a single tab stop"
        page.keyboard.press("Shift+Tab")
        eventually(page, lambda: holds_focus(d5), "re-entry returns to the last focused seat")


def test_wf_member_checkout_keyboard(browser, app_url, killbill, mail, pg):
    m = member(app_url, "friend", "annual")
    goodwill(app_url, m.number, 2500)
    film_day = far_local(app_url, 223)
    season = create_season(app_url, sale_offset_days=2, screenings=[(FILM_A, "MH2", film_day)])
    k, seasons = stage_index(app_url, season.slug)
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        browser_signin(page, app_url, m.email)
        page.goto(f"{app_url}/en/")
        tablist = page.get_by_role("tablist", name="Seasons", exact=True)
        eventually(page, lambda: shown(tablist), "tablist")
        for _ in range(TAB_LIMIT):
            if tablist.first.evaluate("el => el.contains(document.activeElement)"):
                break
            page.keyboard.press("Tab")
        our_tab = page.get_by_role("tab", name=season.title_en, exact=True)
        tab_until(page, our_tab, "ArrowRight", limit=seasons + 1)
        page.keyboard.press("Enter")
        diag = diagonal(page)
        final = iris_expected(DEEP_LINK_P, diag, False)
        eventually(page, lambda: iris_matches(dict(stage_attrs(page), **{"data-tint-mix": "0.000"}), final, k) and stage_attrs(page)["data-tint-mix"] == "0.000", "keyboard end values")
        keyboard_values = stage_attrs(page)
        tab_until(page, page.get_by_role("link", name=f"{FILM_A} — {film_day:%Y-%m-%d} {film_day:%H:%M} — MH2", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: path("screening", screening_id="") in page.url, "screening page")
        tab_until(page, seat(page, "A1"), check=holds_focus)
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        eventually(page, lambda: attr(seat(page, "A2"), "aria-selected") == "true", "two seats selected")
        tab_until(page, page.get_by_role("button", name="Hold seats", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: path("checkout", hold_id="") in page.url, "checkout")
        eventually(page, lambda: shown(page.get_by_role("button", name=fmt(FARE_BUTTON, seat="A2", fare_label=FARE_LABELS["member-guest"][0]), exact=True)), "default fares")
        switch = page.get_by_role("switch", name="Add a supporter uplift", exact=True)
        tab_until(page, switch)
        page.keyboard.press("Space")
        eventually(page, lambda: page.get_by_role("radio", name=money(500), exact=True).is_checked(), "500 preset")
        tab_until(page, page.get_by_role("textbox", name="Cardholder name", exact=True))
        page.keyboard.type(m.name)
        pay = page.get_by_role("button", name=f"Pay {money(530)}", exact=True)
        eventually(page, lambda: shown(pay), "pay label with amount due")
        assert not pay.is_enabled(), "pay disabled while step-up is required"
        seen = seen_ids(mail, m.email, STEPUP_SUBJECT["en"])
        tab_until(page, page.get_by_role("button", name="Verify with a code", exact=True))
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Confirm it's you", exact=True)
        code_box = dialog.get_by_role("textbox", name="Verification code", exact=True)
        eventually(page, lambda: focused(code_box), "dialog focuses its field")
        try:
            message = await_mail(mail, m.email, STEPUP_SUBJECT["en"], exclude=seen, seconds=STEPUP_MAIL_S)[0]
        except AssertionError:
            tab_until(page, dialog.get_by_role("button", name="Send a new code", exact=True))
            page.keyboard.press("Enter")
            message = await_mail(mail, m.email, STEPUP_SUBJECT["en"], exclude=seen)[0]
            tab_until(page, code_box)
        page.keyboard.type(code_in(message))
        tab_until(page, dialog.get_by_role("button", name="Verify", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(pay) and pay.is_enabled(), "focus lands on enabled pay", CHECKOUT_WAIT_S)
        page.keyboard.press("Enter")
        eventually(page, lambda: shown(page.get_by_role("heading", name="Booking confirmed", exact=True)), "confirmed", CHECKOUT_WAIT_S)
    with open_app(browser, f"{app_url}/en/") as page:
        page.set_viewport_size(DESKTOP)
        click(page.get_by_role("tab", name=season.title_en, exact=True))
        eventually(page, lambda: stage_attrs(page) == keyboard_values, "pointer reaches the same end values")
    assert 530 in kb_transactions(killbill, kb_account(killbill, key=m.number), "PURCHASE")
    rows = ledger(pg, m.number)
    assert_paired(rows)
    assert member_balance(rows) == 0


def test_wf_member_checkout_priority_refusal(browser, app_url):
    season = create_season(app_url, sale_offset_days=2, screenings=[(FILM_A, "MH2", far_local(app_url, 224))])
    sid = season.ids[0]
    p = signup(app_url)
    with open_app(browser, f"{app_url}/en/signin") as page:
        browser_signin(page, app_url, p.email)
        page.goto(f"{app_url}/en/screenings/{sid}")
        cell = seat(page, "A1")
        eventually(page, lambda: shown(cell), "seat")
        click(cell)
        click(page.get_by_role("button", name="Hold seats", exact=True))
        alert = page.get_by_role("alert", name="Booking error", exact=True)
        eventually(page, lambda: f"Member priority booking is open. Booking opens to everyone on {season.sale} at 10:00." in text_in(alert), "refusal")
        assert path("checkout", hold_id="") not in page.url
    assert {s["code"]: s["state"] for s in Api(app_url).get(f"/api/screenings/{sid}").json()["screening"]["seats"]}["A1"] == "available"


def test_uplift_control(browser, app_url):
    season = on_sale(app_url, "MH2", 225)
    sid = season.ids[0]
    with mouse_page(browser, f"{app_url}/en/screenings/{sid}") as page:
        hold = browser_hold(page, app_url, sid, ["A1"])
        page.goto(f"{app_url}/en/checkout/{hold['id']}")
        switch = page.get_by_role("switch", name="Add a supporter uplift", exact=True)
        group = page.get_by_role("radiogroup", name="Uplift amount", exact=True)
        eventually(page, lambda: shown(switch), "switch")
        assert not switch.is_checked() and not shown(group)
        page.evaluate("() => { window.__probeMotion.length = 0; }")
        choose(page, switch)
        eventually(page, lambda: any(TRANSITION_MIN_MS <= d <= TRANSITION_MAX_MS for d in slide_motion(switch)), "thumb slides in the published time")
        eventually(page, lambda: switch.is_checked() and shown(group), "switch on")
        for amount in (200, 500, 1000):
            assert group.get_by_role("radio", name=money(amount), exact=True).count() == 1
        assert group.get_by_role("radio", name=money(500), exact=True).is_checked()
        summary = page.get_by_role("table", name="Price summary", exact=True)
        eventually(page, lambda: "Supporter uplift (not taxed)" in text_in(summary) and money(500) in text_in(summary), "uplift row")
        choose(page, group.get_by_role("radio", name="Other amount", exact=True))
        other = page.get_by_role("textbox", name="Other amount in dollars", exact=True)
        fill(other, "0.50")
        other.press("Tab")
        eventually(page, lambda: UPLIFT_MSG["en"] in description(other), "English field message")
        fill(other, "12.34")
        other.press("Tab")
        eventually(page, lambda: money(1234) in text_in(summary), "custom amount quoted")
        click(page.get_by_role("button", name="Français", exact=True))
        autre = page.get_by_role("textbox", name="Autre montant en dollars", exact=True)
        eventually(page, lambda: shown(autre), "French field")
        fill(autre, "600")
        autre.press("Tab")
        eventually(page, lambda: UPLIFT_MSG["fr"] in description(autre), "French field message")
    with mouse_page(browser, f"{app_url}/en/screenings/{sid}", reduced_motion="reduce") as page:
        hold = browser_hold(page, app_url, sid, ["A2"])
        page.goto(f"{app_url}/en/checkout/{hold['id']}")
        switch = page.get_by_role("switch", name="Add a supporter uplift", exact=True)
        eventually(page, lambda: shown(switch), "switch")
        page.evaluate("() => { window.__probeMotion.length = 0; }")
        choose(page, switch)
        assert all(d <= REDUCED_MOTION_MAX_MS for d in slide_motion(switch)), slide_motion(switch)
    api = Api(app_url)
    h = make_hold(api, sid, ["B1"])
    for locale in ("en", "fr"):
        for amount in (99, 50001, 250.5):
            r = api.post(f"/api/holds/{h['id']}/quote", {"fares": {"B1": "regular"}, "uplift_cents": amount}, headers={"X-Halide-Locale": locale})
            assert r.status_code == 422 and error(r)["fields"]["uplift_cents"] == UPLIFT_MSG[locale], (locale, amount)
    for amount in (0, 100, 200, 50000):
        assert api.post(f"/api/holds/{h['id']}/quote", {"fares": {"B1": "regular"}, "uplift_cents": amount}).status_code == 200


def resend_when_allowed(api: Api, challenge_id: str) -> Callable[[], Any]:
    def attempt() -> Any:
        r = api.post("/api/stepup/resend", {"challenge_id": challenge_id})
        if r.status_code == 429 and error(r)["code"] == "resend_too_soon":
            return None
        return [r]
    return attempt


def test_stepup_limits(fast_app, mail):
    p = signup(fast_app)

    def timed(fn: Callable[[], httpx.Response]) -> httpx.Response:
        started = time.monotonic()
        response = fn()
        assert time.monotonic() - started < STEPUP_RESPONSE_S
        return response

    seen = seen_ids(mail, p.email, STEPUP_SUBJECT["en"])
    r = timed(lambda: p.api.post("/api/stepup/start", {"purpose": "checkout"}))
    assert r.status_code == 201, r.text
    challenge = r.json()["challenge"]
    local, domain = p.email.split("@")
    assert challenge["masked_email"] == f"{local[0]}***@{domain}" and challenge["delivery"] in ("sent", "queued")
    first = await_mail(mail, p.email, STEPUP_SUBJECT["en"], exclude=seen)[0]
    code1 = code_in(first)
    r = timed(lambda: p.api.post("/api/stepup/resend", {"challenge_id": challenge["id"]}))
    retry = int(r.headers["Retry-After"])
    assert r.status_code == 429 and error(r)["code"] == "resend_too_soon" and 0 < retry <= RESEND_SPACING_S
    assert error(r)["retry_after_seconds"] == retry and error(r)["message"] == f"Wait {retry} s before sending another code."
    poll(lambda: server_now(fast_app) >= iso(challenge["expires_at"]) + timedelta(seconds=1), FAST_CODE_TTL_S * 3, "code expiry")
    r = timed(lambda: p.api.post("/api/stepup/verify", {"challenge_id": challenge["id"], "code": code1}))
    assert r.status_code == 410 and error(r) == {"code": "code_expired", "message": "This code has expired. Send a new code."}
    r = poll(resend_when_allowed(p.api, challenge["id"]), RESEND_SPACING_S * 2, "resend spacing")[0]
    assert r.status_code == 200, r.text
    code2 = code_in(await_mail(mail, p.email, STEPUP_SUBJECT["en"], exclude=seen | {first.get("ID")})[0])
    wrong = f"{(int(code2) + 1) % 1000000:06d}"
    for left in (4, 3, 2, 1):
        r = timed(lambda: p.api.post("/api/stepup/verify", {"challenge_id": challenge["id"], "code": wrong}))
        assert r.status_code == 422 and error(r)["code"] == "code_incorrect" and error(r)["attempts_left"] == left
        assert error(r)["message"] == f"That code isn't right. {left} attempts left."
    r = timed(lambda: p.api.post("/api/stepup/verify", {"challenge_id": challenge["id"], "code": wrong}))
    assert r.status_code == 429 and error(r)["code"] == "stepup_locked"
    assert int(r.headers["Retry-After"]) == FAST_LOCKOUT_S == error(r)["retry_after_seconds"]
    assert error(r)["message"] == f"Too many incorrect codes. Verification is locked for {math.ceil(FAST_LOCKOUT_S / 60)} min."
    for call in (lambda: p.api.post("/api/stepup/verify", {"challenge_id": challenge["id"], "code": code2}), lambda: p.api.post("/api/stepup/start", {"purpose": "gift"})):
        r = timed(call)
        assert r.status_code == 429 and error(r)["code"] == "stepup_locked" and 0 < int(r.headers["Retry-After"]) <= FAST_LOCKOUT_S


def test_stepup_during_outages(mail_down_app):
    for base, delivery, service in ((mail_down_app, {"queued"}, "mail"), (os.environ["APP_KILLBILL_DOWN_URL"], {"sent", "queued"}, "billing")):
        wait_status(base, service, "down")
        q = signup(base)
        started = time.monotonic()
        r = q.api.post("/api/stepup/start", {"purpose": "membership"})
        assert time.monotonic() - started < STEPUP_RESPONSE_S
        assert r.status_code == 201 and r.json()["challenge"]["delivery"] in delivery
        started = time.monotonic()
        r = q.api.post("/api/stepup/start", {"purpose": "membership"})
        assert time.monotonic() - started < STEPUP_RESPONSE_S
        retry = int(r.headers["Retry-After"])
        assert r.status_code == 429 and error(r)["code"] == "resend_too_soon" and 0 < retry <= RESEND_SPACING_S
        assert error(r)["retry_after_seconds"] == retry


def test_stepup_send_limit(fast_app):
    p = signup(fast_app)
    r = p.api.post("/api/stepup/start", {"purpose": "checkout"})
    assert r.status_code == 201, r.text
    challenge = r.json()["challenge"]["id"]
    for _ in range(3):
        r = poll(resend_when_allowed(p.api, challenge), RESEND_SPACING_S * 2, "resend spacing")[0]
        assert r.status_code == 200, r.text
    r = poll(resend_when_allowed(p.api, challenge), RESEND_SPACING_S * 2, "fifth send")[0]
    retry = int(r.headers["Retry-After"])
    assert r.status_code == 429 and error(r)["code"] == "code_send_limit" and 0 < retry <= FAST_LOCKOUT_S
    assert error(r)["retry_after_seconds"] == retry
    assert error(r)["message"] == f"Too many codes sent. Try again in {math.ceil(retry / 60)} min."


def test_stored_credit_zero_payment(app_url, killbill, mail, pg):
    m = member(app_url, "friend", "annual")
    goodwill(app_url, m.number, 4000)
    season = on_sale(app_url, "MH2", 226)
    hold = make_hold(m.api, season.ids[0], ["A1", "A2"])
    fares = {"A1": "member", "A2": "member-guest"}
    quote = m.api.post(f"/api/holds/{hold['id']}/quote", {"fares": fares, "uplift_cents": 500}).json()["quote"]
    assert (quote["total_cents"], quote["credit_applied_cents"], quote["pay_now_cents"], quote["stepup_required"]) == (3030, 3030, 0, True)
    r = m.api.post("/api/checkout", checkout_body(hold, fares, uplift=500), key=idempotency_key())
    assert r.status_code == 403 and error(r) == {"code": "stepup_required", "message": "Confirm it's you with the code we email you."}
    assert m.api.get(f"/api/holds/{hold['id']}").json()["hold"]["state"] == "held"
    assert member_balance(ledger(pg, m.number)) == 4000
    account = kb_account(killbill, key=m.number)
    assert_cba(account, 4000)
    purchases_before = kb_transactions(killbill, account, "PURCHASE")
    verify_stepup(m, mail)
    assert m.api.post(f"/api/holds/{hold['id']}/quote", {"fares": fares, "uplift_cents": 500}).json()["quote"]["stepup_required"] is False
    r = m.api.post("/api/checkout", checkout_body(hold, fares, uplift=500), key=idempotency_key())
    assert r.status_code == 201, r.text
    booking = r.json()["booking"]
    assert (booking["credit_applied_cents"], booking["paid_cents"]) == (3030, 0)
    assert kb_transactions(killbill, account, "PURCHASE") == purchases_before
    rows = ledger(pg, m.number)
    assert_paired(rows)
    assert member_balance(rows) == 970
    assert_cba(account, 970)
    assert sorted((r["ledger_account"], r["amount_cents"]) for r in rows if r["kind"] == "spend") == [("credit-redeemed", 3030), ("member-credit", -3030)]
    credit = m.api.get("/api/me/credit").json()
    assert credit["balance_cents"] == 970 and credit["movements"][0]["kind"] == "spend" and credit["movements"][0]["amount_cents"] == -3030
    body = mail_body(exactly_one(mail, m.email, f"Booking confirmed — {booking['ref']}"))
    assert f"Credit applied: {money(3030)}" in body and f"Paid today: {money(0)}" in body and "View your booking:" in body


def test_pay_control_states(browser, app_url):
    season = on_sale(app_url, "MH2", 227)
    sid = season.ids[0]
    total = expected_total(["regular"])
    with open_app(browser, f"{app_url}/en/screenings/{sid}") as page:
        page.set_viewport_size(DESKTOP)
        hold = browser_hold(page, app_url, sid, ["A1"])
        page.goto(f"{app_url}/en/checkout/{hold['id']}")
        timer = page.get_by_role("timer", name="Hold time remaining", exact=True)
        eventually(page, lambda: shown(timer) and re.match(r"^\d+:\d\d$", timer.inner_text().strip()) is not None, "countdown m:ss")
        remaining = (iso(hold["expires_at"]) - iso(hold["server_time"])).total_seconds()
        minutes, seconds = timer.inner_text().strip().split(":")
        shown_s = int(minutes) * 60 + int(seconds)
        assert remaining - COUNTDOWN_SLACK_S <= shown_s <= remaining
        advance(page, 60000)
        minutes, seconds = timer.inner_text().strip().split(":")
        assert abs((int(minutes) * 60 + int(seconds)) - (shown_s - 60)) <= 1
        pay = page.get_by_role("button", name=f"Pay {money(total)}", exact=True)
        eventually(page, lambda: shown(pay), "pay label")
        assert not pay.is_enabled()
        name, email = person("pay")
        fill(page.get_by_role("textbox", name="Full name", exact=True), name)
        assert not pay.is_enabled()
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        eventually(page, lambda: not pay.is_enabled(), "still disabled without cardholder")
        fill(page.get_by_role("textbox", name="Cardholder name", exact=True), name)
        eventually(page, lambda: pay.is_enabled(), "enabled")
        click(page.get_by_role("button", name="Français", exact=True))
        payer = page.get_by_role("button", name=name_re(f"Payer {money(total, 'fr')}"))
        eventually(page, lambda: shown(payer) and payer.is_enabled(), "French pay label keeps typed values")
        click(page.get_by_role("button", name="English", exact=True))
        eventually(page, lambda: shown(pay) and pay.is_enabled(), "English again")
        with held(page, "**/api/checkout") as gate:
            click(pay)
            pending = page.get_by_role("button", name="Processing payment…", exact=True)
            eventually(page, lambda: shown(pending) and not pending.is_enabled(), "pending label")
            gate.release()
        eventually(page, lambda: shown(page.get_by_role("heading", name="Booking confirmed", exact=True)), "confirmed", CHECKOUT_WAIT_S)
    with open_app(browser, f"{app_url}/en/screenings/{sid}") as page:
        hold = browser_hold(page, app_url, sid, ["A2"])
        page.goto(f"{app_url}/en/checkout/{hold['id']}")
        name, email = person("pay-expiry")
        fill(page.get_by_role("textbox", name="Full name", exact=True), name)
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_role("textbox", name="Cardholder name", exact=True), name)
        remaining = (iso(hold["expires_at"]) - iso(hold["server_time"])).total_seconds()
        advance(page, (remaining + 1) * 1000)
        timer = page.get_by_role("timer", name="Hold time remaining", exact=True)
        eventually(page, lambda: text_in(timer).strip() == "0:00", "countdown at 0:00")
        assert not page.get_by_role("button", name=f"Pay {money(total)}", exact=True).is_enabled()


def test_wf_membership_tiers_join(browser, app_url, killbill):
    p = signup(app_url)
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        fill(page.get_by_role("textbox", name="Email", exact=True), p.email)
        fill(page.get_by_label("Password", exact=True), PATRON_PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        eventually(page, lambda: urlparse(page.url).path == path("account"), "account after sign-in")
        page.goto(f"{app_url}/en/membership")
        radio = page.get_by_role("radiogroup", name="Tier", exact=True).get_by_role("radio", name="Cinephile", exact=True)
        choose(page, radio)
        choose_cadence(page, "Monthly")
        join = page.get_by_role("button", name=f"Join for {money(1200)}", exact=True)
        eventually(page, lambda: shown(join) and join.is_enabled(), "join button")
        click(join)
        eventually(page, lambda: shown(page.get_by_role("heading", name="Membership active", exact=True)), "Membership active", CHECKOUT_WAIT_S)
        assert money(1200) in body_text(page)
    membership = p.api.get("/api/membership").json()["membership"]
    assert (membership["plan"], membership["cadence"], membership["tier"]) == ("cinephile-monthly", "monthly", "cinephile")
    account = kb_account(killbill, key=p.number)
    poll(lambda: kb_transactions(killbill, account, "PURCHASE") == [1200], KB_WAIT_S, "subscription payment")
    assert [s["planName"] for s in kb_subscriptions(account)] == [plan("cinephile", "monthly")]


def test_wf_membership_tiers_upgrade(browser, app_url, killbill, mail):
    m = member(app_url, "cinephile", "monthly")
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        browser_signin(page, app_url, m.email)
        page.goto(f"{app_url}/en/membership")
        radio = page.get_by_role("radio", name="Projectionist", exact=True)
        choose(page, radio)
        choose_cadence(page, "Monthly")
        change = page.get_by_role("button", name="Change tier", exact=True)
        eventually(page, lambda: shown(change) and not change.is_enabled(), "change disabled before step-up")
        seen = seen_ids(mail, m.email, STEPUP_SUBJECT["en"])
        click(page.get_by_role("button", name="Verify with a code", exact=True))
        ui_stepup(page, mail, m.email, seen)
        eventually(page, lambda: focused(change) and change.is_enabled(), "focus on Change tier")
        click(change)
        status = page.get_by_role("status", name="Form status", exact=True)
        eventually(page, lambda: "Your new tier is active. Charged today:" in text_in(status), "upgrade copy", CHECKOUT_WAIT_S)
        shown_amount = text_in(status)
    account = kb_account(killbill, key=m.number)
    poll(lambda: len(kb_transactions(killbill, account, "PURCHASE")) == 2, KB_WAIT_S, "upgrade payment")
    purchases = kb_transactions(killbill, account, "PURCHASE")
    assert f"Charged today: {money(purchases[-1])}." in shown_amount
    assert m.api.get("/api/membership").json()["membership"]["plan"] == "projectionist-monthly"


def test_wf_membership_tiers_downgrade(browser, app_url, mail, killbill):
    m = member(app_url, "projectionist", "annual")
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        browser_signin(page, app_url, m.email)
        page.goto(f"{app_url}/en/membership")
        radio = page.get_by_role("radio", name="Friend", exact=True)
        choose(page, radio)
        choose_cadence(page, "Annual")
        seen = seen_ids(mail, m.email, STEPUP_SUBJECT["en"])
        click(page.get_by_role("button", name="Verify with a code", exact=True))
        ui_stepup(page, mail, m.email, seen)
        click(page.get_by_role("button", name="Change tier", exact=True))
        membership = m.api.get("/api/membership").json()["membership"]
        status = page.get_by_role("status", name="Form status", exact=True)
        eventually(page, lambda: f"Your change takes effect on {membership['charged_through']}. Nothing is charged today." in text_in(status), "downgrade copy", CHECKOUT_WAIT_S)
    membership = m.api.get("/api/membership").json()["membership"]
    assert membership["tier"] == "projectionist" and membership["pending_change"]["tier"] == "friend"
    assert kb_transactions(killbill, kb_account(killbill, key=m.number), "PURCHASE") == [24000]


@pytest.mark.parametrize("case", MENU_CASES, ids=MENU_CASES)
def test_option_menu_focus(browser, app_url, case):
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        if case == "billing-cadence":
            p = signup(app_url)
            browser_signin(page, app_url, p.email)
            page.goto(f"{app_url}/en/membership")
            prefix, listbox_name, labels = "Billing: ", "Billing cadence", ["Annual", "Monthly"]
        else:
            season = on_sale(app_url, "MH2", 228)
            hold = browser_hold(page, app_url, season.ids[0], ["A1"])
            page.goto(f"{app_url}/en/checkout/{hold['id']}")
            prefix, listbox_name, labels = fmt(FARE_BUTTON, seat="A1", fare_label=""), "Fare", [FARE_LABELS["regular"][0], FARE_LABELS["reduced"][0]]
        opener = lambda label: page.get_by_role("button", name=prefix + label, exact=True)
        eventually(page, lambda: any(shown(opener(l)) for l in labels), "menu opener")
        current = [l for l in labels if shown(opener(l))][0]
        other = labels[1] if current == labels[0] else labels[0]
        arrow = "ArrowDown" if other == labels[1] else "ArrowUp"
        listbox = page.get_by_role("listbox", name=listbox_name, exact=True)
        option = lambda label: listbox.get_by_role("option", name=label, exact=True)
        opener(current).focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: shown(listbox) and holds_focus(option(current)), "selected option focused")
        page.keyboard.press(arrow)
        eventually(page, lambda: holds_focus(option(other)), "arrow moves")
        page.keyboard.press("Escape")
        eventually(page, lambda: not shown(listbox) and focused(opener(current)), "Escape closes and returns focus")
        page.keyboard.press("Space")
        eventually(page, lambda: shown(listbox) and holds_focus(option(current)), "Space opens")
        page.keyboard.press("Tab")
        eventually(page, lambda: not shown(listbox) and shown(opener(current)), "Tab closes without change")
        opener(current).focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: holds_focus(option(current)), "reopened")
        page.keyboard.press(arrow)
        eventually(page, lambda: holds_focus(option(other)), "arrow moves again")
        page.keyboard.press("Enter")
        eventually(page, lambda: not shown(listbox) and focused(opener(other)), "Enter chooses and returns focus")


def test_tier_change_timing(app_url, mail, killbill):
    up = member(app_url, "cinephile", "monthly")
    r = up.api.post("/api/membership/change", {"tier": "projectionist", "cadence": "monthly"})
    assert r.status_code == 403 and error(r)["code"] == "stepup_required"
    assert up.api.get("/api/membership").json()["membership"]["plan"] == "cinephile-monthly"
    sent_by = time.monotonic()
    verify_stepup(up, mail, "membership")
    r = up.api.post("/api/stepup/start", {"purpose": "membership"})
    if time.monotonic() - sent_by < RESEND_SPACING_S - 1:
        retry = int(r.headers["Retry-After"])
        assert r.status_code == 429 and error(r)["code"] == "resend_too_soon" and 0 < retry <= RESEND_SPACING_S
        assert error(r)["retry_after_seconds"] == retry
    else:
        assert r.status_code in (201, 429), r.text
    r = up.api.post("/api/membership/change", {"tier": "projectionist", "cadence": "monthly"})
    assert r.status_code == 200 and r.json()["effective"] == "immediate" and r.json()["invoice"] is not None
    assert up.api.get("/api/membership").json()["membership"]["plan"] == "projectionist-monthly"
    assert [s["planName"] for s in kb_subscriptions(kb_account(killbill, key=up.number))] == [plan("projectionist", "monthly")]
    down = member(app_url, "cinephile", "annual")
    verify_stepup(down, mail, "membership")
    charged_through = down.api.get("/api/membership").json()["membership"]["charged_through"]
    r = down.api.post("/api/membership/change", {"tier": "friend", "cadence": "annual"})
    assert r.status_code == 200 and r.json()["effective"] == "end-of-term" and r.json()["invoice"] is None
    assert r.json()["effective_date"] == charged_through
    current = down.api.get("/api/membership").json()["membership"]
    assert current["tier"] == "cinephile" and current["pending_change"] == {"tier": "friend", "cadence": "annual", "effective_date": charged_through}
    r = down.api.post("/api/membership/change", {"tier": "projectionist", "cadence": "annual"})
    assert r.status_code == 409 and error(r) == {"code": "change_pending", "message": f"A change is already scheduled for {charged_through}."}
    assert kb_transactions(killbill, kb_account(killbill, key=down.number), "PURCHASE") == [12000]
    subs = kb_subscriptions(kb_account(killbill, key=down.number))
    assert [s["planName"] for s in subs] == [plan("cinephile", "annual")]
    near = {(date.fromisoformat(charged_through) + timedelta(days=d)).isoformat() for d in (-1, 0, 1)}
    assert any(e.get("plan") == plan("friend", "annual") and (e.get("effectiveDate") or "")[:10] in near for e in subs[0].get("events") or [])
    same = member(app_url, "friend", "annual")
    verify_stepup(same, mail, "membership")
    r = same.api.post("/api/membership/change", {"tier": "friend", "cadence": "annual"})
    assert r.status_code == 409 and error(r) == {"code": "no_change", "message": "That is already your tier and billing."}
    r = same.api.post("/api/membership/change", {"tier": "friend", "cadence": "monthly"})
    assert r.status_code == 200 and r.json()["effective"] == "end-of-term"
    r = same.api.post("/api/membership", {"tier": "cinephile", "cadence": "annual"})
    assert r.status_code == 409 and error(r) == {"code": "already_member", "message": "You already have an active membership."}
    none = signup(app_url)
    verify_stepup(none, mail, "membership")
    r = none.api.post("/api/membership/change", {"tier": "friend", "cadence": "annual"})
    assert r.status_code == 409 and error(r) == {"code": "not_member", "message": "You don't have an active membership."}


def test_tier_change_atomic_on_billing_outage(relay_app, mail, killbill):
    billing_up(relay_app)
    base = relay_app.url
    m = member(base, "cinephile", "monthly")
    verify_stepup(m, mail, "membership")
    before = m.api.get("/api/membership").json()
    relay_app.kb.stop()
    try:
        wait_status(base, "billing", "down", NOTICE_S)
        r = m.api.post("/api/membership/change", {"tier": "projectionist", "cadence": "monthly"})
        assert r.status_code == 503 and error(r) == {"code": "billing_unavailable", "message": BILLING_UNAVAILABLE["en"]}
        assert m.api.get("/api/membership").json() == before
    finally:
        billing_up(relay_app)
    assert m.api.get("/api/membership").json() == before
    assert kb_transactions(killbill, kb_account(killbill, key=m.number), "PURCHASE") == [1200]
    assert not mail_to(mail, m.email, "Your Halide membership has changed")
    r = m.api.post("/api/membership/change", {"tier": "projectionist", "cadence": "monthly"})
    assert r.status_code == 200 and r.json()["effective"] == "immediate", r.text
    assert [s["planName"] for s in kb_subscriptions(kb_account(killbill, key=m.number))] == [plan("projectionist", "monthly")]


def test_proration_from_killbill(app_url, mail, killbill):
    m = member(app_url, "cinephile", "monthly")
    verify_stepup(m, mail, "membership")
    r = m.api.post("/api/membership/change", {"tier": "projectionist", "cadence": "monthly"})
    assert r.status_code == 200, r.text
    invoice = r.json()["invoice"]
    assert sum(i["amount_cents"] for i in invoice["items"]) == invoice["amount_cents"]
    assert invoice["amount_cents"] - invoice["credit_applied_cents"] == invoice["paid_cents"]
    account = kb_account(killbill, key=m.number)
    purchases = kb_transactions(killbill, account, "PURCHASE")
    assert purchases[-1] == invoice["paid_cents"] and len(purchases) == 2
    latest = max(kb_invoices(account), key=lambda inv: int(inv["invoiceNumber"]))
    assert cents(latest["amount"]) == invoice["amount_cents"]
    billed = sorted((it["itemType"], it.get("description") or "", cents(it["amount"])) for it in latest["items"])
    shown_items = sorted((it["type"], it.get("description") or "", it["amount_cents"]) for it in invoice["items"])
    assert shown_items == billed
    body = mail_body(exactly_one(mail, m.email, "Your Halide membership has changed"))
    for line in (f"Prorated charge today: {money(invoice['amount_cents'])}", "From: Cinephile, Monthly", "To: Projectionist, Monthly", f"Takes effect: {r.json()['effective_date']}"):
        assert line in body, line


def test_membership_emails_french(app_url, mail):
    m = member(app_url, "friend", "annual", locale="fr")
    membership = m.join["membership"]
    body = mail_body(exactly_one(mail, m.email, "Votre adhésion Halide a commencé"))
    for line in (f"Numéro de membre : {m.number}", TIER_LINE_FR + TIER_LABELS["friend"][1], "Facturation : Annuelle", f"Montant facturé : {money(6000, 'fr')}", f"Prochaine facturation : {membership['charged_through']}"):
        assert line in body, line
    verify_stepup(m, mail, "membership")
    r = m.api.post("/api/membership/change", {"tier": "friend", "cadence": "monthly"})
    assert r.status_code == 200, r.text
    body = mail_body(exactly_one(mail, m.email, "Votre adhésion Halide a été modifiée"))
    for line in ("Avant : Ami, Annuelle", "Après : Ami, Mensuelle", f"Prend effet : {r.json()['effective_date']}", f"Montant au prorata aujourd'hui : {money(0, 'fr')}"):
        assert line in body, line


def buy_gift(base: str, tier: str = "cinephile", recipient_locale: str = "en", purchaser: SimpleNamespace | None = None) -> SimpleNamespace:
    pname, pemail = person("giver")
    rname, remail = person("giftee")
    api = purchaser.api if purchaser else Api(base)
    r = api.post("/api/gifts", {"tier": tier, "purchaser": {"name": pname, "email": pemail}, "recipient": {"name": rname, "email": remail, "locale": recipient_locale}, "message": "Probe gift message", "cardholder_name": pname}, key=idempotency_key())
    assert r.status_code == 201, r.text
    return SimpleNamespace(gift=r.json()["gift"], pemail=purchaser.email if purchaser else pemail, pname=purchaser.name if purchaser else pname, remail=remail, rname=rname, api=api)


def gift_token(mail: Any, g: SimpleNamespace, subject: str) -> str:
    body = mail_body(exactly_one(mail, g.remail, subject))
    return re.search(link_re("redeem"), body).group(1)


def test_wf_gift_membership_purchase(browser, app_url, killbill, mail):
    pname, pemail = person("gift-ui")
    rname, remail = person("gift-ui-to")
    with open_app(browser, f"{app_url}/en/gift") as page:
        page.set_viewport_size(DESKTOP)
        radio = page.get_by_role("radio", name="Cinephile", exact=True)
        choose(page, radio)
        fill(page.get_by_role("textbox", name="Your name", exact=True), pname)
        fill(page.get_by_role("textbox", name="Your email", exact=True), pemail)
        fill(page.get_by_role("textbox", name="Recipient name", exact=True), rname)
        fill(page.get_by_role("textbox", name="Recipient email", exact=True), remail)
        select(page.get_by_role("combobox", name="Recipient's language", exact=True), "fr")
        fill(page.get_by_role("textbox", name="Cardholder name", exact=True), pname)
        click(page.get_by_role("button", name=f"Buy gift for {money(12000)}", exact=True))
        eventually(page, lambda: shown(page.get_by_role("heading", name="Gift membership purchased", exact=True)), "purchased", CHECKOUT_WAIT_S)
        assert f"We'll email the gift to {remail}." in body_text(page)
    account = kb_account(killbill, email=pemail)
    poll(lambda: kb_transactions(killbill, account, "PURCHASE") == [12000], KB_WAIT_S, "gift payment")
    receipt = mail_body(exactly_one(mail, pemail, "Gift membership receipt — HG-"))
    for line in ("Tier: Cinephile", f"Recipient: {rname}", f"Amount charged: {money(12000)}"):
        assert line in receipt, line
    assert re.search(r"Gift reference: HG-[2-9A-HJ-NP-Z]{6}", receipt)
    delivered = mail_body(exactly_one(mail, remail, f"{pname} vous offre une adhésion Halide"))
    assert TIER_LINE_FR + TIER_LABELS["cinephile"][1] in delivered
    assert re.search(r"Activez votre adhésion : \S+" + link_re("redeem", "fr"), delivered)


def test_wf_gift_membership_redeem(browser, app_url, mail, killbill):
    g = buy_gift(app_url, recipient_locale="en")
    token = gift_token(mail, g, "has given you a Halide membership")
    with open_app(browser, f"{app_url}/en/signup") as page:
        page.set_viewport_size(DESKTOP)
        fill(page.get_by_role("textbox", name="Full name", exact=True), g.rname)
        fill(page.get_by_role("textbox", name="Email", exact=True), g.remail)
        fill(page.get_by_label("Password", exact=True), PATRON_PASSWORD)
        select(page.get_by_role("combobox", name="Preferred language", exact=True), "en")
        click(page.get_by_role("button", name="Create account", exact=True))
        eventually(page, lambda: browser_call(page, app_url, "GET", "/api/me").status == 200, "signed up")
        page.goto(f"{app_url}/en/gift/{token}")
        eventually(page, lambda: shown(page.get_by_role("heading", name="Redeem your gift membership", exact=True)), "redemption page")
        click(page.get_by_role("button", name="Redeem membership", exact=True))
        eventually(page, lambda: shown(page.get_by_role("heading", name="Your gift membership is active", exact=True)), "redeemed", CHECKOUT_WAIT_S)
        membership = browser_call(page, app_url, "GET", "/api/membership").json()["membership"]
    assert membership["plan"] == plan("cinephile", "gift") and membership["cadence"] == "gift"
    assert Api(app_url).get(f"/api/gift-redemptions/{token}").status_code == 404
    assert kb_transactions(killbill, kb_account(killbill, email=g.pemail), "PURCHASE") == [12000]


def test_gift_purchase_atomic_on_billing_outage(relay_app, mail, killbill):
    billing_up(relay_app)
    base = relay_app.url
    pname, pemail = person("gift-outage")
    rname, remail = person("gift-outage-to")
    body = {"tier": "friend", "purchaser": {"name": pname, "email": pemail}, "recipient": {"name": rname, "email": remail, "locale": "en"}, "message": "", "cardholder_name": pname}
    api = Api(base)
    relay_app.kb.stop()
    try:
        wait_status(base, "billing", "down", NOTICE_S)
        r = api.post("/api/gifts", body, key=idempotency_key())
        assert r.status_code == 503 and error(r) == {"code": "billing_unavailable", "message": BILLING_UNAVAILABLE["en"]}
    finally:
        billing_up(relay_app)
    account = killbill.account(pemail)
    assert account is None or kb_transactions(killbill, account, "PURCHASE") == []
    assert not mail_to(mail, pemail) and not mail_to(mail, remail)
    r = api.post("/api/gifts", body, key=idempotency_key())
    assert r.status_code == 201, r.text
    assert kb_transactions(killbill, kb_account(killbill, email=pemail), "PURCHASE") == [6000]
    exactly_one(mail, pemail, "Gift membership receipt — HG-")
    exactly_one(mail, remail, "has given you a Halide membership")


def test_gift_single_use_redemption(app_url, mail):
    g = buy_gift(app_url, "friend")
    token = gift_token(mail, g, "has given you a Halide membership")
    assert TOKEN_RE.match(token)
    r = Api(app_url).get(f"/api/gift-redemptions/{token}")
    assert r.status_code == 200
    assert (r.json()["gift"]["ref"], r.json()["gift"]["tier"], r.json()["gift"]["term_months"]) == (g.gift["ref"], "friend", 12)
    patrons = [signup(app_url) for _ in range(5)]
    results = together([lambda p=p: p.api.post(f"/api/gift-redemptions/{token}/redeem", {}) for p in patrons])
    assert sorted(r.status_code for r in results) == [201, 404, 404, 404, 404]
    assert all(error(r)["code"] == "not_found" for r in results if r.status_code == 404)
    winners = [p for p, r in zip(patrons, results) if r.status_code == 201]
    losers = [p for p, r in zip(patrons, results) if r.status_code == 404]
    assert winners[0].api.get("/api/membership").json()["membership"]["plan"] == plan("friend", "gift")
    assert all(p.api.get("/api/membership").json()["membership"] is None for p in losers)
    assert Api(app_url).get(f"/api/gift-redemptions/{token}").status_code == 404
    assert losers[0].api.post(f"/api/gift-redemptions/{token}/redeem", {}).status_code == 404
    assert Api(app_url).get(f"/api/gift-redemptions/{JUNK_TOKEN}").status_code == 404


def test_gift_subscription_start(app_url, mail, killbill):
    g = buy_gift(app_url, "cinephile")
    token = gift_token(mail, g, "has given you a Halide membership")
    existing = member(app_url)
    r = existing.api.post(f"/api/gift-redemptions/{token}/redeem", {})
    assert r.status_code == 409 and error(r)["code"] == "already_member"
    assert Api(app_url).get(f"/api/gift-redemptions/{token}").status_code == 200
    p = signup(app_url)
    r = p.api.post(f"/api/gift-redemptions/{token}/redeem", {})
    assert r.status_code == 201, r.text
    membership = r.json()["membership"]
    assert r.json()["first_invoice_cents"] == 0
    assert (membership["plan"], membership["cadence"], membership["tier"]) == (plan("cinephile", "gift"), "gift", "cinephile") and membership["ends_on"]
    account = kb_account(killbill, key=p.number)
    assert kb_transactions(killbill, account, "PURCHASE") == []
    assert [s["planName"] for s in kb_subscriptions(account)] == [plan("cinephile", "gift")]
    poll(lambda: (lambda invoices: bool(invoices) and all(cents(inv["amount"]) == 0 for inv in invoices))(kb_invoices(account)), KB_WAIT_S, "gift 0.00 invoice")
    assert kb_transactions(killbill, kb_account(killbill, email=g.pemail), "PURCHASE") == [12000]
    body = mail_body(exactly_one(mail, p.email, "Your Halide membership has started"))
    for line in ("Billing: Gift, 12 months", f"Amount charged: {money(0)}", f"Ends on: {membership['ends_on']}", "Tier: Cinephile"):
        assert line in body, line
    verify_stepup(p, mail, "membership")
    r = p.api.post("/api/membership/change", {"tier": "projectionist", "cadence": "annual"})
    assert r.status_code == 409 and error(r) == {"code": "gift_membership_locked", "message": "Gift memberships can't change tier until they end."}


def test_record_ownership(app_url):
    season = on_sale(app_url, "MH2", 229)
    owner = signup(app_url)
    booking = patron_checkout(owner, season.ids[0], ["A1"], ["regular"])
    hold = make_hold(owner.api, season.ids[0], ["A2"])
    gift = buy_gift(app_url, "friend", purchaser=owner).gift
    other = signup(app_url)
    pairs = [(f"/api/bookings/{booking['ref']}", f"/api/bookings/{UNKNOWN_BOOKING}"),
             (f"/api/holds/{hold['id']}", f"/api/holds/{uuid.uuid4()}"),
             (f"/api/gifts/{gift['ref']}", f"/api/gifts/{UNKNOWN_GIFT}")]
    for theirs, missing in pairs:
        a, b = other.api.get(theirs), other.api.get(missing)
        assert a.status_code == b.status_code == 404 and a.content == b.content, theirs
    a = other.api.post(f"/api/bookings/{booking['ref']}/refund", {})
    b = other.api.post(f"/api/bookings/{UNKNOWN_BOOKING}/refund", {})
    assert a.status_code == b.status_code == 404 and a.content == b.content
    assert owner.api.get(f"/api/bookings/{booking['ref']}").json()["booking"]["state"] == "paid"
    guest = Api(app_url)
    ghold = make_hold(guest, season.ids[0], ["B1"])
    a, b = Api(app_url).get(f"/api/holds/{ghold['id']}"), Api(app_url).get(f"/api/holds/{uuid.uuid4()}")
    assert a.status_code == b.status_code == 404 and a.content == b.content


def test_wf_group_booking_door(browser, app_url, killbill):
    film_time = soon_local(app_url, timedelta(minutes=30))
    season = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_A, "MH1", film_time)])
    sid = season.ids[0]
    p = signup(app_url)
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        browser_signin(page, app_url, p.email)
        page.goto(f"{app_url}/en/screenings/{sid}")
        box = page.get_by_role("checkbox", name="Group booking (10 to 40 seats)", exact=True)
        eventually(page, lambda: shown(box), "group checkbox")
        choose(page, box)
        for code in MH1_GROUP_SEATS:
            click(seat(page, code))
        eventually(page, lambda: attr(seat(page, "B3"), "aria-selected") == "true", "seventeen selected")
        click(page.get_by_role("button", name="Hold seats", exact=True))
        eventually(page, lambda: path("checkout", hold_id="") in page.url, "checkout")
        add = page.get_by_role("button", name="Add payer", exact=True)
        eventually(page, lambda: shown(add), "payer controls")
        while not shown(page.get_by_role("textbox", name=fmt(PAYER_NAME, n=3), exact=True)):
            click(add)
        for n, seats_n in ((1, 6), (2, 6), (3, 5)):
            fill(page.get_by_role("textbox", name=fmt(PAYER_NAME, n=n), exact=True), f"Probe payer {n}")
            fill(page.get_by_role("spinbutton", name=fmt(PAYER_SEATS, n=n), exact=True), str(seats_n))
        fill(page.get_by_role("textbox", name="Cardholder name", exact=True), p.name)
        pay = page.get_by_role("button", name=f"Pay {money(GROUP_TOTAL)}", exact=True)
        eventually(page, lambda: shown(pay) and pay.is_enabled(), "group pay")
        click(pay)
        eventually(page, lambda: shown(page.get_by_role("heading", name="Booking confirmed", exact=True)), "confirmed", CHECKOUT_WAIT_S)
        split = text_in(page.get_by_role("table", name="Cost split", exact=True))
        assert split.count(money(6554)) == 2 and money(5461) in split
    booking = p.api.get("/api/bookings").json()["bookings"][0]
    assert kb_transactions(killbill, kb_account(killbill, key=p.number), "PURCHASE") == [GROUP_TOTAL]
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        browser_signin(page, app_url, *STAFF["door"])
        page.goto(f"{app_url}/en/staff")
        click(page.get_by_role("navigation", name="Staff", exact=True).get_by_role("link", name="Door", exact=True))
        combo = page.get_by_role("combobox", name="Screening", exact=True)
        eventually(page, lambda: shown(combo), "screening picker")
        pick_option(combo, sid)
        search = page.get_by_role("searchbox", name="Ticket or booking code", exact=True)
        fill(search, booking["ref"])
        search.press("Enter")
        eventually(page, lambda: f"Checked in {len(MH1_GROUP_SEATS)} of {len(MH1_GROUP_SEATS)} tickets." in body_text(page), "group checked in")
        assert focused(search) and search.input_value() == ""
    door = staff(app_url, "door")
    tickets = door.get(f"/api/door/screenings/{sid}/list").json()["tickets"]
    assert len(tickets) == len(MH1_GROUP_SEATS) and all(t["status"] == "checked-in" for t in tickets)
    again = door.post(f"/api/door/bookings/{booking['ref']}/check-in", {})
    assert again.status_code == 200 and again.json()["checked_in"] == 0 and again.json()["already_checked_in"] == len(MH1_GROUP_SEATS)


def test_wf_group_booking_split_mismatch(browser, app_url):
    season = on_sale(app_url, "MH1", 231)
    p = signup(app_url)
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        browser_signin(page, app_url, p.email)
        hold = browser_hold(page, app_url, season.ids[0], MH1_GROUP_SEATS, group=True)
        page.goto(f"{app_url}/en/checkout/{hold['id']}")
        add = page.get_by_role("button", name="Add payer", exact=True)
        eventually(page, lambda: shown(add), "payer controls")
        while not shown(page.get_by_role("textbox", name=fmt(PAYER_NAME, n=3), exact=True)):
            click(add)
        for n, seats_n in ((1, 6), (2, 6), (3, 4)):
            fill(page.get_by_role("textbox", name=fmt(PAYER_NAME, n=n), exact=True), f"Probe payer {n}")
            fill(page.get_by_role("spinbutton", name=fmt(PAYER_SEATS, n=n), exact=True), str(seats_n))
        fill(page.get_by_role("textbox", name="Cardholder name", exact=True), p.name)
        pay = page.get_by_role("button", name=f"Pay {money(GROUP_TOTAL)}", exact=True)
        eventually(page, lambda: shown(pay), "pay")
        assert not pay.is_enabled()
        fill(page.get_by_role("spinbutton", name=fmt(PAYER_SEATS, n=3), exact=True), "5")
        eventually(page, lambda: pay.is_enabled(), "enabled once seats add up")
    assert p.api.get("/api/bookings").json()["bookings"] == []
    assert p.api.get(f"/api/holds/{hold['id']}").json()["hold"]["state"] == "held"


def test_group_hold_race(app_url):
    season = on_sale(app_url, "MH1", 230)
    sid = season.ids[0]
    a, b = signup(app_url), signup(app_url)
    block_b = [f"B{n}" for n in range(1, 15)] + ["C1", "C2", "C3"]
    results = together([lambda: a.api.post("/api/holds", {"screening_id": sid, "seats": MH1_GROUP_SEATS, "group": True}),
                        lambda: b.api.post("/api/holds", {"screening_id": sid, "seats": block_b, "group": True})])
    assert sorted(r.status_code for r in results) == [201, 409]
    loser = [r for r in results if r.status_code == 409][0]
    contested = [s for s in MH1_GROUP_SEATS if s in block_b]
    assert error(loser)["code"] == "seat_taken" and sorted(error(loser)["seats"]) == sorted(contested)
    assert error(loser)["message"] == fmt(SEAT_TAKEN_MSG, seats=", ".join(contested))
    assert Api(app_url).get(f"/api/screenings/{sid}").json()["screening"]["seats_remaining"] == MH1_CAPACITY - len(MH1_GROUP_SEATS)


@pytest.mark.parametrize("order", list(SPLIT_CASES), ids=list(SPLIT_CASES))
def test_group_cost_split(app_url, killbill, order):
    seats_by_payer, shares = SPLIT_CASES[order]
    season = on_sale(app_url, "MH1", 232)
    p = signup(app_url)
    assert Api(app_url).post("/api/holds", {"screening_id": season.ids[0], "seats": MH1_GROUP_SEATS, "group": True}).status_code == 401
    r = p.api.post("/api/holds", {"screening_id": season.ids[0], "seats": MH1_GROUP_SEATS[:9], "group": True})
    assert r.status_code == 422 and "Choose 10 to 40 seats for a group." in error(r)["fields"].values()
    hold = make_hold(p.api, season.ids[0], MH1_GROUP_SEATS, group=True)
    fares = {s: "group" for s in MH1_GROUP_SEATS}
    bad = [{"name": "Probe payer one", "seats": 6}, {"name": "Probe payer two", "seats": 6}, {"name": "Probe payer three", "seats": 4}]
    r = p.api.post("/api/checkout", checkout_body(hold, fares, split=bad), key=idempotency_key())
    assert r.status_code == 422 and error(r)["fields"]["split"] == f"Payer seats must add up to {len(MH1_GROUP_SEATS)}."
    split = [{"name": f"Probe payer {i}", "seats": n} for i, n in enumerate(seats_by_payer, 1)]
    r = p.api.post("/api/checkout", checkout_body(hold, fares, split=split), key=idempotency_key())
    assert r.status_code == 201, r.text
    booking = r.json()["booking"]
    assert booking["lines"] == [{"fare": "group", "quantity": 17, "unit_cents": 950, "subtotal_cents": 16150, "gst_cents": 808, "qst_cents": 1611}]
    assert booking["total_cents"] == GROUP_TOTAL
    assert [s["share_cents"] for s in booking["split"]] == shares and sum(shares) == GROUP_TOTAL
    assert kb_transactions(killbill, kb_account(killbill, key=p.number), "PURCHASE") == [GROUP_TOTAL]


def test_door_list_projection(browser, app_url):
    season = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_B, "AC1", soon_local(app_url, timedelta(hours=3)))])
    sid = season.ids[0]
    _, email = person("door-guest")
    full_name = f"zoë Probe {uuid.uuid4().hex[:6]}"
    g = guest_checkout(app_url, sid, ["A1", "A2"], name=full_name, email=email, phone=PROBE_PHONE)
    r = staff(app_url, "door").get(f"/api/door/screenings/{sid}/list")
    data = r.json()
    assert set(data) == {"screening", "tickets"} and set(data["screening"]) == {"id", "film_title", "starts_at", "auditorium"}
    assert len(data["tickets"]) == 2
    for ticket in data["tickets"]:
        assert set(ticket) == {"ticket_code", "seat", "initial", "status", "booking_ref"}
        assert ticket["initial"] == "Z." and ticket["booking_ref"] == g.booking["ref"]
    for secret in (email, full_name, PROBE_PHONE, CARDHOLDER):
        assert secret not in r.text
    code = g.booking["tickets"][0]["code"]
    for caller in (signup(app_url).api, staff(app_url, "finance"), staff(app_url, "programmer")):
        for method, path in (("GET", f"/api/door/screenings/{sid}/list"), ("POST", f"/api/door/tickets/{code}/check-in")):
            denied = caller.request(method, path, {} if method == "POST" else None)
            assert denied.status_code == 403 and error(denied) == {"code": "forbidden", "message": FORBIDDEN["en"]}, path
    assert all(t["status"] == "issued" for t in staff(app_url, "door").get(f"/api/door/screenings/{sid}/list").json()["tickets"])
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        browser_signin(page, app_url, *STAFF["door"])
        page.goto(f"{app_url}/en/staff")
        click(page.get_by_role("navigation", name="Staff", exact=True).get_by_role("link", name="Door", exact=True))
        combo = page.get_by_role("combobox", name="Screening", exact=True)
        eventually(page, lambda: shown(combo), "picker")
        pick_option(combo, sid)
        table = page.get_by_role("table", name="Door list", exact=True)
        eventually(page, lambda: "Z." in text_in(table), "door rows")
        for header in ("Seat", "Initial", "Ticket", "Status"):
            assert table.get_by_role("columnheader", name=header, exact=True).count() == 1
        page_text = body_text(page)
        assert email not in page_text and full_name not in page_text and PROBE_PHONE not in page_text


def test_single_checkin_and_window(app_url):
    open_at = soon_local(app_url, timedelta(minutes=30))
    later = soon_local(app_url, timedelta(hours=3))
    season = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_A, "MH2", open_at), (FILM_B, "AC1", later)])
    single = guest_checkout(app_url, season.ids[0], ["A1"])
    group = guest_checkout(app_url, season.ids[0], ["B1", "B2", "B3"])
    early = guest_checkout(app_url, season.ids[1], ["A1"])
    doors = [staff(app_url, "door") for _ in range(4)]
    code = single.booking["tickets"][0]["code"]
    results = together([lambda d=d: d.post(f"/api/door/tickets/{code}/check-in", {}) for d in doors])
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409]
    winner = [r for r in results if r.status_code == 200][0].json()
    at = iso(winner["checked_in_at"]).astimezone(TORONTO).strftime("%H:%M")
    for r in results:
        if r.status_code == 409:
            assert error(r) == {"code": "already_checked_in", "message": f"Already checked in at {at}."}
    ref = group.booking["ref"]
    results = together([lambda d=d: d.post(f"/api/door/bookings/{ref}/check-in", {}) for d in doors[:3]])
    assert all(r.status_code == 200 for r in results)
    assert sum(r.json()["checked_in"] for r in results) == 3
    statuses = [t["status"] for t in doors[0].get(f"/api/door/screenings/{season.ids[0]}/list").json()["tickets"] if t["booking_ref"] == ref]
    assert statuses == ["checked-in"] * 3
    opens = (datetime.combine(later.date(), later.time(), TORONTO).astimezone(timezone.utc) - CHECKIN_OPENS).astimezone(TORONTO).strftime("%H:%M")
    for path in (f"/api/door/tickets/{early.booking['tickets'][0]['code']}/check-in", f"/api/door/bookings/{early.booking['ref']}/check-in"):
        r = doors[0].post(path, {})
        assert r.status_code == 409 and error(r) == {"code": "checkin_not_open", "message": f"Check-in opens at {opens}."}
    r = group.api.post(f"/api/guest/bookings/{group.token}/refund", {})
    assert r.status_code == 409 and error(r)["code"] in ("booking_checked_in", "refund_window_closed")
    assert group.api.get(f"/api/guest/bookings/{group.token}").json()["booking"]["state"] == "checked-in"


def test_wf_door_checkin_ticket(browser, app_url):
    season = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_A, "MH2", soon_local(app_url, timedelta(minutes=30)))])
    g = guest_checkout(app_url, season.ids[0], ["C4"])
    code = g.booking["tickets"][0]["code"]
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        browser_signin(page, app_url, *STAFF["door"])
        page.goto(f"{app_url}/en/staff")
        click(page.get_by_role("navigation", name="Staff", exact=True).get_by_role("link", name="Door", exact=True))
        search = page.get_by_role("searchbox", name="Ticket or booking code", exact=True)
        eventually(page, lambda: shown(search), "search box")
        fill(search, code.lower())
        click(page.get_by_role("button", name="Check in", exact=True))
        eventually(page, lambda: "Checked in: seat C4." in body_text(page), "ticket checked in")
    tickets = staff(app_url, "door").get(f"/api/door/screenings/{season.ids[0]}/list").json()["tickets"]
    assert [t["status"] for t in tickets if t["ticket_code"] == code] == ["checked-in"]


def test_wf_door_checkin_refused(browser, app_url):
    season = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_A, "MH2", soon_local(app_url, timedelta(minutes=30)))])
    g = guest_checkout(app_url, season.ids[0], ["C5"])
    code = g.booking["tickets"][0]["code"]
    first = staff(app_url, "door").post(f"/api/door/tickets/{code}/check-in", {})
    at = iso(first.json()["checked_in_at"]).astimezone(TORONTO).strftime("%H:%M")
    with open_app(browser, f"{app_url}/en/signin") as page:
        browser_signin(page, app_url, *STAFF["door"])
        page.goto(f"{app_url}/en/staff")
        click(page.get_by_role("navigation", name="Staff", exact=True).get_by_role("link", name="Door", exact=True))
        search = page.get_by_role("searchbox", name="Ticket or booking code", exact=True)
        eventually(page, lambda: shown(search), "search box")
        fill(search, code)
        search.press("Enter")
        alert = page.get_by_role("alert", name="Staff error", exact=True)
        eventually(page, lambda: f"Already checked in at {at}." in text_in(alert), "refusal")
    tickets = staff(app_url, "door").get(f"/api/door/screenings/{season.ids[0]}/list").json()["tickets"]
    assert [t["status"] for t in tickets if t["ticket_code"] == code] == ["checked-in"]


def test_season_lifecycle(app_url):
    prog = staff(app_url, "programmer")
    draft = create_season(app_url, sale_offset_days=-5, screenings=[], schedule=False)
    move = lambda slug, body: prog.post(f"/api/programmer/seasons/{slug}/transition", body)
    r = move(draft.slug, {"to": "scheduled"})
    assert r.status_code == 422 and error(r) == {"code": "season_empty", "message": "Add at least one screening first."}
    assert Api(app_url).get(f"/api/seasons/{draft.slug}").status_code == 404
    prog.post(f"/api/programmer/seasons/{draft.slug}/screenings", {"film_title": FILM_A, "format": "DCP", "auditorium": "AC1", "first_local": far_local(app_url, 233).strftime(LOCAL_FMT), "weeks": 1})
    for target in ("member-priority", "on-sale"):
        r = move(draft.slug, {"to": target})
        assert r.status_code == 409 and error(r) == {"code": "illegal_transition", "message": illegal("draft", target)}
    r = move(draft.slug, {"to": "scheduled"})
    assert r.status_code == 200 and r.json()["season"]["state"] == "on-sale"
    r = move(draft.slug, {"to": "scheduled"})
    assert r.status_code == 409 and error(r)["message"] == illegal("on-sale", "scheduled")
    r = move(draft.slug, {"to": "archived"})
    assert r.status_code == 409 and error(r) == {"code": "season_has_future_screenings", "message": "This season still has upcoming screenings."}
    r = move(draft.slug, {"to": "withdrawn"})
    assert r.status_code == 422 and "reason" in error(r)["fields"]
    priority = create_season(app_url, sale_offset_days=2, screenings=[(FILM_A, "AC1", far_local(app_url, 234))])
    assert Api(app_url).get(f"/api/seasons/{priority.slug}").json()["season"]["state"] == "member-priority"
    r = move(priority.slug, {"to": "withdrawn", "reason": REASON})
    assert r.status_code == 409 and error(r)["message"] == illegal("member-priority", "withdrawn")
    later = create_season(app_url, sale_offset_days=30, screenings=[(FILM_A, "AC1", far_local(app_url, 235))])
    assert Api(app_url).get(f"/api/seasons/{later.slug}").json()["season"]["state"] == "scheduled"
    r = move(later.slug, {"to": "withdrawn", "reason": REASON})
    assert r.status_code == 200 and r.json()["season"]["state"] == "withdrawn" and r.json()["refunded_bookings"] == 0
    r = prog.post(f"/api/programmer/seasons/{later.slug}/screenings", {"film_title": FILM_B, "format": "16mm", "auditorium": "AC1", "first_local": far_local(app_url, 236).strftime(LOCAL_FMT), "weeks": 1})
    assert r.status_code == 409 and error(r) == {"code": "season_closed", "message": "This season is closed to changes."}
    r = move(later.slug, {"to": "scheduled"})
    assert r.status_code == 409 and error(r)["message"] == illegal("withdrawn", "scheduled")
    assert Api(app_url).get(f"/api/seasons/{later.slug}").status_code == 404
    r = prog.post("/api/programmer/seasons", {"slug": later.slug, "title_en": "Probe again", "title_fr": "Essai encore", "public_sale_date": "2026-11-03"})
    assert r.status_code == 409 and error(r) == {"code": "slug_taken", "message": "That season slug is already used."}


@pytest.mark.parametrize("case", list(DST_CASES), ids=list(DST_CASES))
def test_weekly_slots_dst(app_url, fast_app, case):
    first_local, weeks, expected = DST_CASES[case]
    for base in (app_url, fast_app):
        prog = staff(base, "programmer")
        season = create_season(base, sale_offset_days=-5, screenings=[], schedule=False)
        r = prog.post(f"/api/programmer/seasons/{season.slug}/screenings", {"film_title": FILM_A, "format": "35mm", "auditorium": "MH1", "first_local": first_local, "weeks": weeks})
        assert r.status_code == 201, r.text
        assert [s["starts_at"] for s in r.json()["screenings"]] == expected, base


def test_season_withdrawal(app_url, killbill, mail, pg):
    season = on_sale(app_url, "MH2", 237)
    sid = season.ids[0]
    g = guest_checkout(app_url, sid, ["A1"])
    p = signup(app_url, "fr")
    pb = patron_checkout(p, sid, ["A2", "A3"], ["regular", "reduced"])
    live = Api(app_url)
    hold = make_hold(live, sid, ["B1"])
    r = season.prog.post(f"/api/programmer/seasons/{season.slug}/transition", {"to": "withdrawn", "reason": REASON})
    assert r.status_code == 200 and r.json()["refunded_bookings"] == 2 and r.json()["season"]["state"] == "withdrawn"
    ended = live.get(f"/api/holds/{hold['id']}").json()["hold"]
    assert ended["state"] == "expired" and ended["ended_by"] == "season"
    assert p.api.get(f"/api/bookings/{pb['ref']}").json()["booking"]["state"] == "refunded"
    assert kb_transactions(killbill, kb_account(killbill, key=f"guest-{g.email.lower()}"), "REFUND") == [g.booking["paid_cents"]]
    assert kb_transactions(killbill, kb_account(killbill, key=p.number), "REFUND") == [pb["paid_cents"]]
    en = mail_body(exactly_one(mail, g.email, f"Refund issued — {g.booking['ref']}"))
    assert REASON_LINE + "Season withdrawn: " + season.title_en in en and f"Refunded to your card: {money(g.booking['paid_cents'])}" in en
    fr = mail_body(exactly_one(mail, p.email, f"Remboursement émis — {pb['ref']}"))
    assert f"Saison retirée : {season.title_fr}" in fr and f"Remboursé sur votre carte : {money(pb['paid_cents'], 'fr')}" in fr
    for ref in (g.booking["ref"], pb["ref"]):
        assert [row["action"] for row in audit_rows(pg, ref)] == ["refund"]
    withdraw = audit_rows(pg, season.slug)
    assert [row["action"] for row in withdraw] == ["season-withdraw"]
    assert withdraw[0]["amount_cents"] == g.booking["paid_cents"] + pb["paid_cents"]


def test_season_withdrawal_billing_outage(relay_app, mail, killbill):
    billing_up(relay_app)
    base = relay_app.url
    season = on_sale(base, "MH2", 252)
    g = guest_checkout(base, season.ids[0], ["A1"])
    subject = f"Refund issued — {g.booking['ref']}"
    relay_app.kb.stop()
    try:
        wait_status(base, "billing", "down", NOTICE_S)
        r = season.prog.post(f"/api/programmer/seasons/{season.slug}/transition", {"to": "withdrawn", "reason": REASON})
        assert r.status_code == 503 and error(r) == {"code": "billing_unavailable", "message": BILLING_UNAVAILABLE["en"]}
        assert Api(base).get(f"/api/seasons/{season.slug}").json()["season"]["state"] == "on-sale"
    finally:
        billing_up(relay_app)
    assert Api(base).get(f"/api/guest/bookings/{g.token}").json()["booking"]["state"] == "paid"
    account = kb_account(killbill, key=f"guest-{g.email.lower()}")
    assert kb_transactions(killbill, account, "REFUND") == []
    assert not mail_to(mail, g.email, subject)
    r = season.prog.post(f"/api/programmer/seasons/{season.slug}/transition", {"to": "withdrawn", "reason": REASON})
    assert r.status_code == 200 and r.json()["refunded_bookings"] == 1
    assert kb_transactions(killbill, account, "REFUND") == [g.booking["paid_cents"]]
    exactly_one(mail, g.email, subject)


def console(page: Any, base: str, role: str, section: str) -> None:
    browser_signin(page, base, *STAFF[role])
    page.goto(f"{base}/en/staff")
    link = page.get_by_role("navigation", name="Staff", exact=True).get_by_role("link", name=section, exact=True)
    eventually(page, lambda: shown(link), f"{section} link")
    click(link)


def season_row(page: Any, slug: str) -> Any:
    return page.get_by_role("table", name="Seasons", exact=True).get_by_role("row").filter(has_text=slug)


def fall_back_tuesday(today: date) -> date:
    year = today.year
    while True:
        nov1 = date(year, 11, 1)
        first = nov1 + timedelta(days=(6 - nov1.weekday()) % 7) - timedelta(days=12)
        if first > today + timedelta(days=1):
            return first
        year += 1


def test_wf_season_programming_console(browser, app_url):
    first = fall_back_tuesday(toronto_today(app_url))
    expected = [datetime.combine(first + timedelta(weeks=i), dtime(19), TORONTO) for i in range(4)]
    slug = new_slug()
    title = f"Probe {slug}"
    sale = toronto_today(app_url) - timedelta(days=5)
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        console(page, app_url, "programmer", "Programme")
        fill(page.get_by_role("textbox", name="Season slug", exact=True), slug)
        fill(page.get_by_role("textbox", name="Title (English)", exact=True), title)
        fill(page.get_by_role("textbox", name="Title (French)", exact=True), f"Essai {slug}")
        fill(page.get_by_label("Public sale date", exact=True), sale.isoformat())
        click(page.get_by_role("button", name="Create season", exact=True))
        eventually(page, lambda: season_row(page, slug).count() == 1, "season row")
        pick_option(page.get_by_role("combobox", name="Season", exact=True), slug)
        fill(page.get_by_role("textbox", name="Film title", exact=True), FILM_A)
        select(page.get_by_role("combobox", name="Format", exact=True), "35mm")
        select(page.get_by_role("combobox", name="Auditorium", exact=True), "MH2")
        fill(page.get_by_label("First showtime", exact=True), f"{first.isoformat()}T19:00")
        fill(page.get_by_role("spinbutton", name="Weekly occurrences", exact=True), "4")
        click(page.get_by_role("button", name="Add screenings", exact=True))
        status = page.get_by_role("status", name="Staff status", exact=True)
        eventually(page, lambda: fmt(SCREENINGS_ADDED, n=4) in text_in(status), "screenings added")
        click(season_row(page, slug).get_by_role("button", name="Schedule season", exact=True))
        eventually(page, lambda: "Season scheduled." in text_in(status), "scheduled")
    row = [s for s in staff(app_url, "programmer").get("/api/programmer/seasons").json()["seasons"] if s["slug"] == slug][0]
    assert row["state"] == "on-sale"
    assert sorted(iso(s["starts_at"]) for s in row["screenings"]) == expected


def test_wf_season_programming_withdraw(browser, app_url, pg):
    season = on_sale(app_url, "MH2", 238)
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        console(page, app_url, "programmer", "Programme")
        row = season_row(page, season.slug)
        eventually(page, lambda: shown(row), "season row")
        click(row.get_by_role("button", name="Withdraw season", exact=True))
        dialog = page.get_by_role("dialog", name="Withdraw season", exact=True)
        eventually(page, lambda: shown(dialog), "dialog")
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), REASON)
        click(dialog.get_by_role("button", name="Confirm withdrawal", exact=True))
        eventually(page, lambda: fmt(WITHDRAWN_MSG, n=0) in text_in(page.get_by_role("status", name="Staff status", exact=True)), "withdrawn copy", CHECKOUT_WAIT_S)
    row = [s for s in staff(app_url, "programmer").get("/api/programmer/seasons").json()["seasons"] if s["slug"] == season.slug][0]
    assert row["state"] == "withdrawn"
    assert [r["action"] for r in audit_rows(pg, season.slug)] == ["season-withdraw"]


def test_wf_season_programming_slug_taken(browser, app_url):
    season = on_sale(app_url, "MH2", 239)
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        console(page, app_url, "programmer", "Programme")
        fill(page.get_by_role("textbox", name="Season slug", exact=True), season.slug)
        fill(page.get_by_role("textbox", name="Title (English)", exact=True), "Probe duplicate")
        fill(page.get_by_role("textbox", name="Title (French)", exact=True), "Essai doublon")
        fill(page.get_by_label("Public sale date", exact=True), season.sale.isoformat())
        click(page.get_by_role("button", name="Create season", exact=True))
        eventually(page, lambda: "That season slug is already used." in text_in(page.get_by_role("alert", name="Staff error", exact=True)), "conflict shown")
    rows = [s for s in staff(app_url, "programmer").get("/api/programmer/seasons").json()["seasons"] if s["slug"] == season.slug]
    assert len(rows) == 1 and rows[0]["title_en"] == season.title_en


def finance_search(page: Any, query: str) -> Any:
    box = page.get_by_role("searchbox", name="Find booking", exact=True)
    eventually(page, lambda: shown(box), "lookup box")
    fill(box, query)
    box.press("Enter")
    return box


def test_wf_finance_desk_refund(browser, app_url, killbill, pg):
    season = on_sale(app_url, "MH2", 240)
    g = guest_checkout(app_url, season.ids[0], ["A1"])
    ref, paid = g.booking["ref"], g.booking["paid_cents"]
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        console(page, app_url, "finance", "Finance")
        finance_search(page, g.booking["tickets"][0]["code"].lower())
        region = page.get_by_role("region", name=f"Booking {ref}", exact=True)
        eventually(page, lambda: shown(region), "booking region from ticket code")
        click(region.get_by_role("button", name="Refund booking", exact=True))
        dialog = page.get_by_role("dialog", name="Refund booking", exact=True)
        eventually(page, lambda: shown(dialog), "dialog")
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), REASON)
        click(dialog.get_by_role("button", name="Confirm refund", exact=True))
        eventually(page, lambda: f"Refund issued: {money(paid)} to the original payment." in text_in(page.get_by_role("status", name="Staff status", exact=True)), "refund copy", CHECKOUT_WAIT_S)
    assert kb_transactions(killbill, kb_account(killbill, key=f"guest-{g.email.lower()}"), "REFUND") == [paid]
    rows = audit_rows(pg, ref)
    assert [r["action"] for r in rows] == ["refund"] and rows[0]["actor"] == STAFF["finance"][0]


def test_wf_finance_desk_goodwill(browser, app_url, pg):
    p = signup(app_url)
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        console(page, app_url, "finance", "Finance")
        finance_search(page, p.number)
        region = page.get_by_role("region", name=f"Account {p.number}", exact=True)
        eventually(page, lambda: shown(region), "account region")
        click(region.get_by_role("button", name="Issue goodwill credit", exact=True))
        dialog = page.get_by_role("dialog", name="Issue goodwill credit", exact=True)
        eventually(page, lambda: shown(dialog), "dialog")
        fill(dialog.get_by_role("textbox", name="Amount in dollars", exact=True), "15.00")
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), REASON)
        click(dialog.get_by_role("button", name="Issue credit", exact=True))
        eventually(page, lambda: f"Goodwill credit of {money(1500)} issued to {p.number}." in text_in(page.get_by_role("status", name="Staff status", exact=True)), "goodwill copy", CHECKOUT_WAIT_S)
    rows = ledger(pg, p.number)
    assert_paired(rows)
    assert member_balance(rows) == 1500


def test_wf_finance_desk_lookup_miss(browser, app_url):
    g = buy_gift(app_url, "friend")
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        console(page, app_url, "finance", "Finance")
        box = finance_search(page, UNKNOWN_BOOKING)
        eventually(page, lambda: f"No booking, ticket, gift or account matches “{UNKNOWN_BOOKING}”." in body_text(page), "miss copy")
        assert focused(box)
        finance_search(page, g.gift["ref"])
        eventually(page, lambda: shown(page.get_by_role("region", name=f"Gift {g.gift['ref']}", exact=True)), "gift region")
    r = staff(app_url, "finance").get("/api/finance/lookup", params={"q": f"  {g.gift['ref'].lower()} "})
    assert r.status_code == 200 and r.json()["kind"] == "gift"


def test_finance_refund(app_url, mail, killbill, pg):
    m = member(app_url)
    goodwill(app_url, m.number, 2500)
    season = on_sale(app_url, "MH2", 241)
    hold = make_hold(m.api, season.ids[0], ["A1", "A2"])
    verify_stepup(m, mail)
    r = m.api.post("/api/checkout", checkout_body(hold, {"A1": "member", "A2": "member-guest"}, uplift=500), key=idempotency_key())
    booking = r.json()["booking"]
    assert (booking["credit_applied_cents"], booking["paid_cents"]) == (2500, 530)
    fin = staff(app_url, "finance")
    r = fin.post(f"/api/finance/bookings/{booking['ref']}/refund", {"reason": "ab"})
    assert r.status_code == 422 and error(r)["fields"]["reason"] == fmt(LENGTH_MSG, min=3, max=500)
    r = fin.post(f"/api/finance/bookings/{booking['ref']}/refund", {"reason": REASON})
    assert r.status_code == 200, r.text
    refund = r.json()["refund"]
    assert {k: refund[k] for k in ("booking_ref", "refunded_cents", "recredited_cents", "currency", "state")} == {"booking_ref": booking["ref"], "refunded_cents": 530, "recredited_cents": 2500, "currency": "CAD", "state": "refunded"}
    assert isinstance(r.json()["audit_id"], int)
    account = kb_account(killbill, key=m.number)
    assert kb_transactions(killbill, account, "REFUND") == [530]
    assert_cba(account, 2500)
    assert {abs(cents(it["amount"])) for it in kb_items(account) if it.get("description") == f"{booking['ref']} RECREDIT"} == {2500}
    rows = ledger(pg, m.number)
    assert_paired(rows)
    assert member_balance(rows) == 2500
    assert sorted((r["ledger_account"], r["amount_cents"]) for r in rows if r["kind"] == "reversal") == [("credit-redeemed", -2500), ("member-credit", 2500)]
    body = mail_body(exactly_one(mail, m.email, f"Refund issued — {booking['ref']}"))
    assert f"Refunded to your card: {money(530)}" in body and f"Returned to your credit: {money(2500)}" in body and REASON_LINE + "Issued by the box office" in body
    r = fin.post(f"/api/finance/bookings/{booking['ref']}/refund", {"reason": REASON})
    assert r.status_code == 409 and error(r) == {"code": "already_refunded", "message": "This booking was already refunded."}


def test_goodwill_credit(app_url, killbill, pg):
    p = signup(app_url)
    fin = staff(app_url, "finance")
    for amount in (99, 50001):
        r = fin.post("/api/finance/credits", {"account_number": p.number, "amount_cents": amount, "reason": REASON})
        assert r.status_code == 422 and error(r)["fields"]["amount_cents"] == CREDIT_MSG
    r = fin.post("/api/finance/credits", {"account_number": UNKNOWN_ACCOUNT, "amount_cents": 1500, "reason": REASON})
    assert r.status_code == 404 and error(r)["code"] == "not_found"
    assert ledger(pg, p.number) == []
    credit = goodwill(app_url, p.number, 1500)
    assert (credit["account_number"], credit["amount_cents"], credit["currency"], credit["balance_cents"]) == (p.number, 1500, "CAD", 1500)
    rows = ledger(pg, p.number)
    assert_paired(rows)
    assert sorted((r["ledger_account"], r["amount_cents"]) for r in rows) == [("goodwill-expense", -1500), ("member-credit", 1500)]
    audit = audit_rows(pg, p.number)
    assert [(a["action"], a["amount_cents"], a["id"]) for a in audit] == [("goodwill-credit", 1500, credit["audit_id"])]
    account = kb_account(killbill, key=p.number)
    assert account["email"] == p.email
    assert_cba(account, 1500)
    assert {abs(cents(it["amount"])) for it in kb_items(account) if it.get("description") == f"GOODWILL {credit['audit_id']}"} == {1500}
    goodwill(app_url, p.number, 100)
    rows = ledger(pg, p.number)
    assert_paired(rows)
    assert member_balance(rows) == 1500 + 100 == p.api.get("/api/me/credit").json()["balance_cents"]
    assert p.api.get("/api/me").json()["account"]["credit_balance_cents"] == 1500 + 100
    assert_cba(account, 1500 + 100)
    other = signup(app_url)
    credit_view = other.api.get("/api/me/credit").json()
    assert credit_view["balance_cents"] == 0 and credit_view["movements"] == []
    assert ledger(pg, other.number) == []


@pytest.mark.parametrize("case", list(ROLE_CASES), ids=list(ROLE_CASES))
def test_staff_role_enforcement(app_url, pg, case):
    role, method, path = ROLE_CASES[case]
    target = signup(app_url)
    season = on_sale(app_url, "MH2", 242) if "SLUG" in path else None
    path = path.replace("SLUG", season.slug) if season else path
    body: Any = None
    if path == "/api/finance/credits":
        body = {"account_number": target.number, "amount_cents": 1500, "reason": REASON}
    elif path == "/api/programmer/seasons":
        body = {"slug": new_slug(), "title_en": "Probe forbidden", "title_fr": "Essai interdit", "public_sale_date": "2026-11-03"}
    elif season:
        body = {"to": "withdrawn", "reason": REASON}
    elif method == "POST":
        body = {"reason": REASON, "body": "Probe reply"}
    caller = signup(app_url).api if role == "patron" else staff(app_url, role)
    for locale in ("en", "fr"):
        r = caller.request(method, path, body, headers={"X-Halide-Locale": locale})
        assert r.status_code == 403 and error(r) == {"code": "forbidden", "message": FORBIDDEN[locale]}, r.text
    r = Api(app_url).request(method, path, body)
    assert r.status_code == 401 and error(r) == {"code": "unauthenticated", "message": UNAUTHENTICATED["en"]}
    assert ledger(pg, target.number) == []
    if path == "/api/programmer/seasons":
        assert body["slug"] not in [s["slug"] for s in staff(app_url, "programmer").get("/api/programmer/seasons").json()["seasons"]]
    if season:
        assert Api(app_url).get(f"/api/seasons/{season.slug}").json()["season"]["state"] == "on-sale"


def test_audit_append_only(app_url, pg):
    p = signup(app_url)
    first = goodwill(app_url, p.number, 1500)
    second = goodwill(app_url, p.number, 200)
    assert second["audit_id"] > first["audit_id"]
    fin = staff(app_url, "finance")
    entries = {e["id"]: e for e in fin.get("/api/finance/audit").json()["entries"]}
    entry = entries[first["audit_id"]]
    assert (entry["actor"], entry["action"], entry["target"], entry["amount_cents"], entry["reason"]) == (STAFF["finance"][0], "goodwill-credit", p.number, 1500, REASON)
    assert re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$", entry["at"])
    before = audit_rows(pg, p.number)
    for method in ("PUT", "PATCH", "DELETE"):
        r = fin.request(method, f"/api/finance/audit/{first['audit_id']}", {"amount_cents": 1})
        assert r.status_code == 405 and r.headers.get("Allow") == "GET"
        assert error(r) == {"code": "method_not_allowed", "message": "This action isn't allowed here."}
        assert Api(app_url).request(method, f"/api/finance/audit/{first['audit_id']}", {"amount_cents": 1}).status_code == 401
        assert staff(app_url, "door").request(method, f"/api/finance/audit/{first['audit_id']}", {"amount_cents": 1}).status_code == 403
    assert audit_rows(pg, p.number) == before


def assert_recon_identities(recon: dict[str, Any]) -> None:
    local, kb = recon["local"], recon["killbill"]
    net = local["admission_cents"] + local["gst_cents"] + local["qst_cents"] + local["uplift_cents"] + local["gift_cents"] + local["membership_cents"] - local["credit_spent_cents"] - local["refunds_cents"]
    assert local["net_payments_cents"] == net
    assert kb["net_payments_cents"] == kb["payments_cents"] - kb["refunds_cents"]
    assert recon["difference_cents"] == kb["net_payments_cents"] - local["net_payments_cents"]
    assert recon["timezone"] == "America/Toronto"
    if recon["difference_cents"] == 0:
        assert recon["status"] == "matched"
    else:
        assert recon["status"] in ("mismatch", "accepted")


@pytest.mark.parametrize("day", list(RECON_DAYS), ids=list(RECON_DAYS))
def test_reconciliation_business_day(app_url, day):
    fin = staff(app_url, "finance")
    when, length = RECON_DAYS[day]
    if when:
        recon = fin.get(f"/api/finance/reconciliation?date={when}").json()
        d = date.fromisoformat(when)
        start, end = datetime.combine(d, dtime(0), TORONTO), datetime.combine(d + timedelta(days=1), dtime(0), TORONTO)
        assert (recon["date"], recon["window_start"], recon["window_end"]) == (when, start.isoformat(), end.isoformat())
        hours = (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds() / 3600
        assert hours == length
        assert_recon_identities(recon)
        return
    season = on_sale(app_url, "MH2", 243)
    clear_of_midnight(app_url)
    when = toronto_today(app_url).isoformat()
    before = fin.get(f"/api/finance/reconciliation?date={when}").json()
    g = guest_checkout(app_url, season.ids[0], ["A1", "A2"], fares=["regular", "reduced"], uplift=200)
    when_paid = g.booking["paid_at"][:10]
    assert when_paid == when
    after = fin.get(f"/api/finance/reconciliation?date={when}").json()
    b = g.booking
    for key in ("admission_cents", "gst_cents", "qst_cents", "uplift_cents"):
        assert after["local"][key] - before["local"][key] == b[key], key
    assert after["killbill"]["payments_cents"] - before["killbill"]["payments_cents"] == b["paid_cents"]
    assert after["difference_cents"] == before["difference_cents"]
    assert_recon_identities(after)


def test_reconciliation_csv(app_url):
    season = on_sale(app_url, "MH2", 244)
    clear_of_midnight(app_url)
    g = guest_checkout(app_url, season.ids[0], ["A1", "A2"], uplift=200, name=FORMULA_NAME, note=FORMULA_NOTE)
    assert g.api.post(f"/api/guest/bookings/{g.token}/refund", {}).status_code == 200
    when = g.booking["paid_at"][:10]
    fin = staff(app_url, "finance")
    r = fin.get(f"/api/finance/reconciliation.csv?date={when}")
    recon = fin.get(f"/api/finance/reconciliation?date={when}").json()
    assert r.status_code == 200 and r.headers["content-type"].replace(" ", "").lower() == CSV_TYPE.replace(" ", "")
    assert r.headers["content-disposition"] == f'attachment; filename="halide-takings-{when}.csv"'
    assert not r.content.startswith(b"\xef\xbb\xbf")
    body = r.content.decode("utf-8")
    assert "\n" not in body.replace("\r\n", "")
    rows = list(csv.reader(io.StringIO(body, newline="")))
    assert ",".join(rows[0]) == CSV_HEADER
    data = [dict(zip(rows[0], row)) for row in rows[1:] if row]
    b = g.booking
    booking_row = [d for d in data if d["kind"] == "booking" and d["reference"] == b["ref"]]
    refund_row = [d for d in data if d["kind"] == "refund" and d["reference"] == b["ref"]]
    assert len(booking_row) == 1 and len(refund_row) == 1
    expected = {"patron_name": "'" + FORMULA_NAME, "note": "'" + FORMULA_NOTE, "admission": dollars(b["admission_cents"]), "gst": dollars(b["gst_cents"]), "qst": dollars(b["qst_cents"]),
                "uplift": dollars(200), "gift": "0.00", "membership": "0.00", "credit_spent": "0.00", "paid": dollars(b["total_cents"]), "refunded": "0.00"}
    assert {k: booking_row[0][k] for k in expected} == expected
    zeros = {k: "0.00" for k in ("admission", "gst", "qst", "uplift", "gift", "membership", "credit_spent", "paid")}
    assert {k: refund_row[0][k] for k in zeros} == zeros and refund_row[0]["refunded"] == dollars(b["paid_cents"])
    assert refund_row[0]["patron_name"] == "'" + FORMULA_NAME
    times = [iso(d["occurred_at"]) for d in data]
    assert times == sorted(times)
    to_cents = lambda s: cents(s)
    assert sum(to_cents(d["paid"]) for d in data) - sum(to_cents(d["refunded"]) for d in data) == recon["local"]["net_payments_cents"]


def test_wf_reconciliation_load_export(browser, app_url):
    season = on_sale(app_url, "MH2", 245)
    g = guest_checkout(app_url, season.ids[0], ["A1"])
    when = g.booking["paid_at"][:10]
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        console(page, app_url, "finance", "Finance")
        region = page.get_by_role("region", name="Reconciliation", exact=True)
        eventually(page, lambda: shown(region), "reconciliation region")
        fill(region.get_by_label("Business day", exact=True), when)
        click(region.get_by_role("button", name="Load day", exact=True))
        status = staff(app_url, "finance").get(f"/api/finance/reconciliation?date={when}").json()["status"]
        label = {"matched": "Matched", "mismatch": "Mismatch", "accepted": "Accepted"}[status]
        eventually(page, lambda: label in text_in(region), "day status", CHECKOUT_WAIT_S)
        with page.expect_download() as download:
            click(region.get_by_role("link", name="Download CSV", exact=True))
        content = Path(download.value.path()).read_bytes().decode("utf-8")
    assert content.split("\r\n")[0] == CSV_HEADER and g.booking["ref"] in content


def test_wf_reconciliation_accept_refused(browser, app_url, pg):
    fin = staff(app_url, "finance")
    recon = fin.get(f"/api/finance/reconciliation?date={QUIET_DAY}").json()
    assert recon["status"] == "matched" and recon["difference_cents"] == 0
    r = fin.post("/api/finance/reconciliation/accept", {"date": QUIET_DAY, "reason": REASON})
    assert r.status_code == 409 and error(r) == {"code": "nothing_to_accept", "message": "This day already matches Kill Bill."}
    assert audit_rows(pg, QUIET_DAY) == []
    with open_app(browser, f"{app_url}/en/signin") as page:
        console(page, app_url, "finance", "Finance")
        region = page.get_by_role("region", name="Reconciliation", exact=True)
        eventually(page, lambda: shown(region), "region")
        fill(region.get_by_label("Business day", exact=True), QUIET_DAY)
        click(region.get_by_role("button", name="Load day", exact=True))
        eventually(page, lambda: "Matched" in text_in(region), "Matched")


def test_wf_reconciliation_accept_mismatch(browser, app_url, killbill, pg):
    season = on_sale(app_url, "MH2", 253)
    clear_of_midnight(app_url)
    g = guest_checkout(app_url, season.ids[0], ["A1"])
    when = g.booking["paid_at"][:10]
    account = kb_account(killbill, key=f"guest-{g.email.lower()}")
    fin = staff(app_url, "finance")
    before = fin.get(f"/api/finance/reconciliation?date={when}").json()
    kb_request("POST", f"/1.0/kb/accounts/{account['accountId']}/payments", {"transactionType": "PURCHASE", "amount": EXTRA_PURCHASE_CENTS / 100, "currency": "CAD"})
    diff = before["difference_cents"] + EXTRA_PURCHASE_CENTS
    recon = poll(lambda: (lambda r: r if r["difference_cents"] == diff else None)(fin.get(f"/api/finance/reconciliation?date={when}").json()), KB_WAIT_S, "mismatch from the extra Kill Bill purchase")
    assert recon["status"] == "mismatch"
    earlier = {a["id"] for a in audit_rows(pg, when)}
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        console(page, app_url, "finance", "Finance")
        region = page.get_by_role("region", name="Reconciliation", exact=True)
        eventually(page, lambda: shown(region), "region")
        fill(region.get_by_label("Business day", exact=True), when)
        click(region.get_by_role("button", name="Load day", exact=True))
        eventually(page, lambda: "Mismatch" in text_in(region), "Mismatch", CHECKOUT_WAIT_S)
        click(region.get_by_role("button", name="Accept Kill Bill figure", exact=True))
        dialog = page.get_by_role("dialog", name="Accept Kill Bill figure", exact=True)
        eventually(page, lambda: shown(dialog), "dialog")
        fill(dialog.get_by_role("textbox", name="Reason", exact=True), REASON)
        click(dialog.get_by_role("button", name="Confirm", exact=True))
        confirmation = f"Kill Bill total accepted for {when}. The difference of "
        if diff > 0:
            confirmation += f"{money(diff)} is recorded in the audit list."
        eventually(page, lambda: confirmation in body_text(page), "acceptance confirmation", CHECKOUT_WAIT_S)
        eventually(page, lambda: "Accepted" in text_in(region), "Accepted")
    after = fin.get(f"/api/finance/reconciliation?date={when}").json()
    assert after["status"] == "accepted" and after["accepted_difference_cents"] == diff
    new = [a for a in audit_rows(pg, when) if a["id"] not in earlier]
    assert [(a["action"], a["amount_cents"], a["actor"], a["reason"]) for a in new] == [("reconciliation-accept", diff, STAFF["finance"][0], REASON)]


@pytest.mark.parametrize("case", NEXT_CASE_IDS, ids=NEXT_CASE_IDS)
def test_signup_signin_return(app_url, case):
    nxt, safe = NEXT_CASES[case]
    p = signup(app_url, "fr")
    assert re.match(r"^A-\d{6}$", p.number) and p.account["role"] == "patron"
    r = Api(app_url).post("/api/auth/signup", {"name": p.name, "email": p.email, "password": PATRON_PASSWORD, "locale": "en"})
    assert r.status_code == 409 and error(r) == {"code": "email_taken", "message": "An account already uses this email."}
    r = Api(app_url).post("/api/auth/signup", {"name": p.name, "email": "probe-short@patrons.example", "password": "short", "locale": "en"})
    assert r.status_code == 422 and error(r)["fields"]["password"] == fmt(LENGTH_MSG, min=10, max=128)
    r = Api(app_url).post("/api/auth/signin", {"email": p.email, "password": "Wrong-Pass-2026!"})
    assert r.status_code == 401 and error(r) == {"code": "invalid_credentials", "message": "Email or password is incorrect."}
    r = Api(app_url).post("/api/auth/signin", {"email": p.email, "password": PATRON_PASSWORD, "next": nxt})
    assert r.status_code == 200
    assert r.json()["redirect"] == (nxt if safe else path("account", "fr"))
    r = Api(app_url).post("/api/auth/signin", {"email": STAFF["finance"][0], "password": STAFF["finance"][1]})
    assert r.json()["redirect"] == path("staff", "fr")


def test_self_service_refund_window(app_url, killbill, mail):
    later = soon_local(app_url, timedelta(hours=3))
    close = soon_local(app_url, timedelta(minutes=90))
    season = create_season(app_url, sale_offset_days=-5, screenings=[(FILM_A, "MH2", later), (FILM_B, "AC1", close)])
    p = signup(app_url)
    ok = patron_checkout(p, season.ids[0], ["A1"], ["regular"])
    stranger = signup(app_url)
    a = stranger.api.post(f"/api/bookings/{ok['ref']}/refund", {})
    b = stranger.api.post(f"/api/bookings/{UNKNOWN_BOOKING}/refund", {})
    assert a.status_code == b.status_code == 404 and a.content == b.content
    r = p.api.post(f"/api/bookings/{ok['ref']}/refund", {})
    assert r.status_code == 200 and r.json()["refund"]["refunded_cents"] == ok["paid_cents"] and r.json()["refund"]["recredited_cents"] == 0
    assert kb_transactions(killbill, kb_account(killbill, key=p.number), "REFUND") == [ok["paid_cents"]]
    assert REASON_LINE + "Requested by you" in mail_body(exactly_one(mail, p.email, f"Refund issued — {ok['ref']}"))
    seats = {s["code"]: s["state"] for s in Api(app_url).get(f"/api/screenings/{season.ids[0]}").json()["screening"]["seats"]}
    assert seats["A1"] == "available"
    r = p.api.post(f"/api/bookings/{ok['ref']}/refund", {})
    assert r.status_code == 409 and error(r)["code"] == "already_refunded"
    late = patron_checkout(p, season.ids[1], ["A1"], ["regular"])
    for caller, path, body in ((p.api, f"/api/bookings/{late['ref']}/refund", {}), (staff(app_url, "finance"), f"/api/finance/bookings/{late['ref']}/refund", {"reason": REASON})):
        r = caller.post(path, body)
        assert r.status_code == 409 and error(r) == {"code": "refund_window_closed", "message": REFUND_CLOSED_MSG}
    assert p.api.get(f"/api/bookings/{late['ref']}").json()["booking"]["state"] == "paid"
    assert kb_transactions(killbill, kb_account(killbill, key=p.number), "REFUND") == [ok["paid_cents"]]


def refund_through_dialog(page: Any) -> None:
    click(page.get_by_role("button", name="Refund booking", exact=True))
    dialog = page.get_by_role("dialog", name="Refund booking", exact=True)
    eventually(page, lambda: shown(dialog), "refund dialog")
    click(dialog.get_by_role("button", name="Confirm refund", exact=True))


def test_wf_patron_account_signin_refund(browser, app_url, killbill):
    season = on_sale(app_url, "MH2", 246)
    p = signup(app_url)
    booking = patron_checkout(p, season.ids[0], ["A1"], ["regular"])
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        fill(page.get_by_role("textbox", name="Email", exact=True), p.email)
        fill(page.get_by_label("Password", exact=True), PATRON_PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        eventually(page, lambda: urlparse(page.url).path == path("account"), "account page")
        table = page.get_by_role("table", name="My bookings", exact=True)
        eventually(page, lambda: booking["ref"] in text_in(table), "booking listed")
        page.goto(f"{app_url}/en/account/bookings/{booking['ref']}")
        eventually(page, lambda: shown(page.get_by_role("heading", name=f"Booking {booking['ref']}", exact=True)), "booking heading")
        refund_through_dialog(page)
        eventually(page, lambda: f"Refund issued: {money(booking['paid_cents'])} to the original payment." in body_text(page), "refund copy", CHECKOUT_WAIT_S)
    assert p.api.get(f"/api/bookings/{booking['ref']}").json()["booking"]["state"] == "refunded"
    assert kb_transactions(killbill, kb_account(killbill, key=p.number), "REFUND") == [booking["paid_cents"]]


def test_wf_patron_account_guest_link_refund(browser, app_url, killbill):
    season = on_sale(app_url, "MH2", 247)
    g = guest_checkout(app_url, season.ids[0], ["A2"])
    with open_app(browser, f"{app_url}{g.link}") as page:
        page.set_viewport_size(DESKTOP)
        eventually(page, lambda: shown(page.get_by_role("heading", name=f"Booking {g.booking['ref']}", exact=True)), "booking page")
        refund_through_dialog(page)
        eventually(page, lambda: f"Refund issued: {money(g.booking['paid_cents'])} to the original payment." in body_text(page), "refund copy", CHECKOUT_WAIT_S)
    assert kb_transactions(killbill, kb_account(killbill, key=f"guest-{g.email.lower()}"), "REFUND") == [g.booking["paid_cents"]]
    assert Api(app_url).get(f"/api/guest/bookings/{g.token}").status_code == 404


def test_wf_patron_enquiry_reply(browser, app_url, mail, pg):
    name, email = person("enquirer")
    subject = f"Probe question {uuid.uuid4().hex[:6]}"
    with open_app(browser, f"{app_url}/fr/contact") as page:
        page.set_viewport_size(DESKTOP)
        fill(page.get_by_role("textbox", name="Nom complet", exact=True), name)
        fill(page.get_by_role("textbox", name="Courriel", exact=True), email)
        fill(page.get_by_role("textbox", name="Objet", exact=True), subject)
        fill(page.get_by_role("textbox", name="Message", exact=True), "Probe enquiry message")
        click(page.get_by_role("button", name="Envoyer la demande", exact=True))
        status = page.get_by_role("status", name="État du formulaire", exact=True)
        eventually(page, lambda: re.search(r"Merci\. Votre demande EQ-[2-9A-HJ-NP-Z]{6} a bien été reçue\. Nous répondons par courriel\.", text_in(status)) is not None, "acknowledgement")
        ref = re.search(r"EQ-[2-9A-HJ-NP-Z]{6}", text_in(status)).group(0)
    r = staff(app_url, "door").post(f"/api/finance/enquiries/{ref}/reply", {"body": "Probe door reply"})
    assert r.status_code == 403 and error(r) == {"code": "forbidden", "message": FORBIDDEN["en"]}
    reply = REPLY_TEXT
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        console(page, app_url, "finance", "Finance")
        row = page.get_by_role("table", name="Enquiries", exact=True).get_by_role("row").filter(has_text=ref)
        eventually(page, lambda: shown(row) and subject in text_in(row), "enquiry row")
        click(row.get_by_role("button", name=fmt(OPEN_ENQUIRY, ref=ref), exact=True))
        fill(page.get_by_role("textbox", name="Reply", exact=True), reply)
        click(page.get_by_role("button", name="Send reply", exact=True))
        eventually(page, lambda: f"Reply recorded. It will be emailed to {email}." in text_in(page.get_by_role("status", name="Staff status", exact=True)), "reply recorded")
    body = mail_body(exactly_one(mail, email, f"Re : {subject} [{ref}]"))
    assert reply in body and f"Référence de la demande : {ref}" in body and "— Billetterie de la Société du film Halide" in body
    enquiry = [e for e in staff(app_url, "finance").get("/api/finance/enquiries").json()["enquiries"] if e["ref"] == ref][0]
    assert enquiry["state"] == "answered" and enquiry["locale"] == "fr"
    audit = audit_rows(pg, ref)
    assert [(a["action"], a["amount_cents"], a["reason"], a["actor"]) for a in audit] == [("enquiry-reply", None, subject, STAFF["finance"][0])]


def test_enquiry_reply_mail_recovery(mail_app, mail):
    mail_up(mail_app)
    base = mail_app.url
    name, email = person("enquiry-relay")
    subject = f"Probe relay {uuid.uuid4().hex[:6]}"
    r = Api(base, "fr").post("/api/enquiries", {"name": name, "email": email, "subject": subject, "message": "Probe relay message"})
    assert r.status_code == 201, r.text
    ref = r.json()["enquiry"]["ref"]
    fin = staff(base, "finance")
    mail_app.smtp.stop()
    try:
        wait_status(base, "mail", "down", NOTICE_S)
        r = fin.post(f"/api/finance/enquiries/{ref}/reply", {"body": RELAY_REPLY})
        assert r.status_code == 201, r.text
        assert not mail_to(mail, email)
    finally:
        mail_app.smtp.start()
    wait_status(base, "mail", "up", NOTICE_S)
    body = mail_body(exactly_one(mail, email, f"Re : {subject} [{ref}]"))
    assert RELAY_REPLY in body


def test_wf_patron_enquiry_validation(browser, app_url):
    name, email = person("enquirer-empty")
    with open_app(browser, f"{app_url}/en/contact") as page:
        fill(page.get_by_role("textbox", name="Full name", exact=True), name)
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_role("textbox", name="Subject", exact=True), "Probe empty message")
        message = page.get_by_role("textbox", name="Message", exact=True)
        send = page.get_by_role("button", name="Send enquiry", exact=True)
        native = lambda: bool(message.first.evaluate("e => !!(e.validity && e.validity.valueMissing)"))
        served = lambda: VALIDATION["en"] in text_in(page.get_by_role("alert", name="Form error", exact=True)) and REQUIRED["en"] in description(message)
        if send.first.is_enabled():
            click(send)
            eventually(page, lambda: served() or native() or REQUIRED["en"] in description(message), "missing message refused")
        assert not [e for e in staff(app_url, "finance").get("/api/finance/enquiries").json()["enquiries"] if e["email"] == email]
        fill(message, "Probe enquiry message")
        click(send)
        status = page.get_by_role("status", name="Form status", exact=True)
        ack = r"Thank you\. Your enquiry (EQ-[2-9A-HJ-NP-Z]{6}) has been received\. We reply by email\."
        eventually(page, lambda: re.search(ack, text_in(status)) is not None, "acknowledgement after recovery")
        ref = re.search(ack, text_in(status)).group(1)
    stored = [e for e in staff(app_url, "finance").get("/api/finance/enquiries").json()["enquiries"] if e["email"] == email]
    assert [e["ref"] for e in stored] == [ref]


def notice_text(page: Any, locale: str = "en") -> str:
    return text_in(page.get_by_role("alert", name="Service notice" if locale == "en" else "Avis de service", exact=True))


def test_service_notices(browser, relay_app, mail_down_app):
    kb_down, mail_down = os.environ["APP_KILLBILL_DOWN_URL"], mail_down_app
    wait_status(kb_down, "billing", "down")
    wait_status(mail_down, "mail", "down")
    with open_app(browser, f"{kb_down}/en/") as page:
        eventually(page, lambda: BILLING_NOTICE["en"] in notice_text(page), "billing notice at boot", NOTICE_S, step_ms=NOTICE_STEP_MS)
    with open_app(browser, f"{mail_down}/fr/") as page:
        eventually(page, lambda: MAIL_NOTICE["fr"] in notice_text(page, "fr"), "mail notice at boot", NOTICE_S, step_ms=NOTICE_STEP_MS)
    billing_up(relay_app)
    season = on_sale(relay_app.url, "MH2", 254)
    hold = make_hold(Api(relay_app.url), season.ids[0], ["A1"])
    name, email = person("cut")
    with open_app(browser, f"{relay_app.url}/en/contact") as page:
        eventually(page, lambda: shown(page.get_by_role("heading", level=1)), "page")
        assert BILLING_NOTICE["en"] not in notice_text(page)
        relay_app.kb.stop()
        try:
            Api(relay_app.url).post("/api/checkout", checkout_body(hold, {"A1": "regular"}, guest={"name": name, "email": email}), key=idempotency_key())
            wait_status(relay_app.url, "billing", "down", NOTICE_S)
            eventually(page, lambda: BILLING_NOTICE["en"] in notice_text(page), "notice appears", NOTICE_S, step_ms=NOTICE_STEP_MS)
        finally:
            relay_app.kb.start()
        wait_status(relay_app.url, "billing", "up", NOTICE_S)
        eventually(page, lambda: BILLING_NOTICE["en"] not in notice_text(page), "notice clears", NOTICE_S, step_ms=NOTICE_STEP_MS)


def test_billing_outage_changes_nothing(relay_app, mail, pg):
    billing_up(relay_app)
    base = relay_app.url
    season = on_sale(base, "MH2", 248)
    p = signup(base)
    booking = patron_checkout(p, season.ids[0], ["A1"], ["regular"])
    hold = make_hold(p.api, season.ids[0], ["A2"])
    fin = staff(base, "finance")
    _, recipient = person("outage-gift")
    snapshot = lambda: (p.api.get(f"/api/bookings/{booking['ref']}").json(), {k: v for k, v in p.api.get(f"/api/holds/{hold['id']}").json()["hold"].items() if k != "server_time"},
                        p.api.get("/api/membership").json(), p.api.get("/api/me/credit").json(), p.api.get("/api/bookings").json(), Api(base).get(f"/api/seasons/{season.slug}").json())
    before = snapshot()
    relay_app.kb.stop()
    try:
        wait_status(base, "billing", "down", NOTICE_S)
        calls = [
            p.api.post("/api/holds", {"screening_id": season.ids[0], "seats": ["B1"], "group": False}),
            p.api.post(f"/api/holds/{hold['id']}/quote", {"fares": {"A2": "regular"}, "uplift_cents": 0}),
            p.api.delete(f"/api/holds/{hold['id']}"),
            p.api.post("/api/checkout", checkout_body(hold, {"A2": "regular"}), key=idempotency_key()),
            p.api.post("/api/gifts", {"tier": "friend", "recipient": {"name": "Probe Recipient", "email": recipient, "locale": "en"}, "message": "", "cardholder_name": p.name}, key=idempotency_key()),
            p.api.post("/api/membership", {"tier": "friend", "cadence": "annual"}),
            p.api.post(f"/api/bookings/{booking['ref']}/refund", {}),
            fin.post("/api/finance/credits", {"account_number": p.number, "amount_cents": 1500, "reason": REASON}),
            fin.get(f"/api/finance/reconciliation?date={toronto_today(base)}"),
            season.prog.post(f"/api/programmer/seasons/{season.slug}/transition", {"to": "withdrawn", "reason": REASON}),
        ]
        for r in calls:
            assert r.status_code == 503 and error(r) == {"code": "billing_unavailable", "message": BILLING_UNAVAILABLE["en"]}, r.request.url
        during = snapshot()
    finally:
        billing_up(relay_app)
    after = snapshot()
    assert before == during == after
    assert ledger(pg, p.number) == []
    assert not mail_to(mail, recipient)
    assert p.api.delete(f"/api/holds/{hold['id']}").status_code == 200


def test_mail_outbox_retry_schedule(mail_app, mail):
    mail_up(mail_app)
    base = mail_app.url
    fin = staff(base, "finance")
    sent = []
    for i in range(2):
        name, email = person(f"outbox{i}")
        r = Api(base).post("/api/enquiries", {"name": name, "email": email, "subject": f"Probe outbox {i}", "message": "Probe outbox message"})
        assert r.status_code == 201, r.text
        sent.append((r.json()["enquiry"]["ref"], email, i))
    keys = [fmt(REPLY_KEY, enquiry_ref=ref, n=1) for ref, _, _ in sent]
    mail_app.smtp.stop()
    try:
        wait_status(base, "mail", "down", NOTICE_S)
        for ref, _, i in sent:
            r = fin.post(f"/api/finance/enquiries/{ref}/reply", {"body": f"Probe outbox reply {i}"})
            assert r.status_code == 201, r.text

        def head_ready() -> Any:
            messages = {m["key"]: m for m in fin.get("/api/finance/outbox").json()["messages"]}
            head, behind = messages.get(keys[0]), messages.get(keys[1])
            if not head or not behind:
                return None
            failed = [a for a in head["attempts"] if a["outcome"] == "failed" and a["finished_at"]]
            return (head, behind) if len(failed) >= 4 else None

        head, behind = poll(head_ready, RETRY_OBSERVE_S, "four failed attempts on the outbox head")
        assert head["state"] == "pending" and behind["state"] == "pending" and behind["attempts"] == []
        attempts = sorted(head["attempts"], key=lambda a: iso(a["started_at"]))
        delays = list(RETRY_DELAYS_S) + [RETRY_EVERY_S] * len(attempts)
        for prev, nxt, delay in zip(attempts, attempts[1:], delays):
            if not prev["finished_at"]:
                continue
            gap = (iso(nxt["started_at"]) - iso(prev["finished_at"])).total_seconds()
            assert delay <= gap <= delay + RETRY_SLACK_S, (delay, gap)
        for _, email, _ in sent:
            assert not mail_to(mail, email)
    finally:
        mail_up(mail_app)
    for ref, email, i in sent:
        exactly_one(mail, email, f"Re: Probe outbox {i} [{ref}]")


def test_mail_recovery_drain(mail):
    relay = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    try:
        with app_copy({"DATABASE_URL": scratch_database(), "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(relay.port)}) as base:
            wait_status(base, "mail", "down", NOTICE_S)
            fin = staff(base, "finance")
            sent = []
            for i in range(3):
                name, email = person(f"drain{i}")
                ref = Api(base).post("/api/enquiries", {"name": name, "email": email, "subject": f"Probe drain {i}", "message": "Probe drain message"}).json()["enquiry"]["ref"]
                assert fin.post(f"/api/finance/enquiries/{ref}/reply", {"body": f"Probe drain reply {i}"}).status_code == 201
                sent.append((ref, email, i))
            relay.start()
            wait_status(base, "mail", "up", NOTICE_S)
            for ref, email, i in sent:
                exactly_one(mail, email, f"Re: Probe drain {i} [{ref}]")
            messages = {m["key"]: m for m in fin.get("/api/finance/outbox").json()["messages"]}
            mine = [messages[fmt(REPLY_KEY, enquiry_ref=ref, n=1)] for ref, _, _ in sent]
            assert all(m["state"] == "sent" for m in mine)
            finished = [max(iso(a["finished_at"]) for a in m["attempts"] if a["outcome"] == "sent") for m in sorted(mine, key=lambda m: m["seq"])]
            assert finished == sorted(finished)
    finally:
        relay.stop()


def test_wf_service_outages_billing_notice(browser, relay_app):
    billing_up(relay_app)
    p = signup(relay_app.url)
    with open_app(browser, f"{relay_app.url}/en/signin") as page:
        page.set_viewport_size(DESKTOP)
        browser_signin(page, relay_app.url, p.email)
        page.goto(f"{relay_app.url}/en/membership")
        tier = page.get_by_role("radiogroup", name="Tier", exact=True).get_by_role("radio", name=TIER_LABELS["friend"][0], exact=True)
        eventually(page, lambda: shown(tier), "tier choice")
        choose(page, tier)
        join = page.get_by_role("button", name=re.compile(r"^Join for "))
        eventually(page, lambda: shown(join) and join.first.is_enabled(), "join enabled")
        relay_app.kb.stop()
        try:
            eventually(page, lambda: BILLING_NOTICE["en"] in notice_text(page) and not join.first.is_enabled(), "notice and disabled join", NOTICE_S * 2, step_ms=NOTICE_STEP_MS)
        finally:
            relay_app.kb.start()
        eventually(page, lambda: BILLING_NOTICE["en"] not in notice_text(page) and join.first.is_enabled(), "recovered", NOTICE_S * 2, step_ms=NOTICE_STEP_MS)
    assert p.api.get("/api/membership").json()["membership"] is None


def test_wf_service_outages_mail_delayed(browser, killbill, mail_down_app):
    base = mail_down_app
    season = on_sale(base, "MH2", 249)
    name, email = person("mail-down")
    with open_app(browser, f"{base}/en/screenings/{season.ids[0]}") as page:
        page.set_viewport_size(DESKTOP)
        hold = browser_hold(page, base, season.ids[0], ["A1"])
        page.goto(f"{base}/en/checkout/{hold['id']}")
        full_name = page.get_by_role("textbox", name="Full name", exact=True)
        eventually(page, lambda: shown(full_name), "checkout form")
        fill(full_name, name)
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_role("textbox", name="Cardholder name", exact=True), name)
        pay = page.get_by_role("button", name=f"Pay {money(expected_total(['regular']))}", exact=True)
        eventually(page, lambda: shown(pay) and pay.is_enabled(), "pay enabled")
        click(pay)
        eventually(page, lambda: shown(page.get_by_role("heading", name="Booking confirmed", exact=True)), "confirmed", CHECKOUT_WAIT_S)
        eventually(page, lambda: MAIL_DELAYED in body_text(page), "mail-delayed line")
    account = kb_account(killbill, email=email)
    poll(lambda: kb_transactions(killbill, account, "PURCHASE") == [expected_total(["regular"])], KB_WAIT_S, "booking payment")


def test_health_and_port(app_url, mail_down_app):
    assert urlparse(app_url).port == APP_PORT
    for base in (app_url, os.environ["APP_KILLBILL_DOWN_URL"], mail_down_app):
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert r.headers["content-type"].replace(" ", "").lower().startswith("application/json")


def test_nothing_private_leaves(browser, app_url, mail):
    secrets = [v for k in ("DATABASE_URL", "KILLBILL_URL", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY") if (v := os.environ.get(k)) and (len(v) >= 12 or not v.isalpha())]
    http = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    page = http.get("/en/")
    referenced = re.findall(r"""(?:src|href)\s*=\s*["']?([^"'\s>?#]+\.(?:m?js|css))""", page.text)
    with open_app(browser, f"{app_url}/en/") as tab:
        eventually(tab, lambda: tab.evaluate("() => document.readyState") == "complete", "page loaded")
        referenced += tab.evaluate("() => performance.getEntriesByType('resource').map(e => e.name)")
    assets = sorted({urlparse(urljoin(f"{app_url}/en/", a)).path for a in referenced if same_origin(urljoin(f"{app_url}/en/", a), app_url) and re.search(r"\.(?:m?js|css)$", urlparse(a).path)})
    for r in [page] + [http.get(a) for a in assets]:
        blob = r.text + json.dumps(dict(r.headers))
        for secret in secrets:
            assert secret not in blob
    for path in ["/package.json", "/run.json", "/.env"] + [a + ".map" for a in assets]:
        assert http.get(path).status_code == 404, path
    season = on_sale(app_url, "MH2", 250)
    api = Api(app_url)
    name, email = person("private")
    hold = make_hold(api, season.ids[0], ["A1"])
    key = idempotency_key()
    r = api.post("/api/checkout", checkout_body(hold, {"A1": "regular"}, guest={"name": name, "email": email}), key=key)
    message = exactly_one(mail, email, "Booking confirmed — HB-")
    body = re.sub(r"https?://[^/\s]+(?=/)", "", mail_body(message) + norm(message.get("Subject", "")))
    assert not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", body, re.I)
    assert hold["id"] not in body and key not in body and "killbill" not in body.lower()
    for host in INTERNAL_HOSTS[1:]:
        assert host not in body.lower()
    for secret in secrets:
        assert secret not in body


def test_bilingual_errors_locale_rule(app_url, mail):
    path = "/api/seasons/no-such-season-probe"
    raw = lambda **kw: httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT_S, **kw)
    cases = [({"headers": {"X-Halide-Locale": "fr"}}, "fr"), ({"headers": {"X-Halide-Locale": "en"}, "cookies": {"halide_locale": "fr"}}, "en"),
             ({"headers": {"X-Halide-Locale": "de"}, "cookies": {"halide_locale": "fr"}}, "fr"), ({"headers": {"Accept-Language": "en-CA"}}, "en"),
             ({"headers": {"Accept-Language": "de-DE"}}, "fr"), ({}, "fr")]
    for kwargs, locale in cases:
        r = raw(**kwargs)
        assert r.status_code == 404 and error(r) == {"code": "not_found", "message": NOT_FOUND[locale]}, kwargs
    p = signup(app_url, "fr")
    signed = Api(app_url, None)
    signed.post("/api/auth/signin", {"email": p.email, "password": PATRON_PASSWORD})
    signed.http.cookies.delete("halide_locale")
    assert error(signed.get(path, headers={"Accept-Language": "en-CA"}))["message"] == NOT_FOUND["fr"]
    enquiry = {"name": "Probe", "email": "probe-boundary@patrons.example", "subject": "Probe", "message": "x"}
    for locale in ("en", "fr"):
        h = {"X-Halide-Locale": locale}
        r = httpx.post(f"{app_url}/api/enquiries", json=enquiry, headers={**h, "Origin": EVIL_ORIGIN}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 403 and error(r) == {"code": "cross_origin", "message": CROSS_ORIGIN[locale]}
        big = b"x" * (BODY_LIMIT + 1)
        r = httpx.post(f"{app_url}/api/enquiries", content=big, headers={**h, "Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 413 and error(r) == {"code": "body_too_large", "message": BODY_TOO_LARGE[locale]}
        r = httpx.post(f"{app_url}/api/enquiries", content=b'{"a":1}', headers={**h, "Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 415 and error(r) == {"code": "unsupported_media_type", "message": UNSUPPORTED[locale]}
        r = httpx.post(f"{app_url}/api/enquiries", content=b"{not json", headers={**h, "Content-Type": "application/json; charset=utf-8"}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 400 and error(r) == {"code": "invalid_json", "message": INVALID_JSON[locale]}
        r = httpx.post(f"{app_url}/api/enquiries", json={}, headers=h, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 422 and error(r)["message"] == VALIDATION[locale] and error(r)["fields"]["name"] == REQUIRED[locale]
    shell = json.dumps({**enquiry, "message": ""}).encode()
    exact = json.dumps({**enquiry, "message": "y" * (BODY_LIMIT - len(shell))}).encode()
    assert len(exact) == BODY_LIMIT
    r = httpx.post(f"{app_url}/api/enquiries", content=exact, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 422 and error(r)["code"] == "validation"
    q = signup(app_url, "en")
    assert q.api.post("/api/locale", {"locale": "fr"}).status_code == 204
    q.locale = "fr"
    seen = seen_ids(mail, q.email, STEPUP_SUBJECT["fr"])
    assert q.api.post("/api/stepup/start", {"purpose": "gift"}).status_code == 201
    body = mail_body(await_mail(mail, q.email, STEPUP_SUBJECT["fr"], exclude=seen)[0])
    assert re.search(r"Ce code expire dans \d+ min\.", body)


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layouts(browser, app_url, viewport):
    width, height = VIEWPORTS[viewport]
    season = on_sale(app_url, "MH2", 251)
    sid = season.ids[0]
    g = guest_checkout(app_url, sid, ["D1"])
    p = signup(app_url)
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size({"width": width, "height": height})
        browser_signin(page, app_url, p.email)
        hold = browser_hold(page, app_url, sid, ["A1"])
        for path in ["/en/", f"/en/screenings/{sid}", f"/en/checkout/{hold['id']}", "/en/account", "/en/membership", "/en/gift", "/en/booking-link", "/en/contact", "/en/signin", "/en/signup", g.link]:
            page.goto(f"{app_url}{path}")
            eventually(page, lambda: page.get_by_role("heading", level=1).count() > 0, f"{path} heading")
            fits(page)
        page.goto(f"{app_url}/en/screenings/{sid}")
        notes = page.get_by_role("region", name="Film notes", exact=True)
        notes_button = page.get_by_role("button", name="Film notes", exact=True)
        menu = page.get_by_role("button", name="Menu", exact=True)
        nav = page.get_by_role("navigation", name="Primary", exact=True)
        eventually(page, lambda: shown(page.get_by_role("grid", name="Seat map", exact=True)), "seat map")
        if width < NARROW_WIDTH:
            assert attr(menu, "aria-expanded") == "false" and not shown(nav)
            click(menu)
            eventually(page, lambda: attr(menu, "aria-expanded") == "true" and shown(nav), "menu opens")
            click(menu)
            eventually(page, lambda: attr(menu, "aria-expanded") == "false" and not shown(nav), "menu closes")
            assert attr(notes_button, "aria-expanded") == "false" and not shown(notes)
            click(notes_button)
            eventually(page, lambda: attr(notes_button, "aria-expanded") == "true" and shown(notes), "film notes open")
            for code in ("A1", "D6"):
                box = seat(page, code).first.bounding_box()
                assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX
        else:
            assert not shown(menu) and shown(nav) and shown(notes)
        page.goto(f"{app_url}/en/contact")
        eventually(page, lambda: page.get_by_role("heading", level=1).count() > 0, "contact")
        axe_rules(page, ["color-contrast", "target-size"])
    with open_app(browser, f"{app_url}/en/signin") as page:
        page.set_viewport_size({"width": width, "height": height})
        browser_signin(page, app_url, *STAFF["finance"])
        page.goto(f"{app_url}/en/staff")
        eventually(page, lambda: page.get_by_role("heading", level=1).count() > 0, "staff console")
        fits(page)


def test_focus_hover_transitions(browser, app_url):
    for path, skip in (("/en/contact", "Skip to main content"), ("/fr/contact", "Passer au contenu principal"), ("/en/gift", "Skip to main content")):
        with open_app(browser, f"{app_url}{path}") as page:
            eventually(page, lambda: page.get_by_role("heading", level=1).count() > 0, "heading")
            assert tab_order(page, 1)[0] == skip
            page.keyboard.press("Enter")
            eventually(page, lambda: focused(page.get_by_role("heading", level=1)), "skip lands on h1")
    with mouse_page(browser, f"{app_url}/en/contact") as page:
        eventually(page, lambda: page.get_by_role("heading", level=1).count() > 0, "heading")
        button = page.get_by_role("button", name="Send enquiry", exact=True)
        hover_name, hover_email = person("hover")
        for label, value in (("Full name", hover_name), ("Email", hover_email), ("Subject", "Probe hover"), ("Message", "Probe hover")):
            page.get_by_role("textbox", name=label, exact=True).fill(value)
        eventually(page, lambda: button.is_enabled(), "Send enabled")
        rest, hover = edge_change(button, state="hover")
        assert rest != hover, "hover changes nothing visible"
        rest, focus = edge_change(button, state="focus")
        assert rest != focus, "focus changes nothing visible"
    with open_app(browser, f"{os.environ['APP_KILLBILL_DOWN_URL']}/en/contact") as page:
        dismiss = page.get_by_role("button", name="Dismiss notice", exact=True)
        eventually(page, lambda: shown(dismiss), "notice", NOTICE_S, step_ms=NOTICE_STEP_MS)
        dismiss.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: not shown(page.get_by_role("alert", name="Service notice", exact=True)) and focused(page.get_by_role("heading", level=1)), "dismiss lands on h1")
    p = signup(app_url)
    for motion in ("no-preference", "reduce"):
        with mouse_page(browser, f"{app_url}/en/signin", reduced_motion=motion) as page:
            browser_signin(page, app_url, p.email)
            page.goto(f"{app_url}/en/membership")
            opener = page.get_by_role("button", name=re.compile(r"^Billing: "))
            eventually(page, lambda: shown(opener), "cadence opener")
            page.evaluate("() => { window.__probeMotion.length = 0; }")
            click(opener)
            listbox = page.get_by_role("listbox", name="Billing cadence", exact=True)
            eventually(page, lambda: listbox.count() > 0, "menu mounted")
            if motion == "reduce":
                timings = menu_motion(listbox, opener)
                assert all(t <= REDUCED_MOTION_MAX_MS for t in timings), timings
            else:
                eventually(page, lambda: any(TRANSITION_MIN_MS <= t <= TRANSITION_MAX_MS for t in menu_motion(listbox, opener)), "menu animates 240-320 ms")


def npm_tree() -> dict[tuple[str, str], Any]:
    root = Path(DEPLOYED_APP) if (Path(DEPLOYED_APP) / "node_modules").is_dir() else APP_DIR
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=root, capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
    data = json.loads(out.stdout)
    packages: dict[tuple[str, str], Any] = {}

    def licence_of(info: dict[str, Any]) -> Any:
        if info.get("license"):
            return info["license"]
        folder = Path(info.get("path") or "")
        meta = json.loads((folder / "package.json").read_text()) if info.get("path") and (folder / "package.json").is_file() else {}
        return meta.get("license") or meta.get("licenses") or (licence_file(folder) if info.get("path") else None)

    def walk(deps: dict[str, Any] | None) -> None:
        for name, info in (deps or {}).items():
            version = info.get("version")
            if version and (name, version) not in packages:
                packages[(name, version)] = licence_of(info)
                walk(info.get("dependencies"))

    walk(data.get("dependencies"))
    return packages


def licence_file(folder: Path) -> str | None:
    for name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING", "license", "license.md"):
        if (folder / name).is_file():
            text = " ".join((folder / name).read_text(errors="replace").split()).lower()
            if "permission is hereby granted, free of charge" in text:
                return "MIT"
            if "permission to use, copy, modify, and/or distribute this software for any purpose" in text:
                return "ISC" if "provided that the above copyright notice and this permission notice appear" in text else "0BSD"
            if "apache license" in text and "version 2.0" in text:
                return "Apache-2.0"
            if "redistribution and use in source and binary forms" in text:
                return "BSD-3-Clause" if "neither the name" in text else "BSD-2-Clause"
            if "sil open font license" in text:
                return "OFL-1.1"
    return None


def licence_ok(licence: Any) -> bool:
    if isinstance(licence, list):
        return any(licence_ok(item) for item in licence)
    if isinstance(licence, dict):
        licence = licence.get("type")
    if not isinstance(licence, str):
        return False
    expr = licence.replace("(", " ").replace(")", " ")
    return any(all(term.strip() in ALLOWED_LICENCES for term in alt.split(" AND ")) for alt in expr.split(" OR "))


def notice_entries(lines: list[str], name: str, others: set[str]) -> list[str]:
    entries = [notice_entry(lines, i, name, others) for i, line in enumerate(lines) if re.search(rf"\b{re.escape(name)}\b", line)]
    bare = lambda entry: re.sub("|".join(re.escape(l) for l in ALLOWED_LICENCES), "", entry)
    return [entry for entry in entries if re.search(r"\d", bare(entry))]


def notice_entry(lines: list[str], start: int, name: str, others: set[str]) -> str:
    level = lambda line: len(re.match(r"\s*(#*)", line).group(1))
    lead = lambda line: re.sub(r"^\s*(?:#+|[-*+]|\d+[.)]|\|)?\s*(?:\*\*|__|`|\[)?\s*(?:(?:name|package|font)\s*:\s*)?", "", line, flags=re.I)
    own = level(lines[start])
    above = "" if own else next((lines[i] for i in range(start - 1, -1, -1) if level(lines[i])), "")
    entry = [above, lines[start]]
    for line in lines[start + 1:]:
        if (level(line) and (not own or level(line) <= own)) or any(
                re.match(rf"{re.escape(other)}(?![\w-])", lead(line)) for other in others if other != name):
            break
        entry.append(line)
    return "\n".join(entry)


def test_if_run_manifest():
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert isinstance(manifest, dict) and set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1" and all(isinstance(v, str) for v in manifest.values())


def test_if_third_party_notices():
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    packages = npm_tree()
    assert packages
    for name, version in packages:
        assert name in notices and version in notices, f"{name}@{version}"
    for font in FONTS:
        assert font in notices, font


def test_if_licences():
    packages = npm_tree()
    bad = {f"{n}@{v}": lic for (n, v), lic in packages.items() if not licence_ok(lic)}
    assert not bad, bad
    others = set(FONTS) | {n for n, _ in packages}
    lines = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text().splitlines()
    for font in FONTS:
        assert any(any(l in entry for l in ALLOWED_LICENCES) for entry in notice_entries(lines, font, others)), font


def test_if_typescript_only():
    found = []
    for root, dirs, files in os.walk(APP_DIR):
        rel = Path(root).relative_to(APP_DIR)
        dirs[:] = [d for d in dirs if d != "node_modules" and not (rel == Path(".") and d == "dist")]
        found += [str(Path(root) / f) for f in files if Path(f).suffix in (".js", ".mjs", ".cjs", ".jsx")]
    assert not found, found


def test_if_no_extra_datastore():
    package = json.loads((APP_DIR / "package.json").read_text())
    deps = package.get("dependencies", {})
    assert not [d for d in FORBIDDEN_DATASTORES if d in deps]
    files = [str(p) for p in APP_DIR.rglob("*") if p.suffix in (".db", ".sqlite")]
    assert not files, files


def test_if_no_cdn_in_dist():
    roots = [d for d in (APP_DIR / "dist", Path(DEPLOYED_APP) / "dist") if d.is_dir()]
    assert roots, "no build output directory"
    for root in roots:
        for path in root.rglob("*"):
            if path.is_file():
                content = path.read_text(errors="ignore")
                for host in CDN_HOSTS:
                    assert host not in content, (path, host)
