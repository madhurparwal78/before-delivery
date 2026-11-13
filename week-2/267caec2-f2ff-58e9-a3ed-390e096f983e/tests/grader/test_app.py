from __future__ import annotations

import json
import os
import re
import struct
import subprocess
import threading
import uuid
import zlib
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, getcontext
from email.utils import parsedate_to_datetime
from pathlib import Path
from time import monotonic
from typing import Any, Iterator
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    AXE,
    S3,
    addresses,
    advance,
    click,
    fill,
    idempotency_key,
    layout,
    open_app,
    same_origin,
    select,
    state_styles,
    tab_order,
    text,
    unique,
)

getcontext().prec = 50

PASSWORD = "verifier-pass-2026"
SHORT_PASSWORD = "short-pw"
HTTP_TIMEOUT_S = 30
UI_WAIT_MS = 15000
SETTLE_MS = 1000
MAIL_WINDOW_S = 10
MAIL_POLL_S = 1.0
REVEAL_WAIT_S = 60
EMBARGO_LEAD_S = 20
SAMPLE_SECONDS = 15
SAMPLE_MS = 40
REFRESH_MS = 5000
JSON_LIMIT = 65536
UPLOAD_LIMIT = 8000000
MULTIPART_LIMIT = 8100000
MIN_SIDE = 640
MAX_SIDE = 4096
MAX_IMAGES = 6
REASON_MAX = 300
NAME_CUT = 100
LONG_NAME_LEN = NAME_CUT * 2
KEY_MAX = 100
EARLY_FEE = 4500
STANDARD_FEE = 7000
FEE_MIN = 100
FEE_MAX = 100000
YEAR_MIN = 2000
YEAR_MAX = 2100
SHORTLIST_MAX = 50
PROGRAM_YEAR = YEAR_MIN
ROLL_MS = 320
SHUFFLE_TOLERANCE_MS = 300
REAL_SAMPLE_S = 5
ROW_SAMPLE_JS = ("([a, b, s]) => { const y = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };"
                 " return [document.timeline.currentTime, y(a), y(b), (s.textContent || '').trim()]; }")
TRAVEL_MS = 480
STAGGER_MS = 40
TAP_MIN = 44
VIEWPORTS = ((375, 812), (768, 1024), (1280, 800))
WEIGHTS = (35, 30, 25, 10)
TRIM_AT = 5

OPEN_EARLY = "2099-12-30"
OPEN_DEADLINE = "2099-12-31"
PAST_EARLY = "2001-01-01"
PAST_DEADLINE = "2001-01-02"
BALLOT_DATE = "2099-12-31"
PAST_EMBARGO = "2001-01-01T00:00:00+00:00"
CROSS_ORIGIN = "http://elsewhere.example"
SITE_URL = "https://example.com/case-study"
MARKER = b"CUTLINE-VERIFIER-MARKER"
UNKNOWN_ID = "no-such-id"
BAD_EMAIL = "not-an-email"
BAD_ZONE = "Mars/Olympus_Mons"
BAD_DATE = "2099-02-30"
BAD_DECISION = "maybe"
BAD_AWARD = "champion"
MID_EARLY = "2099-06-29"
MID_DEADLINE = "2099-06-30"
LATE_DATE = "2100-02-01"
HTTP_SITE = "http://example.com/case-study"
FORM_BODY = b"title=x"
PLAIN_TYPE = "text/plain"
UPLOAD_NAME = "evil.png"
GIF_NAME = "anim.png"
GIF_BYTES = b"GIF89a" + b"\x00" * 64

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
SET_COOKIE = "set-cookie"
CORS_HEADER = "access-control-allow-origin"
DATE_HEADER = "date"
UTC_SUFFIX = "+00:00"
DOWN_URL_ENV = "APP_KILLBILL_DOWN_URL"
KB_ACCOUNT_ID = "accountId"
MAIL_FROM = "From"
DATA_SCHEME = "data:"
NEVER_SERVED = ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/THIRD_PARTY_NOTICES.md")
SERVED_LEAKS = ("run-manifest-v1", '"dependencies"', "DATABASE_URL")
FOCUS_PROPS = ("outline-style", "outline-width", "outline-color", "box-shadow")
SEED_CATEGORY = "Portfolio"
ROUND_ONE = "Round 1"
POSITION_TOLERANCE_PX = 1
RUNNING_COUNT_JS = "el => el.getAnimations({subtree: true}).filter(a => a.playState === 'running').length"
IDEA_QUANTUM = Decimal("0.0001")
SCORE_QUANTUM = Decimal("0.01")

DIRECTOR_EMAIL, DIRECTOR_PASSWORD = "director@cutline.example", "director-pass-26"
DESK_FROM = "desk@cutline.example"
SEEDED_ACCOUNTS = [
    ("director@cutline.example", "director-pass-26", "director", None),
    ("studio@halftone.example", "halftone-pass-26", "studio", "Halftone Works"),
    ("hello@fieldnote.example", "fieldnote-pass-26", "studio", "Fieldnote Studio"),
    ("team@parallaxpine.example", "parallax-pass-26", "studio", "Parallax & Pine"),
    ("desk@monoharbour.example", "monoharbour-pass-26", "studio", "Mono Harbour"),
    ("ines@jury.example", "juror-pass-26", "juror", "Halftone Works"),
    ("teo@jury.example", "juror-pass-26", "juror", None),
    ("priya@jury.example", "juror-pass-26", "juror", None),
    ("olu@jury.example", "juror-pass-26", "juror", None),
    ("sana@jury.example", "juror-pass-26", "juror", None),
    ("ruth@jury.example", "juror-pass-26", "juror", None),
]

USER_KEYS = {"id", "role", "name", "email", "studioId", "studioName"}
PROGRAM_KEYS = {"id", "name", "year", "timeZone", "earlyBirdDate", "deadlineDate", "earlyBirdEndsAt", "deadlineAt",
                "earlyBirdLabel", "deadlineLabel", "earlyBirdFeeCents", "standardFeeCents", "currentTier",
                "currentFeeCents", "entriesOpen", "categories"}
CATEGORY_KEYS = {"id", "name", "shortlistSize", "finalistCount"}
ENTRY_KEYS = {"id", "entryNumber", "programId", "categoryId", "categoryName", "title", "summary", "siteUrl", "credits",
              "state", "statusLabel", "disqualifyReason", "award", "score", "assets", "fee", "submittedAt",
              "deadlineLabel", "canWithdraw", "refundOnWithdraw"}
DIRECTOR_ENTRY_KEYS = ENTRY_KEYS | {"studioId", "studioName", "studioEmail"}
ASSET_KEYS = {"id", "url", "name", "type", "width", "height", "bytes"}
RECEIPT_KEYS = {"entryNumber", "title", "amountCents", "currency", "tier", "invoiceId", "paymentId", "paidAt", "refund"}
INVOICE_KEYS = {"invoiceId", "entryNumber", "amountCents", "currency", "tier", "status"}
BLIND_KEYS = {"entryId", "entryNumber", "title", "summary", "images", "scores"}
PACKET_KEYS = {"roundId", "roundName", "categoryName", "ballotDeadlineLabel", "entries"}
PACKET_ENTRY_KEYS = {"entryNumber", "title", "summary", "assetIds"}
GALLERY_KEYS = {"entryNumber", "title", "studioName", "programName", "year", "category", "award", "score", "images"}
LEADER_CATEGORY_KEYS = {"id", "name", "state", "revealsAt", "revealsLabel", "cut", "rows"}
LEADER_ROW_KEYS = {"rank", "entryNumber", "title", "studioName", "score", "previousRank", "previousScore", "award", "cut"}
STANDING_ROW_KEYS = {"rank", "entryId", "entryNumber", "title", "categoryName", "score", "ideaMean", "ballotsCounted",
                     "cut", "award"}
ENTRY_STATES = ["draft", "submitted", "screened", "disqualified", "withdrawn", "round_1", "shortlisted", "eliminated",
                "final_round", "winner", "finalist", "honourable_mention", "published"]

COPY_INVALID = "That step isn't available in the current state."
COPY_TOO_LARGE = "Images must be 8,000,000 bytes or smaller."
COPY_TYPE = "Upload a PNG or JPEG image."
COPY_UNREADABLE = "This file isn't a readable PNG or JPEG image."
COPY_DIMENSIONS = "Images must be 640 to 4,096 pixels on each side."
COPY_COUNT = "An entry holds at most 6 images."
COPY_PAY_PAUSED = "Payments are paused. Your draft is saved — try again shortly."
COPY_REFUND_PAUSED = "Refunds are paused. Your entry is still submitted — try again shortly."
COPY_REASON = "Give a reason of 1 to 300 characters."


