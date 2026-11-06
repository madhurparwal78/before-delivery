from __future__ import annotations

import concurrent.futures
import contextlib
import datetime
import hashlib
import json
import os
import re
import struct
import threading
import time
import types
import uuid
import zlib
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Mailpit,
    addresses,
    advance,
    decode,
    difference,
    axe as kit_axe,
    fill as kit_fill,
    held,
    licence_allowed,
    open_app,
    pdf_pages,
    pdf_text,
    select as kit_select,
    session,
    settle,
    shipped_packages,
    tab_order,
    tap as kit_tap,
    text,
    unique,
)

WIDE = {"width": 1280, "height": 800}
PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
SMALL = {"width": 320, "height": 568}
LANDSCAPE = {"width": 812, "height": 375}
PASSWORD = "frame-rate-2027"
SEED_PASSWORD = "desk-pass-2027"
NOOR = "noor@noorbakkerboards.example"
THEO = "theo@noorbakkerboards.example"
ARTIST_MAIL = "desk@noorbakkerboards.example"
REFRESH_LINE = "Couldn't refresh. Trying again."
SESSION_COPY = "Your session ended. Sign in again to keep going — what you typed is still here."
WORKING = "Working…"
ALLOWED_DURATIONS = {160, 320, 640, 64000}
HALF_DIALOG_MS = 320
TRIM_MS = 160
JSON_LIMIT = 1_000_000
UPLOAD_LIMIT = 9_000_000
FILE_LIMIT = 8_000_000
ACCEPTED_LARGE = 7_990_000
ATTACHMENT_LIMIT = 5_000_000
SMALL_TARGET = 44
DRAW_W = 1280
DRAW_H = 720
LIVE_MS = 12_000
REFRESH_WAIT_MS = 9_000
HTTP_SECONDS = 30
SHORT_DEADLINE = 45
RENDER_DEADLINE = 40
MAIL_DEADLINE = 30
TAB_LIMIT = 60
TAB_SWEEP = 14
FLUSH_MS = 1_000
SLOW_RATE = 0.05
OPAQUE = re.compile(
    r"(?i)(\bat\s+\S+\s*\(|:\d+:\d+|select\s.+\sfrom|insert\s+into|node_modules|/app/|/src/|\.ts\b|\.js\b|postgres|pg_|prisma|knex|multer|busboy|fastify|express)"
)
CAMEL = re.compile(r"^[a-z][a-zA-Z0-9]*$")
INSTANT = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
TIME_RE = r"\d\d:\d\d"
ZOE = "Zoë Ørsted"
ELODIE = "Élodie Tremblay"
LAYLA = "ليلى حداد"
LEFT_TO_RIGHT = "ltr"
SHOT_HEADER = '"position","frame","timecodeIn","seconds","shot","visual","audio","actionNote"'
SHOT_ROW_ONE = '"1","1","00:00:00:00","1.52","\'=1","\'@x ""q""","\'-no","\'@x ""q"""'
SHOT_ROW_TWO = '"2","2","00:00:01:13","1.00","\'+2","\'\ttab","plain","\'\ttab"'
THIRTEENTH_IN = "00:00:12:00"
FIFTH_TIMECODE = "00:00:00:05"
NINETY_SECONDS = "3.60 s"
ONE_OVER = "1 frame over"
ONE_FRAME_TRIM = "Frame 1 is now 1 frame."
ONE_LONGER = "Frame 2 is 1 frame longer."
FIRST_CLIP_TIP = "Frame 1 · in 00:00:00:00 · out 00:00:00:01"
SECOND_CLIP_TIP = "Frame 2 · in 00:00:03:00 · out 00:00:04:15"
ROW_THREE_REASON = "Row 3: seconds should be a number such as 1.5."
ONE_SHORTER = "Frame 1 is 1 frame shorter."
REFUSED_ROW = "This file is not a PNG or JPEG."
WIDE_ROW = "This frame is 100 x 100. This job is 16:9."
WORKED_TAX_MINOR = 115638
NEW_FEE_TEXT = "CA$6,100.00"
VIDEO_TAG = "<video"
SOURCE_MARKS = ("dependencies", "compilerOptions", "DATABASE_URL")
TODAY_PRICE = "150.50"
OTHER_PRODUCER = "Producer Beta"
THREE_DECIMALS = "1.125"
FAR_AUDIO = " Gulls, far off "
TYPED_NOTE = "Typed while it changed"
OVERLAP_NOTE = "Overlap, typed"
LAST_JOB = "Job 26"
KEYBOARD_JOB = "Keyboard job"
RENAMED_CUT = "Renamed pass"
NEXT_CURSOR = "c-two"
TYPED_NAME = "zzz typed"
ARABIC_DRAFT = "مسودة"
WRONG_SIGNER = "Someone Else"
expect.set_options(timeout=LIVE_MS)

PRIVATE_COPY = {
    "en": {
        "heading": "Review of ", "steps": "Steps", "frames": "Frames", "notes": "Notes", "send": "Send", "next": "Next",
        "back": "Back", "open": "Open notes", "close": "Close", "strip": "Film strip", "clip": "Frame 1", "earlier": "Earlier",
        "later": "Later", "play": "Play", "pin": "Place a pin", "note": "Your note", "length": "Suggested length in seconds",
        "attach": "Attach a drawing", "add": "Add note", "name": "Your full name", "sendNotes": "Send notes",
        "sent": "Your notes were sent.", "draft": "This draft is not kept on this device.", "number": "Type a length such as 1.5.",
        "emptyNote": "Type your note.", "emptyName": "Type your full name.", "badFile": "This file is not a PNG or JPEG.",
        "bigFile": "This file is over 5,000,000 bytes.", "problems": "Problems", "working": "Working…",
        "refresh": "Couldn't refresh. Trying again.", "ended": "This page has ended.", "ask": "Ask for a new link",
        "mail": "Mail address", "answer": "If that address belongs to this page, a new link is on its way.",
        "signHeading": "Sign-off for ", "signButton": "Sign off", "wrongName": "That name doesn't match. Type your full name as it was given.",
        "reviewSubject": "Your review page for ", "reminder": "Reminder: your review page for ", "due": "Due ",
        "badLength": "1,5", "goodLength": "1.5", "frameCount": "{} frames", "signed": "Signed off at ", "phrase": "Amsterdam time",
    },
    "nl": {
        "heading": "Beoordeling van ", "steps": "Stappen", "frames": "Beelden", "notes": "Notities", "send": "Versturen", "next": "Volgende",
        "back": "Terug", "open": "Notities openen", "close": "Sluiten", "strip": "Filmstrook", "clip": "Beeld 1", "earlier": "Eerder",
        "later": "Later", "play": "Afspelen", "pin": "Speld plaatsen", "note": "Je notitie", "length": "Voorgestelde lengte in seconden",
        "attach": "Tekening toevoegen", "add": "Notitie toevoegen", "name": "Je volledige naam", "sendNotes": "Notities versturen",
        "sent": "Je notities zijn verstuurd.", "draft": "Dit concept wordt niet op dit apparaat bewaard.", "number": "Typ een lengte zoals 1,5.",
        "emptyNote": "Typ je notitie.", "emptyName": "Typ je volledige naam.", "badFile": "Dit bestand is geen PNG of JPEG.",
        "bigFile": "Dit bestand is groter dan 5.000.000 bytes.", "problems": "Problemen", "working": "Bezig…",
        "refresh": "Vernieuwen is niet gelukt. We proberen het opnieuw.", "ended": "Deze pagina is verlopen.", "ask": "Vraag een nieuwe link aan",
        "mail": "E-mailadres", "answer": "Als dit adres bij deze pagina hoort, is er een nieuwe link onderweg.",
        "signHeading": "Akkoord voor ", "signButton": "Akkoord geven", "wrongName": "Die naam komt niet overeen. Typ je volledige naam zoals die is doorgegeven.",
        "reviewSubject": "Je beoordelingspagina voor ", "reminder": "Herinnering: je beoordelingspagina voor ", "due": "Uiterlijk ",
        "badLength": "1.5", "goodLength": "1,5", "frameCount": "{} beelden", "signed": "Akkoord gegeven om ", "phrase": "tijd in Amsterdam",
    },
    "fr": {
        "heading": "Relecture de ", "steps": "Étapes", "frames": "Images", "notes": "Notes", "send": "Envoyer", "next": "Suivant",
        "back": "Retour", "open": "Ouvrir les notes", "close": "Fermer", "strip": "Bande de film", "clip": "Image 1", "earlier": "Plus tôt",
        "later": "Plus tard", "play": "Lire", "pin": "Placer une épingle", "note": "Votre note", "length": "Durée suggérée en secondes",
        "attach": "Joindre un dessin", "add": "Ajouter la note", "name": "Votre nom complet", "sendNotes": "Envoyer les notes",
        "sent": "Vos notes ont été envoyées.", "draft": "Ce brouillon n'est pas conservé sur cet appareil.", "number": "Saisissez une durée comme 1,5.",
        "emptyNote": "Saisissez votre note.", "emptyName": "Saisissez votre nom complet.", "badFile": "Ce fichier n'est ni un PNG ni un JPEG.",
        "bigFile": "Ce fichier dépasse 5 000 000 octets.", "problems": "Problèmes", "working": "En cours…",
        "refresh": "Actualisation impossible. Nouvel essai en cours.", "ended": "Cette page est terminée.", "ask": "Demander un nouveau lien",
        "mail": "Adresse e-mail", "answer": "Si cette adresse correspond à cette page, un nouveau lien est en route.",
        "signHeading": "Validation de ", "signButton": "Valider", "wrongName": "Ce nom ne correspond pas. Saisissez votre nom complet tel qu'il a été donné.",
        "reviewSubject": "Votre page de relecture pour ", "reminder": "Rappel : votre page de relecture pour ", "due": "À rendre le ",
        "badLength": "1.5", "goodLength": "1,5", "frameCount": "{} images", "signed": "Validé à ", "phrase": "heure d'Amsterdam",
    },
    "ar": {
        "heading": "مراجعة ", "steps": "الخطوات", "frames": "الإطارات", "notes": "الملاحظات", "send": "إرسال", "next": "التالي",
        "back": "السابق", "open": "فتح الملاحظات", "close": "إغلاق", "strip": "شريط الفيلم", "clip": "الإطار 1", "earlier": "أبكر",
        "later": "لاحقًا", "play": "تشغيل", "pin": "وضع دبوس", "note": "ملاحظتك", "length": "المدة المقترحة بالثواني",
        "attach": "إرفاق رسم", "add": "إضافة الملاحظة", "name": "اسمك الكامل", "sendNotes": "إرسال الملاحظات",
        "sent": "تم إرسال ملاحظاتك.", "draft": "لا يتم حفظ هذه المسودة على هذا الجهاز.", "number": "اكتب مدة مثل ١٫٥.",
        "emptyNote": "اكتب ملاحظتك.", "emptyName": "اكتب اسمك الكامل.", "badFile": "هذا الملف ليس PNG أو JPEG.",
        "bigFile": "حجم هذا الملف يتجاوز 5,000,000 بايت.", "problems": "المشكلات", "working": "جارٍ العمل…",
        "refresh": "تعذر التحديث. جارٍ إعادة المحاولة.", "ended": "انتهت هذه الصفحة.", "ask": "طلب رابط جديد",
        "mail": "عنوان البريد الإلكتروني", "answer": "إذا كان هذا العنوان مرتبطًا بهذه الصفحة، فسيصلك رابط جديد قريبًا.",
        "signHeading": "اعتماد ", "signButton": "اعتماد", "wrongName": "هذا الاسم غير مطابق. اكتب اسمك الكامل كما هو مسجل.",
        "reviewSubject": "صفحة المراجعة الخاصة بك لـ ", "reminder": "تذكير: صفحة المراجعة الخاصة بك لـ ", "due": "الموعد النهائي ",
        "badLength": "1,5", "goodLength": "١٫٥", "frameCount": "{} إطارًا", "signed": "تم الاعتماد في ", "phrase": "بتوقيت أمستردام",
    },
}
LANGUAGE_NAMES = {"en": "Ada Lind", "nl": ZOE, "fr": ELODIE, "ar": LAYLA}


def fresh(prefix: str = "desk") -> tuple[str, str]:
    first, second = unique(prefix)
    return (second, first) if "@" in first else (first, second)


def anon(base: str, method: str, path: str, **kwargs: Any) -> httpx.Response:
    return httpx.request(method, base + path, timeout=HTTP_SECONDS, **kwargs)


def day(value: str) -> datetime.date:
    return datetime.date.fromisoformat(value)


def plus(value: str, days: int) -> str:
    return (day(value) + datetime.timedelta(days=days)).isoformat()


def pretty_re(value: str) -> str:
    d = day(value)
    return f"{d.strftime('%a')} 0?{d.day} {d.strftime('%b %Y')}"


def today() -> str:
    return datetime.datetime.now(ZoneInfo("Europe/Amsterdam")).date().isoformat()


def wall_utc(date: str, clock: str, zone: str) -> str:
    moment = datetime.datetime.fromisoformat(f"{date}T{clock}:00").replace(tzinfo=ZoneInfo(zone), fold=0)
    return moment.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local_clock(instant: str, zone: str) -> str:
    moment = datetime.datetime.strptime(instant, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    return moment.astimezone(ZoneInfo(zone)).strftime("%H:%M")


def clock_changes(zone: str, start: str) -> list[tuple[str, bool]]:
    tz = ZoneInfo(zone)
    found = []
    previous = day(start)
    for offset in range(1, 420):
        current = previous + datetime.timedelta(days=1)
        a = datetime.datetime(previous.year, previous.month, previous.day, 12, tzinfo=tz).utcoffset()
        b = datetime.datetime(current.year, current.month, current.day, 12, tzinfo=tz).utcoffset()
        if a != b:
            found.append((current.isoformat(), b > a))
        previous = current
    return found


def png(salt: int, width: int = DRAW_W, height: int = DRAW_H, padding: int = 0) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    row = b"\x00" + bytes([salt % 256, (salt >> 8) % 256, (salt >> 16) % 256]) * width
    payload = zlib.compress(row * height)
    body = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    if padding:
        body += chunk(b"tEXt", b"pad\x00" + b"p" * padding)
    return body + chunk(b"IDAT", payload) + chunk(b"IEND", b"")


def png_of_size(salt: int, size: int) -> bytes:
    base_size = len(png(salt, padding=1))
    data = png(salt, padding=1 + size - base_size)
    assert len(data) == size
    return data


def jpeg(width: int = DRAW_W, height: int = DRAW_H) -> bytes:
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 17, 8, height, width, 3) + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + sof + uuid.uuid4().bytes + b"\xff\xd9"


def csv_cell(value: Any) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def script_file(rows: list[tuple[Any, ...]], bom: bool = False, crlf: bool = False) -> bytes:
    end = "\r\n" if crlf else "\n"
    lines = ["shot,visual,audio,seconds"] + [",".join(csv_cell(c) for c in row) for row in rows]
    return (("\ufeff" if bom else "") + end.join(lines) + end).encode()


class Desk:
    def __init__(self, base: str, email: str | None = None, password: str = PASSWORD):
        self.base = base
        self.password = password
        self.http = httpx.Client(base_url=base, timeout=HTTP_SECONDS)
        if email is None:
            self.name, self.email = fresh("desk")
            answer = self.http.post("/api/sign-up", json={"name": self.name, "email": self.email, "password": password})
            assert answer.status_code == 201, answer.text
        else:
            self.email = email
            answer = self.http.post("/api/sign-in", json={"email": email, "password": password})
            assert answer.status_code == 200, answer.text
            self.name = answer.json()["name"]
        self.cookie_header = answer.headers.get("set-cookie", "")

    def call(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        return self.http.request(method, path, **kwargs)

    def ok(self, method: str, path: str, status: int, **kwargs: Any) -> Any:
        answer = self.call(method, path, **kwargs)
        assert answer.status_code == status, f"{method} {path}: {answer.status_code} {answer.text[:400]}"
        return answer.json() if answer.content else None

    def client(self, name: str | None = None, place: str = "netherlands") -> dict:
        return self.ok("POST", "/api/clients", 201, json={"name": name or fresh("client")[0], "place": place})

    def producer(self, client_id: str, town: str = "amsterdam", language: str = "en", name: str | None = None, email: str | None = None) -> dict:
        generated_name, generated_mail = fresh("producer")
        return self.ok("POST", f"/api/clients/{client_id}/producers", 201, json={
            "name": name or generated_name, "email": email or generated_mail, "town": town, "language": language})

    def job(self, client_id: str, title: str = "Night Ferry", rate: str = "25", target: int = 30, aspect: str = "16:9", due: str | None = None) -> dict:
        return self.ok("POST", "/api/jobs", 201, json={
            "clientId": client_id, "title": title, "adId": "NOOR1234567H", "dueDate": due or plus(today(), 21),
            "targetSeconds": target, "frameRate": rate, "aspect": aspect})

    def board(self, job_id: str) -> dict:
        return self.ok("GET", f"/api/jobs/{job_id}/board", 200)

    def script(self, job_id: str, rows: list[tuple[Any, ...]]) -> dict:
        return self.ok("POST", f"/api/jobs/{job_id}/script", 200, files={"file": ("script.csv", script_file(rows), "text/csv")})

    def upload(self, job_id: str, data: bytes, name: str = "drawing.png") -> dict:
        return self.ok("POST", f"/api/jobs/{job_id}/frames", 201, files={"file": (name, data, "image/png")})

    def durations(self, job_id: str, values: dict[int, int]) -> None:
        for number, duration in values.items():
            self.ok("PATCH", f"/api/jobs/{job_id}/frames/{number}", 200, json={"durationFrames": duration, "stamp": self.board(job_id)["stamp"]})

    def cut(self, job_id: str, name: str = "First pass") -> dict:
        return self.ok("POST", f"/api/jobs/{job_id}/cuts", 201, json={"name": name})


def staged(desk: Desk, rate: str = "25", frames: int = 3, seconds: str = "1", town: str = "amsterdam", language: str = "en",
           place: str = "netherlands", title: str = "Night Ferry", name: str | None = None, drawn: bool = False,
           target: int = 30, email: str | None = None) -> types.SimpleNamespace:
    client = desk.client(place=place)
    producer = desk.producer(client["id"], town=town, language=language, name=name, email=email)
    job = desk.job(client["id"], title=title, rate=rate, target=target)
    if frames:
        desk.script(job["id"], [(n, f"Action {n}.", "", seconds) for n in range(1, frames + 1)])
    if drawn:
        for n in range(frames):
            desk.upload(job["id"], png(int(uuid.uuid4().int % 2**24)))
    return types.SimpleNamespace(client=client, producer=producer, job=job, jid=job["id"], cid=client["id"], pid=producer["id"])


def review(desk: Desk, ns: types.SimpleNamespace, cut: int) -> tuple[dict, str]:
    page = desk.ok("POST", f"/api/jobs/{ns.jid}/reviews", 201, json={"producerId": ns.pid, "cut": cut})
    return page, page["url"].rsplit("/", 1)[-1]


def sign_page(desk: Desk, ns: types.SimpleNamespace, cut: int) -> tuple[dict, str]:
    page = desk.ok("POST", f"/api/jobs/{ns.jid}/sign-offs", 201, json={"producerId": ns.pid, "cut": cut})
    return page, page["url"].rsplit("/", 1)[-1]


def send_note(base: str, token: str, frame: int = 1, words: str = "Un peu plus long.", name: str = "Typed Name", key: str | None = None, length: str | None = None) -> httpx.Response:
    return anon(base, "POST", f"/api/r/{token}/notes", json={
        "sendKey": key or uuid.uuid4().hex, "name": name,
        "notes": [{"frame": frame, "x": 41.5, "y": 62.0, "text": words, "suggestedLength": length, "attachmentId": None}]})


def signed_job(desk: Desk, **kwargs: Any) -> types.SimpleNamespace:
    ns = staged(desk, drawn=True, **kwargs)
    cut = desk.cut(ns.jid)
    _, token = sign_page(desk, ns, cut["number"])
    answer = anon(desk.base, "POST", f"/api/s/{token}/sign", json={"name": ns.producer["name"]})
    assert answer.status_code == 200, answer.text
    ns.cut = cut["number"]
    return ns


def wait_for(predicate: Callable[[], Any], contract: str, seconds: float = SHORT_DEADLINE) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        threading.Event().wait(POLL_S)
    pytest.fail(f"expected within {seconds} s: {contract}")


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        return [f.result() for f in [pool.submit(c) for c in calls]]


def assert_shape(value: Any, key: str = "") -> None:
    if key == "stamp":
        return
    if isinstance(value, dict):
        for name, inner in value.items():
            if key != "fields":
                assert CAMEL.match(name), f"key {name!r} is not camelCase"
            assert_shape(inner, name)
    elif isinstance(value, list):
        for inner in value:
            assert_shape(inner, key)
    elif isinstance(value, str) and re.match(r"^\d{4}-\d\d-\d\dT", value):
        assert INSTANT.match(value), f"{key}: {value!r} is not a whole-second UTC instant"


def assert_error(answer: httpx.Response, status: int, code: str | None = None, message: str | None = None) -> dict:
    assert answer.status_code == status, f"expected {status}, got {answer.status_code}: {answer.text[:300]}"
    body = answer.json()
    assert set(body) == {"error"}, body
    error = body["error"]
    assert isinstance(error["code"], str) and isinstance(error["message"], str), body
    assert set(error) <= {"code", "message", "fields"}, body
    assert not OPAQUE.search(answer.text), answer.text
    if code:
        assert error["code"] == code
    if message:
        assert error["message"] == message
    return error


def assert_cookie(desk: Desk) -> None:
    header = desk.cookie_header.lower()
    assert "httponly" in header and "samesite=lax" in header, header
    assert "secure" not in header and "max-age" not in header and "expires" not in header, header


def assert_ladder(desk: Desk, method: str, path: str, unknown: str, body: Any = None, wrong: str = "PUT",
                  auth: bool = True, invalid: bool = True, multipart: bool = False, json_body: bool = True) -> None:
    base = desk.base
    answer = anon(base, wrong, path, json=body or {})
    assert_error(answer, 405)
    assert method in answer.headers.get("allow", ""), answer.headers
    limit = UPLOAD_LIMIT if multipart else JSON_LIMIT
    assert_error(anon(base, method, path, content=b"x" * (limit + 1), headers={"Content-Type": "application/json"}), 413)
    foreign = {"Origin": "http://elsewhere.example"}
    assert_error(anon(base, method, path, json=body or {}, headers=foreign), 403)
    if auth:
        assert_error(anon(base, method, unknown, json=body or {}), 401, "notSignedIn")
    if multipart:
        assert_error(desk.call(method, unknown, files={"file": ("a.png", png(1), "image/png")}), 404)
        assert_error(desk.call(method, path, json={}), 415)
        return
    if json_body:
        plain = {"content": b"{}", "headers": {"Content-Type": "text/plain"}}
        if unknown != path:
            assert_error(desk.call(method, unknown, **plain), 404)
        assert_error(desk.call(method, path, **plain), 415)
        assert_error(desk.call(method, path, content=b"{bad", headers={"Content-Type": "application/json"}), 400)
        if invalid:
            error = assert_error(desk.call(method, path, json={}), 422)
            assert "fields" in error or error["message"]
    else:
        assert_error(desk.call(method, unknown, json={}), 404)


def unknown_id() -> str:
    return str(uuid.uuid4())


def mail_to(box: Mailpit, address: str, subject: str | None = None, count: int = 1, seconds: float = MAIL_DEADLINE) -> list[dict]:
    def matching() -> list[dict]:
        return [m for m in box.messages(0, settle=0.2)
                if address.lower() in [a.lower() for a in addresses(m.get("To"))]
                and (subject is None or m.get("Subject") == subject)]

    wait_for(lambda: len(matching()) >= count, f"{count} mail(s) to {address} with subject {subject!r}", seconds)
    box.messages(0)
    return matching()


def mailpit_bases(box: Mailpit) -> list[str]:
    found = [v for k, v in os.environ.items() if "MAILPIT" in k and v.startswith("http")]
    for value in getattr(box, "__dict__", {}).values():
        if isinstance(value, str) and value.startswith("http"):
            found.append(value)
        if isinstance(value, httpx.Client):
            found.append(str(value.base_url))
    return found


def calendar_bytes(box: Mailpit, message: dict) -> bytes:
    parts = [a for a in (message.get("Attachments") or []) + (message.get("Inline") or []) if a.get("FileName") == "call.ics"]
    assert parts, f"no call.ics on {message.get('Subject')}"
    assert parts[0].get("ContentType", "").startswith("text/calendar")
    for base in mailpit_bases(box):
        answer = httpx.get(f"{base.rstrip('/')}/api/v1/message/{message['ID']}/part/{parts[0]['PartID']}", timeout=HTTP_SECONDS)
        if answer.status_code == 200:
            return answer.content
    pytest.fail("the verifier could not read the call.ics part from Mailpit")


def logged(entry: dict) -> dict:
    return entry.get("request", entry)


def journal_body(entry: dict) -> Any:
    body = logged(entry).get("body")
    return json.loads(body) if isinstance(body, str) else body


def journal_header(entry: dict, name: str) -> str | None:
    for key, value in (logged(entry).get("headers") or {}).items():
        if key.lower() == name.lower():
            if isinstance(value, dict):
                return value.get("values", [None])[0]
            return value[0] if isinstance(value, list) else value
    return None


def journal_url(entry: dict) -> str:
    request = logged(entry)
    return f"{request.get('path', '')}?{urlencode(request.get('query') or {})}"


@contextlib.contextmanager
def opened(browser: Browser, base: str, path: str = "/", desk: Desk | None = None, size: dict | None = None,
           reduced: bool = False, paused: bool = False, password: str | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/api/health", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size(size or WIDE)
        if not paused:
            page.clock.resume()
        if desk is not None:
            answer = page.context.request.post(base + "/api/sign-in", data={"email": desk.email, "password": password or desk.password})
            assert answer.ok, answer.text()
        page.goto(base + path)
        if paused:
            advance(page, FLUSH_MS)
        yield page


POLL_S = 0.1
WAIT_CAP_S = 60
OPTION_KEYS = 8
OPTION_READS = 5
UI_CHECK_S = 3
MAIL_QUIET_S = 10
PRESS_WAIT_S = 15
PICK_WAIT_S = 10
JUDGED_WAIT_MS = 5_000
ENTRANCE_WAIT_S = 10
SHEET_SETTLE_S = 0.5
INERT_WAIT_S = 1
GONE_WAIT_S = 0.25
PAUSE_LEAD_S = 1
AFTER_PAUSE_MS = 120
RING_DIFF = 0.5
OUTLINE_BAND = 5
RING_BAND = 8
MARK_DIFF = 0.01
OPENER_AT_ONCE_MS = 200
GONE_AT_ONCE_MS = 200
HOLD_OPEN_S = 0.8
LOAD_WAIT_MS = 8_000
ANNOUNCE_WAIT_S = 15

FINISH_JS = """() => document.getAnimations().forEach(a => {
  if (a.effect && Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); })"""

PICK_JS = """e => {
  e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  const at = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return null;
    const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return hit && (hit === el || el.contains(hit)) ? {x, y} : null;
  };
  const own = at(e);
  if (own) return own;
  const label = (e.labels && e.labels[0]) || e.closest('label');
  return label ? at(label) : null;
}"""

BOX_JS = """e => { const small = r => r.width <= 2 || r.height <= 2;
  const box = small(e.getBoundingClientRect()) && e.labels && e.labels[0] ? e.labels[0] : e;
  const r = box.getBoundingClientRect(); return {x: r.left, y: r.top, width: r.width, height: r.height}; }"""

TIMED_JS = """() => { window.__escapeAt = null; window.__lastFocus = null;
  addEventListener('keydown', e => { if (e.key === 'Escape') window.__escapeAt = performance.now(); }, true);
  addEventListener('focusin', () => { window.__lastFocus = performance.now(); }, true); }"""

GONE_WATCH_JS = """el => { window.__goneAt = null; const tick = () => {
  if (!el.isConnected || !el.checkVisibility({visibilityProperty: true})) { window.__goneAt = performance.now(); return; }
  requestAnimationFrame(tick); }; requestAnimationFrame(tick); }"""

HIGHLIGHT_JS = """() => { const a = document.activeElement; if (!a) return '';
  const id = a.getAttribute('aria-activedescendant');
  const el = id ? document.getElementById(id) : (a.getAttribute('role') === 'option' ? a : document.querySelector('[role=option][aria-selected="true"]'));
  return el ? el.textContent.trim() : ''; }"""

WATCH_JS = """el => { el.__said = []; new MutationObserver(() => el.__said.push(el.textContent.trim()))
  .observe(el, {childList: true, characterData: true, subtree: true}); }"""

DURATIONS_JS = """(allowed) => {
  const ok = new Set(allowed); const bad = [];
  const ms = v => v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
  const check = (list, where) => { for (const v of String(list).split(',')) { const n = ms(v); if (Number.isNaN(n) || n < 1) continue; if (!ok.has(Math.round(n * 1000) / 1000)) bad.push(where + ': ' + v.trim()); } };
  const reduced = r => r.conditionText && /prefers-reduced-motion/.test(r.conditionText);
  const visit = rules => { for (const r of rules) { if (reduced(r)) continue; if (r.style) { for (const v of [r.style.transitionDuration, r.style.animationDuration]) { if (v && !v.includes('var(')) check(v, r.selectorText || '@'); } } if (r.cssRules) visit(r.cssRules); } };
  for (const s of document.styleSheets) { try { visit(s.cssRules); } catch (e) {} }
  for (const el of document.querySelectorAll('*')) { const cs = getComputedStyle(el); check(cs.transitionDuration, el.tagName); check(cs.animationDuration, el.tagName); }
  return bad;
}"""


class ScriptsByEvaluate:

    def __init__(self, page: Page) -> None:
        self.page = page

    def add_script_tag(self, path: str) -> None:
        self.page.evaluate(Path(path).read_text())

    def __getattr__(self, name: str) -> Any:
        return getattr(self.page, name)


def axe(page: Page) -> None:
    page.evaluate(FINISH_JS)
    kit_axe(ScriptsByEvaluate(page))


def pressing(locator: Locator, act: Callable[[], Any]) -> None:
    deadline = time.monotonic() + PRESS_WAIT_S
    refused: Exception | None = None
    while time.monotonic() < deadline:
        try:
            act()
            return
        except (AssertionError, PlaywrightError) as error:
            refused = error
            if "obscured" in str(error):
                with contextlib.suppress(PlaywrightError):
                    locator.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})", timeout=2_000)
    raise refused


def tap(locator: Locator) -> None:
    pressing(locator, lambda: kit_tap(locator))


def fill(locator: Locator, value: str) -> None:
    pressing(locator, lambda: kit_fill(locator, value))


def select(locator: Locator, choice: str) -> None:
    pressing(locator, lambda: kit_select(locator, choice))


def pick(choice: Locator, touch: bool = False, checked: bool = True, shift: bool = False) -> None:
    page = choice.page
    expect(choice).to_be_attached()
    point = wait_for(lambda: choice.evaluate(PICK_JS), "a hit target for the choice or its label", PICK_WAIT_S)
    if shift:
        page.keyboard.down("Shift")
    (page.touchscreen.tap if touch else page.mouse.click)(point["x"], point["y"])
    if shift:
        page.keyboard.up("Shift")
    if checked:
        expect(choice).to_be_checked()


def loaded(page: Page) -> None:
    with contextlib.suppress(PlaywrightError):
        page.wait_for_load_state("networkidle", timeout=LOAD_WAIT_MS)


def hold_for(page: Page, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        page.evaluate("() => 0")


def state_mark(page: Page, control: Locator, act: Callable[[], Any]) -> None:
    page.emulate_media(forced_colors="active")

    def picture(clip: dict) -> Any:
        page.mouse.move(1, 1)
        page.evaluate(FINISH_JS)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        return decode(page.screenshot(clip=clip, scale="css", animations="disabled"))

    control.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})")
    box = control.evaluate(BOX_JS)
    view = page.viewport_size
    x0, y0 = max(0, box["x"] - OUTLINE_BAND), max(0, box["y"] - OUTLINE_BAND)
    clip = {"x": x0, "y": y0, "width": max(1, min(view["width"], box["x"] + box["width"] + OUTLINE_BAND) - x0),
            "height": max(1, min(view["height"], box["y"] + box["height"] + OUTLINE_BAND) - y0)}
    before = picture(clip)
    act()
    after = picture(clip)
    page.emulate_media(forced_colors="none")
    assert difference(before, after) > MARK_DIFF, "SR18: under forced colours this state shows by a background colour alone"


