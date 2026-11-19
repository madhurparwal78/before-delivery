import csv
import hashlib
import importlib.metadata
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
import tomllib
import uuid
from contextlib import contextmanager
from datetime import date, datetime, time as dtime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError, expect

from conftest import (DEPLOYED_APP, S3, Postgres, addresses, advance, animations, axe, click, fill, held,
                      idempotency_key, layout, mail_from_address, open_app, same_origin, select, shipped_packages, tab_order, text)


APP = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")
LONDON = ZoneInfo("Europe/London")

UI_MS = 15000
RIVAL_PRESS_MS = 2000
HTTP_S = 30
SETTLE_S = 30
BOOT_S = 120
POLL_S = 0.25
COMMENT_GRACE_S = 5
OUTAGE_PORT = 9

TAB_EXTRA = 16
TRAP_PRESSES = 12

LIVE_FEED_S = 3
RETRY_S = 10
NOTICE_HOLD_MAX_S = 610
COMMENT_S = 15
SPLICE_MAX_MS = 1400
SEARCH_PAUSE_MS = 500
DEFER_DAYS = 7
DEFER_HOURS = 25.0
DUE_SOON_DAYS = 30
DUE_SOON_HOURS = 50.0
JSON_LIMIT = 65536
FILE_LIMIT = 5000000
IMPORT_LIMIT = 1000000
MAX_ROWS = 2000
MAX_RESULTS = 50
KEY_MAX = 100
REASON_MAX = 500
NOTES_MAX = 1000
TITLE_MAX = 200
DAYS_MAX = 3650
FH_MAX = 100000.0
RANGES_MAX = 20
TAP_MIN = 44
SEED_COUNTS = {"open": 20, "due_soon": 6, "overdue": 5, "deferred": 1, "complied": 4}
DESKTOP_DRAWER = (0.25, 0.42)
TABLET_DRAWER = (0.55, 0.8)
DUE_PROBE_DAY = date(2027, 7, 15)
ON_TIME_LEAD_S = 300
PROBE_DATE = "2026-01-10"
PROBE_DATE_2 = "2026-01-11"
R1_METHOD = "Probe R1 method"
R2_METHOD = "Probe R2 method"
PLAIN_NOTE = "plain probe"
FORMULA_NOTE = "=HYPERLINK(probe)"
UNKNOWN_TAIL = "G-ZZZZ"
AXE_PREFIX = "WCAG violations:"
AXE_BACKED = ("color-contrast", "aria-valid-attr", "aria-valid-attr-value", "aria-allowed-attr", "aria-allowed-role",
              "aria-roles", "aria-required-attr", "aria-required-children", "aria-required-parent",
              "aria-hidden-focus", "aria-command-name", "aria-input-field-name", "aria-meter-name",
              "aria-progressbar-name", "aria-toggle-field-name", "aria-dialog-name", "aria-tooltip-name")

ATR, DHC, ERJ = "ATR72-212A", "DHC-8-402", "ERJ-170-200"
MODEL_LABELS = {ATR: "ATR 72", DHC: "Dash 8-400", ERJ: "E175"}
COUNT_KEYS = ("open", "due_soon", "overdue", "deferred", "complied")
COUNT_WORDS = (("Open", "open"), ("Due soon", "due_soon"), ("Overdue", "overdue"), ("Deferred", "deferred"),
               ("Complied", "complied"))
CSV_COLUMNS = ["registration", "model", "msn", "directive", "revision", "title", "state", "governing_revision",
               "deadline_date", "fh_threshold", "governing", "inspector", "inspector_licence", "inspected_at",
               "certifier", "certifier_licence", "certified_at", "timeliness", "legacy_notes"]
HEADER = ["tail", "directive", "revision", "status", "inspector", "inspector_licence", "inspected_on", "certifier",
          "certifier_licence", "certified_on", "notes"]
AUTHORITY_MAIL = "continuing-airworthiness@caa-oversight.test"
OPERATOR = "Fenwick Regional Airways"
TOKEN = re.compile(r"^SIGNER-[0-9A-F]{8}$")
WORK_CARD = re.compile(r"^WC-\d{5}$")
ISO_MS = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")

USERS = {
    "avery.lund": ("saltmarsh-planner-1", "Avery Lund", "compliance_planner", False, None, "avery.lund@fenwick-regional.test"),
    "noor.haddad": ("saltmarsh-planner-2", "Noor Haddad", "compliance_planner", False, None, "noor.haddad@fenwick-regional.test"),
    "dara.okafor": ("saltmarsh-insp-1", "Dara Okafor", "licensed_inspector", False, "LIC-66-48213", "dara.okafor@fenwick-regional.test"),
    "sol.brennan": ("saltmarsh-insp-2", "Sol Brennan", "licensed_inspector", False, "LIC-66-51077", "sol.brennan@fenwick-regional.test"),
    "mika.hollis": ("saltmarsh-insp-3", "Mika Hollis", "licensed_inspector", True, "LIC-66-90412", "mika.hollis@hangarcrew.test"),
    "jun.teller": ("saltmarsh-insp-4", "Jun Teller", "licensed_inspector", True, "LIC-66-90655", "jun.teller@hangarcrew.test"),
    "ines.varga": ("saltmarsh-cert-1", "Ines Varga", "certifying_engineer", False, "LIC-66-30218", "ines.varga@fenwick-regional.test"),
    "tomasz.wilk": ("saltmarsh-cert-2", "Tomasz Wilk", "certifying_engineer", False, "LIC-66-30544", "tomasz.wilk@fenwick-regional.test"),
    "priya.raman": ("saltmarsh-cert-3", "Priya Raman", "certifying_engineer", False, "LIC-66-30981", "priya.raman@fenwick-regional.test"),
    "robin.achterberg": ("saltmarsh-records-1", "Robin Achterberg", "records_clerk", False, None, "robin.achterberg@fenwick-regional.test"),
    "casey.moreau": ("saltmarsh-audit-1", "Casey Moreau", "regulator_auditor", None, None, "casey.moreau@caa-oversight.test"),
}
SEED_SCOPES = {"ines.varga": [ATR, DHC], "tomasz.wilk": [ATR, ERJ], "priya.raman": [ERJ, DHC]}
ROLE_USERS = {"compliance_planner": "noor.haddad", "licensed_inspector": "sol.brennan",
              "certifying_engineer": "priya.raman", "records_clerk": "robin.achterberg"}

TAILS = {
    "G-FNAA": (ATR, 1102, 18420.3, 6.0), "G-FNAB": (ATR, 1118, 17985.0, 6.0), "G-FNAC": (ATR, 1135, 17210.6, 6.0),
    "G-FNAD": (ATR, 1149, 16844.2, 6.0), "G-FNAE": (ATR, 1163, 16102.9, 6.0), "G-FNAF": (ATR, 1180, 15577.4, 6.0),
    "G-FNAG": (ATR, 1196, 14930.1, 6.0), "G-FNAH": (ATR, 1211, 14288.8, 6.0), "G-FNAI": (ATR, 1227, 13650.5, 6.0),
    "G-FNAJ": (ATR, 1244, 12904.0, 6.0), "G-FNAK": (ATR, 1260, 12411.7, 6.0), "G-FNAL": (ATR, 1278, 11876.3, 6.0),
    "G-FNBA": (DHC, 4388, 24510.2, 7.0), "G-FNBB": (DHC, 4402, 23877.9, 7.0), "G-FNBC": (DHC, 4417, 23105.4, 7.0),
    "G-FNBD": (DHC, 4431, 22690.0, 7.0), "G-FNBE": (DHC, 4446, 21948.6, 7.0), "G-FNBF": (DHC, 4460, 21302.3, 7.0),
    "G-FNBG": (DHC, 4475, 20755.8, 7.0), "G-FNBH": (DHC, 4489, 20114.1, 7.0),
    "G-FNCA": (ERJ, 17000512, 21033.5, 8.0), "G-FNCB": (ERJ, 17000527, 20488.2, 8.0),
    "G-FNCC": (ERJ, 17000541, 19870.9, 8.0), "G-FNCD": (ERJ, 17000558, 19244.6, 8.0),
    "G-FNCE": (ERJ, 17000573, 18602.3, 8.0), "G-FNCF": (ERJ, 17000586, 17955.0, 8.0),
    "G-FNCG": (ERJ, 17000602, 17310.7, 8.0), "G-FNCH": (ERJ, 17000619, 16688.4, 8.0),
}

SEED_DIRECTIVES = {
    "2026-0142": ("EASA", "Main landing gear side brace lower link — detailed visual inspection", ATR, 1100, 1250, 20, 180, 600.0, 120.0,
                  "Inspect the lower link lugs for cracks using a 10x glass; replace the link if any crack is found."),
    "G-2026-0007": ("UK CAA", "Propeller de-icer boot bonding — detailed check", DHC, 4380, 4499, 160, 180, 900.0, 300.0,
                    "Check boot bond edges per the maintenance manual; repair any lift greater than 3 mm."),
    "E170-28-0042": ("Embraer", "Fuel quantity probe harness connector — replacement", ERJ, 17000500, 17000590, 200, 199, 1200.0, 100.0,
                     "Replace the connector with the improved part and perform a fuel quantity indication test."),
    "ATR72-27-1088": ("ATR", "Aileron trim tab actuator rod end — inspection", ATR, 1000, 1999, 5, 365, 2000.0, 30.0,
                      "Measure rod end play; replace the rod end if play exceeds the manual limit."),
}
SEED_STAGES = {
    "2026-0142": {"G-FNAA": ("certified", None), "G-FNAB": ("certified", None), "G-FNAC": ("inspected", None),
                  "G-FNAD": ("claimed", "Dara Okafor"), "G-FNAE": ("claimed", "Mika Hollis"),
                  **{f"G-FNA{c}": ("open", None) for c in "FGHIJ"}},
    "G-2026-0007": {"G-FNBA": ("certified", None), "G-FNBB": ("deferred", None), "G-FNBC": ("claimed", "Jun Teller"),
                    **{f"G-FNB{c}": ("open", None) for c in "DEFGH"}},
    "E170-28-0042": {"G-FNCA": ("certified", None), "G-FNCB": ("inspected", None),
                     **{f"G-FNC{c}": ("open", None) for c in "CDEF"}},
    "ATR72-27-1088": {f"G-FNA{c}": ("open", None) for c in "ABCDEFGHIJKL"},
}
BUSY_SCRIPT = """el => { window.__busy = []; new MutationObserver(() => window.__busy.push([document.timeline.currentTime,
  el.getAttribute('aria-busy')])).observe(el, {attributes: true, attributeFilter: ['aria-busy']}); }"""
FOCUS_SCRIPT = """el => { const a = document.activeElement; if (!a) return false; if (a === el || el.contains(a)) return true;
  const id = a.getAttribute('aria-activedescendant'); return !!id && (id === el.id || el.contains(document.getElementById(id))); }"""
MENU_FOCUS_SCRIPT = """el => { const a = document.activeElement; if (!a) return false; if (el.contains(a)) return true;
  const id = a.getAttribute('aria-activedescendant'); return !!id && el.contains(document.getElementById(id)); }"""