class Api:

    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)

    def call(self, method: str, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        if body is not None:
            kw["json"] = body
        return self.http.request(method, path, **kw)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("POST", path, {} if body is None else body, **kw)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.call("PATCH", path, body)

    def put(self, path: str, body: Any) -> httpx.Response:
        return self.call("PUT", path, body)

    def delete(self, path: str) -> httpx.Response:
        return self.call("DELETE", path)


def ok(resp: httpx.Response, *statuses: int) -> Any:
    assert resp.status_code in statuses, (
        f"{resp.request.method} {resp.request.url} answered {resp.status_code}: {resp.text[:600]}")
    return resp.json() if resp.content else None


def refused(resp: httpx.Response, status: int, code: str | None = None, message: str | None = None) -> dict:
    assert resp.status_code == status, (
        f"{resp.request.method} {resp.request.url} answered {resp.status_code}, expected {status}: {resp.text[:600]}")
    body = resp.json()
    if code is not None:
        assert body.get("error") == code, body
    if message is not None:
        assert body.get("message") == message, body
    return body


def field_error(resp: httpx.Response, name: str, copy: str | None = None) -> None:
    body = refused(resp, 422)
    assert name in body.get("errors", {}), body
    if copy is not None:
        assert body["errors"][name] == copy, body


def sign_in(base: str, email: str, password: str) -> Api:
    api = Api(base)
    ok(api.post("/api/session", {"email": email, "password": password}), 200)
    return api


def server_now(api: Api) -> datetime:
    return parsedate_to_datetime(api.get("/api/health").headers[DATE_HEADER])


def upload(api: Api, entry_id: str, data: bytes, name: str = "shot.png", ctype: str = "image/png") -> httpx.Response:
    return api.http.post(f"/api/entries/{entry_id}/assets", files={"file": (name, data, ctype)})


def pay(api: Api, entry_id: str, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/entries/{entry_id}/submit", {}, headers={"Idempotency-Key": key or idempotency_key()})


def scores(craft: int, clarity: int, idea: int, story: int) -> dict:
    return {"craft": craft, "clarity": clarity, "idea": idea, "story": story}


def same(level: int) -> tuple[int, int, int, int]:
    return (level, level, level, level)


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png(width: int, height: int, *, seed: int = 0, metadata: bytes = b"", trailer: bytes = b"") -> bytes:
    row = b"\x00" + bytes((x * 7 + seed * 31) % 256 for x in range(width * 3))
    raw = row * height
    body = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + (_chunk(b"tEXt", b"Comment\x00" + metadata) if metadata else b"")
            + _chunk(b"IDAT", zlib.compress(raw, 6)) + _chunk(b"IEND", b""))
    return body + trailer


def padded_png(total: int) -> bytes:
    base = png(MIN_SIDE, MIN_SIDE)
    return base + b"\x00" * (total - len(base))


def axe_contrast(page: Page) -> None:
    page.add_script_tag(path=str(AXE))
    page.evaluate(
        """options => {
          const result={done:false,error:null,violations:[]};
          Object.defineProperty(window,'__VERIFIER_CONTRAST_RESULT__',{value:()=>structuredClone(result),configurable:true});
          axe.run(document,options).then(value=>{
            result.violations=value.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));result.done=true;
          },error=>{result.error=String(error);result.done=true});
        }""",
        {"runOnly": {"type": "rule", "values": ["color-contrast"]}},
    )
    for _ in range(625):
        status = page.evaluate("window.__VERIFIER_CONTRAST_RESULT__()")
        if status["done"]:
            assert status["error"] is None, status["error"]
            assert not status["violations"], f"contrast violations: {status['violations']}"
            return
        advance(page, 16)
    raise AssertionError("contrast audit did not settle under controlled time")


def boundary(zone: str, day: date) -> datetime:
    nxt = day + timedelta(days=1)
    return datetime(nxt.year, nxt.month, nxt.day, tzinfo=ZoneInfo(zone))


def deadline_label(zone: str, day: date) -> str:
    return f"23:59 {zone}, {day.day} {day.strftime('%b')} {day.year}"


def embargo_label(zone: str, instant: datetime) -> str:
    local = instant.astimezone(ZoneInfo(zone))
    return f"{local:%H}:{local:%M} {zone}, {local.day} {local.strftime('%b')} {local.year}"


def assert_instant(value: str, expected: datetime) -> None:
    parsed = datetime.fromisoformat(value.replace("Z", UTC_SUFFIX))
    assert parsed == expected and parsed.utcoffset() == expected.utcoffset(), (value, expected.isoformat())


def dollars(cents: int) -> str:
    return f"{Decimal(cents) / 100:.2f}"


def successful(payment: dict | None, kind: str) -> list[dict]:
    return [t for t in (payment or {}).get("transactions", [])
            if t.get("transactionType") == kind and t.get("status") == "SUCCESS"]


def cents_of(transaction: dict) -> int:
    return int(Decimal(str(transaction["amount"])) * 100)


def inbox(mail: Any, to: str, subject: str, expected: int = 1, seconds: float = MAIL_WINDOW_S) -> list[dict]:
    deadline = monotonic() + seconds
    while True:
        found = [m for m in mail.messages(settle=MAIL_POLL_S)
                 if to.lower() in [a.lower() for a in addresses(m.get("To"))] and m.get("Subject") == subject]
        if len(found) >= expected or monotonic() > deadline:
            return found


def receipt_subject(entry: dict) -> str:
    return f"Cutline receipt: Entry {entry['entryNumber']} — {entry['title']}"


def refund_subject(entry: dict) -> str:
    return f"Cutline refund: Entry {entry['entryNumber']} — {entry['title']}"


def weighted(s: tuple[int, int, int, int]) -> Decimal:
    return Decimal(sum(w * v for w, v in zip(WEIGHTS, s))) / 100


def round_scores(ballots: list[dict[str, tuple[int, int, int, int]]]) -> dict[str, str]:
    mapped: dict[str, list[Decimal]] = defaultdict(list)
    for ballot in ballots:
        totals = {e: weighted(s) for e, s in ballot.items()}
        mean = sum(totals.values()) / len(totals)
        dev = (sum((t - mean) ** 2 for t in totals.values()) / len(totals)).sqrt()
        for e, t in totals.items():
            z = Decimal(0) if dev == 0 else (t - mean) / dev
            mapped[e].append(min(Decimal(10), max(Decimal(0), 5 + Decimal("1.5") * z)))
    out = {}
    for e, values in mapped.items():
        values = sorted(values)
        if len(values) >= TRIM_AT:
            values = values[1:-1]
        out[e] = str((sum(values) / len(values)).quantize(SCORE_QUANTUM, rounding=ROUND_HALF_UP))
    return out


def ordinal(n: int) -> str:
    if n % 100 in (11, 12, 13):
        return f"{n}th"
    return f"{n}" + {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def shuffle_summary(moves: list[tuple[int, int, int]], cut: int) -> str:
    def side(rank: int) -> str:
        return "above" if rank <= cut else "below"
    moved = [m for m in moves if m[1] != m[2]]
    crossed = [m for m in moved if side(m[1]) != side(m[2])]
    named = sorted(crossed or moved, key=lambda m: (-abs(m[1] - m[2]), m[2]))[0]
    line = f"Entry {named[0]} moved from {ordinal(named[1])} to {ordinal(named[2])}, now {side(named[2])} the cut."
    if len(moved) > 1:
        line += f" {len(moved) - 1} other entries moved."
    return line


@dataclass
class Studio:
    api: Api
    id: str
    name: str
    email: str
    contact: str


@dataclass
class Juror:
    api: Api
    id: str
    name: str
    email: str


def round_ids(category: dict) -> dict[str, str]:
    return {r["kind"]: r["id"] for r in category["rounds"]}


class Desk:
    def __init__(self, base: str) -> None:
        self.base = base
        self.director = sign_in(base, DIRECTOR_EMAIL, DIRECTOR_PASSWORD)

    def program(self, *, zone: str = "Europe/Lisbon", early: str = OPEN_EARLY, deadline: str = OPEN_DEADLINE,
                year: int = PROGRAM_YEAR) -> dict:
        name, _ = unique("Program")
        return ok(self.director.post("/api/programs", {
            "name": name, "year": year, "timeZone": zone, "earlyBirdDate": early, "deadlineDate": deadline,
            "earlyBirdFeeCents": EARLY_FEE, "standardFeeCents": STANDARD_FEE}), 201)["program"]

    def category(self, program: dict, shortlist: int = 5, finalists: int = 3) -> dict:
        name, _ = unique("Category")
        return ok(self.director.post(f"/api/programs/{program['id']}/categories", {
            "name": name, "shortlistSize": shortlist, "finalistCount": finalists}), 201)["category"]

    def studio(self) -> Studio:
        name, email = unique("Studio")
        contact, _ = unique("Contact")
        api = Api(self.base)
        user = ok(api.post("/api/studios", {"studioName": name, "contactName": contact, "email": email,
                                            "password": PASSWORD}), 201)["user"]
        return Studio(api, user["studioId"], name, email, contact)

    def juror(self, studio_id: str | None = None) -> Juror:
        name, email = unique("Juror")
        made = ok(self.director.post("/api/jurors", {"name": name, "email": email, "password": PASSWORD,
                                                     "studioId": studio_id}), 201)["juror"]
        return Juror(sign_in(self.base, email, PASSWORD), made["id"], name, email)

    def draft(self, studio: Studio, category: dict, images: int = 1) -> dict:
        title, _ = unique("Entry")
        entry = ok(studio.api.post("/api/entries", {
            "categoryId": category["id"], "title": title, "summary": f"Case study for {title}",
            "siteUrl": SITE_URL, "credits": f"Credits for {title}"}), 201)["entry"]
        for k in range(images):
            ok(upload(studio.api, entry["id"], png(MIN_SIDE, MIN_SIDE, seed=k)), 201)
        return ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]

    def submitted(self, studio: Studio, category: dict) -> dict:
        entry = self.draft(studio, category)
        return ok(pay(studio.api, entry["id"]), 201)["entry"]

    def close_entries(self, program: dict) -> dict:
        return ok(self.director.patch(f"/api/programs/{program['id']}",
                                      {"earlyBirdDate": PAST_EARLY, "deadlineDate": PAST_DEADLINE}), 200)["program"]

    def screen(self, entry_id: str) -> dict:
        return ok(self.director.post(f"/api/entries/{entry_id}/screen", {"decision": "pass"}), 200)["entry"]

    def add_panel(self, round_id: str, juror: Juror) -> list[dict]:
        return ok(self.director.post(f"/api/rounds/{round_id}/jurors", {"jurorId": juror.id}), 200, 201)["panel"]

    def open(self, round_id: str) -> dict:
        return ok(self.director.post(f"/api/rounds/{round_id}/open", {"ballotDeadline": BALLOT_DATE}), 200)["round"]

    def close(self, round_id: str) -> dict:
        return ok(self.director.post(f"/api/rounds/{round_id}/close", {}), 200)

    def confirm(self, round_id: str) -> dict:
        return ok(self.director.post(f"/api/rounds/{round_id}/confirm", {}), 200)

    def publish(self, category: dict, embargo_at: str) -> dict:
        return ok(self.director.post(f"/api/categories/{category['id']}/publish", {"embargoAt": embargo_at}),
                  200)["category"]

    def standings(self, round_id: str) -> dict:
        return ok(self.director.get(f"/api/rounds/{round_id}/standings"), 200)

    def panel(self, round_id: str) -> list[dict]:
        return ok(self.director.get(f"/api/rounds/{round_id}"), 200)["panel"]

    def state(self, entry_id: str) -> str:
        return ok(self.director.get(f"/api/entries/{entry_id}"), 200)["entry"]["state"]


def score(juror: Juror, round_id: str, entry_id: str, s: tuple[int, int, int, int]) -> dict:
    return ok(juror.api.put(f"/api/rounds/{round_id}/scores/{entry_id}", scores(*s)), 200)


def submit_ballot(juror: Juror, round_id: str) -> dict:
    return ok(juror.api.post(f"/api/rounds/{round_id}/ballot/submit", {}), 200)


def ballot(juror: Juror, round_id: str) -> dict:
    return ok(juror.api.get(f"/api/rounds/{round_id}/ballot"), 200)


def open_round_one(desk: Desk, studios: list[Studio], jurors: list[Juror], shortlist: int = 5,
                   finalists: int = 3) -> dict:
    program = desk.program()
    category = desk.category(program, shortlist, finalists)
    rounds = round_ids(category)
    entries = [desk.submitted(s, category) for s in studios]
    desk.close_entries(program)
    for e in entries:
        desk.screen(e["id"])
    for j in jurors:
        desk.add_panel(rounds["round_1"], j)
    opened = desk.open(rounds["round_1"])
    return {"program": program, "category": category, "rounds": rounds, "entries": entries, "round": opened}


R1_LEVELS = (9, 7, 5, 3)
FINAL_LEVELS = (7, 9, 5)


@dataclass
class Finished:
    program: dict
    category: dict
    rounds: dict
    studios: list
    entries: list
    juror: Juror
    bystander: Studio
    r1_scores: dict
    final_scores: dict
    r1_outcomes: list = field(default_factory=list)
    final_outcomes: list = field(default_factory=list)


def finished_category(desk: Desk) -> Finished:
    program = desk.program()
    category = desk.category(program, 3, 2)
    rounds = round_ids(category)
    studios = [desk.studio() for _ in R1_LEVELS]
    entries = [desk.submitted(s, category) for s in studios]
    bystander = desk.studio()
    desk.draft(bystander, category, images=0)
    desk.close_entries(program)
    for e in entries:
        desk.screen(e["id"])
    juror = desk.juror()
    desk.add_panel(rounds["round_1"], juror)
    desk.open(rounds["round_1"])
    r1 = {e["id"]: same(level) for e, level in zip(entries, R1_LEVELS)}
    for eid, s in r1.items():
        score(juror, rounds["round_1"], eid, s)
    submit_ballot(juror, rounds["round_1"])
    desk.close(rounds["round_1"])
    r1_outcomes = desk.confirm(rounds["round_1"])["outcomes"]
    desk.add_panel(rounds["final"], juror)
    desk.open(rounds["final"])
    fin = {e["id"]: same(level) for e, level in zip(entries, FINAL_LEVELS)}
    for eid, s in fin.items():
        score(juror, rounds["final"], eid, s)
    submit_ballot(juror, rounds["final"])
    desk.close(rounds["final"])
    final_outcomes = desk.confirm(rounds["final"])["outcomes"]
    return Finished(program, category, rounds, studios, entries, juror, bystander, round_scores([r1]),
                    round_scores([fin]), r1_outcomes, final_outcomes)


def leaderboard(base: str, program_id: str) -> dict:
    return ok(httpx.get(f"{base}/api/public/leaderboard", params={"programId": program_id}, timeout=HTTP_TIMEOUT_S),
              200)


def board_category(base: str, program_id: str, category_id: str) -> dict:
    return next(c for c in leaderboard(base, program_id)["categories"] if c["id"] == category_id)


def gallery(base: str, **params: Any) -> httpx.Response:
    return httpx.get(f"{base}/api/public/gallery", params=params, timeout=HTTP_TIMEOUT_S)


SEED_PROGRAM = "Cutline Annual 2025"


def seeded_board(base: str) -> dict:
    programs = ok(httpx.get(f"{base}/api/programs", timeout=HTTP_TIMEOUT_S), 200)["programs"]
    program = next(p for p in programs if p["name"] == SEED_PROGRAM)
    return leaderboard(base, program["id"])


def pick_seed_program(page: Page) -> None:
    select(page.get_by_role("combobox", name="Program"), SEED_PROGRAM)


@pytest.fixture(scope="module")
def s3() -> S3:
    return S3()


def desk_status(page: Page) -> Any:
    return page.get_by_role("status", name="Desk status")


def desk_error(page: Page) -> Any:
    return page.get_by_role("alert", name="Desk error")


def status_line(label: str) -> str:
    return f"Status: {label}"


def image_file(name: str, data: bytes) -> dict:
    return {"name": name, "mimeType": "image/png", "buffer": data}


def ui_sign_in(page: Page, email: str, password: str) -> None:
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password", exact=True), password)
    click(page.get_by_role("button", name="Sign in"))


@contextmanager
def signed_in(browser: Browser, base: str, path: str, email: str, password: str, **kw: Any) -> Iterator[Page]:
    with open_app(browser, f"{base}/signin", **kw) as page:
        ui_sign_in(page, email, password)
        expect(page.get_by_role("button", name="Sign out")).to_be_visible(timeout=UI_WAIT_MS)
        page.goto(f"{base}{path}")
        yield page


def test_studio_accounts_and_sign_in(app_url: str) -> None:
    name, email = unique("Studio")
    contact, _ = unique("Contact")
    api = Api(app_url)
    resp = api.post("/api/studios", {"studioName": name, "contactName": contact, "email": email, "password": PASSWORD})
    user = ok(resp, 201)["user"]
    assert set(user) == USER_KEYS
    assert (user["role"], user["studioName"], user["email"].lower()) == ("studio", name, email.lower())
    cookie = next(c for c in resp.headers.get_list(SET_COOKIE) if c.split("=")[0].strip() == "cutline_session")
    flags = cookie.lower().replace(" ", "")
    for flag in ("HttpOnly", "SameSite=Lax", "Path=/"):
        assert flag.lower() in flags, (flag, cookie)
    assert ok(api.get("/api/session"), 200)["user"]["id"] == user["id"]

    other = Api(app_url)
    valid = {"studioName": unique("Studio")[0], "contactName": contact, "email": unique("Studio")[1],
             "password": PASSWORD}
    refused(other.post("/api/studios", {**valid, "email": email.upper()}), 409, "email_taken",
            "An account already uses that email.")
    refused(other.post("/api/studios", {**valid, "studioName": name.upper()}), 409, "studio_name_taken",
            "Another studio already uses that name.")
    field_error(other.post("/api/studios", {**valid, "password": SHORT_PASSWORD}), "password")
    field_error(other.post("/api/studios", {**valid, "studioName": "x"}), "studioName")
    field_error(other.post("/api/studios", {**valid, "email": BAD_EMAIL}), "email")
    assert other.get("/api/session").status_code == 401

    refused(Api(app_url).post("/api/session", {"email": email, "password": PASSWORD + "x"}), 401,
            "invalid_credentials")
    assert api.delete("/api/session").status_code == 204
    refused(api.get("/api/session"), 401, "unauthenticated")

    for seeded_email, password, role, studio_name in SEEDED_ACCOUNTS:
        seeded = ok(Api(app_url).post("/api/session", {"email": seeded_email, "password": password}), 200)["user"]
        assert (seeded["role"], seeded["studioName"]) == (role, studio_name), seeded


def test_error_precedence(app_url: str) -> None:
    anon = Api(app_url)
    refused(anon.get("/api/entries"), 401, "unauthenticated")
    refused(anon.get("/api/audit"), 401, "unauthenticated")
    refused(anon.post("/api/entries", {}, headers={"Origin": CROSS_ORIGIN}), 403, "forbidden")
    big = json.dumps({"title": "x" * JSON_LIMIT}).encode()
    refused(anon.http.post("/api/entries", content=big, headers={"Content-Type": "application/json"}), 413,
            "payload_too_large")
    refused(anon.http.post("/api/entries", content=FORM_BODY, headers={"Content-Type": PLAIN_TYPE}), 415,
            "unsupported_media_type")

    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program)
    rounds = round_ids(category)
    juror = desk.juror()
    studio = desk.studio()
    refused(juror.api.post(f"/api/rounds/{UNKNOWN_ID}/close", {}), 404, "not_found")
    refused(juror.api.post(f"/api/rounds/{rounds['round_1']}/close", {}), 403, "forbidden")
    refused(studio.api.post(f"/api/rounds/{UNKNOWN_ID}/close", {}), 404, "not_found")
    refused(studio.api.post(f"/api/rounds/{rounds['round_1']}/close", {}), 403, "forbidden")
    refused(studio.api.get("/api/audit"), 403, "forbidden")

    entry = desk.draft(studio, category, images=0)
    field_error(studio.api.patch(f"/api/entries/{entry['id']}", {"title": ""}), "title")
    closed = desk.close_entries(program)
    label = deadline_label("Europe/Lisbon", date.fromisoformat(PAST_DEADLINE))
    assert closed["deadlineLabel"] == label
    refused(studio.api.patch(f"/api/entries/{entry['id']}", {"title": ""}), 409, "deadline_passed",
            f"Entries closed at {label}.")


def test_programs_and_categories(app_url: str) -> None:
    desk = Desk(app_url)
    program = desk.program()
    assert set(program) == PROGRAM_KEYS
    assert (program["earlyBirdFeeCents"], program["standardFeeCents"]) == (EARLY_FEE, STANDARD_FEE)
    assert (program["currentTier"], program["currentFeeCents"], program["entriesOpen"]) == ("early_bird", EARLY_FEE,
                                                                                            True)
    valid = {"name": unique("Program")[0], "year": YEAR_MIN, "timeZone": "Asia/Kolkata", "earlyBirdDate": OPEN_DEADLINE,
             "deadlineDate": OPEN_DEADLINE, "earlyBirdFeeCents": FEE_MAX, "standardFeeCents": FEE_MAX}
    ok(desk.director.post("/api/programs", valid), 201)
    ok(desk.director.post("/api/programs", {**valid, "name": unique("Program")[0], "year": YEAR_MAX,
                                            "earlyBirdFeeCents": FEE_MIN}), 201)
    bad_cases = [
        ({"name": "x"}, "name"),
        ({"year": YEAR_MIN - 1}, "year"),
        ({"year": YEAR_MAX + 1}, "year"),
        ({"timeZone": BAD_ZONE}, "timeZone"),
        ({"earlyBirdFeeCents": FEE_MIN - 1}, "earlyBirdFeeCents"),
        ({"standardFeeCents": FEE_MAX + 1}, "standardFeeCents"),
        ({"earlyBirdFeeCents": STANDARD_FEE, "standardFeeCents": EARLY_FEE}, None),
        ({"earlyBirdDate": OPEN_DEADLINE, "deadlineDate": OPEN_EARLY}, None),
    ]
    for change, name in bad_cases:
        probe = {**valid, "name": unique("Program")[0], **change}
        resp = desk.director.post("/api/programs", probe)
        if name:
            field_error(resp, name)
        else:
            assert refused(resp, 422)["errors"], resp.text
        listed = ok(Api(app_url).get("/api/programs"), 200)["programs"]
        assert all(p["name"] != probe["name"] for p in listed), probe

    updated = ok(desk.director.patch(f"/api/programs/{program['id']}", {"deadlineDate": OPEN_DEADLINE,
                                                                        "earlyBirdDate": MID_DEADLINE}), 200)["program"]
    assert (updated["earlyBirdDate"], updated["deadlineDate"]) == (MID_DEADLINE, OPEN_DEADLINE)
    assert updated["earlyBirdLabel"] == deadline_label("Europe/Lisbon", date.fromisoformat(MID_DEADLINE))
    assert refused(desk.director.patch(f"/api/programs/{program['id']}", {"earlyBirdDate": LATE_DATE}), 422)[
        "errors"]
    again = next(p for p in ok(Api(app_url).get("/api/programs"), 200)["programs"] if p["id"] == program["id"])
    assert again["earlyBirdDate"] == MID_DEADLINE

    category = desk.category(program, 5, 3)
    assert set(category) == CATEGORY_KEYS | {"rounds"}
    assert sorted((r["name"], r["kind"], r["state"]) for r in category["rounds"]) == [
        ("Final round", "final", "scheduled"), ("Round 1", "round_1", "scheduled")]
    path = f"/api/programs/{program['id']}/categories"
    refused(desk.director.post(path, {"name": category["name"].upper(), "shortlistSize": 5, "finalistCount": 3}), 409,
            "category_exists", "That category already exists in this program.")
    for change, name in [({"name": "x"}, "name"), ({"shortlistSize": 0}, "shortlistSize"),
                         ({"shortlistSize": SHORTLIST_MAX + 1}, "shortlistSize"), ({"finalistCount": 0}, "finalistCount"),
                         ({"shortlistSize": 2, "finalistCount": 3}, "finalistCount")]:
        field_error(desk.director.post(path, {"name": unique("Category")[0], "shortlistSize": 5, "finalistCount": 3,
                                              **change}), name)
    ok(desk.director.post(path, {"name": unique("Category")[0], "shortlistSize": SHORTLIST_MAX,
                                 "finalistCount": SHORTLIST_MAX}), 201)
    public = next(p for p in ok(Api(app_url).get("/api/programs"), 200)["programs"] if p["id"] == program["id"])
    assert all(set(c) == CATEGORY_KEYS for c in public["categories"]), public["categories"]


def test_deadlines_in_program_zone(app_url: str, mail: Any) -> None:
    desk = Desk(app_url)
    cases = [("Asia/Kolkata", date.fromisoformat(OPEN_EARLY), date.fromisoformat(OPEN_DEADLINE)),
             ("Europe/Lisbon", date.fromisoformat(MID_EARLY), date.fromisoformat(MID_DEADLINE))]
    made = {}
    for zone, early, deadline in cases:
        program = desk.program(zone=zone, early=early.isoformat(), deadline=deadline.isoformat())
        assert_instant(program["deadlineAt"], boundary(zone, deadline))
        assert_instant(program["earlyBirdEndsAt"], boundary(zone, early))
        assert program["deadlineLabel"] == deadline_label(zone, deadline)
        assert program["earlyBirdLabel"] == deadline_label(zone, early)
        assert program["entriesOpen"] is True
        made[zone] = program
    assert made["Asia/Kolkata"]["deadlineAt"].endswith("+05:30")

    category = desk.category(made["Asia/Kolkata"])
    studio = desk.studio()
    entry = desk.draft(studio, category)
    label = made["Asia/Kolkata"]["deadlineLabel"]
    assert entry["deadlineLabel"] == label
    entry = ok(pay(studio.api, entry["id"]), 201)["entry"]
    assert (entry["canWithdraw"], entry["refundOnWithdraw"]) == (True, True)
    [receipt] = inbox(mail, studio.email, receipt_subject(entry))
    assert f"Withdraw before {label} for a full refund." in text(receipt)

    closed = desk.close_entries(made["Asia/Kolkata"])
    assert closed["entriesOpen"] is False
    assert ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]["refundOnWithdraw"] is False
    late_title, _ = unique("Entry")
    refused(studio.api.post("/api/entries", {"categoryId": category["id"], "title": late_title, "summary": late_title,
                                             "siteUrl": SITE_URL, "credits": ""}), 409, "deadline_passed")