def announced_twice(page: Page, act: Callable[[], Any]) -> None:
    region = say(page)
    expect(region).to_have_count(1)
    region.evaluate(WATCH_JS)
    act()
    wait_for(lambda: any(region.evaluate("el => el.__said")), "the first announcement", ANNOUNCE_WAIT_S)
    first = region.evaluate("el => el.textContent.trim()")
    assert first, "SR19: the announcement left the region empty"
    region.evaluate("el => { el.__said = []; }")
    act()
    wait_for(lambda: any(first in said_now for said_now in region.evaluate("el => el.__said")),
             f"SR19: {first!r} announced a second time", ANNOUNCE_WAIT_S)


def durations_ok(page: Page) -> None:
    bad = page.evaluate(DURATIONS_JS, sorted(ALLOWED_DURATIONS))
    assert not bad, f"SR7: durations other than the published ones: {bad[:8]}"


def key_to_option(page: Page, name: str, first_key: str = "ArrowDown") -> None:
    for key in (first_key, "ArrowUp" if first_key == "ArrowDown" else "ArrowDown"):
        for _ in range(OPTION_KEYS):
            page.keyboard.press(key)
            for _ in range(OPTION_READS):
                if name in page.evaluate(HIGHLIGHT_JS):
                    page.keyboard.press("Enter")
                    return
                threading.Event().wait(POLL_S)
    pytest.fail(f"the arrow keys never highlighted {name!r}")


def link_bytes(page: Page, link: Locator) -> bytes:
    expect(link).to_be_visible()
    answer = page.context.request.get(str(httpx.URL(page.url).join(link.get_attribute("href"))))
    assert answer.ok, answer.status
    return answer.body()


def sweep(browser: Browser, base: str, who: Desk | None, path: str, main: tuple[str, str] | None) -> None:
    with opened(browser, base, path, who, size=PHONE) as page:
        expect(h1(page)).to_be_visible()
        loaded(page)
        page.evaluate(FINISH_JS)
        offenders = page.evaluate(TOUCH_JS, SMALL_TARGET)
        assert not offenders, f"SR4: touch areas under 44 px: {offenders}"
        axe(page)
        if main:
            control = role(page, *main)
            expect(control).to_be_visible()
            top = control.bounding_box()["y"]
            assert top > PHONE["height"] / 2 and top + control.bounding_box()["height"] <= PHONE["height"], "SR6: the main action is not in the bottom bar"
            page.evaluate("() => scrollTo(0, document.documentElement.scrollHeight)")
            assert abs(control.bounding_box()["y"] - top) <= 1, "SR6: the bottom bar is not fixed"
            page.evaluate("() => scrollTo(0, 0)")
        for _ in range(6):
            page.keyboard.press("Tab")
            assert focused_in_view(page), "SR6: a focused control is covered or out of view at 375"
        assert not page.evaluate(CUT_JS), f"SR16: text is cut off at 375: {page.evaluate(CUT_JS)}"
        page.add_style_tag(content=SPACING_CSS)
        assert not page.evaluate(CUT_JS), f"SR16: text is cut off at 375 under text spacing: {page.evaluate(CUT_JS)}"
    with opened(browser, base, path, who) as page:
        expect(h1(page)).to_be_visible()
        loaded(page)
        page.evaluate(FINISH_JS)
        axe(page)
        durations_ok(page)
        assert not page.evaluate(CUT_JS), f"SR16: text is cut off at 1280: {page.evaluate(CUT_JS)}"
        page.add_style_tag(content=SPACING_CSS)
        assert not page.evaluate(CUT_JS), f"SR16: text is cut off at 1280 under text spacing: {page.evaluate(CUT_JS)}"
    with opened(browser, base, path, who, size=SMALL) as page:
        expect(h1(page)).to_be_visible()
        loaded(page)
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), "SR15: the page scrolls sideways at 320"
    moved = f"{plus(today(), 3)}T12:00:00Z"
    assert printed_text(browser, base, who, path, False, moved) == printed_text(browser, base, who, path, True, moved), "SR14: the screen prints differently with another language, zone or clock"


def sweep_for(browser: Browser, base: str, *keys: str) -> None:
    desk, routes = sweep_world(base)
    for key in keys:
        path, main, signed_in = routes[key]
        sweep(browser, base, desk if signed_in else None, path, main)


def role(page: Page | Locator, kind: str, name: str) -> Locator:
    return page.get_by_role(kind, name=name, exact=True)


def h1(page: Page) -> Locator:
    return page.get_by_role("heading", level=1)


def say(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements", include_hidden=True)


def said(page: Page, copy: str | re.Pattern) -> None:
    if isinstance(copy, str):
        expect(say(page)).to_contain_text(copy)
    else:
        expect(say(page)).to_have_text(copy)


def heading_is(page: Page, heading: str) -> None:
    expect(page.get_by_role("heading", level=1, name=heading, exact=True)).to_be_visible()


def at(page: Page, heading: str) -> None:
    heading_is(page, heading)
    expect(page).to_have_title(f"{heading} — Clapstick")


def focus_inside(page: Page, locator: Locator) -> bool:
    return locator.evaluate("el => el.contains(document.activeElement)")


def is_focused(locator: Locator) -> bool:
    return locator.evaluate("el => el === document.activeElement")


def tab_to(page: Page, target: Locator, presses: int = TAB_LIMIT) -> None:
    for _ in range(presses):
        page.keyboard.press("Tab")
        if is_focused(target):
            return
    pytest.fail(f"Tab never reached {target}")


def has_ring(page: Page) -> bool:
    box = page.evaluate("() => document.activeElement && document.activeElement !== document.body")
    if not box:
        return False
    box = page.evaluate_handle("() => document.activeElement").as_element().evaluate(BOX_JS)
    view = page.viewport_size
    x0, y0 = max(0, box["x"] - RING_BAND), max(0, box["y"] - RING_BAND)
    clip = {"x": x0, "y": y0, "width": min(view["width"], box["x"] + box["width"] + RING_BAND) - x0,
            "height": min(view["height"], box["y"] + box["height"] + RING_BAND) - y0}
    if clip["width"] < 1 or clip["height"] < 1:
        return False
    page.mouse.move(1, 1)
    shown = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    page.evaluate("() => { window.__ringFocus = document.activeElement; window.__ringFocus.blur(); }")
    hidden = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    page.evaluate("() => window.__ringFocus.focus()")
    return difference(shown, hidden) > RING_DIFF


def focused_in_view(page: Page) -> bool:
    return page.evaluate("""() => { const e = document.activeElement; if (!e || e === document.body) return true;
      const small = r => r.width <= 2 || r.height <= 2;
      const box = small(e.getBoundingClientRect()) && e.labels && e.labels[0] ? e.labels[0] : e;
      const r = box.getBoundingClientRect();
      const large = r.height > innerHeight * 0.6 || r.width >= innerWidth;
      if (!large && (r.top < 0 || r.bottom > innerHeight || r.left < -1 || r.right > innerWidth + 1)) return false;
      const x = (Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2, y = (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === e || box.contains(hit) || e.contains(hit) || hit.contains(e)); }""")


def uncut(item: Locator) -> None:
    assert item.evaluate("""el => { const r = el.getBoundingClientRect();
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (el === hit || el.contains(hit)); }"""), f"{item} is cut off or covered"


def mark(locator: Locator, value: str = "same") -> None:
    locator.evaluate("(el, v) => { el.__mark = v; }", value)


def marked(locator: Locator, value: str = "same") -> bool:
    return locator.evaluate("(el, v) => el.__mark === v", value)


ENTRANCE_JS = """el => {
  const finite = a => a.effect && a.effect.target && Number.isFinite(a.effect.getComputedTiming().endTime);
  const near = t => t === el || t.contains(el) || el.contains(t);
  const all = document.getAnimations().filter(finite);
  const durations = all.filter(a => near(a.effect.target)).map(a => a.effect.getComputedTiming().duration);
  const nodes = [...new Set([el, ...all.map(a => a.effect.target).filter(near)])];
  const read = n => { const r = n.getBoundingClientRect(); return {left: r.left, top: r.top, width: r.width, height: r.height}; };
  all.forEach(a => { a.pause(); a.currentTime = 0; });
  const starts = nodes.map(read);
  all.forEach(a => a.finish());
  const ends = nodes.map(read);
  const moved = i => ['left', 'top', 'width', 'height'].some(k => Math.abs(starts[i][k] - ends[i][k]) > 1);
  let chosen = 0, area = -1;
  nodes.forEach((n, i) => { const size = ends[i].width * ends[i].height; if (moved(i) && size > area) { chosen = i; area = size; } });
  return {durations, start: starts[chosen], end: ends[chosen]};
}"""
ANIMATED_JS = """el => document.getAnimations().some(a => { const t = a.effect && a.effect.target;
  return t && Number.isFinite(a.effect.getComputedTiming().endTime) && (t === el || t.contains(el) || el.contains(t)); })"""


def entrance(page: Page, act: Callable[[], None], target: Locator) -> dict:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    act()
    expect(target).to_be_attached()
    wait_for(lambda: target.evaluate(ANIMATED_JS), "SR24: the opening runs as a browser animation", ENTRANCE_WAIT_S)
    result = target.evaluate(ENTRANCE_JS)
    cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
    return result


FEEDBACK_MS = 160


def long_animations(page: Page) -> list[float]:
    return [d for d in finite_animations(page) if d > FEEDBACK_MS]


def finite_animations(page: Page) -> list[float]:
    return page.evaluate("""() => document.getAnimations().filter(a => a.playState === 'running' && a.effect
      && Number.isFinite(a.effect.getComputedTiming().endTime)).map(a => a.effect.getComputedTiming().duration)""")


STRIP_MOTION_JS = """strip => document.getAnimations().filter(a => { const t = a.effect && a.effect.target;
  return t && (strip.contains(t) || t.contains(strip)); }).map(a => a.effect.getComputedTiming().duration)"""


def trim_travel(page: Page, strip: Locator, later: Locator, act: Callable[[], None]) -> None:
    wait_for(lambda: not finite_animations(page), "earlier feedback ends", ENTRANCE_WAIT_S)
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    start = later.bounding_box()["x"]
    act()
    wait_for(lambda: TRIM_MS in strip.evaluate(STRIP_MOTION_JS), "the trim runs in its published time", ENTRANCE_WAIT_S)
    cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
    wait_for(lambda: later.bounding_box()["x"] > start, "the later clip travels", ENTRANCE_WAIT_S)


DECLARED_JS = """() => document.getAnimations().map(a => { const d = Math.round(a.effect.getComputedTiming().duration);
  if (!(a instanceof CSSTransition)) return d;
  const s = getComputedStyle(a.effect.target, a.effect.pseudoElement || undefined);
  const listed = s.transitionDuration.split(',').map(x => Math.round(parseFloat(x) * 1000)).filter(x => x >= d).sort((x, y) => x - y);
  return listed.length ? listed[0] : d; }).filter(d => d > 0)"""


def motion_durations(page: Page, act: Callable[[], None], seen: set[float], want: frozenset[int] = frozenset()) -> None:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    act()
    wait_for(lambda: page.evaluate("() => document.getAnimations().length > 0"), "the motion runs as a browser animation", ENTRANCE_WAIT_S)

    def read() -> bool:
        seen.update(page.evaluate(DECLARED_JS))
        return want <= seen

    wait_for(read, f"the published {sorted(want)} ms motion runs", ENTRANCE_WAIT_S)
    page.evaluate("() => document.getAnimations().forEach(a => { if (Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); })")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})


def off_frame_zero(page: Page) -> None:
    clip(page, 1).focus()
    page.keyboard.press("End")
    expect(playhead(page)).not_to_have_attribute("data-position", "0")
    page.keyboard.press("Escape")


OLD_PAGE_STATE_JS = "el => !el.isConnected ? 'gone' : el.closest('[inert]') ? 'inert' : ''"


def old_page_inert(old: Any) -> None:
    start = time.monotonic()
    state = wait_for(lambda: old.evaluate(OLD_PAGE_STATE_JS), "the old page is inert during the cover", INERT_WAIT_S)
    assert state == "inert" or time.monotonic() - start <= GONE_WAIT_S, "the old page stayed live during the cover, then went"


def next_refresh(page: Page) -> None:
    with page.expect_response(lambda r: "/api/" in r.url and r.request.method == "GET", timeout=REFRESH_WAIT_MS):
        pass


def press(page: Page, button: Locator, fragment: str, *, copy: str | re.Pattern | None = None, via: str = "click",
          working: str = WORKING, after: Locator | None = None, writes: int | None = 1) -> None:
    sent: list[Any] = []

    def listener(request: Any) -> None:
        if fragment in request.url and request.method != "GET":
            sent.append(request)

    page.on("request", listener)
    with held(page, f"**{fragment}**") as hold:
        if via == "tap":
            tap(button)
        elif via == "enter":
            tab_to(page, button)
            page.keyboard.press("Enter")
        else:
            button.click()
        pending = role(page, "button", working).first
        expect(pending).to_be_visible()
        expect(pending).to_have_attribute("aria-disabled", "true")
        assert pending.evaluate("el => !el.hasAttribute('disabled')")
        expect(pending).to_be_focused()
        page.keyboard.press("Enter")
        getattr(hold, "release", hold)()
    expect(role(page, "button", working)).to_have_count(0)
    page.remove_listener("request", listener)
    assert sent and (writes is None or len(sent) == writes), f"expected {writes} write(s) to {fragment}, saw {len(sent)}"
    if copy is not None:
        said(page, copy)
    if after is not None:
        expect(after).to_be_focused()


def problems_region(page: Page, message: str, name: str = "Problems") -> Locator:
    return role(page, "region", name).filter(has_text=message).first


def problems(page: Page, field: Locator, message: str, problems_name: str = "Problems") -> None:
    region = problems_region(page, message, problems_name)
    expect(region).to_contain_text(message)
    expect(field).to_have_attribute("aria-invalid", "true")
    expect(field).to_have_accessible_description(re.compile(re.escape(message)))
    region.get_by_role("link").first.click()
    expect(field).to_be_focused()


def refresh_rules(page: Page, line: str = REFRESH_LINE) -> None:
    mark(h1(page))
    page.keyboard.press("Tab")
    page.evaluate("() => { document.activeElement.__focusMark = true; }")
    before_y = page.evaluate("() => scrollY")
    next_refresh(page)
    assert marked(h1(page)), "a refresh replaced the level-one heading"
    assert page.evaluate("() => document.activeElement.__focusMark === true"), "a refresh moved focus"
    assert page.evaluate("() => scrollY") == before_y
    seen = {"n": 0}

    def fail(route: Any) -> None:
        if route.request.method != "GET":
            route.fallback()
            return
        seen["n"] += 1
        if seen["n"] % 2:
            route.abort()
        else:
            route.fulfill(status=503, json={})

    page.route(re.compile(r"/api/"), fail)
    shown = page.get_by_text(line, exact=True).first
    expect(shown).to_be_visible(timeout=REFRESH_WAIT_MS)
    assert shown.bounding_box()["y"] >= h1(page).bounding_box()["y"] + h1(page).bounding_box()["height"] - 1
    assert page.evaluate("() => document.activeElement.__focusMark === true")
    expect(page.get_by_role("dialog")).to_have_count(0)
    page.unroute(re.compile(r"/api/"))
    expect(page.get_by_text(line, exact=True)).to_have_count(0, timeout=REFRESH_WAIT_MS)
    assert marked(h1(page))


def overlay_rules(browser: Browser, base: str, desk: Desk | None, path: str, opener: tuple[str, str], dialog_name: str,
                  first: tuple[str, str] | None = None, sheet: bool = False, close: str = "Close", rtl: bool = False,
                  live: bool = True) -> None:
    with opened(browser, base, path, desk, size=TABLET if sheet else WIDE) as page:
        button, dialog = role(page, *opener), role(page, "dialog", dialog_name)
        moved = entrance(page, button.click, dialog)
        assert HALF_DIALOG_MS in moved["durations"], moved
        if sheet and rtl:
            assert moved["start"]["left"] < moved["end"]["left"], f"sheet should slide from the left: {moved}"
        elif sheet:
            assert moved["start"]["left"] > moved["end"]["left"], f"sheet should slide from the right: {moved}"
        else:
            assert moved["start"]["width"] < moved["end"]["width"] or moved["start"]["height"] < moved["end"]["height"], moved
            mid_start = moved["start"]["left"] + moved["start"]["width"] / 2
            assert abs(mid_start - (moved["end"]["left"] + moved["end"]["width"] / 2)) <= 2, moved
        if first:
            expect(role(dialog, *first)).to_be_focused()
        else:
            wait_for(lambda: focus_inside(page, dialog), "SR8: focus moves inside on opening", UI_CHECK_S)
        for _ in range(TAB_SWEEP):
            page.keyboard.press("Tab")
            assert focus_inside(page, dialog), "Tab left the dialog"
            assert has_ring(page), "a Tab stop in the dialog shows no ring"
        page.keyboard.press("Shift+Tab")
        assert focus_inside(page, dialog), "Shift+Tab left the dialog"
        boxes = dialog.get_by_role("textbox")
        if live and boxes.count():
            boxes.first.fill("kept through refresh")
            mark(dialog)
            next_refresh(page)
            expect(boxes.first).to_have_value("kept through refresh")
            assert marked(dialog)
            assert not long_animations(page), "a refresh replayed the opening"
        page.evaluate(TIMED_JS)
        page.keyboard.press("Escape")
        wait_for(lambda: is_focused(button), "SR2: focus back on the opener", UI_CHECK_S)
        assert page.evaluate("() => window.__lastFocus - window.__escapeAt") <= OPENER_AT_ONCE_MS, "SR2: focus did not return at once"
        page.keyboard.press("Enter")
        hold_for(page, HOLD_OPEN_S)
        expect(dialog).to_be_visible()
        assert focus_inside(page, dialog), "SR8: focus moves inside on every opening"
        role(dialog, "button", close).click()
        expect(button).to_be_focused()
        expect(dialog).to_have_count(0)
    with opened(browser, base, path, desk, size=PHONE) as page:
        button, dialog = role(page, *opener), role(page, "dialog", dialog_name)
        moved = entrance(page, button.click, dialog)
        assert moved["start"]["top"] > moved["end"]["top"], f"should rise from the bottom: {moved}"
        axe(page)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
    with opened(browser, base, path, desk, size=LANDSCAPE) as page:
        button, dialog = role(page, *opener), role(page, "dialog", dialog_name)
        button.click()
        for _ in range(TAB_SWEEP):
            page.keyboard.press("Tab")
            wait_for(lambda: focused_in_view(page), "a dialog control can be reached at 812x375", UI_CHECK_S)
    with opened(browser, base, path, desk, size=WIDE if not sheet else TABLET, reduced=True) as page:
        button, dialog = role(page, *opener), role(page, "dialog", dialog_name)
        button.click()
        expect(dialog).to_be_visible()
        assert not long_animations(page), "reduced motion must open at once"
        axe(page)
        page.evaluate(TIMED_JS)
        dialog.evaluate(GONE_WATCH_JS)
        page.keyboard.press("Escape")
        assert not long_animations(page), "reduced motion must close at once"
        expect(dialog).to_have_count(0)
        wait_for(lambda: page.evaluate("() => window.__goneAt !== null"), "SR3: the closed panel left the screen", UI_CHECK_S)
        assert page.evaluate("() => window.__goneAt - window.__escapeAt") <= GONE_AT_ONCE_MS, "SR3: the closed panel stayed past 100 ms"
        page.emulate_media(reduced_motion="no-preference")
        moved = entrance(page, button.click, dialog)
        assert HALF_DIALOG_MS in moved["durations"], "turning reduced motion off must apply with no reload"
        page.emulate_media(forced_colors="active")
        page.keyboard.press("Tab")
        assert has_ring(page), "no ring under forced colours"


def page_rules(browser: Browser, base: str, desk: Desk | None, path: str, *, live: bool = True, line: str = REFRESH_LINE) -> None:
    with opened(browser, base, path, desk) as page:
        expect(h1(page)).to_be_visible()
        expect(say(page)).to_have_count(1)
        loaded(page)
        if live:
            refresh_rules(page, line)
        durations_ok(page)
        page.emulate_media(forced_colors="active")
        page.keyboard.press("Tab")
        assert has_ring(page), "no ring under forced colours"
    with opened(browser, base, path, desk, size=LANDSCAPE) as page:
        expect(h1(page)).to_be_visible()
        page.keyboard.press("Tab")
        assert focused_in_view(page), "the focused control is covered at 812x375"


def menu_rules(page: Page, button: Locator, items: list[str]) -> None:
    button.click()
    menu = page.get_by_role("menu")
    expect(menu).to_be_visible()
    for name in items:
        uncut(role(menu, "menuitem", name))
    page.keyboard.press("Escape")
    expect(menu).to_have_count(0)
    expect(button).to_be_focused()


def choose_menu(page: Page, button: Locator, item: str) -> None:
    button.click()
    role(page.get_by_role("menu"), "menuitem", item).click()


def history_length(page: Page) -> int:
    return page.evaluate("() => history.length")


def reach(page: Page, target: Locator, steps: list[str], group: str) -> None:
    def shown() -> bool:
        return target.count() > 0 and target.first.is_visible()

    def walked() -> bool:
        for name in steps:
            if shown():
                return True
            role(role(page, "group", group), "button", name).click()
        return shown()

    wait_for(walked, "the control shows on one of the review page's steps", PRESS_WAIT_S)


