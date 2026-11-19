import hashlib
import json
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (advance, check, click, fill, focused_name, held, layout, licence_allowed, licence_from_text,
                      open_app, pdf_text, same_origin, select, session, shipped_packages,
                      state_styles, tab_order, tap)

try:
    from conftest import Postgres, S3, addresses, mail_from_address, text as mail_text
except ImportError:
    from mailpit import addresses, mail_from_address, text as mail_text
    from minio import S3
    from postgres import Postgres

GRADING_TOKEN = os.environ.get("GRADING_TOKEN", "")
PASSWORD = "roundbook-demo-1"
LONDON = ZoneInfo("Europe/London")
DESKTOP, TABLET, PHONE = (1280, 800), (768, 1024), (375, 812)
SIZES = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}
MIN_TARGET = 44
LIVE_MS = 2000
SLACK_MS = 4000
UI_MS = LIVE_MS + SLACK_MS
HTTP_TIMEOUT = 60
POLL_SECONDS = 25
POLL_STEP = 0.25
UNDO_SECONDS = 10
BODY_LIMIT = 100_000
UPLOAD_MAX_BYTES = 10 * 1_048_576
RACERS = 6
REFRESH_MS = 15_000
LONG_PRESS_MS = 500
DAY = "2026-11-17"
CLOCK = "2026-11-17T08:50:00Z"
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NAMES = {"front": "Fern Desk", "nurse": "Nell Ward", "vet": "Dr Vera Hale",
         "vet2": "Dr Omar Lind", "mgr": "Mina Boss"}
ROLES = {"front": "front-desk", "nurse": "nurse", "vet": "vet", "vet2": "vet", "mgr": "manager"}
ROLE_LABEL = {"front": "Front desk", "nurse": "Nurse", "vet": "Vet", "mgr": "Manager"}
PETS = {"p1": ("Rex", "dog"), "p2": ("Pip", "cat"), "p3": ("Ola", "rabbit"), "p4": ("Bo", "dog")}
SALINE = "Sterile saline 500 ml"
PNG = bytes.fromhex("89504e470d0a1a0a") + b"roundbook-png-body"
JPEG = bytes.fromhex("ffd8ff") + b"roundbook-jpeg-body"
PDF = b"%PDF-1.4\nroundbook-pdf-body"
SLOT_TAKEN = "That slot was just taken. Pick another time."
FORBIDDEN = "Your role cannot do that."
NOT_FOUND_PAGE = "We couldn't find that page."
_tick = threading.Event()
REX, PIP = PETS["p1"][0], PETS["p2"][0]
VERA, FERN, NELL = NAMES["vet"], NAMES["front"], NAMES["nurse"]
MX_A, MX_B = "MX-A", "MX-B"
NEW_STAFF = "Nora New"
XRAY = "chest-xray.png"
VAT_PERCENT = 20


def joined(*parts):
    return ", ".join(parts)


def slot_name(room, when, state):
    return joined(room, when, state)


def appt_name(patient, vet, start, end, status):
    return f"{patient} with {vet}, {start} to {end}, {status}"


def opener(name):
    return f"Open {name}"


def starter(patient):
    return f"Start consult for {patient}"


def waiting_name(patient, minutes):
    return f"{patient}, waiting {minutes} min"


def money(pence):
    return f"£{pence // 100:,}.{pence % 100:02d}"


def labelled(label, pence):
    return f"{label} {money(pence)}"


def pdf_line(quantity, pence):
    return f"x{quantity} {money(pence)}"


def half_up(value, percent):
    return (value * percent * 2 + 100) // 200


def line_total(net, percent=0, vat=VAT_PERCENT):
    discount = half_up(net, percent)
    return net - discount + half_up(net - discount, vat)


def discount_note(percent):
    return f"* Discount of {percent}% applied to this line."


def vat_note():
    return f"** VAT at {VAT_PERCENT}% on the line after discount."


def clinic_name(uid):
    return f"Clinic {uid}"


def long_day(day):
    d = date.fromisoformat(day)
    return f"{DOW[d.weekday()]} {d.day:02d} {MON[d.month - 1]} {d.year}"


def due_label(day):
    return long_day(day).split(" ", 1)[1]


def vacc_name(vaccine, day):
    return f"{vaccine}, due {due_label(day)}"


def reminder_subject(pet, vaccine, day):
    return f"{pet} is due for {vaccine} on {due_label(day)}"


def history_line(day, reason, vet):
    return f"{due_label(day)} {reason} with {vet}"


def file_line(name):
    return f"File: {name}"


def booking_for(pet):
    return f"Booking for {pet}"


def stock_row(page, item, on_hand):
    return page.get_by_role("row", name=f"{item}, {on_hand} on hand")


def ward_button(cell_, verb, patient, treatment):
    return cell_.get_by_role("button", name=f"{verb}, {patient}, {treatment}")


def dose_cell(page, patient, treatment, when):
    return page.get_by_role("gridcell", name=re.compile(rf"^{re.escape(joined(patient, treatment, when))}, "))


def alerted(page, copy, timeout=UI_MS):
    expect(page.get_by_role("alert").filter(has_text=copy).first).to_be_visible(timeout=timeout)


def confirm_subject(pet, instant):
    return f"Booking confirmed: {pet} on {day_label(instant)} at {hm(instant)}"


def poll(check_fn, what, seconds=POLL_SECONDS):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check_fn()
        if value:
            return value
        _tick.wait(POLL_STEP)
    pytest.fail(f"expected {what} within {seconds}s")


def poll_once(check_fn, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check_fn():
            return True
        _tick.wait(POLL_STEP)
    return False


def utc(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


def at(hour, minute=0, day=DAY, second=0):
    return f"{day}T{hour:02d}:{minute:02d}:{second:02d}Z"


def hm(instant):
    return utc(instant).astimezone(LONDON).strftime("%H:%M")


def day_label(instant):
    d = utc(instant).astimezone(LONDON)
    return f"{DOW[d.weekday()]} {d.day:02d} {MON[d.month - 1]}"


def grading(base, method, path, body=None):
    return httpx.request(method, base + path, json=body, headers={"X-Grading-Token": GRADING_TOKEN},
                         timeout=HTTP_TIMEOUT)


def set_clock(base, instant):
    r = grading(base, "POST", "/api/grading/clock", {"now": instant})
    assert r.status_code == 200, r.text
    return r.json()["now"]


def err(r, status, code, message=None, field=None):
    assert r.status_code == status, f"{r.status_code} {r.text}"
    body = r.json()
    assert body["error"] == code, body
    if message is not None:
        assert body["message"] == message, body
    if field is not None:
        assert body["field"] == field, body
    return body


class Api:
    def __init__(self, base, email=None):
        self.c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        if email:
            r = self.c.post("/api/session", json={"email": email, "password": PASSWORD})
            assert r.status_code == 200, r.text

    def get(self, path, **kw):
        return self.c.get(path, **kw)

    def post(self, path, body=None, **kw):
        return self.c.post(path, json=body, **kw)

    def put(self, path, body=None, **kw):
        return self.c.put(path, json=body, **kw)

    def patch(self, path, body=None, **kw):
        return self.c.patch(path, json=body, **kw)

    def delete(self, path, **kw):
        return self.c.delete(path, **kw)


def appt(ref, patient, vet, room, when, status="booked", minutes=15, reason="Consult", **extra):
    return {"ref": ref, "clinic": "c", "patient": patient, "vet": vet, "room": room,
            "start": at(*when), "minutes": minutes, "reason": reason, "status": status, **extra}


def stock_item(ref, name, price, reorder, batches):
    return {"ref": ref, "clinic": "c", "name": name, "onHand": sum(b["quantity"] for b in batches),
            "reorderPoint": reorder, "unitPricePence": price, "batches": batches}


def hosp(ref, patient, kennel, treatments):
    return {"ref": ref, "patient": patient, "kennel": kennel, "treatments": treatments}


def dose(name, first, every=8, count=1, given=()):
    return {"name": name, "firstAt": first, "intervalHours": every, "count": count, "givenDoses": list(given)}


class World:
    def __init__(self, base, ids, uid):
        self.base, self.ids, self.uid, self.slug, self._api = base, ids, uid, f"clinic-{uid}", {}

    def id(self, kind, ref):
        return self.ids[kind][ref]

    def uid_of(self, who):
        return self.ids["users"][who]["id"]

    def email(self, who):
        return f"{who}.{self.uid}@example.test"

    @property
    def owner_email(self):
        return f"owner.{self.uid}@example.test"

    def api(self, who):
        if who not in self._api:
            self._api[who] = Api(self.base, self.email(who))
        return self._api[who]

    def cid(self):
        return self.api("mgr").get("/api/me").json()["clinic"]["id"]

    def tid(self, ref, i=0):
        return self.ids["treatments"][ref][i]


def make_world(base, *, clock=CLOCK, appts=(), hospitalised=(), stock=None, invoices=(), vacc=()):
    set_clock(base, clock)
    uid = uuid.uuid4().hex[:8]
    default_stock = [stock_item("s1", SALINE, 640, 4, [
        {"batch": "B1", "expiresOn": "2026-12-01", "quantity": 5},
        {"batch": "B2", "expiresOn": "2027-02-01", "quantity": 10}])]
    body = {
        "clinics": [{"ref": "c", "name": f"Clinic {uid}", "slug": f"clinic-{uid}"}],
        "users": [{"ref": k, "clinic": "c", "name": NAMES[k], "email": f"{k}.{uid}@example.test",
                   "role": ROLES[k]} for k in ROLES],
        "rooms": [{"ref": f"r{i}", "clinic": "c", "name": f"Consult {i}"} for i in (1, 2, 3)],
        "clients": [{"ref": "cl", "clinic": "c", "name": "Nia Owner", "email": f"owner.{uid}@example.test"}],
        "patients": [{"ref": r, "clinic": "c", "client": "cl", "name": n, "species": s, "weightGrams": 5000,
                      "photo": False, "vaccinations": list(vacc) if r == "p1" else [], "weights": []}
                     for r, (n, s) in PETS.items()],
        "appointments": list(appts), "hospitalised": list(hospitalised),
        "stock": default_stock if stock is None else list(stock), "invoices": list(invoices),
    }
    r = grading(base, "POST", "/api/grading/seed", body)
    assert r.status_code == 201, r.text
    return World(base, r.json(), uid)


@contextmanager
def window(browser, w, who, path="/today", size=DESKTOP, **kw):
    press = tap if kw.get("touch") else click
    with open_app(browser, f"{w.base}/login?next={quote(path, safe='')}", **kw) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        fill(page.get_by_role("textbox", name="Email"), w.email(who))
        fill(page.get_by_role("textbox", name="Password"), PASSWORD)
        press(page.get_by_role("button", name="Sign in", exact=True))
        expect(page).to_have_url(re.compile(re.escape(path) + "$"), timeout=UI_MS)
        yield page


def cell(page, room, when, state):
    return page.get_by_role("gridcell", name=f"{room}, {when}, {state}", exact=True)


def abtn(page, patient, times=None, status=None):
    span = times or r"\d\d:\d\d to \d\d:\d\d"
    return page.get_by_role("button", name=re.compile(
        rf"^{re.escape(patient)} with .*, {span}, {status or '[A-Za-z -]+'}(, late)?$"))


def ann(page):
    return page.get_by_role("status", name="Announcements")


def said(page, copy, timeout=UI_MS):
    expect(ann(page)).to_contain_text(copy, timeout=timeout)


def beacon(page, name):
    return page.get_by_role("status", name=name, exact=True)


def dlg(page, name):
    return page.get_by_role("dialog", name=name)


def ward_cell(page, patient, treatment, when, state, behind_modal=False):
    return page.get_by_role("gridcell", name=f"{patient}, {treatment}, {when}, {state}", exact=True,
                            include_hidden=behind_modal)


def has_focus(locator):
    return locator.evaluate("el => el === document.activeElement || el.contains(document.activeElement)")


def mails_to(mail, email, want=0, seconds=POLL_SECONDS, settle=1.5):
    def grab(s):
        return [m for m in mail.messages(settle=s)
                if email.lower() in [a.lower() for a in addresses(m.get("To"))]]
    if want:
        poll(lambda: len(grab(0)) >= want, f"{want} mail(s) to the test recipient", seconds)
    return grab(settle)


def touch_event(page, kind, x, y):
    points = [] if kind == "touchEnd" else [{"x": x, "y": y, "id": 1}]
    session(page).send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})


def middle(locator):
    box = locator.bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def long_press_drag(page, source, target):
    source.scroll_into_view_if_needed()
    sx, sy = middle(source)
    tx, ty = middle(target)
    touch_event(page, "touchStart", sx, sy)
    advance(page, LONG_PRESS_MS // 2)
    assert source.get_attribute("data-picked") != "true"
    advance(page, LONG_PRESS_MS // 2 + LONG_PRESS_MS // 10)
    expect(source).to_have_attribute("data-picked", "true")
    for step in (0.25, 0.5, 0.75, 1.0):
        touch_event(page, "touchMove", sx + (tx - sx) * step, sy + (ty - sy) * step)
    touch_event(page, "touchEnd", tx, ty)


def appt_by_patient(api, patient, day=DAY):
    rows = api.get(f"/api/appointments?date={day}").json()["appointments"]
    return [a for a in rows if a["patientName"] == patient]


def contrast(rgb_a, rgb_b):
    def lum(c):
        vals = [int(v) / 255 for v in re.findall(r"\d+", c)[:3]]
        vals = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in vals]
        return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2]
    hi, lo = sorted((lum(rgb_a), lum(rgb_b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def book_public(base, slug, start, vet_id, *, owner="Zoë O'Neil", email="o@example.test", pet="Pip",
                reason="Check-up", species="dog", token=None):
    body = {"start": start, "vetId": vet_id, "reason": reason, "ownerName": owner, "ownerEmail": email,
            "petName": pet, "species": species}
    if token:
        body["petToken"] = token
    return httpx.post(f"{base}/api/public/clinics/{slug}/bookings", json=body, timeout=HTTP_TIMEOUT)


def upload(api, pid, name, data, kind="xray", ctype="image/png"):
    return api.c.post(f"/api/patients/{pid}/files", files={"file": (name, data, ctype)}, data={"kind": kind})


def test_dp01_health_ok(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_dp02_grading_routes(app_url):
    for headers in ({}, {"X-Grading-Token": "wrong-token"}):
        for method, path in (("POST", "/api/grading/clock"), ("POST", "/api/grading/seed"),
                             ("GET", "/api/grading/clock")):
            r = httpx.request(method, app_url + path, headers=headers, timeout=HTTP_TIMEOUT)
            assert r.status_code == 401, (method, path, r.status_code)
    assert set_clock(app_url, CLOCK).startswith("2026-11-17T08:50")
    now = utc(grading(app_url, "GET", "/api/grading/clock").json()["now"])
    assert timedelta(0) <= now - utc(CLOCK) < timedelta(seconds=POLL_SECONDS)
    err(grading(app_url, "POST", "/api/grading/clock", {"now": "not a time"}), 422, "validation_failed", field="now")
    w = make_world(app_url)
    assert set(w.ids) >= {"clinics", "users", "rooms", "clients", "patients", "stock"}
    url = w.ids["users"]["front"]["login_url"]
    assert url.startswith("http")
    first = httpx.get(url, follow_redirects=False, timeout=HTTP_TIMEOUT)
    assert first.status_code == 302 and urlsplit(first.headers["location"]).path == "/today"
    again = httpx.get(url, follow_redirects=False, timeout=HTTP_TIMEOUT)
    assert again.status_code == 302 and urlsplit(again.headers["location"]).path == "/login"
    bad = {"clinics": [{"ref": "c", "name": "X", "slug": f"x-{uuid.uuid4().hex[:6]}"}],
           "patients": [{"ref": "p", "clinic": "c", "client": "missing", "name": "N", "species": "dog",
                         "weightGrams": 1}]}
    err(grading(app_url, "POST", "/api/grading/seed", bad), 422, "validation_failed", field="patients.0.client")


def test_dp03_error_order_and_shape(app_url):
    w, other = make_world(app_url), make_world(app_url)
    err(Api(app_url).get("/api/appointments"), 401, "unauthenticated", "Sign in to continue.")
    foreign = {"patientId": other.id("patients", "p1"), "vetId": w.uid_of("vet"), "roomId": w.id("rooms", "r1"),
               "start": at(10), "reason": "Consult"}
    own = {**foreign, "patientId": w.id("patients", "p1")}
    err(w.api("front").post("/api/appointments", foreign), 404, "not_found", "We couldn't find that.")
    err(w.api("nurse").post("/api/appointments", foreign), 404, "not_found")
    err(w.api("nurse").post("/api/appointments", own), 403, "forbidden", FORBIDDEN)
    err(w.api("front").post("/api/appointments", {**own, "reason": "Haircut"}), 422, "validation_failed",
        "Reason is not valid.", "reason")
    vet, pid = w.api("vet"), w.id("patients", "p1")
    pad_base = b'{"grams":5000,"pad":""}'
    big = b'{"grams":5000,"pad":"' + b"x" * (BODY_LIMIT + 1 - len(pad_base) + 2) + b'"}'
    err(vet.c.post(f"/api/patients/{pid}/weights", content=big, headers={"content-type": "application/json"}),
        413, "payload_too_large", "That request is too large.")
    exact = b'{"grams":5000,"pad":"' + b"x" * (BODY_LIMIT - len(pad_base)) + b'"}'
    assert len(exact) == BODY_LIMIT
    r = vet.c.post(f"/api/patients/{pid}/weights", content=exact, headers={"content-type": "application/json"})
    assert r.status_code != 413


def test_dp04_role_permissions(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0))],
                   hospitalised=[hosp("h1", "p2", "K1", [dose("meloxicam", at(20))])])
    pid, a1, item, tid = w.id("patients", "p1"), w.id("appointments", "a1"), w.id("stock", "s1"), w.tid("h1")
    inv = w.api("vet").post("/api/invoices", {"patientId": pid}).json()["id"]
    body = {"patientId": pid, "vetId": w.uid_of("vet"), "roomId": w.id("rooms", "r2"), "start": at(11), "reason": "Consult"}
    forbidden = [
        ("nurse", "POST", "/api/appointments", body), ("nurse", "POST", "/api/invoices", {"patientId": pid}),
        ("front", "POST", "/api/invoices", {"patientId": pid}), ("front", "POST", f"/api/appointments/{a1}/start", None),
        ("front", "PUT", f"/api/appointments/{a1}/note/paragraphs/1", {"text": "x", "version": 1}),
        ("vet", "POST", f"/api/invoices/{inv}/payments", {"pence": 100}),
        ("vet", "POST", f"/api/invoices/{inv}/void", {"reason": "x"}),
        ("vet", "POST", f"/api/stock/{item}/movements", {"delta": 1, "reason": "receive", "batch": "Z", "expiresOn": "2030-01-01"}),
        ("front", "GET", "/api/staff", None), ("nurse", "GET", "/api/invoices", None),
        ("front", "POST", f"/api/treatments/{tid}/given", None), ("vet", "POST", "/api/staff/invitations",
         {"email": f"x{w.uid}@example.test", "name": "X", "role": "nurse"}),
        ("front", "GET", f"/api/patients/{pid}/history.pdf", None), ("nurse", "POST", f"/api/appointments/{a1}/start", None)]
    for who, method, path, payload in forbidden:
        r = w.api(who).c.request(method, path, json=payload)
        assert r.status_code == 403 and r.json()["error"] == "forbidden", (who, method, path, r.text)
    assert w.api("front").get("/api/appointments").status_code == 200
    assert w.api("nurse").post(f"/api/patients/{pid}/weights", {"grams": 5100}).status_code == 201
    err(w.api("vet").post(f"/api/treatments/{tid}/given"), 409, "not_due")
    with window(browser, w, "nurse", "/invoices") as page:
        expect(page.get_by_text(FORBIDDEN)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("link", name="Invoices", exact=True)).to_have_count(0)
        expect(page.get_by_role("link", name="Billing", exact=True)).to_have_count(0)
        expect(page.get_by_role("link", name="Team access", exact=True)).to_have_count(0)


def test_dp04_nurse_has_no_booking_controls(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    with window(browser, w, "nurse", size=PHONE, touch=True) as page:
        agenda = page.get_by_role("list", name="Day agenda")
        expect(agenda.get_by_role("button", name=re.compile(rf"^{REX} with "))).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("button", name="Book a time")).to_have_count(0)
    with window(browser, w, "nurse") as page:
        free = cell(page, "Consult 2", "10:00", "free")
        expect(free).to_be_visible(timeout=UI_MS)
        free.focus()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowDown")
        poll(lambda: focused_name(page) == slot_name("Consult 2", "10:15", "free"), 'focus == slot_name("Consult 2", "10:15", "free")')
        expect(dlg(page, "Book appointment")).to_have_count(0)
        expect(page.get_by_role("button", name="Book", exact=True)).to_have_count(0)
    assert [r["patientName"] for r in w.api("front").get(f"/api/appointments?date={DAY}").json()["appointments"]] == [REX]


def test_dp05_live_updates(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    with window(browser, w, "front") as a, window(browser, w, "vet") as b:
        expect(cell(b, "Consult 2", "10:00", "free")).to_be_visible(timeout=UI_MS)
        body = {"patientId": w.id("patients", "p2"), "vetId": w.uid_of("vet2"), "roomId": w.id("rooms", "r2"),
                "start": at(10), "reason": "Consult"}
        assert w.api("front").post("/api/appointments", body).status_code == 201
        expect(cell(b, "Consult 2", "10:00", "booked")).to_be_visible(timeout=UI_MS)
        expect(cell(a, "Consult 2", "10:00", "booked")).to_be_visible(timeout=UI_MS)
        assert w.api("front").post(f"/api/appointments/{w.id('appointments', 'a1')}/check-in").status_code == 200
        expect(b.get_by_role("listitem", name=re.compile(r"^Rex, waiting \d+ min$"))).to_be_visible(timeout=UI_MS)


MOTION_CASES = ["normal", "reduced"]


@pytest.mark.parametrize("mode", MOTION_CASES, ids=MOTION_CASES)
def test_dp06_motion_attributes(app_url, browser, mode):
    reduced = mode == "reduced"
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0)),
                                   appt("a2", "p2", "vet2", "r2", (9, 0), status="checked-in", checkedInAt=at(8, 45))],
                   hospitalised=[hosp("h1", "p1", "K1", [dose("meloxicam", at(6)), dose("saline", at(9, 20))])])
    kw = {"reduced_motion": "reduce"} if reduced else {}
    expected = {"beacon-count": ("1600", "0.16, 1, 0.3, 1"), "toast": ("200", "ease-out"),
                "appointment-move": ("250", "0.2, 0, 0, 1")}

    def read(locator, name):
        ms, easing = expected[name]
        if reduced:
            expect(locator).to_have_attribute("data-motion", "none", timeout=UI_MS)
            expect(locator).to_have_attribute("data-motion-ms", "0")
        else:
            expect(locator).to_have_attribute("data-motion", name, timeout=UI_MS)
            expect(locator).to_have_attribute("data-motion-ms", ms)
            expect(locator).to_have_attribute("data-motion-easing", easing)
    with window(browser, w, "nurse", "/ward", **kw) as page:
        first, deadline = beacon(page, "Waiting"), time.monotonic() + UI_MS / 1000
        while first.get_attribute("data-motion") not in ("beacon-count", "none") and time.monotonic() < deadline:
            advance(page, 16)
        for card in ("Waiting", "Overdue", "Due within the hour"):
            read(beacon(page, card), "beacon-count")
            advance(page, 160)
        expect(page.locator("[data-rolling]")).to_have_count(0)
    with window(browser, w, "front", "/today", **kw) as page:
        expect(abtn(page, "Rex")).to_be_visible(timeout=UI_MS)
        abtn(page, "Rex").focus()
        page.keyboard.press("Alt+ArrowDown")
        read(abtn(page, "Rex"), "appointment-move")
        moved = abtn(page, "Rex", r"09:15 to \d\d:\d\d")
        expect(moved).to_be_visible(timeout=UI_MS)
        moved.focus()
        poll(lambda: focused_name(page).startswith("Rex with"), "focus on the moved appointment")
        page.keyboard.press("Delete")
        read(page.get_by_role("status", name="Notice"), "toast")


