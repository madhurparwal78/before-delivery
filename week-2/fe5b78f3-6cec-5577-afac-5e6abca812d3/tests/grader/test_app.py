import json
import os
import random
import re
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from playwright.sync_api import expect

import conftest
from conftest import (S3, accessible_name, addresses, advance, axe, held,
                      idempotency_key, layout, mail_from_address, open_app, same_origin, select,
                      tab_order, text, unique)
from conftest import check as kit_check, click as kit_click, fill as kit_fill, tap as kit_tap


def centred(locator):
    locator.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})")
    return locator


def toggled(locator):
    if locator.evaluate("e => ['radio', 'checkbox'].includes(e.getAttribute('role') || (e.tagName === 'INPUT' ? e.type : ''))"):
        locator.focus()
        locator.page.keyboard.press("Space")
        return True
    return False


def click(locator):
    if not toggled(locator):
        kit_click(centred(locator))


def tap(locator):
    if not toggled(locator):
        kit_tap(centred(locator))


def check(locator):
    if not locator.is_checked() and not toggled(locator):
        kit_check(centred(locator))
    expect(locator).to_be_checked()


def fill(locator, value):
    kit_fill(centred(locator), value)

DEPLOYED = getattr(conftest, "DEPLOYED_APP", "/app")
HTTP_S = 30
UI_S = 30
EXIT_S = 2
SLACK_S = 30
POLL_S = 0.5
STEP_MS = 30
FAST_LEAD = timedelta(hours=3)
EDGE_LEAD = timedelta(hours=1)
BAND_EDGE = timedelta(hours=48)
FAKE_DEVICE_TIME = "2031-06-15T23:30:00Z"
PASSWORD = "chart-paper-01"
PHONE = "+919800000001"
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
MOBILE = {"width": 375, "height": 812}
GN_BERTHS = 42
RAC_PLACES = 12
SS_BERTHS = {1, 4, 9, 12, 17, 20}
LD_BERTHS = set(range(41, 47))
TQ_BERTHS = set(range(61, 73))
WL_CAP_SL = 12
RATE = {"SL": 45, "3A": 120}
ROUND_TO = 500
RESERVATION = {"SL": 2000, "3A": 4000}
TATKAL = {"SL": 15000, "3A": 40000}
GST_PCT = 5
KESAR_SL, KESAR_3A, KESAR_KM = 64500, 179025, 1384
FLAT = {"SL": 12000, "3A": 18000}
CLERKAGE = 6000
CLERKAGE_3A_DEDUCTION = 6300
QUARTER = {"charge_paise": 44756, "gst_paise": 2238, "deduction_paise": 46994, "refund_paise": 132031}
QUARTER_TOTAL = 792186
QUARTER_WINDOW = (timedelta(hours=18), timedelta(hours=42))
RAC_CUTOFF = timedelta(minutes=30)
MAIL_S = 60
REFUND_RETRY_S = 30
CHART_JOB_S = 5
CLOCK_REFRESH_S = 5
POLL_MS = 20000
FARE_MS = 500
COUNT_MIN_MS, COUNT_MAX_MS = 240, 420
TAP_PX = 44
BODY_LIMIT = 65536
RATE_MIN, RATE_MAX = 1, 3600
ADULT, SENIOR, CHILD = 30, 60, 3
OUTAGES = ["APP_KILLBILL_DOWN_URL", "APP_MAILPIT_DOWN_URL", "APP_MINIO_DOWN_URL", "APP_FAST_CLOCK_URL"]
EVIL = "https://evil.example"
EVIL_HOST = "evil.example"
GHOST_PNR = "1234567890"
POS = {"LB": "lower", "MB": "middle", "UB": "upper", "SL": "side lower", "SU": "side upper"}
GENDER = {"M": "Male", "F": "Female", "T": "Transgender"}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SEED = {
    "12951": ("Kesar Night Mail", [("MMCT", "Mumbai Central", 0), ("ST", "Surat", 263), ("BRC", "Vadodara Jn", 392), ("NDLS", "New Delhi", 1384)], 2),
    "12627": ("Kaveri Dawn Express", [("SBC", "KSR Bengaluru", 0), ("KPD", "Katpadi Jn", 229), ("MAS", "Chennai Central", 362)], 1),
    "17031": ("Godavari Link", [("HYB", "Hyderabad Deccan", 0), ("VSKP", "Visakhapatnam", 701)], 1),
    "22477": ("Thar Afternoon Express", [("JP", "Jaipur Jn", 0), ("JU", "Jodhpur Jn", 326)], 1),
    "14231": ("Doab Express", [("LKO", "Lucknow", 0), ("BSB", "Varanasi Jn", 301)], 1),
    "11025": ("Kumbhar Link", [("PUNE", "Pune Jn", 0), ("NGP", "Nagpur Jn", 890)], 1),
    "12489": ("Hooghly Midnight Express", [("HWH", "Howrah Jn", 0), ("PNBE", "Patna Jn", 532)], 2),
    "16341": ("Malabar Morning Express", [("ERS", "Ernakulam Jn", 0), ("MAQ", "Mangaluru Central", 414)], 1),
}
ONE_COACH = ["12627", "17031", "22477", "14231", "11025", "16341"]
STATION_ORDER = ["MMCT", "ST", "BRC", "RTM", "KOTA", "NDLS", "SBC", "BWT", "KPD", "MAS", "HYB", "KZJ", "BZA", "RJY",
                 "VSKP", "JP", "AII", "MJ", "JU", "LKO", "RBL", "PBH", "BSB", "PUNE", "DD", "MMR", "BSL", "NGP",
                 "HWH", "BWN", "ASN", "JAJ", "PNBE", "ERS", "TCR", "SRR", "CLT", "MAQ"]
_PAUSE = threading.Event()


def eventually(fn, seconds, what):
    end, last = time.monotonic() + seconds, None
    while True:
        try:
            value = fn()
            if value:
                return value
        except (AssertionError, httpx.HTTPError, KeyError) as error:
            last = error
        if time.monotonic() > end:
            raise AssertionError(f"{what} not reached in {seconds}s: {last}")
        _PAUSE.wait(POLL_S)


def inr(p):
    rupees, ps = divmod(p, 100)
    s = str(rupees)
    if len(s) > 3:
        head, s = s[:-3], s[-3:]
        while head:
            s, head = head[-2:] + "," + s, head[:-2]
    return f"₹{s}.{ps:02d}"


def label_date(d):
    return f"{d.day:02d} {MON[d.month - 1].upper()} {d.year}"


def long_date(d):
    return f"{WD[d.weekday()]} {d.day} {MON[d.month - 1]} {d.year}"