def test_wf_desk_access_sign_in_journey(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    with opened(browser, app_url, "/sign-in") as page:
        role(page, "textbox", "Email").fill(desk.email)
        role(page, "textbox", "Password").fill(desk.password)
        role(page, "button", "Sign in").click()
        expect(page).to_have_url(re.compile(r"/desk/jobs$"))
        assert page.context.request.get(app_url + "/api/session").status == 200
        assert page.context.request.post(app_url + "/api/sign-out").status == 204
        assert page.context.request.get(app_url + "/api/session").status == 401


def test_wf_desk_access_password_ends_other_sessions(app_url: str) -> None:
    one = Desk(app_url)
    wrong = "not-the-password"
    assert anon(app_url, "POST", "/api/sign-in", json={"email": one.email, "password": wrong}).status_code == 401
    other = Desk(app_url, one.email)
    assert other.call("GET", "/api/session").status_code == 200
    changed = fresh("changed")[0] + "-2027"
    assert one.call("POST", "/api/password", json={"currentPassword": one.password, "newPassword": changed}).status_code == 204
    assert other.call("GET", "/api/session").status_code == 401
    assert one.call("GET", "/api/session").status_code == 200
    assert anon(app_url, "POST", "/api/sign-in", json={"email": one.email, "password": changed}).status_code == 200
    assert one.call("POST", "/api/sign-out").status_code == 204
    assert one.call("GET", "/api/session").status_code == 401


def test_wf_desk_access_client_lifecycle(app_url: str) -> None:
    desk = Desk(app_url)
    client = desk.client(fresh("client")[0], "ontario")
    path = f"/api/clients/{client['id']}"
    assert desk.call("GET", path).status_code == 200
    assert desk.call("PATCH", path, json={"name": fresh("renamed")[0], "place": "ontario"}).status_code == 200
    assert desk.call("DELETE", path).status_code == 204
    assert desk.call("GET", path).status_code == 404


def test_wf_desk_access_other_desk_is_unknown(app_url: str) -> None:
    mine, theirs = Desk(app_url), Desk(app_url)
    client = theirs.client()
    assert mine.call("GET", f"/api/clients/{unknown_id()}").status_code == 404
    assert mine.call("GET", f"/api/clients/{client['id']}").status_code == 404
    assert mine.call("DELETE", f"/api/clients/{client['id']}").status_code == 404
    assert theirs.call("GET", f"/api/clients/{client['id']}").status_code == 200


def test_wf_public_site_wipe_and_heading(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/") as page:
        at(page, "Boards drawn to the frame")
        expect(role(page, "heading", "Boards drawn to the frame")).to_have_count(1)
        assert page.locator('[data-part="heading-line"]').count() >= 1
        old = h1(page).element_handle()
        cdp = session(page)
        cdp.send("Animation.enable")
        cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
        role(page.get_by_role("banner"), "link", "Reel").click()
        expect(page.locator('[data-part="route-wipe"]')).to_be_attached()
        old_page_inert(old)
        wait_for(lambda: HALF_DIALOG_MS in page.evaluate("() => document.getAnimations().map(a => a.effect.getComputedTiming().duration)"), "the cover runs for its published time", ENTRANCE_WAIT_S)
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
        expect(page).to_have_url(re.compile(r"/reel$"))
        at(page, "Work on the reel")
        expect(h1(page)).to_be_focused()
        expect(page.locator('[data-part="route-wipe"]')).to_have_count(0)
        cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
        role(page.get_by_role("banner"), "link", "How it works").click()
        expect(page.locator('[data-part="route-wipe"]')).to_be_attached()
        page.go_back()
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
        expect(page.locator('[data-part="route-wipe"]')).to_have_count(0)
        expect(page).not_to_have_url(re.compile(r"how-it-works"))
        if page.url.rstrip("/").endswith("/reel"):
            at(page, "Work on the reel")
        else:
            at(page, "Boards drawn to the frame")
            page.goto(f"{app_url}/reel")
            at(page, "Work on the reel")
        page.evaluate("() => scrollTo(0, 120)")
        target = page.evaluate("() => scrollY")
        role(page.get_by_role("banner"), "link", "How it works").click()
        at(page, "How the work runs")
        page.go_back()
        at(page, "Work on the reel")
        wait_for(lambda: page.evaluate("() => scrollY") == target, "Back restores the scroll position")
    with opened(browser, app_url, "/", reduced=True) as page:
        page.evaluate("""() => { window.__wiped = false; new MutationObserver(() => {
          if (document.querySelector('[data-part="route-wipe"]')) window.__wiped = true; }).observe(document.documentElement, {subtree:true, childList:true, attributes:true}); }""")
        role(page.get_by_role("banner"), "link", "Reel").click()
        at(page, "Work on the reel")
        expect(h1(page)).to_be_focused()
        assert page.evaluate("() => window.__wiped") is False, "a wipe played under reduced motion"
        assert not long_animations(page)


def test_wf_public_site_reel_grid_and_strip(browser: Browser, app_url: str) -> None:
    works = '[data-part="work"]'

    def columns(page: Page) -> int:
        return page.evaluate("""s => new Set([...document.querySelectorAll(s)].filter(e => e.getClientRects().length)
          .map(e => Math.round(e.getBoundingClientRect().left))).size""", works)

    with opened(browser, app_url, "/reel") as page:
        expect(page.locator(works)).to_have_count(9)
        for index in range(9):
            mark(page.locator(works).nth(index))
        length = history_length(page)
        group = role(page, "radiogroup", "Kind of work")
        pick(role(group, "radio", "Boards"))
        expect(page).to_have_url(re.compile(r"\?kind=boards$"))
        def showing() -> list[Locator]:
            return [item for item in page.locator(works).all() if item.is_visible()]

        wait_for(lambda: len(showing()) == 3, "three Boards items", 10)
        expect(page.locator("main, body").first).to_contain_text("Ferry at First Light")
        assert history_length(page) == length + 1
        assert all(marked(item) for item in showing()), "kept items were replaced"
        pick(role(group, "radio", "Pitch frames"))
        expect(page).to_have_url(re.compile(r"\?kind=pitchFrames$"))
        page.go_back()
        expect(page).to_have_url(re.compile(r"\?kind=boards$"))
        expect(role(group, "radio", "Boards")).to_be_checked()
        page.go_back()
        expect(role(group, "radio", "All")).to_be_checked()
        for width, height, count in ((1100, 800, 3), (1099, 800, 2), (768, 1024, 2), (375, 812, 1)):
            page.set_viewport_size({"width": width, "height": height})
            wait_for(lambda: columns(page) == count, f"{count} columns at {width} px", 10)
            assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
        page.set_viewport_size(WIDE)
        strip = page.locator('[data-part="client-strip"]')
        running = """el => el.getAnimations({subtree:true}).filter(a => a.effect.getComputedTiming().duration === 64000).map(a => a.playState)"""
        wait_for(lambda: "running" in strip.evaluate(running), "one pass of 64 seconds", 10)
        strip.hover()
        wait_for(lambda: "running" not in strip.evaluate(running), "the strip pauses while hovered", 10)
        page.mouse.move(0, 0)
        wait_for(lambda: "running" in strip.evaluate(running), "the strip goes on when left", 10)
        for name in ("Tidewater Soda", "Kestrel Air", "Oak & Ember Bakers", "Northquay Bank", "Lumen Bicycles", "Saffron Street Foods"):
            expect(role(page, "region", "Clients")).to_contain_text(name)
    with opened(browser, app_url, "/reel", reduced=True) as page:
        strip = page.locator('[data-part="client-strip"]')
        assert "running" not in strip.evaluate("el => el.getAnimations({subtree:true}).map(a => a.playState)")
    with opened(browser, app_url, "/reel", size=PHONE) as page:
        name = page.get_by_text("Tidewater Soda").first
        last = page.get_by_text("Saffron Street Foods").first
        assert name.bounding_box()["y"] != last.bounding_box()["y"], "the strip should wrap into rows at 375"
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")


def test_wf_public_site_accordion_city_copy(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, "/how-it-works") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        first, second = role(page, "button", "From script to frames"), role(page, "button", "Timing the reel")
        expect(first).to_have_attribute("aria-expanded", "false")
        first.click()
        expect(page).to_have_url(re.compile(r"\?open=script$"))
        expect(first).to_have_attribute("aria-expanded", "true")
        mark(first)
        next_panel_names = tab_order(page, 3)
        assert "Copy address" not in next_panel_names[:1]
        second.click()
        expect(page).to_have_url(re.compile(r"\?open=timing$"))
        expect(first).to_have_attribute("aria-expanded", "false")
        expect(second).to_have_attribute("aria-expanded", "true")
        panels = page.evaluate("""() => [...document.querySelectorAll('button[aria-expanded="false"][aria-controls]')].map(b => {
          const p = document.getElementById(b.getAttribute('aria-controls')); return p ? (p.hidden || !p.getClientRects().length || p.hasAttribute('inert')) : true; })""")
        assert all(panels), "a closed accordion panel is still available"
        banner = page.get_by_role("banner")
        role(page, "link", "Toronto").click()
        city = role(page, "heading", "Toronto")
        expect(city).to_be_focused()
        expect(page).to_have_url(re.compile(r"#toronto$"))
        wait_for(lambda: city.bounding_box()["y"] >= banner.bounding_box()["y"] + banner.bounding_box()["height"] - 1, "the city heading lands below the sticky header", 10)
        copy = role(page, "button", "Copy address")
        copy.click()
        said(page, "Address copied.")
        assert page.evaluate("() => navigator.clipboard.readText()") == ARTIST_MAIL
    with opened(browser, app_url, "/how-it-works") as page:
        page.evaluate("() => { navigator.clipboard.writeText = navigator.clipboard.write = () => Promise.reject(new DOMException('refused', 'NotAllowedError')); document.execCommand = () => false; }")
        role(page, "button", "Copy address").click()
        said(page, "Press Ctrl+C to copy the address.")
        assert ARTIST_MAIL in page.evaluate("() => { const a = document.activeElement; return getSelection().toString() || (a.value ? a.value.substring(a.selectionStart, a.selectionEnd) : ''); }")
        expect(page.get_by_role("dialog")).to_have_count(0)
    with opened(browser, app_url, "/how-it-works", size=PHONE) as page:
        banner = page.get_by_role("banner")
        at(page, "How the work runs")
        assert banner.get_attribute("data-solid") != "true"
        page.evaluate("() => scrollTo(0, 23)")
        wait_for(lambda: banner.get_attribute("data-solid") != "true" and page.evaluate("() => scrollY") == 23, "not solid above 24 px", 5)
        page.evaluate("() => scrollTo(0, 24)")
        expect(banner).to_have_attribute("data-solid", "true")
        page.evaluate("() => scrollTo(0, 200)")
        page.reload()
        expect(page.get_by_role("banner")).to_have_attribute("data-solid", "true")


def test_wf_public_site_enquiry_keyboard_touch(browser: Browser, app_url: str, mail: Mailpit) -> None:
    probe = Desk(app_url)
    assert_ladder(probe, "POST", "/api/enquiries", "/api/enquiries", {"name": "Ana Reis"}, auth=False)
    name, email = fresh("enquirer")
    with opened(browser, app_url, "/how-it-works", size=PHONE) as page:
        expect(say(page)).to_have_count(1)
        form = role(page, "form", "Enquiry")
        send = role(form, "button", "Send enquiry")
        tap(send)
        problems(page, role(form, "textbox", "Name"), "Type a name.")
        expect(role(form, "textbox", "Message")).to_have_attribute("aria-invalid", "true")
        assert role(form, "textbox", "Email").get_attribute("autocomplete") == "email"
        tap(role(form, "textbox", "Name"))
        role(form, "textbox", "Name").fill(name)
        role(form, "textbox", "Email").fill(email)
        role(form, "textbox", "Phone").fill("+31 20 555 0100")
        role(form, "textbox", "Message").fill("Do you board a :15?")
        press(page, send, "/api/enquiries", copy="Thanks. I answer within two working days.", via="tap")
    assert len(mail_to(mail, ARTIST_MAIL, f"Enquiry from {name}")) == 1
    other, other_mail = fresh("keyboard")
    with opened(browser, app_url, "/how-it-works") as page:
        form = role(page, "form", "Enquiry")
        tab_to(page, role(form, "textbox", "Name"))
        page.keyboard.type(other)
        page.keyboard.press("Tab")
        page.keyboard.type(other_mail)
        tab_to(page, role(form, "textbox", "Message"), 3)
        page.keyboard.type("Do you board a :15?")
        press(page, role(form, "button", "Send enquiry"), "/api/enquiries", copy="Thanks. I answer within two working days.", via="enter")
    assert len(mail_to(mail, ARTIST_MAIL, f"Enquiry from {other}")) == 1
    page_rules(browser, app_url, None, "/how-it-works", live=False)
    with opened(browser, app_url, "/how-it-works", reduced=True) as page:
        accordion = role(page, "button", "Review and notes")
        accordion.click()
        assert not long_animations(page), "the accordion must open at once under reduced motion"
        expect(page).to_have_url(re.compile(r"\?open=review$"))
    for path in ("/", "/reel", "/how-it-works"):
        sweep(browser, app_url, None, path, None)
    with opened(browser, app_url, "/how-it-works") as page:
        announced_twice(page, role(page, "button", "Copy address").click)
    with opened(browser, app_url, "/reel") as page:
        choice = role(role(page, "radiogroup", "Kind of work"), "radio", "Boards")
        state_mark(page, choice, lambda: pick(choice))


def test_enquiry_mail_and_limit(app_url: str, mail: Mailpit) -> None:
    name, email = fresh("limit")
    body = {"name": name, "email": email, "phone": "+31 20 555 0100", "message": "Do you board a :15?"}
    first = anon(app_url, "POST", "/api/enquiries", json=body)
    assert first.status_code == 202 and first.json() == {"message": "Thanks. I answer within two working days."}
    message = mail_to(mail, ARTIST_MAIL, f"Enquiry from {name}")[0]
    words = text(message)
    for value in body.values():
        assert value in words
    assert "desk@noorbakkerboards.example" in addresses(message.get("From")) or "desk@noorbakkerboards.example" in json.dumps(message.get("From"))
    for _ in range(4):
        assert anon(app_url, "POST", "/api/enquiries", json=body).status_code == 202
    limited = anon(app_url, "POST", "/api/enquiries", json={**body, "email": email.upper()})
    error = assert_error(limited, 429)
    assert re.fullmatch(rf"Too many enquiries from this address for now\. You can send again at {TIME_RE} Amsterdam time\.", error["message"])
    assert limited.headers["retry-after"].isdigit() and int(limited.headers["retry-after"]) > 0
    assert len(mail_to(mail, ARTIST_MAIL, f"Enquiry from {name}", 5)) == 5, "a refused enquiry sent a mail"
    assert anon(app_url, "POST", "/api/enquiries", json={**body, "email": fresh("other")[1]}).status_code == 202
    refused = anon(app_url, "POST", "/api/enquiries", json={"name": name, "email": fresh("nomsg")[1], "message": ""})
    assert "Type your message." in json.dumps(assert_error(refused, 422), ensure_ascii=False)


def test_wf_clients_and_jobs_filters_and_back(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    client, other = desk.client(), desk.client()
    jobs = [desk.job(client["id"], title=f"Job {n:02d}") for n in range(27)]
    desk.job(other["id"], title="Other client job")
    with opened(browser, app_url, "/desk/jobs", desk) as page:
        at(page, "Jobs")
        expect(role(page, "combobox", "Sort by")).to_be_visible()
        length = history_length(page)
        select(role(page, "combobox", "Sort by"), "Title")
        expect(page).to_have_url(re.compile(r"sort=title"))
        assert history_length(page) == length + 1
        select(role(page, "combobox", "Client"), client["name"])
        expect(page).to_have_url(re.compile(rf"client={client['id']}"))
        assert history_length(page) == length + 2
        table = role(page, "region", "Jobs table")
        expect(role(table, "link", "Other client job")).to_have_count(0)
        expect(role(table, "link", "Job 00")).to_be_visible()
        role(page, "link", "Next page").click()
        expect(page).to_have_url(re.compile(r"cursor="))
        link = role(table, "link", LAST_JOB)
        expect(link).to_be_visible()
        address = page.url
        page.evaluate("() => scrollTo(0, 60)")
        y = page.evaluate("() => scrollY")
        link.click()
        heading_is(page, LAST_JOB)
        expect(h1(page)).to_be_focused()
        page.go_back()
        expect(page).to_have_url(address)
        expect(role(page, "region", "Jobs table").get_by_role("link", name=LAST_JOB, exact=True)).to_be_focused()
        assert abs(page.evaluate("() => scrollY") - y) <= 1
        page.go_back()
        expect(page).to_have_url(re.compile(r"sort=title"))
        expect(page).not_to_have_url(re.compile(r"cursor="))
    assert len(jobs) == 27


def test_wf_clients_and_jobs_row_menu_archive(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    client = desk.client()
    for n in range(8):
        desk.job(client["id"], title=f"Row {n}")
    target = desk.job(client["id"], title="Last row", due=plus(today(), 300))
    for size in (PHONE, WIDE):
        with opened(browser, app_url, "/desk/jobs", desk, size=size) as page:
            button = role(page, "button", "Actions for Last row")
            button.scroll_into_view_if_needed()
            menu_rules(page, button, ["Open", "Duplicate", "Archive"])
    with opened(browser, app_url, "/desk/jobs", desk, size=PHONE) as page:
        region = role(page, "region", "Jobs table")
        assert region.get_attribute("tabindex") is not None or region.evaluate("e => e.tabIndex >= 0")
        button = role(page, "button", "Actions for Last row")
        button.scroll_into_view_if_needed()
        button.click()
        item = role(page.get_by_role("menu"), "menuitem", "Archive")
        uncut(item)
        item.click()
        said(page, "Last row archived.")
        expect(h1(page)).to_be_focused()
        expect(role(page, "link", "Last row")).to_have_count(0)
    assert desk.ok("GET", f"/api/jobs/{target['id']}", 200)["state"] == "archived"
    assert target["id"] not in [j["id"] for j in desk.ok("GET", "/api/jobs", 200)["jobs"]]
    assert_error(desk.call("PATCH", f"/api/jobs/{target['id']}", json={"title": "Changed"}), 409, message="This job is archived.")
    copied = staged(desk, frames=2)
    desk.cut(copied.jid)
    twin = desk.ok("POST", f"/api/jobs/{copied.jid}/duplicate", 201)
    assert twin["title"] == f"{copied.job['title']} copy"
    assert [f["number"] for f in desk.board(twin["id"])["frames"]] == [1, 2]
    assert desk.ok("GET", f"/api/jobs/{twin['id']}/cuts", 200)["cuts"] == []


def until_event(page: Page, seen: Callable[[], Any], contract: str, seconds: float) -> None:
    wait_for(lambda: page.evaluate("() => 0") == 0 and seen(), contract, seconds)


def search_pause(page: Page, box: Locator, searches: list[str], words: str) -> None:
    expect(box).to_be_visible()
    loaded(page)
    page.clock.pause_at(page.evaluate("() => Date.now()") / 1000 + PAUSE_LEAD_S)
    fill(box, words)
    advance(page, 299)
    assert not searches, "search asked before the pause ended"
    with page.expect_request(lambda r: "/api/search" in r.url):
        advance(page, AFTER_PAUSE_MS)
    page.clock.resume()


def test_wf_clients_and_jobs_search_latest(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    client = desk.client(name="Lantern Row Films")
    desk.producer(client["id"], name=ZOE)
    desk.job(client["id"], title="Night Ferry")
    desk.job(client["id"], title="Paper Harbour")
    with opened(browser, app_url, "/desk/jobs", desk) as page:
        searches: list[str] = []
        page.on("request", lambda r: searches.append(r.url) if "/api/search" in r.url else None)
        box = role(page, "searchbox", "Search jobs and clients")
        search_pause(page, box, searches, "ferry")
        results = role(page, "list", "Search results")
        expect(results).to_contain_text("Night Ferry")
        said(page, "1 result.")
        count = len(searches)
        fill(box, "")
        advance(page, FLUSH_MS)
        assert len(searches) == count, "an empty box asked the server"
        slow: list[Any] = []

        def hold_first(route: Any) -> None:
            if "q=ferr" in route.request.url and not slow:
                slow.append(route)
            else:
                route.fallback()

        page.route("**/api/search**", hold_first)
        fill(box, "ferr")
        advance(page, FLUSH_MS)
        until_event(page, lambda: slow, "the first search reached the route", 10)
        fill(box, "paper")
        advance(page, FLUSH_MS)
        expect(results).to_contain_text("Paper Harbour")
        slow[0].fallback()
        advance(page, FLUSH_MS)
        expect(results).to_contain_text("Paper Harbour")
        expect(results).not_to_contain_text("Night Ferry")
        page.unroute("**/api/search**")
        fill(box, "zoe orsted")
        advance(page, FLUSH_MS)
        expect(results).to_contain_text(ZOE)
        fill(box, "nothing like this anywhere")
        advance(page, FLUSH_MS)
        said(page, "No results.")


def test_wf_clients_and_jobs_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    client = desk.client()
    job = desk.job(client["id"])
    assert_shape(job)
    assert_ladder(desk, "POST", "/api/jobs", f"/api/jobs/{unknown_id()}/duplicate", {"title": "Night Ferry"})
    due = plus(today(), 21)
    base = {"clientId": client["id"], "title": "Night Ferry", "dueDate": due, "targetSeconds": 30, "frameRate": "25", "aspect": "16:9"}
    assert "That Ad-ID should end in H or D." in json.dumps(assert_error(desk.call("POST", "/api/jobs", json={**base, "adId": "NOOR1234567X"}), 422))
    for bad in ("noor1234567H", "NOOR123456H", "NOOR1234567HH", "N0OR1234567H"):
        words = json.dumps(assert_error(desk.call("POST", "/api/jobs", json={**base, "adId": bad}), 422))
        assert "An Ad-ID has four letters, then seven letters or digits, then H or D." in words, bad
    with opened(browser, app_url, "/desk/jobs", desk) as page:
        tab_to(page, role(page, "button", "New job"))
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "New job")
        expect(role(dialog, "combobox", "Client")).to_be_focused()
        select(role(dialog, "combobox", "Client"), client["name"])
        role(dialog, "textbox", "Title").fill(KEYBOARD_JOB)
        role(dialog, "textbox", "Ad-ID").fill("NOOR1234567X")
        role(dialog, "textbox", "Due date").fill(due)
        select(role(dialog, "combobox", "Target length"), ":30")
        select(role(dialog, "combobox", "Frame rate"), "25")
        select(role(dialog, "combobox", "Aspect"), "16:9")
        role(dialog, "button", "Save").click()
        expect(dialog).to_contain_text("That Ad-ID should end in H or D.")
        expect(role(dialog, "textbox", "Title")).to_have_value(KEYBOARD_JOB)
        assert focus_inside(page, dialog)
        role(dialog, "textbox", "Ad-ID").fill("NOOR1234567H")
        press(page, role(dialog, "button", "Save"), "/api/jobs", copy="Job added.", via="click", after=h1(page))
        expect(page).to_have_url(re.compile(r"/desk/jobs/[0-9a-f-]{36}$"))
        at(page, KEYBOARD_JOB)
    with opened(browser, app_url, "/desk/jobs", desk, size=PHONE) as page:
        filters = role(page, "button", "Filters")
        tap(filters)
        sheet = role(page, "dialog", "Filters")
        expect(sheet).to_be_visible()
        select(role(sheet, "combobox", "Sort by"), "Title")
        expect(page).to_have_url(re.compile(r"sort=title"))
        page.keyboard.press("Escape")
        expect(filters).to_be_focused()
    page_rules(browser, app_url, desk, "/desk/jobs")
    overlay_rules(browser, app_url, desk, "/desk/jobs", ("button", "New job"), "New job", ("combobox", "Client"))
    overlay_rules(browser, app_url, desk, "/desk/jobs", ("button", "Filters"), "Filters", sheet=True, live=False)
    sweep_for(browser, app_url, "jobs")
    other = Desk(app_url)
    mine = other.client()
    with opened(browser, app_url, "/desk/jobs", other) as page:
        role(page, "button", "New job").click()
        dialog = role(page, "dialog", "New job")
        select(role(dialog, "combobox", "Client"), mine["name"])
        role(dialog, "textbox", "Title").fill("Night Ferry")
        role(dialog, "textbox", "Ad-ID").fill("NOOR1234567X")
        role(dialog, "textbox", "Due date").fill(plus(today(), 21))
        select(role(dialog, "combobox", "Target length"), ":30")
        select(role(dialog, "combobox", "Frame rate"), "25")
        select(role(dialog, "combobox", "Aspect"), "16:9")
        announced_twice(page, role(dialog, "button", "Save").click)


def test_jobs_paging_cap_and_cursor(app_url: str) -> None:
    desk = Desk(app_url)
    client = desk.client()
    start = today()
    original = {desk.job(client["id"], title=f"Page {n:02d}", due=plus(start, 40 + n))["id"] for n in range(30)}
    first = desk.ok("GET", "/api/jobs?limit=500", 200)
    assert len(first["jobs"]) == 25 and first["total"] == 30 and first["nextCursor"]
    assert len(desk.ok("GET", "/api/jobs?limit=3", 200)["jobs"]) == 3
    seen: list[str] = []
    cursor = None
    for n in range(10):
        query = "/api/jobs?limit=7" + (f"&cursor={cursor}" if cursor else "")
        page = desk.ok("GET", query, 200)
        seen += [j["id"] for j in page["jobs"]]
        desk.job(client["id"], title=f"New early {n}", due=plus(start, 5 + n))
        desk.job(client["id"], title=f"New late {n}", due=plus(start, 200 + n))
        cursor = page["nextCursor"]
        if not cursor:
            break
    assert len(seen) == len(set(seen)), "a job repeated across pages"
    assert original <= set(seen), "a job present when paging began was skipped"
    titled = desk.ok("GET", "/api/jobs?sort=title&limit=25", 200)["jobs"]
    titles = [j["title"].lower() for j in titled]
    assert titles == sorted(titles)


def test_search_keeps_to_the_desk(app_url: str) -> None:
    mine, theirs = Desk(app_url), Desk(app_url)
    shared = fresh("shared")[0]
    a, b = mine.client(f"{shared} mine"), theirs.client(f"{shared} theirs")
    mine.job(a["id"], title=f"{shared} mine job")
    theirs.job(b["id"], title=f"{shared} theirs job")
    theirs.producer(b["id"], name=f"{shared} theirs producer")
    found = mine.ok("GET", f"/api/search?q={shared}", 200)
    assert found["total"] == 2
    assert "theirs" not in json.dumps(found)
    assert len(found["jobs"]) == 1 and len(found["clients"]) == 1 and not found["producers"]
    assert b["id"] not in [c["id"] for c in mine.ok("GET", "/api/clients", 200)["clients"]]
    jobs = mine.ok("GET", "/api/jobs", 200)
    assert jobs["total"] == 1 and "theirs" not in json.dumps(jobs)
    archived = mine.job(a["id"], title=f"{shared} gone")
    mine.ok("POST", f"/api/jobs/{archived['id']}/archive", 200)
    assert mine.ok("GET", f"/api/search?q={shared} gone", 200)["total"] == 0


BAD_SCRIPT = script_file([
    ("1", "Boat, at dawn", "Gulls", "1.5"),
    ("2", "Harbour", "", "soon"),
    ("", "No shot", "", "1"),
    ("1", "Repeat", "", "1"),
    ("3", "Quay", "", "2"),
], bom=True, crlf=True)


def test_wf_script_breakdown_journey(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=0)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/script", desk) as page:
        at(page, "Script for Night Ferry")
        page.get_by_label("Script file").set_input_files({"name": "script.csv", "mimeType": "text/csv", "buffer": BAD_SCRIPT})
        said(page, "Preview ready: 2 new, 0 matched, 3 refused.")
        preview = role(page, "region", "Script preview")
        for reason in ("Row 3: seconds should be a number such as 1.5.", "Row 4: shot is empty.", "Row 5: shot 1 is already in row 2."):
            expect(preview).to_contain_text(reason)
        assert desk.board(ns.jid)["frames"] == [], "a preview saved something"
        press(page, role(page, "button", "Save"), f"/api/jobs/{ns.jid}/script", copy="Script saved: 2 new, 0 changed.", via="enter")
        frames = desk.board(ns.jid)["frames"]
        assert [f["shot"] for f in frames] == ["1", "3"] and frames[0]["durationFrames"] == 38
        page.get_by_label("Script file").set_input_files({"name": "again.csv", "mimeType": "text/csv", "buffer": BAD_SCRIPT})
        said(page, "Preview ready: 0 new, 2 matched, 3 refused.")


def test_wf_script_breakdown_refusals_and_rates(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    for rate, frames in (("25", 38), ("23.976", 36), ("29.97", 45)):
        ns = staged(desk, rate=rate, frames=0)
        desk.script(ns.jid, [("1", "Boat", "", "1.5")])
        assert desk.board(ns.jid)["frames"][0]["durationFrames"] == frames
    ns = staged(desk, frames=0)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/script", desk, size=PHONE) as page:
        field = page.get_by_label("Script file")
        field.set_input_files({"name": "bad.csv", "mimeType": "text/csv", "buffer": b"a,b\n1,2\n"})
        expect(problems_region(page, "This file needs the header row shot,visual,audio,seconds.")).to_contain_text("This file needs the header row shot,visual,audio,seconds.")
        field.set_input_files({"name": "bad.csv", "mimeType": "text/csv", "buffer": b"shot,visual,audio,seconds\n\xff\xfe,1,2,3\n"})
        expect(problems_region(page, "This file is not UTF-8 text.")).to_contain_text("This file is not UTF-8 text.")
        field.set_input_files({"name": "ok.csv", "mimeType": "text/csv", "buffer": BAD_SCRIPT})
        preview = role(page, "region", "Script preview")
        expect(preview).to_contain_text(ROW_THREE_REASON)
        assert preview.evaluate("e => e.tabIndex >= 0 && ['auto','scroll'].includes(getComputedStyle(e).overflowX)")
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
        save = role(page, "button", "Save")
        top = save.bounding_box()["y"]
        page.evaluate("() => scrollTo(0, document.body.scrollHeight)")
        assert abs(save.bounding_box()["y"] - top) <= 1 and top > PHONE["height"] / 2, "Save is not in the bottom bar"
        press(page, save, f"/api/jobs/{ns.jid}/script", copy="Script saved: 2 new, 0 changed.", via="tap")


def test_wf_script_breakdown_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk)
    assert_shape(desk.board(ns.jid))
    assert_ladder(desk, "POST", f"/api/jobs/{ns.jid}/script", f"/api/jobs/{unknown_id()}/script", multipart=True)
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/script")
    sweep_for(browser, app_url, "script")
    other = Desk(app_url)
    empty = staged(other, frames=0)
    with opened(browser, app_url, f"/desk/jobs/{empty.jid}/script", other) as page:
        field = page.get_by_label("Script file")
        announced_twice(page, lambda: field.set_input_files({"name": "script.csv", "mimeType": "text/csv", "buffer": BAD_SCRIPT}))


def test_script_rows_match_and_stay_exact(app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=0)
    visual = '  Boat, at "dawn"  '
    data = script_file([("7A", visual, FAR_AUDIO, "1.5"), ("7B", "Quay", "", "2")], bom=True, crlf=True)
    preview = desk.ok("POST", f"/api/jobs/{ns.jid}/script/preview", 200, files={"file": ("s.csv", data, "text/csv")})
    assert [r["result"] for r in preview["rows"]] == ["new", "new"] and preview["rows"][0]["row"] == 2
    assert desk.board(ns.jid)["frames"] == []
    saved = desk.ok("POST", f"/api/jobs/{ns.jid}/script", 200, files={"file": ("s.csv", data, "text/csv")})
    assert saved["created"] == 2 and saved["updated"] == 0 and saved["refused"] == 0
    board = desk.board(ns.jid)
    first = board["frames"][0]
    assert first["visual"] == visual and first["actionNote"] == visual and first["audioNote"] == FAR_AUDIO, first
    assert first["durationFrames"] == 38 and first["drawingUrl"] is None
    again = desk.ok("POST", f"/api/jobs/{ns.jid}/script", 200, files={"file": ("s.csv", data, "text/csv")})
    assert again["created"] == 0 and again["updated"] == 0 and again["unchanged"] == 2
    assert desk.board(ns.jid)["stamp"] == board["stamp"], "a file changing nothing moved the stamp"
    changed = script_file([("7A", "Boat again", "", "2"), ("7B", "Quay", "", "2")])
    third = desk.ok("POST", f"/api/jobs/{ns.jid}/script", 200, files={"file": ("s.csv", changed, "text/csv")})
    assert third["updated"] == 1 and third["unchanged"] == 1
    frames = desk.board(ns.jid)["frames"]
    assert len(frames) == 2 and frames[0]["number"] == first["number"] and frames[0]["durationFrames"] == 50
    for bad in (b"\xff\xfe\x00bad", b"no header here\n1,2\n"):
        answer = desk.call("POST", f"/api/jobs/{ns.jid}/script", files={"file": ("s.csv", bad, "text/csv")})
        assert_error(answer, 422)
    over = desk.call("POST", f"/api/jobs/{ns.jid}/script", files={"file": ("s.csv", b"x" * (FILE_LIMIT + 1), "text/csv")})
    assert_error(over, 413)


def row_shows(rows: Locator, name: str, words: str) -> None:
    row = rows.get_by_role("listitem").filter(has_text=name)
    expect(row).to_contain_text(words)


def test_wf_frame_uploads_journey(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=0)
    long_name = "f" * 116 + ".png"
    good, bad = png(101), b"not an image at all"
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}", desk, size=PHONE) as page:
        field = page.get_by_label("Frame files")
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.method) if r.url.endswith("/frames") and r.method == "POST" else None)
        field.set_input_files([
            {"name": long_name, "mimeType": "image/png", "buffer": good},
            {"name": "refused.png", "mimeType": "image/png", "buffer": bad},
            {"name": "wide.png", "mimeType": "image/png", "buffer": png(102, 100, 100)},
        ])
        rows = role(page, "list", "Uploads")
        row_shows(rows, long_name, "Stored")
        row_shows(rows, "refused.png", REFUSED_ROW)
        row_shows(rows, "wide.png", WIDE_ROW)
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), "a long name overflows"
        row = rows.get_by_role("listitem").filter(has_text=long_name)
        assert row.bounding_box()["x"] + row.bounding_box()["width"] <= PHONE["width"]
        assert len(posts) == 3
        role(rows.get_by_role("listitem").filter(has_text="refused.png"), "button", "Try again").click()
        until_event(page, lambda: len(posts) == 4, "Try again resends one file", 10)
        row_shows(rows, "refused.png", REFUSED_ROW)
        expect(page.get_by_role("option", name="Frame 1", exact=True)).to_be_visible()
    sha = hashlib.sha256(good).hexdigest()
    assert S3().get(f"clients/{ns.cid}/jobs/{ns.jid}/frames/{sha}") == good
    assert [f["fileName"] for f in desk.board(ns.jid)["frames"]] == [long_name]
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}", desk) as page:
        tab_to(page, role(page, "button", "Upload frames"))
        expect(role(page, "button", "Upload frames")).to_be_focused()
        page.get_by_label("Frame files").set_input_files({"name": "next.png", "mimeType": "image/png", "buffer": png(103)})
        said(page, "next.png: Stored.")


def test_wf_frame_uploads_outage(browser: Browser) -> None:
    base = os.environ["APP_MINIO_DOWN_URL"]
    desk = Desk(base)
    ns = staged(desk, frames=0)
    outage = "The file store is unavailable right now. Nothing was saved."
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/frames", files={"file": ("a.png", png(5), "image/png")}), 503, message=outage)
    assert desk.board(ns.jid)["frames"] == []
    with opened(browser, base, f"/desk/jobs/{ns.jid}", desk) as page:
        page.get_by_label("Frame files").set_input_files({"name": "down.png", "mimeType": "image/png", "buffer": png(6)})
        rows = role(page, "list", "Uploads")
        row_shows(rows, "down.png", outage)
        said(page, f"down.png: {outage}")
        expect(rows).not_to_contain_text("Stored")
        expect(role(rows, "button", "Try again")).to_be_visible()
    assert desk.board(ns.jid)["frames"] == []


def test_wf_frame_uploads_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=0)
    answer = desk.upload(ns.jid, png(7))
    assert_shape(answer)
    assert_ladder(desk, "POST", f"/api/jobs/{ns.jid}/frames", f"/api/jobs/{unknown_id()}/frames", multipart=True)
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}")
    sweep_for(browser, app_url, "board")
    other = Desk(app_url)
    empty = staged(other, frames=0)
    with opened(browser, app_url, f"/desk/jobs/{empty.jid}", other) as page:
        field = page.get_by_label("Frame files")
        refused = {"name": "refused.png", "mimeType": "image/png", "buffer": b"not an image"}
        announced_twice(page, lambda: field.set_input_files(refused))


def test_frame_files_are_judged(app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=0)
    path = f"/api/jobs/{ns.jid}/frames"
    over = png_of_size(11, FILE_LIMIT + 1)
    assert_error(anon(app_url, "POST", path, files={"file": ("big.png", over, "image/png")}), 413)
    assert "This file is over 8,000,000 bytes." in json.dumps(assert_error(desk.call("POST", path, files={"file": ("big.png", over, "image/png")}), 413))
    assert_error(desk.call("POST", path, files={"file": ("a.png", b"<svg onload='x()'/>", "image/png")}), 422, message="This file is not a PNG or JPEG.")
    assert_error(desk.call("POST", path, files={"file": ("a.jpg", b"GIF89a" + b"0" * 40, "image/jpeg")}), 422, message="This file is not a PNG or JPEG.")
    assert_error(desk.call("POST", path, files={"file": ("a.png", png(12, 100, 100), "image/png")}), 422, message="This frame is 100 x 100. This job is 16:9.")
    assert desk.board(ns.jid)["frames"] == []
    named_wrong = desk.ok("POST", path, 201, files={"file": ("looks.gif", png(13), "image/gif")})
    assert named_wrong["frame"]["width"] == DRAW_W and named_wrong["frame"]["height"] == DRAW_H
    assert named_wrong["frame"]["durationFrames"] == 25
    assert_error(desk.call("POST", path, files={"file": ("again.png", png(13), "image/png")}), 422, message="Already on this board as frame 1.")
    picture = jpeg()
    desk.ok("POST", path, 201, files={"file": ("real.txt", picture, "text/plain")})
    assert S3().get(f"clients/{ns.cid}/jobs/{ns.jid}/frames/{hashlib.sha256(picture).hexdigest()}") == picture
    large = png_of_size(14, ACCEPTED_LARGE)
    extra = "e" * (FILE_LIMIT - ACCEPTED_LARGE + 1000)
    accepted = desk.ok("POST", path, 201, files={"file": ("large.png", large, "image/png")}, data={"note": extra})
    sha = hashlib.sha256(large).hexdigest()
    assert accepted["frame"]["sha256"] == sha
    assert S3().get(f"clients/{ns.cid}/jobs/{ns.jid}/frames/{sha}") == large
    edge = png_of_size(15, FILE_LIMIT)
    desk.ok("POST", path, 201, files={"file": ("edge.png", edge, "image/png")})
    assert_error(desk.call("POST", path, content=b"x" * (UPLOAD_LIMIT + 1), headers={"Content-Type": "multipart/form-data; boundary=x"}), 413)
    gapped = staged(desk, frames=2)
    filled = desk.upload(gapped.jid, png(16))
    assert filled["frame"]["number"] == 1 and desk.board(gapped.jid)["frames"][1]["drawingUrl"] is None
    fetched = desk.call("GET", f"/api/jobs/{gapped.jid}/frames/1/drawing")
    assert fetched.status_code == 200 and fetched.content == png(16)
    assert_error(desk.call("GET", f"/api/jobs/{gapped.jid}/frames/2/drawing"), 404)


def tile(page: Page, number: int) -> Locator:
    return role(page, "option", f"Frame {number}")


def test_wf_board_editor_keyboard(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=4)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}", desk) as page:
        board = role(page, "listbox", "Board")
        expect(board).to_have_attribute("aria-multiselectable", "true")
        tab_to(page, tile(page, 1))
        page.keyboard.press("ArrowRight")
        expect(tile(page, 2)).to_be_focused()
        page.keyboard.press("Tab")
        assert not focus_inside(page, board), "the board has more than one Tab stop"
        page.keyboard.press("Shift+Tab")
        expect(tile(page, 2)).to_be_focused()
        page.keyboard.press("Shift+ArrowRight")
        expect(tile(page, 3)).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Control+a")
        for n in range(1, 5):
            expect(tile(page, n)).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Escape")
        expect(tile(page, 4)).not_to_have_attribute("aria-selected", "true")
        mark(tile(page, 3))
        tile(page, 3).focus()
        expect(tile(page, 3)).to_be_focused()
        expect(tile(page, 3)).to_have_attribute("data-position", "3")
        page.keyboard.press("Alt+ArrowLeft")
        said(page, "Frame 3 moved to position 2 of 4.")
        expect(tile(page, 3)).to_have_attribute("data-position", "2")
        expect(tile(page, 3)).to_have_attribute("data-frame", "3")
        expect(tile(page, 3)).to_be_focused()
        assert marked(tile(page, 3)), "moving replaced the element"
        page.keyboard.press("Alt+ArrowRight")
        said(page, "Frame 3 moved to position 3 of 4.")
        expect(tile(page, 3)).to_be_focused()
        tile(page, 3).click()
        page.keyboard.press("Alt+ArrowLeft")
        said(page, "Frame 3 moved to position 2 of 4.")
    assert [f["number"] for f in desk.board(ns.jid)["frames"]] == [1, 3, 2, 4]
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}", desk) as page:
        tile(page, 1).click()
        tools = role(page, "group", "Frame tools")
        earlier = role(tools, "button", "Move earlier")
        expect(earlier).to_have_attribute("aria-disabled", "true")
        assert earlier.evaluate("el => !el.hasAttribute('disabled')")
        earlier.focus()
        expect(earlier).to_be_focused()
        later = role(tools, "button", "Move later")
        press(page, later, f"/api/jobs/{ns.jid}/frames/1/move", copy="Frame 1 moved to position 2 of 4.", after=later)
        order = [f["number"] for f in desk.board(ns.jid)["frames"]]
        box = tile(page, order[-1]).bounding_box()
        tile(page, order[0]).hover()
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=8)
        page.mouse.up()
        wait_for(lambda: [f["number"] for f in desk.board(ns.jid)["frames"]].index(order[0]) >= len(order) - 2, "a mouse drag moved the frame", 10)