@pytest.mark.parametrize("size", ["phone", "tablet", "desktop"], ids=["phone", "tablet", "desktop"])
def test_dp07_layouts(app_url, browser, size):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0), status="checked-in", checkedInAt=at(8, 45))])
    width = SIZES[size][0]
    with window(browser, w, "mgr", "/today", size=SIZES[size], touch=size != "desktop") as page:
        for path in ("/today", "/ward", "/patients", "/invoices", "/stock", "/staff"):
            page.goto(w.base + path)
            expect(page.get_by_role("contentinfo")).to_be_visible(timeout=UI_MS)
            layout(page)
            small = []
            for role in ("button", "tab", "combobox", "textbox", "spinbutton", "gridcell"):
                for el in page.get_by_role(role).all():
                    box = el.bounding_box() if el.is_visible() else None
                    if box and (box["height"] < MIN_TARGET - 0.5 or box["width"] < MIN_TARGET - 0.5):
                        small.append((path, role, el.get_attribute("aria-label") or el.inner_text()[:30]))
            assert not small, small
        page.goto(w.base + "/today")
        head = page.get_by_role("heading", name="Today", exact=True).first.bounding_box()
        wait_card = beacon(page, "Waiting")
        expect(wait_card).to_be_visible(timeout=UI_MS)
        card = wait_card.bounding_box()
        if size == "desktop":
            assert head["x"] < width / 2 <= card["x"] + 1
        else:
            assert card["y"] >= head["y"] + head["height"] - 1
        room = page.get_by_role("list", name="Waiting room").bounding_box()
        grid = page.get_by_role("grid", name="Day calendar")
        agenda = page.get_by_role("list", name="Day agenda")
        if size == "phone":
            assert grid.count() == 0
            assert room["y"] < agenda.bounding_box()["y"]
        else:
            assert agenda.count() == 0
            g = grid.bounding_box()
            assert (room["x"] > g["x"]) if size == "desktop" else (room["y"] < g["y"])
        page.goto(w.base + "/ward")
        boxes = [beacon(page, n).bounding_box() for n in ("Waiting", "Overdue", "Due within the hour")]
        if size == "tablet":
            assert len({round(b["y"]) for b in boxes}) == 1
        else:
            assert len({round(b["x"]) for b in boxes}) == 1 and boxes[0]["y"] < boxes[1]["y"] < boxes[2]["y"]
    with open_app(browser, f"{w.base}/book/{w.slug}", touch=size != "desktop") as page:
        page.set_viewport_size({"width": width, "height": SIZES[size][1]})
        expect(page.get_by_role("heading", name="Book a visit for your animal")).to_be_visible(timeout=UI_MS)
        layout(page)
    if size == "desktop":
        with window(browser, w, "mgr", "/today", size=DESKTOP) as page:
            pill = page.get_by_role("button", name="Go to today")
            rest, hover = state_styles(pill, "background-color", state="hover")
            assert rest != hover


def test_dp08_names_and_regions(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0), status="checked-in", checkedInAt=at(8, 45))])
    with window(browser, w, "mgr") as page:
        expect(page.get_by_role("banner").get_by_role("link", name="Roundbook home")).to_be_visible()
        nav = page.get_by_role("navigation", name="Clinic sections")
        for name in ("Today", "Ward", "Patients", "Invoices"):
            expect(nav.get_by_role("link", name=name, exact=True)).to_be_visible()
        manage = nav.get_by_role("button", name="Manage")
        expect(manage).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_role("menuitem", name="Stock")).to_have_count(0)
        click(manage)
        expect(manage).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_role("menuitem", name="Stock")).to_be_visible()
        expect(page.get_by_role("menuitem", name="Staff")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("menuitem", name="Stock")).to_have_count(0)
        poll(lambda: focused_name(page) == "Manage", 'focus == "Manage"')
        for name in ("Go to today", "Sign out"):
            expect(page.get_by_role("button", name=name)).to_be_visible()
        expect(page.get_by_text(f"{NAMES['mgr']}, Manager")).to_be_visible()
        foot = page.get_by_role("contentinfo").get_by_role("navigation", name="Workspace links")
        for name in ("Day view", "Online booking", "Kennel round", "Animal records", "Billing", "Supplies", "Team access"):
            expect(foot.get_by_role("link", name=name, exact=True)).to_be_visible()
        assert f"/book/{w.slug}" in foot.get_by_role("link", name="Online booking").get_attribute("href")
        expect(ann(page)).to_have_count(1)
        click(page.get_by_role("link", name="Patients", exact=True).first)
        expect(page.get_by_role("heading", name="Patients", exact=True)).to_be_visible(timeout=UI_MS)
        item = page.get_by_role("list", name="Patient list").get_by_role("listitem", name=joined(REX, "Dog"))
        expect(item).to_be_visible(timeout=UI_MS)
        expect(item).to_contain_text("Waiting")
        expect(item.get_by_role("link", name=opener(REX))).to_be_visible()
        fill(page.get_by_role("searchbox", name="Search patients"), PIP)
        said(page, "1 patients found.")
    with window(browser, w, "vet", f"/patients/{w.id('patients', 'p1')}") as page:
        fill(page.get_by_role("spinbutton", name="Weight in grams"), "5400")
        click(page.get_by_role("button", name="Save weight"))
        said(page, "Weight saved.")
    with window(browser, w, "front", "/today") as page:
        cell(page, "Consult 1", "10:00", "free").focus()
        page.keyboard.press("Enter")
        d = dlg(page, "Book appointment")
        click(d.get_by_role("button", name="Book", exact=True))
        expect(d.get_by_role("alert")).to_contain_text("Patient is required.")


def test_dp13_calendar_structure(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0), minutes=30)])
    with window(browser, w, "front") as page:
        page.clock.set_fixed_time(datetime(2026, 11, 10, 23, 59, tzinfo=timezone.utc))
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "America/Los_Angeles"})
        page.reload()
        expect(page.get_by_role("grid", name="Day calendar")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_text(long_day(DAY)).first).to_be_visible()
        for room in ("Consult 1", "Consult 2", "Consult 3"):
            expect(cell(page, room, "08:00", "free")).to_be_visible()
            expect(cell(page, room, "17:45", "free")).to_have_count(1)
        expect(page.get_by_role("gridcell", name=re.compile(r"^Consult 1, 18:00, "))).to_have_count(0)
        expect(cell(page, "Consult 1", "09:00", "booked")).to_be_visible()
        expect(cell(page, "Consult 1", "09:15", "booked")).to_be_visible()
        expect(cell(page, "Consult 2", "09:00", "free")).to_be_visible()
        expect(page.get_by_role("button", name=appt_name(REX, VERA, "09:00", "09:30", "Booked"), exact=True)).to_be_visible()


def test_dp14_keyboard_booking_dialog(app_url, browser):
    w = make_world(app_url)
    with window(browser, w, "front") as page:
        cell(page, "Consult 2", "10:00", "free").focus()
        page.keyboard.press("ArrowDown")
        poll(lambda: focused_name(page) == slot_name("Consult 2", "10:15", "free"), 'focus == slot_name("Consult 2", "10:15", "free")')
        page.keyboard.press("ArrowRight")
        poll(lambda: focused_name(page) == slot_name("Consult 3", "10:15", "free"), 'focus == slot_name("Consult 3", "10:15", "free")')
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Enter")
        d = dlg(page, "Book appointment")
        expect(d).to_be_visible()
        poll(lambda: focused_name(page) == "Client", 'focus == "Client"')
        d.get_by_role("button", name="Cancel", exact=True).focus()
        page.keyboard.press("Tab")
        poll(lambda: focused_name(page) == "Client", 'focus == "Client"')
        page.keyboard.press("Shift+Tab")
        poll(lambda: focused_name(page) == "Cancel", 'focus == "Cancel"')
        click(d.get_by_role("button", name="Book", exact=True))
        summary = d.get_by_role("alert")
        expect(summary).to_contain_text("Client is required.")
        expect(summary).to_contain_text("Patient is required.")
        assert has_focus(summary)
        assert not appt_by_patient(w.api("front"), "Rex")
        d.get_by_role("button", name="Cancel", exact=True).focus()
        page.keyboard.press("Tab")
        poll(lambda: focused_name(page).endswith("is required."), 'focus .endswith("is required.")')
        page.keyboard.press("Escape")
        expect(d).to_have_count(0)
        poll(lambda: focused_name(page) == slot_name("Consult 2", "10:15", "free"), 'focus == slot_name("Consult 2", "10:15", "free")')
        page.keyboard.press("Enter")
        select(d.get_by_role("combobox", name="Client", exact=True), "Nia Owner")
        select(d.get_by_role("combobox", name="Patient", exact=True), "Rex")
        click(d.get_by_role("button", name="Book", exact=True))
        said(page, "Booked Rex with Dr Omar Lind at 10:15.")
        expect(d).to_have_count(0)
        poll(lambda: focused_name(page).startswith("Rex with Dr Omar Lind, 10:15 to 10:30, Booked"), "focus on the new appointment")


def test_dp14_t_key_from_day_control(app_url, browser):
    tomorrow = str(date.fromisoformat(DAY) + timedelta(days=1))
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0)), appt("a2", "p2", "vet2", "r2", (9, 0, tomorrow))])
    with window(browser, w, "front") as page:
        expect(abtn(page, REX)).to_be_visible(timeout=UI_MS)
        nxt = page.get_by_role("button", name="Next day")
        click(nxt)
        expect(abtn(page, PIP)).to_be_visible(timeout=UI_MS)
        expect(abtn(page, REX)).to_have_count(0)
        nxt.focus()
        page.keyboard.press("t")
        expect(abtn(page, REX)).to_be_visible(timeout=UI_MS)
        expect(abtn(page, PIP)).to_have_count(0)


def test_dp14_summary_shift_tab_stays_in_dialog(app_url, browser):
    w = make_world(app_url)
    with window(browser, w, "front") as page:
        cell(page, "Consult 2", "10:00", "free").focus()
        page.keyboard.press("Enter")
        d = dlg(page, "Book appointment")
        expect(d).to_be_visible()
        click(d.get_by_role("button", name="Book", exact=True))
        summary = d.get_by_role("alert")
        expect(summary).to_contain_text("Patient is required.")
        assert has_focus(summary)
        for press in range(9):
            page.keyboard.press("Shift+Tab")
            assert has_focus(d), f"Shift+Tab {press + 1} left Book appointment"
        expect(d).to_be_visible()


def test_dp15_one_winner_per_slot(app_url):
    w = make_world(app_url)
    front = w.api("front")
    body = {"patientId": w.id("patients", "p1"), "vetId": w.uid_of("vet"), "roomId": w.id("rooms", "r1"),
            "start": at(10), "reason": "Consult"}
    with ThreadPoolExecutor(RACERS) as pool:
        results = list(pool.map(lambda _: front.post("/api/appointments", body), range(RACERS)))
    winners = [r for r in results if r.status_code == 201]
    assert len(winners) == 1, [r.status_code for r in results]
    for r in results:
        if r.status_code != 201:
            err(r, 409, "slot_taken", SLOT_TAKEN)
    err(front.post("/api/appointments", {**body, "roomId": w.id("rooms", "r2"), "patientId": w.id("patients", "p2")}),
        409, "slot_taken")
    err(front.post("/api/appointments", {**body, "vetId": w.uid_of("vet2"), "patientId": w.id("patients", "p2")}),
        409, "slot_taken")
    assert len([a for a in front.get(f"/api/appointments?date={DAY}").json()["appointments"] if a["start"].startswith(at(10)[:16])]) == 1
    assert front.delete(f"/api/appointments/{winners[0].json()['id']}").status_code == 200
    assert front.post("/api/appointments", {**body, "patientId": w.id("patients", "p2")}).status_code == 201


def test_wf_book_by_keyboard_conflict_race(app_url, browser):
    w = make_world(app_url)
    with window(browser, w, "front") as a, window(browser, w, "front") as b:
        cell(a, "Consult 2", "10:00", "free").focus()
        a.keyboard.press("Enter")
        d = dlg(a, "Book appointment")
        click(d.get_by_role("button", name="Book", exact=True))
        click(d.get_by_role("alert").get_by_role("link", name="Patient is required."))
        assert focused_name(a) == "Patient" or focused_name(a).startswith("Patient")
        select(d.get_by_role("combobox", name="Client", exact=True), "Nia Owner")
        select(d.get_by_role("combobox", name="Patient", exact=True), "Rex")
        rival = {"patientId": w.id("patients", "p2"), "vetId": w.uid_of("vet2"), "roomId": w.id("rooms", "r2"),
                 "start": at(10), "reason": "Consult"}
        assert w.api("front").post("/api/appointments", rival).status_code == 201
        expect(cell(b, "Consult 2", "10:00", "booked")).to_be_visible(timeout=UI_MS)
        click(d.get_by_role("button", name="Book", exact=True))
        summary = d.get_by_role("alert")
        expect(summary).to_contain_text(SLOT_TAKEN, timeout=UI_MS)
        assert has_focus(summary)
        a.keyboard.press("Escape")
        expect(d).to_have_count(0)
        assert focused_name(a).startswith("Consult 2, 10:00")
        expect(cell(a, "Consult 2", "10:00", "booked")).to_be_visible(timeout=UI_MS)
    rows = [x for x in w.api("front").get(f"/api/appointments?date={DAY}").json()["appointments"] if x["start"].startswith("2026-11-17T10:00")]
    assert [x["patientName"] for x in rows] == [PIP]


def test_wf_book_by_keyboard_conflict_recovery(app_url, browser):
    w = make_world(app_url)
    with window(browser, w, "front") as page:
        cell(page, "Consult 3", "11:00", "free").focus()
        page.keyboard.press("Enter")
        d = dlg(page, "Book appointment")
        select(d.get_by_role("combobox", name="Client", exact=True), "Nia Owner")
        select(d.get_by_role("combobox", name="Vet", exact=True), "Dr Vera Hale")
        select(d.get_by_role("combobox", name="Reason", exact=True), "Surgery")
        click(d.get_by_role("button", name="Book", exact=True))
        expect(d.get_by_role("alert")).to_contain_text("Patient is required.")
        expect(d.get_by_role("alert")).not_to_contain_text("Client is required.")
        click(d.get_by_role("button", name="Cancel", exact=True))
        expect(d).to_have_count(0)
        poll(lambda: focused_name(page) == slot_name("Consult 3", "11:00", "free"), 'focus == slot_name("Consult 3", "11:00", "free")')
        assert not appt_by_patient(w.api("front"), "Rex")
        page.keyboard.press("Enter")
        select(d.get_by_role("combobox", name="Client", exact=True), "Nia Owner")
        select(d.get_by_role("combobox", name="Patient", exact=True), "Rex")
        select(d.get_by_role("combobox", name="Reason", exact=True), "Surgery")
        click(d.get_by_role("button", name="Book", exact=True))
        said(page, "Booked Rex with Dr Omar Lind at 11:00.")
        poll(lambda: focused_name(page).startswith("Rex with"), "focus on the new appointment")
    booked = appt_by_patient(w.api("front"), "Rex")
    assert len(booked) == 1 and booked[0]["reason"] == "Surgery" and booked[0]["roomName"] == "Consult 3"


def test_dp17_move_resize_cancel_restore(app_url):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0)), appt("a2", "p2", "vet2", "r2", (9, 0), status="checked-in", checkedInAt=at(8, 45))])
    front, a1, a2 = w.api("front"), w.id("appointments", "a1"), w.id("appointments", "a2")
    moved = front.patch(f"/api/appointments/{a1}", {"start": at(9, 15), "minutes": 30})
    assert moved.status_code == 200 and utc(moved.json()["start"]) == utc(at(9, 15)) and utc(moved.json()["end"]) == utc(at(9, 45))
    err(front.patch(f"/api/appointments/{a1}", {"start": at(7, 45)}), 422, "outside_hours", field="start")
    err(front.patch(f"/api/appointments/{a2}", {"start": at(9, 15)}), 409, "invalid_transition",
        "This appointment is Checked in and cannot be changed that way.")
    cancelled = front.delete(f"/api/appointments/{a1}")
    body = cancelled.json()
    assert cancelled.status_code == 200 and body["status"] == "cancelled"
    assert utc(body["undoUntil"]) - utc(body["now"]) == timedelta(seconds=UNDO_SECONDS)
    back = front.post(f"/api/appointments/{a1}/restore")
    assert back.status_code == 200 and back.json()["status"] == "booked"
    err(front.post(f"/api/appointments/{a1}/restore"), 409, "invalid_transition")
    front.delete(f"/api/appointments/{a2}")
    assert front.post(f"/api/appointments/{a2}/restore").json()["status"] == "checked-in"
    front.delete(f"/api/appointments/{a1}")
    clash = {"patientId": w.id("patients", "p3"), "vetId": w.uid_of("vet"), "roomId": w.id("rooms", "r1"), "start": at(9, 15), "reason": "Consult"}
    assert front.post("/api/appointments", clash).status_code == 201
    err(front.post(f"/api/appointments/{a1}/restore"), 409, "slot_taken", SLOT_TAKEN)
    front.delete(f"/api/appointments/{a2}")
    set_clock(w.base, at(9, 0, second=30))
    err(front.post(f"/api/appointments/{a2}/restore"), 409, "undo_expired", "Undo is no longer available.")


def test_dp18_keyboard_commands(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0)), appt("a2", "p2", "vet2", "r2", (9, 0))])
    with window(browser, w, "front") as page:
        abtn(page, "Rex").focus()
        page.keyboard.press("Alt+ArrowDown")
        said(page, "Moved Rex to Consult 1, 09:15.")
        poll(lambda: focused_name(page).startswith("Rex with"), "focus on the moved appointment")
        page.keyboard.press("Shift+Alt+ArrowDown")
        said(page, "Rex now runs 09:15 to 09:45.")
        expect(abtn(page, "Rex", r"09:15 to 09:45", "Booked")).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Alt+ArrowRight")
        said(page, "Moved Rex to Consult 2, 09:15.")
        abtn(page, "Pip").focus()
        page.keyboard.press("i")
        said(page, "Pip checked in.")
        page.keyboard.press("Delete")
        expect(abtn(page, "Pip")).to_have_count(0, timeout=UI_MS)
        abtn(page, "Rex").focus()
        page.keyboard.press("Delete")
        expect(abtn(page, "Rex")).to_have_count(0, timeout=UI_MS)
        poll(lambda: focused_name(page) == slot_name("Consult 2", "09:15", "free"), "focus on the freed slot")
        expect(page.get_by_role("status", name="Notice")).to_have_count(1)
        page.keyboard.press("Control+z")
        said(page, "Appointment restored.")
        expect(abtn(page, "Rex")).to_be_visible(timeout=UI_MS)
        poll(lambda: focused_name(page).startswith("Rex with"), "focus on the restored appointment")
        expect(abtn(page, "Pip")).to_have_count(0)
    rows = w.api("front").get(f"/api/appointments?date={DAY}").json()["appointments"]
    assert [r["patientName"] for r in rows] == [REX]


def test_dp18_undo_button_focuses_restored_block(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    with window(browser, w, "front") as page:
        rex = abtn(page, REX)
        expect(rex).to_be_visible(timeout=UI_MS)
        rex.focus()
        page.keyboard.press("Delete")
        toast = page.get_by_role("status", name="Notice")
        expect(toast).to_be_visible(timeout=UI_MS)
        expect(rex).to_have_count(0, timeout=UI_MS)
        click(toast.get_by_role("button", name="Undo"))
        said(page, "Appointment restored.")
        expect(abtn(page, REX, status="Booked")).to_be_focused(timeout=UI_MS)
    assert [a["status"] for a in appt_by_patient(w.api("front"), REX)] == ["booked"]


def test_dp18_ctrl_z_from_toast_restores(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    with window(browser, w, "front") as page:
        rex = abtn(page, REX)
        expect(rex).to_be_visible(timeout=UI_MS)
        rex.focus()
        page.keyboard.press("Delete")
        toast = page.get_by_role("status", name="Notice")
        expect(toast).to_be_visible(timeout=UI_MS)
        expect(rex).to_have_count(0, timeout=UI_MS)
        toast.get_by_role("button", name="Undo").focus()
        page.keyboard.press("Control+z")
        said(page, "Appointment restored.")
        expect(abtn(page, REX, status="Booked")).to_be_visible(timeout=UI_MS)
        expect(toast).to_have_count(0, timeout=UI_MS)
    assert [a["status"] for a in appt_by_patient(w.api("front"), REX)] == ["booked"]


def test_wf_move_resize_undo_two_windows(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0)), appt("a2", "p2", "vet2", "r2", (9, 0))])
    with window(browser, w, "front") as a, window(browser, w, "vet") as b:
        abtn(a, "Rex").focus()
        a.keyboard.press("Alt+ArrowDown")
        expect(abtn(b, "Rex", r"09:15 to 09:30")).to_be_visible(timeout=UI_MS)
        a.keyboard.press("Shift+Alt+ArrowDown")
        expect(abtn(b, "Rex", r"09:15 to 09:45")).to_be_visible(timeout=UI_MS)
        a.keyboard.press("Delete")
        expect(abtn(b, "Rex")).to_have_count(0, timeout=UI_MS)
        advance(a, 6000)
        abtn(a, "Pip").focus()
        a.keyboard.press("Delete")
        expect(abtn(b, "Pip")).to_have_count(0, timeout=UI_MS)
        advance(a, 6000)
        expect(a.get_by_role("status", name="Notice")).to_have_count(1)
        a.keyboard.press("Control+z")
        expect(abtn(b, "Pip")).to_be_visible(timeout=UI_MS)
        expect(abtn(b, "Rex")).to_have_count(0)
    names = [r["patientName"] for r in w.api("front").get(f"/api/appointments?date={DAY}").json()["appointments"]]
    assert names == [PIP]