def test_entry_drafts(app_url: str, s3: S3) -> None:
    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program)
    studio = desk.studio()
    first = desk.draft(studio, category, images=0)
    assert set(first) == ENTRY_KEYS
    assert (first["state"], first["statusLabel"], first["entryNumber"]) == ("draft", "Draft", 1)
    second = desk.draft(studio, category, images=2)
    assert second["entryNumber"] == 2
    renamed, _ = unique("Entry")
    edited = ok(studio.api.patch(f"/api/entries/{first['id']}", {"title": renamed}), 200)["entry"]
    assert edited["title"] == renamed
    assert ok(studio.api.get(f"/api/entries/{first['id']}"), 200)["entry"]["title"] == renamed
    probe_title, _ = unique("Entry")
    base = {"categoryId": category["id"], "title": probe_title, "summary": probe_title, "siteUrl": SITE_URL,
            "credits": ""}
    field_error(studio.api.post("/api/entries", {**base, "siteUrl": HTTP_SITE}), "siteUrl")
    field_error(studio.api.post("/api/entries", {**base, "title": ""}), "title")
    field_error(studio.api.post("/api/entries", {**base, "categoryId": UNKNOWN_ID}), "categoryId")

    prefix = f"entries/{second['id']}/"
    assert len(s3.keys(prefix)) == 2
    assert studio.api.delete(f"/api/entries/{second['id']}").status_code == 204
    assert s3.keys(prefix) == []
    refused(studio.api.get(f"/api/entries/{second['id']}"), 404, "not_found")
    assert all(e["id"] != second["id"] for e in ok(studio.api.get("/api/entries"), 200)["entries"])


IMAGE_CASE_IDS = ["accepted_png", "accepted_max_side", "accepted_exact_limit", "path_in_name", "too_large",
                  "too_large_checked_before_type", "gif_rejected", "svg_named_png", "html_declared_png",
                  "truncated_png", "too_narrow", "too_wide", "seventh_image"]


def image_case(case: str) -> tuple[str, bytes, str, tuple]:
    long_name = "a" * LONG_NAME_LEN + ".png"
    return {
        "accepted_png": lambda: ("shot.png", png(MIN_SIDE, MIN_SIDE), "image/png", ("ok", MIN_SIDE, MIN_SIDE, "shot.png")),
        "accepted_max_side": lambda: ("wide.png", png(MAX_SIDE, MIN_SIDE), "image/png",
                                      ("ok", MAX_SIDE, MIN_SIDE, "wide.png")),
        "accepted_exact_limit": lambda: ("big.png", padded_png(UPLOAD_LIMIT), "image/png",
                                         ("ok", MIN_SIDE, MIN_SIDE, "big.png")),
        "path_in_name": lambda: ("../../uploads/" + long_name, png(MIN_SIDE, MIN_SIDE), "image/png",
                                 ("ok", MIN_SIDE, MIN_SIDE, long_name[:NAME_CUT])),
        "too_large": lambda: ("big.png", padded_png(UPLOAD_LIMIT + 1), "image/png",
                              (413, "file_too_large", COPY_TOO_LARGE)),
        "too_large_checked_before_type": lambda: ("big.gif", b"GIF89a" + b"\x00" * (UPLOAD_LIMIT - 5), "image/gif",
                                                  (413, "file_too_large", COPY_TOO_LARGE)),
        "gif_rejected": lambda: ("shot.png", b"GIF89a" + struct.pack("<HH", MIN_SIDE, MIN_SIDE) + b"\x00" * 64,
                                 "image/png", (415, "unsupported_type", COPY_TYPE)),
        "svg_named_png": lambda: ("shot.png", b'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">'
                                              b"<script>alert(1)</script></svg>", "image/png",
                                  (415, "unsupported_type", COPY_TYPE)),
        "html_declared_png": lambda: ("shot.png", b"<!doctype html><html><script>alert(1)</script></html>",
                                      "image/png", (415, "unsupported_type", COPY_TYPE)),
        "truncated_png": lambda: ("shot.png", png(MIN_SIDE, MIN_SIDE)[:200], "image/png", (422, "file", COPY_UNREADABLE)),
        "too_narrow": lambda: ("shot.png", png(MIN_SIDE - 1, MIN_SIDE), "image/png", (422, "file", COPY_DIMENSIONS)),
        "too_wide": lambda: ("shot.png", png(MAX_SIDE + 1, MIN_SIDE), "image/png", (422, "file", COPY_DIMENSIONS)),
        "seventh_image": lambda: ("shot.png", png(MIN_SIDE, MIN_SIDE, seed=9), "image/png", (422, "file", COPY_COUNT)),
    }[case]()


@pytest.mark.parametrize("case", IMAGE_CASE_IDS, ids=IMAGE_CASE_IDS)
def test_image_checks(app_url: str, s3: S3, case: str) -> None:
    desk = Desk(app_url)
    category = desk.category(desk.program())
    studio = desk.studio()
    entry = desk.draft(studio, category, images=MAX_IMAGES if case == "seventh_image" else 0)
    prefix = f"entries/{entry['id']}/"
    before = sorted(s3.keys(prefix))
    name, data, ctype, expected = image_case(case)
    resp = upload(studio.api, entry["id"], data, name, ctype)
    if expected[0] == "ok":
        asset = ok(resp, 201)["asset"]
        assert set(asset) == ASSET_KEYS
        assert (asset["width"], asset["height"], asset["name"]) == expected[1:]
        assert asset["url"] == f"/api/assets/{asset['id']}"
        assert "png" in asset["type"].lower() and isinstance(asset["bytes"], int) and asset["bytes"] > 0
        assert sorted(s3.keys(prefix)) == sorted(before + [f"{prefix}{asset['id']}.png"])
        stored = ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]["assets"]
        assert [a["id"] for a in stored] == [asset["id"]]
        return
    status, code, copy = expected
    if status == 422:
        field_error(resp, code, copy)
    else:
        refused(resp, status, code, copy)
    assert sorted(s3.keys(prefix)) == before
    assert len(ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]["assets"]) == len(before)


def test_reencoded_images_served(app_url: str, s3: S3) -> None:
    desk = Desk(app_url)
    category = desk.category(desk.program())
    owner, other = desk.studio(), desk.studio()
    entry = desk.draft(owner, category, images=0)
    asset = ok(upload(owner.api, entry["id"], png(MIN_SIDE, MIN_SIDE, metadata=MARKER, trailer=MARKER),
                      UPLOAD_NAME, "image/png"), 201)["asset"]
    key = f"entries/{entry['id']}/{asset['id']}.png"
    stored = s3.get(key)
    served = owner.api.get(asset["url"])
    assert served.status_code == 200
    assert served.headers["Content-Type"].startswith("image/png")
    assert served.headers.get("X-Content-Type-Options", "").lower() == "nosniff"
    assert served.content == stored and served.content.startswith(PNG_SIGNATURE)
    assert MARKER not in served.content and Path(UPLOAD_NAME).stem not in key
    director_view = desk.director.get(asset["url"])
    assert director_view.status_code == 200 and director_view.content == stored
    refused(other.api.get(asset["url"]), 404, "not_found")
    refused(Api(app_url).get(asset["url"]), 404, "not_found")
    refused(desk.juror().api.get(asset["url"]), 404, "not_found")


def test_fee_tier_at_payment(app_url: str, killbill: Any, mail: Any) -> None:
    desk = Desk(app_url)
    for early, fee, tier, tier_label in [(OPEN_EARLY, EARLY_FEE, "early_bird", "Early-bird"),
                                         (PAST_EARLY, STANDARD_FEE, "standard", "Standard")]:
        program = desk.program(early=early)
        assert (program["currentTier"], program["currentFeeCents"]) == (tier, fee)
        category = desk.category(program)
        studio = desk.studio()
        entry = desk.draft(studio, category)
        body = ok(pay(studio.api, entry["id"]), 201)
        assert body["entry"]["fee"] == {"tier": tier, "amountCents": fee}
        receipt = body["receipt"]
        assert set(receipt) == RECEIPT_KEYS
        assert (receipt["amountCents"], receipt["tier"], receipt["currency"]) == (fee, tier, "USD")
        invoice = ok(studio.api.get(f"/api/invoices/{receipt['invoiceId']}"), 200)["invoice"]
        assert set(invoice) == INVOICE_KEYS and (invoice["tier"], invoice["amountCents"]) == (tier, fee)
        [purchase] = successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "PURCHASE")
        assert cents_of(purchase) == fee
        [message] = inbox(mail, studio.email, receipt_subject(entry))
        assert f"${dollars(fee)}" in text(message) and tier_label in text(message)


def test_submission_all_or_nothing(app_url: str, killbill: Any, mail: Any, s3: S3) -> None:
    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program)
    studio = desk.studio()
    bare = desk.draft(studio, category, images=0)
    field_error(pay(studio.api, bare["id"]), "assets", "Add at least one case-study image.")
    assert ok(studio.api.get(f"/api/entries/{bare['id']}"), 200)["entry"]["state"] == "draft"
    assert successful(killbill.payment_by_key(f"cutline-entry-{bare['id']}"), "PURCHASE") == []

    entry = desk.draft(studio, category)
    body = ok(pay(studio.api, entry["id"]), 201)
    submitted = body["entry"]
    assert (submitted["state"], submitted["statusLabel"]) == ("submitted", "Submitted")
    assert s3.keys(f"entries/{entry['id']}/") == [f"entries/{entry['id']}/{entry['assets'][0]['id']}.png"]
    account = killbill.account_by_key(f"cutline-studio-{studio.id}")
    assert account is not None and account.get("email", "").lower() == studio.email.lower()
    assert account.get("currency") == "USD"
    assert killbill.default_plugin(account[KB_ACCOUNT_ID]) == "__EXTERNAL_PAYMENT__"
    payment = killbill.payment_by_key(f"cutline-entry-{entry['id']}")
    [purchase] = successful(payment, "PURCHASE")
    assert cents_of(purchase) == EARLY_FEE and purchase.get("currency") == "USD"
    messages = inbox(mail, studio.email, receipt_subject(entry), expected=2, seconds=MAIL_POLL_S * 3)
    assert len(messages) == 1
    assert DESK_FROM in [a.lower() for a in addresses(messages[0].get(MAIL_FROM))]
    content = text(messages[0])
    for part in (category["name"], f"${dollars(EARLY_FEE)}", "Early-bird", body["receipt"]["invoiceId"]):
        assert part in content, part

    path = f"/api/entries/{entry['id']}"
    for resp in (studio.api.patch(path, {"title": unique("Entry")[0]}), studio.api.delete(path),
                 upload(studio.api, entry["id"], png(MIN_SIDE, MIN_SIDE)), pay(studio.api, entry["id"])):
        err = refused(resp, 409, "invalid_transition", COPY_INVALID)
        assert err.get("from") == "submitted"

    late = desk.draft(studio, category)
    desk.close_entries(program)
    refused(pay(studio.api, late["id"]), 409, "deadline_passed")
    assert ok(studio.api.get(f"/api/entries/{late['id']}"), 200)["entry"]["state"] == "draft"
    assert successful(killbill.payment_by_key(f"cutline-entry-{late['id']}"), "PURCHASE") == []


def test_idempotent_submission(app_url: str, killbill: Any, mail: Any) -> None:
    desk = Desk(app_url)
    category = desk.category(desk.program())
    studio = desk.studio()
    entry, other = desk.draft(studio, category), desk.draft(studio, category)
    field_error(studio.api.post(f"/api/entries/{entry['id']}/submit", {}), "idempotencyKey",
                "Send an Idempotency-Key header of 1 to 100 characters.")
    field_error(pay(studio.api, entry["id"], "k" * (KEY_MAX + 1)), "idempotencyKey")
    key = idempotency_key()
    first = pay(studio.api, entry["id"], key)
    replay = pay(studio.api, entry["id"], key)
    assert first.status_code == replay.status_code == 201
    assert replay.json() == first.json()
    refused(pay(studio.api, other["id"], key), 409, "idempotency_key_reused")
    assert ok(studio.api.get(f"/api/entries/{other['id']}"), 200)["entry"]["state"] == "draft"
    assert successful(killbill.payment_by_key(f"cutline-entry-{other['id']}"), "PURCHASE") == []
    assert len(successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "PURCHASE")) == 1
    assert len(inbox(mail, studio.email, receipt_subject(entry), expected=2, seconds=MAIL_POLL_S * 3)) == 1


def test_idempotent_submission_concurrent(app_url: str, killbill: Any) -> None:
    desk = Desk(app_url)
    category = desk.category(desk.program())
    studio = desk.studio()
    callers = [sign_in(app_url, studio.email, PASSWORD) for _ in range(3)]

    def race(entry_id: str, keys: list[str]) -> list[httpx.Response]:
        barrier = threading.Barrier(len(keys))
        out: list[httpx.Response | None] = [None] * len(keys)

        def run(i: int) -> None:
            barrier.wait()
            out[i] = pay(callers[i], entry_id, keys[i])
        threads = [threading.Thread(target=run, args=(i,)) for i in range(len(keys))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        return [r for r in out if r is not None]

    shared = desk.draft(studio, category)
    key = idempotency_key()
    pair = race(shared["id"], [key, key])
    assert [r.status_code for r in pair] == [201, 201], [r.text for r in pair]
    assert pair[0].json() == pair[1].json()
    assert len(successful(killbill.payment_by_key(f"cutline-entry-{shared['id']}"), "PURCHASE")) == 1

    contested = desk.draft(studio, category)
    results = race(contested["id"], [idempotency_key() for _ in callers])
    statuses = sorted(r.status_code for r in results)
    assert statuses == [201, 409, 409], [r.text for r in results]
    assert all(r.json()["error"] == "invalid_transition" for r in results if r.status_code == 409)
    assert len(successful(killbill.payment_by_key(f"cutline-entry-{contested['id']}"), "PURCHASE")) == 1


def test_billing_outage_keeps_draft(app_url: str, killbill: Any, mail: Any) -> None:
    down = os.environ[DOWN_URL_ENV].rstrip("/")
    assert ok(httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT_S), 200) == {"status": "ok"}
    desk = Desk(app_url)
    category = desk.category(desk.program())
    studio = desk.studio()
    entry = desk.draft(studio, category, images=2)
    outage = sign_in(down, studio.email, PASSWORD)
    key = idempotency_key()
    refused(pay(outage, entry["id"], key), 503, "payments_paused", COPY_PAY_PAUSED)
    after = ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]
    assert after == entry
    assert successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "PURCHASE") == []
    assert inbox(mail, studio.email, receipt_subject(entry), seconds=MAIL_POLL_S) == []

    submitted = ok(pay(studio.api, entry["id"], key), 201)["entry"]
    assert submitted["state"] == "submitted"
    refused(outage.post(f"/api/entries/{entry['id']}/withdraw", {}), 503, "payments_paused", COPY_REFUND_PAUSED)
    assert ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]["state"] == "submitted"
    payment = killbill.payment_by_key(f"cutline-entry-{entry['id']}")
    assert len(successful(payment, "PURCHASE")) == 1 and successful(payment, "REFUND") == []
    assert inbox(mail, studio.email, refund_subject(entry), seconds=MAIL_POLL_S) == []


def test_studio_records_private(app_url: str, s3: S3, killbill: Any) -> None:
    desk = Desk(app_url)
    category = desk.category(desk.program())
    owner, other = desk.studio(), desk.studio()
    entry = desk.submitted(owner, category)
    asset_id = entry["assets"][0]["id"]
    receipt = ok(owner.api.get(f"/api/entries/{entry['id']}/receipt"), 200)["receipt"]
    assert ok(owner.api.get(f"/api/invoices/{receipt['invoiceId']}"), 200)["invoice"]["status"] == "paid"
    own = desk.draft(other, category, images=0)
    base = f"/api/entries/{entry['id']}"
    probes = [
        other.api.get(base), other.api.patch(base, {"title": unique("Entry")[0]}), other.api.delete(base),
        other.api.get(f"{base}/receipt"), other.api.get(f"/api/invoices/{receipt['invoiceId']}"),
        other.api.get(f"/api/assets/{asset_id}"), other.api.post(f"{base}/withdraw", {}),
        pay(other.api, entry["id"]), upload(other.api, entry["id"], png(MIN_SIDE, MIN_SIDE)),
        other.api.delete(f"/api/entries/{own['id']}/assets/{asset_id}"),
    ]
    for resp in probes:
        refused(resp, 404, "not_found")
    assert all(e["id"] != entry["id"] for e in ok(other.api.get("/api/entries"), 200)["entries"])
    still = ok(owner.api.get(base), 200)["entry"]
    assert (still["state"], still["title"]) == ("submitted", entry["title"])
    assert f"entries/{entry['id']}/{asset_id}.png" in s3.keys(f"entries/{entry['id']}/")
    assert successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "REFUND") == []