def test_wf_board_editor_stale_and_menu(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=3)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}", desk) as page:
        tile(page, 2).click()
        role(page, "button", "Edit frame 2").click()
        dialog = role(page, "dialog", "Edit frame 2")
        role(dialog, "textbox", "Duration in frames").fill("38")
        role(dialog, "textbox", "Action note").fill(TYPED_NOTE)
        board = desk.board(ns.jid)
        desk.ok("PATCH", f"/api/jobs/{ns.jid}/frames/3", 200, json={"durationFrames": 7, "stamp": board["stamp"]})
        next_refresh(page)
        expect(role(dialog, "textbox", "Action note")).to_have_value(TYPED_NOTE)
        role(dialog, "button", "Save").click()
        message = re.compile(rf"This board was changed at {TIME_RE} Amsterdam time in another window\. Your changes are still here\.")
        expect(dialog).to_contain_text(message)
        expect(role(dialog, "textbox", "Action note")).to_have_value(TYPED_NOTE)
        assert focus_inside(page, dialog)
        next_refresh(page)
        expect(dialog).to_contain_text(message)
        assert desk.board(ns.jid)["frames"][1]["durationFrames"] == 25
        role(dialog, "button", "Close").click()
    assert_error(desk.call("PATCH", f"/api/jobs/{ns.jid}/frames/2", json={"durationFrames": 38, "stamp": board["stamp"]}), 412)
    for size in (PHONE, WIDE):
        with opened(browser, app_url, f"/desk/jobs/{ns.jid}", desk, size=size) as page:
            menu_rules(page, role(page, "button", "Actions for frame 1"), ["Duplicate", "Insert after", "Remove"])
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}", desk) as page:
        choose_menu(page, role(page, "button", "Actions for frame 1"), "Duplicate")
        said(page, "Frame 1 duplicated as frame 4.")
        choose_menu(page, role(page, "button", "Actions for frame 1"), "Insert after")
        said(page, re.compile(r".*Frame \d+ inserted after frame \d+\..*"))
        expect(role(page, "button", "Actions for frame 1")).to_be_focused()
    numbers = [f["number"] for f in desk.board(ns.jid)["frames"]]
    assert sorted(numbers) == [1, 2, 3, 4, 5] and numbers[0] == 1


def test_wf_board_editor_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=3)
    board = desk.board(ns.jid)
    assert_shape(board)
    assert_ladder(desk, "POST", f"/api/jobs/{ns.jid}/frames/1/move", f"/api/jobs/{ns.jid}/frames/999/move", {"position": 2})
    desk.durations(ns.jid, {3: 7})
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/frames/1/move", json={"position": 2, "stamp": board["stamp"]}), 412)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}", desk, size=PHONE) as page:
        tap(tile(page, 2))
        expect(role(page, "button", "Edit frame 2")).to_be_visible()
        later = role(role(page, "group", "Frame tools"), "button", "Move later")
        press(page, later, f"/api/jobs/{ns.jid}/frames/2/move", copy="Frame 2 moved to position 3 of 3.", via="tap", after=later)
    assert [(f["number"], f["position"]) for f in desk.board(ns.jid)["frames"]] == [(1, 1), (3, 2), (2, 3)]
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}")
    overlay_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}", ("button", "Edit job"), "Edit job", ("textbox", "Title"))
    sweep_for(browser, app_url, "board")
    other = Desk(app_url)
    framed = staged(other, frames=2)
    with opened(browser, app_url, f"/desk/jobs/{framed.jid}", other) as page:
        notes = iter(["First action.", "Second action."])

        def save() -> None:
            role(role(page, "group", "Frame tools"), "button", "Edit frame 1").click()
            dialog = role(page, "dialog", "Edit frame 1")
            role(dialog, "textbox", "Action note").fill(next(notes))
            role(dialog, "button", "Save").click()
            expect(dialog).to_have_count(0)

        announced_twice(page, save)
        state_mark(page, tile(page, 2), lambda: (tile(page, 1).focus(), page.keyboard.press("Shift+ArrowRight")))


def test_undo_window(browser: Browser) -> None:
    base = os.environ["APP_SHORT_URL"]
    desk = Desk(base)
    ns = staged(desk, frames=4)
    removal = desk.ok("POST", f"/api/jobs/{ns.jid}/removals", 201, json={"frame": 2, "stamp": desk.board(ns.jid)["stamp"]})
    assert removal["position"] == 2 and INSTANT.match(removal["endsAt"])
    assert 2 not in [f["number"] for f in desk.board(ns.jid)["frames"]], "a refresh brought the frame back"
    assert [r["frame"] for r in desk.ok("GET", f"/api/jobs/{ns.jid}/removals", 200)["removals"]] == [2]
    held_answer = desk.ok("POST", f"/api/jobs/{ns.jid}/removals/2/hold", 200)
    assert held_answer["endsAt"] >= removal["endsAt"]
    restored = desk.ok("POST", f"/api/jobs/{ns.jid}/removals/2/undo", 200)
    assert [f["number"] for f in restored["frames"]] == [1, 2, 3, 4]
    desk.ok("POST", f"/api/jobs/{ns.jid}/removals", 201, json={"frame": 3, "stamp": desk.board(ns.jid)["stamp"]})
    wait_for(lambda: not desk.ok("GET", f"/api/jobs/{ns.jid}/removals", 200)["removals"],
             "the server ends the window with no page open", 20)
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/removals/3/undo"), 409, message="The time to undo has passed.")
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/removals/3/hold"), 409)
    assert [f["number"] for f in desk.board(ns.jid)["frames"]] == [1, 2, 4]
    with opened(browser, base, f"/desk/jobs/{ns.jid}", desk) as page:
        tile(page, 2).click()
        choose_menu(page, role(page, "button", "Actions for frame 2"), "Remove")
        said(page, "Frame 2 removed.")
        undo = role(page, "button", "Undo")
        first_end = desk.ok("GET", f"/api/jobs/{ns.jid}/removals", 200)["removals"][0]["endsAt"]
        undo.hover()

        def renewed_past() -> bool:
            windows = desk.ok("GET", f"/api/jobs/{ns.jid}/removals", 200)["removals"]
            assert windows, "holding Undo did not keep the window"
            start = datetime.datetime.strptime(first_end, "%Y-%m-%dT%H:%M:%SZ")
            return datetime.datetime.strptime(windows[0]["endsAt"], "%Y-%m-%dT%H:%M:%SZ") >= start + datetime.timedelta(seconds=7)

        wait_for(renewed_past, "holding Undo renews the window past UNDO_SECONDS", 20)
        undo.click()
        said(page, "Frame 2 is back.")
        expect(tile(page, 2)).to_be_focused()
        expect(tile(page, 2)).to_have_attribute("data-position", "2")
    assert [f["number"] for f in desk.board(ns.jid)["frames"]] == [1, 2, 4]


def playhead(page: Page) -> Locator:
    return page.locator('[data-part="playhead"]')


def clip(page: Page, number: int) -> Locator:
    return role(page, "button", f"Frame {number}")


def test_wf_reel_timeline_keyboard(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=3, seconds="1", target=6)
    desk.durations(ns.jid, {1: 20, 2: 30, 3: 40})
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/reel", desk, reduced=True) as page:
        at(page, "Reel for Night Ferry")
        expect(page.locator('[data-part="clip"]')).to_have_count(3)
        assert abs(clip(page, 2).bounding_box()["width"] - 60) <= 1
        expect(clip(page, 2)).to_have_attribute("data-duration", "30")
        expect(clip(page, 2)).to_have_attribute("data-frame", "2")
        assert clip(page, 2).inner_text().strip() == ""
        expect(page.locator('[data-part="seconds"]')).to_have_text(NINETY_SECONDS)
        expect(page.locator('[data-part="target"]')).to_have_text("60 frames under")
        tab_to(page, clip(page, 1))
        expect(clip(page, 1)).to_have_attribute("aria-current", "true")
        expect(playhead(page)).to_have_attribute("data-position", "0")
        x0 = playhead(page).bounding_box()["x"]
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        expect(playhead(page)).to_have_attribute("data-position", "5")
        expect(page.locator('[data-part="timecode"]')).to_have_text(FIFTH_TIMECODE)
        assert abs(playhead(page).bounding_box()["x"] - x0 - 10) <= 1
        page.keyboard.press("Shift+ArrowRight")
        expect(playhead(page)).to_have_attribute("data-position", "30")
        expect(clip(page, 2)).to_have_attribute("aria-current", "true")
        expect(clip(page, 2)).to_be_focused()
        page.keyboard.press("Tab")
        assert not focus_inside(page, role(page, "group", "Slate strip")), "the strip has more than one Tab stop"
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("End")
        expect(playhead(page)).to_have_attribute("data-position", "89")
        page.keyboard.press("Home")
        expect(playhead(page)).to_have_attribute("data-position", "0")
        page.keyboard.press("]")
        said(page, "Frame 1 is now 21 frames.")
        page.keyboard.press("Shift+]")
        said(page, "Frame 1 is now 46 frames.")
        page.keyboard.press("Shift+[")
        said(page, "Frame 1 is now 21 frames.")
        page.keyboard.press("[")
        said(page, "Frame 1 is now 20 frames.")
        expect(page.locator('[data-part="target"]')).to_have_text("60 frames under")
        for left in range(19, 0, -1):
            page.keyboard.press("[")
            said(page, ONE_FRAME_TRIM if left == 1 else f"Frame 1 is now {left} frames.")
            expect(clip(page, 1)).to_have_attribute("data-duration", str(left))
        said(page, ONE_FRAME_TRIM)
        page.keyboard.press("[")
        expect(clip(page, 1)).to_have_attribute("data-duration", "1")
        wait_for(lambda: desk.board(ns.jid)["frames"][0]["durationFrames"] == 1, "a clip never under 1 frame", 15)
        page.keyboard.press("Space")
        expect(role(page, "button", "Pause")).to_be_visible()
        page.keyboard.press("Space")
        expect(role(page, "button", "Play")).to_be_visible()
        position = int(playhead(page).get_attribute("data-position"))
        frames = position % 25
        seconds = position // 25
        expect(page.locator('[data-part="timecode"]')).to_have_text(f"00:00:{seconds:02d}:{frames:02d}")
        page.keyboard.press("Home")
        page.keyboard.press("Enter")
        large = role(page, "dialog", "Frame 1")
        expect(large).to_be_visible()
        expect(large.locator('[data-part="frame-large"]').or_(page.locator('[data-part="frame-large"]')).first).to_be_attached()
        page.keyboard.press("Escape")
        expect(clip(page, 1)).to_be_focused()
        tip = page.get_by_role("tooltip")
        expect(tip).to_contain_text(FIRST_CLIP_TIP)
        page.keyboard.press("Escape")
        expect(tip).to_have_count(0)
        expect(clip(page, 1)).to_be_focused()
    desk.durations(ns.jid, {1: 75, 2: 40, 3: 35})
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/reel", desk, reduced=True) as page:
        expect(page.locator('[data-part="target"]')).to_have_text("exact")
        clip(page, 2).hover()
        tip = page.get_by_role("tooltip")
        expect(tip).to_contain_text(SECOND_CLIP_TIP)
        tip.hover()
        expect(tip).to_be_visible()


def test_wf_reel_timeline_touch_and_scrub(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=8)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/reel", desk, size=PHONE) as page:
        later, play, earlier = role(page, "button", "Later"), role(page, "button", "Play"), role(page, "button", "Earlier")
        for control in (earlier, play, later):
            box = control.bounding_box()
            assert box["y"] > PHONE["height"] / 2 and box["y"] + box["height"] <= PHONE["height"]
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
        tap(later)
        expect(playhead(page)).to_have_attribute("data-position", "1")
        tap(earlier)
        expect(playhead(page)).to_have_attribute("data-position", "0")
        clip(page, 1).focus()
        page.keyboard.press("End")
        expect(clip(page, 8)).to_have_attribute("aria-current", "true")
        wait_for(lambda: clip(page, 8).evaluate("""el => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth; }"""), "the playhead's clip stays in view", 10)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/reel", desk) as page:
        strip_box = role(page, "group", "Slate strip").bounding_box()
        box = clip(page, 1).bounding_box()
        page.mouse.move(box["x"] + 10, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + 60, strip_box["y"] + strip_box["height"] + 80, steps=4)
        wait_for(lambda: int(playhead(page).get_attribute("data-position")) > 10, "scrubbing goes on outside the strip", 10)
        page.mouse.up()
        hold_for(page, SHEET_SETTLE_S)
        here = playhead(page).get_attribute("data-position")
        page.mouse.move(box["x"] + 200, strip_box["y"] + strip_box["height"] + 80, steps=2)
        hold_for(page, SHEET_SETTLE_S)
        expect(playhead(page)).to_have_attribute("data-position", here)


def test_wf_reel_timeline_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=2, rate="23.976")
    desk.durations(ns.jid, {1: 96, 2: 24})
    board = desk.board(ns.jid)
    assert board["secondsText"] == "5.01 s" and board["totalFrames"] == 120
    assert_shape(board)
    assert_ladder(desk, "PATCH", f"/api/jobs/{ns.jid}/frames/1", f"/api/jobs/{ns.jid}/frames/999", {"durationFrames": 3}, invalid=False)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/reel", desk) as page:
        expect(page.locator('[data-part="seconds"]')).to_have_text("5.01 s")
        clip(page, 1).focus()
        page.route(f"**/api/jobs/{ns.jid}/frames/1", lambda route: (desk.durations(ns.jid, {2: 25}), route.fallback())[1] if route.request.method == "PATCH" else route.fallback())
        page.keyboard.press("]")
        said(page, re.compile(rf".*This board was changed at {TIME_RE} Amsterdam time in another window\. Your changes are still here\..*"))
        page.unroute(f"**/api/jobs/{ns.jid}/frames/1")
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/reel")
    sweep_for(browser, app_url, "reel")
    other = Desk(app_url)
    framed = staged(other, frames=2)
    with opened(browser, app_url, f"/desk/jobs/{framed.jid}/reel", other) as page:
        choice = role(role(page, "radiogroup", "Frame rate"), "radio", "29.97")
        state_mark(page, choice, lambda: pick(choice))


def test_timecode_and_length_arithmetic(app_url: str) -> None:
    desk = Desk(app_url)

    def timecode_after(ns: types.SimpleNamespace, frames: int) -> str:
        desk.durations(ns.jid, {1: frames})
        cut = desk.cut(ns.jid)
        _, token = review(desk, ns, cut["number"])
        answer = anon(app_url, "GET", f"/api/r/{token}").json()
        return answer["frames"][1]["timecodeIn"]

    drop = staged(desk, rate="29.97", frames=2)
    for frames, code in ((899, "00:00:29;29"), (900, "00:00:30;00"), (1799, "00:00:59;29"), (1800, "00:01:00;02"),
                         (3598, "00:02:00;02"), (17981, "00:09:59;29"), (17982, "00:10:00;00")):
        assert timecode_after(drop, frames) == code, frames
    film = staged(desk, rate="23.976", frames=2)
    assert timecode_after(film, 720) == "00:00:30:00"
    pal = staged(desk, rate="25", frames=2)
    assert timecode_after(pal, 750) == "00:00:30:00"
    for rate, frames, seconds in (("23.976", 120, "5.01 s"), ("23.976", 180, "7.51 s")):
        ns = staged(desk, rate=rate, frames=1)
        desk.durations(ns.jid, {1: frames})
        assert desk.board(ns.jid)["secondsText"] == seconds
    for rate, total in (("25", 750), ("23.976", 720), ("29.97", 900)):
        ns = staged(desk, rate=rate, frames=1)
        board = desk.board(ns.jid)
        assert board["targetFrames"] == total
        desk.durations(ns.jid, {1: total})
        assert desk.board(ns.jid)["targetText"] == "exact"
        desk.durations(ns.jid, {1: total + 1})
        assert desk.board(ns.jid)["targetText"] == ONE_OVER
        desk.durations(ns.jid, {1: total - 2})
        assert desk.board(ns.jid)["targetText"] == "2 frames under"
    for new_rate, frames in (("23.976", 36), ("29.97", 46)):
        ns = staged(desk, frames=2)
        desk.durations(ns.jid, {1: 38})
        answer = desk.ok("POST", f"/api/jobs/{ns.jid}/frame-rate", 200, json={"frameRate": new_rate, "playhead": 38, "stamp": desk.board(ns.jid)["stamp"]})
        assert answer["frames"][0]["durationFrames"] == frames and answer["playhead"] == frames
        assert answer["frameRate"] == new_rate
    ns = staged(desk, frames=1)
    desk.durations(ns.jid, {1: 1})
    before_change = desk.board(ns.jid)["stamp"]
    tiny = desk.ok("POST", f"/api/jobs/{ns.jid}/frame-rate", 200, json={"frameRate": "23.976", "playhead": 0, "stamp": before_change})
    assert tiny["frames"][0]["durationFrames"] >= 1
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/frame-rate", json={"frameRate": "25", "playhead": 0, "stamp": before_change}), 412)


def test_strip_motion(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=3)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/reel", desk) as page:
        for n in (1, 2, 3):
            mark(clip(page, n))
        clip(page, 1).focus()
        trim_travel(page, role(page, "group", "Slate strip"), clip(page, 2), lambda: page.keyboard.press("]"))
        assert marked(clip(page, 2)) and marked(clip(page, 3)), "trim replaced later clips"
        off_frame_zero(page)
        cdp = session(page)
        cdp.send("Animation.enable")
        cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
        pick(role(role(page, "radiogroup", "Frame rate"), "radio", "29.97"))
        wait_for(lambda: {320, 640} <= set(finite_animations(page)), "widths and numerals in 320 ms, the playhead in 640 ms", 10)
        width = clip(page, 1).bounding_box()["width"]
        pick(role(role(page, "radiogroup", "Frame rate"), "radio", "25"))
        wait_for(lambda: finite_animations(page), "a second change carries on", 5)
        carried = clip(page, 1).bounding_box()["width"]
        assert abs(carried - width) <= 8, f"the width jumped from {width} to {carried}"
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
        expect(clip(page, 1)).to_have_attribute("data-duration", re.compile(r"^\d+$"))
        wait_for(lambda: not finite_animations(page), "the motion ends", 10)
        next_refresh(page)
        assert not long_animations(page), "a refresh with no new data started motion"
        assert marked(clip(page, 1)) and marked(clip(page, 3)), "a refresh replaced a clip"
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/reel", desk, reduced=True) as page:
        clip(page, 1).focus()
        before = clip(page, 2).bounding_box()["x"]
        page.keyboard.press("]")
        wait_for(lambda: clip(page, 2).bounding_box()["x"] != before, "the trim shows at once", 5)
        assert not long_animations(page), "reduced motion must not animate the strip"
        pick(role(role(page, "radiogroup", "Frame rate"), "radio", "23.976"))
        said(page, "Frame rate is now 23.976.")
        assert not long_animations(page)
        role(page, "button", "Play").click()
        wait_for(lambda: int(playhead(page).get_attribute("data-position")) > 0, "playback still steps under reduced motion", 10)
        role(page, "button", "Pause").click()


def line_text_kept(page: Page, text: str) -> bool:
    form = role(page, "textbox", "Line text")
    return (form.count() > 0 and form.input_value() == text) or text in page.locator('[data-part="line"]').all_inner_texts()


def test_wf_on_screen_lines_journey(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=2)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/lines", desk) as page:
        at(page, "Lines for Night Ferry")
        role(page, "button", "Add line").click()
        role(page, "textbox", "Line text").fill("Go")
        for name, value in (("X", "10"), ("Y", "70"), ("Width", "60"), ("Height", "10"), ("Clips", "1")):
            role(page, "textbox", name).fill(value)
        length = history_length(page)
        group = role(page, "radiogroup", "Market")
        pick(role(group, "radio", "nl"))
        expect(page).to_have_url(re.compile(r"market=nl"))
        assert history_length(page) == length + 1
        role(page, "button", "Add line").click() if not page.locator('[data-part="line"]').count() else None
        role(page, "textbox", "Line text").fill("Ga")
        page.go_back()
        expect(page).to_have_url(re.compile(r"market=en|lines$"))
        wait_for(lambda: line_text_kept(page, "Go"), "the text typed in the first market is still there", UI_CHECK_S)
        assert desk.ok("GET", f"/api/jobs/{ns.jid}/lines", 200)["lines"] == [], "typed text was saved before Save"
        lines, save = page.locator('[data-part="line"]'), role(page, "button", "Save")
        saved_first = lines.count() == 0
        if saved_first:
            press(page, save, f"/api/jobs/{ns.jid}/lines", copy="Line saved.", writes=None)
            expect(lines).to_have_count(1)
        line = lines.first
        line.focus()
        page.keyboard.press("ArrowRight")
        expect(line).to_have_attribute("data-x", re.compile(r"^11(\.0)?$"))
        page.keyboard.press("Shift+ArrowDown")
        expect(line).to_have_attribute("data-y", re.compile(r"^80(\.0)?$"))
        page.keyboard.press("Shift+ArrowUp")
        box = line.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2 + 30, box["y"] + box["height"] / 2, steps=4)
        page.mouse.up()
        wait_for(lambda: float(line.get_attribute("data-x")) > 11, "a drag moves the line", 5)
        if not save.is_visible():
            line.click()
        if not saved_first:
            press(page, save, f"/api/jobs/{ns.jid}/lines", copy="Line saved.", writes=None)
        elif save.is_visible():
            save.click()

        def stored() -> bool:
            saved = desk.ok("GET", f"/api/jobs/{ns.jid}/lines?market=en", 200)["lines"]
            return len(saved) == 1 and saved[0]["text"] == "Go" and saved[0]["x"] > 11

        wait_for(stored, "the moved line is stored", 10)
    desk.ok("POST", f"/api/jobs/{ns.jid}/lines", 201, json={"frame": 1, "market": "ar", "text": "من اليوم", "x": 10, "y": 70, "width": 60, "height": 10, "clips": 1})
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/lines?market=ar", desk) as page:
        line = page.locator('[data-part="line"]').first
        expect(line).to_have_attribute("dir", "rtl")
        assert line.evaluate("e => ['right','end','start'].includes(getComputedStyle(e).textAlign)")
        assert line.evaluate("e => getComputedStyle(e).direction") == "rtl"


def test_wf_on_screen_lines_refusals(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=2)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/lines", desk, size=PHONE) as page:
        tap(role(page, "button", "Add line"))
        role(page, "textbox", "Line text").fill("")
        tap(role(page, "button", "Save"))
        problems(page, role(page, "textbox", "Line text"), "Type the line's text.")
        role(page, "textbox", "Line text").fill("One two three four five")
        for name, value in (("X", "1.5"), ("Y", "70"), ("Width", "60"), ("Height", "10"), ("Clips", "1")):
            role(page, "textbox", name).fill(value)
        tap(role(page, "button", "Save"))
        expect(problems_region(page, "This line runs outside the safe area by 3.5%.")).to_contain_text("This line runs outside the safe area by 3.5%.")
        role(page, "textbox", "X").fill("10")
        tap(role(page, "button", "Save"))
        expect(problems_region(page, "This line needs 42 frames on screen. It has 25.")).to_contain_text("This line needs 42 frames on screen. It has 25.")
        role(page, "textbox", "Clips").fill("2")
        press(page, role(page, "button", "Save"), f"/api/jobs/{ns.jid}/lines", copy="Line saved.", via="tap")
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/lines?market=en", 200)["lines"][0]["clips"] == 2


def test_wf_on_screen_lines_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=1)
    created = desk.ok("POST", f"/api/jobs/{ns.jid}/lines", 201, json={"frame": 1, "market": "nl", "text": "Vanaf", "x": 10, "y": 70, "width": 60, "height": 10, "clips": 1})
    assert_shape(created)
    assert_ladder(desk, "POST", f"/api/jobs/{ns.jid}/lines", f"/api/jobs/{unknown_id()}/lines", {"frame": 1})
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/lines?market=nl", desk) as page:
        page.locator('[data-part="line"]').first.click()
        press(page, role(page, "button", "Remove line"), f"/api/lines/{created['id']}", copy="Line removed.", via="enter")
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/lines?market=nl", 200)["lines"] == []
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/lines")
    sweep_for(browser, app_url, "lines")
    other = Desk(app_url)
    framed = staged(other, frames=1)
    with opened(browser, app_url, f"/desk/jobs/{framed.jid}/lines", other) as page:
        choice = role(role(page, "radiogroup", "Market"), "radio", "nl")
        state_mark(page, choice, lambda: pick(choice))


def test_line_geometry_and_reading_time(app_url: str) -> None:
    desk = Desk(app_url)
    words = "One two three four five"
    for rate, needed, per_clip in (("25", 42, 25), ("23.976", 40, 24), ("29.97", 50, 30)):
        ns = staged(desk, frames=3, rate=rate)
        line = {"frame": 1, "market": "en", "text": words, "x": 10, "y": 70, "width": 60, "height": 10, "clips": 1}
        path = f"/api/jobs/{ns.jid}/lines"
        assert_error(desk.call("POST", path, json=line), 422, message=f"This line needs {needed} frames on screen. It has {per_clip}.")
        assert_error(desk.call("POST", path, json={**line, "x": 1.5}), 422, message="This line runs outside the safe area by 3.5%.")
        assert desk.ok("GET", f"{path}?market=en", 200)["lines"] == []
        created = desk.ok("POST", path, 201, json={**line, "clips": 2})
        assert created["clips"] == 2
        assert_error(desk.call("POST", path, json={**line, "text": "One", "frame": 3, "clips": 2}), 422, message="This line runs past the last frame.")
        moved = desk.call("PATCH", f"/api/lines/{created['id']}", json={**line, "clips": 2, "y": 96.04})
        assert_error(moved, 422)
        assert "safe area" in moved.json()["error"]["message"]
    ns = staged(desk, frames=1)
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/lines", json={"frame": 1, "market": "en", "text": "", "x": 10, "y": 70, "width": 60, "height": 10, "clips": 1}), 422)


def fill_cue(dialog: Locator, market: str, start: str, end: str) -> None:
    select(role(dialog, "combobox", "Market"), market)
    role(dialog, "textbox", "From").fill(start)
    role(dialog, "textbox", "Until").fill(end)


def listed_options(page: Page) -> Locator:
    return page.get_by_role("listbox").get_by_role("option")


OUTSIDE_LIST_JS = """d => { const c = d.cloneNode(true); c.querySelectorAll('[role="listbox"]').forEach(l => l.remove());
  return c.textContent + ' ' + [...d.querySelectorAll('input,textarea')].map(i => i.value).join(' '); }"""


def track_chosen(dialog: Locator, title: str) -> bool:
    return title in dialog.evaluate(OUTSIDE_LIST_JS)


def is_full_height(sheet: Locator) -> bool:
    rect = sheet.bounding_box()
    return bool(rect) and rect["height"] >= PHONE["height"] - 1 and rect["y"] <= 1


def test_wf_music_cues_journey(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=1)
    start = today()
    term = uuid.uuid4().hex[:8]
    wiremock.stub("GET", "/v2/tracks", json={"tracks": [{"id": "hr-1001", "title": "Lantern Street", "composer": "Ilse Voss", "seconds": 30}], "nextCursor": NEXT_CURSOR})
    wiremock.stub("GET", "/v2/tracks", query={"cursor": NEXT_CURSOR}, json={"tracks": [{"id": "hr-1003", "title": "Paper Harbour", "composer": "Mina Oduya", "seconds": 60}], "nextCursor": None})
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cues", desk) as page:
        role(page, "button", "Add cue").click()
        dialog = role(page, "dialog", "Add cue")
        box = role(dialog, "combobox", "Search the library")
        expect(box).to_be_focused()
        slow: list[Any] = []

        def hold_first(route: Any) -> None:
            if f"q={term}first" in route.request.url and not slow:
                slow.append(route)
            else:
                route.fallback()

        page.route("**/api/cues/search**", hold_first)
        box.fill(f"{term}first")
        until_event(page, lambda: slow, "the earlier search reached the route", 10)
        box.fill(f"{term}next")
        option = page.get_by_role("option", name="Lantern Street · Ilse Voss · 30 s", exact=True)
        expect(option).to_be_visible()
        slow[0].fulfill(json={"tracks": [{"id": "hr-1002", "title": "Tidal Grid", "composer": "Joost Amani", "seconds": 15}], "nextCursor": None})
        expect(page.get_by_role("option", name="Tidal Grid · Joost Amani · 15 s", exact=True)).to_have_count(0)
        expect(option).to_be_visible()
        page.unroute("**/api/cues/search**")
        more = page.get_by_role("option", name="More results", exact=True)
        uncut(more)
        box.focus()
        key_to_option(page, "More results")
        expect(page.get_by_role("option", name="Paper Harbour · Mina Oduya · 60 s", exact=True)).to_be_visible()
        assert any(f"cursor={NEXT_CURSOR}" in journal_url(e) for e in wiremock.requests("/v2/tracks")), "More results did not send the cursor"
        box.fill(f"{term}again")
        expect(option).to_be_visible()
        key_to_option(page, "Lantern Street", "ArrowUp")
        wait_for(lambda: track_chosen(dialog, "Lantern Street"), "Enter chooses the track", 5)
        box.fill(f"{term}next")
        expect(option).to_be_visible()
        page.keyboard.press("Escape")
        expect(listed_options(page)).to_have_count(0)
        expect(dialog).to_be_visible()
        box.fill(f"{term}chosen")
        expect(option).to_be_visible()
        key_to_option(page, "Lantern Street")
        fill_cue(dialog, "NL", plus(start, 1), plus(start, 30))
        press(page, role(dialog, "button", "Save"), f"/api/jobs/{ns.jid}/cues", copy="Cue added: Lantern Street.")
        expect(role(page, "button", "Add cue")).to_be_focused()
    cue = desk.ok("GET", f"/api/jobs/{ns.jid}/cues", 200)["cues"][0]
    assert cue["licenceId"] == "lic-501" and cue["fee"] == "120.00"
    licences = wiremock.requests("/v2/licences", "POST")
    assert any(journal_body(e) == {"trackId": "hr-1001", "market": "NL", "from": plus(start, 1), "until": plus(start, 30), "fee": "120.00"} for e in licences)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cues", desk) as page:
        press(page, role(page, "button", "Remove cue Lantern Street"), f"/api/jobs/{ns.jid}/cues/{cue['id']}", copy="Cue removed: Lantern Street.")
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cues", desk, size=PHONE) as page:
        tap(role(page, "button", "Add cue"))
        dialog = role(page, "dialog", "Add cue")
        expect(dialog).to_be_visible()
        wait_for(lambda: is_full_height(dialog), "the sheet ends up full height at 375, however it rises", ENTRANCE_WAIT_S)


def test_wf_music_cues_library_failure(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=1)
    start = today()
    wiremock.fault("POST", "/v2/licences")
    outage = "The music library is unavailable right now. Your cue stays."
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cues", desk) as page:
        role(page, "button", "Add cue").click()
        dialog = role(page, "dialog", "Add cue")
        role(dialog, "combobox", "Search the library").fill(uuid.uuid4().hex[:8])
        page.get_by_role("option", name="Tidal Grid · Joost Amani · 15 s", exact=True).click()
        fill_cue(dialog, "US", plus(start, 1), plus(start, 2))
        role(dialog, "button", "Save").click()
        expect(dialog).to_contain_text(outage)
        expect(role(dialog, "textbox", "Until")).to_have_value(plus(start, 2))
        role(dialog, "textbox", "Until").fill(start)
        role(dialog, "textbox", "From").fill(plus(start, 3))
        role(dialog, "button", "Save").click()
        expect(dialog).to_contain_text("The licence ends before it starts.")
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/cues", 200)["cues"] == []
    body = {"trackId": "hr-1002", "title": "Tidal Grid", "composer": "Joost Amani", "seconds": 15, "market": "US", "from": plus(start, 1), "until": plus(start, 2)}
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/cues", json=body), 503, message=outage)
    wiremock.stub("POST", "/v2/licences", status=201, json={"licenceId": "lic-501"})
    wiremock.stub("GET", "/v2/prices", json={"prices": [{"validFrom": plus(start, 2), "perMarket": "500.00"}]})
    sent = len(wiremock.requests("/v2/licences", "POST"))
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/cues", json=body), 503, message=outage)
    assert len(wiremock.requests("/v2/licences", "POST")) == sent, "a licence was asked for with no price in effect"
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/cues", 200)["cues"] == []


def test_wf_music_cues_device_clock(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=1)
    start = today()
    cases = {plus(start, 3): "Licence ends in 3 days", plus(start, 1): "Licence ends in 1 day", start: "Licence ends today"}
    for until, copy in cases.items():
        cue = desk.ok("POST", f"/api/jobs/{ns.jid}/cues", 201, json={"trackId": "hr-1001", "title": f"Track {until}", "composer": "Ilse Voss", "seconds": 30, "market": "NL", "from": plus(start, -9), "until": until})
        assert cue["licenceText"] == copy
    ended = desk.ok("POST", f"/api/jobs/{ns.jid}/cues", 201, json={"trackId": "hr-1001", "title": "Track ended", "composer": "Ilse Voss", "seconds": 30, "market": "NL", "from": plus(start, -9), "until": plus(start, -1)})
    assert re.fullmatch(rf"Licence ended on {pretty_re(plus(start, -1))}\.", ended["licenceText"])
    with opened(browser, app_url, "/api/health", desk) as page:
        page.clock.set_fixed_time(f"{plus(start, 40)}T12:00:00Z")
        page.goto(f"{app_url}/desk/jobs/{ns.jid}/cues")
        for copy in cases.values():
            expect(page.locator("body")).to_contain_text(copy)
        expect(page.locator("body")).to_contain_text(ended["licenceText"])