def test_wf_move_resize_undo_expired(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    with window(browser, w, "front") as page:
        abtn(page, "Rex").focus()
        page.keyboard.press("Delete")
        expect(page.get_by_role("status", name="Notice")).to_be_visible(timeout=UI_MS)
        set_clock(w.base, at(9, 0, second=5))
        click(page.get_by_role("status", name="Notice").get_by_role("button", name="Undo"))
        expect(page.get_by_role("alert").filter(has_text="Undo is no longer available.").first).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("status", name="Notice")).to_have_count(0)
        expect(abtn(page, "Rex")).to_have_count(0)
    assert not appt_by_patient(w.api("front"), "Rex")


def test_dp20_layouts_and_closed_menu(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0), status="checked-in", checkedInAt=at(8, 45))])
    with window(browser, w, "mgr", size=PHONE, touch=True) as page:
        expect(page.get_by_role("list", name="Day agenda")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("grid", name="Day calendar")).to_have_count(0)
        expect(dlg(page, "Menu")).to_have_count(0)
        for name in ("Today", "Ward", "Patients", "Invoices", "Stock", "Staff", "Go to today", "Sign out", "Close menu"):
            expect(page.get_by_role("link", name=name, exact=True)).to_have_count(0)
            expect(page.get_by_role("button", name=name, exact=True)).to_have_count(0)
        page.get_by_role("link", name="Roundbook home").focus()
        names = tab_order(page, 4)
        assert names[0] == "Open menu"
        assert not set(names) & {"Today", "Ward", "Patients", "Invoices", "Stock", "Staff", "Sign out", "Close menu"}
        tap(page.get_by_role("button", name="Open menu"))
        menu = dlg(page, "Menu")
        expect(menu).to_be_visible()
        for _ in range(14):
            page.keyboard.press("Tab")
            assert has_focus(menu)
        page.keyboard.press("Escape")
        expect(menu).to_have_count(0)
        poll(lambda: focused_name(page) == "Open menu", 'focus == "Open menu"')
    with window(browser, w, "mgr", size=TABLET, touch=True) as page:
        expect(page.get_by_role("grid", name="Day calendar")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("list", name="Day agenda")).to_have_count(0)
        assert page.get_by_role("list", name="Waiting room").bounding_box()["y"] < page.get_by_role("grid", name="Day calendar").bounding_box()["y"]
    with window(browser, w, "mgr", size=DESKTOP) as page:
        manage = page.get_by_role("button", name="Manage")
        expect(page.get_by_role("menuitem", name="Staff")).to_have_count(0)
        click(manage)
        expect(page.get_by_role("menuitem", name="Staff")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("menuitem", name="Staff")).to_have_count(0)
        poll(lambda: focused_name(page) == "Manage", 'focus == "Manage"')


def test_dp21_long_press_drag(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0)), appt("a2", "p2", "vet2", "r1", (9, 30))])
    with window(browser, w, "front", size=TABLET, touch=True) as page:
        rex = abtn(page, "Rex")
        expect(rex).to_be_visible(timeout=UI_MS)
        tap(rex)
        expect(dlg(page, "Appointment details")).to_be_visible()
        click(dlg(page, "Appointment details").get_by_role("button", name="Close"))
        long_press_drag(page, rex, cell(page, "Consult 2", "09:15", "free"))
        poll(lambda: appt_by_patient(w.api("front"), "Rex")[0]["roomName"] == "Consult 2", "Rex dropped in Consult 2")
        assert utc(appt_by_patient(w.api("front"), "Rex")[0]["start"]) == utc(at(9, 15))
        expect(abtn(page, "Rex", r"09:15 to 09:30")).to_be_visible(timeout=UI_MS)
        w.api("front").patch(f"/api/appointments/{w.id('appointments', 'a1')}", {"roomId": w.id("rooms", "r1"), "start": at(9, 0)})
        expect(abtn(page, "Rex", r"09:00 to 09:15")).to_be_visible(timeout=UI_MS)
        long_press_drag(page, abtn(page, "Rex"), cell(page, "Consult 1", "09:30", "booked"))
        expect(page.get_by_role("alert").filter(has_text=SLOT_TAKEN).first).to_be_visible(timeout=UI_MS)
        assert utc(appt_by_patient(w.api("front"), "Rex")[0]["start"]) == utc(at(9, 0))


def test_dp21_long_press_drop_on_own_slot(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0), minutes=30)])
    with window(browser, w, "front", size=TABLET, touch=True) as page:
        rex = abtn(page, REX, r"09:00 to 09:30")
        expect(rex).to_be_visible(timeout=UI_MS)
        long_press_drag(page, rex, cell(page, "Consult 1", "09:15", "booked"))
        poll(lambda: utc(appt_by_patient(w.api("front"), REX)[0]["start"]) == utc(at(9, 15)), "Rex dropped on Consult 1, 09:15")
        expect(abtn(page, REX, r"09:15 to 09:45")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("alert").filter(has_text=SLOT_TAKEN)).to_have_count(0)
    moved = appt_by_patient(w.api("front"), REX)[0]
    assert moved["roomName"] == "Consult 1" and utc(moved["end"]) == utc(at(9, 45))


def test_wf_phone_and_tablet_calendar_move(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    with ExitStack() as st:
        tablet = st.enter_context(window(browser, w, "front", size=TABLET, touch=True))
        desk = st.enter_context(window(browser, w, "vet"))
        phone = st.enter_context(window(browser, w, "vet2", size=PHONE, touch=True))
        calm = st.enter_context(window(browser, w, "mgr", reduced_motion="reduce"))
        expect(abtn(tablet, "Rex")).to_be_visible(timeout=UI_MS)
        long_press_drag(tablet, abtn(tablet, "Rex"), cell(tablet, "Consult 2", "09:15", "free"))
        expect(cell(desk, "Consult 2", "09:15", "booked")).to_be_visible(timeout=UI_MS)
        expect(abtn(desk, "Rex")).to_have_attribute("data-motion", "appointment-move", timeout=UI_MS)
        expect(phone.get_by_role("list", name="Day agenda").get_by_role("button", name=re.compile(r"^Rex with .*09:15 to 09:30"))).to_be_visible(timeout=UI_MS)
        expect(phone.get_by_role("grid", name="Day calendar")).to_have_count(0)
        expect(abtn(calm, "Rex", r"09:15 to 09:30")).to_be_visible(timeout=UI_MS)
        expect(abtn(calm, "Rex")).to_have_attribute("data-motion", "none")
        expect(abtn(calm, "Rex")).to_have_attribute("data-motion-ms", "0")
    moved = appt_by_patient(w.api("front"), "Rex")[0]
    assert moved["roomName"] == "Consult 2" and utc(moved["start"]) == utc(at(9, 15))


def test_wf_phone_and_tablet_calendar_book_from_agenda(app_url, browser):
    w = make_world(app_url, clock=at(8, 7))
    with window(browser, w, "front", size=PHONE, touch=True) as page:
        tap(page.get_by_role("button", name="Book a time"))
        d = dlg(page, "Book appointment")
        select(d.get_by_role("combobox", name="Client", exact=True), "Nia Owner")
        select(d.get_by_role("combobox", name="Patient", exact=True), "Rex")
        tap(d.get_by_role("button", name="Book", exact=True))
        said(page, "Booked Rex with Dr Omar Lind at 08:15.")
        expect(page.get_by_role("list", name="Day agenda").get_by_role("button", name=re.compile(r"^Rex with Dr Omar Lind, 08:15 to 08:30"))).to_be_visible(timeout=UI_MS)
    assert utc(appt_by_patient(w.api("front"), "Rex")[0]["start"]) == utc(at(8, 15))


def test_wf_phone_and_tablet_calendar_book_skips_busy_vets(app_url, browser):
    busy = [appt("a1", "p2", "vet", "r1", (8, 15)), appt("a2", "p3", "vet2", "r2", (8, 15))]
    w = make_world(app_url, clock=at(8, 7), appts=busy)
    with window(browser, w, "front", size=PHONE, touch=True) as page:
        expect(page.get_by_role("list", name="Day agenda").get_by_role("button", name=re.compile(rf"^{PIP} with "))).to_be_visible(timeout=UI_MS)
        tap(page.get_by_role("button", name="Book a time"))
        d = dlg(page, "Book appointment")
        select(d.get_by_role("combobox", name="Client", exact=True), "Nia Owner")
        select(d.get_by_role("combobox", name="Patient", exact=True), "Rex")
        tap(d.get_by_role("button", name="Book", exact=True))
        said(page, "Booked Rex with Dr Omar Lind at 08:30.")
    booked = appt_by_patient(w.api("front"), REX)
    assert len(booked) == 1 and utc(booked[0]["start"]) == utc(at(8, 30))


def test_dp23_lifecycle(app_url):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0)), appt("a2", "p2", "vet2", "r2", (9, 0)),
                                   appt("a3", "p3", "vet", "r3", (9, 15))])
    front, vet = w.api("front"), w.api("vet")
    a1, a2, a3 = (w.id("appointments", r) for r in ("a1", "a2", "a3"))
    err(vet.post(f"/api/appointments/{a1}/start"), 409, "invalid_transition", "This appointment is Booked and cannot be changed that way.")
    assert front.post(f"/api/appointments/{a1}/check-in").json()["status"] == "checked-in"
    err(front.post(f"/api/appointments/{a1}/check-in"), 409, "invalid_transition", "This appointment is Checked in and cannot be changed that way.")
    err(vet.post(f"/api/appointments/{a1}/complete"), 409, "invalid_transition")
    assert vet.post(f"/api/appointments/{a1}/start").json()["status"] == "in-consult"
    err(vet.post(f"/api/appointments/{a1}/start"), 409, "invalid_transition", "This appointment is In consult and cannot be changed that way.")
    err(front.delete(f"/api/appointments/{a1}"), 409, "invalid_transition")
    assert vet.post(f"/api/appointments/{a1}/complete").json()["status"] == "completed"
    err(vet.post(f"/api/appointments/{a1}/complete"), 409, "invalid_transition")
    err(front.post(f"/api/appointments/{a2}/no-show"), 409, "too_early", "That appointment has not started yet.")
    set_clock(w.base, at(9, 5))
    assert front.post(f"/api/appointments/{a2}/no-show").json()["status"] == "no-show"
    assert PIP not in [r["patientName"] for r in front.get(f"/api/appointments?date={DAY}").json()["appointments"]]
    err(front.post(f"/api/appointments/{a2}/check-in"), 409, "invalid_transition")
    assert front.delete(f"/api/appointments/{a3}").json()["status"] == "cancelled"
    err(front.post(f"/api/appointments/{a3}/check-in"), 409, "invalid_transition")


def test_dp24_waiting_room(app_url, browser):
    w = make_world(app_url, clock=at(9, 0), appts=[appt("a1", "p1", "vet", "r1", (9, 0)), appt("a2", "p2", "vet2", "r2", (9, 0))])
    with window(browser, w, "vet") as page, window(browser, w, "front") as desk:
        expect(page.get_by_text("No one is waiting.")).to_be_visible(timeout=UI_MS)
        click(page.get_by_role("button", name="Go to calendar"))
        assert has_focus(page.get_by_role("grid", name="Day calendar"))
        front = w.api("front")
        front.post(f"/api/appointments/{w.id('appointments', 'a2')}/check-in")
        front.post(f"/api/appointments/{w.id('appointments', 'a1')}/check-in")
        room = page.get_by_role("list", name="Waiting room")
        expect(room.get_by_role("listitem")).to_have_count(2, timeout=UI_MS)
        assert PIP in room.get_by_role("listitem").nth(0).inner_text() and REX in room.get_by_role("listitem").nth(1).inner_text()
        set_clock(w.base, at(9, 6, second=30))
        expect(room.get_by_role("listitem", name=waiting_name(PIP, 6))).to_be_visible(timeout=UI_MS)
        assert {q["patientName"]: q["waitingMinutes"] for q in front.get("/api/queue").json()["queue"]}[PIP] == 6
        expect(room.get_by_role("link", name=opener(PIP))).to_have_attribute("href", re.compile(r"/patients/"))
        expect(desk.get_by_role("button", name=starter(PIP))).to_have_count(0)
        start = room.get_by_role("button", name=starter(PIP))
        with held(page, "**/api/appointments/*/start") as gate:
            click(start)
            expect(start).to_be_disabled()
            expect(start).to_have_attribute("aria-busy", "true")
            expect(room.get_by_role("listitem", name=re.compile(r"^Pip, waiting"))).to_be_visible()
            gate.release()
        said(page, "Pip is now in consult.")
        expect(room.get_by_role("listitem", name=re.compile(r"^Pip, waiting"))).to_have_count(0, timeout=UI_MS)


def test_dp25_late_arrivals(app_url, browser):
    w = make_world(app_url, clock=at(9, 9, second=0), appts=[appt("a1", "p1", "vet", "r1", (9, 0)), appt("a2", "p2", "vet2", "r2", (9, 0))])
    front = w.api("front")
    a1, a2 = w.id("appointments", "a1"), w.id("appointments", "a2")
    assert front.get(f"/api/appointments?date={DAY}").json()["appointments"][0]["late"] is False
    with window(browser, w, "front") as page:
        expect(abtn(page, "Rex")).not_to_contain_text("late")
        set_clock(w.base, at(9, 10))
        assert all(a["late"] for a in front.get(f"/api/appointments?date={DAY}").json()["appointments"])
        late = page.get_by_role("button", name=re.compile(r"^Rex with .*, Booked, late$"))
        expect(late).to_be_visible(timeout=UI_MS)
        chip = late.get_by_text("Late", exact=True)
        expect(chip).to_be_visible()
        colours = chip.evaluate(r"""el => { const s = getComputedStyle(el); let b = el, bg = 'rgba(0, 0, 0, 0)';
            while (b) { bg = getComputedStyle(b).backgroundColor; if (!/rgba\(.*, 0\)$|transparent/.test(bg)) break; b = b.parentElement; }
            return [s.color, bg]; }""")
        assert contrast(*colours) >= 4.5
        set_clock(w.base, at(9, 17))
        front.post(f"/api/appointments/{a1}/check-in")
        queue = {q["patientName"]: q for q in front.get("/api/queue").json()["queue"]}
        assert queue["Rex"]["lateByMinutes"] == 17
        expect(page.get_by_role("listitem", name=re.compile(r"^Rex, waiting")).get_by_text("Arrived 17 min late")).to_be_visible(timeout=UI_MS)
    set_clock(w.base, at(9, 5))
    w2 = make_world(app_url, clock=at(9, 5), appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    w2.api("front").post(f"/api/appointments/{w2.id('appointments', 'a1')}/check-in")
    assert w2.api("front").get("/api/queue").json()["queue"][0]["lateByMinutes"] is None


def test_wf_check_in_queue_race(app_url, browser):
    w = make_world(app_url, clock=at(9, 17), appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    with window(browser, w, "front") as desk, window(browser, w, "vet") as v1, window(browser, w, "vet2") as v2:
        abtn(desk, "Rex").focus()
        desk.keyboard.press("i")
        said(desk, "Rex checked in.")
        for v in (v1, v2):
            item = v.get_by_role("listitem", name=re.compile(r"^Rex, waiting \d+ min$"))
            expect(item).to_be_visible(timeout=UI_MS)
            expect(item.get_by_text("Arrived 17 min late")).to_be_visible()
        set_clock(w.base, at(9, 20, second=30))
        expect(v1.get_by_role("listitem", name=waiting_name(REX, 3))).to_be_visible(timeout=UI_MS)
        with held(v1, "**/api/appointments/*/start") as g1, held(v2, "**/api/appointments/*/start") as g2:
            click(v1.get_by_role("button", name=starter(REX)))
            click(v2.get_by_role("button", name=starter(REX)))
            expect(v2.get_by_role("button", name=starter(REX))).to_have_attribute("aria-busy", "true")
            g1.release()
            said(v1, "Rex is now in consult.")
            g2.release()
        expect(v2.get_by_role("alert").filter(has_text="This appointment is In consult and cannot be changed that way.").first).to_be_visible(timeout=UI_MS)
        assert "now in consult" not in ann(v2).inner_text()
        for v in (v1, v2):
            expect(v.get_by_text("No one is waiting.")).to_be_visible(timeout=UI_MS)
    assert w.api("vet").get(f"/api/appointments?date={DAY}").json()["appointments"][0]["status"] == "in-consult"


def test_wf_check_in_queue_late_chip_live(app_url, browser):
    w = make_world(app_url, clock=at(9, 9), appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    with window(browser, w, "front") as page:
        page.clock.set_fixed_time(datetime(2031, 6, 1, 12, 0, tzinfo=timezone.utc))
        page.reload()
        expect(abtn(page, "Rex", status="Booked")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_text("Late", exact=True)).to_have_count(0)
        set_clock(w.base, at(9, 10))
        expect(page.get_by_role("button", name=re.compile(r"Booked, late$"))).to_be_visible(timeout=UI_MS)
        expect(page.get_by_text("Late", exact=True)).to_be_visible()
        w.api("front").delete(f"/api/appointments/{w.id('appointments', 'a1')}")
        expect(abtn(page, "Rex")).to_have_count(0, timeout=UI_MS)


def test_dp23_details_dialog_follows_live_check_in(app_url, browser):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0))])
    with window(browser, w, "mgr", size=TABLET, touch=True) as page:
        rex = abtn(page, REX)
        expect(rex).to_be_visible(timeout=UI_MS)
        tap(rex)
        d = dlg(page, "Appointment details")
        expect(d).to_be_visible(timeout=UI_MS)
        expect(d.get_by_role("button", name="Check in", exact=True)).to_be_visible()
        assert w.api("front").post(f"/api/appointments/{w.id('appointments', 'a1')}/check-in").status_code == 200
        expect(d.get_by_role("button", name="Check in", exact=True)).to_have_count(0, timeout=UI_MS)
        expect(d).to_be_visible()
        expect(d.get_by_role("button", name="Start consult", exact=True)).to_be_visible()
        expect(d.get_by_role("button", name="Cancel appointment", exact=True)).to_be_visible()
        for gone in ("Mark no-show", "Complete consult"):
            expect(d.get_by_role("button", name=gone, exact=True)).to_have_count(0)
    assert [a["status"] for a in appt_by_patient(w.api("front"), REX)] == ["checked-in"]


def test_wf_check_in_queue_i_key_on_day_control(app_url, browser):
    tomorrow = str(date.fromisoformat(DAY) + timedelta(days=1))
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0)), appt("a2", "p2", "vet2", "r2", (9, 0, tomorrow))])
    checkins = []
    with window(browser, w, "front") as page:
        page.on("request", lambda r: checkins.append(r.url) if r.method == "POST" and "/check-in" in r.url else None)
        rex = abtn(page, REX, status="Booked")
        expect(rex).to_be_visible(timeout=UI_MS)
        rex.focus()
        nxt = page.get_by_role("button", name="Next day")
        nxt.focus()
        page.keyboard.press("i")
        click(nxt)
        expect(abtn(page, PIP)).to_be_visible(timeout=UI_MS)
        assert checkins == [], checkins
        expect(ann(page)).not_to_contain_text("checked in.")
    assert [a["status"] for a in appt_by_patient(w.api("front"), REX)] == ["booked"]
    assert [a["status"] for a in appt_by_patient(w.api("front"), PIP, tomorrow)] == ["booked"]


def _note_world(app_url):
    return make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0), status="in-consult")])


def test_dp27_note_versions(app_url):
    w = _note_world(app_url)
    a1 = w.id("appointments", "a1")
    v1, v2 = w.api("vet"), w.api("vet2")
    start = v1.get(f"/api/appointments/{a1}/note").json()["paragraphs"]
    assert [(p["n"], p["text"], p["version"]) for p in start] == [(1, "", 1)]
    first = {"text": "Alpha", "version": 1}
    saved = v1.put(f"/api/appointments/{a1}/note/paragraphs/1", first)
    assert saved.status_code == 200 and saved.json()["version"] == 2 and saved.json()["text"] == first["text"]
    err(v2.put(f"/api/appointments/{a1}/note/paragraphs/1", {"text": "Beta", "version": 1}), 409, "stale_paragraph",
        f"{NAMES['vet']} changed this paragraph first. Your text is kept below as a draft.")
    two = v1.post(f"/api/appointments/{a1}/note/paragraphs", {"text": "Second"})
    assert two.status_code == 201 and two.json()["n"] == 2
    assert v2.put(f"/api/appointments/{a1}/note/paragraphs/2", {"text": "Second b", "version": two.json()["version"]}).status_code == 200
    assert v1.put(f"/api/appointments/{a1}/note/paragraphs/1", {"text": "Alpha b", "version": 2}).status_code == 200
    assert v1.put(f"/api/appointments/{a1}/note/paragraphs/9", {"text": "x", "version": 1}).status_code == 404
    err(v1.put(f"/api/appointments/{a1}/note/paragraphs/1", {"text": "x" * 5001, "version": 3}), 422, "paragraph_too_long",
        "Keep each paragraph under 5,000 characters.", "text")
    assert v1.put(f"/api/appointments/{a1}/note/paragraphs/1", {"text": "x" * 5000, "version": 3}).status_code == 200
    err(w.api("nurse").put(f"/api/appointments/{a1}/note/paragraphs/1", {"text": "x", "version": 4}), 403, "forbidden")
    base_version = v1.get(f"/api/appointments/{a1}/note").json()["paragraphs"][1]["version"]
    with ThreadPoolExecutor(2) as pool:
        racers = list(pool.map(lambda who: w.api(who).put(f"/api/appointments/{a1}/note/paragraphs/2", {"text": who, "version": base_version}), ("vet", "vet2")))
    assert sorted(r.status_code for r in racers) == [200, 409]
    final = v1.get(f"/api/appointments/{a1}/note").json()["paragraphs"][1]
    assert final["text"] == next(r for r in racers if r.status_code == 200).json()["text"]