def ts(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso_ms(moment):
    u = moment.astimezone(timezone.utc)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"


def london(day, hour, minute, second=0):
    return datetime.combine(day, dtime(hour, minute, second), LONDON)


def poll(fn, seconds, what):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        threading.Event().wait(POLL_S)
    value = fn()
    assert value, f"timed out after {seconds}s waiting for {what}"
    return value


class Api:
    def __init__(self, base, username=None):
        self.base = base.rstrip("/")
        self.client = httpx.Client(base_url=self.base, timeout=HTTP_S)
        self.user = None
        if username:
            r = self.client.post("/api/session", json={"username": username, "passcode": USERS[username][0]})
            assert r.status_code == 200, (username, r.status_code, r.text)
            self.user = r.json()["user"]

    def call(self, method, path, body=None, key=None, raw=None, ctype=None, headers=None, **params):
        h = dict(headers or {})
        if key is not None:
            h["Idempotency-Key"] = key
        if raw is not None:
            h["Content-Type"] = ctype
            return self.client.request(method, path, content=raw, headers=h, params=params or None)
        if body is not None:
            return self.client.request(method, path, json=body, headers=h, params=params or None)
        return self.client.request(method, path, headers=h, params=params or None)

    def get(self, path, **params):
        r = self.call("GET", path, **params)
        assert r.status_code == 200, (path, r.status_code, r.text)
        return r.json()

    def ok(self, method, path, body=None, key=None, **kw):
        r = self.call(method, path, body, key=key, **kw)
        assert r.status_code in (200, 201, 202), (method, path, r.status_code, r.text)
        return r.json()


def err(r, status_code, code, context=""):
    assert r.status_code == status_code, (context, r.status_code, r.text)
    assert r.headers.get("content-type", "").startswith("application/json"), (context, r.headers)
    body = r.json()
    assert set(body) == {"error"}, (context, body)
    e = body["error"]
    assert e["code"] == code and isinstance(e["message"], str) and e["message"], (context, body)
    return e


def now(api):
    return ts(api.get("/api/board")["generated_at"])


def today(api):
    return now(api).astimezone(LONDON).date()


def number_for(authority):
    n = uuid.uuid4().int
    a, b, c = n % 10000, (n // 10 ** 4) % 10000, (n // 10 ** 8) % 100
    return {"EASA": f"{a:04d}-{b:04d}", "UK CAA": f"G-{a:04d}-{b:04d}", "ATR": f"ATR72-{c:02d}-{b:04d}",
            "De Havilland": f"84-{c:02d}-{b:04d}", "Embraer": f"E170-{c:02d}-{b:04d}"}[authority]


def pdf_bytes():
    return b"%PDF-1.4\n% probe " + uuid.uuid4().hex.encode() + b"\n%%EOF\n"


def jpeg_bytes():
    return b"\xff\xd8\xff\xe0probe" + uuid.uuid4().hex.encode() + b"\xff\xd9"


def png_bytes():
    return b"\x89PNG\r\n\x1a\nprobe" + uuid.uuid4().hex.encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def upload(api, data=None):
    r = api.call("POST", "/api/documents", raw=data or pdf_bytes(), ctype="application/pdf")
    assert r.status_code in (200, 201), r.text
    return r.json()


def directive_body(api, ranges, title, days, fh, effective, method):
    return {"title": title, "document_id": upload(api)["document_id"],
            "effective_date": str(effective or today(api)), "calendar_days": days, "fh_interval": fh,
            "applicability": [{"model": m, "msn_from": a, "msn_to": b} for m, a, b in ranges], "method": method}


def ingest(api, ranges, title=None, days=365, fh=600.0, effective=None, number=None, authority="EASA",
           method="Probe method of compliance"):
    body = directive_body(api, ranges, title or f"Probe directive {uuid.uuid4().hex[:8]}", days, fh, effective, method)
    body.update(authority=authority, number=number or number_for(authority))
    r = api.call("POST", "/api/directives", body)
    assert r.status_code == 201, r.text
    j = r.json()
    return j["directive"], j["splice"]


def revise(api, did, ranges, title=None, days=180, fh=300.0, effective=None, credit=False,
           method="Probe revised method"):
    cur = api.get(f"/api/directives/{did}")["directive"]
    body = directive_body(api, ranges, title or f"{cur['title'][:150]} revised", days, fh, effective, method)
    body.update(revision=int(cur["revision"][1:]) + 1, prior_credit=credit)
    r = api.call("POST", f"/api/directives/{did}/revisions", body)
    assert r.status_code == 201, r.text
    j = r.json()
    return j["directive"], j["splice"]


def withdraw(api, did, reason="Probe withdrawal"):
    return api.ok("POST", f"/api/directives/{did}/withdrawal", {"reason": reason})["directive"]


def dname(d):
    return f"{d['authority']} {d['number']}"


def threads(api, did):
    return {t["registration"]: t for t in api.get("/api/threads", directive_id=did)["threads"]}


def thread(api, tid):
    return api.get(f"/api/threads/{tid}")["thread"]


def board_column(api, did):
    b = api.get("/api/board", directive_id=did)
    entry = next(x for x in b["directives"] if x["id"] == did)
    return b, entry, [c for c in b["cells"] if c["directive_id"] == did]


def person(api, username):
    return next(p for p in api.get("/api/people")["people"] if p["username"] == username)


def scopes(clerk, mapping):
    for username, models in mapping.items():
        clerk.ok("PUT", f"/api/engineers/{person(clerk, username)['id']}/scope", {"models": models})


def tail_key(tail):
    return re.sub(r"[-\s]", "", tail).upper()


def note_in_cell(cell, note):
    assert note in cell and cell[:1] not in ("=", "+", "-", "@", "\t", "\r"), (cell, note)


def date_pattern(iso):
    day = date.fromisoformat(iso)
    month, name = day.strftime("%b"), day.strftime("%B")
    return re.compile(rf"{iso}|\b0?{day.day} (?:{month}|{name}),? {day.year}\b|\b(?:{month}|{name}) 0?{day.day},? {day.year}\b")


def tail_total(api, reg):
    return next(t for t in api.get("/api/tails")["tails"] if t["registration"] == reg)["total_hours"]


def log_hours(api, reg, hours):
    r = api.call("POST", f"/api/tails/{reg}/flight-hours", {"hours": hours})
    assert r.status_code == 201, r.text
    return r.json()


def claim(api, tid, key=None):
    return api.call("POST", f"/api/threads/{tid}/claim", {}, key=key or idempotency_key())


def attach(api, tid, data=None, ctype="image/jpeg"):
    r = api.call("POST", f"/api/threads/{tid}/evidence", raw=data or jpeg_bytes(), ctype=ctype)
    assert r.status_code == 201, r.text
    return r.json()["evidence"]


def sign(api, tid, revision, evidence_ids, key=None, **extra):
    body = {"revision": revision, "method_ref": "AMM task", "findings": "No defects found",
            "evidence_ids": evidence_ids, **extra}
    return api.call("POST", f"/api/threads/{tid}/inspection", body, key=key or idempotency_key())


def inspect(api, tid):
    assert claim(api, tid).status_code == 200
    ev = attach(api, tid)
    r = sign(api, tid, thread(api, tid)["revision"], [ev["id"]])
    assert r.status_code == 201, r.text
    return r.json()


def countersign(api, tid, revision="R1", key=None):
    return api.call("POST", f"/api/threads/{tid}/countersign", {"revision": revision}, key=key or idempotency_key())


def certify(inspector, certifier, tid):
    inspect(inspector, tid)
    r = countersign(certifier, tid, thread(certifier, tid)["revision"])
    assert r.status_code == 201, r.text
    return r.json()["thread"]


def defer(api, tid, reason="Awaiting de-icer boot kit", key=None):
    return api.call("POST", f"/api/threads/{tid}/deferral", {"reason": reason}, key=key or idempotency_key())


def effectivity(api, tid, decision="confirmed", reason="Serial checked against the revision"):
    return api.call("POST", f"/api/threads/{tid}/effectivity", {"decision": decision, "reason": reason})


def legacy_row(tail, directive, revision, status="open", **fields):
    row = {"tail": tail, "directive": directive, "revision": revision, "status": status,
           "inspector": "Ana Probe", "inspector_licence": "LIC-PROBE-1", "inspected_on": "",
           "certifier": "Ben Probe", "certifier_licence": "LIC-PROBE-2", "certified_on": "", "notes": ""}
    if status.lower() == "complied":
        row.update(inspected_on=PROBE_DATE, certified_on=PROBE_DATE_2)
    row.update(fields)
    return row


def import_csv(rows, header=HEADER):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=header, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue().encode("utf-8")


def run_import(clerk, data, key=None):
    r = clerk.call("POST", "/api/imports", raw=data, ctype="text/csv", key=key or idempotency_key())
    assert r.status_code in (200, 201), r.text
    return r.json()


def imports_with(api, data):
    return [i for i in api.get("/api/imports")["imports"] if i["file_sha256"] == sha(data)]


def export(api, did):
    r = api.call("GET", f"/api/directives/{did}/export.csv")
    assert r.status_code == 200, r.text
    return r, list(csv.DictReader(io.StringIO(r.content.decode("utf-8"), newline="")))


def pack_mails(mail, pack_id):
    return [m for m in mail.messages() if m["Subject"].startswith("Compliance pack") and pack_id in text(m)]


def notices_for(api, subject):
    return [n for n in api.get("/api/notices")["notices"] if n["subject"] == subject]


def recount(api, did):
    at = ts(api.get("/api/board", directive_id=did)["generated_at"])
    counts = dict.fromkeys(COUNT_KEYS, 0)
    for t in api.get("/api/threads", directive_id=did)["threads"]:
        if t["stage"] in ("not_applicable", "withdrawn"):
            continue
        if t["stage"] == "certified":
            counts["complied"] += 1
        elif t["state"] == "overdue":
            counts["overdue"] += 1
        elif t["stage"] == "deferred":
            counts["deferred"] += 1
        elif ts(t["limits"]["due_soon_from"]) <= at:
            counts["due_soon"] += 1
        else:
            counts["open"] += 1
    return counts


def counts_of(**nonzero):
    return {k: nonzero.get(k, 0) for k in COUNT_KEYS}


def store(kind):
    db = os.environ["DATABASE_URL"]
    if kind == "minio_down":
        return {"DATABASE_URL": db + "_minio_down", "S3_ENDPOINT": f"http://127.0.0.1:{OUTAGE_PORT}"}
    return {"DATABASE_URL": db + "_mailpit_down", "S3_BUCKET": os.environ["S3_BUCKET"] + "-mailpit-down",
            "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(OUTAGE_PORT)}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def app_copy(env, clock=None):
    port = free_port()
    full = {**os.environ, **env, "APP_PUBLIC_PORT": str(port)}
    full.pop("TAILBOARD_CLOCK_START", None)
    if clock:
        full["TAILBOARD_CLOCK_START"] = clock
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=full, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail_log():
        log.flush()
        return Path(log.name).read_text()[-4000:]

    def healthy():
        assert proc.poll() is None, f"app copy exited:\n{tail_log()}"
        try:
            return httpx.get(base + "/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False
    try:
        poll(healthy, BOOT_S, "app copy health")
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=SETTLE_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


@contextmanager
def relay(host, port):
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", OUTAGE_PORT))
    srv.listen(16)
    conns = []

    def pump(a, b):
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def serve():
        while srv.fileno() != -1:
            try:
                c, _ = srv.accept()
            except OSError:
                return
            try:
                u = socket.create_connection((host, port), timeout=HTTP_S)
            except OSError:
                c.close()
                continue
            u.settimeout(None)
            conns.extend([c, u])
            threading.Thread(target=pump, args=(c, u), daemon=True).start()
            threading.Thread(target=pump, args=(u, c), daemon=True).start()
    threading.Thread(target=serve, daemon=True).start()
    try:
        yield
    finally:
        try:
            srv.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        srv.close()
        for s in conns:
            try:
                s.close()
            except OSError:
                pass


def btn(scope, name):
    return scope.get_by_role("button", name=name, exact=True)


def status(page):
    return page.get_by_role("status", name="Action status")


def alert(page):
    return page.get_by_role("alert", name="Action error")


def grid(page):
    return page.get_by_role("grid", name="Compliance matrix")


def header(page, dn, tag=None, hidden=False):
    return page.get_by_role("columnheader", include_hidden=hidden,
                            name=re.compile("^" + re.escape(f"{dn} ") + (re.escape(tag) if tag else r"R\d+")))


def cell(page, reg, dn, tag=None, label=None, hidden=False):
    pattern = "^" + re.escape(f"{reg} {dn} ") + (re.escape(tag) if tag else r"R\d+") + ":"
    if label:
        pattern += re.escape(f" {label}") + "(,|$)"
    return page.get_by_role("gridcell", name=re.compile(pattern), include_hidden=hidden)


def choose(locator, *labels):
    for i, label in enumerate(labels):
        try:
            select(locator, label)
            return
        except Exception:
            if i == len(labels) - 1:
                raise


def sign_in(page, username):
    form = page.get_by_role("form", name="Sign in")
    fill(form.get_by_role("textbox", name="Username"), username)
    fill(form.get_by_label("Passcode"), USERS[username][0])
    click(btn(form, "Sign in"))
    expect(page.get_by_role("banner")).to_contain_text(USERS[username][1], timeout=UI_MS)


@contextmanager
def board(browser, url, username, width=1280, height=800, reduced="no-preference"):
    with open_app(browser, url, reduced_motion=reduced) as page:
        page.clock.resume()
        page.set_viewport_size({"width": width, "height": height})
        sign_in(page, username)
        expect(grid(page)).to_be_visible(timeout=UI_MS)
        yield page


def drawer(page, reg, dn):
    click(cell(page, reg, dn).first)
    dlg = page.get_by_role("dialog", name=f"Thread {reg} {dn}")
    expect(dlg).to_be_visible(timeout=UI_MS)
    return dlg


def view_under(page, dn, tag):
    hdr = header(page, dn)
    inner = hdr.get_by_role("button", name=f"View under {tag}")
    if inner.count():
        return inner.first
    hdr.first.scroll_into_view_if_needed()
    box = hdr.first.bounding_box()
    found = page.get_by_role("button", name=f"View under {tag}")
    for i in range(found.count()):
        b = found.nth(i).bounding_box()
        if b and b["x"] < box["x"] + box["width"] and b["x"] + b["width"] > box["x"]:
            return found.nth(i)
    raise AssertionError(f"no View under {tag} behind {dn}")


def fill_directive(dlg, *, title, effective, days, fh, method, model, first, last, document, authority=None,
                   number=None):
    if authority:
        choose(dlg.get_by_role("combobox", name="Authority"), authority)
    if number is not None:
        fill(dlg.get_by_role("textbox", name="Directive number"), number)
    fill(dlg.get_by_role("textbox", name="Title"), title)
    fill(dlg.get_by_role("textbox", name="Effective date"), effective)
    fill(dlg.get_by_role("spinbutton", name="Calendar limit in days"), str(days))
    fill(dlg.get_by_role("spinbutton", name="Flight-hours limit"), str(fh))
    fill(dlg.get_by_role("textbox", name="Method of compliance"), method)
    group = dlg.get_by_role("group", name="Applicability")
    if not group.get_by_role("combobox", name="Model").count():
        click(btn(group, "Add range"))
    choose(group.get_by_role("combobox", name="Model").first, MODEL_LABELS[model], model)
    fill(group.get_by_role("spinbutton", name="First serial").first, str(first))
    fill(group.get_by_role("spinbutton", name="Last serial").first, str(last))
    dlg.get_by_label("Directive document").set_input_files(
        {"name": "directive.pdf", "mimeType": "application/pdf", "buffer": document})


def fleet_count(page, word, hidden=False):
    group = page.get_by_role("group", name="Fleet counts", include_hidden=hidden)
    found = re.search(re.escape(word) + r"\s+(\d+)", group.inner_text())
    assert found, word
    return int(found.group(1))


def focused_on(locator):
    poll(lambda: locator.evaluate(FOCUS_SCRIPT), UI_MS / 1000, "keyboard focus on the element")


def write_actions(planner, clerk, d, t):
    aa, ab, ac, ad = (t[r]["id"] for r in ("G-FNAA", "G-FNAB", "G-FNAC", "G-FNAD"))
    doc = upload(planner)["document_id"]
    ines, dara = person(clerk, "ines.varga")["id"], person(clerk, "dara.okafor")["id"]
    fresh = {"authority": "EASA", "number": number_for("EASA"), "title": "Probe refused", "document_id": doc,
             "effective_date": today(planner).isoformat(), "calendar_days": 30, "fh_interval": 100.0,
             "applicability": [{"model": ATR, "msn_from": 1100, "msn_to": 1110}], "method": "Probe"}
    revision = {k: v for k, v in fresh.items() if k not in ("authority", "number")}
    revision.update(revision=2, prior_credit=False)
    history = import_csv([legacy_row("G-FNAA", d["number"], "R1")])
    sig = {"revision": "R1", "method_ref": "AMM task", "findings": "No defects found",
           "evidence_ids": [e["id"] for e in t["G-FNAC"]["evidence"]]}

    def post(path, body=None, raw=None, ctype=None, keyed=False):
        return lambda api: api.call("POST", path, body, key=idempotency_key() if keyed else None, raw=raw, ctype=ctype)
    planner_role, inspector, engineer, records = "compliance_planner", "licensed_inspector", "certifying_engineer", "records_clerk"
    actions = [
        ("upload document", planner_role, post("/api/documents", raw=pdf_bytes(), ctype="application/pdf")),
        ("ingest directive", planner_role, post("/api/directives", fresh)),
        ("ingest revision", planner_role, post(f"/api/directives/{d['id']}/revisions", revision)),
        ("withdraw", planner_role, post(f"/api/directives/{d['id']}/withdrawal", {"reason": "Probe"})),
        ("defer", planner_role, post(f"/api/threads/{aa}/deferral", {"reason": "Probe"}, keyed=True)),
        ("effectivity", planner_role, post(f"/api/threads/{aa}/effectivity", {"decision": "confirmed", "reason": "Probe"})),
        ("log hours", planner_role, post("/api/tails/G-FNAA/flight-hours", {"hours": 0.1})),
        ("claim", inspector, post(f"/api/threads/{aa}/claim", {}, keyed=True)),
        ("release", "holder", post(f"/api/threads/{ab}/release", {})),
        ("attach evidence", "holder", post(f"/api/threads/{ab}/evidence", raw=jpeg_bytes(), ctype="image/jpeg")),
        ("sign inspection", "holder", post(f"/api/threads/{ab}/inspection", sig, keyed=True)),
        ("countersign", engineer, post(f"/api/threads/{ac}/countersign", {"revision": "R1"}, keyed=True)),
        ("import", records, post("/api/imports", raw=history, ctype="text/csv", keyed=True)),
        ("reopen", records, post(f"/api/threads/{ad}/reopen", {"reason": "Probe"})),
        ("scope", records, lambda api: api.call("PUT", f"/api/engineers/{ines}/scope", {"models": SEED_SCOPES["ines.varga"]})),
        ("erase", records, post(f"/api/people/{dara}/erasure", {"reason": "Probe"})),
        ("pack", records, post("/api/packs", {"directive_id": d["id"]}, keyed=True)),
    ]
    return actions, fresh["number"], history


def footprint(api, d):
    t = threads(api, d["id"])
    rows = tuple((r, t[r]["stage"], (t[r]["work_card"]["holder"] or {}).get("id"), len(t[r]["signatures"]),
                  len(t[r]["evidence"]), t[r]["deferral"] is None) for r in ("G-FNAA", "G-FNAB", "G-FNAC", "G-FNAD"))
    cur = api.get(f"/api/directives/{d['id']}")["directive"]
    people = {p["username"]: (p["erased"], tuple(sorted(p["scope"] or []))) for p in api.get("/api/people")["people"]}
    packs = sum(1 for p in api.get("/api/packs")["packs"] if p["directive_id"] == d["id"])
    return rows, cur["revision"], cur["status"], round(tail_total(api, "G-FNAA"), 1), people["ines.varga"], people["dara.okafor"], packs


def permission_setup(app_url):
    planner, dara, tomasz, clerk = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "tomasz.wilk", "robin.achterberg"))
    d, _ = ingest(planner, [(ATR, 1100, 1149)])
    t = threads(planner, d["id"])
    assert claim(dara, t["G-FNAB"]["id"]).status_code == 200
    inspect(dara, t["G-FNAC"]["id"])
    certify(dara, tomasz, t["G-FNAD"]["id"])
    return planner, clerk, d, threads(planner, d["id"])


def test_health_and_shell(app_url):
    r = httpx.get(app_url + "/api/health", timeout=HTTP_S)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    assert r.json() == {"status": "ok"}
    shell = httpx.get(app_url + "/", timeout=HTTP_S)
    assert shell.status_code == 200 and shell.headers["content-type"].startswith("text/html")
    assert Api(app_url, "avery.lund").user["role"] == "compliance_planner"


def test_seed_on_fresh_store():
    base = os.environ["APP_MINIO_DOWN_URL"]
    api = Api(base, "robin.achterberg")
    people = {p["username"]: p for p in api.get("/api/people")["people"]}
    assert set(people) == set(USERS)
    for username, (_, display, role, contractor, licence, email) in USERS.items():
        p = people[username]
        assert (p["display_name"], p["role"], p["licence"], p["email"], p["erased"]) == (display, role, licence, email, False)
        if contractor is not None:
            assert p["contractor"] is contractor, username
        assert (sorted(p["scope"]) if p["scope"] is not None else None) == (sorted(SEED_SCOPES[username]) if username in SEED_SCOPES else None)
    tails = {t["registration"]: t for t in api.get("/api/tails")["tails"]}
    assert set(tails) == set(TAILS)
    for reg, (model, msn, total, util) in TAILS.items():
        t = tails[reg]
        assert (t["model"], t["msn"], round(t["total_hours"], 1), t["daily_utilisation"]) == (model, msn, total, util), reg
    directives = {d["number"]: d for d in api.get("/api/directives")["directives"]}
    assert set(directives) == set(SEED_DIRECTIVES)
    seed_day = date.fromisoformat(directives["2026-0142"]["revisions"][0]["effective_date"]) + timedelta(days=20)
    for number, (authority, title, model, lo, hi, back, days, fh, minus, method) in SEED_DIRECTIVES.items():
        d = directives[number]
        assert (d["authority"], d["title"], d["revision"], d["status"]) == (authority, title, "R1", "active")
        (rev,) = d["revisions"]
        assert (rev["method"], rev["calendar_days"], rev["fh_interval"], rev["prior_credit"], rev["document_key"]) == (method, days, fh, False, None)
        assert rev["effective_date"] == (seed_day - timedelta(days=back)).isoformat()
        assert [(a["model"], a["msn_from"], a["msn_to"]) for a in rev["applicability"]] == [(model, lo, hi)]
        got = threads(api, d["id"])
        assert set(got) == set(SEED_STAGES[number]), number
        for reg, (stage, holder) in SEED_STAGES[number].items():
            t = got[reg]
            assert t["stage"] == stage and t["revision"] == "R1", (number, reg)
            if holder:
                assert (t["work_card"]["holder"] or {}).get("display_name") == holder, (number, reg)
            assert round(t["limits"]["fh_baseline"], 1) == round(TAILS[reg][2] - minus, 1), (number, reg)
            assert WORK_CARD.match(t["work_card"]["id"])
            for s in t["signatures"]:
                assert s["status"] == "valid"
            for s in (sig for sig in t["signatures"] if sig["kind"] == "inspection"):
                assert (s["method_ref"], s["findings"], s["timeliness"]) == ("AMM task", "No defects found", "on_time")
            assert t["evidence"] == []
    aa = threads(api, directives["2026-0142"]["id"])["G-FNAA"]
    assert [(s["kind"], s["signer"]["display_name"], ts(s["committed_at"])) for s in aa["signatures"]] == [
        ("inspection", "Dara Okafor", london(seed_day - timedelta(days=10), 10, 0)),
        ("countersignature", "Ines Varga", london(seed_day - timedelta(days=10), 14, 0))]
    ac = threads(api, directives["2026-0142"]["id"])["G-FNAC"]
    assert ac["certifier"]["assigned"]["display_name"] == "Ines Varga" and ac["certifier"]["status"] == "awaiting_countersignature"
    bb = threads(api, directives["G-2026-0007"]["id"])["G-FNBB"]
    assert bb["deferral"]["granted_by"]["display_name"] == "Avery Lund" and bb["deferral"]["reason"] == "Awaiting de-icer boot kit"
    assert ts(bb["deferral"]["granted_at"]) == london(seed_day - timedelta(days=1), 16, 0)
    cb = threads(api, directives["E170-28-0042"]["id"])["G-FNCB"]
    assert cb["certifier"]["assigned"]["display_name"] == "Tomasz Wilk"
    assert api.get("/api/board")["totals"] == SEED_COUNTS
    assert api.get("/api/notices")["notices"] == [] and api.get("/api/imports")["imports"] == []
    assert Postgres("_minio_down").tables()
    with app_copy(store("minio_down")) as again:
        second = Api(again, "robin.achterberg")
        assert len(second.get("/api/people")["people"]) == len(USERS)
        assert len(second.get("/api/directives")["directives"]) == len(SEED_DIRECTIVES)
        assert len(second.get("/api/threads")["threads"]) == sum(len(v) for v in SEED_STAGES.values())
        assert second.get("/api/board")["totals"] == SEED_COUNTS


def test_outage_boot_and_recovery():
    for env in ("APP_MINIO_DOWN_URL", "APP_MAILPIT_DOWN_URL"):
        base = os.environ[env]
        r = httpx.get(base + "/api/health", timeout=HTTP_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert httpx.get(base + "/", timeout=HTTP_S).headers["content-type"].startswith("text/html")
        b = Api(base, "avery.lund").get("/api/board")
        assert len(b["directives"]) >= len(SEED_DIRECTIVES) and b["cells"]
    base = os.environ["APP_MINIO_DOWN_URL"]
    planner, dara = Api(base, "avery.lund"), Api(base, "dara.okafor")
    data = pdf_bytes()
    err(planner.call("POST", "/api/documents", raw=data, ctype="application/pdf"), 503, "storage_unavailable")
    did = next(d["id"] for d in planner.get("/api/directives")["directives"] if d["number"] == "ATR72-27-1088")
    tid = threads(planner, did)["G-FNAJ"]["id"]
    try:
        assert claim(dara, tid).status_code == 200
        assert thread(planner, tid)["work_card"]["holder"]["display_name"] == "Dara Okafor"
    finally:
        dara.call("POST", f"/api/threads/{tid}/release", {})
    target = urlparse(os.environ["S3_ENDPOINT"])
    with relay(target.hostname, target.port or 80):
        doc = poll(lambda: (r := planner.call("POST", "/api/documents", raw=data, ctype="application/pdf")).status_code in (200, 201) and r.json(),
                   RETRY_S + SETTLE_S, "document storage to recover")
    assert doc["sha256"] == sha(data) and S3().get(doc["key"]) == data


def test_server_boundary(app_url):
    anon = Api(app_url)
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    body = {"username": "probe", "passcode": ""}
    body["passcode"] = "x" * (JSON_LIMIT - len(json.dumps(body).encode()))
    exact = json.dumps(body).encode()
    assert len(exact) == JSON_LIMIT
    err(anon.call("POST", "/api/session", raw=exact, ctype="application/json"), 401, "bad_credentials")
    body["passcode"] += "x"
    err(anon.call("POST", "/api/session", raw=json.dumps(body).encode(), ctype="application/json"), 413, "payload_too_large")
    err(anon.call("POST", "/api/threads/probe/claim", raw=b"{}", ctype="text/plain"), 415, "unsupported_media_type")
    big = b"%PDF-" + uuid.uuid4().hex.encode()
    big += b"0" * (FILE_LIMIT - len(big))
    assert planner.call("POST", "/api/documents", raw=big, ctype="application/pdf").status_code in (200, 201)
    err(planner.call("POST", "/api/documents", raw=big + b"0", ctype="application/pdf"), 413, "payload_too_large")
    err(planner.call("POST", "/api/documents", raw=pdf_bytes(), ctype="image/png"), 415, "unsupported_media_type")
    clerk = Api(app_url, "robin.achterberg")
    err(clerk.call("POST", "/api/imports", raw=b"t" * (IMPORT_LIMIT + 1), ctype="text/csv", key=idempotency_key()), 413, "payload_too_large")
    d, _ = ingest(planner, [(ATR, 1100, 1118)])
    t = threads(planner, d["id"])
    aa, ab = t["G-FNAA"]["id"], t["G-FNAB"]["id"]
    assert claim(dara, ab).status_code == 200
    err(dara.call("POST", f"/api/threads/{ab}/evidence", raw=b"x" * (FILE_LIMIT + 1), ctype="image/jpeg"), 413, "payload_too_large")
    err(dara.call("POST", f"/api/threads/{ab}/evidence", raw=b"plain", ctype="text/plain"), 415, "unsupported_media_type")
    err(planner.call("POST", f"/api/threads/{aa}/deferral", raw=b'{"reason":"x"}', ctype="text/plain", key=idempotency_key()), 415, "unsupported_media_type")
    foreign = {"Origin": "http://foreign.invalid"}
    err(planner.call("POST", f"/api/threads/{aa}/deferral", {"reason": "Probe"}, key=idempotency_key(), headers=foreign), 403, "forbidden")
    assert thread(planner, aa)["stage"] == "open"
    own = {"Origin": f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"}
    assert planner.call("POST", f"/api/threads/{aa}/deferral", {"reason": "Probe"}, key=idempotency_key(), headers=own).status_code == 201
    err(planner.call("GET", "/api/no-such-route-probe"), 404, "not_found")
    err(planner.call("DELETE", "/api/health"), 405, "method_not_allowed")
    shell = httpx.get(app_url + "/board-probe-page", timeout=HTTP_S)
    assert shell.status_code == 200 and shell.headers["content-type"].startswith("text/html")
    sources = [p.relative_to(DEPLOYED_APP).as_posix() for p in Path(DEPLOYED_APP).rglob("*.py")
               if ".venv" not in p.parts and "node_modules" not in p.parts][:30]
    secrets = [os.environ.get(k) for k in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    for path in ["run.json", ".env", ".venv/pyvenv.cfg", "requirements.txt", *sources]:
        r = httpx.get(f"{app_url}/{path}", timeout=HTTP_S)
        assert r.status_code in (200, 404), path
        if r.status_code == 200:
            assert r.headers["content-type"].startswith("text/html"), path
            assert "run-manifest-v1" not in r.text, path
        assert not any(s and s in r.text for s in secrets), path


PRECEDENCE_ROUTES = {
    "claim": ("POST", "/api/threads/{id}/claim", True),
    "release": ("POST", "/api/threads/{id}/release", False),
    "inspection": ("POST", "/api/threads/{id}/inspection", True),
    "countersign": ("POST", "/api/threads/{id}/countersign", True),
    "deferral": ("POST", "/api/threads/{id}/deferral", True),
    "effectivity": ("POST", "/api/threads/{id}/effectivity", False),
    "reopen": ("POST", "/api/threads/{id}/reopen", False),
    "revisions": ("POST", "/api/directives/{id}/revisions", False),
    "withdrawal": ("POST", "/api/directives/{id}/withdrawal", False),
    "erasure": ("POST", "/api/people/{id}/erasure", False),
    "scope": ("PUT", "/api/engineers/{id}/scope", False),
}
PRECEDENCE_CASES = [
    "chain",
    "control-byte-ids",
    "claim-nonuuid", "claim-absent",
    "release-nonuuid", "release-absent",
    "inspection-nonuuid", "inspection-absent",
    "countersign-nonuuid", "countersign-absent",
    "deferral-nonuuid", "deferral-absent",
    "effectivity-nonuuid", "effectivity-absent",
    "reopen-nonuuid", "reopen-absent",
    "revisions-nonuuid", "revisions-absent",
    "withdrawal-nonuuid", "withdrawal-absent",
    "erasure-nonuuid", "erasure-absent",
    "scope-nonuuid", "scope-absent",
]
NON_UUID = "not-a-uuid"


CONTROL_BYTE_IDS = ["%00", "probe%00id"]


def control_byte_ids_not_found(api, method, template, keyed=False, raw=None, ctype=None):
    for ident in CONTROL_BYTE_IDS:
        path = template.replace("{id}", ident)
        kw = {"key": idempotency_key()} if keyed else {}
        if raw is not None:
            r = api.call(method, path, raw=raw, ctype=ctype, **kw)
        else:
            r = api.call(method, path, None if method == "GET" else {}, **kw)
        err(r, 404, "not_found", path)


def test_countersign_control_byte_ids(app_url):
    for user in ("ines.varga", "casey.moreau"):
        control_byte_ids_not_found(Api(app_url, user), "POST", "/api/threads/{id}/countersign", keyed=True)


def test_scope_change_control_byte_ids(app_url):
    for user in ("robin.achterberg", "casey.moreau"):
        control_byte_ids_not_found(Api(app_url, user), "PUT", "/api/engineers/{id}/scope")


def test_pack_control_byte_ids(app_url):
    api = Api(app_url, "casey.moreau")
    for template in ("/api/packs/{id}", "/api/packs/{id}/pdf", "/api/packs/{id}/csv"):
        control_byte_ids_not_found(api, "GET", template)


@pytest.mark.parametrize("case", PRECEDENCE_CASES, ids=PRECEDENCE_CASES)
def test_error_shape_and_precedence(app_url, case):
    if case == "control-byte-ids":
        api = Api(app_url, "casey.moreau")
        for template in ("/api/directives/{id}", "/api/directives/{id}/export.csv", "/api/threads/{id}"):
            control_byte_ids_not_found(api, "GET", template)
        for method, template, keyed in PRECEDENCE_ROUTES.values():
            if template not in ("/api/threads/{id}/countersign", "/api/engineers/{id}/scope"):
                control_byte_ids_not_found(api, method, template, keyed=keyed)
        control_byte_ids_not_found(api, "POST", "/api/tails/{id}/flight-hours")
        control_byte_ids_not_found(api, "POST", "/api/threads/{id}/evidence", raw=b"\x89PNG", ctype="image/png")
        return
    if case != "chain":
        route, shape = case.rsplit("-", 1)
        method, template, keyed = PRECEDENCE_ROUTES[route]
        ident = NON_UUID if shape == "nonuuid" else str(uuid.uuid4())
        casey = Api(app_url, "casey.moreau")
        kw = {"key": idempotency_key()} if keyed else {}
        err(casey.call(method, template.replace("{id}", ident), {}, **kw), 404, "not_found")
        return
    planner, dara, sol, casey = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "sol.brennan", "casey.moreau"))
    anon = Api(app_url)
    d, _ = ingest(planner, [(ATR, 1100, 1135)])
    t = threads(planner, d["id"])
    aa, ab, ac = (t[r]["id"] for r in ("G-FNAA", "G-FNAB", "G-FNAC"))
    probe = "probe-missing-id"
    err(anon.call("POST", f"/api/threads/{aa}/claim", {}), 401, "unauthenticated")
    err(dara.call("POST", f"/api/threads/{probe}/claim", {}), 400, "idempotency_key_required")
    err(casey.call("POST", f"/api/threads/{ab}/claim", {}), 400, "idempotency_key_required")
    err(planner.call("POST", f"/api/threads/{ab}/claim", {}), 400, "idempotency_key_required")
    err(dara.call("POST", f"/api/threads/{probe}/claim", {}, key="k" * (KEY_MAX + 1)), 400, "idempotency_key_invalid")
    assert claim(dara, aa, key="k" * KEY_MAX).status_code == 200
    err(casey.call("POST", f"/api/threads/{probe}/claim", {}, key=idempotency_key()), 404, "not_found")
    err(casey.call("POST", f"/api/threads/{ab}/claim", {}, key=idempotency_key()), 403, "forbidden")
    err(sol.call("POST", f"/api/threads/{aa}/release", {}), 403, "not_holder")
    e = err(planner.call("POST", f"/api/threads/{aa}/deferral", {"reason": ""}, key=idempotency_key()), 409, "invalid_transition")
    assert e["stage"] == "claimed" and e["action"]
    e = err(planner.call("POST", f"/api/threads/{ac}/deferral", {"reason": ""}, key=idempotency_key()), 422, "validation")
    assert "reason" in e["fields"]
    e = err(sol.call("POST", f"/api/threads/{ab}/claim", {}, key=idempotency_key()) if claim(dara, ab).status_code == 200 else None, 409, "card_held")
    assert e["holder"]["display_name"] == "Dara Okafor"
    err(planner.call("PATCH", "/api/directives"), 405, "method_not_allowed")


def test_sign_in_and_sessions(app_url):
    erased = {p["username"] for p in Api(app_url, "robin.achterberg").get("/api/people")["people"] if p["erased"]}
    for username, (passcode, display, role, _, licence, email) in USERS.items():
        c = httpx.Client(base_url=app_url, timeout=HTTP_S)
        r = c.post("/api/session", json={"username": username, "passcode": passcode})
        if username in erased:
            err(r, 401, "bad_credentials", username)
            continue
        assert r.status_code == 200, (username, r.text)
        u = r.json()["user"]
        assert (u["username"], u["display_name"], u["role"], u["licence"], u["email"]) == (username, display, role, licence, email)
        assert (u["scope"] is None) == (username not in SEED_SCOPES)
        cookie = r.headers["set-cookie"].lower()
        assert all(part.lower() in cookie for part in ("tb_session", "HttpOnly", "SameSite=Strict", "Path=/")), cookie
        value = c.cookies["tb_session"]
        assert c.get("/api/session").json()["user"]["username"] == username
        assert c.delete("/api/session").status_code == 204
        err(httpx.get(app_url + "/api/session", cookies={"tb_session": value}, timeout=HTTP_S), 401, "unauthenticated", username)
    err(httpx.post(app_url + "/api/session", json={"username": "avery.lund", "passcode": "wrong-probe"}, timeout=HTTP_S), 401, "bad_credentials")
    err(httpx.get(app_url + "/api/session", timeout=HTTP_S), 401, "unauthenticated")


def test_role_permissions(app_url):
    planner, clerk, d, t = permission_setup(app_url)
    actions, number, history = write_actions(planner, clerk, d, t)
    before = footprint(planner, d)
    clients = {role: Api(app_url, u) for role, u in ROLE_USERS.items()}
    for label, allowed, send in actions:
        for role, api in clients.items():
            if role == allowed:
                continue
            code = "not_holder" if allowed == "holder" and role == "licensed_inspector" else "forbidden"
            err(send(api), 403, code, f"{label} as {role}")
    assert footprint(planner, d) == before
    assert not any(x["number"] == number for x in planner.get("/api/directives")["directives"])
    assert imports_with(planner, history) == []


def test_auditor_read_only(app_url):
    planner, clerk, d, t = permission_setup(app_url)
    pack = clerk.ok("POST", "/api/packs", {"directive_id": d["id"]}, key=idempotency_key())["pack"]
    casey = Api(app_url, "casey.moreau")
    for path in ("/api/board", "/api/directives", f"/api/directives/{d['id']}", "/api/threads", f"/api/threads/{t['G-FNAA']['id']}",
                 "/api/tails", "/api/people", "/api/packs", f"/api/packs/{pack['id']}", "/api/notices", "/api/audit", "/api/imports"):
        casey.get(path)
    assert casey.call("GET", f"/api/packs/{pack['id']}/pdf").content.startswith(b"%PDF-")
    r = casey.call("GET", f"/api/directives/{d['id']}/export.csv")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    with casey.client.stream("GET", "/api/events") as s:
        assert s.status_code == 200 and s.headers["content-type"].startswith("text/event-stream")
    actions, number, history = write_actions(planner, clerk, d, t)
    before = footprint(planner, d)
    for label, _, send in actions:
        err(send(casey), 403, "forbidden", label)
    assert footprint(planner, d) == before
    assert imports_with(planner, history) == []


def test_ingest_directive(app_url):
    planner = Api(app_url, "avery.lund")
    data = pdf_bytes()
    r = planner.call("POST", "/api/documents", raw=data, ctype="application/pdf")
    assert r.status_code == 201
    doc = r.json()
    assert doc["key"] == f"directives/{sha(data)}.pdf" and doc["sha256"] == sha(data) and doc["bytes"] == len(data)
    assert S3().get(doc["key"]) == data
    again = planner.call("POST", "/api/documents", raw=data, ctype="application/pdf")
    assert again.status_code == 200 and again.json()["document_id"] == doc["document_id"]
    e = err(planner.call("POST", "/api/documents", raw=b"GIF89a probe", ctype="application/pdf"), 422, "validation")
    assert "document" in e["fields"]
    number = number_for("EASA")
    body = {"authority": "EASA", "number": number, "title": "Probe ingest", "document_id": doc["document_id"],
            "effective_date": today(planner).isoformat(), "calendar_days": 30, "fh_interval": 100.0, "method": "Probe",
            "applicability": [{"model": ATR, "msn_from": 1135, "msn_to": 1163}, {"model": DHC, "msn_from": 4402, "msn_to": 4417}]}
    bad = [("authority", {"authority": "FAA"}), ("number", {"number": number.replace("-", "")}),
           ("number", {"authority": "UK CAA"}), ("title", {"title": ""}), ("title", {"title": "t" * (TITLE_MAX + 1)}),
           ("method", {"method": ""}), ("effective_date", {"effective_date": (today(planner) + timedelta(days=1)).isoformat()}),
           ("effective_date", {"effective_date": "2026-02-30"}), ("calendar_days", {"calendar_days": 0}),
           ("calendar_days", {"calendar_days": DAYS_MAX + 1}), ("fh_interval", {"fh_interval": 0.0}),
           ("fh_interval", {"fh_interval": FH_MAX + 0.1}), ("fh_interval", {"fh_interval": 1.25}),
           ("applicability", {"applicability": []}), ("applicability", {"applicability": [{"model": "B737-800", "msn_from": 1, "msn_to": 2}]}),
           ("applicability", {"applicability": [{"model": ATR, "msn_from": 1200, "msn_to": 1100}]}),
           ("applicability", {"applicability": [{"model": ATR, "msn_from": 1100, "msn_to": 1110}] * (RANGES_MAX + 1)}),
           ("document_id", {"document_id": "probe-missing-document"})]
    for field, change in bad:
        e = err(planner.call("POST", "/api/directives", {**body, **change}), 422, "validation", field)
        assert any(k.startswith(field) for k in e["fields"]), (field, e)
    assert not any(x["number"] == number for x in planner.get("/api/directives")["directives"])
    r = planner.call("POST", "/api/directives", body)
    assert r.status_code == 201, r.text
    d, splice = r.json()["directive"], r.json()["splice"]
    assert (d["revision"], d["status"], d["revisions"][0]["document_key"]) == ("R1", "active", doc["key"])
    assert d["revisions"][0]["ingested_by"]["display_name"] == "Avery Lund"
    t = threads(planner, d["id"])
    assert sorted(t) == ["G-FNAC", "G-FNAD", "G-FNAE", "G-FNBB", "G-FNBC"]
    assert all(x["stage"] == "open" and x["revision"] == "R1" and WORK_CARD.match(x["work_card"]["id"]) for x in t.values())
    assert len({x["work_card"]["id"] for x in t.values()}) == len(t)
    assert (splice["from"], splice["to"], sorted(splice["added"])) == (None, "R1", sorted(x["id"] for x in t.values()))
    err(planner.call("POST", "/api/directives", body), 409, "directive_exists")
    for authority in ("UK CAA", "ATR", "De Havilland", "Embraer"):
        ingest(planner, [(ATR, 1100, 1110)], authority=authority, days=DAYS_MAX, fh=FH_MAX, title="t" * TITLE_MAX)
    ingest(planner, [(ATR, 1100, 1110)], days=1, fh=0.1)


def test_due_instant_and_window(app_url):
    planner = Api(app_url, "avery.lund")
    day = today(planner)
    rng = [(ERJ, 17000610, 17000620)]
    soon, _ = ingest(planner, rng, effective=day - timedelta(days=160), days=180, fh=6000.0)
    t = threads(planner, soon["id"])["G-FNCH"]
    lim, deadline = t["limits"], day + timedelta(days=20)
    assert lim["deadline_date"] == deadline.isoformat() and ISO_MS.match(lim["calendar_due_at"])
    assert ts(lim["calendar_due_at"]) == london(deadline, 23, 59, 59) and ts(lim["due_at"]) == ts(lim["calendar_due_at"])
    assert ts(lim["due_soon_from"]) == london(deadline - timedelta(days=DUE_SOON_DAYS), 0, 0)
    assert t["label"] == "Due soon"
    later, _ = ingest(planner, rng, effective=day, days=365, fh=6000.0)
    t = threads(planner, later["id"])["G-FNCH"]
    assert t["label"] == "Open"
    assert ts(t["limits"]["due_soon_from"]) == london(day + timedelta(days=365 - DUE_SOON_DAYS), 0, 0)
    late, _ = ingest(planner, rng, effective=day - timedelta(days=100), days=90, fh=6000.0)
    t = threads(planner, late["id"])["G-FNCH"]
    assert t["state"] == "overdue" and t["label"] == "Overdue" and ts(t["limits"]["due_at"]) < now(planner)
    near, _ = ingest(planner, rng, fh=DUE_SOON_HOURS - 10)
    t = threads(planner, near["id"])["G-FNCH"]
    assert t["label"] == "Due soon" and ts(t["limits"]["due_soon_from"]) <= now(planner)
    instant, _ = ingest(planner, rng, fh=0.5)
    entry = log_hours(planner, "G-FNCH", 0.6)
    t = threads(planner, instant["id"])["G-FNCH"]
    assert ts(t["limits"]["due_at"]) == ts(entry["logged_at"]) and t["state"] == "overdue"


def test_governing_limit_and_rails(app_url):
    planner = Api(app_url, "avery.lund")
    eff = today(planner) - timedelta(days=90)
    rng = [(ATR, 1255, 1265)]
    tie, _ = ingest(planner, rng, effective=eff, days=180, fh=540.0)
    early, _ = ingest(planner, rng, effective=eff, days=180, fh=534.0)
    quarter, _ = ingest(planner, rng, effective=eff, days=180, fh=60.0)

    def cell_of(d, reg="G-FNAK"):
        b, _, cells = board_column(planner, d["id"])
        return ts(b["generated_at"]), next(c for c in cells if c["registration"] == reg)
    assert cell_of(tie)[1]["governing"] == "CAL" and cell_of(early)[1]["governing"] == "FH"
    log_hours(planner, "G-FNAK", 15.0)
    assert cell_of(tie)[1]["governing"] == "FH"
    at, c = cell_of(quarter)
    assert c["hours_used"] == 0.25 and c["governing"] == "FH"
    lim = threads(planner, quarter["id"])["G-FNAK"]["limits"]
    start = london(date.fromisoformat(lim["effective_date"]), 0, 0)
    expected = (at - start) / (ts(lim["calendar_due_at"]) - start)
    assert abs(c["calendar_used"] - expected) <= 0.011
    assert cell_of(early)[1]["hours_used"] == round(15.0 / 534.0, 2)
    both, _ = ingest(planner, [(ATR, 1270, 1280)], effective=today(planner) - timedelta(days=200), days=100, fh=0.1)
    log_hours(planner, "G-FNAL", 0.2)
    _, c = cell_of(both, "G-FNAL")
    t = threads(planner, both["id"])["G-FNAL"]
    assert c["governing"] == "CAL" and c["calendar_used"] == 1 and c["hours_used"] == 1
    assert ts(t["limits"]["due_at"]) == ts(t["limits"]["calendar_due_at"]) and t["state"] == "overdue"


def test_supersession_lineage(app_url):
    planner, noor, dara, sol = (Api(app_url, u) for u in ("avery.lund", "noor.haddad", "dara.okafor", "sol.brennan"))
    d, _ = ingest(planner, [(ATR, 1100, 1180)], days=365, method=R1_METHOD)
    t1 = threads(planner, d["id"])
    assert sorted(t1) == [f"G-FNA{c}" for c in "ABCDEF"]
    assert defer(planner, t1["G-FNAB"]["id"]).status_code == 201
    assert claim(dara, t1["G-FNAC"]["id"]).status_code == 200
    inspect(sol, t1["G-FNAD"]["id"])
    eff1 = today(planner)
    _, splice = revise(noor, d["id"], [(ATR, 1100, 1163), (ATR, 1196, 1211)], days=90, fh=300.0, method=R2_METHOD)
    rows = planner.get("/api/threads", directive_id=d["id"])["threads"]
    assert len(rows) == len({r["registration"] for r in rows}) == 8
    t2 = {r["registration"]: r for r in rows}
    kept = [f"G-FNA{c}" for c in "ABCDE"]
    assert (splice["from"], splice["to"], splice["kept"]) == ("R1", "R2", [])
    assert sorted(splice["retargeted"]) == sorted(t1[r]["id"] for r in kept)
    assert sorted(splice["added"]) == sorted([t2["G-FNAG"]["id"], t2["G-FNAH"]["id"]])
    assert splice["removed"] == [t1["G-FNAF"]["id"]]
    for reg in kept:
        x = t2[reg]
        assert x["id"] == t1[reg]["id"] and x["revision"] == "R2" and x["stage"] == "superseded_retargeted"
        assert x["limits"]["deadline_date"] == (today(planner) + timedelta(days=90)).isoformat() and x["limits"]["fh_interval"] == 300.0
        assert round(x["limits"]["fh_baseline"], 1) == round(tail_total(planner, reg), 1)
        assert x["wording"]["method"] == R2_METHOD
        assert (x["history"][0]["revision"], x["history"][0]["outcome"]) == ("R1", "retargeted")
        granted = DEFER_DAYS if x["history"][0]["limits"]["deferred"] else 0
        assert x["history"][0]["limits"]["deadline_date"] == (eff1 + timedelta(days=365 + granted)).isoformat()
        assert x["history"][0]["wording"]["method"] == R1_METHOD and x["history"][-1]["outcome"] == "current"
    assert t2["G-FNAB"]["deferral"] is None and t2["G-FNAB"]["history"][0]["limits"]["deferred"]
    assert t2["G-FNAC"]["work_card"]["holder"]["display_name"] == "Dara Okafor"
    assert t2["G-FNAD"]["signatures"][0]["status"] == "superseded" and t2["G-FNAD"]["work_card"]["holder"]["display_name"] == "Sol Brennan"
    for reg in ("G-FNAG", "G-FNAH"):
        assert t2[reg]["stage"] == "open" and t2[reg]["revision"] == "R2" and reg not in t1
    af = t2["G-FNAF"]
    assert af["id"] == t1["G-FNAF"]["id"] and af["stage"] == "not_applicable" and af["label"] == "Not applicable"
    assert (af["history"][0]["revision"], af["history"][0]["outcome"]) == ("R1", "removed")
    assert sum(board_column(planner, d["id"])[1]["counts"].values()) == 7
    _, back = revise(noor, d["id"], [(ATR, 1100, 1211)])
    af = thread(planner, t1["G-FNAF"]["id"])
    assert af["id"] in back["added"] and af["stage"] == "open" and af["revision"] == "R3"
    assert [(h["revision"], h["outcome"]) for h in af["history"]][:2] == [("R1", "removed"), ("R2", "added")]


def test_supersession_pinned(browser):
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    planner = Api(base, "avery.lund")
    tok = uuid.uuid4().hex[:8]
    with app_copy(store("mailpit_down"), clock=iso_ms(now(planner) - timedelta(days=2))) as old:
        p0 = Api(old, "avery.lund")
        eff1 = today(p0) - timedelta(days=1)
        d, _ = ingest(p0, [(ATR, 1100, 1150)], effective=eff1, days=180, fh=600.0, title=f"Probe R1 wording {tok}", method=R1_METHOD)
        certify(Api(old, "dara.okafor"), Api(old, "tomasz.wilk"), threads(p0, d["id"])["G-FNAA"]["id"])
    dara, tomasz = Api(base, "dara.okafor"), Api(base, "tomasz.wilk")
    dn, t = dname(d), threads(planner, d["id"])
    certify(dara, tomasz, t["G-FNAB"]["id"])
    title2 = f"Probe R2 wording {tok}"
    seen = {e["id"] for e in planner.get("/api/audit", directive_id=d["id"])["entries"]}
    _, splice = revise(planner, d["id"], [(ATR, 1100, 1150)], title=title2, method=R2_METHOD, days=90, fh=300.0, credit=True)
    aa = thread(planner, t["G-FNAA"]["id"])
    assert splice["kept"] == [aa["id"]]
    written = [e["thread_id"] or "" for e in planner.get("/api/audit", directive_id=d["id"])["entries"] if e["id"] not in seen]
    assert sorted(written) == sorted(["", *(x["id"] for x in t.values() if x["id"] != aa["id"])]), written
    assert (aa["stage"], aa["label"], aa["revision"], aa["pinned_revision"], aa["governing_revision"]) == ("certified", "Complied", "R2", "R1", "R1")
    assert aa["wording"] == {"title": f"Probe R1 wording {tok}", "method": R1_METHOD}
    assert aa["limits"]["deadline_date"] == (eff1 + timedelta(days=180)).isoformat() and aa["limits"]["fh_interval"] == 600.0
    assert {(s["status"], s["revision"]) for s in aa["signatures"]} == {("valid", "R1")}
    ab = thread(planner, t["G-FNAB"]["id"])
    assert ab["id"] in splice["retargeted"] and ab["stage"] == "superseded_retargeted"
    assert {s["status"] for s in ab["signatures"]} == {"superseded"}
    _, entry, cells = board_column(planner, d["id"])
    cells = {c["registration"]: c for c in cells}
    assert (cells["G-FNAA"]["pinned_revision"], cells["G-FNAA"]["label"], cells["G-FNAA"]["revision"]) == ("R1", "Complied", "R2")
    rows = {r["registration"]: r for r in export(planner, d["id"])[1]}
    assert (rows["G-FNAA"]["governing_revision"], rows["G-FNAA"]["title"]) == ("R1", f"Probe R1 wording {tok}")
    assert rows["G-FNAA"]["deadline_date"] == aa["limits"]["deadline_date"]
    assert (rows["G-FNAB"]["governing_revision"], rows["G-FNAB"]["title"]) == ("R2", title2)
    assert entry["counts"]["complied"] == 1
    with board(browser, base, "casey.moreau") as page:
        pinned = cell(page, "G-FNAA", dn, "R2", "Complied")
        expect(pinned).to_have_accessible_name(re.compile(re.escape(", signed under R1")), timeout=UI_MS)
        expect(pinned).to_contain_text("signed under R1")


def test_supersession_surfaces():
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    planner, dara, sol, tomasz = (Api(base, u) for u in ("avery.lund", "dara.okafor", "sol.brennan", "tomasz.wilk"))
    tok = uuid.uuid4().hex[:8]
    d, _ = ingest(planner, [(ATR, 1100, 1150)], title=f"Probe R1 wording {tok}", method=R1_METHOD)
    dn, t = dname(d), threads(planner, d["id"])
    certify(dara, tomasz, t["G-FNAB"]["id"])
    assert claim(dara, t["G-FNAC"]["id"]).status_code == 200
    inspect(sol, t["G-FNAD"]["id"])
    request = f"Countersignature requested: G-FNAD {dn} R1"
    assert notices_for(planner, request)[0]["status"] == "queued"
    title2 = f"Probe R2 wording {tok}"
    revise(planner, d["id"], [(ATR, 1100, 1150)], title=title2, method=R2_METHOD, days=90, fh=300.0)
    _, entry, cells = board_column(planner, d["id"])
    cells = {c["registration"]: c for c in cells}
    rows = {r["registration"]: r for r in export(planner, d["id"])[1]}
    assert (entry["revision"], entry["title"]) == ("R2", title2)
    assert entry["counts"] == counts_of(open=4) == recount(planner, d["id"])
    for reg in ("G-FNAA", "G-FNAB", "G-FNAC", "G-FNAD"):
        th = thread(planner, t[reg]["id"])
        assert cells[reg]["revision"] == "R2" and cells[reg]["label"] == "Superseded"
        assert (th["revision"], th["wording"]["method"]) == ("R2", R2_METHOD)
        assert (rows[reg]["revision"], rows[reg]["title"], rows[reg]["governing_revision"]) == ("R2", title2, "R2")
    hits = [x for x in planner.get("/api/search", q=tok)["results"] if x["type"] == "directive" and x["id"] == d["id"]]
    assert hits and all(x["revision"] == "R2" and x["label"] == f"{dn} R2 {title2}" for x in hits)
    assert notices_for(planner, request)[0]["status"] == "withdrawn"
    card = notices_for(planner, f"New revision {dn} R2 affects your work card {t['G-FNAC']['work_card']['id']}")
    assert len(card) == 1 and card[0]["status"] == "queued" and USERS["dara.okafor"][5] in str(card[0]["to"])


def test_contractor_erasure():
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    planner, tomasz, clerk = (Api(base, u) for u in ("avery.lund", "tomasz.wilk", "robin.achterberg"))
    victim = next(p for p in clerk.get("/api/people")["people"] if p["contractor"] and not p["erased"])
    who = Api(base, victim["username"])
    d, _ = ingest(planner, [(ATR, 1100, 1135)])
    t = threads(planner, d["id"])
    done = certify(who, tomasz, t["G-FNAA"]["id"])
    inspect(who, t["G-FNAB"]["id"])
    assert claim(who, t["G-FNAC"]["id"]).status_code == 200
    before = {e["id"]: e for e in clerk.get("/api/audit", directive_id=d["id"])["entries"]}
    assert any(e["actor"]["id"] == victim["id"] for e in before.values())
    clerk_entries = {e["id"] for e in clerk.get("/api/audit")["entries"]}
    held = [x["id"] for x in clerk.get("/api/threads")["threads"] if (x["work_card"]["holder"] or {}).get("id") == victim["id"]]
    assert {t["G-FNAB"]["id"], t["G-FNAC"]["id"]} <= set(held)
    p = clerk.ok("POST", f"/api/people/{victim['id']}/erasure", {"reason": "Contractor erasure request"})["person"]
    token = p["display_name"]
    written = [e["thread_id"] or "" for e in clerk.get("/api/audit")["entries"]
               if e["actor"]["id"] == clerk.user["id"] and e["id"] not in clerk_entries]
    assert sorted(written) == sorted(["", *held]), written
    assert TOKEN.match(token) and (p["id"], p["licence"], p["erased"]) == (victim["id"], None, True)
    u = next(x for x in clerk.get("/api/people")["people"] if x["id"] == victim["id"])
    assert (u["display_name"], u["licence"], u["email"], u["erased"]) == (token, None, None, True)
    err(who.call("GET", "/api/session"), 401, "unauthenticated")
    err(Api(base).call("POST", "/api/session", {"username": victim["username"], "passcode": USERS[victim["username"]][0]}), 401, "bad_credentials")
    after = threads(clerk, d["id"])
    aa = after["G-FNAA"]
    assert [(s["id"], s["kind"], s["status"], s["committed_at"]) for s in aa["signatures"]] == \
        [(s["id"], s["kind"], s["status"], s["committed_at"]) for s in done["signatures"]]
    assert aa["signatures"][0]["signer"]["display_name"] == token and aa["signatures"][0]["signer"]["licence"] is None
    assert [(e["id"], e["key"], e["sha256"]) for e in aa["evidence"]] == [(e["id"], e["key"], e["sha256"]) for e in done["evidence"]]
    assert aa["evidence"][0]["attached_by"]["display_name"] == token
    assert sha(S3("-mailpit-down").get(aa["evidence"][0]["key"])) == aa["evidence"][0]["sha256"]
    ab, ac = after["G-FNAB"], after["G-FNAC"]
    assert ab["stage"] == "inspected" and ab["work_card"]["holder"] is None and ab["signatures"][0]["signer"]["display_name"] == token
    assert ac["stage"] == "open" and ac["work_card"]["holder"] is None
    entries = {e["id"]: e for e in clerk.get("/api/audit", directive_id=d["id"])["entries"]}
    assert set(before) <= set(entries)
    for eid, e in before.items():
        if e["actor"]["id"] == victim["id"]:
            assert entries[eid]["actor"]["display_name"] == token and entries[eid]["action"] == e["action"]
    assert thread(clerk, aa["id"])["signatures"][0]["signer"]["display_name"] == token
    err(clerk.call("POST", f"/api/people/{victim['id']}/erasure", {"reason": "again"}), 409, "already_erased")
    err(clerk.call("POST", f"/api/people/{person(clerk, 'noor.haddad')['id']}/erasure", {"reason": "staff"}), 409, "not_contractor")


def test_revision_splice_animation(browser, app_url):
    planner, noor = Api(app_url, "avery.lund"), Api(app_url, "noor.haddad")
    d, _ = ingest(planner, [(ATR, 1100, 1180)])
    dn = dname(d)
    with board(browser, app_url, "avery.lund") as page:
        expect(header(page, dn, "R1")).to_be_visible(timeout=UI_MS)
        expect(grid(page)).to_have_attribute("aria-busy", "false")
        grid(page).evaluate(BUSY_SCRIPT)
        revise(noor, d["id"], [(ATR, 1100, 1163), (ATR, 1196, 1211)])
        poll(lambda: page.evaluate("window.__busy.some(([, v]) => v === 'true')"), SETTLE_S, "grid busy")
        expect(grid(page)).to_have_attribute("aria-busy", "false", timeout=UI_MS)
        marks = page.evaluate("window.__busy")
        start = next(t for t, v in marks if v == "true")
        end = max(t for t, v in marks if v == "false")
        assert end - start <= SPLICE_MAX_MS
        expect(header(page, dn, "R2")).to_be_visible()
        expect(view_under(page, dn, "R1")).to_be_visible()
        for c in board_column(planner, d["id"])[2]:
            expect(cell(page, c["registration"], dn, c["revision"], c["label"])).to_have_count(1)


def test_reduced_motion_splice(browser, app_url):
    planner, noor = Api(app_url, "avery.lund"), Api(app_url, "noor.haddad")
    d, _ = ingest(planner, [(ATR, 1100, 1180)])
    dn = dname(d)
    with board(browser, app_url, "avery.lund", reduced="reduce") as page:
        expect(header(page, dn, "R1")).to_be_visible(timeout=UI_MS)
        grid(page).evaluate(BUSY_SCRIPT)
        _, s = revise(noor, d["id"], [(ATR, 1100, 1163), (ATR, 1196, 1211)])
        n = {k: len(s[k]) for k in ("retargeted", "added", "removed", "kept")}
        banner = page.get_by_role("status", name="Revision changes")
        expect(banner).to_contain_text(f"R2 supersedes R1: {n['retargeted']} retargeted, {n['added']} added, "
                                       f"{n['removed']} removed, {n['kept']} kept under R1", timeout=UI_MS)
        expect(header(page, dn, "R2")).to_be_visible()
        assert page.evaluate("window.__busy.every(([, v]) => v !== 'true')")
        assert animations(grid(page)) == []
        cells = board_column(planner, d["id"])[2]
        for c in cells:
            expect(cell(page, c["registration"], dn, c["revision"], c["label"])).to_have_count(1)
            expect(cell(page, c["registration"], dn, c["revision"], c["label"]).get_by_role("img", name=c["label"])).to_have_count(1)
        try:
            axe(page)
        except AssertionError as found:
            assert str(found).startswith(AXE_PREFIX), str(found)
            assert not [rule for rule in AXE_BACKED if rule in str(found)], str(found)
        column = page.get_by_role("gridcell", name=re.compile(r"^G-\w+ " + re.escape(dn) + " R"))
        click(banner.get_by_role("link", name=f"{n['added']} added"))
        expect(page.get_by_role("status", name="Board filter")).to_contain_text(f"Showing {n['added']} added cells from", timeout=UI_MS)
        expect(column).to_have_count(n["added"])
        click(btn(page.get_by_role("status", name="Board filter"), "Clear filter"))
        expect(column).to_have_count(len(cells))
        expect(btn(banner, "Dismiss")).to_be_visible()


def test_effectivity_confirmation(app_url):
    planner, dara, sol = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "sol.brennan"))
    d, _ = ingest(planner, [(ATR, 1100, 1135)])
    t = threads(planner, d["id"])
    aa, ab, ac = (t[r]["id"] for r in ("G-FNAA", "G-FNAB", "G-FNAC"))
    assert claim(dara, ab).status_code == 200 and claim(sol, ac).status_code == 200
    ev = attach(dara, ab)["id"]
    revise(planner, d["id"], [(ATR, 1100, 1135)])
    err(effectivity(dara, aa), 403, "forbidden")
    err(effectivity(Api(app_url, "casey.moreau"), aa), 403, "forbidden")
    assert thread(planner, aa)["stage"] == "superseded_retargeted"
    err(claim(sol, aa), 409, "effectivity_unconfirmed")
    err(defer(planner, aa), 409, "effectivity_unconfirmed")
    err(sign(dara, ab, "R2", [ev]), 409, "effectivity_unconfirmed")
    e = err(effectivity(planner, aa, reason=""), 422, "validation")
    assert "reason" in e["fields"]
    assert effectivity(planner, aa).json()["thread"]["stage"] == "open"
    e = err(effectivity(planner, aa), 409, "invalid_transition")
    assert e["stage"] == "open"
    b = effectivity(planner, ab).json()["thread"]
    assert b["stage"] == "claimed" and b["work_card"]["holder"]["display_name"] == "Dara Okafor"
    c = effectivity(planner, ac, "not_applicable").json()["thread"]
    assert c["stage"] == "not_applicable" and c["work_card"]["holder"] is None
    assert claim(sol, aa).status_code == 200


def test_withdrawal_placeholder(app_url):
    planner, dara, sol = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "sol.brennan"))
    d, _ = ingest(planner, [(ATR, 1100, 1135)])
    t = threads(planner, d["id"])
    assert claim(dara, t["G-FNAA"]["id"]).status_code == 200
    inspect(sol, t["G-FNAB"]["id"])
    e = err(planner.call("POST", f"/api/directives/{d['id']}/withdrawal", {"reason": ""}), 422, "validation")
    assert "reason" in e["fields"]
    assert withdraw(planner, d["id"])["status"] == "withdrawn"
    after = threads(planner, d["id"])
    assert {x["stage"] for x in after.values()} == {"withdrawn"} and after["G-FNAA"]["work_card"]["holder"] is None
    assert len(after["G-FNAB"]["signatures"]) == 1 and after["G-FNAB"]["history"]
    b = planner.get("/api/board")
    entry = next(x for x in b["directives"] if x["id"] == d["id"])
    assert entry["counts"] == counts_of() and {c["label"] for c in b["cells"] if c["directive_id"] == d["id"]} == {"Withdrawn"}
    assert b["totals"] == {k: sum(x["counts"][k] for x in b["directives"]) for k in COUNT_KEYS}
    body = directive_body(planner, [(ATR, 1100, 1135)], "Probe", 30, 100.0, None, "Probe")
    err(planner.call("POST", f"/api/directives/{d['id']}/revisions", {**body, "revision": 2, "prior_credit": False}), 409, "directive_withdrawn")
    err(claim(sol, t["G-FNAC"]["id"]), 409, "directive_withdrawn")
    err(planner.call("POST", f"/api/directives/{d['id']}/withdrawal", {"reason": "again"}), 409, "directive_withdrawn")