def test_wf_music_cues_screen_rules(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=1)
    assert_ladder(desk, "POST", f"/api/jobs/{ns.jid}/cues", f"/api/jobs/{unknown_id()}/cues", {"market": "NL"})
    calls = len(wiremock.requests("/v2/tracks"))
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cues", desk) as page:
        role(page, "button", "Add cue").click()
        dialog = role(page, "dialog", "Add cue")
        role(dialog, "combobox", "Search the library").fill("")
        expect(dialog).to_be_visible()
        assert len(wiremock.requests("/v2/tracks")) == calls, "an empty box called the library"
        term = uuid.uuid4().hex[:8]
        role(dialog, "combobox", "Search the library").fill(term)
        expect(listed_options(page).first).to_be_visible()
        page.keyboard.press("Escape")
        expect(listed_options(page)).to_have_count(0)
        expect(dialog).to_be_visible()
        assert focus_inside(page, dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/cues")
    overlay_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/cues", ("button", "Add cue"), "Add cue", ("combobox", "Search the library"))
    sweep_for(browser, app_url, "cues")


def test_library_prices_and_cache(wiremock: Any) -> None:
    base = os.environ["APP_SHORT_URL"]
    desk = Desk(base)
    ns = staged(desk, frames=1)
    start = today()
    body = {"trackId": "hr-1001", "title": "Lantern Street", "composer": "Ilse Voss", "seconds": 30, "market": "NL", "from": plus(start, 1), "until": plus(start, 9)}
    first = desk.ok("POST", f"/api/jobs/{ns.jid}/cues", 201, json={**body, "fee": "1.00"})
    assert first["fee"] == "120.00", "a fee in the body was used"
    wiremock.stub("GET", "/v2/prices", json={"prices": [
        {"validFrom": "2026-01-01", "perMarket": "120.00"}, {"validFrom": start, "perMarket": TODAY_PRICE}, {"validFrom": plus(start, 1), "perMarket": "999.00"}]})
    second = desk.ok("POST", f"/api/jobs/{ns.jid}/cues", 201, json=body)
    assert second["fee"] == TODAY_PRICE
    assert journal_body(wiremock.requests("/v2/licences", "POST")[-1])["fee"] == TODAY_PRICE
    fees = {c["id"]: c["fee"] for c in desk.ok("GET", f"/api/jobs/{ns.jid}/cues", 200)["cues"]}
    assert fees == {first["id"]: "120.00", second["id"]: TODAY_PRICE}, "an earlier licence changed its fee"
    assert second["licenceId"] == "lic-501"
    wiremock.stub("POST", "/v2/licences", status=500, json={})
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/cues", json=body), 503)
    assert len(desk.ok("GET", f"/api/jobs/{ns.jid}/cues", 200)["cues"]) == 2
    term = uuid.uuid4().hex[:10]

    def asked() -> int:
        return len([e for e in wiremock.requests("/v2/tracks") if term in journal_url(e)])

    for _ in range(3):
        tracks = desk.ok("GET", f"/api/cues/search?q={term}", 200)["tracks"]
    assert {t["id"] for t in tracks} >= {"hr-1001", "hr-1002", "hr-1003"}
    assert asked() == 1, "the same text called the library twice within CUE_CACHE_SECONDS"
    wait_for(lambda: (desk.ok("GET", f"/api/cues/search?q={term}", 200), asked() == 2)[1], "the cache ends after CUE_CACHE_SECONDS", 25)
    bad = uuid.uuid4().hex[:10]
    wiremock.stub("GET", "/v2/tracks", query={"q": bad}, status=500, json={})
    assert_error(desk.call("GET", f"/api/cues/search?q={bad}"), 503)
    assert_error(desk.call("GET", f"/api/cues/search?q={bad}"), 503)
    assert len([e for e in wiremock.requests("/v2/tracks") if bad in journal_url(e)]) == 2, "a failed answer was cached"


def ready_render(desk: Desk, jid: str, render_id: str, deadline: float = RENDER_DEADLINE) -> dict:
    def done() -> dict | None:
        renders = {r["id"]: r for r in desk.ok("GET", f"/api/jobs/{jid}/renders", 200)["renders"]}
        render = renders.get(render_id)
        return render if render and render["state"] in ("ready", "failed", "outdated") else None

    return wait_for(done, f"render {render_id} finished", deadline)


def test_wf_preview_renders_journey(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=2)
    cut = desk.cut(ns.jid)["number"]
    film = b"QUAYMILL PREVIEW FILM rnd-1\n"
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cuts", desk) as page:
        choose_menu(page, role(page, "button", f"Actions for Cut {cut}"), "Preview film")
        dialog = role(page, "dialog", "Preview film")
        pick(role(role(dialog, "radiogroup", "Width"), "radio", "1280"))
        pick(role(dialog, "checkbox", "Burn in timecode"), checked=False)
        press(page, role(dialog, "button", "Ask for film"), f"/api/jobs/{ns.jid}/renders", copy="Film asked for.")
        said(page, f"The film for Cut {cut} is ready.")
        region = role(page, "region", "Preview films")
        expect(region).to_contain_text("Ready")
        assert link_bytes(page, role(region, "link", "Download film")) == film
        render = desk.ok("GET", f"/api/jobs/{ns.jid}/renders", 200)["renders"][0]
        assert render["state"] == "ready" and render["size"] == 28
        assert render["sha256"] == hashlib.sha256(film).hexdigest()
        assert S3().get(f"clients/{ns.cid}/jobs/{ns.jid}/films/{render['id']}") == film
        desk.durations(ns.jid, {1: 40})
        expect(region).to_contain_text("Outdated")
        expect(role(region, "link", "Download film")).to_be_visible()
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/renders", 200)["renders"][0]["state"] == "outdated"
    assert desk.call("GET", f"/api/jobs/{ns.jid}/renders/{render['id']}/film").content == film
    assert len([e for e in wiremock.requests("/v1/renders", "POST") if journal_body(e)["cutId"] == desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/{cut}", 200)["id"]]) == 1


def test_wf_preview_renders_rare_states(browser: Browser, wiremock: Any) -> None:
    base = os.environ["APP_SHORT_URL"]
    desk = Desk(base)
    ns = staged(desk, frames=1)
    cut = desk.cut(ns.jid)["number"]
    ask = {"cut": cut, "width": 640, "burnTimecode": False}
    wiremock.fault("POST", "/v1/renders")
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/renders", json=ask), 503, message="The render service is unavailable right now. Nothing changed.")
    wiremock.stub("POST", "/v1/renders", status=202, json={"id": "rnd-short", "state": "queued"})
    wiremock.stub("GET", "/v1/renders/rnd-short", json={"state": "done", "url": "/files/rnd-1.bin", "size": 5, "sha256": "0" * 64})
    render = desk.ok("POST", f"/api/jobs/{ns.jid}/renders", 202, json=ask)
    finished = ready_render(desk, ns.jid, render["id"])
    assert finished["state"] == "failed" and finished["message"] == "The render came back incomplete. Nothing was saved."
    assert S3("-short").keys(f"clients/{ns.cid}/jobs/{ns.jid}/films/") == []
    baseline = {"size": 28, "sha256": "a58537fe387c1985edd7165c243e84fec778a0c4e2766dabefe2157f966098ee"}
    for wrong in ({"size": 5}, {"sha256": "0" * 64}):
        wiremock.stub("GET", "/v1/renders/rnd-short", json={"state": "done", "url": "/files/rnd-1.bin", **baseline, **wrong})
        lone = desk.ok("POST", f"/api/jobs/{ns.jid}/renders", 202, json=ask)
        assert ready_render(desk, ns.jid, lone["id"])["message"] == "The render came back incomplete. Nothing was saved.", wrong
    wiremock.stub("GET", "/v1/renders/rnd-short", json={"state": "failed", "reason": "no"})
    again = desk.ok("POST", f"/api/jobs/{ns.jid}/renders", 202, json=ask)
    assert ready_render(desk, ns.jid, again["id"])["message"] == "The render service could not finish this film. Nothing was saved."
    wiremock.stub("POST", "/v1/renders", status=429, json={}, headers={"Retry-After": "30"})
    posts = len(wiremock.requests("/v1/renders", "POST"))
    answer = desk.call("POST", f"/api/jobs/{ns.jid}/renders", json={**ask, "width": 1280})
    busy_copy = re.compile(rf"^The render service is busy\. You can try again at {TIME_RE} Amsterdam time\.$")
    assert busy_copy.match(assert_error(answer, 503)["message"])
    assert len(wiremock.requests("/v1/renders", "POST")) == posts + 1
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/renders", json={**ask, "burnTimecode": True}), 503)
    assert len(wiremock.requests("/v1/renders", "POST")) == posts + 1, "a call went out during busy"
    busy = desk.ok("GET", f"/api/jobs/{ns.jid}/renders", 200)["busy"]
    assert busy and INSTANT.match(busy["until"]) and busy_copy.match(busy["message"])
    with opened(browser, base, "/api/health", desk) as page:
        page.clock.set_fixed_time(f"{plus(today(), 2)}T03:00:00Z")
        page.goto(f"{base}/desk/jobs/{ns.jid}/cuts")
        expect(role(page, "region", "Preview films")).to_contain_text(busy["message"])
        expect(role(page, "region", "Preview films")).to_contain_text("Failed")
    wait_for(lambda: desk.ok("GET", f"/api/jobs/{ns.jid}/renders", 200)["busy"] is None, "busy ends at its instant", 45)


def test_wf_preview_renders_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=1)
    cut = desk.cut(ns.jid)
    assert_shape(cut)
    assert_ladder(desk, "POST", f"/api/jobs/{ns.jid}/renders", f"/api/jobs/{unknown_id()}/renders", {"cut": 1})
    for size in (PHONE, WIDE):
        with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cuts", desk, size=size) as page:
            menu_rules(page, role(page, "button", "Actions for Cut 1"), ["Preview film", "Send review page", "Ask for sign-off", "Compare", "Bring back", "Rename", "Delete"])
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cuts", desk) as page:
        opener = role(page, "button", "Actions for Cut 1")
        choose_menu(page, opener, "Preview film")
        dialog = role(page, "dialog", "Preview film")
        wait_for(lambda: focus_inside(page, dialog), "SR8: focus moves inside, which may be a frame after the menu closes", UI_CHECK_S)
        for _ in range(TAB_SWEEP):
            page.keyboard.press("Tab")
            assert focus_inside(page, dialog)
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/cuts")
    sweep_for(browser, app_url, "cuts")


def test_render_service_calls(wiremock: Any) -> None:
    base = os.environ["APP_SHORT_URL"]
    desk = Desk(base)
    ns = staged(desk, frames=2, drawn=True)
    cut = desk.cut(ns.jid)
    frames = desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/{cut['number']}", 200)["frames"]
    provider = f"rnd-{uuid.uuid4().hex[:8]}"
    film = b"film bytes for this render\n"
    wiremock.stub("POST", "/v1/renders", status=202, json={"id": provider, "state": "queued"})
    wiremock.stub("GET", f"/v1/renders/{provider}", json={"state": "running", "progress": 40})
    ask = {"cut": cut["number"], "width": 1280, "burnTimecode": True}
    answers = together([lambda: desk.call("POST", f"/api/jobs/{ns.jid}/renders", json=ask) for _ in range(3)])
    assert sorted(a.status_code for a in answers)[-1] in (200, 202)
    assert 202 in [a.status_code for a in answers]
    posts = [e for e in wiremock.requests("/v1/renders", "POST") if journal_body(e)["cutId"] == cut["id"]]
    assert len(posts) == 1, "the same cut and settings started two renders"
    assert journal_header(posts[0], "Idempotency-Key") == f"{cut['id']}-1280-true"
    assert journal_body(posts[0]) == {"cutId": cut["id"], "frameRate": "25", "width": 1280, "burnTimecode": True,
                                      "clips": [{"frame": f["number"], "durationFrames": f["durationFrames"], "sha256": f["sha256"]} for f in frames]}
    render = [a for a in answers if a.status_code == 202][0].json()
    began = time.monotonic()
    path = f"/v1/renders/{provider}"
    wait_for(lambda: len(wiremock.requests(path, "GET")) >= 3, "the server polls with no screen open", 25)
    elapsed = time.monotonic() - began
    assert len(wiremock.requests(path, "GET")) <= elapsed / 5 + 2, "polled more than once per 5 seconds"
    mid = next(r for r in desk.ok("GET", f"/api/jobs/{ns.jid}/renders", 200)["renders"] if r["id"] == render["id"])
    assert mid["state"] == "running" and mid["progress"] == 40
    assert S3("-short").keys(f"clients/{ns.cid}/jobs/{ns.jid}/films/") == []
    wiremock.stub("GET", path, status=429, json={}, headers={"Retry-After": "10"})
    limit = len(wiremock.requests(path, "GET"))
    wait_for(lambda: len(wiremock.requests(path, "GET")) > limit, "the next poll meets the 429", 15)
    hit = time.monotonic()
    count = len(wiremock.requests(path, "GET"))
    wiremock.stub("GET", path, json={"state": "done", "url": f"/files/{provider}.bin", "size": len(film), "sha256": hashlib.sha256(film).hexdigest()})
    wiremock.stub("GET", f"/files/{provider}.bin", body=film.decode(), headers={"Content-Type": "application/octet-stream"})
    wait_for(lambda: len(wiremock.requests(path, "GET")) > count, "polling goes on after Retry-After", 30)
    assert time.monotonic() - hit >= 8, "a poll went out before Retry-After ended"
    done = ready_render(desk, ns.jid, render["id"])
    assert done["state"] == "ready" and done["sha256"] == hashlib.sha256(film).hexdigest()
    assert S3("-short").get(f"clients/{ns.cid}/jobs/{ns.jid}/films/{render['id']}") == film
    assert desk.call("GET", f"/api/jobs/{ns.jid}/renders/{render['id']}/film").content == film
    stored = desk.call("POST", f"/api/jobs/{ns.jid}/renders", json=ask)
    assert stored.status_code == 200 and stored.json()["id"] == render["id"]
    other = desk.call("POST", f"/api/jobs/{ns.jid}/renders", json={**ask, "width": 640})
    assert other.status_code == 202
    keys = [journal_header(e, "Idempotency-Key") for e in wiremock.requests("/v1/renders", "POST") if journal_body(e)["cutId"] == cut["id"]]
    assert keys == [f"{cut['id']}-1280-true", f"{cut['id']}-640-true"]


ONE_STAGE_JS = """() => { const inside = (a, b) => ({left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom)});
  const showing = e => { let box = inside(e.getBoundingClientRect(), {left: 0, right: innerWidth, top: 0, bottom: innerHeight});
    for (let p = e.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflowX !== 'visible' || s.overflowY !== 'visible') box = inside(box, p.getBoundingClientRect()); }
    return box; };
  const seen = [...document.querySelectorAll('[data-part="compare-clip"]')].filter(e => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.opacity !== '0'; })
    .map(showing).filter(r => r.right - r.left > 1 && r.bottom - r.top > 1);
  return seen.length > 0 && seen.every(a => seen.every(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)); }"""


def test_wf_cuts_and_compare_journey(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=4)
    desk.cut(ns.jid)
    board = desk.board(ns.jid)
    desk.ok("POST", f"/api/jobs/{ns.jid}/frames/4/move", 200, json={"position": 1, "stamp": board["stamp"]})
    desk.durations(ns.jid, {1: 24})
    desk.ok("POST", f"/api/jobs/{ns.jid}/removals", 201, json={"frame": 2, "stamp": desk.board(ns.jid)["stamp"]})
    desk.ok("POST", f"/api/jobs/{ns.jid}/removals/2/hold", 200)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cuts", desk) as page:
        role(page, "button", "Make cut").click()
        dialog = role(page, "dialog", "Make cut")
        role(dialog, "textbox", "Name").fill("Second pass")
        press(page, role(dialog, "button", "Save"), f"/api/jobs/{ns.jid}/cuts", copy="Cut 2 made.", after=role(page, "button", "Make cut"))
    assert [c["name"] for c in desk.ok("GET", f"/api/jobs/{ns.jid}/cuts", 200)["cuts"]] == ["First pass", "Second pass"]
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/compare?a=1&b=2&wipe=50", desk) as page:
        at(page, "Compare cuts for Night Ferry")
        differences = role(page, "list", "Differences").get_by_role("listitem")
        expect(differences.first).to_have_text("Frame 4 moved from position 4 to position 1.")
        expect(role(page, "list", "Differences")).to_contain_text(ONE_SHORTER)
        expect(differences.last).to_have_text("Frame 2 is gone.")
        clips = page.locator('[data-part="compare-clip"]')
        for index in range(clips.count()):
            mark(clips.nth(index))
        slider = role(page, "slider", "Wipe")
        slider.focus()
        length = history_length(page)
        page.keyboard.press("ArrowRight")
        expect(page).to_have_url(re.compile(r"wipe=51"))
        expect(slider).to_have_attribute("aria-valuetext", f"{50 + 1}%")
        assert history_length(page) == length + 1
        page.keyboard.press("Shift+ArrowRight")
        expect(page).to_have_url(re.compile(r"wipe=61"))
        expect(slider).to_have_attribute("aria-valuetext", f"{50 + 1 + 10}%")
        assert all(marked(clips.nth(i)) for i in range(clips.count())), "the wipe replaced elements"
        page.go_back()
        expect(page).to_have_url(re.compile(r"wipe=51"))
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/compare?a=1&b=2&wipe=50", desk, size=PHONE) as page:
        wait_for(lambda: page.evaluate(ONE_STAGE_JS), "one frame shows at a time at 375, each cut's clip over the other at most", 10)
        tap(role(page, "button", "Later frame"))
        wait_for(lambda: page.evaluate(ONE_STAGE_JS), "still one frame", 5)
        slider = role(page, "slider", "Wipe")
        assert slider.bounding_box()["y"] > PHONE["height"] / 2, "the wipe is not in the bottom bar"
        tap(role(page, "button", "Earlier frame"))
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/compare?a=1&b=1", 200)["differences"] == []
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/compare?a=2&b=2&wipe=50", desk) as page:
        expect(page.locator("body")).to_contain_text("These two cuts are the same.")


def test_wf_cuts_and_compare_row_menu_refusals(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = signed_job(desk, frames=1)
    second = desk.cut(ns.jid, "Second pass")["number"]
    third = desk.cut(ns.jid, "Third pass")["number"]
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cuts", desk, size=PHONE) as page:
        button = role(page, "button", f"Actions for Cut {second}")
        tap(button)
        tap(role(page.get_by_role("menu"), "menuitem", "Rename"))
        dialog = role(page, "dialog", f"Rename Cut {second}")
        expect(role(dialog, "textbox", "Name")).to_be_focused()
        role(dialog, "textbox", "Name").fill(RENAMED_CUT)
        press(page, role(dialog, "button", "Save"), f"/api/jobs/{ns.jid}/cuts/{second}", copy=f"Cut {second} saved.", via="tap")
        expect(button).to_be_focused()
        tap(role(page, "button", f"Actions for Cut {third}"))
        tap(role(page.get_by_role("menu"), "menuitem", "Delete"))
        said(page, f"Cut {third} deleted.")
        expect(h1(page)).to_be_focused()
        tap(button)
        tap(role(page.get_by_role("menu"), "menuitem", "Bring back"))
        said(page, f"Cut {second} is the board again.")
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/{second}", 200)["name"] == RENAMED_CUT
    assert desk.cut(ns.jid, "Fourth")["number"] == third + 1, "a deleted cut's number was reused"
    copy = "A signed-off cut can't change."
    assert_error(desk.call("PATCH", f"/api/jobs/{ns.jid}/cuts/{ns.cut}", json={"name": "No"}), 409, message=copy)
    assert_error(desk.call("DELETE", f"/api/jobs/{ns.jid}/cuts/{ns.cut}"), 409, message=copy)


def test_wf_cuts_and_compare_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=2)
    desk.cut(ns.jid)
    assert_shape(desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/1", 200))
    assert_ladder(desk, "POST", f"/api/jobs/{ns.jid}/cuts", f"/api/jobs/{unknown_id()}/cuts", {"name": "Second pass"}, invalid=False)
    overlay_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/cuts", ("button", "Make cut"), "Make cut", ("textbox", "Name"))
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/compare?a=1&b=1&wipe=50")
    sweep_for(browser, app_url, "cuts", "compare")
    other = Desk(app_url)
    framed = staged(other, frames=1)
    other.cut(framed.jid)
    with opened(browser, app_url, f"/desk/jobs/{framed.jid}/cuts", other) as page:
        names = iter(["Third look", "Fourth look"])

        def rename() -> None:
            choose_menu(page, role(page, "button", "Actions for Cut 1"), "Rename")
            dialog = role(page, "dialog", "Rename Cut 1")
            role(dialog, "textbox", "Name").fill(next(names))
            role(dialog, "button", "Save").click()
            expect(dialog).to_have_count(0)

        announced_twice(page, rename)


def test_wf_cuts_and_compare_differences(app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=3, drawn=True)
    desk.cut(ns.jid)
    desk.durations(ns.jid, {2: 26, 3: 20})
    desk.ok("POST", f"/api/jobs/{ns.jid}/frames/2/insert-after", 201, json={"stamp": desk.board(ns.jid)["stamp"]})
    desk.ok("POST", f"/api/jobs/{ns.jid}/removals", 201, json={"frame": 1, "stamp": desk.board(ns.jid)["stamp"]})
    desk.cut(ns.jid, "Second pass")
    compared = desk.ok("GET", f"/api/jobs/{ns.jid}/compare?a=2&b=1", 200)["differences"]
    assert ONE_LONGER in compared
    assert "Frame 3 is 5 frames shorter." in compared
    assert "Frame 4 is new." in compared
    assert compared[-1] == "Frame 1 is gone."
    assert compared.index(ONE_LONGER) < compared.index("Frame 4 is new.") < compared.index("Frame 3 is 5 frames shorter.")


def test_bring_back_and_history(app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=3, drawn=True)
    first = desk.cut(ns.jid)
    original = desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/1", 200)
    desk.durations(ns.jid, {1: 40})
    desk.ok("POST", f"/api/jobs/{ns.jid}/frames/3/move", 200, json={"position": 1, "stamp": desk.board(ns.jid)["stamp"]})
    desk.ok("POST", f"/api/jobs/{ns.jid}/frame-rate", 200, json={"frameRate": "29.97", "playhead": 0, "stamp": desk.board(ns.jid)["stamp"]})
    desk.cut(ns.jid, "Second pass")
    later = desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/2", 200)
    before_change = desk.board(ns.jid)["stamp"]
    board = desk.ok("POST", f"/api/jobs/{ns.jid}/cuts/1/bring-back", 200, json={"stamp": before_change})
    assert board["frameRate"] == "25"
    published = ("number", "position", "durationFrames", "actionNote", "audioNote", "sha256")
    assert [{k: f.get(k) for k in published} for f in board["frames"]] == [{k: f.get(k) for k in published} for f in original["frames"]], "the board does not equal the cut"
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/2", 200) == later, "a later cut changed"
    assert desk.call("GET", f"/api/jobs/{ns.jid}/frames/1/drawing").status_code == 200
    assert first["number"] == 1
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/cuts/1/bring-back", json={"stamp": before_change}), 412)
    events = desk.ok("GET", f"/api/jobs/{ns.jid}/history", 200)["events"]
    actions = [e["action"] for e in events]
    assert "cutMade" in actions and "cutBroughtBack" in actions
    assert actions.index("cutMade") < actions.index("cutBroughtBack")
    assert [e["at"] for e in events] == sorted(e["at"] for e in events)
    for event in events:
        assert set(event) == {"at", "actor", "action", "text"} and INSTANT.match(event["at"])
    assert events[-1]["actor"] == desk.name
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        answer = desk.call(method, f"/api/jobs/{ns.jid}/history", json={})
        assert_error(answer, 405)
        assert answer.headers["allow"].strip() == "GET"
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/history", 200)["events"] == events


def review_page(desk: Desk, language: str, town: str = "amsterdam", rate: str = "23.976", frames: int = 3, email: str | None = None) -> types.SimpleNamespace:
    ns = staged(desk, frames=frames, rate=rate, drawn=True, language=language, town=town, name=LANGUAGE_NAMES[language], email=email)
    ns.cut = desk.cut(ns.jid)["number"]
    ns.page, ns.token = review(desk, ns, ns.cut)
    return ns


def close_after_add(page: Page, sheet: Locator, close: str, press_it: Callable[[Locator], None]) -> None:
    pressed: list[bool] = []

    def settled() -> bool:
        if not sheet.is_visible():
            return True
        if not pressed:
            with contextlib.suppress(AssertionError, PlaywrightError):
                press_it(role(sheet, "button", close))
                pressed.append(True)
        return not sheet.is_visible()

    hold_for(page, SHEET_SETTLE_S)
    wait_for(settled, "the sheet closes, by itself or by Close", PRESS_WAIT_S * 2)


def test_wf_review_page_touch_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    desk = Desk(app_url)
    ns = review_page(desk, "fr", town="toronto", email=fresh("producer")[1])
    copy = PRIVATE_COPY["fr"]
    letter = mail_to(mail, ns.producer["email"], f"{copy['reviewSubject']}Night Ferry")[0]
    address = re.search(r"https?://\S*/r/[\w-]+", text(letter)).group(0)
    assert address.endswith(ns.page["url"])
    with opened(browser, app_url, ns.page["url"], size=PHONE) as page:
        expect(page.locator("html")).to_have_attribute("lang", "fr")
        heading_is(page, f"{copy['heading']}Night Ferry")
        view = page.locator('[data-part="frame-view"]')
        reach(page, view, [copy["frames"], copy["notes"]], copy["steps"])
        tap(view)
        pin = page.locator('[data-part="pin"]')
        expect(pin).to_have_count(1)
        assert re.fullmatch(r"\d+(\.\d)?", pin.get_attribute("data-x"))
        sheet = role(page, "dialog", copy["notes"])
        expect(sheet).to_be_visible()
        field = sheet.get_by_label(copy["note"], exact=True)
        expect(field).to_be_focused()
        settle(sheet)
        field.fill("Un peu plus long.")
        sheet.get_by_label(copy["length"], exact=True).fill("1,5")
        sheet.get_by_label(copy["length"], exact=True).blur()
        expect(sheet).to_contain_text(copy["frameCount"].format(36))
        tap(role(sheet, "button", copy["add"]))
        close_after_add(page, sheet, copy["close"], tap)
        reach(page, page.get_by_label(copy["name"], exact=True), [copy["send"]], copy["steps"])
        page.get_by_label(copy["name"], exact=True).fill(ELODIE)
        send = role(page, "button", copy["sendNotes"])
        press(page, send, f"/api/r/{ns.token}/notes", copy=copy["sent"], via="tap", working=copy["working"])
        expect(page.get_by_label(copy["name"], exact=True)).to_have_count(0)
    notes = desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)
    assert notes["total"] == 1
    note = notes["notes"][0]
    assert note["suggestedSeconds"] == "1.5" and note["suggestedFrames"] == 36 and note["typedName"] == ELODIE
    assert note["text"] == "Un peu plus long." and note["producerName"] == ns.producer["name"]


def file_refused(browser: Browser, app_url: str, ns: types.SimpleNamespace, language: str, file: dict, refusal: str) -> None:
    copy = PRIVATE_COPY[language]
    with opened(browser, app_url, ns.page["url"], size=PHONE) as page:
        body = page.locator("body")
        pin = role(page, "button", copy["pin"])
        reach(page, pin, [copy["frames"], copy["notes"]], copy["steps"])
        pin.click()
        page.keyboard.press("Enter")
        sheet = role(page, "dialog", copy["notes"])
        sheet.get_by_label(copy["note"], exact=True).fill("Words")
        sheet.get_by_label(copy["attach"], exact=True).set_input_files(file)
        with contextlib.suppress(AssertionError):
            expect(body).to_contain_text(refusal, timeout=JUDGED_WAIT_MS)
            return
        role(sheet, "button", copy["add"]).click()
        with contextlib.suppress(AssertionError):
            expect(body).to_contain_text(refusal, timeout=JUDGED_WAIT_MS)
            return
        close_after_add(page, sheet, copy["close"], lambda button: button.click())
        name = page.get_by_label(copy["name"], exact=True)
        reach(page, name, [copy["send"]], copy["steps"])
        name.fill(ns.producer["name"])
        role(page, "button", copy["sendNotes"]).click()
        expect(body).to_contain_text(refusal)


def review_copy_case(browser: Browser, app_url: str, language: str) -> None:
    copy = PRIVATE_COPY[language]
    desk = Desk(app_url)
    ns = review_page(desk, language)
    with opened(browser, app_url, ns.page["url"], size=PHONE) as page:
        html = page.locator("html")
        expect(html).to_have_attribute("lang", language)
        if language == "ar":
            expect(html).to_have_attribute("dir", "rtl")
        heading_is(page, f"{copy['heading']}Night Ferry")
        steps = role(page, "group", copy["steps"])
        for key in ("frames", "notes", "send"):
            expect(role(steps, "button", copy[key])).to_be_visible()
        expect(role(steps, "button", copy["frames"])).to_have_attribute("aria-current", "step")
        expect(role(page, "button", copy["next"])).to_be_visible()
        strip = role(page, "group", copy["strip"])
        expect(role(strip, "button", copy["clip"])).to_be_attached()
        for key in ("earlier", "later", "play"):
            expect(role(page, "button", copy[key])).to_be_attached()
        tc = page.locator('[data-part="timecode"]').first
        assert tc.evaluate("e => getComputedStyle(e).direction") == LEFT_TO_RIGHT
        expect(tc).to_have_text("00:00:00:00")
        reach(page, role(page, "button", copy["open"]), [copy["frames"], copy["notes"]], copy["steps"])
        role(page, "button", copy["open"]).click()
        sheet = role(page, "dialog", copy["notes"])
        expect(role(sheet, "button", copy["close"])).to_be_visible()
        role(sheet, "button", copy["close"]).click()
        expect(sheet).to_have_count(0)
        reach(page, role(page, "button", copy["pin"]), [copy["frames"], copy["notes"]], copy["steps"])
        role(page, "button", copy["pin"]).click()
        page.keyboard.press("Enter")
        expect(sheet).to_be_visible()
        expect(sheet.get_by_label(copy["note"], exact=True)).to_be_visible()
        role(sheet, "button", copy["add"]).click()
        expect(page.locator("body")).to_contain_text(copy["emptyNote"])
        expect(page.locator("body")).to_contain_text(copy["problems"])
        sheet.get_by_label(copy["note"], exact=True).fill("Words")
        sheet.get_by_label(copy["length"], exact=True).fill(copy["badLength"])
        role(sheet, "button", copy["add"]).click()
        expect(page.locator("body")).to_contain_text(copy["number"])
        sheet.get_by_label(copy["length"], exact=True).fill(copy["goodLength"])
        sheet.get_by_label(copy["length"], exact=True).blur()
        expect(sheet).to_contain_text(copy["frameCount"].format(36))
        role(sheet, "button", copy["add"]).click()
        close_after_add(page, sheet, copy["close"], lambda button: button.click())
        name = page.get_by_label(copy["name"], exact=True)
        reach(page, name, [copy["send"]], copy["steps"])
        role(page, "button", copy["sendNotes"]).click()
        expect(page.locator("body")).to_contain_text(copy["emptyName"])
        name.fill(ns.producer["name"])
        role(page, "button", copy["sendNotes"]).click()
        expect(page.locator("body")).to_contain_text(copy["sent"])
        desk.ok("POST", f"/api/reviews/{ns.page['id']}/end", 200)
        page.reload()
        heading_is(page, copy["ended"])
        link = role(page, "button", copy["ask"]).or_(role(page, "link", copy["ask"]))
        page.get_by_label(copy["mail"], exact=True).fill(fresh("unknown")[1])
        link.click()
        expect(page.locator("body")).to_contain_text(copy["answer"])
    spare = review_page(desk, language)
    file_refused(browser, app_url, spare, language, {"name": "x.png", "mimeType": "image/png", "buffer": b"not a picture"}, copy["badFile"])
    file_refused(browser, app_url, spare, language, {"name": "b.png", "mimeType": "image/png", "buffer": png_of_size(31, ATTACHMENT_LIMIT + 1)}, copy["bigFile"])


def test_wf_review_page_copy_languages(browser: Browser, app_url: str) -> None:
    for language in PRIVATE_COPY:
        review_copy_case(browser, app_url, language)


def test_wf_review_page_keyboard_and_rtl(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = review_page(desk, "ar")
    copy = PRIVATE_COPY["ar"]
    with opened(browser, app_url, ns.page["url"], size=TABLET) as page:
        steps = role(page, "group", copy["steps"])
        first = role(steps, "button", copy["frames"])
        tab_to(page, first)
        page.keyboard.press("ArrowLeft")
        expect(role(steps, "button", copy["notes"])).to_be_focused()
        page.keyboard.press("End")
        expect(role(steps, "button", copy["send"])).to_be_focused()
        page.keyboard.press("Home")
        expect(first).to_be_focused()
        page.keyboard.press("Tab")
        assert not focus_inside(page, steps), "the steps have more than one Tab stop"
        clip_button = role(page, "button", copy["clip"])
        clip_button.focus()
        page.keyboard.press("ArrowRight")
        head = page.locator('[data-part="playhead"]').first
        expect(head).to_have_attribute("data-position", "1")
        page.keyboard.press("ArrowLeft")
        expect(head).to_have_attribute("data-position", "0")
        pin_button = role(page, "button", copy["pin"])
        reach(page, pin_button, [copy["frames"], copy["notes"]], copy["steps"])
        pin_button.focus()
        page.keyboard.press("Enter")
        cross = page.locator('[data-part="crosshair"]')
        expect(cross).to_have_attribute("data-x", re.compile(r"^50(\.0)?$"))
        expect(cross).to_have_attribute("data-y", re.compile(r"^50(\.0)?$"))
        page.keyboard.press("ArrowLeft")
        expect(cross).to_have_attribute("data-x", re.compile(r"^49(\.0)?$"))
        page.keyboard.press("Shift+ArrowDown")
        expect(cross).to_have_attribute("data-y", re.compile(r"^60(\.0)?$"))
        page.keyboard.press("Escape")
        expect(cross).to_have_count(0)
        expect(page.locator('[data-part="pin"]')).to_have_count(0)
        page.keyboard.press("Enter") if is_focused(pin_button) else pin_button.click()
        page.keyboard.press("Enter")
        sheet = role(page, "dialog", copy["notes"])
        expect(sheet.get_by_label(copy["note"], exact=True)).to_be_focused()
        sheet.get_by_label(copy["note"], exact=True).fill(ARABIC_DRAFT)
        page.keyboard.press("Escape")
        expect(pin_button).to_be_focused()
        page.reload()
        reach(page, page.locator('[data-part="frame-view"]'), [copy["frames"], copy["notes"]], copy["steps"])
        expect(page.locator('[data-part="pin"]')).to_have_count(1)
        reach(page, role(page, "button", copy["open"]), [copy["frames"], copy["notes"]], copy["steps"])
        role(page, "button", copy["open"]).click()
        expect(role(page, "dialog", copy["notes"]).get_by_label(copy["note"], exact=True)).to_have_value(ARABIC_DRAFT)
    with opened(browser, app_url, ns.page["url"], size=TABLET) as page:
        page.context.add_init_script("""Object.defineProperty(window, 'localStorage', {get() { throw new DOMException('refused', 'SecurityError'); }});
          Object.defineProperty(window, 'sessionStorage', {get() { throw new DOMException('refused', 'SecurityError'); }});
          Object.defineProperty(window, 'indexedDB', {get() { throw new DOMException('refused', 'SecurityError'); }});""")
        page.reload()
        refused_pin = role(page, "button", copy["pin"])
        reach(page, refused_pin, [copy["frames"], copy["notes"]], copy["steps"])
        refused_pin.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("Enter")
        refused_sheet = role(page, "dialog", copy["notes"])
        refused_note = refused_sheet.get_by_label(copy["note"], exact=True)
        refused_note.fill(ARABIC_DRAFT)
        refused_note.blur()
        expect(page.locator("body")).to_contain_text(copy["draft"])
        role(refused_sheet, "button", copy["close"]).click()
        expect(refused_sheet).to_have_count(0)
        heading_is(page, f"{copy['heading']}Night Ferry")
    for language, rtl in (("ar", True), ("en", False)):
        other = review_page(Desk(app_url), language)
        copy_l = PRIVATE_COPY[language]
        with opened(browser, app_url, other.page["url"], size=TABLET) as page:
            opener = role(page, "button", copy_l["open"])
            reach(page, opener, [copy_l["frames"], copy_l["notes"]], copy_l["steps"])
            moved = entrance(page, opener.click, role(page, "dialog", copy_l["notes"]))
            if rtl:
                assert moved["start"]["left"] < moved["end"]["left"], moved
            else:
                assert moved["start"]["left"] > moved["end"]["left"], moved


def test_wf_review_page_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = review_page(desk, "en", frames=2)
    path = f"/api/r/{ns.token}/notes"
    assert_ladder(desk, "POST", path, f"/api/r/{uuid.uuid4().hex}/notes", {"sendKey": "k"}, auth=False)
    key = uuid.uuid4().hex
    first = send_note(app_url, ns.token, key=key)
    assert first.status_code == 201
    assert_shape(first.json())
    replay = send_note(app_url, ns.token, key=key)
    assert replay.status_code == 200 and replay.json() == first.json()
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)["total"] == 1, "a replay stored a second note"
    page_rules(browser, app_url, None, ns.page["url"])
    with opened(browser, app_url, ns.page["url"], size=PHONE) as page:
        opener = role(page, "button", "Open notes")
        reach(page, opener, ["Frames", "Notes"], "Steps")
        moved = entrance(page, opener.click, role(page, "dialog", "Notes"))
        assert moved["start"]["top"] > moved["end"]["top"]
        axe(page)
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
        expect(role(page, "dialog", "Notes")).to_have_count(0)
    desk.ok("POST", f"/api/reviews/{ns.page['id']}/end", 200)
    assert_error(anon(app_url, "POST", path, content=b"{bad", headers={"Content-Type": "application/json"}), 410, "pageEnded")
    sweep_for(browser, app_url, "review")
    other = Desk(app_url)
    paged = review_page(other, "en", frames=2)
    with opened(browser, app_url, paged.page["url"]) as page:
        step = role(role(page, "group", "Steps"), "button", "Notes")
        state_mark(page, step, step.click)


def test_private_page_reveals(app_url: str, mail: Mailpit) -> None:
    desk = Desk(app_url)
    email = fresh("producer")[1]
    ns = staged(desk, frames=1, drawn=True, language="nl", name="Producer Alpha", email=email)
    other = desk.producer(ns.cid, name=OTHER_PRODUCER)
    elsewhere = desk.client()
    desk.ok("POST", f"/api/jobs/{ns.jid}/letter", 201, json={"currency": "EUR", "fee": "5506.50", "scope": "Boards"})
    cut = desk.cut(ns.jid)["number"]
    page, token = review(desk, ns, cut)
    letter = mail_to(mail, email, f"{PRIVATE_COPY['nl']['reviewSubject']}Night Ferry")[0]
    words = text(letter)
    assert page["url"] in words and f"Uiterlijk {ns.job['dueDate']}" in words and "Night Ferry" in words
    for secret in ("5506.50", "5,506.50", "€", OTHER_PRODUCER, elsewhere["name"]):
        assert secret not in words, secret
    other_note = desk.ok("POST", f"/api/jobs/{ns.jid}/reviews", 201, json={"producerId": other["id"], "cut": cut})
    other_token = other_note["url"].rsplit("/", 1)[-1]
    send_note(app_url, other_token, words="Not for the other producer")
    send_note(app_url, token, words="Mine alone")
    read = anon(app_url, "GET", f"/api/r/{token}").json()
    assert set(read) == {"language", "jobTitle", "cut", "frameRate", "aspect", "dueDate", "endsAt", "name", "frames", "notes"}
    assert set(read["frames"][0]) == {"number", "position", "durationFrames", "timecodeIn", "actionNote", "drawingUrl"}
    assert [n["text"] for n in read["notes"]] == ["Mine alone"]
    assert set(read["notes"][0]) == {"id", "frame", "x", "y", "text", "suggestedSeconds", "suggestedFrames", "attachmentUrl", "createdAt"}
    assert "5506.50" not in json.dumps(read) and "5,506.50" not in json.dumps(read) and OTHER_PRODUCER not in json.dumps(read)
    _, sign_token = sign_page(desk, ns, cut)
    signed = anon(app_url, "GET", f"/api/s/{sign_token}").json()
    assert set(signed) == {"language", "jobTitle", "cut", "frameRate", "endsAt", "signedOffAt", "signedOffText", "frames"}
    letter_row = desk.ok("GET", f"/api/jobs/{ns.jid}/letter", 200)
    sent = desk.ok("POST", f"/api/letters/{letter_row['id']}/send", 200, json={"producerId": ns.pid})
    fee_token = sent["pageUrl"].rsplit("/", 1)[-1]
    fee = anon(app_url, "GET", f"/api/f/{fee_token}").json()
    assert set(fee) == {"jobTitle", "currency", "feeText", "taxText", "totalText", "milestones", "state", "stamp", "endsAt", "pdfUrl"}
    for attempt in ({"cookies": {"session": token}}, {"headers": {"Authorization": f"Bearer {token}"}}, {"params": {"token": token}}):
        with httpx.Client(base_url=app_url, timeout=HTTP_SECONDS, **{k: v for k, v in attempt.items() if k == "cookies"}) as client:
            for path in ("/api/session", "/api/clients", f"/api/jobs/{ns.jid}", f"/api/jobs/{ns.jid}/notes"):
                extra = {k: v for k, v in attempt.items() if k != "cookies"}
                assert client.get(path, **extra).status_code == 401, path
    known = anon(app_url, "POST", f"/api/r/{token}/new-link", json={"email": email})
    unknown = anon(app_url, "POST", f"/api/r/{token}/new-link", json={"email": fresh("nobody")[1]})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json() == {"message": PRIVATE_COPY["nl"]["answer"]}
    new_mail = mail_to(mail, email, "Je nieuwe link")[0]
    fresh_token = re.search(r"/r/([\w-]+)", text(new_mail)).group(1)
    assert fresh_token != token and anon(app_url, "GET", f"/api/r/{fresh_token}").status_code == 200
    assert_error(anon(app_url, "GET", f"/api/r/{token}"), 410, "pageEnded", PRIVATE_COPY["nl"]["ended"])
    limited_mail = fresh("limit")[1]
    for _ in range(3):
        assert anon(app_url, "POST", f"/api/r/{fresh_token}/new-link", json={"email": limited_mail}).status_code == 202
    fourth = anon(app_url, "POST", f"/api/r/{fresh_token}/new-link", json={"email": limited_mail})
    assert_error(fourth, 429, message="Te veel verzoeken. Probeer het later opnieuw.")
    assert fourth.headers["retry-after"].isdigit()


def test_private_page_lifetime(mail: Mailpit) -> None:
    base = os.environ["APP_SHORT_URL"]
    desk = Desk(base)
    silent_mail, noted_mail = fresh("silent")[1], fresh("noted")[1]
    ns = staged(desk, frames=1, language="nl", email=silent_mail, name="Stille Producer")
    cut = desk.cut(ns.jid)["number"]
    page, token = review(desk, ns, cut)
    assert INSTANT.match(page["endsAt"])
    noted = staged(desk, frames=1, email=noted_mail, name="Noting Producer")
    noted_cut = desk.cut(noted.jid)["number"]
    _, noted_token = review(desk, noted, noted_cut)
    assert send_note(base, noted_token).status_code == 201
    subject = f"{PRIVATE_COPY['nl']['reminder']}Night Ferry"
    mail_to(mail, silent_mail, subject, seconds=25)
    ends = datetime.datetime.strptime(page["endsAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    deadline = time.monotonic() + SHORT_DEADLINE
    ended = False
    while time.monotonic() < deadline and not ended:
        answer = anon(base, "GET", f"/api/r/{token}")
        served = datetime.datetime.strptime(answer.headers["date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=datetime.timezone.utc)
        if answer.status_code == 200:
            assert served < ends + datetime.timedelta(seconds=1), "still open past its instant"
        else:
            assert_error(answer, 410, "pageEnded", PRIVATE_COPY["nl"]["ended"])
            assert served >= ends - datetime.timedelta(seconds=1), "ended before its instant"
            ended = True
    assert ended, "the review page never ended"
    assert len(mail_to(mail, silent_mail, subject)) == 1, "more than one reminder"
    assert [m for m in mail.messages(0) if noted_mail in addresses(m.get("To")) and m.get("Subject", "").startswith("Reminder")] == [], "a reminder went after a note"
    fresh_ns = staged(desk, frames=1)
    cut2 = desk.cut(fresh_ns.jid)["number"]
    first, old = review(desk, fresh_ns, cut2)
    second, new = review(desk, fresh_ns, cut2)
    assert_error(anon(base, "GET", f"/api/r/{old}"), 410, "pageEnded", PRIVATE_COPY["en"]["ended"])
    assert anon(base, "GET", f"/api/r/{new}").status_code == 200
    assert desk.ok("POST", f"/api/reviews/{second['id']}/end", 200)["state"] == "ended"
    assert_error(anon(base, "GET", f"/api/r/{new}"), 410, "pageEnded")
    assert first["id"] != second["id"]
    assert_error(anon(base, "GET", f"/api/r/{uuid.uuid4().hex}"), 404)
    late = staged(desk, frames=1)
    desk.ok("PATCH", f"/api/jobs/{late.jid}", 200, json={"dueDate": plus(today(), -1)})
    desk.cut(late.jid)
    assert_error(desk.call("POST", f"/api/jobs/{late.jid}/reviews", json={"producerId": late.pid, "cut": 1}), 409, message="This job's due date has passed.")


def test_suggested_lengths(app_url: str) -> None:
    desk = Desk(app_url)
    cases = [("en", "1.5", "1,5"), ("nl", "1,5", "1.5"), ("fr", "1,5", "1.5"), ("ar", "١٫٥", "1,5")]
    for language, good, bad in cases:
        ns = review_page(desk, language)
        path = f"/api/r/{ns.token}/length"
        assert anon(app_url, "POST", path, json={"length": good}).json() == {"seconds": "1.5", "frames": 36}
        refused = assert_error(anon(app_url, "POST", path, json={"length": bad}), 422)
        assert refused["fields"]["length"] == PRIVATE_COPY[language]["number"]
        assert send_note(app_url, ns.token, length=good).status_code == 201
        note = desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)["notes"][0]
        assert note["suggestedSeconds"] == "1.5" and note["suggestedFrames"] == 36
        assert_error(send_note(app_url, ns.token, length=bad), 422)
    arabic = review_page(desk, "ar")
    assert anon(app_url, "POST", f"/api/r/{arabic.token}/length", json={"length": "1.5"}).json()["frames"] == 36
    english = review_page(desk, "en")
    path = f"/api/r/{english.token}/length"
    assert anon(app_url, "POST", path, json={"length": "60"}).json()["seconds"] == "60"
    for bad in ("0", "60.001", "1.2345", "-1"):
        assert_error(anon(app_url, "POST", path, json={"length": bad}), 422)
    assert anon(app_url, "POST", path, json={"length": THREE_DECIMALS}).json()["seconds"] == THREE_DECIMALS


def test_wf_notes_arrival(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=2, town="toronto", name=ELODIE)
    cut = desk.cut(ns.jid)["number"]
    _, token = review(desk, ns, cut)
    send_note(app_url, token, frame=1, words="First words of a note", name=TYPED_NAME)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/notes", desk) as page:
        at(page, "Notes for Night Ferry")
        expander = role(page, "button", "Expand note on frame 1")
        expander.click()
        expect(expander).to_have_attribute("aria-expanded", "true")
        table = role(page, "region", "Notes table")
        mark(table)
        expander.focus()
        assert send_note(app_url, token, frame=2, words="A second note arrives", name=TYPED_NAME).status_code == 201
        expect(role(page, "checkbox", "Select note on frame 2")).to_be_visible(timeout=REFRESH_WAIT_MS)
        note = next(n for n in desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)["notes"] if n["frame"] == 2)
        clock = local_clock(note["createdAt"], "America/Toronto")
        said(page, f"{ELODIE} left a note on frame 2 at {clock} Toronto time.")
        expect(expander).to_have_attribute("aria-expanded", "true")
        expect(expander).to_be_focused()
        assert marked(table), "the refresh rebuilt the table"
        assert note["typedName"] == TYPED_NAME and note["producerName"] == ELODIE


def test_wf_notes_filters_and_moves(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=3, name="Marcus Hale")
    cut = desk.cut(ns.jid)["number"]
    _, token = review(desk, ns, cut)
    send_note(app_url, token, frame=1, words="On frame one")
    send_note(app_url, token, frame=2, words="On frame two")
    desk.ok("POST", f"/api/jobs/{ns.jid}/frames/1/move", 200, json={"position": 3, "stamp": desk.board(ns.jid)["stamp"]})
    desk.ok("POST", f"/api/jobs/{ns.jid}/removals", 201, json={"frame": 2, "stamp": desk.board(ns.jid)["stamp"]})
    made = desk.cut(ns.jid, "Next pass")["number"]
    notes = {n["frame"]: n for n in desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)["notes"]}
    assert notes[1]["position"] == 2 and notes[1]["goneText"] is None
    assert notes[2]["position"] is None and notes[2]["goneText"] == f"Frame gone in Cut {made}."
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/notes", desk) as page:
        table = role(page, "region", "Notes table")
        expect(table).to_contain_text("Position 2")
        expect(table).to_contain_text(f"Frame gone in Cut {made}.")
        length = history_length(page)
        select(role(page, "combobox", "Note state"), "Open")
        expect(page).to_have_url(re.compile(r"state=open"))
        assert history_length(page) == length + 1
        select(role(page, "combobox", "Producer"), "Marcus Hale")
        expect(page).to_have_url(re.compile(rf"producer={ns.pid}"))
        state = role(page, "combobox", "State of note on frame 1")
        select(state, "Done")
        said(page, "Note marked done.")
        expect(role(page, "checkbox", "Select note on frame 1")).to_have_count(0)
        expect(h1(page)).to_be_focused()
        next_refresh(page)
        expect(h1(page)).to_be_focused()
        page.go_back()
        page.go_back()
        expect(page).not_to_have_url(re.compile(r"state="))
        select(role(page, "combobox", "State of note on frame 1"), "Won't do")
        said(page, "Note marked won't do.")
        select(role(page, "combobox", "State of note on frame 1"), "Open")
        said(page, "Note reopened.")
    assert notes[1]["id"] in [n["id"] for n in desk.ok("GET", f"/api/jobs/{ns.jid}/notes?state=open", 200)["notes"]]


def test_wf_notes_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=2)
    cut = desk.cut(ns.jid)["number"]
    _, token = review(desk, ns, cut)
    note = send_note(app_url, token, frame=1).json()["notes"][0]
    assert_shape(note)
    assert_ladder(desk, "PATCH", f"/api/notes/{note['id']}", f"/api/notes/{unknown_id()}", {"state": "done"}, invalid=False)
    assert_error(desk.call("PATCH", f"/api/notes/{note['id']}", json={"state": "nowhere"}), 422)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/notes", desk, size=PHONE) as page:
        box = role(page, "checkbox", "Select note on frame 1")
        pick(box, touch=True)
        button = role(page, "button", "Mark 1 note done")
        assert button.bounding_box()["y"] > PHONE["height"] / 2
        press(page, button, f"/api/jobs/{ns.jid}/notes/mark", copy="1 note marked done.", via="tap")
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)["notes"][0]["state"] == "done"
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/notes")
    overlay_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/notes", ("button", "Filters"), "Filters", sheet=True, live=False)
    sweep_for(browser, app_url, "notes")
    other = Desk(app_url)
    framed = staged(other, frames=2)
    _, token = review(other, framed, other.cut(framed.jid)["number"])
    assert send_note(app_url, token, frame=1).status_code == 201
    assert send_note(app_url, token, frame=2).status_code == 201
    with opened(browser, app_url, f"/desk/jobs/{framed.jid}/notes", other) as page:
        frames = iter([1, 2])
        announced_twice(page, lambda: select(role(page, "combobox", f"State of note on frame {next(frames)}"), "Done"))
        box = role(page, "checkbox", "Select note on frame 1")
        state_mark(page, box, lambda: pick(box))


def test_marking_many_notes(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=4)
    cut = desk.cut(ns.jid)["number"]
    _, token = review(desk, ns, cut)
    for frame in (1, 2, 3, 4):
        send_note(app_url, token, frame=frame, words=f"Note {frame}")
    notes = desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)["notes"]
    ids = [n["id"] for n in notes]
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/notes/mark", json={"noteIds": ids[:2] + [unknown_id()], "state": "done"}), 404)
    assert {n["state"] for n in desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)["notes"]} == {"open"}, "a refused mark changed notes"
    other = Desk(app_url)
    foreign = staged(other, frames=1)
    foreign_cut = other.cut(foreign.jid)["number"]
    _, foreign_token = review(other, foreign, foreign_cut)
    foreign_id = send_note(app_url, foreign_token).json()["notes"][0]["id"]
    assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/notes/mark", json={"noteIds": [ids[0], foreign_id], "state": "done"}), 404)
    assert {n["state"] for n in desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)["notes"]} == {"open"}
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/notes", desk) as page:
        header = role(page, "checkbox", "Select all notes")
        pick(role(page, "checkbox", "Select note on frame 1"), checked=False)
        wait_for(lambda: header.evaluate("e => e.indeterminate || e.getAttribute('aria-checked') === 'mixed'"), "the header is indeterminate", 5)
        pick(role(page, "checkbox", "Select note on frame 3"), shift=True)
        expect(role(page, "checkbox", "Select note on frame 2")).to_be_checked()
        expect(role(page, "checkbox", "Select note on frame 4")).not_to_be_checked()
        button = role(page, "button", "Mark 3 notes done")
        press(page, button, f"/api/jobs/{ns.jid}/notes/mark", copy="3 notes marked done.")
    states = {n["frame"]: n["state"] for n in desk.ok("GET", f"/api/jobs/{ns.jid}/notes", 200)["notes"]}
    assert states == {1: "done", 2: "done", 3: "done", 4: "open"}