def _para(page, n=1):
    return page.locator(f'[data-paragraph="{n}"]')


def test_dp28_live_coedit(app_url, browser):
    w = _note_world(app_url)
    a1 = w.id("appointments", "a1")
    path = f"/consult/{a1}"
    with window(browser, w, "vet", path) as one, window(browser, w, "vet2", path) as two:
        expect(_para(one)).to_be_visible(timeout=UI_MS)
        shared = "Alpha from one"
        mine = "Mine, still typing"
        theirs = "Alpha elsewhere"
        fill(_para(one), shared)
        _para(one).blur()
        expect(_para(two)).to_have_value(shared, timeout=UI_MS)
        expect(one.get_by_role("status", name="Note status")).to_contain_text("Saved", timeout=UI_MS)
        _para(two).focus()
        fill(_para(two), mine)
        w.api("vet").put(f"/api/appointments/{a1}/note/paragraphs/1", {"text": theirs, "version": 2})
        expect(one).to_have_url(re.compile("consult"))
        assert _para(two).input_value() == mine
        _para(two).blur()
        expect(two.get_by_role("textbox", name="Draft")).to_have_value(mine, timeout=UI_MS)
        expect(_para(two)).to_have_value(theirs)
        click(two.get_by_role("button", name="Discard draft"))
        expect(two.get_by_role("textbox", name="Draft")).to_have_count(0)
        para2 = one.get_by_role("button", name="Add paragraph")
        click(para2)
        early, final = "first", "first second"
        with held(one, "**/note/paragraphs/*") as gate:
            fill(_para(one, 2), early)
            _para(one, 2).blur()
            fill(_para(one, 2), final)
            _para(one, 2).blur()
            gate.release()
        expect(one.get_by_role("status", name="Note status")).to_contain_text("Saved", timeout=UI_MS)
        expect(one.get_by_role("textbox", name="Draft")).to_have_count(0)
        assert _para(one, 2).input_value() == final
    assert w.api("vet").get(f"/api/appointments/{a1}/note").json()["paragraphs"][1]["text"] == final


def test_dp28_text_typed_during_stale_save_goes_to_draft(app_url, browser):
    w = _note_world(app_url)
    a1 = w.id("appointments", "a1")
    early, final, winner = "first", "first second", "Winner text"
    with window(browser, w, "vet2", f"/consult/{a1}") as two:
        expect(_para(two)).to_be_visible(timeout=UI_MS)
        with held(two, "**/note/paragraphs/*") as gate:
            with two.expect_request(lambda r: r.method == "PUT" and "/note/paragraphs/" in r.url, timeout=UI_MS):
                fill(_para(two), early)
                _para(two).blur()
            assert w.api("vet").put(f"/api/appointments/{a1}/note/paragraphs/1", {"text": winner, "version": 1}).status_code == 200
            fill(_para(two), final)
            _para(two).blur()
            gate.release()
        expect(two.get_by_text(f"{NAMES['vet']} changed this paragraph first. Your text is kept below as a draft.")).to_be_visible(timeout=UI_MS)
        expect(two.get_by_role("textbox", name="Draft")).to_have_value(final, timeout=UI_MS)
        expect(_para(two)).to_have_value(winner, timeout=UI_MS)
    assert w.api("vet").get(f"/api/appointments/{a1}/note").json()["paragraphs"][0]["text"] == winner


def test_wf_consult_note_coedit_collision(app_url, browser):
    w = _note_world(app_url)
    a1 = w.id("appointments", "a1")
    path = f"/consult/{a1}"
    with window(browser, w, "vet", path) as one, window(browser, w, "vet2", path) as two:
        expect(_para(one)).to_be_visible(timeout=UI_MS)
        findings, plan = "Findings by one", "Plan by two"
        loser, winner = "Two's version", "One's version"
        fill(_para(one), findings)
        _para(one).blur()
        click(two.get_by_role("button", name="Add paragraph"))
        fill(_para(two, 2), plan)
        _para(two, 2).blur()
        for p in (one, two):
            expect(_para(p, 1)).to_have_value(findings, timeout=UI_MS)
            expect(_para(p, 2)).to_have_value(plan, timeout=UI_MS)
        _para(two, 1).focus()
        fill(_para(two, 1), loser)
        fill(_para(one, 1), winner)
        _para(one, 1).blur()
        expect(one.get_by_role("status", name="Note status")).to_contain_text("Saved", timeout=UI_MS)
        _para(two, 1).blur()
        expect(two.get_by_text(f"{NAMES['vet']} changed this paragraph first. Your text is kept below as a draft.")).to_be_visible(timeout=UI_MS)
        expect(two.get_by_role("textbox", name="Draft")).to_have_value(loser)
        one.reload()
        two.reload()
        for p in (one, two):
            expect(_para(p, 1)).to_have_value(winner, timeout=UI_MS)
            expect(_para(p, 2)).to_have_value(plan)
    paragraphs = w.api("vet").get(f"/api/appointments/{a1}/note").json()["paragraphs"]
    assert [p["text"] for p in paragraphs] == [winner, plan]


def test_wf_consult_note_coedit_discard_draft(app_url, browser):
    w = _note_world(app_url)
    a1 = w.id("appointments", "a1")
    with window(browser, w, "vet2", f"/consult/{a1}") as two:
        expect(_para(two)).to_be_visible(timeout=UI_MS)
        loser = "Loser text"
        fill(_para(two), loser)
        w.api("vet").put(f"/api/appointments/{a1}/note/paragraphs/1", {"text": "Winner text", "version": 1})
        _para(two).blur()
        expect(two.get_by_role("textbox", name="Draft")).to_have_value(loser, timeout=UI_MS)
        click(two.get_by_role("button", name="Apply draft"))
        expect(two.get_by_role("textbox", name="Draft")).to_have_count(0, timeout=UI_MS)
        expect(_para(two)).to_have_value(loser)
    poll(lambda: w.api("vet").get(f"/api/appointments/{a1}/note").json()["paragraphs"][0]["text"] == loser, "applied draft saved")


def test_dp30_schedule(app_url):
    w = make_world(app_url, clock="2026-10-24T18:00:00Z")
    nurse, p1, p2 = w.api("nurse"), w.id("patients", "p1"), w.id("patients", "p2")
    r = nurse.post("/api/ward/admissions", {"patientId": p1, "kennel": "K1", "treatments": [{"name": "meloxicam", "firstAt": "2026-10-24 20:00", "intervalHours": 8, "count": 4}]})
    assert r.status_code == 201 and len(r.json()["treatmentIds"]) == 4
    board = nurse.get("/api/ward/board").json()["treatments"]
    mine = sorted(t["scheduledAt"] for t in board if t["id"] in r.json()["treatmentIds"])
    assert [utc(t) for t in mine] == [utc(x) for x in ("2026-10-24T19:00:00Z", "2026-10-25T03:00:00Z", "2026-10-25T11:00:00Z", "2026-10-25T19:00:00Z")]
    err(nurse.post("/api/ward/admissions", {"patientId": p2, "kennel": "K1", "treatments": [{"name": "x", "firstAt": "2026-10-26 09:00", "intervalHours": 8, "count": 1}]}), 409, "kennel_taken", "Kennel K1 is already occupied.")
    err(nurse.post("/api/ward/admissions", {"patientId": p2, "kennel": "K2", "treatments": [{"name": "x", "firstAt": "2027-03-28 01:30", "intervalHours": 8, "count": 1}]}), 422, "validation_failed", "First dose is not valid.", "treatments.0.firstAt")
    err(nurse.post("/api/ward/admissions", {"patientId": p2, "kennel": "K13", "treatments": [{"name": "x", "firstAt": "2026-10-26 09:00", "intervalHours": 8, "count": 1}]}), 422, "validation_failed", field="kennel")
    err(nurse.post("/api/ward/admissions", {"patientId": p2, "kennel": "K2", "treatments": [{"name": "x", "firstAt": "2026-10-26 09:00", "intervalHours": 0, "count": 1}]}), 422, "validation_failed", field="treatments.0.intervalHours")
    twice = nurse.post("/api/ward/admissions", {"patientId": p2, "kennel": "K2", "treatments": [{"name": "repeat", "firstAt": "2026-10-25 01:30", "intervalHours": 8, "count": 1}]})
    got = [t for t in nurse.get("/api/ward/board").json()["treatments"] if t["id"] == twice.json()["treatmentIds"][0]][0]
    assert utc(got["scheduledAt"]) == utc("2026-10-25T00:30:00Z")
    e = make_world(app_url, clock=at(8, 40), hospitalised=[hosp("h1", "p1", "K1", [dose("meloxicam", at(9))])])
    status = lambda: [t for t in e.api("nurse").get("/api/ward/board").json()["treatments"] if t["id"] == e.tid("h1")][0]["status"]
    for clock, expected in ((at(8, 59), "upcoming"), (at(9, 0), "due"), (at(9, 14), "due"), (at(9, 15), "overdue")):
        set_clock(e.base, clock)
        assert status() == expected, clock


def test_dp31_board_and_beacon_digits(app_url, browser):
    w = make_world(app_url, clock=at(20, 0), hospitalised=[hosp("h1", "p1", "K1", [dose("meloxicam", at(8), every=1, count=28)])])
    with window(browser, w, "nurse", "/ward") as page:
        over = page.get_by_role("rowgroup", name="Overdue")
        expect(over.get_by_role("gridcell")).to_have_count(12, timeout=UI_MS)
        expect(ward_cell(over, REX, "meloxicam", "08:00", "Overdue")).to_be_visible()
        expect(ward_cell(page.get_by_role("rowgroup", name="Due"), REX, "meloxicam", "20:00", "Due")).to_be_visible()
        card = beacon(page, "Overdue")
        expect(card).to_have_attribute("data-value", "12")
        expect(card.locator("[data-digit]")).to_have_count(2)
        assert "".join(card.locator("[data-digit]").evaluate_all("els => els.map(e => e.dataset.digit)")) == "12"
        expect(card).to_contain_text("12")
        advance(page, 3000)
        expect(card).to_have_attribute("data-motion", "idle", timeout=UI_MS * 2)
        card.evaluate("""el => { el.__rolled = new Set();
            const scan = () => el.querySelectorAll('[data-digit]').forEach((d, i) => { if (d.getAttribute('data-rolling') === 'true') el.__rolled.add(i); });
            new MutationObserver(scan).observe(el, {subtree: true, attributes: true, childList: true}); }""")
        set_clock(w.base, at(20, 15))
        expect(card).to_have_attribute("data-value", "13", timeout=UI_MS)
        poll(lambda: card.evaluate("el => el.__rolled.size") > 0, "a digit of the Overdue beacon rolled")
        assert card.evaluate("el => [...el.__rolled]") == [1]
        assert beacon(page, "Waiting").get_attribute("data-value") == "0"
        assert w.api("nurse").get("/api/beacons").json()["overdue"] == 13


def test_dp32_given_reopen_skip(app_url, browser):
    w = make_world(app_url, clock=at(9, 0), hospitalised=[hosp("h1", "p1", "K1", [dose("meloxicam", at(9), every=8, count=2)]),
                                                         hosp("h2", "p2", "K2", [dose("saline", at(9)), dose("fluids", at(9))])])
    nurse = w.api("nurse")
    due, later = w.tid("h1", 0), w.tid("h1", 1)
    err(nurse.post(f"/api/treatments/{later}/given"), 409, "not_due", "Rex, meloxicam is not due yet.")
    err(nurse.post(f"/api/treatments/{later}/skip", {"reason": "x"}), 409, "not_due")
    err(nurse.post(f"/api/treatments/{due}/reopen"), 409, "not_closed", "Rex, meloxicam is not given or skipped.")
    err(nurse.post(f"/api/treatments/{due}/skip", {"reason": "  "}), 422, "validation_failed", field="reason")
    given = nurse.post(f"/api/treatments/{due}/given")
    assert given.status_code == 200 and given.json()["status"] == "given" and given.json()["givenBy"]
    err(nurse.post(f"/api/treatments/{due}/given"), 409, "already_given", "Rex, meloxicam was already given.")
    err(nurse.post(f"/api/treatments/{due}/skip", {"reason": "x"}), 409, "already_given")
    assert nurse.post(f"/api/treatments/{due}/reopen").json()["status"] in ("due", "overdue")
    assert nurse.post(f"/api/treatments/{due}/skip", {"reason": "Refused"}).json()["status"] == "skipped"
    err(nurse.post(f"/api/treatments/{due}/given"), 409, "already_skipped", "Rex, meloxicam was skipped.")
    assert nurse.post(f"/api/treatments/{due}/notes", {"text": "Ate well"}).status_code == 201
    race = w.tid("h2", 0)
    with ThreadPoolExecutor(2) as pool:
        out = list(pool.map(lambda who: w.api(who).post(f"/api/treatments/{race}/given"), ("nurse", "vet")))
    assert sorted(r.status_code for r in out) == [200, 409]
    assert [r.json()["error"] for r in out if r.status_code == 409] == ["already_given"]
    other, treat = w.tid("h2", 1), "fluids"
    with window(browser, w, "nurse", "/ward") as page, window(browser, w, "mgr", "/ward") as second:
        mine, theirs = dose_cell(page, PIP, treat, "09:00"), dose_cell(second, PIP, treat, "09:00")
        expect(mine).to_be_visible(timeout=UI_MS)
        click(ward_button(mine, "Mark given", PIP, treat))
        said(page, f"{joined(PIP, treat)} marked given.")
        expect(theirs).to_have_accessible_name(re.compile(r", Given$"), timeout=UI_MS)
        click(ward_button(mine, "Reopen", PIP, treat))
        said(page, f"{joined(PIP, treat)} reopened.")
        expect(theirs).to_have_accessible_name(re.compile(r", (Due|Overdue)$"), timeout=UI_MS)
        with held(second, f"**/api/treatments/{other}/given") as gate:
            click(ward_button(theirs, "Mark given", PIP, treat))
            nurse.post(f"/api/treatments/{other}/given")
            gate.release()
        alerted(second, f"{joined(PIP, treat)} was already given.")


def test_wf_ward_due_overdue_round(app_url, browser):
    w = make_world(app_url, clock="2026-10-24T18:00:00Z")
    with window(browser, w, "nurse", "/ward") as one, window(browser, w, "mgr", "/ward") as two:
        one.clock.set_fixed_time(datetime(2031, 1, 1, 12, 0, tzinfo=timezone.utc))
        one.reload()
        click(one.get_by_role("button", name="Admit patient", exact=True))
        d = dlg(one, "Admit patient")
        select(d.get_by_role("combobox", name="Patient", exact=True), "Rex")
        select(d.get_by_role("combobox", name="Kennel", exact=True), "K1")
        fill(d.get_by_role("textbox", name="Treatment"), "meloxicam")
        fill(d.get_by_role("textbox", name="First dose"), "2026-10-24 20:00")
        fill(d.get_by_role("spinbutton", name="Every (hours)"), "8")
        fill(d.get_by_role("spinbutton", name="Doses"), "4")
        click(d.get_by_role("button", name="Admit", exact=True))
        said(one, "Rex admitted to K1.")
        for when in ("20:00", "03:00", "11:00", "19:00"):
            expect(one.get_by_role("gridcell", name=re.compile(rf"^Rex, meloxicam, {when}, Upcoming$"))).to_be_visible(timeout=UI_MS)
        advance(one, 3000)
        advance(two, 3000)
        set_clock(w.base, "2026-10-24T19:00:00Z")
        expect(ward_cell(one, "Rex", "meloxicam", "20:00", "Due")).to_be_visible(timeout=UI_MS)
        set_clock(w.base, "2026-10-24T19:15:00Z")
        first = ward_cell(one, "Rex", "meloxicam", "20:00", "Overdue")
        expect(first).to_be_visible(timeout=UI_MS)
        expect(beacon(one, "Overdue")).to_have_attribute("data-value", "1", timeout=UI_MS)
        expect(beacon(one, "Overdue")).to_have_attribute("data-motion", "beacon-roll")
        said(one, "Overdue now 1. Rex, meloxicam due 20:00.")
        first.focus()
        one.keyboard.press("Space")
        said(one, "Rex, meloxicam marked given.")
        expect(ward_cell(two.get_by_role("rowgroup", name="Done"), REX, "meloxicam", "20:00", "Given")).to_be_visible(timeout=UI_MS)
        expect(beacon(two, "Overdue")).to_have_attribute("data-value", "0", timeout=UI_MS)
    board = w.api("nurse").get("/api/ward/board").json()["treatments"]
    assert sorted(t["status"] for t in board) == ["given", "upcoming", "upcoming", "upcoming"]


def test_wf_ward_due_overdue_reduced_motion(app_url, browser):
    w = make_world(app_url, hospitalised=[hosp("h1", "p1", "K1", [dose("meloxicam", at(9))])])
    with window(browser, w, "nurse", "/ward", reduced_motion="reduce") as page:
        expect(ward_cell(page, "Rex", "meloxicam", "09:00", "Upcoming")).to_be_visible(timeout=UI_MS)
        set_clock(w.base, at(9, 15))
        expect(ward_cell(page, "Rex", "meloxicam", "09:00", "Overdue")).to_be_visible(timeout=UI_MS)
        expect(beacon(page, "Overdue")).to_have_attribute("data-value", "1", timeout=UI_MS)
        expect(beacon(page, "Overdue")).to_have_attribute("data-motion", "none")
        expect(page.locator("[data-rolling]")).to_have_count(0)
        said(page, "Overdue now 1. Rex, meloxicam due 09:00.")


def _ward_keys_world(app_url):
    names = [dose(f"t{i}", at(i)) for i in range(1, 6)]
    return make_world(app_url, clock=at(20, 0), hospitalised=[hosp("h1", "p1", "K1", names), hosp("h2", "p2", "K2", [dose("t6", at(23))])])


def test_dp34_ward_keyboard(app_url, browser):
    w = _ward_keys_world(app_url)

    def cellname(i, state="Overdue", pet=REX):
        return f"{pet}, t{i}, {i:02d}:00, {state}"
    pip6 = joined(PIP, "t6", "23:00", "Upcoming")
    with window(browser, w, "nurse", "/ward") as page:
        expect(ward_cell(page, "Rex", "t1", "01:00", "Overdue")).to_be_visible(timeout=UI_MS)
        ward_cell(page, "Rex", "t1", "01:00", "Overdue").focus()
        steps = [("ArrowLeft", cellname(1)), ("ArrowUp", cellname(1)), ("ArrowRight", cellname(2)), ("ArrowRight", cellname(3)),
                 ("ArrowDown", cellname(5)), ("ArrowDown", pip6), ("ArrowUp", cellname(4)),
                 ("ArrowRight", cellname(5)), ("ArrowRight", pip6), ("ArrowLeft", cellname(5)),
                 ("ArrowUp", cellname(2))]
        for key, expected in steps:
            page.keyboard.press(key)
            poll(lambda: focused_name(page) == expected, f"focus on {expected} after {key}")
        ward_cell(page, "Rex", "t1", "01:00", "Overdue").focus()
        page.keyboard.press("Space")
        said(page, "Rex, t1 marked given.")
        expect(ward_cell(page, "Rex", "t1", "01:00", "Given")).to_be_visible(timeout=UI_MS)
        poll(lambda: focused_name(page) == cellname(1, "Given"), 'focus == cellname(1, "Given")')
        page.keyboard.press("Shift+Space")
        said(page, "Rex, t1 reopened.")
        expect(ward_cell(page, "Rex", "t1", "01:00", "Overdue")).to_be_visible(timeout=UI_MS)
        poll(lambda: focused_name(page) == cellname(1), 'focus == cellname(1)')
        page.keyboard.press("n")
        expect(dlg(page, "Add note")).to_be_visible()
        typed = "a b"
        page.keyboard.type(typed)
        assert dlg(page, "Add note").get_by_role("textbox", name="Note").input_value() == typed
        page.keyboard.press("Escape")
        expect(dlg(page, "Add note")).to_have_count(0)
        poll(lambda: focused_name(page) == cellname(1), 'focus == cellname(1)')
        page.keyboard.press("s")
        expect(dlg(page, "Skip treatment")).to_be_visible()
        page.keyboard.press("Escape")
        poll(lambda: focused_name(page) == cellname(1), 'focus == cellname(1)')
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        first, second = ward_cell(page, "Rex", "t1", "01:00", "Overdue"), ward_cell(page, "Rex", "t2", "02:00", "Overdue")

        def one_column():
            a, b = first.bounding_box(), second.bounding_box()
            return bool(a and b) and abs(a["x"] - b["x"]) < 2 and b["y"] > a["y"]
        poll(one_column, "one-column ward board at 375 px")

        def down_from_first():
            first.focus()
            page.keyboard.press("ArrowDown")
            return poll_once(lambda: focused_name(page) == cellname(2), 1.0)
        poll(down_from_first, 'ArrowDown from t1 focuses t2 at 375 px')
    assert w.api("nurse").get("/api/ward/board").json()["treatments"][0]["status"] == "overdue"


def test_dp34_ward_board_one_tab_stop(app_url, browser):
    w = _ward_keys_world(app_url)
    third = joined(REX, "t3", "03:00", "Overdue")
    with window(browser, w, "nurse", "/ward") as page:
        grid = page.get_by_role("grid", name="Ward board")
        first = ward_cell(page, REX, "t1", "01:00", "Overdue")
        expect(first).to_be_visible(timeout=UI_MS)
        for key in ("Tab", "Shift+Tab"):
            first.focus()
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowRight")
            poll(lambda: focused_name(page) == third, 'focus == third')
            page.keyboard.press(key)
            assert not has_focus(grid), f"{key} from a ward cell stayed inside the Ward board"