def test_withdraw_refund(app_url: str, killbill: Any, mail: Any) -> None:
    desk = Desk(app_url)
    zone = "Asia/Kolkata"
    program = desk.program(zone=zone)
    category = desk.category(program)
    studio = desk.studio()
    draft = desk.draft(studio, category, images=0)
    refused(studio.api.post(f"/api/entries/{draft['id']}/withdraw", {}), 409, "invalid_transition", COPY_INVALID)
    early, late = desk.submitted(studio, category), desk.submitted(studio, category)
    assert (late["deadlineLabel"], late["refundOnWithdraw"]) == (
        deadline_label(zone, date.fromisoformat(OPEN_DEADLINE)), True)
    body = ok(studio.api.post(f"/api/entries/{early['id']}/withdraw", {}), 200)
    assert body["refund"]["amountCents"] == EARLY_FEE
    assert (body["entry"]["state"], body["entry"]["statusLabel"]) == ("withdrawn", "Withdrawn")
    assert body["entry"]["canWithdraw"] is False
    [refund] = successful(killbill.payment_by_key(f"cutline-entry-{early['id']}"), "REFUND")
    assert cents_of(refund) == EARLY_FEE
    receipt = ok(studio.api.get(f"/api/entries/{early['id']}/receipt"), 200)["receipt"]
    assert receipt["refund"]["amountCents"] == EARLY_FEE
    assert ok(studio.api.get(f"/api/invoices/{receipt['invoiceId']}"), 200)["invoice"]["status"] == "refunded"
    [message] = inbox(mail, studio.email, refund_subject(early))
    assert f"${dollars(EARLY_FEE)}" in text(message) and "refunded" in text(message)
    refused(studio.api.post(f"/api/entries/{early['id']}/withdraw", {}), 409, "invalid_transition")

    desk.close_entries(program)
    view = ok(studio.api.get(f"/api/entries/{late['id']}"), 200)["entry"]
    assert (view["canWithdraw"], view["refundOnWithdraw"]) == (True, False)
    assert view["deadlineLabel"] == deadline_label(zone, date.fromisoformat(PAST_DEADLINE))
    body = ok(studio.api.post(f"/api/entries/{late['id']}/withdraw", {}), 200)
    assert body["refund"] is None and body["entry"]["state"] == "withdrawn"
    assert successful(killbill.payment_by_key(f"cutline-entry-{late['id']}"), "REFUND") == []
    assert inbox(mail, studio.email, refund_subject(late)) == []


def test_screening_and_reinstatement(app_url: str) -> None:
    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program)
    studio = desk.studio()
    first, second = desk.submitted(studio, category), desk.submitted(studio, category)
    label = program["deadlineLabel"]
    refused(desk.director.post(f"/api/entries/{first['id']}/screen", {"decision": "pass"}), 409, "deadline_not_passed",
            f"Entries are still open until {label}.")
    desk.close_entries(program)
    listed = ok(desk.director.get(f"/api/categories/{category['id']}/entries"), 200)["entries"]
    mine = [e for e in listed if e["id"] in (first["id"], second["id"])]
    assert [e["entryNumber"] for e in mine] == sorted(e["entryNumber"] for e in mine)
    assert all(set(e) == DIRECTOR_ENTRY_KEYS and e["studioEmail"].lower() == studio.email.lower() for e in mine)
    passed = desk.screen(first["id"])
    assert passed["state"] == "screened"
    screen = f"/api/entries/{second['id']}/screen"
    field_error(desk.director.post(screen, {"decision": BAD_DECISION}), "decision")
    field_error(desk.director.post(screen, {"decision": "disqualify", "reason": ""}), "reason", COPY_REASON)
    field_error(desk.director.post(screen, {"decision": "disqualify", "reason": "r" * (REASON_MAX + 1)}), "reason")
    assert desk.state(second["id"]) == "submitted"
    reason, _ = unique("Reason")
    out = ok(desk.director.post(screen, {"decision": "disqualify", "reason": reason}), 200)["entry"]
    assert out["state"] == "disqualified"
    seen = ok(studio.api.get(f"/api/entries/{second['id']}"), 200)["entry"]
    assert (seen["state"], seen["statusLabel"], seen["disqualifyReason"]) == ("disqualified", "Disqualified", reason)
    outsider = desk.studio()
    refused(outsider.api.get(f"/api/entries/{second['id']}"), 404, "not_found")
    refused(outsider.api.post(f"/api/entries/{second['id']}/reinstate", {}), 404, "not_found")
    refused(studio.api.post(f"/api/entries/{second['id']}/reinstate", {}), 403, "forbidden")
    assert desk.state(second["id"]) == "disqualified"
    refused(desk.director.post(screen, {"decision": "pass"}), 409, "invalid_transition")
    back = ok(desk.director.post(f"/api/entries/{second['id']}/reinstate", {}), 200)["entry"]
    assert back["state"] == "screened"
    assert ok(studio.api.get(f"/api/entries/{second['id']}"), 200)["entry"]["statusLabel"] == "Screened"
    refused(desk.director.post(f"/api/entries/{second['id']}/reinstate", {}), 409, "invalid_transition")
    again = ok(desk.director.post(f"/api/entries/{first['id']}/screen",
                                  {"decision": "disqualify", "reason": reason}), 200)["entry"]
    assert again["state"] == "disqualified"


DIRECTOR_ACTION_IDS = ["create_program", "update_dates", "add_category", "create_juror", "screen", "reinstate",
                       "add_to_panel", "open_round", "close_round", "confirm_round", "publish", "read_standings",
                       "read_round", "read_summary", "read_audit"]


@pytest.mark.parametrize("action", DIRECTOR_ACTION_IDS, ids=DIRECTOR_ACTION_IDS)
def test_director_only_refused(app_url: str, action: str) -> None:
    desk = Desk(app_url)
    studio = desk.studio()
    juror = desk.juror()
    ctx = open_round_one(desk, [studio], [juror])
    program, category, rounds = ctx["program"], ctx["category"], ctx["rounds"]
    entry_id = ctx["entries"][0]["id"]
    spare = desk.juror()
    name = unique("Program")[0]
    method, path, body = {
        "create_program": ("POST", "/api/programs", {"name": name, "year": PROGRAM_YEAR, "timeZone": "Europe/Lisbon",
                                                     "earlyBirdDate": OPEN_EARLY, "deadlineDate": OPEN_DEADLINE,
                                                     "earlyBirdFeeCents": EARLY_FEE, "standardFeeCents": STANDARD_FEE}),
        "update_dates": ("PATCH", f"/api/programs/{program['id']}", {"deadlineDate": OPEN_DEADLINE}),
        "add_category": ("POST", f"/api/programs/{program['id']}/categories",
                         {"name": name, "shortlistSize": 1, "finalistCount": 1}),
        "create_juror": ("POST", "/api/jurors", {"name": name, "email": unique("Juror")[1], "password": PASSWORD,
                                                 "studioId": None}),
        "screen": ("POST", f"/api/entries/{entry_id}/screen", {"decision": "disqualify", "reason": name}),
        "reinstate": ("POST", f"/api/entries/{entry_id}/reinstate", {}),
        "add_to_panel": ("POST", f"/api/rounds/{rounds['final']}/jurors", {"jurorId": spare.id}),
        "open_round": ("POST", f"/api/rounds/{rounds['final']}/open", {"ballotDeadline": BALLOT_DATE}),
        "close_round": ("POST", f"/api/rounds/{rounds['round_1']}/close", {}),
        "confirm_round": ("POST", f"/api/rounds/{rounds['round_1']}/confirm", {}),
        "publish": ("POST", f"/api/categories/{category['id']}/publish", {"embargoAt": PAST_EMBARGO}),
        "read_standings": ("GET", f"/api/rounds/{rounds['round_1']}/standings", None),
        "read_round": ("GET", f"/api/rounds/{rounds['round_1']}", None),
        "read_summary": ("GET", f"/api/programs/{program['id']}/summary", None),
        "read_audit": ("GET", "/api/audit", None),
    }[action]
    for caller in (juror.api, studio.api):
        refused(caller.call(method, path, body), 403, "forbidden")
    detail = ok(desk.director.get(f"/api/rounds/{rounds['round_1']}"), 200)
    assert detail["round"]["state"] == "open"
    assert ok(desk.director.get(f"/api/rounds/{rounds['final']}"), 200)["round"]["state"] == "scheduled"
    assert all(p["jurorId"] != spare.id for p in desk.panel(rounds["final"]))
    assert desk.state(entry_id) == "round_1"
    programs = ok(Api(app_url).get("/api/programs"), 200)["programs"]
    assert all(p["name"] != name for p in programs)
    mine = next(p for p in programs if p["id"] == program["id"])
    assert mine["deadlineDate"] == PAST_DEADLINE and len(mine["categories"]) == 1
    assert all(j["name"] != name for j in ok(desk.director.get("/api/jurors"), 200)["jurors"])


def test_juror_conflicts(app_url: str) -> None:
    desk = Desk(app_url)
    home = desk.studio()
    juror = desk.juror(home.id)
    assert ok(juror.api.get("/api/session"), 200)["user"]["studioName"] == home.name
    _, email = unique("Juror")
    field_error(desk.director.post("/api/jurors", {"name": unique("Juror")[0], "email": email, "password": PASSWORD,
                                                   "studioId": UNKNOWN_ID}), "studioId")
    cased = desk.director.post("/api/jurors", {"name": unique("Juror")[0], "email": juror.email.upper(),
                                               "password": PASSWORD, "studioId": None})
    assert cased.status_code in (201, 409), cased.text
    if cased.status_code == 409:
        assert cased.json().get("error") == "email_taken", cased.json()

    rival, other = desk.studio(), desk.studio()
    program = desk.program()
    scheduled_cat, open_cat = desk.category(program), desk.category(program)
    scheduled_entry = desk.submitted(rival, scheduled_cat)
    rival_open, other_open = desk.submitted(rival, open_cat), desk.submitted(other, open_cat)
    desk.close_entries(program)
    for e in (scheduled_entry, rival_open, other_open):
        desk.screen(e["id"])
    sched_round, open_round = round_ids(scheduled_cat)["round_1"], round_ids(open_cat)["round_1"]
    panel = desk.add_panel(sched_round, juror)
    assert next(p for p in panel if p["jurorId"] == juror.id)["assigned"] == 1
    desk.add_panel(open_round, juror)
    desk.open(open_round)
    score(juror, open_round, rival_open["id"], same(9))
    refused(rival.api.post("/api/conflicts", {"studioId": other.id}), 403, "forbidden")
    field_error(juror.api.post("/api/conflicts", {"studioId": UNKNOWN_ID}), "studioId")

    resp = juror.api.post("/api/conflicts", {"studioId": rival.id, "note": "Former client"})
    body = ok(resp, 201)
    assert (body["conflict"]["studioId"], body["conflict"]["studioName"]) == (rival.id, rival.name)
    assert body["removedAssignments"] == 1
    repeat = juror.api.post("/api/conflicts", {"studioId": rival.id})
    assert repeat.status_code == 200 and repeat.json()["removedAssignments"] == 0
    listed = json.dumps(ok(juror.api.get("/api/conflicts"), 200)["conflicts"])
    assert rival.id in listed or rival.name in listed
    assert next(p for p in desk.panel(sched_round) if p["jurorId"] == juror.id)["assigned"] == 0
    view = ballot(juror, open_round)
    assert [e["entryId"] for e in view["entries"]] == [other_open["id"]]
    score(juror, open_round, other_open["id"], same(4))
    submit_ballot(juror, open_round)
    stored = desk.close(open_round)["standings"]["rows"]
    rival_row = next(r for r in stored if r["entryId"] == rival_open["id"])
    assert (rival_row["score"], rival_row["ballotsCounted"]) == (None, 0)


def test_conflict_free_assignment(app_url: str) -> None:
    desk = Desk(app_url)
    home, conflict, other = desk.studio(), desk.studio(), desk.studio()
    j_home, j_conflict, j_free = desk.juror(home.id), desk.juror(), desk.juror()
    ok(j_conflict.api.post("/api/conflicts", {"studioId": conflict.id}), 201)
    program = desk.program()
    category = desk.category(program)
    rid = round_ids(category)["round_1"]
    entries = {s.id: desk.submitted(s, category)["id"] for s in (home, conflict, other)}
    desk.close_entries(program)
    for eid in entries.values():
        desk.screen(eid)
    first = desk.director.post(f"/api/rounds/{rid}/jurors", {"jurorId": j_home.id})
    assert first.status_code == 201
    assert desk.director.post(f"/api/rounds/{rid}/jurors", {"jurorId": j_home.id}).status_code == 200
    field_error(desk.director.post(f"/api/rounds/{rid}/jurors", {"jurorId": UNKNOWN_ID}), "jurorId",
                "Choose a juror.")
    for j in (j_conflict, j_free):
        desk.add_panel(rid, j)
    panel = {p["jurorId"]: p for p in desk.panel(rid)}
    assert (panel[j_home.id]["assigned"], panel[j_conflict.id]["assigned"], panel[j_free.id]["assigned"]) == (2, 2, 3)
    desk.open(rid)
    expected = {j_home.id: {entries[conflict.id], entries[other.id]},
                j_conflict.id: {entries[home.id], entries[other.id]},
                j_free.id: set(entries.values())}
    for j in (j_home, j_conflict, j_free):
        assert {e["entryId"] for e in ballot(j, rid)["entries"]} == expected[j.id]
    refused(j_home.api.put(f"/api/rounds/{rid}/scores/{entries[home.id]}", scores(*same(5))), 404, "not_found")


def test_recusal_excluded(app_url: str) -> None:
    desk = Desk(app_url)
    s1, s2 = desk.studio(), desk.studio()
    j1, j2 = desk.juror(), desk.juror()
    ctx = open_round_one(desk, [s1, s2], [j1, j2])
    rid = ctx["rounds"]["round_1"]
    e1, e2 = (e["id"] for e in ctx["entries"])
    for j in (j1, j2):
        score(j, rid, e1, same(8))
        score(j, rid, e2, same(4))
        submit_ballot(j, rid)
    field_error(j1.api.post(f"/api/rounds/{rid}/entries/{e1}/recuse", {"note": "n" * (REASON_MAX + 1)}), "note")
    body = ok(j1.api.post(f"/api/rounds/{rid}/entries/{e1}/recuse", {"note": unique("Note")[0]}), 200)
    assert body["remaining"] == 0
    assert [e["entryId"] for e in ballot(j1, rid)["entries"]] == [e2]
    assert next(p for p in desk.panel(rid) if p["jurorId"] == j1.id)["assigned"] == 1
    rows = {r["entryId"]: r for r in desk.close(rid)["standings"]["rows"]}
    expected = round_scores([{e2: same(4)}, {e1: same(8), e2: same(4)}])
    assert (rows[e1]["score"], rows[e1]["ballotsCounted"]) == (expected[e1], 1)
    assert (rows[e2]["score"], rows[e2]["ballotsCounted"]) == (expected[e2], 2)