def test_single_holder_concurrent(app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1163)])
    per = 4
    clients = {u: [Api(app_url, u) for _ in range(per)] for u in ("dara.okafor", "sol.brennan")}
    for reg, t in threads(planner, d["id"]).items():
        before = len(planner.get("/api/audit", thread_id=t["id"])["entries"])
        gate, results = threading.Barrier(2 * per), []

        def go(u, api, tid=t["id"]):
            gate.wait()
            r = claim(api, tid)
            results.append((u, r.status_code, r.json()))
        workers = [threading.Thread(target=go, args=(u, a)) for u, apis in clients.items() for a in apis]
        for w in workers:
            w.start()
        for w in workers:
            w.join()
        winners = {u for u, s, _ in results if s == 200}
        assert len(winners) == 1, (reg, results)
        win = winners.pop()
        for u, s, b in results:
            if u != win:
                assert s == 409 and b["error"]["code"] == "card_held" and b["error"]["holder"]["display_name"] == USERS[win][1]
        th = thread(planner, t["id"])
        assert th["stage"] == "claimed" and th["work_card"]["holder"]["display_name"] == USERS[win][1]
        assert len(planner.get("/api/audit", thread_id=t["id"])["entries"]) == before + 1


def test_evidence_attach(app_url):
    planner, dara, sol = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "sol.brennan"))
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    tid = threads(planner, d["id"])["G-FNAA"]["id"]
    assert claim(dara, tid).status_code == 200
    made = []
    for data, ctype, ext in ((jpeg_bytes(), "image/jpeg", "jpg"), (png_bytes(), "image/png", "png"), (pdf_bytes(), "application/pdf", "pdf")):
        ev = attach(dara, tid, data, ctype)
        assert (ev["key"], ev["sha256"], ev["bytes"], ev["content_type"]) == (f"evidence/{sha(data)}.{ext}", sha(data), len(data), ctype)
        assert ev["attached_by"]["display_name"] == "Dara Okafor" and S3().get(ev["key"]) == data
        made.append(ev["id"])
    assert [e["id"] for e in thread(planner, tid)["evidence"]] == made
    other = jpeg_bytes()
    err(sol.call("POST", f"/api/threads/{tid}/evidence", raw=other, ctype="image/jpeg"), 403, "not_holder")
    err(planner.call("POST", f"/api/threads/{tid}/evidence", raw=other, ctype="image/jpeg"), 403, "forbidden")
    assert f"evidence/{sha(other)}.jpg" not in S3().keys("evidence/")
    assert len(thread(planner, tid)["evidence"]) == len(made)