def test_dp35_dialogs_survive_refresh(app_url, browser):
    w = make_world(app_url, hospitalised=[hosp("h1", "p1", "K1", [dose("meloxicam", at(9))])])
    tid = w.tid("h1")
    with window(browser, w, "nurse", "/ward") as page:
        cell_ = ward_cell(page, "Rex", "meloxicam", "09:00", "Upcoming")
        expect(cell_).to_be_visible(timeout=UI_MS)
        cell_.focus()
        page.keyboard.press("n")
        d = dlg(page, "Add note")
        click(d.get_by_role("button", name="Save note"))
        expect(d.get_by_role("alert")).to_contain_text("Note is required.")
        set_clock(w.base, at(9, 0))
        expect(ward_cell(page, "Rex", "meloxicam", "09:00", "Due", behind_modal=True)).to_be_visible(timeout=UI_MS)
        set_clock(w.base, at(9, 15))
        expect(ward_cell(page, "Rex", "meloxicam", "09:00", "Overdue", behind_modal=True)).to_be_visible(timeout=UI_MS)
        expect(d).to_be_visible()
        expect(d.get_by_role("alert")).to_contain_text("Note is required.")
        note = "Watch appetite"
        fill(d.get_by_role("textbox", name="Note"), note)
        assert d.get_by_role("textbox", name="Note").input_value() == note
        expect(d).to_be_visible()
        page.keyboard.press("Escape")
        ward_cell(page, "Rex", "meloxicam", "09:00", "Overdue").focus()
        page.keyboard.press("s")
        s = dlg(page, "Skip treatment")
        click(s.get_by_role("button", name="Skip treatment", exact=True))
        expect(s.get_by_role("alert")).to_contain_text("Reason is required.")
        w.api("vet").post(f"/api/treatments/{tid}/skip", {"reason": "Other nurse"})
        expect(ward_cell(page, "Rex", "meloxicam", "09:00", "Skipped", behind_modal=True)).to_be_visible(timeout=UI_MS)
        expect(s.get_by_role("alert")).to_contain_text("Reason is required.")
        fill(s.get_by_role("textbox", name="Reason"), "Refused")
        click(s.get_by_role("button", name="Skip treatment", exact=True))
        expect(s.get_by_role("alert")).to_contain_text(f"{joined(REX, 'meloxicam')} was skipped.", timeout=UI_MS)
        expect(s).to_be_visible()


def test_dp35_blank_note_refocuses_summary_each_save(app_url, browser):
    w = make_world(app_url, hospitalised=[hosp("h1", "p1", "K1", [dose("meloxicam", at(9))])])
    tid = w.tid("h1")
    with window(browser, w, "nurse", "/ward") as page:
        cell_ = ward_cell(page, REX, "meloxicam", "09:00", "Upcoming")
        expect(cell_).to_be_visible(timeout=UI_MS)
        cell_.focus()
        page.keyboard.press("n")
        d = dlg(page, "Add note")
        expect(d).to_be_visible()
        summary = d.get_by_role("alert")
        for press in ("first", "second"):
            click(d.get_by_role("button", name="Save note"))
            expect(summary).to_contain_text("Note is required.")
            poll(lambda: advance(page, 16) or has_focus(summary),
                 f"focus on the Add note error summary after the {press} Save note press", UI_MS / 1000)
        expect(d).to_be_visible()
    notes = [t for t in w.api("nurse").get("/api/ward/board").json()["treatments"] if t["id"] == tid][0]["notes"]
    assert notes == []


def _timers_flow(app_url, browser, **kw):
    w = make_world(app_url, hospitalised=[hosp("h1", "p1", "K1", [dose("meloxicam", at(9))])])
    tid = w.tid("h1")
    note = "Kept across the clock"
    with window(browser, w, "nurse", "/ward", **kw) as page:
        cell_ = dose_cell(page, REX, "meloxicam", "09:00")
        expect(cell_).to_be_visible(timeout=UI_MS)
        click(ward_button(cell_, "Add note", REX, "meloxicam"))
        d = dlg(page, "Add note")
        fill(d.get_by_role("textbox", name="Note"), note)
        set_clock(w.base, at(9, 0))
        expect(ward_cell(page, REX, "meloxicam", "09:00", "Due", behind_modal=True)).to_be_visible(timeout=UI_MS)
        set_clock(w.base, at(9, 15))
        expect(ward_cell(page, REX, "meloxicam", "09:00", "Overdue", behind_modal=True)).to_be_visible(timeout=UI_MS)
        expect(d).to_be_visible()
        assert d.get_by_role("textbox", name="Note").input_value() == note
        click(d.get_by_role("button", name="Save note"))
        said(page, f"Note saved for {joined(REX, 'meloxicam')}.")
        expect(cell_).to_contain_text(note)
        cell_.focus()
        page.keyboard.press("Space")
        said(page, f"{joined(REX, 'meloxicam')} marked given.")
        page.keyboard.press("Shift+Space")
        said(page, f"{joined(REX, 'meloxicam')} reopened.")
        expect(ward_cell(page, REX, "meloxicam", "09:00", "Overdue")).to_be_visible(timeout=UI_MS)
    notes = [t for t in w.api("nurse").get("/api/ward/board").json()["treatments"] if t["id"] == tid][0]["notes"]
    assert [n["text"] for n in notes] == [note]


def test_wf_ward_timers_keep_state_note(app_url, browser):
    _timers_flow(app_url, browser)


def test_wf_ward_timers_keep_state_reduced_motion(app_url, browser):
    _timers_flow(app_url, browser, reduced_motion="reduce")


def _priced_stock():
    big = [{"batch": "OPENING", "expiresOn": "2099-12-31", "quantity": 100}]
    return [stock_item("s1", "Nobivac DHPPi vaccine dose", 1295, 10, big), stock_item("s2", SALINE, 640, 4, big),
            stock_item("s3", "Penny one", 5, 1, big), stock_item("s4", "Penny two", 5, 1, big), stock_item("s5", "Penny three", 5, 1, big)]


def _invoice(w, lines, pct=0, issue=False):
    vet = w.api("vet")
    inv = vet.post("/api/invoices", {"patientId": w.id("patients", "p1")}).json()["id"]
    for ref, qty in lines:
        assert vet.post(f"/api/invoices/{inv}/lines", {"stockItemId": w.id("stock", ref), "quantity": qty}).status_code == 201
    if pct:
        assert vet.patch(f"/api/invoices/{inv}", {"discountPercent": pct}).status_code == 200
    if issue:
        assert vet.post(f"/api/invoices/{inv}/issue").status_code == 200
    return inv, vet.get(f"/api/invoices/{inv}").json()


def test_dp37_money(app_url, browser):
    w = make_world(app_url, stock=_priced_stock())
    _, one = _invoice(w, [("s1", 1)], 10)
    line = one["lines"][0]
    assert (line["netPence"], line["discountPence"], line["vatPence"], line["totalPence"]) == (1295, 130, 233, 1398)
    assert one["totalPence"] == 1398
    _, three = _invoice(w, [("s3", 1), ("s4", 1), ("s5", 1)], 10)
    assert [x["totalPence"] for x in three["lines"]] == [5, 5, 5] and three["totalPence"] == 15
    inv, mixed = _invoice(w, [("s3", 1), ("s1", 3), ("s2", 7)], 15, issue=True)
    assert sorted(x["totalPence"] for x in mixed["lines"]) == [5, 3962, 4570] and mixed["totalPence"] == 8537
    pdf = pdf_text(w.api("front").get(f"/api/invoices/{inv}.pdf").content)
    assert labelled("Total", 8537) in pdf and pdf_line(3, 3962) in pdf and pdf_line(7, 4570) in pdf
    with window(browser, w, "front", f"/invoices/{inv}") as page:
        expect(page.get_by_role("group", name="Total")).to_contain_text(labelled("Total", 8537), timeout=UI_MS)
        note = page.get_by_role("note", name="Invoice footnotes")
        expect(note).to_contain_text(discount_note(15))
        expect(note).to_contain_text(vat_note())
        expect(page.get_by_role("table", name="Invoice lines")).to_contain_text("**")


def test_dp38_lifecycle_and_idempotency(app_url):
    w = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0), status="in-consult")])
    vet, front, saline = w.api("vet"), w.api("front"), w.id("stock", "s1")
    pid = w.id("patients", "p1")
    inv = vet.post("/api/invoices", {"patientId": pid, "appointmentId": w.id("appointments", "a1")}).json()
    iid = inv["id"]
    assert inv["status"] == "draft" and re.fullmatch(r"INV-\d{4}", inv["number"])
    err(vet.post("/api/invoices", {"patientId": pid, "appointmentId": w.id("appointments", "a1")}), 409, "invoice_exists", "This consult already has an invoice.")
    err(vet.post(f"/api/invoices/{iid}/issue"), 422, "no_lines", "Add at least one line before issuing.", "lines")
    err(front.post(f"/api/invoices/{iid}/payments", {"pence": 100}), 409, "invoice_not_issued", "Issue the invoice before taking payment.")
    key = "line-" + uuid.uuid4().hex
    first = vet.post(f"/api/invoices/{iid}/lines", {"stockItemId": saline, "quantity": 1}, headers={"Idempotency-Key": key})
    replay = vet.post(f"/api/invoices/{iid}/lines", {"stockItemId": saline, "quantity": 1}, headers={"Idempotency-Key": key})
    assert first.status_code == 201 and replay.status_code == 201 and replay.json() == first.json()
    assert len(vet.get(f"/api/invoices/{iid}").json()["lines"]) == 1
    assert vet.get("/api/stock").json()["items"][0]["onHand"] == 14
    err(vet.post(f"/api/invoices/{iid}/lines", {"stockItemId": saline, "quantity": 2}, headers={"Idempotency-Key": key}), 409, "idempotency_key_reused", "That key was already used for a different request.")
    assert vet.post(f"/api/invoices/{iid}/issue").status_code == 200
    err(vet.post(f"/api/invoices/{iid}/lines", {"stockItemId": saline, "quantity": 1}), 409, "invoice_not_draft", "Only a draft invoice can be changed.")
    err(vet.patch(f"/api/invoices/{iid}", {"discountPercent": 5}), 409, "invoice_not_draft")
    err(front.post(f"/api/invoices/{iid}/payments", {"pence": 100000}), 422, "payment_too_large", "Payment is more than the balance due.", "pence")
    err(front.post(f"/api/invoices/{iid}/payments", {"pence": 0}), 422, "validation_failed", field="pence")
    pay = "pay-" + uuid.uuid4().hex
    p1 = front.post(f"/api/invoices/{iid}/payments", {"pence": 300}, headers={"Idempotency-Key": pay})
    p2 = front.post(f"/api/invoices/{iid}/payments", {"pence": 300}, headers={"Idempotency-Key": pay})
    assert p1.status_code == 201 and p2.status_code == 201 and p2.json() == p1.json()
    body = front.get(f"/api/invoices/{iid}").json()
    assert body["status"] == "part-paid" and body["paidPence"] == 300 and body["balancePence"] == line_total(640) - 300 and len(body["payments"]) == 1
    assert iid in [i["id"] for i in front.get("/api/invoices", params={"status": "part-paid"}).json()["invoices"]]
    err(front.post(f"/api/invoices/{iid}/void", {"reason": ""}), 409, "invoice_has_payments", "An invoice with payments cannot be voided.")
    assert front.post(f"/api/invoices/{iid}/payments", {"pence": line_total(640) - 300}).status_code == 201
    assert front.get(f"/api/invoices/{iid}").json()["status"] == "paid"
    err(front.post(f"/api/invoices/{iid}/payments", {"pence": 1}), 409, "invoice_closed", "This invoice is closed.")
    other = _invoice(w, [("s1", 1)], issue=True)[0]
    assert front.post(f"/api/invoices/{other}/void", {"reason": "Entered twice"}).json()["status"] == "voided"
    err(front.post(f"/api/invoices/{other}/void", {"reason": "again"}), 409, "invoice_closed")


def test_dp39_invoice_keyboard_lost_response(app_url, browser):
    w = make_world(app_url)
    pid = w.id("patients", "p1")
    iid = w.api("vet").post("/api/invoices", {"patientId": pid}).json()["id"]
    number = w.api("vet").get(f"/api/invoices/{iid}").json()["number"]
    with window(browser, w, "vet", f"/invoices/{iid}") as page:
        item = page.get_by_role("combobox", name="Stock item")
        select(item, SALINE)
        item.focus()
        assert tab_order(page, 5) == ["Quantity", "Add line", "Discount percent", "Apply discount", "Issue invoice"]
        quantity = page.get_by_role("spinbutton", name="Quantity")
        fill(quantity, "2")
        quantity.press("Enter")
        said(page, f"Added {SALINE} x2 to {number}.")
        page.get_by_role("spinbutton", name="Discount percent").focus()
        page.keyboard.type("10")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        expect(page.get_by_role("note", name="Invoice footnotes")).to_contain_text(discount_note(10), timeout=UI_MS)
        page.get_by_role("button", name="Issue invoice").focus()
        page.keyboard.press("Enter")
        said(page, f"{number} issued.")
    with window(browser, w, "front", f"/invoices/{iid}") as page:
        sent = []
        page.route("**/api/invoices/*/payments", lambda route: sent.append(route.request.headers.get("idempotency-key")) or route.continue_())
        amount = page.get_by_role("textbox", name="Payment amount")
        for bad in ("£12.50", "1,234.56", "0", "-1", ""):
            fill(amount, bad)
            amount.press("Enter")
            expect(page.get_by_role("alert").filter(has_text="Enter an amount like 12.50.").first).to_be_visible()
        assert sent == []
        page.unroute("**/api/invoices/*/payments")
        seen = []

        def drop_first(route):
            seen.append(route.request.headers.get("idempotency-key"))
            if len(seen) == 1:
                route.fetch()
                route.abort()
            else:
                route.continue_()
        page.route("**/api/invoices/*/payments", drop_first)
        fill(amount, "12.5")
        amount.press("Enter")
        expect(page.get_by_role("group", name="Paid")).to_contain_text(labelled("Paid", 1250), timeout=UI_MS)
        assert len(seen) == 2 and seen[0] and seen[0] == seen[1]
        assert ann(page).inner_text().count(f"Payment of {money(1250)} taken.") == 1
    after = w.api("front").get(f"/api/invoices/{iid}").json()
    assert [p["pence"] for p in after["payments"]] == [1250] and after["status"] == "part-paid"


def test_dp39_new_payment_attempt_after_lost_response(app_url, browser):
    w = make_world(app_url, invoices=[{"ref": "u1", "clinic": "c", "patient": "p1", "status": "issued", "discountPercent": 0,
                                       "lines": [{"stock": "s1", "quantity": 2}]}])
    u1 = w.id("invoices", "u1")
    total = w.api("front").get(f"/api/invoices/{u1}").json()["totalPence"]
    seen = []

    def drop_first(route):
        seen.append(route.request.headers.get("idempotency-key"))
        if len(seen) == 1:
            route.fetch()
            route.abort()
        else:
            route.continue_()
    with window(browser, w, "front", f"/invoices/{u1}") as page:
        page.route("**/api/invoices/*/payments", drop_first)
        amount = page.get_by_role("textbox", name="Payment amount")
        paid = page.get_by_role("group", name="Paid")
        fill(amount, "5")
        amount.press("Enter")
        expect(paid).to_contain_text(labelled("Paid", 500), timeout=UI_MS)
        assert len(seen) == 2 and seen[0] and seen[0] == seen[1]
        fill(amount, "5")
        amount.press("Enter")
        expect(paid).to_contain_text(labelled("Paid", 1000), timeout=UI_MS)
        said(page, f"Payment of {money(500)} taken. Balance due {money(total - 1000)}.")
        assert len(seen) == 3 and seen[2] and seen[2] != seen[0]
        assert ann(page).inner_text().count(f"Payment of {money(500)} taken.") == 2
    after = w.api("front").get(f"/api/invoices/{u1}").json()
    assert [p["pence"] for p in after["payments"]] == [500, 500] and after["balancePence"] == total - 1000


def test_dp39_line_resend_announces_once(app_url, browser):
    w = make_world(app_url, invoices=[{"ref": "d1", "clinic": "c", "patient": "p1", "status": "draft", "discountPercent": 0, "lines": []}])
    d1 = w.id("invoices", "d1")
    number = w.api("vet").get(f"/api/invoices/{d1}").json()["number"]
    seen = []

    def drop_first(route):
        seen.append(route.request.headers.get("idempotency-key"))
        if len(seen) == 1:
            route.fetch()
            route.abort()
        else:
            route.continue_()
    added = f"Added {SALINE} x3 to {number}."
    with window(browser, w, "vet", f"/invoices/{d1}") as page:
        page.route("**/api/invoices/*/lines", drop_first)
        select(page.get_by_role("combobox", name="Stock item"), SALINE)
        quantity = page.get_by_role("spinbutton", name="Quantity")
        fill(quantity, "3")
        quantity.press("Enter")
        said(page, added)
        expect(page.get_by_role("table", name="Invoice lines")).to_contain_text(SALINE, timeout=UI_MS)
        assert len(seen) == 2 and seen[0] and seen[0] == seen[1]
        assert ann(page).inner_text().count(added) == 1
    assert len(w.api("vet").get(f"/api/invoices/{d1}").json()["lines"]) == 1


def test_dp39_second_enter_during_resend_sends_nothing(app_url, browser):
    w = make_world(app_url, invoices=[{"ref": "u1", "clinic": "c", "patient": "p1", "status": "issued", "discountPercent": 0,
                                       "lines": [{"stock": "s1", "quantity": 2}]}])
    u1 = w.id("invoices", "u1")
    total = w.api("front").get(f"/api/invoices/{u1}").json()["totalPence"]
    seen, parked = [], []

    def lose_then_park(route):
        seen.append(route.request.headers.get("idempotency-key"))
        if len(seen) == 1:
            route.fetch()
            route.abort()
        elif len(seen) == 2:
            parked.append(route)
        else:
            route.continue_()
    with window(browser, w, "front", f"/invoices/{u1}") as page:
        page.route("**/api/invoices/*/payments", lose_then_park)
        amount = page.get_by_role("textbox", name="Payment amount")
        fill(amount, "5")
        amount.press("Enter")
        poll(lambda: page.evaluate("1") and bool(parked), "the automatic resend of the lost payment request")
        amount.press("Enter")
        parked[0].continue_()
        expect(page.get_by_role("group", name="Paid")).to_contain_text(labelled("Paid", 500), timeout=UI_MS)
        said(page, f"Payment of {money(500)} taken. Balance due {money(total - 500)}.")
        assert len(seen) == 2 and seen[0] and seen[0] == seen[1], seen
        assert ann(page).inner_text().count(f"Payment of {money(500)} taken.") == 1
    after = w.api("front").get(f"/api/invoices/{u1}").json()
    assert [p["pence"] for p in after["payments"]] == [500] and after["balancePence"] == total - 500


def test_dp40_attributed_void(app_url, browser):
    w = make_world(app_url, invoices=[
        {"ref": "i1", "clinic": "c", "patient": "p1", "status": "issued", "discountPercent": 0, "lines": [{"stock": "s1", "quantity": 2}]},
        {"ref": "i2", "clinic": "c", "patient": "p2", "status": "issued", "discountPercent": 0, "lines": [{"stock": "s1", "quantity": 1}], "payments": [{"pence": 300, "by": "front"}]}])
    front, i1, i2 = w.api("front"), w.id("invoices", "i1"), w.id("invoices", "i2")
    number = front.get(f"/api/invoices/{i1}").json()["number"]
    with window(browser, w, "front", f"/invoices/{i1}") as page:
        click(page.get_by_role("button", name="Void invoice", exact=True))
        d = dlg(page, "Void invoice")
        click(d.get_by_role("button", name="Confirm void"))
        expect(d.get_by_role("alert")).to_contain_text("Reason is required.")
        reason = "Entered twice"
        fill(d.get_by_role("textbox", name="Reason"), reason)
        click(d.get_by_role("button", name="Confirm void"))
        said(page, f"{number} voided.")
        body = front.get(f"/api/invoices/{i1}").json()
        stamp = hm(body["voidedAt"])
        record = f"Voided by {FERN} at {stamp}: {reason}"
        expect(page.get_by_role("note", name="Void record")).to_contain_text(record, timeout=UI_MS)
    assert body["status"] == "voided" and body["voidedBy"]["name"] == FERN and body["voidReason"] == reason
    moves = w.api("mgr").get(f"/api/stock/{w.id('stock', 's1')}/movements").json()["movements"]
    returns = [m for m in moves if m["reason"] == "return"]
    assert returns and all(m["by"] == w.uid_of("front") and m["pairedMovementId"] for m in returns)
    assert record in pdf_text(front.get(f"/api/invoices/{i1}.pdf").content)
    paid = front.get(f"/api/invoices/{i2}").json()["payments"][0]
    taken = f"{money(300)} taken by {FERN} at {hm(paid['at'])}"
    assert paid["takenBy"]["name"] == FERN
    assert f"Payment {taken}" in pdf_text(front.get(f"/api/invoices/{i2}.pdf").content)
    with window(browser, w, "front", f"/invoices/{i2}") as page:
        expect(page.get_by_role("list", name="Payments").get_by_role("listitem", name=taken)).to_be_visible(timeout=UI_MS)


def test_wf_invoice_exact_money_journey(app_url, browser):
    w = make_world(app_url, invoices=[
        {"ref": "d1", "clinic": "c", "patient": "p1", "status": "draft", "discountPercent": 0, "lines": []},
        {"ref": "u1", "clinic": "c", "patient": "p2", "status": "issued", "discountPercent": 0, "lines": [{"stock": "s1", "quantity": 1}]}])
    d1, u1 = w.id("invoices", "d1"), w.id("invoices", "u1")
    number = w.api("vet").get(f"/api/invoices/{d1}").json()["number"]
    with window(browser, w, "vet", f"/invoices/{d1}") as vet:
        select(vet.get_by_role("combobox", name="Stock item"), SALINE)
        qty = vet.get_by_role("spinbutton", name="Quantity")
        fill(qty, "2")
        qty.press("Enter")
        said(vet, f"Added {SALINE} x2 to {number}.")
        fill(vet.get_by_role("spinbutton", name="Discount percent"), "10")
        click(vet.get_by_role("button", name="Apply discount"))
        click(vet.get_by_role("button", name="Issue invoice"))
        said(vet, f"{number} issued.")
    total = w.api("front").get(f"/api/invoices/{d1}").json()["totalPence"]
    assert total == line_total(2 * 640, 10)
    with window(browser, w, "front", f"/invoices/{d1}") as page:
        seen = []

        def drop_first(route):
            seen.append(1)
            if len(seen) == 1:
                route.fetch()
                route.abort()
            else:
                route.continue_()
        page.route("**/api/invoices/*/payments", drop_first)
        amount = page.get_by_role("textbox", name="Payment amount")
        fill(amount, "5")
        amount.press("Enter")
        expect(page.get_by_role("group", name="Balance due")).to_contain_text(labelled("Balance due", total - 500), timeout=UI_MS)
        fill(amount, "999")
        amount.press("Enter")
        expect(page.get_by_role("alert").filter(has_text="Payment is more than the balance due.").first).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("group", name="Status")).to_contain_text("Part paid")
    with window(browser, w, "front", f"/invoices/{u1}") as page:
        click(page.get_by_role("button", name="Void invoice", exact=True))
        fill(dlg(page, "Void invoice").get_by_role("textbox", name="Reason"), "Booked in error")
        click(dlg(page, "Void invoice").get_by_role("button", name="Confirm void"))
        expect(page.get_by_role("group", name="Status")).to_contain_text("Voided", timeout=UI_MS)
        expect(page.get_by_role("note", name="Void record")).to_contain_text(f"Voided by {FERN} at")
    final = w.api("front").get(f"/api/invoices/{d1}").json()
    assert [p["pence"] for p in final["payments"]] == [500] and final["balancePence"] == total - 500
    assert w.api("front").get(f"/api/invoices/{u1}").json()["voidedBy"]["name"] == FERN