def test_round_state_machine(app_url: str) -> None:
    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program, 1, 1)
    empty = desk.category(program, 1, 1)
    rounds, empty_rounds = round_ids(category), round_ids(empty)
    studio = desk.studio()
    juror = desk.juror()
    entry = desk.submitted(studio, category)
    desk.add_panel(rounds["round_1"], juror)
    desk.add_panel(rounds["final"], juror)
    post = desk.director.post
    for step in ("close", "confirm"):
        refused(post(f"/api/rounds/{rounds['round_1']}/{step}", {}), 409, "invalid_transition", COPY_INVALID)
    open_body = {"ballotDeadline": BALLOT_DATE}
    refused(post(f"/api/rounds/{rounds['round_1']}/open", open_body), 409, "deadline_not_passed",
            f"Entries are still open until {program['deadlineLabel']}.")
    refused(post(f"/api/rounds/{rounds['final']}/open", open_body), 409, "previous_round_not_confirmed",
            "Confirm Round 1 standings before opening the final round.")
    desk.close_entries(program)
    refused(post(f"/api/rounds/{rounds['round_1']}/open", open_body), 409, "screening_incomplete",
            "Screen every submitted entry before opening Round 1.")
    desk.screen(entry["id"])
    refused(post(f"/api/rounds/{empty_rounds['round_1']}/open", open_body), 409, "panel_empty",
            "Add at least one juror before opening.")
    desk.add_panel(empty_rounds["round_1"], juror)
    refused(post(f"/api/rounds/{empty_rounds['round_1']}/open", open_body), 409, "no_entries",
            "There are no entries to judge in this round.")
    field_error(post(f"/api/rounds/{rounds['round_1']}/open", {"ballotDeadline": BAD_DATE}), "ballotDeadline")

    opened = desk.open(rounds["round_1"])
    assert opened["state"] == "open" and opened["ballotDeadline"] == BALLOT_DATE
    assert opened["ballotDeadlineLabel"] == deadline_label("Europe/Lisbon", date.fromisoformat(BALLOT_DATE))
    assert_instant(opened["ballotDeadlineAt"], boundary("Europe/Lisbon", date.fromisoformat(BALLOT_DATE)))
    assert desk.state(entry["id"]) == "round_1"
    refused(post(f"/api/rounds/{rounds['round_1']}/open", {"ballotDeadline": BAD_DATE}), 409, "invalid_transition")
    lock = "Judging has started, so dates and categories are locked."
    refused(desk.director.patch(f"/api/programs/{program['id']}", {"deadlineDate": OPEN_DEADLINE}), 409,
            "judging_started", lock)
    refused(post(f"/api/programs/{program['id']}/categories", {"name": unique("Category")[0], "shortlistSize": 1,
                                                                "finalistCount": 1}), 409, "judging_started", lock)
    refused(post(f"/api/rounds/{rounds['round_1']}/confirm", {}), 409, "invalid_transition")
    refused(post(f"/api/categories/{category['id']}/publish", {"embargoAt": PAST_EMBARGO}), 409,
            "final_not_confirmed", "Confirm the final round before publishing.")
    score(juror, rounds["round_1"], entry["id"], same(7))
    submit_ballot(juror, rounds["round_1"])

    closers = [sign_in(app_url, DIRECTOR_EMAIL, DIRECTOR_PASSWORD) for _ in range(2)]
    barrier = threading.Barrier(2)
    results: list[httpx.Response] = []
    lock_results = threading.Lock()

    def close_once(api: Api) -> None:
        barrier.wait()
        resp = api.post(f"/api/rounds/{rounds['round_1']}/close", {})
        with lock_results:
            results.append(resp)
    threads = [threading.Thread(target=close_once, args=(api,)) for api in closers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
    assert next(r for r in results if r.status_code == 409).json()["error"] == "invalid_transition"

    assert desk.confirm(rounds["round_1"])["round"]["state"] == "normalised"
    refused(post(f"/api/rounds/{rounds['round_1']}/jurors", {"jurorId": desk.juror().id}), 409, "invalid_transition")
    desk.open(rounds["final"])
    score(juror, rounds["final"], entry["id"], same(7))
    submit_ballot(juror, rounds["final"])
    desk.close(rounds["final"])
    desk.confirm(rounds["final"])
    desk.publish(category, PAST_EMBARGO)
    for rid in rounds.values():
        assert ok(desk.director.get(f"/api/rounds/{rid}"), 200)["round"]["state"] == "published"
    refused(post(f"/api/categories/{category['id']}/publish", {"embargoAt": PAST_EMBARGO}), 409, "invalid_transition")


def test_blind_ballot(app_url: str, s3: S3) -> None:
    desk = Desk(app_url)
    studios = [desk.studio(), desk.studio()]
    juror, outsider = desk.juror(), desk.juror()
    ctx = open_round_one(desk, studios, [juror])
    rid = ctx["rounds"]["round_1"]
    view = ballot(juror, rid)
    secrets = [s.name for s in studios] + [s.email for s in studios] + [s.contact for s in studios] + [SITE_URL]
    secrets += [e["credits"] for e in ctx["entries"]]
    for item in view["entries"]:
        assert set(item) == BLIND_KEYS
        assert all(set(img) == {"url", "width", "height"} for img in item["images"])
        assert juror.api.get(item["images"][0]["url"]).status_code == 200
    packet_text = s3.get(f"rounds/{rid}/jury-packet.json").decode()
    for blob in (json.dumps(view), packet_text):
        for secret in secrets:
            assert secret not in blob, secret
    refused(outsider.api.get(f"/api/rounds/{rid}/ballot"), 404, "not_found")
    refused(outsider.api.get(view["entries"][0]["images"][0]["url"]), 404, "not_found")
    refused(juror.api.get(f"/api/rounds/{ctx['rounds']['final']}/ballot"), 404, "not_found")


def test_scoring_and_final_ballot(app_url: str) -> None:
    desk = Desk(app_url)
    studios = [desk.studio(), desk.studio()]
    juror, late = desk.juror(), desk.juror()
    ctx = open_round_one(desk, studios, [juror, late])
    rid = ctx["rounds"]["round_1"]
    e1, e2 = (e["id"] for e in ctx["entries"])
    path = f"/api/rounds/{rid}/scores/{e1}"
    for bad in (scores(0, 5, 5, 5), scores(5, 11, 5, 5), {**scores(5, 5, 5, 5), "idea": 7.5},
                {**scores(5, 5, 5, 5), "story": "7"}):
        assert refused(juror.api.put(path, bad), 422)["errors"]
    refused(studios[0].api.put(path, scores(*same(5))), 403, "forbidden")
    saved = score(juror, rid, e1, (1, 10, 5, 6))
    assert saved == {"scores": scores(1, 10, 5, 6), "remaining": 1}
    assert (ballot(juror, rid)["scored"], ballot(juror, rid)["remaining"]) == (1, 1)
    refused(juror.api.post(f"/api/rounds/{rid}/ballot/submit", {}), 409, "ballot_incomplete",
            f"Score every entry before submitting. {1} left.")
    score(juror, rid, e2, same(6))
    body = submit_ballot(juror, rid)
    assert (body["submitted"], body["counted"]) == (True, 2)
    refused(juror.api.put(path, scores(*same(9))), 409, "ballot_submitted", "Your ballot is already submitted.")
    view = ballot(juror, rid)
    assert (view["submitted"], view["remaining"]) == (True, 0)
    assert next(e for e in view["entries"] if e["entryId"] == e1)["scores"] == scores(1, 10, 5, 6)
    assert next(p for p in desk.panel(rid) if p["jurorId"] == juror.id)["ballotSubmitted"] is True
    desk.close(rid)
    closed = "This round closed before your ballot arrived. It was not counted."
    refused(late.api.put(path, scores(*same(5))), 409, "round_closed")
    refused(late.api.post(f"/api/rounds/{rid}/entries/{e1}/recuse", {}), 409, "round_closed")
    late_submit = refused(late.api.post(f"/api/rounds/{rid}/ballot/submit", {}), 409)
    assert late_submit.get("error") in ("round_closed", "ballot_incomplete"), late_submit
    if late_submit.get("error") == "round_closed":
        assert late_submit.get("message") == closed, late_submit


def test_ballot_close_race(app_url: str) -> None:
    desk = Desk(app_url)
    studios = [desk.studio(), desk.studio()]
    juror = desk.juror()
    ctx = open_round_one(desk, studios, [juror])
    rid = ctx["rounds"]["round_1"]
    for e, level in zip(ctx["entries"], (8, 4)):
        score(juror, rid, e["id"], same(level))
    barrier = threading.Barrier(2)
    out: dict[str, httpx.Response] = {}

    def run(name: str, fn: Any) -> None:
        barrier.wait()
        out[name] = fn()
    threads = [threading.Thread(target=run, args=("submit", lambda: juror.api.post(f"/api/rounds/{rid}/ballot/submit",
                                                                                  {}))),
               threading.Thread(target=run, args=("close", lambda: desk.director.post(f"/api/rounds/{rid}/close",
                                                                                     {})))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert out["close"].status_code == 200, out["close"].text
    rows = desk.standings(rid)["rows"]
    assert rows == out["close"].json()["standings"]["rows"]
    counted = [r["ballotsCounted"] for r in rows]
    if out["submit"].status_code == 200:
        assert counted == [1, 1] and all(r["score"] is not None for r in rows)
    else:
        refused(out["submit"], 409, "round_closed")
        assert counted == [0, 0] and all(r["score"] is None for r in rows)
        assert ballot(juror, rid)["submitted"] is False


def test_normalised_round_score(app_url: str) -> None:
    desk = Desk(app_url)
    solo = desk.juror()
    single = open_round_one(desk, [desk.studio() for _ in range(3)], [solo])
    rid = single["rounds"]["round_1"]
    for e, level in zip(single["entries"], (8, 6, 4)):
        score(solo, rid, e["id"], same(level))
    submit_ballot(solo, rid)
    stored = {r["entryId"]: r["score"] for r in desk.close(rid)["standings"]["rows"]}
    assert [stored[e["id"]] for e in single["entries"]] == ["6.84", "5.00", "3.16"]

    studios = [desk.studio() for _ in range(3)]
    jurors = [desk.juror() for _ in range(TRIM_AT)]
    ctx = open_round_one(desk, studios, jurors)
    rid = ctx["rounds"]["round_1"]
    ids = [e["id"] for e in ctx["entries"]]
    table = [
        [(9, 9, 9, 9), (5, 5, 5, 5), (1, 1, 1, 1)],
        [(2, 2, 2, 2), (8, 8, 8, 8), (5, 5, 5, 5)],
        [(7, 6, 8, 5), (6, 7, 5, 8), (4, 4, 4, 4)],
        [(6, 6, 6, 6), (6, 6, 6, 6), (3, 9, 2, 7)],
        [(10, 8, 9, 7), (3, 4, 2, 6), (6, 5, 7, 4)],
    ]
    ballots = []
    for juror, row in zip(jurors, table):
        mine = dict(zip(ids, row))
        for eid, s in mine.items():
            score(juror, rid, eid, s)
        submit_ballot(juror, rid)
        ballots.append(mine)
    expected = round_scores(ballots)
    rows = {r["entryId"]: r for r in desk.close(rid)["standings"]["rows"]}
    for eid in ids:
        assert rows[eid]["score"] == expected[eid], (eid, rows[eid], expected[eid])
        idea = sum(Decimal(b[eid][2]) for b in ballots) / len(ballots)
        assert Decimal(str(rows[eid]["ideaMean"])) == idea.quantize(IDEA_QUANTUM)
    ok(jurors[0].api.post("/api/conflicts", {"studioId": studios[0].id}), 201)
    after = {r["entryId"]: r["score"] for r in desk.standings(rid)["rows"]}
    assert after == {eid: expected[eid] for eid in ids}


def test_ranking_and_cut(app_url: str) -> None:
    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program, 1, 1)
    rounds = round_ids(category)
    studio = desk.studio()
    late = desk.draft(studio, category)
    early = desk.draft(studio, category)
    ideas = desk.draft(studio, category)
    for e in (early, late, ideas):
        ok(pay(studio.api, e["id"]), 201)
    desk.close_entries(program)
    for e in (early, late, ideas):
        desk.screen(e["id"])
    juror = desk.juror()
    desk.add_panel(rounds["round_1"], juror)
    desk.open(rounds["round_1"])
    assert desk.standings(rounds["final"])["rows"] == []
    rid = rounds["round_1"]
    score(juror, rid, early["id"], (6, 6, 6, 6))
    score(juror, rid, late["id"], (6, 6, 6, 6))
    score(juror, rid, ideas["id"], (6, 6, 8, 1))
    before = desk.standings(rid)
    assert before["provisional"] is True
    assert all(r["score"] is None and r["ballotsCounted"] == 0 for r in before["rows"])
    submit_ballot(juror, rid)
    provisional = desk.standings(rid)
    assert provisional["provisional"] is True and provisional["cutLabel"] == "Shortlist cut"
    order = [ideas["id"], early["id"], late["id"]]
    assert [r["entryId"] for r in provisional["rows"]] == order
    assert [r["rank"] for r in provisional["rows"]] == [1, 2, 3]
    assert [r["cut"] for r in provisional["rows"]] == ["above", "below", "below"]
    assert all(set(r) == STANDING_ROW_KEYS and r["score"] == "5.00" for r in provisional["rows"])
    assert [r["ideaMean"] for r in provisional["rows"]] == [8, 6, 6]
    stored = desk.close(rid)["standings"]
    assert stored["provisional"] is False
    assert [r["entryId"] for r in stored["rows"]] == order


def test_confirm_standings(app_url: str) -> None:
    desk = Desk(app_url)
    done = finished_category(desk)
    ids = [e["id"] for e in done.entries]
    numbers = {e["id"]: e["entryNumber"] for e in done.entries}
    assert sorted((o["entryNumber"], o["state"]) for o in done.r1_outcomes) == sorted(
        [(numbers[ids[0]], "shortlisted"), (numbers[ids[1]], "shortlisted"), (numbers[ids[2]], "shortlisted"),
         (numbers[ids[3]], "eliminated")])
    assert sorted((o["entryNumber"], o["state"]) for o in done.final_outcomes) == sorted(
        [(numbers[ids[1]], "winner"), (numbers[ids[0]], "finalist"), (numbers[ids[2]], "honourable_mention")])
    expected = {ids[1]: "winner", ids[0]: "finalist", ids[2]: "honourable_mention", ids[3]: "eliminated"}
    assert {eid: desk.state(eid) for eid in ids} == expected
    final = desk.standings(done.rounds["final"])
    assert final["cutLabel"] == "Finalist cut"
    assert [(r["entryId"], r["award"], r["cut"]) for r in final["rows"]] == [
        (ids[1], "winner", "above"), (ids[0], "finalist", "above"), (ids[2], "honourable_mention", "below")]


def test_embargoed_publishing(app_url: str, mail: Any) -> None:
    desk = Desk(app_url)
    done = finished_category(desk)
    winner_entry, eliminated = done.entries[1], done.entries[3]
    winner_studio = done.studios[1]
    embargo = server_now(desk.director) + timedelta(seconds=EMBARGO_LEAD_S)
    zone = "Europe/Lisbon"
    published = desk.publish(done.category, embargo.astimezone(ZoneInfo(zone)).isoformat(timespec="seconds"))
    assert published["state"] == "published"
    assert published["embargoLabel"] == embargo_label(zone, embargo)
    board = board_category(app_url, done.program["id"], done.category["id"])
    assert (board["state"], board["rows"], board["revealsLabel"]) == ("embargoed", [], embargo_label(zone, embargo))
    assert datetime.fromisoformat(board["revealsAt"].replace("Z", UTC_SUFFIX)) == embargo
    assert ok(gallery(app_url, category=done.category["name"]), 200)["items"] == []
    image_url = winner_entry["assets"][0]["url"]
    assert httpx.get(f"{app_url}{image_url}", timeout=HTTP_TIMEOUT_S).status_code == 404
    masked = ok(winner_studio.api.get(f"/api/entries/{winner_entry['id']}"), 200)["entry"]
    assert (masked["state"], masked["statusLabel"], masked["award"], masked["score"]) == (
        "final_round", "Final round", None, None)
    out = ok(done.studios[3].api.get(f"/api/entries/{eliminated['id']}"), 200)["entry"]
    assert (out["statusLabel"], out["score"]) == ("Not shortlisted", None)
    subject = f"Cutline results: {done.category['name']} {PROGRAM_YEAR}"
    assert inbox(mail, winner_studio.email, subject, seconds=0) == []

    deadline = monotonic() + REVEAL_WAIT_S
    while board["state"] != "revealed" and monotonic() < deadline:
        board = board_category(app_url, done.program["id"], done.category["id"])
    assert board["state"] == "revealed" and board["rows"], board
    seen = ok(winner_studio.api.get(f"/api/entries/{winner_entry['id']}"), 200)["entry"]
    assert (seen["state"], seen["award"], seen["score"]) == ("published", "winner",
                                                             done.final_scores[winner_entry["id"]])
    out = ok(done.studios[3].api.get(f"/api/entries/{eliminated['id']}"), 200)["entry"]
    assert out["score"] == done.r1_scores[eliminated["id"]]
    items = ok(gallery(app_url, category=done.category["name"]), 200)["items"]
    assert [i["title"] for i in items] == [done.entries[1]["title"], done.entries[0]["title"], done.entries[2]["title"]]
    assert httpx.get(f"{app_url}{image_url}", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_results_email(app_url: str, mail: Any) -> None:
    desk = Desk(app_url)
    done = finished_category(desk)
    desk.publish(done.category, PAST_EMBARGO)
    subject = f"Cutline results: {done.category['name']} {PROGRAM_YEAR}"
    outcomes = {done.entries[1]["id"]: ("Winner", done.final_scores),
                done.entries[0]["id"]: ("Finalist", done.final_scores),
                done.entries[2]["id"]: ("Honourable mention", done.final_scores),
                done.entries[3]["id"]: ("Not shortlisted", done.r1_scores)}
    for studio, entry in zip(done.studios, done.entries):
        found = inbox(mail, studio.email, subject)
        assert len(found) == 1, (studio.email, len(found))
        assert len(inbox(mail, studio.email, subject, expected=2, seconds=MAIL_POLL_S)) == 1
        body = text(found[0])
        label, table = outcomes[entry["id"]]
        assert f"Entry {entry['entryNumber']} — {entry['title']}: {label} ({table[entry['id']]})" in body
        others = [e for e in done.entries if e["id"] != entry["id"]]
        for leak in [e["title"] for e in others] + [s.name for s in done.studios if s is not studio] + [
                s.email for s in done.studios if s is not studio] + [done.juror.name, done.juror.email,
                                                                     studio.contact, entry["credits"], SITE_URL]:
            assert leak not in body, leak
    assert inbox(mail, done.bystander.email, subject, seconds=MAIL_POLL_S) == []


def test_public_gallery_leaderboard(app_url: str) -> None:
    resp = gallery(app_url, year=2024)
    items = ok(resp, 200)["items"]
    assert [(i["title"], i["award"], i["score"]) for i in items] == [
        ("Quiet Machines", "winner", "8.05"), ("Saltmarsh Almanac", "finalist", "7.12"),
        ("Index of Rooms", "honourable_mention", "6.40")]
    assert all(set(i) == GALLERY_KEYS for i in items)
    assert items[0]["studioName"] == "Mono Harbour" and items[0]["programName"] == "Cutline Annual 2024"
    image = httpx.get(f"{app_url}{items[0]['images'][0]}", timeout=HTTP_TIMEOUT_S)
    assert image.status_code == 200 and image.headers["content-type"].split(";")[0] in ("image/png", "image/jpeg")
    portfolio = ok(gallery(app_url, year=2025, category=SEED_CATEGORY.lower()), 200)["items"]
    assert [i["title"] for i in portfolio] == ["Tidewater Archive", "Glasshouse Index", "Northbound Letters",
                                               "Small Hours Press"]
    winners = ok(gallery(app_url, year=2025, award="winner"), 200)["items"]
    assert [(i["category"], i["title"]) for i in winners] == [("Editorial", "Paper Weather"),
                                                              ("Portfolio", "Tidewater Archive")]
    assert gallery(app_url, award=BAD_AWARD).status_code == 422

    board = seeded_board(app_url)
    assert board["program"]["name"] == SEED_PROGRAM
    assert set(board["program"]) == {"id", "name", "year", "timeZone"}
    cat = next(c for c in board["categories"] if c["name"] == "Portfolio")
    assert set(cat) == LEADER_CATEGORY_KEYS and cat["state"] == "revealed" and cat["cut"] == 2
    assert all(set(r) == LEADER_ROW_KEYS for r in cat["rows"])
    assert [(r["entryNumber"], r["rank"], r["score"], r["previousRank"], r["previousScore"], r["award"])
            for r in cat["rows"]] == [(3, 1, "8.42", 2, "7.10", "winner"), (7, 2, "7.91", 1, "7.65", "finalist"),
                                      (12, 3, "6.88", 3, "6.48", "honourable_mention"),
                                      (11, 4, "6.05", 4, "6.20", "honourable_mention")]
    blob = json.dumps(board) + json.dumps(items) + json.dumps(portfolio)
    for leak in ("studio@halftone.example", "hello@fieldnote.example", "team@parallaxpine.example",
                 "desk@monoharbour.example", "Dario Feld", "Leni Marsh", "Ayo Mensah", "Kit Okonkwo",
                 "ideaMean", "ballotsCounted", "Ines Varga"):
        assert leak not in blob, leak


def test_counts_agree_with_rows(app_url: str) -> None:
    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program)
    studio, rival = desk.studio(), desk.studio()
    desk.draft(studio, category)
    withdrawn = desk.submitted(studio, category)
    ok(studio.api.post(f"/api/entries/{withdrawn['id']}/withdraw", {}), 200)
    kept, flagged = desk.submitted(studio, category), desk.submitted(rival, category)
    desk.close_entries(program)
    desk.screen(kept["id"])
    desk.screen(flagged["id"])

    def counts() -> dict:
        summary = ok(desk.director.get(f"/api/programs/{program['id']}/summary"), 200)
        return next(c for c in summary["categories"] if c["id"] == category["id"])["counts"]
    expected = {s: 0 for s in ENTRY_STATES} | {"draft": 1, "withdrawn": 1, "screened": 2}
    assert counts() == expected
    ok(desk.director.post(f"/api/entries/{flagged['id']}/screen", {"decision": "disqualify",
                                                                   "reason": unique("Reason")[0]}), 200)
    assert counts() == expected | {"screened": 1, "disqualified": 1}
    j1, j2 = desk.juror(), desk.juror()
    rid = round_ids(category)["round_1"]
    desk.add_panel(rid, j1)
    desk.add_panel(rid, j2)
    desk.open(rid)
    assert counts() == expected | {"screened": 0, "disqualified": 1, "round_1": 1}
    score(j1, rid, kept["id"], same(7))
    ok(j2.api.post("/api/conflicts", {"studioId": studio.id}), 201)
    for j in (j1, j2):
        row = next(p for p in desk.panel(rid) if p["jurorId"] == j.id)
        view = ballot(j, rid)
        assert (row["assigned"], row["scored"], row["remaining"]) == (view["assigned"], view["scored"],
                                                                      view["remaining"])
    assert next(p for p in desk.panel(rid) if p["jurorId"] == j2.id)["assigned"] == 0

    done = finished_category(desk)
    desk.publish(done.category, PAST_EMBARGO)
    board = board_category(app_url, done.program["id"], done.category["id"])
    final = desk.standings(done.rounds["final"])["rows"]
    assert [(r["entryNumber"], r["rank"], r["score"]) for r in board["rows"]] == [
        (r["entryNumber"], r["rank"], r["score"]) for r in final]
    r1 = [r for r in desk.standings(done.rounds["round_1"])["rows"] if r["cut"] == "above"]
    previous = {r["entryNumber"]: i + 1 for i, r in enumerate(r1)}
    assert {r["entryNumber"]: r["previousRank"] for r in board["rows"]} == previous


def test_audit_trail(app_url: str) -> None:
    desk = Desk(app_url)
    program = desk.program()
    targets = [("program.create", program["id"])]
    ok(desk.director.patch(f"/api/programs/{program['id']}", {"deadlineDate": OPEN_DEADLINE}), 200)
    targets.append(("program.update", program["id"]))
    assert refused(desk.director.patch(f"/api/programs/{program['id']}", {"earlyBirdDate": LATE_DATE}), 422)["errors"]
    category = desk.category(program, 1, 1)
    targets.append(("category.create", category["id"]))
    rounds = round_ids(category)
    juror = desk.juror()
    targets.append(("juror.create", juror.id))
    studio = desk.studio()
    entry = desk.submitted(studio, category)
    desk.close_entries(program)
    targets.append(("program.update", program["id"]))
    ok(desk.director.post(f"/api/entries/{entry['id']}/screen", {"decision": "disqualify",
                                                                 "reason": unique("Reason")[0]}), 200)
    targets.append(("entry.disqualify", entry["id"]))
    ok(desk.director.post(f"/api/entries/{entry['id']}/reinstate", {}), 200)
    targets.append(("entry.reinstate", entry["id"]))
    refused(desk.director.post(f"/api/entries/{entry['id']}/screen", {"decision": "pass"}), 409, "invalid_transition")
    desk.add_panel(rounds["round_1"], juror)
    targets.append(("panel.add", {rounds["round_1"], juror.id}))
    desk.open(rounds["round_1"])
    targets.append(("round.open", rounds["round_1"]))
    score(juror, rounds["round_1"], entry["id"], same(6))
    submit_ballot(juror, rounds["round_1"])
    desk.close(rounds["round_1"])
    targets.append(("round.close", rounds["round_1"]))
    desk.confirm(rounds["round_1"])
    targets.append(("round.confirm", rounds["round_1"]))
    desk.add_panel(rounds["final"], juror)
    targets.append(("panel.add", {rounds["final"], juror.id}))
    desk.open(rounds["final"])
    targets.append(("round.open", rounds["final"]))
    score(juror, rounds["final"], entry["id"], same(6))
    submit_ballot(juror, rounds["final"])
    desk.close(rounds["final"])
    targets.append(("round.close", rounds["final"]))
    desk.confirm(rounds["final"])
    targets.append(("round.confirm", rounds["final"]))
    for caller in (studio.api, juror.api):
        refused(caller.post(f"/api/categories/{category['id']}/publish", {"embargoAt": PAST_EMBARGO}), 403,
                "forbidden")
    desk.publish(category, PAST_EMBARGO)
    targets.append(("category.publish", category["id"]))
    mine = {program["id"], category["id"], juror.id, entry["id"], *rounds.values()}
    events = [e for e in ok(desk.director.get("/api/audit"), 200)["events"] if e["targetId"] in mine]
    expected = list(reversed(targets))
    assert [e["action"] for e in events] == [action for action, _ in expected], events
    for event, (_, allowed) in zip(events, expected):
        assert event["targetId"] in ({allowed} if isinstance(allowed, str) else allowed), event
    instants = [datetime.fromisoformat(e["at"].replace("Z", UTC_SUFFIX)) for e in events]
    assert instants == sorted(instants, reverse=True), [e["at"] for e in events]
    types = {"program.create": "program", "category.create": "category", "juror.create": "juror",
             "entry.disqualify": "entry", "category.publish": "category"}
    assert all(e["targetType"] == types[e["action"]] for e in events if e["action"] in types)
    entry_test = [e for e in events if e["targetId"] == entry["id"]]
    assert [e["action"] for e in entry_test] == ["entry.reinstate", "entry.disqualify"]
    pass_program = desk.program()
    pass_cat = desk.category(pass_program)
    other = desk.submitted(studio, pass_cat)
    desk.close_entries(pass_program)
    desk.screen(other["id"])
    assert [e["action"] for e in ok(desk.director.get("/api/audit"), 200)["events"]
            if e["targetId"] == other["id"]] == ["entry.pass"]


def test_jury_packet_and_invitations(app_url: str, s3: S3, mail: Any) -> None:
    desk = Desk(app_url)
    studios = [desk.studio(), desk.studio()]
    homed = desk.juror(studios[0].id)
    free = desk.juror()
    ctx = open_round_one(desk, studios, [homed, free])
    rid, name = ctx["rounds"]["round_1"], ctx["category"]["name"]
    packet = json.loads(s3.get(f"rounds/{rid}/jury-packet.json"))
    assert set(packet) == PACKET_KEYS
    assert (packet["roundId"], packet["roundName"], packet["categoryName"]) == (rid, "Round 1", name)
    assert packet["ballotDeadlineLabel"] == ctx["round"]["ballotDeadlineLabel"]
    assert all(set(e) == PACKET_ENTRY_KEYS for e in packet["entries"])
    assert sorted((e["entryNumber"], tuple(e["assetIds"])) for e in packet["entries"]) == sorted(
        (e["entryNumber"], tuple(a["id"] for a in e["assets"])) for e in ctx["entries"])
    subject = f"Cutline jury invitation: {name} — {ROUND_ONE}"
    late = desk.juror()
    desk.add_panel(rid, late)
    for juror, k in ((homed, 1), (free, 2), (late, 2)):
        found = inbox(mail, juror.email, subject)
        assert len(found) == 1, juror.email
        body = text(found[0])
        assert ctx["round"]["ballotDeadlineLabel"] in body and f"{k} entries assigned" in body and "/jury" in body
        assert all(s.name not in body for s in studios)


def test_cut_shuffle_replay(browser: Browser, app_url: str) -> None:
    board = seeded_board(app_url)
    cat = next(c for c in board["categories"] if c["name"] == "Portfolio")
    summary = shuffle_summary([(r["entryNumber"], r["previousRank"], r["rank"]) for r in cat["rows"]], cat["cut"])
    shuffle_max = ROLL_MS + TRAVEL_MS + STAGGER_MS * (len(cat["rows"]) - 1)
    with open_app(browser, f"{app_url}/") as page:
        page.clock.resume()
        pick_seed_program(page)
        table = page.get_by_role("table", name=f"{SEED_CATEGORY} standings")
        winner = table.get_by_role("row").filter(has_text="Tidewater Archive")
        runner = table.get_by_role("row").filter(has_text="Glasshouse Index")
        status = page.get_by_role("status", name="Standings updates")
        expect(winner).to_contain_text("8.42")
        assert winner.bounding_box()["y"] < runner.bounding_box()["y"]

        def sample() -> tuple[float, float, float, str]:
            t, w, r, said = page.evaluate(ROW_SAMPLE_JS, [winner.element_handle(), runner.element_handle(),
                                                          status.element_handle()])
            return t, w, r, said

        clicked_at = page.evaluate("document.timeline.currentTime")
        click(page.get_by_role("button", name=f"Replay reveal for {SEED_CATEGORY}"))
        samples: list[tuple[float, float, float]] = []
        announced = None
        deadline = monotonic() + REAL_SAMPLE_S
        while monotonic() < deadline:
            t, w, r, said = sample()
            samples.append((t - clicked_at, w, r))
            if said == summary:
                announced = samples[-1]
                break
        assert announced is not None, ("summary never announced", samples)
        started = [s for s in samples if s[1] > s[2]]
        assert started, ("reveal must start in shortlist order", samples)
        start = started[0][1:]
        final = announced[1:]
        assert final[0] < final[1], "rows must end in the final ranking"

        def between(y: float, a: float, b: float) -> bool:
            return min(a, b) + POSITION_TOLERANCE_PX < y < max(a, b) - POSITION_TOLERANCE_PX
        travelled = [s for s in samples if between(s[1], start[0], final[0]) or between(s[2], start[1], final[1])]
        assert travelled, ("rows must travel through intermediate positions before the summary", start, final, samples)
        motion = next((s[0] for s in samples if abs(s[1] - start[0]) > POSITION_TOLERANCE_PX
                       or abs(s[2] - start[1]) > POSITION_TOLERANCE_PX), samples[0][0])
        settled_at = next(s[0] for i, s in enumerate(samples)
                          if all(abs(t[1] - final[0]) <= POSITION_TOLERANCE_PX
                                 and abs(t[2] - final[1]) <= POSITION_TOLERANCE_PX for t in samples[i:]))
        assert settled_at - motion <= shuffle_max + SHUFFLE_TOLERANCE_MS, (settled_at, motion, samples)
        _, w_after, r_after, _ = sample()
        assert abs(w_after - final[0]) <= POSITION_TOLERANCE_PX and abs(r_after - final[1]) <= POSITION_TOLERANCE_PX, (
            "summary must be announced only after every row settled", (w_after, r_after), final)
        expect(winner).to_contain_text("8.42")


def test_reduced_motion_standings(browser: Browser, app_url: str) -> None:
    board = seeded_board(app_url)
    cat = next(c for c in board["categories"] if c["name"] == "Portfolio")
    summary = shuffle_summary([(r["entryNumber"], r["previousRank"], r["rank"]) for r in cat["rows"]], cat["cut"])
    won = next(r for r in cat["rows"] if r["title"] == "Tidewater Archive")
    ran = next(r for r in cat["rows"] if r["title"] == "Glasshouse Index")
    rise, fall = won["previousRank"] - won["rank"], ran["rank"] - ran["previousRank"]
    with open_app(browser, f"{app_url}/", reduced_motion="reduce") as page:
        pick_seed_program(page)
        region = page.get_by_role("region", name=SEED_CATEGORY)
        table = page.get_by_role("table", name=f"{SEED_CATEGORY} standings")
        click(page.get_by_role("button", name=f"Replay reveal for {SEED_CATEGORY}"))
        page.clock.run_for(SAMPLE_MS)
        assert region.evaluate(RUNNING_COUNT_JS) == 0
        winner = table.get_by_role("row").filter(has_text="Tidewater Archive")
        runner = table.get_by_role("row").filter(has_text="Glasshouse Index")
        assert winner.bounding_box()["y"] < runner.bounding_box()["y"]
        expect(winner).to_contain_text(f"up {rise}")
        expect(runner).to_contain_text(f"down {fall}")
        expect(table.get_by_role("row").filter(has_text="Northbound Letters")).not_to_contain_text("up")
        page.clock.run_for(SETTLE_MS)
        expect(page.get_by_role("status", name="Standings updates")).to_have_text(summary)


def test_status_glyph_and_label(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}/") as page:
        pick_seed_program(page)
        table = page.get_by_role("table", name=f"{SEED_CATEGORY} standings")
        region = page.get_by_role("region", name=SEED_CATEGORY, exact=True)
        expect(region.get_by_role("separator", name="Finalist cut")).to_be_attached()
        for title, labels in [("Tidewater Archive", ("Above cut", "Winner")),
                              ("Glasshouse Index", ("Above cut", "Finalist")),
                              ("Northbound Letters", ("Below cut", "Honourable mention"))]:
            row = table.get_by_role("row").filter(has_text=title)
            for label in labels:
                expect(row).to_contain_text(label)
        axe_contrast(page)


def test_responsive_layout(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    studio = desk.studio()
    for width, height in VIEWPORTS:
        with signed_in(browser, app_url, "/studio", studio.email, PASSWORD) as page:
            page.set_viewport_size({"width": width, "height": height})
            for path in ("/studio", "/", "/gallery", "/jury/conflicts"):
                page.goto(f"{app_url}{path}")
                expect(page.get_by_role("banner")).to_be_visible()
                layout(page)
                controls = page.get_by_role("navigation", name="Primary").get_by_role("link").all()
                controls += page.get_by_role("button").all() + page.get_by_role("combobox").all()
                for control in controls:
                    if control.is_visible():
                        assert control.bounding_box()["height"] >= TAP_MIN, (path, width, control)
        with open_app(browser, f"{app_url}/signup") as page:
            page.set_viewport_size({"width": width, "height": height})
            for path in ("/signup", "/signin"):
                page.goto(f"{app_url}{path}")
                layout(page)


def test_keyboard_and_focus(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}/") as page:
        names = tab_order(page, 12)
        assert names[0] == "Skip to content"
        nav = {n for n in names[1:] if n in ("Leaderboard", "Gallery", "Studio", "Jury", "Director")}
        assert nav == {"Leaderboard", "Gallery", "Studio", "Jury", "Director"}
        assert "Sign in" in names[1:]
        link = page.get_by_role("navigation", name="Primary").get_by_role("link", name="Gallery")
        rest, focused = state_styles(link, *FOCUS_PROPS, state="focus")
        ring = link.evaluate(
            "(el, props) => {"
            " const read = n => props.flatMap(p => ['::before', '::after']"
            ".map(q => getComputedStyle(n, q).getPropertyValue(p)))"
            ".concat(el.parentElement ? props.map(p => getComputedStyle(el.parentElement).getPropertyValue(p)) : [])"
            ".join('|');"
            " el.blur(); const before = read(el); el.focus(); return read(el) !== before; }",
            list(FOCUS_PROPS))
        assert rest != focused or ring
    desk = Desk(app_url)
    studio = desk.studio()
    entry = desk.draft(studio, desk.category(desk.program()), images=0)
    with signed_in(browser, app_url, f"/studio/entries/{entry['id']}", studio.email, PASSWORD) as page:
        opener = page.get_by_role("button", name="Delete draft")
        opener.focus()
        page.keyboard.press("Enter")
        page.clock.run_for(SETTLE_MS)
        dialog = page.get_by_role("dialog", name="Delete this draft?")
        expect(dialog).to_contain_text("This removes the entry and its images.")
        expect(dialog.get_by_role("button", name="Keep draft")).to_be_focused()
        for key in ("Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), ("focus left the dialog", key)
        page.keyboard.press("Escape")
        page.clock.run_for(SETTLE_MS)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
    assert ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]["state"] == "draft"


def test_health_and_boundary(browser: Browser, app_url: str) -> None:
    assert ok(httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S), 200) == {"status": "ok"}
    for path in NEVER_SERVED:
        body = httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT_S).text
        assert all(leak not in body for leak in SERVED_LEAKS), path
        for var in ("DATABASE_URL", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY"):
            secret = os.environ.get(var)
            if secret and len(secret) >= 12:
                assert secret not in body, (path, var)
    refused(httpx.get(f"{app_url}/api/{UNKNOWN_ID}", timeout=HTTP_TIMEOUT_S), 404, "not_found")
    desk = Desk(app_url)
    studio = desk.studio()
    entry = desk.draft(studio, desk.category(desk.program()), images=0)
    kept, _ = unique("Entry")
    hijack, _ = unique("Entry")
    resp = studio.api.patch(f"/api/entries/{entry['id']}", {"title": kept})
    assert resp.status_code == 200
    cross = studio.api.http.patch(f"/api/entries/{entry['id']}", json={"title": hijack},
                                  headers={"Origin": CROSS_ORIGIN})
    refused(cross, 403, "forbidden")
    assert CORS_HEADER not in {k.lower() for k in cross.headers}
    assert ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]["title"] == kept
    try:
        refused(upload(studio.api, entry["id"], b"\x00" * (MULTIPART_LIMIT + 1)), 413, "file_too_large")
    except httpx.HTTPError:
        pass
    refused(studio.api.http.patch(f"/api/entries/{entry['id']}", content=FORM_BODY,
                                  headers={"Content-Type": PLAIN_TYPE}), 415, "unsupported_media_type")
    with open_app(browser, f"{app_url}/") as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        page.reload()
        page.goto(f"{app_url}/gallery")
        expect(page.get_by_role("list", name="Winners")).to_be_visible()
        foreign = [u for u in urls if not u.startswith(DATA_SCHEME) and not same_origin(u, app_url)]
        assert foreign == []