def test_wf_sign_off_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    desk = Desk(app_url)
    email = fresh("zoe")[1]
    ns = staged(desk, frames=2, town="amsterdam", language="nl", name=ZOE, email=email)
    cut = desk.cut(ns.jid)["number"]
    copy = PRIVATE_COPY["nl"]
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/cuts", desk) as artist:
        choose_menu(artist, role(artist, "button", f"Actions for Cut {cut}"), "Ask for sign-off")
        dialog = role(artist, "dialog", "Ask for sign-off")
        select(role(dialog, "combobox", "Producer"), ZOE)
        press(artist, role(dialog, "button", "Send"), f"/api/jobs/{ns.jid}/sign-offs", copy=f"Sign-off page ready. The mail to {ZOE} is on its way.")
        letter = mail_to(mail, email, f"{copy['signHeading']}Night Ferry")[0]
        address = re.search(r"/s/[\w-]+", text(letter)).group(0)
        assert "€" not in text(letter)
        with opened(browser, app_url, address, size=PHONE) as page:
            expect(page.locator("html")).to_have_attribute("lang", "nl")
            heading_is(page, f"{copy['signHeading']}Night Ferry")
            name = page.get_by_label(copy["name"], exact=True)
            name.fill(WRONG_SIGNER)
            tap(role(page, "button", copy["signButton"]))
            expect(page.locator("body")).to_contain_text(copy["wrongName"])
            expect(name).to_have_value(WRONG_SIGNER)
            expect(name).to_have_attribute("aria-invalid", "true")
            name.fill("zoe orsted")
            press(page, role(page, "button", copy["signButton"]), f"{address.replace('/s/', '/api/s/')}/sign", via="tap", working=copy["working"])
            signed = desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/{cut}", 200)
            clock = local_clock(signed["signedOffAt"], "Europe/Amsterdam")
            expect(page.locator("body")).to_contain_text(f"{copy['signed']}{clock} {copy['phrase']}.")
        said(artist, f"Cut {cut} signed off by {ZOE} at {clock} Amsterdam time.")
    assert signed["signedOffBy"] == ZOE, "the typed name replaced the name held"
    assert desk.ok("GET", f"/api/jobs/{ns.jid}", 200)["state"] == "signedOff"
    events = desk.ok("GET", f"/api/jobs/{ns.jid}/history", 200)["events"]
    assert any(e["action"] == "signedOff" and e["actor"] == ZOE for e in events)


def test_wf_sign_off_two_windows(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=1, town="newYork", name="Marcus Hale")
    cut = desk.cut(ns.jid)["number"]
    page_row, token = sign_page(desk, ns, cut)
    with opened(browser, app_url, page_row["url"], size=PHONE) as one, opened(browser, app_url, page_row["url"], size=PHONE) as two:
        for window in (one, two):
            window.get_by_label("Your full name", exact=True).fill("Marcus Hale")
        two.route(f"**/api/s/{token}", lambda route: None if route.request.method == "GET" else route.fallback())
        role(one, "button", "Sign off").click()
        pattern = re.compile(rf"Already signed off at {TIME_RE} New York time\.")
        expect(one.locator("body")).to_contain_text(re.compile(rf"Signed off at {TIME_RE} New York time\."))
        role(two, "button", "Sign off").click()
        expect(two.locator("body")).to_contain_text(pattern)
    answers = together([lambda: anon(app_url, "POST", f"/api/s/{token}/sign", json={"name": "marcus hale"}) for _ in range(4)])
    assert all(a.status_code == 409 for a in answers)
    fresh_ns = staged(desk, frames=1, town="newYork", name="Marcus Hale")
    fresh_cut = desk.cut(fresh_ns.jid)["number"]
    _, fresh_token = sign_page(desk, fresh_ns, fresh_cut)
    race = together([lambda: anon(app_url, "POST", f"/api/s/{fresh_token}/sign", json={"name": "Marcus Hale"}) for _ in range(6)])
    codes = sorted(a.status_code for a in race)
    assert codes == [200, 409, 409, 409, 409, 409], codes
    late = next(a for a in race if a.status_code == 409)
    assert re.fullmatch(rf"Already signed off at {TIME_RE} New York time\.", late.json()["error"]["message"])
    assert [e["action"] for e in desk.ok("GET", f"/api/jobs/{fresh_ns.jid}/history", 200)["events"]].count("signedOff") == 1


def test_wf_sign_off_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=1, name="Marcus Hale", town="newYork")
    cut = desk.cut(ns.jid)["number"]
    page_row, token = sign_page(desk, ns, cut)
    read = anon(app_url, "GET", f"/api/s/{token}").json()
    assert_shape(read)
    assert read["signedOffAt"] is None
    path = f"/api/s/{token}/sign"
    assert_ladder(desk, "POST", path, f"/api/s/{uuid.uuid4().hex}/sign", {"name": "x"}, auth=False)
    page_rules(browser, app_url, None, page_row["url"])
    with opened(browser, app_url, page_row["url"]) as page:
        name = page.get_by_label("Your full name", exact=True)
        tab_to(page, name)
        page.keyboard.type("Marcus Hale")
        press(page, role(page, "button", "Sign off"), f"/api/s/{token}/sign", via="enter")
        expect(page.locator("body")).to_contain_text(re.compile(rf"Signed off at {TIME_RE} New York time\."))
    assert_error(anon(app_url, "POST", path, json={"name": "Wrong Person"}), 422, message=PRIVATE_COPY["en"]["wrongName"])
    sweep_for(browser, app_url, "signOff")
    other = Desk(app_url)
    framed = staged(other, frames=1, name="Marcus Hale", town="newYork")
    row, _ = sign_page(other, framed, other.cut(framed.jid)["number"])
    with opened(browser, app_url, row["url"]) as page:
        page.get_by_label("Your full name", exact=True).fill("Wrong Person")
        announced_twice(page, role(page, "button", "Sign off").click)