def test_wf_invoice_exact_money_lost_line_response(app_url, browser):
    w = make_world(app_url, invoices=[{"ref": "d1", "clinic": "c", "patient": "p1", "status": "draft", "discountPercent": 0, "lines": []}])
    d1 = w.id("invoices", "d1")
    seen = []

    def drop_first(route):
        seen.append(route.request.headers.get("idempotency-key"))
        if len(seen) == 1:
            route.fetch()
            route.abort()
        else:
            route.continue_()
    with window(browser, w, "vet", f"/invoices/{d1}") as page:
        page.route("**/api/invoices/*/lines", drop_first)
        select(page.get_by_role("combobox", name="Stock item"), SALINE)
        quantity = page.get_by_role("spinbutton", name="Quantity")
        fill(quantity, "3")
        quantity.press("Enter")
        expect(page.get_by_role("table", name="Invoice lines")).to_contain_text(SALINE, timeout=UI_MS)
        assert len(seen) == 2 and seen[0] == seen[1]
    assert len(w.api("vet").get(f"/api/invoices/{d1}").json()["lines"]) == 1
    assert w.api("vet").get("/api/stock").json()["items"][0]["onHand"] == 12


def test_wf_invoice_exact_money_issue_busy(app_url, browser):
    w = make_world(app_url, invoices=[{"ref": "d1", "clinic": "c", "patient": "p1", "status": "draft", "discountPercent": 0,
                                       "lines": [{"stock": "s1", "quantity": 1}]}])
    d1 = w.id("invoices", "d1")
    number = w.api("vet").get(f"/api/invoices/{d1}").json()["number"]
    with window(browser, w, "vet", f"/invoices/{d1}") as page:
        issue = page.get_by_role("button", name="Issue invoice")
        with held(page, "**/api/invoices/*/issue") as gate:
            click(issue)
            expect(issue).to_be_disabled()
            expect(issue).to_have_attribute("aria-busy", "true")
            gate.release()
        said(page, f"{number} issued.")
        expect(page.get_by_role("group", name="Status")).to_contain_text("Unpaid", timeout=UI_MS)
    assert w.api("vet").get(f"/api/invoices/{d1}").json()["status"] == "issued"


def _ledger_world(app_url, **kw):
    return make_world(app_url, stock=[stock_item("s1", "Cefalexin", 1440, 3, [
        {"batch": "EARLY", "expiresOn": "2026-12-01", "quantity": 5}, {"batch": "LATE", "expiresOn": "2027-03-01", "quantity": 20}])], **kw)


def test_dp42_ledger(app_url):
    w = _ledger_world(app_url)
    vet, mgr, sid = w.api("vet"), w.api("mgr"), w.id("stock", "s1")
    pid = w.id("patients", "p1")
    inv = vet.post("/api/invoices", {"patientId": pid}).json()["id"]
    line = vet.post(f"/api/invoices/{inv}/lines", {"stockItemId": sid, "quantity": 8})
    assert line.status_code == 201
    moves = mgr.get(f"/api/stock/{sid}/movements").json()
    draws = [m for m in moves["movements"] if m["reason"] == "invoice-line"]
    assert [(m["delta"], m["batch"]) for m in draws] == [(-5, "EARLY"), (-3, "LATE")]
    assert [m["balanceAfter"] for m in draws] == [20, 17] and moves["onHand"] == 17 == moves["usable"]
    assert moves["movements"][-1]["balanceAfter"] == moves["onHand"]
    err(vet.post(f"/api/invoices/{inv}/lines", {"stockItemId": sid, "quantity": 100}), 409, "insufficient_stock", "Only 17 of Cefalexin in stock.")
    assert mgr.get(f"/api/stock/{sid}/movements").json()["onHand"] == 17
    line_id = vet.get(f"/api/invoices/{inv}").json()["lines"][0]["id"]
    assert vet.delete(f"/api/invoices/{inv}/lines/{line_id}").status_code == 200
    after = mgr.get(f"/api/stock/{sid}/movements").json()
    returns = [m for m in after["movements"] if m["reason"] == "return"]
    assert sorted((m["batch"], m["delta"]) for m in returns) == [("EARLY", 5), ("LATE", 3)]
    assert {m["pairedMovementId"] for m in returns} == {d["id"] for d in draws} and all(d["pairedMovementId"] is None for d in draws)
    assert after["onHand"] == 25 and after["movements"][-1]["balanceAfter"] == 25
    err(mgr.post(f"/api/stock/{sid}/movements", {"delta": -9, "reason": "expired", "batch": "EARLY"}), 409, "insufficient_stock", "Only 5 of Cefalexin in stock.")
    err(mgr.post(f"/api/stock/{sid}/movements", {"delta": -1, "reason": "expired", "batch": "NOPE"}), 422, "validation_failed", field="batch")
    err(mgr.post(f"/api/stock/{sid}/movements", {"delta": 4, "reason": "receive", "batch": "EARLY", "expiresOn": "2030-01-01"}), 422, "validation_failed", field="expiresOn")
    err(mgr.post(f"/api/stock/{sid}/movements", {"delta": 4, "reason": "receive", "batch": "OLD", "expiresOn": "2026-11-16"}), 422, "validation_failed", field="expiresOn")
    assert mgr.post(f"/api/stock/{sid}/movements", {"delta": 4, "reason": "receive", "batch": "NEW", "expiresOn": "2027-06-30"}).status_code == 201
    scarce = make_world(app_url, stock=[stock_item("s1", "Last units", 100, 1, [{"batch": "ONLY", "expiresOn": "2030-01-01", "quantity": 3}])])
    invs = [scarce.api("vet").post("/api/invoices", {"patientId": scarce.id("patients", "p1")}).json()["id"] for _ in range(RACERS)]
    with ThreadPoolExecutor(RACERS) as pool:
        out = list(            pool.map(lambda i: scarce.api("vet").post(f"/api/invoices/{i}/lines", {"stockItemId": scarce.id("stock", "s1"), "quantity": 1}), invs))
    assert [r.status_code for r in out].count(201) == 3
    for r in out:
        if r.status_code != 201:
            err(r, 409, "insufficient_stock")
    assert scarce.api("mgr").get(f"/api/stock/{scarce.id('stock', 's1')}/movements").json()["usable"] == 0


def test_dp43_low_stock(app_url, browser):
    w = make_world(app_url, stock=[stock_item("s1", "Cefalexin", 1440, 5, [
        {"batch": "EARLY", "expiresOn": "2026-12-01", "quantity": 6}, {"batch": "LATE", "expiresOn": "2027-03-01", "quantity": 4}])])
    vet, sid = w.api("vet"), w.id("stock", "s1")
    inv = vet.post("/api/invoices", {"patientId": w.id("patients", "p1")}).json()["id"]
    with window(browser, w, "mgr", "/stock") as page:
        count = page.get_by_role("status", name="Low stock count")
        expect(count).to_have_attribute("data-value", "0", timeout=UI_MS)
        vet.post(f"/api/invoices/{inv}/lines", {"stockItemId": sid, "quantity": 6})
        said(page, "Cefalexin is low: 4 left.")
        expect(count).to_have_attribute("data-value", "1")
        row = stock_row(page, "Cefalexin", 4)
        expect(row).to_contain_text("Low stock")
        expect(row).to_contain_text("Usable 4")
        vet.post(f"/api/invoices/{inv}/lines", {"stockItemId": sid, "quantity": 1})
        expect(stock_row(page, "Cefalexin", 3)).to_be_visible(timeout=UI_MS)
        assert ann(page).inner_text().count("is low:") == 1
        select(page.get_by_role("combobox", name="Item"), "Cefalexin")
        fill(page.get_by_role("spinbutton", name="Quantity"), "10")
        select(page.get_by_role("combobox", name="Reason"), "Received")
        fill(page.get_by_role("textbox", name="Batch"), "NEW")
        fill(page.get_by_label("Expires on"), "2027-06-30")
        click(page.get_by_role("button", name="Record movement"))
        said(page, "Recorded +10 for Cefalexin.")
        expect(count).to_have_attribute("data-value", "0", timeout=UI_MS)
        assert sum(1 for i in w.api("mgr").get("/api/stock").json()["items"] if i["low"]) == 0


def test_dp43_low_alert_in_every_manager_window(app_url, browser):
    w = _meloxicam_world(app_url)
    low = "Meloxicam is low: 22 left."
    with window(browser, w, "mgr", "/stock") as a, window(browser, w, "mgr", "/stock") as b:
        count_b = b.get_by_role("status", name="Low stock count")
        expect(count_b).to_have_attribute("data-value", "0", timeout=UI_MS)
        select(a.get_by_role("combobox", name="Item"), "Meloxicam")
        fill(a.get_by_role("spinbutton", name="Quantity"), "3")
        select(a.get_by_role("combobox", name="Reason"), "Expired")
        select(a.get_by_role("combobox", name="Batch"), MX_A)
        click(a.get_by_role("button", name="Record movement"))
        said(a, low)
        said(b, low)
        expect(count_b).to_have_attribute("data-value", "1", timeout=UI_MS)
        for p in (a, b):
            assert ann(p).inner_text().count("Meloxicam is low:") == 1
        assert "Recorded -3 for Meloxicam." not in ann(b).inner_text()
    assert w.api("mgr").get("/api/stock").json()["items"][0]["low"] is True


def _meloxicam_world(app_url):
    stock = [stock_item("s1", "Meloxicam", 1850, 23, [{"batch": "MX-A", "expiresOn": DAY, "quantity": 3},
                                                      {"batch": "MX-B", "expiresOn": "2027-06-30", "quantity": 22}])]
    return make_world(app_url, stock=stock, invoices=[{"ref": "d1", "clinic": "c", "patient": "p1", "status": "draft", "discountPercent": 0, "lines": []}])


def test_wf_stock_low_alert_journey(app_url, browser):
    w = _meloxicam_world(app_url)
    sid, d1 = w.id("stock", "s1"), w.id("invoices", "d1")
    number = w.api("vet").get(f"/api/invoices/{d1}").json()["number"]
    lows = lambda p: ann(p).inner_text().count("Meloxicam is low:")
    with window(browser, w, "mgr", "/stock") as mgr, window(browser, w, "vet", f"/invoices/{d1}") as vet:
        count = mgr.get_by_role("status", name="Low stock count")
        expect(count).to_have_attribute("data-value", "0", timeout=UI_MS)
        select(vet.get_by_role("combobox", name="Stock item"), "Meloxicam")
        quantity = vet.get_by_role("spinbutton", name="Quantity")
        fill(quantity, "5")
        quantity.press("Enter")
        said(vet, f"Added Meloxicam x5 to {number}.")
        said(mgr, "Meloxicam is low: 20 left.")
        expect(count).to_have_attribute("data-value", "1")
        expect(stock_row(mgr, "Meloxicam", 20)).to_contain_text("Low stock")
        draws = [m for m in w.api("mgr").get(f"/api/stock/{sid}/movements").json()["movements"] if m["reason"] == "invoice-line"]
        assert [(m["delta"], m["batch"]) for m in draws] == [(-3, "MX-A"), (-2, "MX-B")]
        assert w.api("vet").post(f"/api/invoices/{d1}/issue").status_code == 200
        assert w.api("front").post(f"/api/invoices/{d1}/void", {"reason": "Entered twice"}).status_code == 200
        expect(count).to_have_attribute("data-value", "0", timeout=UI_MS)
        moved = w.api("mgr").get(f"/api/stock/{sid}/movements").json()
        returns = [m for m in moved["movements"] if m["reason"] == "return"]
        assert sorted((m["batch"], m["delta"]) for m in returns) == [("MX-A", 3), ("MX-B", 2)]
        assert moved["movements"][-1]["balanceAfter"] == moved["onHand"] == 25
        assert lows(mgr) == 1
        set_clock(w.base, "2026-11-18T00:00:00Z")
        said(mgr, "Meloxicam is low: 22 left.")
        expect(count).to_have_attribute("data-value", "1", timeout=UI_MS)
        set_clock(w.base, "2026-11-18T01:00:00Z")
        expect(count).to_have_attribute("data-value", "1")
        assert lows(mgr) == 2
    item = w.api("mgr").get("/api/stock").json()["items"][0]
    assert item["usable"] == 22 and item["onHand"] == 25 and item["low"] is True
    assert [b["expired"] for b in item["batches"] if b["batch"] == MX_A] == [True]


def test_wf_stock_low_alert_form_order(app_url, browser):
    w = _meloxicam_world(app_url)
    with window(browser, w, "mgr", "/stock") as page:
        select(page.get_by_role("combobox", name="Item"), "Meloxicam")
        fill(page.get_by_role("spinbutton", name="Quantity"), "3")
        select(page.get_by_role("combobox", name="Reason"), "Expired")
        select(page.get_by_role("combobox", name="Batch"), "MX-A")
        click(page.get_by_role("button", name="Record movement"))
        said(page, "Meloxicam is low: 22 left.")
        text_ = ann(page).inner_text()
        assert text_.index("Recorded -3 for Meloxicam.") < text_.index("Meloxicam is low: 22 left.")
        expect(page.get_by_role("status", name="Low stock count")).to_have_attribute("data-value", "1")
        select(page.get_by_role("combobox", name="Reason"), "Received")
        fill(page.get_by_role("textbox", name="Batch"), "MX-C")
        fill(page.get_by_label("Expires on"), "2027-09-30")
        fill(page.get_by_role("spinbutton", name="Quantity"), "5")
        click(page.get_by_role("button", name="Record movement"))
        said(page, "Recorded +5 for Meloxicam.")
        expect(page.get_by_role("status", name="Low stock count")).to_have_attribute("data-value", "0", timeout=UI_MS)
    assert not w.api("mgr").get("/api/stock").json()["items"][0]["low"]


def movement_name(delta, label, batch, balance):
    return f"{delta:+d}, {label}, batch {batch}, balance {balance}"


def test_wf_stock_low_alert_movements_live(app_url, browser):
    w = make_world(app_url, invoices=[{"ref": "d1", "clinic": "c", "patient": "p1", "status": "draft", "discountPercent": 0, "lines": []}])
    sid, d1 = w.id("stock", "s1"), w.id("invoices", "d1")
    with window(browser, w, "mgr", "/stock") as page:
        click(page.get_by_role("button", name=f"Movements, {SALINE}"))
        moves = page.get_by_role("list", name="Movements")
        expect(moves.get_by_role("listitem", name=movement_name(5, "Received", "B1", 5), exact=True)).to_be_visible(timeout=UI_MS)
        expect(moves.get_by_role("listitem", name=movement_name(10, "Received", "B2", 15), exact=True)).to_be_visible()
        line = w.api("vet").post(f"/api/invoices/{d1}/lines", {"stockItemId": sid, "quantity": 7})
        assert line.status_code == 201, line.text
        expect(moves.get_by_role("listitem", name=movement_name(-5, "Invoice line", "B1", 10), exact=True)).to_be_visible(timeout=UI_MS)
        expect(moves.get_by_role("listitem", name=movement_name(-2, "Invoice line", "B2", 8), exact=True)).to_be_visible(timeout=UI_MS)
        expect(stock_row(page, SALINE, 8)).to_contain_text("Usable 8", timeout=UI_MS)
    after = w.api("mgr").get(f"/api/stock/{sid}/movements").json()
    assert [(m["delta"], m["batch"], m["balanceAfter"]) for m in after["movements"] if m["reason"] == "invoice-line"] == [(-5, "B1", 10), (-2, "B2", 8)]
    assert after["onHand"] == 8


RATE = 10


def test_dp45_online_booking_rules(app_url):
    w = make_world(app_url, clock=at(8, 50))
    base, slug, v1, v2 = w.base, w.slug, w.uid_of("vet"), w.uid_of("vet2")

    def slots(day, reason="Check-up"):
        r = httpx.get(f"{base}/api/public/clinics/{slug}/slots", params={"date": day, "reason": reason}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, r.text
        return r.json()["slots"]

    def book(start, vet, n, **kw):
        return book_public(base, slug, start, vet, email=f"v{n}.{w.uid}@example.test", **kw)
    today = slots(DAY)
    assert min(utc(s["start"]) for s in today) == utc(at(9, 30))
    assert {s["vetId"] for s in today if utc(s["start"]) == utc(at(9, 30))} == {v1, v2}
    err(book(at(9, 0), v1, 0), 422, "out_of_window", "That time is not available for online booking.", "start")
    err(book(at(9, 0, day="2026-12-15"), v1, 0), 422, "out_of_window", field="start")
    assert book(at(8, 45, day="2026-12-15"), v1, 1).status_code == 201
    made = book(at(9, 30), v1, 2, pet="Pip")
    assert made.status_code == 201
    code = made.json()["code"]
    shown = httpx.get(f"{base}/api/public/bookings/{code}", timeout=HTTP_TIMEOUT)
    assert shown.status_code == 200 and shown.json()["petName"] == PIP and shown.json()["clinicName"] == clinic_name(w.uid)
    assert httpx.get(f"{base}/api/public/bookings/{code}x", timeout=HTTP_TIMEOUT).status_code == 404
    assert v1 not in [s["vetId"] for s in slots(DAY) if utc(s["start"]) == utc(at(9, 30))]
    with ThreadPoolExecutor(2) as pool:
        racers = list(pool.map(lambda n: book(at(9, 45), v2, 10 + n), range(2)))
    assert sorted(r.status_code for r in racers) == [201, 409]
    err(next(r for r in racers if r.status_code == 409), 409, "slot_taken", SLOT_TAKEN)
    assert httpx.get(f"{base}/api/public/clinics/{slug}/slots", params={"date": "nope"}).status_code == 422
    err(httpx.get(f"{base}/api/public/clinics/{slug}/slots", params={"date": DAY, "reason": "Haircut"}), 422, "validation_failed", field="reason")
    assert httpx.get(f"{base}/api/public/clinics/nope-{w.uid}", timeout=HTTP_TIMEOUT).status_code == 404
    set_clock(base, "2026-10-20T06:50:00Z")
    vacc = [utc(s["start"]) for s in slots("2026-10-20", "Vaccination")]
    other = [utc(s["start"]) for s in slots("2026-10-20")]
    assert min(vacc) == utc("2026-10-20T07:30:00Z") and max(vacc) == utc("2026-10-20T10:45:00Z")
    assert max(other) == utc("2026-10-20T16:45:00Z")
    set_clock(base, CLOCK)
    for n in range(RATE):
        assert book(at(10, 0), v1, 20 + n, owner="").status_code == 422
    err(book(at(10, 0), v1, 40), 429, "rate_limited", "Too many booking attempts. Try again in a minute.")
    assert v1 in [s["vetId"] for s in slots(DAY) if utc(s["start"]) == utc(at(10, 0))]
    set_clock(base, CLOCK)
    assert book(at(10, 0), v1, 41).status_code == 201


def test_dp46_owner_text(app_url, mail):
    w = make_world(app_url)
    v1, email = w.uid_of("vet"), f"zoe.{w.uid}@example.test"
    owner, pet = "Zoë O'Neil 🐾", "Bärli 🐾"
    ok = book_public(w.base, w.slug, at(9, 30), v1, owner=owner, email=email, pet=pet)
    assert ok.status_code == 201
    m = mails_to(mail, email, want=1)
    assert len(m) == 1
    assert m[0]["Subject"] == confirm_subject(pet, at(9, 30))
    assert mail_text(m[0]).lstrip().startswith(f"Hello {owner},")
    assert "Zoë" not in m[0]["Subject"] and len(addresses(m[0]["To"])) == 1 and not m[0].get("Bcc")
    assert m[0]["From"]["Address"] == mail_from_address()
    refused = f"refused.{w.uid}@example.test"
    bad = [("owner", "A\nB", "ownerName", "Enter your name."), ("owner", "A\r\nBcc: evil@example.test", "ownerName", "Enter your name."),
           ("owner", "x" * 81, "ownerName", "Enter your name."), ("owner", "", "ownerName", "Enter your name."),
           ("pet", "bell\x07", "petName", "Enter your pet's name."), ("pet", "P\r\nBcc: evil@example.test", "petName", "Enter your pet's name."),
           ("pet", "y" * 81, "petName", "Enter your pet's name.")]
    for which, value, field, message in bad:
        kw = {"owner": value} if which == "owner" else {"pet": value}
        err(book_public(w.base, w.slug, at(10, 0), v1, email=refused, **kw), 422, "validation_failed", message, field)
    err(book_public(w.base, w.slug, at(10, 0), v1, email="not-an-email"), 422, "validation_failed",
        "Enter an email address like name@example.com.", "ownerEmail")
    assert mails_to(mail, refused) == []
    assert not [a for a in w.api("front").get(f"/api/appointments?date={DAY}").json()["appointments"] if a["start"].startswith("2026-11-17T10:00")]
    trimmed = book_public(w.base, w.slug, at(10, 15), v1, email=refused, pet="  " + "y" * 80 + "  ")
    assert trimmed.status_code == 201 and trimmed.json()["petName"] == "y" * 80


def _time_button(page, hour):
    return page.get_by_role("button", name=re.compile(rf"^{hour} with "))


def test_dp47_public_page_phone(app_url, browser, mail):
    w = make_world(app_url)
    email = f"visitor.{w.uid}@example.test"
    posts = []
    with open_app(browser, f"{w.base}/book/{w.slug}", touch=True) as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        group = page.get_by_role("radiogroup", name="Reason for visit")
        expect(group).to_be_visible(timeout=UI_MS)
        ys = [group.bounding_box()["y"], page.get_by_label("Day", exact=True).bounding_box()["y"],
              page.get_by_role("region", name="Our services").bounding_box()["y"], page.get_by_role("region", name="Meet the vets").bounding_box()["y"]]
        assert ys == sorted(ys)
        tap(page.get_by_role("button", name="Choose a time"))
        poll(lambda: focused_name(page) == "Day", 'focus == "Day"')
        fill(page.get_by_label("Day", exact=True), DAY)
        check(page.get_by_role("radio", name="Check-up"))
        expect(group).to_contain_text("Chosen")
        gate, settled = [], []
        page.route("**/api/public/clinics/*/slots*", lambda route: gate.append(route) if "reason=Vaccination" in route.request.url and not gate else route.continue_())
        page.on("requestfinished", lambda r: settled.append(r) if "reason=Vaccination" in r.url else None)
        page.on("requestfailed", lambda r: settled.append(r) if "reason=Vaccination" in r.url else None)
        check(page.get_by_role("radio", name="Vaccination"))
        check(page.get_by_role("radio", name="Check-up"))
        expect(_time_button(page, "12:00").first).to_be_visible(timeout=UI_MS)
        try:
            gate[0].continue_()
        except Exception:
            pass
        poll(lambda: page.evaluate("1") and bool(settled), "the superseded Vaccination slots request settled")
        expect(_time_button(page, "12:00").first).to_be_visible()
        _time_button(page, "12:00").first.focus()
        vet_name = focused_name(page).split(" with ", 1)[1].strip()
        tap(_time_button(page, "12:00").first)
        chosen = page.get_by_role("status", name="Chosen time")
        expect(chosen).to_contain_text(f"You chose 12:00 with {vet_name} on {day_label(at(12))}.")
        owner, pet = "Zoë O'Neil", "Mimi"
        fill(page.get_by_role("textbox", name="Your name"), owner)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_role("textbox", name="Pet name"), pet)
        select(page.get_by_role("combobox", name="Species"), "Dog")
        with page.expect_response(lambda r: "/slots" in r.url):
            advance(page, REFRESH_MS)
        expect(chosen).to_contain_text("You chose")
        expect(chosen).to_contain_text("12:00")
        assert page.get_by_role("textbox", name="Pet name").input_value() == pet
        taker = w.uid_of("vet") if vet_name == NAMES["vet"] else w.uid_of("vet2")
        assert book_public(w.base, w.slug, at(12), taker, email=f"other.{w.uid}@example.test").status_code == 201
        with page.expect_response(lambda r: "/slots" in r.url):
            advance(page, REFRESH_MS)
        expect(chosen).to_contain_text(SLOT_TAKEN, timeout=UI_MS)
        page.on("request", lambda r: posts.append(r) if r.method == "POST" and "/bookings" in r.url else None)
        tap(_time_button(page, "10:00").first)
        assert page.get_by_role("textbox", name="Your name").input_value() == owner
        assert page.get_by_role("textbox", name="Pet name").input_value() == pet
        with held(page, "**/api/public/clinics/*/bookings") as gate2:
            tap(page.get_by_role("button", name="Confirm booking"))
            confirm = page.get_by_role("button", name="Confirm booking")
            expect(confirm).to_be_disabled()
            expect(confirm).to_have_attribute("aria-busy", "true")
            confirm.evaluate("el => { el.click(); el.click(); }")
            gate2.release()
        expect(page.get_by_role("heading", name="Your visit is booked")).to_be_visible(timeout=UI_MS)
    assert len(posts) == 1
    assert len(mails_to(mail, email, want=1)) == 1