def test_inspection_bound_to_revision(app_url):
    planner, dara, sol = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "sol.brennan"))
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    tid = threads(planner, d["id"])["G-FNAA"]["id"]
    assert claim(dara, tid).status_code == 200
    ev = attach(dara, tid)["id"]
    assert "evidence_ids" in err(sign(dara, tid, "R1", []), 422, "validation")["fields"]
    r = dara.call("POST", f"/api/threads/{tid}/inspection", {"revision": "R1", "method_ref": "", "findings": "x", "evidence_ids": [ev]}, key=idempotency_key())
    assert "method_ref" in err(r, 422, "validation")["fields"]
    err(sign(sol, tid, "R1", [ev]), 403, "not_holder")
    revise(planner, d["id"], [(ATR, 1100, 1110)])
    assert effectivity(planner, tid).json()["thread"]["stage"] == "claimed"
    assert err(sign(dara, tid, "R1", [ev]), 409, "revision_changed")["current"] == "R2"
    assert thread(planner, tid)["signatures"] == []
    r = sign(dara, tid, "R2", [ev])
    assert r.status_code == 201, r.text
    s, th = r.json()["signature"], r.json()["thread"]
    assert (s["kind"], s["revision"], s["status"], s["method_ref"]) == ("inspection", "R2", "valid", "AMM task")
    assert (s["signer"]["display_name"], s["signer"]["licence"]) == ("Dara Okafor", "LIC-66-48213")
    assert th["stage"] == "inspected" and th["certifier"]["status"] == "awaiting_countersignature" and th["certifier"]["assigned"]
    err(sign(dara, tid, "R2", [ev]), 409, "invalid_transition")


REPLAY_CASES = ["claim", "inspection", "import", "pack"]


@pytest.mark.parametrize("case", REPLAY_CASES, ids=REPLAY_CASES)
def test_idempotent_replay(app_url, mail, case):
    planner, dara, clerk = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "robin.achterberg"))
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn, tid = dname(d), threads(planner, d["id"])["G-FNAA"]["id"]
    raw = alt_raw = None
    if case == "claim":
        api, path, body, alt = dara, f"/api/threads/{tid}/claim", {}, {"probe": 1}
    elif case == "inspection":
        assert claim(dara, tid).status_code == 200
        body = {"revision": "R1", "method_ref": "AMM task", "findings": "No defects found", "evidence_ids": [attach(dara, tid)["id"]]}
        api, path, alt = dara, f"/api/threads/{tid}/inspection", {**body, "findings": "Probe other findings"}

    elif case == "import":
        api, path, body, alt = clerk, "/api/imports", None, None
        raw = import_csv([legacy_row("G-FNAA", d["number"], "R1", "complied")])
        alt_raw = import_csv([legacy_row("G-FNAA", d["number"], "R1", "open")])
    else:
        api, path, body, alt = clerk, "/api/packs", {"directive_id": d["id"]}, {"directive_id": "probe-other"}
    key = idempotency_key()

    def send(b, r):
        return api.call("POST", path, b, key=key, raw=r, ctype="text/csv" if r is not None else None)

    def trace():
        th = thread(planner, tid)
        return (len(planner.get("/api/audit", directive_id=d["id"])["entries"]), th["stage"], [s["id"] for s in th["signatures"]],
                (th["work_card"]["holder"] or {}).get("id"), th["deferral"],
                sum(1 for n in planner.get("/api/notices")["notices"] if dn in n["subject"]),
                len(imports_with(planner, raw)) if raw else 0,
                sum(1 for p in planner.get("/api/packs")["packs"] if p["directive_id"] == d["id"]))
    first = send(body, raw)
    assert first.status_code in (200, 201, 202), first.text
    seen = trace()
    again = send(body, raw)
    assert again.status_code == first.status_code and again.json() == first.json()
    assert again.headers.get("Idempotent-Replayed") == "true"
    err(send(alt, alt_raw), 409, "idempotency_mismatch")
    assert trace() == seen
    if case == "pack":
        pid = first.json()["pack"]["id"]
        poll(lambda: pack_mails(mail, pid), SETTLE_S, "pack mail")
        assert len([m for m in mail.messages(settle=RETRY_S) if pid in text(m)]) == 1


def test_server_timeliness_edges():
    due = london(DUE_PROBE_DAY, 23, 59, 59)
    ev = {}
    with app_copy(store("mailpit_down"), clock=iso_ms(due - timedelta(seconds=ON_TIME_LEAD_S))) as base:
        planner, dara = Api(base, "avery.lund"), Api(base, "dara.okafor")
        d, _ = ingest(planner, [(ATR, 1255, 1280)], effective=DUE_PROBE_DAY - timedelta(days=10), days=10, fh=6000.0)
        t = threads(planner, d["id"])
        assert ts(t["G-FNAK"]["limits"]["calendar_due_at"]) == due
        for reg in ("G-FNAK", "G-FNAL"):
            assert claim(dara, t[reg]["id"]).status_code == 200
            ev[reg] = attach(dara, t[reg]["id"])["id"]
        r = sign(dara, t["G-FNAK"]["id"], "R1", [ev["G-FNAK"]], signed_at=iso_ms(due + timedelta(days=1)))
        assert r.status_code == 201, r.text
        assert r.json()["signature"]["timeliness"] == "on_time" and r.json()["thread"]["timeliness"] == "on_time"
        assert ts(r.json()["signature"]["committed_at"]) <= due
    with app_copy(store("mailpit_down"), clock=iso_ms(due + timedelta(milliseconds=1))) as base:
        dara = Api(base, "dara.okafor")
        assert thread(dara, t["G-FNAL"]["id"])["state"] == "overdue"
        r = sign(dara, t["G-FNAL"]["id"], "R1", [ev["G-FNAL"]], signed_at=iso_ms(due - timedelta(days=1)))
        assert r.status_code == 201, r.text
        s = r.json()["signature"]
        assert s["timeliness"] == "overdue" and ts(s["committed_at"]) > due and r.json()["thread"]["stage"] == "inspected"
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    planner, dara = Api(base, "avery.lund"), Api(base, "dara.okafor")
    at_edge, _ = ingest(planner, [(ATR, 1240, 1250)], fh=2.0)
    above, _ = ingest(planner, [(ATR, 1240, 1250)], fh=2.0)
    ids = [threads(planner, x["id"])["G-FNAJ"]["id"] for x in (at_edge, above)]
    evs = []
    for tid in ids:
        assert claim(dara, tid).status_code == 200
        evs.append(attach(dara, tid)["id"])
    log_hours(planner, "G-FNAJ", 2.0)
    assert thread(planner, ids[0])["state"] != "overdue"
    assert sign(dara, ids[0], "R1", [evs[0]]).json()["signature"]["timeliness"] == "on_time"
    log_hours(planner, "G-FNAJ", 0.1)
    assert sign(dara, ids[1], "R1", [evs[1]]).json()["signature"]["timeliness"] == "overdue"


def test_flight_hours_log(app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ERJ, 17000600, 17000605)], fh=60.0)
    tid = threads(planner, d["id"])["G-FNCG"]["id"]

    def cell_now():
        return next(c for c in board_column(planner, d["id"])[2] if c["thread_id"] == tid)
    assert cell_now()["label"] == "Open"
    before = tail_total(planner, "G-FNCG")
    entry = log_hours(planner, "G-FNCG", 10.1)
    assert entry["registration"] == "G-FNCG" and ISO_MS.match(entry["logged_at"])
    assert round(entry["total_hours"], 1) == round(tail_total(planner, "G-FNCG"), 1) == round(before + 10.1, 1)
    c = cell_now()
    assert c["label"] == "Due soon" and c["hours_used"] == round(10.1 / 60.0, 2)
    for sector in (24.0, 24.0, 1.9):
        log_hours(planner, "G-FNCG", sector)
    c = cell_now()
    assert c["state"] != "overdue" and c["hours_used"] == 1
    log_hours(planner, "G-FNCG", 0.1)
    assert cell_now()["state"] == "overdue" and thread(planner, tid)["label"] == "Overdue"
    total = tail_total(planner, "G-FNCG")
    for h in (0.0, 24.1, 1.25):
        assert "hours" in err(planner.call("POST", "/api/tails/G-FNCG/flight-hours", {"hours": h}), 422, "validation")["fields"]
    assert tail_total(planner, "G-FNCG") == total
    assert round(log_hours(planner, "G-FNCG", 24.0)["total_hours"], 1) == round(total + 24.0, 1)


def test_deferral_grace(app_url):
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    d, _ = ingest(planner, [(ATR, 1100, 1135)])
    t = threads(planner, d["id"])
    aa, ab, ac = (t[r]["id"] for r in ("G-FNAA", "G-FNAB", "G-FNAC"))
    old = t["G-FNAA"]["limits"]
    err(defer(dara, aa), 403, "forbidden")
    err(defer(Api(app_url, "casey.moreau"), aa), 403, "forbidden")
    assert thread(planner, aa)["stage"] == "open"
    key = idempotency_key()
    r = defer(planner, aa, key=key)
    assert r.status_code == 201, r.text
    audit = len(planner.get("/api/audit", thread_id=aa)["entries"])
    again = defer(planner, aa, key=key)
    assert again.status_code == 201 and again.json() == r.json() and again.headers.get("Idempotent-Replayed") == "true"
    err(defer(planner, aa, "Probe other reason", key=key), 409, "idempotency_mismatch")
    assert len(planner.get("/api/audit", thread_id=aa)["entries"]) == audit
    th = r.json()["thread"]
    new = (date.fromisoformat(old["deadline_date"]) + timedelta(days=DEFER_DAYS))
    assert th["stage"] == "deferred" and th["label"] == "Deferred" and th["limits"]["deferred"]
    assert th["limits"]["deadline_date"] == new.isoformat() and ts(th["limits"]["due_at"]) == london(new, 23, 59, 59)
    assert round(th["limits"]["fh_threshold"], 1) == round(old["fh_threshold"] + DEFER_HOURS, 1)
    assert th["deferral"]["granted_by"]["display_name"] == "Avery Lund" and th["deferral"]["reason"] == "Awaiting de-icer boot kit"
    err(defer(planner, aa), 409, "already_deferred")
    assert claim(dara, aa).json()["thread"]["limits"]["deadline_date"] == new.isoformat()
    assert dara.ok("POST", f"/api/threads/{aa}/release", {})["thread"]["stage"] == "open"
    err(defer(planner, aa), 409, "already_deferred")
    assert claim(dara, ab).status_code == 200
    assert err(defer(planner, ab), 409, "invalid_transition")["stage"] == "claimed"
    for reason in ("", "r" * (REASON_MAX + 1)):
        assert "reason" in err(defer(planner, ac, reason), 422, "validation")["fields"]
    late, _ = ingest(planner, [(ATR, 1100, 1110)], effective=today(planner) - timedelta(days=100), days=90)
    lt = threads(planner, late["id"])["G-FNAA"]["id"]
    err(defer(planner, lt), 409, "past_due")
    assert thread(planner, lt)["stage"] == "open"


def test_scope_checked_at_commit(app_url):
    planner, sol, ines, tomasz, priya, clerk = (Api(app_url, u) for u in ("avery.lund", "sol.brennan", "ines.varga", "tomasz.wilk", "priya.raman", "robin.achterberg"))
    scopes(clerk, SEED_SCOPES)
    try:
        d, _ = ingest(planner, [(ATR, 1100, 1118)])
        t = threads(planner, d["id"])
        aa, ab = t["G-FNAA"]["id"], t["G-FNAB"]["id"]
        inspect(sol, aa)
        inspect(sol, ab)
        ines_id = person(clerk, "ines.varga")["id"]
        clerk.ok("PUT", f"/api/engineers/{ines_id}/scope", {"models": [DHC]})
        assert err(countersign(ines, aa), 403, "out_of_scope")["model"] == ATR
        th = thread(planner, aa)
        assert th["stage"] == "inspected" and [(s["kind"], s["status"]) for s in th["signatures"]] == [("inspection", "valid")]
        err(countersign(priya, aa), 403, "out_of_scope")
        clerk.ok("PUT", f"/api/engineers/{ines_id}/scope", {"models": [ATR, DHC]})
        r = countersign(ines, aa)
        assert r.status_code == 201 and r.json()["signature"]["signer"]["display_name"] == "Ines Varga"
        err(countersign(tomasz, ab, "R2"), 409, "revision_changed")
        err(countersign(sol, ab), 403, "forbidden")
        err(countersign(planner, ab), 403, "forbidden")
        key = idempotency_key()
        r = countersign(tomasz, ab, key=key)
        assert r.status_code == 201 and r.json()["thread"]["stage"] == "certified"
        again = countersign(tomasz, ab, key=key)
        assert again.status_code == 201 and again.json() == r.json() and again.headers.get("Idempotent-Replayed") == "true"
        err(countersign(tomasz, ab, "R2", key=key), 409, "idempotency_mismatch")
        assert len(thread(planner, ab)["signatures"]) == 2
        err(countersign(tomasz, ab), 409, "invalid_transition")
    finally:
        scopes(clerk, SEED_SCOPES)


def test_scope_change_succession(app_url, mail):
    planner, sol, clerk = Api(app_url, "avery.lund"), Api(app_url, "sol.brennan"), Api(app_url, "robin.achterberg")
    scopes(clerk, SEED_SCOPES)
    try:
        d, _ = ingest(planner, [(ATR, 1100, 1110)])
        dn, tid = dname(d), threads(planner, d["id"])["G-FNAA"]["id"]
        assert inspect(sol, tid)["thread"]["certifier"]["assigned"]["display_name"] == "Ines Varga"
        ines, tomasz = person(clerk, "ines.varga")["id"], person(clerk, "tomasz.wilk")["id"]
        res = clerk.ok("PUT", f"/api/engineers/{ines}/scope", {"models": [DHC]})
        assert res["engineer"]["scope"] == [DHC]
        s = next(x for x in res["succession"] if x["thread_id"] == tid)
        assert (s["from"]["display_name"], s["to"]["display_name"]) == ("Ines Varga", "Tomasz Wilk")
        assert thread(planner, tid)["certifier"] == {"assigned": s["to"], "status": "awaiting_countersignature"} or \
            thread(planner, tid)["certifier"]["assigned"]["display_name"] == "Tomasz Wilk"
        subject = f"Countersignature passed to you: G-FNAA {dn} R1"
        n = notices_for(planner, subject)
        assert len(n) == 1 and n[0]["kind"] == "succession" and USERS["tomasz.wilk"][5] in str(n[0]["to"])
        res = clerk.ok("PUT", f"/api/engineers/{tomasz}/scope", {"models": [ERJ]})
        assert next(x for x in res["succession"] if x["thread_id"] == tid)["to"] is None
        c = thread(planner, tid)["certifier"]
        assert c["assigned"] is None and c["status"] == "awaiting_certifier"
        clerk.ok("PUT", f"/api/engineers/{ines}/scope", {"models": [ATR, DHC]})
        assert thread(planner, tid)["certifier"]["assigned"]["display_name"] == "Ines Varga"
        m = poll(lambda: [x for x in mail.messages() if x["Subject"] == subject and USERS["tomasz.wilk"][5] in addresses(x["To"])],
                 NOTICE_HOLD_MAX_S, "succession mail to Tomasz")[0]
        assert USERS["tomasz.wilk"][5] in addresses(m["To"]) and "Ines Varga" in text(m) and "Sol Brennan" in text(m)
        err(clerk.call("PUT", f"/api/engineers/{person(clerk, 'dara.okafor')['id']}/scope", {"models": [ATR]}), 404, "not_found")
        err(clerk.call("PUT", f"/api/engineers/{ines}/scope", {"models": ["B737-800"]}), 422, "validation")
    finally:
        scopes(clerk, SEED_SCOPES)