def test_wf_entry_drafts_happy(browser: Browser, app_url: str, s3: S3) -> None:
    name, email = unique("Studio")
    contact, _ = unique("Contact")
    title, _ = unique("Entry")
    with open_app(browser, f"{app_url}/signup") as page:
        fill(page.get_by_role("textbox", name="Studio name"), name)
        fill(page.get_by_role("textbox", name="Contact name"), contact)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Create studio account"))
        expect(desk_status(page)).to_contain_text("Studio account created.", timeout=UI_WAIT_MS)
        page.goto(f"{app_url}/studio/entries/new")
        category_field = page.get_by_role("combobox", name="Category")
        offered = category_field.evaluate(
            "e => e.options ? [...e.options].filter(o => o.value).map(o => (o.label || o.text || '').trim()).filter(Boolean) : []")
        select(category_field, offered[0] if offered else "Portfolio")
        fill(page.get_by_role("textbox", name="Title"), title)
        fill(page.get_by_role("textbox", name="Case study"), f"Case study for {title}")
        fill(page.get_by_role("textbox", name="Site address"), SITE_URL)
        fill(page.get_by_role("textbox", name="Credits"), unique("Credits")[0])
        click(page.get_by_role("button", name="Save draft"))
        expect(desk_status(page)).to_contain_text("Draft saved.", timeout=UI_WAIT_MS)
        page.get_by_label("Add case-study images").set_input_files(
            files=[image_file(UPLOAD_NAME, png(MIN_SIDE, MIN_SIDE))])
        expect(desk_status(page)).to_contain_text(f"{UPLOAD_NAME} added, {MIN_SIDE} × {MIN_SIDE} pixels.",
                                                  timeout=UI_WAIT_MS)
        images = page.get_by_role("list", name="Case-study images")
        k = 1
        expect(images.get_by_role("img", name=f"{title} — image {k}")).to_be_visible()
        expect(images.get_by_role("button", name=f"Remove image {k}")).to_be_visible()
    api = sign_in(app_url, email, PASSWORD)
    entry = next(e for e in ok(api.get("/api/entries"), 200)["entries"] if e["title"] == title)
    assert entry["state"] == "draft" and len(entry["assets"]) == 1
    assert s3.keys(f"entries/{entry['id']}/") == [f"entries/{entry['id']}/{entry['assets'][0]['id']}.png"]