def test_dp47_reason_radiogroup_arrow_keys(app_url, browser):
    w = make_world(app_url)
    with open_app(browser, f"{w.base}/book/{w.slug}") as page:
        group = page.get_by_role("radiogroup", name="Reason for visit")
        radios = group.get_by_role("radio")
        expect(radios).to_have_count(4, timeout=UI_MS)
        check(radios.nth(0))
        radios.nth(0).focus()
        for key, index in (("ArrowRight", 1), ("ArrowDown", 2)):
            page.keyboard.press(key)
            expect(radios.nth(index)).to_be_checked()
            expect(radios.nth(index)).to_be_focused()
            expect(radios.nth(index - 1)).not_to_be_checked()


def test_dp47_day_change_drops_old_times(app_url, browser):
    w = make_world(app_url)
    next_day = str(date.fromisoformat(DAY) + timedelta(days=1))
    with open_app(browser, f"{w.base}/book/{w.slug}", touch=True) as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        day = page.get_by_label("Day", exact=True)
        fill(day, DAY)
        check(page.get_by_role("radio", name="Check-up"))
        times = page.get_by_role("button", name=re.compile(r"^\d\d:\d\d with "))
        expect(_time_button(page, "09:30").first).to_be_visible(timeout=UI_MS)
        expect(_time_button(page, "08:00")).to_have_count(0)
        with held(page, "**/api/public/clinics/*/slots*") as gate:
            fill(day, next_day)
            expect(times).to_have_count(0, timeout=UI_MS)
            gate.release()
        expect(_time_button(page, "08:00").first).to_be_visible(timeout=UI_MS)


def test_wf_phone_online_booking_journey(app_url, browser, mail):
    w = make_world(app_url)
    email = f"mimi.{w.uid}@example.test"
    with window(browser, w, "front") as staff, open_app(browser, f"{w.base}/book/{w.slug}", touch=True) as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        page.clock.set_fixed_time(datetime(2026, 11, 16, 23, 30, tzinfo=timezone.utc))
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "America/Los_Angeles"})
        page.reload()
        tap(page.get_by_role("button", name="Choose a time"))
        fill(page.get_by_label("Day", exact=True), "2026-11-18")
        check(page.get_by_role("radio", name="Limping or injury"))
        fill(page.get_by_label("Day", exact=True), DAY)
        button = page.get_by_role("button", name=re.compile(r"^\d\d:\d\d with ")).first
        expect(button).to_be_visible(timeout=UI_MS)
        button.focus()
        label = focused_name(page).strip()
        when, vet_name = label.split(" with ", 1)
        tap(button)
        owner, pet = "Zoë O'Neil", "Mimi"
        fill(page.get_by_role("textbox", name="Your name"), owner)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_role("textbox", name="Pet name"), pet)
        select(page.get_by_role("combobox", name="Species"), "Cat")
        tap(page.get_by_role("button", name="Confirm booking"))
        expect(page.get_by_role("heading", name="Your visit is booked")).to_be_visible(timeout=UI_MS)
        expect(page.locator("body")).to_contain_text(f"{pet} is booked with {vet_name} on {day_label(at(9))} at {when}.")
        expect(page.locator("body")).to_contain_text(f"A confirmation email is on its way to {email}.")
        code = page.url.rstrip("/").split("/")[-1]
        expect(abtn(staff, "Mimi")).to_be_visible(timeout=UI_MS)
    m = mails_to(mail, email, want=1)
    assert len(m) == 1 and m[0]["Subject"] == f"Booking confirmed: {pet} on {day_label(at(9))} at {when}"
    assert mail_text(m[0]).lstrip().startswith(f"Hello {owner},")
    assert httpx.get(f"{w.base}/api/public/bookings/{code}", timeout=HTTP_TIMEOUT).json()["ownerEmail"] == email


def test_wf_phone_online_booking_refused_name(app_url, browser, mail):
    w = make_world(app_url)
    email = f"long.{w.uid}@example.test"
    with open_app(browser, f"{w.base}/book/{w.slug}", touch=True) as page:
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        tap(page.get_by_role("button", name="Choose a time"))
        fill(page.get_by_label("Day", exact=True), DAY)
        check(page.get_by_role("radio", name="Check-up"))
        tap(page.get_by_role("button", name=re.compile(r"^\d\d:\d\d with ")).first)
        fill(page.get_by_role("textbox", name="Your name"), "Zoë")
        fill(page.get_by_role("textbox", name="Email"), email)
        pet = page.get_by_role("textbox", name="Pet name")
        fill(pet, "y" * 81)
        select(page.get_by_role("combobox", name="Species"), "Dog")
        if len(pet.input_value()) == 81:
            tap(page.get_by_role("button", name="Confirm booking"))
            expect(page.get_by_text("Enter your pet's name.")).to_be_visible(timeout=UI_MS)
            expect(page.get_by_role("heading", name="Your visit is booked")).to_have_count(0)
        else:
            assert len(pet.input_value()) == 80
            pet.evaluate("""(el, v) => { el.removeAttribute('maxlength');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
                el.dispatchEvent(new Event('input', {bubbles: true})); }""", "y" * 81)
            tap(page.get_by_role("button", name="Confirm booking"))
            expect(page.get_by_text("Enter your pet's name.")).to_be_visible(timeout=UI_MS)
            expect(page.get_by_role("heading", name="Your visit is booked")).to_have_count(0)
    assert mails_to(mail, email) == []
    assert w.api("front").get(f"/api/appointments?date={DAY}").json()["appointments"] == []


REMIND_CASES = {
    "bst-send": ("2026-10-01T08:00:00Z", "2026-11-05", [("2026-10-08T07:59:00Z", 0), ("2026-10-08T08:00:00Z", 1), ("2026-10-08T12:00:00Z", 1)], "Sent"),
    "gmt-send": ("2027-03-01T08:00:00Z", "2027-04-20", [("2027-03-23T08:59:00Z", 0), ("2027-03-23T09:00:00Z", 1)], "Sent"),
    "jumped": ("2026-12-01T08:00:00Z", "2026-12-30", [("2026-12-10T10:00:00Z", 1), ("2026-12-10T11:00:00Z", 1)], "Sent"),
    "recorded-late": ("2026-12-20T10:00:00Z", "2026-12-30", [("2026-12-20T11:00:00Z", 0)], "Missed"),
    "due-reached": ("2027-01-01T08:00:00Z", "2027-02-10", [("2027-02-10T12:00:00Z", 0)], "Missed"),
}


@pytest.mark.parametrize("case", list(REMIND_CASES), ids=list(REMIND_CASES))
def test_dp49_reminder_schedule(app_url, mail, case):
    start, due, steps, status = REMIND_CASES[case]
    w = make_world(app_url, clock=start, vacc=[{"vaccine": "DHPPi", "dueDate": due}])
    for clock, expected in steps:
        set_clock(w.base, clock)
        assert len(mails_to(mail, w.owner_email, want=expected)) == expected, (case, clock)
    got = w.api("vet").get(f"/api/patients/{w.id('patients', 'p1')}").json()["vaccinations"][0]["reminder"]
    assert got == status


def _send_reminder(app_url, mail, **kw):
    w = make_world(app_url, clock="2026-10-01T08:00:00Z", vacc=[{"vaccine": "DHPPi", "dueDate": "2026-11-05"}], **kw)
    return w


def test_dp50_reminder_email(app_url, browser, mail):
    w = _send_reminder(app_url, mail)
    pid = w.id("patients", "p1")
    assert w.api("vet").get(f"/api/patients/{pid}").json()["vaccinations"][0]["reminder"] == "Scheduled"
    set_clock(w.base, "2026-10-08T08:00:00Z")
    m = mails_to(mail, w.owner_email, want=1)
    assert len(m) == 1 and m[0]["Subject"] == reminder_subject(REX, "DHPPi", "2026-11-05") and len(addresses(m[0]["To"])) == 1
    link = re.search(rf"/book/{w.slug}\?pet=([^\s\"'<>]+)", mail_text(m[0]))
    assert link and len(link.group(1)) >= 16
    assert w.api("vet").get(f"/api/patients/{pid}").json()["vaccinations"][0]["reminder"] == "Sent"
    with window(browser, w, "vet", f"/patients/{pid}?tab=vaccinations") as page:
        item = page.get_by_role("list", name="Vaccinations").get_by_role("listitem", name=vacc_name("DHPPi", "2026-11-05"))
        expect(item).to_contain_text("Reminder: Sent", timeout=UI_MS)


def test_dp51_reminder_link_scope(app_url, browser, mail):
    w = _send_reminder(app_url, mail)
    other = make_world(app_url, clock="2026-10-01T08:00:00Z")
    set_clock(w.base, "2026-10-08T08:00:00Z")
    token = re.search(r"\?pet=([^\s\"'<>]+)", mail_text(mails_to(mail, w.owner_email, want=1)[0])).group(1)
    path = f"/api/public/clinics/{w.slug}/pets/{token}"
    got = httpx.get(w.base + path, timeout=HTTP_TIMEOUT)
    assert got.status_code == 200 and got.json()["petName"] == REX and got.json()["ownerEmail"] == w.owner_email
    assert httpx.get(f"{w.base}/api/public/clinics/{other.slug}/pets/{token}", timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.get(f"{w.base}/api/public/clinics/{w.slug}/pets/{token}x", timeout=HTTP_TIMEOUT).status_code == 404
    with open_app(browser, f"{w.base}/book/{w.slug}?pet={token}") as page:
        expect(page.get_by_text(booking_for(REX))).to_be_visible(timeout=UI_MS)
        check(page.get_by_role("radio", name="Check-up"))
        fill(page.get_by_label("Day", exact=True), "2026-10-09")
        click(page.get_by_role("button", name=re.compile(r"^\d\d:\d\d with ")).first)
        assert page.get_by_role("textbox", name="Pet name").input_value() == REX
    booked = book_public(w.base, w.slug, "2026-10-09T10:00:00Z", w.uid_of("vet"), email=w.owner_email, pet=REX, token=token)
    assert booked.status_code == 201 and booked.json()["petName"] == REX
    set_clock(w.base, "2026-11-05T23:59:00Z")
    assert httpx.get(w.base + path, timeout=HTTP_TIMEOUT).status_code == 200
    set_clock(w.base, "2026-11-06T00:00:00Z")
    assert httpx.get(w.base + path, timeout=HTTP_TIMEOUT).status_code == 404
    set_clock(w.base, "2026-11-06T08:00:00Z")
    err(book_public(w.base, w.slug, "2026-11-10T10:00:00Z", w.uid_of("vet"), token=token), 404, "not_found")
    assert not w.api("front").get("/api/appointments", params={"date": "2026-11-10"}).json()["appointments"]
    with open_app(browser, f"{w.base}/book/{w.slug}?pet={token}") as page:
        expect(page.get_by_role("heading", name="Book a visit for your animal")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_text(booking_for(REX))).to_have_count(0)
        expect(page.get_by_role("alert").filter(has_text=re.compile(r"\S"))).to_have_count(0)


def test_wf_vaccination_reminders_journey(app_url, browser, mail):
    w = make_world(app_url, clock="2026-10-01T08:00:00Z")
    pid = w.id("patients", "p1")
    with window(browser, w, "vet", f"/patients/{pid}?tab=vaccinations") as page:
        fill(page.get_by_role("textbox", name="Vaccine"), "DHPPi")
        fill(page.get_by_label("Due date"), "2026-11-05")
        click(page.get_by_role("button", name="Add vaccination"))
        said(page, "Vaccination added.")
        item = page.get_by_role("list", name="Vaccinations").get_by_role("listitem", name=vacc_name("DHPPi", "2026-11-05"))
        expect(item).to_contain_text("Reminder: Scheduled", timeout=UI_MS)
        set_clock(w.base, "2026-10-08T08:00:00Z")
        msgs = mails_to(mail, w.owner_email, want=1)
        page.reload()
        expect(page.get_by_role("list", name="Vaccinations").get_by_role("listitem", name=vacc_name("DHPPi", "2026-11-05"))).to_contain_text("Reminder: Sent", timeout=UI_MS)
        set_clock(w.base, "2026-10-08T12:00:00Z")
        assert len(mails_to(mail, w.owner_email)) == 1 == len(msgs)
    link = re.search(r"(/book/[^\s\"'<>]+\?pet=[^\s\"'<>]+)", mail_text(msgs[0])).group(1)
    with open_app(browser, w.base + link) as page:
        expect(page.get_by_text(booking_for(REX))).to_be_visible(timeout=UI_MS)
        check(page.get_by_role("radio", name="Check-up"))
        fill(page.get_by_label("Day", exact=True), "2026-10-09")
        click(page.get_by_role("button", name=re.compile(r"^\d\d:\d\d with ")).first)
        assert page.get_by_role("textbox", name="Pet name").input_value() == REX


def test_wf_vaccination_reminders_missed(app_url, browser, mail):
    w = make_world(app_url, clock="2026-12-20T10:00:00Z", vacc=[{"vaccine": "FVRCP", "dueDate": "2026-12-30"}])
    with window(browser, w, "vet", f"/patients/{w.id('patients', 'p1')}?tab=vaccinations") as page:
        expect(page.get_by_role("list", name="Vaccinations").get_by_role("listitem", name=vacc_name("FVRCP", "2026-12-30"))).to_contain_text("Reminder: Missed", timeout=UI_MS)
    set_clock(w.base, "2026-12-21T09:00:00Z")
    assert mails_to(mail, w.owner_email) == []


def test_wf_vaccination_reminders_add_busy(app_url, browser):
    w = make_world(app_url, clock="2026-10-01T08:00:00Z")
    pid = w.id("patients", "p1")
    with window(browser, w, "vet", f"/patients/{pid}?tab=vaccinations") as page:
        fill(page.get_by_role("textbox", name="Vaccine"), "DHPPi")
        fill(page.get_by_label("Due date"), "2026-11-05")
        add = page.get_by_role("button", name="Add vaccination")
        with held(page, "**/api/patients/*/vaccinations") as gate:
            click(add)
            expect(add).to_be_disabled()
            expect(add).to_have_attribute("aria-busy", "true")
            gate.release()
        said(page, "Vaccination added.")
        item = page.get_by_role("list", name="Vaccinations").get_by_role("listitem", name=vacc_name("DHPPi", "2026-11-05"))
        expect(item).to_be_visible(timeout=UI_MS)
    vaccinations = w.api("vet").get(f"/api/patients/{pid}").json()["vaccinations"]
    assert [v["vaccine"] for v in vaccinations] == ["DHPPi"]


def test_dp53_upload_and_listing(app_url):
    w = make_world(app_url)
    vet, pid, cid = w.api("vet"), w.id("patients", "p1"), w.cid()
    name = "chèst x-ray #1.png"
    first = upload(vet, pid, name, PNG)
    body = first.json()
    assert first.status_code == 201 and body["name"] == name and body["kind"] == "xray" and body["contentType"] == "image/png"
    assert body["sizeBytes"] == len(PNG) and body["sha256"] == hashlib.sha256(PNG).hexdigest() and body["url"]
    other = PNG + b"-second"
    second = upload(vet, pid, name, other).json()
    assert second["id"] != body["id"]
    listed = vet.get(f"/api/patients/{pid}/files").json()["files"]
    assert [f["id"] for f in listed] == [body["id"], second["id"]]
    keys = S3().keys(f"clinics/{cid}/patients/{pid}/")
    assert len(keys) == 2 and sorted(S3().get(k) for k in keys) == sorted([PNG, other])
    assert vet.get(f"/api/files/{body['id']}/content").content == PNG
    assert upload(vet, pid, "scan.pdf", PNG, kind="lab", ctype="application/pdf").json()["contentType"] == "image/png"
    err(upload(vet, pid, "a.png", PNG, kind="bogus"), 422, "validation_failed", field="kind")
    err(upload(w.api("front"), pid, "a.png", PNG), 403, "forbidden")
    big = PNG + b"\0" * (UPLOAD_MAX_BYTES + 1 - len(PNG))
    err(upload(vet, pid, "big.png", big), 422, "file_too_large", "That file is larger than 10 MB.", "file")
    exact = PNG + b"\0" * (UPLOAD_MAX_BYTES - len(PNG))
    assert upload(vet, pid, "exact.png", exact).status_code == 201


def test_dp54_safe_serving(app_url):
    w = make_world(app_url)
    vet, pid, cid = w.api("vet"), w.id("patients", "p1"), w.cid()
    prefix = f"clinics/{cid}/patients/{pid}/"
    bad = {"html": b"<html><script>alert(1)</script></html>", "svg": b"<svg xmlns='http://www.w3.org/2000/svg'></svg>",
           "late-signature": b"junk" + PNG, "empty": b""}
    for label, data in bad.items():
        err(upload(vet, pid, "xray.png", data, ctype="image/png"), 422, "unsupported_type", "Only JPEG, PNG or PDF files are allowed.", "file")
    assert S3().keys(prefix) == [] and vet.get(f"/api/patients/{pid}/files").json()["files"] == []
    name = "xrày.png"
    for data, ctype in ((PNG, "image/png"), (JPEG, "image/jpeg"), (PDF, "application/pdf")):
        stored = upload(vet, pid, name, data, ctype="text/html").json()
        assert stored["contentType"] == ctype
        r = vet.get(f"/api/files/{stored['id']}/content")
        assert r.content == data and r.headers["content-type"].split(";")[0] == ctype
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["content-security-policy"] == "sandbox; default-src 'none'"
        assert r.headers["content-disposition"] == f"attachment; filename*=UTF-8''{quote(name)}"


def test_dp55_storage_outage(app_url):
    out = os.environ["APP_MINIO_DOWN_URL"]
    h = httpx.get(out + "/api/health", timeout=HTTP_TIMEOUT)
    assert h.status_code == 200 and h.json() == {"status": "unavailable"}
    w = make_world(out)
    vet, pid, cid = w.api("vet"), w.id("patients", "p1"), w.cid()
    err(upload(vet, pid, "a.png", PNG), 503, "storage_unavailable", "File storage is unavailable. Your file was not saved.")
    err(upload(vet, pid, "a.png", b"<html></html>"), 422, "unsupported_type")
    assert vet.get(f"/api/patients/{pid}/files").json()["files"] == []
    err(vet.get(f"/api/patients/{pid}/history.pdf"), 503, "storage_unavailable", "File storage is unavailable.")
    inv = _invoice(w, [("s1", 1)], issue=True)[0]
    err(vet.get(f"/api/invoices/{inv}.pdf"), 503, "storage_unavailable", "File storage is unavailable.")
    assert S3().keys(f"clinics/{cid}/") == []
    assert vet.get("/api/appointments").status_code == 200


def test_dp56_pdf_exports(app_url, browser):
    past = [appt(f"h{i}", "p1", "vet", "r1", (9, 0, str(date(2026, 9, 1) + timedelta(days=i))), status="completed") for i in range(25)]
    w = make_world(app_url, appts=past)
    vet, pid, cid = w.api("vet"), w.id("patients", "p1"), w.cid()
    plain = vet.get(f"/api/patients/{pid}/history.pdf")
    assert plain.status_code == 200 and plain.headers["content-type"].startswith("application/pdf")
    text_ = pdf_text(plain.content)
    assert f"Patient: {REX}" in text_ and "Page 1 of 1" in text_
    assert history_line("2026-09-01", "Consult", VERA) in text_ and history_line("2026-09-25", "Consult", VERA) in text_
    assert "File:" not in text_
    proof = "proof.png"
    assert upload(vet, pid, proof, PNG).status_code == 201
    assert file_line(proof) not in pdf_text(vet.get(f"/api/patients/{pid}/history.pdf").content)
    withfiles = vet.get(f"/api/patients/{pid}/history.pdf?include=files")
    t2 = pdf_text(withfiles.content)
    assert file_line(proof) in t2 and "Page 1 of 2" in t2 and "Page 2 of 2" in t2 and t2.count(f"Patient: {REX}") >= 2
    keys = S3().keys(f"clinics/{cid}/exports/")
    assert any(f"history-{pid}-" in k and S3().get(k) == withfiles.content for k in keys)
    empty = pdf_text(vet.get(f"/api/patients/{w.id('patients', 'p2')}/history.pdf").content)
    assert f"Patient: {PIP}" in empty and "Page 1 of 1" in empty
    inv = _invoice(w, [("s1", 1)], issue=True)[0]
    pdf = w.api("front").get(f"/api/invoices/{inv}.pdf")
    assert any(f"invoice-{inv}-" in k and S3().get(k) == pdf.content for k in S3().keys(f"clinics/{cid}/exports/"))
    assert "Page 1 of 1" in pdf_text(pdf.content)
    with window(browser, w, "mgr", f"/patients/{pid}?tab=history") as page:
        panel = page.get_by_role("tabpanel", name="History")
        expect(panel).to_contain_text(VERA, timeout=UI_MS)
        expect(page.get_by_role("link", name="Export history PDF")).to_be_visible()


def test_wf_files_and_storage_outage_journey(app_url, browser):
    w = make_world(app_url)
    pid, cid = w.id("patients", "p1"), w.cid()
    with window(browser, w, "mgr", f"/patients/{pid}?tab=files") as page:
        select(page.get_by_role("combobox", name="File type"), "X-ray")
        with held(page, "**/api/patients/*/files") as gate:
            page.get_by_label("Add file").set_input_files({"name": XRAY, "mimeType": "image/png", "buffer": PNG})
            expect(page.get_by_text(f"Uploading {XRAY}")).to_be_visible(timeout=UI_MS)
            expect(page.get_by_role("list", name="Patient files").get_by_role("listitem", name=joined(XRAY, "X-ray"))).to_have_count(0)
            gate.release()
        said(page, f"{XRAY} saved to Files.")
        item = page.get_by_role("list", name="Patient files").get_by_role("listitem", name=joined(XRAY, "X-ray"))
        expect(item).to_be_visible(timeout=UI_MS)
        expect(item).to_contain_text(hashlib.sha256(PNG).hexdigest())
        assert item.evaluate("el => [...el.querySelectorAll('*')].some(e => (e.currentSrc || e.src || '').includes('/api/files/') || getComputedStyle(e).backgroundImage.includes('/api/files/'))")
        expect(item.get_by_role("link", name=opener(XRAY))).to_be_visible()
        page.goto(f"{w.base}/patients/{pid}?tab=history")
        href = page.get_by_role("link", name="Export history PDF").get_attribute("href")
        assert "include=files" not in href
        assert file_line(XRAY) not in pdf_text(page.request.get(w.base + href).body())
    assert any(S3().get(k) == PNG for k in S3().keys(f"clinics/{cid}/patients/{pid}/"))
    assert file_line(XRAY) in pdf_text(w.api("mgr").get(f"/api/patients/{pid}/history.pdf?include=files").content)
    wo = make_world(os.environ["APP_MINIO_DOWN_URL"])
    opid = wo.id("patients", "p1")
    with window(browser, wo, "mgr", f"/patients/{opid}?tab=files") as page:
        select(page.get_by_role("combobox", name="File type"), "X-ray")
        page.get_by_label("Add file").set_input_files({"name": "chest-xray.png", "mimeType": "image/png", "buffer": PNG})
        expect(page.get_by_role("alert").filter(has_text="File storage is unavailable. Your file was not saved.").first).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("list", name="Patient files").get_by_role("listitem")).to_have_count(0)
    assert S3().keys(f"clinics/{wo.cid()}/") == []