def fare_parts(km, cls, quota="GN"):
    pre = -(-km * RATE[cls] // ROUND_TO) * ROUND_TO + RESERVATION[cls] + (TATKAL[cls] if quota == "TQ" else 0)
    return pre, (pre * GST_PCT // 100 if cls == "3A" else 0)


def fare(km, cls, quota="GN"):
    return sum(fare_parts(km, cls, quota))


def gn_label(avl, rac, tail):
    return f"AVL {avl} / RAC {rac} / {tail}"


def spoken(st):
    if st["status"] == "CNF":
        return f"CNF, {st['coach']} berth {st['berth']}, {POS[st['berth_type']]}"
    if st["status"] == "CAN":
        return "cancelled"
    if st["status"] == "CHART_NOT_CONFIRMED":
        return "not confirmed, refund pending"
    return f"{st['status']} {st['position']}"


def clock(base):
    r = httpx.get(base + "/api/clock", timeout=HTTP_S)
    assert r.status_code == 200, r.text
    return r.json()


def now(base):
    return datetime.fromisoformat(clock(base)["now"])


def wait_business(base, target):
    left = (target - now(base)).total_seconds() / clock(base)["rate"]
    eventually(lambda: now(base) >= target, max(left, 0) + SLACK_S, f"business clock at {target}")


def slot(train, run_date, cls, frm=None, to=None):
    stops = SEED[train][1]
    return {"train": train, "run_date": str(run_date), "from": frm or stops[0][0], "to": to or stops[-1][0], "class": cls}


def km(s):
    stops = {c: k for c, _, k in SEED[s["train"]][1]}
    return stops[s["to"]] - stops[s["from"]]


def name_of(s, key):
    return {c: n for c, n, _ in SEED[s["train"]][1]}[s[key]]


def coaches_of(s):
    return SEED[s["train"]][2] if s["class"] == "SL" else 1


def coach(s):
    return "S1" if s["class"] == "SL" else "B1"


def entry(base, s, quota="GN"):
    r = httpx.get(base + "/api/trains", params={"from": s["from"], "to": s["to"], "date": s["run_date"],
                                                 "quota": quota, "class": s["class"]}, timeout=HTTP_S)
    assert r.status_code == 200, r.text
    train = next(t for t in r.json()["trains"] if t["number"] == s["train"])
    return train, train["classes"][0]


def is_empty(e, s):
    n = coaches_of(s)
    return e["window"] == "open" and e["avl"] == GN_BERTHS * n and e["rac"] == RAC_PLACES * n and e["wl"] == 0


def fresh(base, cls="SL", trains=ONE_COACH):
    td = now(base).date()
    cands = [(t, td + timedelta(days=o)) for t in trains for o in range(3, 58)]
    random.shuffle(cands)
    for t, d in cands[:60]:
        s = slot(t, d, cls)
        if is_empty(entry(base, s)[1], s):
            return s
    pytest.fail("no empty run found")


def chart_soon(base, cls="SL"):
    n, best = now(base), None
    for t in ONE_COACH:
        for dd in range(3):
            s = slot(t, n.date() + timedelta(days=dd), cls)
            train, e = entry(base, s)
            at = datetime.fromisoformat(train["chart_at"])
            if at - n >= FAST_LEAD and is_empty(e, s) and (best is None or at < best[0]):
                best = (at, s, train)
    assert best, "no upcoming chart on an empty run"
    return best


def one(age=ADULT, gender="M", pref="NONE"):
    return {"name": f"Yatri {uuid.uuid4().hex[:8]}", "age": age, "gender": gender, "berth_preference": pref}


def pax(n, **kw):
    return [one(**kw) for _ in range(n)]


def traveller(base):
    first, email = unique("pakka")
    c = httpx.Client(base_url=base, timeout=HTTP_S)
    r = c.post("/api/accounts", json={"name": f"Pakka {first}"[:80], "email": email, "password": PASSWORD, "phone": PHONE})
    assert r.status_code == 201, r.text
    return SimpleNamespace(c=c, email=email, id=r.json()["id"], name=r.json()["name"])


def login(base, email):
    c = httpx.Client(base_url=base, timeout=HTTP_S)
    r = c.post("/api/session", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return c


def body(s, people, quota="GN", accept="WL", keep=False, lower=False, phone=PHONE):
    return {"train": s["train"], "run_date": s["run_date"], "from": s["from"], "to": s["to"], "class": s["class"],
            "quota": quota, "passengers": people, "keep_in_one_coach": keep, "lower_berth_only": lower,
            "accept": accept, "contact_phone": phone}


def book(c, s, people, key=None, **kw):
    return c.post("/api/bookings", json=body(s, people, **kw), headers={"Idempotency-Key": key or idempotency_key()})


def booked(c, s, people, **kw):
    r = book(c, s, people, **kw)
    assert r.status_code == 201, r.text
    return r.json()


def raw_post(c, path, raw, key):
    return c.post(path, content=raw, headers={"Content-Type": "application/json", "Idempotency-Key": key})


def cancel(c, pnr, nums, key=None):
    return c.post(f"/api/bookings/{pnr}/cancellations", json={"passengers": nums},
                  headers={"Idempotency-Key": key or idempotency_key()})


def quote(c, pnr, nums):
    r = c.post(f"/api/bookings/{pnr}/cancellation-quote", json={"passengers": nums})
    assert r.status_code == 200, r.text
    return r.json()


def get(c, pnr):
    r = c.get(f"/api/bookings/{pnr}")
    assert r.status_code == 200, r.text
    return r.json()


def labels(b):
    return [p["current_status"]["label"] for p in b["passengers"]]


def cur(b, n):
    return b["passengers"][n - 1]["current_status"]


def fill_run(c, base, s, gn_left=0, rac_left=None):
    made = []
    while True:
        e = entry(base, s)[1]
        if e["avl"] > gn_left:
            n = min(6, e["avl"] - gn_left)
        elif rac_left is not None and e["rac"] > rac_left:
            n = min(6, e["rac"] - rac_left)
        else:
            return made
        made.append(booked(c, s, pax(n)))


def problem(r, code, status=409):
    assert r.status_code == status, r.text
    j = r.json()
    assert j["error"] == code and isinstance(j["message"], str), j
    return j


def together(fns):
    gate = threading.Barrier(len(fns))

    def run(fn):
        gate.wait()
        return fn()
    with ThreadPoolExecutor(len(fns)) as pool:
        return list(pool.map(run, fns))


def kb(killbill, acct_id):
    account = killbill.account_by_key(f"pakka-{acct_id}")
    if not account:
        return None, []
    txns = [{**t, "paymentExternalKey": p.get("paymentExternalKey")}
            for p in killbill.payments(account["accountId"]) for t in (p.get("transactions") or [])]
    return account, txns


def paid(killbill, acct_id):
    return [t for t in kb(killbill, acct_id)[1] if t["transactionType"] == "PURCHASE" and t["status"] == "SUCCESS"]


def txn(killbill, pnr, ext):
    p = killbill.payment_by_key(pnr) or {}
    return next((t for t in p.get("transactions") or [] if t.get("transactionExternalKey") == ext), None)


def paise(t):
    return round(float(t["amount"]) * 100)


def net_charge_zero(killbill, acct_id):
    txns = [t for t in kb(killbill, acct_id)[1] if t["status"] == "SUCCESS"]
    got = sum(paise(t) for t in txns if t["transactionType"] == "PURCHASE")
    back = sum(paise(t) for t in txns if t["transactionType"] == "REFUND")
    return got == back


def mails(mail, subject, to):
    return [m for m in mail.messages() if m.get("Subject") == subject and to.lower() in [a.lower() for a in addresses(m.get("To"))]]


def await_mail(mail, subject, to, count=1, seconds=MAIL_S + SLACK_S):
    eventually(lambda: len(mails(mail, subject, to)) >= count, seconds, subject)
    found = mails(mail, subject, to)
    assert len(found) == count, (subject, len(found))
    return found


def book_path(s, quota="GN"):
    return (f"/book?train={s['train']}&run_date={s['run_date']}&from={s['from']}&to={s['to']}"
            f"&class={s['class']}&quota={quota}")


def results_path(s, quota="GN"):
    return f"/trains?from={s['from']}&to={s['to']}&date={s['run_date']}&quota={quota}&class={s['class']}"


@contextmanager
def ui(browser, base, path, email=None, size=DESKTOP, reduced="no-preference"):
    with open_app(browser, base + "/pnr", reduced_motion=reduced) as page:
        page.set_viewport_size(size)
        if email:
            r = page.request.post(base + "/api/session", data={"email": email, "password": PASSWORD})
            assert r.status == 200, r.text()
        page.goto(base + path)
        yield page


def wait_ui(page, check_fn, seconds=UI_S):
    end = time.monotonic() + seconds
    while True:
        try:
            check_fn()
            return
        except AssertionError:
            if time.monotonic() > end:
                raise
            advance(page, 250)


def shows(page, loc, seconds=UI_S):
    wait_ui(page, lambda: expect(loc).to_be_visible(timeout=300), seconds)


def reads(page, loc, value, seconds=UI_S):
    wait_ui(page, lambda: expect(loc).to_have_text(value, timeout=300), seconds)


def holds(page, loc, value, seconds=UI_S):
    wait_ui(page, lambda: expect(loc).to_contain_text(value, timeout=300), seconds)


def role(page, r, name, **kw):
    return page.get_by_role(r, name=name, exact=True, **kw)


def passenger_item(page, n, hidden=False):
    return page.get_by_role("list", name="Passengers", include_hidden=hidden).get_by_role(
        "listitem", include_hidden=hidden).filter(has_text=re.compile(rf"Passenger {n}\b"))


def enter_party(page, people, phone=PHONE):
    for i, p in enumerate(people, 1):
        group = role(page, "group", f"Passenger {i}")
        if group.count() == 0:
            click(role(page, "button", "Add passenger"))
            shows(page, group)
        fill(group.get_by_role("textbox", name="Name"), p["name"])
        fill(group.get_by_role("spinbutton", name="Age"), str(p["age"]))
        select(group.get_by_role("combobox", name="Gender"), GENDER[p["gender"]])
    fill(role(page, "textbox", "Mobile number"), phone)


def pay(page, total):
    review = role(page, "button", "Review and pay")
    wait_ui(page, lambda: expect(review).to_be_enabled(timeout=300))
    click(review)
    dialog = role(page, "dialog", "Confirm and pay")
    shows(page, dialog)
    button = dialog.get_by_role("button", name=f"Pay {inr(total)}")
    shows(page, button)
    click(button)


def landed_pnr(page):
    wait_ui(page, lambda: expect(page).to_have_url(re.compile(r"/bookings/\d{10}$"), timeout=300))
    pnr = re.search(r"/bookings/(\d{10})", page.url).group(1)
    shows(page, page.get_by_role("heading", name=f"PNR {pnr}", level=1))
    return pnr


def poll(page, pnr):
    with page.expect_response(lambda r: r.url.endswith(f"/api/bookings/{pnr}") and r.request.method == "GET",
                              timeout=UI_S * 1000):
        advance(page, POLL_MS + 1000)


def chip_shape(item, label):
    return item.evaluate("""(root, label) => {
      const all = [...root.querySelectorAll('*')].filter(e => e.textContent.trim() === label);
      const out = {dashed: false, filled: false};
      for (let e = all[all.length - 1]; e && e !== root.parentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        if ([s.borderTopStyle, s.borderLeftStyle].includes('dashed')) out.dashed = true;
        if (e !== root && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') out.filled = true;
      }
      return out; }""", label)


def card_of(page, s):
    return role(page, "list", "Trains").get_by_role("listitem").filter(
        has=page.get_by_role("heading", name=f"{s['train']} {SEED[s['train']][0]}"))


def queued(base):
    s = fresh(base)
    f = traveller(base)
    made = fill_run(f.c, base, s, 0, 0)
    return SimpleNamespace(s=s, f=f, cnf=[b for b in made if cur(b, 1)["status"] == "CNF"],
                           rac=[b for b in made if cur(b, 1)["status"] == "RAC"])


def waitlisted(base, sc, ahead=3, size=1):
    q, w = traveller(base), traveller(base)
    qb = booked(q.c, sc.s, pax(ahead)) if ahead else None
    pnr = booked(w.c, sc.s, pax(size))["pnr"]
    return q, qb, w, pnr


def statuses(c, pnr):
    return [p["current_status"] for p in get(c, pnr)["passengers"]]


def update_lines(before, after):
    return [f"Passenger {i}: {spoken(x)} to {spoken(y)}"
            for i, (x, y) in enumerate(zip(before, after), 1) if x["label"] != y["label"]]


def announced(page, lines):
    pattern = re.compile(r"^\s*" + r"\s*".join(re.escape(x) for x in lines) + r"\s*$")
    wait_ui(page, lambda: expect(role(page, "status", "PNR updates")).to_have_text(pattern, timeout=300))


def charted(fast):
    at, s, train = chart_soon(fast)
    f = traveller(fast)
    cnf = fill_run(f.c, fast, s, 0)
    fill_run(f.c, fast, s, 0, 0)
    x = traveller(fast)
    xb = booked(x.c, s, [one(age=SENIOR + 5, gender="F"), one()])
    assert cur(xb, 1)["status"] == "CNF" and cur(xb, 1)["berth"] in SS_BERTHS and labels(xb)[1] == "GNWL 1", labels(xb)
    return SimpleNamespace(at=at, s=s, train=train, f=f, cnf=cnf, x=x, xb=xb, pnr=xb["pnr"], each=fare(km(s), "SL"))


def test_health():
    for base in [os.environ.get("APP_URL")] + [os.environ[v] for v in OUTAGES]:
        if not base:
            continue
        r = httpx.get(base + "/api/health", timeout=HTTP_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, (base, r.text)


def test_health_primary(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}


BOUNDARY_CASES = ["cross_origin", "too_large", "at_limit", "media_type", "idempotency_header", "never_served"]


def padded(size):
    payload = {"email": "nobody@example.test", "password": "wrong-password", "pad": ""}
    payload["pad"] = "a" * (size - len(json.dumps(payload).encode()))
    raw = json.dumps(payload).encode()
    assert len(raw) == size
    return raw


@pytest.mark.parametrize("case", BOUNDARY_CASES, ids=BOUNDARY_CASES)
def test_server_boundary(app_url, case):
    anon = httpx.Client(base_url=app_url, timeout=HTTP_S)
    json_h = {"Content-Type": "application/json"}
    if case == "cross_origin":
        t = traveller(app_url)
        s = slot("16341", now(app_url).date() + timedelta(days=5), "SL")
        r = t.c.post("/api/bookings", json=body(s, pax(1)), headers={"Idempotency-Key": idempotency_key(), "Origin": EVIL})
        problem(r, "cross_origin", 403)
        assert t.c.get("/api/bookings").json()["bookings"] == []
    elif case == "too_large":
        problem(anon.post("/api/session", content=padded(BODY_LIMIT + 1), headers=json_h), "too_large", 413)
    elif case == "at_limit":
        problem(anon.post("/api/session", content=padded(BODY_LIMIT), headers=json_h), "invalid_credentials", 401)
    elif case == "media_type":
        r = anon.post("/api/session", content=b"email=a", headers={"Content-Type": "text/plain"})
        problem(r, "unsupported_media_type", 415)
    elif case == "idempotency_header":
        t = traveller(app_url)
        s = slot("16341", now(app_url).date() + timedelta(days=5), "SL")
        problem(t.c.post("/api/bookings", json=body(s, pax(1))), "idempotency_key_required", 400)
        problem(t.c.post(f"/api/bookings/{GHOST_PNR}/cancellations", json={"passengers": [1]}), "idempotency_key_required", 400)
        assert t.c.get("/api/bookings").json()["bookings"] == []
    else:
        for path in ["/run.json", "/package.json", "/.env", "/.git/config"]:
            assert anon.get(path).status_code == 404, path


def test_error_precedence(app_url, killbill):
    anon = httpx.Client(base_url=app_url, timeout=HTTP_S)
    td = now(app_url).date()
    s = slot("16341", td + timedelta(days=5), "SL")
    good = json.dumps(body(s, pax(1))).encode()
    key = {"Idempotency-Key": idempotency_key()}
    problem(anon.post("/api/session", content=b"x" * (BODY_LIMIT + 1), headers={"Content-Type": "text/plain"}), "too_large", 413)
    problem(anon.post("/api/session", content=b"{", headers={"Content-Type": "text/plain"}), "unsupported_media_type", 415)
    problem(anon.post("/api/session", content=b"{", headers={"Content-Type": "application/json"}), "bad_json", 400)
    problem(anon.post("/api/bookings", content=good, headers={"Content-Type": "application/json", "Origin": EVIL}), "idempotency_key_required", 400)
    problem(anon.post("/api/bookings", content=good, headers={"Content-Type": "application/json", "Origin": EVIL, **key}), "cross_origin", 403)
    problem(anon.post("/api/bookings", content=good, headers={"Content-Type": "application/json", **key}), "unauthenticated", 401)
    t = traveller(app_url)
    unknown = {**body(s, []), "train": "99999", "quota": "XX", "run_date": str(td + timedelta(days=61))}
    problem(t.c.post("/api/bookings", json=unknown, headers={"Idempotency-Key": idempotency_key()}), "not_found", 404)
    closed = body(slot("16341", td + timedelta(days=61), "SL"), [])
    problem(t.c.post("/api/bookings", json=closed, headers={"Idempotency-Key": idempotency_key()}), "booking_not_open")
    j = problem(book(t.c, s, []), "validation", 422)
    assert j["message"] == "Check these fields"
    assert j["errors"]["passengers"] == "Add at least one passenger aged 5 or over"
    assert paid(killbill, t.id) == []


def test_clock(app_url):
    j = clock(app_url)
    assert j["zone"] == "Asia/Kolkata" and isinstance(j["rate"], int)
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+05:30", j["now"]), j
    fast = os.environ["APP_FAST_CLOCK_URL"]
    t0 = time.monotonic()
    a = clock(fast)
    t1 = time.monotonic()
    _PAUSE.wait(2)
    t2 = time.monotonic()
    b = clock(fast)
    t3 = time.monotonic()
    rate = a["rate"]
    assert isinstance(rate, int) and RATE_MIN < rate <= RATE_MAX and a["zone"] == "Asia/Kolkata", a
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+05:30", a["now"]), a
    delta = (datetime.fromisoformat(b["now"]) - datetime.fromisoformat(a["now"])).total_seconds()
    assert rate * (t2 - t1) - 2 <= delta <= rate * (t3 - t0) + 2, delta


def test_accounts_and_sessions(app_url):
    anon = httpx.Client(base_url=app_url, timeout=HTTP_S)
    t = traveller(app_url)
    me = t.c.get("/api/me").json()
    assert me["email"] == t.email and me["phone"] == PHONE and uuid.UUID(t.id)
    problem(anon.post("/api/accounts", json={"name": "Other", "email": t.email, "password": PASSWORD, "phone": PHONE}), "email_taken")
    j = problem(anon.post("/api/accounts", json={"name": "", "email": "bad", "password": "short", "phone": "+915000000000"}), "validation", 422)
    assert j["errors"] == {"name": "Enter a name", "email": "Enter a valid email", "password": "Use at least 10 characters",
                           "phone": "Enter +91 and a 10-digit mobile number"}
    _, email = unique("pakka")
    j = problem(anon.post("/api/accounts", json={"name": "x" * 81, "email": email, "password": PASSWORD, "phone": PHONE}), "validation", 422)
    assert j["errors"]["name"] == "Enter a name"
    assert t.c.delete("/api/session").status_code == 204
    problem(t.c.get("/api/me"), "unauthenticated", 401)
    problem(anon.post("/api/session", json={"email": t.email, "password": "wrong-password"}), "invalid_credentials", 401)
    assert login(app_url, t.email).get("/api/me").json()["id"] == t.id
    meera = httpx.post(app_url + "/api/session", json={"email": "meera.iyer@example.test", "password": PASSWORD}, timeout=HTTP_S)
    assert meera.status_code == 200 and meera.json()["name"] == "Meera Iyer"


def test_other_account_is_not_found(app_url, browser, killbill):
    owner, other = traveller(app_url), traveller(app_url)
    s = slot(random.choice(ONE_COACH), now(app_url).date() + timedelta(days=random.randint(3, 57)), "SL")
    pnr = booked(owner.c, s, pax(2))["pnr"]
    ghost = "1" + "".join(random.choice("0123456789") for _ in range(9))
    for p in (pnr, ghost):
        problem(other.c.get(f"/api/bookings/{p}"), "not_found", 404)
        problem(other.c.get(f"/api/bookings/{p}/tickets/1"), "not_found", 404)
        problem(other.c.post(f"/api/bookings/{p}/cancellation-quote", json={"passengers": [1]}), "not_found", 404)
        problem(cancel(other.c, p, [1]), "not_found", 404)
        problem(cancel(other.c, p, []), "not_found", 404)
    assert pnr not in json.dumps(other.c.get("/api/bookings").json())
    b = get(owner.c, pnr)
    assert b["cancellations"] == [] and b["version"] == 1 and all(l.startswith("CNF") for l in labels(b))
    assert not [t for t in kb(killbill, owner.id)[1] if t["transactionType"] == "REFUND"]
    with ui(browser, app_url, f"/bookings/{pnr}", other.email) as page:
        shows(page, page.get_by_role("heading", name="Booking not found"))
        assert page.get_by_role("heading", name=f"PNR {pnr}").count() == 0


def test_search(app_url):
    st = httpx.get(app_url + "/api/stations", timeout=HTTP_S).json()["stations"]
    assert [x["code"] for x in st] == STATION_ORDER and st[0] == {"code": "MMCT", "name": "Mumbai Central"}
    d = now(app_url).date() + timedelta(days=10)
    n1 = d + timedelta(days=1)
    train, e = entry(app_url, slot("12951", d, "SL"))
    assert train["name"] == "Kesar Night Mail" and train["run_date"] == str(d)
    assert train["from"]["departure_at"] == f"{d}T17:10:00+05:30" and train["to"]["arrival_at"] == f"{n1}T08:35:00+05:30"
    assert train["chart_at"] == f"{d}T07:10:00+05:30" and train["chart_prepared"] is False
    assert [x["code"] for x in train["stops"]][:3] == ["MMCT", "ST", "BRC"]
    assert len(train["classes"]) == 1 and e["class"] == "SL" and e["quota"] == "GN" and e["window"] == "open"
    assert e["wl_type"] == "GNWL" and e["adult_fare_paise"] == KESAR_SL
    assert re.fullmatch(r"AVL \d+ / RAC \d+ / (GNWL \d+|REGRET)", e["label"]), e["label"]
    q = lambda **p: httpx.get(app_url + "/api/trains", params=p, timeout=HTTP_S)
    both = q(**{"from": "MMCT", "to": "NDLS", "date": str(d)}).json()["trains"]
    assert {c["class"] for c in next(t for t in both if t["number"] == "12951")["classes"]} == {"SL", "3A"}
    late = q(**{"from": "RTM", "to": "NDLS", "date": str(n1), "class": "SL"}).json()["trains"]
    assert next(t for t in late if t["number"] == "12951")["run_date"] == str(d)
    assert entry(app_url, slot("12951", d, "SL", "BRC"))[1]["wl_type"] == "RLWL"
    assert entry(app_url, slot("12951", d, "SL", "ST"))[1]["wl_type"] == "PQWL"
    assert all(t["number"] != "12951" for t in q(**{"from": "NDLS", "to": "MMCT", "date": str(d)}).json()["trains"])
    j = problem(q(**{"from": "MMCT", "to": "MMCT", "date": str(d)}), "validation", 422)
    assert j["errors"]["to"] == "Choose a different station from From"
    j = problem(q(**{"from": "MMCT", "to": "NDLS", "date": "2026-13-40"}), "validation", 422)
    assert j["errors"]["date"] == "Enter a date as YYYY-MM-DD"
    problem(q(**{"from": "ZZZZ", "to": "NDLS", "date": str(d)}), "not_found", 404)


def test_availability_counts(app_url):
    s = fresh(app_url)
    t = traveller(app_url)
    b = booked(t.c, s, pax(3) + [one(age=CHILD)])
    e = entry(app_url, s)[1]
    assert (e["avl"], e["rac"], e["wl"]) == (GN_BERTHS - 3, RAC_PLACES, 0)
    held_berths = lambda: sum(1 for c in httpx.get(
        f"{app_url}/api/trains/{s['train']}/runs/{s['run_date']}/coaches",
        params={"class": "SL", "from": s["from"], "to": s["to"]}, timeout=HTTP_S).json()["coaches"]
        for x in c["berths"] if x["quota"] == "GN" and x["state"] == "taken")
    assert held_berths() == 3
    assert cancel(t.c, b["pnr"], [2]).status_code == 201
    e = entry(app_url, s)[1]
    assert e["avl"] == GN_BERTHS - 2 and held_berths() == 2
    assert e["label"] == f"AVL {GN_BERTHS - 2} / RAC {RAC_PLACES} / GNWL 0"


PARTY_CASES = {
    "no_adult": ("GN", [(3, "F")], "passengers", "Add at least one passenger aged 5 or over"),
    "seven_adults": ("GN", [(30, "M")] * 7, "passengers", "Up to 6 passengers aged 5 or over"),
    "three_children": ("GN", [(30, "M"), (1, "F"), (2, "M"), (3, "F")], "passengers", "Up to 2 children under five"),
    "tatkal_five": ("TQ", [(30, "M")] * 5, "passengers", "Up to 4 passengers aged 5 or over on a Tatkal ticket"),
    "senior_three": ("SS", [(60, "M")] * 3, "passengers", "Up to 2 passengers on a Senior quota ticket"),
    "ladies_male": ("LD", [(30, "F"), (30, "M")], "passengers[1].gender", "Ladies quota is for women travellers"),
    "senior_young": ("SS", [(59, "M")], "passengers[0].age", "Senior quota is for passengers aged 60 or over, or women aged 45 or over"),
    "age_range": ("GN", [(126, "M")], "passengers[0].age", "Enter an age from 0 to 125"),
    "full_party": ("GN", [(30, "M")] * 6 + [(0, "F"), (4, "M")], None, None),
    "senior_woman": ("SS", [(45, "F")], None, None),
}


def tatkal_open(base, cls):
    td = now(base).date()
    for t in random.sample(ONE_COACH, len(ONE_COACH)):
        for dd in range(3):
            s = slot(t, td + timedelta(days=dd), cls)
            e = entry(base, s, "TQ")[1]
            if e["window"] == "open" and e["avl"] >= 4:
                return s
    pytest.fail("no open Tatkal run")


PARTY_IDS = ["no_adult", "seven_adults", "three_children", "tatkal_five", "senior_three", "ladies_male",
             "senior_young", "age_range", "full_party", "senior_woman"]


@pytest.mark.parametrize("case", PARTY_IDS, ids=PARTY_IDS)
def test_party_rules(app_url, killbill, case):
    quota, spec, field, message = PARTY_CASES[case]
    s = tatkal_open(app_url, "SL") if quota == "TQ" else fresh(app_url)
    t = traveller(app_url)
    r = book(t.c, s, [one(age=a, gender=g) for a, g in spec], quota=quota)
    if field is None:
        assert r.status_code == 201, r.text
        assert len(paid(killbill, t.id)) == 1
        return
    j = problem(r, "validation", 422)
    assert j["errors"][field] == message, j
    assert t.c.get("/api/bookings").json()["bookings"] == [] and paid(killbill, t.id) == []


FARE_CASES = {
    "sl_general": ("12951", "SL", "GN", [30]),
    "ac3_general": ("12951", "3A", "GN", [30, 40]),
    "sl_tatkal": ("12627", "SL", "TQ", [30]),
    "ac3_tatkal": ("12627", "3A", "TQ", [30]),
    "children": ("12627", "3A", "GN", [30, 2]),
}


@pytest.mark.parametrize("case", list(FARE_CASES), ids=list(FARE_CASES))
def test_fare_quote(app_url, case):
    train, cls, quota, ages = FARE_CASES[case]
    assert fare(KESAR_KM, "SL") == KESAR_SL and fare(KESAR_KM, "3A") == KESAR_3A
    s = slot(train, now(app_url).date() + timedelta(days=10), cls)
    r = httpx.post(app_url + "/api/fare-quote", json={"train": train, "run_date": s["run_date"], "from": s["from"],
                   "to": s["to"], "class": cls, "quota": quota, "passengers": [{"age": a} for a in ages]}, timeout=HTTP_S)
    assert r.status_code == 200, r.text
    pre, gst = fare_parts(km(s), cls, quota)
    want = [(f"Passenger {i} fare", pre) if a >= 5 else (f"Passenger {i} — under five, no berth", 0)
            for i, a in enumerate(ages, 1)]
    if cls == "3A":
        want.append(("GST 5%", gst * sum(1 for a in ages if a >= 5)))
    j = r.json()
    assert [(l["label"], l["amount_paise"]) for l in j["lines"]] == want
    assert j["total_paise"] == sum(a for _, a in want)


def test_allotment_order(app_url):
    s = fresh(app_url)
    t = traveller(app_url)
    b = booked(t.c, s, [one(pref="LB"), one(pref="UB"), one(pref="SU"), one()])
    assert labels(b) == ["CNF S1 25 LB", "CNF S1 3 UB", "CNF S1 8 SU", "CNF S1 2 MB"]
    assert [p["booking_status"]["label"] for p in b["passengers"]] == labels(b)
    fill_run(t.c, app_url, s, 1)
    mixed = labels(booked(t.c, s, pax(3)))
    assert mixed[0].startswith("CNF S1") and mixed[1:] == ["RAC 1 S1 7 SL", "RAC 2 S1 7 SL"], mixed
    fill_run(t.c, app_url, s, 0, 0)
    assert labels(booked(t.c, s, pax(1))) == ["GNWL 1"]
    assert entry(app_url, s)[1]["label"] == gn_label(0, 0, "GNWL 1")


def test_waitlist_cap(app_url, killbill):
    s = fresh(app_url)
    t = traveller(app_url)
    fill_run(t.c, app_url, s, 0, 0)
    booked(t.c, s, pax(6))
    booked(t.c, s, pax(5))
    assert entry(app_url, s)[1]["label"] == gn_label(0, 0, f"GNWL {WL_CAP_SL - 1}")
    j = problem(book(t.c, s, pax(2)), "waitlist_full")
    assert j["charged"] is False
    assert entry(app_url, s)[1]["wl"] == WL_CAP_SL - 1
    assert labels(booked(t.c, s, pax(1) + [one(age=CHILD)]))[0] == f"GNWL {WL_CAP_SL}"
    e = entry(app_url, s)[1]
    assert e["wl"] == WL_CAP_SL and e["wl_cap"] == WL_CAP_SL and e["label"] == gn_label(0, 0, "REGRET")
    problem(book(t.c, s, pax(1)), "waitlist_full")
    assert len(paid(killbill, t.id)) == len(t.c.get("/api/bookings").json()["bookings"])


def test_senior_lower_berths(app_url):
    s = fresh(app_url)
    t = traveller(app_url)
    b = booked(t.c, s, [one(), one(age=SENIOR + 5, gender="F"), one(age=45, gender="F"), one(age=SENIOR - 1)])
    assert labels(b) == ["CNF S1 2 MB", "CNF S1 1 LB", "CNF S1 4 LB", "CNF S1 3 UB"]


def test_lower_berth_only(app_url, killbill):
    s = fresh(app_url)
    t = traveller(app_url)
    assert problem(book(t.c, s, [one(pref="UB"), one(pref="MB")], lower=True), "no_lower_berth")["charged"] is False
    assert t.c.get("/api/bookings").json()["bookings"] == [] and paid(killbill, t.id) == []
    assert is_empty(entry(app_url, s)[1], s)
    assert labels(booked(t.c, s, [one(pref="UB"), one(pref="LB")], lower=True)) == ["CNF S1 3 UB", "CNF S1 25 LB"]
    assert len(paid(killbill, t.id)) == 1


def test_ladies_and_senior_quotas(app_url, killbill):
    s = fresh(app_url)
    t = traveller(app_url)
    b = booked(t.c, s, pax(6, gender="F"), quota="LD")
    assert {p["current_status"]["berth"] for p in b["passengers"]} == LD_BERTHS
    assert entry(app_url, s, "LD")[1]["label"] == "NOT AVAILABLE"
    assert problem(book(t.c, s, pax(1, gender="F"), quota="LD"), "quota_full")["charged"] is False
    assert labels(booked(t.c, s, pax(2, age=SENIOR), quota="SS")) == ["CNF S1 1 LB", "CNF S1 4 LB"]
    assert entry(app_url, s, "SS")[1]["label"] == f"AVL {len(SS_BERTHS) - 2}"
    assert len(paid(killbill, t.id)) == 2


def test_payment_recorded(app_url, killbill):
    t = traveller(app_url)
    s = fresh(app_url)
    b = booked(t.c, s, pax(2))
    account = killbill.account_by_key(f"pakka-{t.id}")
    assert account and account["currency"] == "INR" and account["name"] == t.name
    p = killbill.payment_by_key(b["pnr"])
    assert p and p["accountId"] == account["accountId"]
    purchase = txn(killbill, b["pnr"], f"{b['pnr']}-fare")
    assert purchase["transactionType"] == "PURCHASE" and purchase["status"] == "SUCCESS"
    assert paise(purchase) == b["total_paise"] == 2 * fare(km(s), "SL")


def test_all_or_nothing(app_url, killbill, mail):
    t = traveller(app_url)
    s = fresh(app_url)
    pnr = booked(t.c, s, pax(1))["pnr"]
    assert txn(killbill, pnr, f"{pnr}-fare")["status"] == "SUCCESS"
    assert S3().get(f"tickets/{pnr}/v1-booked.pdf")[:4] == b"%PDF"
    m = await_mail(mail, f"E-ticket for PNR {pnr}", t.email)[0]
    assert addresses(m.get("From")) == [mail_from_address()] and "CNF S1" in text(m)
    down = login(os.environ["APP_MINIO_DOWN_URL"], t.email)
    avl = entry(app_url, s)[1]["avl"]
    assert book(down, s, pax(1)).status_code != 201
    assert [x["pnr"] for x in t.c.get("/api/bookings").json()["bookings"]] == [pnr]
    assert entry(app_url, s)[1]["avl"] == avl
    others = [x for x in kb(killbill, t.id)[1] if x["paymentExternalKey"] != pnr]
    sums = {k: sum(paise(x) for x in others if x["transactionType"] == k and x["status"] == "SUCCESS") for k in ("PURCHASE", "REFUND")}
    assert sums["PURCHASE"] == sums["REFUND"], others
    for x in others:
        if x["transactionType"] == "REFUND":
            assert x["transactionExternalKey"] == f"{x['paymentExternalKey']}-void", x


def test_ticket_storage_outage(app_url, killbill):
    t = traveller(app_url)
    s = fresh(app_url)
    down = login(os.environ["APP_MINIO_DOWN_URL"], t.email)
    problem(book(down, s, pax(2)), "ticket_storage_unavailable", 503)
    assert t.c.get("/api/bookings").json()["bookings"] == []
    assert is_empty(entry(app_url, s)[1], s)
    assert net_charge_zero(killbill, t.id)


def test_mail_outage(app_url, mail):
    t = traveller(app_url)
    down = login(os.environ["APP_MAILPIT_DOWN_URL"], t.email)
    b = booked(down, fresh(app_url), pax(1))
    assert get(t.c, b["pnr"])["state"] == "booked"
    await_mail(mail, f"E-ticket for PNR {b['pnr']}", t.email, seconds=MAIL_S * 2 + SLACK_S)


def test_booking_replay(app_url, killbill):
    t = traveller(app_url)
    s = fresh(app_url)
    raw = json.dumps(body(s, pax(3))).encode()
    key = idempotency_key()
    first = raw_post(t.c, "/api/bookings", raw, key)
    assert first.status_code == 201
    again = raw_post(t.c, "/api/bookings", raw, key)
    assert again.status_code == 201 and again.json() == first.json() and again.headers.get("Idempotent-Replay") == "true"
    problem(book(t.c, s, pax(3), key=key), "idempotency_conflict")
    pnr = first.json()["pnr"]
    assert len(paid(killbill, t.id)) == 1 and len(t.c.get("/api/bookings").json()["bookings"]) == 1
    bad = json.dumps(body(s, [])).encode()
    k2 = idempotency_key()
    problem(raw_post(t.c, "/api/bookings", bad, k2), "validation", 422)
    problem(raw_post(t.c, "/api/bookings", bad, k2), "validation", 422)
    assert raw_post(t.c, "/api/bookings", raw.replace(b'"accept": "WL"', b'"accept": "RAC"'), k2).status_code == 201
    k3 = idempotency_key()
    c1 = cancel(t.c, pnr, [1], k3)
    assert c1.status_code == 201
    assert cancel(t.c, pnr, [2]).status_code == 201
    c2 = cancel(t.c, pnr, [1], k3)
    assert c2.status_code == 201 and c2.json() == c1.json() and c2.headers.get("Idempotent-Replay") == "true"
    problem(cancel(t.c, pnr, [3], k3), "idempotency_conflict")
    assert len(get(t.c, pnr)["cancellations"]) == 2


def test_concurrent_replays(app_url, killbill):
    t = traveller(app_url)
    raw = json.dumps(body(fresh(app_url), pax(2))).encode()
    key = idempotency_key()
    rs = together([lambda: raw_post(t.c, "/api/bookings", raw, key)] * 5)
    assert all(r.status_code == 201 for r in rs), [r.text for r in rs]
    assert len({r.json()["pnr"] for r in rs}) == 1
    assert sum(r.headers.get("Idempotent-Replay") == "true" for r in rs) == 4
    pnr = rs[0].json()["pnr"]
    assert len(paid(killbill, t.id)) == 1
    ckey = idempotency_key()
    cs = together([lambda: raw_post(t.c, f"/api/bookings/{pnr}/cancellations", b'{"passengers":[1]}', ckey)] * 5)
    assert all(r.status_code == 201 for r in cs), [r.text for r in cs]
    assert sum(r.headers.get("Idempotent-Replay") == "true" for r in cs) == 4
    assert len(get(t.c, pnr)["cancellations"]) == 1
    refunds = eventually(lambda: [x for x in kb(killbill, t.id)[1] if x["transactionType"] == "REFUND"], MAIL_S, "refund")
    assert [x["transactionExternalKey"] for x in refunds] == [f"{pnr}-refund-1"]


def test_two_accounts_same_key(app_url, killbill):
    a, b = traveller(app_url), traveller(app_url)
    s = fresh(app_url)
    for _ in range(3):
        raw = json.dumps(body(s, pax(1))).encode()
        key = idempotency_key()
        ra, rb = together([lambda: raw_post(a.c, "/api/bookings", raw, key), lambda: raw_post(b.c, "/api/bookings", raw, key)])
        assert ra.status_code == rb.status_code == 201, (ra.text, rb.text)
        assert "Idempotent-Replay" not in ra.headers and "Idempotent-Replay" not in rb.headers
        pa, pb = ra.json()["pnr"], rb.json()["pnr"]
        assert pa != pb
        problem(a.c.get(f"/api/bookings/{pb}"), "not_found", 404)
        problem(b.c.get(f"/api/bookings/{pa}"), "not_found", 404)
    for t in (a, b):
        mine = {x["pnr"] for x in t.c.get("/api/bookings").json()["bookings"]}
        assert {x["paymentExternalKey"] for x in paid(killbill, t.id)} == mine and len(mine) == 3


def test_last_berth_race(app_url, killbill):
    s = fresh(app_url, trains=["12627"])
    f = traveller(app_url)
    fill_run(f.c, app_url, s, 1)
    legs = [slot("12627", s["run_date"], "SL", "SBC", "KPD"), slot("12627", s["run_date"], "SL", "KPD", "MAS"), s]
    people = [traveller(app_url) for _ in legs]
    rs = together([lambda p=p, l=l: book(p.c, l, pax(1), accept="CNF") for p, l in zip(people, legs)])
    wins = [i for i, r in enumerate(rs) if r.status_code == 201]
    assert wins in ([0, 1], [2]), [r.text for r in rs]
    for i, r in enumerate(rs):
        if i in wins:
            assert labels(r.json())[0].startswith("CNF S1")
            continue
        j = problem(r, "availability_changed")
        assert j["charged"] is False and j["offer"]["accept"] == "RAC" and j["offer"]["label"].startswith("RAC ")
    if wins == [0, 1]:
        assert cur(rs[0].json(), 1)["berth"] == cur(rs[1].json(), 1)["berth"]
    for i, p in enumerate(people):
        assert len(paid(killbill, p.id)) == (1 if i in wins else 0)


def test_one_berth_per_stretch(app_url):
    s = fresh(app_url, trains=["12627"])
    f = traveller(app_url)
    a = booked(f.c, slot("12627", s["run_date"], "SL", "SBC", "KPD"), pax(1))
    b = booked(f.c, slot("12627", s["run_date"], "SL", "KPD", "MAS"), pax(1))
    shared = (cur(a, 1)["coach"], cur(a, 1)["berth"])
    assert (cur(b, 1)["coach"], cur(b, 1)["berth"]) == shared
    made = fill_run(f.c, app_url, s, 0, 0)
    held_ = [(cur(x, n)["coach"], cur(x, n)["berth"]) for x in made for n in range(1, len(x["passengers"]) + 1)
             if cur(x, n)["status"] == "CNF"]
    assert len(held_) == len(set(held_)) and shared not in held_
    rac = [(cur(x, n)["coach"], cur(x, n)["berth"]) for x in made for n in range(1, len(x["passengers"]) + 1)
           if cur(x, n)["status"] == "RAC"]
    assert rac and max(rac.count(x) for x in rac) == 2
    states = httpx.get(f"{app_url}/api/trains/12627/runs/{s['run_date']}/coaches",
                       params={"class": "SL", "from": "SBC", "to": "MAS"}, timeout=HTTP_S).json()["coaches"][0]["berths"]
    assert {x["state"] for x in states if x["quota"] == "RAC"} == {"rac_full"}


def test_advance_window(app_url, killbill):
    t = traveller(app_url)
    td = now(app_url).date()
    late, edge = slot("16341", td + timedelta(days=61), "SL"), slot("16341", td + timedelta(days=60), "SL")
    opens = f"{td + timedelta(days=1)}T00:00:00+05:30"
    e = entry(app_url, late)[1]
    assert e["window"] == "not_yet_open" and e["opens_at"] == opens and e["label"] == f"OPENS {label_date(td + timedelta(days=1))}"
    for quota, people in (("GN", pax(1)), ("LD", pax(1, gender="F")), ("SS", pax(1, age=SENIOR))):
        assert problem(book(t.c, late, people, quota=quota), "booking_not_open")["opens_at"] == opens
    assert entry(app_url, edge)[1]["window"] == "open"
    booked(t.c, edge, pax(1))
    assert len(paid(killbill, t.id)) == 1


def test_tatkal_opening(app_url, killbill):
    t = traveller(app_url)
    run = now(app_url).date() + timedelta(days=3)
    eve = run - timedelta(days=1)
    for cls, hhmm in (("SL", "11:00"), ("3A", "10:00")):
        s = slot("16341", run, cls)
        e = entry(app_url, s, "TQ")[1]
        assert e["window"] == "not_yet_open" and e["opens_at"] == f"{eve}T{hhmm}:00+05:30"
        assert e["label"] == f"TATKAL OPENS {label_date(eve)} {hhmm} IST"
        assert problem(book(t.c, s, pax(1), quota="TQ"), "tatkal_not_open")["opens_at"] == f"{eve}T{hhmm}:00+05:30"
    assert paid(killbill, t.id) == []
    b = booked(t.c, tatkal_open(app_url, "SL"), pax(1), quota="TQ")
    assert cur(b, 1)["status"] == "CNF" and cur(b, 1)["berth"] in TQ_BERTHS


CHART_AT = {
    "12951": (0, "07:10"), "12627": (-1, "19:00"), "17031": (-1, "21:01"), "22477": (0, "06:00"),
    "14231": (0, "04:01"), "11025": (0, "11:30"), "12489": (0, "13:45"), "16341": (0, "01:30"),
}


@pytest.mark.parametrize("train", list(CHART_AT), ids=list(CHART_AT))
def test_chart_times(app_url, train):
    d = now(app_url).date() + timedelta(days=12)
    off, hhmm = CHART_AT[train]
    assert entry(app_url, slot(train, d, "SL"))[0]["chart_at"] == f"{d + timedelta(days=off)}T{hhmm}:00+05:30"


def test_deduction_bands(app_url):
    fast = os.environ["APP_FAST_CLOCK_URL"]
    n = now(fast)
    cands = []
    for tr in ONE_COACH:
        for k in range(1, 6):
            s = slot(tr, n.date() + timedelta(days=k), "3A")
            train, e = entry(fast, s)
            dep = datetime.fromisoformat(train["from"]["departure_at"])
            if dep - n >= BAND_EDGE + EDGE_LEAD and e["window"] == "open" and e["avl"] >= 2:
                cands.append((dep, s))
    dep, s = min(cands, key=lambda c: c[0])
    t = traveller(fast)
    b = booked(t.c, s, pax(2) + [one(age=CHILD)], accept="CNF")
    assert quote(t.c, b["pnr"], [1])["passengers"][0]["band"] == "flat"
    assert quote(t.c, b["pnr"], [3])["passengers"][0]["band"] == "no_fare"
    wait_business(fast, dep - BAND_EDGE)
    assert quote(t.c, b["pnr"], [1])["passengers"][0]["band"] == "quarter"
    r = cancel(t.c, b["pnr"], [1])
    assert r.status_code == 201, r.text
    assert [(p["number"], p["band"]) for p in r.json()["cancellation"]["passengers"]] == [(1, "quarter")]


def test_exact_refund_paise(app_url, killbill):
    t = traveller(app_url)
    s = fresh(app_url)
    f = fare(km(s), "SL")
    pnr = booked(t.c, s, pax(3))["pnr"]
    r = cancel(t.c, pnr, [1, 3])
    assert r.status_code == 201, r.text
    c = r.json()["cancellation"]
    assert [p["number"] for p in c["passengers"]] == [1, 3]
    for p in c["passengers"]:
        assert p["deduction_paise"] == p["charge_paise"] + p["gst_paise"] == FLAT["SL"]
        assert p["refund_paise"] == f - p["deduction_paise"]
    assert c["refund_paise"] == r.json()["refund"]["refund_paise"] == 2 * (f - FLAT["SL"])
    b = get(t.c, pnr)
    assert b["cancellations"] == [c] and cur(b, 2)["status"] == "CNF"
    refund = eventually(lambda: (lambda x: x if x and x["status"] == "SUCCESS" else None)(
        txn(killbill, pnr, f"{pnr}-refund-1")), MAIL_S, "Kill Bill refund")
    assert paise(refund) == c["refund_paise"]
    assert get(t.c, pnr)["cancellations"][0]["refund_paise"] == c["refund_paise"]


def test_gst_on_cancellation_charges(app_url):
    fast = os.environ["APP_FAST_CLOCK_URL"]
    n = now(fast)
    d = next(n.date() + timedelta(days=k) for k in range(4)
             if QUARTER_WINDOW[0] <= datetime.fromisoformat(f"{n.date() + timedelta(days=k)}T17:10:00+05:30") - n <= QUARTER_WINDOW[1])
    t = traveller(fast)
    b = booked(t.c, slot("12951", d, "3A"), pax(6), accept="CNF")
    q = quote(t.c, b["pnr"], [1, 2, 3, 4, 5, 6])
    assert all({k: p[k] for k in QUARTER} == QUARTER and p["band"] == "quarter" for p in q["passengers"]), q
    assert q["refund_paise"] == QUARTER_TOTAL
    r = cancel(t.c, b["pnr"], [1, 2, 3, 4, 5, 6])
    assert r.status_code == 201, r.text
    c = r.json()["cancellation"]
    assert all({k: x[k] for k in QUARTER} == QUARTER for x in c["passengers"]) and c["refund_paise"] == QUARTER_TOTAL
    p = traveller(app_url)
    ac = booked(p.c, fresh(app_url, "3A"), pax(1))
    gst = FLAT["3A"] * GST_PCT // 100
    assert {k: quote(p.c, ac["pnr"], [1])["passengers"][0][k] for k in ("band", "charge_paise", "gst_paise", "deduction_paise")} == \
        {"band": "flat", "charge_paise": FLAT["3A"], "gst_paise": gst, "deduction_paise": FLAT["3A"] + gst}
    sl = booked(p.c, fresh(app_url), pax(1))
    assert {k: quote(p.c, sl["pnr"], [1])["passengers"][0][k] for k in ("band", "charge_paise", "gst_paise", "deduction_paise")} == \
        {"band": "flat", "charge_paise": FLAT["SL"], "gst_paise": 0, "deduction_paise": FLAT["SL"]}


def test_party_clerkage(app_url, killbill):
    s = fresh(app_url, "3A")
    fill_run(traveller(app_url).c, app_url, s, 1)
    t = traveller(app_url)
    b = booked(t.c, s, pax(2), accept="RAC")
    assert [cur(b, 1)["status"], cur(b, 2)["status"]] == ["CNF", "RAC"]
    f = fare(km(s), "3A")
    whole = quote(t.c, b["pnr"], [1, 2])
    for p in whole["passengers"]:
        assert (p["band"], p["charge_paise"], p["deduction_paise"], p["refund_paise"]) == \
            ("party_clerkage", CLERKAGE, CLERKAGE_3A_DEDUCTION, f - CLERKAGE_3A_DEDUCTION)
    assert quote(t.c, b["pnr"], [1])["passengers"][0]["band"] == "flat"
    r = cancel(t.c, b["pnr"], [1, 2])
    assert r.status_code == 201
    total = 2 * (f - CLERKAGE_3A_DEDUCTION)
    assert r.json()["cancellation"]["refund_paise"] == total
    assert [p["band"] for p in r.json()["cancellation"]["passengers"]] == ["party_clerkage"] * 2
    refund = eventually(lambda: txn(killbill, b["pnr"], f"{b['pnr']}-refund-1"), MAIL_S, "refund")
    assert paise(refund) == total


def test_cancellation_ticket_versions(app_url):
    t = traveller(app_url)
    pnr = booked(t.c, fresh(app_url), pax(3))["pnr"]
    v1 = S3().get(f"tickets/{pnr}/v1-booked.pdf")
    key = idempotency_key()
    assert cancel(t.c, pnr, [1], key).status_code == 201
    eventually(lambda: f"tickets/{pnr}/v2-cancellation.pdf" in S3().keys(f"tickets/{pnr}/"), UI_S, "v2")
    assert cancel(t.c, pnr, [1], key).headers.get("Idempotent-Replay") == "true"
    assert [(x["version"], x["kind"]) for x in get(t.c, pnr)["tickets"]] == [(1, "booked"), (2, "cancellation")]
    assert cancel(t.c, pnr, [2]).status_code == 201
    eventually(lambda: f"tickets/{pnr}/v3-cancellation.pdf" in S3().keys(f"tickets/{pnr}/"), UI_S, "v3")
    assert sorted(S3().keys(f"tickets/{pnr}/")) == sorted(f"tickets/{pnr}/{k}" for k in ("v1-booked.pdf", "v2-cancellation.pdf", "v3-cancellation.pdf"))
    assert S3().get(f"tickets/{pnr}/v1-booked.pdf") == v1 == t.c.get(f"/api/bookings/{pnr}/tickets/1").content


def test_wf_search_phone_solo(app_url, browser, killbill):
    s = fresh(app_url)
    t = traveller(app_url)
    num, d = s["train"], date.fromisoformat(s["run_date"])
    sl_label = entry(app_url, s)[1]["label"]
    with ui(browser, app_url, "/", t.email, MOBILE) as page:
        select(role(page, "combobox", "From"), f"{s['from']} {name_of(s, 'from')}")
        select(role(page, "combobox", "To"), f"{s['to']} {name_of(s, 'to')}")
        fill(role(page, "textbox", "Journey date"), s["run_date"])
        click(role(page, "radio", "General"))
        click(role(page, "button", "Search trains"))
        reads(page, role(page, "status", "Search result"), f"1 trains from {name_of(s, 'from')} to {name_of(s, 'to')} on {long_date(d)}")
        click(role(page, "button", f"Show details {num}"))
        shows(page, role(page, "region", "Train details"))
        click(role(page, "button", "Filters"))
        sheet = role(page, "dialog", "Filters")
        shows(page, sheet)
        click(sheet.get_by_role("radio", name="AC 3 Tier (3A)"))
        click(sheet.get_by_role("radio", name="Sleeper (SL)"))
        reads(page, role(page, "status", "Availability", include_hidden=True), f"{num} SL General: {sl_label}")
        page.keyboard.press("Escape")
        advance(page, 500)
        holds(page, card_of(page, s), sl_label)
        page.reload()
        card = card_of(page, s)
        holds(page, card, inr(fare(km(s), "SL")))
        assert "class=SL" in page.url and "quota=GN" in page.url
        click(card.get_by_role("link", name=f"Book {num} SL"))
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, pax(1))
        pay(page, fare(km(s), "SL"))
        pnr = landed_pnr(page)
        b = get(t.c, pnr)
        holds(page, passenger_item(page, 1), labels(b)[0])
        assert labels(b)[0].startswith("CNF S1")
    assert [paise(x) for x in paid(killbill, t.id)] == [fare(km(s), "SL")]


def test_latest_filter_wins(app_url, browser):
    s = fresh(app_url)
    num = s["train"]
    line = f"{num} SL General: {entry(app_url, s)[1]['label']}"
    with ui(browser, app_url, results_path(s)) as page:
        shows(page, role(page, "region", "Train details"))
        card = card_of(page, s)
        holds(page, card, inr(fare(km(s), "SL")))
        sent, settled = [], []
        page.on("request", lambda r: sent.append(r.url) if "class=3A" in r.url else None)
        page.on("requestfinished", lambda r: settled.append(r.url) if "class=3A" in r.url else None)
        page.on("requestfailed", lambda r: settled.append(r.url) if "class=3A" in r.url else None)
        with held(page, "**/api/trains*class=3A*") as gate:
            click(role(page, "radio", "AC 3 Tier (3A)"))
            click(role(page, "radio", "Sleeper (SL)"))
            reads(page, role(page, "status", "Availability", include_hidden=True), line)
            gate.release()
            deadline = time.monotonic() + UI_S
            while len(settled) < len(sent):
                assert time.monotonic() < deadline, sent
                advance(page, 50)
        advance(page, 2000)
        expect(role(page, "status", "Availability", include_hidden=True)).to_have_text(line)
        expect(card).to_contain_text(inr(fare(km(s), "SL")))
        expect(card).not_to_contain_text(inr(fare(km(s), "3A")))
        expect(role(page, "radio", "Sleeper (SL)")).to_be_checked()
        assert parse_qs(urlsplit(page.url).query)["class"] == ["SL"]


def test_class_change_in_place(app_url, browser):
    s = fresh(app_url)
    num = s["train"]
    ac = {**s, "class": "3A"}
    ac_gn, ac_tq = entry(app_url, ac)[1]["label"], entry(app_url, ac, "TQ")[1]["label"]
    with ui(browser, app_url, results_path(s)) as page:
        shows(page, role(page, "region", "Train details"))
        card = card_of(page, s)
        page.evaluate("window.__stay = 1")
        history = page.evaluate("history.length")
        click(role(page, "radio", "AC 3 Tier (3A)"))
        reads(page, role(page, "status", "Availability", include_hidden=True), f"{num} 3A General: {ac_gn}")
        holds(page, card, inr(fare(km(s), "3A")))
        click(role(page, "radio", "Tatkal"))
        reads(page, role(page, "status", "Availability", include_hidden=True), f"{num} 3A Tatkal: {ac_tq}")
        q = parse_qs(urlsplit(page.url).query)
        assert q["class"] == ["3A"] and q["quota"] == ["TQ"]
        assert page.evaluate("history.length") == history and page.evaluate("window.__stay") == 1
        page.reload()
        expect(role(page, "radio", "AC 3 Tier (3A)")).to_be_checked()
        expect(role(page, "radio", "Tatkal")).to_be_checked()


def test_closed_sheet_unavailable(app_url, browser):
    s = fresh(app_url)
    sheet_names = {"Sleeper (SL)", "AC 3 Tier (3A)", "General", "Tatkal", "Ladies", "Senior", "Close filters"}
    with ui(browser, app_url, results_path(s), size=MOBILE) as page:
        shows(page, role(page, "list", "Trains"))
        assert page.get_by_role("radio").count() == 0 and role(page, "region", "Train details").count() == 0
        names = tab_order(page, 30)
        assert not sheet_names & set(names) and not [n for n in names if n and n.startswith("Berth ")], names
        click(role(page, "button", "Filters"))
        shows(page, role(page, "dialog", "Filters"))
        assert accessible_name(page) in sheet_names
        assert set(tab_order(page, 12)) <= sheet_names
        page.keyboard.press("Escape")
        closed(page, role(page, "dialog", "Filters"))
        expect(page.get_by_role("radio")).to_have_count(0, timeout=EXIT_S * 1000)
        assert accessible_name(page) == "Filters"
        assert not sheet_names & set(tab_order(page, 30))
        layout(page)


def test_wf_search_layouts(app_url, browser):
    s = fresh(app_url)
    with ui(browser, app_url, results_path(s), size=MOBILE) as page:
        shows(page, role(page, "list", "Trains"))
        assert role(page, "button", "Filters").count() == 1 and page.get_by_role("radio").count() == 0
        layout(page)
        axe(page)
        for size in (TABLET, DESKTOP):
            page.set_viewport_size(size)
            page.reload()
            group, cards = role(page, "radiogroup", "Class"), role(page, "list", "Trains")
            shows(page, group)
            assert role(page, "button", "Filters").count() == 0
            g, c = group.bounding_box(), cards.bounding_box()
            assert g["x"] + g["width"] <= c["x"] + 1, (g, c)
            if size is DESKTOP:
                details = role(page, "region", "Train details")
                shows(page, details)
                assert c["x"] + c["width"] <= details.bounding_box()["x"] + 1
            else:
                assert role(page, "region", "Train details").count() == 0
            layout(page)
            axe(page)


def test_wf_payment_outage(app_url, browser, killbill):
    base = os.environ["APP_KILLBILL_DOWN_URL"]
    t = traveller(app_url)
    s = fresh(app_url)
    with ui(browser, base, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, pax(1))
        pay(page, fare(km(s), "SL"))
        reads(page, role(page, "alert", "Booking problem"),
              "Payments are down right now. Nothing was charged and no berth is held. Try again in a few minutes.")
    problem(book(login(base, t.email), s, pax(1)), "payment_unavailable", 503)
    assert t.c.get("/api/bookings").json()["bookings"] == []
    assert is_empty(entry(app_url, s)[1], s) and paid(killbill, t.id) == []


def test_wf_payment_session_resume(app_url, browser, killbill):
    t = traveller(app_url)
    s = fresh(app_url, "3A")
    path = book_path(s)
    people = [one(), one(gender="F"), one(age=SENIOR + 5)]
    with ui(browser, app_url, path, t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, people)
        check(role(page, "checkbox", "Keep party in one coach"))
        click(role(page, "radio", "Passenger 1"))
        click(page.get_by_role("button", name=re.compile(r"^Berth B1 25 lower,")))
        shows(page, page.get_by_role("button", name=re.compile(r"^Berth B1 25 lower,.*preferred by passenger 1")))
        page.context.clear_cookies()
        pay(page, 3 * fare(km(s), "3A"))
        wait_ui(page, lambda: expect(page).to_have_url(re.compile(r"/signin\?"), timeout=300))
        assert parse_qs(urlsplit(page.url).query)["next"] == [path]
        reads(page, role(page, "alert", "Sign-in problem"), "Your session ended. Sign in again to finish this booking. Nothing was charged.")
        assert paid(killbill, t.id) == []
        fill(role(page, "textbox", "Email"), t.email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(role(page, "button", "Sign in"))
        wait_ui(page, lambda: expect(page).to_have_url(app_url + path, timeout=300))
        for i, p in enumerate(people, 1):
            group = role(page, "group", f"Passenger {i}")
            expect(group.get_by_role("textbox", name="Name")).to_have_value(p["name"])
            expect(group.get_by_role("spinbutton", name="Age")).to_have_value(str(p["age"]))
        expect(role(page, "checkbox", "Keep party in one coach")).to_be_checked()
        expect(role(page, "textbox", "Mobile number")).to_have_value(PHONE)
        shows(page, page.get_by_role("button", name=re.compile(r"^Berth B1 25 lower,.*preferred by passenger 1")))
        expect(role(page, "button", "Review and pay")).to_be_focused()
        assert t.c.get("/api/bookings").json()["bookings"] == []
        pay(page, 3 * fare(km(s), "3A"))
        pnr = landed_pnr(page)
    assert [x["pnr"] for x in t.c.get("/api/bookings").json()["bookings"]] == [pnr]
    assert len(paid(killbill, t.id)) == 1 and get(t.c, pnr)["keep_in_one_coach"] is True


def test_wf_payment_dialog(app_url, browser, killbill):
    t = traveller(app_url)
    s = fresh(app_url)
    total = fare(km(s), "SL")
    with ui(browser, app_url, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, pax(1))
        opener = role(page, "button", "Review and pay")
        click(opener)
        dialog = role(page, "dialog", "Confirm and pay")
        shows(page, dialog)
        def pay_named():
            assert accessible_name(page) == f"Pay {inr(total)}"
        wait_ui(page, pay_named)
        for key in ["Tab"] * 4 + ["Shift+Tab"] * 4:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)"), key
        page.keyboard.press("Escape")
        closed(page, dialog)
        assert accessible_name(page) == "Review and pay"
        assert t.c.get("/api/bookings").json()["bookings"] == [] and paid(killbill, t.id) == []
        click(opener)
        shows(page, dialog)
        click(dialog.get_by_role("button", name=f"Pay {inr(total)}"))
        pnr = landed_pnr(page)
    assert [x["pnr"] for x in t.c.get("/api/bookings").json()["bookings"]] == [pnr]
    assert [paise(x) for x in paid(killbill, t.id)] == [total]


def test_wf_payment_problem_survives(app_url, browser, killbill):
    t = traveller(app_url)
    s = fresh(app_url)
    total = fare(km(s), "SL")
    with ui(browser, app_url, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, [one(pref="UB")])
        select(role(page, "group", "Passenger 1").get_by_role("combobox", name="Berth preference"), "Upper")
        check(role(page, "checkbox", "Book only if a lower berth is allotted"))
        opener = role(page, "button", "Review and pay")
        dialog = role(page, "dialog", "Confirm and pay")
        click(opener)
        shows(page, dialog)
        click(dialog.get_by_role("button", name="Back"))
        click(opener)
        advance(page, 1000)
        expect(dialog).to_have_css("opacity", "1", timeout=EXIT_S * 1000)
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("button", name=f"Pay {inr(total)}")).to_be_focused()
        click(dialog.get_by_role("button", name=f"Pay {inr(total)}"))
        alert = role(page, "alert", "Booking problem")
        copy = "No lower berth could be allotted. Nothing was booked or charged."
        reads(page, alert, copy)
        shows(page, role(page, "status", "Fare availability"))
        for _ in range(4):
            advance(page, POLL_MS // 4)
            expect(alert).to_have_text(copy)
        fill(role(page, "group", "Passenger 1").get_by_role("spinbutton", name="Age"), str(ADULT + 1))
        wait_ui(page, lambda: expect(alert).to_have_text("", timeout=300) if alert.count() else None)
    assert paid(killbill, t.id) == [] and t.c.get("/api/bookings").json()["bookings"] == []


def closed(page, loc, seconds=EXIT_S):
    end = time.monotonic() + seconds
    while True:
        advance(page, 100)
        if loc.evaluate_all("els => els.every(e => !e.checkVisibility() || getComputedStyle(e).opacity === '0')"):
            return
        if time.monotonic() > end:
            raise AssertionError(f"still shown {seconds}s after closing")
        _PAUSE.wait(0.05)


def test_wf_last_berth_offer(app_url, browser, killbill):
    s = fresh(app_url)
    fill_run(traveller(app_url).c, app_url, s, 1)
    t, rival = traveller(app_url), traveller(app_url)
    with ui(browser, app_url, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, pax(1))
        holds(page, role(page, "status", "Fare availability"), f"AVL 1 / RAC {RAC_PLACES} / GNWL 0")
        booked(rival.c, s, pax(1))
        pay(page, fare(km(s), "SL"))
        reads(page, role(page, "alert", "Booking problem"),
              "Availability changed before you paid. Nothing was charged. Now available: RAC 1 S1 7 SL.")
        assert paid(killbill, t.id) == []
        click(role(page, "button", "Book at RAC 1 S1 7 SL"))
        pnr = landed_pnr(page)
        holds(page, passenger_item(page, 1), "RAC 1 S1 7 SL")
    assert labels(get(t.c, pnr)) == ["RAC 1 S1 7 SL"]
    assert [paise(x) for x in paid(killbill, t.id)] == [fare(km(s), "SL")]


def test_wf_last_berth_double_pay(app_url, browser, killbill):
    t = traveller(app_url)
    s = fresh(app_url)
    with ui(browser, app_url, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, pax(1))
        click(role(page, "button", "Review and pay"))
        button = role(page, "dialog", "Confirm and pay").get_by_role("button", name=f"Pay {inr(fare(km(s), 'SL'))}")
        shows(page, button)
        button.dblclick()
        landed_pnr(page)
    assert len(t.c.get("/api/bookings").json()["bookings"]) == 1 and len(paid(killbill, t.id)) == 1


def test_wf_booking_windows_device_clock(app_url, browser):
    td = now(app_url).date()
    closed, open_ = slot("16341", td + timedelta(days=61), "SL"), slot("12627", td + timedelta(days=5), "SL")
    t = traveller(app_url)
    pnr = booked(t.c, open_, pax(1))["pnr"]
    with ui(browser, app_url, "/pnr", t.email) as page:
        page.clock.set_fixed_time(FAKE_DEVICE_TIME)
        page.goto(app_url + results_path(closed))
        cards = role(page, "list", "Trains")
        holds(page, cards, f"OPENS {label_date(td + timedelta(days=1))}")
        assert page.get_by_role("link", name=f"Book {closed['train']} SL").count() == 0
        page.goto(app_url + results_path(open_))
        shows(page, page.get_by_role("link", name=f"Book {open_['train']} SL"))
        page.goto(app_url + f"/bookings/{pnr}")
        shows(page, page.get_by_text(f"Chart at 19:00 IST, {long_date(td + timedelta(days=4))}"))


def test_wf_booking_windows_live_flip(browser):
    fast = os.environ["APP_FAST_CLOCK_URL"]
    at, s, train = chart_soon(fast)
    with ui(browser, fast, results_path(s)) as page:
        card = role(page, "list", "Trains").get_by_role("listitem").filter(has=page.get_by_role("heading", name=f"{s['train']} {SEED[s['train']][0]}"))
        shows(page, card.get_by_role("link", name=f"Book {s['train']} SL"))
        url, history = page.url, page.evaluate("history.length")
        page.clock.resume()
        left = (at - now(fast)).total_seconds() / clock(fast)["rate"]
        due = time.monotonic() + left
        expect(card).to_contain_text("CHART PREPARED", timeout=(left + CLOCK_REFRESH_S + SLACK_S) * 1000)
        assert time.monotonic() - due <= CLOCK_REFRESH_S + 1
        expect(card.get_by_role("link", name=f"Book {s['train']} SL")).to_have_count(0)
        expect(role(page, "status", "Availability")).to_have_text(f"{s['train']} SL General: CHART PREPARED")
        assert page.url == url and page.evaluate("history.length") == history


def test_wf_cancellation_partial(app_url, browser, killbill):
    t = traveller(app_url)
    s = fresh(app_url, "3A")
    f = fare(km(s), "3A")
    pnr = booked(t.c, s, pax(3))["pnr"]
    gst = FLAT["3A"] * GST_PCT // 100
    each = f - FLAT["3A"] - gst
    with ui(browser, app_url, f"/bookings/{pnr}", t.email) as page:
        click(role(page, "button", "Cancel passengers"))
        dialog = role(page, "dialog", "Cancel passengers")
        shows(page, dialog)
        check(dialog.get_by_role("checkbox", name="Passenger 1"))
        check(dialog.get_by_role("checkbox", name="Passenger 2"))
        button = dialog.get_by_role("button", name=f"Cancel and refund {inr(2 * each)}")
        shows(page, button)
        click(button)
        reads(page, role(page, "status", "Cancellation result"), f"Cancelled. Refund of {inr(2 * each)} recorded.")
        holds(page, passenger_item(page, 1), "CAN")
        holds(page, passenger_item(page, 2), "CAN")
        holds(page, passenger_item(page, 3), "CNF")
        refunds = role(page, "list", "Refunds")
        holds(page, refunds, inr(2 * each))
        holds(page, refunds, "Refund issued", seconds=MAIL_S + SLACK_S)
        shows(page, role(page, "link", "Download e-ticket v2 (after cancellation)"))
    b = get(t.c, pnr)
    assert [p["number"] for p in b["cancellations"][0]["passengers"]] == [1, 2]
    assert [cur(b, n)["status"] for n in (1, 2, 3)] == ["CAN", "CAN", "CNF"]
    assert paise(txn(killbill, pnr, f"{pnr}-refund-1")) == 2 * each


def test_cancellation_preview(app_url, browser):
    t = traveller(app_url)
    s = fresh(app_url, "3A")
    f = fare(km(s), "3A")
    pnr = booked(t.c, s, pax(3))["pnr"]
    gst = FLAT["3A"] * GST_PCT // 100
    each = f - FLAT["3A"] - gst
    q = quote(t.c, pnr, [1, 2])
    assert [(p["number"], p["band"], p["charge_paise"], p["gst_paise"], p["deduction_paise"], p["refund_paise"])
            for p in q["passengers"]] == [(n, "flat", FLAT["3A"], gst, FLAT["3A"] + gst, each) for n in (1, 2)]
    assert q["refund_paise"] == 2 * each
    line = "Passenger {}: Flat charge, deduction " + f"{inr(FLAT['3A'] + gst)} incl. GST {inr(gst)}, refund {inr(each)}"
    with ui(browser, app_url, f"/bookings/{pnr}", t.email) as page:
        click(role(page, "button", "Cancel passengers"))
        dialog = role(page, "dialog", "Cancel passengers")
        shows(page, dialog)
        check(dialog.get_by_role("checkbox", name="Passenger 1"))
        check(dialog.get_by_role("checkbox", name="Passenger 2"))
        preview = dialog.get_by_role("list", name="Refund preview").get_by_role("listitem")
        wait_ui(page, lambda: expect(preview).to_have_text([line.format(1), line.format(2)], timeout=300))
        shows(page, dialog.get_by_role("button", name=f"Cancel and refund {inr(2 * each)}"))
        click(dialog.get_by_role("checkbox", name="Passenger 2"))
        wait_ui(page, lambda: expect(preview).to_have_text([line.format(1)], timeout=300))
        shows(page, dialog.get_by_role("button", name=f"Cancel and refund {inr(each)}"))
        click(dialog.get_by_role("button", name="Keep booking"))
    b = get(t.c, pnr)
    assert b["cancellations"] == [] and b["version"] == 1 and all(x.startswith("CNF") for x in labels(b))


def test_refund_confirmed_by_killbill(app_url, killbill):
    t = traveller(app_url)
    s = fresh(app_url)
    amount = fare(km(s), "SL") - FLAT["SL"]
    pnr = booked(t.c, s, pax(2))["pnr"]
    r = cancel(login(os.environ["APP_KILLBILL_DOWN_URL"], t.email), pnr, [1])
    assert r.status_code == 201, r.text
    assert r.json()["refund"]["status"] == "pending" and r.json()["refund"]["issued_at"] is None

    def issued():
        row = get(t.c, pnr)["refunds"][0]
        if row["status"] != "issued":
            return None
        tx = txn(killbill, pnr, f"{pnr}-refund-1")
        assert tx and tx["status"] == "SUCCESS" and paise(tx) == amount, tx
        return row
    row = eventually(issued, REFUND_RETRY_S + MAIL_S, "refund issued")
    assert row["issued_at"] and row["refund_paise"] == amount


def test_refund_mail(app_url, killbill, mail):
    t = traveller(app_url)
    s = fresh(app_url)
    amount = 2 * (fare(km(s), "SL") - FLAT["SL"])
    pnr = booked(t.c, s, pax(2))["pnr"]
    assert cancel(t.c, pnr, [1, 2]).status_code == 201
    m = await_mail(mail, f"Refund issued: PNR {pnr}", t.email)[0]
    tx = txn(killbill, pnr, f"{pnr}-refund-1")
    assert tx and tx["status"] == "SUCCESS" and paise(tx) == amount
    assert inr(amount) in text(m) and addresses(m.get("From")) == [mail_from_address()]


def test_wf_cancellation_rac_after_chart(browser, killbill):
    fast = os.environ["APP_FAST_CLOCK_URL"]
    at, s, train = chart_soon(fast)
    fill_run(traveller(fast).c, fast, s, 0)
    y = traveller(fast)
    b = booked(y.c, s, pax(2))
    assert [cur(b, 1)["status"], cur(b, 2)["status"]] == ["RAC", "RAC"]
    f = fare(km(s), "SL")
    wait_business(fast, at)
    with ui(browser, fast, f"/bookings/{b['pnr']}", y.email) as page:
        click(role(page, "button", "Cancel passengers"))
        dialog = role(page, "dialog", "Cancel passengers")
        check(dialog.get_by_role("checkbox", name="Passenger 1"))
        reads(page, dialog.get_by_role("list", name="Refund preview").get_by_role("listitem"),
              f"Passenger 1: RAC after chart, clerkage, deduction {inr(CLERKAGE)}, refund {inr(f - CLERKAGE)}")
        click(dialog.get_by_role("button", name=f"Cancel and refund {inr(f - CLERKAGE)}"))
        reads(page, role(page, "status", "Cancellation result"), f"Cancelled. Refund of {inr(f - CLERKAGE)} recorded.")
    eventually(lambda: txn(killbill, b["pnr"], f"{b['pnr']}-refund-1"), MAIL_S, "RAC refund")
    assert paise(txn(killbill, b["pnr"], f"{b['pnr']}-refund-1")) == f - CLERKAGE
    wait_business(fast, datetime.fromisoformat(b["departure_at"]) - RAC_CUTOFF + timedelta(minutes=4))
    q = quote(y.c, b["pnr"], [2])["passengers"][0]
    assert q["band"] == "after_chart" and q["refund_paise"] == 0
    r = cancel(y.c, b["pnr"], [2])
    assert r.status_code == 201 and r.json()["refund"] is None


def test_wf_my_bookings_signin_next(app_url, browser):
    t = traveller(app_url)
    pnr = booked(t.c, fresh(app_url), pax(1))["pnr"]
    with ui(browser, app_url, f"/bookings/{pnr}?x=1") as page:
        wait_ui(page, lambda: expect(page).to_have_url(re.compile(r"/signin\?next="), timeout=300))
        assert not "".join(role(page, "alert", "Sign-in problem").all_inner_texts()).strip()
        assert f"next=" in role(page, "link", "Create account").get_attribute("href")
        fill(role(page, "textbox", "Email"), t.email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(role(page, "button", "Sign in"))
        wait_ui(page, lambda: expect(page).to_have_url(f"{app_url}/bookings/{pnr}?x=1", timeout=300))
        shows(page, page.get_by_role("heading", name=f"PNR {pnr}", level=1))
    for raw, landing in [(f"/%09/{EVIL_HOST}", "/"), (f"/%5C{EVIL_HOST}", "/"), ("/" * 2 + EVIL_HOST, "/"),
                         (EVIL, "/"), (None, "/bookings")]:
        with ui(browser, app_url, "/signin" + (f"?next={raw}" if raw else "")) as page:
            fill(role(page, "textbox", "Email"), t.email)
            fill(page.get_by_label("Password", exact=True), PASSWORD)
            click(role(page, "button", "Sign in"))
            wait_ui(page, lambda: expect(page).to_have_url(app_url + landing, timeout=300))
    first, email = unique("pakka")
    with ui(browser, app_url, "/register?next=/pnr") as page:
        fill(role(page, "textbox", "Full name"), f"Pakka {first}"[:80])
        fill(role(page, "textbox", "Email"), email)
        fill(role(page, "textbox", "Mobile number"), PHONE)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(role(page, "button", "Create account"))
        wait_ui(page, lambda: expect(page).to_have_url(app_url + "/pnr", timeout=300))
    assert login(app_url, email).get("/api/me").status_code == 200


def test_wf_my_bookings_tickets(app_url, browser):
    t = traveller(app_url)
    pnr = booked(t.c, fresh(app_url), pax(2))["pnr"]
    stored = S3().get(f"tickets/{pnr}/v1-booked.pdf")
    r = t.c.get(f"/api/bookings/{pnr}/tickets/1")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf") and r.content == stored
    assert f'filename="e-ticket-{pnr}-v1.pdf"' in r.headers["content-disposition"] and r.headers.get("etag")
    with ui(browser, app_url, "/bookings", t.email) as page:
        click(role(page, "list", "My bookings").get_by_role("link", name=f"PNR {pnr}"))
        shows(page, page.get_by_role("heading", name=f"PNR {pnr}", level=1))
        link = role(page, "list", "E-tickets").get_by_role("link", name=f"Download e-ticket v{1} (as booked)")
        with page.expect_download() as dl:
            click(link)
        assert Path(dl.value.path()).read_bytes() == stored
        assert dl.value.suggested_filename == f"e-ticket-{pnr}-v1.pdf"


def test_wf_public_pnr_lookup(app_url, browser):
    t = traveller(app_url)
    people = [one(age=41), one(age=SENIOR + 7, gender="F")]
    b = booked(t.c, fresh(app_url), people)
    r = httpx.get(f"{app_url}/api/pnr/{b['pnr']}", timeout=HTTP_S)
    assert r.status_code == 200
    j = r.json()
    assert [(p["number"], p["booking_status"], p["current_status"]) for p in j["passengers"]] == \
        [(i, l, l) for i, l in enumerate(labels(b), 1)]
    for secret in [p["name"] for p in people] + [t.email, PHONE, t.id, t.name]:
        assert secret not in r.text
    assert not {"name", "age", "gender", "fare_paise"} & {k for p in j["passengers"] for k in p}
    with ui(browser, app_url, "/pnr") as page:
        fill(role(page, "textbox", "PNR number"), b["pnr"])
        click(role(page, "button", "Check status"))
        table = role(page, "table", "PNR status")
        holds(page, table, "Passenger 2")
        holds(page, table, labels(b)[1])
        html = page.content()
        assert not [x for x in [p["name"] for p in people] + [t.email, PHONE] if x in html]
        ghost = "1000000007"
        fill(role(page, "textbox", "PNR number"), ghost)
        click(role(page, "button", "Check status"))
        reads(page, role(page, "status", "PNR lookup"), f"No booking has PNR {ghost}.")


def test_wf_public_pnr_layout(app_url, browser):
    t = traveller(app_url)
    b = booked(t.c, fresh(app_url), pax(1))
    with ui(browser, app_url, f"/pnr/{b['pnr']}", size=MOBILE) as page:
        row = role(page, "table", "PNR status").get_by_role("row").filter(has_text="Passenger 1")
        shows(page, row)
        for size, stacked in ((MOBILE, True), (TABLET, False), (DESKTOP, False)):
            page.set_viewport_size(size)
            advance(page, 300)
            cells = [c.bounding_box() for c in row.get_by_role("rowheader").all() + row.get_by_role("cell").all()]
            assert len(cells) == 3
            if stacked:
                assert max(c["x"] for c in cells) - min(c["x"] for c in cells) <= 1
                assert cells[0]["y"] < cells[1]["y"] < cells[2]["y"]
                assert row.evaluate("""r => [r, ...r.querySelectorAll('*')].some(e =>
                    (e.innerText || '').includes('Booking status')
                    || (getComputedStyle(e, '::before').content || '').includes('Booking status')
                    || (getComputedStyle(e, '::after').content || '').includes('Booking status'))""")
            else:
                assert max(c["y"] for c in cells) - min(c["y"] for c in cells) <= 1
            layout(page)


def test_wf_family_booking_mixed_party(app_url, browser, killbill):
    s = fresh(app_url, "SL", trains=["12489"])
    t = traveller(app_url)
    ages = [(40, "M"), (38, "F"), (67, "M"), (64, "F"), (12, "F"), (9, "M"), (3, "F")]
    people = [one(age=a, gender=g) for a, g in ages]
    each = fare(km(s), "SL")
    with ui(browser, app_url, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, people)
        check(role(page, "checkbox", "Keep party in one coach"))
        pay(page, 6 * each)
        pnr = landed_pnr(page)
        b = get(t.c, pnr)
        for n, p in enumerate(b["passengers"], 1):
            holds(page, passenger_item(page, n), p["current_status"]["label"])
    sts = [p["current_status"] for p in b["passengers"]]
    assert {x["coach"] for x in sts[:6]} == {"S1"} and all(x["status"] == "CNF" for x in sts[:6])
    assert {sts[2]["berth"], sts[3]["berth"]} <= SS_BERTHS and sts[2]["berth_type"] == sts[3]["berth_type"] == "LB"
    assert sts[6]["status"] == "NOSB" and b["keep_in_one_coach"] is True
    assert [paise(x) for x in paid(killbill, t.id)] == [6 * each]


def test_coach_plan_keyboard(app_url, browser):
    s = fresh(app_url, "SL", trains=["12489"])
    t = traveller(app_url)
    with ui(browser, app_url, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, pax(2))
        click(role(page, "radio", "Passenger 2"))
        role(page, "tab", "S1").focus()
        page.keyboard.press("Tab")
        for key, want in [(None, "S1 1 lower"), ("ArrowRight", "S1 9 lower"), ("ArrowDown", "S1 10 middle"),
                          ("ArrowUp", "S1 9 lower"), ("ArrowLeft", "S1 1 lower"), ("ArrowLeft", "S1 1 lower"),
                          ("ArrowUp", "S1 1 lower"), ("End", "S1 65 lower"), ("ArrowRight", "S1 65 lower"),
                          ("Home", "S1 1 lower"), ("ArrowRight", "S1 9 lower"), ("ArrowRight", "S1 17 lower"),
                          ("ArrowRight", "S1 25 lower"), ("PageUp", "S1 25 lower"), ("PageDown", "S2 25 lower"),
                          ("PageDown", "S2 25 lower"), ("PageUp", "S1 25 lower")]:
            if key:
                page.keyboard.press(key)
            assert (accessible_name(page) or "").startswith(f"Berth {want},"), (key, accessible_name(page))
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("button", name=re.compile(r"^Berth S1 25 lower,.*preferred by passenger 2")))
        page.keyboard.press("PageDown")
        expect(page.get_by_role("tab", name="S2", selected=True)).to_have_count(1)
        page.keyboard.press("PageUp")
        expect(page.get_by_role("tab", name="S1", selected=True)).to_have_count(1)
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Tab")
        assert (accessible_name(page) or "").startswith("Berth S1 25 lower,"), accessible_name(page)
        page.keyboard.press("ArrowDown")
        page.keyboard.press(" ")
        shows(page, page.get_by_role("button", name=re.compile(r"^Berth S1 26 middle,.*preferred by passenger 2")))
        shows(page, page.get_by_text("Preferences guide allotment. The exact berth is allotted when you pay.", exact=True))


def test_live_fare_total(app_url, browser):
    s = fresh(app_url, "3A")
    t = traveller(app_url)
    each = fare(km(s), "3A")
    with ui(browser, app_url, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        total = role(page, "status", "Fare total")
        enter_party(page, [one(), one(age=CHILD)])
        url = page.url
        advance(page, FARE_MS)
        expect(total).to_have_text(f"Total {inr(each)}", timeout=UI_S * 1000)
        expect(role(page, "list", "Fare lines")).to_contain_text(f"Passenger {2} — under five, no berth")
        expect(role(page, "list", "Fare lines")).to_contain_text("GST 5%")
        click(role(page, "button", "Add passenger"))
        third = role(page, "group", "Passenger 3")
        shows(page, third)
        fill(third.get_by_role("spinbutton", name="Age"), str(ADULT))
        advance(page, FARE_MS)
        expect(total).to_have_text(f"Total {inr(2 * each)}", timeout=UI_S * 1000)
        fill(role(page, "group", "Passenger 2").get_by_role("spinbutton", name="Age"), str(ADULT))
        advance(page, FARE_MS)
        expect(total).to_have_text(f"Total {inr(3 * each)}", timeout=UI_S * 1000)
        click(role(page, "button", "Remove passenger 3"))
        advance(page, FARE_MS)
        expect(total).to_have_text(f"Total {inr(2 * each)}", timeout=UI_S * 1000)
        assert page.url == url


def test_wf_family_booking_phone(app_url, browser):
    s = fresh(app_url)
    t = traveller(app_url)
    with ui(browser, app_url, book_path(s), t.email, MOBILE) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, pax(2))
        click(role(page, "radio", "Passenger 2"))
        tap(page.get_by_role("button", name=re.compile(r"^Berth S1 25 lower,")))
        shows(page, page.get_by_role("button", name=re.compile(r"^Berth S1 25 lower,.*preferred by passenger 2")))
        berths = page.get_by_role("group", name=f"Coach plan {coach(s)}").get_by_role("button")
        for box in [b.bounding_box() for b in berths.all()]:
            assert box["width"] >= TAP_PX and box["height"] >= TAP_PX, box
        role(page, "group", "Passenger 1").get_by_role("textbox", name="Name").focus()
        for _ in range(12):
            advance(page, 600)
            name = accessible_name(page)
            if name in {"Name", "Age", "Gender", "Berth preference", "Mobile number"}:
                bar = role(page, "button", "Review and pay").bounding_box()
                box = page.evaluate("() => { const r = document.activeElement.getBoundingClientRect(); return {top: r.top, bottom: r.bottom}; }")
                assert box["top"] >= 0 and box["bottom"] <= bar["y"] + 1, (name, box, bar)
            page.keyboard.press("Tab")
        layout(page)


def test_wf_family_booking_party_split(app_url, browser, killbill):
    t = traveller(app_url)
    kept = booked(t.c, fresh(app_url), pax(3), keep=True)
    assert {cur(kept, n)["coach"] for n in (1, 2, 3)} == {"S1"} and {cur(kept, n)["status"] for n in (1, 2, 3)} == {"CNF"}
    s = fresh(app_url)
    fill_run(traveller(app_url).c, app_url, s, 1)
    with ui(browser, app_url, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, pax(2))
        check(role(page, "checkbox", "Keep party in one coach"))
        pay(page, 2 * fare(km(s), "SL"))
        reads(page, role(page, "alert", "Booking problem"), "Party could not be kept in one coach. Nothing was booked or charged.")
    assert [x["pnr"] for x in t.c.get("/api/bookings").json()["bookings"]] == [kept["pnr"]]
    assert len(paid(killbill, t.id)) == 1
    assert entry(app_url, s)[1]["avl"] == 1


def test_wf_pnr_tracking_chart_drop(app_url, browser):
    sc = queued(app_url)
    _, _, w, pnr = waitlisted(app_url, sc, ahead=0)
    assert labels(get(w.c, pnr)) == ["GNWL 1"]
    with ui(browser, app_url, f"/bookings/{pnr}", w.email) as a:
        holds(a, passenger_item(a, 1), "GNWL 1")
        holds(a, role(a, "region", "WL lane"), "GNWL 1")
        assert cancel(sc.f.c, sc.cnf[0]["pnr"], [1]).status_code == 201
        assert labels(get(w.c, pnr)) == ["RAC 12 S1 7 SL"]
        poll(a, pnr)
        advance(a, 3000)
        holds(a, role(a, "region", "RAC lane"), "RAC 12")
        shows(a, a.get_by_role("button", name=re.compile(r"^Berth S1 7 side lower, RAC, .*RAC passenger 1")))
        for b in sc.rac:
            live = get(sc.f.c, b["pnr"])
            nums = [n for n in range(1, len(live["passengers"]) + 1) if cur(live, n)["status"] == "RAC"]
            assert cancel(sc.f.c, b["pnr"], nums).status_code == 201
        assert labels(get(w.c, pnr)) == ["RAC 1 S1 7 SL"]
        assert cancel(sc.f.c, sc.cnf[0]["pnr"], [2]).status_code == 201
        final = cur(get(w.c, pnr), 1)
        assert final["status"] == "CNF"
        poll(a, pnr)
        advance(a, 5000)
        word = POS[final["berth_type"]]
        shows(a, a.get_by_role("button", name=re.compile(rf"^Berth S1 {final['berth']} {word}, General, taken, CNF passenger 1")))
        holds(a, passenger_item(a, 1), final["label"])


def test_status_polling(app_url, browser):
    sc = queued(app_url)
    q, qb, w, pnr = waitlisted(app_url, sc)
    with ui(browser, app_url, f"/bookings/{pnr}", w.email) as a:
        holds(a, passenger_item(a, 1), "GNWL 4")
        a.evaluate("window.__stay = 1")
        for n, left in ((1, 3), (2, 2)):
            assert cancel(q.c, qb["pnr"], [n]).status_code == 201
            poll(a, pnr)
            holds(a, passenger_item(a, 1), f"GNWL {left}")
        assert a.evaluate("window.__stay") == 1


def test_chart_drop_count(app_url, browser):
    sc = queued(app_url)
    q, qb, w, pnr = waitlisted(app_url, sc)
    assert labels(get(w.c, pnr)) == ["GNWL 4"]
    with ui(browser, app_url, f"/bookings/{pnr}", w.email) as a:
        holds(a, passenger_item(a, 1), "GNWL 4")
        assert cancel(q.c, qb["pnr"], [1, 2, 3]).status_code == 201
        with a.expect_response(lambda r: r.url.endswith(f"/api/bookings/{pnr}") and r.request.method == "GET",
                               timeout=UI_S * 1000):
            advance(a, POLL_MS)
        lane = a.get_by_role("region", name="WL lane", exact=True)
        seen, at_one, first_change = [], None, None
        for i in range(int(2 * COUNT_MAX_MS / STEP_MS)):
            m = re.search(r"GNWL (\d+)", lane.inner_text())
            n = int(m.group(1)) if m else None
            if n and (not seen or seen[-1] != n):
                seen.append(n)
                first_change = i * STEP_MS if n == 3 and first_change is None else first_change
                at_one = i * STEP_MS if n == 1 else at_one
            advance(a, STEP_MS)
        assert seen == [4, 3, 2, 1], seen
        assert at_one - first_change <= COUNT_MAX_MS and at_one >= COUNT_MIN_MS - STEP_MS, (first_change, at_one)
        holds(a, passenger_item(a, 1), "GNWL 1")


def test_reduced_motion_what_changed(app_url, browser):
    sc = queued(app_url)
    q, qb, w, pnr = waitlisted(app_url, sc)
    with ui(browser, app_url, f"/bookings/{pnr}", w.email, reduced="reduce") as r:
        holds(r, passenger_item(r, 1), "GNWL 4")
        assert cancel(q.c, qb["pnr"], [1, 2, 3]).status_code == 201
        poll(r, pnr)
        expect(passenger_item(r, 1)).to_contain_text("GNWL 1", timeout=UI_S * 1000)
        line = "Passenger 1: GNWL 4 to GNWL 1"
        expect(role(r, "region", "What changed").get_by_role("listitem")).to_have_text([line])
        expect(role(r, "status", "PNR updates")).to_have_text(line)


def test_status_announcements(app_url, browser):
    sc = queued(app_url)
    q, qb, w, pnr = waitlisted(app_url, sc, size=2)
    assert labels(get(w.c, pnr)) == ["GNWL 4", "GNWL 5"]
    with ui(browser, app_url, f"/bookings/{pnr}", w.email) as a:
        holds(a, passenger_item(a, 1), "GNWL 4")
        assert cancel(q.c, qb["pnr"], [1, 2, 3]).status_code == 201
        poll(a, pnr)
        advance(a, 5000)
        announced(a, ["Passenger 1: GNWL 4 to GNWL 1", "Passenger 2: GNWL 5 to GNWL 2"])
        before = statuses(w.c, pnr)
        assert cancel(sc.f.c, sc.cnf[0]["pnr"], [1]).status_code == 201
        after = statuses(w.c, pnr)
        assert [x["label"] for x in after] == ["RAC 12 S1 7 SL", "GNWL 1"]
        poll(a, pnr)
        advance(a, 5000)
        announced(a, update_lines(before, after))


def test_pnr_on_phone(app_url, browser):
    t = traveller(app_url)
    s = fresh(app_url)
    pnr = booked(t.c, s, pax(1))["pnr"]
    with ui(browser, app_url, f"/bookings/{pnr}", t.email, MOBILE) as r:
        plan_loc = r.get_by_role("group", name=f"Coach plan {coach(s)}")
        shows(r, plan_loc)
        plan, queue = plan_loc.bounding_box(), role(r, "region", "Queue").bounding_box()
        assert plan["height"] > plan["width"] and queue["y"] >= plan["y"] + plan["height"] - 1
        assert plan["x"] >= 0 and plan["x"] + plan["width"] <= MOBILE["width"]
        layout(r)
        r.set_viewport_size(TABLET)
        advance(r, 300)
        wide = plan_loc.bounding_box()
        assert wide["width"] > wide["height"]


def test_status_chip_shapes(app_url, browser):
    sc = queued(app_url)
    _, _, w, pnr = waitlisted(app_url, sc, ahead=0)
    with ui(browser, app_url, f"/bookings/{pnr}", w.email) as page:
        holds(page, passenger_item(page, 1), "GNWL 1")
        assert chip_shape(passenger_item(page, 1), "GNWL 1")["dashed"]
        axe(page)
    first = sc.cnf[0]
    with ui(browser, app_url, f"/bookings/{first['pnr']}", sc.f.email) as page:
        label = labels(first)[0]
        holds(page, passenger_item(page, 1), label)
        assert chip_shape(passenger_item(page, 1), label)["filled"]
        axe(page)


def test_wf_pnr_tracking_newest_wins(app_url, browser):
    t = traveller(app_url)
    s = fresh(app_url)
    b = booked(t.c, s, pax(3))
    pnr = b["pnr"]
    old = get(t.c, pnr)
    assert old["version"] == 1
    assert cancel(t.c, pnr, [1]).json()["booking"]["version"] == 2
    with ui(browser, app_url, f"/bookings/{pnr}", t.email) as page:
        holds(page, passenger_item(page, 1), "CAN")
        page.route(f"**/api/bookings/{pnr}", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(old))
                   if route.request.method == "GET" else route.fallback())
        poll(page, pnr)
        advance(page, 2000)
        expect(passenger_item(page, 1)).to_contain_text("CAN")
        expect(role(page, "status", "PNR updates")).not_to_contain_text("Passenger 1")
        page.unroute(f"**/api/bookings/{pnr}")
        before = cur(get(t.c, pnr), 2)
        eventually(lambda: all(f["status"] == "issued" for f in get(t.c, pnr)["refunds"]),
                   REFUND_RETRY_S + MAIL_S, "refund issued")
        version = get(t.c, pnr)["version"]
        r = cancel(t.c, pnr, [2])
        assert r.json()["booking"]["version"] == version + 1
        poll(page, pnr)
        advance(page, 3000)
        holds(page, passenger_item(page, 2), "CAN")
        reads(page, role(page, "status", "PNR updates"), f"Passenger 2: {spoken(before)} to cancelled")


def test_wf_promotion_cascade(app_url, browser):
    s = fresh(app_url)
    f, rt, w = traveller(app_url), traveller(app_url), traveller(app_url)
    cnf = fill_run(f.c, app_url, s, 0)
    rp = booked(rt.c, s, pax(1))["pnr"]
    fill_run(f.c, app_url, s, 0, 0)
    wp = booked(w.c, s, pax(1))["pnr"]
    assert labels(get(rt.c, rp)) == ["RAC 1 S1 7 SL"] and labels(get(w.c, wp)) == ["GNWL 1"]
    with ui(browser, app_url, f"/bookings/{wp}", w.email) as page:
        holds(page, passenger_item(page, 1), "GNWL 1")
        freed = cur(cnf[0], 1)
        assert cancel(f.c, cnf[0]["pnr"], [1]).status_code == 201
        moved = cur(get(rt.c, rp), 1)
        assert (moved["status"], moved["coach"], moved["berth"]) == ("CNF", freed["coach"], freed["berth"])
        assert labels(get(w.c, wp)) == ["RAC 12 S1 7 SL"]
        poll(page, wp)
        advance(page, 3000)
        holds(page, role(page, "region", "RAC lane"), "RAC 12")
        holds(page, passenger_item(page, 1), "RAC 12 S1 7 SL")


def test_contiguous_queues(app_url):
    sc = queued(app_url)
    ws = [traveller(app_url) for _ in range(3)]
    ps = [booked(x.c, sc.s, pax(1))["pnr"] for x in ws]
    assert [labels(get(x.c, p))[0] for x, p in zip(ws, ps)] == ["GNWL 1", "GNWL 2", "GNWL 3"]
    assert cancel(ws[1].c, ps[1], [1]).status_code == 201
    assert labels(get(ws[0].c, ps[0])) == ["GNWL 1"] and labels(get(ws[2].c, ps[2])) == ["GNWL 2"]
    assert cancel(sc.f.c, sc.rac[0]["pnr"], [1]).status_code == 201
    assert labels(get(ws[0].c, ps[0])) == [f"RAC {RAC_PLACES} S1 7 SL"] and labels(get(ws[2].c, ps[2])) == ["GNWL 1"]
    rac = [cur(get(sc.f.c, b["pnr"]), n) for b in sc.rac for n in range(1, len(b["passengers"]) + 1)]
    positions = sorted([x["position"] for x in rac if x["status"] == "RAC"] + [cur(get(ws[0].c, ps[0]), 1)["position"]])
    assert positions == list(range(1, RAC_PLACES + 1))
    assert entry(app_url, sc.s)[1]["label"] == gn_label(0, 0, "GNWL 1")


def test_status_moved_mail(app_url, mail):
    sc = queued(app_url)
    w, w2 = traveller(app_url), traveller(app_url)
    wp, wp2 = booked(w.c, sc.s, pax(1))["pnr"], booked(w2.c, sc.s, pax(1))["pnr"]
    lead = sc.rac[0]["pnr"]
    before = statuses(sc.f.c, lead)
    assert cancel(sc.f.c, sc.cnf[0]["pnr"], [1]).status_code == 201
    after = statuses(sc.f.c, lead)
    assert after[0]["status"] == "CNF" and labels(get(w2.c, wp2)) == ["GNWL 1"]
    line = f"Passenger 1: {spoken(before[0])} to {spoken(after[0])}"
    assert line in text(await_mail(mail, f"Your status moved: PNR {lead}", sc.f.email)[0])
    assert f"Passenger 1: GNWL 1 to RAC {RAC_PLACES}" in text(await_mail(mail, f"Your status moved: PNR {wp}", w.email)[0])
    assert mails(mail, f"Your status moved: PNR {wp2}", w2.email) == []
    assert mails(mail, f"Your status moved: PNR {sc.rac[1]['pnr']}", sc.f.email) == []


def test_wf_pnr_tracking_poll_during_dialog(app_url, browser):
    s = fresh(app_url)
    f, rt = traveller(app_url), traveller(app_url)
    cnf = fill_run(f.c, app_url, s, 0)
    rp = booked(rt.c, s, pax(1))["pnr"]
    assert labels(get(rt.c, rp)) == ["RAC 1 S1 7 SL"]
    each = fare(km(s), "SL")
    with ui(browser, app_url, f"/bookings/{rp}", rt.email) as page:
        click(role(page, "button", "Cancel passengers"))
        dialog = role(page, "dialog", "Cancel passengers")
        box = dialog.get_by_role("checkbox", name="Passenger 1")
        check(box)
        preview = dialog.get_by_role("list", name="Refund preview").get_by_role("listitem")
        reads(page, preview, f"Passenger 1: Clerkage, deduction {inr(CLERKAGE)}, refund {inr(each - CLERKAGE)}")
        box.focus()
        assert cancel(f.c, cnf[0]["pnr"], [1]).status_code == 201
        moved = cur(get(rt.c, rp), 1)
        assert moved["status"] == "CNF"
        poll(page, rp)
        reads(page, preview, f"Passenger 1: Flat charge, deduction {inr(FLAT['SL'])}, refund {inr(each - FLAT['SL'])}")
        shows(page, dialog.get_by_role("button", name=f"Cancel and refund {inr(each - FLAT['SL'])}"))
        expect(box).to_be_checked()
        assert accessible_name(page) == "Passenger 1"
        expect(passenger_item(page, 1, hidden=True)).to_contain_text("RAC 1")
        click(dialog.get_by_role("button", name="Keep booking"))
        advance(page, 3000)
        line = f"Passenger 1: RAC 1 to CNF, S1 berth {moved['berth']}, {POS[moved['berth_type']]}"
        reads(page, role(page, "status", "PNR updates"), line)
        holds(page, passenger_item(page, 1), moved["label"])


def test_wf_promotion_simultaneous(app_url, browser, mail):
    s = fresh(app_url)
    f = traveller(app_url)
    cnf = fill_run(f.c, app_url, s, 0)
    racs = fill_run(f.c, app_url, s, 0, 0)
    w2, w3 = traveller(app_url), traveller(app_url)
    p2, p3 = booked(w2.c, s, pax(1))["pnr"], booked(w3.c, s, pax(1))["pnr"]
    with ui(browser, app_url, f"/bookings/{p2}", w2.email) as page:
        holds(page, passenger_item(page, 1), "GNWL 1")
        rs = together([lambda: cancel(f.c, cnf[0]["pnr"], [1]), lambda: cancel(f.c, cnf[1]["pnr"], [1])])
        assert [r.status_code for r in rs] == [201, 201]
        lead = get(f.c, racs[0]["pnr"])
        promoted = [cur(lead, n) for n in (1, 2)]
        assert [x["status"] for x in promoted] == ["CNF", "CNF"]
        assert {(x["coach"], x["berth"]) for x in promoted} == {(cur(cnf[0], 1)["coach"], cur(cnf[0], 1)["berth"]),
                                                               (cur(cnf[1], 1)["coach"], cur(cnf[1], 1)["berth"])}
        mine = [cur(get(w2.c, p2), 1), cur(get(w3.c, p3), 1)]
        assert [x["label"] for x in mine] == ["RAC 11 S1 7 SL", "RAC 12 S1 7 SL"]
        everyone = [cur(get(f.c, b["pnr"]), n) for b in racs for n in range(1, len(b["passengers"]) + 1)] + mine
        assert sorted(x["position"] for x in everyone if x["status"] == "RAC") == list(range(1, RAC_PLACES + 1))
        poll(page, p2)
        advance(page, 3000)
        holds(page, role(page, "region", "RAC lane"), "RAC 11")
    await_mail(mail, f"Your status moved: PNR {racs[0]['pnr']}", f.email, count=2)
    await_mail(mail, f"Your status moved: PNR {p2}", w2.email)
    await_mail(mail, f"Your status moved: PNR {p3}", w3.email)
    assert mails(mail, f"Your status moved: PNR {racs[1]['pnr']}", f.email) == []


def test_wf_chart_prepared(browser):
    fast = os.environ["APP_FAST_CLOCK_URL"]
    c = charted(fast)
    with ui(browser, fast, f"/bookings/{c.pnr}", c.x.email) as page:
        shows(page, page.get_by_text(f"Chart at {c.at:%H:%M} IST, {long_date(c.at.date())}"))
        wait_business(fast, c.at)
        shows(page, page.get_by_role("heading", name="Chart prepared", level=2), seconds=MAIL_S)
        shows(page, page.get_by_text("Statuses are final. Berths no longer move.", exact=True))
        holds(page, passenger_item(page, 2), "NOT CNF", seconds=MAIL_S)
        holds(page, passenger_item(page, 2), "Not confirmed — refund issued", seconds=MAIL_S + SLACK_S)
        holds(page, passenger_item(page, 1), labels(c.xb)[0])
        shows(page, role(page, "link", "Download e-ticket v2 (after chart)"))
    assert get(c.x.c, c.pnr)["refunds"][0]["status"] == "issued"


def test_chart_freezes_run():
    fast = os.environ["APP_FAST_CLOCK_URL"]
    c = charted(fast)
    wait_business(fast, c.at)
    b = get(c.x.c, c.pnr)
    assert b["state"] == "chart_prepared" and b["chart_prepared"] is True
    assert labels(b) == [labels(c.xb)[0], "NOT CNF"] and cur(b, 2)["status"] == "CHART_NOT_CONFIRMED"
    freed = cur(c.cnf[0], 1)
    assert cancel(c.f.c, c.cnf[0]["pnr"], [1]).status_code == 201
    assert labels(get(c.x.c, c.pnr)) == [labels(c.xb)[0], "NOT CNF"]
    pub = httpx.get(f"{fast}/api/pnr/{c.pnr}", timeout=HTTP_S).json()
    assert pub["chart_prepared"] is True and [p["current_status"] for p in pub["passengers"]] == [labels(c.xb)[0], "NOT CNF"]
    plan = httpx.get(f"{fast}/api/trains/{c.s['train']}/runs/{c.s['run_date']}/coaches",
                     params={"class": "SL", "from": c.s["from"], "to": c.s["to"]}, timeout=HTTP_S).json()["coaches"]
    state = next(x["state"] for co in plan if co["coach"] == freed["coach"] for x in co["berths"] if x["berth"] == freed["berth"])
    assert state == "free"


def test_chart_refunds_waitlisted(killbill):
    fast = os.environ["APP_FAST_CLOCK_URL"]
    c = charted(fast)
    wait_business(fast, c.at)
    done = eventually(lambda: (lambda bb: bb if bb["cancellations"] and bb["refunds"] else None)(get(c.x.c, c.pnr)),
                      CHART_JOB_S + SLACK_S, "chart job")
    entry_ = done["cancellations"][0]
    assert entry_["requested_at"] == c.train["chart_at"] and entry_["refund_paise"] == c.each
    assert [(p["number"], p["band"], p["charge_paise"], p["gst_paise"], p["deduction_paise"], p["refund_paise"])
            for p in entry_["passengers"]] == [(2, "chart_full", 0, 0, 0, c.each)]
    assert [(r["reason"], r["refund_paise"]) for r in done["refunds"]] == [("chart", c.each)]
    eventually(lambda: get(c.x.c, c.pnr)["refunds"][0]["status"] == "issued", MAIL_S, "chart refund issued")
    refund = txn(killbill, c.pnr, f"{c.pnr}-refund-1")
    assert refund["transactionType"] == "REFUND" and refund["status"] == "SUCCESS" and paise(refund) == c.each


def test_chart_mail(mail):
    fast = os.environ["APP_FAST_CLOCK_URL"]
    c = charted(fast)
    wait_business(fast, c.at)
    body_text = text(await_mail(mail, f"Chart prepared: PNR {c.pnr}", c.x.email)[0])
    first = cur(c.xb, 1)
    assert re.search(rf"\b{first['coach']}\b\D{{0,12}}\b{first['berth']}\b", body_text), body_text
    assert "NOT CNF" in body_text or "not confirmed" in body_text.lower()


def test_chart_tickets_stay_as_issued():
    fast = os.environ["APP_FAST_CLOCK_URL"]
    store = S3("-fast")
    c = charted(fast)
    key = f"tickets/{c.pnr}/v1-booked.pdf"
    v1 = store.get(key)
    assert cancel(c.f.c, c.cnf[0]["pnr"], [1]).status_code == 201
    assert labels(get(c.x.c, c.pnr))[1].startswith("RAC ")
    assert store.get(key) == v1
    wait_business(fast, c.at)
    eventually(lambda: f"tickets/{c.pnr}/v2-chart.pdf" in store.keys(f"tickets/{c.pnr}/"), CHART_JOB_S + SLACK_S, "chart e-ticket")
    assert store.get(key) == v1 == c.x.c.get(f"/api/bookings/{c.pnr}/tickets/1").content
    assert c.x.c.get(f"/api/bookings/{c.pnr}/tickets/2").content == store.get(f"tickets/{c.pnr}/v2-chart.pdf")
    assert [(t["version"], t["kind"]) for t in get(c.x.c, c.pnr)["tickets"]] == [(1, "booked"), (2, "chart")]


def test_wf_chart_bookings_close(browser, killbill):
    fast = os.environ["APP_FAST_CLOCK_URL"]
    at, s, _ = chart_soon(fast)
    t = traveller(fast)
    with ui(browser, fast, book_path(s), t.email) as page:
        shows(page, role(page, "group", "Passenger 1"))
        enter_party(page, pax(1))
        wait_business(fast, at)
        pay(page, fare(km(s), "SL"))
        reads(page, role(page, "alert", "Booking problem"), "The chart for this train is prepared. Bookings are closed.")
    problem(book(t.c, s, pax(1)), "chart_prepared")
    tr, e = entry(fast, s)
    assert e["window"] == "chart_prepared" and tr["chart_prepared"] is True
    assert t.c.get("/api/bookings").json()["bookings"] == [] and paid(killbill, t.id) == []


ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def shipped():
    cwd = "/app" if Path("/app/node_modules").is_dir() else DEPLOYED
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd,
                         capture_output=True, text=True, timeout=600)
    found = {}

    def walk(node):
        for name, dep in (node.get("dependencies") or {}).items():
            if dep.get("version") and name not in found:
                found[name] = dep
                walk(dep)
    walk(json.loads(out.stdout or "{}"))
    return found


def test_if_run_manifest():
    j = json.loads(Path("/app/run.json").read_text())
    assert set(j) == {"_schema", "install", "build", "serve"} and j["_schema"] == "run-manifest-v1"
    assert all(isinstance(j[k], str) and j[k] for k in ("install", "build", "serve"))


def test_if_notices():
    notes = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [n for n in shipped() if n not in notes]
    assert not missing, missing
    for name in ("Archivo", "IBM Plex Sans", "JetBrains Mono", "Lucide"):
        assert name in notes, name


def test_if_licences():
    def ok(lic):
        lic = lic if isinstance(lic, str) else (lic or {}).get("type", "")
        ids = [x for x in re.findall(r"[A-Za-z0-9.\-]+", lic) if x not in ("OR", "AND", "WITH")]
        return bool(ids) and (any(i in ALLOWED for i in ids) if " OR " in lic else all(i in ALLOWED for i in ids))
    bad = {n: d.get("license") for n, d in shipped().items() if not ok(d.get("license"))}
    assert not bad, bad


def test_if_datastores():
    pkg = json.loads(Path("/app/package.json").read_text())
    deps = set(pkg.get("dependencies") or {})
    assert not deps & {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level"}, deps
    procs = " ".join(p.read_text(errors="ignore") for p in Path("/proc").glob("[0-9]*/comm") if p.is_file())
    assert "Redis".lower() not in procs.lower()
    stores = [p for p in Path(DEPLOYED).rglob("*") if p.suffix in {".sqlite", ".sqlite3", ".db"} and "node_modules" not in p.parts]
    assert not stores, stores


def test_if_service_config():
    log = Path("/logs/agent/trajectory.json")
    raw = log.read_text(errors="ignore") if log.exists() else ""
    for marker in ("ALTER USER", "ALTER ROLE", "DROP DATABASE", "mc admin user", "/1.0/kb/tenants"):
        assert marker not in raw, marker


def test_if_typescript_lockfile():
    assert Path("/app/package-lock.json").is_file()
    ts = [p for p in Path("/app").rglob("*.ts*") if "node_modules" not in p.parts and p.suffix in {".ts", ".tsx"}]
    assert ts


def test_if_no_third_party_hosts(app_url, browser):
    with ui(browser, app_url, "/") as page:
        urls = []
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", "/pnr", "/signin", "/register"):
            page.goto(app_url + path)
            advance(page, 1000)
        foreign = [u for u in urls if u.startswith("http") and not same_origin(u, app_url)]
        assert not foreign, foreign