def test_wf_entry_drafts_reject_and_delete(browser: Browser, app_url: str, s3: S3) -> None:
    desk = Desk(app_url)
    studio = desk.studio()
    entry = desk.draft(studio, desk.category(desk.program()), images=1)
    prefix = f"entries/{entry['id']}/"
    with signed_in(browser, app_url, f"/studio/entries/{entry['id']}", studio.email, PASSWORD) as page:
        page.get_by_label("Add case-study images").set_input_files(files=[image_file(GIF_NAME, GIF_BYTES)])
        expect(desk_error(page)).to_contain_text(COPY_TYPE, timeout=UI_WAIT_MS)
        assert len(s3.keys(prefix)) == 1
        click(page.get_by_role("button", name="Delete draft"))
        dialog = page.get_by_role("dialog", name="Delete this draft?")
        click(dialog.get_by_role("button", name="Delete draft"))
        expect(desk_status(page)).to_contain_text("Draft deleted.", timeout=UI_WAIT_MS)
    refused(studio.api.get(f"/api/entries/{entry['id']}"), 404, "not_found")
    assert s3.keys(prefix) == []


def test_wf_entry_payment_happy(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    desk = Desk(app_url)
    program = desk.program(zone="Asia/Kolkata")
    studio = desk.studio()
    entry = desk.draft(studio, desk.category(program))
    fee = dollars(EARLY_FEE)
    with open_app(browser, f"{app_url}/studio/entries/{entry['id']}") as page:
        expect(page).to_have_url(re.compile(r"/signin"))
        ui_sign_in(page, studio.email, PASSWORD)
        expect(page).to_have_url(re.compile(rf"/studio/entries/{entry['id']}"), timeout=UI_WAIT_MS)
        region = page.get_by_role("region", name="Fee")
        expect(region).to_contain_text(f"Entry fee ${fee} (Early-bird)")
        expect(region).to_contain_text(f"Early-bird ends {program['earlyBirdLabel']}")
        expect(region).to_contain_text(f"Entries close {program['deadlineLabel']}")
        click(page.get_by_role("button", name=f"Pay ${fee} and submit"))
        expect(page.get_by_text(status_line("Submitted"))).to_be_visible(timeout=UI_WAIT_MS)
        expect(desk_status(page)).to_contain_text(
            f"Entry {entry['entryNumber']} submitted. Receipt sent to {studio.email}.")
        receipt = ok(studio.api.get(f"/api/entries/{entry['id']}/receipt"), 200)["receipt"]
        expect(page.get_by_role("region", name="Receipt")).to_contain_text(receipt["invoiceId"])
        page.goto(f"{app_url}/studio")
        expect(page.get_by_role("table", name="Your entries").get_by_role("link", name=entry["title"])).to_be_visible()
    [purchase] = successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "PURCHASE")
    assert cents_of(purchase) == EARLY_FEE
    assert len(inbox(mail, studio.email, receipt_subject(entry))) == 1


def test_wf_entry_payment_standard_tier(browser: Browser, app_url: str, killbill: Any) -> None:
    desk = Desk(app_url)
    program = desk.program(zone="Asia/Kolkata", early=PAST_EARLY)
    studio = desk.studio()
    entry = desk.draft(studio, desk.category(program))
    fee = dollars(STANDARD_FEE)
    with signed_in(browser, app_url, f"/studio/entries/{entry['id']}", studio.email, PASSWORD) as page:
        region = page.get_by_role("region", name="Fee")
        expect(region).to_contain_text(f"Entry fee ${fee} (Standard)")
        expect(region).to_contain_text(f"Early-bird ended {program['earlyBirdLabel']}")
        click(page.get_by_role("button", name=f"Pay ${fee} and submit"))
        expect(page.get_by_text(status_line("Submitted"))).to_be_visible(timeout=UI_WAIT_MS)
        expect(page.get_by_role("region", name="Receipt")).to_contain_text("Standard")
    [purchase] = successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "PURCHASE")
    assert cents_of(purchase) == STANDARD_FEE


def test_wf_billing_outage_pay_paused(browser: Browser, app_url: str, killbill: Any) -> None:
    down = os.environ[DOWN_URL_ENV].rstrip("/")
    desk = Desk(app_url)
    studio = desk.studio()
    entry = desk.draft(studio, desk.category(desk.program()))
    with signed_in(browser, down, f"/studio/entries/{entry['id']}", studio.email, PASSWORD) as page:
        click(page.get_by_role("button", name=f"Pay ${dollars(EARLY_FEE)} and submit"))
        expect(desk_error(page)).to_contain_text(COPY_PAY_PAUSED, timeout=UI_WAIT_MS)
        expect(page.get_by_text(status_line("Draft"))).to_be_visible()
        expect(page.get_by_role("list", name="Case-study images").get_by_role("img")).to_have_count(1)
    assert ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"] == entry
    assert successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "PURCHASE") == []
    ok(pay(studio.api, entry["id"]), 201)
    assert len(successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "PURCHASE")) == 1


def test_wf_billing_outage_refund_paused(browser: Browser, app_url: str, killbill: Any) -> None:
    down = os.environ[DOWN_URL_ENV].rstrip("/")
    desk = Desk(app_url)
    studio = desk.studio()
    entry = desk.submitted(studio, desk.category(desk.program()))
    with signed_in(browser, down, f"/studio/entries/{entry['id']}", studio.email, PASSWORD) as page:
        click(page.get_by_role("button", name="Withdraw entry"))
        click(page.get_by_role("dialog", name="Withdraw entry?").get_by_role("button", name="Withdraw"))
        expect(desk_error(page)).to_contain_text(COPY_REFUND_PAUSED, timeout=UI_WAIT_MS)
        expect(page.get_by_text(status_line("Submitted"))).to_be_visible()
    assert ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]["state"] == "submitted"
    assert successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "REFUND") == []


def test_wf_withdrawal_refund(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    desk = Desk(app_url)
    studio = desk.studio()
    entry = desk.submitted(studio, desk.category(desk.program()))
    fee = dollars(EARLY_FEE)
    with signed_in(browser, app_url, f"/studio/entries/{entry['id']}", studio.email, PASSWORD) as page:
        click(page.get_by_role("button", name="Withdraw entry"))
        dialog = page.get_by_role("dialog", name="Withdraw entry?")
        expect(dialog).to_contain_text(f"You'll be refunded ${fee}.")
        click(dialog.get_by_role("button", name="Withdraw"))
        expect(desk_status(page)).to_contain_text(
            f"Entry {entry['entryNumber']} withdrawn. Refund of ${fee} recorded.", timeout=UI_WAIT_MS)
        expect(page.get_by_text(status_line("Withdrawn"))).to_be_visible()
        expect(page.get_by_role("region", name="Receipt")).to_contain_text(fee)
    [refund] = successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "REFUND")
    assert cents_of(refund) == EARLY_FEE
    assert len(inbox(mail, studio.email, refund_subject(entry))) == 1


def test_wf_withdrawal_after_deadline(browser: Browser, app_url: str, killbill: Any) -> None:
    desk = Desk(app_url)
    program = desk.program()
    studio = desk.studio()
    entry = desk.submitted(studio, desk.category(program))
    desk.close_entries(program)
    with signed_in(browser, app_url, f"/studio/entries/{entry['id']}", studio.email, PASSWORD) as page:
        click(page.get_by_role("button", name="Withdraw entry"))
        dialog = page.get_by_role("dialog", name="Withdraw entry?")
        expect(dialog).to_contain_text("The deadline has passed, so there is no refund.")
        click(dialog.get_by_role("button", name="Withdraw"))
        expect(desk_status(page)).to_contain_text(
            f"Entry {entry['entryNumber']} withdrawn. No refund after the deadline.", timeout=UI_WAIT_MS)
    assert ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]["state"] == "withdrawn"
    assert successful(killbill.payment_by_key(f"cutline-entry-{entry['id']}"), "REFUND") == []


def test_wf_screening_pass_and_disqualify(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program)
    studio = desk.studio()
    good, bad = desk.submitted(studio, category), desk.submitted(studio, category)
    desk.close_entries(program)
    reason, _ = unique("Reason")
    with signed_in(browser, app_url, f"/director/categories/{category['id']}", DIRECTOR_EMAIL,
                   DIRECTOR_PASSWORD) as page:
        click(page.get_by_role("button", name=f"Pass Entry {good['entryNumber']}"))
        expect(desk_status(page)).to_contain_text(f"Entry {good['entryNumber']} passed screening.", timeout=UI_WAIT_MS)
        click(page.get_by_role("button", name=f"Disqualify Entry {bad['entryNumber']}"))
        dialog = page.get_by_role("dialog", name=f"Disqualify Entry {bad['entryNumber']}")
        fill(dialog.get_by_role("textbox", name="Reason"), reason)
        click(dialog.get_by_role("button", name="Disqualify"))
        expect(desk_status(page)).to_contain_text(f"Entry {bad['entryNumber']} disqualified.", timeout=UI_WAIT_MS)
    assert ok(studio.api.get(f"/api/entries/{good['id']}"), 200)["entry"]["state"] == "screened"
    seen = ok(studio.api.get(f"/api/entries/{bad['id']}"), 200)["entry"]
    assert (seen["state"], seen["disqualifyReason"]) == ("disqualified", reason)


def test_wf_screening_reason_and_reinstate(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program)
    studio = desk.studio()
    entry = desk.submitted(studio, category)
    desk.close_entries(program)
    n = entry["entryNumber"]
    with signed_in(browser, app_url, f"/director/categories/{category['id']}", DIRECTOR_EMAIL,
                   DIRECTOR_PASSWORD) as page:
        click(page.get_by_role("button", name=f"Disqualify Entry {n}"))
        dialog = page.get_by_role("dialog", name=f"Disqualify Entry {n}")
        disqualify = dialog.get_by_role("button", name="Disqualify")
        if disqualify.is_enabled():
            click(disqualify)
            expect(desk_error(page)).to_contain_text(COPY_REASON, timeout=UI_WAIT_MS)
        assert desk.state(entry["id"]) == "submitted"
        fill(dialog.get_by_role("textbox", name="Reason"), unique("Reason")[0])
        click(dialog.get_by_role("button", name="Disqualify"))
        expect(desk_status(page)).to_contain_text(f"Entry {n} disqualified.", timeout=UI_WAIT_MS)
        page.clock.run_for(SETTLE_MS)
        click(page.get_by_role("button", name=f"Reinstate Entry {n}"))
        expect(desk_status(page)).to_contain_text(f"Entry {n} reinstated.", timeout=UI_WAIT_MS)
    assert ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]["statusLabel"] == "Screened"


def test_wf_jury_setup_panel_and_open(browser: Browser, app_url: str, s3: S3, mail: Any) -> None:
    desk = Desk(app_url)
    program = desk.program()
    category = desk.category(program)
    rid = round_ids(category)["round_1"]
    studio = desk.studio()
    entry = desk.submitted(studio, category)
    desk.close_entries(program)
    desk.screen(entry["id"])
    juror = desk.juror()
    with signed_in(browser, app_url, f"/director/rounds/{rid}", DIRECTOR_EMAIL, DIRECTOR_PASSWORD) as page:
        combo = page.get_by_role("combobox", name="Add juror")
        labels = combo.evaluate(
            "e => e.tagName === 'SELECT' ? [...e.options].map(o => (o.label || o.text || '').trim()) : null")
        select(combo, next((l for l in labels if juror.name in l), juror.name) if labels else juror.name)
        click(page.get_by_role("button", name="Add to panel"))
        expect(desk_status(page)).to_contain_text(f"{juror.name} added to the panel with {1} entries.",
                                                  timeout=UI_WAIT_MS)
        expect(page.get_by_role("table", name="Panel").get_by_role("row").filter(has_text=juror.name)).to_be_visible()
        ballot_field = page.get_by_label("Ballot deadline")
        try:
            ballot_field.fill(BALLOT_DATE)
        except Exception:
            ballot_field.focus()
            page.keyboard.type(BALLOT_DATE)
        click(page.get_by_role("button", name="Open round"))
        expect(desk_status(page)).to_contain_text(f"Round opened for {1} jurors.", timeout=UI_WAIT_MS)
    assert ok(desk.director.get(f"/api/rounds/{rid}"), 200)["round"]["state"] == "open"
    assert f"rounds/{rid}/jury-packet.json" in s3.keys(f"rounds/{rid}/")
    assert len(inbox(mail, juror.email, f"Cutline jury invitation: {category['name']} — {ROUND_ONE}")) == 1