def test_wf_files_and_storage_outage_unsafe_file(app_url, browser):
    w = make_world(app_url)
    pid, cid = w.id("patients", "p1"), w.cid()
    with window(browser, w, "mgr", f"/patients/{pid}?tab=files") as page:
        select(page.get_by_role("combobox", name="File type"), "X-ray")
        page.get_by_label("Add file").set_input_files({"name": "xray.png", "mimeType": "image/png", "buffer": b"<html>run me</html>"})
        expect(page.get_by_role("alert").filter(has_text="Only JPEG, PNG or PDF files are allowed.").first).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("list", name="Patient files").get_by_role("listitem")).to_have_count(0)
    assert S3().keys(f"clinics/{cid}/patients/{pid}/") == []


def test_dp58_invitation_api(app_url, browser, mail):
    w = make_world(app_url)
    mgr, email = w.api("mgr"), f"nora.{w.uid}@example.test"
    first = mgr.post("/api/staff/invitations", {"email": email, "name": "Nora New", "role": "nurse"})
    assert first.status_code == 201 and first.json()["status"] == "Invited"
    token_of = lambda m: re.search(r"/invite/([^\s\"'<>]+)", mail_text(m)).group(1)
    one = mails_to(mail, email, want=1)
    assert one[0]["Subject"] == f"You're invited to {clinic_name(w.uid)} on Roundbook" and len(addresses(one[0]["To"])) == 1
    t1 = token_of(one[0])
    shown = httpx.get(f"{w.base}/api/invitations/{t1}", timeout=HTTP_TIMEOUT).json()
    assert shown["clinicName"] == clinic_name(w.uid) and shown["email"] == email and shown["name"] == NEW_STAFF
    assert mgr.post("/api/staff/invitations", {"email": email, "name": "Nora New", "role": "nurse"}).status_code == 201
    two = mails_to(mail, email, want=2)
    t2 = next(token_of(m) for m in two if token_of(m) != t1)
    assert httpx.get(f"{w.base}/api/invitations/{t1}", timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.get(f"{w.base}/api/invitations/{t2}", timeout=HTTP_TIMEOUT).status_code == 200
    err(httpx.post(f"{w.base}/api/invitations/{t2}/accept", json={"password": "short"}), 422, "weak_password", "Use at least 10 characters.", "password")
    err(mgr.post("/api/staff/invitations", {"email": w.email("front"), "name": "Dup", "role": "nurse"}), 409, "email_taken", "That email already has access.")
    with open_app(browser, f"{w.base}/invite/{t2}") as page:
        expect(page.get_by_role("heading", name=f"Join {clinic_name(w.uid)}")).to_be_visible(timeout=UI_MS)
        fill(page.get_by_role("textbox", name="Password"), "a-long-enough-pass")
        click(page.get_by_role("button", name="Set password"))
        expect(page).to_have_url(re.compile(r"/today$"), timeout=UI_MS)
    assert httpx.get(f"{w.base}/api/invitations/{t2}", timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.post(f"{w.base}/api/invitations/{t2}/accept", json={"password": "a-long-enough-pass"}).status_code == 404
    me = httpx.post(f"{w.base}/api/session", json={"email": email, "password": "a-long-enough-pass"})
    assert me.status_code == 200 and me.json()["user"]["role"] == "nurse"


def test_dp58_signin_landing(app_url, browser):
    w = make_world(app_url)
    pid = w.id("patients", "p1")
    safe = f"/patients/{pid}?tab=files"
    for nxt, expected in ((safe, safe), ("/" * 2 + "evil.test", "/today"), ("https://evil.test", "/today"), ("/\\evil", "/today")):
        r = httpx.post(f"{w.base}/api/session", json={"email": w.email("vet"), "password": PASSWORD, "next": nxt})
        assert r.status_code == 200 and r.json()["landing"] == expected, nxt
    err(httpx.post(f"{w.base}/api/session", json={"email": w.email("vet"), "password": "wrong-password"}), 401, "invalid_credentials", "Email or password is not right.")
    link = w.ids["users"]["nurse"]["login_url"]
    r = httpx.get(f"{link}{'&' if '?' in link else '?'}next={quote(safe, safe='')}", follow_redirects=False, timeout=HTTP_TIMEOUT)
    assert r.status_code == 302 and r.headers["location"].endswith(safe)
    with open_app(browser, f"{w.base}/today") as page:
        expect(page).to_have_url(re.compile(r"/login\?next=%2Ftoday$"), timeout=UI_MS)
        fill(page.get_by_role("textbox", name="Email"), w.email("vet"))
        fill(page.get_by_role("textbox", name="Password"), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        expect(page).to_have_url(re.compile(r"/today$"), timeout=UI_MS)
        click(page.get_by_role("button", name="Sign out"))
        expect(page).to_have_url(re.compile(r"/login$"), timeout=UI_MS)


def test_dp59_role_change_and_removal(app_url, browser):
    w = make_world(app_url)
    mgr = w.api("mgr")
    staff = {s["email"]: s["id"] for s in mgr.get("/api/staff").json()["staff"]}
    front_id, nurse_id, mgr_id = staff[w.email("front")], staff[w.email("nurse")], staff[w.email("mgr")]
    front = w.api("front")
    assert front.get("/api/me").json()["role"] == "front-desk"
    assert mgr.patch(f"/api/staff/{front_id}", {"role": "vet"}).status_code == 200
    assert front.get("/api/me").json()["role"] == "vet"
    err(front.get("/api/staff"), 403, "forbidden")
    err(mgr.patch(f"/api/staff/{mgr_id}", {"role": "vet"}), 409, "own_access", "You cannot change your own access.")
    err(mgr.delete(f"/api/staff/{mgr_id}"), 409, "own_access")
    nurse = w.api("nurse")
    removed = mgr.delete(f"/api/staff/{nurse_id}")
    assert removed.status_code == 200 and removed.json()["id"] == nurse_id and removed.json()["status"] == "Removed"
    err(nurse.get("/api/me"), 401, "unauthenticated")
    err(httpx.post(f"{w.base}/api/session", json={"email": w.email("nurse"), "password": PASSWORD}), 401, "invalid_credentials", "Email or password is not right.")
    assert mgr.patch(f"/api/staff/{nurse_id}", {"role": "vet"}).status_code == 404
    w2 = make_world(app_url)
    with window(browser, w2, "mgr", "/staff") as m, window(browser, w2, "front") as f, window(browser, w2, "nurse", "/ward") as n:
        click(m.get_by_role("button", name=joined("Change role", FERN)))
        d = dlg(m, "Change role")
        click(d.get_by_role("button", name="Save role"))
        expect(d.get_by_role("alert")).to_contain_text("Role is required.")
        select(d.get_by_role("combobox", name="Role", exact=True), "Vet")
        click(d.get_by_role("button", name="Save role"))
        said(m, "Fern Desk is now Vet.")
        expect(f.get_by_text(joined(FERN, "Vet"))).to_be_visible(timeout=UI_MS)
        click(m.get_by_role("button", name=joined("Remove access", NELL)))
        said(m, "Access removed for Nell Ward.")
        assert focused_name(m) == "Staff"
        expect(m.get_by_role("row", name=joined(NELL, "Nurse", "Removed"))).to_be_visible(timeout=UI_MS)
        expect(n).to_have_url(re.compile(r"/login\?next="), timeout=UI_MS)


def test_dp59_role_change_hides_consult_controls(app_url, browser):
    w = _note_world(app_url)
    a1 = w.id("appointments", "a1")
    with window(browser, w, "vet", f"/consult/{a1}") as page:
        add = page.get_by_role("button", name="Add paragraph")
        invoice = page.get_by_role("button", name="Create invoice")
        expect(add).to_be_visible(timeout=UI_MS)
        expect(invoice).to_be_visible()
        staff = {s["email"]: s["id"] for s in w.api("mgr").get("/api/staff").json()["staff"]}
        assert w.api("mgr").patch(f"/api/staff/{staff[w.email('vet')]}", {"role": "nurse"}).status_code == 200
        expect(page.get_by_text(joined(VERA, "Nurse")).first).to_be_visible(timeout=UI_MS)
        expect(add).to_have_count(0, timeout=UI_MS)
        expect(invoice).to_have_count(0, timeout=UI_MS)
    assert w.api("vet").get("/api/me").json()["role"] == "nurse"


def test_dp60_tenancy(app_url, browser):
    a = make_world(app_url)
    inv_b = {"ref": "i1", "clinic": "c", "patient": "p1", "status": "issued", "discountPercent": 0, "lines": [{"stock": "s1", "quantity": 1}]}
    b = make_world(app_url, appts=[appt("a1", "p1", "vet", "r1", (9, 0))], invoices=[inv_b])
    bp, bi, ba, bs, bf = b.id("patients", "p1"), b.id("invoices", "i1"), b.id("appointments", "a1"), b.id("stock", "s1"), upload(b.api("vet"), b.id("patients", "p1"), "b.png", PNG).json()["id"]
    vet = a.api("vet")
    for method, path, payload in (("GET", f"/api/patients/{bp}", None), ("GET", f"/api/patients/{bp}/files", None), ("GET", f"/api/files/{bf}/content", None),
                                  ("GET", f"/api/patients/{bp}/history.pdf", None), ("GET", f"/api/invoices/{bi}", None), ("GET", f"/api/invoices/{bi}.pdf", None),
                                  ("GET", f"/api/appointments/{ba}/note", None), ("POST", f"/api/appointments/{ba}/check-in", None),
                                  ("PATCH", f"/api/appointments/{ba}", {"start": at(10)}), ("GET", f"/api/stock/{bs}/movements", None),
                                  ("POST", "/api/invoices", {"patientId": bp}),
                                  ("POST", "/api/appointments", {"patientId": bp, "vetId": a.uid_of("vet"), "roomId": a.id("rooms", "r1"), "start": at(10), "reason": "Consult"}),
                                  ("POST", "/api/appointments", {"patientId": a.id("patients", "p1"), "vetId": b.uid_of("vet"), "roomId": a.id("rooms", "r1"), "start": at(10), "reason": "Consult"})):
        err(vet.c.request(method, path, json=payload), 404, "not_found", "We couldn't find that.")
    err(a.api("nurse").get(f"/api/invoices/{bi}"), 404, "not_found")
    err(a.api("mgr").patch(f"/api/staff/{b.uid_of('front')}", {"role": "vet"}), 404, "not_found")
    ids = {p["id"] for p in vet.get("/api/patients", params={"q": REX}).json()["patients"]}
    assert a.id("patients", "p1") in ids and bp not in ids
    with window(browser, a, "vet", f"/patients/{bp}") as page:
        expect(page.get_by_text(NOT_FOUND_PAGE)).to_be_visible(timeout=UI_MS)
        back = page.get_by_role("link", name="Back to today").or_(page.get_by_role("button", name="Back to today"))
        click(back.first)
        expect(page).to_have_url(re.compile(r"/today$"), timeout=UI_MS)


def test_wf_invite_roles_tenancy_journey(app_url, browser, mail):
    big = [stock_item("s1", SALINE, 640, 4, [{"batch": "OPENING", "expiresOn": "2099-12-31", "quantity": 500}])]
    lines = [{"stock": "s1", "quantity": 1}] * 26
    w = make_world(app_url, stock=big, invoices=[{"ref": "i1", "clinic": "c", "patient": "p1", "status": "issued", "discountPercent": 0,
                                                  "lines": lines, "payments": [{"pence": 500, "by": "front"}]}])
    other = make_world(app_url)
    pid, op, iid = w.id("patients", "p1"), other.id("patients", "p1"), w.id("invoices", "i1")
    invitee = f"nora.{w.uid}@example.test"
    with window(browser, w, "mgr", "/staff") as mgr:
        fill(mgr.get_by_role("textbox", name="Name"), "Nora New")
        fill(mgr.get_by_role("textbox", name="Email"), invitee)
        select(mgr.get_by_role("combobox", name="Role"), "Nurse")
        click(mgr.get_by_role("button", name="Send invitation"))
        said(mgr, f"Invitation created for {invitee}.")
    assert len(mails_to(mail, invitee, want=1)) == 1
    link = w.ids["users"]["nurse"]["login_url"]
    record = f"/patients/{pid}?tab=files"
    with ExitStack() as st:
        nurse = st.enter_context(open_app(browser, f"{link}{'&' if '?' in link else '?'}next={quote(record, safe='')}"))
        front = st.enter_context(window(browser, w, "front"))
        nurse.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        expect(nurse).to_have_url(re.compile(re.escape(record) + "$"), timeout=UI_MS)
        expect(nurse.get_by_role("tab", name="Files")).to_have_attribute("aria-selected", "true")
        nurse.goto(f"{w.base}/invoices")
        expect(nurse.get_by_text(FORBIDDEN)).to_be_visible(timeout=UI_MS)
        expect(nurse.get_by_role("link", name="Invoices", exact=True)).to_have_count(0)
        nurse.goto(f"{w.base}/patients/{op}")
        expect(nurse.get_by_text(NOT_FOUND_PAGE)).to_be_visible(timeout=UI_MS)
        click(nurse.get_by_role("link", name="Back to today").or_(nurse.get_by_role("button", name="Back to today")).first)
        expect(nurse).to_have_url(re.compile(r"/today$"), timeout=UI_MS)
        err(w.api("nurse").get("/api/invoices"), 403, "forbidden")
        err(w.api("nurse").get(f"/api/patients/{op}"), 404, "not_found")
        staff = {s["email"]: s["id"] for s in w.api("mgr").get("/api/staff").json()["staff"]}
        assert w.api("mgr").patch(f"/api/staff/{staff[w.email('front')]}", {"role": "vet"}).status_code == 200
        assert w.api("mgr").delete(f"/api/staff/{staff[w.email('nurse')]}").status_code == 200
        expect(front.get_by_text(joined(FERN, "Vet"))).to_be_visible(timeout=UI_MS)
        expect(nurse).to_have_url(re.compile(r"/login\?next="), timeout=UI_MS)
    number = w.api("mgr").get(f"/api/invoices/{iid}").json()["number"]
    each = line_total(640)
    total = 26 * each
    pdf = pdf_text(w.api("mgr").get(f"/api/invoices/{iid}.pdf").content)
    pages = [p for p in pdf.split("\f") if p.strip()]
    assert len(pages) == 2 and all(f"Invoice {number}" in p for p in pages)
    assert "Page 1 of 2" in pages[0] and "Page 2 of 2" in pages[1]
    assert labelled("Balance due", total - 500) in pages[1] and labelled("Total", total) in pages[1] and labelled("Paid", 500) in pages[1]
    assert "Balance due" not in pages[0] and pdf.count(f"{SALINE} {pdf_line(1, each)}") == 26
    assert re.search(re.escape(f"Payment {money(500)} taken by {FERN} at ") + r"\d\d:\d\d", pages[1])


def test_wf_invite_roles_tenancy_unsafe_next_removed_signin(app_url, browser):
    w = make_world(app_url)
    with open_app(browser, f"{w.base}/login?next={quote('/' * 2 + 'evil.test', safe='')}") as page:
        fill(page.get_by_role("textbox", name="Email"), w.email("front"))
        fill(page.get_by_role("textbox", name="Password"), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        expect(page).to_have_url(re.compile(r"/today$"), timeout=UI_MS)
    staff = {s["email"]: s["id"] for s in w.api("mgr").get("/api/staff").json()["staff"]}
    assert w.api("mgr").delete(f"/api/staff/{staff[w.email('nurse')]}").status_code == 200
    with open_app(browser, f"{w.base}/login") as page:
        fill(page.get_by_role("textbox", name="Email"), w.email("nurse"))
        fill(page.get_by_role("textbox", name="Password"), PASSWORD)
        click(page.get_by_role("button", name="Sign in", exact=True))
        expect(page.get_by_role("alert").filter(has_text="Email or password is not right.").first).to_be_visible(timeout=UI_MS)


APP_ROOT = Path("/app")
ALLOWED_LICENCES = {"MIT", "MIT-0", "Apache-2.0", "BSD", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL-1.1"}


def every_shipped_package():
    from conftest import DEPLOYED_APP, Package, _licence
    found = {(p.name, p.version): p for p in shipped_packages()}
    record = DEPLOYED_APP / "node_modules" / ".package-lock.json"
    if not record.is_file():
        return sorted(found.values())
    for key, entry in (json.loads(record.read_text()).get("packages") or {}).items():
        folder = DEPLOYED_APP / key
        if not key or entry.get("dev") or entry.get("link") or not entry.get("version") or not folder.is_dir():
            continue
        name = entry.get("name") or key.rsplit("node_modules/", 1)[-1]
        found.setdefault((name, entry["version"]), Package(name, entry["version"], _licence(entry, folder)))
    return sorted(found.values())


def test_if_run_manifest():
    import json
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_third_party_notices():
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text().lower()
    missing = [p.name for p in every_shipped_package() if p.name.lower() not in notices]
    assert not missing, missing[:20]
    for font in ("plus jakarta sans", "dm sans"):
        assert font in notices


def test_if_open_licences():
    def licence(p):
        if p.licence:
            return p.licence
        folders = [d for root in (Path("/srv/app"), APP_ROOT) for d in (root / "node_modules" / p.name,
                   *root.glob(f"node_modules/**/node_modules/{p.name}")) if d.is_dir()]
        return next((t for t in map(licence_from_text, folders) if t), "")
    bad = [(p.name, licence(p)) for p in every_shipped_package()
           if not licence_allowed(licence(p), ALLOWED_LICENCES)]
    assert not bad, bad[:20]


def test_if_no_extra_datastore():
    banned = ("redis-server", "mongod", "memcached", "sqlite")
    for cmdline in Path("/proc").glob("[0-9]*/cmdline"):
        with_text = cmdline.read_bytes().replace(b"\0", b" ").decode(errors="ignore") if cmdline.exists() else ""
        assert not any(b in with_text.split(" ")[0] for b in banned if with_text), with_text[:80]
    found = [p for p in APP_ROOT.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not found, found[:5]


def test_if_services_untouched(mail):
    assert Postgres().tables()
    mail.messages(settle=0)
    S3().keys()


def test_if_lockfile_and_same_origin(app_url, browser):
    assert (APP_ROOT / "package-lock.json").exists()
    w = make_world(app_url)
    seen = []
    with window(browser, w, "mgr") as page:
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/today", "/ward", "/stock", f"/book/{w.slug}"):
            page.goto(w.base + path)
            expect(page.get_by_role("heading").first).to_be_visible(timeout=UI_MS)
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign[:5]