def test_board_counts_recount(app_url):
    planner, dara, tomasz, clerk = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "tomasz.wilk", "robin.achterberg"))
    d, _ = ingest(planner, [(ATR, 1100, 1196)], fh=6000.0)
    t = threads(planner, d["id"])

    def check(did, expected):
        entry = board_column(planner, did)[1]
        assert entry["counts"] == expected == recount(planner, did), (entry["counts"], expected)
    certify(dara, tomasz, t["G-FNAA"]["id"])
    assert defer(planner, t["G-FNAB"]["id"]).status_code == 201
    assert run_import(clerk, import_csv([legacy_row("G-FNAC", d["number"], "R1", "complied")]))["closed"] == 1
    check(d["id"], counts_of(open=4, deferred=1, complied=2))
    clerk.ok("POST", f"/api/threads/{t['G-FNAA']['id']}/reopen", {"reason": "Closed against the wrong work"})
    check(d["id"], counts_of(open=5, deferred=1, complied=1))
    revise(planner, d["id"], [(ATR, 1100, 1180)], fh=6000.0, days=365)
    check(d["id"], counts_of(open=6))
    day = today(planner)
    x, _ = ingest(planner, [(ATR, 1255, 1280)], effective=day - timedelta(days=100), days=90, fh=6000.0)
    assert claim(dara, threads(planner, x["id"])["G-FNAK"]["id"]).status_code == 200
    check(x["id"], counts_of(overdue=2))
    y, _ = ingest(planner, [(ATR, 1255, 1280)], effective=day - timedelta(days=160), days=180, fh=6000.0)
    assert defer(planner, threads(planner, y["id"])["G-FNAL"]["id"]).status_code == 201
    check(y["id"], counts_of(due_soon=1, deferred=1))
    b = planner.get("/api/board")
    assert b["totals"] == {k: sum(e["counts"][k] for e in b["directives"]) for k in COUNT_KEYS}


def sse_events(lines):
    out, name, data = [], "message", []
    for line in list(lines):
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())
        elif line == "":
            if data:
                out.append((name, json.loads("\n".join(data))))
            name, data = "message", []
    return out


def test_live_event_stream(app_url):
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    tid = threads(planner, d["id"])["G-FNAA"]["id"]
    listener, lines, meta = Api(app_url, "noor.haddad"), [], {}

    def read():
        try:
            with listener.client.stream("GET", "/api/events", timeout=httpx.Timeout(HTTP_S, read=None)) as r:
                meta["status"], meta["type"] = r.status_code, r.headers.get("content-type", "")
                for line in r.iter_lines():
                    lines.append(line)
        except httpx.HTTPError:
            pass
    threading.Thread(target=read, daemon=True).start()
    poll(lambda: "status" in meta, SETTLE_S, "event stream open")
    opened = time.monotonic()
    assert meta["status"] == 200 and meta["type"].startswith("text/event-stream")
    assert claim(dara, tid).status_code == 200
    poll(lambda: any(n == "threads" and tid in e["thread_ids"] for n, e in sse_events(lines)), LIVE_FEED_S, "threads event")
    _, splice = revise(planner, d["id"], [(ATR, 1100, 1110)])
    poll(lambda: any(n == "revision" and e["directive_id"] == d["id"] and e["splice"]["to"] == splice["to"] for n, e in sse_events(lines)),
         LIVE_FEED_S, "revision event")
    poll(lambda: any(line.startswith(":") for line in lines), max(1, COMMENT_S + COMMENT_GRACE_S - (time.monotonic() - opened)), "keep-alive comment")
    listener.client.close()


def test_fleet_search(app_url):
    planner, clerk = Api(app_url, "avery.lund"), Api(app_url, "robin.achterberg")
    tok = uuid.uuid4().hex[:10]
    d, _ = ingest(planner, [(ATR, 1100, 1110)], title=f"Probe search {tok}")
    dn = dname(d)

    def find(q):
        res = planner.get("/api/search", q=q)["results"]
        assert len(res) <= MAX_RESULTS
        return res

    def directive_hits(q):
        return [x for x in find(q) if x["type"] == "directive" and x["id"] == d["id"]]
    hit = directive_hits(tok.upper())
    assert hit and (hit[0]["revision"], hit[0]["label"]) == ("R1", f"{dn} R1 Probe search {tok}")
    assert directive_hits(d["number"])
    dara = person(planner, "dara.okafor")["id"]
    for q in ("lic-66-48213", "dara okafor"):
        assert any(x["type"] == "person" and x["id"] == dara for x in find(q)), q
    note = f"probe-note-{tok}"
    run_import(clerk, import_csv([legacy_row("G-FNAA", d["number"], "R1", notes=note)]))
    tid = threads(planner, d["id"])["G-FNAA"]["id"]
    assert any(x["type"] == "thread" and x["id"] == tid for x in find(note))
    for q in ("gfnaa", "G-FNAA"):
        assert any(x["type"] == "thread" for x in find(q)), q
    revise(planner, d["id"], [(ATR, 1100, 1110)], title=f"Probe search {tok} revised")
    hit = directive_hits(tok)
    assert hit and (hit[0]["revision"], hit[0]["label"]) == ("R2", f"{dn} R2 Probe search {tok} revised")
    for q in ("x", "q" * 101):
        assert "q" in err(planner.call("GET", "/api/search", q=q), 422, "validation")["fields"]


def test_search_takes_keystrokes_in_order(browser, app_url):
    planner = Api(app_url, "avery.lund")
    tok = uuid.uuid4().hex[:6]
    ingest(planner, [(ATR, 1100, 1110)], title=f"Probe typed {tok}")
    with board(browser, app_url, "avery.lund") as page:
        box = page.get_by_role("searchbox", name="Search fleet")
        click(box)
        for character in tok:
            box.press(character)
        assert box.input_value() == tok, "the search box reordered the typed characters"
        expect(page.get_by_role("list", name="Search results")).to_contain_text(tok, timeout=UI_MS)
        box.press("Backspace")
        assert box.input_value() == tok[:-1], "backspace did not drop the last typed character"


def test_status_glyph_and_text(browser, app_url):
    planner, dara, tomasz = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "tomasz.wilk"))
    day = today(planner)
    live, _ = ingest(planner, [(ATR, 1100, 1135)], fh=6000.0)
    t = threads(planner, live["id"])
    certify(dara, tomasz, t["G-FNAA"]["id"])
    assert defer(planner, t["G-FNAB"]["id"]).status_code == 201
    soon, _ = ingest(planner, [(ATR, 1100, 1110)], effective=day - timedelta(days=160), days=180, fh=6000.0)
    late, _ = ingest(planner, [(ATR, 1100, 1110)], effective=day - timedelta(days=100), days=90, fh=6000.0)
    moved, _ = ingest(planner, [(ATR, 1100, 1118)], fh=6000.0)
    revise(planner, moved["id"], [(ATR, 1100, 1110)])
    gone, _ = ingest(planner, [(ATR, 1100, 1110)])
    withdraw(planner, gone["id"])
    expected = [(live, "G-FNAA", "R1", "Complied"), (live, "G-FNAB", "R1", "Deferred"), (live, "G-FNAC", "R1", "Open"),
                (soon, "G-FNAA", "R1", "Due soon"), (late, "G-FNAA", "R1", "Overdue"), (moved, "G-FNAA", "R2", "Superseded"),
                (moved, "G-FNAB", "R2", "Not applicable"), (gone, "G-FNAA", "R1", "Withdrawn")]
    for d, reg, _, label in expected:
        assert next(c for c in board_column(planner, d["id"])[2] if c["registration"] == reg)["label"] == label
    with board(browser, app_url, "avery.lund") as page:
        for d, reg, tag, label in expected:
            c = cell(page, reg, dname(d), tag, label)
            expect(c).to_have_count(1, timeout=UI_MS)
            expect(c.get_by_role("img", name=label)).to_have_count(1)
            if label in ("Not applicable", "Withdrawn"):
                expect(c.get_by_role("link", name="Thread history")).to_have_count(1)
        server = next(x for x in board_column(planner, live["id"])[2] if x["registration"] == "G-FNAC")
        open_cell = cell(page, "G-FNAC", dname(live), "R1", "Open")
        for name, key in (("Calendar limit used", "calendar_used"), ("Flight-hours limit used", "hours_used")):
            value = open_cell.get_by_role("meter", name=name).evaluate("el => el.getAttribute('aria-valuenow') ?? String(el.value)")
            assert abs(float(value) - round(server[key] * 100)) <= 1, (name, value)
        try:
            axe(page)
        except AssertionError as found:
            assert str(found).startswith(AXE_PREFIX), str(found)
            assert not [rule for rule in AXE_BACKED if rule in str(found)], str(found)


def test_import_matching(app_url):
    planner, dara, clerk = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor"), Api(app_url, "robin.achterberg")
    n = uuid.uuid4().int
    year, serial = f"{n % 10000:04d}", f"0{(n // 10000) % 1000:03d}"
    d, _ = ingest(planner, [(ATR, 1100, 1180)], number=f"{year}-{serial}")
    t = threads(planner, d["id"])
    assert claim(dara, t["G-FNAD"]["id"]).status_code == 200
    num = d["number"]
    rows = [legacy_row("g fnaa", f"EASA AD {num}", "Rev 1", "Open"),
            legacy_row("GFNAB", f"AD-{year}_{serial}", "orig", "open"),
            legacy_row("G-FNAC", f"{year}/{int(serial)}", "R1", "COMPLIED", inspected_on="10/01/2026", certified_on="11/01/2026"),
            legacy_row("g-fnad", f"easa {num}", "original", "complied"),
            legacy_row("g fnaa", f"EASA AD {num}", "Rev 1", "Open"),
            legacy_row("G FNAE", num, "r 1", "open")]
    header = ["Notes", "STATION", *[h.upper() for h in reversed(HEADER) if h != "notes"]]
    data = import_csv([{**r, "Notes": r["notes"], "STATION": "probe", **{k.upper(): v for k, v in r.items()}} for r in rows], header=header)
    res = run_import(clerk, data)
    assert (res["rows"], res["merged"], res["duplicates"], res["closed"], res["orphans"], res["rejected"]) == (6, 5, 1, 1, [], [])
    after = threads(planner, d["id"])
    for reg in ("G-FNAA", "G-FNAB", "G-FNAC", "G-FNAD", "G-FNAE"):
        assert len(after[reg]["history"][0]["legacy_records"]) == 1, reg
    assert after["G-FNAC"]["stage"] == "certified"
    assert [(s["kind"], s["signer"], s["signer_text"]) for s in after["G-FNAC"]["signatures"]] == [("legacy", None, "Ana Probe"), ("legacy", None, "Ben Probe")]
    assert after["G-FNAD"]["stage"] == "claimed" and after["G-FNAF"]["history"][0]["legacy_records"] == []
    res = run_import(clerk, import_csv([rows[0], legacy_row("G-FNAF", num, "R1")]))
    assert (res["merged"], res["duplicates"]) == (1, 1)


def test_import_orphans_and_rejections(app_url):
    planner, clerk = Api(app_url, "avery.lund"), Api(app_url, "robin.achterberg")
    d, _ = ingest(planner, [(ATR, 1100, 1180)])
    n = d["number"]
    rows = [legacy_row("G-ZZZZ", n, "R1"), legacy_row("G-FNAA", f"{n}-77", "R1"), legacy_row("G-FNAA", n, "R9"),
            legacy_row("G-FNAL", n, "R1"), legacy_row("G-FNAB", n, "R1", "pending"),
            legacy_row("G-FNAC", n, "R1", inspected_on="2026.01.10"), legacy_row("G-FNAD", n, "R1", "complied", certified_on=""),
            legacy_row("G-FNAE", n, "R1", notes="n" * (NOTES_MAX + 1))]
    res = run_import(clerk, import_csv(rows))
    assert res["rows"] == 8 and res["merged"] == 0
    assert sorted((o["row"], o["reason"]) for o in res["orphans"]) == [(1, "unknown_tail"), (2, "unknown_directive"), (3, "unknown_revision"), (4, "not_in_effectivity")]
    assert sorted((x["row"], x["field"]) for x in res["rejected"]) == [(5, "status"), (6, "inspected_on"), (7, "certified_on"), (8, "notes")]
    assert all(x["message"] for x in res["rejected"])
    assert all(not h["legacy_records"] for x in threads(planner, d["id"]).values() for h in x["history"])
    short = import_csv(rows[:1], header=[h for h in HEADER if h != "notes"])
    assert "file" in err(clerk.call("POST", "/api/imports", raw=short, ctype="text/csv", key=idempotency_key()), 422, "validation")["fields"]
    bulk = import_csv([legacy_row("G-FNAA", n, "R1", notes=f"bulk {i}") for i in range(MAX_ROWS + 1)])
    assert "file" in err(clerk.call("POST", "/api/imports", raw=bulk, ctype="text/csv", key=idempotency_key()), 422, "validation")["fields"]


def test_reimport_creates_nothing(app_url):
    planner, clerk = Api(app_url, "avery.lund"), Api(app_url, "robin.achterberg")
    d, _ = ingest(planner, [(ATR, 1100, 1118)])
    data = import_csv([legacy_row("G-FNAA", d["number"], "R1", "complied"), legacy_row("G-FNAB", d["number"], "R1")])
    first = clerk.call("POST", "/api/imports", raw=data, ctype="text/csv", key=idempotency_key())
    assert first.status_code == 201
    res = first.json()
    assert (res["merged"], res["closed"], res["replayed_file"]) == (2, 1, False)

    def state():
        t = threads(planner, d["id"])
        return ({r: (x["stage"], [s["id"] for s in x["signatures"]], len(x["history"][0]["legacy_records"])) for r, x in t.items()},
                board_column(planner, d["id"])[1]["counts"])
    before = state()
    again = clerk.call("POST", "/api/imports", raw=data, ctype="text/csv", key=idempotency_key())
    assert again.status_code == 200 and again.json()["replayed_file"] is True
    for k in ("import_id", "file_sha256", "rows", "merged", "duplicates", "closed", "orphans", "rejected"):
        assert again.json()[k] == res[k], k
    assert len(imports_with(clerk, data)) == 1 and state() == before


def test_reopen_exact_restore(app_url):
    planner, dara, tomasz, clerk = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "tomasz.wilk", "robin.achterberg"))
    d, _ = ingest(planner, [(ATR, 1100, 1118)])
    t = threads(planner, d["id"])
    aa, ab = t["G-FNAA"]["id"], t["G-FNAB"]["id"]
    done = certify(dara, tomasz, aa)
    certify(dara, tomasz, ab)
    assert "reason" in err(clerk.call("POST", f"/api/threads/{ab}/reopen", {"reason": ""}), 422, "validation")["fields"]
    assert thread(planner, ab)["stage"] == "certified"
    assert board_column(planner, d["id"])[1]["counts"] == counts_of(complied=2) == recount(planner, d["id"])
    reason = "Closed against the wrong work"
    th = clerk.ok("POST", f"/api/threads/{aa}/reopen", {"reason": reason})["thread"]
    assert board_column(planner, d["id"])[1]["counts"] == counts_of(open=1, complied=1) == recount(planner, d["id"])
    assert (th["stage"], th["revision"], th["pinned_revision"]) == ("reopened", "R1", None)
    assert th["work_card"]["id"] == done["work_card"]["id"] and th["work_card"]["holder"]["display_name"] == "Dara Okafor"
    assert [(e["id"], e["key"], e["sha256"]) for e in th["evidence"]] == [(e["id"], e["key"], e["sha256"]) for e in done["evidence"]]
    assert all(sha(S3().get(e["key"])) == e["sha256"] for e in th["evidence"])
    assert [s["id"] for s in th["signatures"]] == [s["id"] for s in done["signatures"]]
    for old, new in zip(done["signatures"], th["signatures"]):
        assert (new["status"], new["void_reason"]) == ("void", reason)
        assert (new["committed_at"], new["revision"], new["signer"]["id"]) == (old["committed_at"], old["revision"], old["signer"]["id"])
    err(clerk.call("POST", f"/api/threads/{aa}/reopen", {"reason": reason}), 409, "invalid_transition")
    r = sign(dara, aa, "R1", [th["evidence"][0]["id"]])
    assert r.status_code == 201 and r.json()["thread"]["stage"] == "inspected"
    assert [s["status"] for s in r.json()["thread"]["signatures"]] == ["void", "void", "valid"]


def test_notice_rewrite_queue():
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    planner, dara = Api(base, "avery.lund"), Api(base, "dara.okafor")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn, tid = dname(d), threads(planner, d["id"])["G-FNAA"]["id"]
    assert claim(dara, tid).status_code == 200
    card = thread(planner, tid)["work_card"]["id"]
    other, _ = ingest(planner, [(ATR, 1100, 1110)])
    oid = threads(planner, other["id"])["G-FNAA"]["id"]
    assert claim(dara, oid).status_code == 200
    ev = attach(dara, oid)["id"]
    key = idempotency_key()
    first = sign(dara, oid, "R1", [ev], key=key)
    assert first.status_code == 201, first.text
    again = sign(dara, oid, "R1", [ev], key=key)
    assert again.status_code == 201 and again.headers.get("Idempotent-Replayed") == "true"
    request = f"Countersignature requested: G-FNAA {dname(other)} R1"
    assert [(n["kind"], n["status"]) for n in notices_for(planner, request)] == [("countersignature_request", "queued")]

    def cards():
        return [n for n in planner.get("/api/notices")["notices"] if n["subject"].startswith(f"New revision {dn} ")]
    revise(planner, d["id"], [(ATR, 1100, 1110)])
    (first,) = cards()
    assert first["subject"] == f"New revision {dn} R2 affects your work card {card}" and first["kind"] == "card_revision"
    assert first["status"] == "queued" and USERS["dara.okafor"][5] in str(first["to"])
    assert ISO_MS.match(first["queued_at"]) and ts(first["send_after"]) >= ts(first["queued_at"])
    revise(planner, d["id"], [(ATR, 1100, 1110)], days=60)
    (second,) = cards()
    assert second["id"] == first["id"] and second["subject"] == f"New revision {dn} R3 affects your work card {card}"
    deadline = thread(planner, tid)["limits"]["deadline_date"]
    assert "R3" in second["body"] and "G-FNAA" in second["body"] and deadline in second["body"]
    assert second["id"] in [n["id"] for n in planner.get("/api/notices", status="queued")["notices"]]


def test_pack_stored_and_emailed(app_url, mail):
    planner, dara, tomasz, clerk = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "tomasz.wilk", "robin.achterberg"))
    d, _ = ingest(planner, [(ATR, 1100, 1118)])
    dn = dname(d)
    certify(dara, tomasz, threads(planner, d["id"])["G-FNAA"]["id"])
    r = clerk.call("POST", "/api/packs", {"directive_id": d["id"]}, key=idempotency_key())
    assert r.status_code == 201, r.text
    p = r.json()["pack"]
    assert (p["status"], p["waiting_for"], p["revision"], p["requested_by"]["display_name"]) == ("transmitted", None, "R1", "Robin Achterberg")
    assert ISO_MS.match(p["transmitted_at"])
    pdf, manifest = S3().get(p["pdf_key"]), S3().get(p["csv_key"])
    assert (p["pdf_key"], p["pdf_sha256"]) == (f"packs/{sha(pdf)}.pdf", sha(pdf))
    assert (p["csv_key"], p["csv_sha256"]) == (f"packs/{sha(manifest)}.csv", sha(manifest))
    assert pdf.startswith(b"%PDF-")
    for s in (d["number"], "R1", OPERATOR, "G-FNAA", "Dara Okafor"):
        assert s.encode() in pdf, s
    rows = list(csv.DictReader(io.StringIO(manifest.decode("utf-8"), newline="")))
    assert [r["registration"] for r in rows] == ["G-FNAA", "G-FNAB"]
    assert clerk.call("GET", f"/api/packs/{p['id']}/pdf").content == pdf
    assert clerk.call("GET", f"/api/packs/{p['id']}/csv").content == manifest
    poll(lambda: pack_mails(mail, p["id"]), SETTLE_S, "pack mail")
    (m,) = [x for x in mail.messages(settle=RETRY_S) if x["Subject"].startswith("Compliance pack") and p["id"] in text(x)]
    assert m["Subject"] == f"Compliance pack {dn} R1 from {OPERATOR}"
    assert mail_from_address() in addresses(m["From"]) and AUTHORITY_MAIL in addresses(m["To"])
    body = text(m)
    for s in (f"/api/packs/{p['id']}/pdf", f"PDF SHA-256: {p['pdf_sha256']}", f"CSV SHA-256: {p['csv_sha256']}"):
        assert s in body, s
    if os.environ.get("APP_PUBLIC_URL"):
        assert f"{os.environ['APP_PUBLIC_URL']}/api/packs/{p['id']}/pdf" in body
    (att,) = m.get("Attachments") or []
    assert att["FileName"] == f"{p['id']}-manifest.csv" and att["Size"] == len(manifest)
    assert addresses(m["To"]) == [AUTHORITY_MAIL] and not addresses(m.get("Cc") or []) and not addresses(m.get("Bcc") or [])
    private = [v[5] for v in USERS.values()] + [v[0] for v in USERS.values()]
    for blob in (pdf, manifest, body.encode()):
        assert not [s for s in private if s.encode() in blob]


def test_pack_all_or_nothing(mail):
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    planner, clerk = Api(base, "avery.lund"), Api(base, "robin.achterberg")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    r = clerk.call("POST", "/api/packs", {"directive_id": d["id"]}, key=idempotency_key())
    assert r.status_code == 202, r.text
    p = r.json()["pack"]
    assert (p["status"], p["waiting_for"], p["pdf_key"], p["csv_key"], p["pdf_sha256"], p["transmitted_at"]) == ("queued", "mail", None, None, None, None)
    p = poll(lambda: (x := clerk.get(f"/api/packs/{p['id']}")["pack"])["attempts"] >= 2 and x, RETRY_S + SETTLE_S, "a retried attempt")
    assert (p["status"], p["waiting_for"], p["pdf_key"]) == ("queued", "mail", None)
    err(clerk.call("GET", f"/api/packs/{p['id']}/pdf"), 409, "pack_not_transmitted")
    assert err(clerk.call("POST", "/api/packs", {"directive_id": d["id"]}, key=idempotency_key()), 409, "pack_already_queued")["pack_id"] == p["id"]

    def no_orphan_objects():
        start = clerk.get(f"/api/packs/{p['id']}")["pack"]["attempts"]
        referenced = {k for x in clerk.get("/api/packs")["packs"] if x["status"] == "transmitted" for k in (x["pdf_key"], x["csv_key"])}
        stored = set(S3("-mailpit-down").keys("packs/"))
        return stored <= referenced and clerk.get(f"/api/packs/{p['id']}")["pack"]["attempts"] == start
    poll(no_orphan_objects, RETRY_S + SETTLE_S, "pack object storage to hold only referenced keys between attempts")
    assert not pack_mails(mail, p["id"])