def test_wf_jury_setup_conflict(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    rival, other = desk.studio(), desk.studio()
    juror = desk.juror()
    ctx = open_round_one(desk, [rival, other], [juror])
    rid = ctx["rounds"]["round_1"]
    with signed_in(browser, app_url, "/jury/conflicts", juror.email, PASSWORD) as page:
        select(page.get_by_role("combobox", name="Studio"), rival.name)
        fill(page.get_by_role("textbox", name="Note"), "Former client")
        click(page.get_by_role("button", name="Declare conflict"))
        expect(desk_status(page)).to_contain_text(f"Conflict with {rival.name} recorded. {1} assignments removed.",
                                                  timeout=UI_WAIT_MS)
        expect(page.get_by_role("list", name="Declared conflicts")).to_contain_text(rival.name)
    assert [e["entryId"] for e in ballot(juror, rid)["entries"]] == [ctx["entries"][1]["id"]]
    assert next(p for p in desk.panel(rid) if p["jurorId"] == juror.id)["assigned"] == 1


def test_wf_ballot_score_and_submit(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    studios = [desk.studio(), desk.studio()]
    juror = desk.juror()
    ctx = open_round_one(desk, studios, [juror])
    rid, category = ctx["rounds"]["round_1"], ctx["category"]
    entries = sorted(ctx["entries"], key=lambda e: e["entryNumber"])
    with signed_in(browser, app_url, "/jury", juror.email, PASSWORD) as page:
        click(page.get_by_role("link", name=f"{category['name']} — {ROUND_ONE}"))
        for left, entry in zip((1, 0), entries):
            n = entry["entryNumber"]
            article = page.get_by_role("article", name=f"Entry {n}")
            expect(article).to_contain_text(entry["title"])
            for s in studios:
                expect(article).not_to_contain_text(s.name)
            group = article.get_by_role("group", name=f"Scores for Entry {n}")
            for label in ("Craft", "Clarity", "Idea", "Story"):
                spin = group.get_by_role("spinbutton", name=label)
                spin.focus()
                page.keyboard.press("Home")
                for _ in range(7 - 1):
                    page.keyboard.press("ArrowUp")
                expect(spin).to_have_attribute("aria-valuenow", "7") if spin.get_attribute(
                    "aria-valuenow") is not None else expect(spin).to_have_value("7")
            click(article.get_by_role("button", name=f"Save scores for Entry {n}"))
            expect(desk_status(page)).to_contain_text(f"Scores saved for Entry {n}. {left} left to score.",
                                                      timeout=UI_WAIT_MS)
        click(page.get_by_role("button", name="Submit final ballot"))
        dialog = page.get_by_role("dialog", name="Submit final ballot?")
        expect(dialog).to_contain_text("You can't change scores after submitting.")
        click(dialog.get_by_role("button", name="Submit ballot"))
        expect(desk_status(page)).to_contain_text(f"Ballot submitted. {2} entries scored.", timeout=UI_WAIT_MS)
    view = ballot(juror, rid)
    assert view["submitted"] is True
    assert all(e["scores"] == scores(*same(7)) for e in view["entries"])


def test_wf_jury_setup_recuse(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    studios = [desk.studio(), desk.studio()]
    juror = desk.juror()
    ctx = open_round_one(desk, studios, [juror])
    rid = ctx["rounds"]["round_1"]
    target = ctx["entries"][0]
    n = target["entryNumber"]
    with signed_in(browser, app_url, f"/jury/rounds/{rid}", juror.email, PASSWORD) as page:
        click(page.get_by_role("button", name=f"Recuse from Entry {n}"))
        dialog = page.get_by_role("dialog", name=f"Recuse from Entry {n}?")
        expect(dialog).to_contain_text("Your scores for this entry will not count.")
        fill(dialog.get_by_role("textbox", name="Note"), unique("Note")[0])
        click(dialog.get_by_role("button", name="Recuse"))
        expect(desk_status(page)).to_contain_text(f"You've recused from Entry {n}.", timeout=UI_WAIT_MS)
        expect(page.get_by_text(f"{0} of {1} scored")).to_be_visible()
    assert [e["entryId"] for e in ballot(juror, rid)["entries"]] == [ctx["entries"][1]["id"]]
    assert next(p for p in desk.panel(rid) if p["jurorId"] == juror.id)["assigned"] == 1


def test_wf_round_results_close_and_confirm(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    studios = [desk.studio() for _ in range(3)]
    juror = desk.juror()
    ctx = open_round_one(desk, studios, [juror], shortlist=2, finalists=1)
    rid = ctx["rounds"]["round_1"]
    for e, level in zip(ctx["entries"], (9, 6, 3)):
        score(juror, rid, e["id"], same(level))
    submit_ballot(juror, rid)
    with signed_in(browser, app_url, f"/director/rounds/{rid}", DIRECTOR_EMAIL, DIRECTOR_PASSWORD) as page:
        expect(page.get_by_text("Provisional")).to_be_visible()
        table = page.get_by_role("table", name="Standings")
        expect(page.get_by_role("separator", name="Shortlist cut")).to_be_attached()
        click(page.get_by_role("button", name="Close round"))
        dialog = page.get_by_role("dialog", name=f"Close {ROUND_ONE}?")
        click(dialog.get_by_role("button", name="Close round"))
        expect(desk_status(page)).to_contain_text(f"Round closed. Scores stored for {3} entries.", timeout=UI_WAIT_MS)
        page.clock.run_for(SETTLE_MS)
        for e, label in zip(ctx["entries"], ("Above cut", "Above cut", "Below cut")):
            expect(table.get_by_role("row").filter(has_text=e["title"])).to_contain_text(label)
        axe_contrast(page)
        click(page.get_by_role("button", name="Confirm standings"))
        expect(desk_status(page)).to_contain_text(f"Standings confirmed: {2} above the cut, {1} below.",
                                                  timeout=UI_WAIT_MS)
    states = [desk.state(e["id"]) for e in ctx["entries"]]
    assert states == ["shortlisted", "shortlisted", "eliminated"]
    assert ok(desk.director.get(f"/api/rounds/{rid}"), 200)["round"]["state"] == "normalised"


def test_wf_round_results_provisional_refresh(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    studios = [desk.studio(), desk.studio()]
    juror = desk.juror()
    ctx = open_round_one(desk, studios, [juror])
    rid = ctx["rounds"]["round_1"]
    for e, level in zip(ctx["entries"], (8, 4)):
        score(juror, rid, e["id"], same(level))
    with signed_in(browser, app_url, f"/director/rounds/{rid}", DIRECTOR_EMAIL, DIRECTOR_PASSWORD) as page:
        table = page.get_by_role("table", name="Standings")
        expect(table).to_be_visible()
        submit_ballot(juror, rid)
        expected = desk.standings(rid)
        assert expected["provisional"] is True
        top = expected["rows"][0]
        row = table.get_by_role("row").filter(has_text=top["title"])
        settled = row.get_by_role("cell", name=top["score"])
        deadline = monotonic() + SAMPLE_SECONDS
        while top["score"] not in (row.text_content() or "") and settled.count() == 0 and monotonic() < deadline:
            page.clock.run_for(REFRESH_MS)
        assert top["score"] in (row.text_content() or "") or settled.count() >= 1, row.text_content()
        panel_row = page.get_by_role("table", name="Panel").get_by_role("row").filter(has_text=juror.name)
        expect(panel_row).to_contain_text("Submitted")


def test_wf_publishing_studio_sees_results(browser: Browser, app_url: str, mail: Any) -> None:
    desk = Desk(app_url)
    done = finished_category(desk)
    studio, entry = done.studios[1], done.entries[1]
    desk.publish(done.category, PAST_EMBARGO)
    with signed_in(browser, app_url, f"/studio/entries/{entry['id']}", studio.email, PASSWORD) as page:
        expect(page.get_by_text(status_line("Winner"))).to_be_visible(timeout=UI_WAIT_MS)
    seen = ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]
    assert (seen["state"], seen["award"], seen["score"]) == ("published", "winner", done.final_scores[entry["id"]])
    subject = f"Cutline results: {done.category['name']} {PROGRAM_YEAR}"
    assert len(inbox(mail, studio.email, subject)) == 1


def test_wf_publishing_embargo_masks_studio(browser: Browser, app_url: str, mail: Any) -> None:
    desk = Desk(app_url)
    done = finished_category(desk)
    studio, entry = done.studios[1], done.entries[1]
    embargo = server_now(desk.director) + timedelta(days=1)
    desk.publish(done.category, embargo.astimezone(ZoneInfo("Europe/Lisbon")).isoformat(timespec="seconds"))
    with signed_in(browser, app_url, f"/studio/entries/{entry['id']}", studio.email, PASSWORD) as page:
        expect(page.get_by_text(status_line("Final round"))).to_be_visible(timeout=UI_WAIT_MS)
        expect(page.get_by_text(status_line("Winner"))).to_have_count(0)
    masked = ok(studio.api.get(f"/api/entries/{entry['id']}"), 200)["entry"]
    assert (masked["state"], masked["award"], masked["score"]) == ("final_round", None, None)
    subject = f"Cutline results: {done.category['name']} {PROGRAM_YEAR}"
    assert inbox(mail, studio.email, subject, seconds=MAIL_POLL_S) == []


def test_wf_public_reveal_reveal_and_gallery(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    done = finished_category(desk)
    name = done.category["name"]
    winner = done.entries[1]
    embargo = server_now(desk.director) + timedelta(seconds=EMBARGO_LEAD_S)
    desk.publish(done.category, embargo.astimezone(ZoneInfo("Europe/Lisbon")).isoformat(timespec="seconds"))
    with open_app(browser, f"{app_url}/") as page:
        select(page.get_by_role("combobox", name="Program"), done.program["name"])
        region = page.get_by_role("region", name=name)
        expect(region).to_contain_text(f"Reveals at {embargo_label('Europe/Lisbon', embargo)}", timeout=UI_WAIT_MS)
        table = page.get_by_role("table", name=f"{name} standings")
        winner_row = table.get_by_role("row").filter(has_text=winner["title"])
        deadline = monotonic() + REVEAL_WAIT_S
        while winner_row.count() == 0 and monotonic() < deadline:
            page.clock.run_for(REFRESH_MS)
        expect(table).to_be_visible()
        page.clock.run_for(SETTLE_MS * 3)
        expect(table.get_by_role("row").filter(has_text=winner["title"])).to_contain_text("Winner")
        page.goto(f"{app_url}/gallery")
        select(page.get_by_role("combobox", name="Year"), str(PROGRAM_YEAR))
        select(page.get_by_role("combobox", name="Category"), name)
        winners = page.get_by_role("list", name="Winners")
        expect(winners.get_by_role("img", name=f"{winner['title']} by {done.studios[1].name}")).to_be_visible(
            timeout=UI_WAIT_MS)
    items = ok(gallery(app_url, year=PROGRAM_YEAR, category=name, award="winner"), 200)["items"]
    assert [i["title"] for i in items] == [winner["title"]]


def test_wf_public_reveal_embargoed_hidden(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    done = finished_category(desk)
    name = done.category["name"]
    embargo = server_now(desk.director) + timedelta(days=1)
    desk.publish(done.category, embargo.astimezone(ZoneInfo("Europe/Lisbon")).isoformat(timespec="seconds"))
    with open_app(browser, f"{app_url}/") as page:
        select(page.get_by_role("combobox", name="Program"), done.program["name"])
        region = page.get_by_role("region", name=name)
        expect(region).to_contain_text(f"Reveals at {embargo_label('Europe/Lisbon', embargo)}", timeout=UI_WAIT_MS)
        standings = page.get_by_role("table", name=f"{name} standings")
        for e in done.entries:
            expect(standings.get_by_role("row").filter(has_text=e["title"])).to_have_count(0)
        expect(page.get_by_role("banner").get_by_role("timer", name="Time remaining")).to_be_visible()
        for e in done.entries:
            expect(region).not_to_contain_text(e["title"])
        page.goto(f"{app_url}/gallery")
        expect(page.get_by_role("list", name="Winners")).not_to_contain_text(done.entries[1]["title"])
    assert board_category(app_url, done.program["id"], done.category["id"])["rows"] == []


APP = Path("/app")
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0",
                    "OFL-1.1"}


def npm_tree() -> dict:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=APP, capture_output=True,
                         text=True, timeout=HTTP_TIMEOUT_S * 4)
    return json.loads(out.stdout)


def shipped(tree: dict) -> dict[str, dict]:
    found: dict[str, dict] = {}

    def walk(deps: dict) -> None:
        for name, node in (deps or {}).items():
            if name not in found:
                found[name] = node
                walk(node.get("dependencies", {}))
    walk(tree.get("dependencies", {}))
    return found


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name in shipped(npm_tree()) if name not in notices]
    assert missing == [], missing
    folded = notices.lower()
    for asset in ("Archivo", "IBM Plex Sans", "IBM Plex Mono", "Lucide"):
        assert asset.lower() in folded, asset


def allowed_licence(expr: str) -> bool:
    options = re.split(r"\s+OR\s+", expr.strip().strip("()"))
    return any(all(p.strip("() ") in ALLOWED_LICENCES for p in re.split(r"\s+AND\s+", o)) for o in options)


def licence_of(node: dict) -> Any:
    licence = node.get("license") or node.get("licenses")
    if not licence and node.get("path"):
        pkg = json.loads((Path(node["path"]) / "package.json").read_text())
        licence = pkg.get("license") or pkg.get("licenses")
    if isinstance(licence, dict):
        licence = licence.get("type")
    if isinstance(licence, list):
        parts = [p.get("type") if isinstance(p, dict) else p for p in licence]
        licence = " OR ".join(str(p) for p in parts if p)
    return licence


def test_if_licences_allowed() -> None:
    bad = []
    for name, node in shipped(npm_tree()).items():
        licence = licence_of(node)
        if not licence and not node.get("path"):
            continue
        if not licence or not allowed_licence(str(licence)):
            bad.append((name, licence))
    assert bad == [], bad


DATASTORE_PACKAGES = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "@seald-io/nedb", "lokijs", "pouchdb", "level", "lmdb", "node-persist", "@libsql/client"}
DATASTORE_SUFFIXES = (".sqlite", ".sqlite3", ".db", ".rdb", ".ldb")
DEPENDENCY_DIR = "node_modules"


def test_if_no_extra_datastore() -> None:
    packages = set(shipped(npm_tree()))
    assert DATASTORE_PACKAGES.isdisjoint(packages), DATASTORE_PACKAGES & packages
    files = [p for p in APP.rglob("*") if DEPENDENCY_DIR not in p.parts and p.is_file()
             and p.suffix.lower() in DATASTORE_SUFFIXES]
    assert files == [], files


TRAJECTORY = Path("/logs/agent/trajectory.json")
PROTECTED_FILES = re.compile(r"(^|/)((docker-)?compose[^/]*\.ya?ml|\.env)$")
PATH_KEYS = ("file_path", "filePath", "path")
WRITE_KEYS = ("new_string", "old_string", "new_str", "old_str", "edits", "patch")
WRITE_TOOLS = {"write", "write_file", "create_file", "str_replace_editor", "edit", "multiedit"}
TOOL_NAME_KEYS = ("function_name", "tool_name", "name", "tool")


def test_if_service_config_unchanged() -> None:
    if not TRAJECTORY.exists():
        return
    data = json.loads(TRAJECTORY.read_text())
    touched: list[str] = []

    def walk(node: Any, tool: str | None = None) -> None:
        if isinstance(node, dict):
            named = next((node[k] for k in TOOL_NAME_KEYS if isinstance(node.get(k), str)), None)
            if named:
                tool = named.lower()
            target = next((node[k] for k in PATH_KEYS if isinstance(node.get(k), str)), None)
            writes = any(k in node for k in WRITE_KEYS)
            if target and PROTECTED_FILES.search(target) and writes:
                touched.append(target)
            for key, value in node.items():
                if key == "arguments" and isinstance(value, str) and tool in WRITE_TOOLS:
                    try:
                        value = json.loads(value)
                    except ValueError:
                        pass
                walk(value, tool)
        elif isinstance(node, list):
            for value in node:
                walk(value, tool)
    walk(data)
    assert touched == [], touched


OUTPUT_DIRS = {"node_modules", "dist", "build", ".next", "out", "coverage", ".git", ".vite", ".cache"}
JS_SUFFIXES = (".js", ".jsx", ".mjs", ".cjs")
TS_SUFFIXES = (".ts", ".tsx")
TOOL_CONFIG = re.compile(r"(\.config|rc)\.(c|m)?js$")


def test_if_typescript_source() -> None:
    files = [p for p in APP.rglob("*") if p.is_file() and not OUTPUT_DIRS.intersection(p.relative_to(APP).parts)]
    js = [p for p in files if p.suffix in JS_SUFFIXES
          and not TOOL_CONFIG.search(p.name) and not p.name.startswith(".")]
    assert js == [], js
    assert any(p.suffix in TS_SUFFIXES for p in files)