def test_sign_off_rules(app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=1, town="toronto", language="fr", name=ELODIE)
    first = desk.cut(ns.jid)["number"]
    _, token = sign_page(desk, ns, first)
    newer = desk.cut(ns.jid, "Second pass")
    clock = local_clock(newer["createdAt"], "America/Toronto")
    message = f"Une version plus récente a été faite à {clock} heure de Toronto. Lisez-la d'abord."
    assert_error(anon(app_url, "POST", f"/api/s/{token}/sign", json={"name": ELODIE}), 409, message=message)
    assert_error(anon(app_url, "POST", f"/api/s/{token}/sign", json={"name": "Autre"}), 422)
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/{first}", 200)["signedOffAt"] is None
    _, second_token = sign_page(desk, ns, newer["number"])
    assert_error(anon(app_url, "GET", f"/api/s/{token}"), 410, "pageEnded", PRIVATE_COPY["fr"]["ended"])
    answer = anon(app_url, "POST", f"/api/s/{second_token}/sign", json={"name": "elodie tremblay"})
    assert answer.status_code == 200 and INSTANT.match(answer.json()["signedOffAt"])
    assert answer.json()["signedOffText"].startswith("Validé à ")
    copy = "A signed-off cut can't change."
    assert_error(desk.call("PATCH", f"/api/jobs/{ns.jid}/cuts/{newer['number']}", json={"name": "Changed"}), 409, message=copy)
    assert_error(desk.call("DELETE", f"/api/jobs/{ns.jid}/cuts/{newer['number']}"), 409, message=copy)
    frozen = desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/{newer['number']}", 200)
    desk.durations(ns.jid, {1: 40})
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/cuts/{newer['number']}", 200) == frozen, "the board moving on changed a signed cut"
    assert desk.cut(ns.jid, "Later")["number"] == newer["number"] + 1
    base = os.environ["APP_SHORT_URL"]
    short = Desk(base)
    timed = staged(short, frames=1, name="Marcus Hale")
    cut = short.cut(timed.jid)["number"]
    page_row, short_token = sign_page(short, timed, cut)
    ends = datetime.datetime.strptime(page_row["endsAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)

    def ended() -> bool:
        reply = anon(base, "GET", f"/api/s/{short_token}")
        served = datetime.datetime.strptime(reply.headers["date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=datetime.timezone.utc)
        if reply.status_code == 200:
            assert served < ends + datetime.timedelta(seconds=1), "still open past its instant"
            return False
        assert_error(reply, 410, "pageEnded")
        assert served >= ends - datetime.timedelta(seconds=1), "ended before its instant"
        return True

    wait_for(ended, "the sign-off page ends at its instant")
    assert_error(anon(base, "POST", f"/api/s/{short_token}/sign", json={"name": "Marcus Hale"}), 410, "pageEnded")
    other = short.ok("POST", f"/api/jobs/{timed.jid}/sign-offs", 201, json={"producerId": timed.pid, "cut": cut})
    assert short.ok("POST", f"/api/sign-offs/{other['id']}/end", 200)["state"] == "ended"


def future_slot(days: int) -> str:
    return plus(today(), days)


def test_wf_calls_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    desk = Desk(app_url)
    email = fresh("caller")[1]
    client = desk.client(place="newYork")
    producer = desk.producer(client["id"], town="newYork", language="en", name="Marcus Hale", email=email)
    start = future_slot(20)
    week = (day(start) - datetime.timedelta(days=day(start).weekday())).isoformat()
    with opened(browser, app_url, f"/desk/calls?week={week}", desk) as page:
        at(page, "Calls")
        role(page, "button", "Book a call").click()
        dialog = role(page, "dialog", "Book a call")
        select(role(dialog, "combobox", "Producer"), "Marcus Hale")
        role(dialog, "textbox", "Date").fill(start)
        role(dialog, "textbox", "Time").fill("09:00")
        select(role(dialog, "combobox", "Minutes"), "30")
        role(dialog, "textbox", "Note").fill("First look, cut 2")
        press(page, role(dialog, "button", "Save"), "/api/calls", copy="Call booked.", after=role(page, "button", "Book a call"))
        call = desk.ok("GET", "/api/calls", 200)["calls"][0]
        utc = wall_utc(start, "09:00", "America/New_York")
        assert call["startsAt"] == utc and call["town"] == "newYork"
        amsterdam = local_clock(utc, "Europe/Amsterdam")
        line = re.compile(rf"{pretty_re(start)}, 09:00 New York time · {amsterdam} Amsterdam time")
        assert line.fullmatch(call["text"])
        expect(page.locator("body")).to_contain_text(line)
        mail_to(mail, email, count=1)
        role(page, "button", "Book a call").click()
        dialog = role(page, "dialog", "Book a call")
        select(role(dialog, "combobox", "Producer"), "Marcus Hale")
        role(dialog, "textbox", "Date").fill(start)
        role(dialog, "textbox", "Time").fill("09:15")
        select(role(dialog, "combobox", "Minutes"), "30")
        role(dialog, "textbox", "Note").fill(OVERLAP_NOTE)
        role(dialog, "button", "Save").click()
        expect(dialog).to_contain_text(re.compile(rf"That time was just taken at {TIME_RE} Amsterdam time\. Pick another\."))
        expect(role(dialog, "textbox", "Note")).to_have_value(OVERLAP_NOTE)
        assert focus_inside(page, dialog)
        role(dialog, "button", "Close").click()
        moved_day = plus(start, 1 if day(start).weekday() < 6 else -1)
        mover = role(page, "button", "Move call")
        mover.click()
        moved = role(page, "dialog", "Move call")
        role(moved, "textbox", "Date").fill(moved_day)
        role(moved, "textbox", "Time").fill("10:00")
        press(page, role(moved, "button", "Save"), f"/api/calls/{call['id']}", copy="Call moved.")
        again = desk.ok("GET", "/api/calls", 200)["calls"][0]
        assert again["startsAt"] == wall_utc(moved_day, "10:00", "America/New_York") and again["sequence"] == 1
        press(page, role(page, "button", "Cancel call"), f"/api/calls/{call['id']}/cancel", copy="Call cancelled.", after=h1(page))
        expect(role(page, "button", "Cancel call")).to_have_count(0)
    final = desk.ok("GET", "/api/calls", 200)["calls"][0]
    assert final["state"] == "cancelled" and final["uid"] == call["uid"] and producer["id"] == final["producerId"]
    subjects = [m["Subject"] for m in mail_to(mail, email, count=3)]
    assert any(s.startswith("Call cancelled: ") for s in subjects)


def test_wf_calls_layouts(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    client = desk.client(place="newYork")
    desk.producer(client["id"], town="newYork", name="Marcus Hale")
    producer = desk.ok("GET", f"/api/clients/{client['id']}/producers", 200)["producers"][0]
    now = desk.ok("GET", "/api/today", 200)
    assert re.fullmatch(r"\d{4}-\d\d-\d\d", now["date"]) and day(now["weekStart"]).weekday() == 0
    monday = plus(now["weekStart"], 14)
    for offset in range(7):
        desk.ok("POST", "/api/calls", 201, json={"producerId": producer["id"], "date": plus(monday, offset), "time": "09:00", "minutes": 30, "note": "First look, cut 2"})
    path = f"/desk/calls?week={monday}"
    with opened(browser, app_url, path, desk) as page:
        grid = role(page, "grid", "Week in Amsterdam time")
        expect(grid).to_be_visible()
        stops = """el => [...el.querySelectorAll('[tabindex="0"]')].length"""
        wait_for(lambda: grid.evaluate(stops) == 1, "the grid has one roving Tab stop", 5)
        for _ in range(TAB_LIMIT):
            page.keyboard.press("Tab")
            if focus_inside(page, grid):
                break
        assert focus_inside(page, grid), "Tab never reached the week grid"
        page.keyboard.press("ArrowRight")
        wait_for(lambda: focus_inside(page, grid) and grid.evaluate(stops) == 1, "the arrow keeps focus and one Tab stop in the grid", 5)
        assert plus(monday, 7) in role(page, "link", "Later week").get_attribute("href")
        assert plus(monday, -7) in role(page, "link", "Earlier week").get_attribute("href")
    lefts = """() => new Set([...document.querySelectorAll('button')].filter(b => b.getClientRects().length && b.textContent.trim() === 'Move call')
      .map(b => Math.round(b.getBoundingClientRect().left))).size"""
    for size, count in ((TABLET, 2), (PHONE, 1)):
        with opened(browser, app_url, path, desk, size=size) as page:
            expect(role(page, "button", "Move call").first).to_be_visible()
            expect(page.get_by_role("grid")).to_have_count(0)
            assert page.evaluate(lefts) == count, f"expected {count} agenda columns at {size}"
    with opened(browser, app_url, "/api/health", desk) as page:
        page.clock.set_fixed_time(f"{plus(now['date'], 90)}T12:00:00Z")
        page.goto(f"{app_url}/desk/calls")
        expect(role(page, "link", "Later week")).to_have_attribute("href", re.compile(plus(now["weekStart"], 7)))


def test_wf_calls_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    client = desk.client(place="newYork")
    producer = desk.producer(client["id"], town="newYork")
    body = {"producerId": producer["id"], "date": future_slot(30), "time": "09:00", "minutes": 30, "note": "First look, cut 2"}
    call = desk.ok("POST", "/api/calls", 201, json=body)
    assert_shape(call)
    assert_ladder(desk, "POST", "/api/calls", f"/api/calls/{unknown_id()}/cancel", {"minutes": 30}, wrong="DELETE", invalid=True)
    past = desk.call("POST", "/api/calls", json={**body, "date": plus(today(), -2)})
    assert "That time has passed." in json.dumps(assert_error(past, 422))
    assert_error(desk.call("GET", "/api/calls?from=15-03-2027"), 422)
    page_rules(browser, app_url, desk, "/desk/calls")
    overlay_rules(browser, app_url, desk, "/desk/calls", ("button", "Book a call"), "Book a call", ("combobox", "Producer"))
    sweep_for(browser, app_url, "calls")
    other = Desk(app_url)
    framed = staged(other, frames=0)
    slot = future_slot(5)
    other.ok("POST", "/api/calls", 201, json={"producerId": framed.pid, "date": slot, "time": "11:00", "minutes": 30, "note": "First look, cut 2"})
    with opened(browser, app_url, "/desk/calls", other) as page:
        role(page, "button", "Book a call").click()
        dialog = role(page, "dialog", "Book a call")
        select(role(dialog, "combobox", "Producer"), framed.producer["name"])
        role(dialog, "textbox", "Date").fill(slot)
        role(dialog, "textbox", "Time").fill("11:00")
        select(role(dialog, "combobox", "Minutes"), "30")
        announced_twice(page, role(dialog, "button", "Save").click)


def test_wall_clock_calls(app_url: str) -> None:
    desk = Desk(app_url)
    client = desk.client(place="newYork")
    start = today()
    york = desk.producer(client["id"], town="newYork")
    dam = desk.producer(client["id"], town="amsterdam")

    def book(producer: dict, date: str, clock: str) -> httpx.Response:
        return desk.call("POST", "/api/calls", json={"producerId": producer["id"], "date": date, "time": clock, "minutes": 30, "note": "First look, cut 2"})

    changes = clock_changes("America/New_York", plus(start, 2))
    change = changes[0][0]
    before, after = plus(change, -2), plus(change, 1)
    for date in (before, after):
        answer = book(york, date, "09:00")
        assert answer.status_code == 201, answer.text
        call = answer.json()
        assert call["startsAt"] == wall_utc(date, "09:00", "America/New_York")
        assert (call["date"], call["time"]) == (date, "09:00")
        amsterdam = local_clock(call["startsAt"], "Europe/Amsterdam")
        assert re.fullmatch(rf"{pretty_re(date)}, 09:00 New York time · {amsterdam} Amsterdam time", call["text"])
    spring = next(d for d, forward in changes if forward)
    autumn = next(d for d, forward in changes if not forward)
    refused = assert_error(book(york, spring, "02:30"), 422)
    assert re.search(rf"02:30 does not exist in New York on {pretty_re(spring)}\.", json.dumps(refused, ensure_ascii=False))
    twice = book(york, autumn, "01:30")
    assert twice.status_code == 201 and twice.json()["startsAt"] == wall_utc(autumn, "01:30", "America/New_York")
    dam_autumn = next(d for d, forward in clock_changes("Europe/Amsterdam", plus(start, 2)) if not forward)
    first = book(dam, dam_autumn, "02:30")
    assert first.status_code == 201 and first.json()["startsAt"] == wall_utc(dam_autumn, "02:30", "Europe/Amsterdam")
    slot = plus(start, 45)
    race = together([lambda: book(york, slot, "16:00") for _ in range(6)])
    codes = sorted(a.status_code for a in race)
    assert codes == [201, 409, 409, 409, 409, 409], codes
    loser = next(a for a in race if a.status_code == 409)
    assert re.fullmatch(rf"That time was just taken at {TIME_RE} Amsterdam time\. Pick another\.", loser.json()["error"]["message"])
    winner = next(a for a in race if a.status_code == 201).json()
    desk.ok("POST", f"/api/calls/{winner['id']}/cancel", 200)
    assert book(york, slot, "16:00").status_code == 201, "a cancelled call still holds its slot"
    listed = desk.ok("GET", f"/api/calls?from={slot}&to={slot}", 200)["calls"]
    assert {c["state"] for c in listed} == {"booked", "cancelled"}
    assert [c["startsAt"] for c in listed] == sorted(c["startsAt"] for c in listed)


def unfolded(raw: bytes) -> dict[str, str]:
    assert raw.endswith(b"\r\n") and b"\n" not in raw.replace(b"\r\n", b""), "line ends are not CRLF"
    lines = raw[:-2].split(b"\r\n")
    for line in lines:
        assert len(line) <= 75, f"a line runs past 75 octets: {line!r}"
        line.decode("utf-8")
    joined = raw.decode("utf-8").replace("\r\n ", "").replace("\r\n\t", "")
    fields: dict[str, str] = {}
    for line in joined.split("\r\n"):
        key, _, value = line.partition(":")
        fields[key.split(";")[0]] = value
    return fields


def test_calendar_files(app_url: str, mail: Mailpit) -> None:
    desk = Desk(app_url)
    client = desk.client(place="newYork")
    email = fresh("calendar")[1]
    producer = desk.producer(client["id"], town="newYork", language="fr", name=ELODIE, email=email)
    note = "Première, revue; cut\\2 " + "é" * 60
    date = future_slot(50)
    call = desk.ok("POST", "/api/calls", 201, json={"producerId": producer["id"], "date": date, "time": "09:00", "minutes": 30, "note": note})
    first_mail = mail_to(mail, email, f"Appel le {date}")[0]
    raw = calendar_bytes(mail, first_mail)
    fields = unfolded(raw)
    assert fields["VERSION"] == "2.0" and fields["PRODID"] and fields["METHOD"] == "REQUEST"
    assert fields["SUMMARY"] == f"Call with {ELODIE}"
    assert fields["DESCRIPTION"] == note.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    assert "mailto:" in fields["ORGANIZER"] and email in fields["ATTENDEE"]
    stamp = call["startsAt"].replace("-", "").replace(":", "")
    assert fields["DTSTART"] == stamp and fields["DTEND"].endswith("Z")
    assert fields["DTEND"] == call["endsAt"].replace("-", "").replace(":", "")
    assert fields["SEQUENCE"] == "0" and fields["UID"] == call["uid"]
    moved_date = plus(date, 1)
    desk.ok("PATCH", f"/api/calls/{call['id']}", 200, json={"date": moved_date, "time": "09:00", "minutes": 60})
    moved = unfolded(calendar_bytes(mail, mail_to(mail, email, f"Appel le {moved_date}")[0]))
    assert moved["UID"] == fields["UID"] and moved["SEQUENCE"] == "1" and moved["METHOD"] == "REQUEST"
    desk.ok("POST", f"/api/calls/{call['id']}/cancel", 200)
    cancelled = unfolded(calendar_bytes(mail, mail_to(mail, email, f"Appel annulé : {moved_date}")[0]))
    assert cancelled["UID"] == fields["UID"] and cancelled["SEQUENCE"] == "2" and cancelled["METHOD"] == "CANCEL"


def signed_with(desk: Desk, ns: types.SimpleNamespace) -> int:
    cut = desk.cut(ns.jid)["number"]
    _, token = sign_page(desk, ns, cut)
    answer = anon(desk.base, "POST", f"/api/s/{token}/sign", json={"name": ns.producer["name"]})
    assert answer.status_code == 200, answer.text
    return cut


def seeded_job(desk: Desk, title: str) -> dict:
    return next(j for j in desk.ok("GET", "/api/jobs", 200)["jobs"] if j["title"] == title)


def test_wf_delivery_package_journey(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = signed_job(desk, frames=2)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/delivery", desk) as page:
        at(page, "Delivery for Night Ferry")
        select(role(page, "combobox", "Cut"), f"Cut {ns.cut}")
        press(page, role(page, "button", "Make package"), f"/api/jobs/{ns.jid}/packages", copy="Package ready.")
        package = desk.ok("GET", f"/api/jobs/{ns.jid}/packages", 200)["packages"][0]
        assert package["state"] == "ready" and {f["kind"] for f in package["files"]} == {"boards", "editDecisionList", "shotList"}
        names = {"boards": "boards.pdf", "editDecisionList": "edit-decision-list.edl", "shotList": "shot-list.csv"}
        links = {"boards": "Download boards PDF", "editDecisionList": "Download edit decision list", "shotList": "Download shot list"}
        for row in package["files"]:
            stored = S3().get(f"clients/{ns.cid}/jobs/{ns.jid}/packages/{package['id']}/{names[row['kind']]}")
            assert hashlib.sha256(stored).hexdigest() == row["sha256"] and len(stored) == row["size"]
            assert link_bytes(page, role(page, "link", links[row["kind"]])) == stored
    assert desk.ok("GET", f"/api/jobs/{ns.jid}", 200)["state"] == "delivered"
    again = desk.call("POST", f"/api/jobs/{ns.jid}/packages", json={"cut": ns.cut})
    assert again.status_code == 200 and again.json()["id"] == package["id"]


def test_wf_delivery_package_outages(browser: Browser) -> None:
    for variable, bucket, copy in (("APP_GOTENBERG_DOWN_URL", "-render", "The PDF service is unavailable right now. Nothing was saved."),
                                   ("APP_MINIO_DOWN_URL", None, "The file store is unavailable right now. Nothing was saved.")):
        base = os.environ[variable]
        desk = Desk(base, NOOR, SEED_PASSWORD)
        job = seeded_job(desk, "Harbour Light")
        assert_error(desk.call("POST", f"/api/jobs/{job['id']}/packages", json={"cut": 1}), 503, message=copy)
        with opened(browser, base, f"/desk/jobs/{job['id']}/delivery", desk) as page:
            select(role(page, "combobox", "Cut"), "Cut 1")
            role(page, "button", "Make package").click()
            said(page, copy)
            expect(role(page, "link", "Download boards PDF")).to_have_count(0)
        assert desk.ok("GET", f"/api/jobs/{job['id']}/packages", 200)["packages"] == []
        assert desk.ok("GET", f"/api/jobs/{job['id']}", 200)["state"] == "signedOff"
        if bucket:
            assert S3(bucket).keys(f"clients/{job['clientId']}/jobs/{job['id']}/packages/") == []


def test_wf_delivery_package_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = signed_job(desk, frames=1)
    assert_ladder(desk, "POST", f"/api/jobs/{ns.jid}/packages", f"/api/jobs/{unknown_id()}/packages", {"cut": 1}, invalid=False)
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/delivery")
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/delivery", desk, size=PHONE) as page:
        select(role(page, "combobox", "Cut"), f"Cut {ns.cut}")
        press(page, role(page, "button", "Make package"), f"/api/jobs/{ns.jid}/packages", copy="Package ready.", via="tap")
    assert_shape(desk.ok("GET", f"/api/jobs/{ns.jid}/packages", 200))
    sweep_for(browser, app_url, "delivery")
    other = Desk(app_url)
    framed = staged(other, frames=1, drawn=True)
    number = other.cut(framed.jid)["number"]
    with opened(browser, app_url, f"/desk/jobs/{framed.jid}/delivery", other) as page:
        select(role(page, "combobox", "Cut"), f"Cut {number}")
        announced_twice(page, role(page, "button", "Make package").click)


def test_delivery_file_formats(app_url: str) -> None:
    desk = Desk(app_url)

    def package_of(ns: types.SimpleNamespace, cut: int) -> str:
        return desk.ok("POST", f"/api/jobs/{ns.jid}/packages", 201, json={"cut": cut})["id"]

    def edl_job(rate: str, title: str) -> bytes:
        ns = staged(desk, rate=rate, frames=2, title=title)
        desk.upload(ns.jid, png(int(uuid.uuid4().int % 2**24)), "Étude.png")
        desk.upload(ns.jid, png(int(uuid.uuid4().int % 2**24)), "plain.png")
        desk.durations(ns.jid, {1: 38, 2: 12})
        package = package_of(ns, signed_with(desk, ns))
        return desk.call("GET", f"/api/packages/{package}/files/editDecisionList").content

    drop = edl_job("29.97", "Ørsted Œuvre").decode("ascii")
    assert drop.removesuffix("\r\n") == "\r\n".join([
        "TITLE: Orsted OEuvre", "FCM: DROP FRAME", "",
        "001  AX       V     C        00:00:00;00 00:00:01;08 01:00:00;00 01:00:01;08", "* FROM CLIP NAME: Etude.png",
        "002  AX       V     C        00:00:00;00 00:00:00;12 01:00:01;08 01:00:01;20", "* FROM CLIP NAME: plain.png",
    ])
    pal = edl_job("25", "É" * 80).decode("ascii")
    assert pal.removesuffix("\r\n") == "\r\n".join([
        "TITLE: " + "E" * 70, "FCM: NON-DROP FRAME", "",
        "001  AX       V     C        00:00:00:00 00:00:01:13 01:00:00:00 01:00:01:13", "* FROM CLIP NAME: Etude.png",
        "002  AX       V     C        00:00:00:00 00:00:00:12 01:00:01:13 01:00:02:00", "* FROM CLIP NAME: plain.png",
    ])
    shots = staged(desk, frames=0)
    desk.script(shots.jid, [("=1", '@x "q"', "-no", "1.52"), ("+2", "\ttab", "plain", "1")])
    for n in range(2):
        desk.upload(shots.jid, png(int(uuid.uuid4().int % 2**24)))
    package = package_of(shots, signed_with(desk, shots))
    sheet = desk.call("GET", f"/api/packages/{package}/files/shotList").content.decode("utf-8")
    lines = sheet.split("\r\n")
    assert lines[0].replace('"', "") == SHOT_HEADER.replace('"', "")
    assert lines[1] == SHOT_ROW_ONE
    assert lines[2] == SHOT_ROW_TWO
    assert "\n" not in sheet.replace("\r\n", "")
    boards = staged(desk, frames=13, drawn=True)
    package = package_of(boards, signed_with(desk, boards))
    pdf = desk.call("GET", f"/api/packages/{package}/files/boards").content
    assert pdf_pages(pdf) == 3, "13 frames make 3 pages"
    words = pdf_text(pdf)
    for number, timecode in ((1, "00:00:00:00"), (7, "00:00:06:00"), (13, THIRTEENTH_IN)):
        assert f"Action {number}." in words, f"the caption of frame {number} lacks its action note"
        assert timecode in words, f"the caption of frame {number} lacks its timecode"
        assert re.search(rf"(?<![\d:]){number}(?![\d:])", re.sub(r"Action \d+\.", "", words)), f"the caption lacks frame number {number}"


def test_package_refusals_and_download_limit(wiremock: Any) -> None:
    base = os.environ["APP_SHORT_URL"]
    desk = Desk(base)
    unsigned = staged(desk, frames=1, drawn=True)
    cut = desk.cut(unsigned.jid)["number"]
    assert_error(desk.call("POST", f"/api/jobs/{unsigned.jid}/packages", json={"cut": cut}), 409, message="Only a signed-off cut can be delivered.")
    bare = staged(desk, frames=1)
    assert_error(desk.call("POST", f"/api/jobs/{bare.jid}/packages", json={"cut": signed_with(desk, bare)}), 409, message="Frame 1 has no drawing yet.")
    ns = signed_job(desk, frames=1)
    start = today()
    cue = desk.ok("POST", f"/api/jobs/{ns.jid}/cues", 201, json={"trackId": "hr-1001", "title": "Lantern Street", "composer": "Ilse Voss", "seconds": 30, "market": "NL", "from": plus(start, -9), "until": plus(start, -1)})
    refused = desk.call("POST", f"/api/jobs/{ns.jid}/packages", json={"cut": ns.cut})
    assert re.fullmatch(rf"The licence for Lantern Street ended on {pretty_re(plus(start, -1))}\.", assert_error(refused, 409)["message"])
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/packages", 200)["packages"] == []
    assert S3("-short").keys(f"clients/{ns.cid}/jobs/{ns.jid}/packages/") == []
    desk.ok("DELETE", f"/api/jobs/{ns.jid}/cues/{cue['id']}", 204)
    package = desk.ok("POST", f"/api/jobs/{ns.jid}/packages", 201, json={"cut": ns.cut})
    for _ in range(5):
        assert desk.call("GET", f"/api/packages/{package['id']}/files/shotList").status_code == 200
    limited = desk.call("GET", f"/api/packages/{package['id']}/files/boards")
    error = assert_error(limited, 429)
    assert re.fullmatch(rf"Too many downloads for now\. You can download again at {TIME_RE} Amsterdam time\.", error["message"])
    assert limited.headers["retry-after"].isdigit()
    other = Desk(base)
    theirs = signed_job(other, frames=1)
    their_package = other.ok("POST", f"/api/jobs/{theirs.jid}/packages", 201, json={"cut": theirs.cut})
    assert other.call("GET", f"/api/packages/{their_package['id']}/files/shotList").status_code == 200, "the limit is not keyed on the desk"


def test_wf_fee_letters_journey(browser: Browser, app_url: str, mail: Mailpit) -> None:
    desk = Desk(app_url)
    email = fresh("feepay")[1]
    ns = staged(desk, frames=1, language="nl", name=ZOE, email=email)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/letter", desk) as artist:
        at(artist, "Fee letter for Night Ferry")
        select(role(artist, "combobox", "Currency"), "EUR")
        role(artist, "textbox", "Fee").fill("not money")
        role(artist, "textbox", "Scope").fill("Boards and story reel for one :30")
        role(artist, "button", "Save letter").click()
        problems(artist, role(artist, "textbox", "Fee"), "Type an amount such as 1835.50.")
        role(artist, "textbox", "Fee").fill("5506.50")
        press(artist, role(artist, "button", "Save letter"), f"/api/jobs/{ns.jid}/letter", copy="Letter saved.")
        for amount in ("€1,835.50", "€385.46", "€1,156.38"):
            expect(artist.locator("body")).to_contain_text(amount)
        select(role(artist, "combobox", "Producer"), ZOE)
        letter = desk.ok("GET", f"/api/jobs/{ns.jid}/letter", 200)
        press(artist, role(artist, "button", "Send letter"), f"/api/letters/{letter['id']}/send", copy=f"Fee page ready. The mail to {ZOE} is on its way.")
        address = re.search(r"/f/[\w-]+", text(mail_to(mail, email, "Your fee letter for Night Ferry")[0])).group(0)
        with opened(browser, app_url, address, size=PHONE) as page:
            at_title = "Fee letter for Night Ferry"
            heading_is(page, at_title)
            expect(page.locator("body")).to_contain_text("€1,156.38")
            assert role(page, "link", "Open the letter").count() == 1
            name = page.get_by_label("Your full name", exact=True)
            name.fill("Somebody Else")
            tap(role(page, "button", "Accept letter"))
            expect(page.locator("body")).to_contain_text("That name doesn't match. Type your full name as it was given.")
            name.fill("ZOE ORSTED")
            press(page, role(page, "button", "Accept letter"), f"{address.replace('/f/', '/api/f/')}/accept", copy="Letter accepted.", via="tap")
        said(artist, f"Letter accepted by {ZOE}.")
    locked = desk.ok("GET", f"/api/jobs/{ns.jid}/letter", 200)
    assert locked["state"] == "accepted" and locked["taxMinor"] == WORKED_TAX_MINOR
    assert_error(desk.call("PATCH", f"/api/letters/{locked['id']}", json={"currency": "EUR", "fee": "1.00", "scope": "x", "stamp": locked["stamp"]}), 409, message="This letter is accepted and can't change.")


def test_wf_fee_letters_stale(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=1, town="toronto", name=ELODIE, place="ontario")
    letter = desk.ok("POST", f"/api/jobs/{ns.jid}/letter", 201, json={"currency": "CAD", "fee": "6000.00", "scope": "Boards and story reel"})
    sent = desk.ok("POST", f"/api/letters/{letter['id']}/send", 200, json={"producerId": ns.pid})
    message = re.compile(rf"This letter was changed at {TIME_RE} Toronto time\. Read it again\.")
    with opened(browser, app_url, sent["pageUrl"]) as page:
        page.get_by_label("Your full name", exact=True).fill(ELODIE)
        stale_stamp = sent["stamp"]
        changed = desk.ok("PATCH", f"/api/letters/{letter['id']}", 200, json={"currency": "CAD", "fee": "6100.00", "scope": "Boards", "stamp": stale_stamp})
        assert changed["feeText"] == NEW_FEE_TEXT
        role(page, "button", "Accept letter").click()
        expect(page.locator("body")).to_contain_text(message)
    token = sent["pageUrl"].rsplit("/", 1)[-1]
    assert message.fullmatch(assert_error(anon(app_url, "POST", f"/api/f/{token}/accept", json={"name": ELODIE, "stamp": stale_stamp}), 412)["message"])
    assert desk.ok("GET", f"/api/jobs/{ns.jid}/letter", 200)["state"] == "sent"
    assert_error(desk.call("PATCH", f"/api/letters/{letter['id']}", json={"currency": "CAD", "fee": "1.00", "scope": "x", "stamp": stale_stamp}), 412)


def test_wf_fee_letters_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=1)
    assert_ladder(desk, "POST", f"/api/jobs/{ns.jid}/letter", f"/api/jobs/{unknown_id()}/letter", {"currency": "EUR"})
    assert_error(desk.call("GET", f"/api/jobs/{ns.jid}/letter"), 404)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/letter", desk) as page:
        select(role(page, "combobox", "Currency"), "EUR")
        role(page, "textbox", "Fee").fill("100.00")
        role(page, "textbox", "Scope").fill("Boards")
        press(page, role(page, "button", "Save letter"), f"/api/jobs/{ns.jid}/letter", copy="Letter saved.", via="enter")
    assert_shape(desk.ok("GET", f"/api/jobs/{ns.jid}/letter", 200))
    page_rules(browser, app_url, desk, f"/desk/jobs/{ns.jid}/letter")
    sweep_for(browser, app_url, "letter", "fee")
    other = Desk(app_url)
    framed = staged(other, frames=1)
    with opened(browser, app_url, f"/desk/jobs/{framed.jid}/letter", other) as page:
        select(role(page, "combobox", "Currency"), "EUR")
        role(page, "textbox", "Scope").fill("Boards")
        fees = iter(["100.00", "200.00"])

        def save() -> None:
            role(page, "textbox", "Fee").fill(next(fees))
            role(page, "button", "Save letter").click()

        announced_twice(page, save)


def test_fee_letter_arithmetic(app_url: str) -> None:
    desk = Desk(app_url)
    cases = [
        ("netherlands", "EUR", "5506.50", [183550] * 3, 115638, "€5,506.50", "€1,156.38", "€6,662.88"),
        ("netherlands", "EUR", "12500.00", [416667, 416667, 416666], 262500, "€12,500.00", "€2,625.00", "€15,125.00"),
        ("ontario", "CAD", "6000.00", [200000] * 3, 78000, "CA$6,000.00", "CA$780.00", "CA$6,780.00"),
        ("newYork", "USD", "1835.50", [61184, 61183, 61183], 0, "US$1,835.50", "US$0.00", "US$1,835.50"),
        ("dubai", "USD", "0.02", [1, 1, 0], 0, "US$0.02", "US$0.00", "US$0.02"),
    ]
    for place, currency, fee, parts, tax, fee_text, tax_text, total_text in cases:
        ns = staged(desk, frames=0, place=place)
        letter = desk.ok("POST", f"/api/jobs/{ns.jid}/letter", 201, json={
            "currency": currency, "fee": fee, "scope": "Boards", "totalMinor": 1, "taxMinor": 1, "state": "accepted", "jobId": unknown_id()})
        assert letter["state"] == "draft" and letter["jobId"] == ns.jid, "an extra body field changed the letter"
        assert [m["amountMinor"] for m in letter["milestones"]] == parts and sum(parts) == letter["feeMinor"]
        assert (letter["taxMinor"], letter["totalMinor"]) == (tax, letter["feeMinor"] + tax)
        assert (letter["feeText"], letter["taxText"], letter["totalText"]) == (fee_text, tax_text, total_text)
    assert letter["milestones"][0]["number"] == 1
    half = staged(desk, frames=0)
    made = desk.ok("POST", f"/api/jobs/{half.jid}/letter", 201, json={"currency": "EUR", "fee": "5506.50", "scope": "Boards"})
    assert made["milestones"][0]["taxText"] == "€385.46" and made["milestones"][0]["amountText"] == "€1,835.50"
    for bad in ("0", "-1.00", "1835.505", "1,835.50"):
        refused = desk.call("PATCH", f"/api/letters/{made['id']}", json={"currency": "EUR", "fee": bad, "scope": "Boards", "stamp": made["stamp"]})
        assert "Type an amount such as 1835.50." in json.dumps(assert_error(refused, 422))
    sent = desk.ok("POST", f"/api/letters/{made['id']}/send", 200, json={"producerId": half.pid})
    assert sent["state"] == "sent"
    pdf = desk.call("GET", f"/api/letters/{made['id']}/pdf").content
    assert S3().get(f"clients/{half.cid}/jobs/{half.jid}/letters/{made['id']}/fee-letter.pdf") == pdf
    assert pdf_pages(pdf) >= 1
    words = pdf_text(pdf)
    for amount in ("€5,506.50", "€1,156.38", "€6,662.88", "€1,835.50"):
        assert amount in words, amount
    token = sent["pageUrl"].rsplit("/", 1)[-1]
    assert anon(app_url, "GET", f"/api/f/{token}/pdf").content == pdf


def test_fee_letter_outages(mail: Mailpit) -> None:
    for variable, bucket, copy in (("APP_GOTENBERG_DOWN_URL", "-render", "The PDF service is unavailable right now. Nothing was saved."),
                                   ("APP_MINIO_DOWN_URL", None, "The file store is unavailable right now. Nothing was saved.")):
        base = os.environ[variable]
        desk = Desk(base)
        email = fresh("outage")[1]
        ns = staged(desk, frames=0, email=email)
        letter = desk.ok("POST", f"/api/jobs/{ns.jid}/letter", 201, json={"currency": "EUR", "fee": "100.00", "scope": "Boards"})
        assert_error(desk.call("POST", f"/api/letters/{letter['id']}/send", json={"producerId": ns.pid}), 503, message=copy)
        assert desk.ok("GET", f"/api/jobs/{ns.jid}/letter", 200)["state"] == "draft"
        if bucket:
            assert S3(bucket).keys(f"clients/{ns.cid}/jobs/{ns.jid}/letters/") == []
        quiet_until = time.monotonic() + MAIL_QUIET_S
        while time.monotonic() < quiet_until:
            assert [m for m in mail.messages(0) if email in addresses(m.get("To"))] == [], "an unsent letter mailed its page"
            threading.Event().wait(POLL_S)


def test_wf_closing_a_client_journey(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=1)
    cut = desk.cut(ns.jid)["number"]
    _, token = review(desk, ns, cut)
    name = ns.client["name"]
    path = f"/desk/clients/{ns.cid}"
    with opened(browser, app_url, path, desk) as page:
        at(page, name)
        role(page, "button", "Close client").click()
        dialog = role(page, "dialog", "Close client")
        press(page, role(dialog, "button", "Start closing"), f"/api/clients/{ns.cid}/close")
        closing = desk.ok("GET", f"/api/clients/{ns.cid}", 200)
        assert closing["state"] == "closing" and INSTANT.match(closing["closesAt"])
        date = datetime.datetime.strptime(closing["closesAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).astimezone(ZoneInfo("Europe/Amsterdam")).date().isoformat()
        said(page, re.compile(rf".*Closing {re.escape(name)}\. You can bring it back until {pretty_re(date)}\..*"))
        expect(page.locator("body")).to_contain_text("Closing")
        assert_error(anon(app_url, "GET", f"/api/r/{token}"), 410, "pageEnded")
        copy = "This client is closing and can't change."
        assert_error(desk.call("PATCH", f"/api/clients/{ns.cid}", json={"name": "No"}), 409, message=copy)
        assert_error(desk.call("POST", f"/api/jobs/{ns.jid}/cuts", json={"name": "No"}), 409)
        assert desk.ok("GET", f"/api/jobs/{ns.jid}", 200)["id"] == ns.jid
        back = role(page, "button", "Bring back")
        press(page, back, f"/api/clients/{ns.cid}/bring-back", copy=f"{name} is back.")
    restored = desk.ok("GET", f"/api/clients/{ns.cid}", 200)
    assert restored["state"] == "active" and restored["closesAt"] is None
    assert anon(app_url, "GET", f"/api/r/{token}").status_code == 200
    assert_error(desk.call("POST", f"/api/clients/{ns.cid}/bring-back"), 409, message="This client is not closing.")


def test_wf_closing_a_client_erasing_outage(browser: Browser) -> None:
    base = os.environ["APP_MINIO_DOWN_URL"]
    desk = Desk(base)
    client = desk.client()
    closing = desk.ok("POST", f"/api/clients/{client['id']}/close", 200)
    ends = datetime.datetime.strptime(closing["closesAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)

    def erasing() -> bool:
        answer = desk.call("GET", f"/api/clients/{client['id']}")
        served = datetime.datetime.strptime(answer.headers["date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=datetime.timezone.utc)
        assert answer.status_code == 200, f"the client read answered {answer.status_code}: {answer.text[:200]}"
        state = answer.json()["state"]
        if served > ends:
            assert state != "closing", "still closing past closesAt"
        return state == "erasing"

    wait_for(erasing, "the client reads erasing from closesAt", 20)
    assert_error(desk.call("POST", f"/api/clients/{client['id']}/bring-back"), 409, message="The time to bring this client back has passed.")
    with opened(browser, base, f"/desk/clients/{client['id']}", desk) as page:
        expect(page.locator("body")).to_contain_text("Erasing")
        next_refresh(page)
        next_refresh(page)
        expect(page.locator("body")).not_to_contain_text("Erased")
    assert desk.ok("GET", f"/api/clients/{client['id']}", 200)["state"] == "erasing", "erased with MinIO down"


def test_wf_closing_a_client_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    assert_cookie(desk)
    ns = staged(desk, frames=0)
    assert_shape(ns.client)
    assert_ladder(desk, "POST", f"/api/clients/{ns.cid}/close", f"/api/clients/{unknown_id()}/close", json_body=False)
    path = f"/desk/clients/{ns.cid}"
    page_rules(browser, app_url, desk, path)
    overlay_rules(browser, app_url, desk, path, ("button", "Close client"), "Close client", live=False)
    with opened(browser, app_url, path, desk, size=PHONE) as page:
        tap(role(page, "button", "Close client"))
        dialog = role(page, "dialog", "Close client")
        press(page, role(dialog, "button", "Start closing"), f"/api/clients/{ns.cid}/close", via="tap")
        expect(role(page, "button", "Bring back")).to_be_visible()
    assert desk.ok("GET", f"/api/clients/{ns.cid}", 200)["state"] == "closing"
    sweep_for(browser, app_url, "client", "clients")
    other = Desk(app_url)
    framed = staged(other, frames=0)
    with opened(browser, app_url, f"/desk/clients/{framed.cid}", other) as page:
        announced_twice(page, role(page, "button", "Delete client").click)


def test_bring_back_and_erasure(browser: Browser) -> None:
    base = os.environ["APP_SHORT_URL"]
    desk = Desk(base)
    kept = staged(desk, frames=1, drawn=True)
    before = (desk.ok("GET", f"/api/clients/{kept.cid}/producers", 200), desk.board(kept.jid))
    desk.ok("POST", f"/api/clients/{kept.cid}/close", 200)
    assert desk.ok("POST", f"/api/clients/{kept.cid}/bring-back", 200)["state"] == "active"
    assert (desk.ok("GET", f"/api/clients/{kept.cid}/producers", 200), desk.board(kept.jid)) == before
    ns = staged(desk, frames=2, drawn=True)
    cut = desk.cut(ns.jid)["number"]
    _, token = review(desk, ns, cut)
    note = send_note(base, token).json()["notes"][0]
    letter = desk.ok("POST", f"/api/jobs/{ns.jid}/letter", 201, json={"currency": "EUR", "fee": "100.00", "scope": "Boards"})
    sent = desk.ok("POST", f"/api/letters/{letter['id']}/send", 200, json={"producerId": ns.pid})
    bucket = S3("-short")
    prefix = f"clients/{ns.cid}/"
    assert len(bucket.keys(prefix)) >= 3
    desk.ok("POST", f"/api/clients/{ns.cid}/close", 200)

    def erased() -> bool:
        return desk.call("GET", f"/api/clients/{ns.cid}").status_code == 404

    wait_for(erased, "the client answers 404 after the wait", WAIT_CAP_S)
    assert bucket.keys(prefix) == [], "MinIO objects remain after Erased"
    listing = desk.ok("GET", "/api/clients", 200)
    assert ns.cid not in [c["id"] for c in listing["clients"]]
    entry = next(c for c in listing["erasedClients"] if c["id"] == ns.cid)
    assert set(entry) == {"id", "name", "erasedAt"} and INSTANT.match(entry["erasedAt"])
    for path in (f"/api/jobs/{ns.jid}", f"/api/jobs/{ns.jid}/board", f"/api/producers/{ns.pid}", f"/api/notes/{note['id']}", f"/api/letters/{letter['id']}/pdf"):
        method = "PATCH" if "producers" in path or "notes" in path else "GET"
        assert_error(desk.call(method, path, json={}) if method == "PATCH" else desk.call(method, path), 404)
    assert_error(desk.call("POST", f"/api/clients/{ns.cid}/bring-back"), 404)
    for path in (f"/api/r/{token}", f"/api/f/{sent['pageUrl'].rsplit('/', 1)[-1]}"):
        assert_error(anon(base, "GET", path), 404)
    assert desk.ok("GET", f"/api/search?q={ns.client['name']}", 200)["total"] == 0
    with opened(browser, base, "/desk/clients", desk) as page:
        expect(page.locator("body")).to_contain_text("Erased")
        response = page.goto(f"{base}/desk/clients/{ns.cid}")
        assert response.status == 404
        heading_is(page, "Page not found")


def test_seed_data(browser: Browser, app_url: str) -> None:
    noor = Desk(app_url, NOOR, SEED_PASSWORD)
    assert noor.name == "Noor Bakker"
    listing = noor.ok("GET", "/api/clients", 200)
    places = {c["name"]: c["place"] for c in listing["clients"]}
    assert places == {"Hudson Yard Pictures": "newYork", "STICHTINGNOORDZEEPRODUCTIESENPARTNERSHOOFDKANTOORAMSTERDAM": "netherlands",
                      "Maple & Lake Films": "ontario", "Gulf Meridian Airways": "dubai"} and listing["total"] == 4
    people = {}
    for client in listing["clients"]:
        for person in noor.ok("GET", f"/api/clients/{client['id']}/producers", 200)["producers"]:
            people[person["name"]] = (person["email"], person["town"], person["language"])
    assert people == {"Marcus Hale": ("marcus.hale@hudsonyard.example", "newYork", "en"), ZOE: ("zoe.orsted@noordzee.example", "amsterdam", "nl"),
                      ELODIE: ("elodie.tremblay@mapleandlake.example", "toronto", "fr"), LAYLA: ("layla.haddad@gulfmeridian.example", "dubai", "ar")}
    jobs = {j["title"]: j for j in noor.ok("GET", "/api/jobs", 200)["jobs"]}
    expected = {"Harbour Light": ("29.97", 30, "HUDS0000301H", [75] * 12, "exact", "signedOff"),
                "Polder Run": ("25", 30, "NOOR0000302H", [62] * 11 + [68], "exact", "draft"),
                "Maple Line": ("23.976", 15, "MAPL0000303H", [30] * 12, "exact", "inReview"),
                "Gulf Morning": ("25", 6, "GULF0000304D", [12] * 12, "6 frames under", "draft")}
    assert set(jobs) == set(expected)
    for title, (rate, target, ad_id, durations, target_text, state) in expected.items():
        job = jobs[title]
        assert (job["frameRate"], job["targetSeconds"], job["adId"], job["aspect"], job["state"]) == (rate, target, ad_id, "16:9", state)
        board = noor.board(job["id"])
        assert [f["durationFrames"] for f in board["frames"]] == durations and board["targetText"] == target_text
        first = board["frames"][0]
        assert (first["number"], first["shot"], first["actionNote"], first["visual"], first["audioNote"], first["fileName"]) == (1, "1", "Action for frame 1.", "Action for frame 1.", "", "frame-1.svg")
        assert (first["width"], first["height"]) == (1280, 720)
        cuts = noor.ok("GET", f"/api/jobs/{job['id']}/cuts", 200)["cuts"]
        assert [(c["number"], c["name"]) for c in cuts] == [(1, "First pass"), (2, "Second pass")]
        assert noor.call("GET", f"/api/jobs/{job['id']}/frames/1/drawing").status_code == 200
    harbour, maple, polder = jobs["Harbour Light"]["id"], jobs["Maple Line"]["id"], jobs["Polder Run"]["id"]
    assert noor.ok("GET", f"/api/jobs/{harbour}/cuts/1", 200)["signedOffBy"] == "Marcus Hale"
    assert {(n["text"], n["state"], n["frame"], n["producerName"]) for n in noor.ok("GET", f"/api/jobs/{harbour}/notes", 200)["notes"]} == {
        ("Hold the harbour light a beat longer.", "open", 4, "Marcus Hale"), ("Bring the boat in from the left.", "done", 4, "Marcus Hale")}
    assert [(n["text"], n["producerName"]) for n in noor.ok("GET", f"/api/jobs/{maple}/notes", 200)["notes"]] == [("Le plan est un peu court.", ELODIE)]
    assert [r["state"] for r in noor.ok("GET", f"/api/jobs/{maple}/reviews", 200)["reviews"]] == ["ended"]
    ended_cue = noor.ok("GET", f"/api/jobs/{polder}/cues", 200)["cues"]
    assert [(c["trackId"], c["market"], c["fee"], c["licenceId"]) for c in ended_cue] == [("hr-1001", "NL", "120.00", "lic-401")]
    assert ended_cue[0]["licenceText"].startswith("Licence ended on ")
    live_cue = noor.ok("GET", f"/api/jobs/{maple}/cues", 200)["cues"]
    assert [(c["trackId"], c["market"], c["licenceId"]) for c in live_cue] == [("hr-1002", "CA", "lic-402")]
    calls = noor.ok("GET", "/api/calls", 200)["calls"]
    assert [(c["producerName"], c["time"], c["minutes"], c["town"]) for c in calls] == [("Marcus Hale", "09:00", 30, "newYork")] * 2
    assert all(day(c["date"]).weekday() < 5 for c in calls)
    letter = noor.ok("GET", f"/api/jobs/{maple}/letter", 200)
    assert (letter["currency"], letter["feeMinor"], letter["scope"], letter["state"]) == ("CAD", 600000, "Boards and story reel", "sent")
    theo = Desk(app_url, THEO, SEED_PASSWORD)
    assert theo.name == "Theo Lindqvist"
    theo_clients = theo.ok("GET", "/api/clients", 200)["clients"]
    assert [(c["name"], c["place"]) for c in theo_clients] == [("Fjordlight Studio", "netherlands")]
    assert theo.ok("GET", f"/api/clients/{theo_clients[0]['id']}/producers", 200)["producers"] == []
    quiet = theo.ok("GET", "/api/jobs", 200)["jobs"]
    assert [(j["title"], j["frameRate"], j["targetSeconds"], j["adId"], j["state"]) for j in quiet] == [("Quiet Harbour", "25", 15, "FJOR0000401H", "draft")]
    assert theo.board(quiet[0]["id"])["frames"] == []
    with opened(browser, app_url, "/reel") as page:
        works = page.locator('[data-part="work"]')
        expect(works).to_have_count(9)
        shown = " ".join(works.all_inner_texts())
        for name in ("Ferry at First Light", "The Long Bakery Shift", "Cold Snap Cola", "Night Tram", "Harbour Swimmers", "Paper Kites", "Rainline Coats", "Orchard Bank", "Salt and Thyme"):
            assert name in shown, name


SWEEP_IDS = ["jobs", "clients", "client", "calls", "board", "script", "reel", "lines", "cues", "cuts", "compare", "notes", "delivery", "letter", "review", "signOff", "fee"]
TOUCH_JS = """min => { const bad = [];
  for (const el of document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=link],[role=menuitem],[role=combobox],[role=radio],[role=checkbox],[role=option]')) {
    if (!el.getClientRects().length || el.closest('[data-part="clip"],[inert]')) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    let box = el;
    if (el.matches('input[type=radio],input[type=checkbox]') && el.labels && el.labels[0]) box = el.labels[0];
    const r = box.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    if (el.tagName === 'A' && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 2 && getComputedStyle(el).display === 'inline') continue;
    if (r.width < min - 0.5 || r.height < min - 0.5) bad.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  } return bad; }"""
CUT_JS = """() => { const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const owner = n.parentElement;
    if (!owner || !owner.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    if (owner.closest('[aria-hidden="true"],[data-part="client-strip"],[data-part="timecode"]')) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const text = range.getBoundingClientRect();
    if (text.width < 1 || text.height < 1) continue;
    const label = n.textContent.trim().slice(0, 40);
    if (getComputedStyle(owner).textOverflow === 'ellipsis' && owner.scrollWidth > owner.clientWidth + 1) { bad.push(label); continue; }
    let skipStatic = false;
    for (let box = owner; box && box !== document.body; box = box.parentElement) {
      const s = getComputedStyle(box);
      if (!(skipStatic && s.position === 'static')) {
        skipStatic = false;
        const x = s.overflowX === 'hidden' || s.overflowX === 'clip', y = s.overflowY === 'hidden' || s.overflowY === 'clip';
        if (x || y) {
          const b = box.getBoundingClientRect();
          if (b.width <= 2 || b.height <= 2) break;
          const slack = parseFloat(getComputedStyle(owner).fontSize) * 0.3; /* the font's content area passes a tight line box with no ink cut */
          if ((x && (text.right > b.right + 1 || text.left < b.left - 1)) || (y && (text.bottom > b.bottom + slack || text.top < b.top - slack))) { bad.push(label); break; }
        }
      }
      if (s.position === 'fixed') break;
      if (s.position === 'absolute') skipStatic = true;
    }
  }
  return bad; }"""
SPACING_CSS = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }"


def sweep_world(base: str) -> tuple[Desk, dict[str, tuple[str, tuple[str, str] | None, bool]]]:
    desk = Desk(base)
    client = desk.client("L" * 80, "netherlands")
    producer = desk.producer(client["id"], name="P" * 80)
    job = desk.job(client["id"])
    jid = job["id"]
    desk.script(jid, [(n, f"Action {n}.", "", "1") for n in (1, 2)])
    ns = types.SimpleNamespace(jid=jid, pid=producer["id"], cid=client["id"], client=client, producer=producer, job=job)
    desk.cut(jid)
    desk.cut(jid, "Second pass")
    review_row, token = review(desk, ns, 2)
    sign_row, _ = sign_page(desk, ns, 2)
    send_note(base, token)
    letter = desk.ok("POST", f"/api/jobs/{jid}/letter", 201, json={"currency": "EUR", "fee": "100.00", "scope": "Boards"})
    sent = desk.ok("POST", f"/api/letters/{letter['id']}/send", 200, json={"producerId": producer["id"]})
    desk.ok("POST", "/api/calls", 201, json={"producerId": producer["id"], "date": plus(today(), 2), "time": "11:00", "minutes": 30, "note": "First look, cut 2"})
    job_path = f"/desk/jobs/{jid}"
    return desk, {
        "jobs": ("/desk/jobs", ("button", "New job"), True), "clients": ("/desk/clients", ("button", "New client"), True),
        "client": (f"/desk/clients/{client['id']}", ("button", "New producer"), True), "calls": ("/desk/calls", ("button", "Book a call"), True),
        "board": (job_path, ("button", "Upload frames"), True), "script": (f"{job_path}/script", ("button", "Save"), True),
        "reel": (f"{job_path}/reel", ("button", "Play"), True), "lines": (f"{job_path}/lines", ("button", "Save"), True),
        "cues": (f"{job_path}/cues", ("button", "Add cue"), True), "cuts": (f"{job_path}/cuts", ("button", "Make cut"), True),
        "compare": (f"{job_path}/compare?a=1&b=2&wipe=50", ("slider", "Wipe"), True), "notes": (f"{job_path}/notes", None, True),
        "delivery": (f"{job_path}/delivery", ("button", "Make package"), True), "letter": (f"{job_path}/letter", ("button", "Save letter"), True),
        "review": (review_row["url"], ("button", "Next"), False), "signOff": (sign_row["url"], ("button", "Sign off"), False),
        "fee": (sent["pageUrl"], ("button", "Accept letter"), False),
    }


def printed_text(browser: Browser, base: str, desk: Desk | None, path: str, foreign: bool, moved_to: str) -> str:
    options: dict[str, Any] = {"locale": "de-DE", "timezone_id": "Pacific/Auckland"} if foreign else {"locale": "en-US", "timezone_id": "UTC"}
    context = browser.new_context(viewport=WIDE, **options)
    try:
        page = context.new_page()
        if foreign:
            page.clock.set_fixed_time(moved_to)
        if desk is not None:
            assert context.request.post(base + "/api/sign-in", data={"email": desk.email, "password": desk.password}).ok
        page.goto(base + path)
        expect(h1(page)).to_be_visible()
        page.wait_for_load_state("networkidle")
        return re.sub(r"\s+", " ", page.locator("body").inner_text())
    finally:
        context.close()


@pytest.mark.parametrize("route", SWEEP_IDS, ids=SWEEP_IDS)
def test_route_sweep(browser: Browser, app_url: str, route: str) -> None:
    desk, routes = sweep_world(app_url)
    path, main, signed_in = routes[route]
    sweep(browser, app_url, desk if signed_in else None, path, main)


def test_motion_system(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=2)
    seen: set[float] = set()

    def collect(page: Page, act: Callable[[], None], want: frozenset[int] = frozenset()) -> None:
        motion_durations(page, act, seen, want)

    with opened(browser, app_url, "/how-it-works") as page:
        collect(page, role(page, "button", "From script to frames").click)
        collect(page, role(page.get_by_role("banner"), "link", "Reel").hover)
        collect(page, lambda: page.evaluate("() => scrollTo(0, 60)"))
        collect(page, role(page.get_by_role("banner"), "link", "Reel").click)
        at(page, "Work on the reel")
        expect(page.locator('[data-part="route-wipe"]')).to_have_count(0)
        collect(page, lambda: pick(role(role(page, "radiogroup", "Kind of work"), "radio", "Boards")))
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}", desk) as page:
        collect(page, role(page, "button", "Edit job").click)
        page.keyboard.press("Escape")
        expect(role(page, "dialog", "Edit job")).to_have_count(0)
        collect(page, role(page, "button", "Actions for frame 1").click)
    with opened(browser, app_url, f"/desk/jobs/{ns.jid}/reel", desk) as page:
        off_frame_zero(page)
        collect(page, lambda: pick(role(role(page, "radiogroup", "Frame rate"), "radio", "29.97")), frozenset({640}))
    assert seen <= ALLOWED_DURATIONS, f"durations outside the published set: {sorted(seen)}"
    assert {160, 320, 640} <= seen, f"a published duration never ran: {sorted(seen)}"


def test_landing_routes_and_menu_sheet(browser: Browser, app_url: str) -> None:
    desk = Desk(app_url)
    name = fresh("landing")[0]
    with opened(browser, app_url, "/desk/clients", desk) as page:
        role(page, "button", "New client").click()
        dialog = role(page, "dialog", "New client")
        role(dialog, "textbox", "Name").fill(name)
        select(role(dialog, "combobox", "Place"), "Ontario")
        press(page, role(dialog, "button", "Save"), "/api/clients", copy="Client added.", after=h1(page))
        expect(page).to_have_url(re.compile(r"/desk/clients/[0-9a-f-]{36}$"))
        at(page, name)
        address = page.url
        page.reload()
        at(page, name)
        assert page.url == address
        page.goto(address)
        at(page, name)
    assert desk.ok("GET", f"/api/clients/{address.rsplit('/', 1)[-1]}", 200)["place"] == "ontario"
    title = fresh("landed")[0]
    with opened(browser, app_url, "/desk/jobs", desk) as page:
        role(page, "button", "New job").click()
        dialog = role(page, "dialog", "New job")
        select(role(dialog, "combobox", "Client"), name)
        role(dialog, "textbox", "Title").fill(title)
        role(dialog, "textbox", "Ad-ID").fill("NOOR1234567H")
        role(dialog, "textbox", "Due date").fill(plus(today(), 21))
        select(role(dialog, "combobox", "Target length"), ":30")
        select(role(dialog, "combobox", "Frame rate"), "25")
        select(role(dialog, "combobox", "Aspect"), "16:9")
        press(page, role(dialog, "button", "Save"), "/api/jobs", copy="Job added.", after=h1(page))
        expect(page).to_have_url(re.compile(r"/desk/jobs/[0-9a-f-]{36}$"))
        at(page, title)
        job_address = page.url
        page.reload()
        at(page, title)
        page.goto(job_address)
        at(page, title)
    for start, landing, heading in (("/sign-in", r"/desk/jobs$", "Jobs"), ("/sign-in?next=/desk/calls", r"/desk/calls$", "Calls")):
        with opened(browser, app_url, start) as page:
            role(page, "textbox", "Email").fill(desk.email)
            role(page, "textbox", "Password").fill(desk.password)
            role(page, "button", "Sign in").click()
            expect(page).to_have_url(re.compile(landing))
            at(page, heading)
            page.reload()
            at(page, heading)
            assert page.context.request.get(app_url + "/api/session").status == 200
    for size in (TABLET, PHONE):
        with opened(browser, app_url, "/desk/clients", desk, size=size) as page:
            expect(page.get_by_role("dialog")).to_have_count(0)
            expect(role(page, "button", "Change password")).to_have_count(0)
            assert "Change password" not in tab_order(page, 12), "a closed Menu sheet holds Tab stops"
            opener = role(page, "button", "Menu")
            opener.click()
            sheet = role(page, "dialog", "Menu")
            for kind, label in (("link", "Jobs"), ("link", "Clients"), ("link", "Calls"), ("button", "Change password"), ("button", "Sign out")):
                expect(role(sheet, kind, label)).to_be_visible()
            page.keyboard.press("Escape")
            expect(opener).to_be_focused()
            expect(sheet).to_have_count(0)
    with opened(browser, app_url, "/") as page:
        answer = page.goto(f"{app_url}/no-such-address-here")
        assert answer.status == 404
        at(page, "Page not found")
        answer = page.goto(f"{app_url}/desk/clients")
        expect(page).to_have_url(re.compile(r"/sign-in\?next="))


def test_foreign_origins(app_url: str) -> None:
    desk = Desk(app_url)
    foreign = {"Origin": "http://elsewhere.example"}
    assert_cookie(desk)
    name = fresh("origin")[0]
    assert_error(desk.call("POST", "/api/clients", json={"name": name, "place": "dubai"}, headers=foreign), 403)
    assert name not in json.dumps(desk.ok("GET", "/api/clients", 200))
    client = desk.client()
    assert_error(desk.call("DELETE", f"/api/clients/{client['id']}", headers=foreign), 403)
    assert desk.ok("GET", f"/api/clients/{client['id']}", 200)["id"] == client["id"]
    assert_error(anon(app_url, "POST", "/api/sign-in", json={"email": desk.email, "password": PASSWORD}, headers=foreign), 403)
    for answer in (desk.call("GET", "/api/clients", headers=foreign), desk.call("OPTIONS", "/api/clients", headers={**foreign, "Access-Control-Request-Method": "POST"})):
        assert answer.headers.get("access-control-allow-origin") != foreign["Origin"]
        assert not (answer.headers.get("access-control-allow-origin") and answer.headers.get("access-control-allow-credentials") == "true")
    origin = str(httpx.URL(app_url)).rstrip("/")
    assert desk.call("POST", "/api/clients", json={"name": name, "place": "dubai"}, headers={"Origin": origin}).status_code == 201


def test_session_ends_mid_form(browser: Browser) -> None:
    base = os.environ["APP_SESSION_URL"]
    desk = Desk(base)
    with opened(browser, base, "/desk/clients", desk) as page:
        role(page, "button", "New client").click()
        dialog = role(page, "dialog", "New client")
        typed = "Typed before the session ended"
        role(dialog, "textbox", "Name").fill(typed)
        select(role(dialog, "combobox", "Place"), "Ontario")
        later = Desk(base, desk.email)
        wait_for(lambda: later.call("GET", "/api/session").status_code == 401, "the session ends after SESSION_SECONDS")
        assert_error(later.call("GET", "/api/session"), 401, "session_ended")
        assert_error(anon(base, "GET", "/api/session"), 401, "notSignedIn")
        role(dialog, "button", "Save").click()
        said(page, SESSION_COPY)
        expect(dialog).to_be_visible()
        expect(role(dialog, "textbox", "Name")).to_have_value(typed)
        for _ in range(REFRESH_WAIT_MS // 1000):
            hold_for(page, 1)
            assert role(dialog, "textbox", "Name").input_value() == typed, "the dialog lost what was typed"
        role(dialog, "link", "Sign in again").click()
        expect(page).to_have_url(re.compile(r"/sign-in"))
        role(page, "textbox", "Email").fill(desk.email)
        role(page, "textbox", "Password").fill(PASSWORD)
        role(page, "button", "Sign in").click()
        expect(page).to_have_url(re.compile(r"/desk/clients$"))
        dialog = role(page, "dialog", "New client")
        expect(dialog).to_be_visible()
        expect(role(dialog, "textbox", "Name")).to_have_value(typed)
    assert typed not in json.dumps(Desk(base, desk.email).ok("GET", "/api/clients", 200)), "the refused save was stored"


def test_one_api_shape(app_url: str) -> None:
    desk = Desk(app_url)
    ns = staged(desk, frames=1)
    cut = desk.cut(ns.jid)
    for path in ("/api/session", "/api/clients", "/api/jobs", f"/api/jobs/{ns.jid}", f"/api/jobs/{ns.jid}/board", f"/api/jobs/{ns.jid}/cuts", f"/api/jobs/{ns.jid}/history", "/api/calls", "/api/today"):
        assert_shape(desk.ok("GET", path, 200))
    assert_shape(cut)
    for path in ("/api/users", "/api/admin", "/api/debug", "/api/frames", "/api/jobs/export", "/api/config", "/api/metrics"):
        assert_error(desk.call("GET", path), 404)
    for path in ("/package.json", "/run.json", "/.env", "/src/index.ts", "/tsconfig.json"):
        answer = anon(app_url, "GET", path)
        assert not [mark for mark in SOURCE_MARKS if mark in answer.text], path
    assert_error(anon(app_url, "DELETE", "/api/health"), 405)
    theirs = Desk(app_url).client()
    missing, foreign = desk.call("GET", f"/api/clients/{unknown_id()}"), desk.call("GET", f"/api/clients/{theirs['id']}")
    assert_error(foreign, 404)
    assert foreign.json() == missing.json(), "another desk's client differs from an unknown id"
    wrong_current = assert_error(desk.call("POST", "/api/password", json={"currentPassword": "not-the-password", "newPassword": "new-password-2027"}), 422)
    assert "That current password doesn't match." in json.dumps(wrong_current, ensure_ascii=False)
    bad = desk.call("POST", "/api/clients", json={"name": "", "place": "nowhere"})
    error = assert_error(bad, 422)
    assert set(error["fields"]) <= {"name", "place"} and error["fields"]
    assert_error(anon(app_url, "POST", "/api/clients", content=b"x" * (JSON_LIMIT + 1), headers={"Content-Type": "application/json"}), 413)
    limit_ok = desk.call("POST", "/api/clients", content=json.dumps({"name": "Size", "place": "dubai", "pad": "x" * (JSON_LIMIT - 60)}).ljust(JSON_LIMIT).encode(), headers={"Content-Type": "application/json"})
    assert limit_ok.status_code == 201, "a body at the limit is allowed"
    assert_ladder(desk, "POST", "/api/clients", f"/api/clients/{unknown_id()}/close", {"name": "Lantern Row Films"}, wrong="DELETE")


def test_run_manifest_and_health(app_url: str) -> None:
    manifest = json.loads((DEPLOYED_APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[key], str) and manifest[key] for key in ("install", "build", "serve"))
    answer = anon(app_url, "GET", "/api/health")
    assert answer.status_code == 200 and answer.json() == {"status": "ok"}
    assert answer.headers["content-type"].startswith("application/json")


def test_copies_start_safely(mail: Mailpit) -> None:
    urls = [os.environ[name] for name in ("APP_MINIO_DOWN_URL", "APP_GOTENBERG_DOWN_URL", "APP_SHORT_URL", "APP_SESSION_URL")]
    marker = fresh("copyonly")[0]
    first = Desk(urls[2])
    first.client(marker)
    for base in urls:
        assert anon(base, "GET", "/api/health").json() == {"status": "ok"}
        noor = Desk(base, NOOR, SEED_PASSWORD)
        clients = noor.ok("GET", "/api/clients", 200)
        assert clients["total"] >= 4
        titles = [j["title"] for j in noor.ok("GET", "/api/jobs?limit=25", 200)["jobs"]]
        for title in ("Harbour Light", "Polder Run", "Maple Line", "Gulf Morning"):
            assert titles.count(title) == 1, f"{title} seeded {titles.count(title)} times on {base}"
        assert marker not in json.dumps(clients), "copies share a database"
    assert anon(urls[3], "POST", "/api/sign-in", json={"email": first.email, "password": PASSWORD}).status_code == 401, "copies share a database"
    for base in urls:
        name, email = fresh("copy")
        assert anon(base, "POST", "/api/enquiries", json={"name": name, "email": email, "message": "Do you board a :15?"}).status_code == 202
        assert len(mail_to(mail, ARTIST_MAIL, f"Enquiry from {name}")) == 1


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "Unlicense", "OFL-1.1"}
SOURCE_SUFFIXES = {".ts", ".tsx", ".html", ".css", ".json", ".mts"}


LIBRE_FRANKLIN = r"libre[\s_-]*franklin"
SOURCE_SERIF = r"source[\s_-]*serif[\s_-]*4"
FONT_LOADED_JS = """(pattern) => [...document.fonts].some(f => f.status === 'loaded' && new RegExp(pattern, 'i').test(f.family))"""


def source_files() -> list[Any]:
    skipped = {"node_modules", "dist", "build", ".next", "test", "tests", "e2e", "__tests__", "scripts"}
    return [p for p in DEPLOYED_APP.rglob("*") if p.is_file() and p.suffix in SOURCE_SUFFIXES and p.suffix != ".md"
            and not skipped & set(p.parts) and p.name != "package-lock.json" and ".test." not in p.name and ".spec." not in p.name]


def test_if_run_manifest() -> None:
    manifest = json.loads((DEPLOYED_APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest.get(key), str) for key in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = (DEPLOYED_APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    assert re.search(LIBRE_FRANKLIN, notices, re.I) and re.search(SOURCE_SERIF, notices, re.I)


def test_if_licences() -> None:
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not refused, refused


def test_if_no_extra_datastore() -> None:
    banned = {"redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "amqplib", "kafkajs", "memcached", "nats"}
    assert not banned & {p.name for p in shipped_packages()}


def test_if_wiremock_untouched(wiremock: Any) -> None:
    offenders = [str(p) for p in source_files() if "__admin" in p.read_text(errors="ignore")]
    assert not offenders, offenders
    assert wiremock.requests("/__admin") == []


def test_if_typescript_and_no_video() -> None:
    files = source_files()
    assert any(p.suffix in {".ts", ".tsx"} for p in files), "no TypeScript source"
    assert not [str(p) for p in files if VIDEO_TAG in p.read_text(errors="ignore")]
    stock = [p for p in DEPLOYED_APP.rglob("*") if p.suffix.lower() in {".mp4", ".webm", ".mov"} and "node_modules" not in p.parts]
    assert not stock, stock


def test_if_fonts_and_same_origin(browser: Browser, app_url: str) -> None:
    notices = (DEPLOYED_APP / "THIRD_PARTY_NOTICES.md").read_text()
    assert re.search(LIBRE_FRANKLIN, notices, re.I) and re.search(SOURCE_SERIF, notices, re.I)
    with opened(browser, app_url, "/api/health") as page:
        foreign: list[str] = []
        origin = httpx.URL(app_url).host
        page.on("request", lambda r: foreign.append(r.url) if r.url.startswith("http") and httpx.URL(r.url).host != origin else None)
        page.goto(app_url + "/")
        expect(h1(page)).to_be_visible()
        page.wait_for_load_state("networkidle")
        for family in (LIBRE_FRANKLIN, SOURCE_SERIF):
            wait_for(lambda family=family: page.evaluate(FONT_LOADED_JS, family), f"a loaded font face matching {family}", ANNOUNCE_WAIT_S)
        assert not foreign, foreign