def test_pack_outage_recovery(mail):
    base = os.environ["APP_MINIO_DOWN_URL"]
    clerk = Api(base, "robin.achterberg")
    did = next(x["id"] for x in clerk.get("/api/directives")["directives"] if x["number"] == "ATR72-27-1088")
    r = clerk.call("POST", "/api/packs", {"directive_id": did}, key=idempotency_key())
    if r.status_code == 409:
        pid = err(r, 409, "pack_already_queued")["pack_id"]
    else:
        assert r.status_code == 202, r.text
        p = r.json()["pack"]
        assert (p["status"], p["waiting_for"], p["pdf_key"]) == ("queued", "object_storage", None)
        pid = p["id"]
    err(clerk.call("GET", f"/api/packs/{pid}/pdf"), 409, "pack_not_transmitted")
    assert not pack_mails(mail, pid)
    target = urlparse(os.environ["S3_ENDPOINT"])
    with relay(target.hostname, target.port or 80):
        p = poll(lambda: (x := clerk.get(f"/api/packs/{pid}")["pack"])["status"] == "transmitted" and x, RETRY_S + SETTLE_S, "pack transmitted")
    assert sha(S3().get(p["pdf_key"])) == p["pdf_sha256"] and sha(S3().get(p["csv_key"])) == p["csv_sha256"]
    poll(lambda: pack_mails(mail, pid), SETTLE_S, "pack mail")
    assert len([m for m in mail.messages(settle=RETRY_S) if m["Subject"].startswith("Compliance pack") and pid in text(m)]) == 1
    actors = [e["actor"] for e in clerk.get("/api/audit", directive_id=did)["entries"]]
    assert any((a["display_name"], a["licence"], a["erased"]) == ("Tailboard", None, False) for a in actors), actors
    assert p["requested_by"]["display_name"] == "Robin Achterberg"
    assert "Tailboard" not in [x["display_name"] for x in clerk.get("/api/people")["people"]]


def test_regulator_csv_export(app_url):
    planner, clerk = Api(app_url, "avery.lund"), Api(app_url, "robin.achterberg")
    title = f"=probe {uuid.uuid4().hex[:6]}"
    d, _ = ingest(planner, [(ATR, 1100, 1180)], title=title)
    notes = {"G-FNAA": "+SUM(1)", "G-FNAB": "-2", "G-FNAC": "@probe", "G-FNAD": "=1+1", "G-FNAE": FORMULA_NOTE,
             "G-FNAF": PLAIN_NOTE}
    run_import(clerk, import_csv([legacy_row(reg, d["number"], "R1", notes=n) for reg, n in notes.items()]))
    r, rows = export(clerk, d["id"])
    assert r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]

    def check(raw, parsed):
        assert raw.endswith(b"\r\n") and next(csv.reader(io.StringIO(raw.decode("utf-8"), newline=""))) == CSV_COLUMNS
        assert [x["registration"] for x in parsed] == sorted(notes)
        for x in parsed:
            assert x["title"] == "'" + title
            n = notes[x["registration"]]
            note_in_cell(x["legacy_notes"], n)
    check(r.content, rows)
    for lead in ("\t", "\r"):
        typed = f"{lead}probe {uuid.uuid4().hex[:6]}"
        e, _ = ingest(planner, [(ATR, 1100, 1102)], title=typed)
        assert [x["title"] for x in export(clerk, e["id"])[1]] == ["'" + typed]
    p = clerk.ok("POST", "/api/packs", {"directive_id": d["id"]}, key=idempotency_key())["pack"]
    manifest = S3().get(p["csv_key"])
    check(manifest, list(csv.DictReader(io.StringIO(manifest.decode("utf-8"), newline=""))))


def test_board_as_of(app_url):
    planner, dara, sol, casey = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "sol.brennan", "casey.moreau"))
    d, _ = ingest(planner, [(ATR, 1100, 1118)])
    tid = threads(planner, d["id"])["G-FNAA"]["id"]
    assert claim(dara, tid).status_code == 200
    before = {c["registration"]: (c["state"], c["stage"], c["label"], c["revision"]) for c in board_column(planner, d["id"])[2]}
    revise(planner, d["id"], [(ATR, 1100, 1110)])

    def snapshot(api):
        b = api.get("/api/board", directive_id=d["id"], as_of="R1")
        assert b["as_of"] == "R1"
        return {c["registration"]: (c["state"], c["stage"], c["label"], c["revision"]) for c in b["cells"] if c["directive_id"] == d["id"]}
    assert snapshot(casey) == snapshot(sol) == before
    assert {c["registration"]: c["stage"] for c in board_column(planner, d["id"])[2]}["G-FNAB"] == "not_applicable"
    assert effectivity(planner, tid).status_code == 200
    assert snapshot(casey) == before
    err(casey.call("GET", "/api/board", directive_id=d["id"], as_of="R9"), 404, "not_found")


def test_audit_append_only(app_url):
    planner, dara, ines, casey = (Api(app_url, u) for u in ("avery.lund", "dara.okafor", "ines.varga", "casey.moreau"))
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    tid = threads(planner, d["id"])["G-FNAA"]["id"]

    def entries():
        return casey.get("/api/audit", thread_id=tid)["entries"]
    start = len(entries())
    assert claim(dara, tid).status_code == 200
    after = entries()
    new = after[0]
    assert len(after) == start + 1 and new["actor"]["display_name"] == "Dara Okafor"
    assert (new["thread_id"], new["directive_id"]) == (tid, d["id"]) and ISO_MS.match(new["at"]) and "." in new["action"]
    err(claim(ines, tid), 403, "forbidden")
    assert len(entries()) == start + 1
    dara.ok("POST", f"/api/threads/{tid}/release", {})
    latest = entries()
    assert len(latest) == start + 2 and ts(latest[0]["at"]) >= ts(latest[1]["at"]) and latest[1] == new
    for method in ("PUT", "PATCH", "DELETE"):
        for path in ("/api/audit", f"/api/audit/{new['id']}"):
            err(planner.call(method, path, {}), 405, "method_not_allowed", f"{method} {path}")
    assert new in entries()

    def by_actor(api):
        return {e["id"]: e for e in casey.get("/api/audit")["entries"] if e["actor"]["id"] == api.user["id"]}

    def thread_ids_of(rows):
        return sorted((e["thread_id"] or "") for e in rows)
    counted, _ = ingest(planner, [(ATR, 1100, 1118)])
    made = threads(planner, counted["id"])
    rows = casey.get("/api/audit", directive_id=counted["id"])["entries"]
    assert thread_ids_of(rows) == sorted(["", *(t["id"] for t in made.values())])
    seen = {e["id"] for e in rows}
    revise(planner, counted["id"], [(ATR, 1100, 1118)])
    rows = [e for e in casey.get("/api/audit", directive_id=counted["id"])["entries"] if e["id"] not in seen]
    assert thread_ids_of(rows) == sorted(["", *(t["id"] for t in made.values())])
    clerk = Api(app_url, "robin.achterberg")
    scopes(clerk, SEED_SCOPES)
    try:
        waiting = threads(planner, ingest(planner, [(ATR, 1100, 1110)])[0]["id"])["G-FNAA"]["id"]
        inspect(dara, waiting)
        seen = by_actor(clerk)
        res = clerk.ok("PUT", f"/api/engineers/{person(clerk, 'ines.varga')['id']}/scope", {"models": [DHC]})
        passed = [s["thread_id"] for s in res["succession"]]
        assert waiting in passed
        rows = [e for i, e in by_actor(clerk).items() if i not in seen]
        assert thread_ids_of(rows) == sorted(["", *passed])
    finally:
        scopes(clerk, SEED_SCOPES)
    seen = by_actor(planner)
    log_hours(planner, "G-FNAA", 0.1)
    assert [e["thread_id"] for i, e in by_actor(planner).items() if i not in seen] == [None]


def test_viewport_layouts(browser, app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn = dname(d)
    for kind, (w, h) in {"desktop": (1280, 800), "tablet": (768, 1024), "phone": (375, 812)}.items():
        with board(browser, app_url, "avery.lund", width=w, height=h) as page:
            layout(page)
            rail = page.get_by_role("navigation", name="Directives")
            if kind == "desktop":
                expect(rail).to_be_visible()
                expect(btn(page, "Directives")).to_be_hidden()
                dlg = drawer(page, "G-FNAA", dn)
                box = dlg.bounding_box()
                g = page.get_by_role("region", name="Fleet board").bounding_box()
                assert DESKTOP_DRAWER[0] <= box["width"] / w <= DESKTOP_DRAWER[1] and g["x"] + g["width"] <= box["x"] + 1
            else:
                expect(rail).to_be_hidden()
                if kind == "phone":
                    expect(btn(page, "Menu")).to_be_visible()
                    expect(page.get_by_role("navigation", name="Sections").get_by_role("link", name="Packs")).to_be_hidden()
                    choose(page.get_by_role("combobox", name="Directive"), f"{dn} R1")
                dlg = drawer(page, "G-FNAA", dn)
                box = dlg.bounding_box()
                if kind == "tablet":
                    assert TABLET_DRAWER[0] <= box["width"] / w <= TABLET_DRAWER[1]
                else:
                    assert box["width"] >= w - 1 and box["height"] >= h - 1
                buttons = dlg.get_by_role("button")
                for i in range(buttons.count()):
                    b = buttons.nth(i).bounding_box()
                    if b and buttons.nth(i).is_visible():
                        assert b["width"] >= TAP_MIN and b["height"] >= TAP_MIN, buttons.nth(i).inner_text()
                page.keyboard.press("Escape")
                expect(dlg).to_be_hidden(timeout=UI_MS)
                click(btn(page, "Directives"))
                expect(rail).to_be_visible(timeout=UI_MS)
            layout(page)


def test_thread_drawer_contents(browser, app_url):
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    tok = uuid.uuid4().hex[:6]
    d, _ = ingest(planner, [(ATR, 1100, 1118)], method=f"Probe method {tok}")
    dn = dname(d)
    inspect(dara, threads(planner, d["id"])["G-FNAA"]["id"])
    th = threads(planner, d["id"])["G-FNAA"]
    with board(browser, app_url, "ines.varga") as page:
        dlg = drawer(page, "G-FNAA", dn)
        card = dlg.get_by_role("region", name="Work card")
        expect(card).to_contain_text(th["work_card"]["id"])
        expect(card).to_contain_text("Dara Okafor")
        chain = dlg.get_by_role("list", name="Sign-off chain")
        for s in ("Dara Okafor", "LIC-66-48213", "R1", "valid", th["certifier"]["assigned"]["display_name"], "awaiting countersignature"):
            expect(chain).to_contain_text(s)
        expect(dlg.get_by_role("list", name="Revision history").get_by_role("listitem")).to_have_count(len(th["history"]))
        expect(dlg).to_contain_text(f"Probe method {tok}")
        expect(dlg).to_contain_text(date_pattern(th["limits"]["deadline_date"]))
        expect(btn(dlg, "Countersign")).to_be_visible()
        for name in ("Claim work card", "Sign inspection", "Defer", "Reopen thread"):
            expect(btn(dlg, name)).to_have_count(0)
        click(cell(page, "G-FNAB", dn).first)
        expect(page.get_by_role("dialog", name=f"Thread G-FNAB {dn}")).to_be_visible(timeout=UI_MS)
        expect(dlg).to_have_count(0)
    with board(browser, app_url, "avery.lund") as page:
        dlg = drawer(page, "G-FNAB", dn)
        expect(btn(dlg, "Defer")).to_be_visible()
        expect(dlg.get_by_role("textbox", name="Deferral reason")).to_be_visible()
        expect(btn(dlg, "Claim work card")).to_have_count(0)
    with board(browser, app_url, "sol.brennan") as page:
        dlg = drawer(page, "G-FNAB", dn)
        expect(btn(dlg, "Claim work card")).to_be_visible()
        expect(btn(dlg, "Defer")).to_have_count(0)


def test_keyboard_and_focus(browser, app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1118)])
    dn = dname(d)
    rail = [f"{dname(x)} {x['revision']}" for x in planner.get("/api/directives")["directives"]]
    with board(browser, app_url, "avery.lund") as page:
        page.evaluate("document.activeElement && document.activeElement.blur()")
        regions = {"rail": page.get_by_role("navigation", name="Directives"),
                   "counts": page.get_by_role("group", name="Fleet counts"), "grid": grid(page)}
        stops = []
        for _ in range(len(rail) + TAB_EXTRA):
            name = tab_order(page, 1)[0]
            if name == "Search fleet" and any(n == "Search fleet" for n, _ in stops):
                break
            where = next((k for k, loc in regions.items() if loc.evaluate(FOCUS_SCRIPT)), None)
            stops.append((name, where))
        names = [n for n, _ in stops]
        top = [names.index(n) for n in ("Search fleet", "Board", "Packs", "People", "Audit", "New directive", "Sign out")]
        assert top == sorted(top), stops
        rail_stops = [i for i, (_, w) in enumerate(stops) if w == "rail"]
        assert rail_stops and min(rail_stops) > top[-1], stops
        grid_stops = [i for i, (_, w) in enumerate(stops) if w == "grid"]
        assert len(grid_stops) == 1, stops
        g = grid_stops[0]
        counts_stops = [i for i, (_, w) in enumerate(stops) if w == "counts"]
        assert g > max(rail_stops) and all(max(rail_stops) < i < g for i in counts_stops), stops
        click(cell(page, "G-FNAA", dn).first)
        dlg = page.get_by_role("dialog", name=f"Thread G-FNAA {dn}")
        expect(dlg).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Escape")
        expect(dlg).to_be_hidden()
        focused_on(cell(page, "G-FNAA", dn).first)
        page.keyboard.press("ArrowDown")
        focused_on(cell(page, "G-FNAB", dn).first)
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name=f"Thread G-FNAB {dn}")
        expect(dlg).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Escape")
        expect(dlg).to_be_hidden()
        focused_on(cell(page, "G-FNAB", dn).first)
        nd = btn(page, "New directive")
        nd.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="New directive")
        expect(dlg).to_be_visible(timeout=UI_MS)
        for _ in range(TRAP_PRESSES):
            page.keyboard.press("Tab")
            assert dlg.evaluate("el => el.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(dlg).to_be_hidden()
        expect(nd).to_be_focused()
        act = btn(page, f"Directive actions {dn}")
        act.focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu")
        expect(menu).to_be_visible(timeout=UI_MS)
        page.keyboard.press("ArrowDown")
        assert menu.evaluate(MENU_FOCUS_SCRIPT)
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(act).to_be_focused()


def test_feedback_states(browser, app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1118)])
    dn, t = dname(d), threads(planner, d["id"])
    card = t["G-FNAA"]["work_card"]["id"]
    with open_app(browser, app_url) as page:
        page.clock.resume()
        page.set_viewport_size({"width": 1280, "height": 800})
        form = page.get_by_role("form", name="Sign in")
        fill(form.get_by_role("textbox", name="Username"), "dara.okafor")
        fill(form.get_by_label("Passcode"), "wrong-probe")
        click(btn(form, "Sign in"))
        expect(alert(page)).to_contain_text("Username or passcode is wrong.", timeout=UI_MS)
        with held(page, "**/api/session") as gate:
            fill(form.get_by_label("Passcode"), USERS["dara.okafor"][0])
            click(btn(form, "Sign in"))
            expect(status(page)).to_contain_text("Signing in…", timeout=UI_MS)
            gate.release()
        expect(grid(page)).to_be_visible(timeout=UI_MS)
        dlg = drawer(page, "G-FNAA", dn)
        with held(page, "**/claim") as gate:
            click(btn(dlg, "Claim work card"))
            expect(status(page)).to_contain_text(f"Claiming {card}…", timeout=UI_MS)
            gate.release()
        expect(status(page)).to_contain_text(f"Work card {card} is yours.", timeout=UI_MS)
        keys = []

        def drop(route):
            keys.append(route.request.headers.get("idempotency-key"))
            route.abort()
        page.route("**/api/threads/*/claim", drop)
        dlg = drawer(page, "G-FNAB", dn)
        click(btn(dlg, "Claim work card"))
        expect(status(page)).to_contain_text("Connection lost. Retrying with the same request.", timeout=UI_MS)
        expect(alert(page)).to_contain_text("Still offline. Nothing was confirmed. Press again to retry with the same request.", timeout=UI_MS)
        assert 2 <= len(keys) <= 4 and len(set(keys)) == 1 and keys[0]
        page.unroute("**/api/threads/*/claim")
        assert thread(planner, t["G-FNAB"]["id"])["stage"] == "open"
        value = next(c["value"] for c in page.context.cookies() if c["name"] == "tb_session")
        assert httpx.delete(app_url + "/api/session", cookies={"tb_session": value}, timeout=HTTP_S).status_code == 204
        click(cell(page, "G-FNAA", dn).first)
        expect(page.get_by_text("Your session has ended. Sign in again.")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("form", name="Sign in")).to_be_visible()
    base = os.environ["APP_MINIO_DOWN_URL"]
    dara = Api(base, "dara.okafor")
    did = next(x["id"] for x in dara.get("/api/directives")["directives"] if x["number"] == "ATR72-27-1088")
    tid = threads(dara, did)["G-FNAI"]["id"]
    assert claim(dara, tid).status_code == 200
    try:
        with board(browser, base, "dara.okafor") as page:
            dlg = drawer(page, "G-FNAI", "ATR ATR72-27-1088")
            dlg.get_by_label("Attach evidence").set_input_files({"name": "lug.jpg", "mimeType": "image/jpeg", "buffer": jpeg_bytes()})
            expect(alert(page)).to_contain_text("Evidence storage is unavailable. Nothing was attached.", timeout=UI_MS)
        assert thread(dara, tid)["evidence"] == []
    finally:
        dara.call("POST", f"/api/threads/{tid}/release", {})


def test_wf_cross_cutting_sign_in(browser, app_url):
    with open_app(browser, app_url) as page:
        page.clock.resume()
        sign_in(page, "noor.haddad")
        banner = page.get_by_role("banner")
        expect(banner).to_contain_text("Tailboard")
        assert page.request.get(app_url + "/api/session").json()["user"]["username"] == "noor.haddad"
        click(btn(banner, "Sign out"))
        expect(page.get_by_role("form", name="Sign in")).to_be_visible(timeout=UI_MS)
        assert page.request.get(app_url + "/api/session").status == 401


def test_wf_cross_cutting_phone_menu(browser, app_url):
    with board(browser, app_url, "robin.achterberg", width=375, height=812) as page:
        click(btn(page, "Menu"))
        click(page.get_by_role("navigation", name="Sections").get_by_role("link", name="Packs"))
        expect(page.get_by_role("table", name="Compliance packs")).to_be_visible(timeout=UI_MS)
        layout(page)
    assert Api(app_url, "robin.achterberg").get("/api/packs")["packs"] is not None


def test_wf_ingest_directive_happy(browser, app_url):
    planner = Api(app_url, "avery.lund")
    number, data = number_for("EASA"), pdf_bytes()
    dn = f"EASA {number}"
    with board(browser, app_url, "avery.lund") as page:
        n0 = planner.get("/api/board")["totals"]["open"]
        poll(lambda: fleet_count(page, "Open") == n0, UI_MS / 1000, "the board's Open count to match the server")
        click(btn(page, "New directive"))
        dlg = page.get_by_role("dialog", name="New directive")
        fill_directive(dlg, authority="EASA", number=number, title="=Probe board ingest", effective=today(planner).isoformat(),
                       days=365, fh=600.0, method="Probe", model=ATR, first=1100, last=1135, document=data)
        click(btn(dlg, "Ingest"))
        expect(status(page)).to_contain_text(f"{dn} R1 ingested.", timeout=UI_MS)
        expect(header(page, dn, "R1")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("navigation", name="Directives").get_by_role("link", name=re.compile("^" + re.escape(f"{dn} R1")))).to_be_visible()
        for reg in ("G-FNAA", "G-FNAB", "G-FNAC"):
            expect(cell(page, reg, dn, "R1", "Open")).to_have_count(1)
        expect(page.get_by_role("group", name="Fleet counts")).to_contain_text(f"Open {n0 + 3}", timeout=UI_MS)
    d = next(x for x in planner.get("/api/directives")["directives"] if x["number"] == number)
    assert sorted(threads(planner, d["id"])) == ["G-FNAA", "G-FNAB", "G-FNAC"]
    assert S3().get(d["revisions"][0]["document_key"]) == data
    assert board_column(planner, d["id"])[1]["counts"] == counts_of(open=3) == recount(planner, d["id"])
    assert [r["title"] for r in export(planner, d["id"])[1]] == ["'=Probe board ingest"] * 3


def test_wf_ingest_directive_invalid(browser, app_url):
    planner = Api(app_url, "avery.lund")
    good = number_for("EASA")
    bad = good.replace("-", "")
    with board(browser, app_url, "avery.lund") as page:
        click(btn(page, "New directive"))
        dlg = page.get_by_role("dialog", name="New directive")
        fill_directive(dlg, authority="EASA", number=bad, title="Probe invalid", effective=today(planner).isoformat(),
                       days=365, fh=600.0, method="Probe", model=ATR, first=1100, last=1110, document=pdf_bytes())
        click(btn(dlg, "Ingest"))
        num = dlg.get_by_role("textbox", name="Directive number")
        expect(num).to_be_focused(timeout=UI_MS)
        expect(dlg).to_be_visible()
        assert not any(x["number"] in (bad, good) for x in planner.get("/api/directives")["directives"])
        fill(num, good)
        click(btn(dlg, "Ingest"))
        expect(status(page)).to_contain_text(f"EASA {good} R1 ingested.", timeout=UI_MS)
        expect(dlg).to_be_hidden()
    d = next(x for x in planner.get("/api/directives")["directives"] if x["number"] == good)
    assert list(threads(planner, d["id"])) == ["G-FNAA"]


REFRESH_CASES = ["dialog-values", "caret", "scroll", "pending-copy", "splice-once"]
REFRESH_TITLE = "Probe title that survives the refetch"
REFRESH_METHOD = "Probe method that survives the refetch"
TRIGGER_MSN = 1244
RANGE2_FIRST = 4388
RANGE2_LAST = 4402
MATRIX_COLUMNS = 10
FEED_MS = LIVE_FEED_S * 1000 + UI_MS
SCROLL_SET = """el => { let n = el; while (n && n.scrollWidth <= n.clientWidth) n = n.parentElement;
  if (!n) return null; n.scrollLeft = Math.min(200, n.scrollWidth - n.clientWidth); n.scrollTop = 0;
  return [n.scrollLeft, n.scrollTop]; }"""
SCROLL_GET = """el => { let n = el; while (n && n.scrollWidth <= n.clientWidth) n = n.parentElement;
  return n ? [n.scrollLeft, n.scrollTop] : null; }"""
ACTIVE_TAG = "document.activeElement && document.activeElement.tagName"
BODY_TAG = "BODY"


@pytest.mark.parametrize("case", REFRESH_CASES, ids=REFRESH_CASES)
def test_wf_ingest_directive_refresh_keeps_work(browser, app_url, case):
    planner, noor = Api(app_url, "avery.lund"), Api(app_url, "noor.haddad")
    trigger, _ = ingest(planner, [(ATR, TRIGGER_MSN, TRIGGER_MSN)])
    tn, spare = dname(trigger), threads(planner, trigger["id"])["G-FNAJ"]["id"]
    assert thread(planner, spare)["stage"] == "open" and thread(planner, spare)["deferral"] is None
    d = dn = None
    if case == "splice-once":
        d, _ = ingest(planner, [(ATR, 1100, 1135)])
        dn = dname(d)
    if case == "scroll":
        for _ in range(MATRIX_COLUMNS):
            ingest(planner, [(ATR, 1100, 1102)])
    with board(browser, app_url, "avery.lund") as page:
        expect(cell(page, "G-FNAJ", tn, "R1", "Open")).to_have_count(1, timeout=UI_MS)

        def refetch():
            assert defer(noor, spare).status_code == 201
            assert thread(planner, spare)["stage"] == "deferred"
            expect(cell(page, "G-FNAJ", tn, "R1", "Deferred", hidden=True)).to_have_count(1, timeout=FEED_MS)

        if case == "splice-once":
            expect(header(page, dn, "R1")).to_be_visible(timeout=UI_MS)
            expect(grid(page)).to_have_attribute("aria-busy", "false")
            grid(page).evaluate(BUSY_SCRIPT)
            ui_ingest_revision(page, dn, 1100, 1135, today(planner).isoformat())
            banner = page.get_by_role("status", name="Revision changes")
            phrase = f"{len(threads(planner, d['id']))} retargeted"
            expect(banner).to_contain_text(phrase, timeout=FEED_MS + SPLICE_MAX_MS)
            expect(header(page, dn, "R2")).to_be_visible(timeout=UI_MS)
            expect(grid(page)).to_have_attribute("aria-busy", "false", timeout=UI_MS)
            refetch()
            assert sum(t.count(phrase) for t in banner.all_inner_texts()) == 1
            marks, flips, previous = page.evaluate("window.__busy"), 0, "false"
            for _, value in marks:
                if value == "true" and previous != "true":
                    flips += 1
                previous = value
            assert flips == 1, marks
            return
        if case == "scroll":
            offsets = poll(lambda: grid(page).evaluate(SCROLL_SET), UI_MS / 1000,
                           "a scrollable matrix region around the compliance matrix")
            assert offsets[0] > 0, offsets
            refetch()
            assert grid(page).evaluate(SCROLL_GET) == offsets
            return
        click(btn(page, "New directive"))
        dlg = page.get_by_role("dialog", name="New directive")
        number, document = number_for("EASA"), pdf_bytes()
        fill_directive(dlg, authority="EASA", number=number, title=REFRESH_TITLE,
                       effective=today(planner).isoformat(), days=365, fh=600.0, method=REFRESH_METHOD,
                       model=ATR, first=1100, last=1135, document=document)
        group = dlg.get_by_role("group", name="Applicability")
        click(btn(group, "Add range"))
        choose(group.get_by_role("combobox", name="Model").nth(1), MODEL_LABELS[DHC], DHC)
        fill(group.get_by_role("spinbutton", name="First serial").nth(1), str(RANGE2_FIRST))
        fill(group.get_by_role("spinbutton", name="Last serial").nth(1), str(RANGE2_LAST))
        if case == "pending-copy":
            tag, answered = "R1", []

            def answer(route):
                if route.request.method == "POST":
                    answered.append((route, route.fetch()))
                else:
                    route.fallback()

            page.route("**/api/directives", answer)
            opened = fleet_count(page, "Open", hidden=True)
            click(btn(dlg, "Ingest"))
            expect(status(page)).to_contain_text(f"Ingesting {tag}…", timeout=UI_MS)
            poll(lambda: bool(status(page).inner_text()) and len(answered) == 1, UI_MS / 1000,
                 "the held ingest request to reach the server")
            want = planner.get("/api/board")["totals"]["open"]
            assert want > opened
            poll(lambda: fleet_count(page, "Open", hidden=True) == want, FEED_MS / 1000,
                 "the live feed to report the pending ingest on the board")
            expect(header(page, f"EASA {number}", tag, hidden=True)).to_have_count(1)
            expect(dlg).to_be_visible()
            expect(status(page)).to_contain_text(f"Ingesting {tag}…")
            for route, reply in answered:
                route.fulfill(response=reply)
            page.unroute("**/api/directives", answer)
            expect(status(page)).to_contain_text(f"EASA {number} {tag} ingested.", timeout=UI_MS)
            expect(dlg).to_be_hidden(timeout=UI_MS)
            return
        if case == "dialog-values":
            refetch()
            expect(dlg).to_be_visible()
            expect(dlg.get_by_role("textbox", name="Title")).to_have_value(REFRESH_TITLE)
            expect(dlg.get_by_role("textbox", name="Directive number")).to_have_value(number)
            expect(dlg.get_by_role("textbox", name="Method of compliance")).to_have_value(REFRESH_METHOD)
            expect(group.get_by_role("combobox", name="Model")).to_have_count(2)
            expect(group.get_by_role("spinbutton", name="First serial").nth(1)).to_have_value(str(RANGE2_FIRST))
            expect(group.get_by_role("spinbutton", name="Last serial").nth(1)).to_have_value(str(RANGE2_LAST))
            click(btn(dlg, "Ingest"))
            expect(status(page)).to_contain_text(f"EASA {number} R1 ingested.", timeout=UI_MS)
            made = next(x for x in planner.get("/api/directives")["directives"] if x["number"] == number)
            kept = planner.get(f"/api/directives/{made['id']}")["directive"]["revisions"][0]
            assert (kept["title"], kept["method"]) == (REFRESH_TITLE, REFRESH_METHOD)
            assert sorted(threads(planner, made["id"])) == ["G-FNAA", "G-FNAB", "G-FNAC", "G-FNBA", "G-FNBB"]
            assert S3().get(kept["document_key"]) == document
            return
        box = dlg.get_by_role("textbox", name="Title")
        box.evaluate("el => { el.focus(); el.setSelectionRange(3, 3); }")
        expect(box).to_be_focused(timeout=UI_MS)
        refetch()
        expect(dlg).to_be_visible()
        expect(box).to_be_focused(timeout=UI_MS)
        assert box.evaluate("el => el.selectionStart") == 3


def ui_ingest_revision(page, dn, first, last, effective):
    click(btn(page, f"Directive actions {dn}"))
    click(page.get_by_role("menuitem", name="Ingest revision"))
    dlg = page.get_by_role("dialog", name=f"Ingest revision {dn}")
    fill_directive(dlg, title="Probe board revision", effective=effective, days=90, fh=300.0, method="Probe",
                   model=ATR, first=first, last=last, document=pdf_bytes())
    click(btn(dlg, "Ingest"))
    expect(status(page)).to_contain_text(f"{dn} R2 ingested.", timeout=UI_MS)


def test_wf_revision_splice_own(browser, app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1180)])
    dn, before = dname(d), threads(planner, d["id"])
    with board(browser, app_url, "avery.lund") as page:
        ui_ingest_revision(page, dn, 1100, 1163, today(planner).isoformat())
        old, new, n = "R1", "R2", {"retargeted": 5, "added": 0, "removed": 1, "kept": 0}
        expect(page.get_by_role("status", name="Revision changes")).to_contain_text(
            f"{new} supersedes {old}: {n['retargeted']} retargeted, {n['added']} added, {n['removed']} removed, "
            f"{n['kept']} kept under {old}", timeout=UI_MS)
        expect(header(page, dn, "R2")).to_be_visible(timeout=UI_MS)
    after = threads(planner, d["id"])
    assert {r: x["id"] for r, x in after.items()} == {r: x["id"] for r, x in before.items()}
    assert after["G-FNAF"]["stage"] == "not_applicable"
    assert (after["G-FNAA"]["history"][0]["revision"], after["G-FNAA"]["history"][0]["outcome"]) == ("R1", "retargeted")


def test_wf_revision_splice_live(browser, app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1180)])
    dn = dname(d)
    with board(browser, app_url, "avery.lund") as avery, board(browser, app_url, "noor.haddad") as noor:
        expect(header(avery, dn, "R1")).to_be_visible(timeout=UI_MS)
        ui_ingest_revision(noor, dn, 1100, 1163, today(planner).isoformat())
        expect(header(avery, dn, "R2")).to_be_visible(timeout=LIVE_FEED_S * 1000 + SPLICE_MAX_MS)
        expect(grid(avery)).to_have_attribute("aria-busy", "false", timeout=UI_MS)
        for c in board_column(planner, d["id"])[2]:
            expect(cell(avery, c["registration"], dn, c["revision"], c["label"])).to_have_count(1, timeout=UI_MS)
        totals = planner.get("/api/board")["totals"]
        for word, k in COUNT_WORDS:
            expect(avery.get_by_role("group", name="Fleet counts")).to_contain_text(f"{word} {totals[k]}", timeout=UI_MS)
        expect(view_under(avery, dn, "R1")).to_be_visible()
    assert board_column(planner, d["id"])[1]["revision"] == "R2"


def test_wf_effectivity_and_withdrawal_confirm(browser, app_url):
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn, tid = dname(d), threads(planner, d["id"])["G-FNAA"]["id"]
    revise(planner, d["id"], [(ATR, 1100, 1110)])
    err(claim(dara, tid), 409, "effectivity_unconfirmed")
    with board(browser, app_url, "avery.lund") as page:
        dlg = drawer(page, "G-FNAA", dn)
        fill(dlg.get_by_role("textbox", name="Effectivity reason"), "Serial checked against the revision")
        click(btn(dlg, "Confirm effectivity"))
        expect(status(page)).to_contain_text("Effectivity confirmed.", timeout=UI_MS)
        click(btn(dlg, "Close thread panel"))
        expect(cell(page, "G-FNAA", dn, "R2", "Open")).to_be_visible(timeout=UI_MS)
    assert thread(planner, tid)["stage"] == "open"


def test_wf_effectivity_and_withdrawal_withdraw(browser, app_url):
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    d, _ = ingest(planner, [(ATR, 1100, 1118)])
    dn = dname(d)
    assert claim(dara, threads(planner, d["id"])["G-FNAA"]["id"]).status_code == 200
    with board(browser, app_url, "avery.lund") as page:
        click(btn(page, f"Directive actions {dn}"))
        click(page.get_by_role("menuitem", name="Withdraw directive"))
        dlg = page.get_by_role("dialog", name=f"Withdraw {dn}")
        fill(dlg.get_by_role("textbox", name="Withdrawal reason"), "Cancelled by the authority")
        click(btn(dlg, "Withdraw"))
        expect(status(page)).to_contain_text(f"{dn} withdrawn. History kept.", timeout=UI_MS)
        expect(page.get_by_role("navigation", name="Directives")).to_contain_text(re.compile(re.escape(f"{dn} R1") + r"\s*withdrawn"), timeout=UI_MS)
        stub = cell(page, "G-FNAA", dn, "R1", "Withdrawn")
        expect(stub).to_be_visible(timeout=UI_MS)
        expect(stub.get_by_role("link", name="Thread history")).to_be_visible()
    _, entry, _ = board_column(planner, d["id"])
    assert entry["status"] == "withdrawn" and entry["counts"] == counts_of() == recount(planner, d["id"])
    assert threads(planner, d["id"])["G-FNAA"]["work_card"]["holder"] is None


COLLEAGUE_CASES = ["cells-counts-rail", "drawer-in-place", "controls-removed", "focus-to-heading",
                   "stale-press-conflict"]


@pytest.mark.parametrize("case", COLLEAGUE_CASES, ids=COLLEAGUE_CASES)
def test_wf_effectivity_and_withdrawal_colleague_drawer(browser, app_url, case):
    planner, noor = Api(app_url, "avery.lund"), Api(app_url, "noor.haddad")
    d, _ = ingest(planner, [(ATR, 1100, 1118)])
    revise(planner, d["id"], [(ATR, 1100, 1118)])
    dn, tid = dname(d), threads(planner, d["id"])["G-FNAA"]["id"]
    assert thread(planner, tid)["stage"] == "superseded_retargeted"
    with board(browser, app_url, "avery.lund") as page:
        expect(cell(page, "G-FNAA", dn, "R2", "Superseded")).to_have_count(1, timeout=UI_MS)
        if case == "cells-counts-rail":
            assert effectivity(noor, tid).status_code == 200
            assert thread(planner, tid)["stage"] == "open"
            for c in planner.get("/api/board", directive_id=d["id"])["cells"]:
                expect(cell(page, c["registration"], dn, c["revision"], c["label"])).to_have_count(1, timeout=FEED_MS)
            poll(lambda: all(fleet_count(page, w) == planner.get("/api/board")["totals"][k] for w, k in COUNT_WORDS),
                 FEED_MS / 1000, "the fleet counts to match a fresh server recount after a colleague's decision")
            assert withdraw(noor, d["id"])["status"] == "withdrawn"
            expect(page.get_by_role("navigation", name="Directives")).to_contain_text(
                re.compile(re.escape(f"{dn} R2") + r"\s*withdrawn"), timeout=FEED_MS)
            for reg in ("G-FNAA", "G-FNAB"):
                expect(cell(page, reg, dn, "R2", "Withdrawn")).to_have_count(1, timeout=FEED_MS)
            assert next(x for x in planner.get("/api/board", directive_id=d["id"])["directives"]
                        if x["id"] == d["id"])["counts"] == counts_of()
            poll(lambda: all(fleet_count(page, w) == planner.get("/api/board")["totals"][k] for w, k in COUNT_WORDS),
                 FEED_MS / 1000, "the fleet counts to match a fresh server recount after a colleague's withdrawal")
            return
        dlg = drawer(page, "G-FNAA", dn)
        expect(dlg).to_contain_text("Superseded", timeout=UI_MS)
        if case == "stale-press-conflict":
            fill(dlg.get_by_role("textbox", name="Effectivity reason"), "Serial checked against the revision")
            with held(page, "**/api/events"), held(page, "**/api/threads/*/effectivity") as gate:
                click(btn(dlg, "Confirm effectivity"))
                expect(status(page)).to_contain_text("Saving…", timeout=UI_MS)
                assert effectivity(noor, tid).status_code == 200
                gate.release()
            expect(alert(page)).to_contain_text("This thread no longer needs confirmation.", timeout=UI_MS)
            expect(dlg).to_be_visible()
            return
        handle = dlg.element_handle()
        if case == "focus-to-heading":
            btn(dlg, "Confirm effectivity").focus()
        assert effectivity(noor, tid).status_code == 200
        if case == "drawer-in-place":
            expect(dlg).to_contain_text(thread(planner, tid)["label"], timeout=FEED_MS)
            expect(dlg).to_be_visible()
            assert handle.evaluate("el => el.isConnected")
            return
        if case == "controls-removed":
            poll(lambda: dlg.get_by_role("textbox", name="Effectivity reason").count() == 0, FEED_MS / 1000,
                 "the drawer to drop Effectivity reason after a colleague's decision")
            assert btn(dlg, "Confirm effectivity").count() == 0
            assert btn(dlg, "Mark not applicable").count() == 0
            return
        poll(lambda: btn(dlg, "Confirm effectivity").count() == 0, FEED_MS / 1000,
             "the colleague's decision to remove Confirm effectivity from the open drawer")
        focused_on(dlg)
        assert page.evaluate(ACTIVE_TAG) != BODY_TAG


def test_wf_claim_and_inspect_happy(browser, app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn = dname(d)
    card = threads(planner, d["id"])["G-FNAA"]["work_card"]["id"]
    photo = jpeg_bytes()
    with board(browser, app_url, "dara.okafor") as page:
        dlg = drawer(page, "G-FNAA", dn)
        click(btn(dlg, "Claim work card"))
        expect(status(page)).to_contain_text(f"Work card {card} is yours.", timeout=UI_MS)
        dlg.get_by_label("Attach evidence").set_input_files({"name": "lug.jpg", "mimeType": "image/jpeg", "buffer": photo})
        expect(status(page)).to_contain_text("Evidence attached.", timeout=UI_MS)
        fill(dlg.get_by_role("textbox", name="Method reference"), "AMM task")
        fill(dlg.get_by_role("textbox", name="Findings"), "No defects found")
        click(btn(dlg, "Sign inspection"))
        tag = "R1"
        expect(status(page)).to_contain_text(f"Inspection signed under {tag}, on time.", timeout=UI_MS)
        chain = dlg.get_by_role("list", name="Sign-off chain")
        expect(chain).to_contain_text("Dara Okafor")
        expect(chain).to_contain_text("awaiting countersignature")
        t = threads(planner, d["id"])["G-FNAA"]
        expect(chain).to_contain_text(t["certifier"]["assigned"]["display_name"])
    assert t["stage"] == "inspected" and [s["revision"] for s in t["signatures"]] == ["R1"]
    assert S3().get(t["evidence"][0]["key"]) == photo and t["evidence"][0]["sha256"] == sha(photo)


def test_wf_claim_and_inspect_contended(browser, app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn = dname(d)
    with board(browser, app_url, "dara.okafor") as one, board(browser, app_url, "sol.brennan") as two:
        a, b = drawer(one, "G-FNAA", dn), drawer(two, "G-FNAA", dn)
        rival = btn(b, "Claim work card")
        click(btn(a, "Claim work card"))
        try:
            rival.click(timeout=RIVAL_PRESS_MS)
        except PlaywrightError:
            pass
        holder = poll(lambda: threads(planner, d["id"])["G-FNAA"]["work_card"]["holder"], SETTLE_S, "holder")
        loser = two if holder["display_name"] == "Dara Okafor" else one
        expect(drawer(loser, "G-FNAA", dn)).to_contain_text(holder["display_name"], timeout=UI_MS)
    assert threads(planner, d["id"])["G-FNAA"]["stage"] == "claimed"


LOSER_CASES = ["drawer-in-place", "claim-control-gone", "focus-to-heading", "stale-press-card-held"]


@pytest.mark.parametrize("case", LOSER_CASES, ids=LOSER_CASES)
def test_wf_claim_and_inspect_losing_claimant(browser, app_url, case):
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn = dname(d)
    work = threads(planner, d["id"])["G-FNAA"]
    tid, card, holder = work["id"], work["work_card"]["id"], USERS["dara.okafor"][1]
    with board(browser, app_url, "sol.brennan") as page:
        dlg = drawer(page, "G-FNAA", dn)
        if case == "stale-press-card-held":
            with held(page, "**/api/events"), held(page, "**/api/threads/*/claim") as gate:
                click(btn(dlg, "Claim work card"))
                expect(status(page)).to_contain_text(f"Claiming {card}…", timeout=UI_MS)
                assert claim(dara, tid).status_code == 200
                gate.release()
            expect(alert(page)).to_contain_text(f"Already held by {holder}.", timeout=UI_MS)
            expect(dlg).to_be_visible()
            assert thread(planner, tid)["work_card"]["holder"]["display_name"] == holder
            return
        handle = dlg.element_handle()
        if case == "focus-to-heading":
            btn(dlg, "Claim work card").focus()
        assert claim(dara, tid).status_code == 200
        if case == "drawer-in-place":
            expect(dlg.get_by_role("region", name="Work card")).to_contain_text(holder, timeout=FEED_MS)
            expect(dlg).to_be_visible()
            assert handle.evaluate("el => el.isConnected")
            return
        if case == "claim-control-gone":
            poll(lambda: btn(dlg, "Claim work card").count() == 0, FEED_MS / 1000,
                 "the drawer to drop Claim work card for the losing claimant")
            return
        poll(lambda: btn(dlg, "Claim work card").count() == 0, FEED_MS / 1000,
             "Dara's claim to remove Claim work card from Sol's open drawer")
        focused_on(dlg)
        assert page.evaluate(ACTIVE_TAG) != BODY_TAG


def test_wf_sign_off_timing_hours(browser, app_url):
    planner = Api(app_url, "avery.lund")
    reg = "G-FNBH"
    before = tail_total(planner, reg)
    with board(browser, app_url, "avery.lund") as page:
        click(page.get_by_role("rowheader", name=reg))
        dlg = page.get_by_role("dialog", name=f"Tail {reg}")
        fill(dlg.get_by_role("spinbutton", name="Sector hours"), "1.5")
        click(btn(dlg, "Log hours"))
        expect(status(page)).to_contain_text(f"{reg} now at {before + 1.5:.1f} FH.", timeout=UI_MS)
    assert round(tail_total(planner, reg), 1) == round(before + 1.5, 1)


def test_wf_sign_off_timing_defer(browser, app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1110)], fh=6000.0)
    dn = dname(d)
    limits0 = threads(planner, d["id"])["G-FNAA"]["limits"]
    old = limits0["deadline_date"]
    new = (date.fromisoformat(old) + timedelta(days=DEFER_DAYS)).isoformat()
    with board(browser, app_url, "avery.lund") as page:
        dlg = drawer(page, "G-FNAA", dn)
        fill(dlg.get_by_role("textbox", name="Deferral reason"), "Awaiting de-icer boot kit")
        click(btn(dlg, "Defer"))
        expect(status(page)).to_contain_text(f"Deferred. New due {new}.", timeout=UI_MS)
    t = threads(planner, d["id"])["G-FNAA"]
    assert t["stage"] == "deferred" and t["limits"]["deadline_date"] == new
    assert round(t["limits"]["fh_threshold"], 1) == round(limits0["fh_threshold"] + DEFER_HOURS, 1)
    err(planner.call("POST", f"/api/threads/{t['id']}/deferral", {"reason": "Awaiting de-icer boot kit"},
                     key=idempotency_key()), 409, "already_deferred")
    assert threads(planner, d["id"])["G-FNAA"]["limits"]["deadline_date"] == new
    assert board_column(planner, d["id"])[1]["counts"] == recount(planner, d["id"])


def test_wf_countersign_and_succession_happy(browser, app_url):
    planner, sol = Api(app_url, "avery.lund"), Api(app_url, "sol.brennan")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn = dname(d)
    inspect(sol, threads(planner, d["id"])["G-FNAA"]["id"])
    with board(browser, app_url, "tomasz.wilk") as page:
        dlg = drawer(page, "G-FNAA", dn)
        click(btn(dlg, "Countersign"))
        tag = "R1"
        expect(status(page)).to_contain_text(f"Countersigned under {tag}. Thread closed.", timeout=UI_MS)
        click(btn(dlg, "Close thread panel"))
        expect(cell(page, "G-FNAA", dn, "R1", "Complied")).to_be_visible(timeout=UI_MS)
    t = threads(planner, d["id"])["G-FNAA"]
    assert t["stage"] == "certified"
    assert (t["signatures"][-1]["kind"], t["signatures"][-1]["signer"]["display_name"]) == ("countersignature", "Tomasz Wilk")


def test_wf_countersign_and_succession_scope(browser, app_url):
    planner, sol, clerk = Api(app_url, "avery.lund"), Api(app_url, "sol.brennan"), Api(app_url, "robin.achterberg")
    scopes(clerk, SEED_SCOPES)
    try:
        d, _ = ingest(planner, [(ATR, 1100, 1110)])
        tid = threads(planner, d["id"])["G-FNAA"]["id"]
        assert inspect(sol, tid)["thread"]["certifier"]["assigned"]["display_name"] == "Ines Varga"
        with board(browser, app_url, "robin.achterberg") as page:
            click(page.get_by_role("navigation", name="Sections").get_by_role("link", name="People"))
            engineer = USERS["ines.varga"][1]
            click(btn(page, f"Edit scope {engineer}"))
            dlg = page.get_by_role("dialog", name=f"Certification scope {engineer}")
            box = dlg.get_by_role("checkbox", name="ATR 72")
            expect(box).to_be_checked()
            click(box)
            click(btn(dlg, "Save scope"))
            expect(status(page)).to_contain_text(re.compile(r"Scope saved\. \d+ threads passed on\."), timeout=UI_MS)
        assert ATR not in person(clerk, "ines.varga")["scope"]
        assert thread(planner, tid)["certifier"]["assigned"]["display_name"] == "Tomasz Wilk"
    finally:
        scopes(clerk, SEED_SCOPES)


def test_wf_fleet_board_search(browser, app_url):
    planner = Api(app_url, "avery.lund")
    tok = uuid.uuid4().hex[:10]
    d, _ = ingest(planner, [(ATR, 1100, 1110)], title=f"Probe find {tok}")
    dn = dname(d)
    with board(browser, app_url, "avery.lund") as page:
        box = page.get_by_role("searchbox", name="Search fleet")
        expect(box).to_have_attribute("placeholder", "Tail, directive, person or licence")
        fill(box, tok)
        advance(page, SEARCH_PAUSE_MS)
        link = page.get_by_role("list", name="Search results").get_by_role("link", name=f"{dn} R1 Probe find {tok}")
        expect(link).to_be_visible(timeout=UI_MS)
        click(link)
        expect(header(page, dn, "R1")).to_be_in_viewport(timeout=UI_MS)
    assert any(x["id"] == d["id"] for x in planner.get("/api/search", q=tok)["results"])


def test_wf_fleet_board_live(browser, app_url):
    planner, noor = Api(app_url, "avery.lund"), Api(app_url, "noor.haddad")
    d, _ = ingest(planner, [(ATR, 1100, 1110)], fh=6000.0)
    dn = dname(d)
    with board(browser, app_url, "avery.lund") as page:
        expect(cell(page, "G-FNAA", dn, "R1", "Open")).to_be_visible(timeout=UI_MS)
        assert defer(noor, threads(noor, d["id"])["G-FNAA"]["id"]).status_code == 201
        expect(cell(page, "G-FNAA", dn, "R1", "Deferred")).to_be_visible(timeout=LIVE_FEED_S * 1000)
    assert threads(planner, d["id"])["G-FNAA"]["stage"] == "deferred"


def wf_import_file(number):
    return import_csv([legacy_row("G-FNAA", number, "R1", "complied", notes=FORMULA_NOTE), legacy_row(UNKNOWN_TAIL, number, "R1"),
                       legacy_row("G-FNAB", number, "R1", "pending")])


def ui_import(page, data):
    click(btn(page, "Import history"))
    dlg = page.get_by_role("dialog", name="Import history")
    dlg.get_by_label("History file").set_input_files({"name": "history.csv", "mimeType": "text/csv", "buffer": data})
    click(btn(dlg, "Import"))
    return dlg


def test_wf_legacy_import_happy(browser, app_url):
    planner, clerk = Api(app_url, "avery.lund"), Api(app_url, "robin.achterberg")
    d, _ = ingest(planner, [(ATR, 1100, 1120)])
    data = wf_import_file(d["number"])
    with board(browser, app_url, "robin.achterberg") as page:
        dlg = ui_import(page, data)
        merged, dups, orphans, rejected = 1, 0, 1, 1
        expect(status(page)).to_contain_text(
            f"Import finished: {merged} merged, {dups} duplicates, {orphans} orphans, {rejected} rejected.", timeout=UI_MS)
        result = dlg.get_by_role("region", name="Import result")
        expect(result.get_by_role("table", name="Orphan rows")).to_contain_text(re.compile("G-?ZZZZ", re.I))
        expect(result.get_by_role("table", name="Rejected rows")).to_contain_text("status")
    assert [i["merged"] for i in imports_with(clerk, data)] == [1]
    t = threads(planner, d["id"])["G-FNAA"]
    assert t["stage"] == "certified" and {s["kind"] for s in t["signatures"]} == {"legacy"}
    counts = board_column(planner, d["id"])[1]["counts"]
    assert counts["complied"] == 1 and counts == recount(planner, d["id"])
    rows = {r["registration"]: r for r in export(planner, d["id"])[1]}
    note_in_cell(rows["G-FNAA"]["legacy_notes"], FORMULA_NOTE)
    result = imports_with(clerk, data)[0]
    assert [(tail_key(o["tail"]), o["reason"]) for o in result["orphans"]] == [(tail_key(UNKNOWN_TAIL), "unknown_tail")]
    assert [r["field"] for r in result["rejected"]] == ["status"]
    untouched = threads(planner, d["id"])["G-FNAB"]
    assert untouched["stage"] == "open" and untouched["signatures"] == []
    assert untouched["history"][0]["legacy_records"] == []


def test_wf_legacy_import_reimport(browser, app_url):
    planner, clerk = Api(app_url, "avery.lund"), Api(app_url, "robin.achterberg")
    d, _ = ingest(planner, [(ATR, 1100, 1120)])
    data = wf_import_file(d["number"])
    with board(browser, app_url, "robin.achterberg") as page:
        dlg = ui_import(page, data)
        expect(status(page)).to_contain_text("Import finished:", timeout=UI_MS)
        counts = board_column(planner, d["id"])[1]["counts"]
        if dlg.is_visible():
            dlg.get_by_label("History file").set_input_files({"name": "history.csv", "mimeType": "text/csv", "buffer": data})
            click(btn(dlg, "Import"))
        else:
            ui_import(page, data)
        expect(page.get_by_text("This file was already imported. Nothing changed.")).to_be_visible(timeout=UI_MS)
    assert len(imports_with(clerk, data)) == 1
    assert board_column(planner, d["id"])[1]["counts"] == counts


def test_wf_restore_and_erasure_reopen(browser, app_url):
    planner, dara, tomasz = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor"), Api(app_url, "tomasz.wilk")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn = dname(d)
    before = certify(dara, tomasz, threads(planner, d["id"])["G-FNAA"]["id"])
    with board(browser, app_url, "robin.achterberg") as page:
        dlg = drawer(page, "G-FNAA", dn)
        fill(dlg.get_by_role("textbox", name="Reopen reason"), "Closed against the wrong work")
        click(btn(dlg, "Reopen thread"))
        expect(status(page)).to_contain_text("Thread reopened. Prior signatures kept as void.", timeout=UI_MS)
        expect(dlg.get_by_role("list", name="Sign-off chain")).to_contain_text("void")
    t = thread(planner, before["id"])
    assert t["stage"] == "reopened" and t["work_card"]["id"] == before["work_card"]["id"]
    assert t["work_card"]["holder"]["display_name"] == "Dara Okafor" and {s["status"] for s in t["signatures"]} == {"void"}
    assert [e["id"] for e in t["evidence"]] == [e["id"] for e in before["evidence"]]
    for item in t["evidence"]:
        assert sha(S3().get(item["key"])) == item["sha256"]
    assert board_column(planner, d["id"])[1]["counts"] == recount(planner, d["id"])


def test_wf_restore_and_erasure_erase(browser, app_url, mail):
    planner, tomasz, clerk = Api(app_url, "avery.lund"), Api(app_url, "tomasz.wilk"), Api(app_url, "robin.achterberg")
    victim = next(p for p in clerk.get("/api/people")["people"] if p["contractor"] and not p["erased"])
    who = Api(app_url, victim["username"])
    name, licence = victim["display_name"], victim["licence"]
    d, _ = ingest(planner, [(ATR, 1100, 1170)])
    dn, t = dname(d), threads(planner, d["id"])
    done = certify(who, tomasz, t["G-FNAA"]["id"])
    inspect(who, t["G-FNAB"]["id"])
    assert claim(who, t["G-FNAC"]["id"]).status_code == 200
    run_import(clerk, import_csv([legacy_row("G-FNAD", d["number"], "R1", "complied", inspector=name, inspector_licence=licence)]))
    old = clerk.ok("POST", "/api/packs", {"directive_id": d["id"]}, key=idempotency_key())["pack"]
    assert name.encode() in S3().get(old["csv_key"])
    sent = poll(lambda: pack_mails(mail, old["id"]), SETTLE_S, "pre-erasure pack mail")[0]
    req_subject = f"Countersignature requested: G-FNAB {dn} R1"
    assert notices_for(clerk, req_subject)
    with board(browser, app_url, "robin.achterberg") as page:
        click(page.get_by_role("navigation", name="Sections").get_by_role("link", name="People"))
        click(btn(page, f"Erase {name}"))
        dlg = page.get_by_role("dialog", name="Erase contractor")
        fill(dlg.get_by_role("textbox", name="Erasure reason"), "Contractor erasure request")
        click(btn(dlg, "Erase"))
        expect(status(page)).to_contain_text("now replaces this contractor everywhere.", timeout=UI_MS)
        token = next(p for p in clerk.get("/api/people")["people"] if p["id"] == victim["id"])["display_name"]
        expect(status(page)).to_contain_text(f"{token} now replaces this contractor everywhere.")
    erased_by = now(clerk)
    p = next(x for x in clerk.get("/api/people")["people"] if x["id"] == victim["id"])
    assert TOKEN.match(token) and p["erased"] is True and p["licence"] is None and p["email"] is None
    after = threads(clerk, d["id"])
    aa = after["G-FNAA"]
    assert [s["id"] for s in aa["signatures"]] == [s["id"] for s in done["signatures"]]
    assert aa["signatures"][0]["signer"]["display_name"] == token and aa["signatures"][0]["signer"]["licence"] is None
    assert [e["key"] for e in aa["evidence"]] == [e["key"] for e in done["evidence"]] and aa["evidence"][0]["attached_by"]["display_name"] == token
    assert S3().get(aa["evidence"][0]["key"])
    assert after["G-FNAB"]["stage"] == "inspected" and after["G-FNAB"]["work_card"]["holder"] is None
    assert after["G-FNAC"]["stage"] == "open" and after["G-FNAC"]["work_card"]["holder"] is None
    assert after["G-FNAD"]["signatures"][0]["signer_text"] == token
    run_import(clerk, import_csv([legacy_row("G-FNAE", d["number"], "R1", "complied", inspector=name.upper())]))
    assert threads(clerk, d["id"])["G-FNAE"]["signatures"][0]["signer_text"] == token
    for q in (name, licence):
        assert all(name not in x["label"] and licence not in x["label"] for x in clerk.get("/api/search", q=q)["results"])
    assert any(x["type"] == "person" and x["id"] == victim["id"] for x in clerk.get("/api/search", q=token)["results"])
    raw, _ = export(clerk, d["id"])
    assert name not in raw.text and licence not in raw.text and token in raw.text
    assert any(e["actor"]["display_name"] == token for e in clerk.get("/api/audit", directive_id=d["id"])["entries"])
    for n in clerk.get("/api/notices")["notices"]:
        if n["status"] == "queued":
            assert name not in n["body"] and licence not in n["body"]
    new = clerk.get(f"/api/packs/{old['id']}")["pack"]
    assert new["csv_key"] != old["csv_key"] and new["pdf_key"] != old["pdf_key"]
    for key in (new["csv_key"], new["pdf_key"]):
        body = S3().get(key)
        assert name.encode() not in body and licence.encode() not in body and token.encode() in body
    assert old["csv_key"] not in S3().keys("packs/") and old["pdf_key"] not in S3().keys("packs/")
    assert text(next(m for m in mail.messages() if m["ID"] == sent["ID"])) == text(sent)
    later = clerk.ok("POST", "/api/packs", {"directive_id": d["id"]}, key=idempotency_key())["pack"]
    m = poll(lambda: pack_mails(mail, later["id"]), SETTLE_S, "post-erasure pack mail")[0]
    assert name not in text(m) and licence not in text(m)
    req = notices_for(clerk, req_subject)[0]
    if req["sent_at"] is None or ts(req["sent_at"]) > erased_by:
        hold = poll(lambda: [x for x in mail.messages() if x["Subject"] == req_subject], NOTICE_HOLD_MAX_S, "request mail")
        assert name not in text(hold[0]) and licence not in text(hold[0])


def test_wf_notices_rewrite(browser, app_url, mail):
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn, aa = dname(d), threads(planner, d["id"])["G-FNAA"]
    assert claim(dara, aa["id"]).status_code == 200
    with board(browser, app_url, "avery.lund") as page:
        ui_ingest_revision(page, dn, 1100, 1110, today(planner).isoformat())
    subject = f"New revision {dn} R2 affects your work card {aa['work_card']['id']}"
    n = notices_for(planner, subject)
    assert len(n) == 1 and USERS["dara.okafor"][5] in str(n[0]["to"])
    hold = (ts(n[0]["send_after"]) - ts(n[0]["queued_at"])).total_seconds()
    if hold >= COMMENT_GRACE_S:
        assert n[0]["status"] == "queued"
    got = poll(lambda: [m for m in mail.messages() if m["Subject"] == subject], hold + RETRY_S + SETTLE_S, "card notice")
    assert len(got) == 1 and USERS["dara.okafor"][5] in addresses(got[0]["To"]) and "G-FNAA" in text(got[0])
    assert notices_for(planner, subject)[0]["status"] == "sent"


def test_wf_notices_withdraw(browser, app_url, mail):
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn = dname(d)
    inspect(dara, threads(planner, d["id"])["G-FNAA"]["id"])
    subject = f"Countersignature requested: G-FNAA {dn} R1"
    n = notices_for(planner, subject)[0]
    with board(browser, app_url, "avery.lund") as page:
        click(btn(page, f"Directive actions {dn}"))
        click(page.get_by_role("menuitem", name="Withdraw directive"))
        dlg = page.get_by_role("dialog", name=f"Withdraw {dn}")
        fill(dlg.get_by_role("textbox", name="Withdrawal reason"), "Cancelled")
        click(btn(dlg, "Withdraw"))
        expect(status(page)).to_contain_text(f"{dn} withdrawn. History kept.", timeout=UI_MS)
    if n["status"] == "queued" and notices_for(planner, subject)[0]["status"] != "sent":
        assert notices_for(planner, subject)[0]["status"] == "withdrawn"
        poll(lambda: now(planner) > ts(n["send_after"]) + timedelta(seconds=RETRY_S), NOTICE_HOLD_MAX_S, "hold elapsed")
        assert notices_for(planner, subject)[0]["status"] == "withdrawn"
        assert not [m for m in mail.messages() if m["Subject"] == subject]


def test_wf_notices_erasure(browser):
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    planner, clerk = Api(base, "avery.lund"), Api(base, "robin.achterberg")
    victim = next(p for p in clerk.get("/api/people")["people"] if p["contractor"] and not p["erased"])
    who = Api(base, victim["username"])
    name, licence = victim["display_name"], victim["licence"]
    d1, _ = ingest(planner, [(ATR, 1100, 1110)])
    d2, _ = ingest(planner, [(ATR, 1100, 1110)])
    a = threads(planner, d1["id"])["G-FNAA"]
    assert claim(who, a["id"]).status_code == 200
    revise(planner, d1["id"], [(ATR, 1100, 1110)])
    inspect(who, threads(planner, d2["id"])["G-FNAA"]["id"])
    card_subject = f"New revision {dname(d1)} R2 affects your work card {a['work_card']['id']}"
    req_subject = f"Countersignature requested: G-FNAA {dname(d2)} R1"
    (card,) = notices_for(planner, card_subject)
    (req,) = notices_for(planner, req_subject)
    assert card["status"] == "queued" and req["status"] == "queued"
    assert name in req["body"] and licence in req["body"]
    with board(browser, base, "robin.achterberg") as page:
        click(page.get_by_role("navigation", name="Sections").get_by_role("link", name="People"))
        click(btn(page, f"Erase {name}"))
        dlg = page.get_by_role("dialog", name="Erase contractor")
        fill(dlg.get_by_role("textbox", name="Erasure reason"), "Contractor erasure request")
        click(btn(dlg, "Erase"))
        expect(status(page)).to_contain_text("now replaces this contractor everywhere.", timeout=UI_MS)
    token = next(p for p in clerk.get("/api/people")["people"] if p["id"] == victim["id"])["display_name"]
    assert TOKEN.match(token)
    assert notices_for(planner, card_subject)[0]["status"] == "withdrawn"
    after = notices_for(planner, req_subject)[0]
    assert after["id"] == req["id"] and after["status"] == "queued"
    assert name not in after["body"] and licence not in after["body"] and token in after["body"]
    assert victim["email"] not in str(after["to"])


def ui_send_pack(page, dn):
    click(page.get_by_role("navigation", name="Sections").get_by_role("link", name="Packs"))
    choose(page.get_by_role("combobox", name="Pack directive"), f"{dn} R1")
    click(btn(page, "Send compliance pack"))
    return page.get_by_role("table", name="Compliance packs").get_by_role("row").filter(has_text=dn).first


def test_wf_compliance_pack_send(browser, app_url, mail):
    planner, clerk = Api(app_url, "avery.lund"), Api(app_url, "robin.achterberg")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn = dname(d)
    with board(browser, app_url, "robin.achterberg") as page:
        row = ui_send_pack(page, dn)
        expect(status(page)).to_contain_text("Pack transmitted to the authority.", timeout=UI_MS)
        expect(row).to_contain_text("Transmitted", timeout=UI_MS)
    p = next(x for x in clerk.get("/api/packs")["packs"] if x["directive_id"] == d["id"])
    assert p["status"] == "transmitted" and S3().get(p["pdf_key"]).startswith(b"%PDF-")
    poll(lambda: pack_mails(mail, p["id"]), SETTLE_S, "pack mail")
    assert len(pack_mails(mail, p["id"])) == 1


def test_wf_compliance_pack_queued(browser, mail):
    base = os.environ["APP_MAILPIT_DOWN_URL"]
    planner, clerk = Api(base, "avery.lund"), Api(base, "robin.achterberg")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn = dname(d)
    with board(browser, base, "robin.achterberg") as page:
        row = ui_send_pack(page, dn)
        service = "mail"
        expect(status(page)).to_contain_text(f"Pack queued: {service} is unavailable. It will go out automatically.", timeout=UI_MS)
        expect(row).to_contain_text("Queued", timeout=UI_MS)
        p = next(x for x in clerk.get("/api/packs")["packs"] if x["directive_id"] == d["id"])
        assert (p["status"], p["waiting_for"]) == ("queued", "mail")
        with relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])):
            expect(row).to_contain_text("Transmitted", timeout=(RETRY_S + SETTLE_S) * 1000)
            poll(lambda: pack_mails(mail, p["id"]), SETTLE_S, "pack mail")
    assert clerk.get(f"/api/packs/{p['id']}")["pack"]["status"] == "transmitted"
    assert len(pack_mails(mail, p["id"])) == 1


def test_wf_read_only_oversight_auditor(browser, app_url):
    planner, dara = Api(app_url, "avery.lund"), Api(app_url, "dara.okafor")
    d, _ = ingest(planner, [(ATR, 1100, 1120)])
    dn = dname(d)
    assert claim(dara, threads(planner, d["id"])["G-FNAA"]["id"]).status_code == 200
    revise(planner, d["id"], [(ATR, 1100, 1110)])
    with board(browser, app_url, "casey.moreau") as page:
        for name in ("New directive", "Import history"):
            expect(btn(page, name)).to_have_count(0)
        click(view_under(page, dn, "R1"))
        view = page.get_by_role("status", name="Viewing prior revision")
        expect(view).to_contain_text(f"Viewing {dn} as it stood under R1. Read-only.", timeout=UI_MS)
        expect(cell(page, "G-FNAB", dn, "R1")).to_be_visible()
        click(btn(view, "Back to current"))
        expect(cell(page, "G-FNAA", dn, "R2")).to_be_visible(timeout=UI_MS)
        click(page.get_by_role("navigation", name="Sections").get_by_role("link", name="Audit"))
        trail = page.get_by_role("table", name="Audit trail")
        expect(trail).to_be_visible(timeout=UI_MS)
        choose(page.get_by_role("combobox", name="Audit directive"), f"{dn} R2")
        expect(trail).to_contain_text("Dara Okafor")
    snap = Api(app_url, "casey.moreau").get("/api/board", directive_id=d["id"], as_of="R1")
    assert any(c["registration"] == "G-FNAB" and c["revision"] == "R1" for c in snap["cells"])
    aa = threads(planner, d["id"])["G-FNAA"]
    assert aa["revision"] == "R2" and (aa["history"][0]["revision"], aa["history"][0]["outcome"]) == ("R1", "retargeted")


def test_wf_read_only_oversight_refused(browser, app_url):
    planner, casey = Api(app_url, "avery.lund"), Api(app_url, "casey.moreau")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    dn, tid = dname(d), threads(planner, d["id"])["G-FNAA"]["id"]
    with board(browser, app_url, "casey.moreau") as page:
        dlg = drawer(page, "G-FNAA", dn)
        for name in ("Claim work card", "Defer", "Reopen thread"):
            expect(btn(dlg, name)).to_have_count(0)
    err(claim(casey, tid), 403, "forbidden")
    err(defer(casey, tid), 403, "forbidden")
    assert thread(planner, tid)["stage"] == "open"


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def shipped_python():
    req = APP / "requirements.txt"
    if req.exists():
        lines = [line.split("#")[0].strip() for line in req.read_text().splitlines()]
        return [re.split(r"[<>=!~\[; ]", line)[0] for line in lines if line and not line.startswith("-")]
    project = tomllib.loads((APP / "pyproject.toml").read_text())["project"]
    return [re.split(r"[<>=!~\[; ]", dep)[0] for dep in project.get("dependencies", [])]


def shipped_npm():
    if not (APP / "package.json").exists():
        return {}
    return {package.name: package.licence for package in shipped_packages(APP)}


def walk_commands(node):
    if isinstance(node, dict):
        if isinstance(node.get("command"), str):
            yield node["command"]
        for v in node.values():
            yield from walk_commands(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk_commands(v)


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(m[k], str) and m[k].strip()
    for k in ("build", "serve"):
        assert ".venv/bin/" in m[k] or re.search(r"python3? -m ", m[k]), m[k]
    for seg in re.split(r"&&|;|\|\|", m["install"]):
        if re.search(r"\bpip3? install", seg):
            assert ".venv/bin/" in seg or re.search(r"python3? -m ", seg), seg


def test_if_third_party_notices():
    raw = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    notices = norm(raw)
    for name in shipped_python() + list(shipped_npm()):
        assert norm(name) in notices, name
    assert "IBM Plex".lower() in re.sub(r"[-_]+", " ", raw.lower())


def test_if_licences():
    allowed = ("MIT", "BSD", "Apache", "ISC", "PSF", "MPL", "OFL")
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    sites = list((APP / ".venv" / "lib").glob("python*/site-packages")) if (APP / ".venv" / "lib").is_dir() else []
    if sites:
        dists = {norm(x.metadata["Name"]): x for x in importlib.metadata.distributions(path=[str(sites[0])])}
        for name in shipped_python():
            meta = dists[norm(name)].metadata
            lic = " ".join([meta.get("License-Expression") or "", meta.get("License") or ""] + (meta.get_all("Classifier") or []))
            assert any(a in lic for a in allowed), (name, lic)
    else:
        for name in shipped_python():
            assert norm(name) in norm(notices), name
    for name, lic in shipped_npm().items():
        assert any(a in lic for a in allowed), (name, lic)
    assert "OFL-1.1" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_datastores():
    for path in APP.rglob("*"):
        if ".venv" in path.parts or "node_modules" in path.parts:
            continue
        assert path.suffix not in (".sqlite", ".sqlite3", ".db"), path
    assert Postgres().tables()


def test_if_service_config_unchanged():
    compose = re.compile(r"(^|/)(docker-)?compose[^/\s]*\.ya?ml$")
    vendored = re.compile(r"(^|[/\s])(\.venv|node_modules)/")
    if not TRAJECTORY.is_file():
        return
    log = json.loads(TRAJECTORY.read_text())

    def check(node):
        if isinstance(node, dict):
            target = node.get("file_path") or node.get("path")
            if isinstance(target, str) and compose.search(target) and not vendored.search(target):
                assert not any(k in node for k in ("content", "new_string", "edits", "new_str")), target
            for v in node.values():
                check(v)
        elif isinstance(node, list):
            for v in node:
                check(v)
    check(log)
    for s in walk_commands(log):
        for found in re.finditer(r"(>|tee |sed -i|\brm |\bmv )[^\n|;&]*(docker-)?compose[^\s]*\.ya?ml", s):
            assert vendored.search(found.group(0)), s[:200]


def test_if_same_origin(browser, app_url):
    planner = Api(app_url, "avery.lund")
    d, _ = ingest(planner, [(ATR, 1100, 1110)])
    with open_app(browser, app_url) as page:
        page.clock.resume()
        urls = []
        page.on("request", lambda r: urls.append(r.url))
        page.set_viewport_size({"width": 1280, "height": 800})
        page.reload()
        sign_in(page, "avery.lund")
        expect(grid(page)).to_be_visible(timeout=UI_MS)
        drawer(page, "G-FNAA", dname(d))
    remote = [u for u in urls if u.startswith("http") and not same_origin(u, app_url)]
    assert not remote, remote


def test_if_venv_only():
    assert [p.as_posix() for p in APP.rglob("site-packages") if ".venv" not in p.as_posix()] == []
    if not TRAJECTORY.is_file():
        return
    for s in walk_commands(json.loads(TRAJECTORY.read_text())):
        for seg in re.split(r"&&|;|\|\||\n", s):
            if re.search(r"\bpip3? install\b", seg) and "--help" not in seg:
                assert ".venv" in seg, seg[:200]
